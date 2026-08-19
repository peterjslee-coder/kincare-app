// ─── Demo Account Picker Page ───
// Shown when visitors click "View Live Demo" on the splash page.
// Lets them pick which demo persona to log in as — no confusion with registration.
const DemoPickerPage = window.DemoPickerPage = ({ onLogin, onNavigate }) => {
  const [loading, setLoading] = React.useState(null); // email of account being logged in

  const demoAccounts = [
    {
      email: 'paul@inplace.care',
      label: 'Paul Lowe',
      role: 'Family (Care Team)',
      color: 'var(--role-color)',
      icon: '👨‍👩‍👧',
      description: 'You\'re managing care for your 78-year-old mother Barbara, who has early-stage dementia. See the full dashboard — scheduling, caregiver management, care profile, messaging, and analytics.',
    },
    {
      email: 'maria@inplace.care',
      label: 'Maria Santos',
      role: 'Caregiver / Companion',
      color: '#2e7d6d',
      icon: '🤝',
      description: 'You\'re a professional caregiver assigned to the Lowe family. See your schedule, earnings, assigned families, area map, and client reviews.',
    },
    {
      email: 'barbara@inplace.care',
      label: 'Barbara Lowe',
      role: 'I Would Like Help',
      color: 'var(--accent-color)',
      icon: '🌷',
      description: 'You\'re the person receiving care — Paul\'s mother. See your upcoming visits on a simple calendar and write personal notes for your caregivers.',
    },
  ];

  const handleDemoLogin = async (account) => {
    setLoading(account.email);
    trackAuthEvent('demo', 'demo_login', { email: account.email, role: account.role, label: account.label, source: 'demo_picker' });
    try {
      const csrf = typeof getCsrfToken === 'function' ? getCsrfToken() : null;
      const hdrs = { 'Content-Type': 'application/json' };
      if (csrf) hdrs['X-CSRF-Token'] = csrf;
      const res = await fetch('/api/auth/demo-login', {
        method: 'POST',
        headers: hdrs,
        credentials: 'same-origin',
        body: JSON.stringify({ email: account.email }),
      });
      const data = await res.json();
      if (data.token) {
        // Set token in memory only (cookie cleared by server for demo logins)
        AUTH_TOKEN = data.token;
        // Clear stale active role from previous demo user
        if (window.setActiveRole) window.setActiveRole(null);
        if (window.connectSocket) connectSocket(data.token);
        trackAuthEvent('demo', 'demo_success', { email: account.email, label: account.label });
        onLogin(data.user || { role: 'family' });
      } else {
        trackAuthEvent('demo', 'error', { email: account.email, error: 'No token returned', source: 'demo_login' });
        setLoading(null);
      }
    } catch (err) {
      console.error('Demo login failed:', err);
      trackAuthEvent('demo', 'error', { email: account.email, error: err.message, source: 'demo_login' });
      setLoading(null);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
      {/* Header */}
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 24px', background: 'var(--bg-surface)', borderBottom: '1px solid #e8e8e8',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }} onClick={() => onNavigate('splash')}>
          <InPlaceIcon width={32} height={32} />
          <span style={{ fontSize: '20px', fontWeight: 700 }}>
            <span style={{ color: 'var(--role-color)' }}>in</span><span style={{ color: 'var(--text-primary)' }}>Place</span>
          </span>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button onClick={() => onNavigate('login')} style={{
            padding: '8px 20px', fontSize: '14px', fontWeight: 600,
            background: 'transparent', color: 'var(--role-color)', border: '1.5px solid #1b6b5a',
            borderRadius: '6px', cursor: 'pointer',
          }}>Sign In</button>
          <button onClick={() => onNavigate('register')} style={{
            padding: '8px 20px', fontSize: '14px', fontWeight: 600,
            background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none',
            borderRadius: '6px', cursor: 'pointer',
          }}>Sign Up</button>
        </div>
      </nav>

      {/* Content */}
      {/* v1.105.97 — the walkthrough used to sit HERE, above the persona cards, and that is why
          "View Live Demo" felt like it did nothing. Pete: "on the splash there's a 'view the live
          demo' but that only takes you to the 'see it in action' page in which you can click
          (again) on 'view the live demo'...which is confusing."

          He was reading the screen correctly. Both pages opened with the same "See It In Action"
          heading and the same seven-step story, so pressing the button appeared to land you back
          where you started, with another button offering the thing you had just asked for. The
          demo cards were real and below the fold.

          A page called "View Live Demo" opens with the live demo. The walkthrough still follows,
          for anyone who scrolled past it the first time. */}
      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '48px 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <h1 style={{ fontSize: '32px', color: 'var(--role-color)', marginBottom: '12px', fontWeight: 700 }}>
            Try the Live Demo
          </h1>
          <p style={{ fontSize: '17px', color: 'var(--text-secondary)', maxWidth: '560px', margin: '0 auto', lineHeight: 1.6 }}>
            Pick a person below and you're straight into the real app, seeing exactly what they see. Nothing to sign up for, nothing to fill in.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {demoAccounts.map((account) => (
            <button
              key={account.email}
              onClick={() => handleDemoLogin(account)}
              disabled={loading !== null}
              style={{
                display: 'flex', alignItems: 'center', gap: '20px',
                padding: '24px 28px', background: 'var(--bg-surface)', border: '2px solid #e8e8e8',
                borderRadius: '12px', cursor: loading ? 'wait' : 'pointer',
                textAlign: 'left', transition: 'all 0.2s', width: '100%',
                opacity: loading && loading !== account.email ? 0.5 : 1,
                boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
              }}
              onMouseEnter={(e) => { if (!loading) { e.currentTarget.style.borderColor = account.color; e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)'; }}}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-light)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.04)'; }}
            >
              {/* Avatar */}
              <div style={{
                width: '56px', height: '56px', borderRadius: '50%',
                background: account.color, display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: '28px', flexShrink: 0,
              }}>
                {account.icon}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {account.label}
                  </span>
                  <span style={{
                    fontSize: '12px', fontWeight: 600, color: account.color,
                    background: account.color + '15', padding: '3px 10px',
                    borderRadius: '12px', whiteSpace: 'nowrap',
                  }}>
                    {account.role}
                  </span>
                </div>
                <div style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {account.description}
                </div>
              </div>

              {/* Arrow / Loading */}
              <div style={{ flexShrink: 0, color: 'var(--text-muted)', fontSize: '20px' }}>
                {loading === account.email ? (
                  <div style={{
                    width: '24px', height: '24px', border: '3px solid #ddd',
                    borderTopColor: account.color, borderRadius: '50%',
                    animation: 'spin 0.6s linear infinite',
                  }} />
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                )}
              </div>
            </button>
          ))}
        </div>

        {/* Footer note */}
        <div style={{ textAlign: 'center', marginTop: '32px', color: 'var(--text-muted)', fontSize: '13px' }}>
          Click any card above to explore InPlace as that user.
        </div>
      </div>

      {/* ── See It In Action walkthrough — below the demo, not in front of it ── */}
      <div style={{ borderTop: '1px solid var(--border-color)' }}>
        <CareStoryWalkthrough onNavigate={onNavigate} compact={true} />
      </div>
    </div>
  );
};
