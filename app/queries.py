from __future__ import annotations

from app.database import get_db

MONTH_NAMES = [
    "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]


def get_cards():
    conn = get_db()
    rows = conn.execute("""
        SELECT c.id, c.name, c.credit_line, c.person_id, p.name AS person_name,
               COALESCE((SELECT SUM(amount) FROM card_categories WHERE card_id = c.id), 0) AS balance
        FROM credit_cards c
        JOIN persons p ON p.id = c.person_id
        ORDER BY balance DESC, c.name
    """).fetchall()
    conn.close()
    cards = []
    for r in rows:
        c = dict(r)
        c["available"] = c["credit_line"] - c["balance"]
        c["usage_pct"] = (c["balance"] / c["credit_line"] * 100) if c["credit_line"] else 0
        cards.append(c)
    return cards


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

    total_line = sum(c["credit_line"] for c in cards)
    total_balance = sum(c["balance"] for c in cards)
    total_available = total_line - total_balance
    usage_pct = (total_balance / total_line * 100) if total_line else 0

    other = conn.execute("SELECT * FROM other_expenses ORDER BY name").fetchall()
    other_total = sum(r["amount"] for r in other)

    patrimony = conn.execute("SELECT * FROM patrimony ORDER BY year, month").fetchall()
    patrimony_list = []
    for p in patrimony:
        assets = p["gbm"] + p["ppr"] + p["business"] + p["afore"] + p["infonavit"]
        net = assets - p["debt"]
        patrimony_list.append({
            **dict(p),
            "month_name": MONTH_NAMES[p["month"]],
            "label": f"{MONTH_NAMES[p['month']]} {p['year']}",
            "assets": assets,
            "net_worth": net,
        })

    latest = patrimony_list[-1] if patrimony_list else None
    prev = patrimony_list[-2] if len(patrimony_list) >= 2 else None
    net_change = None
    if latest and prev:
        net_change = latest["net_worth"] - prev["net_worth"]

    alerts = []
    insights = []
    worst_card = None
    for c in cards:
        pct = c["usage_pct"]
        if not worst_card or pct > worst_card["usage_pct"]:
            worst_card = c
        if c["credit_line"] > 0 and pct >= 80:
            alerts.append({"type": "danger", "message": f"{c['name']} al {pct:.0f}% — considera un pago"})
        elif c["credit_line"] > 0 and pct >= 60:
            alerts.append({"type": "warning", "message": f"{c['name']} al {pct:.0f}% de su límite"})

    if worst_card and worst_card["usage_pct"] > 50:
        insights.append({
            "title": "Tarjeta más cargada",
            "text": f"{worst_card['name']} con {worst_card['usage_pct']:.0f}% de uso",
        })
    if latest and net_change is not None:
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

    persons = conn.execute("SELECT * FROM persons ORDER BY name").fetchall()
    conn.close()

    return {
        "cards": cards,
        "total_line": total_line,
        "total_balance": total_balance,
        "total_available": total_available,
        "usage_pct": usage_pct,
        "health": _health(usage_pct),
        "other_expenses": [dict(r) for r in other],
        "other_total": other_total,
        "patrimony": patrimony_list,
        "latest_patrimony": latest,
        "net_change": net_change,
        "alerts": alerts,
        "insights": insights[:4],
        "persons": [dict(p) for p in persons],
    }


def get_persons():
    conn = get_db()
    rows = conn.execute("SELECT * FROM persons ORDER BY name").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_latest_net_worth():
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM patrimony ORDER BY year DESC, month DESC LIMIT 1"
    ).fetchone()
    conn.close()
    if not row:
        return None
    assets = row["gbm"] + row["ppr"] + row["business"] + row["afore"] + row["infonavit"]
    return assets - row["debt"]


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


def add_category(card_id: int, name: str, amount: float, person_id: int | None):
    conn = get_db()
    conn.execute(
        "INSERT INTO card_categories (card_id, name, amount, person_id) VALUES (?, ?, ?, ?)",
        (card_id, name, amount, person_id),
    )
    conn.commit()
    conn.close()


def update_category(card_id: int, cat_id: int, amount: float):
    conn = get_db()
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


def add_patrimony(year: int, month: int, gbm: float, ppr: float, business: float, afore: float, infonavit: float, debt: float):
    conn = get_db()
    conn.execute(
        """INSERT INTO patrimony (year, month, gbm, ppr, business, afore, infonavit, debt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(year, month) DO UPDATE SET
             gbm=excluded.gbm, ppr=excluded.ppr, business=excluded.business,
             afore=excluded.afore, infonavit=excluded.infonavit, debt=excluded.debt""",
        (year, month, gbm, ppr, business, afore, infonavit, debt),
    )
    conn.commit()
    conn.close()


def add_transaction(date: str, amount: float, description: str, category: str, card_id: int | None, person_id: int | None, type: str):
    conn = get_db()
    conn.execute(
        """INSERT INTO transactions (date, amount, description, category, card_id, person_id, type)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (date, amount, description, category, card_id, person_id, type),
    )
    conn.commit()
    conn.close()
