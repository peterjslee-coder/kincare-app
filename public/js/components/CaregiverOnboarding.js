// ─── Caregiver Onboarding Flow ───
// Multi-step wizard shown when a user visits ?invite=TOKEN
// Creates user account + caregiver profile + uploads documents in one flow.
const CaregiverOnboarding = window.CaregiverOnboarding = ({ inviteToken, onComplete }) => {
  const [step, setStep] = useState(1);
  const [inviteInfo, setInviteInfo] = useState(null);
  const [inviteError, setInviteError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [authToken, setAuthTokenState] = useState(null);
  const [profileId, setProfileId] = useState(null);
  const [errors, setErrors] = useState({});

  // Form data across all steps
  const [form, setForm] = useState({
    // Step 1 — Account
    firstName: '', lastName: '', email: '', password: '', confirmPassword: '',
    // Step 2 — Personal Info
    phone: '', addressLine1: '', addressLine2: '', city: '', state: '', zip: '',
    yearsExperience: '', hourlyRate: '', bio: '',
    // Step 3 — Legal / Checkr
    legalFirstName: '', legalLastName: '', dateOfBirth: '', ssnLast4: '',
    dlNumber: '', dlState: '', backgroundCheckConsent: false,
    // Step 4 — Certifications
    certifications: [{ certType: '', certNumber: '', issuer: '', expiryDate: '' }],
    // Step 5 — Documents
    documents: [], // { type, file, preview, fileName }
  });

  const TOTAL_STEPS = 6;
  const US_STATES = [
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS',
    'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
    'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
  ];
  const CERT_TYPES = ['CNA', 'HHA', 'LPN', 'RN', 'CPR/First Aid', 'BLS', 'ACLS', 'Other'];

  // Validate invite token on mount
  useEffect(() => {
    validateInvite();
  }, []);

  const validateInvite = async () => {
    try {
      const res = await fetch(`/api/platform-invites/info?token=${inviteToken}`);
      if (res.ok) {
        const data = await res.json();
        setInviteInfo(data.invite);
        setForm(f => ({ ...f, email: data.invite.email }));
      } else {
        const data = await res.json();
        setInviteError(data.error || 'Invalid invite');
      }
    } catch (err) {
      setInviteError('Failed to validate invite');
    }
    setLoading(false);
  };

  const updateForm = (field, value) => {
    setForm(f => ({ ...f, [field]: value }));
    setErrors(e => ({ ...e, [field]: null }));
  };

  const validateStep = (stepNum) => {
    const errs = {};
    if (stepNum === 1) {
      if (!form.firstName.trim()) errs.firstName = 'Required';
      if (!form.lastName.trim()) errs.lastName = 'Required';
      if (!form.email.trim()) errs.email = 'Required';
      if (!form.password || form.password.length < 8) errs.password = 'Minimum 8 characters';
      if (form.password !== form.confirmPassword) errs.confirmPassword = 'Passwords do not match';
    }
    if (stepNum === 2) {
      if (!form.phone.trim()) errs.phone = 'Required';
      if (!form.addressLine1.trim()) errs.addressLine1 = 'Required';
      if (!form.city.trim()) errs.city = 'Required';
      if (!form.state) errs.state = 'Required';
      if (!form.zip.trim()) errs.zip = 'Required';
      if (!form.hourlyRate) errs.hourlyRate = 'Required';
    }
    if (stepNum === 3) {
      if (!form.legalFirstName.trim()) errs.legalFirstName = 'Required';
      if (!form.legalLastName.trim()) errs.legalLastName = 'Required';
      if (!form.dateOfBirth) errs.dateOfBirth = 'Required';
      if (!form.ssnLast4 || form.ssnLast4.length !== 4) errs.ssnLast4 = 'Enter last 4 digits';
      if (!form.dlNumber.trim()) errs.dlNumber = 'Required';
      if (!form.dlState) errs.dlState = 'Required';
      if (!form.backgroundCheckConsent) errs.backgroundCheckConsent = 'You must consent to proceed';
    }
    if (stepNum === 5) {
      const hasDLFront = form.documents.some(d => d.type === 'dl_front');
      const hasDLBack = form.documents.some(d => d.type === 'dl_back');
      if (!hasDLFront) errs.dl_front = "Driver's license front is required";
      if (!hasDLBack) errs.dl_back = "Driver's license back is required";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // Step 1: Create account
  const handleCreateAccount = async () => {
    if (!validateStep(1)) return;
    setSaving(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email, password: form.password,
          firstName: form.firstName, lastName: form.lastName,
          role: inviteInfo.role || 'caregiver',
        }),
      });
      const data = await res.json();
      if (!res.ok) { setErrors({ submit: data.error || 'Registration failed' }); setSaving(false); return; }

      // Store token
      const token = data.token;
      setAuthTokenState(token);
      if (typeof setAuthToken === 'function') setAuthToken(token);
      localStorage.setItem('auth_token', token);
      window.AUTH_TOKEN = token;

      // Accept invite
      await fetch('/api/platform-invites/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ token: inviteToken }),
      });

      setStep(2);
    } catch (err) {
      setErrors({ submit: 'Network error — please try again' });
    }
    setSaving(false);
  };

  // Step 2: Save personal info + create caregiver profile
  const handleSavePersonalInfo = async () => {
    if (!validateStep(2)) return;
    setSaving(true);
    try {
      const token = authToken || window.AUTH_TOKEN;
      const res = await fetch('/api/caregivers/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          bio: form.bio, yearsExperience: parseInt(form.yearsExperience) || 0,
          hourlyRate: parseFloat(form.hourlyRate),
          specialties: [], certifications: [],
          city: form.city, state: form.state,
          address: form.addressLine1,
          addressLine1: form.addressLine1, addressLine2: form.addressLine2, zip: form.zip,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setErrors({ submit: data.error || 'Failed to save profile' }); setSaving(false); return; }
      setProfileId(data.profile?.id);

      // Also update user phone
      await fetch('/api/auth/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ phone: form.phone }),
      });

      setStep(3);
    } catch (err) {
      setErrors({ submit: 'Network error — please try again' });
    }
    setSaving(false);
  };

  // Step 3: Save legal/Checkr info
  const handleSaveLegalInfo = async () => {
    if (!validateStep(3)) return;
    setSaving(true);
    try {
      const token = authToken || window.AUTH_TOKEN;
      const res = await fetch('/api/caregivers/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          hourlyRate: parseFloat(form.hourlyRate) || 25,
          legalFirstName: form.legalFirstName, legalLastName: form.legalLastName,
          dateOfBirth: form.dateOfBirth, ssnLast4: form.ssnLast4,
          dlNumber: form.dlNumber, dlState: form.dlState,
          backgroundCheckConsent: form.backgroundCheckConsent,
        }),
      });
      if (!res.ok) { const data = await res.json(); setErrors({ submit: data.error }); setSaving(false); return; }
      setStep(4);
    } catch (err) {
      setErrors({ submit: 'Network error' });
    }
    setSaving(false);
  };

  // Step 4: Save certifications
  const handleSaveCertifications = async () => {
    setSaving(true);
    try {
      const token = authToken || window.AUTH_TOKEN;
      const validCerts = form.certifications.filter(c => c.certType);
      await fetch('/api/caregivers/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          hourlyRate: parseFloat(form.hourlyRate) || 25,
          certifications: validCerts.map(c => `${c.certType}${c.certNumber ? ' #' + c.certNumber : ''}`),
        }),
      });
      setStep(5);
    } catch (err) {
      setErrors({ submit: 'Network error' });
    }
    setSaving(false);
  };

  // Step 5: Upload documents
  const handleUploadDocuments = async () => {
    if (!validateStep(5)) return;
    setSaving(true);
    try {
      const token = authToken || window.AUTH_TOKEN;
      const formData = new FormData();
      const types = [];
      const metadata = [];

      form.documents.forEach(doc => {
        formData.append('documents', doc.file);
        types.push(doc.type);
        metadata.push(doc.metadata || {});
      });

      formData.append('types', JSON.stringify(types));
      formData.append('metadata', JSON.stringify(metadata));

      const res = await fetch('/api/caregiver-onboarding/documents', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) { const data = await res.json(); setErrors({ submit: data.error }); setSaving(false); return; }
      setStep(6);
    } catch (err) {
      setErrors({ submit: 'Upload failed — please try again' });
    }
    setSaving(false);
  };

  // Document handling
  const handleFileSelect = (docType, e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setErrors(er => ({ ...er, [docType]: 'File must be under 5MB' })); return; }
    if (!file.type.startsWith('image/')) { setErrors(er => ({ ...er, [docType]: 'Must be an image file' })); return; }

    const reader = new FileReader();
    reader.onload = (ev) => {
      setForm(f => {
        const docs = f.documents.filter(d => d.type !== docType);
        docs.push({ type: docType, file, preview: ev.target.result, fileName: file.name });
        return { ...f, documents: docs };
      });
      setErrors(e => ({ ...e, [docType]: null }));
    };
    reader.readAsDataURL(file);
  };

  const removeDocument = (docType) => {
    setForm(f => ({ ...f, documents: f.documents.filter(d => d.type !== docType) }));
  };

  // Cert handling
  const addCertification = () => {
    setForm(f => ({
      ...f,
      certifications: [...f.certifications, { certType: '', certNumber: '', issuer: '', expiryDate: '' }],
    }));
  };

  const updateCert = (idx, field, value) => {
    setForm(f => {
      const certs = [...f.certifications];
      certs[idx] = { ...certs[idx], [field]: value };
      return { ...f, certifications: certs };
    });
  };

  const removeCert = (idx) => {
    setForm(f => ({ ...f, certifications: f.certifications.filter((_, i) => i !== idx) }));
  };

  // Handle complete
  const handleComplete = () => {
    if (typeof onComplete === 'function') onComplete(authToken || window.AUTH_TOKEN);
  };

  // ─── Render ───

  // Loading / Error states
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#f5f7f5' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>⏳</div>
          <div style={{ color: '#666', fontSize: '16px' }}>Validating your invite...</div>
        </div>
      </div>
    );
  }

  if (inviteError) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#f5f7f5' }}>
        <div style={{ textAlign: 'center', maxWidth: '400px', padding: '40px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>😔</div>
          <h2 style={{ color: '#333', marginBottom: '8px' }}>Invite Issue</h2>
          <p style={{ color: '#666', marginBottom: '24px' }}>{inviteError}</p>
          <a href="/" style={{
            display: 'inline-block', padding: '12px 28px', background: '#1b6b5a', color: 'white',
            borderRadius: '8px', textDecoration: 'none', fontWeight: 600,
          }}>Go to InPlace</a>
        </div>
      </div>
    );
  }

  // ─── Shared styles ───
  const inputStyle = {
    width: '100%', padding: '12px 14px', borderRadius: '8px', border: '1px solid #ddd',
    fontSize: '14px', boxSizing: 'border-box',
  };
  const inputErrorStyle = { ...inputStyle, borderColor: '#e74c3c' };
  const labelStyle = { display: 'block', fontSize: '13px', fontWeight: 600, color: '#555', marginBottom: '4px' };
  const errorStyle = { color: '#e74c3c', fontSize: '12px', marginTop: '4px' };
  const fieldGroup = { marginBottom: '16px' };
  const rowStyle = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' };

  return (
    <div style={{ minHeight: '100vh', background: '#f5f7f5', padding: '20px' }}>
      <div style={{ maxWidth: '560px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '48px', height: '48px', borderRadius: '12px', background: '#1b6b5a',
            color: 'white', fontWeight: 800, fontSize: '18px', fontFamily: "'DM Sans', sans-serif",
            marginBottom: '12px',
          }}>iP</div>
          <h1 style={{ fontSize: '22px', color: '#1b6b5a', margin: '0 0 4px' }}>Join InPlace</h1>
          {inviteInfo && (
            <p style={{ color: '#888', fontSize: '14px', margin: 0 }}>
              Invited by {inviteInfo.inviterName}
            </p>
          )}
        </div>

        {/* Progress bar */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '28px' }}>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <div key={i} style={{
              flex: 1, height: '4px', borderRadius: '2px',
              background: i + 1 <= step ? '#1b6b5a' : '#ddd',
              transition: 'background 0.3s',
            }} />
          ))}
        </div>

        {/* Step labels */}
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <span style={{ fontSize: '12px', color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px' }}>
            Step {step} of {TOTAL_STEPS} —{' '}
            {step === 1 ? 'Create Account' : step === 2 ? 'Personal Info' : step === 3 ? 'Background Check Info' :
             step === 4 ? 'Certifications' : step === 5 ? 'Document Upload' : 'Review & Complete'}
          </span>
        </div>

        {/* ─── Step 1: Create Account ─── */}
        {step === 1 && (
          <div className="card" style={{ padding: '24px' }}>
            <h2 style={{ fontSize: '18px', color: '#333', marginTop: 0, marginBottom: '16px' }}>Create Your Account</h2>
            <div style={rowStyle}>
              <div style={fieldGroup}>
                <label style={labelStyle}>First Name *</label>
                <input style={errors.firstName ? inputErrorStyle : inputStyle} value={form.firstName}
                  onChange={(e) => updateForm('firstName', e.target.value)} placeholder="First name" />
                {errors.firstName && <div style={errorStyle}>{errors.firstName}</div>}
              </div>
              <div style={fieldGroup}>
                <label style={labelStyle}>Last Name *</label>
                <input style={errors.lastName ? inputErrorStyle : inputStyle} value={form.lastName}
                  onChange={(e) => updateForm('lastName', e.target.value)} placeholder="Last name" />
                {errors.lastName && <div style={errorStyle}>{errors.lastName}</div>}
              </div>
            </div>
            <div style={fieldGroup}>
              <label style={labelStyle}>Email</label>
              <input style={{ ...inputStyle, background: '#f5f5f5' }} value={form.email} disabled />
            </div>
            <div style={rowStyle}>
              <div style={fieldGroup}>
                <label style={labelStyle}>Password *</label>
                <input type="password" style={errors.password ? inputErrorStyle : inputStyle} value={form.password}
                  onChange={(e) => updateForm('password', e.target.value)} placeholder="Min 8 characters" />
                {errors.password && <div style={errorStyle}>{errors.password}</div>}
              </div>
              <div style={fieldGroup}>
                <label style={labelStyle}>Confirm Password *</label>
                <input type="password" style={errors.confirmPassword ? inputErrorStyle : inputStyle} value={form.confirmPassword}
                  onChange={(e) => updateForm('confirmPassword', e.target.value)} placeholder="Confirm" />
                {errors.confirmPassword && <div style={errorStyle}>{errors.confirmPassword}</div>}
              </div>
            </div>
            {errors.submit && <div style={{ ...errorStyle, marginBottom: '12px' }}>{errors.submit}</div>}
            <button onClick={handleCreateAccount} disabled={saving} style={{
              width: '100%', padding: '14px', background: '#1b6b5a', color: 'white', border: 'none',
              borderRadius: '8px', fontSize: '16px', fontWeight: 600, cursor: 'pointer',
              opacity: saving ? 0.6 : 1,
            }}>{saving ? 'Creating Account...' : 'Create Account & Continue'}</button>
          </div>
        )}

        {/* ─── Step 2: Personal Info ─── */}
        {step === 2 && (
          <div className="card" style={{ padding: '24px' }}>
            <h2 style={{ fontSize: '18px', color: '#333', marginTop: 0, marginBottom: '16px' }}>Personal Information</h2>
            <div style={fieldGroup}>
              <label style={labelStyle}>Phone *</label>
              <input style={errors.phone ? inputErrorStyle : inputStyle} value={form.phone}
                onChange={(e) => updateForm('phone', e.target.value)} placeholder="(540) 555-1234" />
              {errors.phone && <div style={errorStyle}>{errors.phone}</div>}
            </div>
            <div style={fieldGroup}>
              <label style={labelStyle}>Street Address *</label>
              <input style={errors.addressLine1 ? inputErrorStyle : inputStyle} value={form.addressLine1}
                onChange={(e) => updateForm('addressLine1', e.target.value)} placeholder="123 Main Street" />
              {errors.addressLine1 && <div style={errorStyle}>{errors.addressLine1}</div>}
            </div>
            <div style={fieldGroup}>
              <label style={labelStyle}>Address Line 2</label>
              <input style={inputStyle} value={form.addressLine2}
                onChange={(e) => updateForm('addressLine2', e.target.value)} placeholder="Apt, suite, etc." />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px' }}>
              <div style={fieldGroup}>
                <label style={labelStyle}>City *</label>
                <input style={errors.city ? inputErrorStyle : inputStyle} value={form.city}
                  onChange={(e) => updateForm('city', e.target.value)} placeholder="Blacksburg" />
                {errors.city && <div style={errorStyle}>{errors.city}</div>}
              </div>
              <div style={fieldGroup}>
                <label style={labelStyle}>State *</label>
                <select style={errors.state ? inputErrorStyle : inputStyle} value={form.state}
                  onChange={(e) => updateForm('state', e.target.value)}>
                  <option value="">—</option>
                  {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                {errors.state && <div style={errorStyle}>{errors.state}</div>}
              </div>
              <div style={fieldGroup}>
                <label style={labelStyle}>ZIP *</label>
                <input style={errors.zip ? inputErrorStyle : inputStyle} value={form.zip}
                  onChange={(e) => updateForm('zip', e.target.value)} placeholder="24060" maxLength={10} />
                {errors.zip && <div style={errorStyle}>{errors.zip}</div>}
              </div>
            </div>
            <div style={rowStyle}>
              <div style={fieldGroup}>
                <label style={labelStyle}>Years of Experience</label>
                <input type="number" min="0" style={inputStyle} value={form.yearsExperience}
                  onChange={(e) => updateForm('yearsExperience', e.target.value)} placeholder="0" />
              </div>
              <div style={fieldGroup}>
                <label style={labelStyle}>Hourly Rate ($) *</label>
                <input type="number" min="10" style={errors.hourlyRate ? inputErrorStyle : inputStyle} value={form.hourlyRate}
                  onChange={(e) => updateForm('hourlyRate', e.target.value)} placeholder="25" />
                {errors.hourlyRate && <div style={errorStyle}>{errors.hourlyRate}</div>}
              </div>
            </div>
            <div style={fieldGroup}>
              <label style={labelStyle}>Bio</label>
              <textarea style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }} value={form.bio}
                onChange={(e) => updateForm('bio', e.target.value)}
                placeholder="Tell families about your experience and approach to care..." />
            </div>
            {errors.submit && <div style={{ ...errorStyle, marginBottom: '12px' }}>{errors.submit}</div>}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setStep(1)} style={{
                padding: '14px 24px', background: '#f0f0f0', color: '#555', border: 'none',
                borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
              }}>Back</button>
              <button onClick={handleSavePersonalInfo} disabled={saving} style={{
                flex: 1, padding: '14px', background: '#1b6b5a', color: 'white', border: 'none',
                borderRadius: '8px', fontSize: '16px', fontWeight: 600, cursor: 'pointer',
                opacity: saving ? 0.6 : 1,
              }}>{saving ? 'Saving...' : 'Continue'}</button>
            </div>
          </div>
        )}

        {/* ─── Step 3: Legal / Checkr ─── */}
        {step === 3 && (
          <div className="card" style={{ padding: '24px' }}>
            <h2 style={{ fontSize: '18px', color: '#333', marginTop: 0, marginBottom: '4px' }}>Background Check Information</h2>
            <p style={{ color: '#888', fontSize: '13px', marginTop: 0, marginBottom: '20px' }}>
              This information is required for your background check and will be kept secure.
            </p>
            <div style={rowStyle}>
              <div style={fieldGroup}>
                <label style={labelStyle}>Legal First Name *</label>
                <input style={errors.legalFirstName ? inputErrorStyle : inputStyle} value={form.legalFirstName}
                  onChange={(e) => updateForm('legalFirstName', e.target.value)} placeholder="As on ID" />
                {errors.legalFirstName && <div style={errorStyle}>{errors.legalFirstName}</div>}
              </div>
              <div style={fieldGroup}>
                <label style={labelStyle}>Legal Last Name *</label>
                <input style={errors.legalLastName ? inputErrorStyle : inputStyle} value={form.legalLastName}
                  onChange={(e) => updateForm('legalLastName', e.target.value)} placeholder="As on ID" />
                {errors.legalLastName && <div style={errorStyle}>{errors.legalLastName}</div>}
              </div>
            </div>
            <div style={rowStyle}>
              <div style={fieldGroup}>
                <label style={labelStyle}>Date of Birth *</label>
                <input type="date" style={errors.dateOfBirth ? inputErrorStyle : inputStyle} value={form.dateOfBirth}
                  onChange={(e) => updateForm('dateOfBirth', e.target.value)} />
                {errors.dateOfBirth && <div style={errorStyle}>{errors.dateOfBirth}</div>}
              </div>
              <div style={fieldGroup}>
                <label style={labelStyle}>SSN (Last 4 Digits) *</label>
                <input type="password" maxLength={4} style={errors.ssnLast4 ? inputErrorStyle : inputStyle} value={form.ssnLast4}
                  onChange={(e) => updateForm('ssnLast4', e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="••••" />
                {errors.ssnLast4 && <div style={errorStyle}>{errors.ssnLast4}</div>}
              </div>
            </div>
            <div style={rowStyle}>
              <div style={fieldGroup}>
                <label style={labelStyle}>Driver's License # *</label>
                <input style={errors.dlNumber ? inputErrorStyle : inputStyle} value={form.dlNumber}
                  onChange={(e) => updateForm('dlNumber', e.target.value)} placeholder="License number" />
                {errors.dlNumber && <div style={errorStyle}>{errors.dlNumber}</div>}
              </div>
              <div style={fieldGroup}>
                <label style={labelStyle}>Issuing State *</label>
                <select style={errors.dlState ? inputErrorStyle : inputStyle} value={form.dlState}
                  onChange={(e) => updateForm('dlState', e.target.value)}>
                  <option value="">Select state</option>
                  {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                {errors.dlState && <div style={errorStyle}>{errors.dlState}</div>}
              </div>
            </div>
            <div style={{ padding: '16px', background: '#f8f9fa', borderRadius: '8px', marginBottom: '16px' }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.backgroundCheckConsent}
                  onChange={(e) => updateForm('backgroundCheckConsent', e.target.checked)}
                  style={{ marginTop: '3px', width: '18px', height: '18px' }} />
                <span style={{ fontSize: '13px', color: '#444', lineHeight: '1.5' }}>
                  I authorize InPlace to conduct a background check, including criminal history, driving record,
                  and identity verification through a third-party service (Checkr). I understand this is required
                  to provide care through the InPlace platform.
                </span>
              </label>
              {errors.backgroundCheckConsent && <div style={errorStyle}>{errors.backgroundCheckConsent}</div>}
            </div>
            {errors.submit && <div style={{ ...errorStyle, marginBottom: '12px' }}>{errors.submit}</div>}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setStep(2)} style={{
                padding: '14px 24px', background: '#f0f0f0', color: '#555', border: 'none',
                borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
              }}>Back</button>
              <button onClick={handleSaveLegalInfo} disabled={saving} style={{
                flex: 1, padding: '14px', background: '#1b6b5a', color: 'white', border: 'none',
                borderRadius: '8px', fontSize: '16px', fontWeight: 600, cursor: 'pointer',
                opacity: saving ? 0.6 : 1,
              }}>{saving ? 'Saving...' : 'Continue'}</button>
            </div>
          </div>
        )}

        {/* ─── Step 4: Certifications ─── */}
        {step === 4 && (
          <div className="card" style={{ padding: '24px' }}>
            <h2 style={{ fontSize: '18px', color: '#333', marginTop: 0, marginBottom: '4px' }}>Certifications</h2>
            <p style={{ color: '#888', fontSize: '13px', marginTop: 0, marginBottom: '20px' }}>
              Add any professional certifications you hold. You can skip this if you don't have any yet.
            </p>
            {form.certifications.map((cert, idx) => (
              <div key={idx} style={{
                padding: '14px', background: '#f8f9fa', borderRadius: '8px', marginBottom: '12px',
                position: 'relative',
              }}>
                {form.certifications.length > 1 && (
                  <button onClick={() => removeCert(idx)} style={{
                    position: 'absolute', top: '8px', right: '8px', background: 'none', border: 'none',
                    color: '#c00', cursor: 'pointer', fontSize: '16px', padding: '4px',
                  }}>×</button>
                )}
                <div style={rowStyle}>
                  <div style={fieldGroup}>
                    <label style={labelStyle}>Type</label>
                    <select style={inputStyle} value={cert.certType} onChange={(e) => updateCert(idx, 'certType', e.target.value)}>
                      <option value="">Select type</option>
                      {CERT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div style={fieldGroup}>
                    <label style={labelStyle}>Certificate Number</label>
                    <input style={inputStyle} value={cert.certNumber}
                      onChange={(e) => updateCert(idx, 'certNumber', e.target.value)} placeholder="Optional" />
                  </div>
                </div>
                <div style={rowStyle}>
                  <div style={fieldGroup}>
                    <label style={labelStyle}>Issuer</label>
                    <input style={inputStyle} value={cert.issuer}
                      onChange={(e) => updateCert(idx, 'issuer', e.target.value)} placeholder="e.g. Virginia Board of Health" />
                  </div>
                  <div style={fieldGroup}>
                    <label style={labelStyle}>Expiry Date</label>
                    <input type="date" style={inputStyle} value={cert.expiryDate}
                      onChange={(e) => updateCert(idx, 'expiryDate', e.target.value)} />
                  </div>
                </div>
              </div>
            ))}
            <button onClick={addCertification} style={{
              padding: '10px 16px', background: 'white', border: '2px dashed #ccc',
              borderRadius: '8px', fontSize: '13px', fontWeight: 600, color: '#1b6b5a',
              cursor: 'pointer', width: '100%', marginBottom: '16px',
            }}>+ Add Certification</button>
            {errors.submit && <div style={{ ...errorStyle, marginBottom: '12px' }}>{errors.submit}</div>}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setStep(3)} style={{
                padding: '14px 24px', background: '#f0f0f0', color: '#555', border: 'none',
                borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
              }}>Back</button>
              <button onClick={handleSaveCertifications} disabled={saving} style={{
                flex: 1, padding: '14px', background: '#1b6b5a', color: 'white', border: 'none',
                borderRadius: '8px', fontSize: '16px', fontWeight: 600, cursor: 'pointer',
                opacity: saving ? 0.6 : 1,
              }}>{saving ? 'Saving...' : 'Continue'}</button>
            </div>
          </div>
        )}

        {/* ─── Step 5: Document Upload ─── */}
        {step === 5 && (
          <div className="card" style={{ padding: '24px' }}>
            <h2 style={{ fontSize: '18px', color: '#333', marginTop: 0, marginBottom: '4px' }}>Upload Documents</h2>
            <p style={{ color: '#888', fontSize: '13px', marginTop: 0, marginBottom: '20px' }}>
              Upload photos of your driver's license (front and back). You can also upload certification documents.
            </p>

            {/* DL Front */}
            <div style={fieldGroup}>
              <label style={labelStyle}>Driver's License — Front *</label>
              {form.documents.find(d => d.type === 'dl_front') ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px', background: '#f8f9fa', borderRadius: '8px' }}>
                  <img src={form.documents.find(d => d.type === 'dl_front').preview}
                    style={{ width: '80px', height: '50px', objectFit: 'cover', borderRadius: '6px' }} />
                  <span style={{ fontSize: '13px', color: '#555', flex: 1 }}>{form.documents.find(d => d.type === 'dl_front').fileName}</span>
                  <button onClick={() => removeDocument('dl_front')} style={{
                    background: '#fff0f0', border: '1px solid #fdd', borderRadius: '6px',
                    padding: '4px 10px', fontSize: '12px', cursor: 'pointer', color: '#c00',
                  }}>Remove</button>
                </div>
              ) : (
                <div>
                  <input type="file" accept="image/*" capture="environment" onChange={(e) => handleFileSelect('dl_front', e)}
                    style={{ fontSize: '14px' }} />
                  {errors.dl_front && <div style={errorStyle}>{errors.dl_front}</div>}
                </div>
              )}
            </div>

            {/* DL Back */}
            <div style={fieldGroup}>
              <label style={labelStyle}>Driver's License — Back *</label>
              {form.documents.find(d => d.type === 'dl_back') ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px', background: '#f8f9fa', borderRadius: '8px' }}>
                  <img src={form.documents.find(d => d.type === 'dl_back').preview}
                    style={{ width: '80px', height: '50px', objectFit: 'cover', borderRadius: '6px' }} />
                  <span style={{ fontSize: '13px', color: '#555', flex: 1 }}>{form.documents.find(d => d.type === 'dl_back').fileName}</span>
                  <button onClick={() => removeDocument('dl_back')} style={{
                    background: '#fff0f0', border: '1px solid #fdd', borderRadius: '6px',
                    padding: '4px 10px', fontSize: '12px', cursor: 'pointer', color: '#c00',
                  }}>Remove</button>
                </div>
              ) : (
                <div>
                  <input type="file" accept="image/*" capture="environment" onChange={(e) => handleFileSelect('dl_back', e)}
                    style={{ fontSize: '14px' }} />
                  {errors.dl_back && <div style={errorStyle}>{errors.dl_back}</div>}
                </div>
              )}
            </div>

            {/* Certification Documents */}
            <div style={fieldGroup}>
              <label style={labelStyle}>Certification Documents (Optional)</label>
              <p style={{ fontSize: '12px', color: '#999', margin: '0 0 8px' }}>
                Upload images of your certificates (CNA, CPR, etc.)
              </p>
              {form.documents.filter(d => d.type === 'certification').map((doc, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '12px', padding: '10px',
                  background: '#f8f9fa', borderRadius: '8px', marginBottom: '8px',
                }}>
                  <img src={doc.preview} style={{ width: '60px', height: '40px', objectFit: 'cover', borderRadius: '4px' }} />
                  <span style={{ fontSize: '13px', color: '#555', flex: 1 }}>{doc.fileName}</span>
                  <button onClick={() => removeDocument('certification')} style={{
                    background: '#fff0f0', border: '1px solid #fdd', borderRadius: '6px',
                    padding: '4px 10px', fontSize: '12px', cursor: 'pointer', color: '#c00',
                  }}>Remove</button>
                </div>
              ))}
              <input type="file" accept="image/*" onChange={(e) => {
                const file = e.target.files[0];
                if (!file) return;
                if (file.size > 5 * 1024 * 1024) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                  setForm(f => ({
                    ...f,
                    documents: [...f.documents, { type: 'certification', file, preview: ev.target.result, fileName: file.name }],
                  }));
                };
                reader.readAsDataURL(file);
                e.target.value = '';
              }} style={{ fontSize: '14px' }} />
            </div>

            {errors.submit && <div style={{ ...errorStyle, marginBottom: '12px' }}>{errors.submit}</div>}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setStep(4)} style={{
                padding: '14px 24px', background: '#f0f0f0', color: '#555', border: 'none',
                borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
              }}>Back</button>
              <button onClick={handleUploadDocuments} disabled={saving} style={{
                flex: 1, padding: '14px', background: '#1b6b5a', color: 'white', border: 'none',
                borderRadius: '8px', fontSize: '16px', fontWeight: 600, cursor: 'pointer',
                opacity: saving ? 0.6 : 1,
              }}>{saving ? 'Uploading...' : 'Upload & Continue'}</button>
            </div>
          </div>
        )}

        {/* ─── Step 6: Review & Complete ─── */}
        {step === 6 && (
          <div className="card" style={{ padding: '24px' }}>
            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>🎉</div>
              <h2 style={{ fontSize: '22px', color: '#1b6b5a', margin: '0 0 8px' }}>Welcome to InPlace!</h2>
              <p style={{ color: '#666', fontSize: '15px', margin: 0 }}>
                Your profile has been created and your documents are uploaded.
              </p>
            </div>

            {/* Summary */}
            <div style={{ background: '#f8f9fa', borderRadius: '8px', padding: '16px', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '14px', color: '#1b6b5a', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Profile Summary</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '13px' }}>
                <div><span style={{ color: '#888' }}>Name:</span> {form.firstName} {form.lastName}</div>
                <div><span style={{ color: '#888' }}>Phone:</span> {form.phone}</div>
                <div><span style={{ color: '#888' }}>Location:</span> {form.city}, {form.state} {form.zip}</div>
                <div><span style={{ color: '#888' }}>Rate:</span> ${form.hourlyRate}/hr</div>
                <div><span style={{ color: '#888' }}>Experience:</span> {form.yearsExperience || 0} years</div>
                <div><span style={{ color: '#888' }}>Certifications:</span> {form.certifications.filter(c => c.certType).map(c => c.certType).join(', ') || 'None'}</div>
                <div><span style={{ color: '#888' }}>Documents:</span> {form.documents.length} uploaded</div>
                <div><span style={{ color: '#888' }}>Background Check:</span> {form.backgroundCheckConsent ? 'Authorized' : 'Pending'}</div>
              </div>
            </div>

            <div style={{ padding: '14px', background: '#fff8f0', borderRadius: '8px', marginBottom: '20px', border: '1px solid #ffe0c0' }}>
              <p style={{ fontSize: '13px', color: '#b45309', margin: 0, lineHeight: '1.5' }}>
                <strong>Next steps:</strong> Your background check is pending review. Once verified, you'll be able
                to accept care requests from families in your area. You'll receive an email when your account is fully activated.
              </p>
            </div>

            <button onClick={handleComplete} style={{
              width: '100%', padding: '14px', background: '#1b6b5a', color: 'white', border: 'none',
              borderRadius: '8px', fontSize: '16px', fontWeight: 600, cursor: 'pointer',
            }}>Go to My Dashboard</button>
          </div>
        )}
      </div>
    </div>
  );
};
