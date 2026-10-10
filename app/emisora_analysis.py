"""Vista general de una emisora: factores clave, perfil, técnico, analistas y salud."""

from __future__ import annotations

import logging
import math
import re
import threading
import time
from datetime import datetime
from typing import Any

from app.catalog import get_symbol_meta, is_known_symbol, search_catalog
from app.terminal import MX_TZ, _dividend_yield_pct, _now, _safe_float

logger = logging.getLogger(__name__)

OVERVIEW_TTL_SEC = 15 * 60
SEARCH_TTL_SEC = 60 * 60
_SYMBOL_RE = re.compile(r"^[A-Z0-9&\-\.\*]{1,20}$")

_lock = threading.Lock()
_overview_cache: dict[str, tuple[float, dict]] = {}
_search_cache: dict[str, tuple[float, list]] = {}

RECOMMENDATION_ES = {
    "strong_buy": "Compra fuerte",
    "buy": "Compra",
    "hold": "Mantener",
    "underperform": "Bajo rendimiento",
    "sell": "Venta",
    "strong_sell": "Venta fuerte",
}

EXCHANGE_ES = {
    "MEX": "Bolsa Mexicana de Valores",
    "NMS": "NASDAQ",
    "NGM": "NASDAQ",
    "NCM": "NASDAQ",
    "NYQ": "NYSE",
    "ASE": "NYSE American",
    "PCX": "NYSE Arca",
}


def looks_like_symbol(symbol: str) -> bool:
    key = (symbol or "").strip().upper().replace("BMV:", "")
    return bool(key) and bool(_SYMBOL_RE.match(key))


def _cached(store: dict, key: str, ttl: float):
    with _lock:
        hit = store.get(key)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
    return None


def _store(store: dict, key: str, value, max_items: int = 64) -> None:
    with _lock:
        store[key] = (time.time(), value)
        if len(store) > max_items:
            oldest = min(store, key=lambda k: store[k][0])
            store.pop(oldest, None)


# ---------------------------------------------------------------- búsqueda

def _yahoo_to_local(quote: dict) -> dict | None:
    ysym = (quote.get("symbol") or "").upper()
    qtype = quote.get("quoteType")
    if qtype not in ("EQUITY", "ETF") or not ysym:
        return None
    exchange = quote.get("exchange") or ""
    if ysym.endswith(".MX"):
        sym = ysym[:-3]
        board = "bmv"
    elif "." in ysym or exchange not in EXCHANGE_ES:
        return None
    else:
        # Acción de EE.UU.: se opera en el SIC con el mismo ticker
        sym = ysym
        board = "sic"
    return {
        "symbol": sym,
        "name": quote.get("longname") or quote.get("shortname") or sym,
        "board": board,
        "board_title": "SIC" if board == "sic" else "BMV",
        "exchange": EXCHANGE_ES.get(exchange, exchange),
        "source": "yahoo",
    }


def search_symbols(query: str, limit: int = 10) -> list[dict]:
    """Catálogo local primero; si no alcanza, busca en Yahoo cualquier emisora."""
    q = (query or "").strip()
    if not q:
        return []
    local = search_catalog(q, limit=limit)
    if len(local) >= limit:
        return local
    key = q.lower()
    remote = _cached(_search_cache, key, SEARCH_TTL_SEC)
    if remote is None:
        remote = []
        try:
            import yfinance as yf

            res = yf.Search(q, max_results=12, news_count=0)
            seen: set[str] = set()
            for quote in res.quotes or []:
                item = _yahoo_to_local(quote)
                if item and item["symbol"] not in seen:
                    seen.add(item["symbol"])
                    remote.append(item)
        except Exception as exc:
            logger.info("yahoo search failed for %s: %s", q, exc)
        _store(_search_cache, key, remote)
    have = {i["symbol"] for i in local}
    merged = list(local)
    for item in remote:
        if item["symbol"] not in have:
            merged.append(item)
            have.add(item["symbol"])
    return merged[:limit]


# ---------------------------------------------------------------- técnico

def _sma(values: list[float], n: int) -> float | None:
    if len(values) < n:
        return None
    return sum(values[-n:]) / n


def _rsi(values: list[float], n: int = 14) -> float | None:
    if len(values) <= n:
        return None
    gains = losses = 0.0
    for i in range(1, n + 1):
        d = values[i] - values[i - 1]
        gains += max(d, 0)
        losses += max(-d, 0)
    avg_g, avg_l = gains / n, losses / n
    for i in range(n + 1, len(values)):
        d = values[i] - values[i - 1]
        avg_g = (avg_g * (n - 1) + max(d, 0)) / n
        avg_l = (avg_l * (n - 1) + max(-d, 0)) / n
    if avg_l == 0:
        return 100.0
    rs = avg_g / avg_l
    return 100 - 100 / (1 + rs)


