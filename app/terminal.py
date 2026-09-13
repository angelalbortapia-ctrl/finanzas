"""Bloomberg-style market terminal: charts, watchlist, news, live quotes."""

from __future__ import annotations

import logging
import math
import threading
import time
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from app.catalog import get_symbol_meta, load_catalog

logger = logging.getLogger(__name__)

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
_chart_cache: dict[str, Any] = {"data": {}}
_cache_lock = threading.Lock()
NEWS_TTL_SEC = 900
QUOTE_CACHE_SEC = 120
CHART_CACHE_SEC = 900
FINANCIALS_CACHE_SEC = 86400
FINANCIALS_EMPTY_CACHE_SEC = 300
FIN_SECTIONS = frozenset({
    "all", "resumen", "beneficios", "ingresos", "balance", "flujo", "dividendos", "stats",
})
ALL_FIN_SECTIONS = (
    "resumen", "beneficios", "ingresos", "balance", "flujo", "dividendos", "stats",
)
_financials_cache: dict[str, Any] = {"data": {}}
_CACHE_MAX_CHART = 200
_CACHE_MAX_FINANCIALS = 80


def _cache_put(
    store: dict[str, Any],
    key: str,
    payload: dict[str, Any],
    *,
    ttl: int | None = None,
    max_items: int = 200,
) -> None:
    store["data"][key] = {
        "at": time.time(),
        "payload": payload,
        "ttl": ttl,
    }
    if len(store["data"]) > max_items:
        oldest = sorted(
            store["data"].items(),
            key=lambda item: item[1].get("at", 0),
        )
        for stale_key, _ in oldest[: len(store["data"]) - max_items]:
            store["data"].pop(stale_key, None)


def _cache_get(store: dict[str, Any], key: str, default_ttl: int) -> dict[str, Any] | None:
    cached = store["data"].get(key)
    if not cached:
        return None
    ttl = cached.get("ttl") or default_ttl
    if time.time() - cached.get("at", 0) >= ttl:
        store["data"].pop(key, None)
        return None
    return cached

STATEMENT_LABELS_ES: dict[str, str] = {
    "Total Revenue": "Ingresos totales",
    "Operating Revenue": "Ingresos operativos",
    "Cost Of Revenue": "Costo de ventas",
    "Gross Profit": "Utilidad bruta",
    "Operating Expense": "Gastos operativos",
    "Operating Income": "Utilidad operativa",
    "EBITDA": "EBITDA",
    "Net Income": "Utilidad neta",
    "Basic EPS": "UTPA básica",
    "Diluted EPS": "UTPA diluida",
    "Total Assets": "Activos totales",
    "Total Liabilities Net Minority Interest": "Pasivos totales",
    "Stockholders Equity": "Capital contable",
    "Total Debt": "Deuda total",
    "Net Debt": "Deuda neta",
    "Cash And Cash Equivalents": "Efectivo y equivalentes",
    "Operating Cash Flow": "Flujo operativo",
    "Free Cash Flow": "Flujo de caja libre",
    "Capital Expenditure": "Inversión en capex",
    "Repurchase Of Capital Stock": "Recompra de acciones",
}

PRIORITY_STATEMENT_ROWS = (
    "Total Revenue", "Operating Revenue", "Gross Profit", "Operating Income",
    "EBITDA", "Net Income", "Basic EPS", "Total Assets",
    "Stockholders Equity", "Total Debt", "Operating Cash Flow", "Free Cash Flow",
)

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


def _hist_column(row: Any, *names: str) -> float | None:
    for name in names:
        if name in row.index:
            val = _safe_float(row[name])
            if val is not None:
                return val
    return None


def _normalize_hist_df(hist: Any) -> Any | None:
    if hist is None or getattr(hist, "empty", True):
        return None
    try:
        import pandas as pd

        if isinstance(hist.columns, pd.MultiIndex):
            hist = hist.copy()
            hist.columns = [
                str(col[0]) if isinstance(col, tuple) else str(col)
                for col in hist.columns
            ]
    except Exception:
        pass
    return hist


def _fetch_yahoo_history(yahoo: str, yf_period: str, interval: str) -> Any | None:
    import yfinance as yf

    last_err: Exception | None = None
    for attempt in range(2):
        try:
            hist = yf.Ticker(yahoo).history(
                period=yf_period, interval=interval, auto_adjust=True,
            )
            hist = _normalize_hist_df(hist)
            if hist is not None and not hist.empty:
                return hist
        except Exception as exc:
            last_err = exc
        try:
            hist = yf.download(
                yahoo,
                period=yf_period,
                interval=interval,
                auto_adjust=True,
                progress=False,
                threads=False,
            )
            hist = _normalize_hist_df(hist)
            if hist is not None and not hist.empty:
                return hist
        except Exception as exc:
            last_err = exc
        if attempt == 0:
            time.sleep(0.4)
    if last_err:
        raise last_err
    return None


