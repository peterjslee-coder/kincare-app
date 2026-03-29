/**
 * AvailabilityTab — Month calendar view with availability management
 * Shows a month grid with day cells colored by availability/bookings.
 * Click a day to see/edit availability rules and view booked sessions.
 */
const AvailabilityTab = window.AvailabilityTab = ({
  rules, loading, fetchAvailability,
  showAddRule, setShowAddRule,
  editingRule, setEditingRule,
  ruleForm, setRuleForm,
  handleSaveRule, handleDeleteRule, startEditRule,
  dayNames, dayAbbr,
}) => {

  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selectedDate, setSelectedDate] = useState(null);
  const [monthSessions, setMonthSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  // Drag-to-select state
  const [dragStart, setDragStart] = useState(null);
  const [dragEnd, setDragEnd] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  const isInDragRange = (day) => {
    if (!isDragging || dragStart === null || dragEnd === null) return false;
    const lo = Math.min(dragStart, dragEnd);
    const hi = Math.max(dragStart, dragEnd);
    return day >= lo && day <= hi;
  };

  const endDrag = (finalDay) => {
    if (!isDragging || dragStart === null) { setIsDragging(false); setDragStart(null); setDragEnd(null); return; }
    const lo = Math.min(dragStart, finalDay != null ? finalDay : dragStart);
    const hi = Math.max(dragStart, finalDay != null ? finalDay : dragStart);
    setIsDragging(false);
    if (lo === hi) {
      // Single click — toggle existing day selection
      setSelectedDate(lo === selectedDate ? null : lo);
    } else {
      // Multi-day drag — open modal for batch creation
      setSelectedDate(null);
      setEditingRule(null);
      const dates = [];
      for (let d = lo; d <= hi; d++) dates.push(d);
      setRuleForm({
        type: 'available', dayOfWeek: 1,
        startTime: '08:00', endTime: '17:00',
        isRecurring: false, specificDate: '', note: '',
        _batchDays: dates, _batchMonth: { year, month },
      });
      setShowAddRule(true);
    }
    setDragStart(null);
    setDragEnd(null);
  };

  useEffect(() => { fetchAvailability(); }, []);

  // Fetch sessions for visible month
  useEffect(() => {
    const fetchMonthSessions = async () => {
      setSessionsLoading(true);
      try {
        const { year, month } = currentMonth;
        const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
        const lastDay = new Date(year, month + 1, 0).getDate();
        const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        const res = await apiFetch(`/api/sessions?from=${from}&to=${to}&limit=100`);
        if (res?.ok) {
          const d = await res.json();
          setMonthSessions(d.sessions || []);
        }
      } catch (err) { console.error('Session fetch error:', err); }
      setSessionsLoading(false);
    };
    fetchMonthSessions();
  }, [currentMonth]);

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  const getDaysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
  const getFirstDayOfWeek = (y, m) => new Date(y, m, 1).getDay();

  const prevMonth = () => {
    setCurrentMonth(p => p.month === 0 ? { year: p.year - 1, month: 11 } : { year: p.year, month: p.month - 1 });
    setSelectedDate(null);
  };
  const nextMonth = () => {
    setCurrentMonth(p => p.month === 11 ? { year: p.year + 1, month: 0 } : { year: p.year, month: p.month + 1 });
    setSelectedDate(null);
  };

  const formatTime = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':');
    const hr = parseInt(h);
    const ampm = hr >= 12 ? 'PM' : 'AM';
    const hr12 = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr;
    return `${hr12}:${m} ${ampm}`;
  };

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const { year, month } = currentMonth;
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);

  // Build sessions-by-date map
  const sessionsByDate = {};
  monthSessions.forEach(s => {
    const d = s.scheduled_date;
    if (!sessionsByDate[d]) sessionsByDate[d] = [];
    sessionsByDate[d].push(s);
  });

  // Get availability info for a specific date
  const getAvailForDate = (dateStr) => {
    const d = new Date(dateStr + 'T12:00:00');
    const dow = d.getDay();
    const recurring = rules.filter(r => r.isRecurring && r.dayOfWeek === dow);
    const specific = rules.filter(r => !r.isRecurring && r.specificDate === dateStr);
    const available = [...recurring, ...specific].filter(r => r.type === 'available');
    const blocked = [...recurring, ...specific].filter(r => r.type === 'blocked');
    return { available, blocked, all: [...recurring, ...specific] };
  };

  // Calculate total available hours for a date
  const getAvailHours = (avail) => {
    let totalMins = 0;
    avail.forEach(r => {
      const [sh, sm] = r.startTime.split(':').map(Number);
      const [eh, em] = r.endTime.split(':').map(Number);
      totalMins += (eh * 60 + em) - (sh * 60 + sm);
    });
    return totalMins / 60;
  };

  // Build cells
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  // Selected date info
  const selectedDateStr = selectedDate ? `${year}-${String(month + 1).padStart(2, '0')}-${String(selectedDate).padStart(2, '0')}` : null;
  const selectedAvail = selectedDateStr ? getAvailForDate(selectedDateStr) : null;
  const selectedSessions = selectedDateStr ? (sessionsByDate[selectedDateStr] || []) : [];

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>My Availability</h3>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>Click a day to view details, or drag across days to set availability in bulk</p>
        </div>
        <button onClick={() => {
          setEditingRule(null);
          setRuleForm({ type: 'available', dayOfWeek: 1, startTime: '08:00', endTime: '17:00', isRecurring: true, specificDate: '', note: '' });
          setShowAddRule(true);
        }} style={{
          padding: '8px 16px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none',
          borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
        }}>+ Add Rule</button>
      </div>

      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading availability...</div>
      ) : (
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          {/* Month Calendar */}
          <div className="card" style={{ flex: '1 1 400px', minWidth: '320px' }}>
            {/* Month Nav */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 0 12px' }}>
              <button onClick={prevMonth} style={{ background: 'none', border: '1px solid #ddd', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '14px' }}>‹</button>
              <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--text-primary)' }}>{monthNames[month]} {year}</h3>
              <button onClick={nextMonth} style={{ background: 'none', border: '1px solid #ddd', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '14px' }}>›</button>
            </div>

            {/* Day headers */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '4px' }}>
              {dayAbbr.map(d => (
                <div key={d} style={{ textAlign: 'center', fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', padding: '4px 0' }}>{d}</div>
              ))}
            </div>

            {/* Calendar grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', userSelect: 'none' }}
              onMouseLeave={() => { if (isDragging) endDrag(dragEnd); }}
              onMouseUp={() => { if (isDragging) endDrag(dragEnd); }}
            >
              {cells.map((day, idx) => {
                if (day === null) return <div key={`e${idx}`} style={{ minHeight: '54px' }}></div>;
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const isToday = dateStr === todayStr;
                const isSelected = day === selectedDate;
                const inDrag = isInDragRange(day);
                const daySessions = sessionsByDate[dateStr] || [];
                const avail = getAvailForDate(dateStr);
                const availHrs = getAvailHours(avail.available);
                const bookedHrs = daySessions.reduce((s, sess) => s + (sess.duration_hours || 0), 0);
                const hasBlocked = avail.blocked.length > 0;
                const hasRequested = daySessions.some(s => s.status === 'requested');

                // Color logic
                let bg = 'var(--bg-primary)';
                let borderColor = 'var(--badge-muted-bg)';
                if (bookedHrs > 0) {
                  const pct = Math.min(20 + bookedHrs * 8, 60);
                  bg = `hsl(210, 60%, ${100 - pct}%)`;
                  borderColor = '#90caf9';
                } else if (availHrs > 0) {
                  const pct = Math.min(15 + availHrs * 3, 45);
                  bg = `hsl(145, 50%, ${100 - pct}%)`;
                  borderColor = 'var(--color-success-bg)';
                }
                if (hasBlocked && !bookedHrs) {
                  borderColor = '#ef9a9a';
                }

                return (
                  <div key={day}
                    onMouseDown={(e) => { e.preventDefault(); setDragStart(day); setDragEnd(day); setIsDragging(true); setSelectedDate(null); }}
                    onMouseEnter={() => { if (isDragging) setDragEnd(day); }}
                    onMouseUp={() => { if (isDragging) endDrag(day); }}
                    style={{
                    minHeight: '54px', padding: '4px', borderRadius: '6px', cursor: 'pointer',
                    background: inDrag ? 'var(--bg-teal-light)' : isSelected ? 'var(--bg-teal-light)' : bg,
                    border: inDrag ? '2px solid #1b6b5a' : isSelected ? '2px solid #1b6b5a' : isToday ? '2px solid #e8724a' : `1px solid ${borderColor}`,
                    transition: 'all 0.15s', position: 'relative',
                  }}>
                    <div style={{ fontSize: '12px', fontWeight: isToday ? 700 : 500, color: isToday ? 'var(--accent-color)' : 'var(--text-primary)' }}>{day}</div>
                    <div style={{ display: 'flex', gap: '2px', marginTop: '2px', flexWrap: 'wrap' }}>
                      {bookedHrs > 0 && (
                        <span style={{ fontSize: '9px', background: 'var(--color-info-bg)', color: 'var(--color-info)', padding: '1px 4px', borderRadius: '3px', fontWeight: 600 }}>
                          {bookedHrs}h
                        </span>
                      )}
                      {availHrs > 0 && !bookedHrs && (
                        <span style={{ fontSize: '9px', background: 'var(--color-success-bg)', color: 'var(--color-success)', padding: '1px 4px', borderRadius: '3px' }}>
                          {availHrs}h avail
                        </span>
                      )}
                      {hasRequested && (
                        <span style={{ fontSize: '9px', background: 'var(--color-error-bg)', color: 'var(--color-error)', padding: '1px 4px', borderRadius: '3px' }}>req</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div style={{ display: 'flex', gap: '14px', marginTop: '12px', fontSize: '11px', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
              <span><span style={{ display: 'inline-block', width: '10px', height: '10px', background: 'var(--color-success-bg)', borderRadius: '2px', verticalAlign: 'middle', marginRight: '3px' }}></span>Available</span>
              <span><span style={{ display: 'inline-block', width: '10px', height: '10px', background: '#bbdefb', borderRadius: '2px', verticalAlign: 'middle', marginRight: '3px' }}></span>Booked</span>
              <span><span style={{ display: 'inline-block', width: '10px', height: '10px', background: 'var(--color-error-bg)', borderRadius: '2px', verticalAlign: 'middle', marginRight: '3px', border: '1px solid #ef9a9a' }}></span>Request</span>
            </div>
          </div>

          {/* Day Detail Panel */}
          {selectedDate && selectedAvail && (
            <div style={{ flex: '1 1 300px', minWidth: '280px' }}>
              <div className="card" style={{ marginBottom: '12px' }}>
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>
                    <span className="card-icon">📅</span>
                    {new Date(selectedDateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                  </span>
                  <button onClick={() => setSelectedDate(null)} style={{
                    background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: 'var(--text-muted)',
                  }}>×</button>
                </div>

                {/* Sessions for this day */}
                {selectedSessions.length > 0 && (
                  <div style={{ marginBottom: '14px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px', textTransform: 'uppercase' }}>Booked Sessions</div>
                    {selectedSessions.map(s => (
                      <div key={s.id} style={{
                        padding: '8px 12px', background: s.status === 'requested' ? 'var(--color-error-bg)' : 'var(--color-info-bg)',
                        borderRadius: '6px', marginBottom: '6px', fontSize: '13px',
                      }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {s.recipient_name || 'Client'} — {(s.service_type || '').replace(/_/g, ' ')}
                        </div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
                          {formatTime(s.scheduled_time)} &bull; {s.duration_hours}h &bull;
                          <span style={{
                            marginLeft: '4px', padding: '1px 6px', borderRadius: '8px', fontSize: '10px', fontWeight: 600,
                            background: s.status === 'confirmed' ? 'var(--role-color-light)' : s.status === 'requested' ? 'var(--color-warning-bg)' : 'var(--bg-primary)',
                            color: s.status === 'confirmed' ? 'var(--role-color)' : s.status === 'requested' ? 'var(--color-warning)' : 'var(--text-tertiary)',
                          }}>{s.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Availability rules for this day */}
                <div style={{ marginBottom: '14px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px', textTransform: 'uppercase' }}>Availability Rules</div>
                  {selectedAvail.all.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '8px 0' }}>No rules set for this day</div>
                  ) : (
                    selectedAvail.all.map(rule => (
                      <div key={rule.id} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '8px 10px', background: rule.type === 'available' ? 'var(--bg-highlight)' : 'var(--bg-error-subtle)',
                        borderRadius: '6px', marginBottom: '4px',
                        borderLeft: `3px solid ${rule.type === 'available' ? 'var(--role-color)' : 'var(--color-error)'}`,
                      }}>
                        <div style={{ fontSize: '12px' }}>
                          <span style={{ fontWeight: 600 }}>{formatTime(rule.startTime)} – {formatTime(rule.endTime)}</span>
                          <span style={{ color: 'var(--text-tertiary)', marginLeft: '6px' }}>
                            {rule.type === 'available' ? '✅' : '🚫'}
                            {rule.isRecurring ? ' (weekly)' : ' (one-time)'}
                          </span>
                          {rule.note && <div style={{ color: 'var(--text-secondary)', fontSize: '11px', marginTop: '2px' }}>{rule.note}</div>}
                        </div>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button onClick={() => startEditRule(rule)} style={{
                            padding: '3px 8px', background: 'var(--bg-surface)', border: '1px solid #ddd', borderRadius: '4px',
                            cursor: 'pointer', fontSize: '10px',
                          }}>Edit</button>
                          <button onClick={() => handleDeleteRule(rule.id)} style={{
                            padding: '3px 8px', background: 'var(--bg-surface)', border: '1px solid #fca5a5', borderRadius: '4px',
                            cursor: 'pointer', fontSize: '10px', color: 'var(--color-error)',
                          }}>×</button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Quick add availability for this day */}
                <button onClick={() => {
                  const d = new Date(selectedDateStr + 'T12:00:00');
                  setEditingRule(null);
                  setRuleForm({
                    type: 'available', dayOfWeek: d.getDay(),
                    startTime: '08:00', endTime: '17:00',
                    isRecurring: false, specificDate: selectedDateStr, note: '',
                  });
                  setShowAddRule(true);
                }} style={{
                  width: '100%', padding: '10px', background: 'var(--bg-primary)', border: '1px dashed #ccc',
                  borderRadius: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-secondary)',
                }}>
                  + Add availability for this day
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add/Edit Rule Modal */}
      {showAddRule && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: 'var(--bg-surface)', borderRadius: '12px', padding: '24px', width: '420px', maxWidth: '90vw',
          }}>
            <h3 style={{ marginTop: 0 }}>{editingRule ? 'Edit Rule' : ruleForm._batchDays ? `Set Availability for ${ruleForm._batchDays.length} Days` : 'Add Availability Rule'}</h3>
            {ruleForm._batchDays && (
              <div style={{ marginBottom: '12px', padding: '8px 12px', background: 'var(--bg-highlight)', borderRadius: '8px', fontSize: '13px', color: 'var(--role-color)' }}>
                {ruleForm._batchDays.map(d => {
                  const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                  return new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                }).join(', ')}
              </div>
            )}

            {/* Rule Type */}
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Type</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {['available', 'blocked'].map(t => (
                  <button key={t} onClick={() => setRuleForm(f => ({ ...f, type: t }))} style={{
                    flex: 1, padding: '8px', border: ruleForm.type === t ? '2px solid #1b6b5a' : '2px solid #ddd',
                    borderRadius: '8px', background: ruleForm.type === t ? (t === 'available' ? 'var(--bg-highlight)' : 'var(--bg-error-subtle)') : 'var(--text-on-primary)',
                    cursor: 'pointer', fontSize: '13px', fontWeight: ruleForm.type === t ? 600 : 400,
                  }}>{t === 'available' ? '✅ Available' : '🚫 Blocked'}</button>
                ))}
              </div>
            </div>

            {/* Recurring vs One-off — hidden in batch mode */}
            {!ruleForm._batchDays && (
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Frequency</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {[true, false].map(rec => (
                  <button key={String(rec)} onClick={() => setRuleForm(f => ({ ...f, isRecurring: rec }))} style={{
                    flex: 1, padding: '8px', border: ruleForm.isRecurring === rec ? '2px solid #1b6b5a' : '2px solid #ddd',
                    borderRadius: '8px', background: ruleForm.isRecurring === rec ? 'var(--bg-highlight)' : 'var(--text-on-primary)',
                    cursor: 'pointer', fontSize: '13px', fontWeight: ruleForm.isRecurring === rec ? 600 : 400,
                  }}>{rec ? '🔄 Every Week' : '📌 Specific Date'}</button>
                ))}
              </div>
            </div>
            )}

            {/* Day or Date — hidden in batch mode */}
            {!ruleForm._batchDays && ruleForm.isRecurring && (
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                  {editingRule ? 'Day of Week' : 'Days of Week (select multiple)'}
                </label>
                {editingRule ? (
                  <select value={ruleForm.dayOfWeek} onChange={e => setRuleForm(f => ({ ...f, dayOfWeek: e.target.value }))} style={{
                    width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '13px',
                  }}>
                    {dayNames.map((name, idx) => (
                      <option key={idx} value={idx}>{name}</option>
                    ))}
                  </select>
                ) : (
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {dayNames.map((name, idx) => {
                      const sel = (ruleForm.selectedDays || []).includes(idx);
                      return (
                        <button key={idx} type="button" onClick={() => {
                          setRuleForm(f => {
                            const days = f.selectedDays || [];
                            return { ...f, selectedDays: sel ? days.filter(d => d !== idx) : [...days, idx] };
                          });
                        }} style={{
                          padding: '8px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: sel ? 600 : 400,
                          border: sel ? '2px solid #1b6b5a' : '2px solid #ddd',
                          background: sel ? 'var(--bg-highlight)' : 'var(--text-on-primary)', cursor: 'pointer',
                          color: sel ? 'var(--role-color)' : 'var(--text-secondary)',
                        }}>{dayAbbr[idx]}</button>
                      );
                    })}
                    <button type="button" onClick={() => setRuleForm(f => ({ ...f, selectedDays: [1,2,3,4,5] }))} style={{
                      padding: '8px 12px', borderRadius: '8px', fontSize: '11px', fontWeight: 500,
                      border: '1px solid #ddd', background: 'var(--bg-primary)', cursor: 'pointer', color: 'var(--text-secondary)',
                    }}>Weekdays</button>
                    <button type="button" onClick={() => setRuleForm(f => ({ ...f, selectedDays: [0,6] }))} style={{
                      padding: '8px 12px', borderRadius: '8px', fontSize: '11px', fontWeight: 500,
                      border: '1px solid #ddd', background: 'var(--bg-primary)', cursor: 'pointer', color: 'var(--text-secondary)',
                    }}>Weekends</button>
                  </div>
                )}
              </div>
            )}
            {!ruleForm._batchDays && !ruleForm.isRecurring && (
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Date</label>
                <input type="date" value={ruleForm.specificDate}
                  onChange={e => {
                    const d = new Date(e.target.value + 'T12:00:00');
                    setRuleForm(f => ({ ...f, specificDate: e.target.value, dayOfWeek: d.getDay() }));
                  }}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '13px' }}
                />
              </div>
            )}

            {/* Time Range */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Start Time</label>
                <input type="time" value={ruleForm.startTime}
                  onChange={e => setRuleForm(f => ({ ...f, startTime: e.target.value }))}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '13px' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>End Time</label>
                <input type="time" value={ruleForm.endTime}
                  onChange={e => setRuleForm(f => ({ ...f, endTime: e.target.value }))}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '13px' }}
                />
              </div>
            </div>

            {/* Note */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Note (optional)</label>
              <input type="text" value={ruleForm.note} placeholder="e.g., Doctor appointment, personal time"
                onChange={e => setRuleForm(f => ({ ...f, note: e.target.value }))}
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '13px' }}
              />
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowAddRule(false); setEditingRule(null); }} style={{
                padding: '10px 20px', border: '1px solid #ddd', background: 'var(--bg-surface)', borderRadius: '8px',
                cursor: 'pointer', fontSize: '13px',
              }}>Cancel</button>
              <button onClick={handleSaveRule} style={{
                padding: '10px 20px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none',
                borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
              }}>{editingRule ? 'Update Rule' : 'Add Rule'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
