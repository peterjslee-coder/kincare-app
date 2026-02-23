const CareRecipients = window.CareRecipients = () => {
  const [recipients, setRecipients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    firstName: '', lastName: '', age: '', relationship: '', nickname: '', city: '', state: '',
    sameAddress: false, healthConditions: '', medications: '', pets: '', petAllergies: '', foodAllergies: '', medicalConditions: '', personality: '', preferences: '',
    emergencyContactName: '', emergencyContactPhone: ''
  });
  const [saveMsg, setSaveMsg] = useState('');
  const [photoUploading, setPhotoUploading] = useState(false);
  const { showToast } = useToast();

  const fetchRecipients = async () => {
    const res = await apiFetch('/api/care-recipients');
    if (res?.ok) {
      const data = await res.json();
      const list = data.careRecipients || data || [];
      setRecipients(Array.isArray(list) ? list : []);
    }
    setLoading(false);
  };

  useEffect(() => { fetchRecipients(); }, []);

  const resetForm = () => {
    setFormData({
      firstName: '', lastName: '', age: '', relationship: '', nickname: '', city: '', state: '',
      sameAddress: false, healthConditions: '', medications: '', pets: '', petAllergies: '', foodAllergies: '', medicalConditions: '', personality: '', preferences: '',
      emergencyContactName: '', emergencyContactPhone: ''
    });
  };

  const startEditRecipient = (r) => {
    const parseField = (val) => {
      try {
        const parsed = typeof val === 'string' ? JSON.parse(val) : val;
        return Array.isArray(parsed) ? parsed.join('\n') : (val || '');
      } catch { return val || ''; }
    };
    setFormData({
      firstName: r.first_name || r.firstName || '',
      lastName: r.last_name || r.lastName || '',
      age: r.age || '',
      relationship: r.relationship || '',
      nickname: r.nickname || '',
      city: r.location_city || r.city || '',
      state: r.location_state || r.state || '',
      sameAddress: false,
      healthConditions: parseField(r.health_conditions || r.healthConditions),
      medications: parseField(r.medications),
      pets: r.pets || '',
      petAllergies: r.pet_allergies || '',
      foodAllergies: r.food_allergies || '',
      medicalConditions: r.medical_conditions || '',
      personality: r.personality || '',
      preferences: r.preferences || '',
      emergencyContactName: r.emergency_contact_name || r.emergencyContactName || '',
      emergencyContactPhone: r.emergency_contact_phone || r.emergencyContactPhone || '',
    });
    setEditingId(r.id);
    setShowAddForm(true);
    setSaveMsg('');
  };

  const handleSaveRecipient = async () => {
    setSaveMsg('');
    const payload = {
      firstName: formData.firstName,
      lastName: formData.lastName,
      age: parseInt(formData.age) || 0,
      address: null,
      city: formData.city,
      state: formData.state,
      zip: null,
      healthConditions: formData.healthConditions.split('\n').map(s => s.trim()).filter(Boolean),
      medications: formData.medications.split('\n').map(s => s.trim()).filter(Boolean),
      pets: formData.pets,
      petAllergies: formData.petAllergies,
      foodAllergies: formData.foodAllergies,
      medicalConditions: formData.medicalConditions,
      preferences: formData.preferences,
      emergencyContactName: formData.emergencyContactName,
      emergencyContactPhone: formData.emergencyContactPhone,
    };

    try {
      let response;
      if (editingId) {
        response = await apiFetch(`/api/care-recipients/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        response = await apiFetch('/api/care-recipients', { method: 'POST', body: JSON.stringify(payload) });
      }
      if (response?.ok) {
        const msg = editingId ? 'Recipient updated!' : 'Recipient added!';
        setSaveMsg(msg);
        showToast(msg, 'success');
        await fetchRecipients();
        setTimeout(() => { setShowAddForm(false); setEditingId(null); resetForm(); setSaveMsg(''); }, 1500);
      } else {
        setSaveMsg('Error saving — please try again.');
        showToast('Error saving recipient', 'error');
      }
    } catch (err) {
      console.error('Save error:', err);
      setSaveMsg('Error saving — please try again.');
      showToast('Error saving recipient', 'error');
    }
  };

  const handlePhotoUpload = async (recipientId) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 1.5 * 1024 * 1024) {
        showToast('Photo too large — max 1.5MB', 'error');
        return;
      }
      setPhotoUploading(true);
      try {
        const reader = new FileReader();
        reader.onload = async (ev) => {
          const base64 = ev.target.result;
          const res = await apiFetch(`/api/care-recipients/${recipientId}/photo`, {
            method: 'PUT',
            body: JSON.stringify({ photo: base64 }),
          });
          if (res?.ok) {
            showToast('Photo updated!', 'success');
            await fetchRecipients();
          } else {
            showToast('Failed to upload photo', 'error');
          }
          setPhotoUploading(false);
        };
        reader.readAsDataURL(file);
      } catch (err) {
        console.error('Photo upload error:', err);
        showToast('Failed to upload photo', 'error');
        setPhotoUploading(false);
      }
    };
    input.click();
  };

  const handleRemovePhoto = async (recipientId) => {
    const res = await apiFetch(`/api/care-recipients/${recipientId}/photo`, { method: 'DELETE' });
    if (res?.ok) {
      showToast('Photo removed', 'success');
      await fetchRecipients();
    }
  };

  const RecipientAvatar = ({ r, size = 40, clickable = false }) => {
    if (r.photo) {
      return React.createElement('div', {
        style: { width: size, height: size, borderRadius: '50%', overflow: 'hidden', cursor: clickable ? 'pointer' : 'default', flexShrink: 0 },
        onClick: clickable ? (e) => { e.stopPropagation(); handlePhotoUpload(r.id); } : undefined,
        title: clickable ? 'Click to change photo' : undefined,
      }, React.createElement('img', { src: r.photo, alt: getName(r), style: { width: '100%', height: '100%', objectFit: 'cover' } }));
    }
    const initials = ((r.first_name || r.firstName || '')[0] || '') + ((r.last_name || r.lastName || '')[0] || '');
    return React.createElement('div', {
      style: { width: size, height: size, borderRadius: '50%', background: '#e0f2e9', color: '#1b6b5a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.4, fontWeight: 700, cursor: clickable ? 'pointer' : 'default', flexShrink: 0 },
      onClick: clickable ? (e) => { e.stopPropagation(); handlePhotoUpload(r.id); } : undefined,
      title: clickable ? 'Click to add photo' : undefined,
    }, initials.toUpperCase());
  };

  const getName = (r) => r.first_name ? `${r.first_name} ${r.last_name}` : `${r.firstName || ''} ${r.lastName || ''}`.trim();
  const selected = recipients.find(r => r.id === selectedId);
  const fd = (field, val) => setFormData({ ...formData, [field]: val });

  const parseDisplay = (val) => {
    try {
      const parsed = typeof val === 'string' ? JSON.parse(val) : val;
      return Array.isArray(parsed) ? parsed.join(', ') : (val || '');
    } catch { return val || ''; }
  };

  if (loading) return <LoadingSpinner text="Loading care recipients..." />;

  return (
    <div>
      <h1 className="greeting">👥 Care Recipients</h1>
      <div className="recipient-cards">
        {recipients.map(r => (
          <div key={r.id} className={`recipient-card ${selectedId === r.id ? 'selected' : ''}`} onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}>
            <div style={{ marginBottom: '12px' }}><RecipientAvatar r={r} size={56} /></div>
            <div className="recipient-card-name">{getName(r)}</div>
            <p className="text-muted" style={{ fontSize: '13px' }}>{r.age} years old</p>
            {(r.location_city || r.city) && <p className="text-muted" style={{ fontSize: '13px' }}>{r.location_city ? `${r.location_city}, ${r.location_state}` : r.city}</p>}
          </div>
        ))}
      </div>

      {selected && !showAddForm && (
        <div className="card" style={{ marginTop: '32px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <RecipientAvatar r={selected} size={48} clickable={true} />
              <span>{getName(selected)}</span>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button onClick={() => handlePhotoUpload(selected.id)} disabled={photoUploading} style={{ padding: '6px 14px', background: '#f0f0f0', color: '#555', border: '1px solid #ddd', borderRadius: 6, fontWeight: 500, fontSize: 12, cursor: 'pointer' }}>
                {photoUploading ? 'Uploading...' : (selected.photo ? 'Change Photo' : 'Add Photo')}
              </button>
              {selected.photo && (
                <button onClick={() => handleRemovePhoto(selected.id)} style={{ padding: '6px 10px', background: '#fff0f0', color: '#c00', border: '1px solid #fdd', borderRadius: 6, fontWeight: 500, fontSize: 12, cursor: 'pointer' }}>Remove</button>
              )}
              <button onClick={() => startEditRecipient(selected)} style={{ padding: '6px 14px', background: '#1b6b5a', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Edit</button>
            </div>
          </div>
          <div className="info-grid">
            <div className="info-item"><div className="info-label">Age</div><div className="info-value">{selected.age}</div></div>
            <div className="info-item"><div className="info-label">Location</div><div className="info-value">{selected.location_city ? `${selected.location_city}, ${selected.location_state}` : (selected.city || 'N/A')}</div></div>
          </div>
          {(selected.health_conditions || selected.healthConditions) && (
            <div style={{ marginTop: '16px' }}>
              <strong>Health Conditions:</strong>
              <p style={{ color: '#6c757d', marginTop: '8px' }}>{parseDisplay(selected.health_conditions || selected.healthConditions)}</p>
            </div>
          )}
          {selected.medications && (
            <div style={{ marginTop: '16px' }}>
              <strong>Medications:</strong>
              <p style={{ color: '#6c757d', marginTop: '8px' }}>{parseDisplay(selected.medications)}</p>
            </div>
          )}
          {selected.pets && (
            <div style={{ marginTop: '16px' }}>
              <strong>Pets in the home:</strong>
              <p style={{ color: '#6c757d', marginTop: '8px' }}>{selected.pets}</p>
            </div>
          )}
          {selected.pet_allergies && (
            <div style={{ marginTop: '16px' }}>
              <strong>Pet allergies:</strong>
              <p style={{ color: '#6c757d', marginTop: '8px' }}>{selected.pet_allergies}</p>
            </div>
          )}
          {selected.food_allergies && (
            <div style={{ marginTop: '16px' }}>
              <strong>Food allergies:</strong>
              <p style={{ color: '#6c757d', marginTop: '8px' }}>{selected.food_allergies}</p>
            </div>
          )}
          {selected.medical_conditions && (
            <div style={{ marginTop: '16px' }}>
              <strong>Additional medical conditions:</strong>
              <p style={{ color: '#6c757d', marginTop: '8px' }}>{selected.medical_conditions}</p>
            </div>
          )}
          {selected.preferences && (
            <div style={{ marginTop: '16px' }}>
              <strong>Preferences:</strong>
              <p style={{ color: '#6c757d', marginTop: '8px' }}>{selected.preferences}</p>
            </div>
          )}
          {(selected.emergency_contact_name || selected.emergencyContactName) && (
            <div style={{ marginTop: '16px' }}>
              <strong>Emergency Contact:</strong>
              <p style={{ color: '#6c757d', marginTop: '8px' }}>{selected.emergency_contact_name || selected.emergencyContactName} — {selected.emergency_contact_phone || selected.emergencyContactPhone}</p>
            </div>
          )}
        </div>
      )}

      {!showAddForm && (
        <button className="btn btn-primary" onClick={() => { resetForm(); setEditingId(null); setShowAddForm(true); }} style={{ marginTop: '32px' }}>+ Add Care Recipient</button>
      )}

      {showAddForm && (
        <div className="card" style={{ marginTop: '32px', borderLeft: '4px solid #1b6b5a' }}>
          <h3 style={{ marginBottom: '24px', color: '#1b6b5a' }}>{editingId ? 'Edit Care Recipient' : 'Add New Care Recipient'}</h3>
          {saveMsg && (
            <div style={{ padding: '10px 16px', borderRadius: 8, marginBottom: 16, background: saveMsg.includes('Error') ? '#fce4ec' : '#e8f5e9', color: saveMsg.includes('Error') ? '#c62828' : '#2e7d32', fontWeight: 500, fontSize: 14 }}>{saveMsg}</div>
          )}
          <div className="form-row">
            <div className="form-group">
              <label>First Name</label>
              <input type="text" value={formData.firstName} onChange={(e) => fd('firstName', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Last Name</label>
              <input type="text" value={formData.lastName} onChange={(e) => fd('lastName', e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Age</label>
              <input type="number" value={formData.age} onChange={(e) => fd('age', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Relationship</label>
              <select value={formData.relationship} onChange={(e) => fd('relationship', e.target.value)}>
                <option value="">Select...</option>
                <option value="Mother">Mother</option>
                <option value="Father">Father</option>
                <option value="Spouse">Spouse</option>
                <option value="Grandparent">Grandparent</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>City</label>
              <input type="text" value={formData.city} onChange={(e) => fd('city', e.target.value)} />
            </div>
            <div className="form-group">
              <label>State</label>
              <input type="text" value={formData.state} onChange={(e) => fd('state', e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label>Health Conditions (one per line)</label>
            <textarea value={formData.healthConditions} onChange={(e) => fd('healthConditions', e.target.value)} placeholder="Early-stage dementia&#10;Mild arthritis" />
          </div>
          <div className="form-group">
            <label>Medications (one per line)</label>
            <textarea value={formData.medications} onChange={(e) => fd('medications', e.target.value)} placeholder="Donepezil 10mg daily&#10;Vitamin D" />
          </div>
          <div className="form-group">
            <label>Pets in the home</label>
            <input type="text" value={formData.pets} onChange={(e) => fd('pets', e.target.value)} placeholder="e.g., Golden Retriever, Orange tabby cat" />
          </div>
          <div className="form-group">
            <label>Pet allergies</label>
            <input type="text" value={formData.petAllergies} onChange={(e) => fd('petAllergies', e.target.value)} placeholder="e.g., Dander sensitivity" />
          </div>
          <div className="form-group">
            <label>Food allergies</label>
            <input type="text" value={formData.foodAllergies} onChange={(e) => fd('foodAllergies', e.target.value)} placeholder="e.g., Shellfish, nuts" />
          </div>
          <div className="form-group">
            <label>Additional medical conditions</label>
            <input type="text" value={formData.medicalConditions} onChange={(e) => fd('medicalConditions', e.target.value)} placeholder="e.g., Hypertension, Sleep apnea" />
          </div>
          <div className="form-group">
            <label>Preferences</label>
            <textarea value={formData.preferences} onChange={(e) => fd('preferences', e.target.value)} placeholder="Likes gardening, enjoys photo albums..." />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Emergency Contact Name</label>
              <input type="text" value={formData.emergencyContactName} onChange={(e) => fd('emergencyContactName', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Emergency Contact Phone</label>
              <input type="tel" value={formData.emergencyContactPhone} onChange={(e) => fd('emergencyContactPhone', e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button className="btn btn-primary" onClick={handleSaveRecipient}>{editingId ? 'Save Changes' : 'Add Recipient'}</button>
            <button className="btn btn-outline" onClick={() => { setShowAddForm(false); setEditingId(null); resetForm(); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
};
