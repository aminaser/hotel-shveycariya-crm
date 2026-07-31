from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.models.user import User, UserRole

# Temporary passwords — change via Settings / Users (owner).
DEFAULT_USERS = [
    {
        "username": "nadezhda",
        "full_name": "Надежда Александровна",
        "role": UserRole.admin.value,
        "password": "nadezhda2026",
    },
    {
        "username": "gulnur",
        "full_name": "Гульнур Аманжоловна",
        "role": UserRole.admin.value,
        "password": "gulnur2026",
    },
    {
        "username": "zhibek",
        "full_name": "Жибек",
        "role": UserRole.owner.value,
        "password": "zhibek2026",
    },
]


def seed_users(db: Session) -> None:
    """Ensure the three hotel users exist with roles and display names."""
    for item in DEFAULT_USERS:
        user = db.query(User).filter(User.username == item["username"]).first()
        if user is None:
            db.add(
                User(
                    username=item["username"],
                    full_name=item["full_name"],
                    role=item["role"],
                    password_hash=get_password_hash(item["password"]),
                )
            )
        else:
            # Keep password; refresh profile fields if empty/outdated.
            if not user.full_name:
                user.full_name = item["full_name"]
            if not user.role:
                user.role = item["role"]
            else:
                # Always sync role/name for known accounts so installs stay consistent.
                user.full_name = item["full_name"]
                user.role = item["role"]

    # Analytics / owner tools: only zhibek may be owner. Demote stray owners.
    for user in db.query(User).all():
        if user.username == "zhibek":
            user.role = UserRole.owner.value
        elif user.role == UserRole.owner.value:
            user.role = UserRole.admin.value
    db.commit()
