from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from app.database import get_db
from app.api.auth import require_api_key
from app.models import Strategy

router = APIRouter(prefix="/strategies", tags=["strategies"], dependencies=[Depends(require_api_key)])


class StrategyCreate(BaseModel):
    name: str
    symbol: str
    market: str = "crypto"
    timeframe: str = "1h"
    stop_loss_pct: float = 2.0
    take_profit_pct: float = 4.0
    max_trades_per_day: int = 3
    confidence_threshold: float = 0.6
    parameters: dict = {}


class StrategyUpdate(BaseModel):
    name: Optional[str] = None
    symbol: Optional[str] = None
    market: Optional[str] = None
    timeframe: Optional[str] = None
    stop_loss_pct: Optional[float] = None
    take_profit_pct: Optional[float] = None
    max_trades_per_day: Optional[int] = None
    confidence_threshold: Optional[float] = None
    is_active: Optional[bool] = None
    parameters: Optional[dict] = None


@router.get("")
def list_strategies(db: Session = Depends(get_db)):
    strategies = db.query(Strategy).all()
    return [
        {
            "id": s.id,
            "name": s.name,
            "symbol": s.symbol,
            "market": s.market,
            "timeframe": s.timeframe,
            "stop_loss_pct": s.stop_loss_pct,
            "take_profit_pct": s.take_profit_pct,
            "max_trades_per_day": s.max_trades_per_day,
            "confidence_threshold": s.confidence_threshold,
            "is_active": s.is_active,
            "parameters": s.parameters,
        }
        for s in strategies
    ]


@router.post("")
def create_strategy(body: StrategyCreate, db: Session = Depends(get_db)):
    strategy = Strategy(
        user_id=1,
        name=body.name,
        symbol=body.symbol,
        market=body.market,
        timeframe=body.timeframe,
        stop_loss_pct=body.stop_loss_pct,
        take_profit_pct=body.take_profit_pct,
        max_trades_per_day=body.max_trades_per_day,
        confidence_threshold=body.confidence_threshold,
        parameters=body.parameters,
    )
    db.add(strategy)
    db.commit()
    db.refresh(strategy)
    return {"id": strategy.id, "message": "Strategy created"}


@router.put("/{strategy_id}")
def update_strategy(strategy_id: int, body: StrategyUpdate, db: Session = Depends(get_db)):
    strategy = db.query(Strategy).filter(Strategy.id == strategy_id).first()
    if not strategy:
        raise HTTPException(status_code=404, detail="Strategy not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(strategy, field, value)
    db.commit()
    return {"message": "Strategy updated"}


@router.delete("/{strategy_id}")
def delete_strategy(strategy_id: int, db: Session = Depends(get_db)):
    strategy = db.query(Strategy).filter(Strategy.id == strategy_id).first()
    if not strategy:
        raise HTTPException(status_code=404, detail="Strategy not found")
    db.delete(strategy)
    db.commit()
    return {"message": "Strategy deleted"}
