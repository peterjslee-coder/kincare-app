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
  const [cancellingSession, setCancellingSession] = useState(null);
  // v1.135.0 — Month opens first; Week is one tap away, remembered on the account (Pete, 11/18).
  const [weekView, setWeekView] = useStickySection('schedule.weekView', false);
  const [weekStart, setWeekStart] = useState(null); // 'YYYY-MM-DD' of the Sunday shown in Week

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

  // v1.114.3 — the calendar asks for the MONTH it is showing.
  //
  // It used to ask for "?limit=100" with no date range. The server sorts oldest-first, so an
  // account with more than 100 visits of history got its first 100 visits ever — and the
  // calendar simply stopped partway through the next month (Pete's ended Nov 4; two visits
  // Tina had accepted for Nov 7 and every recurring visit after were invisible). Cancelled
  // visits were filtered out here, after the cap, so they used up slots too.
  const [hasAnySessions, setHasAnySessions] = useState(null);
  const monthRange = (y, m) => {
    const pad = (n) => String(n).padStart(2, '0');
    // v1.135.0 — a week either side, so an overnight from the 31st reaches the 1st's bar and a
    // week that straddles two months is whole. The month summary below still counts only this
    // month (monthSessions filters by date).
    const ds = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
    return { from: ds(new Date(y, m, 1 - 7)), to: ds(new Date(y, m + 1, 7)) };
  };
  const monthRef = useRef(currentMonth);
  monthRef.current = currentMonth;

  const fetchSessions = async () => {
    const { year: y, month: m } = monthRef.current;
    const { from, to } = monthRange(y, m);
    try {
      const response = await apiFetch(`/api/sessions?from=${from}&to=${to}&limit=200`);
      if (response?.ok) {
        const data = await response.json();
        // A slower answer for a month the user has already paged away from is dropped.
        const now = monthRef.current;
        if (now.year !== y || now.month !== m) return;
        const list = (data.sessions || []).filter(s => s.status !== 'cancelled');
        setSessions(list);
        if (list.length > 0) setHasAnySessions(true);
      }
    } catch (error) {
      console.error('Error fetching sessions:', error);
    }
    setLoading(false);
  };

  // Whether this account has ANY visits — decides the first-run empty state, which used to
  // read sessions.length and would now fire on every quiet month.
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/sessions?limit=1');
        if (res?.ok) {
          const data = await res.json();
          setHasAnySessions((data.sessions || []).length > 0);
        }
      } catch { /* the calendar still works without it */ }
    })();
  }, []);

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
    // Re-fetch when a new session is created (e.g. from RequestCareModal)
    const onSessionsUpdated = () => fetchSessions();
    window.addEventListener('sessions-updated', onSessionsUpdated);
    return () => window.removeEventListener('sessions-updated', onSessionsUpdated);
  }, []);

  useEffect(() => { fetchSessions(); }, [currentMonth.year, currentMonth.month]);

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
      completed: { bg: 'var(--role-color-light)', text: 'var(--role-color)' },
      confirmed: { bg: 'var(--color-info-bg)', text: 'var(--color-info)' },
      pending: { bg: 'var(--color-warning-bg)', text: 'var(--color-warning)' },
      requested: { bg: 'var(--color-error-bg)', text: 'var(--color-error)' },
      open: { bg: 'var(--color-warning-bg)', text: 'var(--color-warning)' },
      in_progress: { bg: 'var(--color-purple-bg)', text: 'var(--color-purple)' },
      cancelled: { bg: 'var(--color-error-bg)', text: 'var(--color-error)' },
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
        <p className="page-subtitle">{hasAnySessions ? 'Care calendar — click any day to see details' : 'Your care calendar'}</p>
      </div>

      {authGate && (
        <div style={{ background: 'var(--color-warning-bg)', border: '1px solid #ffe0b2', borderRadius: 12, padding: '16px 20px', marginBottom: 20, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span style={{ fontSize: 22 }}>🔒</span>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--color-warning)', fontSize: 15, marginBottom: 4 }}>Authorization Required</div>
            <div style={{ fontSize: 13, color: 'var(--color-warning)', lineHeight: 1.5 }}>
              Before scheduling care, you'll need to add a loved one and complete the care authorization process.
              This ensures everyone involved is aware and has consented to care arrangements.
            </div>
            <button onClick={() => window.__navigateTo && window.__navigateTo('recipients')} style={{ marginTop: 10, padding: '8px 18px', background: 'var(--accent-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Complete Authorization
            </button>
          </div>
        </div>
      )}

      {/* Empty state for new users with no sessions */}
      {hasAnySessions === false && (
        <div className="card" style={{ textAlign: 'center', padding: '48px 24px', marginBottom: 20 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📅</div>
          <h3 style={{ margin: '0 0 8px', color: 'var(--text-primary)', fontSize: 18 }}>No care sessions scheduled yet</h3>
          {getActiveRole() === 'caregiver' ? (
            <React.Fragment>
              <p style={{ color: 'var(--text-secondary)', fontSize: 14, maxWidth: 400, margin: '0 auto 20px' }}>
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
              <p style={{ color: 'var(--text-secondary)', fontSize: 14, maxWidth: 400, margin: '0 auto 20px' }}>
                Select a day on the calendar below to book your first care session. Your sessions will appear here so you can track everything in one place.
              </p>
            </React.Fragment>
          )}
        </div>
      )}

      {/* Month navigation (Week has its own, on its card) */}
      <div style={{ display: weekView ? 'none' : 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ flex: 1 }} />
        <button onClick={prevMonth} style={{
          padding: '8px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border-color)',
          borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)',
        }}>← Prev</button>
        <h2 style={{ margin: 0, color: 'var(--role-color)', fontSize: '20px' }}>
          {monthNames[month]} {year}
        </h2>
        <button onClick={nextMonth} style={{
          padding: '8px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border-color)',
          borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)',
        }}>Next →</button>
      </div>

      {/* v1.135.0 — Month | Week, and the 24-hour legend */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }} role="group" aria-label="Calendar view">
        {[['month', 'Month'], ['week', 'Week']].map(([id, label]) => {
          const on = (id === 'week') === !!weekView;
          return (
            <button key={id} type="button" aria-pressed={on} onClick={() => setWeekView(id === 'week')} style={{
              flex: 1, minHeight: 40, borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer',
              border: on ? 'none' : '1px solid var(--border-color)',
              background: on ? 'var(--role-color)' : 'var(--bg-surface)',
              color: on ? 'var(--text-on-primary)' : 'var(--text-secondary)',
            }}>{label}</button>
          );
        })}
      </div>
      <div style={{ marginBottom: 12 }}><DayBarLegend /></div>

      {/* Calendar grid — single unified grid so headers and cells always align */}
      {!weekView && <div className="card" style={{ padding: 0, overflow: 'hidden', borderRadius: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {/* Day headers — row 1 */}
          {dayNames.map(d => (
            <div key={d} style={{ padding: '10px 0', textAlign: 'center', fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', background: 'var(--bg-primary)', borderBottom: '1px solid #eee' }}>{d}</div>
          ))}
          {/* Day cells */}
          {cells.map((day, idx) => {
            if (day === null) {
              return <div key={`empty-${idx}`} style={{ minHeight: 64, background: 'var(--bg-primary)', borderBottom: '1px solid #f0f0f0', borderRight: '1px solid #f0f0f0' }}></div>;
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
                background: isSelected ? 'var(--role-color)' : isToday ? 'rgba(59, 130, 246, 0.1)' : 'var(--bg-card)',
                color: isSelected ? 'var(--text-on-primary)' : past ? 'var(--text-muted)' : 'var(--text-primary)',
                borderBottom: '1px solid #f0f0f0', borderRight: '1px solid #f0f0f0',
                position: 'relative', transition: 'background 0.15s',
                opacity: past && !hasSessions ? 0.45 : 1,
              }}>
                <div style={{
                  fontSize: 14, fontWeight: isToday ? 800 : 500,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                  color: isSelected ? undefined : isToday ? '#3b82f6' : undefined,
                }}>
                  {day}
                </div>
                {/* v1.135.0 — the day's 24 hours, midnight to midnight */}
                <div style={{ marginTop: 6 }}>
                  <DayBar segments={dayBarSegments(sessionsByDate, dateStr, todayStr)} laneHeight={6} gap={2} radius={3} />
                </div>
              </div>
            );
          })}
        </div>
      </div>}

      {weekView && (() => {
        // v1.135.0 — Week: one full-width 24-hour row per day, names on the blocks.
        const pad = (n) => String(n).padStart(2, '0');
        const ds = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
        const anchor = weekStart || selectedDate || todayStr;
        const [ay, am, ad] = anchor.split('-').map(Number);
        const a0 = new Date(ay, am - 1, ad);
        const sun = new Date(ay, am - 1, ad - (weekStart ? 0 : a0.getDay()));
        const days = Array.from({ length: 7 }, (_, i) => new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() + i));
        const shift = (n) => {
          const nx = new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() + n);
          setWeekStart(ds(nx));
          // Keep the fetched month on the week (its Thursday decides), so the rows have data.
          const thu = new Date(nx.getFullYear(), nx.getMonth(), nx.getDate() + 4);
          if (thu.getMonth() !== month || thu.getFullYear() !== year) setCurrentMonth({ year: thu.getFullYear(), month: thu.getMonth() });
        };
        const fmtShort = (dt) => dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return (
          <div className="card" style={{ padding: '12px 14px', borderRadius: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <button type="button" aria-label="Previous week" onClick={() => shift(-7)} style={{ minWidth: 44, minHeight: 44, background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-primary)' }}>{'\u2039'}</button>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>{fmtShort(days[0])} {'\u2013'} {fmtShort(days[6])}</div>
              <button type="button" aria-label="Next week" onClick={() => shift(7)} style={{ minWidth: 44, minHeight: 44, background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-primary)' }}>{'\u203A'}</button>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ width: 56, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}><DayBarAxis /></div>
            </div>
            {days.map((dt) => {
              const dstr = ds(dt);
              const segs = dayBarSegments(sessionsByDate, dstr, todayStr);
              const sel = dstr === selectedDate;
              const isToday = dstr === todayStr;
              return (
                <button key={dstr} type="button" onClick={() => setSelectedDate(dstr)} aria-pressed={sel} style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 0', minHeight: 44,
                  background: 'none', border: 'none', borderTop: '1px solid var(--border-color)', cursor: 'pointer', textAlign: 'left',
                }}>
                  <span style={{ width: 56, flexShrink: 0 }}>
                    <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: sel || isToday ? 'var(--role-color)' : 'var(--text-primary)' }}>{dayNames[dt.getDay()]} {dt.getDate()}</span>
                    <span style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)' }}>{dayBarCoveredHours(segs)}h covered</span>
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <DayBar segments={segs} laneHeight={22} gap={3} radius={6} labels />
                  </span>
                </button>
              );
            })}
          </div>
        );
      })()}

      {/* Book care button — above the daily detail card so it's visible right below the calendar */}
      {selectedDate && !isPast(selectedDate) && (
        <div onClick={() => window.__openRequestCareModal && window.__openRequestCareModal(selectedDate)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            marginTop: 16, padding: '14px 24px', cursor: 'pointer',
            background: '#e67e22', color: '#fff', fontSize: 15, fontWeight: 700,
            borderRadius: 12, transition: 'background 0.15s',
            boxShadow: '0 2px 8px rgba(230,126,34,0.3)',
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#d35400'}
          onMouseLeave={e => e.currentTarget.style.background = '#e67e22'}>
          <span style={{ fontSize: 20, fontWeight: 700 }}>+</span> Book care on {(() => { const p = selectedDate.split('-').map(Number); return new Date(p[0], p[1]-1, p[2]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); })()}
        </div>
      )}

      {/* Selected date detail panel */}
      {selectedDate && (
        <div className="card" style={{ marginTop: '12px' }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>
              <span className="card-icon">📋</span>
              {(() => { const p = selectedDate.split('-').map(Number); return new Date(p[0], p[1]-1, p[2]).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); })()}
              {isPast(selectedDate) && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>(Past)</span>}
            </span>
            <span style={{ fontSize: 13, color: 'var(--role-color)', fontWeight: 600 }}>{hoursMap[selectedDate] || 0} total hours</span>
          </div>

          {/* v1.135.0 — the day's 24 hours, with names */}
          {(() => {
            const segs = dayBarSegments(sessionsByDate, selectedDate, todayStr);
            if (segs.length === 0) return null;
            const req = segs.filter((g) => g.kind === 'requested').reduce((n, g) => n + (g.end - g.start), 0);
            return (
              <div style={{ padding: '10px 0 12px', borderBottom: '1px solid var(--border-color)' }}>
                <DayBar segments={segs} laneHeight={22} gap={3} radius={6} labels />
                <DayBarAxis />
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
                  Covered {dayBarCoveredHours(segs)} of 24 hours{req > 0 ? ` \u00b7 ${Math.round(req * 10) / 10} hours requested` : ''}
                </div>
              </div>
            );
          })()}
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
                      <div style={{ fontWeight: 600, fontSize: 14, color: isPast(selectedDate) ? 'var(--text-tertiary)' : 'var(--text-primary)' }}>
                        {s.scheduled_time || '—'}
                        <span style={{ fontWeight: 400, marginLeft: 8, color: 'var(--text-secondary)' }}>{formatServiceType(s.service_type)}</span>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
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
                      <span style={{ color: 'var(--text-muted)', fontSize: 16 }}>{expandedSession === s.id ? '▾' : '▸'}</span>
                    </div>
                  </div>
                  {expandedSession === s.id && (
                    <div style={{ marginTop: 12, padding: '12px', background: 'var(--bg-neutral)', borderRadius: 8, fontSize: 13 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
                        <div><span style={{ color: 'var(--text-tertiary)' }}>Duration:</span> <strong>{s.duration_hours || 2} hours</strong></div>
                        <div><span style={{ color: 'var(--text-tertiary)' }}>Cost:</span> <strong>{s.estimated_cost ? `$${s.estimated_cost}` : s.actual_cost ? `$${s.actual_cost}` : '—'}</strong>{s.overtime_minutes > 0 && <span style={{ fontSize: 11, color: 'var(--color-warning)', marginLeft: 4 }}>(+{s.overtime_minutes}min OT)</span>}</div>
                        <div><span style={{ color: 'var(--text-tertiary)' }}>Service:</span> <strong>{formatServiceType(s.service_type)}</strong></div>
                        <div><span style={{ color: 'var(--text-tertiary)' }}>Caregiver:</span> <strong>{s.caregiver_name || 'Pending match'}</strong></div>
                      </div>
                      {s.special_instructions && (
                        <div style={{ marginTop: 8, padding: '8px', background: 'var(--bg-surface)', borderRadius: 6, border: '1px solid #eee' }}>
                          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 2 }}>Special Instructions</div>
                          <div>{linkify(s.special_instructions)}</div>
                        </div>
                      )}
                      {s.caregiver_rating > 0 && (
                        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-tertiary)' }}>
                          Caregiver rating: ⭐ {s.caregiver_rating}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
                        <button onClick={(e) => { e.stopPropagation(); setVisitDetailSessionId(s.id); }}
                        style={{ padding: '6px 14px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                          View Full Details
                        </button>
                        {/* v1.105.117 — cancelling used to be possible only from the Dashboard,
                            so anyone who found the session on the calendar had to go somewhere
                            else to call it off. Same statuses the server accepts, and never on a
                            session that has already started or already happened. */}
                        {/* v1.129.2 — Edit request: the booking form, filled in, while nobody has taken it. */}
                        {!isPast(selectedDate) && ['pending', 'open', 'requested'].includes(s.status) && !s.caregiver_id && !s.caregiver_name && (
                          <button onClick={(e) => { e.stopPropagation(); window.__openEditRequest && window.__openEditRequest(s.id); }}
                            style={{ padding: '6px 14px', background: 'var(--bg-surface)', color: 'var(--role-color)', border: '1px solid var(--role-color)', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', marginRight: 8 }}>
                            Edit request
                          </button>
                        )}
                        {!isPast(selectedDate) && ['confirmed', 'pending', 'open', 'requested'].includes(s.status) && (
                          <button onClick={(e) => { e.stopPropagation(); setCancellingSession(s); }}
                            style={{ padding: '6px 14px', background: 'var(--bg-surface)', color: 'var(--color-error)', border: '1px solid var(--color-error)', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {/* Book care button moved above the card */}
            </>
          ) : (
            <div style={{ padding: '24px 16px', textAlign: 'center' }}>
              {isPast(selectedDate) ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No sessions on this date.</p>
              ) : (
                <>
                  <p style={{ fontSize: 14, color: 'var(--text-tertiary)', marginBottom: 14 }}>No care scheduled for this day yet.</p>
                  <button onClick={() => window.__openRequestCareModal && window.__openRequestCareModal(selectedDate)}
                    style={{
                      padding: '12px 28px', background: 'var(--accent-color)', color: 'var(--text-on-primary)', border: 'none',
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
      <div style={{ marginTop: '16px', fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
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
      {cancellingSession && (
        <CancelSessionModal
          sessionId={cancellingSession.id}
          dateISO={(cancellingSession.scheduled_date || '').split('T')[0]}
          time={cancellingSession.scheduled_time}
          timezone={cancellingSession.timezone}
          caregiverName={cancellingSession.caregiver_name}
          recipientName={cancellingSession.recipient_name || 'Care recipient'}
          onClose={() => setCancellingSession(null)}
          onCancelled={() => { setCancellingSession(null); setExpandedSession(null); fetchSessions(); }}
        />
      )}
      {visitDetailSessionId && (
        <VisitDetailModal sessionId={visitDetailSessionId} role="family" onClose={() => setVisitDetailSessionId(null)} />
      )}

    </>
  );
};
