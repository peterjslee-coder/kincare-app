// Main App Component — role-aware routing & sidebar
const App = () => {
  const [appState, setAppState] = useState('splash');
  const [currentUser, setCurrentUser] = useState(null);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [showRequestCareModal, setShowRequestCareModal] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [resetToken, setResetToken] = useState(null);

  useEffect(() => {
    const savedToken = localStorage.getItem('auth_token');
    if (savedToken) {
      AUTH_TOKEN = savedToken;
    }
    // Check for password reset token in URL
    const params = new URLSearchParams(window.location.search);
    const rt = params.get('reset');
    if (rt) {
      setResetToken(rt);
      setAppState('reset-password');
      // Clean URL without reload
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleLogin = (user) => {
    setCurrentUser(user);
    setCurrentPage('dashboard');
    setAppState('app');
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setAuthToken(null);
    setCurrentPage('dashboard');
    setAppState('splash');
  };

  const handleNavigate = (page) => {
    setAppState(page);
  };

  const handlePageChange = (page) => {
    setCurrentPage(page);
    setSidebarOpen(false);
  };

  if (appState === 'splash') return <SplashPage onNavigate={handleNavigate} />;
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
    return [
      { id: 'dashboard', icon: '🏠', label: 'Dashboard' },
      { id: 'care-profile', icon: '👵', label: 'Care Profile' },
      { id: 'schedule', icon: '📅', label: 'Schedule' },
      { id: 'caregivers', icon: '👨‍⚕️', label: 'Caregivers' },
      { id: 'activity', icon: '📢', label: 'Activity Feed' },
      { id: 'recipients', icon: '👥', label: 'Recipients' },
      { id: 'messages', icon: '💬', label: 'Messages' },
      { id: 'account', icon: '👤', label: 'My Account' },
    ];
  };

  // Role label for sidebar header
  const getRoleLabel = () => {
    if (role === 'caregiver') return 'Caregiver';
    if (role === 'care_for') return 'Care Recipient';
    return 'Care Team';
  };

  const renderPage = () => {
    // Role-aware page rendering
    if (currentPage === 'dashboard') {
      if (role === 'caregiver') return <CaretakerHub />;
      if (role === 'care_for') return <CaredForView />;
      return <Dashboard onNavigate={setCurrentPage} />;
    }
    if (currentPage === 'care-profile') return <CareProfile />;
    if (currentPage === 'schedule') return <Schedule />;
    if (currentPage === 'caregivers') return <Caregivers />;
    if (currentPage === 'activity') return <ActivityFeed />;
    if (currentPage === 'recipients') return <CareRecipients />;
    if (currentPage === 'messages') return <Messages />;
    if (currentPage === 'account') return <MyAccount />;
    return <Dashboard onNavigate={setCurrentPage} />;
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

  return (
    <div className="app-container">
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
          <button className="nav-link" onClick={handleLogout}>
            <span className="nav-icon">🚪</span> Logout
          </button>
        </div>
      </aside>
      <main className="main-content">
        <button className="hamburger-btn" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
          <span></span><span></span><span></span>
        </button>
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
    </div>
  );
};

ReactDOM.render(<App />, document.getElementById('root'));