def _pct(a: float | None, b: float | None) -> float | None:
    if a is None or not b:
        return None
    return round((a / b - 1) * 100, 2)


def compute_technicals(dates: list[str], closes: list[float]) -> dict[str, Any]:
    """Rendimientos por periodo, medias, RSI, volatilidad y señal resumida."""
    if len(closes) < 2:
        return {"available": False}
    last = closes[-1]
    last_date = datetime.strptime(dates[-1], "%Y-%m-%d")

    def back(days: int) -> float | None:
        target = last_date.toordinal() - days
        for d, c in zip(reversed(dates), reversed(closes)):
            if datetime.strptime(d, "%Y-%m-%d").toordinal() <= target:
                return c
        return None

    ytd_base = None
    for d, c in zip(reversed(dates), reversed(closes)):
        if int(d[:4]) < last_date.year:
            ytd_base = c
            break

    performance = [
        {"id": "1S", "pct": _pct(last, back(7))},
        {"id": "1M", "pct": _pct(last, back(30))},
        {"id": "3M", "pct": _pct(last, back(91))},
        {"id": "6M", "pct": _pct(last, back(182))},
        {"id": "YTD", "pct": _pct(last, ytd_base)},
        {"id": "1A", "pct": _pct(last, back(365))},
        {"id": "5A", "pct": _pct(last, back(365 * 5 - 5))},
    ]

    sma20, sma50, sma200 = _sma(closes, 20), _sma(closes, 50), _sma(closes, 200)
    rsi = _rsi(closes[-300:])
    year = closes[-252:]
    rets = [math.log(year[i] / year[i - 1]) for i in range(1, len(year)) if year[i - 1] > 0 and year[i] > 0]
    vol = None
    if len(rets) > 20:
        mean = sum(rets) / len(rets)
        vol = math.sqrt(sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)) * math.sqrt(252) * 100
    hi52, lo52 = max(year), min(year)

    signals: list[dict[str, Any]] = []

    def add(label: str, vote: int, detail: str) -> None:
        signals.append({"label": label, "vote": vote, "detail": detail})

    for name, ma in (("Media 20", sma20), ("Media 50", sma50), ("Media 200", sma200)):
        if ma:
            add(name, 1 if last > ma else -1, f"Precio {'arriba' if last > ma else 'abajo'} de {ma:,.2f}")
    if sma50 and sma200:
        golden = sma50 > sma200
        add("Cruce 50/200", 1 if golden else -1, "Cruce dorado" if golden else "Cruce de la muerte")
    if rsi is not None:
        if rsi >= 70:
            add("RSI 14", -1, f"{rsi:.1f} · sobrecompra")
        elif rsi <= 30:
            add("RSI 14", 1, f"{rsi:.1f} · sobreventa")
        else:
            add("RSI 14", 0, f"{rsi:.1f} · neutral")
    m3 = performance[2]["pct"]
    if m3 is not None:
        add("Momento 3M", 1 if m3 > 0 else -1, f"{m3:+.2f}%")

    score = sum(s["vote"] for s in signals)
    total = len(signals) or 1
    ratio = score / total
    if ratio >= 0.6:
        verdict = "Compra fuerte"
    elif ratio >= 0.2:
        verdict = "Compra"
    elif ratio > -0.2:
        verdict = "Neutral"
    elif ratio > -0.6:
        verdict = "Venta"
    else:
        verdict = "Venta fuerte"

    return {
        "available": True,
        "last": round(last, 4),
        "performance": performance,
        "sma20": round(sma20, 2) if sma20 else None,
        "sma50": round(sma50, 2) if sma50 else None,
        "sma200": round(sma200, 2) if sma200 else None,
        "rsi14": round(rsi, 1) if rsi is not None else None,
        "volatility_pct": round(vol, 1) if vol is not None else None,
        "high_52w": round(hi52, 2),
        "low_52w": round(lo52, 2),
        "range_pos_pct": round((last - lo52) / (hi52 - lo52) * 100, 1) if hi52 > lo52 else None,
        "signals": signals,
        "score": score,
        "score_max": total,
        "gauge": round(ratio, 2),
        "verdict": verdict,
    }


# ---------------------------------------------------------------- salud

