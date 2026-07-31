from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.permissions import require_analytics_owner
from app.models.user import User
from app.services.audit import log_activity
from app.services.restaurant_menu import load_saved_menu, save_menu

router = APIRouter(prefix="/restaurant-menu", tags=["restaurant-menu"])


class MenuSizeOption(BaseModel):
    size: str
    price: float


class MenuItem(BaseModel):
    name: str
    price: Optional[float] = None
    description: Optional[str] = None
    sizes: Optional[list[MenuSizeOption]] = None


class MenuSection(BaseModel):
    title: Optional[str] = None
    items: list[MenuItem] = Field(default_factory=list)


class MenuSubcategory(BaseModel):
    id: str
    title: str
    sections: list[MenuSection] = Field(default_factory=list)


class MenuTab(BaseModel):
    id: str
    title: str
    subcategories: list[MenuSubcategory] = Field(default_factory=list)


class RestaurantMenuResponse(BaseModel):
    tabs: Optional[list[MenuTab]] = None
    is_custom: bool = False


class RestaurantMenuUpdate(BaseModel):
    tabs: list[MenuTab]


@router.get("", response_model=RestaurantMenuResponse)
def get_restaurant_menu(
    _: User = Depends(get_current_user),
) -> RestaurantMenuResponse:
    saved = load_saved_menu()
    if saved is None:
        return RestaurantMenuResponse(tabs=None, is_custom=False)
    return RestaurantMenuResponse(tabs=saved, is_custom=True)


@router.put("", response_model=RestaurantMenuResponse)
def update_restaurant_menu(
    payload: RestaurantMenuUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_analytics_owner),
) -> RestaurantMenuResponse:
    tabs_data: list[dict[str, Any]] = [tab.model_dump() for tab in payload.tabs]
    save_menu(tabs_data)
    log_activity(
        db,
        user=current_user,
        action="Обновила меню ресторана",
        entity_type="restaurant_menu",
        entity_id=None,
        entity_label="Меню ресторана",
        new_value=f"{sum(len(s.items) for t in payload.tabs for sub in t.subcategories for s in sub.sections)} позиций",
    )
    db.commit()
    return RestaurantMenuResponse(tabs=tabs_data, is_custom=True)
