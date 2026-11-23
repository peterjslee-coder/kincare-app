// ─── ReadReceiptBar — "Got it — mark read" on care notes and visit reports (v1.148.0) ───
//
// Pete, 11/22: "I have no way of knowing whether or not my sis and bro are reading anything
// on app... there should be a big green 'Got it! - Mark Read'."
//
// The server sends the whole block with the note or visit (utils/readReceipts.js):
//   { readBy:[{userId,name,readAt}], notYet:[{userId,name}], readByMe, myReadAt, canMark }
// This component owns its own copy after that, so a tap never has to refetch the page, and
// every answer from the server replaces the copy whole (someone else may have read it since).
//
// What it draws:
//   · not read yet, and you are someone who should → the big green button
//   · read by you → a quiet "✓ You read this" with Undo
//   · always, when there is anything to say → "Seen by …" and, for recent things, "Not yet: …"
const ReadReceiptBar = window.ReadReceiptBar = ({ targetType, targetId, receipts, timezone, compact = false }) => {
  const { showToast } = useToast();
  const [block, setBlock] = React.useState(receipts || null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { setBlock(receipts || null); }, [targetId, receipts]);
  if (!block || !targetId) return null;

  const first = (name) => String(name || '').split(' ')[0] || 'Someone';
  const when = (at) => {
    if (!at) return '';
    try {
      return (typeof TimezoneHelper !== 'undefined' && TimezoneHelper.formatTimestamp(at, timezone,
        { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) || '';
    } catch { return ''; }
  };

  const send = async (method) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/read-receipts/${targetType}/${targetId}`, { method });
      if (res && res.ok) {
        const d = await res.json();
        if (d && d.readReceipts) setBlock(d.readReceipts);
      } else {
        showToast(method === 'POST' ? "Couldn't mark it read — try again" : "Couldn't undo that", 'error');
      }
    } catch {
      showToast("Couldn't reach InPlace — try again", 'error');
    }
    setBusy(false);
  };

  const seen = (block.readBy || []);
  const notYet = block.notYet || [];
  const showButton = block.canMark && !block.readByMe;

  return (
    <div data-testid="read-receipts" onClick={(e) => e.stopPropagation()} style={{ marginTop: 8 }}>
      {showButton && (
        <button data-testid="mark-read" onClick={() => send('POST')} disabled={busy}
          style={{
            display: 'block', width: '100%', minHeight: compact ? 44 : 52,
            background: 'var(--color-success, #2e7d32)', color: '#fff',
            border: 'none', borderRadius: 12, font: 'inherit',
            fontSize: compact ? 15 : 17, fontWeight: 800, letterSpacing: 0.2,
            cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1,
          }}>
          {busy ? 'Saving…' : '✓ Got it! — Mark read'}
        </button>
      )}
      {block.readByMe && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700, color: 'var(--color-success)' }}>
          <span>{'✓'} You read this{block.myReadAt ? ` · ${when(block.myReadAt)}` : ''}</span>
          <button onClick={() => send('DELETE')} disabled={busy}
            style={{ background: 'none', border: 'none', padding: '2px 4px', minHeight: 0, color: 'var(--text-muted)', font: 'inherit', fontSize: 12, fontWeight: 600, textDecoration: 'underline', cursor: 'pointer' }}>
            Undo
          </button>
        </div>
      )}
      {(seen.length > 0 || notYet.length > 0) && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.5 }}>
          {seen.length > 0 && (
            <div data-testid="seen-by">
              <span style={{ fontWeight: 700, color: 'var(--color-success)' }}>Seen by </span>
              {seen.map((r, i) => (
                <span key={r.userId}>{i > 0 ? ', ' : ''}{first(r.name)}
                  <span style={{ color: 'var(--text-muted)' }}>{r.readAt ? ` (${when(r.readAt)})` : ''}</span>
                </span>
              ))}
            </div>
          )}
          {notYet.length > 0 && (
            <div data-testid="not-yet">
              <span style={{ fontWeight: 700, color: 'var(--text-muted)' }}>Not yet: </span>
              {notYet.map((r) => first(r.name)).join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
