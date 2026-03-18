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
      <div style={{
        padding: 16,
        background: '#fef2f2',
        border: '1px solid #fca5a5',
        borderRadius: 10,
        color: '#dc2626',
        fontSize: 13,
        lineHeight: 1.5
      }}>
        {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{
        padding: 20,
        textAlign: 'center',
        color: '#888',
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
          background: '#fff3e0',
          borderRadius: 6,
          fontSize: 11,
          color: '#e65100',
          textAlign: 'center'
        }}>
          Staging environment — using test data
        </div>
      )}
    </div>
  );
};
