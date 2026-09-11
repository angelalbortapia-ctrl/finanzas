#!/bin/bash
cd "$(dirname "$0")"

echo "================================"
echo "  Iniciando Finanzas..."
echo "================================"

# Detener instancias viejas
for port in 8000 8001 8002 8003 8004 8005; do
  lsof -ti:$port 2>/dev/null | xargs kill -9 2>/dev/null
done

sleep 1

# Instalar dependencias si faltan
python3 -m pip install -r requirements.txt -q 2>/dev/null

# Arrancar (abre el navegador automáticamente)
python3 run.py
