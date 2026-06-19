from fastapi import APIRouter
from app.api.routes import health, bot, strategies, trades, risk, logs

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(bot.router)
api_router.include_router(strategies.router)
api_router.include_router(trades.router)
api_router.include_router(risk.router)
api_router.include_router(logs.router)
