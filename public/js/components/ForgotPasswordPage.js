const ForgotPasswordPage = window.ForgotPasswordPage = ({ onNavigate }) => {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }
    setSending(true);
    setError('');
    try {
      const res = await apiFetch('/api/password-reset/request', {
        method: 'POST',
        body: JSON.stringify({ email })
      });
      if (res.error) {
        setError(res.error);
        setSending(false);
        return;
      }
      setSent(true);
    } catch (err) {
      setError('Something went wrong. Please try again.');
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <div style={{ marginBottom: '16px' }}>
              <InPlaceIcon width={50} height={50} />
            </div>
            <h1>Check Your Email</h1>
            <p style={{ color: '#555', lineHeight: '1.6', marginTop: '12px' }}>
              If <strong>{email}</strong> is registered, you'll receive a password reset link shortly. Check your inbox (and spam folder).
            </p>
          </div>
          <div style={{ textAlign: 'center', marginTop: '24px' }}>
            <a onClick={() => onNavigate('login')} style={{ color: '#1b6b5a', cursor: 'pointer', fontWeight: '600' }}>← Back to Sign In</a>
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
          <h1>Reset Password</h1>
          <p style={{ color: '#888' }}>Enter your email and we'll send you a reset link</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              autoFocus
            />
          </div>
          {error && <div style={{ color: '#c0392b', fontSize: '14px', marginBottom: '12px', padding: '10px', background: '#fdf0ed', borderRadius: '6px' }}>{error}</div>}
          <button type="submit" className="btn btn-primary" disabled={sending} style={{ width: '100%', opacity: sending ? 0.6 : 1 }}>
            {sending ? 'Sending...' : 'Send Reset Link'}
          </button>
        </form>
        <div style={{ textAlign: 'center', marginTop: '16px' }}>
          <a onClick={() => onNavigate('login')} style={{ color: '#1b6b5a', cursor: 'pointer', fontSize: '14px' }}>← Back to Sign In</a>
        </div>
      </div>
    </div>
  );
};
