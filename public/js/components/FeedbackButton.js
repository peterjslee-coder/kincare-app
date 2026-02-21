// ─── Floating Feedback Button ───
// Persistent FAB on every screen, opens feedback submission modal.
// Enhanced with device/browser context auto-collection and anonymous support.
const FeedbackButton = window.FeedbackButton = ({ currentPage, userRole, currentUser }) => {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('general');
  const [description, setDescription] = useState('');
  const [mood, setMood] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  // Refs for console error tracking
  const recentErrorsRef = React.useRef([]);
  const errorListenerRef = React.useRef(null);

  // Parse user agent to extract browser, OS info
  const parseUserAgent = (ua) => {
    let browserName = 'Unknown';
    let browserVersion = 'Unknown';
    let osName = 'Unknown';
    let osVersion = 'Unknown';

    // Browser detection
    if (/Chrome/.test(ua) && !/Chromium/.test(ua)) {
      browserName = 'Chrome';
      const match = ua.match(/Chrome\/([0-9.]+)/);
      browserVersion = match ? match[1] : 'Unknown';
    } else if (/Safari/.test(ua) && !/Chrome/.test(ua)) {
      browserName = 'Safari';
      const match = ua.match(/Version\/([0-9.]+)/);
      browserVersion = match ? match[1] : 'Unknown';
    } else if (/Firefox/.test(ua)) {
      browserName = 'Firefox';
      const match = ua.match(/Firefox\/([0-9.]+)/);
      browserVersion = match ? match[1] : 'Unknown';
    } else if (/Edge/.test(ua)) {
      browserName = 'Edge';
      const match = ua.match(/Edge\/([0-9.]+)/);
      browserVersion = match ? match[1] : 'Unknown';
    }

    // OS detection
    if (/Windows/.test(ua)) {
      osName = 'Windows';
      const match = ua.match(/Windows NT ([0-9.]+)/);
      osVersion = match ? match[1] : 'Unknown';
    } else if (/Macintosh/.test(ua)) {
      osName = 'macOS';
      const match = ua.match(/Mac OS X ([0-9_]+)/);
      osVersion = match ? match[1].replace(/_/g, '.') : 'Unknown';
    } else if (/Linux/.test(ua)) {
      osName = 'Linux';
      osVersion = 'Unknown';
    } else if (/iPhone|iPad|iPod/.test(ua)) {
      osName = 'iOS';
      const match = ua.match(/OS ([0-9_]+)/);
      osVersion = match ? match[1].replace(/_/g, '.') : 'Unknown';
    } else if (/Android/.test(ua)) {
      osName = 'Android';
      const match = ua.match(/Android ([0-9.]+)/);
      osVersion = match ? match[1] : 'Unknown';
    }

    return { browserName, browserVersion, osName, osVersion };
  };

  // Initialize error listener on mount
  React.useEffect(() => {
    // Capture console errors
    const originalError = console.error;
    console.error = function (...args) {
      recentErrorsRef.current.push({
        message: args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '),
        timestamp: new Date().toISOString(),
      });
      // Keep only last 5 errors
      if (recentErrorsRef.current.length > 5) {
        recentErrorsRef.current.shift();
      }
      // Call original
      originalError.apply(console, args);
    };

    // Global error handler for uncaught exceptions
    const handleError = (event) => {
      recentErrorsRef.current.push({
        message: event.message || String(event),
        timestamp: new Date().toISOString(),
      });
      if (recentErrorsRef.current.length > 5) {
        recentErrorsRef.current.shift();
      }
    };

    window.addEventListener('error', handleError);
    errorListenerRef.current = handleError;

    return () => {
      // Cleanup on unmount
      console.error = originalError;
      if (errorListenerRef.current) {
        window.removeEventListener('error', errorListenerRef.current);
      }
    };
  }, []);

  // Build rich pageContext with device/browser info
  const buildPageContext = () => {
    const ua = navigator.userAgent;
    const { browserName, browserVersion, osName, osVersion } = parseUserAgent(ua);

    const pageContext = {
      page: currentPage || 'unknown',
      role: userRole || 'unknown',
      version: window.APP_VERSION || 'unknown',
      device: window.innerWidth <= 768 ? 'mobile' : 'desktop',
      timestamp: new Date().toISOString(),
      // Rich device context
      userAgent: ua,
      browser: `${browserName} ${browserVersion}`,
      os: `${osName} ${osVersion}`,
      screenResolution: `${window.screen.width}x${window.screen.height}`,
      viewportSize: `${window.innerWidth}x${window.innerHeight}`,
      devicePixelRatio: window.devicePixelRatio || 1,
      touchSupport: typeof window !== 'undefined' && window.ontouchstart !== undefined ? 'yes' : 'no',
      currentUrl: window.location.hash || window.location.pathname,
      connectionType: navigator.connection?.effectiveType || 'unknown',
      language: navigator.language || 'unknown',
      isPWA: window.navigator.standalone === true ? 'yes' : 'no',
      recentErrors: recentErrorsRef.current.length > 0 ? recentErrorsRef.current : null,
    };

    return pageContext;
  };

  const resetForm = () => {
    setCategory('general');
    setDescription('');
    setMood(null);
    setError(null);
    setSubmitted(false);
  };

  const handleOpen = () => { resetForm(); setOpen(true); };
  const handleClose = () => { setOpen(false); };

  const handleSubmit = async () => {
    if (description.trim().length < 10) return;
    setSubmitting(true);
    setError(null);
    try {
      const pageContext = buildPageContext();
      const payload = {
        category,
        description: description.trim(),
        mood,
        pageContext,
      };

      let res;
      // If user is authenticated, use apiFetch (with auth header)
      // If user is null/anonymous, use raw fetch without auth
      if (currentUser) {
        res = await apiFetch('/api/feedback', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      } else {
        // Anonymous feedback: POST to separate endpoint without auth
        res = await fetch('/api/feedback/anonymous', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      if (res?.ok) {
        setSubmitted(true);
        setTimeout(() => { setOpen(false); resetForm(); }, 1500);
      } else {
        const data = await res?.json();
        setError(data?.error || 'Failed to submit feedback');
      }
    } catch (err) {
      setError('Something went wrong. Please try again.');
    }
    setSubmitting(false);
  };

  const moods = [
    { emoji: '😊', value: 'great', label: 'Great' },
    { emoji: '🙂', value: 'good', label: 'Good' },
    { emoji: '😐', value: 'okay', label: 'Okay' },
    { emoji: '😟', value: 'bad', label: 'Bad' },
    { emoji: '😡', value: 'terrible', label: 'Terrible' },
  ];

  const categories = [
    { value: 'bug', label: 'Bug Report' },
    { value: 'feature', label: 'Feature Request' },
    { value: 'general', label: 'General Feedback' },
    { value: 'complaint', label: 'Complaint' },
    { value: 'praise', label: 'Praise' },
  ];

  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;

  return (
    <React.Fragment>
      {/* FAB */}
      <button
        onClick={handleOpen}
        aria-label="Send feedback"
        style={{
          position: 'fixed',
          bottom: isMobile ? 80 : 24,
          left: isMobile ? 16 : 'auto',
          right: isMobile ? 'auto' : 20,
          width: 48,
          height: 48,
          borderRadius: '50%',
          background: '#1b6b5a',
          border: 'none',
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 999,
          transition: 'transform 0.2s, box-shadow 0.2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.3)'; }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.25)'; }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" />
        </svg>
      </button>

      {/* Modal */}
      {open && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1100, padding: 16,
        }} onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
          <div style={{
            background: '#fff', borderRadius: 16, width: '100%', maxWidth: 420,
            maxHeight: '85vh', overflow: 'auto', padding: 24,
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          }}>
            {submitted ? (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: '#1b6b5a' }}>Thank you!</div>
                <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>Your feedback has been submitted.</div>
              </div>
            ) : (
              <React.Fragment>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#333' }}>Share Feedback</h3>
                  <button onClick={handleClose} style={{
                    background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: '#999',
                    width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%',
                  }}>&times;</button>
                </div>

                {/* Category */}
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 6 }}>Category</label>
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    style={{
                      width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd',
                      fontSize: 14, color: '#333', background: '#fff', appearance: 'auto',
                    }}
                  >
                    {categories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>

                {/* Description */}
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 6 }}>
                    Description <span style={{ color: '#999', fontWeight: 400 }}>(required)</span>
                  </label>
                  <textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="Tell us what's on your mind..."
                    rows={4}
                    style={{
                      width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd',
                      fontSize: 14, color: '#333', resize: 'vertical', fontFamily: 'inherit',
                      boxSizing: 'border-box',
                    }}
                  />
                  {description.length > 0 && description.trim().length < 10 && (
                    <div style={{ fontSize: 11, color: '#e8724a', marginTop: 4 }}>Please write at least 10 characters</div>
                  )}
                </div>

                {/* Mood */}
                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 8 }}>
                    How are you feeling? <span style={{ color: '#999', fontWeight: 400 }}>(optional)</span>
                  </label>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                    {moods.map(m => (
                      <button
                        key={m.value}
                        onClick={() => setMood(mood === m.value ? null : m.value)}
                        title={m.label}
                        style={{
                          width: 44, height: 44, borderRadius: '50%', border: 'none', cursor: 'pointer',
                          fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: mood === m.value ? '#e0f2e9' : '#f5f5f5',
                          outline: mood === m.value ? '2px solid #1b6b5a' : 'none',
                          transition: 'all 0.15s',
                        }}
                      >
                        {m.emoji}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Error */}
                {error && (
                  <div style={{ padding: '8px 12px', background: '#fce4ec', color: '#c62828', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
                    {error}
                  </div>
                )}

                {/* Submit */}
                <button
                  onClick={handleSubmit}
                  disabled={description.trim().length < 10 || submitting}
                  style={{
                    width: '100%', padding: '12px', borderRadius: 8, border: 'none',
                    background: description.trim().length >= 10 && !submitting ? '#1b6b5a' : '#ccc',
                    color: '#fff', fontSize: 14, fontWeight: 600, cursor: description.trim().length >= 10 && !submitting ? 'pointer' : 'not-allowed',
                    transition: 'background 0.2s',
                  }}
                >
                  {submitting ? 'Submitting...' : 'Submit Feedback'}
                </button>
              </React.Fragment>
            )}
          </div>
        </div>
      )}
    </React.Fragment>
  );
};
