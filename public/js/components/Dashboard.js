const Dashboard = window.Dashboard = ({ onNavigate, acceptingInvite }) => {
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
  const [tipAmount, setTipAmount] = useState(0);
  const [tipCustom, setTipCustom] = useState('');
  const [tipReason, setTipReason] = useState('');
  const [tipSent, setTipSent] = useState(false);
  const [visitDetailSessionId, setVisitDetailSessionId] = useState(null);
  const [awaitingExpanded, setAwaitingExpanded] = useState(false);
  const [proposalActionLoading, setProposalActionLoading] = useState(null);
  const [nextUpExpanded, setNextUpExpanded] = useState(false);
  const [finishedExpanded, setFinishedExpanded] = useState(false);
  // Tick counter for live countdown on in-progress and imminent sessions (re-renders every 30-60s)
  const [tick, setTick] = useState(0);
  const [imminentId, setImminentId] = useState(null); // track which session is the hero card
  const [lightboxPhoto, setLightboxPhoto] = useState(null); // full-screen photo viewer
  const [overduePopupDismissedIds, setOverduePopupDismissedIds] = useState({}); // track dismissed overdue popups per session

  // Review gating state
  const [pendingReviews, setPendingReviews] = useState([]);
  const [lateCheckInAlert, setLateCheckInAlert] = useState(null);
  // Care team invite banner
  const [pendingInvites, setPendingInvites] = useState([]);
  const [acceptingInviteId, setAcceptingInviteId] = useState(null);
  const [invitesChecked, setInvitesChecked] = useState(false);

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

  const fetchPendingReviews = async () => {
    try {
      const res = await apiFetch('/api/accountability/pending-reviews');
      if (res?.ok) {
        const d = await res.json();
        setPendingReviews(d.pendingReviews || []);
      }
    } catch {}
  };

  const fetchPendingInvites = async () => {
    try {
      const res = await apiFetch('/api/care-teams/my-pending-invites');
      if (res?.ok) { const d = await res.json(); setPendingInvites(d.invites || []); }
    } catch {}
    setInvitesChecked(true);
  };

  const handleAcceptInvite = async (invite) => {
    setAcceptingInviteId(invite.id);
    try {
      const res = await apiFetch('/api/care-teams/accept-invite', {
        method: 'POST',
        body: JSON.stringify({ token: invite.token }),
      });
      if (res?.ok) {
        showToast(`Joined ${invite.recipient_first_name}'s care team!`, 'success');
        setPendingInvites(prev => prev.filter(i => i.id !== invite.id));
        fetchDashboard();
        fetchCareTeams();
      } else {
        const err = await res?.json().catch(() => ({}));
        showToast(err?.error || 'Failed to accept invite', 'error');
      }
    } catch { showToast('Failed to accept invite', 'error'); }
    setAcceptingInviteId(null);
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
        // Submit tip if one was selected
        const finalTipCents = tipAmount === 'custom' ? Math.round(parseFloat(tipCustom || '0') * 100) : (tipAmount || 0);
        if (finalTipCents >= 100) {
          try {
            await apiFetch(`/api/sessions/${reviewSession.id}/tip`, {
              method: 'POST',
              body: JSON.stringify({ amount_cents: finalTipCents, reason_text: tipReason || null }),
            });
          } catch (e) { console.error('Tip submission error:', e); }
        }
        setReviewSession(null);
        setReviewRating(0);
        setReviewComment('');
        setTipAmount(0);
        setTipCustom('');
        setTipReason('');
        setTipSent(false);
        if (typeof showToast === 'function') showToast(finalTipCents >= 100 ? 'Review & tip submitted! Thank you.' : 'Review submitted! Thank you.', 'success');
        fetchDashboard();
        fetchPendingReviews();
      } else {
        const err = await res?.json().catch(() => ({}));
        alert(err?.error || 'Failed to submit review');
      }
    } catch { alert('Failed to submit review'); }
    setReviewLoading(false);
  };

  const handleProposalAction = async (sessionId, proposalId, action) => {
    setProposalActionLoading(proposalId);
    try {
      const res = await apiFetch(`/api/sessions/${sessionId}/proposals/${proposalId}/${action}`, { method: 'PUT' });
      if (res?.ok) {
        if (typeof showToast === 'function') showToast(action === 'accept' ? 'Proposal accepted! Session updated.' : 'Proposal declined.', action === 'accept' ? 'success' : 'info');
        fetchDashboard();
      } else {
        const err = await res?.json().catch(() => ({}));
        alert(err?.error || `Failed to ${action} proposal`);
      }
    } catch { alert(`Failed to ${action} proposal`); }
    setProposalActionLoading(null);
  };

  useEffect(() => {
    fetchDashboard(); fetchUser(); fetchCareTeams(); fetchAnalytics(); fetchPendingReviews(); fetchPendingInvites();
    // Re-fetch when a new session is created (e.g. from RequestCareModal)
    const onSessionsUpdated = () => { fetchDashboard(); fetchPendingReviews(); };
    window.addEventListener('sessions-updated', onSessionsUpdated);
    return () => window.removeEventListener('sessions-updated', onSessionsUpdated);
  }, []);

  // Real-time: refresh dashboard on activity or session updates
  useEffect(() => {
    if (typeof onSocketEvent !== 'function') return;
    const c1 = onSocketEvent('activity_update', () => fetchDashboard());
    const c2 = onSocketEvent('session_update', () => { fetchDashboard(); fetchPendingReviews(); });
    const c3 = onSocketEvent('visit_photos', () => fetchDashboard());
    const c4 = onSocketEvent('late_check_in', (data) => setLateCheckInAlert(data));
    const c5 = onSocketEvent('care_team_invite', () => fetchPendingInvites());
    return () => { c1(); c2(); c3(); c4(); c5(); };
  }, []);

  // Refresh dashboard when tab regains focus (catches missed socket events)
  useEffect(() => {
    let lastFetch = Date.now();
    const onFocus = () => {
      // Only refetch if at least 30s since last fetch (avoid rapid-fire on tab switching)
      if (Date.now() - lastFetch > 30000) {
        lastFetch = Date.now();
        fetchDashboard();
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') onFocus();
    });
    return () => {
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  // Tick every 30s so in-progress countdowns stay live
  useEffect(() => {
    const hasActive = data?.upcomingSessions?.some(s => s.status === 'in_progress');
    // Also tick for imminent sessions (within 24h) so countdown updates
    const hasImminent = !!imminentId;
    if (!hasActive && !hasImminent) return;
    const interval = hasActive ? 30000 : 60000; // 30s for active, 60s for countdown
    const iv = setInterval(() => setTick(t => t + 1), interval);
    return () => clearInterval(iv);
  }, [data?.upcomingSessions, imminentId]);

  // ─── Resume in-progress wizard or send new users into wizard ───
  // Must be before early returns to avoid breaking Rules of Hooks
  // Wait for invites check before redirecting — user with pending invites should NOT be sent to wizard
  useEffect(() => {
    if (loading || !data || !invitesChecked) return;
    // Skip wizard redirect while an invite is being accepted
    if (acceptingInvite) return;
    // If user has pending care team invites, DON'T redirect to wizard — show invites instead
    if (pendingInvites.length > 0) return;
    // Check if there's a wizard in progress (saved in sessionStorage)
    try {
      const saved = sessionStorage.getItem('inplace_wizard');
      if (saved && onNavigate) {
        onNavigate('recipients');
        return;
      }
    } catch {}
    // New user with no care recipient → start wizard
    const isNew = data?.isNewUser && !(user?.is_demo || user?.isDemo);
    const hasRec = !!(data?.parent || (data?.stats?.assignedCaregivers > 0));
    if (isNew && !hasRec && onNavigate) {
      onNavigate('recipients');
    }
  }, [loading, data, user, acceptingInvite, invitesChecked, pendingInvites]);

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
      <h2 style={{ margin: '0 0 8px', color: 'var(--text-primary)' }}>Something went wrong</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 20 }}>We couldn't load your dashboard. This might be a temporary issue.</p>
      <button onClick={() => { setError(false); setLoading(true); fetchDashboard(); }}
        style={{ padding: '10px 24px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
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

  // Core status checks for new user flow
  const hasProfile = !!(user?.first_name || user?.firstName) && !!(user?.phone) && !!(user?.city || user?.zip);
  const hasRecipient = (data?.parent || stats.assignedCaregivers > 0);

  // ─── PWA Install Guide Modal ───
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);
  const pwaGuide = showPwaGuide && (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={() => setShowPwaGuide(false)}>
      <div style={{ background: 'var(--bg-surface)', borderRadius: 16, maxWidth: 420, width: '100%', padding: '28px 24px', maxHeight: '90vh', overflow: 'auto' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Install InPlace</h2>
          <button onClick={() => setShowPwaGuide(false)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-muted)' }}>&times;</button>
        </div>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 20px' }}>
          Adding InPlace to your home screen gives you push notifications, faster loading, and a full-screen app experience.
        </p>

        {isIOS ? (
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--role-color)', marginBottom: 12 }}>On iPhone / iPad (Safari)</div>
            {[
              { num: '1', text: 'Tap the Share button at the bottom of Safari (the square with an arrow pointing up)' },
              { num: '2', text: 'Scroll down and tap "Add to Home Screen"' },
              { num: '3', text: 'Tap "Add" in the top right' },
              { num: '4', text: 'Open InPlace from your home screen — you\'ll get push notifications and a full-screen experience!' },
            ].map(s => (
              <div key={s.num} style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'flex-start' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--role-color)', color: 'var(--text-on-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{s.num}</div>
                <div style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.5, paddingTop: 3 }}>{s.text}</div>
              </div>
            ))}
            <div style={{ background: 'var(--color-warning-bg)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--text-brown)', marginTop: 8 }}>
              <strong>Important:</strong> You must use Safari for this to work. Chrome on iPhone does not support home screen apps.
            </div>
          </div>
        ) : isAndroid ? (
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--role-color)', marginBottom: 12 }}>On Android (Chrome)</div>
            {[
              { num: '1', text: 'Tap the three-dot menu in the top right of Chrome' },
              { num: '2', text: 'Tap "Add to Home screen" or "Install app"' },
              { num: '3', text: 'Tap "Install" to confirm' },
              { num: '4', text: 'Open InPlace from your home screen — push notifications will work automatically!' },
            ].map(s => (
              <div key={s.num} style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'flex-start' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--role-color)', color: 'var(--text-on-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{s.num}</div>
                <div style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.5, paddingTop: 3 }}>{s.text}</div>
              </div>
            ))}
          </div>
        ) : (
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--role-color)', marginBottom: 12 }}>On your phone's browser</div>
            <p style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.6 }}>
              Open <strong>yourinplace.com</strong> in your phone's browser, then use the browser menu to "Add to Home Screen" or "Install App". This gives you push notifications and a full-screen experience.
            </p>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button onClick={() => { localStorage.setItem('pwa_setup_done', '1'); setShowPwaGuide(false); }}
            style={{ flex: 1, padding: '12px 16px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
            Done — I've installed it!
          </button>
          <button onClick={() => setShowPwaGuide(false)}
            style={{ padding: '12px 16px', background: 'var(--bg-primary)', color: 'var(--text-secondary)', border: 'none', borderRadius: 10, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            Later
          </button>
        </div>
      </div>
    </div>
  );

  // ─── Welcome screen for new users who haven't added a loved one yet ───
  // Once a care recipient exists, show the main dashboard with Get Started tiles instead
  if (isNewUser && !hasRecipient) {
    const hasPendingInvites = pendingInvites.length > 0;
    const exploreIdeas = [
      { icon: '👥', label: 'Invite family to help coordinate care', action: () => onNavigate && onNavigate('care-team'), actionText: 'Care Team' },
      { icon: '🔍', label: 'Browse caregivers in your area', action: () => onNavigate && onNavigate('caregivers'), actionText: 'Find Caregivers' },
      { icon: '👤', label: 'Complete your profile with phone and address', action: () => onNavigate && onNavigate('account'), actionText: 'My Profile', done: hasProfile },
      { icon: '📱', label: 'Install InPlace on your phone for notifications', action: () => setShowPwaGuide(true), actionText: 'Set Up', done: !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || !!localStorage.getItem('pwa_setup_done') },
    ].filter(s => !s.done);

    return (
      <>
        {pwaGuide}
        {/* Welcome Hero */}
        <div style={{ background: 'linear-gradient(135deg, #1b6b5a 0%, #2a9d8f 100%)', borderRadius: 16, padding: '40px 32px', color: 'var(--text-on-primary)', marginBottom: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>{hasPendingInvites ? '\uD83E\uDD1D' : '\uD83C\uDF89'}</div>
          <h1 style={{ margin: '0 0 8px', fontSize: 28, fontWeight: 700 }}>
            {hasPendingInvites ? `Welcome, ${firstName}!` : `You're off to a great start, ${firstName}!`}
          </h1>
          <p style={{ margin: 0, fontSize: 16, opacity: 0.9, maxWidth: 480, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.5 }}>
            {hasPendingInvites
              ? `You have ${pendingInvites.length === 1 ? 'a care team invite' : pendingInvites.length + ' care team invites'} waiting for you!`
              : hasRecipient
                ? 'Your loved one has been added and we\'re verifying everything. Here are some things you can explore while you wait.'
                : 'Welcome to InPlace! Get started by adding your loved one or accepting a care team invite.'}
          </p>
        </div>

        {/* Pending care team invites — shown prominently for invited users */}
        {hasPendingInvites && pendingInvites.map(invite => (
          <div key={invite.id} style={{ background: '#E8F5E9', border: '2px solid #66BB6A', borderRadius: 14, padding: '20px 24px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16, boxShadow: '0 3px 12px rgba(27,107,90,0.18)' }}>
            <span style={{ fontSize: 36 }}>{'\uD83D\uDC6A'}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--role-color)' }}>
                Join {invite.recipient_first_name} {invite.recipient_last_name}'s Care Team
              </div>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 4 }}>
                {invite.inviter_first_name} {invite.inviter_last_name} invited you to help coordinate care.
              </div>
            </div>
            <button onClick={() => handleAcceptInvite(invite)}
              disabled={acceptingInviteId === invite.id}
              style={{ padding: '12px 28px', background: acceptingInviteId === invite.id ? 'var(--text-muted)' : 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: acceptingInviteId === invite.id ? 'wait' : 'pointer', whiteSpace: 'nowrap', boxShadow: '0 3px 8px rgba(0,0,0,0.18)' }}>
              {acceptingInviteId === invite.id ? 'Joining...' : 'Accept Invite'}
            </button>
          </div>
        ))}

        {/* Hint for users expecting an invite but not seeing one */}
        {!hasPendingInvites && !hasRecipient && (
          <div style={{ background: 'var(--color-warning-bg)', border: '1px solid #FFE082', borderRadius: 12, padding: '14px 18px', marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <span style={{ fontSize: 20, flexShrink: 0 }}>{'\uD83D\uDCE8'}</span>
            <div style={{ fontSize: 13, color: 'var(--text-brown)', lineHeight: 1.6 }}>
              <strong>Expecting an invite?</strong> If someone invited you to join a care team, your invite will appear here.
              If you don't see it, contact the person who invited you and ask them to resend the invite from their Care Team page.
            </div>
          </div>
        )}

        {/* Explore ideas — casual, not a checklist */}
        {exploreIdeas.length > 0 && (
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 20 }}>💡</span>
              <span style={{ fontWeight: 700, fontSize: 16 }}>Things to explore</span>
              <button onClick={(e) => { e.stopPropagation(); dismissTile('onboarding', 'v2'); }} title="Dismiss" style={{
                marginLeft: 'auto', background: 'var(--badge-muted-bg)', border: 'none', cursor: 'pointer', fontSize: 13,
                color: 'var(--text-muted)', padding: '2px 8px', borderRadius: 6, fontWeight: 600,
              }}>✕</button>
            </div>
            <div style={{ marginTop: 8 }}>
              {exploreIdeas.map((idea, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0',
                  borderBottom: idx < exploreIdeas.length - 1 ? '1px solid #f5f5f5' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1 }}>
                    <span style={{ fontSize: 22 }}>{idea.icon}</span>
                    <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>{idea.label}</span>
                  </div>
                  <button onClick={idea.action}
                    style={{ padding: '8px 18px', background: 'var(--bg-primary)', color: 'var(--role-color)', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, marginLeft: 12 }}>
                    {idea.actionText}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </>
    );
  }

  // ─── Overdue session detection (15+ min past expected end) ───
  // (plain computation — re-runs on every render, which is fine since tick triggers re-renders every 30s)
  let overdueSession = null;
  if (data?.upcomingSessions) {
    const tz0 = data.upcomingSessions[0]?.timezone || TimezoneHelper.DEFAULT_TZ;
    for (const s of data.upcomingSessions) {
      if (s.status !== 'in_progress' || !s.durationHours) continue;
      let startMs;
      if (s.checkInTime) {
        startMs = new Date(s.checkInTime).getTime();
      } else {
        const sDate = (s.date || '').split('T')[0];
        startMs = TimezoneHelper.buildDateTime(sDate, s.time || '00:00', s.timezone || tz0).getTime();
      }
      const endMs = startMs + (s.durationHours * 3600000);
      const overdueMs = Date.now() - endMs;
      if (overdueMs >= 15 * 60000) {
        overdueSession = { ...s, overdueMinutes: Math.floor(overdueMs / 60000) };
        break;
      }
    }
  }

  const showOverduePopup = overdueSession && !overduePopupDismissedIds[overdueSession.id];

  // ─── Regular dashboard for users with data ───
  return (
    <>
      {pwaGuide}
      {/* Push notification prompt — shows if not yet enabled */}
      {typeof NotificationPrompt !== 'undefined' && React.createElement(NotificationPrompt, null)}

      {/* ─── Overdue session popup — call caregiver ─── */}
      {showOverduePopup && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 20,
        }}>
          <div style={{
            background: 'var(--bg-surface)', borderRadius: 16, maxWidth: 380, width: '100%',
            padding: '28px 24px', boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>{'\u23F0'}</div>
            <h3 style={{ margin: '0 0 8px', fontSize: 18, color: 'var(--color-error)' }}>Session Running Late</h3>
            <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {overdueSession.caregiverName
                ? `${overdueSession.caregiverName}'s session with ${overdueSession.recipientName || 'your loved one'} is ${overdueSession.overdueMinutes} min past the expected end time.`
                : `The care session is ${overdueSession.overdueMinutes} min past the expected end time.`
              }
            </p>
            {overdueSession.caregiverPhone ? (
              <a href={`tel:${overdueSession.caregiverPhone}`} style={{
                display: 'block', padding: '14px 20px', background: 'var(--role-color)', color: 'var(--text-on-primary)',
                borderRadius: 12, fontSize: 16, fontWeight: 700, textDecoration: 'none',
                marginBottom: 10,
              }}>
                {'\uD83D\uDCDE'} Call {overdueSession.caregiverName || 'Caregiver'}
              </a>
            ) : (
              <div style={{
                padding: '12px 16px', background: 'var(--bg-primary)', borderRadius: 10,
                fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10,
              }}>
                No phone number on file for this caregiver
              </div>
            )}
            <button onClick={() => {
              setOverduePopupDismissedIds(prev => ({ ...prev, [overdueSession.id]: true }));
            }} style={{
              width: '100%', padding: '12px 20px', background: 'transparent',
              border: '2px solid #ddd', borderRadius: 12, fontSize: 14,
              color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 600,
            }}>
              Dismiss
            </button>
          </div>
        </div>
      )}
      <div className="page-header">
        <h1 className="greeting">{isNewUser ? `Welcome, ${firstName}!` : `Welcome back, ${firstName}!`}</h1>
      </div>

      {/* Care team invite banners — show pending invites the user can accept */}
      {pendingInvites.length > 0 && pendingInvites.map(invite => (
        <div key={invite.id} style={{ background: '#E8F5E9', border: '2px solid #66BB6A', borderRadius: 12, padding: '16px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 2px 8px rgba(27,107,90,0.15)' }}>
          <span style={{ fontSize: 32 }}>{'\uD83E\uDD1D'}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--role-color)' }}>
              You're invited to {invite.recipient_first_name}'s Care Team!
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 3 }}>
              {invite.inviter_first_name} {invite.inviter_last_name} invited you to help coordinate care for {invite.recipient_first_name} {invite.recipient_last_name}.
            </div>
          </div>
          <button onClick={() => handleAcceptInvite(invite)}
            disabled={acceptingInviteId === invite.id}
            style={{ padding: '10px 24px', background: acceptingInviteId === invite.id ? 'var(--text-muted)' : 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: acceptingInviteId === invite.id ? 'wait' : 'pointer', whiteSpace: 'nowrap', boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }}>
            {acceptingInviteId === invite.id ? 'Joining...' : 'Accept'}
          </button>
        </div>
      ))}

      {/* Consent warning banner — show if any care recipients have pending/rejected consent */}
      {data?.careRecipients && data.careRecipients.some(cr => cr.consent_status && cr.consent_status !== 'verified') && (
        <div style={{ background: 'var(--color-warning-bg)', border: '1px solid #ffe0b2', borderRadius: '10px', padding: '14px 18px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '24px' }}>{'\u26A0\uFE0F'}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--color-warning)' }}>
              {data.careRecipients.some(cr => cr.consent_status === 'attested') ? 'Verification in progress' : 'Authorization pending'}
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-brown)', marginTop: '2px' }}>
              {data.careRecipients.filter(cr => cr.consent_status && cr.consent_status !== 'verified').map(cr => {
                const name = ((cr.first_name || cr.firstName || '') + ' ' + (cr.last_name || cr.lastName || '')).trim() || 'Your loved one';
                const firstName = cr.first_name || cr.firstName || name;
                return cr.consent_status === 'attested' ? name + ' \u2014 awaiting response from ' + firstName : name + ' \u2014 complete verification to book care';
              }).join('. ')}.
            </div>
          </div>
          <button onClick={() => { if (onNavigate) { window.__accountTab = 'documents'; window.__documentsTab = 'consent'; onNavigate('account'); } }} style={{ padding: '8px 16px', background: 'var(--accent-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>View Status</button>
        </div>
      )}

      {/* Latest Status — only show when there's something actionable */}
      {!isNewUser && (() => {
        const upcomingCount = upcoming.length;
        const unreadCount = stats.unreadNotifications || 0;
        let statusIcon, statusText, borderColor;

        if (upcomingCount > 0) {
          statusIcon = '📅';
          statusText = `You have ${upcomingCount} upcoming session${upcomingCount > 1 ? 's' : ''} this week.`;
          if (unreadCount > 0) statusText += ` ${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}.`;
          borderColor = 'var(--role-color)';
        } else if (unreadCount > 0) {
          statusIcon = '🔔';
          statusText = `You have ${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}.`;
          borderColor = 'var(--role-color)';
        } else if (stats.assignedCaregivers === 0 && !parent) {
          statusIcon = '🔍';
          statusText = 'Get started by adding a loved one and finding caregivers in your area.';
          borderColor = 'var(--accent-color)';
        } else {
          // Nothing actionable — don't show the tile
          return null;
        }

        const latestFingerprint = `${upcomingCount}-${unreadCount}-${stats.assignedCaregivers}`;
        if (isTileDismissed('latest', latestFingerprint)) return null;

        const latestClickTarget = upcomingCount > 0 ? 'schedule' : (unreadCount > 0 ? 'activity' : (!parent ? 'recipients' : (stats.assignedCaregivers === 0 ? 'caregivers' : 'schedule')));
        return (
          <div className="card" style={{ marginBottom: 16, borderLeft: `4px solid ${borderColor}`, display: 'flex', alignItems: 'center', gap: 12, position: 'relative', cursor: 'pointer' }}
            onClick={() => onNavigate && onNavigate(latestClickTarget)}>
            <span style={{ fontSize: 24 }}>{statusIcon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>Latest</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>{statusText}</div>
            </div>
            <button onClick={(e) => { e.stopPropagation(); dismissTile('latest', latestFingerprint); }} title="Hide until there's something new" style={{
              background: 'var(--badge-muted-bg)', border: 'none', cursor: 'pointer', fontSize: 13,
              color: 'var(--text-muted)', padding: '4px 10px', borderRadius: 6, fontWeight: 600,
            }}>✕</button>
          </div>
        );
      })()}

      {/* Email domain verification — removed, setup is complete */}

      {/* Quick-access explore ideas for users who haven't filled out profile yet */}
      {!isDemo && user && !hasProfile && !isTileDismissed('onboarding', 'v2') && (
        <div className="card" style={{ borderLeft: '4px solid #e8724a', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>👤</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Complete your profile with phone and address</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={() => onNavigate && onNavigate('account')}
                style={{ padding: '6px 14px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                My Profile
              </button>
              <button onClick={() => dismissTile('onboarding', 'v2')} title="Dismiss" style={{
                background: 'var(--badge-muted-bg)', border: 'none', cursor: 'pointer', fontSize: 13,
                color: 'var(--text-muted)', padding: '2px 8px', borderRadius: 6, fontWeight: 600,
              }}>✕</button>
            </div>
          </div>
        </div>
      )}

      {/* Prominent "Add a Loved One" CTA for users without care recipients */}
      {!isDemo && !parent && (
        <div onClick={() => onNavigate && onNavigate('recipients')}
          style={{ background: 'linear-gradient(135deg, #1b6b5a 0%, #2a9d8f 100%)', borderRadius: 14, padding: '24px 20px', marginBottom: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 16, boxShadow: '0 4px 16px rgba(27,107,90,0.2)' }}>
          <span style={{ fontSize: 36 }}>{'\uD83C\uDF37'}</span>
          <div style={{ flex: 1 }}>
            <div style={{ color: 'var(--text-on-primary)', fontWeight: 700, fontSize: 17 }}>Add your loved one</div>
            <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 4, lineHeight: 1.4 }}>
              Set up a care profile so you can find caregivers and coordinate care.
            </div>
          </div>
          <div style={{ color: 'var(--text-on-primary)', fontSize: 24, fontWeight: 300 }}>{'\u203A'}</div>
        </div>
      )}

      {/* Guided discovery tiles — only for new users still setting up (skip if profile + recipient exist) */}
      {!isDemo && parent && !(hasProfile && hasRecipient) && (() => {
        const discoverItems = [
          { id: 'discover-preferences', icon: '⚙️', label: 'Review care preferences', desc: 'Adjust schedules, medications, and daily routines', target: 'recipients' },
          { id: 'discover-family', icon: '👨‍👩‍👧', label: 'Invite family to the care team', desc: 'Add siblings, relatives, or trusted friends', target: 'care-team' },
          { id: 'discover-caregivers', icon: '🔍', label: 'Browse caregivers in your area', desc: 'See who\'s available nearby', target: 'caregivers' },
          { id: 'discover-profile', icon: '👤', label: 'Complete your profile', desc: 'Add your phone number and address', target: 'account' },
        ];
        const clicked = (() => { try { return JSON.parse(localStorage.getItem('inplace_discovered') || '[]'); } catch { return []; } })();
        const remaining = discoverItems.filter(d => !clicked.includes(d.id));
        if (remaining.length === 0) return null;

        const markClicked = (item) => {
          try {
            const cur = JSON.parse(localStorage.getItem('inplace_discovered') || '[]');
            if (!cur.includes(item.id)) { cur.push(item.id); localStorage.setItem('inplace_discovered', JSON.stringify(cur)); }
          } catch {}
          onNavigate && onNavigate(item.target);
        };

        return (
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Get Started</div>
              <button onClick={() => {
                try { localStorage.setItem('inplace_discovered', JSON.stringify(discoverItems.map(d => d.id))); } catch {}
                setDismissedTiles(prev => ({ ...prev, _discoverForceHide: Date.now() }));
              }} style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 6px' }}>Dismiss all</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              {remaining.map(item => (
                <div key={item.id}
                  onClick={() => markClicked(item)}
                  style={{
                    background: 'var(--bg-surface)', border: '1px solid #e8e8e8', borderRadius: 12,
                    padding: '16px 14px', cursor: 'pointer', transition: 'box-shadow 0.15s, border-color 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--role-color)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(27,107,90,0.1)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-light)'; e.currentTarget.style.boxShadow = 'none'; }}
                >
                  <div style={{ fontSize: 22, marginBottom: 8 }}>{item.icon}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4, lineHeight: 1.3 }}>{item.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.3 }}>{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Late Check-In Alert — family needs to choose extend or truncate */}
      {lateCheckInAlert && (
        <div style={{ marginBottom: 16, padding: 16, background: 'var(--color-warning-bg)', border: '2px solid #ff9800', borderRadius: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-warning)', marginBottom: 8 }}>
            {'\u26A0\uFE0F'} Late Check-In
          </div>
          <p style={{ fontSize: 14, color: 'var(--text-primary)', margin: '0 0 12px', lineHeight: 1.5 }}>
            {lateCheckInAlert.message}
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={async () => {
              try {
                await apiFetch(`/api/accountability/late-resolution/${lateCheckInAlert.sessionId}`, {
                  method: 'POST', body: JSON.stringify({ resolution: 'extend' })
                });
                setLateCheckInAlert(null);
              } catch {}
            }} style={{ flex: 1, padding: '10px 16px', background: 'var(--color-success)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>
              Extend Session
            </button>
            <button onClick={async () => {
              try {
                await apiFetch(`/api/accountability/late-resolution/${lateCheckInAlert.sessionId}`, {
                  method: 'POST', body: JSON.stringify({ resolution: 'truncate' })
                });
                setLateCheckInAlert(null);
              } catch {}
            }} style={{ flex: 1, padding: '10px 16px', background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid #ddd', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>
              Keep Original End Time
            </button>
          </div>
        </div>
      )}

      {/* Pending Reviews — stacked at top until completed */}
      {pendingReviews.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-error)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
            {'\u{1F6A8}'} Action Required — Review ({pendingReviews.length})
          </div>
          {pendingReviews.map(pr => {
            const isNoShow = !!pr.caregiver_no_show;
            const borderColor = isNoShow ? '#ef5350' : 'var(--color-warning)';
            const bgColor = isNoShow ? 'var(--bg-error-light)' : 'var(--color-warning-bg)';
            return (
              <div key={pr.id} style={{ padding: 14, marginBottom: 8, background: bgColor, border: `2px solid ${borderColor}`, borderRadius: 12 }}>
                {isNoShow && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8,
                    padding: '6px 10px', background: 'var(--color-error-bg)', borderRadius: 8,
                  }}>
                    <span style={{ fontSize: 16 }}>{'\u{1F6A8}'}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-error)' }}>
                      Caregiver No-Show — {pr.caregiver_name?.split(' ')[0]} did not check in
                    </span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: isNoShow ? 'var(--color-error)' : 'var(--color-warning)' }}>
                    {isNoShow ? '\u2716 No Show — ' : '\u2B50 '}{pr.caregiver_name} · {pr.recipient_first_name}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {pr.scheduled_date}
                  </span>
                </div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 4px' }}>
                  Session with {pr.recipient_first_name} on {pr.scheduled_date}.
                  {isNoShow
                    ? ` ${pr.caregiver_name?.split(' ')[0]} did not check in. The session was cancelled and no payment was charged.`
                    : ` You cannot book ${pr.caregiver_name?.split(' ')[0]} again until you leave a review.`}
                </p>
                {!isNoShow && pr.checked_in_at && (
                  <div style={{ fontSize: 12, color: 'var(--color-success)', marginBottom: 6 }}>
                    {'\u2705'} Caregiver checked in{pr.checked_out_at ? ' and checked out' : ''}
                  </div>
                )}
                <button onClick={() => {
                  setReviewSession(pr);
                  setReviewRating(0);
                  setReviewComment('');
                }} style={{ padding: '8px 20px', background: isNoShow ? '#ef5350' : 'var(--color-warning)', color: isNoShow ? 'var(--bg-card)' : 'var(--text-primary)', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>
                  Leave Review
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Time Proposals — critical action item, above everything */}
      {(() => {
        const proposals = data?.pendingProposals || [];
        if (proposals.length === 0) return null;
        const tz = upcoming[0]?.timezone || TimezoneHelper.DEFAULT_TZ;
        return (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-violet)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
              {'\u{1F4E8}'} Time Proposals ({proposals.length})
            </div>
            {proposals.map((p) => {
              const origDay = TimezoneHelper.getDateLabel((p.originalDate || '').split('T')[0], tz);
              const origTime = TimezoneHelper.formatTime(p.originalTime);
              const propDay = TimezoneHelper.getDateLabel((p.proposedDate || '').split('T')[0], tz);
              const propTime = TimezoneHelper.formatTime(p.proposedTime);
              const isLoading = proposalActionLoading === p.id;
              // Countdown timer for 2-hour response window
              const expiresAt = p.expiresAt ? new Date(p.expiresAt) : null;
              const minsLeft = expiresAt ? Math.max(0, Math.floor((expiresAt - new Date()) / 60000)) : null;
              const hrsLeft = minsLeft !== null ? Math.floor(minsLeft / 60) : null;
              const minsRemainder = minsLeft !== null ? minsLeft % 60 : null;
              const isUrgent = minsLeft !== null && minsLeft <= 30;
              const timeLeftLabel = minsLeft !== null ? (hrsLeft > 0 ? `${hrsLeft}h ${minsRemainder}m left to respond` : `${minsLeft}m left to respond`) : null;
              return (
                <div key={p.id} style={{
                  marginBottom: 10, padding: '14px 16px', borderRadius: 12,
                  border: isUrgent ? '2px solid #e8724a' : '2px solid #7b61ff', background: isUrgent ? 'var(--bg-accent-light)' : '#f5f0ff',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
                        <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>
                          {p.caregiverName} proposed a different time
                        </div>
                        {timeLeftLabel && (
                          <span style={{
                            fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                            background: isUrgent ? 'var(--accent-color)' : 'var(--color-violet)', color: 'var(--text-on-primary)',
                          }}>
                            {isUrgent ? '\u23F1' : '\u23F3'} {timeLeftLabel}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
                        For {p.recipientName || 'Care Visit'}{p.serviceType ? ` \u2022 ${formatServiceType(p.serviceType)}` : ''}{p.durationHours ? ` \u2022 ${p.durationHours}hr` : ''}
                      </div>
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: p.message ? 8 : 0 }}>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Original</div>
                          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', textDecoration: 'line-through' }}>{origDay} at {origTime}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--color-violet)', fontWeight: 600, textTransform: 'uppercase' }}>Proposed</div>
                          <div style={{ fontSize: 14, color: 'var(--color-violet)', fontWeight: 600 }}>{propDay} at {propTime}</div>
                        </div>
                      </div>
                      {p.message && (
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontStyle: 'italic', background: '#ede7f6', padding: '6px 10px', borderRadius: 6, marginTop: 4 }}>
                          "{p.message}"
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                    <button
                      disabled={isLoading}
                      onClick={() => handleProposalAction(p.sessionId, p.id, 'decline')}
                      style={{
                        padding: '8px 18px', borderRadius: 8, border: '1px solid #e0e0e0', background: 'var(--bg-surface)',
                        color: 'var(--color-error)', fontSize: 13, fontWeight: 600, cursor: isLoading ? 'wait' : 'pointer', opacity: isLoading ? 0.6 : 1,
                      }}>
                      Decline
                    </button>
                    <button
                      disabled={isLoading}
                      onClick={() => handleProposalAction(p.sessionId, p.id, 'accept')}
                      style={{
                        padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--color-violet)',
                        color: 'var(--text-on-primary)', fontSize: 13, fontWeight: 600, cursor: isLoading ? 'wait' : 'pointer', opacity: isLoading ? 0.6 : 1,
                      }}>
                      Accept New Time
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

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
            const colors = ['var(--accent-color)', '#4a90d9', 'var(--color-violet)', '#2ecc71'];
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
                      <div key={i} style={{ width: 28, height: 28, borderRadius: '50%', background: colors[i % colors.length], border: '2px solid #0f4238', marginLeft: i > 0 ? -8 : 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--text-on-primary)', fontWeight: 600, zIndex: shown.length - i }}>
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
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-on-primary)' }}>{team.name || 'Care Team'}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>{team.memberCount || 0} member{(team.memberCount || 0) !== 1 ? 's' : ''}{pendingCount > 0 ? ` · ${pendingCount} pending` : ''}</div>
                </div>
              </div>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>→</span>
            </div>
            );
          })()}
        </div>
      )}

      {/* Imminent Session Hero — within 24h, countdown + shimmer, right under profile card */}
      {(() => {
        const tz = upcoming[0]?.timezone || TimezoneHelper.DEFAULT_TZ;
        const nowDisplay = TimezoneHelper.getNow(tz); // for display only (getHours etc.)
        const nowMs = TimezoneHelper.realNowMs(); // for countdown comparisons
        // Find soonest confirmed/in_progress session with a caregiver
        const confirmed = upcoming.filter(s => s.caregiverName && ['confirmed', 'in_progress'].includes(s.status));
        const sorted = [...confirmed].sort((a, b) => {
          const ak = ((a.date || '').split('T')[0]) + (a.time || '');
          const bk = ((b.date || '').split('T')[0]) + (b.time || '');
          return ak.localeCompare(bk);
        });
        const hero = sorted[0];
        if (!hero) { if (imminentId) setImminentId(null); return null; }
        const sDate = (hero.date || '').split('T')[0];
        const sessionDT = TimezoneHelper.buildDateTime(sDate, hero.time || '00:00', tz);
        const msUntil = sessionDT.getTime() - nowMs;
        const isActive = hero.status === 'in_progress';
        // Show hero if within 24h OR currently in progress
        if (!isActive && msUntil > 24 * 3600000) { if (imminentId) setImminentId(null); return null; }
        if (imminentId !== hero.id) setTimeout(() => setImminentId(hero.id), 0);

        // Build countdown string
        let countdownStr = '';
        let countdownColor = 'var(--role-color)';
        if (isActive) {
          // Show remaining time for in-progress
          let startMs;
          if (hero.checkInTime) {
            startMs = new Date(hero.checkInTime).getTime();
          } else {
            startMs = sessionDT.getTime();
          }
          const endMs = startMs + ((hero.durationHours || 2) * 3600000);
          const leftMs = endMs - Date.now();
          if (leftMs > 0) {
            const totalSec = Math.floor(leftMs / 1000);
            const hrs = Math.floor(totalSec / 3600);
            const mins = Math.floor((totalSec % 3600) / 60);
            countdownStr = hrs > 0 ? `${hrs}h ${mins}m remaining` : `${mins}m remaining`;
          } else {
            countdownStr = 'Expected end time passed';
            countdownColor = 'var(--color-error)';
          }
        } else if (msUntil <= 0) {
          countdownStr = 'Starting now — awaiting check-in';
          countdownColor = 'var(--accent-color)';
        } else {
          const totalSec = Math.floor(msUntil / 1000);
          const hrs = Math.floor(totalSec / 3600);
          const mins = Math.floor((totalSec % 3600) / 60);
          if (hrs > 0) {
            countdownStr = `${hrs}h ${mins}m`;
          } else {
            countdownStr = `${mins}m`;
          }
          countdownColor = hrs < 1 ? 'var(--accent-color)' : hrs < 3 ? 'var(--accent-color)' : 'var(--role-color)';
        }

        const dayLabel = TimezoneHelper.getDateLabel(sDate, tz);
        const timeLabel = TimezoneHelper.formatTime(hero.time);
        const bgGradient = isActive
          ? 'linear-gradient(135deg, #fff8e1 0%, #fffde7 100%)'
          : msUntil <= 3600000
            ? 'linear-gradient(135deg, #fff3e0 0%, #fff8f0 100%)'
            : 'linear-gradient(135deg, #f0faf7 0%, #fff 100%)';
        const borderColor = isActive ? 'var(--color-warning)' : msUntil <= 3600000 ? 'var(--accent-color)' : 'var(--role-color)';
        const shouldShimmer = !isActive && msUntil <= 24 * 3600000;

        return (
          <div className={shouldShimmer ? 'next-up-hero-shimmer' : ''} onClick={() => hero.id && setVisitDetailSessionId(hero.id)} style={{
            marginBottom: 16, padding: '18px 20px', cursor: 'pointer', borderRadius: 14,
            border: `3px solid ${borderColor}`,
            background: bgGradient,
            boxShadow: `0 4px 16px ${isActive ? 'rgba(245, 127, 23, 0.15)' : msUntil <= 3600000 ? 'rgba(232, 114, 74, 0.18)' : 'rgba(27, 107, 90, 0.1)'}`,
            position: 'relative', overflow: 'hidden',
          }}>
            {/* Top row: label + countdown */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: isActive ? 'var(--color-warning)' : 'var(--accent-color)' }}>
                {isActive ? 'In Progress Now' : 'Coming Up'}
              </div>
              <div style={{
                fontSize: 14, fontWeight: 700, color: countdownColor,
                background: isActive ? 'var(--color-warning-bg)' : countdownColor === 'var(--accent-color)' ? 'var(--color-warning-bg)' : 'var(--color-success-bg)',
                padding: '4px 12px', borderRadius: 20,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {isActive ? countdownStr : msUntil <= 0 ? countdownStr : `in ${countdownStr}`}
              </div>
            </div>
            {/* Session info */}
            <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--text-primary)', marginBottom: 4 }}>
              {hero.recipientName || 'Care Visit'} with {hero.caregiverName}
            </div>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
              {dayLabel}{timeLabel ? ` at ${timeLabel}` : ''}
              {hero.durationHours ? ` \u2022 ${hero.durationHours}hr` : ''}
              {hero.serviceType ? ` \u2022 ${formatServiceType(hero.serviceType)}` : ''}
            </div>
            {/* Tap hint */}
            <div style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', color: borderColor, opacity: 0.3, fontSize: 20 }}>→</div>
          </div>
        );
      })()}

      {/* Just Finished — recently completed sessions (faded, expandable) */}
      {(() => {
        const completed = data?.recentlyCompleted || [];
        if (completed.length === 0) return null;
        const showAll = finishedExpanded || completed.length <= 2;
        const visible = showAll ? completed.slice(0, 5) : completed.slice(0, 2);
        return (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
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
                        <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>
                          {s.recipientName || 'Care Visit'}
                          {s.caregiverName ? ` with ${s.caregiverName}` : ''}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                          {TimezoneHelper.getDateLabel((s.date || '').split('T')[0], upcoming[0]?.timezone || TimezoneHelper.DEFAULT_TZ)} · {svcLabel} · {s.durationHours || 2}h
                        </div>
                        {s.visitSummary && (
                          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4, fontStyle: 'italic' }}>
                            "{s.visitSummary.length > 80 ? s.visitSummary.slice(0, 80) + '...' : s.visitSummary}"
                          </div>
                        )}
                        {s.conditionTags && s.conditionTags.length > 0 && (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                            {s.conditionTags.map((tag, i) => (
                              <span key={i} style={{ background: 'var(--color-success-bg)', color: 'var(--color-success)', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500 }}>{tag}</span>
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
                            style={{ padding: '6px 14px', borderRadius: 10, border: 'none', background: 'var(--role-color)', color: 'var(--text-on-primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            {'\u2605'} Leave Review
                          </button>
                        ) : (
                          <span style={{ padding: '4px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: 'var(--color-success-bg)', color: 'var(--color-success)' }}>Completed</span>
                        )}
                        <span style={{ fontSize: 12, color: 'var(--role-color)', fontWeight: 600 }}>View Details {'\u2192'}</span>
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
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)' }}>
                    + {completed.length - 2} more &mdash; tap to expand
                  </span>
                </div>
              )}
              {showAll && completed.length > 2 && (
                <div onClick={() => setFinishedExpanded(false)} style={{
                  textAlign: 'center', padding: '4px 0', cursor: 'pointer',
                }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)' }}>Show less</span>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Next Up — up to 10 sessions within 2 weeks, collapsed to 2 cards with fade */}
      {(() => {
        const tz = upcoming[0]?.timezone || TimezoneHelper.DEFAULT_TZ;
        const nowMs = TimezoneHelper.realNowMs();
        const todayStr = TimezoneHelper.getToday(tz);
        const todayLocal = TimezoneHelper.parseDate(todayStr);
        const twoWeeksOut = new Date(nowMs + 14 * 24 * 3600000);

        // Sort all upcoming by date+time — exclude unclaimed open requests (shown separately below)
        // Also exclude the imminent hero session (already shown above Betty card)
        const confirmed = upcoming.filter(s => !((['open', 'requested'].includes(s.status)) && !s.caregiverName) && s.id !== imminentId);
        const sorted = [...confirmed].sort((a, b) => {
          const ak = ((a.date || '').split('T')[0]) + (a.time || '');
          const bk = ((b.date || '').split('T')[0]) + (b.time || '');
          return ak.localeCompare(bk);
        });

        // Cap at 10 sessions within 2 weeks
        const allNextUp = sorted.filter(s => {
          const sDate = (s.date || '').split('T')[0];
          const sessionDT = TimezoneHelper.buildDateTime(sDate, s.time || '00:00', tz);
          return sessionDT <= twoWeeksOut || s.status === 'in_progress';
        }).slice(0, 10);

        // If nothing in 2 weeks, show next 1 session regardless
        const nextUp = allNextUp.length > 0 ? allNextUp : sorted.slice(0, 1);
        const showAll = nextUpExpanded || nextUp.length <= 2;
        const visible = showAll ? nextUp : nextUp.slice(0, 2);

        const hasBookableRecipient = data?.careRecipients?.some(cr => !cr.consent_status || cr.consent_status === 'verified');
        const showConsentGate = data?.careRecipients?.length > 0 && !hasBookableRecipient;

        if (nextUp.length === 0) return (
          <div style={{ marginBottom: 16, border: '2px solid #e0e0e0', borderRadius: 14, padding: '20px 18px', textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Next Up</div>
            <div style={{ fontSize: 14, color: 'var(--text-tertiary)' }}>No sessions scheduled</div>
            {showConsentGate ? (
              <button onClick={() => { if (onNavigate) { window.__accountTab = 'documents'; window.__documentsTab = 'consent'; onNavigate('account'); } }} style={{
                marginTop: 10, padding: '8px 20px', background: 'var(--border-light)', color: 'var(--text-tertiary)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}>⚠️ Complete consent verification to book</button>
            ) : (
              <button onClick={() => { if (window.__navigateTo) window.__navigateTo('schedule'); }} style={{
                marginTop: 10, padding: '8px 20px', background: 'var(--accent-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}>+ Request Care</button>
            )}
          </div>
        );

        return (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Next Up {nextUp.length > 2 && !showAll ? `(${nextUp.length})` : ''}
              </div>
              {showConsentGate ? (
                <button onClick={() => { if (onNavigate) { window.__accountTab = 'documents'; window.__documentsTab = 'consent'; onNavigate('account'); } }} style={{
                  padding: '4px 12px', background: 'var(--border-light)', color: 'var(--text-tertiary)', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                }}>⚠️ Verify consent first</button>
              ) : (
                <button onClick={() => { if (window.__navigateTo) window.__navigateTo('schedule'); }} style={{
                  padding: '4px 12px', background: 'var(--accent-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                }}>+ Request Care</button>
              )}
            </div>
            <div style={{ position: 'relative' }}>
            {visible.map((s, idx) => {
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
              const minsUntil = (sessionDT.getTime() - nowMs) / 60000;
              const isImminent = !isActive && s.status === 'confirmed' && minsUntil <= 60 && minsUntil > -120; // within 1 hour or started <2hr ago
              const isSoon = !isActive && !isImminent && s.status === 'confirmed' && minsUntil <= 180; // within 3 hours
              const isSeekingCaregiver = !s.caregiverName;
              const isToday = sDate === todayStr && !isActive;

              // Border & background based on urgency
              const borderColor = isActive ? 'var(--color-warning)' : isImminent ? 'var(--accent-color)' : isSoon ? 'var(--accent-color)' : isSeekingCaregiver ? 'var(--accent-color)' : 'var(--role-color)';
              const bgColor = isActive ? 'linear-gradient(135deg, #fffde7 0%, #fff 100%)' : isImminent ? 'linear-gradient(135deg, #fff3e0 0%, #fff 100%)' : 'var(--text-on-primary)';
              const borderWidth = isActive || isImminent ? 3 : 2;

              return (
                <div key={s.id || idx} className={isToday ? 'next-up-today-shimmer' : ''} onClick={() => {
                  if (s.id) setVisitDetailSessionId(s.id);
                }} style={{
                  marginBottom: 8, padding: '14px 16px', cursor: 'pointer', borderRadius: 12,
                  border: `${borderWidth}px solid ${borderColor}`,
                  background: bgColor,
                  boxShadow: isImminent ? '0 2px 12px rgba(232, 114, 74, 0.15)' : isActive ? '0 2px 12px rgba(245, 127, 23, 0.15)' : '0 1px 4px rgba(0,0,0,0.06)',
                  position: isToday ? 'relative' : undefined,
                  overflow: isToday ? 'hidden' : undefined,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      {isActive && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-warning)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>In Progress Now</span>
                          {remainingLabel && (
                            <span style={{
                              fontSize: 11, fontWeight: 600,
                              color: remainingLabel.includes('passed') ? 'var(--color-error)' : 'var(--role-color)',
                              background: remainingLabel.includes('passed') ? 'var(--color-error-bg)' : 'var(--color-success-bg)',
                              padding: '2px 8px', borderRadius: 10,
                            }}>{remainingLabel}</span>
                          )}
                        </div>
                      )}
                      {isImminent && !isActive && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-color)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>{minsUntil <= 0 ? 'Started — awaiting check-in' : minsUntil <= 15 ? 'Check-in window open' : `Starting in ${Math.ceil(minsUntil)} min`}</div>}
                      {isSoon && <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-color)', marginBottom: 2 }}>Coming up in {minsUntil <= 120 ? `${Math.ceil(minsUntil)} min` : `${Math.round(minsUntil / 60)}h`}</div>}
                      <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>
                        {s.recipientName || 'Care Visit'}
                        {s.caregiverName ? ` with ${s.caregiverName}` : ''}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                        {dayLabel}{timeLabel ? ` at ${timeLabel}` : ''}
                        {s.durationHours ? ` \u2022 ${s.durationHours}hr` : ''}
                        {s.serviceType ? ` \u2022 ${formatServiceType(s.serviceType)}` : ''}
                      </div>
                      {isSeekingCaregiver && !s.offeredToCaregiverId && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-color)', marginTop: 4 }}>Seeking caregiver</div>}
                      {s.offeredToCaregiverId && !s.caregiverName && (() => {
                        const exUntil = s.exclusiveUntil ? new Date(s.exclusiveUntil) : null;
                        const exRemain = exUntil ? Math.max(0, Math.floor((exUntil - new Date()) / 60000)) : null;
                        const exExpired = exUntil && exRemain <= 0;
                        return exExpired
                          ? React.createElement('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--accent-color)', marginTop: 4 } }, 'Now open to all caregivers')
                          : React.createElement('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--color-purple-light)', marginTop: 4 } },
                              `\u2728 Sent to ${s.offeredCaregiverName || 'caregiver'}${exRemain !== null ? ` \u00B7 ${exRemain} min exclusive` : ''}`);
                      })()}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                      <span style={{
                        padding: '4px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                        background: isActive ? 'var(--color-warning-bg)' : isImminent ? 'var(--color-warning-bg)' : s.status === 'confirmed' ? 'var(--color-success-bg)' : 'var(--color-warning-bg)',
                        color: isActive ? 'var(--color-warning)' : isImminent ? 'var(--accent-color)' : s.status === 'confirmed' ? 'var(--color-success)' : 'var(--color-warning)',
                        textTransform: 'capitalize', whiteSpace: 'nowrap',
                      }}>{isActive ? 'In Progress' : s.status}</span>
                      {['confirmed', 'pending', 'open', 'requested'].includes(s.status) && (
                        <button onClick={(e) => { e.stopPropagation(); setCancellingId(s.id); }}
                          style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid #e0e0e0', background: 'var(--bg-surface)', color: 'var(--color-error)', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
              {/* Gradient fade + "Show more" when collapsed with 3+ items */}
              {!showAll && nextUp.length > 2 && (
                <div onClick={() => setNextUpExpanded(true)} style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0, height: 64, cursor: 'pointer',
                  background: 'linear-gradient(transparent 0%, rgba(255,255,255,0.85) 40%, #fff 100%)',
                  display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 4,
                }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--role-color)' }}>
                    + {nextUp.length - 2} more &mdash; tap to expand
                  </span>
                </div>
              )}
              {showAll && nextUp.length > 2 && (
                <div onClick={() => setNextUpExpanded(false)} style={{
                  textAlign: 'center', padding: '4px 0', cursor: 'pointer',
                }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Collapse</span>
                </div>
              )}
            </div>
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
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
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
                    border: '2px dashed #e8724a', background: 'var(--bg-warm)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>
                          {s.recipientName || 'Care Visit'}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                          {dayLabel}{timeLabel ? ` at ${timeLabel}` : ''}
                          {s.durationHours ? ` \u2022 ${s.durationHours}hr` : ''}
                          {s.serviceType ? ` \u2022 ${formatServiceType(s.serviceType)}` : ''}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-color)', marginTop: 4 }}>No caregiver yet — waiting for someone to accept</div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                        <span style={{
                          padding: '4px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                          background: 'var(--color-warning-bg)', color: 'var(--color-warning)', textTransform: 'capitalize', whiteSpace: 'nowrap',
                        }}>Open</span>
                        <button onClick={(e) => { e.stopPropagation(); setCancellingId(s.id); }}
                          style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid #e0e0e0', background: 'var(--bg-surface)', color: 'var(--color-error)', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
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
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-color)' }}>
                    + {openReqs.length - 2} more &mdash; tap to expand
                  </span>
                </div>
              )}
              {showAll && openReqs.length > 2 && (
                <div onClick={() => setAwaitingExpanded(false)} style={{
                  textAlign: 'center', padding: '4px 0', cursor: 'pointer',
                }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)' }}>Show less</span>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Time Proposals moved to top — see above Awaiting Caregiver */}

      {stats.unreadNotifications > 0 && (
        <div style={{ background: 'var(--color-warning-bg)', border: '1px solid #ffe0b2', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}
          onClick={() => onNavigate && onNavigate('activity')}>
          <span style={{ fontSize: '20px' }}>🔔</span>
          <span style={{ fontSize: '14px', color: 'var(--color-warning)' }}>{stats.unreadNotifications} unread notification{stats.unreadNotifications > 1 ? 's' : ''}</span>
        </div>
      )}

      {/* Recent Visit Photos */}
      {data.recentPhotos && data.recentPhotos.length > 0 && (
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><span className="card-icon">📸</span>Recent Visit Photos</span>
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{data.recentPhotos.length} photo{data.recentPhotos.length !== 1 ? 's' : ''}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8, padding: '4px 0' }}>
            {data.recentPhotos.map((p, i) => (
              <div key={p.id || i} style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid #eee', cursor: 'pointer' }}
                onClick={() => setLightboxPhoto(p)}>
                <img src={p.photoUrl} alt={p.caption || 'Visit photo'}
                  style={{ width: '100%', height: 90, objectFit: 'cover', display: 'block' }} />
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent, rgba(0,0,0,0.6))', padding: '12px 6px 4px', color: 'var(--text-on-primary)', fontSize: 10, lineHeight: 1.3 }}>
                  {p.caregiverName}
                </div>
              </div>
            ))}
          </div>
          {data.recentPhotos.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6, textAlign: 'center' }}>
              Tap a photo to view full size • Photos are from recent visits
            </div>
          )}
        </div>
      )}

      {/* Photo lightbox */}
      {lightboxPhoto && (
        <div onClick={() => setLightboxPhoto(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 2000, cursor: 'pointer', flexDirection: 'column',
        }}>
          <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '80vh' }}>
            <img src={lightboxPhoto.photoUrl} alt={lightboxPhoto.caption || 'Visit photo'}
              style={{ maxWidth: '90vw', maxHeight: '78vh', borderRadius: 8, objectFit: 'contain' }} />
            <button onClick={(e) => { e.stopPropagation(); setLightboxPhoto(null); }} style={{
              position: 'absolute', top: -12, right: -12, width: 32, height: 32,
              background: 'var(--bg-surface)', color: 'var(--text-primary)', border: 'none', borderRadius: '50%',
              fontSize: 18, cursor: 'pointer', fontWeight: 700,
            }}>×</button>
          </div>
          <div style={{ color: 'var(--text-on-primary)', marginTop: 10, textAlign: 'center', maxWidth: '80vw' }}>
            {lightboxPhoto.caption && <div style={{ fontSize: 14, marginBottom: 4 }}>{lightboxPhoto.caption}</div>}
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {lightboxPhoto.caregiverName} • {lightboxPhoto.sessionDate ? new Date(lightboxPhoto.sessionDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
            </div>
            {lightboxPhoto.sessionId && (
              <div onClick={(e) => { e.stopPropagation(); setLightboxPhoto(null); setVisitDetailSessionId(lightboxPhoto.sessionId); }}
                style={{ fontSize: 12, color: '#4fc3a1', cursor: 'pointer', marginTop: 6, fontWeight: 600 }}>
                View visit details →
              </div>
            )}
          </div>
        </div>
      )}

      {/* Recent Activity — last 5 items */}
      {activity.length > 0 && (
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><span className="card-icon">📢</span>Recent Activity</span>
            <span onClick={() => onNavigate && onNavigate('activity')} style={{ fontSize: 12, color: 'var(--role-color)', cursor: 'pointer', fontWeight: 600 }}>View All →</span>
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
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 13, marginBottom: 2 }}>
                  {a.title}
                  {a.sessionId && <span style={{ fontSize: 11, color: 'var(--role-color)', marginLeft: 6, fontWeight: 500 }}>View →</span>}
                </div>
                {a.message && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.4 }}>{a.message}</div>}
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{formatActivityTime(a.timestamp)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Restore dismissed tiles */}
      {Object.keys(dismissedTiles).length > 0 && (
        <div style={{ textAlign: 'center', marginTop: 12, marginBottom: 12 }}>
          <button onClick={restoreTiles} style={{
            background: 'var(--bg-primary)', border: '1px solid #e0e0e0', color: 'var(--text-secondary)', fontSize: 13,
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
              <span style={{ fontSize: 12, color: 'var(--text-muted)', transition: 'transform 0.2s', display: 'inline-block', transform: analyticsOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
            </div>
            {!analyticsOpen ? (
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>
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
                      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--role-color)' }}>{s.val}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{s.label}</div>
                    </div>
                  ))}
                </div>
                {/* Service breakdown */}
                {serviceBreakdown.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', marginBottom: 6 }}>Service Breakdown</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {serviceBreakdown.map((s, i) => (
                        <span key={i} style={{ padding: '4px 10px', borderRadius: 12, background: 'var(--bg-highlight)', color: 'var(--role-color)', fontSize: 12, fontWeight: 500 }}>
                          {serviceLabels[s.serviceType] || s.serviceType}: {s.count}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {/* Caregiver utilization */}
                {cgStats.length > 0 && (
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', marginBottom: 6 }}>Caregiver Utilization</div>
                    {cgStats.map((cg, i) => {
                      const maxS = Math.max(...cgStats.map(c => c.sessions), 1);
                      return (
                        <div key={i} style={{ marginBottom: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
                            <span style={{ fontWeight: 600 }}>{cg.name}</span>
                            <span style={{ color: 'var(--text-tertiary)' }}>{cg.sessions} sessions · {cg.hours}h{cg.rating > 0 ? ` · ⭐ ${cg.rating}` : ''}</span>
                          </div>
                          <div style={{ height: 6, background: 'var(--badge-muted-bg)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${Math.round(cg.sessions / maxS * 100)}%`, background: 'var(--role-color)', borderRadius: 3 }} />
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
          <div style={{ background: 'var(--bg-surface)', borderRadius: 12, padding: 24, width: 400, maxWidth: '90vw' }}>
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
                  <div style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 12 }}>
                    {s.recipientName} — {s.date ? (parseTimestamp(s.date + 'T12:00:00') || new Date(s.date + 'T12:00:00')).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''} at {s.time}
                  </div>
                  {!hasCaregiver && (
                    <div style={{ padding: '10px 14px', background: 'var(--color-success-bg)', borderRadius: 8, border: '1px solid #c8e6c9', marginBottom: 12, fontSize: 13, color: 'var(--color-success)' }}>
                      No caregiver assigned yet — free to cancel with no fee.
                    </div>
                  )}
                  {isLate && (
                    <div style={{ padding: '10px 14px', background: 'var(--color-warning-bg)', borderRadius: 8, border: '1px solid #ffe082', marginBottom: 12, fontSize: 13, color: 'var(--color-warning)' }}>
                      This is a <strong>late cancellation</strong> (less than 24 hours before the session). You will still be charged for this session.
                    </div>
                  )}
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 4 }}>Reason (optional)</label>
                    <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)}
                      placeholder="Why are you cancelling?"
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, minHeight: 60, resize: 'vertical' }} />
                  </div>
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                    <button onClick={() => { setCancellingId(null); setCancelReason(''); }}
                      style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #ddd', background: 'var(--bg-surface)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                      Keep Session
                    </button>
                    <button onClick={() => handleCancel(cancellingId)} disabled={cancelLoading}
                      style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: cancelLoading ? 'var(--text-muted)' : 'var(--color-error)', color: 'var(--text-on-primary)', fontSize: 13, fontWeight: 600, cursor: cancelLoading ? 'wait' : 'pointer' }}>
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
        <VisitDetailModal sessionId={visitDetailSessionId} role="family" onClose={() => setVisitDetailSessionId(null)} onRefresh={() => fetchDashboard()} />
      )}

      {/* Review Modal — works for both post-session and late-cancel reviews */}
      {reviewSession && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--bg-surface)', borderRadius: 16, padding: 28, width: 420, maxWidth: '90vw' }}>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>{'\u2B50'}</div>
              <h3 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
                How was {reviewSession.caregiverName || reviewSession.caregiver_name || 'your caregiver'}?
              </h3>
              <p style={{ fontSize: 13, color: 'var(--text-tertiary)', margin: 0 }}>
                {(reviewSession.recipientName || reviewSession.recipient_first_name) ? `Care visit with ${reviewSession.recipientName || reviewSession.recipient_first_name}` : 'Your recent care visit'}
                {(reviewSession.date || reviewSession.scheduled_date) ? ` on ${reviewSession.date || reviewSession.scheduled_date}` : ''}
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
              <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--role-color)', fontWeight: 600, marginBottom: 12 }}>
                {reviewRating === 5 ? 'Excellent!' : reviewRating === 4 ? 'Great!' : reviewRating === 3 ? 'Good' : reviewRating === 2 ? 'Fair' : 'Poor'}
              </div>
            )}
            <textarea value={reviewComment} onChange={e => setReviewComment(e.target.value)}
              placeholder="Tell us more about your experience (optional)..."
              style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #e0e0e0', fontSize: 14, minHeight: 80, resize: 'vertical', marginBottom: 16, fontFamily: 'inherit', boxSizing: 'border-box' }} />

            {/* Say Thanks — Tip Section */}
            {reviewRating >= 4 && (
              <div style={{ marginBottom: 16, padding: '14px 16px', background: 'linear-gradient(135deg, #FFF8E1 0%, #FFF3E0 100%)', borderRadius: 12, border: '1px solid #FFE0B2' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 20 }}>{'\uD83D\uDC9B'}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-warning)' }}>Say Thanks with a Tip</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>optional</span>
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  {[500, 1000, 2000].map(cents => (
                    <button key={cents} onClick={() => { setTipAmount(cents); setTipCustom(''); }}
                      style={{
                        flex: 1, padding: '10px 0', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer',
                        border: tipAmount === cents ? '2px solid #E65100' : '1px solid #ddd',
                        background: tipAmount === cents ? 'var(--color-warning-bg)' : 'var(--bg-card)',
                        color: tipAmount === cents ? 'var(--color-warning)' : 'var(--text-primary)',
                      }}>
                      ${cents / 100}
                    </button>
                  ))}
                  <button onClick={() => { setTipAmount('custom'); setTipCustom(''); }}
                    style={{
                      flex: 1, padding: '10px 0', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      border: tipAmount === 'custom' ? '2px solid #E65100' : '1px solid #ddd',
                      background: tipAmount === 'custom' ? 'var(--color-warning-bg)' : 'var(--bg-card)',
                      color: tipAmount === 'custom' ? 'var(--color-warning)' : 'var(--text-primary)',
                    }}>
                    Custom
                  </button>
                </div>
                {tipAmount === 'custom' && (
                  <div style={{ position: 'relative', marginBottom: 10 }}>
                    <span style={{ position: 'absolute', left: 12, top: 10, color: 'var(--text-tertiary)', fontSize: 15, fontWeight: 600 }}>$</span>
                    <input type="number" value={tipCustom} onChange={e => setTipCustom(e.target.value)}
                      placeholder="0.00" min="1" max="500" step="0.01"
                      style={{ width: '100%', padding: '10px 12px 10px 26px', borderRadius: 10, border: '1px solid #ddd', fontSize: 15, fontWeight: 600, boxSizing: 'border-box' }} />
                  </div>
                )}
                {tipAmount > 0 && (
                  <input type="text" value={tipReason} onChange={e => setTipReason(e.target.value)}
                    placeholder={'What made this visit special? (e.g., "So patient with Mom today")'}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #e0e0e0', fontSize: 13, boxSizing: 'border-box' }} />
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setReviewSession(null); setReviewRating(0); setReviewComment(''); setTipAmount(0); setTipCustom(''); setTipReason(''); }}
                style={{ flex: 1, padding: '12px 16px', borderRadius: 10, border: '1px solid #ddd', background: 'var(--bg-surface)', fontSize: 14, fontWeight: 600, cursor: 'pointer', color: 'var(--text-secondary)' }}>
                Not Now
              </button>
              <button onClick={handleReview} disabled={!reviewRating || reviewLoading}
                style={{ flex: 1, padding: '12px 16px', borderRadius: 10, border: 'none', background: (!reviewRating || reviewLoading) ? 'var(--border-light)' : 'var(--role-color)', color: 'var(--text-on-primary)', fontSize: 14, fontWeight: 700, cursor: (!reviewRating || reviewLoading) ? 'default' : 'pointer' }}>
                {reviewLoading ? 'Submitting...' : (tipAmount && tipAmount !== 'custom' ? 'Submit Review & Tip' : (tipAmount === 'custom' && parseFloat(tipCustom) >= 1 ? 'Submit Review & Tip' : 'Submit Review'))}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
