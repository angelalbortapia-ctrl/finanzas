#!/bin/bash
# Arranca Finanzas en segundo plano si no responde /health
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PIDFILE="$ROOT/.finanzas.pid"
LOCKDIR="$ROOT/.ensure-server.lock.d"
LOG="$ROOT/finanzas.log"
PY="${FINANZAS_PYTHON:-$(which python3)}"
export PYTHONPATH="$ROOT"
export FINANZAS_OPEN_BROWSER=0
export FINANZAS_DATA_DIR="${FINANZAS_DATA_DIR:-$HOME/Library/Application Support/Finanzas}"
export FINANZAS_DB_PATH="${FINANZAS_DB_PATH:-$FINANZAS_DATA_DIR/finanzas.db}"

health_ok() {
  local base="$1"
  curl -sf --connect-timeout 2 --max-time 4 "$base/health" >/dev/null 2>&1
}

find_url() {
  local port
  for port in 8000 8001 8002 8003 8004 8005; do
    local try="http://127.0.0.1:$port"
    if health_ok "$try"; then
      echo "$try"
      return 0
    fi
  done
  if [ -f "$ROOT/.url" ]; then
    local from_file
    from_file=$(tr -d '[:space:]' < "$ROOT/.url")
    if [ -n "$from_file" ] && health_ok "$from_file"; then
      echo "$from_file"
      return 0
    fi
  fi
  return 1
}

if ! mkdir "$LOCKDIR" 2>/dev/null; then
  for _ in $(seq 1 45); do
    URL="$(find_url)" && { echo "$URL"; exit 0; }
    sleep 1
  done
  exit 0
fi
trap 'rmdir "$LOCKDIR" 2>/dev/null' EXIT INT TERM

kill_stale_servers() {
  if [ -f "$PIDFILE" ]; then
    local pid
    pid=$(tr -d '[:space:]' < "$PIDFILE")
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      if health_ok "http://127.0.0.1:8000" || health_ok "http://127.0.0.1:8001"; then
        return 0
      fi
      kill "$pid" 2>/dev/null || true
      sleep 0.4
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$PIDFILE"
  fi
  local port pid
  for port in 8000 8001 8002 8003 8004 8005; do
    for pid in $(lsof -ti:"$port" 2>/dev/null); do
      if ps -p "$pid" -o command= 2>/dev/null | grep -qE '[Pp]ython|uvicorn'; then
        if ! health_ok "http://127.0.0.1:$port"; then
          kill -9 "$pid" 2>/dev/null || true
        fi
      fi
    done
  done
}

URL="$(find_url)" || true
if [ -n "$URL" ]; then
  echo "$URL" > "$ROOT/.url"
  echo "$URL"
  exit 0
fi

kill_stale_servers

if ! "$PY" -c "import fastapi, uvicorn" 2>/dev/null; then
  "$PY" -m pip install -r "$ROOT/requirements.txt" || {
    echo "ERROR: no se pudieron instalar dependencias" >&2
    exit 1
  }
fi

if ! PYTHONPATH="$ROOT" "$PY" -c "from app.main import app" 2>>"$LOG"; then
  echo "ERROR: la app no carga. Ver $LOG" >&2
  tail -20 "$LOG" >&2
  exit 1
fi

nohup env PYTHONPATH="$ROOT" FINANZAS_OPEN_BROWSER=0 "$PY" "$ROOT/run.py" >>"$LOG" 2>&1 &
disown 2>/dev/null || true

for _ in $(seq 1 60); do
  URL="$(find_url)" && break
  sleep 1
done

if [ -z "$URL" ]; then
  echo "ERROR: no arrancó en 60s. Ver $LOG" >&2
  tail -25 "$LOG" >&2 || true
  exit 1
fi

echo "$URL" > "$ROOT/.url"
echo "$URL"
