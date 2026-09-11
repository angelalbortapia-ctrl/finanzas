# Finanzas

Panel web personal para controlar tarjetas de crédito, patrimonio y movimientos.

## Requisitos

- Python 3.9+
- Archivo Excel de datos (opcional): `../Tarjetas.xlsx` o variable `FINANZAS_EXCEL`

## Inicio rápido

```bash
python3 run.py
```

En macOS también puedes usar `iniciar.command` (doble clic).

La app abre en `http://127.0.0.1:8000`.

## Configuración

| Variable | Descripción | Default |
|----------|-------------|---------|
| `FINANZAS_USER` | Nombre en el saludo | `Angel` |
| `FINANZAS_EXCEL` | Ruta al Excel de importación | `../Tarjetas.xlsx` |
| `FINANZAS_OPEN_BROWSER` | Abrir navegador al iniciar (`0` para desactivar) | `1` |

## Estructura

```
app/
  main.py       # Rutas FastAPI
  queries.py    # Consultas y escritura SQLite
  database.py   # Esquema
  seed.py       # Importación desde Excel
  config.py     # Configuración
  templates/    # Vistas HTML
  static/       # CSS y JS
```

## Detener

```bash
# Ctrl+C en la terminal, o en macOS:
./detener.command
```
