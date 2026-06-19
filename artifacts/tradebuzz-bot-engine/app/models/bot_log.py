from sqlalchemy import Column, Integer, String, DateTime, Text, func
from app.database import Base


class BotLog(Base):
    __tablename__ = "bot_logs"

    id = Column(Integer, primary_key=True, index=True)
    level = Column(String, default="INFO")
    event = Column(String, nullable=False)
    message = Column(Text, nullable=True)
    symbol = Column(String, nullable=True)
    strategy = Column(String, nullable=True)
    extra = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
