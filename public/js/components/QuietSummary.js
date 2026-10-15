// ─── "While you were away" — the list behind the summary (v1.119.1) ───
//
// Pete, 10/15 (0783ec12): "I got a push notification that there was one update while I was
// away. I clicked on it and it opened the app, but I have no idea what it was. I looked at
// the activity center and saw that there was one update while I was away, and I clicked on it
// and it just disappeared."
//
// Three faults, one experience. The server kept only a COUNT of what it held, so the summary
// could say "1 update" and nothing more. Its only action was "go to Home", so tapping it in
// Activity marked it read and the row dropped out of an unread list. And the thing actually
// held was most often a message, which the family Activity card leaves out on purpose
// (messages have their own badge), so nowhere on the screen said what it was.
//
// The summary row now carries the held items (utils/quietHours.js → inAppData.items), and
// this draws them inside it. Tapping the summary does NOT clear it; tapping an item opens
// that item and clears both. "Done" clears the summary without opening anything.

/** The held items a notification stands for, or null when it is not a quiet-hours summary. */
const quietSummaryItems = window.quietSummaryItems = (n) => {
  if (!n || n.type !== 'quiet_hours_summary') return null;
  try {
    const d = n.data ? (typeof n.data === 'string' ? JSON.parse(n.data) : n.data) : null;
    return Array.isArray(d && d.items) ? d.items : [];
  } catch { return []; }
};

const QuietSummaryItems = window.QuietSummaryItems = ({ items, onOpenItem, onDone }) => {
  const timeOf = (at) => {
    if (!at) return '';
    try { return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; }
  };
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {items.map((item) => (
        <button key={item.id} type="button"
          onClick={(e) => { e.stopPropagation(); onOpenItem && onOpenItem(item); }}
          style={{
            display: 'flex', alignItems: 'baseline', gap: 8, width: '100%', textAlign: 'left',
            padding: '6px 8px', background: 'var(--bg-elevated)', border: 'none', borderRadius: 8,
            cursor: 'pointer', font: 'inherit', color: 'var(--text-primary)',
          }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, minWidth: 52, fontVariantNumeric: 'tabular-nums' }}>{timeOf(item.at)}</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>{item.title}</span>
          <span style={{ fontSize: 12, color: 'var(--role-color)', fontWeight: 600, flexShrink: 0 }}>Open</span>
        </button>
      ))}
      {onDone && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onDone(); }}
          style={{ alignSelf: 'flex-end', marginTop: 2, padding: '3px 8px', background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>
          Done
        </button>
      )}
    </div>
  );
};
