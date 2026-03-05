const CareRecipients = window.CareRecipients = () => {
  const [recipients, setRecipients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    firstName: '', lastName: '', age: '', relationship: '', nickname: '', emoji: '', address: '', city: '', state: '', zip: '',
    phone: '', email: '',
    sameAddress: false, healthConditions: '', medications: '', pets: '', petAllergies: '', foodAllergies: '', medicalConditions: '', personality: '', preferences: '',
    emergencyContactName: '', emergencyContactPhone: '',
    authorizationTier: 'tier3',
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
      firstName: '', lastName: '', age: '', relationship: '', nickname: '', emoji: '', address: '', city: '', state: '', zip: '',
      phone: '', email: '',
      sameAddress: false, healthConditions: '', medications: '', pets: '', petAllergies: '', foodAllergies: '', medicalConditions: '', personality: '', preferences: '',
      emergencyContactName: '', emergencyContactPhone: '',
      authorizationTier: 'tier3',
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
      emoji: r.emoji || '',
      address: r.location_address || r.address || '',
      city: r.location_city || r.city || '',
      state: r.location_state || r.state || '',
      zip: r.location_zip || r.zip || '',
      phone: r.sms_phone || r.phone || '',
      email: r.email || '',
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
      authorizationTier: r.authorization_tier || 'tier3',
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
      address: formData.address || null,
      emoji: formData.emoji || null,
      city: formData.city,
      state: formData.state,
      zip: formData.zip || null,
      phone: formData.phone || null,
      email: formData.email || null,
      healthConditions: formData.healthConditions.split('\n').map(s => s.trim()).filter(Boolean),
      medications: formData.medications.split('\n').map(s => s.trim()).filter(Boolean),
      pets: formData.pets,
      petAllergies: formData.petAllergies,
      foodAllergies: formData.foodAllergies,
      medicalConditions: formData.medicalConditions,
      preferences: formData.preferences,
      emergencyContactName: formData.emergencyContactName,
      emergencyContactPhone: formData.emergencyContactPhone,
      authorizationTier: formData.authorizationTier || 'tier3',
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

  // Resize image on canvas before upload to keep payload small
  const resizeImage = (file, maxDim, quality) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          let w = img.width, h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
            else { w = Math.round(w * maxDim / h); h = maxDim; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = ev.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handlePhotoUpload = async (recipientId) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      setPhotoUploading(true);
      try {
        // Resize to 800px max dimension, JPEG 80% quality
        const base64 = await resizeImage(file, 800, 0.8);
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
      } catch (err) {
        console.error('Photo upload error:', err);
        showToast('Failed to upload photo', 'error');
      }
      setPhotoUploading(false);
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
    // Show emoji if set, otherwise show initials
    if (r.emoji) {
      return React.createElement('div', {
        style: { width: size, height: size, borderRadius: '50%', background: '#f5f0ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.55, cursor: clickable ? 'pointer' : 'default', flexShrink: 0 },
        onClick: clickable ? (e) => { e.stopPropagation(); handlePhotoUpload(r.id); } : undefined,
        title: clickable ? 'Click to add photo' : undefined,
      }, r.emoji);
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
            {r.consent_status && r.consent_status !== 'verified' && (
              <div style={{ marginTop: '6px', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, display: 'inline-block',
                background: r.consent_status === 'pending' ? '#FFF3E0' : r.consent_status === 'attested' ? '#E3F2FD' : '#fce4ec',
                color: r.consent_status === 'pending' ? '#e8724a' : r.consent_status === 'attested' ? '#1565C0' : '#c62828',
              }}>
                {r.consent_status === 'pending' ? '\u23F3 Pending' : r.consent_status === 'attested' ? '\u{1F4DD} Attested \u2014 awaiting code' : '\u274C ' + r.consent_status}
              </div>
            )}
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
              <p style={{ color: '#6c757d', marginTop: '8px' }}>{selected.emergency_contact_name || selected.emergencyContactName} — {formatPhone(selected.emergency_contact_phone || selected.emergencyContactPhone)}</p>
            </div>
          )}
        </div>
      )}

      {selected && !showAddForm && (selected.authorization_tier === 'tier3' || selected.authorization_tier === 'tier2') && selected.consent_status && selected.consent_status !== 'verified' && (
        <ConsentVerification
          recipientId={selected.id}
          recipientName={getName(selected)}
          consentStatus={selected.consent_status}
          authorizationTier={selected.authorization_tier}
          onStatusChange={fetchRecipients}
        />
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
          {!editingId && (
            <div className="form-group" style={{ marginTop: '8px' }}>
              <label style={{ fontWeight: 600, marginBottom: '8px', display: 'block' }}>Care Authorization</label>
              <p style={{ fontSize: '13px', color: '#666', marginBottom: '12px', marginTop: 0 }}>How are you authorized to arrange care for this person?</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[
                  { id: 'tier1', label: 'They signed up themselves', desc: 'The care recipient has their own account', color: '#1b6b5a', bg: '#e8f5f2' },
                  { id: 'tier2', label: 'I have Power of Attorney or legal guardianship', desc: 'You\'ll need to upload your legal document for review', color: '#5c6bc0', bg: '#e8eaf6' },
                  { id: 'tier3', label: 'They know and agree to me arranging care', desc: 'We\'ll verify their awareness before the first visit', color: '#e8724a', bg: '#FFF3E0' },
                ].map(opt => (
                  <div key={opt.id} onClick={() => fd('authorizationTier', opt.id)}
                    style={{
                      padding: '12px 16px', borderRadius: '10px', cursor: 'pointer',
                      border: formData.authorizationTier === opt.id ? `2px solid ${opt.color}` : '2px solid #e8e8e8',
                      background: formData.authorizationTier === opt.id ? opt.bg : '#fff',
                      transition: 'all 0.2s',
                    }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ width: 18, height: 18, borderRadius: '50%', border: formData.authorizationTier === opt.id ? `5px solid ${opt.color}` : '2px solid #ccc', flexShrink: 0, background: '#fff' }} />
                      <div>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: '#333' }}>{opt.label}</div>
                        <div style={{ fontSize: '12px', color: '#777', marginTop: '2px' }}>{opt.desc}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="form-group">
            <label>Avatar Emoji (optional)</label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
              {['👵', '👴', '👩', '👨', '🧓', '👶', '🧑', '🌷', '💜', '💙', '🌻', '🐕'].map(em => (
                <button key={em} type="button" onClick={() => fd('emoji', formData.emoji === em ? '' : em)} style={{
                  width: 40, height: 40, fontSize: 22, border: formData.emoji === em ? '2px solid #1b6b5a' : '1px solid #ddd',
                  borderRadius: 8, background: formData.emoji === em ? '#e0f2e9' : '#fff', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{em}</button>
              ))}
              {formData.emoji && (
                <button type="button" onClick={() => fd('emoji', '')} style={{
                  padding: '4px 10px', fontSize: 11, border: '1px solid #ddd', borderRadius: 8,
                  background: '#f5f5f5', color: '#888', cursor: 'pointer', alignSelf: 'center',
                }}>Clear</button>
              )}
            </div>
          </div>
          <div style={{ borderTop: '1px solid #eee', paddingTop: 12, marginTop: 8, marginBottom: 8 }}>
            <label style={{ fontWeight: 600, marginBottom: 8, display: 'block' }}>Contact & Address</label>
            <p style={{ fontSize: 13, color: '#666', marginTop: 0, marginBottom: 12 }}>Where does this person live? This helps verify their identity and lets caregivers find the location.</p>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Phone Number</label>
              <input type="tel" value={formData.phone} onChange={(e) => fd('phone', e.target.value)} placeholder="(555) 123-4567" />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input type="email" value={formData.email} onChange={(e) => fd('email', e.target.value)} placeholder="mom@email.com" />
              <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>Used for care awareness verification</div>
            </div>
          </div>
          <div className="form-group">
            <label>Street Address</label>
            <input type="text" value={formData.address} onChange={(e) => fd('address', e.target.value)} placeholder="123 Oak Lane" />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>City</label>
              <input type="text" value={formData.city} onChange={(e) => fd('city', e.target.value)} placeholder="Blacksburg" />
            </div>
            <div className="form-group" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label>State</label>
                <input type="text" value={formData.state} onChange={(e) => fd('state', e.target.value)} placeholder="VA" />
              </div>
              <div>
                <label>ZIP</label>
                <input type="text" value={formData.zip} onChange={(e) => fd('zip', e.target.value)} placeholder="24060" />
              </div>
            </div>
          </div>
          <div style={{ borderTop: '1px solid #eee', paddingTop: 12, marginTop: 8, marginBottom: 8 }}>
            <label style={{ fontWeight: 600, display: 'block' }}>Health Information</label>
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
              <input type="tel" value={formData.emergencyContactPhone} onChange={(e) => fd('emergencyContactPhone', formatPhone(e.target.value))} placeholder="(555) 123-4567" />
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
