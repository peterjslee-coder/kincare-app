// ─── CaredForView — Full-featured dashboard for care_for users ───
// Same power as family dashboard: upcoming sessions, care team, activity, calendar, notes
const CaredForView = window.CaredForView = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState([]);
  const [activeTab, setActiveTab] = useState('home');
  const [newNote, setNewNote] = useState('');
  const [editingNote, setEditingNote] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(null);
  const [expandedCaregiverCard, setExpandedCaregiverCard] = useState(null);

  const today = new Date();
  const viewYear = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1).getFullYear();
  const viewMonth = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1).getMonth();
  const monthName = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const getDaysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
  const getFirstDayOfWeek = (y, m) => new Date(y, m, 1).getDay();

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfWeek(viewYear, viewMonth);
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

  const calendarCells = [];
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - firstDay + 1;
    calendarCells.push(dayNum >= 1 && dayNum <= daysInMonth ? dayNum : null);
  }

  const fetchData = async () => {
    try {
      const res = await apiFetch('/api/dashboard');
      if (res?.ok) {
        const d = await res.json();
        setData(d);
      }
    } catch (err) {
      console.error('CaredForView fetch error:', err);
    }
    setLoading(false);
  };

  const fetchSessions = async () => {
    try {
      const from = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-01`;
      const lastDay = getDaysInMonth(viewYear, viewMonth);
      const to = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      const res = await apiFetch(`/api/sessions?from=${from}&to=${to}&limit=200`);
      if (res?.ok) {
        const d = await res.json();
        setSessions(d.sessions || []);
      }
    } catch (err) {
      console.error('CaredForView sessions fetch error:', err);
    }
  };

  useEffect(() => { fetchData(); }, []);
  useEffect(() => { fetchSessions(); }, [monthOffset]);

  // Refresh when RequestCareModal creates a new session
  useEffect(() => {
    const handler = () => { fetchSessions(); fetchData(); };
    window.addEventListener('sessions-updated', handler);
    return () => window.removeEventListener('sessions-updated', handler);
  }, []);

  // Group sessions by date for calendar
  const sessionsByDate = {};
  sessions.forEach(s => {
    const d = s.scheduled_date || s.date;
    if (!d) return;
    const dateKey = d.substring(0, 10);
    if (!sessionsByDate[dateKey]) sessionsByDate[dateKey] = [];
    sessionsByDate[dateKey].push(s);
  });

  const getDateStr = (day) => `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const isToday = (day) => day && viewYear === today.getFullYear() && viewMonth === today.getMonth() && day === today.getDate();
  const getDaySessions = (day) => day ? (sessionsByDate[getDateStr(day)] || []) : [];
  const getDayCounts = (day) => {
    const ds = getDaySessions(day);
    let requested = 0, confirmed = 0;
    ds.forEach(s => {
      if (['requested', 'open'].includes(s.status)) requested++;
      else if (['confirmed', 'in_progress', 'completed'].includes(s.status)) confirmed++;
    });
    return { requested, confirmed };
  };

  const formatTime12 = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const dh = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${dh}:${String(m || 0).padStart(2, '0')} ${ampm}`;
  };

  const serviceLabel = (type) => {
    const labels = {
      meals: 'Meals & Groceries', rides: 'Rides & Errands', companion: 'Companionship',
      companionship: 'Companionship', personal_care: 'Personal Care', housekeeping: 'Light Housekeeping',
      meal_prep: 'Meal Prep', transportation: 'Transportation', health_wellness: 'Health & Wellness',
      full_day: 'Full Day Care', medication: 'Medication Reminder', light_housekeeping: 'Light Housekeeping',
      errands: 'Errands',
    };
    return labels[type] || (type || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };

  const timeAgo = (dateStr) => {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const friendlyDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T12:00:00');
    const t = new Date(); t.setHours(12,0,0,0);
    const diff = Math.round((d - t) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff > 1 && diff < 7) return d.toLocaleDateString('en-US', { weekday: 'long' });
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  // Notes handlers
  const handleAddNote = async () => {
    if (!newNote.trim() || !data?.careRecipientId) return;
    setSaving(true);
    try {
      const notePayload = { careRecipientId: data.careRecipientId, content: newNote, noteType: 'personal' };
      const res = await apiFetch('/api/notes', { method: 'POST', body: JSON.stringify(notePayload) });
      if (res?.ok) { setNewNote(''); await fetchData(); }
      else if ((res?.status === 503 || !navigator.onLine) && window.OfflineQueue) {
        await window.OfflineQueue.queueNote(notePayload); setNewNote('');
      }
    } catch (err) {
      if (!navigator.onLine && window.OfflineQueue) {
        try { await window.OfflineQueue.queueNote({ careRecipientId: data.careRecipientId, content: newNote, noteType: 'personal' }); setNewNote(''); } catch {}
      }
    }
    setSaving(false);
  };

  const handleEditNote = async (noteId) => {
    if (!editContent.trim()) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/notes/${noteId}`, { method: 'PUT', body: JSON.stringify({ content: editContent }) });
      if (res?.ok) { setEditingNote(null); setEditContent(''); await fetchData(); }
    } catch (err) { console.error('Edit note error:', err); }
    setSaving(false);
  };

  const handleDeleteNote = async (noteId) => {
    try {
      const res = await apiFetch(`/api/notes/${noteId}`, { method: 'DELETE' });
      if (res?.ok) await fetchData();
    } catch (err) { console.error('Delete note error:', err); }
  };

  if (loading) return <LoadingSpinner text="Loading your dashboard..." />;
  if (!data) return <EmptyState icon="\u26A0\uFE0F" title="Couldn't load your dashboard" text="Please try refreshing." />;

  const notes = data.notes || [];
  const userName = (data.userName || 'Guest').split(' ')[0]; // First name only
  const careProfile = data.careProfile || null;
  const permissionTier = data.permissionTier || 'full';
  const managedByName = data.managedByName || null;
  const managedReason = data.managedReason || null;
  const visSettings = data.visibilitySettings || null;
  const upcomingSessions = data.upcomingSessions || [];
  const recentActivity = data.recentActivity || [];
  const assignedCaregivers = data.assignedCaregivers || [];
  const stats = data.stats || {};
  const recentCompleted = data.recentCompleted || [];

  const canSee = (section) => {
    if (permissionTier === 'full') return true;
    if (!visSettings) return true;
    return !!visSettings[section];
  };
  const canEdit = permissionTier === 'full';
  const canRequest = permissionTier === 'full' || permissionTier === 'collaborative';
  const canAddNotes = permissionTier === 'full' || permissionTier === 'collaborative';

  const selectedDaySessions = selectedDay ? getDaySessions(selectedDay) : [];
  const selectedDateLabel = selectedDay
    ? new Date(viewYear, viewMonth, selectedDay).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    : '';

  const noteTypeColors = {
    personal: { bg: 'var(--color-info-bg)', color: 'var(--color-info)', label: 'Personal' },
    health: { bg: 'var(--color-error-bg)', color: 'var(--color-error)', label: 'Health' },
    general: { bg: 'var(--color-purple-bg)', color: 'var(--color-purple)', label: 'General' },
    family: { bg: 'var(--color-success-bg)', color: 'var(--color-success)', label: 'Family' },
  };

  // ─── Render helpers ───

  const renderSessionCard = (s, compact) => {
    const statusColors = {
      requested: { bg: '#fff3e0', border: '#ffb74d', label: 'Looking for Caregiver', color: '#e65100' },
      open: { bg: '#fff3e0', border: '#ffb74d', label: 'Open', color: '#e65100' },
      confirmed: { bg: '#e8f5e9', border: '#66bb6a', label: 'Confirmed', color: '#2e7d32' },
      in_progress: { bg: '#e3f2fd', border: '#42a5f5', label: 'In Progress', color: '#1565c0' },
      pending: { bg: '#f3e5f5', border: '#ab47bc', label: 'Pending', color: '#7b1fa2' },
    };
    const sc = statusColors[s.status] || statusColors.pending;

    return (
      <div key={s.id} className="card" style={{ marginBottom: 10, borderLeft: `4px solid ${sc.border}`, padding: compact ? '12px 14px' : '14px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                {friendlyDate(s.date)}
              </span>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {formatTime12(s.time)}
              </span>
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
              {serviceLabel(s.serviceType)} · {s.durationHours || 2}h
            </div>
            {s.caregiverName && (
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                with {s.caregiverName}
                {s.caregiverRating ? ` \u2B50 ${Number(s.caregiverRating).toFixed(1)}` : ''}
              </div>
            )}
            {!s.caregiverName && s.status === 'requested' && (
              <div style={{ fontSize: 12, color: '#e65100', fontStyle: 'italic' }}>Matching you with a caregiver...</div>
            )}
          </div>
          <span style={{
            padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
            background: sc.bg, color: sc.color, whiteSpace: 'nowrap',
          }}>
            {sc.label}
          </span>
        </div>
        {s.specialInstructions && (
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', fontStyle: 'italic', marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border-color)' }}>
            {s.specialInstructions}
          </div>
        )}
      </div>
    );
  };

  // ─── TABS ───
  const tabs = [
    { id: 'home', label: 'Home', icon: '\uD83C\uDFE0' },
    { id: 'calendar', label: 'Calendar', icon: '\uD83D\uDCC5' },
    { id: 'team', label: 'My Care Team', icon: '\uD83E\uDDD1\u200D\u2695\uFE0F' },
    { id: 'profile', label: 'My Info', icon: '\uD83D\uDC8A' },
    ...(canSee('notes') ? [{ id: 'notes', label: 'Notes', icon: '\uD83D\uDCDD' }] : []),
  ];

  return (
    <div>
      {typeof NotificationPrompt !== 'undefined' && React.createElement(NotificationPrompt, null)}

      {/* Greeting */}
      <h1 className="greeting" style={{ marginBottom: '4px' }}>Hello, {userName}!</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: permissionTier !== 'full' ? '12px' : '16px' }}>
        {activeTab === 'home' ? "Here's your care at a glance" : ''}
        {activeTab === 'calendar' ? 'Your care calendar' : ''}
        {activeTab === 'team' ? 'Your care team' : ''}
        {activeTab === 'profile' ? 'Your care information' : ''}
        {activeTab === 'notes' ? 'Your personal notes' : ''}
      </p>

      {/* Managed / Collaborative mode banner */}
      {permissionTier === 'managed' && (
        <div style={{
          padding: '12px 16px', marginBottom: '16px', borderRadius: '10px',
          background: 'var(--color-warning-bg)', border: '1px solid #ffe082',
          display: 'flex', alignItems: 'center', gap: '10px',
        }}>
          <span style={{ fontSize: '20px' }}>\uD83D\uDD12</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--color-warning)' }}>Managed Account</div>
            <div style={{ fontSize: '12px', color: 'var(--text-brown)', marginTop: '2px' }}>
              Your care is being managed by {managedByName || 'your care team'}.
              {managedReason ? ` (${managedReason})` : ''} Contact them to request changes.
            </div>
          </div>
        </div>
      )}
      {permissionTier === 'collaborative' && (
        <div style={{
          padding: '12px 16px', marginBottom: '16px', borderRadius: '10px',
          background: 'var(--color-info-bg)', border: '1px solid #90caf9',
          display: 'flex', alignItems: 'center', gap: '10px',
        }}>
          <span style={{ fontSize: '20px' }}>\uD83E\uDD1D</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--color-info)' }}>Collaborative Care</div>
            <div style={{ fontSize: '12px', color: '#37474f', marginTop: '2px' }}>
              Your care is co-managed with {managedByName || 'your care team'}. You can request sessions — they'll review and approve.
            </div>
          </div>
        </div>
      )}

      {/* Tab navigation */}
      {(() => { const rc = window.ROLE_COLOR || 'var(--role-color)'; return (
        <div style={{
          display: 'flex', gap: '6px', marginBottom: '16px', overflowX: 'auto',
          paddingBottom: '4px', WebkitOverflowScrolling: 'touch',
        }}>
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '8px 14px', border: 'none', borderRadius: '20px', cursor: 'pointer',
              background: activeTab === tab.id ? rc : 'var(--bg-surface)',
              color: activeTab === tab.id ? 'var(--text-on-primary)' : 'var(--text-secondary)',
              fontSize: '13px', fontWeight: activeTab === tab.id ? 700 : 500,
              whiteSpace: 'nowrap', flexShrink: 0,
              transition: 'all 0.15s',
              boxShadow: activeTab === tab.id ? `0 2px 8px ${rc}4d` : 'none',
            }}>
              <span style={{ fontSize: '16px' }}>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      ); })()}

      {/* ═══════════════ HOME TAB ═══════════════ */}
      {activeTab === 'home' && (
        <div>
          {/* Request Care CTA */}
          {canRequest && (
            <button onClick={() => {
              if (window.__openRequestCareModal) window.__openRequestCareModal();
            }} style={{
              width: '100%', padding: '16px', marginBottom: '16px',
              background: 'linear-gradient(135deg, var(--role-color), #9b59b6)',
              color: '#fff', border: 'none', borderRadius: '12px', cursor: 'pointer',
              fontSize: '16px', fontWeight: 700,
              boxShadow: '0 4px 12px rgba(123, 94, 167, 0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            }}>
              <span style={{ fontSize: '20px' }}>+</span>
              {permissionTier === 'collaborative' ? 'Request Care (requires approval)' : 'Request Care'}
            </button>
          )}

          {/* Quick Stats */}
          {(stats.sessionsThisMonth > 0 || assignedCaregivers.length > 0) && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '16px' }}>
              <div className="card" style={{ textAlign: 'center', padding: '12px 8px' }}>
                <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--role-color)' }}>{upcomingSessions.length}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>Upcoming</div>
              </div>
              <div className="card" style={{ textAlign: 'center', padding: '12px 8px' }}>
                <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--role-color)' }}>{assignedCaregivers.length}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>Caregivers</div>
              </div>
              <div className="card" style={{ textAlign: 'center', padding: '12px 8px' }}>
                <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--role-color)' }}>{stats.sessionsThisMonth || 0}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>This Month</div>
              </div>
            </div>
          )}

          {/* Upcoming Sessions */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Upcoming Care
            </div>
            {upcomingSessions.length > 0 ? (
              upcomingSessions.slice(0, 5).map(s => renderSessionCard(s, false))
            ) : (
              <div className="card" style={{ textAlign: 'center', padding: '28px 20px' }}>
                <div style={{ fontSize: '32px', marginBottom: '8px' }}>\uD83D\uDCC5</div>
                <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 12 }}>No upcoming sessions</div>
                {canRequest && (
                  <button onClick={() => { if (window.__openRequestCareModal) window.__openRequestCareModal(); }}
                    style={{ padding: '10px 24px', background: 'var(--role-color)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    Request Your First Session
                  </button>
                )}
              </div>
            )}
            {upcomingSessions.length > 5 && (
              <button onClick={() => setActiveTab('calendar')} style={{
                width: '100%', padding: '10px', background: 'none', border: '1px solid var(--border-color)',
                borderRadius: 8, fontSize: 13, color: 'var(--role-color)', cursor: 'pointer', fontWeight: 600, marginTop: 4,
              }}>
                View all on Calendar \u2192
              </button>
            )}
          </div>

          {/* My Care Team Preview */}
          {assignedCaregivers.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  My Care Team
                </div>
                <button onClick={() => setActiveTab('team')} style={{
                  background: 'none', border: 'none', color: 'var(--role-color)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}>View All \u2192</button>
              </div>
              <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
                {assignedCaregivers.slice(0, 4).map(cg => (
                  <div key={cg.assignmentId} onClick={() => setActiveTab('team')} className="card" style={{
                    minWidth: 120, textAlign: 'center', padding: '14px 10px', cursor: 'pointer', flexShrink: 0,
                  }}>
                    <div style={{
                      width: 48, height: 48, borderRadius: '50%', margin: '0 auto 8px',
                      background: 'var(--role-color)', color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 20, fontWeight: 700,
                    }}>
                      {(cg.firstName || '?')[0]}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {cg.firstName}
                    </div>
                    {cg.rating && (
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                        \u2B50 {Number(cg.rating).toFixed(1)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Activity */}
          {recentActivity.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Recent Activity
              </div>
              {recentActivity.slice(0, 5).map(a => (
                <div key={a.id} className="card" style={{ marginBottom: 6, padding: '10px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{a.title}</div>
                      {a.message && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{a.message}</div>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, marginLeft: 8 }}>{timeAgo(a.timestamp)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Quick Links */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
            <button onClick={() => setActiveTab('profile')} className="card" style={{
              padding: '16px', textAlign: 'center', border: 'none', cursor: 'pointer', background: 'var(--bg-card)',
            }}>
              <div style={{ fontSize: 24, marginBottom: 4 }}>\uD83D\uDC8A</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>My Care Info</div>
            </button>
            <button onClick={() => setActiveTab('notes')} className="card" style={{
              padding: '16px', textAlign: 'center', border: 'none', cursor: 'pointer', background: 'var(--bg-card)',
            }}>
              <div style={{ fontSize: 24, marginBottom: 4 }}>\uD83D\uDCDD</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>My Notes</div>
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════ CALENDAR TAB ═══════════════ */}
      {activeTab === 'calendar' && (
        <div>
          {/* Month nav */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <button onClick={() => { setMonthOffset(m => m - 1); setSelectedDay(null); }} style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 14 }}>\u2190 Prev</button>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{monthName}</div>
              {monthOffset !== 0 && (
                <button onClick={() => { setMonthOffset(0); setSelectedDay(null); }} style={{ background: 'none', border: 'none', color: 'var(--role-color)', fontSize: 12, cursor: 'pointer', fontWeight: 600, marginTop: 2 }}>Today</button>
              )}
            </div>
            <button onClick={() => { setMonthOffset(m => m + 1); setSelectedDay(null); }} style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 14 }}>Next \u2192</button>
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 11, color: 'var(--text-secondary)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: '#fff3e0', border: '1px solid #ffb74d', display: 'inline-block' }}></span> Seeking Help
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: '#e8f5e9', border: '1px solid #66bb6a', display: 'inline-block' }}></span> Confirmed
            </span>
          </div>

          {/* Calendar grid */}
          <div className="card" style={{ padding: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', padding: '4px 0' }}>{d}</div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
              {calendarCells.map((day, i) => {
                if (day === null) return <div key={i} style={{ minHeight: 60, background: 'var(--bg-primary)', borderRadius: 4 }}></div>;
                const counts = getDayCounts(day);
                const isTodayCell = isToday(day);
                const isSelected = selectedDay === day;
                const hasRequested = counts.requested > 0;
                const hasConfirmed = counts.confirmed > 0;
                let cellBg = 'var(--bg-card)';
                if (hasRequested && hasConfirmed) cellBg = 'linear-gradient(135deg, #fff3e0 50%, #e8f5e9 50%)';
                else if (hasRequested) cellBg = '#fff3e0';
                else if (hasConfirmed) cellBg = '#e8f5e9';

                return (
                  <div key={i} onClick={() => { setSelectedDay(day); }}
                    style={{
                      minHeight: 60, background: hasRequested && hasConfirmed ? undefined : cellBg,
                      backgroundImage: hasRequested && hasConfirmed ? cellBg : undefined,
                      borderRadius: 6, padding: '4px 6px', cursor: 'pointer',
                      border: isSelected ? '2px solid var(--role-color)' : isTodayCell ? '2px solid #e8724a' : '1px solid #f0f0f0',
                      position: 'relative', transition: 'border 0.15s',
                    }}>
                    <div style={{ fontSize: 13, fontWeight: isTodayCell ? 800 : 600, color: isTodayCell ? '#e8724a' : 'var(--text-primary)', marginBottom: 2 }}>{day}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {hasRequested && <div style={{ fontSize: 9, fontWeight: 600, color: '#e65100', background: 'var(--bg-surface)', borderRadius: 8, padding: '1px 5px', width: 'fit-content' }}>{counts.requested} req</div>}
                      {hasConfirmed && <div style={{ fontSize: 9, fontWeight: 600, color: '#2e7d32', background: 'var(--bg-surface)', borderRadius: 8, padding: '1px 5px', width: 'fit-content' }}>{counts.confirmed} booked</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Selected day panel */}
          {selectedDay && (
            <div className="card" style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{selectedDateLabel}</div>
                <button onClick={() => setSelectedDay(null)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-muted)' }}>\u2715</button>
              </div>
              {selectedDaySessions.length > 0 ? (
                selectedDaySessions.map((s, idx) => {
                  const isRequested = ['requested', 'open'].includes(s.status);
                  return (
                    <div key={idx} style={{
                      padding: '10px 12px', background: isRequested ? '#fff3e0' : '#e8f5e9',
                      borderRadius: 8, marginBottom: 8, borderLeft: `3px solid ${isRequested ? '#ffb74d' : '#66bb6a'}`,
                    }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{formatTime12(s.scheduled_time || s.time)} \u00B7 {serviceLabel(s.service_type || s.serviceType)}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                        {s.duration_hours || s.durationHours || 2}h
                        {(s.caregiver_name || s.caregiverName) ? ` \u00B7 with ${s.caregiver_name || s.caregiverName}` : ''}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>No sessions on this day</div>
              )}
              {canRequest && (
                <button onClick={() => {
                  const prefillDate = getDateStr(selectedDay);
                  if (window.__openRequestCareModal) window.__openRequestCareModal(prefillDate);
                }} style={{
                  width: '100%', padding: '12px', background: 'var(--role-color)', color: '#fff',
                  border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                }}>
                  + Request Care for {new Date(viewYear, viewMonth, selectedDay).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════ MY CARE TEAM TAB ═══════════════ */}
      {activeTab === 'team' && (
        <div>
          {assignedCaregivers.length > 0 ? (
            assignedCaregivers.map(cg => {
              const isExpanded = expandedCaregiverCard === cg.assignmentId;
              return (
                <div key={cg.assignmentId} className="card" style={{ marginBottom: 12, overflow: 'hidden' }}>
                  <div onClick={() => setExpandedCaregiverCard(isExpanded ? null : cg.assignmentId)}
                    style={{ display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer', padding: '4px 0' }}>
                    <div style={{
                      width: 56, height: 56, borderRadius: '50%',
                      background: 'linear-gradient(135deg, var(--role-color), #9b59b6)',
                      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 22, fontWeight: 700, flexShrink: 0,
                    }}>
                      {(cg.firstName || '?')[0]}{(cg.lastName || '?')[0]}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                        {cg.firstName} {cg.lastName}
                        {cg.isFavorite ? ' \u2764\uFE0F' : ''}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                        {cg.rating ? `\u2B50 ${Number(cg.rating).toFixed(1)}` : 'New Caregiver'}
                        {cg.hourlyRate ? ` \u00B7 $${cg.hourlyRate}/hr` : ''}
                      </div>
                      {cg.specialties && cg.specialties.length > 0 && (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                          {cg.specialties.slice(0, 3).map((s, i) => (
                            <span key={i} style={{
                              padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                              background: 'var(--color-info-bg)', color: 'var(--color-info)',
                            }}>{s}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <span style={{ fontSize: 18, color: 'var(--text-muted)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>\u25BC</span>
                  </div>

                  {isExpanded && (
                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-color)' }}>
                      {cg.bio && (
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>{cg.bio}</div>
                      )}
                      {cg.certifications && cg.certifications.length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>Certifications</div>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {cg.certifications.map((c, i) => (
                              <span key={i} style={{ padding: '3px 10px', borderRadius: 10, fontSize: 11, background: '#e8f5e9', color: '#2e7d32', fontWeight: 500 }}>{c}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {cg.phone && (
                          <a href={`tel:${cg.phone}`} style={{
                            padding: '8px 16px', background: 'var(--color-success-bg)', color: 'var(--color-success)',
                            border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none',
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                          }}>
                            \uD83D\uDCDE Call
                          </a>
                        )}
                        <button onClick={() => {
                          if (window.__openRequestCareModal) window.__openRequestCareModal(null, cg.caregiverProfileId);
                        }} style={{
                          padding: '8px 16px', background: 'var(--role-color)', color: '#fff',
                          border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                        }}>
                          Book {cg.firstName}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
              <div style={{ fontSize: '40px', marginBottom: '10px' }}>\uD83E\uDDD1\u200D\u2695\uFE0F</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>No caregivers assigned yet</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                When you request care, we'll match you with qualified caregivers in your area.
              </div>
              {canRequest && (
                <button onClick={() => { if (window.__openRequestCareModal) window.__openRequestCareModal(); }}
                  style={{ padding: '10px 24px', background: 'var(--role-color)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  Find Caregivers
                </button>
              )}
            </div>
          )}

          {/* Care Preferences card */}
          {careProfile && careProfile.preferences && (
            <div className="card" style={{ marginTop: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>\u2728 My Care Preferences</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{careProfile.preferences}</div>
            </div>
          )}

          {/* Location */}
          {careProfile && (careProfile.locationCity || careProfile.locationState) && (
            <div className="card" style={{ marginTop: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>\uD83D\uDCCD Care Location</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{[careProfile.locationCity, careProfile.locationState].filter(Boolean).join(', ')}</div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════ MY INFO TAB ═══════════════ */}
      {activeTab === 'profile' && (
        <div>
          {careProfile ? (
            <React.Fragment>
              {canSee('healthConditions') && careProfile.healthConditions && careProfile.healthConditions.length > 0 && (
                <div className="card" style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>\uD83E\uDE7A Health Conditions</div>
                  {careProfile.healthConditions.map((c, i) => (
                    <div key={i} style={{ padding: '6px 10px', background: 'var(--color-error-bg)', borderRadius: 6, marginBottom: 4, fontSize: 13, color: 'var(--text-primary)' }}>{c}</div>
                  ))}
                </div>
              )}
              {canSee('medications') && careProfile.medications && careProfile.medications.length > 0 && (
                <div className="card" style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>\uD83D\uDC8A Medications</div>
                  {careProfile.medications.map((m, i) => (
                    <div key={i} style={{ padding: '6px 10px', background: 'var(--color-info-bg)', borderRadius: 6, marginBottom: 4, fontSize: 13, color: 'var(--text-primary)' }}>{m}</div>
                  ))}
                </div>
              )}
              {canSee('allergies') && careProfile.foodAllergies && careProfile.foodAllergies.length > 0 && (
                <div className="card" style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>\u26A0\uFE0F Food Allergies</div>
                  {careProfile.foodAllergies.map((a, i) => (
                    <div key={i} style={{ padding: '6px 10px', background: 'var(--color-warning-bg)', borderRadius: 6, marginBottom: 4, fontSize: 13, color: 'var(--color-warning)' }}>{a}</div>
                  ))}
                </div>
              )}
              {canSee('preferences') && careProfile.preferences && (
                <div className="card" style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>\u2728 Care Preferences</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{careProfile.preferences}</div>
                </div>
              )}
              {canSee('pets') && careProfile.pets && (
                <div className="card" style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>\uD83D\uDC3E Pets at Home</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{careProfile.pets}</div>
                </div>
              )}
              {canSee('emergencyContact') && careProfile.emergencyContactName && (
                <div className="card" style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>\uD83C\uDD98 Emergency Contact</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{careProfile.emergencyContactName}</div>
                  {careProfile.emergencyContactPhone && (
                    <a href={'tel:' + careProfile.emergencyContactPhone} style={{ fontSize: 13, color: 'var(--role-color)', textDecoration: 'none' }}>
                      \uD83D\uDCDE {typeof formatPhone === 'function' ? formatPhone(careProfile.emergencyContactPhone) : careProfile.emergencyContactPhone}
                    </a>
                  )}
                </div>
              )}
              {(permissionTier === 'managed' || permissionTier === 'collaborative') && (
                <div style={{ padding: '10px 14px', background: 'var(--color-warning-bg)', borderRadius: 8, fontSize: 12, color: 'var(--color-warning)', textAlign: 'center', marginTop: 8 }}>
                  {permissionTier === 'managed'
                    ? `This profile is managed by ${managedByName || 'your care team'}.`
                    : `Profile changes are coordinated with ${managedByName || 'your care team'}.`}
                </div>
              )}
            </React.Fragment>
          ) : (
            <div className="card" style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>\uD83D\uDC8A</div>
              <div>Your care profile hasn't been filled in yet. You can update it in your Account settings.</div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════ NOTES TAB ═══════════════ */}
      {activeTab === 'notes' && (
        <div>
          {canAddNotes && (
            <div className="card" style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>Write a new note</div>
              <textarea value={newNote} onChange={e => setNewNote(e.target.value)}
                placeholder="What's on your mind? Reminders, thoughts, things to tell your family or caregiver..."
                style={{ width: '100%', minHeight: '80px', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '14px', resize: 'vertical', marginBottom: '8px', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
              />
              <button onClick={handleAddNote} disabled={!newNote.trim() || saving} style={{
                padding: '8px 20px', background: 'var(--role-color)', color: '#fff', border: 'none',
                borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                opacity: (!newNote.trim() || saving) ? 0.5 : 1,
              }}>{saving ? 'Saving...' : 'Save Note'}</button>
            </div>
          )}
          {notes.length > 0 ? notes.map((n, idx) => {
            const typeStyle = noteTypeColors[n.noteType] || noteTypeColors.general;
            const isEditing = editingNote === n.id;
            return (
              <div key={idx} className="card" style={{ marginBottom: '10px' }}>
                {isEditing ? (
                  <div>
                    <textarea value={editContent} onChange={e => setEditContent(e.target.value)}
                      style={{ width: '100%', minHeight: '60px', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '14px', resize: 'vertical', marginBottom: '8px', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
                    />
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => handleEditNote(n.id)} disabled={saving} style={{
                        padding: '6px 14px', background: 'var(--role-color)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px',
                      }}>Save</button>
                      <button onClick={() => setEditingNote(null)} style={{
                        padding: '6px 14px', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: 'var(--text-primary)',
                      }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span style={{ padding: '2px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: 600, background: typeStyle.bg, color: typeStyle.color }}>{typeStyle.label}</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>by {n.authorName} ({n.authorRole === 'care_for' ? 'me' : n.authorRole})</span>
                      </div>
                      {canAddNotes && (
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button onClick={() => { setEditingNote(n.id); setEditContent(n.content); }} style={{
                            padding: '3px 8px', background: 'none', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', color: 'var(--text-secondary)',
                          }}>Edit</button>
                          <button onClick={() => handleDeleteNote(n.id)} style={{
                            padding: '3px 8px', background: 'none', border: '1px solid #fdd', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', color: 'var(--color-red-strong)',
                          }}>Delete</button>
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: '14px', color: 'var(--text-primary)', lineHeight: 1.5 }}>{n.content}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>{n.createdAt ? (parseTimestamp(n.createdAt) || new Date()).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}</div>
                  </div>
                )}
              </div>
            );
          }) : (
            <div className="card" style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>\uD83D\uDCDD</div>
              <div>No notes yet — write your first one above!</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
