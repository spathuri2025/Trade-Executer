"""
APScheduler background worker — drives the bot cycle on a fixed interval.
"""
import logging
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.config import get_settings
from app.database import SessionLocal
from app.services.bot_engine import bot_engine

logger = logging.getLogger("tradebuzz.scheduler")
settings = get_settings()

scheduler = BackgroundScheduler()


def _run_cycle_job():
    db = SessionLocal()
    try:
        result = bot_engine.run_cycle(db, user_id=1)
        logger.info(f"Scheduled cycle result: {result}")
    except Exception as e:
        logger.error(f"Scheduled cycle error: {e}")
    finally:
        db.close()


def start_scheduler():
    interval = settings.BOT_CYCLE_INTERVAL
    scheduler.add_job(
        _run_cycle_job,
        trigger=IntervalTrigger(seconds=interval),
        id="bot_cycle",
        replace_existing=True,
        name="Bot Strategy Cycle",
    )
    scheduler.start()
    logger.info(f"Scheduler started — bot cycle every {interval}s")


def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")
