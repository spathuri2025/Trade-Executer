from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.api.auth import require_api_key
from app.services.bot_engine import bot_engine

router = APIRouter(prefix="/bot", tags=["bot"], dependencies=[Depends(require_api_key)])


@router.get("/status")
def get_status(db: Session = Depends(get_db)):
    status = bot_engine.get_status()
    return status


@router.post("/start")
def start_bot(db: Session = Depends(get_db)):
    result = bot_engine.start(db, user_id=1)
    return {"message": result}


@router.post("/stop")
def stop_bot(db: Session = Depends(get_db)):
    result = bot_engine.stop(db, user_id=1)
    return {"message": result}


@router.post("/pause")
def pause_bot(db: Session = Depends(get_db)):
    result = bot_engine.pause(db)
    return {"message": result}


@router.post("/resume")
def resume_bot(db: Session = Depends(get_db)):
    result = bot_engine.resume(db)
    return {"message": result}


@router.post("/emergency-stop")
def emergency_stop(reason: str = "Manual emergency stop", db: Session = Depends(get_db)):
    result = bot_engine.emergency_stop(db, reason=reason)
    return {"message": result}


@router.post("/clear-emergency-stop")
def clear_emergency_stop(db: Session = Depends(get_db)):
    result = bot_engine.clear_emergency_stop(db)
    return {"message": result}


@router.post("/run-cycle")
def run_cycle_now(db: Session = Depends(get_db)):
    result = bot_engine.run_cycle(db, user_id=1)
    return result
