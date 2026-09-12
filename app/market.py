"""Market data layer: Yahoo primary, optional Finnhub fallback, SQLite cache."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Iterable

from app.catalog import bmv_to_yahoo
from app.config import FINNHUB_API_KEY
from app.database import get_db
from app.history import record_portfolio_snapshot

CACHE_TTL_MINUTES = int(os.environ.get("FINANZAS_PRICE_CACHE_MIN", "30"))


def _holding_ticker_key(ticker: str) -> str:
    t = (ticker or "").strip().upper()
    return t if t.startswith("BMV:") else f"BMV:{t.replace('BMV:', '')}"

SOURCE_LABELS = {
    "yahoo": "Yahoo Finance",
    "finnhub": "Finnhub",
    "cache": "Caché",
    "excel": "Excel GBM",
    "google": "Google Sheets",
    "mixed": "Mixto",
}


@dataclass
class Quote:
    ticker: str
    price: float
    source: str
    fetched_at: str
    stale: bool = False


def source_label(source: str | None) -> str:
    if not source:
        return "Sin datos"
    return SOURCE_LABELS.get(source, source.capitalize())


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _is_fresh(fetched_at: str | None, ttl_minutes: int = CACHE_TTL_MINUTES) -> bool:
    if not fetched_at:
        return False
    try:
        ts = datetime.fromisoformat(fetched_at)
    except ValueError:
        return False
    return datetime.now() - ts < timedelta(minutes=ttl_minutes)


def _read_cache(conn, ticker: str) -> Quote | None:
    row = conn.execute(
        "SELECT ticker, price, source, fetched_at FROM price_cache WHERE ticker = ?",
        (ticker,),
    ).fetchone()
    if not row:
        return None
    return Quote(
        ticker=row["ticker"],
        price=float(row["price"]),
        source=row["source"] if row["source"] != "cache" else "cache",
        fetched_at=row["fetched_at"],
        stale=not _is_fresh(row["fetched_at"]),
    )


def _write_cache(conn, quote: Quote) -> None:
    conn.execute(
        """INSERT INTO price_cache (ticker, price, source, fetched_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(ticker) DO UPDATE SET
             price=excluded.price, source=excluded.source, fetched_at=excluded.fetched_at""",
        (quote.ticker, quote.price, quote.source, quote.fetched_at),
    )


def _yahoo_batch(symbols: list[str]) -> dict[str, float]:
    import yfinance as yf

    if not symbols:
        return {}
    data = yf.download(symbols, period="1d", progress=False, threads=True)
    prices: dict[str, float] = {}
    if len(symbols) == 1:
        sym = symbols[0]
        try:
            close = data["Close"].iloc[-1]
            if close == close:
                prices[sym] = float(close)
        except (IndexError, KeyError, TypeError, AttributeError):
            pass
        return prices
    try:
        closes = data["Close"]
        for sym in symbols:
            if sym in closes.columns:
                val = closes[sym].iloc[-1]
                if val == val:
                    prices[sym] = float(val)
    except (KeyError, TypeError, AttributeError):
        pass
    return prices


def _yahoo_single(symbol: str) -> float | None:
    import yfinance as yf

    try:
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period="5d")
        if hist.empty:
            return None
        val = hist["Close"].iloc[-1]
        return float(val) if val == val else None
    except Exception:
        return None


def _finnhub_quote(symbol: str) -> float | None:
    if not FINNHUB_API_KEY:
        return None
    import urllib.error
    import urllib.request

    url = f"https://finnhub.io/api/v1/quote?symbol={symbol}&token={FINNHUB_API_KEY}"
    try:
        with urllib.request.urlopen(url, timeout=8) as resp:
            import json

            data = json.loads(resp.read().decode())
            price = data.get("c")
            if price and price > 0:
                return float(price)
    except (urllib.error.URLError, ValueError, KeyError, TypeError):
        return None
    return None


def _excel_fallback(conn, ticker: str) -> Quote | None:
    row = conn.execute(
        "SELECT market_price, updated_at, price_fetched_at, price_source FROM investment_holdings WHERE ticker = ?",
        (ticker,),
    ).fetchone()
    if not row or not row["market_price"]:
        return None
    src = row["price_source"] or "excel"
    if src not in ("excel", "google"):
        src = "excel"
    fetched = row["price_fetched_at"] or row["updated_at"] or _now()
    return Quote(
        ticker=ticker,
        price=float(row["market_price"]),
        source=src,
        fetched_at=fetched,
        stale=True,
    )


def fetch_quote(conn, ticker: str, force: bool = False) -> Quote | None:
    """Resolve one BMV ticker to a price quote."""
    if not force:
        cached = _read_cache(conn, ticker)
        if cached and not cached.stale:
            return cached

    ysym = bmv_to_yahoo(ticker)
    now = _now()
    price = None
    source = None

    batch = _yahoo_batch([ysym])
    price = batch.get(ysym)
    if price:
        source = "yahoo"
    else:
        price = _yahoo_single(ysym)
        if price:
            source = "yahoo"

    if price is None:
        price = _finnhub_quote(ysym)
        if price:
            source = "finnhub"

    if price is None:
        cached = _read_cache(conn, ticker)
        if cached:
            return Quote(cached.ticker, cached.price, "cache", cached.fetched_at, stale=True)

    if price is None:
        return _excel_fallback(conn, ticker)

    quote = Quote(ticker=ticker, price=price, source=source or "yahoo", fetched_at=now)
    _write_cache(conn, quote)
    return quote


def fetch_quotes(tickers: Iterable[str], force: bool = False) -> dict[str, Quote]:
    conn = get_db()
    try:
        return _fetch_quotes(conn, tickers, force)
    finally:
        conn.close()


def _fetch_quotes(conn, tickers: Iterable[str], force: bool = False) -> dict[str, Quote]:
    tickers = list(dict.fromkeys(tickers))
    results: dict[str, Quote] = {}
    now = _now()

    pending: list[str] = []
    if not force:
        for t in tickers:
            cached = _read_cache(conn, t)
            if cached and not cached.stale:
                results[t] = cached
            else:
                pending.append(t)
    else:
        pending = tickers

    if pending:
        pending_ysyms = [bmv_to_yahoo(t) for t in pending]
        batch_prices = _yahoo_batch(pending_ysyms)
        still_missing = []
        for ysym, t in zip(pending_ysyms, pending):
            price = batch_prices.get(ysym)
            if price:
                q = Quote(ticker=t, price=price, source="yahoo", fetched_at=now)
                _write_cache(conn, q)
                results[t] = q
            else:
                still_missing.append(t)

        for t in still_missing:
            ysym = bmv_to_yahoo(t)
            price = _yahoo_single(ysym)
            if price:
                q = Quote(ticker=t, price=price, source="yahoo", fetched_at=now)
                _write_cache(conn, q)
                results[t] = q
                continue
            price = _finnhub_quote(ysym)
            if price:
                q = Quote(ticker=t, price=price, source="finnhub", fetched_at=now)
                _write_cache(conn, q)
                results[t] = q
                continue
            cached = _read_cache(conn, t)
            if cached:
                results[t] = Quote(cached.ticker, cached.price, "cache", cached.fetched_at, stale=True)
                continue
            excel_q = _excel_fallback(conn, t)
            if excel_q:
                results[t] = excel_q

    conn.commit()
    return results


def _dominant_source(sources: list[str]) -> str:
    if not sources:
        return "excel"
    unique = set(sources)
    if len(unique) == 1:
        return sources[0]
    return "mixed"


def refresh_holdings(force: bool = False) -> dict:
    """Refresh all holding prices and portfolio snapshot."""
    conn = get_db()
    try:
        return _refresh_holdings(conn, force)
    finally:
        conn.close()


def _refresh_holdings(conn, force: bool = False) -> dict:
    holdings = conn.execute(
        "SELECT id, ticker, name, shares, avg_cost FROM investment_holdings WHERE shares > 0"
    ).fetchall()
    if not holdings:
        return {"updated": 0, "message": "Sin posiciones", "source": None}

    tickers = [h["ticker"] for h in holdings]
    quotes = fetch_quotes(tickers, force=force)

    now = _now()
    updated = 0
    total_market = 0.0
    total_invested = 0.0
    sources_used: list[str] = []
    latest_fetch = None

    for h in holdings:
        q = quotes.get(h["ticker"])
        cost_basis = h["avg_cost"] * h["shares"]
        total_invested += cost_basis

        if not q:
            row = conn.execute(
                "SELECT market_value FROM investment_holdings WHERE id = ?", (h["id"],)
            ).fetchone()
            if row:
                total_market += row["market_value"] or 0
            continue

        market_value = q.price * h["shares"]
        pnl = market_value - cost_basis
        total_market += market_value
        updated += 1
        sources_used.append(q.source)
        if not latest_fetch or q.fetched_at > latest_fetch:
            latest_fetch = q.fetched_at

        conn.execute(
            """UPDATE investment_holdings
               SET market_price = ?, market_value = ?, pnl = ?,
                   updated_at = ?, price_source = ?, price_fetched_at = ?
               WHERE id = ?""",
            (q.price, market_value, pnl, now, q.source, q.fetched_at, h["id"]),
        )
        conn.execute(
            """INSERT OR IGNORE INTO price_history (ticker, price, source, recorded_at)
               VALUES (?, ?, ?, ?)""",
            (h["ticker"], q.price, q.source, q.fetched_at),
        )

    portfolio_source = _dominant_source(sources_used)

    if total_market > 0:
        for h in holdings:
            row = conn.execute(
                "SELECT market_value FROM investment_holdings WHERE id = ?", (h["id"],)
            ).fetchone()
            if row and row["market_value"]:
                weight = row["market_value"] / total_market * 100
                conn.execute(
                    "UPDATE investment_holdings SET weight_pct = ? WHERE id = ?",
                    (weight, h["id"]),
                )

        pnl_total = total_market - total_invested
        return_pct = (pnl_total / total_invested * 100) if total_invested else 0
        conn.execute("DELETE FROM investment_snapshot")
        conn.execute(
            """INSERT INTO investment_snapshot
               (invested, market_value, cash, pnl, return_pct, updated_at, price_source, price_fetched_at)
               VALUES (?, ?, 0, ?, ?, ?, ?, ?)""",
            (total_invested, total_market, pnl_total, return_pct, now, portfolio_source, latest_fetch or now),
        )
        conn.execute(
            "INSERT INTO sync_log (source, status, message, synced_at) VALUES (?, ?, ?, ?)",
            ("market", "ok", f"{updated}/{len(holdings)} precios · {source_label(portfolio_source)}", now),
        )

    conn.commit()

    if total_market > 0:
        pnl_total = total_market - total_invested
        return_pct = (pnl_total / total_invested * 100) if total_invested else 0
        record_portfolio_snapshot(total_market, total_invested, pnl_total, return_pct)

    stale_count = sum(1 for s in sources_used if s in ("cache", "excel"))
    return {
        "updated": updated,
        "total": len(holdings),
        "market_value": total_market,
        "source": portfolio_source,
        "source_label": source_label(portfolio_source),
        "fetched_at": latest_fetch or now,
        "stale_count": stale_count,
        "message": f"{updated} precios actualizados ({source_label(portfolio_source)})",
    }


def refresh_prices(force: bool = False) -> dict:
    """Alias kept for routes and scripts."""
    return refresh_holdings(force=force)


def get_price_history(ticker: str, limit: int = 90) -> list[dict]:
    conn = get_db()
    key = _holding_ticker_key(ticker)
    alt = key.replace("BMV:", "")
    rows = conn.execute(
        """SELECT ticker, price, source, recorded_at
           FROM price_history WHERE ticker IN (?, ?)
           ORDER BY recorded_at DESC LIMIT ?""",
        (key, alt, limit),
    ).fetchall()
    conn.close()
    return [dict(r) for r in reversed(rows)]


def format_price_age(fetched_at: str | None) -> str:
    if not fetched_at:
        return "sin actualizar"
    try:
        ts = datetime.fromisoformat(fetched_at)
    except ValueError:
        return fetched_at[:16].replace("T", " ")
    delta = datetime.now() - ts
    minutes = int(delta.total_seconds() // 60)
    if minutes < 1:
        return "hace un momento"
    if minutes < 60:
        return f"hace {minutes} min"
    hours = minutes // 60
    if hours < 24:
        return f"hace {hours} h"
    return ts.strftime("%d/%m %H:%M")


def get_price_meta() -> dict:
    """Summary for UI: last source, time, freshness."""
    conn = get_db()
    snap = conn.execute(
        "SELECT price_source, price_fetched_at, updated_at FROM investment_snapshot ORDER BY id DESC LIMIT 1"
    ).fetchone()
    breakdown: dict[str, int] = {}
    rows = conn.execute(
        "SELECT price_source FROM investment_holdings WHERE shares > 0"
    ).fetchall()
    conn.close()

    for r in rows:
        src = r["price_source"] or "excel"
        breakdown[src] = breakdown.get(src, 0) + 1

    fetched_at = None
    source = "excel"
    if snap:
        source = snap["price_source"] or "excel"
        fetched_at = snap["price_fetched_at"] or snap["updated_at"]

    return {
        "source": source,
        "source_label": source_label(source),
        "fetched_at": fetched_at,
        "fetched_age": format_price_age(fetched_at),
        "fresh": _is_fresh(fetched_at),
        "breakdown": breakdown,
        "cache_ttl_minutes": CACHE_TTL_MINUTES,
    }
