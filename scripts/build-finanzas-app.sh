#!/bin/bash
set -e
RUNTIME="$(bash "$(dirname "$0")/sync-runtime.sh")"
APP="$HOME/Applications/Finanzas.app"
MACOS="$APP/Contents/MacOS"

mkdir -p "$MACOS"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>Finanzas</string>
  <key>CFBundleIdentifier</key>
  <string>com.finanzas.local.app</string>
  <key>CFBundleName</key>
  <string>Finanzas</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
</dict>
</plist>
PLIST

cat > "$MACOS/Finanzas" <<EOF
#!/bin/bash
RUNTIME="$RUNTIME"
ENSURE="\$RUNTIME/scripts/ensure-server.sh"
LOG="\$HOME/Library/Logs/finanzas-app.log"
LINK="http://127.0.0.1:8000/inversiones"

case "\${1:-}" in
  --background)
    /bin/bash "\$ENSURE" >>"\$LOG" 2>&1 || true
    ;;
  *)
    /bin/bash "\$ENSURE" >>"\$LOG" 2>&1 || true
    /usr/bin/open "\$LINK"
    ;;
esac
EOF

chmod +x "$MACOS/Finanzas"
echo "$APP"
