from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional
from app.database import get_db
from app.api.auth import require_api_key
from app.models import BotLog

router = APIRouter(prefix="/logs", tags=["logs"], dependencies=[Depends(require_api_key)])


@router.get("")
def list_logs(
    limit: int = Query(100, le=500),
    offset: int = 0,
    level: Optional[str] = None,
    event: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(BotLog)
    if level:
        q = q.filter(BotLog.level == level.upper())
    if event:
        q = q.filter(BotLog.event.ilike(f"%{event}%"))
    logs = q.order_by(BotLog.created_at.desc()).offset(offset).limit(limit).all()
    return [
        {
            "id": l.id,
            "level": l.level,
            "event": l.event,
            "message": l.message,
            "symbol": l.symbol,
            "strategy": l.strategy,
            "extra": l.extra,
            "created_at": l.created_at.isoformat() if l.created_at else None,
        }
        for l in logs
    ]
