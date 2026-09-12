# Finanzas

Panel web personal para controlar tarjetas de crédito, patrimonio, inversiones GBM y movimientos.

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
| `FINANZAS_EXCEL` | Ruta al Excel de tarjetas | `../Tarjetas.xlsx` |
| `FINANZAS_GBM_EXCEL` | Ruta al Excel de inversiones GBM | `../Estrategia de inversión GBM.xlsx` |
| `FINANZAS_GOOGLE_SHEETS_ID` | ID del Google Sheet con el portafolio | — |
| `FINANZAS_GOOGLE_CREDENTIALS` | Ruta a credenciales de cuenta de servicio | `google-credentials.json` |
| `FINANZAS_OPEN_BROWSER` | Abrir navegador al iniciar (`0` para desactivar) | `1` |

## Inversiones GBM + Google Sheets

La sección **Inversiones** importa tu archivo `Estrategia de inversión GBM.xlsx` (hojas Portafolio y Monitor) y actualiza el valor GBM en Patrimonio.

### Sincronizar con Google (precios en vivo con GOOGLEFINANCE)

1. Sube el Excel a [Google Sheets](https://sheets.google.com) (mantén las hojas `Portafolio` y `Monitor`).
2. En [Google Cloud Console](https://console.cloud.google.com), crea un proyecto y habilita **Google Sheets API**.
3. Crea una **cuenta de servicio**, descarga el JSON y guárdalo como `google-credentials.json` en la carpeta del proyecto.
4. Comparte el Sheet con el email de la cuenta de servicio (permiso de lectura).
5. Copia el ID del Sheet de la URL (`https://docs.google.com/spreadsheets/d/ESTE_ES_EL_ID/edit`).
6. Configura las variables:

```bash
export FINANZAS_GOOGLE_SHEETS_ID="tu-id-del-sheet"
export FINANZAS_GOOGLE_CREDENTIALS="/ruta/a/google-credentials.json"
```

En la app, usa **Sincronizar Google Sheets** para traer precios actualizados vía GOOGLEFINANCE.

Sin Google, puedes usar **Actualizar precios (Yahoo)** como respaldo para emisoras BMV.

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
