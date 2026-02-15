// Main App Component — role-aware routing & sidebar
const App = () => {
  const [appState, setAppState] = useState('splash');
  const [currentUser, setCurrentUser] = useState(null);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [showRequestCareModal, setShowRequestCareModal] = useState(false);

  useEffect(() => {
    const savedToken = localStorage.getItem('auth_token');
    if (savedToken) {
      AUTH_TOKEN = savedToken;
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

  if (appState === 'splash') return <SplashPage onNavigate={handleNavigate} />;
  if (appState === 'login') return <LoginPage onLogin={handleLogin} onNavigate={handleNavigate} />;
  if (appState === 'register') return <RegisterPage onNavigate={handleNavigate} />;

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

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <KinCareIcon width={40} height={40} />
          <div className="sidebar-logo-text">KinCare</div>
        </div>
        <div style={{ padding: '0 16px 12px', fontSize: '11px', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '1px' }}>
          {getRoleLabel()}
        </div>
        <nav>
          <ul className="nav-menu">
            {getNavItems().map(item => (
              <li key={item.id} className="nav-item">
                <button className={`nav-link ${currentPage === item.id ? 'active' : ''}`} onClick={() => setCurrentPage(item.id)}>
                  <span className="nav-icon">{item.icon}</span>
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div style={{ marginTop: '32px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          {role === 'family' && (
            <button className="nav-link" onClick={() => setShowRequestCareModal(true)} style={{ background: '#1b6b5a', marginBottom: '12px' }}>
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
        {renderPage()}
      </main>
      {showRequestCareModal && <RequestCareModal onClose={() => setShowRequestCareModal(false)} />}
    </div>
  );
};

ReactDOM.render(<App />, document.getElementById('root'));
