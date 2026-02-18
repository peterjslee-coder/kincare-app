const Dashboard = window.Dashboard = ({ onNavigate }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [careTeams, setCareTeams] = useState([]);

  const fetchDashboard = async () => {
    try {
      const res = await apiFetch('/api/dashboard');
      if (res?.ok) {
        const d = await res.json();
        setData(d);
      }
    } catch (err) {
      console.error('Dashboard fetch error:', err);
    }
    setLoading(false);
  };

  const fetchUser = async () => {
    try {
      const res = await apiFetch('/api/auth/me');
      if (res?.ok) { const d = await res.json(); setUser(d.user); }
    } catch {}
  };

  const fetchCareTeams = async () => {
    try {
      const res = await apiFetch('/api/care-teams');
      if (res?.ok) { const d = await res.json(); setCareTeams(d.careTeams || []); }
    } catch {}
  };

  useEffect(() => { fetchDashboard(); fetchUser(); fetchCareTeams(); }, []);

  // Real-time: refresh dashboard on activity or session updates
  useEffect(() => {
    if (typeof onSocketEvent !== 'function') return;
    const c1 = onSocketEvent('activity_update', () => fetchDashboard());
    const c2 = onSocketEvent('session_update', () => fetchDashboard());
    const c3 = onSocketEvent('visit_photos', () => fetchDashboard());
    return () => { c1(); c2(); c3(); };
  }, []);

  const formatActivityTime = (createdAt) => {
    if (!createdAt) return '';
    const dateStr = createdAt.replace(' ', 'T') + 'Z';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  if (loading) return <LoadingSpinner text="Loading dashboard..." />;
  if (!data) return <EmptyState icon="⚠️" title="Couldn't load dashboard" text="Please try refreshing the page." />;

  const stats = data.stats || {};
  const parent = data.parent;
  const upcoming = data.upcomingSessions || [];
  const activity = data.recentActivity || [];
  const isDemo = user?.is_demo || user?.isDemo;
  const firstName = user?.first_name || user?.firstName || 'there';

  // Onboarding checklist for real (non-demo) users
  const hasProfile = user?.phone;
  const hasRecipient = (data.parent || stats.assignedCaregivers > 0);
  const hasCareTeam = careTeams.length > 0 && careTeams.some(t => t.memberCount > 1);
  const onboardingSteps = [
    { id: 'profile', label: 'Complete your profile', done: !!hasProfile, action: () => onNavigate && onNavigate('account'), actionText: 'Go to Profile' },
    { id: 'recipient', label: 'Add a loved one to care for', done: !!hasRecipient, action: () => onNavigate && onNavigate('recipients'), actionText: 'Add Recipient' },
    { id: 'team', label: 'Invite family to the care team', done: hasCareTeam, action: () => onNavigate && onNavigate('care-team'), actionText: 'Manage Team' },
    { id: 'caregiver', label: 'Search for caregivers in your area', done: stats.assignedCaregivers > 0, action: () => onNavigate && onNavigate('caregivers'), actionText: 'Find Caregivers' },
  ];
  const onboardingComplete = onboardingSteps.every(s => s.done);
  const showOnboarding = !isDemo && !onboardingComplete;

  return (
    <>
      <div className="page-header">
        <h1 className="greeting">Welcome back, {firstName}!</h1>
      </div>

      {/* Onboarding Checklist (real users only) */}
      {showOnboarding && (
        <div className="card" style={{ borderLeft: '4px solid #e8724a', marginBottom: 16 }}>
          <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>🚀</span>
            <span>Getting Started</span>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: '#888' }}>
              {onboardingSteps.filter(s => s.done).length} / {onboardingSteps.length} complete
            </span>
          </div>
          <div style={{ display: 'grid', gap: 8, marginTop: 4 }}>
            {onboardingSteps.map((step) => (
              <div key={step.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0',
                opacity: step.done ? 0.6 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 24, height: 24, borderRadius: '50%',
                    background: step.done ? '#1b6b5a' : '#f0f0f0', color: step.done ? '#fff' : '#ccc',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>
                    {step.done ? '✓' : ''}
                  </div>
                  <span style={{ fontSize: 14, fontWeight: step.done ? 400 : 600, textDecoration: step.done ? 'line-through' : 'none', color: step.done ? '#888' : '#333' }}>
                    {step.label}
                  </span>
                </div>
                {!step.done && step.action && (
                  <button onClick={step.action}
                    style={{ padding: '4px 12px', background: '#fff', color: '#1b6b5a', border: '1px solid #1b6b5a', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    {step.actionText}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {parent && (
        <div className="betty-card">
          <div style={{ fontSize: 40 }}>👵</div>
          <div className="betty-name">{parent.name}</div>
          <div className="betty-info">Your mother &bull; Living in {parent.location}</div>
          {parent.healthConditions && parent.healthConditions.length > 0 && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#666' }}>
              {parent.healthConditions.join(' · ')}
            </div>
          )}
        </div>
      )}

      {/* Care Teams Summary (non-demo) */}
      {!isDemo && careTeams.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">Your Care Teams</div>
          {careTeams.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
              onClick={() => onNavigate && onNavigate('care-team')}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{t.name}</div>
                <div style={{ fontSize: 12, color: '#888' }}>
                  {t.memberCount} member{t.memberCount !== 1 ? 's' : ''} · You are {t.my_role}
                </div>
              </div>
              <span style={{ color: '#1b6b5a', fontSize: 14 }}>→</span>
            </div>
          ))}
        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <div style={{ fontSize: 28 }}>📅</div>
          <div className="stat-number">{stats.sessionsThisMonth || 0}</div>
          <div className="stat-label">Sessions This Month</div>
        </div>
        <div className="stat-card" style={{ cursor: 'pointer' }} onClick={() => onNavigate && onNavigate('caregivers')}>
          <div style={{ fontSize: 28 }}>👨‍💼</div>
          <div className="stat-number">{stats.assignedCaregivers || 0}</div>
          <div className="stat-label">Assigned Caregivers</div>
          <div style={{ fontSize: '10px', color: '#1b6b5a', marginTop: '4px' }}>View &rarr;</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize: 28 }}>⭐</div>
          <div className="stat-number">{stats.avgCaregiverRating || '—'}</div>
          <div className="stat-label">Avg Rating</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize: 28 }}>💰</div>
          <div className="stat-number">${stats.monthlySpend || 0}</div>
          <div className="stat-label">Monthly Spend</div>
        </div>
      </div>

      {stats.unreadNotifications > 0 && (
        <div style={{ background: '#fff3e0', border: '1px solid #ffe0b2', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}
          onClick={() => onNavigate && onNavigate('activity')}>
          <span style={{ fontSize: '20px' }}>🔔</span>
          <span style={{ fontSize: '14px', color: '#e65100' }}>{stats.unreadNotifications} unread notification{stats.unreadNotifications > 1 ? 's' : ''}</span>
        </div>
      )}

      <div className="card">
        <div className="card-header"><span className="card-icon">📅</span>Upcoming Sessions</div>
        <ul className="sessions-list">
          {upcoming.length > 0 ? upcoming.map((s, idx) => (
            <li key={idx} className="session-item">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div className="session-time">{s.date} at {s.time}</div>
                  <div className="session-caregiver">{s.caregiverName} — {s.recipientName}</div>
                  <span className="session-type">{s.serviceType}</span>
                </div>
                <div style={{ textAlign: 'right', fontSize: '12px' }}>
                  <div style={{ color: s.status === 'confirmed' ? '#1b6b5a' : '#e8724a', fontWeight: 600, textTransform: 'capitalize' }}>{s.status}</div>
                  {s.estimatedCost && <div style={{ color: '#666', marginTop: '2px' }}>${s.estimatedCost}</div>}
                </div>
              </div>
            </li>
          )) : <li style={{ color: '#999', padding: '16px' }}>No upcoming sessions</li>}
        </ul>
      </div>

      <div className="card">
        <div className="card-header"><span className="card-icon">📢</span>Recent Activity</div>
        <div>
          {activity.length > 0 ? activity.map((a, idx) => (
            <div key={idx} className="activity-item">
              <div className="activity-title">{a.title}</div>
              {a.message && <div style={{ fontSize: '12px', color: '#666', marginTop: '2px' }}>{a.message}</div>}
              <div className="activity-time">{formatActivityTime(a.timestamp)}</div>
            </div>
          )) : <div style={{ color: '#999', padding: '16px' }}>No recent activity</div>}
        </div>
      </div>
    </>
  );
};
