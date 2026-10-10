/* Página de análisis por emisora — /emisora/{symbol} */
(function (global) {
  'use strict';

  global.FIN_PAGE = global.FIN_PAGE || {
    finTab: 'resumen',
    finPeriod: 'annual',
    mainView: 'resumen',
    _loadId: 0,
    chartPeriod: '6mo',
    compareIpc: false,
    section_fetched_at: {},
  };

  const CHART_PERIODS = [
    { id: '1mo', label: '1M' },
    { id: '6mo', label: '6M' },
    { id: '1y', label: '1A' },
    { id: '5y', label: '5A' },
  ];

  const MARKET_LABELS = {
    REGULAR: 'Mercado abierto',
    PRE: 'Premercado',
    POST: 'Posmercado',
    POSTPOST: 'Fuera de horario',
    CLOSED: 'Cerrado',
  };

  let emisoraChart = null;
  let emisoraSeries = null;
  let emisoraCandles = null;
  let emisoraCompareSeries = null;
  let emisoraForecastChart = null;

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

  const OFFLINE_MSG = 'Servidor apagado — doble clic en abrir.command (Downloads/Finanzas)';

  async function emisoraFetch(url, ms = 20000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  function emoFmtLarge(n, currency) {
    if (n == null || isNaN(n)) return '—';
    const cur = currency === 'USD' ? 'US$' : '$';
    const abs = Math.abs(n);
    if (abs >= 1e12) return cur + (n / 1e12).toFixed(2) + 'T';
    if (abs >= 1e9) return cur + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return cur + (n / 1e6).toFixed(2) + 'M';
    return cur + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  function updateEmisoraUrl(sym) {
    const st = global.FIN_PAGE;
    const params = new URLSearchParams();
    if (st.mainView && st.mainView !== 'resumen') params.set('view', st.mainView);
    if (st.finTab && st.finTab !== 'resumen' && st.mainView === 'financiero') params.set('tab', st.finTab);
    const q = params.toString();
    history.replaceState(null, '', `/emisora/${encodeURIComponent(sym)}${q ? '?' + q : ''}`);
  }

  function setMainView(view) {
    const id = view || 'resumen';
    global.FIN_PAGE.mainView = id;
    document.querySelectorAll('[data-emo-view]').forEach(el => {
      const on = el.dataset.emoView === id;
      if (el.matches('.bb-emo-view')) {
        el.classList.toggle('active', on);
        el.hidden = !on;
      }
    });
    document.querySelectorAll('#bbEmoMainNav [data-emo-view]').forEach(btn => {
      const on = btn.dataset.emoView === id;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const sym = document.getElementById('bbEmisoraSymbol')?.textContent;
    if (sym) updateEmisoraUrl(sym.replace('BMV:', ''));
    if (id === 'financiero' && typeof finRepaintCharts === 'function') {
      setTimeout(finRepaintCharts, 50);
    }
    if (id === 'previsiones') ensureForecastsLoaded();
    if (id === 'resumen' && emisoraChart) {
      const el = document.getElementById('bbEmisoraChart');
      if (el) emisoraChart.applyOptions({ width: el.clientWidth, height: el.clientHeight || 280 });
    }
  }

  function setupMainNav() {
    document.querySelectorAll('#bbEmoMainNav [data-emo-view]').forEach(btn => {
      btn.addEventListener('click', () => setMainView(btn.dataset.emoView));
    });
    document.querySelectorAll('[data-emo-goto]').forEach(btn => {
      btn.addEventListener('click', () => setMainView(btn.dataset.emoGoto));
    });
  }

  function showEmisoraOffline() {
    const status = document.getElementById('bbFinStatus');
    const chartStatus = document.getElementById('bbEmisoraChartStatus');
    if (status) status.textContent = OFFLINE_MSG;
    if (chartStatus) chartStatus.textContent = OFFLINE_MSG;
    const content = document.getElementById('bbFinContent');
    if (content) content.innerHTML = `<p class="bb-fin-empty">${esc(OFFLINE_MSG)}</p>`;
  }

  function destroyEmisoraChart() {
    if (emisoraChart) {
      emisoraChart.remove();
      emisoraChart = null;
      emisoraSeries = null;
      emisoraCandles = null;
      emisoraCompareSeries = null;
    }
  }

  function destroyForecastChart() {
    if (emisoraForecastChart) {
      emisoraForecastChart.destroy();
      emisoraForecastChart = null;
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
    if (label) {
      const cmp = global.FIN_PAGE.compareIpc ? ' · vs IPC (%)' : '';
      label.textContent = `Precio · ${chartPeriodLabel(period)}${cmp}`;
    }
    const cmpBtn = document.getElementById('bbEmoCompareIpc');
    if (cmpBtn) cmpBtn.classList.toggle('active', !!global.FIN_PAGE.compareIpc);
  }

  function dedupeEmisoraPoints(points) {
    const map = new Map();
    points.forEach((p) => map.set(emisoraParseTime(p.t), p));
    return Array.from(map.values()).sort((a, b) => emisoraParseTime(a.t).localeCompare(emisoraParseTime(b.t)));
  }

  function renderEmisoraChart(data) {
    const el = document.getElementById('bbEmisoraChart');
    const status = document.getElementById('bbEmisoraChartStatus');
    const pts = data?.points?.length ? dedupeEmisoraPoints(data.points) : [];
    global.FIN_PAGE.lastChartData = data;
    if (!el || !pts.length) {
      if (status) status.textContent = data?.error || 'Sin datos de precio';
      return;
    }
    if (typeof global.LightweightCharts === 'undefined') {
      if (status) status.textContent = 'Gráfica no disponible';
      return;
    }
    destroyEmisoraChart();
    el.innerHTML = '';
    const compareOn = !!global.FIN_PAGE.compareIpc;
    const ipcPts = data.compare?.series || [];
    if (status) {
      if (data.stale) status.textContent = 'Datos limitados (caché)';
      else if (compareOn && !ipcPts.length) status.textContent = 'IPC no disponible en este periodo';
      else status.textContent = '';
    }
    const w = el.clientWidth || 600;
    const h = el.clientHeight || 280;
    const useCandles = !compareOn && !data.stale && pts.length >= 12 && pts.some(p => p.h !== p.l);
    emisoraChart = global.LightweightCharts.createChart(el, {
      width: w,
      height: h,
      layout: { background: { color: '#07090e' }, textColor: '#6d7788', fontSize: 11 },
      grid: { vertLines: { color: 'rgba(22,28,40,0.55)' }, horzLines: { color: 'rgba(22,28,40,0.85)' } },
      rightPriceScale: { borderColor: '#161c28' },
      timeScale: { borderColor: '#161c28', timeVisible: true },
      crosshair: { mode: 1 },
    });
    if (compareOn) {
      const base = pts[0].c;
      emisoraSeries = emisoraChart.addLineSeries({
        color: '#60a5fa',
        lineWidth: 2,
        title: data.symbol || 'Emisora',
        priceFormat: { type: 'custom', formatter: v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` },
      });
      emisoraSeries.setData(pts.map(p => ({
        time: emisoraParseTime(p.t),
        value: base ? ((p.c / base) - 1) * 100 : 0,
      })));
      if (ipcPts.length) {
        emisoraCompareSeries = emisoraChart.addLineSeries({
          color: '#a78bfa',
          lineWidth: 1.5,
          title: 'IPC',
          priceFormat: { type: 'custom', formatter: v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` },
        });
        emisoraCompareSeries.setData(ipcPts.map(p => ({
          time: emisoraParseTime(p.t),
          value: p.cmp_pct,
        })));
      }
    } else if (useCandles) {
      emisoraCandles = emisoraChart.addCandlestickSeries({
        upColor: '#2dd4a0', downColor: '#ef5350',
        borderUpColor: '#2dd4a0', borderDownColor: '#ef5350',
        wickUpColor: '#2dd4a0', wickDownColor: '#ef5350',
      });
      emisoraCandles.setData(pts.map(p => ({
        time: emisoraParseTime(p.t),
        open: p.o, high: p.h, low: p.l, close: p.c,
      })));
    } else {
      emisoraSeries = emisoraChart.addAreaSeries({
        lineColor: '#60a5fa',
        topColor: 'rgba(96,165,250,0.35)',
        bottomColor: 'rgba(96,165,250,0.02)',
        lineWidth: 2,
      });
      emisoraSeries.setData(pts.map(p => ({ time: emisoraParseTime(p.t), value: p.c })));
    }
    emisoraChart.timeScale().fitContent();
  }

  async function loadEmisoraChart(symbol, period) {
    const sym = (symbol || '').replace('BMV:', '').toUpperCase();
    let url = `/api/terminal/chart?symbol=${encodeURIComponent(sym)}&period=${encodeURIComponent(period)}`;
    if (global.FIN_PAGE.compareIpc) url += '&compare=IPC';
    const res = await emisoraFetch(url);
    return res.ok ? res.json() : {};
  }

  async function reloadEmisoraChart() {
    const sym = document.getElementById('bbEmisoraSymbol')?.textContent;
    if (!sym) return;
    const status = document.getElementById('bbEmisoraChartStatus');
    if (status) status.textContent = 'Cargando…';
    const data = await loadEmisoraChart(sym, global.FIN_PAGE.chartPeriod || '6mo');
    renderEmisoraChart(data);
    updateChartPeriodUI(global.FIN_PAGE.chartPeriod);
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

  function paintQuoteStrip(quote) {
    const box = document.getElementById('bbEmoQuoteStrip');
    if (!box || !quote?.price) { if (box) box.hidden = true; return; }
    box.hidden = false;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('emoQOpen', emisoraFmtPrice(quote.open));
    set('emoQHigh', emisoraFmtPrice(quote.high));
    set('emoQLow', emisoraFmtPrice(quote.low));
    set('emoQVol', quote.volume != null
      ? (quote.volume >= 1e6 ? (quote.volume / 1e6).toFixed(1) + 'M' : Math.round(quote.volume))
      : '—');
    const bid = quote.bid != null ? emisoraFmtPrice(quote.bid) : '—';
    const ask = quote.ask != null ? emisoraFmtPrice(quote.ask) : '—';
    set('emoQBid', `${bid} / ${ask}`);
  }

  function paint52Range(quote, tech) {
    const box = document.getElementById('bbEmoRange52');
    const lo = quote?.week52_low ?? tech?.low_52w;
    const hi = quote?.week52_high ?? tech?.high_52w;
    const px = quote?.price ?? tech?.last;
    if (!box || lo == null || hi == null || px == null || hi <= lo) {
      if (box) box.hidden = true;
      return;
    }
    box.hidden = false;
    const loEl = document.getElementById('bbEmoRangeLo');
    const hiEl = document.getElementById('bbEmoRangeHi');
    const mark = document.getElementById('bbEmoRangeMark');
    if (loEl) loEl.textContent = emisoraFmtPrice(lo);
    if (hiEl) hiEl.textContent = emisoraFmtPrice(hi);
    if (mark) mark.style.left = Math.min(100, Math.max(0, ((px - lo) / (hi - lo)) * 100)) + '%';
  }

  function analystBars(counts) {
    if (!counts) return '';
    const rows = [
      ['Compra fuerte', counts.strongBuy, '#2dd4a0'],
      ['Compra', counts.buy, '#34d399'],
      ['Mantener', counts.hold, '#8b95a8'],
      ['Venta', counts.sell, '#f87171'],
      ['Venta fuerte', counts.strongSell, '#ef5350'],
    ];
    const max = Math.max(1, ...rows.map(r => r[1] || 0));
    return `<div class="bb-emo-an-bars">${rows.map(([label, n, color]) => {
      const w = ((n || 0) / max) * 100;
      return `<div class="bb-emo-an-row"><span>${esc(label)}</span><div class="bb-emo-an-track"><i style="width:${w}%;background:${color}"></i></div><em>${n || 0}</em></div>`;
    }).join('')}</div>`;
  }

  function renderEmisoraOverview(o) {
    global.FIN_PAGE.lastOverview = o;
    const box = document.getElementById('bbEmoOverview');
    if (!box) return;
    if (!o || o.error) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const kf = o.key_facts || {};
    const facts = [
      ['Cap. bursátil', emoFmtLarge(kf.market_cap, o.currency)],
      ['Dividendo', kf.dividend_yield_pct != null ? `${Number(kf.dividend_yield_pct).toFixed(2)}%` : '—'],
      ['P/E (TTM)', kf.pe_ttm != null ? Number(kf.pe_ttm).toFixed(2) : '—'],
      ['P/B', kf.price_to_book != null ? Number(kf.price_to_book).toFixed(2) : '—'],
      ['UTPA', kf.eps_ttm != null ? emisoraFmtPrice(kf.eps_ttm) : '—'],
      ['Margen neto', kf.profit_margin_pct != null ? `${kf.profit_margin_pct}%` : '—'],
      ['ROE', kf.roe_pct != null ? `${kf.roe_pct}%` : '—'],
      ['Empleados', kf.employees ? (kf.employees >= 1000 ? `${Math.round(kf.employees / 1000)}K` : kf.employees) : '—'],
    ];
    const factsEl = document.getElementById('bbEmoFacts');
    if (factsEl) {
      factsEl.innerHTML = facts.map(([label, val]) =>
        `<div class="bb-emo-fact"><span>${esc(label)}</span><strong>${esc(val)}</strong></div>`
      ).join('');
    }

    const tech = o.technicals || {};
    const techEl = document.getElementById('bbEmoTechnical');
    if (techEl) {
      if (!tech.available) {
        techEl.innerHTML = '<h4>Rendimiento y señales</h4><p class="bb-fin-empty">Sin historial suficiente</p>';
      } else {
        const perfRows = (tech.performance || []).map(p => {
          const cls = (p.pct ?? 0) >= 0 ? 'up' : 'down';
          return `<div class="bb-emo-perf-cell ${cls}"><span>${esc(p.id)}</span><strong>${p.pct != null ? emisoraPct(p.pct) : '—'}</strong></div>`;
        }).join('');
        const signals = (tech.signals || []).map(s =>
          `<li class="${s.vote > 0 ? 'up' : s.vote < 0 ? 'down' : ''}"><span>${esc(s.label)}</span><em>${esc(s.detail)}</em></li>`
        ).join('');
        techEl.innerHTML = `
          <h4>Rendimiento y señales · <span class="${tech.gauge >= 0 ? 'up' : 'down'}">${esc(tech.verdict || '—')}</span></h4>
          <div class="bb-emo-perf-grid">${perfRows}</div>
          <div class="bb-emo-tech-meta">RSI ${tech.rsi14 ?? '—'} · Vol anual ${tech.volatility_pct != null ? tech.volatility_pct + '%' : '—'} · MA20 ${tech.sma20 ?? '—'} · MA50 ${tech.sma50 ?? '—'}</div>
          <ul class="bb-emo-signals">${signals}</ul>`;
      }
    }
    renderTechnicalFull(o);

    const an = o.analysts;
    const anEl = document.getElementById('bbEmoAnalysts');
    if (anEl) {
      if (!an?.target_mean) {
        anEl.innerHTML = '<h4>Previsiones de analistas</h4><p class="bb-fin-empty">Sin consenso publicado</p>';
      } else {
        const upside = an.upside_pct != null ? emisoraPct(an.upside_pct) : '—';
        anEl.innerHTML = `
          <h4>${esc(an.recommendation || 'Consenso')}</h4>
          <div class="bb-emo-an-target">Objetivo <strong>${emoFmtLarge(an.target_mean, o.currency)}</strong> <span class="${(an.upside_pct ?? 0) >= 0 ? 'up' : 'down'}">${upside}</span></div>
          <div class="bb-emo-tech-meta">${an.count ? an.count + ' analistas' : ''}${an.target_low && an.target_high ? ` · ${emoFmtLarge(an.target_low, o.currency)} – ${emoFmtLarge(an.target_high, o.currency)}` : ''}</div>
          ${analystBars(an.counts)}`;
      }
    }

    const health = o.health || {};
    const hEl = document.getElementById('bbEmoHealth');
    if (hEl) {
      const checks = (health.checks || []).slice(0, 6);
      hEl.innerHTML = `
        <h4>Salud · ${health.passed ?? 0}/${health.total ?? 0}</h4>
        <ul class="bb-emo-health">${checks.map(c =>
          `<li class="${c.ok ? 'ok' : 'bad'}">${esc(c.label)} <span>${esc(c.value)}</span></li>`
        ).join('')}</ul>`;
    }

    const prof = o.profile || {};
    const profEl = document.getElementById('bbEmoProfile');
    if (profEl && prof.summary) {
      profEl.hidden = false;
      profEl.textContent = prof.summary.length > 520 ? prof.summary.slice(0, 517) + '…' : prof.summary;
    } else if (profEl) profEl.hidden = true;

    const about = document.getElementById('bbEmoAbout');
    if (about) {
      const bits = [];
      if (prof.ceo) bits.push(`<div><span>CEO</span><strong>${esc(prof.ceo)}</strong></div>`);
      if (prof.industry) bits.push(`<div><span>Industria</span><strong>${esc(prof.industry)}</strong></div>`);
      if (prof.city || prof.country) bits.push(`<div><span>Sede</span><strong>${esc([prof.city, prof.country].filter(Boolean).join(', '))}</strong></div>`);
      if (prof.website) bits.push(`<div><span>Web</span><a href="${esc(prof.website)}" target="_blank" rel="noopener">${esc(prof.website.replace(/^https?:\/\//, ''))}</a></div>`);
      if (bits.length) {
        about.hidden = false;
        about.innerHTML = bits.join('');
      } else about.hidden = true;
    }
  }

  function renderTechnicalFull(o) {
    const el = document.getElementById('bbEmoTechFull');
    if (!el) return;
    const tech = o?.technicals;
    if (!tech?.available) {
      el.innerHTML = '<p class="bb-fin-empty">Sin datos técnicos para esta emisora.</p>';
      return;
    }
    const gaugePct = Math.round(((tech.gauge ?? 0) + 1) / 2 * 100);
    const perfTable = (tech.performance || []).map(p =>
      `<tr><td>${esc(p.id)}</td><td class="${(p.pct ?? 0) >= 0 ? 'up' : 'down'}">${p.pct != null ? emisoraPct(p.pct) : '—'}</td></tr>`
    ).join('');
    const signals = (tech.signals || []).map(s =>
      `<tr><td>${esc(s.label)}</td><td class="${s.vote > 0 ? 'up' : s.vote < 0 ? 'down' : ''}">${esc(s.detail)}</td></tr>`
    ).join('');
    el.innerHTML = `
      <div class="bb-emo-tech-hero">
        <div class="bb-emo-gauge">
          <div class="bb-emo-gauge-bar"><i style="width:${gaugePct}%"></i></div>
          <strong class="${tech.gauge >= 0 ? 'up' : 'down'}">${esc(tech.verdict)}</strong>
          <span>Señal agregada (${tech.score}/${tech.score_max})</span>
        </div>
        <div class="bb-emo-tech-kpis">
          <div><span>RSI (14)</span><strong>${tech.rsi14 ?? '—'}</strong></div>
          <div><span>Volatilidad</span><strong>${tech.volatility_pct != null ? tech.volatility_pct + '%' : '—'}</strong></div>
          <div><span>52 sem</span><strong>${tech.range_pos_pct != null ? tech.range_pos_pct + '% del rango' : '—'}</strong></div>
          <div><span>MA200</span><strong>${tech.sma200 ?? '—'}</strong></div>
        </div>
      </div>
      <div class="bb-emo-tech-tables">
        <div><h4>Rendimiento</h4><table class="bb-emo-table"><tbody>${perfTable}</tbody></table></div>
        <div><h4>Señales</h4><table class="bb-emo-table"><tbody>${signals}</tbody></table></div>
      </div>`;
  }

  function updateEmisoraHero(quote, overview) {
    const priceEl = document.getElementById('bbEmisoraPrice');
    const chgEl = document.getElementById('bbEmisoraChg');
    const nameEl = document.getElementById('bbEmisoraName');
    const metaEl = document.getElementById('bbEmisoraMeta');
    const badge = document.getElementById('bbEmoBadge');
    const timeEl = document.getElementById('bbEmoMarketTime');
    const q = quote || {};
    const o = overview || {};
    if (nameEl) nameEl.textContent = q.name || o.name || nameEl.textContent;
    if (badge) badge.textContent = MARKET_LABELS[o.market_state] || o.market_state || '';
    if (metaEl) {
      const parts = [];
      if (o.exchange) parts.push(o.exchange);
      else if (q.board_title) parts.push(q.board_title);
      const sector = o.profile?.sector || q.fundamentals?.sector;
      if (sector) parts.push(sector);
      metaEl.textContent = parts.join(' · ');
    }
    const px = q.price ?? o.price;
    const pct = q.change_pct ?? o.change_pct ?? 0;
    const cur = o.currency || q.currency || 'MXN';
    if (priceEl) {
      priceEl.textContent = cur === 'MXN' ? emisoraFmtPrice(px) : `${cur} ${Number(px).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
    }
    if (chgEl) {
      chgEl.textContent = emisoraPct(pct);
      chgEl.className = 'bb-emisora-chg ' + (pct >= 0 ? 'up' : 'down');
    }
    if (timeEl) {
      const t = o.market_time ? `Última cotización · ${o.market_time}` : '';
      timeEl.textContent = t;
    }
    paintQuoteStrip(q);
    paint52Range(q, o.technicals);
  }

  async function ensureForecastsLoaded() {
    const sym = document.getElementById('bbEmisoraSymbol')?.textContent?.replace('BMV:', '');
    if (!sym) return;
    const st = global.FIN_PAGE;
    if (!finSectionLoaded(st.lastFinancials, 'beneficios')) {
      const box = document.getElementById('bbEmoForecasts');
      if (box) box.innerHTML = '<p class="bb-fin-empty">Cargando beneficios trimestrales…</p>';
      try {
        if (typeof loadFinSection === 'function') {
          st.lastFinancials = await loadFinSection(sym, 'beneficios');
        }
      } catch (_) { /* render with what we have */ }
    }
    renderForecasts(st.lastOverview, st.lastFinancials, st.lastQuote);
  }

  function renderForecasts(overview, fin, quote) {
    const box = document.getElementById('bbEmoForecasts');
    if (!box) return;
    const o = overview || {};
    const earn = fin?.earnings || {};
    const cur = fin?.currency || o.currency || quote?.currency || 'MXN';
    const an = o.analysts;
    const rows = (earn.quarterly || []).slice(-12);
    const nextDate = earn.next_report_date;
    const fwd = earn.forward_eps;
    const trail = earn.trailing_eps;

    let analystBlock = '<p class="bb-fin-empty">Sin objetivos de analistas para esta emisora.</p>';
    if (an?.target_mean) {
      const upside = an.upside_pct != null ? emisoraPct(an.upside_pct) : '—';
      const px = quote?.price ?? o.price;
      analystBlock = `
        <div class="bb-emo-fc-analyst">
          <div class="bb-emo-fc-head">
            <div>
              <h3>Objetivo de consenso</h3>
              <p class="bb-emo-an-target"><strong>${emoFmtLarge(an.target_mean, cur)}</strong>
                <span class="${(an.upside_pct ?? 0) >= 0 ? 'up' : 'down'}">${upside}</span>
                ${px ? `<small>vs ${emisoraFmtPrice(px)} actual</small>` : ''}</p>
            </div>
            <div class="bb-emo-fc-rec"><span>Recomendación</span><strong>${esc(an.recommendation || '—')}</strong></div>
          </div>
          <div class="bb-emo-fc-range">
            <span>Bajo ${emoFmtLarge(an.target_low, cur)}</span>
            <span>Medio ${emoFmtLarge(an.target_median || an.target_mean, cur)}</span>
            <span>Alto ${emoFmtLarge(an.target_high, cur)}</span>
          </div>
          ${analystBars(an.counts)}
          ${an.converted_from ? `<p class="bb-fin-note">${esc(an.converted_from)}</p>` : ''}
        </div>`;
    }

    let epsBlock = '<p class="bb-fin-empty">Sin historial trimestral de utilidad por acción en Yahoo.</p>';
    if (rows.length) {
      const labels = rows.map(r => r.period || (r.date || '').slice(0, 7));
      const reported = rows.map(r => r.reported_eps);
      const estimate = rows.map(r => r.estimate_eps);
      const table = rows.map(r => {
        const sur = r.surprise_pct;
        const cls = sur == null ? '' : (sur >= 0 ? 'up' : 'down');
        return `<tr>
          <td>${esc(r.period || r.date || '')}</td>
          <td>${r.reported_eps != null ? Number(r.reported_eps).toFixed(2) : '—'}</td>
          <td>${r.estimate_eps != null ? Number(r.estimate_eps).toFixed(2) : '—'}</td>
          <td class="${cls}">${sur != null ? (sur >= 0 ? '+' : '') + Number(sur).toFixed(2) + '%' : '—'}</td>
        </tr>`;
      }).join('');
      epsBlock = `
        <div class="bb-emo-fc-eps">
          <div class="bb-emo-fc-eps-head">
            <h3>Beneficio por acción (trimestral)</h3>
            <div class="bb-emo-fc-eps-kpis">
              <span>BPA trailing <strong>${trail != null ? Number(trail).toFixed(2) : '—'}</strong></span>
              <span>BPA forward <strong>${fwd != null ? Number(fwd).toFixed(2) : '—'}</strong></span>
            </div>
          </div>
          <div class="bb-fin-chart-box"><canvas id="bbEmoEpsChart" height="120"></canvas></div>
          <div class="bb-fin-table-wrap"><table class="bb-fin-table bb-fin-table--earnings">
            <thead><tr><th>Periodo</th><th>Informado</th><th>Estimado</th><th>Sorpresa</th></tr></thead>
            <tbody>${table}</tbody>
          </table></div>
        </div>`;
      box.innerHTML = `
        <div class="bb-emo-fc-grid">
          ${analystBlock}
          <div class="bb-emo-fc-next">${nextDate
            ? `<h3>Próximo reporte</h3><p><strong>${esc(nextDate)}</strong>${fwd != null ? ` · UTPA est. ${Number(fwd).toFixed(2)} ${esc(cur)}` : ''}</p>`
            : '<h3>Calendario</h3><p class="bb-fin-empty">Fecha de reporte no publicada en Yahoo.</p>'}</div>
        </div>
        ${epsBlock}`;
      mountForecastEpsChart(labels, reported, estimate);
    } else {
      box.innerHTML = `
        <div class="bb-emo-fc-grid">${analystBlock}
          <div class="bb-emo-fc-next">${nextDate
            ? `<h3>Próximo reporte</h3><p><strong>${esc(nextDate)}</strong></p>`
            : ''}</div>
        </div>${epsBlock}`;
    }
  }

  function mountForecastEpsChart(labels, reported, estimate) {
    destroyForecastChart();
    if (typeof Chart === 'undefined') return;
    const canvas = document.getElementById('bbEmoEpsChart');
    if (!canvas) return;
    emisoraForecastChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Informado', data: reported, backgroundColor: 'rgba(96, 165, 250, 0.85)', borderRadius: 2 },
          { label: 'Estimado', data: estimate, backgroundColor: 'rgba(109, 119, 136, 0.55)', borderRadius: 2 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#8b95a8', font: { size: 10 } } } },
        scales: {
          x: { ticks: { color: '#6d7788', font: { size: 9 } }, grid: { color: 'rgba(22,28,40,0.5)' } },
          y: { ticks: { color: '#6d7788', font: { size: 9 } }, grid: { color: 'rgba(22,28,40,0.5)' } },
        },
      },
    });
  }

  function setupCompareIpc() {
    const btn = document.getElementById('bbEmoCompareIpc');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      global.FIN_PAGE.compareIpc = !global.FIN_PAGE.compareIpc;
      updateChartPeriodUI(global.FIN_PAGE.chartPeriod);
      await reloadEmisoraChart();
    });
  }

  function renderEmisoraNews(items, targetId, limit) {
    const el = document.getElementById(targetId);
    if (!el) return;
    const slice = (items || []).slice(0, limit || 12);
    if (!slice.length) {
      el.innerHTML = '<p class="bb-news-empty">Sin noticias recientes</p>';
      return;
    }
    el.innerHTML = slice.map(n => `
      <a class="bb-news-item" href="${esc(n.url)}" target="_blank" rel="noopener">
        <div class="bb-news-title">${esc(n.title)}</div>
        <div class="bb-news-meta">${esc(n.source || n.publisher || '')}</div>
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
    updateEmisoraUrl(sym);

    const logo = document.getElementById('bbEmisoraLogo');
    if (logo) {
      logo.src = `/api/terminal/logo/${encodeURIComponent(sym)}`;
      logo.style.display = '';
      logo.parentElement?.classList.remove('bb-watch-logo-wrap--fb');
    }

    const period = global.FIN_PAGE.chartPeriod || '6mo';
    updateChartPeriodUI(period);

    try {
      const [chartData, quoteRes, holdingRes, overviewRes] = await Promise.all([
        loadEmisoraChart(sym, period),
        emisoraFetch(`/api/terminal/quote?symbol=${encodeURIComponent(sym)}`),
        emisoraFetch(`/api/terminal/holding?symbol=${encodeURIComponent(sym)}`),
        emisoraFetch(`/api/emisora/overview?symbol=${encodeURIComponent(sym)}`, 45000),
      ]);
      if (loadId !== global.FIN_PAGE._loadId) return;

      const quote = quoteRes.ok ? await quoteRes.json() : {};
      const holdingData = holdingRes.ok ? await holdingRes.json() : {};
      const overview = overviewRes.ok ? await overviewRes.json() : {};
      if (overview.key_facts && quote.market_cap && !overview.key_facts.market_cap) {
        overview.key_facts.market_cap = quote.market_cap;
      }

      renderEmisoraChart(chartData);
      renderEmisoraOverview(overview);
      updateEmisoraHero(quote, overview);
      renderHoldingWidget(holdingData.holding);
      global.FIN_PAGE.lastQuote = { ...overview, ...quote, price: quote.price ?? overview.price };

      fetch(`/api/terminal/news?limit=20&symbol=${encodeURIComponent(sym)}`)
        .then(r => r.json())
        .then(d => {
          if (loadId !== global.FIN_PAGE._loadId) return;
          const items = d.items || [];
          renderEmisoraNews(items, 'bbEmisoraNews', 4);
          renderEmisoraNews(items, 'bbEmisoraNewsFull', 20);
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

      const finRes = await emisoraFetch(`/api/terminal/financials?symbol=${encodeURIComponent(sym)}&section=resumen`);
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
        } catch (_) { /* fallback */ }
      }
      if (typeof renderFinHub === 'function') {
        renderFinHub(global.FIN_PAGE.lastQuote, global.FIN_PAGE.lastFinancials, global.FIN_PAGE.finTab);
      }
      if (global.FIN_PAGE.mainView === 'financiero') setTimeout(() => { if (typeof finRepaintCharts === 'function') finRepaintCharts(); }, 200);
      if (global.FIN_PAGE.mainView === 'previsiones') renderForecasts(overview, global.FIN_PAGE.lastFinancials, global.FIN_PAGE.lastQuote);
    } catch (err) {
      showEmisoraOffline();
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
        global.FIN_PAGE.chartPeriod = period;
        await reloadEmisoraChart();
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
      const res = await fetch(`/api/terminal/catalog?q=${encodeURIComponent(q)}&limit=8&remote=1`);
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
    global.FIN_PAGE.mainView = config?.view || 'resumen';
    global.FIN_PAGE.chartPeriod = config?.chartPeriod || '6mo';
    setupMainNav();
    setupEmisoraSearch();
    setupChartPeriodSelector();
    setupCompareIpc();
    setMainView(global.FIN_PAGE.mainView);
    if (global.FIN_PAGE.mainView === 'financiero' && global.FIN_PAGE.finTab !== 'resumen') {
      /* loadEmisoraSymbol will fetch the right fin section */
    }
    loadEmisoraSymbol(config?.symbol || 'GFNORTEO', global.FIN_PAGE.finTab);
    global.addEventListener('resize', () => {
      if (emisoraChart) {
        const el = document.getElementById('bbEmisoraChart');
        if (el) emisoraChart.applyOptions({ width: el.clientWidth, height: el.clientHeight || 280 });
      }
      if (typeof finRepaintCharts === 'function') finRepaintCharts();
    });
  }

  global.bootEmisoraPage = bootEmisoraPage;
  global.setEmisoraMainView = setMainView;
})(window);
