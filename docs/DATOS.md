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

## Llaves de API (`finanzas.env`)

Opcional: crea `~/Library/Application Support/Finanzas/finanzas.env` con líneas `CLAVE=valor`. Se lee al arrancar; las variables que ya existan en el entorno tienen prioridad.

```
FINNHUB_API_KEY=tu_llave
```

- **Finnhub** (plan gratis en finnhub.io): respaldo cuando Yahoo no responde o limita peticiones. Cubre sobre todo acciones de EE.UU. (SIC); la cobertura de emisoras BMV no está garantizada.
- Reinicia el servicio después de editarlo: `launchctl kickstart -k "gui/$(id -u)/com.finanzas.local"`.

## Alertas de precio

Se guardan en la tabla `price_alerts`. El servidor las revisa cada minuto con el mercado abierto y manda una notificación de macOS aunque la pestaña esté cerrada. Tipos: precio arriba/abajo de un nivel, movimiento del día mayor a un %, y caída debajo de tu costo promedio mayor a un % (stop-loss).
