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
  _loadId: 0,
};

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

function bbFmt(n, dec = 2) {
  if (n == null || n === '' || isNaN(n)) return '—';
  if (Math.abs(n) >= 10000) return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function bbPct(n) {
  if (n == null || isNaN(n)) return '—';
  return (n >= 0 ? '+' : '') + Number(n).toFixed(2) + '%';
}

function parseTime(t, period) {
  if (period === '1d' || period === '5d') {
    const d = new Date(t.replace(' ', 'T'));
    return Math.floor(d.getTime() / 1000);
  }
  return t.slice(0, 10);
}

const BB_CHART_FONT = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

function measureChartSize() {
  const stack = document.querySelector('.bb-chart-stack');
  const chartEl = document.getElementById('bbChart');
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
  const h = Math.max(180, stack.clientHeight - volH - rsiH - 2);
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
      background: { color: '#07090e' },
      textColor: '#6d7788',
      fontFamily: BB_CHART_FONT,
      fontSize: 11,
    },
    grid: {
      vertLines: { color: 'rgba(22,28,40,0.55)' },
      horzLines: { color: 'rgba(22,28,40,0.85)' },
    },
    crosshair: {
      mode: crosshairMode,
      vertLine: { color: 'rgba(212,168,83,0.35)', width: 1, style: 2, labelBackgroundColor: '#b8923f' },
      horzLine: { color: 'rgba(212,168,83,0.35)', width: 1, style: 2, labelBackgroundColor: '#b8923f' },
    },
    rightPriceScale: {
      borderColor: '#161c28',
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

function renderCharts(data) {
  const chartEl = document.getElementById('bbChart');
  const volEl = document.getElementById('bbVolChart');
  if (!chartEl || !data?.points?.length) {
    setChartLoading(false);
    return;
  }
  if (typeof LightweightCharts === 'undefined') {
    chartEl.innerHTML = '<p style="padding:1rem;color:var(--bb-muted)">Gráfica no disponible (sin conexión al CDN)</p>';
    setChartLoading(false);
    return;
  }

  destroyCharts();
  chartEl.innerHTML = '';
  const { w, h, volH } = measureChartSize();
  BB.chart = LightweightCharts.createChart(chartEl, chartOpts(h));
  const statusEl = document.getElementById('bbChartStatus');
  if (statusEl) statusEl.textContent = '';
  setChartLoading(false);
  const candles = data.points.map(p => ({
    time: parseTime(p.t, data.period),
    open: p.o, high: p.h, low: p.l, close: p.c,
  }));
  const closes = candles.map(c => ({ time: c.time, value: c.close }));

  if (BB.chartType === 'line') {
    BB.priceSeries = BB.chart.addLineSeries({ color: '#60a5fa', lineWidth: 2, title: 'Cierre' });
    BB.priceSeries.setData(closes);
  } else if (BB.chartType === 'area') {
    BB.priceSeries = BB.chart.addAreaSeries({
      lineColor: '#60a5fa', topColor: 'rgba(96,165,250,0.35)', bottomColor: 'rgba(96,165,250,0.02)',
      lineWidth: 2, title: 'Cierre',
    });
    BB.priceSeries.setData(closes);
  } else {
    BB.candleSeries = BB.chart.addCandlestickSeries({
      upColor: '#2dd4a0', downColor: '#ef5350',
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
  if (desc) desc.textContent = quote?.name || chartData?.name || meta?.name || '';
  const p = quote?.price ?? chartData?.last;
  const pct = quote?.change_pct ?? chartData?.change_pct ?? 0;
  price.textContent = formatQuotePrice(p, kind);
  chg.textContent = bbPct(pct);
  chg.className = 'bb-symbol-chg ' + (pct >= 0 ? 'up' : 'down');

  const dName = document.getElementById('bbDetailName');
  const dPrice = document.getElementById('bbDetailPrice');
  const dChg = document.getElementById('bbDetailChg');
  if (dName) dName.textContent = sym;
  if (dPrice) dPrice.textContent = formatQuotePrice(p, kind);
  if (dChg) {
    dChg.textContent = bbPct(pct);
    dChg.className = 'bb-detail-chg ' + (pct >= 0 ? 'up' : 'down');
  }

  const set = (id, v, fmt = bbFmt) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v != null ? (typeof fmt === 'function' ? fmt(v) : v) : '—';
  };
  if (quote && !quote.error) {
    set('stOpen', quote.open);
    set('stHigh', quote.high);
    set('stLow', quote.low);
    set('stPrev', quote.prev_close);
    set('stVol', quote.volume, v => v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(0)+'K' : String(Math.round(v)));
    if (quote.week52_low != null && quote.week52_high != null)
      set('st52', quote.week52_low, () => bbFmt(quote.week52_low) + ' – ' + bbFmt(quote.week52_high));
    if (quote.dividend_yield != null)
      set('stDivYield', quote.dividend_yield, v => Number(v).toFixed(2) + '%');
    else
      set('stDivYield', null);
    if (quote.ex_dividend_date)
      set('stDivEx', quote.ex_dividend_date);
    else
      set('stDivEx', null);
  }
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
      if (statusEl) statusEl.textContent = `Error ${chartRes.status} al cargar gráfica`;
      setChartLoading(false);
      return;
    }
    const chartData = await chartRes.json();
    if (chartData.error) {
      if (statusEl) statusEl.textContent = chartData.error;
      setChartLoading(false);
    } else {
      if (chartData.period_fallback && statusEl) {
        statusEl.textContent = `Mostrando ${chartData.period} (solicitado: ${chartData.period_requested})`;
      } else if (statusEl) {
        statusEl.textContent = '';
      }
      BB.lastChartData = chartData;
      if (chartData.period) BB.period = chartData.period;
      renderCharts(chartData);
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
        renderNews(news.items || []);
        const newsTag = document.getElementById('bbNewsTag');
        if (newsTag) newsTag.textContent = reqSym;
      })
      .catch(() => {});

    document.querySelectorAll('.bb-watch-row').forEach(r => {
      r.classList.toggle('active', r.dataset.symbol === BB.symbol);
    });
    document.querySelectorAll('.bb-period').forEach(b => {
      b.classList.toggle('active', b.dataset.period === BB.period);
    });
    const cmd = document.getElementById('bbCommand');
    if (cmd) cmd.value = BB.symbol;
  } catch (err) {
    if (loadId === BB._loadId && statusEl) statusEl.textContent = 'Error al cargar gráfica';
    setChartLoading(false);
  }
}

function renderNews(items) {
  const el = document.getElementById('bbNews');
  if (!el) return;
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

  let list = isIndices ? (BB.indicesCatalog || []).filter(i => i.kind === 'index')
    : isFx ? fxCatalogList()
      : (items || BB.catalog);
  if (board !== 'all') list = list.filter(i => i.board === board);
  if (q) list = list.filter(i => i.symbol.includes(q) || (i.name || '').toUpperCase().includes(q));
  list = list.slice(0, 80);

  const holdings = (isIndices || isFx) ? [] : (window.BB_INIT?.holdings || []);

  let html = '';
  if (holdings.length) {
    html += '<div class="bb-watch-divider">Portafolio</div>';
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
    html += '<div class="bb-watch-divider">Mercado</div>';
  }

  const renderRow = (i) => {
    const pr = BB.prices[i.symbol] || i;
    const pct = pr?.change_pct ?? 0;
    const price = pr?.price != null ? formatQuotePrice(pr.price, i.kind) : '';
    const rowCls = isIndices ? 'bb-watch-row--index' : (isFx ? 'bb-watch-row--fx' : '');
    const badge = (isIndices || isFx) && i.board
      ? `<span class="bb-watch-badge bb-watch-badge--${i.board}">${(i.board_title || i.board).slice(0, 4)}</span>` : '';
    return `<button type="button" class="bb-watch-row ${rowCls} ${i.symbol === BB.symbol ? 'active' : ''}" data-symbol="${escHtml(i.symbol)}" data-board="${escHtml(i.board)}">
      ${logoHtml(i.symbol)}
      <span class="bb-watch-sym">${badge}${escHtml(i.symbol)}</span>
      <span class="bb-watch-name">${escHtml((i.name || '').slice(0, 16))}</span>
      <span class="bb-watch-right">${price ? `<span class="bb-watch-price">${price}</span>` : ''}<span class="bb-watch-chg ${pct >= 0 ? 'up' : 'down'}">${bbPct(pct)}</span></span>
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
    row.addEventListener('click', () => loadSymbol(row.dataset.symbol));
  });
  staggerChildren(el, '.bb-watch-row', 'bb-enter');
}

async function searchCatalog(q) {
  try {
    const res = await fetch(`/api/terminal/catalog?q=${encodeURIComponent(q)}&limit=15`);
    const data = await res.json();
    return data.items || [];
  } catch (_) { return []; }
}

function setupCommandBar() {
  const input = document.getElementById('bbCommand');
  const results = document.getElementById('bbCmdResults');
  if (!input || !results) return;

  let timer;
  let cmdSeq = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { results.classList.remove('open'); return; }
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
        items = await searchCatalog(q);
      }
      if (seq !== cmdSeq) return;
      results.innerHTML = items.map((i, idx) => `
        <button type="button" class="bb-cmd-item ${idx === 0 ? 'active' : ''}" data-symbol="${escHtml(i.symbol)}">
          <span class="bb-cmd-sym">${escHtml(i.symbol)}</span>
          <span>${escHtml((i.name || '').slice(0, 32))}</span>
          <span class="bb-cmd-board">${escHtml(i.board_title || '')}</span>
        </button>`).join('');
      results.classList.add('open');
      results.querySelectorAll('.bb-cmd-item').forEach(btn => {
        btn.addEventListener('click', () => {
          loadSymbol(btn.dataset.symbol);
          results.classList.remove('open');
        });
      });
    }, 200);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const sym = input.value.trim().toUpperCase().replace('BMV:', '');
      if (sym) { loadSymbol(sym); results.classList.remove('open'); }
    }
    if (e.key === 'Escape') results.classList.remove('open');
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.bb-cmd-wrap')) results.classList.remove('open');
  });
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
    if ((prev === 'indices' || prev === 'fx') && BB.symbol && !BB.catalog.find(c => c.symbol === BB.symbol)) {
      loadSymbol(window.BB_INIT?.symbol || 'IPC', BB.period);
    }
  }
  refreshTicker();
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}

function setupWorkspaceTabs() {
  let saved = 'market';
  try { saved = localStorage.getItem('bb_workspace') || 'market'; } catch (_) {}
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
      document.getElementById('bbCommand')?.focus();
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
    if (e.key === 'l' || e.key === 'L') document.getElementById('bbLayoutBtn')?.click();
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
      tick.addEventListener('click', () => loadSymbol(tick.dataset.symbol));
    });
  } catch (_) {}
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
    const priceEl = row.querySelector('.bb-watch-price');
    if (!priceEl) return;
    const chgEl = row.querySelector('.bb-watch-chg');
    const kind = q.kind || boardMeta(sym)?.kind;
    priceEl.textContent = formatQuotePrice(q.price, kind);
    if (chgEl) {
      const pct = q.change_pct ?? 0;
      chgEl.textContent = bbPct(pct);
      chgEl.className = 'bb-watch-chg ' + (pct >= 0 ? 'up' : 'down');
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
    ])].filter(Boolean).slice(0, 12);
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
      if (symPrice) {
        symPrice.textContent = formatQuotePrice(q.price, boardMeta(BB.symbol)?.kind);
        if (prevMainPrice != null && q.price !== prevMainPrice) {
          flashEl(symPrice, q.price > prevMainPrice ? 'up' : 'down');
        }
      }
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
    row.addEventListener('click', () => loadSymbol(row.dataset.symbol));
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
}

function initBloombergTerminal(config) {
  BB.symbol = config?.symbol || 'IPC';
  BB.catalog = [];
  window.BB_INIT = config;

  const statusEl = document.getElementById('bbChartStatus');
  if (statusEl) statusEl.textContent = 'Cargando gráfica…';

  renderWatchlist([]);
  loadDefaultCatalog();
  refreshTicker();
  setupCommandBar();
  setupKeyboard();
  setupWorkspaceTabs();
  if (typeof setupTerminalLayout === 'function') setupTerminalLayout();
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
  document.getElementById('bbWatchSearch')?.addEventListener('input', async (e) => {
    const seq = ++watchSearchSeq;
    if (isQuoteWorkspace()) {
      renderWatchlist();
      return;
    }
    const q = e.target.value.trim();
    if (q.length >= 2) {
      const items = await searchCatalog(q);
      if (seq !== watchSearchSeq) return;
      const current = (document.getElementById('bbWatchSearch')?.value || '').trim();
      if (current !== q || isQuoteWorkspace()) return;
      renderWatchlist(items);
    } else {
      renderWatchlist(BB.catalog);
    }
  });
  document.querySelectorAll('.bb-tick[data-symbol]').forEach(tick => {
    tick.addEventListener('click', () => loadSymbol(tick.dataset.symbol));
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
    row.addEventListener('click', () => loadSymbol(row.dataset.symbol));
  });

  document.getElementById('bbTerminal')?.classList.add('bb-ready');
  setupChartResizeObserver();
  dismissFlashBanners();

  document.getElementById('bbCompareBtn')?.addEventListener('click', e => toggleCompare(e.shiftKey));
  document.getElementById('bbCompareBtn')?.addEventListener('contextmenu', e => {
    e.preventDefault();
    toggleCompare(true);
  });

  if (BB.workspace === 'market') {
    loadSymbol(BB.symbol, '6mo');
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
}

let livePollTimer = null;
let clockPollTimer = null;

function stopTerminalPolls() {
  clearInterval(livePollTimer);
  clearInterval(clockPollTimer);
  livePollTimer = clockPollTimer = null;
}

function startTerminalPolls() {
  stopTerminalPolls();
  if (document.hidden) return;
  livePollTimer = setInterval(refreshLive, BB.pollMs);
  clockPollTimer = setInterval(async () => {
    try {
      const res = await fetch('/api/terminal/market');
      updateClock(await res.json());
    } catch (_) {}
  }, 5000);
}

/* Legacy compat */
function loadTerminalChart(sym, per) { loadSymbol(sym, per); }
