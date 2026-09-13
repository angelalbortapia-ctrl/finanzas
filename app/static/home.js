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

const homeTickPrices = {};

function homeTickHtml(q) {
  const pct = q.change_pct ?? 0;
  const up = pct >= 0;
  return `<a href="/emisora/${encodeURIComponent(q.symbol)}" class="bb-tick" data-symbol="${escHtml(q.symbol)}">
    <span class="bb-tick-sym">${escHtml(q.symbol)}</span>
    <span class="bb-tick-price">${fmtPrice(q.price)}</span>
    <span class="bb-tick-chg ${up ? 'up' : 'down'}">${bbPct(pct)}</span>
  </a>`;
}

function flashTickPrice(el, dir) {
  if (!el) return;
  el.classList.remove('fx-flash-up', 'fx-flash-down');
  void el.offsetWidth;
  el.classList.add(dir === 'up' ? 'fx-flash-up' : 'fx-flash-down');
}

function updateHomeTicker(quotes) {
  const track = document.getElementById('homeTickerTrack');
  if (!track) return;

  const existing = track.querySelectorAll('.bb-tick');
  if (!existing.length) {
    const html = quotes.map(homeTickHtml).join('');
    track.innerHTML = html + html;
    quotes.forEach(q => { homeTickPrices[q.symbol] = q.price; });
    return;
  }

  quotes.forEach(q => {
    const prev = homeTickPrices[q.symbol];
    homeTickPrices[q.symbol] = q.price;
    track.querySelectorAll(`.bb-tick[data-symbol="${q.symbol}"]`).forEach(tick => {
      const priceEl = tick.querySelector('.bb-tick-price');
      const chgEl = tick.querySelector('.bb-tick-chg');
      if (priceEl) {
        priceEl.textContent = fmtPrice(q.price);
        if (prev != null && q.price !== prev) {
          flashTickPrice(priceEl, q.price > prev ? 'up' : 'down');
        }
      }
      if (chgEl) {
        const up = (q.change_pct ?? 0) >= 0;
        chgEl.textContent = bbPct(q.change_pct);
        chgEl.className = 'bb-tick-chg ' + (up ? 'up' : 'down');
      }
    });
  });
}

async function refreshHomeTicker() {
  const track = document.getElementById('homeTickerTrack');
  if (!track) return;
  try {
    const res = await fetch('/api/bolsa-ticker');
    const data = await res.json();
    const quotes = (data.quotes || []).slice(0, 24);
    if (!quotes.length) return;
    updateHomeTicker(quotes);
  } catch (_) {}
}

async function refreshHomeClock() {
  try {
    const res = await fetch('/api/terminal/market');
    const market = await res.json();
    const st = document.getElementById('homeMarketStatus') || document.getElementById('chromeMarketStatus');
    const cl = document.getElementById('homeClock') || document.getElementById('chromeClock');
    if (st) {
      const prev = st.textContent;
      st.textContent = market.label || '—';
      st.className = 'bb-market-status ' + (market.status || 'closed');
      if (prev !== st.textContent && window.Forge) {
        Forge.flashEl(st, market.status === 'open' ? 'up' : 'down');
      }
    }
    if (cl) cl.textContent = (market.time_mx || '—') + ' CDMX';
  } catch (_) {}
}

function initHomeTerminal() {
  refreshHomeTicker();
  const onTerminal = !!document.getElementById('bbTerminal');
  if (!onTerminal) {
    refreshHomeClock();
    setInterval(refreshHomeClock, 5000);
  }
  setInterval(refreshHomeTicker, 45000);
}

function initPageTicker() {
  if (!document.getElementById('homeTickerTrack')) return;
  refreshHomeTicker();
  setInterval(refreshHomeTicker, 45000);
}
