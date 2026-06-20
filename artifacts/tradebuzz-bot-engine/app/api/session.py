"""
Lightweight signed-cookie session helpers for the dashboard login.

Uses HMAC-SHA256 over the payload with SESSION_SECRET so we don't need an
external dependency. Tokens are stateless and carry an expiry timestamp.
"""
import base64
import hashlib
import hmac
import json
import time

from app.config import get_settings

settings = get_settings()

SESSION_COOKIE_NAME = "tb_session"
SESSION_MAX_AGE = 60 * 60 * 24 * 7  # 7 days


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def _sign(payload_b64: str) -> str:
    signature = hmac.new(
        settings.SESSION_SECRET.encode("utf-8"),
        payload_b64.encode("ascii"),
        hashlib.sha256,
    ).digest()
    return _b64encode(signature)


def create_session_token(subject: str = "dashboard") -> str:
    payload = {"sub": subject, "exp": int(time.time()) + SESSION_MAX_AGE}
    payload_b64 = _b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    return f"{payload_b64}.{_sign(payload_b64)}"


def verify_session_token(token: str | None) -> bool:
    if not token or "." not in token:
        return False
    payload_b64, signature = token.rsplit(".", 1)
    expected = _sign(payload_b64)
    if not hmac.compare_digest(expected, signature):
        return False
    try:
        payload = json.loads(_b64decode(payload_b64))
    except (ValueError, json.JSONDecodeError):
        return False
    return int(payload.get("exp", 0)) > int(time.time())
