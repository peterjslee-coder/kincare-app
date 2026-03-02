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
        <div style={{ padding: '24px', background: '#f8faf9', borderRadius: '12px', border: '1px solid #d0e8e0', textAlign: 'center' }}>
          <div style={{ fontSize: '28px', marginBottom: '12px' }}>{'We\'re sorry to see you go'}</div>
          <p style={{ fontSize: '15px', color: '#555', margin: '0 0 8px', lineHeight: '1.6' }}>
            Your account has been deleted. Thank you for being part of InPlace.
          </p>
          <p style={{ fontSize: '13px', color: '#888', margin: 0 }}>
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
          width: '100%', padding: '12px 20px', background: '#fff', color: '#999',
          border: '1px solid #e0e0e0', borderRadius: 10, fontSize: 13, fontWeight: 500,
          cursor: 'pointer',
        }}>
          Delete My Account
        </button>
      )}

      {step === 'reason' && (
        <div style={{ padding: '16px', background: '#fff8f8', borderRadius: '10px', border: '1px solid #fdd' }}>
          <div style={{ fontSize: '15px', fontWeight: 600, color: '#c62828', marginBottom: '4px' }}>
            We're sorry to see you go
          </div>
          <p style={{ fontSize: '13px', color: '#666', margin: '0 0 14px', lineHeight: '1.5' }}>
            Before you go, would you mind telling us why? This helps us improve InPlace for everyone.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
            {EXIT_REASONS.map(r => (
              <label key={r.value} style={{
                display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px',
                background: reason === r.value ? '#fef0ed' : '#fff', borderRadius: '6px',
                border: reason === r.value ? '1px solid #e8724a' : '1px solid #eee',
                cursor: 'pointer', fontSize: '13px', color: '#444', transition: 'all 0.15s',
              }}>
                <input type="radio" name="exit-reason" value={r.value}
                  checked={reason === r.value} onChange={() => setReason(r.value)}
                  style={{ accentColor: '#e8724a' }} />
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
              flex: 1, padding: '10px', background: '#f0f0f0', color: '#555', border: 'none',
              borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            }}>Cancel</button>
            <button onClick={() => setStep('confirm')} disabled={!reason} style={{
              flex: 1, padding: '10px', background: reason ? '#c62828' : '#e0e0e0',
              color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
              cursor: reason ? 'pointer' : 'not-allowed',
            }}>Continue</button>
          </div>
        </div>
      )}

      {step === 'confirm' && (
        <div style={{ padding: '16px', background: '#fff8f8', borderRadius: '10px', border: '1px solid #fdd' }}>
          <div style={{ fontSize: '15px', fontWeight: 600, color: '#c62828', marginBottom: '8px' }}>
            Confirm Account Deletion
          </div>
          <p style={{ fontSize: '13px', color: '#666', margin: '0 0 12px', lineHeight: '1.5' }}>
            This action cannot be undone. Your profile and personal data will be removed, though some records may be retained for legal and safety purposes.
          </p>
          <p style={{ fontSize: '13px', color: '#333', margin: '0 0 8px', fontWeight: 500 }}>
            Type <strong>DELETE</strong> to confirm:
          </p>
          <input type="text" value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type DELETE" style={{
              width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: '6px',
              fontSize: '14px', marginBottom: '12px', boxSizing: 'border-box',
            }} />
          {error && <div style={{ fontSize: '13px', color: '#c62828', marginBottom: '10px' }}>{error}</div>}
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => setStep('reason')} style={{
              flex: 1, padding: '10px', background: '#f0f0f0', color: '#555', border: 'none',
              borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            }}>Back</button>
            <button onClick={handleDelete} disabled={confirmText !== 'DELETE' || deleting} style={{
              flex: 1, padding: '10px', background: confirmText === 'DELETE' ? '#c62828' : '#e0e0e0',
              color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
              cursor: confirmText === 'DELETE' ? 'pointer' : 'not-allowed',
              opacity: deleting ? 0.6 : 1,
            }}>{deleting ? 'Deleting...' : 'Delete My Account'}</button>
          </div>
        </div>
      )}
    </div>
  );
};

