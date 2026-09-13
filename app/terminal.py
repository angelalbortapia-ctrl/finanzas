"""Bloomberg-style market terminal: charts, watchlist, news, live quotes."""

from __future__ import annotations

import math
import threading
import time
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from app.catalog import get_symbol_meta, load_catalog

MX_TZ = ZoneInfo("America/Mexico_City")

DEFAULT_CHART_SYMBOL = "IPC"
VALID_PERIODS = {"1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "max"}

PERIOD_MAP = {
    "1d": ("1d", "5m"),
    "5d": ("5d", "30m"),
    "1mo": ("1mo", "1d"),
    "3mo": ("3mo", "1d"),
    "6mo": ("6mo", "1d"),
    "1y": ("1y", "1d"),
    "2y": ("2y", "1wk"),
    "5y": ("5y", "1mo"),
    "10y": ("10y", "1mo"),
    "max": ("max", "1mo"),
}

_news_cache: dict[str, Any] = {"at": 0.0, "items": [], "version": 2}
_quote_cache: dict[str, Any] = {"at": 0.0, "data": {}}
_cache_lock = threading.Lock()
NEWS_TTL_SEC = 900
QUOTE_CACHE_SEC = 20

SPANISH_NEWS_FEEDS: list[tuple[str, str]] = [
    ("BMV", "https://news.google.com/rss/search?q=bolsa+mexicana+BMV+IPC&hl=es-MX&gl=MX&ceid=MX:es-419"),
    ("Mercados", "https://news.google.com/rss/search?q=mercados+financieros+mexico&hl=es-MX&gl=MX&ceid=MX:es-419"),
    ("Banxico", "https://news.google.com/rss/search?q=Banxico+tasa+decision&hl=es-MX&gl=MX&ceid=MX:es-419"),
    ("SIC", "https://news.google.com/rss/search?q=SIC+BMV+acciones&hl=es-MX&gl=MX&ceid=MX:es-419"),
]

BANXICO_MEETING_MONTHS = (2, 3, 5, 6, 8, 9, 11, 12)
EARNINGS_MONTHS = (1, 4, 7, 10)


def _now() -> str:
    return datetime.now(MX_TZ).isoformat(timespec="seconds")


def get_market_status() -> dict[str, Any]:
    now = datetime.now(MX_TZ)
    open_time = now.replace(hour=8, minute=30, second=0, microsecond=0)
    close_time = now.replace(hour=15, minute=0, second=0, microsecond=0)
    is_weekday = now.weekday() < 5
    is_open = is_weekday and open_time <= now <= close_time
    if not is_weekday:
        status, label = "closed", "Fin de semana"
    elif now < open_time:
        status, label = "pre", "Pre-market"
    elif now > close_time:
        status, label = "after", "Cierre"
    else:
        status, label = "open", "Mercado abierto"
    return {
        "status": status,
        "label": label,
        "is_open": is_open,
        "time_mx": now.strftime("%H:%M:%S"),
        "date_mx": now.strftime("%d/%m/%Y"),
        "timezone": "CDMX",
    }


def _safe_float(val: Any) -> float | None:
    if val is None:
        return None
    try:
        if hasattr(val, "iloc"):
            val = val.iloc[0]
        f = float(val)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _compute_indicators(points: list[dict]) -> dict[str, list[float | None]]:
    closes = [p["c"] for p in points]
    n = len(closes)

    def sma(period: int) -> list[float | None]:
        out: list[float | None] = []
        for i in range(n):
            if i + 1 < period:
                out.append(None)
            else:
                out.append(sum(closes[i + 1 - period : i + 1]) / period)
        return out

    def rsi(period: int = 14) -> list[float | None]:
        out: list[float | None] = [None] * n
        if n < period + 1:
            return out
        gains = [0.0] * n
        losses = [0.0] * n
        for i in range(1, n):
            d = closes[i] - closes[i - 1]
            gains[i] = max(d, 0)
            losses[i] = max(-d, 0)
        avg_gain = sum(gains[1 : period + 1]) / period
        avg_loss = sum(losses[1 : period + 1]) / period
        if avg_loss == 0:
            out[period] = 100.0
        else:
            rs = avg_gain / avg_loss
            out[period] = 100 - (100 / (1 + rs))
        for i in range(period + 1, n):
            avg_gain = (avg_gain * (period - 1) + gains[i]) / period
            avg_loss = (avg_loss * (period - 1) + losses[i]) / period
            if avg_loss == 0:
                out[i] = 100.0
            else:
                rs = avg_gain / avg_loss
                out[i] = 100 - (100 / (1 + rs))
        return out

    def bollinger(period: int = 20, mult: float = 2.0) -> tuple[list[float | None], list[float | None], list[float | None]]:
        mid = sma(period)
        upper: list[float | None] = []
        lower: list[float | None] = []
        for i in range(n):
            if i + 1 < period:
                upper.append(None)
                lower.append(None)
                continue
            window = closes[i + 1 - period : i + 1]
            m = sum(window) / period
            var = sum((x - m) ** 2 for x in window) / period
            sd = var ** 0.5
            upper.append(m + mult * sd)
            lower.append(m - mult * sd)
        return mid, upper, lower

    bb_mid, bb_upper, bb_lower = bollinger(20)
    return {
        "ma20": sma(20),
        "ma50": sma(50),
        "rsi14": rsi(14),
        "bb_mid": bb_mid,
        "bb_upper": bb_upper,
        "bb_lower": bb_lower,
    }


def _format_div_ts(dt: datetime, period: str) -> str:
    if period in ("1d", "5d"):
        return dt.strftime("%Y-%m-%d %H:%M")
    return dt.strftime("%Y-%m-%d")


def _parse_chart_ts(ts: str) -> datetime | None:
    try:
        if " " in ts:
            return datetime.strptime(ts[:16], "%Y-%m-%d %H:%M")
        return datetime.strptime(ts[:10], "%Y-%m-%d")
    except ValueError:
        return None


def _fetch_chart_dividends(yahoo: str, period: str, points: list[dict]) -> tuple[list[dict], dict | None]:
    if not points or period in ("1d", "5d"):
        return [], None
    import yfinance as yf

    try:
        ticker = yf.Ticker(yahoo)
        divs = ticker.dividends
        info = ticker.info or {}
    except Exception:
        return [], None

    if divs is None or divs.empty:
        div_list: list[dict] = []
    else:
        start = _parse_chart_ts(points[0]["t"])
        div_list = []
        for idx, val in divs.items():
            amount = _safe_float(val)
            if amount is None or amount <= 0:
                continue
            dt = idx.to_pydatetime()
            if dt.tzinfo is not None:
                dt = dt.astimezone(MX_TZ).replace(tzinfo=None)
            if start and dt < start:
                continue
            div_list.append({
                "t": _format_div_ts(dt, period),
                "amount": round(amount, 4),
            })
        div_list = div_list[-30:]

    next_div = None
    ex_ts = info.get("exDividendDate")
    if ex_ts:
        try:
            ex_dt = datetime.fromtimestamp(int(ex_ts), MX_TZ)
            rate = _safe_float(info.get("dividendRate") or info.get("trailingAnnualDividendRate"))
            next_div = {
                "ex_date": ex_dt.strftime("%Y-%m-%d"),
                "amount": rate,
                "yield_pct": _safe_float(info.get("dividendYield") or info.get("trailingAnnualDividendYield")),
            }
            if rate:
                next_div["yield_pct"] = next_div.get("yield_pct") or (
                    (rate / _safe_float(info.get("regularMarketPrice") or info.get("currentPrice")) * 100)
                    if _safe_float(info.get("regularMarketPrice") or info.get("currentPrice")) else None
                )
        except (TypeError, ValueError, OSError):
            next_div = None

    return div_list, next_div


def get_chart_data(symbol: str, period: str = "6mo", compare: str = "") -> dict:
    requested = (period or "6mo").strip().lower()
    period = requested if requested in VALID_PERIODS else "6mo"
    period_fallback = requested != period
    meta = get_symbol_meta(symbol)
    if not meta:
        return {"error": "Símbolo no encontrado", "symbol": symbol}

    yahoo = meta["yahoo"]
    yf_period, interval = PERIOD_MAP.get(period, ("6mo", "1d"))
    import yfinance as yf

    try:
        hist = yf.Ticker(yahoo).history(period=yf_period, interval=interval, auto_adjust=True)
    except Exception as exc:
        return {"error": str(exc), "symbol": symbol}

    if hist is None or hist.empty:
        return {"error": "Sin datos históricos", "symbol": symbol}

    points = []
    volumes = []
    for idx, row in hist.iterrows():
        if interval in ("5m", "30m", "1h"):
            ts = idx.to_pydatetime().strftime("%Y-%m-%d %H:%M")
        else:
            ts = idx.to_pydatetime().strftime("%Y-%m-%d")
        o = _safe_float(row["Open"]) or 0
        h = _safe_float(row["High"]) or 0
        l = _safe_float(row["Low"]) or 0
        c = _safe_float(row["Close"]) or 0
        if c != c:
            continue
        points.append({"t": ts, "o": o, "h": h, "l": l, "c": c})
        vol = float(row.get("Volume") or 0)
        volumes.append({"t": ts, "v": vol if vol == vol else 0})

    indicators = _compute_indicators(points)
    dividends, dividend_next = _fetch_chart_dividends(yahoo, period, points)
    last = points[-1]["c"] if points else 0
    first = points[0]["c"] if points else 0
    chg = last - first
    chg_pct = (chg / first * 100) if first else 0

    result: dict[str, Any] = {
        "symbol": meta["symbol"],
        "name": meta["name"],
        "yahoo": yahoo,
        "board": meta.get("board", "bmv"),
        "board_title": meta.get("board_title", "BMV"),
        "period": period,
        "period_requested": requested,
        "period_fallback": period_fallback,
        "points": points,
        "volume": volumes,
        "indicators": indicators,
        "dividends": dividends,
        "dividend_next": dividend_next,
        "last": last,
        "change_abs": chg,
        "change_pct": chg_pct,
        "fetched_at": _now(),
    }

    compare_symbols = [s.strip().upper().replace("BMV:", "") for s in compare.split(",") if s.strip()]
    compares: list[dict[str, Any]] = []
    compare_colors = ["#a78bfa", "#f472b6", "#34d399", "#60a5fa", "#fbbf24"]
    main_base = points[0]["c"] if points else 0
    for i, comp_sym in enumerate(compare_symbols[:5]):
        comp_meta = get_symbol_meta(comp_sym)
        if not comp_meta:
            continue
        try:
            ch = yf.Ticker(comp_meta["yahoo"]).history(
                period=yf_period, interval=interval, auto_adjust=True
            )
            comp_points = []
            for idx, row in ch.iterrows():
                if interval in ("5m", "30m", "1h"):
                    ts = idx.to_pydatetime().strftime("%Y-%m-%d %H:%M")
                else:
                    ts = idx.to_pydatetime().strftime("%Y-%m-%d")
                c = _safe_float(row["Close"]) or 0
                if c == c:
                    comp_points.append({"t": ts, "c": c})
            if not comp_points or not points or not main_base:
                continue
            base = comp_points[0]["c"]
            comp_map = {p["t"]: p["c"] for p in comp_points}
            compare_series = []
            for p in points:
                cv = comp_map.get(p["t"])
                if cv and base:
                    compare_series.append({
                        "t": p["t"],
                        "cmp_pct": ((cv / base) - 1) * 100,
                    })
            compares.append({
                "symbol": comp_meta["symbol"],
                "name": comp_meta["name"],
                "color": compare_colors[i % len(compare_colors)],
                "series": compare_series,
            })
        except Exception:
            continue
    if compares:
        result["compares"] = compares
        result["compare"] = compares[0]

    return result


def get_quote_detail(symbol: str) -> dict:
    meta = get_symbol_meta(symbol)
    if not meta:
        return {"error": "Símbolo no encontrado"}
    import yfinance as yf

    yahoo = meta["yahoo"]
    try:
        t = yf.Ticker(yahoo)
        info = t.info or {}
        hist = t.history(period="5d", interval="1d", auto_adjust=True)
    except Exception as exc:
        return {"error": str(exc), "symbol": meta["symbol"]}

    price = _safe_float(info.get("regularMarketPrice") or info.get("currentPrice"))
    prev = _safe_float(info.get("regularMarketPreviousClose") or info.get("previousClose"))
    if hist is not None and not hist.empty:
        last_row = hist.iloc[-1]
        price = price or _safe_float(last_row["Close"])
        if len(hist) >= 2:
            prev = prev or _safe_float(hist.iloc[-2]["Close"])
        elif prev is None:
            prev = _safe_float(last_row["Open"])

    if price is None:
        return {"error": "Sin cotización", "symbol": meta["symbol"]}

    chg = (price - prev) if prev else 0
    chg_pct = (chg / prev * 100) if prev else 0

    div_yield = _safe_float(info.get("dividendYield") or info.get("trailingAnnualDividendYield"))
    div_rate = _safe_float(info.get("dividendRate") or info.get("trailingAnnualDividendRate"))
    ex_div = None
    if info.get("exDividendDate"):
        try:
            ex_div = datetime.fromtimestamp(int(info["exDividendDate"]), MX_TZ).strftime("%Y-%m-%d")
        except (TypeError, ValueError, OSError):
            ex_div = None

    return {
        "symbol": meta["symbol"],
        "name": meta["name"],
        "yahoo": yahoo,
        "board": meta.get("board", "bmv"),
        "price": price,
        "bid": _safe_float(info.get("bid")),
        "ask": _safe_float(info.get("ask")),
        "open": _safe_float(info.get("regularMarketOpen") or info.get("open")),
        "high": _safe_float(info.get("dayHigh") or info.get("regularMarketDayHigh")),
        "low": _safe_float(info.get("dayLow") or info.get("regularMarketDayLow")),
        "prev_close": prev,
        "volume": _safe_float(info.get("volume") or info.get("regularMarketVolume")),
        "avg_volume": _safe_float(info.get("averageVolume")),
        "week52_high": _safe_float(info.get("fiftyTwoWeekHigh")),
        "week52_low": _safe_float(info.get("fiftyTwoWeekLow")),
        "market_cap": _safe_float(info.get("marketCap")),
        "dividend_yield": div_yield if div_yield is not None else (
            (div_rate / price * 100) if div_rate and price else None
        ),
        "dividend_rate": div_rate,
        "ex_dividend_date": ex_div,
        "change_abs": chg,
        "change_pct": chg_pct,
        "currency": info.get("currency", "MXN"),
        "fetched_at": _now(),
        "delayed": True,
    }


def _extract_closes(data, ysym: str, multi: bool):
    try:
        if not multi:
            closes = data["Close"]
            vols = data["Volume"] if "Volume" in data else None
        else:
            closes = data["Close"][ysym]
            vols = data["Volume"][ysym] if "Volume" in data.columns.get_level_values(0) else None
        return closes, vols
    except (KeyError, TypeError, AttributeError):
        return None, None


def get_live_quotes(symbols: list[str]) -> dict[str, dict]:
    now = time.time()
    resolved: dict[str, dict] = {}
    for sym in symbols[:25]:
        meta = get_symbol_meta(sym)
        if meta:
            resolved[meta["symbol"]] = meta

    if not resolved:
        return {}

    with _cache_lock:
        cached = dict(_quote_cache.get("data", {}))
        cache_fresh = now - _quote_cache["at"] < QUOTE_CACHE_SEC
    if cache_fresh:
        hits = {k: cached[k] for k in resolved if k in cached}
        if len(hits) == len(resolved):
            return hits
    else:
        hits = {}

    import yfinance as yf

    yahoo_syms = list({m["yahoo"] for m in resolved.values()})
    yahoo_to_bmv = {m["yahoo"]: sym for sym, m in resolved.items()}
    out: dict[str, dict] = {}
    multi = len(yahoo_syms) > 1

    try:
        data = yf.download(
            yahoo_syms, period="5d", interval="1d",
            progress=False, threads=True, auto_adjust=True,
        )
    except Exception:
        data = None

    for ysym in yahoo_syms:
        bmv_sym = yahoo_to_bmv[ysym]
        meta = resolved[bmv_sym]
        try:
            if data is None or data.empty:
                continue
            closes, vols = _extract_closes(data, ysym, multi)
            if closes is None or len(closes) == 0:
                continue
            price = _safe_float(closes.iloc[-1])
            prev = _safe_float(closes.iloc[-2]) if len(closes) >= 2 else price
            if price is None:
                continue
            chg = (price - prev) if prev else 0
            vol = _safe_float(vols.iloc[-1]) if vols is not None and len(vols) else None
            out[bmv_sym] = {
                "symbol": bmv_sym,
                "name": meta["name"],
                "price": price,
                "prev_close": prev,
                "change_abs": chg,
                "change_pct": (chg / prev * 100) if prev else 0,
                "volume": vol,
                "fetched_at": _now(),
            }
        except Exception:
            continue

    with _cache_lock:
        _quote_cache["at"] = now
        _quote_cache["data"] = {**cached, **out}
    merged = {**hits, **out}
    return {sym: merged[sym] for sym in resolved if sym in merged}


_tiie_cache: dict[str, Any] = {"at": 0.0, "price": None, "note": ""}


def _fetch_tiie28() -> dict[str, Any]:
    """TIIE 28d — Banxico SIE si hay token; si no, último valor cacheado o referencia."""
    now = time.time()
    if _tiie_cache.get("price") and now - float(_tiie_cache.get("at") or 0) < 3600:
        return {
            "id": "TIIE28",
            "label": "TIIE 28d",
            "price": _tiie_cache["price"],
            "change_pct": 0,
            "unit": "%",
            "note": _tiie_cache.get("note") or "Ref.",
        }

    price: float | None = None
    note = "Ref. estática"

    from app.config import BANXICO_API_KEY

    if BANXICO_API_KEY:
        try:
            import json
            import urllib.request

            url = "https://www.banxico.org.mx/SieAPIRest/service/v1/series/SF43783/datos/oportuno"
            req = urllib.request.Request(url, headers={"Bmx-Token": BANXICO_API_KEY})
            with urllib.request.urlopen(req, timeout=10) as resp:
                payload = json.loads(resp.read().decode())
            datos = (payload.get("bmx") or {}).get("series", [{}])[0].get("datos", [])
            if datos:
                price = _safe_float(datos[0].get("dato"))
                note = "Banxico"
        except Exception:
            pass

    if price is None:
        try:
            from app.database import get_db

            conn = get_db()
            row = conn.execute("SELECT value FROM schema_meta WHERE key = 'tiie28'").fetchone()
            conn.close()
            if row and row["value"]:
                price = _safe_float(row["value"])
                note = "Caché"
        except Exception:
            pass

    if price is None:
        price = 9.75
        note = "Ref. estática"

    if note == "Banxico":
        try:
            from app.database import get_db

            conn = get_db()
            conn.execute(
                """INSERT INTO schema_meta (key, value) VALUES ('tiie28', ?)
                   ON CONFLICT(key) DO UPDATE SET value = excluded.value""",
                (str(price),),
            )
            conn.commit()
            conn.close()
        except Exception:
            pass

    _tiie_cache.update({"at": now, "price": price, "note": note})
    return {
        "id": "TIIE28",
        "label": "TIIE 28d",
        "price": price,
        "change_pct": 0,
        "unit": "%",
        "note": note,
    }


def get_fx_panel() -> list[dict]:
    import yfinance as yf

    pairs = [
        ("USDMXN", "USDMXN=X", "USD/MXN"),
        ("EURMXN", "EURMXN=X", "EUR/MXN"),
    ]
    out = []
    for key, ysym, label in pairs:
        try:
            t = yf.Ticker(ysym)
            info = t.info or {}
            hist = t.history(period="2d")
            price = _safe_float(info.get("regularMarketPrice"))
            prev = _safe_float(info.get("regularMarketPreviousClose"))
            if hist is not None and not hist.empty:
                price = price or _safe_float(hist["Close"].iloc[-1])
                if len(hist) >= 2:
                    prev = prev or _safe_float(hist["Close"].iloc[-2])
            if price:
                chg = (price - prev) if prev else 0
                out.append({
                    "id": key,
                    "label": label,
                    "price": price,
                    "change_pct": (chg / prev * 100) if prev else 0,
                })
        except Exception:
            pass
    out.append(_fetch_tiie28())
    return out


def _last_weekday_of_month(year: int, month: int, weekday: int):
    from calendar import monthrange

    last_day = monthrange(year, month)[1]
    d = datetime(year, month, last_day, tzinfo=MX_TZ).date()
    while d.weekday() != weekday:
        d -= timedelta(days=1)
    return d


def _generate_economic_events(start_year: int, end_year: int) -> list[dict[str, str]]:
    events: list[dict[str, str]] = []
    for year in range(start_year, end_year + 1):
        for month in BANXICO_MEETING_MONTHS:
            d = _last_weekday_of_month(year, month, 3)
            events.append({
                "date": d.isoformat(),
                "time": "12:00",
                "event": "Banxico · Decisión de tasa",
                "impact": "high",
                "country": "MX",
            })
        for month in EARNINGS_MONTHS:
            d = datetime(year, month, 15, tzinfo=MX_TZ).date()
            if d.weekday() >= 5:
                d += timedelta(days=(7 - d.weekday()))
            events.append({
                "date": d.isoformat(),
                "time": "08:30",
                "event": "BMV · Temporada de reportes",
                "impact": "medium",
                "country": "MX",
            })
        for month in range(1, 13):
            d = datetime(year, month, 13, tzinfo=MX_TZ).date()
            if d.weekday() >= 5:
                d += timedelta(days=(7 - d.weekday()))
            events.append({
                "date": d.isoformat(),
                "time": "14:30",
                "event": "EU · CPI inflación",
                "impact": "high",
                "country": "US",
            })
        events.append({
            "date": f"{year}-12-31",
            "time": "14:00",
            "event": "BMV · Cierre de año",
            "impact": "medium",
            "country": "MX",
        })
    return events


def get_economic_calendar(limit: int = 12) -> list[dict]:
    today = datetime.now(MX_TZ).date()
    events = _generate_economic_events(today.year - 1, today.year + 1)
    upcoming = []
    for ev in events:
        try:
            d = datetime.strptime(ev["date"], "%Y-%m-%d").date()
        except ValueError:
            continue
        if d >= today - timedelta(days=7):
            upcoming.append({**ev, "days_away": (d - today).days})
    upcoming.sort(key=lambda x: x["date"])
    deduped: list[dict] = []
    seen: set[str] = set()
    for ev in upcoming:
        key = f"{ev['date']}|{ev['event']}"
        if key in seen:
            continue
        seen.add(key)
        deduped.append(ev)
    return deduped[:limit]


def _parse_rss_date(raw: str | None) -> str:
    if not raw:
        return _now()
    from email.utils import parsedate_to_datetime
    try:
        return parsedate_to_datetime(raw).isoformat(timespec="seconds")
    except Exception:
        return raw.replace("Z", "")[:19]


def _fetch_google_rss(url: str, tag: str, limit: int = 8) -> list[dict]:
    import re
    import urllib.request
    import xml.etree.ElementTree as ET

    articles = []
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; FinanzasTerminal/2.0)"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            root = ET.fromstring(resp.read())
        for item in root.findall(".//item")[:limit]:
            title_el = item.find("title")
            link_el = item.find("link")
            pub_el = item.find("pubDate")
            if title_el is None or not title_el.text:
                continue
            desc_el = item.find("description")
            summary = ""
            if desc_el is not None and desc_el.text:
                summary = re.sub(r"<[^>]+>", "", desc_el.text)[:200]
            source_el = item.find("source")
            publisher = source_el.text if source_el is not None and source_el.text else "Google Noticias"
            articles.append({
                "title": title_el.text.strip(),
                "summary": summary,
                "url": (link_el.text or "").strip() if link_el is not None else "",
                "publisher": publisher,
                "published_at": _parse_rss_date(pub_el.text if pub_el is not None else None),
                "symbol": tag,
                "source": "google-es",
            })
    except Exception:
        pass
    return articles


