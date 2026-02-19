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

  useEffect(() => {
    loadStats();
  }, []);

  useEffect(() => {
    if (activeTab === 'users') loadUsers();
    if (activeTab === 'waitlist') loadWaitlist();
    if (activeTab === 'activity') loadActivity();
  }, [activeTab]);

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
    { id: 'activity', label: 'Activity', icon: '⚡' },
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
    </div>
  );
};
