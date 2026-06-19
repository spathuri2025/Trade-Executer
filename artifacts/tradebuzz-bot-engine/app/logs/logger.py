"""
Structured logging — writes to console AND persists important events in the database.
"""
import json
import logging
import sys
from datetime import datetime
from typing import Optional

logging.basicConfig(
    stream=sys.stdout,
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)

bot_logger = logging.getLogger("tradebuzz.bot")


def log_to_db(
    db,
    level: str,
    event: str,
    message: str,
    symbol: Optional[str] = None,
    strategy: Optional[str] = None,
    extra: Optional[dict] = None,
) -> None:
    """Persist a log entry to the bot_logs table."""
    try:
        from app.models.bot_log import BotLog
        entry = BotLog(
            level=level,
            event=event,
            message=message,
            symbol=symbol,
            strategy=strategy,
            extra=json.dumps(extra) if extra else None,
        )
        db.add(entry)
        db.commit()
    except Exception as e:
        bot_logger.error(f"Failed to write log to DB: {e}")


def log_event(
    db,
    level: str,
    event: str,
    message: str,
    symbol: Optional[str] = None,
    strategy: Optional[str] = None,
    extra: Optional[dict] = None,
) -> None:
    """Log to console and database."""
    log_fn = getattr(bot_logger, level.lower(), bot_logger.info)
    log_fn(f"[{event}] {message}" + (f" | symbol={symbol}" if symbol else ""))
    log_to_db(db, level, event, message, symbol, strategy, extra)
