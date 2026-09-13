"""Live quotes for BMV, BIVA and SIC boards (Mexican exchanges)."""

from __future__ import annotations

import math
import time
from dataclasses import dataclass
from datetime import datetime


def _safe_num(value, default: float = 0.0) -> float:
    try:
        num = float(value)
    except (TypeError, ValueError):
        return default
    return num if math.isfinite(num) else default

# Yahoo symbols — prices in MXN where applicable
BOARD_SECTIONS: list[dict] = [
    {
        "id": "bmv",
        "title": "BMV",
        "subtitle": "Mercado local",
        "items": [
            {"symbol": "IPC", "name": "Índice IPC", "yahoo": "^MXX", "kind": "index"},
            {"symbol": "BOLSAA", "name": "Grupo BMV", "yahoo": "BOLSAA.MX"},
            {"symbol": "WALMEX", "name": "Walmex", "yahoo": "WALMEX.MX"},
            {"symbol": "FEMSAUBD", "name": "FEMSA", "yahoo": "FEMSAUBD.MX"},
            {"symbol": "GMEXICOB", "name": "Grupo México", "yahoo": "GMEXICOB.MX"},
            {"symbol": "GFNORTEO", "name": "Banorte", "yahoo": "GFNORTEO.MX"},
        ],
    },
    {
        "id": "biva",
        "title": "BIVA",
        "subtitle": "Bolsa institucional",
        "items": [
            {"symbol": "VMEX19", "name": "FTSE BIVA", "yahoo": "VMEX19.MX", "kind": "etf"},
            {"symbol": "NAFTRAC", "name": "NAFTRAC", "yahoo": "NAFTRACISHRS.MX", "kind": "etf"},
            {"symbol": "IVVPESO", "name": "S&P 500 MX", "yahoo": "IVVPESOISHRS.MX", "kind": "etf"},
            {"symbol": "BOLSAA", "name": "Grupo BMV", "yahoo": "BOLSAA.MX"},
            {"symbol": "CEMEXCPO", "name": "CEMEX", "yahoo": "CEMEXCPO.MX"},
            {"symbol": "AMXB", "name": "América Móvil", "yahoo": "AMXB.MX"},
        ],
    },
    {
        "id": "sic",
        "title": "SIC",
        "subtitle": "Mercado global en MXN",
        "items": [
            {"symbol": "AAPL", "name": "Apple", "yahoo": "AAPL.MX"},
            {"symbol": "MSFT", "name": "Microsoft", "yahoo": "MSFT.MX"},
            {"symbol": "NVDA", "name": "NVIDIA", "yahoo": "NVDA.MX"},
            {"symbol": "TSLA", "name": "Tesla", "yahoo": "TSLA.MX"},
            {"symbol": "AMZN", "name": "Amazon", "yahoo": "AMZN.MX"},
            {"symbol": "GOOGL", "name": "Alphabet", "yahoo": "GOOGL.MX"},
            {"symbol": "SPY", "name": "S&P 500 ETF", "yahoo": "SPY.MX", "kind": "etf"},
        ],
    },
    {
        "id": "us",
        "title": "EE.UU.",
        "subtitle": "NYSE / NASDAQ",
        "items": [
            {"symbol": "SPX", "name": "S&P 500", "yahoo": "^GSPC", "kind": "index"},
            {"symbol": "DJI", "name": "Dow Jones", "yahoo": "^DJI", "kind": "index"},
            {"symbol": "NDX", "name": "Nasdaq 100", "yahoo": "^NDX", "kind": "index"},
            {"symbol": "AAPL", "name": "Apple", "yahoo": "AAPL"},
            {"symbol": "MSFT", "name": "Microsoft", "yahoo": "MSFT"},
            {"symbol": "NVDA", "name": "NVIDIA", "yahoo": "NVDA"},
            {"symbol": "TSLA", "name": "Tesla", "yahoo": "TSLA"},
        ],
    },
    {
        "id": "eu",
        "title": "Europa",
        "subtitle": "Índices globales",
        "items": [
            {"symbol": "STOXX", "name": "Euro Stoxx 50", "yahoo": "^STOXX50E", "kind": "index"},
            {"symbol": "DAX", "name": "DAX", "yahoo": "^GDAXI", "kind": "index"},
            {"symbol": "FTSE", "name": "FTSE 100", "yahoo": "^FTSE", "kind": "index"},
            {"symbol": "EWU", "name": "UK ETF", "yahoo": "EWU", "kind": "etf"},
            {"symbol": "EWG", "name": "Alemania ETF", "yahoo": "EWG", "kind": "etf"},
        ],
    },
]

