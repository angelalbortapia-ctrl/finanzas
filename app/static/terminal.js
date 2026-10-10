/* Bloomberg / Infosel terminal */

const BB_PERIOD_ORDER = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'max'];

const BB = {
  workspace: 'market',
  symbol: 'IPC',
  period: '6mo',
  compare: '',
  indicesCatalog: [],
  indicesSymbol: 'IPC',
  fxCatalog: [],
  fxSymbol: 'USDMXN',
  showMA: true,
  showRSI: false,
  showBB: false,
  showDiv: true,
  logScale: false,
  chartType: 'candle',
  chart: null,
  volChart: null,
  rsiChart: null,
  candleSeries: null,
  priceSeries: null,
  volSeries: null,
  ma20Series: null,
  ma50Series: null,
  bbUpperSeries: null,
  bbLowerSeries: null,
  rsiSeries: null,
  compareSeries: null,
  compareSeriesList: [],
  catalog: [],
  prices: {},
  pollMs: 45000,
  loading: false,
  catalogLoaded: false,
  alerts: [],
  watchlistItems: [],
  watchlist: null,
  showWatchPortfolio: false,
  _skipWatchQuoteSchedule: false,
  _loadId: 0,
};

const WATCH_PORTFOLIO_KEY = 'finanzas-watch-portfolio';
let watchQuoteTimer;

function visibleWatchlistSymbols() {
  return [...document.querySelectorAll('#bbWatchlist .bb-watch-row[data-symbol]')]
    .map((r) => r.dataset.symbol)
    .filter(Boolean);
}

function scheduleWatchlistQuotes() {
  if (!isStockWorkspace() || BB._skipWatchQuoteSchedule) return;
  const syms = visibleWatchlistSymbols();
  const needs = syms.length === 0
    || syms.some((s) => {
      const q = BB.prices[s];
      return !q || q.price == null || q.change_pct == null;
    });
  if (!needs) return;
  clearTimeout(watchQuoteTimer);
  watchQuoteTimer = setTimeout(() => refreshLive(), 350);
}

function watchRowQuote(sym, fallback) {
  const q = BB.prices[sym];
  if (q && q.price != null) return q;
  return fallback;
}

function formatWatchChg(sym, item) {
  const q = watchRowQuote(sym, item);
  if (!q || q.price == null) return { text: '—', cls: '' };
  if (q.change_pct == null || Number.isNaN(q.change_pct)) return { text: '—', cls: '' };
  const pct = q.change_pct;
  return { text: bbPct(pct), cls: pct >= 0 ? 'up' : 'down' };
}

function watchPortfolioInSidebar() {
  return !!BB.showWatchPortfolio;
}

function syncWatchPortToggleUI() {
  const btn = document.getElementById('bbWatchPortToggle');
  if (!btn) return;
  btn.hidden = !isStockWorkspace();
}

function setWatchPortfolioInSidebar(on) {
  BB.showWatchPortfolio = !!on;
  try { localStorage.setItem(WATCH_PORTFOLIO_KEY, on ? '1' : '0'); } catch (_) {}
  const btn = document.getElementById('bbWatchPortToggle');
  if (btn) {
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.title = on ? 'Ocultar posiciones del portafolio' : 'Mostrar posiciones del portafolio';
  }
  renderWatchlist();
}

const INDICES_BOARD_ORDER = [
  { id: 'mx', title: 'México' },
  { id: 'us', title: 'EE.UU.' },
  { id: 'eu', title: 'Europa' },
  { id: 'asia', title: 'Asia' },
  { id: 'latam', title: 'LatAm' },
];

const FX_BOARD_ORDER = [
  { id: 'mxn', title: 'Peso MX' },
  { id: 'majors', title: 'Mayores' },
  { id: 'cross', title: 'Cruzados' },
  { id: 'idx', title: 'Índices FX' },
];

const FX_STATIC_CATALOG = [
  { symbol: 'USDMXN', name: 'USD / MXN', board: 'mxn', board_title: 'Peso MX', kind: 'fx' },
  { symbol: 'EURMXN', name: 'EUR / MXN', board: 'mxn', board_title: 'Peso MX', kind: 'fx' },
  { symbol: 'GBPMXN', name: 'GBP / MXN', board: 'mxn', board_title: 'Peso MX', kind: 'fx' },
  { symbol: 'CADMXN', name: 'CAD / MXN', board: 'mxn', board_title: 'Peso MX', kind: 'fx' },
  { symbol: 'JPYMXN', name: 'JPY / MXN', board: 'mxn', board_title: 'Peso MX', kind: 'fx' },
  { symbol: 'EURUSD', name: 'EUR / USD', board: 'majors', board_title: 'Mayores', kind: 'fx' },
  { symbol: 'GBPUSD', name: 'GBP / USD', board: 'majors', board_title: 'Mayores', kind: 'fx' },
  { symbol: 'USDJPY', name: 'USD / JPY', board: 'majors', board_title: 'Mayores', kind: 'fx' },
  { symbol: 'USDCHF', name: 'USD / CHF', board: 'majors', board_title: 'Mayores', kind: 'fx' },
  { symbol: 'AUDUSD', name: 'AUD / USD', board: 'majors', board_title: 'Mayores', kind: 'fx' },
  { symbol: 'USDCAD', name: 'USD / CAD', board: 'majors', board_title: 'Mayores', kind: 'fx' },
  { symbol: 'EURGBP', name: 'EUR / GBP', board: 'cross', board_title: 'Cruzados', kind: 'fx' },
  { symbol: 'EURJPY', name: 'EUR / JPY', board: 'cross', board_title: 'Cruzados', kind: 'fx' },
  { symbol: 'GBPJPY', name: 'GBP / JPY', board: 'cross', board_title: 'Cruzados', kind: 'fx' },
  { symbol: 'DXY', name: 'Índice dólar', board: 'idx', board_title: 'Índices FX', kind: 'fx' },
];

function isQuoteWorkspace() {
  return BB.workspace === 'indices' || BB.workspace === 'fx';
}

function fxCatalogList() {
  const live = (BB.fxCatalog || []).filter(i => i.kind === 'fx');
  return live.length ? live : FX_STATIC_CATALOG;
}

function boardMeta(symbol) {
  const sym = (symbol || '').replace('BMV:', '').toUpperCase();
  return (BB.indicesCatalog || []).find(i => i.symbol === sym)
    || fxCatalogList().find(i => i.symbol === sym);
}

function indexMeta(symbol) {
  return boardMeta(symbol);
}

