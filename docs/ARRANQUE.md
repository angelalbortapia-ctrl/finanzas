# Arranque en macOS

## Uso diario (solo enlace)

1. Guarda en favoritos: **http://127.0.0.1:8000/inversiones**
2. Si no carga: doble clic en **`abrir.command`**

## Instalación una vez por Mac

**`instalar-enlace.command`** hace:

1. Copia el código a `~/Finanzas` (fuera de Descargas; macOS bloquea servicios ahí)
2. Registra **LaunchAgent** `com.finanzas.local` (servidor siempre en puerto 8000)
3. Crea **Finanzas.app** en `~/Applications` (atajo sin Terminal)
4. Añade elemento de inicio de sesión oculto

## Scripts útiles

| Archivo | Uso |
|---------|-----|
| `abrir.command` | Arranca (si hace falta), sincroniza código y abre inversiones |
| `instalar-enlace.command` | Reinstalar servicio + app |
| `iniciar.command` | Modo manual: servidor en esta ventana (se apaga al cerrar Terminal) |
| `detener.command` | Mata procesos en 8000–8005 |
| `activar-siempre.command` | Alias de `instalar-enlace.command` |
| `instalar-servicio.command` | Alias de `instalar-enlace.command` |

## Scripts internos (`scripts/`)

| Script | Rol |
|--------|-----|
| `sync-runtime.sh` | Descargas → `~/Finanzas` (sin copiar `finanzas.db`) |
| `ensure-server.sh` | Levanta `run.py` en segundo plano si `/health` falla |
| `install-always-on.sh` | LaunchAgent + app + login item |
| `build-finanzas-app.sh` | Genera `~/Applications/Finanzas.app` |

## Comprobar servicio

```bash
curl http://127.0.0.1:8000/health
launchctl print "gui/$(id -u)/com.finanzas.local"
```
