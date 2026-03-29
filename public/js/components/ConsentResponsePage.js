/**
 * ConsentResponsePage — Standalone page for care recipients to respond to consent outreach.
 * No authentication required. Care recipients click a link from their email
 * and land here to confirm, ask questions, or report unauthorized activity.
 *
 * v1.39.21: Now requires phone verification before submitting a response.
 * A code is sent to the care recipient's phone (SMS or voice call).
 * If the responder's IP matches the attester's IP, a warning is shown to admins.
 */
const ConsentResponsePage = window.ConsentResponsePage = ({ token }) => {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submittedMessage, setSubmittedMessage] = useState('');
  const [selectedResponse, setSelectedResponse] = useState('');
  const [notes, setNotes] = useState('');

  // Phone verification state
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [codeSending, setCodeSending] = useState(false);
  const [codeMethod, setCodeMethod] = useState('sms');
  const [verifyCode, setVerifyCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [cooldown, setCooldown] = useState(0);

  // Cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (!token) {
      setError('No verification token found. Please use the link from your email.');
      setLoading(false);
      return;
    }
    loadOutreach();
  }, [token]);

  const loadOutreach = async () => {
    try {
      const res = await fetch(`/api/consent/respond/${token}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'This verification link is not valid.');
      } else if (json.expired) {
        setError(json.message || 'This verification link has expired.');
      } else if (json.alreadyResponded) {
        setSubmitted(true);
        setSubmittedMessage("You've already responded to this verification. Thank you!");
        setData({ recipientName: json.recipientName });
      } else {
        setData(json);
        if (json.phoneVerified) setPhoneVerified(true);
      }
    } catch (err) {
      console.error('Consent response load error:', err);
      setError('Something went wrong. Please try again later.');
    }
    setLoading(false);
  };

  const handleSendCode = async (method) => {
    setCodeSending(true);
    setVerifyError('');
    try {
      const res = await fetch(`/api/consent/respond/${token}/send-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: method || codeMethod }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setCodeSent(true);
        setCodeMethod(json.method || method || 'sms');
        setCooldown(60);
      } else if (res.status === 429) {
        setVerifyError(json.error);
        setCooldown(json.retryAfter || 60);
      } else {
        setVerifyError(json.error || 'Unable to send code.');
      }
    } catch (err) {
      setVerifyError('Unable to send code. Please try again.');
    }
    setCodeSending(false);
  };

  const handleVerifyCode = async () => {
    if (!verifyCode.trim()) return;
    setVerifying(true);
    setVerifyError('');
    try {
      const res = await fetch(`/api/consent/respond/${token}/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: verifyCode.trim() }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setPhoneVerified(true);
      } else {
        setVerifyError(json.error || 'Incorrect code.');
      }
    } catch (err) {
      setVerifyError('Something went wrong. Please try again.');
    }
    setVerifying(false);
  };

  const handleSubmit = async () => {
    if (!selectedResponse || !phoneVerified) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`/api/consent/respond/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: selectedResponse, notes: notes.trim() || undefined }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setSubmitted(true);
        setSubmittedMessage(json.message);
      } else {
        setError(json.error || 'Something went wrong. Please try again.');
      }
    } catch (err) {
      console.error('Consent response submit error:', err);
      setError('Something went wrong. Please try again.');
    }
    setSubmitting(false);
  };

  const containerStyle = {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #f0f7f5 0%, #fff 50%, #f8f4ff 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  };

  const cardStyle = {
    background: 'var(--bg-surface)',
    borderRadius: '16px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
    maxWidth: '520px',
    width: '100%',
    padding: '32px',
  };

  const headerStyle = {
    background: 'var(--role-color)',
    margin: '-32px -32px 24px -32px',
    padding: '28px 32px',
    borderRadius: '16px 16px 0 0',
    textAlign: 'center',
  };

  // Loading state
  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ fontSize: '32px', marginBottom: '16px' }}>{'\u23F3'}</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '15px' }}>Loading...</div>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !data) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={headerStyle}>
            <h1 style={{ color: 'var(--text-on-primary)', margin: 0, fontSize: '22px', fontWeight: 600 }}>InPlace</h1>
          </div>
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>{'\u26A0\uFE0F'}</div>
            <div style={{ color: 'var(--color-error)', fontSize: '15px', lineHeight: '1.6' }}>{error}</div>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '20px' }}>
              If you have questions, please contact us at <a href="mailto:support@yourinplace.com" style={{ color: 'var(--role-color)' }}>support@yourinplace.com</a>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Submitted state
  if (submitted) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={headerStyle}>
            <h1 style={{ color: 'var(--text-on-primary)', margin: 0, fontSize: '22px', fontWeight: 600 }}>InPlace</h1>
          </div>
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>{'\u2705'}</div>
            <h2 style={{ color: 'var(--role-color)', margin: '0 0 12px', fontSize: '20px' }}>Thank You{data?.recipientName ? `, ${data.recipientName}` : ''}!</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '15px', lineHeight: '1.6' }}>{submittedMessage}</p>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '24px' }}>
              Questions? Contact us at <a href="mailto:support@yourinplace.com" style={{ color: 'var(--role-color)' }}>support@yourinplace.com</a>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Response options
  const responseOptions = [
    {
      id: 'yes_aware',
      icon: '\u2705',
      title: "Yes, I'm aware",
      description: "I know about this care arrangement and I'm comfortable with it.",
      color: 'var(--color-success-bg)',
      borderColor: 'var(--color-success-bg)',
      activeColor: 'var(--role-color)',
    },
    {
      id: 'have_questions',
      icon: '\u2753',
      title: 'I have questions',
      description: "I'd like to learn more before deciding. Someone from InPlace will reach out to you.",
      color: 'var(--color-warning-bg)',
      borderColor: '#FFE082',
      activeColor: 'var(--accent-color)',
    },
    {
      id: 'did_not_authorize',
      icon: '\u{1F6A8}',
      title: 'I did not authorize this',
      description: "I did not agree to this care arrangement. No caregiver will visit.",
      color: 'var(--color-error-bg)',
      borderColor: '#ef9a9a',
      activeColor: 'var(--color-error)',
    },
  ];

  // Main response form
  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={headerStyle}>
          <h1 style={{ color: 'var(--text-on-primary)', margin: 0, fontSize: '22px', fontWeight: 600 }}>InPlace</h1>
          <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: '13px', marginTop: '4px' }}>Care Arrangement Verification</div>
        </div>

        <h2 style={{ color: 'var(--text-primary)', margin: '0 0 8px', fontSize: '19px' }}>
          Hi{data.recipientName ? ` ${data.recipientName}` : ''},
        </h2>

        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: '1.6', margin: '0 0 20px' }}>
          Your {data.relationship || 'family member'}, <strong>{data.familyMemberName}</strong>, has arranged non-medical companion care for you through InPlace.
        </p>

        <div style={{ background: '#f0f7f5', borderRadius: '10px', padding: '16px', marginBottom: '24px' }}>
          <div style={{ fontWeight: 600, color: 'var(--role-color)', fontSize: '14px', marginBottom: '8px' }}>What is InPlace?</div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: '1.6', margin: 0 }}>
            InPlace connects families with trusted, local caregivers who provide companionship, help around the house,
            and other non-medical assistance. This is <em>not</em> medical care — it's friendly, professional help with daily living.
          </p>
        </div>

        {/* Phone Verification Step */}
        {!phoneVerified && (
          <div style={{
            background: 'var(--color-warning-bg)', border: '1px solid #ffe082', borderRadius: '12px',
            padding: '20px', marginBottom: '24px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <span style={{ fontSize: '22px' }}>📱</span>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '15px' }}>Verify your identity</div>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: '1.6', margin: '0 0 16px' }}>
              For your safety, we need to confirm it's really you. We'll send a verification code to your phone
              {data.maskedPhone ? ` ending in ${data.maskedPhone.slice(-4)}` : ''}.
            </p>

            {!data.phoneAvailable ? (
              <div style={{ color: 'var(--color-error)', fontSize: '13px', padding: '10px', background: 'var(--color-error-bg)', borderRadius: '8px' }}>
                No phone number is on file. Please contact your family member to update your phone number, or email us at <a href="mailto:support@yourinplace.com" style={{ color: 'var(--role-color)' }}>support@yourinplace.com</a>.
              </div>
            ) : !codeSent ? (
              <div>
                <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
                  <button onClick={() => handleSendCode('sms')} disabled={codeSending}
                    style={{
                      flex: 1, padding: '12px', borderRadius: '8px', border: 'none', fontWeight: 600,
                      fontSize: '14px', cursor: codeSending ? 'not-allowed' : 'pointer',
                      background: 'var(--role-color)', color: 'var(--bg-card)',
                    }}>
                    {codeSending ? 'Sending...' : 'Text me a code'}
                  </button>
                  <button onClick={() => handleSendCode('voice')} disabled={codeSending}
                    style={{
                      flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid #1b6b5a',
                      fontWeight: 600, fontSize: '14px', cursor: codeSending ? 'not-allowed' : 'pointer',
                      background: 'var(--bg-surface)', color: 'var(--role-color)',
                    }}>
                    {codeSending ? 'Sending...' : 'Call me instead'}
                  </button>
                </div>
                {data.maskedPhone && (
                  <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', textAlign: 'center' }}>
                    Code will be sent to {data.maskedPhone}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div style={{ fontSize: '13px', color: 'var(--color-success)', marginBottom: '12px', fontWeight: 500 }}>
                  {codeMethod === 'voice'
                    ? 'We\'re calling your phone now. Listen for your 6-digit code.'
                    : 'A 6-digit code has been sent to your phone.'}
                </div>
                <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="Enter 6-digit code"
                    style={{
                      flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid #ddd',
                      fontSize: '18px', textAlign: 'center', letterSpacing: '4px', fontWeight: 600,
                    }}
                  />
                  <button onClick={handleVerifyCode} disabled={verifying || verifyCode.length < 6}
                    style={{
                      padding: '12px 20px', borderRadius: '8px', border: 'none', fontWeight: 600,
                      fontSize: '14px', cursor: verifyCode.length >= 6 ? 'pointer' : 'not-allowed',
                      background: verifyCode.length >= 6 ? 'var(--role-color)' : 'var(--border-light)', color: 'var(--bg-card)',
                    }}>
                    {verifying ? '...' : 'Verify'}
                  </button>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button
                    onClick={() => handleSendCode(codeMethod)}
                    disabled={cooldown > 0 || codeSending}
                    style={{
                      background: 'none', border: 'none', color: cooldown > 0 ? 'var(--text-muted)' : 'var(--role-color)',
                      fontSize: '12px', cursor: cooldown > 0 ? 'default' : 'pointer', padding: 0,
                    }}>
                    {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                  </button>
                  <button
                    onClick={() => handleSendCode(codeMethod === 'sms' ? 'voice' : 'sms')}
                    disabled={cooldown > 0 || codeSending}
                    style={{
                      background: 'none', border: 'none', color: cooldown > 0 ? 'var(--text-muted)' : 'var(--role-color)',
                      fontSize: '12px', cursor: cooldown > 0 ? 'default' : 'pointer', padding: 0,
                    }}>
                    {codeMethod === 'sms' ? 'Call me instead' : 'Text me instead'}
                  </button>
                </div>
              </div>
            )}
            {verifyError && (
              <div style={{ color: 'var(--color-error)', fontSize: '13px', marginTop: '10px', padding: '8px 12px', background: 'var(--color-error-bg)', borderRadius: '6px' }}>
                {verifyError}
              </div>
            )}
          </div>
        )}

        {/* Phone verified badge */}
        {phoneVerified && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            background: 'var(--color-success-bg)', borderRadius: '8px', padding: '10px 14px', marginBottom: '20px',
          }}>
            <span style={{ fontSize: '16px' }}>{'\u2705'}</span>
            <span style={{ fontSize: '13px', color: 'var(--color-success)', fontWeight: 500 }}>Phone verified — you can now respond below</span>
          </div>
        )}

        {error && <div style={{ background: 'var(--color-error-bg)', color: 'var(--color-error)', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px' }}>{error}</div>}

        {/* Response options — only enabled after phone verification */}
        <div style={{ opacity: phoneVerified ? 1 : 0.4, pointerEvents: phoneVerified ? 'auto' : 'none' }}>
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '15px', marginBottom: '12px' }}>
            How would you like to respond?
          </div>

          {responseOptions.map(opt => {
            const isSelected = selectedResponse === opt.id;
            return (
              <button key={opt.id} onClick={() => setSelectedResponse(opt.id)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                  background: isSelected ? opt.color : 'var(--bg-card)',
                  border: `2px solid ${isSelected ? opt.activeColor : 'var(--border-light)'}`,
                  borderRadius: '10px', padding: '14px 16px', marginBottom: '10px',
                  transition: 'all 0.2s',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '20px' }}>{opt.icon}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '14px', color: isSelected ? opt.activeColor : 'var(--text-primary)' }}>{opt.title}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '2px' }}>{opt.description}</div>
                  </div>
                </div>
              </button>
            );
          })}

          {/* Optional notes */}
          {selectedResponse && (
            <div style={{ marginTop: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
                Anything you'd like to add? <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span>
              </label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Any questions, concerns, or additional information..."
                style={{
                  width: '100%', minHeight: '80px', padding: '10px 12px', borderRadius: '8px',
                  border: '1px solid #ddd', fontSize: '14px', resize: 'vertical', boxSizing: 'border-box',
                  fontFamily: 'inherit',
                }} />
            </div>
          )}

          <button onClick={handleSubmit} disabled={submitting || !selectedResponse || !phoneVerified}
            style={{
              width: '100%', padding: '14px', borderRadius: '10px', border: 'none',
              fontWeight: 600, fontSize: '15px', cursor: selectedResponse && phoneVerified ? 'pointer' : 'not-allowed',
              background: selectedResponse && phoneVerified ? 'var(--role-color)' : 'var(--border-light)', color: 'var(--bg-card)',
              marginTop: '20px', transition: 'background 0.2s',
            }}>
            {submitting ? 'Submitting...' : 'Submit Response'}
          </button>
        </div>

        <p style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center', marginTop: '20px', marginBottom: 0 }}>
          You can also ignore this page — no caregiver will visit without proper verification.
          <br />Questions? <a href="mailto:support@yourinplace.com" style={{ color: 'var(--role-color)' }}>support@yourinplace.com</a>
        </p>
      </div>
    </div>
  );
};
