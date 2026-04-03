// ─── Admin / Superuser Dashboard ───
// Only visible to users with is_admin = 1. Layered on top of normal family account.
const AdminPanel = window.AdminPanel = ({ currentUser }) => {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userDrawer, setUserDrawer] = useState(null);
  const [userDrawerLoading, setUserDrawerLoading] = useState(false);
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
  // Tickets tab state
  const [tickets, setTickets] = useState([]);
  const [ticketCount, setTicketCount] = useState(0);
  const [ticketLoading, setTicketLoading] = useState(false);
  const [ticketFilter, setTicketFilter] = useState({ status: '', category: '', priority: '' });
  const [ticketCounts, setTicketCounts] = useState({});
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [ticketComments, setTicketComments] = useState([]);
  const [newTicketComment, setNewTicketComment] = useState('');
  const [adminUsers, setAdminUsers] = useState([]);

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

  const loadTickets = async () => {
    setTicketLoading(true);
    try {
      const params = new URLSearchParams();
      if (ticketFilter.status) params.set('status', ticketFilter.status);
      if (ticketFilter.category) params.set('category', ticketFilter.category);
      if (ticketFilter.priority) params.set('priority', ticketFilter.priority);
      const res = await apiFetch(`/api/admin/tickets?${params.toString()}`);
      if (res?.ok) {
        const data = await res.json();
        setTickets(data.tickets || []);
        // Build counts map
        const cm = {};
        (data.counts || []).forEach(c => { cm[c.status] = c.count; });
        setTicketCounts(cm);
        setTicketCount((cm.open || 0) + (cm.in_progress || 0));
      }
    } catch (err) { console.error('Load tickets error:', err); }
    setTicketLoading(false);
  };

  const loadTicketDetail = async (id) => {
    try {
      const res = await apiFetch(`/api/admin/tickets/${id}`);
      if (res?.ok) {
        const data = await res.json();
        setSelectedTicket(data.ticket);
        setTicketComments(data.comments || []);
      }
    } catch (err) { console.error('Load ticket detail error:', err); }
  };

  const updateTicket = async (id, updates) => {
    try {
      const res = await apiFetch(`/api/admin/tickets/${id}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      if (res?.ok) {
        showToast('Ticket updated', 'success');
        loadTickets();
        if (selectedTicket?.id === id) loadTicketDetail(id);
      }
    } catch (err) { showToast('Failed to update ticket', 'error'); }
  };

  const addTicketComment = async (ticketId) => {
    if (!newTicketComment.trim()) return;
    try {
      const res = await apiFetch(`/api/admin/tickets/${ticketId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content: newTicketComment, isInternal: true }),
      });
      if (res?.ok) {
        setNewTicketComment('');
        loadTicketDetail(ticketId);
        showToast('Comment added', 'success');
      }
    } catch (err) { showToast('Failed to add comment', 'error'); }
  };

  const loadUserDetail = async (userId) => {
    setUserDrawerLoading(true);
    setUserDrawer(null);
    try {
      const res = await apiFetch(`/api/admin/users/${userId}/detail`);
      if (res?.ok) {
        const data = await res.json();
        setUserDrawer(data);
      }
    } catch (err) { console.error('Load user detail error:', err); }
    setUserDrawerLoading(false);
  };

  const saveAdminNotes = async (userId, notes) => {
    try {
      const res = await apiFetch(`/api/admin/users/${userId}/admin-notes`, {
        method: 'PUT',
        body: JSON.stringify({ admin_notes: notes }),
      });
      if (res?.ok) {
        showToast('Notes saved', 'success');
        if (userDrawer?.user?.id === userId) {
          setUserDrawer(prev => ({ ...prev, user: { ...prev.user, admin_notes: notes } }));
        }
      }
    } catch (err) { showToast('Failed to save notes', 'error'); }
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
  // All Ratings tab state
  const [allReviews, setAllReviews] = useState([]);
  const [allReviewsTotal, setAllReviewsTotal] = useState(0);
  const [allReviewsStats, setAllReviewsStats] = useState(null);
  const [allReviewsDist, setAllReviewsDist] = useState([]);
  const [reviewInsights, setReviewInsights] = useState(null);
  const [reviewSort, setReviewSort] = useState('date');
  const [reviewOrder, setReviewOrder] = useState('desc');
  const [reviewRatingFilter, setReviewRatingFilter] = useState(null); // null = all
  const [allReviewsLoading, setAllReviewsLoading] = useState(false);
  const [allReviewsExpanded, setAllReviewsExpanded] = useState(null);
  // Admin iPAi briefing
  const [adminBriefing, setAdminBriefing] = useState(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingDismissed, setBriefingDismissed] = useState(false);
  // Security tab state
  const [secDashboard, setSecDashboard] = useState(null);
  const [secAuditLog, setSecAuditLog] = useState([]);
  const [secAuditTotal, setSecAuditTotal] = useState(0);
  const [secLoading, setSecLoading] = useState(false);
  const [secLogFilter, setSecLogFilter] = useState({ severity: 'all', action: 'all' });
  const [secLogPage, setSecLogPage] = useState(0);
  const [secView, setSecView] = useState('dashboard'); // 'dashboard' or 'audit-log'
  const [secInsights, setSecInsights] = useState(null);
  // IP verification state
  const [ipVerifyModal, setIpVerifyModal] = useState(null); // { ip }
  const [ipVerifyLoading, setIpVerifyLoading] = useState(false);
  const [ipVerifyError, setIpVerifyError] = useState(null);
  const [trustedIps, setTrustedIps] = useState([]);
  // Account approvals state
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [approvalLoading, setApprovalLoading] = useState(null);
  // Legal docs management
  const [legalDocs, setLegalDocs] = useState([]);
  const [legalAcceptances, setLegalAcceptances] = useState(null);
  const [legalPublishing, setLegalPublishing] = useState(false);
  const [legalDraft, setLegalDraft] = useState({ docType: 'terms', version: '', title: '', content: '', changeSummary: '' });
  const [legalMsg, setLegalMsg] = useState('');
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

  // Sessions tab — all sessions browser + detail drill-down
  const [allSessions, setAllSessions] = useState([]);
  const [allSessionsLoading, setAllSessionsLoading] = useState(false);
  const [sessionStatusFilter, setSessionStatusFilter] = useState('all');
  const [sessionDaysFilter, setSessionDaysFilter] = useState(30);
  const [sessionDetail, setSessionDetail] = useState(null);
  const [sessionDetailLoading, setSessionDetailLoading] = useState(false);

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

  // Document Review tab
  const [pendingDocs, setPendingDocs] = useState([]);
  const [pendingDocsCount, setPendingDocsCount] = useState(0);
  const [pendingDocsLoading, setPendingDocsLoading] = useState(false);
  const [reviewingDocId, setReviewingDocId] = useState(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [expandedDocId, setExpandedDocId] = useState(null);

  const loadPendingDocs = async () => {
    setPendingDocsLoading(true);
    try {
      const res = await apiFetch('/api/documents/admin/pending');
      if (res?.ok) {
        const data = await res.json();
        setPendingDocs(data.documents || []);
        setPendingDocsCount(Number(data.count) || 0);
      }
    } catch (err) { console.error('Pending docs load error:', err); }
    setPendingDocsLoading(false);
  };

  const loadPendingDocsCount = async () => {
    try {
      const res = await apiFetch('/api/documents/admin/count');
      if (res?.ok) {
        const data = await res.json();
        setPendingDocsCount(Number(data.count) || 0);
      }
    } catch (err) { /* silent */ }
  };

  const handleDocReview = async (docId, action) => {
    setReviewingDocId(docId);
    try {
      const res = await apiFetch(`/api/documents/admin/${docId}/review`, {
        method: 'POST',
        body: JSON.stringify({ action, notes: reviewNotes }),
      });
      if (res?.ok) {
        showToast(`Document ${action}d`, 'success');
        setReviewNotes('');
        setExpandedDocId(null);
        loadPendingDocs();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || `Failed to ${action}`, 'error');
      }
    } catch (err) { showToast('Network error', 'error'); }
    setReviewingDocId(null);
  };

  const loadLegalDocs = async () => {
    try {
      const [docsRes, accRes] = await Promise.all([
        apiFetch('/api/legal/admin/documents'),
        apiFetch('/api/legal/admin/acceptances'),
      ]);
      if (docsRes?.ok) { const d = await docsRes.json(); setLegalDocs(d.documents || []); }
      if (accRes?.ok) setLegalAcceptances(await accRes.json());
    } catch (err) { console.error('Legal docs load error:', err); }
  };

  const publishLegalDoc = async () => {
    if (!legalDraft.version || !legalDraft.title || !legalDraft.content) {
      setLegalMsg('Version, title, and content are required');
      return;
    }
    setLegalPublishing(true); setLegalMsg('');
    try {
      const res = await apiFetch('/api/legal/admin/publish', {
        method: 'POST',
        body: JSON.stringify({
          docType: legalDraft.docType,
          version: legalDraft.version,
          title: legalDraft.title,
          content: legalDraft.content,
          changeSummary: legalDraft.changeSummary || undefined,
        }),
      });
      if (res?.ok) {
        const d = await res.json();
        setLegalMsg(d.message || 'Published!');
        setLegalDraft({ docType: 'terms', version: '', title: '', content: '', changeSummary: '' });
        loadLegalDocs();
      } else {
        const err = await res.json().catch(() => ({}));
        setLegalMsg(err.error || 'Failed to publish');
      }
    } catch { setLegalMsg('Network error'); }
    setLegalPublishing(false);
  };

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

  // ─── All Sessions browser ───
  const loadAllSessions = async (status, days) => {
    setAllSessionsLoading(true);
    try {
      const s = status || sessionStatusFilter;
      const d = days || sessionDaysFilter;
      const res = await apiFetch(`/api/admin/sessions/all?status=${s}&days=${d}`);
      if (res?.ok) { const data = await res.json(); setAllSessions(data.sessions || []); }
    } catch {}
    setAllSessionsLoading(false);
  };

  const loadSessionDetail = async (sessionId) => {
    setSessionDetailLoading(true);
    try {
      const res = await apiFetch(`/api/admin/sessions/${sessionId}/detail`);
      if (res?.ok) {
        const data = await res.json();
        setSessionDetail(data);
      }
    } catch (err) { console.error('Session detail load error:', err); }
    setSessionDetailLoading(false);
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
    // Fetch pending doc review count for badge
    loadPendingDocsCount();
    // Fetch new feedback count for tab badge
    apiFetch('/api/admin/alerts').then(r => r?.ok ? r.json() : null).then(d => {
      if (d) {
        setNewFeedbackCount(d.newFeedback || 0);
        // Note: safetyFlagCount is set authoritatively by loadSafetyFlags() above
        // (alerts endpoint returns deltas which can be 0 even when flags exist)
        setCheckrAlertCount(d.checkrAlerts || 0);
        setBgCheckActionItems(d.bgCheckActionItems || []);
      }
    }).catch(() => {});
    // Fetch admin users for ticket assignment
    apiFetch('/api/admin/users?role=&demo=all&search=').then(r => r?.ok ? r.json() : null).then(d => {
      if (d?.users) setAdminUsers(d.users.filter(u => u.admin_role));
    }).catch(() => {});
    // Fetch ticket counts for badge
    apiFetch('/api/admin/tickets?limit=1').then(r => r?.ok ? r.json() : null).then(d => {
      if (d?.counts) {
        const cm = {};
        d.counts.forEach(c => { cm[c.status] = Number(c.count) || 0; });
        setTicketCounts(cm);
        setTicketCount((cm.open || 0) + (cm.in_progress || 0));
      }
    }).catch(() => {});
    // Fetch current user for settings tab
    apiFetch('/api/auth/me').then(r => r.json()).then(data => setUser(data)).catch(() => {});
  }, []);

  // ─── IP Verification Listener ───
  useEffect(() => {
    const handler = (e) => {
      setIpVerifyModal({ ip: e.detail.ip });
      setIpVerifyError(null);
    };
    window.addEventListener('ip-verification-required', handler);
    return () => window.removeEventListener('ip-verification-required', handler);
  }, []);

  const handleIpVerify = async () => {
    setIpVerifyLoading(true);
    setIpVerifyError(null);
    try {
      // Step 1: Get passkey challenge
      const challengeRes = await apiFetch('/api/admin/ip-verify/challenge', { method: 'POST' });
      if (!challengeRes?.ok) {
        const err = await challengeRes?.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to get challenge');
      }
      const challengeData = await challengeRes.json();

      // If auto-trusted (no passkey on file), just reload
      if (challengeData.autoTrusted) {
        setIpVerifyModal(null);
        showToast(challengeData.message, 'success');
        window.location.reload();
        return;
      }

      // Step 2: Trigger browser passkey prompt
      const { startAuthentication } = await import('/js/passkey-helpers.js').catch(() => {
        // Fallback: use @simplewebauthn/browser if bundled
        return window.SimpleWebAuthnBrowser || {};
      });

      // Use native WebAuthn API directly as fallback
      const publicKey = {
        challenge: Uint8Array.from(atob(challengeData.challenge.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
        rpId: challengeData.rpId || window.location.hostname,
        allowCredentials: (challengeData.allowCredentials || []).map(c => ({
          id: Uint8Array.from(atob(c.id.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0)),
          type: 'public-key',
          transports: c.transports,
        })),
        userVerification: challengeData.userVerification || 'required',
        timeout: 60000,
      };

      const assertion = await navigator.credentials.get({ publicKey });

      // Encode response for server
      const toB64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
      const verifyBody = {
        id: toB64url(assertion.rawId),
        rawId: toB64url(assertion.rawId),
        response: {
          authenticatorData: toB64url(assertion.response.authenticatorData),
          clientDataJSON: toB64url(assertion.response.clientDataJSON),
          signature: toB64url(assertion.response.signature),
          userHandle: assertion.response.userHandle ? toB64url(assertion.response.userHandle) : undefined,
        },
        type: assertion.type,
        clientExtensionResults: assertion.getClientExtensionResults(),
        authenticatorAttachment: assertion.authenticatorAttachment,
      };

      // Step 3: Verify with server
      const verifyRes = await apiFetch('/api/admin/ip-verify/verify', {
        method: 'POST',
        body: JSON.stringify(verifyBody),
      });

      if (!verifyRes?.ok) {
        const err = await verifyRes?.json().catch(() => ({}));
        throw new Error(err.error || 'Verification failed');
      }

      const result = await verifyRes.json();
      setIpVerifyModal(null);
      showToast(result.message || 'IP verified!', 'success');
      window.location.reload(); // Reload to retry all admin requests
    } catch (err) {
      console.error('IP verification error:', err);
      setIpVerifyError(err.name === 'NotAllowedError' ? 'Passkey verification was cancelled. Try again.' : (err.message || 'Verification failed'));
    }
    setIpVerifyLoading(false);
  };

  // Load trusted IPs for security tab
  const loadTrustedIps = async () => {
    try {
      const res = await apiFetch('/api/admin/security/trusted-ips');
      if (res?.ok) setTrustedIps((await res.json()).trustedIps || []);
    } catch (err) { console.error('Trusted IPs load error:', err); }
  };

  const revokeIp = async (ipId) => {
    try {
      const res = await apiFetch(`/api/admin/security/trusted-ips/${ipId}`, { method: 'DELETE' });
      if (res?.ok) {
        showToast('IP removed from trusted list', 'success');
        loadTrustedIps();
      }
    } catch (err) { showToast('Failed to revoke IP', 'error'); }
  };

  useEffect(() => {
    if (activeTab === 'people') { loadUsers(); loadWaitlist(); loadInvites(); loadCareTeamInvites(); }
    if (activeTab === 'activity') loadActivity();
    if (activeTab === 'feedback') loadFeedback();
    if (activeTab === 'blocked') loadBlockedEmails();
    if (activeTab === 'help') loadHelpArticles();
    if (activeTab === 'onboarding') loadOnboardingEvents();
    if (activeTab === 'authorizations') loadAuthorizations();
    if (activeTab === 'customerservice') loadCsReviews();
    if (activeTab === 'tickets') loadTickets();
    if (activeTab === 'security') { loadSecDashboard(); loadSecAuditLog(); loadTrustedIps(); }
    if (activeTab === 'sessions') { loadNoShowSessions(); loadPausedCaregivers(); loadAllSessions(); }
    if (activeTab === 'safety') loadSafetyFlags();
    if (activeTab === 'bgchecks') {
      loadBgChecks();
      // Mark Checkr alerts as read when viewing the tab
      if (checkrAlertCount > 0) {
        apiFetch('/api/admin/alerts/dismiss-checkr', { method: 'POST' }).then(() => setCheckrAlertCount(0)).catch(() => {});
      }
    }
    if (activeTab === 'costs') loadCosts();
    if (activeTab === 'legal') loadLegalDocs();
    if (activeTab === 'docreview') loadPendingDocs();
  }, [activeTab]);

  // Auto-reload users when filters change
  useEffect(() => {
    if (activeTab === 'people') loadUsers();
  }, [userRoleFilter, userDemoFilter]);

  // Auto-reload tickets when filters change
  useEffect(() => {
    if (activeTab === 'tickets') loadTickets();
  }, [ticketFilter]);

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
    if (activeTab === 'customerservice' || activeTab === 'ratings') loadCsReviews();
  }, [csFilter]);

  // ─── All Ratings: load all reviews + insights ───
  const loadAllReviews = async () => {
    setAllReviewsLoading(true);
    try {
      const params = new URLSearchParams({ sort: reviewSort, order: reviewOrder, limit: '100' });
      if (reviewRatingFilter) params.set('maxRating', reviewRatingFilter);
      if (reviewRatingFilter) params.set('minRating', reviewRatingFilter);
      const [revRes, insRes] = await Promise.all([
        apiFetch(`/api/admin/reviews/all?${params}`),
        apiFetch('/api/admin/reviews/insights'),
      ]);
      if (revRes?.ok) {
        const d = await revRes.json();
        setAllReviews(d.reviews || []);
        setAllReviewsTotal(d.total || 0);
        setAllReviewsStats(d.stats || null);
        setAllReviewsDist(d.distribution || []);
      }
      if (insRes?.ok) setReviewInsights(await insRes.json());
    } catch (err) { console.error('All reviews load error:', err); }
    setAllReviewsLoading(false);
  };

  useEffect(() => {
    if (activeTab === 'ratings') {
      loadAllReviews();
      loadCsReviews(); // also load flagged reviews for bottom section
    }
  }, [activeTab, reviewSort, reviewOrder, reviewRatingFilter]);

  // ─── Admin iPAi Briefing ───
  const loadBriefing = async () => {
    setBriefingLoading(true);
    try {
      const res = await apiFetch('/api/admin/briefing');
      if (res?.ok) setAdminBriefing(await res.json());
    } catch (err) { console.error('Briefing load error:', err); }
    setBriefingLoading(false);
  };

  useEffect(() => {
    if (activeTab === 'overview' && !adminBriefing && !briefingDismissed) loadBriefing();
  }, [activeTab]);

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
      const [dashRes, insightRes] = await Promise.all([
        apiFetch('/api/admin/security/dashboard'),
        apiFetch('/api/admin/security/insights'),
      ]);
      if (dashRes?.ok) setSecDashboard(await dashRes.json());
      if (insightRes?.ok) setSecInsights(await insightRes.json());
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
        // Close drawer if open for this user
        if (userDrawer?.user?.id === userId) setUserDrawer(null);
      } else {
        const data = await res.json();
        alert(data?.error || 'Failed to delete user');
      }
    } catch (err) { console.error('Delete user error:', err); }
    setDeleteLoading(false);
  };

  // ─── Nuke: passkey-verified permanent deletion (password fallback) ───
  const [nukePasswordMode, setNukePasswordMode] = useState(false);
  const [nukePassword, setNukePassword] = useState('');
  const handleNukeUser = async (userId, email) => {
    if (nukeConfirm !== userId) {
      setNukeConfirm(userId);
      setNukeError(null);
      setNukePasswordMode(false);
      setNukePassword('');
      return; // First click — show confirm
    }

    // Password fallback mode
    if (nukePasswordMode) {
      if (!nukePassword) { setNukeError('Enter your password to confirm.'); return; }
      setNukeLoading(true);
      setNukeError(null);
      try {
        const nukeRes = await apiFetch(`/api/admin/users/${userId}/nuke`, {
          method: 'DELETE',
          body: JSON.stringify({ _passwordAuth: true, password: nukePassword }),
        });
        if (nukeRes?.ok) {
          const data = await nukeRes.json();
          loadUsers();
          setNukeConfirm(null);
          setNukePasswordMode(false);
          setNukePassword('');
          if (userDrawer?.user?.id === userId) setUserDrawer(null);
          alert(data.message || 'User nuked successfully.');
        } else {
          const data = await nukeRes.json().catch(() => ({}));
          throw new Error(data.error || 'Nuke failed');
        }
      } catch (err) {
        setNukeError(err.message || 'Nuke failed');
        console.error('Nuke error:', err);
      }
      setNukeLoading(false);
      return;
    }

    // Passkey mode (default) — falls back to password on failure
    setNukeLoading(true);
    setNukeError(null);
    try {
      const SimpleWebAuthnBrowser = window.SimpleWebAuthnBrowser;
      if (!SimpleWebAuthnBrowser) throw new Error('passkey_unavailable');

      const challengeRes = await apiFetch(`/api/admin/users/${userId}/nuke/challenge`, { method: 'POST' });
      if (!challengeRes?.ok) {
        const err = await challengeRes.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to start passkey challenge');
      }
      const options = await challengeRes.json();
      const challengeKey = options._challengeKey;
      const authResp = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: options });

      const nukeRes = await apiFetch(`/api/admin/users/${userId}/nuke`, {
        method: 'DELETE',
        body: JSON.stringify({ ...authResp, _challengeKey: challengeKey }),
      });
      if (nukeRes?.ok) {
        const data = await nukeRes.json();
        loadUsers();
        setNukeConfirm(null);
        if (userDrawer?.user?.id === userId) setUserDrawer(null);
        alert(data.message || 'User nuked successfully.');
      } else {
        const data = await nukeRes.json().catch(() => ({}));
        throw new Error(data.error || 'Nuke failed');
      }
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.message === 'passkey_unavailable' || err.message?.includes('unexpected') || err.message?.includes('authentication')) {
        // Fall back to password mode
        setNukePasswordMode(true);
        setNukeError('Passkey unavailable — enter your admin password instead.');
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
    { label: 'Customer Service', tabs: [
      { id: 'tickets', label: 'Tickets', icon: '🎫', badge: ticketCount || null },
      { id: 'ratings', label: 'Ratings', icon: '⭐' },
      { id: 'feedback', label: 'Feedback', icon: '💬', badge: newFeedbackCount || null },
    ]},
    { label: 'Trust & Safety', tabs: [
      { id: 'docreview', label: 'Doc Review', icon: '📄', badge: pendingDocsCount || null },
      { id: 'authorizations', label: 'Auth', icon: '\u{1F512}', badge: consentAlerts.length || null },
      { id: 'bgchecks', label: 'BG Checks', icon: '🔍', badge: checkrAlertCount || null },
      { id: 'safety', label: 'Safety Flags', icon: '🚨', badge: safetyFlagCount || null },
      { id: 'security', label: 'Security', icon: '🛡️' },
      { id: 'blocked', label: 'Blocked', icon: '🚫' },
    ]},
    { label: 'Content & Config', tabs: [
      { id: 'help', label: 'Help/FAQ', icon: '❓' },
      { id: 'financials', label: 'Financials', icon: '💰' },
      { id: 'costs', label: 'Costs', icon: '💵' },
      { id: 'legal', label: 'Legal Docs', icon: '📜' },
      { id: 'activity', label: 'Activity', icon: '⚡' },
      { id: 'onboarding', label: 'Events', icon: '🚦' },
      { id: 'settings', label: 'Settings', icon: '⚙️' },
    ]},
  ];

  const activeTabLabel = tabGroups.flatMap(g => g.tabs).find(t => t.id === activeTab)?.label || 'Dashboard';

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 60px)', overflow: 'hidden', margin: '-16px -16px 0', position: 'relative' }}>

      {/* ═══ IP Verification Modal ═══ */}
      {ipVerifyModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 16, padding: '32px 28px', maxWidth: 420, width: '90%', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔐</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>New Network Detected</div>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 6 }}>
              You're accessing admin from an unrecognized IP address:
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-warning)', background: 'var(--color-warning-bg)', padding: '6px 12px', borderRadius: 8, display: 'inline-block', marginBottom: 16 }}>
              {ipVerifyModal.ip}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>
              Verify your identity with a passkey to continue. This IP will be trusted for 90 days.
            </div>
            {ipVerifyError && (
              <div style={{ fontSize: 13, color: 'var(--color-error)', marginBottom: 14, padding: '8px 12px', background: 'var(--color-error-bg)', borderRadius: 8 }}>
                {ipVerifyError}
              </div>
            )}
            <button
              onClick={handleIpVerify}
              disabled={ipVerifyLoading}
              style={{
                width: '100%', padding: '12px 20px', borderRadius: 10, border: 'none',
                background: 'var(--primary)', color: '#fff', fontWeight: 700, fontSize: 15,
                cursor: ipVerifyLoading ? 'wait' : 'pointer', opacity: ipVerifyLoading ? 0.7 : 1,
              }}
            >
              {ipVerifyLoading ? 'Verifying...' : '🔑  Verify with Passkey'}
            </button>
            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)' }}>
              If verification fails, this attempt will be flagged as suspicious.
            </div>
          </div>
        </div>
      )}

      {/* ═══ Sidebar Overlay (mobile) ═══ */}
      {sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 199,
          display: window.innerWidth <= 768 ? 'block' : 'none',
        }} />
      )}

      {/* ═══ Sidebar ═══ */}
      <div style={{
        width: 240, minWidth: 240, background: '#1a1a2e', color: '#fff',
        display: 'flex', flexDirection: 'column', flexShrink: 0, zIndex: 200,
        transition: 'transform 0.28s cubic-bezier(.4,0,.2,1)',
        ...(window.innerWidth <= 768 ? {
          position: 'fixed', top: 0, left: 0, bottom: 0,
          transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
          boxShadow: sidebarOpen ? '4px 0 20px rgba(0,0,0,0.2)' : 'none',
        } : {}),
      }}>
        {/* Sidebar header */}
        <div style={{ padding: '16px 18px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: -0.3 }}>in<span style={{ color: '#4ecdc4' }}>Place</span></span>
            <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 20, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, background: 'linear-gradient(135deg, #e8724a, #d85a2b)', color: '#fff' }}>
              {currentUser?.admin_role || 'Admin'}
            </span>
          </div>
          {window.innerWidth <= 768 && (
            <button onClick={() => setSidebarOpen(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 22, cursor: 'pointer', padding: '2px 6px', borderRadius: 6 }}>×</button>
          )}
        </div>

        {/* Sidebar nav */}
        <nav style={{ flex: 1, overflowY: 'auto', padding: '8px 0', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}>
          {tabGroups.map(group => (
            <div key={group.label} style={{ padding: '0 10px', marginBottom: 2 }}>
              <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'rgba(255,255,255,0.28)', padding: '14px 10px 5px' }}>
                {group.label}
              </div>
              {group.tabs.map(tab => (
                <div key={tab.id} onClick={() => { setActiveTab(tab.id); setSidebarOpen(false); }} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                  fontSize: 13, position: 'relative', userSelect: 'none',
                  background: activeTab === tab.id ? 'rgba(78,205,196,0.12)' : 'transparent',
                  color: activeTab === tab.id ? '#4ecdc4' : 'rgba(255,255,255,0.55)',
                  fontWeight: activeTab === tab.id ? 600 : 400,
                  transition: 'all 0.12s',
                }}>
                  <span style={{ width: 20, textAlign: 'center', fontSize: 14, flexShrink: 0 }}>{tab.icon}</span>
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tab.label}</span>
                  {tab.badge ? (
                    <span style={{
                      position: 'absolute', right: 8,
                      background: '#e8724a', color: '#fff', fontSize: 9, fontWeight: 700,
                      padding: '1px 6px', borderRadius: 10, minWidth: 17, textAlign: 'center',
                    }}>{tab.badge}</span>
                  ) : null}
                </div>
              ))}
            </div>
          ))}
        </nav>

        {/* Sidebar footer */}
        <div style={{ padding: '14px 18px', borderTop: '1px solid rgba(255,255,255,0.07)', fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
          v{window.APP_VERSION || ''} · {currentUser?.first_name || 'Admin'}
        </div>
      </div>

      {/* ═══ Main Content Area ═══ */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {/* Top bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 20px', background: 'var(--bg-card)', borderBottom: '1px solid var(--border-color)', flexShrink: 0, gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <button onClick={() => setSidebarOpen(true)} style={{
              display: window.innerWidth <= 768 ? 'block' : 'none',
              background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-primary)', padding: 4, borderRadius: 6,
            }}>☰</button>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              <span style={{ color: 'var(--role-color)', cursor: 'pointer' }} onClick={() => setActiveTab('overview')}>Admin</span>
              <span> › </span>
              <strong style={{ color: 'var(--text-primary)' }}>{activeTabLabel}</strong>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <button onClick={() => { if (window.__navigateTo) window.__navigateTo('account'); }} style={{
              padding: '6px 12px', background: 'none', color: 'var(--text-secondary)', border: '1px solid var(--border-color)',
              borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
            }}>⚙️ Account</button>
          </div>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20, WebkitOverflowScrolling: 'touch' }}>

      {/* ── ACTION REQUIRED BANNER — always visible when pending approvals exist ── */}
      {(pendingApprovals.length > 0 || consentAlerts.length > 0 || pausedCaregivers.length > 0 || checkrAlertCount > 0 || bgCheckActionItems.length > 0 || safetyFlagCount > 0) && (
        <div style={{ marginBottom: 16, padding: 16, background: safetyFlagCount > 0 ? 'linear-gradient(135deg, #fce4ec, #ffcdd2)' : 'linear-gradient(135deg, #fff3e0, #ffe0b2)', border: safetyFlagCount > 0 ? '2px solid #c62828' : '2px solid #ff9800', borderRadius: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: safetyFlagCount > 0 ? 'var(--color-error)' : 'var(--color-warning)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            {safetyFlagCount > 0 ? '\u{1F6A8}' : '\u{1F514}'} Action Required
            <span style={{ background: safetyFlagCount > 0 ? 'var(--color-error)' : 'var(--color-warning)', color: 'var(--text-on-primary)', borderRadius: 20, padding: '2px 10px', fontSize: 13 }}>
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
                      style={{ padding: '6px 14px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: authzActionLoading === a.id ? 0.6 : 1 }}>
                      {authzActionLoading === a.id ? '...' : '\u2705 Restore'}
                    </button>
                  )}
                  <button onClick={() => { setActiveTab('authorizations'); }}
                    style={{ padding: '6px 14px', background: isPaused || isFlagged ? 'var(--color-error)' : 'var(--accent-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
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
                  style={{ padding: '6px 14px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
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
                  padding: '12px 14px', marginBottom: 6, background: isRejected ? 'var(--bg-error-light)' : 'var(--color-info-bg)', borderRadius: 10,
                  border: isRejected ? '2px solid #c62828' : '2px solid #5c6bc0',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ flex: '1 1 200px' }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: isRejected ? 'var(--color-error)' : '#283593' }}>
                        {isRejected ? '\u{1F6D1}' : '\u{1F50D}'}{' '}
                        {item.name}
                        <span style={{ marginLeft: 6, padding: '1px 8px', background: isRejected ? 'var(--color-error)' : isConsider ? '#ef6c00' : 'var(--color-indigo)', color: 'var(--text-on-primary)', borderRadius: 4, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>{statusLabel}</span>
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
                          <span style={{ marginLeft: 6, padding: '1px 8px', background: 'var(--color-error)', color: 'var(--text-on-primary)', borderRadius: 4, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Escalated</span>
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
                          style={{ padding: '6px 12px', background: 'var(--color-error)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                          {'\u{1F6A8}'} Escalate
                        </button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); handleReviewFlag(flag.id, 'resolved'); }}
                        disabled={flagPasskeyLoading}
                        style={{ padding: '6px 12px', background: (flagPasskeyConfirm?.flagId === flag.id && flagPasskeyConfirm?.status === 'resolved') ? 'var(--color-success)' : 'var(--color-success)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: 'pointer', opacity: flagPasskeyLoading ? 0.6 : 1 }}>
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

      {/* ── Inline search (people tab only) ── */}
      {activeTab === 'people' && (
        <div style={{ position: 'relative', marginBottom: 16 }}>
          <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', fontSize: 18, color: 'var(--text-muted)' }}>{'\u{1F50D}'}</span>
          <input
            type="text" placeholder="Search people by name or email..."
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setPeopleSubTab('users');
                loadUsers();
              }
            }}
            style={{
              width: '100%', padding: '12px 16px 12px 44px', border: '1px solid var(--border-color)',
              borderRadius: 10, fontSize: 14, background: 'var(--bg-surface)', outline: 'none',
              transition: 'border-color 0.2s', boxSizing: 'border-box', color: 'var(--text-primary)',
            }}
            onFocus={(e) => { e.target.style.borderColor = 'var(--role-color)'; }}
            onBlur={(e) => { e.target.style.borderColor = 'var(--border-color)'; }}
          />
        </div>
      )}

      {/* ─── Overview Tab ─── */}
      {activeTab === 'overview' && stats && (() => {
        // Build attention items dynamically
        const attentionItems = [];
        // Pending user approvals
        pendingApprovals.forEach(u => attentionItems.push({
          icon: '👤', color: '#1565c0', pill: 'Review', pillBg: '#e3f2fd', pillColor: '#1565c0',
          title: `New signup — ${u.first_name} ${u.last_name}`,
          sub: `${u.role} · ${u.email} · ${new Date(u.created_at).toLocaleDateString()}`,
          action: () => { setActiveTab('people'); },
        }));
        // Paused caregivers
        pausedCaregivers.forEach(cg => attentionItems.push({
          icon: '🛑', color: '#c62828', pill: 'Paused', pillBg: '#ffebee', pillColor: '#c62828',
          title: `Paused caregiver — ${cg.first_name} ${cg.last_name}`,
          sub: `No-show · needs review`,
          action: () => { setActiveTab('sessions'); },
        }));
        // Consent alerts
        consentAlerts.forEach(a => attentionItems.push({
          icon: '🔒', color: '#f57f17', pill: 'Consent', pillBg: '#fff8e1', pillColor: '#f57f17',
          title: `Consent pending — ${a.first_name || 'User'} ${a.last_name || ''}`,
          sub: `Authorization required`,
          action: () => { setActiveTab('authorizations'); },
        }));
        // Safety flags
        if (safetyFlagCount > 0) attentionItems.push({
          icon: '🚨', color: '#c62828', pill: `${safetyFlagCount} flag${safetyFlagCount > 1 ? 's' : ''}`, pillBg: '#ffebee', pillColor: '#c62828',
          title: `Safety flags need review`,
          sub: `${safetyFlagCount} pending or escalated`,
          action: () => { setActiveTab('safety'); },
        });
        // BG check action items (caregivers with results needing admin review)
        bgCheckActionItems.forEach(item => attentionItems.push({
          icon: '🔍', color: '#f57f17', pill: item.checkrStatus === 'consider' ? 'Review' : item.checkrStatus.replace(/_/g, ' '), pillBg: '#fff8e1', pillColor: '#f57f17',
          title: `BG check — ${item.name}`,
          sub: `Status: ${item.checkrStatus.replace(/_/g, ' ')} · needs admin decision`,
          action: () => { setActiveTab('bgchecks'); },
        }));
        // Additional unread checkr alerts beyond the action items
        if (checkrAlertCount > bgCheckActionItems.length) attentionItems.push({
          icon: '🔍', color: '#f57f17', pill: `${checkrAlertCount - bgCheckActionItems.length} new`, pillBg: '#fff8e1', pillColor: '#f57f17',
          title: `Background check updates`,
          sub: `${checkrAlertCount - bgCheckActionItems.length} new notification${(checkrAlertCount - bgCheckActionItems.length) !== 1 ? 's' : ''}`,
          action: () => { setActiveTab('bgchecks'); },
        });
        // Open tickets
        if (ticketCount > 0) attentionItems.push({
          icon: '🎫', color: '#e8724a', pill: `${ticketCount} open`, pillBg: '#fff3e0', pillColor: '#e65100',
          title: `Open support tickets`,
          sub: `${ticketCounts.open || 0} open · ${ticketCounts.in_progress || 0} in progress`,
          action: () => { setActiveTab('tickets'); },
        });
        // New feedback
        if (newFeedbackCount > 0) attentionItems.push({
          icon: '💬', color: '#1565c0', pill: `${newFeedbackCount} new`, pillBg: '#e3f2fd', pillColor: '#1565c0',
          title: `New user feedback`,
          sub: `${newFeedbackCount} unread submission${newFeedbackCount > 1 ? 's' : ''}`,
          action: () => { setActiveTab('feedback'); },
        });

        return (
        <div>
          {/* ── iPAi Admin Briefing ── */}
          {!briefingDismissed && (
            <div style={{ background: 'linear-gradient(135deg, #e8f0fe 0%, #f3e8ff 100%)', borderRadius: 14, border: '1px solid #c5cae9', marginBottom: 16, overflow: 'hidden' }}>
              <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 22 }}>🤖</span>
                  <div>
                    <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: '#1a237e' }}>iPAi Admin Brief</h3>
                    <div style={{ fontSize: 11, color: '#5c6bc0' }}>{adminBriefing ? 'Updated just now' : 'Loading...'}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button onClick={() => { setAdminBriefing(null); loadBriefing(); }} style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid #c5cae9', background: 'white', fontSize: 11, cursor: 'pointer', color: '#5c6bc0' }}>↻ Refresh</button>
                  <button onClick={() => setBriefingDismissed(true)} style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid #c5cae9', background: 'white', fontSize: 11, cursor: 'pointer', color: '#999' }}>✕</button>
                </div>
              </div>
              {briefingLoading && !adminBriefing ? (
                <div style={{ padding: '16px 18px', textAlign: 'center', color: '#5c6bc0', fontSize: 13 }}>Analyzing your platform...</div>
              ) : adminBriefing?.items?.length > 0 ? (
                <div style={{ padding: '0 18px 14px' }}>
                  {adminBriefing.items.map((item, i) => {
                    const sentColors = { up: '#2e7d32', down: '#c62828', neutral: '#5c6bc0' };
                    const sentBgs = { up: '#e8f5e9', down: '#ffebee', neutral: '#f5f5f5' };
                    return (
                      <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 0', borderTop: i > 0 ? '1px solid rgba(0,0,0,0.06)' : 'none' }}>
                        <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{item.icon}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#1a237e', marginBottom: 2 }}>{item.title}</div>
                          <div style={{ fontSize: 12, color: '#37474f', lineHeight: 1.5 }}>{item.detail}</div>
                        </div>
                        <span style={{
                          padding: '2px 8px', borderRadius: 8, fontSize: 10, fontWeight: 700, height: 'fit-content', marginTop: 2,
                          background: sentBgs[item.sentiment] || sentBgs.neutral,
                          color: sentColors[item.sentiment] || sentColors.neutral,
                        }}>
                          {item.sentiment === 'up' ? '↑' : item.sentiment === 'down' ? '↓' : '→'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          )}

          {/* ── Alerts — FIRST thing admin sees ── */}
          {attentionItems.length > 0 && (
            <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-color)', marginBottom: 16, overflow: 'hidden' }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>Needs Attention</h3>
                <span style={{ padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: '#ffebee', color: '#c62828' }}>{attentionItems.length}</span>
              </div>
              <div>
                {attentionItems.map((item, i) => (
                  <div key={i} onClick={item.action} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px',
                    cursor: 'pointer', borderBottom: i < attentionItems.length - 1 ? '1px solid var(--border-color)' : 'none',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-surface)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{item.sub}</div>
                    </div>
                    <span style={{ padding: '2px 9px', borderRadius: 20, fontSize: 10, fontWeight: 600, background: item.pillBg, color: item.pillColor, flexShrink: 0 }}>{item.pill}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 16, flexShrink: 0 }}>›</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Compact Stat Tiles ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'Revenue MTD', value: `$${(stats.revenueMtd || 0).toLocaleString()}`, icon: '💰', onClick: () => setActiveTab('financials') },
              { label: 'Revenue YTD', value: `$${(stats.revenueYtd || 0).toLocaleString()}`, icon: '📊', onClick: () => setActiveTab('financials') },
              { label: 'Avg Rating', value: `${stats.avgRating || '—'} ⭐`, icon: '⭐', sub: `${stats.totalReviews || 0} reviews`, onClick: () => setActiveTab('ratings') },
            ].map((s, i) => (
              <div key={i} onClick={s.onClick} style={{
                background: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border-color)',
                padding: '12px 14px', cursor: 'pointer', transition: 'all 0.12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--role-color)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.boxShadow = 'none'; }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{s.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2, color: s.color || 'var(--text-primary)' }}>{s.value}</div>
                {s.sub && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{s.sub}</div>}
              </div>
            ))}
          </div>

          {/* ── Quick Actions — deduplicated ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 8, marginBottom: 16 }}>
            {[
              { icon: '👥', label: 'People', action: () => setActiveTab('people') },
              { icon: '📋', label: 'Visits', action: () => setActiveTab('sessions') },
              { icon: '🎫', label: 'Tickets', action: () => setActiveTab('tickets') },
              { icon: '💰', label: 'Financials', action: () => setActiveTab('financials') },
              { icon: '🛡️', label: 'Safety', action: () => setActiveTab('safety') },
              { icon: '⚙️', label: 'Settings', action: () => setActiveTab('settings') },
            ].map((q, i) => (
              <div key={i} onClick={q.action} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                padding: '14px 8px', background: 'var(--bg-card)', borderRadius: 10,
                border: '1px solid var(--border-color)', cursor: 'pointer',
                fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)', textAlign: 'center',
                transition: 'all 0.12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--role-color)'; e.currentTarget.style.background = 'var(--bg-surface)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.background = 'var(--bg-card)'; }}>
                <span style={{ fontSize: 22 }}>{q.icon}</span>
                {q.label}
              </div>
            ))}
          </div>

          {/* ── Two-column: Sessions by Status + Signup Trend ── */}
          <div style={{ display: 'grid', gridTemplateColumns: window.innerWidth > 768 ? '1fr 1fr' : '1fr', gap: 14 }}>
            {/* Sessions by Status */}
            {stats.sessionsByStatus && stats.sessionsByStatus.length > 0 && (
              <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-color)' }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>📅 Sessions</h3>
                </div>
                <div style={{ padding: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {stats.sessionsByStatus.map((s, i) => (
                    <div key={i} style={{ padding: '10px 16px', background: 'var(--bg-surface)', borderRadius: 8, textAlign: 'center', flex: '1 1 70px' }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--role-color)' }}>{s.count}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{s.status}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Signup trend */}
            {stats.signupTrend && stats.signupTrend.length > 0 && (
              <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-color)' }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>📈 Signups (30d)</h3>
                </div>
                <div style={{ padding: 16 }}>
                  <svg viewBox={`0 0 ${Math.max(stats.signupTrend.length * 40, 200)} 100`} style={{ width: '100%', height: 80 }}>
                    {stats.signupTrend.map((d, i) => {
                      const maxCount = Math.max(...stats.signupTrend.map(s => s.count), 1);
                      const barH = (d.count / maxCount) * 65;
                      const x = i * 40 + 10;
                      return (
                        <g key={i}>
                          <rect x={x} y={80 - barH} width="24" height={barH} rx="4" fill="var(--role-color)" opacity="0.85" />
                          <text x={x + 12} y={76 - barH} textAnchor="middle" fontSize="9" fill="var(--text-primary)" fontWeight="600">{d.count}</text>
                          <text x={x + 12} y={95} textAnchor="middle" fontSize="7" fill="var(--text-muted)">
                            {(parseTimestamp(d.date) || new Date(0)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
              </div>
            )}
          </div>

          {/* ── Ratings & Reviews Summary ── */}
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-color)', overflow: 'hidden', marginTop: 14 }}
            onClick={() => setActiveTab('ratings')} >
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>⭐ Ratings & Reviews</h3>
              <span style={{ fontSize: 11, color: 'var(--role-color)', fontWeight: 600 }}>View all →</span>
            </div>
            <div style={{ padding: 16 }}>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: '#f59e0b' }}>{stats.avgRating || '—'} <span style={{ fontSize: 16 }}>★</span></div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{stats.totalReviews || 0} reviews</div>
                </div>
                {/* Mini distribution bars */}
                <div style={{ flex: 1, minWidth: 120 }}>
                  {[5, 4, 3, 2, 1].map(star => {
                    const pct = stats.ratingDistribution?.[star] || 0;
                    const total = stats.totalReviews || 1;
                    const width = Math.max((pct / total) * 100, 0);
                    return (
                      <div key={star} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 16, textAlign: 'right' }}>{star}★</span>
                        <div style={{ flex: 1, height: 8, background: 'var(--bg-neutral)', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ width: `${width}%`, height: '100%', background: star >= 4 ? '#4caf50' : star === 3 ? '#ff9800' : '#e53935', borderRadius: 4 }} />
                        </div>
                        <span style={{ fontSize: 9, color: 'var(--text-muted)', width: 16 }}>{pct}</span>
                      </div>
                    );
                  })}
                </div>
                {/* Quick stat pills */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {adminBriefing?.reviews?.reviews_7d > 0 && (
                    <div style={{ padding: '4px 10px', borderRadius: 8, background: '#e3f2fd', fontSize: 11, color: '#1565c0', fontWeight: 600 }}>
                      {adminBriefing.reviews.reviews_7d} this week
                    </div>
                  )}
                  {adminBriefing?.reviews?.flagged_pending > 0 && (
                    <div style={{ padding: '4px 10px', borderRadius: 8, background: '#ffebee', fontSize: 11, color: '#c62828', fontWeight: 600 }}>
                      {adminBriefing.reviews.flagged_pending} flagged
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
        );
      })()}

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
                {st.badge ? <span style={{ background: 'var(--color-warning)', color: 'var(--text-on-primary)', borderRadius: 10, padding: '1px 6px', fontSize: 10, fontWeight: 700, marginLeft: 4 }}>{st.badge} new</span> : null}
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
                  padding: '10px 20px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none',
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
                      <tr key={u.id} onClick={() => loadUserDetail(u.id)} style={{ borderBottom: '1px solid #f0f0f0', background: isPending ? 'var(--bg-warm)' : 'transparent', borderLeft: isPending ? '4px solid #ff9800' : 'none', cursor: 'pointer', transition: 'background 0.1s' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 500 }}>
                          {u.first_name} {u.last_name}
                          {u.is_admin ? <span style={{ marginLeft: '6px', fontSize: '10px', background: 'var(--role-color)', color: 'var(--text-on-primary)', padding: '2px 6px', borderRadius: '4px' }}>ADMIN</span> : ''}
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
                        <td onClick={e => e.stopPropagation()} style={{ padding: '10px 12px', textAlign: 'center' }}>
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
                        <td onClick={e => e.stopPropagation()} style={{ padding: '10px 12px', textAlign: 'center' }}>
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
                        <td onClick={e => e.stopPropagation()} style={{ padding: '10px 12px', textAlign: 'center' }}>
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
                        <td onClick={e => e.stopPropagation()} style={{ padding: '10px 12px', textAlign: 'center' }}>
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
                                style={{ padding: '4px 10px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                Manage
                              </button>
                            </div>
                          ) : u.role === 'caregiver' ? (
                            <div style={{ display: 'flex', gap: '4px', justifyContent: 'center', flexWrap: 'nowrap' }}>
                              <button onClick={() => openOnboardingModal(u.id)}
                                style={{ padding: '4px 10px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
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
                                    style={{ padding: '4px 10px', background: 'var(--color-error)', color: 'var(--text-on-primary)', border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>
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
                padding: '6px 16px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none',
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
                  padding: '10px 20px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none',
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
                                padding: '4px 10px', background: 'var(--bg-error-light)', border: '1px solid #fdd',
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
                              <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--bg-error-light)', borderRadius: 8, border: '1px solid #fdd' }}>
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
                              style={{ marginTop: 6, padding: '4px 14px', borderRadius: 6, border: 'none', background: 'var(--role-color)', color: 'var(--text-on-primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
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
                    padding: '6px 12px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none',
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

      {/* ─── Tickets Tab ─── */}
      {activeTab === 'tickets' && (
        <div>
          {/* Header row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Tickets</h2>
            <div style={{ display: 'flex', gap: 8, fontSize: 13 }}>
              <span style={{ padding: '4px 10px', borderRadius: 12, background: '#ef5350', color: '#fff' }}>Open {ticketCounts.open || 0}</span>
              <span style={{ padding: '4px 10px', borderRadius: 12, background: '#ff9800', color: '#fff' }}>In Progress {ticketCounts.in_progress || 0}</span>
              <span style={{ padding: '4px 10px', borderRadius: 12, background: '#4caf50', color: '#fff' }}>Resolved {ticketCounts.resolved || 0}</span>
              <span style={{ padding: '4px 10px', borderRadius: 12, background: '#9e9e9e', color: '#fff' }}>Closed {ticketCounts.closed || 0}</span>
            </div>
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <select value={ticketFilter.status} onChange={e => setTicketFilter(f => ({ ...f, status: e.target.value }))}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13 }}>
              <option value="">All Statuses</option>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
            <select value={ticketFilter.priority} onChange={e => setTicketFilter(f => ({ ...f, priority: e.target.value }))}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13 }}>
              <option value="">All Priorities</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <select value={ticketFilter.category} onChange={e => setTicketFilter(f => ({ ...f, category: e.target.value }))}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13 }}>
              <option value="">All Categories</option>
              <option value="visit_issue">Visit Issue</option>
              <option value="billing">Billing</option>
              <option value="onboarding">Onboarding</option>
              <option value="matching">Matching</option>
              <option value="technical">Technical</option>
              <option value="safety">Safety</option>
              <option value="general">General</option>
            </select>
          </div>

          {/* Ticket detail overlay */}
          {selectedTicket && (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 10, padding: 20, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{selectedTicket.subject}</h3>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
                    {selectedTicket.reporter_name || 'Unknown'} · {selectedTicket.source} · {new Date(selectedTicket.created_at).toLocaleDateString()}
                  </p>
                </div>
                <button onClick={() => { setSelectedTicket(null); setTicketComments([]); }}
                  style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-secondary)' }}>✕</button>
              </div>
              {selectedTicket.description && (
                <p style={{ fontSize: 14, color: 'var(--text-primary)', margin: '0 0 12px', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{selectedTicket.description}</p>
              )}
              {/* Status/priority controls */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <select value={selectedTicket.status} onChange={e => updateTicket(selectedTicket.id, { status: e.target.value })}
                  style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12 }}>
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
                <select value={selectedTicket.priority} onChange={e => updateTicket(selectedTicket.id, { priority: e.target.value })}
                  style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12 }}>
                  <option value="urgent">Urgent</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
                <select value={selectedTicket.category} onChange={e => updateTicket(selectedTicket.id, { category: e.target.value })}
                  style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12 }}>
                  <option value="visit_issue">Visit Issue</option>
                  <option value="billing">Billing</option>
                  <option value="onboarding">Onboarding</option>
                  <option value="matching">Matching</option>
                  <option value="technical">Technical</option>
                  <option value="safety">Safety</option>
                  <option value="general">General</option>
                </select>
                <select value={selectedTicket.assigned_to || ''} onChange={e => updateTicket(selectedTicket.id, { assigned_to: e.target.value || null })}
                  style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12 }}>
                  <option value="">Unassigned</option>
                  {adminUsers.map(a => (
                    <option key={a.id} value={a.id}>{a.first_name} {a.last_name} ({a.admin_role})</option>
                  ))}
                </select>
              </div>
              {/* Comments */}
              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 12 }}>
                <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>Comments ({ticketComments.length})</h4>
                {ticketComments.map(c => (
                  <div key={c.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border-color)' }}>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                      <strong style={{ color: 'var(--text-primary)' }}>{c.author_name}</strong>
                      {c.admin_role && <span style={{ marginLeft: 4, fontSize: 11, color: 'var(--role-color)' }}>({c.admin_role})</span>}
                      {c.is_internal ? <span style={{ marginLeft: 4, fontSize: 11, color: '#ff9800' }}>internal</span> : null}
                      <span style={{ marginLeft: 8 }}>{new Date(c.created_at).toLocaleString()}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>{c.content}</p>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <input value={newTicketComment} onChange={e => setNewTicketComment(e.target.value)}
                    placeholder="Add internal comment..."
                    style={{ flex: 1, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13 }}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addTicketComment(selectedTicket.id); } }} />
                  <button onClick={() => addTicketComment(selectedTicket.id)}
                    style={{ padding: '8px 14px', borderRadius: 6, border: 'none', background: 'var(--role-color)', color: 'var(--text-on-primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Send</button>
                </div>
              </div>
            </div>
          )}

          {/* Ticket list */}
          {ticketLoading ? (
            <p style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 32 }}>Loading tickets...</p>
          ) : tickets.length === 0 ? (
            <p style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 32 }}>No tickets found</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                    <th style={{ textAlign: 'left', padding: '8px 6px', color: 'var(--text-secondary)', fontWeight: 600 }}>Status</th>
                    <th style={{ textAlign: 'left', padding: '8px 6px', color: 'var(--text-secondary)', fontWeight: 600 }}>Priority</th>
                    <th style={{ textAlign: 'left', padding: '8px 6px', color: 'var(--text-secondary)', fontWeight: 600 }}>Subject</th>
                    <th style={{ textAlign: 'left', padding: '8px 6px', color: 'var(--text-secondary)', fontWeight: 600 }}>Reporter</th>
                    <th style={{ textAlign: 'left', padding: '8px 6px', color: 'var(--text-secondary)', fontWeight: 600 }}>Category</th>
                    <th style={{ textAlign: 'left', padding: '8px 6px', color: 'var(--text-secondary)', fontWeight: 600 }}>Age</th>
                    <th style={{ textAlign: 'left', padding: '8px 6px', color: 'var(--text-secondary)', fontWeight: 600 }}>Assigned</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map(t => {
                    const statusColors = { open: '#ef5350', in_progress: '#ff9800', resolved: '#4caf50', closed: '#9e9e9e' };
                    const priorityColors = { urgent: '#d32f2f', high: '#ef5350', medium: '#ff9800', low: '#4caf50' };
                    const age = Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000);
                    const ageStr = age === 0 ? 'Today' : age === 1 ? '1d' : `${age}d`;
                    return (
                      <tr key={t.id} onClick={() => loadTicketDetail(t.id)}
                        style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer', transition: 'background 0.15s' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <td style={{ padding: '10px 6px' }}>
                          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, color: '#fff', background: statusColors[t.status] || '#999' }}>
                            {t.status?.replace('_', ' ')}
                          </span>
                        </td>
                        <td style={{ padding: '10px 6px' }}>
                          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, color: '#fff', background: priorityColors[t.priority] || '#999' }}>
                            {t.priority}
                          </span>
                        </td>
                        <td style={{ padding: '10px 6px', color: 'var(--text-primary)', fontWeight: 500, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.subject}
                        </td>
                        <td style={{ padding: '10px 6px', color: 'var(--text-secondary)' }}>{t.reporter_name || '—'}</td>
                        <td style={{ padding: '10px 6px', color: 'var(--text-secondary)' }}>{t.category?.replace('_', ' ')}</td>
                        <td style={{ padding: '10px 6px', color: age > 3 ? '#ef5350' : 'var(--text-secondary)', fontWeight: age > 3 ? 600 : 400 }}>{ageStr}</td>
                        <td style={{ padding: '10px 6px', color: 'var(--text-secondary)' }}>{t.assigned_name || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
                    background: st === 'flagged' || st === 'pending' ? 'var(--bg-warm)' : 'var(--bg-card)',
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
                              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--color-info)', color: 'var(--text-on-primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: csActionLoading === r.id ? 0.6 : 1 }}>
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

      {/* ─── Ratings Tab ─── */}
      {activeTab === 'ratings' && (
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Ratings & Reviews</h2>

          {/* AI Insights Panel */}
          {reviewInsights?.insights?.length > 0 && (
            <div style={{ background: 'linear-gradient(135deg, #e8f0fe 0%, #f3e8ff 100%)', borderRadius: 14, border: '1px solid #c5cae9', padding: '16px 18px', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 18 }}>🤖</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#1a237e' }}>iPAi Review Insights</span>
                <span style={{ fontSize: 11, color: '#7986cb' }}>Last 90 days</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {reviewInsights.insights.map((ins, i) => {
                  const typeColors = { positive: '#2e7d32', warning: '#e65100', neutral: '#5c6bc0', info: '#1565c0' };
                  const typeBgs = { positive: '#e8f5e9', warning: '#fff3e0', neutral: '#f5f5f5', info: '#e3f2fd' };
                  return (
                    <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 12px', background: typeBgs[ins.type] || '#f5f5f5', borderRadius: 10, border: `1px solid ${typeColors[ins.type] || '#ccc'}20` }}>
                      <span style={{ fontSize: 16, flexShrink: 0 }}>{ins.icon}</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: typeColors[ins.type] || '#333' }}>{ins.title}</div>
                        <div style={{ fontSize: 12, color: '#37474f', lineHeight: 1.5, marginTop: 2 }}>{ins.detail}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Stats bar + distribution */}
          {allReviewsStats && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
              <div style={{ background: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border-color)', padding: '12px 16px', flex: 1, minWidth: 120 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Total Reviews</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{allReviewsStats.total}</div>
              </div>
              <div style={{ background: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border-color)', padding: '12px 16px', flex: 1, minWidth: 120 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Avg Rating</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#f59e0b' }}>{allReviewsStats.avg_rating || '—'} ★</div>
              </div>
              <div style={{ background: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border-color)', padding: '12px 16px', flex: 1, minWidth: 120 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Positive (4-5★)</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-success)' }}>{allReviewsStats.positive}</div>
              </div>
              <div style={{ background: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border-color)', padding: '12px 16px', flex: 1, minWidth: 120 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Negative (1-2★)</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-error)' }}>{allReviewsStats.negative}</div>
              </div>
              <div style={{ background: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border-color)', padding: '12px 16px', flex: 1, minWidth: 120 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Flagged Pending</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: allReviewsStats.flagged_pending > 0 ? 'var(--color-warning)' : 'var(--text-muted)' }}>{allReviewsStats.flagged_pending}</div>
              </div>
            </div>
          )}

          {/* Distribution bar */}
          {allReviewsDist.length > 0 && (() => {
            const maxCnt = Math.max(...allReviewsDist.map(d => d.cnt), 1);
            return (
              <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-color)', padding: '14px 18px', marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>Rating Distribution</div>
                {[5, 4, 3, 2, 1].map(star => {
                  const d = allReviewsDist.find(x => x.rating === star);
                  const cnt = d?.cnt || 0;
                  const pct = maxCnt > 0 ? (cnt / maxCnt * 100) : 0;
                  const active = reviewRatingFilter === String(star);
                  return (
                    <div key={star} onClick={() => setReviewRatingFilter(active ? null : String(star))}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, cursor: 'pointer', opacity: reviewRatingFilter && !active ? 0.4 : 1, transition: 'opacity 0.15s' }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', width: 30, textAlign: 'right' }}>{star}★</span>
                      <div style={{ flex: 1, height: 14, background: 'var(--bg-neutral)', borderRadius: 7, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: star >= 4 ? '#4caf50' : star === 3 ? '#ff9800' : '#e53935', borderRadius: 7, transition: 'width 0.3s' }} />
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 28, textAlign: 'right' }}>{cnt}</span>
                    </div>
                  );
                })}
                {reviewRatingFilter && (
                  <div style={{ marginTop: 6, textAlign: 'center' }}>
                    <button onClick={() => setReviewRatingFilter(null)} style={{ fontSize: 11, color: 'var(--role-color)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Clear filter</button>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Sort controls */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sort by:</span>
            {[
              { key: 'date', label: 'Date' },
              { key: 'rating', label: 'Rating' },
              { key: 'caregiver', label: 'Caregiver' },
            ].map(s => (
              <button key={s.key} onClick={() => {
                if (reviewSort === s.key) setReviewOrder(reviewOrder === 'desc' ? 'asc' : 'desc');
                else { setReviewSort(s.key); setReviewOrder(s.key === 'rating' ? 'asc' : 'desc'); }
              }} style={{
                padding: '4px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: reviewSort === s.key ? 'var(--role-color)' : 'var(--bg-surface)',
                color: reviewSort === s.key ? 'var(--text-on-primary)' : 'var(--text-secondary)',
                border: reviewSort === s.key ? 'none' : '1px solid var(--border-color)',
              }}>
                {s.label} {reviewSort === s.key ? (reviewOrder === 'asc' ? '↑' : '↓') : ''}
              </button>
            ))}
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>{allReviewsTotal} reviews</span>
          </div>

          {/* Review list */}
          {allReviewsLoading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading reviews...</div>
          ) : allReviews.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', background: 'var(--bg-neutral)', borderRadius: 12 }}>
              No reviews found{reviewRatingFilter ? ` for ${reviewRatingFilter}★` : ''}.
            </div>
          ) : (
            <div>
              {allReviews.map((r) => {
                const isExpanded = allReviewsExpanded === r.id;
                const stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
                const starColor = r.rating >= 4 ? '#4caf50' : r.rating === 3 ? '#ff9800' : '#e53935';
                const st = r.admin_status || (r.rating < 3 ? 'flagged' : 'ok');
                const statusColors = { pending: '#ff9800', flagged: '#e53935', reviewed: '#1976d2', escalated: '#7b1fa2', resolved: '#4caf50', ok: '#bbb' };
                return (
                  <div key={r.id} style={{
                    marginBottom: 8, borderRadius: 12, border: '1px solid var(--border-color)',
                    background: r.rating < 3 ? 'var(--bg-warm)' : 'var(--bg-card)',
                    overflow: 'hidden',
                  }}>
                    <div onClick={() => setAllReviewsExpanded(isExpanded ? null : r.id)}
                      style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                          <span style={{ color: starColor, fontSize: 15, letterSpacing: 1 }}>{stars}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{r.caregiver_name}</span>
                          {st !== 'ok' && (
                            <span style={{ padding: '1px 7px', borderRadius: 10, fontSize: 9, fontWeight: 700, background: statusColors[st] + '20', color: statusColors[st], textTransform: 'uppercase' }}>{st}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          By {r.family_name} {r.recipient_name ? `for ${r.recipient_name}` : ''} • {new Date(r.created_at).toLocaleDateString()}
                        </div>
                        {r.comment && !isExpanded && (
                          <div style={{ fontSize: 12, color: 'var(--text-primary)', marginTop: 4, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            "{r.comment.length > 100 ? r.comment.slice(0, 100) + '...' : r.comment}"
                          </div>
                        )}
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{isExpanded ? '▲' : '▼'}</span>
                    </div>
                    {isExpanded && (
                      <div style={{ padding: '0 16px 14px', borderTop: '1px solid var(--border-color)' }}>
                        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 10, marginBottom: 10 }}>
                          <div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>Caregiver</div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{r.caregiver_name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Overall: {r.caregiver_rating_avg || 'N/A'}★ ({r.caregiver_rating_count || 0} reviews)</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>Family</div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{r.family_name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{r.family_email}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>Session</div>
                            <div style={{ fontSize: 13 }}>{r.scheduled_date ? new Date(r.scheduled_date).toLocaleDateString() : 'N/A'}{r.scheduled_time ? ` at ${r.scheduled_time}` : ''}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{r.service_type || 'N/A'} {r.review_type === 'late_cancellation' ? '(Late cancel)' : r.review_type === 'no_show' ? '(No-show)' : ''}</div>
                          </div>
                        </div>
                        {r.comment && (
                          <div style={{ padding: '10px 14px', background: 'var(--bg-neutral)', borderRadius: 8, marginBottom: 10, fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)' }}>
                            {r.comment}
                          </div>
                        )}
                        {r.admin_notes && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>Admin notes: {r.admin_notes}</div>
                        )}
                        {r.admin_reviewed_at && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            Reviewed by {r.reviewed_by_name || 'admin'} on {new Date(r.admin_reviewed_at).toLocaleString()}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ─── Flagged Reviews Section (bottom) ─── */}
          <div style={{ marginTop: 24, borderTop: '2px solid var(--border-color)', paddingTop: 20 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)' }}>🚩 Flagged Reviews (Below 3★)</h3>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
              Reviews rated below 3 stars are automatically flagged. Triage each one, add notes, and update status.
            </p>

            {/* Status filter badges */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {[
                { key: 'pending', label: 'Pending', color: 'var(--color-warning)', bg: 'var(--color-warning-bg)' },
                { key: 'reviewed', label: 'Reviewed', color: 'var(--color-info)', bg: 'var(--color-info-bg)' },
                { key: 'escalated', label: 'Escalated', color: 'var(--color-purple)', bg: 'var(--color-purple-bg)' },
                { key: 'resolved', label: 'Resolved', color: 'var(--color-success)', bg: 'var(--color-success-bg)' },
              ].map(b => (
                <div key={b.key} onClick={() => setCsFilter(b.key)} style={{
                  padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  background: csFilter === b.key ? b.color : b.bg,
                  color: csFilter === b.key ? 'var(--text-on-primary)' : b.color,
                  border: `1px solid ${b.color}`,
                  transition: 'all 0.15s',
                }}>
                  {b.label} {csCounts[b.key] != null ? `(${csCounts[b.key]})` : ''}
                </div>
              ))}
              <div onClick={() => setCsFilter('all')} style={{
                padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: csFilter === 'all' ? 'var(--text-secondary)' : 'var(--bg-primary)',
                color: csFilter === 'all' ? 'var(--text-on-primary)' : 'var(--text-secondary)',
                border: '1px solid #ccc',
              }}>
                All ({csCounts.total_flagged || 0})
              </div>
            </div>

            {csLoading ? (
              <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>Loading flagged reviews...</div>
            ) : csReviews.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', background: 'var(--bg-neutral)', borderRadius: 12, fontSize: 13 }}>
                No {csFilter !== 'all' ? csFilter : 'flagged'} reviews found.
              </div>
            ) : (
              <div>
                {csReviews.map((r) => {
                  const isExp = csExpanded === r.id;
                  const stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
                  const statusColors = { pending: 'var(--color-warning)', flagged: 'var(--color-error)', reviewed: 'var(--color-info)', escalated: 'var(--color-purple)', resolved: 'var(--color-success)' };
                  const st = r.admin_status || 'pending';
                  return (
                    <div key={r.id} style={{ marginBottom: 8, borderRadius: 12, border: '1px solid #e0e0e0', background: st === 'pending' ? 'var(--bg-warm)' : 'var(--bg-card)', overflow: 'hidden' }}>
                      <div onClick={() => { setCsExpanded(isExp ? null : r.id); setCsNotes(r.admin_notes || ''); }}
                        style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                            <span style={{ color: '#e53935', fontSize: 15, letterSpacing: 1 }}>{stars}</span>
                            <span style={{ fontSize: 13, fontWeight: 600 }}>{r.caregiver_name}</span>
                            <span style={{ padding: '1px 7px', borderRadius: 10, fontSize: 9, fontWeight: 700, background: statusColors[st] + '20', color: statusColors[st], textTransform: 'uppercase' }}>{st}</span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                            From {r.family_name} • {r.recipient_name || 'Visit'} • {new Date(r.created_at).toLocaleDateString()}
                          </div>
                          {r.comment && !isExp && (
                            <div style={{ fontSize: 12, color: 'var(--text-primary)', marginTop: 4, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              "{r.comment.length > 100 ? r.comment.slice(0, 100) + '...' : r.comment}"
                            </div>
                          )}
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{isExp ? '▲' : '▼'}</span>
                      </div>
                      {isExp && (
                        <div style={{ padding: '0 16px 14px', borderTop: '1px solid #f0f0f0' }}>
                          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 10, marginBottom: 10 }}>
                            <div>
                              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>Caregiver</div>
                              <div style={{ fontSize: 13, fontWeight: 600 }}>{r.caregiver_name}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Overall: {r.caregiver_rating_avg || 'N/A'}★ ({r.caregiver_rating_count || 0} reviews)</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>Family</div>
                              <div style={{ fontSize: 13, fontWeight: 600 }}>{r.family_name}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{r.family_email}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>Session</div>
                              <div style={{ fontSize: 13 }}>{r.scheduled_date ? new Date(r.scheduled_date).toLocaleDateString() : 'N/A'}{r.scheduled_time ? ` at ${r.scheduled_time}` : ''}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{r.review_type === 'late_cancellation' ? 'Late cancel' : r.review_type === 'no_show' ? 'No-show' : 'Session'}</div>
                            </div>
                          </div>
                          {r.comment && (
                            <div style={{ padding: '10px 14px', background: 'var(--bg-neutral)', borderRadius: 8, marginBottom: 10, fontSize: 13, lineHeight: 1.6 }}>{r.comment}</div>
                          )}
                          {r.admin_reviewed_at && (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>Reviewed by {r.reviewed_by_name || 'admin'} on {new Date(r.admin_reviewed_at).toLocaleString()}</div>
                          )}
                          <div style={{ marginBottom: 10 }}>
                            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>Admin Notes</label>
                            <textarea value={csNotes} onChange={(e) => setCsNotes(e.target.value)}
                              placeholder="Add internal notes..."
                              style={{ width: '100%', minHeight: 50, padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 12, resize: 'vertical', boxSizing: 'border-box' }} />
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {st !== 'reviewed' && (
                              <button disabled={csActionLoading === r.id} onClick={() => handleCsAction(r.id, 'reviewed')}
                                style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--color-info)', color: 'var(--text-on-primary)', fontSize: 11, fontWeight: 600, cursor: 'pointer', opacity: csActionLoading === r.id ? 0.6 : 1 }}>
                                Mark Reviewed
                              </button>
                            )}
                            {st !== 'escalated' && (
                              <button disabled={csActionLoading === r.id} onClick={() => handleCsAction(r.id, 'escalated')}
                                style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--color-purple)', color: 'var(--text-on-primary)', fontSize: 11, fontWeight: 600, cursor: 'pointer', opacity: csActionLoading === r.id ? 0.6 : 1 }}>
                                Escalate
                              </button>
                            )}
                            {st !== 'resolved' && (
                              <button disabled={csActionLoading === r.id} onClick={() => handleCsAction(r.id, 'resolved')}
                                style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--color-success)', color: 'var(--text-on-primary)', fontSize: 11, fontWeight: 600, cursor: 'pointer', opacity: csActionLoading === r.id ? 0.6 : 1 }}>
                                Resolve
                              </button>
                            )}
                            {st !== 'pending' && (
                              <button disabled={csActionLoading === r.id} onClick={() => handleCsAction(r.id, 'pending')}
                                style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #ccc', background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600, cursor: 'pointer', opacity: csActionLoading === r.id ? 0.6 : 1 }}>
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
              padding: '8px 16px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none',
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
                    padding: '8px 20px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none',
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

              {/* AI Security Insights */}
              {secInsights && (
                <div style={{ marginBottom: 20, background: 'var(--bg-surface)', border: '1px solid #e0e0e0', borderRadius: 14, overflow: 'hidden' }}>
                  {/* Header with health score */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid #f0f0f0', background: 'var(--bg-card)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 16 }}>🤖</span>
                      <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>AI Security Insights</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        {secInsights.generatedAt ? `Updated ${new Date(secInsights.generatedAt).toLocaleTimeString()}` : ''}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{
                        width: 38, height: 38, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        border: `3px solid ${secInsights.health.color}`, fontWeight: 700, fontSize: 13, color: secInsights.health.color,
                      }}>
                        {secInsights.health.score}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: secInsights.health.color }}>{secInsights.health.label}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Health Score</div>
                      </div>
                    </div>
                  </div>
                  {/* Insight cards */}
                  <div style={{ padding: '10px 14px' }}>
                    {secInsights.insights.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>Not enough data yet for analysis. Insights will appear once the system collects more activity.</div>
                    ) : secInsights.insights.map((ins, i) => {
                      const typeStyles = {
                        critical: { border: '#c62828', bg: '#ffebee', accent: '#c62828' },
                        warning: { border: '#e65100', bg: '#fff3e0', accent: '#e65100' },
                        info: { border: '#1565c0', bg: '#e3f2fd', accent: '#1565c0' },
                        positive: { border: '#2e7d32', bg: '#e8f5e9', accent: '#2e7d32' },
                      };
                      const ts = typeStyles[ins.type] || typeStyles.info;
                      return (
                        <div key={i} style={{
                          padding: '10px 14px', marginBottom: i < secInsights.insights.length - 1 ? 8 : 0,
                          borderRadius: 10, background: ts.bg, borderLeft: `4px solid ${ts.border}`,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                            <span style={{ fontSize: 14 }}>{ins.icon}</span>
                            <span style={{ fontWeight: 700, fontSize: 13, color: ts.accent }}>{ins.title}</span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{ins.detail}</div>
                          {ins.recommendation && (
                            <div style={{
                              fontSize: 12, color: ts.accent, lineHeight: 1.5, marginTop: 6,
                              padding: '6px 10px', background: 'rgba(255,255,255,0.6)', borderRadius: 6,
                              fontWeight: 500,
                            }}>
                              💡 {ins.recommendation}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {/* Trusted context footer */}
                  {secInsights.trustedContext && secInsights.trustedContext.filteredNoiseCount > 0 && (
                    <div style={{ padding: '8px 18px 10px', borderTop: '1px solid #f0f0f0', fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      {secInsights.trustedContext.filteredNoiseCount} event{secInsights.trustedContext.filteredNoiseCount > 1 ? 's' : ''} from known admin IPs filtered from severity counts
                    </div>
                  )}
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
                                background: e.severity === 'critical' ? 'var(--color-error)' : 'var(--color-warning)', color: 'var(--text-on-primary)',
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

              {/* Trusted Admin IPs */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  🔑 Trusted Admin IPs
                  <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>— IPs verified by passkey (auto-expire after 90 days)</span>
                </div>
                <div style={{ background: 'var(--bg-surface)', border: '1px solid #e0e0e0', borderRadius: 12, overflow: 'hidden' }}>
                  {trustedIps.length === 0 ? (
                    <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                      No trusted IPs yet. Your IP will be automatically trusted on your next login.
                    </div>
                  ) : trustedIps.map((ip, i) => (
                    <div key={ip.id} style={{ padding: '10px 14px', borderBottom: i < trustedIps.length - 1 ? '1px solid #f0f0f0' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontWeight: 600, fontSize: 13, fontFamily: 'monospace' }}>{ip.ip_address}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                          via {(ip.verified_via || 'login').replace(/_/g, ' ')}
                        </span>
                        {ip.label && <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 8 }}>{ip.label}</span>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Last seen: {new Date(ip.last_seen_at).toLocaleDateString()}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Expires: {new Date(ip.expires_at).toLocaleDateString()}</div>
                        </div>
                        <button onClick={() => revokeIp(ip.id)} style={{
                          padding: '4px 10px', borderRadius: 6, border: '1px solid #e0e0e0', background: 'var(--bg-surface)',
                          fontSize: 11, color: 'var(--color-error)', cursor: 'pointer', fontWeight: 600,
                        }}>Revoke</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
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

      {/* ─── Document Review Tab ─── */}
      {activeTab === 'docreview' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Document Review</h3>
            <button onClick={loadPendingDocs} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-card)', fontSize: 12, cursor: 'pointer', color: 'var(--text-secondary)' }}>Refresh</button>
          </div>
          {pendingDocsLoading ? <LoadingSpinner text="Loading documents..." /> : pendingDocs.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 14 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
              No documents waiting for review
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {pendingDocs.map(doc => {
                const ai = doc.ai_classification;
                const isExpanded = expandedDocId === doc.id;
                const statusColors = { ai_flagged: '#e74c3c', pending: '#f39c12', ai_review: '#3498db' };
                const statusLabels = { ai_flagged: 'AI Flagged', pending: 'AI Reviewed — Pending Approval', ai_review: 'AI Processing...' };
                return (
                  <div key={doc.id} style={{ background: 'var(--bg-card)', borderRadius: 12, border: `1px solid ${doc.status === 'ai_flagged' ? 'rgba(231,76,60,0.3)' : 'var(--border-color)'}`, overflow: 'hidden' }}>
                    {/* Header row */}
                    <div onClick={() => setExpandedDocId(isExpanded ? null : doc.id)} style={{ padding: '14px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: statusColors[doc.status] || '#999', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
                          {doc.document_type?.replace(/_/g, ' ').toUpperCase()} — {doc.recipientName || 'Unknown recipient'}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                          Uploaded by {doc.uploaderName} · {formatDateTime(doc.created_at)} · {(doc.file_size / 1024).toFixed(0)} KB
                        </div>
                      </div>
                      <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, color: 'white', background: statusColors[doc.status] || '#999' }}>
                        {statusLabels[doc.status] || doc.status}
                      </span>
                      <span style={{ fontSize: 16, color: 'var(--text-secondary)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border-color)' }}>
                        {/* AI Classification Results */}
                        {ai ? (
                          <div style={{ marginTop: 12 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: 'var(--text-primary)' }}>AI Analysis</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', fontSize: 13 }}>
                              <div><span style={{ color: 'var(--text-secondary)' }}>Classification:</span> <strong>{ai.classification?.replace(/_/g, ' ')}</strong></div>
                              <div><span style={{ color: 'var(--text-secondary)' }}>Confidence:</span> <strong style={{ color: ai.confidence >= 0.8 ? '#27ae60' : ai.confidence >= 0.5 ? '#f39c12' : '#e74c3c' }}>{Math.round((ai.confidence || 0) * 100)}%</strong></div>
                              <div><span style={{ color: 'var(--text-secondary)' }}>Valid document:</span> <strong style={{ color: ai.isValid ? '#27ae60' : '#e74c3c' }}>{ai.isValid ? 'Yes' : 'No'}</strong></div>
                              <div><span style={{ color: 'var(--text-secondary)' }}>Matches claimed type:</span> <strong style={{ color: ai.matchesClaimed ? '#27ae60' : '#e74c3c' }}>{ai.matchesClaimed ? 'Yes' : 'No'}</strong></div>
                            </div>
                            {ai.summary && <div style={{ marginTop: 8, fontSize: 13, fontStyle: 'italic', color: 'var(--text-secondary)' }}>{ai.summary}</div>}

                            {/* Extracted Fields */}
                            {ai.extractedFields && Object.keys(ai.extractedFields).some(k => ai.extractedFields[k]) && (
                              <div style={{ marginTop: 12 }}>
                                <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Extracted Fields</div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, background: 'var(--bg-secondary)', padding: 10, borderRadius: 8 }}>
                                  {Object.entries(ai.extractedFields).filter(([, v]) => v).map(([k, v]) => (
                                    <div key={k}><span style={{ color: 'var(--text-secondary)' }}>{k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}:</span> <strong>{v}</strong></div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Concerns */}
                            {ai.concerns && ai.concerns.length > 0 && (
                              <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: 'rgba(231,76,60,0.08)', border: '1px solid rgba(231,76,60,0.2)' }}>
                                <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4, color: '#e74c3c' }}>Concerns</div>
                                {ai.concerns.map((c, i) => <div key={i} style={{ fontSize: 12, color: 'var(--text-primary)', marginTop: 2 }}>• {c}</div>)}
                              </div>
                            )}
                          </div>
                        ) : doc.status === 'ai_review' ? (
                          <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>AI classification is still processing...</div>
                        ) : null}

                        {/* Preview link */}
                        <div style={{ marginTop: 12 }}>
                          <button onClick={async () => {
                            try {
                              const res = await fetch(`/api/documents/${doc.id}/download`, { credentials: 'include', headers: window.getCsrfToken ? { 'X-CSRF-Token': window.getCsrfToken() } : {} });
                              if (res.ok) { const blob = await res.blob(); window.open(URL.createObjectURL(blob), '_blank'); }
                            } catch (e) { showToast('Failed to load preview', 'error'); }
                          }} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', fontSize: 12, cursor: 'pointer', color: 'var(--text-primary)' }}>
                            View Document
                          </button>
                        </div>

                        {/* Admin action: notes + approve/reject */}
                        {doc.status !== 'ai_review' && (
                          <div style={{ marginTop: 16, borderTop: '1px solid var(--border-color)', paddingTop: 12 }}>
                            <textarea
                              value={reviewNotes}
                              onChange={e => setReviewNotes(e.target.value)}
                              placeholder="Optional notes (reason for rejection, observations, etc.)"
                              style={{ width: '100%', minHeight: 48, padding: 10, borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
                            />
                            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                              <button
                                onClick={() => handleDocReview(doc.id, 'approve')}
                                disabled={reviewingDocId === doc.id}
                                style={{ flex: 1, padding: '10px 16px', borderRadius: 8, border: 'none', background: '#27ae60', color: 'white', fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: reviewingDocId === doc.id ? 0.6 : 1 }}
                              >
                                {reviewingDocId === doc.id ? '...' : 'Approve'}
                              </button>
                              <button
                                onClick={() => handleDocReview(doc.id, 'reject')}
                                disabled={reviewingDocId === doc.id}
                                style={{ flex: 1, padding: '10px 16px', borderRadius: 8, border: 'none', background: '#e74c3c', color: 'white', fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: reviewingDocId === doc.id ? 0.6 : 1 }}
                              >
                                {reviewingDocId === doc.id ? '...' : 'Reject'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
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
                                style={{ padding: '4px 10px', borderRadius: '4px', border: 'none', fontSize: '11px', fontWeight: 600, cursor: 'pointer', background: 'var(--role-color)', color: 'var(--text-on-primary)' }}>
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
                    style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: 'var(--color-error)', color: 'var(--text-on-primary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
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
          {/* ── Session Detail Drawer ── */}
          {sessionDetail && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}
              onClick={e => { if (e.target === e.currentTarget) setSessionDetail(null); }}>
              <div style={{ width: '100%', maxWidth: 520, background: 'var(--bg-surface)', height: '100%', overflowY: 'auto', padding: '20px', boxShadow: '-4px 0 20px rgba(0,0,0,0.15)' }}>
                {/* Drawer header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Session Detail</h3>
                  <button onClick={() => setSessionDetail(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)', padding: '4px 8px' }}>{'\u2715'}</button>
                </div>

                {/* Session header card */}
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', borderRadius: 10, padding: 14, marginBottom: 14 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                    {sessionDetail.recipient?.name || 'Unknown'}
                    {sessionDetail.recipient?.age ? `, ${sessionDetail.recipient.age}` : ''}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    {sessionDetail.session?.scheduled_date} at {sessionDetail.session?.scheduled_time} {'\u00B7'} {sessionDetail.session?.duration_hours}h {sessionDetail.session?.service_type}
                  </div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                    <span>Family: {sessionDetail.family?.name}</span>
                    {sessionDetail.caregiver && <span>Caregiver: {sessionDetail.caregiver?.name}</span>}
                  </div>
                  <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {(() => {
                      const st = sessionDetail.session?.status;
                      const colors = { completed: '#16a34a', in_progress: '#2563eb', confirmed: '#7c3aed', cancelled: '#dc2626', requested: '#d97706', open: '#d97706', pending: '#d97706' };
                      return React.createElement('span', { style: { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: (colors[st] || '#888') + '20', color: colors[st] || '#888' }}, (st || '').replace(/_/g, ' ').toUpperCase());
                    })()}
                    {sessionDetail.session?.payment_status && React.createElement('span', { style: { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: '#e0f2fe', color: '#0369a1' }}, 'Pay: ' + sessionDetail.session.payment_status)}
                    {sessionDetail.session?.review_required ? React.createElement('span', { style: { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: '#fef3c7', color: '#92400e' }}, 'Review needed') : null}
                    {sessionDetail.session?.late_check_in ? React.createElement('span', { style: { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: '#fff1f2', color: '#be123c' }}, 'Late ' + (sessionDetail.session.late_minutes || '') + 'min') : null}
                  </div>
                  {sessionDetail.session?.special_instructions && (
                    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)', fontStyle: 'italic', padding: '6px 8px', background: 'var(--bg-neutral)', borderRadius: 6 }}>
                      {sessionDetail.session.special_instructions}
                    </div>
                  )}
                </div>

                {/* GPS data from visit log */}
                {sessionDetail.visitLog?.some(vl => vl.check_in_lat && vl.check_in_lng) && (
                  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 12, marginBottom: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#166534', marginBottom: 6 }}>Check-In Location</div>
                    {sessionDetail.visitLog.filter(vl => vl.check_in_lat).map((vl, i) => (
                      <div key={i} style={{ fontSize: 12, color: '#15803d' }}>
                        {vl.check_in_lat.toFixed(5)}, {vl.check_in_lng.toFixed(5)}
                        {vl.check_in_distance_ft != null && ` \u00B7 ${Math.round(vl.check_in_distance_ft)} ft from home`}
                        {vl.check_out_lat && vl.check_out_lng && (
                          <div style={{ marginTop: 4, color: '#166534' }}>
                            Check-out: {vl.check_out_lat.toFixed(5)}, {vl.check_out_lng.toFixed(5)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Timeline */}
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>Session Timeline</div>
                {(sessionDetail.timeline || []).length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>No timeline events</div>
                ) : (
                  <div style={{ position: 'relative', paddingLeft: 20 }}>
                    {/* Vertical line */}
                    <div style={{ position: 'absolute', left: 7, top: 4, bottom: 4, width: 2, background: '#e5e7eb' }} />
                    {sessionDetail.timeline.map((ev, i) => {
                      const icons = { booking: '\u{1F4C5}', confirmed: '\u2705', check_in: '\u{1F4CD}', visit_notes: '\u{1F4DD}', check_out: '\u{1F3C1}', no_show: '\u26A0\uFE0F', cancelled: '\u274C', completed: '\u2705', payment: '\u{1F4B3}', payment_auth: '\u{1F512}', payment_capture: '\u{1F4B0}', admin_action: '\u{1F6E0}\uFE0F' };
                      const dotColors = { booking: '#d97706', confirmed: '#7c3aed', check_in: '#16a34a', check_out: '#0369a1', no_show: '#dc2626', cancelled: '#dc2626', completed: '#16a34a', payment: '#0369a1', payment_auth: '#7c3aed', payment_capture: '#16a34a', admin_action: '#6b7280', visit_notes: '#d97706' };
                      return (
                        <div key={i} style={{ position: 'relative', marginBottom: 14, paddingLeft: 14 }}>
                          {/* Dot */}
                          <div style={{ position: 'absolute', left: -17, top: 3, width: 12, height: 12, borderRadius: '50%', background: dotColors[ev.type] || '#888', border: '2px solid var(--bg-surface)', zIndex: 1 }} />
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>
                            {ev.time ? new Date(ev.time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                            {icons[ev.type] || '\u25CF'} {ev.label}
                          </div>
                          {ev.detail && (
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.5 }}>
                              {ev.detail}
                            </div>
                          )}
                          {/* Moods */}
                          {ev.moods && Object.keys(ev.moods).length > 0 && (
                            <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                              {Object.entries(ev.moods).map(([key, val]) => val && (
                                <span key={key} style={{ fontSize: 11, padding: '2px 6px', background: 'var(--bg-highlight)', borderRadius: 4 }}>
                                  {key}: {Array.isArray(val) ? val.join(', ') : val}
                                </span>
                              ))}
                            </div>
                          )}
                          {/* Condition tags */}
                          {ev.tags?.length > 0 && (
                            <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                              {ev.tags.map((t, ti) => (
                                <span key={ti} style={{ fontSize: 10, padding: '1px 6px', background: '#fef3c7', color: '#92400e', borderRadius: 4, fontWeight: 600 }}>{t}</span>
                              ))}
                            </div>
                          )}
                          {/* GPS on check-in events */}
                          {ev.gps && (
                            <div style={{ fontSize: 11, color: '#15803d', marginTop: 3 }}>
                              GPS: {ev.gps.lat?.toFixed(5)}, {ev.gps.lng?.toFixed(5)}
                              {ev.gps.distance_ft != null && ` (${Math.round(ev.gps.distance_ft)} ft)`}
                            </div>
                          )}
                          {/* Admin action details */}
                          {ev.adminDetails && Object.keys(ev.adminDetails).length > 0 && (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, fontFamily: 'monospace', background: 'var(--bg-neutral)', padding: '4px 6px', borderRadius: 4 }}>
                              {JSON.stringify(ev.adminDetails, null, 0).substring(0, 200)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Visit log details */}
                {sessionDetail.visitLog?.length > 0 && sessionDetail.visitLog.some(vl => vl.ai_summary) && (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>AI Visit Summary</div>
                    {sessionDetail.visitLog.filter(vl => vl.ai_summary).map((vl, i) => (
                      <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, padding: '8px 10px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
                        {vl.ai_summary}
                      </div>
                    ))}
                  </div>
                )}

                {/* Payment details */}
                {sessionDetail.payments?.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>Payment Records</div>
                    {sessionDetail.payments.map((p, i) => (
                      <div key={i} style={{ fontSize: 12, padding: '8px 10px', background: '#eff6ff', borderRadius: 8, border: '1px solid #bfdbfe', marginBottom: 6 }}>
                        <div style={{ fontWeight: 600, color: '#1e40af' }}>
                          ${((p.amount || 0) / 100).toFixed(2)} — {p.status}
                          {p.auto_charged ? ' (auto)' : ''}
                          {p.tip_cents > 0 ? ` + $${(p.tip_cents / 100).toFixed(2)} tip` : ''}
                        </div>
                        <div style={{ color: '#3b82f6', marginTop: 2 }}>
                          Caregiver: ${((p.caregiver_payout || 0) / 100).toFixed(2)} | Platform: ${((p.platform_fee || 0) / 100).toFixed(2)}
                        </div>
                        {p.stripe_payment_intent && (
                          <div style={{ color: '#64748b', marginTop: 2, fontFamily: 'monospace', fontSize: 10 }}>
                            PI: {p.stripe_payment_intent}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── All Sessions Browser ── */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <span>All Sessions</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {['all', 'completed', 'in_progress', 'confirmed', 'cancelled', 'requested'].map(st => (
                  <button key={st} onClick={() => { setSessionStatusFilter(st); loadAllSessions(st); }}
                    style={{
                      padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      border: sessionStatusFilter === st ? '2px solid var(--role-color)' : '1px solid #ddd',
                      background: sessionStatusFilter === st ? 'var(--role-color)' : 'var(--bg-surface)',
                      color: sessionStatusFilter === st ? 'var(--text-on-primary)' : 'var(--text-secondary)',
                    }}>
                    {st === 'all' ? 'All' : st === 'in_progress' ? 'In Progress' : st.charAt(0).toUpperCase() + st.slice(1)}
                  </button>
                ))}
                <select value={sessionDaysFilter} onChange={e => { const d = Number(e.target.value); setSessionDaysFilter(d); loadAllSessions(null, d); }}
                  style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, border: '1px solid #ddd', background: 'var(--bg-surface)' }}>
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                  <option value={60}>60 days</option>
                  <option value={90}>90 days</option>
                </select>
              </div>
            </div>
            {allSessionsLoading ? (
              <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>Loading...</div>
            ) : allSessions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>No sessions found</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {allSessions.map(s => {
                  const statusColors = { completed: '#16a34a', in_progress: '#2563eb', confirmed: '#7c3aed', cancelled: '#dc2626', requested: '#d97706', open: '#d97706', pending: '#d97706', matching: '#6b7280', negotiating: '#6b7280' };
                  const flags = [];
                  if (s.caregiver_no_show) flags.push('NO-SHOW');
                  if (s.review_required) flags.push('REVIEW');
                  if (s.cancelled_by === 'system') flags.push('SYS-CANCEL');
                  return (
                    <div key={s.id} onClick={() => loadSessionDetail(s.id)} style={{
                      padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
                      border: '1px solid var(--border-default)', background: 'var(--bg-card)',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                      transition: 'background 0.15s',
                    }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-highlight)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-card)'}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {s.recipient_name || 'Unknown'}
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: (statusColors[s.status] || '#888') + '18', color: statusColors[s.status] || '#888' }}>
                            {(s.status || '').replace(/_/g, ' ')}
                          </span>
                          {flags.map((f, fi) => (
                            <span key={fi} style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: '#fef2f2', color: '#dc2626' }}>{f}</span>
                          ))}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                          {s.scheduled_date} {s.scheduled_time} {'\u00B7'} {s.service_type || ''} {'\u00B7'} CG: {s.caregiver_name || 'unassigned'}
                        </div>
                      </div>
                      <span style={{ fontSize: 16, color: 'var(--text-muted)' }}>{'\u203A'}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── No-Show Cancelled Sessions ── */}
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
                        padding: '8px 18px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none',
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
                        padding: '8px 18px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none',
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

      {/* ─── Legal Docs Tab ─── */}
      {activeTab === 'legal' && (
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Legal Document Management</h2>

          {/* Publish new version */}
          <div className="card" style={{ marginBottom: 16, padding: 18 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Publish New Version</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px' }}>
              Publishing a new version deactivates the previous one. All users will see the updated document and must re-agree before using the app.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>Document Type</label>
                <select value={legalDraft.docType} onChange={e => setLegalDraft({ ...legalDraft, docType: e.target.value })}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13 }}>
                  <option value="terms">Terms of Service</option>
                  <option value="privacy">Privacy Policy</option>
                  <option value="liability">Liability Disclaimer</option>
                  <option value="disclaimer">Platform Disclaimer</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>Version</label>
                <input value={legalDraft.version} onChange={e => setLegalDraft({ ...legalDraft, version: e.target.value })}
                  placeholder="e.g. 2.0" style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>Title</label>
                <input value={legalDraft.title} onChange={e => setLegalDraft({ ...legalDraft, title: e.target.value })}
                  placeholder="e.g. Terms of Service" style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>Content (plain text or HTML)</label>
              <textarea value={legalDraft.content} onChange={e => setLegalDraft({ ...legalDraft, content: e.target.value })}
                rows={10} placeholder="Paste your legal document content here..."
                style={{ width: '100%', padding: '10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical', boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>
                Change Summary (optional — auto-generated if left blank)
              </label>
              <textarea value={legalDraft.changeSummary} onChange={e => setLegalDraft({ ...legalDraft, changeSummary: e.target.value })}
                rows={3} placeholder="Brief summary of what changed for users..."
                style={{ width: '100%', padding: '10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button onClick={publishLegalDoc} disabled={legalPublishing}
                style={{ padding: '10px 24px', borderRadius: 8, background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', fontWeight: 600, fontSize: 14, cursor: 'pointer', opacity: legalPublishing ? 0.7 : 1 }}>
                {legalPublishing ? 'Publishing...' : 'Publish & Require Re-Agreement'}
              </button>
              {legalMsg && <span style={{ fontSize: 13, color: legalMsg.includes('Failed') || legalMsg.includes('required') ? '#c62828' : '#2e7d32', fontWeight: 500 }}>{legalMsg}</span>}
            </div>
          </div>

          {/* Current active documents */}
          <div className="card" style={{ marginBottom: 16, padding: 18 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Active Documents</h3>
            {legalDocs.filter(d => d.is_active).length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No legal documents published yet. The legacy disclaimer is active by default.</p>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {legalDocs.filter(d => d.is_active).map(d => (
                  <div key={d.id} style={{ padding: '12px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>{d.title}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>v{d.version}</span>
                        <span style={{
                          marginLeft: 8, fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                          background: '#e8f5e9', color: '#2e7d32',
                        }}>ACTIVE</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {d.acceptance_count || 0} accepted
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                      Type: {d.doc_type} · Published {d.published_at ? new Date(d.published_at).toLocaleDateString() : '—'}
                      {d.published_by_name && <span> by {d.published_by_name}</span>}
                    </div>
                    {d.change_summary && (
                      <div style={{ fontSize: 12, color: '#1565c0', marginTop: 6, padding: '6px 10px', background: '#e3f2fd', borderRadius: 6 }}>
                        Changes: {d.change_summary}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Acceptance stats */}
          {legalAcceptances?.stats && legalAcceptances.stats.length > 0 && (
            <div className="card" style={{ marginBottom: 16, padding: 18 }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Acceptance Stats</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                {legalAcceptances.stats.map((s, i) => {
                  const pct = s.total_users > 0 ? Math.round((s.accepted_count / s.total_users) * 100) : 0;
                  return (
                    <div key={i} style={{ padding: '14px 16px', borderRadius: 10, background: 'var(--bg-surface)', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{s.doc_type} v{s.version}</div>
                      <div style={{ fontSize: 24, fontWeight: 700, color: pct >= 90 ? '#2e7d32' : pct >= 50 ? '#e65100' : '#c62828', marginTop: 4 }}>{pct}%</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.accepted_count} / {s.total_users} users</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Version history */}
          {legalDocs.filter(d => !d.is_active).length > 0 && (
            <div className="card" style={{ padding: 18 }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700, color: 'var(--text-secondary)' }}>Version History</h3>
              {legalDocs.filter(d => !d.is_active).map(d => (
                <div key={d.id} style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{d.title} v{d.version}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>({d.doc_type})</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {d.acceptance_count || 0} accepted · {d.published_at ? new Date(d.published_at).toLocaleDateString() : '—'}
                  </div>
                </div>
              ))}
            </div>
          )}
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
                      style={{ padding: '5px 12px', background: 'var(--color-info)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', textDecoration: 'none', textAlign: 'center' }}>
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
                        style={{ padding: '4px 10px', background: 'var(--color-error)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
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
              <button onClick={loadBgChecks} style={{ padding: '6px 14px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
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
                          style={{ padding: '4px 12px', background: recurSaving ? 'var(--text-muted)' : 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: recurSaving ? 'not-allowed' : 'pointer' }}>
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
              style={{ padding: '6px 16px', background: !newRecurring.category || !newRecurring.amount ? 'var(--text-muted)' : 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
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
              style={{ padding: '6px 16px', background: !newCost.category || !newCost.amount ? 'var(--text-muted)' : 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
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
                                    style={{ padding: '3px 10px', background: costSaving ? 'var(--text-muted)' : 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: costSaving ? 'not-allowed' : 'pointer' }}>
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
                style={{ padding: '8px 20px', background: freezeSending || !freezeReason.trim() ? 'var(--text-muted)' : 'var(--color-error)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
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
                style={{ padding: '8px 20px', background: rejectBgSending || !rejectBgReason.trim() ? 'var(--text-muted)' : 'var(--color-error)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
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
                style={{ padding: '8px 20px', background: adminMsgSending || !adminMsgText.trim() ? 'var(--text-muted)' : 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                {adminMsgSending ? 'Sending...' : 'Send as InPlace Support'}
              </button>
            </div>
          </div>
        </div>
      )}

        </div>
      </div>

      {/* ═══ User Detail Drawer ═══ */}
      {(userDrawer || userDrawerLoading) && (
        <>
          <div onClick={() => { setUserDrawer(null); setUserDrawerLoading(false); }} style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 300,
          }} />
          <div style={{
            position: 'fixed', top: 0, right: 0, width: window.innerWidth <= 768 ? '100%' : 480, maxWidth: '100%', height: '100vh',
            background: 'var(--bg-card)', boxShadow: '-4px 0 24px rgba(0,0,0,0.15)', zIndex: 301,
            overflowY: 'auto', WebkitOverflowScrolling: 'touch',
          }}>
            {/* Drawer header */}
            <div style={{
              padding: '18px 20px', borderBottom: '1px solid var(--border-color)',
              display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
              position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 1,
            }}>
              <div>
                {userDrawer?.user ? (
                  <>
                    <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
                      {userDrawer.user.first_name} {userDrawer.user.last_name}
                    </h3>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
                      {userDrawer.user.email} · {userDrawer.user.role}
                    </p>
                  </>
                ) : (
                  <h3 style={{ margin: 0, fontSize: 18, color: 'var(--text-secondary)' }}>Loading...</h3>
                )}
              </div>
              <button onClick={(e) => { e.stopPropagation(); setUserDrawer(null); setUserDrawerLoading(false); }}
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', fontSize: 18, cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px 10px', borderRadius: 8, lineHeight: 1, flexShrink: 0 }}
                title="Close">✕</button>
            </div>

            {userDrawerLoading && !userDrawer && (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Loading user details...</div>
            )}

            {userDrawer && (
              <div style={{ padding: '18px 20px' }}>
                {/* Journey stage bar */}
                {userDrawer.journeyStage && (
                  <div style={{ display: 'flex', gap: 2, marginBottom: 16 }}>
                    {['signup', 'verified', 'team_built', 'first_visit', 'active'].map(step => {
                      const steps = userDrawer.journeySteps || {};
                      const current = userDrawer.journeyStage;
                      const order = ['signup', 'verified', 'team_built', 'first_visit', 'active'];
                      const ci = order.indexOf(current);
                      const si = order.indexOf(step);
                      const isDone = si < ci;
                      const isNow = si === ci;
                      const labels = { signup: 'Signup', verified: 'Verified', team_built: 'Team', first_visit: '1st Visit', active: 'Active' };
                      return (
                        <div key={step} style={{
                          flex: 1, textAlign: 'center', padding: '8px 4px', borderRadius: 6,
                          fontSize: 10, fontWeight: isNow ? 700 : 500,
                          background: isNow ? 'var(--role-color)' : isDone ? '#e8f5e9' : 'var(--bg-surface)',
                          color: isNow ? 'var(--text-on-primary)' : isDone ? '#2e7d32' : 'var(--text-muted)',
                        }}>{labels[step]}</div>
                      );
                    })}
                  </div>
                )}

                {/* Quick stats */}
                <div style={{ marginBottom: 22 }}>
                  <h4 style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-secondary)', marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--border-color)' }}>Stats</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Completed Visits</div><div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{userDrawer.sessionStats?.completed || 0}</div></div>
                    <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>No-shows</div><div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{userDrawer.sessionStats?.no_shows || 0}</div></div>
                    <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Lifetime Revenue</div><div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>${userDrawer.lifetimeRevenue || '0.00'}</div></div>
                    <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Avg Rating</div><div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{userDrawer.reviewStats?.avg_rating ? Number(userDrawer.reviewStats.avg_rating).toFixed(1) : '—'} ({userDrawer.reviewStats?.total_reviews || 0})</div></div>
                    <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Care Teams</div><div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{userDrawer.careTeams?.length || 0}</div></div>
                    <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Last Active</div><div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{userDrawer.lastActive ? new Date(userDrawer.lastActive).toLocaleDateString() : '—'}</div></div>
                  </div>
                </div>

                {/* Admin notes */}
                <div style={{ marginBottom: 22 }}>
                  <h4 style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-secondary)', marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--border-color)' }}>Admin Notes</h4>
                  <textarea
                    defaultValue={userDrawer.user?.admin_notes || ''}
                    onBlur={(e) => { if (e.target.value !== (userDrawer.user?.admin_notes || '')) saveAdminNotes(userDrawer.user.id, e.target.value); }}
                    placeholder="Sticky notes about this user..."
                    style={{
                      width: '100%', minHeight: 60, padding: 10, border: '1px solid var(--border-color)',
                      borderRadius: 8, fontSize: 12, fontFamily: 'inherit', background: '#fff8e1',
                      color: 'var(--text-primary)', boxSizing: 'border-box', resize: 'vertical',
                    }}
                  />
                </div>

                {/* Tickets */}
                {userDrawer.tickets?.length > 0 && (
                  <div style={{ marginBottom: 22 }}>
                    <h4 style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-secondary)', marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--border-color)' }}>Tickets ({userDrawer.tickets.length})</h4>
                    {userDrawer.tickets.map(t => (
                      <div key={t.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}
                        onClick={() => { setUserDrawer(null); setActiveTab('tickets'); setTimeout(() => loadTicketDetail(t.id), 200); }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{t.subject}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                          <span style={{ padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 600, color: '#fff',
                            background: t.status === 'open' ? '#ef5350' : t.status === 'in_progress' ? '#ff9800' : t.status === 'resolved' ? '#4caf50' : '#9e9e9e'
                          }}>{t.status?.replace('_',' ')}</span>
                          <span style={{ marginLeft: 8 }}>{new Date(t.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Safety flags */}
                {userDrawer.safetyFlags?.length > 0 && (
                  <div style={{ marginBottom: 22 }}>
                    <h4 style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#c62828', marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--border-color)' }}>Safety Flags ({userDrawer.safetyFlags.length})</h4>
                    {userDrawer.safetyFlags.map(f => (
                      <div key={f.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border-color)' }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{f.category || 'Flag'}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{f.status} · {new Date(f.created_at).toLocaleDateString()}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* ─── Documents ─── */}
                <div style={{ marginBottom: 22 }}>
                  <h4 style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-secondary)', marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--border-color)' }}>
                    Documents ({userDrawer.allDocuments?.length || 0})
                  </h4>
                  {userDrawer.allDocuments?.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {userDrawer.allDocuments.map(doc => {
                        const typeLabels = {
                          DL_Front: 'DL (Front)', DL_Back: 'DL (Back)', Passport: 'Passport', State_ID: 'State ID',
                          CNA: 'CNA Cert', HHA: 'HHA Cert', LPN: 'LPN Cert', RN: 'RN Cert',
                          CPR: 'CPR Cert', BLS: 'BLS Cert', ACLS: 'ACLS Cert', First_Aid: 'First Aid',
                          POA: 'Power of Attorney', Healthcare_POA: 'Healthcare POA', Court_Order: 'Court Order',
                          Living_Will: 'Living Will', Legal_Guardianship: 'Legal Guardianship',
                          Liability_Insurance: 'Liability Insurance', Auto_Insurance: 'Auto Insurance',
                          Health_Insurance: 'Health Insurance', Other: 'Other', Other_Cert: 'Other Cert',
                          Other_Legal: 'Other Legal',
                        };
                        const statusColors = {
                          approved: '#4caf50', pending: '#ff9800', ai_review: '#2196f3',
                          ai_flagged: '#ff5722', rejected: '#c62828', expired: '#9e9e9e', uploaded: '#607d8b',
                        };
                        const categoryIcons = {
                          identity: '\u{1F4CB}', certification: '\u{1F3C5}', insurance: '\u{1F6E1}\uFE0F',
                          legal: '\u{2696}\uFE0F', consent: '\u{1F4DD}',
                        };
                        const catIcon = categoryIcons[doc.category] || '\u{1F4C4}';
                        const label = typeLabels[doc.document_type] || doc.document_type || 'Unknown';
                        const statusColor = statusColors[doc.status] || '#9e9e9e';

                        return React.createElement('div', {
                          key: doc.id,
                          style: {
                            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                            background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border-color)',
                            cursor: 'pointer', transition: 'background 0.12s',
                          },
                          onClick: async () => {
                            try {
                              const source = doc.source_table || '';
                              const res = await apiFetch(`/api/admin/documents/${doc.id}?source=${source}`);
                              if (res?.ok) {
                                const data = await res.json();
                                const d = data.document;
                                if (d.file_data) {
                                  // file_data is base64 data URI — open in new tab
                                  const w = window.open('', '_blank');
                                  if (w) {
                                    if (d.file_data.startsWith('data:application/pdf') || (d.mime_type || '').includes('pdf')) {
                                      w.document.write(`<html><body style="margin:0"><iframe src="${d.file_data}" style="width:100%;height:100vh;border:none"></iframe></body></html>`);
                                    } else {
                                      w.document.write(`<html><body style="margin:0;background:#111;display:flex;justify-content:center;align-items:center;min-height:100vh"><img src="${d.file_data}" style="max-width:100%;max-height:100vh;object-fit:contain" /></body></html>`);
                                    }
                                    w.document.title = label + ' — ' + (d.file_name || 'Document');
                                  }
                                } else {
                                  showToast('No file data stored for this document', 'error');
                                }
                              } else {
                                showToast('Failed to load document', 'error');
                              }
                            } catch (err) { showToast('Error loading document: ' + err.message, 'error'); }
                          },
                        },
                          React.createElement('span', { style: { fontSize: 18, flexShrink: 0 } }, catIcon),
                          React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                            React.createElement('div', { style: { fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, label),
                            React.createElement('div', { style: { fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 } },
                              doc.file_name || '—',
                              doc.recipient_name ? ` · for ${doc.recipient_name}` : '',
                              ' · ', new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                            ),
                          ),
                          React.createElement('span', {
                            style: {
                              padding: '2px 8px', borderRadius: 8, fontSize: 10, fontWeight: 600,
                              color: '#fff', background: statusColor, flexShrink: 0, textTransform: 'capitalize',
                            }
                          }, (doc.status || 'uploaded').replace('_', ' ')),
                          React.createElement('span', { style: { fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 } }, '\u203A'),
                        );
                      })}
                    </div>
                  ) : (
                    <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0' }}>No documents uploaded by this user.</p>
                  )}
                </div>

                {/* Quick actions */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => { setUserDrawer(null); setActiveTab('people'); setUserSearch(userDrawer.user?.email); }}
                    style={{ padding: '6px 12px', background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>
                    👤 View in People
                  </button>
                  <button onClick={() => { setAdminMsgTarget({ id: userDrawer.user?.id, first_name: userDrawer.user?.first_name, last_name: userDrawer.user?.last_name }); }}
                    style={{ padding: '6px 12px', background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>
                    💬 Message
                  </button>
                </div>

                {/* Danger zone — soft delete & nuke */}
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', marginBottom: 8 }}>Danger Zone</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {deleteConfirm === userDrawer.user?.id ? (
                      <button onClick={() => handleDeleteUser(userDrawer.user.id, userDrawer.user.email)}
                        disabled={deleteLoading}
                        style={{ padding: '6px 14px', background: '#c62828', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                        Confirm Soft Delete
                      </button>
                    ) : (
                      <button onClick={() => { setDeleteConfirm(userDrawer.user?.id); setNukeConfirm(null); }}
                        style={{ padding: '6px 14px', background: 'var(--bg-surface)', color: '#c62828', border: '1px solid #ef9a9a', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                        Soft Delete
                      </button>
                    )}
                    {nukeConfirm === userDrawer.user?.id ? (
                      nukePasswordMode ? (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <input type="password" placeholder="Admin password" value={nukePassword}
                            onChange={e => setNukePassword(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleNukeUser(userDrawer.user.id, userDrawer.user.email)}
                            style={{ padding: '6px 10px', border: '1px solid #ef9a9a', borderRadius: 6, fontSize: 12, width: 140 }} />
                          <button onClick={() => handleNukeUser(userDrawer.user.id, userDrawer.user.email)}
                            disabled={nukeLoading}
                            style={{ padding: '6px 14px', background: nukeLoading ? '#999' : '#b71c1c', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: nukeLoading ? 'wait' : 'pointer' }}>
                            {nukeLoading ? 'Nuking...' : 'Nuke'}
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => handleNukeUser(userDrawer.user.id, userDrawer.user.email)}
                          disabled={nukeLoading}
                          style={{ padding: '6px 14px', background: nukeLoading ? '#999' : '#b71c1c', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: nukeLoading ? 'wait' : 'pointer' }}>
                          {nukeLoading ? 'Verifying...' : 'Confirm Nuke (Passkey)'}
                        </button>
                      )
                    ) : (
                      <button onClick={() => { setNukeConfirm(userDrawer.user?.id); setDeleteConfirm(null); }}
                        style={{ padding: '6px 14px', background: 'var(--bg-surface)', color: '#b71c1c', border: '1px solid #ef9a9a', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                        Nuke
                      </button>
                    )}
                    {(deleteConfirm === userDrawer.user?.id || nukeConfirm === userDrawer.user?.id) && (
                      <button onClick={() => { setDeleteConfirm(null); setNukeConfirm(null); setNukeError(null); setNukePasswordMode(false); setNukePassword(''); }}
                        style={{ padding: '6px 12px', background: 'none', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>
                        Cancel
                      </button>
                    )}
                  </div>
                  {nukeError && nukeConfirm === userDrawer.user?.id && (
                    <div style={{ fontSize: 11, color: 'var(--color-error)', marginTop: 6 }}>{nukeError}</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}

    </div>
  );
};
