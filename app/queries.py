from __future__ import annotations

from app.database import get_db
from app.finances import (
    compute_live_finances,
    get_patrimony_history,
    get_gbm_month_progress,
    get_payment_goal,
    get_savings_goal,
    month_close_status,
    net_change_from_history,
)
from app.history import get_portfolio_history
from app.gbm_fees import aggregate_net_totals, enrich_holding
from app.market import get_price_meta, source_label
from app.terminal import get_terminal_context
from app.payments import days_until, next_due_date, urgency

MONTH_NAMES = [
    "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]

LOAN_KIND = "loan"
SPEND_KIND = "spend"


def infer_category_kind(name: str) -> str:
    n = (name or "").lower()
    if any(k in n for k in ("préstamo", "prestamo", "apartado", "loan")):
        return LOAN_KIND
    return SPEND_KIND


def card_revolving_balance(card: dict) -> float:
    """Revolving debt only; 0 is valid and must not fall back to total balance."""
    if card.get("revolving_balance") is not None:
        return float(card["revolving_balance"])
    return float(card["balance"])


def total_revolving_debt(cards: list[dict] | None = None) -> float:
    cards = cards if cards is not None else get_cards()
    return sum(card_revolving_balance(c) for c in cards)


def _enrich_card(c: dict) -> dict:
    revolving = card_revolving_balance(c)
    loan = float(c.get("loan_balance") or 0)
    c["revolving_balance"] = revolving
    c["loan_balance"] = loan
    c["available"] = c["credit_line"] - revolving
    c["usage_pct"] = (revolving / c["credit_line"] * 100) if c["credit_line"] else 0
    due = c.get("payment_due_day")
    c["days_until_payment"] = days_until(due)
    c["next_payment_date"] = next_due_date(due)
    c["payment_urgency"] = urgency(c["days_until_payment"])
    return c


def get_cards():
    conn = get_db()
    rows = conn.execute("""
        SELECT c.id, c.name, c.credit_line, c.person_id, c.cutoff_day, c.payment_due_day,
               p.name AS person_name,
               COALESCE((SELECT SUM(amount) FROM card_categories WHERE card_id = c.id), 0) AS balance,
               COALESCE((SELECT SUM(amount) FROM card_categories
                         WHERE card_id = c.id AND COALESCE(kind, 'spend') = 'spend'), 0) AS revolving_balance,
               COALESCE((SELECT SUM(amount) FROM card_categories
                         WHERE card_id = c.id AND kind = 'loan'), 0) AS loan_balance
        FROM credit_cards c
        JOIN persons p ON p.id = c.person_id
        ORDER BY balance DESC, c.name
    """).fetchall()
    conn.close()
    return [_enrich_card(dict(r)) for r in rows]


def get_card_detail(card_id: int):
    conn = get_db()
    card = conn.execute(
        """SELECT c.*, p.name AS person_name FROM credit_cards c
           JOIN persons p ON p.id = c.person_id WHERE c.id = ?""",
        (card_id,),
    ).fetchone()
    categories = conn.execute(
        """SELECT cc.*, p.name AS person_name FROM card_categories cc
           LEFT JOIN persons p ON p.id = cc.person_id
           WHERE cc.card_id = ? ORDER BY amount DESC""",
        (card_id,),
    ).fetchall()
    conn.close()
    if not card:
        return None
    return {"card": dict(card), "categories": [dict(c) for c in categories]}


def _health(usage_pct: float) -> dict:
    score = max(5, min(100, int(100 - usage_pct * 0.85)))
    if usage_pct >= 90:
        label, color = "Crítico", "bad"
    elif usage_pct >= 75:
        label, color = "Alerta", "warn"
    elif usage_pct >= 50:
        label, color = "Moderado", "mid"
    else:
        label, color = "Saludable", "good"
    return {"score": score, "label": label, "color": color}


def get_dashboard():
    conn = get_db()
    cards = get_cards()
    other_expenses = get_other_expenses()
    upcoming = get_upcoming_payments(cards=cards, other_expenses=other_expenses)

    total_line = sum(c["credit_line"] for c in cards)
    total_balance = sum(c["balance"] for c in cards)
    total_revolving = sum(c["revolving_balance"] for c in cards)
    total_loan = sum(c["loan_balance"] for c in cards)
    total_available = sum(c["available"] for c in cards)
    usage_pct = (total_revolving / total_line * 100) if total_line else 0

    live = compute_live_finances(conn)
    inv_snap = live["investment_snapshot"]
    gbm_asset = live["gbm_live"]
    total_assets = live["total_assets"]
    unified_net = live["unified_net"]
    # Deuda total incluye préstamos/apartados; KPIs de línea usan solo revolvente

    patrimony_list = get_patrimony_history(conn)
    net_change = net_change_from_history(patrimony_list)

    asset_breakdown = [
        {"name": "GBM", "value": gbm_asset, "color": "blue"},
        {"name": "Afore", "value": live["afore"], "color": "green"},
        {"name": "Infonavit", "value": live["infonavit"], "color": "violet"},
        {"name": "PPR", "value": live["ppr"], "color": "warn"},
    ]
    if live["business"]:
        asset_breakdown.append({"name": "Negocio", "value": live["business"], "color": "cyan"})

    insights = []
    worst_card = None
    for c in cards:
        pct = c["usage_pct"]
        if not worst_card or pct > worst_card["usage_pct"]:
            worst_card = c

    if worst_card and worst_card["usage_pct"] > 50:
        insights.append({
            "title": "Tarjeta más cargada",
            "text": f"{worst_card['name']} con {worst_card['usage_pct']:.0f}% de uso",
        })
    if net_change is not None:
        direction = "subió" if net_change >= 0 else "bajó"
        insights.append({
            "title": "Patrimonio mensual",
            "text": f"Tu patrimonio {direction} ${abs(net_change):,.0f} vs mes anterior",
        })
    if total_available > 0:
        insights.append({
            "title": "Crédito disponible",
            "text": f"Tienes ${total_available:,.0f} libres en tus líneas",
        })
    if inv_snap:
        pnl = inv_snap["pnl"]
        direction = "ganancia" if pnl >= 0 else "pérdida"
        insights.insert(0, {
            "title": "Portafolio GBM",
            "text": f"${inv_snap['market_value']:,.0f} en mercado · {direction} de ${abs(pnl):,.0f}",
        })

    persons = conn.execute("SELECT * FROM persons ORDER BY name").fetchall()

    from datetime import date as _date
    _today = _date.today()
    _month_start = f"{_today.year}-{_today.month:02d}-01"
    pay_row = conn.execute(
        """SELECT COALESCE(SUM(amount), 0) AS total FROM transactions
           WHERE type = 'payment' AND date >= ? AND date <= ?""",
        (_month_start, _today.isoformat()),
    ).fetchone()
    month_payments = pay_row["total"] if pay_row else 0
    conn.close()

    close_status = month_close_status()
    savings_goal = get_savings_goal()
    savings_progress = get_gbm_month_progress()

    for ev in upcoming:
        if ev["urgency"] == "urgent" and ev["days"] <= 3:
            insights.insert(0, {
                "title": "Pago próximo",
                "text": f"{ev['name']} en {ev['days']} día(s)",
            })
            break

    return {
        "cards": cards,
        "total_line": total_line,
        "total_balance": total_balance,
        "total_revolving": total_revolving,
        "total_loan": total_loan,
        "total_available": total_available,
        "usage_pct": usage_pct,
        "health": _health(usage_pct),
        "other_expenses": other_expenses,
        "other_total": sum(abs(e["amount"]) for e in other_expenses),
        "upcoming_payments": upcoming,
        "patrimony": patrimony_list,
        "latest_patrimony": patrimony_list[-1] if patrimony_list else None,
        "net_change": net_change,
        "unified_net": unified_net,
        "total_assets": total_assets,
        "asset_breakdown": asset_breakdown,
        "gbm_live": gbm_asset,
        "investment_snapshot": inv_snap,
        "insights": insights[:5],
        "persons": [dict(p) for p in persons],
        "month_payments": month_payments,
        "payment_goal": get_payment_goal(),
        "savings_goal": savings_goal,
        "savings_progress": savings_progress,
        "month_close": close_status,
        "live_finances": live,
    }


def get_persons():
    conn = get_db()
    rows = conn.execute("SELECT * FROM persons ORDER BY name").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_other_expenses():
    conn = get_db()
    rows = conn.execute("SELECT * FROM other_expenses ORDER BY name").fetchall()
    conn.close()
    items = []
    for r in rows:
        item = dict(r)
        item["days_until_due"] = days_until(item.get("due_day"))
        item["next_due_date"] = next_due_date(item.get("due_day"))
        item["due_urgency"] = urgency(item["days_until_due"])
        items.append(item)
    return items


def get_upcoming_payments(cards=None, other_expenses=None):
    """Merged calendar: card payments + fixed expenses."""
    events = []
    if cards is None:
        cards = get_cards()
    if other_expenses is None:
        other_expenses = get_other_expenses()
    for c in cards:
        if c.get("payment_due_day") and c["days_until_payment"] is not None:
            events.append({
                "kind": "card",
                "name": c["name"],
                "amount": c["revolving_balance"],
                "days": c["days_until_payment"],
                "date": c["next_payment_date"],
                "urgency": c["payment_urgency"],
                "url": f"/tarjetas/{c['id']}",
            })
    for e in other_expenses:
        if e.get("due_day") and e["days_until_due"] is not None:
            events.append({
                "kind": "fixed",
                "name": e["name"],
                "amount": abs(e["amount"]),
                "days": e["days_until_due"],
                "date": e["next_due_date"],
                "urgency": e["due_urgency"],
                "url": None,
            })
    events.sort(key=lambda x: x["days"])
    return events


def get_latest_net_worth():
    live = compute_live_finances()
    if live["total_assets"] == 0 and live["card_debt"] == 0:
        return None
    return live["unified_net"]


def get_monthly_activity():
    """Transactions and totals for the current calendar month."""
    from datetime import date

    today = date.today()
    month_start = f"{today.year}-{today.month:02d}-01"
    month_end = today.isoformat()

    conn = get_db()
    rows = conn.execute(
        """SELECT t.*, c.name AS card_name, p.name AS person_name
           FROM transactions t
           LEFT JOIN credit_cards c ON c.id = t.card_id
           LEFT JOIN persons p ON p.id = t.person_id
           WHERE t.date >= ? AND t.date <= ?
           ORDER BY t.date DESC, t.id DESC""",
        (month_start, month_end),
    ).fetchall()
    conn.close()

    transactions = [dict(r) for r in rows]
    month_expenses = sum(t["amount"] for t in transactions if t["type"] == "expense")
    month_payments = sum(t["amount"] for t in transactions if t["type"] == "payment")

    return {
        "dashboard": get_dashboard(),
        "transactions": transactions,
        "month_expenses": month_expenses,
        "month_payments": month_payments,
        "transaction_count": len(transactions),
        "month": today.month,
        "year": today.year,
        "month_name": MONTH_NAMES[today.month],
    }


def export_holdings_csv() -> str:
    import csv
    import io

    conn = get_db()
    holdings = conn.execute(
        "SELECT * FROM investment_holdings WHERE shares > 0 ORDER BY ticker"
    ).fetchall()
    conn.close()
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "ticker", "name", "shares", "avg_cost", "market_price",
        "market_value", "pnl", "weight_pct", "price_source", "updated_at",
    ])
    for h in holdings:
        writer.writerow([
            h["ticker"], h["name"], h["shares"], h["avg_cost"], h["market_price"],
            h["market_value"], h["pnl"], h["weight_pct"], h["price_source"], h["updated_at"],
        ])
    return buf.getvalue()


