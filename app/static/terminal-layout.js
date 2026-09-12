/* Panel resize — lightweight splitters (no GridStack) */

const BB_LAYOUT_KEY = 'bb_layout_v4';
const BB_LAYOUT_DEFAULTS = {
  watchW: 220,
  infoW: 310,
  newsPct: 58,
  volH: 68,
};

function bbLoadLayout() {
  try {
    const raw = localStorage.getItem(BB_LAYOUT_KEY);
    if (!raw) return { ...BB_LAYOUT_DEFAULTS };
    return { ...BB_LAYOUT_DEFAULTS, ...JSON.parse(raw) };
  } catch (_) {
    return { ...BB_LAYOUT_DEFAULTS };
  }
}

function bbSaveLayout(layout) {
  try { localStorage.setItem(BB_LAYOUT_KEY, JSON.stringify(layout)); } catch (_) {}
}

function bbApplyLayout(layout) {
  const grid = document.getElementById('bbGrid');
  const split = document.querySelector('.bb-info-split');
  if (!grid) return;
  grid.style.setProperty('--bb-watch-w', `${layout.watchW}px`);
  grid.style.setProperty('--bb-info-w', `${layout.infoW}px`);
  grid.style.setProperty('--bb-vol-h', `${layout.volH}px`);
  if (split) split.style.setProperty('--bb-news-pct', `${layout.newsPct}%`);
}

function bbNotifyResize() {
  if (typeof resizeAllCharts === 'function') resizeAllCharts();
  window.dispatchEvent(new Event('resize'));
}

function bbMakeColResizer(handle, get, set, min, max, dir = 1) {
  if (!handle) return;
  handle.addEventListener('mousedown', (e) => {
    const shell = document.getElementById('bbTerminal');
    if (!shell?.classList.contains('bb-layout-edit')) return;
    e.preventDefault();
    const start = e.clientX;
    const base = get();
    handle.classList.add('bb-dragging');
    document.body.classList.add('bb-resizing');
    const move = (ev) => set(Math.round(Math.min(max, Math.max(min, base + (ev.clientX - start) * dir))));
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      handle.classList.remove('bb-dragging');
      document.body.classList.remove('bb-resizing');
      bbSaveLayout(BB._layout);
      bbNotifyResize();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

function bbMakeRowResizer(handle, get, set, min, max) {
  if (!handle) return;
  handle.addEventListener('mousedown', (e) => {
    const shell = document.getElementById('bbTerminal');
    if (!shell?.classList.contains('bb-layout-edit')) return;
    e.preventDefault();
    const start = e.clientY;
    const base = get();
    handle.classList.add('bb-dragging');
    document.body.classList.add('bb-resizing');
    const move = (ev) => set(Math.round(Math.min(max, Math.max(min, base + (ev.clientY - start)))));
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      handle.classList.remove('bb-dragging');
      document.body.classList.remove('bb-resizing');
      bbSaveLayout(BB._layout);
      bbNotifyResize();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

function bbMakePctResizer(handle, container, get, set, min = 25, max = 80) {
  if (!handle || !container) return;
  handle.addEventListener('mousedown', (e) => {
    const shell = document.getElementById('bbTerminal');
    if (!shell?.classList.contains('bb-layout-edit')) return;
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    const start = e.clientY;
    const base = get();
    handle.classList.add('bb-dragging');
    document.body.classList.add('bb-resizing');
    const move = (ev) => {
      const deltaPct = ((ev.clientY - start) / rect.height) * 100;
      set(Math.round(Math.min(max, Math.max(min, base + deltaPct))));
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      handle.classList.remove('bb-dragging');
      document.body.classList.remove('bb-resizing');
      bbSaveLayout(BB._layout);
      bbNotifyResize();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

function setupTerminalLayout() {
  const shell = document.getElementById('bbTerminal');
  const grid = document.getElementById('bbGrid');
  if (!shell || !grid) return;

  shell.classList.remove('bb-layout-edit');
  BB._layout = bbLoadLayout();
  bbApplyLayout(BB._layout);

  const btn = document.getElementById('bbLayoutBtn');
  const reset = document.getElementById('bbLayoutReset');
  if (btn) btn.textContent = 'Ajustar';

  btn?.addEventListener('click', () => {
    const on = shell.classList.toggle('bb-layout-edit');
    btn.classList.toggle('active', on);
    btn.textContent = on ? 'Listo' : 'Ajustar';
    if (reset) reset.hidden = !on;
  });

  reset?.addEventListener('click', () => {
    BB._layout = { ...BB_LAYOUT_DEFAULTS };
    bbApplyLayout(BB._layout);
    bbSaveLayout(BB._layout);
    bbNotifyResize();
  });

  bbMakeColResizer(
    document.getElementById('bbResizeWatch'),
    () => BB._layout.watchW,
    (v) => { BB._layout.watchW = v; grid.style.setProperty('--bb-watch-w', `${v}px`); },
    160, 420, 1,
  );

  bbMakeColResizer(
    document.getElementById('bbResizeInfo'),
    () => BB._layout.infoW,
    (v) => { BB._layout.infoW = v; grid.style.setProperty('--bb-info-w', `${v}px`); },
    240, 560, -1,
  );

  const newsHandle = document.getElementById('bbResizeNews');
  const infoSplit = document.querySelector('.bb-info-split');
  if (newsHandle && infoSplit) {
    bbMakePctResizer(
      newsHandle,
      infoSplit,
      () => BB._layout.newsPct,
      (v) => {
        BB._layout.newsPct = v;
        infoSplit.style.setProperty('--bb-news-pct', `${v}%`);
      },
    );
  }

  bbMakeRowResizer(
    document.getElementById('bbResizeChart'),
    () => BB._layout.volH,
    (v) => {
      BB._layout.volH = v;
      grid.style.setProperty('--bb-vol-h', `${v}px`);
    },
    40, 160,
  );
}
