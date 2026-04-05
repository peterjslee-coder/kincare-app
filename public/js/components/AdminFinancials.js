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
  const [expandedTx, setExpandedTx] = useState(null); // expanded transaction ID
  // Time Record Audit
  const [timeAudit, setTimeAudit] = useState(null);
  const [timeAuditLoading, setTimeAuditLoading] = useState(false);
  const [auditView, setAuditView] = useState('unconfirmed'); // 'unconfirmed' | 'discrepancies' | 'missing' | 'late'
  const [auditExpanded, setAuditExpanded] = useState(null); // session ID of expanded row

  // Platform fee settings
  const [feePercent, setFeePercent] = useState(20);
  const [feeInput, setFeeInput] = useState('20');
  const [feeSaving, setFeeSaving] = useState(false);
  const [feeMsg, setFeeMsg] = useState('');
  // Payment kill switch
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [paymentToggleLoading, setPaymentToggleLoading] = useState(false);
  const [paymentToggleConfirm, setPaymentToggleConfirm] = useState(false);
  // Daily snapshot (chart + quick stats)
  const [dailySnapshot, setDailySnapshot] = useState(null);
  // Treasury (Mercury + Stripe)
  const [treasury, setTreasury] = useState(null);
  const [treasuryLoading, setTreasuryLoading] = useState(true);
  const [treasuryExpanded, setTreasuryExpanded] = useState(null); // 'mercury-{id}' or 'stripe-payouts' etc

  const fetchAll = async (showRefresh) => {
    if (showRefresh) setRefreshing(true);
    try {
      const [sumRes, brkRes, insRes, txRes, feeRes, payRes, trsRes, auditRes, snapRes] = await Promise.all([
        apiFetch('/api/admin/financials/summary'),
        apiFetch('/api/admin/financials/breakdown'),
        apiFetch('/api/admin/financials/insights'),
        apiFetch(`/api/admin/financials/transactions?page=${txPage}&limit=25`),
        apiFetch('/api/admin/financials/platform-fee'),
        apiFetch('/api/admin/financials/payments-enabled'),
        apiFetch('/api/admin/treasury'),
        apiFetch('/api/admin/financials/time-audit'),
        apiFetch('/api/admin/financials/daily-snapshot'),
      ]);
      if (sumRes?.ok) setSummary(await sumRes.json());
      if (brkRes?.ok) setBreakdown(await brkRes.json());
      if (insRes?.ok) { const d = await insRes.json(); setInsights(d.insights || []); }
      if (txRes?.ok) setTransactions(await txRes.json());
      if (auditRes?.ok) setTimeAudit(await auditRes.json());
      if (snapRes?.ok) setDailySnapshot(await snapRes.json());
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
  // Instant payout fees are Stripe's (1%, min $0.50) — no platform surcharge revenue

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
            background: refreshing ? 'var(--badge-muted-bg)' : 'var(--bg-card)', cursor: refreshing ? 'wait' : 'pointer',
            fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)',
          }}>
          {refreshing ? '↻ Refreshing...' : '↻ Refresh'}
        </button>
      </div>

      {/* ── Daily Snapshot: Quick Stats + Line Chart ── */}
      {dailySnapshot && (
        <div className="card" style={{ marginBottom: 16, padding: 18 }}>
          {/* Quick stat pills */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            {[
              { label: 'Sessions', value: dailySnapshot.quickStats.sessionsToday, delta: dailySnapshot.quickStats.sessionsDelta, prefix: '' },
              { label: 'Gross Rev', value: dailySnapshot.quickStats.grossToday, delta: dailySnapshot.quickStats.grossDelta, prefix: '$' },
              { label: 'Platform Fees', value: dailySnapshot.quickStats.feesToday, delta: dailySnapshot.quickStats.feesDelta, prefix: '$' },
              { label: 'Net to Caregivers', value: dailySnapshot.quickStats.netToday, delta: dailySnapshot.quickStats.netDelta, prefix: '$' },
              { label: 'Payments', value: dailySnapshot.quickStats.paymentsToday, delta: dailySnapshot.quickStats.paymentsDelta, prefix: '' },
            ].map((s, i) => {
              const isPos = s.delta > 0;
              const isZero = s.delta === 0;
              const displayVal = s.prefix === '$' ? `$${Number(s.value).toFixed(2)}` : s.value;
              return (
                <div key={i} style={{
                  flex: '1 1 130px', padding: '10px 14px', borderRadius: 10,
                  background: 'var(--bg-surface)', border: '1px solid var(--border-color)',
                }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 }}>{s.label}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>{displayVal}</span>
                    {!isZero && (
                      <span style={{ fontSize: 11, fontWeight: 600, color: isPos ? '#2e7d32' : '#c62828' }}>
                        {isPos ? '▲' : '▼'} {Math.abs(s.delta)}%
                      </span>
                    )}
                    {isZero && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>vs yesterday</div>
                </div>
              );
            })}
          </div>

          {/* Line chart: Gross / Net / Fees over 14 days */}
          {(() => {
            const days = dailySnapshot.days || [];
            if (days.length === 0) return null;
            const W = 620, H = 180, padL = 50, padR = 12, padT = 12, padB = 32;
            const plotW = W - padL - padR;
            const plotH = H - padT - padB;
            const maxVal = Math.max(...days.map(d => d.gross), 1);
            const xStep = plotW / Math.max(days.length - 1, 1);
            const scaleY = (v) => padT + plotH - (v / maxVal) * plotH;
            const scaleX = (i) => padL + i * xStep;
            const linePath = (key) => days.map((d, i) => `${i === 0 ? 'M' : 'L'}${scaleX(i).toFixed(1)},${scaleY(d[key]).toFixed(1)}`).join(' ');

            const lines = [
              { key: 'gross', color: '#1565c0', label: 'Gross' },
              { key: 'net', color: '#2e7d32', label: 'Net to Caregiver' },
              { key: 'fees', color: '#e65100', label: 'Platform Fees' },
            ];

            // Y-axis grid values
            const gridSteps = 4;
            const gridVals = Array.from({ length: gridSteps + 1 }, (_, i) => Math.round((maxVal / gridSteps) * i));

            return (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>14-Day Revenue Trend</span>
                  <div style={{ display: 'flex', gap: 12 }}>
                    {lines.map(l => (
                      <span key={l.key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: l.color }}>
                        <span style={{ width: 14, height: 3, borderRadius: 2, background: l.color, display: 'inline-block' }}></span>
                        {l.label}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W }}>
                    {/* Grid lines */}
                    {gridVals.map((v, i) => (
                      <g key={i}>
                        <line x1={padL} y1={scaleY(v)} x2={W - padR} y2={scaleY(v)} stroke="#e0e0e0" strokeDasharray="3,3" />
                        <text x={padL - 6} y={scaleY(v) + 4} textAnchor="end" fontSize="10" fill="#999">${v}</text>
                      </g>
                    ))}
                    {/* X-axis labels */}
                    {days.map((d, i) => (
                      i % 2 === 0 && <text key={i} x={scaleX(i)} y={H - 4} textAnchor="middle" fontSize="9" fill="#999">{d.shortLabel}</text>
                    ))}
                    {/* Lines */}
                    {lines.map(l => (
                      <path key={l.key} d={linePath(l.key)} fill="none" stroke={l.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
                    ))}
                    {/* Dots on last day */}
                    {lines.map(l => {
                      const last = days[days.length - 1];
                      return <circle key={l.key + '-dot'} cx={scaleX(days.length - 1)} cy={scaleY(last[l.key])} r="4" fill={l.color} />;
                    })}
                  </svg>
                </div>
              </div>
            );
          })()}
        </div>
      )}

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
            <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--bg-secondary)', fontSize: 12, color: 'var(--text-secondary)' }}>
              ℹ️ Instant payout fees (1%, min $0.50) are charged by Stripe directly — no platform cost or revenue.
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
                  {filteredTx.map(t => {
                    const isExpanded = expandedTx === t.id;
                    const fmtTs = (iso) => { if (!iso) return '—'; const d = new Date(iso); return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
                    return (
                      <React.Fragment key={t.id}>
                        <tr onClick={() => setExpandedTx(isExpanded ? null : t.id)} style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer', background: isExpanded ? 'var(--bg-surface)' : 'transparent', transition: 'background 0.1s' }}
                          onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'var(--bg-surface)'; }}
                          onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = 'transparent'; }}>
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
                        {isExpanded && (
                          <tr>
                            <td colSpan={9} style={{ padding: '12px 16px', background: 'var(--bg-surface)', borderBottom: '2px solid var(--border-color)' }}>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, fontSize: 12, lineHeight: 1.7 }}>
                                <div>
                                  <div style={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4, letterSpacing: 0.4 }}>Session</div>
                                  <div><strong>Scheduled:</strong> {t.scheduledDate} {t.scheduledTime || ''}</div>
                                  <div><strong>Duration:</strong> {t.durationHours ? `${t.durationHours}h` : '—'}</div>
                                  <div><strong>Session Status:</strong> {t.sessionStatus || '—'}</div>
                                  {t.careRecipient && <div><strong>Care Recipient:</strong> {t.careRecipient}</div>}
                                  {t.lateCheckIn && <div style={{ color: '#c62828' }}>Late check-in</div>}
                                </div>
                                <div>
                                  <div style={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4, letterSpacing: 0.4 }}>Time Records</div>
                                  <div><strong>Clock In:</strong> {fmtTs(t.checkIn)}</div>
                                  <div><strong>Clock Out:</strong> {fmtTs(t.checkOut)}</div>
                                  <div><strong>Confirmed:</strong> {t.reviewCompleted ? '✅ Family reviewed' : '⏳ Pending'}</div>
                                  {t.tipCents > 0 && <div><strong>Tip:</strong> ${(t.tipCents / 100).toFixed(2)}</div>}
                                  {t.autoCharged && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Auto-charged</div>}
                                </div>
                                <div>
                                  <div style={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4, letterSpacing: 0.4 }}>Geotag</div>
                                  {t.geo ? (
                                    <>
                                      {t.geo.inLat && <div><strong>Check-in:</strong> <a href={`https://maps.google.com/?q=${t.geo.inLat},${t.geo.inLng}`} target="_blank" rel="noopener" style={{ color: 'var(--role-color)' }}>{t.geo.inLat.toFixed(5)}, {t.geo.inLng.toFixed(5)}</a></div>}
                                      {t.geo.outLat && <div><strong>Check-out:</strong> <a href={`https://maps.google.com/?q=${t.geo.outLat},${t.geo.outLng}`} target="_blank" rel="noopener" style={{ color: 'var(--role-color)' }}>{t.geo.outLat.toFixed(5)}, {t.geo.outLng.toFixed(5)}</a></div>}
                                    </>
                                  ) : <div style={{ color: 'var(--text-muted)' }}>No GPS data</div>}
                                  <div style={{ marginTop: 6 }}>
                                    <strong>Family:</strong> {t.familyEmail || '—'}<br />
                                    <strong>Caregiver:</strong> {t.caregiverEmail || '—'}
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
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

      {/* ─── Time Record Audit ─── */}
      <div className="card" style={{ marginTop: 20, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Time Record Audit</h3>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Per Caregiver Agreement §3</span>
        </div>

        {/* Audit metric cards */}
        {timeAudit && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
              {[
                { key: 'unconfirmed', icon: '⏳', label: 'Unconfirmed', count: timeAudit.counts.unconfirmed, color: '#e65100', bg: '#fff3e0', desc: 'No family review' },
                { key: 'discrepancies', icon: '⚠️', label: 'Time Gaps', count: timeAudit.counts.discrepancies, color: '#c62828', bg: '#ffebee', desc: 'Actual ≠ scheduled' },
                { key: 'missing', icon: '❌', label: 'No Records', count: timeAudit.counts.missingRecords, color: '#4a148c', bg: '#f3e5f5', desc: 'Missing clock data' },
                { key: 'late', icon: '🕐', label: 'Late Check-in', count: timeAudit.counts.lateCheckins, color: '#1565c0', bg: '#e3f2fd', desc: 'Arrived late' },
              ].map(m => (
                <div key={m.key} onClick={() => setAuditView(m.key)} style={{
                  padding: '14px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'center',
                  border: auditView === m.key ? `2px solid ${m.color}` : '1px solid var(--border-color)',
                  background: auditView === m.key ? m.bg : 'var(--bg-surface)',
                  transition: 'all 0.15s',
                }}>
                  <div style={{ fontSize: 22 }}>{m.icon}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: m.count > 0 ? m.color : 'var(--text-muted)', marginTop: 2 }}>{m.count}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', marginTop: 2 }}>{m.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{m.desc}</div>
                </div>
              ))}
            </div>

            {/* Drill-down table */}
            {(() => {
              const rows = auditView === 'unconfirmed' ? timeAudit.unconfirmed
                : auditView === 'discrepancies' ? timeAudit.discrepancies
                : auditView === 'missing' ? timeAudit.missingRecords
                : []; // late checkins come from discrepancies filtered

              const fmtTime = (iso) => {
                if (!iso) return '—';
                const d = new Date(iso);
                return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
              };
              const fmtDuration = (hrs) => {
                if (!hrs && hrs !== 0) return '—';
                const h = Math.floor(hrs);
                const m = Math.round((hrs - h) * 60);
                return h > 0 ? `${h}h ${m}m` : `${m}m`;
              };
              const haversineDistFt = (lat1, lng1, lat2, lng2) => {
                const toRad = x => x * Math.PI / 180;
                const R = 20902231; // earth radius in feet
                const dLat = toRad(lat2 - lat1);
                const dLng = toRad(lng2 - lng1);
                const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
                return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
              };
              const geoIcon = (geo) => {
                if (!geo || (!geo.inLat && !geo.outLat)) return React.createElement('span', { style: { color: 'var(--text-muted)', fontSize: 11 } }, '—');
                const hasIn = geo.inLat && geo.inLng;
                const hasOut = geo.outLat && geo.outLng;
                const sameSpot = hasIn && hasOut && haversineDistFt(geo.inLat, geo.inLng, geo.outLat, geo.outLng) < 500;
                const icon = hasIn && hasOut ? (sameSpot ? '📍' : '📍📍') : hasIn ? '📍½' : '📍?';
                const label = sameSpot ? 'Same location' : hasIn && hasOut ? 'Separate locations' : hasIn ? 'Check-in only' : 'Check-out only';
                return React.createElement('span', {
                  title: label,
                  style: { cursor: 'pointer', fontSize: 13 },
                }, icon);
              };

              if (rows.length === 0) {
                return React.createElement('p', { style: { color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '12px 0' } },
                  auditView === 'late' ? 'Late check-in data is included in the Time Gaps view above.' : 'No records in this category.'
                );
              }

              return React.createElement('div', { style: { overflowX: 'auto' } },
                React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
                  React.createElement('thead', null,
                    React.createElement('tr', { style: { borderBottom: '2px solid var(--border-color)', textAlign: 'left' } },
                      React.createElement('th', { style: { padding: '8px 6px', fontWeight: 600, color: 'var(--text-secondary)' } }, 'Date'),
                      React.createElement('th', { style: { padding: '8px 6px', fontWeight: 600, color: 'var(--text-secondary)' } }, 'Caregiver'),
                      React.createElement('th', { style: { padding: '8px 6px', fontWeight: 600, color: 'var(--text-secondary)' } }, 'Family'),
                      React.createElement('th', { style: { padding: '8px 6px', fontWeight: 600, color: 'var(--text-secondary)' } }, 'Scheduled'),
                      auditView === 'discrepancies'
                        ? React.createElement('th', { style: { padding: '8px 6px', fontWeight: 600, color: 'var(--text-secondary)' } }, 'Actual')
                        : null,
                      auditView === 'discrepancies'
                        ? React.createElement('th', { style: { padding: '8px 6px', fontWeight: 600, color: 'var(--text-secondary)' } }, 'Delta')
                        : null,
                      React.createElement('th', { style: { padding: '8px 6px', fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'center' } }, 'Confirmed'),
                      React.createElement('th', { style: { padding: '8px 6px', fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'center' } }, 'Geo'),
                      auditView === 'missing'
                        ? React.createElement('th', { style: { padding: '8px 6px', fontWeight: 600, color: 'var(--text-secondary)' } }, 'Missing')
                        : null,
                    )
                  ),
                  React.createElement('tbody', null,
                    rows.map(r => {
                      const expanded = auditExpanded === r.sessionId;
                      return React.createElement(React.Fragment, { key: r.sessionId },
                        React.createElement('tr', {
                          onClick: () => setAuditExpanded(expanded ? null : r.sessionId),
                          style: { borderBottom: '1px solid var(--border-color)', cursor: 'pointer', background: expanded ? 'var(--bg-surface)' : 'transparent' },
                        },
                          React.createElement('td', { style: { padding: '8px 6px', whiteSpace: 'nowrap' } }, r.scheduledDate),
                          React.createElement('td', { style: { padding: '8px 6px', fontWeight: 500 } }, r.caregiver),
                          React.createElement('td', { style: { padding: '8px 6px' } }, r.family),
                          React.createElement('td', { style: { padding: '8px 6px' } }, fmtDuration(r.durationHours)),
                          auditView === 'discrepancies'
                            ? React.createElement('td', { style: { padding: '8px 6px', fontWeight: 600 } }, fmtDuration(r.actualHours))
                            : null,
                          auditView === 'discrepancies'
                            ? React.createElement('td', { style: { padding: '8px 6px', fontWeight: 700, color: r.deltaMinutes > 0 ? '#c62828' : '#2e7d32' } },
                                `${r.deltaMinutes > 0 ? '+' : ''}${r.deltaMinutes}m`)
                            : null,
                          React.createElement('td', { style: { padding: '8px 6px', textAlign: 'center' } },
                            r.reviewCompleted ? '✅' : '⏳'),
                          React.createElement('td', { style: { padding: '8px 6px', textAlign: 'center' } },
                            r.geo ? geoIcon(r.geo) : '—'),
                          auditView === 'missing'
                            ? React.createElement('td', { style: { padding: '8px 6px', fontSize: 11, color: '#c62828' } },
                                !r.hasVisitLog ? 'No visit log' : !r.hasCheckIn ? 'No check-in' : 'No check-out')
                            : null,
                        ),
                        // Expanded detail row
                        expanded && React.createElement('tr', { key: r.sessionId + '-detail' },
                          React.createElement('td', { colSpan: 99, style: { padding: '10px 16px', background: 'var(--bg-surface)', fontSize: 12, lineHeight: 1.6 } },
                            React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
                              React.createElement('div', null,
                                React.createElement('strong', null, 'Clock In: '), fmtTime(r.checkIn), React.createElement('br'),
                                React.createElement('strong', null, 'Clock Out: '), fmtTime(r.checkOut), React.createElement('br'),
                                React.createElement('strong', null, 'Service: '), r.serviceType,
                              ),
                              React.createElement('div', null,
                                (() => {
                                  if (!r.geo) return React.createElement(React.Fragment, null,
                                    React.createElement('span', { style: { color: 'var(--text-muted)', fontStyle: 'italic' } }, 'No GPS data recorded'),
                                    React.createElement('br'),
                                  );
                                  const hasIn = r.geo.inLat && r.geo.inLng;
                                  const hasOut = r.geo.outLat && r.geo.outLng;
                                  const sameSpot = hasIn && hasOut && haversineDistFt(r.geo.inLat, r.geo.inLng, r.geo.outLat, r.geo.outLng) < 500;
                                  const ioDistFt = hasIn && hasOut ? Math.round(haversineDistFt(r.geo.inLat, r.geo.inLng, r.geo.outLat, r.geo.outLng)) : null;
                                  if (sameSpot) {
                                    // Combined pin — check-in and check-out were at the same place
                                    const midLat = ((r.geo.inLat + r.geo.outLat) / 2).toFixed(5);
                                    const midLng = ((r.geo.inLng + r.geo.outLng) / 2).toFixed(5);
                                    return React.createElement(React.Fragment, null,
                                      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 } },
                                        React.createElement('span', { style: { fontSize: 16 } }, '📍'),
                                        React.createElement('div', null,
                                          React.createElement('strong', { style: { color: '#2e7d32' } }, 'Same location '),
                                          React.createElement('span', { style: { fontSize: 11, color: 'var(--text-muted)' } }, `(${ioDistFt} ft apart)`),
                                        ),
                                      ),
                                      React.createElement('a', {
                                        href: `https://maps.google.com/?q=${midLat},${midLng}`,
                                        target: '_blank', rel: 'noopener',
                                        style: { color: 'var(--role-color)', fontWeight: 600, fontSize: 12, display: 'inline-block', padding: '4px 10px', background: '#e8f5e9', borderRadius: 6 },
                                      }, `View on Map (${midLat}, ${midLng})`),
                                      r.geo.distanceFt != null && React.createElement('div', { style: { fontSize: 11, color: 'var(--text-muted)', marginTop: 4 } },
                                        `${Math.round(r.geo.distanceFt)} ft from care recipient's address`),
                                      React.createElement('br'),
                                    );
                                  }
                                  // Separate pins for check-in and check-out
                                  return React.createElement(React.Fragment, null,
                                    hasIn && React.createElement('div', { style: { marginBottom: 6 } },
                                      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                                        React.createElement('span', { style: { fontSize: 14 } }, '🟢'),
                                        React.createElement('strong', null, 'Check-in: '),
                                        React.createElement('a', {
                                          href: `https://maps.google.com/?q=${r.geo.inLat},${r.geo.inLng}`,
                                          target: '_blank', rel: 'noopener',
                                          style: { color: 'var(--role-color)', fontWeight: 500, fontSize: 12 },
                                        }, `${r.geo.inLat.toFixed(5)}, ${r.geo.inLng.toFixed(5)}`),
                                      ),
                                      r.geo.distanceFt != null && React.createElement('div', { style: { fontSize: 11, color: 'var(--text-muted)', marginLeft: 24 } },
                                        `${Math.round(r.geo.distanceFt)} ft from care recipient's address`),
                                    ),
                                    hasOut && React.createElement('div', { style: { marginBottom: 6 } },
                                      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                                        React.createElement('span', { style: { fontSize: 14 } }, '🔴'),
                                        React.createElement('strong', null, 'Check-out: '),
                                        React.createElement('a', {
                                          href: `https://maps.google.com/?q=${r.geo.outLat},${r.geo.outLng}`,
                                          target: '_blank', rel: 'noopener',
                                          style: { color: 'var(--role-color)', fontWeight: 500, fontSize: 12 },
                                        }, `${r.geo.outLat.toFixed(5)}, ${r.geo.outLng.toFixed(5)}`),
                                      ),
                                    ),
                                    hasIn && hasOut && React.createElement('div', { style: { fontSize: 11, color: ioDistFt > 2000 ? '#c62828' : 'var(--text-muted)', fontWeight: ioDistFt > 2000 ? 600 : 400, marginBottom: 4 } },
                                      `${ioDistFt.toLocaleString()} ft between check-in and check-out${ioDistFt > 2000 ? ' ⚠️ Large distance' : ''}`),
                                    !hasIn && !hasOut && React.createElement('span', { style: { color: 'var(--text-muted)', fontStyle: 'italic' } }, 'No GPS data recorded'),
                                    React.createElement('br'),
                                  );
                                })(),
                                React.createElement('strong', null, 'Status: '), r.status,
                              ),
                            ),
                          ),
                        ),
                      );
                    }),
                  ),
                ),
              );
            })()}
          </>
        )}
        {!timeAudit && React.createElement('p', { style: { color: 'var(--text-muted)', fontSize: 13 } }, 'Loading audit data...')}
      </div>
    </>
  );
};
