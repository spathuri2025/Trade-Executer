from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from app.database import get_db
from app.api.auth import require_api_key
from app.models import RiskLimit, EmergencyStop

router = APIRouter(prefix="/risk", tags=["risk"], dependencies=[Depends(require_api_key)])


class RiskLimitUpdate(BaseModel):
    max_daily_loss_pct: Optional[float] = None
    max_weekly_loss_pct: Optional[float] = None
    max_drawdown_pct: Optional[float] = None
    max_position_size_pct: Optional[float] = None
    max_trades_per_day: Optional[int] = None
    require_stop_loss: Optional[bool] = None
    allowed_markets: Optional[str] = None


@router.get("/status")
def risk_status(db: Session = Depends(get_db)):
    limits = db.query(RiskLimit).filter(RiskLimit.user_id == 1).first()
    estop = db.query(EmergencyStop).filter(EmergencyStop.is_active == True).first()
    return {
        "emergency_stop_active": estop is not None,
        "emergency_stop_reason": estop.reason if estop else None,
        "risk_limits": {
            "max_daily_loss_pct": limits.max_daily_loss_pct if limits else None,
            "max_weekly_loss_pct": limits.max_weekly_loss_pct if limits else None,
            "max_drawdown_pct": limits.max_drawdown_pct if limits else None,
            "max_position_size_pct": limits.max_position_size_pct if limits else None,
            "max_trades_per_day": limits.max_trades_per_day if limits else None,
            "require_stop_loss": limits.require_stop_loss if limits else None,
        } if limits else None,
    }


@router.put("/limits")
def update_risk_limits(body: RiskLimitUpdate, db: Session = Depends(get_db)):
    limits = db.query(RiskLimit).filter(RiskLimit.user_id == 1).first()
    if not limits:
        limits = RiskLimit(user_id=1)
        db.add(limits)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(limits, field, value)
    db.commit()
    return {"message": "Risk limits updated"}
