// FamilyPayments — Payment history + ACH savings for family users
const FamilyPayments = window.FamilyPayments = () => {
  const [payments, setPayments] = useState([]);
  const [totalSpent, setTotalSpent] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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

  const formatDate = (d) => {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch { return d; }
  };

  const statusBadge = (status) => {
    const colors = {
      completed: { bg: '#e8f5e9', color: '#2e7d32', label: 'Paid' },
      processing: { bg: '#fff3e0', color: '#e65100', label: 'Processing' },
      pending: { bg: '#f5f5f5', color: '#666', label: 'Pending' },
      failed: { bg: '#ffebee', color: '#c62828', label: 'Failed' },
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
      <div className="page-container">
        <h1 style={{ marginBottom: '24px' }}>💳 Payments</h1>
        <div className="loading-spinner" style={{ textAlign: 'center', padding: '60px' }}>Loading...</div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <h1 style={{ marginBottom: '24px' }}>💳 Payments</h1>

      {/* ACH Savings Banner */}
      <div className="card" style={{
        background: 'linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%)',
        border: '1px solid #a5d6a7', marginBottom: '20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
          <div style={{ fontSize: '32px', lineHeight: 1 }}>🏦</div>
          <div>
            <h3 style={{ margin: '0 0 8px', color: '#1b5e20', fontSize: '16px' }}>Save with Bank Transfer (ACH)</h3>
            <p style={{ margin: '0 0 12px', color: '#2e7d32', fontSize: '14px', lineHeight: 1.5 }}>
              Pay via bank transfer at checkout and save up to <strong>70%</strong> on processing fees compared to credit card.
            </p>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px',
              background: 'rgba(255,255,255,0.7)', borderRadius: '8px', padding: '12px',
            }}>
              <div>
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '2px' }}>💳 Credit Card</div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#c62828' }}>2.9% + $0.30</div>
                <div style={{ fontSize: '12px', color: '#999' }}>e.g. $6.10 on a $200 session</div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '2px' }}>🏦 Bank Transfer</div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#2e7d32' }}>0.8% (max $5)</div>
                <div style={{ fontSize: '12px', color: '#999' }}>e.g. $1.60 on a $200 session</div>
              </div>
            </div>
            <p style={{ margin: '10px 0 0', fontSize: '13px', color: '#558b2f' }}>
              ✨ We pass 100% of the savings on to you. Select "Bank Transfer" at checkout.
            </p>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        <div className="card" style={{ textAlign: 'center', padding: '16px' }}>
          <div style={{ fontSize: '12px', color: '#999', marginBottom: '4px' }}>Total Spent</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#1b6b5a' }}>${totalSpent.toFixed(2)}</div>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: '16px' }}>
          <div style={{ fontSize: '12px', color: '#999', marginBottom: '4px' }}>Transactions</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#1b6b5a' }}>{payments.length}</div>
        </div>
      </div>

      {/* Payment History */}
      <div className="card">
        <h3 style={{ margin: '0 0 16px', fontSize: '16px' }}>Payment History</h3>
        {payments.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: '#999' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>📋</div>
            <p style={{ margin: 0 }}>No payments yet. Payments will appear here after your first care session.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #eee' }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: '#999', fontWeight: 500, fontSize: '12px' }}>DATE</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: '#999', fontWeight: 500, fontSize: '12px' }}>CAREGIVER</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: '#999', fontWeight: 500, fontSize: '12px' }}>SERVICE</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', color: '#999', fontWeight: 500, fontSize: '12px' }}>AMOUNT</th>
                  <th style={{ textAlign: 'center', padding: '8px 12px', color: '#999', fontWeight: 500, fontSize: '12px' }}>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {payments.map(p => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '10px 12px' }}>{formatDate(p.scheduledDate || p.createdAt)}</td>
                    <td style={{ padding: '10px 12px' }}>{p.caregiverName || '—'}</td>
                    <td style={{ padding: '10px 12px', textTransform: 'capitalize' }}>{(p.serviceType || '—').replace(/_/g, ' ')}</td>
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
      <div style={{ marginTop: '16px', padding: '14px 16px', background: '#f8f9fa', borderRadius: '8px', fontSize: '13px', color: '#666' }}>
        💡 <strong>Tip:</strong> Your payment method is selected at checkout time. Choose "Bank Transfer" when prompted to save on fees. ACH transfers typically take 3–5 business days to settle.
      </div>
    </div>
  );
};
