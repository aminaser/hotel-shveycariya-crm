from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.permissions import require_analytics_owner
from app.models.user import User
from app.services.as_prices import load_as_price_per_person, save_as_price_per_person
from app.services.audit import log_activity

router = APIRouter(prefix="/as-prices", tags=["as-prices"])


class AsPricesResponse(BaseModel):
    price_per_person: float


class AsPricesUpdate(BaseModel):
    price_per_person: float = Field(ge=0)


@router.get("", response_model=AsPricesResponse)
def get_as_prices(
    _: User = Depends(get_current_user),
) -> AsPricesResponse:
    return AsPricesResponse(price_per_person=load_as_price_per_person())


@router.put("", response_model=AsPricesResponse)
def update_as_prices(
    payload: AsPricesUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_analytics_owner),
) -> AsPricesResponse:
    price = save_as_price_per_person(payload.price_per_person)
    log_activity(
        db,
        user=current_user,
        action="Обновила цену «Ас»",
        entity_type="as_prices",
        entity_id=None,
        entity_label="Ас",
        new_value=f"{price:.0f} ₸ / чел.",
    )
    db.commit()
    return AsPricesResponse(price_per_person=price)
