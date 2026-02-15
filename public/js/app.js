// Main App Component
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

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <KinCareIcon width={40} height={40} />
          <div className="sidebar-logo-text">KinCare</div>
        </div>
        <nav>
          <ul className="nav-menu">
            {[
              { id: 'dashboard', icon: '🏠', label: 'Dashboard' },
              { id: 'care-profile', icon: '👵', label: 'Care Profile' },
              { id: 'schedule', icon: '📅', label: 'Schedule' },
              { id: 'caregivers', icon: '👨‍⚕️', label: 'Caregivers' },
              { id: 'activity', icon: '📢', label: 'Activity Feed' },
              { id: 'recipients', icon: '👥', label: 'Recipients' },
              { id: 'messages', icon: '💬', label: 'Messages' },
              { id: 'account', icon: '👤', label: 'My Account' },
              { id: 'caretaker', icon: '🩺', label: 'Caretaker Hub' }
            ].map(item => (
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
          <button className="nav-link" onClick={() => setShowRequestCareModal(true)} style={{ background: '#1b6b5a', marginBottom: '12px' }}>
            <span className="nav-icon">➕</span> Request Care
          </button>
          <button className="nav-link" onClick={handleLogout}>
            <span className="nav-icon">🚪</span> Logout
          </button>
        </div>
      </aside>
      <main className="main-content">
        {currentPage === 'dashboard' && <Dashboard />}
        {currentPage === 'care-profile' && <CareProfile />}
        {currentPage === 'schedule' && <Schedule />}
        {currentPage === 'caregivers' && <Caregivers />}
        {currentPage === 'activity' && <ActivityFeed />}
        {currentPage === 'recipients' && <CareRecipients />}
        {currentPage === 'messages' && <Messages />}
        {currentPage === 'account' && <MyAccount />}
        {currentPage === 'caretaker' && <CaretakerHub />}
      </main>
      {showRequestCareModal && <RequestCareModal onClose={() => setShowRequestCareModal(false)} />}
    </div>
  );
};

ReactDOM.render(<App />, document.getElementById('root'));
