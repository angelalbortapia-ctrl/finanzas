"""Locks para operaciones que mutan datos compartidos."""

import threading

PORTFOLIO_LOCK = threading.Lock()
