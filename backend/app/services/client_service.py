from __future__ import annotations

import re
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.client import Client
from app.models.stay import Stay
from app.models.user import User
from app.schemas.client import ClientCreate
from app.services.audit import log_activity, set_created_by, set_updated_by


def normalize_name(name: str | None) -> str:
    if not name:
        return ""
    return re.sub(r"\s+", " ", name.strip().casefold())


def normalize_phone(phone: str | None) -> str:
    if not phone:
        return ""
    digits = re.sub(r"\D", "", phone)
    if len(digits) >= 10:
        return digits[-10:]
    return digits


def _fill_missing(keeper: Client, source: Client) -> None:
    for field in (
        "phone",
        "iin",
        "bin",
        "age",
        "date_of_birth",
        "document_number",
        "notes",
        "client_type",
    ):
        if getattr(keeper, field) in (None, "") and getattr(source, field) not in (None, ""):
            setattr(keeper, field, getattr(source, field))


def find_matching_client(
    db: Session,
    *,
    full_name: str,
    phone: str | None = None,
    iin: str | None = None,
    bin_value: str | None = None,
    exclude_id: int | None = None,
) -> Client | None:
    query = db.query(Client).filter(Client.deleted_at.is_(None))
    if exclude_id is not None:
        query = query.filter(Client.id != exclude_id)

    if iin:
        found = query.filter(Client.iin == iin).order_by(Client.id.asc()).first()
        if found:
            return found

    if bin_value:
        found = query.filter(Client.bin == bin_value).order_by(Client.id.asc()).first()
        if found:
            return found

    phone_key = normalize_phone(phone)
    if phone_key:
        for candidate in query.filter(Client.phone.isnot(None)).order_by(Client.id.asc()).all():
            if normalize_phone(candidate.phone) == phone_key:
                return candidate

    name_key = normalize_name(full_name)
    if not name_key:
        return None

    for candidate in query.order_by(Client.id.asc()).all():
        if normalize_name(candidate.full_name) == name_key:
            return candidate

    return None


def find_or_create_client(
    db: Session,
    payload: ClientCreate,
    current_user: User,
) -> tuple[Client, bool]:
    """Return (client, created). Reuses an existing match instead of duplicating."""
    existing = find_matching_client(
        db,
        full_name=payload.full_name,
        phone=payload.phone,
        iin=payload.iin,
        bin_value=payload.bin,
    )
    if existing:
        _fill_missing(
            existing,
            Client(
                full_name=payload.full_name,
                phone=payload.phone,
                iin=payload.iin,
                bin=payload.bin,
                client_type=payload.client_type,
                age=payload.age,
                date_of_birth=payload.date_of_birth,
                document_number=payload.document_number,
                notes=payload.notes,
            ),
        )
        if payload.full_name and normalize_name(payload.full_name) != normalize_name(existing.full_name):
            # Keep the longer/more complete name if user typed a fuller ФИО.
            if len(payload.full_name.strip()) > len(existing.full_name.strip()):
                existing.full_name = payload.full_name.strip()
        set_updated_by(existing, current_user)
        db.flush()
        return existing, False

    client = Client(**payload.model_dump())
    set_created_by(client, current_user)
    db.add(client)
    db.flush()
    log_activity(
        db,
        user=current_user,
        action="Создала клиента",
        entity_type="client",
        entity_id=client.id,
        entity_label=client.full_name,
    )
    return client, True


def merge_client_into(
    db: Session,
    *,
    keeper: Client,
    duplicate: Client,
    current_user: User | None = None,
) -> None:
    if keeper.id == duplicate.id:
        return

    db.query(Stay).filter(Stay.client_id == duplicate.id).update(
        {Stay.client_id: keeper.id},
        synchronize_session=False,
    )
    _fill_missing(keeper, duplicate)
    if len((duplicate.full_name or "").strip()) > len((keeper.full_name or "").strip()):
        keeper.full_name = duplicate.full_name
    duplicate.deleted_at = datetime.now(timezone.utc)
    if current_user:
        set_updated_by(keeper, current_user)
        set_updated_by(duplicate, current_user)
        log_activity(
            db,
            user=current_user,
            action="Объединила дубликат клиента",
            entity_type="client",
            entity_id=keeper.id,
            entity_label=keeper.full_name,
            old_value=f"id={duplicate.id}",
            new_value=f"id={keeper.id}",
        )


def dedupe_clients(db: Session, current_user: User | None = None) -> dict[str, int]:
    """Merge active clients that share IIN, phone, or identical ФИО."""
    clients = (
        db.query(Client)
        .filter(Client.deleted_at.is_(None))
        .order_by(Client.id.asc())
        .all()
    )

    groups: dict[str, list[Client]] = {}

    def add_key(key: str, client: Client) -> None:
        groups.setdefault(key, []).append(client)

    for client in clients:
        if client.iin:
            add_key(f"iin:{client.iin}", client)
        if client.bin:
            add_key(f"bin:{client.bin}", client)
        phone_key = normalize_phone(client.phone)
        if phone_key:
            add_key(f"phone:{phone_key}", client)
        name_key = normalize_name(client.full_name)
        if name_key:
            add_key(f"name:{name_key}", client)

    # Union-find style: map each client id to the earliest keeper in overlapping groups.
    parent: dict[int, int] = {c.id: c.id for c in clients}

    def find(cid: int) -> int:
        while parent[cid] != cid:
            parent[cid] = parent[parent[cid]]
            cid = parent[cid]
        return cid

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra == rb:
            return
        if ra < rb:
            parent[rb] = ra
        else:
            parent[ra] = rb

    for members in groups.values():
        if len(members) < 2:
            continue
        root = members[0].id
        for other in members[1:]:
            union(root, other.id)

    by_id = {c.id: c for c in clients}
    clusters: dict[int, list[Client]] = {}
    for client in clients:
        clusters.setdefault(find(client.id), []).append(client)

    merged_groups = 0
    removed = 0
    for members in clusters.values():
        if len(members) < 2:
            continue
        members.sort(key=lambda c: c.id)
        keeper = members[0]
        merged_groups += 1
        for duplicate in members[1:]:
            merge_client_into(
                db,
                keeper=keeper,
                duplicate=duplicate,
                current_user=current_user,
            )
            removed += 1

    if removed:
        db.commit()
    return {"merged_groups": merged_groups, "removed": removed}