function formatQuotePrice(value, kind) {
  if (value == null || value === '' || isNaN(value)) return '—';
  const n = Number(value);
  if (kind === 'fx') return n.toFixed(4);
  if (n >= 10000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return bbFmt(n);
}

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function safeHttpUrl(u) {
  try {
    const url = new URL(u, location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '#';
  } catch (_) {
    return '#';
  }
}

function bbStripUrlScheme(u) {
  return String(u || '').replace(/^https?:\/\//i, '');
}

function bbFmt(n, dec = 2) {
  if (n == null || n === '' || isNaN(n)) return '—';
  if (Math.abs(n) >= 10000) return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function bbPct(n) {
  if (n == null || isNaN(n)) return '—';
  return (n >= 0 ? '+' : '') + Number(n).toFixed(2) + '%';
}

function bbFmtLarge(n, currency) {
  if (n == null || n === '' || isNaN(n)) return '—';
  const v = Number(n);
  const abs = Math.abs(v);
  const cur = currency === 'USD' ? 'US$' : '$';
  if (abs >= 1e12) return cur + (v / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9) return cur + (v / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return cur + (v / 1e6).toFixed(2) + 'M';
  if (abs >= 1e4) return cur + (v / 1e3).toFixed(1) + 'K';
  return bbFmt(v);
}

function bbNormSym(s) {
  return (s || '').replace(/^BMV:/i, '').trim().toUpperCase();
}

function clearTradingViewEmbedHosts() {
  document.querySelectorAll('.bb-tv-embed').forEach((host) => {
    host.innerHTML = '';
    delete host.dataset.tvLoaded;
  });
}

function resetWidgetsForSymbol(symbol) {
  BB._widgetsLoadId = (BB._widgetsLoadId || 0) + 1;
  const sym = bbNormSym(symbol);
  const deck = document.getElementById('bbWidgetsDeck');
  const grid = document.getElementById('bbWidgetsGrid');
  const status = document.getElementById('bbWidgetsStatus');
  const title = document.querySelector('.bb-widgets-title');
  clearTradingViewEmbedHosts();
  if (grid) grid.innerHTML = '';
  if (title) {
    title.textContent = sym
      ? `Indicadores — ${sym}`
      : 'Indicadores y datos de mercado';
  }
  if (status) status.textContent = sym ? `Cargando ${sym}…` : '';
  if (deck) {
    deck.dataset.widgetSymbol = sym || '';
    deck.classList.toggle('bb-widgets-loading', !!sym);
  }
  const sub = document.getElementById('bbWidgetsSub');
  if (sub) {
    sub.textContent = sym
      ? `${sym} — mismos datos que la gráfica`
      : 'Sincronizado con la emisora de la gráfica';
  }
}

function bbSyncUrlSymbol(sym) {
  try {
    const n = bbNormSym(sym);
    const url = new URL(location.href);
    if (BB.workspace === 'market' && n && n !== 'IPC') url.searchParams.set('symbol', n);
    else if (BB.workspace === 'market') url.searchParams.delete('symbol');
    if (BB.workspace === 'market' && BB.compare) url.searchParams.set('compare', BB.compare);
    else url.searchParams.delete('compare');
    history.replaceState(null, '', url);
  } catch (_) {}
}

function bbUpdateDataFreshness(text, stale) {
  const el = document.getElementById('bbDataFresh');
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.textContent = text;
  el.hidden = false;
  el.classList.toggle('stale', !!stale);
}

function bbWidgetAnalystBars(counts) {
  if (!counts) return '';
  const rows = [
    ['Compra fuerte', counts.strongBuy, '#2dd4a0'],
    ['Compra', counts.buy, '#34d399'],
    ['Mantener', counts.hold, '#8b95a8'],
    ['Venta', counts.sell, '#f87171'],
    ['Venta fuerte', counts.strongSell, '#ef5350'],
  ];
  const max = Math.max(1, ...rows.map(r => r[1] || 0));
  return `<div class="bb-w-an-bars">${rows.map(([label, n, color]) => {
    const w = ((n || 0) / max) * 100;
    return `<div class="bb-w-an-row"><span>${escHtml(label)}</span>`
      + `<div class="bb-w-an-track"><i style="width:${w}%;background:${color}"></i></div>`
      + `<em>${n || 0}</em></div>`;
  }).join('')}</div>`;
}

function renderWidgets(data, forSymbol, widgetsLoadId) {
  const deck = document.getElementById('bbWidgetsDeck');
  const grid = document.getElementById('bbWidgetsGrid');
  const status = document.getElementById('bbWidgetsStatus');
  const src = document.getElementById('bbWidgetsSource');
  if (!deck || !grid) return;

  const sym = bbNormSym(forSymbol || data?.symbol);
  if (widgetsLoadId != null && widgetsLoadId !== BB._widgetsLoadId) return;
  if (sym && sym !== bbNormSym(BB.symbol)) return;
  if (data?.symbol && bbNormSym(data.symbol) !== sym) return;

  if (!data || data.error) {
    deck.hidden = false;
    deck.classList.remove('bb-widgets-loading');
    grid.innerHTML = '';
    if (status) status.textContent = data?.error || 'No se pudieron cargar los indicadores';
    return;
  }
  if (!data.applicable) {
    deck.hidden = true;
    deck.classList.remove('bb-widgets-loading');
    grid.innerHTML = '';
    if (status) status.textContent = '';
    return;
  }

  deck.hidden = false;
  deck.dataset.widgetSymbol = sym;
  const title = document.querySelector('.bb-widgets-title');
  if (title) title.textContent = `Indicadores — ${sym}`;
  if (status) status.textContent = '';
  deck.classList.remove('bb-widgets-loading');
  if (src) {
    src.textContent = Array.isArray(data.sources) ? data.sources.join(' · ') : (data.source || 'Yahoo · Google · TradingView');
  }
  const warn = (data.warnings || []).filter(Boolean);
  if (status && warn.length) {
    status.textContent = warn.join(' · ');
    status.classList.add('bb-widgets-warn');
  } else if (status) {
    status.classList.remove('bb-widgets-warn');
  }

  const cur = data.currency || 'MXN';
  const stats = data.statistics || [];
  const an = data.analysts;
  const earn = data.earnings || {};
  const earnRows = (earn.quarterly || []).slice(-6).reverse();
  const div = data.dividends || {};
  const divHist = (div.history || []).slice(-8).reverse();
  const qTrends = data.income_trends?.quarterly;

  let html = '';

  if (an) {
    const upside = an.upside_pct != null ? bbPct(an.upside_pct) : '—';
    const upsideCls = (an.upside_pct || 0) >= 0 ? 'up' : 'down';
    html += `<article class="bb-widget-card bb-widget-analysts" data-widget-id="analysts">
      <h3>Analistas <span class="bb-widget-tag">Yahoo</span></h3>
      <div class="bb-w-an-hero">
        <div><span>Consenso</span><strong>${escHtml(an.recommendation || an.recommendation_key || '—')}</strong></div>
        <div><span>Objetivo medio</span><strong>${bbFmt(an.target_mean)}</strong></div>
        <div><span>Potencial</span><strong class="${upsideCls}">${upside}</strong></div>
        <div><span>Rango</span><strong>${bbFmt(an.target_low)} – ${bbFmt(an.target_high)}</strong></div>
      </div>
      ${bbWidgetAnalystBars(an.counts)}
      <p class="bb-widget-foot">${an.count ? `${an.count} analistas` : 'Datos de consenso Yahoo Finance'}</p>
    </article>`;
  }

  if (stats.length) {
    html += `<article class="bb-widget-card bb-widget-stats" data-widget-id="stats">
      <h3>Valoración y ratios</h3>
      <div class="bb-w-stat-grid">${stats.map(s => `
        <div class="bb-w-stat"><span>${escHtml(s.label)}</span><strong>${escHtml(s.value)}</strong></div>
      `).join('')}</div>
    </article>`;
  }

  if (earnRows.length) {
    html += `<article class="bb-widget-card bb-widget-earnings" data-widget-id="earnings">
      <h3>Utilidades por acción</h3>
      ${earn.next_report_date ? `<p class="bb-widget-note">Próximo reporte: ${escHtml(earn.next_report_date)}</p>` : ''}
      <div class="bb-widget-table-scroll"><table class="bb-w-table"><thead><tr>
        <th>Periodo</th><th class="num">Reportado</th><th class="num">Estimado</th><th class="num">Sorpresa</th>
      </tr></thead><tbody>${earnRows.map(r => {
        const surp = r.surprise_pct != null ? bbPct(r.surprise_pct) : '—';
        const surpCls = (r.surprise_pct || 0) >= 0 ? 'up' : 'down';
        return `<tr>
          <td>${escHtml(r.period || r.date || '—')}</td>
          <td class="num">${bbFmtRatio(r.reported_eps, 2)}</td>
          <td class="num">${bbFmtRatio(r.estimate_eps, 2)}</td>
          <td class="num ${surpCls}">${surp}</td>
        </tr>`;
      }).join('')}</tbody></table></div>
    </article>`;
  }

  html += `<article class="bb-widget-card bb-widget-dividends" data-widget-id="dividends">
    <h3>Dividendos</h3>
    <div class="bb-w-div-summary">
      <div><span>Rendimiento</span><strong>${div.yield_pct != null ? `${Number(div.yield_pct).toFixed(2)}%` : '—'}</strong></div>
      <div><span>Tasa anual</span><strong>${div.rate != null ? bbFmt(div.rate) : '—'}</strong></div>
      <div><span>Ex-dividendo</span><strong>${escHtml(div.ex_date || '—')}</strong></div>
    </div>
    ${divHist.length ? `<div class="bb-widget-table-scroll"><table class="bb-w-table bb-w-table--compact"><thead><tr><th>Fecha</th><th class="num">Monto</th></tr></thead><tbody>
      ${divHist.map(d => `<tr><td>${escHtml(d.date)}</td><td class="num">${bbFmtRatio(d.amount, 4)}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="bb-widget-foot">Sin historial de pagos en Yahoo.</p>'}
  </article>`;

  if (qTrends?.revenue?.length) {
    const rev = qTrends.revenue.slice(-4);
    const periods = rev.map(r => r.period);
    const niMap = Object.fromEntries((qTrends.net_income || []).map(x => [x.period, x.value]));
    html += `<article class="bb-widget-card bb-widget-trends" data-widget-id="trends">
      <h3>Ingresos trimestrales</h3>
      <div class="bb-widget-table-scroll"><table class="bb-w-table"><thead><tr><th>Concepto</th>
        ${periods.map(p => `<th class="num">${escHtml(p)}</th>`).join('')}
      </tr></thead><tbody>
        <tr><td>Ingresos</td>${rev.map(r => `<td class="num">${bbFmtLarge(r.value, cur)}</td>`).join('')}</tr>
        <tr><td>Utilidad neta</td>${periods.map(p => {
          const v = niMap[p];
          return `<td class="num">${v != null ? bbFmtLarge(v, cur) : '—'}</td>`;
        }).join('')}</tr>
      </tbody></table></div>
    </article>`;
  }

  const gNews = data.google_news || [];
  if (gNews.length) {
    html += `<article class="bb-widget-card bb-widget-google" data-widget-id="google-news">
      <h3>Noticias <span class="bb-widget-tag bb-widget-tag--google">Google</span></h3>
      <ul class="bb-w-news-list">${gNews.map(n => {
        const title = escHtml((n.title || '').trim());
        const url = safeHttpUrl(n.url);
        const pub = escHtml((n.published_at || '').slice(0, 16).replace('T', ' '));
        const src = escHtml(n.publisher || n.tag || 'Google');
        return `<li><a href="${url}" target="_blank" rel="noopener noreferrer" title="${title}">
          <span class="bb-w-news-meta">${pub ? `${pub} · ` : ''}${src}</span>
          <span class="bb-w-news-title">${title}</span>
        </a></li>`;
      }).join('')}</ul>
    </article>`;
  }

  const health = data.health;
  if (health?.checks?.length) {
    html += `<article class="bb-widget-card bb-widget-health" data-widget-id="health">
      <h3>Salud financiera <span class="bb-widget-tag">Yahoo</span></h3>
      <p class="bb-widget-note">${health.passed}/${health.total} criterios favorables</p>
      <ul class="bb-w-health-list">${health.checks.map(c => `
        <li class="${c.ok ? 'ok' : 'bad'}"><span>${escHtml(c.label)}</span><em>${escHtml(c.value)}</em></li>
      `).join('')}</ul>
    </article>`;
  }

  const prof = data.profile;
  if (prof && (prof.summary || prof.sector)) {
    html += `<article class="bb-widget-card bb-widget-profile" data-widget-id="profile">
      <h3>Perfil <span class="bb-widget-tag">Yahoo</span></h3>
      ${prof.sector ? `<p class="bb-widget-note">${escHtml(prof.sector)}${prof.industry ? ` · ${escHtml(prof.industry)}` : ''}</p>` : ''}
      ${prof.summary ? `<p class="bb-w-profile-text">${escHtml(prof.summary)}</p>` : ''}
      ${prof.website ? `<a class="bb-w-profile-link" href="${safeHttpUrl(prof.website)}" target="_blank" rel="noopener noreferrer">${escHtml(bbStripUrlScheme(prof.website))}</a>` : ''}
    </article>`;
  }

  const margins = data.margins_quarterly || [];
  if (margins.length) {
    html += `<article class="bb-widget-card bb-widget-margins" data-widget-id="margins">
      <h3>Margen neto trimestral <span class="bb-widget-tag">Yahoo</span></h3>
      <div class="bb-w-margin-row">${margins.map(m => `
        <div class="bb-w-margin"><span>${escHtml(m.period)}</span><strong>${m.value != null ? `${Number(m.value).toFixed(1)}%` : '—'}</strong></div>
      `).join('')}</div>
    </article>`;
  }

  const tv = data.tradingview;
  if (tv?.metrics?.length) {
    html += `<article class="bb-widget-card bb-widget-tv-scan" data-widget-id="tv-scan">
      <h3>Técnico <span class="bb-widget-tag bb-widget-tag--tv">TradingView</span></h3>
      <p class="bb-widget-note">${escHtml(tv.tv_symbol || '')}</p>
      <div class="bb-w-stat-grid">${tv.metrics.map(m => `
        <div class="bb-w-stat"><span>${escHtml(m.label)}</span><strong>${escHtml(m.value)}</strong></div>
      `).join('')}</div>
    </article>`;
  }

  if (tv?.tv_symbol && (tv.applicable || tv.embed_ok)) {
    html += `<article class="bb-widget-card bb-widget-tv-tech" data-widget-id="tv-technical">
      <h3>Análisis técnico <span class="bb-widget-tag bb-widget-tag--tv">TradingView</span></h3>
      <div class="bb-tv-embed" id="bbTvTechEmbed" data-tv-symbol="${escHtml(tv.tv_symbol)}"></div>
    </article>`;
    if (tv.embed_ok !== false && !String(tv.tv_symbol).startsWith('BMV:')) {
      html += `<article class="bb-widget-card bb-widget-tv-info" data-widget-id="tv-symbol">
        <h3>Ficha <span class="bb-widget-tag bb-widget-tag--tv">TradingView</span></h3>
        <div class="bb-tv-embed bb-tv-embed--tall" id="bbTvSymbolEmbed" data-tv-symbol="${escHtml(tv.tv_symbol)}"></div>
      </article>`;
    }
  }

  grid.innerHTML = html || '<p class="bb-widget-foot">Sin datos adicionales para esta emisora.</p>';
  if (typeof bbRefreshWidgetsLayout === 'function') bbRefreshWidgetsLayout();
  mountTradingViewEmbeds(tv?.tv_symbol, widgetsLoadId, sym);
}

function mountTradingViewEmbeds(tvSymbol, widgetsLoadId, forSymbol) {
  if (!tvSymbol) return;
  if (widgetsLoadId != null && widgetsLoadId !== BB._widgetsLoadId) return;
  if (forSymbol && bbNormSym(forSymbol) !== bbNormSym(BB.symbol)) return;
  const techHost = document.getElementById('bbTvTechEmbed');
  const symHost = document.getElementById('bbTvSymbolEmbed');
  const load = (host, src, cfg) => {
    if (!host) return;
    host.innerHTML = '';
    host.dataset.tvLoaded = tvSymbol;
    const wrap = document.createElement('div');
    wrap.className = 'tradingview-widget-container';
    wrap.style.height = '100%';
    const inner = document.createElement('div');
    inner.className = 'tradingview-widget-container__widget';
    wrap.appendChild(inner);
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = src;
    script.async = true;
    script.text = JSON.stringify({ ...cfg, symbol: tvSymbol });
    wrap.appendChild(script);
    host.appendChild(wrap);
  };
  load(techHost, 'https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js', {
    interval: '1D',
    width: '100%',
    height: 425,
    isTransparent: true,
    showIntervalTabs: true,
    locale: 'es',
    colorTheme: 'dark',
  });
  load(symHost, 'https://s3.tradingview.com/external-embedding/embed-widget-symbol-info.js', {
    width: '100%',
    height: 520,
    locale: 'es',
    colorTheme: 'dark',
    isTransparent: true,
  });
}

async function loadWidgets(symbol, opts = {}) {
  const reqSym = bbNormSym(symbol || BB.symbol);
  const loadId = opts.loadId != null ? opts.loadId : BB._widgetsLoadId;
  const deck = document.getElementById('bbWidgetsDeck');
  if (!deck || !isStockWorkspace()) {
    if (deck) {
      deck.hidden = true;
      deck.dataset.widgetSymbol = '';
    }
    clearTradingViewEmbedHosts();
    return;
  }
  const status = document.getElementById('bbWidgetsStatus');
  deck.hidden = false;
  if (!opts.skipReset) {
    resetWidgetsForSymbol(reqSym);
  }
  const activeLoadId = BB._widgetsLoadId;
  if (status) status.textContent = `Cargando ${reqSym}…`;
  try {
    const res = await fetch(
      `/api/terminal/widgets?symbol=${encodeURIComponent(reqSym)}&v=${activeLoadId}`,
      { cache: 'no-store' },
    );
    if (activeLoadId !== BB._widgetsLoadId || reqSym !== bbNormSym(BB.symbol)) return;
    const data = await res.json();
    if (activeLoadId !== BB._widgetsLoadId || reqSym !== bbNormSym(BB.symbol)) return;
    if (data.symbol && bbNormSym(data.symbol) !== reqSym) return;
    renderWidgets(data, reqSym, activeLoadId);
  } catch (_) {
    deck.classList.remove('bb-widgets-loading');
    if (activeLoadId === BB._widgetsLoadId && reqSym === bbNormSym(BB.symbol) && status) {
      status.textContent = 'Error al cargar widgets';
    }
  }
}

function bbFmtRatio(n, dec = 2) {
  if (n == null || n === '' || isNaN(n)) return '—';
  return Number(n).toFixed(dec);
}

function parseTime(t, period) {
  if (period === '1d' || period === '5d') {
    const d = new Date(t.replace(' ', 'T'));
    return Math.floor(d.getTime() / 1000);
  }
  return t.slice(0, 10);
}

function dedupeChartPoints(points, period) {
  if (!points?.length) return [];
  const map = new Map();
  points.forEach((p) => map.set(String(parseTime(p.t, period)), p));
  const out = Array.from(map.values());
  out.sort((a, b) => {
    const ta = parseTime(a.t, period);
    const tb = parseTime(b.t, period);
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
  return out;
}

const BB_CHART_FONT = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

function measureChartSize() {
  const stack = document.querySelector('.bb-chart-stack');
  const chartEl = document.getElementById('bbChart');
  const wrap = document.getElementById('bbChartWrap');
  const volEl = document.getElementById('bbVolChart');
  const rsiWrap = document.getElementById('bbRsiWrap');
  const grid = document.getElementById('bbGrid');
  if (!stack || !chartEl) return { w: 600, h: 320, volH: 68 };
  const w = Math.max(200, chartEl.clientWidth || stack.clientWidth || 600);
  let volH = 68;
  if (volEl) {
    const raw = grid ? getComputedStyle(grid).getPropertyValue('--bb-vol-h').trim() : '';
    volH = parseInt(raw, 10) || volEl.offsetHeight || 68;
  }
  volH = Math.max(40, volH);
  const rsiH = rsiWrap && rsiWrap.style.display !== 'none' ? (rsiWrap.offsetHeight || 60) : 0;
  const wrapH = wrap && wrap.clientHeight > 0 ? wrap.clientHeight : 0;
  const stackH = stack.clientHeight || 0;
  const h = Math.max(
    260,
    wrapH > 0 ? wrapH - 2 : (stackH > 80 ? stackH - volH - rsiH - 2 : 360),
  );
  return { w, h, volH };
}

function resizeAllCharts() {
  const { w, h, volH } = measureChartSize();
  if (BB.chart) BB.chart.applyOptions({ width: w, height: h });
  if (BB.volChart) BB.volChart.applyOptions({ width: w, height: volH });
  if (BB.rsiChart) {
    const rsiEl = document.getElementById('bbRsiChart');
    BB.rsiChart.applyOptions({ width: w, height: rsiEl?.clientHeight || 60 });
  }
}

function setupChartResizeObserver() {
  const stack = document.querySelector('.bb-chart-stack');
  const container = document.querySelector('.bb-chart-stack .bb-chart-container');
  if (!stack || BB._chartObs) return;
  BB._chartObs = new ResizeObserver(() => resizeAllCharts());
  BB._chartObs.observe(stack);
  if (container) BB._chartObs.observe(container);
}

function chartOpts(height) {
  const crosshairMode = typeof LightweightCharts !== 'undefined'
    ? LightweightCharts.CrosshairMode.Normal : 0;
  const scaleMode = BB.logScale && typeof LightweightCharts !== 'undefined'
    ? LightweightCharts.PriceScaleMode.Logarithmic : 0;
  const { w, h } = measureChartSize();
  return {
    width: w,
    height: height || h,
    layout: {
      background: { color: '#030406' },
      textColor: '#64748b',
      fontFamily: BB_CHART_FONT,
      fontSize: 11,
    },
    grid: {
      vertLines: { color: 'rgba(28, 36, 51, 0.45)' },
      horzLines: { color: 'rgba(28, 36, 51, 0.65)' },
    },
    crosshair: {
      mode: crosshairMode,
      vertLine: { color: 'rgba(56, 189, 248, 0.45)', width: 1, style: 2, labelBackgroundColor: '#0e7490' },
      horzLine: { color: 'rgba(56, 189, 248, 0.45)', width: 1, style: 2, labelBackgroundColor: '#0e7490' },
    },
    rightPriceScale: {
      borderColor: '#1c2433',
      mode: scaleMode,
      scaleMargins: { top: 0.06, bottom: 0.06 },
    },
    timeScale: {
      borderColor: '#161c28',
      timeVisible: true,
      secondsVisible: BB.period === '1d',
      rightOffset: 6,
      barSpacing: 7,
      minBarSpacing: 2,
    },
    handleScroll: {
      mouseWheel: true,
      pressedMouseMove: true,
      horzTouchDrag: true,
      vertTouchDrag: false,
    },
    handleScale: {
      axisPressedMouseMove: { time: true, price: true },
      axisDoubleClickReset: { time: true, price: true },
      mouseWheel: true,
      pinch: true,
    },
    kineticScroll: { touch: true, mouse: true },
  };
}

function setChartVisibleRange(ts, range) {
  if (!ts || !range) return;
  BB._programmaticRange = true;
  ts.setVisibleLogicalRange(range);
  requestAnimationFrame(() => { BB._programmaticRange = false; });
}

function fitChartTimeScale(ts) {
  if (!ts) return;
  BB._programmaticRange = true;
  ts.fitContent();
  requestAnimationFrame(() => { BB._programmaticRange = false; });
}

function watchHistoryEdge() {
  if (!BB.chart) return;
  BB._chartReadyAt = Date.now();
  let expandTimer = null;
  BB.chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    if (BB._programmaticRange || !range || BB.period === 'max' || BB._autoExpanding) return;
    if (Date.now() - (BB._chartReadyAt || 0) < 1200) return;
    if (range.from > 8) return;
    clearTimeout(expandTimer);
    expandTimer = setTimeout(() => maybeExpandHistory(-1), 250);
  });
}

function syncChartScales() {
  if (!BB.chart || !BB.volChart || BB._syncScales) return;
  let syncing = false;
  BB.chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    if (syncing || !range || !BB.volChart) return;
    syncing = true;
    BB.volChart.timeScale().setVisibleLogicalRange(range);
    syncing = false;
  });
  BB.volChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    if (syncing || !range || !BB.chart) return;
    syncing = true;
    BB.chart.timeScale().setVisibleLogicalRange(range);
    syncing = false;
  });
  BB._syncScales = true;
}

function nextLongerPeriod(current) {
  const i = BB_PERIOD_ORDER.indexOf(current);
  if (i < 0 || i >= BB_PERIOD_ORDER.length - 1) return null;
  return BB_PERIOD_ORDER[i + 1];
}

async function maybeExpandHistory(direction) {
  if (direction >= 0 || BB.period === 'max' || BB._autoExpanding) return false;
  const ts = BB.chart?.timeScale();
  const range = ts?.getVisibleLogicalRange();
  if (!range || range.from > 8) return false;
  const next = nextLongerPeriod(BB.period);
  if (!next) return false;
  const span = Math.max(40, range.to - range.from);
  BB._autoExpanding = true;
  const statusEl = document.getElementById('bbChartStatus');
  if (statusEl) statusEl.textContent = `Cargando más histórico (${next})…`;
  try {
    await loadSymbol(BB.symbol, next);
    const n = BB.lastChartData?.points?.length || span;
    setChartVisibleRange(BB.chart?.timeScale(), { from: 0, to: Math.min(span + 40, n) });
    return true;
  } finally {
    BB._autoExpanding = false;
  }
}

async function panChart(direction) {
  if (direction < 0 && await maybeExpandHistory(direction)) return;
  const ts = BB.chart?.timeScale();
  if (!ts) return;
  const range = ts.getVisibleLogicalRange();
  if (!range) return;
  const span = range.to - range.from;
  const shift = span * 0.3 * direction;
  const n = BB.lastChartData?.points?.length || range.to;
  const from = Math.max(0, range.from + shift);
  const to = Math.min(n, range.to + shift);
  if (to - from < 5) return;
  setChartVisibleRange(ts, { from, to });
}

function zoomChart(factor) {
  const ts = BB.chart?.timeScale();
  if (!ts) return;
  const range = ts.getVisibleLogicalRange();
  if (!range) return;
  const center = (range.from + range.to) / 2;
  const span = Math.max(5, (range.to - range.from) * factor);
  setChartVisibleRange(ts, { from: center - span / 2, to: center + span / 2 });
}

function fitChartView() {
  fitChartTimeScale(BB.chart?.timeScale());
  fitChartTimeScale(BB.volChart?.timeScale());
}

async function goChartStart() {
  if (BB.period !== 'max') await loadSymbol(BB.symbol, 'max');
  const ts = BB.chart?.timeScale();
  if (!ts) return;
  const range = ts.getVisibleLogicalRange();
  const span = range ? (range.to - range.from) : 80;
  setChartVisibleRange(ts, { from: 0, to: span });
}

function goChartEnd() {
  const ts = BB.chart?.timeScale();
  const n = BB.lastChartData?.points?.length;
  if (!ts || !n) return;
  const range = ts.getVisibleLogicalRange();
  const span = range ? (range.to - range.from) : Math.min(80, n);
  setChartVisibleRange(ts, { from: Math.max(0, n - span), to: n });
}

function updateChartRangeLabel(data) {
  const el = document.getElementById('bbChartRange');
  if (!el || !data?.points?.length) return;
  const fmt = (t) => (t || '').slice(0, 10).replace(/-/g, '/');
  const n = data.points.length;
  const label = data.period === 'max' ? 'MAX' : (data.period || '').toUpperCase();
  el.textContent = `${label} · ${fmt(data.points[0].t)} — ${fmt(data.points[n - 1].t)} (${n} velas)`;
}

function volBarColor(point) {
  if (!point) return 'rgba(96,165,250,0.4)';
  return (point.c ?? 0) >= (point.o ?? 0)
    ? 'rgba(52,211,153,0.5)' : 'rgba(248,113,113,0.5)';
}

function applyDividendMarkers(data) {
  const series = BB.candleSeries || BB.priceSeries;
  if (!series?.setMarkers) return;
  if (!BB.showDiv || !data?.dividends?.length) {
    series.setMarkers([]);
    return;
  }
  const markers = data.dividends.map(d => {
    const amt = Number(d.amount);
    const label = amt >= 10 ? `$${amt.toFixed(0)}` : `$${amt.toFixed(2)}`;
    return {
      time: parseTime(d.t, data.period),
      position: 'belowBar',
      color: '#d4a853',
      shape: 'circle',
      text: label,
      size: 1,
    };
  });
  if (data.dividend_next?.ex_date && data.points?.length) {
    const lastT = parseTime(data.points[data.points.length - 1].t, data.period);
    const exT = parseTime(data.dividend_next.ex_date, data.period);
    if (typeof exT === 'string' && typeof lastT === 'string' && exT > lastT) {
      const nxt = data.dividend_next.amount;
      markers.push({
        time: exT,
        position: 'belowBar',
        color: '#a78bfa',
        shape: 'square',
        text: nxt ? `Ex $${Number(nxt).toFixed(2)}` : 'Ex-div',
        size: 1,
      });
    }
  }
  series.setMarkers(markers);
}

function destroyCharts() {
  if (BB.chart) { BB.chart.remove(); BB.chart = null; }
  if (BB.volChart) { BB.volChart.remove(); BB.volChart = null; }
  if (BB.rsiChart) { BB.rsiChart.remove(); BB.rsiChart = null; }
  BB.candleSeries = BB.priceSeries = BB.volSeries = BB.ma20Series = BB.ma50Series = null;
  BB.bbUpperSeries = BB.bbLowerSeries = BB.rsiSeries = BB.compareSeries = null;
  BB.compareSeriesList = [];
  BB._syncScales = false;
}

function fmtOhlc(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function paintOhlc(bar) {
  if (!bar) return;
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = fmtOhlc(v);
  };
  const open = bar.open ?? bar.value;
  const close = bar.close ?? bar.value;
  set('bbO', open);
  set('bbH', bar.high ?? close);
  set('bbL', bar.low ?? close);
  set('bbC', close);
  const chg = document.getElementById('bbOhlcChg');
  if (chg && open) {
    const pct = ((close - open) / open) * 100;
    chg.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
    chg.className = `bb-ohlc-chg ${pct >= 0 ? 'up' : 'down'}`;
  }
}

function bindOhlc(data) {
  const last = data.points[data.points.length - 1];
  const rest = { open: last.o, high: last.h, low: last.l, close: last.c };
  paintOhlc(rest);
  const series = BB.candleSeries || BB.priceSeries;
  if (!BB.chart || !series) return;
  BB.chart.subscribeCrosshairMove((param) => {
    if (!param?.time) {
      paintOhlc(rest);
      return;
    }
    const row = param.seriesData?.get(series);
    if (!row) return;
    if (row.open != null) paintOhlc(row);
    else paintOhlc({ value: row.value, open: row.value, high: row.value, low: row.value, close: row.value });
  });
}

function renderCharts(data) {
  const chartEl = document.getElementById('bbChart');
  const volEl = document.getElementById('bbVolChart');
  const statusEl = document.getElementById('bbChartStatus');
  if (data?.points?.length) {
    const period = data.period || BB.period || '6mo';
    const deduped = dedupeChartPoints(data.points, period);
    if (deduped.length !== data.points.length) {
      data = { ...data, points: deduped };
      if (data.volume?.length) {
        const volMap = new Map(data.volume.map((v) => [String(parseTime(v.t, period)), v]));
        data.volume = deduped.map((p) => volMap.get(String(parseTime(p.t, period))) || { t: p.t, v: 0 });
      }
    }
  }
  if (!chartEl || !data?.points?.length) {
    setChartLoading(false);
    return;
  }
  if (typeof LightweightCharts === 'undefined') {
    chartEl.innerHTML = '<p style="padding:1rem;color:var(--bb-muted)">Gráfica no disponible — recarga la página (Cmd+Shift+R)</p>';
    setChartLoading(false);
    return;
  }

  const sparse = data.stale || data.points.length < 8;
  const chartType = sparse ? 'line' : BB.chartType;

  destroyCharts();
  chartEl.innerHTML = '';
  const { w, h, volH } = measureChartSize();
  if (w < 50 || h < 50) {
    BB._chartSizeTry = (BB._chartSizeTry || 0) + 1;
    if (BB._chartSizeTry < 60) {
      requestAnimationFrame(() => renderCharts(data));
      return;
    }
  }
  BB._chartSizeTry = 0;

  try {
  BB.chart = LightweightCharts.createChart(chartEl, chartOpts(h));
  if (statusEl) statusEl.textContent = '';
  setChartLoading(false);
  const candles = data.points.map(p => ({
    time: parseTime(p.t, data.period),
    open: p.o, high: p.h, low: p.l, close: p.c,
  }));
  const closes = candles.map(c => ({ time: c.time, value: c.close }));

  if (chartType === 'line') {
    BB.priceSeries = BB.chart.addLineSeries({ color: '#60a5fa', lineWidth: 2, title: 'Cierre' });
    BB.priceSeries.setData(closes);
  } else if (chartType === 'area') {
    BB.priceSeries = BB.chart.addAreaSeries({
      lineColor: '#60a5fa', topColor: 'rgba(96,165,250,0.35)', bottomColor: 'rgba(96,165,250,0.02)',
      lineWidth: 2, title: 'Cierre',
    });
    BB.priceSeries.setData(closes);
  } else {
    BB.candleSeries = BB.chart.addCandlestickSeries({
      upColor: '#34d399', downColor: '#fb7185',
      borderUpColor: '#2dd4a0', borderDownColor: '#ef5350',
      wickUpColor: '#2dd4a0', wickDownColor: '#ef5350',
    });
    BB.candleSeries.setData(candles);
  }

  if (BB.showMA && data.indicators) {
    BB.ma20Series = BB.chart.addLineSeries({ color: '#e8b84a', lineWidth: 1, title: 'MA20', priceLineVisible: false, lastValueVisible: true });
    BB.ma50Series = BB.chart.addLineSeries({ color: '#5b9cf5', lineWidth: 1, title: 'MA50', priceLineVisible: false, lastValueVisible: true });
    const ma20 = [], ma50 = [];
    data.points.forEach((p, i) => {
      const t = parseTime(p.t, data.period);
      if (data.indicators.ma20?.[i] != null) ma20.push({ time: t, value: data.indicators.ma20[i] });
      if (data.indicators.ma50?.[i] != null) ma50.push({ time: t, value: data.indicators.ma50[i] });
    });
    BB.ma20Series.setData(ma20);
    BB.ma50Series.setData(ma50);
  }

  if (BB.showBB && data.indicators?.bb_upper) {
    BB.bbUpperSeries = BB.chart.addLineSeries({ color: 'rgba(167,139,250,0.85)', lineWidth: 1, title: 'BB+' });
    BB.bbLowerSeries = BB.chart.addLineSeries({ color: 'rgba(167,139,250,0.85)', lineWidth: 1, title: 'BB-' });
    const upper = [], lower = [];
    data.points.forEach((p, i) => {
      const t = parseTime(p.t, data.period);
      if (data.indicators.bb_upper?.[i] != null) upper.push({ time: t, value: data.indicators.bb_upper[i] });
      if (data.indicators.bb_lower?.[i] != null) lower.push({ time: t, value: data.indicators.bb_lower[i] });
    });
    BB.bbUpperSeries.setData(upper);
    BB.bbLowerSeries.setData(lower);
  }

  const compares = data.compares?.length ? data.compares : (data.compare?.series?.length ? [data.compare] : []);
  if (compares.length) {
    BB.chart.priceScale('compare').applyOptions({ scaleMargins: { top: 0.72, bottom: 0 } });
    BB.compareSeriesList = compares.map(comp => {
      const series = BB.chart.addLineSeries({
        color: comp.color || '#a78bfa',
        lineWidth: 1,
        title: 'vs ' + comp.symbol,
        priceScaleId: 'compare',
        priceLineVisible: false,
      });
      series.setData(
        comp.series.map(p => ({ time: parseTime(p.t, data.period), value: p.cmp_pct }))
      );
      return series;
    });
    BB.compareSeries = BB.compareSeriesList[0] || null;
  }

  fitChartTimeScale(BB.chart.timeScale());
  bindOhlc(data);
  watchHistoryEdge();
  applyDividendMarkers(data);
  updateChartRangeLabel(data);

  if (volEl && data.volume?.length) {
    const pointByTime = {};
    data.points.forEach(p => { pointByTime[parseTime(p.t, data.period)] = p; });
    BB.volChart = LightweightCharts.createChart(volEl, {
      width: w, height: volH,
      layout: { background: { color: '#07090e' }, textColor: '#6d7788', fontFamily: BB_CHART_FONT, fontSize: 10 },
      grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(22,28,40,0.5)' } },
      rightPriceScale: { visible: false },
      timeScale: { visible: true, borderColor: '#161c28', timeVisible: true, secondsVisible: false },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal, vertLine: { color: 'rgba(212,168,83,0.25)', labelVisible: false } },
      handleScroll: false,
      handleScale: false,
    });
    BB.volSeries = BB.volChart.addHistogramSeries({ priceFormat: { type: 'volume' } });
    BB.volSeries.setData(data.volume.map(v => {
      const t = parseTime(v.t, data.period);
      return { time: t, value: v.v, color: volBarColor(pointByTime[t]) };
    }));
    fitChartTimeScale(BB.volChart.timeScale());
    syncChartScales();
  }

  const rsiWrap = document.getElementById('bbRsiWrap');
  if (BB.showRSI && data.indicators?.rsi14 && rsiWrap) {
    rsiWrap.style.display = '';
    const rsiEl = document.getElementById('bbRsiChart');
    BB.rsiChart = LightweightCharts.createChart(rsiEl, {
      width: w, height: 60,
      layout: { background: { color: '#0a0d12' }, textColor: '#8b95a8', fontSize: 13 },
      grid: { vertLines: { visible: false }, horzLines: { color: '#1a2130' } },
      rightPriceScale: { borderVisible: false },
      timeScale: { visible: false },
    });
    BB.rsiSeries = BB.rsiChart.addLineSeries({ color: '#f472b6', lineWidth: 1 });
    const rsi = [];
    data.points.forEach((p, i) => {
      if (data.indicators.rsi14[i] != null)
        rsi.push({ time: parseTime(p.t, data.period), value: data.indicators.rsi14[i] });
    });
    BB.rsiSeries.setData(rsi);
  } else if (rsiWrap) {
    rsiWrap.style.display = 'none';
  }

  window.removeEventListener('resize', BB._resizeHandler);
  BB._resizeHandler = () => resizeAllCharts();
  window.addEventListener('resize', BB._resizeHandler);
  requestAnimationFrame(() => {
    resizeAllCharts();
    requestAnimationFrame(resizeAllCharts);
  });
  } catch (err) {
    console.error('renderCharts', err);
    chartEl.innerHTML = '';
    if (statusEl) {
      statusEl.textContent = 'Error al dibujar la gráfica — recarga con Cmd+Shift+R';
    }
    setChartLoading(false);
  }
}

function updateSymbolHeader(quote, chartData) {
  const name = document.getElementById('bbSymName');
  const desc = document.getElementById('bbSymDesc');
  const price = document.getElementById('bbSymPrice');
  const chg = document.getElementById('bbSymChg');
  if (!name) return;

  const sym = quote?.symbol || chartData?.symbol || BB.symbol;
  const meta = indexMeta(sym);
  const kind = meta?.kind || quote?.kind;
  const logo = document.getElementById('bbSymLogo');
  if (logo) {
    const symAtSet = (sym || '').replace('BMV:', '').toUpperCase();
    logo.src = logoSrc(sym);
    logo.alt = sym;
    logo.style.display = '';
    logo.parentElement?.classList.remove('bb-watch-logo-wrap--fb');
    logo.onerror = () => {
      const current = (BB.symbol || '').replace('BMV:', '').toUpperCase();
      if (symAtSet !== current) return;
      logo.style.display = 'none';
      logo.parentElement?.classList.add('bb-watch-logo-wrap--fb');
    };
  }
  name.textContent = sym;
  const company = quote?.name || chartData?.name || meta?.name || '';
  if (desc) desc.textContent = company;
  const chartDesc = document.getElementById('bbChartSymDesc');
  if (chartDesc) chartDesc.textContent = company;
  const p = quote?.price ?? chartData?.last;
  const pct = quote?.change_pct ?? chartData?.change_pct ?? 0;
  price.textContent = formatQuotePrice(p, kind);
  chg.textContent = bbPct(pct);
  chg.className = 'bb-symbol-chg ' + (pct >= 0 ? 'up' : 'down');

  const dName = document.getElementById('bbDetailName');
  const dPrice = document.getElementById('bbDetailPrice');
  const dChg = document.getElementById('bbDetailChg');
  const dMeta = document.getElementById('bbDetailMeta');
  if (dName) dName.textContent = company || sym;
  if (dMeta) {
    const parts = [sym];
    if (quote?.board_title) parts.push(quote.board_title);
    if (quote?.fundamentals?.sector) parts.push(quote.fundamentals.sector);
    dMeta.textContent = parts.join(' · ');
  }
  if (dPrice) dPrice.textContent = formatQuotePrice(p, kind);
  if (dChg) {
    dChg.textContent = bbPct(pct);
    dChg.className = 'bb-detail-chg ' + (pct >= 0 ? 'up' : 'down');
  }
  paintDayRange(quote);

  if (quote && !quote.error) {
    const set = (id, v, fmt = bbFmt) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v != null ? (typeof fmt === 'function' ? fmt(v) : v) : '—';
    };
    set('stOpen', quote.open);
    set('stHigh', quote.high);
    set('stLow', quote.low);
    set('stVol', quote.volume, v => v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(0)+'K' : String(Math.round(v)));
    if (quote.week52_low != null && quote.week52_high != null)
      set('st52', quote.week52_low, () => bbFmt(quote.week52_low) + ' – ' + bbFmt(quote.week52_high));
    if (quote.dividend_yield != null)
      set('stDivYield', quote.dividend_yield, v => Number(v).toFixed(2) + '%');
    else set('stDivYield', null);
    updateAnalysisLink(sym, quote);
  } else {
    updateAnalysisLink(sym, null);
  }
}

function updateAnalysisLink(symbol, quote) {
  const sym = (symbol || '').replace('BMV:', '').toUpperCase();
  const url = `/emisora/${encodeURIComponent(sym)}`;
  const cta = document.getElementById('bbAnalysisCta');
  const link = document.getElementById('bbAnalysisLink');
  const linkTop = document.getElementById('bbAnalysisLinkTop');
  const heroLink = document.getElementById('bbHeroAnalyze');
  const naEl = document.getElementById('bbFinNA');
  const applicable = quote && !quote.error && quote.fundamentals_applicable !== false;

  if (link) link.href = url;
  if (heroLink) {
    heroLink.href = url;
    heroLink.hidden = !applicable;
  }
  if (linkTop) {
    linkTop.href = url;
    linkTop.hidden = !applicable;
  }
  if (cta) cta.hidden = !applicable;
  if (naEl) naEl.hidden = applicable || !quote || quote.error;
}

function isIndexSymbol(symbol) {
  const sym = (symbol || '').replace('BMV:', '').toUpperCase();
  return (BB.indicesCatalog || []).some(i => i.symbol === sym);
}

function isFxSymbol(symbol) {
  const sym = (symbol || '').replace('BMV:', '').toUpperCase();
  return fxCatalogList().some(i => i.symbol === sym);
}

function clearTicker() {
  const track = document.getElementById('bbTickerTrack');
  if (track) track.innerHTML = '';
}

/** Carga emisora en gráfica + widgets (fuerza vista Mercado si aplica). */
function bbPickSymbol(symbol, period) {
  const sym = bbNormSym(symbol);
  if (!sym) return;
  const ws = BB.workspace;
  if ((ws === 'portfolio' || ws === 'market') && !isIndexSymbol(sym) && !isFxSymbol(sym)) {
    if (ws !== 'market') switchWorkspace('market');
  }
  loadSymbol(sym, period);
}
window.bbPickSymbol = bbPickSymbol;

async function loadSymbol(symbol, period) {
  const loadId = ++BB._loadId;
  const ws = BB.workspace;
  const prevSym = BB.symbol;

  if (ws === 'indices') {
    await loadIndicesBoard();
    if (loadId !== BB._loadId || BB.workspace !== ws) return;
    const sym = (symbol || BB.symbol || 'IPC').replace('BMV:', '').toUpperCase();
    symbol = isIndexSymbol(sym) ? sym : (BB.indicesSymbol || 'IPC');
  } else if (ws === 'fx') {
    await loadFxBoard();
    if (loadId !== BB._loadId || BB.workspace !== ws) return;
    const sym = (symbol || BB.symbol || 'USDMXN').replace('BMV:', '').toUpperCase();
    symbol = isFxSymbol(sym) ? sym : (BB.fxSymbol || 'USDMXN');
  }

  BB.symbol = symbol || BB.symbol;
  BB.period = period || BB.period;
  const reqSymEarly = bbNormSym(BB.symbol);
  if (ws === 'market') {
    bbSyncUrlSymbol(BB.symbol);
    resetWidgetsForSymbol(reqSymEarly);
    loadWidgets(reqSymEarly, { loadId: BB._widgetsLoadId, skipReset: true });
  } else {
    resetWidgetsForSymbol(null);
    const wDeck = document.getElementById('bbWidgetsDeck');
    if (wDeck) wDeck.hidden = true;
    clearTradingViewEmbedHosts();
  }
  if (ws === 'indices') {
    BB.indicesSymbol = BB.symbol;
    BB.showDiv = false;
  } else if (ws === 'fx') {
    BB.fxSymbol = BB.symbol;
    BB.showDiv = false;
    if (BB.chartType === 'candle') setChartType('line');
  }

  const reqSym = BB.symbol;
  const reqPeriod = BB.period;
  const cmp = BB.compare ? `&compare=${encodeURIComponent(BB.compare)}` : '';
  const statusEl = document.getElementById('bbChartStatus');
  setChartLoading(true);
  if (statusEl) statusEl.textContent = 'Cargando gráfica…';
  if (prevSym !== BB.symbol) {
    document.getElementById('bbSymbolBlock')?.classList.add('bb-enter');
    setTimeout(() => document.getElementById('bbSymbolBlock')?.classList.remove('bb-enter'), 400);
  }

  try {
    const chartRes = await fetch(`/api/terminal/chart?symbol=${encodeURIComponent(reqSym)}&period=${reqPeriod}${cmp}`);
    if (loadId !== BB._loadId || reqSym !== BB.symbol) return;
    if (!chartRes.ok) {
      const msg = chartRes.status === 401
        ? 'Sesión expirada — recarga e inicia sesión'
        : `Error ${chartRes.status} al cargar gráfica`;
      if (statusEl) statusEl.textContent = msg;
      setChartLoading(false);
      return;
    }
    const chartData = await chartRes.json();
    if (chartData.error) {
      if (statusEl) {
        statusEl.textContent = chartData.detail
          ? `${chartData.error} (${chartData.detail})`
          : chartData.error;
      }
      setChartLoading(false);
    } else {
      if (chartData.stale && statusEl) {
        statusEl.textContent = 'Datos limitados (Yahoo no respondió — mostrando caché local)';
      } else if (chartData.period_fallback && statusEl) {
        statusEl.textContent = `Mostrando ${chartData.period} (solicitado: ${chartData.period_requested})`;
      } else if (statusEl) {
        statusEl.textContent = '';
      }
      BB.lastChartData = chartData;
      if (chartData.period) BB.period = chartData.period;
      renderCharts(chartData);
      if (chartData.stale) {
        bbUpdateDataFreshness('Gráfica · datos en caché', true);
      } else if (chartData.source) {
        bbUpdateDataFreshness(`Gráfica · ${chartData.source}`, false);
      } else {
        bbUpdateDataFreshness('Gráfica · Yahoo', false);
      }
    }

    const quoteRes = await fetch(`/api/terminal/quote?symbol=${encodeURIComponent(reqSym)}`);
    if (loadId !== BB._loadId || reqSym !== BB.symbol) return;
    if (!quoteRes.ok) return;
    const quote = await quoteRes.json();
    updateSymbolHeader(quote, chartData);

    fetch(`/api/terminal/news?limit=10&symbol=${encodeURIComponent(reqSym)}`)
      .then(r => r.json())
      .then(news => {
        if (loadId !== BB._loadId || reqSym !== BB.symbol) return;
        renderNews(news.items || [], reqSym);
        const newsTag = document.getElementById('bbNewsTag');
        if (newsTag) newsTag.textContent = reqSym;
        scheduleNewsTickerRefresh();
      })
      .catch(() => {});

    document.querySelectorAll('.bb-watch-row').forEach(r => {
      r.classList.toggle('active', r.dataset.symbol === BB.symbol);
    });
    document.querySelectorAll('.bb-period').forEach(b => {
      b.classList.toggle('active', b.dataset.period === BB.period);
    });
    const chartSearch = document.getElementById('bbChartSearch');
    if (chartSearch && document.activeElement !== chartSearch) chartSearch.value = '';
    updateWatchFollowBtn();
    if (BB.workspace === 'market') {
      const symNow = bbNormSym(BB.symbol);
      const deck = document.getElementById('bbWidgetsDeck');
      if (symNow && deck && bbNormSym(deck.dataset.widgetSymbol) !== symNow) {
        loadWidgets(symNow, { skipReset: true });
      }
    }
  } catch (err) {
    if (loadId === BB._loadId && statusEl) statusEl.textContent = 'Error al cargar gráfica';
  } finally {
    if (loadId === BB._loadId) setChartLoading(false);
  }
}

function renderNews(items, forSymbol) {
  const el = document.getElementById('bbNews');
  if (!el) return;
  if (forSymbol && bbNormSym(forSymbol) !== bbNormSym(BB.symbol)) return;
  el.innerHTML = (items || []).map(n => `
    <a href="${safeHttpUrl(n.url)}" class="bb-news-item bb-enter" target="_blank" rel="noopener noreferrer">
      <div class="bb-news-meta">${escHtml((n.published_at || '').slice(0, 16).replace('T', ' '))} · ${escHtml(n.publisher)}</div>
      <div class="bb-news-title">${escHtml(n.title)}</div>
    </a>`).join('') || '<p style="padding:.5rem;color:var(--bb-muted)">Sin noticias</p>';
  staggerChildren(el, '.bb-news-item', 'bb-enter');
}

function logoSrc(symbol) {
  const sym = (symbol || '').replace('BMV:', '').toUpperCase();
  return `/api/terminal/logo/${encodeURIComponent(sym)}`;
}

function logoHtml(symbol, extraCls = '') {
  const sym = (symbol || '').replace('BMV:', '').toUpperCase();
  const init = escHtml(sym.slice(0, 2));
  const src = escHtml(logoSrc(sym));
  const cls = extraCls ? ` ${extraCls}` : '';
  return `<span class="bb-watch-logo-wrap${cls}" data-symbol="${escHtml(sym)}">
    <img class="bb-watch-logo" src="${src}" alt="" loading="lazy"
      onerror="this.style.display='none';this.parentElement.classList.add('bb-watch-logo-wrap--fb');">
    <span class="bb-watch-logo-fb" aria-hidden="true">${init}</span>
  </span>`;
}

function isStockWorkspace() {
  return BB.workspace === 'market' || BB.workspace === 'portfolio';
}

function updateWatchFollowBtn() {
  const btn = document.getElementById('bbWatchFollowBtn');
  if (!btn) return;
  const sym = (BB.symbol || '').replace('BMV:', '').toUpperCase();
  const can = isStockWorkspace() && sym && sym !== 'IPC';
  const on = can && BB.watchlist?.has(sym);
  btn.textContent = on ? '★' : '☆';
  btn.classList.toggle('active', !!on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.disabled = !can;
  btn.title = on ? 'Quitar de seguimiento (W)' : 'Agregar a seguimiento (W)';
}

async function addToWatchlist(symbol, name) {
  const sym = (symbol || '').replace('BMV:', '').trim().toUpperCase();
  if (!sym) return;
  try {
    const res = await fetch('/api/terminal/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: sym, name: name || undefined }),
    });
    if (!res.ok) return;
    const item = await res.json();
    const idx = BB.watchlistItems.findIndex(i => i.symbol === item.symbol);
    if (idx >= 0) BB.watchlistItems[idx] = item;
    else BB.watchlistItems.push(item);
    BB.watchlist.add(item.symbol);
    updateWatchFollowBtn();
    renderWatchlist();
    refreshLive();
    scheduleNewsTickerRefresh();
  } catch (_) {}
}

async function removeFromWatchlist(symbol) {
  const sym = (symbol || '').replace('BMV:', '').trim().toUpperCase();
  if (!sym) return;
  try {
    const res = await fetch(`/api/terminal/watchlist/${encodeURIComponent(sym)}`, { method: 'DELETE' });
    if (!res.ok) return;
    BB.watchlistItems = BB.watchlistItems.filter(i => i.symbol !== sym);
    BB.watchlist.delete(sym);
    updateWatchFollowBtn();
    renderWatchlist();
    refreshLive();
    scheduleNewsTickerRefresh();
  } catch (_) {}
}

async function toggleWatchlistCurrent() {
  const sym = (BB.symbol || '').replace('BMV:', '').toUpperCase();
  if (!sym || sym === 'IPC' || !isStockWorkspace()) return;
  if (BB.watchlist?.has(sym)) await removeFromWatchlist(sym);
  else await addToWatchlist(sym);
}

function activeWatchBoard() {
  const tabsId = BB.workspace === 'indices'
    ? 'bbWatchTabsIndices'
    : BB.workspace === 'fx'
      ? 'bbWatchTabsFx'
      : 'bbWatchTabsMarket';
  const tabs = document.getElementById(tabsId);
  return tabs?.querySelector('.bb-watch-tab.active')?.dataset.board || 'all';
}

function renderWatchlist(items) {
  const el = document.getElementById('bbWatchlist');
  if (!el) return;
  const isIndices = BB.workspace === 'indices';
  const isFx = BB.workspace === 'fx';
  const board = activeWatchBoard();
  const q = (document.getElementById('bbWatchSearch')?.value || '').toUpperCase();

  // Nunca mezclar emisoras en vistas de índices o divisas.
  if (isFx) items = null;
  else if (isIndices) items = null;

  const searching = q.length >= 2;
  let list = isIndices ? (BB.indicesCatalog || []).filter(i => i.kind === 'index')
    : isFx ? fxCatalogList()
      : (items || BB.catalog);
  if (!searching && isStockWorkspace() && items == null) {
    list = board === 'all' ? [] : list.filter(i => i.board === board).slice(0, 24);
  } else if (!searching && board !== 'all') {
    list = list.filter(i => i.board === board);
  }
  if (q) list = list.filter(i => i.symbol.includes(q) || (i.name || '').toUpperCase().includes(q));
  list = list.slice(0, 80);

  const allHoldings = (isIndices || isFx) ? [] : (window.BB_INIT?.holdings || []);
  const showPort = watchPortfolioInSidebar() && isStockWorkspace();
  const holdings = !showPort ? [] : (q
    ? allHoldings.filter(h => {
      const sym = (h.ticker || '').replace('BMV:', '').toUpperCase();
      return sym.includes(q) || (h.name || '').toUpperCase().includes(q);
    })
    : allHoldings);
  const holdingSyms = new Set(
    (showPort ? holdings : allHoldings).map(h => (h.ticker || '').replace('BMV:', '').toUpperCase()),
  );
  list = list.filter(i => !holdingSyms.has(i.symbol));

  let followList = isStockWorkspace() ? [...(BB.watchlistItems || [])] : [];
  if (!searching && board !== 'all') {
    followList = followList.filter(i => !i.board || i.board === board);
  }
  if (q) {
    followList = followList.filter(i => i.symbol.includes(q) || (i.name || '').toUpperCase().includes(q));
  }
  const followSyms = new Set(followList.map(i => i.symbol));
  list = list.filter(i => !followSyms.has(i.symbol));

  let html = '';
  if (followList.length) {
    html += `<div class="bb-watch-divider bb-watch-divider--follow">Seguimiento · ${followList.length}</div>`;
  }
  const renderFollowRow = (i) => {
    const pr = watchRowQuote(i.symbol, i);
    const chg = formatWatchChg(i.symbol, i);
    const price = pr?.price != null ? formatQuotePrice(pr.price, i.kind || pr.kind) : '';
    return `<div class="bb-watch-row-wrap">
      <button type="button" class="bb-watch-row ${i.symbol === BB.symbol ? 'active' : ''}" data-symbol="${escHtml(i.symbol)}" data-board="${escHtml(i.board || '')}">
        ${logoHtml(i.symbol)}
        <span class="bb-watch-sym">${escHtml(i.symbol)}</span>
        <span class="bb-watch-name">${escHtml((i.name || '').slice(0, 16))}</span>
        <span class="bb-watch-right"><span class="bb-watch-price">${price || '—'}</span><span class="bb-watch-chg ${chg.cls}">${chg.text}</span></span>
      </button>
      <button type="button" class="bb-watch-action bb-watch-action--rm" data-watch-rm="${escHtml(i.symbol)}" title="Quitar de seguimiento">×</button>
    </div>`;
  };
  followList.forEach(i => { html += renderFollowRow(i); });

  if (holdings.length) {
    html += `<div class="bb-watch-divider bb-watch-divider--port">${searching ? 'En tu portafolio' : 'Portafolio'}</div>`;
    holdings.forEach(h => {
      const sym = (h.ticker || '').replace('BMV:', '');
      const pnl = h.pnl || 0;
      html += `<button type="button" class="bb-watch-row ${sym === BB.symbol ? 'active' : ''}" data-symbol="${escHtml(sym)}">
        ${logoHtml(sym)}
        <span class="bb-watch-sym">${escHtml(sym)}</span>
        <span class="bb-watch-name">${escHtml((h.name || '').slice(0, 14))}</span>
        <span class="bb-watch-right"><span class="bb-watch-chg ${pnl >= 0 ? 'up' : 'down'}">${bbFmt(pnl)}</span></span>
      </button>`;
    });
  }
  if (list.length) {
    html += `<div class="bb-watch-divider">${searching ? 'Resultados' : 'Mercado'}</div>`;
  } else if (searching && !holdings.length) {
    html += '<p class="bb-watch-empty">Sin coincidencias — prueba el ticker o nombre en inglés</p>';
  } else if (searching) {
    html += '<p class="bb-watch-empty">Nada más en catálogo para esta búsqueda</p>';
  } else if (isStockWorkspace() && board === 'all' && !followList.length && !holdings.length) {
    html += '<p class="bb-watch-empty">Escribe para buscar · <strong>/</strong> paleta · <strong>W</strong> seguir emisora en gráfica</p>';
  }

  const renderRow = (i) => {
    const pr = watchRowQuote(i.symbol, i);
    const chg = formatWatchChg(i.symbol, i);
    const price = pr?.price != null ? formatQuotePrice(pr.price, i.kind || pr.kind) : '';
    const rowCls = isIndices ? 'bb-watch-row--index' : (isFx ? 'bb-watch-row--fx' : '');
    const badge = (isIndices || isFx) && i.board
      ? `<span class="bb-watch-badge bb-watch-badge--${i.board}">${(i.board_title || i.board).slice(0, 4)}</span>` : '';
    const canFollow = isStockWorkspace() && !BB.watchlist?.has(i.symbol);
    const addBtn = canFollow
      ? `<button type="button" class="bb-watch-action bb-watch-action--add" data-watch-add="${escHtml(i.symbol)}" data-watch-name="${escHtml(i.name || '')}" title="Agregar a seguimiento">☆</button>`
      : '';
    if (addBtn) {
      return `<div class="bb-watch-row-wrap">
        <button type="button" class="bb-watch-row ${rowCls} ${i.symbol === BB.symbol ? 'active' : ''}" data-symbol="${escHtml(i.symbol)}" data-board="${escHtml(i.board)}">
          ${logoHtml(i.symbol)}
          <span class="bb-watch-sym">${badge}${escHtml(i.symbol)}</span>
          <span class="bb-watch-name">${escHtml((i.name || '').slice(0, 16))}</span>
          <span class="bb-watch-right"><span class="bb-watch-price">${price || '—'}</span><span class="bb-watch-chg ${chg.cls}">${chg.text}</span></span>
        </button>
        ${addBtn}
      </div>`;
    }
    return `<button type="button" class="bb-watch-row ${rowCls} ${i.symbol === BB.symbol ? 'active' : ''}" data-symbol="${escHtml(i.symbol)}" data-board="${escHtml(i.board)}">
      ${logoHtml(i.symbol)}
      <span class="bb-watch-sym">${badge}${escHtml(i.symbol)}</span>
      <span class="bb-watch-name">${escHtml((i.name || '').slice(0, 16))}</span>
      <span class="bb-watch-right"><span class="bb-watch-price">${price || '—'}</span><span class="bb-watch-chg ${chg.cls}">${chg.text}</span></span>
    </button>`;
  };

  if (isIndices && board === 'all') {
    INDICES_BOARD_ORDER.forEach(sec => {
      const rows = list.filter(i => i.board === sec.id);
      if (!rows.length) return;
      html += `<div class="bb-watch-divider">${sec.title}</div>`;
      rows.forEach(i => { html += renderRow(i); });
    });
  } else if (isFx && board === 'all') {
    FX_BOARD_ORDER.forEach(sec => {
      const rows = list.filter(i => i.board === sec.id);
      if (!rows.length) return;
      html += `<div class="bb-watch-divider">${sec.title}</div>`;
      rows.forEach(i => { html += renderRow(i); });
    });
  } else {
    list.forEach(i => { html += renderRow(i); });
  }
  el.innerHTML = html;
  el.querySelectorAll('.bb-watch-row').forEach(row => {
    row.classList.add('bb-enter');
    row.addEventListener('click', () => bbPickSymbol(row.dataset.symbol));
    row.addEventListener('dblclick', () => {
      const sym = row.dataset.symbol;
      if (sym) window.location.href = `/emisora/${encodeURIComponent(sym)}`;
    });
  });
  el.querySelectorAll('[data-watch-add]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      addToWatchlist(btn.dataset.watchAdd, btn.dataset.watchName);
    });
  });
  el.querySelectorAll('[data-watch-rm]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromWatchlist(btn.dataset.watchRm);
    });
  });
  staggerChildren(el, '.bb-watch-row', 'bb-enter');
  if (isStockWorkspace() && !searching) {
    const meta = document.getElementById('bbWatchMeta');
    if (meta) {
      const n = BB.watchlistItems?.length || 0;
      const cat = window.BB_INIT?.catalogCount || BB.catalog.length || 0;
      meta.textContent = n ? `${n} en seguimiento · ${cat} emisoras` : `${cat} emisoras`;
    }
  }
  scheduleWatchlistQuotes();
}

