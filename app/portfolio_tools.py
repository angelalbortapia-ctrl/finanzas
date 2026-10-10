"""Alertas de precio y análisis del portafolio sobre cotizaciones en vivo."""

from __future__ import annotations

import logging
import subprocess
import sys
from typing import Any

from app.catalog import get_symbol_meta
from app.database import get_db
from app.emisora_analysis import page_symbol_allowed
from app.terminal import _now, _safe_float, get_live_quotes, get_portfolio_live

logger = logging.getLogger(__name__)

BENCHMARK_SYMBOL = "IPC"

# target = precio para above/below; porcentaje para el resto
ALERT_KINDS = {
    "above": "precio sube de",
    "below": "precio baja de",
    "day_up": "sube en el día más de %",
    "day_down": "cae en el día más de %",
    "cost_drop": "cae debajo de tu costo más de %",
}
_PCT_KINDS = {"day_up", "day_down", "cost_drop"}


def _norm(symbol: str) -> str:
    return (symbol or "").replace("BMV:", "").strip().upper()


def list_price_alerts(include_recent: bool = True) -> list[dict]:
    conn = get_db()
    rows = conn.execute(
        """SELECT id, symbol, direction, target, created_at, triggered_at, trigger_price, active
           FROM price_alerts
           WHERE active = 1
              OR (? AND triggered_at IS NOT NULL)
           ORDER BY active DESC, id DESC
           LIMIT 40""",
        (1 if include_recent else 0,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def active_alert_symbols() -> list[str]:
    conn = get_db()
    rows = conn.execute(
        "SELECT DISTINCT symbol FROM price_alerts WHERE active = 1"
    ).fetchall()
    conn.close()
    return [r["symbol"] for r in rows]


def create_price_alert(symbol: str, direction: str, target: float) -> dict:
    sym = _norm(symbol)
    if not sym:
        raise ValueError("Falta el símbolo")
    kind = (direction or "").strip().lower()
    if kind not in ALERT_KINDS:
        raise ValueError("Tipo de alerta no válido")
    value = float(target)
    if value <= 0:
        raise ValueError("El nivel debe ser mayor a cero")
    if kind in _PCT_KINDS and value >= 100:
        raise ValueError("El porcentaje debe ser menor a 100")
    if not get_symbol_meta(sym):
        raise ValueError(f"Símbolo no reconocido: {sym}")
    if kind == "cost_drop" and _avg_costs([sym]).get(sym) is None:
        raise ValueError(f"No tienes posición en {sym} para comparar contra tu costo")
    conn = get_db()
    cur = conn.execute(
        """INSERT INTO price_alerts (symbol, direction, target, created_at, active)
           VALUES (?, ?, ?, ?, 1)""",
        (sym, kind, value, _now()),
    )
    conn.commit()
    row_id = cur.lastrowid
    conn.close()
    return {"id": row_id, "symbol": sym, "direction": kind, "target": value, "active": 1}


def delete_price_alert(alert_id: int) -> bool:
    conn = get_db()
    cur = conn.execute("DELETE FROM price_alerts WHERE id = ?", (alert_id,))
    conn.commit()
    ok = cur.rowcount > 0
    conn.close()
    return ok


def list_watchlist() -> list[dict]:
    conn = get_db()
    rows = conn.execute(
        """SELECT symbol, name, created_at FROM watchlist_symbols
           ORDER BY sort_order ASC, created_at ASC"""
    ).fetchall()
    conn.close()
    out: list[dict] = []
    for r in rows:
        sym = r["symbol"]
        meta = get_symbol_meta(sym) or {}
        out.append({
            "symbol": sym,
            "name": r["name"] or meta.get("name") or sym,
            "board": meta.get("board"),
            "kind": meta.get("kind"),
            "created_at": r["created_at"],
        })
    return out


def watchlist_symbols() -> list[str]:
    return [i["symbol"] for i in list_watchlist()]


def add_watchlist_symbol(symbol: str, name: str | None = None) -> dict:
    sym = _norm(symbol)
    if not sym:
        raise ValueError("Falta el símbolo")
    if not page_symbol_allowed(sym):
        raise ValueError(f"Símbolo no válido: {sym}")
    meta = get_symbol_meta(sym) or {}
    display = (name or meta.get("name") or sym).strip()
    conn = get_db()
    conn.execute(
        """INSERT INTO watchlist_symbols (symbol, name, created_at, sort_order)
           VALUES (
             ?, ?, ?,
             COALESCE((SELECT MAX(sort_order) + 1 FROM watchlist_symbols), 0)
           )
           ON CONFLICT(symbol) DO UPDATE SET name = excluded.name""",
        (sym, display, _now()),
    )
    conn.commit()
    conn.close()
    return {
        "symbol": sym,
        "name": display,
        "board": meta.get("board"),
        "kind": meta.get("kind"),
    }


def remove_watchlist_symbol(symbol: str) -> bool:
    sym = _norm(symbol)
    if not sym:
        return False
    conn = get_db()
    cur = conn.execute("DELETE FROM watchlist_symbols WHERE symbol = ?", (sym,))
    conn.commit()
    ok = cur.rowcount > 0
    conn.close()
    return ok


def _avg_costs(symbols: list[str]) -> dict[str, float]:
    if not symbols:
        return {}
    conn = get_db()
    rows = conn.execute(
        "SELECT ticker, avg_cost FROM investment_holdings WHERE shares > 0"
    ).fetchall()
    conn.close()
    wanted = set(symbols)
    out: dict[str, float] = {}
    for r in rows:
        sym = _norm(r["ticker"])
        cost = _safe_float(r["avg_cost"])
        if sym in wanted and cost:
            out[sym] = cost
    return out


def _alert_crossed(kind: str, target: float, quote: dict, avg_cost: float | None) -> bool:
    px = _safe_float(quote.get("price"))
    if px is None:
        return False
    if kind == "above":
        return px >= target
    if kind == "below":
        return px <= target
    if kind == "day_up":
        return (_safe_float(quote.get("change_pct")) or 0) >= target
    if kind == "day_down":
        return (_safe_float(quote.get("change_pct")) or 0) <= -target
    if kind == "cost_drop" and avg_cost:
        return px <= avg_cost * (1 - target / 100)
    return False


def evaluate_price_alerts(quotes: dict) -> list[dict]:
    """Marca alertas activas que se cumplen y las devuelve una sola vez."""
    if not quotes:
        return []
    conn = get_db()
    rows = conn.execute(
        "SELECT id, symbol, direction, target FROM price_alerts WHERE active = 1"
    ).fetchall()
    costs = _avg_costs([r["symbol"] for r in rows if r["direction"] == "cost_drop"])
    hit: list[dict] = []
    now = _now()
    for row in rows:
        sym = row["symbol"]
        q = quotes.get(sym) or quotes.get(f"BMV:{sym}")
        if not isinstance(q, dict):
            continue
        if not _alert_crossed(row["direction"], row["target"], q, costs.get(sym)):
            continue
        px = _safe_float(q.get("price"))
        cur = conn.execute(
            """UPDATE price_alerts
               SET active = 0, triggered_at = ?, trigger_price = ?
               WHERE id = ? AND active = 1""",
            (now, px, row["id"]),
        )
        if cur.rowcount:
            hit.append({
                "id": row["id"],
                "symbol": sym,
                "direction": row["direction"],
                "target": row["target"],
                "price": px,
                "change_pct": _safe_float(q.get("change_pct")),
            })
    if hit:
        conn.commit()
    conn.close()
    return hit


def alert_message(hit: dict) -> str:
    sym = hit["symbol"]
    px = hit.get("price")
    px_txt = f"${px:,.2f}" if px is not None else "—"
    kind = hit["direction"]
    t = hit["target"]
    if kind == "above":
        return f"{sym} subió de ${t:,.2f} · ahora {px_txt}"
    if kind == "below":
        return f"{sym} bajó de ${t:,.2f} · ahora {px_txt}"
    if kind == "day_up":
        return f"{sym} sube más de {t:g}% hoy · {px_txt}"
    if kind == "day_down":
        return f"{sym} cae más de {t:g}% hoy · {px_txt}"
    return f"{sym} está {t:g}% o más debajo de tu costo · {px_txt}"


def notify_macos(message: str, title: str = "Finanzas") -> None:
    if sys.platform != "darwin":
        return
    try:
        subprocess.run(
            [
                "osascript",
                "-e", "on run argv",
                "-e", "display notification (item 1 of argv) with title (item 2 of argv) sound name \"Glass\"",
                "-e", "end run",
                message,
                title,
            ],
            check=False,
            timeout=5,
            capture_output=True,
        )
    except Exception as exc:
        logger.debug("notification failed: %s", exc)


def check_alerts_now() -> list[dict]:
    """Ciclo del servidor: cotiza solo lo que tiene alertas activas y avisa."""
    symbols = active_alert_symbols()
    if not symbols:
        return []
    quotes = get_live_quotes(symbols)
    hits = evaluate_price_alerts(quotes)
    for h in hits:
        notify_macos(alert_message(h))
    return hits


def get_portfolio_analytics() -> dict[str, Any]:
    """Ganancia del día, contra el IPC, concentración y neto de comisiones."""
    port = get_portfolio_live()
    holdings = port.get("holdings") or []
    if not holdings:
        return {"has_positions": False}

    symbols = [h["symbol"] for h in holdings]
    quotes = get_live_quotes([*symbols, BENCHMARK_SYMBOL])

    day_pnl = 0.0
    prev_value = 0.0
    live_value = 0.0
    movers: list[dict] = []
    priced = 0
    for h in holdings:
        shares = float(h.get("shares") or 0)
        q = quotes.get(h["symbol"]) or {}
        px = _safe_float(q.get("price"))
        prev = _safe_float(q.get("prev_close"))
        if px is None or prev is None or shares <= 0:
            live_value += float(h.get("market_value") or 0)
            continue
        priced += 1
        pnl = shares * (px - prev)
        day_pnl += pnl
        prev_value += shares * prev
        live_value += shares * px
        movers.append({
            "symbol": h["symbol"],
            "day_pnl": round(pnl, 2),
            "change_pct": round(_safe_float(q.get("change_pct")) or 0, 2),
        })

    day_pct = (day_pnl / prev_value * 100) if prev_value else None
    bench = quotes.get(BENCHMARK_SYMBOL) or {}
    bench_pct = _safe_float(bench.get("change_pct"))
    alpha = (day_pct - bench_pct) if day_pct is not None and bench_pct is not None else None

    total_mv = sum(float(h.get("market_value") or 0) for h in holdings)
    weights = sorted(
        ((h["symbol"], (float(h.get("market_value") or 0) / total_mv) if total_mv else 0) for h in holdings),
        key=lambda x: x[1],
        reverse=True,
    )
    hhi = sum(w * w for _, w in weights)
    snap = port.get("snapshot") or {}

    movers.sort(key=lambda m: m["day_pnl"])
    return {
        "has_positions": True,
        "priced": priced,
        "positions": len(holdings),
        "day_pnl": round(day_pnl, 2),
        "day_pct": round(day_pct, 2) if day_pct is not None else None,
        "benchmark": BENCHMARK_SYMBOL,
        "benchmark_pct": round(bench_pct, 2) if bench_pct is not None else None,
        "alpha_pct": round(alpha, 2) if alpha is not None else None,
        "live_value": round(live_value, 2),
        "best": movers[-1] if movers else None,
        "worst": movers[0] if movers else None,
        "top_symbol": weights[0][0] if weights else None,
        "top_weight_pct": round(weights[0][1] * 100, 1) if weights else None,
        "top3_weight_pct": round(sum(w for _, w in weights[:3]) * 100, 1),
        "effective_positions": round(1 / hhi, 1) if hhi else None,
        "net_pnl": round(float(snap.get("net_pnl") or 0), 2),
        "net_return_pct": round(float(snap.get("net_return_pct") or 0), 2),
        "gross_return_pct": round(float(snap.get("return_pct") or 0), 2),
    }
