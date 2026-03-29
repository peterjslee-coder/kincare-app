// ─── Admin Financials Dashboard ───
// Revenue analytics, AI insights, transaction history for platform admins

const AdminFinancials = window.AdminFinancials = () => {
  const [summary, setSummary] = useState(null);
  const [breakdown, setBreakdown] = useState(null);
  const [insights, setInsights] = useState([]);
  const [transactions, setTransactions] = useState({ transactions: [], total: 0, page: 1, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('12m');
  const [txPage, setTxPage] = useState(1);
  const [txFilter, setTxFilter] = useState('');
  const [showAllInsights, setShowAllInsights] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  // Platform fee settings
  const [feePercent, setFeePercent] = useState(20);
  const [feeInput, setFeeInput] = useState('20');
  const [feeSaving, setFeeSaving] = useState(false);
  const [feeMsg, setFeeMsg] = useState('');
  // Payment kill switch
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [paymentToggleLoading, setPaymentToggleLoading] = useState(false);
  const [paymentToggleConfirm, setPaymentToggleConfirm] = useState(false);
  // Treasury (Mercury + Stripe)
  const [treasury, setTreasury] = useState(null);
  const [treasuryLoading, setTreasuryLoading] = useState(true);
  const [treasuryExpanded, setTreasuryExpanded] = useState(null); // 'mercury-{id}' or 'stripe-payouts' etc

  const fetchAll = async (showRefresh) => {
    if (showRefresh) setRefreshing(true);
    try {
      const [sumRes, brkRes, insRes, txRes, feeRes, payRes, trsRes] = await Promise.all([
        apiFetch('/api/admin/financials/summary'),
        apiFetch('/api/admin/financials/breakdown'),
        apiFetch('/api/admin/financials/insights'),
        apiFetch(`/api/admin/financials/transactions?page=${txPage}&limit=25`),
        apiFetch('/api/admin/financials/platform-fee'),
        apiFetch('/api/admin/financials/payments-enabled'),
        apiFetch('/api/admin/treasury'),
      ]);
      if (sumRes?.ok) setSummary(await sumRes.json());
      if (brkRes?.ok) setBreakdown(await brkRes.json());
      if (insRes?.ok) { const d = await insRes.json(); setInsights(d.insights || []); }
      if (txRes?.ok) setTransactions(await txRes.json());
      if (feeRes?.ok) {
        const fd = await feeRes.json();
        setFeePercent(fd.platformFeePercent);
        setFeeInput(String(fd.platformFeePercent));
      }
      if (payRes?.ok) {
        const pd = await payRes.json();
        setPaymentsEnabled(pd.paymentsEnabled);
      }
      if (trsRes?.ok) { setTreasury(await trsRes.json()); }
      setTreasuryLoading(false);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Financials fetch error:', err);
    }
    setLoading(false);
    setRefreshing(false);
  };

  const saveFee = async () => {
    const val = parseFloat(feeInput);
    if (isNaN(val) || val < 0 || val > 50) {
      setFeeMsg('Must be 0–50%');
      return;
    }
    setFeeSaving(true); setFeeMsg('');
    try {
      const res = await apiFetch('/api/admin/financials/platform-fee', {
        method: 'PUT',
        body: JSON.stringify({ platformFeePercent: val }),
      });
      if (res?.ok) {
        const d = await res.json();
        setFeePercent(d.platformFeePercent);
        setFeeInput(String(d.platformFeePercent));
        setFeeMsg('Saved!');
        setTimeout(() => setFeeMsg(''), 3000);
      } else {
        const err = await res.json().catch(() => ({}));
        setFeeMsg(err.error || 'Failed to save');
      }
    } catch { setFeeMsg('Network error'); }
    setFeeSaving(false);
  };

  const togglePayments = async () => {
    setPaymentToggleLoading(true);
    try {
      const res = await apiFetch('/api/admin/financials/payments-enabled', {
        method: 'PUT',
        body: JSON.stringify({ enabled: !paymentsEnabled }),
      });
      if (res?.ok) {
        const d = await res.json();
        setPaymentsEnabled(d.paymentsEnabled);
      }
    } catch (err) { console.error('Toggle payments error:', err); }
    setPaymentToggleLoading(false);
    setPaymentToggleConfirm(false);
  };

  useEffect(() => { fetchAll(); }, []);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => fetchAll(true), 60000);
    return () => clearInterval(interval);
  }, [txPage]);

  // Refetch transactions when page changes
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(`/api/admin/financials/transactions?page=${txPage}&limit=25`);
        if (res?.ok) setTransactions(await res.json());
      } catch {}
    })();
  }, [txPage]);

  if (loading) return React.createElement(LoadingSpinner, { text: 'Loading financial data...' });

  const kpi = summary?.kpi || {};
  const monthly = summary?.monthly || [];
  const allTime = summary?.allTime || {};

  // ─── Helpers ───
  const fmt = (val) => {
    if (val === undefined || val === null) return '$0';
    return '$' + Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const pctChange = (current, previous) => {
    if (!previous || previous === 0) return current > 0 ? '+100' : '0';
    return Math.round(((current - previous) / Math.abs(previous)) * 100);
  };

  const serviceLabels = {
    meals: 'Meals', rides: 'Rides', companion: 'Companion',
    companionship: 'Companion', personal_care: 'Personal Care',
    meal_prep: 'Meal Prep', transportation: 'Transport',
    health_wellness: 'Health', full_day: 'Full Day',
    housekeeping: 'Housekeeping', respite: 'Respite',
  };

  // ─── KPI Card ───
  const KpiCard = ({ icon, label, current, previous, prefix = '$', isMoney = true }) => {
    const change = pctChange(current, previous);
    const isPositive = parseInt(change) >= 0;
    return (
      <div className="stat-card" style={{ position: 'relative' }}>
        <div style={{ fontSize: 28 }}>{icon}</div>
        <div className="stat-number">{isMoney ? fmt(current) : current}</div>
        <div className="stat-label">{label}</div>
        <div style={{
          fontSize: 11, fontWeight: 600, marginTop: 4,
          color: isPositive ? 'var(--color-success)' : 'var(--color-error)',
        }}>
          {isPositive ? '▲' : '▼'} {change}% vs last month
        </div>
      </div>
    );
  };

  // ─── Stacked Bar Chart (Revenue Trend) ───
  const RevenueChart = ({ data }) => {
    const chartWidth = 600;
    const chartHeight = 200;
    const leftPad = 55;
    const bottomPad = 30;
    const barWidth = Math.floor((chartWidth - leftPad - 20) / Math.max(data.length, 1)) - 4;
    const maxVal = Math.max(...data.map(d => d.grossRevenue), 1);

    return (
      <div style={{ overflowX: 'auto' }}>
        <svg width={chartWidth} height={chartHeight + bottomPad} viewBox={`0 0 ${chartWidth} ${chartHeight + bottomPad}`} style={{ width: '100%', maxWidth: chartWidth }}>
          {/* Grid lines + Y-axis labels */}
          {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
            const y = chartHeight - chartHeight * pct;
            return (
              <g key={i}>
                <line x1={leftPad} y1={y} x2={chartWidth - 10} y2={y} stroke="var(--border-light)" strokeWidth="1" />
                <text x={leftPad - 6} y={y + 4} textAnchor="end" fontSize="10" fill="var(--text-muted)">
                  ${Math.round(maxVal * pct).toLocaleString()}
                </text>
              </g>
            );
          })}
          {/* Bars */}
          {data.map((d, i) => {
            const totalH = (d.grossRevenue / maxVal) * (chartHeight - 10);
            const platformH = (d.platformFee / maxVal) * (chartHeight - 10);
            const x = leftPad + 8 + i * (barWidth + 4);
            return (
              <g key={i}>
                {/* Caregiver payout (bottom, gray) */}
                <rect x={x} y={chartHeight - totalH} width={barWidth} height={Math.max(totalH - platformH, 0)} rx="2" fill="#d0d0d0" opacity={0.7} />
                {/* Platform fee (top, teal) */}
                <rect x={x} y={chartHeight - totalH} width={barWidth} height={Math.max(platformH, 0)} rx="2" fill="var(--role-color)" opacity={0.85} />
                {/* Value label */}
                {d.grossRevenue > 0 && (
                  <text x={x + barWidth / 2} y={chartHeight - totalH - 4} textAnchor="middle" fontSize="8" fill="var(--text-secondary)" fontWeight="600">
                    ${Math.round(d.grossRevenue)}
                  </text>
                )}
                {/* Month label */}
                <text x={x + barWidth / 2} y={chartHeight + 14} textAnchor="middle" fontSize="10" fill="var(--text-tertiary)">
                  {d.label}
                </text>
              </g>
            );
          })}
        </svg>
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 4, fontSize: 11, color: 'var(--text-secondary)' }}>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--role-color)', borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }}></span>Platform Fee</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#d0d0d0', borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }}></span>Caregiver Payout</span>
        </div>
      </div>
    );
  };

  // ─── Donut Chart (Service Breakdown) ───
  const ServiceDonut = ({ data }) => {
    if (!data || !data.length) return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No service data yet</p>;
    const total = data.reduce((s, d) => s + d.revenue, 0);
    if (total === 0) return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No revenue data yet</p>;
    const colors = ['var(--role-color)', 'var(--accent-color)', '#3498db', '#9b59b6', '#f39c12', '#2ecc71'];
    const cx = 70, cy = 70, r = 55, ir = 35;
    let cumAngle = 0;

    const arcs = data.map((s, i) => {
      const angle = (s.revenue / total) * 360;
      const startAngle = cumAngle;
      cumAngle += angle;
      const endAngle = cumAngle;
      const startRad = (startAngle - 90) * Math.PI / 180;
      const endRad = (endAngle - 90) * Math.PI / 180;
      const largeArc = angle > 180 ? 1 : 0;
      const x1 = cx + r * Math.cos(startRad), y1 = cy + r * Math.sin(startRad);
      const x2 = cx + r * Math.cos(endRad), y2 = cy + r * Math.sin(endRad);
      const ix1 = cx + ir * Math.cos(endRad), iy1 = cy + ir * Math.sin(endRad);
      const ix2 = cx + ir * Math.cos(startRad), iy2 = cy + ir * Math.sin(startRad);
      const path = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${ir} ${ir} 0 ${largeArc} 0 ${ix2} ${iy2} Z`;
      return { path, color: colors[i % colors.length], label: serviceLabels[s.serviceType] || s.serviceType, revenue: s.revenue, pct: Math.round(s.revenue / total * 100) };
    });

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <svg width="140" height="140" viewBox="0 0 140 140">
          {arcs.map((a, i) => <path key={i} d={a.path} fill={a.color} />)}
          <text x={cx} y={cy - 4} textAnchor="middle" fontSize="16" fontWeight="700" fill="var(--text-primary)">{fmt(total)}</text>
          <text x={cx} y={cy + 12} textAnchor="middle" fontSize="9" fill="var(--text-muted)">total revenue</text>
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {arcs.map((a, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: a.color, flexShrink: 0 }} />
              <span style={{ color: 'var(--text-secondary)' }}>{a.label}</span>
              <span style={{ color: 'var(--text-muted)' }}>({a.pct}% · {fmt(a.revenue)})</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ─── Insight Card ───
  const InsightCard = ({ insight }) => {
    const severityStyles = {
      positive: { bg: 'var(--color-success-bg)', border: 'var(--color-success-bg)', icon: '✅', color: 'var(--color-success)' },
      neutral: { bg: 'var(--color-info-bg)', border: '#90caf9', icon: 'ℹ️', color: 'var(--color-info)' },
      warning: { bg: 'var(--color-warning-bg)', border: '#ffe082', icon: '⚠️', color: 'var(--color-warning)' },
      critical: { bg: 'var(--color-error-bg)', border: '#ef9a9a', icon: '🚨', color: 'var(--color-error)' },
    };
    const s = severityStyles[insight.severity] || severityStyles.neutral;
    return (
      <div style={{
        padding: '14px 16px', borderRadius: 10, background: s.bg, border: `1px solid ${s.border}`,
        marginBottom: 10,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: s.color }}>
            {s.icon} {insight.title}
          </div>
          {insight.metric && (
            <div style={{
              padding: '2px 10px', borderRadius: 12, background: 'var(--bg-surface)', fontSize: 13,
              fontWeight: 700, color: s.color, border: `1px solid ${s.border}`,
            }}>
              {insight.metric}
            </div>
          )}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 8 }}>{insight.description}</div>
        <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 600, background: 'rgba(255,255,255,0.6)', padding: '8px 10px', borderRadius: 6 }}>
          💡 {insight.recommendation}
        </div>
      </div>
    );
  };

  // ─── Status Badge ───
  const StatusBadge = ({ status }) => {
    const styles = {
      completed: { bg: 'var(--color-success-bg)', color: 'var(--color-success)' },
      pending: { bg: 'var(--color-warning-bg)', color: 'var(--color-warning)' },
      failed: { bg: 'var(--color-error-bg)', color: 'var(--color-error)' },
      refunded: { bg: 'var(--color-warning-bg)', color: 'var(--color-warning)' },
    };
    const s = styles[status] || styles.pending;
    return (
      <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: s.bg, color: s.color }}>
        {status}
      </span>
    );
  };

  // Filtered transactions for search
  const filteredTx = txFilter
    ? transactions.transactions.filter(t =>
        t.familyName.toLowerCase().includes(txFilter.toLowerCase()) ||
        t.caregiverName.toLowerCase().includes(txFilter.toLowerCase()) ||
        (t.serviceType || '').toLowerCase().includes(txFilter.toLowerCase())
      )
    : transactions.transactions;

  const payoutData = breakdown?.byPayoutSpeed || [];
  const standardPayout = payoutData.find(p => p.speed === 'standard') || { count: 0, revenue: 0, platformFee: 0 };
  const instantPayout = payoutData.find(p => p.speed === 'instant') || { count: 0, revenue: 0, platformFee: 0 };
  const instantSurchargeRevenue = instantPayout.count > 0 ? Math.round(instantPayout.revenue * 0.02 * 100) / 100 : 0;

  const visibleInsights = showAllInsights ? insights : insights.slice(0, 5);

  return (
    <>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Platform Financials</h2>
          {lastUpdated && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              Last updated: {lastUpdated.toLocaleTimeString()} · Auto-refreshes every 60s
            </div>
          )}
        </div>
        <button
          onClick={() => fetchAll(true)}
          disabled={refreshing}
          style={{
            padding: '6px 16px', borderRadius: 8, border: '1px solid #d0d0d0',
            background: refreshing ? 'var(--badge-muted-bg)' : 'var(--text-on-primary)', cursor: refreshing ? 'wait' : 'pointer',
            fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)',
          }}>
          {refreshing ? '↻ Refreshing...' : '↻ Refresh'}
        </button>
      </div>

      {/* ── Treasury / Cash Position ── */}
      {treasury && (treasury.connected?.mercury || treasury.connected?.stripe) && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid #1565c0' }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div><span className="card-icon">{'\u{1F3E6}'}</span>Cash Position</div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              {treasury.connected?.mercury && <span style={{ marginRight: 8 }}>{'\u2705'} Mercury</span>}
              {treasury.connected?.stripe && <span>{'\u2705'} Stripe</span>}
              {!treasury.connected?.mercury && <span style={{ marginRight: 8, color: 'var(--text-muted)' }}>{'\u274C'} Mercury (add MERCURY_API_TOKEN)</span>}
            </div>
          </div>

          {/* Balance summary row */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
            {/* Mercury total */}
            {treasury.mercury && (
              <div style={{ flex: '1 1 200px', padding: 16, background: 'linear-gradient(135deg, #e3f2fd 0%, #e8eaf6 100%)', borderRadius: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Mercury</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--color-info)' }}>
                  ${treasury.mercury.totalBalance?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{treasury.mercury.accounts?.length || 0} account{treasury.mercury.accounts?.length !== 1 ? 's' : ''}</div>
              </div>
            )}
            {/* Stripe balance */}
            {treasury.stripe && (
              <div style={{ flex: '1 1 200px', padding: 16, background: 'linear-gradient(135deg, #e8f5e9 0%, #f1f8e9 100%)', borderRadius: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Stripe</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--color-success)' }}>
                  ${treasury.stripe.balance?.total?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  ${treasury.stripe.balance?.available?.toFixed(2)} available · ${treasury.stripe.balance?.pending?.toFixed(2)} pending
                </div>
              </div>
            )}
            {/* Combined total */}
            {treasury.mercury && treasury.stripe && (
              <div style={{ flex: '1 1 200px', padding: 16, background: 'linear-gradient(135deg, #f3e5f5 0%, #fce4ec 100%)', borderRadius: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Total Cash</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--color-purple)' }}>
                  ${((treasury.mercury.totalBalance || 0) + (treasury.stripe.balance?.total || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>All accounts combined</div>
              </div>
            )}
          </div>

          {/* Mercury accounts detail */}
          {treasury.mercury && treasury.mercury.accounts?.map(acct => (
            <div key={acct.id} style={{ marginBottom: 8 }}>
              <div onClick={() => setTreasuryExpanded(treasuryExpanded === `m-${acct.id}` ? null : `m-${acct.id}`)}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#f5f7fa', borderRadius: 8, cursor: 'pointer', border: '1px solid #e0e0e0' }}>
                <div>
                  <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-info)' }}>{acct.name}</span>
                  <span style={{ marginLeft: 8, fontSize: 10, background: 'var(--color-info-bg)', color: 'var(--color-info)', padding: '1px 6px', borderRadius: 4 }}>{acct.type}</span>
                  {acct.accountNumber && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>{acct.accountNumber}</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
                    ${(acct.currentBalance || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{treasuryExpanded === `m-${acct.id}` ? '\u25B2' : '\u25BC'}</span>
                </div>
              </div>
              {/* Recent transactions for this account */}
              {treasuryExpanded === `m-${acct.id}` && acct.recentTransactions && (
                <div style={{ margin: '4px 0 0 0', border: '1px solid #e0e0e0', borderRadius: 8, overflow: 'hidden' }}>
                  {acct.recentTransactions.length === 0 ? (
                    <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>No recent transactions</div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: 'var(--bg-primary)', borderBottom: '1px solid #e0e0e0' }}>
                          <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600 }}>Date</th>
                          <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600 }}>Counterparty</th>
                          <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600 }}>Note</th>
                          <th style={{ textAlign: 'right', padding: '6px 10px', fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600 }}>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {acct.recentTransactions.map(tx => (
                          <tr key={tx.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                            <td style={{ padding: '6px 10px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                              {tx.createdAt ? new Date(tx.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}
                            </td>
                            <td style={{ padding: '6px 10px', fontWeight: 500 }}>{tx.counterpartyName}</td>
                            <td style={{ padding: '6px 10px', color: 'var(--text-tertiary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {tx.note || '—'}
                            </td>
                            <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, color: tx.amount >= 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
                              {tx.amount >= 0 ? '+' : ''}{tx.amount?.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Stripe details: payouts + disputes */}
          {treasury.stripe && (
            <div style={{ marginTop: treasury.mercury ? 8 : 0 }}>
              {/* 30-day Stripe stats */}
              {treasury.stripe.last30Days?.count > 0 && (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
                  <div style={{ padding: '6px 12px', background: 'var(--bg-primary)', borderRadius: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                    30-day volume: <strong>${treasury.stripe.last30Days.volume?.toFixed(2)}</strong> ({treasury.stripe.last30Days.count} charges)
                  </div>
                  <div style={{ padding: '6px 12px', background: 'var(--bg-primary)', borderRadius: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                    Stripe fees: <strong>${treasury.stripe.last30Days.fees?.toFixed(2)}</strong> ({treasury.stripe.last30Days.effectiveFeeRate}%)
                  </div>
                </div>
              )}

              {/* Recent payouts */}
              {treasury.stripe.recentPayouts?.length > 0 && (
                <div>
                  <div onClick={() => setTreasuryExpanded(treasuryExpanded === 'stripe-payouts' ? null : 'stripe-payouts')}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#f0f7f0', borderRadius: 8, cursor: 'pointer', border: '1px solid #c8e6c9', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-success)' }}>Stripe Payouts (to Mercury)</span>
                    <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{treasuryExpanded === 'stripe-payouts' ? '\u25B2' : '\u25BC'} {treasury.stripe.recentPayouts.length} recent</span>
                  </div>
                  {treasuryExpanded === 'stripe-payouts' && (
                    <div style={{ border: '1px solid #e0e0e0', borderRadius: 8, overflow: 'hidden', marginBottom: 8 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: 'var(--bg-primary)', borderBottom: '1px solid #e0e0e0' }}>
                            <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600 }}>Date</th>
                            <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600 }}>Arrival</th>
                            <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600 }}>Status</th>
                            <th style={{ textAlign: 'right', padding: '6px 10px', fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600 }}>Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {treasury.stripe.recentPayouts.map(p => (
                            <tr key={p.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                              <td style={{ padding: '6px 10px', color: 'var(--text-secondary)' }}>{new Date(p.created).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</td>
                              <td style={{ padding: '6px 10px', color: 'var(--text-secondary)' }}>{new Date(p.arrivalDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</td>
                              <td style={{ padding: '6px 10px' }}>
                                <span style={{
                                  fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 600,
                                  background: p.status === 'paid' ? 'var(--color-success-bg)' : p.status === 'pending' ? 'var(--color-warning-bg)' : p.status === 'in_transit' ? 'var(--color-info-bg)' : 'var(--bg-primary)',
                                  color: p.status === 'paid' ? 'var(--color-success)' : p.status === 'pending' ? 'var(--color-warning)' : p.status === 'in_transit' ? 'var(--color-info)' : 'var(--text-tertiary)',
                                }}>{p.status}</span>
                              </td>
                              <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>${p.amount?.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Open disputes alert */}
              {treasury.stripe.openDisputes?.length > 0 && (
                <div style={{ padding: '10px 14px', background: 'var(--color-warning-bg)', border: '1px solid #ffcc80', borderRadius: 8, marginTop: 4 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--color-warning)', marginBottom: 4 }}>
                    {'\u26A0\uFE0F'} {treasury.stripe.openDisputes.length} Open Dispute{treasury.stripe.openDisputes.length > 1 ? 's' : ''}
                  </div>
                  {treasury.stripe.openDisputes.map(d => (
                    <div key={d.id} style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 2 }}>
                      ${d.amount.toFixed(2)} — {d.reason} — due {d.evidenceDueBy ? new Date(d.evidenceDueBy).toLocaleDateString() : 'N/A'}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Errors */}
          {treasury.errors?.length > 0 && (
            <div style={{ marginTop: 8, padding: 8, background: 'var(--color-error-bg)', borderRadius: 6, fontSize: 11, color: 'var(--color-error)' }}>
              {treasury.errors.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}
        </div>
      )}

      {/* Not connected prompt */}
      {treasury && !treasury.connected?.mercury && !treasury.connected?.stripe && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid #ff9800', background: 'var(--bg-warm)' }}>
          <div className="card-header"><span className="card-icon">{'\u{1F3E6}'}</span>Connect Your Accounts</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Add <strong>MERCURY_API_TOKEN</strong> and/or <strong>STRIPE_SECRET_KEY</strong> to your Railway environment variables to see live account balances, transactions, and payouts here.
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="stats-grid">
        <KpiCard icon="💰" label="Gross Revenue" current={kpi.grossRevenue?.current} previous={kpi.grossRevenue?.previous} />
        <KpiCard icon="🏦" label="Platform Revenue" current={kpi.platformRevenue?.current} previous={kpi.platformRevenue?.previous} />
        <KpiCard icon="📈" label="Net Revenue" current={kpi.netRevenue?.current} previous={kpi.netRevenue?.previous} />
        <KpiCard icon="📅" label="Sessions" current={kpi.totalSessions?.current} previous={kpi.totalSessions?.previous} isMoney={false} />
        <KpiCard icon="💎" label="Avg Session Value" current={kpi.avgSessionValue?.current} previous={kpi.avgSessionValue?.previous} />
        <KpiCard icon="🔍" label="BG Check Revenue" current={kpi.bgCheckRevenue?.current} previous={kpi.bgCheckRevenue?.previous} />
      </div>

      {/* Payment Kill Switch */}
      <div className="card" style={{
        marginBottom: 16,
        borderLeft: `4px solid ${paymentsEnabled ? 'var(--color-success)' : 'var(--color-error)'}`,
        background: paymentsEnabled ? '#f1f8e9' : 'var(--color-warning-bg)',
      }}>
        <div className="card-header">
          <span className="card-icon">{paymentsEnabled ? '✅' : '🔒'}</span>
          Live Payments
          <span style={{
            marginLeft: 8, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
            background: paymentsEnabled ? 'var(--color-success)' : 'var(--color-error)', color: 'var(--text-on-primary)',
          }}>
            {paymentsEnabled ? 'ENABLED' : 'DISABLED'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', flex: '1 1 300px' }}>
            {paymentsEnabled
              ? 'Real payments are active. Stripe will process charges, caregivers will receive payouts, and platform fees will settle to Mercury.'
              : 'Payments are disabled. No charges will be processed. Caregivers cannot onboard to Stripe, and families cannot check out. Enable when ready to go live.'}
          </div>
          {!paymentToggleConfirm ? (
            <button
              onClick={() => setPaymentToggleConfirm(true)}
              disabled={paymentToggleLoading}
              style={{
                padding: '8px 20px', borderRadius: 6, border: 'none', fontSize: 13, fontWeight: 700,
                cursor: 'pointer', whiteSpace: 'nowrap',
                background: paymentsEnabled ? 'var(--color-error)' : 'var(--color-success)', color: 'var(--text-on-primary)',
              }}
            >
              {paymentsEnabled ? 'Disable Payments' : 'Enable Payments'}
            </button>
          ) : (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
              background: 'rgba(0,0,0,0.05)', borderRadius: 8,
            }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: paymentsEnabled ? 'var(--color-error)' : 'var(--color-success)' }}>
                {paymentsEnabled ? 'Disable real payments?' : 'Enable real payments? Real money will flow.'}
              </span>
              <button
                onClick={togglePayments}
                disabled={paymentToggleLoading}
                style={{
                  padding: '5px 14px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 700,
                  cursor: paymentToggleLoading ? 'wait' : 'pointer',
                  background: paymentsEnabled ? 'var(--color-error)' : 'var(--color-success)', color: 'var(--text-on-primary)',
                }}
              >
                {paymentToggleLoading ? '...' : 'Confirm'}
              </button>
              <button
                onClick={() => setPaymentToggleConfirm(false)}
                style={{
                  padding: '5px 14px', borderRadius: 6, border: '1px solid #ccc', background: 'var(--bg-surface)',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer', color: 'var(--text-secondary)',
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Platform Fee Settings */}
      <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid #1b6b5a' }}>
        <div className="card-header"><span className="card-icon">⚙️</span>Platform Fee Rate</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', flex: '1 1 200px' }}>
            The platform takes <strong>{feePercent}%</strong> of every session. Families pay the full rate, caregivers receive <strong>{100 - feePercent}%</strong>.
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
              Example: $100 session → Caregiver gets ${100 - feePercent}, Platform gets ${feePercent}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="number" step="1" min="0" max="50"
                value={feeInput}
                onChange={e => setFeeInput(e.target.value)}
                style={{ width: 60, padding: '6px 8px', borderRadius: 6, border: '1px solid #ddd', fontSize: 14, textAlign: 'center' }}
              />
              <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>%</span>
            </div>
            <button onClick={saveFee} disabled={feeSaving} style={{
              padding: '6px 16px', borderRadius: 6, border: 'none',
              background: feeSaving ? 'var(--text-muted)' : 'var(--role-color)', color: 'var(--text-on-primary)',
              fontSize: 13, fontWeight: 600, cursor: feeSaving ? 'wait' : 'pointer',
            }}>
              {feeSaving ? 'Saving...' : 'Update'}
            </button>
            {feeMsg && (
              <span style={{ fontSize: 12, color: feeMsg === 'Saved!' ? 'var(--color-success)' : 'var(--color-error)', fontWeight: 600 }}>{feeMsg}</span>
            )}
          </div>
        </div>
      </div>

      {/* All-time summary */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ padding: '8px 16px', borderRadius: 8, background: 'var(--bg-primary)', fontSize: 13, color: 'var(--text-secondary)' }}>
          All-time: <strong>{fmt(allTime.grossRevenue)}</strong> gross · <strong>{fmt(allTime.platformRevenue)}</strong> platform · <strong>{allTime.paymentCount}</strong> transactions
        </div>
      </div>

      {/* Revenue Trend Chart */}
      <div className="card">
        <div className="card-header"><span className="card-icon">📊</span>Revenue Trend (12 Months)</div>
        <RevenueChart data={monthly} />
      </div>

      {/* Two-column: Service Breakdown + Payout Speed */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 0 }}>
        <div className="card">
          <div className="card-header"><span className="card-icon">🥧</span>Revenue by Service Type</div>
          <ServiceDonut data={breakdown?.byServiceType || []} />
        </div>
        <div className="card">
          <div className="card-header"><span className="card-icon">⚡</span>Payout Speed Breakdown</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1, padding: 12, borderRadius: 8, background: 'var(--bg-primary)', textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--role-color)' }}>{standardPayout.count}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>Standard (48h)</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmt(standardPayout.revenue)}</div>
              </div>
              <div style={{ flex: 1, padding: 12, borderRadius: 8, background: 'var(--color-warning-bg)', textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-warning)' }}>{instantPayout.count}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>Instant (same-day)</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmt(instantPayout.revenue)}</div>
              </div>
            </div>
            <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--color-success-bg)', fontSize: 12, color: 'var(--color-success)', fontWeight: 500 }}>
              💰 Estimated instant payout surcharge revenue: <strong>{fmt(instantSurchargeRevenue)}</strong> (2% of instant volume)
            </div>
          </div>
        </div>
      </div>

      {/* AI Insights */}
      <div className="card">
        <div className="card-header"><span className="card-icon">🧠</span>AI Insights & Recommendations</div>
        {insights.length > 0 ? (
          <>
            {visibleInsights.map((insight, i) => <InsightCard key={insight.id || i} insight={insight} />)}
            {insights.length > 5 && (
              <button onClick={() => setShowAllInsights(!showAllInsights)}
                style={{ padding: '8px 16px', border: '1px solid #d0d0d0', borderRadius: 8, background: 'var(--bg-surface)', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer', width: '100%', marginTop: 4 }}>
                {showAllInsights ? 'Show less' : `Show all ${insights.length} insights`}
              </button>
            )}
          </>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Insights will appear as payment data accumulates.</p>
        )}
      </div>

      {/* Top Performers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 0 }}>
        <div className="card">
          <div className="card-header"><span className="card-icon">👨‍👩‍👧</span>Top Families by Spend</div>
          {(breakdown?.topFamilies || []).length > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
                  <th style={{ textAlign: 'left', padding: '6px 4px', fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600 }}>Name</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px', fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600 }}>Spent</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px', fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600 }}>Sessions</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px', fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600 }}>Avg</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.topFamilies.map((f, i) => (
                  <tr key={f.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '8px 4px', fontWeight: 500 }}>{i + 1}. {f.name}</td>
                    <td style={{ padding: '8px 4px', textAlign: 'right', color: 'var(--role-color)', fontWeight: 600 }}>{fmt(f.totalSpent)}</td>
                    <td style={{ padding: '8px 4px', textAlign: 'right', color: 'var(--text-secondary)' }}>{f.sessionCount}</td>
                    <td style={{ padding: '8px 4px', textAlign: 'right', color: 'var(--text-tertiary)' }}>{fmt(f.avgSession)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No payment data yet</p>}
        </div>
        <div className="card">
          <div className="card-header"><span className="card-icon">🤝</span>Top Caregivers by Earnings</div>
          {(breakdown?.topCaregivers || []).length > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
                  <th style={{ textAlign: 'left', padding: '6px 4px', fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600 }}>Name</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px', fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600 }}>Earned</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px', fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600 }}>Sessions</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px', fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600 }}>Rating</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.topCaregivers.map((c, i) => (
                  <tr key={c.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '8px 4px', fontWeight: 500 }}>{i + 1}. {c.name}</td>
                    <td style={{ padding: '8px 4px', textAlign: 'right', color: 'var(--role-color)', fontWeight: 600 }}>{fmt(c.totalEarned)}</td>
                    <td style={{ padding: '8px 4px', textAlign: 'right', color: 'var(--text-secondary)' }}>{c.sessionCount}</td>
                    <td style={{ padding: '8px 4px', textAlign: 'right', color: 'var(--text-tertiary)' }}>{c.rating > 0 ? `⭐ ${c.rating.toFixed(1)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No payment data yet</p>}
        </div>
      </div>

      {/* Transaction History */}
      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div><span className="card-icon">📋</span>Transaction History</div>
          <input
            value={txFilter} onChange={(e) => setTxFilter(e.target.value)}
            placeholder="Search by name or service..."
            style={{ padding: '6px 12px', border: '1px solid #d0d0d0', borderRadius: 8, fontSize: 13, width: 220 }}
          />
        </div>
        {filteredTx.length > 0 ? (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 700 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
                    {['Date', 'Family', 'Caregiver', 'Service', 'Amount', 'Platform Fee', 'Payout', 'Speed', 'Status'].map(h => (
                      <th key={h} style={{ textAlign: h === 'Date' || h === 'Family' || h === 'Caregiver' || h === 'Service' ? 'left' : 'right', padding: '8px 6px', fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredTx.map(t => (
                    <tr key={t.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '8px 6px', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{(parseTimestamp(t.date) || new Date()).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</td>
                      <td style={{ padding: '8px 6px', fontWeight: 500 }}>{t.familyName || '—'}</td>
                      <td style={{ padding: '8px 6px' }}>{t.caregiverName || '—'}</td>
                      <td style={{ padding: '8px 6px', color: 'var(--text-secondary)' }}>{serviceLabels[t.serviceType] || t.serviceType}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 600 }}>{fmt(t.amount)}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--role-color)' }}>{fmt(t.platformFee)}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--text-secondary)' }}>{fmt(t.caregiverPayout)}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                        <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 8, background: t.payoutSpeed === 'instant' ? 'var(--color-warning-bg)' : 'var(--bg-primary)', color: t.payoutSpeed === 'instant' ? 'var(--color-warning)' : 'var(--text-tertiary)' }}>
                          {t.payoutSpeed === 'instant' ? '⚡ Instant' : 'Standard'}
                        </span>
                      </td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}><StatusBadge status={t.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Pagination */}
            {transactions.totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12, alignItems: 'center' }}>
                <button
                  onClick={() => setTxPage(Math.max(1, txPage - 1))}
                  disabled={txPage <= 1}
                  style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #d0d0d0', background: 'var(--bg-surface)', cursor: txPage <= 1 ? 'default' : 'pointer', fontSize: 13, opacity: txPage <= 1 ? 0.5 : 1 }}>
                  ← Prev
                </button>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  Page {transactions.page} of {transactions.totalPages} ({transactions.total} total)
                </span>
                <button
                  onClick={() => setTxPage(Math.min(transactions.totalPages, txPage + 1))}
                  disabled={txPage >= transactions.totalPages}
                  style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #d0d0d0', background: 'var(--bg-surface)', cursor: txPage >= transactions.totalPages ? 'default' : 'pointer', fontSize: 13, opacity: txPage >= transactions.totalPages ? 0.5 : 1 }}>
                  Next →
                </button>
              </div>
            )}
          </>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: 13, padding: '8px 0' }}>
            {txFilter ? 'No transactions match your search.' : 'No transactions yet. They\'ll appear here once payments are processed through Stripe.'}
          </p>
        )}
      </div>
    </>
  );
};
