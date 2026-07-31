from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.permissions import require_analytics_owner
from app.models.user import User
from app.services.alumni_prices import load_alumni_price_per_person, save_alumni_price_per_person
from app.services.audit import log_activity

router = APIRouter(prefix="/alumni-prices", tags=["alumni-prices"])


class AlumniPricesResponse(BaseModel):
    price_per_person: float


class AlumniPricesUpdate(BaseModel):
    price_per_person: float = Field(ge=0)


@router.get("", response_model=AlumniPricesResponse)
def get_alumni_prices(
    _: User = Depends(get_current_user),
) -> AlumniPricesResponse:
    return AlumniPricesResponse(price_per_person=load_alumni_price_per_person())


@router.put("", response_model=AlumniPricesResponse)
def update_alumni_prices(
    payload: AlumniPricesUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_analytics_owner),
) -> AlumniPricesResponse:
    price = save_alumni_price_per_person(payload.price_per_person)
    log_activity(
        db,
        user=current_user,
        action="Обновила цену встречи выпускников",
        entity_type="alumni_prices",
        entity_id=None,
        entity_label="Встреча выпускников",
        new_value=f"{price:.0f} ₸ / чел.",
    )
    db.commit()
    return AlumniPricesResponse(price_per_person=price)
