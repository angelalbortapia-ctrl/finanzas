/* Página de análisis por emisora — /emisora/{symbol} */

window.FIN_PAGE = { finTab: 'resumen', finPeriod: 'annual', _loadId: 0 };

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

function destroyEmisoraChart() {
  if (emisoraChart) {
    emisoraChart.remove();
    emisoraChart = null;
    emisoraSeries = null;
  }
}

function renderEmisoraChart(data) {
  const el = document.getElementById('bbEmisoraChart');
  const status = document.getElementById('bbEmisoraChartStatus');
  if (!el || !data?.points?.length) {
    if (status) status.textContent = data?.error || 'Sin datos de precio';
    return;
  }
  if (typeof LightweightCharts === 'undefined') {
    if (status) status.textContent = 'Gráfica no disponible';
    return;
  }
  destroyEmisoraChart();
  el.innerHTML = '';
  if (status) status.textContent = data.stale ? 'Datos limitados (caché)' : '';
  const w = el.clientWidth || 600;
  const h = el.clientHeight || 220;
  emisoraChart = LightweightCharts.createChart(el, {
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
    <a class="bb-news-item" href="${typeof safeHttpUrl === 'function' ? safeHttpUrl(n.url) : n.url}" target="_blank" rel="noopener">
      <div class="bb-news-title">${typeof escHtml === 'function' ? escHtml(n.title) : n.title}</div>
      <div class="bb-news-meta">${typeof escHtml === 'function' ? escHtml(n.source || '') : (n.source || '')}</div>
    </a>
  `).join('');
}

async function loadEmisoraSymbol(symbol, tab) {
  const loadId = ++FIN_PAGE._loadId;
  FIN_PAGE.finTab = tab || FIN_PAGE.finTab || 'resumen';
  const sym = (symbol || '').replace('BMV:', '').toUpperCase();
  document.getElementById('bbEmisoraSymbol')?.textContent = sym;
  document.title = `${sym} — Análisis — Finanzas`;
  history.replaceState(null, '', `/emisora/${encodeURIComponent(sym)}${FIN_PAGE.finTab !== 'resumen' ? '?tab=' + FIN_PAGE.finTab : ''}`);

  const logo = document.getElementById('bbEmisoraLogo');
  if (logo) {
    logo.src = `/api/terminal/logo/${encodeURIComponent(sym)}`;
    logo.style.display = '';
    logo.parentElement?.classList.remove('bb-watch-logo-wrap--fb');
  }

  try {
    const [chartRes, quoteRes] = await Promise.all([
      fetch(`/api/terminal/chart?symbol=${encodeURIComponent(sym)}&period=6mo`),
      fetch(`/api/terminal/quote?symbol=${encodeURIComponent(sym)}`),
    ]);
    if (loadId !== FIN_PAGE._loadId) return;

    const chartData = chartRes.ok ? await chartRes.json() : {};
    const quote = quoteRes.ok ? await quoteRes.json() : {};

    renderEmisoraChart(chartData);
    updateEmisoraHero(quote);
    FIN_PAGE.lastQuote = quote;

    fetch(`/api/terminal/news?limit=12&symbol=${encodeURIComponent(sym)}`)
      .then(r => r.json())
      .then(d => {
        if (loadId !== FIN_PAGE._loadId) return;
        renderEmisoraNews(d.items || []);
      })
      .catch(() => {});

    const naEl = document.getElementById('bbFinNA');
    if (quote.fundamentals_applicable === false) {
      document.getElementById('bbFinHub')?.hidden = true;
      if (naEl) naEl.hidden = false;
      return;
    }
    if (naEl) naEl.hidden = true;
    if (typeof showFinHubLoading === 'function') showFinHubLoading();

    const finRes = await fetch(`/api/terminal/financials?symbol=${encodeURIComponent(sym)}`);
    if (loadId !== FIN_PAGE._loadId) return;
    if (!finRes.ok) return;
    const finData = await finRes.json();
    FIN_PAGE.lastFinancials = finData;
    if (typeof renderFinHub === 'function') {
      renderFinHub(quote, finData, FIN_PAGE.finTab);
    }
  } catch (_) {
    const status = document.getElementById('bbFinStatus');
    if (status) status.textContent = 'Error al cargar datos';
  }
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
        `<button type="button" class="bb-emisora-search-item" data-symbol="${i.symbol}">${i.symbol} · ${i.name || ''}</button>`
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
  FIN_PAGE.finTab = config?.tab || 'resumen';
  setupEmisoraSearch();
  loadEmisoraSymbol(config?.symbol || 'GFNORTEO', FIN_PAGE.finTab);
  window.addEventListener('resize', () => {
    if (emisoraChart) {
      const el = document.getElementById('bbEmisoraChart');
      if (el) emisoraChart.applyOptions({ width: el.clientWidth, height: el.clientHeight || 220 });
    }
  });
}

window.bootEmisoraPage = bootEmisoraPage;
