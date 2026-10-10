/* Panel resize — lightweight splitters (no GridStack) */

const BB_LAYOUT_KEY = 'bb_layout_v7';
const BB_LAYOUT_DEFAULTS = {
  railW: 440,
  watchRailPct: 38,
  detailPct: 40,
  volH: 88,
};

function bbLoadLayout() {
  try {
    const raw = localStorage.getItem(BB_LAYOUT_KEY);
    if (!raw) return { ...BB_LAYOUT_DEFAULTS };
    const parsed = JSON.parse(raw);
    const layout = { ...BB_LAYOUT_DEFAULTS, ...parsed };
    if (!parsed.railW && parsed.infoW) layout.railW = parsed.infoW;
    return layout;
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
  const rail = document.getElementById('bbRail');
  if (!grid) return;
  grid.style.setProperty('--bb-rail-w', `${layout.railW}px`);
  grid.style.setProperty('--bb-watch-rail-pct', `${layout.watchRailPct}%`);
  grid.style.setProperty('--bb-watch-rail-flex', `${layout.watchRailPct}%`);
  grid.style.setProperty('--bb-vol-h', `${layout.volH}px`);
  if (rail) {
    rail.style.setProperty('--bb-watch-rail-pct', `${layout.watchRailPct}%`);
    rail.style.setProperty('--bb-watch-rail-flex', `${layout.watchRailPct}%`);
  }
  if (split) split.style.setProperty('--bb-detail-pct', `${layout.detailPct}%`);
}

function bbNotifyResize() {
  if (typeof resizeAllCharts === 'function') resizeAllCharts();
  window.dispatchEvent(new Event('resize'));
}

/** Modo ajustar: clase en body (forge) y en #bbTerminal (paneles + widgets). */
function bbSetLayoutEditMode(on) {
  const shell = document.getElementById('bbTerminal');
  document.body.classList.toggle('bb-layout-edit', !!on);
  shell?.classList.toggle('bb-layout-edit', !!on);
  const termBtn = document.getElementById('bbLayoutBtn');
  const termReset = document.getElementById('bbLayoutReset');
  const forgeBtn = document.getElementById('bbForgeLayoutBtn');
  const forgeReset = document.getElementById('bbForgeLayoutReset');
  termBtn?.classList.toggle('active', !!on);
  forgeBtn?.classList.toggle('active', !!on);
  if (termBtn) termBtn.textContent = on ? 'Listo' : 'Ajustar';
  if (forgeBtn) forgeBtn.textContent = on ? 'Listo' : '⊞ Ajustar';
  else if (termBtn && !document.getElementById('bbForgeLayoutBtn')) {
    termBtn.textContent = on ? 'Listo' : 'Ajustar';
  }
  if (termReset) termReset.hidden = !on;
  if (forgeReset) forgeReset.hidden = !on;
  if (typeof bbSetWidgetsLayoutEdit === 'function') bbSetWidgetsLayoutEdit(!!on);
  if (on) {
    requestAnimationFrame(() => {
      document.getElementById('bbWidgetsDeck')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }
}

function bbToggleLayoutEditMode() {
  const shell = document.getElementById('bbTerminal');
  if (!shell) return;
  bbSetLayoutEditMode(!shell.classList.contains('bb-layout-edit'));
}
window.bbToggleLayoutEditMode = bbToggleLayoutEditMode;

/** Oculta ⊞ Ajustar en móvil y sale del modo edición al redimensionar. */
function bbWireChromeLayoutUi() {
  const wrap = document.getElementById('bbChromeLayout');
  if (!wrap || wrap.dataset.bbLayoutUi === '1') return;
  wrap.dataset.bbLayoutUi = '1';
  const mq = window.matchMedia('(max-width: 1100px)');
  const sync = () => {
    wrap.hidden = mq.matches;
    if (mq.matches && document.body.classList.contains('bb-layout-edit')) {
      bbSetLayoutEditMode(false);
    }
  };
  sync();
  mq.addEventListener('change', sync);
}
window.bbWireChromeLayoutUi = bbWireChromeLayoutUi;

function bbWireLayoutEditButtons() {
  const shell = document.getElementById('bbTerminal');
  if (!shell || shell.dataset.layoutBtns === '1') return;
  shell.dataset.layoutBtns = '1';
  bbWireChromeLayoutUi();

  const toggle = () => bbToggleLayoutEditMode();
  document.getElementById('bbLayoutBtn')?.addEventListener('click', toggle);
  document.getElementById('bbForgeLayoutBtn')?.addEventListener('click', toggle);

  const resetAll = () => {
    bbResetTerminalLayout();
    if (typeof bbResetWidgetsLayout === 'function') bbResetWidgetsLayout();
  };
  document.getElementById('bbLayoutReset')?.addEventListener('click', resetAll);
  document.getElementById('bbForgeLayoutReset')?.addEventListener('click', resetAll);
}
window.bbSetLayoutEditMode = bbSetLayoutEditMode;

function bbResetTerminalLayout() {
  BB._layout = { ...BB_LAYOUT_DEFAULTS };
  bbApplyLayout(BB._layout);
  bbSaveLayout(BB._layout);
  bbNotifyResize();
}
window.bbResetTerminalLayout = bbResetTerminalLayout;

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

  bbSetLayoutEditMode(false);
  BB._layout = bbLoadLayout();
  bbApplyLayout(BB._layout);
  bbWireLayoutEditButtons();

  bbMakeColResizer(
    document.getElementById('bbResizeInfo'),
    () => BB._layout.railW,
    (v) => {
      BB._layout.railW = v;
      grid.style.setProperty('--bb-rail-w', `${v}px`);
      document.getElementById('bbWorkspacePane')?.style.setProperty('--bb-rail-w', `${v}px`);
    },
    300, 560, -1,
  );

  const rail = document.getElementById('bbRail');
  bbMakePctResizer(
    document.getElementById('bbResizeRailWatch'),
    rail,
    () => BB._layout.watchRailPct,
    (v) => {
      BB._layout.watchRailPct = v;
      grid.style.setProperty('--bb-watch-rail-pct', `${v}%`);
      grid.style.setProperty('--bb-watch-rail-flex', `${v}%`);
      if (rail) {
        rail.style.setProperty('--bb-watch-rail-pct', `${v}%`);
        rail.style.setProperty('--bb-watch-rail-flex', `${v}%`);
      }
    },
    22, 58,
  );

  const infoSplit = document.querySelector('.bb-info-split');
  const newsHandle = document.getElementById('bbResizeNews');
  if (newsHandle && infoSplit) {
    bbMakePctResizer(
      newsHandle,
      infoSplit,
      () => BB._layout.detailPct,
      (v) => {
        BB._layout.detailPct = v;
        infoSplit.style.setProperty('--bb-detail-pct', `${v}%`);
      },
      24, 62,
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
