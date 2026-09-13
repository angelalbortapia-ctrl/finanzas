/* Forge UI — chrome global, palette, status bar, animaciones */

const Forge = {
  escHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  logoHtml(symbol, extraCls = '') {
    const sym = (symbol || '').replace('BMV:', '').toUpperCase();
    const init = Forge.escHtml(sym.slice(0, 2));
    const src = Forge.escHtml(`/api/terminal/logo/${encodeURIComponent(sym)}`);
    const cls = extraCls ? ` ${extraCls}` : '';
    return `<span class="bb-watch-logo-wrap${cls}" data-symbol="${Forge.escHtml(sym)}">
      <img class="bb-watch-logo" src="${src}" alt="" loading="lazy"
        onerror="this.style.display='none';this.parentElement.classList.add('bb-watch-logo-wrap--fb');">
      <span class="bb-watch-logo-fb" aria-hidden="true">${init}</span>
    </span>`;
  },

  weightBar(pct) {
    const w = Math.min(100, Math.max(0, Number(pct) || 0));
    return `<div class="bb-weight-bar" title="${w.toFixed(1)}%"><div class="bb-weight-fill" style="width:${w}%"></div></div>`;
  },

  flashEl(el, dir) {
    if (!el) return;
    el.classList.remove('flash-up', 'flash-down');
    void el.offsetWidth;
    el.classList.add(dir === 'up' ? 'flash-up' : 'flash-down');
  },

  fmtMoney(n) {
    if (n == null || Number.isNaN(n)) return '—';
    return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  },
};

const PALETTE_COMMANDS = [
  { type: 'nav', id: 'home', label: 'Inicio', sub: 'Dashboard patrimonial', keys: ['inicio', 'home', 'dash'], href: '/' },
  { type: 'nav', id: 'cards', label: 'Tarjetas', sub: 'Crédito y líneas', keys: ['tarjetas', 'tc', 'cards'], href: '/tarjetas' },
  { type: 'nav', id: 'gbm', label: 'Terminal GBM', sub: 'Mercados y portafolio', keys: ['gbm', 'terminal', 'inversiones', 'bolsa'], href: '/inversiones' },
  { type: 'nav', id: 'pat', label: 'Patrimonio', sub: 'Historial y cierre de mes', keys: ['patrimonio', 'pat'], href: '/patrimonio' },
  { type: 'nav', id: 'sim', label: 'Simulador', sub: 'Plan de liquidación TC', keys: ['simulador', 'sim', 'deuda'], href: '/simulador' },
  { type: 'nav', id: 'mov', label: 'Movimientos', sub: 'Gastos y pagos', keys: ['movimientos', 'mov', 'gastos'], href: '/movimientos' },
  { type: 'action', id: 'new', label: '+ Nuevo movimiento', sub: 'Registrar gasto o pago', keys: ['nuevo', 'gasto', 'pago', 'n'], href: '/movimientos#nuevo' },
  { type: 'action', id: 'pdf', label: 'Reporte PDF', sub: 'Resumen mensual', keys: ['pdf', 'reporte'], href: '/exportar/mensual.pdf' },
  { type: 'action', id: 'csv', label: 'Portafolio CSV', sub: 'Exportar posiciones', keys: ['csv', 'export'], href: '/exportar/portafolio.csv' },
  { type: 'nav', id: 'cfg', label: 'Configuración', sub: 'PIN, reimportar Excel', keys: ['config', 'ajustes', 'settings'], href: '/configuracion' },
];

let paletteIdx = 0;
let paletteItems = [];