INDEX_NEWS_QUERIES: dict[str, str] = {
    "IPC": "IPC+bolsa+mexicana+BMV+mercados",
    "INMEX": "INMEX+bolsa+mexicana",
    "SPX": "S%26P+500+wall+street+mercados",
    "DJI": "Dow+Jones+mercados+financieros",
    "NDX": "Nasdaq+100+tecnología+mercados",
    "IXIC": "Nasdaq+mercados",
    "VIX": "volatilidad+VIX+mercados",
    "STOXX": "Euro+Stoxx+mercados+europa",
    "DAX": "DAX+bolsa+alemana",
    "FTSE": "FTSE+bolsa+londres",
    "NIKKEI": "Nikkei+bolsa+japonesa",
    "HSI": "Hang+Seng+bolsa+china",
    "BOVESPA": "Bovespa+bolsa+brasil",
    "USDMXN": "tipo+cambio+peso+dólar+Banxico",
    "EURMXN": "euro+peso+mexicano+tipo+cambio",
    "GBPMXN": "libra+peso+mexicano+tipo+cambio",
    "EURUSD": "euro+dólar+tipo+cambio+forex",
    "GBPUSD": "libra+dólar+forex",
    "USDJPY": "dólar+yen+forex",
    "DXY": "índice+dólar+divisas",
}


