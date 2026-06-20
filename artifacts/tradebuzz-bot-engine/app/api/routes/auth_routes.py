from fastapi import APIRouter, Request, Response
from pydantic import BaseModel

from app.api.auth import _dashboard_password
from app.api.session import (
    SESSION_COOKIE_NAME,
    SESSION_MAX_AGE,
    create_session_token,
    verify_session_token,
)

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    password: str


@router.post("/login")
def login(body: LoginRequest, response: Response):
    if body.password != _dashboard_password():
        return Response(status_code=401, content="Incorrect password")
    token = create_session_token()
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=True,
        path="/",
    )
    return {"ok": True}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me")
def me(request: Request):
    cookie = request.cookies.get(SESSION_COOKIE_NAME)
    return {"authenticated": verify_session_token(cookie)}
