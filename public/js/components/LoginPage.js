const LoginPage = window.LoginPage = ({ onLogin, onNavigate, banner, onDismissBanner, inviteInfo }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [failCount, setFailCount] = useState(0);
  const [showDemo, setShowDemo] = useState(false);
  const [googleAvailable, setGoogleAvailable] = useState(false);

  // 2FA state
  const [show2FA, setShow2FA] = useState(false);
  const [tempToken, setTempToken] = useState(null);
  const [twoFACode, setTwoFACode] = useState('');
  const [rememberDevice, setRememberDevice] = useState(false);

  // Password change state
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [pendingUser, setPendingUser] = useState(null);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');

  // Passkey state
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);

  // Check if Google OAuth is configured + passkey availability + handle OAuth redirects
  useEffect(() => {
    apiFetch('/api/oauth/config').then(res => {
      if (res?.ok) res.json().then(data => setGoogleAvailable(data.google));
    }).catch(() => {});

    // Check if WebAuthn/passkeys are supported in this browser
    if (window.PublicKeyCredential) {
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.()
        .then(available => setPasskeyAvailable(available || !!window.PublicKeyCredential))
        .catch(() => setPasskeyAvailable(!!window.PublicKeyCredential));
    }

    const params = new URLSearchParams(window.location.search);
    const oauthCode = params.get('oauth_code');
    const oauthError = params.get('oauth_error');

    if (oauthCode) {
      window.history.replaceState({}, '', window.location.pathname);
      apiFetch('/api/oauth/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: oauthCode }),
      })
        .then(r => r.json())
        .then(data => {
          if (data.token && data.user) {
            setAuthToken(data.token);
            trackAuthEvent('login', 'oauth_success', { email: data.user.email, provider: 'google' });
            onLogin(data.user);
          } else {
            setError('Google sign-in failed. Please try again.');
            trackAuthEvent('login', 'error', { error: data.error || 'exchange_failed', source: 'oauth' });
          }
        })
        .catch(e => {
          console.error('OAuth exchange error:', e);
          setError('Google sign-in failed. Please try again.');
          trackAuthEvent('login', 'error', { error: 'OAuth exchange error', source: 'oauth_callback' });
        });
    }
    if (oauthError) {
      trackAuthEvent('login', 'error', { error: 'Google sign-in failed', source: 'oauth' });
      setError('Google sign-in failed. Please try again.');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const getDeviceFingerprint = () => {
    const data = [navigator.userAgent, screen.width + 'x' + screen.height, Intl.DateTimeFormat().resolvedOptions().timeZone].join('|');
    let hash = 0;
    for (let i = 0; i < data.length; i++) { hash = ((hash << 5) - hash) + data.charCodeAt(i); hash = hash & hash; }
    return 'dev_' + Math.abs(hash).toString(36);
  };

  const demoAccounts = [
    { label: 'Paul (Family)', email: 'paul@inplace.care', icon: '👨‍👩‍👦', desc: 'Care coordinator' },
    { label: 'Maria (Caregiver)', email: 'maria@inplace.care', icon: '🤝', desc: 'Professional caregiver' },
    { label: 'Barbara (Cared-For)', email: 'barbara@inplace.care', icon: '🌷', desc: 'Care recipient' },
    { label: 'David (Brother)', email: 'david.lowe@inplace.care', icon: '👨', desc: "Paul's brother" },
    { label: 'Susan (Sister)', email: 'susan.lowe@inplace.care', icon: '👩', desc: "Paul's sister" },
  ];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setErrorCode(null);
    trackAuthEvent('login', 'login_attempt', { email });
    try {
      const response = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, deviceFingerprint: getDeviceFingerprint() })
      });
      if (!response) throw new Error('Login failed');
      const data = await response.json();
      if (!response.ok) {
        const err = new Error(data?.error || 'Login failed');
        err.code = data?.code || null;
        throw err;
      }

      // Success — reset fail count
      setFailCount(0);

      if (data.requires2FA) {
        trackAuthEvent('login', '2fa_prompted', { email });
        setTempToken(data.tempToken);
        setShow2FA(true);
        setLoading(false);
        return;
      }

      if (data.mustChangePassword) {
        trackAuthEvent('login', 'password_change_required', { email });
        setPendingUser(data.user);
        setCurrentPw(password);
        setAuthToken(data.token);
        setShowPasswordChange(true);
        setLoading(false);
        return;
      }

      if (data.token && data.user) {
        trackAuthEvent('login', 'login_success', { email, role: data.user.role });
        setAuthToken(data.token);
        onLogin(data.user);
      }
    } catch (err) {
      const newCount = failCount + 1;
      setFailCount(newCount);
      setErrorCode(err.code || null);
      trackAuthEvent('login', 'error', { email, error: err.message, code: err.code, failCount: newCount, source: 'login_submit' });
      setError(err.message);
    }
    setLoading(false);
  };

  const handle2FASubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    trackAuthEvent('login', '2fa_attempt', { email });
    try {
      const response = await apiFetch('/api/auth/2fa/verify', {
        method: 'POST',
        body: JSON.stringify({
          tempToken, code: twoFACode,
          deviceFingerprint: rememberDevice ? getDeviceFingerprint() : null,
          rememberDevice,
        })
      });
      if (!response) throw new Error('Verification failed');
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Verification failed');
      if (data.token && data.user) {
        trackAuthEvent('login', '2fa_success', { email, rememberDevice });
        setAuthToken(data.token);
        onLogin(data.user);
      }
    } catch (err) {
      trackAuthEvent('login', 'error', { email, error: err.message, source: '2fa_verify' });
      setError(err.message);
    }
    setLoading(false);
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (newPw !== confirmPw) { setError('Passwords do not match'); return; }
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw })
      });
      if (!response) throw new Error('Password change failed');
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Password change failed');
      trackAuthEvent('login', 'password_changed', { email });
      onLogin(pendingUser);
    } catch (err) {
      trackAuthEvent('login', 'error', { email, error: err.message, source: 'password_change' });
      setError(err.message);
    }
    setLoading(false);
  };

  const handleQuickLogin = async (acct) => {
    setEmail(acct.email);
    setLoading(true);
    setError(null);
    trackAuthEvent('demo', 'demo_login', { email: acct.email, label: acct.label, source: 'login_page' });
    try {
      const response = await apiFetch('/api/auth/demo-login', {
        method: 'POST',
        body: JSON.stringify({ email: acct.email })
      });
      if (!response || !response.ok) throw new Error('Login failed');
      const data = await response.json();
      if (data.token && data.user) { setAuthToken(data.token); onLogin(data.user); }
    } catch (err) {
      trackAuthEvent('demo', 'error', { email: acct.email, error: err.message, source: 'quick_login' });
      setError(err.message);
    }
    setLoading(false);
  };

  const handlePasskeyLogin = async () => {
    setLoading(true);
    setError(null);
    trackAuthEvent('login', 'passkey_attempt', {});
    try {
      const SimpleWebAuthnBrowser = window.SimpleWebAuthnBrowser;
      if (!SimpleWebAuthnBrowser) throw new Error('Passkey support not loaded');

      // Get authentication options from server (use raw fetch to bypass apiFetch's 401→null behavior)
      const apiBase = window.location.origin;
      const optRes = await fetch(apiBase + '/api/passkeys/authenticate/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email || null }),
      });
      if (!optRes.ok) {
        const errBody = await optRes.json().catch(() => ({}));
        throw new Error(errBody?.error || `Passkey login failed (${optRes.status})`);
      }
      const options = await optRes.json();
      const challengeKey = options._challengeKey;

      // Trigger browser passkey/biometric prompt
      const authResp = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: options });

      // Send response to server for verification (raw fetch — no auth needed)
      const verifyRes = await fetch(apiBase + '/api/passkeys/authenticate/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...authResp, _challengeKey: challengeKey }),
      });
      if (!verifyRes.ok) {
        const errData = await verifyRes.json().catch(() => ({}));
        throw new Error(errData?.error || 'Passkey verification failed');
      }
      const data = await verifyRes.json();
      if (data.token && data.user) {
        trackAuthEvent('login', 'passkey_success', { email: data.user.email });
        setAuthToken(data.token);
        onLogin(data.user);
      }
    } catch (err) {
      // Don't show error if user cancelled the prompt
      if (err.name === 'NotAllowedError') {
        trackAuthEvent('login', 'passkey_cancelled', {});
      } else {
        trackAuthEvent('login', 'error', { error: err.message, source: 'passkey' });
        setError(err.message);
      }
    }
    setLoading(false);
  };

  const cardStyle = { background: 'var(--bg-surface)', borderRadius: 12, padding: 32, maxWidth: 420, width: '100%' };
  const inputStyle = { width: '100%', padding: '12px 14px', border: '1px solid #d0d0d0', borderRadius: 8, fontSize: 15, fontFamily: 'inherit', boxSizing: 'border-box' };
  const primaryBtn = { width: '100%', padding: 12, background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 15, cursor: 'pointer' };
  const googleBtnStyle = { width: '100%', padding: 12, background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid #d0d0d0', borderRadius: 8, fontWeight: 600, fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 };

  // ─── 2FA Verification Screen ───
  if (show2FA) {
    return (
      <div className="login-container">
        <div className="login-card" style={cardStyle}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <InPlaceIcon width={48} height={48} />
            <h2 style={{ marginTop: 12, marginBottom: 4 }}>Two-Factor Authentication</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: 0 }}>Enter the code from your authenticator app</p>
          </div>
          {error && <div style={{ background: 'var(--color-error-bg)', color: 'var(--color-error)', padding: 12, borderRadius: 6, marginBottom: 16, fontSize: 13 }}>{error}</div>}
          <form onSubmit={handle2FASubmit}>
            <div style={{ marginBottom: 16 }}>
              <input type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="000000" value={twoFACode}
                onChange={(e) => setTwoFACode(e.target.value.replace(/[^0-9a-f]/gi, '').substring(0, 8))}
                style={{ ...inputStyle, textAlign: 'center', fontSize: 24, letterSpacing: 8 }} autoFocus />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: 14, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={rememberDevice} onChange={(e) => setRememberDevice(e.target.checked)} />
              Remember this device for 30 days
            </label>
            <button type="submit" style={{ ...primaryBtn, opacity: loading || twoFACode.length < 6 ? 0.6 : 1 }} disabled={loading || twoFACode.length < 6}>
              {loading ? 'Verifying...' : 'Verify'}
            </button>
          </form>
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <a onClick={() => { setShow2FA(false); setTwoFACode(''); setError(null); }} style={{ fontSize: 13, color: 'var(--role-color)', cursor: 'pointer' }}>← Back to login</a>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 16, textAlign: 'center', margin: '16px 0 0' }}>
            You can also use a backup code if you've lost access to your authenticator app.
          </p>
        </div>
      </div>
    );
  }

  // ─── Forced Password Change Screen ───
  if (showPasswordChange) {
    return (
      <div className="login-container">
        <div className="login-card" style={cardStyle}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <InPlaceIcon width={48} height={48} />
            <h2 style={{ marginTop: 12, marginBottom: 4 }}>Set Your Password</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: 0 }}>Please set a new password to continue.</p>
          </div>
          {error && <div style={{ background: 'var(--color-error-bg)', color: 'var(--color-error)', padding: 12, borderRadius: 6, marginBottom: 16, fontSize: 13 }}>{error}</div>}
          <form onSubmit={handlePasswordChange}>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>New Password</label>
              <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} style={inputStyle} placeholder="8+ chars, uppercase, number, symbol" required />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Confirm Password</label>
              <input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} style={inputStyle} required />
            </div>
            <button type="submit" style={{ ...primaryBtn, opacity: loading || newPw.length < 8 ? 0.6 : 1 }} disabled={loading || newPw.length < 8}>
              {loading ? 'Saving...' : 'Set Password & Continue'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ─── Main Login Screen ───
  return (
    <div className="login-container">
      <div className="login-card" style={cardStyle}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <InPlaceIcon width={48} height={48} />
          <div style={{ marginTop: 12, fontFamily: "'DM Sans', sans-serif", fontSize: 28, letterSpacing: '-1.5px', lineHeight: 1 }}>
            <span style={{ fontWeight: 200, color: 'var(--text-muted)' }}>in</span><span style={{ fontWeight: 800, color: 'var(--role-color)' }}>Place</span>
          </div>
        </div>
        <h2 style={{ textAlign: 'center', margin: '0 0 4px' }}>{inviteInfo ? 'Join the Care Team' : 'Welcome Back'}</h2>
        <p className="login-subtitle" style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 14, margin: '0 0 20px' }}>
          {inviteInfo ? `Sign in to join ${inviteInfo.recipientName}'s care team` : 'Sign in to manage care for your loved ones'}
        </p>

        {inviteInfo && (
          <div style={{
            padding: '12px 14px', marginBottom: '16px', borderRadius: '8px', fontSize: '13px',
            background: 'var(--color-success-bg)', border: '1px solid #c8e6c9', color: 'var(--color-success)',
          }}>
            👋 <strong>{inviteInfo.inviterName}</strong> invited you to help coordinate care for <strong>{inviteInfo.recipientName}</strong>.
            Sign in below, or <a onClick={() => onNavigate('register')} style={{ color: 'var(--role-color)', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>create an account</a>.
          </div>
        )}

        {banner && (
          <div style={{
            padding: '12px 14px', marginBottom: '16px', borderRadius: '8px', fontSize: '13px', fontWeight: 500,
            background: banner.type === 'info' ? 'var(--color-info-bg)' : banner.type === 'success' ? 'var(--role-color-light)' : 'var(--color-error-bg)',
            color: banner.type === 'info' ? 'var(--color-info)' : banner.type === 'success' ? 'var(--role-color)' : 'var(--color-error)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span>{banner.type === 'info' ? 'ℹ️ ' : banner.type === 'success' ? '✅ ' : '⚠️ '}{banner.text}</span>
            {onDismissBanner && <button onClick={onDismissBanner} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: 'inherit', padding: '0 0 0 8px' }}>&times;</button>}
          </div>
        )}

        {error && (
          <div style={{ background: 'var(--color-error-bg)', color: 'var(--color-error)', padding: '12px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13, lineHeight: 1.5 }}>
            <div>{error}</div>
            {(errorCode === 'WRONG_PASSWORD' || errorCode === 'PASSWORD_RESET_PENDING') && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(114,28,36,0.15)' }}>
                <a onClick={() => onNavigate('forgot-password')} style={{ color: 'var(--color-error)', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>Reset your password</a>
              </div>
            )}
            {errorCode === 'EMAIL_NOT_FOUND' && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(114,28,36,0.15)' }}>
                <a onClick={() => onNavigate('register')} style={{ color: 'var(--color-error)', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>Create a new account</a>
              </div>
            )}
            {failCount >= 3 && !errorCode && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(114,28,36,0.15)', fontSize: 12, color: '#944' }}>
                Having trouble? Try <a onClick={() => onNavigate('forgot-password')} style={{ color: 'var(--color-error)', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>resetting your password</a> or contact support.
              </div>
            )}
          </div>
        )}

        {/* Google Sign-In */}
        {googleAvailable && (
          <div style={{ marginBottom: 16 }}>
            <button onClick={() => { window.location.href = '/api/oauth/google'; }} style={googleBtnStyle} disabled={loading}>
              <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              Sign in with Google
            </button>
            {!passkeyAvailable && (
              <div style={{ position: 'relative', textAlign: 'center', margin: '16px 0' }}>
                <div style={{ borderTop: '1px solid #e0e0e0' }}></div>
                <span style={{ position: 'relative', top: '-10px', background: 'var(--bg-surface)', padding: '0 12px', color: 'var(--text-muted)', fontSize: 12 }}>or sign in with email</span>
              </div>
            )}
          </div>
        )}

        {/* Passkey Sign-In */}
        {passkeyAvailable && (
          <div style={{ marginBottom: 16 }}>
            <button onClick={handlePasskeyLogin} disabled={loading} style={{
              ...googleBtnStyle, background: '#f0f7f5', border: '1px solid #c8e6c9', color: 'var(--role-color)', fontWeight: 600,
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--role-color)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
              </svg>
              {loading ? 'Checking...' : 'Sign in with passkey'}
            </button>
          </div>
        )}

        {/* Divider before email form when any alt method is shown */}
        {(googleAvailable || passkeyAvailable) && (
          <div style={{ position: 'relative', textAlign: 'center', margin: '16px 0' }}>
            <div style={{ borderTop: '1px solid #e0e0e0' }}></div>
            <span style={{ position: 'relative', top: '-10px', background: 'var(--bg-surface)', padding: '0 12px', color: 'var(--text-muted)', fontSize: 12 }}>or sign in with email</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required style={inputStyle} />
          </div>
          <div className="form-group" style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required style={inputStyle} />
          </div>
          <button type="submit" disabled={loading} style={{ ...primaryBtn, opacity: loading ? 0.6 : 1 }}>{loading ? 'Signing in...' : 'Sign In'}</button>
        </form>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
          <a onClick={() => onNavigate('forgot-password')} style={{ fontSize: 13, color: 'var(--role-color)', cursor: 'pointer' }}>Forgot password?</a>
          <a onClick={() => onNavigate('register')} style={{ fontSize: 13, color: 'var(--role-color)', cursor: 'pointer' }}>Create account</a>
        </div>

        {/* Demo Toggle */}
        <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 24, paddingTop: 16, textAlign: 'center' }}>
          <a onClick={() => setShowDemo(!showDemo)} style={{ fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer', textDecoration: 'none' }}>
            {showDemo ? 'Hide demo accounts ▲' : 'Try the demo ▼'}
          </a>
          {showDemo && (
            <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {demoAccounts.map(acct => (
                <button key={acct.email} onClick={() => handleQuickLogin(acct)} disabled={loading}
                  style={{ padding: '8px 12px', background: 'var(--bg-primary)', border: '1px solid #e0e0e0', borderRadius: 8, cursor: 'pointer', textAlign: 'center', fontSize: 12, minWidth: 80, transition: 'all 0.15s' }}>
                  <div style={{ fontSize: 18, marginBottom: 2 }}>{acct.icon}</div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{acct.label}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <a onClick={() => onNavigate('splash')} style={{ fontSize: 13, color: 'var(--text-tertiary)', cursor: 'pointer' }}>← Back to home</a>
        </div>
        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 11, color: 'var(--text-muted)' }}>v{window.APP_VERSION || '?'}</div>
      </div>
    </div>
  );
};
