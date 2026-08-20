// ─── The path, quietly (v1.105.115, rewritten v1.105.118) ───
//
// v1.105.115 replaced a nine-segment progress bar with the whole route: three legs, every item
// of the open one on its own row, every item of the closed ones named beside them. Accurate,
// and Pete's verdict on seeing it: "we don't want this to be a catalogue in your face of how
// hard it is to sign up."
//
// He is right, and the fix is not less information — she still needs to see the end from the
// beginning, and nothing may appear later — it is less WEIGHT. So:
//
//   finished  11px, grey, struck through, all of it joined onto one wrapping line
//   open      the screen she is on, at full size, the only thing with any weight
//   ahead     11px, lighter grey, names on one line, truncated after six
//
// Height on a phone goes from roughly 260px to about 70px, and property 1 survives intact:
// every one of the thirteen is still readable before she starts.
//
// `slot` splits it around the form: what is done sits above the screen she is on, what is left
// sits below it. That ordering is the point — she reads her own progress first.
const OnboardingPath = window.OnboardingPath = ({ step, idSubmitted, slot }) => {
  // A caregiver in the wizard has done none of the dashboard work yet. Stated as a fact rather
  // than left undefined, because an undefined Stripe status legitimately means "not asked" and
  // would draw as `unknown` — and there is nothing to ask about yet.
  const route = resolveRoute({
    surface: 'wizard',
    step,
    identity: { submitted: !!idSubmitted },
    stripe: { status: 'none' },
    backgroundCheck: {},
  });

  if (slot === 'done') {
    const done = route.items.filter((i) => i.state === 'done').map((i) => i.label);
    if (done.length === 0) return null;
    return (
      // Keyed on the count so finishing a step replays the fade — no animation state to leak.
      <div className="ip-path-done" key={done.length} style={{
        fontSize: '11px', lineHeight: '1.55', color: 'var(--text-tertiary)',
        textDecoration: 'line-through', marginBottom: '14px', opacity: 0.75,
      }}>{done.join('  \u00B7  ')}</div>
    );
  }

  // Everything still to come. Two exclusions, both deliberate:
  //   - the item this screen collects, because she is looking at it
  //   - anything `waiting`, because it is with US. Listing her own finished ID among the things
  //     she has left to do is the exact sentence this whole track exists to delete.
  // Sited by `wizardStep`, not by route.current: screen 4 collects safety-check details, and
  // the first thing she has left is not what she is currently doing.
  const ahead = route.items
    .filter((i) => i.state !== 'done' && i.state !== 'waiting' && i.wizardStep !== step)
    .map((i) => i.label);
  const waiting = route.items.filter((i) => i.state === 'waiting').length;
  // Not truncated. "…and 6 more" would be quieter and would also reintroduce the exact thing
  // she complained about — "you think you're almost there and there keeps being more steps".
  // Every name is readable on screen one; it is 11px grey, which is the part that was wrong
  // before, not the completeness.

  return (
    <div style={{ marginTop: '16px' }}>
      {ahead.length > 0 && (
        <div style={{ fontSize: '11px', lineHeight: '1.55', color: 'var(--text-muted)' }}>
          {ahead.join('  \u00B7  ')}
        </div>
      )}
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px', opacity: 0.8 }}>
        {route.remaining} {route.remaining === 1 ? 'thing' : 'things'} left
        {waiting > 0 ? '  \u00B7  ' + waiting + ' with us' : ''}
      </div>
    </div>
  );
};

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
  const [authToken, setAuthTokenState] = useState(resumeMode ? window.AUTH_TOKEN : null);
  const [profileId, setProfileId] = useState(null);
  const [errors, setErrors] = useState({});
  const [intlPhone, setIntlPhone] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  // Identity verification state (selfie + ID)
  const [idSelfie, setIdSelfie] = useState(null);
  const [idPhoto, setIdPhoto] = useState(null);
  const [idVerifying, setIdVerifying] = useState(false);
  const [idVerifyResult, setIdVerifyResult] = useState(null);
  const [cameraStream, setCameraStream] = useState(null);
  const [cameraMode, setCameraMode] = useState(null); // 'selfie' | 'id' | null
  const idVideoRef = useRef(null);
  const idCanvasRef = useRef(null);

  // ─── Scroll to top on step change ───
  useEffect(() => { window.scrollTo(0, 0); }, [step]);

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

  // ─── Build auth headers helper (only includes Authorization when token exists) ───
  const authHeaders = (extra = {}) => {
    const token = authToken || window.AUTH_TOKEN;
    const h = { ...extra };
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  };

  // ─── Resilient fetch: auto-retry on transient network failures + 401 refresh ───
  const resilientFetch = async (url, options, retries = 2) => {
    // Auto-inject CSRF token for state-changing requests
    if (options && ['POST', 'PUT', 'DELETE', 'PATCH'].includes((options.method || '').toUpperCase())) {
      const csrf = typeof getCsrfToken === 'function' ? getCsrfToken() : (typeof window !== 'undefined' && window.getCsrfToken ? window.getCsrfToken() : null);
      if (csrf && options.headers) {
        options.headers['X-CSRF-Token'] = csrf;
      }
    }
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (!navigator.onLine) {
          throw new Error('OFFLINE');
        }
        const res = await fetch(url, { credentials: 'same-origin', ...options });

        // Auto-refresh on 401: try /api/auth/refresh, then retry original request once
        if (res.status === 401 && attempt === 0 && url !== '/api/auth/refresh') {
          try {
            const refreshRes = await fetch('/api/auth/refresh', {
              method: 'POST', credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
            });
            if (refreshRes.ok) {
              const refreshData = await refreshRes.json();
              if (refreshData.token) {
                setAuthTokenState(refreshData.token);
                window.AUTH_TOKEN = refreshData.token;
                // Update Authorization header for retry
                if (options?.headers) {
                  options.headers['Authorization'] = `Bearer ${refreshData.token}`;
                }
              }
              continue; // Retry the original request with new token
            }
          } catch (_) { /* refresh failed, fall through to return original 401 */ }
        }

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
  // v1.105.112 — this analytics map was off too, and in a different way from stepLabels: it
  // carried a "Background Check Payment" step at 7 that the wizard does not have, shifting
  // every name after it. So every onboarding event since has been filed under the wrong step
  // name, and the admin funnel has been measuring the wrong thing. Keys 1–9, matching the JSX.
  const stepNames = {
    1: 'Create Account', 2: 'Disclosures & Terms', 3: 'Personal Info',
    4: 'Background Check Info', 5: 'Certifications', 6: 'Academic Program',
    7: 'Document Upload', 8: 'Identity Verification', 9: 'Review & Complete',
  };
  const trackEvent = (eventType, stepNum, extra = {}) => {
    try {
      const token = authToken || window.AUTH_TOKEN;
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const csrf = typeof getCsrfToken === 'function' ? getCsrfToken() : null;
      if (csrf) headers['X-CSRF-Token'] = csrf;
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
    acceptNoMedical: false,
    acceptBackgroundCheck: false,
    acceptStripePayments: false,
    accept1099: false,
    acceptIndependentContractor: false,
    acceptRefundPolicy: false,
    acceptTransportation: false,
    acceptConfidentiality: false,
    // Step 3 — Personal Info + Work Location
    phone: '', addressLine1: '', addressLine2: '', city: '', state: '', zip: '',
    yearsExperience: '', hourlyRate: '', rateDaytime: '24', rateNighttime: '28', rateOvernight: '30', bio: '',
    workLocationAddress: '', workCity: '', workState: '', workZip: '',
    travelRadius: '15',
    // Step 3 — Pets, Allergies & Medical
    comfortableWithPets: null, petAllergies: '', foodAllergies: '', medicalConditions: '', openToInterview: null,
    // Step 4 — Legal / Checkr
    legalFirstName: '', legalMiddleName: '', noMiddleName: false, legalLastName: '', dateOfBirth: '', ssnLast4: '',
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

  const TOTAL_STEPS = 9; // Step 8 = Identity Verification (selfie+ID), Step 9 = Review
  const US_STATES = [
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS',
    'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
    'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
  ];
  const CERT_TYPES = ['CNA', 'HHA', 'LPN', 'RN', 'CPR/First Aid', 'BLS', 'ACLS', 'Other'];
  const RADIUS_OPTIONS = ['5', '10', '15', '25', '50'];

  // Pre-fill phone and name from user profile (avoids re-entering data from registration)
  // v1.103.4 — no token guard: sessions restored from the httpOnly auth cookie
  // have window.AUTH_TOKEN unset, which silently skipped this prefill (Julia
  // trap-run: phone had to be typed twice). The fetch rides the cookie; a 401
  // in the pre-auth invite flow just resolves null and prefills nothing.
  useEffect(() => {
    resilientFetch('/api/auth/me', {
      headers: authHeaders(),
    }).then(r => r.ok ? r.json() : null).then(data => {
      if (data?.user) {
        setForm(f => ({
          ...f,
          phone: f.phone || (data.user.phone ? formatPhone(data.user.phone) : ''),
          legalFirstName: f.legalFirstName || data.user.first_name || '',
          legalLastName: f.legalLastName || data.user.last_name || '',
        }));
      }
    }).catch(() => {});
  }, [authToken]);

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
      if (!form.dateOfBirth) errs.dateOfBirth = 'Required';
      if (!form.password || form.password.length < 8) errs.password = 'Minimum 8 characters';
      if (form.password !== form.confirmPassword) errs.confirmPassword = 'Passwords do not match';
    }
    if (stepNum === 2) {
      if (!form.acceptNoMedical) errs.acceptNoMedical = 'You must acknowledge this to proceed';
      if (!form.acceptBackgroundCheck) errs.acceptBackgroundCheck = 'You must acknowledge this to proceed';
      if (!form.acceptStripePayments) errs.acceptStripePayments = 'You must acknowledge this to proceed';
      if (!form.accept1099) errs.accept1099 = 'You must acknowledge this to proceed';
      if (!form.acceptIndependentContractor) errs.acceptIndependentContractor = 'You must acknowledge this to proceed';
      if (!form.acceptRefundPolicy) errs.acceptRefundPolicy = 'You must acknowledge this to proceed';
      if (!form.acceptTransportation) errs.acceptTransportation = 'You must acknowledge this to proceed';
      if (!form.acceptConfidentiality) errs.acceptConfidentiality = 'You must acknowledge this to proceed';
    }
    if (stepNum === 3) {
      if (!form.phone.trim()) errs.phone = 'Required';
      if (!form.addressLine1.trim()) errs.addressLine1 = 'Required';
      if (!form.city.trim()) errs.city = 'Required';
      if (!form.state) errs.state = 'Required';
      if (!form.zip.trim()) errs.zip = 'Required';
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
    if (stepNum === 7) { // Document upload validation (was step 8)
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
        dateOfBirth: form.dateOfBirth,   // v1.105.8 — age gate; server enforces >= 13
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
      // Token stored in httpOnly cookie by server; keep in-memory for WebSocket
      window.AUTH_TOKEN = token;

      // Accept platform invite (skip for email-first signup flow)
      if (inviteToken && !signupToken) {
        await resilientFetch('/api/platform-invites/accept-invite', {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
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
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          bio: form.bio, yearsExperience: parseInt(form.yearsExperience) || 0,
          hourlyRate: 24,
          rateDaytime: 24, rateNighttime: 28, rateOvernight: 30,
          specialties: [], certifications: [],
          city: form.city, state: form.state,
          address: form.addressLine1,
          addressLine1: form.addressLine1, addressLine2: form.addressLine2, zip: form.zip,
          workLocationAddress: form.workLocationAddress || `${form.addressLine1}, ${form.city}, ${form.state} ${form.zip}`,
          travelRadius: parseInt(form.travelRadius) || 15,
          termsAcceptedAt: new Date().toISOString(),
          termsVersion: '1.0',
          openToInterview: form.openToInterview,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        trackEvent('error', 3, { error: data.error || 'Failed to save profile', source: 'api', status: res.status });
        setErrors({ submit: data.error || 'Failed to save profile' }); setSaving(false); return;
      }
      setProfileId(data.profile?.id);

      // Also update user phone + pets/allergies/medical (non-blocking)
      const normalizedPhone = form.phone ? (intlPhone ? form.phone.replace(/[^\d\+]/g, '') : form.phone.replace(/\D/g, '')) : null;
      const userUpdate = { phone: normalizedPhone };
      if (form.petAllergies) userUpdate.petAllergies = form.petAllergies;
      if (form.foodAllergies) userUpdate.foodAllergies = form.foodAllergies;
      if (form.medicalConditions) userUpdate.medicalConditions = form.medicalConditions;
      if (form.comfortableWithPets !== null) userUpdate.pets = form.comfortableWithPets ? 'comfortable' : 'prefer-none';
      resilientFetch('/api/auth/me', {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(userUpdate),
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
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          hourlyRate: parseFloat(form.rateDaytime) || parseFloat(form.hourlyRate) || 25,
          rateDaytime: parseFloat(form.rateDaytime) || null,
          rateNighttime: parseFloat(form.rateNighttime) || null,
          rateOvernight: parseFloat(form.rateOvernight) || null,
          legalFirstName: form.legalFirstName, legalMiddleName: form.noMiddleName ? '' : form.legalMiddleName, legalLastName: form.legalLastName,
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
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          hourlyRate: parseFloat(form.rateDaytime) || parseFloat(form.hourlyRate) || 25,
          rateDaytime: parseFloat(form.rateDaytime) || null,
          rateNighttime: parseFloat(form.rateNighttime) || null,
          rateOvernight: parseFloat(form.rateOvernight) || null,
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
    if (!validateStep(7)) return;
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

      const _hdrs = {};
      if (token) _hdrs['Authorization'] = `Bearer ${token}`;
      const res = await resilientFetch('/api/caregiver-onboarding/documents', {
        method: 'POST',
        headers: _hdrs,
        body: formData,
      }, 1); // only 1 retry for uploads (they're larger)
      if (!res.ok) {
        const data = await res.json();
        trackEvent('error', 7, { error: data.error, source: 'api', status: res.status });
        setErrors({ submit: data.error }); setSaving(false); return;
      }
      trackEvent('step_complete', 7);
      setStep(8);
    } catch (err) {
      const msg = !navigator.onLine ? 'You appear to be offline. Please check your connection and try again.' : 'Upload failed — please check your connection and try again.';
      trackEvent('error', 7, { error: msg, source: 'network' });
      setErrors({ submit: msg });
    }
    setSaving(false);
  };

  // ─── Identity Verification (selfie + ID) helpers ───
  const startIdCamera = async (mode) => {
    try {
      setCameraMode(mode);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode === 'selfie' ? 'user' : 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      setCameraStream(stream);
      // Attach to video element after render
      setTimeout(() => {
        if (idVideoRef.current) { idVideoRef.current.srcObject = stream; idVideoRef.current.play().catch(() => {}); }
      }, 100);
    } catch (err) {
      setErrors(e => ({ ...e, identity: 'Camera access denied. Please allow camera access or upload a photo instead.' }));
    }
  };

  const captureIdPhoto = () => {
    if (!idVideoRef.current || !idCanvasRef.current) return;
    const video = idVideoRef.current;
    const canvas = idCanvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (cameraMode === 'selfie') { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0);
    const base64 = canvas.toDataURL('image/jpeg', 0.85);
    if (cameraMode === 'selfie') setIdSelfie(base64);
    else setIdPhoto(base64);
    stopIdCamera();
  };

  const stopIdCamera = () => {
    if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); setCameraStream(null); }
    setCameraMode(null);
  };

  // Clean up camera on unmount
  useEffect(() => { return () => { if (cameraStream) cameraStream.getTracks().forEach(t => t.stop()); }; }, [cameraStream]);

  // v1.105.35 — downscale before encoding, the same way every other photo path in the app
  // does. A phone-camera JPEG is 3–5MB and base64 adds a third on top, so posting two raw
  // ones was megabytes of body for an image that gets looked at, not printed. The server
  // gained a 10mb limit in the same version (it had none, so every submission 413'd), but a
  // caregiver on a rural connection still should not upload 12MB to prove who they are.
  // downscaleImage returns null for anything it cannot handle (non-image, GIF, decode
  // failure) — fall back to the original rather than blocking the upload.
  const handleIdFileUpload = async (type, e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    let dataUrl = null;
    try {
      if (typeof downscaleImage === 'function') dataUrl = await downscaleImage(file, { maxDim: 1600, quality: 0.85 });
    } catch { dataUrl = null; }
    if (!dataUrl) {
      dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      });
    }
    if (!dataUrl) { setErrors({ identity: 'That file could not be read. Try another photo.' }); return; }
    if (type === 'selfie') setIdSelfie(dataUrl);
    else setIdPhoto(dataUrl);
  };

  const handleVerifyIdentity = async () => {
    if (!idSelfie || !idPhoto) { setErrors({ identity: 'Both a selfie and an ID photo are required' }); return; }
    setIdVerifying(true);
    setErrors({});
    try {
      const token = authToken || window.AUTH_TOKEN;
      const res = await resilientFetch('/api/caregiver-onboarding/verify-id', {
        method: 'POST',
        headers: { ...authHeaders({ 'Content-Type': 'application/json' }) },
        body: JSON.stringify({ idPhoto: idPhoto, selfie: idSelfie }),
      }, 1);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        trackEvent('error', 8, { error: data.error || 'verify-id failed', source: 'api' });
        setErrors({ identity: data.error || 'Verification failed. Please try again.' });
        setIdVerifying(false);
        return;
      }
      const result = await res.json();
      setIdVerifyResult(result);
      trackEvent('step_complete', 8, { matched: result.matched, needsReview: result.needsHumanReview });
      // Move to review step after short delay so user can see result
      setTimeout(() => setStep(9), 1500);
    } catch (err) {
      const msg = networkErrorMsg(err);
      trackEvent('error', 8, { error: msg, source: 'network' });
      setErrors({ identity: msg });
    }
    setIdVerifying(false);
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
    const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i.test(file.name) || file.type === '';
    const isPDF = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isImage && !isPDF) { setErrors(er => ({ ...er, [docType]: 'Must be an image or PDF file' })); return; }

    // PDFs skip image resize — store as-is
    if (isPDF) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setForm(f => {
          const docs = f.documents.filter(d => d.type !== docType);
          docs.push({ type: docType, file, preview: null, fileName: file.name, isPDF: true });
          return { ...f, documents: docs };
        });
        setErrors(er => ({ ...er, [docType]: null }));
      };
      reader.readAsDataURL(file);
      e.target.value = '';
      return;
    }

    try {
      const { dataUrl, blob } = await resizeImage(file);
      const resizedFile = new File([blob], file.name, { type: blob.type || file.type || 'image/jpeg' });
      setForm(f => {
        const docs = f.documents.filter(d => d.type !== docType);
        docs.push({ type: docType, file: resizedFile, preview: dataUrl, fileName: file.name });
        return { ...f, documents: docs };
      });
      setErrors(er => ({ ...er, [docType]: null }));
    } catch (err) {
      console.error('Image processing error:', err);
      const preview = URL.createObjectURL(file);
      setForm(f => {
        const docs = f.documents.filter(d => d.type !== docType);
        docs.push({ type: docType, file, preview, fileName: file.name });
        return { ...f, documents: docs };
      });
      setErrors(er => ({ ...er, [docType]: null }));
    }
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
    trackEvent('onboarding_complete', 10);
    clearSavedProgress();
    if (typeof onComplete === 'function') onComplete(authToken || window.AUTH_TOKEN);
  };

  // ─── Render ───

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: 'var(--bg-primary)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>&#9203;</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '16px' }}>Validating your invite...</div>
        </div>
      </div>
    );
  }

  if (inviteError) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: 'var(--bg-primary)' }}>
        <div style={{ textAlign: 'center', maxWidth: '400px', padding: '40px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>&#128532;</div>
          <h2 style={{ color: 'var(--text-primary)', marginBottom: '8px' }}>Invite Issue</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>{inviteError}</p>
          <a href="/" style={{
            display: 'inline-block', padding: '12px 28px', background: 'var(--role-color)', color: 'var(--text-on-primary)',
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
  const labelStyle = { display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' };
  const errorStyle = { color: 'var(--color-error)', fontSize: '12px', marginTop: '4px' };
  const fieldGroup = { marginBottom: '16px' };
  const rowStyle = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' };

  // v1.105.112 — EIGHT keys for NINE steps, and off by one from step 8: the wizard read
  // "Step 8 of 9 — Review & Complete" over an ID form, then "Step 9 of 9 — undefined".
  // A wizard that cannot count its own steps is a poor argument that you are nearly there,
  // which is exactly the feeling this flow is being rebuilt to fix.
  // Softer wording too: say what the person does, not what the system records.
  const stepLabels = {
    1: 'Create your account',
    2: 'The paperwork',
    3: 'About you',
    4: 'For the safety check',
    5: 'Certifications',
    6: 'Your training programme',
    7: 'Documents',
    8: 'A photo of your licence',
    9: 'One last look',
  };

  // Error summary banner — shows at top of step when validation fails
  const errorSummary = () => {
    const errorKeys = Object.keys(errors).filter(k => k !== 'submit' && errors[k]);
    if (errorKeys.length === 0) return null;
    return (
      <div style={{
        padding: '12px 16px', background: 'var(--bg-error-subtle)', border: '1px solid #fecaca',
        borderRadius: '8px', marginBottom: '16px',
      }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-error)', marginBottom: '4px' }}>
          Please fix {errorKeys.length} {errorKeys.length === 1 ? 'issue' : 'issues'} below
        </div>
        <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', color: 'var(--color-error)', lineHeight: '1.6' }}>
          {errorKeys.map(k => <li key={k}>{errors[k]}</li>)}
        </ul>
      </div>
    );
  };

  const backBtn = (targetStep) => (
    <button onClick={() => setStep(targetStep)} style={{
      padding: '14px 24px', background: 'var(--badge-muted-bg)', color: 'var(--text-secondary)', border: 'none',
      borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
    }}>Back</button>
  );

  const nextBtn = (handler, label, disabledExtra) => (
    <button onClick={handler} disabled={saving || disabledExtra} style={{
      flex: 1, padding: '14px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none',
      borderRadius: '8px', fontSize: '16px', fontWeight: 600, cursor: 'pointer',
      opacity: (saving || disabledExtra) ? 0.6 : 1,
    }}>{saving ? 'Saving...' : label}</button>
  );

  // Disclosure checkbox helper
  const disclosureCheck = (field, label, description) => (
    <div style={{ padding: '14px', background: 'var(--bg-primary)', borderRadius: '8px', marginBottom: '12px', border: errors[field] ? '1px solid #e74c3c' : '1px solid #eee' }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
        <input type="checkbox" checked={form[field]}
          onChange={(e) => updateForm(field, e.target.checked)}
          style={{ marginTop: '3px', width: '18px', height: '18px', flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>{label}</div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>{description}</div>
        </div>
      </label>
      {errors[field] && <div style={errorStyle}>{errors[field]}</div>}
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', padding: '20px' }}>
      <div style={{ maxWidth: '560px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '48px', height: '48px', borderRadius: '12px', background: 'var(--role-color)',
            color: 'var(--text-on-primary)', fontWeight: 800, fontSize: '18px', fontFamily: "'DM Sans', sans-serif",
            marginBottom: '12px',
          }}>iP</div>
          <h1 style={{ fontSize: '22px', color: 'var(--role-color)', margin: '0 0 4px' }}>Join InPlace</h1>
          {inviteInfo && inviteInfo.inviterName && (
            <p style={{ color: 'var(--text-tertiary)', fontSize: '14px', margin: 0 }}>
              Invited by {inviteInfo.inviterName}
            </p>
          )}
        </div>

        {/* What she has already done \u2014 above the screen she is on, deliberately (v1.105.118) */}
        {step < TOTAL_STEPS && <OnboardingPath slot="done" step={step} idSubmitted={!!idVerifyResult} />}

        {/* Offline banner */}
        {isOffline && (
          <div style={{
            padding: '12px 16px', background: 'var(--bg-error-subtle)', border: '1px solid #fecaca',
            borderRadius: '10px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px',
          }}>
            <span style={{ fontSize: '20px' }}>&#9888;&#65039;</span>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-error)' }}>You're offline</div>
              <div style={{ fontSize: '13px', color: 'var(--color-error)' }}>
                Please check your internet connection. Your progress has been saved and you can continue when you're back online.
              </div>
            </div>
          </div>
        )}

        {/* This screen. Not "Step 7 of 9" \u2014 the number of screens is our business, not hers,
            and it was never the number she wanted. */}
        {step < TOTAL_STEPS && (
          <div className="ip-path-step" key={step} style={{ marginBottom: '14px' }}>
            <span style={{ fontSize: '17px', fontWeight: 600, color: 'var(--text-primary)' }}>
              {stepLabels[step]}
            </span>
          </div>
        )}

        {/* ─── Step 1: Create Account ─── */}
        {step === 1 && (
          <div className="card" style={{ padding: '24px' }}>
            <h2 style={{ fontSize: '18px', color: 'var(--text-primary)', marginTop: 0, marginBottom: '16px' }}>Create Your Account</h2>
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
              <input style={{ ...inputStyle, background: 'var(--bg-primary)' }} value={form.email} disabled />
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
            {/* v1.105.8 — age gate. Account creation happens HERE, but the Checkr step (step 4)
                was the only place asking for a date of birth, so gating /api/auth/register on it
                would have broken caregiver signup outright. Same `dateOfBirth` form key, so the
                later step arrives pre-filled rather than asking twice. */}
            <div style={fieldGroup}>
              <label style={labelStyle}>Date of Birth *</label>
              <input type="date" style={errors.dateOfBirth ? inputErrorStyle : inputStyle}
                value={form.dateOfBirth} onChange={(e) => updateForm('dateOfBirth', e.target.value)} />
              {errors.dateOfBirth && <div style={errorStyle}>{errors.dateOfBirth}</div>}
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
                You must be at least 13 to have an InPlace account.
              </div>
            </div>
            {errors.submit && <div style={{ ...errorStyle, marginBottom: '12px' }}>{errors.submit}</div>}
            {nextBtn(handleCreateAccount, 'Create Account & Continue')}
          </div>
        )}

        {/* ─── Step 2: Disclosures & Terms ─── */}
        {step === 2 && (
          <div className="card" style={{ padding: '24px' }}>
            <h2 style={{ fontSize: '18px', color: 'var(--text-primary)', marginTop: 0, marginBottom: '4px' }}>Before We Begin</h2>
            <p style={{ color: 'var(--text-tertiary)', fontSize: '13px', marginTop: 0, marginBottom: '20px' }}>
              Please review and acknowledge the following terms to continue with your application.
            </p>
            {errorSummary()}
            {disclosureCheck('acceptNoMedical',
              'Important Notice — Non-Medical Care Platform',
              'Although some caregivers on InPlace may hold medical licenses or certifications (such as CNA, LPN, or RN), this platform is not for seeking or administering medical care. All services provided through InPlace are limited to non-medical companionship, personal care, and household assistance. Licensed medical professionals using InPlace must understand they are operating in a non-medical capacity only. Future development may introduce medically supervised care options, but at this time, medical care is not available through InPlace.'
            )}

            {disclosureCheck('acceptBackgroundCheck',
              'Background Check Required',
              'InPlace requires a background check through Checkr for all caregivers. You are responsible for the one-time cost ($30). This includes criminal history, driving record, and identity verification.'
            )}

            {disclosureCheck('acceptStripePayments',
              'Payment via Stripe',
              'All payments are processed through Stripe. You will set up a Stripe account to receive direct deposits for completed care sessions. InPlace retains a platform fee from each session.'
            )}

            {disclosureCheck('accept1099',
              '1099 Tax Reporting',
              'As an independent contractor, you will receive a 1099-NEC from Stripe for earnings over $600 in a calendar year. When you set up your payout account, Stripe will securely collect your full SSN directly for IRS reporting — InPlace never sees or stores your full SSN. You are responsible for your own taxes, including self-employment tax.'
            )}

            {disclosureCheck('acceptIndependentContractor',
              'Independent Contractor Status',
              'You are an independent contractor, not an employee of InPlace. You control your own schedule, rates, and clients. InPlace does not provide benefits, workers\' compensation, or unemployment insurance.'
            )}

            {disclosureCheck('acceptRefundPolicy',
              'Refund & Cancellation Policy',
              'After completing 10 sessions, your background check fee will be refunded. If a family cancels within 24 hours of a session, you are paid in full for that visit — it is your time they blocked out. You always have the option to waive that fee if you would rather let it go.'
            )}

            {disclosureCheck('acceptTransportation',
              'Transportation & Auto Insurance Requirements',
              'If you transport care recipients in your personal vehicle, you are required to carry auto insurance with a business use endorsement that covers transporting others for paid care work. Your liability limits must meet or exceed your state\'s required minimums. InPlace will conduct a Motor Vehicle Record (MVR) check as part of your background check to verify your driving history. You may not transport care recipients until these requirements are met. If you drive the care recipient\'s vehicle, the family is responsible for ensuring you are covered under their auto policy. InPlace is not liable for accidents or incidents that occur during transportation.'
            )}

            {disclosureCheck('acceptConfidentiality',
              'Confidentiality & Protected Information',
              'As a caregiver on InPlace, you will have access to sensitive personal and health-related information about care recipients, including their medical conditions, medications, care needs, daily routines, and household details. You agree to keep all care recipient information strictly confidential and not share, discuss, photograph, or disclose it to anyone outside the care team — including on social media, with friends or family, or with other clients. This obligation continues even after you stop providing care through InPlace. Unauthorized disclosure of care recipient information may result in immediate removal from the platform and may expose you to legal liability. If you become aware of any unauthorized access to or disclosure of care recipient information, you must notify InPlace immediately.'
            )}

            {errors.submit && <div style={{ ...errorStyle, marginBottom: '12px' }}>{errors.submit}</div>}
            <div style={{ display: 'flex', gap: '10px' }}>
              {resumeMode ? (
                <button onClick={() => onComplete && onComplete(null)} style={{
                  padding: '14px 24px', background: 'var(--badge-muted-bg)', color: 'var(--text-secondary)', border: 'none',
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
            <h2 style={{ fontSize: '18px', color: 'var(--text-primary)', marginTop: 0, marginBottom: '16px' }}>👤 Personal Information</h2>
            {errorSummary()}
            <div style={fieldGroup}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={labelStyle}>Phone *</label>
                <button type="button" onClick={() => { setIntlPhone(!intlPhone); updateForm('phone', ''); }} style={{ background: 'none', border: 'none', color: 'var(--role-color)', fontSize: 11, cursor: 'pointer', fontWeight: 600, padding: 0 }}>
                  {intlPhone ? 'US number' : 'International number'}
                </button>
              </div>
              <input style={errors.phone ? inputErrorStyle : inputStyle} value={form.phone}
                onChange={(e) => updateForm('phone', formatPhone(e.target.value, intlPhone))} placeholder={intlPhone ? '+44 20 7946 0958' : '(540) 555-1234'} />
              {intlPhone && <div style={{ fontSize: 11, color: 'var(--accent-color)', marginTop: 4, lineHeight: 1.4 }}>{INTL_PHONE_DISCLAIMER}</div>}
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
                  <option value="VA">VA</option>
                  <option disabled>───</option>
                  {US_STATES.filter(s => s !== 'VA').map(s => <option key={s} value={s}>{s}</option>)}
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
            <div style={{ padding: '16px', background: 'var(--bg-highlight)', borderRadius: '8px', marginBottom: '16px', border: '1px solid #d0e8e2' }}>
              <h3 style={{ fontSize: '15px', color: 'var(--role-color)', margin: '0 0 4px' }}>📍 Preferred Work Location</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', margin: '0 0 12px' }}>
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
                      background: form.travelRadius === r ? 'var(--bg-teal-light)' : 'var(--bg-card)',
                      color: form.travelRadius === r ? 'var(--role-color)' : 'var(--text-secondary)',
                      cursor: 'pointer',
                    }}>{r} mi</button>
                  ))}
                </div>
              </div>
            </div>

            <div style={rowStyle}>
              <div style={fieldGroup}>
                <label style={labelStyle}>Do you have experience caretaking? How many years?</label>
                <input type="number" min="0" style={inputStyle} value={form.yearsExperience}
                  onChange={(e) => updateForm('yearsExperience', e.target.value)} placeholder="0" />
              </div>
            </div>
            <div style={fieldGroup}>
              <label style={labelStyle}>Bio</label>
              <textarea style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }} value={form.bio}
                onChange={(e) => updateForm('bio', e.target.value)}
                placeholder="Tell families about your experience and approach to care..." />
            </div>

            {/* Pets, Allergies & Medical */}
            <div style={{ padding: '16px', background: 'var(--bg-warm)', borderRadius: '8px', marginBottom: '16px', border: '1px solid var(--border-color)' }}>
              <h3 style={{ fontSize: '15px', color: 'var(--color-warning)', margin: '0 0 4px' }}>🐾 Pets, Allergies & Medical</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', margin: '0 0 12px' }}>
                This helps families match with the right caregiver. All fields are optional.
              </p>
              <div style={fieldGroup}>
                <label style={labelStyle}>Are you comfortable working around pets?</label>
                <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                  {[{ val: true, label: '🐾 Yes, I love pets!' }, { val: false, label: '🌿 Prefer pet-free' }].map(opt => (
                    <button key={String(opt.val)} onClick={() => updateForm('comfortableWithPets', opt.val)} style={{
                      flex: 1, padding: '10px 12px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
                      border: form.comfortableWithPets === opt.val ? '2px solid #8B6914' : '2px solid #ddd',
                      background: form.comfortableWithPets === opt.val ? '#fef9ef' : 'var(--bg-card)',
                      color: form.comfortableWithPets === opt.val ? '#8B6914' : 'var(--text-secondary)',
                      cursor: 'pointer',
                    }}>{opt.label}</button>
                  ))}
                </div>
              </div>
              <div style={fieldGroup}>
                <label style={labelStyle}>Pet allergies</label>
                <input style={inputStyle} value={form.petAllergies}
                  onChange={(e) => updateForm('petAllergies', e.target.value)}
                  placeholder="e.g. cats, dogs (leave blank if none)" />
              </div>
              <div style={fieldGroup}>
                <label style={labelStyle}>Food allergies or dietary restrictions</label>
                <input style={inputStyle} value={form.foodAllergies}
                  onChange={(e) => updateForm('foodAllergies', e.target.value)}
                  placeholder="e.g. peanuts, gluten (leave blank if none)" />
              </div>
              <div style={fieldGroup}>
                <label style={labelStyle}>Medical conditions families should know about</label>
                <input style={inputStyle} value={form.medicalConditions}
                  onChange={(e) => updateForm('medicalConditions', e.target.value)}
                  placeholder="e.g. asthma, mobility limitations (leave blank if none)" />
              </div>
            </div>
            <div style={{ padding: '16px', background: 'var(--bg-highlight)', border: '1px solid #d0e8e2', borderRadius: 10, marginBottom: 12 }}>
              <label style={{ ...labelStyle, color: 'var(--role-color)' }}>🤝 Are you open to a quick intro call with families before your first visit?</label>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>Some families like to meet caregivers briefly before the first appointment. This is totally optional.</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {[{ val: true, label: '👍 Yes, happy to!' }, { val: false, label: '⏭️ Skip for now' }].map(opt => (
                  <button key={String(opt.val)} onClick={() => updateForm('openToInterview', opt.val)} style={{
                    flex: 1, padding: '10px 12px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
                    border: form.openToInterview === opt.val ? '2px solid #1b6b5a' : '2px solid #ddd',
                    background: form.openToInterview === opt.val ? 'var(--color-success-bg)' : 'var(--bg-card)',
                    color: form.openToInterview === opt.val ? 'var(--role-color)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}>{opt.label}</button>
                ))}
              </div>
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
            <h2 style={{ fontSize: '18px', color: 'var(--text-primary)', marginTop: 0, marginBottom: '4px' }}>🔒 Background Check Information</h2>
            <p style={{ color: 'var(--text-tertiary)', fontSize: '13px', marginTop: 0, marginBottom: '12px' }}>
              This information is required for your background check and will be kept secure.
            </p>
            <div style={{ padding: '12px 14px', background: 'var(--bg-highlight)', borderRadius: '8px', marginBottom: '18px', border: '1px solid #d4ede8' }}>
              <p style={{ fontSize: '13px', color: 'var(--role-color)', margin: 0, lineHeight: '1.5' }}>
                <strong>About your SSN:</strong> We only store the last 4 digits here for identity verification during the background check.
                When you set up your payout account, Stripe will securely collect your full SSN directly — InPlace never sees or stores it.
                This is required by the IRS so that Stripe can issue your 1099-NEC for earnings over $600 in a calendar year.
              </p>
            </div>
            {errorSummary()}
            <div style={rowStyle}>
              <div style={fieldGroup}>
                <label style={labelStyle}>Legal First Name *</label>
                <input style={errors.legalFirstName ? inputErrorStyle : inputStyle} value={form.legalFirstName}
                  onChange={(e) => updateForm('legalFirstName', e.target.value)} placeholder="As on ID" />
                {errors.legalFirstName && <div style={errorStyle}>{errors.legalFirstName}</div>}
              </div>
              <div style={fieldGroup}>
                <label style={labelStyle}>Legal Middle Name</label>
                <input style={inputStyle} value={form.legalMiddleName}
                  onChange={(e) => updateForm('legalMiddleName', e.target.value)} placeholder="As on ID"
                  disabled={form.noMiddleName} />
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.noMiddleName}
                    onChange={(e) => { updateForm('noMiddleName', e.target.checked); if (e.target.checked) updateForm('legalMiddleName', ''); }} />
                  I don't have a middle name
                </label>
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
                  <option value="VA" style={{ fontWeight: 600 }}>VA — Virginia</option>
                  <option disabled>──────────</option>
                  {US_STATES.filter(s => s !== 'VA').map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                {errors.dlState && <div style={errorStyle}>{errors.dlState}</div>}
              </div>
            </div>
            <div style={{ padding: '16px', background: 'var(--bg-primary)', borderRadius: '8px', marginBottom: '16px' }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.backgroundCheckConsent}
                  onChange={(e) => updateForm('backgroundCheckConsent', e.target.checked)}
                  style={{ marginTop: '3px', width: '18px', height: '18px' }} />
                <span style={{ fontSize: '13px', color: 'var(--text-primary)', lineHeight: '1.5' }}>
                  I authorize InPlace to conduct a background check, including criminal history, driving record,
                  and identity verification through Checkr. I understand this is required
                  to provide care through InPlace and the $30 fee will be refunded after 10 completed sessions.
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
            <h2 style={{ fontSize: '18px', color: 'var(--text-primary)', marginTop: 0, marginBottom: '4px' }}>📜 Certifications</h2>
            <p style={{ color: 'var(--text-tertiary)', fontSize: '13px', marginTop: 0, marginBottom: '20px' }}>
              Add any professional certifications you hold. You can add multiple. Skip if you don't have any yet.
            </p>
            {form.certifications.map((cert, idx) => (
              <div key={idx} style={{
                padding: '14px', background: 'var(--bg-primary)', borderRadius: '8px', marginBottom: '12px',
                position: 'relative',
              }}>
                {form.certifications.length > 1 && (
                  <button onClick={() => removeCert(idx)} style={{
                    position: 'absolute', top: '8px', right: '8px', background: 'none', border: 'none',
                    color: 'var(--color-red-strong)', cursor: 'pointer', fontSize: '16px', padding: '4px',
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
              padding: '10px 16px', background: 'var(--bg-surface)', border: '2px dashed #ccc',
              borderRadius: '8px', fontSize: '13px', fontWeight: 600, color: 'var(--role-color)',
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
                  headers: authHeaders({ 'Content-Type': 'application/json' }),
                  body: JSON.stringify({
                    hourlyRate: parseFloat(form.rateDaytime) || parseFloat(form.hourlyRate) || 25,
                    rateDaytime: parseFloat(form.rateDaytime) || null,
                    rateNighttime: parseFloat(form.rateNighttime) || null,
                    rateOvernight: parseFloat(form.rateOvernight) || null,
                    academicProgram: programLabel,
                    academicProgramYear: form.programYear,
                    needsHourReports: true,
                  }),
                });
              } catch (err) { /* non-blocking */ }
              setSaving(false);
            }
            trackEvent('step_complete', 6, { needsProgramReports: !!form.needsProgramReports });
            setStep(7); // Docs (was step 8, bg check payment removed)
          };
          return (
            <div className="card" style={{ padding: '24px' }}>
              <h2 style={{ fontSize: '18px', color: 'var(--text-primary)', marginTop: 0, marginBottom: '4px' }}>🎓 Academic Program</h2>
              <p style={{ color: 'var(--text-tertiary)', fontSize: '13px', marginTop: 0, marginBottom: '20px' }}>
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
                      background: form.needsProgramReports === opt.val ? 'var(--bg-teal-light)' : 'var(--bg-card)',
                      color: form.needsProgramReports === opt.val ? 'var(--role-color)' : 'var(--text-secondary)',
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}>{opt.label}</button>
                  ))}
                </div>
              </div>

              {form.needsProgramReports === true && (
                <div style={{ padding: '16px', background: 'var(--bg-highlight)', borderRadius: '10px', border: '1px solid #d0e8e2', marginBottom: '16px' }}>
                  <h3 style={{ fontSize: '15px', color: 'var(--role-color)', margin: '0 0 12px' }}>Program Details</h3>

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
                          background: form.programYear === yr ? 'var(--bg-teal-light)' : 'var(--bg-card)',
                          color: form.programYear === yr ? 'var(--role-color)' : 'var(--text-secondary)',
                          cursor: 'pointer',
                        }}>{yr}</button>
                      ))}
                    </div>
                    {errors.programYear && <div style={errorStyle}>{errors.programYear}</div>}
                  </div>

                  {isNursing && (
                    <div style={{
                      padding: '14px', background: 'var(--color-warning-bg)', borderRadius: '8px', marginTop: '8px',
                      border: '1px solid #ffe082',
                    }}>
                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                        <input type="checkbox" checked={form.acknowledgeNoMedicalCare}
                          onChange={(e) => updateForm('acknowledgeNoMedicalCare', e.target.checked)}
                          style={{ marginTop: '3px', width: '18px', height: '18px', flexShrink: 0 }} />
                        <div>
                          <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-warning)', marginBottom: '4px' }}>
                            Important: No Medical Care
                          </div>
                          <div style={{ fontSize: '13px', color: 'var(--text-brown)', lineHeight: '1.6' }}>
                            I understand that while participating on InPlace, I am <strong>not</strong> practicing medical care, clinical nursing, or any licensed healthcare activities. My role is limited to non-medical companionship, personal assistance, and daily living support as defined by InPlace's service categories. My nursing/aide program hours logged through InPlace reflect caregiving experience only.
                          </div>
                        </div>
                      </label>
                      {errors.acknowledgeNoMedicalCare && <div style={errorStyle}>{errors.acknowledgeNoMedicalCare}</div>}
                    </div>
                  )}

                  <div style={{ marginTop: '12px', padding: '10px', background: 'var(--bg-primary)', borderRadius: '8px', fontSize: '12px', color: 'var(--text-tertiary)', lineHeight: '1.5' }}>
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

        {/* ─── Step 7: Document Upload ─── */}
        {step === 7 && (
          <div className="card" style={{ padding: '24px' }}>
            <h2 style={{ fontSize: '18px', color: 'var(--text-primary)', marginTop: 0, marginBottom: '4px' }}>📄 Upload Documents</h2>
            <p style={{ color: 'var(--text-tertiary)', fontSize: '13px', marginTop: 0, marginBottom: '12px' }}>
              Upload photos of your driver's license (front and back). You can also upload certification documents.
            </p>
            <div style={{ padding: '10px 14px', background: 'var(--bg-highlight)', borderRadius: '8px', marginBottom: '20px', border: '1px solid #d0e8e2' }}>
              <p style={{ fontSize: '12px', color: 'var(--role-color)', margin: 0, lineHeight: '1.5' }}>
                <strong>Tip:</strong> Place your ID on a flat, well-lit surface. Make sure all text and the photo are clearly readable. Images are automatically optimized for upload.
              </p>
            </div>
            {errorSummary()}
            {/* DL Front */}
            <div style={fieldGroup}>
              <label style={labelStyle}>Driver's License — Front *</label>
              {form.documents.find(d => d.type === 'dl_front') ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px', background: 'var(--bg-primary)', borderRadius: '8px' }}>
                  {form.documents.find(d => d.type === 'dl_front').isPDF
                    ? <div style={{ width: '80px', height: '50px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--border-light)', borderRadius: '6px', fontSize: '22px' }}>&#128196;</div>
                    : <img src={form.documents.find(d => d.type === 'dl_front').preview}
                        style={{ width: '80px', height: '50px', objectFit: 'cover', borderRadius: '6px' }} />}
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary)', flex: 1 }}>{form.documents.find(d => d.type === 'dl_front').fileName}</span>
                  <button onClick={() => removeDocument('dl_front')} style={{
                    background: 'var(--bg-error-light)', border: '1px solid #fdd', borderRadius: '6px',
                    padding: '4px 10px', fontSize: '12px', cursor: 'pointer', color: 'var(--color-red-strong)',
                  }}>Remove</button>
                </div>
              ) : (
                <div>
                  <input type="file" accept="image/*" capture="environment" id="dl_front_camera" style={{ display: 'none' }}
                    onChange={(e) => handleFileSelect('dl_front', e)} />
                  <input type="file" accept="image/*,application/pdf" id="dl_front_gallery" style={{ display: 'none' }}
                    onChange={(e) => handleFileSelect('dl_front', e)} />
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button type="button" onClick={() => document.getElementById('dl_front_camera').click()} style={{
                      flex: 1, padding: '14px 12px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none',
                      borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                    }}>&#128247; Take Photo</button>
                    <button type="button" onClick={() => document.getElementById('dl_front_gallery').click()} style={{
                      flex: 1, padding: '14px 12px', background: 'var(--bg-surface)', color: 'var(--role-color)', border: '2px solid #1b6b5a',
                      borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                    }}>&#128196; Choose File</button>
                  </div>
                  {errors.dl_front && <div style={errorStyle}>{errors.dl_front}</div>}
                </div>
              )}
            </div>

            {/* DL Back */}
            <div style={fieldGroup}>
              <label style={labelStyle}>Driver's License — Back *</label>
              {form.documents.find(d => d.type === 'dl_back') ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px', background: 'var(--bg-primary)', borderRadius: '8px' }}>
                  {form.documents.find(d => d.type === 'dl_back').isPDF
                    ? <div style={{ width: '80px', height: '50px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--border-light)', borderRadius: '6px', fontSize: '22px' }}>&#128196;</div>
                    : <img src={form.documents.find(d => d.type === 'dl_back').preview}
                        style={{ width: '80px', height: '50px', objectFit: 'cover', borderRadius: '6px' }} />}
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary)', flex: 1 }}>{form.documents.find(d => d.type === 'dl_back').fileName}</span>
                  <button onClick={() => removeDocument('dl_back')} style={{
                    background: 'var(--bg-error-light)', border: '1px solid #fdd', borderRadius: '6px',
                    padding: '4px 10px', fontSize: '12px', cursor: 'pointer', color: 'var(--color-red-strong)',
                  }}>Remove</button>
                </div>
              ) : (
                <div>
                  <input type="file" accept="image/*" capture="environment" id="dl_back_camera" style={{ display: 'none' }}
                    onChange={(e) => handleFileSelect('dl_back', e)} />
                  <input type="file" accept="image/*,application/pdf" id="dl_back_gallery" style={{ display: 'none' }}
                    onChange={(e) => handleFileSelect('dl_back', e)} />
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button type="button" onClick={() => document.getElementById('dl_back_camera').click()} style={{
                      flex: 1, padding: '14px 12px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none',
                      borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                    }}>&#128247; Take Photo</button>
                    <button type="button" onClick={() => document.getElementById('dl_back_gallery').click()} style={{
                      flex: 1, padding: '14px 12px', background: 'var(--bg-surface)', color: 'var(--role-color)', border: '2px solid #1b6b5a',
                      borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                    }}>&#128196; Choose File</button>
                  </div>
                  {errors.dl_back && <div style={errorStyle}>{errors.dl_back}</div>}
                </div>
              )}
            </div>

            {/* Certification Documents */}
            <div style={fieldGroup}>
              <label style={labelStyle}>Certification Documents (Optional)</label>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 8px' }}>
                Upload photos or PDFs of your certificates (CNA, CPR, etc.)
              </p>
              {form.documents.filter(d => d.type === 'certification').map((doc, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '12px', padding: '10px',
                  background: 'var(--bg-primary)', borderRadius: '8px', marginBottom: '8px',
                }}>
                  {doc.isPDF
                    ? <div style={{ width: '60px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--border-light)', borderRadius: '4px', fontSize: '20px' }}>&#128196;</div>
                    : <img src={doc.preview} style={{ width: '60px', height: '40px', objectFit: 'cover', borderRadius: '4px' }} />}
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary)', flex: 1 }}>{doc.fileName}</span>
                  <button onClick={() => {
                    setForm(f => ({ ...f, documents: f.documents.filter((d, idx) => !(d.type === 'certification' && idx === f.documents.indexOf(doc))) }));
                  }} style={{
                    background: 'var(--bg-error-light)', border: '1px solid #fdd', borderRadius: '6px',
                    padding: '4px 10px', fontSize: '12px', cursor: 'pointer', color: 'var(--color-red-strong)',
                  }}>Remove</button>
                </div>
              ))}
              <input type="file" accept="image/*,application/pdf" onChange={async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                if (file.size > 10 * 1024 * 1024) return;
                const isPDF = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
                if (isPDF) {
                  setForm(f => ({
                    ...f,
                    documents: [...f.documents, { type: 'certification', file, preview: null, fileName: file.name, isPDF: true }],
                  }));
                } else {
                  const { dataUrl, blob } = await resizeImage(file);
                  const resizedFile = new File([blob], file.name, { type: blob.type || file.type });
                  setForm(f => ({
                    ...f,
                    documents: [...f.documents, { type: 'certification', file: resizedFile, preview: dataUrl, fileName: file.name }],
                  }));
                }
                e.target.value = '';
              }} style={{ fontSize: '14px' }} />
            </div>

            {errors.submit && <div style={{ ...errorStyle, marginBottom: '12px' }}>{errors.submit}</div>}
            <div style={{ display: 'flex', gap: '10px' }}>
              {backBtn(6)}
              {nextBtn(handleUploadDocuments, 'Upload & Continue')}
            </div>
          </div>
        )}

        {/* ─── Step 8: Identity Verification (Selfie + ID) ─── */}
        {step === 8 && (
          <div className="card" style={{ padding: '24px' }}>
            <h2 style={{ fontSize: '18px', color: 'var(--text-primary)', marginTop: 0, marginBottom: '4px' }}>&#128247; A photo of your licence</h2>
            <p style={{ color: 'var(--text-tertiary)', fontSize: '13px', marginTop: 0, marginBottom: '12px' }}>
              A selfie and a photo of your government-issued ID. We{'\u2019'}ll review it and reach out if we have any questions.
            </p>
            <div style={{ padding: '10px 14px', background: '#fff8e1', borderRadius: '8px', marginBottom: '20px', border: '1px solid #ffe0b2' }}>
              <p style={{ fontSize: '12px', color: 'var(--text-brown)', margin: 0, lineHeight: '1.5' }}>
                &#128274; Your photos are stored securely and only visible to InPlace administrators for verification purposes.
              </p>
            </div>

            {errors.identity && <div style={{ padding: '8px 12px', background: 'var(--color-error-bg)', color: 'var(--color-error)', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{errors.identity}</div>}

            {/* Camera viewfinder (shared for selfie and ID) */}
            {cameraStream && (
              <div style={{ marginBottom: 16, textAlign: 'center' }}>
                <div style={{ position: 'relative', display: 'inline-block', borderRadius: 12, overflow: 'hidden', border: '3px solid var(--role-color)' }}>
                  <video ref={idVideoRef} autoPlay playsInline muted style={{ width: '100%', maxWidth: 400, transform: cameraMode === 'selfie' ? 'scaleX(-1)' : 'none' }} />
                </div>
                <canvas ref={idCanvasRef} style={{ display: 'none' }} />
                <div style={{ marginTop: 10, display: 'flex', gap: 10, justifyContent: 'center' }}>
                  <button onClick={captureIdPhoto} style={{ padding: '12px 24px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
                    &#128248; Capture
                  </button>
                  <button onClick={stopIdCamera} style={{ padding: '12px 18px', background: 'var(--badge-muted-bg)', color: 'var(--text-secondary)', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, cursor: 'pointer' }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Selfie Section */}
            {!cameraStream && (
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Selfie *</label>
                {idSelfie ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, background: 'var(--bg-primary)', borderRadius: 8 }}>
                    <img src={idSelfie} style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: '50%' }} />
                    <span style={{ fontSize: 13, color: 'var(--color-success)', fontWeight: 600, flex: 1 }}>&#9989; Selfie captured</span>
                    <button onClick={() => setIdSelfie(null)} style={{ background: 'var(--bg-error-light)', border: '1px solid #fdd', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', color: 'var(--color-red-strong)' }}>Retake</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={() => startIdCamera('selfie')} style={{ flex: 1, padding: '14px 12px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                      &#128247; Take Selfie
                    </button>
                    <label style={{ flex: 1, padding: '14px 12px', background: 'var(--bg-surface)', color: 'var(--role-color)', border: '2px solid #1b6b5a', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', textAlign: 'center' }}>
                      &#128196; Upload Photo
                      <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleIdFileUpload('selfie', e)} />
                    </label>
                  </div>
                )}
              </div>
            )}

            {/* ID Photo Section */}
            {!cameraStream && (
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Government ID Photo *</label>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 8px' }}>Driver's license, state ID, or passport — make sure the photo and text are clearly readable.</p>
                {idPhoto ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, background: 'var(--bg-primary)', borderRadius: 8 }}>
                    <img src={idPhoto} style={{ width: 100, height: 65, objectFit: 'cover', borderRadius: 6 }} />
                    <span style={{ fontSize: 13, color: 'var(--color-success)', fontWeight: 600, flex: 1 }}>&#9989; ID photo captured</span>
                    <button onClick={() => setIdPhoto(null)} style={{ background: 'var(--bg-error-light)', border: '1px solid #fdd', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', color: 'var(--color-red-strong)' }}>Retake</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={() => startIdCamera('id')} style={{ flex: 1, padding: '14px 12px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                      &#128247; Take Photo
                    </button>
                    <label style={{ flex: 1, padding: '14px 12px', background: 'var(--bg-surface)', color: 'var(--role-color)', border: '2px solid #1b6b5a', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', textAlign: 'center' }}>
                      &#128196; Upload Photo
                      <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleIdFileUpload('id', e)} />
                    </label>
                  </div>
                )}
              </div>
            )}

            {/* Verify Result */}
            {idVerifyResult && (
              // v1.105.116 \u2014 Pete's words. She has just photographed her own face and her
              // own licence, which is the most exposed moment in the whole signup, and the
              // screen used to answer it with either a green "Identity verified!" (untrue since
              // v1.105.112 \u2014 only a person writes 'approved') or an amber "Submitted for
              // admin review", which reads like a hold-up. Neither is what you say to someone
              // who just did the hard part.
              //
              // ONE message, deliberately, whatever the automated checks thought. `matched` is
              // the recommendation that v1.105.112 established nothing gates on; letting it
              // change what she reads would put an AI verdict back in front of her by the
              // back door, in the one place she is least able to argue with it.
              //
              // It advances to the handoff after 1.5s, so "Let's continue" is literal.
              <div style={{
                padding: 14, borderRadius: 8, marginBottom: 16,
                background: 'var(--bg-highlight)', border: '1px solid #d4ede8',
              }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--role-color)', marginBottom: 4 }}>
                  Looking good{form.firstName ? ', ' + form.firstName : ''}!
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Verification doesn{'\u2019'}t take long. Let{'\u2019'}s continue.
                </div>
              </div>
            )}

            {/* Buttons */}
            {!cameraStream && !idVerifyResult && (
              <div style={{ display: 'flex', gap: 10 }}>
                {backBtn(7)}
                <button onClick={handleVerifyIdentity}
                  disabled={!idSelfie || !idPhoto || idVerifying}
                  style={{
                    flex: 1, padding: '14px', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 600, cursor: idSelfie && idPhoto && !idVerifying ? 'pointer' : 'not-allowed',
                    background: idSelfie && idPhoto && !idVerifying ? 'var(--role-color)' : 'var(--border-light)',
                    color: 'var(--text-on-primary)',
                  }}>
                  {idVerifying ? '&#9203; Verifying...' : 'Verify & Continue'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ─── Step 9: Review & Complete ─── */}
        {step === 9 && (() => {
          // The same route the header has been drawing all along, so the list she reads here
          // and the list she meets on the dashboard cannot drift apart.
          const handoff = resolveRoute({
            surface: 'wizard', step,
            identity: { submitted: !!idVerifyResult },
            stripe: { status: 'none' }, backgroundCheck: {},
          });
          return (
          <div className="card" style={{ padding: '24px' }}>
            {/* v1.105.115 \u2014 this was a finish line placed in the middle of the route.
                Confetti, "Welcome to InPlace!", and then a second list of seven things she had
                never been told about, waiting on the other side of the button. That single
                screen is most of the "when does this ever end?" feeling: it is the moment the
                quest reveals a second act. It is a handoff now \u2014 it names what is left,
                by name, before she gets there. */}
            <div style={{ marginBottom: '20px' }}>
              <h2 style={{ fontSize: '20px', color: 'var(--role-color)', margin: '0 0 8px' }}>
                That{'\u2019'}s the long part done{form.firstName ? ', ' + form.firstName : ''}.
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '15px', margin: 0, lineHeight: '1.5' }}>
                Your profile is set up and your documents are in.
                {handoff.waiting > 0 && ' Your ID is with us \u2014 we\u2019ll review it and reach out if we have any questions.'}
              </p>
            </div>

            {/* What is left, named. Property 4: nothing appears after she starts, so the list
                she meets on the dashboard is the list she reads here. */}
            <div style={{ background: 'var(--bg-primary)', borderRadius: '8px', padding: '16px', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '14px', color: 'var(--text-primary)', margin: '0 0 4px' }}>
                {handoff.remaining === 1
                  ? 'One thing left, on your dashboard'
                  : handoff.remaining + ' things left, all on your dashboard'}
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', margin: '0 0 12px' }}>
                In this order {'\u2014'} each one takes a few minutes.
              </p>
              {handoff.legs.filter((leg) => leg.surface === 'hub').map((leg) => (
                leg.items.map((item) => (
                  <div key={item.id} style={{
                    display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '8px',
                    fontSize: '14px', lineHeight: '1.4',
                    color: item.state === 'done' ? 'var(--text-tertiary)' : 'var(--text-primary)',
                  }}>
                    <span style={{
                      width: '18px', height: '18px', borderRadius: '50%', flexShrink: 0, marginTop: '1px',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '10px', fontWeight: 700,
                      background: item.state === 'done' ? 'var(--color-success)' : 'transparent',
                      color: item.state === 'done' ? 'var(--text-on-primary)' : 'var(--text-tertiary)',
                      border: item.state === 'done' ? 'none' : '2px solid var(--border-color)',
                    }}>{item.state === 'done' ? '\u2713' : ''}</span>
                    <span>{item.label}</span>
                  </div>
                ))
              ))}
            </div>

            {/* Summary */}
            <div style={{ background: 'var(--bg-primary)', borderRadius: '8px', padding: '16px', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '14px', color: 'var(--role-color)', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Profile Summary</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '13px' }}>
                <div><span style={{ color: 'var(--text-tertiary)' }}>Name:</span> {form.firstName} {form.lastName}</div>
                <div><span style={{ color: 'var(--text-tertiary)' }}>Phone:</span> {formatPhone(form.phone)}</div>
                <div><span style={{ color: 'var(--text-tertiary)' }}>Location:</span> {form.city}, {form.state} {form.zip}</div>
                <div><span style={{ color: 'var(--text-tertiary)' }}>Rates:</span> Set from your dashboard</div>
                <div><span style={{ color: 'var(--text-tertiary)' }}>Caretaking experience:</span> {form.yearsExperience || 0} years</div>
                <div><span style={{ color: 'var(--text-tertiary)' }}>Certifications:</span> {form.certifications.filter(c => c.certType).map(c => c.certType).join(', ') || 'None'}</div>
                <div><span style={{ color: 'var(--text-tertiary)' }}>Documents:</span> {form.documents.length} uploaded</div>
                {/* v1.105.112 — the AI no longer approves anything, so this can no longer say
                    "Verified" the moment the checks agree. It says what is true: it is with us. */}
                <div><span style={{ color: 'var(--text-tertiary)' }}>ID:</span> {idVerifyResult ? 'Sent \u2014 we\u2019ll review it' : 'Not sent yet'}</div>
                <div><span style={{ color: 'var(--text-tertiary)' }}>Travel radius:</span> {form.travelRadius} miles</div>
                {form.comfortableWithPets !== null && (
                  <div><span style={{ color: 'var(--text-tertiary)' }}>Pets:</span> {form.comfortableWithPets ? 'Comfortable' : 'Prefer pet-free'}</div>
                )}
                {form.petAllergies && <div><span style={{ color: 'var(--text-tertiary)' }}>Pet allergies:</span> {form.petAllergies}</div>}
                {form.foodAllergies && <div><span style={{ color: 'var(--text-tertiary)' }}>Food allergies:</span> {form.foodAllergies}</div>}
                {form.medicalConditions && <div><span style={{ color: 'var(--text-tertiary)' }}>Medical:</span> {form.medicalConditions}</div>}
                {form.needsProgramReports && (
                  <div style={{ gridColumn: '1 / -1' }}><span style={{ color: 'var(--text-tertiary)' }}>Program:</span> {form.programName === 'radford_nursing' ? 'Radford University Nursing' : form.programName === 'nrcc_nurse_aide' ? 'NRCC Nurse Aide' : form.programNameOther || '—'} ({form.programYear})</div>
                )}
              </div>
            </div>

            <div style={{ padding: '14px', background: 'var(--color-success-bg)', borderRadius: '8px', marginBottom: '16px', border: '1px solid #c8e6c9' }}>
              <p style={{ fontSize: '13px', color: 'var(--color-success)', margin: 0, lineHeight: '1.5' }}>
                As an independent contractor (1099), you set your own schedule, rates, and choose which care requests to accept.
                InPlace connects you with families — you're your own boss.
              </p>
            </div>

            <button onClick={handleComplete} style={{
              width: '100%', padding: '14px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none',
              borderRadius: '8px', fontSize: '16px', fontWeight: 600, cursor: 'pointer',
            }}>Go to My Dashboard</button>
          </div>
          );
        })()}
        {/* What is left \u2014 below the form, quiet, and never prefixed. Pete: no "then" leading
            each line. */}
        {step < TOTAL_STEPS && <OnboardingPath slot="ahead" step={step} idSubmitted={!!idVerifyResult} />}
      </div>
    </div>
  );
};
