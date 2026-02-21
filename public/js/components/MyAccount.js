// ─── Delete Account Section ───
const DeleteAccountSection = ({ onDeleted }) => {
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  const handleDelete = async () => {
    if (confirmText !== 'DELETE') return;
    setDeleting(true);
    setError(null);
    try {
      const res = await apiFetch('/api/auth/me', { method: 'DELETE' });
      if (res?.ok) {
        onDeleted();
      } else {
        const data = await res?.json();
        setError(data?.error || 'Failed to delete account');
      }
    } catch (err) {
      setError('Network error — please try again');
    }
    setDeleting(false);
  };

  return (
    <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid #fdd' }}>
      {!showConfirm ? (
        <button onClick={() => setShowConfirm(true)} style={{
          width: '100%', padding: '12px 20px', background: '#fff', color: '#999',
          border: '1px solid #e0e0e0', borderRadius: 10, fontSize: 13, fontWeight: 500,
          cursor: 'pointer',
        }}>
          Delete My Account
        </button>
      ) : (
        <div style={{ padding: '16px', background: '#fff8f8', borderRadius: '10px', border: '1px solid #fdd' }}>
          <div style={{ fontSize: '15px', fontWeight: 600, color: '#c62828', marginBottom: '8px' }}>
            Delete Account Permanently
          </div>
          <p style={{ fontSize: '13px', color: '#666', margin: '0 0 12px', lineHeight: '1.5' }}>
            This will permanently remove your account and all associated data. This action cannot be undone.
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
            <button onClick={() => { setShowConfirm(false); setConfirmText(''); setError(null); }} style={{
              flex: 1, padding: '10px', background: '#f0f0f0', color: '#555', border: 'none',
              borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            }}>Cancel</button>
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
  const [activeTab, setActiveTab] = useState('profile');
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
  const resizeImage = (file, maxSize = 400, quality = 0.8) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > h) { if (w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; } }
        else { if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize; } }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
      img.src = url;
    });
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
      showToast('Upload failed', 'error');
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

  useEffect(() => { fetchUser(); fetch2FAStatus(); }, []);

  useEffect(() => {
    if (activeTab === 'devices') fetchDevices();
  }, [activeTab]);

  const roleLabels = { family: 'Family Member', caregiver: 'Caregiver', care_for: 'Care Recipient' };

  const startEditing = () => {
    setEditData({
      firstName: user?.first_name || '',
      lastName: user?.last_name || '',
      phone: user?.phone || '',
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
          phone: editData.phone,
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
  const tabs = isDemo
    ? [{ id: 'profile', label: 'Profile' }, { id: 'notifications', label: 'Notifications' }]
    : [{ id: 'profile', label: 'Profile' }, { id: 'security', label: 'Security' }, { id: 'devices', label: 'Devices' }, { id: 'notifications', label: 'Notifications' }];

  const handleLogoutFromAccount = () => {
    localStorage.removeItem('auth_token');
    AUTH_TOKEN = null;
    if (typeof disconnectSocket === 'function') disconnectSocket();
    window.location.reload();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h1 className="greeting">My Account</h1>
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
                  <div style={fieldLabel}>Phone</div>
                  <input type="tel" style={inputStyle} value={editData.phone} onChange={(e) => ed('phone', e.target.value)} placeholder="(555) 123-4567" />
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
                  <div className="info-value">{user?.phone || 'Not set'}</div>
                </div>
                <div className="info-item">
                  <div className="info-label">Account Type</div>
                  <div className="info-value">
                    {user ? (roleLabels[user.role] || user.role) : '—'}
                    {isDemo && <span style={{ marginLeft: 8, fontSize: 11, background: '#fff3cd', color: '#856404', padding: '2px 8px', borderRadius: 12 }}>Demo</span>}
                  </div>
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

          {!editing && (
            <div className="card">
              <div className="card-header">Health & Safety</div>
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
            </div>
          )}
        </div>
      )}

      {/* ─── Security Tab ─── */}
      {activeTab === 'security' && !isDemo && (
        <div>
          {/* Password Change */}
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
        </div>
      )}

      {/* ─── Devices Tab ─── */}
      {activeTab === 'devices' && !isDemo && (
        <div>
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
                  <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: i < devices.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{d.device_name || 'Unknown Device'}</div>
                      <div style={{ fontSize: 12, color: '#888' }}>
                        Last used: {(parseTimestamp(d.last_used) || new Date(0)).toLocaleDateString()} · Expires: {(parseTimestamp(d.expires_at) || new Date(0)).toLocaleDateString()}
                      </div>
                    </div>
                    <button onClick={() => revokeDevice(d.id)}
                      style={{ padding: '6px 14px', background: '#fff', color: '#dc3545', border: '1px solid #dc3545', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Notifications Tab ─── */}
      {activeTab === 'notifications' && (
        <div>
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
        </div>
      )}

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