async function searchCatalog(q, limit = 15) {
  try {
    const qq = (q || '').trim();
    if (qq.length < 2) return [];
    const res = await fetch(
      `/api/terminal/catalog?q=${encodeURIComponent(qq)}&limit=${limit}&remote=1`,
    );
    const data = await res.json();
    return data.items || [];
  } catch (_) { return []; }
}

function bbSymbolSearchPick(input, results, symbol, opts = {}) {
  if (!symbol) return;
  bbPickSymbol(symbol);
  results.classList.remove('open');
  input.setAttribute('aria-expanded', 'false');
  if (opts.clearOnSelect) input.value = '';
  else input.value = symbol;
  input.blur();
}

function setupSymbolSearch(input, results, opts = {}) {
  if (!input || !results) return;
  const wrap = input.closest('.bb-cmd-wrap');

  let timer;
  let cmdSeq = 0;

  const setOpen = (open) => {
    results.classList.toggle('open', open);
    input.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  const moveActive = (dir) => {
    const items = [...results.querySelectorAll('.bb-cmd-item')];
    if (!items.length) return;
    let idx = items.findIndex(el => el.classList.contains('active'));
    idx = dir > 0 ? Math.min(items.length - 1, idx + 1) : Math.max(0, idx - 1);
    items.forEach((el, i) => el.classList.toggle('active', i === idx));
    items[idx]?.scrollIntoView({ block: 'nearest' });
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { setOpen(false); return; }
    timer = setTimeout(async () => {
      const seq = ++cmdSeq;
      let items;
      if (BB.workspace === 'indices') {
        await loadIndicesBoard();
        const qq = q.toUpperCase();
        items = (BB.indicesCatalog || []).filter(i =>
          i.symbol.includes(qq) || (i.name || '').toUpperCase().includes(qq)
        ).slice(0, 15);
      } else if (BB.workspace === 'fx') {
        await loadFxBoard();
        const qq = q.toUpperCase();
        items = fxCatalogList().filter(i =>
          i.symbol.includes(qq) || (i.name || '').toUpperCase().includes(qq)
        ).slice(0, 15);
      } else {
        items = await searchCatalog(q, opts.limit || 15);
      }
      if (seq !== cmdSeq) return;
      results.innerHTML = items.map((i, idx) => `
        <button type="button" class="bb-cmd-item ${idx === 0 ? 'active' : ''}" role="option"
          data-symbol="${escHtml(i.symbol)}">
          <span class="bb-cmd-sym">${escHtml(i.symbol)}</span>
          <span>${escHtml((i.name || '').slice(0, 40))}</span>
          <span class="bb-cmd-board">${escHtml(i.board_title || '')}</span>
        </button>`).join('');
      setOpen(items.length > 0);
      results.querySelectorAll('.bb-cmd-item').forEach(btn => {
        btn.addEventListener('click', () => {
          bbSymbolSearchPick(input, results, btn.dataset.symbol, opts);
        });
      });
    }, 200);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!results.classList.contains('open')) input.dispatchEvent(new Event('input'));
      else moveActive(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveActive(-1);
      return;
    }
    if (e.key === 'Enter') {
      const active = results.querySelector('.bb-cmd-item.active');
      if (active?.dataset.symbol) {
        e.preventDefault();
        bbSymbolSearchPick(input, results, active.dataset.symbol, opts);
        return;
      }
      const sym = input.value.trim().toUpperCase().replace('BMV:', '');
      if (sym) bbSymbolSearchPick(input, results, sym, opts);
    }
    if (e.key === 'Escape') {
      setOpen(false);
      input.blur();
    }
  });

  document.addEventListener('click', (e) => {
    if (!wrap?.contains(e.target)) setOpen(false);
  });
}

