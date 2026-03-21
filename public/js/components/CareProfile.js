const CareProfile = window.CareProfile = ({ onNavigate }) => {
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
  const [carePrefs, setCarePrefs] = useState({});
  const [careDetails, setCareDetails] = useState({});
  const [aiSummary, setAiSummary] = useState('');
  const [aiSummaryDate, setAiSummaryDate] = useState(null);
  const [generatingAI, setGeneratingAI] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsExpanded, setPrefsExpanded] = useState(false);
  const [showAllPrefs, setShowAllPrefs] = useState(false);
  const [editingSummary, setEditingSummary] = useState(false);
  const [editedSummary, setEditedSummary] = useState('');
  const [savingSummary, setSavingSummary] = useState(false);
  const { showToast } = useToast();

  const CARE_PREFS_LIST = [
    { id: 'meal_prep', label: 'Meal preparation & cooking', icon: '\uD83C\uDF73' },
    { id: 'housekeeping', label: 'Light housekeeping (tidying, dishes, laundry)', icon: '\uD83E\uDDF9' },
    { id: 'errands', label: 'Grocery shopping & errands', icon: '\uD83D\uDED2' },
    { id: 'med_reminders', label: 'Medication reminders (reminders only)', icon: '\uD83D\uDC8A' },
    { id: 'bathing', label: 'Help with bathing, grooming & dressing', icon: '\uD83D\uDEBF' },
    { id: 'fall_prevention', label: 'Fall prevention & mobility assistance', icon: '\uD83E\uDDAF' },
    { id: 'transportation', label: 'Transportation to appointments', icon: '\uD83D\uDE97' },
    { id: 'overnight', label: 'Overnight or evening supervision', icon: '\uD83C\uDF19' },
    { id: 'wandering', label: 'Wandering prevention', icon: '\uD83D\uDEAA' },
    { id: 'vitals', label: 'Vital signs monitoring (BP, temperature)', icon: '\uD83E\uDE7A' },
    { id: 'exercise', label: 'Exercise & physical therapy support', icon: '\uD83C\uDFCB\uFE0F' },
    { id: 'companionship', label: 'Companionship & conversation', icon: '\uD83D\uDCAC' },
    { id: 'hobbies', label: 'Engaging in hobbies & activities together', icon: '\uD83C\uDFA8' },
    { id: 'social_outings', label: 'Social outing accompaniment', icon: '\u26EA' },
    { id: 'patience', label: 'Patience with repetition & confusion', icon: '\uD83D\uDC9B' },
    { id: 'daily_updates', label: 'Daily updates & photos to family', icon: '\uD83D\uDCF8' },
    { id: 'consistent_caregiver', label: 'Consistent same-caregiver scheduling', icon: '\uD83E\uDD1D' },
    { id: 'condition_experience', label: 'Experience with specific conditions', icon: '\uD83D\uDCCB' },
    { id: 'pets', label: 'Comfortable with pets in the home', icon: '\uD83D\uDC3E' },
    { id: 'gardening', label: 'Gardening or light yard work', icon: '\uD83C\uDF31' },
    { id: 'outdoor_walks', label: 'Outdoor walks & fresh air time', icon: '\uD83D\uDEB6' },
    { id: 'socializing_out', label: 'Socializing away from home', icon: '\u2615' },
    { id: 'tech_help', label: 'Technology help (phone, tablet, video calls)', icon: '\uD83D\uDCF1' },
    { id: 'spiritual', label: 'Spiritual or religious practice support', icon: '\uD83D\uDD4A\uFE0F' },
  ];

  const PREF_FOLLOW_UPS = {
    med_reminders: 'How many medications? Any special timing?',
    wandering: 'How frequent? Any known triggers?',
    vitals: 'Which vitals? How often?',
    exercise: 'Any prescribed exercises or PT routines?',
    patience: 'Any specific behaviors we should know about?',
    condition_experience: 'What conditions does your loved one have?',
    pets: 'What kind of pets? Caregiver help needed?',
    spiritual: 'What faith or practice?',
    overnight: 'What does overnight supervision look like?',
    transportation: 'How often? Any regular appointments?',
  };

  const RATING_OPTIONS = [
    { value: 0, label: 'Not needed', color: '#e0e0e0', textColor: '#999' },
    { value: 1, label: 'Nice to have', color: '#fff3e0', textColor: '#e65100' },
    { value: 2, label: 'Important', color: '#e8f5e9', textColor: '#2e7d32' },
    { value: 3, label: 'Must have', color: '#1b6b5a', textColor: '#fff' },
  ];

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
            try { setCarePrefs(first.care_preferences ? JSON.parse(first.care_preferences) : {}); } catch { setCarePrefs({}); }
            try { setCareDetails(first.care_preference_details ? JSON.parse(first.care_preference_details) : {}); } catch { setCareDetails({}); }
            if (first.ai_care_summary) { setAiSummary(first.ai_care_summary); setAiSummaryDate(first.ai_care_summary_updated_at); }
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
      address: profile.location_address || '',
      city: profile.location_city || '',
      state: profile.location_state || '',
      zip: profile.location_zip || '',
      health_conditions: Array.isArray(hc) ? hc.join('\n') : '',
      medications: Array.isArray(meds) ? meds.join('\n') : '',
      preferences: profile.preferences || '',
      emergency_contact_name: profile.emergency_contact_name || '',
      emergency_contact_phone: formatPhone(profile.emergency_contact_phone) || '',
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
        address: editData.address || null,
        city: editData.city,
        state: editData.state,
        zip: editData.zip || null,
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
          location_address: editData.address,
          location_city: editData.city,
          location_state: editData.state,
          location_zip: editData.zip,
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

  const handlePrefRate = (id, value) => {
    const next = { ...carePrefs, [id]: value };
    setCarePrefs(next);
    if (value < 2 && careDetails[id]) {
      const nd = { ...careDetails }; delete nd[id]; setCareDetails(nd);
    }
  };

  const handlePrefDetail = (id, value) => setCareDetails({ ...careDetails, [id]: value });

  const savePreferences = async () => {
    if (!profile?.id) return;
    setSavingPrefs(true);
    try {
      const res = await apiFetch(`/api/care-recipients/${profile.id}/preferences`, {
        method: 'PUT', body: JSON.stringify({ preferences: carePrefs, details: careDetails }),
      });
      if (res?.ok) showToast('Care preferences saved', 'success');
      else showToast('Failed to save preferences', 'error');
    } catch { showToast('Failed to save preferences', 'error'); }
    setSavingPrefs(false);
  };

  const generateAISummary = async () => {
    if (!profile?.id) return;
    setSavingPrefs(true);
    try {
      await apiFetch(`/api/care-recipients/${profile.id}/preferences`, {
        method: 'PUT', body: JSON.stringify({ preferences: carePrefs, details: careDetails }),
      });
    } catch {}
    setSavingPrefs(false);

    setGeneratingAI(true);
    setAiSummary('');
    try {
      const res = await apiFetch(`/api/care-recipients/${profile.id}/generate-summary`, { method: 'POST' });
      if (res?.ok) {
        const data = await res.json();
        setAiSummary(data.summary);
        setAiSummaryDate(data.generatedAt);
        showToast('Care summary generated', 'success');
      } else {
        const d = await res?.json().catch(() => ({}));
        showToast(d.error || 'Failed to generate summary', 'error');
      }
    } catch { showToast('Failed to generate summary', 'error'); }
    setGeneratingAI(false);
  };

  const saveSummaryEdit = async () => {
    if (!profile?.id) return;
    setSavingSummary(true);
    try {
      const res = await apiFetch(`/api/care-recipients/${profile.id}`, {
        method: 'PUT',
        body: JSON.stringify({ aiCareSummary: editedSummary }),
      });
      if (res?.ok) {
        setAiSummary(editedSummary);
        setEditingSummary(false);
        showToast('Care summary updated', 'success');
      } else { showToast('Failed to save summary', 'error'); }
    } catch { showToast('Failed to save summary', 'error'); }
    setSavingSummary(false);
  };

  if (loading) return <LoadingSpinner text="Loading care profile..." />;
  if (!profile) return <EmptyState icon="👵" title="No care recipient found" text="Add a care recipient to get started." actionLabel="+ Add Your Loved One" onAction={() => onNavigate && onNavigate('recipients')} />;

  const canEdit = profile.access_level !== 'view';
  const healthConditions = parseJsonField(profile.health_conditions);
  const medications = parseJsonField(profile.medications);

  const inputStyle = { width: '100%', padding: '10px 12px', border: '1px solid #d0d0d0', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' };
  const textareaStyle = { ...inputStyle, minHeight: 80, resize: 'vertical' };
  const fieldLabel = { fontSize: 12, fontWeight: 600, color: '#666', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' };

  // Build address string
  const addressParts = [profile.location_address, profile.location_city, profile.location_state].filter(Boolean);
  const fullAddress = addressParts.length > 0
    ? (profile.location_address ? profile.location_address + ', ' : '') +
      [profile.location_city, profile.location_state].filter(Boolean).join(', ') +
      (profile.location_zip ? ' ' + profile.location_zip : '')
    : 'No address on file';

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h1 className="page-title">My Loved One</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!editing && onNavigate && (
            <button onClick={() => onNavigate('recipients')} style={{ padding: '8px 14px', background: '#fff', color: '#1b6b5a', border: '1.5px solid #1b6b5a', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
              + Add Another Person
            </button>
          )}
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

      {/* ─── 1. Compact Hero Card — Photo, Name, Age, Address, Emergency Contact ─── */}
      {!editing ? (
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <div onClick={handlePhotoUpload} style={{ cursor: 'pointer', position: 'relative', width: 72, height: 72, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: '#e8f5e9' }} title="Click to change photo">
              {profile.photo
                ? <img src={profile.photo} alt={profile.first_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ fontSize: 28, fontWeight: 700, color: '#1b6b5a', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>{profile.first_name?.[0]}{profile.last_name?.[0]}</span>}
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.45)', color: '#fff', fontSize: 9, textAlign: 'center', padding: '2px 0', fontWeight: 600 }}>
                {photoUploading ? '...' : '\uD83D\uDCF7'}
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#1a1a2e', lineHeight: 1.2 }}>
                {profile.first_name} {profile.last_name}
                <span style={{ fontSize: 14, fontWeight: 400, color: '#888', marginLeft: 8 }}>{profile.age} years old</span>
              </div>
              <div style={{ fontSize: 13, color: '#555', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ flexShrink: 0 }}>{'\uD83D\uDCCD'}</span>
                <span>{fullAddress}</span>
              </div>
              {profile.emergency_contact_name && (
                <div style={{ fontSize: 12, color: '#888', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ flexShrink: 0 }}>{'\uD83D\uDEA8'}</span>
                  <span>Emergency: {profile.emergency_contact_name}{profile.emergency_contact_phone ? ' \u00B7 ' + formatPhone(profile.emergency_contact_phone) : ''}</span>
                  {profile.emergency_contact_phone && (
                    <a href={'tel:' + profile.emergency_contact_phone.replace(/\D/g, '')}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 12, background: '#e8f5e9', color: '#1b6b5a', fontSize: 11, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                      {'\uD83D\uDCDE'} Call
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-header" style={{ marginBottom: 12 }}><span className="card-icon">{'\uD83D\uDC64'}</span>Profile Details</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={fieldLabel}>First Name</div>
              <input style={inputStyle} value={editData.first_name} onChange={(e) => ed('first_name', e.target.value)} placeholder="First name" />
            </div>
            <div>
              <div style={fieldLabel}>Last Name</div>
              <input style={inputStyle} value={editData.last_name} onChange={(e) => ed('last_name', e.target.value)} placeholder="Last name" />
            </div>
            <div>
              <div style={fieldLabel}>Age</div>
              <input type="number" style={inputStyle} value={editData.age} onChange={(e) => ed('age', e.target.value)} />
            </div>
            <div>
              <div style={fieldLabel}>Street Address</div>
              <input style={inputStyle} value={editData.address} onChange={(e) => ed('address', e.target.value)} placeholder="123 Main Street" />
            </div>
            <div>
              <div style={fieldLabel}>City</div>
              <input style={inputStyle} value={editData.city} onChange={(e) => ed('city', e.target.value)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <div style={fieldLabel}>State</div>
                <input style={inputStyle} value={editData.state} onChange={(e) => ed('state', e.target.value)} />
              </div>
              <div>
                <div style={fieldLabel}>ZIP</div>
                <input style={inputStyle} value={editData.zip} onChange={(e) => ed('zip', e.target.value)} placeholder="24060" />
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12, paddingTop: 12, borderTop: '1px solid #eee' }}>
            <div>
              <div style={fieldLabel}>Emergency Contact Name</div>
              <input style={inputStyle} value={editData.emergency_contact_name} onChange={(e) => ed('emergency_contact_name', e.target.value)} />
            </div>
            <div>
              <div style={fieldLabel}>Emergency Contact Phone</div>
              <input type="tel" style={inputStyle} value={editData.emergency_contact_phone} onChange={(e) => ed('emergency_contact_phone', formatPhone(e.target.value))} placeholder="(555) 123-4567" />
            </div>
          </div>
        </div>
      )}

      {/* ─── 2. iPAi Care Intelligence (replaces old Care Summary) ─── */}
      {profile && (
        <IPAiInsightsCard recipientId={profile.id} recipientName={profile.first_name} existingSummary={aiSummary} />
      )}

      {/* Old Care Summary section removed — replaced by iPAi Intelligence (section 2 above) */}

      {/* ─── 3. Health Conditions & Medications (combined, compact) ─── */}
      <div className="card">
        <div className="card-header"><span className="card-icon">{'\u2695\uFE0F'}</span>Health & Medications</div>
        {editing ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={{ ...fieldLabel, marginBottom: 8 }}>Health Conditions (one per line)</div>
              <textarea style={textareaStyle} value={editData.health_conditions} onChange={(e) => ed('health_conditions', e.target.value)} placeholder="Early-stage dementia&#10;Mild arthritis&#10;..." />
            </div>
            <div>
              <div style={{ ...fieldLabel, marginBottom: 8 }}>Medications (one per line)</div>
              <textarea style={textareaStyle} value={editData.medications} onChange={(e) => ed('medications', e.target.value)} placeholder="Donepezil 10mg daily&#10;Vitamin D 1000IU&#10;..." />
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Conditions</div>
              {healthConditions.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {healthConditions.map((c, i) => (
                    <div key={i} style={{ fontSize: 13, color: '#333', paddingLeft: 10, borderLeft: '2px solid #1b6b5a' }}>{c}</div>
                  ))}
                </div>
              ) : <span style={{ fontSize: 13, color: '#999' }}>None listed</span>}
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Medications</div>
              {medications.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {medications.map((m, i) => (
                    <div key={i} style={{ fontSize: 13, color: '#333', paddingLeft: 10, borderLeft: '2px solid #e8724a' }}>{m}</div>
                  ))}
                </div>
              ) : <span style={{ fontSize: 13, color: '#999' }}>None listed</span>}
            </div>
          </div>
        )}
      </div>

      {/* ─── 4. Care Preferences (collapsible) ─── */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
          onClick={() => setPrefsExpanded(!prefsExpanded)}>
          <div className="card-header" style={{ margin: 0 }}>
            <span className="card-icon">{'\u2728'}</span>Care Preferences
            {Object.keys(carePrefs).length > 0 && (
              <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 600, color: '#1b6b5a', background: '#e8f5e9', padding: '2px 8px', borderRadius: 10 }}>
                {Object.keys(carePrefs).length}/{CARE_PREFS_LIST.length} rated
              </span>
            )}
          </div>
          <span style={{ fontSize: 18, color: '#999', transition: 'transform 0.2s', transform: prefsExpanded ? 'rotate(180deg)' : 'rotate(0)' }}>{'\u25BC'}</span>
        </div>

        {prefsExpanded && (
          <div style={{ marginTop: 16 }}>
            <div style={{ background: '#fff3e0', border: '2px solid #e8724a', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 20, flexShrink: 0 }}>{'\u2695\uFE0F'}</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#bf360c', marginBottom: 2 }}>InPlace is not a medical service</div>
                <div style={{ fontSize: 12, color: '#5d4037', lineHeight: 1.5 }}>Our caregivers provide companion care and daily living assistance. They do not diagnose, treat, administer medication, or perform medical procedures.</div>
              </div>
            </div>

            <p style={{ fontSize: 13, color: '#888', margin: '0 0 12px' }}>
              Rate what matters for {profile.first_name}'s care. For important items, add details to help match the right caregiver. You can update these anytime.
            </p>

            <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
              {RATING_OPTIONS.map(r => (
                <div key={r.value} style={{ padding: '3px 8px', borderRadius: 5, fontSize: 11, fontWeight: 600, background: r.color, color: r.textColor, border: '1px solid #ddd' }}>{r.label}</div>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(showAllPrefs ? CARE_PREFS_LIST : CARE_PREFS_LIST.slice(0, 10)).map(pref => {
                const val = carePrefs[pref.id] || 0;
                const hasFollowUp = PREF_FOLLOW_UPS[pref.id];
                const showDetail = hasFollowUp && val >= 2;
                return (
                  <div key={pref.id} style={{ borderRadius: 8, background: val > 0 ? RATING_OPTIONS[val].color + '40' : '#fafafa', border: '1px solid ' + (val > 0 ? RATING_OPTIONS[val].color : '#eee'), transition: 'all 0.2s', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
                      <span style={{ fontSize: 18, width: 24, textAlign: 'center', flexShrink: 0 }}>{pref.icon}</span>
                      <div style={{ flex: 1, fontSize: 13, fontWeight: 500, color: '#333', lineHeight: 1.3 }}>{pref.label}</div>
                      <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                        {RATING_OPTIONS.map(r => (
                          <button key={r.value} onClick={() => handlePrefRate(pref.id, r.value)} style={{
                            padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600,
                            border: val === r.value ? '2px solid #1b6b5a' : '1px solid #ddd',
                            background: val === r.value ? r.color : '#fff',
                            color: val === r.value ? r.textColor : '#999',
                            cursor: 'pointer', transition: 'all 0.15s',
                          }}>{r.label}</button>
                        ))}
                      </div>
                    </div>
                    {showDetail && (
                      <div style={{ padding: '0 12px 10px 46px' }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#1b6b5a', marginBottom: 3 }}>
                          {hasFollowUp} <span style={{ fontWeight: 400, color: '#999' }}>(optional)</span>
                        </div>
                        <input type="text" value={careDetails[pref.id] || ''} onChange={(e) => handlePrefDetail(pref.id, e.target.value)}
                          placeholder="Add details..."
                          style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #ccc', fontSize: 12, color: '#333', boxSizing: 'border-box', fontFamily: 'inherit' }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {!showAllPrefs && (
              <button onClick={() => setShowAllPrefs(true)} style={{
                width: '100%', padding: '10px', marginTop: 8, borderRadius: 8,
                border: '1px dashed #ccc', background: '#fafafa', color: '#666',
                fontWeight: 600, fontSize: 13, cursor: 'pointer',
              }}>Show {CARE_PREFS_LIST.length - 10} more preferences</button>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              <button onClick={savePreferences} disabled={savingPrefs} style={{
                padding: '10px 20px', borderRadius: 8, border: '1px solid #1b6b5a',
                background: '#fff', color: '#1b6b5a', fontWeight: 600, fontSize: 13,
                cursor: savingPrefs ? 'wait' : 'pointer',
              }}>{savingPrefs ? 'Saving...' : 'Save Preferences'}</button>
              <button onClick={generateAISummary} disabled={generatingAI || Object.values(carePrefs).filter(v => v > 0).length < 3} style={{
                padding: '10px 20px', borderRadius: 8, border: 'none',
                background: Object.values(carePrefs).filter(v => v > 0).length >= 3 ? '#1b6b5a' : '#ccc',
                color: '#fff', fontWeight: 600, fontSize: 13,
                cursor: (generatingAI || Object.values(carePrefs).filter(v => v > 0).length < 3) ? 'default' : 'pointer',
              }}>{generatingAI ? 'Generating...' : '\u2728 Generate Care Summary with inPlace\'s AI tool'}</button>
            </div>
          </div>
        )}
      </div>

      {/* ─── 5. Care Notes ─── */}
      <div className="card">
        <div className="card-header"><span className="card-icon">{'\uD83D\uDCDD'}</span>Care Notes</div>
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
                {' \u00B7 '}{(parseTimestamp(n.created_at) || new Date()).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
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

      {/* ─── 6. Permission Controls (owner only, bottom) ─── */}
      {canEdit && (
        profile?.linked_user_id ? (
        <div className="card" style={{ marginBottom: 16, border: '1px solid #e0e0e0' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{'\uD83D\uDD10'}</span> {profile.first_name}'s App Permissions
          </div>
          <p style={{ fontSize: 12, color: '#888', marginBottom: 14, lineHeight: 1.5 }}>
            Control what {profile.first_name} sees and can do when they log into their own account.
          </p>

          <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
            {[
              { id: 'full', label: 'Full Control', desc: 'Can view and edit everything', icon: '\uD83D\uDFE2' },
              { id: 'collaborative', label: 'Collaborative', desc: 'Can view selected info, can add notes', icon: '\uD83D\uDFE1' },
              { id: 'managed', label: 'Managed', desc: 'View-only for selected info', icon: '\uD83D\uDD34' },
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

          {permTier !== 'full' && visSettings && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#666', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {profile.first_name} can see:
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 6 }}>
                {[
                  { key: 'calendar', label: 'Calendar / Schedule', icon: '\uD83D\uDCC5' },
                  { key: 'healthConditions', label: 'Health Conditions', icon: '\uD83E\uDE7A' },
                  { key: 'medications', label: 'Medications', icon: '\uD83D\uDC8A' },
                  { key: 'allergies', label: 'Allergies', icon: '\u26A0\uFE0F' },
                  { key: 'preferences', label: 'Care Preferences', icon: '\u2728' },
                  { key: 'pets', label: 'Pets at Home', icon: '\uD83D\uDC3E' },
                  { key: 'emergencyContact', label: 'Emergency Contact', icon: '\uD83C\uDD98' },
                  { key: 'notes', label: 'Notes', icon: '\uD83D\uDCDD' },
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
        ) : (
        <div className="card" style={{ marginBottom: 16, border: '1px solid #e0e0e0', opacity: 0.55 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{'\uD83D\uDD10'}</span> {profile.first_name}'s App Permissions
          </div>
          <p style={{ fontSize: 13, color: '#888', margin: 0, lineHeight: 1.5 }}>
            Control {profile.first_name}'s access on the app if {profile.first_name} joins. Once {profile.first_name} has their own account linked here, you'll be able to choose what they can see and do.
          </p>
          <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap', pointerEvents: 'none' }}>
            {[
              { label: 'Full Control', icon: '\uD83D\uDFE2' },
              { label: 'Collaborative', icon: '\uD83D\uDFE1' },
              { label: 'Managed', icon: '\uD83D\uDD34' },
            ].map(t => (
              <div key={t.label} style={{
                flex: '1 1 120px', padding: '8px 10px', border: '1px solid #e0e0e0',
                borderRadius: 10, background: '#fafafa', textAlign: 'left',
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#aaa' }}>{t.icon} {t.label}</div>
              </div>
            ))}
          </div>
        </div>
        )
      )}

      {/* ── Care Team shortcut card ── */}
      {!editing && onNavigate && (
        <div className="card" style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', cursor: 'pointer' }} onClick={() => onNavigate('care-team')}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#1b6b5a' }}>👪 Care Team</div>
            <div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>View members, invite family, and manage caregivers</div>
          </div>
          <span style={{ fontSize: 20, color: '#ccc' }}>›</span>
        </div>
      )}
    </>
  );
};