INDICES_ONLY_KINDS = frozenset({"index"})

INDICES_SECTIONS: list[dict] = [
    {
        "id": "mx",
        "title": "México",
        "subtitle": "BMV / BIVA",
        "items": [
            {"symbol": "IPC", "name": "Índice IPC", "yahoo": "^MXX", "kind": "index"},
            {"symbol": "INMEX", "name": "Índice INMEX", "yahoo": "INMEX.MX", "kind": "index"},
            {"symbol": "VMEX19", "name": "FTSE BIVA", "yahoo": "VMEX19.MX", "kind": "index"},
        ],
    },
    {
        "id": "us",
        "title": "EE.UU.",
        "subtitle": "Wall Street",
        "items": [
            {"symbol": "SPX", "name": "S&P 500", "yahoo": "^GSPC", "kind": "index"},
            {"symbol": "DJI", "name": "Dow Jones", "yahoo": "^DJI", "kind": "index"},
            {"symbol": "NDX", "name": "Nasdaq 100", "yahoo": "^NDX", "kind": "index"},
            {"symbol": "IXIC", "name": "Nasdaq Composite", "yahoo": "^IXIC", "kind": "index"},
            {"symbol": "RUT", "name": "Russell 2000", "yahoo": "^RUT", "kind": "index"},
            {"symbol": "VIX", "name": "Índice VIX", "yahoo": "^VIX", "kind": "index"},
        ],
    },
    {
        "id": "eu",
        "title": "Europa",
        "subtitle": "Principales bolsas",
        "items": [
            {"symbol": "STOXX", "name": "Euro Stoxx 50", "yahoo": "^STOXX50E", "kind": "index"},
            {"symbol": "DAX", "name": "DAX", "yahoo": "^GDAXI", "kind": "index"},
            {"symbol": "FTSE", "name": "FTSE 100", "yahoo": "^FTSE", "kind": "index"},
            {"symbol": "CAC", "name": "CAC 40", "yahoo": "^FCHI", "kind": "index"},
            {"symbol": "IBEX", "name": "IBEX 35", "yahoo": "^IBEX", "kind": "index"},
        ],
    },
    {
        "id": "asia",
        "title": "Asia",
        "subtitle": "Pacífico",
        "items": [
            {"symbol": "NIKKEI", "name": "Nikkei 225", "yahoo": "^N225", "kind": "index"},
            {"symbol": "HSI", "name": "Hang Seng", "yahoo": "^HSI", "kind": "index"},
            {"symbol": "KOSPI", "name": "Kospi", "yahoo": "^KS11", "kind": "index"},
            {"symbol": "SSEC", "name": "Shanghai", "yahoo": "000001.SS", "kind": "index"},
        ],
    },
    {
        "id": "latam",
        "title": "LatAm",
        "subtitle": "América Latina",
        "items": [
            {"symbol": "BOVESPA", "name": "Bovespa", "yahoo": "^BVSP", "kind": "index"},
            {"symbol": "MERV", "name": "MERVAL", "yahoo": "^MERV", "kind": "index"},
        ],
    },
]

FX_SECTIONS: list[dict] = [
    {
        "id": "mxn",
        "title": "Peso MX",
        "subtitle": "Cruces vs MXN",
        "items": [
            {"symbol": "USDMXN", "name": "USD / MXN", "yahoo": "USDMXN=X", "kind": "fx"},
            {"symbol": "EURMXN", "name": "EUR / MXN", "yahoo": "EURMXN=X", "kind": "fx"},
            {"symbol": "GBPMXN", "name": "GBP / MXN", "yahoo": "GBPMXN=X", "kind": "fx"},
            {"symbol": "CADMXN", "name": "CAD / MXN", "yahoo": "CADMXN=X", "kind": "fx"},
            {"symbol": "JPYMXN", "name": "JPY / MXN", "yahoo": "JPYMXN=X", "kind": "fx"},
        ],
    },
    {
        "id": "majors",
        "title": "Mayores",
        "subtitle": "vs USD",
        "items": [
            {"symbol": "EURUSD", "name": "EUR / USD", "yahoo": "EURUSD=X", "kind": "fx"},
            {"symbol": "GBPUSD", "name": "GBP / USD", "yahoo": "GBPUSD=X", "kind": "fx"},
            {"symbol": "USDJPY", "name": "USD / JPY", "yahoo": "USDJPY=X", "kind": "fx"},
            {"symbol": "USDCHF", "name": "USD / CHF", "yahoo": "USDCHF=X", "kind": "fx"},
            {"symbol": "AUDUSD", "name": "AUD / USD", "yahoo": "AUDUSD=X", "kind": "fx"},
            {"symbol": "USDCAD", "name": "USD / CAD", "yahoo": "USDCAD=X", "kind": "fx"},
        ],
    },
    {
        "id": "cross",
        "title": "Cruzados",
        "subtitle": "Sin USD",
        "items": [
            {"symbol": "EURGBP", "name": "EUR / GBP", "yahoo": "EURGBP=X", "kind": "fx"},
            {"symbol": "EURJPY", "name": "EUR / JPY", "yahoo": "EURJPY=X", "kind": "fx"},
            {"symbol": "GBPJPY", "name": "GBP / JPY", "yahoo": "GBPJPY=X", "kind": "fx"},
        ],
    },
    {
        "id": "idx",
        "title": "Índices FX",
        "subtitle": "Referencia",
        "items": [
            {"symbol": "DXY", "name": "Índice dólar", "yahoo": "DX-Y.NYB", "kind": "fx"},
        ],
    },
]

