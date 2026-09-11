const C = {
  text: '#94a3b8',
  grid: 'rgba(0,0,0,0.06)',
  accent: '#4f46e5',
  good: '#059669',
  bad: '#dc2626',
  tooltipBg: '#ffffff',
  tooltipTitle: '#0f172a',
  tooltipBody: '#475569',
  tooltipBorder: '#e2e8f0',
  legend: '#475569',
  donutTrack: 'rgba(0,0,0,0.06)',
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
          font: { family: 'Plus Jakarta Sans', size: 11, weight: '600' },
          padding: 14, usePointStyle: true, boxWidth: 8,
        },
      },
      tooltip: {
        backgroundColor: C.tooltipBg,
        titleColor: C.tooltipTitle,
        bodyColor: C.tooltipBody,
        borderColor: C.tooltipBorder,
        borderWidth: 1,
        padding: 12, cornerRadius: 10,
        titleFont: { family: 'Plus Jakarta Sans', weight: '700' },
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
        grid: { color: C.grid },
        border: { display: false },
      },
    },
  };
}

function donutDefaults() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '76%',
    animation: { animateRotate: true, duration: 1200, easing: 'easeOutQuart' },
    plugins: { legend: { display: false }, tooltip: chartDefaults().plugins.tooltip },
  };
}

function donutTrackColor() {
  return C.donutTrack;
}

function initAnimatedChart(canvas, buildConfig, opts = {}) {
  if (!canvas || typeof Chart === 'undefined') return null;

  const wrap = canvas.closest('.chart-box, .chart-box-lg, .health-ring-wrap') || canvas.parentElement;
  let chart = null;

  const create = () => {
    if (chart) return chart;
    const config = buildConfig();
    chart = new Chart(canvas, config);
    canvas._chartInstance = chart;
    window.__charts.push(chart);
    wrap?.classList.remove('chart-pending');
    wrap?.classList.add('chart-visible');
    return chart;
  };

  if (opts.immediate) return create();

  wrap?.classList.add('chart-pending');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      create();
    });
  }, { threshold: 0.2 });

  observer.observe(wrap || canvas);
  const rect = (wrap || canvas).getBoundingClientRect();
  if (rect.top < window.innerHeight) {
    observer.disconnect();
    create();
  }
  return null;
}