def _hist_to_points(hist: Any, interval: str) -> tuple[list[dict], list[dict]]:
    points: list[dict] = []
    volumes: list[dict] = []
    for idx, row in hist.iterrows():
        if interval in ("5m", "30m", "1h"):
            ts = idx.to_pydatetime().strftime("%Y-%m-%d %H:%M")
        else:
            ts = idx.to_pydatetime().strftime("%Y-%m-%d")
        o = _hist_column(row, "Open", "open") or 0
        h = _hist_column(row, "High", "high") or 0
        l = _hist_column(row, "Low", "low") or 0
        c = _hist_column(row, "Close", "close") or 0
        if c != c:
            continue
        points.append({"t": ts, "o": o, "h": h, "l": l, "c": c})
        vol = _hist_column(row, "Volume", "volume") or 0
        volumes.append({"t": ts, "v": vol if vol == vol else 0})
    return points, volumes


def _stretch_flat_price(price: float, days: int = 45) -> list[dict]:
    """Último recurso: línea plana para que la gráfica no quede vacía."""
    today = datetime.now(MX_TZ).date()
    return [
        {
            "t": (today - timedelta(days=offset)).strftime("%Y-%m-%d"),
            "o": price,
            "h": price,
            "l": price,
            "c": price,
        }
        for offset in range(days, -1, -1)
    ]


def _fallback_chart_points(symbol: str, meta: dict) -> list[dict]:
    from app.database import get_db
    from app.market import get_price_history

    sym = (meta.get("symbol") or symbol or "").replace("BMV:", "").upper()
    ticker = meta.get("ticker") or sym
    yahoo = meta.get("yahoo")
    rows = get_price_history(ticker, limit=180)
    points: list[dict] = []
    for row in rows:
        price = _safe_float(row.get("price"))
        if price is None:
            continue
        raw_ts = str(row.get("recorded_at") or "")
        ts = raw_ts[:10]
        if len(ts) < 10:
            continue
        points.append({"t": ts, "o": price, "h": price, "l": price, "c": price})

    if len(points) >= 2:
        return points

    with _cache_lock:
        for key in (sym, yahoo):
            q = _quote_cache.get("data", {}).get(key or "")
            if q and q.get("price"):
                return _stretch_flat_price(float(q["price"]))

    conn = get_db()
    try:
        last_price = None
        for key in dict.fromkeys(filter(None, [ticker, f"BMV:{sym}", sym, yahoo, f"^{sym}"])):
            cached = conn.execute(
                "SELECT price FROM price_cache WHERE ticker = ? LIMIT 1",
                (key,),
            ).fetchone()
            if cached and cached["price"]:
                last_price = float(cached["price"])
                break
        if last_price is None:
            holding = conn.execute(
                """SELECT market_price FROM investment_holdings
                   WHERE ticker IN (?, ?, ?) LIMIT 1""",
                (ticker, f"BMV:{sym}", sym),
            ).fetchone()
            if holding and holding["market_price"]:
                last_price = float(holding["market_price"])
        if last_price is None:
            index_row = conn.execute(
                "SELECT quote FROM market_indices WHERE ticker = ? LIMIT 1",
                (sym,),
            ).fetchone()
            if index_row and index_row["quote"]:
                last_price = float(index_row["quote"])
        if last_price is None and sym == "IPC":
            hist_row = conn.execute(
                """SELECT price FROM price_history
                   WHERE ticker IN ('^MXX', 'IPC', 'BMV:IPC') ORDER BY recorded_at DESC LIMIT 1"""
            ).fetchone()
            if hist_row and hist_row["price"]:
                last_price = float(hist_row["price"])
    finally:
        conn.close()

    if last_price is not None:
        today = datetime.now(MX_TZ).strftime("%Y-%m-%d")
        if points:
            last_point = points[-1]
            if last_point.get("t") == today:
                last_point.update({
                    "o": last_price,
                    "h": last_price,
                    "l": last_price,
                    "c": last_price,
                })
            else:
                points.append({
                    "t": today,
                    "o": last_price,
                    "h": last_price,
                    "l": last_price,
                    "c": last_price,
                })
            return points
        return _stretch_flat_price(last_price)

    return points


