// ─── Money view (v1.96.0) ───
// One financial picture per care team for the leader + billing contact:
// summary totals, the full reimbursement ledger (requested / approved / paid /
// declined, with notes + receipts), and care-session payments. Filterable,
// with CSV export. From Pete's 7/12 feedback; folds in "Payments page v2".
const MoneyView = window.MoneyView = ({ careTeamId, onClose }) => {
  const { showToast } = useToast(); // v1.105.49 — the export now reports its outcome
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewingAttachments, setViewingAttachments] = useState(null); // v1.105.34 — { list, index }
  const [statusFilter, setStatusFilter] = useState('all');
  const [personFilter, setPersonFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(`/api/reimbursements/money/${careTeamId}`);
        if (res?.ok) setData(await res.json());
        else {
          const d = await res?.json().catch(() => null);
          setError(d?.error || 'Could not load the money view');
        }
      } catch { setError('Could not load the money view'); }
      setLoading(false);
    })();
  }, [careTeamId]);

  const fmt = (n) => `$${Number(n || 0).toFixed(2)}`;
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

  const statusBadge = (status) => {
    const map = {
      // v1.105.35 — the v1.105.34 unification missed this one, and it is the worst place
      // to miss it: the note on a row says "Awaiting approval" while the badge on that SAME
      // row said "Pending", in the same colour.
      pending: { label: 'Awaiting approval', bg: '#fff3e0', fg: '#e65100' },
      approved: { label: 'Approved — awaiting payment', bg: '#e3f2fd', fg: '#1565c0' },
      paid: { label: 'Paid', bg: '#e8f5e9', fg: '#2e7d32' },
      declined: { label: 'Declined', bg: '#ffebee', fg: '#c62828' },
      cancelled: { label: 'Cancelled', bg: 'var(--bg-primary)', fg: 'var(--text-muted)' },
      completed: { label: 'Completed', bg: '#e8f5e9', fg: '#2e7d32' },
    };
    const c = map[status] || { label: status, bg: 'var(--bg-primary)', fg: 'var(--text-secondary)' };
    return <span style={{ fontSize: 11, fontWeight: 600, color: c.fg, background: c.bg, padding: '2px 8px', borderRadius: 10, whiteSpace: 'nowrap' }}>{c.label}</span>;
  };

  const reimbs = data?.reimbursements || [];
  const payments = data?.payments || [];
  const s = data?.summary || {};

  const people = [...new Map(reimbs.map((r) => [r.payee_user_id, `${r.payee_first_name} ${r.payee_last_name}`])).entries()];
  const categories = [...new Set(reimbs.map((r) => r.category).filter(Boolean))];

  const filtered = reimbs.filter((r) =>
    (statusFilter === 'all' || r.status === statusFilter) &&
    (personFilter === 'all' || r.payee_user_id === personFilter) &&
    (categoryFilter === 'all' || r.category === categoryFilter)
  );

  const noteFor = (r) => {
    if (r.status === 'declined') return r.declined_reason ? `Declined: ${r.declined_reason}` : 'Declined';
    if (r.status === 'paid') return `Paid ${fmtDate(r.paid_at)}${r.paid_method ? ` via ${r.paid_method}` : ''}${r.paid_reference ? ` (${r.paid_reference})` : ''}`;
    if (r.status === 'approved') return `Approved${r.approver_first_name ? ` by ${r.approver_first_name}` : ''} ${fmtDate(r.approved_at)}`;
    if (r.status === 'pending') return 'Awaiting approval';
    return '';
  };

  const exportCsv = async () => {
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = [
      ['Date', 'Type', 'Person', 'Description', 'Category', 'Amount', 'Status', 'Notes'].map(esc).join(','),
      ...filtered.map((r) => [
        r.expense_date || (r.created_at || '').slice(0, 10), 'Reimbursement',
        `${r.payee_first_name} ${r.payee_last_name}`, r.description, r.category, Number(r.amount).toFixed(2), r.status, noteFor(r),
      ].map(esc).join(',')),
      ...payments.map((p) => [
        (p.scheduled_date || p.created_at || '').slice(0, 10), 'Session payment',
        p.caregiver_name || '', p.service_type || 'Care session', 'care', Number(p.amount).toFixed(2), p.status,
        p.paid_by_name ? `Paid by ${p.paid_by_name}${p.payment_method ? ` (${p.payment_method})` : ''}` : (p.payment_method || ''),
      ].map(esc).join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    // v1.105.49 — `<a download>` is a no-op in the iOS app, so this button did nothing at
    // all there and said nothing about it. saveBlob reports whether the file really landed.
    const saved = await saveBlob(blob, `inplace-money-${new Date().toISOString().slice(0, 10)}.csv`);
    if (!saved && typeof showToast === 'function') {
      showToast("Couldn't save the file on this device — try exporting from a browser.", 'error');
    }
  };

  const tile = (label, value, sub) => (
    <div style={{ flex: '1 1 130px', background: 'var(--bg-primary)', borderRadius: 10, padding: '12px 14px', minWidth: 130 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );

  const selStyle = { padding: '8px 10px', border: '1px solid var(--border-light)', borderRadius: 8, fontSize: 13, background: 'var(--bg-card)', color: 'var(--text-primary)' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '24px 12px' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 14, width: '100%', maxWidth: 860, padding: 18, boxShadow: '0 8px 40px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 17 }}>💰 Money{data?.recipientFirstName ? ` — ${data.recipientFirstName}'s care team` : ''}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {!loading && !error && (
              <button onClick={exportCsv} style={{ padding: '6px 12px', background: 'var(--bg-card)', color: 'var(--role-color)', border: '1px solid var(--role-color)', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                ⬇ CSV
              </button>
            )}
            <button onClick={onClose} style={{ padding: '6px 12px', background: 'var(--bg-primary)', color: 'var(--text-secondary)', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>✕ Close</button>
          </div>
        </div>

        {loading && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>}
        {error && <div style={{ padding: 20, color: '#c62828', fontSize: 14 }}>{error}</div>}

        {!loading && !error && (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              {tile('Pending', fmt(s.pendingTotal), `${s.pendingCount || 0} request${s.pendingCount === 1 ? '' : 's'}`)}
              {tile('Awaiting payment', fmt(s.approvedAwaitingTotal), `${s.approvedAwaitingCount || 0} approved`)}
              {tile('Paid this month', fmt(s.paidThisMonthTotal))}
              {tile('Paid this year', fmt(s.paidYtdTotal), s.declinedCount ? `${s.declinedCount} declined` : null)}
              {payments.length > 0 && tile('Care sessions YTD', fmt(s.sessionPaymentsYtdTotal))}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selStyle}>
                <option value="all">All statuses</option>
                <option value="pending">Awaiting approval</option>
                <option value="approved">Approved — awaiting payment</option>
                <option value="paid">Paid</option>
                <option value="declined">Declined</option>
                <option value="cancelled">Cancelled</option>
              </select>
              {people.length > 1 && (
                <select value={personFilter} onChange={(e) => setPersonFilter(e.target.value)} style={selStyle}>
                  <option value="all">Everyone</option>
                  {people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              )}
              {categories.length > 1 && (
                <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={selStyle}>
                  <option value="all">All categories</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
            </div>

            <div style={{ fontWeight: 600, fontSize: 14, margin: '8px 0 6px' }}>Reimbursements</div>
            {filtered.length === 0 && <div style={{ padding: 14, color: 'var(--text-muted)', fontSize: 13 }}>Nothing matches these filters.</div>}
            {filtered.map((r) => (
              <div key={r.id} style={{ borderTop: '1px solid var(--border-light)', padding: '10px 2px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <div style={{ flex: '0 0 78px', fontSize: 12, color: 'var(--text-secondary)' }}>{fmtDate(r.expense_date || r.created_at)}</div>
                <div style={{ flex: '1 1 220px' }}>
                  <div style={{ fontSize: 14 }}>
                    <strong>{r.payee_first_name} {r.payee_last_name}</strong> — {r.description}
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}> · {r.category}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {noteFor(r)}
                    {/* v1.105.29 — an empty receipt list must READ as empty. Rendering nothing is
                        indistinguishable from a permissions problem, and on a large number that is
                        the difference between approving and going to ask somewhere else. */}
                    {(r.receipts || []).length === 0 && (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No receipt attached</span>
                    )}

                    {/* v1.105.34 — thumbnails, not raw links. See AttachmentViewer.js: an
                        `<a href="/api/…" target="_blank">` is an UNAUTHENTICATED request and
                        401'd for anyone opening it from the native app. */}
                    {(r.receipts || []).length > 0 && (
                      <span style={{ display: 'inline-flex', gap: 6, marginLeft: 8, verticalAlign: 'middle' }}>
                        {(r.receipts || []).map((rc, i) => (
                          <AttachmentThumb key={rc.id} size={40} attachment={receiptAttachment(rc)}
                            onOpen={() => setViewingAttachments({
                              list: (r.receipts || []).map(receiptAttachment), index: i,
                            })} />
                        ))}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ flex: '0 0 80px', fontWeight: 700, fontSize: 14, textAlign: 'right' }}>{fmt(r.amount)}</div>
                <div style={{ flex: '0 0 auto' }}>{statusBadge(r.status)}</div>
              </div>
            ))}

            {payments.length > 0 && (
              <>
                <div style={{ fontWeight: 600, fontSize: 14, margin: '18px 0 6px' }}>Care session payments</div>
                {payments.map((p) => (
                  <div key={p.id} style={{ borderTop: '1px solid var(--border-light)', padding: '10px 2px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
                    <div style={{ flex: '0 0 78px', fontSize: 12, color: 'var(--text-secondary)' }}>{fmtDate(p.scheduled_date || p.created_at)}</div>
                    <div style={{ flex: '1 1 220px', fontSize: 14 }}>
                      <strong>{p.caregiver_name || 'Caregiver'}</strong> — {p.service_type || 'care session'}
                      {p.paid_by_name && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}> · paid by {p.paid_by_name}{p.payment_method ? ` (${p.payment_method})` : ''}</span>}
                    </div>
                    <div style={{ flex: '0 0 80px', fontWeight: 700, fontSize: 14, textAlign: 'right' }}>{fmt(p.amount)}</div>
                    <div style={{ flex: '0 0 auto' }}>{statusBadge(p.status)}</div>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>

      {viewingAttachments && typeof AttachmentViewer !== 'undefined' && (
        <AttachmentViewer attachments={viewingAttachments.list} startIndex={viewingAttachments.index}
          onClose={() => setViewingAttachments(null)} />
      )}
    </div>
  );
};
