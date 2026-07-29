from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    id: int
    username: str
    full_name: str
    role: str
    role_label: str
    created_at: datetime

    model_config = {"from_attributes": True}


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class PasswordResetRequest(BaseModel):
    new_password: str = Field(min_length=6, max_length=128)


class SetupStatusResponse(BaseModel):
    is_initialized: bool


class SetupInitRequest(BaseModel):
    username: str = Field(default="admin", min_length=3, max_length=64)
    password: str = Field(min_length=6, max_length=128)
    hotel_name: str = Field(default="Швейцария", max_length=128)
    hotel_city: str = Field(default="Текели", max_length=128)
    room_numbers: list[str] = Field(
        default_factory=lambda: [str(n) for n in range(1, 16) if n not in (6, 8, 9)]
    )


class ActivityLogResponse(BaseModel):
    id: int
    created_at: datetime
    user_id: Optional[int]
    user_name: str
    user_role: str
    action: str
    entity_type: Optional[str]
    entity_id: Optional[str]
    entity_label: Optional[str]
    old_value: Optional[str]
    new_value: Optional[str]

    model_config = {"from_attributes": True}


class AuthorshipMixin(BaseModel):
    created_by_user_id: Optional[int] = None
    created_by_name: Optional[str] = None
    updated_by_user_id: Optional[int] = None
    updated_by_name: Optional[str] = None
