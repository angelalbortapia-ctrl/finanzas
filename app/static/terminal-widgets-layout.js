/* Deck de widgets bajo la gráfica — orden, ancho (1/2 col) y alto */

const BB_WIDGETS_LAYOUT_KEY = 'bb_widgets_layout_v7';

const BB_WIDGETS_DEFAULT = {
  order: [
    'stats', 'analysts',
    'tv-scan', 'tv-technical',
    'earnings', 'dividends',
    'trends', 'health',
    'margins', 'profile',
    'tv-symbol',
    'google-news',
  ],
  widgets: {
    stats: { col: 1, minH: 0 },
    analysts: { col: 1, minH: 0 },
    'tv-scan': { col: 1, minH: 0 },
    'tv-technical': { col: 1, minH: 460 },
    earnings: { col: 1, minH: 0 },
    dividends: { col: 1, minH: 0 },
    trends: { col: 2, minH: 0 },
    health: { col: 1, minH: 0 },
    margins: { col: 1, minH: 0 },
    'google-news': { col: 2, minH: 0 },
    profile: { col: 1, minH: 0 },
    'tv-symbol': { col: 1, minH: 560 },
  },
};

function bbLoadWidgetsLayout() {
  try {
    const raw = localStorage.getItem(BB_WIDGETS_LAYOUT_KEY);
    if (!raw) return JSON.parse(JSON.stringify(BB_WIDGETS_DEFAULT));
    const parsed = JSON.parse(raw);
    const order = Array.isArray(parsed.order) ? parsed.order : BB_WIDGETS_DEFAULT.order;
    const widgets = { ...BB_WIDGETS_DEFAULT.widgets, ...(parsed.widgets || {}) };
    return { order, widgets };
  } catch (_) {
    return JSON.parse(JSON.stringify(BB_WIDGETS_DEFAULT));
  }
}

function bbSaveWidgetsLayout(layout) {
  try {
    localStorage.setItem(BB_WIDGETS_LAYOUT_KEY, JSON.stringify(layout));
  } catch (_) {}
}

function bbWidgetGridColumns() {
  const grid = document.getElementById('bbWidgetsGrid');
  if (!grid) return 2;
  const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean);
  return Math.max(1, cols.length || 2);
}

function bbEnsureWidgetBody(card) {
  if (!card || card.querySelector('.bb-widget-body')) return;
  const body = document.createElement('div');
  body.className = 'bb-widget-body';
  const keep = new Set();
  card.querySelectorAll('.bb-widget-chrome, .bb-widget-resize').forEach((el) => keep.add(el));
  [...card.children].forEach((el) => {
    if (!keep.has(el)) body.appendChild(el);
  });
  const resize = card.querySelector('.bb-widget-resize');
  if (resize) card.insertBefore(body, resize);
  else card.appendChild(body);
}

function bbApplyWidgetsLayout() {
  const grid = document.getElementById('bbWidgetsGrid');
  if (!grid) return;
  if (!BB._widgetsLayout) BB._widgetsLayout = bbLoadWidgetsLayout();
  const layout = BB._widgetsLayout;
  const maxCol = bbWidgetGridColumns();
  const cards = [...grid.querySelectorAll('.bb-widget-card[data-widget-id]')];
  const byId = Object.fromEntries(cards.map((c) => [c.dataset.widgetId, c]));

  const order = layout.order.filter((id) => byId[id]);
  cards.forEach((c) => {
    if (!order.includes(c.dataset.widgetId)) order.push(c.dataset.widgetId);
  });
  layout.order = order.filter((id) => id !== 'google-news');
  if (byId['google-news']) layout.order.push('google-news');
  layout.order.forEach((id) => {
    if (byId[id]) grid.appendChild(byId[id]);
  });

  cards.forEach((card) => {
    bbEnsureWidgetBody(card);
    const id = card.dataset.widgetId;
    const def = BB_WIDGETS_DEFAULT.widgets[id] || { col: 1, minH: 220 };
    const spec = layout.widgets[id] || def;
    if (spec.hidden) {
      card.hidden = true;
      card.style.display = 'none';
      return;
    }
    card.hidden = false;
    card.style.display = '';
    const col = Math.min(maxCol, Math.max(1, spec.col || def.col || 1));
    const rawH = spec.minH != null ? spec.minH : (def.minH || 0);
    const minH = Math.round(Math.min(720, Math.max(0, rawH)));
    card.style.gridColumn = `span ${col}`;
    if (minH > 0) card.style.minHeight = `${minH}px`;
    else card.style.minHeight = '';
    card.style.height = 'auto';
    card.dataset.widgetCol = String(col);
    card.querySelectorAll('.bb-widget-span-btn').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.col) === col);
    });
  });
}

