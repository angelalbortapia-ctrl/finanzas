const C = {
  text: '#6d7788',
  grid: 'rgba(42,49,64,0.8)',
  accent: '#d4a853',
  good: '#34d399',
  bad: '#f87171',
  tooltipBg: '#1c222d',
  tooltipTitle: '#eef1f6',
  tooltipBody: '#b4bcc9',
  tooltipBorder: '#2a3140',
  legend: '#6d7788',
  donutTrack: 'rgba(42,49,64,0.9)',
};

window.__charts = [];

function chartDefaults() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'index' },
    animation: { duration: 1000, easing: 'easeOutQuart' },
    plugins: {
      legend: {
        labels: {
          color: C.legend,
          font: { family: 'Manrope', size: 11, weight: '600' },
          padding: 12, usePointStyle: true, boxWidth: 8,
        },
      },
      tooltip: {
        backgroundColor: C.tooltipBg,
        titleColor: C.tooltipTitle,
        bodyColor: C.tooltipBody,
        borderColor: C.tooltipBorder,
        borderWidth: 1,
        padding: 12, cornerRadius: 10,
      },
    },
    scales: {
      x: {
        ticks: { color: C.text, font: { size: 10 } },
        grid: { display: false },
        border: { display: false },
      },
      y: {
        ticks: {
          color: C.text, font: { size: 10 },
          callback: v => '$' + Number(v).toLocaleString(),
        },
        grid: { color: C.grid, drawTicks: false },
        border: { display: false },
      },
    },
  };
}

function donutDefaults() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '72%',
    animation: { animateRotate: true, duration: 1000 },
    plugins: { legend: { display: false }, tooltip: chartDefaults().plugins.tooltip },
  };
}

function patrimonyMonthLabels(rows) {
  const short = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return rows.map((r) => {
    if (r.month && r.year) {
      const m = short[(r.month - 1) % 12] || '?';
      return `${m} '${String(r.year).slice(-2)}`;
    }
    const parts = String(r.label || '').split(' ');
    if (parts.length >= 2) {
      return `${parts[0].slice(0, 3)} '${String(parts[1]).slice(-2)}`;
    }
    return r.label || '';
  });
}

const PAT_ASSET_LAYERS = [
  { key: 'gbm', label: 'GBM', color: 'rgba(212, 168, 83, 0.88)' },
  { key: 'afore', label: 'Afore', color: 'rgba(96, 165, 250, 0.82)' },
  { key: 'ppr', label: 'PPR', color: 'rgba(167, 139, 250, 0.8)' },
  { key: 'business', label: 'Negocio', color: 'rgba(52, 211, 153, 0.75)' },
  { key: 'infonavit', label: 'Infonavit', color: 'rgba(148, 163, 184, 0.72)' },
];

function patMoney(n, signed = false) {
  const v = Number(n) || 0;
  const abs = Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (!signed) return '$' + abs;
  return (v >= 0 ? '+' : '−') + '$' + abs;
}

function patYTick(v) {
  const n = Number(v);
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1000) return '$' + Math.round(n / 1000) + 'k';
  return '$' + n;
}

