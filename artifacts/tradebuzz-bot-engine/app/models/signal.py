from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, func
from app.database import Base


class Signal(Base):
    __tablename__ = "signals"

    id = Column(Integer, primary_key=True, index=True)
    strategy_id = Column(Integer, ForeignKey("strategies.id"), nullable=True)
    symbol = Column(String, nullable=False)
    market = Column(String, default="crypto")
    signal_type = Column(String, nullable=False)
    confidence = Column(Float, default=0.0)
    price_at_signal = Column(Float, nullable=True)
    reasoning = Column(String, nullable=True)
    acted_on = Column(String, default="PENDING")
    created_at = Column(DateTime, server_default=func.now())
