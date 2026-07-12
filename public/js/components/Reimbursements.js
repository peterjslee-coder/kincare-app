// ─── Reimbursements (v1.72.0) ───
// Family expense ledger: submit receipts, billing contact approves, settlement
// happens outside the platform (Venmo deep link / Zelle / check / cash) and is
// recorded here. Visible to the whole care team.
const Reimbursements = window.Reimbursements = ({ careTeamId, members, myUserId }) => {
  const { showToast } = useToast();
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ isApprover: false, canSubmit: false });
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [recordMode, setRecordMode] = useState(false); // approver "record directly" mode
  const [recurringMode, setRecurringMode] = useState(false); // monthly series
  const [dayOfMonth, setDayOfMonth] = useState('1');
  const [schedules, setSchedules] = useState([]);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('other');
  const [expenseDate, setExpenseDate] = useState('');
  const [venmoHandle, setVenmoHandle] = useState('');
  const [zelleContact, setZelleContact] = useState('');
  const [payeeUserId, setPayeeUserId] = useState('');
  const [paidMethod, setPaidMethod] = useState('venmo');
  const [receipts, setReceipts] = useState([]); // { data, name }
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [payingId, setPayingId] = useState(null); // row showing the mark-paid method picker
  const [markMethod, setMarkMethod] = useState('venmo');
  const [error, setError] = useState('');
  const [showMoney, setShowMoney] = useState(false); // v1.96.0 — Money view (leader + billing contact)

  const fetchList = async () => {
    try {
      const res = await apiFetch(`/api/reimbursements/team/${careTeamId}`);
      if (res?.ok) {
        const d = await res.json();
        setItems(d.reimbursements || []);
        setMeta({ isApprover: !!d.isApprover, canSubmit: !!d.canSubmit });
      }
      const rs = await apiFetch(`/api/reimbursements/schedules/team/${careTeamId}`);
      if (rs?.ok) { const d2 = await rs.json(); setSchedules(d2.schedules || []); }
    } catch {}
    setLoading(false);
  };
  useEffect(() => { fetchList(); }, [careTeamId]);

  // Client-side image resize (max 1600px, JPEG q0.85) — receipts shouldn't be 5MB photos
  const processFile = (file) => new Promise((resolve, reject) => {
    if (file.type === 'application/pdf') {
      if (file.size > 5 * 1024 * 1024) return reject(new Error(`${file.name} is over 5MB`));
      const r = new FileReader();
      r.onload = () => resolve({ data: r.result, name: file.name });
      r.onerror = () => reject(new Error('Could not read file'));
      r.readAsDataURL(file);
      return;
    }
    if (!file.type.startsWith('image/')) return reject(new Error('Photos or PDFs only'));
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 1600;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        const scale = MAX / Math.max(width, height);
        width = Math.round(width * scale); height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve({ data: canvas.toDataURL('image/jpeg', 0.85), name: (file.name || 'receipt').replace(/\.[^.]+$/, '') + '.jpg' });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
    img.src = url;
  });

  const handleFiles = async (e) => {
    setError('');
    const files = Array.from(e.target.files || []).slice(0, 5 - receipts.length);
    for (const f of files) {
      try { setReceipts(prev => [...prev, ...(prev.length < 5 ? [null] : [])].filter(Boolean)); const p = await processFile(f); setReceipts(prev => [...prev, p].slice(0, 5)); }
      catch (err) { setError(err.message); }
    }
    e.target.value = '';
  };

  const resetForm = () => {
    setAmount(''); setDescription(''); setCategory('other'); setExpenseDate(''); setZelleContact('');
    setReceipts([]); setPayeeUserId(''); setError(''); setShowForm(false); setRecordMode(false); setRecurringMode(false); setDayOfMonth('1');
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const body = { careTeamId, amount: parseFloat(amount), description, category, expenseDate: expenseDate || undefined, receipts };
      let url = '/api/reimbursements';
      if (recurringMode) {
        url = '/api/reimbursements/schedules';
        body.dayOfMonth = parseInt(dayOfMonth);
        delete body.receipts; delete body.expenseDate;
      } else if (recordMode) { url = '/api/reimbursements/record'; body.payeeUserId = payeeUserId || undefined; body.paidMethod = paidMethod; }
      else if (!recurringMode) {
        if (venmoHandle.trim()) body.venmoHandle = venmoHandle;
        if (zelleContact.trim()) body.zelleContact = zelleContact;
        // Soft requirement: without payout details the approver has no way to pay you
        if (!venmoHandle.trim() && !zelleContact.trim()) {
          if (!confirm('No Venmo or Zelle details provided — the approver will have to coordinate with you on how to pay (check, cash…). Submit anyway?')) { setBusy(false); return; }
        }
      }
      const res = await apiFetch(url, { method: 'POST', body: JSON.stringify(body) });
      if (res?.ok) { showToast(recurringMode ? 'Recurring reimbursement submitted for approval' : recordMode ? 'Reimbursement recorded' : 'Request submitted', 'success'); resetForm(); fetchList(); }
      else { const d = await res.json().catch(() => ({})); setError(d.error || 'Failed to submit'); }
    } catch { setError('Failed to submit'); }
    setBusy(false);
  };

  const act = async (id, path, body) => {
    setBusyId(id);
    try {
      const res = await apiFetch(`/api/reimbursements/${id}/${path}`, { method: 'POST', body: JSON.stringify(body || {}) });
      if (res?.ok) fetchList();
      else { const d = await res.json().catch(() => ({})); showToast(d.error || 'Action failed', 'error'); }
    } catch { showToast('Action failed', 'error'); }
    setBusyId(null); setPayingId(null);
  };

  const venmoLink = (it) => {
    if (!it.payee_venmo_handle) return null;
    const note = `InPlace reimbursement — ${it.description}`.slice(0, 130);
    return `https://venmo.com/${encodeURIComponent(it.payee_venmo_handle)}?txn=pay&amount=${Number(it.amount).toFixed(2)}&note=${encodeURIComponent(note)}`;
  };

  const statusChip = (it) => {
    const map = {
      pending:   { label: 'Pending approval', bg: '#fff3e0', fg: '#e65100' },
      approved:  { label: 'Approved — awaiting payment', bg: '#e3f2fd', fg: '#1565c0' },
      paid:      { label: it.paid_method ? `Paid via ${it.paid_method}` : 'Paid', bg: '#e8f5e9', fg: '#2e7d32' },
      declined:  { label: it.declined_reason ? `Declined — ${it.declined_reason}` : 'Declined', bg: '#ffebee', fg: '#c62828' },
      cancelled: { label: 'Cancelled', bg: 'var(--bg-primary)', fg: 'var(--text-muted)' },
    };
    const c = map[it.status] || map.pending;
    return <span style={{ fontSize: 12, fontWeight: 600, color: c.fg, background: c.bg, padding: '3px 10px', borderRadius: 12 }}>{c.label}</span>;
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  const inputStyle = { padding: '10px 12px', border: '1px solid var(--border-light)', borderRadius: 8, fontSize: 14, background: 'var(--bg-card)', color: 'var(--text-primary)' };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>💵 Reimbursements</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {(meta.isApprover || (members || []).some((m) => m.userId === myUserId && m.role === 'leader')) && !showForm && (
            <button onClick={() => setShowMoney(true)}
              style={{ padding: '6px 14px', background: 'var(--bg-card)', color: 'var(--role-color)', border: '1px solid var(--role-color)', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              💰 Money view
            </button>
          )}
          {meta.canSubmit && !showForm && (
            <button onClick={async () => {
                setShowForm(true); setRecordMode(false); setRecurringMode(false);
                try { const r = await apiFetch('/api/reimbursements/my-payout-info'); if (r?.ok) { const d = await r.json(); if (d.venmoHandle) setVenmoHandle(d.venmoHandle); if (d.zelleContact) setZelleContact(d.zelleContact); } } catch {}
              }}
              style={{ padding: '6px 14px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              + Request
            </button>
          )}
          {meta.canSubmit && !showForm && (
            <button onClick={() => { setShowForm(true); setRecordMode(false); setRecurringMode(true); }}
              style={{ padding: '6px 14px', background: 'var(--bg-card)', color: 'var(--role-color)', border: '1px solid var(--role-color)', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              ↻ Recurring
            </button>
          )}
          {meta.isApprover && !showForm && (
            <button onClick={() => { setShowForm(true); setRecordMode(true); setRecurringMode(false); }}
              style={{ padding: '6px 14px', background: 'var(--bg-card)', color: 'var(--role-color)', border: '1px solid var(--role-color)', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Record paid
            </button>
          )}
        </div>
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 12px' }}>
        Fronted money for {`the care recipient`}? Snap the receipt and request reimbursement.
        The whole care team can see requests; the billing contact approves and pays outside InPlace (Venmo, Zelle, check) — no fees.
      </div>

      {showForm && (
        <form onSubmit={submit} style={{ background: 'var(--bg-primary)', borderRadius: 10, padding: 14, marginBottom: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>
            {recordMode ? 'Record a reimbursement you already paid' : recurringMode ? 'Set up a monthly reimbursement (e.g. internet, phone bill)' : 'Request reimbursement'}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <input type="number" min="0.01" max="10000" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount ($)" style={{ ...inputStyle, flex: '0 0 110px' }} />
            <input type="text" required value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="What was it for? (e.g. Walgreens — prescriptions)" style={{ ...inputStyle, flex: '1 1 220px' }} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...inputStyle, flex: '0 0 140px' }}>
              <option value="pharmacy">Pharmacy</option>
              <option value="groceries">Groceries</option>
              <option value="medical">Medical</option>
              <option value="supplies">Supplies</option>
              <option value="transport">Transport</option>
              <option value="other">Other</option>
            </select>
            {!recurringMode && (
              <input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} style={{ ...inputStyle, flex: '0 0 150px' }} />
            )}
            {recurringMode && (
              <select value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} style={{ ...inputStyle, flex: '0 0 190px' }}>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>Repeats monthly on day {d}</option>
                ))}
              </select>
            )}
            {!recordMode && !recurringMode && (
              <div style={{ flex: '1 1 160px' }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 3 }}>
                  Venmo username <span style={{ fontWeight: 400 }}>(how you'll get paid back{venmoHandle ? ' — saved from last time' : ''})</span>
                </label>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ ...inputStyle, padding: '10px 4px 10px 12px', borderRight: 'none', borderRadius: '8px 0 0 8px', color: 'var(--text-muted)' }}>@</span>
                  <input type="text" value={venmoHandle} onChange={(e) => setVenmoHandle(e.target.value)}
                    placeholder="Venmo username" style={{ ...inputStyle, width: '100%', borderLeft: 'none', borderRadius: '0 8px 8px 0', paddingLeft: 2 }} />
                </div>
              </div>
            )}
            {!recordMode && !recurringMode && (
              <div style={{ flex: '1 1 160px' }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 3 }}>
                  Zelle email or phone <span style={{ fontWeight: 400 }}>(optional{zelleContact ? ' — saved from last time' : ''})</span>
                </label>
                <input type="text" value={zelleContact} onChange={(e) => setZelleContact(e.target.value)}
                  placeholder="Zelle email/phone" style={{ ...inputStyle, width: '100%' }} />
              </div>
            )}
            {recordMode && (
              <select value={payeeUserId} onChange={(e) => setPayeeUserId(e.target.value)} style={{ ...inputStyle, flex: '1 1 160px' }}>
                <option value="">Paid to: me</option>
                {(members || []).map((m) => (
                  <option key={m.userId} value={m.userId}>Paid to: {m.firstName} {m.lastName}</option>
                ))}
              </select>
            )}
            {recordMode && (
              <select value={paidMethod} onChange={(e) => setPaidMethod(e.target.value)} style={{ ...inputStyle, flex: '0 0 120px' }}>
                <option value="venmo">Venmo</option>
                <option value="zelle">Zelle</option>
                <option value="check">Check</option>
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
                <option value="other">Other</option>
              </select>
            )}
          </div>
          {recurringMode && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
              Once the approver OKs the series, an entry appears each month pre-approved and ready to pay. Either of you can pause or cancel anytime.
            </div>
          )}
          <div style={{ marginBottom: 8, display: recurringMode ? 'none' : 'block' }}>
            <label style={{ display: 'inline-block', padding: '8px 14px', background: 'var(--bg-card)', border: '1px dashed var(--border-light)', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: 'var(--text-secondary)' }}>
              📷 Add receipt photo / PDF
              <input type="file" accept="image/*,application/pdf" multiple capture="environment" onChange={handleFiles} style={{ display: 'none' }} />
            </label>
            {receipts.map((r, i) => (
              <span key={i} style={{ fontSize: 12, marginLeft: 8, color: 'var(--text-secondary)' }}>
                📎 {r.name}
                <button type="button" onClick={() => setReceipts(prev => prev.filter((_, j) => j !== i))}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>✕</button>
              </span>
            ))}
          </div>
          {error && <div style={{ color: '#c62828', fontSize: 13, marginBottom: 8 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" disabled={busy}
              style={{ padding: '10px 18px', background: busy ? 'var(--text-muted)' : 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}>
              {busy ? 'Saving...' : (recurringMode ? 'Submit for approval' : recordMode ? 'Record' : 'Submit request')}
            </button>
            <button type="button" onClick={resetForm}
              style={{ padding: '10px 14px', background: 'none', border: '1px solid var(--border-light)', borderRadius: 8, fontSize: 14, cursor: 'pointer', color: 'var(--text-secondary)' }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {schedules.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>↻ Recurring</div>
          {schedules.map((sc) => {
            const schedAct = async (action) => {
              const r = await apiFetch(`/api/reimbursements/schedules/${sc.id}/${action}`, { method: 'POST', body: JSON.stringify({}) });
              if (r?.ok) fetchList(); else { const d = await r.json().catch(() => ({})); showToast(d.error || 'Action failed', 'error'); }
            };
            const chip = {
              pending_approval: { t: 'Awaiting approval', bg: '#fff3e0', fg: '#e65100' },
              active: { t: `Next: ${sc.next_run_date || '—'}`, bg: '#e8f5e9', fg: '#2e7d32' },
              paused: { t: 'Paused', bg: 'var(--bg-primary)', fg: 'var(--text-muted)' },
              declined: { t: sc.declined_reason ? `Declined — ${sc.declined_reason}` : 'Declined', bg: '#ffebee', fg: '#c62828' },
            }[sc.status] || { t: sc.status, bg: 'var(--bg-primary)', fg: 'var(--text-muted)' };
            const mine = sc.payee_user_id === myUserId;
            return (
              <div key={sc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 4px', borderTop: '1px solid var(--border-light)' }}>
                <div style={{ flex: '1 1 220px' }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>${Number(sc.amount).toFixed(2)}/mo</span>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}> — {sc.description} · day {sc.day_of_month} · to {sc.payee_first_name} {sc.payee_last_name}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: chip.fg, background: chip.bg, padding: '3px 8px', borderRadius: 10 }}>{chip.t}</span>
                  {meta.isApprover && sc.status === 'pending_approval' && (
                    <>
                      <button onClick={() => schedAct('approve')} style={{ padding: '4px 10px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Approve</button>
                      <button onClick={() => schedAct('decline')} style={{ padding: '4px 10px', background: 'none', border: '1px solid #c62828', color: '#c62828', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Decline</button>
                    </>
                  )}
                  {(meta.isApprover || mine) && sc.status === 'active' && (
                    <button onClick={() => schedAct('pause')} style={{ padding: '4px 10px', background: 'none', border: '1px solid var(--border-light)', color: 'var(--text-secondary)', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Pause</button>
                  )}
                  {(meta.isApprover || mine) && sc.status === 'paused' && (
                    <button onClick={() => schedAct('resume')} style={{ padding: '4px 10px', background: 'none', border: '1px solid #2e7d32', color: '#2e7d32', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Resume</button>
                  )}
                  {(meta.isApprover || mine) && ['pending_approval', 'active', 'paused'].includes(sc.status) && (
                    <button onClick={() => { if (confirm('Cancel this recurring reimbursement?')) schedAct('cancel'); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>Cancel</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 14, padding: 8 }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 14, padding: 8 }}>No reimbursements yet.</div>
      ) : (
        items.map((it) => (
          <div key={it.id} style={{ borderTop: '1px solid var(--border-light)', padding: '12px 4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 240px' }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>
                  ${Number(it.amount).toFixed(2)} <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}>— {it.description}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  {it.payee_first_name} {it.payee_last_name}
                  {it.expense_date ? ` · ${it.expense_date}` : ''} · requested {fmtDate(it.created_at)}
                  {!!it.self_recorded && <span style={{ color: '#7b5ea7', fontWeight: 600 }}> · recorded by approver</span>}
                </div>
                {it.receipts.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    {it.receipts.map((rc) => (
                      <a key={rc.id} href={`/api/reimbursements/receipt/${rc.id}`} target="_blank" rel="noopener"
                        style={{ fontSize: 12, color: 'var(--role-color)', marginRight: 10 }}>
                        📎 {rc.file_name || 'receipt'}
                      </a>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>{statusChip(it)}</div>
            </div>

            {/* Approver: how to pay the payee */}
            {meta.isApprover && ['pending', 'approved'].includes(it.status) && (
              <div style={{ fontSize: 12, marginTop: 6, color: (it.payee_venmo_handle || it.payee_zelle_contact) ? 'var(--text-secondary)' : '#e65100' }}>
                {(it.payee_venmo_handle || it.payee_zelle_contact)
                  ? <>Pay to: {it.payee_venmo_handle ? `Venmo @${it.payee_venmo_handle}` : ''}{it.payee_venmo_handle && it.payee_zelle_contact ? ' · ' : ''}{it.payee_zelle_contact ? `Zelle ${it.payee_zelle_contact}` : ''}</>
                  : <>⚠️ No payment details on file — coordinate with {it.payee_first_name} on how to pay</>}
              </div>
            )}

            {/* Approver actions */}
            {meta.isApprover && it.status === 'pending' && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button disabled={busyId === it.id} onClick={() => act(it.id, 'approve')}
                  style={{ padding: '6px 14px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  Approve
                </button>
                <button disabled={busyId === it.id} onClick={() => { const reason = prompt('Reason (optional):') || ''; act(it.id, 'decline', { reason }); }}
                  style={{ padding: '6px 14px', background: 'none', border: '1px solid #c62828', color: '#c62828', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
                  Decline
                </button>
              </div>
            )}
            {meta.isApprover && it.status === 'approved' && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {venmoLink(it) && (
                  <a href={venmoLink(it)} target="_blank" rel="noopener"
                    style={{ padding: '6px 14px', background: '#008CFF', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                    Pay with Venmo →
                  </a>
                )}
                {payingId === it.id ? (
                  <>
                    <select value={markMethod} onChange={(e) => setMarkMethod(e.target.value)} style={{ ...inputStyle, padding: '6px 8px', fontSize: 13 }}>
                      <option value="venmo">Venmo</option>
                      <option value="zelle">Zelle</option>
                      <option value="check">Check</option>
                      <option value="cash">Cash</option>
                      <option value="bank">Bank</option>
                      <option value="other">Other</option>
                    </select>
                    <button disabled={busyId === it.id} onClick={() => act(it.id, 'mark-paid', { method: markMethod })}
                      style={{ padding: '6px 14px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                      Confirm paid
                    </button>
                  </>
                ) : (
                  <button onClick={() => setPayingId(it.id)}
                    style={{ padding: '6px 14px', background: 'none', border: '1px solid #2e7d32', color: '#2e7d32', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
                    Mark as paid
                  </button>
                )}
              </div>
            )}
            {/* Requester cancel */}
            {it.status === 'pending' && it.requested_by === myUserId && (
              <div style={{ marginTop: 6 }}>
                <button disabled={busyId === it.id} onClick={() => act(it.id, 'cancel')}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>
                  Withdraw request
                </button>
              </div>
            )}
          </div>
        ))
      )}

      {showMoney && typeof MoneyView !== 'undefined' && (
        <MoneyView careTeamId={careTeamId} onClose={() => setShowMoney(false)} />
      )}
    </div>
  );
};
