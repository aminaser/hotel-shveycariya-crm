from __future__ import annotations

from typing import Any, Optional

from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog
from app.models.user import User


def log_activity(
    db: Session,
    *,
    user: Optional[User],
    action: str,
    entity_type: Optional[str] = None,
    entity_id: Optional[Any] = None,
    entity_label: Optional[str] = None,
    old_value: Optional[str] = None,
    new_value: Optional[str] = None,
    commit: bool = False,
) -> ActivityLog:
    entry = ActivityLog(
        user_id=user.id if user else None,
        user_name=(user.full_name or user.username) if user else "Система",
        user_role=user.role_label if user else "—",
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        entity_label=entity_label,
        old_value=old_value,
        new_value=new_value,
    )
    db.add(entry)
    if commit:
        db.commit()
        db.refresh(entry)
    return entry


def set_created_by(obj: Any, user: User) -> None:
    name = user.full_name or user.username
    if hasattr(obj, "created_by_user_id"):
        obj.created_by_user_id = user.id
    if hasattr(obj, "created_by_name"):
        obj.created_by_name = name
    if hasattr(obj, "updated_by_user_id"):
        obj.updated_by_user_id = user.id
    if hasattr(obj, "updated_by_name"):
        obj.updated_by_name = name


def set_updated_by(obj: Any, user: User) -> None:
    name = user.full_name or user.username
    if hasattr(obj, "updated_by_user_id"):
        obj.updated_by_user_id = user.id
    if hasattr(obj, "updated_by_name"):
        obj.updated_by_name = name


def summarize_changes(old: dict, new: dict) -> tuple[Optional[str], Optional[str]]:
    """Build human-readable old/new strings for changed keys only."""
    keys = sorted(set(old) | set(new))
    old_parts: list[str] = []
    new_parts: list[str] = []
    for key in keys:
        before = old.get(key)
        after = new.get(key)
        if str(before) == str(after):
            continue
        old_parts.append(f"{key}: {before}")
        new_parts.append(f"{key}: {after}")
    if not old_parts and not new_parts:
        return None, None
    return "; ".join(old_parts) or None, "; ".join(new_parts) or None