function isTypingContext() {
  const el = document.activeElement;
  if (!el) return false;
  if (el.id === 'bbPaletteInput' || el.id === 'bbCommand') return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function openPalette(prefill = '') {
  const pal = document.getElementById('bbPalette');
  const input = document.getElementById('bbPaletteInput');
  if (!pal || !input) return;
  pal.hidden = false;
  pal.setAttribute('aria-hidden', 'false');
  input.value = prefill;
  renderPaletteResults(prefill);
  requestAnimationFrame(() => input.focus());
}

function closePalette() {
  const pal = document.getElementById('bbPalette');
  if (!pal) return;
  pal.hidden = true;
  pal.setAttribute('aria-hidden', 'true');
}

async function searchTickers(q) {
  if (!q || q.length < 1) return [];
  try {
    const res = await fetch(`/api/terminal/catalog?q=${encodeURIComponent(q)}&limit=8`);
    const data = await res.json();
    return (data.items || []).map(i => ({
      type: 'ticker',
      id: i.symbol,
      label: i.symbol,
      sub: (i.name || '').slice(0, 40),
      href: `/inversiones?symbol=${encodeURIComponent(i.symbol)}`,
      symbol: i.symbol,
    }));
  } catch (_) {
    return [];
  }
}

function matchCommands(q) {
  const qq = (q || '').toLowerCase().trim();
  if (!qq) return PALETTE_COMMANDS.slice(0, 8);
  return PALETTE_COMMANDS.filter(c =>
    c.label.toLowerCase().includes(qq)
    || c.keys.some(k => k.includes(qq) || qq.includes(k))
    || (c.sub || '').toLowerCase().includes(qq)
  ).slice(0, 8);
}

let paletteSearchSeq = 0;

async function renderPaletteResults(q) {
  const el = document.getElementById('bbPaletteResults');
  if (!el) return;
  const seq = ++paletteSearchSeq;
  const cmds = matchCommands(q);
  const tickers = q && q.length >= 2 && !q.startsWith('/') ? await searchTickers(q) : [];
  if (seq !== paletteSearchSeq) return;
  paletteItems = [...cmds, ...tickers];
  paletteIdx = 0;
  if (!paletteItems.length) {
    el.innerHTML = '<div class="bb-palette-empty">Sin resultados</div>';
    return;
  }
  el.innerHTML = paletteItems.map((item, i) => {
    const icon = item.type === 'ticker'
      ? Forge.logoHtml(item.symbol, 'bb-palette-logo')
      : `<span class="bb-palette-icon">${item.type === 'action' ? '›' : '◆'}</span>`;
    return `<button type="button" class="bb-palette-item ${i === 0 ? 'active' : ''}" data-idx="${i}">
      ${icon}
      <span class="bb-palette-item-body">
        <span class="bb-palette-item-label">${Forge.escHtml(item.label)}</span>
        <span class="bb-palette-item-sub">${Forge.escHtml(item.sub || '')}</span>
      </span>
      <span class="bb-palette-item-type">${item.type === 'ticker' ? 'BMV' : ''}</span>
    </button>`;
  }).join('');
  el.querySelectorAll('.bb-palette-item').forEach(btn => {
    btn.addEventListener('click', () => activatePaletteItem(+btn.dataset.idx));
  });
}

function activatePaletteItem(idx) {
  const item = paletteItems[idx];
  if (!item) return;
  closePalette();
  if (item.type === 'ticker' && document.getElementById('bbTerminal') && typeof loadSymbol === 'function') {
    loadSymbol(item.symbol);
    return;
  }
  if (item.href) window.location.href = item.href;
}

function initGlobalPalette() {
  const btn = document.getElementById('bbPaletteBtn');
  const backdrop = document.getElementById('bbPaletteBackdrop');
  const input = document.getElementById('bbPaletteInput');
  btn?.addEventListener('click', () => openPalette());
  backdrop?.addEventListener('click', closePalette);

  let timer;
  input?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => renderPaletteResults(input.value.trim()), 120);
  });

  input?.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closePalette(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      paletteIdx = Math.min(paletteIdx + 1, paletteItems.length - 1);
      highlightPaletteItem();
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      paletteIdx = Math.max(paletteIdx - 1, 0);
      highlightPaletteItem();
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      activatePaletteItem(paletteIdx);
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === '/' && !isTypingContext()) {
      const onTerminal = !!document.getElementById('bbTerminal');
      const cmd = document.getElementById('bbCommand');
      if (onTerminal && cmd) {
        e.preventDefault();
        cmd.focus();
        cmd.select?.();
        return;
      }
      e.preventDefault();
      openPalette();
    }
    if ((e.key === 'n' || e.key === 'N') && !isTypingContext() && !e.metaKey && !e.ctrlKey) {
      const onMov = document.body.classList.contains('page-transactions');
      const onTerminal = !!document.getElementById('bbTerminal');
      if (!onMov && !onTerminal) {
        e.preventDefault();
        window.location.href = '/movimientos#nuevo';
      }
    }
    if (e.key === 'Escape') closePalette();
  });
}

