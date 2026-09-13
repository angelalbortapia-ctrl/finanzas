"""Ejecutar trabajo bloqueante sin congelar el event loop."""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from typing import Callable, TypeVar

T = TypeVar("T")

_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="finanzas")


async def run_blocking(func: Callable[..., T], *args, **kwargs) -> T:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_EXECUTOR, partial(func, *args, **kwargs))