function bbFocusSymbolSearch() {
  const el = document.getElementById('bbChartSearch');
  if (!el) return;
  el.focus();
  el.select?.();
}
window.bbFocusSymbolSearch = bbFocusSymbolSearch;

function setupCommandBar() {
  setupSymbolSearch(
    document.getElementById('bbChartSearch'),
    document.getElementById('bbChartSearchResults'),
    { clearOnSelect: true, limit: 20 },
  );
}

async function loadIndicesBoard(force = false) {
  if (!force && BB.indicesCatalog.length) return BB.indicesCatalog;
  try {
    const res = await fetch('/api/terminal/indices');
    if (!res.ok) return BB.indicesCatalog;
    const data = await res.json();
    BB.indicesCatalog = data.items || [];
    BB.indicesCatalog.forEach(i => { BB.prices[i.symbol] = i; });
    const meta = document.getElementById('bbWatchMeta');
    if (meta && BB.workspace === 'indices') meta.textContent = `${BB.indicesCatalog.length} índices`;
    renderIndicesStrip();
    return BB.indicesCatalog;
  } catch (_) {
    return [];
  }
}

async function loadFxBoard(force = false) {
  BB.fxCatalog = (BB.fxCatalog || []).filter(i => i.kind === 'fx');
  if (!force && BB.fxCatalog.length) return BB.fxCatalog;
  try {
    const res = await fetch('/api/terminal/fx-board');
    if (!res.ok) return fxCatalogList();
    const data = await res.json();
    BB.fxCatalog = (data.items || []).filter(i => i.kind === 'fx');
    BB.fxCatalog.forEach(i => { BB.prices[i.symbol] = i; });
    const meta = document.getElementById('bbWatchMeta');
    if (meta && BB.workspace === 'fx') meta.textContent = `${fxCatalogList().length} pares`;
    renderFxStrip();
    if (BB.workspace === 'fx') renderWatchlist();
    return BB.fxCatalog.length ? BB.fxCatalog : fxCatalogList();
  } catch (_) {
    return fxCatalogList();
  }
}

