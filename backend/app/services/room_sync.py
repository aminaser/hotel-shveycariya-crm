"""Sync active guest info to Supabase ``room_guests`` table.

Navi AI Concierge (prod) reads this table to greet the guest by name and attach
ФИО to requests.  CRM calls these helpers on check-in / check-out.
Uses stdlib ``urllib`` so we don't add extra dependencies.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from typing import Optional

from app.core.config import settings

logger = logging.getLogger(__name__)


def _supabase_headers() -> dict[str, str]:
    return {
        "apikey": settings.supabase_key,
        "Authorization": f"Bearer {settings.supabase_key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }


def _supabase_request(
    method: str,
    path: str,
    body: Optional[dict | list] = None,
) -> None:
    if not settings.supabase_url or not settings.supabase_key:
        logger.debug("Supabase not configured, skipping room_guests sync")
        return

    url = f"{settings.supabase_url}/rest/v1/{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers=_supabase_headers(), method=method)

    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            resp.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        logger.warning("Supabase sync failed (%s %s): %s %s", method, path, exc.code, detail)
    except Exception:
        logger.warning("Supabase sync error", exc_info=True)


def sync_checkin(
    room_number: str,
    guest_name: str,
    phone: Optional[str],
    check_in: date,
    planned_check_out: Optional[date],
) -> None:
    """Deactivate any previous guest for this room, then insert the new one."""
    _deactivate_room(room_number)

    _supabase_request("POST", "room_guests", {
        "room_number": room_number,
        "guest_name": guest_name,
        "phone": phone,
        "check_in": check_in.isoformat(),
        "planned_check_out": planned_check_out.isoformat() if planned_check_out else None,
        "is_active": True,
    })
    logger.info("Synced check-in: room %s → %s", room_number, guest_name)


def sync_checkout(room_number: str) -> None:
    """Mark the active guest in this room as checked out."""
    _deactivate_room(room_number)
    logger.info("Synced check-out: room %s", room_number)


def _deactivate_room(room_number: str) -> None:
    """Set is_active=false for all active entries in this room."""
    encoded = urllib.parse.quote(room_number, safe="")
    _supabase_request(
        "PATCH",
        f"room_guests?room_number=eq.{encoded}&is_active=eq.true",
        {"is_active": False},
    )
