"""
TradeBuzz Bot Engine — FastAPI application entry point.

SAFETY: Default mode is PAPER_TRADING.
Live trading requires LIVE_TRADING_ENABLED=true environment variable.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import init_db
from app.api import api_router
from app.workers import start_scheduler, stop_scheduler
from app.services.seed import seed_default_data

logger = logging.getLogger("tradebuzz.main")
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("=== TradeBuzz Bot Engine starting ===")
    logger.info(f"Mode: {settings.BOT_MODE} | Live trading enabled: {settings.LIVE_TRADING_ENABLED}")

    init_db()
    logger.info("Database tables created/verified")

    seed_default_data()
    logger.info("Default data seeded")

    start_scheduler()
    logger.info(f"Scheduler started — bot cycle every {settings.BOT_CYCLE_INTERVAL}s")

    if settings.LIVE_TRADING_ENABLED:
        logger.warning("⚠️  LIVE TRADING IS ENABLED — real money is at risk")
    else:
        logger.info("✅ Paper trading mode — no real money at risk")

    yield

    stop_scheduler()
    logger.info("=== TradeBuzz Bot Engine stopped ===")


# Everything is served behind the shared reverse proxy under BASE_PATH (e.g. "/engine").
# The proxy does NOT strip the prefix, so routes must physically live under it.
BASE_PATH = settings.BASE_PATH.rstrip("/")

app = FastAPI(
    title="TradeBuzz Bot Engine",
    description=(
        "Automated trading bot engine with paper trading, risk management, "
        "strategy framework, and multi-broker support. "
        "⚠️ Default mode is PAPER — live trading requires explicit configuration."
    ),
    version="1.0.0",
    lifespan=lifespan,
    docs_url=f"{BASE_PATH}/docs",
    redoc_url=f"{BASE_PATH}/redoc",
    openapi_url=f"{BASE_PATH}/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=BASE_PATH)


@app.get(BASE_PATH or "/")
def root():
    return {
        "service": "TradeBuzz Bot Engine",
        "version": "1.0.0",
        "mode": settings.BOT_MODE,
        "live_trading_enabled": settings.LIVE_TRADING_ENABLED,
        "docs": f"{BASE_PATH}/docs",
        "safety_notice": "This engine defaults to PAPER trading mode. Set LIVE_TRADING_ENABLED=true only when fully configured.",
    }
