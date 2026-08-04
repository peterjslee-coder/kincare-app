// ─── AttachmentViewer (v1.105.34) ───
//
// Pete, Aug 4: clicking a receipt opened a new tab that said "Authentication required",
// and even when it worked it downloaded a file instead of showing the picture.
//
// Both symptoms had one cause: the attachment was a plain
// `<a href="/api/…" target="_blank">`. A raw link is an UNAUTHENTICATED navigation. The
// Railway log for the $600 sink receipt reads:
//
//   [Auth 401] No token — path: /api/reimbursements/receipt/2c1c…, hasBearerHeader: false,
//              hasCookie: false, cookieKeys:
//
// NO cookies at all — not even CSRF. The auth cookie is httpOnly/SameSite=Lax on path "/",
// so a same-origin tab would have sent it. An empty cookie jar means the link opened
// somewhere else entirely: in the Capacitor app, `target="_blank"` hands the URL to the
// system browser, which has its own jar and no session. It failed the same way for every
// family member on a phone, on every attachment in the app — receipts in two places, and
// care-note photos.
//
// So attachments are fetched through apiFetch — which carries the Bearer token and the
// cookie — turned into a blob URL, and shown in the app. A blob URL needs no credentials,
// which is also what makes Save (and PDF rendering) work everywhere the raw link did not.
//
// Blobs are cached by URL so a thumbnail and its full-size view share one fetch; the cache
// is capped and evicts oldest-first, revoking as it goes, because an object URL that is
// never revoked is a leak that survives every re-render.

const ATTACHMENT_CACHE_LIMIT = 30;
const __attachmentBlobCache = window.__attachmentBlobCache = new Map(); // url → { url, mime }

const loadAuthedBlob = window.loadAuthedBlob = async (path) => {
  const hit = __attachmentBlobCache.get(path);
  if (hit) return hit;
  const res = await apiFetch(path);
  if (!res || !res.ok) {
    let msg = 'Could not load this attachment.';
    try { const d = await res.json(); if (d && d.error) msg = d.error; } catch {}
    throw new Error(msg);
  }
  const blob = await res.blob();
  const entry = { url: URL.createObjectURL(blob), mime: blob.type || '' };
  __attachmentBlobCache.set(path, entry);
  while (__attachmentBlobCache.size > ATTACHMENT_CACHE_LIMIT) {
    const oldestKey = __attachmentBlobCache.keys().next().value;
    const oldest = __attachmentBlobCache.get(oldestKey);
    __attachmentBlobCache.delete(oldestKey);
    try { URL.revokeObjectURL(oldest.url); } catch {}
  }
  return entry;
};

// An attachment is { path, name, mime }. Receipts and note photos differ only in `path`.
const receiptAttachment = window.receiptAttachment = (rc) => ({
  path: `/api/reimbursements/receipt/${rc.id}`,
  name: rc.file_name || 'receipt',
  mime: rc.mime_type || '',
});

const isPdfAttachment = (a) => /pdf/i.test((a && (a.mime || a.name)) || '');

