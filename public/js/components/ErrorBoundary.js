// ─── ErrorBoundary (v1.104.4) ───
// Converts a white-screen-of-death (any render/lifecycle throw) into a
// recoverable screen AND reports the real stack to the server → Sentry.
//
// Why this exists: the app compiles all JSX in-browser with no build-time
// checks, so an undeclared identifier or a null-deref in any component throws
// at render and React unmounts the whole tree — the user sees a blank page and
// our server-side Sentry never learns why (it only sees backend errors). This
// boundary catches those, shows a friendly reload UI, and beacons the error so
// we get the component stack for the exact crash (e.g. the Stripe Payments-tab
// crashes that took two guesses to find).
const ErrorBoundary = window.ErrorBoundary = class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, reported: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Report once per crash. Best-effort — never let reporting throw.
    if (this.state.reported) return;
    this.setState({ reported: true });
    try {
      const payload = {
        message: String(error && error.message || error),
        stack: String(error && error.stack || '').slice(0, 4000),
        componentStack: String(info && info.componentStack || '').slice(0, 4000),
        page: (typeof window !== 'undefined' && window.__currentPage) || null,
        url: (typeof window !== 'undefined' && (window.location.hash || window.location.pathname)) || null,
        version: (typeof window !== 'undefined' && window.APP_VERSION) || null,
        userAgent: (typeof navigator !== 'undefined' && navigator.userAgent) || null,
        standalone: (typeof window !== 'undefined' &&
          (window.navigator.standalone === true ||
           (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches))) || false,
      };
      // keepalive so the beacon survives the crashed view / a reload tap
      fetch('/api/client-error', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
      if (window.console) console.error('[ErrorBoundary]', error, info);
    } catch (_) { /* swallow */ }
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    const wrap = {
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, background: '#f7f7f5', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    };
    const card = {
      background: '#fff', borderRadius: 16, padding: '32px 28px', maxWidth: 420, width: '100%',
      textAlign: 'center', boxShadow: '0 2px 14px rgba(0,0,0,0.08)',
    };
    const btn = {
      marginTop: 20, padding: '12px 24px', background: '#1b6b5a', color: '#fff', border: 'none',
      borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer',
    };
    const reload = () => {
      try {
        if (window.caches) {
          caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))).finally(() => window.location.reload());
        } else { window.location.reload(); }
      } catch (_) { window.location.reload(); }
    };
    return React.createElement('div', { style: wrap },
      React.createElement('div', { style: card },
        React.createElement('div', { style: { fontSize: 44, marginBottom: 12 } }, '⚠️'),
        React.createElement('h2', { style: { margin: '0 0 8px', fontSize: 20, color: '#222' } }, 'Something went wrong'),
        React.createElement('p', { style: { fontSize: 15, color: '#666', lineHeight: 1.6, margin: 0 } },
          "This screen hit a snag and couldn't load. Reloading usually fixes it. Our team has been notified automatically."),
        React.createElement('button', { style: btn, onClick: reload }, 'Reload')
      )
    );
  }
};
