const Dashboard = window.Dashboard = ({ onNavigate }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [careTeams, setCareTeams] = useState([]);
  const [error, setError] = useState(false);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [showPwaGuide, setShowPwaGuide] = useState(false);
  // Cancel + review state
  const [cancellingId, setCancellingId] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelLoading, setCancelLoading] = useState(false);
  const [reviewSession, setReviewSession] = useState(null); // session that can be reviewed after late cancel
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewLoading, setReviewLoading] = useState(false);
  const [visitDetailSessionId, setVisitDetailSessionId] = useState(null);
  const [awaitingExpanded, setAwaitingExpanded] = useState(false);
  const [finishedExpanded, setFinishedExpanded] = useState(false);
  // Tick counter for live countdown on in-progress sessions (re-renders every 30s)
  const [tick, setTick] = useState(0);

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

  const handleCancel = async (sessionId) => {
    setCancelLoading(true);
    try {
      const res = await apiFetch(`/api/sessions/${sessionId}/cancel`, {
        method: 'PUT',
        body: JSON.stringify({ reason: cancelReason || 'Cancelled by family' }),
      });
      if (res?.ok) {
        const d = await res.json();
        setCancellingId(null);
        setCancelReason('');
        fetchDashboard();
        // If caregiver late-cancelled, prompt for review (won't happen for family cancel, but check anyway)
        if (d.canReview) {
          setReviewSession(d.session);
        }
      } else {
        const err = await res?.json().catch(() => ({}));
        alert(err?.error || 'Failed to cancel session');
      }
    } catch { alert('Failed to cancel session'); }
    setCancelLoading(false);
  };

  const handleReview = async () => {
    if (!reviewRating) return;
    setReviewLoading(true);
    try {
      const res = await apiFetch(`/api/sessions/${reviewSession.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ rating: reviewRating, comment: reviewComment }),
      });
      if (res?.ok) {
        setReviewSession(null);
        setReviewRating(0);
        setReviewComment('');
        if (typeof showToast === 'function') showToast('Review submitted! Thank you.', 'success');
        fetchDashboard();
      } else {
        const err = await res?.json().catch(() => ({}));
        alert(err?.error || 'Failed to submit review');
      }
    } catch { alert('Failed to submit review'); }
    setReviewLoading(false);
  };

  useEffect(() => {
    fetchDashboard(); fetchUser(); fetchCareTeams(); fetchAnalytics();
    // Re-fetch when a new session is created (e.g. from RequestCareModal)
    const onSessionsUpdated = () => fetchDashboard();
    window.addEventListener('sessions-updated', onSessionsUpdated);
    return () => window.removeEventListener('sessions-updated', onSessionsUpdated);
  }, []);

  // Real-time: refresh dashboard on activity or session updates
  useEffect(() => {
    if (typeof onSocketEvent !== 'function') return;
    const c1 = onSocketEvent('activity_update', () => fetchDashboard());
    const c2 = onSocketEvent('session_update', () => fetchDashboard());
    const c3 = onSocketEvent('visit_photos', () => fetchDashboard());
    return () => { c1(); c2(); c3(); };
  }, []);

  // Tick every 30s so in-progress countdowns stay live
  useEffect(() => {
    const hasActive = data?.upcomingSessions?.some(s => s.status === 'in_progress');
    if (!hasActive) return;
    const iv = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(iv);
  }, [data?.upcomingSessions]);

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
            <span style={{ marginLeft: 'auto', fontSize: 12, color: '#888', display: 'flex', alignItems: 'center', gap: 8 }}>
              {onboardingSteps.filter(s => s.done).length} / {onboardingSteps.length} complete
              <button onClick={(e) => { e.stopPropagation(); dismissTile('onboarding', 'v1'); }} title="Dismiss checklist" style={{
                background: '#f0f0f0', border: 'none', cursor: 'pointer', fontSize: 13,
                color: '#999', padding: '2px 8px', borderRadius: 6, fontWeight: 600,
              }}>✕</button>
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
        <h1 className="greeting">{isNewUser ? `Welcome, ${firstName}!` : `Welcome back, ${firstName}!`}</h1>
      </div>

      {/* New User Welcome — prominent CTA to add care recipient */}
      {isNewUser && (
        <div className="card" style={{ textAlign: 'center', padding: '32px 24px', marginBottom: 20, borderLeft: '4px solid #e8724a' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🏠</div>
          <h3 style={{ margin: '0 0 8px', color: '#1a1a2e', fontSize: 18 }}>Let's get started</h3>
          <p style={{ color: '#666', fontSize: 14, maxWidth: 400, margin: '0 auto 20px', lineHeight: 1.5 }}>
            Add the person you're coordinating care for. This is how you'll manage their schedule, find caregivers, and track everything in one place.
          </p>
          <button className="btn btn-primary" onClick={() => onNavigate && onNavigate('recipients')}
            style={{ padding: '14px 36px', fontSize: 16, fontWeight: 700 }}>
            + Add Your Loved One
          </button>
        </div>
      )}

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

        const latestClickTarget = upcomingCount > 0 ? 'schedule' : (unreadCount > 0 ? 'activity' : (stats.assignedCaregivers === 0 ? 'caregivers' : 'schedule'));
        return (
          <div className="card" style={{ marginBottom: 16, borderLeft: `4px solid ${borderColor}`, display: 'flex', alignItems: 'center', gap: 12, position: 'relative', cursor: 'pointer' }}
            onClick={() => onNavigate && onNavigate(latestClickTarget)}>
            <span style={{ fontSize: 24 }}>{statusIcon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#333' }}>Latest</div>
              <div style={{ fontSize: 13, color: '#555', marginTop: 2 }}>{statusText}</div>
            </div>
            <button onClick={(e) => { e.stopPropagation(); dismissTile('latest', latestFingerprint); }} title="Hide until there's something new" style={{
              background: '#f0f0f0', border: 'none', cursor: 'pointer', fontSize: 13,
              color: '#999', padding: '4px 10px', borderRadius: 6, fontWeight: 600,
            }}>✕</button>
          </div>
        );
      })()}

      {/* Onboarding Checklist (real users with some progress but not complete) */}
      {showOnboarding && !isTileDismissed('onboarding', 'v1') && (
        <div className="card" style={{ borderLeft: '4px solid #e8724a', marginBottom: 16 }}>
          <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>🚀</span>
            <span>Getting Started</span>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: '#888', display: 'flex', alignItems: 'center', gap: 8 }}>
              {onboardingSteps.filter(s => s.done).length} / {onboardingSteps.length} complete
              <button onClick={() => dismissTile('onboarding', 'v1')} title="Dismiss checklist" style={{
                background: '#f0f0f0', border: 'none', cursor: 'pointer', fontSize: 13,
                color: '#999', padding: '2px 8px', borderRadius: 6, fontWeight: 600,
              }}>✕</button>
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
        <div className="betty-card" style={{ cursor: 'pointer', position: 'relative' }}>
          <div onClick={() => onNavigate && onNavigate('care-profile')}>
            {parent.photo
              ? <div style={{ width: 56, height: 56, borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}><img src={parent.photo} alt={parent.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>
              : <div style={{ fontSize: 40 }}>{parent.emoji || '🌷'}</div>}
            <div className="betty-name">{parent.name}</div>
            <div className="betty-info">
              {(() => {
                const myLabel = careTeams.find(t => t.my_relationship_label)?.my_relationship_label;
                return myLabel ? `${myLabel} · ` : '';
              })()}
              Living in {parent.location}
            </div>
            {parent.healthConditions && parent.healthConditions.length > 0 && (
              <div style={{ marginTop: '8px', fontSize: '12px', color: 'rgba(255,255,255,0.75)' }}>
                {parent.healthConditions.join(' · ')}
              </div>
            )}
            <div style={{ position: 'absolute', right: 16, top: 24, color: 'rgba(255,255,255,0.5)', fontSize: 18 }}>→</div>
          </div>
          {/* Care team nested inside Betty card */}
          {!isDemo && careTeams.length > 0 && (() => {
            const team = careTeams[0];
            const members = team.members || [];
            const pendingCount = team.pendingInvites || 0;
            const shown = members.slice(0, 4);
            const overflow = (members.length + pendingCount) - shown.length - pendingCount;
            const colors = ['#e8724a', '#4a90d9', '#7b61ff', '#2ecc71'];
            return (
            <div onClick={(e) => { e.stopPropagation(); onNavigate && onNavigate('care-team'); }}
              style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex' }}>
                  {shown.map((m, i) => {
                    const initials = `${(m.firstName || '')[0] || ''}${(m.lastName || '')[0] || ''}`.toUpperCase();
                    return m.avatarUrl ? (
                      <img key={i} src={m.avatarUrl} alt={initials} style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid #0f4238', marginLeft: i > 0 ? -8 : 0, objectFit: 'cover', zIndex: shown.length - i }} />
                    ) : (
                      <div key={i} style={{ width: 28, height: 28, borderRadius: '50%', background: colors[i % colors.length], border: '2px solid #0f4238', marginLeft: i > 0 ? -8 : 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fff', fontWeight: 600, zIndex: shown.length - i }}>
                        {initials}
                      </div>
                    );
                  })}
                  {pendingCount > 0 && Array.from({ length: Math.min(pendingCount, 2) }).map((_, i) => (
                    <div key={'p' + i} style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', border: '2px solid #0f4238', marginLeft: -8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'rgba(255,255,255,0.5)', fontWeight: 600, zIndex: 0 }}>
                      ?
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>{team.name || 'Care Team'}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>{team.memberCount || 0} member{(team.memberCount || 0) !== 1 ? 's' : ''}{pendingCount > 0 ? ` · ${pendingCount} pending` : ''}</div>
                </div>
              </div>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>→</span>
            </div>
            );
          })()}
        </div>
      )}

      {/* Just Finished — recently completed sessions (faded, expandable) */}
      {(() => {
        const completed = data?.recentlyCompleted || [];
        if (completed.length === 0) return null;
        const showAll = finishedExpanded || completed.length <= 2;
        const visible = showAll ? completed.slice(0, 5) : completed.slice(0, 2);
        return (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
              Just Finished ({completed.length})
            </div>
            <div style={{ position: 'relative' }}>
              {visible.map((s, idx) => {
                const svcLabel = (s.serviceType || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                const fadeOpacity = idx === 0 ? 0.7 : idx === 1 ? 0.4 : 0.25;
                return (
                  <div key={s.id || idx} onClick={() => setVisitDetailSessionId(s.id)}
                    style={{
                      marginBottom: 8, padding: '12px 16px', cursor: 'pointer', borderRadius: 12,
                      border: '2px solid #c8e6c9', background: '#f1f8f3',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                      opacity: fadeOpacity, transition: 'opacity 0.3s',
                    }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 15, color: '#333' }}>
                          {s.recipientName || 'Care Visit'}
                          {s.caregiverName ? ` with ${s.caregiverName}` : ''}
                        </div>
                        <div style={{ fontSize: 13, color: '#666', marginTop: 2 }}>
                          {s.date} · {svcLabel} · {s.durationHours || 2}h
                        </div>
                        {s.visitSummary && (
                          <div style={{ fontSize: 13, color: '#555', marginTop: 4, fontStyle: 'italic' }}>
                            "{s.visitSummary.length > 80 ? s.visitSummary.slice(0, 80) + '...' : s.visitSummary}"
                          </div>
                        )}
                        {s.conditionTags && s.conditionTags.length > 0 && (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                            {s.conditionTags.map((tag, i) => (
                              <span key={i} style={{ background: '#e8f5e9', color: '#2e7d32', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500 }}>{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                        {s.hasReview ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            {[1,2,3,4,5].map(star => (
                              <span key={star} style={{ fontSize: 14, color: star <= (s.reviewRating || 0) ? '#f59e0b' : '#d0d0d0' }}>{'\u2605'}</span>
                            ))}
                          </div>
                        ) : s.caregiverId ? (
                          <button onClick={(e) => { e.stopPropagation(); setReviewSession(s); setReviewRating(0); setReviewComment(''); }}
                            style={{ padding: '6px 14px', borderRadius: 10, border: 'none', background: '#1b6b5a', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            {'\u2605'} Leave Review
                          </button>
                        ) : (
                          <span style={{ padding: '4px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: '#e8f5e9', color: '#2e7d32' }}>Completed</span>
                        )}
                        <span style={{ fontSize: 12, color: '#1b6b5a', fontWeight: 600 }}>View Details {'\u2192'}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
              {!showAll && (
                <div onClick={() => setFinishedExpanded(true)} style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0, height: 64, cursor: 'pointer',
                  background: 'linear-gradient(transparent 0%, rgba(255,255,255,0.85) 40%, #fff 100%)',
                  display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 4,
                }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#888' }}>
                    + {completed.length - 2} more &mdash; tap to expand
                  </span>
                </div>
              )}
              {showAll && completed.length > 2 && (
                <div onClick={() => setFinishedExpanded(false)} style={{
                  textAlign: 'center', padding: '4px 0', cursor: 'pointer',
                }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#888' }}>Show less</span>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Next Up — sessions within 48 hours, or the next 1 session if nothing soon */}
      {(() => {
        const tz = upcoming[0]?.timezone || TimezoneHelper.DEFAULT_TZ;
        const now = TimezoneHelper.getNow(tz);
        const todayStr = TimezoneHelper.getToday(tz);
        const todayLocal = TimezoneHelper.parseDate(todayStr);
        const cutoff48h = new Date(now.getTime() + 48 * 3600000);

        // Sort all upcoming by date+time — exclude unclaimed open requests (shown separately below)
        const confirmed = upcoming.filter(s => !((['open', 'requested'].includes(s.status)) && !s.caregiverName));
        const sorted = [...confirmed].sort((a, b) => {
          const ak = ((a.date || '').split('T')[0]) + (a.time || '');
          const bk = ((b.date || '').split('T')[0]) + (b.time || '');
          return ak.localeCompare(bk);
        });

        // Sessions within 48 hours
        const within48 = sorted.filter(s => {
          const sDate = (s.date || '').split('T')[0];
          const sessionDT = TimezoneHelper.buildDateTime(sDate, s.time || '00:00', tz);
          return sessionDT <= cutoff48h;
        });

        // If nothing within 48h, show the next 1 session
        const nextUp = within48.length > 0 ? within48 : sorted.slice(0, 1);

        if (nextUp.length === 0) return (
          <div style={{ marginBottom: 16, border: '2px solid #e0e0e0', borderRadius: 14, padding: '20px 18px', textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Next Up</div>
            <div style={{ fontSize: 14, color: '#888' }}>No sessions scheduled</div>
            <button onClick={() => { if (window.__openRequestCareModal) window.__openRequestCareModal(); }} style={{
              marginTop: 10, padding: '8px 20px', background: '#e8724a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}>+ Request Care</button>
          </div>
        );

        return (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Next Up
              </div>
              <button onClick={() => { if (window.__openRequestCareModal) window.__openRequestCareModal(); }} style={{
                padding: '4px 12px', background: '#e8724a', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
              }}>+ Request Care</button>
            </div>
            {nextUp.map((s, idx) => {
              const dayLabel = TimezoneHelper.getDateLabel((s.date || '').split('T')[0], tz);
              const timeLabel = TimezoneHelper.formatTime(s.time);
              const isActive = s.status === 'in_progress';

              // Remaining time for in-progress sessions
              let remainingLabel = null;
              if (isActive && s.durationHours) {
                const tz = s.timezone || TimezoneHelper.DEFAULT_TZ;
                // Use check-in time if available, otherwise scheduled start
                let startMs;
                if (s.checkInTime) {
                  startMs = new Date(s.checkInTime).getTime();
                } else {
                  const sDate = (s.date || '').split('T')[0];
                  startMs = TimezoneHelper.buildDateTime(sDate, s.time || '00:00', tz).getTime();
                }
                const endMs = startMs + (s.durationHours * 3600000);
                const leftMs = endMs - Date.now();
                if (leftMs > 0) {
                  const leftMins = Math.ceil(leftMs / 60000);
                  const hrs = Math.floor(leftMins / 60);
                  const mins = leftMins % 60;
                  remainingLabel = hrs > 0 ? `${hrs}:${String(mins).padStart(2, '0')} remaining` : `${mins} min remaining`;
                } else {
                  remainingLabel = 'Expected end time passed';
                }
              }

              // Urgency: how soon is this session?
              const sDate = (s.date || '').split('T')[0];
              const sessionDT = TimezoneHelper.buildDateTime(sDate, s.time || '00:00', tz);
              const minsUntil = (sessionDT - now) / 60000;
              const isImminent = !isActive && s.status === 'confirmed' && minsUntil <= 60 && minsUntil > -120; // within 1 hour or started <2hr ago
              const isSoon = !isActive && !isImminent && s.status === 'confirmed' && minsUntil <= 180; // within 3 hours
              const isSeekingCaregiver = !s.caregiverName;

              // Border & background based on urgency
              const borderColor = isActive ? '#f57f17' : isImminent ? '#e8724a' : isSoon ? '#e8724a' : isSeekingCaregiver ? '#e8724a' : '#1b6b5a';
              const bgColor = isActive ? 'linear-gradient(135deg, #fffde7 0%, #fff 100%)' : isImminent ? 'linear-gradient(135deg, #fff3e0 0%, #fff 100%)' : '#fff';
              const borderWidth = isActive || isImminent ? 3 : 2;

              return (
                <div key={s.id || idx} onClick={() => {
                  if (s.id) setVisitDetailSessionId(s.id);
                }} style={{
                  marginBottom: 8, padding: '14px 16px', cursor: 'pointer', borderRadius: 12,
                  border: `${borderWidth}px solid ${borderColor}`,
                  background: bgColor,
                  boxShadow: isImminent ? '0 2px 12px rgba(232, 114, 74, 0.15)' : isActive ? '0 2px 12px rgba(245, 127, 23, 0.15)' : '0 1px 4px rgba(0,0,0,0.06)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      {isActive && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#f57f17', textTransform: 'uppercase', letterSpacing: '0.5px' }}>In Progress Now</span>
                          {remainingLabel && (
                            <span style={{
                              fontSize: 11, fontWeight: 600,
                              color: remainingLabel.includes('passed') ? '#c62828' : '#1b6b5a',
                              background: remainingLabel.includes('passed') ? '#ffebee' : '#e8f5e9',
                              padding: '2px 8px', borderRadius: 10,
                            }}>{remainingLabel}</span>
                          )}
                        </div>
                      )}
                      {isImminent && !isActive && <div style={{ fontSize: 11, fontWeight: 700, color: '#e8724a', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>{minsUntil <= 0 ? 'Started — awaiting check-in' : minsUntil <= 15 ? 'Check-in window open' : `Starting in ${Math.ceil(minsUntil)} min`}</div>}
                      {isSoon && <div style={{ fontSize: 11, fontWeight: 600, color: '#e8724a', marginBottom: 2 }}>Coming up in {minsUntil <= 120 ? `${Math.ceil(minsUntil)} min` : `${Math.round(minsUntil / 60)}h`}</div>}
                      <div style={{ fontWeight: 600, fontSize: 15, color: '#333' }}>
                        {s.recipientName || 'Care Visit'}
                        {s.caregiverName ? ` with ${s.caregiverName}` : ''}
                      </div>
                      <div style={{ fontSize: 13, color: '#666', marginTop: 2 }}>
                        {dayLabel}{timeLabel ? ` at ${timeLabel}` : ''}
                        {s.durationHours ? ` \u2022 ${s.durationHours}hr` : ''}
                        {s.serviceType ? ` \u2022 ${formatServiceType(s.serviceType)}` : ''}
                      </div>
                      {isSeekingCaregiver && <div style={{ fontSize: 12, fontWeight: 600, color: '#e8724a', marginTop: 4 }}>Seeking caregiver</div>}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                      <span style={{
                        padding: '4px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                        background: isActive ? '#fff8e1' : isImminent ? '#fff3e0' : s.status === 'confirmed' ? '#e8f5e9' : '#fff3e0',
                        color: isActive ? '#f57f17' : isImminent ? '#e8724a' : s.status === 'confirmed' ? '#2e7d32' : '#e65100',
                        textTransform: 'capitalize', whiteSpace: 'nowrap',
                      }}>{isActive ? 'In Progress' : s.status}</span>
                      {['confirmed', 'pending', 'open', 'requested'].includes(s.status) && (
                        <button onClick={(e) => { e.stopPropagation(); setCancellingId(s.id); }}
                          style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid #e0e0e0', background: '#fff', color: '#c62828', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Open Requests — unclaimed jobs the family posted */}
      {(() => {
        const tz = upcoming[0]?.timezone || TimezoneHelper.DEFAULT_TZ;
        const openReqs = upcoming.filter(s => ['open', 'requested'].includes(s.status) && !s.caregiverName);
        if (openReqs.length === 0) return null;
        const showAll = awaitingExpanded || openReqs.length <= 2;
        const visibleReqs = showAll ? openReqs : openReqs.slice(0, 2);
        return (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
              Awaiting Caregiver ({openReqs.length})
            </div>
            <div style={{ position: 'relative' }}>
              {visibleReqs.map((s, idx) => {
                const dayLabel = TimezoneHelper.getDateLabel((s.date || '').split('T')[0], tz);
                const timeLabel = TimezoneHelper.formatTime(s.time);
                return (
                  <div key={s.id || idx} onClick={() => {
                    if (s.id) setVisitDetailSessionId(s.id);
                  }} style={{
                    marginBottom: 8, padding: '14px 16px', cursor: 'pointer', borderRadius: 12,
                    border: '2px dashed #e8724a', background: '#fff8f0',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 15, color: '#333' }}>
                          {s.recipientName || 'Care Visit'}
                        </div>
                        <div style={{ fontSize: 13, color: '#666', marginTop: 2 }}>
                          {dayLabel}{timeLabel ? ` at ${timeLabel}` : ''}
                          {s.durationHours ? ` \u2022 ${s.durationHours}hr` : ''}
                          {s.serviceType ? ` \u2022 ${formatServiceType(s.serviceType)}` : ''}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#e8724a', marginTop: 4 }}>No caregiver yet — waiting for someone to accept</div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                        <span style={{
                          padding: '4px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                          background: '#fff3e0', color: '#e65100', textTransform: 'capitalize', whiteSpace: 'nowrap',
                        }}>Open</span>
                        <button onClick={(e) => { e.stopPropagation(); setCancellingId(s.id); }}
                          style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid #e0e0e0', background: '#fff', color: '#c62828', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {/* Gradient fade + "Show more" when collapsed with 3+ items */}
              {!showAll && (
                <div onClick={() => setAwaitingExpanded(true)} style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0, height: 64, cursor: 'pointer',
                  background: 'linear-gradient(transparent 0%, rgba(255,255,255,0.85) 40%, #fff 100%)',
                  display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 4,
                }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#e8724a' }}>
                    + {openReqs.length - 2} more &mdash; tap to expand
                  </span>
                </div>
              )}
              {showAll && openReqs.length > 2 && (
                <div onClick={() => setAwaitingExpanded(false)} style={{
                  textAlign: 'center', padding: '4px 0', cursor: 'pointer',
                }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#888' }}>Show less</span>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {stats.unreadNotifications > 0 && (
        <div style={{ background: '#fff3e0', border: '1px solid #ffe0b2', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}
          onClick={() => onNavigate && onNavigate('activity')}>
          <span style={{ fontSize: '20px' }}>🔔</span>
          <span style={{ fontSize: '14px', color: '#e65100' }}>{stats.unreadNotifications} unread notification{stats.unreadNotifications > 1 ? 's' : ''}</span>
        </div>
      )}

      {/* Recent Activity — last 5 items */}
      {activity.length > 0 && (
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><span className="card-icon">📢</span>Recent Activity</span>
            <span onClick={() => onNavigate && onNavigate('activity')} style={{ fontSize: 12, color: '#1b6b5a', cursor: 'pointer', fontWeight: 600 }}>View All →</span>
          </div>
          <div>
            {activity.slice(0, 5).map((a, idx) => (
              <div key={idx}
                onClick={() => a.sessionId && setVisitDetailSessionId(a.sessionId)}
                style={{
                  padding: '10px 0', borderBottom: idx < Math.min(activity.length, 5) - 1 ? '1px solid #f0f0f0' : 'none',
                  cursor: a.sessionId ? 'pointer' : 'default', transition: 'background 0.15s',
                  borderRadius: 4, margin: '0 -4px', paddingLeft: 4, paddingRight: 4,
                }}
                onMouseEnter={(e) => { if (a.sessionId) e.currentTarget.style.background = '#f0f8f5'; }}
                onMouseLeave={(e) => { if (a.sessionId) e.currentTarget.style.background = ''; }}>
                <div style={{ fontWeight: 600, color: '#333', fontSize: 13, marginBottom: 2 }}>
                  {a.title}
                  {a.sessionId && <span style={{ fontSize: 11, color: '#1b6b5a', marginLeft: 6, fontWeight: 500 }}>View →</span>}
                </div>
                {a.message && <div style={{ fontSize: 12, color: '#666', marginTop: 2, lineHeight: 1.4 }}>{a.message}</div>}
                <div style={{ fontSize: 11, color: '#999', marginTop: 3 }}>{formatActivityTime(a.timestamp)}</div>
              </div>
            ))}
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
      {/* Cancel Confirmation Modal */}
      {cancellingId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 400, maxWidth: '90vw' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 18 }}>Cancel Session</h3>
            {(() => {
              const s = upcoming.find(x => x.id === cancellingId);
              if (!s) return null;
              const sessionDT = parseTimestamp(`${s.date}T${s.time || '00:00'}`) || new Date(`${s.date}T${s.time || '00:00'}`);
              const hoursAway = (sessionDT - new Date()) / (1000 * 60 * 60);
              const hasCaregiver = !!s.caregiverName;
              const isLate = hasCaregiver && hoursAway < 24;
              return (
                <div>
                  <div style={{ fontSize: 14, color: '#333', marginBottom: 12 }}>
                    {s.recipientName} — {s.date ? (parseTimestamp(s.date + 'T12:00:00') || new Date(s.date + 'T12:00:00')).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''} at {s.time}
                  </div>
                  {!hasCaregiver && (
                    <div style={{ padding: '10px 14px', background: '#e8f5e9', borderRadius: 8, border: '1px solid #c8e6c9', marginBottom: 12, fontSize: 13, color: '#2e7d32' }}>
                      No caregiver assigned yet — free to cancel with no fee.
                    </div>
                  )}
                  {isLate && (
                    <div style={{ padding: '10px 14px', background: '#fff3e0', borderRadius: 8, border: '1px solid #ffe082', marginBottom: 12, fontSize: 13, color: '#e65100' }}>
                      This is a <strong>late cancellation</strong> (less than 24 hours before the session). You will still be charged for this session.
                    </div>
                  )}
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: 'block', fontSize: 12, color: '#888', marginBottom: 4 }}>Reason (optional)</label>
                    <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)}
                      placeholder="Why are you cancelling?"
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, minHeight: 60, resize: 'vertical' }} />
                  </div>
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                    <button onClick={() => { setCancellingId(null); setCancelReason(''); }}
                      style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                      Keep Session
                    </button>
                    <button onClick={() => handleCancel(cancellingId)} disabled={cancelLoading}
                      style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: cancelLoading ? '#999' : '#c62828', color: '#fff', fontSize: 13, fontWeight: 600, cursor: cancelLoading ? 'wait' : 'pointer' }}>
                      {cancelLoading ? 'Cancelling...' : 'Cancel Session'}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Visit Detail Modal */}
      {visitDetailSessionId && (
        <VisitDetailModal sessionId={visitDetailSessionId} role="family" onClose={() => setVisitDetailSessionId(null)} />
      )}

      {/* Review Modal — works for both post-session and late-cancel reviews */}
      {reviewSession && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: 420, maxWidth: '90vw' }}>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>{'\u2B50'}</div>
              <h3 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 700, color: '#333' }}>
                How was {reviewSession.caregiverName || 'your caregiver'}?
              </h3>
              <p style={{ fontSize: 13, color: '#888', margin: 0 }}>
                {reviewSession.recipientName ? `Care visit with ${reviewSession.recipientName}` : 'Your recent care visit'}
                {reviewSession.date ? ` on ${reviewSession.date}` : ''}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, justifyContent: 'center' }}>
              {[1, 2, 3, 4, 5].map(star => (
                <button key={star} onClick={() => setReviewRating(star)}
                  style={{ fontSize: 36, background: 'none', border: 'none', cursor: 'pointer', color: star <= reviewRating ? '#f59e0b' : '#d0d0d0', transition: 'transform 0.15s', transform: star <= reviewRating ? 'scale(1.15)' : 'scale(1)' }}>
                  {'\u2605'}
                </button>
              ))}
            </div>
            {reviewRating > 0 && (
              <div style={{ textAlign: 'center', fontSize: 13, color: '#1b6b5a', fontWeight: 600, marginBottom: 12 }}>
                {reviewRating === 5 ? 'Excellent!' : reviewRating === 4 ? 'Great!' : reviewRating === 3 ? 'Good' : reviewRating === 2 ? 'Fair' : 'Poor'}
              </div>
            )}
            <textarea value={reviewComment} onChange={e => setReviewComment(e.target.value)}
              placeholder="Tell us more about your experience (optional)..."
              style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #e0e0e0', fontSize: 14, minHeight: 80, resize: 'vertical', marginBottom: 16, fontFamily: 'inherit', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setReviewSession(null); setReviewRating(0); setReviewComment(''); }}
                style={{ flex: 1, padding: '12px 16px', borderRadius: 10, border: '1px solid #ddd', background: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', color: '#666' }}>
                Not Now
              </button>
              <button onClick={handleReview} disabled={!reviewRating || reviewLoading}
                style={{ flex: 1, padding: '12px 16px', borderRadius: 10, border: 'none', background: (!reviewRating || reviewLoading) ? '#ccc' : '#1b6b5a', color: '#fff', fontSize: 14, fontWeight: 700, cursor: (!reviewRating || reviewLoading) ? 'default' : 'pointer' }}>
                {reviewLoading ? 'Submitting...' : 'Submit Review'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
