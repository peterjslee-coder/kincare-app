const CaredForView = window.CaredForView = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('calendar');
  const [newNote, setNewNote] = useState('');
  const [editingNote, setEditingNote] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);

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

  useEffect(() => { fetchData(); }, []);

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

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>Loading...</div>;
  if (!data) return <div style={{ padding: '40px', textAlign: 'center', color: '#c00' }}>Failed to load</div>;

  const sessions = data.sessions || [];
  const notes = data.notes || [];
  const userName = data.userName || 'Guest';

  // Group sessions by date for calendar view
  const sessionsByDate = {};
  sessions.forEach(s => {
    if (!sessionsByDate[s.date]) sessionsByDate[s.date] = [];
    sessionsByDate[s.date].push(s);
  });

  const noteTypeColors = {
    personal: { bg: '#e3f2fd', color: '#1565c0', label: 'Personal' },
    health: { bg: '#fce4ec', color: '#c62828', label: 'Health' },
    general: { bg: '#f3e5f5', color: '#7b1fa2', label: 'General' },
    family: { bg: '#e8f5e9', color: '#2e7d32', label: 'Family' },
  };

  return (
    <div>
      <h1 className="greeting" style={{ marginBottom: '4px' }}>Hello, {userName}!</h1>
      <p style={{ color: '#666', fontSize: '14px', marginBottom: '20px' }}>Here's what's coming up for you</p>

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
          {sessions.length > 0 ? (
            <div>
              {Object.keys(sessionsByDate).sort().map(date => {
                const dayStr = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
                return (
                  <div key={date} style={{ marginBottom: '16px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#1b6b5a', marginBottom: '8px', paddingBottom: '4px', borderBottom: '1px solid #e0e0e0' }}>
                      {dayStr}
                    </div>
                    {sessionsByDate[date].map((s, idx) => (
                      <div key={idx} className="card" style={{ marginBottom: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: '15px', color: '#333' }}>
                              {s.time} — {s.serviceType}
                            </div>
                            <div style={{ fontSize: '13px', color: '#666', marginTop: '4px' }}>
                              with {s.caregiverName || 'TBD'}
                            </div>
                            {s.specialInstructions && (
                              <div style={{ fontSize: '12px', color: '#888', marginTop: '4px', fontStyle: 'italic' }}>
                                {s.specialInstructions}
                              </div>
                            )}
                          </div>
                          <div style={{
                            padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
                            background: s.status === 'confirmed' ? '#e8f5e9' : '#fff3e0',
                            color: s.status === 'confirmed' ? '#2e7d32' : '#e65100',
                            textTransform: 'capitalize',
                          }}>{s.status}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="card" style={{ textAlign: 'center', padding: '40px 20px', color: '#999' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>📅</div>
              <div>No upcoming appointments</div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'notes' && (
        <div>
          {/* New Note */}
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

          {/* Notes List */}
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
                    <div style={{ fontSize: '11px', color: '#aaa', marginTop: '6px' }}>{n.createdAt}</div>
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
