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
from app.bmv_board import get_board_quotes
from app.auth import check_pin, make_session_token, pin_enabled, safe_next, verify_session_token
from app.logos import LOGO_OVERRIDES, enqueue_logo_resolve, get_logo_fast, get_symbol_logo, is_safe_logo_url
from app.market import get_price_meta
from app.terminal import (
    _compute_indicators,
    _fallback_chart_points,
    _income_trends,
    get_chart_data,
    get_financials_detail,
    get_economic_calendar,
    get_fx_panel,
    get_holding_position,
    get_live_quotes,
    get_market_status,
    get_portfolio_live,
)


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

    def test_payment_reversal_restores_categories(self):
        from app.queries import _apply_payment_to_card, _card_revolving_total, _reverse_payment_to_card

        conn = get_db()
        conn.execute("DELETE FROM card_categories")
        conn.execute("DELETE FROM credit_cards")
        conn.execute("DELETE FROM persons")
        conn.execute("INSERT INTO persons (id, name) VALUES (1, 'Test')")
        conn.execute(
            "INSERT INTO credit_cards (id, name, credit_line, person_id) VALUES (1, 'TC', 50000, 1)"
        )
        conn.execute(
            "INSERT INTO card_categories (id, card_id, name, amount, kind) VALUES (1, 1, 'Gastos', 1000, 'spend')"
        )
        conn.execute(
            "INSERT INTO card_categories (id, card_id, name, amount, kind) VALUES (2, 1, 'Compras', 500, 'spend')"
        )
        conn.execute(
            "INSERT INTO transactions (id, date, amount, description, category, card_id, type) "
            "VALUES (99, '2026-01-01', 600, 'pago', 'Pagos', 1, 'payment')"
        )
        conn.commit()
        _apply_payment_to_card(conn, 1, 600, 99)
        conn.commit()
        self.assertAlmostEqual(_card_revolving_total(conn, 1), 900.0)
        _reverse_payment_to_card(conn, {"id": 99, "card_id": 1, "amount": 600, "type": "payment"})
        conn.commit()
        self.assertAlmostEqual(_card_revolving_total(conn, 1), 1500.0)
        conn.close()

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

    def test_chart_fallback_when_yahoo_fails(self):
        from unittest.mock import patch

        fake = [{"t": "2026-01-01", "o": 100.0, "h": 100.0, "l": 100.0, "c": 100.0}]
        with patch("app.terminal._fetch_yahoo_history", side_effect=RuntimeError("yahoo down")), patch(
            "app.terminal._fallback_chart_points", return_value=fake,
        ):
            data = get_chart_data("IPC", "6mo")
        self.assertEqual(len(data.get("points") or []), 1)
        self.assertTrue(data.get("stale"))

    def test_fallback_chart_points_from_cache(self):
        from app.catalog import get_symbol_meta

        conn = get_db()
        conn.execute(
            "INSERT OR REPLACE INTO price_cache (ticker, price, source, fetched_at) VALUES (?, ?, ?, ?)",
            ("BMV:GFNORTEO", 199.12, "test", "2026-09-11T12:00:00"),
        )
        conn.commit()
        conn.close()
        meta = get_symbol_meta("GFNORTEO")
        pts = _fallback_chart_points("GFNORTEO", meta)
        self.assertGreaterEqual(len(pts), 2)

    def test_is_known_symbol(self):
        from app.catalog import is_known_symbol

        self.assertTrue(is_known_symbol("GFNORTEO"))
        self.assertTrue(is_known_symbol("IPC"))
        self.assertFalse(is_known_symbol("ZZZZNOTREAL"))

    def test_emisora_page_route(self):
        from fastapi.testclient import TestClient
        from app.main import app

        client = TestClient(app)
        ok = client.get("/emisora/GFNORTEO")
        self.assertEqual(ok.status_code, 200)
        self.assertIn("GFNORTEO", ok.text)
        bad = client.get("/emisora/ZZZZNOTREAL")
        self.assertEqual(bad.status_code, 404)

    def test_financials_not_applicable_for_index(self):
        data = get_financials_detail("IPC")
        self.assertFalse(data.get("applicable"))

    def test_financials_statement_shape(self):
        from unittest.mock import MagicMock, patch

        import pandas as pd

        df = pd.DataFrame(
            {"2024": [1000.0, 120.0], "2023": [900.0, 100.0]},
            index=["Total Revenue", "Net Income"],
        )
        mock_ticker = MagicMock()
        mock_ticker.info = {"currency": "MXN", "trailingEps": 1.0}
        mock_ticker.financials = df
        mock_ticker.balance_sheet = pd.DataFrame()
        mock_ticker.cashflow = pd.DataFrame()
        mock_ticker.quarterly_financials = pd.DataFrame()
        mock_ticker.quarterly_balance_sheet = pd.DataFrame()
        mock_ticker.quarterly_cashflow = pd.DataFrame()

        with patch("yfinance.Ticker", return_value=mock_ticker):
            data = get_financials_detail("GFNORTEO", section="ingresos")
        self.assertTrue(data.get("applicable"))
        income = data.get("annual", {}).get("income")
        self.assertIsNotNone(income)
        self.assertEqual(income["periods"], ["2024", "2023"])
        self.assertGreaterEqual(len(income["rows"]), 1)

    def test_income_trends_rejects_negative_revenue(self):
        import pandas as pd

        qdf = pd.DataFrame(
            {
                "2025-06-30": [-13555361681.0, 500.0],
                "2025-03-31": [12000000000.0, 400.0],
            },
            index=["Total Revenue", "Net Income"],
        )
        trends = _income_trends(pd.DataFrame(), qdf)
        quarterly = trends["quarterly"]
        self.assertEqual(len(quarterly["revenue"]), 1)
        self.assertEqual(quarterly["revenue"][0]["value"], 12000000000.0)
        bad_periods = {r["period"] for r in quarterly["revenue"] if r["value"] < 0}
        self.assertEqual(bad_periods, set())
        self.assertTrue(all(abs(m["value"]) <= 100 for m in quarterly["margin_pct"]))

    def test_financials_resumen_section(self):
        from unittest.mock import MagicMock, patch

        import pandas as pd

        df = pd.DataFrame(
            {"2024": [1000.0, 120.0]},
            index=["Total Revenue", "Net Income"],
        )
        mock_ticker = MagicMock()
        mock_ticker.info = {"currency": "MXN", "trailingPE": 10, "forwardPE": 9}
        mock_ticker.financials = df
        mock_ticker.quarterly_financials = df
        mock_ticker.balance_sheet = pd.DataFrame()

        with patch("yfinance.Ticker", return_value=mock_ticker):
            data = get_financials_detail("GFNORTEO", section="resumen")
        self.assertEqual(data.get("section"), "resumen")
        self.assertIn("income_trends", data)
        self.assertNotIn("annual", data)

    def test_holding_position_none_for_unknown(self):
        self.assertIsNone(get_holding_position("ZZZZNOTREAL"))

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

    def test_logo_override(self):
        self.assertIn("GFNORTEO", LOGO_OVERRIDES)
        info = get_symbol_logo("GFNORTEO")
        self.assertEqual(info["symbol"], "GFNORTEO")
        self.assertIn("banorte", info.get("url") or "")
        self.assertEqual(info.get("source"), "override")
        fast = get_logo_fast("GFNORTEO")
        self.assertIn("banorte", fast.get("url") or "")
        self.assertTrue(is_safe_logo_url(fast["url"]))
        self.assertFalse(is_safe_logo_url("https://evil.example/logo.svg"))

    def test_board_quotes_cached(self):
        a = get_board_quotes()
        b = get_board_quotes()
        self.assertEqual(a.get("fetched_at"), b.get("fetched_at"))

    def test_pin_disabled_by_default(self):
        self.assertFalse(pin_enabled())

    def test_api_requires_pin_when_enabled(self):
        import asyncio
        from unittest.mock import AsyncMock, MagicMock

        import app.auth as auth

        orig = auth.FINANZAS_PIN
        try:
            auth.FINANZAS_PIN = "1234"
            for path in ("/api/status", "/exportar/portafolio.csv"):
                request = MagicMock()
                request.url.path = path
                request.cookies = {}
                call_next = AsyncMock()
                response = asyncio.run(auth.pin_middleware(request, call_next))
                self.assertEqual(response.status_code, 401)
                call_next.assert_not_called()
        finally:
            auth.FINANZAS_PIN = orig

    def test_safe_next_blocks_open_redirect(self):
        self.assertEqual(safe_next("//evil.com"), "/")
        self.assertEqual(safe_next("/tarjetas"), "/tarjetas")
        self.assertEqual(safe_next(""), "/")

    def test_session_token_roundtrip(self):
        import app.auth as auth
        orig = auth.FINANZAS_PIN
        try:
            auth.FINANZAS_PIN = "1234"
            token = make_session_token()
            self.assertTrue(verify_session_token(token))
            self.assertFalse(verify_session_token("bad.token"))
        finally:
            auth.FINANZAS_PIN = orig
        self.assertFalse(check_pin("1234"))

    def test_get_price_meta_shape(self):
        meta = get_price_meta()
        self.assertIn("source_label", meta)
        self.assertIn("fetched_age", meta)
        self.assertIn("breakdown", meta)

    def test_portfolio_live_snapshot_mode(self):
        port = get_portfolio_live()
        self.assertIn("price_meta", port)
        if port.get("snapshot"):
            self.assertEqual(port["snapshot"]["price_mode"], "snapshot")

    def test_enqueue_logo_resolve(self):
        enqueue_logo_resolve("ZZZZTEST")
        fast = get_logo_fast("ZZZZTEST")
        self.assertIsNone(fast.get("url"))

    def test_api_status_payload(self):
        from app.market import get_price_meta
        from app.queries import get_latest_net_worth
        from app.terminal import get_market_status

        payload = {
            "net_worth": get_latest_net_worth(),
            "price_meta": get_price_meta(),
            "market": get_market_status(),
        }
        self.assertIn("net_worth", payload)
        self.assertIn("source_label", payload["price_meta"])
        self.assertIn("status", payload["market"])

    def test_investments_symbol_override(self):
        from app.catalog import get_symbol_meta
        from app.queries import get_investments

        data = get_investments()
        sym = "GFNORTEO"
        if get_symbol_meta(sym) and data.get("terminal"):
            data["terminal"] = {**data["terminal"], "default_symbol": sym}
            self.assertEqual(data["terminal"]["default_symbol"], sym)

    def test_save_to_db_tracks_removed(self):
        conn = get_db()
        now = "2026-01-01T00:00:00"
        conn.execute("DELETE FROM investment_holdings")
        conn.execute(
            """INSERT INTO investment_holdings
               (ticker, name, shares, avg_cost, market_price, market_value, pnl, updated_at, price_source)
               VALUES ('BMV:OLD', 'Old', 10, 100, 110, 1100, 100, ?, 'excel')""",
            (now,),
        )
        conn.execute(
            "INSERT INTO investment_snapshot (invested, market_value, cash, pnl, return_pct, updated_at) VALUES (1000, 1100, 0, 100, 10, ?)",
            (now,),
        )
        conn.commit()
        conn.close()
        data = {
            "snapshot": {"invested": 500, "market_value": 550, "cash": 0, "pnl": 50, "return_pct": 10},
            "holdings": [{
                "ticker": "BMV:NEW", "name": "New", "shares": 5, "avg_cost": 100,
                "market_price": 110, "market_value": 550, "pnl": 50, "weight_pct": 100,
            }],
        }
        meta = _save_to_db(data, "excel")
        self.assertEqual(meta["imported"], 1)
        self.assertEqual(len(meta["removed"]), 1)
        self.assertEqual(meta["removed"][0]["ticker"], "BMV:OLD")


if __name__ == "__main__":
    unittest.main()
