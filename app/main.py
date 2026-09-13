import logging
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
from typing import Optional
from urllib.parse import quote

logger = logging.getLogger(__name__)

from fastapi import FastAPI, Form, HTTPException, Request
from pydantic import BaseModel
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.config import USER_NAME
from app.database import get_db, init_db
from app.gbm import has_investment_data, import_from_excel as import_gbm_excel
from app.google_sync import get_google_status, log_sync_error, sync_from_google
from app.market import format_price_age, get_price_history, refresh_prices, source_label
from app.finances import close_month, set_payment_goal, set_savings_goal
from app.queries import (
    MONTH_NAMES,
    add_card,
    add_category,
    add_patrimony,
    add_transaction,
    delete_transaction,
    get_card_detail,
    get_cards,
    get_dashboard,
    get_investments,
    upsert_holding,
    delete_holding,
    get_latest_net_worth,
    get_other_expenses,
    get_persons,
    get_monthly_activity,
    get_transactions,
    get_upcoming_payments,
    total_revolving_debt,
    update_card_dates,
    update_category,
    update_transaction,
    add_other_expense,
    update_other_expense,
)
from app.bmv_board import get_board_quotes, get_fx_quotes, get_indices_quotes
from app.logos import get_logo_fast, get_logos_batch, is_safe_logo_url
from app.terminal import (
    get_chart_data,
    get_economic_calendar,
    get_fx_panel,
    get_live_quotes,
    get_market_news,
    get_market_status,
    get_portfolio_live,
    get_quote_detail,
)
from app.catalog import catalog_count, list_catalog, search_catalog
from app.seed import seed_from_excel
from app.report import build_monthly_pdf
from app.simulator import simulate_payoff

BASE_DIR = Path(__file__).parent
templates = Jinja2Templates(directory=BASE_DIR / "templates")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    conn = get_db()
    count = conn.execute("SELECT COUNT(*) AS n FROM credit_cards").fetchone()["n"]
    conn.close()
    if count == 0:
        try:
            seed_from_excel()
        except FileNotFoundError:
            pass
    if not has_investment_data():
        try:
            import_gbm_excel()
        except FileNotFoundError:
            pass
    yield