function renderIndicesStrip() {
  const wrap = document.getElementById('bbIndicesStrip');
  const el = document.getElementById('bbIndicesStripInner');
  if (!wrap || !el) return;
  if (BB.workspace !== 'indices') {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  const picks = ['IPC', 'SPX', 'DAX', 'NIKKEI', 'VIX'];
  const items = picks.map(s => (BB.indicesCatalog || []).find(i => i.symbol === s)).filter(Boolean);
  el.innerHTML = items.map(i => {
    const up = (i.change_pct ?? 0) >= 0;
    return `<button type="button" class="bb-idx-card ${i.symbol === BB.symbol ? 'active' : ''}" data-symbol="${escHtml(i.symbol)}">
      <span class="bb-idx-card-sym">${escHtml(i.symbol)}</span>
      <span class="bb-idx-card-name">${escHtml(i.name)}</span>
      <span class="bb-idx-card-price">${formatQuotePrice(i.price, i.kind)}</span>
      <span class="bb-idx-card-chg ${up ? 'up' : 'down'}">${bbPct(i.change_pct)}</span>
    </button>`;
  }).join('');
  el.querySelectorAll('.bb-idx-card').forEach(btn => {
    btn.addEventListener('click', () => loadSymbol(btn.dataset.symbol));
  });
}

function renderFxStrip() {
  const wrap = document.getElementById('bbFxStrip');
  const el = document.getElementById('bbFxStripInner');
  if (!wrap || !el) return;
  if (BB.workspace !== 'fx') {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  const picks = ['USDMXN', 'EURMXN', 'EURUSD', 'GBPUSD', 'USDJPY', 'DXY'];
  const items = picks.map(s => fxCatalogList().find(i => i.symbol === s)).filter(Boolean);
  el.innerHTML = items.map(i => {
    const up = (i.change_pct ?? 0) >= 0;
    return `<button type="button" class="bb-fx-card ${i.symbol === BB.symbol ? 'active' : ''}" data-symbol="${escHtml(i.symbol)}">
      <span class="bb-fx-card-sym">${escHtml(i.symbol)}</span>
      <span class="bb-fx-card-name">${escHtml(i.name)}</span>
      <span class="bb-fx-card-price">${formatQuotePrice(i.price, i.kind)}</span>
      <span class="bb-fx-card-chg ${up ? 'up' : 'down'}">${bbPct(i.change_pct)}</span>
    </button>`;
  }).join('');
  el.querySelectorAll('.bb-fx-card').forEach(btn => {
    btn.addEventListener('click', () => loadSymbol(btn.dataset.symbol));
  });
}

function applyQuoteBoardModeUI() {
  const isIdx = BB.workspace === 'indices';
  const isFx = BB.workspace === 'fx';
  const compareBtn = document.getElementById('bbCompareBtn');
  if (compareBtn) {
    if (isIdx) {
      compareBtn.textContent = BB.compare ? `vs ${BB.compare}` : 'vs SPX';
      compareBtn.title = 'C = vs S&P 500 · Shift+C = varios índices';
    } else if (isFx) {
      compareBtn.textContent = BB.compare ? `vs ${BB.compare}` : 'vs EURUSD';
      compareBtn.title = 'C = vs EUR/USD · Shift+C = varios pares';
    } else {
      compareBtn.textContent = BB.compare ? `vs ${BB.compare}` : 'vs IPC';
      compareBtn.title = 'C = vs IPC · Shift+C o clic derecho = varios';
    }
  }
  if ((isIdx || isFx) && BB.chartType === 'candle') setChartType(isFx ? 'line' : 'area');
  renderIndicesStrip();
  renderFxStrip();
}

function updateWorkspaceChrome(id) {
  const shell = document.getElementById('bbTerminal');
  shell?.classList.toggle('bb-ws-indices', id === 'indices');
  shell?.classList.toggle('bb-ws-fx', id === 'fx');
  const title = document.getElementById('bbWatchTitle');
  const meta = document.getElementById('bbWatchMeta');
  const tabsMarket = document.getElementById('bbWatchTabsMarket');
  const tabsIndices = document.getElementById('bbWatchTabsIndices');
  const tabsFx = document.getElementById('bbWatchTabsFx');
  const search = document.getElementById('bbWatchSearch');
  tabsMarket?.setAttribute('hidden', '');
  tabsIndices?.setAttribute('hidden', '');
  tabsFx?.setAttribute('hidden', '');
  if (id === 'indices') {
    if (title) title.textContent = 'Índices';
    if (meta) meta.textContent = `${BB.indicesCatalog.length || '…'} referencias`;
    if (search) search.placeholder = 'Buscar índice...';
    tabsIndices?.removeAttribute('hidden');
  } else if (id === 'fx') {
    if (title) title.textContent = 'Divisas';
    if (meta) meta.textContent = `${BB.fxCatalog.length || '…'} pares`;
    if (search) search.placeholder = 'Buscar par...';
    tabsFx?.removeAttribute('hidden');
  } else {
    if (title) title.textContent = 'Watchlist';
    if (meta) meta.textContent = `${window.BB_INIT?.catalogCount || BB.catalog.length || 0} emisoras`;
    if (search) search.placeholder = 'Buscar emisora...';
    tabsMarket?.removeAttribute('hidden');
  }
  applyQuoteBoardModeUI();
}

function switchWorkspace(id) {
  const grid = document.getElementById('bbGrid');
  if (!grid) return;
  const prev = BB.workspace;
  if (id !== prev) {
    BB.compare = '';
    document.getElementById('bbCompareBtn')?.classList.remove('active');
  }
  BB.workspace = id;
  grid.classList.toggle('bb-view-market', id === 'market');
  grid.classList.toggle('bb-view-indices', id === 'indices');
  grid.classList.toggle('bb-view-fx', id === 'fx');
  grid.classList.toggle('bb-view-portfolio', id === 'portfolio');
  document.querySelectorAll('.bb-ws-tab').forEach(t => {
    const on = t.dataset.workspace === id;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  updateWorkspaceChrome(id);
  syncWatchPortToggleUI();
  try { localStorage.setItem('bb_workspace', id); } catch (_) {}
  const watchSearch = document.getElementById('bbWatchSearch');
  if (watchSearch && (id === 'fx' || id === 'indices')) watchSearch.value = '';
  if (id === 'fx' || id === 'indices') {
    clearTicker();
    renderWatchlist();
  }
  if (id === 'indices') {
    loadIndicesBoard().then(() => {
      updateWorkspaceChrome('indices');
      renderWatchlist();
      const sym = isIndexSymbol(BB.symbol) ? BB.symbol : (BB.indicesSymbol || 'IPC');
      if (prev !== 'indices' || !isIndexSymbol(BB.symbol)) loadSymbol(sym, BB.period);
    });
  } else if (id === 'fx') {
    loadFxBoard().then(() => {
      updateWorkspaceChrome('fx');
      renderWatchlist();
      const sym = isFxSymbol(BB.symbol) ? BB.symbol : (BB.fxSymbol || 'USDMXN');
      if (prev !== 'fx' || !isFxSymbol(BB.symbol)) loadSymbol(sym, BB.period);
    });
  } else if (id === 'market') {
    renderWatchlist();
    let sym = BB.symbol || window.BB_INIT?.symbol || 'IPC';
    if ((prev === 'indices' || prev === 'fx') && sym && !BB.catalog.find(c => c.symbol === sym)) {
      sym = window.BB_INIT?.symbol || 'IPC';
    }
    const needsChart = prev !== 'market' || !BB.lastChartData?.points?.length;
    if (needsChart) loadSymbol(sym, BB.period);
  } else if (id === 'portfolio') {
    setChartLoading(false);
    const st = document.getElementById('bbChartStatus');
    if (st && !BB.lastChartData?.points?.length) st.textContent = '';
  }
  refreshTicker();
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}

function setupWorkspaceTabs() {
  let saved = 'market';
  try { saved = localStorage.getItem('bb_workspace') || 'market'; } catch (_) {}
  const urlSym = bbNormSym(new URLSearchParams(location.search).get('symbol'));
  if (urlSym) saved = 'market';
  switchWorkspace(saved);
  document.querySelectorAll('.bb-ws-tab').forEach(tab => {
    tab.addEventListener('click', () => switchWorkspace(tab.dataset.workspace));
  });
}

function setChartType(type) {
  BB.chartType = type || 'candle';
  document.querySelectorAll('[data-chart-type]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.chartType === BB.chartType);
  });
  if (BB.lastChartData) renderCharts(BB.lastChartData);
}

function setupKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select')) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (document.querySelector('.bb-kbd-overlay.open, .bb-pos-modal.open')) return;
    if (e.key === '/' || (e.ctrlKey && e.key === 'k')) {
      e.preventDefault();
      bbFocusSymbolSearch();
    }
    if (e.key === '?') document.getElementById('bbKbdHelp')?.classList.add('open');
    if (e.key === 'Escape') {
      document.getElementById('bbKbdHelp')?.classList.remove('open');
      document.getElementById('bbPosModal')?.classList.remove('open');
    }
    if ((e.key >= '1' && e.key <= '9') || e.key === '0') {
      const btn = document.querySelector(`.bb-period[data-key="${e.key}"]`);
      if (btn) loadSymbol(BB.symbol, btn.dataset.period);
    }
    if (BB.workspace !== 'portfolio') {
      if (e.key === 'ArrowLeft') panChart(-1);
      if (e.key === 'ArrowRight') panChart(1);
      if (e.key === 'Home') goChartStart();
      if (e.key === 'End') goChartEnd();
      if (e.key === '+' || e.key === '=') zoomChart(0.75);
      if (e.key === '-') zoomChart(1.25);
      if (e.key === 'f' || e.key === 'F') fitChartView();
    }
    if ((e.key === 'c' || e.key === 'C') && e.shiftKey) toggleCompare(true);
    else if (e.key === 'c' || e.key === 'C') toggleCompare(false);
    if (e.key === 'm' || e.key === 'M') toggleMA();
    if (e.key === 'g' || e.key === 'G') switchWorkspace('market');
    if (e.key === 'i' || e.key === 'I') switchWorkspace('indices');
    if (e.key === 'x' || e.key === 'X') switchWorkspace('fx');
    if (e.key === 'p' || e.key === 'P') switchWorkspace('portfolio');
    if ((e.key === 'a' || e.key === 'A') && isStockWorkspace() && BB.symbol) {
      window.location.href = `/emisora/${encodeURIComponent(BB.symbol)}`;
    }
    if ((e.key === 'w' || e.key === 'W') && isStockWorkspace() && BB.symbol && BB.symbol !== 'IPC') {
      e.preventDefault();
      toggleWatchlistCurrent();
    }
    if (e.key === 'l' || e.key === 'L') {
      if (typeof bbToggleLayoutEditMode === 'function') bbToggleLayoutEditMode();
      else document.getElementById('bbForgeLayoutBtn')?.click()
        || document.getElementById('bbLayoutBtn')?.click();
    }
  });
  document.getElementById('bbKbdClose')?.addEventListener('click', () => {
    document.getElementById('bbKbdHelp')?.classList.remove('open');
  });
}

