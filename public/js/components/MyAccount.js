const MyAccount = window.MyAccount = () => {
  const [notifications, setNotifications] = useState({
    sessionUpdates: true, caregiverMessages: true, healthAlerts: true, reminderEmails: false
  });

  return (
    <div>
      <h1 className="greeting">👤 My Account</h1>
      <div className="card">
        <div className="card-header">📋 Profile Information</div>
        <div className="info-grid">
          <div className="info-item">
            <div className="info-label">Name</div>
            <div className="info-value">Pete Anderson</div>
          </div>
          <div className="info-item">
            <div className="info-label">Email</div>
            <div className="info-value">pete@inplace.care</div>
          </div>
          <div className="info-item">
            <div className="info-label">Phone</div>
            <div className="info-value">(555) 123-4567</div>
          </div>
          <div className="info-item">
            <div className="info-label">Account Type</div>
            <div className="info-value">Family Member</div>
          </div>
        </div>
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
        <div className="card-header">🔔 Notifications</div>
        {Object.keys(notifications).map(key => (
          <label key={key} className="toggle-label">
            <input type="checkbox" className="toggle-input" checked={notifications[key]} onChange={(e) => setNotifications({...notifications, [key]: e.target.checked})} />
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