// ─── AttachmentThumb — the small tile in a row ───
//
// Lazily loaded. A family ledger can hold dozens of rows; fetching every image on render
// would be a burst of megabyte requests for pictures nobody has looked at yet. The tile
// only fetches once it is actually near the screen.
const AttachmentThumb = window.AttachmentThumb = ({ attachment, size = 56, onOpen }) => {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  const boxRef = useRef(null);
  const pdf = isPdfAttachment(attachment);

  useEffect(() => {
    if (pdf || !boxRef.current) return;
    let cancelled = false;
    const fetchIt = () => {
      loadAuthedBlob(attachment.path)
        .then((e) => { if (!cancelled) setSrc(e.url); })
        .catch(() => { if (!cancelled) setFailed(true); });
    };
    if (typeof IntersectionObserver === 'undefined') { fetchIt(); return () => { cancelled = true; }; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); fetchIt(); }
    }, { rootMargin: '200px' });
    io.observe(boxRef.current);
    return () => { cancelled = true; io.disconnect(); };
  }, [attachment.path, pdf]);

  return (
    <button ref={boxRef} onClick={onOpen} title={attachment.name} aria-label={`View ${attachment.name}`}
      style={{
        width: size, height: size, borderRadius: 8, border: '1px solid var(--border-light)',
        background: 'var(--bg-primary)', cursor: 'pointer', overflow: 'hidden', padding: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
      {pdf ? (
        <span style={{ fontSize: 20 }} role="img" aria-hidden="true">📄</span>
      ) : failed ? (
        <span style={{ fontSize: 10, color: 'var(--text-muted)', padding: 4, textAlign: 'center' }}>No preview</span>
      ) : src ? (
        <img src={src} alt={attachment.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <span style={{ fontSize: 16, opacity: 0.4 }} role="img" aria-hidden="true">📎</span>
      )}
    </button>
  );
};

// ─── AttachmentViewer — full-screen, pinch to zoom ───
const AttachmentViewer = window.AttachmentViewer = ({ attachments, startIndex = 0, onClose }) => {
  const list = attachments || [];
  const [idx, setIdx] = useState(Math.min(Math.max(startIndex, 0), Math.max(list.length - 1, 0)));
  const [entry, setEntry] = useState(null);
  const [error, setError] = useState('');
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });

  const current = list[idx];
  const pdf = isPdfAttachment(current);

  // Gesture bookkeeping. Refs, not state: these change on every touchmove and must not
  // queue a re-render each time.
  const gesture = useRef({ mode: null, startDist: 0, startScale: 1, startX: 0, startY: 0, originX: 0, originY: 0, lastTap: 0 });

  const reset = () => setView({ scale: 1, x: 0, y: 0 });

  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    setEntry(null); setError(''); reset();
    loadAuthedBlob(current.path)
      .then((e) => { if (!cancelled) setEntry(e); })
      .catch((err) => { if (!cancelled) setError(err.message || 'Could not load this attachment.'); });
    return () => { cancelled = true; };
  }, [current && current.path]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && idx < list.length - 1) setIdx(idx + 1);
      if (e.key === 'ArrowLeft' && idx > 0) setIdx(idx - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [idx, list.length, onClose]);

  const clampScale = (s) => Math.min(Math.max(s, 1), 6);

  const zoomAt = (nextScale, px, py, rect) => {
    // Keep the point under the fingers (or cursor) put. Without this the image lurches away
    // from whatever you were trying to look at, which is the whole point of zooming.
    setView((v) => {
      const s = clampScale(nextScale);
      const cx = px - rect.left - rect.width / 2;
      const cy = py - rect.top - rect.height / 2;
      const ratio = s / v.scale;
      return { scale: s, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio };
    });
  };

  const onTouchStart = (e) => {
    const g = gesture.current;
    if (e.touches.length === 2) {
      const a = e.touches[0], b = e.touches[1];
      g.mode = 'pinch';
      g.startDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
      g.startScale = view.scale;
      g.originX = (a.clientX + b.clientX) / 2;
      g.originY = (a.clientY + b.clientY) / 2;
    } else if (e.touches.length === 1) {
      const now = Date.now();
      if (now - g.lastTap < 300) {
        // Double-tap: in if we are out, out if we are in.
        const rect = e.currentTarget.getBoundingClientRect();
        if (view.scale > 1) reset();
        else zoomAt(2.5, e.touches[0].clientX, e.touches[0].clientY, rect);
        g.lastTap = 0;
        g.mode = null;
        return;
      }
      g.lastTap = now;
      g.mode = view.scale > 1 ? 'pan' : null;
      g.startX = e.touches[0].clientX - view.x;
      g.startY = e.touches[0].clientY - view.y;
    }
  };

  const onTouchMove = (e) => {
    const g = gesture.current;
    if (g.mode === 'pinch' && e.touches.length === 2) {
      const a = e.touches[0], b = e.touches[1];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
      const rect = e.currentTarget.getBoundingClientRect();
      zoomAt(g.startScale * (dist / g.startDist), g.originX, g.originY, rect);
    } else if (g.mode === 'pan' && e.touches.length === 1) {
      setView((v) => ({ ...v, x: e.touches[0].clientX - g.startX, y: e.touches[0].clientY - g.startY }));
    }
  };

  const onTouchEnd = () => { gesture.current.mode = null; };

  const onWheel = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    zoomAt(view.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY, rect);
  };

  if (!current) return null;

  const btn = {
    background: 'rgba(255,255,255,0.14)', color: '#fff', border: 'none', borderRadius: 8,
    padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 10000,
      display: 'flex', flexDirection: 'column',
      paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', color: '#fff', flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {current.name}
          {list.length > 1 && <span style={{ opacity: 0.6, fontWeight: 400 }}>{`  ${idx + 1} of ${list.length}`}</span>}
        </div>
        {!pdf && view.scale > 1 && <button onClick={reset} style={btn}>Reset</button>}
        {/* A blob URL carries no credentials, so this works everywhere the raw API link did
            not — including the system browser the native app opens links in. */}
        {entry && <a href={entry.url} download={current.name} style={{ ...btn, textDecoration: 'none' }}>Save</a>}
        <button onClick={onClose} aria-label="Close" style={{ ...btn, fontSize: 18, lineHeight: 1, padding: '6px 12px' }}>✕</button>
      </div>

      <div
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onWheel={onWheel}
        style={{
          flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          touchAction: 'none', // the browser must not steal the pinch — we handle it
        }}
      >
        {error ? (
          <div style={{ color: '#fff', padding: 24, textAlign: 'center', fontSize: 14 }}>{error}</div>
        ) : !entry ? (
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14 }}>Loading…</div>
        ) : pdf ? (
          <iframe title={current.name} src={entry.url}
            style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }} />
        ) : (
          <img src={entry.url} alt={current.name} draggable="false"
            style={{
              maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              transition: gesture.current.mode ? 'none' : 'transform 0.15s ease-out',
              willChange: 'transform', userSelect: 'none',
            }} />
        )}
      </div>

      {list.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, padding: '10px 12px', flexShrink: 0 }}>
          <button onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx === 0}
            style={{ ...btn, opacity: idx === 0 ? 0.35 : 1 }}>‹ Previous</button>
          <button onClick={() => setIdx(Math.min(list.length - 1, idx + 1))} disabled={idx === list.length - 1}
            style={{ ...btn, opacity: idx === list.length - 1 ? 0.35 : 1 }}>Next ›</button>
        </div>
      )}

      {!pdf && !error && entry && (
        <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.55)', fontSize: 11, paddingBottom: 8 }}>
          Pinch or double-tap to zoom
        </div>
      )}
    </div>
  );
};
