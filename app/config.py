import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
USER_NAME = os.environ.get("FINANZAS_USER", "Angel")
EXCEL_PATH = Path(os.environ.get("FINANZAS_EXCEL", ROOT.parent / "Tarjetas.xlsx"))
