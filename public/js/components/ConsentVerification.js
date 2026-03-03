const ConsentVerification = window.ConsentVerification = ({ recipientId, recipientName, consentStatus: initialStatus, authorizationTier, onStatusChange }) => {
  const [status, setStatus] = useState(initialStatus);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Attestation state
  const [agreed, setAgreed] = useState(false);
  const [signatureName, setSignatureName] = useState('');
  const [relationship, setRelationship] = useState('');

  // Verification code state
  const [code, setCode] = useState('');
  const [codeDigits, setCodeDigits] = useState(['', '', '', '', '', '']);
  const [expiresAt, setExpiresAt] = useState(null);
  const [hasActiveCode, setHasActiveCode] = useState(false);
  const [attemptsRemaining, setAttemptsRemaining] = useState(5);

  // Load consent status on mount
  useEffect(() => {
    loadStatus();
  }, [recipientId]);

  const loadStatus = async () => {
    try {
      const res = await apiFetch(`/api/consent/${recipientId}/status`);
      if (res?.ok) {
        const data = await res.json();
        setStatus(data.consentStatus);
        if (data.verification?.hasActiveCode) {
          setHasActiveCode(true);
          setExpiresAt(data.verification.expiresAt);
          setAttemptsRemaining(5 - (data.verification.failedAttempts || 0));
        }
      }
    } catch (err) {
      console.error('Load consent status error:', err);
    }
  };

  const handleAttest = async () => {
    if (!agreed || !signatureName.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch(`/api/consent/${recipientId}/attest`, {
        method: 'POST',
        body: JSON.stringify({ signatureName: signatureName.trim(), relationshipToRecipient: relationship }),
      });
      if (res?.ok) {
        const data = await res.json();
        setStatus('attested');
        setSuccess('Attestation signed successfully.');
        setTimeout(() => setSuccess(''), 3000);
        if (onStatusChange) onStatusChange();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to submit attestation');
      }
    } catch (err) {
      setError('Failed to submit attestation');
    }
    setLoading(false);
  };

  const handleGenerateCode = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch(`/api/consent/${recipientId}/generate-code`, { method: 'POST' });
      if (res?.ok) {
        const data = await res.json();
        setCode(data.code);
        setExpiresAt(data.expiresAt);
        setHasActiveCode(true);
        setAttemptsRemaining(5);
        setCodeDigits(['', '', '', '', '', '']);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to generate code');
      }
    } catch (err) {
      setError('Failed to generate code');
    }
    setLoading(false);
  };

  const handleCodeDigitChange = (index, value) => {
    if (value.length > 1) value = value.slice(-1);
    if (value && !/^\d$/.test(value)) return;
    const newDigits = [...codeDigits];
    newDigits[index] = value;
    setCodeDigits(newDigits);
    // Auto-focus next input
    if (value && index < 5) {
      const next = document.getElementById(`cv-digit-${index + 1}`);
      if (next) next.focus();
    }
  };

  const handleCodeKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !codeDigits[index] && index > 0) {
      const prev = document.getElementById(`cv-digit-${index - 1}`);
      if (prev) prev.focus();
    }
  };

  const handleVerifyCode = async () => {
    const enteredCode = codeDigits.join('');
    if (enteredCode.length !== 6) {
      setError('Please enter all 6 digits');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch(`/api/consent/${recipientId}/verify-code`, {
        method: 'POST',
        body: JSON.stringify({ code: enteredCode }),
      });
      const data = await res.json();
      if (res?.ok && data.verified) {
        setStatus('verified');
        setSuccess('Verification complete! You can now book care sessions.');
        if (onStatusChange) onStatusChange();
      } else {
        setError(data.error || 'Verification failed');
        if (data.attemptsRemaining !== undefined) {
          setAttemptsRemaining(data.attemptsRemaining);
        }
        setCodeDigits(['', '', '', '', '', '']);
        const first = document.getElementById('cv-digit-0');
        if (first) first.focus();
      }
    } catch (err) {
      setError('Failed to verify code');
    }
    setLoading(false);
  };

  const isExpired = expiresAt && new Date(expiresAt) < new Date();
  const firstName = recipientName ? recipientName.split(' ')[0] : 'your loved one';

  const attestationText = `I confirm that ${recipientName} is aware that I am arranging non-medical companion care services through inPlace on their behalf. I understand that ${recipientName} will be contacted directly to verify their awareness and consent before any caregiver visit is scheduled. I understand that misrepresenting this consent may result in account termination and potential legal liability.`;

  // ─── Verified state ───
  if (status === 'verified') {
    return (
      <div style={{ background: '#e8f5e9', border: '1px solid #c8e6c9', borderRadius: '12px', padding: '20px', marginTop: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '24px' }}>{'\u2705'}</span>
          <div>
            <div style={{ fontWeight: 600, color: '#2e7d32', fontSize: '15px' }}>Verified</div>
            <div style={{ color: '#558b2f', fontSize: '13px' }}>{recipientName}'s care authorization is complete. You can now book care sessions.</div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Attestation state ───
  if (status === 'pending') {
    return (
      <div style={{ background: '#fff', border: '2px solid #e8724a', borderRadius: '12px', padding: '24px', marginTop: '16px' }}>
        <h3 style={{ color: '#e8724a', margin: '0 0 8px 0', fontSize: '17px' }}>Verify Care Authorization</h3>
        <p style={{ color: '#666', fontSize: '13px', margin: '0 0 20px 0' }}>
          Before booking care for {firstName}, please confirm they're aware of this arrangement.
        </p>

        {error && <div style={{ background: '#fce4ec', color: '#c62828', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px' }}>{error}</div>}
        {success && <div style={{ background: '#e8f5e9', color: '#2e7d32', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px' }}>{success}</div>}

        <div style={{ background: '#FFF8E1', border: '1px solid #FFE082', borderRadius: '8px', padding: '16px', marginBottom: '20px', fontSize: '13px', lineHeight: '1.6', color: '#5D4037' }}>
          <div style={{ fontWeight: 600, marginBottom: '8px', color: '#E65100' }}>Attestation Statement</div>
          {attestationText}
        </div>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', marginBottom: '20px' }}>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)}
            style={{ marginTop: '3px', width: '18px', height: '18px', accentColor: '#1b6b5a' }} />
          <span style={{ fontSize: '14px', color: '#333' }}>I have read and agree to the above statement</span>
        </label>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#333', marginBottom: '6px' }}>Your relationship to {firstName}</label>
          <select value={relationship} onChange={(e) => setRelationship(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px' }}>
            <option value="">Select...</option>
            <option value="Son">Son</option>
            <option value="Daughter">Daughter</option>
            <option value="Spouse">Spouse</option>
            <option value="Sibling">Sibling</option>
            <option value="Grandchild">Grandchild</option>
            <option value="Niece/Nephew">Niece/Nephew</option>
            <option value="Friend">Friend</option>
            <option value="Other">Other</option>
          </select>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#333', marginBottom: '6px' }}>Type your full name as signature</label>
          <input type="text" value={signatureName} onChange={(e) => setSignatureName(e.target.value)}
            placeholder="Your full legal name"
            style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px', fontStyle: 'italic', boxSizing: 'border-box' }} />
        </div>

        <button onClick={handleAttest} disabled={loading || !agreed || !signatureName.trim()}
          style={{
            padding: '12px 24px', borderRadius: '8px', border: 'none', fontWeight: 600, fontSize: '14px', cursor: 'pointer',
            background: agreed && signatureName.trim() ? '#1b6b5a' : '#ccc',
            color: '#fff', transition: 'background 0.2s',
          }}>
          {loading ? 'Submitting...' : 'Sign & Continue \u2192'}
        </button>
      </div>
    );
  }

  // ─── Code verification state ───
  if (status === 'attested') {
    return (
      <div style={{ background: '#fff', border: '2px solid #1b6b5a', borderRadius: '12px', padding: '24px', marginTop: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
          <span style={{ fontSize: '20px' }}>{'\u2705'}</span>
          <span style={{ fontWeight: 600, color: '#1b6b5a', fontSize: '15px' }}>Attestation Signed</span>
        </div>

        <p style={{ color: '#666', fontSize: '13px', margin: '0 0 20px 0' }}>
          Now verify with {firstName} directly. Generate a 6-digit code, share it with {firstName}, and enter it below to confirm their awareness.
        </p>

        {error && <div style={{ background: '#fce4ec', color: '#c62828', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px' }}>{error}</div>}
        {success && <div style={{ background: '#e8f5e9', color: '#2e7d32', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px' }}>{success}</div>}

        {!hasActiveCode || isExpired ? (
          <div>
            {isExpired && <p style={{ color: '#e8724a', fontSize: '13px', marginBottom: '12px' }}>Previous code has expired. Generate a new one.</p>}
            <button onClick={handleGenerateCode} disabled={loading}
              style={{ padding: '12px 24px', borderRadius: '8px', border: 'none', background: '#e8724a', color: '#fff', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}>
              {loading ? 'Generating...' : 'Generate Verification Code'}
            </button>
          </div>
        ) : (
          <div>
            {code && (
              <div style={{ background: '#f5f5f5', borderRadius: '10px', padding: '20px', marginBottom: '20px', textAlign: 'center' }}>
                <div style={{ fontSize: '12px', color: '#888', marginBottom: '8px', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '1px' }}>Verification Code</div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
                  {code.split('').map((digit, i) => (
                    <div key={i} style={{
                      width: '44px', height: '52px', background: '#fff', border: '2px solid #1b6b5a', borderRadius: '8px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '24px', fontWeight: 700, color: '#1b6b5a',
                    }}>{digit}</div>
                  ))}
                </div>
                {expiresAt && (
                  <div style={{ fontSize: '12px', color: '#888', marginTop: '10px' }}>
                    Expires: {new Date(expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  </div>
                )}
              </div>
            )}

            <div style={{ background: '#E8F5E9', borderRadius: '8px', padding: '14px', marginBottom: '20px', fontSize: '13px', color: '#2E7D32' }}>
              <strong>How to verify:</strong> Share this code with {firstName}. Then enter the same code below to confirm they received it and are aware of the care arrangement.
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#333', marginBottom: '10px' }}>Enter verification code</label>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                {codeDigits.map((digit, i) => (
                  <input key={i} id={`cv-digit-${i}`} type="text" inputMode="numeric" maxLength="1"
                    value={digit} onChange={(e) => handleCodeDigitChange(i, e.target.value)}
                    onKeyDown={(e) => handleCodeKeyDown(i, e)}
                    style={{
                      width: '44px', height: '52px', textAlign: 'center', fontSize: '22px', fontWeight: 700,
                      border: '2px solid #ddd', borderRadius: '8px', outline: 'none',
                      transition: 'border-color 0.2s',
                    }}
                    onFocus={(e) => { e.target.style.borderColor = '#1b6b5a'; }}
                    onBlur={(e) => { e.target.style.borderColor = '#ddd'; }}
                  />
                ))}
              </div>
              {attemptsRemaining < 5 && attemptsRemaining > 0 && (
                <div style={{ textAlign: 'center', fontSize: '12px', color: '#e8724a', marginTop: '8px' }}>
                  {attemptsRemaining} attempt{attemptsRemaining !== 1 ? 's' : ''} remaining
                </div>
              )}
              {attemptsRemaining <= 0 && (
                <div style={{ textAlign: 'center', fontSize: '12px', color: '#c62828', marginTop: '8px' }}>
                  Too many attempts. Please generate a new code.
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={handleVerifyCode} disabled={loading || codeDigits.join('').length !== 6 || attemptsRemaining <= 0}
                style={{
                  padding: '12px 24px', borderRadius: '8px', border: 'none', fontWeight: 600, fontSize: '14px', cursor: 'pointer',
                  background: codeDigits.join('').length === 6 && attemptsRemaining > 0 ? '#1b6b5a' : '#ccc',
                  color: '#fff',
                }}>
                {loading ? 'Verifying...' : 'Verify \u2192'}
              </button>
              <button onClick={handleGenerateCode} disabled={loading}
                style={{ padding: '12px 16px', borderRadius: '8px', border: '1px solid #ddd', background: '#fff', color: '#666', fontSize: '13px', cursor: 'pointer' }}>
                New Code
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
};
