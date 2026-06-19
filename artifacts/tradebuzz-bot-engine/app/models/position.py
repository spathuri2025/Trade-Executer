from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, ForeignKey, func
from app.database import Base


class Position(Base):
    __tablename__ = "positions"

    id = Column(Integer, primary_key=True, index=True)
    trade_id = Column(Integer, ForeignKey("trades.id"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    symbol = Column(String, nullable=False)
    direction = Column(String, nullable=False)
    quantity = Column(Float, nullable=True)
    entry_price = Column(Float, nullable=True)
    current_price = Column(Float, nullable=True)
    unrealised_pnl = Column(Float, default=0.0)
    is_open = Column(Boolean, default=True)
    is_paper = Column(Boolean, default=True)
    opened_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