def get_market_news(limit: int = 30, symbol: str = "") -> list[dict]:
    if symbol:
        sym = symbol.strip().upper().replace("BMV:", "")
        meta = get_symbol_meta(sym)
        if sym in INDEX_NEWS_QUERIES:
            q = INDEX_NEWS_QUERIES[sym]
        else:
            name = meta["name"] if meta else sym
            kind = (meta or {}).get("kind", "stock")
            if kind in ("index", "fx"):
                q = f"{sym}+{name.split()[0]}+mercados+financieros"
            else:
                q = f"{meta['symbol']}+{name.split()[0]}+BMV" if meta else sym
        url = f"https://news.google.com/rss/search?q={q}&hl=es-MX&gl=MX&ceid=MX:es-419"
        items = _fetch_google_rss(url, meta["symbol"] if meta else sym, limit)
        if items:
            return items

    now = time.time()
    with _cache_lock:
        cache_ok = (
            _news_cache["items"]
            and _news_cache.get("version") == 2
            and now - _news_cache["at"] < NEWS_TTL_SEC
        )
        if cache_ok:
            return list(_news_cache["items"][:limit])

    articles: list[dict] = []
    seen: set[str] = set()
    for tag, feed_url in SPANISH_NEWS_FEEDS:
        for a in _fetch_google_rss(feed_url, tag, 6):
            key = a["title"].lower()[:100]
            if key not in seen:
                seen.add(key)
                articles.append(a)

    articles.sort(key=lambda x: x.get("published_at") or "", reverse=True)
    with _cache_lock:
        _news_cache["at"] = now
        _news_cache["items"] = articles
    return articles[:limit]


