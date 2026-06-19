from sqlalchemy import Column, Integer, Boolean, String, DateTime, func
from app.database import Base


class EmergencyStop(Base):
    __tablename__ = "emergency_stop"

    id = Column(Integer, primary_key=True, index=True)
    is_active = Column(Boolean, default=False)
    reason = Column(String, nullable=True)
    triggered_at = Column(DateTime, nullable=True)
    cleared_at = Column(DateTime, nullable=True)
    triggered_by = Column(String, default="system")
    created_at = Column(DateTime, server_default=func.now())
