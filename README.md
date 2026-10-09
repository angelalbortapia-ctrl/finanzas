# Finanzas

Panel web personal: tarjetas, patrimonio, inversiones GBM/terminal BMV y movimientos.

## Enlace (uso normal)

**http://127.0.0.1:8000/inversiones**

Si no abre: doble clic en **`abrir.command`** (carpeta del proyecto).

## Primera vez en esta Mac

Doble clic en **`instalar-enlace.command`**. Luego usa solo el enlace de arriba.

Detalle: [docs/ARRANQUE.md](docs/ARRANQUE.md) · Base de datos única: [docs/DATOS.md](docs/DATOS.md)

## Requisitos

- Python 3.9+
- macOS: proyecto en Descargas está bien; el **servicio** corre desde `~/Finanzas`
- Excel opcional: `../Tarjetas.xlsx` (`FINANZAS_EXCEL`)

## Desarrollo

```bash
cd ~/Downloads/Finanzas
export FINANZAS_OPEN_BROWSER=0
python3 run.py
```

Tests:

```bash
PYTHONPATH=. python3 -m unittest tests.test_smoke -q
```

## Configuración

| Variable | Descripción | Default |
|----------|-------------|---------|
| `FINANZAS_USER` | Nombre en el saludo | `Angel` |
| `FINANZAS_DATA_DIR` | Carpeta de datos | `~/Library/Application Support/Finanzas` |
| `FINANZAS_DB_PATH` | SQLite | `$FINANZAS_DATA_DIR/finanzas.db` |
| `FINANZAS_EXCEL` | Excel tarjetas | `../Tarjetas.xlsx` |
| `FINANZAS_GBM_EXCEL` | Excel GBM | `../Estrategia de inversión GBM.xlsx` |
| `FINANZAS_PIN` | PIN en red local (vacío = desactivado) | — |
| `FINANZAS_OPEN_BROWSER` | Abrir navegador al iniciar | `1` |

## Estructura

```
app/
  main.py       # FastAPI
  queries.py    # SQLite
  terminal.py   # Mercado / emisora
  templates/    # HTML
  static/       # JS/CSS/PWA
scripts/        # Arranque macOS
```

## Detener

`detener.command` o desactivar el LaunchAgent en Configuración → General → Ítems de inicio.
