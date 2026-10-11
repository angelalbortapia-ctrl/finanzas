/* Panel resize — lightweight splitters (no GridStack) */

const BB_LAYOUT_KEY = 'bb_layout_v7';

function bbWatchInToolRail() {
  return document.getElementById('bbTerminal')?.classList.contains('bb-watch-in-tool-rail') === true;
}
const BB_LAYOUT_DEFAULTS = {
  railW: 440,
  watchRailPct: 38,
  detailPct: 40,
  volH: 88,
  railPanelOrder: 'watch-first',
};

function bbClampLayout(layout) {
  const L = { ...layout };
  L.railW = Math.round(Math.min(560, Math.max(300, Number(L.railW) || BB_LAYOUT_DEFAULTS.railW)));
  L.watchRailPct = Math.round(Math.min(58, Math.max(22, Number(L.watchRailPct) || BB_LAYOUT_DEFAULTS.watchRailPct)));
  L.detailPct = Math.round(Math.min(62, Math.max(24, Number(L.detailPct) || BB_LAYOUT_DEFAULTS.detailPct)));
  L.volH = Math.round(Math.min(160, Math.max(40, Number(L.volH) || BB_LAYOUT_DEFAULTS.volH)));
  L.railPanelOrder = L.railPanelOrder === 'detail-first' ? 'detail-first' : 'watch-first';
  return L;
}

function bbLoadLayout() {
  try {
    const raw = localStorage.getItem(BB_LAYOUT_KEY);
    if (!raw) return { ...BB_LAYOUT_DEFAULTS };
    const parsed = JSON.parse(raw);
    const layout = { ...BB_LAYOUT_DEFAULTS, ...parsed };
    if (!parsed.railW && parsed.infoW) layout.railW = parsed.infoW;
    return bbClampLayout(layout);
  } catch (_) {
    return { ...BB_LAYOUT_DEFAULTS };
  }
}

function bbSaveLayout(layout) {
  try { localStorage.setItem(BB_LAYOUT_KEY, JSON.stringify(bbClampLayout(layout))); } catch (_) {}
}

function bbApplyRailPanelOrder(layout) {
  const rail = document.getElementById('bbRail');
  if (!rail || rail.classList.contains('bb-rail--stub')) return;
  const watch = rail.querySelector('.bb-watch');
  const panel = rail.querySelector('.bb-info-panel');
  const handle = document.getElementById('bbResizeRailWatch');
  if (!watch || !panel || !handle) return;
  const detailFirst = layout.railPanelOrder === 'detail-first';
  watch.style.order = detailFirst ? '3' : '1';
  handle.style.order = '2';
  panel.style.order = detailFirst ? '1' : '3';
}

function bbApplyLayout(layout) {
  const L = bbClampLayout(layout);
  const grid = document.getElementById('bbGrid');
  const split = document.querySelector('.bb-info-split');
  const rail = document.getElementById('bbRail');
  const pane = document.getElementById('bbWorkspacePane');
  if (!grid) return;
  grid.style.setProperty('--bb-vol-h', `${L.volH}px`);
  if (!bbWatchInToolRail()) {
    grid.style.setProperty('--bb-rail-w', `${L.railW}px`);
    grid.style.setProperty('--bb-watch-rail-pct', `${L.watchRailPct}%`);
    grid.style.setProperty('--bb-watch-rail-flex', `${L.watchRailPct}%`);
    pane?.style.setProperty('--bb-rail-w', `${L.railW}px`);
    if (rail) {
      rail.style.setProperty('--bb-watch-rail-pct', `${L.watchRailPct}%`);
      rail.style.setProperty('--bb-watch-rail-flex', `${L.watchRailPct}%`);
    }
    if (split) split.style.setProperty('--bb-detail-pct', `${L.detailPct}%`);
    bbApplyRailPanelOrder(L);
  }
}

function bbSwapRailPanels() {
  if (!BB._layout) BB._layout = bbLoadLayout();
  BB._layout.railPanelOrder = BB._layout.railPanelOrder === 'detail-first' ? 'watch-first' : 'detail-first';
  bbApplyRailPanelOrder(BB._layout);
  bbSaveLayout(BB._layout);
}

function bbNotifyResize() {
  if (typeof resizeAllCharts === 'function') resizeAllCharts();
  bbSyncWatchRailAlign();
  window.dispatchEvent(new Event('resize'));
}

