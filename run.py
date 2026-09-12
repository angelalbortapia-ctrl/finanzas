#!/usr/bin/env python3
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
PORT = 8000
URL = f"http://127.0.0.1:{PORT}"

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


def kill_port(port: int):
    try:
        result = subprocess.run(
            ["lsof", "-ti", f":{port}"],
            capture_output=True, text=True,
        )
        pids = result.stdout.strip().split()
        for pid in pids:
            if pid:
                subprocess.run(["kill", "-9", pid], check=False)
    except FileNotFoundError:
        pass


def kill_stale_servers():
    for port in range(PORT, PORT + 6):
        kill_port(port)
    for pattern in ("uvicorn.*app.main:app", "python3.*run.py"):
        try:
            subprocess.run(["pkill", "-f", pattern], check=False)
        except FileNotFoundError:
            pass


def wait_port_free(port: int, timeout: float = 3.0):
    import time
    t0 = time.time()
    while time.time() - t0 < timeout:
        if not port_in_use(port):
            return True
        time.sleep(0.2)
    return not port_in_use(port)


def pick_port() -> int:
    if port_in_use(PORT):
        print(f"Puerto {PORT} ocupado — cerrando procesos anteriores...")
        kill_stale_servers()
        wait_port_free(PORT)
    if not port_in_use(PORT):
        return PORT
    for p in range(PORT + 1, PORT + 10):
        if not port_in_use(p):
            print(f"  (Puerto {PORT} no disponible, usando {p})")
            return p
    raise SystemExit(f"No hay puertos libres entre {PORT} y {PORT + 9}.")


def open_browser_when_ready(url: str):
    def _wait():
        health = f"{url}/health"
        for _ in range(40):
            try:
                with urllib.request.urlopen(health, timeout=1) as resp:
                    if resp.status == 200:
                        webbrowser.open(url)
                        return
            except Exception:
                time.sleep(0.25)
        print(f"\n  No se pudo abrir el navegador automáticamente.")
        print(f"  Abre manualmente: {url}\n")

    threading.Thread(target=_wait, daemon=True).start()


if __name__ == "__main__":
    ensure_deps()
    import uvicorn

    port = pick_port()
    url = f"http://127.0.0.1:{port}"
    (ROOT / ".url").write_text(url)

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
