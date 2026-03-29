// ─── Checkr Background Check Embed Component ───
// Renders the Checkr NewInvitation embed for caregivers to initiate their background check.
// The Checkr WebSDK is loaded dynamically from CDN based on config from the backend.

const CheckrEmbed = window.CheckrEmbed = ({ onComplete, onError }) => {
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null); // 'idle', 'initiated', 'in_progress', 'complete'
  const embedRef = useRef(null);
  const embedInstanceRef = useRef(null);

  // Load Checkr config and SDK
  useEffect(() => {
    async function init() {
      try {
        // Get config from backend
        const res = await apiFetch('/api/checkr/config');
        const cfg = await res.json();

        if (!cfg.configured) {
          setError('Background check service is not yet configured.');
          setLoading(false);
          return;
        }

        setConfig(cfg);

        // Dynamically load the Checkr SDK if not already loaded
        if (!window.Checkr) {
          const script = document.createElement('script');
          script.src = cfg.embedUrl + '/v1/checkr.js';
          script.onload = () => {
            console.log('[checkr-embed] SDK loaded');
            setLoading(false);
          };
          script.onerror = () => {
            console.error('[checkr-embed] Failed to load SDK');
            setError('Failed to load background check service.');
            setLoading(false);
          };
          document.head.appendChild(script);
        } else {
          setLoading(false);
        }
      } catch (err) {
        console.error('[checkr-embed] Init error:', err);
        setError('Failed to initialize background check.');
        setLoading(false);
      }
    }

    init();
  }, []);

  // Render the embed once SDK is loaded
  useEffect(() => {
    if (loading || !config || !window.Checkr || !embedRef.current) return;

    try {
      // Clear any previous embed instance
      if (embedInstanceRef.current) {
        try {
          embedInstanceRef.current.destroy?.();
        } catch (e) {
          console.warn('[checkr-embed] Could not destroy previous instance:', e);
        }
      }

      console.log('[checkr-embed] Creating NewInvitation embed');

      embedInstanceRef.current = new window.Checkr.Embeds.NewInvitation({
        container: embedRef.current,
        sessionTokenPath: '/api/checkr/session-token',
        onComplete: (data) => {
          console.log('[checkr-embed] Complete event:', data);
          setStatus('complete');
          if (onComplete) onComplete(data);
        },
        onError: (err) => {
          console.error('[checkr-embed] Error event:', err);
          setStatus('idle');
          if (onError) onError(err);
          setError('Background check submission failed. Please try again.');
        },
      });
    } catch (err) {
      console.error('[checkr-embed] Init error:', err);
      setError('Failed to initialize background check form.');
      setLoading(false);
    }
  }, [loading, config, onComplete, onError]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (embedInstanceRef.current) {
        try {
          embedInstanceRef.current.destroy?.();
        } catch (e) {
          console.warn('[checkr-embed] Could not destroy on unmount:', e);
        }
      }
    };
  }, []);

  if (error) {
    return (
      <div style={{ padding: 16, background: 'var(--bg-warm)', border: '1px solid #ffcc80', borderRadius: 10, fontSize: 13, lineHeight: 1.5 }}>
        <div style={{ color: 'var(--color-warning)', fontWeight: 600, marginBottom: 8 }}>Background check form unavailable in staging</div>
        <div style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>The in-app form is available in production. For staging testing, use the email invitation flow — Checkr will send you a link to complete the check.</div>
        <button onClick={async () => {
          try {
            const res = await apiFetch('/api/checkr/initiate', { method: 'POST' });
            const data = await res.json();
            if (data.invitationUrl) {
              window.open(data.invitationUrl, '_blank');
            } else if (data.status === 'already_initiated') {
              if (typeof showToast === 'function') showToast('Background check already in progress', 'info');
            } else {
              if (typeof showToast === 'function') showToast(data.error || data.message || 'Check your email for the Checkr invitation', 'info');
            }
          } catch (err) {
            if (typeof showToast === 'function') showToast('Failed to initiate. Contact support.', 'error');
          }
        }} style={{ padding: '8px 16px', background: 'var(--role-color)', color: 'var(--bg-card)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          Start Background Check via Email
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{
        padding: 20,
        textAlign: 'center',
        color: 'var(--text-tertiary)',
        fontSize: 14
      }}>
        Loading background check form...
      </div>
    );
  }

  return (
    <div>
      <div ref={embedRef} style={{ minHeight: 400 }}></div>
      {config?.staging && (
        <div style={{
          marginTop: 8,
          padding: 6,
          background: 'var(--color-warning-bg)',
          borderRadius: 6,
          fontSize: 11,
          color: 'var(--color-warning)',
          textAlign: 'center'
        }}>
          Staging environment — using test data
        </div>
      )}
    </div>
  );
};
