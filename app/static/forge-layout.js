/* Forge layout — redimensionar widgets (mismo patrón que terminal GBM) */

const FX_STORAGE = 'fx_layout_v2';

function fxPageId() {
  const root = document.getElementById('bbPage') || document.getElementById('bbHome');
  return root?.dataset.fxPage || root?.id || location.pathname;
}

function fxCollectDefaults() {
  const defaults = {};
  document.querySelectorAll('[data-fx-key]').forEach((el) => {
    const key = el.dataset.fxKey;
    const def = parseFloat(el.dataset.fxDefault);
    if (key && !Number.isNaN(def)) defaults[key] = def;
  });
  return defaults;
}

function fxLoadState() {
  const defaults = fxCollectDefaults();
  try {
    const raw = localStorage.getItem(`${FX_STORAGE}:${fxPageId()}`);
    if (!raw) return defaults;
    return { ...defaults, ...JSON.parse(raw) };
  } catch (_) {
    return defaults;
  }
}

function fxSaveState(state) {
  try {
    localStorage.setItem(`${FX_STORAGE}:${fxPageId()}`, JSON.stringify(state));
  } catch (_) {}
}

function fxApplyOne(el, state) {
  const key = el.dataset.fxKey;
  const varName = el.dataset.fxVar;
  const mode = el.dataset.fxLayout;
  const val = state[key];
  if (val == null || !key) return;
  if (varName) {
    const unit = mode === 'cols' || mode === 'panel-h' ? 'px' : '%';
    el.style.setProperty(varName, `${val}${unit}`);
  }
  if (mode === 'panel-h') {
    const target = el.querySelector('.pat-chart-wrap, .chart-target') || el.querySelector('.chart');
    if (target) target.style.height = `${val}px`;
  }
}

function fxApplyAll(state) {
  document.querySelectorAll('[data-fx-key]').forEach((el) => fxApplyOne(el, state));
}

function fxNotifyResize() {
  if (typeof resizeAllCharts === 'function') resizeAllCharts();
  if (window.__charts) {
    window.__charts.forEach((c) => { try { c.resize(); } catch (_) {} });
  }
  window.dispatchEvent(new Event('resize'));
}

function fxIsEdit() {
  return document.body.classList.contains('bb-layout-edit');
}

