from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, func
from app.database import Base


class ApiKeyMetadata(Base):
    __tablename__ = "api_keys_metadata"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    broker = Column(String, nullable=False)
    label = Column(String, nullable=True)
    key_reference = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    last_verified_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    class Config:
        comment = "Stores metadata only. Real API keys must be stored as environment variables, never in the database."
