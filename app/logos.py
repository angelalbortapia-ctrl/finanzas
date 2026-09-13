"""Issuer logos — TradingView CDN + overrides + Finnhub fallback."""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from app.catalog import bmv_to_yahoo
from app.config import FINNHUB_API_KEY

logger = logging.getLogger(__name__)

TV_CDN = "https://s3-symbol-logo.tradingview.com"
LOGO_HOST_ALLOWLIST = (
    "s3-symbol-logo.tradingview.com",
    "static.finnhub.io",
    "finnhub.io",
)
TV_SCANNER_MX = "https://scanner.tradingview.com/mexico/scan"
TV_SCANNER_US = "https://scanner.tradingview.com/america/scan"
TV_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Referer": "https://www.tradingview.com/",
    "Content-Type": "application/json",
}

# Ticker BMV/SIC → slug de TradingView (s3-symbol-logo.tradingview.com/{slug}.svg)
LOGO_OVERRIDES: dict[str, str] = {
    "GFNORTEO": "banorte",
    "WALMEX": "walmart",
    "FEMSAUBD": "femsa",
    "GMEXICOB": "grupo-mexico",
    "CEMEXCPO": "cemex",
    "CEMEX": "cemex",
    "AMXB": "america-movil",
    "BOLSAA": "grupo-bmv",
    "NAFTRAC": "ishares",
    "IVVPESO": "ishares",
    "AAPL": "apple",
    "MSFT": "microsoft",
    "NVDA": "nvidia",
    "TSLA": "tesla",
    "AMZN": "amazon",
    "GOOGL": "alphabet",
    "SPY": "spdr",
    "EWU": "ishares",
    "EWG": "ishares",
}

# Índices / FX / referencias
SPECIAL_LOGOS: dict[str, str] = {
    "IPC": "source/BMV",
    "INMEX": "source/BMV",
    "VMEX19": "source/BMV",
    "SPX": "source/NASDAQ",
    "NDX": "source/NASDAQ",
    "IXIC": "source/NASDAQ",
    "DJI": "source/DOW",
    "RUT": "source/RUSSELL",
    "VIX": "source/CBOE",
    "DAX": "source/XETR",
    "FTSE": "source/FTSE",
    "STOXX": "source/EURONEXT",
    "NIKKEI": "source/TSE",
    "HSI": "source/HKEX",
    "BOVESPA": "source/BMFBOVESPA",
    "MERV": "source/BCBA",
    "USDMXN": "country/MX",
    "EURMXN": "country/EU",
    "EURUSD": "country/EU",
    "DXY": "country/US",
    "BTC": "crypto/XTVCBTC",
}

_mem_cache: dict[str, dict[str, Any]] = {}
CACHE_SEC = 86400 * 7


def is_safe_logo_url(url: str) -> bool:
    try:
        host = urllib.parse.urlparse(url).hostname or ""
    except Exception:
        return False
    return any(host == allowed or host.endswith(f".{allowed}") for allowed in LOGO_HOST_ALLOWLIST)


def _logo_url(slug: str) -> str:
    slug = slug.strip().lstrip("/")
    if slug.startswith("http://") or slug.startswith("https://"):
        return slug
    return f"{TV_CDN}/{slug}.svg"


def _cache_get(symbol: str) -> dict[str, Any] | None:
    key = symbol.upper().replace("BMV:", "")
    hit = _mem_cache.get(key)
    if hit and time.time() - float(hit.get("at") or 0) < CACHE_SEC:
        return hit
    try:
        from app.database import get_db

        conn = get_db()
        row = conn.execute(
            "SELECT value FROM schema_meta WHERE key = ?", (f"logo:{key}",)
        ).fetchone()
        conn.close()
        if row and row["value"]:
            payload = {"symbol": key, "url": row["value"], "source": "db", "at": time.time()}
            _mem_cache[key] = payload
            return payload
    except Exception as exc:
        logger.debug("logo cache read failed for %s: %s", symbol, exc)
    return None


