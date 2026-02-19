// ─── PWA Install Prompt ───
const PWAInstallBanner = window.PWAInstallBanner = () => {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
      setIsStandalone(true);
      return;
    }
    // Check if previously dismissed
    if (localStorage.getItem('pwa_dismissed')) {
      setDismissed(true);
      return;
    }
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      window.__pwaInstallPrompt = e;
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem('pwa_dismissed', '1');
  };

  if (isStandalone || dismissed || !deferredPrompt) return null;

  return (
    <div className="pwa-install-banner">
      <img src="/icons/icon-192.png" alt="InPlace" className="pwa-install-banner-icon" />
      <div className="pwa-install-banner-text">
        <div className="pwa-install-banner-title">Add InPlace to Home Screen</div>
        <div className="pwa-install-banner-subtitle">Quick access to care coordination</div>
      </div>
      <button className="pwa-install-btn" onClick={handleInstall}>Install</button>
      <button className="pwa-install-dismiss" onClick={handleDismiss}>&times;</button>
    </div>
  );
};

// ─── Offline Indicator ───
const OfflineIndicator = window.OfflineIndicator = () => {
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: '#e65100', color: '#fff', textAlign: 'center',
      padding: '6px 12px', fontSize: '13px', fontWeight: 600,
    }}>
      You're offline — some features may be unavailable
    </div>
  );
};

// ─── Demo Mode Banner ───
// Persistent header bar when logged in as a demo account.
// Shows current persona, quick-switch buttons for other demo accounts, and Exit Demo button.
const DemoModeBanner = window.DemoModeBanner = ({ currentUser, onSwitchAccount, onExit }) => {
  const [switching, setSwitching] = useState(null);

  const demoAccounts = [
    { email: 'pete@inplace.care', label: 'Pete', icon: '👨‍👩‍👧', color: '#1b6b5a' },
    { email: 'david.lee@inplace.care', label: 'David', icon: '👨', color: '#1b6b5a' },
    { email: 'susan.lee@inplace.care', label: 'Susan', icon: '👩', color: '#1b6b5a' },
    { email: 'maria@inplace.care', label: 'Maria', icon: '👩‍⚕️', color: '#2e7d6d' },
    { email: 'betty@inplace.care', label: 'Betty', icon: '👵', color: '#e8724a' },
  ];

  const handleSwitch = async (account) => {
    if (account.email === currentUser?.email) return;
    setSwitching(account.email);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: account.email, password: 'inplace123' }),
      });
      const data = await res.json();
      if (data.token) {
        setAuthToken(data.token);
        if (window.connectSocket) connectSocket(data.token);
        onSwitchAccount(data.user || { role: 'family' });
      }
    } catch (err) {
      console.error('Demo switch failed:', err);
    }
    setSwitching(null);
  };

  return (
    <div className="demo-mode-banner">
      <div className="demo-mode-banner-inner">
        <span className="demo-mode-label">DEMO</span>
        <div className="demo-mode-accounts">
          {demoAccounts.map((account) => {
            const isActive = account.email === currentUser?.email;
            const isLoading = switching === account.email;
            return (
              <button
                key={account.email}
                onClick={() => handleSwitch(account)}
                disabled={isActive || switching !== null}
                className={`demo-mode-chip ${isActive ? 'active' : ''}`}
                style={{ '--chip-color': account.color }}
                title={`Switch to ${account.label}`}
              >
                {isLoading ? (
                  <span className="demo-mode-chip-spinner" />
                ) : (
                  <span className="demo-mode-chip-icon">{account.icon}</span>
                )}
                <span className="demo-mode-chip-label">{account.label}</span>
              </button>
            );
          })}
        </div>
        <button className="demo-mode-exit" onClick={onExit}>
          Exit Demo
        </button>
      </div>
    </div>
  );
};

