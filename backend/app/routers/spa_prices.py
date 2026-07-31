from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.permissions import require_analytics_owner
from app.models.user import User
from app.services.audit import log_activity
from app.services.spa_prices import load_spa_prices, save_spa_prices

router = APIRouter(prefix="/spa-prices", tags=["spa-prices"])


class SpaPricesResponse(BaseModel):
    sauna: float
    banya: float


class SpaPricesUpdate(BaseModel):
    sauna: float = Field(ge=0)
    banya: float = Field(ge=0)


@router.get("", response_model=SpaPricesResponse)
def get_spa_prices(
    _: User = Depends(get_current_user),
) -> SpaPricesResponse:
    prices = load_spa_prices()
    return SpaPricesResponse(sauna=prices["sauna"], banya=prices["banya"])


@router.put("", response_model=SpaPricesResponse)
def update_spa_prices(
    payload: SpaPricesUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_analytics_owner),
) -> SpaPricesResponse:
    prices = save_spa_prices(payload.model_dump())
    log_activity(
        db,
        user=current_user,
        action="Обновила цены сауны/бани",
        entity_type="spa_prices",
        entity_id=None,
        entity_label="Сауна / баня",
        new_value=f"сауна {prices['sauna']:.0f} ₸ · баня {prices['banya']:.0f} ₸",
    )
    db.commit()
    return SpaPricesResponse(sauna=prices["sauna"], banya=prices["banya"])
