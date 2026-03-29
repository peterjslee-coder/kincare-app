// ─── Admin / Superuser Dashboard ───
// Only visible to users with is_admin = 1. Layered on top of normal family account.
const AdminPanel = window.AdminPanel = ({ currentUser }) => {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState('overview');
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('');
  const [userDemoFilter, setUserDemoFilter] = useState('real');
  const [waitlist, setWaitlist] = useState([]);
  const [waitlistTotal, setWaitlistTotal] = useState(0);
  const [activity, setActivity] = useState(null);
  const [loading, setLoading] = useState(true);
  // Invites tab state
  const [invites, setInvites] = useState([]);
  const [invitesTotal, setInvitesTotal] = useState(0);
  const [inviteSearch, setInviteSearch] = useState('');
  const [searchResult, setSearchResult] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [inviteRole, setInviteRole] = useState('caregiver');
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteMsg, setInviteMsg] = useState(null);
  const [user, setUser] = useState(null);
  // Care team invites state
  const [careTeamInvites, setCareTeamInvites] = useState([]);
  // Feedback tab state
  const [feedbackItems, setFeedbackItems] = useState([]);
  const [newFeedbackCount, setNewFeedbackCount] = useState(0);
  const [feedbackTotal, setFeedbackTotal] = useState(0);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackFilter, setFeedbackFilter] = useState({ category: '', status: '' });
  const [expandedFeedback, setExpandedFeedback] = useState(null);
  const [feedbackEditNotes, setFeedbackEditNotes] = useState('');
  // Background checks
  const [bgCheckCandidates, setBgCheckCandidates] = useState([]);
  const [bgCheckLoading, setBgCheckLoading] = useState(false);
  const [checkrAlertCount, setCheckrAlertCount] = useState(0);
  const [bgCheckActionItems, setBgCheckActionItems] = useState([]);

  const loadBgChecks = async () => {
    setBgCheckLoading(true);
    try {
      const res = await apiFetch('/api/checkr/admin/candidates');
      if (res?.ok) {
        const data = await res.json();
        setBgCheckCandidates(data.candidates || []);
      }
    } catch {}
    setBgCheckLoading(false);
  };

  // Safety flags
  const [safetyFlags, setSafetyFlags] = useState([]);
  const [safetyFlagCount, setSafetyFlagCount] = useState(0);
  const [safetyLoading, setSafetyLoading] = useState(false);
  const [safetyReviewNotes, setSafetyReviewNotes] = useState('');

  const loadSafetyFlags = async () => {
    setSafetyLoading(true);
    try {
      const res = await apiFetch('/api/admin/safety-flags');
      if (res?.ok) {
        const data = await res.json();
        setSafetyFlags(data.flags || []);
        setSafetyFlagCount((data.flags || []).filter(f => f.status === 'pending' || f.status === 'escalated').length);
      }
    } catch {}
    setSafetyLoading(false);
  };

  // Safety flag passkey state
  const [flagPasskeyConfirm, setFlagPasskeyConfirm] = useState(null); // { flagId, status }
  const [flagPasskeyLoading, setFlagPasskeyLoading] = useState(false);
  const [flagPasskeyError, setFlagPasskeyError] = useState(null);
  const [flagPasswordInput, setFlagPasswordInput] = useState('');
  const _hasWebAuthn = !!(window.PublicKeyCredential && window.SimpleWebAuthnBrowser);

  const handleReviewFlag = async (flagId, status) => {
    // Escalate does NOT require passkey — it's raising priority, not closing
    if (status === 'escalated') {
      try {
        const res = await apiFetch(`/api/admin/safety-flags/${flagId}`, {
          method: 'PUT',
          body: JSON.stringify({ status, admin_notes: safetyReviewNotes }),
        });
        if (res?.ok) {
          showToast('Flag escalated', 'success');
          setSafetyReviewNotes('');
          loadSafetyFlags();
          loadAlerts();
        }
      } catch {}
      return;
    }

    // Resolve / Dismiss require verification
    // First click — show confirm state
    if (!flagPasskeyConfirm || flagPasskeyConfirm.flagId !== flagId || flagPasskeyConfirm.status !== status) {
      setFlagPasskeyConfirm({ flagId, status });
      setFlagPasskeyError(null);
      setFlagPasswordInput('');
      return;
    }

    setFlagPasskeyLoading(true);
    setFlagPasskeyError(null);
    try {
      if (_hasWebAuthn) {
        // Passkey path
        const challengeRes = await apiFetch(`/api/admin/safety-flags/${flagId}/challenge`, { method: 'POST' });
        if (!challengeRes?.ok) {
          const err = await challengeRes.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to start passkey challenge');
        }
        const options = await challengeRes.json();
        const challengeKey = options._challengeKey;
        const authResp = await window.SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: options });
        const verifyRes = await apiFetch(`/api/admin/safety-flags/${flagId}/verified`, {
          method: 'PUT',
          body: JSON.stringify({ ...authResp, _challengeKey: challengeKey, status, admin_notes: safetyReviewNotes }),
        });
        if (verifyRes?.ok) {
          showToast(`Flag ${status}`, 'success');
          setSafetyReviewNotes('');
          setFlagPasskeyConfirm(null);
          loadSafetyFlags();
          loadAlerts();
        } else {
          const data = await verifyRes.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to update flag');
        }
      } else {
        // Password fallback
        if (!flagPasswordInput) { setFlagPasskeyError('Enter your password to confirm.'); setFlagPasskeyLoading(false); return; }
        const res = await apiFetch(`/api/admin/safety-flags/${flagId}/verified`, {
          method: 'PUT',
          body: JSON.stringify({ _passwordAuth: true, password: flagPasswordInput, status, admin_notes: safetyReviewNotes }),
        });
        if (res?.ok) {
          showToast(`Flag ${status}`, 'success');
          setSafetyReviewNotes('');
          setFlagPasskeyConfirm(null);
          setFlagPasswordInput('');
          loadSafetyFlags();
          loadAlerts();
        } else {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to update flag');
        }
      }
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        setFlagPasskeyError('Passkey prompt cancelled.');
      } else {
        setFlagPasskeyError(err.message || 'Failed');
      }
      console.error('Safety flag error:', err);
    }
    setFlagPasskeyLoading(false);
  };

  // Blocked emails state
  const [blockedEmails, setBlockedEmails] = useState([]);
  const [blockEmailInput, setBlockEmailInput] = useState('');
  const [blockReasonInput, setBlockReasonInput] = useState('');
  const [blockLoading, setBlockLoading] = useState(false);
  // User delete state
  const [deleteConfirm, setDeleteConfirm] = useState(null); // userId being confirmed
  const [deleteLoading, setDeleteLoading] = useState(false);
  // Nuke state
  const [nukeConfirm, setNukeConfirm] = useState(null); // userId awaiting first-click confirm
  const [nukeLoading, setNukeLoading] = useState(false);
  const [nukeError, setNukeError] = useState(null);
  // Onboarding override state
  const [onboardingModal, setOnboardingModal] = useState(null); // { userId, data }
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  // Help/FAQ management state
  const [helpArticles, setHelpArticles] = useState([]);
  const [helpLoading, setHelpLoading] = useState(false);
  const [helpEditModal, setHelpEditModal] = useState(null); // null or article object (empty for new)
  const [helpForm, setHelpForm] = useState({ category: 'getting-started', question: '', answer: '', link_page: '', link_label: '', role_visibility: null, sort_order: 0 });
  // Onboarding events state
  const [obEvents, setObEvents] = useState(null); // { events, stats, funnel, recentErrors }
  const [obEventsLoading, setObEventsLoading] = useState(false);
  const [obEventFilter, setObEventFilter] = useState('all'); // 'all', 'errors', 'completions'
  const [resetPwLoading, setResetPwLoading] = useState(null); // user id being reset
  const [resetPwMsg, setResetPwMsg] = useState(null); // { id, type, text }
  const [peopleSubTab, setPeopleSubTab] = useState('users'); // 'users', 'waitlist', 'invites'
  // Authorizations tab state
  const [authzList, setAuthzList] = useState([]);
  const [authzLoading, setAuthzLoading] = useState(false);
  const [authzFilter, setAuthzFilter] = useState('');
  const [authzActionLoading, setAuthzActionLoading] = useState(null);
  const [docPreview, setDocPreview] = useState(null); // { fileData, mimeType, fileName }
  const [docPreviewLoading, setDocPreviewLoading] = useState(false);
  const [rejectModal, setRejectModal] = useState(null); // { id, name }
  const [rejectNotes, setRejectNotes] = useState('');
  // Customer service — flagged reviews
  const [csReviews, setCsReviews] = useState([]);
  const [csCounts, setCsCounts] = useState({});
  const [csLoading, setCsLoading] = useState(false);
  const [csFilter, setCsFilter] = useState('pending');
  const [csExpanded, setCsExpanded] = useState(null);
  const [csNotes, setCsNotes] = useState('');
  const [csActionLoading, setCsActionLoading] = useState(null);
  // Security tab state
  const [secDashboard, setSecDashboard] = useState(null);
  const [secAuditLog, setSecAuditLog] = useState([]);
  const [secAuditTotal, setSecAuditTotal] = useState(0);
  const [secLoading, setSecLoading] = useState(false);
  const [secLogFilter, setSecLogFilter] = useState({ severity: 'all', action: 'all' });
  const [secLogPage, setSecLogPage] = useState(0);
  const [secView, setSecView] = useState('dashboard'); // 'dashboard' or 'audit-log'
  // Account approvals state
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [approvalLoading, setApprovalLoading] = useState(null);
  // Consent alerts state (tier3 needing review or flagged responses)
  const [consentAlerts, setConsentAlerts] = useState([]);

  // Sessions tab — no-show cancelled
  const [noShowSessions, setNoShowSessions] = useState([]);
  const [noShowLoading, setNoShowLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(null);

  // Sessions tab — paused caregivers
  const [pausedCaregivers, setPausedCaregivers] = useState([]);
  const [pausedLoading, setPausedLoading] = useState(false);
  const [reinstateLoading, setReinstateLoading] = useState(null);

  // Costs tab
  const [costSummary, setCostSummary] = useState([]);
  const [costEntries, setCostEntries] = useState([]);
  const [costLoading, setCostLoading] = useState(false);
  const [newCost, setNewCost] = useState({ category: '', description: '', amount: '', period_month: new Date().toISOString().substring(0, 7) });
  const [costSaving, setCostSaving] = useState(false);
  const [costRecurring, setCostRecurring] = useState([]);
  const [newRecurring, setNewRecurring] = useState({ category: '', description: '', amount: '', recurrence: 'monthly', start_month: new Date().toISOString().substring(0, 7) });
  const [recurSaving, setRecurSaving] = useState(false);
  const [editingRecurring, setEditingRecurring] = useState(null); // holds id of expense being edited
  const [editRecurringData, setEditRecurringData] = useState({}); // holds edited values for the expense
  const [editingCost, setEditingCost] = useState(null); // holds id of one-time cost being edited
  const [editCostData, setEditCostData] = useState({}); // holds edited values

  const costCategories = ['Claude API', 'Railway', 'Twilio', 'Stripe Fees', 'Stripe Identity', 'Checkr', 'Cloudflare', 'Resend', 'Domain', 'Insurance', 'Google Play', 'Apple Developer', 'Other'];

  const loadCosts = async () => {
    setCostLoading(true);
    try {
      const [summaryRes, entriesRes] = await Promise.all([
        apiFetch('/api/costs/summary?months=6'),
        apiFetch('/api/costs'),
      ]);
      if (summaryRes?.ok) { const d = await summaryRes.json(); setCostSummary(d.summary || []); setCostRecurring(d.recurring || []); }
      if (entriesRes?.ok) { const d = await entriesRes.json(); setCostEntries(d.costs || []); }
    } catch {}
    setCostLoading(false);
  };

  const handleAddRecurring = async () => {
    if (!newRecurring.category || !newRecurring.amount) return;
    setRecurSaving(true);
    try {
      const res = await apiFetch('/api/costs/recurring', {
        method: 'POST',
        body: JSON.stringify(newRecurring),
      });
      if (res?.ok) {
        showToast('Recurring expense added', 'success');
        setNewRecurring({ category: '', description: '', amount: '', recurrence: 'monthly', start_month: new Date().toISOString().substring(0, 7) });
        loadCosts();
      }
    } catch {}
    setRecurSaving(false);
  };

  const handleSaveRecurring = async (id) => {
    if (!editRecurringData.amount || editRecurringData.amount <= 0) {
      showToast('Amount must be greater than 0', 'error');
      return;
    }
    setRecurSaving(true);
    try {
      const res = await apiFetch(`/api/costs/recurring/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          amount: editRecurringData.amount,
          description: editRecurringData.description,
        }),
      });
      if (res?.ok) {
        showToast('Recurring expense updated', 'success');
        setEditingRecurring(null);
        setEditRecurringData({});
        loadCosts();
      }
    } catch {}
    setRecurSaving(false);
  };

  const handleDeactivateRecurring = async (id) => {
    if (!confirm('Deactivate this recurring expense?')) return;
    setRecurSaving(true);
    try {
      const res = await apiFetch(`/api/costs/recurring/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ active: false }),
      });
      if (res?.ok) {
        showToast('Recurring expense deactivated', 'success');
        setEditingRecurring(null);
        setEditRecurringData({});
        loadCosts();
      }
    } catch {}
    setRecurSaving(false);
  };

  const handleAddCost = async () => {
    if (!newCost.category || !newCost.amount || !newCost.period_month) return;
    setCostSaving(true);
    try {
      const res = await apiFetch('/api/costs', {
        method: 'POST',
        body: JSON.stringify(newCost),
      });
      if (res?.ok) {
        showToast('Cost entry added', 'success');
        setNewCost({ category: '', description: '', amount: '', period_month: new Date().toISOString().substring(0, 7) });
        loadCosts();
      }
    } catch {}
    setCostSaving(false);
  };

  const handleDeleteCost = async (id) => {
    if (!confirm('Delete this cost entry?')) return;
    try {
      const res = await apiFetch(`/api/costs/${id}`, { method: 'DELETE' });
      if (res?.ok) loadCosts();
    } catch {}
  };

  const handleSaveCost = async (id) => {
    setCostSaving(true);
    try {
      const res = await apiFetch(`/api/costs/${id}`, {
        method: 'PUT',
        body: JSON.stringify(editCostData),
      });
      if (res?.ok) {
        showToast('Cost entry updated', 'success');
        setEditingCost(null);
        setEditCostData({});
        loadCosts();
      }
    } catch {}
    setCostSaving(false);
  };

  // Admin freeze modal
  const [freezeTarget, setFreezeTarget] = useState(null); // { userId, name }
  const [freezeReason, setFreezeReason] = useState('');
  const [freezeSending, setFreezeSending] = useState(false);

  const handleFreezeCaregiver = async () => {
    if (!freezeReason.trim() || !freezeTarget) return;
    setFreezeSending(true);
    try {
      const res = await apiFetch(`/api/admin/caregivers/${freezeTarget.userId}/freeze`, {
        method: 'POST',
        body: JSON.stringify({ reason: freezeReason.trim() }),
      });
      if (res?.ok) {
        showToast(`${freezeTarget.name}'s account has been frozen`, 'success');
        setFreezeTarget(null);
        setFreezeReason('');
        loadPausedCaregivers();
        if (activeTab === 'people') loadUsers();
      } else {
        const err = await res?.json().catch(() => ({}));
        showToast(err?.error || 'Failed to freeze account', 'error');
      }
    } catch {
      showToast('Failed to freeze account', 'error');
    }
    setFreezeSending(false);
  };

  // BG check rejection modal
  const [rejectBgTarget, setRejectBgTarget] = useState(null); // { userId, name }
  const [rejectBgReason, setRejectBgReason] = useState('');
  const [rejectBgSending, setRejectBgSending] = useState(false);

  const handleRejectBgCheck = async () => {
    if (!rejectBgReason.trim() || !rejectBgTarget) return;
    setRejectBgSending(true);
    try {
      const res = await apiFetch(`/api/admin/users/${rejectBgTarget.userId}/reject-bgcheck`, {
        method: 'PUT',
        body: JSON.stringify({ reason: rejectBgReason.trim() }),
      });
      if (res?.ok) {
        showToast(`${rejectBgTarget.name} rejected — they've been notified`, 'success');
        setRejectBgTarget(null);
        setRejectBgReason('');
        loadBgChecks();
      } else {
        const err = await res?.json().catch(() => ({}));
        showToast(err?.error || 'Failed to reject', 'error');
      }
    } catch {
      showToast('Failed to reject', 'error');
    }
    setRejectBgSending(false);
  };

  // Admin service message modal
  const [adminMsgTarget, setAdminMsgTarget] = useState(null); // { userId, name }
  const [adminMsgText, setAdminMsgText] = useState('');
  const [adminMsgSending, setAdminMsgSending] = useState(false);

  const handleAdminMessage = async () => {
    if (!adminMsgText.trim() || !adminMsgTarget) return;
    setAdminMsgSending(true);
    try {
      const res = await apiFetch(`/api/admin/message/${adminMsgTarget.userId}`, {
        method: 'POST',
        body: JSON.stringify({ message: adminMsgText.trim() }),
      });
      if (res?.ok) {
        showToast(`Message sent to ${adminMsgTarget.name}`, 'success');
        setAdminMsgTarget(null);
        setAdminMsgText('');
      } else {
        const err = await res?.json().catch(() => ({}));
        showToast(err?.error || 'Failed to send message', 'error');
      }
    } catch (err) {
      console.error('Admin message error:', err);
      showToast('Failed to send message — try refreshing the page', 'error');
    } finally {
      setAdminMsgSending(false);
    }
  };

  const loadNoShowSessions = async () => {
    setNoShowLoading(true);
    try {
      const res = await apiFetch('/api/admin/sessions/no-show-cancelled');
      if (res?.ok) { const d = await res.json(); setNoShowSessions(d.sessions || []); }
    } catch {}
    setNoShowLoading(false);
  };

  const handleRestoreSession = async (sessionId) => {
    setRestoreLoading(sessionId);
    try {
      const res = await apiFetch(`/api/admin/sessions/${sessionId}/restore`, { method: 'POST' });
      if (res?.ok) { loadNoShowSessions(); loadPausedCaregivers(); }
    } catch {}
    setRestoreLoading(null);
  };

  const loadPausedCaregivers = async () => {
    setPausedLoading(true);
    try {
      const res = await apiFetch('/api/admin/caregivers/paused');
      if (res?.ok) {
        const data = await res.json();
        setPausedCaregivers(data.paused || []);
      }
    } catch (err) { console.error('Paused caregivers load error:', err); }
    setPausedLoading(false);
  };

  const handleReinstate = async (userId) => {
    if (!confirm('Reinstate this caregiver? They will be set to Available and can accept jobs again.')) return;
    setReinstateLoading(userId);
    try {
      const res = await apiFetch(`/api/admin/caregivers/${userId}/reinstate`, { method: 'POST' });
      if (res?.ok) loadPausedCaregivers();
    } catch {}
    setReinstateLoading(null);
  };

  const fetchPendingApprovals = async () => {
    try {
      const res = await apiFetch('/api/admin/pending-approvals');
      if (res?.ok) { const d = await res.json(); setPendingApprovals(d.pending || []); }
    } catch {}
    // Also fetch consent alerts (tier3 pending review + flagged responses)
    try {
      const res = await apiFetch('/api/admin/consent/pending');
      if (res?.ok) { const d = await res.json(); setConsentAlerts(d.pending || []); }
    } catch {}
  };

  const handleApprove = async (userId) => {
    setApprovalLoading(userId);
    try {
      const res = await apiFetch(`/api/admin/users/${userId}/approve`, { method: 'PUT' });
      if (res?.ok) fetchPendingApprovals();
    } catch {}
    setApprovalLoading(null);
  };

  const handleReject = async (userId) => {
    if (!confirm('Reject and deactivate this account? They will not be able to log in.')) return;
    setApprovalLoading(userId);
    try {
      const res = await apiFetch(`/api/admin/users/${userId}/reject`, {
        method: 'PUT', body: JSON.stringify({ reason: 'Rejected by admin' }),
      });
      if (res?.ok) fetchPendingApprovals();
    } catch {}
    setApprovalLoading(null);
  };

  useEffect(() => {
    loadStats();
    fetchPendingApprovals();
    loadPausedCaregivers();
    loadSafetyFlags();
    // Fetch new feedback count for tab badge
    apiFetch('/api/admin/alerts').then(r => r?.ok ? r.json() : null).then(d => {
      if (d) {
        setNewFeedbackCount(d.newFeedback || 0);
        setSafetyFlagCount(d.safetyFlags || 0);
        setCheckrAlertCount(d.checkrAlerts || 0);
        setBgCheckActionItems(d.bgCheckActionItems || []);
      }
    }).catch(() => {});
    // Fetch current user for settings tab
    apiFetch('/api/auth/me').then(r => r.json()).then(data => setUser(data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (activeTab === 'people') { loadUsers(); loadWaitlist(); loadInvites(); loadCareTeamInvites(); }
    if (activeTab === 'activity') loadActivity();
    if (activeTab === 'feedback') loadFeedback();
    if (activeTab === 'blocked') loadBlockedEmails();
    if (activeTab === 'help') loadHelpArticles();
    if (activeTab === 'onboarding') loadOnboardingEvents();
    if (activeTab === 'authorizations') loadAuthorizations();
    if (activeTab === 'customerservice') loadCsReviews();
    if (activeTab === 'security') { loadSecDashboard(); loadSecAuditLog(); }
    if (activeTab === 'sessions') { loadNoShowSessions(); loadPausedCaregivers(); }
    if (activeTab === 'safety') loadSafetyFlags();
    if (activeTab === 'bgchecks') {
      loadBgChecks();
      // Mark Checkr alerts as read when viewing the tab
      if (checkrAlertCount > 0) {
        apiFetch('/api/admin/alerts/dismiss-checkr', { method: 'POST' }).then(() => setCheckrAlertCount(0)).catch(() => {});
      }
    }
    if (activeTab === 'costs') loadCosts();
  }, [activeTab]);

  // Auto-reload users when filters change
  useEffect(() => {
    if (activeTab === 'people') loadUsers();
  }, [userRoleFilter, userDemoFilter]);

  // Auto-trigger search when switching to people tab with pre-filled email (e.g. from waitlist Invite button)
  useEffect(() => {
    if (activeTab === 'people' && inviteSearch.trim() && !searchResult && !searchLoading) {
      setPeopleSubTab('invites');
      handleSearchEmail();
    }
  }, [activeTab, inviteSearch]);

  const loadStats = async () => {
    try {
      const res = await apiFetch('/api/admin/stats');
      if (res?.ok) setStats(await res.json());
    } catch (err) { console.error('Admin stats error:', err); }
    setLoading(false);
  };

  const loadUsers = async () => {
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (userSearch) params.set('search', userSearch);
      if (userRoleFilter) params.set('role', userRoleFilter);
      if (userDemoFilter) params.set('demo', userDemoFilter);
      const res = await apiFetch(`/api/admin/users?${params}`);
      if (res?.ok) {
        const data = await res.json();
        setUsers(data.users || []);
        setUsersTotal(data.total || 0);
      }
    } catch (err) { console.error('Admin users error:', err); }
  };

  const loadWaitlist = async () => {
    try {
      const res = await apiFetch('/api/admin/waitlist?limit=200');
      if (res?.ok) {
        const data = await res.json();
        setWaitlist(data.entries || []);
        setWaitlistTotal(data.total || 0);
      }
    } catch (err) { console.error('Admin waitlist error:', err); }
  };

  const loadActivity = async () => {
    try {
      const res = await apiFetch('/api/admin/activity');
      if (res?.ok) setActivity(await res.json());
    } catch (err) { console.error('Admin activity error:', err); }
  };

  const loadInvites = async () => {
    try {
      const res = await apiFetch('/api/platform-invites?limit=100');
      if (res?.ok) {
        const data = await res.json();
        setInvites(data.invites || []);
        setInvitesTotal(data.total || 0);
      }
    } catch (err) { console.error('Admin invites error:', err); }
  };

  const loadCareTeamInvites = async () => {
    try {
      const res = await apiFetch('/api/admin/care-team-invites');
      if (res?.ok) {
        const data = await res.json();
        setCareTeamInvites(data.careTeamInvites || []);
      }
    } catch (err) { console.error('Admin care team invites error:', err); }
  };

  const loadFeedback = async () => {
    setFeedbackLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (feedbackFilter.category) params.set('category', feedbackFilter.category);
      if (feedbackFilter.status) params.set('status', feedbackFilter.status);
      const res = await apiFetch(`/api/feedback?${params}`);
      if (res?.ok) {
        const data = await res.json();
        setFeedbackItems(data.feedback || []);
        setFeedbackTotal(data.total || 0);
      }
    } catch (err) { console.error('Feedback load error:', err); }
    setFeedbackLoading(false);
  };

  const updateFeedbackItem = async (id, updates) => {
    try {
      const res = await apiFetch(`/api/feedback/${id}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      if (res?.ok) loadFeedback();
    } catch (err) { console.error('Feedback update error:', err); }
  };

  const loadOnboardingEvents = async () => {
    setObEventsLoading(true);
    try {
      const res = await apiFetch('/api/onboarding-events');
      if (res?.ok) {
        const data = await res.json();
        setObEvents(data);
      }
    } catch (err) { console.error('Onboarding events load error:', err); }
    setObEventsLoading(false);
  };

  const loadAuthorizations = async () => {
    setAuthzLoading(true);
    try {
      const q = authzFilter ? `?status=${authzFilter}` : '';
      const res = await apiFetch(`/api/admin/authorizations${q}`);
      if (res?.ok) {
        const data = await res.json();
        setAuthzList(data.authorizations || []);
      }
    } catch (err) { console.error('Authorizations load error:', err); }
    setAuthzLoading(false);
  };

  const handleAuthzAction = async (id, action, notes) => {
    setAuthzActionLoading(id);
    try {
      const res = await apiFetch(`/api/admin/authorizations/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ action, notes }),
      });
      if (res?.ok) {
        loadAuthorizations();
        // Also refresh consent alerts banner (in case we unpaused bookings)
        try {
          const alertRes = await apiFetch('/api/admin/consent/pending');
          if (alertRes?.ok) { const d = await alertRes.json(); setConsentAlerts(d.pending || []); }
        } catch {}
      }
    } catch (err) { console.error('Authorization action error:', err); }
    setAuthzActionLoading(null);
  };

  // ─── Customer Service: load flagged reviews ───
  const loadCsReviews = async () => {
    setCsLoading(true);
    try {
      const statusParam = csFilter === 'all' ? 'all' : csFilter;
      const res = await apiFetch(`/api/admin/reviews?status=${statusParam}&maxRating=3`);
      if (res?.ok) {
        const data = await res.json();
        setCsReviews(data.reviews || []);
        setCsCounts(data.counts || {});
      }
    } catch (err) { console.error('CS reviews load error:', err); }
    setCsLoading(false);
  };

  useEffect(() => {
    if (activeTab === 'customerservice') loadCsReviews();
  }, [csFilter]);

  const handleCsAction = async (reviewId, newStatus) => {
    setCsActionLoading(reviewId);
    try {
      const res = await apiFetch(`/api/admin/reviews/${reviewId}`, {
        method: 'PUT',
        body: JSON.stringify({ admin_status: newStatus, admin_notes: csNotes || null }),
      });
      if (res?.ok) {
        setCsExpanded(null);
        setCsNotes('');
        loadCsReviews();
      }
    } catch (err) { console.error('CS action error:', err); }
    setCsActionLoading(null);
  };

  // ─── Security: load dashboard and audit log ───
  const loadSecDashboard = async () => {
    setSecLoading(true);
    try {
      const res = await apiFetch('/api/admin/security/dashboard');
      if (res?.ok) setSecDashboard(await res.json());
    } catch (err) { console.error('Security dashboard error:', err); }
    setSecLoading(false);
  };

  const loadSecAuditLog = async (page) => {
    const p = page != null ? page : secLogPage;
    try {
      const params = new URLSearchParams({ limit: '30', offset: String(p * 30) });
      if (secLogFilter.severity !== 'all') params.set('severity', secLogFilter.severity);
      if (secLogFilter.action !== 'all') params.set('action', secLogFilter.action);
      const res = await apiFetch(`/api/admin/security/audit-log?${params}`);
      if (res?.ok) {
        const data = await res.json();
        setSecAuditLog(data.entries || []);
        setSecAuditTotal(data.total || 0);
      }
    } catch (err) { console.error('Audit log error:', err); }
  };

  useEffect(() => {
    if (activeTab === 'security') loadSecAuditLog();
  }, [secLogFilter, secLogPage]);

  const handleDocPreview = async (docId) => {
    setDocPreviewLoading(true);
    try {
      const res = await apiFetch(`/api/admin/documents/${docId}`);
      if (res?.ok) {
        const data = await res.json();
        setDocPreview({ fileData: data.document.file_data, mimeType: data.document.mime_type, fileName: data.document.file_name });
      }
    } catch (err) { console.error('Doc preview error:', err); }
    setDocPreviewLoading(false);
  };

  const handleRejectWithNotes = async () => {
    if (!rejectModal) return;
    await handleAuthzAction(rejectModal.id, 'reject', rejectNotes);
    setRejectModal(null);
    setRejectNotes('');
  };

  const loadBlockedEmails = async () => {
    try {
      const res = await apiFetch('/api/admin/blocked-emails');
      if (res?.ok) {
        const data = await res.json();
        setBlockedEmails(data.blockedEmails || []);
      }
    } catch (err) { console.error('Blocked emails load error:', err); }
  };

  const handleBlockEmail = async () => {
    if (!blockEmailInput.trim()) return;
    setBlockLoading(true);
    try {
      const res = await apiFetch('/api/admin/blocked-emails', {
        method: 'POST',
        body: JSON.stringify({ email: blockEmailInput.trim(), reason: blockReasonInput.trim() || null }),
      });
      if (res?.ok) {
        setBlockEmailInput('');
        setBlockReasonInput('');
        loadBlockedEmails();
      } else {
        const data = await res.json();
        alert(data?.error || 'Failed to block email');
      }
    } catch (err) { console.error('Block email error:', err); }
    setBlockLoading(false);
  };

  const handleUnblockEmail = async (id) => {
    if (!confirm('Unblock this email and allow registration?')) return;
    try {
      const res = await apiFetch(`/api/admin/blocked-emails/${id}`, { method: 'DELETE' });
      if (res?.ok) loadBlockedEmails();
    } catch (err) { console.error('Unblock error:', err); }
  };

  const handleDeleteUser = async (userId, email) => {
    if (deleteConfirm !== userId) {
      setDeleteConfirm(userId);
      return; // First click — show confirm button
    }
    // Second click — actually delete
    setDeleteLoading(true);
    try {
      const res = await apiFetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
      if (res?.ok) {
        loadUsers();
        setDeleteConfirm(null);
      } else {
        const data = await res.json();
        alert(data?.error || 'Failed to delete user');
      }
    } catch (err) { console.error('Delete user error:', err); }
    setDeleteLoading(false);
  };

  // ─── Nuke: passkey-verified permanent deletion ───
  const handleNukeUser = async (userId, email) => {
    if (nukeConfirm !== userId) {
      setNukeConfirm(userId);
      setNukeError(null);
      return; // First click — show confirm
    }
    // Second click — trigger passkey challenge
    setNukeLoading(true);
    setNukeError(null);
    try {
      const SimpleWebAuthnBrowser = window.SimpleWebAuthnBrowser;
      if (!SimpleWebAuthnBrowser) throw new Error('Passkey library not loaded. Refresh the page.');

      // 1. Get challenge from server
      const challengeRes = await apiFetch(`/api/admin/users/${userId}/nuke/challenge`, { method: 'POST' });
      if (!challengeRes?.ok) {
        const err = await challengeRes.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to start passkey challenge');
      }
      const options = await challengeRes.json();
      const challengeKey = options._challengeKey;

      // 2. Trigger biometric/passkey prompt
      const authResp = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: options });

      // 3. Send verified response to nuke endpoint
      const nukeRes = await apiFetch(`/api/admin/users/${userId}/nuke`, {
        method: 'DELETE',
        body: JSON.stringify({ ...authResp, _challengeKey: challengeKey }),
      });
      if (nukeRes?.ok) {
        const data = await nukeRes.json();
        loadUsers();
        setNukeConfirm(null);
        alert(data.message || 'User nuked successfully.');
      } else {
        const data = await nukeRes.json().catch(() => ({}));
        throw new Error(data.error || 'Nuke failed');
      }
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        setNukeError('Passkey prompt cancelled.');
      } else {
        setNukeError(err.message || 'Nuke failed');
      }
      console.error('Nuke error:', err);
    }
    setNukeLoading(false);
  };

  const handleForcePasswordReset = async (userId, email) => {
    setResetPwLoading(userId);
    setResetPwMsg(null);
    try {
      const res = await apiFetch(`/api/admin/users/${userId}/reset-password`, { method: 'POST' });
      const data = await res.json();
      if (res?.ok) {
        setResetPwMsg({ id: userId, type: 'success', text: `Reset email sent to ${email}` });
      } else {
        setResetPwMsg({ id: userId, type: 'error', text: data?.error || 'Failed' });
      }
    } catch (err) {
      setResetPwMsg({ id: userId, type: 'error', text: 'Network error' });
    }
    setResetPwLoading(null);
    setTimeout(() => setResetPwMsg(null), 4000);
  };

  // Onboarding override functions
  const openOnboardingModal = async (userId) => {
    setOnboardingLoading(true);
    try {
      const res = await apiFetch(`/api/admin/users/${userId}/onboarding`);
      if (res?.ok) {
        const data = await res.json();
        setOnboardingModal({ userId, ...data });
      } else {
        alert('Failed to load onboarding status');
      }
    } catch (err) { console.error('Onboarding fetch error:', err); }
    setOnboardingLoading(false);
  };

  const toggleOnboardingFlag = async (flag, currentValue) => {
    if (!onboardingModal) return;
    try {
      const res = await apiFetch(`/api/admin/users/${onboardingModal.userId}/onboarding`, {
        method: 'PUT',
        body: JSON.stringify({ [flag]: !currentValue }),
      });
      if (res?.ok) {
        // Refresh modal data
        openOnboardingModal(onboardingModal.userId);
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data?.error || 'Failed to update flag');
      }
    } catch (err) { console.error('Toggle flag error:', err); }
  };

  // Help/FAQ management functions
  const loadHelpArticles = async () => {
    setHelpLoading(true);
    try {
      const res = await apiFetch('/api/help/admin');
      if (res?.ok) {
        const data = await res.json();
        setHelpArticles(data.articles || []);
      }
    } catch (err) { console.error('Help articles load error:', err); }
    setHelpLoading(false);
  };

  const openHelpEditor = (article = null) => {
    if (article) {
      setHelpForm({
        category: article.category || 'getting-started',
        question: article.question || '',
        answer: article.answer || '',
        link_page: article.link_page || '',
        link_label: article.link_label || '',
        role_visibility: article.role_visibility || null,
        sort_order: article.sort_order || 0,
      });
      setHelpEditModal(article);
    } else {
      setHelpForm({ category: 'getting-started', question: '', answer: '', link_page: '', link_label: '', role_visibility: null, sort_order: 0 });
      setHelpEditModal({ id: null }); // new article
    }
  };

  const saveHelpArticle = async () => {
    if (!helpForm.question.trim() || !helpForm.answer.trim()) {
      alert('Question and answer are required');
      return;
    }
    try {
      const isNew = !helpEditModal?.id;
      const url = isNew ? '/api/help' : `/api/help/${helpEditModal.id}`;
      const method = isNew ? 'POST' : 'PUT';
      const res = await apiFetch(url, {
        method,
        body: JSON.stringify({
          ...helpForm,
          role_visibility: helpForm.role_visibility,
        }),
      });
      if (res?.ok) {
        setHelpEditModal(null);
        loadHelpArticles();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data?.error || 'Failed to save article');
      }
    } catch (err) { console.error('Save help article error:', err); }
  };

  const toggleHelpPublished = async (article) => {
    try {
      const res = await apiFetch(`/api/help/${article.id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_published: !article.is_published }),
      });
      if (res?.ok) loadHelpArticles();
    } catch (err) { console.error('Toggle help published error:', err); }
  };

  const deleteHelpArticle = async (id) => {
    if (!confirm('Unpublish this article?')) return;
    try {
      const res = await apiFetch(`/api/help/${id}`, { method: 'DELETE' });
      if (res?.ok) loadHelpArticles();
    } catch (err) { console.error('Delete help article error:', err); }
  };

  // Create FAQ from feedback item
  const createFaqFromFeedback = (feedbackItem) => {
    setHelpForm({
      category: 'technical',
      question: feedbackItem.description?.slice(0, 200) || '',
      answer: '',
      link_page: '',
      link_label: '',
      role_visibility: null,
      sort_order: 0,
    });
    setHelpEditModal({ id: null, related_feedback_ids: [feedbackItem.id] });
    setActiveTab('help');
  };

  const handleSearchEmail = async () => {
    if (!inviteSearch.trim()) return;
    setSearchLoading(true);
    setSearchResult(null);
    setInviteMsg(null);
    try {
      const res = await apiFetch(`/api/admin/search-email?email=${encodeURIComponent(inviteSearch.trim())}`);
      if (res?.ok) setSearchResult(await res.json());
    } catch (err) { console.error('Search error:', err); }
    setSearchLoading(false);
  };

  const handleSendInvite = async (email, role) => {
    setInviteSending(true);
    setInviteMsg(null);
    try {
      const res = await apiFetch('/api/platform-invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email || inviteSearch.trim(), role: role || inviteRole }),
      });
      const data = await res.json();
      if (res.ok) {
        setInviteMsg({ type: 'success', text: data.message + (data.wasOnWaitlist ? ' (was on waitlist)' : '') });
        loadInvites();
        setSearchResult(null);
        setInviteSearch('');
      } else {
        setInviteMsg({ type: 'error', text: data.error });
      }
    } catch (err) {
      setInviteMsg({ type: 'error', text: 'Failed to send invite' });
    }
    setInviteSending(false);
  };

  const handleResendInvite = async (inviteId) => {
    try {
      const res = await apiFetch(`/api/platform-invites/${inviteId}/resend`, { method: 'POST' });
      if (res?.ok) {
        setInviteMsg({ type: 'success', text: 'Invite resent' });
        loadInvites();
      }
    } catch (err) { setInviteMsg({ type: 'error', text: 'Failed to resend' }); }
  };

  const handleCancelInvite = async (inviteId) => {
    try {
      const res = await apiFetch(`/api/platform-invites/${inviteId}`, { method: 'DELETE' });
      if (res?.ok) {
        setInviteMsg({ type: 'success', text: 'Invite cancelled' });
        loadInvites();
      }
    } catch (err) { setInviteMsg({ type: 'error', text: 'Failed to cancel' }); }
  };

  const exportWaitlistCSV = () => {
    if (!waitlist.length) return;
    const headers = ['Email', 'Name', 'Role', 'Source', 'Date'];
    const rows = waitlist.map(w => [
      w.email, w.name || '', w.role || 'family', w.source || 'splash',
      w.created_at ? (parseTimestamp(w.created_at) || new Date(0)).toLocaleDateString() : '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${(c || '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `inplace-waitlist-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const formatDate = (d) => {
    if (!d) return '—';
    const dt = new Date(d);
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatDateTime = (d) => {
    if (!d) return '—';
    const dt = new Date(d);
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
           dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  if (loading) return <LoadingSpinner text="Loading admin dashboard..." />;

  const tabGroups = [
    { label: 'Core', tabs: [
      { id: 'overview', label: 'Overview', icon: '📊' },
      { id: 'people', label: 'People', icon: '👥', badge: pendingApprovals.length || null },
      { id: 'sessions', label: 'Sessions', icon: '📅', badge: pausedCaregivers.length || null },
    ]},
    { label: 'Trust & Safety', tabs: [
      { id: 'authorizations', label: 'Auth', icon: '\u{1F512}', badge: consentAlerts.length || null },
      { id: 'bgchecks', label: 'BG Checks', icon: '🔍', badge: checkrAlertCount || null },
      { id: 'safety', label: 'Safety Flags', icon: '🚨', badge: safetyFlagCount || null },
      { id: 'customerservice', label: 'Support', icon: '🛎️' },
      { id: 'security', label: 'Security', icon: '🛡️' },
      { id: 'blocked', label: 'Blocked', icon: '🚫' },
    ]},
    { label: 'Content & Config', tabs: [
      { id: 'feedback', label: 'Feedback', icon: '💬', badge: newFeedbackCount || null },
      { id: 'help', label: 'Help/FAQ', icon: '❓' },
      { id: 'financials', label: 'Financials', icon: '💰' },
      { id: 'costs', label: 'Costs', icon: '💵' },
      { id: 'activity', label: 'Activity', icon: '⚡' },
      { id: 'onboarding', label: 'Events', icon: '🚦' },
      { id: 'settings', label: 'Settings', icon: '⚙️' },
    ]},
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', gap: '12px' }}>
        <div style={{ flex: '1 1 0', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
            <span style={{
              background: 'var(--role-color)', color: 'var(--bg-card)', padding: '4px 10px', borderRadius: '6px',
              fontSize: '13px', fontWeight: 700, letterSpacing: '0.5px', flexShrink: 0,
            }}>ADMIN</span>
            <h1 className="greeting" style={{ margin: 0, fontSize: '22px', lineHeight: '1.3' }}>
              Platform Dashboard
            </h1>
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            Manage users, approvals, and platform operations
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>v{window.APP_VERSION || ''}</span>
          </div>
        </div>
        <button onClick={() => { if (window.__navigateTo) window.__navigateTo('account'); }} style={{
          padding: '8px 16px', background: 'var(--bg-surface)', color: 'var(--role-color)', border: '2px solid #1b6b5a',
          borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', flexShrink: 0,
        }}>⚙️ My Account</button>
      </div>

      {/* ── ACTION REQUIRED BANNER — always visible when pending approvals exist ── */}
      {(pendingApprovals.length > 0 || consentAlerts.length > 0 || pausedCaregivers.length > 0 || checkrAlertCount > 0 || bgCheckActionItems.length > 0 || safetyFlagCount > 0) && (
        <div style={{ marginBottom: 16, padding: 16, background: safetyFlagCount > 0 ? 'linear-gradient(135deg, #fce4ec, #ffcdd2)' : 'linear-gradient(135deg, #fff3e0, #ffe0b2)', border: safetyFlagCount > 0 ? '2px solid #c62828' : '2px solid #ff9800', borderRadius: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: safetyFlagCount > 0 ? 'var(--color-error)' : 'var(--color-warning)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            {safetyFlagCount > 0 ? '\u{1F6A8}' : '\u{1F514}'} Action Required
            <span style={{ background: safetyFlagCount > 0 ? 'var(--color-error)' : 'var(--color-warning)', color: 'var(--bg-card)', borderRadius: 20, padding: '2px 10px', fontSize: 13 }}>
              {pendingApprovals.length + consentAlerts.length + pausedCaregivers.length + checkrAlertCount + bgCheckActionItems.length + safetyFlagCount}
            </span>
          </div>

          {/* Account approvals */}
          {pendingApprovals.length > 0 && (
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Account Approvals</div>
          )}
          {pendingApprovals.map(u => (
            <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', marginBottom: 6, background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid #ffe0b2', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ flex: '1 1 200px' }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{u.first_name} {u.last_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{u.email} {'\u00B7'} {u.role} {'\u00B7'} signed up {new Date(u.created_at).toLocaleDateString()}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => handleApprove(u.id)} disabled={approvalLoading === u.id}
                  style={{ padding: '6px 16px', background: 'var(--color-success)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: approvalLoading === u.id ? 0.6 : 1 }}>
                  {approvalLoading === u.id ? '...' : '\u2713 Approve'}
                </button>
                <button onClick={() => handleReject(u.id)} disabled={approvalLoading === u.id}
                  style={{ padding: '6px 12px', background: 'var(--bg-primary)', color: 'var(--color-error)', border: '1px solid #ddd', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                  Reject
                </button>
              </div>
            </div>
          ))}

          {/* Consent / verification alerts */}
          {consentAlerts.length > 0 && (
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 6, marginTop: pendingApprovals.length > 0 ? 12 : 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Care Verification</div>
          )}
          {consentAlerts.map(a => {
            const isFlagged = a.outreach_response === 'did_not_authorize';
            const hasQuestions = a.outreach_response === 'has_questions';
            const isPaused = a.bookings_paused === 1;
            const isAwaitingResponse = !a.outreach_response && a.outreach_sent_to;
            const isPendingAttestation = !a.outreach_response && !a.outreach_sent_to;
            return (
              <div key={a.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', marginBottom: 6, background: 'var(--bg-surface)', borderRadius: 10,
                border: isFlagged || isPaused ? '2px solid #c62828' : isAwaitingResponse ? '1px solid #ffcc80' : '1px solid #ffe0b2', flexWrap: 'wrap', gap: 8,
              }}>
                <div style={{ flex: '1 1 200px' }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: isFlagged || isPaused ? 'var(--color-error)' : 'var(--text-primary)' }}>
                    {isFlagged || isPaused ? '\u{1F6A8} ' : hasQuestions ? '\u2753 ' : isAwaitingResponse ? '\u{1F4E8} ' : '\u{1F4DD} '}
                    {a.first_name} {a.last_name}
                    <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 6 }}>
                      (care recipient)
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                    Family: {a.family_first_name} {a.family_last_name} ({a.family_email})
                  </div>
                  {isPaused && (
                    <div style={{ fontSize: 12, color: 'var(--color-error)', fontWeight: 600, marginTop: 2 }}>
                      {'\u{1F6D1}'} Bookings paused{a.bookings_paused_reason ? ` \u2014 ${a.bookings_paused_reason}` : ''}
                    </div>
                  )}
                  {isFlagged && (
                    <div style={{ fontSize: 12, color: 'var(--color-error)', fontWeight: 600, marginTop: 2 }}>
                      Recipient says they did NOT authorize care{a.outreach_response_notes ? ` \u2014 "${a.outreach_response_notes}"` : ''}
                    </div>
                  )}
                  {hasQuestions && (
                    <div style={{ fontSize: 12, color: 'var(--color-warning)', fontWeight: 600, marginTop: 2 }}>
                      Recipient has questions{a.outreach_response_notes ? ` \u2014 "${a.outreach_response_notes}"` : ''}
                    </div>
                  )}
                  {isAwaitingResponse && !isFlagged && !hasQuestions && (
                    <div style={{ fontSize: 12, color: 'var(--color-warning)', fontWeight: 600, marginTop: 2 }}>
                      {'\u{1F4E7}'} Outreach email sent to {a.outreach_sent_to} \u2014 no response yet
                    </div>
                  )}
                  {isPendingAttestation && (
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', fontStyle: 'italic', marginTop: 2 }}>
                      Attestation submitted, needs review
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {isPaused && (
                    <button onClick={() => {
                      if (!confirm(`Unpause bookings for ${a.first_name} ${a.last_name}? This will restore their account.`)) return;
                      handleAuthzAction(a.id, 'unpause');
                    }} disabled={authzActionLoading === a.id}
                      style={{ padding: '6px 14px', background: 'var(--role-color)', color: 'var(--bg-card)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: authzActionLoading === a.id ? 0.6 : 1 }}>
                      {authzActionLoading === a.id ? '...' : '\u2705 Restore'}
                    </button>
                  )}
                  <button onClick={() => { setActiveTab('authorizations'); }}
                    style={{ padding: '6px 14px', background: isPaused || isFlagged ? 'var(--color-error)' : 'var(--accent-color)', color: 'var(--bg-card)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                    Details
                  </button>
                </div>
              </div>
            );
          })}

          {/* Paused caregivers */}
          {pausedCaregivers.length > 0 && (
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 6, marginTop: (pendingApprovals.length > 0 || consentAlerts.length > 0) ? 12 : 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Paused Caregivers</div>
          )}
          {pausedCaregivers.map(cg => (
            <div key={cg.user_id} style={{
              padding: '12px 14px', marginBottom: 6, background: 'var(--bg-surface)', borderRadius: 10,
              border: '2px solid #dc2626',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ flex: '1 1 200px' }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-error)' }}>
                    {'\u{1F6D1}'} {cg.first_name} {cg.last_name}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{cg.email}{cg.phone ? ` \u00B7 ${cg.phone}` : ''}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-error)', fontWeight: 600, marginTop: 2 }}>
                    {cg.account_paused_reason || 'Account paused'}
                  </div>
                  {cg.no_show_session_id && (
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                      Missed session: {cg.no_show_recipient_name || 'Unknown'} on {cg.no_show_date}{cg.no_show_time ? ` at ${cg.no_show_time}` : ''}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {cg.completed_count || 0} completed sessions \u00B7 {cg.no_show_count || 0} no-shows \u00B7 Rating: {cg.rating_avg ? Number(cg.rating_avg).toFixed(1) : 'n/a'}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                <button onClick={() => { setAdminMsgTarget({ userId: cg.user_id, name: cg.first_name + ' ' + cg.last_name }); setAdminMsgText(''); }}
                  style={{ padding: '6px 14px', background: 'var(--role-color)', color: 'var(--bg-card)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                  {'\u{1F4AC}'} Message {cg.first_name}
                </button>
                <button onClick={() => handleReinstate(cg.user_id)} disabled={reinstateLoading === cg.user_id}
                  style={{ padding: '6px 14px', background: 'var(--bg-surface)', color: 'var(--role-color)', border: '2px solid #1b6b5a', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: reinstateLoading === cg.user_id ? 0.6 : 1 }}>
                  {reinstateLoading === cg.user_id ? '...' : '\u2705 Reinstate'}
                </button>
                {cg.phone && (
                  <a href={`tel:${cg.phone}`}
                    style={{ padding: '6px 14px', background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid #ddd', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                    {'\u{1F4DE}'} Call
                  </a>
                )}
              </div>
            </div>
          ))}

          {/* Background check updates — individual cards like safety flags */}
          {(bgCheckActionItems.length > 0 || checkrAlertCount > 0) && (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 6, marginTop: (pendingApprovals.length > 0 || consentAlerts.length > 0 || pausedCaregivers.length > 0) ? 12 : 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Background Checks</div>
              {bgCheckActionItems.map(item => {
                const statusLabel = (item.checkrStatus || '').replace(/_/g, ' ');
                const isConsider = item.checkrStatus === 'consider';
                const isRejected = item.checkrStatus === 'did_not_pass' || item.checkrStatus === 'suspended';
                return (
                <div key={item.userId} style={{
                  padding: '12px 14px', marginBottom: 6, background: isRejected ? '#fef3f3' : '#f0f4ff', borderRadius: 10,
                  border: isRejected ? '2px solid #c62828' : '2px solid #5c6bc0',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ flex: '1 1 200px' }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: isRejected ? 'var(--color-error)' : '#283593' }}>
                        {isRejected ? '\u{1F6D1}' : '\u{1F50D}'}{' '}
                        {item.name}
                        <span style={{ marginLeft: 6, padding: '1px 8px', background: isRejected ? 'var(--color-error)' : isConsider ? '#ef6c00' : 'var(--color-indigo)', color: 'var(--bg-card)', borderRadius: 4, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>{statusLabel}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{item.email}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{item.updatedAt ? new Date(item.updatedAt).toLocaleString() : ''}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      {isConsider && (
                        <button onClick={async (e) => {
                          e.stopPropagation();
                          if (!confirm('Approve ' + item.name + ' despite "consider" status?')) return;
                          try {
                            const r = await fetch('/api/admin/caregivers/' + item.userId + '/approve-bgcheck', {
                              method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': window.__ADMIN_API_KEY || '' }
                            });
                            if (r.ok) { alert(item.name + ' approved!'); loadAlerts(); } else { const d = await r.json(); alert(d.error || 'Failed'); }
                          } catch (err) { alert('Error: ' + err.message); }
                        }}
                          style={{ padding: '6px 12px', background: 'var(--color-success)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                          {'\u2713'} Approve
                        </button>
                      )}
                      <button onClick={async (e) => {
                        e.stopPropagation();
                        const reason = prompt('Rejection reason for ' + item.name + ':');
                        if (!reason) return;
                        try {
                          const r = await fetch('/api/admin/users/' + item.userId + '/reject-bgcheck', {
                            method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-api-key': window.__ADMIN_API_KEY || '' },
                            body: JSON.stringify({ reason })
                          });
                          if (r.ok) { alert(item.name + ' rejected.'); loadAlerts(); } else { const d = await r.json(); alert(d.error || 'Failed'); }
                        } catch (err) { alert('Error: ' + err.message); }
                      }}
                        style={{ padding: '6px 12px', background: isRejected ? 'var(--color-error)' : 'var(--bg-primary)', color: isRejected ? 'var(--bg-card)' : 'var(--text-tertiary)', border: isRejected ? 'none' : '1px solid #ddd', borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                        {'\u2717'} Reject
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); setAdminMsgTarget({ userId: item.userId, name: item.name }); setAdminMsgText(''); }}
                        style={{ padding: '6px 12px', background: 'var(--bg-primary)', color: 'var(--role-color)', border: '1px solid #ddd', borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                        {'\u{1F4AC}'} Message
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); setActiveTab('bgchecks'); loadBgChecks(); }}
                        style={{ padding: '6px 12px', background: 'var(--bg-primary)', color: 'var(--color-indigo)', border: '1px solid #ddd', borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                        View Details
                      </button>
                    </div>
                  </div>
                </div>
                );
              })}
              {/* Generic count for any other checkr alerts not in the action items */}
              {checkrAlertCount > bgCheckActionItems.length && (
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid #ffe0b2', cursor: 'pointer',
                }} onClick={() => { setActiveTab('bgchecks'); loadBgChecks(); }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-info)' }}>
                      {'\u{1F50D}'} {checkrAlertCount - bgCheckActionItems.length} more background check update{(checkrAlertCount - bgCheckActionItems.length) !== 1 ? 's' : ''}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Click to review in BG Checks tab</div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Safety flags */}
          {safetyFlagCount > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 6, marginTop: (pendingApprovals.length > 0 || consentAlerts.length > 0 || pausedCaregivers.length > 0 || checkrAlertCount > 0) ? 12 : 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Safety Flags</div>
              {safetyFlags.filter(f => f.status === 'pending' || f.status === 'escalated').map(flag => {
                const isSevere = flag.flag_type?.includes('abuse') || flag.flag_type?.includes('neglect') || flag.flag_type?.includes('threat');
                const isEscalated = flag.status === 'escalated';
                return (
                <div key={flag.id} style={{
                  padding: '12px 14px', marginBottom: 6, background: isEscalated ? 'var(--bg-error-light)' : 'var(--bg-card)', borderRadius: 10,
                  border: isEscalated ? '2px solid #b71c1c' : isSevere ? '2px solid #c62828' : '1px solid #ffcc80',
                  cursor: 'pointer',
                }} onClick={() => { setActiveTab('safety'); }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ flex: '1 1 200px' }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: isSevere || isEscalated ? 'var(--color-error)' : 'var(--color-warning)' }}>
                        {isEscalated ? '\u{1F6A8}\u{1F6A8}' : isSevere ? '\u{1F6A8}' : '\u26A0\uFE0F'}{' '}
                        {flag.first_name} {flag.last_name}
                        <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 6 }}>
                          ({flag.flag_type?.replace(/_/g, ' ') || 'flagged'})
                        </span>
                        {isEscalated && (
                          <span style={{ marginLeft: 6, padding: '1px 8px', background: 'var(--color-error)', color: 'var(--bg-card)', borderRadius: 4, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Escalated</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                        {'\u201C'}{(flag.user_message || '').substring(0, 120)}{(flag.user_message || '').length > 120 ? '...' : ''}{'\u201D'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{flag.email} {'\u00B7'} {new Date(flag.created_at).toLocaleString()}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      {!isEscalated && (
                        <button onClick={(e) => { e.stopPropagation(); handleReviewFlag(flag.id, 'escalated'); }}
                          style={{ padding: '6px 12px', background: 'var(--color-error)', color: 'var(--bg-card)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                          {'\u{1F6A8}'} Escalate
                        </button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); handleReviewFlag(flag.id, 'resolved'); }}
                        disabled={flagPasskeyLoading}
                        style={{ padding: '6px 12px', background: (flagPasskeyConfirm?.flagId === flag.id && flagPasskeyConfirm?.status === 'resolved') ? 'var(--color-success)' : 'var(--color-success)', color: 'var(--bg-card)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: 'pointer', opacity: flagPasskeyLoading ? 0.6 : 1 }}>
                        {(flagPasskeyConfirm?.flagId === flag.id && flagPasskeyConfirm?.status === 'resolved')
                          ? (flagPasskeyLoading ? '\u{1F510} Verifying...' : '\u{1F510} Tap passkey to resolve')
                          : '\u2713 Resolve'}
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); handleReviewFlag(flag.id, 'dismissed'); }}
                        disabled={flagPasskeyLoading}
                        style={{ padding: '6px 12px', background: (flagPasskeyConfirm?.flagId === flag.id && flagPasskeyConfirm?.status === 'dismissed') ? 'var(--border-light)' : 'var(--bg-primary)', color: 'var(--text-tertiary)', border: '1px solid #ddd', borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: 'pointer', opacity: flagPasskeyLoading ? 0.6 : 1 }}>
                        {(flagPasskeyConfirm?.flagId === flag.id && flagPasskeyConfirm?.status === 'dismissed')
                          ? (flagPasskeyLoading ? '\u{1F510} Verifying...' : '\u{1F510} Tap passkey to dismiss')
                          : 'Dismiss'}
                      </button>
                    </div>
                  </div>
                  {flagPasskeyError && flagPasskeyConfirm?.flagId === flag.id && (
                    <div style={{ fontSize: 11, color: 'var(--color-error)', marginTop: 4, textAlign: 'right' }}>{flagPasskeyError}</div>
                  )}
                  {/* Conversation participants — message anyone involved */}
                  {flag.participants && flag.participants.length > 0 && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #eee', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.3px' }}>Message:</span>
                      {flag.participants.map(p => (
                        <button key={p.user_id} onClick={(e) => {
                          e.stopPropagation();
                          setAdminMsgTarget({ userId: p.user_id, name: `${p.first_name} ${p.last_name}` });
                          setAdminMsgText('');
                        }}
                          style={{ padding: '4px 10px', background: 'var(--bg-primary)', color: 'var(--role-color)', border: '1px solid #ccc', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {'\u{1F4AC}'} {p.first_name} {p.last_name}
                          <span style={{ fontWeight: 400, fontSize: 10, color: 'var(--text-tertiary)' }}>({p.role})</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* ── UNIVERSAL SEARCH BAR ── */}
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', fontSize: 18, color: 'var(--text-muted)' }}>{'\u{1F50D}'}</span>
        <input
          type="text" placeholder="Search people by name or email..."
          value={userSearch}
          onChange={(e) => setUserSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (activeTab !== 'people') setActiveTab('people');
              setPeopleSubTab('users');
              loadUsers();
            }
          }}
          style={{
            width: '100%', padding: '14px 16px 14px 44px', border: '2px solid #e0e0e0',
            borderRadius: 12, fontSize: 15, background: 'var(--bg-surface)', outline: 'none',
            transition: 'border-color 0.2s', boxSizing: 'border-box',
          }}
          onFocus={(e) => { e.target.style.borderColor = 'var(--role-color)'; }}
          onBlur={(e) => { e.target.style.borderColor = 'var(--border-light)'; }}
        />
        <span style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--text-muted)' }}>
          searches users, waitlist & invites
        </span>
      </div>

      {/* ── Tab Navigation — Grouped ── */}
      <div style={{ marginBottom: 20 }}>
        {tabGroups.map(group => (
          <div key={group.label} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)', marginBottom: 6, paddingLeft: 4 }}>
              {group.label}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {group.tabs.map(tab => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '10px 6px',
                  border: 'none', borderRadius: 10, cursor: 'pointer',
                  background: activeTab === tab.id ? 'var(--role-color)' : 'var(--badge-muted-bg)',
                  color: activeTab === tab.id ? 'var(--text-on-primary)' : 'var(--text-secondary)',
                  fontSize: 13, fontWeight: 600, transition: 'all 0.15s', position: 'relative',
                  boxShadow: activeTab === tab.id ? '0 2px 8px rgba(27,107,90,0.3)' : 'none',
                  whiteSpace: 'nowrap',
                }}>
                  <span style={{ fontSize: 15 }}>{tab.icon}</span>
                  {tab.label}
                  {tab.badge ? (
                    <span style={{
                      position: 'absolute', top: -4, right: -4,
                      background: 'var(--color-warning)', color: 'var(--text-on-primary)', fontSize: 10, fontWeight: 700,
                      borderRadius: 10, padding: '1px 6px', minWidth: 18, textAlign: 'center',
                    }}>{tab.badge}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* ─── Overview Tab ─── */}
      {activeTab === 'overview' && stats && (
        <div>
          {/* Stat cards */}
          <div className="stats-grid">
            <div className="stat-card">
              <div style={{ fontSize: 24 }}>👥</div>
              <div className="stat-number">{stats.totalUsers}</div>
              <div className="stat-label">Registered Users</div>
            </div>
            <div className="stat-card">
              <div style={{ fontSize: 24 }}>📋</div>
              <div className="stat-number">{stats.totalWaitlist}</div>
              <div className="stat-label">Waitlist Signups</div>
            </div>
            <div className="stat-card">
              <div style={{ fontSize: 24 }}>📅</div>
              <div className="stat-number">{stats.totalSessions}</div>
              <div className="stat-label">Care Sessions</div>
            </div>
            <div className="stat-card">
              <div style={{ fontSize: 24 }}>🤝</div>
              <div className="stat-number">{stats.totalCaregivers}</div>
              <div className="stat-label">Caregivers</div>
            </div>
          </div>

          {/* Signup Trend Chart */}
          {stats.signupTrend && stats.signupTrend.length > 0 && (
            <div className="card" style={{ marginBottom: '16px' }}>
              <div className="card-header"><span className="card-icon">📈</span>User Signups (Last 30 Days)</div>
              <div style={{ padding: '16px' }}>
                <svg viewBox={`0 0 ${Math.max(stats.signupTrend.length * 40, 200)} 120`} style={{ width: '100%', height: '120px' }}>
                  {stats.signupTrend.map((d, i) => {
                    const maxCount = Math.max(...stats.signupTrend.map(s => s.count), 1);
                    const barH = (d.count / maxCount) * 80;
                    const x = i * 40 + 10;
                    return (
                      <g key={i}>
                        <rect x={x} y={100 - barH} width="24" height={barH} rx="4" fill="var(--role-color)" opacity="0.85" />
                        <text x={x + 12} y={96 - barH} textAnchor="middle" fontSize="10" fill="var(--text-primary)" fontWeight="600">{d.count}</text>
                        <text x={x + 12} y={115} textAnchor="middle" fontSize="8" fill="var(--text-muted)">
                          {(parseTimestamp(d.date) || new Date(0)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>
          )}

          {/* Waitlist Trend */}
          {stats.waitlistTrend && stats.waitlistTrend.length > 0 && (
            <div className="card" style={{ marginBottom: '16px' }}>
              <div className="card-header"><span className="card-icon">📋</span>Waitlist Signups (Last 30 Days)</div>
              <div style={{ padding: '16px' }}>
                <svg viewBox={`0 0 ${Math.max(stats.waitlistTrend.length * 40, 200)} 120`} style={{ width: '100%', height: '120px' }}>
                  {stats.waitlistTrend.map((d, i) => {
                    const maxCount = Math.max(...stats.waitlistTrend.map(s => s.count), 1);
                    const barH = (d.count / maxCount) * 80;
                    const x = i * 40 + 10;
                    return (
                      <g key={i}>
                        <rect x={x} y={100 - barH} width="24" height={barH} rx="4" fill="var(--accent-color)" opacity="0.85" />
                        <text x={x + 12} y={96 - barH} textAnchor="middle" fontSize="10" fill="var(--text-primary)" fontWeight="600">{d.count}</text>
                        <text x={x + 12} y={115} textAnchor="middle" fontSize="8" fill="var(--text-muted)">
                          {(parseTimestamp(d.date) || new Date(0)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>
          )}

          {/* Sessions by Status */}
          {stats.sessionsByStatus && stats.sessionsByStatus.length > 0 && (
            <div className="card">
              <div className="card-header"><span className="card-icon">📅</span>Sessions by Status</div>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', padding: '12px 0' }}>
                {stats.sessionsByStatus.map((s, i) => (
                  <div key={i} style={{
                    padding: '12px 20px', background: 'var(--bg-primary)', borderRadius: '8px',
                    textAlign: 'center', flex: '1 1 100px',
                  }}>
                    <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--role-color)' }}>{s.count}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{s.status}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Plausible link */}
          <div className="card" style={{ marginTop: '16px' }}>
            <div className="card-header"><span className="card-icon">🌐</span>Site Analytics</div>
            <div style={{ padding: '12px 0' }}>
              <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                Detailed site traffic, page views, referrers, and visitor geography are tracked via Plausible Analytics.
              </p>
              <a href="https://plausible.io/yourinplace.com" target="_blank" rel="noopener noreferrer" style={{
                display: 'inline-flex', alignItems: 'center', gap: '8px',
                padding: '10px 20px', background: 'var(--role-color)', color: 'var(--bg-card)', borderRadius: '8px',
                textDecoration: 'none', fontSize: '14px', fontWeight: 600,
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                Open Plausible Dashboard
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ─── People Tab (Users + Waitlist + Invites unified) ─── */}
      {activeTab === 'people' && (
        <div>
          {/* Sub-tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: 'var(--bg-primary)', borderRadius: 8, padding: 3 }}>
            {[
              { id: 'users', label: `Users (${usersTotal})`, badge: pendingApprovals.length || null },
              { id: 'waitlist', label: `Waitlist (${waitlistTotal})` },
              { id: 'invites', label: `Invites (${invitesTotal})` },
            ].map(st => (
              <button key={st.id} onClick={() => setPeopleSubTab(st.id)}
                style={{ flex: 1, padding: '8px 12px', borderRadius: 6, border: 'none', fontSize: 13, fontWeight: peopleSubTab === st.id ? 700 : 500,
                  background: peopleSubTab === st.id ? 'var(--bg-card)' : 'transparent', color: peopleSubTab === st.id ? 'var(--role-color)' : 'var(--text-tertiary)',
                  cursor: 'pointer', boxShadow: peopleSubTab === st.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', transition: 'all 0.15s', position: 'relative' }}>
                {st.label}
                {st.badge ? <span style={{ background: 'var(--color-warning)', color: 'var(--bg-card)', borderRadius: 10, padding: '1px 6px', fontSize: 10, fontWeight: 700, marginLeft: 4 }}>{st.badge} new</span> : null}
              </button>
            ))}
          </div>

          {/* ── Users sub-tab ── */}
          {peopleSubTab === 'users' && (
            <div>
              {/* Filters */}
              <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={userRoleFilter} onChange={(e) => { setUserRoleFilter(e.target.value); }}
                  style={{ padding: '10px 14px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px' }}>
                  <option value="">All Roles</option>
                  <option value="family">Family</option>
                  <option value="caregiver">Caregiver</option>
                  <option value="care_for">Care Recipient</option>
                </select>
                <button onClick={loadUsers} style={{
                  padding: '10px 20px', background: 'var(--role-color)', color: 'var(--bg-card)', border: 'none',
                  borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                }}>Search</button>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--text-tertiary)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={userDemoFilter === 'all'} onChange={(e) => setUserDemoFilter(e.target.checked ? 'all' : 'real')}
                    style={{ accentColor: 'var(--role-color)' }} />
                  Show demo
                </label>
                <span style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>{usersTotal} total</span>
              </div>

              {/* Users table */}
              <div className="card" style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
                      <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>Name</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>Email</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>Role</th>
                      <th style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--text-secondary)', fontWeight: 600 }}>Status</th>
                      <th style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--text-secondary)', fontWeight: 600 }}>Tester</th>
                      <th style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--text-secondary)', fontWeight: 600 }}>Kindred</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>Joined</th>
                      <th style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--text-secondary)', fontWeight: 600 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => {
                      const isPending = pendingApprovals.some(p => p.id === u.id);
                      return (
                      <tr key={u.id} style={{ borderBottom: '1px solid #f0f0f0', background: isPending ? '#fffbf5' : 'transparent', borderLeft: isPending ? '4px solid #ff9800' : 'none' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 500 }}>
                          {u.first_name} {u.last_name}
                          {u.is_admin ? <span style={{ marginLeft: '6px', fontSize: '10px', background: 'var(--role-color)', color: 'var(--bg-card)', padding: '2px 6px', borderRadius: '4px' }}>ADMIN</span> : ''}
                        </td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{u.email}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{
                            padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
                            background: u.role === 'family' ? 'var(--role-color-light)' : u.role === 'caregiver' ? 'var(--color-info-bg)' : 'var(--color-warning-bg)',
                            color: u.role === 'family' ? 'var(--role-color)' : u.role === 'caregiver' ? 'var(--color-info)' : 'var(--color-warning)',
                            textTransform: 'capitalize',
                          }}>{u.role === 'care_for' ? 'Care Recipient' : u.role}</span>
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          {isPending ? (
                            <span style={{ padding: '3px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: 'var(--color-warning-bg)', color: 'var(--color-warning)' }}>
                              {'\u23F3'} Pending
                            </span>
                          ) : (
                            <button onClick={async () => {
                              try {
                                const res = await apiFetch(`/api/admin/users/${u.id}/verify-email`, { method: 'PUT' });
                                if (res?.ok) {
                                  const data = await res.json();
                                  setUsers(prev => prev.map(usr => usr.id === u.id ? { ...usr, email_verified: data.email_verified ? 1 : 0 } : usr));
                                }
                              } catch (err) { console.error('Toggle verify error:', err); }
                            }} style={{
                              padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', border: 'none',
                              background: u.email_verified ? 'var(--color-success-bg)' : 'var(--color-warning-bg)',
                              color: u.email_verified ? 'var(--role-color)' : 'var(--color-warning)',
                            }} title={u.email_verified ? 'Click to revoke email verification' : 'Click to manually verify email'}>
                              {u.email_verified ? '\u2705 Verified' : '\u26A0 Unverified'}
                            </button>
                          )}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <button onClick={async () => {
                            try {
                              const res = await apiFetch(`/api/admin/users/${u.id}/tester`, { method: 'PUT' });
                              if (res?.ok) {
                                const data = await res.json();
                                setUsers(prev => prev.map(usr => usr.id === u.id ? { ...usr, is_tester: data.is_tester ? 1 : 0 } : usr));
                              }
                            } catch (err) { console.error('Toggle tester error:', err); }
                          }} style={{
                            padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', border: 'none',
                            background: u.is_tester ? 'var(--color-success-bg)' : 'var(--bg-primary)',
                            color: u.is_tester ? 'var(--role-color)' : 'var(--text-muted)',
                          }} title={u.is_tester ? 'Click to remove tester access' : 'Click to grant tester access'}>
                            {u.is_tester ? '\u2713 Yes' : 'No'}
                          </button>
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <button onClick={async () => {
                            try {
                              const res = await apiFetch(`/api/admin/users/${u.id}/companion-access`, { method: 'PUT' });
                              if (res?.ok) {
                                const data = await res.json();
                                setUsers(prev => prev.map(usr => usr.id === u.id ? { ...usr, companion_access: data.companion_access ? 1 : 0 } : usr));
                              }
                            } catch (err) { console.error('Toggle companion error:', err); }
                          }} style={{
                            padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', border: 'none',
                            background: u.companion_access ? 'var(--color-info-bg)' : 'var(--bg-primary)',
                            color: u.companion_access ? 'var(--color-info)' : 'var(--text-muted)',
                          }} title={u.companion_access ? 'Click to revoke Kindred access' : 'Click to grant Kindred access'}>
                            {u.companion_access ? '\u2713 Yes' : 'No'}
                          </button>
                        </td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-tertiary)', fontSize: '12px' }}>
                          {formatDate(u.created_at)}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          {isPending ? (
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                              <button onClick={() => handleApprove(u.id)} disabled={approvalLoading === u.id}
                                style={{ padding: '4px 12px', background: 'var(--color-success)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                                {approvalLoading === u.id ? '...' : 'Approve'}
                              </button>
                              <button onClick={() => handleReject(u.id)}
                                style={{ padding: '4px 10px', background: 'var(--bg-primary)', color: 'var(--color-error)', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
                                Reject
                              </button>
                            </div>
                          ) : u.is_admin && u.role !== 'caregiver' ? (
                            <div style={{ display: 'flex', gap: '4px', justifyContent: 'center', flexWrap: 'nowrap' }}>
                              <button onClick={() => { setAdminMsgTarget({ userId: u.id, name: `${u.first_name} ${u.last_name}` }); setAdminMsgText(''); }}
                                style={{ padding: '4px 8px', background: 'var(--bg-surface)', color: 'var(--role-color)', border: '1px solid #e0e0e0', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}
                                title="Message as InPlace Support">
                                {'\u{1F4AC}'}
                              </button>
                            </div>
                          ) : u.is_admin && u.role === 'caregiver' ? (
                            <div style={{ display: 'flex', gap: '4px', justifyContent: 'center', flexWrap: 'nowrap' }}>
                              <button onClick={() => openOnboardingModal(u.id)}
                                style={{ padding: '4px 10px', background: 'var(--role-color)', color: 'var(--bg-card)', border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                Manage
                              </button>
                            </div>
                          ) : u.role === 'caregiver' ? (
                            <div style={{ display: 'flex', gap: '4px', justifyContent: 'center', flexWrap: 'nowrap' }}>
                              <button onClick={() => openOnboardingModal(u.id)}
                                style={{ padding: '4px 10px', background: 'var(--role-color)', color: 'var(--bg-card)', border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                Manage
                              </button>
                              <button onClick={() => { setFreezeTarget({ userId: u.id, name: `${u.first_name} ${u.last_name}` }); setFreezeReason(''); }}
                                style={{ padding: '4px 8px', background: 'var(--bg-surface)', color: 'var(--color-error)', border: '1px solid #e0e0e0', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}
                                title="Freeze caregiver account">
                                {'\u{1F6D1}'}
                              </button>
                              <button onClick={() => { setAdminMsgTarget({ userId: u.id, name: `${u.first_name} ${u.last_name}` }); setAdminMsgText(''); }}
                                style={{ padding: '4px 8px', background: 'var(--bg-surface)', color: 'var(--role-color)', border: '1px solid #e0e0e0', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}
                                title="Message as InPlace Support">
                                {'\u{1F4AC}'}
                              </button>
                              <button onClick={() => handleForcePasswordReset(u.id, u.email)} disabled={resetPwLoading === u.id}
                                style={{ padding: '4px 8px', background: 'var(--bg-surface)', color: 'var(--color-warning)', border: '1px solid #e0e0e0', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', opacity: resetPwLoading === u.id ? 0.5 : 1 }}
                                title="Send password reset email">
                                {resetPwLoading === u.id ? '\u2026' : resetPwMsg?.id === u.id ? (resetPwMsg.type === 'success' ? '\u2713' : '\u2715') : '\u{1F511}'}
                              </button>
                              {deleteConfirm === u.id ? (
                                <>
                                  <button onClick={() => handleDeleteUser(u.id, u.email)} disabled={deleteLoading}
                                    style={{ padding: '4px 10px', background: 'var(--color-error)', color: 'var(--bg-card)', border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>
                                    {deleteLoading ? '...' : 'Confirm'}
                                  </button>
                                  <button onClick={() => setDeleteConfirm(null)}
                                    style={{ padding: '4px 8px', background: 'var(--badge-muted-bg)', border: '1px solid #ddd', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}>
                                    {'\u2715'}
                                  </button>
                                </>
                              ) : (
                                <button onClick={() => handleDeleteUser(u.id, u.email)}
                                  style={{ padding: '4px 10px', background: 'var(--bg-surface)', color: 'var(--color-error)', border: '1px solid #e0e0e0', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}>
                                  Delete
                                </button>
                              )}
                              <button onClick={() => handleNukeUser(u.id, u.email)}
                                style={{ padding: '4px 8px', background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid #e0e0e0', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}
                                title="Permanently delete all data (requires passkey)">
                                {'\u2622\uFE0F'}
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', gap: '4px', justifyContent: 'center', flexWrap: 'nowrap' }}>
                              <button onClick={() => { setAdminMsgTarget({ userId: u.id, name: `${u.first_name} ${u.last_name}` }); setAdminMsgText(''); }}
                                style={{ padding: '4px 8px', background: 'var(--bg-surface)', color: 'var(--role-color)', border: '1px solid #e0e0e0', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}
                                title="Message as InPlace Support">
                                {'\u{1F4AC}'}
                              </button>
                              <button onClick={() => handleForcePasswordReset(u.id, u.email)} disabled={resetPwLoading === u.id}
                                style={{ padding: '4px 8px', background: 'var(--bg-surface)', color: 'var(--color-warning)', border: '1px solid #e0e0e0', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', opacity: resetPwLoading === u.id ? 0.5 : 1 }}
                                title="Send password reset email">
                                {resetPwLoading === u.id ? '\u2026' : resetPwMsg?.id === u.id ? (resetPwMsg.type === 'success' ? '\u2713' : '\u2715') : '\u{1F511}'}
                              </button>
                              <button onClick={() => handleDeleteUser(u.id, u.email)}
                                style={{ padding: '4px 10px', background: 'var(--bg-surface)', color: 'var(--color-error)', border: '1px solid #e0e0e0', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}>
                                Delete
                              </button>
                              <button onClick={() => handleNukeUser(u.id, u.email)}
                                style={{ padding: '4px 8px', background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid #e0e0e0', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}
                                title="Permanently delete all data (requires passkey)">
                                {'\u2622\uFE0F'}
                              </button>
                            </div>
                          )}
                          {nukeError && nukeConfirm === u.id && (
                            <div style={{ fontSize: '10px', color: 'var(--color-error)', marginTop: 4, textAlign: 'center' }}>{nukeError}</div>
                          )}
                        </td>
                      </tr>
                    );})}
                  </tbody>
                </table>
                {users.length === 0 && (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>No users found</div>
                )}
              </div>
            </div>
          )}

          {/* Export CSV */}
          {(peopleSubTab === 'waitlist') && waitlist.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <button onClick={exportWaitlistCSV} style={{
                padding: '6px 16px', background: 'var(--role-color)', color: 'var(--bg-card)', border: 'none',
                borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '6px',
              }}>
                Export Waitlist CSV
              </button>
            </div>
          )}

          {/* Waitlist section */}
          {(peopleSubTab === 'waitlist') && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-header"><span className="card-icon">📋</span>Waitlist ({waitlistTotal})</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
                      <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>Email</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>Name</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>Role</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>Source</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>Date</th>
                      <th style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--text-secondary)', fontWeight: 600 }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {waitlist.map((w) => (
                      <tr key={w.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 500 }}>{w.email}</td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{w.name || '—'}</td>
                        <td style={{ padding: '10px 12px', textTransform: 'capitalize' }}>{w.role || 'family'}</td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-tertiary)' }}>{w.source || 'splash'}</td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-tertiary)', fontSize: '12px' }}>{formatDate(w.created_at)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <button onClick={() => { setInviteSearch(w.email); setPeopleSubTab('invites'); }} style={{
                            padding: '4px 12px', background: 'var(--accent-color)', color: 'var(--text-on-primary)', border: 'none',
                            borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', marginRight: '6px',
                          }}>Invite</button>
                          <button onClick={async () => {
                            if (!confirm(`Remove ${w.email} from waitlist?`)) return;
                            const res = await apiFetch(`/api/waitlist/${w.id}`, { method: 'DELETE' });
                            if (res?.ok) { setWaitlist(prev => prev.filter(x => x.id !== w.id)); }
                          }} style={{
                            padding: '4px 10px', background: 'var(--bg-surface)', color: 'var(--color-error)', border: '1px solid #dc3545',
                            borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                          }}>Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {waitlist.length === 0 && (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>No waitlist entries yet</div>
                )}
              </div>
            </div>
          )}

          {/* Search & Send (invites section) */}
          {(peopleSubTab === 'invites') && (<React.Fragment>
          <div className="card" style={{ marginBottom: '20px' }}>
            <div className="card-header"><span className="card-icon">🔍</span>Search & Invite</div>
            <div style={{ padding: '16px' }}>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
                <input
                  type="email" placeholder="Enter email address..."
                  value={inviteSearch} onChange={(e) => setInviteSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearchEmail()}
                  style={{ flex: 1, padding: '10px 14px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px' }}
                />
                <button onClick={handleSearchEmail} disabled={searchLoading} style={{
                  padding: '10px 20px', background: 'var(--role-color)', color: 'var(--bg-card)', border: 'none',
                  borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                  opacity: searchLoading ? 0.6 : 1,
                }}>
                  {searchLoading ? 'Searching...' : 'Search'}
                </button>
              </div>

              {/* Search Result */}
              {searchResult && (
                <div style={{ padding: '14px', background: 'var(--bg-primary)', borderRadius: '8px', marginBottom: '12px' }}>
                  {searchResult.user && (
                    <div style={{ marginBottom: '8px' }}>
                      <span style={{ padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, background: 'var(--role-color-light)', color: 'var(--role-color)' }}>REGISTERED</span>
                      <span style={{ marginLeft: '10px', fontWeight: 500 }}>{searchResult.user.first_name} {searchResult.user.last_name}</span>
                      <span style={{ color: 'var(--text-tertiary)', marginLeft: '8px', fontSize: '13px' }}>{searchResult.user.email}</span>
                      <span style={{ color: 'var(--text-tertiary)', marginLeft: '8px', fontSize: '12px' }}>({searchResult.user.role}, joined {formatDate(searchResult.user.created_at)})</span>
                    </div>
                  )}
                  {searchResult.waitlist && (
                    <div style={{ marginBottom: '8px' }}>
                      <span style={{ padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, background: 'var(--color-warning-bg)', color: 'var(--color-warning)' }}>WAITLIST</span>
                      <span style={{ marginLeft: '10px', fontWeight: 500 }}>{searchResult.waitlist.name || 'No name'}</span>
                      <span style={{ color: 'var(--text-tertiary)', marginLeft: '8px', fontSize: '13px' }}>{searchResult.waitlist.email}</span>
                      <span style={{ color: 'var(--text-tertiary)', marginLeft: '8px', fontSize: '12px' }}>(signed up {formatDate(searchResult.waitlist.created_at)})</span>
                    </div>
                  )}
                  {searchResult.invite && (
                    <div style={{ marginBottom: '8px' }}>
                      <span style={{ padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
                        background: searchResult.invite.status === 'accepted' ? 'var(--role-color-light)' : searchResult.invite.status === 'pending' ? 'var(--color-info-bg)' : 'var(--bg-primary)',
                        color: searchResult.invite.status === 'accepted' ? 'var(--role-color)' : searchResult.invite.status === 'pending' ? 'var(--color-info)' : 'var(--text-tertiary)',
                      }}>INVITE: {searchResult.invite.status.toUpperCase()}</span>
                      <span style={{ color: 'var(--text-tertiary)', marginLeft: '10px', fontSize: '13px' }}>
                        {searchResult.invite.role} — sent {formatDate(searchResult.invite.created_at)}
                      </span>
                    </div>
                  )}
                  {searchResult.careTeamInvites && searchResult.careTeamInvites.length > 0 && (
                    <div style={{ marginBottom: '8px' }}>
                      {searchResult.careTeamInvites.map((cti, idx) => (
                        <div key={idx} style={{ marginBottom: 4 }}>
                          <span style={{ padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
                            background: cti.status === 'accepted' ? 'var(--role-color-light)' : cti.status === 'pending' ? 'var(--color-warning-bg)' : 'var(--bg-primary)',
                            color: cti.status === 'accepted' ? 'var(--role-color)' : cti.status === 'pending' ? 'var(--color-warning)' : 'var(--text-tertiary)',
                          }}>CARE TEAM INVITE: {cti.status.toUpperCase()}</span>
                          <span style={{ color: 'var(--text-tertiary)', marginLeft: '10px', fontSize: '13px' }}>
                            {cti.care_team_name} — sent by {cti.inviter_first_name} {cti.inviter_last_name}, {formatDate(cti.created_at)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {!searchResult.user && !searchResult.waitlist && !searchResult.invite && (!searchResult.careTeamInvites || searchResult.careTeamInvites.length === 0) && (
                    <div style={{ color: 'var(--text-muted)' }}>No records found for this email.</div>
                  )}

                  {/* Send Invite — only show if not already registered and no pending invite */}
                  {!searchResult.user && (!searchResult.invite || searchResult.invite.status !== 'pending') && (
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #e0e0e0' }}>
                      <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}
                        style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '13px' }}>
                        <option value="caregiver">Caregiver</option>
                        <option value="family">Care Team (Family)</option>
                        <option value="care_for">Cared-For</option>
                      </select>
                      <button onClick={() => handleSendInvite()} disabled={inviteSending} style={{
                        padding: '8px 20px', background: 'var(--accent-color)', color: 'var(--text-on-primary)', border: 'none',
                        borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                        opacity: inviteSending ? 0.6 : 1,
                      }}>
                        {inviteSending ? 'Sending...' : 'Send Invite'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Status message */}
              {inviteMsg && (
                <div style={{
                  padding: '10px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: 500,
                  background: inviteMsg.type === 'success' ? 'var(--role-color-light)' : '#fde8e8',
                  color: inviteMsg.type === 'success' ? 'var(--role-color)' : 'var(--color-error)',
                }}>
                  {inviteMsg.text}
                </div>
              )}
            </div>
          </div>

          {/* Invite List */}
          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span><span className="card-icon">✉️</span>Platform Invites</span>
              <span style={{ fontSize: '13px', color: 'var(--text-tertiary)', fontWeight: 400 }}>{invitesTotal} total</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>Email</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>Role</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>Status</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>Sent By</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>Expires</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--text-secondary)', fontWeight: 600 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map((inv) => {
                    const isExpired = inv.status === 'pending' && (parseTimestamp(inv.expires_at) || new Date(0)) < new Date();
                    const displayStatus = isExpired ? 'expired' : inv.status;
                    return (
                      <tr key={inv.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 500 }}>{inv.invited_email}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{
                            padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, textTransform: 'capitalize',
                            background: inv.role === 'caregiver' ? 'var(--color-info-bg)' : inv.role === 'family' ? 'var(--role-color-light)' : 'var(--color-warning-bg)',
                            color: inv.role === 'caregiver' ? 'var(--color-info)' : inv.role === 'family' ? 'var(--role-color)' : 'var(--color-warning)',
                          }}>{inv.role === 'care_for' ? 'Cared-For' : inv.role}</span>
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{
                            padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, textTransform: 'capitalize',
                            background: displayStatus === 'accepted' ? 'var(--role-color-light)' : displayStatus === 'pending' ? 'var(--color-info-bg)' : displayStatus === 'cancelled' ? 'var(--bg-primary)' : 'var(--color-warning-bg)',
                            color: displayStatus === 'accepted' ? 'var(--role-color)' : displayStatus === 'pending' ? 'var(--color-info)' : displayStatus === 'cancelled' ? 'var(--text-tertiary)' : 'var(--color-warning)',
                          }}>{displayStatus}</span>
                        </td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontSize: '12px' }}>
                          {inv.inviter_first_name} {inv.inviter_last_name}
                        </td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-tertiary)', fontSize: '12px' }}>{formatDate(inv.expires_at)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          {inv.status === 'pending' && !isExpired && (
                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                              <button onClick={() => handleResendInvite(inv.id)} style={{
                                padding: '4px 10px', background: 'var(--badge-muted-bg)', border: '1px solid #ddd',
                                borderRadius: '6px', fontSize: '11px', cursor: 'pointer',
                              }}>Resend</button>
                              <button onClick={() => handleCancelInvite(inv.id)} style={{
                                padding: '4px 10px', background: '#fff0f0', border: '1px solid #fdd',
                                borderRadius: '6px', fontSize: '11px', cursor: 'pointer', color: 'var(--color-red-strong)',
                              }}>Cancel</button>
                            </div>
                          )}
                          {(inv.status === 'accepted') && <span style={{ color: 'var(--role-color)', fontSize: '12px' }}>Completed</span>}
                          {(isExpired || inv.status === 'cancelled') && (
                            <button onClick={() => { setInviteSearch(inv.invited_email); setPeopleSubTab('invites'); }} style={{
                              padding: '4px 10px', background: 'var(--badge-muted-bg)', border: '1px solid #ddd',
                              borderRadius: '6px', fontSize: '11px', cursor: 'pointer',
                            }}>Re-invite</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {invites.length === 0 && (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>No invites sent yet</div>
              )}
            </div>
          </div>

          {/* Care Team Invites */}
          <div className="card" style={{ marginTop: '20px' }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span><span className="card-icon">👨‍👩‍👦</span>Care Team Invites</span>
              <span style={{ fontSize: '13px', color: 'var(--text-tertiary)', fontWeight: 400 }}>{careTeamInvites.length} total</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>Email</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>Care Team</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>Role</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>Status</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>Sent By</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {careTeamInvites.map((cti) => {
                    const isExpired = cti.status === 'pending' && cti.expires_at && (parseTimestamp(cti.expires_at) || new Date(0)) < new Date();
                    const displayStatus = isExpired ? 'expired' : cti.status;
                    return (
                      <tr key={cti.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 500 }}>{cti.invited_email}</td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{cti.team_name}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{
                            padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, textTransform: 'capitalize',
                            background: cti.role === 'caregiver' ? 'var(--color-info-bg)' : 'var(--role-color-light)',
                            color: cti.role === 'caregiver' ? 'var(--color-info)' : 'var(--role-color)',
                          }}>{cti.role}</span>
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{
                            padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, textTransform: 'capitalize',
                            background: displayStatus === 'accepted' ? 'var(--role-color-light)' : displayStatus === 'pending' ? 'var(--color-info-bg)' : 'var(--color-warning-bg)',
                            color: displayStatus === 'accepted' ? 'var(--role-color)' : displayStatus === 'pending' ? 'var(--color-info)' : 'var(--color-warning)',
                          }}>{displayStatus}</span>
                        </td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontSize: '12px' }}>{cti.inviter_first_name} {cti.inviter_last_name}</td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-tertiary)', fontSize: '12px' }}>{formatDate(cti.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {careTeamInvites.length === 0 && (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>No care team invites yet</div>
              )}
            </div>
          </div>
          </React.Fragment>)}
        </div>
      )}

      {/* ─── Activity Tab ─── */}
      {activeTab === 'activity' && activity && (
        <div>
          {/* Recent Registrations */}
          <div className="card" style={{ marginBottom: '16px' }}>
            <div className="card-header"><span className="card-icon">🆕</span>Recent Registrations</div>
            {activity.recentUsers.length > 0 ? (
              <div>
                {activity.recentUsers.map((u) => (
                  <div key={u.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 0', borderBottom: '1px solid #f5f5f5',
                  }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: '14px' }}>{u.first_name} {u.last_name}</span>
                      <span style={{ color: 'var(--text-tertiary)', fontSize: '13px', marginLeft: '8px' }}>{u.email}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{
                        padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
                        background: u.role === 'family' ? 'var(--role-color-light)' : u.role === 'caregiver' ? 'var(--color-info-bg)' : 'var(--color-warning-bg)',
                        color: u.role === 'family' ? 'var(--role-color)' : u.role === 'caregiver' ? 'var(--color-info)' : 'var(--color-warning)',
                        textTransform: 'capitalize',
                      }}>{u.role}</span>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{formatDateTime(u.created_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : <div style={{ padding: '16px', color: 'var(--text-muted)', textAlign: 'center' }}>No registrations yet</div>}
          </div>

          {/* Recent Waitlist */}
          <div className="card" style={{ marginBottom: '16px' }}>
            <div className="card-header"><span className="card-icon">📋</span>Recent Waitlist Signups</div>
            {activity.recentWaitlist.length > 0 ? (
              <div>
                {activity.recentWaitlist.map((w) => (
                  <div key={w.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 0', borderBottom: '1px solid #f5f5f5',
                  }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: '14px' }}>{w.email}</span>
                      {w.name && <span style={{ color: 'var(--text-tertiary)', fontSize: '13px', marginLeft: '8px' }}>({w.name})</span>}
                    </div>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{formatDateTime(w.created_at)}</span>
                  </div>
                ))}
              </div>
            ) : <div style={{ padding: '16px', color: 'var(--text-muted)', textAlign: 'center' }}>No waitlist signups yet</div>}
          </div>

          {/* Recent Sessions */}
          <div className="card">
            <div className="card-header"><span className="card-icon">📅</span>Recent Care Sessions</div>
            {activity.recentSessions.length > 0 ? (
              <div>
                {activity.recentSessions.map((s) => (
                  <div key={s.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 0', borderBottom: '1px solid #f5f5f5',
                  }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: '14px' }}>{s.recipient_name}</span>
                      <span style={{ color: 'var(--text-tertiary)', fontSize: '13px', marginLeft: '8px' }}>({s.family_name})</span>
                      <span style={{ marginLeft: '8px', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 600, background: 'var(--bg-highlight)', color: 'var(--role-color)', textTransform: 'capitalize' }}>
                        {s.service_type?.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{
                        padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
                        background: s.status === 'completed' ? 'var(--role-color-light)' : s.status === 'confirmed' ? 'var(--color-info-bg)' : 'var(--color-warning-bg)',
                        color: s.status === 'completed' ? 'var(--role-color)' : s.status === 'confirmed' ? 'var(--color-info)' : 'var(--color-warning)',
                        textTransform: 'capitalize',
                      }}>{s.status}</span>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{s.scheduled_date}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : <div style={{ padding: '16px', color: 'var(--text-muted)', textAlign: 'center' }}>No sessions yet</div>}
          </div>
        </div>
      )}

      {/* ─── Feedback Tab ─── */}
      {activeTab === 'feedback' && (
        <div>
          {/* Filters */}
          <div className="card" style={{ marginBottom: 16, padding: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={feedbackFilter.category} onChange={e => { setFeedbackFilter(f => ({ ...f, category: e.target.value })); setTimeout(loadFeedback, 0); }}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }}>
              <option value="">All Categories</option>
              <option value="bug">Bug Report</option>
              <option value="feature">Feature Request</option>
              <option value="general">General</option>
              <option value="complaint">Complaint</option>
              <option value="praise">Praise</option>
            </select>
            <select value={feedbackFilter.status} onChange={e => { setFeedbackFilter(f => ({ ...f, status: e.target.value })); setTimeout(loadFeedback, 0); }}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }}>
              <option value="">All Statuses</option>
              <option value="new">New</option>
              <option value="reviewed">Reviewed</option>
              <option value="planned">Planned</option>
              <option value="done">Done</option>
              <option value="dismissed">Dismissed</option>
            </select>
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>{feedbackTotal} total</span>
          </div>

          {feedbackLoading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading feedback...</div>
          ) : feedbackItems.length === 0 ? (
            <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>💬</div>
              No feedback yet. The floating feedback button will appear for all users.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {feedbackItems.map(fb => {
                const isExpanded = expandedFeedback === fb.id;
                const categoryColors = { bug: 'var(--color-error)', feature: 'var(--color-info)', general: 'var(--text-secondary)', complaint: 'var(--color-warning)', praise: 'var(--color-success)' };
                const categoryLabels = { bug: 'Bug', feature: 'Feature', general: 'General', complaint: 'Complaint', praise: 'Praise' };
                const statusColors = { new: 'var(--accent-color)', reviewed: 'var(--color-info)', planned: 'var(--color-purple)', done: 'var(--color-success)', dismissed: 'var(--text-muted)' };
                const moodEmojis = { great: '😊', good: '🙂', okay: '😐', bad: '😟', terrible: '😡' };

                return (
                  <div key={fb.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    {/* Summary row */}
                    <div
                      onClick={() => { setExpandedFeedback(isExpanded ? null : fb.id); setFeedbackEditNotes(fb.adminNotes || ''); }}
                      style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, background: isExpanded ? 'var(--bg-primary)' : 'var(--bg-card)' }}
                    >
                      {fb.mood && <span style={{ fontSize: 18 }}>{moodEmojis[fb.mood] || ''}</span>}
                      <span style={{
                        padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                        background: (categoryColors[fb.category] || 'var(--text-secondary)') + '18', color: categoryColors[fb.category] || 'var(--text-secondary)',
                      }}>{categoryLabels[fb.category] || fb.category}</span>
                      <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {fb.description.substring(0, 80)}{fb.description.length > 80 ? '...' : ''}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fb.userName}</span>
                      <span style={{
                        padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                        background: (statusColors[fb.status] || 'var(--text-muted)') + '18', color: statusColors[fb.status] || 'var(--text-muted)',
                      }}>{fb.status}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {(parseTimestamp(fb.createdAt) || new Date(0)).toLocaleDateString()}
                      </span>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div style={{ padding: '16px', borderTop: '1px solid #eee' }}>
                        <div style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.6, marginBottom: 12, whiteSpace: 'pre-wrap' }}>{fb.description}</div>

                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12 }}>
                          <span>From: <strong>{fb.userName}</strong> ({fb.userEmail || '—'})</span>
                          <span>Role: {fb.userRole || '—'}</span>
                          {fb.pageContext && <span>Page: {fb.pageContext.page}</span>}
                          {fb.pageContext?.device && <span>Device: {fb.pageContext.device}</span>}
                          <span>{(parseTimestamp(fb.createdAt) || new Date(0)).toLocaleString()}</span>
                        </div>

                        {/* Rich device context (collapsible) */}
                        {fb.pageContext && (fb.pageContext.browser || fb.pageContext.os) && (
                          <details style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
                            <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Device &amp; Environment Details</summary>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '4px 16px', padding: '8px 12px', background: 'var(--bg-primary)', borderRadius: 8 }}>
                              {fb.pageContext.browser && <span><strong>Browser:</strong> {fb.pageContext.browser}</span>}
                              {fb.pageContext.os && <span><strong>OS:</strong> {fb.pageContext.os}</span>}
                              {fb.pageContext.screenResolution && <span><strong>Screen:</strong> {fb.pageContext.screenResolution}</span>}
                              {fb.pageContext.viewportSize && <span><strong>Viewport:</strong> {fb.pageContext.viewportSize}</span>}
                              {fb.pageContext.devicePixelRatio && <span><strong>DPR:</strong> {fb.pageContext.devicePixelRatio}x</span>}
                              {fb.pageContext.touchSupport && <span><strong>Touch:</strong> {fb.pageContext.touchSupport}</span>}
                              {fb.pageContext.connectionType && fb.pageContext.connectionType !== 'unknown' && <span><strong>Connection:</strong> {fb.pageContext.connectionType}</span>}
                              {fb.pageContext.language && <span><strong>Language:</strong> {fb.pageContext.language}</span>}
                              {fb.pageContext.isPWA === 'yes' && <span><strong>PWA:</strong> Yes</span>}
                              {fb.pageContext.currentUrl && <span><strong>URL:</strong> {fb.pageContext.currentUrl}</span>}
                              {fb.pageContext.version && <span><strong>Version:</strong> v{fb.pageContext.version}</span>}
                            </div>
                            {fb.pageContext.recentErrors && fb.pageContext.recentErrors.length > 0 && (
                              <div style={{ marginTop: 8, padding: '8px 12px', background: '#fff3f3', borderRadius: 8, border: '1px solid #fdd' }}>
                                <strong style={{ color: 'var(--color-error)' }}>Console Errors ({fb.pageContext.recentErrors.length}):</strong>
                                {fb.pageContext.recentErrors.map((err, i) => (
                                  <div key={i} style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 11, color: 'var(--color-error)', wordBreak: 'break-all' }}>
                                    {err.message}{err.timestamp ? ` (${(parseTimestamp(err.timestamp) || new Date(0)).toLocaleTimeString()})` : ''}
                                  </div>
                                ))}
                              </div>
                            )}
                          </details>
                        )}

                        {fb.hasScreenshot && (
                          <div style={{ marginBottom: 12 }}>
                            <img src={`/api/feedback/${fb.id}/screenshot`} alt="Screenshot" style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 8, border: '1px solid #eee' }} />
                          </div>
                        )}

                        {/* Status update */}
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                          {['new', 'reviewed', 'planned', 'done', 'dismissed'].map(s => (
                            <button key={s} onClick={() => updateFeedbackItem(fb.id, { status: s })}
                              style={{
                                padding: '4px 12px', borderRadius: 12, border: fb.status === s ? '2px solid ' + (statusColors[s] || 'var(--text-muted)') : '1px solid #ddd',
                                background: fb.status === s ? (statusColors[s] || 'var(--text-muted)') + '18' : 'var(--bg-card)',
                                color: fb.status === s ? statusColors[s] : 'var(--text-secondary)', fontSize: 11, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize',
                              }}
                            >{s}</button>
                          ))}
                        </div>

                        {/* Create FAQ from feedback */}
                        <button onClick={() => createFaqFromFeedback(fb)} style={{
                          padding: '6px 14px', background: '#e8f5f0', color: 'var(--role-color)',
                          border: '1px solid #1b6b5a', borderRadius: '8px', cursor: 'pointer',
                          fontSize: '12px', fontWeight: 600, marginBottom: 12, display: 'inline-block',
                        }}>❓ Create FAQ from this</button>

                        {/* Admin notes */}
                        <div>
                          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Admin Notes</label>
                          <textarea
                            value={feedbackEditNotes}
                            onChange={e => setFeedbackEditNotes(e.target.value)}
                            placeholder="Internal notes about this feedback..."
                            rows={2}
                            style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' }}
                          />
                          {feedbackEditNotes !== (fb.adminNotes || '') && (
                            <button onClick={() => updateFeedbackItem(fb.id, { adminNotes: feedbackEditNotes })}
                              style={{ marginTop: 6, padding: '4px 14px', borderRadius: 6, border: 'none', background: 'var(--role-color)', color: 'var(--bg-card)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                            >Save Notes</button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── Auth Events Tab (Login, Registration, Onboarding, Password Reset, Demo) ─── */}
      {activeTab === 'onboarding' && (
        <div>
          {obEventsLoading && <LoadingSpinner text="Loading auth event data..." />}
          {obEvents && (
            <div>
              {/* Flow summary cards */}
              {obEvents.flowSummary && obEvents.flowSummary.length > 0 && (
                <div className="stats-grid" style={{ marginBottom: '20px' }}>
                  {obEvents.flowSummary.map(f => {
                    const flowColors = { login: '#0369a1', registration: 'var(--color-purple-light)', onboarding: 'var(--role-color)', password_reset: 'var(--color-warning)', demo: '#6b7280' };
                    const flowIcons = { login: '🔑', registration: '📝', onboarding: '🚦', password_reset: '🔄', demo: '🎭' };
                    const flowLabels = { login: 'Logins', registration: 'Registrations', onboarding: 'Caregiver Onboarding', password_reset: 'Password Resets', demo: 'Demo Logins' };
                    return (
                      <div key={f.flow} className="stat-card" style={{ borderLeft: `4px solid ${flowColors[f.flow] || 'var(--text-muted)'}` }}>
                        <div style={{ fontSize: '20px', marginBottom: '4px' }}>{flowIcons[f.flow] || '📊'}</div>
                        <div className="stat-number">{f.total_events}</div>
                        <div className="stat-label">{flowLabels[f.flow] || f.flow}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{f.unique_users} users, {f.error_count} errors (30d)</div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Per-flow event breakdown */}
              {obEvents.stats && obEvents.stats.length > 0 && (
                <div className="card" style={{ marginBottom: '16px' }}>
                  <h3 style={{ fontSize: '15px', margin: '0 0 12px', color: 'var(--role-color)' }}>Event Breakdown by Flow (30 days)</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {obEvents.stats.map((s, i) => {
                      const flowColors = { login: '#0369a1', registration: 'var(--color-purple-light)', onboarding: 'var(--role-color)', password_reset: 'var(--color-warning)', demo: '#6b7280' };
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px', fontSize: '12px' }}>
                          <span style={{
                            padding: '1px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: 600,
                            background: (flowColors[s.flow] || 'var(--text-muted)') + '18', color: flowColors[s.flow] || 'var(--text-muted)',
                            minWidth: '80px', textAlign: 'center',
                          }}>{s.flow}</span>
                          <span style={{
                            padding: '1px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: 600,
                            background: s.event_type === 'error' ? 'var(--bg-error-subtle)' : s.event_type.includes('success') || s.event_type.includes('complete') ? 'var(--color-success-bg)' : '#f0f9ff',
                            color: s.event_type === 'error' ? 'var(--color-error)' : s.event_type.includes('success') || s.event_type.includes('complete') ? '#059669' : '#0369a1',
                          }}>{s.event_type}</span>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{s.count}</span>
                          <span style={{ color: 'var(--text-muted)' }}>({s.unique_users} users)</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Onboarding Funnel */}
              {obEvents.funnel && obEvents.funnel.length > 0 && (
                <div className="card" style={{ marginBottom: '16px' }}>
                  <h3 style={{ fontSize: '15px', margin: '0 0 12px', color: 'var(--role-color)' }}>Caregiver Onboarding Funnel (30 days)</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {obEvents.funnel.map(f => {
                      const maxCount = Math.max(...obEvents.funnel.map(x => x.completions));
                      const pct = maxCount > 0 ? (f.completions / maxCount * 100) : 0;
                      return (
                        <div key={f.step} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{ width: '140px', fontSize: '12px', color: 'var(--text-secondary)', flexShrink: 0 }}>
                            Step {f.step}: {f.step_name}
                          </div>
                          <div style={{ flex: 1, background: 'var(--badge-muted-bg)', borderRadius: '4px', height: '22px', position: 'relative' }}>
                            <div style={{
                              width: pct + '%', height: '100%', borderRadius: '4px',
                              background: f.step === 9 ? '#22c55e' : 'var(--role-color)',
                              transition: 'width 0.3s',
                            }} />
                            <span style={{ position: 'absolute', left: '8px', top: '3px', fontSize: '11px', fontWeight: 600, color: pct > 30 ? 'var(--text-on-primary)' : 'var(--text-primary)' }}>
                              {f.completions} ({f.unique_users} users)
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Recent Errors (all flows) */}
              <div className="card" style={{ marginBottom: '16px' }}>
                <h3 style={{ fontSize: '15px', margin: '0 0 12px', color: 'var(--color-error)' }}>Recent Errors (All Flows)</h3>
                {(!obEvents.recentErrors || obEvents.recentErrors.length === 0) ? (
                  <p style={{ color: 'var(--text-tertiary)', fontSize: '13px', margin: 0 }}>No errors recorded yet.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {obEvents.recentErrors.map(e => {
                      const meta = e.metadata ? JSON.parse(e.metadata) : {};
                      const flowColors = { login: '#0369a1', registration: 'var(--color-purple-light)', onboarding: 'var(--role-color)', password_reset: 'var(--color-warning)', demo: '#6b7280' };
                      const eFlow = e.flow || 'onboarding';
                      return (
                        <div key={e.id} style={{
                          padding: '10px 12px', background: 'var(--bg-error-subtle)', borderRadius: '8px',
                          border: '1px solid #fecaca', fontSize: '13px', borderLeft: `4px solid ${flowColors[eFlow] || 'var(--color-error)'}`,
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                            <span style={{ fontWeight: 600, color: 'var(--color-error)' }}>
                              <span style={{ padding: '1px 6px', borderRadius: '8px', fontSize: '10px', background: (flowColors[eFlow] || 'var(--text-muted)') + '18', color: flowColors[eFlow] || 'var(--text-muted)', marginRight: '6px' }}>{eFlow}</span>
                              {e.step ? `Step ${e.step}: ${e.step_name}` : e.error_source || 'Error'}
                            </span>
                            <span style={{ color: 'var(--text-tertiary)', fontSize: '11px' }}>
                              {(parseTimestamp(e.created_at) || new Date(0)).toLocaleString()}
                            </span>
                          </div>
                          <div style={{ color: '#b91c1c' }}>{e.error_message}</div>
                          <div style={{ display: 'flex', gap: '12px', marginTop: '4px', fontSize: '11px', color: 'var(--text-tertiary)', flexWrap: 'wrap' }}>
                            <span>User: {e.email || e.user_id || 'anon'}</span>
                            <span>Source: {e.error_source || '?'}</span>
                            <span>Online: {meta.online !== undefined ? String(meta.online) : '?'}</span>
                            {meta.screenWidth && <span>Screen: {meta.screenWidth}px</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* All Events */}
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h3 style={{ fontSize: '15px', margin: 0, color: 'var(--text-primary)' }}>All Events (recent)</h3>
                  <button onClick={loadOnboardingEvents} style={{
                    padding: '6px 12px', background: 'var(--role-color)', color: 'var(--bg-card)', border: 'none',
                    borderRadius: '6px', fontSize: '12px', cursor: 'pointer',
                  }}>Refresh</button>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                        <th style={{ padding: '6px 8px' }}>Time</th>
                        <th style={{ padding: '6px 8px' }}>Flow</th>
                        <th style={{ padding: '6px 8px' }}>Type</th>
                        <th style={{ padding: '6px 8px' }}>Step</th>
                        <th style={{ padding: '6px 8px' }}>User</th>
                        <th style={{ padding: '6px 8px' }}>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(obEvents.events || []).map(e => {
                        const flowColors = { login: '#0369a1', registration: 'var(--color-purple-light)', onboarding: 'var(--role-color)', password_reset: 'var(--color-warning)', demo: '#6b7280' };
                        const eFlow = e.flow || 'onboarding';
                        return (
                        <tr key={e.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={{ padding: '6px 8px', whiteSpace: 'nowrap', color: 'var(--text-tertiary)' }}>
                            {(parseTimestamp(e.created_at) || new Date(0)).toLocaleString()}
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <span style={{
                              padding: '2px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: 600,
                              background: (flowColors[eFlow] || 'var(--text-muted)') + '18', color: flowColors[eFlow] || 'var(--text-muted)',
                            }}>{eFlow}</span>
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <span style={{
                              padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 600,
                              background: e.event_type === 'error' ? 'var(--bg-error-subtle)' : e.event_type.includes('success') || e.event_type.includes('complete') ? 'var(--color-success-bg)' : '#f0f9ff',
                              color: e.event_type === 'error' ? 'var(--color-error)' : e.event_type.includes('success') || e.event_type.includes('complete') ? '#059669' : '#0369a1',
                            }}>{e.event_type}</span>
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            {e.step ? `${e.step}. ${e.step_name || ''}` : '—'}
                          </td>
                          <td style={{ padding: '6px 8px', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {e.email || e.user_id || '—'}
                          </td>
                          <td style={{ padding: '6px 8px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-secondary)' }}>
                            {e.error_message || '—'}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Customer Service Tab ─── */}
      {activeTab === 'customerservice' && (
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Customer Service — Flagged Reviews</h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
            Reviews rated below 3 stars are automatically flagged for admin review. Triage each one, add notes, and mark as reviewed, escalated, or resolved.
          </p>

          {/* Summary badges */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            {[
              { key: 'pending', label: 'Pending', color: 'var(--color-warning)', bg: 'var(--color-warning-bg)' },
              { key: 'flagged', label: 'Flagged', color: 'var(--color-error)', bg: 'var(--color-error-bg)' },
              { key: 'reviewed', label: 'Reviewed', color: 'var(--color-info)', bg: 'var(--color-info-bg)' },
              { key: 'escalated', label: 'Escalated', color: 'var(--color-purple)', bg: 'var(--color-purple-bg)' },
              { key: 'resolved', label: 'Resolved', color: 'var(--color-success)', bg: 'var(--color-success-bg)' },
            ].map(b => (
              <div key={b.key} onClick={() => setCsFilter(b.key)} style={{
                padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: csFilter === b.key ? b.color : b.bg,
                color: csFilter === b.key ? 'var(--text-on-primary)' : b.color,
                border: `1px solid ${b.color}`,
                transition: 'all 0.15s',
              }}>
                {b.label} {csCounts[b.key] != null ? `(${csCounts[b.key]})` : ''}
              </div>
            ))}
            <div onClick={() => setCsFilter('all')} style={{
              padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: csFilter === 'all' ? 'var(--text-secondary)' : 'var(--bg-primary)',
              color: csFilter === 'all' ? 'var(--text-on-primary)' : 'var(--text-secondary)',
              border: '1px solid #ccc',
            }}>
              All ({csCounts.total_flagged || 0})
            </div>
          </div>

          {csLoading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading reviews...</div>
          ) : csReviews.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', background: 'var(--bg-neutral)', borderRadius: 12 }}>
              No {csFilter !== 'all' ? csFilter : 'flagged'} reviews found.
            </div>
          ) : (
            <div>
              {csReviews.map((r) => {
                const isExpanded = csExpanded === r.id;
                const stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
                const statusColors = { pending: 'var(--color-warning)', flagged: 'var(--color-error)', reviewed: 'var(--color-info)', escalated: 'var(--color-purple)', resolved: 'var(--color-success)', ok: 'var(--text-muted)' };
                const st = r.admin_status || 'pending';
                return (
                  <div key={r.id} style={{
                    marginBottom: 10, borderRadius: 12, border: '1px solid #e0e0e0',
                    background: st === 'flagged' || st === 'pending' ? '#fffbf5' : 'var(--bg-card)',
                    overflow: 'hidden',
                  }}>
                    {/* Review header — clickable to expand */}
                    <div onClick={() => { setCsExpanded(isExpanded ? null : r.id); setCsNotes(r.admin_notes || ''); }}
                      style={{ padding: '14px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ color: 'var(--accent-color)', fontSize: 16, letterSpacing: 1 }}>{stars}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{r.caregiver_name}</span>
                          <span style={{
                            padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                            background: statusColors[st] + '20', color: statusColors[st],
                            textTransform: 'uppercase',
                          }}>{st}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          From {r.family_name} • {r.recipient_name || 'Care Visit'}
                          {r.service_type ? ` • ${r.service_type}` : ''}
                          {r.scheduled_date ? ` • ${new Date(r.scheduled_date).toLocaleDateString()}` : ''}
                        </div>
                        {r.comment && (
                          <div style={{ fontSize: 13, color: 'var(--text-primary)', marginTop: 6, fontStyle: 'italic' }}>
                            "{r.comment.length > 120 && !isExpanded ? r.comment.slice(0, 120) + '...' : r.comment}"
                          </div>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {new Date(r.created_at).toLocaleDateString()}
                        <div style={{ marginTop: 2 }}>{isExpanded ? '▲' : '▼'}</div>
                      </div>
                    </div>

                    {/* Expanded detail + actions */}
                    {isExpanded && (
                      <div style={{ padding: '0 16px 16px', borderTop: '1px solid #f0f0f0' }}>
                        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 12, marginBottom: 12 }}>
                          <div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>Caregiver</div>
                            <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{r.caregiver_name}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                              Overall: {'★'.repeat(Math.round(r.caregiver_rating_avg || 0))} {r.caregiver_rating_avg || 'N/A'} ({r.caregiver_rating_count || 0} reviews)
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>Family</div>
                            <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{r.family_name}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r.family_email}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>Session</div>
                            <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                              {r.scheduled_date ? new Date(r.scheduled_date).toLocaleDateString() : 'N/A'}
                              {r.scheduled_time ? ` at ${r.scheduled_time}` : ''}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r.review_type === 'late_cancellation' ? 'Late cancellation review' : 'Session review'}</div>
                          </div>
                        </div>

                        {r.comment && (
                          <div style={{ padding: '10px 14px', background: 'var(--bg-neutral)', borderRadius: 8, marginBottom: 12, fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                            {r.comment}
                          </div>
                        )}

                        {r.admin_reviewed_at && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                            Last reviewed by {r.reviewed_by_name || 'admin'} on {new Date(r.admin_reviewed_at).toLocaleString()}
                          </div>
                        )}

                        <div style={{ marginBottom: 12 }}>
                          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Admin Notes</label>
                          <textarea value={csNotes} onChange={(e) => setCsNotes(e.target.value)}
                            placeholder="Add internal notes about this review (optional)..."
                            style={{ width: '100%', minHeight: 60, padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
                        </div>

                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {st !== 'reviewed' && (
                            <button disabled={csActionLoading === r.id} onClick={() => handleCsAction(r.id, 'reviewed')}
                              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--color-info)', color: 'var(--bg-card)', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: csActionLoading === r.id ? 0.6 : 1 }}>
                              Mark Reviewed
                            </button>
                          )}
                          {st !== 'escalated' && (
                            <button disabled={csActionLoading === r.id} onClick={() => handleCsAction(r.id, 'escalated')}
                              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--color-purple)', color: 'var(--text-on-primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: csActionLoading === r.id ? 0.6 : 1 }}>
                              Escalate
                            </button>
                          )}
                          {st !== 'resolved' && (
                            <button disabled={csActionLoading === r.id} onClick={() => handleCsAction(r.id, 'resolved')}
                              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--color-success)', color: 'var(--text-on-primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: csActionLoading === r.id ? 0.6 : 1 }}>
                              Resolve
                            </button>
                          )}
                          {st !== 'pending' && (
                            <button disabled={csActionLoading === r.id} onClick={() => handleCsAction(r.id, 'pending')}
                              style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #ccc', background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: csActionLoading === r.id ? 0.6 : 1 }}>
                              Reset to Pending
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── Financials Tab ─── */}
      {activeTab === 'financials' && <AdminFinancials />}

      {/* ─── Help/FAQ Management Tab ─── */}
      {activeTab === 'help' && (
        <div>
          {/* Header with Add button */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, color: 'var(--role-color)' }}>Help Articles ({helpArticles.length})</h3>
            <button onClick={() => openHelpEditor()} style={{
              padding: '8px 16px', background: 'var(--role-color)', color: 'var(--bg-card)', border: 'none',
              borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
            }}>+ New Article</button>
          </div>

          {helpLoading && <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>Loading...</div>}

          {/* Articles table */}
          {!helpLoading && helpArticles.map(article => (
            <div key={article.id} className="card" style={{
              marginBottom: '8px', opacity: article.is_published ? 1 : 0.5,
              border: article.is_published ? '1px solid #e5e5e5' : '1px solid #ffa500',
            }}>
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', background: 'var(--badge-muted-bg)',
                      borderRadius: '4px', fontSize: '11px', fontWeight: 600, marginRight: '8px'
                    }}>{article.category}</span>
                    {!article.is_published && <span style={{ color: 'var(--accent-color)', fontWeight: 600 }}>DRAFT</span>}
                    {article.link_page && <span style={{ color: 'var(--role-color)', marginLeft: '8px' }}>→ {article.link_page}</span>}
                  </div>
                  <div style={{ fontWeight: 500, fontSize: '14px', marginBottom: '4px' }}>{article.question}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', maxHeight: '40px', overflow: 'hidden' }}>
                    {article.answer?.slice(0, 120)}{article.answer?.length > 120 ? '...' : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                  <button onClick={() => openHelpEditor(article)} style={{
                    padding: '6px 12px', background: 'var(--badge-muted-bg)', border: 'none',
                    borderRadius: '6px', cursor: 'pointer', fontSize: '12px'
                  }}>Edit</button>
                  <button onClick={() => toggleHelpPublished(article)} style={{
                    padding: '6px 12px', background: article.is_published ? 'var(--color-warning-bg)' : 'var(--color-success-bg)',
                    border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px'
                  }}>{article.is_published ? 'Unpublish' : 'Publish'}</button>
                </div>
              </div>
            </div>
          ))}

          {/* Edit/Create Modal */}
          {helpEditModal && (
            <div style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', zIndex: 1000, padding: '20px',
            }} onClick={(e) => { if (e.target === e.currentTarget) setHelpEditModal(null); }}>
              <div style={{
                background: 'var(--bg-surface)', borderRadius: '16px', padding: '24px',
                maxWidth: '600px', width: '100%', maxHeight: '80vh', overflow: 'auto',
              }}>
                <h3 style={{ margin: '0 0 16px', color: 'var(--role-color)' }}>
                  {helpEditModal.id ? 'Edit Article' : 'New Help Article'}
                </h3>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Category</label>
                  <select value={helpForm.category} onChange={e => setHelpForm({...helpForm, category: e.target.value})}
                    style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px' }}>
                    <option value="getting-started">Getting Started</option>
                    <option value="families">For Families</option>
                    <option value="caregivers">For Caregivers</option>
                    <option value="technical">Technical</option>
                    <option value="billing">Billing</option>
                  </select>
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Question</label>
                  <input type="text" value={helpForm.question} onChange={e => setHelpForm({...helpForm, question: e.target.value})}
                    placeholder="How do I...?" style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} />
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Answer</label>
                  <textarea value={helpForm.answer} onChange={e => setHelpForm({...helpForm, answer: e.target.value})}
                    placeholder="Use **bold** for emphasis. Each line becomes a paragraph."
                    rows={6} style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', resize: 'vertical' }} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Link to page (optional)</label>
                    <input type="text" value={helpForm.link_page} onChange={e => setHelpForm({...helpForm, link_page: e.target.value})}
                      placeholder="e.g. schedule, caregivers" style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Link label</label>
                    <input type="text" value={helpForm.link_label} onChange={e => setHelpForm({...helpForm, link_label: e.target.value})}
                      placeholder="e.g. Go to Schedule" style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} />
                  </div>
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Sort order</label>
                  <input type="number" value={helpForm.sort_order} onChange={e => setHelpForm({...helpForm, sort_order: parseInt(e.target.value) || 0})}
                    style={{ width: '80px', padding: '8px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px' }} />
                </div>

                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button onClick={() => setHelpEditModal(null)} style={{
                    padding: '8px 20px', background: 'var(--badge-muted-bg)', border: 'none',
                    borderRadius: '8px', cursor: 'pointer', fontSize: '14px',
                  }}>Cancel</button>
                  <button onClick={saveHelpArticle} style={{
                    padding: '8px 20px', background: 'var(--role-color)', color: 'var(--bg-card)', border: 'none',
                    borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: 600,
                  }}>{helpEditModal.id ? 'Save Changes' : 'Create Article'}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Security Tab ─── */}
      {activeTab === 'security' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Security Monitor</h2>
            <div style={{ display: 'flex', gap: 6 }}>
              {['dashboard', 'audit-log'].map(v => (
                <button key={v} onClick={() => setSecView(v)} style={{
                  padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  background: secView === v ? 'var(--role-color)' : 'var(--badge-muted-bg)', color: secView === v ? 'var(--bg-card)' : 'var(--text-secondary)',
                  border: secView === v ? 'none' : '1px solid #ddd',
                }}>{v === 'dashboard' ? 'Dashboard' : 'Audit Log'}</button>
              ))}
              <button onClick={() => { loadSecDashboard(); loadSecAuditLog(); }} style={{
                padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: 'var(--bg-surface)', color: 'var(--role-color)', border: '1px solid #1b6b5a',
              }}>Refresh</button>
            </div>
          </div>

          {secLoading && !secDashboard ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading security data...</div>
          ) : secView === 'dashboard' && secDashboard ? (
            <div>
              {/* Active threats banner */}
              {secDashboard.activeThreats?.length > 0 && (
                <div style={{ padding: '12px 16px', background: 'var(--color-error-bg)', border: '2px solid #c62828', borderRadius: 12, marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, color: 'var(--color-error)', fontSize: 14, marginBottom: 6 }}>Active Threats Detected</div>
                  {secDashboard.activeThreats.map((t, i) => (
                    <div key={i} style={{ fontSize: 13, color: 'var(--color-error)', marginBottom: 2 }}>
                      IP {t.ip}: {t.failedCount} failed login attempts since {new Date(t.since).toLocaleTimeString()}
                    </div>
                  ))}
                </div>
              )}

              {/* Severity summary cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 16 }}>
                {[
                  { key: 'critical', label: 'Critical', color: 'var(--color-error)', bg: 'var(--color-error-bg)' },
                  { key: 'error', label: 'Errors', color: 'var(--color-warning)', bg: 'var(--color-warning-bg)' },
                  { key: 'warn', label: 'Warnings', color: 'var(--color-warning)', bg: '#fffde7' },
                  { key: 'info', label: 'Info', color: 'var(--color-info)', bg: 'var(--color-info-bg)' },
                ].map(s => {
                  const count = secDashboard.severityCounts?.find(c => c.severity === s.key)?.count || 0;
                  return (
                    <div key={s.key} style={{ padding: '14px 16px', borderRadius: 12, background: s.bg, textAlign: 'center' }}>
                      <div style={{ fontSize: 28, fontWeight: 700, color: s.color }}>{count}</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: s.color, textTransform: 'uppercase' }}>{s.label} (24h)</div>
                    </div>
                  );
                })}
              </div>

              {/* Failed logins */}
              {secDashboard.failedLogins?.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-error)', marginBottom: 8 }}>Failed Login Attempts (24h)</div>
                  <div style={{ background: 'var(--bg-surface)', border: '1px solid #e0e0e0', borderRadius: 12, overflow: 'hidden' }}>
                    {secDashboard.failedLogins.map((f, i) => (
                      <div key={i} style={{ padding: '10px 14px', borderBottom: i < secDashboard.failedLogins.length - 1 ? '1px solid #f0f0f0' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{f.user_email || 'Unknown'}</span>
                          <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 8 }}>from {f.ip_address}</span>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontWeight: 700, color: f.count >= 10 ? 'var(--color-error)' : 'var(--color-warning)', fontSize: 14 }}>{f.count}x</span>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{new Date(f.last_attempt).toLocaleTimeString()}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Admin access */}
              {secDashboard.adminAccess?.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>Admin Access (24h)</div>
                  <div style={{ background: 'var(--bg-surface)', border: '1px solid #e0e0e0', borderRadius: 12, overflow: 'hidden' }}>
                    {secDashboard.adminAccess.map((a, i) => (
                      <div key={i} style={{ padding: '10px 14px', borderBottom: i < secDashboard.adminAccess.length - 1 ? '1px solid #f0f0f0' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{a.user_email}</span>
                          <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 8 }}>from {a.ip_address}</span>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{a.count} requests</span>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Last: {new Date(a.last_access).toLocaleTimeString()}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Top actions */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>Activity by Action (24h)</div>
                <div style={{ background: 'var(--bg-surface)', border: '1px solid #e0e0e0', borderRadius: 12, overflow: 'hidden' }}>
                  {(secDashboard.topActions || []).map((a, i) => (
                    <div key={i} style={{ padding: '8px 14px', borderBottom: i < (secDashboard.topActions || []).length - 1 ? '1px solid #f5f5f5' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{a.action.replace(/_/g, ' ')}</span>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{a.unique_users} users \u00B7 {a.unique_ips} IPs</span>
                        <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--role-color)', minWidth: 30, textAlign: 'right' }}>{a.count}</span>
                      </div>
                    </div>
                  ))}
                  {(!secDashboard.topActions || secDashboard.topActions.length === 0) && (
                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No activity recorded yet</div>
                  )}
                </div>
              </div>

              {/* Critical events */}
              {secDashboard.criticalEvents?.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-error)', marginBottom: 8 }}>Critical & Error Events (7 days)</div>
                  <div style={{ background: 'var(--bg-surface)', border: '1px solid #e0e0e0', borderRadius: 12, overflow: 'hidden' }}>
                    {secDashboard.criticalEvents.map((e, i) => {
                      const det = typeof e.details === 'string' ? JSON.parse(e.details || '{}') : (e.details || {});
                      return (
                        <div key={i} style={{ padding: '10px 14px', borderBottom: i < secDashboard.criticalEvents.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                            <div>
                              <span style={{
                                padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, marginRight: 6,
                                background: e.severity === 'critical' ? 'var(--color-error)' : 'var(--color-warning)', color: 'var(--bg-card)',
                              }}>{e.severity.toUpperCase()}</span>
                              <span style={{ fontWeight: 600, fontSize: 13 }}>{e.action.replace(/_/g, ' ')}</span>
                              <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 6 }}>{e.method} {e.endpoint}</span>
                            </div>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{new Date(e.created_at).toLocaleString()}</span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                            {e.user_email || 'Anonymous'} from {e.ip_address}
                            {det.anomaly && <span style={{ color: 'var(--color-error)', fontWeight: 600, marginLeft: 8 }}>{det.anomaly.replace(/_/g, ' ')}</span>}
                            {det.statusCode && <span style={{ marginLeft: 8 }}>HTTP {det.statusCode}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : secView === 'audit-log' ? (
            <div>
              {/* Filters */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                <select value={secLogFilter.severity} onChange={(e) => { setSecLogFilter({ ...secLogFilter, severity: e.target.value }); setSecLogPage(0); }}
                  style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 12 }}>
                  <option value="all">All Severities</option>
                  <option value="critical">Critical</option>
                  <option value="error">Error</option>
                  <option value="warn">Warning</option>
                  <option value="info">Info</option>
                </select>
                <select value={secLogFilter.action} onChange={(e) => { setSecLogFilter({ ...secLogFilter, action: e.target.value }); setSecLogPage(0); }}
                  style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 12 }}>
                  <option value="all">All Actions</option>
                  <option value="admin_access">Admin Access</option>
                  <option value="login_attempt">Login Attempts</option>
                  <option value="registration">Registration</option>
                  <option value="password_reset">Password Reset</option>
                  <option value="session_action">Session Actions</option>
                  <option value="document_access">Document Access</option>
                  <option value="care_recipient_access">Care Recipient Access</option>
                  <option value="caregiver_profile_access">Caregiver Profile</option>
                  <option value="passkey_auth">Passkey Auth</option>
                </select>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)', alignSelf: 'center' }}>{secAuditTotal} total entries</span>
              </div>

              {/* Log entries */}
              <div style={{ background: 'var(--bg-surface)', border: '1px solid #e0e0e0', borderRadius: 12, overflow: 'hidden' }}>
                {secAuditLog.length === 0 ? (
                  <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No audit log entries found. Activity will appear here once the system logs requests.</div>
                ) : secAuditLog.map((entry, i) => {
                  const sevColors = { critical: 'var(--color-error)', error: 'var(--color-warning)', warn: 'var(--color-warning)', info: '#90a4ae' };
                  const det = typeof entry.details === 'string' ? JSON.parse(entry.details || '{}') : (entry.details || {});
                  return (
                    <div key={entry.id || i} style={{ padding: '8px 14px', borderBottom: i < secAuditLog.length - 1 ? '1px solid #f5f5f5' : 'none', fontSize: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, flexWrap: 'wrap' }}>
                          <span style={{
                            width: 8, height: 8, borderRadius: 4, display: 'inline-block',
                            background: sevColors[entry.severity] || 'var(--border-light)',
                          }} />
                          <span style={{ fontWeight: 600 }}>{entry.action?.replace(/_/g, ' ')}</span>
                          <span style={{ color: 'var(--text-tertiary)' }}>{entry.method} {entry.endpoint}</span>
                          {det.anomaly && <span style={{ color: 'var(--color-error)', fontWeight: 600, background: 'var(--color-error-bg)', padding: '1px 6px', borderRadius: 4, fontSize: 10 }}>{det.anomaly.replace(/_/g, ' ')}</span>}
                        </div>
                        <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{new Date(entry.created_at).toLocaleString()}</span>
                      </div>
                      <div style={{ color: 'var(--text-tertiary)', marginTop: 2 }}>
                        {entry.user_email || 'anonymous'} \u00B7 {entry.ip_address} \u00B7 HTTP {det.statusCode || '?'} \u00B7 {det.durationMs || 0}ms
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Pagination */}
              {secAuditTotal > 30 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 12 }}>
                  <button disabled={secLogPage === 0} onClick={() => setSecLogPage(p => p - 1)}
                    style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #ddd', background: 'var(--bg-surface)', fontSize: 12, cursor: secLogPage === 0 ? 'default' : 'pointer', opacity: secLogPage === 0 ? 0.5 : 1 }}>
                    Previous
                  </button>
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)', alignSelf: 'center' }}>
                    Page {secLogPage + 1} of {Math.ceil(secAuditTotal / 30)}
                  </span>
                  <button disabled={(secLogPage + 1) * 30 >= secAuditTotal} onClick={() => setSecLogPage(p => p + 1)}
                    style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #ddd', background: 'var(--bg-surface)', fontSize: 12, cursor: (secLogPage + 1) * 30 >= secAuditTotal ? 'default' : 'pointer', opacity: (secLogPage + 1) * 30 >= secAuditTotal ? 0.5 : 1 }}>
                    Next
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading...</div>
          )}
        </div>
      )}

      {/* ─── Blocked Emails Tab ─── */}
      {activeTab === 'blocked' && (
        <div>
          {/* Add blocked email form */}
          <div className="card" style={{ marginBottom: '16px' }}>
            <div className="card-header"><span className="card-icon">🚫</span>Block an Email</div>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
              Blocked emails cannot register or create accounts. They'll see a generic error message.
            </p>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 220px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Email</label>
                <input type="email" placeholder="user@example.com" value={blockEmailInput}
                  onChange={(e) => setBlockEmailInput(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px', boxSizing: 'border-box' }} />
              </div>
              <div style={{ flex: '1 1 180px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Reason (optional)</label>
                <input type="text" placeholder="e.g. Spam, abuse" value={blockReasonInput}
                  onChange={(e) => setBlockReasonInput(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px', boxSizing: 'border-box' }} />
              </div>
              <button onClick={handleBlockEmail} disabled={blockLoading || !blockEmailInput.trim()}
                style={{
                  padding: '10px 20px', background: blockLoading || !blockEmailInput.trim() ? 'var(--border-light)' : 'var(--color-error)',
                  color: 'var(--text-on-primary)', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600,
                  cursor: blockLoading ? 'wait' : 'pointer', whiteSpace: 'nowrap',
                }}>
                {blockLoading ? '...' : 'Block Email'}
              </button>
            </div>
          </div>

          {/* Blocked emails list */}
          <div className="card">
            <div className="card-header"><span className="card-icon">📋</span>Blocked Emails ({blockedEmails.length})</div>
            {blockedEmails.length > 0 ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>Email</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>Reason</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>Blocked By</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>Date</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--text-secondary)', fontWeight: 600 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {blockedEmails.map(b => (
                    <tr key={b.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 500 }}>{b.email}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{b.reason || '—'}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{b.blocked_by_name || '—'}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-tertiary)', fontSize: '12px' }}>{formatDate(b.created_at)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <button onClick={() => handleUnblockEmail(b.id)}
                          style={{ padding: '4px 12px', background: 'var(--color-success-bg)', color: 'var(--color-success)', border: '1px solid #c8e6c9', borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
                          Unblock
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>No blocked emails</div>
            )}
          </div>
        </div>
      )}

      {/* ─── Authorizations Tab ─── */}
      {activeTab === 'authorizations' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ margin: 0, fontSize: '18px' }}>Care Authorizations</h2>
            <div style={{ display: 'flex', gap: '6px' }}>
              {['', 'pending', 'attested', 'verified', 'rejected', 'revoked'].map(f => (
                <button key={f} onClick={() => { setAuthzFilter(f); setTimeout(loadAuthorizations, 0); }}
                  style={{
                    padding: '6px 12px', borderRadius: '6px', border: 'none', fontSize: '12px', fontWeight: 600,
                    cursor: 'pointer',
                    background: authzFilter === f ? 'var(--role-color)' : 'var(--badge-muted-bg)',
                    color: authzFilter === f ? 'var(--text-on-primary)' : 'var(--text-secondary)',
                  }}>
                  {f || 'All'}
                </button>
              ))}
            </div>
          </div>
          {authzLoading && <LoadingSpinner text="Loading authorizations..." />}
          {!authzLoading && authzList.length === 0 && (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>No authorization records found.</div>
          )}
          {!authzLoading && authzList.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e0e0e0', textAlign: 'left' }}>
                    <th style={{ padding: '10px 8px' }}>Recipient</th>
                    <th style={{ padding: '10px 8px' }}>Family Member</th>
                    <th style={{ padding: '10px 8px' }}>Tier</th>
                    <th style={{ padding: '10px 8px' }}>Status</th>
                    <th style={{ padding: '10px 8px' }}>Sessions</th>
                    <th style={{ padding: '10px 8px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {authzList.map(a => {
                    const tierLabels = { tier1: 'Self-signup', tier2: 'POA/Guardian', tier3: 'Family consent', unset: 'Unset' };
                    const statusColors = { verified: 'var(--role-color)', pending: 'var(--accent-color)', attested: '#1565C0', rejected: 'var(--color-error)', revoked: 'var(--text-muted)' };
                    return (
                      <tr key={a.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '10px 8px', fontWeight: 600 }}>{a.first_name} {a.last_name}</td>
                        <td style={{ padding: '10px 8px' }}>{a.family_first_name} {a.family_last_name}<br /><span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{a.family_email}</span></td>
                        <td style={{ padding: '10px 8px' }}>
                          <span style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
                            background: a.authorization_tier === 'tier1' ? 'var(--bg-teal-light)' : a.authorization_tier === 'tier2' ? 'var(--color-purple-bg)' : 'var(--color-warning-bg)',
                            color: a.authorization_tier === 'tier1' ? 'var(--role-color)' : a.authorization_tier === 'tier2' ? 'var(--color-indigo)' : 'var(--accent-color)',
                          }}>{tierLabels[a.authorization_tier] || a.authorization_tier}</span>
                        </td>
                        <td style={{ padding: '10px 8px' }}>
                          <span style={{ color: statusColors[a.consent_status] || 'var(--text-muted)', fontWeight: 600 }}>
                            {a.consent_status === 'verified' ? '\u2705' : a.consent_status === 'attested' ? '\u{1F4DD}' : a.consent_status === 'pending' ? '\u23F3' : a.consent_status === 'rejected' ? '\u274C' : '\u{1F6AB}'} {a.consent_status}
                          </span>
                          {a.attestation_signed_at && (
                            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                              Attested by {a.attestation_signer || 'N/A'} on {new Date(a.attestation_signed_at).toLocaleDateString()}
                            </div>
                          )}
                          {a.attestation_relationship && (
                            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                              Relationship: {a.attestation_relationship}
                            </div>
                          )}
                          {a.recipient_email && a.authorization_tier === 'tier3' && (
                            <div style={{ fontSize: '11px', color: 'var(--color-info)', marginTop: '2px' }}>
                              {'\u{1F4E7}'} Recipient: {a.recipient_email}
                            </div>
                          )}
                          {a.outreach_response && (
                            <div style={{
                              fontSize: '11px', marginTop: '4px', padding: '3px 8px', borderRadius: '4px',
                              background: a.outreach_response === 'yes_aware' ? 'var(--color-success-bg)' : a.outreach_response === 'did_not_authorize' ? 'var(--color-error-bg)' : 'var(--color-warning-bg)',
                              color: a.outreach_response === 'yes_aware' ? 'var(--color-success)' : a.outreach_response === 'did_not_authorize' ? 'var(--color-error)' : 'var(--color-warning)',
                              fontWeight: 600,
                            }}>
                              {a.outreach_response === 'yes_aware' ? '\u2705 Aware' : a.outreach_response === 'did_not_authorize' ? '\u{1F6A8} Not authorized' : '\u2753 Has questions'}
                              {a.outreach_response_notes && <span style={{ fontWeight: 400, marginLeft: '4px' }}>— "{a.outreach_response_notes}"</span>}
                            </div>
                          )}
                          {a.outreach_sent_to && !a.outreach_response && (
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px', fontStyle: 'italic' }}>
                              Outreach sent, awaiting response...
                            </div>
                          )}
                          {a.bookings_paused === 1 && (
                            <div style={{ fontSize: '11px', color: 'var(--color-error)', fontWeight: 600, marginTop: '4px' }}>
                              {'\u{1F6D1}'} Bookings paused{a.bookings_paused_reason ? `: ${a.bookings_paused_reason}` : ''}
                            </div>
                          )}
                          {a.doc_id && (
                            <div style={{ fontSize: '11px', color: 'var(--color-indigo)', marginTop: '4px' }}>
                              {'\u{1F4C4}'} {a.doc_type?.replace('_', ' ') || 'Document'}: {a.doc_file_name || 'file'}
                              <span style={{ marginLeft: '6px', padding: '1px 6px', borderRadius: '3px', fontSize: '10px', fontWeight: 600,
                                background: a.doc_upload_status === 'approved' ? 'var(--bg-teal-light)' : a.doc_upload_status === 'rejected' ? 'var(--color-error-bg)' : 'var(--color-warning-bg)',
                                color: a.doc_upload_status === 'approved' ? 'var(--role-color)' : a.doc_upload_status === 'rejected' ? 'var(--color-error)' : 'var(--accent-color)',
                              }}>{a.doc_upload_status}</span>
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '10px 8px', textAlign: 'center' }}>{a.session_count || 0}</td>
                        <td style={{ padding: '10px 8px' }}>
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            {a.doc_id && (
                              <button onClick={() => handleDocPreview(a.doc_id)} disabled={docPreviewLoading}
                                style={{ padding: '4px 10px', borderRadius: '4px', border: 'none', fontSize: '11px', fontWeight: 600, cursor: 'pointer', background: 'var(--color-purple-bg)', color: 'var(--color-indigo)' }}>
                                {'\u{1F50D}'} Preview
                              </button>
                            )}
                            {a.consent_status !== 'verified' && (
                              <button onClick={() => handleAuthzAction(a.id, 'approve')} disabled={authzActionLoading === a.id}
                                style={{ padding: '4px 10px', borderRadius: '4px', border: 'none', fontSize: '11px', fontWeight: 600, cursor: 'pointer', background: 'var(--bg-teal-light)', color: 'var(--role-color)' }}>
                                Approve
                              </button>
                            )}
                            {a.consent_status !== 'rejected' && a.consent_status !== 'verified' && (
                              <button onClick={() => { setRejectModal({ id: a.id, name: `${a.first_name} ${a.last_name}` }); setRejectNotes(''); }}
                                disabled={authzActionLoading === a.id}
                                style={{ padding: '4px 10px', borderRadius: '4px', border: 'none', fontSize: '11px', fontWeight: 600, cursor: 'pointer', background: 'var(--color-error-bg)', color: 'var(--color-error)' }}>
                                Reject
                              </button>
                            )}
                            {a.bookings_paused === 1 && (
                              <button onClick={() => {
                                if (!confirm(`Unpause bookings for ${a.first_name} ${a.last_name}? This will allow new sessions to be scheduled.`)) return;
                                handleAuthzAction(a.id, 'unpause');
                              }} disabled={authzActionLoading === a.id}
                                style={{ padding: '4px 10px', borderRadius: '4px', border: 'none', fontSize: '11px', fontWeight: 600, cursor: 'pointer', background: 'var(--role-color)', color: 'var(--bg-card)' }}>
                                {'\u2705'} Unpause Bookings
                              </button>
                            )}
                            {a.consent_status === 'verified' && (
                              <button onClick={() => handleAuthzAction(a.id, 'revoke')} disabled={authzActionLoading === a.id}
                                style={{ padding: '4px 10px', borderRadius: '4px', border: 'none', fontSize: '11px', fontWeight: 600, cursor: 'pointer', background: 'var(--bg-primary)', color: 'var(--text-muted)' }}>
                                Revoke
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Document Preview Modal */}
          {docPreview && (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onClick={() => setDocPreview(null)}>
              <div style={{ background: 'var(--bg-surface)', borderRadius: '12px', padding: '24px', maxWidth: '800px', width: '90%', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
                onClick={e => e.stopPropagation()}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h3 style={{ margin: 0, fontSize: '16px' }}>{'\u{1F4C4}'} {docPreview.fileName}</h3>
                  <button onClick={() => setDocPreview(null)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--text-muted)' }}>{'\u2715'}</button>
                </div>
                <div style={{ flex: 1, overflow: 'auto', minHeight: '300px' }}>
                  {docPreview.mimeType === 'application/pdf' ? (
                    <iframe src={docPreview.fileData} style={{ width: '100%', height: '60vh', border: '1px solid #e0e0e0', borderRadius: '8px' }} title="Document preview" />
                  ) : (
                    <img src={docPreview.fileData} alt={docPreview.fileName} style={{ maxWidth: '100%', maxHeight: '60vh', borderRadius: '8px', border: '1px solid #e0e0e0' }} />
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Reject Reason Modal */}
          {rejectModal && (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onClick={() => setRejectModal(null)}>
              <div style={{ background: 'var(--bg-surface)', borderRadius: '12px', padding: '24px', maxWidth: '480px', width: '90%' }}
                onClick={e => e.stopPropagation()}>
                <h3 style={{ margin: '0 0 12px', fontSize: '16px' }}>{'\u274C'} Reject Authorization — {rejectModal.name}</h3>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 12px' }}>Provide a reason so the family knows what to correct:</p>
                <textarea value={rejectNotes} onChange={e => setRejectNotes(e.target.value)}
                  placeholder="e.g., Document is expired, signature is missing, illegible scan..."
                  style={{ width: '100%', minHeight: '100px', padding: '10px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '13px', resize: 'vertical', boxSizing: 'border-box' }} />
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
                  <button onClick={() => setRejectModal(null)}
                    style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #ddd', background: 'var(--bg-surface)', fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
                  <button onClick={handleRejectWithNotes} disabled={authzActionLoading === rejectModal.id}
                    style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: 'var(--color-error)', color: 'var(--bg-card)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
                    Reject Authorization
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Sessions Tab ─── */}
      {activeTab === 'sessions' && (
        <div>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700, color: 'var(--role-color)' }}>
            No-Show Cancelled Sessions
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
            Sessions auto-cancelled by the system when no check-in was recorded within 30 minutes. Use "Restore" to return a session to confirmed status if it was cancelled in error.
          </p>
          {noShowLoading ? (
            <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>Loading...</div>
          ) : noShowSessions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)', background: 'var(--bg-neutral)', borderRadius: '12px' }}>
              No system-cancelled no-show sessions found.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {noShowSessions.map(s => (
                <div key={s.id} style={{
                  background: s.status === 'cancelled' ? 'var(--bg-error-light)' : 'var(--bg-highlight)',
                  border: `1px solid ${s.status === 'cancelled' ? 'var(--color-error-bg)' : 'var(--color-success-bg)'}`,
                  borderRadius: '10px', padding: '14px 16px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px',
                }}>
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>
                      {s.recipient_name || 'Unknown'} — {s.scheduled_date} at {s.scheduled_time}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      Caregiver: {s.caregiver_name || 'None'} · Family: {s.family_name || 'Unknown'}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      Cancelled: {s.cancelled_at ? new Date(s.cancelled_at).toLocaleString() : '—'} · Status: {s.status}
                    </div>
                  </div>
                  {s.status === 'cancelled' && (
                    <button
                      onClick={() => handleRestoreSession(s.id)}
                      disabled={restoreLoading === s.id}
                      style={{
                        padding: '8px 18px', background: 'var(--role-color)', color: 'var(--bg-card)', border: 'none',
                        borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                        opacity: restoreLoading === s.id ? 0.5 : 1,
                      }}
                    >
                      {restoreLoading === s.id ? 'Restoring...' : 'Restore'}
                    </button>
                  )}
                  {s.status !== 'cancelled' && (
                    <span style={{ fontSize: '12px', color: 'var(--role-color)', fontWeight: 600 }}>Restored ✓</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Paused Caregivers — accounts paused after no-show */}
          <div className="card" style={{ marginTop: '20px' }}>
            <div className="card-header"><span className="card-icon">{'\u{1F6D1}'}</span>Paused Caregiver Accounts</div>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Caregivers whose accounts were automatically paused after a no-show. Use "Reinstate" to restore their account and make them available for jobs again.
            </p>
            {pausedLoading ? (
              <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>Loading...</div>
            ) : pausedCaregivers.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)', background: 'var(--bg-neutral)', borderRadius: '12px' }}>
                No paused caregiver accounts.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {pausedCaregivers.map(cg => (
                  <div key={cg.user_id} style={{
                    background: 'var(--bg-error-light)', border: '1px solid #ffcdd2',
                    borderRadius: '10px', padding: '14px 16px',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px',
                  }}>
                    <div style={{ flex: 1, minWidth: '200px' }}>
                      <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>
                        {cg.first_name} {cg.last_name}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        {cg.email} {'\u00B7'} {'\u2B50'} {cg.rating_avg || '—'} ({cg.rating_count || 0} reviews)
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--color-error)', marginTop: '4px', fontWeight: 600 }}>
                        {cg.account_paused_reason || 'No reason recorded'}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        Paused: {cg.account_paused_at ? new Date(cg.account_paused_at).toLocaleString() : '—'}
                        {' \u00B7 '} No-shows: {cg.no_show_count || 0} {' \u00B7 '} Completed: {cg.completed_count || 0}
                      </div>
                    </div>
                    <button
                      onClick={() => handleReinstate(cg.user_id)}
                      disabled={reinstateLoading === cg.user_id}
                      style={{
                        padding: '8px 18px', background: 'var(--role-color)', color: 'var(--bg-card)', border: 'none',
                        borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                        opacity: reinstateLoading === cg.user_id ? 0.5 : 1,
                      }}
                    >
                      {reinstateLoading === cg.user_id ? 'Reinstating...' : 'Reinstate'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Settings Tab ─── */}
      {activeTab === 'settings' && (() => {
        const prefs = user?.notification_prefs ? (typeof user.notification_prefs === 'string' ? JSON.parse(user.notification_prefs) : user.notification_prefs) : {};
        const togglePref = async (key, value) => {
          const newPrefs = { ...prefs, [key]: value };
          try {
            await apiFetch('/api/auth/me', { method: 'PUT', body: JSON.stringify({ notificationPrefs: newPrefs }) });
            setUser(prev => ({ ...prev, notification_prefs: JSON.stringify(newPrefs) }));
          } catch {}
        };
        const notifCategories = [
          {
            category: 'Signups & Registrations',
            events: [
              { event: 'waitlist_signup', label: 'New waitlist signups' },
              { event: 'new_signup_intent', label: 'Signup interest (email submitted)' },
              { event: 'new_registration', label: 'New account registrations' },
            ],
          },
          {
            category: 'Invites & Care Teams',
            events: [
              { event: 'invite_accepted', label: 'Invite accepted (joined InPlace or care team)' },
            ],
          },
          {
            category: 'Care Requests',
            events: [
              { event: 'care_request_created', label: 'New care request submitted' },
            ],
          },
        ];
        return (
          <div>
            <div className="card" style={{ padding: '16px' }}>
              <div className="card-header" style={{ marginBottom: '4px' }}>Admin Notification Preferences</div>
              <p style={{ fontSize: 13, color: 'var(--text-tertiary)', margin: '0 0 16px' }}>
                Choose how you're notified for each event type. Push sends to your phone; email goes to {user?.email || 'your email'}.
              </p>

              {notifCategories.map(cat => (
                <div key={cat.category} style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--role-color)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px', paddingBottom: '4px', borderBottom: '2px solid #e8f5e9' }}>
                    {cat.category}
                  </div>
                  {cat.events.map(({ event, label }) => {
                    const pushKey = `push_${event}`;
                    const emailKey = `email_${event}`;
                    const pushOn = prefs[pushKey] !== false; // push defaults ON
                    const emailOn = prefs[emailKey] === true; // email defaults OFF
                    return (
                      <div key={event} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 12px', marginBottom: '4px', borderRadius: '8px',
                        background: 'var(--bg-primary)', gap: '8px', flexWrap: 'wrap',
                      }}>
                        <span style={{ fontSize: '13px', color: 'var(--text-primary)', flex: 1, minWidth: '140px' }}>{label}</span>
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontSize: '12px' }}>
                            <input type="checkbox" checked={pushOn} onChange={(e) => togglePref(pushKey, e.target.checked)}
                              style={{ accentColor: 'var(--role-color)' }} />
                            <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                              <span style={{ fontSize: '14px' }}>🔔</span> Push
                            </span>
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontSize: '12px' }}>
                            <input type="checkbox" checked={emailOn} onChange={(e) => togglePref(emailKey, e.target.checked)}
                              style={{ accentColor: 'var(--accent-color)' }} />
                            <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                              <span style={{ fontSize: '14px' }}>📧</span> Email
                            </span>
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}

              <div style={{ marginTop: '12px', padding: '10px', background: 'var(--color-warning-bg)', borderRadius: '8px', fontSize: '12px', color: 'var(--text-brown)' }}>
                Push notifications require the app to be installed (Add to Home Screen). Email uses your Resend-verified sender.
              </div>
            </div>
          </div>
        );
      })()}
      {/* Onboarding Override Modal */}
      {onboardingModal && (
        <div className="modal-overlay" onClick={() => setOnboardingModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, maxHeight: '80vh', overflow: 'auto' }}>
            <button className="modal-close" onClick={() => setOnboardingModal(null)}>✕</button>
            <div className="modal-header" style={{ fontSize: '17px' }}>
              Caregiver Onboarding — {onboardingModal.user?.name || onboardingModal.user?.email}
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '16px' }}>{onboardingModal.user?.email}</div>

            {onboardingModal.flags ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {[
                  { key: 'stripeOnboardComplete', label: 'Stripe Connected', desc: 'Bank account linked via Stripe Connect' },
                  { key: 'backgroundCheckPaid', label: 'Background Check Paid', desc: 'Paid $30 fee for background check' },
                  { key: 'backgroundCheckCleared', label: 'Background Check Cleared', desc: 'Checkr returned OK (or admin override)' },
                  { key: 'onboardingComplete', label: 'Onboarding Complete', desc: 'All registration steps finished' },
                  { key: 'isAvailable', label: 'Available for Jobs', desc: 'Can see and accept care requests' },
                ].map(flag => (
                  <div key={flag.key} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '12px', background: onboardingModal.flags[flag.key] ? 'var(--color-success-bg)' : 'var(--color-error-bg)',
                    borderRadius: '8px', border: `1px solid ${onboardingModal.flags[flag.key] ? 'var(--color-success-bg)' : '#ef9a9a'}`,
                  }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>
                        {onboardingModal.flags[flag.key] ? '✅' : '❌'} {flag.label}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '2px' }}>{flag.desc}</div>
                    </div>
                    <button onClick={() => toggleOnboardingFlag(flag.key, onboardingModal.flags[flag.key])}
                      style={{
                        padding: '6px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
                        border: 'none', cursor: 'pointer',
                        background: onboardingModal.flags[flag.key] ? '#ef5350' : 'var(--role-color)',
                        color: 'var(--text-on-primary)',
                      }}>
                      {onboardingModal.flags[flag.key] ? 'Revoke' : 'Grant'}
                    </button>
                  </div>
                ))}

                {/* Extra info */}
                <div style={{ marginTop: '8px', padding: '12px', background: 'var(--bg-primary)', borderRadius: '8px', fontSize: '13px' }}>
                  <div style={{ fontWeight: 600, marginBottom: '6px', color: 'var(--text-secondary)' }}>Additional Info</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
                    <span style={{ color: 'var(--text-tertiary)' }}>BG Check Consent:</span>
                    <span>{onboardingModal.flags.backgroundCheckConsent ? 'Yes' : 'No'}</span>
                    <span style={{ color: 'var(--text-tertiary)' }}>Has Photo:</span>
                    <span>{onboardingModal.flags.hasPhoto ? 'Yes' : 'No'}</span>
                    <span style={{ color: 'var(--text-tertiary)' }}>Drivers License:</span>
                    <span>{onboardingModal.flags.hasDriversLicense ? 'Yes' : 'No'}</span>
                    <span style={{ color: 'var(--text-tertiary)' }}>Program Reports:</span>
                    <span>{onboardingModal.flags.needsHourReports ? 'Yes' : 'No'}</span>
                    {onboardingModal.flags.academicProgram && <>
                      <span style={{ color: 'var(--text-tertiary)' }}>Program:</span>
                      <span>{onboardingModal.flags.academicProgram}</span>
                      <span style={{ color: 'var(--text-tertiary)' }}>Program Year:</span>
                      <span>{onboardingModal.flags.academicProgramYear || '—'}</span>
                    </>}
                  </div>
                  {onboardingModal.documents?.length > 0 && (
                    <div style={{ marginTop: '8px' }}>
                      <span style={{ color: 'var(--text-tertiary)' }}>Uploaded docs:</span> {onboardingModal.documents.map(d => d.doc_type).join(', ')}
                    </div>
                  )}
                </div>

                <div style={{ marginTop: '8px', padding: '10px', background: 'var(--color-warning-bg)', borderRadius: '8px', fontSize: '12px', color: 'var(--text-brown)' }}>
                  Each flag is independent — grant only what you want to skip. For example, to skip the background check but keep Stripe setup required, grant "BG Check Paid" and "BG Check Cleared" but leave "Stripe Connected" off.
                </div>
              </div>
            ) : (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                No caregiver profile found for this user.
              </div>
            )}
          </div>
        </div>
      )}
      {/* ── BACKGROUND CHECKS TAB ── */}
      {activeTab === 'bgchecks' && (() => {
        const actionStatuses = ['consider', 'suspended', 'disputed', 'adverse_action', 'processing', 'invitation_sent', 'invitation_expired', 'invitation_canceled'];
        const filedStatuses = ['clear', 'consider_approved', 'rejected', 'did_not_pass'];
        const actionItems = bgCheckCandidates.filter(c => actionStatuses.includes(c.checkr_status) || ((!c.checkr_status || c.checkr_status === 'pending') && !c.is_background_checked && !c.bg_check_admin_approved));
        const filedItems = bgCheckCandidates.filter(c => filedStatuses.includes(c.checkr_status) || c.is_background_checked || c.bg_check_admin_approved);
        const checkrDashUrl = 'https://dashboard.checkrhq-staging.net';

        const getStatusColor = (s) => s === 'clear' ? 'var(--color-success)' : s === 'consider' ? 'var(--color-warning)' :
          s === 'adverse_action' ? 'var(--color-error)' : s === 'suspended' ? 'var(--color-warning)' : s === 'disputed' ? 'var(--color-purple)' :
          s === 'consider_approved' ? 'var(--color-success)' : s === 'rejected' ? 'var(--color-error)' : s === 'did_not_pass' ? 'var(--color-error)' :
          s === 'processing' ? 'var(--color-info)' : s === 'invitation_sent' ? 'var(--color-purple)' :
          s === 'invitation_expired' ? 'var(--text-tertiary)' : s === 'invitation_canceled' ? 'var(--text-tertiary)' : 'var(--text-secondary)';
        const getStatusIcon = (s) => s === 'clear' ? '\u2705' : s === 'consider' ? '\u26A0\uFE0F' :
          s === 'adverse_action' ? '\u{1F6A8}' : s === 'suspended' ? '\u26A0\uFE0F' : s === 'disputed' ? '\u2696\uFE0F' :
          s === 'consider_approved' ? '\u2705' : s === 'rejected' ? '\u274C' : s === 'did_not_pass' ? '\u{1F6AB}' :
          s === 'processing' ? '\u23F3' : s === 'invitation_sent' ? '\u{1F4E8}' :
          s === 'invitation_expired' ? '\u23F0' : s === 'invitation_canceled' ? '\u{1F6AB}' : '\u2022';
        const getStatusLabel = (s) => s === 'consider_approved' ? 'APPROVED (FLAGGED)' : s === 'rejected' ? 'REJECTED' :
          s === 'did_not_pass' ? 'DID NOT PASS' : s === 'invitation_canceled' ? 'CANCELED' :
          (s || 'pending').replace(/_/g, ' ').toUpperCase();
        const isHighlight = (s) => s === 'consider' || s === 'adverse_action' || s === 'suspended' || s === 'disputed' || s === 'did_not_pass';

        const renderCard = (c, faded) => {
          // For admin-approved caregivers without a checkr_status, treat as 'clear'
          const effectiveStatus = (!c.checkr_status || c.checkr_status === 'pending') && (c.is_background_checked || c.bg_check_admin_approved)
            ? 'clear' : c.checkr_status;
          const statusColor = getStatusColor(effectiveStatus);
          return (
            <div key={c.user_id} className="card" style={{
              border: isHighlight(effectiveStatus) ? '2px solid ' + statusColor : '1px solid #e5e7eb',
              padding: '14px 18px',
              opacity: faded ? 0.55 : 1,
              transition: 'opacity 0.3s ease',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
                    {c.legal_first_name || c.first_name} {c.legal_last_name || c.last_name}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{c.email}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                    <span>{getStatusIcon(effectiveStatus)}</span>
                    <span style={{ fontWeight: 600, fontSize: 13, color: statusColor }}>
                      {getStatusLabel(effectiveStatus)}
                      {c.bg_check_admin_approved && !c.checkr_candidate_id ? ' (Admin)' : ''}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    {c.checkr_candidate_id ? `Candidate: ${c.checkr_candidate_id.substring(0, 12)}...` : 'Not yet submitted'}
                    {c.checkr_report_id ? ` \u00B7 Report: ${c.checkr_report_id.substring(0, 12)}...` : ''}
                  </div>
                  {c.checkr_eta && effectiveStatus === 'processing' && (() => {
                    const eta = new Date(c.checkr_eta);
                    const now = new Date();
                    const diffMs = eta - now;
                    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                    const etaLabel = diffDays > 0 ? `~${diffDays} day${diffDays !== 1 ? 's' : ''} remaining` : 'Due any time now';
                    return (
                      <div style={{ fontSize: 11, color: 'var(--color-info)', marginTop: 2, fontStyle: 'italic' }}>
                        ETA: {eta.toLocaleDateString()} ({etaLabel})
                      </div>
                    );
                  })()}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {c.checkr_candidate_id && (
                    <a href={`${checkrDashUrl}/candidates/${c.checkr_candidate_id}`} target="_blank" rel="noopener noreferrer"
                      style={{ padding: '5px 12px', background: 'var(--color-info)', color: 'var(--bg-card)', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', textDecoration: 'none', textAlign: 'center' }}>
                      View on Checkr
                    </a>
                  )}
                  {c.checkr_report_id && (
                    <a href={`${checkrDashUrl}/reports/${c.checkr_report_id}`} target="_blank" rel="noopener noreferrer"
                      style={{ padding: '5px 12px', background: 'var(--bg-surface)', color: 'var(--color-info)', border: '1px solid #1565c0', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', textDecoration: 'none', textAlign: 'center' }}>
                      View Report
                    </a>
                  )}
                  {(c.checkr_status === 'consider' || c.checkr_status === 'disputed') && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={async () => {
                        if (!confirm(`Approve ${c.first_name} despite flagged background check?`)) return;
                        try {
                          await apiFetch(`/api/admin/users/${c.user_id}/approve`, { method: 'PUT' });
                          showToast('Caregiver approved — moved to Reviewed', 'success');
                          loadBgChecks();
                        } catch {}
                      }} style={{ padding: '4px 10px', background: 'var(--color-success)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                        Approve
                      </button>
                      <button onClick={() => { setRejectBgTarget({ userId: c.user_id, name: `${c.first_name} ${c.last_name}` }); setRejectBgReason(''); }}
                        style={{ padding: '4px 10px', background: 'var(--color-error)', color: 'var(--bg-card)', border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                        Reject
                      </button>
                    </div>
                  )}
                  <button onClick={() => { setAdminMsgTarget({ userId: c.user_id, name: `${c.first_name} ${c.last_name}` }); setAdminMsgText(''); }}
                    style={{ padding: '4px 10px', background: 'var(--bg-surface)', color: 'var(--role-color)', border: '1px solid #1b6b5a', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                    {'\u{1F4AC}'} Message
                  </button>
                </div>
              </div>
            </div>
          );
        };

        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Background Check Status</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                  {bgCheckCandidates.length} candidates{actionItems.length > 0 ? ` \u00B7 ${actionItems.length} need attention` : ''}
                </div>
              </div>
              <button onClick={loadBgChecks} style={{ padding: '6px 14px', background: 'var(--role-color)', color: 'var(--bg-card)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Refresh
              </button>
            </div>

            {bgCheckLoading ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>Loading background checks...</div>
            ) : bgCheckCandidates.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 40 }}>
                No caregivers have consented to background checks yet.
              </div>
            ) : (
              <div>
                {/* ─── ACTION REQUIRED ─── */}
                {actionItems.length > 0 && (
                  <div style={{ display: 'grid', gap: 10 }}>
                    {actionItems.map(c => renderCard(c, false))}
                  </div>
                )}

                {/* ─── DIVIDER ─── */}
                {filedItems.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '24px 0 16px' }}>
                    <div style={{ flex: 1, height: 1, background: 'var(--border-light)' }}></div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>
                      Reviewed ({filedItems.length})
                    </span>
                    <div style={{ flex: 1, height: 1, background: 'var(--border-light)' }}></div>
                  </div>
                )}

                {/* ─── REVIEWED / FILED ─── */}
                {filedItems.length > 0 && (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {filedItems.map(c => renderCard(c, true))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── SAFETY FLAGS TAB ── */}
      {activeTab === 'safety' && (
        typeof SafetyFlagsTab === 'function'
          ? React.createElement(SafetyFlagsTab, {
              safetyFlags, safetyLoading, safetyFlagCount,
              handleReviewFlag, loadSafetyFlags,
              apiFetch, showToast, currentUserId: currentUser?.id,
              flagPasskeyConfirm, flagPasskeyLoading, flagPasskeyError,
            })
          : React.createElement('div', { style: { padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' } }, 'Safety flags component loading... Please refresh the page.')
      )}

      {/* ── COSTS TAB ── */}
      {activeTab === 'costs' && (
        <div>
          {/* Recurring Expenses */}
          <div className="card">
            <div className="card-header">Recurring Expenses</div>
            {(costSummary.length > 0 && costRecurring.length > 0) ? (
              <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
                {costRecurring.map(r => (
                  editingRecurring === r.id ? (
                    // Edit mode - inline form
                    <div key={r.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 12px', background: 'var(--color-success-bg)', borderRadius: 8, border: '1px solid #bbf7d0' }}>
                      <div>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{r.category}</span>
                        <span style={{ marginLeft: 6, fontSize: 10, background: 'var(--color-success-bg)', color: 'var(--color-success)', padding: '1px 6px', borderRadius: 4 }}>
                          {r.recurrence === 'monthly' ? '/mo' : '/yr'} since {r.start_month}
                        </span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <input
                          type="number"
                          step="0.01"
                          placeholder="Amount"
                          value={editRecurringData.amount !== undefined ? editRecurringData.amount : r.amount}
                          onChange={e => setEditRecurringData({ ...editRecurringData, amount: parseFloat(e.target.value) || '' })}
                          style={{ padding: '6px 8px', border: '1px solid #ddd', borderRadius: 4, fontSize: 12 }}
                        />
                        <input
                          type="text"
                          placeholder="Description"
                          value={editRecurringData.description !== undefined ? editRecurringData.description : (r.description || '')}
                          onChange={e => setEditRecurringData({ ...editRecurringData, description: e.target.value })}
                          style={{ padding: '6px 8px', border: '1px solid #ddd', borderRadius: 4, fontSize: 12 }}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => { setEditingRecurring(null); setEditRecurringData({}); }}
                          style={{ padding: '4px 12px', background: 'var(--bg-primary)', color: 'var(--text-secondary)', border: '1px solid #ddd', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}>
                          Cancel
                        </button>
                        <button
                          onClick={() => handleDeactivateRecurring(r.id)}
                          disabled={recurSaving}
                          style={{ padding: '4px 12px', background: recurSaving ? 'var(--border-light)' : 'var(--color-warning-bg)', color: 'var(--color-warning)', border: '1px solid #ffc107', borderRadius: 4, fontSize: 11, cursor: recurSaving ? 'not-allowed' : 'pointer' }}>
                          Deactivate
                        </button>
                        <button
                          onClick={() => handleSaveRecurring(r.id)}
                          disabled={recurSaving}
                          style={{ padding: '4px 12px', background: recurSaving ? 'var(--text-muted)' : 'var(--role-color)', color: 'var(--bg-card)', border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: recurSaving ? 'not-allowed' : 'pointer' }}>
                          {recurSaving ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    // View mode - regular display
                    <div key={r.id} onClick={() => { setEditingRecurring(r.id); setEditRecurringData({ amount: r.amount, description: r.description }); }} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--color-success-bg)', borderRadius: 8, border: '1px solid #bbf7d0', cursor: 'pointer' }}>
                      <div>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{r.category}</span>
                        <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-tertiary)' }}>{r.description || ''}</span>
                        <span style={{ marginLeft: 6, fontSize: 10, background: 'var(--color-success-bg)', color: 'var(--color-success)', padding: '1px 6px', borderRadius: 4 }}>
                          {r.recurrence === 'monthly' ? '/mo' : '/yr'} since {r.start_month}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 700, fontSize: 13 }}>${parseFloat(r.amount).toFixed(2)}</span>
                        <button onClick={async (e) => { e.stopPropagation(); if (!confirm(`Remove ${r.category} recurring expense?`)) return; try { const res = await apiFetch(`/api/costs/recurring/${r.id}`, { method: 'DELETE' }); if (res?.ok) loadCosts(); } catch {} }}
                          style={{ padding: '2px 6px', background: 'var(--bg-surface)', color: 'var(--color-error)', border: '1px solid #ddd', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}>
                          {'\u2715'}
                        </button>
                      </div>
                    </div>
                  )
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 12 }}>No recurring expenses yet.</div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <select value={newRecurring.category || ''} onChange={e => setNewRecurring({ ...newRecurring, category: e.target.value })}
                style={{ padding: 8, border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }}>
                <option value="">Category...</option>
                {costCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={newRecurring.recurrence || 'monthly'} onChange={e => setNewRecurring({ ...newRecurring, recurrence: e.target.value })}
                style={{ padding: 8, border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }}>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
              <input type="number" step="0.01" placeholder="Amount ($)" value={newRecurring.amount || ''}
                onChange={e => setNewRecurring({ ...newRecurring, amount: e.target.value })}
                style={{ padding: 8, border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }} />
              <input type="month" value={newRecurring.start_month || new Date().toISOString().substring(0, 7)}
                onChange={e => setNewRecurring({ ...newRecurring, start_month: e.target.value })}
                style={{ padding: 8, border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }} />
            </div>
            <input type="text" placeholder="Description (e.g. Railway Hobby plan)" value={newRecurring.description || ''}
              onChange={e => setNewRecurring({ ...newRecurring, description: e.target.value })}
              style={{ width: '100%', padding: 8, border: '1px solid #ddd', borderRadius: 8, fontSize: 13, marginBottom: 8, boxSizing: 'border-box' }} />
            <button onClick={handleAddRecurring} disabled={recurSaving || !newRecurring.category || !newRecurring.amount}
              style={{ padding: '6px 16px', background: !newRecurring.category || !newRecurring.amount ? 'var(--text-muted)' : 'var(--role-color)', color: 'var(--bg-card)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {recurSaving ? 'Adding...' : 'Add Recurring'}
            </button>
          </div>

          {/* One-time expense entry */}
          <div className="card">
            <div className="card-header">Add One-Time Expense</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <select value={newCost.category} onChange={e => setNewCost({ ...newCost, category: e.target.value })}
                style={{ padding: 8, border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }}>
                <option value="">Category...</option>
                {costCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input type="month" value={newCost.period_month} onChange={e => setNewCost({ ...newCost, period_month: e.target.value })}
                style={{ padding: 8, border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }} />
              <input type="number" step="0.01" placeholder="Amount ($)" value={newCost.amount}
                onChange={e => setNewCost({ ...newCost, amount: e.target.value })}
                style={{ padding: 8, border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }} />
              <input type="text" placeholder="Description" value={newCost.description}
                onChange={e => setNewCost({ ...newCost, description: e.target.value })}
                style={{ padding: 8, border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }} />
            </div>
            <input type="text" placeholder="Notes (e.g. legal fees, LLC filing Mar 2026)" value={newCost.notes || ''}
              onChange={e => setNewCost({ ...newCost, notes: e.target.value })}
              style={{ width: '100%', padding: 8, border: '1px solid #ddd', borderRadius: 8, fontSize: 13, marginBottom: 8, boxSizing: 'border-box' }} />
            <button onClick={handleAddCost} disabled={costSaving || !newCost.category || !newCost.amount}
              style={{ padding: '6px 16px', background: !newCost.category || !newCost.amount ? 'var(--text-muted)' : 'var(--role-color)', color: 'var(--bg-card)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {costSaving ? 'Saving...' : 'Add One-Time'}
            </button>
          </div>

          {/* Monthly Summary */}
          {costLoading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>Loading costs...</div>
          ) : costSummary.filter(m => m.total > 0).length === 0 ? (
            <div className="card" style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 40 }}>
              No cost data yet. Add recurring expenses or one-time entries above.
            </div>
          ) : (
            <>
              {costSummary.filter(m => m.total > 0).map(month => (
                <div key={month.month} className="card" style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                        {new Date(month.month + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                      </div>
                      {month.runningTotal !== undefined && (
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Running total: ${month.runningTotal.toFixed(2)}</div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 22, fontWeight: 800, color: month.total > 0 ? 'var(--color-error)' : 'var(--text-tertiary)' }}>
                        ${month.total.toFixed(2)}
                      </div>
                    </div>
                  </div>
                  {Object.keys(month.categories).length > 0 && (
                    <div style={{ display: 'grid', gap: 4 }}>
                      {Object.entries(month.categories).sort((a, b) => b[1].amount - a[1].amount).map(([cat, data]) => (
                        <div key={cat}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: 'var(--bg-primary)', borderRadius: 6, fontSize: 13 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontWeight: 600 }}>{cat}</span>
                              {data.source === 'auto' && (
                                <span style={{ fontSize: 9, background: 'var(--color-info-bg)', color: 'var(--color-info)', padding: '1px 5px', borderRadius: 3 }}>auto</span>
                              )}
                              {data.source === 'recurring' && (
                                <span style={{ fontSize: 9, background: 'var(--color-success-bg)', color: 'var(--color-success)', padding: '1px 5px', borderRadius: 3 }}>recurring</span>
                              )}
                            </div>
                            <span style={{ fontWeight: 700 }}>${data.amount.toFixed(2)}</span>
                          </div>
                          {/* Individual manual entries with edit/notes */}
                          {(data.entries || []).map(entry => (
                            editingCost === entry.id ? (
                              <div key={entry.id} style={{ margin: '4px 0 4px 16px', padding: '8px 10px', background: 'var(--color-success-bg)', borderRadius: 6, border: '1px solid #bbf7d0' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                                  <select value={editCostData.category || cat} onChange={e => setEditCostData({ ...editCostData, category: e.target.value })}
                                    style={{ padding: '5px 8px', border: '1px solid #ddd', borderRadius: 4, fontSize: 12 }}>
                                    {costCategories.map(c => <option key={c} value={c}>{c}</option>)}
                                  </select>
                                  <input type="number" step="0.01" value={editCostData.amount !== undefined ? editCostData.amount : entry.amount}
                                    onChange={e => setEditCostData({ ...editCostData, amount: e.target.value })}
                                    style={{ padding: '5px 8px', border: '1px solid #ddd', borderRadius: 4, fontSize: 12 }} placeholder="Amount" />
                                  <input type="text" value={editCostData.description !== undefined ? editCostData.description : (entry.description || '')}
                                    onChange={e => setEditCostData({ ...editCostData, description: e.target.value })}
                                    style={{ padding: '5px 8px', border: '1px solid #ddd', borderRadius: 4, fontSize: 12 }} placeholder="Description" />
                                  <input type="month" value={editCostData.period_month || month.month}
                                    onChange={e => setEditCostData({ ...editCostData, period_month: e.target.value })}
                                    style={{ padding: '5px 8px', border: '1px solid #ddd', borderRadius: 4, fontSize: 12 }} />
                                </div>
                                <input type="text" value={editCostData.notes !== undefined ? editCostData.notes : (entry.notes || '')}
                                  onChange={e => setEditCostData({ ...editCostData, notes: e.target.value })}
                                  style={{ width: '100%', padding: '5px 8px', border: '1px solid #ddd', borderRadius: 4, fontSize: 12, boxSizing: 'border-box', marginBottom: 6 }}
                                  placeholder="Notes (e.g. legal fees, LLC filing Mar 2026)" />
                                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                  <button onClick={() => { setEditingCost(null); setEditCostData({}); }}
                                    style={{ padding: '3px 10px', background: 'var(--bg-primary)', color: 'var(--text-secondary)', border: '1px solid #ddd', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}>
                                    Cancel
                                  </button>
                                  <button onClick={() => handleDeleteCost(entry.id)}
                                    style={{ padding: '3px 10px', background: 'var(--color-warning-bg)', color: 'var(--color-warning)', border: '1px solid #ffc107', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}>
                                    Delete
                                  </button>
                                  <button onClick={() => handleSaveCost(entry.id)} disabled={costSaving}
                                    style={{ padding: '3px 10px', background: costSaving ? 'var(--text-muted)' : 'var(--role-color)', color: 'var(--bg-card)', border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: costSaving ? 'not-allowed' : 'pointer' }}>
                                    {costSaving ? 'Saving...' : 'Save'}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div key={entry.id} onClick={() => { setEditingCost(entry.id); setEditCostData({ category: cat, amount: entry.amount, description: entry.description || '', notes: entry.notes || '', period_month: month.month }); }}
                                style={{ margin: '4px 0 4px 16px', padding: '4px 10px', background: 'var(--bg-surface)', borderRadius: 4, border: '1px solid #eee', fontSize: 12, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                                <div style={{ flex: 1 }}>
                                  <span style={{ color: 'var(--text-secondary)' }}>{entry.description || cat}</span>
                                  {entry.notes && (
                                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2, fontStyle: 'italic' }}>
                                      {'\u{1F4DD}'} {entry.notes}
                                    </div>
                                  )}
                                </div>
                                <span style={{ fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>${entry.amount.toFixed(2)}</span>
                              </div>
                            )
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ── FREEZE CAREGIVER MODAL ── */}
      {freezeTarget && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={(e) => { if (e.target === e.currentTarget) setFreezeTarget(null); }}>
          <div style={{ background: 'var(--bg-surface)', borderRadius: 16, padding: 24, maxWidth: 480, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-error)', marginBottom: 4 }}>
              {'\u{1F6D1}'} Freeze {freezeTarget.name}'s Account
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 16 }}>
              This will pause their account, hide them from job listings, and prevent them from accepting work. They'll see a "Account Paused" banner when they log in.
            </div>
            <input
              value={freezeReason}
              onChange={(e) => setFreezeReason(e.target.value)}
              placeholder="Reason for freezing (required)..."
              style={{ width: '100%', padding: 12, border: '2px solid #e5e7eb', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 8 }}
              autoFocus
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 14 }}>
              This reason will be visible to the caregiver on their dashboard.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setFreezeTarget(null)}
                style={{ padding: '8px 20px', background: 'var(--bg-primary)', color: 'var(--text-secondary)', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handleFreezeCaregiver} disabled={freezeSending || !freezeReason.trim()}
                style={{ padding: '8px 20px', background: freezeSending || !freezeReason.trim() ? 'var(--text-muted)' : 'var(--color-error)', color: 'var(--bg-card)', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                {freezeSending ? 'Freezing...' : 'Freeze Account'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── BG CHECK REJECTION MODAL ── */}
      {rejectBgTarget && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={(e) => { if (e.target === e.currentTarget) setRejectBgTarget(null); }}>
          <div style={{ background: 'var(--bg-surface)', borderRadius: 16, padding: 24, maxWidth: 480, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-error)', marginBottom: 4 }}>
              {'\u274C'} Reject {rejectBgTarget.name}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 16 }}>
              This will mark their background check as rejected. They can still log in but will see a rejection notice and can message you to appeal.
            </div>
            <textarea
              value={rejectBgReason}
              onChange={(e) => setRejectBgReason(e.target.value)}
              placeholder="Reason for rejection (required)..."
              rows={3}
              style={{ width: '100%', padding: 12, border: '2px solid #e5e7eb', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 8, resize: 'vertical' }}
              autoFocus
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 14 }}>
              The caregiver will receive a message with this reason and instructions to appeal.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setRejectBgTarget(null)}
                style={{ padding: '8px 20px', background: 'var(--bg-primary)', color: 'var(--text-secondary)', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handleRejectBgCheck} disabled={rejectBgSending || !rejectBgReason.trim()}
                style={{ padding: '8px 20px', background: rejectBgSending || !rejectBgReason.trim() ? 'var(--text-muted)' : 'var(--color-error)', color: 'var(--bg-card)', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                {rejectBgSending ? 'Rejecting...' : 'Reject Caregiver'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADMIN SERVICE MESSAGE MODAL ── */}
      {adminMsgTarget && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={(e) => { if (e.target === e.currentTarget) setAdminMsgTarget(null); }}>
          <div style={{ background: 'var(--bg-surface)', borderRadius: 16, padding: 24, maxWidth: 480, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
              {'\u{1F4AC}'} Message {adminMsgTarget.name}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 16 }}>
              Sent as <strong>InPlace Support</strong> — {adminMsgTarget.name} will see this in their Messages
            </div>
            <textarea
              value={adminMsgText}
              onChange={(e) => setAdminMsgText(e.target.value)}
              placeholder={`Hi ${adminMsgTarget.name.split(' ')[0]}, we noticed you missed your session...`}
              style={{ width: '100%', minHeight: 120, padding: 12, border: '2px solid #e5e7eb', borderRadius: 10, fontSize: 14, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: 10, marginTop: 14, justifyContent: 'flex-end' }}>
              <button onClick={() => setAdminMsgTarget(null)}
                style={{ padding: '8px 20px', background: 'var(--bg-primary)', color: 'var(--text-secondary)', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handleAdminMessage} disabled={adminMsgSending || !adminMsgText.trim()}
                style={{ padding: '8px 20px', background: adminMsgSending || !adminMsgText.trim() ? 'var(--text-muted)' : 'var(--role-color)', color: 'var(--bg-card)', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                {adminMsgSending ? 'Sending...' : 'Send as InPlace Support'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
