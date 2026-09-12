"""Unified net-worth and month-close logic."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from app.database import get_db

_MONTH_NAMES = [
    "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]


def _card_debt(conn) -> float:
    row = conn.execute("""
        SELECT COALESCE(SUM(cc.amount), 0) AS balance
        FROM credit_cards c
        LEFT JOIN card_categories cc ON cc.card_id = c.id
    """).fetchone()
    return float(row["balance"]) if row else 0.0


def _investment_snapshot(conn) -> dict | None:
    row = conn.execute(
        "SELECT * FROM investment_snapshot ORDER BY id DESC LIMIT 1"
    ).fetchone()
    return dict(row) if row else None


def _latest_patrimony_row(conn) -> dict | None:
    row = conn.execute(
        "SELECT * FROM patrimony ORDER BY year DESC, month DESC LIMIT 1"
    ).fetchone()
    return dict(row) if row else None


def compute_live_finances(conn=None) -> dict:
    """Single source of truth: live GBM + patrimony assets − live card debt."""
    own_conn = conn is None
    if own_conn:
        conn = get_db()

    card_debt = _card_debt(conn)
    inv = _investment_snapshot(conn)
    gbm_live = float(inv["market_value"]) if inv else 0.0

    latest = _latest_patrimony_row(conn)
    afore = float(latest["afore"]) if latest else 0.0
    infonavit = float(latest["infonavit"]) if latest else 0.0
    ppr = float(latest["ppr"]) if latest else 0.0
    business = float(latest["business"]) if latest else 0.0

    gbm_asset = gbm_live if inv is not None else (float(latest["gbm"]) if latest else 0.0)
    total_assets = gbm_asset + afore + infonavit + ppr + business
    unified_net = total_assets - card_debt

    if own_conn:
        conn.close()

    return {
        "gbm_live": gbm_asset,
        "afore": afore,
        "infonavit": infonavit,
        "ppr": ppr,
        "business": business,
        "total_assets": total_assets,
        "card_debt": card_debt,
        "unified_net": unified_net,
        "investment_snapshot": inv,
    }


def enrich_patrimony_row(row: dict, live: dict | None = None) -> dict:
    """Normalize a patrimony DB row for display (historical snapshots)."""
    gbm = float(row.get("gbm") or 0)
    ppr = float(row.get("ppr") or 0)
    business = float(row.get("business") or 0)
    afore = float(row.get("afore") or 0)
    infonavit = float(row.get("infonavit") or 0)

    card_debt = row.get("card_debt")
    if card_debt is not None:
        debt = float(card_debt)
    else:
        debt = float(row.get("debt") or 0)

    assets = gbm + ppr + business + afore + infonavit
    net = row.get("net_worth")
    net_worth = float(net) if net is not None else assets - debt

    return {
        **row,
        "month_name": _MONTH_NAMES[row["month"]],
        "label": f"{_MONTH_NAMES[row['month']]} {row['year']}",
        "assets": assets,
        "debt": debt,
        "card_debt": debt,
        "net_worth": net_worth,
        "is_closed": bool(row.get("closed_at")),
    }


def get_patrimony_history(conn=None) -> list[dict]:
    own_conn = conn is None
    if own_conn:
        conn = get_db()
    rows = conn.execute("SELECT * FROM patrimony ORDER BY year, month").fetchall()
    if own_conn:
        conn.close()
    return [enrich_patrimony_row(dict(r)) for r in rows]


def net_change_from_history(history: list[dict]) -> float | None:
    if len(history) < 2:
        return None
    return history[-1]["net_worth"] - history[-2]["net_worth"]


def close_month(year: int | None = None, month: int | None = None) -> dict:
    """Snapshot current live finances into patrimony for the given month."""
    today = date.today()
    year = year or today.year
    month = month or today.month

    conn = get_db()
    live = compute_live_finances(conn)
    latest = _latest_patrimony_row(conn)

    afore = float(latest["afore"]) if latest else 0.0
    infonavit = float(latest["infonavit"]) if latest else 0.0
    ppr = float(latest["ppr"]) if latest else 0.0
    business = float(latest["business"]) if latest else 0.0

    card_debt = live["card_debt"]
    net_worth = live["unified_net"]
    closed_at = datetime.now().isoformat(timespec="seconds")

    conn.execute(
        """INSERT INTO patrimony
           (year, month, gbm, ppr, business, afore, infonavit, debt, card_debt, net_worth, closed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(year, month) DO UPDATE SET
             gbm=excluded.gbm, ppr=excluded.ppr, business=excluded.business,
             afore=excluded.afore, infonavit=excluded.infonavit,
             debt=excluded.debt, card_debt=excluded.card_debt,
             net_worth=excluded.net_worth, closed_at=excluded.closed_at""",
        (
            year, month, live["gbm_live"], ppr, business, afore, infonavit,
            card_debt, card_debt, net_worth, closed_at,
        ),
    )
    conn.commit()
    conn.close()

    return {
        "year": year,
        "month": month,
        "label": f"{_MONTH_NAMES[month]} {year}",
        "net_worth": net_worth,
        "card_debt": card_debt,
        "closed_at": closed_at,
    }


def _month_goals_row(conn, year: int, month: int) -> dict:
    row = conn.execute(
        "SELECT payment_goal, savings_goal FROM monthly_goals WHERE year = ? AND month = ?",
        (year, month),
    ).fetchone()
    if not row:
        return {"payment_goal": 0.0, "savings_goal": 0.0}
    return {
        "payment_goal": float(row["payment_goal"] or 0),
        "savings_goal": float(row["savings_goal"] or 0),
    }


def get_payment_goal(year: int | None = None, month: int | None = None) -> float:
    today = date.today()
    year = year or today.year
    month = month or today.month
    conn = get_db()
    goals = _month_goals_row(conn, year, month)
    conn.close()
    return goals["payment_goal"]


def get_savings_goal(year: int | None = None, month: int | None = None) -> float:
    today = date.today()
    year = year or today.year
    month = month or today.month
    conn = get_db()
    goals = _month_goals_row(conn, year, month)
    conn.close()
    return goals["savings_goal"]


def set_payment_goal(amount: float, year: int | None = None, month: int | None = None) -> float:
    today = date.today()
    year = year or today.year
    month = month or today.month
    conn = get_db()
    conn.execute(
        """INSERT INTO monthly_goals (year, month, payment_goal, savings_goal) VALUES (?, ?, ?, 0)
           ON CONFLICT(year, month) DO UPDATE SET payment_goal = excluded.payment_goal""",
        (year, month, max(0.0, amount)),
    )
    conn.commit()
    conn.close()
    return amount


def set_savings_goal(amount: float, year: int | None = None, month: int | None = None) -> float:
    today = date.today()
    year = year or today.year
    month = month or today.month
    conn = get_db()
    conn.execute(
        """INSERT INTO monthly_goals (year, month, payment_goal, savings_goal) VALUES (?, ?, 0, ?)
           ON CONFLICT(year, month) DO UPDATE SET savings_goal = excluded.savings_goal""",
        (year, month, max(0.0, amount)),
    )
    conn.commit()
    conn.close()
    return amount


def get_gbm_month_progress(conn=None) -> float:
    """GBM market value gained since the first snapshot of the current month."""
    today = date.today()
    month_start = f"{today.year}-{today.month:02d}-01"
    own = conn is None
    if own:
        conn = get_db()
    start_row = conn.execute(
        """SELECT market_value FROM portfolio_history
           WHERE date(recorded_at) >= date(?) ORDER BY recorded_at ASC LIMIT 1""",
        (month_start,),
    ).fetchone()
    snap = conn.execute(
        "SELECT market_value FROM investment_snapshot ORDER BY id DESC LIMIT 1"
    ).fetchone()
    if own:
        conn.close()
    if not start_row or not snap:
        return 0.0
    return max(0.0, float(snap["market_value"] or 0) - float(start_row["market_value"] or 0))


def month_close_status(conn=None) -> dict:
    """Whether the current month needs a patrimony close and if we should remind."""
    today = date.today()
    own = conn is None
    if own:
        conn = get_db()
    row = conn.execute(
        "SELECT closed_at FROM patrimony WHERE year = ? AND month = ?",
        (today.year, today.month),
    ).fetchone()
    if own:
        conn.close()
    closed = bool(row and row["closed_at"])
    days_left = (date(today.year, today.month, 1) + timedelta(days=32)).replace(day=1) - today
    days_left = days_left.days
    return {
        "closed": closed,
        "needs_close": not closed,
        "remind": not closed and (today.day >= 25 or days_left <= 5),
        "days_left": days_left,
        "month": today.month,
        "year": today.year,
        "label": f"{_MONTH_NAMES[today.month]} {today.year}",
    }
