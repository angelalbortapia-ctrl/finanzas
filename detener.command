#!/bin/bash
cd "$(dirname "$0")"
echo "Deteniendo servidores Finanzas..."
for port in 8000 8001 8002 8003 8004 8005; do
  lsof -ti:$port 2>/dev/null | xargs kill -9 2>/dev/null
done
echo "Listo. Puertos liberados."
