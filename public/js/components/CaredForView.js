// ─── CaredForView — Month calendar for care recipients (Betty's view) ───
// Pink = seeking help (requested), Blue = confirmed/booked
const CaredForView = window.CaredForView = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState([]);
  const [activeTab, setActiveTab] = useState('calendar');
  const [newNote, setNewNote] = useState('');
  const [editingNote, setEditingNote] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(null);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [requestForm, setRequestForm] = useState({ serviceType: 'companion', hours: 2, time: '10:00', note: '' });
  const [submitting, setSubmitting] = useState(false);

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
    if (dayNum < 1 || dayNum > daysInMonth) {
      calendarCells.push(null);
    } else {
      calendarCells.push(dayNum);
    }
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

  // Fetch sessions for the visible month
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

  // Group sessions by date
  const sessionsByDate = {};
  sessions.forEach(s => {
    const d = s.scheduled_date || s.date;
    if (!d) return;
    const dateKey = d.substring(0, 10);
    if (!sessionsByDate[dateKey]) sessionsByDate[dateKey] = [];
    sessionsByDate[dateKey].push(s);
  });

  const getDateStr = (day) => {
    return `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  const isToday = (day) => {
    return day && viewYear === today.getFullYear() && viewMonth === today.getMonth() && day === today.getDate();
  };

  const getDaySessions = (day) => {
    if (!day) return [];
    return sessionsByDate[getDateStr(day)] || [];
  };

  // Count by status for badge display
  const getDayCounts = (day) => {
    const ds = getDaySessions(day);
    let requested = 0, confirmed = 0;
    ds.forEach(s => {
      if (s.status === 'requested') requested++;
      else if (s.status === 'confirmed' || s.status === 'completed') confirmed++;
    });
    return { requested, confirmed };
  };

  // Care request submission
  const handleRequestCare = async () => {
    if (!selectedDay) return;
    setSubmitting(true);
    try {
      const dateStr = getDateStr(selectedDay);
      const res = await apiFetch('/api/sessions/request', {
        method: 'POST',
        body: JSON.stringify({
          scheduledDate: dateStr,
          scheduledTime: requestForm.time,
          serviceType: requestForm.serviceType,
          durationHours: parseFloat(requestForm.hours),
          specialInstructions: requestForm.note || '',
        }),
      });
      if (res?.ok) {
        setShowRequestForm(false);
        setRequestForm({ serviceType: 'companion', hours: 2, time: '10:00', note: '' });
        await fetchSessions();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Failed to create care request');
      }
    } catch (err) {
      console.error('Request care error:', err);
      alert('Failed to create care request');
    }
    setSubmitting(false);
  };

  // Notes handlers (preserved from original)
  const handleAddNote = async () => {
    if (!newNote.trim() || !data?.careRecipientId) return;
    setSaving(true);
    try {
      const res = await apiFetch('/api/notes', {
        method: 'POST',
        body: JSON.stringify({ careRecipientId: data.careRecipientId, content: newNote, noteType: 'personal' }),
      });
      if (res?.ok) {
        setNewNote('');
        await fetchData();
      }
    } catch (err) {
      console.error('Add note error:', err);
    }
    setSaving(false);
  };

  const handleEditNote = async (noteId) => {
    if (!editContent.trim()) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/notes/${noteId}`, {
        method: 'PUT',
        body: JSON.stringify({ content: editContent }),
      });
      if (res?.ok) {
        setEditingNote(null);
        setEditContent('');
        await fetchData();
      }
    } catch (err) {
      console.error('Edit note error:', err);
    }
    setSaving(false);
  };

  const handleDeleteNote = async (noteId) => {
    try {
      const res = await apiFetch(`/api/notes/${noteId}`, { method: 'DELETE' });
      if (res?.ok) await fetchData();
    } catch (err) {
      console.error('Delete note error:', err);
    }
  };

  if (loading) return <LoadingSpinner text="Loading your view..." />;
  if (!data) return <EmptyState icon="⚠️" title="Couldn't load your page" text="Please try refreshing." />;

  const notes = data.notes || [];
  const userName = data.userName || 'Guest';

  const selectedDaySessions = selectedDay ? getDaySessions(selectedDay) : [];
  const selectedDateLabel = selectedDay
    ? new Date(viewYear, viewMonth, selectedDay).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    : '';

  const serviceTypes = [
    { value: 'companion', label: 'Companionship' },
    { value: 'meals', label: 'Meal Prep' },
    { value: 'rides', label: 'Rides / Transport' },
    { value: 'errands', label: 'Errands' },
    { value: 'personal_care', label: 'Personal Care' },
    { value: 'medication', label: 'Medication Reminder' },
    { value: 'light_housekeeping', label: 'Light Housekeeping' },
  ];

  const noteTypeColors = {
    personal: { bg: '#e3f2fd', color: '#1565c0', label: 'Personal' },
    health: { bg: '#fce4ec', color: '#c62828', label: 'Health' },
    general: { bg: '#f3e5f5', color: '#7b1fa2', label: 'General' },
    family: { bg: '#e8f5e9', color: '#2e7d32', label: 'Family' },
  };

  const formatTime12 = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const dh = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${dh}:${String(m || 0).padStart(2, '0')} ${ampm}`;
  };

  return (
    <div>
      <h1 className="greeting" style={{ marginBottom: '4px' }}>Hello, {userName}!</h1>
      <p style={{ color: '#666', fontSize: '14px', marginBottom: '20px' }}>Here's what's coming up for you</p>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', borderBottom: '2px solid #e0e0e0' }}>
        {[
          { id: 'calendar', label: 'My Calendar', icon: '📅' },
          { id: 'notes', label: 'My Notes', icon: '📝' },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: '13px', fontWeight: activeTab === tab.id ? 700 : 400,
            color: activeTab === tab.id ? '#1b6b5a' : '#888',
            borderBottom: activeTab === tab.id ? '3px solid #1b6b5a' : '3px solid transparent',
            marginBottom: '-2px',
          }}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'calendar' && (
        <div>
          {/* Month nav */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <button onClick={() => { setMonthOffset(m => m - 1); setSelectedDay(null); }} style={{ background: 'none', border: '1px solid #e0e0e0', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 14 }}>← Prev</button>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a2e' }}>{monthName}</div>
              {monthOffset !== 0 && (
                <button onClick={() => { setMonthOffset(0); setSelectedDay(null); }} style={{ background: 'none', border: 'none', color: '#1b6b5a', fontSize: 12, cursor: 'pointer', fontWeight: 600, marginTop: 2 }}>Today</button>
              )}
            </div>
            <button onClick={() => { setMonthOffset(m => m + 1); setSelectedDay(null); }} style={{ background: 'none', border: '1px solid #e0e0e0', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 14 }}>Next →</button>
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 11, color: '#666' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: '#fce4ec', border: '1px solid #f48fb1', display: 'inline-block' }}></span> Seeking Help
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: '#e3f2fd', border: '1px solid #90caf9', display: 'inline-block' }}></span> Confirmed
            </span>
          </div>

          {/* Month calendar grid */}
          <div className="card" style={{ padding: 8 }}>
            {/* Day headers */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: '#999', padding: '4px 0' }}>{d}</div>
              ))}
            </div>

            {/* Day cells */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
              {calendarCells.map((day, i) => {
                if (day === null) {
                  return <div key={i} style={{ minHeight: 60, background: '#fafafa', borderRadius: 4 }}></div>;
                }
                const counts = getDayCounts(day);
                const isTodayCell = isToday(day);
                const isSelected = selectedDay === day;
                const hasRequested = counts.requested > 0;
                const hasConfirmed = counts.confirmed > 0;

                // Determine cell background
                let cellBg = '#fff';
                if (hasRequested && hasConfirmed) cellBg = 'linear-gradient(135deg, #fce4ec 50%, #e3f2fd 50%)';
                else if (hasRequested) cellBg = '#fce4ec';
                else if (hasConfirmed) cellBg = '#e3f2fd';

                return (
                  <div key={i}
                    onClick={() => { setSelectedDay(day); setShowRequestForm(false); }}
                    style={{
                      minHeight: 60,
                      background: hasRequested && hasConfirmed ? undefined : cellBg,
                      backgroundImage: hasRequested && hasConfirmed ? cellBg : undefined,
                      borderRadius: 6,
                      padding: '4px 6px',
                      cursor: 'pointer',
                      border: isSelected ? '2px solid #1b6b5a' : isTodayCell ? '2px solid #e8724a' : '1px solid #f0f0f0',
                      position: 'relative',
                      transition: 'border 0.15s',
                    }}>
                    <div style={{
                      fontSize: 13,
                      fontWeight: isTodayCell ? 800 : 600,
                      color: isTodayCell ? '#e8724a' : '#333',
                      marginBottom: 2,
                    }}>
                      {day}
                    </div>
                    {/* Badges */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {hasRequested && (
                        <div style={{ fontSize: 9, fontWeight: 600, color: '#c62828', background: '#fff', borderRadius: 8, padding: '1px 5px', display: 'inline-block', width: 'fit-content' }}>
                          {counts.requested} request{counts.requested > 1 ? 's' : ''}
                        </div>
                      )}
                      {hasConfirmed && (
                        <div style={{ fontSize: 9, fontWeight: 600, color: '#1565c0', background: '#fff', borderRadius: 8, padding: '1px 5px', display: 'inline-block', width: 'fit-content' }}>
                          {counts.confirmed} booked
                        </div>
                      )}
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
                <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e' }}>
                  📋 {selectedDateLabel}
                </div>
                <button onClick={() => setSelectedDay(null)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#999' }}>✕</button>
              </div>

              {/* Sessions list */}
              {selectedDaySessions.length > 0 ? (
                <div style={{ marginBottom: 16 }}>
                  {selectedDaySessions.map((s, idx) => {
                    const isRequested = s.status === 'requested';
                    return (
                      <div key={idx} style={{
                        padding: '10px 12px',
                        background: isRequested ? '#fce4ec' : '#e3f2fd',
                        borderRadius: 8,
                        marginBottom: 8,
                        borderLeft: `3px solid ${isRequested ? '#f48fb1' : '#42a5f5'}`,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14, color: '#1a1a2e' }}>
                              {formatTime12(s.scheduled_time || s.time)} · {s.service_type || s.serviceType}
                            </div>
                            <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                              {s.duration_hours || s.durationHours || 1}h
                              {(s.caregiver_name || s.caregiverName) ? ` · with ${s.caregiver_name || s.caregiverName}` : ''}
                            </div>
                            {(s.special_instructions || s.specialInstructions) && (
                              <div style={{ fontSize: 11, color: '#888', fontStyle: 'italic', marginTop: 4 }}>
                                {s.special_instructions || s.specialInstructions}
                              </div>
                            )}
                          </div>
                          <span style={{
                            padding: '3px 10px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                            background: isRequested ? '#fff' : '#e8f5e9',
                            color: isRequested ? '#c62828' : '#2e7d32',
                            textTransform: 'capitalize',
                          }}>
                            {isRequested ? 'Seeking Help' : s.status}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: '#999', marginBottom: 16 }}>No sessions on this day</div>
              )}

              {/* Request Care button / form */}
              {!showRequestForm ? (
                <button onClick={() => setShowRequestForm(true)} style={{
                  width: '100%', padding: '10px', background: '#fce4ec', color: '#c62828',
                  border: '1px dashed #f48fb1', borderRadius: 8, cursor: 'pointer',
                  fontSize: 13, fontWeight: 600,
                }}>
                  + Request Care for {new Date(viewYear, viewMonth, selectedDay).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </button>
              ) : (
                <div style={{ background: '#fef7f9', borderRadius: 8, padding: 16, border: '1px solid #f8bbd0' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#c62828', marginBottom: 12 }}>Request Care</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: '#666', display: 'block', marginBottom: 4 }}>Service Type</label>
                      <select value={requestForm.serviceType} onChange={e => setRequestForm(f => ({ ...f, serviceType: e.target.value }))}
                        style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }}>
                        {serviceTypes.map(st => (
                          <option key={st.value} value={st.value}>{st.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: '#666', display: 'block', marginBottom: 4 }}>Time</label>
                      <input type="time" value={requestForm.time} onChange={e => setRequestForm(f => ({ ...f, time: e.target.value }))}
                        style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: '#666', display: 'block', marginBottom: 4 }}>Hours</label>
                      <select value={requestForm.hours} onChange={e => setRequestForm(f => ({ ...f, hours: e.target.value }))}
                        style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }}>
                        {[1, 1.5, 2, 2.5, 3, 4, 5, 6].map(h => (
                          <option key={h} value={h}>{h} hour{h > 1 ? 's' : ''}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#666', display: 'block', marginBottom: 4 }}>Note (optional)</label>
                    <textarea value={requestForm.note} onChange={e => setRequestForm(f => ({ ...f, note: e.target.value }))}
                      placeholder="Any details about what you need help with..."
                      style={{ width: '100%', minHeight: 60, padding: 8, borderRadius: 6, border: '1px solid #ddd', fontSize: 13, resize: 'vertical' }} />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={handleRequestCare} disabled={submitting} style={{
                      padding: '8px 20px', background: '#c62828', color: '#fff', border: 'none',
                      borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                      opacity: submitting ? 0.5 : 1,
                    }}>{submitting ? 'Submitting...' : 'Request Help'}</button>
                    <button onClick={() => setShowRequestForm(false)} style={{
                      padding: '8px 20px', background: '#fff', border: '1px solid #ddd',
                      borderRadius: 6, cursor: 'pointer', fontSize: 13,
                    }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Notes Tab — preserved from original */}
      {activeTab === 'notes' && (
        <div>
          <div className="card" style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>Write a new note</div>
            <textarea
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
              placeholder="What's on your mind? Reminders, thoughts, things to tell your family or caregiver..."
              style={{ width: '100%', minHeight: '80px', padding: '10px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '14px', resize: 'vertical', marginBottom: '8px' }}
            />
            <button onClick={handleAddNote} disabled={!newNote.trim() || saving} style={{
              padding: '8px 20px', background: '#1b6b5a', color: '#fff', border: 'none',
              borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
              opacity: (!newNote.trim() || saving) ? 0.5 : 1,
            }}>{saving ? 'Saving...' : 'Save Note'}</button>
          </div>

          {notes.length > 0 ? notes.map((n, idx) => {
            const typeStyle = noteTypeColors[n.noteType] || noteTypeColors.general;
            const isEditing = editingNote === n.id;
            return (
              <div key={idx} className="card" style={{ marginBottom: '10px' }}>
                {isEditing ? (
                  <div>
                    <textarea value={editContent} onChange={e => setEditContent(e.target.value)}
                      style={{ width: '100%', minHeight: '60px', padding: '10px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '14px', resize: 'vertical', marginBottom: '8px' }}
                    />
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => handleEditNote(n.id)} disabled={saving} style={{
                        padding: '6px 14px', background: '#1b6b5a', color: '#fff', border: 'none',
                        borderRadius: '6px', cursor: 'pointer', fontSize: '12px',
                      }}>Save</button>
                      <button onClick={() => setEditingNote(null)} style={{
                        padding: '6px 14px', background: '#fff', border: '1px solid #ddd',
                        borderRadius: '6px', cursor: 'pointer', fontSize: '12px',
                      }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span style={{
                          padding: '2px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: 600,
                          background: typeStyle.bg, color: typeStyle.color,
                        }}>{typeStyle.label}</span>
                        <span style={{ fontSize: '11px', color: '#999' }}>
                          by {n.authorName} ({n.authorRole === 'care_for' ? 'me' : n.authorRole})
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button onClick={() => { setEditingNote(n.id); setEditContent(n.content); }} style={{
                          padding: '3px 8px', background: 'none', border: '1px solid #ddd', borderRadius: '4px',
                          cursor: 'pointer', fontSize: '11px', color: '#666',
                        }}>Edit</button>
                        <button onClick={() => handleDeleteNote(n.id)} style={{
                          padding: '3px 8px', background: 'none', border: '1px solid #fdd', borderRadius: '4px',
                          cursor: 'pointer', fontSize: '11px', color: '#c00',
                        }}>Delete</button>
                      </div>
                    </div>
                    <div style={{ fontSize: '14px', color: '#333', lineHeight: 1.5 }}>{n.content}</div>
                    <div style={{ fontSize: '11px', color: '#aaa', marginTop: '6px' }}>{n.createdAt ? new Date(n.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}</div>
                  </div>
                )}
              </div>
            );
          }) : (
            <div className="card" style={{ textAlign: 'center', padding: '40px 20px', color: '#999' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>📝</div>
              <div>No notes yet — write your first one above!</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
