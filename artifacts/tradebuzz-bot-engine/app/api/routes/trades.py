from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional
from app.database import get_db
from app.api.auth import require_api_key
from app.models import Trade, Signal

router = APIRouter(tags=["trades"], dependencies=[Depends(require_api_key)])


@router.get("/trades")
def list_trades(
    limit: int = Query(50, le=200),
    offset: int = 0,
    status: Optional[str] = None,
    symbol: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Trade)
    if status:
        q = q.filter(Trade.status == status)
    if symbol:
        q = q.filter(Trade.symbol == symbol)
    trades = q.order_by(Trade.opened_at.desc()).offset(offset).limit(limit).all()
    return [
        {
            "id": t.id,
            "symbol": t.symbol,
            "market": t.market,
            "direction": t.direction,
            "mode": t.mode,
            "entry_price": t.entry_price,
            "exit_price": t.exit_price,
            "quantity": t.quantity,
            "pnl": t.pnl,
            "pnl_pct": t.pnl_pct,
            "status": t.status,
            "is_paper": t.is_paper,
            "opened_at": t.opened_at.isoformat() if t.opened_at else None,
            "closed_at": t.closed_at.isoformat() if t.closed_at else None,
        }
        for t in trades
    ]


@router.get("/signals")
def list_signals(
    limit: int = Query(50, le=200),
    offset: int = 0,
    symbol: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Signal)
    if symbol:
        q = q.filter(Signal.symbol == symbol)
    signals = q.order_by(Signal.created_at.desc()).offset(offset).limit(limit).all()
    return [
        {
            "id": s.id,
            "symbol": s.symbol,
            "market": s.market,
            "signal_type": s.signal_type,
            "confidence": s.confidence,
            "price_at_signal": s.price_at_signal,
            "reasoning": s.reasoning,
            "acted_on": s.acted_on,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }
        for s in signals
    ]
