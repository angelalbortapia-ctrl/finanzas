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

function initAnimatedChart(canvas, buildConfig, opts = {}) {
  if (!canvas || typeof Chart === 'undefined') return null;
  const wrap = canvas.closest('.chart, .chart-lg') || canvas.parentElement;
  let chart = null;

  const create = () => {
    if (chart) return chart;
    chart = new Chart(canvas.getContext('2d'), buildConfig());
    window.__charts.push(chart);
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
