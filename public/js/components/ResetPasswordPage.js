const ResetPasswordPage = window.ResetPasswordPage = ({ token, onNavigate }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Live password rule checks
  const rules = [
    { label: '8+ characters', met: password.length >= 8 },
    { label: 'Uppercase letter', met: /[A-Z]/.test(password) },
    { label: 'Number', met: /[0-9]/.test(password) },
    { label: 'Special character', met: /[^A-Za-z0-9]/.test(password) },
  ];
  const allRulesMet = rules.every(r => r.met);
  const passwordsMatch = password && confirmPassword && password === confirmPassword;
  const canSubmit = allRulesMet && passwordsMatch && !resetting;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!allRulesMet) { setError('Please meet all password requirements'); return; }
    if (!passwordsMatch) { setError('Passwords do not match'); return; }
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
            <h1 style={{ color: 'var(--role-color)' }}>You're all set!</h1>
            <p style={{ color: 'var(--text-secondary)', lineHeight: '1.6', marginTop: '12px' }}>
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
            <p style={{ color: 'var(--text-secondary)', lineHeight: '1.6', marginTop: '12px' }}>
              This password reset link is invalid or has expired. Please request a new one.
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => onNavigate('forgot-password')} style={{ width: '100%', marginTop: '16px' }}>
            Request New Reset Link
          </button>
          <div style={{ textAlign: 'center', marginTop: '12px' }}>
            <a onClick={() => onNavigate('login')} style={{ color: 'var(--role-color)', cursor: 'pointer', fontSize: '14px' }}>Back to Sign In</a>
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
          <p style={{ color: 'var(--text-tertiary)' }}>Your password has been reset. Choose a new one below.</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>New Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter new password"
                autoFocus
                style={{ paddingRight: '60px' }}
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', color: 'var(--role-color)', cursor: 'pointer',
                  fontSize: '13px', fontWeight: 600, padding: '4px 8px',
                }}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            {password.length > 0 && (
              <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {rules.map((r, i) => (
                  <span key={i} style={{
                    fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '10px',
                    background: r.met ? 'var(--color-success-bg)' : 'var(--bg-error-subtle)',
                    color: r.met ? 'var(--color-success)' : 'var(--color-error)',
                  }}>
                    {r.met ? '\u2713' : '\u2717'} {r.label}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="form-group">
            <label>Confirm Password</label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
            />
            {confirmPassword && !passwordsMatch && (
              <div style={{ fontSize: '12px', color: 'var(--color-error)', marginTop: '4px' }}>
                Passwords do not match
              </div>
            )}
            {passwordsMatch && (
              <div style={{ fontSize: '12px', color: 'var(--color-success)', marginTop: '4px' }}>
                Passwords match
              </div>
            )}
          </div>
          {error && (
            <div style={{ color: 'var(--color-error)', fontSize: '14px', marginBottom: '12px', padding: '10px', background: 'var(--bg-accent-light)', borderRadius: '6px' }}>
              {error}
            </div>
          )}
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}
            style={{ width: '100%', opacity: canSubmit ? 1 : 0.6 }}>
            {resetting ? 'Saving...' : 'Save New Password'}
          </button>
        </form>
      </div>
    </div>
  );
};
