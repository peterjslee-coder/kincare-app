const ResetPasswordPage = window.ResetPasswordPage = ({ token, onNavigate }) => {
  const [password, setPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setResetting(true);
    setError('');
    trackAuthEvent('password_reset', 'reset_submit', {});
    try {
      const res = await apiFetch('/api/password-reset/confirm', {
        method: 'POST',
        body: JSON.stringify({ token, password })
      });
      if (res.error) {
        trackAuthEvent('password_reset', 'error', { error: res.error, source: 'api' });
        setError(res.error);
        setResetting(false);
        return;
      }
      trackAuthEvent('password_reset', 'reset_success', {});
      setSuccess(true);
    } catch (err) {
      trackAuthEvent('password_reset', 'error', { error: err.message || 'Network error', source: 'network' });
      setError('Something went wrong. Please try again.');
      setResetting(false);
    }
  };

  if (success) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <div style={{ marginBottom: '16px' }}>
              <InPlaceIcon width={50} height={50} />
            </div>
            <h1 style={{ color: '#1b6b5a' }}>You're all set!</h1>
            <p style={{ color: '#555', lineHeight: '1.6', marginTop: '12px' }}>
              Your new password is saved. Sign in to continue.
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => onNavigate('login')} style={{ width: '100%', marginTop: '16px' }}>
            Sign In
          </button>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <div style={{ marginBottom: '16px' }}>
              <InPlaceIcon width={50} height={50} />
            </div>
            <h1>Invalid Reset Link</h1>
            <p style={{ color: '#555', lineHeight: '1.6', marginTop: '12px' }}>
              This password reset link is invalid or has expired. Please request a new one.
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => onNavigate('forgot-password')} style={{ width: '100%', marginTop: '16px' }}>
            Request New Reset Link
          </button>
          <div style={{ textAlign: 'center', marginTop: '12px' }}>
            <a onClick={() => onNavigate('login')} style={{ color: '#1b6b5a', cursor: 'pointer', fontSize: '14px' }}>Back to Sign In</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <div style={{ marginBottom: '16px' }}>
            <InPlaceIcon width={50} height={50} />
          </div>
          <h1>Create New Password</h1>
          <p style={{ color: '#888' }}>Choose a password you'll remember</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>New Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                autoFocus
                style={{ paddingRight: '60px' }}
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', color: '#1b6b5a', cursor: 'pointer',
                  fontSize: '13px', fontWeight: 600, padding: '4px 8px',
                }}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            {password && password.length > 0 && password.length < 6 && (
              <div style={{ fontSize: '12px', color: '#c0392b', marginTop: '4px' }}>
                Password must be at least 6 characters
              </div>
            )}
          </div>
          {error && (
            <div style={{ color: '#c0392b', fontSize: '14px', marginBottom: '12px', padding: '10px', background: '#fdf0ed', borderRadius: '6px' }}>
              {error}
            </div>
          )}
          <button type="submit" className="btn btn-primary" disabled={resetting || password.length < 6}
            style={{ width: '100%', opacity: (resetting || password.length < 6) ? 0.6 : 1 }}>
            {resetting ? 'Saving...' : 'Save New Password'}
          </button>
        </form>
      </div>
    </div>
  );
};
