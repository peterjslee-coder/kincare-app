const CareProfile = window.CareProfile = () => {
  const [profile, setProfile] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [contacts, setContacts] = useState([]);
  const [editingContact, setEditingContact] = useState(null);
  const [newContact, setNewContact] = useState(null);

  const fetchContacts = async (recipientId) => {
    try {
      const res = await apiFetch(`/api/care-recipients/${recipientId}/emergency-contacts`);
      if (res?.ok) {
        const d = await res.json();
        setContacts(d.contacts || []);
      }
    } catch (err) {
      console.error('Error fetching contacts:', err);
    }
  };

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const response = await apiFetch('/api/care-recipients');
        if (response?.ok) {
          const data = await response.json();
          if (data.careRecipients && data.careRecipients.length > 0) {
            const p = data.careRecipients[0];
            setProfile(p);
            fetchContacts(p.id);
          }
        }
      } catch (error) {
        console.error('Error fetching profile:', error);
      }
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
        setTimeout(() => setSaveMsg(''), 3000);
      } else {
        setSaveMsg('Error saving — please try again.');
      }
    } catch (err) {
      console.error('Save error:', err);
      setSaveMsg('Error saving — please try again.');
    }
    setSaving(false);
  };

  const saveContact = async (contact) => {
    try {
      if (contact.id) {
        // Update existing
        const res = await apiFetch(`/api/care-recipients/${profile.id}/emergency-contacts/${contact.id}`, {
          method: 'PUT', body: JSON.stringify(contact),
        });
        if (res?.ok) { fetchContacts(profile.id); setEditingContact(null); }
      } else {
        // Create new
        const res = await apiFetch(`/api/care-recipients/${profile.id}/emergency-contacts`, {
          method: 'POST', body: JSON.stringify(contact),
        });
        if (res?.ok) { fetchContacts(profile.id); setNewContact(null); }
      }
    } catch (err) { console.error('Save contact error:', err); }
  };

  const deleteContact = async (contactId) => {
    try {
      const res = await apiFetch(`/api/care-recipients/${profile.id}/emergency-contacts/${contactId}`, { method: 'DELETE' });
      if (res?.ok) fetchContacts(profile.id);
    } catch (err) { console.error('Delete contact error:', err); }
  };

  const ed = (field, val) => setEditData({ ...editData, [field]: val });

  if (!profile) return <div className="page-header"><h1 className="page-title">Care Profile</h1><p>Loading...</p></div>;

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
          <button onClick={startEditing} style={{ padding: '8px 20px', background: '#1b6b5a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
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

      {saveMsg && (
        <div style={{ padding: '10px 16px', borderRadius: 8, marginBottom: 16, background: saveMsg.includes('success') ? '#e8f5e9' : '#fce4ec', color: saveMsg.includes('success') ? '#2e7d32' : '#c62828', fontWeight: 500, fontSize: 14 }}>
          {saveMsg}
        </div>
      )}

      <div className="care-profile-header">
        <div className="care-profile-avatar">👵</div>
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
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span><span className="card-icon">🚨</span>Emergency Contacts ({contacts.length})</span>
          {!newContact && (
            <button onClick={() => setNewContact({ name: '', relationship: '', phone: '', email: '' })} style={{
              padding: '4px 12px', background: '#1b6b5a', color: '#fff', border: 'none',
              borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 600,
            }}>+ Add Contact</button>
          )}
        </div>
        {contacts.length > 0 ? contacts.map((c) => (
          editingContact === c.id ? (
            <div key={c.id} style={{ padding: '12px 0', borderBottom: '1px solid #eee' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <input style={inputStyle} placeholder="Name" defaultValue={c.name} id={`ec-name-${c.id}`} />
                <input style={inputStyle} placeholder="Relationship" defaultValue={c.relationship} id={`ec-rel-${c.id}`} />
                <input style={inputStyle} placeholder="Phone" defaultValue={c.phone} id={`ec-phone-${c.id}`} />
                <input style={inputStyle} placeholder="Email" defaultValue={c.email} id={`ec-email-${c.id}`} />
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => saveContact({
                  id: c.id,
                  name: document.getElementById(`ec-name-${c.id}`).value,
                  relationship: document.getElementById(`ec-rel-${c.id}`).value,
                  phone: document.getElementById(`ec-phone-${c.id}`).value,
                  email: document.getElementById(`ec-email-${c.id}`).value,
                })} style={{ padding: '4px 12px', background: '#1b6b5a', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Save</button>
                <button onClick={() => setEditingContact(null)} style={{ padding: '4px 12px', background: '#fff', color: '#666', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
              </div>
            </div>
          ) : (
            <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f0f0f0' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {c.name}
                  {c.is_primary ? (
                    <span style={{ padding: '1px 6px', background: '#e8f5e9', color: '#2e7d32', borderRadius: 8, fontSize: 10, fontWeight: 700 }}>PRIMARY</span>
                  ) : null}
                </div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{c.relationship}</div>
                <div style={{ fontSize: 13, color: '#555', marginTop: 4 }}>
                  {c.phone && <span>📞 {c.phone}</span>}
                  {c.phone && c.email && <span> &bull; </span>}
                  {c.email && <span>✉️ {c.email}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button onClick={() => setEditingContact(c.id)} style={{ padding: '4px 10px', background: '#f5f5f5', border: '1px solid #ddd', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}>Edit</button>
                <button onClick={() => deleteContact(c.id)} style={{ padding: '4px 10px', background: '#fff', color: '#c00', border: '1px solid #fcc', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}>✕</button>
              </div>
            </div>
          )
        )) : (
          <p style={{ color: '#999', fontSize: 14 }}>No emergency contacts added yet.</p>
        )}
        {newContact && (
          <div style={{ padding: '12px 0', borderTop: contacts.length > 0 ? '1px solid #eee' : 'none', marginTop: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#1b6b5a' }}>New Contact</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <input style={inputStyle} placeholder="Name *" id="ec-new-name" />
              <input style={inputStyle} placeholder="Relationship" id="ec-new-rel" />
              <input style={inputStyle} placeholder="Phone" id="ec-new-phone" />
              <input style={inputStyle} placeholder="Email" id="ec-new-email" />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => saveContact({
                name: document.getElementById('ec-new-name').value,
                relationship: document.getElementById('ec-new-rel').value,
                phone: document.getElementById('ec-new-phone').value,
                email: document.getElementById('ec-new-email').value,
              })} style={{ padding: '4px 12px', background: '#1b6b5a', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Save</button>
              <button onClick={() => setNewContact(null)} style={{ padding: '4px 12px', background: '#fff', color: '#666', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <div className="ai-insights">
        <div className="ai-insights-header"><span className="card-icon">🧠</span>AI Care Insights</div>
        <ul className="ai-insights-list">
          <li className="ai-insights-item">Betty responds best to visual cues and gentle reminders for meals</li>
          <li className="ai-insights-item">Morning hours (9-11 AM) show highest engagement and alertness</li>
          <li className="ai-insights-item">Photo albums and gardening activities reduce anxiety episodes</li>
          <li className="ai-insights-item">Consistent daily routines help maintain cognitive function</li>
        </ul>
      </div>
    </>
  );
};
