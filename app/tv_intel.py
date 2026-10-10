"""TradingView scanner — métricas técnicas públicas (mismo endpoint que el sitio)."""

from __future__ import annotations

import json
import logging
import threading
import time
import urllib.request
from typing import Any

from app.catalog import get_symbol_meta

logger = logging.getLogger(__name__)

TV_SCANNER_MX = "https://scanner.tradingview.com/mexico/scan"
TV_SCANNER_US = "https://scanner.tradingview.com/america/scan"
TV_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Referer": "https://www.tradingview.com/",
    "Content-Type": "application/json",
}

TV_SCAN_COLUMNS = [
    "close",
    "change",
    "volume",
    "Recommend.All",
    "Recommend.MA",
    "Recommend.Other",
    "RSI",
    "Stoch.K",
    "Stoch.D",
    "MACD.macd",
    "ADX",
    "Mom",
    "CCI20",
    "Volatility.D",
    "price_earnings_ttm",
    "market_cap_basic",
]

TV_LABELS = {
    "close": "Precio",
    "change": "Cambio %",
    "volume": "Volumen",
    "Recommend.All": "Recomendación técnica",
    "Recommend.MA": "Medias móviles",
    "Recommend.Other": "Otros indicadores",
    "RSI": "RSI (14)",
    "Stoch.K": "Estocástico %K",
    "Stoch.D": "Estocástico %D",
    "MACD.macd": "MACD",
    "ADX": "ADX",
    "Mom": "Momentum (10)",
    "CCI20": "CCI (20)",
    "Volatility.D": "Volatilidad diaria",
    "price_earnings_ttm": "P/E TTM",
    "market_cap_basic": "Cap. bursátil",
}

_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_lock = threading.Lock()
TTL_SEC = 600

# Listings US conocidos (SIC / dual-list). El widget de ficha TV no soporta BMV:SBUX.
TV_US_EXCHANGE: dict[str, str] = {
    "AAPL": "NASDAQ", "MSFT": "NASDAQ", "NVDA": "NASDAQ", "TSLA": "NASDAQ",
    "AMZN": "NASDAQ", "GOOGL": "NASDAQ", "GOOG": "NASDAQ", "META": "NASDAQ",
    "NFLX": "NASDAQ", "SBUX": "NASDAQ", "AMD": "NASDAQ", "INTC": "NASDAQ",
    "CSCO": "NASDAQ", "ADBE": "NASDAQ", "PEP": "NASDAQ", "COST": "NASDAQ",
    "QCOM": "NASDAQ", "TXN": "NASDAQ", "AMGN": "NASDAQ", "HON": "NASDAQ",
    "JPM": "NYSE", "V": "NYSE", "MA": "NYSE", "JNJ": "NYSE", "PG": "NYSE",
    "XOM": "NYSE", "KO": "NYSE", "DIS": "NYSE", "WMT": "NYSE", "BAC": "NYSE",
    "HD": "NYSE", "UNH": "NYSE", "MRK": "NYSE", "CVX": "NYSE", "ABBV": "NYSE",
    "LLY": "NYSE", "ORCL": "NYSE", "IBM": "NYSE", "CAT": "NYSE", "BA": "NYSE",
    "GE": "NYSE", "NKE": "NYSE", "MCD": "NYSE", "T": "NYSE", "PFE": "NYSE",
    "C": "NYSE", "GS": "NYSE", "AXP": "NYSE", "MMM": "NYSE", "VZ": "NYSE",
}


def tradingview_candidates(meta: dict[str, Any]) -> list[str]:
    """Orden de prueba: listing US primero para SIC, luego BMV."""
    sym = meta.get("symbol", "").upper().replace("BMV:", "")
    kind = meta.get("kind", "stock")
    board = (meta.get("board") or "bmv").lower()
    if kind == "fx":
        return [sym]
    if kind == "index":
        if sym in ("IPC", "INMEX"):
            return ["BMV:ME"]
        return [sym]
    out: list[str] = []
    hint = TV_US_EXCHANGE.get(sym)
    foreign = kind == "sic" or board in ("sic", "us") or (
        board not in ("bmv", "biva") and sym.isalpha() and 1 <= len(sym) <= 5
    )
    if hint:
        out.append(f"{hint}:{sym}")
    if foreign:
        for ex in ("NASDAQ", "NYSE", "AMEX"):
            cand = f"{ex}:{sym}"
            if cand not in out:
                out.append(cand)
    if board in ("bmv", "biva", "sic") or sym.endswith(("-1", "-2", "CPO", "UBD")):
        bmv = f"BMV:{sym}"
        if bmv not in out:
            out.append(bmv)
            out.append(sym)
    if not out:
        out.append(f"BMV:{sym}")
    return out


