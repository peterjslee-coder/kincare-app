const RegisterPage = window.RegisterPage = ({ onLogin, onNavigate, prefilledEmail, prefilledRole, signupToken, pendingInviteToken }) => {
  // If prefill props are provided (from email-first signup flow), skip the role picker
  const [track, setTrack] = useState(prefilledRole === 'caregiver' ? 'caregiver' : prefilledRole === 'family' ? 'family' : null);
  const [step, setStep] = useState(prefilledRole ? 1 : 1);
  const [formData, setFormData] = useState({
    firstName: '', lastName: '', email: prefilledEmail || '', phone: '', password: '',
    lovedOneName: '', lovedOneAge: '', relationship: '', city: '', state: '',
    careNeeds: {}, careNotes: '', bgCheckConsent: false,
    certifications: [], certType: '', certNumber: '', certExpiry: '',
    availability: {}, prefTimes: {}
  });
  const [showFieldErrors, setShowFieldErrors] = useState(false);

  // When registering via care team invite, family users skip "About Your Loved One" and "Care Needs"
  // since they're joining an existing care team (they can add their own cared-for later)
  const isInviteFlow = !!pendingInviteToken;
  const familySteps = isInviteFlow ? ['Basic Info', 'Review & Submit'] : ['Basic Info', 'About Your Loved One', 'Care Needs', 'Review & Submit'];
  const caregiverSteps = ['Basic Info', 'Background Check', 'Certifications', 'Availability', 'Review & Submit'];
  const careForSteps = ['Basic Info', 'Review & Submit'];
  const steps = track === 'care_for' ? careForSteps : track === 'family' ? familySteps : caregiverSteps;
  const maxStep = track ? steps.length : 0;

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (showFieldErrors) setShowFieldErrors(false);
  };

  const handleCheckboxChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: { ...prev[field], [value]: !prev[field][value] }
    }));
  };

  // Validation helpers
  const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const isValidPhone = (phone) => phone.replace(/\D/g, '').length === 10;
  const getStepErrors = () => {
    const errs = [];
    if (step === 1) {
      if (!formData.firstName.trim()) errs.push('First name');
      if (!formData.lastName.trim()) errs.push('Last name');
      if (!formData.email.trim() || !isValidEmail(formData.email)) errs.push('Valid email');
      if (!isValidPhone(formData.phone)) errs.push('10-digit phone number');
      if (formData.password.length < 6) errs.push('Password (min 6 characters)');
    }
    if (track === 'family' && !isInviteFlow) {
      if (step === 2) {
        if (!formData.lovedOneName.trim()) errs.push("Loved one's name");
        if (!formData.lovedOneAge) errs.push('Age');
        if (!formData.relationship) errs.push('Relationship');
      }
      if (step === 3 && !Object.values(formData.careNeeds).some(v => v)) errs.push('At least one care need');
    }
    if (track === 'caregiver') {
      if (step === 2 && !formData.bgCheckConsent) errs.push('Background check consent');
      if (step === 3 && !formData.certType) errs.push('Certification type');
      if (step === 4 && !Object.values(formData.availability).some(v => v)) errs.push('At least one available day');
    }
    return errs;
  };

  const isStepValid = () => {
    if (track === 'family') {
      if (step === 1) return formData.firstName.trim() && formData.lastName.trim() && isValidEmail(formData.email) && isValidPhone(formData.phone) && formData.password.length >= 6;
      if (isInviteFlow) return true; // Invite flow: step 1 = Basic Info, step 2 = Review (always valid)
      if (step === 2) return formData.lovedOneName.trim() && formData.lovedOneAge && formData.relationship;
      if (step === 3) return Object.values(formData.careNeeds).some(v => v);
      return true;
    }
    if (track === 'caregiver') {
      if (step === 1) return formData.firstName.trim() && formData.lastName.trim() && isValidEmail(formData.email) && isValidPhone(formData.phone) && formData.password.length >= 6;
      if (step === 2) return formData.bgCheckConsent;
      if (step === 3) return !!formData.certType;
      if (step === 4) return Object.values(formData.availability).some(v => v);
      return true;
    }
    if (track === 'care_for') {
      if (step === 1) return formData.firstName.trim() && formData.lastName.trim() && isValidEmail(formData.email) && isValidPhone(formData.phone) && formData.password.length >= 6;
      return true;
    }
    return true;
  };

  const handleNext = () => {
    if (step < maxStep) {
      if (isStepValid()) { setShowFieldErrors(false); setStep(step + 1); }
      else { setShowFieldErrors(true); }
    }
  };

  const handleBack = () => {
    if (step === 1) {
      if (prefilledRole) { onNavigate('splash'); return; }
      if (isInviteFlow) { onNavigate('invite'); return; } // Go back to invite landing
      setTrack(null); return;
    }
    if (step > 1) setStep(step - 1);
  };

  const [registering, setRegistering] = useState(false);
  const [regError, setRegError] = useState('');

  const handleComplete = async () => {
    setRegistering(true);
    setRegError('');
    const role = track === 'caregiver' ? 'caregiver' : track === 'care_for' ? 'care_for' : 'family';
    trackAuthEvent('registration', 'registration_submit', { email: formData.email, role, step, isInviteFlow });
    try {
      const response = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          firstName: formData.firstName,
          lastName: formData.lastName,
          phone: formData.phone,
          role,
          ...(signupToken ? { signupToken } : {})
        })
      });
      if (!response) throw new Error('Registration failed');
      const res = await response.json();
      if (!response.ok || res.error) {
        trackAuthEvent('registration', 'error', { email: formData.email, role, error: res.error || 'Registration failed', source: 'api' });
        setRegError(res.error || 'Registration failed');
        setRegistering(false);
        return;
      }
      trackAuthEvent('registration', 'registration_success', { email: formData.email, role });
      setAuthToken(res.token);
      onLogin(res.user);
    } catch (err) {
      trackAuthEvent('registration', 'error', { email: formData.email, role, error: err.message, source: 'network' });
      setRegError(err.message || 'Registration failed. Please try again.');
      setRegistering(false);
    }
  };

  // For care team invites, auto-select family track and skip role picker
  useEffect(() => {
    if (isInviteFlow && !track) {
      setTrack('family');
      setStep(1);
    }
  }, [isInviteFlow]);

  if (!track) {
    const roleCards = [
      {
        id: 'family',
        icon: '👨‍👩‍👧',
        title: "I'd like to find care",
        subtitle: 'Find and coordinate care for a loved one',
        color: '#1b6b5a',
        bgColor: '#e8f5f2',
      },
      {
        id: 'caregiver',
        icon: '🤝',
        title: "I'd like to provide care",
        subtitle: 'Join as a caregiver and find work opportunities',
        color: '#e8724a',
        bgColor: '#FFF3E0',
      },
      {
        id: 'care_for',
        icon: '🌷',
        title: 'I would like help',
        subtitle: 'Sign up to manage your own care and schedule',
        color: '#5c6bc0',
        bgColor: '#e8eaf6',
      },
    ];

    return (
      <div className="register-container">
        <div className="register-card" style={{ maxWidth: '480px' }}>
          <div className="register-header">
            <div style={{ marginBottom: '16px' }}>
              <InPlaceIcon width={50} height={50} />
            </div>
            <h1>Join InPlace</h1>
            <p style={{ color: '#666', fontSize: '15px' }}>What best describes you?</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', margin: '8px 0 20px' }}>
            {roleCards.map(card => (
              <div key={card.id} onClick={() => { trackAuthEvent('registration', 'role_selected', { role: card.id }); setTrack(card.id === 'care_for' ? 'care_for' : card.id); setStep(1); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '16px',
                  padding: '18px 20px', borderRadius: '12px',
                  border: '2px solid #e8e8e8', cursor: 'pointer',
                  transition: 'all 0.2s',
                  background: '#fff',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = card.color; e.currentTarget.style.background = card.bgColor; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#e8e8e8'; e.currentTarget.style.background = '#fff'; }}
              >
                <div style={{
                  width: '52px', height: '52px', borderRadius: '50%',
                  background: card.bgColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '28px', flexShrink: 0,
                }}>
                  {card.icon}
                </div>
                <div>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: '#333', marginBottom: '2px' }}>{card.title}</div>
                  <div style={{ fontSize: '13px', color: '#777', lineHeight: 1.4 }}>{card.subtitle}</div>
                </div>
                <div style={{ marginLeft: 'auto', color: '#ccc', fontSize: '18px', flexShrink: 0 }}>→</div>
              </div>
            ))}
          </div>
          <div className="text-center">
            <p style={{ fontSize: '14px', marginBottom: '8px' }}>Already have an account? <a onClick={() => onNavigate('login')}>Sign In</a></p>
            <p style={{ fontSize: '14px' }}><a onClick={() => onNavigate('splash')} style={{ color: '#888', cursor: 'pointer' }}>← Back to home</a></p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="register-container">
      <div className="register-card">
        <div className="register-header">
          <h1>{track === 'care_for' ? 'Care Recipient Registration' : track === 'family' ? 'Family Registration' : 'Caregiver Registration'}</h1>
          <p>{steps[step - 1]}</p>
        </div>
        <div className="step-indicator">
          {steps.map((s, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div className={`step-dot ${step === i + 1 ? 'active' : ''} ${step > i + 1 ? 'completed' : ''}`}>
                {step <= i + 1 ? i + 1 : '✓'}
              </div>
              <div className="step-label" style={{ fontSize: '11px' }}>{s}</div>
            </div>
          ))}
        </div>
        {showFieldErrors && getStepErrors().length > 0 && (
          <div style={{ background: '#fdf0ed', border: '1px solid #e74c3c', borderRadius: '8px', padding: '12px 16px', marginBottom: '12px', fontSize: '13px', color: '#c0392b' }}>
            <strong>Please complete:</strong> {getStepErrors().join(', ')}
          </div>
        )}
        {track === 'family' && (
          <>
            {step === 1 && (
              <>
                <div className="form-group">
                  <label>First Name {showFieldErrors && !formData.firstName.trim() && <span style={{ color: '#c0392b', fontSize: 12 }}>*required</span>}</label>
                  <input type="text" value={formData.firstName} onChange={(e) => handleInputChange('firstName', e.target.value)} placeholder="Jane" style={showFieldErrors && !formData.firstName.trim() ? { borderColor: '#c0392b', background: '#fdf0ed' } : {}} />
                </div>
                <div className="form-group">
                  <label>Last Name {showFieldErrors && !formData.lastName.trim() && <span style={{ color: '#c0392b', fontSize: 12 }}>*required</span>}</label>
                  <input type="text" value={formData.lastName} onChange={(e) => handleInputChange('lastName', e.target.value)} placeholder="Smith" style={showFieldErrors && !formData.lastName.trim() ? { borderColor: '#c0392b', background: '#fdf0ed' } : {}} />
                </div>
                <div className="form-group">
                  <label>Email {showFieldErrors && (!formData.email.trim() || !isValidEmail(formData.email)) && <span style={{ color: '#c0392b', fontSize: 12 }}>*required</span>}</label>
                  <input type="email" value={formData.email} onChange={(e) => handleInputChange('email', e.target.value)} placeholder="jane@example.com" disabled={!!prefilledEmail} style={prefilledEmail ? { background: '#f0f0f0', color: '#666' } : showFieldErrors && (!formData.email.trim() || !isValidEmail(formData.email)) ? { borderColor: '#c0392b', background: '#fdf0ed' } : {}} />
                  {formData.email && !isValidEmail(formData.email) && <div style={{ fontSize: '12px', color: '#c0392b', marginTop: '4px' }}>Please enter a valid email address</div>}
                </div>
                <div className="form-group">
                  <label>Phone {showFieldErrors && !isValidPhone(formData.phone) && <span style={{ color: '#c0392b', fontSize: 12 }}>*required</span>}</label>
                  <input type="tel" value={formData.phone} onChange={(e) => handleInputChange('phone', e.target.value)} placeholder="(555) 123-4567" style={showFieldErrors && !isValidPhone(formData.phone) ? { borderColor: '#c0392b', background: '#fdf0ed' } : {}} />
                  {formData.phone && !isValidPhone(formData.phone) && <div style={{ fontSize: '12px', color: '#c0392b', marginTop: '4px' }}>Please enter a 10-digit phone number</div>}
                </div>
                <div className="form-group">
                  <label>Password {showFieldErrors && formData.password.length < 6 && <span style={{ color: '#c0392b', fontSize: 12 }}>*min 6 chars</span>}</label>
                  <input type="password" value={formData.password} onChange={(e) => handleInputChange('password', e.target.value)} placeholder="At least 6 characters" style={showFieldErrors && formData.password.length < 6 ? { borderColor: '#c0392b', background: '#fdf0ed' } : {}} />
                  {formData.password && formData.password.length < 6 && <div style={{ fontSize: '12px', color: '#c0392b', marginTop: '4px' }}>Password must be at least 6 characters</div>}
                </div>
              </>
            )}
            {!isInviteFlow && step === 2 && (
              <>
                <div className="form-group">
                  <label>Loved One's Name</label>
                  <input type="text" value={formData.lovedOneName} onChange={(e) => handleInputChange('lovedOneName', e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Age</label>
                  <input type="number" value={formData.lovedOneAge} onChange={(e) => handleInputChange('lovedOneAge', e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Your Relationship</label>
                  <select value={formData.relationship} onChange={(e) => handleInputChange('relationship', e.target.value)}>
                    <option value="">Select...</option>
                    <option value="parent">Parent</option>
                    <option value="grandparent">Grandparent</option>
                    <option value="spouse">Spouse</option>
                    <option value="sibling">Sibling</option>
                    <option value="child">Child</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>City</label>
                    <input type="text" value={formData.city} onChange={(e) => handleInputChange('city', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>State</label>
                    <input type="text" value={formData.state} onChange={(e) => handleInputChange('state', e.target.value)} />
                  </div>
                </div>
              </>
            )}
            {!isInviteFlow && step === 3 && (
              <>
                <div className="form-group">
                  <label>What type of care is needed?</label>
                  <div style={{ marginTop: '12px' }}>
                    {['companionship', 'personal_care', 'housekeeping', 'medication_mgmt', 'transportation', 'meal_prep'].map(need => (
                      <label key={need} className="form-checkbox">
                        <input type="checkbox" checked={!!formData.careNeeds[need]} onChange={() => handleCheckboxChange('careNeeds', need)} />
                        {need.replace(/_/g, ' ').charAt(0).toUpperCase() + need.replace(/_/g, ' ').slice(1)}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="form-group">
                  <label>Additional Notes</label>
                  <textarea value={formData.careNotes} onChange={(e) => handleInputChange('careNotes', e.target.value)} />
                </div>
              </>
            )}
            {step === steps.length && (
              <div>
                <h3 style={{ marginBottom: '16px' }}>Review Your Information</h3>
                <div style={{ background: '#f8f9fa', padding: '16px', borderRadius: '8px', marginBottom: '16px' }}>
                  <p><strong>Name:</strong> {formData.firstName} {formData.lastName}</p>
                  <p><strong>Email:</strong> {formData.email}</p>
                  {!isInviteFlow && <p><strong>Loved One:</strong> {formData.lovedOneName}, {formData.lovedOneAge}</p>}
                  {!isInviteFlow && <p><strong>Care Needs:</strong> {Object.keys(formData.careNeeds).filter(k => formData.careNeeds[k]).join(', ') || 'None selected'}</p>}
                  {isInviteFlow && <p style={{ color: '#1b6b5a', fontSize: '14px' }}>You're joining an existing care team. You can add your own care recipients later.</p>}
                </div>
                {regError && <div style={{ color: '#c0392b', fontSize: '14px', marginBottom: '12px', padding: '10px', background: '#fdf0ed', borderRadius: '6px' }}>{regError}</div>}
                <button type="button" className="btn btn-primary" onClick={handleComplete} disabled={registering} style={{ width: '100%', opacity: registering ? 0.6 : 1 }}>{registering ? 'Creating Account...' : 'Complete Registration'}</button>
              </div>
            )}
          </>
        )}
        {track === 'caregiver' && (
          <>
            {step === 1 && (
              <>
                <div className="form-group">
                  <label>First Name {showFieldErrors && !formData.firstName.trim() && <span style={{ color: '#c0392b', fontSize: 12 }}>*required</span>}</label>
                  <input type="text" value={formData.firstName} onChange={(e) => handleInputChange('firstName', e.target.value)} placeholder="Maria" style={showFieldErrors && !formData.firstName.trim() ? { borderColor: '#c0392b', background: '#fdf0ed' } : {}} />
                </div>
                <div className="form-group">
                  <label>Last Name {showFieldErrors && !formData.lastName.trim() && <span style={{ color: '#c0392b', fontSize: 12 }}>*required</span>}</label>
                  <input type="text" value={formData.lastName} onChange={(e) => handleInputChange('lastName', e.target.value)} placeholder="Garcia" style={showFieldErrors && !formData.lastName.trim() ? { borderColor: '#c0392b', background: '#fdf0ed' } : {}} />
                </div>
                <div className="form-group">
                  <label>Email {showFieldErrors && (!formData.email.trim() || !isValidEmail(formData.email)) && <span style={{ color: '#c0392b', fontSize: 12 }}>*required</span>}</label>
                  <input type="email" value={formData.email} onChange={(e) => handleInputChange('email', e.target.value)} placeholder="maria@example.com" disabled={!!prefilledEmail} style={prefilledEmail ? { background: '#f0f0f0', color: '#666' } : showFieldErrors && (!formData.email.trim() || !isValidEmail(formData.email)) ? { borderColor: '#c0392b', background: '#fdf0ed' } : {}} />
                  {formData.email && !isValidEmail(formData.email) && <div style={{ fontSize: '12px', color: '#c0392b', marginTop: '4px' }}>Please enter a valid email address</div>}
                </div>
                <div className="form-group">
                  <label>Phone {showFieldErrors && !isValidPhone(formData.phone) && <span style={{ color: '#c0392b', fontSize: 12 }}>*required</span>}</label>
                  <input type="tel" value={formData.phone} onChange={(e) => handleInputChange('phone', e.target.value)} placeholder="(555) 123-4567" style={showFieldErrors && !isValidPhone(formData.phone) ? { borderColor: '#c0392b', background: '#fdf0ed' } : {}} />
                  {formData.phone && !isValidPhone(formData.phone) && <div style={{ fontSize: '12px', color: '#c0392b', marginTop: '4px' }}>Please enter a 10-digit phone number</div>}
                </div>
                <div className="form-group">
                  <label>Password {showFieldErrors && formData.password.length < 6 && <span style={{ color: '#c0392b', fontSize: 12 }}>*min 6 chars</span>}</label>
                  <input type="password" value={formData.password} onChange={(e) => handleInputChange('password', e.target.value)} placeholder="At least 6 characters" style={showFieldErrors && formData.password.length < 6 ? { borderColor: '#c0392b', background: '#fdf0ed' } : {}} />
                  {formData.password && formData.password.length < 6 && <div style={{ fontSize: '12px', color: '#c0392b', marginTop: '4px' }}>Password must be at least 6 characters</div>}
                </div>
              </>
            )}
            {step === 2 && (
              <>
                <div className="form-group">
                  <label className="form-checkbox">
                    <input type="checkbox" checked={formData.bgCheckConsent} onChange={(e) => handleInputChange('bgCheckConsent', e.target.checked)} />
                    <strong>I agree to comprehensive background check</strong>
                  </label>
                  <p style={{ fontSize: '13px', color: '#6c757d', marginLeft: '28px', marginBottom: '16px' }}>
                    This includes criminal history review, reference verification, and identity confirmation.
                  </p>
                </div>
                <div style={{ background: '#e8f5f2', border: '1px solid #1b6b5a', borderRadius: '8px', padding: '16px' }}>
                  <p style={{ fontSize: '13px', color: '#0f4238' }}>✓ Our AI verification system will automatically validate your certifications against issuing authorities.</p>
                </div>
              </>
            )}
            {step === 3 && (
              <>
                <div className="form-group">
                  <label>Certification Type</label>
                  <select value={formData.certType} onChange={(e) => handleInputChange('certType', e.target.value)}>
                    <option value="">Select...</option>
                    <option value="cna">CNA (Certified Nursing Assistant)</option>
                    <option value="hha">HHA (Home Health Aide)</option>
                    <option value="lpn">LPN (Licensed Practical Nurse)</option>
                    <option value="rn">RN (Registered Nurse)</option>
                    <option value="cpr">CPR/First Aid</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Certification Number</label>
                  <input type="text" value={formData.certNumber} onChange={(e) => handleInputChange('certNumber', e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Expiration Date</label>
                  <input type="date" value={formData.certExpiry} onChange={(e) => handleInputChange('certExpiry', e.target.value)} />
                </div>
                <button type="button" className="btn btn-secondary btn-small" onClick={() => alert('Certification added!')}>+ Add Certification</button>
              </>
            )}
            {step === 4 && (
              <>
                <div className="form-group">
                  <label>Availability</label>
                  <div style={{ marginTop: '12px' }}>
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                      <label key={day} className="form-checkbox">
                        <input type="checkbox" checked={!!formData.availability[day]} onChange={() => handleCheckboxChange('availability', day)} />
                        {day}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="form-group">
                  <label>Preferred Times</label>
                  <div style={{ marginTop: '12px' }}>
                    {['morning', 'afternoon', 'evening'].map(time => (
                      <label key={time} className="form-checkbox">
                        <input type="checkbox" checked={!!formData.prefTimes[time]} onChange={() => handleCheckboxChange('prefTimes', time)} />
                        {time.charAt(0).toUpperCase() + time.slice(1)}
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}
            {step === caregiverSteps.length && (
              <div>
                <h3 style={{ marginBottom: '16px' }}>Review Your Application</h3>
                <div style={{ background: '#f8f9fa', padding: '16px', borderRadius: '8px', marginBottom: '16px' }}>
                  <p><strong>Name:</strong> {formData.firstName} {formData.lastName}</p>
                  <p><strong>Email:</strong> {formData.email}</p>
                  <p><strong>Certification:</strong> {formData.certType}</p>
                  <p><strong>Available Days:</strong> {Object.keys(formData.availability).filter(k => formData.availability[k]).join(', ') || 'None selected'}</p>
                </div>
                {regError && <div style={{ color: '#c0392b', fontSize: '14px', marginBottom: '12px', padding: '10px', background: '#fdf0ed', borderRadius: '6px' }}>{regError}</div>}
                <button type="button" className="btn btn-primary" onClick={handleComplete} disabled={registering} style={{ width: '100%', opacity: registering ? 0.6 : 1 }}>{registering ? 'Creating Account...' : 'Submit Application'}</button>
              </div>
            )}
          </>
        )}
        {track === 'care_for' && (
          <>
            {step === 1 && (
              <>
                <div className="form-group">
                  <label>First Name</label>
                  <input type="text" value={formData.firstName} onChange={(e) => handleInputChange('firstName', e.target.value)} placeholder="Betty" />
                </div>
                <div className="form-group">
                  <label>Last Name</label>
                  <input type="text" value={formData.lastName} onChange={(e) => handleInputChange('lastName', e.target.value)} placeholder="Smith" />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" value={formData.email} onChange={(e) => handleInputChange('email', e.target.value)} placeholder="betty@example.com" disabled={!!prefilledEmail} style={prefilledEmail ? { background: '#f0f0f0', color: '#666' } : {}} />
                  {formData.email && !isValidEmail(formData.email) && <div style={{ fontSize: '12px', color: '#c0392b', marginTop: '4px' }}>Please enter a valid email address</div>}
                </div>
                <div className="form-group">
                  <label>Phone</label>
                  <input type="tel" value={formData.phone} onChange={(e) => handleInputChange('phone', e.target.value)} placeholder="(555) 123-4567" />
                  {formData.phone && !isValidPhone(formData.phone) && <div style={{ fontSize: '12px', color: '#c0392b', marginTop: '4px' }}>Please enter a 10-digit phone number</div>}
                </div>
                <div className="form-group">
                  <label>Password</label>
                  <input type="password" value={formData.password} onChange={(e) => handleInputChange('password', e.target.value)} placeholder="At least 6 characters" />
                  {formData.password && formData.password.length < 6 && <div style={{ fontSize: '12px', color: '#c0392b', marginTop: '4px' }}>Password must be at least 6 characters</div>}
                </div>
              </>
            )}
            {step === 2 && (
              <div>
                <h3 style={{ marginBottom: '16px' }}>Review Your Information</h3>
                <div style={{ background: '#f8f9fa', padding: '16px', borderRadius: '8px', marginBottom: '16px' }}>
                  <p><strong>Name:</strong> {formData.firstName} {formData.lastName}</p>
                  <p><strong>Email:</strong> {formData.email}</p>
                  <p><strong>Account type:</strong> Care Recipient</p>
                </div>
                <div style={{ background: '#e8eaf6', border: '1px solid #5c6bc0', borderRadius: '8px', padding: '14px', marginBottom: '16px', fontSize: '13px', color: '#3949ab' }}>
                  After creating your account, you'll be able to browse caregivers in your area and request care on your own schedule.
                </div>
                {regError && <div style={{ color: '#c0392b', fontSize: '14px', marginBottom: '12px', padding: '10px', background: '#fdf0ed', borderRadius: '6px' }}>{regError}</div>}
                <button type="button" className="btn btn-primary" onClick={handleComplete} disabled={registering} style={{ width: '100%', opacity: registering ? 0.6 : 1 }}>{registering ? 'Creating Account...' : 'Complete Registration'}</button>
              </div>
            )}
          </>
        )}
        <div style={{ display: 'flex', gap: '12px', marginTop: '24px', justifyContent: 'space-between' }}>
          <button onClick={handleBack} className="btn btn-outline">← Back</button>
          {step < maxStep && <button onClick={handleNext} className="btn btn-primary" disabled={!isStepValid()} style={{ opacity: isStepValid() ? 1 : 0.5, cursor: isStepValid() ? 'pointer' : 'not-allowed' }}>Next →</button>}
        </div>
      </div>
    </div>
  );
};
