from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.config import USER_NAME
from app.database import get_db, init_db
from app.queries import (
    MONTH_NAMES,
    add_card,
    add_category,
    add_patrimony,
    add_transaction,
    get_card_detail,
    get_cards,
    get_dashboard,
    get_latest_net_worth,
    get_persons,
    get_transactions,
    update_category,
)
from app.seed import seed_from_excel

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


def _ctx(request: Request, page: str, **extra):
    return {"request": request, "page": page, **extra}


@app.get("/health")
async def health():
    return {"status": "ok"}


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
    return templates.TemplateResponse("card_detail.html", _ctx(
        request, "cards",
        detail=detail,
        balance=balance,
        available=detail["card"]["credit_line"] - balance,
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
async def update_category_route(card_id: int, cat_id: int, amount: float = Form(...)):
    update_category(card_id, cat_id, amount)
    return RedirectResponse(f"/tarjetas/{card_id}", status_code=303)


@app.post("/tarjetas/nueva")
async def new_card_route(name: str = Form(...), credit_line: float = Form(...), person_id: int = Form(...)):
    add_card(name, credit_line, person_id)
    return RedirectResponse("/tarjetas", status_code=303)


@app.get("/patrimonio", response_class=HTMLResponse)
async def patrimony_page(request: Request):
    return templates.TemplateResponse("patrimony.html", _ctx(request, "patrimony", data=get_dashboard()))


@app.post("/patrimonio")
async def add_patrimony_route(
    year: int = Form(...),
    month: int = Form(...),
    gbm: float = Form(0),
    ppr: float = Form(0),
    business: float = Form(0),
    afore: float = Form(0),
    infonavit: float = Form(0),
    debt: float = Form(0),
):
    add_patrimony(year, month, gbm, ppr, business, afore, infonavit, debt)
    return RedirectResponse("/patrimonio", status_code=303)


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
    add_transaction(date, amount, description, category, card_id, person_id, type)
    return RedirectResponse("/movimientos", status_code=303)


@app.post("/importar")
async def reimport():
    seed_from_excel()
    return RedirectResponse("/", status_code=303)
