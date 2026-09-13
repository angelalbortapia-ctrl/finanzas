"""PIN opcional para proteger la app en red local."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Callable

from fastapi import Request
from fastapi.responses import JSONResponse, RedirectResponse

from app.config import FINANZAS_PIN

COOKIE_NAME = "finanzas_auth"
LOGIN_PATH = "/login"

# Rutas siempre públicas (sin PIN)
PUBLIC_PREFIXES = (
    "/static/",
    "/health",
    "/manifest.webmanifest",
    "/offline",
    "/login",
)


def pin_enabled() -> bool:
    return bool(FINANZAS_PIN)


def safe_next(path: str) -> str:
    if not path or not path.startswith("/") or path.startswith("//") or path.startswith("/\\"):
        return "/"
    return path


def _is_public(path: str) -> bool:
    return any(path.startswith(p) for p in PUBLIC_PREFIXES)


def _needs_json_auth(path: str) -> bool:
    return path.startswith("/api/") or path.startswith("/exportar/")


def make_session_token() -> str:
    if not FINANZAS_PIN:
        return ""
    nonce = secrets.token_hex(16)
    sig = hmac.new(FINANZAS_PIN.encode(), nonce.encode(), hashlib.sha256).hexdigest()
    return f"{nonce}.{sig}"


def verify_session_token(token: str | None) -> bool:
    if not pin_enabled() or not token:
        return False
    # Compatibilidad con cookies antiguas (PIN en texto plano)
    if token == FINANZAS_PIN:
        return True
    try:
        nonce, sig = token.rsplit(".", 1)
    except ValueError:
        return False
    expected = hmac.new(FINANZAS_PIN.encode(), nonce.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, expected)


def _cookie_ok(request: Request) -> bool:
    if not pin_enabled():
        return True
    return verify_session_token(request.cookies.get(COOKIE_NAME))


def check_pin(pin: str) -> bool:
    if not pin_enabled():
        return False
    try:
        return hmac.compare_digest(pin, FINANZAS_PIN)
    except (TypeError, ValueError):
        return False


async def pin_middleware(request: Request, call_next: Callable):
    path = request.url.path
    if not pin_enabled() or _is_public(path):
        return await call_next(request)
    if _cookie_ok(request):
        return await call_next(request)
    if _needs_json_auth(path):
        return JSONResponse({"detail": "No autorizado"}, status_code=401)
    return RedirectResponse(
        f"{LOGIN_PATH}?next={path}&reason=auth",
        status_code=303,
    )
