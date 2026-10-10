.PHONY: test run sync

test:
	PYTHONPATH=. python3 -m pytest tests/ -q

run:
	uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

sync:
	./scripts/sync-runtime.sh
