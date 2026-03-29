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
  const [authHint, setAuthHint] = useState(null); // 'tier2' or 'tier3' — set during family authorization question
  const [showFieldErrors, setShowFieldErrors] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [regError, setRegError] = useState('');
  const [sandboxPreview, setSandboxPreview] = useState(false);
  const [intlPhone, setIntlPhone] = useState(false);

  // Referral state — post-registration "who referred you?" flow
  const [showReferralStep, setShowReferralStep] = useState(false);
  const [refCode, setRefCode] = useState('');
  const [refSearch, setRefSearch] = useState('');
  const [refCandidates, setRefCandidates] = useState([]);
  const [refSearching, setRefSearching] = useState(false);
  const [refClaiming, setRefClaiming] = useState(false);
  const [refDone, setRefDone] = useState(false);
  const [refReferrerName, setRefReferrerName] = useState('');
  const [pendingUser, setPendingUser] = useState(null);

  // Detect ?ref= URL param
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get('ref');
      if (ref) setRefCode(ref);
    } catch (e) {}
  }, []);

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
    if (!formData.phone.trim()) errs.push('Phone number');
    if (formData.password.length < 8 || !/[A-Z]/.test(formData.password) || !/[0-9]/.test(formData.password) || !/[^A-Za-z0-9]/.test(formData.password)) errs.push('Password must meet all requirements');
    if (formData.password && formData.confirmPassword && formData.password !== formData.confirmPassword) errs.push('Passwords must match');
    if (!formData.confirmPassword) errs.push('Confirm password');
    return errs;
  };

  const isBasicInfoValid = () => {
    return formData.firstName.trim() && formData.lastName.trim() &&
           isValidEmail(formData.email) && formData.phone.trim() &&
           formData.password.length >= 8 && /[A-Z]/.test(formData.password) && /[0-9]/.test(formData.password) && /[^A-Za-z0-9]/.test(formData.password) &&
           formData.confirmPassword && formData.password === formData.confirmPassword;
  };

  // Strip phone formatting for storage — (555) 123-4567 → 5551234567, but keep + for international
  const normalizePhone = (phone) => {
    if (!phone) return null;
    if (intlPhone) return phone.replace(/[^\d\+]/g, ''); // keep + and digits
    return phone.replace(/\D/g, '');
  };

  const isDisclosuresValid = () => {
    return formData.ackNoMedical && formData.ackBgCheck && formData.ackPayments;
  };

  // ─── Navigation ───
  const handleNext = () => {
    if (step === 2 && isBasicInfoValid()) {
      setShowFieldErrors(false);
      handleComplete(); // All tracks go straight to account creation
    } else {
      setShowFieldErrors(true);
    }
  };

  const handleBack = () => {
    setShowFieldErrors(false);
    if (step === 2) {
      if (prefilledRole || isInviteFlow) { onNavigate('splash'); return; }
      // Family track with authHint: go back to authorization question
      if (track === 'family' && authHint) { setAuthHint(null); setStep(1); return; }
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
          ...(authHint ? { authHint } : {}),
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
      // If there's a referral code from URL, claim it automatically then log in
      if (refCode) {
        try {
          const claimRes = await apiFetch('/api/referrals/claim', { method: 'POST', body: JSON.stringify({ referralCode: refCode }) });
          if (claimRes?.ok) {
            const claimData = await claimRes.json();
            if (claimData.success && claimData.referrerName) {
              setPendingUser(res.user);
              setRefReferrerName(claimData.referrerName);
              setRefDone(true);
              setShowReferralStep(true);
              setRegistering(false);
              return; // Show thank-you before logging in
            }
          }
        } catch (e) { console.error('Auto-claim referral error:', e); }
        onLogin(res.user);
        return;
      }
      // Otherwise show the "who referred you?" step
      setPendingUser(res.user);
      setShowReferralStep(true);
      setRegistering(false);
      return;
    } catch (err) {
      if (typeof trackAuthEvent === 'function') {
        trackAuthEvent('registration', 'error', { email: formData.email, role: track, error: err.message, source: 'network' });
      }
      setRegError(err.message || 'Registration failed. Please try again.');
      setRegistering(false);
    }
  };

  // ─── Referral Step (post-registration) ───
  if (showReferralStep) {
    const handleRefSearch = async () => {
      if (!refSearch.trim()) return;
      setRefSearching(true);
      try {
        const res = await apiFetch('/api/referrals/claim', {
          method: 'POST',
          body: JSON.stringify({ referrerSearch: refSearch.trim() }),
        });
        if (res?.ok) {
          const d = await res.json();
          setRefCandidates(d.candidates || []);
        }
      } catch (e) { console.error('Referral search error:', e); }
      setRefSearching(false);
    };
    const handleSelectReferrer = async (referrerUserId) => {
      setRefClaiming(true);
      try {
        const res = await apiFetch('/api/referrals/select-referrer', {
          method: 'POST',
          body: JSON.stringify({ referrerUserId }),
        });
        if (res?.ok) {
          const d = await res.json();
          if (d.success) {
            setRefReferrerName(d.referrerName || '');
            setRefDone(true);
          }
        }
      } catch (e) { console.error('Select referrer error:', e); }
      setRefClaiming(false);
    };
    const finishLogin = () => {
      if (pendingUser) onLogin(pendingUser);
    };

    return (
      <div className="register-container">
        <div className="register-card" style={{ maxWidth: '480px' }}>
          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <div style={{ fontSize: '48px', marginBottom: '8px' }}>{refDone ? '\u{1F389}' : '\u{1F91D}'}</div>
            <h2 style={{ margin: '0 0 8px', fontSize: '20px' }}>
              {refDone ? 'Welcome to inPlace!' : 'One Last Thing...'}
            </h2>
          </div>

          {refDone ? (
            <div>
              {refReferrerName && (
                <div style={{ background: 'var(--color-success-bg)', border: '1px solid #c8e6c9', borderRadius: 10, padding: '14px 16px', marginBottom: 16, textAlign: 'center' }}>
                  <div style={{ fontSize: 14, color: 'var(--color-success)', fontWeight: 600 }}>
                    {refReferrerName} has been credited for your referral. Thank you!
                  </div>
                </div>
              )}
              <button onClick={finishLogin} className="btn btn-primary" style={{ width: '100%', padding: '14px', fontSize: '16px' }}>
                Get Started
              </button>
            </div>
          ) : (
            <div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '16px', textAlign: 'center' }}>
                Did someone tell you about inPlace? Let us thank them!
              </p>

              {/* Search by name */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>Search by name</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="text" value={refSearch} onChange={(e) => setRefSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleRefSearch()}
                    placeholder="e.g. Sarah, Maria Jones..."
                    style={{ flex: 1, padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }} />
                  <button onClick={handleRefSearch} disabled={refSearching || !refSearch.trim()} style={{
                    padding: '10px 16px', background: refSearching ? 'var(--border-light)' : 'var(--role-color)', color: 'var(--text-on-primary)',
                    border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: refSearching ? 'wait' : 'pointer',
                  }}>{refSearching ? '...' : 'Search'}</button>
                </div>
              </div>

              {/* Search results */}
              {refCandidates.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 6 }}>Select who referred you:</div>
                  {refCandidates.map(c => (
                    <div key={c.id} onClick={() => !refClaiming && handleSelectReferrer(c.id)} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                      border: '1px solid #e0e0e0', borderRadius: 8, marginBottom: 6,
                      cursor: refClaiming ? 'wait' : 'pointer', background: 'var(--bg-surface)',
                      transition: 'all 0.15s',
                    }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--role-color)'; e.currentTarget.style.background = 'var(--bg-highlight)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-light)'; e.currentTarget.style.background = 'var(--bg-card)'; }}
                    >
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%', background: 'var(--color-success-bg)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14, fontWeight: 700, color: 'var(--role-color)', flexShrink: 0,
                      }}>{(c.name || '?')[0].toUpperCase()}</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{c.name}</div>
                    </div>
                  ))}
                  {refCandidates.length === 0 && refSearch && (
                    <div style={{ fontSize: 13, color: 'var(--text-tertiary)', textAlign: 'center', padding: 10 }}>No matches found. Try a different name.</div>
                  )}
                </div>
              )}

              {/* Or enter referral code */}
              {!refCode && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 8 }}>or enter a referral code</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input type="text" value={refCode} onChange={(e) => setRefCode(e.target.value)}
                      placeholder="e.g. sarah-x9k2"
                      style={{ flex: 1, padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }} />
                    <button onClick={async () => {
                      if (!refCode.trim()) return;
                      setRefClaiming(true);
                      try {
                        const res = await apiFetch('/api/referrals/claim', {
                          method: 'POST',
                          body: JSON.stringify({ referralCode: refCode.trim() }),
                        });
                        if (res?.ok) {
                          const d = await res.json();
                          if (d.success) { setRefReferrerName(d.referrerName || ''); setRefDone(true); }
                        } else {
                          const d = await res.json().catch(() => ({}));
                          setRegError(d.error || 'Code not found');
                        }
                      } catch (e) { console.error('Claim referral error:', e); }
                      setRefClaiming(false);
                    }} disabled={refClaiming || !refCode.trim()} style={{
                      padding: '10px 16px', background: refClaiming ? 'var(--border-light)' : 'var(--role-color)', color: 'var(--text-on-primary)',
                      border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: refClaiming ? 'wait' : 'pointer',
                    }}>{refClaiming ? '...' : 'Apply'}</button>
                  </div>
                  {regError && <div style={{ fontSize: 12, color: 'var(--color-error)', marginTop: 4 }}>{regError}</div>}
                </div>
              )}

              {/* Skip button */}
              <button onClick={finishLogin} style={{
                width: '100%', padding: '12px', background: 'var(--bg-primary)', color: 'var(--text-tertiary)',
                border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 14, cursor: 'pointer', marginTop: 8,
              }}>No one referred me — skip this</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Sandbox preview ───
  if (sandboxPreview) {
    const roleLabel = track === 'caregiver' ? 'Caregiver' : track === 'care_for' ? 'Care Recipient' : 'Family Member';
    return (
      <div className="register-container">
        <div className="register-card" style={{ maxWidth: '480px' }}>
          <div style={{ background: 'var(--color-warning-bg)', border: '2px solid #ff9800', borderRadius: '12px', padding: '16px', marginBottom: '20px', textAlign: 'center' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-warning)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>Sandbox Mode</div>
            <div style={{ fontSize: '13px', color: '#bf360c' }}>No account was created. This is a preview.</div>
          </div>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>{'✅'}</div>
            <h2 style={{ margin: '0 0 8px', fontSize: '20px' }}>Registration Complete (Preview)</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', margin: 0 }}>Here's what would happen:</p>
          </div>
          <div style={{ background: 'var(--bg-primary)', padding: '16px', borderRadius: '8px', marginBottom: '20px', fontSize: '14px', lineHeight: 1.8 }}>
            <p style={{ margin: '0 0 4px' }}><strong>Name:</strong> {formData.firstName} {formData.lastName}</p>
            <p style={{ margin: '0 0 4px' }}><strong>Email:</strong> {formData.email}</p>
            <p style={{ margin: '0 0 4px' }}><strong>Role:</strong> {roleLabel}</p>
            {track === 'caregiver' && (
              <div style={{ borderTop: '1px solid #e0e0e0', marginTop: '8px', paddingTop: '8px' }}>
                <p style={{ margin: '0 0 2px', color: 'var(--role-color)' }}>{'✓'} No-medical-care disclosure acknowledged</p>
                <p style={{ margin: '0 0 2px', color: 'var(--role-color)' }}>{'✓'} Background check fee acknowledged</p>
                <p style={{ margin: '0 0 2px', color: 'var(--role-color)' }}>{'✓'} Online payments acknowledged</p>
              </div>
            )}
          </div>
          <div style={{ background: 'var(--bg-teal-light)', padding: '14px', borderRadius: '8px', marginBottom: '20px', fontSize: '13px', color: 'var(--role-color-dark)' }}>
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
        color: 'var(--color-indigo)',
        bgColor: 'var(--color-purple-bg)',
      },
      {
        id: 'family',
        icon: '💛',
        title: 'I want to help my loved one arrange care',
        subtitle: 'Coordinate and manage care for a family member',
        color: 'var(--role-color)',
        bgColor: 'var(--bg-teal-light)',
      },
      {
        id: 'caregiver',
        icon: '🤝',
        title: 'I want to find meaningful work at fair wages',
        subtitle: 'Join as a caregiver and connect with families who need you',
        color: 'var(--accent-color)',
        bgColor: 'var(--color-warning-bg)',
      },
    ];

    return (
      <div className="register-container">
        {sandboxMode && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, background: 'var(--color-warning)', color: 'var(--text-on-primary)', textAlign: 'center', padding: '6px', fontSize: '13px', fontWeight: 700, zIndex: 9999, letterSpacing: '0.5px' }}>
            SANDBOX MODE — no accounts will be created
          </div>
        )}
        <div className="register-card" style={{ maxWidth: '480px', marginTop: sandboxMode ? '40px' : undefined }}>
          <div className="register-header">
            <div style={{ marginBottom: '16px' }}>
              {typeof InPlaceIcon !== 'undefined' && React.createElement(InPlaceIcon, { width: 50, height: 50 })}
            </div>
            <h1 style={{ marginBottom: '8px' }}>Join InPlace</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '15px', margin: 0 }}>You can add profiles later, but most people start with what they need the most. Which is best for you?</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', margin: '20px 0' }}>
            {roleCards.map(card => (
              <div key={card.id} onClick={() => {
                if (typeof trackAuthEvent === 'function') trackAuthEvent('registration', 'role_selected', { role: card.id });
                setTrack(card.id);
                if (card.id === 'family') { /* stay on step 1 to show authorization question */ }
                else setStep(2);
              }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '16px',
                  padding: '18px 20px', borderRadius: '12px',
                  border: '2px solid #e8e8e8', cursor: 'pointer',
                  transition: 'all 0.2s',
                  background: 'var(--bg-surface)',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = card.color; e.currentTarget.style.background = card.bgColor; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-light)'; e.currentTarget.style.background = 'var(--bg-card)'; }}
              >
                <div style={{
                  width: '52px', height: '52px', borderRadius: '50%',
                  background: card.bgColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '28px', flexShrink: 0,
                }}>
                  {card.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '2px' }}>{card.title}</div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>{card.subtitle}</div>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '18px', flexShrink: 0 }}>{'\u2192'}</div>
              </div>
            ))}
          </div>
          <div className="text-center">
            <p style={{ fontSize: '14px', marginBottom: '8px' }}>Already have an account? <a onClick={() => onNavigate('login')} style={{ cursor: 'pointer', color: 'var(--role-color)', fontWeight: 600 }}>Sign In</a></p>
            <p style={{ fontSize: '14px' }}><a onClick={() => onNavigate('splash')} style={{ color: 'var(--text-tertiary)', cursor: 'pointer' }}>{'\u2190'} Back to home</a></p>
          </div>
        </div>
      </div>
    );
  }

  // ─── Screen 1.5: Family Authorization Question ───
  if (step === 1 && track === 'family' && !authHint) {
    const authCards = [
      {
        id: 'tier3',
        icon: '\u{1F91D}',
        title: 'They know and agree to this',
        subtitle: 'We\'ll verify their awareness before the first visit',
        color: 'var(--role-color)',
        bgColor: 'var(--bg-teal-light)',
      },
      {
        id: 'tier2',
        icon: '\u{1F4C4}',
        title: 'I have Power of Attorney or legal guardianship',
        subtitle: 'You\'ll upload your legal document for verification',
        color: 'var(--color-indigo)',
        bgColor: 'var(--color-purple-bg)',
      },
    ];
    return (
      <div className="register-container">
        {sandboxMode && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, background: 'var(--color-warning)', color: 'var(--text-on-primary)', textAlign: 'center', padding: '6px', fontSize: '13px', fontWeight: 700, zIndex: 9999, letterSpacing: '0.5px' }}>
            SANDBOX MODE \u2014 no accounts will be created
          </div>
        )}
        <div className="register-card" style={{ maxWidth: '480px', marginTop: sandboxMode ? '40px' : undefined }}>
          <div className="register-header">
            <div style={{ marginBottom: '16px' }}>
              {typeof InPlaceIcon !== 'undefined' && React.createElement(InPlaceIcon, { width: 50, height: 50 })}
            </div>
            <h1 style={{ marginBottom: '8px' }}>How is care being arranged?</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '15px', margin: 0 }}>This helps us set up the right verification and keep everyone safe.</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', margin: '20px 0' }}>
            {authCards.map(card => (
              <div key={card.id} onClick={() => {
                setAuthHint(card.id);
                setStep(2);
              }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '16px',
                  padding: '18px 20px', borderRadius: '12px',
                  border: '2px solid #e8e8e8', cursor: 'pointer',
                  transition: 'all 0.2s',
                  background: 'var(--bg-surface)',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = card.color; e.currentTarget.style.background = card.bgColor; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-light)'; e.currentTarget.style.background = 'var(--bg-card)'; }}
              >
                <div style={{
                  width: '52px', height: '52px', borderRadius: '50%',
                  background: card.bgColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '28px', flexShrink: 0,
                }}>
                  {card.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '2px' }}>{card.title}</div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>{card.subtitle}</div>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '18px', flexShrink: 0 }}>{'\u2192'}</div>
              </div>
            ))}
          </div>
          <div className="text-center">
            <p style={{ fontSize: '14px' }}><a onClick={() => { setTrack(null); }} style={{ color: 'var(--text-tertiary)', cursor: 'pointer' }}>{'\u2190'} Back to role selection</a></p>
          </div>
        </div>
      </div>
    );
  }

  // ─── Screen 2: Basic Info (all roles) ───
  // ─── Screen 3: Caregiver Disclosures ───
  const totalSteps = track === 'caregiver' ? 3 : (track === 'family' && authHint) ? 3 : 2;
  const stepLabels = track === 'caregiver'
    ? ['Choose Your Path', 'Your Information', 'Quick Disclosures']
    : (track === 'family' && authHint)
    ? ['Choose Your Path', 'Care Authorization', 'Your Information']
    : ['Choose Your Path', 'Your Information'];
  // For family with authHint, step 2 (basic info) is visual step 3
  const displayStep = (track === 'family' && authHint) ? step + 1 : step;

  return (
    <div className="register-container">
      {sandboxMode && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, background: 'var(--color-warning)', color: 'var(--text-on-primary)', textAlign: 'center', padding: '6px', fontSize: '13px', fontWeight: 700, zIndex: 9999, letterSpacing: '0.5px' }}>
          SANDBOX MODE — no accounts will be created
        </div>
      )}
      <div className="register-card" style={{ marginTop: sandboxMode ? '40px' : undefined }}>
        <div className="register-header">
          <h1 style={{ marginBottom: '4px' }}>
            {step === 2 ? 'Create Your Account' : 'Almost There'}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', margin: 0 }}>{stepLabels[displayStep - 1]}</p>
        </div>

        {/* Step indicator */}
        <div className="step-indicator" style={{ marginBottom: '20px' }}>
          {stepLabels.map((s, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div className={'step-dot' + (displayStep === i + 1 ? ' active' : '') + (displayStep > i + 1 ? ' completed' : '')}>
                {displayStep <= i + 1 ? i + 1 : '\u2713'}
              </div>
              <div className="step-label" style={{ fontSize: '11px' }}>{s}</div>
            </div>
          ))}
        </div>

        {/* Validation errors */}
        {showFieldErrors && step === 2 && getBasicInfoErrors().length > 0 && (
          <div style={{ background: 'var(--bg-accent-light)', border: '1px solid #e74c3c', borderRadius: '8px', padding: '12px 16px', marginBottom: '12px', fontSize: '13px', color: 'var(--color-error)' }}>
            <strong>Please complete:</strong> {getBasicInfoErrors().join(', ')}
          </div>
        )}

        {/* API error */}
        {regError && (
          <div style={{ color: 'var(--color-error)', fontSize: '14px', marginBottom: '12px', padding: '10px', background: 'var(--bg-accent-light)', borderRadius: '6px' }}>{regError}</div>
        )}

        {/* ─── Step 2: Basic Info ─── */}
        {step === 2 && (
          <>
            {/* Role confirmation banner */}
            {track && (
              <div style={{
                padding: '12px 16px', borderRadius: '10px', marginBottom: '16px',
                background: track === 'caregiver' ? 'var(--color-warning-bg)' : track === 'care_for' ? 'var(--color-purple-bg)' : 'var(--bg-teal-light)',
                border: `1px solid ${track === 'caregiver' ? '#ffe0b2' : track === 'care_for' ? '#c5cae9' : '#b2dfdb'}`,
              }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {track === 'caregiver' ? 'You are joining as a Caregiver'
                   : track === 'care_for' ? 'You are joining as someone who needs care'
                   : authHint === 'tier2' ? 'Family member with legal authority (POA / guardianship)'
                   : authHint === 'tier3' ? 'Family member \u2014 your loved one knows and consents'
                   : 'You are joining as a Family / Care Team Member'}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  You can add other roles later from your account settings.
                  {!prefilledRole && !isInviteFlow && (
                    <a onClick={() => { setTrack(null); setAuthHint(null); setStep(1); setShowFieldErrors(false); }} style={{ marginLeft: '6px', color: 'var(--role-color)', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>Change</a>
                  )}
                </div>
              </div>
            )}
            <div className="form-group">
              <label>First Name {showFieldErrors && !formData.firstName.trim() && <span style={{ color: 'var(--color-error)', fontSize: 12 }}>*required</span>}</label>
              <input type="text" value={formData.firstName} onChange={(e) => { setFormData(p => ({ ...p, firstName: e.target.value })); setShowFieldErrors(false); }} placeholder="Your first name" autoFocus style={showFieldErrors && !formData.firstName.trim() ? { borderColor: 'var(--color-error)', background: 'var(--bg-accent-light)' } : {}} />
            </div>
            <div className="form-group">
              <label>Last Name {showFieldErrors && !formData.lastName.trim() && <span style={{ color: 'var(--color-error)', fontSize: 12 }}>*required</span>}</label>
              <input type="text" value={formData.lastName} onChange={(e) => { setFormData(p => ({ ...p, lastName: e.target.value })); setShowFieldErrors(false); }} placeholder="Your last name" style={showFieldErrors && !formData.lastName.trim() ? { borderColor: 'var(--color-error)', background: 'var(--bg-accent-light)' } : {}} />
            </div>
            <div className="form-group">
              <label>Email {showFieldErrors && (!formData.email.trim() || !isValidEmail(formData.email)) && <span style={{ color: 'var(--color-error)', fontSize: 12 }}>*required</span>}</label>
              <input type="email" value={formData.email} onChange={(e) => { setFormData(p => ({ ...p, email: e.target.value })); setShowFieldErrors(false); }} placeholder="you@example.com" disabled={!!prefilledEmail} style={prefilledEmail ? { background: 'var(--badge-muted-bg)', color: 'var(--text-secondary)' } : showFieldErrors && (!formData.email.trim() || !isValidEmail(formData.email)) ? { borderColor: 'var(--color-error)', background: 'var(--bg-accent-light)' } : {}} />
              {formData.email && !isValidEmail(formData.email) ? <div style={{ fontSize: '12px', color: 'var(--color-error)', marginTop: '4px' }}>Please enter a valid email address</div> : <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>Used to verify your account and for future payments</div>}
            </div>
            <div className="form-group">
              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Phone Number {showFieldErrors && !formData.phone.trim() && <span style={{ color: 'var(--color-error)', fontSize: 12 }}>*required</span>}</span>
                <button type="button" onClick={() => { setIntlPhone(!intlPhone); setFormData(p => ({ ...p, phone: '' })); }} style={{ background: 'none', border: 'none', color: 'var(--role-color)', fontSize: 11, cursor: 'pointer', fontWeight: 600, padding: 0 }}>
                  {intlPhone ? 'US number' : 'International number'}
                </button>
              </label>
              <input type="tel" value={formData.phone} onChange={(e) => { const v = formatPhone(e.target.value, intlPhone); setFormData(p => ({ ...p, phone: v })); setShowFieldErrors(false); }} placeholder={intlPhone ? '+44 20 7946 0958' : '(555) 123-4567'} style={showFieldErrors && !formData.phone.trim() ? { borderColor: 'var(--color-error)', background: 'var(--bg-accent-light)' } : {}} />
              {intlPhone && <div style={{ fontSize: 11, color: 'var(--accent-color)', marginTop: 4, lineHeight: 1.4 }}>{INTL_PHONE_DISCLAIMER}</div>}
              {!intlPhone && <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>For care coordination and emergencies</div>}
            </div>
            <div className="form-group">
              <label>Password {showFieldErrors && (formData.password.length < 8 || !/[A-Z]/.test(formData.password) || !/[0-9]/.test(formData.password) || !/[^A-Za-z0-9]/.test(formData.password)) && <span style={{ color: 'var(--color-error)', fontSize: 12 }}>*see requirements below</span>}</label>
              <input type="password" value={formData.password} onChange={(e) => { setFormData(p => ({ ...p, password: e.target.value })); setShowFieldErrors(false); }} placeholder="Create a strong password" style={showFieldErrors && (formData.password.length < 8 || !/[A-Z]/.test(formData.password) || !/[0-9]/.test(formData.password) || !/[^A-Za-z0-9]/.test(formData.password)) ? { borderColor: 'var(--color-error)', background: 'var(--bg-accent-light)' } : formData.password.length >= 8 && /[A-Z]/.test(formData.password) && /[0-9]/.test(formData.password) && /[^A-Za-z0-9]/.test(formData.password) ? { borderColor: 'var(--role-color)', background: 'var(--bg-highlight)' } : {}} />
              {formData.password.length > 0 ? (
                <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
                  <div style={{ fontSize: 12, color: formData.password.length >= 8 ? 'var(--role-color)' : 'var(--color-error)' }}>{formData.password.length >= 8 ? '✓' : '✗'} At least 8 characters</div>
                  <div style={{ fontSize: 12, color: /[A-Z]/.test(formData.password) ? 'var(--role-color)' : 'var(--color-error)' }}>{/[A-Z]/.test(formData.password) ? '✓' : '✗'} Uppercase letter</div>
                  <div style={{ fontSize: 12, color: /[0-9]/.test(formData.password) ? 'var(--role-color)' : 'var(--color-error)' }}>{/[0-9]/.test(formData.password) ? '✓' : '✗'} Number</div>
                  <div style={{ fontSize: 12, color: /[^A-Za-z0-9]/.test(formData.password) ? 'var(--role-color)' : 'var(--color-error)' }}>{/[^A-Za-z0-9]/.test(formData.password) ? '✓' : '✗'} Symbol (!@#$...)</div>
                </div>
              ) : (
                <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>8+ characters with uppercase, number & symbol. 2FA available later.</div>
              )}
            </div>
            <div className="form-group">
              <label>Confirm Password {showFieldErrors && !formData.confirmPassword && <span style={{ color: 'var(--color-error)', fontSize: 12 }}>*required</span>}{showFieldErrors && formData.confirmPassword && formData.password !== formData.confirmPassword && <span style={{ color: 'var(--color-error)', fontSize: 12 }}>*doesn't match</span>}</label>
              <input type="password" value={formData.confirmPassword} onChange={(e) => { setFormData(p => ({ ...p, confirmPassword: e.target.value })); setShowFieldErrors(false); }} placeholder="Re-enter your password" style={showFieldErrors && (!formData.confirmPassword || formData.password !== formData.confirmPassword) ? { borderColor: 'var(--color-error)', background: 'var(--bg-accent-light)' } : formData.confirmPassword && formData.password === formData.confirmPassword ? { borderColor: 'var(--role-color)', background: 'var(--bg-highlight)' } : {}} />
              {formData.confirmPassword && formData.password === formData.confirmPassword && <div style={{ fontSize: '12px', color: 'var(--role-color)', marginTop: '4px' }}>Passwords match</div>}
              {formData.confirmPassword && formData.password !== formData.confirmPassword && <div style={{ fontSize: '12px', color: 'var(--color-error)', marginTop: '4px' }}>Passwords don't match</div>}
            </div>
          </>
        )}

        {/* ─── Step 3: Caregiver Disclosures ─── */}
        {step === 3 && track === 'caregiver' && (
          <>
            <div style={{
              padding: '12px 16px', borderRadius: '10px', marginBottom: '12px',
              background: 'var(--color-warning-bg)', border: '1px solid #ffe0b2',
            }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                You are joining as a Caregiver
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                You can add other roles later from your account settings.
              </div>
            </div>
            <div style={{ background: 'var(--color-warning-bg)', border: '1px solid #ffe0a0', borderRadius: '10px', padding: '16px', marginBottom: '16px', fontSize: '13px', color: '#5d4037' }}>
              <strong>Before we create your account</strong> — please review and acknowledge the following. These protect you and the families you'll work with.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <label style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', cursor: 'pointer', padding: '14px', borderRadius: '10px', border: formData.ackNoMedical ? '2px solid #1b6b5a' : '2px solid #e0e0e0', background: formData.ackNoMedical ? 'var(--bg-highlight)' : 'var(--bg-card)', transition: 'all 0.2s' }}>
                <input type="checkbox" checked={formData.ackNoMedical} onChange={(e) => setFormData(p => ({ ...p, ackNoMedical: e.target.checked }))} style={{ marginTop: '2px', flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)', marginBottom: '4px' }}>No medical care</div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>InPlace does not provide at-home medical care in accordance with Virginia state law. Caregivers provide companionship, personal care, and household assistance only.</div>
                </div>
              </label>
              <label style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', cursor: 'pointer', padding: '14px', borderRadius: '10px', border: formData.ackBgCheck ? '2px solid #1b6b5a' : '2px solid #e0e0e0', background: formData.ackBgCheck ? 'var(--bg-highlight)' : 'var(--bg-card)', transition: 'all 0.2s' }}>
                <input type="checkbox" checked={formData.ackBgCheck} onChange={(e) => setFormData(p => ({ ...p, ackBgCheck: e.target.checked }))} style={{ marginTop: '2px', flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)', marginBottom: '4px' }}>Background check required</div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>A comprehensive background check is required before you can accept jobs. The fee is $30 and is refunded after your first 10 completed sessions.</div>
                </div>
              </label>
              <label style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', cursor: 'pointer', padding: '14px', borderRadius: '10px', border: formData.ackPayments ? '2px solid #1b6b5a' : '2px solid #e0e0e0', background: formData.ackPayments ? 'var(--bg-highlight)' : 'var(--bg-card)', transition: 'all 0.2s' }}>
                <input type="checkbox" checked={formData.ackPayments} onChange={(e) => setFormData(p => ({ ...p, ackPayments: e.target.checked }))} style={{ marginTop: '2px', flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)', marginBottom: '4px' }}>Online payments</div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>All payments are processed online through Stripe. You are an independent contractor, not an employee of InPlace. You'll set up Stripe after creating your account.</div>
                </div>
              </label>
            </div>
          </>
        )}

        {/* ─── Navigation buttons ─── */}
        <div style={{ display: 'flex', gap: '12px', marginTop: '24px', justifyContent: 'space-between' }}>
          <button onClick={handleBack} className="btn btn-outline">{'\u2190'} Back</button>
          {step === 2 && (
            <button onClick={handleNext} className="btn btn-primary" disabled={!isBasicInfoValid() || registering} style={{ opacity: (isBasicInfoValid() && !registering) ? 1 : 0.5, cursor: (isBasicInfoValid() && !registering) ? 'pointer' : 'not-allowed' }}>
              {registering ? 'Creating Account...' : 'Create My Account'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
