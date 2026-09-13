#!/usr/bin/env python3
"""Arrancar Finanzas en http://127.0.0.1:8000"""
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get("FINANZAS_PORT", "8000"))

os.chdir(ROOT)
sys.path.insert(0, str(ROOT))


def ensure_deps():
    try:
        import fastapi  # noqa: F401
        import uvicorn  # noqa: F401
        import openpyxl  # noqa: F401
        import fpdf  # noqa: F401
        import yfinance  # noqa: F401
    except ImportError:
        print("Instalando dependencias...")
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "-r", "requirements.txt"],
        )


def port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def can_bind(port: int) -> bool:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind(("127.0.0.1", port))
        return True
    except OSError:
        return False


def _port_pids(port: int) -> list[str]:
    try:
        result = subprocess.run(
            ["lsof", "-ti", f":{port}"],
            capture_output=True, text=True,
        )
        return [p for p in result.stdout.strip().split() if p]
    except FileNotFoundError:
        return []


def kill_port(port: int, force: bool = False):
    pids = _port_pids(port)
    if not pids:
        return
    sig = "-9" if force else "-15"
    for pid in pids:
        subprocess.run(["kill", sig, pid], check=False)
    if not force:
        time.sleep(0.8)
        if port_in_use(port):
            kill_port(port, force=True)


def wait_port_free(port: int, timeout: float = 4.0) -> bool:
    t0 = time.time()
    while time.time() - t0 < timeout:
        if can_bind(port):
            return True
        time.sleep(0.2)
    return can_bind(port)


def prepare_port() -> int:
    if can_bind(PORT):
        return PORT
    print(f"Puerto {PORT} ocupado — cerrando instancia anterior de Finanzas...")
    kill_port(PORT)
    if wait_port_free(PORT):
        return PORT
    print()
    print("  No se pudo liberar el puerto", PORT)
    print("  En otra terminal ejecuta:")
    print(f"    lsof -ti:{PORT} | xargs kill -9")
    print("  Luego vuelve a correr:")
    print("    python3 run.py")
    print()
    raise SystemExit(1)


def open_browser_when_ready(url: str):
    def _wait():
        health = f"{url}/health"
        for _ in range(40):
            try:
                with urllib.request.urlopen(health, timeout=1) as resp:
                    if resp.status == 200:
                        try:
                            webbrowser.open(url)
                        except Exception:
                            pass
                        return
            except Exception:
                time.sleep(0.25)

    threading.Thread(target=_wait, daemon=True).start()


def main():
    ensure_deps()
    import uvicorn

    port = prepare_port()
    url = f"http://127.0.0.1:{port}"
    (ROOT / ".url").write_text(url + "\n")

    print()
    print("  ╔════════════════════════════════════════╗")
    print("  ║           FINANZAS — listo               ║")
    print(f"  ║   {url:<36} ║")
    print("  ║   Ctrl+C para detener                    ║")
    print("  ╚════════════════════════════════════════╝")
    print()

    if os.environ.get("FINANZAS_OPEN_BROWSER", "1") == "1":
        open_browser_when_ready(url)

    uvicorn.run("app.main:app", host="127.0.0.1", port=port, reload=False)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n  Detenido.\n")
    except Exception as exc:
        print(f"\n  Error al arrancar: {exc}\n", file=sys.stderr)
        raise SystemExit(1) from exc
