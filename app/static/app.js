document.addEventListener('DOMContentLoaded', () => {
  initGreeting();
  initCounters();
  initProgressBars();
  initReveal();
  initPWA();
});

function fmtMoney(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function initSavingsWidget() {
  const form = document.getElementById('savings-form');
  const input = document.getElementById('savings-input');
  const bar = document.getElementById('savings-progress-bar');
  const text = document.getElementById('savings-progress-text');
  if (!form || !input || !bar || !text) return;

  const render = data => {
    const goal = data?.goal || 0;
    const progress = data?.progress || 0;
    const pct = goal > 0 ? Math.min(100, (progress / goal) * 100) : 0;
    bar.style.width = pct + '%';
    text.textContent = `${fmtMoney(progress)} / ${fmtMoney(goal)}`;
    if (goal > 0 && !input.value) input.value = goal;
  };

  fetch('/api/meta-ahorro').then(r => r.json()).then(render).catch(() => {});

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const v = parseFloat(input.value);
    if (isNaN(v) || v < 0) return;
    try {
      const res = await fetch('/api/meta-ahorro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: v }),
      });
      if (res.ok) render(await res.json());
    } catch (_) { /* offline */ }
  });
}

function initProWidgets() {
  const form = document.getElementById('goal-form');
  const input = document.getElementById('goal-input');
  const bar = document.getElementById('goal-progress-bar');
  const text = document.getElementById('goal-progress-text') || document.querySelector('.goal-progress-text');
  if (!form || !input || !bar || !text) return;

  const render = data => {
    const goal = data?.goal || 0;
    const paid = data?.month_payments || 0;
    const pct = goal > 0 ? Math.min(100, (paid / goal) * 100) : 0;
    bar.style.width = pct + '%';
    text.textContent = `${fmtMoney(paid)} / ${fmtMoney(goal)}`;
    if (goal > 0 && !input.value) input.value = goal;
  };

  fetch('/api/meta-pago').then(r => r.json()).then(render).catch(() => {});

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const v = parseFloat(input.value);
    if (isNaN(v) || v < 0) return;
    try {
      const res = await fetch('/api/meta-pago', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: v }),
      });
      if (res.ok) render(await res.json());
    } catch (_) { /* offline */ }
  });
}

function initPWA() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('/static/sw.js?v=54').catch(() => {});

  const banner = document.getElementById('pwa-install');
  const btn = document.getElementById('pwa-install-btn');
  const dismiss = document.getElementById('pwa-install-dismiss');
  if (!banner || !btn) return;

  let deferredPrompt = null;
  const dismissed = localStorage.getItem('pwa_install_dismissed');

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    if (!dismissed) banner.hidden = false;
  });

  btn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    banner.hidden = true;
  });

  dismiss?.addEventListener('click', () => {
    banner.hidden = true;
    localStorage.setItem('pwa_install_dismissed', '1');
  });

  window.addEventListener('appinstalled', () => {
    banner.hidden = true;
  });
}

function initPaymentNotifications() {
  const btn = document.getElementById('notify-enable-btn');
  const status = document.getElementById('notify-status');
  if (!btn || !('Notification' in window)) return;

  const updateStatus = () => {
    if (!status) return;
    if (Notification.permission === 'granted') {
      status.textContent = 'Activas · 3 días antes';
      btn.textContent = 'Revisar';
    } else if (Notification.permission === 'denied') {
      status.textContent = 'Bloqueadas en el navegador';
      btn.textContent = '—';
      btn.disabled = true;
    } else {
      status.textContent = 'Desactivadas';
      btn.textContent = 'Activar';
    }
  };

  updateStatus();

  btn.addEventListener('click', async () => {
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    updateStatus();
    if (Notification.permission === 'granted') checkUpcomingPayments(true);
  });

  if (Notification.permission === 'granted') {
    checkUpcomingPayments(false);
    setInterval(() => checkUpcomingPayments(false), 60 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkUpcomingPayments(false);
    });
    navigator.serviceWorker?.ready.then((reg) => {
      reg.active?.postMessage({ type: 'CHECK_PAYMENTS' });
    }).catch(() => {});
  }

  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type === 'CHECK_PAYMENTS') checkUpcomingPayments(false);
  });
}

async function checkUpcomingPayments(force) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const res = await fetch('/api/pagos-proximos');
    if (!res.ok) return;
    const items = await res.json();
    const todayKey = new Date().toISOString().slice(0, 10);
    for (const p of items) {
      if (p.days > 3) continue;
      const key = `notify_${p.name}_${todayKey}`;
      if (!force && localStorage.getItem(key)) continue;
      const when = p.days === 0 ? 'hoy' : p.days === 1 ? 'mañana' : `en ${p.days} días`;
      const amount = p.amount ? fmtMoney(p.amount) : '';
      new Notification(`Pago: ${p.name}`, {
        body: `${when}${amount ? ' · ' + amount : ''}`,
        icon: '/static/icons/icon-192.png',
        tag: key,
      });
      localStorage.setItem(key, '1');
    }
  } catch (_) { /* offline */ }
}

function initTransactionEditor() {
  const panel = document.getElementById('tx-edit-panel');
  const form = document.getElementById('tx-edit-form');
  const cancel = document.getElementById('tx-edit-cancel');
  if (!panel || !form) return;

  document.querySelectorAll('.tx-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      let tx;
      try {
        tx = JSON.parse(btn.dataset.tx);
      } catch (_) {
        return;
      }
      form.action = `/movimientos/${tx.id}/editar`;
      form.querySelector('[name=date]').value = tx.date;
      form.querySelector('[name=amount]').value = tx.amount;
      form.querySelector('[name=type]').value = tx.type === 'payment' ? 'payment' : 'expense';
      form.querySelector('[name=description]').value = tx.description || '';
      form.querySelector('[name=category]').value = tx.category || '';
      const cardSel = form.querySelector('[name=card_id]');
      cardSel.value = tx.card_id || '';
      panel.hidden = false;
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });

  cancel?.addEventListener('click', () => { panel.hidden = true; });
}

function initGreeting() {
  const g = document.getElementById('greeting');
  if (g) {
    const h = new Date().getHours();
    g.textContent = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  }
  const dateStr = new Date().toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  document.querySelectorAll('#today-date, #today-date-dash, .page-date').forEach(el => {
    el.textContent = dateStr;
  });
}

function initCounters() {
  if (document.body.classList.contains('forge-mode')) return;
  document.querySelectorAll('[data-count]').forEach(el => {
    const target = parseFloat(el.dataset.count);
    if (isNaN(target)) return;
    const prefix = el.dataset.prefix || '$';
    const decimals = parseInt(el.dataset.decimals ?? '0', 10);
    const dur = 1200;
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
  });
}

function initProgressBars() {
  if (document.body.classList.contains('forge-mode')) return;
  document.querySelectorAll('.progress-fill, .wc-bar-fill').forEach(el => {
    const w = el.style.width;
    if (!w) return;
    el.style.width = '0';
    requestAnimationFrame(() => { el.style.width = w; });
  });
}

function initReveal() {
  document.querySelectorAll('.reveal').forEach((el, i) => {
    el.style.transitionDelay = `${Math.min(i * 0.05, 0.3)}s`;
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); }
      });
    }, { threshold: 0.1 });
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) el.classList.add('visible');
    else obs.observe(el);
  });
}