function bbMoveWidgetInOrder(widgetId, beforeId) {
  if (!BB._widgetsLayout) BB._widgetsLayout = bbLoadWidgetsLayout();
  const order = BB._widgetsLayout.order.filter((id) => id !== widgetId);
  if (beforeId && order.includes(beforeId)) {
    const idx = order.indexOf(beforeId);
    order.splice(idx, 0, widgetId);
  } else {
    order.push(widgetId);
  }
  BB._widgetsLayout.order = order;
  bbSaveWidgetsLayout(BB._widgetsLayout);
  bbApplyWidgetsLayout();
}

function bbSetWidgetCol(widgetId, col) {
  if (!BB._widgetsLayout) BB._widgetsLayout = bbLoadWidgetsLayout();
  if (!BB._widgetsLayout.widgets[widgetId]) {
    BB._widgetsLayout.widgets[widgetId] = { col: 1, minH: 220 };
  }
  BB._widgetsLayout.widgets[widgetId].col = Math.min(bbWidgetGridColumns(), Math.max(1, col));
  bbSaveWidgetsLayout(BB._widgetsLayout);
  bbApplyWidgetsLayout();
}

function bbSetWidgetMinH(widgetId, minH) {
  if (!BB._widgetsLayout) BB._widgetsLayout = bbLoadWidgetsLayout();
  if (!BB._widgetsLayout.widgets[widgetId]) {
    BB._widgetsLayout.widgets[widgetId] = { col: 1, minH: 220 };
  }
  BB._widgetsLayout.widgets[widgetId].minH = Math.round(minH);
  bbSaveWidgetsLayout(BB._widgetsLayout);
  bbApplyWidgetsLayout();
}

function bbResetWidgetsLayout() {
  BB._widgetsLayout = JSON.parse(JSON.stringify(BB_WIDGETS_DEFAULT));
  bbSaveWidgetsLayout(BB._widgetsLayout);
  bbApplyWidgetsLayout();
  bbRenderWidgetsHiddenTray();
}

function bbSetWidgetHidden(widgetId, hidden) {
  if (!BB._widgetsLayout) BB._widgetsLayout = bbLoadWidgetsLayout();
  if (!BB._widgetsLayout.widgets[widgetId]) {
    BB._widgetsLayout.widgets[widgetId] = { col: 1, minH: 220 };
  }
  BB._widgetsLayout.widgets[widgetId].hidden = !!hidden;
  bbSaveWidgetsLayout(BB._widgetsLayout);
  bbApplyWidgetsLayout();
  bbRenderWidgetsHiddenTray();
}

function bbWidgetLabel(id) {
  const card = document.querySelector(`.bb-widget-card[data-widget-id="${id}"]`);
  const h = card?.querySelector('h3');
  return (h?.textContent || id).replace(/\s+/g, ' ').trim();
}

function bbRenderWidgetsHiddenTray() {
  const deck = document.getElementById('bbWidgetsDeck');
  if (!deck) return;
  let tray = document.getElementById('bbWidgetsHiddenTray');
  if (!tray) {
    tray = document.createElement('div');
    tray.id = 'bbWidgetsHiddenTray';
    tray.className = 'bb-widgets-hidden-tray';
    tray.hidden = true;
    deck.appendChild(tray);
  }
  const layout = BB._widgetsLayout || bbLoadWidgetsLayout();
  const hidden = layout.order.filter((id) => layout.widgets[id]?.hidden);
  const shell = document.getElementById('bbTerminal');
  if (!shell?.classList.contains('bb-layout-edit') || !hidden.length) {
    tray.hidden = true;
    tray.innerHTML = '';
    return;
  }
  tray.hidden = false;
  tray.innerHTML = `<span class="bb-widgets-hidden-label">Ocultos:</span>${hidden.map((id) =>
    `<button type="button" class="bb-widget-restore-btn" data-widget-id="${id}">${bbWidgetLabel(id)}</button>`,
  ).join('')}`;
  tray.querySelectorAll('.bb-widget-restore-btn').forEach((btn) => {
    btn.addEventListener('click', () => bbSetWidgetHidden(btn.dataset.widgetId, false));
  });
}

let _widgetDragId = null;

