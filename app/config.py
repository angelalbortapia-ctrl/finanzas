import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
USER_NAME = os.environ.get("FINANZAS_USER", "Angel")
EXCEL_PATH = Path(os.environ.get("FINANZAS_EXCEL", ROOT.parent / "Tarjetas.xlsx"))
GBM_EXCEL_PATH = Path(os.environ.get(
    "FINANZAS_GBM_EXCEL",
    ROOT.parent / "Estrategia de inversión GBM.xlsx",
))
GOOGLE_SHEETS_ID = os.environ.get("FINANZAS_GOOGLE_SHEETS_ID", "")
GOOGLE_CREDENTIALS_PATH = Path(os.environ.get(
    "FINANZAS_GOOGLE_CREDENTIALS",
    ROOT / "google-credentials.json",
))
# Optional: Finnhub fallback for BMV quotes (free tier at finnhub.io)
FINNHUB_API_KEY = os.environ.get("FINNHUB_API_KEY", "")
# Optional: Banxico SIE token for live TIIE (https://www.banxico.org.mx/SieAPIRest/)
BANXICO_API_KEY = os.environ.get("BANXICO_API_KEY", "")
# Optional: 4+ digit PIN to protect POST routes on LAN (leave empty to disable)
FINANZAS_PIN = os.environ.get("FINANZAS_PIN", "")
