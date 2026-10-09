# Datos y base de datos

## Una sola base de datos

Todos los arranques usan la misma SQLite:

`~/Library/Application Support/Finanzas/finanzas.db`

Variables opcionales:

| Variable | Default |
|----------|---------|
| `FINANZAS_DATA_DIR` | `~/Library/Application Support/Finanzas` |
| `FINANZAS_DB_PATH` | `$FINANZAS_DATA_DIR/finanzas.db` |

## Migración automática

Al primer arranque después de actualizar, si no existe la DB en Application Support, se copia la copia **más reciente** entre:

- `Downloads/Finanzas/finanzas.db` (repo de desarrollo)
- `~/Finanzas/finanzas.db` (copia de runtime antigua)

Los `finanzas.db` dentro del repo o en `~/Finanzas` **ya no son la fuente de verdad**; puedes borrarlos cuando confirmes que todo se ve bien en la app.

## Código vs datos

| Qué | Dónde |
|-----|--------|
| Código (git) | `~/Downloads/Finanzas` |
| Código en ejecución (servicio) | `~/Finanzas` (sync con `scripts/sync-runtime.sh`) |
| Datos (SQLite) | Application Support |

Tras cambiar código en Descargas: doble clic en **`abrir.command`** (sincroniza y reinicia si hace falta).
