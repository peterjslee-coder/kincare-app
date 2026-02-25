const CareProfile = window.CareProfile = () => {
  const [profile, setProfile] = useState(null);
  const [allRecipients, setAllRecipients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [notes, setNotes] = useState([]);
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [permTier, setPermTier] = useState('full');
  const [visSettings, setVisSettings] = useState(null);
  const [savingPerms, setSavingPerms] = useState(false);
  const { showToast } = useToast();

  const resizeImg = (file, maxDim, quality) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) { if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; } else { w = Math.round(w * maxDim / h); h = maxDim; } }
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject; img.src = ev.target.result;
    };
    reader.onerror = reject; reader.readAsDataURL(file);
  });

  const handlePhotoUpload = async () => {
    if (!profile?.id) return;
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      setPhotoUploading(true);
      try {
        const base64 = await resizeImg(file, 800, 0.8);
        const res = await apiFetch(`/api/care-recipients/${profile.id}/photo`, { method: 'PUT', body: JSON.stringify({ photo: base64 }) });
        if (res?.ok) { showToast('Photo updated!', 'success'); setProfile(p => ({ ...p, photo: base64 })); }
        else { const d = await res?.json().catch(() => ({})); showToast(d.error || 'Failed to upload photo', 'error'); }
      } catch (err) { console.error('Photo upload error:', err); showToast('Failed to upload photo', 'error'); }
      setPhotoUploading(false);
    };
    input.click();
  };

  const fetchNotes = async (recipientId) => {
    try {
      const res = await apiFetch(`/api/notes/${recipientId}`);
      if (res?.ok) { const d = await res.json(); setNotes(d.notes || []); }
    } catch {}
  };

  const handleAddNote = async () => {
    if (!newNote.trim() || !profile?.id) return;
    setAddingNote(true);
    try {
      const res = await apiFetch('/api/notes', {
        method: 'POST',
        body: JSON.stringify({ careRecipientId: profile.id, content: newNote.trim(), noteType: 'general' }),
      });
      if (res?.ok) {
        setNewNote('');
        showToast('Note added', 'success');
        fetchNotes(profile.id);
      }
    } catch { showToast('Failed to add note', 'error'); }
    setAddingNote(false);
  };

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const response = await apiFetch('/api/care-recipients');
        if (response?.ok) {
          const data = await response.json();
          if (data.careRecipients && data.careRecipients.length > 0) {
            setAllRecipients(data.careRecipients);
            const first = data.careRecipients[0];
            setProfile(first);
            setPermTier(first.permission_tier || 'full');
            try { setVisSettings(first.visibility_settings ? JSON.parse(first.visibility_settings) : null); } catch { setVisSettings(null); }
            fetchNotes(first.id);
          }
        }
      } catch (error) {
        console.error('Error fetching profile:', error);
      }
      setLoading(false);
    };
    fetchProfile();
  }, []);

  const parseJsonField = (val) => {
    try {
      return typeof val === 'string' ? JSON.parse(val) : val || [];
    } catch { return []; }
  };

  const startEditing = () => {
    const hc = parseJsonField(profile.health_conditions);
    const meds = parseJsonField(profile.medications);
    setEditData({
      first_name: profile.first_name || '',
      last_name: profile.last_name || '',
      age: profile.age || '',
      city: profile.location_city || '',
      state: profile.location_state || '',
      health_conditions: Array.isArray(hc) ? hc.join('\n') : '',
      medications: Array.isArray(meds) ? meds.join('\n') : '',
      preferences: profile.preferences || '',
      emergency_contact_name: profile.emergency_contact_name || '',
      emergency_contact_phone: profile.emergency_contact_phone || '',
    });
    setEditing(true);
    setSaveMsg('');
  };

  const cancelEditing = () => {
    setEditing(false);
    setSaveMsg('');
  };

  const saveProfile = async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      const payload = {
        firstName: editData.first_name,
        lastName: editData.last_name,
        age: parseInt(editData.age) || profile.age,
        address: profile.location_address || null,
        city: editData.city,
        state: editData.state,
        zip: profile.location_zip || null,
        healthConditions: editData.health_conditions.split('\n').map(s => s.trim()).filter(Boolean),
        medications: editData.medications.split('\n').map(s => s.trim()).filter(Boolean),
        preferences: editData.preferences,
        emergencyContactName: editData.emergency_contact_name,
        emergencyContactPhone: editData.emergency_contact_phone,
      };
      const response = await apiFetch(`/api/care-recipients/${profile.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      if (response?.ok) {
        const updated = await response.json();
        const refreshed = updated.careRecipient || updated;
        setProfile({ ...profile, ...refreshed,
          first_name: editData.first_name,
          last_name: editData.last_name,
          age: parseInt(editData.age) || profile.age,
          location_city: editData.city,
          location_state: editData.state,
          health_conditions: JSON.stringify(editData.health_conditions.split('\n').map(s => s.trim()).filter(Boolean)),
          medications: JSON.stringify(editData.medications.split('\n').map(s => s.trim()).filter(Boolean)),
          preferences: editData.preferences,
          emergency_contact_name: editData.emergency_contact_name,
          emergency_contact_phone: editData.emergency_contact_phone,
        });
        setEditing(false);
        setSaveMsg('Profile saved successfully!');
        showToast('Profile saved successfully!', 'success');
        setTimeout(() => setSaveMsg(''), 3000);
      } else {
        setSaveMsg('Error saving — please try again.');
        showToast('Error saving profile', 'error');
      }
    } catch (err) {
      console.error('Save error:', err);
      setSaveMsg('Error saving — please try again.');
      showToast('Error saving profile', 'error');
    }
    setSaving(false);
  };

  const ed = (field, val) => setEditData({ ...editData, [field]: val });

  if (loading) return <LoadingSpinner text="Loading care profile..." />;
  if (!profile) return <EmptyState icon="👵" title="No care recipient found" text="Add a care recipient to get started." />;

  const canEdit = profile.access_level !== 'view';
  const healthConditions = parseJsonField(profile.health_conditions);
  const medications = parseJsonField(profile.medications);

  const inputStyle = { width: '100%', padding: '10px 12px', border: '1px solid #d0d0d0', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' };
  const textareaStyle = { ...inputStyle, minHeight: 80, resize: 'vertical' };
  const fieldLabel = { fontSize: 12, fontWeight: 600, color: '#666', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' };

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="page-title">Care Profile</h1>
        {!editing ? (
          canEdit && <button onClick={startEditing} style={{ padding: '8px 20px', background: '#1b6b5a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            Edit Profile
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={cancelEditing} style={{ padding: '8px 16px', background: '#fff', color: '#666', border: '1px solid #d0d0d0', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
            <button onClick={saveProfile} disabled={saving} style={{ padding: '8px 20px', background: saving ? '#999' : '#1b6b5a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: saving ? 'wait' : 'pointer' }}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>

      {allRecipients.length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {allRecipients.map(r => (
            <button key={r.id} onClick={() => { setProfile(r); fetchNotes(r.id); setEditing(false); setPermTier(r.permission_tier || 'full'); try { setVisSettings(r.visibility_settings ? JSON.parse(r.visibility_settings) : null); } catch { setVisSettings(null); } }}
              style={{ padding: '6px 14px', borderRadius: 20, border: r.id === profile?.id ? '2px solid #1b6b5a' : '1px solid #d0d0d0', background: r.id === profile?.id ? '#e0f2e9' : '#fff', color: r.id === profile?.id ? '#1b6b5a' : '#666', fontSize: 13, fontWeight: r.id === profile?.id ? 600 : 400, cursor: 'pointer' }}>
              {r.first_name} {r.last_name}
            </button>
          ))}
        </div>
      )}

      {saveMsg && (
        <div style={{ padding: '10px 16px', borderRadius: 8, marginBottom: 16, background: saveMsg.includes('success') ? '#e8f5e9' : '#fce4ec', color: saveMsg.includes('success') ? '#2e7d32' : '#c62828', fontWeight: 500, fontSize: 14 }}>
          {saveMsg}
        </div>
      )}

      <div className="care-profile-header">
        <div className="care-profile-avatar" onClick={handlePhotoUpload} style={{ cursor: 'pointer', position: 'relative', overflow: 'hidden' }} title="Click to change photo">
          {profile.photo
            ? <img src={profile.photo} alt={`${profile.first_name}`} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
            : <span style={{ fontSize: 48 }}>{profile.first_name?.[0] || '?'}{profile.last_name?.[0] || ''}</span>}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.45)', color: '#fff', fontSize: 10, textAlign: 'center', padding: '3px 0', fontWeight: 600 }}>
            {photoUploading ? '...' : '📷'}
          </div>
        </div>
        {editing ? (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 8 }}>
            <input style={{ ...inputStyle, maxWidth: 140, textAlign: 'center' }} value={editData.first_name} onChange={(e) => ed('first_name', e.target.value)} placeholder="First name" />
            <input style={{ ...inputStyle, maxWidth: 140, textAlign: 'center' }} value={editData.last_name} onChange={(e) => ed('last_name', e.target.value)} placeholder="Last name" />
          </div>
        ) : (
          <>
            <div className="care-profile-name">{profile.first_name} {profile.last_name}</div>
            <div className="care-profile-subtitle">Primary Care Recipient</div>
          </>
        )}
      </div>

      <div className="card">
        <div className="card-header"><span className="card-icon">ℹ️</span>Basic Information</div>
        {editing ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <div>
              <div style={fieldLabel}>Age</div>
              <input type="number" style={inputStyle} value={editData.age} onChange={(e) => ed('age', e.target.value)} />
            </div>
            <div>
              <div style={fieldLabel}>City</div>
              <input style={inputStyle} value={editData.city} onChange={(e) => ed('city', e.target.value)} />
            </div>
            <div>
              <div style={fieldLabel}>State</div>
              <input style={inputStyle} value={editData.state} onChange={(e) => ed('state', e.target.value)} />
            </div>
          </div>
        ) : (
          <div className="info-grid">
            <div className="info-item">
              <div className="info-label">🎂 Age</div>
              <div className="info-value">{profile.age} years old</div>
            </div>
            <div className="info-item">
              <div className="info-label">📍 Location</div>
              <div className="info-value">{profile.location_city}, {profile.location_state}</div>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-header"><span className="card-icon">⚕️</span>Health Conditions</div>
        {editing ? (
          <div>
            <div style={{ ...fieldLabel, marginBottom: 8 }}>One condition per line</div>
            <textarea style={textareaStyle} value={editData.health_conditions} onChange={(e) => ed('health_conditions', e.target.value)} placeholder="Early-stage dementia&#10;Mild arthritis&#10;..." />
          </div>
        ) : healthConditions.length > 0 ? (
          <ul className="health-list">
            {healthConditions.map((condition, idx) => (
              <li key={idx} className="health-item">{condition}</li>
            ))}
          </ul>
        ) : <p style={{ color: '#999' }}>No health conditions listed</p>}
      </div>

      <div className="card">
        <div className="card-header"><span className="card-icon">💊</span>Medications</div>
        {editing ? (
          <div>
            <div style={{ ...fieldLabel, marginBottom: 8 }}>One medication per line</div>
            <textarea style={textareaStyle} value={editData.medications} onChange={(e) => ed('medications', e.target.value)} placeholder="Donepezil 10mg daily&#10;Vitamin D 1000IU&#10;..." />
          </div>
        ) : medications.length > 0 ? (
          <ul className="health-list">
            {medications.map((med, idx) => (
              <li key={idx} className="med-item">{med}</li>
            ))}
          </ul>
        ) : <p style={{ color: '#999' }}>No medications listed</p>}
      </div>

      <div className="card">
        <div className="card-header"><span className="card-icon">💛</span>Preferences</div>
        {editing ? (
          <textarea style={textareaStyle} value={editData.preferences} onChange={(e) => ed('preferences', e.target.value)} placeholder="Likes gardening, enjoys photo albums..." />
        ) : (
          <p>{profile.preferences || 'No preferences listed'}</p>
        )}
      </div>

      <div className="card">
        <div className="card-header"><span className="card-icon">🚨</span>Emergency Contact</div>
        {editing ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={fieldLabel}>Name</div>
              <input style={inputStyle} value={editData.emergency_contact_name} onChange={(e) => ed('emergency_contact_name', e.target.value)} />
            </div>
            <div>
              <div style={fieldLabel}>Phone</div>
              <input type="tel" style={inputStyle} value={editData.emergency_contact_phone} onChange={(e) => ed('emergency_contact_phone', e.target.value)} />
            </div>
          </div>
        ) : (
          <div className="info-grid">
            <div className="info-item">
              <div className="info-label">Name</div>
              <div className="info-value">{profile.emergency_contact_name}</div>
            </div>
            <div className="info-item">
              <div className="info-label">Phone</div>
              <div className="info-value">{profile.emergency_contact_phone}</div>
            </div>
          </div>
        )}
      </div>

      {/* Care Notes */}
      <div className="card">
        <div className="card-header"><span className="card-icon">📝</span>Care Notes</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: notes.length > 0 ? 12 : 0 }}>
          <input value={newNote} onChange={(e) => setNewNote(e.target.value)}
            placeholder="Add a note about care, observations, updates..."
            style={{ flex: 1, padding: '10px 12px', border: '1px solid #d0d0d0', borderRadius: 8, fontSize: 14, fontFamily: 'inherit' }}
            onKeyDown={(e) => { if (e.key === 'Enter' && newNote.trim()) handleAddNote(); }} />
          <button onClick={handleAddNote} disabled={addingNote || !newNote.trim()}
            style={{ padding: '10px 20px', background: addingNote ? '#999' : '#1b6b5a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: addingNote ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>
            {addingNote ? '...' : 'Add'}
          </button>
        </div>
        {notes.length > 0 ? notes.map((n) => (
          <div key={n.id} style={{ padding: '10px 0', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, color: '#333', lineHeight: 1.5 }}>{n.content}</div>
              <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
                {n.author_first_name} {n.author_last_name}
                {' · '}{(parseTimestamp(n.created_at) || new Date()).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
            </div>
            {canEdit && (
              <button onClick={async () => {
                if (!confirm('Delete this note?')) return;
                const res = await apiFetch(`/api/notes/${n.id}`, { method: 'DELETE' });
                if (res?.ok) fetchNotes(profile.id);
              }} style={{ padding: '3px 8px', background: 'none', border: '1px solid #fdd', borderRadius: 4, cursor: 'pointer', fontSize: 11, color: '#c00', whiteSpace: 'nowrap', flexShrink: 0 }}>Delete</button>
            )}
          </div>
        )) : (
          <p style={{ color: '#999', fontSize: 13, margin: '8px 0 0' }}>No notes yet. Add one to share care observations with your team.</p>
        )}
      </div>

      {/* ─── Permission Controls (owner only) ─── */}
      {profile?.linked_user_id && canEdit && (
        <div className="card" style={{ marginBottom: 16, border: '1px solid #e0e0e0' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>🔐</span> {profile.first_name}'s App Permissions
          </div>
          <p style={{ fontSize: 12, color: '#888', marginBottom: 14, lineHeight: 1.5 }}>
            Control what {profile.first_name} sees and can do when they log into their own account.
          </p>

          {/* Tier selector */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
            {[
              { id: 'full', label: 'Full Control', desc: 'Can view and edit everything', icon: '🟢' },
              { id: 'collaborative', label: 'Collaborative', desc: 'Can view selected info, can add notes', icon: '🟡' },
              { id: 'managed', label: 'Managed', desc: 'View-only for selected info', icon: '🔴' },
            ].map(t => (
              <button key={t.id} onClick={() => {
                setPermTier(t.id);
                if (t.id === 'full') setVisSettings(null);
                else if (!visSettings) setVisSettings({ calendar: true, healthConditions: true, medications: true, allergies: true, preferences: true, pets: true, emergencyContact: true, notes: true });
              }} style={{
                flex: '1 1 140px', padding: '10px 12px', border: permTier === t.id ? '2px solid #1b6b5a' : '1px solid #e0e0e0',
                borderRadius: 10, background: permTier === t.id ? '#e8f5e9' : '#fff', cursor: 'pointer', textAlign: 'left',
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#333' }}>{t.icon} {t.label}</div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{t.desc}</div>
              </button>
            ))}
          </div>

          {/* Section visibility toggles (only for collaborative/managed) */}
          {permTier !== 'full' && visSettings && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#666', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {profile.first_name} can see:
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 6 }}>
                {[
                  { key: 'calendar', label: 'Calendar / Schedule', icon: '📅' },
                  { key: 'healthConditions', label: 'Health Conditions', icon: '🩺' },
                  { key: 'medications', label: 'Medications', icon: '💊' },
                  { key: 'allergies', label: 'Allergies', icon: '⚠️' },
                  { key: 'preferences', label: 'Care Preferences', icon: '✨' },
                  { key: 'pets', label: 'Pets at Home', icon: '🐾' },
                  { key: 'emergencyContact', label: 'Emergency Contact', icon: '🆘' },
                  { key: 'notes', label: 'Notes', icon: '📝' },
                ].map(s => (
                  <label key={s.key} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                    background: visSettings[s.key] ? '#f0faf5' : '#fafafa', borderRadius: 8,
                    border: `1px solid ${visSettings[s.key] ? '#1b6b5a40' : '#e0e0e0'}`, cursor: 'pointer',
                  }}>
                    <input type="checkbox" checked={!!visSettings[s.key]}
                      onChange={() => setVisSettings(v => ({ ...v, [s.key]: !v[s.key] }))}
                      style={{ accentColor: '#1b6b5a' }} />
                    <span style={{ fontSize: 12, color: '#333' }}>{s.icon} {s.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Save button */}
          <button onClick={async () => {
            setSavingPerms(true);
            try {
              const res = await apiFetch(`/api/care-recipients/${profile.id}/permissions`, {
                method: 'PUT',
                body: JSON.stringify({
                  permissionTier: permTier,
                  visibilitySettings: permTier === 'full' ? null : visSettings,
                }),
              });
              if (res?.ok) {
                showToast('Permissions updated', 'success');
                setProfile(p => ({ ...p, permission_tier: permTier, visibility_settings: permTier === 'full' ? null : JSON.stringify(visSettings) }));
              } else {
                const d = await res?.json().catch(() => ({}));
                showToast(d.error || 'Failed to update permissions', 'error');
              }
            } catch { showToast('Failed to update permissions', 'error'); }
            setSavingPerms(false);
          }} disabled={savingPerms} style={{
            padding: '8px 20px', background: savingPerms ? '#999' : '#1b6b5a', color: '#fff',
            border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: savingPerms ? 'wait' : 'pointer',
          }}>
            {savingPerms ? 'Saving...' : 'Save Permissions'}
          </button>
        </div>
      )}

      <div className="ai-insights">
        <div className="ai-insights-header"><span className="card-icon">🧠</span>AI Care Insights</div>
        <ul className="ai-insights-list">
          {(() => {
            const name = profile?.first_name || 'Your loved one';
            const hc = parseJsonField(profile?.health_conditions);
            const prefs = profile?.preferences || '';
            const insights = [];
            // Generate insights based on actual care recipient data
            if (hc.some(c => /dementia|alzheimer|memory|cognitive/i.test(c))) {
              insights.push(`${name} responds best to visual cues and gentle reminders for meals`);
              insights.push('Consistent daily routines help maintain cognitive function');
            }
            if (hc.some(c => /anxiety|stress/i.test(c))) {
              insights.push('Calming activities and familiar routines help reduce anxiety episodes');
            }
            if (hc.some(c => /tbi|brain injury|traumatic/i.test(c))) {
              insights.push(`Structured schedules with visual aids (whiteboards, checklists) support ${name}'s daily routine`);
              insights.push('Short, focused activity sessions work better than extended ones');
            }
            if (hc.some(c => /arthritis|mobility|weakness|walker|wheelchair/i.test(c))) {
              insights.push('Gentle movement and stretching during alert periods supports physical wellbeing');
            }
            if (prefs) {
              insights.push(`Care preferences: ${prefs.substring(0, 100)}${prefs.length > 100 ? '...' : ''}`);
            }
            insights.push('Morning hours (9-11 AM) typically show highest engagement and alertness');
            // Return up to 4 insights
            return insights.slice(0, 4).map((text, i) =>
              React.createElement('li', { key: i, className: 'ai-insights-item' }, text)
            );
          })()}
        </ul>
      </div>
    </>
  );
};
