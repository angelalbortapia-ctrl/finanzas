#!/bin/bash
# Redirige al instalador actual (Login Item; LaunchAgent no sirve en Descargas).
cd "$(dirname "$0")"
exec ./instalar-enlace.command