def compute_health(info: dict) -> dict[str, Any]:
    margin = _safe_float(info.get("profitMargins"))
    roe = _safe_float(info.get("returnOnEquity"))
    growth = _safe_float(info.get("revenueGrowth"))
    de = _safe_float(info.get("debtToEquity"))
    current = _safe_float(info.get("currentRatio"))
    fcf = _safe_float(info.get("freeCashflow"))
    checks = []

    def add(label: str, ok: bool | None, value: str) -> None:
        if ok is not None:
            checks.append({"label": label, "ok": ok, "value": value})

    if margin is not None:
        add("Es rentable (margen neto > 0)", margin > 0, f"{margin * 100:.1f}%")
    if roe is not None:
        add("ROE de 15% o más", roe >= 0.15, f"{roe * 100:.1f}%")
    if growth is not None:
        add("Ingresos creciendo", growth > 0, f"{growth * 100:+.1f}%")
    if de is not None:
        add("Deuda menor a su capital", de < 100, f"{de:.0f}%")
    if current is not None:
        add("Activo circulante cubre pasivo", current >= 1, f"{current:.2f}x")
    if fcf is not None:
        add("Genera flujo libre", fcf > 0, "positivo" if fcf > 0 else "negativo")
    passed = sum(1 for c in checks if c["ok"])
    return {"checks": checks, "passed": passed, "total": len(checks)}


# ---------------------------------------------------------------- analistas

def _analysts_from_info(info: dict) -> dict[str, Any] | None:
    mean = _safe_float(info.get("targetMeanPrice"))
    count = info.get("numberOfAnalystOpinions")
    key = info.get("recommendationKey")
    if mean is None and (not key or key == "none"):
        return None
    return {
        "target_mean": mean,
        "target_high": _safe_float(info.get("targetHighPrice")),
        "target_low": _safe_float(info.get("targetLowPrice")),
        "target_median": _safe_float(info.get("targetMedianPrice")),
        "count": int(count) if count else None,
        "recommendation_key": key,
        "recommendation": RECOMMENDATION_ES.get(key or "", None),
        "recommendation_mean": _safe_float(info.get("recommendationMean")),
    }


def _recommendation_counts(ticker: Any) -> dict[str, int] | None:
    try:
        df = ticker.recommendations_summary
        if df is None or df.empty:
            return None
        row = df.iloc[0]
        return {k: int(row.get(k) or 0) for k in ("strongBuy", "buy", "hold", "sell", "strongSell")}
    except Exception:
        return None


def _scale_targets(an: dict, factor: float) -> dict:
    out = dict(an)
    for k in ("target_mean", "target_high", "target_low", "target_median"):
        if out.get(k) is not None:
            out[k] = round(out[k] * factor, 2)
    return out


# ---------------------------------------------------------------- vista general

def _history(ticker: Any) -> tuple[list[str], list[float]]:
    try:
        hist = ticker.history(period="5y", interval="1d", auto_adjust=True)
    except Exception:
        return [], []
    if hist is None or hist.empty:
        return [], []
    by_date: dict[str, float] = {}
    for idx, row in hist.iterrows():
        c = _safe_float(row.get("Close"))
        if c is not None and c > 0:
            by_date[idx.strftime("%Y-%m-%d")] = c
    dates = sorted(by_date)
    return dates, [by_date[d] for d in dates]


def _ceo(info: dict) -> str | None:
    for officer in info.get("companyOfficers") or []:
        title = (officer.get("title") or "").upper()
        if "CEO" in title or "CHIEF EXECUTIVE" in title or "DIRECTOR GENERAL" in title:
            return officer.get("name")
    return None