_indices_cache: dict[str, object] = {"at": 0.0, "payload": {}}
_board_cache: dict[str, object] = {"at": 0.0, "payload": {}}
_fx_cache: dict[str, object] = {"at": 0.0, "payload": {}}
INDICES_CACHE_SEC = 45


def _build_lookup(sections: list[dict], default_kind: str) -> dict[str, dict]:
    lookup: dict[str, dict] = {}
    for section in sections:
        for item in section["items"]:
            lookup[item["symbol"]] = {
                "symbol": item["symbol"],
                "ticker": item["symbol"],
                "name": item["name"],
                "yahoo": item["yahoo"],
                "board": section["id"],
                "board_title": section["title"],
                "kind": item.get("kind", default_kind),
            }
    return lookup


def get_indices_lookup() -> dict[str, dict]:
    return _build_lookup(INDICES_SECTIONS, "index")


def get_fx_lookup() -> dict[str, dict]:
    return _build_lookup(FX_SECTIONS, "fx")


@dataclass
class BoardQuote:
    symbol: str
    name: str
    price: float
    change_abs: float
    change_pct: float
    board: str
    board_title: str
    kind: str = "stock"
    fetched_at: str = ""


def _yahoo_quotes_with_change(symbols: list[str]) -> dict[str, dict]:
    import yfinance as yf

    if not symbols:
        return {}
    unique = list(dict.fromkeys(symbols))
    out: dict[str, dict] = {}
    try:
        data = yf.download(unique, period="5d", progress=False, threads=True, auto_adjust=True)
    except Exception:
        return {}

    def _extract(sym: str) -> None:
        try:
            if len(unique) == 1:
                closes = data["Close"]
            else:
                closes = data["Close"][sym]
            if closes is None or len(closes) < 1:
                return
            close = _safe_num(closes.iloc[-1], default=float("nan"))
            if not math.isfinite(close):
                return
            prev = _safe_num(closes.iloc[-2], close) if len(closes) > 1 else close
            chg = _safe_num(close - prev)
            pct = _safe_num((chg / prev * 100) if prev else 0.0)
            out[sym] = {"price": close, "change_abs": chg, "change_pct": pct}
        except (KeyError, TypeError, IndexError, AttributeError, ValueError):
            pass

    if len(unique) == 1:
        _extract(unique[0])
    else:
        for sym in unique:
            _extract(sym)

    missing = [s for s in unique if s not in out]
    for sym in missing:
        try:
            import yfinance as yf
            hist = yf.Ticker(sym).history(period="5d", auto_adjust=True)
            if hist.empty:
                continue
            close = _safe_num(hist["Close"].iloc[-1], default=float("nan"))
            if not math.isfinite(close):
                continue
            prev = _safe_num(hist["Close"].iloc[-2], close) if len(hist) > 1 else close
            chg = _safe_num(close - prev)
            out[sym] = {
                "price": close,
                "change_abs": chg,
                "change_pct": _safe_num((chg / prev * 100) if prev else 0.0),
            }
        except Exception:
            pass
    return out


