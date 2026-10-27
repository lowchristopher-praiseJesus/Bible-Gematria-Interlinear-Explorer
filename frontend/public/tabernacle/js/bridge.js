// The viewer's half of the postMessage protocol with the chat app. Only active when the
// viewer is embedded (?embed=1 inside a parent window); standalone it does nothing at all.
// No three/GSAP/Lenis here: main.js hands in goToSpot/goToStation, so this stays testable.

export const SPOT_IDS = ['boards', 'table', 'menorah', 'incense', 'ark', 'laver', 'altar', 'gate', 'door', 'veil'];
const STATION_COUNT = 8;

export function isEmbedded(win) {
  return new URLSearchParams(win.location.search).get('embed') === '1' && win.parent !== win;
}

// "#spot=ark" or "#station=3"; anything else (or out of range) is null
export function parseHash(hash) {
  const m = /^#(spot|station)=([a-z0-9]+)$/i.exec(hash || '');
  if (!m) return null;
  if (m[1] === 'spot') return SPOT_IDS.includes(m[2]) ? { spot: m[2] } : null;
  const n = Number(m[2]);
  return Number.isInteger(n) && n >= 0 && n < STATION_COUNT ? { station: n } : null;
}

const NOOP = { notifySpotOpened() {} };

// Returns { notifySpotOpened(id) }: main.js calls it after a panel's content is rendered.
export function initBridge({ win, goToSpot, goToStation }) {
  if (!isEmbedded(win)) return NOOP;
  const origin = win.location.origin;
  const doc = win.document;
  const post = (msg) => win.parent.postMessage(msg, origin);

  doc.documentElement.classList.add('is-embed');  // CSS hooks for the Ask button and linked refs

  // the parent drives the camera
  win.addEventListener('message', (e) => {
    if (e.origin !== origin || e.source !== win.parent) return;
    const d = e.data;
    if (!d || d.type !== 'tabernacle:goto') return;
    if (typeof d.spot === 'string' && SPOT_IDS.includes(d.spot)) goToSpot(d.spot);
    else if (Number.isInteger(d.station) && d.station >= 0 && d.station < STATION_COUNT) goToStation(d.station);
  });

  // visible references (station notes and the open panel) are links into the chat
  const sendRef = (el) => {
    const ref = el.textContent.trim();
    if (ref) post({ type: 'tabernacle:ref', ref });
  };
  doc.querySelectorAll('figcaption.ref').forEach(markLink);
  doc.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('.ref');
    if (el) { e.stopPropagation(); sendRef(el); }  // a ref click never closes the panel
  });
  doc.addEventListener('keydown', (e) => {
    const el = e.target.closest && e.target.closest('.ref');
    if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); sendRef(el); }
  });

  post({ type: 'tabernacle:ready' });
  const start = parseHash(win.location.hash);
  if (start && 'spot' in start) goToSpot(start.spot);
  else if (start) goToStation(start.station);

  return {
    notifySpotOpened(id) {
      post({ type: 'tabernacle:spot', spot: id });
      const body = doc.querySelector('.info-body');
      if (!body) return;
      body.querySelectorAll('.ref').forEach(markLink);
      const ask = doc.createElement('button');
      ask.type = 'button';
      ask.className = 'info-ask';
      ask.textContent = 'Ask about this';
      ask.addEventListener('click', () => post({ type: 'tabernacle:ask', spot: id }));
      const title = body.querySelector('h2');
      if (title) title.after(ask); else body.append(ask);
    },
  };
}

function markLink(el) {
  el.setAttribute('role', 'link');
  el.setAttribute('tabindex', '0');
}
