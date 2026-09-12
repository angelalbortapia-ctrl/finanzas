#!/bin/bash
cd "$(dirname "$0")"
PLIST="$HOME/Library/LaunchAgents/com.finanzas.local.plist"
DIR="$(pwd)"
LOG="$DIR/finanzas.log"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.finanzas.local</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>$DIR/run.py</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>FINANZAS_OPEN_BROWSER</key>
    <string>0</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LOG</string>
  <key>StandardErrorPath</key>
  <string>$LOG</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null
launchctl load "$PLIST"
sleep 2

if curl -s --connect-timeout 3 http://127.0.0.1:8000/health >/dev/null 2>&1; then
  echo "✓ Finanzas instalado y corriendo en http://127.0.0.1:8000"
  echo "$DIR/.url" | xargs cat 2>/dev/null || echo "http://127.0.0.1:8000"
else
  echo "Servicio instalado. Revisa $LOG si no responde."
fi
echo ""
read -p "Presiona Enter para cerrar..."
