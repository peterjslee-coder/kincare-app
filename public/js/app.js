// ─── Safe-Area Polyfill (Capacitor WKWebView) ───
// env(safe-area-inset-*) returns 0 when contentInsetAdjustmentBehavior=never.
// Detect actual safe area and expose as globals + CSS custom properties.
window.__safeAreaTop = 0;
window.__safeAreaBottom = 0;
(function(){try{
  // Probe env() to see if it returns real values
  var d=document.createElement('div');
  d.style.cssText='position:absolute;visibility:hidden;padding-top:env(safe-area-inset-top,0px)';
  document.body.appendChild(d);
  var v=parseFloat(getComputedStyle(d).paddingTop)||0;
  document.body.removeChild(d);
  if(v>0){
    window.__safeAreaTop=v;
    var d2=document.createElement('div');
    d2.style.cssText='position:absolute;visibility:hidden;padding-bottom:env(safe-area-inset-bottom,0px)';
    document.body.appendChild(d2);
    window.__safeAreaBottom=parseFloat(getComputedStyle(d2).paddingBottom)||0;
    document.body.removeChild(d2);
  }else{
    // env() returned 0 — use device heuristic
    var h=Math.max(screen.height,screen.width),w=Math.min(screen.height,screen.width);
    if(h/w>2.0){
      window.__safeAreaTop=h>=852?59:47;
      window.__safeAreaBottom=34;
    }else if(h/w>1.7){
      window.__safeAreaTop=20;
      window.__safeAreaBottom=0;
    }
  }
  // Capacitor native iOS fallback: if detection still returned 0, hardcode it.
  // Every modern iPhone has a notch or Dynamic Island — 59px covers both safely.
  if(window.__safeAreaTop===0 && window.Capacitor && typeof window.Capacitor.isNativePlatform==='function' && window.Capacitor.isNativePlatform()){
    window.__safeAreaTop=59;
    window.__safeAreaBottom=34;
  }
  // Also set CSS vars (for any CSS that references them)
  document.documentElement.style.setProperty('--sat',window.__safeAreaTop+'px');
  document.documentElement.style.setProperty('--sab',window.__safeAreaBottom+'px');
}catch(e){console.warn('safe-area polyfill error',e)}})();

// ─── Deep Link Handler (Capacitor App Links → OAuth callback) ───
// When OAuth runs in a Chrome Custom Tab (Android), the final redirect to
// yourinplace.com?oauth_code=... triggers App Links, which brings the user
// back to the Capacitor app. This listener catches that URL and navigates
// the WebView so the existing LoginPage OAuth-exchange code kicks in.
(function() {
  try {
    if (!window.Capacitor?.isNativePlatform?.()) return;
    var AppPlugin = window.Capacitor?.Plugins?.App;
    if (!AppPlugin) return;
    AppPlugin.addListener('appUrlOpen', function(data) {
      console.log('[DeepLink] appUrlOpen:', data.url);
      try {
        var url = new URL(data.url);
        // Custom scheme: inplace://oauth?oauth_code=...
        // Sent by server after Google/Apple OAuth completes in Chrome Custom Tab
        var oauthCode = url.searchParams.get('oauth_code');
        var oauthSignup = url.searchParams.get('oauth_signup');
        var oauthError = url.searchParams.get('oauth_error');
        if (oauthCode || oauthSignup || oauthError) {
          // Close the Chrome Custom Tab
          if (window.Capacitor?.Plugins?.Browser?.close) {
            window.Capacitor.Plugins.Browser.close();
          }
          // Navigate WebView so existing LoginPage OAuth exchange code runs
          var params = oauthCode ? 'oauth_code=' + oauthCode
            : oauthSignup ? 'oauth_signup=' + oauthSignup
            : 'oauth_error=' + oauthError;
          window.location.href = '/?' + params;
        }
      } catch (e) {
        console.error('[DeepLink] Error handling appUrlOpen:', e);
      }
    });
  } catch (e) { console.warn('[DeepLink] init error', e); }
})();

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
    // Check if already installed or running in native Capacitor shell
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone || window.Capacitor) {
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
            <h3 style={{ margin: '0 0 4px', fontSize: 18, color: 'var(--role-color)' }}>Install InPlace</h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-tertiary)' }}>Add to your home screen for the best experience</p>

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

