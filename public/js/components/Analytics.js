// ─── Analytics Dashboard ───
// Care hours, spending, and caregiver utilization charts for family users

const Analytics = window.Analytics = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeChart, setActiveChart] = useState('hours'); // hours | spend | sessions

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        const res = await apiFetch('/api/analytics');
        if (res?.ok) {
          const d = await res.json();
          setData(d);
        }
      } catch (err) {
        console.error('Analytics fetch error:', err);
      }
      setLoading(false);
    };
    fetchAnalytics();
  }, []);

  if (loading) return <LoadingSpinner text="Loading analytics..." />;
  if (!data) return <EmptyState icon="📊" title="No analytics yet" text="Analytics will appear once you have care sessions." />;

  const monthly = data.monthly || [];
  const serviceBreakdown = data.serviceBreakdown || [];
  const caregiverStats = data.caregiverStats || [];
  const totals = data.totals || {};

  // ─── Bar Chart Component ───
  const BarChart = ({ data: chartData, dataKey, color, unit, label }) => {
    const maxVal = Math.max(...chartData.map(d => d[dataKey]), 1);
    const barWidth = Math.floor(220 / Math.max(chartData.length, 1));
    const chartHeight = 140;
    const chartWidth = 300;
    const leftPad = 40;
    const bottomPad = 28;

    return (
      <div style={{ overflowX: 'auto' }}>
        <svg width={chartWidth} height={chartHeight + bottomPad} viewBox={`0 0 ${chartWidth} ${chartHeight + bottomPad}`} style={{ width: '100%', maxWidth: chartWidth }}>
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
            const y = chartHeight - chartHeight * pct;
            return (
              <g key={i}>
                <line x1={leftPad} y1={y} x2={chartWidth - 10} y2={y} stroke="#e8e8e8" strokeWidth="1" />
                <text x={leftPad - 4} y={y + 4} textAnchor="end" fontSize="10" fill="#999">
                  {unit === '$' ? `$${Math.round(maxVal * pct)}` : Math.round(maxVal * pct)}
                </text>
              </g>
            );
          })}
          {/* Bars */}
          {chartData.map((d, i) => {
            const barH = (d[dataKey] / maxVal) * (chartHeight - 10);
            const x = leftPad + 8 + i * (barWidth + 4);
            return (
              <g key={i}>
                <rect
                  x={x} y={chartHeight - barH}
                  width={barWidth - 2} height={Math.max(barH, 0)}
                  rx="3" fill={color} opacity={0.85}
                />
                {d[dataKey] > 0 && (
                  <text x={x + (barWidth - 2) / 2} y={chartHeight - barH - 4} textAnchor="middle" fontSize="9" fill="#555" fontWeight="600">
                    {unit === '$' ? `$${d[dataKey]}` : d[dataKey]}
                  </text>
                )}
                <text x={x + (barWidth - 2) / 2} y={chartHeight + 14} textAnchor="middle" fontSize="10" fill="#888">
                  {d.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    );
  };

  // ─── Donut Chart for Service Breakdown ───
  const DonutChart = ({ data: slices }) => {
    if (!slices.length) return null;
    const total = slices.reduce((s, d) => s + d.count, 0);
    const colors = ['#1b6b5a', '#e8724a', '#3498db', '#9b59b6', '#f39c12', '#2ecc71'];
    const serviceLabels = {
      meals: 'Meals', rides: 'Rides', companion: 'Companion',
      companionship: 'Companion', personal_care: 'Personal Care',
      meal_prep: 'Meal Prep', transportation: 'Transport',
      health_wellness: 'Health', full_day: 'Full Day',
      housekeeping: 'Housekeeping',
    };

    let cumAngle = 0;
    const cx = 70, cy = 70, r = 55, ir = 35;
    const arcs = slices.map((s, i) => {
      const angle = (s.count / total) * 360;
      const startAngle = cumAngle;
      cumAngle += angle;
      const endAngle = cumAngle;
      const startRad = (startAngle - 90) * Math.PI / 180;
      const endRad = (endAngle - 90) * Math.PI / 180;
      const largeArc = angle > 180 ? 1 : 0;
      const x1 = cx + r * Math.cos(startRad);
      const y1 = cy + r * Math.sin(startRad);
      const x2 = cx + r * Math.cos(endRad);
      const y2 = cy + r * Math.sin(endRad);
      const ix1 = cx + ir * Math.cos(endRad);
      const iy1 = cy + ir * Math.sin(endRad);
      const ix2 = cx + ir * Math.cos(startRad);
      const iy2 = cy + ir * Math.sin(startRad);
      const path = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${ir} ${ir} 0 ${largeArc} 0 ${ix2} ${iy2} Z`;
      return { path, color: colors[i % colors.length], label: serviceLabels[s.serviceType] || s.serviceType, count: s.count, pct: Math.round(s.count / total * 100) };
    });

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <svg width="140" height="140" viewBox="0 0 140 140">
          {arcs.map((a, i) => <path key={i} d={a.path} fill={a.color} />)}
          <text x={cx} y={cy - 4} textAnchor="middle" fontSize="18" fontWeight="700" fill="#333">{total}</text>
          <text x={cx} y={cy + 12} textAnchor="middle" fontSize="10" fill="#999">sessions</text>
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {arcs.map((a, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
              <div style={{ width: 10, height: 10, borderRadius: '2px', background: a.color, flexShrink: 0 }} />
              <span style={{ color: '#555' }}>{a.label}</span>
              <span style={{ color: '#999' }}>({a.pct}%)</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const chartTabs = [
    { key: 'hours', label: 'Hours', color: '#1b6b5a', unit: '' },
    { key: 'spend', label: 'Spending', color: '#e8724a', unit: '$' },
    { key: 'sessions', label: 'Sessions', color: '#3498db', unit: '' },
  ];
  const activeTab = chartTabs.find(t => t.key === activeChart);

  return (
    <>
      <div className="page-header">
        <h1>Care Analytics</h1>
      </div>

      {/* Summary cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div style={{ fontSize: 28 }}>📅</div>
          <div className="stat-number">{totals.sessions}</div>
          <div className="stat-label">Total Sessions</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize: 28 }}>⏱️</div>
          <div className="stat-number">{totals.hours}</div>
          <div className="stat-label">Total Hours</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize: 28 }}>💰</div>
          <div className="stat-number">${totals.spend}</div>
          <div className="stat-label">Total Spend</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize: 28 }}>🤝</div>
          <div className="stat-number">{caregiverStats.length}</div>
          <div className="stat-label">Caregivers Used</div>
        </div>
      </div>

      {/* Monthly trend chart */}
      <div className="card">
        <div className="card-header"><span className="card-icon">📈</span>Monthly Trends</div>
        <div style={{ display: 'flex', gap: '4px', marginBottom: '12px', flexWrap: 'wrap' }}>
          {chartTabs.map(tab => (
            <button key={tab.key}
              onClick={() => setActiveChart(tab.key)}
              style={{
                padding: '6px 14px', borderRadius: '16px', border: 'none', cursor: 'pointer',
                fontSize: '12px', fontWeight: 600,
                background: activeChart === tab.key ? tab.color : '#f0f0f0',
                color: activeChart === tab.key ? '#fff' : '#666',
              }}>
              {tab.label}
            </button>
          ))}
        </div>
        <BarChart data={monthly} dataKey={activeChart} color={activeTab.color} unit={activeTab.unit} label={activeTab.label} />
      </div>

      {/* Service type breakdown */}
      <div className="card">
        <div className="card-header"><span className="card-icon">🥧</span>Service Breakdown</div>
        {serviceBreakdown.length > 0 ? (
          <DonutChart data={serviceBreakdown} />
        ) : (
          <div style={{ color: '#999', padding: '16px', fontSize: '14px' }}>No service data yet</div>
        )}
      </div>

      {/* Caregiver utilization */}
      <div className="card">
        <div className="card-header"><span className="card-icon">👥</span>Caregiver Utilization</div>
        {caregiverStats.length > 0 ? (
          <div>
            {caregiverStats.map((cg, idx) => {
              const maxSessions = Math.max(...caregiverStats.map(c => c.sessions), 1);
              const barPct = Math.round((cg.sessions / maxSessions) * 100);
              return (
                <div key={idx} style={{ marginBottom: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#333' }}>{cg.name}</span>
                    <span style={{ fontSize: '12px', color: '#888' }}>
                      {cg.sessions} sessions &middot; {cg.hours}h
                      {cg.rating > 0 && <> &middot; ⭐ {cg.rating}</>}
                    </span>
                  </div>
                  <div style={{ height: '8px', background: '#f0f0f0', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${barPct}%`, background: '#1b6b5a', borderRadius: '4px', transition: 'width 0.5s ease' }} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ color: '#999', padding: '16px', fontSize: '14px' }}>No caregiver data yet</div>
        )}
      </div>
    </>
  );
};
