// ─── Email Verification Banner ───
// Shows a dismissable banner when user hasn't verified their email
const EmailVerificationBanner = window.EmailVerificationBanner = ({ userId }) => {
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState(null);
  const [lastSentAt, setLastSentAt] = useState(null);
  const [cooldown, setCooldown] = useState(0);

  // Cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const handleResend = async () => {
    if (cooldown > 0) return;
    setSending(true);
    setMessage(null);
    try {
      const res = await apiFetch('/api/auth/resend-verification', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: 'success', text: 'Verification email sent!' });
        setLastSentAt(new Date());
        setCooldown(60);
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to send email.' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Something went wrong. Please try again.' });
    }
    setSending(false);
  };

  const formatSentTime = (date) => {
    if (!date) return null;
    const diff = Math.floor((Date.now() - date.getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  };

  return (
    <div style={{
      background: '#fff8e1', border: '1px solid #ffe082', borderRadius: '8px',
      padding: '12px 16px', marginBottom: '16px', fontSize: '14px',
      display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: '18px' }}>📧</span>
      <div style={{ flex: 1, minWidth: '180px' }}>
        <div style={{ fontWeight: 600, color: '#f57f17' }}>Please verify your email</div>
        <div style={{ color: '#666', fontSize: '13px', marginTop: '2px' }}>
          {message ? (
            <span style={{ color: message.type === 'success' ? '#1b6b5a' : '#c62828', fontWeight: 500 }}>
              {message.text}
            </span>
          ) : lastSentAt ? (
            <span>Verification email sent {formatSentTime(lastSentAt)} — check your inbox and spam folder.</span>
          ) : (
            <span>Check your inbox for a verification link, or click resend.</span>
          )}
        </div>
      </div>
      <button
        onClick={handleResend}
        disabled={sending || cooldown > 0}
        style={{
          background: 'none', border: '1px solid #f57f17', color: '#f57f17',
          padding: '6px 14px', borderRadius: '6px',
          cursor: (sending || cooldown > 0) ? 'not-allowed' : 'pointer',
          fontSize: '13px', fontWeight: 600, opacity: (sending || cooldown > 0) ? 0.6 : 1,
          whiteSpace: 'nowrap', minWidth: '110px', textAlign: 'center',
        }}
      >
        {sending ? 'Sending…' : cooldown > 0 ? `Resend (${cooldown}s)` : 'Resend Email'}
      </button>
    </div>
  );
};