const MyAccount = window.MyAccount = ({ setCurrentUser }) => {
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

  // Caregiver - Payments state
  const [stripeStatus, setStripeStatus] = useState(null);
  const [payoutPref, setPayoutPref] = useState('standard');
  const [savingPayout, setSavingPayout] = useState(false);
  const [bgCheckPaid, setBgCheckPaid] = useState(false);

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
  const [editRates, setEditRates] = useState(null);
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
      if (!SimpleWebAuthnBrowser) throw new Error('Passkey support not loaded');

      // Get registration options
      const optRes = await apiFetch('/api/passkeys/register/options', { method: 'POST' });
      if (!optRes?.ok) throw new Error('Failed to start passkey registration');
      const options = await optRes.json();

      // Trigger browser passkey/biometric prompt
      const regResp = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON: options });

      // Send to server for verification
      const verifyRes = await apiFetch('/api/passkeys/register/verify', {
        method: 'POST',
        body: JSON.stringify({ ...regResp, passkeyName: passkeyName || 'My Passkey' }),
      });
      if (!verifyRes?.ok) {
        const errData = await verifyRes.json();
        throw new Error(errData?.error || 'Passkey registration failed');
      }

      showToast('Passkey registered! You can now sign in with biometrics.', 'success');
      setShowPasskeyNameInput(false);
      setPasskeyName('');
      fetchPasskeys();
    } catch (err) {
      if (err.name !== 'NotAllowedError') {
        setPwError(err.message);
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
      }
    } catch {}
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
    if (window.PublicKeyCredential) {
      setPasskeySupported(true);
      fetchPasskeys();
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'settings' || activeTab === 'security' || activeTab === 'devices') fetchDevices();
  }, [activeTab]);

  // Fetch caregiver financial data
  useEffect(() => {
    if (activeTab === 'payments') {
      apiFetch('/api/payments/connect-status').then(async r => {
        if (r?.ok) { const d = await r.json(); setStripeStatus(d); }
      }).catch(() => {});
      apiFetch('/api/payments/payout-preference').then(async r => {
        if (r?.ok) { const d = await r.json(); setPayoutPref(d.preference || 'standard'); }
      }).catch(() => {});
      apiFetch('/api/dashboard').then(async r => {
        if (r?.ok) { const d = await r.json(); setBgCheckPaid(!!d.backgroundCheckPaid); }
      }).catch(() => {});
      apiFetch('/api/caregivers/me').then(async r => {
        if (r?.ok) { const d = await r.json(); setEditRates({ daytime: d.profile?.rate_daytime || '', nighttime: d.profile?.rate_nighttime || '', overnight: d.profile?.rate_overnight || '' }); }
      }).catch(() => {});
    }
  }, [activeTab]);

  // Fetch caregiver documents + certifications for expiry warnings
  useEffect(() => {
    if (activeTab === 'documents') {
      apiFetch('/api/caregiver-onboarding/documents').then(async r => {
        if (r?.ok) { const d = await r.json(); setDocuments(d.documents || []); }
      }).catch(() => {});
      apiFetch('/api/caregivers/me').then(async r => {
        if (r?.ok) { const d = await r.json(); setCgCertifications(d.profile?.certifications || []); }
      }).catch(() => {});
    }
  }, [activeTab]);

  // Fetch caregiver care preferences
  useEffect(() => {
    if (activeTab === 'preferences') {
      apiFetch('/api/caregivers/me').then(async r => {
        if (r?.ok) { const d = await r.json(); setPreferences(d.profile?.care_preferences ? JSON.parse(d.profile.care_preferences) : {}); }
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
        }),
      });
      if (res?.ok) {
        const data = await res.json();
        setUser(data.user);
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
      const res = await apiFetch('/api/payments/connect-account', { method: 'POST' });
      if (res?.ok) {
        const data = await res.json();
        if (data.url) {
          window.location.href = data.url;
        }
      }
    } catch (err) {
      showToast('Failed to start Stripe setup', 'error');
    }
  };

  const handleSavePayoutPref = async () => {
    setSavingPayout(true);
    try {
      const res = await apiFetch('/api/payments/payout-preference', {
        method: 'POST',
        body: JSON.stringify({ preference: payoutPref })
      });
      if (res?.ok) {
        showToast('Payout preference saved', 'success');
      }
    } catch (err) {
      showToast('Failed to save payout preference', 'error');
    }
    setSavingPayout(false);
  };

  // Caregiver - Documents handlers
  const handleDocumentUpload = async (docType) => {
    const file = acctDocInputRef.current?.files?.[0];
    if (!file) return;

    setDocUploading(docType);
    try {
      const formData = new FormData();
      formData.append('documents', file);
      formData.append('types', JSON.stringify([docType]));
      formData.append('metadata', JSON.stringify([{}]));
      const token = window.AUTH_TOKEN || localStorage.getItem('auth_token');
      const res = await fetch('/api/caregiver-onboarding/documents', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) {
        showToast('Document uploaded successfully', 'success');
        const updated = await apiFetch('/api/caregiver-onboarding/documents');
        if (updated?.ok) {
          const d = await updated.json();
          setDocuments(d.documents || []);
        }
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
        showToast('Care preferences saved', 'success');
      }
    } catch (err) {
      showToast('Failed to save care preferences', 'error');
    }
    setSavingPrefs(false);
  };

  const ed = (field, val) => setEditData({ ...editData, [field]: val });

  if (loading) return <LoadingSpinner text="Loading account..." />;

  const inputStyle = { width: '100%', padding: '10px 12px', border: '1px solid #d0d0d0', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' };
  const fieldLabel = { fontSize: 12, fontWeight: 600, color: '#666', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' };
  const tabStyle = (id) => ({
    padding: '10px 20px', background: 'none', border: 'none', borderBottom: activeTab === id ? '3px solid #1b6b5a' : '3px solid transparent',
    fontWeight: activeTab === id ? 700 : 500, fontSize: 14, cursor: 'pointer',
    color: activeTab === id ? '#1b6b5a' : '#888', fontFamily: 'inherit', transition: 'all 0.15s',
  });

  const isDemo = user?.is_demo || user?.isDemo;

  const isCaregiver = (() => {
    if (!user) return false;
    const roles = user.roles ? (typeof user.roles === 'string' ? JSON.parse(user.roles) : user.roles) : [user.role];
    return roles.includes('caregiver');
  })();

  const tabs = isDemo
    ? [{ id: 'profile', label: 'Profile' }, { id: 'settings', label: 'Settings' }]
    : [
        { id: 'profile', label: 'Profile' },
        { id: 'settings', label: 'Settings' },
        ...(isCaregiver ? [
          { id: 'payments', label: 'Payments & Rates' },
          { id: 'documents', label: 'Documents' },
          { id: 'preferences', label: 'Care Preferences' },
        ] : []),
      ];

  const handleLogoutFromAccount = () => {
    localStorage.removeItem('auth_token');
    AUTH_TOKEN = null;
    if (typeof disconnectSocket === 'function') disconnectSocket();
    window.location.reload();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <h1 className="greeting" style={{ margin: 0 }}>My Account</h1>
        {activeTab === 'profile' && !editing && (
          <button onClick={startEditing} style={{ padding: '8px 20px', background: '#1b6b5a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            Edit Profile
          </button>
        )}
        {activeTab === 'profile' && editing && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={cancelEditing} style={{ padding: '8px 16px', background: '#fff', color: '#666', border: '1px solid #d0d0d0', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
            <button onClick={saveProfile} disabled={saving} style={{ padding: '8px 20px', background: saving ? '#999' : '#1b6b5a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: saving ? 'wait' : 'pointer' }}>
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

      {/* ─── Profile Tab ─── */}
      {activeTab === 'profile' && (
        <div>
          {/* Photo Upload */}
          <div className="card" style={{ textAlign: 'center', padding: '28px 20px' }}>
            <input type="file" ref={photoInputRef} accept="image/*" style={{ display: 'none' }} onChange={handlePhotoUpload} />
            <div style={{
              width: 96, height: 96, borderRadius: '50%', margin: '0 auto 16px',
              background: user?.profile_photo ? `url(${user.profile_photo}) center/cover no-repeat` : '#e8724a',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontSize: 36, fontWeight: 700, overflow: 'hidden',
              border: '3px solid #e0e0e0',
            }}>
              {!user?.profile_photo && (user?.first_name?.[0] || '?').toUpperCase()}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => photoInputRef.current?.click()} disabled={uploadingPhoto} style={{
                padding: '8px 20px', background: '#1b6b5a', color: '#fff', border: 'none',
                borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: uploadingPhoto ? 'wait' : 'pointer',
                opacity: uploadingPhoto ? 0.7 : 1,
              }}>
                {uploadingPhoto ? 'Uploading...' : (user?.profile_photo ? 'Change Photo' : 'Upload Photo')}
              </button>
              {user?.profile_photo && (
                <button onClick={removePhoto} style={{
                  padding: '8px 16px', background: '#fff', color: '#999', border: '1px solid #e0e0e0',
                  borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                }}>Remove</button>
              )}
            </div>
            <div style={{ fontSize: 11, color: '#999', marginTop: 10 }}>JPG, PNG, or GIF — any size, we'll resize it for you.</div>
          </div>

          <div className="card">
            <div className="card-header">Profile Information</div>
            {editing ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
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
                    <button type="button" onClick={() => { setIntlPhone(!intlPhone); ed('phone', ''); }} style={{ background: 'none', border: 'none', color: '#1b6b5a', fontSize: 11, cursor: 'pointer', fontWeight: 600, padding: 0 }}>
                      {intlPhone ? 'US number' : 'International number'}
                    </button>
                  </div>
                  <input type="tel" style={inputStyle} value={editData.phone} onChange={(e) => ed('phone', formatPhone(e.target.value, intlPhone))} placeholder={intlPhone ? '+44 20 7946 0958' : '(555) 123-4567'} />
                  {intlPhone && <div style={{ fontSize: 11, color: '#e8724a', marginTop: 4, lineHeight: 1.4 }}>{INTL_PHONE_DISCLAIMER}</div>}
                </div>
                <div>
                  <div style={fieldLabel}>Email</div>
                  <input style={{ ...inputStyle, background: '#f5f5f5', color: '#999' }} value={user?.email || ''} disabled />
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
              </div>
            ) : (
              <div className="info-grid">
                <div className="info-item">
                  <div className="info-label">Name</div>
                  <div className="info-value">{user ? `${user.first_name} ${user.last_name}` : '—'}</div>
                </div>
                <div className="info-item">
                  <div className="info-label">Email</div>
                  <div className="info-value">{user ? user.email : '—'}</div>
                </div>
                <div className="info-item">
                  <div className="info-label">Phone</div>
                  <div className="info-value">{formatPhone(user?.phone) || 'Not set'}</div>
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
                            background: isActive ? (isCurrentView ? '#e8f5f0' : '#f8faf9') : '#fafafa',
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
                            React.createElement('div', { style: { fontWeight: isActive ? 600 : 400, fontSize: 14, color: isActive ? '#333' : '#999', display: 'flex', alignItems: 'center', gap: 6 } },
                              r.label,
                              isActive && isCurrentView && React.createElement('span', {
                                style: { fontSize: 10, background: '#1b6b5a', color: '#fff', padding: '2px 7px', borderRadius: 10, fontWeight: 600 }
                              }, 'ACTIVE'),
                              isActive && !isCurrentView && React.createElement('span', {
                                style: { fontSize: 10, background: '#e0e0e0', color: '#666', padding: '2px 7px', borderRadius: 10, fontWeight: 500 }
                              }, 'ADDED'),
                            ),
                            React.createElement('div', { style: { fontSize: 12, color: isActive ? '#666' : '#bbb', marginTop: 2 } },
                              isActive ? r.desc : 'Tap to add this profile'
                            ),
                          ),
                          !isActive && React.createElement('span', { style: { fontSize: 18, color: '#bbb', fontWeight: 300 } }, '+'),
                        );
                      })
                    );
                  })()}
                  {isDemo && <div style={{ marginTop: 6, fontSize: 11, background: '#fff3cd', color: '#856404', padding: '4px 10px', borderRadius: 8, display: 'inline-block' }}>Demo Account</div>}
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-header">Subscription</div>
            <div className="info-grid">
              <div className="info-item">
                <div className="info-label">Plan</div>
                <div className="info-value">InPlace Beta - Free</div>
              </div>
              <div className="info-item">
                <div className="info-label">Status</div>
                <div className="info-value"><span className="badge badge-confirmed">Active</span></div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">Health & Safety</div>
            {editing ? (
              <div style={{ display: 'grid', gap: 10 }}>
                {[
                  { key: 'pets', label: 'Pets (type, count)', ph: 'e.g., 1 dog — golden retriever' },
                  { key: 'petAllergies', label: 'Pet Allergies', ph: 'e.g., allergic to cats' },
                  { key: 'foodAllergies', label: 'Food Allergies', ph: 'e.g., nuts, dairy' },
                  { key: 'medicalConditions', label: 'Medical Conditions', ph: 'e.g., asthma, diabetes' },
                ].map(f => (
                  <div key={f.key}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#555', display: 'block', marginBottom: 3 }}>{f.label}</label>
                    <input style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 14, boxSizing: 'border-box' }}
                      value={editData[f.key] || ''} onChange={(e) => setEditData(p => ({ ...p, [f.key]: e.target.value }))} placeholder={f.ph} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="info-grid">
                <div className="info-item">
                  <div className="info-label">Pets</div>
                  <div className="info-value">{user?.pets || 'Not specified'}</div>
                </div>
                <div className="info-item">
                  <div className="info-label">Pet Allergies</div>
                  <div className="info-value">{user?.pet_allergies || 'None'}</div>
                </div>
                <div className="info-item">
                  <div className="info-label">Food Allergies</div>
                  <div className="info-value">{user?.food_allergies || 'None'}</div>
                </div>
                <div className="info-item">
                  <div className="info-label">Medical Conditions</div>
                  <div className="info-value">{user?.medical_conditions || 'Not specified'}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Security Tab ─── */}
      {activeTab === 'settings' && (
        <div>
          {/* ─── Security Section ─── */}
          {!isDemo && (
          <div>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, color: '#333' }}>Security</h3>
          <div className="card">
            <div className="card-header">Password</div>
            {!changingPassword ? (
              <div>
                <p style={{ color: '#666', fontSize: 14, margin: '0 0 12px' }}>
                  {user?.password_changed_at
                    ? `Last changed ${(parseTimestamp(user.password_changed_at) || new Date(0)).toLocaleDateString()}`
                    : 'Manage your account password'}
                </p>
                <button onClick={() => setChangingPassword(true)}
                  style={{ padding: '8px 20px', background: '#fff', color: '#1b6b5a', border: '1px solid #1b6b5a', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                  Change Password
                </button>
              </div>
            ) : (
              <form onSubmit={handlePasswordChange}>
                {pwError && <div style={{ background: '#f8d7da', color: '#721c24', padding: 12, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{pwError}</div>}
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
                    style={{ padding: '8px 16px', background: '#fff', color: '#666', border: '1px solid #d0d0d0', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
                  <button type="submit" disabled={pwSaving}
                    style={{ padding: '8px 20px', background: pwSaving ? '#999' : '#1b6b5a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: pwSaving ? 'wait' : 'pointer' }}>
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
                  <span style={{ background: '#e0f2e9', color: '#1b6b5a', padding: '4px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600 }}>Enabled</span>
                  {twoFAStatus.setupDate && (
                    <span style={{ color: '#999', fontSize: 13 }}>since {(parseTimestamp(twoFAStatus.setupDate) || new Date(0)).toLocaleDateString()}</span>
                  )}
                </div>
                <p style={{ color: '#666', fontSize: 14, margin: '0 0 16px' }}>
                  Your account is protected with an authenticator app. You'll need a code each time you sign in from a new device.
                </p>

                {/* Disable 2FA */}
                <details style={{ marginTop: 8 }}>
                  <summary style={{ fontSize: 14, color: '#c00', cursor: 'pointer', fontWeight: 500 }}>Disable two-factor authentication</summary>
                  <form onSubmit={handleDisable2FA} style={{ marginTop: 12, maxWidth: 400 }}>
                    {pwError && <div style={{ background: '#f8d7da', color: '#721c24', padding: 12, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{pwError}</div>}
                    <p style={{ fontSize: 13, color: '#666', margin: '0 0 12px' }}>Enter a code from your authenticator app to confirm.</p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="000000" value={disableCode}
                        onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').substring(0, 6))}
                        style={{ ...inputStyle, maxWidth: 160, textAlign: 'center', letterSpacing: 4 }} />
                      <button type="submit" disabled={disabling2FA || disableCode.length < 6}
                        style={{ padding: '8px 20px', background: disabling2FA ? '#999' : '#dc3545', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        {disabling2FA ? 'Disabling...' : 'Disable 2FA'}
                      </button>
                    </div>
                  </form>
                </details>
              </div>
            ) : (
              <div>
                <p style={{ color: '#666', fontSize: 14, margin: '0 0 16px' }}>
                  Add an extra layer of security to your account. You'll need an authenticator app like Google Authenticator or Authy.
                </p>
                <button onClick={() => setShowSetup2FA(true)}
                  style={{ padding: '8px 20px', background: '#1b6b5a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                  Enable Two-Factor Authentication
                </button>
              </div>
            )}
          </div>

          {/* Passkeys / Biometric Login */}
          {passkeySupported && (
            <div className="card">
              <div className="card-header">Passkeys</div>
              <p style={{ color: '#666', fontSize: 14, margin: '0 0 16px' }}>
                Sign in with Face ID, Touch ID, Windows Hello, or a security key. Passkeys are more secure than passwords and skip 2FA.
              </p>
              {loadingPasskeys ? (
                <LoadingSpinner text="Loading passkeys..." />
              ) : (
                <div>
                  {passkeys.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      {passkeys.map((pk, i) => (
                        <div key={pk.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: i < passkeys.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                            <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#e0f2e9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1b6b5a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
                              </svg>
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: 14 }}>{pk.name}</div>
                              <div style={{ fontSize: 12, color: '#888' }}>
                                Added {(parseTimestamp(pk.createdAt) || new Date(0)).toLocaleDateString()}
                                {pk.lastUsed ? (' · Last used ' + (parseTimestamp(pk.lastUsed) || new Date(0)).toLocaleDateString()) : ''}
                              </div>
                            </div>
                          </div>
                          <button onClick={() => handleDeletePasskey(pk.id)}
                            style={{ padding: '6px 14px', background: '#fff', color: '#dc3545', border: '1px solid #dc3545', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {pwError && <div style={{ background: '#f8d7da', color: '#721c24', padding: 12, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{pwError}</div>}
                  {showPasskeyNameInput ? (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input type="text" value={passkeyName} onChange={(e) => setPasskeyName(e.target.value)}
                        placeholder="Name this passkey (e.g., MacBook Pro)" maxLength={50}
                        style={{ flex: 1, padding: '8px 12px', border: '1px solid #d0d0d0', borderRadius: 8, fontSize: 14 }} autoFocus />
                      <button onClick={handleRegisterPasskey} disabled={registeringPasskey}
                        style={{ padding: '8px 20px', background: registeringPasskey ? '#999' : '#1b6b5a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        {registeringPasskey ? 'Registering...' : 'Continue'}
                      </button>
                      <button onClick={() => { setShowPasskeyNameInput(false); setPwError(null); }}
                        style={{ padding: '8px 12px', background: '#f0f0f0', color: '#666', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setShowPasskeyNameInput(true)}
                      style={{ padding: '8px 20px', background: '#1b6b5a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                      Add a Passkey
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Linked Accounts */}
          <div className="card">
            <div className="card-header">Linked Accounts</div>
            {linkedAccounts.length > 0 ? (
              <div>
                {linkedAccounts.map((acct, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: i < linkedAccounts.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#f0f4f8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {acct.provider === 'google' ? (
                        <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                      ) : '🔗'}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, textTransform: 'capitalize' }}>{acct.provider}</div>
                      <div style={{ fontSize: 13, color: '#888' }}>{acct.email}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: '#666', fontSize: 14, margin: 0 }}>No linked accounts. You can link your Google account by signing in with Google.</p>
            )}
          </div>

          {/* Trusted Devices */}
          <div className="card">
            <div className="card-header">Trusted Devices</div>
            {!twoFAStatus.enabled ? (
              <p style={{ color: '#666', fontSize: 14, margin: 0 }}>
                Enable two-factor authentication to use trusted devices. Trusted devices let you skip the 2FA code for 30 days.
              </p>
            ) : loadingDevices ? (
              <LoadingSpinner text="Loading devices..." />
            ) : devices.length === 0 ? (
              <p style={{ color: '#666', fontSize: 14, margin: 0 }}>
                No trusted devices. When you sign in with 2FA and check "Remember this device," it will appear here.
              </p>
            ) : (
              <div>
                {devices.map((d, i) => (
                  <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '12px 0', borderBottom: i < devices.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{d.device_name || 'Unknown Device'}</div>
                      <div style={{ fontSize: 12, color: '#888' }}>
                        Last used: {(parseTimestamp(d.last_used) || new Date(0)).toLocaleDateString()} · Expires: {(parseTimestamp(d.expires_at) || new Date(0)).toLocaleDateString()}
                      </div>
                    </div>
                    <button onClick={() => revokeDevice(d.id)}
                      style={{ padding: '6px 14px', background: '#fff', color: '#dc3545', border: '1px solid #dc3545', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
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
          <div style={{ borderTop: '2px solid #e5e7eb', paddingTop: 16, marginTop: 16 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, color: '#333' }}>Notifications</h3>
          </div>
          {typeof NotificationSettings !== 'undefined' && React.createElement(NotificationSettings, null)}
          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Email Notifications</span>
              {savingNotifs && <span style={{ fontSize: 11, color: '#999' }}>Saving...</span>}
            </div>
            {['sessionUpdates', 'caregiverMessages', 'healthAlerts', 'reminderEmails'].map(key => (
              <label key={key} className="toggle-label">
                <input type="checkbox" className="toggle-input" checked={notifications[key]} onChange={(e) => handleNotificationChange(key, e.target.checked)} />
                <span>{key.replace(/([A-Z])/g, ' $1').trim()}</span>
              </label>
            ))}
          </div>
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-header">Push Notifications</div>
            <p style={{ padding: '0 16px', fontSize: 13, color: '#888', margin: '0 0 8px' }}>Choose which events send push notifications to your phone.</p>
            {[
              { key: 'push_messages', label: 'New messages' },
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
              <div style={{ borderTop: '2px solid #e5e7eb', paddingTop: 16, marginTop: 16 }}>
                <h3 style={{ margin: '0 0 12px', fontSize: 16, color: '#333' }}>Accessibility</h3>
                <div className="card" style={{ padding: 20, marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Text Size</div>
                  <div style={{ color: '#666', marginBottom: 16 }}>Choose a text size that works best for you.</div>
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
        </div>
      )}

      {/* ─── Payments Tab (Caregiver Only) ─── */}
      {activeTab === 'payments' && isCaregiver && (
        <div>
          {/* Your Rates Card */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">💰 Your Rates</div>
            {editRates && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#666', marginBottom: 4 }}>☀️ Daytime</div>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <span style={{ fontSize: 14, color: '#888', marginRight: 4 }}>$</span>
                      <input type="number" min="15" max="200" value={editRates.daytime}
                        onChange={(e) => setEditRates({...editRates, daytime: e.target.value})}
                        style={{ width: '100%', padding: '10px 12px', border: '1px solid #d0d0d0', borderRadius: 8, fontSize: 14 }} />
                    </div>
                    <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>6am–6pm</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#666', marginBottom: 4 }}>🌆 Evening</div>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <span style={{ fontSize: 14, color: '#888', marginRight: 4 }}>$</span>
                      <input type="number" min="15" max="200" value={editRates.nighttime}
                        onChange={(e) => setEditRates({...editRates, nighttime: e.target.value})}
                        style={{ width: '100%', padding: '10px 12px', border: '1px solid #d0d0d0', borderRadius: 8, fontSize: 14 }} />
                    </div>
                    <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>6pm–12am</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#666', marginBottom: 4 }}>🌙 Overnight</div>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <span style={{ fontSize: 14, color: '#888', marginRight: 4 }}>$</span>
                      <input type="number" min="15" max="200" value={editRates.overnight}
                        onChange={(e) => setEditRates({...editRates, overnight: e.target.value})}
                        style={{ width: '100%', padding: '10px 12px', border: '1px solid #d0d0d0', borderRadius: 8, fontSize: 14 }} />
                    </div>
                    <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>12am–6am</div>
                  </div>
                </div>
                <button onClick={handleSaveRates} disabled={savingRates}
                  style={{ padding: '8px 20px', background: savingRates ? '#999' : '#1b6b5a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                  {savingRates ? 'Saving...' : 'Update Rates'}
                </button>
              </div>
            )}
          </div>

          {/* Stripe Connect Card */}
          <div className="card">
            <div className="card-header">Stripe Connect</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{
                width: 12, height: 12, borderRadius: '50%',
                background: stripeStatus?.connected ? '#1b6b5a' : '#e8724a'
              }}></div>
              <span style={{ fontSize: 14, fontWeight: 500 }}>
                {stripeStatus?.connected ? 'Connected' : 'Not connected'}
              </span>
            </div>
            {stripeStatus?.connected ? (
              <a href="https://dashboard.stripe.com" target="_blank" rel="noopener noreferrer"
                style={{ padding: '8px 20px', background: '#1b6b5a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'inline-block', textDecoration: 'none' }}>
                View Stripe Dashboard
              </a>
            ) : (
              <button onClick={handleConnectStripe}
                style={{ padding: '8px 20px', background: '#1b6b5a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                Connect with Stripe
              </button>
            )}
          </div>

          {/* Payout Speed Card */}
          <div className="card">
            <div className="card-header">Payout Speed</div>
            <div style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                <input type="radio" name="payout" value="standard" checked={payoutPref === 'standard'}
                  onChange={(e) => setPayoutPref(e.target.value)} style={{ margin: 0 }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Standard (Free)</div>
                  <div style={{ fontSize: 12, color: '#888' }}>1-2 business days</div>
                </div>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                <input type="radio" name="payout" value="instant" checked={payoutPref === 'instant'}
                  onChange={(e) => setPayoutPref(e.target.value)} style={{ margin: 0 }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Instant (+2% fee)</div>
                  <div style={{ fontSize: 12, color: '#888' }}>Same day</div>
                </div>
              </label>
            </div>
            <button onClick={handleSavePayoutPref} disabled={savingPayout}
              style={{ padding: '8px 20px', background: savingPayout ? '#999' : '#1b6b5a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              {savingPayout ? 'Saving...' : 'Save Preference'}
            </button>
          </div>

          {/* Background Check Card */}
          <div className="card">
            <div className="card-header">Background Check</div>
            {bgCheckPaid ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>✓</span>
                <span style={{ fontSize: 14, color: '#1b6b5a', fontWeight: 600 }}>Background check complete</span>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: 14, color: '#666', margin: '0 0 12px' }}>
                  <span style={{ fontSize: 18, fontWeight: 800, color: '#1b6b5a' }}>$30</span> one-time fee. Refunded after 10 completed sessions.
                </p>
                <button style={{ padding: '8px 20px', background: '#1b6b5a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                  Pay Now
                </button>
              </div>
            )}
          </div>

          {/* Fee Breakdown Card */}
          <div className="card">
            <div className="card-header">Fee Breakdown</div>
            <div style={{ fontSize: 14, color: '#666', lineHeight: 1.6 }}>
              <p>
                <strong>Platform Fee:</strong> InPlace adds a <span style={{ fontSize: 18, fontWeight: 800, color: '#1b6b5a' }}>20%</span> platform fee to the family's cost. This does not reduce your earnings.
              </p>
              <p>
                <strong>Rush Surcharge:</strong> Short-notice bookings (less than 24 hours) include a <span style={{ fontSize: 18, fontWeight: 800, color: '#1b6b5a' }}>20%</span> rush surcharge. <span style={{ fontSize: 18, fontWeight: 800, color: '#1b6b5a' }}>75%</span> of the surcharge goes to you as an incentive.
              </p>
            </div>
          </div>

          {/* Hour Reports — moved from Dashboard */}
          <div style={{ borderTop: '2px solid #e5e7eb', paddingTop: 20, marginTop: 20 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, color: '#333' }}>📊 Hour Reports</h3>
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
            return React.createElement('div', { className: 'card', style: { background: '#fff5f5', border: '2px solid #e53e3e', marginBottom: 16 } },
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } },
                React.createElement('span', { style: { fontSize: 20 } }, '⚠️'),
                React.createElement('span', { style: { fontSize: 14, fontWeight: 700, color: '#c53030' } }, 'Expiring Soon')
              ),
              expiring.map((c, i) => {
                const exp = new Date(c.expiryDate);
                const expired = exp < now;
                return React.createElement('div', { key: i, style: { padding: '6px 0', fontSize: 13, color: expired ? '#c53030' : '#c05621' } },
                  React.createElement('span', { style: { fontWeight: 600 } }, c.certType || 'Certification'),
                  ' — ',
                  expired
                    ? React.createElement('span', { style: { fontWeight: 700, color: '#c53030' } }, 'EXPIRED ' + exp.toLocaleDateString())
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

                {isUploaded && uploaded.map(doc => (
                  <div key={doc.id} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#666', marginBottom: 4 }}>
                      <span>{doc.file_name || 'Document'}</span>
                      <span>·</span>
                      <span>Uploaded {new Date(doc.created_at).toLocaleDateString()}</span>
                    </div>
                    <button onClick={() => handleViewDocument(doc.id)}
                      style={{ padding: '4px 12px', background: docPreviews[doc.id] ? '#e8724a' : '#f0f0f0', color: docPreviews[doc.id] ? '#fff' : '#333', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', marginRight: 8 }}>
                      {docPreviews[doc.id] ? 'Hide' : 'View'}
                    </button>
                    {docPreviews[doc.id] && (
                      <div style={{ marginTop: 8, borderRadius: 8, overflow: 'hidden', border: '1px solid #ddd' }}>
                        <img src={docPreviews[doc.id]} alt={docLabel} style={{ width: '100%', maxHeight: 300, objectFit: 'contain', background: '#f9f9f9' }} />
                      </div>
                    )}
                  </div>
                ))}

                <button onClick={() => {
                  setPendingAcctDocType(docType);
                  acctDocInputRef.current?.click();
                }}
                  disabled={docUploading === docType}
                  style={{ padding: '8px 16px', background: '#1b6b5a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: docUploading === docType ? 0.7 : 1 }}>
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
                    <div style={{ fontSize: 12, color: '#666' }}>
                      {cert.certNumber && <span>#{cert.certNumber} </span>}
                      {cert.issuer && <span>· {cert.issuer} </span>}
                    </div>
                    {exp && (
                      <div style={{ fontSize: 12, marginTop: 2, fontWeight: isExpired || isSoon ? 700 : 400,
                        color: isExpired ? '#c53030' : isSoon ? '#c05621' : '#666' }}>
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
      {activeTab === 'preferences' && isCaregiver && (
        <div>
          {preferences && (
            <div>
              {[
                { key: 'personal_hygiene', label: 'Personal hygiene' },
                { key: 'meal_preparation', label: 'Meal preparation' },
                { key: 'medication_reminders', label: 'Medication reminders' },
                { key: 'light_housekeeping', label: 'Light housekeeping' },
                { key: 'transportation', label: 'Transportation' },
                { key: 'companionship', label: 'Companionship' },
                { key: 'memory_care', label: 'Memory care' },
                { key: 'mobility_assistance', label: 'Mobility assistance' },
                { key: 'overnight_care', label: 'Overnight care' },
                { key: 'pet_friendly_homes', label: 'Pet-friendly homes' },
              ].map(({ key, label }) => (
                <div key={key} className="card" style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{label}</div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input type="radio" name={key} value="green" checked={preferences[key] === 'green'}
                        onChange={() => setPreferences({ ...preferences, [key]: 'green' })} />
                      <span style={{ fontSize: 18 }}>🟢</span>
                      <span style={{ fontSize: 13 }}>Comfortable</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input type="radio" name={key} value="yellow" checked={preferences[key] === 'yellow'}
                        onChange={() => setPreferences({ ...preferences, [key]: 'yellow' })} />
                      <span style={{ fontSize: 18 }}>🟡</span>
                      <span style={{ fontSize: 13 }}>Willing w/ Support</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input type="radio" name={key} value="red" checked={preferences[key] === 'red'}
                        onChange={() => setPreferences({ ...preferences, [key]: 'red' })} />
                      <span style={{ fontSize: 18 }}>🔴</span>
                      <span style={{ fontSize: 13 }}>Not Comfortable</span>
                    </label>
                  </div>
                </div>
              ))}
              <button onClick={handleSavePreferences} disabled={savingPrefs}
                style={{ padding: '12px 24px', background: savingPrefs ? '#999' : '#1b6b5a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', width: '100%' }}>
                {savingPrefs ? 'Saving...' : 'Save Preferences'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Add a Role — merged into "Your Profiles" section in Profile card above */}

      {/* Remove a Role — only for non-demo users with multiple roles */}
      {!isDemo && user && (() => {
        const currentRoles = user.roles || [user.role];
        if (currentRoles.length <= 1) return null;
        const roleLabels = { family: 'Family / Care Team', caregiver: 'Caregiver', care_for: 'Care Recipient' };
        const roleIcons = { family: '👪', caregiver: '💼', care_for: '🏠' };
        return React.createElement('div', { className: 'card', style: { marginTop: 20, padding: 20, border: '1px solid #fdd' } },
          React.createElement('div', { className: 'card-header', style: { marginBottom: 12, color: '#c62828' } }, 'Remove a Role'),
          React.createElement('p', { style: { fontSize: 13, color: '#888', margin: '0 0 16px' } },
            'Remove a role you no longer need. Your account and other roles will remain intact.'
          ),
          currentRoles.map(r =>
            React.createElement('div', {
              key: r,
              style: {
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', marginBottom: 6, background: '#fff',
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
                        if (window.setActiveRole) window.setActiveRole(data.primaryRole || ur[0]);
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
                  borderRadius: 6, color: '#c62828', fontSize: 12, fontWeight: 500,
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
          width: '100%', padding: '14px 20px', background: '#fff', color: '#c62828',
          border: '1px solid #e0e0e0', borderRadius: 10, fontSize: 15, fontWeight: 600,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          🚪 Log Out
        </button>
      </div>

      {/* Delete Account — not for demo accounts */}
      {!isDemo && (
        <DeleteAccountSection onDeleted={handleLogoutFromAccount} />
      )}

      <div style={{ textAlign: 'center', marginTop: 10, fontSize: 11, color: '#bbb' }}>
        v{window.APP_VERSION || '?'}
      </div>
    </div>
  );
};
