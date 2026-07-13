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
  // v1.97.0 — the requester's "to" address: method + details (letter metaphor)
  const [payoutMethod, setPayoutMethod] = useState('venmo');
  const [payoutDetails, setPayoutDetails] = useState('');
  const [savedPayout, setSavedPayout] = useState({ venmo: '', zelle: '', bank: '' });
  const [linkedBanks, setLinkedBanks] = useState([]); // v1.97.1 — banks already linked to InPlace (one-tap pick)
  const [approverLinkedBanks, setApproverLinkedBanks] = useState([]);
  const [editingId, setEditingId] = useState(null); // v1.97.0 — editing a pending request
  const [payeeUserId, setPayeeUserId] = useState('');
  const [paidMethod, setPaidMethod] = useState('venmo');
  const [receipts, setReceipts] = useState([]); // { data, name }
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [payingId, setPayingId] = useState(null); // row showing the mark-paid method picker
  const [markMethod, setMarkMethod] = useState('venmo');
  const [error, setError] = useState('');
  const [showMoney, setShowMoney] = useState(false); // v1.96.0 — Money view (leader + billing contact)
  // v1.97.0 — approve modal: confirm the "from" account before approving
  const [approveTarget, setApproveTarget] = useState(null); // the item being approved
  const [fundingAccounts, setFundingAccounts] = useState([]);
  const [fromAccountId, setFromAccountId] = useState('');
  const [newAccountLabel, setNewAccountLabel] = useState('');
  const [approveError, setApproveError] = useState('');
  const [highlightId, setHighlightId] = useState(null); // deep-link focus flash

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

  // v1.97.0 — deep-link focus from a push/notification tap ("reimbursement:<id>"):
  // scroll to the item, flash it, and (for the approver) open the approve modal.
  useEffect(() => {
    if (loading) return;
    const f = window.__pendingFocus;
    if (!f || typeof f !== 'string' || !f.startsWith('reimbursement:')) return;
    const id = f.slice('reimbursement:'.length);
    const it = items.find((x) => x.id === id);
    if (!it) return;
    window.__pendingFocus = null;
    setHighlightId(id);
    setTimeout(() => {
      try { document.querySelector(`[data-reimb-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
    }, 150);
    setTimeout(() => setHighlightId(null), 4000);
    if (meta.isApprover && it.status === 'pending') openApprove(it);
  }, [loading, items, meta.isApprover]);

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
    setAmount(''); setDescription(''); setCategory('other'); setExpenseDate('');
    setPayoutMethod('venmo'); setPayoutDetails(''); setEditingId(null);
    setReceipts([]); setPayeeUserId(''); setError(''); setShowForm(false); setRecordMode(false); setRecurringMode(false); setDayOfMonth('1');
  };

  // Prefill the details field with the saved value for the chosen method
  const applySavedPayout = (method, saved) => {
    const sv = saved || savedPayout;
    setPayoutDetails(method === 'venmo' ? (sv.venmo || '') : method === 'zelle' ? (sv.zelle || '') : method === 'ach' ? (sv.bank || '') : '');
  };

  const openRequestForm = async () => {
    setShowForm(true); setRecordMode(false); setRecurringMode(false); setEditingId(null);
    try {
      const r = await apiFetch('/api/reimbursements/my-payout-info');
      if (r?.ok) {
        const d = await r.json();
        const sv = { venmo: d.venmoHandle || '', zelle: d.zelleContact || '', bank: d.bankContact || '' };
        setSavedPayout(sv);
        setLinkedBanks(d.linkedBanks || []);
        // Default to the first method that has saved details
        const m = sv.venmo ? 'venmo' : sv.zelle ? 'zelle' : sv.bank ? 'ach' : 'venmo';
        setPayoutMethod(m); applySavedPayout(m, sv);
      }
    } catch {}
  };

  // v1.97.0 — edit a still-pending request in place (no more withdraw + resubmit)
  const openEditForm = async (it) => {
    setShowForm(true); setRecordMode(false); setRecurringMode(false);
    setEditingId(it.id);
    setAmount(String(it.amount)); setDescription(it.description); setCategory(it.category || 'other');
    setExpenseDate(it.expense_date || '');
    setPayoutMethod(it.payout_method || (it.payee_venmo_handle ? 'venmo' : it.payee_zelle_contact ? 'zelle' : 'venmo'));
    setPayoutDetails(it.payout_details || it.payee_venmo_handle || it.payee_zelle_contact || '');
    setTimeout(() => { try { document.querySelector('[data-reimb-form]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {} }, 100);
    // v1.97.2 — load saved payout details + linked banks for the chips
    // (previously only the new-request path fetched these, so Edit showed no chip)
    try {
      const r = await apiFetch('/api/reimbursements/my-payout-info');
      if (r?.ok) {
        const d = await r.json();
        setSavedPayout({ venmo: d.venmoHandle || '', zelle: d.zelleContact || '', bank: d.bankContact || '' });
        setLinkedBanks(d.linkedBanks || []);
      }
    } catch {}
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const body = { careTeamId, amount: parseFloat(amount), description, category, expenseDate: expenseDate || undefined, receipts };
      let url = '/api/reimbursements';
      let method = 'POST';
      if (recurringMode) {
        url = '/api/reimbursements/schedules';
        body.dayOfMonth = parseInt(dayOfMonth);
        delete body.receipts; delete body.expenseDate;
      } else if (recordMode) { url = '/api/reimbursements/record'; body.payeeUserId = payeeUserId || undefined; body.paidMethod = paidMethod; }
      else {
        // The "to" address: how the requester wants the money back
        body.payoutMethod = payoutMethod;
        if (payoutDetails.trim()) body.payoutDetails = payoutDetails.trim();
        // Keep legacy profile fields in sync so older views still show them
        if (payoutMethod === 'venmo' && payoutDetails.trim()) body.venmoHandle = payoutDetails.trim();
        if (payoutMethod === 'zelle' && payoutDetails.trim()) body.zelleContact = payoutDetails.trim();
        if (['venmo', 'zelle', 'ach'].includes(payoutMethod) && !payoutDetails.trim()) {
          if (!confirm('No payment details provided — the approver will have to coordinate with you on how to pay. Submit anyway?')) { setBusy(false); return; }
        }
        if (editingId) { url = `/api/reimbursements/${editingId}`; method = 'PUT'; delete body.receipts; }
      }
      const res = await apiFetch(url, { method, body: JSON.stringify(body) });
      if (res?.ok) { showToast(recurringMode ? 'Recurring reimbursement submitted for approval' : recordMode ? 'Reimbursement recorded' : editingId ? 'Request updated — the approver was notified' : 'Request submitted', 'success'); resetForm(); fetchList(); }
      else { const d = await res.json().catch(() => ({})); setError(d.error || 'Failed to submit'); }
    } catch { setError('Failed to submit'); }
    setBusy(false);
  };

  // ── v1.97.0 — approve modal: confirm the "from" account ──
  const openApprove = async (it) => {
    setApproveTarget(it); setApproveError(''); setNewAccountLabel('');
    try {
      const r = await apiFetch(`/api/reimbursements/accounts/${careTeamId}`);
      if (r?.ok) {
        const d = await r.json();
        const accts = d.accounts || [];
        setFundingAccounts(accts);
        setApproverLinkedBanks(d.linkedBanks || []);
        setFromAccountId(accts.find((a) => a.is_default)?.id || accts[0]?.id || '');
      }
    } catch {}
  };

  const addFundingAccount = async () => {
    const label = newAccountLabel.trim();
    if (!label) return;
    setApproveError('');
    try {
      const r = await apiFetch(`/api/reimbursements/accounts/${careTeamId}`, {
        method: 'POST', body: JSON.stringify({ label, type: 'bank', isDefault: fundingAccounts.length === 0 }),
      });
      if (r?.ok) {
        const d = await r.json();
        const next = [...fundingAccounts, { id: d.id, label: d.label, type: d.type, is_default: fundingAccounts.length === 0 ? 1 : 0 }];
        setFundingAccounts(next); setFromAccountId(d.id); setNewAccountLabel('');
      } else { const d = await r.json().catch(() => ({})); setApproveError(d.error || 'Could not add account'); }
    } catch { setApproveError('Could not add account'); }
  };

  const confirmApprove = async () => {
    if (!approveTarget) return;
    setBusyId(approveTarget.id); setApproveError('');
    try {
      const res = await apiFetch(`/api/reimbursements/${approveTarget.id}/approve`, {
        method: 'POST', body: JSON.stringify(fromAccountId ? { fromAccountId } : {}),
      });
      if (res?.ok) {
        showToast(`Approved — ${approveTarget.payee_first_name} was notified`, 'success');
        setApproveTarget(null); fetchList();
      } else { const d = await res.json().catch(() => ({})); setApproveError(d.error || 'Approval failed'); }
    } catch { setApproveError('Approval failed — check your connection and try again'); }
    setBusyId(null);
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
    const handle = (it.payout_method === 'venmo' && it.payout_details) ? it.payout_details.replace(/^@/, '') : it.payee_venmo_handle;
    if (!handle) return null;
    const note = `InPlace reimbursement — ${it.description}`.slice(0, 130);
    return `https://venmo.com/${encodeURIComponent(handle)}?txn=pay&amount=${Number(it.amount).toFixed(2)}&note=${encodeURIComponent(note)}`;
  };

  // v1.97.0 — the "to" address as a human label. Prefers what the requester
  // chose on THIS request; falls back to their saved profile details.
  const payToLabel = (it) => {
    const d = it.payout_details;
    switch (it.payout_method) {
      case 'venmo': return `Venmo @${(d || it.payee_venmo_handle || '?').replace(/^@/, '')}`;
      case 'zelle': return `Zelle ${d || it.payee_zelle_contact || '?'}`;
      case 'ach': return `Bank transfer (ACH)${d ? ` — ${d}` : ''}`;
      case 'check': return `Check${d ? ` — ${d}` : ''}`;
      case 'cash': return 'Cash';
      case 'other': return d || 'Coordinate with requester';
      default: {
        const parts = [];
        if (it.payee_venmo_handle) parts.push(`Venmo @${it.payee_venmo_handle}`);
        if (it.payee_zelle_contact) parts.push(`Zelle ${it.payee_zelle_contact}`);
        if (it.payee_bank_contact) parts.push(`Bank (ACH) — ${it.payee_bank_contact}`);
        return parts.length ? parts.join(' · ') : null;
      }
    }
  };

  const statusChip = (it) => {
    const paidLabel = it.paid_method === 'bank' ? 'bank transfer (ACH)' : it.paid_method;
    const map = {
      pending:   { label: 'Pending approval', bg: '#fff3e0', fg: '#e65100' },
      approved:  { label: `Approved — awaiting payment${it.paid_from_label ? ` from ${it.paid_from_label}` : ''}`, bg: '#e3f2fd', fg: '#1565c0' },
      paid:      { label: it.paid_method ? `Paid via ${paidLabel}${it.paid_from_label ? ` from ${it.paid_from_label}` : ''}` : 'Paid', bg: '#e8f5e9', fg: '#2e7d32' },
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
            <button onClick={openRequestForm}
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
        The whole care team can see requests; the billing contact approves and pays outside InPlace (Venmo, Zelle, bank transfer, check) — no fees. You pick how you get paid back; they pick which account it comes from.
      </div>

      {showForm && (
        <form data-reimb-form onSubmit={submit} style={{ background: 'var(--bg-primary)', borderRadius: 10, padding: 14, marginBottom: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>
            {recordMode ? 'Record a reimbursement you already paid' : recurringMode ? 'Set up a monthly reimbursement (e.g. internet, phone bill)' : editingId ? 'Edit your pending request' : 'Request reimbursement'}
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
              <div style={{ flex: '1 1 150px' }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 3 }}>
                  Pay me back via
                </label>
                <select value={payoutMethod} onChange={(e) => { setPayoutMethod(e.target.value); applySavedPayout(e.target.value); }} style={{ ...inputStyle, width: '100%' }}>
                  <option value="venmo">Venmo</option>
                  <option value="zelle">Zelle</option>
                  <option value="ach">Bank transfer (ACH)</option>
                  <option value="check">Check</option>
                  <option value="cash">Cash</option>
                  <option value="other">Other</option>
                </select>
              </div>
            )}
            {!recordMode && !recurringMode && ['venmo', 'zelle', 'ach', 'check', 'other'].includes(payoutMethod) && (
              <div style={{ flex: '1 1 200px' }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 3 }}>
                  {payoutMethod === 'venmo' ? 'Venmo username' : payoutMethod === 'zelle' ? 'Zelle email or phone' : payoutMethod === 'ach' ? 'Which account (nickname + last 4)' : 'Details (optional)'}
                  {['venmo', 'zelle', 'ach'].includes(payoutMethod) && payoutDetails && (savedPayout.venmo === payoutDetails || savedPayout.zelle === payoutDetails || savedPayout.bank === payoutDetails)
                    ? <span style={{ fontWeight: 400 }}> — saved from last time</span> : null}
                </label>
                {payoutMethod === 'venmo' ? (
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={{ ...inputStyle, padding: '10px 4px 10px 12px', borderRight: 'none', borderRadius: '8px 0 0 8px', color: 'var(--text-muted)' }}>@</span>
                    <input type="text" value={payoutDetails} onChange={(e) => setPayoutDetails(e.target.value)}
                      placeholder="Venmo username" style={{ ...inputStyle, width: '100%', borderLeft: 'none', borderRadius: '0 8px 8px 0', paddingLeft: 2 }} />
                  </div>
                ) : (
                  <input type="text" value={payoutDetails} onChange={(e) => setPayoutDetails(e.target.value)}
                    placeholder={payoutMethod === 'zelle' ? 'Zelle email/phone' : payoutMethod === 'ach' ? 'e.g. Chase checking ending in 4321' : 'e.g. mail to my address'}
                    style={{ ...inputStyle, width: '100%' }} />
                )}
                {payoutMethod === 'ach' && linkedBanks.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                    {linkedBanks.map((b) => (
                      <button key={b} type="button" onClick={() => setPayoutDetails(b)}
                        style={{ padding: '5px 10px', background: payoutDetails === b ? 'var(--role-color)' : 'var(--bg-card)', color: payoutDetails === b ? 'var(--text-on-primary)' : 'var(--role-color)', border: '1px solid var(--role-color)', borderRadius: 14, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                        🏦 {b} — linked to InPlace
                      </button>
                    ))}
                  </div>
                )}
                {payoutMethod === 'ach' && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    {linkedBanks.length > 0
                      ? 'Tap your linked account above, or describe another one. This just tells the approver where to send it — InPlace never stores account numbers, and the transfer happens between your banks.'
                      : "Describe the account so the approver knows where to send it — like \u201CChase checking ending in 4321\u201D. Don't enter the full account number; InPlace only keeps this note, and the transfer happens between your banks."}
                  </div>
                )}
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
          <div style={{ marginBottom: 8, display: (recurringMode || editingId) ? 'none' : 'block' }}>
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
              {busy ? 'Saving...' : (recurringMode ? 'Submit for approval' : recordMode ? 'Record' : editingId ? 'Save changes' : 'Submit request')}
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
        (() => {
          // v1.97.0 — the approver's to-dos float to the top, everything else below
          const needsAction = meta.isApprover ? items.filter((x) => ['pending', 'approved'].includes(x.status)) : [];
          const rest = meta.isApprover ? items.filter((x) => !['pending', 'approved'].includes(x.status)) : items;
          const ordered = [...needsAction, ...rest];
          return (
            <>
              {needsAction.length > 0 && (
                <div style={{ fontSize: 13, fontWeight: 700, color: '#e65100', background: '#fff3e0', borderRadius: 8, padding: '8px 12px', marginBottom: 4 }}>
                  ⚠️ {needsAction.length === 1 ? '1 request needs' : `${needsAction.length} requests need`} your attention
                </div>
              )}
              {ordered.map((it) => (
          <div key={it.id} data-reimb-id={it.id} style={{ borderTop: '1px solid var(--border-light)', padding: '12px 4px', borderRadius: 8, transition: 'background 1.2s ease', background: highlightId === it.id ? 'rgba(74, 144, 217, 0.16)' : 'transparent' }}>
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
              <div style={{ fontSize: 12, marginTop: 6, color: payToLabel(it) ? 'var(--text-secondary)' : '#e65100' }}>
                {payToLabel(it)
                  ? <>Pay to: {payToLabel(it)}{!!it.payout_verified && <span style={{ color: '#2e7d32', fontWeight: 600 }}> ✓ verified linked account</span>}{it.paid_from_label ? <> · From: {it.paid_from_label}</> : null}</>
                  : <>⚠️ No payment details on file — coordinate with {it.payee_first_name} on how to pay</>}
              </div>
            )}
            {/* Payee: how YOU will be paid — so there's no guessing where the money goes */}
            {!meta.isApprover && it.payee_user_id === myUserId && ['pending', 'approved'].includes(it.status) && (
              <div style={{ fontSize: 12, marginTop: 6, color: payToLabel(it) ? 'var(--text-secondary)' : '#e65100' }}>
                {payToLabel(it)
                  ? <>You'll be paid to: {payToLabel(it)}{!!it.payout_verified && <span style={{ color: '#2e7d32', fontWeight: 600 }}> ✓ verified linked account</span>} — the approver sends it from their bank; InPlace tracks it</>
                  : <>⚠️ No payment details on this request — edit it to say how you want to be paid</>}
              </div>
            )}

            {/* Approver actions */}
            {meta.isApprover && it.status === 'pending' && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button disabled={busyId === it.id} onClick={() => openApprove(it)}
                  style={{ padding: '6px 14px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  Approve…
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
                      <option value="bank">Bank transfer (ACH)</option>
                      <option value="check">Check</option>
                      <option value="cash">Cash</option>
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
              <div style={{ marginTop: 6, display: 'flex', gap: 14 }}>
                <button disabled={busyId === it.id} onClick={() => openEditForm(it)}
                  style={{ background: 'none', border: 'none', color: 'var(--role-color)', fontSize: 12, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>
                  Edit request
                </button>
                <button disabled={busyId === it.id} onClick={() => act(it.id, 'cancel')}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>
                  Withdraw request
                </button>
              </div>
            )}
          </div>
              ))}
            </>
          );
        })()
      )}

      {showMoney && typeof MoneyView !== 'undefined' && (
        <MoneyView careTeamId={careTeamId} onClose={() => setShowMoney(false)} />
      )}

      {/* v1.97.0 — approve modal: like addressing a letter, the requester set
          the "to" address; the approver confirms the "from" account here. */}
      {approveTarget && (
        <div onClick={() => setApproveTarget(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-card)', borderRadius: 14, padding: 20, width: '100%', maxWidth: 440, maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Approve reimbursement</div>
            <div style={{ fontSize: 14, marginBottom: 12 }}>
              <span style={{ fontWeight: 700 }}>${Number(approveTarget.amount).toFixed(2)}</span>
              <span style={{ color: 'var(--text-secondary)' }}> — {approveTarget.description} · to {approveTarget.payee_first_name} {approveTarget.payee_last_name}</span>
            </div>
            <div style={{ background: 'var(--bg-primary)', borderRadius: 10, padding: '10px 12px', marginBottom: 12, fontSize: 13 }}>
              <div style={{ marginBottom: 4 }}>
                <span style={{ fontWeight: 600 }}>To:</span> {payToLabel(approveTarget) || `coordinate with ${approveTarget.payee_first_name}`}
                {!!approveTarget.payout_verified && <span style={{ color: '#2e7d32', fontWeight: 600 }}> ✓ verified — this account is linked to {approveTarget.payee_first_name}'s InPlace profile</span>}
              </div>
              <div>
                <span style={{ fontWeight: 600 }}>From:</span>{' '}
                {fundingAccounts.length > 0 ? (
                  <select value={fromAccountId} onChange={(e) => setFromAccountId(e.target.value)} style={{ ...inputStyle, padding: '6px 8px', fontSize: 13, marginTop: 4, width: '100%' }}>
                    {fundingAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                    <option value="">Decide later</option>
                  </select>
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>no accounts saved yet — add one below (optional)</span>
                )}
              </div>
              {approverLinkedBanks.filter((b) => !fundingAccounts.some((a) => a.label === b)).length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {approverLinkedBanks.filter((b) => !fundingAccounts.some((a) => a.label === b)).map((b) => (
                    <button key={b} type="button" onClick={() => { setNewAccountLabel(b); }}
                      style={{ padding: '5px 10px', background: 'var(--bg-card)', color: 'var(--role-color)', border: '1px solid var(--role-color)', borderRadius: 14, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      🏦 Use {b} — linked to InPlace
                    </button>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <input type="text" value={newAccountLabel} onChange={(e) => setNewAccountLabel(e.target.value)}
                  placeholder={'Add account — e.g. Mom\u2019s checking, ends in 1234'} style={{ ...inputStyle, flex: 1, padding: '6px 10px', fontSize: 13 }} />
                <button type="button" onClick={addFundingAccount} disabled={!newAccountLabel.trim()}
                  style={{ padding: '6px 12px', background: 'var(--bg-card)', color: 'var(--role-color)', border: '1px solid var(--role-color)', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  Add
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                This is a note for the family's records — which account the money comes from. No money moves through InPlace and account numbers are never stored; you make the actual payment from your bank, then mark it paid here. Everyone on the request is notified when you approve and when you pay.
              </div>
            </div>
            {approveError && <div style={{ color: '#c62828', fontSize: 13, marginBottom: 10 }}>{approveError}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={confirmApprove} disabled={busyId === approveTarget.id}
                style={{ flex: 1, padding: '10px 16px', background: busyId === approveTarget.id ? 'var(--text-muted)' : 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                {busyId === approveTarget.id ? 'Approving…' : `Approve $${Number(approveTarget.amount).toFixed(2)}`}
              </button>
              <button onClick={() => setApproveTarget(null)}
                style={{ padding: '10px 14px', background: 'none', border: '1px solid var(--border-light)', borderRadius: 8, fontSize: 14, cursor: 'pointer', color: 'var(--text-secondary)' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