def get_portfolio_live() -> dict:
    """Portfolio from DB snapshot — same numbers as dashboard (refresh via /inversiones/refresh)."""
    from app.database import get_db
    from app.gbm_fees import enrich_holding
    from app.market import get_price_meta, source_label

    conn = get_db()
    holdings = conn.execute(
        "SELECT * FROM investment_holdings WHERE shares > 0 ORDER BY market_value DESC"
    ).fetchall()
    snap_row = conn.execute(
        "SELECT * FROM investment_snapshot ORDER BY id DESC LIMIT 1"
    ).fetchone()
    conn.close()

    price_meta = get_price_meta()
    if not holdings:
        return {"holdings": [], "snapshot": None, "price_meta": price_meta}

    rows = []
    total_mv = total_inv = total_pnl = total_net = 0.0
    pre_mv = sum((dict(h).get("market_value") or 0) for h in holdings)
    for h in holdings:
        row = dict(h)
        sym = row["ticker"].replace("BMV:", "")
        enrich_holding(row)
        total_mv += row.get("market_value") or 0
        total_inv += (row.get("avg_cost") or 0) * (row.get("shares") or 0)
        total_pnl += row.get("pnl") or 0
        total_net += row.get("net_pnl") or 0
        mv = row.get("market_value") or 0
        rows.append({
            "ticker": row["ticker"],
            "symbol": sym,
            "name": row["name"],
            "shares": row["shares"],
            "avg_cost": row["avg_cost"],
            "market_price": row["market_price"],
            "market_value": mv,
            "pnl": row["pnl"],
            "net_pnl": row.get("net_pnl", 0),
            "weight_pct": (mv / pre_mv * 100) if pre_mv else 0,
            "change_pct": 0,
            "price_source": row.get("price_source"),
        })

    if snap_row:
        snap = dict(snap_row)
        snapshot = {
            "market_value": float(snap.get("market_value") or total_mv),
            "invested": float(snap.get("invested") or total_inv),
            "pnl": float(snap.get("pnl") or total_pnl),
            "net_pnl": total_net,
            "return_pct": float(snap.get("return_pct") or 0),
            "net_return_pct": (total_net / total_inv * 100) if total_inv else 0,
            "fetched_at": snap.get("price_fetched_at") or snap.get("updated_at"),
            "price_source": snap.get("price_source"),
            "price_label": source_label(snap.get("price_source") or "excel"),
            "price_mode": "snapshot",
        }
    else:
        snapshot = {
            "market_value": total_mv,
            "invested": total_inv,
            "pnl": total_pnl,
            "net_pnl": total_net,
            "return_pct": (total_pnl / total_inv * 100) if total_inv else 0,
            "net_return_pct": (total_net / total_inv * 100) if total_inv else 0,
            "fetched_at": price_meta.get("fetched_at"),
            "price_source": price_meta.get("source"),
            "price_label": price_meta.get("source_label"),
            "price_mode": "snapshot",
        }

    return {
        "holdings": rows,
        "snapshot": snapshot,
        "price_meta": price_meta,
    }


