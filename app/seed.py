"""Import initial data from Tarjetas.xlsx into SQLite."""
from datetime import date
from pathlib import Path

import openpyxl

from app.config import EXCEL_PATH
from app.database import get_db, init_db
from app.queries import infer_category_kind

MONTHS = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4,
    "mayo": 5, "junio": 6, "julio": 7, "agosto": 8,
    "septiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12,
}


def _person_id(conn, name: str) -> int:
    row = conn.execute("SELECT id FROM persons WHERE name = ?", (name,)).fetchone()
    if row:
        return row["id"]
    cur = conn.execute("INSERT INTO persons (name) VALUES (?)", (name,))
    return cur.lastrowid


def _clear_data(conn):
    """Solo datos de tarjetas/patrimonio — no toca inversiones ni historial de portafolio."""
    conn.execute("DELETE FROM transactions")
    conn.execute("DELETE FROM card_categories")
    conn.execute("DELETE FROM other_expenses")
    conn.execute("DELETE FROM patrimony")
    conn.execute("DELETE FROM credit_cards")
    conn.execute("DELETE FROM persons")


def seed_from_excel():
    init_db()
    conn = get_db()

    if not EXCEL_PATH.exists():
        conn.close()
        raise FileNotFoundError(f"No se encontró {EXCEL_PATH}")

    _clear_data(conn)

    angel_id = _person_id(conn, "Angel")

    wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
    ws = wb["General"]

    # Credit cards summary (rows 4-7)
    cards_angel = [
        ("INVEX", 278000, [
            ("Gastos", 226166.03, angel_id),
            ("Viaje Luis", 0, angel_id),
        ]),
        ("PLATA", 17500, [
            ("Negocio", 17500, angel_id),
            ("Préstamo", 20740, angel_id),
        ]),
        ("NU", 25400, [
            ("Gastos", 20000, angel_id),
        ]),
        ("LIVERPOOL", 15000, [
            ("Gastos", 9793.17, angel_id),
        ]),
    ]

    for name, line, categories in cards_angel:
        cur = conn.execute(
            "INSERT INTO credit_cards (name, credit_line, person_id) VALUES (?, ?, ?)",
            (name, line, angel_id),
        )
        card_id = cur.lastrowid
        for cat_name, amount, pid in categories:
            conn.execute(
                """INSERT INTO card_categories (card_id, name, amount, person_id, kind)
                   VALUES (?, ?, ?, ?, ?)""",
                (card_id, cat_name, amount, pid, infer_category_kind(cat_name)),
            )

    # Other expenses (rows 31-37)
    other = [
        ("Ropa", 0),
        ("Renta", -10000),
        ("PPR", 0),
        ("Efectivo", -1000),
        ("Inversión", 0),
        ("Gastos", -20000),
        ("Seguro de Vida", -500),
    ]
    for name, amount in other:
        conn.execute("INSERT INTO other_expenses (name, amount) VALUES (?, ?)", (name, amount))

    # Patrimony monthly (rows 42-50)
    for row in ws.iter_rows(min_row=42, max_row=54, values_only=True):
        month_name = (row[1] or "").strip().lower() if row[1] else ""
        if month_name not in MONTHS:
            continue
        gbm, ppr, business, afore, infonavit = row[2:7]
        debt = row[8] if len(row) > 8 else 0
        if not any([gbm, ppr, business, afore, infonavit, debt]):
            continue
        conn.execute(
            """INSERT INTO patrimony (year, month, gbm, ppr, business, afore, infonavit, debt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (date.today().year, MONTHS[month_name], gbm or 0, ppr or 0, business or 0,
             afore or 0, infonavit or 0, debt or 0),
        )

    conn.commit()
    conn.close()
    print("Datos importados correctamente desde Tarjetas.xlsx")


if __name__ == "__main__":
    seed_from_excel()
