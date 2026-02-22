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

  const fetchAll = async (showRefresh) => {
    if (showRefresh) setRefreshing(true);
    try {
      const [sumRes, brkRes, insRes, txRes] = await Promise.all([
        apiFetch('/api/admin/financials/summary'),
        apiFetch('/api/admin/financials/breakdown'),
        apiFetch('/api/admin/financials/insights'),
        apiFetch(`/api/admin/financials/transactions?page=${txPage}&limit=25`),
      ]);
      if (sumRes?.ok) setSummary(await sumRes.json());
      if (brkRes?.ok) setBreakdown(await brkRes.json());
      if (insRes?.ok) { const d = await insRes.json(); setInsights(d.insights || []); }
      if (txRes?.ok) setTransactions(await txRes.json());
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Financials fetch error:', err);
    }
    setLoading(false);
    setRefreshing(false);
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
          color: isPositive ? '#2e7d32' : '#c62828',
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
                <line x1={leftPad} y1={y} x2={chartWidth - 10} y2={y} stroke="#e8e8e8" strokeWidth="1" />
                <text x={leftPad - 6} y={y + 4} textAnchor="end" fontSize="10" fill="#999">
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
                <rect x={x} y={chartHeight - totalH} width={barWidth} height={Math.max(platformH, 0)} rx="2" fill="#1b6b5a" opacity={0.85} />
                {/* Value label */}
                {d.grossRevenue > 0 && (
                  <text x={x + barWidth / 2} y={chartHeight - totalH - 4} textAnchor="middle" fontSize="8" fill="#555" fontWeight="600">
                    ${Math.round(d.grossRevenue)}
                  </text>
                )}
                {/* Month label */}
                <text x={x + barWidth / 2} y={chartHeight + 14} textAnchor="middle" fontSize="10" fill="#888">
                  {d.label}
                </text>
              </g>
            );
          })}
        </svg>
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 4, fontSize: 11, color: '#666' }}>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#1b6b5a', borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }}></span>Platform Fee</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#d0d0d0', borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }}></span>Caregiver Payout</span>
        </div>
      </div>
    );
  };

  // ─── Donut Chart (Service Breakdown) ───
  const ServiceDonut = ({ data }) => {
    if (!data || !data.length) return <p style={{ color: '#999', fontSize: 13 }}>No service data yet</p>;
    const total = data.reduce((s, d) => s + d.revenue, 0);
    if (total === 0) return <p style={{ color: '#999', fontSize: 13 }}>No revenue data yet</p>;
    const colors = ['#1b6b5a', '#e8724a', '#3498db', '#9b59b6', '#f39c12', '#2ecc71'];
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
          <text x={cx} y={cy - 4} textAnchor="middle" fontSize="16" fontWeight="700" fill="#333">{fmt(total)}</text>
          <text x={cx} y={cy + 12} textAnchor="middle" fontSize="9" fill="#999">total revenue</text>
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {arcs.map((a, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: a.color, flexShrink: 0 }} />
              <span style={{ color: '#555' }}>{a.label}</span>
              <span style={{ color: '#999' }}>({a.pct}% · {fmt(a.revenue)})</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ─── Insight Card ───
  const InsightCard = ({ insight }) => {
    const severityStyles = {
      positive: { bg: '#e8f5e9', border: '#a5d6a7', icon: '✅', color: '#2e7d32' },
      neutral: { bg: '#e3f2fd', border: '#90caf9', icon: 'ℹ️', color: '#1565c0' },
      warning: { bg: '#fff8e1', border: '#ffe082', icon: '⚠️', color: '#f57f17' },
      critical: { bg: '#fce4ec', border: '#ef9a9a', icon: '🚨', color: '#c62828' },
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
              padding: '2px 10px', borderRadius: 12, background: '#fff', fontSize: 13,
              fontWeight: 700, color: s.color, border: `1px solid ${s.border}`,
            }}>
              {insight.metric}
            </div>
          )}
        </div>
        <div style={{ fontSize: 13, color: '#555', lineHeight: 1.5, marginBottom: 8 }}>{insight.description}</div>
        <div style={{ fontSize: 12, color: '#333', fontWeight: 600, background: 'rgba(255,255,255,0.6)', padding: '8px 10px', borderRadius: 6 }}>
          💡 {insight.recommendation}
        </div>
      </div>
    );
  };

  // ─── Status Badge ───
  const StatusBadge = ({ status }) => {
    const styles = {
      completed: { bg: '#e8f5e9', color: '#2e7d32' },
      pending: { bg: '#fff8e1', color: '#f57f17' },
      failed: { bg: '#fce4ec', color: '#c62828' },
      refunded: { bg: '#fff3e0', color: '#e65100' },
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
            <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
              Last updated: {lastUpdated.toLocaleTimeString()} · Auto-refreshes every 60s
            </div>
          )}
        </div>
        <button
          onClick={() => fetchAll(true)}
          disabled={refreshing}
          style={{
            padding: '6px 16px', borderRadius: 8, border: '1px solid #d0d0d0',
            background: refreshing ? '#f0f0f0' : '#fff', cursor: refreshing ? 'wait' : 'pointer',
            fontSize: 13, fontWeight: 600, color: '#555',
          }}>
          {refreshing ? '↻ Refreshing...' : '↻ Refresh'}
        </button>
      </div>

      {/* KPI Cards */}
      <div className="stats-grid">
        <KpiCard icon="💰" label="Gross Revenue" current={kpi.grossRevenue?.current} previous={kpi.grossRevenue?.previous} />
        <KpiCard icon="🏦" label="Platform Revenue" current={kpi.platformRevenue?.current} previous={kpi.platformRevenue?.previous} />
        <KpiCard icon="📈" label="Net Revenue" current={kpi.netRevenue?.current} previous={kpi.netRevenue?.previous} />
        <KpiCard icon="📅" label="Sessions" current={kpi.totalSessions?.current} previous={kpi.totalSessions?.previous} isMoney={false} />
        <KpiCard icon="💎" label="Avg Session Value" current={kpi.avgSessionValue?.current} previous={kpi.avgSessionValue?.previous} />
        <KpiCard icon="🔍" label="BG Check Revenue" current={kpi.bgCheckRevenue?.current} previous={kpi.bgCheckRevenue?.previous} />
      </div>

      {/* All-time summary */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ padding: '8px 16px', borderRadius: 8, background: '#f5f5f5', fontSize: 13, color: '#555' }}>
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
              <div style={{ flex: 1, padding: 12, borderRadius: 8, background: '#f5f5f5', textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#1b6b5a' }}>{standardPayout.count}</div>
                <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>Standard (48h)</div>
                <div style={{ fontSize: 11, color: '#999' }}>{fmt(standardPayout.revenue)}</div>
              </div>
              <div style={{ flex: 1, padding: 12, borderRadius: 8, background: '#fff3e0', textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#e65100' }}>{instantPayout.count}</div>
                <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>Instant (same-day)</div>
                <div style={{ fontSize: 11, color: '#999' }}>{fmt(instantPayout.revenue)}</div>
              </div>
            </div>
            <div style={{ padding: '10px 12px', borderRadius: 8, background: '#e8f5e9', fontSize: 12, color: '#2e7d32', fontWeight: 500 }}>
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
                style={{ padding: '8px 16px', border: '1px solid #d0d0d0', borderRadius: 8, background: '#fff', fontSize: 13, fontWeight: 600, color: '#555', cursor: 'pointer', width: '100%', marginTop: 4 }}>
                {showAllInsights ? 'Show less' : `Show all ${insights.length} insights`}
              </button>
            )}
          </>
        ) : (
          <p style={{ color: '#999', fontSize: 13 }}>Insights will appear as payment data accumulates.</p>
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
                  <th style={{ textAlign: 'left', padding: '6px 4px', fontSize: 11, color: '#888', fontWeight: 600 }}>Name</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px', fontSize: 11, color: '#888', fontWeight: 600 }}>Spent</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px', fontSize: 11, color: '#888', fontWeight: 600 }}>Sessions</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px', fontSize: 11, color: '#888', fontWeight: 600 }}>Avg</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.topFamilies.map((f, i) => (
                  <tr key={f.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '8px 4px', fontWeight: 500 }}>{i + 1}. {f.name}</td>
                    <td style={{ padding: '8px 4px', textAlign: 'right', color: '#1b6b5a', fontWeight: 600 }}>{fmt(f.totalSpent)}</td>
                    <td style={{ padding: '8px 4px', textAlign: 'right', color: '#666' }}>{f.sessionCount}</td>
                    <td style={{ padding: '8px 4px', textAlign: 'right', color: '#888' }}>{fmt(f.avgSession)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p style={{ color: '#999', fontSize: 13 }}>No payment data yet</p>}
        </div>
        <div className="card">
          <div className="card-header"><span className="card-icon">🤝</span>Top Caregivers by Earnings</div>
          {(breakdown?.topCaregivers || []).length > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
                  <th style={{ textAlign: 'left', padding: '6px 4px', fontSize: 11, color: '#888', fontWeight: 600 }}>Name</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px', fontSize: 11, color: '#888', fontWeight: 600 }}>Earned</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px', fontSize: 11, color: '#888', fontWeight: 600 }}>Sessions</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px', fontSize: 11, color: '#888', fontWeight: 600 }}>Rating</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.topCaregivers.map((c, i) => (
                  <tr key={c.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '8px 4px', fontWeight: 500 }}>{i + 1}. {c.name}</td>
                    <td style={{ padding: '8px 4px', textAlign: 'right', color: '#1b6b5a', fontWeight: 600 }}>{fmt(c.totalEarned)}</td>
                    <td style={{ padding: '8px 4px', textAlign: 'right', color: '#666' }}>{c.sessionCount}</td>
                    <td style={{ padding: '8px 4px', textAlign: 'right', color: '#888' }}>{c.rating > 0 ? `⭐ ${c.rating.toFixed(1)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p style={{ color: '#999', fontSize: 13 }}>No payment data yet</p>}
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
                      <th key={h} style={{ textAlign: h === 'Date' || h === 'Family' || h === 'Caregiver' || h === 'Service' ? 'left' : 'right', padding: '8px 6px', fontSize: 11, color: '#888', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredTx.map(t => (
                    <tr key={t.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '8px 6px', whiteSpace: 'nowrap', color: '#555' }}>{(parseTimestamp(t.date) || new Date()).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</td>
                      <td style={{ padding: '8px 6px', fontWeight: 500 }}>{t.familyName || '—'}</td>
                      <td style={{ padding: '8px 6px' }}>{t.caregiverName || '—'}</td>
                      <td style={{ padding: '8px 6px', color: '#666' }}>{serviceLabels[t.serviceType] || t.serviceType}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 600 }}>{fmt(t.amount)}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right', color: '#1b6b5a' }}>{fmt(t.platformFee)}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right', color: '#666' }}>{fmt(t.caregiverPayout)}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                        <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 8, background: t.payoutSpeed === 'instant' ? '#fff3e0' : '#f5f5f5', color: t.payoutSpeed === 'instant' ? '#e65100' : '#888' }}>
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
                  style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #d0d0d0', background: '#fff', cursor: txPage <= 1 ? 'default' : 'pointer', fontSize: 13, opacity: txPage <= 1 ? 0.5 : 1 }}>
                  ← Prev
                </button>
                <span style={{ fontSize: 13, color: '#666' }}>
                  Page {transactions.page} of {transactions.totalPages} ({transactions.total} total)
                </span>
                <button
                  onClick={() => setTxPage(Math.min(transactions.totalPages, txPage + 1))}
                  disabled={txPage >= transactions.totalPages}
                  style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #d0d0d0', background: '#fff', cursor: txPage >= transactions.totalPages ? 'default' : 'pointer', fontSize: 13, opacity: txPage >= transactions.totalPages ? 0.5 : 1 }}>
                  Next →
                </button>
              </div>
            )}
          </>
        ) : (
          <p style={{ color: '#999', fontSize: 13, padding: '8px 0' }}>
            {txFilter ? 'No transactions match your search.' : 'No transactions yet. They\'ll appear here once payments are processed through Stripe.'}
          </p>
        )}
      </div>
    </>
  );
};
