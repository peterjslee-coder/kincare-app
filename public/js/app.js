// ─── PWA Install Prompt ───
const PWAInstallBanner = window.PWAInstallBanner = () => {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  // Detect browser
  const ua = navigator.userAgent || '';
  const isSafari = /Safari/i.test(ua) && !/Chrome|CriOS|Chromium/i.test(ua);
  const isChrome = /Chrome|CriOS/i.test(ua) && !/Edge/i.test(ua);
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

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
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') setDeferredPrompt(null);
    } else {
      setShowInstructions(true);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem('pwa_dismissed', '1');
    setShowInstructions(false);
  };

  // Show for Safari/iOS even without deferredPrompt
  const canShow = deferredPrompt || (isSafari || isIOS);
  if (isStandalone || dismissed || !canShow) return null;

  return (
    <>
      <div className="pwa-install-banner">
        <img src="/icons/icon-192.png" alt="InPlace" className="pwa-install-banner-icon" />
        <div className="pwa-install-banner-text">
          <div className="pwa-install-banner-title">Add InPlace to Home Screen</div>
          <div className="pwa-install-banner-subtitle">Quick access to care coordination</div>
        </div>
        <button className="pwa-install-btn" onClick={handleInstall}>Install</button>
        <button className="pwa-install-dismiss" onClick={handleDismiss}>&times;</button>
      </div>

      {showInstructions && (
        <div className="pwa-instructions-overlay" onClick={() => setShowInstructions(false)}>
          <div className="pwa-instructions-modal" onClick={(e) => e.stopPropagation()}>
            <button className="pwa-instructions-close" onClick={() => setShowInstructions(false)}>&times;</button>
            <img src="/icons/icon-192.png" alt="InPlace" style={{ width: 56, height: 56, borderRadius: 12, marginBottom: 12 }} />
            <h3 style={{ margin: '0 0 4px', fontSize: 18, color: '#1b6b5a' }}>Install InPlace</h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: '#888' }}>Add to your home screen for the best experience</p>

            {(isSafari || isIOS) && (
              <div className="pwa-instructions-section">
                <div className="pwa-instructions-browser-label">
                  <span style={{ fontSize: 18 }}>&#127760;</span> Safari
                </div>
                <div className="pwa-instructions-steps">
                  <div className="pwa-instructions-step">
                    <span className="pwa-step-num">1</span>
                    <span>Tap the <strong>Share</strong> button <span style={{ fontSize: 16 }}>&#xFE0E;&#x2B06;</span> at the bottom of your screen</span>
                  </div>
                  <div className="pwa-instructions-step">
                    <span className="pwa-step-num">2</span>
                    <span>Scroll down and tap <strong>"Add to Home Screen"</strong></span>
                  </div>
                  <div className="pwa-instructions-step">
                    <span className="pwa-step-num">3</span>
                    <span>Tap <strong>"Add"</strong> in the top right</span>
                  </div>
                </div>
              </div>
            )}

            {(isChrome || !isSafari) && (
              <div className="pwa-instructions-section">
                <div className="pwa-instructions-browser-label">
                  <span style={{ fontSize: 18 }}>&#127760;</span> Chrome
                </div>
                <div className="pwa-instructions-steps">
                  <div className="pwa-instructions-step">
                    <span className="pwa-step-num">1</span>
                    <span>Tap the <strong>three dots</strong> <strong>&#8942;</strong> menu in the top right</span>
                  </div>
                  <div className="pwa-instructions-step">
                    <span className="pwa-step-num">2</span>
                    <span>Tap <strong>"Add to Home screen"</strong> or <strong>"Install app"</strong></span>
                  </div>
                  <div className="pwa-instructions-step">
                    <span className="pwa-step-num">3</span>
                    <span>Tap <strong>"Install"</strong> to confirm</span>
                  </div>
                </div>
              </div>
            )}

            <button className="pwa-instructions-got-it" onClick={() => setShowInstructions(false)}>Got it</button>
          </div>
        </div>
      )}
    </>
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
    { email: 'paul@inplace.care', label: 'Paul', icon: '👨‍👩‍👧', color: '#1b6b5a' },
    { email: 'maria@inplace.care', label: 'Maria', icon: '🤝', color: '#2e7d6d' },
    { email: 'barbara@inplace.care', label: 'Barbara', icon: '🌷', color: '#e8724a' },
  ];

  const handleSwitch = async (account) => {
    if (account.email === currentUser?.email) return;
    setSwitching(account.email);
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

// Dynamic calendar icon showing today's date number (red/white theme)
const _DayIcon = () => {
  const day = new Date().getDate();
  return React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 20 20', style: { display: 'inline-block', verticalAlign: 'middle' } },
    React.createElement('rect', { x: 0, y: 0, width: 20, height: 20, rx: 3, fill: '#fff', stroke: '#ccc', strokeWidth: 1 }),
    React.createElement('rect', { x: 0, y: 0, width: 20, height: 6, rx: 3, fill: '#d32f2f' }),
    React.createElement('text', { x: 10, y: 15.5, textAnchor: 'middle', fontSize: 9, fontWeight: 700, fill: '#333' }, day)
  );
};

