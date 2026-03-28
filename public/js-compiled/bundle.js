var InPlaceApp = (() => {
  // public/js/app.js
  var PWAInstallBanner = window.PWAInstallBanner = () => {
    const [deferredPrompt, setDeferredPrompt] = useState(null);
    const [dismissed, setDismissed] = useState(false);
    const [isStandalone, setIsStandalone] = useState(false);
    const [showInstructions, setShowInstructions] = useState(false);
    const ua = navigator.userAgent || "";
    const isSafari = /Safari/i.test(ua) && !/Chrome|CriOS|Chromium/i.test(ua);
    const isChrome = /Chrome|CriOS/i.test(ua) && !/Edge/i.test(ua);
    const isIOS = /iPad|iPhone|iPod/.test(ua) || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    useEffect(() => {
      if (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone) {
        setIsStandalone(true);
        return;
      }
      if (localStorage.getItem("pwa_dismissed")) {
        setDismissed(true);
        return;
      }
      const handler = (e) => {
        e.preventDefault();
        setDeferredPrompt(e);
        window.__pwaInstallPrompt = e;
      };
      window.addEventListener("beforeinstallprompt", handler);
      return () => window.removeEventListener("beforeinstallprompt", handler);
    }, []);
    const handleInstall = async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === "accepted") setDeferredPrompt(null);
      } else {
        setShowInstructions(true);
      }
    };
    const handleDismiss = () => {
      setDismissed(true);
      localStorage.setItem("pwa_dismissed", "1");
      setShowInstructions(false);
    };
    const canShow = deferredPrompt || (isSafari || isIOS);
    if (isStandalone || dismissed || !canShow) return null;
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "pwa-install-banner" }, /* @__PURE__ */ React.createElement("img", { src: "/icons/icon-192.png", alt: "InPlace", className: "pwa-install-banner-icon" }), /* @__PURE__ */ React.createElement("div", { className: "pwa-install-banner-text" }, /* @__PURE__ */ React.createElement("div", { className: "pwa-install-banner-title" }, "Add InPlace to Home Screen"), /* @__PURE__ */ React.createElement("div", { className: "pwa-install-banner-subtitle" }, "Quick access to care coordination")), /* @__PURE__ */ React.createElement("button", { className: "pwa-install-btn", onClick: handleInstall }, "Install"), /* @__PURE__ */ React.createElement("button", { className: "pwa-install-dismiss", onClick: handleDismiss }, "\xD7")), showInstructions && /* @__PURE__ */ React.createElement("div", { className: "pwa-instructions-overlay", onClick: () => setShowInstructions(false) }, /* @__PURE__ */ React.createElement("div", { className: "pwa-instructions-modal", onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("button", { className: "pwa-instructions-close", onClick: () => setShowInstructions(false) }, "\xD7"), /* @__PURE__ */ React.createElement("img", { src: "/icons/icon-192.png", alt: "InPlace", style: { width: 56, height: 56, borderRadius: 12, marginBottom: 12 } }), /* @__PURE__ */ React.createElement("h3", { style: { margin: "0 0 4px", fontSize: 18, color: "#1b6b5a" } }, "Install InPlace"), /* @__PURE__ */ React.createElement("p", { style: { margin: "0 0 16px", fontSize: 13, color: "#888" } }, "Add to your home screen for the best experience"), (isSafari || isIOS) && /* @__PURE__ */ React.createElement("div", { className: "pwa-instructions-section" }, /* @__PURE__ */ React.createElement("div", { className: "pwa-instructions-browser-label" }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 18 } }, "\u{1F310}"), " Safari"), /* @__PURE__ */ React.createElement("div", { className: "pwa-instructions-steps" }, /* @__PURE__ */ React.createElement("div", { className: "pwa-instructions-step" }, /* @__PURE__ */ React.createElement("span", { className: "pwa-step-num" }, "1"), /* @__PURE__ */ React.createElement("span", null, "Tap the ", /* @__PURE__ */ React.createElement("strong", null, "Share"), " button ", /* @__PURE__ */ React.createElement("span", { style: { fontSize: 16 } }, "\uFE0E\u2B06"), " at the bottom of your screen")), /* @__PURE__ */ React.createElement("div", { className: "pwa-instructions-step" }, /* @__PURE__ */ React.createElement("span", { className: "pwa-step-num" }, "2"), /* @__PURE__ */ React.createElement("span", null, "Scroll down and tap ", /* @__PURE__ */ React.createElement("strong", null, '"Add to Home Screen"'))), /* @__PURE__ */ React.createElement("div", { className: "pwa-instructions-step" }, /* @__PURE__ */ React.createElement("span", { className: "pwa-step-num" }, "3"), /* @__PURE__ */ React.createElement("span", null, "Tap ", /* @__PURE__ */ React.createElement("strong", null, '"Add"'), " in the top right")))), (isChrome || !isSafari) && /* @__PURE__ */ React.createElement("div", { className: "pwa-instructions-section" }, /* @__PURE__ */ React.createElement("div", { className: "pwa-instructions-browser-label" }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 18 } }, "\u{1F310}"), " Chrome"), /* @__PURE__ */ React.createElement("div", { className: "pwa-instructions-steps" }, /* @__PURE__ */ React.createElement("div", { className: "pwa-instructions-step" }, /* @__PURE__ */ React.createElement("span", { className: "pwa-step-num" }, "1"), /* @__PURE__ */ React.createElement("span", null, "Tap the ", /* @__PURE__ */ React.createElement("strong", null, "three dots"), " ", /* @__PURE__ */ React.createElement("strong", null, "\u22EE"), " menu in the top right")), /* @__PURE__ */ React.createElement("div", { className: "pwa-instructions-step" }, /* @__PURE__ */ React.createElement("span", { className: "pwa-step-num" }, "2"), /* @__PURE__ */ React.createElement("span", null, "Tap ", /* @__PURE__ */ React.createElement("strong", null, '"Add to Home screen"'), " or ", /* @__PURE__ */ React.createElement("strong", null, '"Install app"'))), /* @__PURE__ */ React.createElement("div", { className: "pwa-instructions-step" }, /* @__PURE__ */ React.createElement("span", { className: "pwa-step-num" }, "3"), /* @__PURE__ */ React.createElement("span", null, "Tap ", /* @__PURE__ */ React.createElement("strong", null, '"Install"'), " to confirm")))), /* @__PURE__ */ React.createElement("button", { className: "pwa-instructions-got-it", onClick: () => setShowInstructions(false) }, "Got it"))));
  };
  var OfflineIndicator = window.OfflineIndicator = () => {
    const [offline, setOffline] = useState(!navigator.onLine);
    useEffect(() => {
      const goOffline = () => setOffline(true);
      const goOnline = () => setOffline(false);
      window.addEventListener("offline", goOffline);
      window.addEventListener("online", goOnline);
      return () => {
        window.removeEventListener("offline", goOffline);
        window.removeEventListener("online", goOnline);
      };
    }, []);
    if (!offline) return null;
    return /* @__PURE__ */ React.createElement("div", { style: {
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 9999,
      background: "#e65100",
      color: "#fff",
      textAlign: "center",
      padding: "6px 12px",
      fontSize: "13px",
      fontWeight: 600
    } }, "You're offline \u2014 some features may be unavailable");
  };
  var DemoModeBanner = window.DemoModeBanner = ({ currentUser, onSwitchAccount, onExit }) => {
    const [switching, setSwitching] = useState(null);
    const demoAccounts = [
      { email: "paul@inplace.care", label: "Paul", icon: "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}", color: "#1b6b5a" },
      { email: "maria@inplace.care", label: "Maria", icon: "\u{1F91D}", color: "#2e7d6d" },
      { email: "barbara@inplace.care", label: "Barbara", icon: "\u{1F337}", color: "#e8724a" }
    ];
    const handleSwitch = async (account) => {
      if (account.email === currentUser?.email) return;
      setSwitching(account.email);
      try {
        const csrf = typeof getCsrfToken === "function" ? getCsrfToken() : null;
        const hdrs = { "Content-Type": "application/json" };
        if (csrf) hdrs["X-CSRF-Token"] = csrf;
        const res = await fetch("/api/auth/demo-login", {
          method: "POST",
          headers: hdrs,
          credentials: "same-origin",
          body: JSON.stringify({ email: account.email })
        });
        const data = await res.json();
        if (data.token) {
          AUTH_TOKEN = data.token;
          if (window.setActiveRole) window.setActiveRole(null);
          if (window.connectSocket) connectSocket(data.token);
          onSwitchAccount(data.user || { role: "family", roles: ["family"] });
        }
      } catch (err) {
        console.error("Demo switch failed:", err);
      }
      setSwitching(null);
    };
    return /* @__PURE__ */ React.createElement("div", { className: "demo-mode-banner" }, /* @__PURE__ */ React.createElement("div", { className: "demo-mode-banner-inner" }, /* @__PURE__ */ React.createElement("span", { className: "demo-mode-label" }, "DEMO"), /* @__PURE__ */ React.createElement("div", { className: "demo-mode-accounts" }, demoAccounts.map((account) => {
      const isActive = account.email === currentUser?.email;
      const isLoading = switching === account.email;
      return /* @__PURE__ */ React.createElement(
        "button",
        {
          key: account.email,
          onClick: () => handleSwitch(account),
          disabled: isActive || switching !== null,
          className: `demo-mode-chip ${isActive ? "active" : ""}`,
          style: { "--chip-color": account.color },
          title: `Switch to ${account.label}`
        },
        isLoading ? /* @__PURE__ */ React.createElement("span", { className: "demo-mode-chip-spinner" }) : /* @__PURE__ */ React.createElement("span", { className: "demo-mode-chip-icon" }, account.icon),
        /* @__PURE__ */ React.createElement("span", { className: "demo-mode-chip-label" }, account.label)
      );
    })), /* @__PURE__ */ React.createElement("button", { className: "demo-mode-exit", onClick: onExit }, "Exit Demo")));
  };
  var App = () => {
    const [pendingVerifyToken] = useState(() => {
      const p = new URLSearchParams(window.location.search);
      const vt = p.get("verify");
      if (vt) window.history.replaceState({}, "", window.location.pathname);
      return vt || null;
    });
    const [appState, setAppState] = useState(() => {
      if (pendingVerifyToken) return "verifying-email";
      const p = new URLSearchParams(window.location.search);
      if (p.get("reset")) return "reset-password";
      if (p.get("consent-response")) return "consent-response";
      return "splash";
    });
    const [currentUser, setCurrentUser] = useState(null);
    const [currentPage, setCurrentPage] = useState("dashboard");
    const [pageNavCount, setPageNavCount] = useState(0);
    const [showRequestCareModal, setShowRequestCareModal] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [showDisclaimer, setShowDisclaimer] = useState(false);
    const [activeRole, setActiveRoleState] = useState(getActiveRole());
    const [unreadMsgCount, setUnreadMsgCount] = useState(0);
    const [adminAlertCount, setAdminAlertCount] = useState(0);
    const [adminAlertDetails, setAdminAlertDetails] = useState(null);
    const navHistoryRef = useRef(["dashboard"]);
    const popstateNavRef = useRef(false);
    useEffect(() => {
      if (appState !== "app") return;
      const current = navHistoryRef.current;
      if (popstateNavRef.current) {
        popstateNavRef.current = false;
        return;
      }
      if (current[current.length - 1] !== currentPage) {
        current.push(currentPage);
        window.history.pushState({ page: currentPage }, "", window.location.pathname);
      }
    }, [currentPage, appState]);
    useEffect(() => {
      window.__openRequestCareModal = (prefillDate) => {
        if (prefillDate) window.__requestCareDate = prefillDate;
        setShowRequestCareModal(true);
      };
      window.__navigateTo = (page) => setCurrentPage(page);
      window.__navHistory = navHistoryRef.current;
      window.history.replaceState({ page: "dashboard" }, "", window.location.pathname);
      const handlePopState = (e) => {
        if (navHistoryRef.current.length > 1) {
          navHistoryRef.current.pop();
          const prevPage = navHistoryRef.current[navHistoryRef.current.length - 1];
          popstateNavRef.current = true;
          setCurrentPage(prevPage);
        } else {
          window.history.pushState({ page: "dashboard" }, "", window.location.pathname);
        }
      };
      window.addEventListener("popstate", handlePopState);
      return () => {
        delete window.__openRequestCareModal;
        delete window.__navigateTo;
        window.removeEventListener("popstate", handlePopState);
      };
    }, []);
    useEffect(() => {
      let touchStartX = 0;
      let touchStartY = 0;
      let swiping = false;
      const onTouchStart = (e) => {
        const touch = e.touches[0];
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
        if (dx > 80 && dy < dx * 0.5) {
          window.history.back();
        }
      };
      document.addEventListener("touchstart", onTouchStart, { passive: true });
      document.addEventListener("touchend", onTouchEnd, { passive: true });
      return () => {
        document.removeEventListener("touchstart", onTouchStart);
        document.removeEventListener("touchend", onTouchEnd);
      };
    }, []);
    useEffect(() => {
      if (appState !== "app" || !currentUser) return;
      const fetchUnread = async () => {
        try {
          const res = await apiFetch("/api/messages/conversations");
          if (res?.ok) {
            const data = await res.json();
            const total = (data.conversations || []).reduce((sum, c) => sum + (c.unreadCount || 0), 0);
            setUnreadMsgCount(total);
          }
        } catch {
        }
      };
      fetchUnread();
      const interval = setInterval(fetchUnread, 3e4);
      return () => clearInterval(interval);
    }, [appState, currentUser?.id]);
    useEffect(() => {
      if (appState !== "app" || !currentUser?.isAdmin) return;
      const fetchAlerts = async () => {
        try {
          const res = await apiFetch("/api/admin/alerts");
          if (res?.ok) {
            const data = await res.json();
            setAdminAlertCount(data.total || 0);
            setAdminAlertDetails(data);
          }
        } catch {
        }
      };
      fetchAlerts();
      const interval = setInterval(fetchAlerts, 6e4);
      return () => clearInterval(interval);
    }, [appState, currentUser?.id, currentUser?.isAdmin]);
    useEffect(() => {
      const checkVersion = async () => {
        try {
          const res = await fetch("/api/version", { cache: "no-store" });
          if (!res.ok) return;
          const data = await res.json();
          if (data.version && data.version !== window.APP_VERSION) {
            const lastReload = sessionStorage.getItem("_versionReloadAt");
            const now = Date.now();
            if (lastReload && now - parseInt(lastReload, 10) < 6e4) {
              console.log(`[version] Mismatch (server=${data.version} local=${window.APP_VERSION}) but skipping \u2014 reloaded <60s ago`);
              return;
            }
            sessionStorage.setItem("_versionReloadAt", String(now));
            console.log(`[version] Server=${data.version} Local=${window.APP_VERSION} \u2014 reloading`);
            if (window.caches) {
              const keys = await caches.keys();
              await Promise.all(keys.map((k) => caches.delete(k)));
            }
            window.location.reload();
          }
        } catch {
        }
      };
      const onFocus = () => checkVersion();
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") onFocus();
      });
      const interval = setInterval(checkVersion, 5 * 60 * 1e3);
      const initTimeout = setTimeout(checkVersion, 1e4);
      return () => {
        clearInterval(interval);
        clearTimeout(initTimeout);
      };
    }, []);
    useEffect(() => {
      if (typeof onSocketEvent !== "function") return;
      const cleanup = onSocketEvent("new_message", () => {
        setUnreadMsgCount((c) => c + 1);
        apiFetch("/api/messages/conversations").then(async (res) => {
          if (res?.ok) {
            const data = await res.json();
            const total = (data.conversations || []).reduce((sum, c) => sum + (c.unreadCount || 0), 0);
            setUnreadMsgCount(total);
          }
        }).catch(() => {
        });
      });
      return cleanup;
    }, []);
    useEffect(() => {
      if (typeof onSocketEvent !== "function") return;
      const cleanup = onSocketEvent("account_approved", () => {
        apiFetch("/api/auth/me").then(async (res) => {
          if (res?.ok) {
            const data = await res.json();
            setCurrentUser((prev) => ({ ...prev, ...data.user, account_approved: true }));
          }
        }).catch(() => {
        });
      });
      return cleanup;
    }, []);
    useEffect(() => {
      if (typeof onSocketEvent !== "function") return;
      const cleanup = onSocketEvent("call_incoming", (data) => {
        if ("Notification" in window && Notification.permission === "granted") {
          const typeLabel = data.callType === "video" ? "Video" : "Voice";
          const n = new Notification(`Incoming ${typeLabel} Call`, {
            body: `${data.callerName || "Someone"} is calling you on InPlace`,
            icon: "/icons/icon-192x192.png",
            tag: "incoming-call-global",
            requireInteraction: true
          });
          n.onclick = () => {
            window.focus();
            setCurrentPage("messages");
            n.close();
          };
          setTimeout(() => n.close(), 3e4);
        }
        if (currentPage !== "messages") {
          setCurrentPage("messages");
        }
      });
      if ("Notification" in window && typeof Notification.requestPermission === "function" && Notification.permission === "default") {
        Notification.requestPermission();
      }
      return cleanup;
    }, [currentPage]);
    useEffect(() => {
      const roleColors2 = {
        family: { main: "#1b6b5a", light: "#e0f2e9", dark: "#0f4238" },
        caregiver: { main: "#2e5984", light: "#dce8f3", dark: "#1a3a5c" },
        care_for: { main: "#7b5ea7", light: "#ede7f6", dark: "#4a2d7a" }
      };
      const rc = roleColors2[activeRole] || roleColors2.family;
      const root = document.documentElement;
      root.style.setProperty("--role-color", rc.main);
      root.style.setProperty("--role-color-light", rc.light);
      root.style.setProperty("--role-color-dark", rc.dark);
      window.ROLE_COLOR = rc.main;
      window.ROLE_COLOR_LIGHT = rc.light;
    }, [activeRole]);
    const [resetToken, setResetToken] = useState(() => {
      const p = new URLSearchParams(window.location.search);
      const rt = p.get("reset");
      if (rt) window.history.replaceState({}, "", window.location.pathname);
      return rt || null;
    });
    const [consentResponseToken] = useState(() => {
      const p = new URLSearchParams(window.location.search);
      const ct = p.get("consent-response");
      if (ct) window.history.replaceState({}, "", window.location.pathname);
      return ct || null;
    });
    const [verifyMessage, setVerifyMessage] = useState(null);
    useEffect(() => {
      if (!pendingVerifyToken) return;
      const loggedIn = !!AUTH_TOKEN;
      trackAuthEvent("email-verify", "attempt", { loggedIn, source: "verify-link" });
      fetch(API_BASE + `/api/auth/verify?token=${pendingVerifyToken}`).then((r) => r.json()).then((data) => {
        if (data?.message) {
          trackAuthEvent("email-verify", "success", { loggedIn });
          setVerifyMessage({ type: "success", text: "Email verified! Sign in to continue." });
          if (loggedIn) {
            apiFetch("/api/auth/me").then((r2) => r2?.json()).then((meData) => {
              if (meData?.user) setCurrentUser((prev) => prev ? { ...prev, emailVerified: !!meData.user.email_verified } : prev);
            }).catch(() => {
            });
          } else {
            setAppState("login");
          }
        } else {
          trackAuthEvent("email-verify", "error", { loggedIn, error: data?.error || "unknown" });
          setVerifyMessage({ type: "error", text: data?.error || "Verification failed" });
          setAppState("login");
        }
      }).catch((err) => {
        trackAuthEvent("email-verify", "error", { loggedIn, error: err?.message || "network-error" });
        setVerifyMessage({ type: "error", text: "Verification failed. Please try again or contact support." });
        setAppState("login");
      });
    }, []);
    const [pendingInviteToken, setPendingInviteToken] = useState(null);
    const pendingInviteRef = useRef(null);
    const [inviteInfo, setInviteInfo] = useState(null);
    const [acceptingInvite, setAcceptingInvite] = useState(false);
    const [platformInviteToken, setPlatformInviteToken] = useState(null);
    const [selectedCareTeamId, setSelectedCareTeamId] = useState(null);
    const [signupPrefill, setSignupPrefill] = useState(null);
    useEffect(() => {
      if (appState === "reset-password" || appState === "consent-response") return;
      const hasActiveSession = sessionStorage.getItem("inplace_session_active");
      const hasInviteToken = new URLSearchParams(window.location.search).get("invite") || new URLSearchParams(window.__originalSearch || "").get("invite") || localStorage.getItem("pendingInviteToken");
      if (!hasActiveSession && !hasInviteToken) return;
      apiFetch("/api/auth/me").then(async (r) => {
        if (r?.ok) {
          const data = await r.json();
          if (data.token) {
            AUTH_TOKEN = data.token;
            if (typeof connectSocket === "function") connectSocket(data.token);
          }
          if (data.user) {
            if (data.user.is_demo) {
              setAuthToken(null);
              if (typeof disconnectSocket === "function") disconnectSocket();
              return;
            }
            const userRoles = data.user.roles || [data.user.role];
            setCurrentUser({
              id: data.user.id,
              email: data.user.email,
              role: data.user.role,
              roles: userRoles,
              firstName: data.user.first_name,
              lastName: data.user.last_name,
              profilePhoto: data.user.profile_photo || null,
              emailVerified: !!data.user.email_verified,
              isDemo: !!data.user.is_demo,
              isAdmin: !!data.user.is_admin,
              is_tester: !!data.user.is_tester,
              account_approved: !!data.user.account_approved,
              companionAccess: !!data.user.companion_access,
              onboardingComplete: data.user.onboarding_complete
            });
            const saved = getActiveRole();
            const validRole = saved && userRoles.includes(saved) ? saved : userRoles[0];
            setActiveRoleState(validRole);
            window.setActiveRole(validRole);
            if (data.user.account_approved && (!data.user.disclaimer_accepted_at || data.user.disclaimer_version !== "1.0")) {
              setShowDisclaimer(true);
            }
            try {
              const a11y = data.user.accessibility_prefs ? JSON.parse(data.user.accessibility_prefs) : {};
              if (a11y.textSize && typeof applyTextSize === "function") applyTextSize(a11y.textSize);
            } catch {
            }
            sessionStorage.setItem("inplace_session_active", "1");
            setAppState("app");
            const inviteParam = new URLSearchParams(window.location.search).get("invite") || new URLSearchParams(window.__originalSearch || "").get("invite") || localStorage.getItem("pendingInviteToken");
            if (inviteParam) {
              setAcceptingInvite(true);
              apiFetch("/api/care-teams/accept-invite", {
                method: "POST",
                body: JSON.stringify({ token: inviteParam })
              }).then(async (r2) => {
                if (r2?.ok) {
                  const d = await r2.json();
                  setVerifyMessage({ type: "success", text: d.message || "You've joined the care team!" });
                  if (d.careTeamId) {
                    setSelectedCareTeamId(d.careTeamId);
                    setCurrentPage("care-team");
                  }
                } else {
                  try {
                    const errData = await r2.json();
                    setVerifyMessage({ type: "error", text: errData.error || "Could not accept this invite. It may have expired." });
                  } catch {
                    setVerifyMessage({ type: "error", text: "Could not accept this invite. It may have expired." });
                  }
                }
                localStorage.removeItem("pendingInviteToken");
              }).catch(() => {
                setVerifyMessage({ type: "error", text: "Could not accept this invite. Please check your connection and try again." });
              }).finally(() => {
                setAcceptingInvite(false);
              });
              setPendingInviteToken(null);
              pendingInviteRef.current = null;
              setInviteInfo(null);
            }
          }
        }
      }).catch(() => {
      });
      const params = new URLSearchParams(window.location.search);
      window.__originalSearch = window.location.search;
      const inviteToken = params.get("invite") || localStorage.getItem("pendingInviteToken");
      if (params.get("invite")) localStorage.setItem("pendingInviteToken", params.get("invite"));
      if (inviteToken) {
        setPendingInviteToken(inviteToken);
        pendingInviteRef.current = inviteToken;
        window.history.replaceState({}, "", window.location.pathname);
        fetch(`/api/care-teams/invite-info?token=${inviteToken}`).then((r) => r.ok ? r.json() : null).then((data) => {
          if (data?.invite) {
            setInviteInfo(data.invite);
            if (!AUTH_TOKEN) {
              setAppState("invite");
            }
          }
        }).catch(() => {
        });
        if (!savedToken) setAppState("invite");
      }
      const pInvite = params.get("platformInvite");
      if (pInvite) {
        setPlatformInviteToken(pInvite);
        setAppState("platform-onboarding");
        window.history.replaceState({}, "", window.location.pathname);
      }
      const signupToken = params.get("signupToken");
      if (signupToken) {
        window.history.replaceState({}, "", window.location.pathname);
        fetch(`/api/auth/confirm-signup?token=${signupToken}`).then((r) => r.json().then((data) => ({ ok: r.ok, status: r.status, data }))).then(({ ok, status, data }) => {
          if (ok && data.email && data.role) {
            setSignupPrefill({ email: data.email, role: data.role, signupToken });
            setAppState("register");
          } else if (status === 409 && data.alreadyRegistered) {
            setVerifyMessage({
              type: data.needsProfile ? "info" : "success",
              text: data.error || "This email is already registered. Please sign in."
            });
            setAppState("login");
          } else {
            setVerifyMessage({ type: "error", text: data.error || "Invalid signup link." });
          }
        }).catch(() => {
          setVerifyMessage({ type: "error", text: "Failed to validate signup link." });
        });
      }
      if (params.get("sandbox") === "true") {
        window.__sandboxMode = true;
        setAppState("register");
      }
      const hash = window.location.hash;
      if (hash === "#payments-complete" || hash === "#payments-refresh") {
        setCurrentPage("financials");
        window.history.replaceState({}, "", window.location.pathname);
      }
      const convId = params.get("conversation");
      if (convId) {
        window.__pendingConversation = convId;
        setCurrentPage("messages");
        window.history.replaceState({}, "", window.location.pathname);
      }
      const deepPage = params.get("page");
      if (deepPage) {
        setCurrentPage(deepPage);
        window.history.replaceState({}, "", window.location.pathname);
      }
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.addEventListener("message", (event) => {
          if (event.data?.type === "PUSH_NAVIGATE") {
            const d = event.data.data || {};
            if (d.type === "message" && d.conversationId) {
              window.__pendingConversation = d.conversationId;
              setCurrentPage("messages");
            } else if (d.type === "care_request" || d.type === "care_request_accepted") {
              setCurrentPage(role === "caregiver" ? "find-work" : "schedule");
            } else if (d.type === "new_job") {
              setCurrentPage("find-work");
            } else if (d.type === "check_in_reminder" || d.type === "check_out_reminder" || d.type === "caregiver_arriving" || d.type === "caregiver_arriving_recipient") {
              setCurrentPage("dashboard");
            } else if (d.type === "kindred_relay") {
              setCurrentPage("messages");
            } else if (d.type === "admin_setting_change") {
              setCurrentPage("dashboard");
            } else if (d.type === "video_call" && d.conversationId) {
              window.__pendingConversation = d.conversationId;
              setCurrentPage("messages");
            }
          }
        });
      }
    }, []);
    const handleLogin = (user) => {
      sessionStorage.setItem("inplace_session_active", "1");
      window.setActiveRole(null);
      setActiveRoleState(null);
      apiFetch("/api/auth/me").then(async (r) => {
        if (r?.ok) {
          const data = await r.json();
          if (data.user) {
            let userRoles;
            try {
              userRoles = data.user.roles ? typeof data.user.roles === "string" ? JSON.parse(data.user.roles) : data.user.roles : [data.user.role];
            } catch {
              userRoles = [data.user.role];
            }
            setCurrentUser({
              id: data.user.id,
              email: data.user.email,
              role: data.user.role,
              roles: userRoles,
              firstName: data.user.first_name,
              lastName: data.user.last_name,
              profilePhoto: data.user.profile_photo || null,
              emailVerified: !!data.user.email_verified,
              isDemo: !!data.user.is_demo,
              isAdmin: !!data.user.is_admin,
              is_tester: !!data.user.is_tester,
              account_approved: !!data.user.account_approved,
              companionAccess: !!data.user.companion_access,
              onboardingComplete: data.user.onboarding_complete
            });
            if (userRoles.length === 1) {
              window.setActiveRole(userRoles[0]);
              setActiveRoleState(userRoles[0]);
            }
            if (data.user.account_approved && (!data.user.disclaimer_accepted_at || data.user.disclaimer_version !== "1.0")) {
              setShowDisclaimer(true);
            }
            try {
              const a11y = data.user.accessibility_prefs ? JSON.parse(data.user.accessibility_prefs) : {};
              if (a11y.textSize && typeof applyTextSize === "function") applyTextSize(a11y.textSize);
            } catch {
            }
          }
        }
      }).catch(() => {
      });
      setCurrentPage("dashboard");
      setAppState("app");
      if (typeof subscribeToPush === "function" && "Notification" in window && Notification.permission === "granted") {
        subscribeToPush().catch(() => {
        });
      }
      if (typeof checkPushHealth === "function") {
        if (window._pushHealthTimer) clearInterval(window._pushHealthTimer);
        window._pushHealthTimer = setInterval(() => checkPushHealth().catch(() => {
        }), 30 * 60 * 1e3);
      }
      if (AUTH_TOKEN && typeof connectSocket === "function") {
        connectSocket(AUTH_TOKEN);
      }
      const inviteTokenNow = pendingInviteRef.current || localStorage.getItem("pendingInviteToken");
      if (inviteTokenNow) {
        setAcceptingInvite(true);
        apiFetch("/api/care-teams/accept-invite", {
          method: "POST",
          body: JSON.stringify({ token: inviteTokenNow })
        }).then(async (r) => {
          if (r?.ok) {
            const data = await r.json();
            setVerifyMessage({ type: "success", text: data.message || "You've joined the care team!" });
            if (data.careTeamId) {
              setSelectedCareTeamId(data.careTeamId);
              setCurrentPage("care-team");
            }
            localStorage.removeItem("pendingInviteToken");
          } else {
            try {
              const errData = await r.json();
              setVerifyMessage({ type: "error", text: errData.error || "Could not accept this invite. It may have expired." });
            } catch {
              setVerifyMessage({ type: "error", text: "Could not accept this invite. It may have expired." });
            }
            localStorage.removeItem("pendingInviteToken");
          }
        }).catch(() => {
          setVerifyMessage({ type: "error", text: "Could not accept this invite. Please check your connection and try again." });
        }).finally(() => {
          setAcceptingInvite(false);
        });
        setPendingInviteToken(null);
        pendingInviteRef.current = null;
        window.__originalSearch = "";
      }
    };
    const handleLogout = () => {
      sessionStorage.removeItem("inplace_session_active");
      AUTH_TOKEN = null;
      fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {
      });
      setCurrentUser(null);
      setAuthToken(null);
      window.setActiveRole(null);
      setActiveRoleState(null);
      setCurrentPage("dashboard");
      setAppState("splash");
      localStorage.removeItem("pendingInviteToken");
      if (typeof applyTextSize === "function") applyTextSize("default");
      if (typeof disconnectSocket === "function") disconnectSocket();
    };
    const handleExitDemo = () => {
      setCurrentUser(null);
      setAuthToken(null);
      setCurrentPage("dashboard");
      setAppState("demo");
      if (typeof disconnectSocket === "function") disconnectSocket();
    };
    const handleDemoSwitch = (user) => {
      const roles = Array.isArray(user.roles) ? user.roles : [user.role];
      const primaryRole = roles[0];
      setCurrentUser({
        id: user.id,
        email: user.email,
        role: user.role,
        roles,
        firstName: user.first_name || user.firstName,
        lastName: user.last_name || user.lastName,
        profilePhoto: user.profile_photo || user.profilePhoto || null,
        emailVerified: true,
        isDemo: true,
        isAdmin: false,
        is_tester: false,
        account_approved: true,
        onboardingComplete: true
      });
      setActiveRoleState(primaryRole);
      window.setActiveRole(primaryRole);
      setCurrentPage("dashboard");
    };
    const handleNavigate = (page) => {
      setAppState(page);
    };
    const handlePageChange = (page) => {
      setCurrentPage(page);
      setPageNavCount((c) => c + 1);
      setSidebarOpen(false);
      if (page === "messages") setUnreadMsgCount(0);
      if (page === "admin" && adminAlertCount > 0 && adminAlertDetails?._raw) {
        setAdminAlertCount(0);
        apiFetch("/api/admin/alerts/dismiss-all", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ snapshot: adminAlertDetails._raw })
        }).catch(() => {
        });
      }
    };
    if (appState === "platform-onboarding" && platformInviteToken) {
      return /* @__PURE__ */ React.createElement(CaregiverOnboarding, { inviteToken: platformInviteToken, onComplete: (token) => {
        setPlatformInviteToken(null);
        if (token) {
          AUTH_TOKEN = token;
          if (typeof connectSocket === "function") connectSocket(token);
          apiFetch("/api/auth/me").then(async (r) => {
            if (r?.ok) {
              const data = await r.json();
              if (data.user) {
                setCurrentUser({
                  id: data.user.id,
                  email: data.user.email,
                  role: data.user.role,
                  firstName: data.user.first_name,
                  lastName: data.user.last_name,
                  profilePhoto: data.user.profile_photo || null,
                  emailVerified: !!data.user.email_verified,
                  isDemo: false,
                  isAdmin: !!data.user.is_admin,
                  is_tester: !!data.user.is_tester,
                  companionAccess: !!data.user.companion_access
                });
                if (!data.user.disclaimer_accepted_at || data.user.disclaimer_version !== "1.0") {
                  setShowDisclaimer(true);
                }
                try {
                  const a11y = data.user.accessibility_prefs ? JSON.parse(data.user.accessibility_prefs) : {};
                  if (a11y.textSize && typeof applyTextSize === "function") applyTextSize(a11y.textSize);
                } catch {
                }
                window.__postOnboarding = true;
                setCurrentPage("dashboard");
                setAppState("app");
              }
            }
          }).catch(() => setAppState("splash"));
        } else {
          setAppState("splash");
        }
      } });
    }
    if (appState === "resume-onboarding" && currentUser) {
      return /* @__PURE__ */ React.createElement(CaregiverOnboarding, { resumeMode: true, resumeUser: { firstName: currentUser.firstName, lastName: currentUser.lastName, email: currentUser.email }, onComplete: (token) => {
        if (token) {
          window.__postOnboarding = true;
          setCurrentPage("dashboard");
          setAppState("app");
        } else {
          setAppState("app");
        }
      } });
    }
    if (appState === "signup-onboarding" && signupPrefill) {
      return /* @__PURE__ */ React.createElement(CaregiverOnboarding, { signupToken: signupPrefill.signupToken, signupEmail: signupPrefill.email, onComplete: (token) => {
        setSignupPrefill(null);
        if (token) {
          AUTH_TOKEN = token;
          if (typeof connectSocket === "function") connectSocket(token);
          apiFetch("/api/auth/me").then(async (r) => {
            if (r?.ok) {
              const data = await r.json();
              if (data.user) {
                setCurrentUser({
                  id: data.user.id,
                  email: data.user.email,
                  role: data.user.role,
                  firstName: data.user.first_name,
                  lastName: data.user.last_name,
                  profilePhoto: data.user.profile_photo || null,
                  emailVerified: !!data.user.email_verified,
                  isDemo: false,
                  isAdmin: !!data.user.is_admin,
                  is_tester: !!data.user.is_tester,
                  companionAccess: !!data.user.companion_access
                });
                if (!data.user.disclaimer_accepted_at || data.user.disclaimer_version !== "1.0") {
                  setShowDisclaimer(true);
                }
                try {
                  const a11y = data.user.accessibility_prefs ? JSON.parse(data.user.accessibility_prefs) : {};
                  if (a11y.textSize && typeof applyTextSize === "function") applyTextSize(a11y.textSize);
                } catch {
                }
                window.__postOnboarding = true;
                setCurrentPage("dashboard");
                setAppState("app");
              }
            }
          }).catch(() => setAppState("splash"));
        } else {
          setAppState("splash");
        }
      } });
    }
    const preAuthPages = {
      invite: /* @__PURE__ */ React.createElement(InviteLandingPage, { inviteInfo, onNavigate: handleNavigate }),
      splash: /* @__PURE__ */ React.createElement(SplashPage, { onNavigate: handleNavigate, inviteInfo }),
      demo: /* @__PURE__ */ React.createElement(DemoPickerPage, { onLogin: handleLogin, onNavigate: handleNavigate }),
      "verifying-email": /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#f5f5f5", padding: 24 } }, /* @__PURE__ */ React.createElement("div", { style: { background: "#fff", borderRadius: 16, padding: "48px 40px", maxWidth: 420, width: "100%", textAlign: "center", boxShadow: "0 2px 12px rgba(0,0,0,0.08)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 48, marginBottom: 16 } }, "\u2709\uFE0F"), /* @__PURE__ */ React.createElement("h2", { style: { margin: "0 0 8px", fontSize: 22, fontWeight: 700, color: "#333" } }, "Verifying your email..."), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 15, color: "#666", margin: 0 } }, "Just a moment while we confirm your address."))),
      login: /* @__PURE__ */ React.createElement(LoginPage, { onLogin: handleLogin, onNavigate: handleNavigate, banner: verifyMessage, onDismissBanner: () => setVerifyMessage(null), inviteInfo }),
      register: /* @__PURE__ */ React.createElement(RegisterPage, { onLogin: handleLogin, onNavigate: handleNavigate, prefilledEmail: signupPrefill?.email || inviteInfo?.email, prefilledRole: signupPrefill?.role, signupToken: signupPrefill?.signupToken, pendingInviteToken, sandboxMode: !!window.__sandboxMode }),
      "forgot-password": /* @__PURE__ */ React.createElement(ForgotPasswordPage, { onNavigate: handleNavigate }),
      "reset-password": /* @__PURE__ */ React.createElement(ResetPasswordPage, { token: resetToken, onNavigate: handleNavigate }),
      "consent-response": /* @__PURE__ */ React.createElement(ConsentResponsePage, { token: consentResponseToken })
    };
    if (preAuthPages[appState]) {
      return /* @__PURE__ */ React.createElement(React.Fragment, null, preAuthPages[appState]);
    }
    const role = activeRole || currentUser?.role || "family";
    const roleColors = {
      family: { main: "#1b6b5a", light: "#e0f2e9", dark: "#0f4238" },
      caregiver: { main: "#2e5984", light: "#dce8f3", dark: "#1a3a5c" },
      care_for: { main: "#7b5ea7", light: "#ede7f6", dark: "#4a2d7a" }
    };
    const currentRoleColor = roleColors[role] || roleColors.family;
    const handleSwitchRole = (newRole) => {
      if (!currentUser?.roles?.includes(newRole)) return;
      setActiveRoleState(newRole);
      window.setActiveRole(newRole);
      setCurrentPage("dashboard");
      setSidebarOpen(false);
    };
    const getNavItems = () => {
      if (role === "caregiver") {
        const cgOnboarded = currentUser?.onboardingComplete !== false;
        return [
          { id: "dashboard", icon: "\u{1F3E0}", label: "Home" },
          { id: "find-work", icon: "\u{1F50D}", label: "Find Work", isAction: true, disabled: !cgOnboarded },
          { id: "messages", icon: "\u{1F4AC}", label: "Messages" }
        ];
      }
      if (role === "care_for") {
        return [
          { id: "dashboard", icon: "\u{1F3E0}", label: "My Home" },
          { id: "messages", icon: "\u{1F4AC}", label: "Messages" }
        ];
      }
      const familyNav = [
        { id: "dashboard", icon: "\u{1F3E0}", label: "Home" },
        { id: "_request_care", icon: "\u2795", label: "Request Care", isAction: true },
        { id: "care-profile", icon: "\u{1F337}", label: "My Loved One", children: [
          { id: "care-team", icon: "\u{1F46A}", label: "Care Team" },
          { id: "caregivers", icon: "\u{1F91D}", label: "Caregivers" }
        ] },
        { id: "activity", icon: "\u{1F4E2}", label: "Activity Feed" },
        { id: "messages", icon: "\u{1F4AC}", label: "Messages" }
      ];
      if (currentUser?.isAdmin) {
        familyNav.push({ id: "admin", icon: "\u{1F6E1}\uFE0F", label: "Admin" });
      }
      return familyNav;
    };
    const getBottomSidebarItems = () => [
      { id: "help", icon: "\u2753", label: "Help" },
      { id: "account", icon: "\u{1F464}", label: "My Account" }
    ];
    const getRoleLabel = () => {
      if (role === "caregiver") return "Caregiver";
      if (role === "care_for") return "Care Recipient";
      return "Care Team";
    };
    const renderPage = () => {
      const pageKey = currentPage + "-" + (currentUser?.id || "") + "-" + pageNavCount;
      try {
        const wizardData = sessionStorage.getItem("inplace_wizard");
        if (wizardData && currentPage !== "recipients" && currentPage !== "account" && currentPage !== "help" && currentPage !== "care-team") {
          setTimeout(() => setCurrentPage("recipients"), 0);
          return /* @__PURE__ */ React.createElement("div", { key: pageKey, style: { display: "flex", justifyContent: "center", alignItems: "center", height: "60vh", color: "#666" } }, "Returning to setup...");
        }
      } catch {
      }
      if (currentPage === "dashboard") {
        if (role === "caregiver") return /* @__PURE__ */ React.createElement(CaretakerHub, { key: pageKey, onNeedsOnboarding: () => setAppState("resume-onboarding") });
        if (role === "care_for") return /* @__PURE__ */ React.createElement(CaredForView, { key: pageKey });
        return /* @__PURE__ */ React.createElement(Dashboard, { key: pageKey, onNavigate: setCurrentPage, acceptingInvite });
      }
      if (currentPage === "care-profile") return /* @__PURE__ */ React.createElement(CareProfile, { key: pageKey, onNavigate: setCurrentPage });
      if (currentPage === "care-team") return /* @__PURE__ */ React.createElement(CareTeamPage, { key: pageKey, selectedTeamId: selectedCareTeamId, onNavigate: setCurrentPage });
      if (currentPage === "find-work") return /* @__PURE__ */ React.createElement(FindWork, { key: pageKey });
      if (currentPage === "schedule") return /* @__PURE__ */ React.createElement(Schedule, { key: pageKey });
      if (currentPage === "caregivers") return /* @__PURE__ */ React.createElement(Caregivers, { key: pageKey });
      if (currentPage === "documents") {
        window.__accountTab = "documents";
        return /* @__PURE__ */ React.createElement(MyAccount, { key: pageKey, setCurrentUser, onNavigate: setCurrentPage });
      }
      if (currentPage === "analytics") return /* @__PURE__ */ React.createElement(Analytics, { key: pageKey });
      if (currentPage === "activity") return /* @__PURE__ */ React.createElement(ActivityFeed, { key: pageKey });
      if (currentPage === "recipients") return /* @__PURE__ */ React.createElement(CareRecipients, { key: pageKey });
      if (currentPage === "messages") return /* @__PURE__ */ React.createElement(Messages, { key: pageKey });
      if (currentPage === "account") return /* @__PURE__ */ React.createElement(MyAccount, { key: pageKey, setCurrentUser, onNavigate: setCurrentPage });
      if (currentPage === "help") return /* @__PURE__ */ React.createElement(HelpPage, { key: pageKey, currentUser, onNavigate: setCurrentPage });
      if (currentPage === "financials") return /* @__PURE__ */ React.createElement(MyAccount, { key: pageKey, setCurrentUser, onNavigate: setCurrentPage });
      {
      }
      if (currentPage === "payments") {
        window.__accountTab = "payments";
        return /* @__PURE__ */ React.createElement(MyAccount, { key: pageKey, setCurrentUser, onNavigate: setCurrentPage });
      }
      if (currentPage === "admin" && currentUser?.isAdmin) return /* @__PURE__ */ React.createElement(AdminPanel, { key: pageKey, currentUser });
      return /* @__PURE__ */ React.createElement(Dashboard, { key: pageKey, onNavigate: setCurrentPage });
    };
    const getBottomNavItems = () => {
      if (role === "caregiver") {
        const cgOnboarded = currentUser?.onboardingComplete !== false;
        const firstStepsRemain = !!window.__caregiverFirstStepsRemain;
        return [
          { id: "dashboard", icon: "\u{1F3E0}", label: "Home" },
          { id: "find-work", icon: "\u{1F50D}", label: "Find Work", isAccent: true, disabled: !cgOnboarded || firstStepsRemain },
          { id: "messages", icon: "\u{1F4AC}", label: "Messages" },
          { id: "account", icon: "\u{1F464}", label: "Account" }
        ];
      }
      if (role === "care_for") {
        return [
          { id: "dashboard", icon: "\u{1F3E0}", label: "Home" },
          { id: "messages", icon: "\u{1F4AC}", label: "Messages" },
          { id: "account", icon: "\u{1F464}", label: "Account" }
        ];
      }
      const familyBottom = [
        { id: "dashboard", icon: "\u{1F3E0}", label: "Home" },
        { id: "care-profile", icon: "\u{1F337}", label: "Loved One" },
        { id: "caregivers", icon: "\u{1F91D}", label: "Caregivers" },
        { id: "messages", icon: "\u{1F4AC}", label: "Messages" }
      ];
      familyBottom.push({ id: "account", icon: "\u{1F464}", label: "Account" });
      if (currentUser?.isAdmin) {
        familyBottom.push({ id: "admin", icon: "\u{1F6E1}\uFE0F", label: "Admin" });
      }
      return familyBottom;
    };
    const isDemo = currentUser?.isDemo;
    const appContent = /* @__PURE__ */ React.createElement(React.Fragment, null, showDisclaimer && /* @__PURE__ */ React.createElement(DisclaimerModal, { onAccept: () => {
      setShowDisclaimer(false);
      setVerifyMessage({ type: "success", text: "Welcome to InPlace!" });
    } }), sidebarOpen && /* @__PURE__ */ React.createElement("div", { className: "sidebar-overlay", onClick: () => setSidebarOpen(false) }), /* @__PURE__ */ React.createElement("aside", { className: `sidebar ${sidebarOpen ? "sidebar-open" : ""}` }, /* @__PURE__ */ React.createElement("div", { className: "sidebar-logo" }, /* @__PURE__ */ React.createElement(InPlaceIcon, { width: 36, height: 36 }), /* @__PURE__ */ React.createElement("div", { className: "sidebar-logo-text" }, /* @__PURE__ */ React.createElement("span", { className: "logo-in" }, "in"), /* @__PURE__ */ React.createElement("span", { className: "logo-place" }, "Place")), /* @__PURE__ */ React.createElement("button", { className: "sidebar-close", onClick: () => setSidebarOpen(false), "aria-label": "Close menu" }, "\xD7")), currentUser && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 16px 14px", gap: "6px" } }, /* @__PURE__ */ React.createElement("div", { className: "sidebar-avatar", style: {
      width: 44,
      height: 44,
      borderRadius: "50%",
      background: currentUser.profilePhoto ? `url(${currentUser.profilePhoto}) center/cover` : "#e8724a",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "white",
      fontSize: 16,
      fontWeight: 600,
      flexShrink: 0,
      overflow: "hidden"
    } }, !currentUser.profilePhoto && (currentUser.firstName?.[0] || "?").toUpperCase()), /* @__PURE__ */ React.createElement("div", { style: { fontSize: "14px", color: "rgba(255,255,255,0.9)", fontWeight: 600, textAlign: "center", lineHeight: 1.3 } }, currentUser.firstName || "User", " ", currentUser.lastName || "")), (() => {
      const allRoles = ["family", "caregiver", "care_for"];
      const labels = { family: "Family", caregiver: "Caregiver", care_for: "Recipient" };
      const icons = { family: "\u{1F46A}", caregiver: "\u{1F4BC}", care_for: "\u{1F3E0}" };
      const userRoles = currentUser?.roles || [role];
      return /* @__PURE__ */ React.createElement("div", { style: { margin: "0 12px 4px" } }, userRoles.length > 1 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: "10px", color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "1px", padding: "0 4px 4px", textAlign: "center" } }, "Viewing as"), /* @__PURE__ */ React.createElement("div", { style: { padding: "3px", display: "flex", gap: "3px", background: "rgba(0,0,0,0.15)", borderRadius: "6px" } }, allRoles.map((r) => {
        const hasRole = userRoles.includes(r);
        const isActive = r === role;
        return React.createElement("button", {
          key: r,
          onClick: hasRole ? () => handleSwitchRole(r) : void 0,
          style: {
            flex: 1,
            padding: "8px 6px",
            borderRadius: "5px",
            border: "none",
            cursor: hasRole ? "pointer" : "default",
            fontSize: "11px",
            fontWeight: isActive ? 700 : 500,
            textAlign: "center",
            background: isActive ? "rgba(255,255,255,0.2)" : "transparent",
            color: isActive ? "white" : hasRole ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.2)",
            transition: "all 0.2s",
            opacity: hasRole ? 1 : 0.5
          }
        }, `${icons[r] || ""} ${labels[r] || r}`);
      })));
    })(), /* @__PURE__ */ React.createElement("nav", { style: { flex: 1, display: "flex", flexDirection: "column" } }, /* @__PURE__ */ React.createElement("ul", { className: "nav-menu" }, getNavItems().map((item) => {
      if (item.isAction) {
        const actionClick = item.disabled ? () => {
        } : item.id === "_request_care" ? () => {
          handlePageChange("schedule");
          setSidebarOpen(false);
        } : item.id === "_launch_kindred" ? () => {
          window.open(`/kindred?token=${encodeURIComponent(AUTH_TOKEN)}`, "_blank");
          setSidebarOpen(false);
        } : () => {
          handlePageChange(item.id);
          setSidebarOpen(false);
        };
        return /* @__PURE__ */ React.createElement("li", { key: item.id, className: "nav-item" }, /* @__PURE__ */ React.createElement("button", { onClick: actionClick, className: "nav-link", style: item.disabled ? { background: "#999", color: "rgba(255,255,255,0.5)", fontWeight: 600, cursor: "not-allowed", opacity: 0.5 } : item.id === "_launch_kindred" ? { background: "#1A5276", color: "#fff", fontWeight: 600 } : { background: "#e8724a", color: "#fff", fontWeight: 600 }, title: item.disabled ? "Complete your profile first" : item.id === "_launch_kindred" ? "Open Kindred (new tab)" : "" }, /* @__PURE__ */ React.createElement("span", { className: "nav-icon" }, item.icon), " ", item.label, " ", item.disabled && "\u{1F512}"));
      }
      const isParentActive = currentPage === item.id || item.children && item.children.some((c) => currentPage === c.id);
      return /* @__PURE__ */ React.createElement("li", { key: item.id, className: "nav-item" }, /* @__PURE__ */ React.createElement("button", { className: `nav-link ${currentPage === item.id ? "active" : ""}`, onClick: item.disabled ? void 0 : () => handlePageChange(item.id), style: item.disabled ? { position: "relative", opacity: 0.4, cursor: "not-allowed" } : { position: "relative" }, title: item.disabled ? "Complete your profile first" : "" }, /* @__PURE__ */ React.createElement("span", { className: "nav-icon" }, item.icon), item.label, " ", item.disabled && "\u{1F512}", item.id === "messages" && unreadMsgCount > 0 && /* @__PURE__ */ React.createElement("span", { style: {
        marginLeft: "auto",
        background: "#e8724a",
        color: "#fff",
        borderRadius: 10,
        padding: "1px 6px",
        fontSize: 10,
        fontWeight: 700,
        minWidth: 18,
        textAlign: "center",
        lineHeight: "16px"
      } }, unreadMsgCount > 99 ? "99+" : unreadMsgCount), item.id === "admin" && adminAlertCount > 0 && /* @__PURE__ */ React.createElement("span", { title: adminAlertDetails ? [
        adminAlertDetails.pendingUsers && `${adminAlertDetails.pendingUsers} pending users`,
        adminAlertDetails.pausedCaregivers && `${adminAlertDetails.pausedCaregivers} paused caregivers`,
        adminAlertDetails.pendingConsent && `${adminAlertDetails.pendingConsent} pending consent`,
        adminAlertDetails.newFeedback && `${adminAlertDetails.newFeedback} new feedback`,
        adminAlertDetails.checkrAlerts && `${adminAlertDetails.checkrAlerts} background check updates`
      ].filter(Boolean).join(", ") : "", style: {
        marginLeft: "auto",
        background: "#dc2626",
        color: "#fff",
        borderRadius: 10,
        padding: "1px 6px",
        fontSize: 10,
        fontWeight: 700,
        minWidth: 18,
        textAlign: "center",
        lineHeight: "16px"
      } }, adminAlertCount > 99 ? "99+" : adminAlertCount)), item.children && isParentActive && /* @__PURE__ */ React.createElement("ul", { style: { listStyle: "none", margin: 0, padding: "2px 0 2px 20px" } }, item.children.map((child) => /* @__PURE__ */ React.createElement("li", { key: child.id }, /* @__PURE__ */ React.createElement("button", { className: `nav-link ${currentPage === child.id ? "active" : ""}`, onClick: () => handlePageChange(child.id), style: { fontSize: 13, padding: "6px 12px" } }, /* @__PURE__ */ React.createElement("span", { className: "nav-icon", style: { fontSize: 14 } }, child.icon), child.label)))));
    })), /* @__PURE__ */ React.createElement("div", { style: { marginTop: "auto", paddingTop: "12px", borderTop: "1px solid rgba(255,255,255,0.1)" } }, /* @__PURE__ */ React.createElement("ul", { className: "nav-menu", style: { marginBottom: 0 } }, getBottomSidebarItems().map((item) => /* @__PURE__ */ React.createElement("li", { key: item.id, className: "nav-item" }, /* @__PURE__ */ React.createElement("button", { className: `nav-link ${currentPage === item.id ? "active" : ""}`, onClick: () => handlePageChange(item.id), style: { position: "relative" } }, /* @__PURE__ */ React.createElement("span", { className: "nav-icon" }, item.icon), item.label)))), /* @__PURE__ */ React.createElement("button", { className: "nav-link", onClick: isDemo ? handleExitDemo : handleLogout }, /* @__PURE__ */ React.createElement("span", { className: "nav-icon" }, "\u{1F6AA}"), " ", isDemo ? "Exit Demo" : "Logout"), /* @__PURE__ */ React.createElement("div", { style: { padding: "4px 16px 4px", fontSize: "10px", color: "rgba(255,255,255,0.3)" } }, "v", window.APP_VERSION || "?")))), /* @__PURE__ */ React.createElement("main", { className: "main-content" }, /* @__PURE__ */ React.createElement("button", { className: "hamburger-btn", onClick: () => setSidebarOpen(true), "aria-label": "Open menu" }, /* @__PURE__ */ React.createElement("span", null), /* @__PURE__ */ React.createElement("span", null), /* @__PURE__ */ React.createElement("span", null)), currentUser?.roles?.length > 1 && /* @__PURE__ */ React.createElement("div", { className: "role-switcher-bar", style: {
      display: "flex",
      gap: "4px",
      padding: "6px 8px",
      marginBottom: "12px",
      background: "#f0f0f0",
      borderRadius: "10px",
      width: "fit-content"
    } }, ["family", "caregiver", "care_for"].map((r) => {
      const labels = { family: "Family", caregiver: "Caregiver", care_for: "Recipient" };
      const icons = { family: "\u{1F46A}", caregiver: "\u{1F4BC}", care_for: "\u{1F3E0}" };
      const btnColor = (roleColors[r] || roleColors.family).main;
      const isActive = r === role;
      const hasRole = (currentUser.roles || []).includes(r);
      return React.createElement("button", {
        key: r,
        onClick: hasRole ? () => handleSwitchRole(r) : void 0,
        style: {
          padding: "5px 13px",
          borderRadius: "8px",
          border: isActive ? "2px solid " + btnColor : hasRole ? "2px solid #1b6b5a" : "2px solid transparent",
          cursor: hasRole ? "pointer" : "default",
          fontSize: "13px",
          fontWeight: isActive ? 600 : 400,
          background: isActive ? btnColor : "transparent",
          color: isActive ? "white" : hasRole ? "#666" : "#ccc",
          transition: "all 0.2s",
          opacity: hasRole ? 1 : 0.5
        }
      }, `${icons[r] || ""} ${labels[r] || r}`);
    })), verifyMessage && /* @__PURE__ */ React.createElement("div", { style: {
      padding: "12px 16px",
      marginBottom: "16px",
      borderRadius: "8px",
      fontSize: "14px",
      fontWeight: 500,
      background: verifyMessage.type === "success" ? "#e0f2e9" : verifyMessage.type === "info" ? "#e3f2fd" : "#fce4ec",
      color: verifyMessage.type === "success" ? "#1b6b5a" : verifyMessage.type === "info" ? "#1565c0" : "#c62828",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    } }, /* @__PURE__ */ React.createElement("span", null, verifyMessage.type === "success" ? "\u2705 " : "\u26A0\uFE0F ", verifyMessage.text), /* @__PURE__ */ React.createElement("button", { onClick: () => setVerifyMessage(null), style: { background: "none", border: "none", cursor: "pointer", fontSize: "16px", color: "inherit" } }, "\xD7")), currentUser && currentUser.emailVerified === false && !currentUser.isDemo && !verifyMessage && currentUser.account_approved && /* @__PURE__ */ React.createElement(EmailVerificationBanner, { userId: currentUser.id }), currentUser && !currentUser.account_approved && !currentUser.isDemo && !currentUser.is_admin ? /* @__PURE__ */ React.createElement("div", { style: { maxWidth: 500, margin: "60px auto", textAlign: "center", padding: 32 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 48, marginBottom: 16 } }, "\u23F3"), /* @__PURE__ */ React.createElement("h2", { style: { margin: "0 0 12px", fontSize: 24, fontWeight: 700, color: "#333" } }, "Account Pending Approval"), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 15, color: "#666", lineHeight: 1.6, margin: "0 0 20px" } }, "Thank you for signing up for InPlace! Your account is being reviewed by our team. You'll receive a notification once you've been approved to continue."), /* @__PURE__ */ React.createElement("div", { style: { background: "#e3f2fd", border: "1px solid #90caf9", borderRadius: 12, padding: 16, margin: "0 0 20px", textAlign: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 15, fontWeight: 600, color: "#1565c0", marginBottom: 4 } }, "Email verification"), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 13, color: "#1976d2", margin: 0, lineHeight: 1.5 } }, "Once your account is approved, you'll receive an email to verify your address and complete sign-up.")), /* @__PURE__ */ React.createElement("div", { style: { background: "#f0faf7", border: "1px solid #b2dfdb", borderRadius: 12, padding: 16, margin: "0 0 20px", textAlign: "left" } }, /* @__PURE__ */ React.createElement("p", { style: { fontSize: 14, color: "#444", lineHeight: 1.6, margin: "0 0 12px" } }, "If you're reading this message and you haven't spoken to admin about creating an account, thank you for your interest and we'll be in touch."), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 14, color: "#444", lineHeight: 1.6, margin: 0 } }, "If you have spoken to admin, your account creation will be approved shortly.")), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 13, color: "#999" } }, "If you have questions, contact us at support@yourinplace.com."), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => {
          AUTH_TOKEN = null;
          fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {
          });
          window.location.reload();
        },
        style: { marginTop: 20, padding: "10px 24px", background: "#f5f5f5", color: "#666", border: "1px solid #ddd", borderRadius: 8, fontSize: 14, cursor: "pointer" }
      },
      "Log Out"
    )) : renderPage()), /* @__PURE__ */ React.createElement("nav", { className: "bottom-nav" }, getBottomNavItems().map((item) => /* @__PURE__ */ React.createElement("button", { key: item.id, className: `bottom-nav-item ${currentPage === item.id ? "active" : ""}`, onClick: item.disabled ? void 0 : item.isKindred ? () => window.open(`/kindred?token=${encodeURIComponent(AUTH_TOKEN)}`, "_blank") : () => handlePageChange(item.id), style: { position: "relative", ...item.disabled ? { opacity: 0.35, cursor: "not-allowed" } : {}, ...item.isAccent && currentPage !== item.id && !item.disabled ? { color: "#e8724a" } : {}, ...item.isKindred ? { color: "#1A5276" } : {} } }, /* @__PURE__ */ React.createElement("span", { className: "bottom-nav-icon", style: item.isAccent && currentPage !== item.id ? { background: "#fff3ed", borderRadius: "50%", padding: "2px" } : void 0 }, item.icon), item.id === "messages" && unreadMsgCount > 0 && /* @__PURE__ */ React.createElement("span", { style: {
      position: "absolute",
      top: 2,
      right: "50%",
      marginRight: -18,
      background: "#e8724a",
      color: "#fff",
      borderRadius: 10,
      padding: "1px 5px",
      fontSize: 9,
      fontWeight: 700,
      minWidth: 16,
      textAlign: "center",
      lineHeight: "14px",
      boxShadow: "0 1px 3px rgba(0,0,0,0.3)"
    } }, unreadMsgCount > 99 ? "99+" : unreadMsgCount), item.id === "admin" && adminAlertCount > 0 && /* @__PURE__ */ React.createElement("span", { style: {
      position: "absolute",
      top: 2,
      right: "50%",
      marginRight: -18,
      background: "#dc2626",
      color: "#fff",
      borderRadius: 10,
      padding: "1px 5px",
      fontSize: 9,
      fontWeight: 700,
      minWidth: 16,
      textAlign: "center",
      lineHeight: "14px",
      boxShadow: "0 1px 3px rgba(0,0,0,0.3)"
    } }, adminAlertCount > 99 ? "99+" : adminAlertCount), /* @__PURE__ */ React.createElement("span", { className: "bottom-nav-label" }, item.label)))), showRequestCareModal && /* @__PURE__ */ React.createElement(RequestCareModal, { onClose: () => setShowRequestCareModal(false) }), (currentUser?.is_tester || currentUser?.isAdmin) && /* @__PURE__ */ React.createElement(FeedbackButton, { currentPage, userRole: currentUser?.role, currentUser }), /* @__PURE__ */ React.createElement(PWAInstallBanner, null), /* @__PURE__ */ React.createElement(OfflineIndicator, null));
    return /* @__PURE__ */ React.createElement("div", { className: `app-container ${isDemo ? "demo-mode-active" : ""}` }, isDemo && /* @__PURE__ */ React.createElement(DemoModeBanner, { currentUser, onSwitchAccount: handleDemoSwitch, onExit: handleExitDemo }), isDemo ? /* @__PURE__ */ React.createElement("div", { className: "demo-mode-body" }, appContent) : appContent);
  };
  ReactDOM.render(
    React.createElement(ToastProvider, null, React.createElement(App)),
    document.getElementById("root")
  );
})();