function toggleCompare(multi = false) {
  const defaultCmp = BB.workspace === 'indices' ? 'SPX'
    : BB.workspace === 'fx' ? 'EURUSD' : 'IPC';
  if (multi) {
    const value = prompt('Comparar con (símbolos separados por coma):', BB.compare || defaultCmp);
    if (value === null) return;
    BB.compare = value.trim();
  } else {
    BB.compare = BB.compare ? '' : defaultCmp;
  }
  document.getElementById('bbCompareBtn')?.classList.toggle('active', !!BB.compare);
  const btn = document.getElementById('bbCompareBtn');
  if (btn) btn.textContent = BB.compare ? `vs ${BB.compare}` : `vs ${defaultCmp}`;
  applyQuoteBoardModeUI();
  loadSymbol(BB.symbol);
}

function toggleMA() {
  BB.showMA = !BB.showMA;
  document.getElementById('bbToggleMA')?.classList.toggle('active', BB.showMA);
  if (BB.lastChartData) renderCharts(BB.lastChartData);
}

function paintDayRange(quote) {
  const box = document.getElementById('bbDayRange');
  const mark = document.getElementById('bbDayMark');
  const loEl = document.getElementById('bbDayLow');
  const hiEl = document.getElementById('bbDayHigh');
  const lo = quote?.low;
  const hi = quote?.high;
  const px = quote?.price;
  if (!box || lo == null || hi == null || px == null || hi <= lo) {
    if (box) box.hidden = true;
    return;
  }
  box.hidden = false;
  if (loEl) loEl.textContent = bbFmt(lo);
  if (hiEl) hiEl.textContent = bbFmt(hi);
  if (mark) {
    const pct = Math.min(100, Math.max(0, ((px - lo) / (hi - lo)) * 100));
    mark.style.left = pct + '%';
  }
}

const ALERT_PCT_KINDS = new Set(['day_up', 'day_down', 'cost_drop']);

function alertLabel(a) {
  const t = Number(a.target);
  switch (a.direction) {
    case 'above': return `${a.symbol} ≥ ${bbFmt(t)}`;
    case 'below': return `${a.symbol} ≤ ${bbFmt(t)}`;
    case 'day_up': return `${a.symbol} +${t}% día`;
    case 'day_down': return `${a.symbol} −${t}% día`;
    case 'cost_drop': return `${a.symbol} −${t}% vs costo`;
    default: return a.symbol;
  }
}

function alertHitMessage(a) {
  const px = a.trigger_price ?? a.price;
  return `${alertLabel(a)} · disparó en ${bbFmt(px)}`;
}

function renderAlerts() {
  const el = document.getElementById('bbAlertList');
  if (!el) return;
  const items = BB.alerts || [];
  const badge = document.getElementById('bbChromeAlerts');
  const activeN = items.filter(a => a.active).length;
  if (badge) {
    badge.textContent = activeN > 0 ? String(activeN) : '';
    badge.hidden = activeN === 0;
  }
  if (!items.length) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  el.innerHTML = items.map(a => {
    const hit = !a.active && a.triggered_at;
    return `<span class="bb-alert-chip ${hit ? 'hit' : ''}">${escHtml(alertLabel(a))}${hit ? ' · disparó' : ''}<button type="button" data-alert-id="${a.id}" aria-label="Quitar">×</button></span>`;
  }).join('');
  el.querySelectorAll('[data-alert-id]').forEach(btn => {
    btn.addEventListener('click', () => removeAlert(btn.dataset.alertId));
  });
}

function announceAlert(a) {
  const msg = alertHitMessage(a);
  const banner = document.createElement('div');
  banner.className = 'bb-flash ok';
  banner.textContent = msg;
  document.getElementById('bbTerminal')?.prepend(banner);
  if (window.Notification && Notification.permission === 'granted') {
    try { new Notification('Finanzas', { body: msg }); } catch (_) {}
  }
}

async function loadAlerts() {
  try {
    const res = await fetch('/api/terminal/alerts');
    if (!res.ok) return;
    const data = await res.json();
    const items = data.items || [];
    const triggered = items.filter(a => !a.active && a.triggered_at);
    if (BB._seenTriggered) {
      const fresh = triggered.filter(a => !BB._seenTriggered.has(a.id));
      fresh.forEach(announceAlert);
      if (fresh.length) dismissFlashBanners();
    }
    BB._seenTriggered = new Set(triggered.map(a => a.id));
    BB.alerts = items;
    renderAlerts();
  } catch (_) {}
}