def get_emisora_overview(symbol: str) -> dict[str, Any]:
    meta = get_symbol_meta(symbol)
    if not meta:
        return {"error": "Símbolo no encontrado"}
    key = meta["symbol"]
    cached = _cached(_overview_cache, key, OVERVIEW_TTL_SEC)
    if cached is not None:
        return cached

    import yfinance as yf

    yahoo = meta["yahoo"]
    try:
        ticker = yf.Ticker(yahoo)
        info = ticker.info or {}
    except Exception as exc:
        logger.warning("overview fetch failed for %s: %s", yahoo, exc)
        return {"error": "No se pudo consultar Yahoo Finance", "symbol": key}

    price = _safe_float(info.get("regularMarketPrice") or info.get("currentPrice"))
    prev = _safe_float(info.get("regularMarketPreviousClose") or info.get("previousClose"))
    if price is None and not info.get("longName"):
        return {"error": "Sin datos para esta emisora", "symbol": key}

    dates, closes = _history(ticker)
    if price is None and closes:
        price = closes[-1]

    country = info.get("country")
    is_foreign = yahoo.endswith(".MX") and country not in (None, "Mexico")

    analysts = _analysts_from_info(info)
    counts = _recommendation_counts(ticker) if analysts else None
    analysts_source = yahoo
    if analysts is None and is_foreign:
        base = yahoo[:-3]
        try:
            us = yf.Ticker(base)
            us_info = us.info or {}
            us_an = _analysts_from_info(us_info)
            us_price = _safe_float(us_info.get("regularMarketPrice") or us_info.get("currentPrice"))
            if us_an and us_price and price:
                analysts = _scale_targets(us_an, price / us_price)
                analysts["converted_from"] = f"{base} (USD × {price / us_price:.2f})"
                counts = _recommendation_counts(us)
                analysts_source = base
        except Exception as exc:
            logger.info("analysts fallback failed for %s: %s", base, exc)
    if analysts:
        analysts["counts"] = counts
        analysts["source"] = analysts_source
        if analysts.get("target_mean") and price:
            analysts["upside_pct"] = _pct(analysts["target_mean"], price)

    market_time = None
    ts = info.get("regularMarketTime")
    if ts:
        try:
            market_time = datetime.fromtimestamp(int(ts), MX_TZ).strftime("%Y-%m-%d %H:%M")
        except (TypeError, ValueError, OSError):
            market_time = None

    exchange = info.get("exchange") or ""
    shares = _safe_float(info.get("sharesOutstanding"))
    market_cap = _safe_float(info.get("marketCap"))
    if market_cap is None and shares and price:
        market_cap = shares * price

    revenue = _safe_float(info.get("totalRevenue"))
    ev = _safe_float(info.get("enterpriseValue"))
    result = {
        "symbol": key,
        "yahoo": yahoo,
        "name": info.get("longName") or info.get("shortName") or meta.get("name") or key,
        "exchange": EXCHANGE_ES.get(exchange, info.get("fullExchangeName") or exchange),
        "board": meta.get("board"),
        "board_title": "SIC" if is_foreign else meta.get("board_title"),
        "currency": info.get("currency") or "MXN",
        "price": price,
        "prev_close": prev,
        "change_abs": (price - prev) if price is not None and prev else None,
        "change_pct": _pct(price, prev),
        "market_state": info.get("marketState"),
        "market_time": market_time,
        "key_facts": {
            "market_cap": market_cap,
            "dividend_yield_pct": _dividend_yield_pct(info),
            "pe_ttm": _safe_float(info.get("trailingPE")),
            "pe_forward": _safe_float(info.get("forwardPE")),
            "eps_ttm": _safe_float(info.get("trailingEps")),
            "price_to_book": _safe_float(info.get("priceToBook")),
            "price_to_sales": (market_cap / revenue) if market_cap and revenue else None,
            "ev_ebitda": _safe_float(info.get("enterpriseToEbitda")) or None,
            "enterprise_value": ev,
            "revenue_ttm": revenue,
            "net_income_ttm": _safe_float(info.get("netIncomeToCommon")),
            "beta": _safe_float(info.get("beta")),
            "employees": info.get("fullTimeEmployees"),
            "shares_outstanding": shares,
            "avg_volume": _safe_float(info.get("averageVolume")),
            "volume": _safe_float(info.get("regularMarketVolume") or info.get("volume")),
            "profit_margin_pct": _ratio_pct(info.get("profitMargins")),
            "operating_margin_pct": _ratio_pct(info.get("operatingMargins")),
            "roe_pct": _ratio_pct(info.get("returnOnEquity")),
            "roa_pct": _ratio_pct(info.get("returnOnAssets")),
            "revenue_growth_pct": _ratio_pct(info.get("revenueGrowth")),
            "earnings_growth_pct": _ratio_pct(info.get("earningsGrowth")),
            "debt_to_equity": _safe_float(info.get("debtToEquity")),
            "current_ratio": _safe_float(info.get("currentRatio")),
        },
        "profile": {
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "ceo": _ceo(info),
            "website": info.get("website"),
            "city": info.get("city"),
            "country": country,
            "summary": info.get("longBusinessSummary"),
        },
        "technicals": compute_technicals(dates, closes),
        "analysts": analysts,
        "health": compute_health(info),
        "fetched_at": _now(),
    }
    _store(_overview_cache, key, result)
    return result


def _ratio_pct(value: Any) -> float | None:
    v = _safe_float(value)
    return round(v * 100, 2) if v is not None else None


def page_symbol_allowed(symbol: str) -> bool:
    return is_known_symbol(symbol) or looks_like_symbol(symbol)
