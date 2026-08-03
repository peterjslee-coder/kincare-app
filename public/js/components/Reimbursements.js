// ─── Reimbursements (v1.72.0) ───
// Family expense ledger: submit receipts, billing contact approves, settlement
// happens outside the platform (Venmo deep link / Zelle / check / cash) and is
// recorded here. Visible to the whole care team.
// v1.98.19 — optional "purpose" tags for bucketing reimbursements toward outside
// accounts (taxes, FSA/HSA, Medicaid…). Kept separate from the expense category.
const PURPOSE_OPTIONS = [
  { value: 'real_estate_tax', label: 'Real estate taxes' },
  { value: 'fsa_hsa', label: 'FSA / HSA' },
  { value: 'medicaid', label: 'Medicaid' },
  { value: 'home_repairs', label: 'Home / repairs' },
  { value: 'medical', label: 'Medical' },
  { value: 'personal', label: 'Personal' },
  { value: 'other', label: 'Other' },
];
const PURPOSE_LABEL = (v) => (PURPOSE_OPTIONS.find((o) => o.value === v) || {}).label || '';

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
  const [purpose, setPurpose] = useState(''); // v1.98.19 — optional purpose tag
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
  const [receiptAskId, setReceiptAskId] = useState(null); // v1.105.29
  const [attachingId, setAttachingId] = useState(null);   // v1.105.30 — row currently uploading
  // v1.105.31 — the settled tail collapses. Persisted per care team, so the choice survives
  // a refresh; a preference you have to re-make every visit is not much of a preference.
  const [showSettled, setShowSettled] = useState(() => {
    try { return localStorage.getItem(`inplace.reimb.showSettled.${careTeamId}`) !== '0'; }
    catch { return true; }
  });
  const toggleSettled = () => {
    setShowSettled((v) => {
      const next = !v;
      try { localStorage.setItem(`inplace.reimb.showSettled.${careTeamId}`, next ? '1' : '0'); } catch {}
      return next;
    });
  };
  const attachInputRef = useRef(null);
  const attachTargetRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [payingId, setPayingId] = useState(null); // row showing the mark-paid method picker
  const [markMethod, setMarkMethod] = useState('venmo');
  const [error, setError] = useState('');
  const [showMoney, setShowMoney] = useState(false); // v1.96.0 — Money view (leader + billing contact)
  // v1.98.17 — Bank deposits view: groups received reimbursements into the actual
  // Stripe payout batches so the number on the bank statement ties to requests.
  const [showPayouts, setShowPayouts] = useState(false);
  const [payoutData, setPayoutData] = useState(null);
  const [payoutsLoading, setPayoutsLoading] = useState(false);
  const openPayouts = async () => {
    setShowPayouts(true); setPayoutsLoading(true);
    try { const r = await apiFetch('/api/reimbursements/payouts'); if (r?.ok) setPayoutData(await r.json()); else setPayoutData({ error: true }); }
    catch { setPayoutData({ error: true }); }
    setPayoutsLoading(false);
  };
  // v1.98.19 — Reports & export + purpose tagging on any row (incl. paid ones).
  const [showReports, setShowReports] = useState(false);
  const [rptFrom, setRptFrom] = useState('');
  const [rptTo, setRptTo] = useState('');
  const [rptPurpose, setRptPurpose] = useState('');
  const [rptCategory, setRptCategory] = useState('');
  const [rptPerson, setRptPerson] = useState('');
  const [rptStatus, setRptStatus] = useState('');
  const [purposeSavingId, setPurposeSavingId] = useState(null);
  // v1.105.30 — attach a receipt to a request that already exists.
  // Reuses processFile, so a 5MB phone photo is resized client-side the same way it is on
  // the original form. Uploading the raw camera file would hit the 5MB server cap on
  // exactly the modern phone most likely to be taking the picture.
  const onAttachPicked = async (e) => {
    const id = attachTargetRef.current;
    const files = Array.from(e.target.files || []).slice(0, 5);
    e.target.value = ''; // let the same file be picked again after a failure
    if (!id || !files.length) return;
    setAttachingId(id);
    try {
      const processed = [];
      for (const f of files) {
        try { processed.push(await processFile(f)); }
        catch { showToast(`Could not read ${f.name || 'that file'}`, 'error'); }
      }
      if (processed.length) {
        const res = await apiFetch(`/api/reimbursements/${id}/receipts`, {
          method: 'POST', body: JSON.stringify({ receipts: processed }),
        });
        const d = await res.json().catch(() => ({}));
        if (res?.ok) { showToast(d.message || 'Receipt attached', 'success'); fetchList(); }
        else showToast(d.error || 'Could not attach that receipt', 'error');
      }
    } catch { showToast('Could not attach that receipt', 'error'); }
    setAttachingId(null);
  };

  const pickReceiptFor = (id) => { attachTargetRef.current = id; attachInputRef.current?.click(); };

  // v1.105.29 — nudge whoever filed it to add the receipt, rather than chasing them in
  // another app. Deliberately available to any team member, not just the approver: a
  // sibling watching the family's money is often the one who spots a bare number.
  const askForReceipt = async (id) => {
    setReceiptAskId(id);
    try {
      const res = await apiFetch(`/api/reimbursements/${id}/request-receipt`, { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (res?.ok) showToast(d.message || 'Asked for the receipt', 'success');
      else showToast(d.error || 'Could not send that request', 'error');
    } catch { showToast('Could not send that request', 'error'); }
    setReceiptAskId(null);
  };

  const setRowPurpose = async (id, value) => {
    setPurposeSavingId(id);
    // Optimistic local update so the tag sticks even before the refetch lands.
    setItems((prev) => prev.map((x) => x.id === id ? { ...x, purpose: value || null } : x));
    try {
      const r = await apiFetch(`/api/reimbursements/${id}/purpose`, { method: 'PUT', body: JSON.stringify({ purpose: value || null }) });
      if (!r?.ok) { showToast('Could not save purpose', 'error'); fetchList(); }
    } catch { showToast('Could not save purpose', 'error'); fetchList(); }
    setPurposeSavingId(null);
  };
  // v1.97.0 — approve modal: confirm the "from" account before approving
  const [approveTarget, setApproveTarget] = useState(null); // the item being approved
  const [fundingAccounts, setFundingAccounts] = useState([]);
  const [fromAccountId, setFromAccountId] = useState('');
  const [newAccountLabel, setNewAccountLabel] = useState('');
  const [approveError, setApproveError] = useState('');
  const [highlightId, setHighlightId] = useState(null); // deep-link focus flash
  // v1.98.0 — in-app ACH: the current user's own "get paid back" readiness
  const [payoutStatus, setPayoutStatus] = useState(null); // {onboarded, bankLabel, started, available}
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [payAchId, setPayAchId] = useState(null); // reimbursement currently being sent
  // v1.98.12 — approval clarity so the approver can ALWAYS tell what happened:
  // confirmPayId = the row showing an inline (non-native-dialog) pay confirmation;
  // actionResult = a DURABLE per-row banner ({id: {kind:'ok'|'err', text}}) that
  // stays put after an approve/pay/decline instead of a toast that vanishes — so a
  // silently-failed tap becomes visible and a success is unambiguous.
  const [confirmPayId, setConfirmPayId] = useState(null);
  const [actionResult, setActionResult] = useState({});
  const setRowResult = (id, kind, text) => setActionResult((m) => ({ ...m, [id]: { kind, text } }));
  const clearRowResult = (id) => setActionResult((m) => { const n = { ...m }; delete n[id]; return n; });

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
    // v1.98.10 — the Care Team page keeps laying out async sections (team,
    // billing, receipts) AFTER this effect first runs, which pushes the target
    // row down and defeats a one-shot scroll. Re-scroll on a short interval
    // until the row's position stabilizes (or we give up after ~4s).
    let lastTop = null, tries = 0;
    const settle = setInterval(() => {
      const node = document.querySelector(`[data-reimb-id="${id}"]`);
      tries += 1;
      if (node) {
        node.scrollIntoView({ behavior: tries === 1 ? 'smooth' : 'auto', block: 'center' });
        const top = Math.round(node.getBoundingClientRect().top);
        if (top === lastTop) { clearInterval(settle); }
        lastTop = top;
      }
      if (tries >= 16) clearInterval(settle);
    }, 250);
    setTimeout(() => setHighlightId(null), 5000);
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
    setAmount(''); setDescription(''); setCategory('other'); setPurpose(''); setExpenseDate('');
    setPayoutMethod('venmo'); setPayoutDetails(''); setEditingId(null);
    setReceipts([]); setPayeeUserId(''); setError(''); setShowForm(false); setRecordMode(false); setRecurringMode(false); setDayOfMonth('1');
  };

  // Prefill the details field with the saved value for the chosen method
  const applySavedPayout = (method, saved) => {
    const sv = saved || savedPayout;
    setPayoutDetails(method === 'venmo' ? (sv.venmo || '') : method === 'zelle' ? (sv.zelle || '') : method === 'ach' ? (sv.bank || '') : '');
  };

  const fetchPayoutStatus = async () => {
    try { const r = await apiFetch('/api/reimbursements/payout/status'); if (r?.ok) setPayoutStatus(await r.json()); } catch {}
  };

  // Kick off "get paid back through InPlace" onboarding (Stripe-hosted)
  const startPayoutOnboarding = async () => {
    setPayoutBusy(true);
    try {
      const r = await apiFetch('/api/reimbursements/payout/onboard-link', { method: 'POST' });
      if (r?.ok) { const d = await r.json(); if (d.url) { window.location.href = d.url; return; } }
      const d = await r.json().catch(() => ({}));
      showToast(d.error || 'Could not start direct-deposit setup', 'error');
    } catch { showToast('Could not start direct-deposit setup', 'error'); }
    setPayoutBusy(false);
  };

  const openRequestForm = async () => {
    setShowForm(true); setRecordMode(false); setRecurringMode(false); setEditingId(null);
    fetchPayoutStatus();
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
    fetchPayoutStatus();
    setAmount(String(it.amount)); setDescription(it.description); setCategory(it.category || 'other'); setPurpose(it.purpose || '');
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
      const body = { careTeamId, amount: parseFloat(amount), description, category, purpose: purpose || undefined, expenseDate: expenseDate || undefined, receipts };
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
        if (payoutMethod === 'inplace' && !(payoutStatus && payoutStatus.onboarded)) {
          if (!confirm('You haven\u2019t finished direct-deposit setup yet, so no one can send this through InPlace until you do. Submit the request anyway?')) { setBusy(false); return; }
        }
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
        setRowResult(approveTarget.id, 'ok', `✓ Approved — ${approveTarget.payee_first_name} was notified. It now shows “Approved — awaiting payment.”`);
        showToast(`Approved — ${approveTarget.payee_first_name} was notified`, 'success');
        setApproveTarget(null); await fetchList();
      } else { const d = await res.json().catch(() => ({})); setApproveError(d.error || 'Approval failed'); }
    } catch { setApproveError('Approval failed — check your connection and try again'); }
    setBusyId(null);
  };

  // v1.98.0 — approver sends the money in-app via ACH
  const payViaAch = async (it) => {
    setConfirmPayId(null);
    clearRowResult(it.id);
    setPayAchId(it.id); setBusyId(it.id);
    try {
      const res = await apiFetch(`/api/reimbursements/${it.id}/pay-ach`, { method: 'POST', body: JSON.stringify({}) });
      const d = await res.json().catch(() => ({}));
      if (res?.ok && d.ok) {
        setRowResult(it.id, 'ok', `✓ Sent $${Number(it.amount).toFixed(2)} to ${it.payee_first_name} — depositing to their bank (1–3 business days).`);
        showToast(`Sent — $${Number(it.amount).toFixed(2)} is on its way to ${it.payee_first_name}`, 'success');
        await fetchList();
      } else if (d.code === 'needs_payer_method' || d.code === 'needs_payer_bank') {
        setRowResult(it.id, 'err', 'You need a payment method to pay from first — opening your Payments settings.');
        showToast('Add a payment method to pay from first — opening your Payments settings.', 'info');
        window.__accountTab = 'payments';
        if (window.__navigateTo) window.__navigateTo('account');
      } else if (d.code === 'payee_not_ready') {
        setRowResult(it.id, 'err', d.error || `${it.payee_first_name} hasn\u2019t finished direct-deposit setup yet.`);
        showToast(d.error || 'They haven\u2019t set up direct deposit yet', 'error');
      } else {
        setRowResult(it.id, 'err', `That didn’t go through${d.error ? ` — ${d.error}` : ''}. Nothing was charged — tap “Pay” to try again.`);
        showToast(d.error || 'Payment failed', 'error');
      }
    } catch {
      setRowResult(it.id, 'err', 'That didn’t go through — check your connection. Nothing was charged — tap “Pay” to try again.');
      showToast('Payment failed — check your connection and try again', 'error');
    }
    setPayAchId(null); setBusyId(null);
  };

  // v1.98.12 — inline two-tap pay confirmation (replaces the native confirm()).
  // First tap arms it ("Confirm — send $X" / "Cancel"); second tap actually sends.
  // No blocking dialog that can silently no-op on mobile.
  const renderPayControl = (it) => {
    const amt = Number(it.amount).toFixed(2);
    if (payAchId === it.id) {
      return (
        <button disabled style={{ padding: '6px 14px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'wait' }}>
          Sending…
        </button>
      );
    }
    if (confirmPayId === it.id) {
      return (
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button disabled={busyId === it.id} onClick={() => payViaAch(it)}
            style={{ padding: '6px 14px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            {`Confirm — send $${amt}`}
          </button>
          <button onClick={() => setConfirmPayId(null)}
            style={{ padding: '6px 12px', background: 'none', border: '1px solid var(--border-light)', color: 'var(--text-secondary)', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
            Cancel
          </button>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{`Your payment method is charged $${amt} + fee`}</span>
        </span>
      );
    }
    return (
      <button disabled={busyId === it.id} onClick={() => { clearRowResult(it.id); setConfirmPayId(it.id); }}
        style={{ padding: '6px 14px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: busyId === it.id ? 'wait' : 'pointer' }}>
        {`💸 Pay $${amt} via InPlace`}
      </button>
    );
  };

  const act = async (id, path, body) => {
    setBusyId(id);
    clearRowResult(id);
    try {
      const res = await apiFetch(`/api/reimbursements/${id}/${path}`, { method: 'POST', body: JSON.stringify(body || {}) });
      if (res?.ok) {
        if (path === 'decline') setRowResult(id, 'ok', '✓ Declined — the requester was notified.');
        else if (path === 'mark-paid') setRowResult(id, 'ok', '✓ Marked as paid — the requester was notified.');
        await fetchList();
      } else {
        const d = await res.json().catch(() => ({}));
        setRowResult(id, 'err', `That didn’t go through${d.error ? ` — ${d.error}` : ''}. Try again.`);
        showToast(d.error || 'Action failed', 'error');
      }
    } catch {
      setRowResult(id, 'err', 'That didn’t go through — check your connection and try again.');
      showToast('Action failed', 'error');
    }
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
      case 'inplace': return 'Direct deposit through InPlace';
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
    const paidLabel = it.paid_method === 'bank' ? 'bank transfer (ACH)' : it.paid_method === 'ach_inplace' ? 'InPlace direct deposit' : it.paid_method;
    // v1.98.0 — in-app ACH is async: "sent, depositing" until it settles
    if (it.status === 'paid' && it.paid_method === 'ach_inplace' && it.payout_status === 'processing') {
      return <span style={{ fontSize: 12, fontWeight: 600, color: '#1565c0', background: '#e3f2fd', padding: '3px 10px', borderRadius: 12 }}>{'Sent — depositing (1–3 business days)'}</span>;
    }
    const map = {
      pending:   { label: 'Pending approval', bg: '#fff3e0', fg: '#e65100' },
      approved:  { label: `Approved — awaiting payment${it.paid_from_label ? ` from ${it.paid_from_label}` : ''}`, bg: '#e3f2fd', fg: '#1565c0' },
      paid:      { label: it.paid_method ? `Paid via ${paidLabel}${it.paid_method !== 'ach_inplace' && it.paid_from_label ? ` from ${it.paid_from_label}` : ''}` : 'Paid', bg: '#e8f5e9', fg: '#2e7d32' },
      declined:  { label: it.declined_reason ? `Declined — ${it.declined_reason}` : 'Declined', bg: '#ffebee', fg: '#c62828' },
      cancelled: { label: 'Cancelled', bg: 'var(--bg-primary)', fg: 'var(--text-muted)' },
    };
    const c = map[it.status] || map.pending;
    return <span style={{ fontSize: 12, fontWeight: 600, color: c.fg, background: c.bg, padding: '3px 10px', borderRadius: 12 }}>{c.label}</span>;
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  const fmtDateFull = (d) => d ? new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '';
  // Stripe payout arrival_date is a UTC calendar date; format it in UTC so it
  // matches the date shown on the bank statement (not shifted back a day in EST).
  const fmtDepositDate = (ms) => ms ? new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';
  const money = (n) => `$${Number(n || 0).toFixed(2)}`;
  const inputStyle = { padding: '10px 12px', border: '1px solid var(--border-light)', borderRadius: 8, fontSize: 14, background: 'var(--bg-card)', color: 'var(--text-primary)' };

  // v1.98.17 — Bank deposits panel: each Stripe payout (one bank deposit) with the
  // exact reimbursements that make it up, so the statement number always ties back.
  const payoutStatusChip = (s) => {
    const map = {
      paid:       { label: 'Deposited', bg: '#e8f5e9', fg: '#1b5e20' },
      in_transit: { label: 'On the way', bg: '#e3f2fd', fg: '#1565c0' },
      pending:    { label: 'Pending', bg: '#fff3e0', fg: '#e65100' },
      canceled:   { label: 'Canceled', bg: '#f5f5f5', fg: '#616161' },
      failed:     { label: 'Failed', bg: '#fdecea', fg: '#b71c1c' },
    };
    const c = map[s] || { label: s || '—', bg: '#f5f5f5', fg: '#616161' };
    return <span style={{ fontSize: 12, fontWeight: 700, color: c.fg, background: c.bg, padding: '3px 10px', borderRadius: 12 }}>{c.label}</span>;
  };

  const renderPayouts = () => {
    const d = payoutData;
    return (
      <div onClick={() => setShowPayouts(false)}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '5vh 12px' }}>
        <div onClick={(e) => e.stopPropagation()}
          style={{ background: 'var(--bg-surface)', borderRadius: 14, maxWidth: 560, width: '100%', boxShadow: '0 8px 40px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 18px', borderBottom: '1px solid var(--border-light)' }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>🏦 Bank deposits</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>How your reimbursements land in your bank</div>
            </div>
            <button onClick={() => setShowPayouts(false)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
          </div>
          <div style={{ padding: 16, maxHeight: '78vh', overflowY: 'auto' }}>
            {payoutsLoading ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 14, padding: 12, textAlign: 'center' }}>Loading your deposits…</div>
            ) : !d || d.error ? (
              <div style={{ color: '#c62828', fontSize: 14, padding: 12 }}>Couldn't load your deposits right now. Please try again.</div>
            ) : !d.onboarded ? (
              <div style={{ color: 'var(--text-secondary)', fontSize: 14, padding: 12 }}>
                Set up direct deposit first (in the reimbursement form) and your bank deposits will show up here, each tied to the requests that make it up.
              </div>
            ) : (d.payouts.length === 0 && d.upcoming.length === 0) ? (
              <div style={{ color: 'var(--text-secondary)', fontSize: 14, padding: 12 }}>
                No InPlace deposits yet. When someone reimburses you in-app, the bank deposit and the requests behind it appear here.
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>
                  {'Your bank batches multiple reimbursements into one deposit. Each card below is a single deposit on your statement, with the exact requests that add up to it.'}
                </div>

                {d.upcoming.length > 0 && (
                  <div style={{ border: '1px dashed var(--border-light)', borderRadius: 10, padding: 12, marginBottom: 14, background: 'var(--bg-card)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#e65100' }}>On the way — not yet deposited</span>
                      <span style={{ fontSize: 15, fontWeight: 700 }}>{money(d.upcomingTotal)}</span>
                    </div>
                    {d.upcoming.map((it) => (
                      <div key={it.reimbursementId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0', color: 'var(--text-secondary)' }}>
                        <span>{it.description}{it.state === 'in_balance' ? ' · clearing' : ' · processing'}</span>
                        <span>{money(it.amount)}</span>
                      </div>
                    ))}
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6 }}>Usually deposits 1–3 business days after payment, batched into your next deposit.</div>
                  </div>
                )}

                {d.payouts.map((p) => (
                  <div key={p.id} style={{ border: '1px solid var(--border-light)', borderRadius: 10, padding: 12, marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 20, fontWeight: 700 }}>{money(p.amount)}</span>
                      {payoutStatusChip(p.status)}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
                      {p.status === 'paid' ? 'Deposited' : p.status === 'pending' || p.status === 'in_transit' ? 'Expected' : ''} {fmtDepositDate(p.arrivalDate)}
                    </div>
                    <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: 8 }}>
                      {p.items.length === 0 ? (
                        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Deposit details unavailable.</div>
                      ) : p.items.map((it) => (
                        <div key={it.reimbursementId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}>
                          <span style={{ color: 'var(--text-primary)' }}>{it.description}<span style={{ color: 'var(--text-tertiary)' }}> · {fmtDate(it.paidAt)}</span></span>
                          <span style={{ fontWeight: 600 }}>{money(it.amount)}</span>
                        </div>
                      ))}
                      {p.otherAmount > 0.01 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', color: 'var(--text-tertiary)' }}>
                          <span>Other</span><span>{money(p.otherAmount)}</span>
                        </div>
                      )}
                      {p.items.length > 1 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, paddingTop: 6, marginTop: 4, borderTop: '1px dashed var(--border-light)', fontWeight: 700 }}>
                          <span>{p.items.length} requests</span><span>{money(p.itemsTotal)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ── v1.98.19 — Reports & export ──────────────────────────────────────────
  const personName = (it, role) => role === 'payee'
    ? `${it.payee_first_name || ''} ${it.payee_last_name || ''}`.trim()
    : `${it.requester_first_name || ''} ${it.requester_last_name || ''}`.trim();
  const rptFiltered = () => {
    return items.filter((it) => {
      if (it.status === 'cancelled') return false;
      const d = (it.expense_date || it.created_at || '').slice(0, 10);
      if (rptFrom && d && d < rptFrom) return false;
      if (rptTo && d && d > rptTo) return false;
      if (rptPurpose && (it.purpose || '') !== rptPurpose) return false;
      if (rptCategory && (it.category || '') !== rptCategory) return false;
      if (rptStatus && it.status !== rptStatus) return false;
      if (rptPerson && it.requested_by !== rptPerson && it.payee_user_id !== rptPerson) return false;
      return true;
    });
  };
  const csvCell = (v) => {
    const s = (v === null || v === undefined) ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const downloadCsv = () => {
    const rows = rptFiltered();
    const header = ['Expense date', 'Requested', 'Description', 'Category', 'Purpose', 'Amount', 'Fronted by', 'Paid to', 'Status', 'Approved by', 'Approved on', 'Paid on', 'Paid method', 'Paid from', 'Reimbursement ID'];
    const lines = [header.map(csvCell).join(',')];
    for (const it of rows) {
      lines.push([
        (it.expense_date || '').slice(0, 10),
        (it.created_at || '').slice(0, 10),
        it.description,
        it.category || '',
        PURPOSE_LABEL(it.purpose),
        Number(it.amount).toFixed(2),
        personName(it, 'requester'),
        personName(it, 'payee'),
        it.status,
        `${it.approver_first_name || ''} ${it.approver_last_name || ''}`.trim(),
        (it.approved_at || '').slice(0, 10),
        (it.paid_at || '').slice(0, 10),
        it.paid_method === 'ach_inplace' ? 'InPlace direct deposit' : (it.paid_method || ''),
        it.paid_from_label || '',
        it.id,
      ].map(csvCell).join(','));
    }
    const total = rows.reduce((s, it) => s + Number(it.amount), 0);
    lines.push(['', '', 'TOTAL', '', '', total.toFixed(2), '', '', '', '', '', '', '', '', ''].map(csvCell).join(','));
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    const tag = rptPurpose ? `-${rptPurpose}` : '';
    a.href = url; a.download = `reimbursements${tag}-${stamp}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Exported ${rows.length} reimbursement${rows.length === 1 ? '' : 's'}`, 'success');
  };

  const renderReports = () => {
    const rows = rptFiltered();
    const total = rows.reduce((s, it) => s + Number(it.amount), 0);
    // Per-person: fronted (as requester) vs reimbursed (as payee)
    const people = {};
    const bump = (id, name, key, amt) => {
      if (!id) return;
      people[id] = people[id] || { name, fronted: 0, frontedN: 0, reimbursed: 0, reimbursedN: 0 };
      people[id][key] += amt; people[id][key + 'N'] += 1;
    };
    rows.forEach((it) => {
      bump(it.requested_by, personName(it, 'requester'), 'fronted', Number(it.amount));
      if (it.status === 'paid') bump(it.payee_user_id, personName(it, 'payee'), 'reimbursed', Number(it.amount));
    });
    const peopleArr = Object.values(people).sort((a, b) => b.fronted - a.fronted);
    // By purpose
    const byPurpose = {};
    rows.forEach((it) => { const k = it.purpose || '_none'; byPurpose[k] = (byPurpose[k] || 0) + Number(it.amount); });
    const purposeArr = Object.entries(byPurpose).sort((a, b) => b[1] - a[1]);
    const selStyle = { ...inputStyle, padding: '7px 8px', fontSize: 13 };

    return (
      <div onClick={() => setShowReports(false)}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '4vh 12px' }}>
        <div onClick={(e) => e.stopPropagation()}
          style={{ background: 'var(--bg-surface)', borderRadius: 14, maxWidth: 620, width: '100%', boxShadow: '0 8px 40px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 18px', borderBottom: '1px solid var(--border-light)' }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>📊 Reports & export</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>Filter, see who's fronting/reimbursed, and export a CSV</div>
            </div>
            <button onClick={() => setShowReports(false)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
          </div>
          <div style={{ padding: 16, maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>From<input type="date" value={rptFrom} onChange={(e) => setRptFrom(e.target.value)} style={{ ...selStyle, width: '100%' }} /></label>
              <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>To<input type="date" value={rptTo} onChange={(e) => setRptTo(e.target.value)} style={{ ...selStyle, width: '100%' }} /></label>
              <select value={rptPurpose} onChange={(e) => setRptPurpose(e.target.value)} style={selStyle}>
                <option value="">All purposes</option>
                {PURPOSE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <select value={rptCategory} onChange={(e) => setRptCategory(e.target.value)} style={selStyle}>
                <option value="">All categories</option>
                {['pharmacy', 'groceries', 'medical', 'supplies', 'transport', 'other'].map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
              </select>
              <select value={rptPerson} onChange={(e) => setRptPerson(e.target.value)} style={selStyle}>
                <option value="">Anyone</option>
                {(members || []).map((m) => <option key={m.userId} value={m.userId}>{m.firstName} {m.lastName}</option>)}
              </select>
              <select value={rptStatus} onChange={(e) => setRptStatus(e.target.value)} style={selStyle}>
                <option value="">All statuses</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="paid">Paid</option>
                <option value="declined">Declined</option>
              </select>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-card)', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{rows.length} request{rows.length === 1 ? '' : 's'}</span>
              <span style={{ fontSize: 18, fontWeight: 700 }}>{money(total)}</span>
            </div>

            <button onClick={downloadCsv} disabled={rows.length === 0}
              style={{ width: '100%', padding: '10px 14px', background: rows.length ? 'var(--role-color)' : 'var(--text-muted)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: rows.length ? 'pointer' : 'not-allowed', marginBottom: 16 }}>
              ⬇ Download CSV{rptPurpose ? ` — ${PURPOSE_LABEL(rptPurpose)}` : ''}
            </button>

            {peopleArr.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Who's fronting & getting reimbursed</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '4px 12px', fontSize: 13 }}>
                  <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>Person</span>
                  <span style={{ color: 'var(--text-tertiary)', fontSize: 11, textAlign: 'right' }}>Fronted</span>
                  <span style={{ color: 'var(--text-tertiary)', fontSize: 11, textAlign: 'right' }}>Reimbursed</span>
                  {peopleArr.map((p, i) => (
                    <React.Fragment key={i}>
                      <span>{p.name || 'Unknown'}</span>
                      <span style={{ textAlign: 'right' }}>{money(p.fronted)} <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>({p.frontedN})</span></span>
                      <span style={{ textAlign: 'right' }}>{money(p.reimbursed)} <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>({p.reimbursedN})</span></span>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}

            {purposeArr.length > 0 && (
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>By purpose</div>
                {purposeArr.map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}>
                    <span style={{ color: k === '_none' ? 'var(--text-tertiary)' : 'var(--text-primary)' }}>{k === '_none' ? 'Untagged' : PURPOSE_LABEL(k)}</span>
                    <span style={{ fontWeight: 600 }}>{money(v)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      {/* v1.103.1 — Pete's portrait-phone bug: this row had up to six buttons in
          a non-wrapping flex, so "+ Request" fell off the right edge on mobile.
          Now the row WRAPS, and + Request comes first — the primary action is
          never the one that overflows. */}
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', rowGap: 8 }}>
        <span>💵 Reimbursements</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
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
          {(meta.isApprover || (members || []).some((m) => m.userId === myUserId && m.role === 'leader')) && !showForm && (
            <button onClick={() => setShowMoney(true)}
              style={{ padding: '6px 14px', background: 'var(--bg-card)', color: 'var(--role-color)', border: '1px solid var(--role-color)', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              💰 Money view
            </button>
          )}
          {!showForm && (
            <button onClick={openPayouts}
              style={{ padding: '6px 14px', background: 'var(--bg-card)', color: 'var(--role-color)', border: '1px solid var(--role-color)', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              🏦 Bank deposits
            </button>
          )}
          {!showForm && (
            <button onClick={() => setShowReports(true)}
              style={{ padding: '6px 14px', background: 'var(--bg-card)', color: 'var(--role-color)', border: '1px solid var(--role-color)', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              📊 Reports
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
            <select value={purpose} onChange={(e) => setPurpose(e.target.value)} title="Optional: tag for an outside account (taxes, FSA/HSA, Medicaid…)" style={{ ...inputStyle, flex: '0 0 160px', color: purpose ? 'var(--text-primary)' : 'var(--text-muted)' }}>
              <option value="">Purpose (optional)</option>
              {PURPOSE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
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
                  <option value="inplace">Direct deposit through InPlace</option>
                  <option value="venmo">Venmo</option>
                  <option value="zelle">Zelle</option>
                  <option value="ach">Bank transfer (ACH)</option>
                  <option value="check">Check</option>
                  <option value="cash">Cash</option>
                  <option value="other">Other</option>
                </select>
              </div>
            )}
            {!recordMode && !recurringMode && payoutMethod === 'inplace' && (
              <div style={{ flex: '1 1 100%', marginTop: 2 }}>
                {payoutStatus && payoutStatus.onboarded ? (
                  <div style={{ fontSize: 12, color: '#2e7d32', background: '#e8f5e9', borderRadius: 8, padding: '8px 12px' }}>
                    {'✓ You’re set up for direct deposit'}{payoutStatus.bankLabel ? ` to ${payoutStatus.bankLabel}` : ''}{'. Once approved, the money is sent straight to your bank through InPlace — arrives in ~1–3 business days.'}
                  </div>
                ) : payoutStatus && !payoutStatus.available ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg-primary)', borderRadius: 8, padding: '8px 12px' }}>
                    {'Direct deposit isn’t available on this environment. Pick another way to be paid back.'}
                  </div>
                ) : (
                  <div style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
                      {'Get reimbursed straight to your bank — no Venmo, no waiting on someone to send it. You set up direct deposit once (a quick, secure Stripe step to verify you and your bank), then approved reimbursements land automatically.'}
                    </div>
                    <button type="button" onClick={startPayoutOnboarding} disabled={payoutBusy}
                      style={{ padding: '8px 16px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: payoutBusy ? 'wait' : 'pointer' }}>
                      {payoutBusy ? 'Opening…' : (payoutStatus && payoutStatus.started ? 'Finish direct-deposit setup' : 'Set up direct deposit')}
                    </button>
                  </div>
                )}
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
              📎 Add receipt — photo, screenshot, or PDF
              {/* v1.98.16 — no capture="environment": that forced the camera. Without
                  it the OS shows its full picker (Take Photo / Photo Library / Files),
                  so a screenshot, a saved image, or a PDF all work. */}
              <input type="file" accept="image/*,application/pdf" multiple onChange={handleFiles} style={{ display: 'none' }} />
              {/* v1.105.30 — one hidden picker reused by every row; attachTargetRef says which. */}
              <input type="file" ref={attachInputRef} accept="image/*,application/pdf" multiple
                style={{ display: 'none' }} onChange={onAttachPicked} />
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

          // ─── v1.105.31 — collapse the settled tail ───
          //
          // Collapsing by STATUS rather than by date or by a blanket "hide the list": the
          // reason the ledger is long is that finished business never leaves it, and
          // finished business is exactly what nobody needs to look at.
          //
          // Anything still live — pending, approved-but-unpaid — is NEVER collapsed, for
          // either role. Hiding a request someone is waiting on you to approve, or one you
          // are waiting to be paid for, would make the tidier screen actively worse than
          // the cluttered one. The collapse only ever swallows paid, declined and
          // cancelled rows.
          const SETTLED = ['paid', 'declined', 'cancelled'];
          const live = rest.filter((x) => !SETTLED.includes(x.status));
          const settled = rest.filter((x) => SETTLED.includes(x.status));
          const ordered = [...needsAction, ...live, ...(showSettled ? settled : [])];
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
                {/* v1.105.29 — say when there is NO receipt, not just when there is one.
                    Rendering nothing for an empty list looks identical to a permissions
                    problem: you cannot tell "they did not attach one" from "the app is not
                    showing it to me". On a $655 request that ambiguity is the difference
                    between approving and going to ask in another app. */}
                <div style={{ marginTop: 4 }}>
                  {it.receipts.length > 0 ? it.receipts.map((rc) => (
                    <a key={rc.id} href={`/api/reimbursements/receipt/${rc.id}`} target="_blank" rel="noopener"
                      style={{ fontSize: 12, color: 'var(--role-color)', marginRight: 10 }}>
                      📎 {rc.file_name || 'receipt'}
                    </a>
                  )) : (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No receipt attached</span>
                  )}
                  {/* v1.105.30 — the two halves of the same problem, side by side.
                      If it is yours (or you approve it) you can add one; if it is someone
                      else's you can ask. Attach stays available once a receipt exists —
                      an itemised till roll and the card slip are often two photos — and on
                      approved or paid rows, because a family reconstructing what they spent
                      months later still wants the paperwork attached to the right line. */}
                  {(it.requested_by === myUserId || it.payee_user_id === myUserId || meta.isApprover)
                    ? !['cancelled', 'declined'].includes(it.status) && (
                        <button onClick={() => pickReceiptFor(it.id)} disabled={attachingId === it.id}
                          style={{ marginLeft: it.receipts.length ? 0 : 8, fontSize: 12, padding: '1px 8px', borderRadius: 6,
                            border: '1px solid var(--border-light)', background: 'var(--bg-card)',
                            color: 'var(--role-color)', cursor: 'pointer' }}>
                          {attachingId === it.id ? 'Attaching…' : (it.receipts.length ? '+ Add another' : '+ Attach receipt')}
                        </button>
                      )
                    : it.receipts.length === 0 && (
                        <button onClick={() => askForReceipt(it.id)} disabled={receiptAskId === it.id}
                          style={{ marginLeft: 8, fontSize: 12, padding: '1px 8px', borderRadius: 6,
                            border: '1px solid var(--border-light)', background: 'var(--bg-card)',
                            color: 'var(--role-color)', cursor: 'pointer' }}>
                          {receiptAskId === it.id ? 'Asking…' : 'Ask for it'}
                        </button>
                      )}
                </div>
                {/* v1.98.19 — purpose tag, editable on any status (incl. paid) by team participants */}
                {(meta.canSubmit || meta.isApprover) && (
                  <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>🏷️ Purpose:</span>
                    <select value={it.purpose || ''} disabled={purposeSavingId === it.id}
                      onChange={(e) => setRowPurpose(it.id, e.target.value)}
                      style={{ fontSize: 12, padding: '2px 6px', borderRadius: 6, border: '1px solid var(--border-light)', background: 'var(--bg-card)', color: it.purpose ? 'var(--text-secondary)' : 'var(--text-muted)', cursor: 'pointer' }}>
                      <option value="">— none —</option>
                      {PURPOSE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>{statusChip(it)}</div>
            </div>

            {/* v1.98.12 — DURABLE outcome banner: stays put so the approver can always
                tell what actually happened (a vanishing toast was the whole problem). */}
            {actionResult[it.id] && (
              <div style={{
                marginTop: 8, padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                background: actionResult[it.id].kind === 'ok' ? '#e8f5e9' : '#fdecea',
                color: actionResult[it.id].kind === 'ok' ? '#1b5e20' : '#b71c1c',
                border: `1px solid ${actionResult[it.id].kind === 'ok' ? '#a5d6a7' : '#f5c6cb'}`,
              }}>
                <span>{actionResult[it.id].text}</span>
                <button onClick={() => clearRowResult(it.id)} aria-label="Dismiss"
                  style={{ background: 'none', border: 'none', color: 'inherit', fontSize: 16, cursor: 'pointer', lineHeight: 1, padding: '0 2px' }}>×</button>
              </div>
            )}

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
                {/* v1.98.0 — one-tap approve+pay when the payee can receive in-app */}
                {it.payee_payout_ready ? renderPayControl(it) : null}
                <button disabled={busyId === it.id} onClick={() => openApprove(it)}
                  style={{ padding: '6px 14px', background: it.payee_payout_ready ? 'none' : 'var(--role-color)', color: it.payee_payout_ready ? 'var(--role-color)' : 'var(--text-on-primary)', border: it.payee_payout_ready ? '1px solid var(--role-color)' : 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  {it.payee_payout_ready ? 'Approve only' : 'Approve…'}
                </button>
                <button disabled={busyId === it.id} onClick={() => { const reason = prompt('Reason (optional):') || ''; act(it.id, 'decline', { reason }); }}
                  style={{ padding: '6px 14px', background: 'none', border: '1px solid #c62828', color: '#c62828', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
                  Decline
                </button>
                {it.payout_method === 'inplace' && !it.payee_payout_ready && (
                  <span style={{ fontSize: 12, color: '#e65100', alignSelf: 'center' }}>Waiting on {it.payee_first_name} to finish direct-deposit setup</span>
                )}
              </div>
            )}
            {meta.isApprover && it.status === 'approved' && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {it.payee_payout_ready && it.payout_status !== 'processing' && it.payout_status !== 'succeeded' && renderPayControl(it)}
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
              {/* v1.105.31 — the toggle sits at the BOTTOM, where the tail begins.
                  A control at the top would ask you to decide before you have seen what is
                  there; here it reads as "…and 9 finished ones", which is the question you
                  actually have at that point in the list. Totals stay visible either way, so
                  collapsing never hides how much money is involved. */}
              {settled.length > 0 && (
                <button onClick={toggleSettled}
                  style={{ width: '100%', marginTop: 8, padding: '8px 12px', borderRadius: 8,
                    border: '1px dashed var(--border-light)', background: 'transparent',
                    color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer', textAlign: 'left' }}>
                  {showSettled ? '▾' : '▸'}{' '}
                  {showSettled
                    ? `Hide ${settled.length} settled ${settled.length === 1 ? 'request' : 'requests'}`
                    : `Show ${settled.length} settled ${settled.length === 1 ? 'request' : 'requests'}`}
                  <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
                    (${settled.reduce((t, x) => t + Number(x.amount || 0), 0).toFixed(2)} — paid, declined or cancelled)
                  </span>
                </button>
              )}

            </>
          );
        })()
      )}

      {showMoney && typeof MoneyView !== 'undefined' && (
        <MoneyView careTeamId={careTeamId} onClose={() => setShowMoney(false)} />
      )}

      {showPayouts && renderPayouts()}
      {showReports && renderReports()}

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
