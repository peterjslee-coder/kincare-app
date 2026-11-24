// ─── CancelSessionModal ───
// One cancel flow, used by every screen that can cancel a session.
//
// Before this component the flow existed only inside Dashboard.js, which is why
// "Cancel requests from Schedule page" sat open for five months: the work wasn't
// a button, it was 60 lines of fee-preview and copy that nobody wanted to clone.
// Cloning it would also have split the v1.105.15 wording fix across two files —
// the copy below states whatever the SERVER will really do, and it must keep
// doing that in one place only.
//
// Props (already normalised by the caller, because Dashboard and Schedule get
// their sessions from different endpoints with different field names):
//   sessionId      — care_sessions.id
//   dateISO        — "YYYY-MM-DD"
//   time           — "HH:MM"
//   timezone       — care recipient's tz; falls back to the caller's default
//   caregiverName  — falsy means nobody is assigned, which means free to cancel
//   recipientName  — display only
//   onClose()      — dismiss without cancelling
//   onCancelled(d) — server said yes; d is the parsed response body
//   role           — 'family' (default) or 'caregiver' (v1.125.2: one cancel screen for both)
//
// v1.125.2 — Pete, 10/28: "I cannot tell if this session is canceled on November 3 or if she's
// canceled the entire series … we need a feature by which she is prompted whether she's canceling
// a day in the series or the entire series." When the preview says the visit is part of a series
// with later visits this person could cancel, they choose — and nothing is pre-chosen, so a
// series is never cancelled by someone who only meant one day.
const CancelSessionModal = window.CancelSessionModal = ({
  sessionId, dateISO, time, timezone, caregiverName, recipientName, onClose, onCancelled, role = 'family',
}) => {
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState(null); // null until chosen, when there is a choice

  // Fee preview. `unavailable` is a THIRD state, not a synonym for "no fee" —
  // an unreachable preview must never render as a reassuring one.
  useEffect(() => {
    if (!sessionId) { setPreview(null); return; }
    let stale = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/sessions/${sessionId}/cancel-preview`);
        if (!stale && res && res.ok) setPreview(await res.json());
        else if (!stale) setPreview({ unavailable: true });
      } catch { if (!stale) setPreview({ unavailable: true }); }
    })();
    return () => { stale = true; };
  }, [sessionId]);

  const sessionDT = TimezoneHelper.buildDateTime((dateISO || '').split('T')[0], time || '00:00', timezone);
  const hoursAway = (sessionDT.getTime() - TimezoneHelper.realNowMs()) / (1000 * 60 * 60);
  const hasCaregiver = !!caregiverName;
  const isLate = hasCaregiver && hoursAway < 24;

  const series = preview && !preview.unavailable && preview.series ? preview.series : null;
  const needChoice = !!series && !scope;

  const submit = async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/sessions/${sessionId}/cancel`, {
        method: 'PUT',
        body: JSON.stringify({ reason: reason || (role === 'caregiver' ? 'Cancelled by caregiver' : 'Cancelled by family'), scope: scope === 'series' ? 'series' : 'one' }),
      });
      if (res && res.ok) {
        const d = await res.json();
        onCancelled && onCancelled(d);
      } else {
        const err = res ? await res.json().catch(() => ({})) : {};
        alert((err && err.error) || 'Failed to cancel session');
      }
    } catch { alert('Failed to cancel session'); }
    setLoading(false);
  };

  return (
    // stopPropagation: since v1.125.2 this also opens from INSIDE VisitDetailModal, whose overlay
    // closes on any click that bubbles up to it — a tap on a radio button would close both.
    <div onClick={(e) => e.stopPropagation()} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1001 }}>
      <div style={{ background: 'var(--bg-surface)', borderRadius: 12, padding: 24, width: 400, maxWidth: '90vw' }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 18 }}>Cancel visit</h3>
        <div style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 12 }}>
          {recipientName} — {dateISO ? TimezoneHelper.parseDate(dateISO).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''} at {time}
        </div>
        {series && (
          <div role="radiogroup" aria-label="Which visits" style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>This visit is part of a series. Cancel:</div>
            {[
              { id: 'one', label: `Just ${series.thisDay}`, sub: `The other ${series.laterCount} ${series.laterCount === 1 ? 'visit stays' : 'visits stay'} as booked.` },
              { id: 'series', label: `${series.thisDay} and the ${series.laterCount} after it`, sub: `Every visit through ${series.lastDay}.` },
            ].map((o) => (
              <label key={o.id} style={{
                display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', marginBottom: 6, borderRadius: 8, cursor: 'pointer',
                border: scope === o.id ? '2px solid var(--role-color)' : '1px solid var(--border-color)', background: 'var(--bg-surface)',
              }}>
                <input type="radio" name="cancel-scope" checked={scope === o.id} onChange={() => setScope(o.id)} style={{ marginTop: 3 }} />
                <span>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{o.label}</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)' }}>{o.sub}</span>
                </span>
              </label>
            ))}
          </div>
        )}
        {!hasCaregiver && role !== 'caregiver' && (
          <div style={{ padding: '10px 14px', background: 'var(--color-success-bg)', borderRadius: 8, border: '1px solid #c8e6c9', marginBottom: 12, fontSize: 13, color: 'var(--color-success)' }}>
            No caregiver assigned yet — free to cancel with no fee.
          </div>
        )}
        {/* v1.105.15 — this used to hardcode "You will still be charged for this
            session", which was wrong twice over: the contract charges a posted
            cancellation FEE rather than the session price, and no fee was ever
            actually taken. Now it states whatever the server will really do. */}
        {isLate && role !== 'caregiver' && (
          <div style={{ padding: '10px 14px', background: 'var(--color-warning-bg)', borderRadius: 8, border: '1px solid #ffe082', marginBottom: 12, fontSize: 13, color: 'var(--color-warning)' }}>
            {preview && !preview.unavailable
              ? preview.message
              : preview && preview.unavailable
                ? <span>This is a <strong>late cancellation</strong> (less than 24 hours before the session). We could not check whether a cancellation fee applies.</span>
                : <span>Checking whether a cancellation fee applies&hellip;</span>}
          </div>
        )}
        {role === 'caregiver' && (
          // Carried over from Find Work's own cancel box, which this screen replaces (v1.125.2).
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>
            {scope === 'series' ? 'These visits go' : 'The visit goes'} back to the open pool for another caregiver.
            {isLate ? ' Because it is less than 24 hours away, the family will be able to leave a review.' : ''}
          </div>
        )}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 4 }}>Reason (optional)</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)}
            placeholder="Why are you cancelling?"
            style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-color)', fontSize: 13, minHeight: 60, resize: 'vertical' }} />
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={() => { setReason(''); onClose && onClose(); }}
            style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-surface)', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: 'var(--text-primary)' }}>
            Keep it
          </button>
          <button onClick={submit} disabled={loading || needChoice} title={needChoice ? 'Choose which visits first' : undefined}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: loading || needChoice ? 'var(--text-muted)' : 'var(--color-error)', color: 'var(--text-on-primary)', fontSize: 13, fontWeight: 600, cursor: loading || needChoice ? 'default' : 'pointer' }}>
            {loading ? 'Cancelling...' : scope === 'series' && series ? `Cancel ${series.laterCount + 1} visits` : 'Cancel visit'}
          </button>
        </div>
      </div>
    </div>
  );
};
