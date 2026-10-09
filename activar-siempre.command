#!/bin/bash
# Igual que instalar-enlace.command (sin ventana de Terminal).
ROOT="$(cd "$(dirname "$0")" && pwd)"
exec "$ROOT/instalar-enlace.command"
