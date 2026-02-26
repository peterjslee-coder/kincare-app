const Schedule = window.Schedule = () => {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selectedDate, setSelectedDate] = useState(null);
  const [expandedSession, setExpandedSession] = useState(null);
  const [visitDetailSessionId, setVisitDetailSessionId] = useState(null);

  // Pick up pending schedule date from activity feed deep-link
  useEffect(() => {
    if (window.__pendingScheduleDate) {
      const raw = window.__pendingScheduleDate.split('T')[0];
      const parts = raw.split('-').map(Number);
      if (parts.length === 3 && !isNaN(parts[0])) {
        setCurrentMonth({ year: parts[0], month: parts[1] - 1 });
        // Set selectedDate to full "YYYY-MM-DD" string to match sessionsByDate keys
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
                Request care to get started. Your sessions will appear here on the calendar so you can track everything in one place.
              </p>
              <button className="btn btn-primary" onClick={() => {
                if (window.__openRequestCareModal) window.__openRequestCareModal();
              }} style={{ padding: '12px 32px', fontSize: 15 }}>
                Request Care
              </button>
            </React.Fragment>
          )}
        </div>
      )}

      {/* Month navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
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

      {/* Legend */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', fontSize: '12px', color: '#666', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 14, height: 14, borderRadius: 3, background: '#fce4ec', display: 'inline-block', border: '1px solid #f8bbd0' }}></span> Pending request
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 14, height: 14, borderRadius: 3, background: 'hsl(160, 60%, 75%)', display: 'inline-block' }}></span> Confirmed (1-2hrs)
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 14, height: 14, borderRadius: 3, background: 'hsl(160, 60%, 50%)', display: 'inline-block' }}></span> Confirmed (3-5hrs)
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 14, height: 14, borderRadius: 3, background: 'hsl(160, 60%, 30%)', display: 'inline-block' }}></span> Confirmed (6+ hrs)
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 14, height: 14, borderRadius: 3, background: '#f0f0f0', display: 'inline-block', border: '1px solid #ddd' }}></span> Past
        </span>
      </div>

      {/* Calendar grid */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Day headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', background: '#f8f8f8', borderBottom: '1px solid #e0e0e0' }}>
          {dayNames.map(d => (
            <div key={d} style={{ padding: '10px 4px', textAlign: 'center', fontSize: '12px', fontWeight: 700, color: '#888', textTransform: 'uppercase' }}>{d}</div>
          ))}
        </div>
        {/* Day cells */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {cells.map((day, idx) => {
            if (day === null) {
              return <div key={`empty-${idx}`} style={{ minHeight: 70, background: '#fafafa', borderBottom: '1px solid #f0f0f0', borderRight: '1px solid #f0f0f0' }}></div>;
            }
            const dateStr = getDateStr(day);
            const hours = hoursMap[dateStr] || 0;
            const saturation = getSaturation(hours);
            const past = isPast(dateStr);
            const isToday = dateStr === todayStr;
            const isSelected = dateStr === selectedDate;
            const hasSessions = hours > 0;

            // Check if any session on this day is open/requested (unconfirmed)
            const daySessions = sessionsByDate[dateStr] || [];
            const hasOpenRequest = daySessions.some(s => s.status === 'open' || s.status === 'requested' || s.status === 'pending');
            const allConfirmed = hasSessions && !hasOpenRequest;

            // Color: teal for confirmed, pink/red for open requests
            let bgColor = '#fff';
            let textColor = '#333';
            if (hasSessions && !past && hasOpenRequest) {
              // Pink for days with unconfirmed requests
              bgColor = '#fce4ec';
              textColor = '#c62828';
            } else if (hasSessions && !past && allConfirmed) {
              // HSL: 160 is teal. Lightness goes from 85% (light) down to 25% (dark)
              const lightness = 85 - (saturation * 0.8);
              bgColor = `hsl(160, 60%, ${lightness}%)`;
              textColor = lightness < 50 ? '#fff' : '#1b6b5a';
            } else if (hasSessions && past) {
              // Past with sessions: muted grey-green
              bgColor = '#e8ede8';
              textColor = '#999';
            } else if (past) {
              bgColor = '#f5f5f5';
              textColor = '#bbb';
            }

            return (
              <div key={dateStr} onClick={() => setSelectedDate(isSelected ? null : dateStr)} style={{
                minHeight: 70, padding: '6px', cursor: hasSessions ? 'pointer' : 'default',
                background: isSelected ? '#1b6b5a' : bgColor,
                color: isSelected ? '#fff' : textColor,
                borderBottom: '1px solid #f0f0f0', borderRight: '1px solid #f0f0f0',
                position: 'relative', transition: 'background 0.15s',
                opacity: past && !hasSessions ? 0.5 : 1,
              }}>
                <div style={{
                  fontSize: 14, fontWeight: isToday ? 800 : 500,
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  {isToday && <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: isSelected ? '#fff' : '#e8724a', display: 'inline-block',
                  }}></span>}
                  {day}
                </div>
                {hasSessions && daySessions.length > 0 && (
                  <div style={{ marginTop: 3, overflow: 'hidden' }}>
                    {daySessions.sort((a, b) => (a.scheduled_time || '').localeCompare(b.scheduled_time || '')).slice(0, 2).map((s, si) => {
                      const label = s.recipient_name ? s.recipient_name.split(' ')[0] : (s.caregiver_name ? s.caregiver_name.split(' ')[0] : '');
                      const svcMap = { companionship: 'Comp', personal_care: 'Care', meal_prep: 'Meal', transportation: 'Trans', health_wellness: 'Health', full_day: 'Full' };
                      const svc = svcMap[s.service_type] || '';
                      const tParts = (s.scheduled_time || '').split(':');
                      const tH = parseInt(tParts[0]) || 0;
                      const timeLabel = tH === 0 ? '12a' : tH < 12 ? `${tH}a` : tH === 12 ? '12p' : `${tH - 12}p`;
                      return (
                        <div key={si} style={{ fontSize: 8, lineHeight: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', opacity: 0.85 }}>
                          <span style={{ fontWeight: 700 }}>{timeLabel}</span> {label}{svc ? ` · ${svc}` : ''} · {s.duration_hours || 2}h
                        </div>
                      );
                    })}
                    {daySessions.length > 2 && (
                      <div style={{ fontSize: 8, opacity: 0.6 }}>+{daySessions.length - 2} more</div>
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

          {selectedSessions.length > 0 ? selectedSessions.map((s) => (
            <div key={s.id} onClick={() => setExpandedSession(expandedSession === s.id ? null : s.id)}
              style={{
                padding: '12px 0', borderBottom: '1px solid #f0f0f0', cursor: 'pointer',
                opacity: isPast(selectedDate) ? 0.75 : 1,
              }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: isPast(selectedDate) ? '#888' : '#333' }}>
                    {s.scheduled_time || '—'}
                    <span style={{ fontWeight: 400, marginLeft: 8, color: '#666' }}>{s.service_type}</span>
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
                    <div><span style={{ color: '#888' }}>Service:</span> <strong>{s.service_type}</strong></div>
                    <div><span style={{ color: '#888' }}>Caregiver:</span> <strong>{s.caregiver_name || 'Pending match'}</strong></div>
                  </div>
                  {s.special_instructions && (
                    <div style={{ marginTop: 8, padding: '8px', background: '#fff', borderRadius: 6, border: '1px solid #eee' }}>
                      <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>Special Instructions</div>
                      <div>{s.special_instructions}</div>
                    </div>
                  )}
                  {s.caregiver_rating && (
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
          )) : (
            <p style={{ color: '#999', padding: '16px 0', fontSize: 14 }}>No sessions scheduled for this date.</p>
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
        <VisitDetailModal sessionId={visitDetailSessionId} onClose={() => setVisitDetailSessionId(null)} />
      )}
    </>
  );
};
