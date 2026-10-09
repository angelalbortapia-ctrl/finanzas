#!/bin/bash
# UNA VEZ: deja Finanzas listo para abrir solo con el enlace en el navegador.
ROOT="$(cd "$(dirname "$0")" && pwd)"
LINK="http://127.0.0.1:8000/inversiones"

xattr -d com.apple.quarantine "$ROOT/instalar-enlace.command" 2>/dev/null || true

result="$(bash "$ROOT/scripts/install-always-on.sh" 2>&1)" || {
  osascript -e "display alert \"No arrancó\" message \"Revisa finanzas.log en la carpeta del proyecto.\"" 2>/dev/null
  echo "$result"
  read -p "Enter para cerrar..."
  exit 1
}

if echo "$result" | grep -q '^OK|'; then
  open "$LINK" 2>/dev/null || true
  osascript -e "display dialog \"Listo. Guarda este enlace en favoritos:\n\n$LINK\n\nEl servidor vive en ~/Finanzas (copia automática). También puedes abrir la app Finanzas en Aplicaciones.\" buttons {\"OK\"} default button \"OK\" with title \"Finanzas\"" 2>/dev/null || echo "OK $LINK"
else
  osascript -e "display alert \"Revisa el log\" message \"$result\"" 2>/dev/null
fi

read -p "Enter para cerrar..."
