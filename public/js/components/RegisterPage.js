const RegisterPage = window.RegisterPage = ({ onLogin, onNavigate, prefilledEmail, prefilledRole, signupToken }) => {
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

  const familySteps = ['Basic Info', 'About Your Loved One', 'Care Needs', 'Review & Submit'];
  const caregiverSteps = ['Basic Info', 'Background Check', 'Certifications', 'Availability', 'Review & Submit'];
  const steps = track === 'family' ? familySteps : caregiverSteps;
  const maxStep = track ? steps.length : 0;

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
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

  const isStepValid = () => {
    if (track === 'family') {
      if (step === 1) return formData.firstName.trim() && formData.lastName.trim() && isValidEmail(formData.email) && isValidPhone(formData.phone) && formData.password.length >= 6;
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
    return true;
  };

  const handleNext = () => {
    if (step < maxStep && isStepValid()) setStep(step + 1);
  };

  const handleBack = () => {
    if (step === 1) {
      if (prefilledRole) { onNavigate('splash'); return; }
      setTrack(null); return;
    }
    if (step > 1) setStep(step - 1);
  };

  const [registering, setRegistering] = useState(false);
  const [regError, setRegError] = useState('');

  const handleComplete = async () => {
    setRegistering(true);
    setRegError('');
    try {
      const role = track === 'caregiver' ? 'caregiver' : 'family';
      const res = await apiFetch('/api/auth/register', {
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
      if (res.error) {
        setRegError(res.error);
        setRegistering(false);
        return;
      }
      setAuthToken(res.token);
      onLogin(res.user);
    } catch (err) {
      setRegError(err.message || 'Registration failed. Please try again.');
      setRegistering(false);
    }
  };

  if (!track) {
    return (
      <div className="register-container">
        <div className="register-card">
          <div className="register-header">
            <div style={{ marginBottom: '16px' }}>
              <InPlaceIcon width={50} height={50} />
            </div>
            <h1>Join InPlace</h1>
            <p>What brings you to InPlace?</p>
          </div>
          <div className="track-selection">
            <div className="track-option" onClick={() => { setTrack('family'); setStep(1); }}>
              <h3>👨‍👩‍👧</h3>
              <h3>I Need Care</h3>
              <p>For a family member</p>
            </div>
            <div className="track-option" onClick={() => { setTrack('caregiver'); setStep(1); }}>
              <h3>🩺</h3>
              <h3>I Want to Care</h3>
              <p>Become a caregiver</p>
            </div>
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
          <h1>{track === 'family' ? 'Family Registration' : 'Caregiver Registration'}</h1>
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
        {track === 'family' && (
          <>
            {step === 1 && (
              <>
                <div className="form-group">
                  <label>First Name</label>
                  <input type="text" value={formData.firstName} onChange={(e) => handleInputChange('firstName', e.target.value)} placeholder="Jane" />
                </div>
                <div className="form-group">
                  <label>Last Name</label>
                  <input type="text" value={formData.lastName} onChange={(e) => handleInputChange('lastName', e.target.value)} placeholder="Smith" />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" value={formData.email} onChange={(e) => handleInputChange('email', e.target.value)} placeholder="jane@example.com" disabled={!!prefilledEmail} style={prefilledEmail ? { background: '#f0f0f0', color: '#666' } : {}} />
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
            {step === 3 && (
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
            {step === 4 && (
              <div>
                <h3 style={{ marginBottom: '16px' }}>Review Your Information</h3>
                <div style={{ background: '#f8f9fa', padding: '16px', borderRadius: '8px', marginBottom: '16px' }}>
                  <p><strong>Name:</strong> {formData.firstName} {formData.lastName}</p>
                  <p><strong>Email:</strong> {formData.email}</p>
                  <p><strong>Loved One:</strong> {formData.lovedOneName}, {formData.lovedOneAge}</p>
                  <p><strong>Care Needs:</strong> {Object.keys(formData.careNeeds).filter(k => formData.careNeeds[k]).join(', ') || 'None selected'}</p>
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
                  <label>First Name</label>
                  <input type="text" value={formData.firstName} onChange={(e) => handleInputChange('firstName', e.target.value)} placeholder="Maria" />
                </div>
                <div className="form-group">
                  <label>Last Name</label>
                  <input type="text" value={formData.lastName} onChange={(e) => handleInputChange('lastName', e.target.value)} placeholder="Garcia" />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" value={formData.email} onChange={(e) => handleInputChange('email', e.target.value)} placeholder="maria@example.com" disabled={!!prefilledEmail} style={prefilledEmail ? { background: '#f0f0f0', color: '#666' } : {}} />
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
            {step === 5 && (
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
        <div style={{ display: 'flex', gap: '12px', marginTop: '24px', justifyContent: 'space-between' }}>
          <button onClick={handleBack} className="btn btn-outline">← Back</button>
          {step < maxStep && <button onClick={handleNext} className="btn btn-primary" disabled={!isStepValid()} style={{ opacity: isStepValid() ? 1 : 0.5, cursor: isStepValid() ? 'pointer' : 'not-allowed' }}>Next →</button>}
        </div>
      </div>
    </div>
  );
};
