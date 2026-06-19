from fastapi import APIRouter
from datetime import datetime

router = APIRouter(tags=["health"])


@router.get("/health")
def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat(), "service": "TradeBuzz Bot Engine"}
