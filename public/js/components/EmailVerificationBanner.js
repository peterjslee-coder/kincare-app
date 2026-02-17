// ─── Email Verification Banner ───
// Shows a dismissable banner when user hasn't verified their email
const EmailVerificationBanner = window.EmailVerificationBanner = ({ userId }) => {
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState(null);

  const handleResend = async () => {
    setSending(true);
    setMessage(null);
    try {
      const res = await apiFetch('/api/auth/resend-verification', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: 'success', text: data.message || 'Verification email sent!' });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to send email.' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Something went wrong. Please try again.' });
    }
    setSending(false);
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
          Check your inbox for a verification link.
          {message && (
            <span style={{ marginLeft: '8px', color: message.type === 'success' ? '#1b6b5a' : '#c62828', fontWeight: 500 }}>
              {message.text}
            </span>
          )}
        </div>
      </div>
      <button
        onClick={handleResend}
        disabled={sending}
        style={{
          background: 'none', border: '1px solid #f57f17', color: '#f57f17',
          padding: '6px 14px', borderRadius: '6px', cursor: sending ? 'not-allowed' : 'pointer',
          fontSize: '13px', fontWeight: 600, opacity: sending ? 0.6 : 1,
          whiteSpace: 'nowrap',
        }}
      >
        {sending ? 'Sending…' : 'Resend Email'}
      </button>
    </div>
  );
};
