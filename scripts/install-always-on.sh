#!/bin/bash
set -e
SRC="$(cd "$(dirname "$0")/.." && pwd)"
PY="$(command -v python3)"
RUNTIME="$(bash "$SRC/scripts/sync-runtime.sh")"
PLIST="$HOME/Library/LaunchAgents/com.finanzas.local.plist"
LAUID="$(id -u)"
LINK="http://127.0.0.1:8000/inversiones"
LOG="$RUNTIME/finanzas.log"

chmod +x "$RUNTIME/scripts/ensure-server.sh" 2>/dev/null || true
"$PY" -m pip install --user -r "$RUNTIME/requirements.txt" 2>/dev/null || true

APP="$(bash "$SRC/scripts/build-finanzas-app.sh")"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.finanzas.local</string>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>$RUNTIME/run.py</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$RUNTIME</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PYTHONPATH</key>
    <string>$RUNTIME</string>
    <key>FINANZAS_DATA_DIR</key>
    <string>$HOME/Library/Application Support/Finanzas</string>
    <key>FINANZAS_DB_PATH</key>
    <string>$HOME/Library/Application Support/Finanzas/finanzas.db</string>
    <key>FINANZAS_OPEN_BROWSER</key>
    <string>0</string>
    <key>FINANZAS_PORT</key>
    <string>8000</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>$LOG</string>
  <key>StandardErrorPath</key>
  <string>$LOG</string>
  <key>ThrottleInterval</key>
  <integer>5</integer>
</dict>
</plist>
EOF

launchctl bootout "gui/$LAUID" "$PLIST" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$LAUID" "$PLIST" 2>/dev/null || launchctl load "$PLIST" 2>/dev/null || true

osascript <<APPLESCRIPT || true
tell application "System Events"
  repeat with L in login items
    try
      if (path of L as text) contains "Finanzas" then delete L
    end try
  end repeat
  make login item at end with properties {path:"$APP", hidden:true}
end tell
APPLESCRIPT

pkill -f "Finanzas.app/Contents/MacOS/Finanzas" 2>/dev/null || true
pkill -f login-keepalive.sh 2>/dev/null || true

for port in 8000 8001 8002; do
  for pid in $(lsof -ti:"$port" 2>/dev/null); do
    if ps -p "$pid" -o command= 2>/dev/null | grep -qE '[Pp]ython|uvicorn'; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
done
sleep 1

launchctl kickstart -k "gui/$LAUID/com.finanzas.local" 2>/dev/null || open -a Finanzas --args --background

sleep 5
if curl -sf --connect-timeout 5 http://127.0.0.1:8000/health >/dev/null; then
  echo "$LINK" > "$SRC/.url"
  echo "$LINK" > "$RUNTIME/.url"
  echo "OK|$LINK"
else
  bash "$RUNTIME/scripts/ensure-server.sh" >>"$LOG" 2>&1 || true
  sleep 4
  curl -sf --connect-timeout 5 http://127.0.0.1:8000/health >/dev/null && {
    echo "$LINK" > "$SRC/.url"
    echo "OK|$LINK"
    exit 0
  }
  echo "FAIL|$LOG"
  exit 1
fi
