/* Panel financiero estilo TradingView para el terminal GBM */

const FIN_TABS = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'beneficios', label: 'Beneficios' },
  { id: 'ingresos', label: 'Ingresos' },
  { id: 'balance', label: 'Balance' },
  { id: 'flujo', label: 'Flujo' },
  { id: 'dividendos', label: 'Dividendos' },
  { id: 'stats', label: 'Estadísticas' },
];

const FIN_CHARTS = {};

function finState() {
  return window.FIN_PAGE || window.BB || {};
}

function finSetTab(tab) {
  const st = finState();
  st.finTab = tab;
}

function finSetPeriod(period) {
  const st = finState();
  st.finPeriod = period;
}

function finGetTab() {
  return finState().finTab || 'resumen';
}

function finGetPeriod() {
  return finState().finPeriod || 'annual';
}

function destroyFinCharts() {
  Object.values(FIN_CHARTS).forEach(ch => { try { ch.destroy(); } catch (_) {} });
  Object.keys(FIN_CHARTS).forEach(k => delete FIN_CHARTS[k]);
}

function finChartDefaults() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        labels: { color: '#8b95a8', font: { size: 10, family: 'ui-monospace' }, boxWidth: 10 },
      },
      tooltip: {
        backgroundColor: '#1c222d',
        titleColor: '#eef1f6',
        bodyColor: '#b4bcc9',
        borderColor: '#2a3140',
        borderWidth: 1,
      },
    },
    scales: {
      x: {
        ticks: { color: '#6d7788', font: { size: 9 } },
        grid: { color: 'rgba(22,28,40,0.6)' },
      },
      y: {
        ticks: { color: '#6d7788', font: { size: 9 } },
        grid: { color: 'rgba(22,28,40,0.6)' },
      },
    },
  };
}

function finAlignSeries(periods, series) {
  const map = {};
  (series || []).forEach(p => { map[p.period] = p.value; });
  return periods.map(p => map[p] ?? null);
}

function finMountChart(canvasId, config) {
  if (typeof Chart === 'undefined') return;
  const el = document.getElementById(canvasId);
  if (!el) return;
  if (FIN_CHARTS[canvasId]) {
    FIN_CHARTS[canvasId].destroy();
    delete FIN_CHARTS[canvasId];
  }
  FIN_CHARTS[canvasId] = new Chart(el, config);
}

function finBarPairChart(canvasId, labels, reported, estimate, labelReported, labelEstimate) {
  finMountChart(canvasId, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: labelReported,
          data: reported,
          backgroundColor: 'rgba(96, 165, 250, 0.85)',
          borderRadius: 2,
          order: 2,
        },
        {
          label: labelEstimate,
          data: estimate,
          backgroundColor: 'rgba(109, 119, 136, 0.55)',
          borderRadius: 2,
          order: 1,
        },
      ],
    },
    options: {
      ...finChartDefaults(),
      plugins: { ...finChartDefaults().plugins, legend: { display: true, labels: { color: '#8b95a8', font: { size: 9 } } } },
      scales: {
        x: { ...finChartDefaults().scales.x, stacked: false },
        y: { ...finChartDefaults().scales.y, beginAtZero: true },
      },
    },
  });
}