function patrimonyInsights(rows) {
  const nets = rows.map((r) => r.net_worth);
  const assets = rows.map((r) => r.assets);
  const debts = rows.map((r) => r.debt);
  const last = nets[nets.length - 1];
  const prev = nets.length >= 2 ? nets[nets.length - 2] : last;
  const first = nets[0];
  const mom = last - prev;
  const momPct = prev ? (mom / Math.abs(prev)) * 100 : 0;
  const period = last - first;
  const periodPct = first ? (period / Math.abs(first)) * 100 : 0;
  let peak = { i: 0, v: nets[0] };
  let trough = { i: 0, v: nets[0] };
  nets.forEach((v, i) => {
    if (v > peak.v) peak = { i, v };
    if (v < trough.v) trough = { i, v };
  });
  const lastRow = rows[rows.length - 1];
  const prevRow = rows.length >= 2 ? rows[rows.length - 2] : lastRow;
  const debtRatio = lastRow.assets > 0 ? (lastRow.debt / lastRow.assets) * 100 : 0;
  const debtMom = lastRow.debt - prevRow.debt;
  const assetMom = lastRow.assets - prevRow.assets;
  const deltas = nets.map((v, i) => (i === 0 ? 0 : v - nets[i - 1]));
  const debtDeltas = debts.map((v, i) => (i === 0 ? 0 : v - debts[i - 1]));
  const fromPeak = last - peak.v;
  const fromPeakPct = peak.v ? (fromPeak / Math.abs(peak.v)) * 100 : 0;
  const months = rows.length;
  const avgDelta = months > 1 ? period / (months - 1) : 0;
  const layers = PAT_ASSET_LAYERS
    .map((l) => ({ ...l, v: Number(lastRow[l.key]) || 0 }))
    .filter((l) => l.v > 0)
    .sort((a, b) => b.v - a.v);
  const topAsset = layers[0] || null;
  const topAssetPct = lastRow.assets && topAsset ? (topAsset.v / lastRow.assets) * 100 : 0;
  return {
    last, mom, momPct, period, periodPct, peak, trough, debtRatio, deltas, debtDeltas,
    lastRow, prevRow, nets, assets, debts, fromPeak, fromPeakPct, avgDelta,
    topAsset, topAssetPct, layers,
  };
}

function patrimonyNarrative(rows, ins) {
  const lines = [];
  const dir = ins.mom >= 0 ? 'subió' : 'bajó';
  lines.push(
    `Patrimonio neto ${dir} ${patMoney(ins.mom, true)} este mes (${ins.momPct >= 0 ? '+' : ''}${ins.momPct.toFixed(1)}%). ` +
    `Estás a ${patMoney(ins.fromPeak, true)} del pico (${rows[ins.peak.i]?.label || ''}).`
  );
  if (Math.abs(ins.debtMom) > 500) {
    const dDir = ins.debtMom >= 0 ? 'aumentó' : 'bajó';
    lines.push(`Deuda TC ${dDir} ${patMoney(ins.debtMom, true)} vs mes anterior (${ins.debtRatio.toFixed(0)}% de activos).`);
  }
  if (ins.topAsset && ins.topAssetPct >= 5) {
    lines.push(`${ins.topAsset.label} concentra ${ins.topAssetPct.toFixed(0)}% de tus activos (${patMoney(ins.topAsset.v)}).`);
  }
  if (Math.abs(ins.avgDelta) > 300 && rows.length >= 4) {
    const trend = ins.avgDelta >= 0 ? 'crecimiento' : 'contracción';
    lines.push(`Promedio mensual del periodo: ${patMoney(ins.avgDelta, true)} (${trend}).`);
  }
  return lines;
}

function renderPatrimonyNarrative(el, rows, ins) {
  if (!el || !rows?.length) return;
  const lines = patrimonyNarrative(rows, ins);
  el.innerHTML = lines.map((t) => `<p class="pat-narrative-line">${t}</p>`).join('');
}

function renderPatrimonyComposition(el, row, layers) {
  if (!el || !row) return;
  const total = Number(row.assets) || 0;
  if (total <= 0) { el.innerHTML = ''; return; }
  const segs = (layers || PAT_ASSET_LAYERS.map((l) => ({ ...l, v: Number(row[l.key]) || 0 })))
    .filter((l) => l.v > 0);
  const bar = segs.map((l) => {
    const pct = (l.v / total) * 100;
    return `<span class="pat-comp-seg" style="width:${pct}%;background:${l.color}" title="${l.label}: ${patMoney(l.v)} (${pct.toFixed(0)}%)"></span>`;
  }).join('');
  const legend = segs.map((l) => {
    const pct = (l.v / total) * 100;
    return `<span class="pat-comp-item"><i style="background:${l.color}"></i>${l.label} <b>${pct.toFixed(0)}%</b></span>`;
  }).join('');
  el.innerHTML = `<div class="pat-comp-bar">${bar}</div><div class="pat-comp-legend">${legend}</div>`;
}

