#!/usr/bin/env python3
import os
import socket
import subprocess
import sys
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
        print(f"Puerto {PORT} ocupado — cerrando proceso anterior...")
        kill_port(PORT)
        wait_port_free(PORT)
    if not port_in_use(PORT):
        return PORT
    for p in range(PORT + 1, PORT + 10):
        if not port_in_use(p):
            print(f"  (Puerto {PORT} no disponible, usando {p})")
            return p
    raise SystemExit(f"No hay puertos libres entre {PORT} y {PORT + 9}.")


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
        webbrowser.open(url)

    uvicorn.run("app.main:app", host="127.0.0.1", port=port, reload=False)
