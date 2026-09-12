"""Credit card payoff simulator."""
from __future__ import annotations

from copy import deepcopy
from math import ceil


def simulate_payoff(
    cards: list[dict],
    monthly_payment: float,
    apr: float = 0.45,
    strategy: str = "avalanche",
    max_months: int = 360,
) -> dict:
    """
    Simulate paying off card balances.
    strategy: 'avalanche' (highest balance first) or 'snowball' (smallest first)
    apr: annual interest rate (default 45% typical MX credit cards)
    """
    if monthly_payment <= 0:
        return {"error": "El pago mensual debe ser mayor a 0"}

    from app.queries import card_revolving_balance as _revolving_balance

    balances = [
        {"id": c["id"], "name": c["name"], "balance": _revolving_balance(c)}
        for c in cards
        if _revolving_balance(c) > 0
    ]
    if not balances:
        return {"error": "No hay deuda que liquidar"}

    total_debt = sum(b["balance"] for b in balances)
    monthly_rate = apr / 12
    min_payment_pct = 0.05
    min_payment_floor = 200.0

    schedule = []
    month = 0
    total_interest = 0.0
    working = deepcopy(balances)

    while any(b["balance"] > 0.01 for b in working) and month < max_months:
        month += 1
        month_interest = 0.0

        for b in working:
            if b["balance"] <= 0:
                continue
            interest = b["balance"] * monthly_rate
            b["balance"] += interest
            month_interest += interest
            total_interest += interest

        remaining = monthly_payment
        for b in working:
            if b["balance"] <= 0:
                continue
            min_pay = max(min_payment_floor, b["balance"] * min_payment_pct)
            min_pay = min(min_pay, b["balance"])
            pay = min(min_pay, remaining)
            b["balance"] -= pay
            remaining -= pay

        active = [b for b in working if b["balance"] > 0.01]
        active.sort(
            key=lambda x: x["balance"],
            reverse=(strategy == "avalanche"),
        )
        for b in active:
            if remaining <= 0:
                break
            pay = min(remaining, b["balance"])
            b["balance"] -= pay
            remaining -= pay

        schedule.append({
            "month": month,
            "payment": monthly_payment,
            "interest": round(month_interest, 2),
            "remaining": round(sum(b["balance"] for b in working), 2),
            "cards": {b["name"]: round(b["balance"], 2) for b in working},
        })

    final_debt = sum(b["balance"] for b in working)
    if final_debt > 0.01:
        return {
            "error": f"Pago insuficiente. Con ${monthly_payment:,.0f}/mes no liquida la deuda en {max_months} meses.",
            "months": month,
            "remaining": final_debt,
        }

    return {
        "months": month,
        "total_debt": round(total_debt, 2),
        "total_paid": round(monthly_payment * month, 2),
        "total_interest": round(total_interest, 2),
        "monthly_payment": monthly_payment,
        "apr": apr * 100,
        "strategy": strategy,
        "schedule": schedule[-12:] if len(schedule) > 12 else schedule,
        "schedule_full_len": len(schedule),
    }
