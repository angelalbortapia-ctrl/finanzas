#!/bin/bash
cd "$(dirname "$0")"

URL=""
for port in 8000 8001 8002 8003; do
  try="http://127.0.0.1:$port"
  code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 "$try/" 2>/dev/null || echo "000")
  if [ "$code" = "200" ]; then
    URL="$try"
    break
  fi
done
if [ -z "$URL" ] && [ -f .url ]; then
  URL=$(cat .url | tr -d '[:space:]')
fi
if [ -z "$URL" ]; then
  URL="http://127.0.0.1:8000"
fi

# Si no responde, intentar arrancar
if ! curl -s --connect-timeout 2 "$URL/health" >/dev/null 2>&1; then
  echo "Servidor apagado — iniciando..."
  osascript -e "tell application \"Terminal\" to do script \"cd '$PWD' && python3 run.py\""
  sleep 3
fi

for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -s --connect-timeout 2 "$URL/health" >/dev/null 2>&1; then
    echo "Abriendo $URL"
    open "$URL"
    exit 0
  fi
  sleep 1
done

echo "No responde. Haz doble clic en iniciar.command"
read -p "Presiona Enter para cerrar..."
