const RegisterPage = window.RegisterPage = ({ onLogin, onNavigate, prefilledEmail, prefilledRole, signupToken, pendingInviteToken, sandboxMode }) => {
  // ─── State ───
  const [track, setTrack] = useState(prefilledRole === 'caregiver' ? 'caregiver' : prefilledRole === 'family' ? 'family' : prefilledRole === 'care_for' ? 'care_for' : null);
  const [step, setStep] = useState(prefilledRole ? 2 : 1); // Step 1 = role picker, Step 2 = basic info, Step 3 = caregiver disclosures
  const [formData, setFormData] = useState({
    firstName: '', lastName: '', email: prefilledEmail || '', password: '',
    confirmPassword: '',
    phone: '',
    // Caregiver disclosures
    ackNoMedical: false, ackBgCheck: false, ackPayments: false,
  });
  const [showFieldErrors, setShowFieldErrors] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [regError, setRegError] = useState('');
  const [sandboxPreview, setSandboxPreview] = useState(false);

  // For care team invites, auto-select family track and skip role picker
  const isInviteFlow = !!pendingInviteToken;
  useEffect(() => {
    if (isInviteFlow && !track) {
      setTrack('family');
      setStep(2);
    }
  }, [isInviteFlow]);

  // ─── Validation ───
  const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const getBasicInfoErrors = () => {
    const errs = [];
    if (!formData.firstName.trim()) errs.push('First name');
    if (!formData.lastName.trim()) errs.push('Last name');
    if (!formData.email.trim() || !isValidEmail(formData.email)) errs.push('Valid email');
    if (formData.password.length < 6) errs.push('Password (min 6 characters)');
    if (formData.password && formData.confirmPassword && formData.password !== formData.confirmPassword) errs.push('Passwords must match');
    if (!formData.confirmPassword) errs.push('Confirm password');
    return errs;
  };

  const isBasicInfoValid = () => {
    return formData.firstName.trim() && formData.lastName.trim() &&
           isValidEmail(formData.email) && formData.password.length >= 6 &&
           formData.confirmPassword && formData.password === formData.confirmPassword;
  };

  // Strip phone formatting for storage — (555) 123-4567 → 5551234567
  const normalizePhone = (phone) => phone ? phone.replace(/\D/g, '') : null;

  const isDisclosuresValid = () => {
    return formData.ackNoMedical && formData.ackBgCheck && formData.ackPayments;
  };

  // ─── Navigation ───
  const handleNext = () => {
    if (step === 2 && isBasicInfoValid()) {
      setShowFieldErrors(false);
      if (track === 'caregiver') {
        setStep(3); // Go to disclosures
      } else {
        handleComplete(); // Family & care_for go straight to account creation
      }
    } else {
      setShowFieldErrors(true);
    }
  };

  const handleBack = () => {
    setShowFieldErrors(false);
    if (step === 3) { setStep(2); return; }
    if (step === 2) {
      if (prefilledRole || isInviteFlow) { onNavigate('splash'); return; }
      setTrack(null); setStep(1); return;
    }
    onNavigate('splash');
  };

  // ─── Account Creation ───
  const handleComplete = async () => {
    // Sandbox mode: show preview instead of creating account
    if (sandboxMode) {
      setSandboxPreview(true);
      return;
    }

    setRegistering(true);
    setRegError('');
    const role = track === 'caregiver' ? 'caregiver' : track === 'care_for' ? 'care_for' : 'family';

    if (typeof trackAuthEvent === 'function') {
      trackAuthEvent('registration', 'registration_submit', { email: formData.email, role });
    }

    try {
      const response = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          firstName: formData.firstName,
          lastName: formData.lastName,
          phone: normalizePhone(formData.phone),
          role,
          ...(signupToken ? { signupToken } : {})
        })
      });

      if (!response) throw new Error('Registration failed');
      const res = await response.json();

      if (!response.ok || res.error) {
        if (typeof trackAuthEvent === 'function') {
          trackAuthEvent('registration', 'error', { email: formData.email, role, error: res.error || 'Registration failed', source: 'api' });
        }
        setRegError(res.error || 'Registration failed');
        setRegistering(false);
        return;
      }

      if (typeof trackAuthEvent === 'function') {
        trackAuthEvent('registration', 'registration_success', { email: formData.email, role });
      }
      setAuthToken(res.token);
      onLogin(res.user);
    } catch (err) {
      if (typeof trackAuthEvent === 'function') {
        trackAuthEvent('registration', 'error', { email: formData.email, role: track, error: err.message, source: 'network' });
      }
      setRegError(err.message || 'Registration failed. Please try again.');
      setRegistering(false);
    }
  };

  // ─── Sandbox preview ───
  if (sandboxPreview) {
    const roleLabel = track === 'caregiver' ? 'Caregiver' : track === 'care_for' ? 'Care Recipient' : 'Family Member';
    return (
      <div className="register-container">
        <div className="register-card" style={{ maxWidth: '480px' }}>
          <div style={{ background: '#fff8e1', border: '2px solid #ff9800', borderRadius: '12px', padding: '16px', marginBottom: '20px', textAlign: 'center' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#e65100', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>Sandbox Mode</div>
            <div style={{ fontSize: '13px', color: '#bf360c' }}>No account was created. This is a preview.</div>
          </div>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>{'✅'}</div>
            <h2 style={{ margin: '0 0 8px', fontSize: '20px' }}>Registration Complete (Preview)</h2>
            <p style={{ color: '#666', fontSize: '14px', margin: 0 }}>Here's what would happen:</p>
          </div>
          <div style={{ background: '#f8f9fa', padding: '16px', borderRadius: '8px', marginBottom: '20px', fontSize: '14px', lineHeight: 1.8 }}>
            <p style={{ margin: '0 0 4px' }}><strong>Name:</strong> {formData.firstName} {formData.lastName}</p>
            <p style={{ margin: '0 0 4px' }}><strong>Email:</strong> {formData.email}</p>
            <p style={{ margin: '0 0 4px' }}><strong>Role:</strong> {roleLabel}</p>
            <p style={{ margin: '0 0 4px' }}><strong>Phone:</strong> {formData.phone || '(not provided)'}</p>
            {track === 'caregiver' && (
              <div style={{ borderTop: '1px solid #e0e0e0', marginTop: '8px', paddingTop: '8px' }}>
                <p style={{ margin: '0 0 2px', color: '#1b6b5a' }}>{'✓'} No-medical-care disclosure acknowledged</p>
                <p style={{ margin: '0 0 2px', color: '#1b6b5a' }}>{'✓'} Background check fee acknowledged</p>
                <p style={{ margin: '0 0 2px', color: '#1b6b5a' }}>{'✓'} Online payments acknowledged</p>
              </div>
            )}
          </div>
          <div style={{ background: '#e8f5f2', padding: '14px', borderRadius: '8px', marginBottom: '20px', fontSize: '13px', color: '#0f4238' }}>
            <strong>Next:</strong> The user would land on their {roleLabel} dashboard with a First Steps checklist guiding them to complete their profile.
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button onClick={() => { setSandboxPreview(false); setTrack(null); setStep(1); setFormData({ firstName: '', lastName: '', email: '', password: '', confirmPassword: '', phone: '', ackNoMedical: false, ackBgCheck: false, ackPayments: false }); }} className="btn btn-outline" style={{ flex: 1 }}>Start Over</button>
            <button onClick={() => onNavigate('splash')} className="btn btn-primary" style={{ flex: 1 }}>Exit Sandbox</button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Screen 1: Role Picker ───
  if (step === 1 && !track) {
    const roleCards = [
      {
        id: 'care_for',
        icon: '🏠',
        title: 'I need help around my home',
        subtitle: 'Find caregivers who can assist you directly',
        color: '#5c6bc0',
        bgColor: '#e8eaf6',
      },
      {
        id: 'family',
        icon: '💛',
        title: 'I want to help my loved one arrange care',
        subtitle: 'Coordinate and manage care for a family member',
        color: '#1b6b5a',
        bgColor: '#e8f5f2',
      },
      {
        id: 'caregiver',
        icon: '🤝',
        title: 'I want to find meaningful work at fair wages',
        subtitle: 'Join as a caregiver and connect with families who need you',
        color: '#e8724a',
        bgColor: '#FFF3E0',
      },
    ];

    return (
      <div className="register-container">
        {sandboxMode && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, background: '#ff9800', color: '#fff', textAlign: 'center', padding: '6px', fontSize: '13px', fontWeight: 700, zIndex: 9999, letterSpacing: '0.5px' }}>
            SANDBOX MODE — no accounts will be created
          </div>
        )}
        <div className="register-card" style={{ maxWidth: '480px', marginTop: sandboxMode ? '40px' : undefined }}>
          <div className="register-header">
            <div style={{ marginBottom: '16px' }}>
              {typeof InPlaceIcon !== 'undefined' && React.createElement(InPlaceIcon, { width: 50, height: 50 })}
            </div>
            <h1 style={{ marginBottom: '8px' }}>Join InPlace</h1>
            <p style={{ color: '#666', fontSize: '15px', margin: 0 }}>You can add profiles later, but most people start with what they need the most. Which is best for you?</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', margin: '20px 0' }}>
            {roleCards.map(card => (
              <div key={card.id} onClick={() => {
                if (typeof trackAuthEvent === 'function') trackAuthEvent('registration', 'role_selected', { role: card.id });
                setTrack(card.id);
                setStep(2);
              }}
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
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: '#333', marginBottom: '2px' }}>{card.title}</div>
                  <div style={{ fontSize: '13px', color: '#777', lineHeight: 1.4 }}>{card.subtitle}</div>
                </div>
                <div style={{ color: '#ccc', fontSize: '18px', flexShrink: 0 }}>{'\u2192'}</div>
              </div>
            ))}
          </div>
          <div className="text-center">
            <p style={{ fontSize: '14px', marginBottom: '8px' }}>Already have an account? <a onClick={() => onNavigate('login')} style={{ cursor: 'pointer', color: '#1b6b5a', fontWeight: 600 }}>Sign In</a></p>
            <p style={{ fontSize: '14px' }}><a onClick={() => onNavigate('splash')} style={{ color: '#888', cursor: 'pointer' }}>{'\u2190'} Back to home</a></p>
          </div>
        </div>
      </div>
    );
  }

  // ─── Screen 2: Basic Info (all roles) ───
  // ─── Screen 3: Caregiver Disclosures ───
  const totalSteps = track === 'caregiver' ? 3 : 2;
  const stepLabels = track === 'caregiver'
    ? ['Choose Your Path', 'Your Information', 'Quick Disclosures']
    : ['Choose Your Path', 'Your Information'];

  return (
    <div className="register-container">
      {sandboxMode && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, background: '#ff9800', color: '#fff', textAlign: 'center', padding: '6px', fontSize: '13px', fontWeight: 700, zIndex: 9999, letterSpacing: '0.5px' }}>
          SANDBOX MODE — no accounts will be created
        </div>
      )}
      <div className="register-card" style={{ marginTop: sandboxMode ? '40px' : undefined }}>
        <div className="register-header">
          <h1 style={{ marginBottom: '4px' }}>
            {step === 2 ? 'Create Your Account' : 'Almost There'}
          </h1>
          <p style={{ color: '#666', fontSize: '14px', margin: 0 }}>{stepLabels[step - 1]}</p>
        </div>

        {/* Step indicator */}
        <div className="step-indicator" style={{ marginBottom: '20px' }}>
          {stepLabels.map((s, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div className={'step-dot' + (step === i + 1 ? ' active' : '') + (step > i + 1 ? ' completed' : '')}>
                {step <= i + 1 ? i + 1 : '\u2713'}
              </div>
              <div className="step-label" style={{ fontSize: '11px' }}>{s}</div>
            </div>
          ))}
        </div>

        {/* Validation errors */}
        {showFieldErrors && step === 2 && getBasicInfoErrors().length > 0 && (
          <div style={{ background: '#fdf0ed', border: '1px solid #e74c3c', borderRadius: '8px', padding: '12px 16px', marginBottom: '12px', fontSize: '13px', color: '#c0392b' }}>
            <strong>Please complete:</strong> {getBasicInfoErrors().join(', ')}
          </div>
        )}

        {/* API error */}
        {regError && (
          <div style={{ color: '#c0392b', fontSize: '14px', marginBottom: '12px', padding: '10px', background: '#fdf0ed', borderRadius: '6px' }}>{regError}</div>
        )}

        {/* ─── Step 2: Basic Info ─── */}
        {step === 2 && (
          <>
            {/* Role confirmation banner */}
            {track && (
              <div style={{
                padding: '12px 16px', borderRadius: '10px', marginBottom: '16px',
                background: track === 'caregiver' ? '#FFF3E0' : track === 'care_for' ? '#e8eaf6' : '#e8f5f2',
                border: `1px solid ${track === 'caregiver' ? '#ffe0b2' : track === 'care_for' ? '#c5cae9' : '#b2dfdb'}`,
              }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#333' }}>
                  You are joining as {track === 'caregiver' ? 'a Caregiver' : track === 'care_for' ? 'someone who needs care' : 'a Family / Care Team Member'}
                </div>
                <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                  You can add other roles later from your account settings.
                  {!prefilledRole && !isInviteFlow && (
                    <a onClick={() => { setTrack(null); setStep(1); setShowFieldErrors(false); }} style={{ marginLeft: '6px', color: '#1b6b5a', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>Change</a>
                  )}
                </div>
              </div>
            )}
            <div className="form-group">
              <label>First Name {showFieldErrors && !formData.firstName.trim() && <span style={{ color: '#c0392b', fontSize: 12 }}>*required</span>}</label>
              <input type="text" value={formData.firstName} onChange={(e) => { setFormData(p => ({ ...p, firstName: e.target.value })); setShowFieldErrors(false); }} placeholder="Your first name" autoFocus style={showFieldErrors && !formData.firstName.trim() ? { borderColor: '#c0392b', background: '#fdf0ed' } : {}} />
            </div>
            <div className="form-group">
              <label>Last Name {showFieldErrors && !formData.lastName.trim() && <span style={{ color: '#c0392b', fontSize: 12 }}>*required</span>}</label>
              <input type="text" value={formData.lastName} onChange={(e) => { setFormData(p => ({ ...p, lastName: e.target.value })); setShowFieldErrors(false); }} placeholder="Your last name" style={showFieldErrors && !formData.lastName.trim() ? { borderColor: '#c0392b', background: '#fdf0ed' } : {}} />
            </div>
            <div className="form-group">
              <label>Email {showFieldErrors && (!formData.email.trim() || !isValidEmail(formData.email)) && <span style={{ color: '#c0392b', fontSize: 12 }}>*required</span>}</label>
              <input type="email" value={formData.email} onChange={(e) => { setFormData(p => ({ ...p, email: e.target.value })); setShowFieldErrors(false); }} placeholder="you@example.com" disabled={!!prefilledEmail} style={prefilledEmail ? { background: '#f0f0f0', color: '#666' } : showFieldErrors && (!formData.email.trim() || !isValidEmail(formData.email)) ? { borderColor: '#c0392b', background: '#fdf0ed' } : {}} />
              {formData.email && !isValidEmail(formData.email) ? <div style={{ fontSize: '12px', color: '#c0392b', marginTop: '4px' }}>Please enter a valid email address</div> : <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>Used to verify your account and for future payments</div>}
            </div>
            <div className="form-group">
              <label>Password {showFieldErrors && formData.password.length < 6 && <span style={{ color: '#c0392b', fontSize: 12 }}>*min 6 chars</span>}</label>
              <input type="password" value={formData.password} onChange={(e) => { setFormData(p => ({ ...p, password: e.target.value })); setShowFieldErrors(false); }} placeholder="At least 6 characters" style={showFieldErrors && formData.password.length < 6 ? { borderColor: '#c0392b', background: '#fdf0ed' } : {}} />
              <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>Two-Factor Authentication and Biometric available for setup later</div>
            </div>
            <div className="form-group">
              <label>Confirm Password {showFieldErrors && !formData.confirmPassword && <span style={{ color: '#c0392b', fontSize: 12 }}>*required</span>}{showFieldErrors && formData.confirmPassword && formData.password !== formData.confirmPassword && <span style={{ color: '#c0392b', fontSize: 12 }}>*doesn't match</span>}</label>
              <input type="password" value={formData.confirmPassword} onChange={(e) => { setFormData(p => ({ ...p, confirmPassword: e.target.value })); setShowFieldErrors(false); }} placeholder="Re-enter your password" style={showFieldErrors && (!formData.confirmPassword || formData.password !== formData.confirmPassword) ? { borderColor: '#c0392b', background: '#fdf0ed' } : formData.confirmPassword && formData.password === formData.confirmPassword ? { borderColor: '#1b6b5a', background: '#f0faf8' } : {}} />
              {formData.confirmPassword && formData.password === formData.confirmPassword && <div style={{ fontSize: '12px', color: '#1b6b5a', marginTop: '4px' }}>Passwords match</div>}
              {formData.confirmPassword && formData.password !== formData.confirmPassword && <div style={{ fontSize: '12px', color: '#c0392b', marginTop: '4px' }}>Passwords don't match</div>}
            </div>
            <div className="form-group">
              <label>Phone <span style={{ color: '#999', fontSize: 12, fontWeight: 400 }}>(optional)</span></label>
              <input type="tel" value={formData.phone} onChange={(e) => setFormData(p => ({ ...p, phone: formatPhone(e.target.value) }))} placeholder="(555) 123-4567" />
              <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>Required for setup, but not to begin</div>
            </div>
          </>
        )}

        {/* ─── Step 3: Caregiver Disclosures ─── */}
        {step === 3 && track === 'caregiver' && (
          <>
            <div style={{
              padding: '12px 16px', borderRadius: '10px', marginBottom: '12px',
              background: '#FFF3E0', border: '1px solid #ffe0b2',
            }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#333' }}>
                You are joining as a Caregiver
              </div>
              <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                You can add other roles later from your account settings.
              </div>
            </div>
            <div style={{ background: '#fff8e1', border: '1px solid #ffe0a0', borderRadius: '10px', padding: '16px', marginBottom: '16px', fontSize: '13px', color: '#5d4037' }}>
              <strong>Before we create your account</strong> — please review and acknowledge the following. These protect you and the families you'll work with.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <label style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', cursor: 'pointer', padding: '14px', borderRadius: '10px', border: formData.ackNoMedical ? '2px solid #1b6b5a' : '2px solid #e0e0e0', background: formData.ackNoMedical ? '#f0faf8' : '#fff', transition: 'all 0.2s' }}>
                <input type="checkbox" checked={formData.ackNoMedical} onChange={(e) => setFormData(p => ({ ...p, ackNoMedical: e.target.checked }))} style={{ marginTop: '2px', flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: '#333', marginBottom: '4px' }}>No medical care</div>
                  <div style={{ fontSize: '13px', color: '#666', lineHeight: 1.5 }}>InPlace does not provide at-home medical care in accordance with Virginia state law. Caregivers provide companionship, personal care, and household assistance only.</div>
                </div>
              </label>
              <label style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', cursor: 'pointer', padding: '14px', borderRadius: '10px', border: formData.ackBgCheck ? '2px solid #1b6b5a' : '2px solid #e0e0e0', background: formData.ackBgCheck ? '#f0faf8' : '#fff', transition: 'all 0.2s' }}>
                <input type="checkbox" checked={formData.ackBgCheck} onChange={(e) => setFormData(p => ({ ...p, ackBgCheck: e.target.checked }))} style={{ marginTop: '2px', flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: '#333', marginBottom: '4px' }}>Background check required</div>
                  <div style={{ fontSize: '13px', color: '#666', lineHeight: 1.5 }}>A comprehensive background check is required before you can accept jobs. The fee is $30 and is refunded after your first 10 completed sessions.</div>
                </div>
              </label>
              <label style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', cursor: 'pointer', padding: '14px', borderRadius: '10px', border: formData.ackPayments ? '2px solid #1b6b5a' : '2px solid #e0e0e0', background: formData.ackPayments ? '#f0faf8' : '#fff', transition: 'all 0.2s' }}>
                <input type="checkbox" checked={formData.ackPayments} onChange={(e) => setFormData(p => ({ ...p, ackPayments: e.target.checked }))} style={{ marginTop: '2px', flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: '#333', marginBottom: '4px' }}>Online payments</div>
                  <div style={{ fontSize: '13px', color: '#666', lineHeight: 1.5 }}>All payments are processed online through Stripe. You are an independent contractor, not an employee of InPlace. You'll set up Stripe after creating your account.</div>
                </div>
              </label>
            </div>
          </>
        )}

        {/* ─── Navigation buttons ─── */}
        <div style={{ display: 'flex', gap: '12px', marginTop: '24px', justifyContent: 'space-between' }}>
          <button onClick={handleBack} className="btn btn-outline">{'\u2190'} Back</button>
          {step === 2 && (
            <button onClick={handleNext} className="btn btn-primary" disabled={!isBasicInfoValid()} style={{ opacity: isBasicInfoValid() ? 1 : 0.5, cursor: isBasicInfoValid() ? 'pointer' : 'not-allowed' }}>
              {track === 'caregiver' ? 'Next \u2192' : (registering ? 'Creating Account...' : 'Create My Account')}
            </button>
          )}
          {step === 3 && (
            <button onClick={handleComplete} className="btn btn-primary" disabled={!isDisclosuresValid() || registering} style={{ opacity: (isDisclosuresValid() && !registering) ? 1 : 0.5, cursor: (isDisclosuresValid() && !registering) ? 'pointer' : 'not-allowed' }}>
              {registering ? 'Creating Account...' : 'Create My Account'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
