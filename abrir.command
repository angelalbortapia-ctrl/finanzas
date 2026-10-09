#!/bin/bash
cd "$(dirname "$0")"
xattr -d com.apple.quarantine "$0" 2>/dev/null || true
chmod +x scripts/*.sh *.command 2>/dev/null || true

bash scripts/sync-runtime.sh >/dev/null
bash scripts/install-always-on.sh >/dev/null 2>&1 || bash scripts/ensure-server.sh >/dev/null || true

if [ -x "$HOME/Applications/Finanzas.app/Contents/MacOS/Finanzas" ]; then
  open -a Finanzas
  exit 0
fi

URL="$(bash scripts/ensure-server.sh)" || exit 1
open "${URL//localhost/127.0.0.1}/inversiones"
