"""Catálogo BMV/BIVA/SIC desde Excel Emisoras + watchlist base."""

from __future__ import annotations

import functools
from pathlib import Path
from typing import Any

from app.bmv_board import BOARD_SECTIONS, get_fx_lookup, get_indices_lookup
from app.config import GBM_EXCEL_PATH

YAHOO_OVERRIDES: dict[str, str] = {
    "IPC": "^MXX",
    "NAFTRAC": "NAFTRACISHRS.MX",
    "IVVPESO": "IVVPESOISHRS.MX",
    "VMEX19": "VMEX19.MX",
    "SPX": "^GSPC",
    "DJI": "^DJI",
    "NDX": "^NDX",
    "IXIC": "^IXIC",
    "RUT": "^RUT",
    "VIX": "^VIX",
    "STOXX": "^STOXX50E",
    "DAX": "^GDAXI",
    "FTSE": "^FTSE",
    "CAC": "^FCHI",
    "IBEX": "^IBEX",
    "USDMXN": "USDMXN=X",
    "EURMXN": "EURMXN=X",
    "EURUSD": "EURUSD=X",
    "DXY": "DX-Y.NYB",
    "BTC": "BTC-USD",
    "INMEX": "INMEX.MX",
    "NIKKEI": "^N225",
    "HSI": "^HSI",
    "KOSPI": "^KS11",
    "SSEC": "000001.SS",
    "BOVESPA": "^BVSP",
    "MERV": "^MERV",
    "GBPMXN": "GBPMXN=X",
    "CADMXN": "CADMXN=X",
    "JPYMXN": "JPYMXN=X",
    "GBPUSD": "GBPUSD=X",
    "USDJPY": "USDJPY=X",
    "USDCHF": "USDCHF=X",
    "AUDUSD": "AUDUSD=X",
    "USDCAD": "USDCAD=X",
    "EURGBP": "EURGBP=X",
    "EURJPY": "EURJPY=X",
    "GBPJPY": "GBPJPY=X",
}

BOARD_KEYWORDS = {
    "sic": "sic",
    "etf": "bmv",
    "fibras": "bmv",
    "commodities": "bmv",
    "divisas": "bmv",
}


def bmv_to_yahoo(symbol: str) -> str:
    key = symbol.replace("BMV:", "").strip().upper()
    if key in YAHOO_OVERRIDES:
        return YAHOO_OVERRIDES[key]
    if key.startswith("^") or key.endswith(".MX"):
        return key
    return f"{key}.MX"


def _sector_board(sector: str | None) -> str:
    if not sector:
        return "bmv"
    s = sector.lower()
    for kw, board in BOARD_KEYWORDS.items():
        if kw in s:
            return board
    if s == "sic":
        return "sic"
    return "bmv"


@functools.lru_cache(maxsize=1)
def load_catalog() -> dict[str, dict[str, Any]]:
    catalog: dict[str, dict[str, Any]] = {}

    for section in BOARD_SECTIONS:
        for item in section["items"]:
            sym = item["symbol"].upper()
            catalog[sym] = {
                "symbol": sym,
                "ticker": f"BMV:{sym}" if not sym.startswith("^") else sym,
                "name": item["name"],
                "yahoo": item["yahoo"],
                "board": section["id"],
                "board_title": section["title"],
                "sector": section["subtitle"],
                "kind": item.get("kind", "stock"),
            }

    path = GBM_EXCEL_PATH
    if path.exists():
        try:
            import openpyxl

            wb = openpyxl.load_workbook(path, data_only=True)
            ws = wb["Emisoras"]
            sector = "Nacional"
            for row in ws.iter_rows(min_row=2, values_only=True):
                if not row:
                    continue
                col_a = row[0]
                if isinstance(col_a, str) and not str(col_a).startswith("BMV:") and col_a not in (
                    "Numero", "Nacional", "Ticker",
                ):
                    sector = str(col_a)
                    continue
                ticker = row[1] if len(row) > 1 else None
                if not ticker or not str(ticker).startswith("BMV:"):
                    continue
                sym = str(ticker).replace("BMV:", "").strip().upper()
                name = str(row[4] or row[3] or sym) if len(row) > 4 else sym
                quote = row[5] if len(row) > 5 else None
                board = _sector_board(sector)
                catalog[sym] = {
                    "symbol": sym,
                    "ticker": f"BMV:{sym}",
                    "name": name,
                    "yahoo": bmv_to_yahoo(sym),
                    "board": board,
                    "board_title": "SIC" if board == "sic" else "BMV",
                    "sector": sector,
                    "kind": "sic" if board == "sic" else "stock",
                    "last_quote": float(quote) if isinstance(quote, (int, float)) else None,
                }
        except Exception:
            pass

    return catalog


def get_symbol_meta(symbol: str) -> dict[str, Any] | None:
    key = symbol.strip().upper().replace("BMV:", "")
    fx = get_fx_lookup().get(key)
    if fx:
        return {**fx, "sector": ""}
    idx = get_indices_lookup().get(key)
    if idx:
        return {
            **idx,
            "ticker": f"BMV:{key}" if key == "IPC" else key,
            "sector": "",
        }
    cat = load_catalog()
    if key in cat:
        return cat[key]
    if f"BMV:{key}" in {c["ticker"] for c in cat.values()}:
        return cat.get(key)
    # Fallback: assume BMV ticker
    return {
        "symbol": key,
        "ticker": f"BMV:{key}",
        "name": key,
        "yahoo": bmv_to_yahoo(key),
        "board": "bmv",
        "board_title": "BMV",
        "sector": "",
        "kind": "stock",
    }


def search_catalog(query: str, limit: int = 25) -> list[dict[str, Any]]:
    q = (query or "").strip().upper()
    if not q:
        return list_catalog(limit=limit)
    cat = load_catalog()
    results: list[tuple[int, dict]] = []
    for meta in cat.values():
        sym = meta["symbol"]
        name = (meta.get("name") or "").upper()
        score = 0
        if sym == q:
            score = 100
        elif sym.startswith(q):
            score = 80
        elif q in sym:
            score = 60
        elif q in name:
            score = 40
        else:
            continue
        results.append((score, meta))
    results.sort(key=lambda x: (-x[0], x[1]["symbol"]))
    return [m for _, m in results[:limit]]


def list_catalog(board: str | None = None, limit: int = 500) -> list[dict[str, Any]]:
    cat = load_catalog()
    items = list(cat.values())
    if board and board != "all":
        items = [i for i in items if i.get("board") == board]
    items.sort(key=lambda x: x["symbol"])
    return items[:limit]


def catalog_count() -> int:
    return len(load_catalog())
