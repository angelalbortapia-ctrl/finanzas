import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(
    os.environ.get(
        "FINANZAS_DATA_DIR",
        str(Path.home() / "Library" / "Application Support" / "Finanzas"),
    )
)


def _load_env_file(path: Path) -> None:
    """KEY=VALUE por línea; las variables ya definidas en el entorno ganan."""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_env_file(DATA_DIR / "finanzas.env")

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
# Optional: 4+ digit PIN to protect the app on LAN (leave empty to disable)
FINANZAS_PIN = os.environ.get("FINANZAS_PIN", "")
# Auto-import GBM Excel every N hours (0 = disabled, default 12)
GBM_AUTO_IMPORT_HOURS = int(os.environ.get("FINANZAS_GBM_IMPORT_HOURS", "12"))

# Versiones de assets estáticos — mantener sincronizado con app/static/sw.js PRECACHE
STATIC_V = {
    "app_css": 28,
    "app_js": 33,
    "home_css": 39,
    "home_js": 6,
    "charts_js": 18,
    "chart_umd_js": 1,
    "forge_js": 9,
    "forge_layout_js": 5,
    "offline_queue_js": 2,
    "terminal_css": 73,
    "terminal_pro_css": 61,
    "terminal_js": 96,
    "terminal_financials_js": 6,
    "emisora_js": 9,
    "lightweight_charts_js": 2,
    "terminal_layout_js": 48,
    "terminal_widgets_layout_js": 9,
    "sw_js": 91,
}
