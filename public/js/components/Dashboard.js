// Module-level cache: survives component remounts (nav away and back)
// Shows stale data instantly while fresh fetch runs in background
const _dashCache = { data: null, user: null, careTeams: null, careTasks: null, careEvents: null, ts: 0 };

const Dashboard = window.Dashboard = ({ onNavigate, acceptingInvite }) => {
  const { showToast } = useToast();
  const [data, setData] = useState(_dashCache.data);
  const [loading, setLoading] = useState(!_dashCache.data);
  const [user, setUser] = useState(_dashCache.user);
  const [careTeams, setCareTeams] = useState(_dashCache.careTeams || []);
  const [error, setError] = useState(false);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [notificationsExpanded, setNotificationsExpanded] = useState(false);
  const [showPwaGuide, setShowPwaGuide] = useState(false);
  // Cancel + review state
  const [cancellingId, setCancellingId] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  // v1.105.15 — what this cancellation actually costs, computed server-side by the SAME
  // rule the cancel endpoint applies. Never derived client-side: a second implementation
  // is a second answer, and the failure mode is showing $0 and charging $120.
  const [cancelPreview, setCancelPreview] = useState(null);
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
  // ─── Care Tasks (v1.99.0): today's occurrences, inline in Next Up ───
  const [careTasksToday, setCareTasksToday] = useState(_dashCache.careTasks);
  const [taskSheet, setTaskSheet] = useState(null); // { occ, group } → CareTaskCheckSheet
  const [showTaskCreate, setShowTaskCreate] = useState(false); // kept: CareTeamManage opens this via window.__openTaskCreate
  const [showLogVisit, setShowLogVisit] = useState(null); // v1.105.38 — { recipientId, position }
  const [visitsToday, setVisitsToday] = useState(false);  // suppresses the nudge once you've logged
  // ─── Care Events (v1.100.0): upcoming events, inline in Next Up ───
  const [careEventsUpcoming, setCareEventsUpcoming] = useState(_dashCache.careEvents);
  const [eventSheet, setEventSheet] = useState(null); // ev → CareEventSheet
  const [eventEditing, setEventEditing] = useState(null); // ev → CareEventFormModal
  const [doneTodayExpanded, setDoneTodayExpanded] = useState(false); // "Done earlier today" strip
  // v1.103.0 — occurrence ids the user swiped "Clear" on: fold into the
  // Done-earlier strip right now instead of waiting out the 30-min linger.
  const [clearedNow, setClearedNow] = useState(() => new Set());
  const [finishedExpanded, setFinishedExpanded] = useState(false);
  // Tick counter for live countdown on in-progress and imminent sessions (re-renders every 30-60s)
  const [tick, setTick] = useState(0);
  const [imminentId, setImminentId] = useState(null); // track which session is the hero card
  const [lightboxPhoto, setLightboxPhoto] = useState(null); // full-screen photo viewer
  const [overduePopupDismissedIds, setOverduePopupDismissedIds] = useState({}); // track dismissed overdue popups per session

  // Review gating state
  const [pendingReviews, setPendingReviews] = useState([]);
  const [paidSessionIds, setPaidSessionIds] = useState([]); // sessions just paid via Stripe — hide tile immediately
  const [lateCheckInAlert, setLateCheckInAlert] = useState(null);
  // Inline tip state for auto-pay tiles (keyed by session id)
  const [pendingTips, setPendingTips] = useState({}); // { sessionId: { cents, reason, saving, saved } }
  const [customTipInput, setCustomTipInput] = useState({}); // { sessionId: string }
  // Care team invite banner
  const [pendingInvites, setPendingInvites] = useState([]);
  const [acceptingInviteId, setAcceptingInviteId] = useState(null);
  const [invitesChecked, setInvitesChecked] = useState(false);
  // Time change proposal state
  const [timeChangeModal, setTimeChangeModal] = useState(null); // { sessionId, session } for proposing
  const [timeChangeProposal, setTimeChangeProposal] = useState(null); // fetched pending proposal for acknowledge
  const [tcNewTime, setTcNewTime] = useState('');
  const [tcNewDuration, setTcNewDuration] = useState('');
  const [tcReason, setTcReason] = useState('');
  const [tcLoading, setTcLoading] = useState(false);
  const [tcRespondLoading, setTcRespondLoading] = useState(false);

  // In-app notifications (v1.56.0)
  const [notifications, setNotifications] = useState([]);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);

  // Dismissible dashboard sections — stores timestamp per tile.
  // Tile stays hidden until the next calendar day (resets at midnight).
  const [dismissedTiles, setDismissedTiles] = useState(() => {
    try { return JSON.parse(localStorage.getItem('dash_dismissed') || '{}'); } catch { return {}; }
  });

  // Use local date (not UTC) so dismiss-until-tomorrow works correctly for the user's timezone
  const todayLocal = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // Dismiss a tile for the rest of today (local time)
  const dismissTile = (tileId, _contentFingerprint) => {
    const updated = { ...dismissedTiles, [tileId]: todayLocal() };
    setDismissedTiles(updated);
    localStorage.setItem('dash_dismissed', JSON.stringify(updated));
  };

  // Check if a tile should show: hidden only if dismissed today (local time)
  const isTileDismissed = (tileId, _contentFingerprint) => {
    if (!dismissedTiles[tileId]) return false;
    return dismissedTiles[tileId] === todayLocal();
  };

  const restoreTiles = () => {
    setDismissedTiles({});
    localStorage.removeItem('dash_dismissed');
  };

  const fetchDashboard = async (retryCount = 0) => {
    try {
      const res = await apiFetch('/api/dashboard');
      if (res?.ok) {
        const d = await res.json();
        _dashCache.data = d;
        _dashCache.ts = Date.now();
        setData(d);
        setError(false);
      } else if (retryCount < 2) {
        // Silent retry — Android WebView often fails the first fetch after SW update
        console.warn('Dashboard fetch non-OK, retry', retryCount + 1);
        await new Promise(r => setTimeout(r, 1500));
        return fetchDashboard(retryCount + 1);
      } else {
        setError(true);
      }
    } catch (err) {
      if (retryCount < 2) {
        console.warn('Dashboard fetch error, retry', retryCount + 1, err.message);
        await new Promise(r => setTimeout(r, 1500));
        return fetchDashboard(retryCount + 1);
      }
      console.error('Dashboard fetch error:', err);
      setError(true);
    }
    setLoading(false);
  };

  const fetchCareTasks = async () => {
    try {
      const res = await apiFetch('/api/care-tasks/today');
      if (res?.ok) {
        const d = await res.json();
        _dashCache.careTasks = d;
        setCareTasksToday(d);
      }
    } catch {}
  };

  const fetchCareEvents = async () => {
    try {
      const res = await apiFetch('/api/care-events/upcoming');
      if (res?.ok) {
        const d = await res.json();
        _dashCache.careEvents = d;
        setCareEventsUpcoming(d);
      }
    } catch {}
  };

  // One-tap on the circle = done, recorded as the tapper. The sheet handles
  // "who did it" attribution and notes; both land back here.
  const quickCheckTask = async (occ) => {
    try {
      const res = await apiFetch(`/api/care-tasks/occurrences/${occ.id}/check`, {
        method: 'POST', body: JSON.stringify({ status: 'done' }),
      });
      if (res?.ok) { showToast('Checked off ✓', 'success'); fetchCareTasks(); }
      else { const d = await res.json().catch(() => ({})); showToast(d.error || 'Could not check off', 'error'); fetchCareTasks(); }
    } catch { showToast('Could not check off', 'error'); }
  };
  const undoTask = async (occ) => {
    try {
      const res = await apiFetch(`/api/care-tasks/occurrences/${occ.id}/undo`, { method: 'POST' });
      if (res?.ok) fetchCareTasks();
    } catch {}
  };
  // v1.101.0 — swipe-to-dismiss. Semantics (Pete's call): dismiss = the
  // existing 'skipped' status, on the record and attributed — a reminder can
  // leave the feed fast, but care state never vanishes silently.
  const dismissTask = async (occ) => {
    try {
      const res = await apiFetch(`/api/care-tasks/occurrences/${occ.id}/check`, {
        method: 'POST', body: JSON.stringify({ status: 'skipped' }),
      });
      if (res?.ok) { showToast('Dismissed — marked skipped (undo on the row)', 'success'); fetchCareTasks(); }
      else { const d = await res.json().catch(() => ({})); showToast(d.error || 'Could not dismiss', 'error'); fetchCareTasks(); }
    } catch { showToast('Could not dismiss', 'error'); }
  };
  const removeEvent = async (ev) => {
    try {
      const res = await apiFetch(`/api/care-events/${ev.id}`, { method: 'DELETE' });
      if (res?.ok) { showToast('Event removed', 'success'); fetchCareEvents(); }
      else showToast('Could not remove event', 'error');
    } catch { showToast('Could not remove event', 'error'); }
  };

  const fetchUser = async () => {
    try {
      const res = await apiFetch('/api/auth/me');
      if (res?.ok) { const d = await res.json(); _dashCache.user = d.user; setUser(d.user); }
    } catch {}
  };

  const fetchCareTeams = async () => {
    try {
      const res = await apiFetch('/api/care-teams');
      if (res?.ok) { const d = await res.json(); _dashCache.careTeams = d.careTeams || []; setCareTeams(d.careTeams || []); }
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

  const fetchNotifications = async () => {
    try {
      const res = await apiFetch('/api/push/notifications?limit=10');
      if (res?.ok) {
        const d = await res.json();
        setNotifications(d.notifications || []);
        setUnreadNotifCount(d.unreadCount || 0);
      }
    } catch {}
  };

  const markNotificationsRead = async (ids) => {
    try {
      await apiFetch('/api/push/notifications/mark-read', {
        method: 'POST',
        body: JSON.stringify({ ids: ids || [] }),
      });
      setNotifications(prev => prev.map(n => ids ? (ids.includes(n.id) ? { ...n, read: 1 } : n) : { ...n, read: 1 }));
      setUnreadNotifCount(prev => ids ? Math.max(0, prev - ids.length) : 0);
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

  useEffect(() => {
    if (!cancellingId) { setCancelPreview(null); return; }
    let stale = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/sessions/${cancellingId}/cancel-preview`);
        if (!stale && res?.ok) setCancelPreview(await res.json());
        else if (!stale) setCancelPreview({ unavailable: true });
      } catch { if (!stale) setCancelPreview({ unavailable: true }); }
    })();
    return () => { stale = true; };
  }, [cancellingId]);

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
        setCancelPreview(null);
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
        // v1.57.0 — Review is decoupled from payment. Auto-pay handles charges.
        // Just save the review and show a thank you.
        showToast('Review submitted! Thank you.', 'success');

        setReviewSession(null);
        setReviewRating(0);
        setReviewComment('');
        setTipAmount(0);
        setTipCustom('');
        setTipReason('');
        setTipSent(false);
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
    fetchDashboard(); fetchUser(); fetchCareTeams(); fetchAnalytics(); fetchPendingReviews(); fetchPendingInvites(); fetchNotifications(); fetchCareTasks(); fetchCareEvents();

    // ─── Handle return from Stripe checkout ───
    const hash = window.location.hash;
    if (hash.startsWith('#payment-success')) {
      const params = new URLSearchParams(hash.replace('#payment-success?', ''));
      const sessionId = params.get('session');
      if (sessionId) {
        // Immediately hide the tile so user sees feedback
        setPaidSessionIds(prev => [...prev, sessionId]);
        if (typeof showToast === 'function') showToast('Payment received — thank you!', 'success');
        // Poll for webhook to confirm, then re-fetch to clean up
        let polls = 0;
        const poller = setInterval(async () => {
          polls++;
          await fetchPendingReviews();
          if (polls >= 6) clearInterval(poller); // stop after ~18s
        }, 3000);
      }
      window.history.replaceState({}, '', window.location.pathname);
    } else if (hash.startsWith('#payment-cancel')) {
      if (typeof showToast === 'function') showToast('Payment cancelled. You can try again from the tile above.', 'warning');
      window.history.replaceState({}, '', window.location.pathname);
    }

    // Re-fetch when a new session is created (e.g. from RequestCareModal)
    const onSessionsUpdated = () => { fetchDashboard(); fetchPendingReviews(); fetchNotifications(); };
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
    const c6 = onSocketEvent('time_change_proposed', () => fetchDashboard());
    const c7 = onSocketEvent('time_change_accepted', () => fetchDashboard());
    const c8 = onSocketEvent('time_change_rejected', () => fetchDashboard());
    return () => { c1(); c2(); c3(); c4(); c5(); c6(); c7(); c8(); };
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
      { icon: '📱', label: 'Install InPlace on your phone for notifications', action: () => setShowPwaGuide(true), actionText: 'Set Up', done: !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || !!window.Capacitor?.isNativePlatform?.() || !!localStorage.getItem('pwa_setup_done') },
      // ^ v1.105.49 — WKWebView reports display-mode: browser and exposes no
      //   navigator.standalone, so someone who installed InPlace from the App Store had
      //   "Install InPlace on your phone" pinned in First Steps forever, and tapping it
      //   showed Safari Add-to-Home-Screen instructions for an app they already had.
      //   NotificationPrompt and app.js already append the Capacitor check; this was missed.
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
          <div key={invite.id} style={{ background: 'var(--color-success-bg)', border: '2px solid var(--color-success)', borderRadius: 14, padding: '20px 24px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16, boxShadow: '0 3px 12px rgba(27,107,90,0.18)' }}>
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
                  borderBottom: idx < exploreIdeas.length - 1 ? '1px solid var(--border-light)' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1 }}>
                    <span style={{ fontSize: 22 }}>{idea.icon}</span>
                    <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>{idea.label}</span>
                  </div>
                  <button onClick={idea.action}
                    style={{ padding: '8px 18px', background: 'var(--bg-primary)', color: 'var(--role-color)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, marginLeft: 12 }}>
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
      // v1.105.33 — this one KEEPS the check-in anchor, deliberately, and it is the only
      // place that still does. The countdown labels answer "when was this meant to end"
      // (see below), but this is an alarm: it decides whether to tell a family their
      // caregiver is overdue. A caregiver who arrived 45 minutes late and is still working
      // their booked hours is not overdue, and raising the alarm on them would be a false
      // one — about the worst kind of notification this app can send. Different questions,
      // so different anchors on purpose. Do not "fix" the inconsistency without asking Pete.
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
              border: '2px solid var(--border-color)', borderRadius: 12, fontSize: 14,
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

      {/* v1.105.38 — the nudge, when you're already at the house. Pete: "we're nudging
          here, not nagging" — so it's a dismissible card, never a modal, and it never asks
          the OS for location. If permission isn't already granted it stays silent forever.
          Everything about it degrades to nothing; the "+ Log Visit" pill is unaffected. */}
      {typeof VisitNudgeCard !== 'undefined' && (
        <VisitNudgeCard recipients={data?.careRecipients || []} alreadyLoggedToday={visitsToday}
          onLog={(recipientId, position) => setShowLogVisit({ recipientId, position })} />
      )}

      {/* v1.105.42 — the app-icon badge, itemised. Pete saw 78: "I don't know how to clear
          any of them and I don't know what they are." The second half of that survives
          fixing the count — a badge with no list behind it is a number you can only
          ignore. Reads the same endpoint the icon does, so the two cannot disagree, and
          each row goes where you clear it. Renders nothing when nothing is waiting. */}
      {typeof AttentionCard !== 'undefined' && <AttentionCard onNavigate={onNavigate} />}

      {/* Payment lockout banner — only show for FAILED payments, not pending/processing */}
      {(() => {
        const overdue = pendingReviews.filter(pr => {
          // Only hold for explicitly failed payments — not NULL (awaiting auto-pay) or processing
          if (pr.payment_status !== 'failed') return false;
          if (pr.caregiver_no_show) return false;
          const cost = parseFloat(pr.estimated_cost || 0);
          if (cost <= 0) return false;
          return true;
        });
        if (overdue.length === 0) return null;
        // estimated_cost is caregiver pay; family also pays the 20% platform fee
        const totalOwed = overdue.reduce((sum, pr) => {
          const base = parseFloat(pr.estimated_cost || 0);
          return sum + base + Math.round(base * 0.20 * 100) / 100;
        }, 0);
        return (
          <div style={{ background: '#FDE8E8', border: '2px solid #ef5350', borderRadius: 12, padding: '16px 20px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 22 }}>{'\u{1F6D1}'}</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#c62828' }}>Account on hold — payment overdue</div>
                <div style={{ fontSize: 13, color: '#c62828', marginTop: 2 }}>
                  You have {overdue.length} unpaid session{overdue.length > 1 ? 's' : ''} totaling ${totalOwed.toFixed(2)}.
                  New bookings and upcoming sessions are paused until payment is complete.
                </div>
              </div>
            </div>
            {overdue.map(pr => (
              <div key={pr.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', marginBottom: 4, background: 'rgba(255,255,255,0.6)', borderRadius: 8 }}>
                <span style={{ fontSize: 13, color: '#c62828' }}>{pr.caregiver_name} · {pr.scheduled_date}</span>
                <button onClick={async () => {
                  try {
                    const r = await apiFetch('/api/payments/checkout', { method: 'POST', body: JSON.stringify({ sessionId: pr.id, tipCents: parseInt(pr.pending_tip_cents) || 0 }) });
                    if (r?.ok) { const d = await r.json(); window.location.href = d.checkoutUrl; }
                    else { const e = await r?.json().catch(() => ({})); showToast(e?.error || 'Payment failed', 'error'); }
                  } catch { showToast('Payment failed', 'error'); }
                }} style={{ padding: '6px 14px', background: '#ef5350', color: 'white', border: 'none', borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                  Pay ${(parseFloat(pr.estimated_cost) * 1.20).toFixed(2)}
                </button>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Care team invite banners — show pending invites the user can accept */}
      {pendingInvites.length > 0 && pendingInvites.map(invite => (
        <div key={invite.id} style={{ background: 'var(--color-success-bg)', border: '2px solid var(--color-success)', borderRadius: 12, padding: '16px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 2px 8px rgba(27,107,90,0.15)' }}>
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
        <div style={{ background: 'var(--color-warning-bg)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '14px 18px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
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

      {/* Latest Status — v1.103.0 consolidation (Pete: "one place to
          acknowledge, not five"): this tile no longer counts sessions or
          notifications — Next Up owns the future, the Activity card owns the
          past. It survives only as the new-user "Get started" nudge. */}
      {!isNewUser && (() => {
        if (!(stats.assignedCaregivers === 0 && !parent)) return null;
        const statusIcon = '🔍';
        const statusText = 'Get started by adding a loved one and finding caregivers in your area.';
        const borderColor = 'var(--accent-color)';

        const latestFingerprint = `getstarted-${stats.assignedCaregivers}`;
        if (isTileDismissed('latest', latestFingerprint)) return null;

        const latestClickTarget = 'recipients';
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
            <div style={{ color: 'var(--text-on-primary)', opacity: 0.85, fontSize: 13, marginTop: 4, lineHeight: 1.4 }}>
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
                    background: 'var(--bg-surface)', border: '1px solid var(--border-light)', borderRadius: 12,
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
            }} style={{ flex: 1, padding: '10px 16px', background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>
              Keep Original End Time
            </button>
          </div>
        </div>
      )}

      {/* Session Complete — Auto-pay with optional tip & review */}
      {pendingReviews.filter(pr => !paidSessionIds.includes(pr.id)).length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {pendingReviews.filter(pr => !paidSessionIds.includes(pr.id)).map(pr => {
            const isNoShow = !!pr.caregiver_no_show;
            const isPaid = pr.payment_status === 'paid';
            const cost = parseFloat(pr.estimated_cost || 0);
            const hasCost = cost > 0 && !isNoShow;
            const alreadyReviewed = !!pr.review_completed;
            const firstName = pr.caregiver_name?.split(' ')[0] || 'Caregiver';

            const dueAt = pr.payment_due_at ? new Date(pr.payment_due_at) : null;
            const nowMs = Date.now();
            const msLeft = dueAt ? dueAt.getTime() - nowMs : 0;
            const minsLeft = Math.max(0, Math.ceil(msLeft / 60000));
            const isOverdue = dueAt && msLeft <= 0;

            // Tip state for this session
            const tipState = pendingTips[pr.id] || {};
            const savedTipCents = parseInt(pr.pending_tip_cents) || 0;
            const activeTipCents = tipState.cents != null ? tipState.cents : savedTipCents;
            const costCents = Math.round(cost * 100);

            // Tip presets based on session cost
            const tipPresets = costCents > 0 ? [
              { label: '15%', cents: Math.round(costCents * 0.15) },
              { label: '20%', cents: Math.round(costCents * 0.20) },
              { label: '25%', cents: Math.round(costCents * 0.25) },
            ] : [];

            const saveTip = async (cents, reason) => {
              setPendingTips(prev => ({ ...prev, [pr.id]: { ...prev[pr.id], cents, reason, saving: true } }));
              try {
                await apiFetch(`/api/sessions/${pr.id}/pending-tip`, {
                  method: 'POST',
                  body: JSON.stringify({ tipCents: cents, tipReason: reason || null }),
                });
                setPendingTips(prev => ({ ...prev, [pr.id]: { cents, reason, saving: false, saved: true } }));
                showToast(cents > 0 ? `$${(cents/100).toFixed(2)} tip set for ${firstName}` : 'Tip removed', cents > 0 ? 'success' : 'info');
                // Clear "saved" indicator after 3s
                setTimeout(() => setPendingTips(prev => ({ ...prev, [pr.id]: { ...prev[pr.id], saved: false } })), 3000);
              } catch {
                setPendingTips(prev => ({ ...prev, [pr.id]: { ...prev[pr.id], saving: false } }));
                showToast('Failed to save tip', 'error');
              }
            };

            // No-show tile (unchanged behavior)
            if (isNoShow) {
              return (
                <div key={pr.id} style={{ padding: 14, marginBottom: 8, background: 'var(--bg-error-light)', border: '2px solid #ef5350', borderRadius: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <span style={{ fontSize: 16 }}>{'\u{1F6A8}'}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-error)' }}>
                      No-Show — {firstName} did not check in
                    </span>
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 10px' }}>
                    {pr.service_type || 'Session'} with {pr.recipient_first_name} on {pr.scheduled_date}. No payment was charged.
                  </p>
                  <button onClick={() => { setReviewSession(pr); setReviewRating(0); setReviewComment(''); }} style={{ padding: '8px 20px', background: '#ef5350', color: 'white', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>
                    Leave Review
                  </button>
                </div>
              );
            }

            return (
              <div key={pr.id} style={{ padding: 14, marginBottom: 8, background: isPaid ? 'rgba(76,175,80,0.06)' : 'var(--bg-card)', border: `2px solid ${isPaid ? 'var(--color-success)' : 'var(--role-color)'}`, borderRadius: 12 }}>
                {/* Header: caregiver name + cost */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {isPaid ? '\u2705 ' : '\u{1F4B3} '}{firstName} · {pr.recipient_first_name}
                  </span>
                  {hasCost && (
                    <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>
                      ${cost.toFixed(2)}
                    </span>
                  )}
                </div>

                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 8px' }}>
                  {pr.service_type || 'Session'} with {pr.recipient_first_name} on {pr.scheduled_date} ({pr.duration_hours || '?'}h).
                </p>

                {/* Auto-pay status */}
                {isPaid && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, padding: '6px 10px', background: 'rgba(76,175,80,0.1)', borderRadius: 8 }}>
                    <span style={{ fontSize: 14 }}>{'\u2705'}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-success)' }}>
                      Payment complete{savedTipCents > 0 ? ` — includes $${(savedTipCents/100).toFixed(2)} tip` : ''}
                    </span>
                  </div>
                )}

                {hasCost && !isPaid && dueAt && !isOverdue && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, padding: '6px 10px', background: 'rgba(255,255,255,0.5)', borderRadius: 8 }}>
                    <span style={{ fontSize: 14 }}>{'\u23F0'}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: minsLeft <= 15 ? '#ef5350' : 'var(--text-secondary)' }}>
                      Auto-pay {minsLeft >= 60 ? `in ${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m` : `in ${minsLeft}m`}
                      {activeTipCents > 0 ? ` — $${(activeTipCents/100).toFixed(2)} tip included` : ' — add a tip?'}
                    </span>
                  </div>
                )}

                {hasCost && !isPaid && isOverdue && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, padding: '6px 10px', background: 'rgba(255,152,0,0.1)', borderRadius: 8 }}>
                    <span style={{ fontSize: 14 }}>{'\u{1F4B3}'}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-warning)' }}>
                      Processing payment...
                    </span>
                  </div>
                )}

                {/* Tip buttons — show when unpaid and not overdue */}
                {hasCost && !isPaid && !isOverdue && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                      {tipPresets.map(tp => (
                        <button key={tp.label} onClick={() => saveTip(activeTipCents === tp.cents ? 0 : tp.cents)}
                          disabled={tipState.saving}
                          style={{
                            padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                            border: activeTipCents === tp.cents ? '2px solid var(--role-color)' : '2px solid var(--border-color)',
                            background: activeTipCents === tp.cents ? 'var(--role-color-light)' : 'var(--bg-card)',
                            color: activeTipCents === tp.cents ? 'var(--role-color)' : 'var(--text-secondary)',
                            opacity: tipState.saving ? 0.6 : 1,
                          }}>
                          {tp.label} (${(tp.cents / 100).toFixed(2)})
                        </button>
                      ))}
                      <button onClick={() => {
                        const existing = customTipInput[pr.id];
                        if (existing != null) {
                          // Submit custom tip
                          const cents = Math.round(parseFloat(existing || '0') * 100);
                          if (cents > 0) saveTip(cents);
                          setCustomTipInput(prev => { const n = {...prev}; delete n[pr.id]; return n; });
                        } else {
                          setCustomTipInput(prev => ({ ...prev, [pr.id]: '' }));
                        }
                      }}
                        disabled={tipState.saving}
                        style={{
                          padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                          border: (activeTipCents > 0 && !tipPresets.some(tp => tp.cents === activeTipCents)) ? '2px solid var(--role-color)' : '2px solid var(--border-color)',
                          background: (activeTipCents > 0 && !tipPresets.some(tp => tp.cents === activeTipCents)) ? 'var(--role-color-light)' : 'var(--bg-card)',
                          color: 'var(--text-secondary)',
                        }}>
                        Custom
                      </button>
                      {activeTipCents > 0 && (
                        <button onClick={() => saveTip(0)} disabled={tipState.saving}
                          style={{ padding: '6px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500, cursor: 'pointer', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-tertiary)' }}>
                          Remove tip
                        </button>
                      )}
                    </div>
                    {customTipInput[pr.id] != null && (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>$</span>
                        <input type="number" min="1" max="500" step="0.01" placeholder="0.00"
                          value={customTipInput[pr.id]}
                          onChange={e => setCustomTipInput(prev => ({ ...prev, [pr.id]: e.target.value }))}
                          style={{ width: 80, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-color)', fontSize: 14 }} />
                        <button onClick={() => {
                          const cents = Math.round(parseFloat(customTipInput[pr.id] || '0') * 100);
                          if (cents > 0) saveTip(cents);
                          setCustomTipInput(prev => { const n = {...prev}; delete n[pr.id]; return n; });
                        }}
                          style={{ padding: '6px 14px', borderRadius: 6, background: 'var(--role-color)', color: 'white', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                          Set Tip
                        </button>
                        <button onClick={() => setCustomTipInput(prev => { const n = {...prev}; delete n[pr.id]; return n; })}
                          style={{ padding: '6px 10px', borderRadius: 6, background: 'transparent', color: 'var(--text-tertiary)', border: '1px solid var(--border-color)', fontSize: 12, cursor: 'pointer' }}>
                          Cancel
                        </button>
                      </div>
                    )}
                    {tipState.saved && <span style={{ fontSize: 11, color: 'var(--color-success)', fontWeight: 600 }}>{'\u2713'} Tip saved</span>}
                  </div>
                )}

                {/* Action row: review link (always available if not reviewed) */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {!alreadyReviewed && (
                    <button onClick={() => { setReviewSession(pr); setReviewRating(0); setReviewComment(''); setTipAmount(0); setTipCustom(''); setTipReason(''); }}
                      style={{ padding: '8px 20px', background: isPaid ? 'var(--role-color)' : 'transparent', color: isPaid ? 'white' : 'var(--role-color)', border: isPaid ? 'none' : '2px solid var(--role-color)', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
                      {'\u2B50'} Leave a Review
                    </button>
                  )}
                  {alreadyReviewed && !isPaid && hasCost && (
                    <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{'\u2713'} Reviewed</span>
                  )}
                </div>
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
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontStyle: 'italic', background: 'var(--color-purple-bg)', padding: '6px 10px', borderRadius: 6, marginTop: 4 }}>
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
                        padding: '8px 18px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-surface)',
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

      {/* Imminent Session Hero — within 24h, countdown + shimmer, right under proposals */}
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
          // Show remaining time for in-progress.
          // v1.105.33 — counts down to the SCHEDULED end, not check-in + booked hours.
          // The old anchor made a late arrival silently move the finish line: check in 45
          // minutes late on a 10–12 visit and at 11:45 this read "1h 15m remaining", past
          // the noon the family was told. Pay is still computed server-side from the real
          // check-in and check-out — this number answers "when was this supposed to end",
          // which is the only question anyone is asking it.
          const endMs = sessionDT.getTime() + ((hero.durationHours || 2) * 3600000);
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
        const hasPendingTC = !!hero.pendingTimeChangeId;
        const bgGradient = hasPendingTC
          ? 'linear-gradient(135deg, var(--color-purple-bg) 0%, var(--bg-card) 100%)'
          : isActive
          ? 'linear-gradient(135deg, var(--color-warning-bg) 0%, var(--bg-card) 100%)'
          : msUntil <= 3600000
            ? 'linear-gradient(135deg, var(--bg-accent-light) 0%, var(--bg-card) 100%)'
            : 'linear-gradient(135deg, var(--bg-highlight) 0%, var(--bg-card) 100%)';
        const borderColor = hasPendingTC ? 'var(--color-purple)' : isActive ? 'var(--color-warning)' : msUntil <= 3600000 ? 'var(--accent-color)' : 'var(--role-color)';
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
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: hasPendingTC ? 'var(--color-purple)' : isActive ? 'var(--color-warning)' : 'var(--accent-color)' }}>
                {hasPendingTC ? '⏰ Time Change Proposed' : isActive ? 'In Progress Now' : 'Coming Up'}
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
            <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--text-primary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {hero.recipientName || 'Care Visit'} with {hero.caregiverName}
              {hero.on_my_way_at && !isActive && (
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-success)', background: 'var(--color-success-bg)', padding: '2px 8px', borderRadius: 10, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg>
                  En Route
                </span>
              )}
            </div>
            {hasPendingTC && hero.tcProposedTime ? (
              <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                {dayLabel} at{' '}
                <span style={{ textDecoration: 'line-through', opacity: 0.5 }}>{timeLabel}</span>
                {' '}
                <span style={{ color: 'var(--color-purple)', fontWeight: 700 }}>
                  {TimezoneHelper.formatTime(hero.tcProposedTime)}
                </span>
                {hero.tcProposedDuration && hero.tcProposedDuration !== hero.durationHours ? (
                  <>
                    {' \u2022 '}
                    <span style={{ textDecoration: 'line-through', opacity: 0.5 }}>{hero.durationHours}hr</span>
                    {' '}
                    <span style={{ color: 'var(--color-purple)', fontWeight: 700 }}>{hero.tcProposedDuration}hr</span>
                  </>
                ) : hero.durationHours ? ` \u2022 ${hero.durationHours}hr` : ''}
                {hero.serviceType ? ` \u2022 ${formatServiceType(hero.serviceType)}` : ''}
              </div>
            ) : (
              <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                {dayLabel}{timeLabel ? ` at ${timeLabel}` : ''}
                {hero.durationHours ? ` \u2022 ${hero.durationHours}hr` : ''}
                {hero.serviceType ? ` \u2022 ${formatServiceType(hero.serviceType)}` : ''}
              </div>
            )}
            {/* Tap hint */}
            <div style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', color: borderColor, opacity: 0.3, fontSize: 20 }}>→</div>
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
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginTop: 4 }}>No caregiver yet — waiting for someone to accept</div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                        <span style={{
                          padding: '4px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                          background: 'var(--color-warning-bg)', color: 'var(--color-warning)', textTransform: 'capitalize', whiteSpace: 'nowrap',
                        }}>Open</span>
                        <button onClick={(e) => { e.stopPropagation(); setCancellingId(s.id); }}
                          style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--color-error)', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
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
                  background: 'linear-gradient(transparent 0%, var(--bg-primary) 100%)',
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

      {/* Next Up — up to 10 sessions within 2 weeks, collapsed to 2 cards with fade */}
      {(() => {
        const tz = upcoming[0]?.timezone || TimezoneHelper.DEFAULT_TZ;
        const nowMs = TimezoneHelper.realNowMs();
        const todayStr = TimezoneHelper.getToday(tz);

        const twoWeeksOut = new Date(nowMs + 14 * 24 * 3600000);

        // Sort all upcoming by date+time — exclude unclaimed open requests (shown separately below)
        // Also exclude the imminent hero session (already shown above Betty card)
        const confirmed = upcoming.filter(s => !((['open', 'requested'].includes(s.status)) && !s.caregiverName) && s.id !== imminentId);
        // Care tasks (v1.99.0): today's occurrences slot into the same
        // chronological list as sessions — no digging to complete a task.
        // v1.102.0 (Pete): a checked-off task shouldn't hold the top slot for
        // hours. Done/skipped rows stay inline ~30 min (acknowledgment + easy
        // undo), then fold into the compact "Done earlier today" strip below.
        const DONE_LINGER_MS = 30 * 60000;
        const allTaskItems = (careTasksToday?.groups || []).flatMap(g =>
          g.occurrences.map(o => ({
            __careTask: true, id: `ct-${o.id}`, occ: o, group: g,
            date: o.due_date, time: o.due_time || '', status: 'care_task',
          })));
        const isFolded = (o) => (o.status === 'done' || o.status === 'skipped')
          && (clearedNow.has(o.id) ||
              (o.completed_at && (nowMs - new Date(o.completed_at).getTime() > DONE_LINGER_MS)));
        const careTaskItems = allTaskItems.filter(it => !isFolded(it.occ));
        const doneEarlier = allTaskItems.filter(it => isFolded(it.occ));
        // Care events (v1.100.0): upcoming appointments/outings slot into the
        // same chronological list — situational awareness, no digging.
        // v1.102.0: a timed event that started >1h ago is over — drop it, the
        // feed should always point at the NEXT thing. (All-day events keep
        // their day; starts_at is a true instant as of v1.100.0.)
        const careEventItems = (careEventsUpcoming?.events || [])
          .filter(ev => ev.all_day || !ev.starts_at || nowMs - new Date(ev.starts_at).getTime() < 60 * 60000)
          .map(ev => ({
            __careEvent: true, id: `ce-${ev.id}`, ev,
            date: ev.event_date, time: ev.event_time || '', status: 'care_event',
          }));
        const sorted = [...confirmed, ...careTaskItems, ...careEventItems].sort((a, b) => {
          const ak = ((a.date || '').split('T')[0]) + (a.time || '');
          const bk = ((b.date || '').split('T')[0]) + (b.time || '');
          return ak.localeCompare(bk);
        });

        // Cap at 10 sessions within 2 weeks
        const allNextUp = sorted.filter(s => {
          if (s.__careTask) return true; // today by construction
          if (s.__careEvent) return true; // next 14 days by construction (server-filtered)
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
        // v1.102.0 — compact record of what already happened today, out of
        // the way of what's next. Undo still one tap away.
        const doneStrip = doneEarlier.length > 0 ? (
          <div style={{ marginTop: 4 }}>
            <div onClick={() => setDoneTodayExpanded(!doneTodayExpanded)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '6px 4px' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-success)' }}>✓</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)' }}>
                Done earlier today ({doneEarlier.length}) {doneTodayExpanded ? '▴' : '▾'}
              </span>
            </div>
            {doneTodayExpanded && doneEarlier.map(it => (
              <div key={it.id} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8,
                background: 'var(--bg-card)', border: '1px solid var(--border-light)', marginBottom: 4, opacity: 0.75,
              }}>
                <span style={{ fontSize: 13, color: it.occ.status === 'done' ? 'var(--color-success)' : 'var(--text-muted)' }}>
                  {it.occ.status === 'done' ? '✓' : '—'}
                </span>
                <span style={{ flex: 1, fontSize: 13, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {it.occ.title} · {it.occ.status === 'done' ? 'done' : 'skipped'} · {careTaskDoneBy(it.occ, true)} · for {it.group.recipientFirstName}
                </span>
                <button onClick={() => undoTask(it.occ)}
                  style={{ padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-tertiary)', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
                  Undo
                </button>
              </div>
            ))}
          </div>
        ) : null;

        // v1.99.3 — a second pill in complementary teal, next to the orange "+ Request Care".
        // v1.105.38 — that slot is now "+ Log Visit". Pete: "I'm FAR more likely to log a
        // visit than I am to add a task." The dashboard has one slot's worth of attention
        // and it should go to the thing done most; "+ Task" moved to the care team page,
        // where task management already lives. This is a ranking decision, not a demotion —
        // nothing was removed from the app.
        const showTaskPill = (data?.careRecipients?.length || 0) > 0;
        const taskPillBtn = (pad) => (
          <button onClick={() => setShowLogVisit({ recipientId: null, position: null })} style={{
            padding: pad, background: 'var(--role-color)', color: 'var(--text-on-primary)',
            border: 'none', borderRadius: pad === '8px 20px' ? 8 : 6, fontSize: pad === '8px 20px' ? 13 : 11,
            fontWeight: 700, cursor: 'pointer',
          }}>+ Log Visit</button>
        );

        if (nextUp.length === 0) return (
          <div style={{ marginBottom: 16 }}>
          <div style={{ border: '2px solid var(--border-color)', borderRadius: 14, padding: '20px 18px', textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Next Up</div>
            <div style={{ fontSize: 14, color: 'var(--text-tertiary)' }}>No sessions or tasks scheduled</div>
            {showConsentGate ? (
              <button onClick={() => { if (onNavigate) { window.__accountTab = 'documents'; window.__documentsTab = 'consent'; onNavigate('account'); } }} style={{
                marginTop: 10, padding: '8px 20px', background: 'var(--border-light)', color: 'var(--text-tertiary)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}>⚠️ Complete consent verification to book</button>
            ) : (
              <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button onClick={() => { if (window.__navigateTo) window.__navigateTo('schedule'); }} style={{
                  padding: '8px 20px', background: 'var(--accent-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                }}>+ Request Care</button>
                {showTaskPill && taskPillBtn('8px 20px')}
              </div>
            )}
          </div>
          {doneStrip}
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
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => { if (window.__navigateTo) window.__navigateTo('schedule'); }} style={{
                    padding: '4px 12px', background: 'var(--accent-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  }}>+ Request Care</button>
                  {showTaskPill && taskPillBtn('4px 12px')}
                </div>
              )}
            </div>
            <div style={{ position: 'relative' }}>
            {visible.map((s, idx) => {
              if (s.__careTask) {
                return (
                  <CareTaskNextUpRow key={s.id} occ={s.occ} group={s.group}
                    onQuickCheck={() => quickCheckTask(s.occ)}
                    onUndo={() => undoTask(s.occ)}
                    onDismiss={() => dismissTask(s.occ)}
                    onClear={() => setClearedNow(prev => new Set([...prev, s.occ.id]))}
                    onOpenSheet={() => setTaskSheet({ occ: s.occ, group: s.group })} />
                );
              }
              if (s.__careEvent) {
                return (
                  <CareEventNextUpRow key={s.id} ev={s.ev}
                    onRemove={() => removeEvent(s.ev)}
                    onOpenSheet={() => setEventSheet(s.ev)} />
                );
              }
              const dayLabel = TimezoneHelper.getDateLabel((s.date || '').split('T')[0], tz);
              const timeLabel = TimezoneHelper.formatTime(s.time);
              const isActive = s.status === 'in_progress';

              // Remaining time for in-progress sessions
              let remainingLabel = null;
              if (isActive && s.durationHours) {
                const tz = s.timezone || TimezoneHelper.DEFAULT_TZ;
                // v1.105.33 — the scheduled start, always. Anchoring on checkInTime moved
                // the finish line whenever someone arrived late. See the hero card above.
                const sDate = (s.date || '').split('T')[0];
                const startMs = TimezoneHelper.buildDateTime(sDate, s.time || '00:00', tz).getTime();
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
              const hasPendingTimeChange = !!s.pendingTimeChangeId;

              // Border & background based on urgency — purple for pending time change
              const borderColor = hasPendingTimeChange ? 'var(--color-purple)' : isActive ? 'var(--color-warning)' : isImminent ? 'var(--accent-color)' : isSoon ? 'var(--accent-color)' : isSeekingCaregiver ? 'var(--accent-color)' : 'var(--role-color)';
              const bgColor = hasPendingTimeChange ? 'linear-gradient(135deg, var(--color-purple-bg) 0%, var(--bg-card) 100%)' : isActive ? 'linear-gradient(135deg, var(--color-warning-bg) 0%, var(--bg-card) 100%)' : isImminent ? 'linear-gradient(135deg, var(--bg-accent-light) 0%, var(--bg-card) 100%)' : 'var(--bg-card)';
              const borderWidth = hasPendingTimeChange ? 3 : isActive || isImminent ? 3 : 2;

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
                      {hasPendingTimeChange && (
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-purple)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>
                          ⏰ Time Change Requested
                        </div>
                      )}
                      <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>
                        {s.recipientName || 'Care Visit'}
                        {s.caregiverName ? ` with ${s.caregiverName}` : ''}
                      </div>
                      {hasPendingTimeChange && s.tcProposedTime ? (
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                          {dayLabel} at{' '}
                          <span style={{ textDecoration: 'line-through', opacity: 0.5 }}>{timeLabel}</span>
                          {' '}
                          <span style={{ color: 'var(--color-purple)', fontWeight: 700 }}>{TimezoneHelper.formatTime(s.tcProposedTime)}</span>
                          {s.tcProposedDuration && parseFloat(s.tcProposedDuration) !== parseFloat(s.durationHours) ? (
                            <>{' \u2022 '}<span style={{ textDecoration: 'line-through', opacity: 0.5 }}>{s.durationHours}hr</span>{' '}<span style={{ color: 'var(--color-purple)', fontWeight: 700 }}>{s.tcProposedDuration}hr</span></>
                          ) : s.durationHours ? ` \u2022 ${s.durationHours}hr` : ''}
                          {s.serviceType ? ` \u2022 ${formatServiceType(s.serviceType)}` : ''}
                        </div>
                      ) : (
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                          {dayLabel}{timeLabel ? ` at ${timeLabel}` : ''}
                          {s.durationHours ? ` \u2022 ${s.durationHours}hr` : ''}
                          {s.serviceType ? ` \u2022 ${formatServiceType(s.serviceType)}` : ''}
                        </div>
                      )}
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
                        background: s.status === 'payment_hold' ? '#fff3e0' : isActive ? 'var(--color-warning-bg)' : isImminent ? 'var(--color-warning-bg)' : s.status === 'confirmed' ? 'var(--color-success-bg)' : 'var(--color-warning-bg)',
                        color: s.status === 'payment_hold' ? '#e65100' : isActive ? 'var(--color-warning)' : isImminent ? 'var(--accent-color)' : s.status === 'confirmed' ? 'var(--color-success)' : 'var(--color-warning)',
                        textTransform: 'capitalize', whiteSpace: 'nowrap',
                      }}>{s.status === 'payment_hold' ? 'On Hold' : isActive ? 'In Progress' : s.status}</span>
                      {s.status === 'confirmed' && s.caregiverName && !hasPendingTimeChange && (
                        <button onClick={(e) => { e.stopPropagation(); setTimeChangeModal({ sessionId: s.id, session: s }); setTcNewTime(s.time || ''); setTcNewDuration(String(s.durationHours || 2)); setTcReason(''); }}
                          style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid var(--color-purple)', background: 'var(--color-purple-bg)', color: 'var(--color-purple)', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
                          Change Time
                        </button>
                      )}
                      {hasPendingTimeChange && (
                        <button onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            const r = await apiFetch(`/api/sessions/${s.id}/time-change`);
                            if (r?.ok) { const d = await r.json(); setTimeChangeProposal({ ...d.proposal, session: s }); }
                          } catch {}
                        }}
                          style={{ padding: '3px 8px', borderRadius: 6, border: 'none', background: 'var(--color-purple)', color: 'var(--text-on-primary)', fontSize: 10, fontWeight: 700, cursor: 'pointer', animation: 'pulse 2s infinite' }}>
                          Review Change
                        </button>
                      )}
                      {['confirmed', 'pending', 'open', 'requested'].includes(s.status) && (
                        <button onClick={(e) => { e.stopPropagation(); setCancellingId(s.id); }}
                          style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--color-error)', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
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
                  background: 'linear-gradient(transparent 0%, var(--bg-primary) 100%)',
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
            {doneStrip}
          </div>
        );
      })()}

      {/* Activity — THE one place to see and acknowledge what already happened
          (v1.103.0, Pete: "one place to acknowledge it, not five"). Consolidates
          the Latest-tile counts, the unread-notifications card, the yellow
          unread banner, and the Recent Activity card. Rule going forward:
          Next Up = future (act there); Activity = past (acknowledge HERE);
          nothing appears in both; new features announce with a line here,
          never a new banner. */}
      {(() => {
        const unread = notifications.filter(n => !n.read && n.type !== 'message');
        const typeIcons = {
          care_request_accepted: '✅', message: '\u{1F4AC}', payment: '\u{1F4B3}',
          manual_payment: '\u{1F4B5}', time_proposal: '\u{1F552}', proposal_accepted: '\u{1F91D}',
          proposal_declined: '❌', check_in: '\u{1F3E0}', check_out: '\u{1F44B}',
          missing_address: '\u{1F4CD}', care_task: '✅', care_event: '\u{1F4C5}', general: '\u{1F514}',
        };
        const getIcon = (type) => typeIcons[type] || typeIcons.general;
        const timeAgo = (dateStr) => {
          const diff = Date.now() - new Date(dateStr).getTime();
          const mins = Math.floor(diff / 60000);
          if (mins < 1) return 'Just now';
          if (mins < 60) return `${mins}m ago`;
          const hrs = Math.floor(mins / 60);
          if (hrs < 24) return `${hrs}h ago`;
          return `${Math.floor(hrs / 24)}d ago`;
        };
        // Read tail = recent activity that isn't already shown as an unread
        // notification (same event often lands in both streams).
        const unreadKeys = new Set(unread.map(n => (n.title || '').trim().toLowerCase()));
        const readTail = activity.filter(a => !unreadKeys.has((a.title || '').trim().toLowerCase())).slice(0, 6);
        if (unread.length === 0 && readTail.length === 0) return null;

        const combined = [
          ...unread.map(n => ({ kind: 'unread', it: n, key: `n-${n.id}` })),
          ...readTail.map(a => ({ kind: 'read', it: a, key: `a-${a.id}` })),
        ];
        const expanded = notificationsExpanded;
        const visibleItems = expanded ? combined.slice(0, 12) : combined.slice(0, 3);
        const hasMore = combined.length > 3;

        const openNotif = (n) => {
          const nData = n.data ? (typeof n.data === 'string' ? JSON.parse(n.data) : n.data) : {};
          markNotificationsRead([n.id]);
          if (nData.sessionId && typeof setVisitDetailSessionId === 'function') setVisitDetailSessionId(nData.sessionId);
          else if (['payment', 'manual_payment'].includes(nData.type) && onNavigate) onNavigate('payments');
          else if (window.__handlePushNavigate) window.__handlePushNavigate(nData);
        };

        return (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span>
                <span className="card-icon">📢</span>Activity
                {unread.length > 0 && (
                  <span style={{ background: 'var(--accent-color)', color: 'var(--text-on-primary)', borderRadius: 10, fontSize: 11, fontWeight: 700, padding: '1px 8px', marginLeft: 8, verticalAlign: 1 }}>
                    {unread.length} new
                  </span>
                )}
              </span>
              <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {unread.length > 0 && (
                  <button onClick={() => markNotificationsRead(unread.map(n => n.id))} style={{
                    padding: '4px 10px', background: 'var(--role-color-light)', color: 'var(--role-color)',
                    border: 'none', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  }}>✓ Mark all read</button>
                )}
                <span onClick={() => onNavigate && onNavigate('activity')} style={{ fontSize: 12, color: 'var(--role-color)', cursor: 'pointer', fontWeight: 600 }}>View all →</span>
              </span>
            </div>
            {visibleItems.map(({ kind, it, key }) => kind === 'unread' ? (
              <div key={key} onClick={() => openNotif(it)} style={{ padding: '9px 0', borderBottom: '1px solid var(--border-light)', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent-color)', flexShrink: 0, marginTop: 6 }} />
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{getIcon(it.type)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 650, fontSize: 13.5, color: 'var(--text-primary)' }}>{it.title}</div>
                    {it.body && <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.body}</div>}
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, marginTop: 2 }}>{timeAgo(it.created_at)}</span>
                </div>
              </div>
            ) : (
              <div key={key} onClick={() => it.sessionId && setVisitDetailSessionId(it.sessionId)}
                style={{ padding: '9px 0', borderBottom: '1px solid var(--border-light)', opacity: 0.6, cursor: it.sessionId ? 'pointer' : 'default' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                  <span style={{ width: 7, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--text-primary)' }}>{it.title}</div>
                    {it.message && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.message}</div>}
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, marginTop: 2 }}>{timeAgo(it.timestamp)}</span>
                </div>
              </div>
            ))}
            {hasMore && (
              <div onClick={() => setNotificationsExpanded(!expanded)} style={{ textAlign: 'center', padding: '8px 0 2px', cursor: 'pointer', fontSize: 12, color: 'var(--role-color)', fontWeight: 600 }}>
                {expanded ? 'Show less' : `Show ${Math.min(combined.length, 12) - 3} more`}
              </div>
            )}
          </div>
        );
      })()}

      {/* Recently Completed — recently completed sessions (faded, expandable) */}
      {(() => {
        const completed = data?.recentlyCompleted || [];
        if (completed.length === 0) return null;
        const showAll = finishedExpanded || completed.length <= 2;
        const visible = showAll ? completed.slice(0, 5) : completed.slice(0, 2);
        return (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
              Recently Completed ({completed.length})
            </div>
            <div style={{ position: 'relative' }}>
              {visible.map((s, idx) => {
                const svcLabel = (s.serviceType || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                const fadeOpacity = idx === 0 ? 1.0 : idx === 1 ? 0.85 : 0.7;
                return (
                  <div key={s.id || idx} onClick={() => setVisitDetailSessionId(s.id)}
                    style={{
                      marginBottom: 8, padding: '12px 16px', cursor: 'pointer', borderRadius: 12,
                      border: '2px solid var(--border-teal-light)', background: 'var(--bg-card)',
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
                              <span key={star} style={{ fontSize: 14, color: star <= (s.reviewRating || 0) ? '#f59e0b' : 'var(--border-light)' }}>{'\u2605'}</span>
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
                  background: 'linear-gradient(transparent 0%, var(--bg-primary) 100%)',
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

      {/* Time Proposals moved to top — see above Awaiting Caregiver */}

      {/* (v1.103.0) yellow unread-notifications banner removed — the Activity
          card under Next Up is the one acknowledgment point. */}

      {/* Recent Visit Photos */}
      {data.recentPhotos && data.recentPhotos.length > 0 && (
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><span className="card-icon">📸</span>Recent Visit Photos</span>
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{data.recentPhotos.length} photo{data.recentPhotos.length !== 1 ? 's' : ''}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8, padding: '4px 0' }}>
            {data.recentPhotos.map((p, i) => (
              <div key={p.id || i} style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-color)', cursor: 'pointer' }}
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
                style={{ fontSize: 12, color: 'var(--role-color)', cursor: 'pointer', marginTop: 6, fontWeight: 600 }}>
                View visit details →
              </div>
            )}
          </div>
        </div>
      )}

      {/* (v1.103.0) old bottom Recent Activity card removed — merged into the Activity card under Next Up. */}

      {/* Restore dismissed tiles — only when a tile is actually hidden right now
          (stale entries from previous days linger in localStorage and shouldn't show the pill) */}
      {Object.values(dismissedTiles).some(v => v === todayLocal()) && (
        <div style={{ textAlign: 'center', marginTop: 12, marginBottom: 12 }}>
          <button onClick={restoreTiles} style={{
            background: 'var(--bg-primary)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: 13,
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
                    <div key={i} style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
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
              const sessionDT = TimezoneHelper.buildDateTime((s.date || '').split('T')[0], s.time || '00:00', s.timezone || data?.timezone);
              const hoursAway = (sessionDT.getTime() - TimezoneHelper.realNowMs()) / (1000 * 60 * 60);
              const hasCaregiver = !!s.caregiverName;
              const isLate = hasCaregiver && hoursAway < 24;
              return (
                <div>
                  <div style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 12 }}>
                    {s.recipientName} — {s.date ? TimezoneHelper.parseDate(s.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''} at {s.time}
                  </div>
                  {!hasCaregiver && (
                    <div style={{ padding: '10px 14px', background: 'var(--color-success-bg)', borderRadius: 8, border: '1px solid #c8e6c9', marginBottom: 12, fontSize: 13, color: 'var(--color-success)' }}>
                      No caregiver assigned yet — free to cancel with no fee.
                    </div>
                  )}
                  {/* v1.105.15 — this used to hardcode "You will still be charged for this
                      session", which was wrong twice over: the contract charges a posted
                      cancellation FEE rather than the session price, and no fee was ever
                      actually taken. Now it states whatever the server will really do. */}
                  {isLate && (
                    <div style={{ padding: '10px 14px', background: 'var(--color-warning-bg)', borderRadius: 8, border: '1px solid #ffe082', marginBottom: 12, fontSize: 13, color: 'var(--color-warning)' }}>
                      {cancelPreview && !cancelPreview.unavailable
                        ? cancelPreview.message
                        : cancelPreview?.unavailable
                          ? <span>This is a <strong>late cancellation</strong> (less than 24 hours before the session). We could not check whether a cancellation fee applies.</span>
                          : <span>Checking whether a cancellation fee applies\u2026</span>}
                    </div>
                  )}
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 4 }}>Reason (optional)</label>
                    <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)}
                      placeholder="Why are you cancelling?"
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-color)', fontSize: 13, minHeight: 60, resize: 'vertical' }} />
                  </div>
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                    <button onClick={() => { setCancellingId(null); setCancelReason(''); }}
                      style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-surface)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
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

      {/* ─── Propose Time Change Modal (family proposing) ─── */}
      {timeChangeModal && (() => {
        const s = timeChangeModal.session;
        const formatT = (t) => { if (!t) return ''; const [h,m] = t.split(':').map(Number); return `${h === 0 ? 12 : h > 12 ? h-12 : h}:${String(m||0).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`; };
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div style={{ background: 'var(--bg-surface)', borderRadius: 14, padding: 24, width: 420, maxWidth: '90vw' }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 17, color: 'var(--color-purple)' }}>⏰ Propose Time Change</h3>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 16px' }}>
                {s.recipientName} with {s.caregiverName} — currently {formatT(s.time)} for {s.durationHours}hr
              </p>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>New Start Time</label>
                  <input type="time" value={tcNewTime} onChange={e => setTcNewTime(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-color)', fontSize: 14, boxSizing: 'border-box' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Duration (hours)</label>
                  <select value={tcNewDuration} onChange={e => setTcNewDuration(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-color)', fontSize: 14, boxSizing: 'border-box' }}>
                    {[1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8].map(h => <option key={h} value={h}>{h} hr{h !== 1 ? 's' : ''}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Reason (optional)</label>
                <textarea value={tcReason} onChange={e => setTcReason(e.target.value)} placeholder="Why the time change?"
                  style={{ width: '100%', minHeight: 50, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-color)', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
              </div>
              {/* Disclosure */}
              <div style={{ padding: '8px 10px', background: 'var(--color-purple-bg)', borderRadius: 8, marginBottom: 14, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong style={{ color: 'var(--color-purple)' }}>Time change policy:</strong> The caregiver will be notified and must acknowledge the new time. If this change is within 24 hours of the session, the caregiver may decline and cancel, and may be entitled to partial compensation for time outside the original window.
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setTimeChangeModal(null)}
                  style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button disabled={tcLoading || !tcNewTime || (tcNewTime === s.time && parseFloat(tcNewDuration) === s.durationHours)} onClick={async () => {
                  setTcLoading(true);
                  try {
                    const r = await apiFetch(`/api/sessions/${s.id}/propose-time-change`, {
                      method: 'POST', body: JSON.stringify({ proposedTime: tcNewTime, proposedDuration: parseFloat(tcNewDuration), reason: tcReason || null }),
                    });
                    if (r?.ok) {
                      showToast('Time change proposed — caregiver notified', 'success');
                      setTimeChangeModal(null);
                      fetchDashboard();
                    } else {
                      const d = await r?.json().catch(() => ({}));
                      showToast(d.error || 'Failed to propose time change', 'error');
                    }
                  } catch { showToast('Network error', 'error'); }
                  setTcLoading(false);
                }}
                  style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: tcLoading ? 'var(--text-muted)' : 'var(--color-purple)', color: 'var(--text-on-primary)', fontSize: 13, fontWeight: 600, cursor: tcLoading ? 'wait' : 'pointer' }}>
                  {tcLoading ? 'Sending...' : 'Propose Change'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ─── Acknowledge Time Change Modal (reviewing caregiver's proposal) ─── */}
      {timeChangeProposal && (() => {
        const p = timeChangeProposal;
        const s = p.session;
        const formatT = (t) => { if (!t) return ''; const [h,m] = t.split(':').map(Number); return `${h === 0 ? 12 : h > 12 ? h-12 : h}:${String(m||0).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`; };
        const proposedByCaregiver = p.proposed_by === 'caregiver';
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div style={{ background: 'var(--bg-surface)', borderRadius: 14, padding: 24, width: 420, maxWidth: '90vw' }}>
              <h3 style={{ margin: '0 0 8px', fontSize: 17, color: 'var(--color-purple)' }}>⏰ Time Change Request</h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 14px' }}>
                {p.proposer_name} wants to change the session time:
              </p>
              <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                <div style={{ flex: 1, padding: '10px 14px', background: 'var(--bg-neutral)', borderRadius: 10, textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Current</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{formatT(p.original_time)}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{p.original_duration}hr</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', fontSize: 18, color: 'var(--color-purple)' }}>→</div>
                <div style={{ flex: 1, padding: '10px 14px', background: 'var(--color-purple-bg)', borderRadius: 10, textAlign: 'center', border: '2px solid var(--color-purple)' }}>
                  <div style={{ fontSize: 10, color: 'var(--color-purple)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Proposed</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-purple)' }}>{formatT(p.proposed_time)}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{p.proposed_duration}hr</div>
                </div>
              </div>
              {p.reason && (
                <div style={{ padding: '8px 10px', background: 'var(--bg-neutral)', borderRadius: 8, marginBottom: 12, fontSize: 12, color: 'var(--text-primary)', fontStyle: 'italic' }}>
                  "{p.reason}"
                </div>
              )}
              {/* Policy disclosure for family reviewing caregiver's proposal */}
              {proposedByCaregiver && p.is_within_24h === 1 && (
                <div style={{ padding: '8px 10px', background: 'var(--color-purple-bg)', borderRadius: 8, marginBottom: 14, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  <strong style={{ color: 'var(--color-purple)' }}>Late change policy:</strong> This change was requested within 24 hours of the session. You may cancel at no charge and leave a review if you prefer to decline.
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button onClick={() => setTimeChangeProposal(null)}
                  style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Close
                </button>
                {/* Reject — keep original time */}
                <button disabled={tcRespondLoading} onClick={async () => {
                  setTcRespondLoading(true);
                  try {
                    const r = await apiFetch(`/api/sessions/${s.id}/time-change/${p.id}/respond`, {
                      method: 'PUT', body: JSON.stringify({ action: 'reject' }),
                    });
                    if (r?.ok) { showToast('Time change declined — keeping original time', 'info'); setTimeChangeProposal(null); fetchDashboard(); }
                  } catch {}
                  setTcRespondLoading(false);
                }}
                  style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--color-error)', background: 'var(--bg-surface)', color: 'var(--color-error)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Decline
                </button>
                {/* Cancel with review (only if caregiver proposed within 24h) */}
                {proposedByCaregiver && p.is_within_24h === 1 && (
                  <button disabled={tcRespondLoading} onClick={async () => {
                    setTcRespondLoading(true);
                    try {
                      const r = await apiFetch(`/api/sessions/${s.id}/time-change/${p.id}/respond`, {
                        method: 'PUT', body: JSON.stringify({ action: 'cancel_with_review' }),
                      });
                      if (r?.ok) {
                        const d = await r.json();
                        showToast('Session cancelled — no charge', 'info');
                        setTimeChangeProposal(null);
                        if (d.canReview && d.cancelledCaregiverId) {
                          setReviewSession({ id: s.id, caregiverId: d.cancelledCaregiverId, caregiverName: s.caregiverName, recipientName: s.recipientName, date: s.date });
                        }
                        fetchDashboard();
                      } else {
                        // v1.105.37 — silence here let the family believe the session was
                        // cancelled while it stayed booked and billable.
                        const d = await r?.json().catch(() => ({}));
                        showToast((d && d.error) || 'That did not go through — the session is still booked', 'error');
                      }
                    } catch {
                      showToast('That did not go through — the session is still booked', 'error');
                    }
                    setTcRespondLoading(false);
                  }}
                    style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--color-error)', color: 'var(--text-on-primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    Cancel + Review
                  </button>
                )}
                {/* Accept the new time */}
                <button disabled={tcRespondLoading} onClick={async () => {
                  setTcRespondLoading(true);
                  try {
                    const r = await apiFetch(`/api/sessions/${s.id}/time-change/${p.id}/respond`, {
                      method: 'PUT', body: JSON.stringify({ action: 'accept' }),
                    });
                    if (r?.ok) { showToast('New time accepted!', 'success'); setTimeChangeProposal(null); fetchDashboard(); }
                  } catch {}
                  setTcRespondLoading(false);
                }}
                  style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--color-purple)', color: 'var(--text-on-primary)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  Accept New Time
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Visit Detail Modal */}
      {taskSheet && (
        <CareTaskCheckSheet occ={taskSheet.occ} group={taskSheet.group}
          onClose={() => setTaskSheet(null)} onDone={() => fetchCareTasks()} />
      )}
      {showTaskCreate && (
        <CareTaskQuickCreate recipients={data?.careRecipients || []}
          onClose={() => setShowTaskCreate(false)} onCreated={() => fetchCareTasks()} />
      )}
      {showLogVisit && typeof LogVisitSheet !== 'undefined' && (
        <LogVisitSheet recipients={data?.careRecipients || []}
          presetRecipientId={showLogVisit.recipientId} position={showLogVisit.position}
          onClose={() => setShowLogVisit(null)}
          onSaved={() => { setVisitsToday(true); fetchDashboard(); }} />
      )}
      {eventSheet && (
        <CareEventSheet ev={eventSheet} canManage={!!eventSheet.canManage}
          onClose={() => setEventSheet(null)} onChanged={() => fetchCareEvents()}
          onEdit={() => { setEventEditing(eventSheet); setEventSheet(null); }} />
      )}
      {eventEditing && (
        <CareEventFormModal recipientId={eventEditing.care_recipient_id}
          recipientFirstName={eventEditing.recipientFirstName} timezone={eventEditing.timezone}
          existing={eventEditing}
          onClose={() => setEventEditing(null)} onSaved={() => fetchCareEvents()} />
      )}
      {visitDetailSessionId && (
        <VisitDetailModal sessionId={visitDetailSessionId} role="family" onClose={() => setVisitDetailSessionId(null)} onRefresh={() => fetchDashboard()} onTimeChange={(session, isReview) => {
          if (isReview) {
            // Fetch and show the pending proposal
            apiFetch(`/api/sessions/${session.id}/time-change`).then(r => r?.ok && r.json().then(d => {
              setTimeChangeProposal({ ...d.proposal, session: { id: session.id, recipientName: session.recipient_name, caregiverName: session.caregiver_name, durationHours: session.duration_hours, time: session.scheduled_time, date: session.scheduled_date } });
            })).catch(() => {});
          } else {
            const s = { id: session.id, recipientName: session.recipient_name, caregiverName: session.caregiver_name, durationHours: session.duration_hours, time: session.scheduled_time, date: session.scheduled_date, status: session.status };
            setTimeChangeModal({ sessionId: session.id, session: s });
            setTcNewTime(session.scheduled_time || '');
            setTcNewDuration(String(session.duration_hours || 2));
            setTcReason('');
          }
        }} />
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
                  style={{ fontSize: 36, background: 'none', border: 'none', cursor: 'pointer', color: star <= reviewRating ? '#f59e0b' : 'var(--border-light)', transition: 'transform 0.15s', transform: star <= reviewRating ? 'scale(1.15)' : 'scale(1)' }}>
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
              style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border-color)', fontSize: 14, minHeight: 80, resize: 'vertical', marginBottom: 16, fontFamily: 'inherit', boxSizing: 'border-box' }} />

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setReviewSession(null); setReviewRating(0); setReviewComment(''); setTipAmount(0); setTipCustom(''); setTipReason(''); }}
                style={{ flex: 1, padding: '12px 16px', borderRadius: 10, border: '1px solid var(--border-color)', background: 'var(--bg-surface)', fontSize: 14, fontWeight: 600, cursor: 'pointer', color: 'var(--text-secondary)' }}>
                Not Now
              </button>
              <button onClick={handleReview} disabled={!reviewRating || reviewLoading}
                style={{ flex: 1, padding: '12px 16px', borderRadius: 10, border: 'none', background: (!reviewRating || reviewLoading) ? 'var(--border-light)' : 'var(--role-color)', color: 'var(--text-on-primary)', fontSize: 14, fontWeight: 700, cursor: (!reviewRating || reviewLoading) ? 'default' : 'pointer' }}>
                {reviewLoading ? 'Submitting...' : 'Submit Review'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