def get_board_quotes() -> dict:
    """Return BMV / BIVA / SIC quote boards for the ticker banner."""
    cached_at = float(_board_cache.get("at") or 0)
    if _board_cache.get("payload") and time.time() - cached_at < INDICES_CACHE_SEC:
        return _board_cache["payload"]  # type: ignore[return-value]

    now = datetime.now().isoformat(timespec="seconds")
    symbol_map: dict[str, tuple[dict, dict]] = {}
    for section in BOARD_SECTIONS:
        for item in section["items"]:
            yahoo = item["yahoo"]
            symbol_map.setdefault(yahoo, (section, item))

    prices = _yahoo_quotes_with_change(list(symbol_map.keys()))

    sections_out = []
    flat: list[dict] = []
    for section in BOARD_SECTIONS:
        rows = []
        for item in section["items"]:
            yahoo = item["yahoo"]
            px = prices.get(yahoo)
            if not px:
                continue
            row = {
                "symbol": item["symbol"],
                "name": item["name"],
                "price": px["price"],
                "change_abs": px["change_abs"],
                "change_pct": px["change_pct"],
                "kind": item.get("kind", "stock"),
                "board": section["id"],
                "board_title": section["title"],
                "fetched_at": now,
            }
            rows.append(row)
            flat.append(row)
        if rows:
            sections_out.append({
                "id": section["id"],
                "title": section["title"],
                "subtitle": section["subtitle"],
                "quotes": rows,
            })

    payload = {
        "sections": sections_out,
        "quotes": flat,
        "fetched_at": now,
        "count": len(flat),
    }
    _board_cache["at"] = time.time()
    _board_cache["payload"] = payload
    return payload


def get_indices_quotes() -> dict:
    """Quotes for market indices and FX — no stocks or ETFs."""
    cached_at = float(_indices_cache.get("at") or 0)
    if _indices_cache.get("payload") and time.time() - cached_at < INDICES_CACHE_SEC:
        return _indices_cache["payload"]  # type: ignore[return-value]

    now = datetime.now().isoformat(timespec="seconds")
    symbol_map: dict[str, tuple[dict, dict]] = {}
    for section in INDICES_SECTIONS:
        for item in section["items"]:
            if item.get("kind", "index") not in INDICES_ONLY_KINDS:
                continue
            symbol_map.setdefault(item["yahoo"], (section, item))

    prices = _yahoo_quotes_with_change(list(symbol_map.keys()))

    sections_out: list[dict] = []
    items_out: list[dict] = []
    for section in INDICES_SECTIONS:
        rows = []
        for item in section["items"]:
            if item.get("kind", "index") not in INDICES_ONLY_KINDS:
                continue
            px = prices.get(item["yahoo"])
            if not px:
                continue
            row = {
                "symbol": item["symbol"],
                "name": item["name"],
                "yahoo": item["yahoo"],
                "price": px["price"],
                "change_abs": px["change_abs"],
                "change_pct": px["change_pct"],
                "kind": item.get("kind", "index"),
                "board": section["id"],
                "board_title": section["title"],
                "fetched_at": now,
            }
            rows.append(row)
            items_out.append(row)
        if rows:
            sections_out.append({
                "id": section["id"],
                "title": section["title"],
                "subtitle": section["subtitle"],
                "quotes": rows,
            })

    payload = {
        "sections": sections_out,
        "items": items_out,
        "fetched_at": now,
        "count": len(items_out),
    }
    _indices_cache["at"] = time.time()
    _indices_cache["payload"] = payload
    return payload


def get_fx_quotes() -> dict:
    """Quotes for FX pairs and dollar index."""
    cached_at = float(_fx_cache.get("at") or 0)
    if _fx_cache.get("payload") and time.time() - cached_at < INDICES_CACHE_SEC:
        return _fx_cache["payload"]  # type: ignore[return-value]

    now = datetime.now().isoformat(timespec="seconds")
    symbol_map: dict[str, tuple[dict, dict]] = {}
    for section in FX_SECTIONS:
        for item in section["items"]:
            symbol_map.setdefault(item["yahoo"], (section, item))

    prices = _yahoo_quotes_with_change(list(symbol_map.keys()))

    sections_out: list[dict] = []
    items_out: list[dict] = []
    for section in FX_SECTIONS:
        rows = []
        for item in section["items"]:
            px = prices.get(item["yahoo"])
            if not px:
                continue
            row = {
                "symbol": item["symbol"],
                "name": item["name"],
                "yahoo": item["yahoo"],
                "price": px["price"],
                "change_abs": px["change_abs"],
                "change_pct": px["change_pct"],
                "kind": "fx",
                "board": section["id"],
                "board_title": section["title"],
                "fetched_at": now,
            }
            rows.append(row)
            items_out.append(row)
        if rows:
            sections_out.append({
                "id": section["id"],
                "title": section["title"],
                "subtitle": section["subtitle"],
                "quotes": rows,
            })

    payload = {
        "sections": sections_out,
        "items": items_out,
        "fetched_at": now,
        "count": len(items_out),
    }
    _fx_cache["at"] = time.time()
    _fx_cache["payload"] = payload
    return payload
