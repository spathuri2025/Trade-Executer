from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, func
from app.database import Base


class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)
    trade_id = Column(Integer, ForeignKey("trades.id"), nullable=True)
    broker_order_id = Column(String, nullable=True)
    symbol = Column(String, nullable=False)
    order_type = Column(String, default="MARKET")
    direction = Column(String, nullable=False)
    quantity = Column(Float, nullable=True)
    price = Column(Float, nullable=True)
    status = Column(String, default="PENDING")
    mode = Column(String, default="PAPER")
    error_message = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
