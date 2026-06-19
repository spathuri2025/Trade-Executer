from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, func
from app.database import Base


class RiskLimit(Base):
    __tablename__ = "risk_limits"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    max_daily_loss_pct = Column(Float, default=5.0)
    max_weekly_loss_pct = Column(Float, default=10.0)
    max_drawdown_pct = Column(Float, default=20.0)
    max_position_size_pct = Column(Float, default=10.0)
    max_trades_per_day = Column(Integer, default=10)
    require_stop_loss = Column(Boolean, default=True)
    allowed_markets = Column(String, default="crypto,stocks,forex")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
