// ─── Admin / Superuser Dashboard ───
// Only visible to users with is_admin = 1. Layered on top of normal family account.
const AdminPanel = window.AdminPanel = () => {
  const [activeTab, setActiveTab] = useState('overview');
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('');
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
  // Feedback tab state
  const [feedbackItems, setFeedbackItems] = useState([]);
  const [feedbackTotal, setFeedbackTotal] = useState(0);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackFilter, setFeedbackFilter] = useState({ category: '', status: '' });
  const [expandedFeedback, setExpandedFeedback] = useState(null);
  const [feedbackEditNotes, setFeedbackEditNotes] = useState('');

  useEffect(() => {
    loadStats();
    // Fetch current user for settings tab
    apiFetch('/api/auth/me').then(r => r.json()).then(data => setUser(data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (activeTab === 'users') loadUsers();
    if (activeTab === 'waitlist') loadWaitlist();
    if (activeTab === 'activity') loadActivity();
    if (activeTab === 'invites') loadInvites();
    if (activeTab === 'feedback') loadFeedback();
  }, [activeTab]);

  // Auto-trigger search when switching to invites tab with pre-filled email (e.g. from waitlist Invite button)
  useEffect(() => {
    if (activeTab === 'invites' && inviteSearch.trim() && !searchResult && !searchLoading) {
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
      w.created_at ? new Date(w.created_at).toLocaleDateString() : '',
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
    { id: 'waitlist', label: 'Waitlist', icon: '📋' },
    { id: 'invites', label: 'Invites', icon: '✉️' },
    { id: 'activity', label: 'Activity', icon: '⚡' },
    { id: 'feedback', label: 'Feedback', icon: '💬' },
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

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', borderBottom: '2px solid #e0e0e0', paddingBottom: '0' }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: '13px', fontWeight: activeTab === tab.id ? 700 : 400,
            color: activeTab === tab.id ? '#1b6b5a' : '#888',
            borderBottom: activeTab === tab.id ? '3px solid #1b6b5a' : '3px solid transparent',
            marginBottom: '-2px', transition: 'all 0.15s',
          }}>
            {tab.icon} {tab.label}
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
              <div style={{ fontSize: 24 }}>👩‍⚕️</div>
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
                          {new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
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
                          {new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
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

      {/* ─── Waitlist Tab ─── */}
      {activeTab === 'waitlist' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <span style={{ fontSize: '14px', color: '#666' }}>
              <strong>{waitlistTotal}</strong> people on the waitlist
            </span>
            <button onClick={exportWaitlistCSV} disabled={!waitlist.length} style={{
              padding: '8px 20px', background: '#1b6b5a', color: 'white', border: 'none',
              borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '6px',
              opacity: waitlist.length ? 1 : 0.5,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export CSV
            </button>
          </div>

          <div className="card" style={{ overflowX: 'auto' }}>
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
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      <button onClick={() => { setInviteSearch(w.email); setActiveTab('invites'); }} style={{
                        padding: '4px 12px', background: '#e8724a', color: 'white', border: 'none',
                        borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                      }}>Invite</button>
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

      {/* ─── Invites Tab ─── */}
      {activeTab === 'invites' && (
        <div>
          {/* Search & Send */}
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
                  {!searchResult.user && !searchResult.waitlist && !searchResult.invite && (
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
                    const isExpired = inv.status === 'pending' && new Date(inv.expires_at) < new Date();
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
                            <button onClick={() => { setInviteSearch(inv.invited_email); setActiveTab('invites'); }} style={{
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
                        {new Date(fb.createdAt).toLocaleDateString()}
                      </span>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div style={{ padding: '16px', borderTop: '1px solid #eee' }}>
                        <div style={{ fontSize: 14, color: '#333', lineHeight: 1.6, marginBottom: 12, whiteSpace: 'pre-wrap' }}>{fb.description}</div>

                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: '#888', marginBottom: 12 }}>
                          <span>From: <strong>{fb.userName}</strong> ({fb.userEmail})</span>
                          <span>Role: {fb.userRole}</span>
                          {fb.pageContext && <span>Page: {fb.pageContext.page}</span>}
                          {fb.pageContext?.device && <span>Device: {fb.pageContext.device}</span>}
                          <span>{new Date(fb.createdAt).toLocaleString()}</span>
                        </div>

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

      {/* ─── Settings Tab ─── */}
      {activeTab === 'settings' && (
        <div>
          <div className="card">
            <div className="card-header">Admin Push Notifications</div>
            <p style={{ padding: '0 16px', fontSize: 13, color: '#888', margin: '0 0 8px' }}>
              Receive push notifications on your phone for admin events.
            </p>
            {[
              { key: 'push_waitlist_signup', label: 'New waitlist signups' },
              { key: 'push_new_registration', label: 'New user registrations' },
            ].map(({ key, label }) => {
              const prefs = user?.notification_prefs ? (typeof user.notification_prefs === 'string' ? JSON.parse(user.notification_prefs) : user.notification_prefs) : {};
              const checked = prefs[key] !== false;
              return (
                <label key={key} className="toggle-label" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px' }}>
                  <input type="checkbox" checked={checked} onChange={async (e) => {
                    const newPrefs = { ...prefs, [key]: e.target.checked };
                    try {
                      await apiFetch('/api/auth/me', { method: 'PUT', body: JSON.stringify({ notificationPrefs: newPrefs }) });
                      setUser(prev => ({ ...prev, notification_prefs: JSON.stringify(newPrefs) }));
                    } catch {}
                  }} />
                  <span style={{ fontSize: 14 }}>{label}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
