const Dashboard = window.Dashboard = ({ onNavigate }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [careTeams, setCareTeams] = useState([]);
  const [error, setError] = useState(false);

  const fetchDashboard = async () => {
    try {
      const res = await apiFetch('/api/dashboard');
      if (res?.ok) {
        const d = await res.json();
        setData(d);
      } else {
        setError(true);
      }
    } catch (err) {
      console.error('Dashboard fetch error:', err);
      setError(true);
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
    // PostgreSQL timestamps may have timezone offset (+00, +00:00) or not
    let dateStr = createdAt;
    if (!dateStr.includes('T')) {
      dateStr = dateStr.replace(' ', 'T');
    }
    // Only append Z if there's no timezone indicator already
    if (!/[Zz]$/.test(dateStr) && !/[+-]\d{2}(:\d{2})?$/.test(dateStr)) {
      dateStr += 'Z';
    }
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';
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

  // Error state — API actually failed
  if (error && !data) return (
    <div style={{ padding: '40px 20px', textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>😟</div>
      <h2 style={{ margin: '0 0 8px', color: '#333' }}>Something went wrong</h2>
      <p style={{ color: '#666', fontSize: 14, marginBottom: 20 }}>We couldn't load your dashboard. This might be a temporary issue.</p>
      <button onClick={() => { setError(false); setLoading(true); fetchDashboard(); }}
        style={{ padding: '10px 24px', background: '#1b6b5a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
        Try Again
      </button>
    </div>
  );

  const stats = data?.stats || {};
  const parent = data?.parent;
  const upcoming = data?.upcomingSessions || [];
  const activity = data?.recentActivity || [];
  const isDemo = user?.is_demo || user?.isDemo;
  const firstName = user?.first_name || user?.firstName || 'there';
  const isNewUser = data?.isNewUser && !isDemo;

  // Onboarding checklist for real (non-demo) users
  const hasProfile = user?.phone;
  const hasRecipient = (data?.parent || stats.assignedCaregivers > 0);
  const hasCareTeam = careTeams.length > 0 && careTeams.some(t => t.memberCount > 1);
  const onboardingSteps = [
    { id: 'profile', label: 'Complete your profile', done: !!hasProfile, action: () => onNavigate && onNavigate('account'), actionText: 'Go to Profile' },
    { id: 'recipient', label: 'Add a loved one to care for', done: !!hasRecipient, action: () => onNavigate && onNavigate('recipients'), actionText: 'Add Recipient' },
    { id: 'team', label: 'Invite family to the care team', done: hasCareTeam, action: () => onNavigate && onNavigate('care-team'), actionText: 'Manage Team' },
    { id: 'caregiver', label: 'Search for caregivers in your area', done: stats.assignedCaregivers > 0, action: () => onNavigate && onNavigate('caregivers'), actionText: 'Find Caregivers' },
  ];
  const onboardingComplete = onboardingSteps.every(s => s.done);
  const showOnboarding = !isDemo && !onboardingComplete;

  // ─── Welcome screen for brand new users ───
  if (isNewUser) {
    return (
      <>
        {/* Welcome Hero */}
        <div style={{ background: 'linear-gradient(135deg, #1b6b5a 0%, #2a9d8f 100%)', borderRadius: 16, padding: '40px 32px', color: '#fff', marginBottom: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>👋</div>
          <h1 style={{ margin: '0 0 8px', fontSize: 28, fontWeight: 700 }}>Welcome to InPlace, {firstName}!</h1>
          <p style={{ margin: 0, fontSize: 16, opacity: 0.9, maxWidth: 480, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.5 }}>
            You're taking a great step in coordinating care for someone you love. Let's get you set up in just a few minutes.
          </p>
        </div>

        {/* How It Works */}
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header" style={{ fontSize: 16, fontWeight: 700 }}>How InPlace Works</div>
          <div style={{ display: 'grid', gap: 20, marginTop: 8 }}>
            {[
              { icon: '👵', title: 'Add your loved one', desc: 'Create a care profile with health details, medications, and preferences so caregivers know exactly what\'s needed.' },
              { icon: '👨‍👩‍👦', title: 'Build your care team', desc: 'Invite siblings, family members, or friends to help coordinate care. Everyone stays on the same page.' },
              { icon: '🔍', title: 'Find caregivers', desc: 'Search for qualified, background-checked caregivers in your area who match your needs.' },
              { icon: '📅', title: 'Schedule & track', desc: 'Book care sessions, get real-time updates, photos, and visit summaries. Never wonder how things went.' },
            ].map((step, i) => (
              <div key={i} style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, background: '#f0faf7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>
                  {step.icon}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15, color: '#333', marginBottom: 2 }}>{step.title}</div>
                  <div style={{ fontSize: 13, color: '#666', lineHeight: 1.5 }}>{step.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Getting Started Checklist */}
        <div className="card" style={{ borderLeft: '4px solid #e8724a', marginBottom: 24 }}>
          <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>🚀</span>
            <span style={{ fontWeight: 700 }}>Getting Started</span>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: '#888' }}>
              {onboardingSteps.filter(s => s.done).length} / {onboardingSteps.length} complete
            </span>
          </div>
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            {onboardingSteps.map((step, idx) => (
              <div key={step.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0',
                borderBottom: idx < onboardingSteps.length - 1 ? '1px solid #f5f5f5' : 'none',
                opacity: step.done ? 0.6 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%',
                    background: step.done ? '#1b6b5a' : (idx === onboardingSteps.findIndex(s => !s.done) ? '#e8724a' : '#f0f0f0'),
                    color: (step.done || idx === onboardingSteps.findIndex(s => !s.done)) ? '#fff' : '#ccc',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>
                    {step.done ? '✓' : (idx + 1)}
                  </div>
                  <span style={{ fontSize: 14, fontWeight: step.done ? 400 : 600, textDecoration: step.done ? 'line-through' : 'none', color: step.done ? '#888' : '#333' }}>
                    {step.label}
                  </span>
                </div>
                {!step.done && idx === onboardingSteps.findIndex(s => !s.done) && step.action && (
                  <button onClick={step.action}
                    style={{ padding: '6px 16px', background: '#1b6b5a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    {step.actionText}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Quick Tip */}
        <div style={{ background: '#f0faf7', border: '1px solid #d0ede6', borderRadius: 12, padding: '16px 20px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 20, flexShrink: 0 }}>💡</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#1b6b5a', marginBottom: 2 }}>Quick tip</div>
            <div style={{ fontSize: 13, color: '#555', lineHeight: 1.5 }}>
              Start by adding your loved one's profile — it takes about 2 minutes. You can always update their health information, preferences, and emergency contacts later.
            </div>
          </div>
        </div>
      </>
    );
  }

  // ─── Regular dashboard for users with data ───
  return (
    <>
      <div className="page-header">
        <h1 className="greeting">Welcome back, {firstName}!</h1>
      </div>

      {/* Latest Status */}
      {!isNewUser && (() => {
        const upcomingCount = upcoming.length;
        const unreadCount = stats.unreadNotifications || 0;
        let statusIcon = '📋';
        let statusText = "Everything's on track. No upcoming sessions scheduled.";
        let borderColor = '#1b6b5a';

        if (upcomingCount > 0) {
          statusIcon = '📅';
          statusText = `You have ${upcomingCount} upcoming session${upcomingCount > 1 ? 's' : ''} this week.`;
          if (unreadCount > 0) statusText += ` ${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}.`;
        } else if (stats.assignedCaregivers === 0 && !parent) {
          statusIcon = '🔍';
          statusText = 'Get started by adding a loved one and finding caregivers in your area.';
          borderColor = '#e8724a';
        }

        return (
          <div className="card" style={{ marginBottom: 16, borderLeft: `4px solid ${borderColor}`, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 24 }}>{statusIcon}</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#333' }}>Latest</div>
              <div style={{ fontSize: 13, color: '#555', marginTop: 2 }}>{statusText}</div>
            </div>
          </div>
        );
      })()}

      {/* Onboarding Checklist (real users with some progress but not complete) */}
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
                  {s.status === 'confirmed' && s.estimatedCost && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          const res = await apiFetch('/api/payments/checkout', {
                            method: 'POST',
                            body: JSON.stringify({ sessionId: s.id }),
                          });
                          if (res?.ok) {
                            const d = await res.json();
                            if (d.checkoutUrl) window.location.href = d.checkoutUrl;
                          } else {
                            const err = await res?.json();
                            alert(err?.error || 'Payment not available yet');
                          }
                        } catch (err) { alert('Payment service unavailable'); }
                      }}
                      style={{
                        marginTop: '6px', padding: '4px 12px', borderRadius: '6px',
                        border: 'none', background: '#1b6b5a', color: '#fff',
                        fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                      }}
                    >Pay Now</button>
                  )}
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
