// NotificationPrompt — In-app prompt to enable push notifications
// Shows a dismissible banner when notifications aren't enabled yet.
// Requires user click (gesture) to trigger browser permission prompt.

// Detect iOS/iPadOS and whether running as installed PWA
const _isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const _isStandalone = () => window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches || !!window.Capacitor;
const _isNativeApp = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

const NotificationPrompt = window.NotificationPrompt = ({ onSubscribed }) => {
  const [visible, setVisible] = useState(false);
  const [permState, setPermState] = useState('default'); // 'default' | 'granted' | 'denied'
  const [subscribing, setSubscribing] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [iosNotInstalled, setIosNotInstalled] = useState(false);

  useEffect(() => {
    // In native Capacitor app, push is handled by native plugin
    if (_isNativeApp()) {
      const nativeRegistered = localStorage.getItem('native_push_registered');
      if (nativeRegistered) {
        setPermState('granted');
        return; // Already registered
      }
      // Check if user previously dismissed
      const dismissed = localStorage.getItem('push_prompt_dismissed');
      if (dismissed) {
        const dismissedAt = parseInt(dismissed, 10);
        if (Date.now() - dismissedAt < 7 * 24 * 60 * 60 * 1000) return;
      }
      setPermState('default');
      setVisible(true);
      return;
    }

    // On iOS/iPadOS, push only works when installed as home screen app
    if (_isIOS() && !_isStandalone()) {
      setIosNotInstalled(true);
      // Still show prompt — but with install instructions
      const dismissed = localStorage.getItem('push_prompt_dismissed');
      if (dismissed) {
        const dismissedAt = parseInt(dismissed, 10);
        if (Date.now() - dismissedAt < 7 * 24 * 60 * 60 * 1000) return;
      }
      setVisible(true);
      return;
    }

    // Check if push is supported and permission state
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      return; // Push not supported on this browser
    }

    const perm = Notification.permission;
    setPermState(perm);

    if (perm === 'granted') {
      // Already granted — silently re-subscribe (handles VAPID key changes, expired subs)
      // subscribeToPush() detects key mismatches and re-subscribes automatically
      subscribeToPush().then(sub => {
        if (!sub) {
          // Subscription failed even though permission is granted — show prompt to retry
          console.warn('Push: permission granted but subscription failed — showing re-enable prompt');
          setVisible(true);
        }
      }).catch(() => {});
      return;
    }

    if (perm === 'denied') {
      return; // User blocked notifications — can't prompt again
    }

    // Permission is 'default' — check if user dismissed the prompt before
    const dismissed = localStorage.getItem('push_prompt_dismissed');
    if (dismissed) {
      // Show again after 7 days
      const dismissedAt = parseInt(dismissed, 10);
      if (Date.now() - dismissedAt < 7 * 24 * 60 * 60 * 1000) return;
    }

    // Show the prompt
    setVisible(true);
  }, []);

  const handleEnable = async () => {
    setSubscribing(true);
    try {
      // Native Capacitor app — use native push plugin
      if (_isNativeApp()) {
        const result = await subscribeNativePush();
        if (result) {
          setPermState('granted');
          setVisible(false);
          localStorage.setItem('native_push_registered', '1');
          if (onSubscribed) onSubscribed();
        } else {
          setPermState('denied');
        }
        setSubscribing(false);
        return;
      }

      // Web Push path
      const sub = await subscribeToPush();
      if (sub) {
        setPermState('granted');
        setVisible(false);
        if (onSubscribed) onSubscribed();
      } else {
        // Permission was denied or subscription failed
        setPermState(Notification.permission);
      }
    } catch (err) {
      console.error('Push subscribe error:', err);
    }
    setSubscribing(false);
  };

  const handleDismiss = () => {
    setVisible(false);
    localStorage.setItem('push_prompt_dismissed', String(Date.now()));
  };

  const handleSendTest = async () => {
    setTestSending(true);
    setTestResult(null);
    try {
      const res = await apiFetch('/api/push/test', { method: 'POST' });
      if (res && res.ok) {
        setTestResult({ type: 'success', message: 'Test notification sent! Check your notifications.' });
      } else {
        const data = res ? await res.json() : {};
        setTestResult({ type: 'error', message: data.error || 'Failed to send test notification' });
      }
    } catch (err) {
      setTestResult({ type: 'error', message: err.message });
    }
    setTestSending(false);
  };

  if (!visible) return null;

  // iOS not installed as PWA — show install instructions
  if (iosNotInstalled) {
    return React.createElement('div', {
      style: {
        background: 'linear-gradient(135deg, #1b6b5a 0%, #24897a 100%)',
        color: 'var(--text-on-primary)',
        padding: '16px 20px',
        borderRadius: '12px',
        marginBottom: '16px',
        boxShadow: '0 2px 8px rgba(27,107,90,0.25)',
      },
    },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '10px' } },
        React.createElement('span', { style: { fontSize: '28px', flexShrink: 0 } }, '\uD83D\uDD14'),
        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
          React.createElement('div', { style: { fontWeight: 600, fontSize: '14px', marginBottom: '2px' } },
            'Add to Home Screen for Notifications'
          ),
          React.createElement('div', { style: { fontSize: '12px', opacity: 0.9 } },
            'Push notifications on iPad & iPhone require installing the app to your home screen.'
          ),
        ),
        React.createElement('button', {
          onClick: handleDismiss,
          style: {
            background: 'transparent', color: 'rgba(255,255,255,0.7)',
            border: 'none', fontSize: '18px', cursor: 'pointer', padding: '4px', lineHeight: 1, flexShrink: 0,
          },
          title: 'Dismiss',
        }, '\u00D7'),
      ),
      React.createElement('div', {
        style: {
          background: 'rgba(255,255,255,0.15)',
          borderRadius: '8px',
          padding: '12px 14px',
          fontSize: '13px',
          lineHeight: 1.6,
        },
      },
        React.createElement('div', { style: { fontWeight: 600, marginBottom: '6px' } }, 'How to install:'),
        React.createElement('div', null, '1. Tap the Share button ', React.createElement('span', { style: { fontSize: '16px' } }, '\u{1F4E4}'), ' at the bottom of Safari'),
        React.createElement('div', null, '2. Scroll down and tap "Add to Home Screen"'),
        React.createElement('div', null, '3. Tap "Add" in the top right'),
        React.createElement('div', { style: { marginTop: '6px', opacity: 0.85, fontStyle: 'italic' } },
          'Then open inPlace from your home screen and notifications will work!'
        ),
      ),
    );
  }

  return React.createElement('div', {
    style: {
      background: 'linear-gradient(135deg, #1b6b5a 0%, #24897a 100%)',
      color: 'var(--text-on-primary)',
      padding: '14px 20px',
      borderRadius: '12px',
      marginBottom: '16px',
      display: 'flex',
      alignItems: 'center',
      gap: '14px',
      boxShadow: '0 2px 8px rgba(27,107,90,0.25)',
    },
  },
    // Bell icon
    React.createElement('span', { style: { fontSize: '28px', flexShrink: 0 } }, '\uD83D\uDD14'),
    // Text
    React.createElement('div', { style: { flex: 1, minWidth: 0 } },
      React.createElement('div', { style: { fontWeight: 600, fontSize: '14px', marginBottom: '2px' } },
        'Enable Push Notifications'
      ),
      React.createElement('div', { style: { fontSize: '12px', opacity: 0.9 } },
        'Get alerts when you receive messages, care requests, or updates.'
      ),
    ),
    // Enable button
    React.createElement('button', {
      onClick: handleEnable,
      disabled: subscribing,
      style: {
        background: 'var(--bg-surface)',
        color: 'var(--role-color)',
        border: 'none',
        borderRadius: '8px',
        padding: '8px 18px',
        fontSize: '13px',
        fontWeight: 700,
        cursor: subscribing ? 'wait' : 'pointer',
        opacity: subscribing ? 0.7 : 1,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      },
    }, subscribing ? 'Enabling...' : 'Enable'),
    // Dismiss X
    React.createElement('button', {
      onClick: handleDismiss,
      style: {
        background: 'transparent',
        color: 'rgba(255,255,255,0.7)',
        border: 'none',
        fontSize: '18px',
        cursor: 'pointer',
        padding: '4px',
        lineHeight: 1,
        flexShrink: 0,
      },
      title: 'Dismiss',
    }, '\u00D7'),
  );
};