function highlightPaletteItem() {
  document.querySelectorAll('.bb-palette-item').forEach((el, i) => {
    el.classList.toggle('active', i === paletteIdx);
    if (i === paletteIdx) el.scrollIntoView({ block: 'nearest' });
  });
}

async function refreshStatusBar() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    const onTerminal = !!document.getElementById('bbTerminal');
    const market = document.getElementById('bbStatusMarket');
    const prices = document.getElementById('bbStatusPrices');
    const net = document.getElementById('bbStatusNet');
    const chromeMarket = document.getElementById('chromeMarketStatus');
    const chromeClock = document.getElementById('chromeClock');

    if (market && data.market) {
      market.textContent = `Mercado: ${data.market.label || '—'}`;
    }
    if (!onTerminal && chromeMarket && data.market) {
      chromeMarket.textContent = data.market.label || '—';
      chromeMarket.className = 'bb-market-status ' + (data.market.status || 'closed');
    }
    if (!onTerminal && chromeClock && data.market?.time_mx) {
      chromeClock.textContent = data.market.time_mx + ' CDMX';
    }
    const pm = data.price_meta || {};
    if (prices) {
      prices.textContent = `GBM: ${pm.source_label || '—'} · ${pm.fetched_age || 'sin actualizar'}`;
    }
    if (net && data.net_worth != null) {
      const prev = parseFloat(net.dataset.value || '');
      const val = data.net_worth;
      net.textContent = `Neto: ${Forge.fmtMoney(val)}`;
      net.dataset.value = String(val);
      if (!Number.isNaN(prev) && prev !== val) {
        Forge.flashEl(net, val > prev ? 'up' : 'down');
      }
    }
    const chromeNet = document.getElementById('bbChromeNet');
    if (chromeNet && data.net_worth != null) {
      const prev = parseFloat(chromeNet.dataset.live || chromeNet.dataset.count || '');
      chromeNet.dataset.live = String(data.net_worth);
      chromeNet.textContent = Forge.fmtMoney(data.net_worth);
      if (!Number.isNaN(prev) && prev !== data.net_worth) {
        Forge.flashEl(chromeNet, data.net_worth > prev ? 'up' : 'down');
      }
    }
  } catch (_) {}
}

function initStatusBar() {
  const hints = document.getElementById('bbStatusHints');
  if (hints) {
    const onTerminal = !!document.getElementById('bbTerminal');
    hints.textContent = onTerminal
      ? 'Ajustar en barra del terminal · / comando'
      : '⊞ Ajustar layout · / buscar · N movimiento';
  }
  refreshStatusBar();
  setInterval(refreshStatusBar, 30000);
}

function initPortfolioRowLinks() {
  document.querySelectorAll('tr[data-href]').forEach(row => {
    row.addEventListener('click', () => {
      const href = row.dataset.href;
      if (href) window.location.href = href;
    });
    row.addEventListener('dblclick', () => {
      const href = row.dataset.hrefAlt;
      if (href) window.location.href = href;
    });
  });
}