function finIncomeComboChart(canvasId, trend, annual) {
  const pack = annual ? trend.annual : trend.quarterly;
  if (!pack?.periods?.length) return;
  const periods = pack.periods;
  const revenue = finAlignSeries(periods, pack.revenue);
  const netIncome = finAlignSeries(periods, pack.net_income);
  const margin = finAlignSeries(periods, pack.margin_pct);
  finMountChart(canvasId, {
    data: {
      labels: periods,
      datasets: [
        {
          type: 'bar',
          label: 'Ingresos',
          data: revenue,
          backgroundColor: 'rgba(96, 165, 250, 0.75)',
          yAxisID: 'y',
          order: 2,
        },
        {
          type: 'bar',
          label: 'Utilidad neta',
          data: netIncome,
          backgroundColor: 'rgba(52, 211, 153, 0.65)',
          yAxisID: 'y',
          order: 3,
        },
        {
          type: 'line',
          label: 'Margen neto %',
          data: margin,
          borderColor: '#f59e0b',
          backgroundColor: 'transparent',
          yAxisID: 'y1',
          tension: 0.25,
          pointRadius: 2,
          order: 1,
        },
      ],
    },
    options: {
      ...finChartDefaults(),
      scales: {
        x: finChartDefaults().scales.x,
        y: {
          ...finChartDefaults().scales.y,
          position: 'left',
          ticks: {
            color: '#6d7788',
            font: { size: 9 },
            callback: v => finFmtAxis(v),
          },
        },
        y1: {
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { color: '#f59e0b', font: { size: 9 }, callback: v => v + '%' },
        },
      },
    },
  });
}