function renderPatrimonyStats(el, rows, compact) {
  if (!el || !rows?.length) return;
  const ins = patrimonyInsights(rows);
  const cls = (n) => (n >= 0 ? 'good' : 'bad');
  const pct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

  if (compact) {
    el.innerHTML = `
      <div class="pat-stat"><span class="pat-stat-k">Neto actual</span><strong class="pat-stat-v accent">${patMoney(ins.last)}</strong></div>
      <div class="pat-stat"><span class="pat-stat-k">vs mes anterior</span><strong class="pat-stat-v ${cls(ins.mom)}">${patMoney(ins.mom, true)}</strong><small>${pct(ins.momPct)}</small></div>
      <div class="pat-stat"><span class="pat-stat-k">Δ deuda TC</span><strong class="pat-stat-v ${cls(-ins.debtMom)}">${patMoney(ins.debtMom, true)}</strong></div>
      <div class="pat-stat"><span class="pat-stat-k">Deuda / activos</span><strong class="pat-stat-v ${ins.debtRatio > 55 ? 'bad' : ''}">${ins.debtRatio.toFixed(0)}%</strong></div>`;
    return;
  }

  el.innerHTML = `
    <div class="pat-stat"><span class="pat-stat-k">Patrimonio neto</span><strong class="pat-stat-v accent">${patMoney(ins.last)}</strong></div>
    <div class="pat-stat"><span class="pat-stat-k">Δ mes</span><strong class="pat-stat-v ${cls(ins.mom)}">${patMoney(ins.mom, true)}</strong><small>${pct(ins.momPct)}</small></div>
    <div class="pat-stat"><span class="pat-stat-k">Δ periodo</span><strong class="pat-stat-v ${cls(ins.period)}">${patMoney(ins.period, true)}</strong><small>${pct(ins.periodPct)}</small></div>
    <div class="pat-stat"><span class="pat-stat-k">vs pico</span><strong class="pat-stat-v ${cls(ins.fromPeak)}">${patMoney(ins.fromPeak, true)}</strong><small>${rows[ins.peak.i]?.label || ''}</small></div>
    <div class="pat-stat"><span class="pat-stat-k">Δ deuda TC</span><strong class="pat-stat-v ${cls(-ins.debtMom)}">${patMoney(ins.debtMom, true)}</strong><small>mes actual</small></div>
    <div class="pat-stat"><span class="pat-stat-k">Leverage</span><strong class="pat-stat-v ${ins.debtRatio > 55 ? 'bad' : 'good'}">${ins.debtRatio.toFixed(0)}%</strong><small>deuda ÷ activos</small></div>`;
}

function patrimonyTooltip(rows, nets) {
  return {
    ...chartDefaults().plugins.tooltip,
    callbacks: {
      title: (items) => rows[items[0]?.dataIndex]?.label || '',
      afterTitle: (items) => {
        const i = items[0]?.dataIndex;
        if (i <= 0) return '';
        const ch = nets[i] - nets[i - 1];
        return `Cambio neto: ${patMoney(ch, true)}`;
      },
      label: (item) => ` ${item.dataset.label}: ${patMoney(item.parsed.y)}`,
      afterBody: (items) => {
        const i = items[0]?.dataIndex;
        const r = rows[i];
        if (!r) return [];
        const lines = [
          `Activos: ${patMoney(r.assets)} · Deuda: ${patMoney(r.debt)}`,
        ];
        if (i > 0) {
          const dd = r.debt - rows[i - 1].debt;
          const da = r.assets - rows[i - 1].assets;
          lines.push(`Δ deuda: ${patMoney(dd, true)} · Δ activos: ${patMoney(da, true)}`);
        }
        PAT_ASSET_LAYERS.forEach((l) => {
          const v = Number(r[l.key]) || 0;
          if (v > 0) lines.push(`${l.label}: ${patMoney(v)}`);
        });
        return lines;
      },
    },
  };
}

