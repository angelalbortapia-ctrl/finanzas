/* Página de análisis por emisora — /emisora/{symbol} */
(function (global) {
  'use strict';

  global.FIN_PAGE = global.FIN_PAGE || {
    finTab: 'resumen',
    finPeriod: 'annual',
    _loadId: 0,
    chartPeriod: '6mo',
    section_fetched_at: {},
  };

  const CHART_PERIODS = [
    { id: '1mo', label: '1M' },
    { id: '6mo', label: '6M' },
    { id: '1y', label: '1A' },
    { id: '5y', label: '5A' },
  ];

  let emisoraChart = null;
  let emisoraSeries = null;

  function emisoraFmtPrice(n) {
    if (n == null || isNaN(n)) return '—';
    if (Math.abs(n) >= 10000) return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
    return '$' + Number(n).toFixed(2);
  }

  function emisoraPct(n) {
    if (n == null || isNaN(n)) return '—';
    return (n >= 0 ? '+' : '') + Number(n).toFixed(2) + '%';
  }

  function emisoraParseTime(t) {
    return String(t || '').slice(0, 10);
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function destroyEmisoraChart() {
    if (emisoraChart) {
      emisoraChart.remove();
      emisoraChart = null;
      emisoraSeries = null;
    }
  }

  function chartPeriodLabel(period) {
    const hit = CHART_PERIODS.find(p => p.id === period);
    return hit ? hit.label : period;
  }

  function updateChartPeriodUI(period) {
    document.querySelectorAll('[data-chart-period]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.chartPeriod === period);
    });
    const label = document.getElementById('bbEmisoraChartLabel');
    if (label) label.textContent = `Precio · ${chartPeriodLabel(period)}`;
  }

  function renderEmisoraChart(data) {
    const el = document.getElementById('bbEmisoraChart');
    const status = document.getElementById('bbEmisoraChartStatus');
    if (!el || !data?.points?.length) {
      if (status) status.textContent = data?.error || 'Sin datos de precio';
      return;
    }
    if (typeof global.LightweightCharts === 'undefined') {
      if (status) status.textContent = 'Gráfica no disponible';
      return;
    }
    destroyEmisoraChart();
    el.innerHTML = '';
    if (status) status.textContent = data.stale ? 'Datos limitados (caché)' : '';
    const w = el.clientWidth || 600;
    const h = el.clientHeight || 220;
    emisoraChart = global.LightweightCharts.createChart(el, {
      width: w,
      height: h,
      layout: { background: { color: '#07090e' }, textColor: '#6d7788', fontSize: 11 },
      grid: { vertLines: { color: 'rgba(22,28,40,0.55)' }, horzLines: { color: 'rgba(22,28,40,0.85)' } },
      rightPriceScale: { borderColor: '#161c28' },
      timeScale: { borderColor: '#161c28', timeVisible: true },
    });
    emisoraSeries = emisoraChart.addAreaSeries({
      lineColor: '#60a5fa',
      topColor: 'rgba(96,165,250,0.35)',
      bottomColor: 'rgba(96,165,250,0.02)',
      lineWidth: 2,
    });
    emisoraSeries.setData(
      data.points.map(p => ({ time: emisoraParseTime(p.t), value: p.c }))
    );
    emisoraChart.timeScale().fitContent();
  }

  async function loadEmisoraChart(symbol, period) {
    const sym = (symbol || '').replace('BMV:', '').toUpperCase();
    const res = await fetch(`/api/terminal/chart?symbol=${encodeURIComponent(sym)}&period=${encodeURIComponent(period)}`);
    return res.ok ? res.json() : {};
  }

  function renderHoldingWidget(holding) {
    const el = document.getElementById('bbEmisoraHolding');
    if (!el) return;
    if (!holding) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    const pnlCls = (holding.unrealized_pnl_abs || 0) >= 0 ? 'up' : 'down';
    el.hidden = false;
    el.innerHTML = `
      <div class="bb-emisora-holding-title">Tu posición</div>
      <div class="bb-emisora-holding-grid">
        <div><span>Costo prom.</span><strong>${emisoraFmtPrice(holding.avg_cost)}</strong></div>
        <div><span>P&L no real.</span><strong class="${pnlCls}">${emisoraFmtPrice(holding.unrealized_pnl_abs)} (${emisoraPct(holding.unrealized_pnl_pct)})</strong></div>
        <div><span>Peso actual</span><strong>${holding.weight_pct != null ? Number(holding.weight_pct).toFixed(1) + '%' : '—'}</strong></div>
        <div><span>Títulos</span><strong>${holding.shares != null ? Number(holding.shares).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}</strong></div>
      </div>`;
  }

  function updateEmisoraHero(quote) {
    const priceEl = document.getElementById('bbEmisoraPrice');
    const chgEl = document.getElementById('bbEmisoraChg');
    const nameEl = document.getElementById('bbEmisoraName');
    const metaEl = document.getElementById('bbEmisoraMeta');
    if (nameEl && quote?.name) nameEl.textContent = quote.name;
    if (metaEl) {
      const parts = [];
      if (quote?.board_title) parts.push(quote.board_title);
      if (quote?.fundamentals?.sector) parts.push(quote.fundamentals.sector);
      const yld = quote?.dividend_yield;
      if (yld != null && !isNaN(yld)) {
        const pct = Math.abs(yld) < 1 ? yld * 100 : yld;
        parts.push(`Yield ${Number(pct).toFixed(2)}%`);
      }
      metaEl.textContent = parts.join(' · ');
    }
    if (priceEl) priceEl.textContent = emisoraFmtPrice(quote?.price);
    if (chgEl) {
      const pct = quote?.change_pct ?? 0;
      chgEl.textContent = emisoraPct(pct);
      chgEl.className = 'bb-emisora-chg ' + (pct >= 0 ? 'up' : 'down');
    }
  }

  function renderEmisoraNews(items) {
    const el = document.getElementById('bbEmisoraNews');
    if (!el) return;
    if (!items?.length) {
      el.innerHTML = '<p class="bb-news-empty">Sin noticias recientes</p>';
      return;
    }
    el.innerHTML = items.slice(0, 12).map(n => `
      <a class="bb-news-item" href="${esc(n.url)}" target="_blank" rel="noopener">
        <div class="bb-news-title">${esc(n.title)}</div>
        <div class="bb-news-meta">${esc(n.source || '')}</div>
      </a>
    `).join('');
  }

  async function loadEmisoraSymbol(symbol, tab) {
    const loadId = ++global.FIN_PAGE._loadId;
    global.FIN_PAGE.finTab = tab || global.FIN_PAGE.finTab || 'resumen';
    const sym = (symbol || '').replace('BMV:', '').toUpperCase();
    const symEl = document.getElementById('bbEmisoraSymbol');
    if (symEl) symEl.textContent = sym;
    document.title = `${sym} — Análisis — Finanzas`;
    const tabQ = global.FIN_PAGE.finTab !== 'resumen' ? '?tab=' + global.FIN_PAGE.finTab : '';
    history.replaceState(null, '', `/emisora/${encodeURIComponent(sym)}${tabQ}`);

    const logo = document.getElementById('bbEmisoraLogo');
    if (logo) {
      logo.src = `/api/terminal/logo/${encodeURIComponent(sym)}`;
      logo.style.display = '';
      logo.parentElement?.classList.remove('bb-watch-logo-wrap--fb');
    }

    const period = global.FIN_PAGE.chartPeriod || '6mo';
    updateChartPeriodUI(period);

    try {
      const [chartData, quoteRes, holdingRes] = await Promise.all([
        loadEmisoraChart(sym, period),
        fetch(`/api/terminal/quote?symbol=${encodeURIComponent(sym)}`),
        fetch(`/api/terminal/holding?symbol=${encodeURIComponent(sym)}`),
      ]);
      if (loadId !== global.FIN_PAGE._loadId) return;

      const quote = quoteRes.ok ? await quoteRes.json() : {};
      const holdingData = holdingRes.ok ? await holdingRes.json() : {};

      renderEmisoraChart(chartData);
      updateEmisoraHero(quote);
      renderHoldingWidget(holdingData.holding);
      global.FIN_PAGE.lastQuote = quote;

      fetch(`/api/terminal/news?limit=12&symbol=${encodeURIComponent(sym)}`)
        .then(r => r.json())
        .then(d => {
          if (loadId !== global.FIN_PAGE._loadId) return;
          renderEmisoraNews(d.items || []);
        })
        .catch(() => {});

      const naEl = document.getElementById('bbFinNA');
      if (quote.fundamentals_applicable === false) {
        const hub = document.getElementById('bbFinHub');
        if (hub) hub.hidden = true;
        if (naEl) naEl.hidden = false;
        return;
      }
      if (naEl) naEl.hidden = true;
      if (typeof showFinHubLoading === 'function') showFinHubLoading();

      const finRes = await fetch(`/api/terminal/financials?symbol=${encodeURIComponent(sym)}&section=resumen`);
      if (loadId !== global.FIN_PAGE._loadId) return;
      if (!finRes.ok) {
        const status = document.getElementById('bbFinStatus');
        if (status) status.textContent = 'No se pudieron cargar los datos financieros';
        return;
      }
      const finData = await finRes.json();
      global.FIN_PAGE.lastFinancials = finData;
      global.FIN_PAGE.section_fetched_at = { resumen: finData.fetched_at };
      const activeTab = global.FIN_PAGE.finTab;
      if (activeTab !== 'resumen' && typeof loadFinSection === 'function') {
        try {
          const merged = await loadFinSection(sym, activeTab);
          global.FIN_PAGE.lastFinancials = merged;
        } catch (_) { /* render resumen fallback */ }
      }
      if (typeof renderFinHub === 'function') {
        renderFinHub(quote, global.FIN_PAGE.lastFinancials, global.FIN_PAGE.finTab);
      }
    } catch (_) {
      const status = document.getElementById('bbFinStatus');
      if (status) status.textContent = 'Error al cargar datos';
    }
  }

  function setupChartPeriodSelector() {
    document.querySelectorAll('[data-chart-period]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const period = btn.dataset.chartPeriod;
        if (!period || period === global.FIN_PAGE.chartPeriod) return;
        global.FIN_PAGE.chartPeriod = period;
        updateChartPeriodUI(period);
        const sym = document.getElementById('bbEmisoraSymbol')?.textContent;
        if (!sym) return;
        const status = document.getElementById('bbEmisoraChartStatus');
        if (status) status.textContent = 'Cargando…';
        const data = await loadEmisoraChart(sym, period);
        renderEmisoraChart(data);
      });
    });
  }

  function setupEmisoraSearch() {
    const input = document.getElementById('bbEmisoraSearch');
    const results = document.getElementById('bbEmisoraSearchResults');
    if (!input || !results) return;
    let seq = 0;
    input.addEventListener('input', async () => {
      const q = input.value.trim();
      if (q.length < 2) {
        results.classList.remove('open');
        results.innerHTML = '';
        return;
      }
      const id = ++seq;
      const res = await fetch(`/api/terminal/catalog?q=${encodeURIComponent(q)}&limit=8`);
      if (id !== seq) return;
      const data = await res.json();
      const items = data.items || [];
      if (!items.length) {
        results.innerHTML = '<div class="bb-emisora-search-empty">Sin resultados</div>';
      } else {
        results.innerHTML = items.map(i =>
          `<button type="button" class="bb-emisora-search-item" data-symbol="${esc(i.symbol)}">${esc(i.symbol)} · ${esc(i.name || '')}</button>`
        ).join('');
      }
      results.classList.add('open');
    });
    results.addEventListener('click', e => {
      const btn = e.target.closest('[data-symbol]');
      if (!btn) return;
      input.value = '';
      results.classList.remove('open');
      loadEmisoraSymbol(btn.dataset.symbol);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && input.value.trim()) {
        loadEmisoraSymbol(input.value.trim().toUpperCase());
        results.classList.remove('open');
      }
      if (e.key === 'Escape') results.classList.remove('open');
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('.bb-emisora-search-wrap')) results.classList.remove('open');
    });
  }

  function bootEmisoraPage(config) {
    global.FIN_PAGE.finTab = config?.tab || 'resumen';
    global.FIN_PAGE.chartPeriod = config?.chartPeriod || '6mo';
    setupEmisoraSearch();
    setupChartPeriodSelector();
    loadEmisoraSymbol(config?.symbol || 'GFNORTEO', global.FIN_PAGE.finTab);
    global.addEventListener('resize', () => {
      if (emisoraChart) {
        const el = document.getElementById('bbEmisoraChart');
        if (el) emisoraChart.applyOptions({ width: el.clientWidth, height: el.clientHeight || 220 });
      }
    });
  }

  global.bootEmisoraPage = bootEmisoraPage;
})(window);