// ─── Offline Indicator + Sync Badge ───
const OfflineIndicator = window.OfflineIndicator = () => {
  const [offline, setOffline] = useState(!navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => {
      setOffline(false);
      // Auto-sync is handled by offlineQueue.js online listener
    };
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);

    // Listen for pending count changes from OfflineQueue
    let unsub;
    if (window.OfflineQueue) {
      window.OfflineQueue.getPendingCount().then(setPendingCount).catch(() => {});
      unsub = window.OfflineQueue.onPendingChange(setPendingCount);
    }

    // Listen for SW sync trigger
    const handleSWMessage = (event) => {
      if (event.data?.type === 'OFFLINE_SYNC_TRIGGER' && window.OfflineQueue) {
        window.OfflineQueue.sync();
      }
    };
    navigator.serviceWorker?.addEventListener('message', handleSWMessage);

    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
      if (unsub) unsub();
      navigator.serviceWorker?.removeEventListener('message', handleSWMessage);
    };
  }, []);

  // Clear sync result toast after 4 seconds
  useEffect(() => {
    if (!syncResult) return;
    const t = setTimeout(() => setSyncResult(null), 4000);
    return () => clearTimeout(t);
  }, [syncResult]);

  const handleManualSync = async () => {
    if (!window.OfflineQueue || syncing) return;
    setSyncing(true);
    try {
      const result = await window.OfflineQueue.sync();
      setSyncResult(result);
    } catch {
      setSyncResult({ synced: 0, failed: 0, error: true });
    }
    setSyncing(false);
  };

  // Sync success toast
  if (syncResult && syncResult.synced > 0 && !offline) {
    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
        background: '#16a34a', color: '#fff', textAlign: 'center',
        padding: '8px 12px', fontSize: '13px', fontWeight: 600,
      }}>
        Synced {syncResult.synced} offline action{syncResult.synced !== 1 ? 's' : ''} successfully
      </div>
    );
  }

  // Pending sync badge (online but have queued items)
  if (!offline && pendingCount > 0) {
    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
        background: '#f59e0b', color: '#fff', textAlign: 'center',
        padding: '6px 12px', fontSize: '13px', fontWeight: 600,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
      }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: '20px', height: '20px', borderRadius: '50%', background: '#fff', color: '#f59e0b',
          fontSize: '11px', fontWeight: 700,
        }}>{pendingCount}</span>
        <span>offline action{pendingCount !== 1 ? 's' : ''} waiting to sync</span>
        <button onClick={handleManualSync} disabled={syncing} style={{
          marginLeft: '8px', padding: '2px 10px', borderRadius: '4px',
          background: '#fff', color: '#f59e0b', border: 'none', fontWeight: 700,
          fontSize: '12px', cursor: syncing ? 'wait' : 'pointer', opacity: syncing ? 0.7 : 1,
        }}>
          {syncing ? 'Syncing...' : 'Sync Now'}
        </button>
      </div>
    );
  }

  if (!offline) return null;

  // Offline banner — updated message when items are queued
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: 'var(--color-warning)', color: 'var(--text-on-primary)', textAlign: 'center',
      padding: '6px 12px', fontSize: '13px', fontWeight: 600,
    }}>
      {pendingCount > 0
        ? `You're offline — ${pendingCount} action${pendingCount !== 1 ? 's' : ''} saved, will sync when reconnected`
        : "You're offline — check-ins, check-outs & notes will be saved locally"
      }
    </div>
  );
};

// ─── Demo Mode Banner ───
// Persistent header bar when logged in as a demo account.
// Shows current persona, quick-switch buttons for other demo accounts, and Exit Demo button.
const DemoModeBanner = window.DemoModeBanner = ({ currentUser, onSwitchAccount, onExit }) => {
  const [switching, setSwitching] = useState(null);

  const demoAccounts = [
    { email: 'paul@inplace.care', label: 'Paul', icon: '👨‍👩‍👧', color: 'var(--role-color)' },
    { email: 'maria@inplace.care', label: 'Maria', icon: '🤝', color: 'var(--role-color)' },
    { email: 'barbara@inplace.care', label: 'Barbara', icon: '🌷', color: 'var(--accent-color)' },
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
    React.createElement('rect', { x: 0, y: 0, width: 20, height: 20, rx: 3, fill: 'var(--text-on-primary)', stroke: 'var(--border-light)', strokeWidth: 1 }),
    React.createElement('rect', { x: 0, y: 0, width: 20, height: 6, rx: 3, fill: 'var(--color-error)' }),
    React.createElement('text', { x: 10, y: 15.5, textAnchor: 'middle', fontSize: 9, fontWeight: 700, fill: 'var(--text-primary)' }, day)
  );
};

// Main App Component — role-aware routing & sidebar

