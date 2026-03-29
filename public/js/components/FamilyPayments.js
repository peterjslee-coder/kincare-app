// FamilyPayments — Payment method setup + history for family users
const FamilyPayments = window.FamilyPayments = () => {
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
            <p style={{ margin: '0 0 10px', fontSize: 14, color: 'var(--text-secondary)' }}>Your payment method is connected. You can pay caregivers securely through InPlace.</p>
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
            <p style={{ margin: '0 0 10px', fontSize: 14, color: 'var(--text-secondary)' }}>Add a payment method so you can pay caregivers directly through InPlace. Payments are processed securely by Stripe.</p>
            <button onClick={handleStripeSetup} disabled={setupLoading || !paymentsEnabled}
              style={{ padding: '8px 16px', background: paymentsEnabled ? '#635bff' : '#999', color: 'var(--text-on-primary)', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: paymentsEnabled ? 'pointer' : 'not-allowed' }}>
              {setupLoading ? 'Loading...' : paymentsEnabled ? 'Set Up Payments with Stripe' : 'Payments Paused'}
            </button>
          </div>
        )}
      </div>

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

      {/* ACH Savings Banner */}
      <div className="card" style={{
        background: 'linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%)',
        border: '1px solid #a5d6a7', marginBottom: '20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
          <div style={{ fontSize: '32px', lineHeight: 1 }}>{'\uD83C\uDFE6'}</div>
          <div>
            <h3 style={{ margin: '0 0 8px', color: '#1b5e20', fontSize: '16px' }}>Save with Bank Transfer (ACH)</h3>
            <p style={{ margin: '0 0 12px', color: 'var(--color-success)', fontSize: '14px', lineHeight: 1.5 }}>
              Pay via bank transfer at checkout and save up to <strong>70%</strong> on processing fees compared to credit card.
            </p>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px',
              background: 'rgba(255,255,255,0.7)', borderRadius: '8px', padding: '12px',
            }}>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '2px' }}>Credit Card</div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-error)' }}>2.9% + $0.30</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>e.g. $6.10 on a $200 session</div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '2px' }}>Bank Transfer</div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-success)' }}>0.8% (max $5)</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>e.g. $1.60 on a $200 session</div>
              </div>
            </div>
          </div>
        </div>
      </div>

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
                    <td style={{ padding: '10px 12px' }}>{p.caregiverName || '\u2014'}</td>
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

      {/* Info Note */}
      <div style={{ marginTop: '16px', padding: '14px 16px', background: 'var(--bg-primary)', borderRadius: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
        <strong>Tip:</strong> Your payment method is selected at checkout time. Choose "Bank Transfer" when prompted to save on fees. ACH transfers typically take 3-5 business days to settle.
      </div>
    </div>
  );
};
