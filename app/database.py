import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "finanzas.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS persons (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS credit_cards (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    credit_line REAL NOT NULL DEFAULT 0,
    person_id INTEGER NOT NULL REFERENCES persons(id),
    notes TEXT
);

CREATE TABLE IF NOT EXISTS card_categories (
    id INTEGER PRIMARY KEY,
    card_id INTEGER NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    person_id INTEGER REFERENCES persons(id),
    kind TEXT NOT NULL DEFAULT 'spend'
);

CREATE TABLE IF NOT EXISTS other_expenses (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS patrimony (
    id INTEGER PRIMARY KEY,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    gbm REAL DEFAULT 0,
    ppr REAL DEFAULT 0,
    business REAL DEFAULT 0,
    afore REAL DEFAULT 0,
    infonavit REAL DEFAULT 0,
    debt REAL DEFAULT 0,
    UNIQUE(year, month)
);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY,
    card_id INTEGER REFERENCES credit_cards(id) ON DELETE SET NULL,
    person_id INTEGER REFERENCES persons(id),
    category TEXT,
    description TEXT,
    amount REAL NOT NULL,
    date TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'expense'
);

CREATE TABLE IF NOT EXISTS investment_snapshot (
    id INTEGER PRIMARY KEY,
    invested REAL DEFAULT 0,
    market_value REAL DEFAULT 0,
    cash REAL DEFAULT 0,
    pnl REAL DEFAULT 0,
    return_pct REAL DEFAULT 0,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS investment_holdings (
    id INTEGER PRIMARY KEY,
    ticker TEXT NOT NULL UNIQUE,
    name TEXT,
    shares REAL DEFAULT 0,
    avg_cost REAL DEFAULT 0,
    market_price REAL DEFAULT 0,
    market_value REAL DEFAULT 0,
    pnl REAL DEFAULT 0,
    weight_pct REAL DEFAULT 0,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS market_indices (
    id INTEGER PRIMARY KEY,
    ticker TEXT NOT NULL UNIQUE,
    name TEXT,
    quote REAL DEFAULT 0,
    change_abs REAL DEFAULT 0,
    change_pct REAL DEFAULT 0,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS portfolio_history (
    id INTEGER PRIMARY KEY,
    recorded_at TEXT NOT NULL,
    market_value REAL NOT NULL,
    invested REAL NOT NULL,
    pnl REAL NOT NULL,
    return_pct REAL NOT NULL,
    UNIQUE(recorded_at)
);

CREATE TABLE IF NOT EXISTS monthly_goals (
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    payment_goal REAL NOT NULL DEFAULT 0,
    savings_goal REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (year, month)
);

CREATE TABLE IF NOT EXISTS price_history (
    ticker TEXT NOT NULL,
    price REAL NOT NULL,
    source TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (ticker, recorded_at)
);

CREATE TABLE IF NOT EXISTS price_cache (
    ticker TEXT PRIMARY KEY,
    price REAL NOT NULL,
    source TEXT NOT NULL,
    fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


MIGRATIONS = [
    "ALTER TABLE credit_cards ADD COLUMN cutoff_day INTEGER",
    "ALTER TABLE credit_cards ADD COLUMN payment_due_day INTEGER",
    "ALTER TABLE other_expenses ADD COLUMN due_day INTEGER",
    "ALTER TABLE patrimony ADD COLUMN card_debt REAL",
    "ALTER TABLE patrimony ADD COLUMN net_worth REAL",
    "ALTER TABLE patrimony ADD COLUMN closed_at TEXT",
    "ALTER TABLE investment_holdings ADD COLUMN price_source TEXT",
    "ALTER TABLE investment_holdings ADD COLUMN price_fetched_at TEXT",
    "ALTER TABLE investment_snapshot ADD COLUMN price_source TEXT",
    "ALTER TABLE investment_snapshot ADD COLUMN price_fetched_at TEXT",
    "ALTER TABLE card_categories ADD COLUMN kind TEXT NOT NULL DEFAULT 'spend'",
    "ALTER TABLE monthly_goals ADD COLUMN savings_goal REAL NOT NULL DEFAULT 0",
]


def _migrate(conn):
    for sql in MIGRATIONS:
        try:
            conn.execute(sql)
        except sqlite3.OperationalError:
            pass
    if not conn.execute(
        "SELECT 1 FROM schema_meta WHERE key = 'loan_kind_inferred'"
    ).fetchone():
        conn.execute(
            """UPDATE card_categories SET kind = 'loan'
               WHERE COALESCE(kind, 'spend') = 'spend'
               AND (
                 lower(name) LIKE '%préstamo%' OR lower(name) LIKE '%prestamo%'
                 OR lower(name) LIKE '%apartado%' OR lower(name) LIKE '%loan%'
               )"""
        )
        conn.execute(
            "INSERT INTO schema_meta (key, value) VALUES ('loan_kind_inferred', '1')"
        )


def init_db():
    conn = get_db()
    conn.executescript(SCHEMA)
    _migrate(conn)
    conn.commit()
    conn.close()
