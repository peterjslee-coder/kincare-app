const MyAccount = window.MyAccount = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editData, setEditData] = useState({});
  const [notifications, setNotifications] = useState({
    sessionUpdates: true, caregiverMessages: true, healthAlerts: true, reminderEmails: false
  });
  const [savingNotifs, setSavingNotifs] = useState(false);
  const { showToast } = useToast();

  const fetchUser = async () => {
    try {
      const res = await apiFetch('/api/auth/me');
      if (res?.ok) {
        const data = await res.json();
        setUser(data.user);
        // Load notification prefs if they exist
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

  useEffect(() => { fetchUser(); }, []);

  const roleLabels = { family: 'Family Member', caregiver: 'Caregiver', care_for: 'Care Recipient' };

  const startEditing = () => {
    setEditData({
      firstName: user?.first_name || '',
      lastName: user?.last_name || '',
      phone: user?.phone || '',
    });
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
  };

  const saveProfile = async () => {
    setSaving(true);
    try {
      const res = await apiFetch('/api/auth/me', {
        method: 'PUT',
        body: JSON.stringify({
          firstName: editData.firstName,
          lastName: editData.lastName,
          phone: editData.phone,
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
      console.error('Save profile error:', err);
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
      if (res?.ok) {
        showToast('Notification preferences saved', 'success');
      }
    } catch (err) {
      console.error('Save notifications error:', err);
    }
    setSavingNotifs(false);
  };

  const ed = (field, val) => setEditData({ ...editData, [field]: val });

  if (loading) return <LoadingSpinner text="Loading account..." />;

  const inputStyle = { width: '100%', padding: '10px 12px', border: '1px solid #d0d0d0', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' };
  const fieldLabel = { fontSize: 12, fontWeight: 600, color: '#666', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h1 className="greeting">👤 My Account</h1>
        {!editing ? (
          <button onClick={startEditing} style={{ padding: '8px 20px', background: '#1b6b5a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            Edit Profile
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={cancelEditing} style={{ padding: '8px 16px', background: '#fff', color: '#666', border: '1px solid #d0d0d0', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
            <button onClick={saveProfile} disabled={saving} style={{ padding: '8px 20px', background: saving ? '#999' : '#1b6b5a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: saving ? 'wait' : 'pointer' }}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-header">📋 Profile Information</div>
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
              <div className="info-value">{user && user.phone ? user.phone : 'Not set'}</div>
            </div>
            <div className="info-item">
              <div className="info-label">Account Type</div>
              <div className="info-value">{user ? (roleLabels[user.role] || user.role) : '—'}</div>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-header">💳 Subscription</div>
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
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>🔔 Notifications</span>
          {savingNotifs && <span style={{ fontSize: 11, color: '#999' }}>Saving...</span>}
        </div>
        {Object.keys(notifications).map(key => (
          <label key={key} className="toggle-label">
            <input type="checkbox" className="toggle-input" checked={notifications[key]} onChange={(e) => handleNotificationChange(key, e.target.checked)} />
            <span>{key.replace(/([A-Z])/g, ' $1').trim()}</span>
          </label>
        ))}
      </div>

      <div className="card">
        <div className="card-header">🔐 Security</div>
        <button className="btn btn-secondary" style={{ marginBottom: '12px' }}>Change Password</button>
        <button className="btn btn-outline">Enable Two-Factor Authentication</button>
      </div>
    </div>
  );
};