async function removeAlert(id) {
  await fetch(`/api/terminal/alerts/${id}`, { method: 'DELETE' });
  await loadAlerts();
}

function paSet(id, text, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.classList.remove('up', 'down');
  if (cls) el.classList.add(cls);
}

function signCls(n) {
  if (n == null) return '';
  return n >= 0 ? 'up' : 'down';
}

function signedMoney(n) {
  if (n == null) return '—';
  return `${n >= 0 ? '+' : '−'}${bbFmt(Math.abs(n))}`;
}

async function loadPortfolioAnalytics(force = false) {
  const box = document.getElementById('bbPortAnalytics');
  if (!box) return;
  const now = Date.now();
  if (!force && BB._analyticsAt && now - BB._analyticsAt < 60000) return;
  BB._analyticsAt = now;
  try {
    const res = await fetch('/api/terminal/portfolio/analytics');
    if (!res.ok) return;
    const a = await res.json();
    if (!a.has_positions) { box.hidden = true; return; }
    box.hidden = false;
    paSet('paDay', a.priced ? signedMoney(a.day_pnl) : '—', signCls(a.day_pnl));
    paSet('paDayPct', a.day_pct != null ? bbPct(a.day_pct) : 'sin cotización', signCls(a.day_pct));
    paSet('paAlpha', a.alpha_pct != null ? bbPct(a.alpha_pct) : '—', signCls(a.alpha_pct));
    paSet('paBench', a.benchmark_pct != null ? `IPC ${bbPct(a.benchmark_pct)}` : '');
    paSet('paBest', a.best ? `${a.best.symbol} ${bbPct(a.best.change_pct)}` : '—', a.best ? signCls(a.best.change_pct) : '');
    paSet('paWorst', a.worst ? `${a.worst.symbol} ${bbPct(a.worst.change_pct)}` : '—', a.worst ? signCls(a.worst.change_pct) : '');
    paSet('paTop', a.top_symbol ? `${a.top_symbol} ${a.top_weight_pct}%` : '—');
    paSet('paEff', a.effective_positions ? `≈${a.effective_positions} posiciones efectivas` : '');
    paSet('paNet', bbPct(a.net_return_pct), signCls(a.net_return_pct));
    paSet('paGross', `bruto ${bbPct(a.gross_return_pct)}`);
  } catch (_) {}
}

function syncAlertTargetField() {
  const dir = document.getElementById('bbAlertDir')?.value;
  const label = document.getElementById('bbAlertTargetLabel');
  const input = document.getElementById('bbAlertTarget');
  const pct = ALERT_PCT_KINDS.has(dir);
  if (label) label.textContent = pct ? 'Porcentaje (%)' : 'Precio';
  if (input) input.placeholder = pct ? '5' : '180.00';
}

function setupPriceAlerts() {
  const modal = document.getElementById('bbAlertModal');
  const form = document.getElementById('bbAlertForm');
  const err = document.getElementById('bbAlertError');
  document.getElementById('bbAlertBtn')?.addEventListener('click', () => {
    const input = document.getElementById('bbAlertSymbol');
    if (input) input.value = BB.symbol || '';
    if (err) err.hidden = true;
    modal?.classList.add('open');
    if (window.Notification && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  });
  document.getElementById('bbAlertClose')?.addEventListener('click', () => modal?.classList.remove('open'));
  document.getElementById('bbAlertDir')?.addEventListener('change', syncAlertTargetField);
  syncAlertTargetField();
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const symbol = document.getElementById('bbAlertSymbol')?.value || '';
    const direction = document.getElementById('bbAlertDir')?.value || 'above';
    const target = Number(document.getElementById('bbAlertTarget')?.value);
    const res = await fetch('/api/terminal/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, direction, target }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (err) {
        err.hidden = false;
        err.textContent = data.detail || 'No se pudo guardar';
      }
      return;
    }
    modal?.classList.remove('open');
    form.reset();
    syncAlertTargetField();
    await loadAlerts();
  });
  loadAlerts();
  loadPortfolioAnalytics(true);
}

function flashEl(el, dir) {
  if (!el) return;
  el.classList.remove('flash-up', 'flash-down');
  void el.offsetWidth;
  el.classList.add(dir === 'up' ? 'flash-up' : 'flash-down');
}

function flashPrice(el, dir) {
  flashEl(el, dir);
}

function setChartLoading(on) {
  document.querySelector('.bb-chart-area')?.classList.toggle('bb-loading', on);
  if (!on) document.querySelector('.bb-chart-area')?.classList.add('bb-loaded');
}

function dismissFlashBanners() {
  document.querySelectorAll('.bb-flash:not(.bb-flash-out)').forEach(el => {
    setTimeout(() => el.classList.add('bb-flash-out'), 4500);
    setTimeout(() => el.remove(), 5200);
  });
}

function staggerChildren(container, itemSel, cls) {
  if (!container) return;
  container.querySelectorAll(itemSel).forEach((el, i) => {
    el.classList.add(cls);
    el.style.animationDelay = `${Math.min(i * 0.04, 0.5)}s`;
  });
}

