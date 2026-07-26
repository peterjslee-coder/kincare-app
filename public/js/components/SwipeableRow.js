// ─── SwipeableRow (v1.101.0) ────────────────────────────────────────────
// iOS-style swipe-left-to-reveal-actions for feed rows (Pete: "I see the
// med reminder was two hours ago — let me swipe it away").
//
// Pointer events, so the same gesture works for touch (PWA/WKWebView) AND
// mouse drag on desktop. touch-action: pan-y keeps vertical scrolling
// intact; we only claim the gesture once movement is clearly horizontal.
//
// Usage:
//   <SwipeableRow marginBottom={8} actions={[
//     { label: '✓ Done', background: 'var(--color-success)', onTap: ... },
//     { label: 'Dismiss', background: 'var(--text-muted)', onTap: ... },
//   ]}>
//     ...row card (no outer margin — the wrapper owns spacing)...
//   </SwipeableRow>
//
// Design note: actions decide semantics. Dismissing a care task maps to the
// existing 'skipped' status (on the record, attributed, undoable) — swipe is
// a shortcut, never a way for care state to vanish silently.

const SwipeableRow = window.SwipeableRow = ({ actions, children, marginBottom = 8, borderRadius = 12 }) => {
  const [dx, setDx] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const drag = useRef(null); // { x, y, base, horiz, moved, pointerId }

  const enabled = Array.isArray(actions) && actions.length > 0;
  const W = enabled ? actions.length * 92 : 0;

  if (!enabled) return <div style={{ marginBottom }}>{children}</div>;

  const settle = (open) => { setIsOpen(open); setDx(open ? -W : 0); };

  const onPointerDown = (e) => {
    // Ignore secondary buttons; let taps through untouched.
    if (e.button != null && e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, base: isOpen ? -W : 0, horiz: null, moved: false, pointerId: e.pointerId };
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const mx = e.clientX - d.x, my = e.clientY - d.y;
    if (d.horiz === null) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return; // not sure yet
      d.horiz = Math.abs(mx) > Math.abs(my);
      if (d.horiz) {
        try { e.currentTarget.setPointerCapture(d.pointerId); } catch {}
      }
    }
    if (!d.horiz) return;
    d.moved = true;
    // Left swipe only; small rubber-band past the action tray.
    setDx(Math.max(-W - 24, Math.min(0, d.base + mx)));
  };

  const onPointerEnd = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.moved) return;
    settle(dx < -W / 2);
  };

  // A row that's swiped open shouldn't fire its normal tap action —
  // first tap just closes the tray (standard iOS behavior).
  const onClickCapture = (e) => {
    if (isOpen || dx !== 0) {
      e.stopPropagation();
      e.preventDefault();
      settle(false);
    }
  };

  return (
    <div style={{ position: 'relative', marginBottom, borderRadius, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: W, display: 'flex' }}>
        {actions.map((a, i) => (
          <button key={i}
            onClick={() => { settle(false); a.onTap(); }}
            style={{
              flex: 1, border: 'none', cursor: 'pointer',
              background: a.background || 'var(--text-muted)',
              color: a.color || 'var(--text-on-primary)',
              fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
            }}>
            {a.label}
          </button>
        ))}
      </div>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={onClickCapture}
        style={{
          transform: `translateX(${dx}px)`,
          transition: drag.current && drag.current.moved ? 'none' : 'transform 0.18s ease',
          touchAction: 'pan-y',
          background: 'var(--bg-surface)',
          borderRadius,
        }}>
        {children}
      </div>
    </div>
  );
};
