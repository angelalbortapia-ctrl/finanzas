"""Sync GBM portfolio from Google Sheets (GOOGLEFINANCE live data)."""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Optional

from app.config import GOOGLE_CREDENTIALS_PATH, GOOGLE_SHEETS_ID
from app.gbm import _save_to_db, parse_gbm_sheets


def is_google_configured() -> bool:
    return bool(GOOGLE_SHEETS_ID) and GOOGLE_CREDENTIALS_PATH.exists()


def get_google_status() -> dict:
    return {
        "configured": is_google_configured(),
        "sheets_id": GOOGLE_SHEETS_ID or None,
        "credentials_path": str(GOOGLE_CREDENTIALS_PATH),
        "credentials_exists": GOOGLE_CREDENTIALS_PATH.exists(),
    }


def _get_client():
    import gspread
    from google.oauth2.service_account import Credentials

    scopes = [
        "https://www.googleapis.com/auth/spreadsheets.readonly",
        "https://www.googleapis.com/auth/drive.readonly",
    ]
    creds = Credentials.from_service_account_file(str(GOOGLE_CREDENTIALS_PATH), scopes=scopes)
    return gspread.authorize(creds)


def sync_from_google(sheets_id: Optional[str] = None) -> dict:
    if not is_google_configured() and not sheets_id:
        raise RuntimeError(
            "Google Sheets no configurado. Define FINANZAS_GOOGLE_SHEETS_ID y coloca "
            "google-credentials.json en la carpeta del proyecto."
        )

    sid = sheets_id or GOOGLE_SHEETS_ID
    client = _get_client()
    spreadsheet = client.open_by_key(sid)

    portfolio_ws = spreadsheet.worksheet("Portafolio")
    monitor_ws = spreadsheet.worksheet("Monitor")

    portfolio_rows = portfolio_ws.get_all_values()
    monitor_rows = monitor_ws.get_all_values()

    data = parse_gbm_sheets(portfolio_rows, monitor_rows)
    _save_to_db(data, "google")
    return data


def log_sync_error(source: str, message: str) -> None:
    from app.database import get_db

    now = datetime.now().isoformat(timespec="seconds")
    conn = get_db()
    conn.execute(
        "INSERT INTO sync_log (source, status, message, synced_at) VALUES (?, ?, ?, ?)",
        (source, "error", message, now),
    )
    conn.commit()
    conn.close()