def _cache_set(symbol: str, url: str, source: str) -> None:
    key = symbol.upper().replace("BMV:", "")
    payload = {"symbol": key, "url": url, "source": source, "at": time.time()}
    _mem_cache[key] = payload
    try:
        from app.database import get_db

        conn = get_db()
        conn.execute(
            """INSERT INTO schema_meta (key, value) VALUES (?, ?)
               ON CONFLICT(key) DO UPDATE SET value = excluded.value""",
            (f"logo:{key}", url),
        )
        conn.commit()
        conn.close()
    except Exception as exc:
        logger.debug("logo cache write failed for %s: %s", symbol, exc)


def _tv_scan_logoid(ticker: str, exchange: str = "BMV") -> str | None:
    sym = ticker.upper().replace("BMV:", "")
    prefixes = [f"{exchange}:{sym}"]
    if exchange == "BMV":
        prefixes.append(sym)
    for tv_sym in prefixes:
        body = json.dumps({
            "symbols": {"tickers": [tv_sym]},
            "columns": ["logoid"],
        }).encode()
        scanner = TV_SCANNER_MX if exchange == "BMV" else TV_SCANNER_US
        try:
            req = urllib.request.Request(scanner, data=body, headers=TV_HEADERS, method="POST")
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = json.loads(resp.read().decode())
            rows = data.get("data") or []
            if rows and rows[0].get("d"):
                slug = rows[0]["d"][0]
                if slug:
                    return str(slug)
        except Exception as exc:
            logger.debug("TV logo scan failed for %s@%s: %s", sym, exchange, exc)
            continue
    return None


def _finnhub_logo(ticker: str) -> str | None:
    if not FINNHUB_API_KEY:
        return None
    sym = ticker.upper().replace("BMV:", "")
    yahoo = bmv_to_yahoo(sym)
    candidates = [sym]
    if yahoo.endswith(".MX"):
        candidates.append(yahoo.replace(".MX", ""))
    candidates.append(f"{sym}.MX")
    for candidate in dict.fromkeys(candidates):
        url = (
            f"https://finnhub.io/api/v1/stock/profile2"
            f"?symbol={urllib.parse.quote(candidate)}&token={FINNHUB_API_KEY}"
        )
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Finanzas/1.0"})
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = json.loads(resp.read().decode())
            logo = data.get("logo")
            if logo:
                return str(logo)
        except Exception as exc:
            logger.debug("Finnhub logo failed for %s: %s", candidate, exc)
            continue
    return None


def get_symbol_logo(symbol: str) -> dict[str, Any]:
    """Resolve logo URL for a symbol. Returns {symbol, url, source}."""
    key = symbol.upper().replace("BMV:", "")
    cached = _cache_get(key)
    if cached and cached.get("url"):
        return cached

    slug = LOGO_OVERRIDES.get(key) or SPECIAL_LOGOS.get(key)
    source = "override"

    if not slug:
        slug = _tv_scan_logoid(key, "BMV")
        source = "tradingview"
    if not slug and key.isalpha() and len(key) <= 5:
        slug = _tv_scan_logoid(key, "US")
        source = "tradingview"

    url: str | None = None
    if slug:
        url = _logo_url(slug)
    if not url:
        url = _finnhub_logo(key)
        source = "finnhub" if url else source

    if url:
        _cache_set(key, url, source)
        return {"symbol": key, "url": url, "source": source, "at": time.time()}

    return {"symbol": key, "url": None, "source": None, "at": time.time()}


def get_logo_fast(symbol: str) -> dict[str, Any]:
    """Resolve logo from cache/overrides only — no external API calls."""
    key = symbol.upper().replace("BMV:", "")
    cached = _cache_get(key)
    if cached and cached.get("url"):
        return cached
    slug = LOGO_OVERRIDES.get(key) or SPECIAL_LOGOS.get(key)
    if not slug:
        return {"symbol": key, "url": None, "source": None, "at": time.time()}
    url = _logo_url(slug)
    _cache_set(key, url, "override")
    return {"symbol": key, "url": url, "source": "override", "at": time.time()}


def get_logos_batch(symbols: list[str], *, fast: bool = True) -> dict[str, str | None]:
    out: dict[str, str | None] = {}
    for sym in symbols:
        key = sym.upper().replace("BMV:", "")
        if not key:
            continue
        info = get_logo_fast(key) if fast else get_symbol_logo(key)
        out[key] = info.get("url")
    return out
