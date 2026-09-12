"""Smoke tests — run with: PYTHONPATH=. python3 -m unittest tests.test_smoke"""
import tempfile
import unittest
from pathlib import Path

import app.database as db
from app.catalog import bmv_to_yahoo
from app.database import get_db, init_db
from app.finances import month_close_status
from app.gbm import _save_to_db
from app.gbm_fees import calc_net_sale
from app.history import get_portfolio_history
from app.market import _holding_ticker_key, get_price_history
from app.queries import (
    _apply_payment_to_card,
    _enrich_card,
    export_holdings_csv,
    get_investments,
    infer_category_kind,
)
from app.simulator import simulate_payoff
from app.terminal import _compute_indicators, get_economic_calendar, get_fx_panel, get_live_quotes, get_market_status


class SmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        cls._tmp.close()
        cls._orig_db = db.DB_PATH
        db.DB_PATH = Path(cls._tmp.name)
        init_db()

    @classmethod
    def tearDownClass(cls):
        db.DB_PATH = cls._orig_db
        Path(cls._tmp.name).unlink(missing_ok=True)

    def test_market_status(self):
        st = get_market_status()
        self.assertIn(st["status"], {"open", "closed", "pre", "after"})
        self.assertIn("time_mx", st)

    def test_gbm_fees(self):
        net = calc_net_sale(shares=100, avg_cost=50, market_price=60)
        self.assertGreater(net["net_pnl"], 0)

    def test_revolving_zero_not_total_balance(self):
        card = {
            "balance": 50000,
            "revolving_balance": 0,
            "loan_balance": 50000,
            "credit_line": 100000,
            "payment_due_day": 15,
        }
        enriched = _enrich_card(card)
        self.assertEqual(enriched["revolving_balance"], 0)
        self.assertEqual(enriched["available"], 100000)
        self.assertEqual(enriched["usage_pct"], 0)

    def test_bmv_to_yahoo_overrides(self):
        self.assertEqual(bmv_to_yahoo("IPC"), "^MXX")
        self.assertEqual(bmv_to_yahoo("GFNORTEO"), "GFNORTEO.MX")

    def test_infer_prestamo_kind(self):
        self.assertEqual(infer_category_kind("Préstamo"), "loan")
        self.assertEqual(infer_category_kind("Gastos"), "spend")

    def test_simulator_revolving_only(self):
        cards = [
            {"id": 1, "name": "A", "balance": 10000, "revolving_balance": 3000},
            {"id": 2, "name": "B", "balance": 5000, "revolving_balance": 0},
        ]
        result = simulate_payoff(cards, 2000, 0.45, "avalanche")
        self.assertNotIn("error", result)
        self.assertAlmostEqual(result["total_debt"], 3000, places=0)

    def test_portfolio_history_order(self):
        rows = get_portfolio_history(limit=5)
        if len(rows) >= 2:
            self.assertLessEqual(rows[-2]["recorded_at"], rows[-1]["recorded_at"])

    def test_month_close_status_shape(self):
        st = month_close_status()
        self.assertIn("remind", st)
        self.assertIn("needs_close", st)
        self.assertIn("label", st)

    def test_economic_calendar_dynamic(self):
        items = get_economic_calendar(5)
        self.assertTrue(items)
        self.assertIn("date", items[0])
        self.assertIn("event", items[0])

    def test_export_holdings_csv_header(self):
        csv_data = export_holdings_csv()
        self.assertTrue(csv_data.startswith("ticker,name,shares"))

    def test_live_quotes_partial_cache(self):
        q = get_live_quotes(["IPC", "GFNORTEO"])
        self.assertIsInstance(q, dict)

    def test_price_history_ticker_formats(self):
        conn = get_db()
        key = _holding_ticker_key("GFNORTEO")
        conn.execute(
            "INSERT OR IGNORE INTO price_history (ticker, price, source, recorded_at) VALUES (?, ?, ?, ?)",
            (key, 123.45, "test", "2026-01-01T00:00:00"),
        )
        conn.commit()
        conn.close()
        rows = get_price_history("GFNORTEO", limit=5)
        self.assertTrue(rows)
        self.assertEqual(rows[-1]["price"], 123.45)

    def test_payment_skips_loan_categories(self):
        conn = get_db()
        conn.execute("DELETE FROM card_categories")
        conn.execute("DELETE FROM credit_cards")
        conn.execute("INSERT OR IGNORE INTO persons (id, name) VALUES (1, 'Test')")
        conn.execute(
            "INSERT INTO credit_cards (id, name, credit_line, person_id) VALUES (99, 'Test', 50000, 1)"
        )
        conn.execute(
            "INSERT INTO card_categories (card_id, name, amount, kind) VALUES (99, 'Gasto', 1000, 'spend')"
        )
        conn.execute(
            "INSERT INTO card_categories (card_id, name, amount, kind) VALUES (99, 'Apartado', 5000, 'loan')"
        )
        _apply_payment_to_card(conn, 99, 1500)
        spend = conn.execute(
            "SELECT amount FROM card_categories WHERE card_id = 99 AND kind = 'spend'"
        ).fetchone()["amount"]
        loan = conn.execute(
            "SELECT amount FROM card_categories WHERE card_id = 99 AND kind = 'loan'"
        ).fetchone()["amount"]
        conn.commit()
        conn.close()
        self.assertEqual(spend, 0)
        self.assertEqual(loan, 5000)

    def test_empty_gbm_import_rejected(self):
        with self.assertRaises(ValueError):
            _save_to_db({"snapshot": {"invested": 0, "market_value": 0, "cash": 0, "pnl": 0, "return_pct": 0}, "holdings": []}, "excel")

    def test_get_investments_with_null_weight(self):
        data = get_investments()
        self.assertIn("terminal", data)
        self.assertIn("insights", data)

    def test_rsi_alignment(self):
        points = [{"c": 100 + i + (i % 3) * 0.5} for i in range(30)]
        rsi = _compute_indicators(points)["rsi14"]
        first_idx = next(i for i, v in enumerate(rsi) if v is not None)
        self.assertEqual(first_idx, 14)

    def test_fx_panel_includes_tiie(self):
        panel = get_fx_panel()
        tiie = next((x for x in panel if x.get("id") == "TIIE28"), None)
        self.assertIsNotNone(tiie)
        self.assertEqual(tiie["unit"], "%")
        self.assertIsNotNone(tiie["price"])


if __name__ == "__main__":
    unittest.main()
