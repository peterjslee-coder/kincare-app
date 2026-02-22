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
    { email: 'maria@inplace.care', label: 'Maria', icon: '🤝', color: '#2e7d6d' },
    { email: 'betty@inplace.care', label: 'Betty', icon: '🌷', color: '#e8724a' },
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
        // Set token in memory only — don't persist demo sessions to localStorage
        AUTH_TOKEN = data.token;
        localStorage.removeItem('auth_token');
        // Clear stale active role from previous demo user
        if (window.setActiveRole) window.setActiveRole(null);
        if (window.connectSocket) connectSocket(data.token);
        onSwitchAccount(data.user || { role: 'family', roles: ['family'] });
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
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  // Dual-role: active role for users with multiple roles
  const [activeRole, setActiveRoleState] = useState(getActiveRole());

  // Expose modal opener for child components (Schedule empty state CTA)
  useEffect(() => {
    window.__openRequestCareModal = () => setShowRequestCareModal(true);
    return () => { delete window.__openRequestCareModal; };
  }, []);
  const [resetToken, setResetToken] = useState(null);
  const [verifyMessage, setVerifyMessage] = useState(null);
  const [pendingInviteToken, setPendingInviteToken] = useState(null);
  const pendingInviteRef = useRef(null); // Ref mirror — survives closures
  const [inviteInfo, setInviteInfo] = useState(null); // { email, role, teamName, recipientName, inviterName }
  const [platformInviteToken, setPlatformInviteToken] = useState(null);
  const [selectedCareTeamId, setSelectedCareTeamId] = useState(null);
  // Email-first signup: prefilled from signup intent token
  const [signupPrefill, setSignupPrefill] = useState(null); // { email, role, signupToken }

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
            // Don't auto-restore demo sessions — send them back to splash
            if (data.user.is_demo) {
              setAuthToken(null);
              if (typeof disconnectSocket === 'function') disconnectSocket();
              return;
            }
            const userRoles = data.user.roles || [data.user.role];
            setCurrentUser({
              id: data.user.id, email: data.user.email, role: data.user.role,
              roles: userRoles,
              firstName: data.user.first_name, lastName: data.user.last_name,
              profilePhoto: data.user.profile_photo || null,
              emailVerified: !!data.user.email_verified, isDemo: !!data.user.is_demo,
              isAdmin: !!data.user.is_admin,
            });
            // Sync active role: use saved preference if valid, else default to first role
            const saved = getActiveRole();
            const validRole = saved && userRoles.includes(saved) ? saved : userRoles[0];
            setActiveRoleState(validRole);
            window.setActiveRole(validRole);
            // Check if disclaimer needs to be accepted
            if (!data.user.disclaimer_accepted_at || data.user.disclaimer_version !== '1.0') {
              setShowDisclaimer(true);
            }
            setAppState('app');
            // If returning user has a pending invite token, accept it now
            // Note: must re-read URL here since replaceState may not have run yet at this point
            const inviteParam = new URLSearchParams(window.location.search).get('invite')
              || new URLSearchParams(window.__originalSearch || '').get('invite');
            if (inviteParam) {
              apiFetch('/api/care-teams/accept-invite', {
                method: 'POST',
                body: JSON.stringify({ token: inviteParam }),
              }).then(async r => {
                if (r?.ok) {
                  const d = await r.json();
                  setVerifyMessage({ type: 'success', text: d.message || "You've joined the care team!" });
                  if (d.careTeamId) { setSelectedCareTeamId(d.careTeamId); setCurrentPage('care-team'); }
                }
                // Silently ignore invite errors on auto-auth
              }).catch(() => {});
              setPendingInviteToken(null);
              pendingInviteRef.current = null;
              setInviteInfo(null);
            }
          }
        }
      }).catch(() => {});
    }
    const params = new URLSearchParams(window.location.search);
    // Preserve original search params before any replaceState calls strip them
    window.__originalSearch = window.location.search;

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
      pendingInviteRef.current = inviteToken;
      window.history.replaceState({}, '', window.location.pathname);
      // Fetch invite details and route to dedicated invite page
      fetch(`/api/care-teams/invite-info?token=${inviteToken}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.invite) {
            setInviteInfo(data.invite);
            // Only show invite page if user is NOT already logged in
            if (!localStorage.getItem('auth_token')) {
              setAppState('invite');
            }
          }
        })
        .catch(() => {});
      // Show invite page immediately (inviteInfo populates async)
      if (!savedToken) setAppState('invite');
    }

    // Check for platform (onboarding) invite token
    const pInvite = params.get('platformInvite');
    if (pInvite) {
      setPlatformInviteToken(pInvite);
      setAppState('platform-onboarding');
      window.history.replaceState({}, '', window.location.pathname);
    }

    // Check for email-first signup confirmation token
    const signupToken = params.get('signupToken');
    if (signupToken) {
      window.history.replaceState({}, '', window.location.pathname);
      // Validate the token and get email + role
      fetch(`/api/auth/confirm-signup?token=${signupToken}`)
        .then(r => r.json().then(data => ({ ok: r.ok, status: r.status, data })))
        .then(({ ok, status, data }) => {
          if (ok && data.email && data.role) {
            setSignupPrefill({ email: data.email, role: data.role, signupToken });
            // Route caregivers to the full onboarding wizard, families to registration
            setAppState(data.role === 'caregiver' ? 'signup-onboarding' : 'register');
          } else if (status === 409 && data.alreadyRegistered) {
            // Already registered — redirect to login with helpful message
            setVerifyMessage({
              type: data.needsProfile ? 'info' : 'success',
              text: data.error || 'This email is already registered. Please sign in.',
            });
            setAppState('login');
          } else {
            setVerifyMessage({ type: 'error', text: data.error || 'Invalid signup link.' });
          }
        })
        .catch(() => {
          setVerifyMessage({ type: 'error', text: 'Failed to validate signup link.' });
        });
    }

    // Deep-link from push notification — open conversation or page
    const convId = params.get('conversation');
    if (convId) {
      window.__pendingConversation = convId;
      setCurrentPage('messages');
      window.history.replaceState({}, '', window.location.pathname);
    }
    const deepPage = params.get('page');
    if (deepPage) {
      setCurrentPage(deepPage);
      window.history.replaceState({}, '', window.location.pathname);
    }

    // Listen for push navigation messages from service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'PUSH_NAVIGATE') {
          const d = event.data.data || {};
          if (d.type === 'message' && d.conversationId) {
            window.__pendingConversation = d.conversationId;
            setCurrentPage('messages');
          } else if (d.type === 'care_request' || d.type === 'care_request_accepted') {
            setCurrentPage(role === 'caregiver' ? 'find-work' : 'schedule');
          }
        }
      });
    }
  }, []);

  const handleLogin = (user) => {
    // Clear stale active role from any previous session
    window.setActiveRole(null);
    setActiveRoleState(null);
    // Fetch full user data to get disclaimer status
    apiFetch('/api/auth/me').then(async r => {
      if (r?.ok) {
        const data = await r.json();
        if (data.user) {
          let userRoles;
          try { userRoles = data.user.roles ? (typeof data.user.roles === 'string' ? JSON.parse(data.user.roles) : data.user.roles) : [data.user.role]; }
          catch { userRoles = [data.user.role]; }
          setCurrentUser({
            id: data.user.id, email: data.user.email, role: data.user.role,
            roles: userRoles,
            firstName: data.user.first_name, lastName: data.user.last_name,
            profilePhoto: data.user.profile_photo || null,
            emailVerified: !!data.user.email_verified, isDemo: !!data.user.is_demo,
            isAdmin: !!data.user.is_admin,
          });
          // Sync activeRole to new user's primary role
          if (userRoles.length === 1) {
            window.setActiveRole(userRoles[0]);
            setActiveRoleState(userRoles[0]);
          }
          // Check if disclaimer needs to be accepted
          if (!data.user.disclaimer_accepted_at || data.user.disclaimer_version !== '1.0') {
            setShowDisclaimer(true);
          }
        }
      }
    }).catch(() => {});
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
    // Accept pending care team invite if one exists (use ref to avoid stale closure)
    const inviteTokenNow = pendingInviteRef.current;
    if (inviteTokenNow) {
      apiFetch('/api/care-teams/accept-invite', {
        method: 'POST',
        body: JSON.stringify({ token: inviteTokenNow }),
      }).then(async r => {
        if (r?.ok) {
          const data = await r.json();
          setVerifyMessage({ type: 'success', text: data.message || 'You\'ve joined the care team!' });
          if (data.careTeamId) { setSelectedCareTeamId(data.careTeamId); setCurrentPage('care-team'); }
        }
        // Silently ignore invite errors — user may have already joined, or invite was already used
      }).catch(() => {});
      setPendingInviteToken(null);
      pendingInviteRef.current = null;
      window.__originalSearch = ''; // Clear so auto-auth won't re-try
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setAuthToken(null);
    window.setActiveRole(null);
    setActiveRoleState(null);
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
    // Clear stale active role and sync to new user's role
    window.setActiveRole(null);
    setActiveRoleState(null);
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

  // Platform invite onboarding flow (caregiver, family, or care_for)
  if (appState === 'platform-onboarding' && platformInviteToken) {
    return <CaregiverOnboarding inviteToken={platformInviteToken} onComplete={(token) => {
      setPlatformInviteToken(null);
      // Restore user from the token
      if (token) {
        AUTH_TOKEN = token;
        localStorage.setItem('auth_token', token);
        if (typeof connectSocket === 'function') connectSocket(token);
        apiFetch('/api/auth/me').then(async r => {
          if (r?.ok) {
            const data = await r.json();
            if (data.user) {
              setCurrentUser({
                id: data.user.id, email: data.user.email, role: data.user.role,
                firstName: data.user.first_name, lastName: data.user.last_name,
                profilePhoto: data.user.profile_photo || null,
                emailVerified: !!data.user.email_verified, isDemo: false,
                isAdmin: !!data.user.is_admin,
              });
              // Check if disclaimer needs to be accepted
              if (!data.user.disclaimer_accepted_at || data.user.disclaimer_version !== '1.0') {
                setShowDisclaimer(true);
              }
              setAppState('app');
            }
          }
        }).catch(() => setAppState('splash'));
      } else {
        setAppState('splash');
      }
    }} />;
  }

  // Resume onboarding — logged-in caregiver with no profile
  if (appState === 'resume-onboarding' && currentUser) {
    return <CaregiverOnboarding resumeMode={true} resumeUser={{ firstName: currentUser.firstName, lastName: currentUser.lastName, email: currentUser.email }} onComplete={(token) => {
      // Token is null if cancelled, or the existing token on success
      if (token) {
        // Profile was created — reload dashboard
        setCurrentPage('dashboard');
        setAppState('app');
      } else {
        // Cancelled — go back to dashboard (will show the "no profile" state)
        setAppState('app');
      }
    }} />;
  }

  // Email-first signup → caregiver onboarding (same wizard, no platform invite needed)
  if (appState === 'signup-onboarding' && signupPrefill) {
    return <CaregiverOnboarding signupToken={signupPrefill.signupToken} signupEmail={signupPrefill.email} onComplete={(token) => {
      setSignupPrefill(null);
      if (token) {
        AUTH_TOKEN = token;
        localStorage.setItem('auth_token', token);
        if (typeof connectSocket === 'function') connectSocket(token);
        apiFetch('/api/auth/me').then(async r => {
          if (r?.ok) {
            const data = await r.json();
            if (data.user) {
              setCurrentUser({
                id: data.user.id, email: data.user.email, role: data.user.role,
                firstName: data.user.first_name, lastName: data.user.last_name,
                profilePhoto: data.user.profile_photo || null,
                emailVerified: !!data.user.email_verified, isDemo: false,
                isAdmin: !!data.user.is_admin,
              });
              // Check if disclaimer needs to be accepted
              if (!data.user.disclaimer_accepted_at || data.user.disclaimer_version !== '1.0') {
                setShowDisclaimer(true);
              }
              setAppState('app');
            }
          }
        }).catch(() => setAppState('splash'));
      } else {
        setAppState('splash');
      }
    }} />;
  }

  if (appState === 'invite') return <InviteLandingPage inviteInfo={inviteInfo} onNavigate={handleNavigate} />;
  if (appState === 'splash') return <SplashPage onNavigate={handleNavigate} inviteInfo={inviteInfo} />;
  if (appState === 'demo') return <DemoPickerPage onLogin={handleLogin} onNavigate={handleNavigate} />;
  if (appState === 'login') return <LoginPage onLogin={handleLogin} onNavigate={handleNavigate} banner={verifyMessage} onDismissBanner={() => setVerifyMessage(null)} inviteInfo={inviteInfo} />;
  if (appState === 'register') return <RegisterPage onLogin={handleLogin} onNavigate={handleNavigate} prefilledEmail={signupPrefill?.email || inviteInfo?.email} prefilledRole={signupPrefill?.role} signupToken={signupPrefill?.signupToken} pendingInviteToken={pendingInviteToken} />;
  if (appState === 'forgot-password') return <ForgotPasswordPage onNavigate={handleNavigate} />;
  if (appState === 'reset-password') return <ResetPasswordPage token={resetToken} onNavigate={handleNavigate} />;

  const role = activeRole || currentUser?.role || 'family';

  // Role switcher handler
  const handleSwitchRole = (newRole) => {
    if (!currentUser?.roles?.includes(newRole)) return;
    setActiveRoleState(newRole);
    window.setActiveRole(newRole);
    setCurrentPage('dashboard');
    setSidebarOpen(false);
  };

  // Role-based navigation items
  const getNavItems = () => {
    if (role === 'caregiver') {
      return [
        { id: 'dashboard', icon: '🤝', label: 'My Dashboard' },
        { id: 'find-work', icon: '🔍', label: 'Find Work' },
        { id: 'financials', icon: '💰', label: 'Financials' },
        { id: 'messages', icon: '💬', label: 'Messages' },
        { id: 'help', icon: '❓', label: 'Help' },
        { id: 'account', icon: '👤', label: 'My Account' },
      ];
    }
    if (role === 'care_for') {
      return [
        { id: 'dashboard', icon: '🏠', label: 'My Home' },
        { id: 'messages', icon: '💬', label: 'Messages' },
        { id: 'help', icon: '❓', label: 'Help' },
        { id: 'account', icon: '👤', label: 'My Account' },
      ];
    }
    // family (default)
    const familyNav = [
      { id: 'dashboard', icon: '🏠', label: 'Dashboard' },
      { id: 'care-profile', icon: '🌷', label: 'Care Profile' },
      { id: 'care-team', icon: '👪', label: 'Care Team' },
      { id: 'schedule', icon: '📅', label: 'Schedule' },
      { id: 'caregivers', icon: '🤝', label: 'Caregivers' },
      { id: 'activity', icon: '📢', label: 'Activity Feed' },
      { id: 'recipients', icon: '👥', label: 'Recipients' },
      { id: 'messages', icon: '💬', label: 'Messages' },
      { id: 'payments', icon: '💳', label: 'Payments' },
      { id: 'help', icon: '❓', label: 'Help' },
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
    // key includes currentUser.id so demo account switches force full remount (fresh data fetch)
    const pageKey = currentPage + '-' + (currentUser?.id || '');
    if (currentPage === 'dashboard') {
      if (role === 'caregiver') return <CaretakerHub key={pageKey} onNeedsOnboarding={() => setAppState('resume-onboarding')} />;
      if (role === 'care_for') return <CaredForView key={pageKey} />;
      return <Dashboard key={pageKey} onNavigate={setCurrentPage} />;
    }
    if (currentPage === 'care-profile') return <CareProfile key={pageKey} />;
    if (currentPage === 'care-team') return <CareTeamPage key={pageKey} selectedTeamId={selectedCareTeamId} onNavigate={setCurrentPage} />;
    if (currentPage === 'find-work') return <FindWork key={pageKey} />;
    if (currentPage === 'schedule') return <Schedule key={pageKey} />;
    if (currentPage === 'caregivers') return <Caregivers key={pageKey} />;
    if (currentPage === 'analytics') return <Analytics key={pageKey} />;
    if (currentPage === 'activity') return <ActivityFeed key={pageKey} />;
    if (currentPage === 'recipients') return <CareRecipients key={pageKey} />;
    if (currentPage === 'messages') return <Messages key={pageKey} />;
    if (currentPage === 'account') return <MyAccount key={pageKey} setCurrentUser={setCurrentUser} />;
    if (currentPage === 'help') return <HelpPage key={pageKey} currentUser={currentUser} onNavigate={setCurrentPage} />;
    if (currentPage === 'financials') return <CaretakerHub key={pageKey} onNeedsOnboarding={() => setAppState('resume-onboarding')} initialTab="financials" />;
    if (currentPage === 'payments') return <FamilyPayments key={pageKey} />;
    if (currentPage === 'admin' && currentUser?.isAdmin) return <AdminPanel key={pageKey} />;
    return <Dashboard key={pageKey} onNavigate={setCurrentPage} />;
  };

  // Bottom nav items (max 5 for mobile)
  const getBottomNavItems = () => {
    if (role === 'caregiver') {
      return [
        { id: 'dashboard', icon: '🤝', label: 'Home' },
        { id: 'find-work', icon: '🔍', label: 'Find Work' },
        { id: 'financials', icon: '💰', label: 'Money' },
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
    const familyBottom = [
      { id: 'dashboard', icon: '🏠', label: 'Home' },
      { id: 'schedule', icon: '📅', label: 'Schedule' },
      { id: 'caregivers', icon: '🤝', label: 'Care' },
      { id: 'messages', icon: '💬', label: 'Messages' },
      { id: 'account', icon: '👤', label: 'More' },
    ];
    if (currentUser?.isAdmin) {
      familyBottom.push({ id: 'admin', icon: '🛡️', label: 'Admin' });
    }
    return familyBottom;
  };

  const isDemo = currentUser?.isDemo;

  const appContent = (
    <React.Fragment>
      {showDisclaimer && <DisclaimerModal onAccept={() => {
        setShowDisclaimer(false);
        setVerifyMessage({ type: 'success', text: 'Welcome to InPlace!' });
      }} />}
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-logo">
          <InPlaceIcon width={36} height={36} />
          <div className="sidebar-logo-text"><span className="logo-in">in</span><span className="logo-place">Place</span></div>
          {currentUser && (
            <div className="sidebar-avatar" style={{
              width: 32, height: 32, borderRadius: '50%', marginLeft: 'auto',
              background: currentUser.profilePhoto ? `url(${currentUser.profilePhoto}) center/cover` : '#e8724a',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontSize: 12, fontWeight: 600, flexShrink: 0, overflow: 'hidden',
            }}>
              {!currentUser.profilePhoto && (currentUser.firstName?.[0] || '?').toUpperCase()}
            </div>
          )}
          <button className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu">&times;</button>
        </div>
        {currentUser?.roles?.length > 1 ? (
          <div style={{ padding: '4px 12px 12px', display: 'flex', gap: '4px', background: 'rgba(0,0,0,0.15)', borderRadius: '8px', margin: '0 12px 8px' }}>
            {currentUser.roles.map(r => {
              const labels = { family: 'Family', caregiver: 'Caregiver', care_for: 'Care Recipient' };
              const icons = { family: '👪', caregiver: '💼', care_for: '🏠' };
              const isActive = r === role;
              return React.createElement('button', {
                key: r,
                onClick: () => handleSwitchRole(r),
                style: {
                  flex: 1, padding: '8px 6px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                  fontSize: '11px', fontWeight: isActive ? 700 : 500, textAlign: 'center',
                  background: isActive ? 'rgba(255,255,255,0.2)' : 'transparent',
                  color: isActive ? 'white' : 'rgba(255,255,255,0.5)',
                  transition: 'all 0.2s',
                },
              }, `${icons[r] || ''} ${labels[r] || r}`);
            })}
          </div>
        ) : (
          <div style={{ padding: '0 16px 12px', fontSize: '11px', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '1px' }}>
            {getRoleLabel()}
          </div>
        )}
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
          <div style={{ padding: '8px 16px 4px', fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>
            v{window.APP_VERSION || '?'}
          </div>
        </div>
      </aside>
      <main className="main-content">
        <button className="hamburger-btn" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
          <span></span><span></span><span></span>
        </button>
        {currentUser?.roles?.length > 1 && (
          <div className="role-switcher-bar" style={{
            display: 'flex', gap: '4px', padding: '6px 8px', marginBottom: '12px',
            background: '#f0f0f0', borderRadius: '10px', width: 'fit-content',
          }}>
            {currentUser.roles.map(r => {
              const labels = { family: 'Family', caregiver: 'Caregiver', care_for: 'Recipient' };
              const icons = { family: '👪', caregiver: '💼', care_for: '🏠' };
              const isActive = r === role;
              return React.createElement('button', {
                key: r,
                onClick: () => handleSwitchRole(r),
                style: {
                  padding: '6px 14px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                  fontSize: '13px', fontWeight: isActive ? 600 : 400,
                  background: isActive ? '#1b6b5a' : 'transparent',
                  color: isActive ? 'white' : '#666',
                  transition: 'all 0.2s',
                },
              }, `${icons[r] || ''} ${labels[r] || r}`);
            })}
          </div>
        )}
        {verifyMessage && (
          <div style={{
            padding: '12px 16px', marginBottom: '16px', borderRadius: '8px', fontSize: '14px', fontWeight: 500,
            background: verifyMessage.type === 'success' ? '#e0f2e9' : verifyMessage.type === 'info' ? '#e3f2fd' : '#fce4ec',
            color: verifyMessage.type === 'success' ? '#1b6b5a' : verifyMessage.type === 'info' ? '#1565c0' : '#c62828',
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
      <FeedbackButton currentPage={currentPage} userRole={currentUser?.role} currentUser={currentUser} />
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