function fxBindCol(handle) {
  const layout = handle.closest('[data-fx-layout]');
  if (!layout) return;
  const key = layout.dataset.fxKey;
  const varName = layout.dataset.fxVar;
  const min = parseFloat(layout.dataset.fxMin) || 200;
  const max = parseFloat(layout.dataset.fxMax) || 600;
  const dir = parseFloat(handle.dataset.fxDir || layout.dataset.fxDir || '1');

  handle.addEventListener('mousedown', (e) => {
    if (!fxIsEdit()) return;
    e.preventDefault();
    const start = e.clientX;
    const base = FX._state[key];
    handle.classList.add('fx-dragging');
    document.body.classList.add('bb-resizing');
    const move = (ev) => {
      const v = Math.round(Math.min(max, Math.max(min, base + (ev.clientX - start) * dir)));
      FX._state[key] = v;
      layout.style.setProperty(varName, `${v}px`);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      handle.classList.remove('fx-dragging');
      document.body.classList.remove('bb-resizing');
      fxSaveState(FX._state);
      fxNotifyResize();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

function fxBindDuo(handle) {
  const layout = handle.closest('[data-fx-layout]');
  if (!layout) return;
  const key = layout.dataset.fxKey;
  const varName = layout.dataset.fxVar;
  const min = parseFloat(layout.dataset.fxMin) || 25;
  const max = parseFloat(layout.dataset.fxMax) || 75;
  const rect = () => layout.getBoundingClientRect();

  handle.addEventListener('mousedown', (e) => {
    if (!fxIsEdit()) return;
    e.preventDefault();
    const start = e.clientX;
    const base = FX._state[key];
    handle.classList.add('fx-dragging');
    document.body.classList.add('bb-resizing');
    const move = (ev) => {
      const w = rect().width || 1;
      const delta = ((ev.clientX - start) / w) * 100;
      const v = Math.round(Math.min(max, Math.max(min, base + delta)));
      FX._state[key] = v;
      layout.style.setProperty(varName, `${v}%`);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      handle.classList.remove('fx-dragging');
      document.body.classList.remove('bb-resizing');
      fxSaveState(FX._state);
      fxNotifyResize();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

function fxBindStack(handle) {
  const layout = handle.closest('[data-fx-layout]');
  if (!layout) return;
  const key = layout.dataset.fxKey;
  const varName = layout.dataset.fxVar;
  const min = parseFloat(layout.dataset.fxMin) || 30;
  const max = parseFloat(layout.dataset.fxMax) || 80;
  const rect = () => layout.getBoundingClientRect();

  handle.addEventListener('mousedown', (e) => {
    if (!fxIsEdit()) return;
    e.preventDefault();
    const start = e.clientY;
    const base = FX._state[key];
    handle.classList.add('fx-dragging');
    document.body.classList.add('bb-resizing', 'bb-resizing-row');
    const move = (ev) => {
      const h = rect().height || 1;
      const delta = ((ev.clientY - start) / h) * 100;
      const v = Math.round(Math.min(max, Math.max(min, base + delta)));
      FX._state[key] = v;
      layout.style.setProperty(varName, `${v}%`);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      handle.classList.remove('fx-dragging');
      document.body.classList.remove('bb-resizing', 'bb-resizing-row');
      fxSaveState(FX._state);
      fxNotifyResize();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

function fxBindPanelH(handle) {
  const panel = handle.closest('[data-fx-layout="panel-h"]');
  if (!panel) return;
  const key = panel.dataset.fxKey;
  const min = parseFloat(panel.dataset.fxMin) || 100;
  const max = parseFloat(panel.dataset.fxMax) || 480;

  handle.addEventListener('mousedown', (e) => {
    if (!fxIsEdit()) return;
    e.preventDefault();
    const start = e.clientY;
    const base = FX._state[key];
    handle.classList.add('fx-dragging');
    document.body.classList.add('bb-resizing', 'bb-resizing-row');
    const move = (ev) => {
      const v = Math.round(Math.min(max, Math.max(min, base + (ev.clientY - start))));
      FX._state[key] = v;
      panel.style.setProperty(panel.dataset.fxVar, `${v}px`);
      panel.querySelectorAll('.chart').forEach((c) => { c.style.height = `${v}px`; });
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      handle.classList.remove('fx-dragging');
      document.body.classList.remove('bb-resizing', 'bb-resizing-row');
      fxSaveState(FX._state);
      fxNotifyResize();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

function setupForgeLayout() {
  const root = document.getElementById('bbPage') || document.getElementById('bbHome');
  if (!root || document.getElementById('bbTerminal')) return;

  const layouts = root.querySelectorAll('[data-fx-layout]');
  if (!layouts.length) return;

  FX._state = fxLoadState();
  fxApplyAll(FX._state);

  root.querySelectorAll('[data-fx-layout="cols"] .fx-resize-col').forEach(fxBindCol);
  root.querySelectorAll('[data-fx-layout="duo"] .fx-resize-col').forEach(fxBindDuo);
  root.querySelectorAll('[data-fx-layout="stack"] .fx-resize-row').forEach(fxBindStack);
  root.querySelectorAll('[data-fx-layout="panel-h"] .fx-resize-row').forEach(fxBindPanelH);

  const wrap = document.getElementById('bbChromeLayout');
  const btn = document.getElementById('bbForgeLayoutBtn');
  const reset = document.getElementById('bbForgeLayoutReset');
  if (!btn) return;

  const mq = window.matchMedia('(max-width: 1100px)');
  const syncLayoutUi = () => {
    if (wrap) wrap.hidden = mq.matches;
    if (mq.matches && document.body.classList.contains('bb-layout-edit')) {
      document.body.classList.remove('bb-layout-edit');
      btn.classList.remove('active');
      btn.textContent = 'Ajustar';
      if (reset) reset.hidden = true;
    }
  };
  syncLayoutUi();
  mq.addEventListener('change', syncLayoutUi);
  btn.textContent = 'Ajustar';

  btn.addEventListener('click', () => {
    const on = document.body.classList.toggle('bb-layout-edit');
    btn.classList.toggle('active', on);
    btn.textContent = on ? 'Listo' : 'Ajustar';
    if (reset) reset.hidden = !on;
  });

  reset?.addEventListener('click', () => {
    FX._state = fxCollectDefaults();
    fxApplyAll(FX._state);
    fxSaveState(FX._state);
    fxNotifyResize();
  });
}

window.FX = window.FX || {};
window.setupForgeLayout = setupForgeLayout;
