// ─── TwoFactorSetup — 2FA Setup Wizard (QR code, verify, backup codes) ───
const TwoFactorSetup = window.TwoFactorSetup = ({ onComplete, onCancel }) => {
  const [step, setStep] = useState('loading'); // loading, qr, verify, backup, done
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copiedBackup, setCopiedBackup] = useState(false);
  const { showToast } = useToast();

  // Start 2FA setup — get QR code
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/auth/2fa/setup', { method: 'POST' });
        if (!res?.ok) {
          const data = await res?.json();
          throw new Error(data?.error || 'Failed to start 2FA setup');
        }
        const data = await res.json();
        setQrDataUrl(data.qrCode);
        setSecret(data.secret);
        setStep('qr');
      } catch (err) {
        setError(err.message);
        setStep('error');
      }
    })();
  }, []);

  const handleVerify = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/auth/2fa/verify-setup', {
        method: 'POST',
        body: JSON.stringify({ code })
      });
      if (!res?.ok) {
        const data = await res?.json();
        throw new Error(data?.error || 'Verification failed');
      }
      const data = await res.json();
      setBackupCodes(data.backupCodes || []);
      setStep('backup');
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const copyBackupCodes = () => {
    const text = backupCodes.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopiedBackup(true);
      setTimeout(() => setCopiedBackup(false), 2000);
    }).catch(() => {
      // Fallback: select text
      const el = document.getElementById('backup-codes-text');
      if (el) { el.select(); document.execCommand('copy'); setCopiedBackup(true); }
    });
  };

  const handleDone = () => {
    showToast('Two-factor authentication enabled', 'success');
    if (onComplete) onComplete();
  };

  const cardStyle = { background: '#fff', borderRadius: 12, padding: 24 };
  const inputStyle = { width: '100%', padding: '12px 14px', border: '1px solid #d0d0d0', borderRadius: 8, fontSize: 15, fontFamily: 'inherit', boxSizing: 'border-box' };
  const primaryBtn = { padding: '10px 24px', background: '#1b6b5a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' };
  const secondaryBtn = { padding: '10px 24px', background: '#fff', color: '#666', border: '1px solid #d0d0d0', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' };

  if (step === 'loading') {
    return <div style={{ textAlign: 'center', padding: 40 }}><LoadingSpinner text="Setting up 2FA..." /></div>;
  }

  if (step === 'error') {
    return (
      <div style={cardStyle}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
          <h3 style={{ margin: '0 0 8px' }}>Setup Error</h3>
          <p style={{ color: '#666', fontSize: 14, margin: '0 0 16px' }}>{error}</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button onClick={onCancel} style={secondaryBtn}>Go Back</button>
            <button onClick={() => { setError(null); setStep('loading'); }} style={primaryBtn}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  // Step 1: Show QR Code
  if (step === 'qr') {
    return (
      <div style={cardStyle}>
        <h3 style={{ margin: '0 0 4px' }}>Set Up Authenticator App</h3>
        <p style={{ color: '#666', fontSize: 14, margin: '0 0 20px' }}>
          Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
        </p>

        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          {qrDataUrl && <img src={qrDataUrl} alt="2FA QR Code" style={{ width: 200, height: 200, borderRadius: 8, border: '1px solid #e0e0e0' }} />}
        </div>

        <div style={{ background: '#f8f9fa', borderRadius: 8, padding: 12, marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#999', textTransform: 'uppercase', marginBottom: 4 }}>Manual entry code</div>
          <code style={{ fontSize: 13, wordBreak: 'break-all', color: '#333' }}>{secret}</code>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <button onClick={onCancel} style={secondaryBtn}>Cancel</button>
          <button onClick={() => setStep('verify')} style={primaryBtn}>Next: Enter Code</button>
        </div>
      </div>
    );
  }

  // Step 2: Verify Code
  if (step === 'verify') {
    return (
      <div style={cardStyle}>
        <h3 style={{ margin: '0 0 4px' }}>Verify Your Authenticator</h3>
        <p style={{ color: '#666', fontSize: 14, margin: '0 0 20px' }}>
          Enter the 6-digit code from your authenticator app to confirm setup.
        </p>

        {error && <div style={{ background: '#f8d7da', color: '#721c24', padding: 12, borderRadius: 6, marginBottom: 16, fontSize: 13 }}>{error}</div>}

        <form onSubmit={handleVerify}>
          <div style={{ marginBottom: 16 }}>
            <input type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="000000" value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').substring(0, 6))}
              style={{ ...inputStyle, textAlign: 'center', fontSize: 24, letterSpacing: 8 }} autoFocus />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button type="button" onClick={() => { setStep('qr'); setError(null); setCode(''); }} style={secondaryBtn}>Back</button>
            <button type="submit" disabled={loading || code.length < 6} style={{ ...primaryBtn, opacity: loading || code.length < 6 ? 0.6 : 1 }}>
              {loading ? 'Verifying...' : 'Enable 2FA'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // Step 3: Show Backup Codes
  if (step === 'backup') {
    return (
      <div style={cardStyle}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>🎉</div>
          <h3 style={{ margin: '0 0 4px' }}>2FA Enabled!</h3>
          <p style={{ color: '#666', fontSize: 14, margin: 0 }}>Save these backup codes in a safe place. Each code can only be used once.</p>
        </div>

        <div style={{ background: '#f8f9fa', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {backupCodes.map((c, i) => (
              <div key={i} style={{ fontFamily: 'monospace', fontSize: 14, padding: '6px 8px', background: '#fff', borderRadius: 4, textAlign: 'center', border: '1px solid #e0e0e0' }}>
                {c}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button onClick={copyBackupCodes} style={{ ...secondaryBtn, flex: 1 }}>
            {copiedBackup ? '✓ Copied!' : 'Copy All'}
          </button>
        </div>

        <div style={{ background: '#fff3cd', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13, color: '#856404' }}>
          ⚠️ If you lose your authenticator device and don't have these backup codes, you won't be able to access your account.
        </div>

        <button onClick={handleDone} style={{ ...primaryBtn, width: '100%' }}>I've Saved My Codes</button>
      </div>
    );
  }

  return null;
};