/** Panel patrimonial con narrativa, KPIs, composición y gráfica */
function initPatrimonyChart(canvas, rows, opts = {}) {
  if (!canvas || !rows?.length || typeof Chart === 'undefined') return null;
  const full = opts.mode === 'full';
  const ins = patrimonyInsights(rows);
  const statsEl = opts.statsEl || document.getElementById('patChartStats');
  const narrativeEl = opts.narrativeEl || document.getElementById('patChartNarrative');
  const compEl = opts.compEl || document.getElementById('patChartComposition');
  renderPatrimonyStats(statsEl, rows, !full);
  renderPatrimonyNarrative(narrativeEl, rows, ins);
  renderPatrimonyComposition(compEl, ins.lastRow, ins.layers);

  const labels = patrimonyMonthLabels(rows);
  const nets = ins.nets;
  const tickSize = full ? 10 : 9;
  const datasets = [
    {
      label: 'Activos totales',
      data: ins.assets,
      borderColor: 'rgba(148, 163, 184, 0.6)',
      backgroundColor: 'rgba(148, 163, 184, 0.05)',
      borderWidth: 1.5,
      borderDash: [4, 4],
      pointRadius: 0,
      pointHitRadius: 8,
      fill: false,
      tension: 0.3,
    },
    {
      label: 'Deuda TC',
      data: ins.debts,
      borderColor: '#f87171',
      backgroundColor: 'rgba(248, 113, 113, 0.05)',
      borderWidth: 2,
      borderDash: [6, 4],
      pointRadius: 0,
      pointHitRadius: 8,
      fill: false,
      tension: 0.3,
    },
    {
      label: 'Patrimonio neto',
      data: nets,
      borderColor: full ? '#34d399' : '#d4a853',
      backgroundColor: full ? 'rgba(52, 211, 153, 0.12)' : 'rgba(212, 168, 83, 0.15)',
      borderWidth: full ? 2.5 : 2,
      pointRadius: (c) => (c.dataIndex === nets.length - 1 ? 4 : 0),
      pointHoverRadius: 5,
      pointBackgroundColor: full ? '#34d399' : '#d4a853',
      pointBorderColor: '#0c0e12',
      pointBorderWidth: 2,
      fill: true,
      tension: 0.35,
    },
  ];

  const scales = {
    x: {
      ticks: {
        color: C.text,
        font: { size: tickSize, family: 'JetBrains Mono, ui-monospace, monospace' },
        maxTicksLimit: full ? 12 : 8,
      },
      grid: { display: false },
      border: { display: false },
    },
    y: {
      ticks: {
        color: C.text,
        font: { size: tickSize, family: 'JetBrains Mono, ui-monospace, monospace' },
        callback: patYTick,
        maxTicksLimit: 6,
      },
      grid: { color: 'rgba(42, 49, 64, 0.35)', drawTicks: false },
      border: { display: false },
    },
  };

  return initAnimatedChart(canvas, () => ({
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      animation: { duration: 800, easing: 'easeOutQuart' },
      layout: { padding: { top: 4, right: 6, bottom: 0, left: 0 } },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          align: 'start',
          labels: {
            color: C.legend,
            font: { family: 'Manrope', size: 9, weight: '600' },
            padding: 10,
            usePointStyle: true,
            boxWidth: 6,
          },
        },
        tooltip: patrimonyTooltip(rows, nets),
      },
      scales,
    },
  }), { immediate: true });
}

function initAnimatedChart(canvas, buildConfig, opts = {}) {
  if (!canvas || typeof Chart === 'undefined') return null;
  const wrap = canvas.closest('.chart, .chart-lg') || canvas.parentElement;
  let chart = null;

  const create = () => {
    if (chart) return chart;
    const existing = Chart.getChart(canvas);
    if (existing) {
      existing.destroy();
      window.__charts = (window.__charts || []).filter((c) => c !== existing);
    }
    chart = new Chart(canvas.getContext('2d'), buildConfig());
    window.__charts.push(chart);
    requestAnimationFrame(() => { try { chart.resize(); } catch (_) {} });
    return chart;
  };

  if (opts.immediate) { create(); return chart; }

  const obs = new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting)) {
      create();
      obs.disconnect();
    }
  }, { threshold: 0.15 });

  if (wrap && wrap.getBoundingClientRect().top < window.innerHeight) create();
  else if (wrap) obs.observe(wrap);
  else create();

  return chart;
}
