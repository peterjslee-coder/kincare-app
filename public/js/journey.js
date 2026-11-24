// ─── v1.117.0 — journey tracking ───
//
// Which screen is showing, and for how long — reported to our own server (POST /api/t), never to
// a third party. src/utils/tracking.js on the server says exactly what is kept; the short version
// is: screen NAMES from the app's router, the site that sent someone here as a bare host, and the
// link they arrived on. Never an id, never a URL with a token in it, never anything typed.
//
// The visitor id is a random UUID in localStorage. It identifies a phone, not a person, until that
// person signs in (identify) — which is how "clicked Pete's text, read the splash for four minutes,
// came back a week later and signed up" becomes one story instead of three strangers.
const Journey = window.InPlaceJourney = (() => {
  const IDLE_MS = 30 * 60 * 1000;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const CLICK_IDS = ['fbclid', 'gclid', 'gbraid', 'wbraid', 'msclkid', 'ttclid', 'li_fat_id', 'twclid', 'dclid'];
  const newId = () => {
    try { if (crypto.randomUUID) return crypto.randomUUID(); } catch {}
    const b = new Uint8Array(16); crypto.getRandomValues(b);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  let vid = get('inplace_vid');
  if (!UUID_RE.test(vid || '')) { vid = newId(); set('inplace_vid', vid); }

  const platform = (() => {
    try {
      if (window.Capacitor?.isNativePlatform?.()) return window.Capacitor.getPlatform();
      if (window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone) return 'pwa';
    } catch {}
    return 'web';
  })();

  // Where this load came from — read once, then the tracking params are taken out of the address
  // bar so a copied URL doesn't credit the next person to whoever was sent the link.
  const arrival = (() => {
    const a = { l: null, utm: {}, cid: null, ref: null };
    try {
      const u = new URL(window.location.href);
      const p = u.searchParams;
      a.l = p.get('l');
      for (const k of ['source', 'medium', 'campaign', 'content', 'term']) { const v = p.get('utm_' + k); if (v) a.utm[k] = v; }
      a.cid = CLICK_IDS.find((k) => p.has(k)) || null;
      a.ref = document.referrer || null;
      let changed = false;
      for (const k of ['l', ...['source', 'medium', 'campaign', 'content', 'term'].map((x) => 'utm_' + x), ...CLICK_IDS]) {
        if (p.has(k)) { p.delete(k); changed = true; }
      }
      if (changed) window.history.replaceState(window.history.state, '', u.pathname + (p.toString() ? '?' + p.toString() : '') + u.hash);
    } catch {}
    return a;
  })();

  // An arrival that carries a source (a link code, ad tags, another site) always opens a 'start',
  // even when it lands inside a session that is still warm from a few minutes ago.
  const arrivedFromSomewhere = (() => {
    let external = false;
    try { external = !!arrival.ref && new URL(arrival.ref).host !== window.location.host; } catch {}
    return !!(arrival.l || Object.keys(arrival.utm).length || arrival.cid || external);
  })();
  let sid = null, startSent = false, sessionStartedOnce = false, current = null, since = null, queue = [], identified = null;
  const lastActive = () => Number(get('inplace_sid_at')) || 0;
  const touch = () => set('inplace_sid_at', String(Date.now()));
  const ensureSession = () => {
    const stored = get('inplace_sid');
    if (!sid && UUID_RE.test(stored || '') && Date.now() - lastActive() < IDLE_MS) { sid = stored; startSent = !arrivedFromSomewhere; }
    if (!sid || Date.now() - lastActive() >= IDLE_MS) { sid = newId(); set('inplace_sid', sid); startSent = false; }
    touch();
  };

  const flush = () => {
    if (!queue.length) return;
    const payload = JSON.stringify({ vid, sid, platform, events: queue.splice(0, 25) });
    try {
      const blob = new Blob([payload], { type: 'text/plain' });
      if (!(navigator.sendBeacon && navigator.sendBeacon('/api/t', blob))) {
        fetch('/api/t', { method: 'POST', body: payload, headers: { 'Content-Type': 'text/plain' }, keepalive: true, credentials: 'same-origin' }).catch(() => {});
      }
    } catch {}
    if (queue.length) flush();
  };

  const close = () => {
    if (current && since) {
      const ms = Date.now() - since;
      if (ms >= 1000) queue.push({ k: 'page', p: current, ms });
    }
    since = null;
  };

  const page = (name) => {
    if (!name || typeof name !== 'string' || !/^[a-z][a-z0-9_-]{0,39}$/.test(name)) return;
    if (name === current && since) return;
    close();
    ensureSession();
    if (!startSent) {
      const first = !sessionStartedOnce;
      queue.push({ k: 'start', p: name, l: first ? arrival.l : null, utm: first ? arrival.utm : {}, cid: first ? arrival.cid : null, ref: first ? arrival.ref : null });
      startSent = true; sessionStartedOnce = true;
    }
    current = name; since = Date.now();
    flush();
  };

  const identify = (userId) => {
    if (!userId || identified === userId) return;
    identified = userId;
    ensureSession();
    queue.push({ k: 'identify' });
    flush();
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { close(); touch(); flush(); }
    else if (current) { const name = current; current = null; page(name); }
  });
  window.addEventListener('pagehide', () => { close(); flush(); });

  return { page, identify, visitorId: () => vid };
})();
