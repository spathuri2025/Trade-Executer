import os
from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = os.environ.get("DATABASE_URL", "sqlite:///./tradebuzz.db")
    ADMIN_API_KEY: str = os.environ.get("ADMIN_API_KEY", "change-me-in-production")
    # Path prefix the engine is served under (behind the shared reverse proxy).
    BASE_PATH: str = os.environ.get("BASE_PATH", "/engine")
    # Password for the dashboard login. Falls back to the admin API key if unset.
    DASHBOARD_PASSWORD: str = os.environ.get("DASHBOARD_PASSWORD", "")
    # Secret used to sign dashboard session cookies.
    SESSION_SECRET: str = os.environ.get("SESSION_SECRET", "dev-insecure-session-secret")
    BOT_MODE: str = os.environ.get("BOT_MODE", "PAPER")
    LIVE_TRADING_ENABLED: bool = os.environ.get("LIVE_TRADING_ENABLED", "false").lower() == "true"
    BOT_CYCLE_INTERVAL: int = int(os.environ.get("BOT_CYCLE_INTERVAL", "60"))
    LOG_LEVEL: str = os.environ.get("LOG_LEVEL", "INFO")
    TELEGRAM_BOT_TOKEN: str = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    TELEGRAM_CHAT_ID: str = os.environ.get("TELEGRAM_CHAT_ID", "")
    EMAIL_SMTP_HOST: str = os.environ.get("EMAIL_SMTP_HOST", "")
    EMAIL_SMTP_PORT: int = int(os.environ.get("EMAIL_SMTP_PORT", "587"))
    EMAIL_SMTP_USER: str = os.environ.get("EMAIL_SMTP_USER", "")
    EMAIL_SMTP_PASSWORD: str = os.environ.get("EMAIL_SMTP_PASSWORD", "")
    EMAIL_FROM: str = os.environ.get("EMAIL_FROM", "")
    EMAIL_TO: str = os.environ.get("EMAIL_TO", "")

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
