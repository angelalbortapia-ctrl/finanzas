/* Dashboard — ticker y reloj de mercado */

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bbPct(n) {
  const v = Number(n) || 0;
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

function fmtPrice(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const v = Number(n);
  if (v >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (v >= 100) return '$' + v.toFixed(2);
  return '$' + v.toFixed(4);
}

function homeTickHtml(q) {
  const pct = q.change_pct ?? 0;
  const up = pct >= 0;
  return `<a href="/inversiones" class="bb-tick" data-symbol="${escHtml(q.symbol)}">
    <span class="bb-tick-sym">${escHtml(q.symbol)}</span>
    <span class="bb-tick-price">${fmtPrice(q.price)}</span>
    <span class="bb-tick-chg ${up ? 'up' : 'down'}">${bbPct(pct)}</span>
  </a>`;
}

async function refreshHomeTicker() {
  const track = document.getElementById('homeTickerTrack');
  if (!track) return;
  try {
    const res = await fetch('/api/bolsa-ticker');
    const data = await res.json();
    const quotes = (data.quotes || []).slice(0, 24);
    if (!quotes.length) return;
    const html = quotes.map(homeTickHtml).join('');
    track.innerHTML = html + html;
  } catch (_) {}
}

async function refreshHomeClock() {
  try {
    const res = await fetch('/api/terminal/market');
    const market = await res.json();
    const st = document.getElementById('homeMarketStatus');
    const cl = document.getElementById('homeClock');
    if (st) {
      st.textContent = market.label || '—';
      st.className = 'bb-market-status ' + (market.status || 'closed');
    }
    if (cl) cl.textContent = (market.time_mx || '—') + ' CDMX';
  } catch (_) {}
}

function initHomeTerminal() {
  refreshHomeTicker();
  refreshHomeClock();
  setInterval(refreshHomeTicker, 45000);
  setInterval(refreshHomeClock, 5000);
}

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('bbHome')) initHomeTerminal();
});
