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
    person_id INTEGER REFERENCES persons(id)
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
"""


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_db()
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()