def _persist_chart_points(meta: dict, points: list[dict], source: str = "yahoo_chart") -> None:
    """Guarda cierres en price_history para respaldo offline."""
    if len(points) < 2:
        return
    from app.database import get_db

    sym = (meta.get("symbol") or "").replace("BMV:", "").upper()
    keys = list(dict.fromkeys(filter(None, [sym, f"BMV:{sym}", meta.get("yahoo")])))
    conn = get_db()
    try:
        for p in points[-120:]:
            price = _safe_float(p.get("c"))
            if price is None:
                continue
            raw_t = str(p.get("t") or "")
            recorded = raw_t if " " in raw_t else f"{raw_t[:10]}T16:00:00"
            if len(recorded) < 10:
                continue
            for key in keys:
                conn.execute(
                    """INSERT OR IGNORE INTO price_history (ticker, price, source, recorded_at)
                       VALUES (?, ?, ?, ?)""",
                    (key, price, source, recorded),
                )
        conn.commit()
    finally:
        conn.close()


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

    cache_key = f"{meta['symbol']}|{period}|{compare}"
    now = time.time()
    with _cache_lock:
        cached = _cache_get(_chart_cache, cache_key, CHART_CACHE_SEC)
        if cached:
            return dict(cached["payload"])

    yahoo = meta["yahoo"]
    yf_period, interval = PERIOD_MAP.get(period, ("6mo", "1d"))
    import yfinance as yf

    data_source = "yahoo"
    yahoo_error = ""
    points: list[dict] = []
    volumes: list[dict] = []
    try:
        hist = _fetch_yahoo_history(yahoo, yf_period, interval)
        if hist is not None:
            points, volumes = _hist_to_points(hist, interval)
    except Exception as exc:
        yahoo_error = str(exc)

    if not points:
        with _cache_lock:
            stale = _chart_cache["data"].get(cache_key)
            stale_pts = (stale or {}).get("payload", {}).get("points") or []
        if stale_pts:
            payload = dict(stale["payload"])
            payload["stale"] = True
            payload["data_source"] = "cache"
            payload["fetched_at"] = _now()
            return payload
        points = _fallback_chart_points(symbol, meta)
        data_source = "cache" if points else "none"

    if not points:
        detail = yahoo_error or "sin respuesta de Yahoo Finance"
        return {
            "error": "Sin datos históricos — revisa tu conexión e intenta de nuevo",
            "symbol": symbol,
            "detail": detail,
        }

    if data_source == "cache":
        volumes = [{"t": p["t"], "v": 0} for p in points]

    indicators = _compute_indicators(points)
    if data_source == "yahoo":
        dividends, dividend_next = _fetch_chart_dividends(yahoo, period, points)
    else:
        dividends, dividend_next = [], None
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
        "data_source": data_source,
        "stale": data_source != "yahoo",
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

    if data_source == "yahoo" and len(points) >= 2:
        try:
            _persist_chart_points(meta, points)
        except Exception:
            pass

    with _cache_lock:
        _cache_put(_chart_cache, cache_key, dict(result), max_items=_CACHE_MAX_CHART)
    return result


def _info_pct(value: Any) -> float | None:
    val = _safe_float(value)
    if val is None:
        return None
    if abs(val) <= 1.5:
        return round(val * 100, 2)
    return round(val, 2)


def _statement_label(label: str) -> str:
    return STATEMENT_LABELS_ES.get(label, label.replace("_", " "))


def _period_label(col: Any) -> str:
    if hasattr(col, "year") and hasattr(col, "month"):
        quarter = (int(col.month) - 1) // 3 + 1
        return f"T{quarter} '{str(col.year)[-2:]}"
    if hasattr(col, "year"):
        return str(col.year)
    return str(col)[:10]


def _df_row_values(
    df: Any,
    keys: tuple[str, ...],
    *,
    require_positive: bool = False,
) -> list[dict[str, Any]]:
    if df is None or getattr(df, "empty", True):
        return []
    series = None
    for key in keys:
        if key in df.index:
            series = df.loc[key]
            break
    if series is None:
        return []
    out: list[dict[str, Any]] = []
    for col, raw in series.items():
        val = _safe_float(raw)
        if val is None:
            continue
        if require_positive and val <= 0:
            continue
        out.append({"period": _period_label(col), "value": round(val, 4)})
    out.reverse()
    return out


def _valid_margin_pct(revenue: float, net_income: float) -> float | None:
    if revenue is None or revenue <= 0:
        return None
    margin = net_income / revenue * 100
    if abs(margin) > 100:
        return None
    return round(margin, 2)


