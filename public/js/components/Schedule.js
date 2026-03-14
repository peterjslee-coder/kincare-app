const Schedule = window.Schedule = () => {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [authGate, setAuthGate] = useState(null); // null = loading, true = blocked, false = ok
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selectedDate, setSelectedDate] = useState(() => {
    // Default to today's date so the detail panel auto-populates
    const now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  });
  const [expandedSession, setExpandedSession] = useState(null);
  const [visitDetailSessionId, setVisitDetailSessionId] = useState(null);

  // Pick up pending schedule date from activity feed deep-link
  useEffect(() => {
    if (window.__pendingScheduleDate) {
      const raw = window.__pendingScheduleDate.split('T')[0];
      const parts = raw.split('-').map(Number);
      if (parts.length === 3 && !isNaN(parts[0])) {
        setCurrentMonth({ year: parts[0], month: parts[1] - 1 });
        setSelectedDate(raw);
      }
      delete window.__pendingScheduleDate;
    }
  }, []);

  const fetchSessions = async () => {
    try {
      const response = await apiFetch('/api/sessions?limit=100');
      if (response?.ok) {
        const data = await response.json();
        setSessions((data.sessions || []).filter(s => s.status !== 'cancelled'));
      }
    } catch (error) {
      console.error('Error fetching sessions:', error);
    }
    setLoading(false);
  };

  // Check if user has at least one verified care recipient — gate scheduling behind authorization
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/care-recipients');
        if (res?.ok) {
          const data = await res.json();
          const list = data.careRecipients || data || [];
          const hasVerified = list.some(r => r.consent_status === 'verified' || r.consent_status === 'approved' || r.authorization_tier === 'tier1');
          setAuthGate(list.length === 0 ? true : !hasVerified);
        } else {
          setAuthGate(false); // If API fails, don't block
        }
      } catch { setAuthGate(false); }
    })();
  }, []);

  useEffect(() => {
    fetchSessions();
    // Re-fetch when a new session is created (e.g. from RequestCareModal)
    const onSessionsUpdated = () => fetchSessions();
    window.addEventListener('sessions-updated', onSessionsUpdated);
    return () => window.removeEventListener('sessions-updated', onSessionsUpdated);
  }, []);

  // ─── Calendar helpers ───
  const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfWeek = (year, month) => new Date(year, month, 1).getDay();

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const prevMonth = () => {
    setCurrentMonth(prev => {
      const m = prev.month - 1;
      return m < 0 ? { year: prev.year - 1, month: 11 } : { year: prev.year, month: m };
    });
    setSelectedDate(null);
  };

  const nextMonth = () => {
    setCurrentMonth(prev => {
      const m = prev.month + 1;
      return m > 11 ? { year: prev.year + 1, month: 0 } : { year: prev.year, month: m };
    });
    setSelectedDate(null);
  };

  // ─── Build hours-per-day map ───
  const hoursMap = {};
  const sessionsByDate = {};
  sessions.forEach(s => {
    const d = s.scheduled_date; // "YYYY-MM-DD"
    hoursMap[d] = (hoursMap[d] || 0) + (s.duration_hours || 2);
    if (!sessionsByDate[d]) sessionsByDate[d] = [];
    sessionsByDate[d].push(s);
  });

  // ─── Saturation: 1hr = 25%, scales to 75% at 10+ hours ───
  const getSaturation = (hours) => {
    if (!hours || hours <= 0) return 0;
    // Linear scale: 1hr → 25%, 10hr → 75%
    const pct = Math.min(25 + (hours - 1) * (50 / 9), 75);
    return pct;
  };

  const todayStr = TimezoneHelper.getToday();

  const { year, month } = currentMonth;
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);

  // Build calendar grid cells
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const getDateStr = (day) => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const isPast = (dateStr) => dateStr < todayStr;

  const getStatusBadge = (status) => {
    const colors = {
      completed: { bg: '#e0f2e9', text: '#1b6b5a' },
      confirmed: { bg: '#e3f2fd', text: '#1565c0' },
      pending: { bg: '#fff3e0', text: '#e65100' },
      requested: { bg: '#fce4ec', text: '#c62828' },
      open: { bg: '#fff8e1', text: '#f57f17' },
      in_progress: { bg: '#f3e5f5', text: '#7b1fa2' },
      cancelled: { bg: '#fce4ec', text: '#c62828' },
    };
    const c = colors[status] || colors.pending;
    const labels = {
      open: 'Awaiting caregiver',
      requested: 'Requested — awaiting response',
      pending: 'Pending',
      confirmed: 'Confirmed',
      completed: 'Completed',
      in_progress: 'In Progress',
      cancelled: 'Cancelled',
    };
    const label = labels[status] || status;
    return { style: { background: c.bg, color: c.text, padding: '2px 8px', borderRadius: '8px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' }, label };
  };

  // Sessions for selected date
  const selectedSessions = selectedDate ? (sessionsByDate[selectedDate] || []) : [];

  if (loading) return <LoadingSpinner text="Loading schedule..." />;

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Schedule</h1>
        <p className="page-subtitle">{sessions.length > 0 ? 'Care calendar — click any day to see details' : 'Your care calendar'}</p>
      </div>

      {authGate && (
        <div style={{ background: '#FFF3E0', border: '1px solid #ffe0b2', borderRadius: 12, padding: '16px 20px', marginBottom: 20, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span style={{ fontSize: 22 }}>🔒</span>
          <div>
            <div style={{ fontWeight: 600, color: '#e65100', fontSize: 15, marginBottom: 4 }}>Authorization Required</div>
            <div style={{ fontSize: 13, color: '#6d4c00', lineHeight: 1.5 }}>
              Before scheduling care, you'll need to add a loved one and complete the care authorization process.
              This ensures everyone involved is aware and has consented to care arrangements.
            </div>
            <button onClick={() => window.__navigateTo && window.__navigateTo('recipients')} style={{ marginTop: 10, padding: '8px 18px', background: '#e8724a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Complete Authorization
            </button>
          </div>
        </div>
      )}

      {/* Empty state for new users with no sessions */}
      {sessions.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '48px 24px', marginBottom: 20 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📅</div>
          <h3 style={{ margin: '0 0 8px', color: '#1a1a2e', fontSize: 18 }}>No care sessions scheduled yet</h3>
          {getActiveRole() === 'caregiver' ? (
            <React.Fragment>
              <p style={{ color: '#666', fontSize: 14, maxWidth: 400, margin: '0 auto 20px' }}>
                Find work opportunities near you to get started. Accepted sessions will appear here on your calendar.
              </p>
              <button className="btn btn-primary" onClick={() => {
                if (window.__navigateTo) window.__navigateTo('find-work');
              }} style={{ padding: '12px 32px', fontSize: 15 }}>
                Find Work
              </button>
            </React.Fragment>
          ) : (
            <React.Fragment>
              <p style={{ color: '#666', fontSize: 14, maxWidth: 400, margin: '0 auto 20px' }}>
                Select a day on the calendar below to book your first care session. Your sessions will appear here so you can track everything in one place.
              </p>
            </React.Fragment>
          )}
        </div>
      )}

      {/* Month navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ flex: 1 }} />
        <button onClick={prevMonth} style={{
          padding: '8px 16px', background: '#fff', border: '1px solid #d0d0d0',
          borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600,
        }}>← Prev</button>
        <h2 style={{ margin: 0, color: '#1b6b5a', fontSize: '20px' }}>
          {monthNames[month]} {year}
        </h2>
        <button onClick={nextMonth} style={{
          padding: '8px 16px', background: '#fff', border: '1px solid #d0d0d0',
          borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600,
        }}>Next →</button>
      </div>

      {/* Legend — dot indicators */}
      <div style={{ display: 'flex', gap: '14px', marginBottom: '12px', fontSize: '11px', color: '#999', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#1b6b5a', display: 'inline-block' }}></span> Confirmed
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'transparent', border: '2px solid #e8724a', display: 'inline-block' }}></span> Awaiting caregiver
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#f57f17', display: 'inline-block' }}></span> In progress
        </span>
      </div>

      {/* Calendar grid — single unified grid so headers and cells always align */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', borderRadius: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {/* Day headers — row 1 */}
          {dayNames.map(d => (
            <div key={d} style={{ padding: '10px 0', textAlign: 'center', fontSize: '11px', fontWeight: 700, color: '#999', textTransform: 'uppercase', background: '#fafafa', borderBottom: '1px solid #eee' }}>{d}</div>
          ))}
          {/* Day cells */}
          {cells.map((day, idx) => {
            if (day === null) {
              return <div key={`empty-${idx}`} style={{ minHeight: 64, background: '#fafafa', borderBottom: '1px solid #f0f0f0', borderRight: '1px solid #f0f0f0' }}></div>;
            }
            const dateStr = getDateStr(day);
            const past = isPast(dateStr);
            const isToday = dateStr === todayStr;
            const isSelected = dateStr === selectedDate;
            const daySessions = sessionsByDate[dateStr] || [];
            const hasSessions = daySessions.length > 0;

            return (
              <div key={dateStr} onClick={() => setSelectedDate(isSelected ? null : dateStr)} style={{
                minHeight: 64, padding: '6px', cursor: 'pointer',
                background: isSelected ? '#1b6b5a' : '#fff',
                color: isSelected ? '#fff' : past ? '#bbb' : '#333',
                borderBottom: '1px solid #f0f0f0', borderRight: '1px solid #f0f0f0',
                position: 'relative', transition: 'background 0.15s',
                opacity: past && !hasSessions ? 0.45 : 1,
              }}>
                <div style={{
                  fontSize: 14, fontWeight: isToday ? 800 : 500,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                }}>
                  {isToday && <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: isSelected ? '#fff' : '#e8724a', display: 'inline-block',
                  }}></span>}
                  {day}
                </div>
                {/* Session dots — one per session, max 5 visible */}
                {hasSessions && (
                  <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap', paddingLeft: 1 }}>
                    {daySessions.sort((a, b) => (a.scheduled_time || '').localeCompare(b.scheduled_time || '')).slice(0, 4).map((s, si) => {
                      const isPending = ['open', 'requested', 'pending'].includes(s.status);
                      const isInProgress = s.status === 'in_progress';
                      const dotColor = isInProgress ? '#f57f17' : isPending ? 'transparent' : past ? '#ccc' : '#1b6b5a';
                      const dotBorder = isPending ? '2px solid ' + (isSelected ? '#fff' : '#e8724a') : 'none';
                      return (
                        <span key={si} style={{
                          width: 9, height: 9, borderRadius: '50%',
                          background: isSelected ? (isPending ? 'transparent' : 'rgba(255,255,255,0.85)') : dotColor,
                          border: isSelected && isPending ? '2px solid rgba(255,255,255,0.85)' : dotBorder,
                          display: 'inline-block', flexShrink: 0,
                        }}></span>
                      );
                    })}
                    {daySessions.length > 4 && (
                      <span style={{ fontSize: 9, color: isSelected ? 'rgba(255,255,255,0.7)' : '#999', lineHeight: '9px', fontWeight: 600 }}>+{daySessions.length - 4}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected date detail panel */}
      {selectedDate && (
        <div className="card" style={{ marginTop: '16px' }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>
              <span className="card-icon">📋</span>
              {(() => { const p = selectedDate.split('-').map(Number); return new Date(p[0], p[1]-1, p[2]).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); })()}
              {isPast(selectedDate) && <span style={{ marginLeft: 8, fontSize: 11, color: '#999', fontWeight: 400 }}>(Past)</span>}
            </span>
            <span style={{ fontSize: 13, color: '#1b6b5a', fontWeight: 600 }}>{hoursMap[selectedDate] || 0} total hours</span>
          </div>

          {selectedSessions.length > 0 ? (
            <>
              {selectedSessions.map((s) => (
                <div key={s.id} onClick={() => setExpandedSession(expandedSession === s.id ? null : s.id)}
                  style={{
                    padding: '12px 0', borderBottom: '1px solid #f0f0f0', cursor: 'pointer',
                    opacity: isPast(selectedDate) ? 0.75 : 1,
                  }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: isPast(selectedDate) ? '#888' : '#333' }}>
                        {s.scheduled_time || '—'}
                        <span style={{ fontWeight: 400, marginLeft: 8, color: '#666' }}>{formatServiceType(s.service_type)}</span>
                      </div>
                      <div style={{ fontSize: 13, color: '#666', marginTop: 2 }}>
                        {s.caregiver_name || (s.status === 'open' ? 'Waiting for caregiver' : 'Unmatched')} — {s.recipient_name || 'Care recipient'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {s.recurrence_rule && (
                        <span style={{ background: '#ede7f6', color: '#5e35b1', padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600 }}>
                          {s.recurrence_rule === 'weekly' ? '🔁 Weekly' : '🔁 Biweekly'}
                        </span>
                      )}
                      <span style={getStatusBadge(s.status).style}>{getStatusBadge(s.status).label}</span>
                      <span style={{ color: '#999', fontSize: 16 }}>{expandedSession === s.id ? '▾' : '▸'}</span>
                    </div>
                  </div>
                  {expandedSession === s.id && (
                    <div style={{ marginTop: 12, padding: '12px', background: '#f9f9f9', borderRadius: 8, fontSize: 13 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
                        <div><span style={{ color: '#888' }}>Duration:</span> <strong>{s.duration_hours || 2} hours</strong></div>
                        <div><span style={{ color: '#888' }}>Cost:</span> <strong>{s.estimated_cost ? `$${s.estimated_cost}` : s.actual_cost ? `$${s.actual_cost}` : '—'}</strong></div>
                        <div><span style={{ color: '#888' }}>Service:</span> <strong>{formatServiceType(s.service_type)}</strong></div>
                        <div><span style={{ color: '#888' }}>Caregiver:</span> <strong>{s.caregiver_name || 'Pending match'}</strong></div>
                      </div>
                      {s.special_instructions && (
                        <div style={{ marginTop: 8, padding: '8px', background: '#fff', borderRadius: 6, border: '1px solid #eee' }}>
                          <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>Special Instructions</div>
                          <div>{s.special_instructions}</div>
                        </div>
                      )}
                      {s.caregiver_rating > 0 && (
                        <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>
                          Caregiver rating: ⭐ {s.caregiver_rating}
                        </div>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); setVisitDetailSessionId(s.id); }}
                        style={{ marginTop: 10, padding: '6px 14px', background: '#1b6b5a', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                        View Full Details
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {!isPast(selectedDate) && (
                <div onClick={() => window.__openRequestCareModal && window.__openRequestCareModal(selectedDate)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    padding: '14px', cursor: 'pointer', color: '#e8724a', fontSize: 13, fontWeight: 700,
                    borderTop: '1px solid #f0f0f0', marginTop: 4, transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#fff8f4'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span style={{ fontSize: 18 }}>+</span> Book care on {(() => { const p = selectedDate.split('-').map(Number); return new Date(p[0], p[1]-1, p[2]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); })()}
                </div>
              )}
            </>
          ) : (
            <div style={{ padding: '24px 16px', textAlign: 'center' }}>
              {isPast(selectedDate) ? (
                <p style={{ color: '#999', fontSize: 14 }}>No sessions on this date.</p>
              ) : (
                <>
                  <p style={{ fontSize: 14, color: '#888', marginBottom: 14 }}>No care scheduled for this day yet.</p>
                  <button onClick={() => window.__openRequestCareModal && window.__openRequestCareModal(selectedDate)}
                    style={{
                      padding: '12px 28px', background: '#e8724a', color: '#fff', border: 'none',
                      borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer',
                      boxShadow: '0 2px 8px rgba(232, 114, 74, 0.3)',
                    }}>
                    + Request Care for {(() => { const p = selectedDate.split('-').map(Number); return new Date(p[0], p[1]-1, p[2]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); })()}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Month summary */}
      <div style={{ marginTop: '16px', fontSize: '13px', color: '#666', display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
        {(() => {
          const monthSessions = sessions.filter(s => {
            const d = s.scheduled_date;
            const [y, m] = d.split('-').map(Number);
            return y === year && m === month + 1;
          });
          const totalHours = monthSessions.reduce((sum, s) => sum + (s.duration_hours || 2), 0);
          const totalCost = monthSessions.reduce((sum, s) => sum + (s.estimated_cost || s.actual_cost || 0), 0);
          const uniqueDays = new Set(monthSessions.map(s => s.scheduled_date)).size;
          return (
            <>
              <span>📅 <strong>{monthSessions.length}</strong> sessions</span>
              <span>📆 <strong>{uniqueDays}</strong> care days</span>
              <span>⏱️ <strong>{totalHours}</strong> total hours</span>
              <span>💰 <strong>${totalCost.toFixed(0)}</strong> estimated</span>
            </>
          );
        })()}
      </div>
      {visitDetailSessionId && (
        <VisitDetailModal sessionId={visitDetailSessionId} role="family" onClose={() => setVisitDetailSessionId(null)} />
      )}

    </>
  );
};
