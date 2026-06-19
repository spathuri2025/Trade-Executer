from sqlalchemy import Column, Integer, String, Boolean, Float, DateTime, ForeignKey, func
from app.database import Base


class BotSettings(Base):
    __tablename__ = "bot_settings"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    bot_name = Column(String, default="TradeBuzz Bot")
    is_enabled = Column(Boolean, default=False)
    mode = Column(String, default="PAPER")
    cycle_interval_seconds = Column(Integer, default=60)
    broker_connector = Column(String, default="mock")
    virtual_balance = Column(Float, default=10000.0)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