def get_transactions(limit: int = 100):
    conn = get_db()
    rows = conn.execute(
        """SELECT t.*, c.name AS card_name, p.name AS person_name
           FROM transactions t
           LEFT JOIN credit_cards c ON c.id = t.card_id
           LEFT JOIN persons p ON p.id = t.person_id
           ORDER BY t.date DESC, t.id DESC LIMIT ?""",
        (limit,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def add_category(card_id: int, name: str, amount: float, person_id: int | None, kind: str | None = None):
    conn = get_db()
    cat_kind = kind or infer_category_kind(name)
    conn.execute(
        "INSERT INTO card_categories (card_id, name, amount, person_id, kind) VALUES (?, ?, ?, ?, ?)",
        (card_id, name, amount, person_id, cat_kind),
    )
    conn.commit()
    conn.close()


def update_category(card_id: int, cat_id: int, amount: float, kind: str | None = None):
    conn = get_db()
    if kind is not None:
        conn.execute(
            "UPDATE card_categories SET amount = ?, kind = ? WHERE id = ? AND card_id = ?",
            (amount, kind, cat_id, card_id),
        )
    else:
        conn.execute(
            "UPDATE card_categories SET amount = ? WHERE id = ? AND card_id = ?",
            (amount, cat_id, card_id),
        )
    conn.commit()
    conn.close()


def add_card(name: str, credit_line: float, person_id: int):
    conn = get_db()
    conn.execute(
        "INSERT INTO credit_cards (name, credit_line, person_id) VALUES (?, ?, ?)",
        (name, credit_line, person_id),
    )
    conn.commit()
    conn.close()


def add_patrimony(
    year: int,
    month: int,
    gbm: float,
    ppr: float,
    business: float,
    afore: float,
    infonavit: float,
    debt: float | None = None,
):
    """Update manual asset fields; debt defaults to live card balance."""
    live = compute_live_finances()
    card_debt = debt if debt is not None else live["card_debt"]
    gbm_val = float(gbm) if gbm is not None else live["gbm_live"]
    assets = gbm_val + ppr + business + afore + infonavit
    net_worth = assets - card_debt
    conn = get_db()
    conn.execute(
        """INSERT INTO patrimony
           (year, month, gbm, ppr, business, afore, infonavit, debt, card_debt, net_worth)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(year, month) DO UPDATE SET
             gbm=excluded.gbm, ppr=excluded.ppr, business=excluded.business,
             afore=excluded.afore, infonavit=excluded.infonavit,
             debt=excluded.debt, card_debt=excluded.card_debt, net_worth=excluded.net_worth""",
        (year, month, gbm_val, ppr, business, afore, infonavit, card_debt, card_debt, net_worth),
    )
    conn.commit()
    conn.close()


def _add_to_category(conn, card_id: int, name: str, amount: float, person_id: int | None):
    row = conn.execute(
        "SELECT id, amount FROM card_categories WHERE card_id = ? AND name = ? COLLATE NOCASE",
        (card_id, name),
    ).fetchone()
    if row:
        conn.execute(
            "UPDATE card_categories SET amount = ? WHERE id = ?",
            (row["amount"] + amount, row["id"]),
        )
    else:
        conn.execute(
            "INSERT INTO card_categories (card_id, name, amount, person_id, kind) VALUES (?, ?, ?, ?, ?)",
            (card_id, name, amount, person_id, infer_category_kind(name)),
        )


def _card_revolving_total(conn, card_id: int) -> float:
    row = conn.execute(
        """SELECT COALESCE(SUM(amount), 0) AS total FROM card_categories
           WHERE card_id = ? AND amount > 0 AND COALESCE(kind, 'spend') = 'spend'""",
        (card_id,),
    ).fetchone()
    return float(row["total"] or 0)


def _normalize_tx_type(type: str) -> str:
    t = (type or "expense").strip().lower()
    if t not in ("expense", "payment"):
        raise ValueError("Tipo de movimiento inválido")
    return t


def _apply_payment_to_card(conn, card_id: int, amount: float):
    revolving = _card_revolving_total(conn, card_id)
    remaining = min(amount, revolving)
    cats = conn.execute(
        """SELECT id, amount FROM card_categories
           WHERE card_id = ? AND amount > 0 AND COALESCE(kind, 'spend') = 'spend'
           ORDER BY amount DESC""",
        (card_id,),
    ).fetchall()
    for cat in cats:
        if remaining <= 0:
            break
        deduct = min(cat["amount"], remaining)
        conn.execute(
            "UPDATE card_categories SET amount = ? WHERE id = ?",
            (cat["amount"] - deduct, cat["id"]),
        )
        remaining -= deduct


def _apply_transaction_to_card(conn, card_id: int, amount: float, category: str, person_id: int | None, type: str):
    if not card_id or amount <= 0:
        return
    cat_name = (category or "").strip() or "Gastos varios"
    if type == "expense":
        _add_to_category(conn, card_id, cat_name, amount, person_id)
    elif type == "payment":
        _apply_payment_to_card(conn, card_id, amount)


def _reverse_transaction_on_card(conn, tx: dict):
    if not tx.get("card_id") or tx["amount"] <= 0:
        return
    card_id = tx["card_id"]
    amount = tx["amount"]
    cat_name = (tx.get("category") or "").strip() or "Gastos varios"
    person_id = tx.get("person_id")
    if tx["type"] == "expense":
        row = conn.execute(
            "SELECT id, amount FROM card_categories WHERE card_id = ? AND name = ? COLLATE NOCASE",
            (card_id, cat_name),
        ).fetchone()
        if row:
            new_amt = max(0.0, row["amount"] - amount)
            conn.execute("UPDATE card_categories SET amount = ? WHERE id = ?", (new_amt, row["id"]))
    elif tx["type"] == "payment":
        _reverse_payment_to_card(conn, card_id, amount, person_id, cat_name)


def _reverse_payment_to_card(conn, card_id: int, amount: float, person_id: int | None, cat_name: str):
    """Restore a deleted/edited payment to revolving spend."""
    _add_to_category(conn, card_id, "Pagos revertidos", amount, person_id)


def add_transaction(date: str, amount: float, description: str, category: str, card_id: int | None, person_id: int | None, type: str):
    if amount <= 0:
        raise ValueError("El monto debe ser mayor a cero")
    tx_type = _normalize_tx_type(type)
    conn = get_db()
    if tx_type == "payment" and card_id:
        revolving = _card_revolving_total(conn, card_id)
        if amount > revolving + 0.01:
            conn.close()
            raise ValueError(f"El pago excede el saldo revolvente (${revolving:,.2f})")
    conn.execute(
        """INSERT INTO transactions (date, amount, description, category, card_id, person_id, type)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (date, amount, description, category, card_id, person_id, tx_type),
    )
    _apply_transaction_to_card(conn, card_id, amount, category, person_id, tx_type)
    conn.commit()
    conn.close()


def update_transaction(
    tx_id: int,
    date: str,
    amount: float,
    description: str,
    category: str,
    card_id: int | None,
    person_id: int | None,
    type: str,
):
    if amount <= 0:
        raise ValueError("El monto debe ser mayor a cero")
    tx_type = _normalize_tx_type(type)
    conn = get_db()
    old = conn.execute("SELECT * FROM transactions WHERE id = ?", (tx_id,)).fetchone()
    if not old:
        conn.close()
        return False
    old_tx = dict(old)
    _reverse_transaction_on_card(conn, old_tx)
    if tx_type == "payment" and card_id:
        revolving = _card_revolving_total(conn, card_id)
        if amount > revolving + 0.01:
            _apply_transaction_to_card(
                conn,
                old_tx["card_id"],
                old_tx["amount"],
                old_tx.get("category") or "",
                old_tx.get("person_id"),
                old_tx["type"],
            )
            conn.commit()
            conn.close()
            raise ValueError(f"El pago excede el saldo revolvente (${revolving:,.2f})")
    conn.execute(
        """UPDATE transactions
           SET date = ?, amount = ?, description = ?, category = ?,
               card_id = ?, person_id = ?, type = ?
           WHERE id = ?""",
        (date, amount, description, category, card_id, person_id, tx_type, tx_id),
    )
    _apply_transaction_to_card(conn, card_id, amount, category, person_id, tx_type)
    conn.commit()
    conn.close()
    return True


def delete_transaction(tx_id: int) -> bool:
    conn = get_db()
    row = conn.execute("SELECT * FROM transactions WHERE id = ?", (tx_id,)).fetchone()
    if not row:
        conn.close()
        return False
    _reverse_transaction_on_card(conn, dict(row))
    conn.execute("DELETE FROM transactions WHERE id = ?", (tx_id,))
    conn.commit()
    conn.close()
    return True


def update_card_dates(card_id: int, cutoff_day: int | None, payment_due_day: int | None):
    conn = get_db()
    conn.execute(
        "UPDATE credit_cards SET cutoff_day = ?, payment_due_day = ? WHERE id = ?",
        (cutoff_day, payment_due_day, card_id),
    )
    conn.commit()
    conn.close()


def update_other_expense(expense_id: int, amount: float, due_day: int | None = None):
    conn = get_db()
    if due_day is not None:
        conn.execute(
            "UPDATE other_expenses SET amount = ?, due_day = ? WHERE id = ?",
            (amount, due_day, expense_id),
        )
    else:
        conn.execute("UPDATE other_expenses SET amount = ? WHERE id = ?", (amount, expense_id))
    conn.commit()
    conn.close()


def add_other_expense(name: str, amount: float, due_day: int | None = None):
    conn = get_db()
    conn.execute(
        "INSERT INTO other_expenses (name, amount, due_day) VALUES (?, ?, ?)",
        (name, amount, due_day),
    )
    conn.commit()
    conn.close()


def get_investments():
    conn = get_db()
    snapshot = conn.execute(
        "SELECT * FROM investment_snapshot ORDER BY id DESC LIMIT 1"
    ).fetchone()
    holdings = conn.execute(
        "SELECT * FROM investment_holdings WHERE shares > 0 ORDER BY market_value DESC"
    ).fetchall()
    indices = conn.execute(
        "SELECT * FROM market_indices ORDER BY ticker LIMIT 12"
    ).fetchall()
    last_sync = conn.execute(
        "SELECT * FROM sync_log ORDER BY id DESC LIMIT 1"
    ).fetchone()
    conn.close()

    holdings_list = [dict(h) for h in holdings]
    snapshot_dict = dict(snapshot) if snapshot else None

    if holdings_list and not snapshot_dict:
        total_mv = sum(h.get("market_value") or 0 for h in holdings_list)
        total_inv = sum((h.get("avg_cost") or 0) * (h.get("shares") or 0) for h in holdings_list)
        pnl = total_mv - total_inv
        snapshot_dict = {
            "invested": total_inv,
            "market_value": total_mv,
            "cash": 0,
            "pnl": pnl,
            "return_pct": (pnl / total_inv * 100) if total_inv else 0,
            "updated_at": None,
            "price_source": "excel",
            "price_fetched_at": None,
        }

    insights = []
    if snapshot_dict and snapshot_dict["pnl"] < 0:
        insights.append({
            "title": "Pérdida no realizada",
            "text": f"Tu portafolio está {snapshot_dict['pnl']:,.2f} por debajo del costo",
        })
    elif snapshot_dict and snapshot_dict["pnl"] > 0:
        insights.append({
            "title": "Ganancia no realizada",
            "text": f"Plusvalía de ${snapshot_dict['pnl']:,.2f} ({snapshot_dict['return_pct']:.1f}%)",
        })
    if holdings_list:
        top = holdings_list[0]
        insights.append({
            "title": "Mayor posición",
            "text": f"{top['name']} — {(top.get('weight_pct') or 0):.1f}% del portafolio",
        })

    history = get_portfolio_history()

    price_meta = get_price_meta()
    for h in holdings_list:
        enrich_holding(h)
        h["price_source_label"] = source_label(h.get("price_source") or "excel")

    if holdings_list and snapshot_dict:
        net = aggregate_net_totals(holdings_list)
        snapshot_dict["net_pnl"] = net["net_pnl"]
        snapshot_dict["net_return_pct"] = net["net_return_pct"]
        snapshot_dict["total_isr"] = net["isr"]
        snapshot_dict["total_commission"] = net["sell_commission"]
        snapshot_dict["total_iva"] = net["sell_iva"]

    terminal = get_terminal_context(holdings_list)

    return {
        "snapshot": snapshot_dict,
        "holdings": holdings_list,
        "indices": [dict(i) for i in indices],
        "history": history,
        "last_sync": dict(last_sync) if last_sync else None,
        "price_meta": price_meta,
        "board": terminal["board"],
        "terminal": terminal,
        "insights": insights[:3],
        "has_data": bool(holdings_list),
    }


def _normalize_bmv_ticker(ticker: str) -> str:
    t = (ticker or "").strip().upper().replace(" ", "")
    if not t:
        raise ValueError("Ticker vacío")
    if not t.startswith("BMV:"):
        t = f"BMV:{t}"
    return t


def upsert_holding(ticker: str, name: str, shares: float, avg_cost: float) -> None:
    """Agrega o actualiza una posición manualmente."""
    from datetime import datetime

    from app.market import fetch_quote, refresh_holdings

    ticker = _normalize_bmv_ticker(ticker)
    shares = float(shares)
    avg_cost = float(avg_cost)
    if shares <= 0:
        raise ValueError("Los títulos deben ser mayores a 0")
    if avg_cost <= 0:
        raise ValueError("El costo promedio debe ser mayor a 0")

    now = datetime.now().isoformat(timespec="seconds")
    conn = get_db()
    try:
        try:
            q = fetch_quote(conn, ticker, force=True)
        except Exception:
            q = None
        market_price = q.price if q else avg_cost
        price_source = "manual"
        price_fetched_at = q.fetched_at if q else now
        market_value = shares * market_price
        pnl = market_value - shares * avg_cost

        existing = conn.execute(
            "SELECT id FROM investment_holdings WHERE ticker = ?", (ticker,)
        ).fetchone()
        if existing:
            conn.execute(
                """UPDATE investment_holdings
                   SET name = ?, shares = ?, avg_cost = ?, market_price = ?, market_value = ?,
                       pnl = ?, updated_at = ?, price_source = ?, price_fetched_at = ?
                   WHERE ticker = ?""",
                (name.strip(), shares, avg_cost, market_price, market_value, pnl,
                 now, price_source, price_fetched_at, ticker),
            )
        else:
            conn.execute(
                """INSERT INTO investment_holdings
                   (ticker, name, shares, avg_cost, market_price, market_value, pnl,
                    weight_pct, updated_at, price_source, price_fetched_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)""",
                (ticker, name.strip(), shares, avg_cost, market_price, market_value, pnl,
                 now, price_source, price_fetched_at),
            )
        conn.commit()
    finally:
        conn.close()
    refresh_holdings()


def delete_holding(ticker: str) -> None:
    """Elimina una posición del portafolio."""
    from app.market import refresh_holdings

    ticker = _normalize_bmv_ticker(ticker)
    conn = get_db()
    conn.execute("DELETE FROM investment_holdings WHERE ticker = ?", (ticker,))
    remaining = conn.execute(
        "SELECT COUNT(*) AS n FROM investment_holdings WHERE shares > 0"
    ).fetchone()["n"]
    if not remaining:
        conn.execute("DELETE FROM investment_snapshot")
    conn.commit()
    conn.close()
    if remaining:
        refresh_holdings()
