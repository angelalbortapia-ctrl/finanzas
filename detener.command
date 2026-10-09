#!/bin/bash
cd "$(dirname "$0")"
echo "Deteniendo Finanzas..."

if [ -f .finanzas.pid ]; then
  pid=$(tr -d '[:space:]' < .finanzas.pid)
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null || true
    sleep 0.5
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f .finanzas.pid
fi

for port in 8000 8001 8002 8003 8004 8005; do
  for pid in $(lsof -ti:"$port" 2>/dev/null); do
    if ps -p "$pid" -o command= 2>/dev/null | grep -qE '[Pp]ython|uvicorn'; then
      kill -9 "$pid" 2>/dev/null
    fi
  done
done
pkill -f "uvicorn.*app.main:app" 2>/dev/null
pkill -f "python3.*run.py" 2>/dev/null

echo "Listo."
read -p "Presiona Enter para cerrar..."
