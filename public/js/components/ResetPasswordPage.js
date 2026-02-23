const ResetPasswordPage = window.ResetPasswordPage = ({ token, onNavigate }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
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
            <h1>Password Reset!</h1>
            <p style={{ color: '#555', lineHeight: '1.6', marginTop: '12px' }}>
              Your password has been updated. You can now sign in with your new password.
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => onNavigate('login')} style={{ width: '100%', marginTop: '16px' }}>
            Sign In
          </button>
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
          <h1>Choose New Password</h1>
          <p style={{ color: '#888' }}>Enter your new password below</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>New Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              autoFocus
            />
            {password && password.length < 6 && <div style={{ fontSize: '12px', color: '#c0392b', marginTop: '4px' }}>Password must be at least 6 characters</div>}
          </div>
          <div className="form-group">
            <label>Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
            />
            {confirmPassword && password !== confirmPassword && <div style={{ fontSize: '12px', color: '#c0392b', marginTop: '4px' }}>Passwords do not match</div>}
          </div>
          {error && <div style={{ color: '#c0392b', fontSize: '14px', marginBottom: '12px', padding: '10px', background: '#fdf0ed', borderRadius: '6px' }}>{error}</div>}
          <button type="submit" className="btn btn-primary" disabled={resetting} style={{ width: '100%', opacity: resetting ? 0.6 : 1 }}>
            {resetting ? 'Resetting...' : 'Reset Password'}
          </button>
        </form>
      </div>
    </div>
  );
};
