// ─── Admin / Superuser Dashboard ───
// Only visible to users with is_admin = 1. Layered on top of normal family account.
const AdminPanel = window.AdminPanel = () => {
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
  const [feedbackTotal, setFeedbackTotal] = useState(0);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackFilter, setFeedbackFilter] = useState({ category: '', status: '' });
  const [expandedFeedback, setExpandedFeedback] = useState(null);
  const [feedbackEditNotes, setFeedbackEditNotes] = useState('');
  // Blocked emails state
  const [blockedEmails, setBlockedEmails] = useState([]);
  const [blockEmailInput, setBlockEmailInput] = useState('');
  const [blockReasonInput, setBlockReasonInput] = useState('');
  const [blockLoading, setBlockLoading] = useState(false);
  // User delete state
  const [deleteConfirm, setDeleteConfirm] = useState(null); // userId being confirmed
  const [deleteLoading, setDeleteLoading] = useState(false);
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
  const [peopleSubTab, setPeopleSubTab] = useState('all'); // 'all', 'waitlist', 'invites'

  useEffect(() => {
    loadStats();
    // Fetch current user for settings tab
    apiFetch('/api/auth/me').then(r => r.json()).then(data => setUser(data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (activeTab === 'users') loadUsers();
    if (activeTab === 'people') { loadWaitlist(); loadInvites(); loadCareTeamInvites(); }
    if (activeTab === 'activity') loadActivity();
    if (activeTab === 'feedback') loadFeedback();
    if (activeTab === 'blocked') loadBlockedEmails();
    if (activeTab === 'help') loadHelpArticles();
    if (activeTab === 'onboarding') loadOnboardingEvents();
  }, [activeTab]);

  // Auto-reload users when filters change
  useEffect(() => {
    if (activeTab === 'users') loadUsers();
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

  const tabs = [
    { id: 'overview', label: 'Overview', icon: '📊' },
    { id: 'users', label: 'Users', icon: '👥' },
    { id: 'people', label: 'People', icon: '📋' },
    { id: 'activity', label: 'Activity', icon: '⚡' },
    { id: 'feedback', label: 'Feedback', icon: '💬' },
    { id: 'help', label: 'Help/FAQ', icon: '❓' },
    { id: 'financials', label: 'Financials', icon: '💰' },
    { id: 'onboarding', label: 'Auth Events', icon: '🚦' },
    { id: 'blocked', label: 'Blocked', icon: '🚫' },
    { id: 'settings', label: 'Settings', icon: '⚙️' },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 className="greeting" style={{ marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{
              background: '#1b6b5a', color: 'white', padding: '4px 10px', borderRadius: '6px',
              fontSize: '13px', fontWeight: 700, letterSpacing: '0.5px',
            }}>ADMIN</span>
            Platform Dashboard
          </h1>
          <div style={{ color: '#666', fontSize: '14px' }}>
            Manage users, waitlist, and platform metrics
          </div>
        </div>
      </div>

      {/* Tab Navigation — Card Grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
        gap: '8px', marginBottom: '20px',
      }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: '4px', padding: '14px 8px', border: 'none', borderRadius: '12px', cursor: 'pointer',
            background: activeTab === tab.id ? '#1b6b5a' : '#f5f5f5',
            color: activeTab === tab.id ? '#fff' : '#555',
            transition: 'all 0.15s', minHeight: '72px',
            boxShadow: activeTab === tab.id ? '0 2px 8px rgba(27,107,90,0.3)' : 'none',
          }}>
            <span style={{ fontSize: '24px', lineHeight: 1 }}>{tab.icon}</span>
            <span style={{ fontSize: '11px', fontWeight: activeTab === tab.id ? 700 : 600, letterSpacing: '0.3px' }}>{tab.label}</span>
          </button>
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
                        <rect x={x} y={100 - barH} width="24" height={barH} rx="4" fill="#1b6b5a" opacity="0.85" />
                        <text x={x + 12} y={96 - barH} textAnchor="middle" fontSize="10" fill="#333" fontWeight="600">{d.count}</text>
                        <text x={x + 12} y={115} textAnchor="middle" fontSize="8" fill="#999">
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
                        <rect x={x} y={100 - barH} width="24" height={barH} rx="4" fill="#e8724a" opacity="0.85" />
                        <text x={x + 12} y={96 - barH} textAnchor="middle" fontSize="10" fill="#333" fontWeight="600">{d.count}</text>
                        <text x={x + 12} y={115} textAnchor="middle" fontSize="8" fill="#999">
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
                    padding: '12px 20px', background: '#f8f9fa', borderRadius: '8px',
                    textAlign: 'center', flex: '1 1 100px',
                  }}>
                    <div style={{ fontSize: '24px', fontWeight: 700, color: '#1b6b5a' }}>{s.count}</div>
                    <div style={{ fontSize: '12px', color: '#666', textTransform: 'capitalize' }}>{s.status}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Plausible link */}
          <div className="card" style={{ marginTop: '16px' }}>
            <div className="card-header"><span className="card-icon">🌐</span>Site Analytics</div>
            <div style={{ padding: '12px 0' }}>
              <p style={{ fontSize: '14px', color: '#666', marginBottom: '12px' }}>
                Detailed site traffic, page views, referrers, and visitor geography are tracked via Plausible Analytics.
              </p>
              <a href="https://plausible.io/yourinplace.com" target="_blank" rel="noopener noreferrer" style={{
                display: 'inline-flex', alignItems: 'center', gap: '8px',
                padding: '10px 20px', background: '#1b6b5a', color: 'white', borderRadius: '8px',
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

      {/* ─── Users Tab ─── */}
      {activeTab === 'users' && (
        <div>
          {/* Search and filter */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="text" placeholder="Search by name or email..." value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadUsers()}
              style={{
                flex: '1 1 250px', padding: '10px 14px', borderRadius: '8px',
                border: '1px solid #ddd', fontSize: '14px',
              }}
            />
            <select value={userRoleFilter} onChange={(e) => { setUserRoleFilter(e.target.value); }}
              style={{ padding: '10px 14px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px' }}>
              <option value="">All Roles</option>
              <option value="family">Family</option>
              <option value="caregiver">Caregiver</option>
              <option value="care_for">Care Recipient</option>
            </select>
            <select value={userDemoFilter} onChange={(e) => { setUserDemoFilter(e.target.value); }}
              style={{ padding: '10px 14px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px' }}>
              <option value="">Demo & Real</option>
              <option value="false">Real Only</option>
              <option value="true">Demo Only</option>
            </select>
            <button onClick={loadUsers} style={{
              padding: '10px 20px', background: '#1b6b5a', color: 'white', border: 'none',
              borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
            }}>Search</button>
            <span style={{ fontSize: '13px', color: '#888' }}>{usersTotal} total</span>
          </div>

          {/* Users table */}
          <div className="card" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
                  <th style={{ padding: '10px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Name</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Email</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Role</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', color: '#666', fontWeight: 600 }}>Verified</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', color: '#666', fontWeight: 600 }}>Demo</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Joined</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', color: '#666', fontWeight: 600 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 500 }}>
                      {u.first_name} {u.last_name}
                      {u.is_admin ? <span style={{ marginLeft: '6px', fontSize: '10px', background: '#1b6b5a', color: 'white', padding: '2px 6px', borderRadius: '4px' }}>ADMIN</span> : ''}
                    </td>
                    <td style={{ padding: '10px 12px', color: '#555' }}>{u.email}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{
                        padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
                        background: u.role === 'family' ? '#e0f2e9' : u.role === 'caregiver' ? '#e3f2fd' : '#fff3e0',
                        color: u.role === 'family' ? '#1b6b5a' : u.role === 'caregiver' ? '#1565c0' : '#e65100',
                        textTransform: 'capitalize',
                      }}>{u.role === 'care_for' ? 'Care Recipient' : u.role}</span>
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      {u.email_verified ? '✅' : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      {u.is_demo ? '🎭' : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', color: '#888', fontSize: '12px' }}>
                      {formatDate(u.created_at)}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      {u.is_admin ? (
                        <span style={{ fontSize: '11px', color: '#999' }}>—</span>
                      ) : u.role === 'caregiver' ? (
                        <div style={{ display: 'flex', gap: '4px', justifyContent: 'center', flexWrap: 'wrap' }}>
                          <button onClick={() => openOnboardingModal(u.id)}
                            style={{ padding: '4px 10px', background: '#1b6b5a', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
                            Manage
                          </button>
                          <button onClick={() => handleForcePasswordReset(u.id, u.email)} disabled={resetPwLoading === u.id}
                            style={{ padding: '4px 8px', background: '#fff', color: '#d97706', border: '1px solid #e0e0e0', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', opacity: resetPwLoading === u.id ? 0.5 : 1 }}
                            title="Send password reset email">
                            {resetPwLoading === u.id ? '…' : resetPwMsg?.id === u.id ? (resetPwMsg.type === 'success' ? '✓' : '✕') : '🔑'}
                          </button>
                          {deleteConfirm === u.id ? (
                            <>
                              <button onClick={() => handleDeleteUser(u.id, u.email)} disabled={deleteLoading}
                                style={{ padding: '4px 10px', background: '#c62828', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>
                                {deleteLoading ? '...' : 'Confirm'}
                              </button>
                              <button onClick={() => setDeleteConfirm(null)}
                                style={{ padding: '4px 8px', background: '#f0f0f0', border: '1px solid #ddd', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}>
                                ✕
                              </button>
                            </>
                          ) : (
                            <button onClick={() => handleDeleteUser(u.id, u.email)}
                              style={{ padding: '4px 10px', background: '#fff', color: '#c62828', border: '1px solid #e0e0e0', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}>
                              Delete
                            </button>
                          )}
                        </div>
                      ) : deleteConfirm === u.id ? (
                        <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                          <button onClick={() => handleDeleteUser(u.id, u.email)} disabled={deleteLoading}
                            style={{ padding: '4px 10px', background: '#c62828', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>
                            {deleteLoading ? '...' : 'Confirm'}
                          </button>
                          <button onClick={() => setDeleteConfirm(null)}
                            style={{ padding: '4px 8px', background: '#f0f0f0', border: '1px solid #ddd', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}>
                            ✕
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                          <button onClick={() => handleForcePasswordReset(u.id, u.email)} disabled={resetPwLoading === u.id}
                            style={{ padding: '4px 8px', background: '#fff', color: '#d97706', border: '1px solid #e0e0e0', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', opacity: resetPwLoading === u.id ? 0.5 : 1 }}
                            title="Send password reset email">
                            {resetPwLoading === u.id ? '…' : resetPwMsg?.id === u.id ? (resetPwMsg.type === 'success' ? '✓' : '✕') : '🔑'}
                          </button>
                          <button onClick={() => handleDeleteUser(u.id, u.email)}
                            style={{ padding: '4px 10px', background: '#fff', color: '#c62828', border: '1px solid #e0e0e0', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}>
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {users.length === 0 && (
              <div style={{ padding: '24px', textAlign: 'center', color: '#999' }}>No users found</div>
            )}
          </div>
        </div>
      )}

      {/* ─── People Tab (Waitlist + Invites unified) ─── */}
      {activeTab === 'people' && (
        <div>
          {/* Sub-tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: '#f5f5f5', borderRadius: 8, padding: 3 }}>
            {[
              { id: 'all', label: `All (${waitlistTotal + invitesTotal})` },
              { id: 'waitlist', label: `Waitlist (${waitlistTotal})` },
              { id: 'invites', label: `Invites (${invitesTotal})` },
            ].map(st => (
              <button key={st.id} onClick={() => setPeopleSubTab(st.id)}
                style={{ flex: 1, padding: '8px 12px', borderRadius: 6, border: 'none', fontSize: 13, fontWeight: peopleSubTab === st.id ? 700 : 500,
                  background: peopleSubTab === st.id ? '#fff' : 'transparent', color: peopleSubTab === st.id ? '#1b6b5a' : '#888',
                  cursor: 'pointer', boxShadow: peopleSubTab === st.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', transition: 'all 0.15s' }}>
                {st.label}
              </button>
            ))}
          </div>

          {/* Export CSV */}
          {(peopleSubTab === 'all' || peopleSubTab === 'waitlist') && waitlist.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <button onClick={exportWaitlistCSV} style={{
                padding: '6px 16px', background: '#1b6b5a', color: 'white', border: 'none',
                borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '6px',
              }}>
                Export Waitlist CSV
              </button>
            </div>
          )}

          {/* Waitlist section */}
          {(peopleSubTab === 'all' || peopleSubTab === 'waitlist') && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-header"><span className="card-icon">📋</span>Waitlist ({waitlistTotal})</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
                      <th style={{ padding: '10px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Email</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Name</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Role</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Source</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Date</th>
                      <th style={{ padding: '10px 12px', textAlign: 'center', color: '#666', fontWeight: 600 }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {waitlist.map((w) => (
                      <tr key={w.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 500 }}>{w.email}</td>
                        <td style={{ padding: '10px 12px', color: '#555' }}>{w.name || '—'}</td>
                        <td style={{ padding: '10px 12px', textTransform: 'capitalize' }}>{w.role || 'family'}</td>
                        <td style={{ padding: '10px 12px', color: '#888' }}>{w.source || 'splash'}</td>
                        <td style={{ padding: '10px 12px', color: '#888', fontSize: '12px' }}>{formatDate(w.created_at)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <button onClick={() => { setInviteSearch(w.email); setPeopleSubTab('invites'); }} style={{
                            padding: '4px 12px', background: '#e8724a', color: 'white', border: 'none',
                            borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', marginRight: '6px',
                          }}>Invite</button>
                          <button onClick={async () => {
                            if (!confirm(`Remove ${w.email} from waitlist?`)) return;
                            const res = await apiFetch(`/api/waitlist/${w.id}`, { method: 'DELETE' });
                            if (res?.ok) { setWaitlist(prev => prev.filter(x => x.id !== w.id)); }
                          }} style={{
                            padding: '4px 10px', background: '#fff', color: '#dc3545', border: '1px solid #dc3545',
                            borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                          }}>Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {waitlist.length === 0 && (
                  <div style={{ padding: '24px', textAlign: 'center', color: '#999' }}>No waitlist entries yet</div>
                )}
              </div>
            </div>
          )}

          {/* Search & Send (invites section) */}
          {(peopleSubTab === 'all' || peopleSubTab === 'invites') && (<React.Fragment>
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
                  padding: '10px 20px', background: '#1b6b5a', color: 'white', border: 'none',
                  borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                  opacity: searchLoading ? 0.6 : 1,
                }}>
                  {searchLoading ? 'Searching...' : 'Search'}
                </button>
              </div>

              {/* Search Result */}
              {searchResult && (
                <div style={{ padding: '14px', background: '#f8f9fa', borderRadius: '8px', marginBottom: '12px' }}>
                  {searchResult.user && (
                    <div style={{ marginBottom: '8px' }}>
                      <span style={{ padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, background: '#e0f2e9', color: '#1b6b5a' }}>REGISTERED</span>
                      <span style={{ marginLeft: '10px', fontWeight: 500 }}>{searchResult.user.first_name} {searchResult.user.last_name}</span>
                      <span style={{ color: '#888', marginLeft: '8px', fontSize: '13px' }}>{searchResult.user.email}</span>
                      <span style={{ color: '#888', marginLeft: '8px', fontSize: '12px' }}>({searchResult.user.role}, joined {formatDate(searchResult.user.created_at)})</span>
                    </div>
                  )}
                  {searchResult.waitlist && (
                    <div style={{ marginBottom: '8px' }}>
                      <span style={{ padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, background: '#fff3e0', color: '#e65100' }}>WAITLIST</span>
                      <span style={{ marginLeft: '10px', fontWeight: 500 }}>{searchResult.waitlist.name || 'No name'}</span>
                      <span style={{ color: '#888', marginLeft: '8px', fontSize: '13px' }}>{searchResult.waitlist.email}</span>
                      <span style={{ color: '#888', marginLeft: '8px', fontSize: '12px' }}>(signed up {formatDate(searchResult.waitlist.created_at)})</span>
                    </div>
                  )}
                  {searchResult.invite && (
                    <div style={{ marginBottom: '8px' }}>
                      <span style={{ padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
                        background: searchResult.invite.status === 'accepted' ? '#e0f2e9' : searchResult.invite.status === 'pending' ? '#e3f2fd' : '#f5f5f5',
                        color: searchResult.invite.status === 'accepted' ? '#1b6b5a' : searchResult.invite.status === 'pending' ? '#1565c0' : '#888',
                      }}>INVITE: {searchResult.invite.status.toUpperCase()}</span>
                      <span style={{ color: '#888', marginLeft: '10px', fontSize: '13px' }}>
                        {searchResult.invite.role} — sent {formatDate(searchResult.invite.created_at)}
                      </span>
                    </div>
                  )}
                  {searchResult.careTeamInvites && searchResult.careTeamInvites.length > 0 && (
                    <div style={{ marginBottom: '8px' }}>
                      {searchResult.careTeamInvites.map((cti, idx) => (
                        <div key={idx} style={{ marginBottom: 4 }}>
                          <span style={{ padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
                            background: cti.status === 'accepted' ? '#e0f2e9' : cti.status === 'pending' ? '#fff3e0' : '#f5f5f5',
                            color: cti.status === 'accepted' ? '#1b6b5a' : cti.status === 'pending' ? '#e65100' : '#888',
                          }}>CARE TEAM INVITE: {cti.status.toUpperCase()}</span>
                          <span style={{ color: '#888', marginLeft: '10px', fontSize: '13px' }}>
                            {cti.care_team_name} — sent by {cti.inviter_first_name} {cti.inviter_last_name}, {formatDate(cti.created_at)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {!searchResult.user && !searchResult.waitlist && !searchResult.invite && (!searchResult.careTeamInvites || searchResult.careTeamInvites.length === 0) && (
                    <div style={{ color: '#999' }}>No records found for this email.</div>
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
                        padding: '8px 20px', background: '#e8724a', color: 'white', border: 'none',
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
                  background: inviteMsg.type === 'success' ? '#e0f2e9' : '#fde8e8',
                  color: inviteMsg.type === 'success' ? '#1b6b5a' : '#c0392b',
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
              <span style={{ fontSize: '13px', color: '#888', fontWeight: 400 }}>{invitesTotal} total</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Email</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Role</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Status</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Sent By</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Expires</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', color: '#666', fontWeight: 600 }}>Actions</th>
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
                            background: inv.role === 'caregiver' ? '#e3f2fd' : inv.role === 'family' ? '#e0f2e9' : '#fff3e0',
                            color: inv.role === 'caregiver' ? '#1565c0' : inv.role === 'family' ? '#1b6b5a' : '#e65100',
                          }}>{inv.role === 'care_for' ? 'Cared-For' : inv.role}</span>
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{
                            padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, textTransform: 'capitalize',
                            background: displayStatus === 'accepted' ? '#e0f2e9' : displayStatus === 'pending' ? '#e3f2fd' : displayStatus === 'cancelled' ? '#f5f5f5' : '#fff3e0',
                            color: displayStatus === 'accepted' ? '#1b6b5a' : displayStatus === 'pending' ? '#1565c0' : displayStatus === 'cancelled' ? '#888' : '#e65100',
                          }}>{displayStatus}</span>
                        </td>
                        <td style={{ padding: '10px 12px', color: '#555', fontSize: '12px' }}>
                          {inv.inviter_first_name} {inv.inviter_last_name}
                        </td>
                        <td style={{ padding: '10px 12px', color: '#888', fontSize: '12px' }}>{formatDate(inv.expires_at)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          {inv.status === 'pending' && !isExpired && (
                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                              <button onClick={() => handleResendInvite(inv.id)} style={{
                                padding: '4px 10px', background: '#f0f0f0', border: '1px solid #ddd',
                                borderRadius: '6px', fontSize: '11px', cursor: 'pointer',
                              }}>Resend</button>
                              <button onClick={() => handleCancelInvite(inv.id)} style={{
                                padding: '4px 10px', background: '#fff0f0', border: '1px solid #fdd',
                                borderRadius: '6px', fontSize: '11px', cursor: 'pointer', color: '#c00',
                              }}>Cancel</button>
                            </div>
                          )}
                          {(inv.status === 'accepted') && <span style={{ color: '#1b6b5a', fontSize: '12px' }}>Completed</span>}
                          {(isExpired || inv.status === 'cancelled') && (
                            <button onClick={() => { setInviteSearch(inv.invited_email); setPeopleSubTab('invites'); }} style={{
                              padding: '4px 10px', background: '#f0f0f0', border: '1px solid #ddd',
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
                <div style={{ padding: '24px', textAlign: 'center', color: '#999' }}>No invites sent yet</div>
              )}
            </div>
          </div>

          {/* Care Team Invites */}
          <div className="card" style={{ marginTop: '20px' }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span><span className="card-icon">👨‍👩‍👦</span>Care Team Invites</span>
              <span style={{ fontSize: '13px', color: '#888', fontWeight: 400 }}>{careTeamInvites.length} total</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Email</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Care Team</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Role</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Status</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Sent By</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {careTeamInvites.map((cti) => {
                    const isExpired = cti.status === 'pending' && cti.expires_at && (parseTimestamp(cti.expires_at) || new Date(0)) < new Date();
                    const displayStatus = isExpired ? 'expired' : cti.status;
                    return (
                      <tr key={cti.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 500 }}>{cti.invited_email}</td>
                        <td style={{ padding: '10px 12px', color: '#555' }}>{cti.team_name}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{
                            padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, textTransform: 'capitalize',
                            background: cti.role === 'caregiver' ? '#e3f2fd' : '#e0f2e9',
                            color: cti.role === 'caregiver' ? '#1565c0' : '#1b6b5a',
                          }}>{cti.role}</span>
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{
                            padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, textTransform: 'capitalize',
                            background: displayStatus === 'accepted' ? '#e0f2e9' : displayStatus === 'pending' ? '#e3f2fd' : '#fff3e0',
                            color: displayStatus === 'accepted' ? '#1b6b5a' : displayStatus === 'pending' ? '#1565c0' : '#e65100',
                          }}>{displayStatus}</span>
                        </td>
                        <td style={{ padding: '10px 12px', color: '#555', fontSize: '12px' }}>{cti.inviter_first_name} {cti.inviter_last_name}</td>
                        <td style={{ padding: '10px 12px', color: '#888', fontSize: '12px' }}>{formatDate(cti.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {careTeamInvites.length === 0 && (
                <div style={{ padding: '24px', textAlign: 'center', color: '#999' }}>No care team invites yet</div>
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
                      <span style={{ color: '#888', fontSize: '13px', marginLeft: '8px' }}>{u.email}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{
                        padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
                        background: u.role === 'family' ? '#e0f2e9' : u.role === 'caregiver' ? '#e3f2fd' : '#fff3e0',
                        color: u.role === 'family' ? '#1b6b5a' : u.role === 'caregiver' ? '#1565c0' : '#e65100',
                        textTransform: 'capitalize',
                      }}>{u.role}</span>
                      <span style={{ fontSize: '12px', color: '#999' }}>{formatDateTime(u.created_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : <div style={{ padding: '16px', color: '#999', textAlign: 'center' }}>No registrations yet</div>}
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
                      {w.name && <span style={{ color: '#888', fontSize: '13px', marginLeft: '8px' }}>({w.name})</span>}
                    </div>
                    <span style={{ fontSize: '12px', color: '#999' }}>{formatDateTime(w.created_at)}</span>
                  </div>
                ))}
              </div>
            ) : <div style={{ padding: '16px', color: '#999', textAlign: 'center' }}>No waitlist signups yet</div>}
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
                      <span style={{ color: '#888', fontSize: '13px', marginLeft: '8px' }}>({s.family_name})</span>
                      <span style={{ marginLeft: '8px', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 600, background: '#f0faf8', color: '#1b6b5a', textTransform: 'capitalize' }}>
                        {s.service_type?.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{
                        padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
                        background: s.status === 'completed' ? '#e0f2e9' : s.status === 'confirmed' ? '#e3f2fd' : '#fff3e0',
                        color: s.status === 'completed' ? '#1b6b5a' : s.status === 'confirmed' ? '#1565c0' : '#e65100',
                        textTransform: 'capitalize',
                      }}>{s.status}</span>
                      <span style={{ fontSize: '12px', color: '#999' }}>{s.scheduled_date}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : <div style={{ padding: '16px', color: '#999', textAlign: 'center' }}>No sessions yet</div>}
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
            <span style={{ fontSize: 12, color: '#888', marginLeft: 'auto' }}>{feedbackTotal} total</span>
          </div>

          {feedbackLoading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Loading feedback...</div>
          ) : feedbackItems.length === 0 ? (
            <div className="card" style={{ padding: 40, textAlign: 'center', color: '#999' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>💬</div>
              No feedback yet. The floating feedback button will appear for all users.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {feedbackItems.map(fb => {
                const isExpanded = expandedFeedback === fb.id;
                const categoryColors = { bug: '#c62828', feature: '#1565c0', general: '#555', complaint: '#e65100', praise: '#2e7d32' };
                const categoryLabels = { bug: 'Bug', feature: 'Feature', general: 'General', complaint: 'Complaint', praise: 'Praise' };
                const statusColors = { new: '#e8724a', reviewed: '#1565c0', planned: '#7b1fa2', done: '#2e7d32', dismissed: '#999' };
                const moodEmojis = { great: '😊', good: '🙂', okay: '😐', bad: '😟', terrible: '😡' };

                return (
                  <div key={fb.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    {/* Summary row */}
                    <div
                      onClick={() => { setExpandedFeedback(isExpanded ? null : fb.id); setFeedbackEditNotes(fb.adminNotes || ''); }}
                      style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, background: isExpanded ? '#f8f9fa' : '#fff' }}
                    >
                      {fb.mood && <span style={{ fontSize: 18 }}>{moodEmojis[fb.mood] || ''}</span>}
                      <span style={{
                        padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                        background: (categoryColors[fb.category] || '#555') + '18', color: categoryColors[fb.category] || '#555',
                      }}>{categoryLabels[fb.category] || fb.category}</span>
                      <span style={{ flex: 1, fontSize: 13, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {fb.description.substring(0, 80)}{fb.description.length > 80 ? '...' : ''}
                      </span>
                      <span style={{ fontSize: 11, color: '#999', whiteSpace: 'nowrap' }}>{fb.userName}</span>
                      <span style={{
                        padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                        background: (statusColors[fb.status] || '#999') + '18', color: statusColors[fb.status] || '#999',
                      }}>{fb.status}</span>
                      <span style={{ fontSize: 11, color: '#bbb', whiteSpace: 'nowrap' }}>
                        {(parseTimestamp(fb.createdAt) || new Date(0)).toLocaleDateString()}
                      </span>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div style={{ padding: '16px', borderTop: '1px solid #eee' }}>
                        <div style={{ fontSize: 14, color: '#333', lineHeight: 1.6, marginBottom: 12, whiteSpace: 'pre-wrap' }}>{fb.description}</div>

                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: '#888', marginBottom: 12 }}>
                          <span>From: <strong>{fb.userName}</strong> ({fb.userEmail || '—'})</span>
                          <span>Role: {fb.userRole || '—'}</span>
                          {fb.pageContext && <span>Page: {fb.pageContext.page}</span>}
                          {fb.pageContext?.device && <span>Device: {fb.pageContext.device}</span>}
                          <span>{(parseTimestamp(fb.createdAt) || new Date(0)).toLocaleString()}</span>
                        </div>

                        {/* Rich device context (collapsible) */}
                        {fb.pageContext && (fb.pageContext.browser || fb.pageContext.os) && (
                          <details style={{ marginBottom: 12, fontSize: 12, color: '#666' }}>
                            <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#555', marginBottom: 6 }}>Device &amp; Environment Details</summary>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '4px 16px', padding: '8px 12px', background: '#f8f9fa', borderRadius: 8 }}>
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
                                <strong style={{ color: '#c62828' }}>Console Errors ({fb.pageContext.recentErrors.length}):</strong>
                                {fb.pageContext.recentErrors.map((err, i) => (
                                  <div key={i} style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 11, color: '#c62828', wordBreak: 'break-all' }}>
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
                                padding: '4px 12px', borderRadius: 12, border: fb.status === s ? '2px solid ' + (statusColors[s] || '#999') : '1px solid #ddd',
                                background: fb.status === s ? (statusColors[s] || '#999') + '18' : '#fff',
                                color: fb.status === s ? statusColors[s] : '#666', fontSize: 11, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize',
                              }}
                            >{s}</button>
                          ))}
                        </div>

                        {/* Create FAQ from feedback */}
                        <button onClick={() => createFaqFromFeedback(fb)} style={{
                          padding: '6px 14px', background: '#e8f5f0', color: '#1b6b5a',
                          border: '1px solid #1b6b5a', borderRadius: '8px', cursor: 'pointer',
                          fontSize: '12px', fontWeight: 600, marginBottom: 12, display: 'inline-block',
                        }}>❓ Create FAQ from this</button>

                        {/* Admin notes */}
                        <div>
                          <label style={{ fontSize: 12, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>Admin Notes</label>
                          <textarea
                            value={feedbackEditNotes}
                            onChange={e => setFeedbackEditNotes(e.target.value)}
                            placeholder="Internal notes about this feedback..."
                            rows={2}
                            style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' }}
                          />
                          {feedbackEditNotes !== (fb.adminNotes || '') && (
                            <button onClick={() => updateFeedbackItem(fb.id, { adminNotes: feedbackEditNotes })}
                              style={{ marginTop: 6, padding: '4px 14px', borderRadius: 6, border: 'none', background: '#1b6b5a', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
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
                    const flowColors = { login: '#0369a1', registration: '#7c3aed', onboarding: '#1b6b5a', password_reset: '#d97706', demo: '#6b7280' };
                    const flowIcons = { login: '🔑', registration: '📝', onboarding: '🚦', password_reset: '🔄', demo: '🎭' };
                    const flowLabels = { login: 'Logins', registration: 'Registrations', onboarding: 'Caregiver Onboarding', password_reset: 'Password Resets', demo: 'Demo Logins' };
                    return (
                      <div key={f.flow} className="stat-card" style={{ borderLeft: `4px solid ${flowColors[f.flow] || '#999'}` }}>
                        <div style={{ fontSize: '20px', marginBottom: '4px' }}>{flowIcons[f.flow] || '📊'}</div>
                        <div className="stat-number">{f.total_events}</div>
                        <div className="stat-label">{flowLabels[f.flow] || f.flow}</div>
                        <div style={{ fontSize: '11px', color: '#999' }}>{f.unique_users} users, {f.error_count} errors (30d)</div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Per-flow event breakdown */}
              {obEvents.stats && obEvents.stats.length > 0 && (
                <div className="card" style={{ marginBottom: '16px' }}>
                  <h3 style={{ fontSize: '15px', margin: '0 0 12px', color: '#1b6b5a' }}>Event Breakdown by Flow (30 days)</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {obEvents.stats.map((s, i) => {
                      const flowColors = { login: '#0369a1', registration: '#7c3aed', onboarding: '#1b6b5a', password_reset: '#d97706', demo: '#6b7280' };
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px', fontSize: '12px' }}>
                          <span style={{
                            padding: '1px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: 600,
                            background: (flowColors[s.flow] || '#999') + '18', color: flowColors[s.flow] || '#999',
                            minWidth: '80px', textAlign: 'center',
                          }}>{s.flow}</span>
                          <span style={{
                            padding: '1px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: 600,
                            background: s.event_type === 'error' ? '#fef2f2' : s.event_type.includes('success') || s.event_type.includes('complete') ? '#ecfdf5' : '#f0f9ff',
                            color: s.event_type === 'error' ? '#dc2626' : s.event_type.includes('success') || s.event_type.includes('complete') ? '#059669' : '#0369a1',
                          }}>{s.event_type}</span>
                          <span style={{ fontWeight: 600, color: '#333' }}>{s.count}</span>
                          <span style={{ color: '#999' }}>({s.unique_users} users)</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Onboarding Funnel */}
              {obEvents.funnel && obEvents.funnel.length > 0 && (
                <div className="card" style={{ marginBottom: '16px' }}>
                  <h3 style={{ fontSize: '15px', margin: '0 0 12px', color: '#1b6b5a' }}>Caregiver Onboarding Funnel (30 days)</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {obEvents.funnel.map(f => {
                      const maxCount = Math.max(...obEvents.funnel.map(x => x.completions));
                      const pct = maxCount > 0 ? (f.completions / maxCount * 100) : 0;
                      return (
                        <div key={f.step} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{ width: '140px', fontSize: '12px', color: '#555', flexShrink: 0 }}>
                            Step {f.step}: {f.step_name}
                          </div>
                          <div style={{ flex: 1, background: '#f0f0f0', borderRadius: '4px', height: '22px', position: 'relative' }}>
                            <div style={{
                              width: pct + '%', height: '100%', borderRadius: '4px',
                              background: f.step === 9 ? '#22c55e' : '#1b6b5a',
                              transition: 'width 0.3s',
                            }} />
                            <span style={{ position: 'absolute', left: '8px', top: '3px', fontSize: '11px', fontWeight: 600, color: pct > 30 ? '#fff' : '#333' }}>
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
                <h3 style={{ fontSize: '15px', margin: '0 0 12px', color: '#dc2626' }}>Recent Errors (All Flows)</h3>
                {(!obEvents.recentErrors || obEvents.recentErrors.length === 0) ? (
                  <p style={{ color: '#888', fontSize: '13px', margin: 0 }}>No errors recorded yet.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {obEvents.recentErrors.map(e => {
                      const meta = e.metadata ? JSON.parse(e.metadata) : {};
                      const flowColors = { login: '#0369a1', registration: '#7c3aed', onboarding: '#1b6b5a', password_reset: '#d97706', demo: '#6b7280' };
                      const eFlow = e.flow || 'onboarding';
                      return (
                        <div key={e.id} style={{
                          padding: '10px 12px', background: '#fef2f2', borderRadius: '8px',
                          border: '1px solid #fecaca', fontSize: '13px', borderLeft: `4px solid ${flowColors[eFlow] || '#dc2626'}`,
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                            <span style={{ fontWeight: 600, color: '#dc2626' }}>
                              <span style={{ padding: '1px 6px', borderRadius: '8px', fontSize: '10px', background: (flowColors[eFlow] || '#999') + '18', color: flowColors[eFlow] || '#999', marginRight: '6px' }}>{eFlow}</span>
                              {e.step ? `Step ${e.step}: ${e.step_name}` : e.error_source || 'Error'}
                            </span>
                            <span style={{ color: '#888', fontSize: '11px' }}>
                              {(parseTimestamp(e.created_at) || new Date(0)).toLocaleString()}
                            </span>
                          </div>
                          <div style={{ color: '#b91c1c' }}>{e.error_message}</div>
                          <div style={{ display: 'flex', gap: '12px', marginTop: '4px', fontSize: '11px', color: '#888', flexWrap: 'wrap' }}>
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
                  <h3 style={{ fontSize: '15px', margin: 0, color: '#333' }}>All Events (recent)</h3>
                  <button onClick={loadOnboardingEvents} style={{
                    padding: '6px 12px', background: '#1b6b5a', color: '#fff', border: 'none',
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
                        const flowColors = { login: '#0369a1', registration: '#7c3aed', onboarding: '#1b6b5a', password_reset: '#d97706', demo: '#6b7280' };
                        const eFlow = e.flow || 'onboarding';
                        return (
                        <tr key={e.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={{ padding: '6px 8px', whiteSpace: 'nowrap', color: '#888' }}>
                            {(parseTimestamp(e.created_at) || new Date(0)).toLocaleString()}
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <span style={{
                              padding: '2px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: 600,
                              background: (flowColors[eFlow] || '#999') + '18', color: flowColors[eFlow] || '#999',
                            }}>{eFlow}</span>
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <span style={{
                              padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 600,
                              background: e.event_type === 'error' ? '#fef2f2' : e.event_type.includes('success') || e.event_type.includes('complete') ? '#ecfdf5' : '#f0f9ff',
                              color: e.event_type === 'error' ? '#dc2626' : e.event_type.includes('success') || e.event_type.includes('complete') ? '#059669' : '#0369a1',
                            }}>{e.event_type}</span>
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            {e.step ? `${e.step}. ${e.step_name || ''}` : '—'}
                          </td>
                          <td style={{ padding: '6px 8px', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {e.email || e.user_id || '—'}
                          </td>
                          <td style={{ padding: '6px 8px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', color: '#666' }}>
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

      {/* ─── Financials Tab ─── */}
      {activeTab === 'financials' && <AdminFinancials />}

      {/* ─── Help/FAQ Management Tab ─── */}
      {activeTab === 'help' && (
        <div>
          {/* Header with Add button */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, color: '#1b6b5a' }}>Help Articles ({helpArticles.length})</h3>
            <button onClick={() => openHelpEditor()} style={{
              padding: '8px 16px', background: '#1b6b5a', color: 'white', border: 'none',
              borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
            }}>+ New Article</button>
          </div>

          {helpLoading && <div style={{ textAlign: 'center', padding: '20px', color: '#999' }}>Loading...</div>}

          {/* Articles table */}
          {!helpLoading && helpArticles.map(article => (
            <div key={article.id} className="card" style={{
              marginBottom: '8px', opacity: article.is_published ? 1 : 0.5,
              border: article.is_published ? '1px solid #e5e5e5' : '1px solid #ffa500',
            }}>
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', color: '#999', marginBottom: '4px' }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', background: '#f0f0f0',
                      borderRadius: '4px', fontSize: '11px', fontWeight: 600, marginRight: '8px'
                    }}>{article.category}</span>
                    {!article.is_published && <span style={{ color: '#e8724a', fontWeight: 600 }}>DRAFT</span>}
                    {article.link_page && <span style={{ color: '#1b6b5a', marginLeft: '8px' }}>→ {article.link_page}</span>}
                  </div>
                  <div style={{ fontWeight: 500, fontSize: '14px', marginBottom: '4px' }}>{article.question}</div>
                  <div style={{ fontSize: '12px', color: '#888', maxHeight: '40px', overflow: 'hidden' }}>
                    {article.answer?.slice(0, 120)}{article.answer?.length > 120 ? '...' : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                  <button onClick={() => openHelpEditor(article)} style={{
                    padding: '6px 12px', background: '#f0f0f0', border: 'none',
                    borderRadius: '6px', cursor: 'pointer', fontSize: '12px'
                  }}>Edit</button>
                  <button onClick={() => toggleHelpPublished(article)} style={{
                    padding: '6px 12px', background: article.is_published ? '#fff3cd' : '#d4edda',
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
                background: 'white', borderRadius: '16px', padding: '24px',
                maxWidth: '600px', width: '100%', maxHeight: '80vh', overflow: 'auto',
              }}>
                <h3 style={{ margin: '0 0 16px', color: '#1b6b5a' }}>
                  {helpEditModal.id ? 'Edit Article' : 'New Help Article'}
                </h3>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#666', marginBottom: '4px' }}>Category</label>
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
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#666', marginBottom: '4px' }}>Question</label>
                  <input type="text" value={helpForm.question} onChange={e => setHelpForm({...helpForm, question: e.target.value})}
                    placeholder="How do I...?" style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} />
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#666', marginBottom: '4px' }}>Answer</label>
                  <textarea value={helpForm.answer} onChange={e => setHelpForm({...helpForm, answer: e.target.value})}
                    placeholder="Use **bold** for emphasis. Each line becomes a paragraph."
                    rows={6} style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', resize: 'vertical' }} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#666', marginBottom: '4px' }}>Link to page (optional)</label>
                    <input type="text" value={helpForm.link_page} onChange={e => setHelpForm({...helpForm, link_page: e.target.value})}
                      placeholder="e.g. schedule, caregivers" style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#666', marginBottom: '4px' }}>Link label</label>
                    <input type="text" value={helpForm.link_label} onChange={e => setHelpForm({...helpForm, link_label: e.target.value})}
                      placeholder="e.g. Go to Schedule" style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} />
                  </div>
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#666', marginBottom: '4px' }}>Sort order</label>
                  <input type="number" value={helpForm.sort_order} onChange={e => setHelpForm({...helpForm, sort_order: parseInt(e.target.value) || 0})}
                    style={{ width: '80px', padding: '8px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px' }} />
                </div>

                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button onClick={() => setHelpEditModal(null)} style={{
                    padding: '8px 20px', background: '#f0f0f0', border: 'none',
                    borderRadius: '8px', cursor: 'pointer', fontSize: '14px',
                  }}>Cancel</button>
                  <button onClick={saveHelpArticle} style={{
                    padding: '8px 20px', background: '#1b6b5a', color: 'white', border: 'none',
                    borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: 600,
                  }}>{helpEditModal.id ? 'Save Changes' : 'Create Article'}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Blocked Emails Tab ─── */}
      {activeTab === 'blocked' && (
        <div>
          {/* Add blocked email form */}
          <div className="card" style={{ marginBottom: '16px' }}>
            <div className="card-header"><span className="card-icon">🚫</span>Block an Email</div>
            <p style={{ fontSize: '13px', color: '#666', margin: '0 0 12px' }}>
              Blocked emails cannot register or create accounts. They'll see a generic error message.
            </p>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 220px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#555', marginBottom: '4px' }}>Email</label>
                <input type="email" placeholder="user@example.com" value={blockEmailInput}
                  onChange={(e) => setBlockEmailInput(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px', boxSizing: 'border-box' }} />
              </div>
              <div style={{ flex: '1 1 180px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#555', marginBottom: '4px' }}>Reason (optional)</label>
                <input type="text" placeholder="e.g. Spam, abuse" value={blockReasonInput}
                  onChange={(e) => setBlockReasonInput(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px', boxSizing: 'border-box' }} />
              </div>
              <button onClick={handleBlockEmail} disabled={blockLoading || !blockEmailInput.trim()}
                style={{
                  padding: '10px 20px', background: blockLoading || !blockEmailInput.trim() ? '#ccc' : '#c62828',
                  color: '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600,
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
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Email</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Reason</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Blocked By</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Date</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', color: '#666', fontWeight: 600 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {blockedEmails.map(b => (
                    <tr key={b.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 500 }}>{b.email}</td>
                      <td style={{ padding: '10px 12px', color: '#666' }}>{b.reason || '—'}</td>
                      <td style={{ padding: '10px 12px', color: '#666' }}>{b.blocked_by_name || '—'}</td>
                      <td style={{ padding: '10px 12px', color: '#888', fontSize: '12px' }}>{formatDate(b.created_at)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <button onClick={() => handleUnblockEmail(b.id)}
                          style={{ padding: '4px 12px', background: '#e8f5e9', color: '#2e7d32', border: '1px solid #c8e6c9', borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
                          Unblock
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: '24px', textAlign: 'center', color: '#999' }}>No blocked emails</div>
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
              <p style={{ fontSize: 13, color: '#888', margin: '0 0 16px' }}>
                Choose how you're notified for each event type. Push sends to your phone; email goes to {user?.email || 'your email'}.
              </p>

              {notifCategories.map(cat => (
                <div key={cat.category} style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#1b6b5a', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px', paddingBottom: '4px', borderBottom: '2px solid #e8f5e9' }}>
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
                        background: '#fafafa', gap: '8px', flexWrap: 'wrap',
                      }}>
                        <span style={{ fontSize: '13px', color: '#333', flex: 1, minWidth: '140px' }}>{label}</span>
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontSize: '12px' }}>
                            <input type="checkbox" checked={pushOn} onChange={(e) => togglePref(pushKey, e.target.checked)}
                              style={{ accentColor: '#1b6b5a' }} />
                            <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                              <span style={{ fontSize: '14px' }}>🔔</span> Push
                            </span>
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontSize: '12px' }}>
                            <input type="checkbox" checked={emailOn} onChange={(e) => togglePref(emailKey, e.target.checked)}
                              style={{ accentColor: '#e8724a' }} />
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

              <div style={{ marginTop: '12px', padding: '10px', background: '#fff8e1', borderRadius: '8px', fontSize: '12px', color: '#795548' }}>
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
            <div style={{ fontSize: '13px', color: '#888', marginBottom: '16px' }}>{onboardingModal.user?.email}</div>

            {onboardingModal.flags ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {[
                  { key: 'backgroundCheckCleared', label: 'Background Check Cleared', desc: 'Checkr returned OK (or admin override)' },
                  { key: 'backgroundCheckPaid', label: 'Background Check Paid', desc: 'Paid $30 Stripe fee for background check' },
                  { key: 'onboardingComplete', label: 'Onboarding Complete', desc: 'All registration steps finished' },
                  { key: 'isAvailable', label: 'Available for Jobs', desc: 'Can see and accept care requests' },
                ].map(flag => (
                  <div key={flag.key} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '12px', background: onboardingModal.flags[flag.key] ? '#e8f5e9' : '#fce4ec',
                    borderRadius: '8px', border: `1px solid ${onboardingModal.flags[flag.key] ? '#a5d6a7' : '#ef9a9a'}`,
                  }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '14px', color: '#333' }}>
                        {onboardingModal.flags[flag.key] ? '✅' : '❌'} {flag.label}
                      </div>
                      <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>{flag.desc}</div>
                    </div>
                    <button onClick={() => toggleOnboardingFlag(flag.key, onboardingModal.flags[flag.key])}
                      style={{
                        padding: '6px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
                        border: 'none', cursor: 'pointer',
                        background: onboardingModal.flags[flag.key] ? '#ef5350' : '#1b6b5a',
                        color: '#fff',
                      }}>
                      {onboardingModal.flags[flag.key] ? 'Revoke' : 'Grant'}
                    </button>
                  </div>
                ))}

                {/* Extra info */}
                <div style={{ marginTop: '8px', padding: '12px', background: '#f8f9fa', borderRadius: '8px', fontSize: '13px' }}>
                  <div style={{ fontWeight: 600, marginBottom: '6px', color: '#555' }}>Additional Info</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
                    <span style={{ color: '#888' }}>BG Check Consent:</span>
                    <span>{onboardingModal.flags.backgroundCheckConsent ? 'Yes' : 'No'}</span>
                    <span style={{ color: '#888' }}>Has Photo:</span>
                    <span>{onboardingModal.flags.hasPhoto ? 'Yes' : 'No'}</span>
                    <span style={{ color: '#888' }}>Drivers License:</span>
                    <span>{onboardingModal.flags.hasDriversLicense ? 'Yes' : 'No'}</span>
                    <span style={{ color: '#888' }}>Program Reports:</span>
                    <span>{onboardingModal.flags.needsHourReports ? 'Yes' : 'No'}</span>
                    {onboardingModal.flags.academicProgram && <>
                      <span style={{ color: '#888' }}>Program:</span>
                      <span>{onboardingModal.flags.academicProgram}</span>
                      <span style={{ color: '#888' }}>Program Year:</span>
                      <span>{onboardingModal.flags.academicProgramYear || '—'}</span>
                    </>}
                  </div>
                  {onboardingModal.documents?.length > 0 && (
                    <div style={{ marginTop: '8px' }}>
                      <span style={{ color: '#888' }}>Uploaded docs:</span> {onboardingModal.documents.map(d => d.doc_type).join(', ')}
                    </div>
                  )}
                </div>

                <div style={{ marginTop: '8px', padding: '10px', background: '#fff8e1', borderRadius: '8px', fontSize: '12px', color: '#795548' }}>
                  Use "Grant" to override any pending step. For example, if Checkr isn't set up yet, you can manually clear the background check and mark them available for jobs.
                </div>
              </div>
            ) : (
              <div style={{ padding: '20px', textAlign: 'center', color: '#999' }}>
                No caregiver profile found for this user.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