function initForgeCounters() {
  document.querySelectorAll('[data-count]:not(#bbChromeNet)').forEach(el => {
    const target = parseFloat(el.dataset.count);
    if (isNaN(target)) return;
    const prefix = el.dataset.prefix || '$';
    const decimals = parseInt(el.dataset.decimals ?? '0', 10);
    const dur = 1000;
    const t0 = performance.now();
    const step = now => {
      const p = Math.min((now - t0) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 4);
      el.textContent = prefix + (target * eased).toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    el.dataset.live = String(target);
  });
}

function initStaggerReveal() {
  const groups = [
    { sel: '.bb-home-hero-strip', delay: 0 },
    { sel: '.bb-home-kpi', stagger: 55, base: 80 },
    { sel: '.bb-home .bb-panel, .bb-page .bb-panel', stagger: 70, base: 120 },
    { sel: '.bb-home .wallet-card', stagger: 60, base: 150 },
    { sel: '.bb-tbl tbody tr', stagger: 35, base: 180, max: 12 },
  ];

  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('fx-in');
      obs.unobserve(entry.target);
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -20px 0px' });

  groups.forEach(g => {
    const nodes = document.querySelectorAll(g.sel);
    nodes.forEach((el, i) => {
      if (g.stagger) {
        const cap = g.max ? Math.min(i, g.max) : i;
        el.style.animationDelay = `${g.base + cap * g.stagger}ms`;
      } else if (g.delay) {
        el.style.animationDelay = `${g.delay}ms`;
      }
      obs.observe(el);
    });
  });
}

function initBarAnimations() {
  document.querySelectorAll('.wc-bar-fill, .bb-weight-fill').forEach((el, i) => {
    const w = el.style.width;
    if (!w || w === '0' || w === '0%') return;
    el.style.width = '0';
    el.style.transition = 'none';
    requestAnimationFrame(() => {
      setTimeout(() => {
        el.style.transition = 'width .85s cubic-bezier(.22, 1, .36, 1)';
        el.style.width = w;
      }, 80 + i * 40);
    });
  });
}

function initPanelHoverRipple() {
  document.querySelectorAll('.bb-home-link, .bb-chrome-search, .btn-primary').forEach(btn => {
    btn.addEventListener('click', e => {
      const r = document.createElement('span');
      r.className = 'fx-ripple';
      const rect = btn.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      r.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - rect.left - size / 2}px;top:${e.clientY - rect.top - size / 2}px`;
      btn.style.position = 'relative';
      btn.style.overflow = 'hidden';
      btn.appendChild(r);
      setTimeout(() => r.remove(), 500);
    });
  });
}

function initKpiFlash() {
  document.querySelectorAll('[data-live-kpi]').forEach(el => {
    const key = el.dataset.liveKpi;
    const val = parseFloat(el.dataset.value);
    if (!key || isNaN(val)) return;
    try {
      const prev = parseFloat(sessionStorage.getItem(`kpi:${key}`) || '');
      if (!isNaN(prev) && prev !== val) {
        Forge.flashEl(el, val > prev ? 'up' : 'down');
      }
      sessionStorage.setItem(`kpi:${key}`, String(val));
    } catch (_) {}
  });
}

function initTheme() {
  const btn = document.getElementById('bbThemeBtn');
  const stored = localStorage.getItem('finanzas-theme');
  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  const theme = stored || (prefersLight ? 'light' : 'dark');
  document.documentElement.dataset.theme = theme;
  if (btn) btn.textContent = theme === 'light' ? '☀' : '◐';
  btn?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('finanzas-theme', next);
    btn.textContent = next === 'light' ? '☀' : '◐';
  });
}

function initForge() {
  if (!document.body.classList.contains('forge-mode')) return;
  initTheme();
  if (typeof initGreeting === 'function') initGreeting();
  initGlobalPalette();
  initStatusBar();
  initForgeCounters();
  initKpiFlash();
  initPortfolioRowLinks();
  initStaggerReveal();
  initBarAnimations();
  initPanelHoverRipple();
  if (typeof initPaymentNotifications === 'function') initPaymentNotifications();
  if (document.getElementById('bbHome') && typeof initHomeTerminal === 'function') {
    initHomeTerminal();
  } else if (typeof initPageTicker === 'function') {
    initPageTicker();
  }
  if (typeof initTransactionEditor === 'function' && document.getElementById('tx-edit-form')) {
    initTransactionEditor();
  }
  if (typeof initOfflineTransactions === 'function' && document.querySelector('form[action="/movimientos"]')) {
    initOfflineTransactions();
  }
  if (typeof setupForgeLayout === 'function') setupForgeLayout();
}

window.Forge = Forge;

document.addEventListener('DOMContentLoaded', initForge);
