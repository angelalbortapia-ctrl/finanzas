"""Portfolio value history tracking."""
from __future__ import annotations

from datetime import date

from app.database import get_db


def record_portfolio_snapshot(market_value: float, invested: float, pnl: float, return_pct: float) -> None:
    today = date.today().isoformat()
    conn = get_db()
    conn.execute(
        """INSERT INTO portfolio_history (recorded_at, market_value, invested, pnl, return_pct)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(recorded_at) DO UPDATE SET
             market_value=excluded.market_value,
             invested=excluded.invested,
             pnl=excluded.pnl,
             return_pct=excluded.return_pct""",
        (today, market_value, invested, pnl, return_pct),
    )
    conn.commit()
    conn.close()


def get_portfolio_history(limit: int = 90) -> list[dict]:
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM portfolio_history ORDER BY recorded_at DESC LIMIT ?",
        (limit,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in reversed(rows)]


def seed_history_if_empty(market_value: float, invested: float, pnl: float, return_pct: float) -> None:
    conn = get_db()
    count = conn.execute("SELECT COUNT(*) AS n FROM portfolio_history").fetchone()["n"]
    conn.close()
    if count == 0:
        record_portfolio_snapshot(market_value, invested, pnl, return_pct)
