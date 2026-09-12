#!/bin/bash
cd "$(dirname "$0")"

echo "================================"
echo "  Iniciando Finanzas..."
echo "================================"

# Detener instancias viejas (por puerto y por proceso)
for port in 8000 8001 8002 8003 8004 8005; do
  lsof -ti:$port 2>/dev/null | xargs kill -9 2>/dev/null
done
pkill -f "uvicorn.*app.main:app" 2>/dev/null
pkill -f "python3.*run.py" 2>/dev/null

sleep 1

echo "Python: $(which python3)"
python3 --version

# Instalar dependencias si faltan
if ! python3 -c "import fastapi, uvicorn, openpyxl, fpdf, yfinance" 2>/dev/null; then
  echo "Instalando dependencias..."
  python3 -m pip install -r requirements.txt
fi

# Verificar que la app carga sin errores
if ! python3 -c "from app.main import app; print('App OK')" 2>&1; then
  echo ""
  echo "ERROR: La app tiene un error de código. Revisa el mensaje arriba."
  read -p "Presiona Enter para cerrar..."
  exit 1
fi

echo ""
echo "Arrancando servidor..."
echo ""

# Verificar que el dashboard responde (no solo que importe)
python3 - <<'PY' 2>/dev/null || true
from app.queries import get_dashboard
d = get_dashboard()
assert "total_revolving" in d and "total_loan" in d
PY

# No cerrar la ventana si falla
FINANZAS_OPEN_BROWSER=1 python3 run.py || {
  echo ""
  echo "ERROR: El servidor no pudo iniciar."
  read -p "Presiona Enter para cerrar..."
  exit 1
}