function finFmtAxis(v) {
  if (v == null) return '';
  const abs = Math.abs(v);
  if (abs >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (abs >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return String(v);
}

function finFmtVal(v, currency) {
  if (v == null || isNaN(v)) return '—';
  if (Math.abs(v) < 1000) return Number(v).toFixed(2);
  return typeof bbFmtLarge === 'function' ? bbFmtLarge(v, currency) : String(v);
}

function finSurpriseClass(v) {
  if (v == null || isNaN(v)) return '';
  return v >= 0 ? 'up' : 'down';
}

function finStatementTable(statement, currency) {
  if (!statement?.rows?.length) {
    return '<p class="bb-fin-empty">Sin datos para este periodo</p>';
  }
  const periods = statement.periods || [];
  const head = `<tr><th>Concepto</th>${periods.map(p => `<th>${escHtml(p)}</th>`).join('')}</tr>`;
  const body = statement.rows.map(row => {
    const cells = (row.values || []).map(v => {
      if (v == null) return '<td>—</td>';
      const abs = Math.abs(v);
      const txt = abs >= 1e4 ? finFmtVal(v, currency) : Number(v).toFixed(2);
      return `<td>${txt}</td>`;
    }).join('');
    return `<tr><td>${escHtml(row.label)}</td>${cells}</tr>`;
  }).join('');
  return `<div class="bb-fin-table-wrap"><table class="bb-fin-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function finPeriodToggle(id, onChange) {
  return `<div class="bb-fin-period-toggle" data-fin-toggle="${id}">
    <button type="button" class="active" data-period="annual">Anual</button>
    <button type="button" data-period="quarterly">Trimestral</button>
  </div>`;
}

function finRenderResumen(quote, data) {
  const f = data.fundamentals || quote?.fundamentals || {};
  const earn = data.earnings || {};
  const cur = data.currency || quote?.currency || 'MXN';
  const nextDate = earn.next_report_date;
  const fwd = earn.forward_eps;
  return `
    <div class="bb-fin-kpis">
      <div class="bb-fin-kpi"><span>Cap. bursátil</span><strong>${finFmtVal(f.market_cap, cur)}</strong></div>
      <div class="bb-fin-kpi"><span>P/E</span><strong>${f.pe_trailing != null ? Number(f.pe_trailing).toFixed(2) : '—'}</strong></div>
      <div class="bb-fin-kpi"><span>UTPA</span><strong>${f.eps != null ? Number(f.eps).toFixed(2) : '—'}</strong></div>
      <div class="bb-fin-kpi"><span>Margen</span><strong>${f.profit_margin != null ? Number(f.profit_margin).toFixed(1) + '%' : '—'}</strong></div>
    </div>
    ${nextDate ? `<div class="bb-fin-next-report">
      <div><span>Próximo reporte</span><strong>${escHtml(nextDate)}</strong></div>
      ${fwd != null ? `<div><span>UTPA estimada</span><strong>${Number(fwd).toFixed(2)} ${escHtml(cur)}</strong></div>` : ''}
    </div>` : ''}
    <div class="bb-fin-section">
      <div class="bb-fin-section-head">
        <span>Cuenta de resultados</span>
        ${finPeriodToggle('income-resumen')}
      </div>
      <div class="bb-fin-chart-box"><canvas id="finChartIncomeResumen"></canvas></div>
    </div>
    <div class="bb-fin-quote-grid">
      <div><span>Apertura</span><strong id="finQOpen">—</strong></div>
      <div><span>Máximo</span><strong id="finQHigh">—</strong></div>
      <div><span>Mínimo</span><strong id="finQLow">—</strong></div>
      <div><span>Volumen</span><strong id="finQVol">—</strong></div>
      <div><span>52 sem</span><strong id="finQ52">—</strong></div>
      <div><span>Bid/Ask</span><strong id="finQBid">—</strong></div>
    </div>`;
}

function finRenderBeneficios(data) {
  const rows = (data.earnings?.quarterly || []).slice(-12);
  if (!rows.length) {
    return '<p class="bb-fin-empty">Sin historial de beneficios (BPA) para esta emisora</p>';
  }
  const labels = rows.map(r => r.period || r.date.slice(0, 7));
  const reported = rows.map(r => r.reported_eps);
  const estimate = rows.map(r => r.estimate_eps);
  const tableHead = `<tr><th></th>${labels.map(l => `<th>${escHtml(l)}</th>`).join('')}</tr>`;
  const rowReported = `<tr><td>Informado</td>${reported.map(v => `<td>${v != null ? Number(v).toFixed(2) : '—'}</td>`).join('')}</tr>`;
  const rowEstimate = `<tr><td>Estimación</td>${estimate.map(v => `<td>${v != null ? Number(v).toFixed(2) : '—'}</td>`).join('')}</tr>`;
  const rowSurprise = `<tr><td>Sorpresa</td>${rows.map(r => {
    const v = r.surprise_pct;
    const cls = finSurpriseClass(v);
    return `<td class="${cls}">${v != null ? (v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%' : '—'}</td>`;
  }).join('')}</tr>`;
  return `
    <div class="bb-fin-section">
      <div class="bb-fin-section-head"><span>BPA (utilidad por acción)</span></div>
      <div class="bb-fin-chart-box"><canvas id="finChartEps"></canvas></div>
      <div class="bb-fin-table-wrap"><table class="bb-fin-table bb-fin-table--earnings">
        <thead>${tableHead}</thead><tbody>${rowReported}${rowEstimate}${rowSurprise}</tbody>
      </table></div>
    </div>`;
}

function finRenderIngresos(data) {
  const cur = data.currency || 'MXN';
  return `
    <div class="bb-fin-section">
      <div class="bb-fin-section-head">
        <span>Ingresos y utilidad</span>
        ${finPeriodToggle('income-main')}
      </div>
      <div class="bb-fin-chart-box"><canvas id="finChartIncomeMain"></canvas></div>
    </div>
    <div class="bb-fin-section">
      <div class="bb-fin-section-head">
        <span>Estado de resultados</span>
        ${finPeriodToggle('stmt-income')}
      </div>
      <div id="finStmtIncome">${finStatementTable(data.annual?.income, cur)}</div>
    </div>`;
}

function finRenderBalance(data) {
  const cur = data.currency || 'MXN';
  return `
    <div class="bb-fin-section">
      <div class="bb-fin-section-head">
        <span>Balance general</span>
        ${finPeriodToggle('stmt-balance')}
      </div>
      <div id="finStmtBalance">${finStatementTable(data.annual?.balance, cur)}</div>
    </div>`;
}

function finRenderFlujo(data) {
  const cur = data.currency || 'MXN';
  return `
    <div class="bb-fin-section">
      <div class="bb-fin-section-head">
        <span>Flujo de efectivo</span>
        ${finPeriodToggle('stmt-cashflow')}
      </div>
      <div id="finStmtCashflow">${finStatementTable(data.annual?.cashflow, cur)}</div>
    </div>`;
}

function finRenderDividendos(data) {
  const div = data.dividends || {};
  const cur = data.currency || 'MXN';
  if (!div.pays) {
    return `<p class="bb-fin-empty">${escHtml(data.symbol)} no ha pagado dividendos registrados en Yahoo Finance.</p>`;
  }
  const hist = div.history || [];
  const labels = hist.map(h => h.date.slice(0, 7));
  const amounts = hist.map(h => h.amount);
  return `
    <div class="bb-fin-kpis">
      <div class="bb-fin-kpi"><span>Yield</span><strong>${div.yield_pct != null ? Number(div.yield_pct).toFixed(2) + '%' : '—'}</strong></div>
      <div class="bb-fin-kpi"><span>Tasa anual</span><strong>${div.rate != null ? finFmtVal(div.rate, cur) : '—'}</strong></div>
      <div class="bb-fin-kpi"><span>Ex-div</span><strong>${div.ex_date || '—'}</strong></div>
    </div>
    <div class="bb-fin-section">
      <div class="bb-fin-section-head"><span>Historial de dividendos</span></div>
      <div class="bb-fin-chart-box bb-fin-chart-box--sm"><canvas id="finChartDiv"></canvas></div>
    </div>`;
}

function finRenderStats(data) {
  const stats = data.statistics || [];
  if (!stats.length) return '<p class="bb-fin-empty">Sin estadísticas disponibles</p>';
  return `<div class="bb-fin-stats-grid">${stats.map(s =>
    `<div class="bb-fin-stat-row"><span>${escHtml(s.label)}</span><strong>${escHtml(s.value)}</strong></div>`
  ).join('')}</div>`;
}

function finBindCharts(tab, data) {
  requestAnimationFrame(() => {
    if (tab === 'resumen' || tab === 'ingresos') {
      const annual = BB.finPeriod !== 'quarterly';
      finIncomeComboChart(
        tab === 'resumen' ? 'finChartIncomeResumen' : 'finChartIncomeMain',
        data.income_trends || {},
        annual,
      );
    }
    if (tab === 'beneficios') {
      const rows = (data.earnings?.quarterly || []).slice(-12);
      finBarPairChart(
        'finChartEps',
        rows.map(r => r.period || r.date.slice(0, 7)),
        rows.map(r => r.reported_eps),
        rows.map(r => r.estimate_eps),
        'Informado',
        'Estimación',
      );
    }
    if (tab === 'dividendos' && data.dividends?.history?.length) {
      const hist = data.dividends.history;
      finMountChart('finChartDiv', {
        type: 'bar',
        data: {
          labels: hist.map(h => h.date.slice(0, 7)),
          datasets: [{
            label: 'Dividendo',
            data: hist.map(h => h.amount),
            backgroundColor: 'rgba(212, 168, 83, 0.8)',
            borderRadius: 2,
          }],
        },
        options: finChartDefaults(),
      });
    }
  });
}

function finBindQuoteGrid(quote) {
  if (!quote || quote.error) return;
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  set('finQOpen', quote.open != null ? bbFmt(quote.open) : '—');
  set('finQHigh', quote.high != null ? bbFmt(quote.high) : '—');
  set('finQLow', quote.low != null ? bbFmt(quote.low) : '—');
  set('finQVol', quote.volume != null ? (quote.volume >= 1e6 ? (quote.volume/1e6).toFixed(1)+'M' : String(Math.round(quote.volume))) : '—');
  if (quote.week52_low != null && quote.week52_high != null) {
    set('finQ52', bbFmt(quote.week52_low) + ' – ' + bbFmt(quote.week52_high));
  }
  const bid = quote.bid != null ? formatQuotePrice(quote.bid, quote.kind) : '—';
  const ask = quote.ask != null ? formatQuotePrice(quote.ask, quote.kind) : '—';
  set('finQBid', `${bid} / ${ask}`);
}

function finBindPeriodToggles(data) {
  document.querySelectorAll('[data-fin-toggle]').forEach(wrap => {
    wrap.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        wrap.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        finSetPeriod(btn.dataset.period);
        const toggleId = wrap.dataset.finToggle;
        const annual = finGetPeriod() !== 'quarterly';
        const cur = data.currency || 'MXN';
        if (toggleId === 'income-resumen') {
          finIncomeComboChart('finChartIncomeResumen', data.income_trends || {}, annual);
        } else if (toggleId === 'income-main') {
          finIncomeComboChart('finChartIncomeMain', data.income_trends || {}, annual);
        } else if (toggleId === 'stmt-income') {
          const stmt = annual ? data.annual?.income : data.quarterly?.income;
          const el = document.getElementById('finStmtIncome');
          if (el) el.innerHTML = finStatementTable(stmt, cur);
        } else if (toggleId === 'stmt-balance') {
          const stmt = annual ? data.annual?.balance : data.quarterly?.balance;
          const el = document.getElementById('finStmtBalance');
          if (el) el.innerHTML = finStatementTable(stmt, cur);
        } else if (toggleId === 'stmt-cashflow') {
          const stmt = annual ? data.annual?.cashflow : data.quarterly?.cashflow;
          const el = document.getElementById('finStmtCashflow');
          if (el) el.innerHTML = finStatementTable(stmt, cur);
        }
      });
    });
  });
}

function renderFinHub(quote, data, tab) {
  const hub = document.getElementById('bbFinHub');
  const nav = document.getElementById('bbFinNav');
  const content = document.getElementById('bbFinContent');
  const status = document.getElementById('bbFinStatus');
  if (!hub || !nav || !content) return;

  const onPage = document.body.classList.contains('page-emisora');
  if (!quote || quote.error || !data || data.error || !data.applicable) {
    if (!onPage) hub.hidden = true;
    return;
  }

  hub.hidden = false;
  const activeTab = tab || finGetTab() || 'resumen';
  finSetTab(activeTab);
  if (!finGetPeriod()) finSetPeriod('annual');

  nav.innerHTML = FIN_TABS.map(t =>
    `<button type="button" class="bb-fin-nav-btn${t.id === activeTab ? ' active' : ''}" data-fin-tab="${t.id}">${t.label}</button>`
  ).join('');

  destroyFinCharts();

  let html = '';
  if (activeTab === 'resumen') html = finRenderResumen(quote, data);
  else if (activeTab === 'beneficios') html = finRenderBeneficios(data);
  else if (activeTab === 'ingresos') html = finRenderIngresos(data);
  else if (activeTab === 'balance') html = finRenderBalance(data);
  else if (activeTab === 'flujo') html = finRenderFlujo(data);
  else if (activeTab === 'dividendos') html = finRenderDividendos(data);
  else if (activeTab === 'stats') html = finRenderStats(data);

  content.innerHTML = html;
  if (status) {
    status.textContent = data.fetched_at ? `Yahoo Finance · ${data.fetched_at}` : '';
  }

  finBindCharts(activeTab, data);
  finBindQuoteGrid(quote);
  finBindPeriodToggles(data);

  nav.querySelectorAll('.bb-fin-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      finSetTab(btn.dataset.finTab);
      if (onPage && FIN_PAGE.lastQuote && FIN_PAGE.lastFinancials) {
        const sym = document.getElementById('bbEmisoraSymbol')?.textContent;
        history.replaceState(null, '', `/emisora/${encodeURIComponent(sym || '')}?tab=${btn.dataset.finTab}`);
      }
      renderFinHub(quote, data, btn.dataset.finTab);
    });
  });
}

function showFinHubLoading() {
  const hub = document.getElementById('bbFinHub');
  const content = document.getElementById('bbFinContent');
  const status = document.getElementById('bbFinStatus');
  if (!hub || !content) return;
  hub.hidden = false;
  destroyFinCharts();
  content.innerHTML = '<p class="bb-fin-empty">Cargando información financiera…</p>';
  if (status) status.textContent = '';
}

function hideFinHub() {
  const hub = document.getElementById('bbFinHub');
  if (hub) hub.hidden = true;
  destroyFinCharts();
}
