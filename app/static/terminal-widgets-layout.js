/* Deck de widgets bajo la gráfica — orden, ancho (1/2 col) y alto */

const BB_WIDGETS_LAYOUT_KEY = 'bb_widgets_layout_v10';
const BB_WIDGETS_LAYOUT_LEGACY = ['bb_widgets_layout_v9', 'bb_widgets_layout_v8', 'bb_widgets_layout_v7'];

const BB_WIDGETS_DEFAULT = {
  order: [
    'analysts',
    'stats',
    'tv-scan',
    'earnings', 'dividends', 'tv-technical',
    'trends', 'health',
    'margins', 'profile',
    'tv-symbol',
    'google-news',
  ],
  widgets: {
    stats: { col: 2, minH: 300 },
    analysts: { col: 2, minH: 320 },
    'tv-scan': { col: 1, minH: 240 },
    'tv-technical': { col: 1, minH: 400 },
    earnings: { col: 1, minH: 280 },
    dividends: { col: 1, minH: 320 },
    trends: { col: 2, minH: 300 },
    health: { col: 1, minH: 300 },
    margins: { col: 1, minH: 220 },
    profile: { col: 2, minH: 280 },
    'tv-symbol': { col: 1, minH: 480 },
    'google-news': { col: 2, minH: 340 },
  },
};

/** Dividendos + análisis técnico TV en la misma fila (mitad y mitad). */
function bbWidgetsOrderPairDividendsTech(order) {
  const ids = order.filter(Boolean);
  const tech = 'tv-technical';
  const div = 'dividends';
  if (!ids.includes(div) || !ids.includes(tech)) return ids;
  const withoutTech = ids.filter((id) => id !== tech);
  const divIdx = withoutTech.indexOf(div);
  withoutTech.splice(divIdx + 1, 0, tech);
  return withoutTech;
}

function bbNormalizeWidgetsLayout(parsed) {
  const base = JSON.parse(JSON.stringify(BB_WIDGETS_DEFAULT));
  if (!parsed || typeof parsed !== 'object') return base;
  let order = Array.isArray(parsed.order) ? [...parsed.order] : base.order;
  BB_WIDGETS_DEFAULT.order.forEach((id) => {
    if (!order.includes(id)) order.push(id);
  });
  const preferred = BB_WIDGETS_DEFAULT.order;
  const merged = [];
  preferred.forEach((id) => {
    if (order.includes(id)) merged.push(id);
  });
  order.forEach((id) => {
    if (!merged.includes(id)) merged.push(id);
  });
  base.order = bbWidgetsOrderPairDividendsTech(merged);
  Object.keys(BB_WIDGETS_DEFAULT.widgets).forEach((id) => {
    const def = BB_WIDGETS_DEFAULT.widgets[id];
    const saved = parsed.widgets?.[id] || {};
    let col = Math.min(2, Math.max(1, Number(saved.col) || def.col || 1));
    if (id === 'tv-technical') col = 1;
    let minH = Number(saved.minH);
    if (!Number.isFinite(minH) || minH <= 0) minH = def.minH || 0;
    minH = Math.round(Math.min(960, Math.max(0, minH)));
    base.widgets[id] = { col, minH, hidden: !!saved.hidden };
  });
  return base;
}

