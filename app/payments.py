"""Payment due dates and calendar helpers."""
from __future__ import annotations

import calendar
from datetime import date
from typing import Optional


def _safe_day(year: int, month: int, day: int) -> int:
    return min(max(1, day), calendar.monthrange(year, month)[1])


def next_due_date(due_day: Optional[int], ref: Optional[date] = None) -> Optional[date]:
    if not due_day:
        return None
    today = ref or date.today()
    y, m = today.year, today.month
    candidate = date(y, m, _safe_day(y, m, due_day))
    if candidate < today:
        m += 1
        if m > 12:
            m, y = 1, y + 1
        candidate = date(y, m, _safe_day(y, m, due_day))
    return candidate


def days_until(due_day: Optional[int], ref: Optional[date] = None) -> Optional[int]:
    nxt = next_due_date(due_day, ref)
    if not nxt:
        return None
    today = ref or date.today()
    return (nxt - today).days


def urgency(days: Optional[int]) -> str:
    if days is None:
        return "none"
    if days <= 3:
        return "urgent"
    if days <= 7:
        return "soon"
    return "ok"