// ─── AdminPanelLazy (v1.85, infra #5) ───
// AdminPanel + AdminFinancials + SafetyFlagsTab live in bundle-admin.js,
// injected as a classic script the first time an admin opens this page.
// Components are window-globals, so no module system is needed.
const AdminPanelLazy = (props) => {
  const [ready, setReady] = React.useState(() => !!window.AdminPanel);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    if (window.AdminPanel) return;
    const existing = document.getElementById('admin-bundle');
    const onload = () => { if (window.AdminPanel) setReady(true); else setFailed(true); };
    if (existing) {
      // Already injected (fast re-mount) — poll briefly for it to finish
      existing.addEventListener('load', onload);
      existing.addEventListener('error', () => setFailed(true));
      if (window.AdminPanel) setReady(true);
      return;
    }
    const s = document.createElement('script');
    s.id = 'admin-bundle';
    s.src = window.__ADMIN_BUNDLE_URL || '/js-compiled/bundle-admin.js';
    s.onload = onload;
    s.onerror = () => setFailed(true);
    document.head.appendChild(s);
  }, []);
  if (failed) return (
    <div style={{ padding: 32, textAlign: 'center' }}>
      <p>Couldn't load the admin tools — check your connection.</p>
      <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
    </div>
  );
  if (!ready) return <LoadingSpinner text="Loading admin tools..." />;
  const AP = window.AdminPanel;
  return <AP {...props} />;
};

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
    // OAuth callback: go straight to login so LoginPage can exchange the code
    if (p.get('oauth_code') || p.get('oauth_error')) return 'login';
    // OAuth signup: new user from Google/Apple → send to registration
    if (p.get('oauth_signup')) return 'register';
    // v1.88: referral links (?ref=CODE) and /register?role=caregiver land
    // straight on registration — RegisterPage reads ?ref itself to auto-claim.
    if (p.get('ref') || window.location.pathname === '/register') return 'register';
    return 'splash';
  });
  const [currentUser, setCurrentUser] = useState(null);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [pageNavCount, setPageNavCount] = useState(0);
  const [showRequestCareModal, setShowRequestCareModal] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [pendingLegalDocs, setPendingLegalDocs] = useState([]);
  // Dual-role: active role for users with multiple roles
  const [activeRole, setActiveRoleState] = useState(getActiveRole());
  // Unread message count for nav badge
  const [unreadMsgCount, setUnreadMsgCount] = useState(0);
  // Admin alert count for nav badge
  const [adminAlertCount, setAdminAlertCount] = useState(0);
  const [adminAlertDetails, setAdminAlertDetails] = useState(null);
  // In-app notification badge (v1.56.0)
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  // ─── Admin Impersonation (View As) state ───
  const [impersonating, setImpersonating] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('inplace_impersonation_user')); } catch { return null; }
  });

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
    window.__openRequestCareModal = (prefillDate, prefillCaregiver) => {
      if (prefillDate) window.__requestCareDate = prefillDate;
      if (prefillCaregiver) window.__requestCareCaregiver = prefillCaregiver;
      setShowRequestCareModal(true);
    };
    window.__navigateTo = (page) => setCurrentPage(page);
    window.__navHistory = navHistoryRef.current; // expose for feedback context

    // Push initial history entry so there's always something to go back to
    window.history.replaceState({ page: 'dashboard' }, '', window.location.pathname);

    const handlePopState = (e) => {
      // Skip if a modal is cleaning up its own history entry
      if (window.__skipPopstate) return;
      // If a modal pushed its own history state, let the modal handle it
      if (e.state?.modal) return;
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

  // ─── In-app notification count polling (v1.56.0) ───
  useEffect(() => {
    if (appState !== 'app' || !currentUser) return;
    const fetchNotifCount = async () => {
      try {
        const res = await apiFetch('/api/push/notifications?limit=1');
        if (res?.ok) {
          const data = await res.json();
          setUnreadNotifCount(data.unreadCount || 0);
        }
      } catch {}
    };
    fetchNotifCount();
    const interval = setInterval(fetchNotifCount, 30000);
    return () => clearInterval(interval);
  }, [appState, currentUser?.id]);

  // ─── Version heartbeat — notify (not auto-reload) when a new deploy lands ───
  const [updateAvailable, setUpdateAvailable] = useState(null);
  useEffect(() => {
    const checkVersion = async () => {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (data.version && data.version !== window.APP_VERSION) {
          console.log(`[version] New version available: ${data.version} (current: ${window.APP_VERSION})`);
          setUpdateAvailable(data.version);
        }
      } catch {}
    };
    // Check on tab focus (but only once per 5 min to avoid spam during active dev)
    let lastCheck = 0;
    const onVisChange = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastCheck > 5 * 60 * 1000) {
        lastCheck = Date.now();
        checkVersion();
      }
    };
    document.addEventListener('visibilitychange', onVisChange);
    // Also check every 10 minutes while tab is open
    const interval = setInterval(checkVersion, 10 * 60 * 1000);
    // Initial check after 30s (let the app finish loading first)
    const initTimeout = setTimeout(() => { lastCheck = Date.now(); checkVersion(); }, 30000);
    return () => {
      document.removeEventListener('visibilitychange', onVisChange);
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
      care_for:  { main: '#7b5ea7', light: '#f3e5f5', dark: '#4a2d7a' },
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
    // If we're in a pre-auth URL mode, skip auto-login entirely.
    // 'login' is included because it may be set by an OAuth redirect (oauth_code in URL).
    // Running auto-login concurrently with the OAuth exchange causes a race condition:
    // the stale session's 401 → refresh-fail → logout cascade fires and clears the
    // fresh cookies that the exchange just set, causing immediate re-logout.
    if (appState === 'reset-password' || appState === 'consent-response' || appState === 'login') return;

    // Auto-restore if user has an active session (persists until explicit logout or 7-day cookie expiry).
    // Uses localStorage so sessions survive browser/app restarts (important for native Capacitor app).
    // Invite links bypass this check so the accept-invite flow still works.
    const hasActiveSession = localStorage.getItem('inplace_session_active');
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
            // Apply user's saved theme now that we know they're authenticated
            if (typeof window.__applyUserTheme === 'function') window.__applyUserTheme();
            const userRoles = data.user.roles || [data.user.role];
            setCurrentUser({
              id: data.user.id, email: data.user.email, role: data.user.role,
              roles: userRoles,
              firstName: data.user.first_name, lastName: data.user.last_name,
              first_name: data.user.first_name, last_name: data.user.last_name,
              profilePhoto: data.user.profile_photo || null,
              emailVerified: !!data.user.email_verified, isDemo: !!data.user.is_demo,
              isAdmin: !!data.user.is_admin, is_tester: !!data.user.is_tester,
              account_approved: !!data.user.account_approved, companionAccess: !!data.user.companion_access,
              onboardingComplete: data.user.onboarding_complete,
              selfOnboardingComplete: data.user.selfOnboardingComplete,
              careRecipientId: data.user.careRecipientId,
            });
            // Sync active role: use saved preference if valid, else default to first role
            const saved = getActiveRole();
            const validRole = saved && userRoles.includes(saved) ? saved : userRoles[0];
            setActiveRoleState(validRole);
            window.setActiveRole(validRole);
            // Check if legal documents need to be accepted (skip if account not yet approved)
            if (data.user.account_approved) {
              if (data.user.pendingLegalDocs && data.user.pendingLegalDocs.length > 0) {
                setPendingLegalDocs(data.user.pendingLegalDocs);
                setShowDisclaimer(true);
              } else if (!data.user.disclaimer_accepted_at || data.user.disclaimer_version !== '1.0') {
                setShowDisclaimer(true);
              }
            }
            // Apply accessibility text size from user prefs
            try {
              const a11y = data.user.accessibility_prefs ? JSON.parse(data.user.accessibility_prefs) : {};
              if (a11y.textSize && typeof applyTextSize === 'function') applyTextSize(a11y.textSize);
            } catch {}
            // Session successfully restored — keep flag active for this tab
            localStorage.setItem('inplace_session_active', '1');
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

    // OAuth signup: new user from Google/Apple — fetch their info and send to registration
    const oauthSignupCode = params.get('oauth_signup');
    if (oauthSignupCode) {
      window.history.replaceState({}, '', window.location.pathname);
      fetch(`/api/oauth/pending-signup?code=${oauthSignupCode}`)
        .then(r => r.json().then(data => ({ ok: r.ok, data })))
        .then(({ ok, data }) => {
          if (ok && data.email) {
            setSignupPrefill({ email: data.email, firstName: data.firstName, lastName: data.lastName, oauthSignupCode: oauthSignupCode });
            setAppState('register');
          } else {
            setVerifyMessage({ type: 'error', text: 'Sign-up link expired. Please try again.' });
            setAppState('login');
          }
        })
        .catch(() => {
          setVerifyMessage({ type: 'error', text: 'Failed to load sign-up info.' });
          setAppState('login');
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
    // v1.97.0 — cold-start deep link: the service worker opens
    // /?page=...&careTeamId=...&focus=... when no app window exists yet
    const deepFocus = params.get('focus');
    if (deepFocus) window.__pendingFocus = deepFocus;
    const deepTeam = params.get('careTeamId');
    if (deepTeam) setSelectedCareTeamId(deepTeam);
    const deepPage = params.get('page');
    if (deepPage) {
      setCurrentPage(deepPage);
      window.history.replaceState({}, '', window.location.pathname);
    } else if (deepFocus || deepTeam) {
      window.history.replaceState({}, '', window.location.pathname);
    }

    // v1.97.0 — ONE router for every notification tap: web push (via the
    // service worker's PUSH_NAVIGATE), native iOS/Android push taps, and
    // clicks on the in-app notification list all land here. Payload
    // convention: {type, page?, focus?, careTeamId?, conversationId?, sessionId?}.
    // `page` picks the SPA page; `focus` scrolls to / opens the specific item
    // (e.g. "reimbursement:<id>" auto-opens the approve modal for approvers).
    window.__handlePushNavigate = (d) => {
      if (!d) return;
      if (d.focus) window.__pendingFocus = d.focus;
      if (d.careTeamId) setSelectedCareTeamId(d.careTeamId);
      const t = String(d.type || '');
      if ((t === 'message' || t === 'video_call') && d.conversationId) {
        window.__pendingConversation = d.conversationId;
        setCurrentPage('messages');
      } else if (t.startsWith('reimbursement')) {
        setCurrentPage('care-team');
      } else if (t === 'care_request' || t === 'care_request_accepted' || t === 'time_change' || t === 'time_change_accepted' || t === 'time_proposal' || t === 'proposal_accepted' || t === 'proposal_declined' || t === 'proposal_expired') {
        if (d.sessionId && !d.focus) window.__pendingFocus = `session:${d.sessionId}`;
        setCurrentPage(role === 'caregiver' ? 'find-work' : 'schedule');
      } else if (t === 'new_job') {
        setCurrentPage('find-work');
      } else if (t === 'check_in_reminder' || t === 'check_out_reminder' || t === 'caregiver_arriving' || t === 'caregiver_arriving_recipient' || t === 'session_in_progress' || t === 'session_complete') {
        if (d.sessionId && !d.focus) window.__pendingFocus = `session:${d.sessionId}`;
        setCurrentPage('dashboard');
      } else if (t === 'kindred_relay') {
        setCurrentPage('messages');
      } else if (t === 'admin_setting_change') {
        setCurrentPage('dashboard');
      } else if (d.page) {
        // Generic deep-link (e.g. team_note / observation_attention → care-profile)
        setCurrentPage(d.page);
      }
    };

    // Listen for messages from service worker
    if ('serviceWorker' in navigator) {
      // Respond to SW asking if user is viewing a specific conversation (for push suppression)
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'CHECK_ACTIVE_CONVERSATION') {
          const isViewing = window.__activeConversationId === event.data.conversationId;
          if (event.ports?.[0]) event.ports[0].postMessage({ viewing: isViewing });
        }
      });
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'PUSH_NAVIGATE') {
          window.__handlePushNavigate(event.data.data || {});
        }
      });
    }
  }, []);

  const handleLogin = (user) => {
    // Mark this tab as having an active session so refreshes auto-restore,
    // but closing the browser requires re-authentication.
    localStorage.setItem('inplace_session_active', '1');
    // Clear stale active role from any previous session
    window.setActiveRole(null);
    setActiveRoleState(null);
    // Fetch full user data to get disclaimer status
    apiFetch('/api/auth/me').then(async r => {
      if (r?.ok) {
        const data = await r.json();
        if (data.user) {
          // Apply user's saved theme now that we know they're authenticated
          if (typeof window.__applyUserTheme === 'function') window.__applyUserTheme();
          let userRoles;
          try { userRoles = data.user.roles ? (typeof data.user.roles === 'string' ? JSON.parse(data.user.roles) : data.user.roles) : [data.user.role]; }
          catch { userRoles = [data.user.role]; }
          setCurrentUser({
            id: data.user.id, email: data.user.email, role: data.user.role,
            roles: userRoles,
            firstName: data.user.first_name, lastName: data.user.last_name,
            first_name: data.user.first_name, last_name: data.user.last_name,
            profilePhoto: data.user.profile_photo || null,
            emailVerified: !!data.user.email_verified, isDemo: !!data.user.is_demo,
            isAdmin: !!data.user.is_admin, is_tester: !!data.user.is_tester,
            account_approved: !!data.user.account_approved, companionAccess: !!data.user.companion_access,
            onboardingComplete: data.user.onboarding_complete,
            selfOnboardingComplete: data.user.selfOnboardingComplete,
            careRecipientId: data.user.careRecipientId,
          });
          // Sync activeRole to new user's primary role
          if (userRoles.length === 1) {
            window.setActiveRole(userRoles[0]);
            setActiveRoleState(userRoles[0]);
          }
          // Check if legal documents need to be accepted (skip if not yet approved)
          if (data.user.account_approved) {
            if (data.user.pendingLegalDocs && data.user.pendingLegalDocs.length > 0) {
              setPendingLegalDocs(data.user.pendingLegalDocs);
              setShowDisclaimer(true);
            } else if (!data.user.disclaimer_accepted_at || data.user.disclaimer_version !== '1.0') {
              setShowDisclaimer(true);
            }
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
    // Start proactive auth token refresh (keeps user logged in across app restarts)
    if (typeof startProactiveRefresh === 'function') startProactiveRefresh();
    // Re-sync push subscription on login
    if (window.Capacitor?.isNativePlatform?.()) {
      // Native app: register FCM token with server on every login
      // (ensures token is always fresh — previous registration may have failed or token rotated)
      if (typeof subscribeNativePush === 'function') {
        subscribeNativePush().then(r => {
          if (r) localStorage.setItem('native_push_registered', '1');
        }).catch(() => {});
      }
      // Also set up token refresh listener
      if (typeof initNativeTokenRefresh === 'function') {
        initNativeTokenRefresh();
      }
    } else if (typeof subscribeToPush === 'function' && 'Notification' in window && Notification.permission === 'granted') {
      // Web: re-sync VAPID subscription if already granted
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

  const handleLogout = async () => {
    // Clear session-active flag so next page load requires re-authentication
    localStorage.removeItem('inplace_session_active');
    // Clear server-side session: revoke refresh token + clear httpOnly cookies
    // v1.74.4 — awaited (3s cap) so navigation can't cancel the cookie clear
    AUTH_TOKEN = null;
    try {
      await Promise.race([
        fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    } catch (e) {}
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
                isAdmin: !!data.user.is_admin, is_tester: !!data.user.is_tester, companionAccess: !!data.user.companion_access,
              });
              if (data.user.pendingLegalDocs && data.user.pendingLegalDocs.length > 0) {
                setPendingLegalDocs(data.user.pendingLegalDocs);
                setShowDisclaimer(true);
              } else if (!data.user.disclaimer_accepted_at || data.user.disclaimer_version !== '1.0') {
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
                isAdmin: !!data.user.is_admin, is_tester: !!data.user.is_tester, companionAccess: !!data.user.companion_access,
              });
              if (data.user.pendingLegalDocs && data.user.pendingLegalDocs.length > 0) {
                setPendingLegalDocs(data.user.pendingLegalDocs);
                setShowDisclaimer(true);
              } else if (!data.user.disclaimer_accepted_at || data.user.disclaimer_version !== '1.0') {
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
    'verifying-email': <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg-primary)', padding: 24 }}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 16, padding: '48px 40px', maxWidth: 420, width: '100%', textAlign: 'center', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>{'\u2709\uFE0F'}</div>
        <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Verifying your email...</h2>
        <p style={{ fontSize: 15, color: 'var(--text-secondary)', margin: 0 }}>Just a moment while we confirm your address.</p>
      </div>
    </div>,
    login: <LoginPage onLogin={handleLogin} onNavigate={handleNavigate} banner={verifyMessage} onDismissBanner={() => setVerifyMessage(null)} inviteInfo={inviteInfo} />,
    register: <RegisterPage onLogin={handleLogin} onNavigate={handleNavigate} prefilledEmail={signupPrefill?.email || inviteInfo?.email} prefilledRole={signupPrefill?.role || new URLSearchParams(window.location.search).get('role')} signupToken={signupPrefill?.signupToken} pendingInviteToken={pendingInviteToken} sandboxMode={!!window.__sandboxMode} oauthSignupCode={signupPrefill?.oauthSignupCode} prefilledFirstName={signupPrefill?.firstName} prefilledLastName={signupPrefill?.lastName} />,
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
    care_for:  { main: '#7b5ea7', light: '#f3e5f5', dark: '#4a2d7a' },
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

  // ─── Admin Impersonation: start viewing as another user ───
  const startImpersonation = async (userId) => {
    try {
      // Use the admin's real token for this request (not impersonation token)
      const headers = { 'Content-Type': 'application/json' };
      const adminToken = sessionStorage.getItem('inplace_admin_token_backup') || null;
      const token = adminToken || (window.getAuthToken ? window.getAuthToken() : null);
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const csrf = typeof getCsrfToken === 'function' ? getCsrfToken() : null;
      if (csrf) headers['X-CSRF-Token'] = csrf;

      // Step 1: Get passkey challenge
      const challengeRes = await fetch('/api/admin/impersonate/' + userId + '/challenge', { method: 'POST', headers, credentials: 'same-origin' });
      if (!challengeRes?.ok) { const err = await challengeRes.json().catch(() => ({})); alert(err.error || 'Failed to start passkey challenge'); return; }
      const challengeData = await challengeRes.json();
      const challengeKey = challengeData._challengeKey;

      let impersonateBody = { _challengeKey: challengeKey };
      if (!challengeData.noPasskey) {
        // Step 2: Passkey verification
        if (!window.SimpleWebAuthnBrowser?.startAuthentication) {
          alert('Passkey library not available. Try impersonating from desktop.');
          return;
        }
        try {
          const authResp = await window.SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: challengeData });
          impersonateBody = { ...authResp, _challengeKey: challengeKey };
        } catch (passkeyErr) {
          console.error('Passkey verification failed:', passkeyErr);
          alert(`Passkey verification failed: ${passkeyErr.message || passkeyErr}.\n\nTry from desktop, or register a passkey on this device.`);
          return;
        }
      }

      // Step 3: Impersonate with passkey proof
      const res = await fetch('/api/admin/impersonate/' + userId, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(impersonateBody), credentials: 'same-origin',
      });
      if (!res?.ok) { const err = await res.json().catch(() => ({})); alert(err.error || 'Failed to impersonate'); return; }
      const data = await res.json();
      // Back up admin's real token so we can restore later
      if (!sessionStorage.getItem('inplace_admin_token_backup')) {
        sessionStorage.setItem('inplace_admin_token_backup', window.getAuthToken ? window.getAuthToken() : '');
      }
      // Store impersonation state
      const impUser = { id: data.user.id, firstName: data.user.firstName || data.user.first_name, lastName: data.user.lastName || data.user.last_name, roles: data.user.roles };
      sessionStorage.setItem('inplace_impersonation_user', JSON.stringify(impUser));
      window.setImpersonationToken(data.token);
      setImpersonating(impUser);
      // Switch active role to the impersonated user's primary role
      const impRole = data.user.roles[0] || 'family';
      setActiveRoleState(impRole);
      window.setActiveRole(impRole);
      // Reload user context as the impersonated user
      const meRes = await apiFetch('/api/auth/me');
      if (meRes?.ok) {
        const meData = await meRes.json();
        if (meData.user) {
          const userRoles = meData.user.roles || [meData.user.role];
          setCurrentUser({
            id: meData.user.id, email: meData.user.email, role: meData.user.role, roles: userRoles,
            firstName: meData.user.first_name, lastName: meData.user.last_name,
            first_name: meData.user.first_name, last_name: meData.user.last_name,
            profilePhoto: meData.user.profile_photo || null,
            emailVerified: !!meData.user.email_verified, isDemo: !!meData.user.is_demo,
            isAdmin: false, is_tester: !!meData.user.is_tester,
            account_approved: !!meData.user.account_approved, companionAccess: !!meData.user.companion_access,
            onboardingComplete: meData.user.onboarding_complete,
            selfOnboardingComplete: meData.user.selfOnboardingComplete,
            careRecipientId: meData.user.careRecipientId,
          });
        }
      }
      setCurrentPage('dashboard');
    } catch (err) {
      console.error('Impersonation error:', err);
      alert(`Failed to start impersonation: ${err.message || err}`);
    }
  };
  // Expose to AdminPanel
  window.__startImpersonation = startImpersonation;

  // ─── Admin Impersonation: stop and return to admin view ───
  const stopImpersonation = async () => {
    // Clear all impersonation state
    window.setImpersonationToken(null);
    sessionStorage.removeItem('inplace_impersonation_user');
    const backupToken = sessionStorage.getItem('inplace_admin_token_backup');
    sessionStorage.removeItem('inplace_admin_token_backup');
    setImpersonating(null);
    // Reset active role back to family (admin's default)
    window.setActiveRole('family');
    setActiveRoleState('family');
    // Restore admin's auth cookie by calling refresh (cookie-based, ignores bearer token)
    try {
      const csrf = typeof getCsrfToken === 'function' ? getCsrfToken() : null;
      const refreshRes = await fetch('/api/auth/refresh', {
        method: 'POST', credentials: 'same-origin',
        headers: csrf ? { 'X-CSRF-Token': csrf } : {},
      });
      if (refreshRes.ok) {
        const data = await refreshRes.json();
        if (data.token) window.setAuthToken(data.token);
      }
    } catch (e) { /* if refresh fails, reload will use whatever cookie is left */ }
    window.location.reload();
  };

  // Role-based navigation items — main nav (top) and bottom nav (pinned to sidebar bottom)
  const getNavItems = () => {
    if (role === 'caregiver') {
      const cgOnboarded = currentUser?.onboardingComplete !== false;
      return [
        { id: 'dashboard', icon: '🏠', label: 'Home' },
        { id: 'find-work', icon: '🔍', label: 'Find Work', isAction: true, disabled: !cgOnboarded },
        { id: 'messages', icon: '💬', label: 'Messages' },
      ];
    }
    if (role === 'care_for') {
      return [
        { id: 'dashboard', icon: '🏠', label: 'My Home' },
        { id: 'messages', icon: '💬', label: 'Messages' },
        { id: 'kindred', icon: '💜', label: 'Kindred', isKindred: true },
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
        return <div key={pageKey} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', color: 'var(--text-secondary)' }}>Returning to setup...</div>;
      }
    } catch {}

    if (currentPage === 'dashboard') {
      if (role === 'caregiver') return <CaretakerHub key={pageKey} onNeedsOnboarding={() => setAppState('resume-onboarding')} />;
      if (role === 'care_for') {
        // Check if self-onboarding is complete
        const selfOnboardingDone = currentUser?.selfOnboardingComplete || currentUser?.self_onboarding_complete;
        if (!selfOnboardingDone) {
          return <SelfOnboardingWizard key={pageKey} user={currentUser} careRecipientId={currentUser?.careRecipientId} onComplete={() => {
                    apiFetch('/api/auth/me').then(async r => {
                      if (r?.ok) {
                        const data = await r.json();
                        if (data.user) {
                          const userRoles = data.user.roles || [data.user.role];
                          setCurrentUser({
                            id: data.user.id, email: data.user.email, role: data.user.role,
                            roles: userRoles,
                            firstName: data.user.first_name, lastName: data.user.last_name,
                            first_name: data.user.first_name, last_name: data.user.last_name,
                            profilePhoto: data.user.profile_photo || null,
                            emailVerified: !!data.user.email_verified, isDemo: !!data.user.is_demo,
                            isAdmin: !!data.user.is_admin, is_tester: !!data.user.is_tester,
                            account_approved: !!data.user.account_approved, companionAccess: !!data.user.companion_access,
                            onboardingComplete: data.user.onboarding_complete,
                            selfOnboardingComplete: data.user.selfOnboardingComplete,
                            careRecipientId: data.user.careRecipientId,
                          });
                        }
                      }
                    });
                  }} />;
        }
        return <CaredForView key={pageKey} />;
      }
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
    if (currentPage === 'admin' && currentUser?.isAdmin) return <AdminPanelLazy key={pageKey} currentUser={currentUser} />;
    return <Dashboard key={pageKey} onNavigate={setCurrentPage} />;
  };

  // Bottom nav items (max 5 for mobile)
  const getBottomNavItems = () => {
    if (role === 'caregiver') {
      const cgOnboarded = currentUser?.onboardingComplete !== false;
      const firstStepsRemain = !!window.__caregiverFirstStepsRemain;
      return [
        { id: 'dashboard', icon: '🏠', label: 'Home' },
        { id: 'find-work', icon: '🔍', label: 'Find Work', isAccent: true, disabled: !cgOnboarded || firstStepsRemain },
        { id: 'messages', icon: '💬', label: 'Messages' },
        { id: 'account', icon: '👤', label: 'Account' },
      ];
    }
    if (role === 'care_for') {
      return [
        { id: 'dashboard', icon: '🏠', label: 'Home' },
        { id: 'messages', icon: '💬', label: 'Messages' },
        { id: 'kindred', icon: '💜', label: 'Kindred', isKindred: true },
        { id: 'account', icon: '👤', label: 'Account' },
      ];
    }
    const familyBottom = [
      { id: 'dashboard', icon: '🏠', label: 'Home' },
      { id: 'care-profile', icon: '🌷', label: 'Loved One' },
      { id: 'caregivers', icon: '🤝', label: 'Caregivers' },
      { id: 'messages', icon: '💬', label: 'Messages' },
    ];
    familyBottom.push({ id: 'account', icon: '👤', label: 'Account' });
    // v1.80.0 — Admin left the bottom bar (Pete was the only one seeing 6 tabs);
    // it now lives in the feedback floater's fan-out. Desktop sidebar unchanged.
    return familyBottom;
  };

  const isDemo = currentUser?.isDemo;

  const appContent = (
    <React.Fragment>
      {showDisclaimer && <DisclaimerModal
        pendingDocs={pendingLegalDocs}
        onAccept={() => {
          setShowDisclaimer(false);
          setPendingLegalDocs([]);
          setVerifyMessage({ type: 'success', text: 'Welcome to InPlace!' });
        }}
      />}
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
              background: currentUser.profilePhoto ? `url(${currentUser.profilePhoto}) center/cover` : 'var(--accent-color)',
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
                  : item.id === '_launch_kindred'
                  ? () => { window.open(`/kindred?token=${encodeURIComponent(AUTH_TOKEN)}`, '_blank'); setSidebarOpen(false); }
                  : () => { handlePageChange(item.id); setSidebarOpen(false); };
                return (
                  <li key={item.id} className="nav-item">
                    <button onClick={actionClick} className="nav-link" style={item.disabled ? { background: 'var(--text-muted)', color: 'rgba(255,255,255,0.5)', fontWeight: 600, cursor: 'not-allowed', opacity: 0.5 } : item.id === '_launch_kindred' ? { background: 'var(--color-info)', color: 'var(--bg-card)', fontWeight: 600 } : { background: 'var(--accent-color)', color: 'var(--bg-card)', fontWeight: 600 }} title={item.disabled ? 'Complete your profile first' : item.id === '_launch_kindred' ? 'Open Kindred (new tab)' : ''}>
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
                        marginLeft: 'auto', background: 'var(--accent-color)', color: 'var(--text-on-primary)', borderRadius: 10,
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
                        marginLeft: 'auto', background: 'var(--color-error)', color: 'var(--bg-card)', borderRadius: 10,
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
      <main className="main-content" style={currentPage === 'messages' ? { padding: 0, overflow: 'hidden' } : window.__safeAreaTop ? { paddingTop: window.__safeAreaTop } : undefined}>
        {/* Impersonation banner — shown when admin is viewing as another user */}
        {impersonating && (
          <div style={{
            background: '#ff6f00', color: '#fff', padding: '8px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontSize: 13, fontWeight: 600, borderRadius: 8, margin: '0 0 8px',
            boxShadow: '0 2px 8px rgba(255,111,0,0.3)',
          }}>
            <span>Viewing as {impersonating.firstName} {impersonating.lastName} — Test Mode (GPS skipped, no payments)</span>
            <button onClick={stopImpersonation} style={{
              background: 'rgba(255,255,255,0.25)', border: 'none', color: '#fff',
              padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
              marginLeft: 12, flexShrink: 0,
            }}>Exit</button>
          </div>
        )}
        <div className="hamburger-wrapper" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <button className="hamburger-btn" onClick={() => setSidebarOpen(true)} aria-label="Open menu" style={{ position: 'relative', zIndex: 1 }}>
            <span></span><span></span><span></span>
          </button>
        </div>
        {verifyMessage && (
          <div style={{
            padding: '12px 16px', marginBottom: '16px', borderRadius: '8px', fontSize: '14px', fontWeight: 500,
            background: verifyMessage.type === 'success' ? 'var(--role-color-light)' : verifyMessage.type === 'info' ? 'var(--color-info-bg)' : 'var(--color-error-bg)',
            color: verifyMessage.type === 'success' ? 'var(--role-color)' : verifyMessage.type === 'info' ? 'var(--color-info)' : 'var(--color-error)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span>{verifyMessage.type === 'success' ? '✅ ' : '⚠️ '}{verifyMessage.text}</span>
            <button onClick={() => setVerifyMessage(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: 'inherit' }}>&times;</button>
          </div>
        )}
        {updateAvailable && (
          <div style={{
            padding: '8px 16px', marginBottom: '12px', borderRadius: '8px', fontSize: '13px',
            background: 'var(--color-info-bg)', color: 'var(--color-info)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span>v{updateAvailable} available</span>
            <button onClick={() => {
              if (window.caches) { caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => window.location.reload()); }
              else { window.location.reload(); }
            }} style={{ background: 'var(--color-info)', color: 'white', border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Update</button>
          </div>
        )}
        {currentUser && currentUser.emailVerified === false && !currentUser.isDemo && !verifyMessage && currentUser.account_approved && (
          <EmailVerificationBanner userId={currentUser.id} />
        )}
        {/* Account approval gate — show pending message for unapproved non-demo users */}
        {currentUser && !currentUser.account_approved && !currentUser.isDemo && !currentUser.is_admin ? (
          <div style={{ maxWidth: 500, margin: '60px auto', textAlign: 'center', padding: 32 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>{'\u23F3'}</div>
            <h2 style={{ margin: '0 0 12px', fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>Account Pending Approval</h2>
            <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 20px' }}>
              Thank you for signing up for InPlace! Your account is being reviewed by our team.
              You'll receive a notification once you've been approved to continue.
            </p>

            {/* Email verification info */}
            <div style={{ background: 'var(--color-info-bg)', border: '1px solid #90caf9', borderRadius: 12, padding: 16, margin: '0 0 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-info)', marginBottom: 4 }}>Email verification</div>
              <p style={{ fontSize: 13, color: 'var(--color-info)', margin: 0, lineHeight: 1.5 }}>
                Once your account is approved, you'll receive an email to verify your address and complete sign-up.
              </p>
            </div>

            <div style={{ background: 'var(--bg-highlight)', border: '1px solid #b2dfdb', borderRadius: 12, padding: 16, margin: '0 0 20px', textAlign: 'left' }}>
              <p style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.6, margin: '0 0 12px' }}>
                If you're reading this message and you haven't spoken to admin about creating an account, thank you for your interest and we'll be in touch.
              </p>
              <p style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.6, margin: 0 }}>
                If you have spoken to admin, your account creation will be approved shortly.
              </p>
            </div>

            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              If you have questions, contact us at support@yourinplace.com.
            </p>
            <button onClick={async () => { AUTH_TOKEN = null; try { await Promise.race([fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }), new Promise((resolve) => setTimeout(resolve, 3000))]); } catch (e) {} window.location.reload(); }}
              style={{ marginTop: 20, padding: '10px 24px', background: 'var(--bg-primary)', color: 'var(--text-secondary)', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, cursor: 'pointer' }}>
              Log Out
            </button>
          </div>
        ) : renderPage()}
      </main>
      {/* Bottom navigation bar — visible on mobile only (CSS hides on desktop) */}
      <nav className="bottom-nav" style={window.__safeAreaBottom ? { paddingBottom: window.__safeAreaBottom } : undefined}>
        {getBottomNavItems().map(item => (
          <button key={item.id} className={`bottom-nav-item ${currentPage === item.id ? 'active' : ''}`} onClick={item.disabled ? undefined : item.isKindred ? () => window.open(`/kindred?token=${encodeURIComponent(AUTH_TOKEN)}`, '_blank') : () => handlePageChange(item.id)} style={{ position: 'relative', ...(item.disabled ? { opacity: 0.35, cursor: 'not-allowed' } : {}), ...(item.isAccent && currentPage !== item.id && !item.disabled ? { color: 'var(--accent-color)' } : {}), ...(item.isKindred ? { color: 'var(--color-info)' } : {}) }}>
            <span className="bottom-nav-icon" style={item.isAccent && currentPage !== item.id ? { background: 'var(--bg-accent-light)', borderRadius: '50%', padding: '2px' } : undefined}>{item.icon}</span>
            {item.id === 'messages' && unreadMsgCount > 0 && (
              <span style={{
                position: 'absolute', top: 2, right: '50%', marginRight: -18,
                background: 'var(--accent-color)', color: 'var(--text-on-primary)', borderRadius: 10,
                padding: '1px 5px', fontSize: 9, fontWeight: 700,
                minWidth: 16, textAlign: 'center', lineHeight: '14px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }}>{unreadMsgCount > 99 ? '99+' : unreadMsgCount}</span>
            )}
            {item.id === 'admin' && adminAlertCount > 0 && (
              <span style={{
                position: 'absolute', top: 2, right: '50%', marginRight: -18,
                background: 'var(--color-error)', color: 'var(--bg-card)', borderRadius: 10,
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
      {(currentUser?.is_tester || currentUser?.isAdmin) && <FeedbackButton currentPage={currentPage} userRole={currentUser?.role} currentUser={currentUser} onNavigate={setCurrentPage} />}
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
