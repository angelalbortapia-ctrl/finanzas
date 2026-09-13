"""PIN opcional para proteger escrituras en red local."""

from __future__ import annotations

from typing import Callable

from fastapi import Request
from fastapi.responses import RedirectResponse

from app.config import FINANZAS_PIN

COOKIE_NAME = "finanzas_auth"
LOGIN_PATH = "/login"

# Lectura pública sin PIN
PUBLIC_PREFIXES = (
    "/static/",
    "/health",
    "/manifest.webmanifest",
    "/offline",
    "/login",
    "/api/terminal/",
    "/api/bolsa-ticker",
    "/api/pagos-proximos",
    "/api/meta-pago",
    "/api/meta-ahorro",
    "/api/widgets",
    "/exportar/",
)


def pin_enabled() -> bool:
    return bool(FINANZAS_PIN)


def _is_public(path: str) -> bool:
    if path == "/":
        return True
    return any(path.startswith(p) for p in PUBLIC_PREFIXES)


def _cookie_ok(request: Request) -> bool:
    if not pin_enabled():
        return True
    return request.cookies.get(COOKIE_NAME) == FINANZAS_PIN


def check_pin(pin: str) -> bool:
    return pin_enabled() and pin == FINANZAS_PIN


async def pin_middleware(request: Request, call_next: Callable):
    if not pin_enabled() or _is_public(request.url.path):
        return await call_next(request)
    if request.method == "GET":
        return await call_next(request)
    if _cookie_ok(request):
        return await call_next(request)
    return RedirectResponse(f"{LOGIN_PATH}?next={request.url.path}&reason=auth", status_code=303)