def tradingview_symbol(meta: dict[str, Any]) -> str:
    return tradingview_candidates(meta)[0]


def _format_tv_metric(key: str, val: Any) -> str | None:
    if val is None:
        return None
    try:
        f = float(val)
    except (TypeError, ValueError):
        return str(val)
    if key == "change":
        return f"{f:+.2f}%"
    if key.startswith("Recommend."):
        if f >= 0.5:
            return "Compra fuerte"
        if f >= 0.1:
            return "Compra"
        if f <= -0.5:
            return "Venta fuerte"
        if f <= -0.1:
            return "Venta"
        return "Neutral"
    if key in ("RSI", "Stoch.K", "Stoch.D", "ADX", "CCI20", "Mom"):
        return f"{f:.1f}"
    if key == "Volatility.D":
        return f"{f:.2f}%"
    if key == "volume":
        if abs(f) >= 1e6:
            return f"{f / 1e6:.2f}M"
        if abs(f) >= 1e3:
            return f"{f / 1e3:.1f}K"
        return f"{f:,.0f}"
    if key == "market_cap_basic":
        if abs(f) >= 1e12:
            return f"${f / 1e12:.2f}T"
        if abs(f) >= 1e9:
            return f"${f / 1e9:.2f}B"
        if abs(f) >= 1e6:
            return f"${f / 1e6:.2f}M"
        return f"${f:,.0f}"
    if key == "close":
        return f"${f:,.2f}"
    if key == "price_earnings_ttm":
        return f"{f:.2f}"
    if key == "MACD.macd":
        return f"{f:.3f}"
    return f"{f:.2f}"


def fetch_tradingview_scan(symbol: str) -> dict[str, Any]:
    meta = get_symbol_meta(symbol)
    if not meta:
        return {"error": "Símbolo no encontrado"}
    if meta.get("kind") in ("fx",):
        return {"applicable": False, "message": "Scanner TV no aplica a divisas"}

    key = meta["symbol"]
    candidates = tradingview_candidates(meta)
    tv_sym = candidates[0]
    with _lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < TTL_SEC:
            return dict(hit[1])

    metrics: list[dict[str, str]] = []
    raw_row: list[Any] = []
    resolved = tv_sym
    for tv_ticker in candidates:
        scanner = TV_SCANNER_MX if tv_ticker.startswith("BMV:") or ":" not in tv_ticker else TV_SCANNER_US
        if scanner == TV_SCANNER_MX and ":" not in tv_ticker:
            scanner = TV_SCANNER_MX
        body = json.dumps({
            "symbols": {"tickers": [tv_ticker]},
            "columns": TV_SCAN_COLUMNS,
        }).encode()
        try:
            req = urllib.request.Request(scanner, data=body, headers=TV_HEADERS, method="POST")
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode())
            rows = data.get("data") or []
            if not rows:
                continue
            raw_row = rows[0].get("d") or []
            resolved = tv_ticker if ":" in tv_ticker else f"BMV:{tv_ticker}"
            break
        except Exception as exc:
            logger.debug("TV scan failed %s: %s", tv_ticker, exc)
            continue
    tv_sym = resolved

    for i, col in enumerate(TV_SCAN_COLUMNS):
        if i >= len(raw_row):
            break
        display = _format_tv_metric(col, raw_row[i])
        if display is None:
            continue
        metrics.append({
            "key": col,
            "label": TV_LABELS.get(col, col),
            "value": display,
        })

    embed_ok = bool(tv_sym) and not tv_sym.startswith("BMV:")
    out: dict[str, Any] = {
        "symbol": key,
        "tv_symbol": tv_sym,
        "embed_ok": embed_ok,
        "applicable": bool(metrics) or embed_ok,
        "metrics": metrics,
        "source": "TradingView Scanner",
    }
    if not metrics:
        out["message"] = "Sin datos del scanner para este símbolo en TradingView"

    with _lock:
        _cache[key] = (time.time(), out)
    return out