function bbLoadWidgetsLayout() {
  try {
    let raw = localStorage.getItem(BB_WIDGETS_LAYOUT_KEY);
    if (!raw) {
      for (const legacy of BB_WIDGETS_LAYOUT_LEGACY) {
        raw = localStorage.getItem(legacy);
        if (raw) break;
      }
    }
    if (!raw) return JSON.parse(JSON.stringify(BB_WIDGETS_DEFAULT));
    return bbNormalizeWidgetsLayout(JSON.parse(raw));
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
    const def = BB_WIDGETS_DEFAULT.widgets[id] || { col: 1, minH: 260 };
    const spec = layout.widgets[id] || def;
    if (spec.hidden) {
      card.hidden = true;
      card.style.display = 'none';
      return;
    }
    card.hidden = false;
    card.style.display = '';
    const col = Math.min(maxCol, Math.max(1, spec.col || def.col || 1));
    let rawH = spec.minH != null ? spec.minH : (def.minH || 0);
    if (!Number.isFinite(rawH) || rawH <= 0) rawH = def.minH || 260;
    const minH = Math.round(Math.min(960, Math.max(140, rawH)));
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

/** Tarjeta bajo (x,y); no depende de pointer-events del contenido. */
function bbWidgetCardAtPoint(x, y, exceptId) {
  const grid = document.getElementById('bbWidgetsGrid');
  if (!grid) return null;
  const cards = [...grid.querySelectorAll('.bb-widget-card[data-widget-id]')].filter((c) => {
    if (exceptId && c.dataset.widgetId === exceptId) return false;
    const r = c.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  });
  return cards.length ? cards[cards.length - 1] : null;
}

function bbBindWidgetsLayoutGrid() {
  const grid = document.getElementById('bbWidgetsGrid');
  const shell = document.getElementById('bbTerminal');
  if (!grid || grid.dataset.widgetsBound === '1') return;
  grid.dataset.widgetsBound = '1';

  grid.addEventListener('dragover', (e) => {
    if (!shell?.classList.contains('bb-layout-edit')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const over = e.target.closest('.bb-widget-card')
      || bbWidgetCardAtPoint(e.clientX, e.clientY, _widgetDragId);
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
    const target = e.target.closest('.bb-widget-card')
      || bbWidgetCardAtPoint(e.clientX, e.clientY, fromId);
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
  const grid = document.getElementById('bbWidgetsGrid');

  const clearDropTargets = () => {
    grid?.querySelectorAll('.bb-widget-card.bb-widget-drop-target').forEach((el) => {
      el.classList.remove('bb-widget-drop-target');
    });
  };

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
    clearDropTargets();
    _widgetDragId = null;
  });

  /* Reordenar con puntero (hit-test por rectángulo; evita iframes y pointer-events) */
  grip?.addEventListener('pointerdown', (e) => {
    if (!shell?.classList.contains('bb-layout-edit') || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    grip.setPointerCapture(e.pointerId);
    card.classList.add('bb-widget-dragging');
    document.body.classList.add('bb-widget-reordering');

    const onMove = (ev) => {
      clearDropTargets();
      const over = bbWidgetCardAtPoint(ev.clientX, ev.clientY, id);
      if (over) over.classList.add('bb-widget-drop-target');
    };
    const onUp = (ev) => {
      try { grip.releasePointerCapture(ev.pointerId); } catch (_) {}
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      card.classList.remove('bb-widget-dragging');
      document.body.classList.remove('bb-widget-reordering');
      const over = bbWidgetCardAtPoint(ev.clientX, ev.clientY, id);
      clearDropTargets();
      if (over) bbMoveWidgetInOrder(id, over.dataset.widgetId);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  });

  const startHeightDrag = (e) => {
    if (!shell?.classList.contains('bb-layout-edit') || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const base = Math.max(card.getBoundingClientRect().height, parseInt(card.style.minHeight, 10) || 0);
    resize.classList.add('bb-dragging');
    document.body.classList.add('bb-resizing');
    const move = (ev) => {
      const h = Math.round(Math.min(960, Math.max(140, base + (ev.clientY - startY))));
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
  };
  resize.addEventListener('mousedown', startHeightDrag);
  resize.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    startHeightDrag(e);
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
  bbSaveWidgetsLayout(BB._widgetsLayout);
  bbBindWidgetsLayoutGrid();
  bbRefreshWidgetsLayout();
  let resizeT;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => bbApplyWidgetsLayout(), 120);
  });
}

window.bbResetWidgetsLayout = bbResetWidgetsLayout;
