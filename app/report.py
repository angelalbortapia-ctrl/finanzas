"""Monthly PDF report generation."""

from __future__ import annotations

from datetime import date
from io import BytesIO

from fpdf import FPDF

from app.config import USER_NAME
from app.queries import MONTH_NAMES, get_dashboard, get_monthly_activity


def _money(n: float) -> str:
    return f"${n:,.2f}"


class _ReportPDF(FPDF):
    def header(self):
        self.set_font("Helvetica", "B", 18)
        self.set_text_color(15, 23, 42)
        self.cell(0, 10, "Finanzas - Reporte mensual", align="L")
        self.ln(6)
        self.set_font("Helvetica", "", 10)
        self.set_text_color(100, 116, 139)
        self.cell(0, 6, f"{USER_NAME} | generado {date.today().strftime('%d/%m/%Y')}", align="L")
        self.ln(12)

    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(148, 163, 184)
        self.cell(0, 10, f"Página {self.page_no()}/{{nb}}", align="C")


def build_monthly_pdf() -> bytes:
    today = date.today()
    data = get_monthly_activity()
    dash = data["dashboard"]

    pdf = _ReportPDF()
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()

    # KPI row
    pdf.set_font("Helvetica", "B", 11)
    pdf.set_text_color(15, 23, 42)
    pdf.cell(0, 8, f"{MONTH_NAMES[today.month]} {today.year}", ln=True)
    pdf.ln(2)

    kpis = [
        ("Patrimonio neto", _money(dash["unified_net"])),
        ("Deuda revolvente", _money(dash["total_revolving"])),
        ("Activos totales", _money(dash["total_assets"])),
        ("GBM en vivo", _money(dash["gbm_live"])),
    ]
    col_w = 46
    y0 = pdf.get_y()
    for i, (label, val) in enumerate(kpis):
        x = 10 + i * col_w
        pdf.set_xy(x, y0)
        pdf.set_fill_color(238, 242, 255)
        pdf.rect(x, y0, col_w - 2, 22, "F")
        pdf.set_font("Helvetica", "", 8)
        pdf.set_text_color(100, 116, 139)
        pdf.set_xy(x + 3, y0 + 3)
        pdf.cell(col_w - 6, 4, label)
        pdf.set_font("Helvetica", "B", 11)
        pdf.set_text_color(15, 23, 42)
        pdf.set_xy(x + 3, y0 + 10)
        pdf.cell(col_w - 6, 6, val)
    pdf.ln(28)

    # Activity this month
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(15, 23, 42)
    pdf.cell(0, 8, "Actividad del mes", ln=True)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(51, 65, 85)
    pdf.cell(0, 6, f"Gastos registrados: {_money(data['month_expenses'])}", ln=True)
    pdf.cell(0, 6, f"Pagos a tarjetas: {_money(data['month_payments'])}", ln=True)
    pdf.cell(0, 6, f"Movimientos: {data['transaction_count']}", ln=True)
    pdf.ln(6)

    # Cards table
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(15, 23, 42)
    pdf.cell(0, 8, "Tarjetas de credito", ln=True)
    pdf.ln(2)

    headers = ("Tarjeta", "Saldo", "Linea", "Uso %")
    widths = (55, 40, 40, 25)
    pdf.set_fill_color(79, 70, 229)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 9)
    for h, w in zip(headers, widths):
        pdf.cell(w, 8, h, border=0, fill=True)
    pdf.ln()

    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(51, 65, 85)
    for c in dash["cards"]:
        if pdf.get_y() > 250:
            pdf.add_page()
        pdf.cell(widths[0], 7, c["name"][:28], border="B")
        pdf.cell(widths[1], 7, _money(c["balance"]), border="B")
        pdf.cell(widths[2], 7, _money(c["credit_line"]), border="B")
        pdf.cell(widths[3], 7, f"{c['usage_pct']:.0f}%", border="B")
        pdf.ln()
    pdf.ln(6)

    # Upcoming payments
    upcoming = dash["upcoming_payments"][:8]
    if upcoming:
        pdf.set_font("Helvetica", "B", 12)
        pdf.set_text_color(15, 23, 42)
        pdf.cell(0, 8, "Proximos pagos", ln=True)
        pdf.ln(2)
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(51, 65, 85)
        for p in upcoming:
            when = "Hoy" if p["days"] == 0 else f"en {p['days']}d"
            amt = _money(p["amount"]) if p.get("amount") else "-"
            pdf.cell(0, 6, f"  - {p['name']}: {amt} ({when})", ln=True)
        pdf.ln(4)

    # Recent transactions
    txs = data["transactions"][:25]
    if txs:
        if pdf.get_y() > 220:
            pdf.add_page()
        pdf.set_font("Helvetica", "B", 12)
        pdf.set_text_color(15, 23, 42)
        pdf.cell(0, 8, "Movimientos recientes", ln=True)
        pdf.ln(2)
        pdf.set_font("Helvetica", "B", 8)
        pdf.set_fill_color(241, 245, 249)
        pdf.set_text_color(100, 116, 139)
        for h, w in zip(("Fecha", "Tipo", "Monto", "Descripcion"), (22, 22, 30, 86)):
            pdf.cell(w, 7, h, fill=True)
        pdf.ln()
        pdf.set_font("Helvetica", "", 8)
        pdf.set_text_color(51, 65, 85)
        for t in txs:
            if pdf.get_y() > 270:
                pdf.add_page()
            tipo = "Gasto" if t["type"] == "expense" else "Pago"
            desc = (t.get("description") or t.get("category") or "")[:40]
            pdf.cell(22, 6, str(t["date"])[:10], border="B")
            pdf.cell(22, 6, tipo, border="B")
            pdf.cell(30, 6, _money(t["amount"]), border="B")
            pdf.cell(86, 6, desc, border="B")
            pdf.ln()

    # Health score footer
    pdf.ln(8)
    h = dash["health"]
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(79, 70, 229)
    label = h["label"].replace("í", "i").replace("é", "e")
    pdf.cell(0, 6, f"Salud crediticia: {h['score']}/100 - {label}", ln=True)

    buf = BytesIO()
    pdf.output(buf)
    return buf.getvalue()