app = FastAPI(title="Finanzas", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


def _fmt(n: float) -> str:
    return f"${n:,.2f}"


templates.env.filters["currency"] = _fmt
templates.env.globals["month_names"] = MONTH_NAMES
templates.env.globals["latest_net_worth"] = get_latest_net_worth
templates.env.globals["user_name"] = USER_NAME
templates.env.globals["current_year"] = date.today().year
templates.env.globals["current_month"] = date.today().month
templates.env.globals["source_label"] = source_label
templates.env.globals["format_price_age"] = format_price_age


def _ctx(request: Request, page: str, **extra):
    return {"request": request, "page": page, **extra}


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/offline", response_class=HTMLResponse)
async def offline_page(request: Request):
    return templates.TemplateResponse("offline.html", _ctx(request, "dashboard"))


@app.get("/manifest.webmanifest")
async def manifest():
    path = BASE_DIR / "static" / "manifest.webmanifest"
    return Response(path.read_text(), media_type="application/manifest+json")


@app.get("/exportar/mensual.pdf")
@app.get("/exportar/mensual")
async def export_monthly_pdf():
    try:
        pdf = build_monthly_pdf()
    except Exception:
        logger.exception("No se pudo generar el PDF mensual")
        return HTMLResponse(
            "<h1>No se pudo generar el PDF</h1>"
            "<p>Revisa que fpdf2 esté instalado y reinicia con <code>iniciar.command</code>.</p>",
            status_code=500,
        )
    fname = f"finanzas-{date.today().strftime('%Y-%m')}.pdf"
    return Response(
        pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


class PaymentGoalBody(BaseModel):
    amount: float


class SavingsGoalBody(BaseModel):
    amount: float


@app.get("/api/pagos-proximos")
async def upcoming_payments_api():
    return get_upcoming_payments()


@app.get("/api/bolsa-ticker")
async def bolsa_ticker_api():
    return get_board_quotes()


@app.get("/api/terminal/indices")
async def terminal_indices_api():
    return get_indices_quotes()


@app.get("/api/terminal/fx-board")
async def terminal_fx_board_api():
    return get_fx_quotes()


@app.get("/api/terminal/chart")
async def terminal_chart_api(symbol: str = "IPC", period: str = "6mo", compare: str = ""):
    return get_chart_data(symbol, period, compare=compare)


@app.get("/api/terminal/news")
async def terminal_news_api(limit: int = 30, symbol: str = ""):
    items = get_market_news(limit, symbol=symbol)
    return {"items": items, "count": len(items)}


@app.get("/api/terminal/quote")
async def terminal_quote_api(symbol: str = "IPC"):
    return get_quote_detail(symbol)


@app.get("/api/terminal/catalog")
async def terminal_catalog_api(q: str = "", board: str = "all", limit: int = 50):
    if q.strip():
        items = search_catalog(q, limit=limit)
    else:
        items = list_catalog(board=board, limit=limit)
    return {"items": items, "count": len(items), "total": catalog_count()}


@app.get("/api/terminal/fx")
async def terminal_fx_api():
    return {"items": get_fx_panel(), "fetched_at": get_market_status()["time_mx"]}


@app.get("/api/terminal/calendar")
async def terminal_calendar_api(limit: int = 12):
    return {"items": get_economic_calendar(limit)}


@app.get("/api/terminal/market")
async def terminal_market_api():
    return get_market_status()


@app.get("/api/terminal/live")
async def terminal_live_api(symbols: str = ""):
    syms = [s.strip() for s in symbols.split(",") if s.strip()]
    if not syms:
        return {"quotes": {}}
    return {"quotes": get_live_quotes(syms), "fetched_at": get_market_status()["time_mx"]}


@app.get("/api/terminal/portfolio")
async def terminal_portfolio_api():
    return get_portfolio_live()


@app.get("/api/terminal/logo/{symbol}")
async def terminal_logo_api(symbol: str):
    info = get_logo_fast(symbol)
    url = info.get("url")
    if url and is_safe_logo_url(url):
        return RedirectResponse(url, status_code=302)
    raise HTTPException(status_code=404, detail="Logo no disponible")


@app.get("/api/terminal/logos")
async def terminal_logos_api(symbols: str = ""):
    syms = [s.strip() for s in symbols.split(",") if s.strip()]
    return {"logos": get_logos_batch(syms[:80])}


@app.post("/api/meta-pago")
async def set_payment_goal_api(body: PaymentGoalBody):
    goal = set_payment_goal(body.amount)
    dash = get_dashboard()
    return {
        "goal": goal,
        "month_payments": dash["month_payments"],
        "progress_pct": min(100, (dash["month_payments"] / goal * 100) if goal else 0),
    }


@app.get("/api/meta-pago")
async def get_payment_goal_api():
    dash = get_dashboard()
    goal = dash["payment_goal"]
    paid = dash["month_payments"]
    return {
        "goal": goal,
        "month_payments": paid,
        "progress_pct": min(100, (paid / goal * 100) if goal else 0),
    }


@app.post("/api/meta-ahorro")
async def set_savings_goal_api(body: SavingsGoalBody):
    goal = set_savings_goal(body.amount)
    dash = get_dashboard()
    progress = dash["savings_progress"]
    return {
        "goal": goal,
        "progress": progress,
        "progress_pct": min(100, (progress / goal * 100) if goal else 0),
    }


@app.get("/api/meta-ahorro")
async def get_savings_goal_api():
    dash = get_dashboard()
    goal = dash["savings_goal"]
    progress = dash["savings_progress"]
    return {
        "goal": goal,
        "progress": progress,
        "progress_pct": min(100, (progress / goal * 100) if goal else 0),
    }


@app.get("/api/terminal/precios/{ticker}")
async def terminal_price_history_api(ticker: str, limit: int = 90):
    rows = get_price_history(ticker, limit=limit)
    return {"ticker": ticker.upper().replace("BMV:", ""), "items": rows, "count": len(rows)}


@app.get("/exportar/portafolio.csv")
async def export_portfolio_csv():
    from app.queries import export_holdings_csv

    csv_data = export_holdings_csv()
    fname = f"portafolio-{date.today().isoformat()}.csv"
    return Response(
        csv_data,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@app.get("/api/widgets")
async def widgets_api():
    """Lightweight JSON for PWA widgets / external consumers."""
    data = get_monthly_activity()
    dash = data["dashboard"]
    next_pay = dash["upcoming_payments"][0] if dash["upcoming_payments"] else None
    return {
        "net_worth": dash["unified_net"],
        "debt": dash["total_balance"],
        "gbm": dash["gbm_live"],
        "health_score": dash["health"]["score"],
        "month_payments": data["month_payments"],
        "payment_goal": dash["payment_goal"],
        "month_expenses": data["month_expenses"],
        "next_payment": {
            "name": next_pay["name"],
            "days": next_pay["days"],
            "amount": next_pay.get("amount"),
        } if next_pay else None,
        "updated": date.today().isoformat(),
    }


@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    return templates.TemplateResponse("dashboard.html", _ctx(request, "dashboard", data=get_dashboard()))


@app.get("/tarjetas", response_class=HTMLResponse)
async def cards_page(request: Request):
    data = get_dashboard()
    return templates.TemplateResponse("cards.html", _ctx(request, "cards", cards=data["cards"], data=data))


@app.get("/tarjetas/{card_id}", response_class=HTMLResponse)
async def card_detail(request: Request, card_id: int):
    detail = get_card_detail(card_id)
    if not detail:
        return RedirectResponse("/tarjetas", status_code=303)
    balance = sum(c["amount"] for c in detail["categories"])
    revolving = sum(c["amount"] for c in detail["categories"] if c.get("kind") != "loan")
    loan_balance = sum(c["amount"] for c in detail["categories"] if c.get("kind") == "loan")
    line = detail["card"]["credit_line"]
    card_info = next((c for c in get_cards() if c["id"] == card_id), None)
    usage_pct = (revolving / line * 100) if line else 0
    return templates.TemplateResponse("card_detail.html", _ctx(
        request, "cards",
        detail=detail,
        card_info=card_info,
        balance=balance,
        revolving=revolving,
        loan_balance=loan_balance,
        available=line - revolving,
        usage_pct=usage_pct,
        persons=get_persons(),
    ))


@app.post("/tarjetas/{card_id}/categoria")
async def add_category_route(
    card_id: int,
    name: str = Form(...),
    amount: float = Form(0),
    person_id: Optional[int] = Form(None),
):
    add_category(card_id, name, amount, person_id)
    return RedirectResponse(f"/tarjetas/{card_id}", status_code=303)


@app.post("/tarjetas/{card_id}/categoria/{cat_id}/editar")
async def update_category_route(
    card_id: int,
    cat_id: int,
    amount: float = Form(...),
    kind: str = Form("spend"),
):
    update_category(card_id, cat_id, amount, kind if kind in ("spend", "loan") else "spend")
    return RedirectResponse(f"/tarjetas/{card_id}", status_code=303)


@app.post("/tarjetas/{card_id}/fechas")
async def update_card_dates_route(
    card_id: int,
    cutoff_day: Optional[int] = Form(None),
    payment_due_day: Optional[int] = Form(None),
):
    update_card_dates(card_id, cutoff_day or None, payment_due_day or None)
    return RedirectResponse(f"/tarjetas/{card_id}", status_code=303)


@app.post("/tarjetas/nueva")
async def new_card_route(name: str = Form(...), credit_line: float = Form(...), person_id: int = Form(...)):
    add_card(name, credit_line, person_id)
    return RedirectResponse("/tarjetas", status_code=303)


@app.get("/patrimonio", response_class=HTMLResponse)
async def patrimony_page(request: Request):
    return templates.TemplateResponse("patrimony.html", _ctx(request, "patrimony", data=get_dashboard()))


@app.post("/patrimonio/cerrar")
async def close_month_route():
    result = close_month()
    return RedirectResponse(f"/patrimonio?closed=1&m={result['month']}&y={result['year']}", status_code=303)


@app.post("/patrimonio")
async def add_patrimony_route(
    year: int = Form(...),
    month: int = Form(...),
    gbm: float = Form(0),
    ppr: float = Form(0),
    business: float = Form(0),
    afore: float = Form(0),
    infonavit: float = Form(0),
):
    add_patrimony(year, month, gbm, ppr, business, afore, infonavit)
    return RedirectResponse("/patrimonio?saved=1", status_code=303)


@app.get("/movimientos", response_class=HTMLResponse)
async def transactions_page(request: Request):
    return templates.TemplateResponse("transactions.html", _ctx(
        request, "transactions",
        transactions=get_transactions(),
        cards=get_cards(),
        today=date.today().isoformat(),
    ))


@app.post("/movimientos")
async def add_transaction_route(
    date: str = Form(...),
    amount: float = Form(...),
    description: str = Form(""),
    category: str = Form(""),
    card_id: Optional[int] = Form(None),
    person_id: Optional[int] = Form(None),
    type: str = Form("expense"),
):
    try:
        add_transaction(date, amount, description, category, card_id, person_id, type)
    except ValueError as exc:
        return RedirectResponse(f"/movimientos?error=validation&msg={quote(str(exc))}", status_code=303)
    return RedirectResponse("/movimientos?saved=1", status_code=303)


@app.post("/movimientos/{tx_id}/editar")
async def edit_transaction_route(
    tx_id: int,
    date: str = Form(...),
    amount: float = Form(...),
    description: str = Form(""),
    category: str = Form(""),
    card_id: Optional[int] = Form(None),
    person_id: Optional[int] = Form(None),
    type: str = Form("expense"),
):
    try:
        if not update_transaction(tx_id, date, amount, description, category, card_id, person_id, type):
            return RedirectResponse("/movimientos?error=notfound", status_code=303)
    except ValueError as exc:
        return RedirectResponse(f"/movimientos?error=validation&msg={quote(str(exc))}", status_code=303)
    return RedirectResponse("/movimientos?updated=1", status_code=303)


@app.post("/movimientos/{tx_id}/eliminar")
async def delete_transaction_route(tx_id: int):
    if not delete_transaction(tx_id):
        return RedirectResponse("/movimientos?error=notfound", status_code=303)
    return RedirectResponse("/movimientos?deleted=1", status_code=303)


@app.get("/configuracion", response_class=HTMLResponse)
async def settings_page(request: Request):
    return templates.TemplateResponse("configuracion.html", _ctx(request, "settings"))


@app.post("/importar")
async def reimport(confirm: str = Form("")):
    if confirm != "REIMPORTAR":
        return RedirectResponse("/configuracion?error=1", status_code=303)
    try:
        seed_from_excel()
    except Exception as exc:
        logger.exception("reimport failed")
        return RedirectResponse(
            f"/configuracion?error=1&msg={quote(str(exc))}",
            status_code=303,
        )
    return RedirectResponse("/configuracion?ok=1", status_code=303)


@app.post("/gastos-fijos/{expense_id}")
async def update_fixed_expense_route(
    expense_id: int,
    amount: float = Form(...),
    due_day: Optional[int] = Form(None),
):
    update_other_expense(expense_id, amount, due_day or None)
    return RedirectResponse("/?updated=fixed", status_code=303)


@app.post("/gastos-fijos/nuevo")
async def add_fixed_expense_route(
    name: str = Form(...),
    amount: float = Form(...),
    due_day: Optional[int] = Form(None),
):
    add_other_expense(name, amount, due_day or None)
    return RedirectResponse("/?updated=fixed", status_code=303)


@app.get("/inversiones", response_class=HTMLResponse)
async def investments_page(request: Request):
    return templates.TemplateResponse("inversiones.html", _ctx(
        request, "investments",
        data=get_investments(),
        google=get_google_status(),
    ))


@app.post("/inversiones/importar")
async def import_gbm_route():
    try:
        import_gbm_excel()
    except FileNotFoundError as exc:
        log_sync_error("excel", str(exc))
        return RedirectResponse(
            f"/inversiones?error=import&msg={quote(str(exc))}",
            status_code=303,
        )
    except Exception as exc:
        log_sync_error("excel", str(exc))
        return RedirectResponse("/inversiones?error=import", status_code=303)
    return RedirectResponse("/inversiones?imported=1", status_code=303)


@app.post("/inversiones/sync/google")
async def sync_google_route():
    try:
        sync_from_google()
    except Exception as exc:
        log_sync_error("google", str(exc))
        return RedirectResponse(
            f"/inversiones?error=sync&msg={quote(str(exc))}",
            status_code=303,
        )
    return RedirectResponse("/inversiones?synced=1", status_code=303)


@app.post("/inversiones/refresh")
async def refresh_prices_route(force: str = Form("")):
    try:
        refresh_prices(force=force == "1")
    except Exception as exc:
        log_sync_error("market", str(exc))
        return RedirectResponse("/inversiones?error=prices", status_code=303)
    return RedirectResponse("/inversiones?refreshed=1", status_code=303)


@app.post("/inversiones/posicion")
async def upsert_holding_route(
    ticker: str = Form(...),
    name: str = Form(""),
    shares: float = Form(...),
    avg_cost: float = Form(...),
):
    try:
        upsert_holding(ticker, name, shares, avg_cost)
    except ValueError as exc:
        return RedirectResponse(f"/inversiones?error=holding&msg={quote(str(exc))}", status_code=303)
    except Exception as exc:
        log_sync_error("holding", str(exc))
        return RedirectResponse("/inversiones?error=holding", status_code=303)
    return RedirectResponse("/inversiones?saved=1", status_code=303)


@app.post("/inversiones/posicion/eliminar")
async def delete_holding_route(ticker: str = Form(...)):
    try:
        delete_holding(ticker)
    except Exception as exc:
        log_sync_error("holding", str(exc))
        return RedirectResponse("/inversiones?error=holding", status_code=303)
    return RedirectResponse("/inversiones?deleted=1", status_code=303)


@app.get("/simulador", response_class=HTMLResponse)
async def simulator_page(request: Request):
    cards = get_cards()
    return templates.TemplateResponse("simulador.html", _ctx(
        request, "simulator",
        cards=cards,
        total_debt=total_revolving_debt(cards),
        result=None,
    ))


@app.post("/simulador", response_class=HTMLResponse)
async def simulator_run(
    request: Request,
    monthly_payment: float = Form(...),
    apr: float = Form(45),
    strategy: str = Form("avalanche"),
):
    cards = get_cards()
    result = simulate_payoff(cards, monthly_payment, apr / 100, strategy)
    return templates.TemplateResponse("simulador.html", _ctx(
        request, "simulator",
        cards=cards,
        total_debt=total_revolving_debt(cards),
        result=result,
        monthly_payment=monthly_payment,
        apr=apr,
        strategy=strategy,
    ))
