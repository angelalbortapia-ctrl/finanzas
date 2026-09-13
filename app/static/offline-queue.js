/* Cola offline de movimientos — IndexedDB + sync al reconectar */

const OFFLINE_DB = 'finanzas-offline-v1';
const OFFLINE_STORE = 'tx-queue';

function openOfflineDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OFFLINE_STORE)) {
        db.createObjectStore(OFFLINE_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function offlineQueueAdd(payload) {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, 'readwrite');
    tx.objectStore(OFFLINE_STORE).add({ ...payload, queued_at: Date.now() });
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

async function offlineQueueAll() {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, 'readonly');
    const req = tx.objectStore(OFFLINE_STORE).getAll();
    req.onsuccess = () => { db.close(); resolve(req.result || []); };
    req.onerror = () => reject(req.error);
  });
}

async function offlineQueueRemove(id) {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, 'readwrite');
    tx.objectStore(OFFLINE_STORE).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

function showOfflineFlash(msg, ok = true) {
  const el = document.getElementById('offline-flash');
  if (!el) return;
  el.textContent = msg;
  el.className = `bb-flash ${ok ? 'ok' : 'err'}`;
  el.hidden = false;
}

async function flushOfflineQueue() {
  const items = await offlineQueueAll();
  if (!items.length) return 0;
  let synced = 0;
  let failed = 0;
  for (const item of items) {
    try {
      const res = await fetch('/api/movimientos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      });
      if (res.ok) {
        await offlineQueueRemove(item.id);
        synced += 1;
      } else if (res.status >= 400 && res.status < 500) {
        await offlineQueueRemove(item.id);
        failed += 1;
      }
    } catch (_) {}
  }
  if (synced > 0 && window.location.pathname === '/movimientos') {
    window.location.reload();
  } else if (failed > 0) {
    showOfflineFlash(`${failed} movimiento(s) rechazado(s) al sincronizar`, false);
  }
  return synced;
}

function initOfflineTransactions() {
  const form = document.querySelector('form[action="/movimientos"]');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    const fd = new FormData(form);
    const payload = {
      date: fd.get('date'),
      amount: parseFloat(fd.get('amount')),
      description: fd.get('description') || '',
      category: fd.get('category') || '',
      card_id: fd.get('card_id') ? parseInt(fd.get('card_id'), 10) : null,
      person_id: null,
      type: fd.get('type') || 'expense',
    };
    if (!payload.date || !payload.amount || payload.amount <= 0) return;

    if (navigator.onLine) {
      e.preventDefault();
      try {
        const res = await fetch('/api/movimientos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          window.location.href = '/movimientos?saved=1';
          return;
        }
        const err = await res.json().catch(() => ({}));
        showOfflineFlash(err.detail || 'No se pudo guardar', false);
        if (res.status >= 500) form.submit();
      } catch (_) {
        await offlineQueueAdd(payload);
        showOfflineFlash('Sin conexión — movimiento guardado localmente');
        form.reset();
      }
      return;
    }

    e.preventDefault();
    await offlineQueueAdd(payload);
    showOfflineFlash('Sin conexión — movimiento guardado localmente');
    form.reset();
  });

  window.addEventListener('online', () => {
    flushOfflineQueue().then((n) => {
      if (n > 0) showOfflineFlash(`${n} movimiento(s) sincronizado(s)`);
    });
  });

  if (navigator.onLine) flushOfflineQueue();
}

window.flushOfflineQueue = flushOfflineQueue;
window.initOfflineTransactions = initOfflineTransactions;
