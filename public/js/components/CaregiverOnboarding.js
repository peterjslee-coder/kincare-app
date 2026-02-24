// ─── Caregiver Onboarding Flow ───
// Multi-step wizard shown when a user visits ?invite=TOKEN
// Creates user account + caregiver profile + uploads documents in one flow.
const CaregiverOnboarding = window.CaregiverOnboarding = ({ inviteToken, signupToken, signupEmail, resumeMode, resumeUser, onComplete }) => {
  // resumeMode: true when user already has account but no caregiver profile
  // resumeUser: { firstName, lastName, email } from existing account
  const [step, setStep] = useState(resumeMode ? 2 : 1);
  const [inviteInfo, setInviteInfo] = useState(resumeMode ? { email: resumeUser?.email, role: 'caregiver', viaResume: true } : null);
  const [inviteError, setInviteError] = useState(null);
  const [loading, setLoading] = useState(resumeMode ? false : true);
  const [saving, setSaving] = useState(false);
  const [authToken, setAuthTokenState] = useState(resumeMode ? (window.AUTH_TOKEN || localStorage.getItem('auth_token')) : null);
  const [profileId, setProfileId] = useState(null);
  const [errors, setErrors] = useState({});
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  // ─── Online/offline detection ───
  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  // ─── Resilient fetch: auto-retry on transient network failures ───
  const resilientFetch = async (url, options, retries = 2) => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (!navigator.onLine) {
          throw new Error('OFFLINE');
        }
        const res = await fetch(url, options);
        return res;
      } catch (err) {
        if (err.message === 'OFFLINE') throw err;
        if (attempt < retries) {
          // Wait briefly before retry (500ms, then 1500ms)
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
  };

  // Network error message helper
  const networkErrorMsg = (err) => {
    if (!navigator.onLine || (err && err.message === 'OFFLINE')) {
      return 'You appear to be offline. Please check your internet connection and try again.';
    }
    return 'Network error — please check your connection and try again.';
  };

  // ─── Onboarding event tracking ───
  // Sends events to server for admin visibility (fire-and-forget, never blocks UI)
  const stepNames = {
    1: 'Create Account', 2: 'Disclosures & Terms', 3: 'Personal Info',
    4: 'Background Check Info', 5: 'Certifications', 6: 'Academic Program',
    7: 'Background Check Payment', 8: 'Document Upload', 9: 'Review & Complete',
  };
  const trackEvent = (eventType, stepNum, extra = {}) => {
    try {
      const token = authToken || window.AUTH_TOKEN;
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      fetch('/api/onboarding-events', {
        method: 'POST', headers,
        body: JSON.stringify({
          flow: 'onboarding',
          eventType,
          step: stepNum,
          stepName: stepNames[stepNum] || null,
          email: form.email || null,
          errorMessage: extra.error || null,
          errorSource: extra.source || null,
          metadata: {
            ...extra,
            online: navigator.onLine,
            userAgent: navigator.userAgent,
            screenWidth: window.innerWidth,
            timestamp: new Date().toISOString(),
          },
        }),
      }).catch(() => {}); // never block or error
    } catch (e) { /* ignore */ }
  };

  // Form data across all steps
  const [form, setForm] = useState({
    // Step 1 — Account
    firstName: resumeUser?.firstName || '', lastName: resumeUser?.lastName || '',
    email: resumeUser?.email || '', password: '', confirmPassword: '',
    // Step 2 — Disclosures & Terms
    acceptBackgroundCheck: false,
    acceptStripePayments: false,
    accept1099: false,
    acceptIndependentContractor: false,
    acceptRefundPolicy: false,
    // Step 3 — Personal Info + Work Location
    phone: '', addressLine1: '', addressLine2: '', city: '', state: '', zip: '',
    yearsExperience: '', hourlyRate: '', bio: '',
    workLocationAddress: '', workCity: '', workState: '', workZip: '',
    travelRadius: '15',
    // Step 4 — Legal / Checkr
    legalFirstName: '', legalLastName: '', dateOfBirth: '', ssnLast4: '',
    dlNumber: '', dlState: '', backgroundCheckConsent: false,
    // Step 5 — Certifications
    certifications: [{ certType: '', certNumber: '', issuer: '', expiryDate: '' }],
    // Step 6 — Academic Program
    needsProgramReports: null, // null=unanswered, true/false
    programYear: '',
    programName: '',
    programNameOther: '',
    acknowledgeNoMedicalCare: false,
    // Step 7 — Documents
    documents: [], // { type, file, preview, fileName }
  });

  const [bgCheckPaid, setBgCheckPaid] = useState(false);

  // ─── Persist form progress to localStorage ───
  const STORAGE_KEY = 'inplace_onboarding_progress';
  // Restore saved progress on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Restore form fields (except password and documents which can't be serialized)
        if (parsed.form) {
          setForm(f => ({
            ...f,
            ...parsed.form,
            password: '', confirmPassword: '',
            documents: [], // can't persist File objects
          }));
        }
        // Restore step if past account creation (don't go back to step 1 if account exists)
        if (parsed.step && parsed.step > 1 && parsed.authToken) {
          setStep(parsed.step);
          setAuthTokenState(parsed.authToken);
          if (typeof setAuthToken === 'function') setAuthToken(parsed.authToken);
          window.AUTH_TOKEN = parsed.authToken;
          // Mark invite as resolved so we skip the validation
          if (!inviteInfo && parsed.inviteInfo) setInviteInfo(parsed.inviteInfo);
          setLoading(false);
        }
        if (parsed.profileId) setProfileId(parsed.profileId);
        if (parsed.bgCheckPaid) setBgCheckPaid(true);
      }
    } catch (e) { /* ignore corrupt storage */ }
  }, []);
  // Save progress whenever form or step changes
  useEffect(() => {
    try {
      const token = authToken || window.AUTH_TOKEN;
      if (step > 1 && token) {
        // Only save serializable form data (strip documents/files)
        const saveable = { ...form, documents: [], password: '', confirmPassword: '', ssnLast4: '' };
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          form: saveable, step, authToken: token, inviteInfo, profileId, bgCheckPaid,
        }));
      }
    } catch (e) { /* ignore */ }
  }, [form, step, authToken, profileId, bgCheckPaid]);
  // Clear saved progress when onboarding completes
  const clearSavedProgress = () => {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  };

  const TOTAL_STEPS = 9;
  const US_STATES = [
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS',
    'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
    'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
  ];
  const CERT_TYPES = ['CNA', 'HHA', 'LPN', 'RN', 'CPR/First Aid', 'BLS', 'ACLS', 'Other'];
  const RADIUS_OPTIONS = ['5', '10', '15', '25', '50'];

  // Track page load / resume
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    trackEvent(saved ? 'session_resumed' : 'session_started', step, { resumeMode: !!resumeMode });
  }, []);

  // Validate invite or signup token on mount
  useEffect(() => { validateInvite(); }, []);

  const validateInvite = async () => {
    // Resume mode — already validated, skip token checks
    if (resumeMode) { setLoading(false); return; }
    // Signup token flow (email-first signup from splash page)
    if (signupToken && signupEmail) {
      setInviteInfo({ email: signupEmail, role: 'caregiver', viaSignup: true });
      setForm(f => ({ ...f, email: signupEmail }));
      setLoading(false);
      return;
    }
    // If we restored from localStorage and already have invite info, skip
    if (inviteInfo && !inviteToken) { setLoading(false); return; }
    // Platform invite flow (admin-sent invite link)
    try {
      const res = await resilientFetch(`/api/platform-invites/info?token=${inviteToken}`);
      if (res.ok) {
        const data = await res.json();
        setInviteInfo(data.invite);
        setForm(f => ({ ...f, email: data.invite.email }));
      } else {
        const data = await res.json();
        setInviteError(data.error || 'Invalid invite');
      }
    } catch (err) {
      trackEvent('error', 0, { error: networkErrorMsg(err), source: 'invite_validate' });
      setInviteError(networkErrorMsg(err));
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
      if (!form.acceptBackgroundCheck) errs.acceptBackgroundCheck = 'You must acknowledge this to proceed';
      if (!form.acceptStripePayments) errs.acceptStripePayments = 'You must acknowledge this to proceed';
      if (!form.accept1099) errs.accept1099 = 'You must acknowledge this to proceed';
      if (!form.acceptIndependentContractor) errs.acceptIndependentContractor = 'You must acknowledge this to proceed';
      if (!form.acceptRefundPolicy) errs.acceptRefundPolicy = 'You must acknowledge this to proceed';
    }
    if (stepNum === 3) {
      if (!form.phone.trim()) errs.phone = 'Required';
      if (!form.addressLine1.trim()) errs.addressLine1 = 'Required';
      if (!form.city.trim()) errs.city = 'Required';
      if (!form.state) errs.state = 'Required';
      if (!form.zip.trim()) errs.zip = 'Required';
      if (!form.hourlyRate) errs.hourlyRate = 'Required';
    }
    if (stepNum === 4) {
      if (!form.legalFirstName.trim()) errs.legalFirstName = 'Required';
      if (!form.legalLastName.trim()) errs.legalLastName = 'Required';
      if (!form.dateOfBirth) errs.dateOfBirth = 'Required';
      if (!form.ssnLast4 || form.ssnLast4.length !== 4) errs.ssnLast4 = 'Enter last 4 digits';
      if (!form.dlNumber.trim()) errs.dlNumber = 'Required';
      if (!form.dlState) errs.dlState = 'Required';
      if (!form.backgroundCheckConsent) errs.backgroundCheckConsent = 'You must consent to proceed';
    }
    if (stepNum === 6) {
      if (form.needsProgramReports === true) {
        if (!form.programName) errs.programName = 'Please select your program';
        if (form.programName === 'other' && !form.programNameOther.trim()) errs.programNameOther = 'Please enter your program name';
        if (!form.programYear) errs.programYear = 'Please select your year';
        const isNursing = ['radford_nursing', 'nrcc_nurse_aide'].includes(form.programName) || (form.programName === 'other' && /nurs/i.test(form.programNameOther));
        if (isNursing && !form.acknowledgeNoMedicalCare) errs.acknowledgeNoMedicalCare = 'You must acknowledge this to continue';
      }
    }
    if (stepNum === 8) {
      const hasDLFront = form.documents.some(d => d.type === 'dl_front');
      const hasDLBack = form.documents.some(d => d.type === 'dl_back');
      if (!hasDLFront) errs.dl_front = "Driver's license front is required";
      if (!hasDLBack) errs.dl_back = "Driver's license back is required";
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      // Scroll to top of card so user sees the error summary
      setTimeout(() => {
        const card = document.querySelector('.card');
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    }
    return Object.keys(errs).length === 0;
  };

  // Step 1: Create account
  const handleCreateAccount = async () => {
    if (!validateStep(1)) return;
    setSaving(true);
    try {
      const regBody = {
        email: form.email, password: form.password,
        firstName: form.firstName, lastName: form.lastName,
        role: inviteInfo.role || 'caregiver',
      };
      if (signupToken) regBody.signupToken = signupToken;

      const res = await resilientFetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(regBody),
      });
      const data = await res.json();
      if (!res.ok) {
        trackEvent('error', 1, { error: data.error || 'Registration failed', source: 'api', status: res.status });
        setErrors({ submit: data.error || 'Registration failed' }); setSaving(false); return;
      }

      const token = data.token;
      setAuthTokenState(token);
      if (typeof setAuthToken === 'function') setAuthToken(token);
      localStorage.setItem('auth_token', token);
      window.AUTH_TOKEN = token;

      // Accept platform invite (skip for email-first signup flow)
      if (inviteToken && !signupToken) {
        await resilientFetch('/api/platform-invites/accept-invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ token: inviteToken }),
        });
      }

      trackEvent('step_complete', 1);
      setStep(2);
    } catch (err) {
      trackEvent('error', 1, { error: networkErrorMsg(err), source: 'network' });
      setErrors({ submit: networkErrorMsg(err) });
    }
    setSaving(false);
  };

  // Step 2: Disclosures & Terms (just validation, no API call)
  const handleAcceptTerms = () => {
    if (!validateStep(2)) return;
    trackEvent('step_complete', 2);
    setStep(3);
  };

  // Step 3: Save personal info + create caregiver profile
  const handleSavePersonalInfo = async () => {
    if (!validateStep(3)) return;
    setSaving(true);
    try {
      const token = authToken || window.AUTH_TOKEN;
      const res = await resilientFetch('/api/caregivers/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          bio: form.bio, yearsExperience: parseInt(form.yearsExperience) || 0,
          hourlyRate: parseFloat(form.hourlyRate),
          specialties: [], certifications: [],
          city: form.city, state: form.state,
          address: form.addressLine1,
          addressLine1: form.addressLine1, addressLine2: form.addressLine2, zip: form.zip,
          workLocationAddress: form.workLocationAddress || `${form.addressLine1}, ${form.city}, ${form.state} ${form.zip}`,
          travelRadius: parseInt(form.travelRadius) || 15,
          termsAcceptedAt: new Date().toISOString(),
          termsVersion: '1.0',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        trackEvent('error', 3, { error: data.error || 'Failed to save profile', source: 'api', status: res.status });
        setErrors({ submit: data.error || 'Failed to save profile' }); setSaving(false); return;
      }
      setProfileId(data.profile?.id);

      // Also update user phone (non-blocking — don't fail the step if this errors)
      // Normalize phone: strip formatting chars before saving
      const normalizedPhone = form.phone ? form.phone.replace(/\D/g, '') : null;
      resilientFetch('/api/auth/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ phone: normalizedPhone }),
      }).catch(() => {});

      trackEvent('step_complete', 3);
      setStep(4);
    } catch (err) {
      trackEvent('error', 3, { error: networkErrorMsg(err), source: 'network' });
      setErrors({ submit: networkErrorMsg(err) });
    }
    setSaving(false);
  };

  // Step 4: Save legal/Checkr info
  const handleSaveLegalInfo = async () => {
    if (!validateStep(4)) return;
    setSaving(true);
    try {
      const token = authToken || window.AUTH_TOKEN;
      const res = await resilientFetch('/api/caregivers/profile', {
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
      if (!res.ok) {
        const data = await res.json();
        trackEvent('error', 4, { error: data.error, source: 'api', status: res.status });
        setErrors({ submit: data.error }); setSaving(false); return;
      }
      trackEvent('step_complete', 4);
      setStep(5);
    } catch (err) {
      trackEvent('error', 4, { error: networkErrorMsg(err), source: 'network' });
      setErrors({ submit: networkErrorMsg(err) });
    }
    setSaving(false);
  };

  // Step 5: Save certifications
  const handleSaveCertifications = async () => {
    setSaving(true);
    try {
      const token = authToken || window.AUTH_TOKEN;
      const validCerts = form.certifications.filter(c => c.certType);
      await resilientFetch('/api/caregivers/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          hourlyRate: parseFloat(form.hourlyRate) || 25,
          certifications: validCerts.map(c => `${c.certType}${c.certNumber ? ' #' + c.certNumber : ''}`),
        }),
      });
      trackEvent('step_complete', 5);
      setStep(6); // → Academic Program
    } catch (err) {
      trackEvent('error', 5, { error: networkErrorMsg(err), source: 'network' });
      setErrors({ submit: networkErrorMsg(err) });
    }
    setSaving(false);
  };

  // Step 8: Upload documents
  const handleUploadDocuments = async () => {
    if (!validateStep(8)) return;
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

      const res = await resilientFetch('/api/caregiver-onboarding/documents', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      }, 1); // only 1 retry for uploads (they're larger)
      if (!res.ok) {
        const data = await res.json();
        trackEvent('error', 8, { error: data.error, source: 'api', status: res.status });
        setErrors({ submit: data.error }); setSaving(false); return;
      }
      trackEvent('step_complete', 8);
      setStep(9);
    } catch (err) {
      const msg = !navigator.onLine ? 'You appear to be offline. Please check your connection and try again.' : 'Upload failed — please check your connection and try again.';
      trackEvent('error', 8, { error: msg, source: 'network' });
      setErrors({ submit: msg });
    }
    setSaving(false);
  };

  // Document handling — resize large images client-side before storing
  const resizeImage = (file, maxDimension = 1600) => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Image processing timed out')), 15000);
      const done = (result) => { clearTimeout(timeout); resolve(result); };
      const fail = (err) => { clearTimeout(timeout); reject(err); };

      // If file is already small enough, skip resize
      if (file.size <= 2 * 1024 * 1024) {
        const reader = new FileReader();
        reader.onload = (ev) => done({ dataUrl: ev.target.result, blob: file });
        reader.onerror = () => fail(new Error('Failed to read file'));
        reader.readAsDataURL(file);
        return;
      }
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        try {
          let { width, height } = img;
          if (width > maxDimension || height > maxDimension) {
            const ratio = Math.min(maxDimension / width, maxDimension / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          canvas.toBlob((blob) => {
            done({ dataUrl, blob: blob || file });
          }, 'image/jpeg', 0.85);
        } catch (err) {
          fail(err);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        // Fallback: try FileReader directly
        const reader = new FileReader();
        reader.onload = (ev) => done({ dataUrl: ev.target.result, blob: file });
        reader.onerror = () => fail(new Error('Failed to read image'));
        reader.readAsDataURL(file);
      };
      img.src = url;
    });
  };

  const handleFileSelect = async (docType, e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setErrors(er => ({ ...er, [docType]: 'File must be under 10MB' })); return; }
    // Accept any file from image/* inputs — some mobile browsers return empty MIME type for camera photos
    const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i.test(file.name) || file.type === '';
    if (!isImage) { setErrors(er => ({ ...er, [docType]: 'Must be an image file' })); return; }

    try {
      const { dataUrl, blob } = await resizeImage(file);
      // Create a new File object from the resized blob for upload
      const resizedFile = new File([blob], file.name, { type: blob.type || file.type || 'image/jpeg' });
      setForm(f => {
        const docs = f.documents.filter(d => d.type !== docType);
        docs.push({ type: docType, file: resizedFile, preview: dataUrl, fileName: file.name });
        return { ...f, documents: docs };
      });
      setErrors(er => ({ ...er, [docType]: null }));
    } catch (err) {
      console.error('Image processing error:', err);
      // Fallback: use original file with object URL for preview
      const preview = URL.createObjectURL(file);
      setForm(f => {
        const docs = f.documents.filter(d => d.type !== docType);
        docs.push({ type: docType, file, preview, fileName: file.name });
        return { ...f, documents: docs };
      });
      setErrors(er => ({ ...er, [docType]: null }));
    }
    // Reset the input so re-selecting the same file triggers onChange
    e.target.value = '';
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
    trackEvent('onboarding_complete', 9);
    clearSavedProgress();
    if (typeof onComplete === 'function') onComplete(authToken || window.AUTH_TOKEN);
  };

  // ─── Render ───

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#f5f7f5' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>&#9203;</div>
          <div style={{ color: '#666', fontSize: '16px' }}>Validating your invite...</div>
        </div>
      </div>
    );
  }

  if (inviteError) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#f5f7f5' }}>
        <div style={{ textAlign: 'center', maxWidth: '400px', padding: '40px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>&#128532;</div>
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

  const stepLabels = {
    1: 'Create Account',
    2: 'Disclosures & Terms',
    3: 'Personal Info',
    4: 'Background Check Info',
    5: 'Certifications',
    6: 'Academic Program',
    7: 'Background Check Payment',
    8: 'Document Upload',
    9: 'Review & Complete',
  };

  // Error summary banner — shows at top of step when validation fails
  const errorSummary = () => {
    const errorKeys = Object.keys(errors).filter(k => k !== 'submit' && errors[k]);
    if (errorKeys.length === 0) return null;
    return (
      <div style={{
        padding: '12px 16px', background: '#fef2f2', border: '1px solid #fecaca',
        borderRadius: '8px', marginBottom: '16px',
      }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: '#dc2626', marginBottom: '4px' }}>
          Please fix {errorKeys.length} {errorKeys.length === 1 ? 'issue' : 'issues'} below
        </div>
        <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', color: '#b91c1c', lineHeight: '1.6' }}>
          {errorKeys.map(k => <li key={k}>{errors[k]}</li>)}
        </ul>
      </div>
    );
  };

  const backBtn = (targetStep) => (
    <button onClick={() => setStep(targetStep)} style={{
      padding: '14px 24px', background: '#f0f0f0', color: '#555', border: 'none',
      borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
    }}>Back</button>
  );

  const nextBtn = (handler, label, disabledExtra) => (
    <button onClick={handler} disabled={saving || disabledExtra} style={{
      flex: 1, padding: '14px', background: '#1b6b5a', color: 'white', border: 'none',
      borderRadius: '8px', fontSize: '16px', fontWeight: 600, cursor: 'pointer',
      opacity: (saving || disabledExtra) ? 0.6 : 1,
    }}>{saving ? 'Saving...' : label}</button>
  );

  // Disclosure checkbox helper
  const disclosureCheck = (field, label, description) => (
    <div style={{ padding: '14px', background: '#f8f9fa', borderRadius: '8px', marginBottom: '12px', border: errors[field] ? '1px solid #e74c3c' : '1px solid #eee' }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
        <input type="checkbox" checked={form[field]}
          onChange={(e) => updateForm(field, e.target.checked)}
          style={{ marginTop: '3px', width: '18px', height: '18px', flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: '#333', marginBottom: '4px' }}>{label}</div>
          <div style={{ fontSize: '13px', color: '#666', lineHeight: '1.5' }}>{description}</div>
        </div>
      </label>
      {errors[field] && <div style={errorStyle}>{errors[field]}</div>}
    </div>
  );

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
          {inviteInfo && inviteInfo.inviterName && (
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

        {/* Offline banner */}
        {isOffline && (
          <div style={{
            padding: '12px 16px', background: '#fef2f2', border: '1px solid #fecaca',
            borderRadius: '10px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px',
          }}>
            <span style={{ fontSize: '20px' }}>&#9888;&#65039;</span>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#dc2626' }}>You're offline</div>
              <div style={{ fontSize: '13px', color: '#b91c1c' }}>
                Please check your internet connection. Your progress has been saved and you can continue when you're back online.
              </div>
            </div>
          </div>
        )}

        {/* Step label */}
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <span style={{ fontSize: '12px', color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px' }}>
            Step {step} of {TOTAL_STEPS} — {stepLabels[step]}
          </span>
        </div>

        {/* ─── Step 1: Create Account ─── */}
        {step === 1 && (
          <div className="card" style={{ padding: '24px' }}>
            <h2 style={{ fontSize: '18px', color: '#333', marginTop: 0, marginBottom: '16px' }}>Create Your Account</h2>
            {errorSummary()}
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
            {nextBtn(handleCreateAccount, 'Create Account & Continue')}
          </div>
        )}

        {/* ─── Step 2: Disclosures & Terms ─── */}
        {step === 2 && (
          <div className="card" style={{ padding: '24px' }}>
            <h2 style={{ fontSize: '18px', color: '#333', marginTop: 0, marginBottom: '4px' }}>Before We Begin</h2>
            <p style={{ color: '#888', fontSize: '13px', marginTop: 0, marginBottom: '20px' }}>
              Please review and acknowledge the following terms to continue with your application.
            </p>
            {errorSummary()}
            {disclosureCheck('acceptBackgroundCheck',
              'Background Check Required',
              'InPlace requires a background check through Checkr for all caregivers. You are responsible for the one-time cost ($35). This includes criminal history, driving record, and identity verification.'
            )}

            {disclosureCheck('acceptStripePayments',
              'Payment via Stripe',
              'All payments are processed through Stripe. You will set up a Stripe account to receive direct deposits for completed care sessions. InPlace retains a platform fee from each session.'
            )}

            {disclosureCheck('accept1099',
              '1099 Tax Reporting',
              'As an independent contractor, you will receive a 1099-NEC for earnings over $600 in a calendar year. You are responsible for your own taxes, including self-employment tax.'
            )}

            {disclosureCheck('acceptIndependentContractor',
              'Independent Contractor Status',
              'You are an independent contractor, not an employee of InPlace. You control your own schedule, rates, and clients. InPlace does not provide benefits, workers\' compensation, or unemployment insurance.'
            )}

            {disclosureCheck('acceptRefundPolicy',
              'Refund & Cancellation Policy',
              'After completing 10 sessions, your background check fee will be refunded. If a family cancels within 24 hours of a session, you will still be compensated unless you agree to a grace cancellation.'
            )}

            {errors.submit && <div style={{ ...errorStyle, marginBottom: '12px' }}>{errors.submit}</div>}
            <div style={{ display: 'flex', gap: '10px' }}>
              {resumeMode ? (
                <button onClick={() => onComplete && onComplete(null)} style={{
                  padding: '14px 24px', background: '#f0f0f0', color: '#555', border: 'none',
                  borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                }}>Cancel</button>
              ) : backBtn(1)}
              {nextBtn(handleAcceptTerms, 'I Understand — Continue')}
            </div>
          </div>
        )}

        {/* ─── Step 3: Personal Info + Work Location ─── */}
        {step === 3 && (
          <div className="card" style={{ padding: '24px' }}>
            <h2 style={{ fontSize: '18px', color: '#333', marginTop: 0, marginBottom: '16px' }}>Personal Information</h2>
            {errorSummary()}
            <div style={fieldGroup}>
              <label style={labelStyle}>Phone *</label>
              <input style={errors.phone ? inputErrorStyle : inputStyle} value={form.phone}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                  let formatted = '';
                  if (digits.length === 0) formatted = '';
                  else if (digits.length <= 3) formatted = '(' + digits;
                  else if (digits.length <= 6) formatted = '(' + digits.slice(0, 3) + ') ' + digits.slice(3);
                  else formatted = '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6);
                  updateForm('phone', formatted);
                }} placeholder="(540) 555-1234" />
              {errors.phone && <div style={errorStyle}>{errors.phone}</div>}
            </div>
            <div style={fieldGroup}>
              <label style={labelStyle}>Home Address *</label>
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
                  <option value="">--</option>
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

            {/* Work Location */}
            <div style={{ padding: '16px', background: '#f0faf8', borderRadius: '8px', marginBottom: '16px', border: '1px solid #d0e8e2' }}>
              <h3 style={{ fontSize: '15px', color: '#1b6b5a', margin: '0 0 4px' }}>Preferred Work Location</h3>
              <p style={{ fontSize: '12px', color: '#888', margin: '0 0 12px' }}>
                Where do you prefer to work? Leave blank to use your home address.
              </p>
              <div style={fieldGroup}>
                <label style={labelStyle}>Work Area Address</label>
                <input style={inputStyle} value={form.workLocationAddress}
                  onChange={(e) => updateForm('workLocationAddress', e.target.value)}
                  placeholder="e.g. Downtown Blacksburg, VA (or leave blank for home address)" />
              </div>
              <div style={fieldGroup}>
                <label style={labelStyle}>Travel Radius (miles)</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {RADIUS_OPTIONS.map(r => (
                    <button key={r} onClick={() => updateForm('travelRadius', r)} style={{
                      padding: '8px 16px', borderRadius: '20px', fontSize: '13px', fontWeight: 600,
                      border: form.travelRadius === r ? '2px solid #1b6b5a' : '2px solid #ddd',
                      background: form.travelRadius === r ? '#e8f5f1' : '#fff',
                      color: form.travelRadius === r ? '#1b6b5a' : '#666',
                      cursor: 'pointer',
                    }}>{r} mi</button>
                  ))}
                </div>
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
              {backBtn(2)}
              {nextBtn(handleSavePersonalInfo, 'Continue')}
            </div>
          </div>
        )}

        {/* ─── Step 4: Legal / Checkr ─── */}
        {step === 4 && (
          <div className="card" style={{ padding: '24px' }}>
            <h2 style={{ fontSize: '18px', color: '#333', marginTop: 0, marginBottom: '4px' }}>Background Check Information</h2>
            <p style={{ color: '#888', fontSize: '13px', marginTop: 0, marginBottom: '20px' }}>
              This information is required for your background check and will be kept secure.
            </p>
            {errorSummary()}
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
                  placeholder="----" />
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
                  and identity verification through Checkr. I understand this is required
                  to provide care through InPlace and the $35 fee will be refunded after 10 completed sessions.
                </span>
              </label>
              {errors.backgroundCheckConsent && <div style={errorStyle}>{errors.backgroundCheckConsent}</div>}
            </div>
            {errors.submit && <div style={{ ...errorStyle, marginBottom: '12px' }}>{errors.submit}</div>}
            <div style={{ display: 'flex', gap: '10px' }}>
              {backBtn(3)}
              {nextBtn(handleSaveLegalInfo, 'Continue')}
            </div>
          </div>
        )}

        {/* ─── Step 5: Certifications ─── */}
        {step === 5 && (
          <div className="card" style={{ padding: '24px' }}>
            <h2 style={{ fontSize: '18px', color: '#333', marginTop: 0, marginBottom: '4px' }}>Certifications</h2>
            <p style={{ color: '#888', fontSize: '13px', marginTop: 0, marginBottom: '20px' }}>
              Add any professional certifications you hold. You can add multiple. Skip if you don't have any yet.
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
                  }}>x</button>
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
            }}>+ Add Another Certification</button>
            {errors.submit && <div style={{ ...errorStyle, marginBottom: '12px' }}>{errors.submit}</div>}
            <div style={{ display: 'flex', gap: '10px' }}>
              {backBtn(4)}
              {nextBtn(handleSaveCertifications, 'Continue')}
            </div>
          </div>
        )}

        {/* ─── Step 6: Academic Program ─── */}
        {step === 6 && (() => {
          const isNursing = ['radford_nursing', 'nrcc_nurse_aide'].includes(form.programName) || (form.programName === 'other' && /nurs/i.test(form.programNameOther));
          const handleProgramContinue = async () => {
            if (form.needsProgramReports === true) {
              if (!validateStep(6)) return;
              // Save program info to caregiver profile
              setSaving(true);
              try {
                const token = authToken || window.AUTH_TOKEN;
                const programLabel = form.programName === 'radford_nursing' ? 'Radford University Nursing'
                  : form.programName === 'nrcc_nurse_aide' ? 'NRCC Nurse Aide Program'
                  : form.programNameOther || form.programName;
                await resilientFetch('/api/caregivers/profile', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                  body: JSON.stringify({
                    hourlyRate: parseFloat(form.hourlyRate) || 25,
                    academicProgram: programLabel,
                    academicProgramYear: form.programYear,
                    needsHourReports: true,
                  }),
                });
              } catch (err) { /* non-blocking */ }
              setSaving(false);
            }
            trackEvent('step_complete', 6, { needsProgramReports: !!form.needsProgramReports });
            setStep(7);
          };
          return (
            <div className="card" style={{ padding: '24px' }}>
              <h2 style={{ fontSize: '18px', color: '#333', marginTop: 0, marginBottom: '4px' }}>Academic Program</h2>
              <p style={{ color: '#888', fontSize: '13px', marginTop: 0, marginBottom: '20px' }}>
                Some caregivers are enrolled in educational programs that require tracking hours and types of work performed. Let us know if this applies to you.
              </p>
              {errorSummary()}
              <div style={{ marginBottom: '20px' }}>
                <label style={labelStyle}>Do you need InPlace to generate reports on your care hours and work types for a school or training program?</label>
                <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                  {[{ val: true, label: 'Yes, I need program reports' }, { val: false, label: 'No, this doesn\'t apply to me' }].map(opt => (
                    <button key={String(opt.val)} onClick={() => updateForm('needsProgramReports', opt.val)} style={{
                      flex: 1, padding: '14px 12px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                      border: form.needsProgramReports === opt.val ? '2px solid #1b6b5a' : '2px solid #ddd',
                      background: form.needsProgramReports === opt.val ? '#e8f5f1' : '#fff',
                      color: form.needsProgramReports === opt.val ? '#1b6b5a' : '#555',
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}>{opt.label}</button>
                  ))}
                </div>
              </div>

              {form.needsProgramReports === true && (
                <div style={{ padding: '16px', background: '#f0faf8', borderRadius: '10px', border: '1px solid #d0e8e2', marginBottom: '16px' }}>
                  <h3 style={{ fontSize: '15px', color: '#1b6b5a', margin: '0 0 12px' }}>Program Details</h3>

                  <div style={fieldGroup}>
                    <label style={labelStyle}>Which program are you enrolled in? *</label>
                    <select style={errors.programName ? inputErrorStyle : inputStyle} value={form.programName}
                      onChange={(e) => updateForm('programName', e.target.value)}>
                      <option value="">Select your program</option>
                      <option value="radford_nursing">Radford University — Nursing Program</option>
                      <option value="nrcc_nurse_aide">New River Community College (NRCC) — Nurse Aide Program</option>
                      <option value="other">Other program</option>
                    </select>
                    {errors.programName && <div style={errorStyle}>{errors.programName}</div>}
                  </div>

                  {form.programName === 'other' && (
                    <div style={fieldGroup}>
                      <label style={labelStyle}>Program Name *</label>
                      <input style={errors.programNameOther ? inputErrorStyle : inputStyle} value={form.programNameOther}
                        onChange={(e) => updateForm('programNameOther', e.target.value)}
                        placeholder="e.g. Virginia Tech Health Sciences" />
                      {errors.programNameOther && <div style={errorStyle}>{errors.programNameOther}</div>}
                    </div>
                  )}

                  <div style={fieldGroup}>
                    <label style={labelStyle}>What year are you in? *</label>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {['1st Year', '2nd Year', '3rd Year', '4th Year', '5th Year+', 'Certificate Program'].map(yr => (
                        <button key={yr} onClick={() => updateForm('programYear', yr)} style={{
                          padding: '8px 16px', borderRadius: '20px', fontSize: '13px', fontWeight: 600,
                          border: form.programYear === yr ? '2px solid #1b6b5a' : '2px solid #ddd',
                          background: form.programYear === yr ? '#e8f5f1' : '#fff',
                          color: form.programYear === yr ? '#1b6b5a' : '#666',
                          cursor: 'pointer',
                        }}>{yr}</button>
                      ))}
                    </div>
                    {errors.programYear && <div style={errorStyle}>{errors.programYear}</div>}
                  </div>

                  {isNursing && (
                    <div style={{
                      padding: '14px', background: '#fff8e1', borderRadius: '8px', marginTop: '8px',
                      border: '1px solid #ffe082',
                    }}>
                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                        <input type="checkbox" checked={form.acknowledgeNoMedicalCare}
                          onChange={(e) => updateForm('acknowledgeNoMedicalCare', e.target.checked)}
                          style={{ marginTop: '3px', width: '18px', height: '18px', flexShrink: 0 }} />
                        <div>
                          <div style={{ fontSize: '14px', fontWeight: 700, color: '#e65100', marginBottom: '4px' }}>
                            Important: No Medical Care
                          </div>
                          <div style={{ fontSize: '13px', color: '#795548', lineHeight: '1.6' }}>
                            I understand that while participating on InPlace, I am <strong>not</strong> practicing medical care, clinical nursing, or any licensed healthcare activities. My role is limited to non-medical companionship, personal assistance, and daily living support as defined by InPlace's service categories. My nursing/aide program hours logged through InPlace reflect caregiving experience only.
                          </div>
                        </div>
                      </label>
                      {errors.acknowledgeNoMedicalCare && <div style={errorStyle}>{errors.acknowledgeNoMedicalCare}</div>}
                    </div>
                  )}

                  <div style={{ marginTop: '12px', padding: '10px', background: '#f8f9fa', borderRadius: '8px', fontSize: '12px', color: '#888', lineHeight: '1.5' }}>
                    We'll keep track of your hours and work types so you can generate reports for your program coordinator. You can access these reports anytime from your dashboard.
                  </div>
                </div>
              )}

              {errors.submit && <div style={{ ...errorStyle, marginBottom: '12px' }}>{errors.submit}</div>}
              <div style={{ display: 'flex', gap: '10px' }}>
                {backBtn(5)}
                {nextBtn(handleProgramContinue, form.needsProgramReports === null ? 'Select an option above' : 'Continue', form.needsProgramReports === null)}
              </div>
            </div>
          );
        })()}

        {/* ─── Step 7: Background Check Payment ($30) ─── */}
        {step === 7 && (
          <div className="card" style={{ padding: '24px' }}>
            <h2 style={{ fontSize: '18px', color: '#333', marginTop: 0, marginBottom: '4px' }}>Background Check Payment</h2>
            <p style={{ color: '#888', fontSize: '13px', marginTop: 0, marginBottom: '20px' }}>
              A one-time $30 fee is required to initiate your Checkr background check. This covers criminal history, driving record, and identity verification.
            </p>

            {bgCheckPaid ? (
              <div style={{
                textAlign: 'center', padding: '32px 20px', background: '#e8f5e9',
                borderRadius: '12px', marginBottom: '20px',
              }}>
                <div style={{ fontSize: '48px', marginBottom: '12px' }}>&#9989;</div>
                <h3 style={{ color: '#2e7d32', margin: '0 0 8px', fontSize: '18px' }}>Payment Received!</h3>
                <p style={{ color: '#4caf50', margin: 0, fontSize: '14px' }}>
                  Your background check has been initiated. You can continue with your application.
                </p>
              </div>
            ) : (
              <div style={{ marginBottom: '20px' }}>
                <StripePaymentForm
                  amount={30}
                  description="This charge will appear as 'InPlace' on your statement."
                  buttonText="Pay $30.00 — Background Check"
                  onSuccess={(intent) => {
                    setBgCheckPaid(true);
                  }}
                  onError={(msg) => {
                    setErrors({ submit: msg });
                  }}
                />
              </div>
            )}

            <div style={{
              padding: '14px', background: '#f0faf8', borderRadius: '8px', marginBottom: '16px',
              border: '1px solid #d0e8e2', fontSize: '13px', color: '#1b6b5a', lineHeight: '1.6',
            }}>
              <strong>Refund policy:</strong> Your $30 background check fee will be refunded to your InPlace account after you complete 10 care sessions. That's our way of investing in caregivers who stay with us.
            </div>

            {errors.submit && <div style={{ color: '#e74c3c', fontSize: '12px', marginBottom: '12px' }}>{errors.submit}</div>}
            <div style={{ display: 'flex', gap: '10px' }}>
              {backBtn(6)}
              <button onClick={() => setStep(8)} style={{
                flex: 1, padding: '14px', background: '#1b6b5a',
                color: 'white', border: 'none', borderRadius: '8px', fontSize: '16px',
                fontWeight: 600, cursor: 'pointer',
              }}>{bgCheckPaid ? 'Continue' : 'Continue Without Payment'}</button>
            </div>

            {!bgCheckPaid && (
              <div style={{
                marginTop: '12px', padding: '14px', background: '#fff8e1', borderRadius: '8px',
                border: '1px solid #ffe082', fontSize: '13px', color: '#b45309', lineHeight: '1.6',
              }}>
                <strong>Note:</strong> You can continue registration without paying now, but you won't be able to view available care requests or accept jobs on the platform until your background check payment is complete. You can pay later from your dashboard.
              </div>
            )}
          </div>
        )}

        {/* ─── Step 8: Document Upload ─── */}
        {step === 8 && (
          <div className="card" style={{ padding: '24px' }}>
            <h2 style={{ fontSize: '18px', color: '#333', marginTop: 0, marginBottom: '4px' }}>Upload Documents</h2>
            <p style={{ color: '#888', fontSize: '13px', marginTop: 0, marginBottom: '12px' }}>
              Upload photos of your driver's license (front and back). You can also upload certification documents.
            </p>
            <div style={{ padding: '10px 14px', background: '#f0faf8', borderRadius: '8px', marginBottom: '20px', border: '1px solid #d0e8e2' }}>
              <p style={{ fontSize: '12px', color: '#1b6b5a', margin: 0, lineHeight: '1.5' }}>
                <strong>Tip:</strong> Place your ID on a flat, well-lit surface. Make sure all text and the photo are clearly readable. Images are automatically optimized for upload.
              </p>
            </div>
            {errorSummary()}
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
                  <input type="file" accept="image/*" capture="environment" id="dl_front_camera" style={{ display: 'none' }}
                    onChange={(e) => handleFileSelect('dl_front', e)} />
                  <input type="file" accept="image/*" id="dl_front_gallery" style={{ display: 'none' }}
                    onChange={(e) => handleFileSelect('dl_front', e)} />
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button type="button" onClick={() => document.getElementById('dl_front_camera').click()} style={{
                      flex: 1, padding: '14px 12px', background: '#1b6b5a', color: 'white', border: 'none',
                      borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                    }}>&#128247; Take Photo</button>
                    <button type="button" onClick={() => document.getElementById('dl_front_gallery').click()} style={{
                      flex: 1, padding: '14px 12px', background: 'white', color: '#1b6b5a', border: '2px solid #1b6b5a',
                      borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                    }}>&#128444; Choose Photo</button>
                  </div>
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
                  <input type="file" accept="image/*" capture="environment" id="dl_back_camera" style={{ display: 'none' }}
                    onChange={(e) => handleFileSelect('dl_back', e)} />
                  <input type="file" accept="image/*" id="dl_back_gallery" style={{ display: 'none' }}
                    onChange={(e) => handleFileSelect('dl_back', e)} />
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button type="button" onClick={() => document.getElementById('dl_back_camera').click()} style={{
                      flex: 1, padding: '14px 12px', background: '#1b6b5a', color: 'white', border: 'none',
                      borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                    }}>&#128247; Take Photo</button>
                    <button type="button" onClick={() => document.getElementById('dl_back_gallery').click()} style={{
                      flex: 1, padding: '14px 12px', background: 'white', color: '#1b6b5a', border: '2px solid #1b6b5a',
                      borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                    }}>&#128444; Choose Photo</button>
                  </div>
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
                  <button onClick={() => {
                    setForm(f => ({ ...f, documents: f.documents.filter((d, idx) => !(d.type === 'certification' && idx === f.documents.indexOf(doc))) }));
                  }} style={{
                    background: '#fff0f0', border: '1px solid #fdd', borderRadius: '6px',
                    padding: '4px 10px', fontSize: '12px', cursor: 'pointer', color: '#c00',
                  }}>Remove</button>
                </div>
              ))}
              <input type="file" accept="image/*" onChange={async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                if (file.size > 10 * 1024 * 1024) return;
                const { dataUrl, blob } = await resizeImage(file);
                const resizedFile = new File([blob], file.name, { type: blob.type || file.type });
                setForm(f => ({
                  ...f,
                  documents: [...f.documents, { type: 'certification', file: resizedFile, preview: dataUrl, fileName: file.name }],
                }));
                e.target.value = '';
              }} style={{ fontSize: '14px' }} />
            </div>

            {errors.submit && <div style={{ ...errorStyle, marginBottom: '12px' }}>{errors.submit}</div>}
            <div style={{ display: 'flex', gap: '10px' }}>
              {backBtn(7)}
              {nextBtn(handleUploadDocuments, 'Upload & Continue')}
            </div>
          </div>
        )}

        {/* ─── Step 9: Review & Complete ─── */}
        {step === 9 && (
          <div className="card" style={{ padding: '24px' }}>
            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>&#127881;</div>
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
                <div><span style={{ color: '#888' }}>Travel radius:</span> {form.travelRadius} miles</div>
                {form.needsProgramReports && (
                  <div style={{ gridColumn: '1 / -1' }}><span style={{ color: '#888' }}>Program:</span> {form.programName === 'radford_nursing' ? 'Radford University Nursing' : form.programName === 'nrcc_nurse_aide' ? 'NRCC Nurse Aide' : form.programNameOther || '—'} ({form.programYear})</div>
                )}
              </div>
            </div>

            {!bgCheckPaid && (
              <div style={{
                padding: '14px', background: '#fef2f2', borderRadius: '8px', marginBottom: '16px',
                border: '1px solid #fecaca',
              }}>
                <p style={{ fontSize: '14px', color: '#dc2626', margin: 0, fontWeight: 600 }}>
                  Background check payment not yet completed
                </p>
                <p style={{ fontSize: '13px', color: '#b91c1c', margin: '6px 0 0', lineHeight: '1.5' }}>
                  You'll need to complete your $30 background check payment from your dashboard before you can view available work or accept care requests.
                </p>
              </div>
            )}

            <div style={{ padding: '14px', background: '#fff8f0', borderRadius: '8px', marginBottom: '16px', border: '1px solid #ffe0c0' }}>
              <p style={{ fontSize: '13px', color: '#b45309', margin: 0, lineHeight: '1.5' }}>
                <strong>What happens next:</strong>
              </p>
              <ul style={{ fontSize: '13px', color: '#b45309', margin: '8px 0 0', paddingLeft: '20px', lineHeight: '1.8' }}>
                {!bgCheckPaid && <li>Pay for your background check ($30) from your dashboard</li>}
                <li>Your background check {bgCheckPaid ? 'is being' : 'will be'} processed (typically 2-5 business days)</li>
                <li>Once verified, complete your First Steps checklist to start accepting care requests</li>
                <li>Set your availability and care preferences from your dashboard</li>
              </ul>
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