function bbBindWidgetsLayoutGrid() {
  const grid = document.getElementById('bbWidgetsGrid');
  const shell = document.getElementById('bbTerminal');
  if (!grid || grid.dataset.widgetsBound === '1') return;
  grid.dataset.widgetsBound = '1';

  grid.addEventListener('dragover', (e) => {
    if (!shell?.classList.contains('bb-layout-edit')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const over = e.target.closest('.bb-widget-card');
    grid.querySelectorAll('.bb-widget-card.bb-widget-drop-target').forEach((el) => {
      el.classList.remove('bb-widget-drop-target');
    });
    if (over) over.classList.add('bb-widget-drop-target');
  });

  grid.addEventListener('dragleave', (e) => {
    const card = e.target.closest?.('.bb-widget-card');
    if (card) card.classList.remove('bb-widget-drop-target');
  });

  grid.addEventListener('drop', (e) => {
    if (!shell?.classList.contains('bb-layout-edit')) return;
    e.preventDefault();
    const fromId = _widgetDragId || e.dataTransfer.getData('text/widget-id');
    const target = e.target.closest('.bb-widget-card');
    grid.querySelectorAll('.bb-widget-drop-target').forEach((el) => {
      el.classList.remove('bb-widget-drop-target');
    });
    if (!fromId) return;
    if (target && target.dataset.widgetId !== fromId) {
      bbMoveWidgetInOrder(fromId, target.dataset.widgetId);
    } else {
      bbMoveWidgetInOrder(fromId, null);
    }
    _widgetDragId = null;
  });
}

function bbBindWidgetCard(card) {
  const shell = document.getElementById('bbTerminal');
  const id = card.dataset.widgetId;
  if (!id || card.dataset.widgetChrome === '1') return;
  card.dataset.widgetChrome = '1';

  const chrome = document.createElement('div');
  chrome.className = 'bb-widget-chrome';
  chrome.innerHTML = `
    <span class="bb-widget-grip" title="Arrastrar para reordenar" draggable="true">⋮⋮</span>
    <div class="bb-widget-chrome-actions">
      <button type="button" class="bb-widget-span-btn" data-col="1" title="Mitad de ancho">½</button>
      <button type="button" class="bb-widget-span-btn" data-col="2" title="Ancho completo">⬌</button>
      <button type="button" class="bb-widget-remove-btn" title="Quitar widget">✕</button>
    </div>`;
  card.insertBefore(chrome, card.firstChild);

  const resize = document.createElement('div');
  resize.className = 'bb-widget-resize';
  resize.title = 'Arrastra para cambiar alto';
  card.appendChild(resize);

  chrome.querySelectorAll('.bb-widget-span-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!shell?.classList.contains('bb-layout-edit')) return;
      bbSetWidgetCol(id, Number(btn.dataset.col));
    });
  });

  chrome.querySelector('.bb-widget-remove-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!shell?.classList.contains('bb-layout-edit')) return;
    bbSetWidgetHidden(id, true);
  });

  const grip = chrome.querySelector('.bb-widget-grip');
  grip?.addEventListener('dragstart', (e) => {
    if (!shell?.classList.contains('bb-layout-edit')) {
      e.preventDefault();
      return;
    }
    _widgetDragId = id;
    e.dataTransfer.setData('text/widget-id', id);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('bb-widget-dragging');
  });

  card.addEventListener('dragstart', (e) => {
    if (!shell?.classList.contains('bb-layout-edit')) {
      e.preventDefault();
      return;
    }
    if (e.target !== grip && !grip?.contains(e.target)) {
      e.preventDefault();
    }
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('bb-widget-dragging');
    _widgetDragId = null;
  });

  resize.addEventListener('mousedown', (e) => {
    if (!shell?.classList.contains('bb-layout-edit')) return;
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const base = card.getBoundingClientRect().height;
    resize.classList.add('bb-dragging');
    document.body.classList.add('bb-resizing');
    const move = (ev) => {
      const h = Math.round(Math.min(720, Math.max(160, base + (ev.clientY - startY))));
      card.style.minHeight = `${h}px`;
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      resize.classList.remove('bb-dragging');
      document.body.classList.remove('bb-resizing');
      const h = parseInt(card.style.minHeight, 10) || base;
      bbSetWidgetMinH(id, h);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

function bbSetWidgetsLayoutEdit(on) {
  const grid = document.getElementById('bbWidgetsGrid');
  const deck = document.getElementById('bbWidgetsDeck');
  if (!grid) return;
  grid.querySelectorAll('.bb-widget-card').forEach((card) => {
    card.draggable = false;
    card.classList.toggle('bb-widget-editable', !!on);
    const grip = card.querySelector('.bb-widget-grip');
    if (grip) grip.draggable = !!on;
  });
  if (deck) deck.classList.toggle('bb-widgets-edit', !!on);
  bbRenderWidgetsHiddenTray();
}

function bbRefreshWidgetsLayout() {
  const grid = document.getElementById('bbWidgetsGrid');
  if (!grid) return;
  if (!BB._widgetsLayout) BB._widgetsLayout = bbLoadWidgetsLayout();
  grid.querySelectorAll('.bb-widget-card[data-widget-id]').forEach(bbBindWidgetCard);
  bbApplyWidgetsLayout();
  const shell = document.getElementById('bbTerminal');
  bbSetWidgetsLayoutEdit(shell?.classList.contains('bb-layout-edit'));
}

function setupWidgetsLayout() {
  BB._widgetsLayout = bbLoadWidgetsLayout();
  bbBindWidgetsLayoutGrid();
  bbRefreshWidgetsLayout();
  let resizeT;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => bbApplyWidgetsLayout(), 120);
  });
}

window.bbResetWidgetsLayout = bbResetWidgetsLayout;
