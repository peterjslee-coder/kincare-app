// ─── Delete Account Section ───
const DeleteAccountSection = ({ onDeleted }) => {
  const [step, setStep] = useState('idle'); // idle → reason → confirm → goodbye
  const [reason, setReason] = useState('');
  const [reasonDetail, setReasonDetail] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  const EXIT_REASONS = [
    { value: 'no_longer_needed', label: 'I no longer need care services' },
    { value: 'found_alternative', label: 'I found another service' },
    { value: 'too_complicated', label: 'The platform was too complicated' },
    { value: 'not_enough_caregivers', label: 'Not enough caregivers in my area' },
    { value: 'too_expensive', label: 'Too expensive' },
    { value: 'privacy_concerns', label: 'Privacy concerns' },
    { value: 'other', label: 'Other reason' },
  ];

  const handleDelete = async () => {
    if (confirmText !== 'DELETE') return;
    setDeleting(true);
    setError(null);
    try {
      const res = await apiFetch('/api/auth/me', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, reasonDetail: reason === 'other' ? reasonDetail : undefined }),
      });
      if (res?.ok) {
        setStep('goodbye');
        setTimeout(() => onDeleted(), 4000);
      } else {
        const data = await res?.json();
        setError(data?.error || 'Failed to delete account');
      }
    } catch (err) {
      setError('Network error — please try again');
    }
    setDeleting(false);
  };

  const reset = () => { setStep('idle'); setReason(''); setReasonDetail(''); setConfirmText(''); setError(null); };

  if (step === 'goodbye') {
    return (
      <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid #e0e0e0' }}>
        <div style={{ padding: '24px', background: 'var(--bg-highlight)', borderRadius: '12px', border: '1px solid #d0e8e0', textAlign: 'center' }}>
          <div style={{ fontSize: '28px', marginBottom: '12px' }}>{'We\'re sorry to see you go'}</div>
          <p style={{ fontSize: '15px', color: 'var(--text-secondary)', margin: '0 0 8px', lineHeight: '1.6' }}>
            Your account has been deleted. Thank you for being part of InPlace.
          </p>
          <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', margin: 0 }}>
            You will be logged out shortly...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid #fdd' }}>
      {step === 'idle' && (
        <button onClick={() => setStep('reason')} style={{
          width: '100%', padding: '12px 20px', background: 'var(--bg-surface)', color: 'var(--text-muted)',
          border: '1px solid #e0e0e0', borderRadius: 10, fontSize: 13, fontWeight: 500,
          cursor: 'pointer',
        }}>
          Delete My Account
        </button>
      )}

      {step === 'reason' && (
        <div style={{ padding: '16px', background: 'var(--bg-error-light)', borderRadius: '10px', border: '1px solid #fdd' }}>
          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-error)', marginBottom: '4px' }}>
            We're sorry to see you go
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 14px', lineHeight: '1.5' }}>
            Before you go, would you mind telling us why? This helps us improve InPlace for everyone.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
            {EXIT_REASONS.map(r => (
              <label key={r.value} style={{
                display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px',
                background: reason === r.value ? '#fef0ed' : 'var(--bg-card)', borderRadius: '6px',
                border: reason === r.value ? '1px solid #e8724a' : '1px solid #eee',
                cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)', transition: 'all 0.15s',
              }}>
                <input type="radio" name="exit-reason" value={r.value}
                  checked={reason === r.value} onChange={() => setReason(r.value)}
                  style={{ accentColor: 'var(--accent-color)' }} />
                {r.label}
              </label>
            ))}
          </div>
          {reason === 'other' && (
            <textarea value={reasonDetail} onChange={(e) => setReasonDetail(e.target.value)}
              placeholder="Please tell us more..." rows={3}
              style={{
                width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: '6px',
                fontSize: '13px', marginBottom: '12px', boxSizing: 'border-box', resize: 'vertical',
                fontFamily: 'inherit',
              }} />
          )}
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={reset} style={{
              flex: 1, padding: '10px', background: 'var(--badge-muted-bg)', color: 'var(--text-secondary)', border: 'none',
              borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            }}>Cancel</button>
            <button onClick={() => setStep('confirm')} disabled={!reason} style={{
              flex: 1, padding: '10px', background: reason ? 'var(--color-error)' : 'var(--border-light)',
              color: 'var(--text-on-primary)', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
              cursor: reason ? 'pointer' : 'not-allowed',
            }}>Continue</button>
          </div>
        </div>
      )}

      {step === 'confirm' && (
        <div style={{ padding: '16px', background: 'var(--bg-error-light)', borderRadius: '10px', border: '1px solid #fdd' }}>
          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-error)', marginBottom: '8px' }}>
            Confirm Account Deletion
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: '1.5' }}>
            This action cannot be undone. Your profile and personal data will be removed, though some records may be retained for legal and safety purposes.
          </p>
          <p style={{ fontSize: '13px', color: 'var(--text-primary)', margin: '0 0 8px', fontWeight: 500 }}>
            Type <strong>DELETE</strong> to confirm:
          </p>
          <input type="text" value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type DELETE" style={{
              width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: '6px',
              fontSize: '14px', marginBottom: '12px', boxSizing: 'border-box',
            }} />
          {error && <div style={{ fontSize: '13px', color: 'var(--color-error)', marginBottom: '10px' }}>{error}</div>}
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => setStep('reason')} style={{
              flex: 1, padding: '10px', background: 'var(--badge-muted-bg)', color: 'var(--text-secondary)', border: 'none',
              borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            }}>Back</button>
            <button onClick={handleDelete} disabled={confirmText !== 'DELETE' || deleting} style={{
              flex: 1, padding: '10px', background: confirmText === 'DELETE' ? 'var(--color-error)' : 'var(--border-light)',
              color: 'var(--text-on-primary)', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
              cursor: confirmText === 'DELETE' ? 'pointer' : 'not-allowed',
              opacity: deleting ? 0.6 : 1,
            }}>{deleting ? 'Deleting...' : 'Delete My Account'}</button>
          </div>
        </div>
      )}
    </div>
  );
};