// Main App Component — role-aware routing & sidebar
const App = () => {
  const [appState, setAppState] = useState('splash');
  const [currentUser, setCurrentUser] = useState(null);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [showRequestCareModal, setShowRequestCareModal] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Expose modal opener for child components (Schedule empty state CTA)
  useEffect(() => {
    window.__openRequestCareModal = () => setShowRequestCareModal(true);
    return () => { delete window.__openRequestCareModal; };
  }, []);
  const [resetToken, setResetToken] = useState(null);
  const [verifyMessage, setVerifyMessage] = useState(null);
  const [pendingInviteToken, setPendingInviteToken] = useState(null);
  const [selectedCareTeamId, setSelectedCareTeamId] = useState(null);

  useEffect(() => {
    const savedToken = localStorage.getItem('auth_token');
    if (savedToken) {
      AUTH_TOKEN = savedToken;
      // Auto-connect WebSocket if returning user
      if (typeof connectSocket === 'function') connectSocket(savedToken);
      // Restore user session from token
      apiFetch('/api/auth/me').then(async r => {
        if (r?.ok) {
          const data = await r.json();
          if (data.user) {
            setCurrentUser({
              id: data.user.id, email: data.user.email, role: data.user.role,
              firstName: data.user.first_name, lastName: data.user.last_name,
              emailVerified: !!data.user.email_verified, isDemo: !!data.user.is_demo,
              isAdmin: !!data.user.is_admin,
            });
            setAppState('app');
          }
        }
      }).catch(() => {});
    }
    const params = new URLSearchParams(window.location.search);

    // Check for email verification token in URL
    const vt = params.get('verify');
    if (vt) {
      window.history.replaceState({}, '', window.location.pathname);
      apiFetch(`/api/auth/verify?token=${vt}`)
        .then(r => r?.json())
        .then(data => {
          if (data?.message) setVerifyMessage({ type: 'success', text: data.message });
          else setVerifyMessage({ type: 'error', text: data?.error || 'Verification failed' });
        })
        .catch(() => setVerifyMessage({ type: 'error', text: 'Verification failed' }));
    }

    // Check for password reset token in URL
    const rt = params.get('reset');
    if (rt) {
      setResetToken(rt);
      setAppState('reset-password');
      window.history.replaceState({}, '', window.location.pathname);
    }

    // Check for care team invite token in URL
    const inviteToken = params.get('invite');
    if (inviteToken) {
      setPendingInviteToken(inviteToken);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleLogin = (user) => {
    setCurrentUser(user);
    setCurrentPage('dashboard');
    setAppState('app');
    // Subscribe to push notifications after login (non-blocking)
    if (typeof subscribeToPush === 'function') {
      subscribeToPush().catch(() => {});
    }
    // Connect WebSocket for real-time updates
    const token = localStorage.getItem('auth_token');
    if (token && typeof connectSocket === 'function') {
      connectSocket(token);
    }
    // Accept pending care team invite if one exists
    if (pendingInviteToken) {
      apiFetch('/api/care-teams/accept-invite', {
        method: 'POST',
        body: JSON.stringify({ token: pendingInviteToken }),
      }).then(async r => {
        if (r?.ok) {
          const data = await r.json();
          setVerifyMessage({ type: 'success', text: data.message || 'You\'ve joined the care team!' });
          if (data.careTeamId) { setSelectedCareTeamId(data.careTeamId); setCurrentPage('care-team'); }
        } else {
          const data = await r?.json();
          setVerifyMessage({ type: 'error', text: data?.error || 'Failed to accept invite' });
        }
      }).catch(() => {});
      setPendingInviteToken(null);
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setAuthToken(null);
    setCurrentPage('dashboard');
    setAppState('splash');
    // Disconnect WebSocket
    if (typeof disconnectSocket === 'function') disconnectSocket();
  };

  const handleExitDemo = () => {
    setCurrentUser(null);
    setAuthToken(null);
    setCurrentPage('dashboard');
    setAppState('demo');
    if (typeof disconnectSocket === 'function') disconnectSocket();
  };

  const handleDemoSwitch = (user) => {
    setCurrentUser(user);
    setCurrentPage('dashboard');
  };

  const handleNavigate = (page) => {
    setAppState(page);
  };

  const handlePageChange = (page) => {
    setCurrentPage(page);
    setSidebarOpen(false);
  };

  if (appState === 'splash') return <SplashPage onNavigate={handleNavigate} />;
  if (appState === 'demo') return <DemoPickerPage onLogin={handleLogin} onNavigate={handleNavigate} />;
  if (appState === 'login') return <LoginPage onLogin={handleLogin} onNavigate={handleNavigate} />;
  if (appState === 'register') return <RegisterPage onLogin={handleLogin} onNavigate={handleNavigate} />;
  if (appState === 'forgot-password') return <ForgotPasswordPage onNavigate={handleNavigate} />;
  if (appState === 'reset-password') return <ResetPasswordPage token={resetToken} onNavigate={handleNavigate} />;

  const role = currentUser?.role || 'family';

  // Role-based navigation items
  const getNavItems = () => {
    if (role === 'caregiver') {
      return [
        { id: 'dashboard', icon: '🩺', label: 'My Dashboard' },
        { id: 'schedule', icon: '📅', label: 'Schedule' },
        { id: 'messages', icon: '💬', label: 'Messages' },
        { id: 'account', icon: '👤', label: 'My Account' },
      ];
    }
    if (role === 'care_for') {
      return [
        { id: 'dashboard', icon: '🏠', label: 'My Home' },
        { id: 'messages', icon: '💬', label: 'Messages' },
        { id: 'account', icon: '👤', label: 'My Account' },
      ];
    }
    // family (default)
    const familyNav = [
      { id: 'dashboard', icon: '🏠', label: 'Dashboard' },
      { id: 'care-profile', icon: '👵', label: 'Care Profile' },
      { id: 'care-team', icon: '👪', label: 'Care Team' },
      { id: 'schedule', icon: '📅', label: 'Schedule' },
      { id: 'caregivers', icon: '👨‍⚕️', label: 'Caregivers' },
      { id: 'analytics', icon: '📊', label: 'Analytics' },
      { id: 'activity', icon: '📢', label: 'Activity Feed' },
      { id: 'recipients', icon: '👥', label: 'Recipients' },
      { id: 'messages', icon: '💬', label: 'Messages' },
      { id: 'account', icon: '👤', label: 'My Account' },
    ];
    if (currentUser?.isAdmin) {
      familyNav.push({ id: 'admin', icon: '🛡️', label: 'Admin' });
    }
    return familyNav;
  };

  // Role label for sidebar header
  const getRoleLabel = () => {
    if (role === 'caregiver') return 'Caregiver';
    if (role === 'care_for') return 'Care Recipient';
    return 'Care Team';
  };

  const renderPage = () => {
    // Role-aware page rendering
    // key={currentPage} forces full remount on page switch — fixes stale state bugs (e.g., calendar heat map)
    if (currentPage === 'dashboard') {
      if (role === 'caregiver') return <CaretakerHub key={currentPage} />;
      if (role === 'care_for') return <CaredForView key={currentPage} />;
      return <Dashboard key={currentPage} onNavigate={setCurrentPage} />;
    }
    if (currentPage === 'care-profile') return <CareProfile key={currentPage} />;
    if (currentPage === 'care-team') return <CareTeamPage key={currentPage} selectedTeamId={selectedCareTeamId} onNavigate={setCurrentPage} />;
    if (currentPage === 'schedule') return <Schedule key={currentPage} />;
    if (currentPage === 'caregivers') return <Caregivers key={currentPage} />;
    if (currentPage === 'analytics') return <Analytics key={currentPage} />;
    if (currentPage === 'activity') return <ActivityFeed key={currentPage} />;
    if (currentPage === 'recipients') return <CareRecipients key={currentPage} />;
    if (currentPage === 'messages') return <Messages key={currentPage} />;
    if (currentPage === 'account') return <MyAccount key={currentPage} />;
    if (currentPage === 'admin' && currentUser?.isAdmin) return <AdminPanel key={currentPage} />;
    return <Dashboard key={currentPage} onNavigate={setCurrentPage} />;
  };

  // Bottom nav items (max 5 for mobile)
  const getBottomNavItems = () => {
    if (role === 'caregiver') {
      return [
        { id: 'dashboard', icon: '🩺', label: 'Home' },
        { id: 'schedule', icon: '📅', label: 'Schedule' },
        { id: 'messages', icon: '💬', label: 'Messages' },
        { id: 'account', icon: '👤', label: 'Account' },
      ];
    }
    if (role === 'care_for') {
      return [
        { id: 'dashboard', icon: '🏠', label: 'Home' },
        { id: 'messages', icon: '💬', label: 'Messages' },
        { id: 'account', icon: '👤', label: 'Account' },
      ];
    }
    return [
      { id: 'dashboard', icon: '🏠', label: 'Home' },
      { id: 'schedule', icon: '📅', label: 'Schedule' },
      { id: 'caregivers', icon: '👨‍⚕️', label: 'Care' },
      { id: 'messages', icon: '💬', label: 'Messages' },
      { id: 'account', icon: '👤', label: 'More' },
    ];
  };

  const isDemo = currentUser?.isDemo;

  const appContent = (
    <React.Fragment>
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-logo">
          <InPlaceIcon width={36} height={36} />
          <div className="sidebar-logo-text"><span className="logo-in">in</span><span className="logo-place">Place</span></div>
          <button className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu">&times;</button>
        </div>
        <div style={{ padding: '0 16px 12px', fontSize: '11px', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '1px' }}>
          {getRoleLabel()}
        </div>
        <nav>
          <ul className="nav-menu">
            {getNavItems().map(item => (
              <li key={item.id} className="nav-item">
                <button className={`nav-link ${currentPage === item.id ? 'active' : ''}`} onClick={() => handlePageChange(item.id)}>
                  <span className="nav-icon">{item.icon}</span>
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div style={{ marginTop: '32px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          {role === 'family' && (
            <button className="nav-link" onClick={() => { setShowRequestCareModal(true); setSidebarOpen(false); }} style={{ background: '#1b6b5a', marginBottom: '12px' }}>
              <span className="nav-icon">➕</span> Request Care
            </button>
          )}
          <div style={{ padding: '8px 16px', fontSize: '12px', color: 'rgba(255,255,255,0.6)', marginBottom: '8px' }}>
            {currentUser?.firstName || 'User'} {currentUser?.lastName || ''}
          </div>
          <button className="nav-link" onClick={isDemo ? handleExitDemo : handleLogout}>
            <span className="nav-icon">{isDemo ? '🚪' : '🚪'}</span> {isDemo ? 'Exit Demo' : 'Logout'}
          </button>
        </div>
      </aside>
      <main className="main-content">
        <button className="hamburger-btn" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
          <span></span><span></span><span></span>
        </button>
        {verifyMessage && (
          <div style={{
            padding: '12px 16px', marginBottom: '16px', borderRadius: '8px', fontSize: '14px', fontWeight: 500,
            background: verifyMessage.type === 'success' ? '#e0f2e9' : '#fce4ec',
            color: verifyMessage.type === 'success' ? '#1b6b5a' : '#c62828',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span>{verifyMessage.type === 'success' ? '✅ ' : '⚠️ '}{verifyMessage.text}</span>
            <button onClick={() => setVerifyMessage(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: 'inherit' }}>&times;</button>
          </div>
        )}
        {currentUser && currentUser.emailVerified === false && !currentUser.isDemo && !verifyMessage && (
          <EmailVerificationBanner userId={currentUser.id} />
        )}
        {renderPage()}
      </main>
      {/* Bottom navigation bar — visible on mobile only (CSS hides on desktop) */}
      <nav className="bottom-nav">
        {getBottomNavItems().map(item => (
          <button key={item.id} className={`bottom-nav-item ${currentPage === item.id ? 'active' : ''}`} onClick={() => handlePageChange(item.id)}>
            <span className="bottom-nav-icon">{item.icon}</span>
            <span className="bottom-nav-label">{item.label}</span>
          </button>
        ))}
      </nav>
      {showRequestCareModal && <RequestCareModal onClose={() => setShowRequestCareModal(false)} />}
      <PWAInstallBanner />
      <OfflineIndicator />
    </React.Fragment>
  );

  return (
    <div className={`app-container ${isDemo ? 'demo-mode-active' : ''}`}>
      {isDemo && (
        <DemoModeBanner currentUser={currentUser} onSwitchAccount={handleDemoSwitch} onExit={handleExitDemo} />
      )}
      {isDemo ? (
        <div className="demo-mode-body">{appContent}</div>
      ) : (
        appContent
      )}
    </div>
  );
};

ReactDOM.render(
  React.createElement(ToastProvider, null, React.createElement(App)),
  document.getElementById('root')
);
