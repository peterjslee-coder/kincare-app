const Dashboard = window.Dashboard = ({ onNavigate }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [careTeams, setCareTeams] = useState([]);
  const [error, setError] = useState(false);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [showPwaGuide, setShowPwaGuide] = useState(false);
  // Dismissible dashboard sections — stores a content fingerprint per tile.
  // Tile stays hidden until the content changes (new data arrives).
  const [dismissedTiles, setDismissedTiles] = useState(() => {
    try { return JSON.parse(localStorage.getItem('dash_dismissed') || '{}'); } catch { return {}; }
  });

  // Dismiss a tile, recording a fingerprint of its current content
  const dismissTile = (tileId, contentFingerprint) => {
    const updated = { ...dismissedTiles, [tileId]: contentFingerprint || 'dismissed' };
    setDismissedTiles(updated);
    localStorage.setItem('dash_dismissed', JSON.stringify(updated));
  };

  // Check if a tile should show: hidden only if fingerprint matches (no new data)
  const isTileDismissed = (tileId, contentFingerprint) => {
    if (!dismissedTiles[tileId]) return false;
    return dismissedTiles[tileId] === (contentFingerprint || 'dismissed');
  };

  const restoreTiles = () => {
    setDismissedTiles({});
    localStorage.removeItem('dash_dismissed');
  };

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

  const fetchAnalytics = async () => {
    try {
      const res = await apiFetch('/api/analytics');
      if (res?.ok) setAnalyticsData(await res.json());
    } catch {}
  };

  useEffect(() => { fetchDashboard(); fetchUser(); fetchCareTeams(); fetchAnalytics(); }, []);

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
    const date = parseTimestamp(createdAt);
    if (!date) return '';
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
  // Profile is "complete" when user has uploaded a photo (phone is collected at signup, so not a good check)
  const hasProfile = !!user?.profile_photo;
  const hasRecipient = (data?.parent || stats.assignedCaregivers > 0);
  const hasCareTeam = careTeams.length > 0;
  // Check if user joined via invite (is a member, not leader, of a care team)
  const isTeamMember = careTeams.some(t => t.my_role === 'member');
  const isTeamLeader = careTeams.some(t => t.my_role === 'leader');
  const onboardingSteps = [
    { id: 'profile', label: 'Complete your profile', done: !!hasProfile, action: () => onNavigate && onNavigate('account'), actionText: 'Go to Profile' },
    // Members who joined via invite already have a care recipient through the team — grey this out
    ...(isTeamMember && !isTeamLeader ? [
      { id: 'recipient', label: 'Add a loved one to care for', done: true, action: null, actionText: null },
    ] : [
      { id: 'recipient', label: 'Add a loved one to care for', done: !!hasRecipient, action: () => onNavigate && onNavigate('recipients'), actionText: 'Add Recipient' },
    ]),
    // Only leaders can invite others to the care team
    ...(isTeamMember && !isTeamLeader ? [] : [
      { id: 'team', label: 'Invite family to the care team', done: hasCareTeam, action: () => onNavigate && onNavigate('care-team'), actionText: 'Manage Team' },
    ]),
    { id: 'caregiver', label: 'Search for caregivers in your area', done: stats.assignedCaregivers > 0, action: () => onNavigate && onNavigate('caregivers'), actionText: 'Find Caregivers' },
    { id: 'pwa', label: 'Install InPlace on your phone', done: !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || !!localStorage.getItem('pwa_setup_done'), action: () => setShowPwaGuide(true), actionText: 'Set Up' },
  ];
  const onboardingComplete = onboardingSteps.every(s => s.done);
  const showOnboarding = !isDemo && !onboardingComplete;

  // ─── PWA Install Guide Modal ───
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);
  const pwaGuide = showPwaGuide && (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={() => setShowPwaGuide(false)}>
      <div style={{ background: '#fff', borderRadius: 16, maxWidth: 420, width: '100%', padding: '28px 24px', maxHeight: '90vh', overflow: 'auto' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Install InPlace</h2>
          <button onClick={() => setShowPwaGuide(false)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#999' }}>&times;</button>
        </div>
        <p style={{ fontSize: 14, color: '#555', lineHeight: 1.6, margin: '0 0 20px' }}>
          Adding InPlace to your home screen gives you push notifications, faster loading, and a full-screen app experience.
        </p>

        {isIOS ? (
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#1b6b5a', marginBottom: 12 }}>On iPhone / iPad (Safari)</div>
            {[
              { num: '1', text: 'Tap the Share button at the bottom of Safari (the square with an arrow pointing up)' },
              { num: '2', text: 'Scroll down and tap "Add to Home Screen"' },
              { num: '3', text: 'Tap "Add" in the top right' },
              { num: '4', text: 'Open InPlace from your home screen — you\'ll get push notifications and a full-screen experience!' },
            ].map(s => (
              <div key={s.num} style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'flex-start' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#1b6b5a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{s.num}</div>
                <div style={{ fontSize: 14, color: '#444', lineHeight: 1.5, paddingTop: 3 }}>{s.text}</div>
              </div>
            ))}
            <div style={{ background: '#fff8e1', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#795548', marginTop: 8 }}>
              <strong>Important:</strong> You must use Safari for this to work. Chrome on iPhone does not support home screen apps.
            </div>
          </div>
        ) : isAndroid ? (
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#1b6b5a', marginBottom: 12 }}>On Android (Chrome)</div>
            {[
              { num: '1', text: 'Tap the three-dot menu in the top right of Chrome' },
              { num: '2', text: 'Tap "Add to Home screen" or "Install app"' },
              { num: '3', text: 'Tap "Install" to confirm' },
              { num: '4', text: 'Open InPlace from your home screen — push notifications will work automatically!' },
            ].map(s => (
              <div key={s.num} style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'flex-start' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#1b6b5a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{s.num}</div>
                <div style={{ fontSize: 14, color: '#444', lineHeight: 1.5, paddingTop: 3 }}>{s.text}</div>
              </div>
            ))}
          </div>
        ) : (
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#1b6b5a', marginBottom: 12 }}>On your phone's browser</div>
            <p style={{ fontSize: 14, color: '#444', lineHeight: 1.6 }}>
              Open <strong>yourinplace.com</strong> in your phone's browser, then use the browser menu to "Add to Home Screen" or "Install App". This gives you push notifications and a full-screen experience.
            </p>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button onClick={() => { localStorage.setItem('pwa_setup_done', '1'); setShowPwaGuide(false); }}
            style={{ flex: 1, padding: '12px 16px', background: '#1b6b5a', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
            Done — I've installed it!
          </button>
          <button onClick={() => setShowPwaGuide(false)}
            style={{ padding: '12px 16px', background: '#f5f5f5', color: '#666', border: 'none', borderRadius: 10, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            Later
          </button>
        </div>
      </div>
    </div>
  );

  // ─── Welcome screen for brand new users ───
  if (isNewUser) {
    return (
      <>
        {pwaGuide}
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
              { icon: '🌷', title: 'Add your loved one', desc: 'Create a care profile with health details, medications, and preferences so caregivers know exactly what\'s needed.' },
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
      {pwaGuide}
      {/* Push notification prompt — shows if not yet enabled */}
      {typeof NotificationPrompt !== 'undefined' && React.createElement(NotificationPrompt, null)}
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

        const latestFingerprint = `${upcomingCount}-${unreadCount}-${stats.assignedCaregivers}`;
        if (isTileDismissed('latest', latestFingerprint)) return null;

        return (
          <div className="card" style={{ marginBottom: 16, borderLeft: `4px solid ${borderColor}`, display: 'flex', alignItems: 'center', gap: 12, position: 'relative' }}>
            <span style={{ fontSize: 24 }}>{statusIcon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#333' }}>Latest</div>
              <div style={{ fontSize: 13, color: '#555', marginTop: 2 }}>{statusText}</div>
            </div>
            <button onClick={() => dismissTile('latest', latestFingerprint)} title="Hide until there's something new" style={{
              background: '#f0f0f0', border: 'none', cursor: 'pointer', fontSize: 13,
              color: '#999', padding: '4px 10px', borderRadius: 6, fontWeight: 600,
            }}>✕</button>
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
        <div className="betty-card" onClick={() => onNavigate && onNavigate('care-profile')}
          style={{ cursor: 'pointer', position: 'relative' }}>
          <div style={{ fontSize: 40 }}>🌷</div>
          <div className="betty-name">{parent.name}</div>
          <div className="betty-info">
            {(() => {
              const myLabel = careTeams.find(t => t.my_relationship_label)?.my_relationship_label;
              return myLabel ? `Your ${myLabel.toLowerCase()} · ` : '';
            })()}
            Living in {parent.location}
          </div>
          {parent.healthConditions && parent.healthConditions.length > 0 && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#666' }}>
              {parent.healthConditions.join(' · ')}
            </div>
          )}
          <div style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', color: '#1b6b5a', fontSize: 18 }}>→</div>
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

      {!isTileDismissed('upcoming', `${upcoming.length}-${upcoming.map(s=>s.id).join(',')}`) && (
        <div className="card" style={{ position: 'relative' }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><span className="card-icon">📅</span>Upcoming Sessions</span>
            <button onClick={() => dismissTile('upcoming', `${upcoming.length}-${upcoming.map(s=>s.id).join(',')}`)} title="Hide until there's something new" style={{
              background: '#f0f0f0', border: 'none', cursor: 'pointer', fontSize: 13,
              color: '#999', padding: '4px 10px', borderRadius: 6, fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 4,
            }}>✕ Hide</button>
          </div>
          <ul className="sessions-list">
            {upcoming.length > 0 ? upcoming.map((s, idx) => (
              <li key={idx} className="session-item">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15, color: '#1a1a2e' }}>
                      {s.recipientName}{s.familyTotal ? `, $${Math.round(parseFloat(s.familyTotal))}` : s.estimatedCost ? `, $${Math.round(parseFloat(s.estimatedCost))}` : ''}
                    </div>
                    <div className="session-time">{s.date} at {s.time}</div>
                    <div style={{ fontSize: 12, color: '#666' }}>{s.caregiverName} · <span style={{ textTransform: 'capitalize' }}>{(s.serviceType || '').replace(/_/g, ' ')}</span></div>
                    {s.caregiverPayout && s.platformFee > 0 && (
                      <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                        Caregiver receives ${parseFloat(s.caregiverPayout).toFixed(0)} · Platform fee ${parseFloat(s.platformFee).toFixed(0)}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', fontSize: '12px' }}>
                    <div style={{ color: s.status === 'confirmed' ? '#1b6b5a' : '#e8724a', fontWeight: 600, textTransform: 'capitalize' }}>{s.status}</div>
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
      )}

      {!isTileDismissed('activity', `${activity.length}-${activity.map(a=>a.id).join(',')}`) && (
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><span className="card-icon">📢</span>Recent Activity</span>
            <button onClick={() => dismissTile('activity', `${activity.length}-${activity.map(a=>a.id).join(',')}`)} title="Hide until there's something new" style={{
              background: '#f0f0f0', border: 'none', cursor: 'pointer', fontSize: 13,
              color: '#999', padding: '4px 10px', borderRadius: 6, fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 4,
            }}>✕ Hide</button>
          </div>
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
      )}

      {/* Restore dismissed tiles */}
      {Object.keys(dismissedTiles).length > 0 && (
        <div style={{ textAlign: 'center', marginTop: 12, marginBottom: 12 }}>
          <button onClick={restoreTiles} style={{
            background: '#f5f5f5', border: '1px solid #e0e0e0', color: '#666', fontSize: 13,
            cursor: 'pointer', padding: '8px 20px', borderRadius: 8, fontWeight: 600,
          }}>
            ↩ Restore hidden sections
          </button>
        </div>
      )}

      {/* Inline Analytics (collapsible) */}
      {analyticsData && (() => {
        const totals = analyticsData.totals || {};
        const cgStats = analyticsData.caregiverStats || [];
        const serviceBreakdown = analyticsData.serviceBreakdown || [];
        const serviceLabels = { meals: 'Meals', rides: 'Rides', companion: 'Companion', companionship: 'Companion', personal_care: 'Personal Care', meal_prep: 'Meal Prep', transportation: 'Transport', health_wellness: 'Health', full_day: 'Full Day' };
        return (
          <div className="card" style={{ marginTop: 0 }}>
            <div className="card-header" onClick={() => setAnalyticsOpen(!analyticsOpen)}
              style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span><span className="card-icon">📊</span>Care Analytics</span>
              <span style={{ fontSize: 12, color: '#999', transition: 'transform 0.2s', display: 'inline-block', transform: analyticsOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
            </div>
            {!analyticsOpen ? (
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: '#666', marginTop: 8 }}>
                <span><strong>{totals.sessions}</strong> sessions</span>
                <span><strong>{totals.hours}</strong> hours</span>
                <span><strong>${totals.spend}</strong> spent</span>
                <span><strong>{cgStats.length}</strong> caregivers</span>
              </div>
            ) : (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 16 }}>
                  {[
                    { icon: '📅', val: totals.sessions, label: 'Total Sessions' },
                    { icon: '⏱️', val: totals.hours, label: 'Total Hours' },
                    { icon: '💰', val: `$${totals.spend}`, label: 'Total Spend' },
                    { icon: '🤝', val: cgStats.length, label: 'Caregivers' },
                  ].map((s, i) => (
                    <div key={i} style={{ background: '#f9fafb', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                      <div style={{ fontSize: 18 }}>{s.icon}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#1b6b5a' }}>{s.val}</div>
                      <div style={{ fontSize: 11, color: '#888' }}>{s.label}</div>
                    </div>
                  ))}
                </div>
                {/* Service breakdown */}
                {serviceBreakdown.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#333', marginBottom: 6 }}>Service Breakdown</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {serviceBreakdown.map((s, i) => (
                        <span key={i} style={{ padding: '4px 10px', borderRadius: 12, background: '#f0faf7', color: '#1b6b5a', fontSize: 12, fontWeight: 500 }}>
                          {serviceLabels[s.serviceType] || s.serviceType}: {s.count}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {/* Caregiver utilization */}
                {cgStats.length > 0 && (
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#333', marginBottom: 6 }}>Caregiver Utilization</div>
                    {cgStats.map((cg, i) => {
                      const maxS = Math.max(...cgStats.map(c => c.sessions), 1);
                      return (
                        <div key={i} style={{ marginBottom: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
                            <span style={{ fontWeight: 600 }}>{cg.name}</span>
                            <span style={{ color: '#888' }}>{cg.sessions} sessions · {cg.hours}h{cg.rating > 0 ? ` · ⭐ ${cg.rating}` : ''}</span>
                          </div>
                          <div style={{ height: 6, background: '#f0f0f0', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${Math.round(cg.sessions / maxS * 100)}%`, background: '#1b6b5a', borderRadius: 3 }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}
    </>
  );
};
