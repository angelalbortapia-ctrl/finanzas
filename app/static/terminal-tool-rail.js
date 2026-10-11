/* Barra lateral de herramientas — terminal /inversiones */

const BB_TOOL_RAIL_KEY = 'finanzas_tool_rail_pinned';
const BB_TOOL_RAIL_PANEL_KEY = 'finanzas_tool_rail_panel';
const BB_TOOL_RAIL_HIDDEN_KEY = 'finanzas_tool_rail_hidden';

const BB_TOOL_RAIL_TITLES = {
  nav: 'Espacios',
  watch: 'Watchlist',
  chart: 'Gráfica',
  ops: 'Operaciones',
  system: 'Sistema',
};

function bbTrailClick(sel) {
  const el = document.querySelector(sel);
  if (!el) return;
  el.click();
  el.focus?.();
}

function bbTrailFocus(sel) {
  const el = document.querySelector(sel);
  if (!el) return;
  el.focus();
  el.select?.();
}

function bbTrailSetPanel(id) {
  const rail = document.getElementById('bbToolRail');
  const title = document.getElementById('bbToolRailTitle');
  if (!rail) return;
  rail.querySelectorAll('.bb-tool-rail-icon[data-trail-panel]').forEach((btn) => {
    const on = btn.dataset.trailPanel === id;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  rail.querySelectorAll('.bb-tool-rail-panel').forEach((panel) => {
    const on = panel.dataset.trailPanel === id;
    panel.classList.toggle('active', on);
    panel.hidden = !on;
  });
  if (title && BB_TOOL_RAIL_TITLES[id]) title.textContent = BB_TOOL_RAIL_TITLES[id];
  const app = document.getElementById('bbTerminalApp');
  app?.classList.toggle('bb-tool-rail-panel-watch', id === 'watch');
  try { localStorage.setItem(BB_TOOL_RAIL_PANEL_KEY, id); } catch (_) {}
}

function bbTrailSetOpen(open) {
  const app = document.getElementById('bbTerminalApp');
  const pin = document.getElementById('bbToolRailPin');
  if (!app) return;
  app.classList.toggle('bb-tool-rail-open', !!open);
  if (pin) pin.setAttribute('aria-pressed', open ? 'true' : 'false');
  try { localStorage.setItem(BB_TOOL_RAIL_KEY, open ? '1' : '0'); } catch (_) {}
}

function bbTrailSetHidden(hidden) {
  const app = document.getElementById('bbTerminalApp');
  const reveal = document.getElementById('bbToolRailReveal');
  if (!app) return;
  app.classList.toggle('bb-tool-rail-hidden', !!hidden);
  if (reveal) reveal.hidden = !hidden;
  try { localStorage.setItem(BB_TOOL_RAIL_HIDDEN_KEY, hidden ? '1' : '0'); } catch (_) {}
  if (typeof bbSyncWatchRailAlign === 'function') {
    requestAnimationFrame(() => {
      bbSyncWatchRailAlign();
      if (typeof resizeAllCharts === 'function') resizeAllCharts();
    });
  }
  window.dispatchEvent(new Event('resize'));
}

function setupTerminalToolRail() {
  const rail = document.getElementById('bbToolRail');
  const app = document.getElementById('bbTerminalApp');
  if (!rail || !app || rail.dataset.bound === '1') return;
  rail.dataset.bound = '1';

  let pinned = true;
  try { pinned = localStorage.getItem(BB_TOOL_RAIL_KEY) !== '0'; } catch (_) {}
  let hidden = false;
  try { hidden = localStorage.getItem(BB_TOOL_RAIL_HIDDEN_KEY) === '1'; } catch (_) {}
  let panel = 'watch';
  try {
    const saved = localStorage.getItem(BB_TOOL_RAIL_PANEL_KEY);
    if (saved && BB_TOOL_RAIL_TITLES[saved]) panel = saved;
  } catch (_) {}

  bbTrailSetPanel(panel);
  bbTrailSetOpen(pinned);
  bbTrailSetHidden(hidden);

  document.getElementById('bbToolRailHide')?.addEventListener('click', () => bbTrailSetHidden(true));
  document.getElementById('bbToolRailReveal')?.addEventListener('click', () => bbTrailSetHidden(false));

  rail.querySelectorAll('.bb-tool-rail-icon[data-trail-panel]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.trailPanel;
      bbTrailSetPanel(id);
      bbTrailSetOpen(true);
    });
  });

  document.getElementById('bbToolRailPin')?.addEventListener('click', () => {
    bbTrailSetOpen(!app.classList.contains('bb-tool-rail-open'));
  });

  rail.querySelectorAll('[data-click]').forEach((btn) => {
    btn.addEventListener('click', () => bbTrailClick(btn.dataset.click));
  });
  rail.querySelectorAll('[data-focus]').forEach((btn) => {
    btn.addEventListener('click', () => bbTrailFocus(btn.dataset.focus));
  });

  rail.querySelectorAll('[data-trail-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.trailAction;
      if (action === 'help') {
        document.getElementById('bbKbdHelp')?.classList.add('open');
        return;
      }
      if (action === 'analysis') {
        const sym = (window.BB?.symbol || '').replace(/^BMV:/i, '');
        if (sym && sym !== 'IPC') window.location.href = `/emisora/${encodeURIComponent(sym)}`;
        return;
      }
      if (action === 'scroll-widgets') {
        document.getElementById('bbWidgetsDeck')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  rail.querySelector('.bb-tool-rail-icon--help')?.addEventListener('click', () => {
    document.getElementById('bbKbdHelp')?.classList.add('open');
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupTerminalToolRail);
} else {
  setupTerminalToolRail();
}

window.setupTerminalToolRail = setupTerminalToolRail;
