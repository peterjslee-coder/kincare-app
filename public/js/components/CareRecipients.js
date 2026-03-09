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
  const [intlPhone, setIntlPhone] = useState(false);
  const [intlEmergencyPhone, setIntlEmergencyPhone] = useState(false);
  const { showToast } = useToast();

  // Wizard state — restore from sessionStorage if user was mid-wizard
  const storedWizard = (() => {
    try {
      const s = sessionStorage.getItem('inplace_wizard');
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  })();
  const [wizardStep, _setWizardStep] = useState(storedWizard?.step ?? null);
  const [savedRecipientId, _setSavedRecipientId] = useState(storedWizard?.recipientId ?? null);

  // Wrap setters to auto-persist wizard progress to sessionStorage
  const setWizardStep = (step) => {
    _setWizardStep(step);
    // Scroll to top — try .main-content container first (desktop layout), fall back to window
    const mc = document.querySelector('.main-content');
    if (mc) mc.scrollTo({ top: 0, behavior: 'smooth' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    try {
      if (step === null) {
        sessionStorage.removeItem('inplace_wizard');
      } else {
        const cur = JSON.parse(sessionStorage.getItem('inplace_wizard') || '{}');
        sessionStorage.setItem('inplace_wizard', JSON.stringify({ ...cur, step }));
      }
    } catch {}
  };
  const setSavedRecipientId = (id) => {
    _setSavedRecipientId(id);
    try {
      if (id === null) {
        const cur = JSON.parse(sessionStorage.getItem('inplace_wizard') || '{}');
        delete cur.recipientId;
        if (Object.keys(cur).length) sessionStorage.setItem('inplace_wizard', JSON.stringify(cur));
        else sessionStorage.removeItem('inplace_wizard');
      } else {
        const cur = JSON.parse(sessionStorage.getItem('inplace_wizard') || '{}');
        sessionStorage.setItem('inplace_wizard', JSON.stringify({ ...cur, recipientId: id }));
      }
    } catch {}
  };
  const [carePrefs, setCarePrefs] = useState({});
  const [careDetails, setCareDetails] = useState({});
  const [showAllPrefs, setShowAllPrefs] = useState(false);
  const [attestAgreed, setAttestAgreed] = useState(false);
  const [attestSignature, setAttestSignature] = useState('');
  const [attestRelationship, setAttestRelationship] = useState('');
  const [attestNotifyMethod, setAttestNotifyMethod] = useState('email');
  const [attestLoading, setAttestLoading] = useState(false);
  const [attestError, setAttestError] = useState('');
  const [prefsLoading, setPrefsLoading] = useState(false);
  // Stripe Connect state (hoisted from WizardStep3 to avoid conditional hooks)
  const [stripeLoading, setStripeLoading] = useState(false);
  const [stripeStatus, setStripeStatus] = useState(null); // null, 'pending', 'complete'

  const CARE_PREFS_LIST = [
    { id: 'meal_prep', label: 'Meal preparation & cooking', icon: '🍳' },
    { id: 'housekeeping', label: 'Light housekeeping (tidying, dishes, laundry)', icon: '🧹' },
    { id: 'errands', label: 'Grocery shopping & errands', icon: '🛒' },
    { id: 'med_reminders', label: 'Medication reminders (reminders only)', icon: '💊' },
    { id: 'bathing', label: 'Help with bathing, grooming & dressing', icon: '🚿' },
    { id: 'fall_prevention', label: 'Fall prevention & mobility assistance', icon: '🦯' },
    { id: 'transportation', label: 'Transportation to appointments', icon: '🚗' },
    { id: 'overnight', label: 'Overnight or evening supervision', icon: '🌙' },
    { id: 'wandering', label: 'Wandering prevention', icon: '🚪' },
    { id: 'vitals', label: 'Vital signs monitoring (BP, temperature)', icon: '🩺' },
    { id: 'exercise', label: 'Exercise & physical therapy support', icon: '🏋️' },
    { id: 'companionship', label: 'Companionship & conversation', icon: '💬' },
    { id: 'hobbies', label: 'Engaging in hobbies & activities together', icon: '🎨' },
    { id: 'social_outings', label: 'Social outing accompaniment', icon: '⛪' },
    { id: 'patience', label: 'Patience with repetition & confusion', icon: '💛' },
    { id: 'daily_updates', label: 'Daily updates & photos to family', icon: '📸' },
    { id: 'consistent_caregiver', label: 'Consistent same-caregiver scheduling', icon: '🤝' },
    { id: 'condition_experience', label: 'Experience with specific conditions', icon: '📋' },
    { id: 'pets', label: 'Comfortable with pets in the home', icon: '🐾' },
    { id: 'gardening', label: 'Gardening or light yard work', icon: '🌱' },
    { id: 'outdoor_walks', label: 'Outdoor walks & fresh air time', icon: '🚶' },
    { id: 'socializing_out', label: 'Socializing away from home', icon: '☕' },
    { id: 'tech_help', label: 'Technology help (phone, tablet, video calls)', icon: '📱' },
    { id: 'spiritual', label: 'Spiritual or religious practice support', icon: '🕊️' },
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

  // Restore form data when resuming wizard from sessionStorage
  useEffect(() => {
    if (savedRecipientId && wizardStep !== null && !formData.firstName) {
      // Fetch the recipient's data to repopulate formData
      (async () => {
        try {
          const res = await apiFetch(`/api/care-recipients/${savedRecipientId}`);
          if (res?.ok) {
            const data = await res.json();
            const r = data.careRecipient || data;
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
              phone: r.phone || r.sms_phone || '',
              email: r.email || '',
              sameAddress: false,
              healthConditions: parseField(r.health_conditions),
              medications: parseField(r.medications),
              pets: r.pets || '',
              petAllergies: r.pet_allergies || r.petAllergies || '',
              foodAllergies: r.food_allergies || r.foodAllergies || '',
              medicalConditions: r.medical_conditions || r.medicalConditions || '',
              personality: r.personality || '',
              preferences: r.preferences || '',
              emergencyContactName: r.emergency_contact_name || r.emergencyContactName || '',
              emergencyContactPhone: r.emergency_contact_phone || r.emergencyContactPhone || '',
              authorizationTier: r.authorization_tier || r.authorizationTier || 'tier3',
            });
          }
        } catch (err) { console.error('Error restoring recipient data:', err); }
      })();
    }
  }, [savedRecipientId, wizardStep]);

  // Auto-start wizard when a new user arrives with no recipients
  useEffect(() => {
    if (!loading && recipients.length === 0 && !showAddForm && wizardStep === null) {
      resetForm();
      setEditingId(null);
      setShowAddForm(true);
      setWizardStep(null);
      setSavedRecipientId(null);
    }
  }, [loading, recipients.length]);

  // Check Stripe Connect status when entering step 3 (wizardStep === 2)
  useEffect(() => {
    if (wizardStep !== 2) return;
    (async () => {
      try {
        const res = await apiFetch('/api/payments/family/status');
        if (res?.ok) {
          const data = await res.json();
          if (data.status === 'complete') setStripeStatus('complete');
          else if (data.status === 'pending') setStripeStatus('pending');
        }
      } catch (err) {
        console.log('Stripe status check:', err.message);
      }
    })();
  }, [wizardStep]);

  const resetForm = () => {
    setFormData({
      firstName: '', lastName: '', age: '', relationship: '', nickname: '', emoji: '', address: '', city: '', state: '', zip: '',
      phone: '', email: '',
      sameAddress: false, healthConditions: '', medications: '', pets: '', petAllergies: '', foodAllergies: '', medicalConditions: '', personality: '', preferences: '',
      emergencyContactName: '', emergencyContactPhone: '',
      authorizationTier: 'tier3',
    });
    setWizardStep(null);
    setSavedRecipientId(null);
    setCarePrefs({});
    setCareDetails({});
    setShowAllPrefs(false);
    setAttestAgreed(false);
    setAttestSignature('');
    setAttestRelationship('');
    setAttestNotifyMethod('email');
    setAttestError('');
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
        const data = await response.json();
        const msg = editingId ? 'Recipient updated!' : 'Recipient added!';
        setSaveMsg(msg);
        showToast(msg, 'success');

        if (!editingId) {
          // New recipient - start wizard
          const newId = data.id || data.careRecipient?.id;
          setSavedRecipientId(newId);
          setWizardStep(1);
        } else if (savedRecipientId) {
          // Editing within wizard flow - continue wizard
          setWizardStep(1);
          setEditingId(null);
        } else {
          // Editing existing (not in wizard) - close normally
          await fetchRecipients();
          setTimeout(() => { setShowAddForm(false); setEditingId(null); resetForm(); setSaveMsg(''); }, 1500);
        }
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

  const handleSavePreferences = async () => {
    if (!savedRecipientId) return;
    setPrefsLoading(true);
    try {
      const res = await apiFetch(`/api/care-recipients/${savedRecipientId}/preferences`, {
        method: 'PUT',
        body: JSON.stringify({ preferences: carePrefs, details: careDetails }),
      });
      if (res?.ok) {
        showToast('Preferences saved!', 'success');
        setWizardStep(2);
      } else {
        showToast('Error saving preferences', 'error');
      }
    } catch (err) {
      console.error('Error saving preferences:', err);
      showToast('Error saving preferences', 'error');
    }
    setPrefsLoading(false);
  };

  const handleAttestAndNotify = async () => {
    if (!attestAgreed || !attestSignature || !attestRelationship) {
      setAttestError('Please fill in all required fields');
      return;
    }
    if (!attestSignature.trim() || attestSignature.trim().split(/\s+/).length < 2) {
      setAttestError('Please type your full legal name as your signature.');
      return;
    }

    setAttestLoading(true);
    setAttestError('');

    try {
      // POST attestation (matches ConsentVerification.js API)
      const attestRes = await apiFetch(`/api/consent/${savedRecipientId}/attest`, {
        method: 'POST',
        body: JSON.stringify({
          signatureName: attestSignature.trim(),
          relationshipToRecipient: attestRelationship,
          recipientEmail: formData.email?.trim() || undefined,
          recipientPhone: formData.phone?.trim() || undefined,
        }),
      });

      if (!attestRes?.ok) {
        setAttestError('Error submitting attestation');
        setAttestLoading(false);
        return;
      }

      // POST outreach/notification — don't block wizard if email fails
      let outreachMsg = 'Attestation submitted!';
      try {
        const notifyRes = await apiFetch(`/api/consent/${savedRecipientId}/send-outreach`, {
          method: 'POST',
          body: JSON.stringify({
            method: attestNotifyMethod,
          }),
        });
        if (notifyRes?.ok) {
          const notifyData = await notifyRes.json();
          outreachMsg = notifyData.message || 'Attestation submitted and verification email sent!';
        } else {
          outreachMsg = 'Attestation submitted! Verification email will be sent once email is configured.';
        }
      } catch (emailErr) {
        console.warn('Outreach send failed (non-blocking):', emailErr.message);
        outreachMsg = 'Attestation submitted! Verification email will be sent shortly.';
      }
      showToast(outreachMsg, 'success');
      setWizardStep(4);
    } catch (err) {
      console.error('Attestation error:', err);
      setAttestError('Error completing attestation');
    }
    setAttestLoading(false);
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

  const WizardProgressBar = ({ currentStep }) => {
    const steps = ['Add Your Loved One', 'Care Preferences', 'Verify Identity', 'Attest & Notify', 'All Set!'];
    const tier3 = formData.authorizationTier === 'tier3';
    const displaySteps = tier3 ? steps : [steps[0], steps[1], steps[2], steps[4]];
    // Map display index → wizardStep value (null=form, 1=prefs, 2=verify, 3=attest, 4=done)
    const stepMap = tier3
      ? [null, 1, 2, 3, 4]
      : [null, 1, 2, 4];

    const handleStepClick = (idx) => {
      if (idx >= currentStep) return; // Can only go back to completed steps
      const targetStep = stepMap[idx];
      if (targetStep === null) {
        // Go back to edit form
        setShowAddForm(true);
        if (savedRecipientId) setEditingId(savedRecipientId);
        setWizardStep(null);
      } else {
        setWizardStep(targetStep);
      }
    };

    return (
      <div style={{ marginBottom: '32px', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
          {displaySteps.map((step, idx) => {
            const isCompleted = idx < currentStep;
            const isCurrent = idx === currentStep;
            const isClickable = isCompleted;
            return (
              <div key={idx} onClick={() => isClickable && handleStepClick(idx)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, cursor: isClickable ? 'pointer' : 'default' }}>
                <div style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: isCompleted ? '#2e7d32' : isCurrent ? '#e8724a' : '#e0e0e0',
                  color: isCompleted || isCurrent ? '#fff' : '#999',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 600,
                  fontSize: 14,
                  zIndex: 2,
                  position: 'relative',
                  transition: 'transform 0.15s',
                  ...(isClickable ? { ':hover': { transform: 'scale(1.1)' } } : {}),
                }}>
                  {isCompleted ? '✓' : (idx + 1)}
                </div>
                <div style={{ fontSize: 12, marginTop: 8, textAlign: 'center', maxWidth: 100, color: isCurrent ? '#333' : isClickable ? '#2e7d32' : '#999', fontWeight: isClickable ? 500 : 400 }}>
                  {step}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{
          position: 'absolute',
          top: 20,
          left: 0,
          right: 0,
          height: 2,
          background: '#e0e0e0',
          zIndex: 1,
          width: '100%',
        }} />
        <div style={{
          position: 'absolute',
          top: 20,
          left: 0,
          height: 2,
          background: '#2e7d32',
          zIndex: 1,
          width: `${(currentStep / displaySteps.length) * 100}%`,
          transition: 'width 0.3s ease',
        }} />
      </div>
    );
  };

  // Wizard Step 1: Add Your Loved One (already shown in form)
  // Wizard Step 2: Care Preferences
  const WizardStep2 = () => {
    const displayedPrefs = showAllPrefs ? CARE_PREFS_LIST : CARE_PREFS_LIST.slice(0, 10);

    return (
      <div className="card" style={{ marginTop: '32px', borderLeft: '4px solid #1b6b5a' }}>
        <WizardProgressBar currentStep={1} />
        <h3 style={{ marginBottom: '8px', color: '#1b6b5a' }}>Care Preferences</h3>
        <p style={{ color: '#666', fontSize: 14, marginBottom: '24px' }}>
          Tell us about the care your loved one needs. We'll use this to match you with the right caregivers.
        </p>

        <div>
          {displayedPrefs.map(pref => (
            <div key={pref.id} style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                <span style={{ fontSize: 20 }}>{pref.icon}</span>
                <span style={{ flex: 1, fontWeight: 500, color: '#333' }}>{pref.label}</span>
              </div>
              <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                {RATING_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setCarePrefs({ ...carePrefs, [pref.id]: opt.value })}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      border: carePrefs[pref.id] === opt.value ? `2px solid ${opt.color}` : '1px solid #ddd',
                      background: carePrefs[pref.id] === opt.value ? opt.color : '#fff',
                      color: carePrefs[pref.id] === opt.value ? opt.textColor : '#666',
                      fontSize: 12,
                      fontWeight: carePrefs[pref.id] === opt.value ? 600 : 500,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {pref.id === 'med_reminders' && carePrefs[pref.id] >= 1 && (
                <div style={{ marginTop: '6px', marginLeft: '32px', padding: '6px 10px', background: '#e8f5e9', borderRadius: 6, fontSize: 12, color: '#2e7d32' }}>
                  💊 Note: Caregivers can remind your loved one to take their medication — they do not administer or handle medications directly.
                </div>
              )}
              {carePrefs[pref.id] >= 2 && PREF_FOLLOW_UPS[pref.id] && (
                <div style={{ marginTop: '8px', marginLeft: '32px' }}>
                  <input
                    type="text"
                    placeholder={PREF_FOLLOW_UPS[pref.id]}
                    value={careDetails[pref.id] || ''}
                    onChange={(e) => setCareDetails({ ...careDetails, [pref.id]: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      border: '1px solid #ddd',
                      fontSize: 13,
                      fontStyle: 'italic',
                    }}
                  />
                </div>
              )}
            </div>
          ))}

          {!showAllPrefs && CARE_PREFS_LIST.length > 10 && (
            <button
              type="button"
              onClick={() => setShowAllPrefs(true)}
              style={{
                padding: '8px 12px',
                color: '#1b6b5a',
                background: '#e8f5f2',
                border: '1px solid #1b6b5a',
                borderRadius: '6px',
                fontWeight: 500,
                fontSize: 13,
                cursor: 'pointer',
                marginTop: '16px',
              }}
            >
              Show {CARE_PREFS_LIST.length - 10} more preferences
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: '12px', marginTop: '32px' }}>
          <button
            className="btn btn-primary"
            onClick={handleSavePreferences}
            disabled={prefsLoading}
            style={{ opacity: prefsLoading ? 0.6 : 1, cursor: prefsLoading ? 'not-allowed' : 'pointer' }}
          >
            {prefsLoading ? 'Saving...' : 'Continue'}
          </button>
          <button
            className="btn btn-outline"
            onClick={() => {
              setWizardStep(null);
              if (savedRecipientId) setEditingId(savedRecipientId);
            }}
          >
            Back
          </button>
        </div>
      </div>
    );
  };

  // Wizard Step 3: Verify Identity & Set Up Payments (Stripe Connect)
  const WizardStep3 = () => {
    const handleStripeConnect = async () => {
      setStripeLoading(true);
      try {
        const res = await apiFetch('/api/payments/family/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ returnUrl: window.location.href }),
        });
        if (res?.ok) {
          const data = await res.json();
          if (data.url) {
            window.location.href = data.url;
          }
        } else {
          alert('Unable to start Stripe setup. Please try again.');
        }
      } catch (err) {
        console.error('Stripe Connect error:', err);
        alert('Unable to connect to Stripe. Please try again.');
      } finally {
        setStripeLoading(false);
      }
    };

    return (
      <div className="card" style={{ marginTop: '32px', borderLeft: '4px solid #1b6b5a' }}>
        <WizardProgressBar currentStep={2} />
        <h3 style={{ marginBottom: '24px', color: '#1b6b5a' }}>Verify Identity & Set Up Payments</h3>

        {/* Identity Verification Section */}
        <div style={{
          padding: '24px',
          borderRadius: '12px',
          border: '1px solid #e0e0e0',
          background: '#fafafa',
          marginBottom: '20px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: '#e8f5e9', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18,
            }}>🛡️</div>
            <div>
              <h4 style={{ margin: 0, color: '#333', fontSize: 16 }}>Identity Verification</h4>
              <p style={{ margin: 0, color: '#888', fontSize: 13 }}>Verify your identity with a photo ID</p>
            </div>
          </div>
          <div style={{
            display: 'inline-block',
            padding: '6px 12px',
            background: '#fff3e0',
            color: '#e8724a',
            borderRadius: '6px',
            fontSize: 12,
            fontWeight: 600,
          }}>
            Coming Soon — Powered by Stripe Identity
          </div>
          <p style={{ color: '#666', fontSize: 13, marginTop: '12px', marginBottom: 0 }}>
            Identity verification will be required before care can begin. We'll notify you when this is available.
          </p>
        </div>

        {/* Stripe Connect Payment Section */}
        <div style={{
          padding: '24px',
          borderRadius: '12px',
          border: stripeStatus === 'complete' ? '2px solid #4caf50' : '1px solid #e0e0e0',
          background: stripeStatus === 'complete' ? '#e8f5e9' : '#fff',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: stripeStatus === 'complete' ? '#c8e6c9' : '#e3f2fd',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18,
            }}>{stripeStatus === 'complete' ? '✅' : '💳'}</div>
            <div>
              <h4 style={{ margin: 0, color: '#333', fontSize: 16 }}>Payment Setup</h4>
              <p style={{ margin: 0, color: '#888', fontSize: 13 }}>
                {stripeStatus === 'complete'
                  ? 'Stripe Connect is set up and ready'
                  : 'Set up secure payments via Stripe Connect'}
              </p>
            </div>
          </div>

          {stripeStatus === 'complete' ? (
            <div style={{
              padding: '12px 16px',
              background: '#c8e6c9',
              borderRadius: '8px',
              color: '#2e7d32',
              fontSize: 14,
              fontWeight: 500,
            }}>
              Payment setup complete. You're ready to pay caregivers securely through InPlace.
            </div>
          ) : stripeStatus === 'pending' ? (
            <div>
              <div style={{
                padding: '12px 16px',
                background: '#fff3e0',
                borderRadius: '8px',
                color: '#e65100',
                fontSize: 14,
                marginBottom: '12px',
              }}>
                Your Stripe account setup is in progress. Some information may still be needed.
              </div>
              <button
                className="btn btn-primary"
                onClick={handleStripeConnect}
                disabled={stripeLoading}
                style={{ background: '#635bff', borderColor: '#635bff' }}
              >
                {stripeLoading ? 'Loading...' : 'Continue Stripe Setup'}
              </button>
            </div>
          ) : (
            <div>
              <p style={{ color: '#666', fontSize: 14, marginBottom: '16px' }}>
                Connect your bank account or debit card so you can pay caregivers directly through InPlace. Payments are processed securely by Stripe.
              </p>
              <ul style={{ color: '#666', fontSize: 13, marginBottom: '16px', paddingLeft: '20px' }}>
                <li style={{ marginBottom: '6px' }}>Secure, encrypted payment processing</li>
                <li style={{ marginBottom: '6px' }}>Pay caregivers directly after visits</li>
                <li style={{ marginBottom: '6px' }}>Full transaction history and receipts</li>
              </ul>
              <button
                className="btn btn-primary"
                onClick={handleStripeConnect}
                disabled={stripeLoading}
                style={{ background: '#635bff', borderColor: '#635bff' }}
              >
                {stripeLoading ? 'Connecting...' : 'Set Up Payments with Stripe'}
              </button>
            </div>
          )}
        </div>

        <div style={{
          marginTop: '16px',
          padding: '12px',
          background: '#f5f5f5',
          borderRadius: '8px',
          fontSize: 12,
          color: '#888',
          textAlign: 'center',
        }}>
          Powered by Stripe — Your financial data is never stored on InPlace servers.
        </div>

        <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
          <button
            className="btn btn-primary"
            onClick={() => {
              if (formData.authorizationTier === 'tier3') {
                setWizardStep(3);
              } else {
                setWizardStep(4);
              }
            }}
          >
            {stripeStatus === 'complete' ? 'Continue' : 'Skip for Now'}
          </button>
          <button
            className="btn btn-outline"
            onClick={() => setWizardStep(1)}
          >
            Back
          </button>
        </div>
      </div>
    );
  };

  // Wizard Step 4: Attest & Notify (for tier3 only)
  const WizardStep4 = () => {
    const recipientName = `${formData.firstName} ${formData.lastName}`;

    return (
      <div className="card" style={{ marginTop: '32px', borderLeft: '4px solid #1b6b5a' }}>
        <WizardProgressBar currentStep={3} />
        <h3 style={{ marginBottom: '24px', color: '#1b6b5a' }}>Attest & Notify</h3>

        {attestError && (
          <div style={{
            padding: '12px 16px',
            borderRadius: '8px',
            background: '#fce4ec',
            color: '#c62828',
            marginBottom: '20px',
            fontSize: 13,
          }}>
            {attestError}
          </div>
        )}

        <div style={{ background: '#f9f9f9', padding: '16px', borderRadius: '8px', marginBottom: '24px' }}>
          <p style={{ fontSize: 13, lineHeight: '1.6', color: '#333', margin: 0 }}>
            I confirm that <strong>{recipientName}</strong> is aware that I am arranging non-medical companion care services through InPlace on their behalf. I understand that <strong>{recipientName}</strong> will be contacted directly by InPlace to verify their awareness and consent before any caregiver visit is scheduled. I understand that misrepresenting this consent may result in immediate account termination, referral to appropriate authorities, and potential legal liability under Virginia law.
          </p>
        </div>

        <div className="form-group" style={{ marginBottom: '20px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={attestAgreed}
              onChange={(e) => setAttestAgreed(e.target.checked)}
              style={{ cursor: 'pointer', width: 18, height: 18 }}
            />
            <span style={{ fontSize: 13, color: '#333' }}>I attest to the above statement</span>
          </label>
        </div>

        <div className="form-group" style={{ marginBottom: '20px' }}>
          <label style={{ fontWeight: 600, marginBottom: '8px', display: 'block' }}>Your Signature</label>
          <p style={{ fontSize: 12, color: '#888', marginBottom: '8px', marginTop: 0 }}>Type your full name exactly as it appears</p>
          <input
            type="text"
            placeholder="e.g., John Smith"
            value={attestSignature}
            onChange={(e) => setAttestSignature(e.target.value)}
            style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ddd' }}
          />
        </div>

        <div className="form-group" style={{ marginBottom: '20px' }}>
          <label style={{ fontWeight: 600, marginBottom: '8px', display: 'block' }}>Your Relationship</label>
          <select
            value={attestRelationship}
            onChange={(e) => setAttestRelationship(e.target.value)}
            style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ddd' }}
          >
            <option value="">Select...</option>
            <option value="Child">Adult Child</option>
            <option value="Spouse">Spouse</option>
            <option value="Sibling">Sibling</option>
            <option value="Healthcare POA">Healthcare Power of Attorney</option>
            <option value="Other">Other</option>
          </select>
        </div>

        <div style={{ background: '#e8f5f2', padding: '16px', borderRadius: '8px', marginBottom: '24px' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#1b6b5a', marginTop: 0, marginBottom: '12px' }}>How should we contact {recipientName}?</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {[
              { id: 'email', label: 'Email', value: formData.email },
              { id: 'text', label: 'Text Message', value: formData.phone },
              { id: 'phone_call', label: 'Phone Call', value: formData.phone },
            ].map(opt => (
              <label key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="notify_method"
                  value={opt.id}
                  checked={attestNotifyMethod === opt.id}
                  onChange={(e) => setAttestNotifyMethod(e.target.value)}
                  style={{ cursor: 'pointer' }}
                />
                <span style={{ fontSize: 13, color: '#333' }}>
                  {opt.label} {opt.value && <span style={{ color: '#888' }}>({opt.value})</span>}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            className="btn btn-primary"
            onClick={handleAttestAndNotify}
            disabled={attestLoading}
            style={{ opacity: attestLoading ? 0.6 : 1, cursor: attestLoading ? 'not-allowed' : 'pointer' }}
          >
            {attestLoading ? 'Submitting...' : 'Sign & Continue'}
          </button>
          <button
            className="btn btn-outline"
            onClick={() => setWizardStep(2)}
            disabled={attestLoading}
          >
            Back
          </button>
        </div>
      </div>
    );
  };

  // Wizard Step 5: All Set (Completion)
  const WizardStep5 = () => {
    const recipientName = `${formData.firstName} ${formData.lastName}`;

    return (
      <div className="card" style={{ marginTop: '32px', borderLeft: '4px solid #2e7d32', textAlign: 'center' }}>
        <WizardProgressBar currentStep={formData.authorizationTier === 'tier3' ? 4 : 3} />

        <div style={{ fontSize: 48, marginBottom: '16px' }}>✓</div>
        <h3 style={{ color: '#2e7d32', marginBottom: '12px' }}>You're All Set!</h3>
        <p style={{ color: '#666', fontSize: 15, marginBottom: '24px' }}>
          {recipientName} has been added to your care team. We're verifying the information you provided and will reach out to confirm everything.
        </p>

        <div style={{ background: '#f9f9f9', padding: '20px', borderRadius: '8px', marginBottom: '32px', textAlign: 'left' }}>
          <p style={{ fontWeight: 600, color: '#333', marginTop: 0, marginBottom: '12px' }}>While we verify, you can:</p>
          <ul style={{ margin: 0, paddingLeft: '20px', color: '#666', fontSize: 14 }}>
            <li>Review care preferences and make adjustments</li>
            <li>Upload additional photos or documents</li>
            <li>Invite family members to the care team</li>
            <li>Browse available caregivers in your area</li>
          </ul>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button
            className="btn btn-primary"
            onClick={() => {
              setWizardStep(null); resetForm(); setShowAddForm(false);
              fetchRecipients();
              if (window.__navigateTo) window.__navigateTo('dashboard');
            }}
          >
            Go to Dashboard
          </button>
          <button
            className="btn btn-outline"
            onClick={() => {
              setWizardStep(null); resetForm(); setShowAddForm(false);
              fetchRecipients();
              if (window.__navigateTo) window.__navigateTo('care-team');
            }}
            style={{ background: '#fff', color: '#1b6b5a', border: '1px solid #1b6b5a' }}
          >
            Invite Family to Care Team
          </button>
          <button
            className="btn btn-outline"
            onClick={() => {
              setWizardStep(null); resetForm(); setShowAddForm(false);
              fetchRecipients();
              if (window.__navigateTo) window.__navigateTo('caregivers');
            }}
            style={{ background: '#fff', color: '#1b6b5a', border: '1px solid #1b6b5a' }}
          >
            Browse Caregivers in Your Area
          </button>
        </div>
      </div>
    );
  };

  if (loading) return <LoadingSpinner text="Loading care recipients..." />;

  // Track if this is the first-time wizard (no recipients at all)
  const isFirstTimeWizard = recipients.length === 0 && showAddForm && wizardStep === null;
  const isInWizardFlow = showAddForm || wizardStep !== null;

  return (
    <div>
      {/* Show welcome hero for first-time users entering the wizard */}
      {recipients.length === 0 && isInWizardFlow && (
        <div style={{ background: 'linear-gradient(135deg, #1b6b5a 0%, #2a9d8f 100%)', borderRadius: 16, padding: '32px 28px', color: '#fff', marginBottom: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>👋</div>
          <h1 style={{ margin: '0 0 8px', fontSize: 24, fontWeight: 700 }}>Let's set up care for your loved one</h1>
          <p style={{ margin: 0, fontSize: 15, opacity: 0.9, maxWidth: 440, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.5 }}>
            We'll walk you through adding their details, your care preferences, and verifying your authorization — all in a few minutes.
          </p>
        </div>
      )}

      {recipients.length > 0 && <h1 className="greeting">👥 Care Recipients</h1>}

      {!showAddForm && !wizardStep && (
        <>
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

          {selected && (
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

          {selected && (selected.authorization_tier === 'tier3' || selected.authorization_tier === 'tier2') && selected.consent_status && selected.consent_status !== 'verified' && (
            <ConsentVerification
              recipientId={selected.id}
              recipientName={getName(selected)}
              consentStatus={selected.consent_status}
              authorizationTier={selected.authorization_tier}
              onStatusChange={fetchRecipients}
            />
          )}

          <button className="btn btn-primary" onClick={() => { resetForm(); setEditingId(null); setShowAddForm(true); setWizardStep(null); setSavedRecipientId(null); setCarePrefs({}); setCareDetails({}); setShowAllPrefs(false); setAttestAgreed(false); setAttestSignature(''); setAttestRelationship(''); setAttestNotifyMethod('email'); setAttestError(''); }} style={{ marginTop: '32px' }}>+ Add someone you're caring for</button>
        </>
      )}

      {showAddForm && wizardStep === null && (
        <div className="card" style={{ marginTop: '32px', borderLeft: '4px solid #1b6b5a' }}>
          <h3 style={{ marginBottom: '4px', color: '#1b6b5a' }}>{editingId ? 'Edit Care Recipient' : 'Who are you setting up care for?'}</h3>
          {!editingId && <p style={{ fontSize: 13, color: '#888', marginTop: 0, marginBottom: '20px' }}>Add details about the person who will be receiving care — a parent, spouse, or other loved one.</p>}
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
            <p style={{ fontSize: 13, color: '#666', marginTop: 0, marginBottom: 12 }}>Where does this person live? This helps verify their identity and lets caregivers find the location. This info will be used to contact your loved one and verify consent to visits.</p>
          </div>
          <div className="form-row" style={{ alignItems: 'start' }}>
            <div className="form-group">
              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 20, marginBottom: 6 }}>
                Phone Number
                <button type="button" onClick={() => { setIntlPhone(!intlPhone); fd('phone', ''); }} style={{ background: 'none', border: 'none', color: '#1b6b5a', fontSize: 11, cursor: 'pointer', fontWeight: 600, padding: 0 }}>
                  {intlPhone ? 'US number' : 'International number'}
                </button>
              </label>
              <input type="tel" value={formData.phone} onChange={(e) => fd('phone', formatPhone(e.target.value, intlPhone))} placeholder={intlPhone ? '+44 20 7946 0958' : '(555) 123-4567'} />
              {intlPhone && <div style={{ fontSize: 11, color: '#e8724a', marginTop: 4, lineHeight: 1.4 }}>{INTL_PHONE_DISCLAIMER}</div>}
            </div>
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', height: 20, marginBottom: 6 }}>Email</label>
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
          <div className="form-row" style={{ alignItems: 'start' }}>
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', height: 20, marginBottom: 6 }}>Emergency Contact Name</label>
              <input type="text" value={formData.emergencyContactName} onChange={(e) => fd('emergencyContactName', e.target.value)} />
            </div>
            <div className="form-group">
              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 20, marginBottom: 6 }}>
                Phone
                <button type="button" onClick={() => { setIntlEmergencyPhone(!intlEmergencyPhone); fd('emergencyContactPhone', ''); }} style={{ background: 'none', border: 'none', color: '#1b6b5a', fontSize: 11, cursor: 'pointer', fontWeight: 600, padding: 0 }}>
                  {intlEmergencyPhone ? 'US number' : 'International'}
                </button>
              </label>
              <input type="tel" value={formData.emergencyContactPhone} onChange={(e) => fd('emergencyContactPhone', formatPhone(e.target.value, intlEmergencyPhone))} placeholder={intlEmergencyPhone ? '+44 20 7946 0958' : '(555) 123-4567'} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button className="btn btn-primary" onClick={handleSaveRecipient}>{editingId ? 'Save Changes' : 'Save & Continue'}</button>
            <button className="btn btn-outline" onClick={() => { setShowAddForm(false); setEditingId(null); resetForm(); }}>Cancel</button>
          </div>
        </div>
      )}

      {wizardStep === 1 && WizardStep2()}
      {wizardStep === 2 && WizardStep3()}
      {wizardStep === 3 && formData.authorizationTier === 'tier3' && WizardStep4()}
      {wizardStep === 3 && formData.authorizationTier !== 'tier3' && WizardStep5()}
      {wizardStep === 4 && WizardStep5()}
    </div>
  );
};
