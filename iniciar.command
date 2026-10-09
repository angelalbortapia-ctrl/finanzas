#!/bin/bash
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT" || exit 1

xattr -d com.apple.quarantine "$ROOT/iniciar.command" 2>/dev/null || true

PY="$(command -v python3)"
export PYTHONPATH="$ROOT"
export FINANZAS_OPEN_BROWSER=1
export FINANZAS_DATA_DIR="${FINANZAS_DATA_DIR:-$HOME/Library/Application Support/Finanzas}"
export FINANZAS_DB_PATH="${FINANZAS_DB_PATH:-$FINANZAS_DATA_DIR/finanzas.db}"

echo "================================"
echo "  Finanzas (modo manual)"
echo "================================"
echo "  Si CIERRAS esta ventana, el servidor SE APAGA."
echo ""
echo "  Para dejarlo siempre encendido:"
echo "  → doble clic en activar-siempre.command"
echo "================================"

if ! "$PY" -c "import fastapi, uvicorn" 2>/dev/null; then
  "$PY" -m pip install --user -r "$ROOT/requirements.txt"
fi

exec env PYTHONPATH="$ROOT" FINANZAS_OPEN_BROWSER=1 "$PY" "$ROOT/run.py"