def get_terminal_context(holdings: list[dict] | None = None) -> dict:
    """Contexto liviano — gráficas y cotizaciones se cargan por API en el cliente."""
    default_symbol = DEFAULT_CHART_SYMBOL
    if holdings:
        sym = holdings[0].get("ticker", "").replace("BMV:", "")
        if get_symbol_meta(sym):
            default_symbol = sym

    return {
        "board": {"quotes": [], "sections": []},
        "chart": None,
        "default_symbol": default_symbol,
        "catalog": [],
        "catalog_count": len(load_catalog()),
        "news": [],
        "fx": [],
        "calendar": get_economic_calendar(8),
        "market": get_market_status(),
        "periods": [
            {"id": "1d", "label": "1D", "key": "1"},
            {"id": "5d", "label": "5D", "key": "2"},
            {"id": "1mo", "label": "1M", "key": "3"},
            {"id": "3mo", "label": "3M", "key": "4"},
            {"id": "6mo", "label": "6M", "key": "5"},
            {"id": "1y", "label": "1A", "key": "6"},
            {"id": "2y", "label": "2A", "key": "7"},
            {"id": "5y", "label": "5A", "key": "8"},
            {"id": "10y", "label": "10A", "key": "9"},
            {"id": "max", "label": "MAX", "key": "0"},
        ],
    }
