#!/bin/bash
cd "$(dirname "$0")"
echo "Deteniendo servidores Finanzas..."
for port in 8000 8001 8002 8003 8004 8005; do
  lsof -ti:$port 2>/dev/null | xargs kill -9 2>/dev/null
done
pkill -f "uvicorn.*app.main:app" 2>/dev/null
pkill -f "python3.*run.py" 2>/dev/null
sleep 1
echo "Listo. Puertos liberados."
read -p "Presiona Enter para cerrar..."
