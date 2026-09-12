"""GBM México — comisiones, IVA e ISR (misma lógica que el Excel del usuario)."""

from __future__ import annotations

# Hoja Portafolio: N$1 = 2.7% sobre costo para precio venta mínimo
MIN_SELL_MARKUP = 0.027
SELL_COMMISSION_RATE = 0.0025
IVA_RATE = 0.16
ISR_RATE = 0.10


def calc_net_sale(
    shares: float,
    avg_cost: float,
    market_price: float,
) -> dict[str, float]:
    """P&L neto si vendieras hoy al precio de mercado (comisión + IVA + ISR)."""
    shares = float(shares or 0)
    avg_cost = float(avg_cost or 0)
    market_price = float(market_price or 0)

    invested = shares * avg_cost
    gross_sale = shares * market_price
    sell_commission = gross_sale * SELL_COMMISSION_RATE
    sell_iva = sell_commission * IVA_RATE
    net_proceeds = gross_sale - sell_commission - sell_iva
    pnl_gross = gross_sale - invested
    gross_profit = net_proceeds - invested
    isr = gross_profit * ISR_RATE if gross_profit > 0 else 0.0
    net_pnl = gross_profit - isr
    net_return_pct = (net_pnl / invested * 100) if invested else 0.0

    min_sell_price = avg_cost * (1 + MIN_SELL_MARKUP) if avg_cost else 0.0

    return {
        "invested": invested,
        "gross_sale": gross_sale,
        "sell_commission": sell_commission,
        "sell_iva": sell_iva,
        "net_proceeds": net_proceeds,
        "pnl_gross": pnl_gross,
        "gross_profit": gross_profit,
        "isr": isr,
        "net_pnl": net_pnl,
        "net_return_pct": net_return_pct,
        "min_sell_price": min_sell_price,
    }


def aggregate_net_totals(holdings: list[dict]) -> dict[str, float]:
    """Suma P&L neto y costos de venta de todas las posiciones."""
    totals = {
        "invested": 0.0,
        "market_value": 0.0,
        "pnl_gross": 0.0,
        "sell_commission": 0.0,
        "sell_iva": 0.0,
        "net_proceeds": 0.0,
        "gross_profit": 0.0,
        "isr": 0.0,
        "net_pnl": 0.0,
    }
    for h in holdings:
        totals["invested"] += h.get("invested") or 0
        totals["market_value"] += h.get("market_value") or 0
        totals["pnl_gross"] += h.get("pnl_gross") or h.get("pnl") or 0
        totals["sell_commission"] += h.get("sell_commission") or 0
        totals["sell_iva"] += h.get("sell_iva") or 0
        totals["net_proceeds"] += h.get("net_proceeds") or 0
        totals["gross_profit"] += h.get("gross_profit") or 0
        totals["isr"] += h.get("isr") or 0
        totals["net_pnl"] += h.get("net_pnl") or 0
    inv = totals["invested"]
    totals["return_pct"] = (totals["pnl_gross"] / inv * 100) if inv else 0.0
    totals["net_return_pct"] = (totals["net_pnl"] / inv * 100) if inv else 0.0
    return totals


def enrich_holding(h: dict) -> dict:
    """Añade campos de P&L neto a un holding."""
    fees = calc_net_sale(
        h.get("shares") or 0,
        h.get("avg_cost") or 0,
        h.get("market_price") or 0,
    )
    h.update(fees)
    return h