/** Alinea la watchlist con el inicio de la gráfica (debajo de cabecera + toolbar). */
function bbSyncWatchRailAlign() {
  const shell = document.getElementById('bbTerminal');
  if (shell?.classList.contains('bb-watch-in-tool-rail')) return;
  const pane = document.querySelector('.bb-workspace-pane');
  const chartArea = pane?.querySelector(':scope > .bb-chart-area');
  const rail = pane?.querySelector(':scope > .bb-rail:not(.bb-rail--stub)');
  if (!chartArea) return;
  const head = chartArea.querySelector('.bb-chart-head');
  const toolbar = chartArea.querySelector('.bb-chart-toolbar--pro');
  const drawer = chartArea.querySelector('.bb-nav-drawer');
  let h = (head?.offsetHeight || 0) + (toolbar?.offsetHeight || 0);
  if (drawer && drawer.open) {
    h += drawer.offsetHeight || 0;
  }
  h = Math.max(88, Math.round(h));
  document.documentElement.style.setProperty('--bb-chart-chrome-h', `${h}px`);
  if (rail && window.matchMedia('(min-width: 1180px)').matches) {
    const ch = Math.round(chartArea.getBoundingClientRect().height);
    if (ch > 0) {
      rail.style.minHeight = `${ch}px`;
      rail.style.height = `${ch}px`;
    }
  } else if (rail) {
    rail.style.minHeight = '';
    rail.style.height = '';
  }
}
window.bbSyncWatchRailAlign = bbSyncWatchRailAlign;

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
  bbSetWorkspacePanelsEdit(!!on);
}

const BB_WORKSPACE_PANELS = [
  { key: 'chart', selector: '.bb-workspace-pane > .bb-chart-area', title: 'Gráfica', sortable: false },
  { key: 'watch', selector: '#bbToolRail .bb-tool-rail-watch .bb-watch', title: 'Watchlist', sortable: false },
  { key: 'detail', selector: '#bbKeyStatsPanel', title: 'Estadísticas clave', sortable: false },
];

function bbEnsureWorkspacePanelChrome() {
  BB_WORKSPACE_PANELS.forEach((spec) => {
    const panel = document.querySelector(spec.selector);
    if (!panel || panel.dataset.workspaceChrome === '1') return;
    panel.dataset.workspaceChrome = '1';
    panel.classList.add('bb-workspace-panel');
    if (spec.key === 'watch') {
      panel.closest('.bb-tool-rail-watch')?.classList.add('bb-workspace-panel-host');
    }
    const chrome = document.createElement('div');
    chrome.className = 'bb-workspace-panel-chrome';
    chrome.innerHTML = spec.key === 'chart'
      ? `<span class="bb-workspace-panel-title bb-workspace-panel-title--solo">${spec.title}</span>
         <span class="bb-workspace-panel-hint">Divisor bajo precio → volumen</span>`
      : spec.key === 'watch'
        ? `<span class="bb-workspace-panel-title bb-workspace-panel-title--solo">${spec.title}</span>
           <span class="bb-workspace-panel-hint">Ancho del drawer en panel ☆</span>`
        : `<span class="bb-workspace-panel-title bb-workspace-panel-title--solo">${spec.title}</span>`;
    panel.insertBefore(chrome, panel.firstChild);
  });
}

function bbSetWorkspacePanelsEdit(on) {
  bbEnsureWorkspacePanelChrome();
  document.querySelectorAll('.bb-workspace-panel').forEach((panel) => {
    panel.classList.toggle('bb-workspace-panel-editable', !!on);
  });
  document.querySelectorAll('.bb-workspace-panel-host').forEach((host) => {
    host.classList.toggle('bb-workspace-panel-editable', !!on);
  });
  document.getElementById('bbRail')?.classList.toggle('bb-rail-edit', !!on);
  if (on) requestAnimationFrame(bbSyncWatchRailAlign);
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
  document.querySelectorAll('.bb-workspace-panel').forEach((p) => {
    p.style.order = '';
  });
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
  bbEnsureWorkspacePanelChrome();
  bbSyncWatchRailAlign();
  window.addEventListener('resize', () => {
    requestAnimationFrame(bbSyncWatchRailAlign);
  });
  document.querySelector('.bb-nav-drawer')?.addEventListener('toggle', () => {
    requestAnimationFrame(bbSyncWatchRailAlign);
  });
  bbWireLayoutEditButtons();

  if (!bbWatchInToolRail()) {
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
