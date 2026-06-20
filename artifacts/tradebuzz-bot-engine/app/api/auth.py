from fastapi import Header, HTTPException, Request, status

from app.api.session import SESSION_COOKIE_NAME, verify_session_token
from app.config import get_settings

settings = get_settings()


def _dashboard_password() -> str:
    """Password the dashboard logs in with. Falls back to the admin API key."""
    return settings.DASHBOARD_PASSWORD or settings.ADMIN_API_KEY


def require_api_key(request: Request, x_api_key: str | None = Header(default=None)):
    """Allow access via either a valid admin API key header or a dashboard session cookie."""
    if x_api_key is not None and x_api_key == settings.ADMIN_API_KEY:
        return
    cookie = request.cookies.get(SESSION_COOKIE_NAME)
    if verify_session_token(cookie):
        return
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
    )
