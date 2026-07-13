// FamilyPayments — Payment method setup + history for family users
const FamilyPayments = window.FamilyPayments = () => {
  const [myReimbursements, setMyReimbursements] = useState([]);
  const [payments, setPayments] = useState([]);
  const [totalSpent, setTotalSpent] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stripeStatus, setStripeStatus] = useState(null); // null | 'not_setup' | 'pending' | 'complete'
  const [methods, setMethods] = useState([]); // all saved payment methods
  const [setupLoading, setSetupLoading] = useState(false);
  const [paymentsEnabled, setPaymentsEnabled] = useState(true);
  const [caregivers, setCaregivers] = useState([]);
  const [sendPaymentState, setSendPaymentState] = useState({ caregiverId: '', amount: '', note: '' });
  const [sendPaymentLoading, setSendPaymentLoading] = useState(false);
  const [removingMethodId, setRemovingMethodId] = useState(null);
  // v1.98.0 — "how you get paid back" (Stripe Connect payout account)
  const [payoutStatus, setPayoutStatus] = useState(null);
  const [payoutBusy, setPayoutBusy] = useState(false);
  const { showToast: _payoutToast } = (typeof useToast === 'function' ? useToast() : { showToast: null });

  useEffect(() => {
    // Payout (receive-money) readiness + return-from-onboarding toast
    apiFetch('/api/reimbursements/payout/status').then(async r => {
      if (r?.ok) setPayoutStatus(await r.json());
    }).catch(() => {});
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get('payoutComplete') && _payoutToast) _payoutToast('Direct deposit setup saved — you can now be reimbursed straight to your bank.', 'success');
    } catch {}
  }, []);

  const startPayoutOnboarding = async () => {
    setPayoutBusy(true);
    try {
      const r = await apiFetch('/api/reimbursements/payout/onboard-link', { method: 'POST' });
      if (r?.ok) { const d = await r.json(); if (d.url) { window.location.href = d.url; return; } }
      const d = await r.json().catch(() => ({}));
      if (_payoutToast) _payoutToast(d.error || 'Could not start setup', 'error');
    } catch { if (_payoutToast) _payoutToast('Could not start setup', 'error'); }
    setPayoutBusy(false);
  };

  useEffect(() => {
    // Check if payments are enabled
    apiFetch('/api/payments/status').then(async r => {
      if (r?.ok) {
        const d = await r.json();
        setPaymentsEnabled(d.paymentsEnabled !== false);
      }
    }).catch(() => setPaymentsEnabled(false));

    // Fetch payment method status
    apiFetch('/api/payments/family/status').then(async r => {
      if (r?.ok) {
        const d = await r.json();
        setStripeStatus(d.status || 'not_setup');
        setMethods(d.methods || (d.card ? [d.card] : []));
      } else {
        setStripeStatus('not_setup');
      }
    }).catch(() => setStripeStatus('not_setup'));

    // Fetch caregivers for Send Payment — get care teams, then fetch caregivers for each
    (async () => {
      try {
        const teamsRes = await apiFetch('/api/care-teams');
        if (!teamsRes?.ok) return;
        const teamsData = await teamsRes.json();
        const teams = teamsData.careTeams || [];
        const allCaregivers = [];
        const seen = new Set();
        for (const team of teams) {
          try {
            const cgRes = await apiFetch(`/api/care-teams/${team.id}/caregivers`);
            if (cgRes?.ok) {
              const cgData = await cgRes.json();
              (cgData.caregivers || []).forEach(cg => {
                if (!seen.has(cg.caregiver_profile_id)) {
                  seen.add(cg.caregiver_profile_id);
                  allCaregivers.push({
                    id: cg.caregiver_profile_id,
                    userId: cg.user_id,
                    name: `${cg.first_name} ${cg.last_name}`.trim(),
                  });
                }
              });
            }
          } catch {}
        }
        setCaregivers(allCaregivers);
      } catch { setCaregivers([]); }
    })();

    // Fetch payment history
    const fetchHistory = async () => {
      try {
        apiFetch('/api/reimbursements/mine').then(async r => {
          if (r?.ok) { const d = await r.json(); setMyReimbursements(d.reimbursements || []); }
        }).catch(() => {});
        const res = await apiFetch('/api/payments/history');
        if (res.ok) {
          const data = await res.json();
          setPayments(data.payments || []);
          setTotalSpent(data.totalSpent || 0);
        }
      } catch (err) { console.error('Failed to fetch payment history:', err); }
      setLoading(false);
    };
    fetchHistory();
  }, []);

  const handleStripeSetup = async () => {
    setSetupLoading(true);
    try {
      const res = await apiFetch('/api/payments/family/setup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnUrl: window.location.href }),
      });
      if (res?.ok) {
        const d = await res.json();
        if (d.url) window.location.href = d.url;
      } else if (res?.status === 503) {
        const err = await res.json();
        if (err.paymentsDisabled) {
          if (typeof showToast === 'function') showToast('Payments are currently paused by admin', 'warning');
        } else {
          if (typeof showToast === 'function') showToast('Unable to start Stripe setup', 'error');
        }
      } else {
        if (typeof showToast === 'function') showToast('Unable to start Stripe setup', 'error');
      }
    } catch {
      if (typeof showToast === 'function') showToast('Unable to connect to Stripe', 'error');
    }
    setSetupLoading(false);
  };

  const handleRemovePaymentMethod = async (pmId) => {
    if (!window.confirm('Remove this payment method? You can add it again anytime.')) return;
    setRemovingMethodId(pmId);
    try {
      const res = await apiFetch(`/api/payments/family/methods/${pmId}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      });
      if (res?.ok) {
        setMethods(methods.filter(m => m.id !== pmId));
        if (typeof showToast === 'function') showToast('Payment method removed', 'success');
      } else {
        if (typeof showToast === 'function') showToast('Unable to remove payment method', 'error');
      }
    } catch {
      if (typeof showToast === 'function') showToast('Unable to remove payment method', 'error');
    }
    setRemovingMethodId(null);
  };

  const handleSendPayment = async () => {
    if (!sendPaymentState.caregiverId || !sendPaymentState.amount) {
      if (typeof showToast === 'function') showToast('Please select a caregiver and enter an amount', 'warning');
      return;
    }
    setSendPaymentLoading(true);
    try {
      const res = await apiFetch('/api/payments/manual', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caregiverId: sendPaymentState.caregiverId,
          amount: parseFloat(sendPaymentState.amount),
          note: sendPaymentState.note || '',
        }),
      });
      if (res?.ok) {
        const d = await res.json();
        if (d.checkoutUrl) window.location.href = d.checkoutUrl;
      } else if (res?.status === 503) {
        const err = await res.json();
        if (err.paymentsDisabled) {
          if (typeof showToast === 'function') showToast('Payments are currently paused by admin', 'warning');
        } else {
          if (typeof showToast === 'function') showToast('Unable to send payment', 'error');
        }
      } else {
        if (typeof showToast === 'function') showToast('Unable to send payment', 'error');
      }
    } catch {
      if (typeof showToast === 'function') showToast('Unable to send payment', 'error');
    }
    setSendPaymentLoading(false);
  };

  const formatDate = (d) => {
    if (!d) return '\u2014';
    try { return (parseTimestamp(d) || new Date(d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch { return d; }
  };

  const isRealLast4 = (v) => v && v !== 'link' && v !== '****' && v !== '0000' && !/^0+$/.test(v);
  const methodLabel = (m) => {
    if (m.isLink) return `Saved via Stripe Link${m.email ? ` (${m.email})` : ''}`;
    if (m.isBank) return `${m.brand} \u2022\u2022\u2022\u2022 ${m.last4}`;
    return `${(m.brand || 'Card').charAt(0).toUpperCase() + (m.brand || 'Card').slice(1)} \u2022\u2022\u2022\u2022 ${m.last4}`;
  };
  const isPlaceholderExpiry = (m) => m.isLink && m.expMonth === 12 && m.expYear >= 2040;

  const methodIcon = (m) => m.isBank ? '\uD83C\uDFE6' : '\uD83D\uDCB3';

  const statusBadge = (status) => {
    const colors = {
      completed: { bg: 'var(--color-success-bg)', color: 'var(--color-success)', label: 'Paid' },
      processing: { bg: 'var(--color-warning-bg)', color: 'var(--color-warning)', label: 'Processing' },
      pending: { bg: 'var(--bg-primary)', color: 'var(--text-secondary)', label: 'Pending' },
      failed: { bg: 'var(--color-error-bg)', color: 'var(--color-error)', label: 'Failed' },
    };
    const s = colors[status] || colors.pending;
    return (
      <span style={{
        background: s.bg, color: s.color, padding: '3px 10px',
        borderRadius: '12px', fontSize: '12px', fontWeight: 600,
      }}>{s.label}</span>
    );
  };

  if (loading) {
    return (
      <div>
        <div className="loading-spinner" style={{ textAlign: 'center', padding: '60px' }}>Loading...</div>
      </div>
    );
  }

  return (
    <div>
      {/* Payments Paused Banner */}
      {!paymentsEnabled && (
        <div style={{
          background: 'linear-gradient(135deg, #fff3cd 0%, #ffe69c 100%)',
          border: '1px solid #ffc107', marginBottom: '16px', borderRadius: '8px',
          padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px'
        }}>
          <div style={{ fontSize: '20px' }}>⏸️</div>
          <div>
            <div style={{ fontWeight: 600, color: '#856404', marginBottom: '2px' }}>Payments are currently paused</div>
            <div style={{ fontSize: '13px', color: '#856404' }}>Payment methods and transactions are view-only. Payment methods are temporarily unavailable.</div>
          </div>
        </div>
      )}

      {/* Payment Methods Card */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Payment Methods</span>
          {stripeStatus === 'complete'
            ? <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-success)', background: 'var(--color-success-bg)', padding: '2px 10px', borderRadius: 12 }}>{methods.length} saved</span>
            : stripeStatus === 'pending'
              ? <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-warning)', background: 'var(--color-warning-bg)', padding: '2px 10px', borderRadius: 12 }}>In Progress</span>
              : <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', background: 'var(--badge-muted-bg)', padding: '2px 10px', borderRadius: 12 }}>Not Set Up</span>
          }
        </div>
        {stripeStatus === 'complete' ? (
          <div>
            {methods.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                {methods.map((m, i) => (
                  <div key={m.id || i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--bg-primary)', borderRadius: 8 }}>
                    <span style={{ fontSize: 22 }}>{methodIcon(m)}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, textTransform: 'capitalize' }}>{methodLabel(m)}</div>
                      {m.expMonth && m.expYear && !isPlaceholderExpiry(m) && (
                        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Expires {m.expMonth}/{m.expYear}</div>
                      )}
                      {m.isLink && (
                        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{m.email ? `Linked to ${m.email}` : 'Your card is saved securely via Stripe Link'}</div>
                      )}
                    </div>
                    {paymentsEnabled && (
                      <button onClick={() => handleRemovePaymentMethod(m.id)} disabled={removingMethodId === m.id}
                        style={{
                          background: 'transparent', border: 'none', color: 'var(--color-error)', cursor: 'pointer',
                          fontSize: '13px', fontWeight: 600, padding: '4px 8px', textDecoration: 'underline'
                        }}>
                        {removingMethodId === m.id ? 'Removing...' : 'Remove'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <p style={{ margin: '0 0 6px', fontSize: 14, color: 'var(--text-secondary)' }}>Your payment method is connected. You can pay caregivers securely through InPlace.</p>
            <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-tertiary)' }}>Your payment method is automatically charged 1 hour after each session completes. You can add an optional tip before auto-pay processes.</p>
            <button onClick={handleStripeSetup} disabled={setupLoading || !paymentsEnabled}
              style={{ padding: '8px 16px', background: 'var(--bg-surface)', color: paymentsEnabled ? 'var(--role-color)' : 'var(--text-tertiary)', border: paymentsEnabled ? '1px solid #1b6b5a' : '1px solid #ccc', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: paymentsEnabled ? 'pointer' : 'not-allowed', opacity: paymentsEnabled ? 1 : 0.6 }}>
              {setupLoading ? 'Loading...' : 'Add Payment Method'}
            </button>
          </div>
        ) : stripeStatus === 'pending' ? (
          <div>
            <p style={{ margin: '0 0 10px', fontSize: 14, color: 'var(--text-secondary)' }}>Your Stripe setup is in progress. Some information may still be needed.</p>
            <button onClick={handleStripeSetup} disabled={setupLoading || !paymentsEnabled}
              style={{ padding: '8px 16px', background: paymentsEnabled ? '#635bff' : '#999', color: 'var(--text-on-primary)', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: paymentsEnabled ? 'pointer' : 'not-allowed' }}>
              {setupLoading ? 'Loading...' : paymentsEnabled ? 'Continue Stripe Setup' : 'Payments Paused'}
            </button>
          </div>
        ) : (
          <div>
            <p style={{ margin: '0 0 6px', fontSize: 14, color: 'var(--text-secondary)' }}>Add a payment method to book care through InPlace. We accept cards and bank accounts, processed securely by Stripe.</p>
            <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-tertiary)' }}>Your payment method is automatically charged 1 hour after each care session completes. You'll have a chance to add a tip before payment processes. A valid payment method is required to book sessions.</p>
            <button onClick={handleStripeSetup} disabled={setupLoading || !paymentsEnabled}
              style={{ padding: '8px 16px', background: paymentsEnabled ? '#635bff' : '#999', color: 'var(--text-on-primary)', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: paymentsEnabled ? 'pointer' : 'not-allowed' }}>
              {setupLoading ? 'Loading...' : paymentsEnabled ? 'Set Up Payments with Stripe' : 'Payments Paused'}
            </button>
          </div>
        )}
      </div>

      {/* v1.98.0 \u2014 Get Paid Back (payout / receive-money account) */}
      {payoutStatus && payoutStatus.available !== false && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Get Paid Back</span>
            {payoutStatus.onboarded
              ? <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-success)', background: 'var(--color-success-bg)', padding: '2px 10px', borderRadius: 12 }}>Direct deposit on</span>
              : <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', background: 'var(--badge-muted-bg)', padding: '2px 10px', borderRadius: 12 }}>Not Set Up</span>}
          </div>
          {payoutStatus.onboarded ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--bg-primary)', borderRadius: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 22 }}>\uD83C\uDFE6</span>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{payoutStatus.bankLabel || 'Bank account connected'}</div>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>{'When someone reimburses you and chooses \u201cDirect deposit through InPlace,\u201d the money lands here in ~1\u20133 business days \u2014 no Venmo or waiting.'}</p>
            </div>
          ) : (
            <div>
              <p style={{ margin: '0 0 10px', fontSize: 14, color: 'var(--text-secondary)' }}>{'Set up direct deposit so reimbursements can be sent straight to your bank. It\u2019s a one-time, secure Stripe step to verify you and your account. This is separate from your payment method above \u2014 that\u2019s how you '}<em>pay</em>{'; this is how you '}<em>get paid back</em>.</p>
              <button onClick={startPayoutOnboarding} disabled={payoutBusy}
                style={{ padding: '8px 16px', background: '#635bff', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: payoutBusy ? 'wait' : 'pointer' }}>
                {payoutBusy ? 'Opening\u2026' : (payoutStatus.started ? 'Finish direct-deposit setup' : 'Set up direct deposit')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Send Payment Card */}
      {(
        <div className="card" style={{ marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {'\uD83D\uDCB5'} Send Payment
          </h3>
          <p style={{ margin: '0 0 14px', fontSize: '13px', color: 'var(--text-secondary)' }}>
            Send a direct payment to a caregiver without a care session. Perfect for tips, bonuses, or one-time payments.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Caregiver selector */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-secondary)' }}>Select Caregiver</label>
              <select value={sendPaymentState.caregiverId} onChange={(e) => setSendPaymentState({ ...sendPaymentState, caregiverId: e.target.value })} disabled={!paymentsEnabled || sendPaymentLoading}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                <option value="">{caregivers.length === 0 ? 'Loading caregivers...' : 'Choose a caregiver...'}</option>
                {caregivers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {/* Amount input */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-secondary)' }}>Amount (USD)</label>
              <input type="number" value={sendPaymentState.amount} onChange={(e) => setSendPaymentState({ ...sendPaymentState, amount: e.target.value })} placeholder="25.00" disabled={!paymentsEnabled || sendPaymentLoading}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
            </div>
            {/* Note input */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-secondary)' }}>Note (optional)</label>
              <input type="text" value={sendPaymentState.note} onChange={(e) => setSendPaymentState({ ...sendPaymentState, note: e.target.value })} placeholder="e.g., Thank you for going above and beyond" disabled={!paymentsEnabled || sendPaymentLoading}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
            </div>
            {/* Fee breakdown */}
            {(() => {
              const amt = parseFloat(sendPaymentState.amount);
              if (!amt || amt <= 0) return null;
              const cardFee = Math.ceil((amt * 0.029 + 0.30) * 100) / 100;
              const bankFee = Math.min(Math.ceil(amt * 0.008 * 100) / 100, 5.00);
              const selectedCg = caregivers.find(c => c.id === sendPaymentState.caregiverId);
              const cgName = selectedCg ? selectedCg.name.split(' ')[0] : 'caregiver';
              return (
                <div style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '10px 12px', fontSize: 13 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{cgName} receives:</span>
                    <span style={{ fontWeight: 700, color: 'var(--color-success)' }}>${amt.toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Processing fee (card):</span>
                    <span style={{ color: 'var(--text-muted)' }}>~${cardFee.toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Processing fee (bank transfer):</span>
                    <span style={{ color: 'var(--color-success)' }}>~${bankFee.toFixed(2)}</span>
                  </div>
                  <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 6, marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>You pay (card):</span>
                    <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>~${(amt + cardFee).toFixed(2)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    Fee depends on payment method chosen at checkout. InPlace takes no platform fee on direct payments.
                  </div>
                </div>
              );
            })()}
            {/* Send button */}
            <button onClick={handleSendPayment} disabled={!paymentsEnabled || sendPaymentLoading || !sendPaymentState.caregiverId || !sendPaymentState.amount}
              style={{
                padding: '10px 16px', background: paymentsEnabled && sendPaymentState.caregiverId && sendPaymentState.amount ? '#1b6b5a' : '#ccc',
                color: 'white', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
                cursor: (paymentsEnabled && sendPaymentState.caregiverId && sendPaymentState.amount) ? 'pointer' : 'not-allowed'
              }}>
              {sendPaymentLoading ? 'Processing...' : 'Send Payment'}
            </button>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        <div className="card" style={{ textAlign: 'center', padding: '16px' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Total Spent</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--role-color)' }}>${totalSpent.toFixed(2)}</div>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: '16px' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Transactions</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--role-color)' }}>{payments.length}</div>
        </div>
      </div>

      {/* Payment History */}
      <div className="card">
        <h3 style={{ margin: '0 0 16px', fontSize: '16px' }}>Payment History</h3>
        {payments.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>{'\uD83D\uDCCB'}</div>
            <p style={{ margin: 0 }}>No payments yet. Payments will appear here after your first care session.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #eee' }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 500, fontSize: '12px' }}>DATE</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 500, fontSize: '12px' }}>CAREGIVER</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 500, fontSize: '12px' }}>SERVICE</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 500, fontSize: '12px' }}>AMOUNT</th>
                  <th style={{ textAlign: 'center', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 500, fontSize: '12px' }}>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {payments.map(p => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '10px 12px' }}>{formatDate(p.scheduledDate || p.createdAt)}</td>
                    <td style={{ padding: '10px 12px' }}>
                      {p.caregiverName || '\u2014'}
                      {(p.cardBrand || p.paidBy) && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          {p.cardBrand ? `${String(p.cardBrand).charAt(0).toUpperCase() + String(p.cardBrand).slice(1)}${p.cardLast4 ? ' \u2022\u2022\u2022\u2022' + p.cardLast4 : ''}` : ''}
                          {p.cardBrand && p.paidBy ? ' \u00B7 ' : ''}
                          {p.paidBy ? `paid by ${p.paidBy}` : ''}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px', textTransform: 'capitalize' }}>{(p.serviceType || '\u2014').replace(/_/g, ' ')}{p.note ? ` — ${p.note}` : ''}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>${(p.amount || 0).toFixed(2)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>{statusBadge(p.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* v1.79.0 — Reimbursements (from Pete's feedback: reimbursed indicator + hotlink) */}
      {myReimbursements.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>\uD83D\uDCB5 My Reimbursements</span>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 400 }}>full ledger lives on the care team page</span>
          </div>
          {myReimbursements.map((r) => (
            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '9px 4px', borderTop: '1px solid var(--border-light)', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 220px', fontSize: 14 }}>
                <strong>${Number(r.amount).toFixed(2)}</strong>
                <span style={{ color: 'var(--text-secondary)' }}> — {r.description}</span>
                {r.recipient_first_name && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}> (for {r.recipient_first_name})</span>}
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 12,
                color: r.status === 'paid' ? '#2e7d32' : r.status === 'declined' ? '#c62828' : r.status === 'approved' ? '#1565c0' : r.status === 'cancelled' ? 'var(--text-muted)' : '#e65100',
                background: r.status === 'paid' ? '#e8f5e9' : r.status === 'declined' ? '#ffebee' : r.status === 'approved' ? '#e3f2fd' : r.status === 'cancelled' ? 'var(--bg-primary)' : '#fff3e0' }}>
                {r.status === 'paid' ? `\u2713 Reimbursed${r.paid_method ? ' \u00B7 ' + r.paid_method : ''}` : r.status === 'approved' ? 'Approved \u2014 awaiting payment' : r.status.charAt(0).toUpperCase() + r.status.slice(1)}
              </span>
            </div>
          ))}
        </div>
      )}

    </div>
  );
};
