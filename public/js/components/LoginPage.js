const LoginPage = window.LoginPage = ({ onLogin, onNavigate }) => {
  const [email, setEmail] = useState('pete@inplace.care');
  const [password, setPassword] = useState('inplace123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const demoAccounts = [
    { label: 'Pete (Family)', email: 'pete@inplace.care', icon: '👨‍👩‍👦', desc: 'Care coordinator' },
    { label: 'Maria (Caregiver)', email: 'maria@inplace.care', icon: '🩺', desc: 'Professional caregiver' },
    { label: 'Betty (Cared-For)', email: 'betty@inplace.care', icon: '👵', desc: 'Care recipient' },
  ];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      if (!response || !response.ok) throw new Error('Login failed');
      const data = await response.json();
      if (data.token && data.user) {
        setAuthToken(data.token);
        onLogin(data.user);
      }
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleQuickLogin = async (acct) => {
    setEmail(acct.email);
    setPassword('inplace123');
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: acct.email, password: 'inplace123' })
      });
      if (!response || !response.ok) throw new Error('Login failed');
      const data = await response.json();
      if (data.token && data.user) {
        setAuthToken(data.token);
        onLogin(data.user);
      }
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <InPlaceIcon width={48} height={48} />
          <div style={{ marginTop: '12px', fontFamily: "'DM Sans', sans-serif", fontSize: '28px', letterSpacing: '-1.5px', lineHeight: 1 }}>
            <span style={{ fontWeight: 200, color: '#999' }}>in</span><span style={{ fontWeight: 800, color: '#1b6b5a' }}>Place</span>
          </div>
        </div>
        <h2>Welcome Back</h2>
        <p className="login-subtitle">Sign in to manage care for your loved ones</p>

        {/* Demo Quick-Switch */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '12px', textTransform: 'uppercase', color: '#888', fontWeight: 600, letterSpacing: '0.5px', marginBottom: '10px', textAlign: 'center' }}>
            Demo Accounts
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {demoAccounts.map(acct => (
              <button
                key={acct.email}
                onClick={() => handleQuickLogin(acct)}
                disabled={loading}
                style={{
                  flex: 1,
                  padding: '10px 6px',
                  background: email === acct.email ? '#e8f5f1' : '#f8f9fa',
                  border: email === acct.email ? '2px solid #1b6b5a' : '2px solid #e0e0e0',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  textAlign: 'center',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ fontSize: '22px', marginBottom: '4px' }}>{acct.icon}</div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#333' }}>{acct.label}</div>
                <div style={{ fontSize: '10px', color: '#888', marginTop: '2px' }}>{acct.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div style={{ position: 'relative', textAlign: 'center', margin: '16px 0' }}>
          <div style={{ borderTop: '1px solid #e0e0e0' }}></div>
          <span style={{ position: 'relative', top: '-10px', background: '#fff', padding: '0 12px', color: '#aaa', fontSize: '12px' }}>or sign in manually</span>
        </div>

        {error && <div style={{ background: '#f8d7da', color: '#721c24', padding: '12px', borderRadius: '6px', marginBottom: '16px', fontSize: '13px' }}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button type="submit" className="login-button" disabled={loading}>{loading ? 'Signing in...' : 'Sign In'}</button>
        </form>
        <div style={{ textAlign: 'right', marginTop: '8px' }}>
          <a onClick={() => onNavigate('forgot-password')} style={{ fontSize: '13px', color: '#1b6b5a', cursor: 'pointer' }}>Forgot password?</a>
        </div>
        <div className="login-back-link">
          <a onClick={() => onNavigate('splash')}>← Back to home</a>
        </div>
        <div className="login-links">
          Don't have an account? <a onClick={() => onNavigate('register')}>Create an Account</a>
        </div>
      </div>
    </div>
  );
};
