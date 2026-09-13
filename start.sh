#!/bin/bash
# Arranque rápido — doble clic o: ./start.sh
cd "$(dirname "$0")"
lsof -ti:8000 2>/dev/null | xargs kill -9 2>/dev/null
sleep 0.5
export FINANZAS_OPEN_BROWSER=1
exec python3 run.py
