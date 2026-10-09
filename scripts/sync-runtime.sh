#!/bin/bash
# Copia código a ~/Finanzas (macOS bloquea servicios en ~/Downloads).
# La base de datos NO se copia: vive en ~/Library/Application Support/Finanzas/.
set -e
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${FINANZAS_RUNTIME:-$HOME/Finanzas}"

mkdir -p "$DEST"
rsync -a \
  --exclude '.git/' \
  --exclude 'finanzas.log' \
  --exclude 'finanzas-stdout.log' \
  --exclude 'finanzas-stderr.log' \
  --exclude '.ensure-server.lock.d' \
  --exclude '__pycache__/' \
  --exclude '.DS_Store' \
  "$SRC/" "$DEST/"

echo "$DEST"
