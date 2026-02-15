const LoginPage = window.LoginPage = ({ onLogin, onNavigate }) => {
  const [email, setEmail] = useState('pete@kincare.app');
  const [password, setPassword] = useState('kincare123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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

  return (
    <div className="login-container">
      <div className="login-card">
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <KinCareIcon width={50} height={50} />
        </div>
        <h2>Welcome to KinCare</h2>
        <p className="login-subtitle">Sign in to manage care for your loved ones</p>
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