function newsTickerSymbolList() {
  const out = [];
  const seen = new Set();
  const add = (sym) => {
    const s = String(sym || '').replace('BMV:', '').trim().toUpperCase();
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  if (BB.symbol) add(BB.symbol);
  (BB.watchlistItems || []).forEach(i => add(i.symbol));
  (window.BB_INIT?.holdings || []).forEach(h => add(h.ticker || h.symbol));
  return out.slice(0, 8);
}

let newsTickerFetchTimer;
function scheduleNewsTickerRefresh() {
  clearTimeout(newsTickerFetchTimer);
  newsTickerFetchTimer = setTimeout(refreshNewsTicker, 400);
}

async function refreshNewsTicker() {
  const track = document.getElementById('bbNewsTickerTrack');
  if (!track) return;
  try {
    const syms = newsTickerSymbolList();
    const q = syms.length
      ? `limit=42&symbols=${encodeURIComponent(syms.join(','))}`
      : 'limit=36';
    const res = await fetch(`/api/terminal/news?${q}`);
    const data = await res.json();
    const items = data.items || [];
    if (!items.length) {
      track.innerHTML = '<span class="bb-news-tick bb-news-tick--empty">Sin noticias recientes — intenta de nuevo en un momento</span>';
      return;
    }
    const html = items.map(newsTickHtml).join('');
    track.innerHTML = html + html;
    applyNewsTickerSpeed(track);
  } catch (_) {
    if (!track.childElementCount) {
      track.innerHTML = '<span class="bb-news-tick bb-news-tick--empty">No se pudieron cargar noticias</span>';
    }
  }
}

/** Velocidad ~420px/s (mitad del track = un ciclo de la animación). */
function applyNewsTickerSpeed(track) {
  if (!track) track = document.getElementById('bbNewsTickerTrack');
  if (!track || track.querySelector('.bb-news-tick--empty')) return;
  const run = () => {
    const half = track.scrollWidth / 2;
    if (half < 40) return;
    const PX_PER_SEC = 420;
    const sec = Math.max(5, Math.min(16, half / PX_PER_SEC));
    const dur = `${sec.toFixed(2)}s`;
    track.style.setProperty('--bb-news-scroll', dur);
    track.style.animation = `bb-scroll-news ${dur} linear infinite`;
  };
  requestAnimationFrame(() => requestAnimationFrame(run));
}

let newsTickerResizeTimer;
function onNewsTickerResize() {
  clearTimeout(newsTickerResizeTimer);
  newsTickerResizeTimer = setTimeout(() => {
    applyNewsTickerSpeed();
    applyPriceTickerSpeed();
  }, 120);
}

function newsTickHtml(n) {
  const title = (n.title || '').trim();
  const pub = escHtml(n.publisher || n.tag || 'Fuente');
  const time = escHtml((n.published_at || '').slice(0, 16).replace('T', ' '));
  const sym = n.symbol ? `<span class="bb-news-tick-tag">${escHtml(n.symbol)}</span>` : '';
  return `<a class="bb-news-tick" href="${safeHttpUrl(n.url)}" target="_blank" rel="noopener noreferrer" title="${escHtml(title)}">
    ${sym}<span class="bb-news-tick-meta">${time ? `${time} · ` : ''}${pub}</span>
    <span class="bb-news-tick-title">${escHtml(title)}</span>
  </a>`;
}

async function refreshTicker() {
  const track = document.getElementById('bbTickerTrack');
  if (!track) return;
  try {
    let quotes = [];
    if (BB.workspace === 'indices') {
      await loadIndicesBoard();
      quotes = BB.indicesCatalog || [];
    } else if (BB.workspace === 'fx') {
      await loadFxBoard();
      quotes = fxCatalogList();
    } else {
      const res = await fetch('/api/bolsa-ticker');
      const data = await res.json();
      quotes = data.quotes || [];
    }
    if (!quotes.length) {
      track.innerHTML = '';
      return;
    }
    const html = quotes.map(q => tickHtml(q)).join('');
    track.innerHTML = html + html;
    track.querySelectorAll('.bb-tick').forEach(tick => {
      tick.addEventListener('click', () => bbPickSymbol(tick.dataset.symbol));
    });
    applyPriceTickerSpeed(track);
  } catch (_) {}
}

/** Velocidad del ticker de precios (misma lógica que noticias, ciclo ~80s en banda ancha). */
function applyPriceTickerSpeed(track) {
  if (!track) track = document.getElementById('bbTickerTrack');
  if (!track || !track.childElementCount) return;
  const run = () => {
    const half = track.scrollWidth / 2;
    if (half < 40) return;
    const PX_PER_SEC = 95;
    const sec = Math.max(12, Math.min(120, half / PX_PER_SEC));
    const dur = `${sec.toFixed(2)}s`;
    track.style.setProperty('--bb-price-scroll', dur);
    track.style.animation = `bb-scroll-price ${dur} linear infinite`;
  };
  requestAnimationFrame(() => requestAnimationFrame(run));
}

function tickHtml(q) {
  const pct = q.change_pct ?? 0;
  const up = pct >= 0;
  const priceStr = formatQuotePrice(q.price, q.kind);
  return `<div class="bb-tick" data-symbol="${escHtml(q.symbol)}">
    <span class="bb-tick-sym">${escHtml(q.symbol)}</span>
    <span class="bb-tick-price">${priceStr}</span>
    <span class="bb-tick-chg ${up ? 'up' : 'down'}">${bbPct(pct)}</span>
  </div>`;
}

async function loadDefaultCatalog() {
  if (BB.catalogLoaded) return;
  try {
    const res = await fetch('/api/terminal/catalog?limit=40');
    const data = await res.json();
    BB.catalog = data.items || [];
    BB.catalogLoaded = true;
    if (!isQuoteWorkspace()) renderWatchlist();
  } catch (_) {}
}

function updateWatchlistPrices(quotes) {
  if (!quotes) return;
  document.querySelectorAll('.bb-watch-row[data-symbol]').forEach(row => {
    const sym = row.dataset.symbol;
    const q = quotes[sym];
    if (!q || q.price == null) return;
    const right = row.querySelector('.bb-watch-right');
    if (!right) return;
    let priceEl = row.querySelector('.bb-watch-price');
    const chgEl = row.querySelector('.bb-watch-chg');
    if (!priceEl) {
      priceEl = document.createElement('span');
      priceEl.className = 'bb-watch-price';
      right.insertBefore(priceEl, chgEl || null);
    }
    const kind = q.kind || boardMeta(sym)?.kind;
    const prev = priceEl.dataset.px != null ? Number(priceEl.dataset.px) : null;
    priceEl.dataset.px = String(q.price);
    if (prev != null && prev !== q.price) flashEl(priceEl, q.price > prev ? 'up' : 'down');
    priceEl.textContent = formatQuotePrice(q.price, kind);
    if (chgEl) {
      if (q.change_pct == null || Number.isNaN(q.change_pct)) {
        chgEl.textContent = '—';
        chgEl.className = 'bb-watch-chg';
      } else {
        const pct = q.change_pct;
        chgEl.textContent = bbPct(pct);
        chgEl.className = 'bb-watch-chg ' + (pct >= 0 ? 'up' : 'down');
      }
    }
  });
}

let liveRefreshPromise = null;

async function refreshLive() {
  if (liveRefreshPromise) return liveRefreshPromise;
  liveRefreshPromise = refreshLiveInner();
  try {
    await liveRefreshPromise;
  } finally {
    liveRefreshPromise = null;
  }
}

async function refreshLiveInner() {
  let syms;
  if (BB.workspace === 'indices') {
    await loadIndicesBoard(true);
    syms = [...new Set([
      BB.symbol,
      'IPC',
      ...(BB.indicesCatalog || []).map(i => i.symbol),
    ])].filter(Boolean).slice(0, 20);
  } else if (BB.workspace === 'fx') {
    await loadFxBoard(true);
    syms = [...new Set([
      BB.symbol,
      'USDMXN',
      ...fxCatalogList().map(i => i.symbol),
    ])].filter(s => isFxSymbol(s)).slice(0, 20);
  } else {
    syms = [...new Set([
      BB.symbol,
      'IPC',
      ...(window.BB_INIT?.holdings || []).map(h => (h.ticker || '').replace('BMV:', '')),
      ...(BB.watchlistItems || []).map(i => i.symbol),
      ...(BB.alerts || []).filter(a => a.active).map(a => a.symbol),
      ...visibleWatchlistSymbols(),
    ])].filter(Boolean).slice(0, 40);
  }

  try {
    const [liveRes, portRes, fxRes, marketRes] = await Promise.all([
      fetch(`/api/terminal/live?symbols=${syms.join(',')}`),
      fetch('/api/terminal/portfolio'),
      fetch('/api/terminal/fx'),
      fetch('/api/terminal/market'),
    ]);
    const live = await liveRes.json();
    const port = await portRes.json();
    const fx = await fxRes.json();
    const market = await marketRes.json();
    const prevMainPrice = BB.prices[BB.symbol]?.price;

    Object.entries(live.quotes || {}).forEach(([sym, q]) => {
      const prev = BB.prices[sym]?.price;
      BB.prices[sym] = q;
      if (prev != null && q.price !== prev) {
        document.querySelectorAll(`.bb-tick[data-symbol="${sym}"]`).forEach(tick => {
          const priceEl = tick.querySelector('.bb-tick-price');
          if (priceEl) priceEl.textContent = formatQuotePrice(q.price, q.kind || boardMeta(sym)?.kind);
          flashPrice(tick, q.price > prev ? 'up' : 'down');
        });
      }
    });

    if (BB.symbol && live.quotes?.[BB.symbol]) {
      const q = live.quotes[BB.symbol];
      const symPrice = document.getElementById('bbSymPrice');
      const detailPrice = document.getElementById('bbDetailPrice');
      if (symPrice) {
        symPrice.textContent = formatQuotePrice(q.price, boardMeta(BB.symbol)?.kind);
        if (prevMainPrice != null && q.price !== prevMainPrice) {
          flashEl(symPrice, q.price > prevMainPrice ? 'up' : 'down');
          flashEl(detailPrice, q.price > prevMainPrice ? 'up' : 'down');
        }
      }
      if (detailPrice) detailPrice.textContent = formatQuotePrice(q.price, boardMeta(BB.symbol)?.kind);
      paintDayRange(q);
      const chgEl = document.getElementById('bbSymChg');
      if (chgEl) {
        chgEl.textContent = bbPct(q.change_pct);
        chgEl.className = 'bb-symbol-chg ' + (q.change_pct >= 0 ? 'up' : 'down');
      }
    }

    updateWatchlistPrices(live.quotes || {});
    renderIndicesStrip();
    renderFxStrip();
    updatePortfolio(port);
    updateFx(fx.items);
    updateClock(market);
    if (BB.workspace === 'market' || BB.workspace === 'portfolio') {
      await loadAlerts();
      loadPortfolioAnalytics();
    }
  } catch (_) {}
}

function updatePortfolio(port) {
  const metaEl = document.getElementById('psPriceMeta');
  const pm = port?.price_meta || {};
  const snap = port?.snapshot || {};
  const label = snap.price_label || pm.source_label || 'snapshot';
  const age = pm.fetched_age || '';
  if (metaEl) metaEl.textContent = age ? `${label} · ${age}` : label;

  if (!port?.snapshot) return;
  const s = port.snapshot;
  const prevSnap = BB.lastSnapshot || {};
  const set = (id, val, cls) => {
    const el = document.getElementById(id);
    if (!el) return;
    const prev = prevSnap[id];
    el.textContent = bbFmt(val);
    if (cls) el.className = cls;
    if (prev != null && prev !== val) flashEl(el, val > prev ? 'up' : 'down');
  };
  set('psValue', s.market_value);
  set('psPnl', s.pnl, s.pnl >= 0 ? 'up' : 'down');
  set('psNet', s.net_pnl, s.net_pnl >= 0 ? 'up' : 'down');
  BB.lastSnapshot = { psValue: s.market_value, psPnl: s.pnl, psNet: s.net_pnl };

  const tbody = document.getElementById('bbPortRows');
  if (!tbody) return;
  if (!port.holdings?.length) {
    tbody.innerHTML = '';
    return;
  }
  const prevPrices = BB.lastPortPrices || {};
  const logoFn = (window.Forge && window.Forge.logoHtml) || logoHtml;
  const weightFn = (window.Forge && window.Forge.weightBar) || (() => '');
  tbody.innerHTML = port.holdings.map(h => {
    const sym = h.symbol || (h.ticker || '').replace('BMV:', '');
    const wt = h.weight_pct ?? 0;
    return `<tr data-symbol="${escHtml(sym)}">
      <td class="bb-port-ticker">${logoFn(sym)}<span class="sym">${escHtml(sym)}</span></td>
      <td>${escHtml((h.name || '').slice(0, 20))}</td>
      <td class="num"><span class="bb-weight-pct">${wt.toFixed(1)}%</span>${weightFn(wt)}</td>
      <td class="num">${h.shares}</td>
      <td class="num">${bbFmt(h.avg_cost)}</td>
      <td class="num">${bbFmt(h.market_price)}</td>
      <td class="num">${bbFmt(h.market_value)}</td>
      <td class="num ${h.pnl >= 0 ? 'up' : 'down'}">${bbFmt(h.pnl)}</td>
      <td class="num ${h.net_pnl >= 0 ? 'up' : 'down'}">${bbFmt(h.net_pnl)}</td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('tr').forEach(row => {
    const sym = row.dataset.symbol;
    const price = port.holdings.find(h => h.symbol === sym)?.market_price;
    if (price != null && prevPrices[sym] != null && price !== prevPrices[sym]) {
      row.classList.add('bb-row-flash', price > prevPrices[sym] ? '' : 'down');
      setTimeout(() => row.classList.remove('bb-row-flash', 'down'), 900);
    }
    if (price != null) prevPrices[sym] = price;
    row.addEventListener('click', () => bbPickSymbol(row.dataset.symbol));
    row.addEventListener('dblclick', () => {
      const sym = row.dataset.symbol;
      if (sym) window.location.href = `/emisora/${encodeURIComponent(sym)}`;
    });
  });
  BB.lastPortPrices = prevPrices;
}

function updateFx(items) {
  const el = document.getElementById('bbFx');
  if (!el || !items?.length) return;
  el.innerHTML = items.map(fx => `
    <div class="bb-fx-item" data-fx="${escHtml(fx.id)}">
      <span class="bb-fx-label" title="${escHtml(fx.note || '')}">${escHtml(fx.label)}${fx.note ? ` · ${escHtml(fx.note)}` : ''}</span>
      <span class="bb-fx-val">${fx.unit === '%' ? (fx.price != null ? fx.price.toFixed(2) + '%' : '—') : (fx.price != null ? Number(fx.price).toFixed(4) : '—')}</span>
      ${fx.unit !== '%' ? `<span class="bb-fx-chg ${fx.change_pct >= 0 ? 'up' : 'down'}">${bbPct(fx.change_pct)}</span>` : ''}
    </div>`).join('');
}

function updateClock(market) {
  if (!market) return;
  const st = document.getElementById('bbMarketStatus');
  const cl = document.getElementById('bbClock');
  if (st) { st.textContent = market.label; st.className = 'bb-market-status ' + market.status; }
  if (cl) cl.textContent = market.time_mx + ' CDMX';
  const chromeMarket = document.getElementById('chromeMarketStatus');
  const chromeClock = document.getElementById('chromeClock');
  if (chromeMarket) {
    chromeMarket.textContent = market.label;
    chromeMarket.className = 'bb-market-status ' + (market.status || 'closed');
  }
  if (chromeClock) chromeClock.textContent = market.time_mx + ' CDMX';
}

/** Scroll del terminal en /inversiones: rueda sobre gráfica/rail mueve .bb-main (no solo el iframe TV). */
function setupInvestmentsMainScroll() {
  const shell = document.getElementById('bbTerminal');
  const main = document.getElementById('bbGrid');
  if (!shell?.classList.contains('bb-shell--scroll') || !main || main.dataset.bbMainWheel) return;
  main.dataset.bbMainWheel = '1';

  const scrollViews = new Set(['market', 'indices', 'fx']);
  const scrollEl = () => main;
  const canScroll = () => {
    const el = scrollEl();
    return el && el.scrollHeight > el.clientHeight + 4;
  };

  const nestedCanScroll = (el, deltaY) => {
    if (!(el instanceof HTMLElement)) return false;
    const oy = getComputedStyle(el).overflowY;
    if (oy !== 'auto' && oy !== 'scroll') return false;
    if (el.scrollHeight <= el.clientHeight + 2) return false;
    if (deltaY < 0 && el.scrollTop > 0) return true;
    if (deltaY > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
    return false;
  };

  const isChartWheelTarget = (target) => {
    if (!(target instanceof Node)) return false;
    const roots = ['bbChart', 'bbVolChart', 'bbRsiChart', 'bbChartWrap'];
    return roots.some((id) => document.getElementById(id)?.contains(target));
  };

  const onWheel = (e) => {
    if (!scrollViews.has(BB.workspace)) return;
    if (isChartWheelTarget(e.target)) return;
    const el = scrollEl();
    if (!el || !canScroll()) return;
    let node = e.target;
    while (node && node !== el && node !== main) {
      if (nestedCanScroll(node, e.deltaY)) return;
      node = node.parentElement;
    }
    el.scrollTop += e.deltaY;
    e.preventDefault();
  };

  main.addEventListener('wheel', onWheel, { passive: false, capture: true });
  document.getElementById('bbWorkspacePane')?.addEventListener('wheel', onWheel, { passive: false });
}

function initBloombergTerminal(config) {
  const params = new URLSearchParams(location.search);
  const urlCmp = (params.get('compare') || '').trim().toUpperCase().replace(/^BMV:/i, '');
  if (urlCmp) BB.compare = urlCmp;
  BB.symbol = config?.symbol || 'IPC';
  BB.catalog = [];
  BB.watchlistItems = [...(config?.watchlist || [])];
  BB.watchlist = new Set(BB.watchlistItems.map(i => i.symbol));
  window.BB_INIT = config;

  renderWatchlist([]);
  updateWatchFollowBtn();
  document.getElementById('bbWatchFollowBtn')?.addEventListener('click', () => toggleWatchlistCurrent());
  try {
    BB.showWatchPortfolio = localStorage.getItem(WATCH_PORTFOLIO_KEY) === '1';
  } catch (_) {
    BB.showWatchPortfolio = false;
  }
  document.getElementById('bbWatchPortToggle')?.addEventListener('click', () => {
    setWatchPortfolioInSidebar(!BB.showWatchPortfolio);
  });
  syncWatchPortToggleUI();
  setWatchPortfolioInSidebar(BB.showWatchPortfolio);
  loadDefaultCatalog();
  refreshTicker();
  refreshNewsTicker();
  setupCommandBar();
  setupKeyboard();
  setupWorkspaceTabs();
  if (typeof setupTerminalLayout === 'function') setupTerminalLayout();
  if (typeof setupWidgetsLayout === 'function') setupWidgetsLayout();
  setupInvestmentsMainScroll();
  document.querySelectorAll('[data-chart-type]').forEach(btn => {
    btn.addEventListener('click', () => setChartType(btn.dataset.chartType));
  });
  document.getElementById('bbChartPanL')?.addEventListener('click', () => panChart(-1));
  document.getElementById('bbChartPanR')?.addEventListener('click', () => panChart(1));
  document.getElementById('bbChartZoomIn')?.addEventListener('click', () => zoomChart(0.75));
  document.getElementById('bbChartZoomOut')?.addEventListener('click', () => zoomChart(1.25));
  document.getElementById('bbChartFit')?.addEventListener('click', fitChartView);
  document.getElementById('bbChartGoStart')?.addEventListener('click', goChartStart);
  document.getElementById('bbChartGoEnd')?.addEventListener('click', goChartEnd);
  document.querySelectorAll('.bb-period').forEach(btn => {
    btn.addEventListener('click', () => loadSymbol(BB.symbol, btn.dataset.period));
  });
  document.querySelectorAll('.bb-watch-tabs').forEach(group => {
    group.querySelectorAll('.bb-watch-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        group.querySelectorAll('.bb-watch-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        renderWatchlist();
      });
    });
  });
  let watchSearchSeq = 0;
  let watchSearchTimer;
  document.getElementById('bbWatchSearch')?.addEventListener('input', (e) => {
    clearTimeout(watchSearchTimer);
    if (isQuoteWorkspace()) {
      renderWatchlist();
      return;
    }
    const q = e.target.value.trim();
    if (q.length < 2) {
      renderWatchlist();
      return;
    }
    watchSearchTimer = setTimeout(async () => {
      const seq = ++watchSearchSeq;
      const items = await searchCatalog(q, 20);
      if (seq !== watchSearchSeq) return;
      const current = (document.getElementById('bbWatchSearch')?.value || '').trim();
      if (current !== q || isQuoteWorkspace()) return;
      renderWatchlist(items);
    }, 280);
  });
  document.querySelectorAll('.bb-tick[data-symbol]').forEach(tick => {
    tick.addEventListener('click', () => bbPickSymbol(tick.dataset.symbol));
  });
  document.getElementById('bbToggleMA')?.classList.add('active');
  document.getElementById('bbToggleMA')?.addEventListener('click', toggleMA);
  document.getElementById('bbToggleRSI')?.addEventListener('click', () => {
    BB.showRSI = !BB.showRSI;
    document.getElementById('bbToggleRSI')?.classList.toggle('active', BB.showRSI);
    if (BB.lastChartData) renderCharts(BB.lastChartData);
  });
  document.getElementById('bbToggleBB')?.addEventListener('click', () => {
    BB.showBB = !BB.showBB;
    document.getElementById('bbToggleBB')?.classList.toggle('active', BB.showBB);
    if (BB.lastChartData) renderCharts(BB.lastChartData);
  });
  document.getElementById('bbToggleLog')?.addEventListener('click', () => {
    BB.logScale = !BB.logScale;
    document.getElementById('bbToggleLog')?.classList.toggle('active', BB.logScale);
    if (BB.lastChartData) renderCharts(BB.lastChartData);
  });
  document.getElementById('bbToggleDiv')?.classList.add('active');
  document.getElementById('bbToggleDiv')?.addEventListener('click', () => {
    BB.showDiv = !BB.showDiv;
    document.getElementById('bbToggleDiv')?.classList.toggle('active', BB.showDiv);
    if (BB.lastChartData) applyDividendMarkers(BB.lastChartData);
  });
  document.getElementById('bbAddPosBtn')?.addEventListener('click', () => {
    document.getElementById('bbPosModal')?.classList.add('open');
  });
  document.getElementById('bbPosClose')?.addEventListener('click', () => {
    document.getElementById('bbPosModal')?.classList.remove('open');
  });
  document.getElementById('bbPortRows')?.querySelectorAll('tr').forEach(row => {
    row.addEventListener('click', () => bbPickSymbol(row.dataset.symbol));
    row.addEventListener('dblclick', () => {
      const sym = row.dataset.symbol;
      if (sym) window.location.href = `/emisora/${encodeURIComponent(sym)}`;
    });
  });

  setupPriceAlerts();
  document.getElementById('bbTerminal')?.classList.add('bb-ready');
  setupChartResizeObserver();
  const reflowCharts = () => {
    if (typeof resizeAllCharts === 'function') resizeAllCharts();
  };
  requestAnimationFrame(() => requestAnimationFrame(reflowCharts));
  setTimeout(reflowCharts, 120);
  setTimeout(reflowCharts, 600);
  dismissFlashBanners();

  document.getElementById('bbCompareBtn')?.addEventListener('click', e => toggleCompare(e.shiftKey));
  document.getElementById('bbCompareBtn')?.addEventListener('contextmenu', e => {
    e.preventDefault();
    toggleCompare(true);
  });

  if (BB.workspace === 'market') {
    loadSymbol(BB.symbol, BB.period || '6mo');
  } else {
    setChartLoading(false);
  }
  setTimeout(refreshLive, 4000);
  startTerminalPolls();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopTerminalPolls();
    else {
      refreshLive();
      startTerminalPolls();
    }
  });
  window.addEventListener('resize', onNewsTickerResize);
}

let livePollTimer = null;
let clockPollTimer = null;
let newsTickerPollTimer = null;

function stopTerminalPolls() {
  clearInterval(livePollTimer);
  clearInterval(clockPollTimer);
  clearInterval(newsTickerPollTimer);
  livePollTimer = clockPollTimer = newsTickerPollTimer = null;
}

function startTerminalPolls() {
  stopTerminalPolls();
  if (document.hidden) return;
  livePollTimer = setInterval(refreshLive, BB.pollMs);
  newsTickerPollTimer = setInterval(refreshNewsTicker, 300000);
  clockPollTimer = setInterval(async () => {
    try {
      const res = await fetch('/api/terminal/market');
      updateClock(await res.json());
    } catch (_) {}
  }, 5000);
}

/* Legacy compat */
function loadTerminalChart(sym, per) { bbPickSymbol(sym, per); }
