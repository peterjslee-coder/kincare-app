// ─── Admin queue for user-submitted reports (v1.105.21) ───
//
// App Review guideline 1.2. Reporting shipped in v1.105.18 and tells every reporter "we
// review reports within 24 hours". This is the thing that makes that sentence true rather
// than decorative.
//
// Two decisions the layout encodes:
//
// OLDEST FIRST, with age on every row. The 24-hour commitment is what is being measured,
// so the report closest to breaching it has to be the one at the top. A newest-first feed
// hides precisely the item that matters.
//
// THE SNAPSHOT IS SHOWN, NOT THE LIVE MESSAGE. Messages can be soft-deleted, and someone
// who has just been reported has an obvious motive to delete. The snapshot was taken at
// report time and is the only thing guaranteed to still exist.

const ContentReportsTab = window.ContentReportsTab = ({ apiFetch, showToast }) => {
  const [reports, setReports] = useState([]);
  const [counts, setCounts] = useState({});
  const [overdue, setOverdue] = useState(0);
  const [status, setStatus] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [notes, setNotes] = useState({});

  const load = async (s = status) => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/admin/content-reports?status=${s}`);
      if (res?.ok) {
        const d = await res.json();
        setReports(d.reports || []);
        setCounts(d.counts || {});
        setOverdue(d.overdue || 0);
      }
    } catch { showToast?.('Could not load reports', 'error'); }
    setLoading(false);
  };

  useEffect(() => { load(status); }, [status]);

  const decide = async (id, next) => {
    setBusyId(id);
    try {
      const res = await apiFetch(`/api/admin/content-reports/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: next, adminNotes: notes[id] || '' }),
      });
      if (res?.ok) { showToast?.(`Report ${next}`, 'success'); load(status); }
      else showToast?.('Could not update the report', 'error');
    } catch { showToast?.('Could not update the report', 'error'); }
    setBusyId(null);
  };

  const CATEGORY_LABEL = {
    safety_concern: "Worried about someone's safety",
    harassment: 'Harassment or abusive behaviour',
    inappropriate: 'Inappropriate content',
    scam: 'Scam or fraud',
    impersonation: 'Impersonation',
    spam: 'Spam',
    other: 'Something else',
  };

  return (
    <div>
      <div className="card">
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span>User Reports</span>
          {/* The overdue count is the headline number: it is the commitment, in the UI, at
              all times. Green when zero rather than hidden, so "we're clear" is a state you
              can see rather than infer from absence. */}
          <span style={{
            fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
            background: overdue ? 'var(--color-error)' : 'var(--color-success, #1b6b5a)', color: '#fff',
          }}>
            {overdue ? `${overdue} past 24h` : 'None past 24h'}
          </span>
          <div style={{ flex: 1 }} />
          {['pending', 'reviewed', 'actioned', 'dismissed'].map(s => (
            <button key={s} onClick={() => setStatus(s)}
              style={{
                padding: '5px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                fontWeight: status === s ? 700 : 500,
                border: '1px solid ' + (status === s ? 'var(--color-primary)' : 'var(--border-color)'),
                background: status === s ? 'var(--color-primary)' : 'var(--bg-surface)',
                color: status === s ? '#fff' : 'var(--text-secondary)',
              }}>
              {s}{counts[s] ? ` (${counts[s]})` : ''}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Loading…</div>
        ) : !reports.length ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
            Nothing {status}.
          </div>
        ) : reports.map(r => (
          <div key={r.id} style={{ padding: '14px 16px', borderTop: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <strong style={{ fontSize: 14 }}>{CATEGORY_LABEL[r.category] || r.category}</strong>
              <span style={{
                fontSize: 11, fontWeight: 700, color: r.ageHours >= 24 ? 'var(--color-error)' : 'var(--text-muted)',
              }}>
                {r.ageHours}h old
              </span>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                {r.reporter_first} {r.reporter_last} reported {r.reported_first ? `${r.reported_first} ${r.reported_last}` : 'content'}
                {r.reported_role ? ` (${r.reported_role})` : ''}
              </span>
            </div>

            {r.details && (
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8, whiteSpace: 'pre-wrap' }}>
                {r.details}
              </div>
            )}

            {r.snapshot?.content && (
              <div style={{
                padding: '10px 12px', background: 'var(--bg-highlight)', borderRadius: 8,
                fontSize: 13, marginBottom: 10, borderLeft: '3px solid var(--color-error)',
              }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', marginBottom: 4 }}>
                  Reported message — captured at report time
                </div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{r.snapshot.content}</div>
              </div>
            )}

            {status === 'pending' && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input value={notes[r.id] || ''} onChange={e => setNotes({ ...notes, [r.id]: e.target.value })}
                  placeholder="What did you do about it?"
                  style={{ flex: 1, minWidth: 180, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-color)', fontSize: 12 }} />
                <button disabled={busyId === r.id} onClick={() => decide(r.id, 'actioned')}
                  style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--color-error-fill)', color: 'var(--text-on-primary)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  Actioned
                </button>
                <button disabled={busyId === r.id} onClick={() => decide(r.id, 'reviewed')}
                  style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-surface)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Reviewed, no action
                </button>
                <button disabled={busyId === r.id} onClick={() => decide(r.id, 'dismissed')}
                  style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-surface)', fontSize: 12, color: 'var(--text-tertiary)', cursor: 'pointer' }}>
                  Dismiss
                </button>
              </div>
            )}
            {r.admin_notes && status !== 'pending' && (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>{r.admin_notes}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
