// ─── "What needs you" — the list behind the number (v1.105.42) ───
//
// Pete, 8/6, screenshot of a red 78 on the app icon: "I don't know how to clear any of
// them and I don't know what they are."
//
// Two complaints, and the second one survives fixing the first. Even with a correct count,
// a badge is a number with no referent: tapping the icon opens the dashboard, and the app
// never says which four things it is talking about. A number you can't decompose is a
// number you can only ignore — which is precisely the outcome the count's definition was
// designed to avoid.
//
// So this card is the badge, itemised. Same endpoint the icon reads, so they cannot
// disagree, and every row goes to the place where you clear it. When there is nothing
// waiting, it renders nothing at all — the dashboard is crowded (his words) and a card
// saying "you're all caught up" is decoration.

// v1.105.105 — `page` must be a page app.js actually renders. `timeChanges` pointed at
// 'sessions', which is not one: renderPage falls through to <Dashboard/>, so tapping the row
// re-rendered the screen Pete was already on. "It doesn't do anything. It is a dead end."
// (917f3787.) tests/attentionCardTargets.test.js now checks every value here against app.js.
//
// `focus` names the field on the payload holding the id of the exact thing to open. A count
// with no destination is what made this a dead end in the first place.
const ATTENTION_ROWS = [
  { key: 'reimbursements', icon: '💵', page: 'care-team',
    one: 'reimbursement waiting for your approval',
    many: 'reimbursements waiting for your approval' },
  { key: 'timeChanges', icon: '🕑', page: 'dashboard', focus: 'timeChangeSessionId', focusPrefix: 'session',
    one: 'schedule change waiting on your answer',
    many: 'schedule changes waiting on your answer' },
  { key: 'careTasks', icon: '✅', page: 'care-team',
    one: 'care task assigned to you is due',
    many: 'care tasks assigned to you are due' },
  // Unread messages deliberately absent — v1.105.105. Pete: they "should not" be here, they
  // belong "over the message pill", which already carries them (app.js `unreadMsgCount`).
  // `total` no longer counts them either, so this list and the app icon still agree.
];

const AttentionCard = window.AttentionCard = ({ onNavigate }) => {
  const [counts, setCounts] = React.useState(null);
  // v1.105.51 — a failed load used to render exactly nothing, which on this card means
  // "you're all caught up". That is the one lie this component cannot afford: the app icon
  // may be showing a number while the card that is supposed to itemise it isn't there.
  // (Also `res.ok` not `res?.ok` — apiFetch returns null on its 401 path, which threw
  // straight into the same silent catch.)
  const [loadFailed, setLoadFailed] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await apiFetch('/api/push/attention');
      if (!res?.ok) { setLoadFailed(true); return; }
      setCounts(await res.json());
      setLoadFailed(false);
    } catch { setLoadFailed(true); }
  }, []);

  React.useEffect(() => {
    load();
    // Same trigger as the icon badge: whatever you just cleared, the card agrees when you
    // come back to it.
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [load]);

  if (loadFailed && !counts) {
    return (
      <div style={{
        background: 'var(--card-bg, #fff)', border: '1px solid var(--border-color, #e0e0e0)',
        borderRadius: 12, padding: '12px 16px', marginBottom: 16,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ flex: 1, fontSize: 13, color: 'var(--text-secondary)' }}>
          Couldn't load what needs you.
        </span>
        <button onClick={load} style={{
          background: 'none', border: 'none', color: 'var(--accent-color)',
          font: 'inherit', fontSize: 13, fontWeight: 650, cursor: 'pointer', padding: 0,
        }}>Retry</button>
      </div>
    );
  }

  if (!counts || !counts.total) return null; // nothing waiting → nothing drawn

  const rows = ATTENTION_ROWS
    .map((r) => ({ ...r, n: Number(counts[r.key]) || 0 }))
    .filter((r) => r.n > 0);
  if (!rows.length) return null;

  return (
    <div style={{
      background: 'var(--card-bg, #fff)', border: '1px solid var(--border-color, #e0e0e0)',
      borderLeft: '4px solid var(--accent-color, #2e7d6f)', borderRadius: 12,
      padding: '14px 16px', marginBottom: 16,
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>
        {counts.total === 1 ? 'Needs you (1)' : `Needs you (${counts.total})`}
      </div>
      {rows.map((r) => (
        <button
          key={r.key}
          onClick={() => {
            // Open the exact item, not just the page it lives on. Consumed by Dashboard /
            // CaretakerHub, which open the visit detail for `session:<id>`.
            const id = r.focus && counts[r.focus];
            if (id) window.__pendingFocus = `${r.focusPrefix}:${id}`;
            if (onNavigate) onNavigate(r.page);
            // This card lives inside Dashboard, and onNavigate is setCurrentPage, which does
            // not remount it — so a mount-time read of __pendingFocus would never fire when
            // the target page is the one we are already on. Announce it instead.
            if (id) setTimeout(() => window.dispatchEvent(new Event('inplace:focus')), 0);
          }}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%',
            background: 'none', border: 'none', borderTop: '1px solid var(--border-color, #eee)',
            padding: '10px 0', cursor: 'pointer', textAlign: 'left', font: 'inherit',
            color: 'var(--text-primary)',
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 16 }}>{r.icon}</span>
          <span style={{ flex: 1, fontSize: 14 }}>
            <strong>{r.n}</strong> {r.n === 1 ? r.one : r.many}
          </span>
          <span aria-hidden="true" style={{ color: 'var(--text-tertiary)', fontSize: 18 }}>›</span>
        </button>
      ))}
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8 }}>
        This is the number on the app icon. It clears as you deal with each one.
      </div>
    </div>
  );
};
