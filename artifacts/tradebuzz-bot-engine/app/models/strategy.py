from sqlalchemy import Column, Integer, String, Boolean, Float, DateTime, JSON, ForeignKey, func
from app.database import Base


class Strategy(Base):
    __tablename__ = "strategies"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    name = Column(String, nullable=False)
    symbol = Column(String, nullable=False)
    market = Column(String, default="crypto")
    timeframe = Column(String, default="1h")
    entry_rules = Column(JSON, default={})
    exit_rules = Column(JSON, default={})
    stop_loss_pct = Column(Float, default=2.0)
    take_profit_pct = Column(Float, default=4.0)
    max_trades_per_day = Column(Integer, default=3)
    is_active = Column(Boolean, default=True)
    confidence_threshold = Column(Float, default=0.6)
    parameters = Column(JSON, default={})
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