// Main App Component — role-aware routing & sidebar
const App = () => {
  // Detect URL params at init — BEFORE any useEffect or auto-login can race
  // Capture verify token BEFORE any replaceState can strip the URL
  const [pendingVerifyToken] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    const vt = p.get('verify');
    if (vt) window.history.replaceState({}, '', window.location.pathname);
    return vt || null;
  });
  const [appState, setAppState] = useState(() => {
    if (pendingVerifyToken) return 'verifying-email';
    const p = new URLSearchParams(window.location.search);
    if (p.get('reset')) return 'reset-password';
    if (p.get('consent-response')) return 'consent-response';
    return 'splash';
  });
  const [currentUser, setCurrentUser] = useState(null);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [pageNavCount, setPageNavCount] = useState(0);
  const [showRequestCareModal, setShowRequestCareModal] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  // Dual-role: active role for users with multiple roles
  const [activeRole, setActiveRoleState] = useState(getActiveRole());
  // Unread message count for nav badge
  const [unreadMsgCount, setUnreadMsgCount] = useState(0);
  // Admin alert count for nav badge
  const [adminAlertCount, setAdminAlertCount] = useState(0);
  const [adminAlertDetails, setAdminAlertDetails] = useState(null);

  // ─── In-app navigation history (prevents PWA back-swipe from closing app) ───
  const navHistoryRef = useRef(['dashboard']);
  const popstateNavRef = useRef(false);

  // Push history state whenever currentPage changes (unless it's from popstate)
  useEffect(() => {
    if (appState !== 'app') return;
    const current = navHistoryRef.current;
    if (popstateNavRef.current) {
      popstateNavRef.current = false;
      return;
    }
    if (current[current.length - 1] !== currentPage) {
      current.push(currentPage);
      window.history.pushState({ page: currentPage }, '', window.location.pathname);
    }
  }, [currentPage, appState]);

  // Expose modal opener and navigation for child components
  useEffect(() => {
    window.__openRequestCareModal = (prefillDate) => {
      if (prefillDate) window.__requestCareDate = prefillDate;
      setShowRequestCareModal(true);
    };
    window.__navigateTo = (page) => setCurrentPage(page);
    window.__navHistory = navHistoryRef.current; // expose for feedback context

    // Push initial history entry so there's always something to go back to
    window.history.replaceState({ page: 'dashboard' }, '', window.location.pathname);

    const handlePopState = (e) => {
      if (navHistoryRef.current.length > 1) {
        navHistoryRef.current.pop();
        const prevPage = navHistoryRef.current[navHistoryRef.current.length - 1];
        popstateNavRef.current = true;
        setCurrentPage(prevPage);
      } else {
        // At root — push a dummy entry so next back doesn't close PWA
        window.history.pushState({ page: 'dashboard' }, '', window.location.pathname);
      }
    };
    window.addEventListener('popstate', handlePopState);

    return () => {
      delete window.__openRequestCareModal;
      delete window.__navigateTo;
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // ─── Swipe-back navigation ───
  // Swipe from left edge → history.back() (like mobile browser back gesture)
  useEffect(() => {
    let touchStartX = 0;
    let touchStartY = 0;
    let swiping = false;

    const onTouchStart = (e) => {
      const touch = e.touches[0];
      // Only trigger from left 30px edge
      if (touch.clientX < 30) {
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        swiping = true;
      }
    };

    const onTouchEnd = (e) => {
      if (!swiping) return;
      swiping = false;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - touchStartX;
      const dy = Math.abs(touch.clientY - touchStartY);
      // Require horizontal swipe > 80px and mostly horizontal (not vertical scroll)
      if (dx > 80 && dy < dx * 0.5) {
        window.history.back();
      }
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  // ─── Unread message count polling ───
  useEffect(() => {
    if (appState !== 'app' || !currentUser) return;
    const fetchUnread = async () => {
      try {
        const res = await apiFetch('/api/messages/conversations');
        if (res?.ok) {
          const data = await res.json();
          const total = (data.conversations || []).reduce((sum, c) => sum + (c.unreadCount || 0), 0);
          setUnreadMsgCount(total);
        }
      } catch {}
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, [appState, currentUser?.id]);

  // ─── Admin alert count polling (admin users only) ───
  useEffect(() => {
    if (appState !== 'app' || !currentUser?.isAdmin) return;
    const fetchAlerts = async () => {
      try {
        const res = await apiFetch('/api/admin/alerts');
        if (res?.ok) {
          const data = await res.json();
          setAdminAlertCount(data.total || 0);
          setAdminAlertDetails(data);
        }
      } catch {}
    };
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 60000); // refresh every 60s
    return () => clearInterval(interval);
  }, [appState, currentUser?.id, currentUser?.isAdmin]);

  // ─── Version heartbeat — auto-reload when a new deploy lands ───
  useEffect(() => {
    const checkVersion = async () => {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (data.version && data.version !== window.APP_VERSION) {
          // Guard: don't reload if we already tried recently (prevents infinite loops if HTML is cached)
          const lastReload = sessionStorage.getItem('_versionReloadAt');
          const now = Date.now();
          if (lastReload && (now - parseInt(lastReload, 10)) < 60000) {
            console.log(`[version] Mismatch (server=${data.version} local=${window.APP_VERSION}) but skipping — reloaded <60s ago`);
            return;
          }
          sessionStorage.setItem('_versionReloadAt', String(now));
          console.log(`[version] Server=${data.version} Local=${window.APP_VERSION} — reloading`);
          if (window.caches) {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
          }
          window.location.reload();
        }
      } catch {}
    };
    // Check on tab focus (user switches back to app)
    const onFocus = () => checkVersion();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') onFocus();
    });
    // Also check every 5 minutes while tab is open
    const interval = setInterval(checkVersion, 5 * 60 * 1000);
    // Initial check after 10s (let the app finish loading first)
    const initTimeout = setTimeout(checkVersion, 10000);
    return () => {
      clearInterval(interval);
      clearTimeout(initTimeout);
    };
  }, []);

  // Update unread count on real-time message events
  useEffect(() => {
    if (typeof onSocketEvent !== 'function') return;
    const cleanup = onSocketEvent('new_message', () => {
      // Bump count optimistically, then re-fetch
      setUnreadMsgCount(c => c + 1);
      apiFetch('/api/messages/conversations').then(async res => {
        if (res?.ok) {
          const data = await res.json();
          const total = (data.conversations || []).reduce((sum, c) => sum + (c.unreadCount || 0), 0);
          setUnreadMsgCount(total);
        }
      }).catch(() => {});
    });
    return cleanup;
  }, []);

  // ─── Account approved — refresh user data to unlock the app ───
  useEffect(() => {
    if (typeof onSocketEvent !== 'function') return;
    const cleanup = onSocketEvent('account_approved', () => {
      // Re-fetch user to pick up account_approved = true
      apiFetch('/api/auth/me').then(async res => {
        if (res?.ok) {
          const data = await res.json();
          setCurrentUser(prev => ({ ...prev, ...data.user, account_approved: true }));
        }
      }).catch(() => {});
    });
    return cleanup;
  }, []);

  // ─── Global incoming call notification (browser notification when not on Messages) ───
  useEffect(() => {
    if (typeof onSocketEvent !== 'function') return;
    const cleanup = onSocketEvent('call_incoming', (data) => {
      // If on Messages page, the Messages component handles the banner UI
      // But always fire browser notification if tab is hidden/unfocused
      if ('Notification' in window && Notification.permission === 'granted') {
        const typeLabel = data.callType === 'video' ? 'Video' : 'Voice';
        const n = new Notification(`Incoming ${typeLabel} Call`, {
          body: `${data.callerName || 'Someone'} is calling you on InPlace`,
          icon: '/icons/icon-192x192.png',
          tag: 'incoming-call-global',
          requireInteraction: true,
        });
        n.onclick = () => {
          window.focus();
          setCurrentPage('messages');
          n.close();
        };
        // Auto-close after 30s
        setTimeout(() => n.close(), 30000);
      }
      // If not on Messages page, navigate there
      if (currentPage !== 'messages') {
        setCurrentPage('messages');
      }
    });
    // Request notification permission on first load
    // Guard typeof check: some browsers (older Android WebView) have Notification
    // in window but without requestPermission as a callable function
    if ('Notification' in window && typeof Notification.requestPermission === 'function' && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    return cleanup;
  }, [currentPage]);

  // ─── Role-color CSS custom properties ───
  // Must be here (before any early returns) to satisfy Rules of Hooks
  useEffect(() => {
    const roleColors = {
      family:    { main: '#1b6b5a', light: '#e0f2e9', dark: '#0f4238' },
      caregiver: { main: '#2e5984', light: '#dce8f3', dark: '#1a3a5c' },
      care_for:  { main: '#7b5ea7', light: '#ede7f6', dark: '#4a2d7a' },
    };
    const rc = roleColors[activeRole] || roleColors.family;
    const root = document.documentElement;
    root.style.setProperty('--role-color', rc.main);
    root.style.setProperty('--role-color-light', rc.light);
    root.style.setProperty('--role-color-dark', rc.dark);
    window.ROLE_COLOR = rc.main;
    window.ROLE_COLOR_LIGHT = rc.light;
  }, [activeRole]);

  const [resetToken, setResetToken] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    const rt = p.get('reset');
    if (rt) window.history.replaceState({}, '', window.location.pathname);
    return rt || null;
  });
  const [consentResponseToken] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    const ct = p.get('consent-response');
    if (ct) window.history.replaceState({}, '', window.location.pathname);
    return ct || null;
  });
  const [verifyMessage, setVerifyMessage] = useState(null);

  // ─── Dedicated email verification useEffect (isolated from auto-login) ───
  useEffect(() => {
    if (!pendingVerifyToken) return;
    const loggedIn = !!AUTH_TOKEN;
    trackAuthEvent('email-verify', 'attempt', { loggedIn, source: 'verify-link' });
    fetch(API_BASE + `/api/auth/verify?token=${pendingVerifyToken}`)
      .then(r => r.json())
      .then(data => {
        if (data?.message) {
          trackAuthEvent('email-verify', 'success', { loggedIn });
          setVerifyMessage({ type: 'success', text: 'Email verified! Sign in to continue.' });
          if (loggedIn) {
            apiFetch('/api/auth/me').then(r2 => r2?.json()).then(meData => {
              if (meData?.user) setCurrentUser(prev => prev ? { ...prev, emailVerified: !!meData.user.email_verified } : prev);
            }).catch(() => {});
          } else {
            setAppState('login');
          }
        } else {
          trackAuthEvent('email-verify', 'error', { loggedIn, error: data?.error || 'unknown' });
          setVerifyMessage({ type: 'error', text: data?.error || 'Verification failed' });
          setAppState('login');
        }
      })
      .catch((err) => {
        trackAuthEvent('email-verify', 'error', { loggedIn, error: err?.message || 'network-error' });
        setVerifyMessage({ type: 'error', text: 'Verification failed. Please try again or contact support.' });
        setAppState('login');
      });
  }, []);

  const [pendingInviteToken, setPendingInviteToken] = useState(null);
  const pendingInviteRef = useRef(null); // Ref mirror — survives closures
  const [inviteInfo, setInviteInfo] = useState(null); // { email, role, teamName, recipientName, inviterName }
  const [acceptingInvite, setAcceptingInvite] = useState(false); // True while invite acceptance is in-flight
  const [platformInviteToken, setPlatformInviteToken] = useState(null);
  const [selectedCareTeamId, setSelectedCareTeamId] = useState(null);
  // Email-first signup: prefilled from signup intent token
  const [signupPrefill, setSignupPrefill] = useState(null); // { email, role, signupToken }

  useEffect(() => {
    // If we're in a pre-auth URL mode (reset-password, consent-response), skip auto-login
    if (appState === 'reset-password' || appState === 'consent-response') return;

    // Only auto-restore if this tab has an active session (set at login).
    // Closing the browser/tab clears sessionStorage, so the user must
    // re-authenticate on next visit instead of silently auto-logging in.
    // Invite links bypass this check so the accept-invite flow still works.
    const hasActiveSession = sessionStorage.getItem('inplace_session_active');
    const hasInviteToken = new URLSearchParams(window.location.search).get('invite')
      || new URLSearchParams(window.__originalSearch || '').get('invite')
      || localStorage.getItem('pendingInviteToken');
    if (!hasActiveSession && !hasInviteToken) return;

    // Restore session from httpOnly cookie (server reads cookie automatically)
    apiFetch('/api/auth/me').then(async r => {
        if (r?.ok) {
          const data = await r.json();
          // Server includes token for in-memory use (WebSocket auth)
          if (data.token) {
            AUTH_TOKEN = data.token;
            if (typeof connectSocket === 'function') connectSocket(data.token);
          }
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
              isAdmin: !!data.user.is_admin, is_tester: !!data.user.is_tester,
              account_approved: !!data.user.account_approved,
              onboardingComplete: data.user.onboarding_complete,
            });
            // Sync active role: use saved preference if valid, else default to first role
            const saved = getActiveRole();
            const validRole = saved && userRoles.includes(saved) ? saved : userRoles[0];
            setActiveRoleState(validRole);
            window.setActiveRole(validRole);
            // Check if disclaimer needs to be accepted (skip if account not yet approved)
            if (data.user.account_approved && (!data.user.disclaimer_accepted_at || data.user.disclaimer_version !== '1.0')) {
              setShowDisclaimer(true);
            }
            // Apply accessibility text size from user prefs
            try {
              const a11y = data.user.accessibility_prefs ? JSON.parse(data.user.accessibility_prefs) : {};
              if (a11y.textSize && typeof applyTextSize === 'function') applyTextSize(a11y.textSize);
            } catch {}
            // Session successfully restored — keep flag active for this tab
            sessionStorage.setItem('inplace_session_active', '1');
            setAppState('app');
            // If returning user has a pending invite token, accept it now
            // Check URL, __originalSearch, and localStorage (survives approval gate)
            const inviteParam = new URLSearchParams(window.location.search).get('invite')
              || new URLSearchParams(window.__originalSearch || '').get('invite')
              || localStorage.getItem('pendingInviteToken');
            if (inviteParam) {
              setAcceptingInvite(true);
              apiFetch('/api/care-teams/accept-invite', {
                method: 'POST',
                body: JSON.stringify({ token: inviteParam }),
              }).then(async r => {
                if (r?.ok) {
                  const d = await r.json();
                  setVerifyMessage({ type: 'success', text: d.message || "You've joined the care team!" });
                  if (d.careTeamId) { setSelectedCareTeamId(d.careTeamId); setCurrentPage('care-team'); }
                } else {
                  try {
                    const errData = await r.json();
                    setVerifyMessage({ type: 'error', text: errData.error || 'Could not accept this invite. It may have expired.' });
                  } catch {
                    setVerifyMessage({ type: 'error', text: 'Could not accept this invite. It may have expired.' });
                  }
                }
                // Clear on any response (success or permanent error)
                localStorage.removeItem('pendingInviteToken');
              }).catch(() => {
                setVerifyMessage({ type: 'error', text: 'Could not accept this invite. Please check your connection and try again.' });
                // Keep in localStorage on network errors so it retries next load
              }).finally(() => {
                setAcceptingInvite(false);
              });
              setPendingInviteToken(null);
              pendingInviteRef.current = null;
              setInviteInfo(null);
            }
          }
        }
      }).catch(() => {});
    const params = new URLSearchParams(window.location.search);
    // Preserve original search params before any replaceState calls strip them
    window.__originalSearch = window.location.search;

    // Email verification is handled by its own dedicated useEffect above

    // Check for care team invite token in URL or localStorage (survives approval gate)
    const inviteToken = params.get('invite') || localStorage.getItem('pendingInviteToken');
    if (params.get('invite')) localStorage.setItem('pendingInviteToken', params.get('invite'));
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
            if (!AUTH_TOKEN) {
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

    // Check for email-first signup confirmation token (legacy flow — route to unified register)
    const signupToken = params.get('signupToken');
    if (signupToken) {
      window.history.replaceState({}, '', window.location.pathname);
      fetch(`/api/auth/confirm-signup?token=${signupToken}`)
        .then(r => r.json().then(data => ({ ok: r.ok, status: r.status, data })))
        .then(({ ok, status, data }) => {
          if (ok && data.email && data.role) {
            setSignupPrefill({ email: data.email, role: data.role, signupToken });
            // All roles now go through unified RegisterPage
            setAppState('register');
          } else if (status === 409 && data.alreadyRegistered) {
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

    // Sandbox mode detection
    if (params.get('sandbox') === 'true') {
      window.__sandboxMode = true;
      setAppState('register');
    }

    // Stripe Connect return — redirect to caretaker financials tab
    const hash = window.location.hash;
    if (hash === '#payments-complete' || hash === '#payments-refresh') {
      setCurrentPage('financials');
      window.history.replaceState({}, '', window.location.pathname);
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
          } else if (d.type === 'new_job') {
            setCurrentPage('find-work');
          } else if (d.type === 'check_in_reminder' || d.type === 'check_out_reminder' || d.type === 'caregiver_arriving' || d.type === 'caregiver_arriving_recipient') {
            setCurrentPage('dashboard');
          }
        }
      });
    }
  }, []);

  const handleLogin = (user) => {
    // Mark this tab as having an active session so refreshes auto-restore,
    // but closing the browser requires re-authentication.
    sessionStorage.setItem('inplace_session_active', '1');
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
            isAdmin: !!data.user.is_admin, is_tester: !!data.user.is_tester,
            account_approved: !!data.user.account_approved,
            onboardingComplete: data.user.onboarding_complete,
          });
          // Sync activeRole to new user's primary role
          if (userRoles.length === 1) {
            window.setActiveRole(userRoles[0]);
            setActiveRoleState(userRoles[0]);
          }
          // Check if disclaimer needs to be accepted (skip if not yet approved)
          if (data.user.account_approved && (!data.user.disclaimer_accepted_at || data.user.disclaimer_version !== '1.0')) {
            setShowDisclaimer(true);
          }
          // Apply accessibility text size
          try {
            const a11y = data.user.accessibility_prefs ? JSON.parse(data.user.accessibility_prefs) : {};
            if (a11y.textSize && typeof applyTextSize === 'function') applyTextSize(a11y.textSize);
          } catch {}
        }
      }
    }).catch(() => {});
    setCurrentPage('dashboard');
    setAppState('app');
    // Re-sync push subscription if already granted (doesn't prompt — needs user gesture for new)
    if (typeof subscribeToPush === 'function' && 'Notification' in window && Notification.permission === 'granted') {
      subscribeToPush().catch(() => {});
    }
    // Start periodic push health check (every 30 min) to keep subscriptions fresh
    if (typeof checkPushHealth === 'function') {
      // Clear any existing timer (handles re-login without refresh)
      if (window._pushHealthTimer) clearInterval(window._pushHealthTimer);
      window._pushHealthTimer = setInterval(() => checkPushHealth().catch(() => {}), 30 * 60 * 1000);
    }
    // Connect WebSocket for real-time updates
    if (AUTH_TOKEN && typeof connectSocket === 'function') {
      connectSocket(AUTH_TOKEN);
    }
    // Accept pending care team invite if one exists (use ref to avoid stale closure)
    const inviteTokenNow = pendingInviteRef.current || localStorage.getItem('pendingInviteToken');
    if (inviteTokenNow) {
      setAcceptingInvite(true);
      apiFetch('/api/care-teams/accept-invite', {
        method: 'POST',
        body: JSON.stringify({ token: inviteTokenNow }),
      }).then(async r => {
        if (r?.ok) {
          const data = await r.json();
          setVerifyMessage({ type: 'success', text: data.message || 'You\'ve joined the care team!' });
          if (data.careTeamId) { setSelectedCareTeamId(data.careTeamId); setCurrentPage('care-team'); }
          // Clear invite token on success
          localStorage.removeItem('pendingInviteToken');
        } else {
          // Show error to user — expired token, wrong email, etc.
          try {
            const errData = await r.json();
            setVerifyMessage({ type: 'error', text: errData.error || 'Could not accept this invite. It may have expired.' });
          } catch {
            setVerifyMessage({ type: 'error', text: 'Could not accept this invite. It may have expired.' });
          }
          // Clear on permanent failure (don't retry bad tokens forever)
          localStorage.removeItem('pendingInviteToken');
        }
      }).catch(() => {
        setVerifyMessage({ type: 'error', text: 'Could not accept this invite. Please check your connection and try again.' });
        // Keep in localStorage on network errors so it retries next load
      }).finally(() => {
        setAcceptingInvite(false);
      });
      setPendingInviteToken(null);
      pendingInviteRef.current = null;
      window.__originalSearch = ''; // Clear so auto-auth won't re-try
    }
  };

  const handleLogout = () => {
    // Clear session-active flag so next page load requires re-authentication
    sessionStorage.removeItem('inplace_session_active');
    // Clear server-side session: revoke refresh token + clear httpOnly cookies
    AUTH_TOKEN = null;
    fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    // Clear client state
    setCurrentUser(null);
    setAuthToken(null);
    window.setActiveRole(null);
    setActiveRoleState(null);
    setCurrentPage('dashboard');
    setAppState('splash');
    // Clear any pending invite token
    localStorage.removeItem('pendingInviteToken');
    // Reset text size to default
    if (typeof applyTextSize === 'function') applyTextSize('default');
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
    // Normalize user object to match expected camelCase shape
    // (API returns snake_case: is_demo, first_name, etc.)
    const roles = Array.isArray(user.roles) ? user.roles : [user.role];
    const primaryRole = roles[0];
    setCurrentUser({
      id: user.id, email: user.email, role: user.role,
      roles,
      firstName: user.first_name || user.firstName,
      lastName: user.last_name || user.lastName,
      profilePhoto: user.profile_photo || user.profilePhoto || null,
      emailVerified: true, isDemo: true,
      isAdmin: false, is_tester: false,
      account_approved: true,
      onboardingComplete: true,
    });
    // Sync active role to new demo user's primary role
    setActiveRoleState(primaryRole);
    window.setActiveRole(primaryRole);
    setCurrentPage('dashboard');
  };

  const handleNavigate = (page) => {
    setAppState(page);
  };

  const handlePageChange = (page) => {
    setCurrentPage(page);
    setPageNavCount(c => c + 1);
    setSidebarOpen(false);
    // Clear unread badge when opening messages
    if (page === 'messages') setUnreadMsgCount(0);
    // Clear admin badge when opening admin — save current counts as "seen"
    if (page === 'admin' && adminAlertCount > 0 && adminAlertDetails?._raw) {
      setAdminAlertCount(0);
      apiFetch('/api/admin/alerts/dismiss-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot: adminAlertDetails._raw }),
      }).catch(() => {});
    }
  };

  // Platform invite onboarding flow (caregiver, family, or care_for)
  if (appState === 'platform-onboarding' && platformInviteToken) {
    return <CaregiverOnboarding inviteToken={platformInviteToken} onComplete={(token) => {
      setPlatformInviteToken(null);
      // Restore user from the token
      if (token) {
        AUTH_TOKEN = token;
        // Token stored in httpOnly cookie by server; keep in-memory for WebSocket
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
                isAdmin: !!data.user.is_admin, is_tester: !!data.user.is_tester,
              });
              // Check if disclaimer needs to be accepted
              if (!data.user.disclaimer_accepted_at || data.user.disclaimer_version !== '1.0') {
                setShowDisclaimer(true);
              }
              try { const a11y = data.user.accessibility_prefs ? JSON.parse(data.user.accessibility_prefs) : {}; if (a11y.textSize && typeof applyTextSize === 'function') applyTextSize(a11y.textSize); } catch {}
              // Post-onboarding: send caregiver to dashboard where First Steps guides them
              window.__postOnboarding = true;
              setCurrentPage('dashboard');
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
        // Profile was created — send to dashboard where First Steps guides them
        window.__postOnboarding = true;
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
        // Token stored in httpOnly cookie by server; keep in-memory for WebSocket
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
                isAdmin: !!data.user.is_admin, is_tester: !!data.user.is_tester,
              });
              // Check if disclaimer needs to be accepted
              if (!data.user.disclaimer_accepted_at || data.user.disclaimer_version !== '1.0') {
                setShowDisclaimer(true);
              }
              try { const a11y = data.user.accessibility_prefs ? JSON.parse(data.user.accessibility_prefs) : {}; if (a11y.textSize && typeof applyTextSize === 'function') applyTextSize(a11y.textSize); } catch {}
              // Post-onboarding: send caregiver to dashboard where First Steps guides them
              window.__postOnboarding = true;
              setCurrentPage('dashboard');
              setAppState('app');
            }
          }
        }).catch(() => setAppState('splash'));
      } else {
        setAppState('splash');
      }
    }} />;
  }

  // Pre-auth pages — wrap with FeedbackButton so testers can leave feedback before logging in
  const preAuthPages = {
    invite: <InviteLandingPage inviteInfo={inviteInfo} onNavigate={handleNavigate} />,
    splash: <SplashPage onNavigate={handleNavigate} inviteInfo={inviteInfo} />,
    demo: <DemoPickerPage onLogin={handleLogin} onNavigate={handleNavigate} />,
    'verifying-email': <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f5f5f5', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: '48px 40px', maxWidth: 420, width: '100%', textAlign: 'center', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>{'\u2709\uFE0F'}</div>
        <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700, color: '#333' }}>Verifying your email...</h2>
        <p style={{ fontSize: 15, color: '#666', margin: 0 }}>Just a moment while we confirm your address.</p>
      </div>
    </div>,
    login: <LoginPage onLogin={handleLogin} onNavigate={handleNavigate} banner={verifyMessage} onDismissBanner={() => setVerifyMessage(null)} inviteInfo={inviteInfo} />,
    register: <RegisterPage onLogin={handleLogin} onNavigate={handleNavigate} prefilledEmail={signupPrefill?.email || inviteInfo?.email} prefilledRole={signupPrefill?.role} signupToken={signupPrefill?.signupToken} pendingInviteToken={pendingInviteToken} sandboxMode={!!window.__sandboxMode} />,
    'forgot-password': <ForgotPasswordPage onNavigate={handleNavigate} />,
    'reset-password': <ResetPasswordPage token={resetToken} onNavigate={handleNavigate} />,
    'consent-response': <ConsentResponsePage token={consentResponseToken} />,
  };
  if (preAuthPages[appState]) {
    return <>
      {preAuthPages[appState]}
    </>;
  }

  const role = activeRole || currentUser?.role || 'family';

  // ─── Role-specific color theming ───
  // Changes sidebar active color, role switcher accent, and other themed elements per role
  const roleColors = {
    family:    { main: '#1b6b5a', light: '#e0f2e9', dark: '#0f4238' },
    caregiver: { main: '#2e5984', light: '#dce8f3', dark: '#1a3a5c' },
    care_for:  { main: '#7b5ea7', light: '#ede7f6', dark: '#4a2d7a' },
  };
  const currentRoleColor = roleColors[role] || roleColors.family;

  // Role switcher handler
  const handleSwitchRole = (newRole) => {
    if (!currentUser?.roles?.includes(newRole)) return;
    setActiveRoleState(newRole);
    window.setActiveRole(newRole);
    setCurrentPage('dashboard');
    setSidebarOpen(false);
  };

  // Role-based navigation items — main nav (top) and bottom nav (pinned to sidebar bottom)
  const getNavItems = () => {
    if (role === 'caregiver') {
      const cgOnboarded = currentUser?.onboardingComplete !== false;
      return [
        { id: 'dashboard', icon: '🏠', label: 'Home' },
        { id: 'find-work', icon: '🔍', label: 'Find Work', isAction: true, disabled: !cgOnboarded },
        { id: 'messages', icon: '💬', label: 'Messages', disabled: !cgOnboarded },
      ];
    }
    if (role === 'care_for') {
      return [
        { id: 'dashboard', icon: '🏠', label: 'My Home' },
        { id: 'messages', icon: '💬', label: 'Messages' },
      ];
    }
    // family (default)
    const familyNav = [
      { id: 'dashboard', icon: '🏠', label: 'Home' },
      { id: '_request_care', icon: '➕', label: 'Request Care', isAction: true },
      { id: 'care-profile', icon: '🌷', label: 'My Loved One', children: [
        { id: 'care-team', icon: '👪', label: 'Care Team' },
        { id: 'caregivers', icon: '🤝', label: 'Caregivers' },
      ]},
      { id: 'activity', icon: '📢', label: 'Activity Feed' },
      { id: 'messages', icon: '💬', label: 'Messages' },
    ];
    if (currentUser?.isAdmin) {
      familyNav.push({ id: 'admin', icon: '🛡️', label: 'Admin' });
    }
    return familyNav;
  };

  // Bottom sidebar items — Help + Account pinned at bottom for all roles
  const getBottomSidebarItems = () => [
    { id: 'help', icon: '❓', label: 'Help' },
    { id: 'account', icon: '👤', label: 'My Account' },
  ];

  // Role label for sidebar header
  const getRoleLabel = () => {
    if (role === 'caregiver') return 'Caregiver';
    if (role === 'care_for') return 'Care Recipient';
    return 'Care Team';
  };

  const renderPage = () => {
    // Role-aware page rendering
    // key includes currentUser.id so demo account switches force full remount (fresh data fetch)
    const pageKey = currentPage + '-' + (currentUser?.id || '') + '-' + pageNavCount;

    // ─── Wizard guard: if setup wizard is in progress, redirect to it ───
    // Allow account & help so users can still manage settings or get help
    try {
      const wizardData = sessionStorage.getItem('inplace_wizard');
      if (wizardData && currentPage !== 'recipients' && currentPage !== 'account' && currentPage !== 'help' && currentPage !== 'care-team') {
        // Auto-redirect to wizard — use setTimeout to avoid render-during-render
        setTimeout(() => setCurrentPage('recipients'), 0);
        return <div key={pageKey} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', color: '#666' }}>Returning to setup...</div>;
      }
    } catch {}

    if (currentPage === 'dashboard') {
      if (role === 'caregiver') return <CaretakerHub key={pageKey} onNeedsOnboarding={() => setAppState('resume-onboarding')} />;
      if (role === 'care_for') return <CaredForView key={pageKey} />;
      return <Dashboard key={pageKey} onNavigate={setCurrentPage} acceptingInvite={acceptingInvite} />;
    }
    if (currentPage === 'care-profile') return <CareProfile key={pageKey} onNavigate={setCurrentPage} />;
    if (currentPage === 'care-team') return <CareTeamPage key={pageKey} selectedTeamId={selectedCareTeamId} onNavigate={setCurrentPage} />;
    if (currentPage === 'find-work') return <FindWork key={pageKey} />;
    if (currentPage === 'schedule') return <Schedule key={pageKey} />;
    if (currentPage === 'caregivers') return <Caregivers key={pageKey} />;
    if (currentPage === 'documents') { window.__accountTab = 'documents'; return <MyAccount key={pageKey} setCurrentUser={setCurrentUser} onNavigate={setCurrentPage} />; }
    if (currentPage === 'analytics') return <Analytics key={pageKey} />;
    if (currentPage === 'activity') return <ActivityFeed key={pageKey} />;
    if (currentPage === 'recipients') return <CareRecipients key={pageKey} />;
    if (currentPage === 'messages') return <Messages key={pageKey} />;
    if (currentPage === 'account') return <MyAccount key={pageKey} setCurrentUser={setCurrentUser} onNavigate={setCurrentPage} />;
    if (currentPage === 'help') return <HelpPage key={pageKey} currentUser={currentUser} onNavigate={setCurrentPage} />;
    if (currentPage === 'financials') return <MyAccount key={pageKey} setCurrentUser={setCurrentUser} onNavigate={setCurrentPage} />; {/* Financials moved to Account */}
    if (currentPage === 'payments') { window.__accountTab = 'payments'; return <MyAccount key={pageKey} setCurrentUser={setCurrentUser} onNavigate={setCurrentPage} />; }
    if (currentPage === 'admin' && currentUser?.isAdmin) return <AdminPanel key={pageKey} />;
    return <Dashboard key={pageKey} onNavigate={setCurrentPage} />;
  };

  // Bottom nav items (max 5 for mobile)
  const getBottomNavItems = () => {
    if (role === 'caregiver') {
      const cgOnboarded = currentUser?.onboardingComplete !== false;
      return [
        { id: 'dashboard', icon: '🏠', label: 'Home' },
        { id: 'find-work', icon: '🔍', label: 'Find Work', isAccent: true, disabled: !cgOnboarded },
        { id: 'messages', icon: '💬', label: 'Messages', disabled: !cgOnboarded },
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
      { id: 'care-profile', icon: '🌷', label: 'Loved One' },
      { id: 'messages', icon: '💬', label: 'Messages' },
      { id: 'account', icon: '👤', label: 'Account' },
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
          <button className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu">&times;</button>
        </div>
        {currentUser && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 16px 14px', gap: '6px' }}>
            <div className="sidebar-avatar" style={{
              width: 44, height: 44, borderRadius: '50%',
              background: currentUser.profilePhoto ? `url(${currentUser.profilePhoto}) center/cover` : '#e8724a',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontSize: 16, fontWeight: 600, flexShrink: 0, overflow: 'hidden',
            }}>
              {!currentUser.profilePhoto && (currentUser.firstName?.[0] || '?').toUpperCase()}
            </div>
            <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.9)', fontWeight: 600, textAlign: 'center', lineHeight: 1.3 }}>
              {currentUser.firstName || 'User'} {currentUser.lastName || ''}
            </div>
          </div>
        )}
        {(() => {
          const allRoles = ['family', 'caregiver', 'care_for'];
          const labels = { family: 'Family', caregiver: 'Caregiver', care_for: 'Recipient' };
          const icons = { family: '👪', caregiver: '💼', care_for: '🏠' };
          const userRoles = currentUser?.roles || [role];
          return (
            <div style={{ margin: '0 12px 4px' }}>
              {userRoles.length > 1 && (
                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '1px', padding: '0 4px 4px', textAlign: 'center' }}>
                  Viewing as
                </div>
              )}
              <div style={{ padding: '3px', display: 'flex', gap: '3px', background: 'rgba(0,0,0,0.15)', borderRadius: '6px' }}>
                {allRoles.map(r => {
                  const hasRole = userRoles.includes(r);
                  const isActive = r === role;
                  return React.createElement('button', {
                    key: r,
                    onClick: hasRole ? () => handleSwitchRole(r) : undefined,
                    style: {
                      flex: 1, padding: '8px 6px', borderRadius: '5px', border: 'none',
                      cursor: hasRole ? 'pointer' : 'default',
                      fontSize: '11px', fontWeight: isActive ? 700 : 500, textAlign: 'center',
                      background: isActive ? 'rgba(255,255,255,0.2)' : 'transparent',
                      color: isActive ? 'white' : hasRole ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.2)',
                      transition: 'all 0.2s',
                      opacity: hasRole ? 1 : 0.5,
                    },
                  }, `${icons[r] || ''} ${labels[r] || r}`);
                })}
              </div>
            </div>
          );
        })()}
        <nav style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <ul className="nav-menu">
            {getNavItems().map(item => {
              // Action button (orange highlight) — Request Care for family, Find Work for caregiver
              if (item.isAction) {
                const actionClick = item.disabled ? () => {} : item.id === '_request_care'
                  ? () => { handlePageChange('schedule'); setSidebarOpen(false); }
                  : () => { handlePageChange(item.id); setSidebarOpen(false); };
                return (
                  <li key={item.id} className="nav-item">
                    <button onClick={actionClick} className="nav-link" style={item.disabled ? { background: '#999', color: 'rgba(255,255,255,0.5)', fontWeight: 600, cursor: 'not-allowed', opacity: 0.5 } : { background: '#e8724a', color: '#fff', fontWeight: 600 }} title={item.disabled ? 'Complete your profile first' : ''}>
                      <span className="nav-icon">{item.icon}</span> {item.label} {item.disabled && '🔒'}
                    </button>
                  </li>
                );
              }
              // Nav item with children dropdown
              const isParentActive = currentPage === item.id || (item.children && item.children.some(c => currentPage === c.id));
              return (
                <li key={item.id} className="nav-item">
                  <button className={`nav-link ${currentPage === item.id ? 'active' : ''}`} onClick={item.disabled ? undefined : () => handlePageChange(item.id)} style={item.disabled ? { position: 'relative', opacity: 0.4, cursor: 'not-allowed' } : { position: 'relative' }} title={item.disabled ? 'Complete your profile first' : ''}>
                    <span className="nav-icon">{item.icon}</span>
                    {item.label} {item.disabled && '🔒'}
                    {item.id === 'messages' && unreadMsgCount > 0 && (
                      <span style={{
                        marginLeft: 'auto', background: '#e8724a', color: '#fff', borderRadius: 10,
                        padding: '1px 6px', fontSize: 10, fontWeight: 700,
                        minWidth: 18, textAlign: 'center', lineHeight: '16px',
                      }}>{unreadMsgCount > 99 ? '99+' : unreadMsgCount}</span>
                    )}
                    {item.id === 'admin' && adminAlertCount > 0 && (
                      <span title={adminAlertDetails ? [
                        adminAlertDetails.pendingUsers && `${adminAlertDetails.pendingUsers} pending users`,
                        adminAlertDetails.pausedCaregivers && `${adminAlertDetails.pausedCaregivers} paused caregivers`,
                        adminAlertDetails.pendingConsent && `${adminAlertDetails.pendingConsent} pending consent`,
                        adminAlertDetails.newFeedback && `${adminAlertDetails.newFeedback} new feedback`,
                        adminAlertDetails.checkrAlerts && `${adminAlertDetails.checkrAlerts} background check updates`,
                      ].filter(Boolean).join(', ') : ''} style={{
                        marginLeft: 'auto', background: '#dc2626', color: '#fff', borderRadius: 10,
                        padding: '1px 6px', fontSize: 10, fontWeight: 700,
                        minWidth: 18, textAlign: 'center', lineHeight: '16px',
                      }}>{adminAlertCount > 99 ? '99+' : adminAlertCount}</span>
                    )}
                  </button>
                  {item.children && isParentActive && (
                    <ul style={{ listStyle: 'none', margin: 0, padding: '2px 0 2px 20px' }}>
                      {item.children.map(child => (
                        <li key={child.id}>
                          <button className={`nav-link ${currentPage === child.id ? 'active' : ''}`} onClick={() => handlePageChange(child.id)} style={{ fontSize: 13, padding: '6px 12px' }}>
                            <span className="nav-icon" style={{ fontSize: 14 }}>{child.icon}</span>
                            {child.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          <div style={{ marginTop: 'auto', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            <ul className="nav-menu" style={{ marginBottom: 0 }}>
              {getBottomSidebarItems().map(item => (
                <li key={item.id} className="nav-item">
                  <button className={`nav-link ${currentPage === item.id ? 'active' : ''}`} onClick={() => handlePageChange(item.id)} style={{ position: 'relative' }}>
                    <span className="nav-icon">{item.icon}</span>
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
            <button className="nav-link" onClick={isDemo ? handleExitDemo : handleLogout}>
              <span className="nav-icon">🚪</span> {isDemo ? 'Exit Demo' : 'Logout'}
            </button>
            <div style={{ padding: '4px 16px 4px', fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>
              v{window.APP_VERSION || '?'}
            </div>
          </div>
        </nav>
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
            {['family', 'caregiver', 'care_for'].map(r => {
              const labels = { family: 'Family', caregiver: 'Caregiver', care_for: 'Recipient' };
              const icons = { family: '👪', caregiver: '💼', care_for: '🏠' };
              const btnColor = (roleColors[r] || roleColors.family).main;
              const isActive = r === role;
              const hasRole = (currentUser.roles || []).includes(r);
              return React.createElement('button', {
                key: r,
                onClick: hasRole ? () => handleSwitchRole(r) : undefined,
                style: {
                  padding: '5px 13px', borderRadius: '8px',
                  border: isActive ? '2px solid ' + btnColor : hasRole ? '2px solid #1b6b5a' : '2px solid transparent',
                  cursor: hasRole ? 'pointer' : 'default',
                  fontSize: '13px', fontWeight: isActive ? 600 : 400,
                  background: isActive ? btnColor : 'transparent',
                  color: isActive ? 'white' : hasRole ? '#666' : '#ccc',
                  transition: 'all 0.2s',
                  opacity: hasRole ? 1 : 0.5,
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
        {/* Account approval gate — show pending message for unapproved non-demo users */}
        {currentUser && !currentUser.account_approved && !currentUser.isDemo && !currentUser.is_admin ? (
          <div style={{ maxWidth: 500, margin: '60px auto', textAlign: 'center', padding: 32 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>{'\u23F3'}</div>
            <h2 style={{ margin: '0 0 12px', fontSize: 24, fontWeight: 700, color: '#333' }}>Account Pending Approval</h2>
            <p style={{ fontSize: 15, color: '#666', lineHeight: 1.6, margin: '0 0 20px' }}>
              Thank you for signing up for InPlace! Your account is being reviewed by our team.
              You'll receive a notification once you've been approved to continue.
            </p>
            <p style={{ fontSize: 13, color: '#999' }}>
              This usually takes less than 24 hours. If you have questions, contact us at support@yourinplace.com.
            </p>
            <button onClick={() => { AUTH_TOKEN = null; fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {}); window.location.reload(); }}
              style={{ marginTop: 20, padding: '10px 24px', background: '#f5f5f5', color: '#666', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, cursor: 'pointer' }}>
              Log Out
            </button>
          </div>
        ) : renderPage()}
      </main>
      {/* Bottom navigation bar — visible on mobile only (CSS hides on desktop) */}
      <nav className="bottom-nav">
        {getBottomNavItems().map(item => (
          <button key={item.id} className={`bottom-nav-item ${currentPage === item.id ? 'active' : ''}`} onClick={item.disabled ? undefined : () => handlePageChange(item.id)} style={{ position: 'relative', ...(item.disabled ? { opacity: 0.35, cursor: 'not-allowed' } : {}), ...(item.isAccent && currentPage !== item.id && !item.disabled ? { color: '#e8724a' } : {}) }}>
            <span className="bottom-nav-icon" style={item.isAccent && currentPage !== item.id ? { background: '#fff3ed', borderRadius: '50%', padding: '2px' } : undefined}>{item.icon}</span>
            {item.id === 'messages' && unreadMsgCount > 0 && (
              <span style={{
                position: 'absolute', top: 2, right: '50%', marginRight: -18,
                background: '#e8724a', color: '#fff', borderRadius: 10,
                padding: '1px 5px', fontSize: 9, fontWeight: 700,
                minWidth: 16, textAlign: 'center', lineHeight: '14px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }}>{unreadMsgCount > 99 ? '99+' : unreadMsgCount}</span>
            )}
            {item.id === 'admin' && adminAlertCount > 0 && (
              <span style={{
                position: 'absolute', top: 2, right: '50%', marginRight: -18,
                background: '#dc2626', color: '#fff', borderRadius: 10,
                padding: '1px 5px', fontSize: 9, fontWeight: 700,
                minWidth: 16, textAlign: 'center', lineHeight: '14px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }}>{adminAlertCount > 99 ? '99+' : adminAlertCount}</span>
            )}
            <span className="bottom-nav-label">{item.label}</span>
          </button>
        ))}
      </nav>
      {showRequestCareModal && <RequestCareModal onClose={() => setShowRequestCareModal(false)} />}
      {(currentUser?.is_tester || currentUser?.isAdmin) && <FeedbackButton currentPage={currentPage} userRole={currentUser?.role} currentUser={currentUser} />}
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