const MyAccount = window.MyAccount = ({ setCurrentUser, onNavigate }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editData, setEditData] = useState({});
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = useRef(null);
  const [activeTab, setActiveTab] = useState(() => {
    if (window.__accountTab) { const t = window.__accountTab; delete window.__accountTab; return t; }
    return 'profile';
  });
  const [postOnboarding, setPostOnboarding] = useState(() => {
    if (window.__postOnboarding) { delete window.__postOnboarding; return true; }
    return false;
  });
  const [currentTheme, setCurrentTheme] = useState(() => {
    try { return localStorage.getItem('inplace-theme') || 'light'; } catch { return 'light'; }
  });
  const [notifications, setNotifications] = useState({
    sessionUpdates: true, caregiverMessages: true, healthAlerts: true, reminderEmails: false,
    push_messages: true, push_care_request: true, push_care_request_accepted: true, push_session_status: true
  });
  const [savingNotifs, setSavingNotifs] = useState(false);
  const { showToast } = useToast();

  // Security state
  const [twoFAStatus, setTwoFAStatus] = useState({ enabled: false, setupDate: null });
  const [showSetup2FA, setShowSetup2FA] = useState(false);
  const [disabling2FA, setDisabling2FA] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [devices, setDevices] = useState([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [linkedAccounts, setLinkedAccounts] = useState([]);

  // Password change state
  const [changingPassword, setChangingPassword] = useState(false);
  const [pwData, setPwData] = useState({ current: '', new: '', confirm: '' });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState(null);
  const [intlPhone, setIntlPhone] = useState(false);

  // Passkey state
  const [passkeys, setPasskeys] = useState([]);
  const [loadingPasskeys, setLoadingPasskeys] = useState(false);
  const [registeringPasskey, setRegisteringPasskey] = useState(false);
  const [passkeyName, setPasskeyName] = useState('');
  const [showPasskeyNameInput, setShowPasskeyNameInput] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(false);

  // Family - Identity & Payment status
  const [familyStripeStatus, setFamilyStripeStatus] = useState(null); // null | 'not_started' | 'pending' | 'complete'
  const [familyIdentityStatus, setFamilyIdentityStatus] = useState(null); // null | 'not_started' | 'pending' | 'verified' | 'rejected'

  // Identity verification inline flow
  const [idVerOpen, setIdVerOpen] = useState(false);
  const [idVerStep, setIdVerStep] = useState(1); // 1=selfie, 2=ID photo, 3=submitting
  const [idVerSelfie, setIdVerSelfie] = useState(null); // base64
  const [idVerIdPhoto, setIdVerIdPhoto] = useState(null); // base64
  const [idVerSubmitting, setIdVerSubmitting] = useState(false);
  const [idVerError, setIdVerError] = useState(null);
  const idVerSelfieRef = useRef(null);
  const idVerIdPhotoRef = useRef(null);

  // Caregiver - Payments state
  const [stripeStatus, setStripeStatus] = useState(null);
  // payoutPref/savingPayout removed — payout speed managed via Stripe dashboard
  const [bgCheckPaid, setBgCheckPaid] = useState(false);

  // Caregiver - Checkr Background Check state
  const [checkrStatus, setCheckrStatus] = useState(null); // null | 'not_initiated' | 'in_progress' | 'complete' | 'error'
  const [myVouches, setMyVouches] = useState([]); // v1.64.0: active admin vouches (per-family, not a bg check)
  const [checkrError, setCheckrError] = useState(null);
  const [checkrStaging, setCheckrStaging] = useState(false);
  const [checkrStagingEmail, setCheckrStagingEmail] = useState('');

  // Caregiver - Documents state
  const [documents, setDocuments] = useState([]);
  const [docUploading, setDocUploading] = useState(null);
  const acctDocInputRef = useRef(null);
  const [pendingAcctDocType, setPendingAcctDocType] = useState(null);
  const [docPreviews, setDocPreviews] = useState({});
  const [cgCertifications, setCgCertifications] = useState([]);

  // Caregiver - Care Preferences state
  const [preferences, setPreferences] = useState(null);
  const [savingPrefs, setSavingPrefs] = useState(false);
  // Caregiver - Rate editing state
  const [editRates, setEditRates] = useState({ daytime: '24', nighttime: '28', overnight: '30' });
  const [savingRates, setSavingRates] = useState(false);

  const fetchUser = async () => {
    try {
      const res = await apiFetch('/api/auth/me');
      if (res?.ok) {
        const data = await res.json();
        setUser(data.user);
        setLinkedAccounts(data.user.linkedAccounts || []);
        if (data.user.notification_prefs) {
          try {
            const prefs = typeof data.user.notification_prefs === 'string'
              ? JSON.parse(data.user.notification_prefs)
              : data.user.notification_prefs;
            setNotifications(prev => ({ ...prev, ...prefs }));
          } catch {}
        }
      }
    } catch (err) {
      console.error('Fetch user error:', err);
    }
    setLoading(false);
  };

  // Resize image client-side to max 400x400 JPEG so any photo works regardless of original size
  // Uses createImageBitmap first (handles HEIC, WEBP, AVIF on supported browsers), falls back to Image element
  const resizeImage = async (file, maxSize = 400, quality = 0.8) => {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      // Fallback to Image element for older browsers
      bitmap = await new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          const name = file.name?.toLowerCase() || '';
          if (name.endsWith('.heic') || name.endsWith('.heif')) {
            reject(new Error('HEIC photos are not supported by your browser. Please convert to JPG first, or use Safari.'));
          } else {
            reject(new Error('Could not load this image. Try a JPG or PNG file.'));
          }
        };
        img.src = url;
      });
    }
    const canvas = document.createElement('canvas');
    let w = bitmap.width, h = bitmap.height;
    if (w > h) { if (w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; } }
    else { if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize; } }
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    if (bitmap.close) bitmap.close(); // Free ImageBitmap memory
    return canvas.toDataURL('image/jpeg', quality);
  };

  // ─── Identity Verification Handlers ───
  const handleIdVerFileSelect = async (e, type) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('Please select an image file', 'error'); return; }
    try {
      const dataUrl = await resizeImage(file, 800, 0.85); // Larger for ID readability
      if (type === 'selfie') setIdVerSelfie(dataUrl);
      else setIdVerIdPhoto(dataUrl);
    } catch (err) {
      showToast(err.message || 'Could not load image', 'error');
    }
  };

  const handleIdVerSubmit = async () => {
    if (!idVerIdPhoto) { showToast('Please upload a photo of your ID', 'error'); return; }
    setIdVerSubmitting(true);
    setIdVerError(null);
    try {
      const res = await apiFetch('/api/self-onboarding/verify-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idPhoto: idVerIdPhoto, selfie: idVerSelfie || undefined }),
      });
      if (res?.ok) {
        const data = await res.json();
        if (data.matched && !data.needsHumanReview) {
          setFamilyIdentityStatus('verified');
          showToast('Identity verified!', 'success');
        } else {
          setFamilyIdentityStatus('pending');
          showToast('ID submitted for review.', 'info');
        }
        setIdVerOpen(false);
        // Refresh user data to get updated identityVerified flag
        fetchUser();
      } else {
        const err = await res?.json().catch(() => ({}));
        setIdVerError(err.error || 'Verification failed. Please try again.');
      }
    } catch (err) {
      setIdVerError('Network error. Please try again.');
    }
    setIdVerSubmitting(false);
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('Please select an image file', 'error'); return; }
    setUploadingPhoto(true);
    try {
      const dataUrl = await resizeImage(file);
      const res = await apiFetch('/api/auth/me/photo', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo: dataUrl }),
      });
      if (res?.ok) {
        setUser(prev => prev ? { ...prev, profile_photo: dataUrl, avatar_url: dataUrl } : prev);
        if (setCurrentUser) setCurrentUser(prev => prev ? { ...prev, profilePhoto: dataUrl } : prev);
        showToast('Profile photo updated!', 'success');
      } else {
        const data = await res?.json();
        showToast(data?.error || 'Failed to upload photo', 'error');
      }
    } catch (err) {
      console.error('Photo upload error:', err);
      showToast(err.message || 'Upload failed — try a JPG or PNG file', 'error');
    }
    setUploadingPhoto(false);
    if (photoInputRef.current) photoInputRef.current.value = '';
  };

  const removePhoto = async () => {
    try {
      const res = await apiFetch('/api/auth/me/photo', { method: 'DELETE' });
      if (res?.ok) {
        setUser(prev => prev ? { ...prev, profile_photo: null, avatar_url: null } : prev);
        if (setCurrentUser) setCurrentUser(prev => prev ? { ...prev, profilePhoto: null } : prev);
        showToast('Photo removed', 'success');
      }
    } catch (err) {
      showToast('Failed to remove photo', 'error');
    }
  };

  const fetch2FAStatus = async () => {
    try {
      const res = await apiFetch('/api/auth/2fa/status');
      if (res?.ok) {
        const data = await res.json();
        setTwoFAStatus(data);
      }
    } catch {}
  };

  const fetchDevices = async () => {
    setLoadingDevices(true);
    try {
      const res = await apiFetch('/api/auth/2fa/devices');
      if (res?.ok) {
        const data = await res.json();
        setDevices(data.devices || []);
      }
    } catch {}
    setLoadingDevices(false);
  };

  // ─── Passkey functions ───
  const fetchPasskeys = async () => {
    setLoadingPasskeys(true);
    try {
      const res = await apiFetch('/api/passkeys');
      if (res?.ok) {
        const data = await res.json();
        setPasskeys(data.passkeys || []);
      }
    } catch {}
    setLoadingPasskeys(false);
  };

  const handleRegisterPasskey = async () => {
    setRegisteringPasskey(true);
    setPwError(null);
    try {
      const SimpleWebAuthnBrowser = window.SimpleWebAuthnBrowser;
      if (!SimpleWebAuthnBrowser) throw new Error('Passkey support not loaded — ensure you are on a supported browser');

      // Step 1: Get registration options from server
      console.log('[Passkey] Requesting registration options...');
      const optRes = await apiFetch('/api/passkeys/register/options', { method: 'POST' });
      if (!optRes) throw new Error('Session expired — please sign in again and retry');
      if (!optRes.ok) {
        const errBody = await optRes.json().catch(() => ({}));
        throw new Error(errBody?.error || `Server error (${optRes.status}) — try again`);
      }
      const options = await optRes.json();
      console.log('[Passkey] Got options, rpId:', options.rp?.id, 'challenge length:', options.challenge?.length);

      // Step 2: Trigger browser passkey/biometric prompt
      console.log('[Passkey] Starting browser registration prompt...');
      const regResp = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON: options });
      console.log('[Passkey] Browser registration complete, sending to server for verification...');

      // Step 3: Send to server for verification
      const verifyRes = await apiFetch('/api/passkeys/register/verify', {
        method: 'POST',
        body: JSON.stringify({ ...regResp, passkeyName: passkeyName || 'My Passkey' }),
      });
      if (!verifyRes) throw new Error('Session expired during verification — please sign in again and retry');
      if (!verifyRes.ok) {
        const errData = await verifyRes.json().catch(() => ({}));
        console.error('[Passkey] Server verification failed:', errData);
        throw new Error(errData?.error || 'Passkey verification failed on server');
      }

      const result = await verifyRes.json();
      console.log('[Passkey] Registration verified!', result);
      showToast('Passkey registered! You can now sign in with biometrics.', 'success');
      setShowPasskeyNameInput(false);
      setPasskeyName('');
      fetchPasskeys();
    } catch (err) {
      console.error('[Passkey] Registration error:', err.name, err.message, err);
      if (err.name === 'InvalidStateError') {
        setPwError('You already have a passkey registered on this device. Remove it first if you want to re-register.');
      } else if (err.name === 'NotAllowedError') {
        // In a native app WebView, NotAllowedError usually means passkeys aren't
        // supported in this context (not that the user cancelled).
        // In Safari/Chrome, it typically means user cancelled the prompt.
        // NotAllowedError can mean "user cancelled" OR "not allowed in this context" (e.g. WKWebView without entitlement)
        const isNativeApp = window.Capacitor?.isNativePlatform?.();
        if (isNativeApp) {
          setPwError('Passkey creation failed. If this keeps happening, try opening yourinplace.com in Safari instead — the passkey will sync to this app automatically.');
        } else {
          console.log('[Passkey] NotAllowedError (user may have cancelled)');
        }
      } else {
        setPwError(err.message || 'Passkey registration failed');
        showToast('Passkey registration failed', 'error');
      }
    }
    setRegisteringPasskey(false);
  };

  const handleDeletePasskey = async (pkId) => {
    try {
      const res = await apiFetch('/api/passkeys/' + pkId, { method: 'DELETE' });
      if (res?.ok) {
        showToast('Passkey removed', 'success');
        fetchPasskeys();
      } else {
        // v1.105.37 — believing you removed a sign-in credential when you did not is worse
        // than most silent failures on this list.
        const d = await res?.json().catch(() => ({}));
        showToast((d && d.error) || 'Could not remove that passkey — please try again', 'error');
      }
    } catch { showToast('Could not remove that passkey — check your connection', 'error'); }
  };

  const handleRenamePasskey = async (pkId, newName) => {
    try {
      await apiFetch('/api/passkeys/' + pkId, {
        method: 'PUT',
        body: JSON.stringify({ name: newName }),
      });
      fetchPasskeys();
    } catch {}
  };

  useEffect(() => {
    fetchUser();
    fetch2FAStatus();
    fetchPasskeys(); // Always fetch — show existing passkeys even if WebAuthn unavailable
    // Passkey support check — PublicKeyCredential exists in WebViews but
    // create() may not work. We still show the UI but handle the error.
    if (window.PublicKeyCredential) {
      setPasskeySupported(true);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'settings' || activeTab === 'security' || activeTab === 'devices') fetchDevices();
    // Track security settings review — mark as reviewed when user visits the settings tab
    // Two triggers: (1) immediately after 3 seconds on the tab, (2) scroll to bottom
    if (activeTab === 'settings') {
      // Mark reviewed after spending 3 seconds on the settings tab (enough to glance at it)
      const timer = setTimeout(() => {
        localStorage.setItem('inplace_security_reviewed', '1');
      }, 3000);
      // Also mark on scroll to bottom (instant)
      const handleScroll = () => {
        const scrollBottom = window.innerHeight + window.scrollY;
        const docHeight = document.documentElement.scrollHeight;
        if (scrollBottom >= docHeight - 100) {
          localStorage.setItem('inplace_security_reviewed', '1');
          window.removeEventListener('scroll', handleScroll);
        }
      };
      window.addEventListener('scroll', handleScroll);
      return () => {
        clearTimeout(timer);
        window.removeEventListener('scroll', handleScroll);
      };
    }
  }, [activeTab]);

  // Listen for external tab switch requests (e.g., from First Steps click)
  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.tab) setActiveTab(e.detail.tab);
    };
    window.addEventListener('accountTabSwitch', handler);
    return () => window.removeEventListener('accountTabSwitch', handler);
  }, []);

  // Fetch family Stripe Connect + identity status on profile tab
  useEffect(() => {
    if (activeTab !== 'profile') return;
    apiFetch('/api/payments/family/status').then(async r => {
      if (r?.ok) { const d = await r.json(); setFamilyStripeStatus(d.status || 'not_started'); }
      else setFamilyStripeStatus('not_started');
    }).catch(() => setFamilyStripeStatus('not_started'));
    // Identity verification status — from /api/auth/me user object
    if (user?.identityStatus) setFamilyIdentityStatus(user.identityStatus);
    else setFamilyIdentityStatus('not_started');
  }, [activeTab]);

  // Fetch caregiver financial data
  useEffect(() => {
    if (activeTab === 'payments') {
      apiFetch('/api/payments/connect/status').then(async r => {
        if (r?.ok) { const d = await r.json(); setStripeStatus(d); }
      }).catch(() => {});
      // Payout speed is managed directly through Stripe dashboard — no platform endpoint needed
      apiFetch('/api/dashboard').then(async r => {
        if (r?.ok) { const d = await r.json(); setBgCheckPaid(!!d.backgroundCheckPaid); }
      }).catch(() => {});
      // Fetch Checkr status
      apiFetch('/api/checkr/status').then(async r => {
        if (r?.ok) { const d = await r.json(); setCheckrStatus(d.status || 'not_initiated'); setCheckrStaging(!!d.staging); if (d.paid) setBgCheckPaid(true); setMyVouches(d.vouches || []); }
      }).catch(() => { setCheckrStatus('not_initiated'); });
      apiFetch('/api/caregivers/me').then(async r => {
        if (r?.ok) { const d = await r.json(); setEditRates({ daytime: d.profile?.rate_daytime || '24', nighttime: d.profile?.rate_nighttime || '28', overnight: d.profile?.rate_overnight || '30' }); }
      }).catch(() => {});
    }
  }, [activeTab]);

  // Fetch caregiver documents + certifications for expiry warnings, auto-load thumbnails
  useEffect(() => {
    if (activeTab === 'documents') {
      apiFetch('/api/caregiver-onboarding/documents').then(async r => {
        if (r?.ok) {
          const d = await r.json();
          const docs = d.documents || [];
          setDocuments(docs);
          // Auto-load thumbnails for all docs
          docs.forEach(doc => {
            if (!docPreviews[doc.id]) {
              apiFetch(`/api/caregiver-onboarding/documents/${doc.id}/image`).then(async ir => {
                if (ir?.ok) { const id = await ir.json(); setDocPreviews(p => ({...p, [doc.id]: id.fileData})); }
              }).catch(() => {});
            }
          });
        }
      }).catch(() => {});
      apiFetch('/api/caregivers/me').then(async r => {
        if (r?.ok) { const d = await r.json();
          // v1.104.7 — coerce to array: older/other API shapes may hand back a
          // JSON string or object; a non-array here white-screened the docs view.
          let certs = d.profile?.certifications;
          if (typeof certs === 'string') { try { certs = JSON.parse(certs); } catch { certs = []; } }
          setCgCertifications(Array.isArray(certs) ? certs : []);
        }
      }).catch(() => {});
    }
  }, [activeTab]);

  // Fetch caregiver care preferences (try care_preferences first, fall back to care_stoplight)
  useEffect(() => {
    if (activeTab === 'preferences') {
      apiFetch('/api/caregivers/me').then(async r => {
        if (r?.ok) {
          const d = await r.json();
          const raw = d.profile?.care_preferences || d.profile?.care_stoplight;
          if (raw) {
            try { setPreferences(typeof raw === 'string' ? JSON.parse(raw) : raw); } catch { setPreferences({}); }
          } else { setPreferences({}); }
        }
        else { setPreferences({}); }
      }).catch(() => { setPreferences({}); });
    }
  }, [activeTab]);

  const roleLabels = { family: 'Family Member', caregiver: 'Caregiver', care_for: 'Care Recipient' };

  const startEditing = () => {
    const isIntl = user?.phone && /^\+/.test(user.phone);
    setIntlPhone(isIntl);
    setEditData({
      firstName: user?.first_name || '',
      lastName: user?.last_name || '',
      phone: isIntl ? user.phone : formatPhone(user?.phone),
      pets: user?.pets || '',
      petAllergies: user?.pet_allergies || '',
      foodAllergies: user?.food_allergies || '',
      medicalConditions: user?.medical_conditions || '',
      addressLine1: user?.address_line1 || '',
      addressLine2: user?.address_line2 || '',
      city: user?.city || '',
      state: user?.state || '',
      zip: user?.zip || '',
    });
    setEditing(true);
  };

  const cancelEditing = () => setEditing(false);

  const saveProfile = async () => {
    setSaving(true);
    try {
      const res = await apiFetch('/api/auth/me', {
        method: 'PUT',
        body: JSON.stringify({
          firstName: editData.firstName,
          lastName: editData.lastName,
          phone: editData.phone ? (intlPhone ? editData.phone.replace(/[^\d\+]/g, '') : editData.phone.replace(/\D/g, '')) : null,
          pets: editData.pets,
          petAllergies: editData.petAllergies,
          foodAllergies: editData.foodAllergies,
          medicalConditions: editData.medicalConditions,
          addressLine1: editData.addressLine1,
          addressLine2: editData.addressLine2,
          city: editData.city,
          state: editData.state,
          zip: editData.zip,
        }),
      });
      if (res?.ok) {
        const data = await res.json();
        // v1.74.5 — MERGE, don't replace: if the server response ever omits a field
        // (profile_photo did), replacing wiped it from the UI ("saving my address
        // deleted my photo"). The DB was never touched — display-only loss.
        setUser(prev => ({ ...(prev || {}), ...data.user }));
        setEditing(false);
        showToast('Profile updated', 'success');
      } else {
        showToast('Error saving profile', 'error');
      }
    } catch (err) {
      showToast('Error saving profile', 'error');
    }
    setSaving(false);
  };

  const handleNotificationChange = async (key, value) => {
    const newNotifs = { ...notifications, [key]: value };
    setNotifications(newNotifs);
    setSavingNotifs(true);
    try {
      const res = await apiFetch('/api/auth/me', {
        method: 'PUT',
        body: JSON.stringify({ notificationPrefs: newNotifs }),
      });
      if (res?.ok) showToast('Notification preferences saved', 'success');
    } catch {}
    setSavingNotifs(false);
  };

  const handleDisable2FA = async (e) => {
    e.preventDefault();
    setDisabling2FA(true);
    setPwError(null);
    try {
      const res = await apiFetch('/api/auth/2fa/disable', {
        method: 'POST',
        body: JSON.stringify({ code: disableCode })
      });
      if (!res?.ok) {
        const data = await res?.json();
        throw new Error(data?.error || 'Failed to disable 2FA');
      }
      setTwoFAStatus({ enabled: false, setupDate: null });
      setDisableCode('');
      setDevices([]);
      showToast('Two-factor authentication disabled', 'success');
    } catch (err) {
      setPwError(err.message);
    }
    setDisabling2FA(false);
  };

  const revokeDevice = async (deviceId) => {
    try {
      const res = await apiFetch(`/api/auth/2fa/devices/${deviceId}`, { method: 'DELETE' });
      if (res?.ok) {
        setDevices(prev => prev.filter(d => d.id !== deviceId));
        showToast('Device revoked', 'success');
      }
    } catch {
      showToast('Error revoking device', 'error');
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (pwData.new !== pwData.confirm) { setPwError('Passwords do not match'); return; }
    setPwSaving(true);
    setPwError(null);
    try {
      const res = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: pwData.current, newPassword: pwData.new })
      });
      if (!res?.ok) {
        const data = await res?.json();
        throw new Error(data?.error || 'Password change failed');
      }
      setPwData({ current: '', new: '', confirm: '' });
      setChangingPassword(false);
      showToast('Password changed successfully', 'success');
    } catch (err) {
      setPwError(err.message);
    }
    setPwSaving(false);
  };

  // Caregiver - Payments handlers
  const handleConnectStripe = async () => {
    try {
      const res = await apiFetch('/api/payments/connect/link', { method: 'POST' });
      if (res?.ok) {
        const data = await res.json();
        if (data.url) {
          window.location.href = data.url;
        }
      } else {
        const err = await res?.json().catch(() => ({}));
        showToast(err?.error || 'Failed to start Stripe setup', 'error');
      }
    } catch (err) {
      showToast('Failed to start Stripe setup', 'error');
    }
  };

  const handleStripeDashboard = async () => {
    try {
      const res = await apiFetch('/api/payments/connect/dashboard');
      if (res?.ok) {
        const data = await res.json();
        if (data.url) {
          window.open(data.url, '_blank');
        }
      } else {
        const err = await res?.json().catch(() => ({}));
        showToast(err?.error || 'Failed to open Stripe dashboard', 'error');
      }
    } catch (err) {
      showToast('Failed to open Stripe dashboard', 'error');
    }
  };

  // Payout speed is managed directly through Stripe Express dashboard

  // Caregiver - Documents handlers
  const handleDocumentUpload = async (docType) => {
    let file = acctDocInputRef.current?.files?.[0];
    if (!file) return;

    setDocUploading(docType);
    try {
      // v1.104.0 — auto-downscale images (non-images pass through untouched)
      file = await window.downscaleImageFile(file);
      const formData = new FormData();
      formData.append('documents', file);
      formData.append('types', JSON.stringify([docType]));
      formData.append('metadata', JSON.stringify([{}]));
      const token = window.AUTH_TOKEN;
      const _csrf = typeof getCsrfToken === 'function' ? getCsrfToken() : (window.getCsrfToken ? window.getCsrfToken() : null);
      const _hdrs = {};
      if (token) _hdrs['Authorization'] = `Bearer ${token}`;
      if (_csrf) _hdrs['X-CSRF-Token'] = _csrf;
      const res = await fetch('/api/caregiver-onboarding/documents', {
        method: 'POST',
        credentials: 'same-origin',
        headers: _hdrs,
        body: formData,
      });
      if (res.ok) {
        showToast('Document uploaded successfully', 'success');
        const updated = await apiFetch('/api/caregiver-onboarding/documents');
        if (updated?.ok) {
          const d = await updated.json();
          setDocuments(d.documents || []);
        }
      } else {
        const d = await res.json().catch(() => ({}));
        showToast(d.error || 'Upload failed', 'error');
      }
    } catch (err) {
      showToast('Failed to upload document', 'error');
    }
    setDocUploading(null);
    if (acctDocInputRef.current) acctDocInputRef.current.value = '';
  };

  // Caregiver - Rate save handler
  const handleSaveRates = async () => {
    if (!editRates) return;
    setSavingRates(true);
    try {
      const res = await apiFetch('/api/caregivers/me', {
        method: 'PUT',
        body: JSON.stringify({ rateDaytime: editRates.daytime, rateNighttime: editRates.nighttime, rateOvernight: editRates.overnight })
      });
      if (res?.ok) { showToast('Rates updated', 'success'); setEditRates(null); }
    } catch (err) { showToast('Failed to save rates', 'error'); }
    setSavingRates(false);
  };

  // Caregiver - Document preview handler
  const handleViewDocument = async (docId) => {
    if (docPreviews[docId]) { setDocPreviews(p => { const n = {...p}; delete n[docId]; return n; }); return; }
    try {
      const r = await apiFetch(`/api/caregiver-onboarding/documents/${docId}/image`);
      if (r?.ok) { const d = await r.json(); setDocPreviews(p => ({...p, [docId]: d.fileData})); }
    } catch (err) { showToast('Failed to load document', 'error'); }
  };

  // Caregiver - Care Preferences handler
  const handleSavePreferences = async () => {
    setSavingPrefs(true);
    try {
      const res = await apiFetch('/api/caregivers/me', {
        method: 'PUT',
        body: JSON.stringify({ care_preferences: JSON.stringify(preferences) })
      });
      if (res?.ok) {
        const data = await res.json();
        // Update from response if available
        if (data.profile?.care_preferences) {
          try { setPreferences(JSON.parse(data.profile.care_preferences)); } catch {}
        }
        showToast('Care preferences saved!', 'success');
      } else {
        const errData = await res?.json().catch(() => ({}));
        showToast(errData?.error || 'Failed to save care preferences', 'error');
      }
    } catch (err) {
      console.error('Save preferences error:', err);
      showToast('Failed to save care preferences — check your connection', 'error');
    }
    setSavingPrefs(false);
  };

  const ed = (field, val) => setEditData({ ...editData, [field]: val });

  if (loading) return <LoadingSpinner text="Loading account..." />;

  const inputStyle = { width: '100%', padding: '10px 12px', border: '1px solid #d0d0d0', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' };
  const fieldLabel = { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' };
  const tabStyle = (id) => ({
    padding: '10px 20px', background: 'none', border: 'none', borderBottom: activeTab === id ? '3px solid #1b6b5a' : '3px solid transparent',
    fontWeight: activeTab === id ? 700 : 500, fontSize: 14, cursor: 'pointer',
    color: activeTab === id ? 'var(--role-color)' : 'var(--text-tertiary)', fontFamily: 'inherit', transition: 'all 0.15s',
  });

  const isDemo = user?.is_demo || user?.isDemo;

  // Use active viewing role (not just "has caregiver role") so the tab content matches the role toggle
  const viewingRole = typeof getActiveRole === 'function' ? getActiveRole() : (window.ACTIVE_ROLE || user?.role || 'family');
  const isCaregiver = viewingRole === 'caregiver';

  const tabs = isDemo
    ? [{ id: 'profile', label: 'Profile' }, { id: 'settings', label: 'Settings' }]
    : [
        { id: 'profile', label: 'Profile' },
        { id: 'settings', label: 'Settings' },
        ...(isCaregiver ? [
          { id: 'payments', label: 'Payments' },
          { id: 'documents', label: 'Documents' },
          { id: 'preferences', label: 'Care Preferences' },
        ] : [
          { id: 'documents', label: '📄 Documents' },
          { id: 'payments', label: '💳 Payments' },
        ]),
      ];

  const handleLogoutFromAccount = async () => {
    AUTH_TOKEN = null;
    // v1.74.4 — AWAIT the cookie-clearing request before reloading. Navigation
    // cancels in-flight fetches (reliably so in the iOS WebView), so the httpOnly
    // auth cookie survived and the reload logged the user straight back in —
    // "I can't log out of the app." 3s timeout so a dead network can't trap them.
    const _lcsrf = typeof getCsrfToken === 'function' ? getCsrfToken() : (window.getCsrfToken ? window.getCsrfToken() : null);
    try {
      await Promise.race([
        fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: _lcsrf ? { 'X-CSRF-Token': _lcsrf } : {} }),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    } catch (e) { /* still reload — worst case the cookie survives one more cycle */ }
    try { (window.__clearSessionActive ? window.__clearSessionActive() : (localStorage.removeItem('inplace_session_active'), sessionStorage.removeItem('inplace_session_active'))); } catch (e) {}
    if (typeof disconnectSocket === 'function') disconnectSocket();
    window.location.reload();
  };

  return (
    <div style={{ maxWidth: '100%', overflowX: 'hidden', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <h1 className="greeting" style={{ margin: 0 }}>My Account</h1>
        {activeTab === 'profile' && !editing && (
          <button onClick={startEditing} style={{ padding: '8px 20px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            Edit Profile
          </button>
        )}
        {activeTab === 'profile' && editing && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={cancelEditing} style={{ padding: '8px 16px', background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid #d0d0d0', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
            <button onClick={saveProfile} disabled={saving} style={{ padding: '8px 20px', background: saving ? 'var(--text-muted)' : 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: saving ? 'wait' : 'pointer' }}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>

      {/* Tab Bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e0e0e0', marginBottom: 20, overflowX: 'auto' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => { setActiveTab(t.id); setPwError(null); }} style={tabStyle(t.id)}>{t.label}</button>
        ))}
      </div>

      {/* ─── Post-Onboarding Welcome Banner ─── */}
      {postOnboarding && isCaregiver && (
        <div style={{ background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)', border: '2px solid #86efac', borderRadius: 14, padding: '20px 24px', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 28 }}>🎉</span>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#166534' }}>Welcome to InPlace!</div>
              <div style={{ fontSize: 13, color: '#15803d' }}>Let's finish setting up your account. Complete each tab below.</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { id: 'preferences', label: '1. Care Preferences', icon: '🟢' },
              { id: 'payments', label: '2. Payments', icon: '💰' },
              { id: 'documents', label: '3. Upload Documents', icon: '📄' },
              { id: 'profile', label: '4. Review Profile', icon: '👤' },
              { id: 'settings', label: '5. Settings', icon: '⚙️' },
            ].map(s => (
              <button key={s.id} onClick={() => setActiveTab(s.id)}
                style={{
                  padding: '8px 14px', border: activeTab === s.id ? '2px solid #1b6b5a' : '1px solid #bbf7d0',
                  borderRadius: 10, fontSize: 13, fontWeight: activeTab === s.id ? 700 : 500,
                  background: activeTab === s.id ? 'var(--role-color)' : 'var(--bg-card)',
                  color: activeTab === s.id ? 'var(--text-on-primary)' : '#166534', cursor: 'pointer',
                }}>
                {s.icon} {s.label}
              </button>
            ))}
          </div>
          <button onClick={() => setPostOnboarding(false)}
            style={{ marginTop: 12, padding: '6px 16px', background: 'none', border: '1px solid #86efac', borderRadius: 8, fontSize: 12, color: '#15803d', cursor: 'pointer', fontWeight: 600 }}>
            Dismiss — I'll explore on my own
          </button>
        </div>
      )}

      {/* ─── Profile Tab ─── */}
      {activeTab === 'profile' && (
        <div>
          {/* Photo Upload */}
          <div className="card" style={{ textAlign: 'center', padding: '28px 20px' }}>
            <input type="file" ref={photoInputRef} accept="image/*" style={{ display: 'none' }} onChange={handlePhotoUpload} />
            <div style={{
              width: 96, height: 96, borderRadius: '50%', margin: '0 auto 16px',
              background: user?.profile_photo ? `url(${user.profile_photo}) center/cover no-repeat` : 'var(--accent-color)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-on-primary)', fontSize: 36, fontWeight: 700, overflow: 'hidden',
              border: '3px solid #e0e0e0',
            }}>
              {!user?.profile_photo && (user?.first_name?.[0] || '?').toUpperCase()}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => photoInputRef.current?.click()} disabled={uploadingPhoto} style={{
                padding: '8px 20px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none',
                borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: uploadingPhoto ? 'wait' : 'pointer',
                opacity: uploadingPhoto ? 0.7 : 1,
              }}>
                {uploadingPhoto ? 'Uploading...' : (user?.profile_photo ? 'Change Photo' : 'Upload Photo')}
              </button>
              {user?.profile_photo && (
                <button onClick={removePhoto} style={{
                  padding: '8px 16px', background: 'var(--bg-surface)', color: 'var(--text-muted)', border: '1px solid #e0e0e0',
                  borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                }}>Remove</button>
              )}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>JPG, PNG, or GIF — any size, we'll resize it for you.</div>
          </div>

          {/* ─── v1.105.28 — "someone asked what I'm using" ───
              The referral QR in CaretakerHub is caregiver-only, and its link points at
              role=caregiver signup. A family member managing a parent's care never sees
              that screen, and would not want to send a friend to a caregiver sign-up
              anyway — the friend has their own mother to look after.
              So this lives in Account, which every role has, and points at the plain site
              where a visitor picks their own role. Static asset: no auth, no per-user
              fetch, works offline once the service worker has it. */}
          <div className="card">
            <div className="card-header">Share inPlace</div>
            <div style={{ padding: '4px 16px 18px', display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
              <img src="/img/qr-yourinplace.svg" alt="QR code linking to yourinplace.com"
                width="116" height="116"
                style={{ background: '#fff', padding: 8, borderRadius: 10, border: '1px solid var(--border-color)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 10 }}>
                  If someone asks what you're using, hold this up. They point their camera at it
                  and land on inPlace, where they can sign up as a family or as a caregiver.
                </div>
                <button onClick={() => {
                  const url = 'https://yourinplace.com';
                  // Native share sheet where there is one — on a phone that is the difference
                  // between "send this to my sister" being one tap or a copy-paste chore.
                  if (navigator.share) {
                    navigator.share({ title: 'inPlace', text: 'Care coordination for looking after a parent at home.', url }).catch(() => {});
                  } else {
                    navigator.clipboard?.writeText(url);
                    showToast?.('Link copied', 'success');
                  }
                }} style={{
                  padding: '8px 16px', borderRadius: 8, border: 'none',
                  background: 'var(--role-color)', color: 'var(--text-on-primary)',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}>
                  Share a link instead
                </button>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <span>Profile Information</span>
              {!editing && (
                <button className="card-edit-btn" onClick={startEditing} aria-label="Edit profile information">
                  <span aria-hidden="true">✏️</span> Edit
                </button>
              )}
            </div>
            {editing ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))', gap: 16 }}>
                <div>
                  <div style={fieldLabel}>First Name</div>
                  <input style={inputStyle} value={editData.firstName} onChange={(e) => ed('firstName', e.target.value)} />
                </div>
                <div>
                  <div style={fieldLabel}>Last Name</div>
                  <input style={inputStyle} value={editData.lastName} onChange={(e) => ed('lastName', e.target.value)} />
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={fieldLabel}>Phone</div>
                    <button type="button" onClick={() => { setIntlPhone(!intlPhone); ed('phone', ''); }} style={{ background: 'none', border: 'none', color: 'var(--role-color)', fontSize: 11, cursor: 'pointer', fontWeight: 600, padding: 0 }}>
                      {intlPhone ? 'US number' : 'International number'}
                    </button>
                  </div>
                  <input type="tel" style={inputStyle} value={editData.phone} onChange={(e) => ed('phone', formatPhone(e.target.value, intlPhone))} placeholder={intlPhone ? '+44 20 7946 0958' : '(555) 123-4567'} />
                  {intlPhone && <div style={{ fontSize: 11, color: 'var(--accent-color)', marginTop: 4, lineHeight: 1.4 }}>{INTL_PHONE_DISCLAIMER}</div>}
                </div>
                <div>
                  <div style={fieldLabel}>Email</div>
                  <input style={{ ...inputStyle, background: 'var(--bg-primary)', color: 'var(--text-muted)' }} value={user?.email || ''} disabled />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={fieldLabel}>Do you have pets?</div>
                  <input style={inputStyle} value={editData.pets} onChange={(e) => ed('pets', e.target.value)} placeholder="E.g., 2 cats, golden retriever" />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={fieldLabel}>Pet allergies</div>
                  <input style={inputStyle} value={editData.petAllergies} onChange={(e) => ed('petAllergies', e.target.value)} placeholder="E.g., dog fur, bird feathers" />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={fieldLabel}>Food allergies</div>
                  <input style={inputStyle} value={editData.foodAllergies} onChange={(e) => ed('foodAllergies', e.target.value)} placeholder="E.g., peanuts, shellfish, dairy" />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={fieldLabel}>Medical conditions to be aware of</div>
                  <input style={inputStyle} value={editData.medicalConditions} onChange={(e) => ed('medicalConditions', e.target.value)} placeholder="E.g., diabetes, hypertension, asthma" />
                </div>
                <div style={{ gridColumn: '1 / -1', borderTop: '1px solid #eee', paddingTop: 12, marginTop: 4 }}>
                  <div style={{ ...fieldLabel, fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Address</div>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={fieldLabel}>Street Address</div>
                  <AddressAutocomplete style={inputStyle} value={editData.addressLine1 || ''}
                    onChange={(v) => ed('addressLine1', v)}
                    onSelect={(s) => setEditData(prev => ({ ...prev, addressLine1: s.line1, city: s.city || prev.city, state: s.state || prev.state, zip: s.zip || prev.zip }))}
                    placeholder="Start typing — e.g. 123 Main St" />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={fieldLabel}>Apt / Suite / Unit</div>
                  <input style={inputStyle} value={editData.addressLine2 || ''} onChange={(e) => ed('addressLine2', e.target.value)} placeholder="Apt 4B (optional)" />
                </div>
                <div>
                  <div style={fieldLabel}>City</div>
                  <input style={inputStyle} value={editData.city || ''} onChange={(e) => ed('city', e.target.value)} placeholder="Blacksburg" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <div style={fieldLabel}>State</div>
                    <input style={inputStyle} value={editData.state || ''} onChange={(e) => ed('state', e.target.value)} placeholder="VA" />
                  </div>
                  <div>
                    <div style={fieldLabel}>ZIP</div>
                    <input style={inputStyle} value={editData.zip || ''} onChange={(e) => ed('zip', e.target.value)} placeholder="24060" />
                  </div>
                </div>
              </div>
            ) : (
              <div className="info-grid">
                <div className="info-item">
                  <div className="info-label">Name</div>
                  <div className="info-value" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {user ? `${user.first_name} ${user.last_name}` : '—'}
                    {user?.identityVerified && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" title="Identity Verified" style={{ flexShrink: 0 }}>
                        <circle cx="12" cy="12" r="11" fill="#3b82f6"/>
                        <path d="M8 12.5l2.5 2.5 5.5-5.5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                      </svg>
                    )}
                  </div>
                </div>
                <div className="info-item">
                  <div className="info-label">Email</div>
                  <div className="info-value">{user ? user.email : '—'}</div>
                </div>
                <div className="info-item">
                  <div className="info-label">Phone</div>
                  <div className="info-value">{formatPhone(user?.phone) || 'Not set'}</div>
                </div>
                <div className="info-item">
                  <div className="info-label">Address</div>
                  <div className="info-value">{user?.address_line1
                    ? `${[user.address_line1, user.address_line2].filter(Boolean).join(', ')}${user.city || user.state ? `, ${[user.city, user.state, user.zip].filter(Boolean).join(' ')}` : ''}`
                    : React.createElement('span', { style: { color: 'var(--accent-color)', cursor: 'pointer' }, onClick: () => setEditing(true) }, '+ Add your address')
                  }</div>
                </div>
                {/* Your Profiles — unified role display */}
                <div style={{ marginTop: 4, marginBottom: -8 }}>
                  <div className="info-label" style={{ marginBottom: 10 }}>Your Profiles</div>
                  {(() => {
                    const currentRoles = user?.roles || [user?.role];
                    const allRoles = [
                      { id: 'family', label: 'Family / Care Team', icon: '👪', desc: 'Find and manage care for a loved one' },
                      { id: 'caregiver', label: 'Caregiver', icon: '💼', desc: 'Provide care and find work opportunities' },
                      { id: 'care_for', label: 'Care Recipient', icon: '🏠', desc: 'Manage your own care and schedule' },
                    ];
                    return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                      allRoles.map(r => {
                        const isActive = currentRoles.includes(r.id);
                        const isCurrentView = user?.role === r.id || (user?.activeRole === r.id);
                        return React.createElement('div', {
                          key: r.id,
                          style: {
                            display: 'flex', alignItems: 'center', gap: 12,
                            padding: '12px 14px', borderRadius: 10,
                            background: isActive ? (isCurrentView ? '#e8f5f0' : 'var(--bg-highlight)') : 'var(--bg-primary)',
                            border: isActive ? (isCurrentView ? '2px solid #1b6b5a' : '1px solid #d0e8e0') : '1px dashed #ddd',
                            opacity: isActive ? 1 : 0.55,
                            cursor: isActive ? 'default' : 'pointer',
                            transition: 'all 0.2s',
                          },
                          onClick: !isActive && !isDemo ? async () => {
                            if (!confirm('Add the "' + r.label + '" role to your account?')) return;
                            try {
                              const res = await apiFetch('/api/auth/add-role', {
                                method: 'POST', body: JSON.stringify({ role: r.id }),
                              });
                              if (res?.ok) {
                                const data = await res.json();
                                if (data.token) { setAuthToken(data.token); }
                                const meRes = await apiFetch('/api/auth/me');
                                if (meRes?.ok) {
                                  const meData = await meRes.json();
                                  setUser(meData.user);
                                  if (setCurrentUser && meData.user) {
                                    const ur = meData.user.roles || [meData.user.role];
                                    setCurrentUser({
                                      id: meData.user.id, email: meData.user.email, role: meData.user.role,
                                      roles: ur, firstName: meData.user.first_name, lastName: meData.user.last_name,
                                      profilePhoto: meData.user.profile_photo || null,
                                      emailVerified: !!meData.user.email_verified, isDemo: !!meData.user.is_demo,
                                      isAdmin: !!meData.user.is_admin,
                                    });
                                  }
                                }
                                if (typeof showToast === 'function') showToast(r.label + ' role added!', 'success');
                              } else {
                                const err = await res?.json().catch(() => ({}));
                                if (typeof showToast === 'function') showToast(err.error || 'Failed to add role', 'error');
                              }
                            } catch { if (typeof showToast === 'function') showToast('Failed to add role', 'error'); }
                          } : undefined,
                        },
                          React.createElement('span', { style: { fontSize: 24, flexShrink: 0 } }, r.icon),
                          React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                            React.createElement('div', { style: { fontWeight: isActive ? 600 : 400, fontSize: 14, color: isActive ? 'var(--text-primary)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 } },
                              r.label,
                              isActive && isCurrentView && React.createElement('span', {
                                style: { fontSize: 10, background: 'var(--role-color)', color: 'var(--text-on-primary)', padding: '2px 7px', borderRadius: 10, fontWeight: 600 }
                              }, 'ACTIVE'),
                              isActive && !isCurrentView && React.createElement('span', {
                                style: { fontSize: 10, background: 'var(--border-light)', color: 'var(--text-secondary)', padding: '2px 7px', borderRadius: 10, fontWeight: 500 }
                              }, 'ADDED'),
                            ),
                            React.createElement('div', { style: { fontSize: 12, color: isActive ? 'var(--text-secondary)' : 'var(--text-muted)', marginTop: 2 } },
                              isActive ? r.desc : 'Tap to add this profile'
                            ),
                          ),
                          !isActive && React.createElement('span', { style: { fontSize: 18, color: 'var(--text-muted)', fontWeight: 300 } }, '+'),
                        );
                      })
                    );
                  })()}
                  {isDemo && <div style={{ marginTop: 6, fontSize: 11, background: 'var(--color-warning-bg)', color: 'var(--color-warning)', padding: '4px 10px', borderRadius: 8, display: 'inline-block' }}>Demo Account</div>}
                </div>
              </div>
            )}
          </div>

          {/* Identity Verification Card */}
          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                Identity Verification
                {familyIdentityStatus === 'verified' && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                    <circle cx="12" cy="12" r="11" fill="#3b82f6"/>
                    <path d="M8 12.5l2.5 2.5 5.5-5.5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                  </svg>
                )}
              </span>
              {familyIdentityStatus === 'verified'
                ? React.createElement('span', { style: { fontSize: 11, fontWeight: 600, color: '#3b82f6', background: '#eff6ff', padding: '2px 10px', borderRadius: 12 } }, 'Verified')
                : familyIdentityStatus === 'pending'
                  ? React.createElement('span', { style: { fontSize: 11, fontWeight: 600, color: 'var(--color-warning)', background: 'var(--color-warning-bg)', padding: '2px 10px', borderRadius: 12 } }, 'Pending Review')
                  : familyIdentityStatus === 'rejected'
                    ? React.createElement('span', { style: { fontSize: 11, fontWeight: 600, color: '#dc2626', background: '#fef2f2', padding: '2px 10px', borderRadius: 12 } }, 'Needs Resubmission')
                    : React.createElement('span', { style: { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', background: 'var(--bg-skeleton)', padding: '2px 10px', borderRadius: 12 } }, 'Not Verified')
              }
            </div>
            <div style={{ padding: '8px 0', color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6 }}>
              {familyIdentityStatus === 'verified' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="11" fill="#3b82f6"/>
                    <path d="M8 12.5l2.5 2.5 5.5-5.5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                  </svg>
                  <span>Your identity has been verified. Thank you for helping keep InPlace safe.</span>
                </div>
              ) : familyIdentityStatus === 'pending' ? (
                <p style={{ margin: 0 }}>Your ID is being reviewed. You'll be notified once verification is complete.</p>
              ) : (
                <>
                  <p style={{ margin: '0 0 10px' }}>Verify your identity with a selfie and photo ID to earn a blue check and help keep everyone on InPlace safe.</p>
                  {!idVerOpen ? (
                    <button onClick={() => { setIdVerOpen(true); setIdVerStep(1); setIdVerSelfie(null); setIdVerIdPhoto(null); setIdVerError(null); }}
                      style={{ background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer', width: '100%' }}>
                      Verify My Identity
                    </button>
                  ) : (
                    <div style={{ background: 'var(--bg-skeleton)', borderRadius: 10, padding: 16 }}>
                      {/* Step 1: Selfie */}
                      <div style={{ marginBottom: idVerSelfie ? 16 : 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, color: 'var(--text-primary)' }}>Step 1: Take a selfie</div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>A clear photo of your face for identity matching.</div>
                        {idVerSelfie ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <img src={idVerSelfie} alt="Selfie" style={{ width: 60, height: 60, borderRadius: 8, objectFit: 'cover', border: '2px solid var(--color-success)' }} />
                            <span style={{ color: 'var(--color-success)', fontSize: 13, fontWeight: 600 }}>Selfie captured</span>
                            <button onClick={() => { setIdVerSelfie(null); if (idVerSelfieRef.current) idVerSelfieRef.current.value = ''; }}
                              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, textDecoration: 'underline' }}>Retake</button>
                          </div>
                        ) : (
                          <>
                            <input ref={idVerSelfieRef} type="file" accept="image/*" capture="user"
                              onChange={(e) => handleIdVerFileSelect(e, 'selfie')}
                              style={{ display: 'none' }} />
                            <button onClick={() => idVerSelfieRef.current?.click()}
                              style={{ background: 'var(--bg-surface)', border: '1.5px dashed var(--border-light)', borderRadius: 8, padding: '12px 16px', width: '100%', cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
                              Take or upload selfie
                            </button>
                          </>
                        )}
                      </div>
                      {/* Step 2: ID photo */}
                      <div style={{ marginTop: 16 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, color: 'var(--text-primary)' }}>Step 2: Upload a photo ID</div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>Driver's license, passport, or state ID. Make sure text is readable.</div>
                        {idVerIdPhoto ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <img src={idVerIdPhoto} alt="ID" style={{ width: 80, height: 50, borderRadius: 6, objectFit: 'cover', border: '2px solid var(--color-success)' }} />
                            <span style={{ color: 'var(--color-success)', fontSize: 13, fontWeight: 600 }}>ID photo captured</span>
                            <button onClick={() => { setIdVerIdPhoto(null); if (idVerIdPhotoRef.current) idVerIdPhotoRef.current.value = ''; }}
                              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, textDecoration: 'underline' }}>Retake</button>
                          </div>
                        ) : (
                          <>
                            {/* v1.103.3 — button promises "Take or upload" but capture
                                forced camera-only; removed so the library works too */}
                            <input ref={idVerIdPhotoRef} type="file" accept="image/*"
                              onChange={(e) => handleIdVerFileSelect(e, 'id')}
                              style={{ display: 'none' }} />
                            <button onClick={() => idVerIdPhotoRef.current?.click()}
                              style={{ background: 'var(--bg-surface)', border: '1.5px dashed var(--border-light)', borderRadius: 8, padding: '12px 16px', width: '100%', cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
                              {('ontouchstart' in window || navigator.maxTouchPoints > 0) ? 'Take or upload photo of ID' : 'Upload photo of ID (JPEG/PNG)'}
                            </button>
                          </>
                        )}
                      </div>
                      {/* Error */}
                      {idVerError && <div style={{ marginTop: 12, padding: '8px 12px', background: '#fef2f2', color: '#dc2626', borderRadius: 8, fontSize: 13 }}>{idVerError}</div>}
                      {/* Submit */}
                      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                        <button onClick={() => setIdVerOpen(false)}
                          style={{ flex: 1, background: 'var(--bg-surface)', border: '1px solid var(--border-light)', borderRadius: 8, padding: '10px 16px', fontSize: 14, cursor: 'pointer', color: 'var(--text-secondary)' }}>
                          Cancel
                        </button>
                        <button onClick={handleIdVerSubmit} disabled={!idVerIdPhoto || idVerSubmitting}
                          style={{ flex: 1, background: idVerIdPhoto ? 'var(--role-color)' : 'var(--bg-skeleton)', color: idVerIdPhoto ? 'var(--text-on-primary)' : 'var(--text-muted)', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 14, fontWeight: 600, cursor: idVerIdPhoto ? 'pointer' : 'default', opacity: idVerSubmitting ? 0.7 : 1 }}>
                          {idVerSubmitting ? 'Verifying...' : 'Submit for Verification'}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <span>Health & Safety</span>
              {!editing && (
                <button className="card-edit-btn" onClick={startEditing} aria-label="Edit health and safety details">
                  <span aria-hidden="true">✏️</span> Edit
                </button>
              )}
            </div>
            {/* v1.105.2 — these fields are about the ACCOUNT HOLDER, not the care
                recipient (a recipient's pets and conditions live on their own record).
                Unlabelled, they read like care-recipient fields, which made the card
                look misplaced on a caregiver's profile. It isn't: matching a caregiver
                who's allergic to cats into a house with two of them is exactly what
                this prevents. So the copy now says whose details these are, and why. */}
            <p style={{ marginTop: -8, marginBottom: 14, fontSize: 13, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              {isCaregiver
                ? 'About you — so we never match you with a home that would be a problem for you.'
                : 'About you — so a caregiver coming to your home knows what to expect.'}
            </p>
            {editing ? (
              <div style={{ display: 'grid', gap: 10 }}>
                {[
                  { key: 'pets', label: 'Your pets (type, count)', ph: 'e.g., 1 dog — golden retriever' },
                  { key: 'petAllergies', label: 'Your pet allergies', ph: 'e.g., allergic to cats' },
                  { key: 'foodAllergies', label: 'Your food allergies', ph: 'e.g., nuts, dairy' },
                  { key: 'medicalConditions', label: 'Your medical conditions (optional)', ph: 'e.g., asthma, diabetes' },
                ].map(f => (
                  <div key={f.key}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>{f.label}</label>
                    <input style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 14, boxSizing: 'border-box' }}
                      value={editData[f.key] || ''} onChange={(e) => setEditData(p => ({ ...p, [f.key]: e.target.value }))} placeholder={f.ph} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="info-grid">
                <div className="info-item">
                  <div className="info-label">Your pets</div>
                  <div className="info-value">{user?.pets || 'Not specified'}</div>
                </div>
                <div className="info-item">
                  <div className="info-label">Your pet allergies</div>
                  <div className="info-value">{user?.pet_allergies || 'None'}</div>
                </div>
                <div className="info-item">
                  <div className="info-label">Your food allergies</div>
                  <div className="info-value">{user?.food_allergies || 'None'}</div>
                </div>
                <div className="info-item">
                  <div className="info-label">Your medical conditions</div>
                  <div className="info-value">{user?.medical_conditions || 'Not specified'}</div>
                </div>
              </div>
            )}
          </div>

          {/* v1.105.2 — Save/Cancel that follows you down the page. Previously these
              lived only at the top of the screen, so editing Health & Safety (the last
              card) meant scrolling all the way back up to save. The mobile rule in
              styles.css lifts this above the fixed bottom nav. */}
          {editing && (
            <div className="edit-save-bar">
              <span className="esb-hint">Editing your profile</span>
              <button onClick={cancelEditing}
                style={{ padding: '9px 16px', background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)', borderRadius: 8, fontWeight: 600, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={saveProfile} disabled={saving}
                style={{ padding: '9px 20px', background: saving ? 'var(--text-muted)' : 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, fontFamily: 'inherit', cursor: saving ? 'wait' : 'pointer' }}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ─── Security Tab ─── */}
      {activeTab === 'settings' && (
        <div>
          {/* ─── Security Section ─── */}
          {!isDemo && (
          <div>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, color: 'var(--text-primary)' }}>Security</h3>
          <div className="card">
            <div className="card-header">Password</div>
            {!changingPassword ? (
              <div>
                <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '0 0 12px' }}>
                  {user?.password_changed_at
                    ? `Last changed ${(parseTimestamp(user.password_changed_at) || new Date(0)).toLocaleDateString()}`
                    : 'Manage your account password'}
                </p>
                <button onClick={() => setChangingPassword(true)}
                  style={{ padding: '8px 20px', background: 'var(--bg-surface)', color: 'var(--role-color)', border: '1px solid #1b6b5a', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                  Change Password
                </button>
              </div>
            ) : (
              <form onSubmit={handlePasswordChange}>
                {pwError && <div style={{ background: 'var(--color-error-bg)', color: 'var(--color-error)', padding: 12, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{pwError}</div>}
                <div style={{ display: 'grid', gap: 12, maxWidth: 400 }}>
                  <div>
                    <div style={fieldLabel}>Current Password</div>
                    <input type="password" style={inputStyle} value={pwData.current} onChange={(e) => setPwData({ ...pwData, current: e.target.value })} required />
                  </div>
                  <div>
                    <div style={fieldLabel}>New Password</div>
                    <input type="password" style={inputStyle} value={pwData.new} onChange={(e) => setPwData({ ...pwData, new: e.target.value })}
                      placeholder="8+ chars, uppercase, number, symbol" required />
                  </div>
                  <div>
                    <div style={fieldLabel}>Confirm New Password</div>
                    <input type="password" style={inputStyle} value={pwData.confirm} onChange={(e) => setPwData({ ...pwData, confirm: e.target.value })} required />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button type="button" onClick={() => { setChangingPassword(false); setPwError(null); setPwData({ current: '', new: '', confirm: '' }); }}
                    style={{ padding: '8px 16px', background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid #d0d0d0', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
                  <button type="submit" disabled={pwSaving}
                    style={{ padding: '8px 20px', background: pwSaving ? 'var(--text-muted)' : 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: pwSaving ? 'wait' : 'pointer' }}>
                    {pwSaving ? 'Saving...' : 'Update Password'}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Two-Factor Authentication */}
          <div className="card">
            <div className="card-header">Two-Factor Authentication</div>
            {showSetup2FA ? (
              <TwoFactorSetup
                onComplete={() => { setShowSetup2FA(false); fetch2FAStatus(); fetchDevices(); }}
                onCancel={() => setShowSetup2FA(false)}
              />
            ) : twoFAStatus.enabled ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                  <span style={{ background: 'var(--role-color-light)', color: 'var(--role-color)', padding: '4px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600 }}>Enabled</span>
                  {twoFAStatus.setupDate && (
                    <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>since {(parseTimestamp(twoFAStatus.setupDate) || new Date(0)).toLocaleDateString()}</span>
                  )}
                </div>
                <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '0 0 16px' }}>
                  Your account is protected with an authenticator app. You'll need a code each time you sign in from a new device.
                </p>

                {/* Disable 2FA */}
                <details style={{ marginTop: 8 }}>
                  <summary style={{ fontSize: 14, color: 'var(--color-red-strong)', cursor: 'pointer', fontWeight: 500 }}>Disable two-factor authentication</summary>
                  <form onSubmit={handleDisable2FA} style={{ marginTop: 12, maxWidth: 400 }}>
                    {pwError && <div style={{ background: 'var(--color-error-bg)', color: 'var(--color-error)', padding: 12, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{pwError}</div>}
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px' }}>Enter a code from your authenticator app to confirm.</p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="000000" value={disableCode}
                        onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').substring(0, 6))}
                        style={{ ...inputStyle, maxWidth: 160, textAlign: 'center', letterSpacing: 4 }} />
                      <button type="submit" disabled={disabling2FA || disableCode.length < 6}
                        style={{ padding: '8px 20px', background: disabling2FA ? 'var(--text-muted)' : 'var(--color-error)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        {disabling2FA ? 'Disabling...' : 'Disable 2FA'}
                      </button>
                    </div>
                  </form>
                </details>
              </div>
            ) : (
              <div>
                <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '0 0 16px' }}>
                  Add an extra layer of security to your account. You'll need an authenticator app like Google Authenticator or Authy.
                </p>
                <button onClick={() => setShowSetup2FA(true)}
                  style={{ padding: '8px 20px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                  Enable Two-Factor Authentication
                </button>
              </div>
            )}
          </div>

          {/* Passkeys / Biometric Login — always show, even without WebAuthn */}
          <div className="card">
            <div className="card-header">Passkeys</div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '0 0 16px' }}>
              Sign in with Face ID, Touch ID, Windows Hello, or a security key. Passkeys are more secure than passwords and skip 2FA.
            </p>
            {!passkeySupported && (
              <div style={{ background: 'var(--color-warning-bg)', color: 'var(--color-warning)', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
                Passkey management isn't available in this browser. To add or remove passkeys, open <strong>yourinplace.com</strong> in Safari or Chrome.
              </div>
            )}
            {loadingPasskeys ? (
              <LoadingSpinner text="Loading passkeys..." />
            ) : (
              <div>
                {passkeys.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    {passkeys.map((pk, i) => (
                      <div key={pk.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: i < passkeys.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                          <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--role-color-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--role-color)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
                            </svg>
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>{pk.name}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                              Added {(parseTimestamp(pk.createdAt) || new Date(0)).toLocaleDateString()}
                              {pk.lastUsed ? (' · Last used ' + (parseTimestamp(pk.lastUsed) || new Date(0)).toLocaleDateString()) : ''}
                            </div>
                          </div>
                        </div>
                        {passkeySupported && (
                          <button onClick={() => handleDeletePasskey(pk.id)}
                            style={{ padding: '6px 14px', background: 'var(--bg-surface)', color: 'var(--color-error)', border: '1px solid #dc3545', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                            Remove
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {pwError && <div style={{ background: 'var(--color-error-bg)', color: 'var(--color-error)', padding: 12, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{pwError}</div>}
                {passkeySupported && (
                  showPasskeyNameInput ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <input type="text" value={passkeyName} onChange={(e) => setPasskeyName(e.target.value)}
                        placeholder="Name this passkey (e.g., MacBook Pro)" maxLength={50}
                        style={{ width: '100%', padding: '8px 12px', border: '1px solid #d0d0d0', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} autoFocus />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={handleRegisterPasskey} disabled={registeringPasskey}
                          style={{ flex: 1, padding: '8px 16px', background: registeringPasskey ? 'var(--text-muted)' : 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                          {registeringPasskey ? 'Registering...' : 'Create Passkey'}
                        </button>
                        <button onClick={() => { setShowPasskeyNameInput(false); setPwError(null); }}
                          style={{ padding: '8px 16px', background: 'var(--badge-muted-bg)', color: 'var(--text-secondary)', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setShowPasskeyNameInput(true)}
                      style={{ padding: '8px 20px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                      Add a Passkey
                    </button>
                  )
                )}
              </div>
            )}
          </div>

          {/* Linked Accounts */}
          <div className="card">
            <div className="card-header">Linked Accounts</div>
            {linkedAccounts.length > 0 && (
              <div>
                {linkedAccounts.map((acct, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #f0f0f0' }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: acct.provider === 'apple' ? '#000' : 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {acct.provider === 'google' ? (
                        <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                      ) : acct.provider === 'apple' ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>
                      ) : '🔗'}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, textTransform: 'capitalize' }}>{acct.provider}</div>
                      <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{acct.email || 'Linked'}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* Link Apple ID button — only show if not already linked */}
            {!linkedAccounts.some(a => a.provider === 'apple') && (
              <div style={{ paddingTop: linkedAccounts.length > 0 ? 8 : 0 }}>
                <button onClick={() => {
                  // Get the current auth token to pass through the OAuth flow
                  const token = window.getAuthToken?.() || '';
                  if (!token) { showToast('Please sign in first', 'error'); return; }
                  window.location.href = `/api/oauth/apple?link_mode=1&link_token=${encodeURIComponent(token)}`;
                }} style={{
                  width: '100%', padding: '12px 16px', background: '#000', color: '#fff',
                  border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>
                  Link Apple ID
                </button>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0', textAlign: 'center' }}>
                  Connect your Apple ID so you can sign in with Face ID or Touch ID. Works even if you choose "Hide My Email."
                </p>
              </div>
            )}
          </div>

          {/* Trusted Devices */}
          <div className="card">
            <div className="card-header">Trusted Devices</div>
            {!twoFAStatus.enabled ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: 0 }}>
                Enable two-factor authentication to use trusted devices. Trusted devices let you skip the 2FA code for 30 days.
              </p>
            ) : loadingDevices ? (
              <LoadingSpinner text="Loading devices..." />
            ) : devices.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: 0 }}>
                No trusted devices. When you sign in with 2FA and check "Remember this device," it will appear here.
              </p>
            ) : (
              <div>
                {devices.map((d, i) => (
                  <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '12px 0', borderBottom: i < devices.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{d.device_name || 'Unknown Device'}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                        Last used: {(parseTimestamp(d.last_used) || new Date(0)).toLocaleDateString()} · Expires: {(parseTimestamp(d.expires_at) || new Date(0)).toLocaleDateString()}
                      </div>
                    </div>
                    <button onClick={() => revokeDevice(d.id)}
                      style={{ padding: '6px 14px', background: 'var(--bg-surface)', color: 'var(--color-error)', border: '1px solid #dc3545', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          </div>
          )}
          {/* ─── Notifications Section ─── */}
          <div style={{ borderTop: '2px solid var(--border-color)', paddingTop: 16, marginTop: 16 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, color: 'var(--text-primary)' }}>Notifications</h3>
          </div>
          {/* v1.105.2 — ONE push section. This screen used to show the
              NotificationSettings block (headed "🔔 Push Notifications") and then a
              separate per-event card also headed "Push Notifications" — two identical
              headers on one screen, with the master enable divorced from the per-event
              switches it governs. Now: master state + per-event toggles in one card,
              push first (it's the primary channel on a phone), email second. */}
          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>🔔 Push Notifications</span>
              {savingNotifs && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Saving...</span>}
            </div>
            {typeof NotificationSettings !== 'undefined' && React.createElement(NotificationSettings, { embedded: true })}
            {/* .card already pads 24px; the old copy added another 16px, so the
                helper text sat 40px in while the toggle rows sat at 24px. Aligned now. */}
            <div style={{ borderTop: '1px solid var(--border-light)', margin: '4px 0 12px' }}></div>
            <p style={{ fontSize: 13, color: 'var(--text-tertiary)', margin: '0 0 10px' }}>Choose which events send a push to your phone.</p>
            {[
              { key: 'push_messages', label: 'New messages' },
              { key: 'push_team_note', label: 'New care notes & observations from your care team' },
              { key: 'push_observation_attention', label: 'Urgent "needs attention" notes' },
              { key: 'push_care_request', label: 'Care requests (for caregivers)' },
              { key: 'push_care_request_accepted', label: 'Care request accepted (for families)' },
              { key: 'push_session_status', label: 'Session status changes' },
            ].map(({ key, label }) => (
              <label key={key} className="toggle-label">
                <input type="checkbox" className="toggle-input" checked={notifications[key] !== false} onChange={(e) => handleNotificationChange(key, e.target.checked)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>✉️ Email Notifications</span>
              {savingNotifs && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Saving...</span>}
            </div>
            {['sessionUpdates', 'caregiverMessages', 'healthAlerts', 'reminderEmails'].map(key => (
              <label key={key} className="toggle-label">
                <input type="checkbox" className="toggle-input" checked={notifications[key]} onChange={(e) => handleNotificationChange(key, e.target.checked)} />
                <span>{key.replace(/([A-Z])/g, ' $1').trim()}</span>
              </label>
            ))}
          </div>

          {/* ─── Accessibility Section ─── */}
          {(() => {
            const a11yPrefs = (() => { try { return user?.accessibility_prefs ? JSON.parse(user.accessibility_prefs) : {}; } catch { return {}; } })();
            const currentSize = a11yPrefs.textSize || 'default';
            const handleTextSize = async (size) => {
              const newPrefs = { ...a11yPrefs, textSize: size };
              if (typeof applyTextSize === 'function') applyTextSize(size);
              try {
                const res = await apiFetch('/api/auth/me', {
                  method: 'PUT',
                  body: JSON.stringify({ accessibilityPrefs: newPrefs }),
                });
                if (res?.ok) {
                  const data = await res.json();
                  if (data.user) {
                    setUser(prev => prev ? { ...prev, ...data.user } : prev);
                    if (setCurrentUser) setCurrentUser(prev => prev ? { ...prev, ...data.user } : prev);
                  }
                  showToast('Text size updated');
                }
              } catch (err) { console.error('Save accessibility prefs error:', err); }
            };
            return (
              <div style={{ borderTop: '2px solid var(--border-color)', paddingTop: 16, marginTop: 16 }}>
                <h3 style={{ margin: '0 0 12px', fontSize: 16, color: 'var(--text-primary)' }}>Accessibility</h3>
                <div className="card" style={{ padding: 20, marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Text Size</div>
                  <div style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>Choose a text size that works best for you.</div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <button className={`text-size-pill text-size-pill-default ${currentSize === 'default' ? 'active' : ''}`}
                      onClick={() => handleTextSize('default')}>Default</button>
                    <button className={`text-size-pill text-size-pill-large ${currentSize === 'large' ? 'active' : ''}`}
                      onClick={() => handleTextSize('large')}>Large</button>
                    <button className={`text-size-pill text-size-pill-xlarge ${currentSize === 'xlarge' ? 'active' : ''}`}
                      onClick={() => handleTextSize('xlarge')}>Extra Large</button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ─── Dark Mode / Appearance Section ─── */}
          <div style={{ borderTop: '2px solid var(--border-color, var(--border-color))', paddingTop: 16, marginTop: 16 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, color: 'var(--text-primary, #333)' }}>Appearance</h3>
            <div className="card" style={{ padding: 20, marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Theme</div>
              <div style={{ color: 'var(--text-secondary, #666)', marginBottom: 16, fontSize: 14 }}>Choose how InPlace looks on your device.</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {[
                  { value: 'light', label: 'Light', icon: '☀️', desc: 'Default bright theme' },
                  { value: 'dark', label: 'Dark', icon: '🌙', desc: 'Easier on eyes at night' },
                  { value: 'system', label: 'Auto', icon: '💻', desc: 'Match device setting' },
                ].map(opt => (
                  <button key={opt.value} onClick={() => {
                    const newTheme = opt.value;
                    if (newTheme === 'system') {
                      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
                    } else {
                      document.documentElement.setAttribute('data-theme', newTheme);
                    }
                    try { localStorage.setItem('inplace-theme', newTheme); } catch {}
                    setCurrentTheme(newTheme);
                  }}
                    style={{
                      flex: '1 1 0', minWidth: 90, padding: '14px 12px', borderRadius: 12, cursor: 'pointer',
                      border: currentTheme === opt.value ? '2px solid var(--role-color, #1b6b5a)' : '2px solid var(--border-color, #e0e0e0)',
                      background: currentTheme === opt.value ? 'var(--role-color-light, #e0f2e9)' : 'var(--bg-elevated, #f8f9fa)',
                      textAlign: 'center', fontFamily: 'inherit', transition: 'all 0.2s',
                    }}>
                    <div style={{ fontSize: 24, marginBottom: 4 }}>{opt.icon}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary, #333)' }}>{opt.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted, #999)', marginTop: 2 }}>{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Documents Tab (Family) ─── */}
      {activeTab === 'documents' && !isCaregiver && (
        <Documents onNavigate={onNavigate || (() => {})} />
      )}

      {/* ─── Payments Tab (Family) ─── */}
      {activeTab === 'payments' && !isCaregiver && (
        <FamilyPayments />
      )}

      {/* ─── Payments Tab (Caregiver Only) ─── */}
      {activeTab === 'payments' && isCaregiver && (
        <div>
          {/* Rates have been moved to the Find Work page */}

          {/* Stripe Connect Card */}
          <div className="card">
            <div className="card-header">Stripe Connect</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{
                width: 12, height: 12, borderRadius: '50%',
                background: stripeStatus?.connected ? 'var(--role-color)' : stripeStatus?.onboardingStarted ? '#f59e0b' : 'var(--accent-color)'
              }}></div>
              <span style={{ fontSize: 14, fontWeight: 500 }}>
                {stripeStatus?.connected ? 'Connected' : stripeStatus?.onboardingStarted ? 'Setup incomplete' : 'Not connected'}
              </span>
            </div>
            {stripeStatus?.connected ? (
              <button onClick={handleStripeDashboard}
                style={{ padding: '8px 20px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                View Stripe Dashboard
              </button>
            ) : (
              <div>
                <button onClick={handleConnectStripe}
                  style={{ padding: '8px 20px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                  {stripeStatus?.onboardingStarted ? 'Complete Stripe Setup' : 'Connect with Stripe'}
                </button>
                {stripeStatus?.onboardingStarted && (
                  <div style={{ fontSize: 12, color: '#b45309', marginTop: 8 }}>
                    You started Stripe setup but haven't completed it. Click above to finish connecting your bank account.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Payout Speed Card */}
          <div className="card">
            <div className="card-header">Payout Speed</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              <p style={{ margin: '0 0 10px' }}>You can choose your payout speed in your Stripe dashboard:</p>
              <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 16 }}>🏦</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>Standard (Free)</div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>1–2 business days</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 16 }}>⚡</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>Instant</div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Same day — Stripe charges 1% (min $0.50)</div>
                  </div>
                </div>
              </div>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>Instant payout fees are charged by Stripe, not InPlace. Manage your payout speed in Stripe.</p>
            </div>
            <button onClick={handleStripeDashboard}
              style={{ marginTop: 12, padding: '8px 20px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              Open Stripe Dashboard
            </button>
          </div>

          {/* Background Check Card */}
          <div className="card">
            <div className="card-header">Background Check</div>
            {myVouches.length > 0 && checkrStatus !== 'complete' ? (
              <div style={{ padding: '8px 10px', marginBottom: 10, background: 'var(--color-warning-bg, #fff8e1)', borderRadius: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                🤝 An admin approved you to work with <strong>{myVouches.map(v => v.familyName).join(', ')}</strong> without a background check. A completed check is required to work with any other family.
              </div>
            ) : null}
            {checkrStatus === 'complete' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>✓</span>
                <span style={{ fontSize: 14, color: 'var(--role-color)', fontWeight: 600 }}>Background check complete</span>
              </div>
            ) : checkrStatus === 'in_progress' || checkrStatus === 'processing' || checkrStatus === 'invitation_created' ? (
              <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                <div style={{ marginBottom: 12 }}>
                  <strong style={{ color: 'var(--role-color)' }}>Processing your background check...</strong>
                </div>
                <p style={{ margin: '0 0 8px', fontSize: 13 }}>
                  We're reviewing your information. You'll receive an email when the process is complete.
                </p>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-tertiary)' }}>
                  Status: <strong>{checkrStatus === 'invitation_created' ? 'Check your email to complete' : 'In Progress'}</strong>
                </p>
              </div>
            ) : checkrError ? (
              <div style={{ color: 'var(--color-error)', fontSize: 14, padding: 12, background: 'var(--bg-error-subtle)', borderRadius: 8, border: '1px solid #fca5a5' }}>
                <strong>Error:</strong> {checkrError}
                <div style={{ marginTop: 12 }}>
                  <button onClick={() => { setCheckrError(null); setCheckrStatus('not_initiated'); }}
                    style={{ padding: '6px 12px', background: 'var(--color-error)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    Try Again
                  </button>
                </div>
              </div>
            ) : !bgCheckPaid ? (
              <div>
                <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '0 0 4px' }}>
                  <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--role-color)' }}>$30</span> one-time fee. Refunded after 10 completed sessions.
                </p>
                <p style={{ fontSize: 13, color: 'var(--text-tertiary)', margin: '0 0 16px' }}>
                  A background check is required to participate on InPlace. Your report is reviewed fairly — you'll be given a chance to provide context on anything that comes up.
                </p>
                {checkrStaging ? (
                  <div style={{ padding: 16, background: 'var(--bg-warm)', border: '1px solid #ffcc80', borderRadius: 10 }}>
                    <div style={{ color: 'var(--color-warning)', fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Staging Mode</div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 12 }}>In production, caregivers pay $30 here via Stripe. For staging testing, skip payment and go straight to the Checkr flow.</div>
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ fontSize: 12, color: 'var(--text-tertiary)', display: 'block', marginBottom: 4 }}>Checkr invitation email (auto-strips plus-address if blank):</label>
                      <input type="email" value={checkrStagingEmail} onChange={e => setCheckrStagingEmail(e.target.value)}
                        placeholder="Leave blank to auto-strip plus-address"
                        style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
                    </div>
                    <button onClick={async () => {
                      try {
                        const body = {};
                        if (checkrStagingEmail.trim()) body.checkrEmail = checkrStagingEmail.trim();
                        const res = await apiFetch('/api/checkr/initiate', { method: 'POST', body: JSON.stringify(body) });
                        const data = await res.json();
                        if (!res.ok) {
                          if (typeof showToast === 'function') showToast(data.error || 'Failed to initiate', 'error');
                          setCheckrError(data.error || 'Initiation failed');
                          return;
                        }
                        if (data.invitationUrl) {
                          window.open(data.invitationUrl, '_blank');
                          setBgCheckPaid(true);
                          setCheckrStatus('invitation_created');
                        } else if (data.status === 'already_initiated') {
                          setBgCheckPaid(true);
                          setCheckrStatus('in_progress');
                          if (typeof showToast === 'function') showToast('Background check already in progress', 'info');
                        } else {
                          setBgCheckPaid(true);
                          if (typeof showToast === 'function') showToast(data.message || 'Check your email for the Checkr invitation', 'info');
                          setCheckrStatus('invitation_created');
                        }
                      } catch (err) {
                        if (typeof showToast === 'function') showToast('Failed to initiate. Contact support.', 'error');
                      }
                    }} style={{ padding: '10px 20px', background: 'var(--color-warning)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                      Skip Payment & Start Checkr (Staging)
                    </button>
                  </div>
                ) : (
                  <div style={{ padding: 16, background: 'var(--bg-neutral)', borderRadius: 8, border: '1px solid #e0e0e0' }}>
                    {typeof StripePaymentForm !== 'undefined' ? React.createElement(StripePaymentForm, {
                      amount: 30,
                      description: 'Background check fee — one-time, refunded after 10 sessions.',
                      buttonText: 'Pay $30.00 — Start Background Check',
                      onSuccess: (intent) => {
                        console.log('BG check payment success:', intent);
                        setBgCheckPaid(true);
                        if (typeof showToast === 'function') showToast('Payment received! Starting background check...', 'success');
                      },
                      onError: (msg) => {
                        console.error('BG check payment error:', msg);
                        setCheckrError(msg || 'Payment failed');
                      },
                    }) : (
                      <div style={{ padding: 12, color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center' }}>
                        Loading payment form...
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : checkrStaging ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 16, color: 'var(--role-color)' }}>✓</span>
                  <span style={{ fontSize: 13, color: 'var(--role-color)', fontWeight: 600 }}>Payment received</span>
                </div>
                <div style={{ padding: 16, background: 'var(--bg-warm)', border: '1px solid #ffcc80', borderRadius: 10 }}>
                  <div style={{ color: 'var(--color-warning)', fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Staging Mode — Start Checkr via Email</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 12 }}>The in-app Checkr form doesn't work in staging. Click below to send the Checkr invitation via email instead.</div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 12, color: 'var(--text-tertiary)', display: 'block', marginBottom: 4 }}>Checkr invitation email (auto-strips plus-address if blank):</label>
                    <input type="email" value={checkrStagingEmail} onChange={e => setCheckrStagingEmail(e.target.value)}
                      placeholder="Leave blank to auto-strip plus-address"
                      style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
                  </div>
                  <button onClick={async () => {
                    try {
                      const body = {};
                      if (checkrStagingEmail.trim()) body.checkrEmail = checkrStagingEmail.trim();
                      const res = await apiFetch('/api/checkr/initiate', { method: 'POST', body: JSON.stringify(body) });
                      const data = await res.json();
                      if (!res.ok) {
                        if (typeof showToast === 'function') showToast(data.error || 'Failed to initiate', 'error');
                        setCheckrError(data.error || 'Initiation failed');
                        return;
                      }
                      if (data.invitationUrl) {
                        window.open(data.invitationUrl, '_blank');
                        setCheckrStatus('invitation_created');
                      } else if (data.status === 'already_initiated') {
                        setCheckrStatus('in_progress');
                        if (typeof showToast === 'function') showToast('Background check already in progress', 'info');
                      } else {
                        if (typeof showToast === 'function') showToast(data.message || 'Check your email for the Checkr invitation', 'info');
                        setCheckrStatus('invitation_created');
                      }
                    } catch (err) {
                      if (typeof showToast === 'function') showToast('Failed to initiate. Contact support.', 'error');
                    }
                  }} style={{ padding: '10px 20px', background: 'var(--color-warning)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                    Start Checkr via Email (Staging)
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 16, color: 'var(--role-color)' }}>✓</span>
                  <span style={{ fontSize: 13, color: 'var(--role-color)', fontWeight: 600 }}>Payment received</span>
                </div>
                <div style={{ padding: 16, background: 'var(--bg-neutral)', borderRadius: 8, border: '1px solid #e0e0e0' }}>
                  {typeof CheckrEmbed !== 'undefined' ? React.createElement(CheckrEmbed, {
                    onComplete: (data) => {
                      console.log('Background check initiated:', data);
                      setCheckrStatus('in_progress');
                    },
                    onError: (err) => {
                      console.error('Background check error:', err);
                      setCheckrError(err?.message || 'Failed to submit background check');
                      setCheckrStatus('error');
                    },
                  }) : (
                    <div style={{ padding: 12, color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center' }}>
                      Loading background check form...
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Fee Breakdown Card */}
          <div className="card">
            <div className="card-header">Fee Breakdown</div>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              <p>
                <strong>Platform Fee:</strong> InPlace adds a <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--role-color)' }}>20%</span> platform fee to the family's cost. This does not reduce your earnings.
              </p>
              <p>
                <strong>Rush Surcharge:</strong> Short-notice bookings (less than 24 hours) include a <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--role-color)' }}>20%</span> rush surcharge. <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--role-color)' }}>75%</span> of the surcharge goes to you as an incentive.
              </p>
              <p>
                <strong>Payout Timing:</strong> Your first bank deposit from Stripe takes <span style={{ fontWeight: 700 }}>7–14 business days</span>. After that, payouts arrive in <span style={{ fontWeight: 700 }}>2–3 business days</span> on a rolling basis.
              </p>
            </div>
          </div>

          {/* Hour Reports — moved from Dashboard */}
          <div style={{ borderTop: '2px solid var(--border-color)', paddingTop: 20, marginTop: 20 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, color: 'var(--text-primary)' }}>📊 Hour Reports</h3>
            {typeof HourReports !== 'undefined' && React.createElement(HourReports, {
              profileName: user?.first_name ? user.first_name + ' ' + (user.last_name || '') : '',
              academicProgram: null,
            })}
          </div>
        </div>
      )}

      {/* ─── Documents Tab (Caregiver Only) ─── */}
      {activeTab === 'documents' && isCaregiver && (
        <div>
          <input type="file" ref={acctDocInputRef} style={{ display: 'none' }} accept="image/*"
            onChange={(e) => {
              if (pendingAcctDocType) {
                handleDocumentUpload(pendingAcctDocType);
                setPendingAcctDocType(null);
              }
            }} />

          {/* Expiration Warnings Banner */}
          {(() => {
            const now = new Date();
            const soon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
            const expiring = (cgCertifications || []).filter(c => {
              if (!c.expiryDate) return false;
              const exp = new Date(c.expiryDate);
              return exp <= soon;
            });
            if (expiring.length === 0) return null;
            return React.createElement('div', { className: 'card', style: { background: 'var(--bg-error-light)', border: '2px solid #e53e3e', marginBottom: 16 } },
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } },
                React.createElement('span', { style: { fontSize: 20 } }, '⚠️'),
                React.createElement('span', { style: { fontSize: 14, fontWeight: 700, color: 'var(--color-error)' } }, 'Expiring Soon')
              ),
              expiring.map((c, i) => {
                const exp = new Date(c.expiryDate);
                const expired = exp < now;
                return React.createElement('div', { key: i, style: { padding: '6px 0', fontSize: 13, color: expired ? 'var(--color-error)' : '#c05621' } },
                  React.createElement('span', { style: { fontWeight: 600 } }, c.certType || 'Certification'),
                  ' — ',
                  expired
                    ? React.createElement('span', { style: { fontWeight: 700, color: 'var(--color-error)' } }, 'EXPIRED ' + exp.toLocaleDateString())
                    : React.createElement('span', null, 'Expires ' + exp.toLocaleDateString())
                );
              })
            );
          })()}

          {['drivers_license', 'certifications', 'background_check'].map(docType => {
            const docLabel = { drivers_license: "Driver's License", certifications: 'Certifications', background_check: 'Background Check' }[docType] || docType;
            const docIcon = { drivers_license: '🪪', certifications: '📜', background_check: '🔒' }[docType] || '📄';
            const uploaded = documents.filter(d => (d.document_type || d.type) === docType);
            const isUploaded = uploaded.length > 0;

            return (
              <div key={docType} className="card" style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{docIcon} {docLabel}</span>
                  <span style={{ fontSize: 16 }}>{isUploaded ? '✅' : '⬜'}</span>
                </div>

                {isUploaded && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
                    {uploaded.map(doc => (
                      <div key={doc.id} style={{ position: 'relative', cursor: 'pointer' }} onClick={() => handleViewDocument(doc.id)}>
                        <div style={{ width: 80, height: 80, borderRadius: 8, overflow: 'hidden', border: docPreviews[doc.id] ? '2px solid #1b6b5a' : '1px solid #ddd', background: 'var(--bg-neutral)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {docPreviews[doc.id]
                            ? <img src={docPreviews[doc.id]} alt={doc.file_name || docLabel} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : <span style={{ fontSize: 28, opacity: 0.4 }}>📄</span>}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 2, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {new Date(doc.created_at).toLocaleDateString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {/* Full-size preview when a thumbnail is clicked */}
                {isUploaded && uploaded.some(doc => docPreviews[doc.id]) && uploaded.filter(doc => docPreviews[doc.id]).map(doc => (
                  <div key={`preview-${doc.id}`} style={{ marginBottom: 8, borderRadius: 8, overflow: 'hidden', border: '1px solid #ddd' }}>
                    <img src={docPreviews[doc.id]} alt={docLabel} style={{ width: '100%', maxHeight: 300, objectFit: 'contain', background: 'var(--bg-neutral)' }} />
                  </div>
                ))}

                <button onClick={() => {
                  setPendingAcctDocType(docType);
                  acctDocInputRef.current?.click();
                }}
                  disabled={docUploading === docType}
                  style={{ padding: '8px 16px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: docUploading === docType ? 0.7 : 1 }}>
                  {docUploading === docType ? 'Uploading...' : (isUploaded ? 'Replace' : 'Upload')}
                </button>
              </div>
            );
          })}

          {/* Certification Details with Expiry */}
          {cgCertifications && cgCertifications.length > 0 && cgCertifications.some(c => c.certType) && (
            <div className="card" style={{ marginTop: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>📋 Certification Details</div>
              {cgCertifications.filter(c => c.certType).map((cert, i) => {
                const now = new Date();
                const exp = cert.expiryDate ? new Date(cert.expiryDate) : null;
                const isExpired = exp && exp < now;
                const isSoon = exp && !isExpired && exp < new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
                return (
                  <div key={i} style={{ padding: '8px 0', borderBottom: i < cgCertifications.length - 1 ? '1px solid #eee' : 'none' }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{cert.certType}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {cert.certNumber && <span>#{cert.certNumber} </span>}
                      {cert.issuer && <span>· {cert.issuer} </span>}
                    </div>
                    {exp && (
                      <div style={{ fontSize: 12, marginTop: 2, fontWeight: isExpired || isSoon ? 700 : 400,
                        color: isExpired ? 'var(--color-error)' : isSoon ? '#c05621' : 'var(--text-secondary)' }}>
                        {isExpired ? '🔴 EXPIRED' : isSoon ? '🟡 Expiring soon' : '✅ Valid'} — {exp.toLocaleDateString()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── Care Preferences Tab (Caregiver Only) ─── */}
      {activeTab === 'preferences' && isCaregiver && (() => {
        const CG_PREFS_LIST = [
          { id: 'meal_prep', label: 'Meal preparation & cooking', icon: '\uD83C\uDF73' },
          { id: 'housekeeping', label: 'Light housekeeping (tidying, dishes, laundry)', icon: '\uD83E\uDDF9' },
          { id: 'errands', label: 'Grocery shopping & errands', icon: '\uD83D\uDED2' },
          { id: 'med_reminders', label: 'Medication reminders', icon: '\uD83D\uDC8A' },
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
        const CG_RATING_OPTIONS = [
          { value: 'none', label: 'No pref', color: 'var(--border-light)', textColor: 'var(--text-muted)' },
          { value: 'green', label: 'Comfortable', color: 'var(--color-success-bg)', textColor: 'var(--color-success)' },
          { value: 'yellow', label: 'With support', color: 'var(--color-warning-bg)', textColor: 'var(--color-warning)' },
          { value: 'red', label: 'Not comfortable', color: 'var(--color-error-bg)', textColor: 'var(--color-error)' },
        ];
        const prefs = preferences || {};
        const ratedCount = Object.values(prefs).filter(v => v && v !== 'none').length;
        return (
          <div>
            <div style={{ background: 'var(--bg-highlight)', border: '1px solid #c8e6c9', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: 'var(--role-color)', fontWeight: 500, lineHeight: 1.5 }}>
                Tell families what you're comfortable with. This helps us match you to compatible clients. <strong>{ratedCount}/{CG_PREFS_LIST.length} rated</strong>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
              {CG_RATING_OPTIONS.slice(1).map(r => (
                <div key={r.value} style={{ padding: '3px 8px', borderRadius: 5, fontSize: 11, fontWeight: 600, background: r.color, color: r.textColor, border: '1px solid #ddd' }}>{r.label}</div>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {CG_PREFS_LIST.map(pref => {
                const val = prefs[pref.id] || 'none';
                const ratingObj = CG_RATING_OPTIONS.find(r => r.value === val) || CG_RATING_OPTIONS[0];
                return (
                  <div key={pref.id} style={{
                    borderRadius: 8,
                    background: val !== 'none' ? ratingObj.color + '40' : 'var(--bg-primary)',
                    border: '1px solid ' + (val !== 'none' ? ratingObj.color : 'var(--border-light)'),
                    transition: 'all 0.2s',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
                      <span style={{ fontSize: 18, width: 24, textAlign: 'center', flexShrink: 0 }}>{pref.icon}</span>
                      <div style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.3 }}>{pref.label}</div>
                      <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                        {CG_RATING_OPTIONS.slice(1).map(r => (
                          <button key={r.value} onClick={() => setPreferences({ ...prefs, [pref.id]: val === r.value ? 'none' : r.value })} style={{
                            padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600,
                            border: val === r.value ? '2px solid #1b6b5a' : '1px solid #ddd',
                            background: val === r.value ? r.color : 'var(--bg-card)',
                            color: val === r.value ? r.textColor : 'var(--text-muted)',
                            cursor: 'pointer', transition: 'all 0.15s',
                          }}>{r.label}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <button onClick={handleSavePreferences} disabled={savingPrefs}
              style={{ marginTop: 16, padding: '12px 24px', background: savingPrefs ? 'var(--text-muted)' : 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', width: '100%' }}>
              {savingPrefs ? 'Saving...' : 'Save Preferences'}
            </button>
          </div>
        );
      })()}

      {/* Add a Role — merged into "Your Profiles" section in Profile card above */}

      {/* Remove a Role — only for non-demo users with multiple roles */}
      {!isDemo && user && (() => {
        const currentRoles = user.roles || [user.role];
        if (currentRoles.length <= 1) return null;
        const roleLabels = { family: 'Family / Care Team', caregiver: 'Caregiver', care_for: 'Care Recipient' };
        const roleIcons = { family: '👪', caregiver: '💼', care_for: '🏠' };
        return React.createElement('div', { className: 'card', style: { marginTop: 20, padding: 20, border: '1px solid #fdd' } },
          React.createElement('div', { className: 'card-header', style: { marginBottom: 12, color: 'var(--color-error)' } }, 'Remove a Role'),
          React.createElement('p', { style: { fontSize: 13, color: 'var(--text-tertiary)', margin: '0 0 16px' } },
            'Remove a role you no longer need. Your account and other roles will remain intact.'
          ),
          currentRoles.map(r =>
            React.createElement('div', {
              key: r,
              style: {
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', marginBottom: 6, background: 'var(--bg-surface)',
                border: '1px solid #e0e0e0', borderRadius: 8,
              }
            },
              React.createElement('span', { style: { fontSize: 14 } }, `${roleIcons[r] || ''} ${roleLabels[r] || r}`),
              React.createElement('button', {
                onClick: async () => {
                  const label = roleLabels[r] || r;
                  if (!confirm(`Remove the "${label}" role from your account?\n\nThis will delete any associated profile data for that role. Your account and other roles will not be affected.`)) return;
                  if (!confirm(`Are you sure? This cannot be undone.`)) return;
                  try {
                    const res = await apiFetch('/api/auth/remove-role', {
                      method: 'POST', body: JSON.stringify({ role: r }),
                    });
                    if (res?.ok) {
                      const data = await res.json();
                      if (data.token) { setAuthToken(data.token); }
                      const meRes = await apiFetch('/api/auth/me');
                      if (meRes?.ok) {
                        const meData = await meRes.json();
                        setUser(meData.user);
                        if (setCurrentUser && meData.user) {
                          const ur = meData.user.roles || [meData.user.role];
                          setCurrentUser({
                            id: meData.user.id, email: meData.user.email, role: meData.user.role,
                            roles: ur,
                            firstName: meData.user.first_name, lastName: meData.user.last_name,
                            profilePhoto: meData.user.profile_photo || null,
                            emailVerified: !!meData.user.email_verified, isDemo: !!meData.user.is_demo,
                            isAdmin: !!meData.user.is_admin,
                          });
                        }
                        if (window.setActiveRole) window.setActiveRole(data.primaryRole || (meData.user.roles || [meData.user.role])[0]);
                      }
                      if (typeof showToast === 'function') showToast(`${label} role removed`, 'success');
                    } else {
                      const err = await res?.json().catch(() => ({}));
                      if (typeof showToast === 'function') showToast(err.error || 'Failed to remove role', 'error');
                    }
                  } catch { if (typeof showToast === 'function') showToast('Failed to remove role', 'error'); }
                },
                style: {
                  padding: '6px 14px', background: 'none', border: '1px solid #e57373',
                  borderRadius: 6, color: 'var(--color-error)', fontSize: 12, fontWeight: 500,
                  cursor: 'pointer',
                },
              }, 'Remove')
            )
          ),
        );
      })()}

      {/* Logout — always visible, especially important for mobile PWA */}
      <div style={{ marginTop: 32, paddingTop: 20, borderTop: '1px solid #e0e0e0' }}>
        <button onClick={handleLogoutFromAccount} style={{
          width: '100%', padding: '14px 20px', background: 'var(--bg-surface)', color: 'var(--color-error)',
          border: '1px solid #e0e0e0', borderRadius: 10, fontSize: 15, fontWeight: 600,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          🚪 Log Out
        </button>
      </div>

      {/* Help & Support — always visible, especially important on mobile where sidebar is hidden */}
      <button
        onClick={() => onNavigate && onNavigate('help')}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          padding: '14px 18px', marginTop: 20, background: '#f5f7fa',
          border: '1px solid #e0e4ea', borderRadius: 12, cursor: 'pointer',
          fontSize: 15, fontWeight: 500, color: '#4a90d9',
        }}
      >
        <span style={{ fontSize: 20 }}>❓</span>
        <span>Help & Support</span>
        <span style={{ marginLeft: 'auto', color: '#aab', fontSize: 18 }}>›</span>
      </button>

      {/* Delete Account — not for demo accounts */}
      {!isDemo && (
        <DeleteAccountSection onDeleted={handleLogoutFromAccount} />
      )}

      <div style={{ textAlign: 'center', marginTop: 10, marginBottom: 20, fontSize: 11, color: 'var(--text-muted)' }}>
        v{window.APP_VERSION || '?'}
      </div>
    </div>
  );
};