// Notification settings section for MyAccount page
// v1.105.2 — `embedded` drops this component's own card chrome and heading so it can
// sit INSIDE MyAccount's single "Push Notifications" card. Before, the settings screen
// rendered this block (heading: "🔔 Push Notifications") immediately above a separate
// per-event card also headed "Push Notifications" — two identical headers, one screen.
const NotificationSettings = window.NotificationSettings = ({ embedded = false } = {}) => {
  const [permState, setPermState] = useState('unknown');
  const [subCount, setSubCount] = useState(null);
  const [vapidReady, setVapidReady] = useState(null);
  const [subscribing, setSubscribing] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const [iosNeedInstall, setIosNeedInstall] = useState(false);

  useEffect(() => {
    // Native Capacitor app — push handled by native plugin
    if (_isNativeApp()) {
      const nativeRegistered = localStorage.getItem('native_push_registered');
      setPermState(nativeRegistered ? 'granted' : 'default');
    } else if (_isIOS() && !_isStandalone()) {
      // iOS/iPadOS: push only works in standalone PWA mode
      setIosNeedInstall(true);
      setPermState('unsupported');
    } else if ('Notification' in window) {
      setPermState(Notification.permission);
    } else {
      setPermState('unsupported');
    }

    // Check server-side status
    apiFetch('/api/push/status').then(async (res) => {
      if (res && res.ok) {
        const data = await res.json();
        setSubCount(data.userSubscriptions);
        setVapidReady(data.vapidConfigured);
      }
    }).catch(() => {});
  }, []);

  const handleEnable = async () => {
    setSubscribing(true);
    try {
      // Native Capacitor app — use native push plugin
      if (_isNativeApp()) {
        const result = await subscribeNativePush();
        if (result) {
          setPermState('granted');
          localStorage.setItem('native_push_registered', '1');
          const res = await apiFetch('/api/push/status');
          if (res && res.ok) {
            const data = await res.json();
            setSubCount(data.userSubscriptions);
          }
        } else {
          setPermState('denied');
        }
        setSubscribing(false);
        return;
      }

      // Web Push path
      const sub = await subscribeToPush();
      if (sub) {
        setPermState('granted');
        // Re-check status
        const res = await apiFetch('/api/push/status');
        if (res && res.ok) {
          const data = await res.json();
          setSubCount(data.userSubscriptions);
        }
      } else {
        setPermState(Notification.permission);
      }
    } catch (err) {
      console.error('Push subscribe error:', err);
    }
    setSubscribing(false);
  };

  const handleSendTest = async () => {
    setTestSending(true);
    setTestResult(null);
    try {
      const res = await apiFetch('/api/push/test', { method: 'POST' });
      if (res && res.ok) {
        setTestResult({ type: 'success', message: 'Test notification sent! You should see it now.' });
      } else {
        const data = res ? await res.json() : {};
        setTestResult({ type: 'error', message: data.error || 'Failed to send test notification' });
      }
    } catch (err) {
      setTestResult({ type: 'error', message: err.message });
    }
    setTestSending(false);
  };

  const statusColor = permState === 'granted' ? '#22c55e' : permState === 'denied' ? '#ef4444' : '#f59e0b';
  const statusText = permState === 'granted' ? 'Enabled' :
                     permState === 'denied' ? 'Blocked' :
                     iosNeedInstall ? 'Requires Home Screen Install' :
                     permState === 'unsupported' ? 'Not Supported' : 'Not Enabled';

  return React.createElement('div', {
    style: embedded
      ? { padding: 0 }   /* the host .card already pads 24px — don't double-inset */
      : {
          background: 'var(--bg-surface)',
          borderRadius: '12px',
          padding: '20px',
          border: '1px solid var(--border-color)',
          marginBottom: '16px',
        },
  },
    !embedded && React.createElement('h3', {
      style: { margin: '0 0 16px 0', fontSize: '16px', fontWeight: 600, color: 'var(--role-color)' },
    }, '🔔 Push Notifications'),

    // Status row
    React.createElement('div', {
      style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' },
    },
      React.createElement('span', {
        style: {
          display: 'inline-block', width: '10px', height: '10px',
          borderRadius: '50%', background: statusColor,
        },
      }),
      React.createElement('span', { style: { fontSize: '14px', fontWeight: 500 } }, statusText),
      subCount !== null && React.createElement('span', {
        style: { fontSize: '12px', color: 'var(--text-tertiary)', marginLeft: '8px' },
      }, `(${subCount} device${subCount !== 1 ? 's' : ''} registered)`),
    ),

    // Action buttons
    permState === 'default' && React.createElement('button', {
      onClick: handleEnable,
      disabled: subscribing,
      style: {
        background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: '8px',
        padding: '10px 20px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
        marginRight: '8px',
      },
    }, subscribing ? 'Enabling...' : 'Enable Notifications'),

    permState === 'granted' && React.createElement('button', {
      onClick: handleSendTest,
      disabled: testSending,
      style: {
        background: '#f0f9f6', color: 'var(--role-color)', border: '1px solid #1b6b5a', borderRadius: '8px',
        padding: '10px 20px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
      },
    }, testSending ? 'Sending...' : 'Send Test Notification'),

    iosNeedInstall && React.createElement('div', {
      style: { marginTop: '12px', padding: '14px 16px', borderRadius: '10px', background: 'var(--color-warning-bg)', border: '1px solid #fbbf24' },
    },
      React.createElement('div', { style: { fontWeight: 600, fontSize: '14px', color: '#92400e', marginBottom: '8px' } },
        'Add to Home Screen to enable notifications'
      ),
      React.createElement('div', { style: { fontSize: '13px', color: '#78350f', lineHeight: 1.6 } },
        'Push notifications on iPad & iPhone only work when inPlace is installed to your home screen. ',
        'Tap the Share button \uD83D\uDCE4 in Safari, then "Add to Home Screen," and open inPlace from there.'
      ),
    ),

    permState === 'denied' && !iosNeedInstall && React.createElement('p', {
      style: { fontSize: '13px', color: 'var(--text-secondary)', margin: '8px 0 0 0' },
    },
      'Notifications are blocked by your browser. To enable them, open your browser settings and allow notifications for this site, then refresh the page.'
    ),

    // Test result
    testResult && React.createElement('div', {
      style: {
        marginTop: '12px', padding: '10px 14px', borderRadius: '8px',
        background: testResult.type === 'success' ? 'var(--color-success-bg)' : 'var(--bg-error-subtle)',
        color: testResult.type === 'success' ? '#166534' : '#991b1b',
        fontSize: '13px',
      },
    }, testResult.message),

    // Server status
    vapidReady === false && React.createElement('div', {
      style: {
        marginTop: '12px', padding: '10px 14px', borderRadius: '8px',
        background: 'var(--color-warning-bg)', color: '#92400e', fontSize: '13px',
      },
    }, '⚠️ Push notification server is not fully configured. Contact the admin.'),
  );
};
