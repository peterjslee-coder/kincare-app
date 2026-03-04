// ─── Floating Feedback Button ───
// Persistent FAB on every screen, opens feedback submission modal.
// Draggable so it never blocks UI. Always on top of modals/popups.
// Captures rich context: page, role, open modal, device, recent errors.
const FeedbackButton = window.FeedbackButton = ({ currentPage, userRole, currentUser }) => {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('general');
  const [description, setDescription] = useState('');
  const [mood, setMood] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  // Dragging state
  const [pos, setPos] = useState(() => {
    try {
      const saved = localStorage.getItem('inplace_fab_pos');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return null; // null = use default CSS position
  });
  const dragRef = React.useRef({ dragging: false, startX: 0, startY: 0, startPosX: 0, startPosY: 0, moved: false });
  const fabRef = React.useRef(null);

  // Refs for console error tracking
  const recentErrorsRef = React.useRef([]);
  const errorListenerRef = React.useRef(null);

  // Snapshot of context at moment feedback modal opens
  const contextSnapshotRef = React.useRef(null);

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

  // Detect open modals/popups in the DOM
  const detectOpenModals = () => {
    const modals = [];
    // Look for common modal patterns: elements with high z-index overlays, role="dialog", .modal classes
    document.querySelectorAll('[role="dialog"], [aria-modal="true"], .modal, .modal-overlay').forEach(el => {
      if (el.offsetParent !== null) { // visible
        modals.push(el.getAttribute('aria-label') || el.getAttribute('data-modal') || el.className?.split?.(' ')?.[0] || 'modal');
      }
    });
    // Check for fixed-position overlays (common pattern in our app)
    document.querySelectorAll('div[style]').forEach(el => {
      const s = el.style;
      if (s.position === 'fixed' && s.inset === '0px' && el.offsetParent !== null) {
        // This is likely an overlay/modal
        const heading = el.querySelector('h2, h3, h4');
        if (heading) modals.push(heading.textContent?.trim()?.substring(0, 50));
      }
    });
    return modals.length > 0 ? modals : null;
  };

  // Build rich pageContext with device/browser info
  const buildPageContext = () => {
    const ua = navigator.userAgent;
    const { browserName, browserVersion, osName, osVersion } = parseUserAgent(ua);

    // Use the snapshot taken when modal opened (captures the state BEFORE feedback modal)
    const snapshot = contextSnapshotRef.current || {};

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
      // Flow context — what was open when user tapped feedback
      openModals: snapshot.openModals || null,
      activeElement: snapshot.activeElement || null,
      scrollPosition: snapshot.scrollY || 0,
      navigationHistory: snapshot.navHistory || null,
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

  const handleOpen = () => {
    // Snapshot the current UI state BEFORE opening feedback modal
    contextSnapshotRef.current = {
      openModals: detectOpenModals(),
      activeElement: document.activeElement?.tagName?.toLowerCase() + (document.activeElement?.id ? '#' + document.activeElement.id : ''),
      scrollY: Math.round(window.scrollY),
      navHistory: window.__navHistory ? [...window.__navHistory].slice(-5) : null,
    };
    resetForm();
    setOpen(true);
  };
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

  // ─── Drag handlers (touch + mouse) ───
  const handleDragStart = (e) => {
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const fab = fabRef.current;
    if (!fab) return;
    const rect = fab.getBoundingClientRect();
    dragRef.current = {
      dragging: true,
      startX: clientX,
      startY: clientY,
      startPosX: rect.left,
      startPosY: rect.top,
      moved: false,
    };
  };

  const handleDragMove = React.useCallback((e) => {
    if (!dragRef.current.dragging) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const dx = clientX - dragRef.current.startX;
    const dy = clientY - dragRef.current.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragRef.current.moved = true;
    if (!dragRef.current.moved) return;
    e.preventDefault(); // prevent scroll while dragging
    const newX = Math.max(0, Math.min(window.innerWidth - 48, dragRef.current.startPosX + dx));
    const newY = Math.max(0, Math.min(window.innerHeight - 48, dragRef.current.startPosY + dy));
    setPos({ x: newX, y: newY });
  }, []);

  const handleDragEnd = React.useCallback(() => {
    if (!dragRef.current.dragging) return;
    dragRef.current.dragging = false;
    // Save position
    if (dragRef.current.moved && pos) {
      try { localStorage.setItem('inplace_fab_pos', JSON.stringify(pos)); } catch (e) {}
    }
  }, [pos]);

  // Attach global move/end listeners while dragging
  React.useEffect(() => {
    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleDragEnd);
    window.addEventListener('touchmove', handleDragMove, { passive: false });
    window.addEventListener('touchend', handleDragEnd);
    return () => {
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
      window.removeEventListener('touchmove', handleDragMove);
      window.removeEventListener('touchend', handleDragEnd);
    };
  }, [handleDragMove, handleDragEnd]);

  const handleFabClick = () => {
    if (dragRef.current.moved) return; // was a drag, not a click
    handleOpen();
  };

  const moods = [
    { emoji: '\u{1F60A}', value: 'great', label: 'Great' },
    { emoji: '\u{1F642}', value: 'good', label: 'Good' },
    { emoji: '\u{1F610}', value: 'okay', label: 'Okay' },
    { emoji: '\u{1F61F}', value: 'bad', label: 'Bad' },
    { emoji: '\u{1F621}', value: 'terrible', label: 'Terrible' },
  ];

  const categories = [
    { value: 'bug', label: 'Bug Report' },
    { value: 'feature', label: 'Feature Request' },
    { value: 'general', label: 'General Feedback' },
    { value: 'complaint', label: 'Complaint' },
    { value: 'praise', label: 'Praise' },
  ];

  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;

  // Compute FAB style: custom position if dragged, else default
  const fabStyle = pos ? {
    position: 'fixed',
    left: pos.x,
    top: pos.y,
    width: 48,
    height: 48,
    borderRadius: '50%',
    background: '#1b6b5a',
    border: 'none',
    cursor: 'grab',
    boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    transition: dragRef.current.dragging ? 'none' : 'transform 0.2s, box-shadow 0.2s',
    touchAction: 'none',
    WebkitTouchCallout: 'none',
    userSelect: 'none',
  } : {
    position: 'fixed',
    bottom: isMobile ? (currentPage === 'messages' ? 130 : 80) : 24,
    left: isMobile ? 16 : 'auto',
    right: isMobile ? 'auto' : 20,
    width: 48,
    height: 48,
    borderRadius: '50%',
    background: '#1b6b5a',
    border: 'none',
    cursor: 'grab',
    boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    transition: 'transform 0.2s, box-shadow 0.2s',
    touchAction: 'none',
    WebkitTouchCallout: 'none',
    userSelect: 'none',
  };

  return (
    React.createElement(React.Fragment, null,
      // FAB
      React.createElement('button', {
        ref: fabRef,
        onClick: handleFabClick,
        onMouseDown: handleDragStart,
        onTouchStart: handleDragStart,
        'aria-label': 'Send feedback',
        style: fabStyle,
        onMouseEnter: e => { if (!dragRef.current.dragging) { e.currentTarget.style.transform = 'scale(1.1)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.3)'; }},
        onMouseLeave: e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.25)'; },
      },
        React.createElement('svg', { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'white', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
          React.createElement('path', { d: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z' })
        )
      ),

      // Modal
      open && React.createElement('div', {
        style: {
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 10001, padding: 16,
        },
        onClick: (e) => { if (e.target === e.currentTarget) handleClose(); },
      },
        React.createElement('div', {
          style: {
            background: '#fff', borderRadius: 16, width: '100%', maxWidth: 420,
            maxHeight: '85vh', overflow: 'auto', padding: 24,
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          },
        },
          submitted ? (
            React.createElement('div', { style: { textAlign: 'center', padding: '32px 0' } },
              React.createElement('div', { style: { fontSize: 48, marginBottom: 12 } }, '\u{1F389}'),
              React.createElement('div', { style: { fontSize: 18, fontWeight: 600, color: '#1b6b5a' } }, 'Thank you!'),
              React.createElement('div', { style: { fontSize: 13, color: '#888', marginTop: 4 } }, 'Your feedback has been submitted.')
            )
          ) : (
            React.createElement(React.Fragment, null,
              // Header
              React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 } },
                React.createElement('h3', { style: { margin: 0, fontSize: 18, fontWeight: 700, color: '#333' } }, 'Share Feedback'),
                React.createElement('button', {
                  onClick: handleClose,
                  style: {
                    background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: '#999',
                    width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%',
                  },
                }, '\u00D7')
              ),

              // Context hint — show user what screen is being captured
              React.createElement('div', { style: { fontSize: 11, color: '#999', marginBottom: 12, padding: '6px 10px', background: '#f8f8f8', borderRadius: 6 } },
                '\u{1F4CD} Captured: ', currentPage || 'unknown', ' page',
                contextSnapshotRef.current?.openModals ? ' \u2022 popup: ' + contextSnapshotRef.current.openModals[0] : '',
                ' \u2022 ', userRole || ''
              ),

              // Category
              React.createElement('div', { style: { marginBottom: 16 } },
                React.createElement('label', { style: { display: 'block', fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 6 } }, 'Category'),
                React.createElement('select', {
                  value: category,
                  onChange: e => setCategory(e.target.value),
                  style: {
                    width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd',
                    fontSize: 14, color: '#333', background: '#fff', appearance: 'auto',
                  },
                },
                  categories.map(c => React.createElement('option', { key: c.value, value: c.value }, c.label))
                )
              ),

              // Description
              React.createElement('div', { style: { marginBottom: 16 } },
                React.createElement('label', { style: { display: 'block', fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 6 } },
                  'Description ', React.createElement('span', { style: { color: '#999', fontWeight: 400 } }, '(required)')
                ),
                React.createElement('textarea', {
                  value: description,
                  onChange: e => setDescription(e.target.value),
                  placeholder: "Tell us what's on your mind...",
                  rows: 4,
                  style: {
                    width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd',
                    fontSize: 14, color: '#333', resize: 'vertical', fontFamily: 'inherit',
                    boxSizing: 'border-box',
                  },
                }),
                description.length > 0 && description.trim().length < 10 && (
                  React.createElement('div', { style: { fontSize: 11, color: '#e8724a', marginTop: 4 } }, 'Please write at least 10 characters')
                )
              ),

              // Mood
              React.createElement('div', { style: { marginBottom: 20 } },
                React.createElement('label', { style: { display: 'block', fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 8 } },
                  'How are you feeling? ', React.createElement('span', { style: { color: '#999', fontWeight: 400 } }, '(optional)')
                ),
                React.createElement('div', { style: { display: 'flex', gap: 8, justifyContent: 'center' } },
                  moods.map(m =>
                    React.createElement('button', {
                      key: m.value,
                      onClick: () => setMood(mood === m.value ? null : m.value),
                      title: m.label,
                      style: {
                        width: 44, height: 44, borderRadius: '50%', border: 'none', cursor: 'pointer',
                        fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: mood === m.value ? '#e0f2e9' : '#f5f5f5',
                        outline: mood === m.value ? '2px solid #1b6b5a' : 'none',
                        transition: 'all 0.15s',
                      },
                    }, m.emoji)
                  )
                )
              ),

              // Error
              error && React.createElement('div', {
                style: { padding: '8px 12px', background: '#fce4ec', color: '#c62828', borderRadius: 8, fontSize: 13, marginBottom: 12 },
              }, error),

              // Submit
              React.createElement('button', {
                onClick: handleSubmit,
                disabled: description.trim().length < 10 || submitting,
                style: {
                  width: '100%', padding: '12px', borderRadius: 8, border: 'none',
                  background: description.trim().length >= 10 && !submitting ? '#1b6b5a' : '#ccc',
                  color: '#fff', fontSize: 14, fontWeight: 600,
                  cursor: description.trim().length >= 10 && !submitting ? 'pointer' : 'not-allowed',
                  transition: 'background 0.2s',
                },
              }, submitting ? 'Submitting...' : 'Submit Feedback')
            )
          )
        )
      )
    )
  );
};