def _income_trends(annual_df: Any, quarterly_df: Any) -> dict[str, Any]:
    def pack(df: Any, annual: bool) -> dict[str, Any]:
        revenue = _df_row_values(
            df, ("Total Revenue", "Operating Revenue"), require_positive=True,
        )
        net_income = _df_row_values(df, ("Net Income",))
        ni_map = {item["period"]: item["value"] for item in net_income}
        margin: list[dict[str, Any]] = []
        clean_revenue: list[dict[str, Any]] = []
        clean_net: list[dict[str, Any]] = []
        for rev_item in revenue:
            period = rev_item["period"]
            rev = rev_item["value"]
            ni = ni_map.get(period)
            if ni is None:
                clean_revenue.append(rev_item)
                continue
            m = _valid_margin_pct(rev, ni)
            if m is None:
                continue
            clean_revenue.append(rev_item)
            clean_net.append({"period": period, "value": ni})
            margin.append({"period": period, "value": m})
        return {
            "periods": [p["period"] for p in clean_revenue],
            "revenue": clean_revenue,
            "net_income": clean_net,
            "margin_pct": margin,
            "annual": annual,
        }

    return {
        "annual": pack(annual_df, True),
        "quarterly": pack(quarterly_df, False),
    }


def _earnings_from_statement(q_income: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not q_income or not q_income.get("periods"):
        return []
    eps_row = next(
        (r for r in q_income.get("rows") or [] if r.get("key") in ("Basic EPS", "Diluted EPS")),
        None,
    )
    if not eps_row:
        return []
    out: list[dict[str, Any]] = []
    for period, val in zip(q_income["periods"], eps_row.get("values") or []):
        if val is None:
            continue
        out.append({
            "date": period,
            "period": period,
            "reported_eps": val,
            "estimate_eps": None,
            "surprise_pct": None,
            "source": "quarterly_income",
        })
    return out[-12:]


def _earnings_history(ticker: Any, info: dict) -> dict[str, Any]:
    quarterly: list[dict[str, Any]] = []
    try:
        dates = ticker.get_earnings_dates(limit=20)
        if dates is not None and not dates.empty:
            for idx, row in dates.sort_index().iterrows():
                dt = idx.to_pydatetime() if hasattr(idx, "to_pydatetime") else idx
                label = _period_label(dt) if hasattr(dt, "month") else str(dt)[:10]
                reported = _safe_float(row.get("Reported EPS"))
                estimate = _safe_float(row.get("EPS Estimate"))
                surprise = _safe_float(row.get("Surprise(%)"))
                quarterly.append({
                    "date": dt.strftime("%Y-%m-%d") if hasattr(dt, "strftime") else str(dt)[:10],
                    "period": label,
                    "reported_eps": reported,
                    "estimate_eps": estimate,
                    "surprise_pct": surprise,
                })
    except Exception:
        quarterly = []

    forward_eps = _safe_float(info.get("forwardEps"))
    next_date = None
    for key in ("earningsDate", "earningsTimestamp"):
        raw = info.get(key)
        if not raw:
            continue
        try:
            if isinstance(raw, (list, tuple)) and raw:
                raw = raw[0]
            next_date = datetime.fromtimestamp(int(raw), MX_TZ).strftime("%Y-%m-%d")
            break
        except (TypeError, ValueError, OSError):
            continue

    trailing = _safe_float(info.get("trailingEps"))
    return {
        "quarterly": quarterly,
        "next_report_date": next_date,
        "forward_eps": forward_eps,
        "trailing_eps": trailing,
        "derived_from_statement": False,
    }


def _enrich_earnings(earnings: dict[str, Any], q_income: dict[str, Any] | None) -> dict[str, Any]:
    if not earnings.get("quarterly") and q_income:
        derived = _earnings_from_statement(q_income)
        if derived:
            earnings = dict(earnings)
            earnings["quarterly"] = derived
            earnings["derived_from_statement"] = True
    return earnings


def _dividend_history(ticker: Any, info: dict) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    try:
        divs = ticker.dividends
        if divs is not None and not divs.empty:
            for idx, val in divs.tail(24).items():
                amount = _safe_float(val)
                if amount is None or amount <= 0:
                    continue
                dt = idx.to_pydatetime()
                rows.append({
                    "date": dt.strftime("%Y-%m-%d"),
                    "amount": round(amount, 4),
                })
    except Exception:
        rows = []
    div_yield = _info_pct(info.get("dividendYield") or info.get("trailingAnnualDividendYield"))
    div_rate = _safe_float(info.get("dividendRate") or info.get("trailingAnnualDividendRate"))
    ex_div = None
    if info.get("exDividendDate"):
        try:
            ex_div = datetime.fromtimestamp(int(info["exDividendDate"]), MX_TZ).strftime("%Y-%m-%d")
        except (TypeError, ValueError, OSError):
            ex_div = None
    return {
        "history": rows,
        "yield_pct": div_yield,
        "rate": div_rate,
        "ex_date": ex_div,
        "pays": bool(rows) or bool(div_rate),
    }


def _extended_statistics(info: dict, fundamentals: dict) -> list[dict[str, str]]:
    pairs = [
        ("Cap. bursátil", fundamentals.get("market_cap"), "large"),
        ("Valor empresa", fundamentals.get("enterprise_value"), "large"),
        ("P/E trailing", fundamentals.get("pe_trailing"), "ratio"),
        ("P/E forward", fundamentals.get("pe_forward"), "ratio"),
        ("P/B", fundamentals.get("price_to_book"), "ratio"),
        ("UTPA", fundamentals.get("eps"), "ratio"),
        ("Beta", fundamentals.get("beta"), "ratio"),
        ("Margen beneficio", fundamentals.get("profit_margin"), "pct"),
        ("ROE", fundamentals.get("roe"), "pct"),
        ("Ingresos", fundamentals.get("revenue"), "large"),
        ("EBITDA", fundamentals.get("ebitda"), "large"),
        ("Efectivo", fundamentals.get("total_cash"), "large"),
        ("Deuda total", fundamentals.get("total_debt"), "large"),
        ("Valor en libros", fundamentals.get("book_value"), "ratio"),
        ("Acciones en circ.", fundamentals.get("shares_outstanding"), "large"),
        ("Crec. ingresos", _info_pct(info.get("revenueGrowth")), "pct"),
        ("Crec. utilidades", _info_pct(info.get("earningsGrowth")), "pct"),
        ("Deuda/Patrimonio", _safe_float(info.get("debtToEquity")), "ratio"),
        ("Ratio corriente", _safe_float(info.get("currentRatio")), "ratio"),
        ("Sector", fundamentals.get("sector") or info.get("sector"), "text"),
        ("Industria", fundamentals.get("industry") or info.get("industry"), "text"),
    ]
    out: list[dict[str, str]] = []
    for label, val, kind in pairs:
        if val is None or val == "":
            continue
        if kind == "large":
            display = _format_large_number(float(val))
        elif kind == "pct":
            display = f"{float(val):.2f}%"
        elif kind == "ratio":
            display = f"{float(val):.2f}"
        else:
            display = str(val)
        out.append({"label": label, "value": display})
    return out


def _format_large_number(n: float) -> str:
    abs_n = abs(n)
    if abs_n >= 1e12:
        return f"${n / 1e12:.2f}T"
    if abs_n >= 1e9:
        return f"${n / 1e9:.2f}B"
    if abs_n >= 1e6:
        return f"${n / 1e6:.2f}M"
    if abs_n >= 1e4:
        return f"${n / 1e3:.1f}K"
    return f"${n:,.2f}"


def _df_to_statement(df: Any, max_rows: int = 18) -> dict[str, Any] | None:
    if df is None or getattr(df, "empty", True):
        return None
    periods: list[str] = []
    for col in df.columns:
        if hasattr(col, "year"):
            periods.append(str(col.year))
        else:
            periods.append(str(col)[:10])
    priority = {name: i for i, name in enumerate(PRIORITY_STATEMENT_ROWS)}
    indexed = list(df.iterrows())
    indexed.sort(key=lambda item: priority.get(str(item[0]), 999))
    rows: list[dict[str, Any]] = []
    for label, series in indexed[:max_rows]:
        values: list[float | None] = []
        for raw in series:
            val = _safe_float(raw)
            values.append(round(val, 2) if val is not None else None)
        rows.append({
            "label": _statement_label(str(label)),
            "key": str(label),
            "values": values,
        })
    if not rows:
        return None
    return {"periods": periods, "rows": rows}


def _df_latest_value(df: Any, keys: tuple[str, ...]) -> float | None:
    if df is None or getattr(df, "empty", True):
        return None
    for key in keys:
        if key not in df.index:
            continue
        for col in df.columns:
            val = _safe_float(df.loc[key, col])
            if val is not None:
                return val
    return None


def _dividends_from_info(info: dict) -> dict[str, Any]:
    div_yield = _safe_float(info.get("dividendYield") or info.get("trailingAnnualDividendYield"))
    if div_yield is not None and abs(div_yield) < 1:
        div_yield *= 100
    div_rate = _safe_float(info.get("dividendRate") or info.get("trailingAnnualDividendRate"))
    ex_date = None
    if info.get("exDividendDate"):
        try:
            ex_date = datetime.fromtimestamp(int(info["exDividendDate"]), MX_TZ).strftime("%Y-%m-%d")
        except (TypeError, ValueError, OSError):
            ex_date = None
    pays = bool(div_rate or div_yield or info.get("dividendRate"))
    return {
        "pays": pays,
        "yield_pct": div_yield,
        "rate": div_rate,
        "ex_date": ex_date,
        "history": [],
        "history_loaded": False,
    }


def _financials_has_statements(payload: dict[str, Any]) -> bool:
    annual = payload.get("annual") or {}
    quarterly = payload.get("quarterly") or {}
    return any(annual.values()) or any(quarterly.values())


def _financials_section_ready(payload: dict[str, Any], section: str) -> bool:
    loaded = set(payload.get("sections_loaded") or [])
    if "all" in loaded:
        return True
    if section == "all":
        return _financials_has_statements(payload)
    if section in loaded:
        if section in ("ingresos", "balance", "flujo"):
            return _financials_has_statements(payload)
        if section == "dividendos":
            return (payload.get("dividends") or {}).get("history_loaded", False)
        return True
    return False


def _merge_financials_payload(existing: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    merged = {**existing, **patch}
    for key in ("annual", "quarterly"):
        if existing.get(key) or patch.get(key):
            merged[key] = {**(existing.get(key) or {}), **(patch.get(key) or {})}
    loaded = set(existing.get("sections_loaded") or []) | set(patch.get("sections_loaded") or [])
    merged["sections_loaded"] = sorted(loaded)
    return merged


def _slice_financials(payload: dict[str, Any], section: str) -> dict[str, Any]:
    if section == "all":
        return dict(payload)
    base_keys = (
        "symbol", "name", "yahoo", "applicable", "currency",
        "message", "error", "fetched_at", "sections_loaded",
    )
    out: dict[str, Any] = {k: payload[k] for k in base_keys if k in payload}
    out["section"] = section
    if section == "resumen":
        for key in ("fundamentals", "income_trends", "earnings", "dividends", "statistics"):
            if key in payload:
                out[key] = payload[key]
    elif section == "beneficios":
        out["earnings"] = payload.get("earnings")
    elif section == "ingresos":
        out["income_trends"] = payload.get("income_trends")
        out["annual"] = {"income": (payload.get("annual") or {}).get("income")}
        out["quarterly"] = {"income": (payload.get("quarterly") or {}).get("income")}
    elif section == "balance":
        out["annual"] = {"balance": (payload.get("annual") or {}).get("balance")}
        out["quarterly"] = {"balance": (payload.get("quarterly") or {}).get("balance")}
    elif section == "flujo":
        out["annual"] = {"cashflow": (payload.get("annual") or {}).get("cashflow")}
        out["quarterly"] = {"cashflow": (payload.get("quarterly") or {}).get("cashflow")}
    elif section == "dividendos":
        out["dividends"] = payload.get("dividends")
    elif section == "stats":
        out["statistics"] = payload.get("statistics")
        out["fundamentals"] = payload.get("fundamentals")
    return out


def _cache_financials_payload(cache_key: str, payload: dict[str, Any]) -> None:
    has_data = _financials_has_statements(payload)
    has_earnings = bool((payload.get("earnings") or {}).get("quarterly"))
    cache_ttl = (
        FINANCIALS_CACHE_SEC
        if has_data or has_earnings
        else FINANCIALS_EMPTY_CACHE_SEC
    )
    with _cache_lock:
        _cache_put(
            _financials_cache,
            cache_key,
            dict(payload),
            ttl=cache_ttl,
            max_items=_CACHE_MAX_FINANCIALS,
        )


def _fetch_financials_resumen(
    meta: dict[str, Any],
    ticker: Any,
    info: dict[str, Any],
) -> dict[str, Any]:
    yahoo = meta["yahoo"]
    q_income_stmt = _df_to_statement(ticker.quarterly_financials)
    fundamentals = _quote_fundamentals(meta, info, balance_df=ticker.balance_sheet)
    earnings = _enrich_earnings(_earnings_history(ticker, info), q_income_stmt)
    return {
        "symbol": meta["symbol"],
        "name": meta["name"],
        "yahoo": yahoo,
        "applicable": True,
        "currency": info.get("currency", "MXN"),
        "fundamentals": fundamentals,
        "income_trends": _income_trends(ticker.financials, ticker.quarterly_financials),
        "earnings": earnings,
        "dividends": _dividends_from_info(info),
        "statistics": _extended_statistics(info, fundamentals),
        "fetched_at": _now(),
        "sections_loaded": ["resumen", "beneficios", "stats"],
    }


def _fetch_financials_full(
    meta: dict[str, Any],
    ticker: Any,
    info: dict[str, Any],
) -> dict[str, Any]:
    income = _df_to_statement(ticker.financials)
    balance = _df_to_statement(ticker.balance_sheet)
    cashflow = _df_to_statement(ticker.cashflow)
    q_income = _df_to_statement(ticker.quarterly_financials)
    q_balance = _df_to_statement(ticker.quarterly_balance_sheet)
    q_cashflow = _df_to_statement(ticker.quarterly_cashflow)
    fundamentals = _quote_fundamentals(meta, info, balance_df=ticker.balance_sheet)
    annual = {"income": income, "balance": balance, "cashflow": cashflow}
    quarterly = {
        "income": q_income,
        "balance": q_balance,
        "cashflow": q_cashflow,
    }
    earnings = _enrich_earnings(_earnings_history(ticker, info), q_income)
    dividends = _dividend_history(ticker, info)
    dividends["history_loaded"] = True
    result: dict[str, Any] = {
        "symbol": meta["symbol"],
        "name": meta["name"],
        "yahoo": meta["yahoo"],
        "applicable": True,
        "currency": info.get("currency", "MXN"),
        "annual": annual,
        "quarterly": quarterly,
        "income_trends": _income_trends(ticker.financials, ticker.quarterly_financials),
        "earnings": earnings,
        "dividends": dividends,
        "statistics": _extended_statistics(info, fundamentals),
        "fundamentals": fundamentals,
        "fetched_at": _now(),
        "sections_loaded": list(ALL_FIN_SECTIONS),
    }
    if not _financials_has_statements(result) and not earnings.get("quarterly"):
        result["message"] = "Estados financieros no disponibles para esta emisora en Yahoo Finance"
    return result


def get_financials_detail(symbol: str, section: str = "all") -> dict[str, Any]:
    section = (section or "all").strip().lower()
    if section not in FIN_SECTIONS:
        section = "all"

    meta = get_symbol_meta(symbol)
    if not meta:
        return {"error": "Símbolo no encontrado"}
    if meta.get("kind") in ("index", "fx"):
        return {
            "symbol": meta["symbol"],
            "name": meta["name"],
            "applicable": False,
            "message": "Los estados financieros no aplican a índices o divisas",
        }

    cache_key = meta["symbol"]
    with _cache_lock:
        cached = _cache_get(_financials_cache, cache_key, FINANCIALS_CACHE_SEC)
    payload = dict(cached["payload"]) if cached else {}

    if payload and _financials_section_ready(payload, section):
        return _slice_financials(payload, section)

    import yfinance as yf

    yahoo = meta["yahoo"]
    try:
        ticker = yf.Ticker(yahoo)
        info = ticker.info or {}
    except Exception as exc:
        logger.warning("financials fetch failed for %s: %s", yahoo, exc)
        return {
            "error": "No se pudieron obtener datos financieros",
            "symbol": meta["symbol"],
        }

    needs_full = section in ("all", "ingresos", "balance", "flujo", "dividendos")
    if needs_full or (section == "stats" and not payload.get("statistics")):
        try:
            patch = _fetch_financials_full(meta, ticker, info)
        except Exception as exc:
            logger.warning("financials full fetch failed for %s: %s", yahoo, exc)
            return {
                "error": "No se pudieron obtener datos financieros",
                "symbol": meta["symbol"],
            }
        result = _merge_financials_payload(payload, patch) if payload else patch
    else:
        try:
            patch = _fetch_financials_resumen(meta, ticker, info)
        except Exception as exc:
            logger.warning("financials resumen fetch failed for %s: %s", yahoo, exc)
            return {
                "error": "No se pudieron obtener datos financieros",
                "symbol": meta["symbol"],
            }
        result = _merge_financials_payload(payload, patch) if payload else patch

    _cache_financials_payload(cache_key, result)
    return _slice_financials(result, section)


def _quote_fundamentals(
    meta: dict,
    info: dict,
    *,
    balance_df: Any = None,
) -> dict[str, Any]:
    sector = info.get("sector") or meta.get("sector")
    industry = info.get("industry")
    price = _safe_float(info.get("regularMarketPrice") or info.get("currentPrice"))
    market_cap = _safe_float(info.get("marketCap"))
    shares_outstanding = _safe_float(info.get("sharesOutstanding"))
    market_cap_estimated = False
    shares_estimated = False
    book_value = _safe_float(info.get("bookValue"))

    if shares_outstanding is None and book_value and book_value > 0:
        equity = _df_latest_value(balance_df, (
            "Stockholders Equity",
            "Total Stockholder Equity",
            "Total Equity Gross Minority Interest",
            "Common Stock Equity",
        ))
        if equity and equity > 0:
            shares_outstanding = equity / book_value
            shares_estimated = True

    if market_cap is None:
        if shares_outstanding and price:
            market_cap = shares_outstanding * price
            market_cap_estimated = True
        else:
            ev = _safe_float(info.get("enterpriseValue"))
            debt = _safe_float(info.get("totalDebt")) or 0
            cash = _safe_float(info.get("totalCash")) or 0
            if ev is not None:
                market_cap = ev - debt + cash
                market_cap_estimated = True

    return {
        "sector": sector,
        "industry": industry,
        "kind": meta.get("kind", "stock"),
        "board": meta.get("board"),
        "board_title": meta.get("board_title"),
        "market_cap": market_cap,
        "market_cap_estimated": market_cap_estimated,
        "enterprise_value": _safe_float(info.get("enterpriseValue")),
        "pe_trailing": _safe_float(info.get("trailingPE")),
        "pe_forward": _safe_float(info.get("forwardPE")),
        "price_to_book": _safe_float(info.get("priceToBook")),
        "eps": _safe_float(info.get("trailingEps")),
        "beta": _safe_float(info.get("beta")),
        "profit_margin": _info_pct(info.get("profitMargins")),
        "roe": _info_pct(info.get("returnOnEquity")),
        "revenue": _safe_float(info.get("totalRevenue")),
        "ebitda": _safe_float(info.get("ebitda")),
        "total_cash": _safe_float(info.get("totalCash")),
        "total_debt": _safe_float(info.get("totalDebt")),
        "book_value": book_value,
        "avg_volume": _safe_float(info.get("averageVolume")),
        "shares_outstanding": shares_outstanding,
        "shares_estimated": shares_estimated,
    }


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

    fundamentals = _quote_fundamentals(meta, info)
    kind = meta.get("kind", "stock")

    return {
        "symbol": meta["symbol"],
        "name": meta["name"],
        "yahoo": yahoo,
        "board": meta.get("board", "bmv"),
        "board_title": meta.get("board_title"),
        "kind": kind,
        "price": price,
        "bid": _safe_float(info.get("bid")),
        "ask": _safe_float(info.get("ask")),
        "open": _safe_float(info.get("regularMarketOpen") or info.get("open")),
        "high": _safe_float(info.get("dayHigh") or info.get("regularMarketDayHigh")),
        "low": _safe_float(info.get("dayLow") or info.get("regularMarketDayLow")),
        "prev_close": prev,
        "volume": _safe_float(info.get("volume") or info.get("regularMarketVolume")),
        "avg_volume": fundamentals.get("avg_volume"),
        "week52_high": _safe_float(info.get("fiftyTwoWeekHigh")),
        "week52_low": _safe_float(info.get("fiftyTwoWeekLow")),
        "market_cap": fundamentals.get("market_cap"),
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
        "fundamentals_applicable": kind not in ("index", "fx"),
        "fundamentals": fundamentals,
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


def get_holding_position(symbol: str, live_price: float | None = None) -> dict[str, Any] | None:
    """Posición del portafolio local para una emisora (si existe)."""
    from app.database import get_db

    key = symbol.replace("BMV:", "").strip().upper()
    conn = get_db()
    row = conn.execute(
        """SELECT * FROM investment_holdings
           WHERE UPPER(REPLACE(ticker, 'BMV:', '')) = ? AND shares > 0
           LIMIT 1""",
        (key,),
    ).fetchone()
    conn.close()
    if not row:
        return None

    h = dict(row)
    shares = float(h.get("shares") or 0)
    avg_cost = float(h.get("avg_cost") or 0)
    price = live_price if live_price is not None else float(h.get("market_price") or 0)
    cost_basis = shares * avg_cost
    market_value = shares * price if price else float(h.get("market_value") or 0)
    pnl_abs = market_value - cost_basis
    pnl_pct = (pnl_abs / cost_basis * 100) if cost_basis else 0.0
    return {
        "ticker": key,
        "name": h.get("name"),
        "shares": shares,
        "avg_cost": avg_cost,
        "market_price": price,
        "cost_basis": round(cost_basis, 2),
        "market_value": round(market_value, 2),
        "unrealized_pnl_abs": round(pnl_abs, 2),
        "unrealized_pnl_pct": round(pnl_pct, 2),
        "weight_pct": round(float(h.get("weight_pct") or 0), 2),
        "target_weight_pct": None,
    }


def preload_portfolio_cache() -> None:
    """Precarga cotizaciones y resumen financiero de posiciones del portafolio."""
    from app.database import get_db

    conn = get_db()
    rows = conn.execute(
        "SELECT ticker FROM investment_holdings WHERE shares > 0 ORDER BY market_value DESC LIMIT 8"
    ).fetchall()
    conn.close()
    for row in rows:
        sym = str(row["ticker"]).replace("BMV:", "")
        try:
            get_quote_detail(sym)
            get_financials_detail(sym, section="resumen")
        except Exception as exc:
            logger.debug("portfolio preload failed for %s: %s", sym, exc)
