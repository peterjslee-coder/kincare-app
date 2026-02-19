// ─── CaregiverCalendar — Weekly calendar with availability overlay ───
// Green = available, Blue = booked session, Red = blocked, Gray = off
const CaregiverCalendar = window.CaregiverCalendar = ({ caregiverId, sessions, availRules, fetchAvailability, onLogVisit }) => {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(null);
  const [allSessions, setAllSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(true);

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hourStart = 6;
  const hourEnd = 20; // 6am–8pm

  // Compute current week's dates
  const getWeekDates = () => {
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay() + weekOffset * 7);
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + i);
      dates.push(d);
    }
    return dates;
  };

  const weekDates = getWeekDates();
  const weekStart = weekDates[0].toISOString().split('T')[0];
  const weekEnd = weekDates[6].toISOString().split('T')[0];

  // Fetch all sessions (upcoming + past) for this caregiver in the visible range
  useEffect(() => {
    const fetchAll = async () => {
      setLoadingSessions(true);
      try {
        const res = await apiFetch(`/api/sessions?start=${weekStart}&end=${weekEnd}`);
        if (res?.ok) {
          const d = await res.json();
          setAllSessions(d.sessions || []);
        } else {
          // Fall back to dashboard sessions
          setAllSessions(sessions || []);
        }
      } catch {
        setAllSessions(sessions || []);
      }
      setLoadingSessions(false);
    };
    fetchAll();
    if (typeof fetchAvailability === 'function') fetchAvailability();
  }, [weekOffset]);

  // Parse availability rules into per-day time ranges
  const getAvailForDay = (dayOfWeek, dateStr) => {
    const rules = availRules || [];
    const available = [];
    const blocked = [];

    rules.forEach(r => {
      const rDay = parseInt(r.day_of_week ?? r.dayOfWeek);
      const rRecurring = r.is_recurring ?? r.isRecurring;
      const rDate = r.specific_date ?? r.specificDate;
      const rType = r.type || 'available';

      // Match: recurring rule for this day, or specific-date rule for this date
      const matchesDay = rRecurring && rDay === dayOfWeek;
      const matchesDate = !rRecurring && rDate === dateStr;

      if (matchesDay || matchesDate) {
        const startH = parseInt((r.start_time ?? r.startTime).split(':')[0]);
        const startM = parseInt((r.start_time ?? r.startTime).split(':')[1]) || 0;
        const endH = parseInt((r.end_time ?? r.endTime).split(':')[0]);
        const endM = parseInt((r.end_time ?? r.endTime).split(':')[1]) || 0;
        const entry = { startH, startM, endH, endM, note: r.note };
        if (rType === 'blocked') blocked.push(entry);
        else available.push(entry);
      }
    });

    return { available, blocked };
  };

  // Get sessions for a specific date
  const getSessionsForDate = (dateStr) => {
    const all = allSessions.length > 0 ? allSessions : (sessions || []);
    return all.filter(s => {
      const sDate = s.scheduled_date || s.date;
      return sDate === dateStr;
    });
  };

  // Format date as "Mon 19"
  const formatDateShort = (d) => {
    return `${dayNames[d.getDay()]} ${d.getDate()}`;
  };

  const formatMonth = () => {
    const m1 = weekDates[0].toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    const m2 = weekDates[6].toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    return m1 === m2 ? m1 : `${weekDates[0].toLocaleDateString(undefined, { month: 'short' })} – ${m2}`;
  };

  const isToday = (d) => {
    const today = new Date();
    return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  };

  // Build hour-by-hour cell data for a given date
  const getCellType = (dateStr, dayOfWeek, hour) => {
    const { available, blocked } = getAvailForDay(dayOfWeek, dateStr);
    const daySessions = getSessionsForDate(dateStr);

    // Check if this hour falls within a booked session
    for (const s of daySessions) {
      const sTime = s.scheduled_time || s.time || '';
      const sHour = parseInt(sTime.split(':')[0]);
      const sDuration = parseFloat(s.duration_hours || s.durationHours || 1);
      if (hour >= sHour && hour < sHour + sDuration) {
        return { type: 'booked', session: s };
      }
    }

    // Check blocked
    for (const b of blocked) {
      if (hour >= b.startH && hour < b.endH) {
        return { type: 'blocked', note: b.note };
      }
    }

    // Check available
    for (const a of available) {
      if (hour >= a.startH && hour < a.endH) {
        return { type: 'available' };
      }
    }

    return { type: 'off' };
  };

  const cellColors = {
    available: { bg: '#e8f5e9', border: '#a5d6a7' },
    booked: { bg: '#e3f2fd', border: '#90caf9' },
    blocked: { bg: '#fce4ec', border: '#ef9a9a' },
    off: { bg: '#fafafa', border: '#f0f0f0' },
  };

  // Selected day details
  const selectedDateStr = selectedDay ? selectedDay.toISOString().split('T')[0] : null;
  const selectedSessions = selectedDateStr ? getSessionsForDate(selectedDateStr) : [];
  const selectedAvail = selectedDay ? getAvailForDay(selectedDay.getDay(), selectedDateStr) : { available: [], blocked: [] };

  const formatTime12 = (h, m) => {
    const ampm = h >= 12 ? 'PM' : 'AM';
    const dh = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return m ? `${dh}:${String(m).padStart(2, '0')} ${ampm}` : `${dh} ${ampm}`;
  };

  return (
    <div>
      {/* Week navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <button onClick={() => setWeekOffset(w => w - 1)} style={{ background: 'none', border: '1px solid #e0e0e0', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 14 }}>← Prev</button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a2e' }}>{formatMonth()}</div>
          {weekOffset !== 0 && (
            <button onClick={() => setWeekOffset(0)} style={{ background: 'none', border: 'none', color: '#1b6b5a', fontSize: 12, cursor: 'pointer', fontWeight: 600, marginTop: 2 }}>Today</button>
          )}
        </div>
        <button onClick={() => setWeekOffset(w => w + 1)} style={{ background: 'none', border: '1px solid #e0e0e0', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 14 }}>Next →</button>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 11, color: '#666' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: cellColors.available.bg, border: `1px solid ${cellColors.available.border}`, display: 'inline-block' }}></span> Available</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: cellColors.booked.bg, border: `1px solid ${cellColors.booked.border}`, display: 'inline-block' }}></span> Booked</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: cellColors.blocked.bg, border: `1px solid ${cellColors.blocked.border}`, display: 'inline-block' }}></span> Blocked</span>
      </div>

      {/* Calendar Grid */}
      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th style={{ width: 44, padding: '8px 4px', borderBottom: '2px solid #e0e0e0', background: '#fafafa', position: 'sticky', left: 0, zIndex: 1 }}></th>
              {weekDates.map((d, i) => {
                const today = isToday(d);
                return (
                  <th key={i} onClick={() => setSelectedDay(d)}
                    style={{ padding: '8px 2px', borderBottom: '2px solid #e0e0e0', textAlign: 'center', cursor: 'pointer', background: today ? '#e8f5e9' : selectedDay && d.toDateString() === selectedDay.toDateString() ? '#f0f4ff' : '#fafafa' }}>
                    <div style={{ fontWeight: 600, color: today ? '#1b6b5a' : '#555' }}>{dayNames[d.getDay()]}</div>
                    <div style={{ fontSize: 13, fontWeight: today ? 800 : 600, color: today ? '#1b6b5a' : '#333', background: today ? '#1b6b5a' : 'transparent', color: today ? '#fff' : '#333', borderRadius: '50%', width: 24, height: 24, lineHeight: '24px', margin: '2px auto 0', display: 'inline-block' }}>{d.getDate()}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: hourEnd - hourStart }, (_, hi) => {
              const hour = hourStart + hi;
              return (
                <tr key={hour}>
                  <td style={{ padding: '0 4px', fontSize: 10, color: '#999', textAlign: 'right', borderRight: '1px solid #e8e8e8', background: '#fafafa', position: 'sticky', left: 0, zIndex: 1, height: 28 }}>
                    {hour <= 12 ? hour : hour - 12}{hour < 12 ? 'a' : 'p'}
                  </td>
                  {weekDates.map((d, di) => {
                    const dateStr = d.toISOString().split('T')[0];
                    const cell = getCellType(dateStr, d.getDay(), hour);
                    const colors = cellColors[cell.type];
                    // Merge consecutive booked cells visually
                    return (
                      <td key={di}
                        onClick={() => setSelectedDay(d)}
                        title={cell.type === 'booked' ? `${cell.session.recipientName || cell.session.recipient_name || ''} — ${cell.session.serviceType || cell.session.service_type || ''}` : cell.type === 'blocked' ? `Blocked${cell.note ? ': ' + cell.note : ''}` : cell.type}
                        style={{
                          background: colors.bg,
                          borderBottom: '1px solid #f0f0f0',
                          borderRight: '1px solid #f5f5f5',
                          cursor: 'pointer',
                          height: 28,
                          position: 'relative',
                          transition: 'opacity 0.1s',
                        }}>
                        {cell.type === 'booked' && (
                          <div style={{ position: 'absolute', inset: 1, background: '#42a5f5', borderRadius: 3, opacity: 0.7 }}></div>
                        )}
                        {cell.type === 'blocked' && (
                          <div style={{ position: 'absolute', inset: 1, background: '#ef5350', borderRadius: 3, opacity: 0.25 }}></div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Selected Day Details */}
      {selectedDay && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <span className="card-icon">📋</span>
            {selectedDay.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>

          {/* Availability summary */}
          {selectedAvail.available.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#2e7d32', marginBottom: 4 }}>Available</div>
              {selectedAvail.available.map((a, i) => (
                <div key={i} style={{ fontSize: 13, color: '#555', padding: '2px 0' }}>
                  {formatTime12(a.startH, a.startM)} – {formatTime12(a.endH, a.endM)}
                </div>
              ))}
            </div>
          )}
          {selectedAvail.blocked.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#c62828', marginBottom: 4 }}>Blocked</div>
              {selectedAvail.blocked.map((b, i) => (
                <div key={i} style={{ fontSize: 13, color: '#555', padding: '2px 0' }}>
                  {formatTime12(b.startH, b.startM)} – {formatTime12(b.endH, b.endM)}
                  {b.note && <span style={{ color: '#999', marginLeft: 6 }}>({b.note})</span>}
                </div>
              ))}
            </div>
          )}
          {selectedAvail.available.length === 0 && selectedAvail.blocked.length === 0 && (
            <div style={{ fontSize: 13, color: '#999', marginBottom: 12 }}>No availability rules for this day</div>
          )}

          {/* Sessions */}
          {selectedSessions.length > 0 ? (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#1565c0', marginBottom: 8 }}>Booked Sessions</div>
              {selectedSessions.map((s, idx) => (
                <div key={idx} style={{ padding: '10px 12px', background: '#e3f2fd', borderRadius: 8, marginBottom: 8, borderLeft: '3px solid #42a5f5' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: '#1a1a2e' }}>
                        {s.recipientName || s.recipient_name || 'Client'}
                      </div>
                      <div style={{ fontSize: 12, color: '#666' }}>
                        {s.time || s.scheduled_time} · {s.durationHours || s.duration_hours}h · {s.serviceType || s.service_type}
                      </div>
                      {(s.specialInstructions || s.special_instructions) && (
                        <div style={{ fontSize: 11, color: '#888', fontStyle: 'italic', marginTop: 4 }}>
                          {s.specialInstructions || s.special_instructions}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                      <span style={{
                        padding: '3px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                        background: s.status === 'confirmed' ? '#e8f5e9' : s.status === 'completed' ? '#e0e0e0' : '#fff3e0',
                        color: s.status === 'confirmed' ? '#2e7d32' : s.status === 'completed' ? '#666' : '#e65100',
                        textTransform: 'capitalize',
                      }}>{s.status}</span>
                      <span style={{ fontSize: 11, color: '#666' }}>${s.estimatedCost || s.estimated_cost || s.actual_cost}</span>
                      {s.status === 'confirmed' && onLogVisit && (
                        <button onClick={() => onLogVisit(s)} style={{
                          padding: '3px 8px', background: '#1b6b5a', color: '#fff', border: 'none',
                          borderRadius: 4, fontSize: 10, cursor: 'pointer', fontWeight: 600,
                        }}>Log Visit</button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: '#999' }}>No sessions booked this day</div>
          )}
        </div>
      )}
    </div>
  );
};
