const CaretakerHub = window.CaretakerHub = ({ onNeedsOnboarding, initialTab }) => {
  const { showToast } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [noProfile, setNoProfile] = useState(false);
  const [activeTab, setActiveTab] = useState(initialTab || 'schedule');
  const [visitLogSession, setVisitLogSession] = useState(null);
  const [logSummary, setLogSummary] = useState('');
  const [logMood, setLogMood] = useState('good');
  const [logNotes, setLogNotes] = useState('');
  const [logPhotos, setLogPhotos] = useState([]);
  const [photoPreviewUrls, setPhotoPreviewUrls] = useState([]);
  const [submittingLog, setSubmittingLog] = useState(false);
  const photoInputRef = useRef(null);
  // Check-in/check-out state
  const [checkInSession, setCheckInSession] = useState(null);
  const [checkInMood, setCheckInMood] = useState('');
  const [checkInNotes, setCheckInNotes] = useState(null);
  const [checkOutSession, setCheckOutSession] = useState(null);
  const [checkOutMood, setCheckOutMood] = useState('');
  const [checkOutTags, setCheckOutTags] = useState([]);
  const [checkOutCareFeedback, setCheckOutCareFeedback] = useState('');
  const [checkOutServiceFeedback, setCheckOutServiceFeedback] = useState('');
  const [checkOutSummary, setCheckOutSummary] = useState('');
  const [checkSubmitting, setCheckSubmitting] = useState(false);
  const [checkInLocation, setCheckInLocation] = useState(null);
  const [locationError, setLocationError] = useState(null);
  const avatarInputRef = useRef(null);
  const tabContentRef = useRef(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [highlightTab, setHighlightTab] = useState(false);
  const [jobSort, setJobSort] = useState('best_match');
  const calendarRef = useRef(null);
  const [claimingJobId, setClaimingJobId] = useState(null);
  const [cancellingJobId, setCancellingJobId] = useState(null);
  // Inline profile editing state (for onboarding)
  const [profileForm, setProfileForm] = useState({ bio: '', hourlyRate: '', rateDaytime: '', rateNighttime: '', rateOvernight: '', foodAllergies: '', medicalConditions: '' });
  const [profileSaving, setProfileSaving] = useState(false);
  // Work location editing state
  const [editingLocation, setEditingLocation] = useState(false);
  const [locCity, setLocCity] = useState('');
  const [locState, setLocState] = useState('');
  const [locZip, setLocZip] = useState('');
  const [locSaving, setLocSaving] = useState(false);
  // Earnings state
  const [completedSessions, setCompletedSessions] = useState([]);
  const [earningsLoading, setEarningsLoading] = useState(false);

  // Tiered rates state
  const [ratesDaytime, setRatesDaytime] = useState('');
  const [ratesNighttime, setRatesNighttime] = useState('');
  const [ratesOvernight, setRatesOvernight] = useState('');
  const [ratesSaving, setRatesSaving] = useState(false);
  const [ratesMsg, setRatesMsg] = useState('');

  // Stripe Connect state
  const [stripeStatus, setStripeStatus] = useState(null);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [stripeError, setStripeError] = useState(null);

  // Payout preference state
  const [payoutSpeed, setPayoutSpeed] = useState('standard');
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [payoutSaving, setPayoutSaving] = useState(false);
  const [bgCheckPaid, setBgCheckPaid] = useState(false);

  // Documents state
  const [documents, setDocuments] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docUploading, setDocUploading] = useState(null); // which doc type is uploading
  const docInputRef = useRef(null);
  const [pendingDocType, setPendingDocType] = useState(null);

  const handleDocUpload = async (file, docType) => {
    if (!file) return;
    setDocUploading(docType);
    try {
      const formData = new FormData();
      formData.append('documents', file);
      formData.append('types', JSON.stringify([docType]));
      formData.append('metadata', JSON.stringify([{}]));
      const token = window.AUTH_TOKEN || localStorage.getItem('auth_token');
      const res = await fetch('/api/caregiver-onboarding/documents', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) {
        showToast('Document uploaded!', 'success');
        fetchDocuments();
      } else {
        const d = await res.json().catch(() => ({}));
        showToast(d.error || 'Upload failed', 'error');
      }
    } catch (err) {
      console.error('Doc upload error:', err);
      showToast('Upload failed', 'error');
    }
    setDocUploading(null);
    setPendingDocType(null);
  };
  const [visitDetailSessionId, setVisitDetailSessionId] = useState(null);

  // Availability state
  const [availRules, setAvailRules] = useState([]);
  const [availLoading, setAvailLoading] = useState(false);
  const [availVisited, setAvailVisited] = useState(false);
  const [showAddRule, setShowAddRule] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [ruleForm, setRuleForm] = useState({
    type: 'available', dayOfWeek: 1, startTime: '08:00', endTime: '17:00',
    isRecurring: true, specificDate: '', note: '', selectedDays: [],
  });

  // Stoplight chart state (must be before early returns — React hook order rules)
  const [stoplightData, setStoplightData] = useState(null);
  const [editingStoplight, setEditingStoplight] = useState(false);
  const [stoplightForm, setStoplightForm] = useState({});

  // Reviews modal state
  const [showReviews, setShowReviews] = useState(false);
  const [reviews, setReviews] = useState([]);

  // Earnings summary state
  const [earningsThisMonth, setEarningsThisMonth] = useState(0);
  const [sessionsThisMonth, setSessionsThisMonth] = useState(0);

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayAbbr = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const fetchAvailability = async () => {
    setAvailLoading(true);
    try {
      const res = await apiFetch('/api/availability');
      if (res?.ok) {
        const d = await res.json();
        setAvailRules(d.rules || []);
      }
    } catch (err) { console.error('Availability fetch error:', err); }
    setAvailLoading(false);
  };

  const fetchDocuments = async () => {
    setDocsLoading(true);
    try {
      const res = await apiFetch('/api/caregiver-onboarding/documents');
      if (res?.ok) {
        const d = await res.json();
        setDocuments(d.documents || []);
      }
    } catch (err) { console.error('Documents fetch error:', err); }
    setDocsLoading(false);
  };

  const fetchPayoutPreference = async () => {
    setPayoutLoading(true);
    try {
      const res = await apiFetch('/api/payments/payout-preference');
      if (res?.ok) {
        const d = await res.json();
        setPayoutSpeed(d.speed || 'standard');
      }
    } catch (err) { console.error('Payout pref fetch error:', err); }
    setPayoutLoading(false);
  };

  const savePayoutPreference = async (speed) => {
    setPayoutSaving(true);
    try {
      const res = await apiFetch('/api/payments/payout-preference', {
        method: 'PUT',
        body: JSON.stringify({ speed }),
      });
      if (res?.ok) setPayoutSpeed(speed);
    } catch (err) { console.error('Payout pref save error:', err); }
    setPayoutSaving(false);
  };

  const fetchReviews = async () => {
    try {
      const res = await apiFetch('/api/caregivers/me/reviews');
      if (res?.ok) {
        const d = await res.json();
        setReviews(d.reviews || []);
      }
    } catch (err) { console.error('Reviews fetch error:', err); }
  };

  const handleSaveRule = async () => {
    try {
      if (editingRule) {
        // Editing: single day update
        const body = {
          dayOfWeek: parseInt(ruleForm.dayOfWeek),
          startTime: ruleForm.startTime,
          endTime: ruleForm.endTime,
          isRecurring: ruleForm.isRecurring,
          specificDate: ruleForm.isRecurring ? null : ruleForm.specificDate || null,
          type: ruleForm.type,
          note: ruleForm.note || null,
        };
        await apiFetch(`/api/availability/${editingRule.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else if (ruleForm.isRecurring && ruleForm.selectedDays && ruleForm.selectedDays.length > 0) {
        // New recurring rule with multiple days selected
        for (const dow of ruleForm.selectedDays) {
          const body = {
            dayOfWeek: parseInt(dow),
            startTime: ruleForm.startTime,
            endTime: ruleForm.endTime,
            isRecurring: true,
            specificDate: null,
            type: ruleForm.type,
            note: ruleForm.note || null,
          };
          await apiFetch('/api/availability', { method: 'POST', body: JSON.stringify(body) });
        }
      } else {
        // Single day (specific date or single recurring day)
        const body = {
          dayOfWeek: parseInt(ruleForm.dayOfWeek),
          startTime: ruleForm.startTime,
          endTime: ruleForm.endTime,
          isRecurring: ruleForm.isRecurring,
          specificDate: ruleForm.isRecurring ? null : ruleForm.specificDate || null,
          type: ruleForm.type,
          note: ruleForm.note || null,
        };
        await apiFetch('/api/availability', { method: 'POST', body: JSON.stringify(body) });
      }
      setShowAddRule(false);
      setEditingRule(null);
      setRuleForm({ type: 'available', dayOfWeek: 1, startTime: '08:00', endTime: '17:00', isRecurring: true, specificDate: '', note: '', selectedDays: [] });
      fetchAvailability();
    } catch (err) { console.error('Save rule error:', err); }
  };

  const handleDeleteRule = async (id) => {
    try {
      await apiFetch(`/api/availability/${id}`, { method: 'DELETE' });
      fetchAvailability();
    } catch (err) { console.error('Delete rule error:', err); }
  };

  const startEditRule = (rule) => {
    setEditingRule(rule);
    setRuleForm({
      type: rule.type, dayOfWeek: rule.dayOfWeek, startTime: rule.startTime, endTime: rule.endTime,
      isRecurring: rule.isRecurring, specificDate: rule.specificDate || '', note: rule.note || '',
    });
    setShowAddRule(true);
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await apiFetch('/api/dashboard');
        if (res?.ok) {
          const d = await res.json();
          setData(d);
          // If onboarding incomplete, fetch availability + stripe for accurate step tracking
          if (d.profile && !d.profile.onboardingComplete) {
            fetchAvailability();
            apiFetch('/api/payments/connect/status').then(r => r?.ok && r.json().then(s => setStripeStatus(s))).catch(() => {});
          }
        } else if (res?.status === 404) {
          setNoProfile(true);
        }
      } catch (err) {
        console.error('CaretakerHub fetch error:', err);
      }
      setLoading(false);
    };
    fetchData();

    // Detect Stripe Connect return — refresh status and switch to financials tab
    const hash = window.location.hash;
    if (hash.includes('payments-complete') || hash.includes('payments-refresh')) {
      setActiveTab('financials');
      (async () => {
        try {
          const sRes = await apiFetch('/api/payments/connect/status');
          if (sRes?.ok) setStripeStatus(await sRes.json());
        } catch {}
      })();
      // Clean up hash
      window.location.hash = '';
    }
  }, []);

  // Listen for new_job WebSocket events — refresh dashboard
  useEffect(() => {
    if (typeof onSocketEvent === 'function') {
      const cleanup = onSocketEvent('new_job', () => {
        // Re-fetch dashboard data to show new available jobs
        apiFetch('/api/dashboard').then(res => res?.ok && res.json().then(d => setData(d))).catch(() => {});
      });
      return cleanup;
    }
  }, []);

  // Mark availability as visited when the tab is opened
  useEffect(() => {
    if (activeTab === 'availability') setAvailVisited(true);
  }, [activeTab]);

  // Fetch completed sessions when earnings tab is active
  useEffect(() => {
    if (activeTab !== 'earnings') return;
    const fetchCompleted = async () => {
      setEarningsLoading(true);
      try {
        const now = new Date();
        const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const res = await apiFetch(`/api/sessions?status=completed&from=${monthStart}&limit=100`);
        if (res?.ok) {
          const d = await res.json();
          setCompletedSessions(d.sessions || []);
        }
      } catch (err) { console.error('Earnings fetch error:', err); }
      setEarningsLoading(false);
    };
    fetchCompleted();

    // Also check Stripe Connect status
    const checkStripe = async () => {
      try {
        const sRes = await apiFetch('/api/payments/connect/status');
        if (sRes?.ok) {
          const sData = await sRes.json();
          setStripeStatus(sData);
        }
      } catch (err) { /* Stripe not configured yet — that's ok */ }
    };
    checkStripe();
  }, [activeTab]);

  // Stripe Connect onboarding handler
  const handleStripeOnboard = async () => {
    setStripeLoading(true);
    setStripeError(null);
    try {
      const res = await apiFetch('/api/payments/connect/onboard', { method: 'POST' });
      if (res?.ok) {
        const d = await res.json();
        if (d.url) window.location.href = d.url;
      } else {
        const err = await res?.json().catch(() => ({}));
        setStripeError(err?.error || 'Failed to start Stripe onboarding. Please try again later.');
      }
    } catch (err) { setStripeError('Could not connect to payment service. Please try again later.'); }
    setStripeLoading(false);
  };

  // Open Stripe Express Dashboard
  const handleStripeDashboard = async () => {
    setStripeError(null);
    try {
      const res = await apiFetch('/api/payments/connect/dashboard');
      if (res?.ok) {
        const d = await res.json();
        if (d.url) window.open(d.url, '_blank');
      } else {
        setStripeError('Could not open Stripe dashboard. Please try again.');
      }
    } catch (err) { setStripeError('Could not open Stripe dashboard. Please try again.'); }
  };

  // Load stoplight from profile (must be before early returns — React hook order rules)
  useEffect(() => {
    if (!data?.profile?.care_stoplight) return;
    try {
      const parsed = typeof data.profile.care_stoplight === 'string' ? JSON.parse(data.profile.care_stoplight) : data.profile.care_stoplight;
      setStoplightData(parsed);
      setStoplightForm(parsed);
    } catch { /* ignore */ }
  }, [data?.profile?.care_stoplight]);

  // Fetch documents when documents tab is active
  useEffect(() => {
    if (activeTab === 'documents') fetchDocuments();
  }, [activeTab]);

  // Fetch payout preference when financials tab is active
  useEffect(() => {
    if (activeTab === 'financials') {
      fetchPayoutPreference();
      setBgCheckPaid(!!data?.profile?.background_check_paid || !!data?.profile?.isBackgroundChecked);
    }
  }, [activeTab]);

  // Init tiered rates from profile (must be before early returns — React hook order rules)
  useEffect(() => {
    if (data?.profile?.rateDaytime && !ratesDaytime) setRatesDaytime(data.profile.rateDaytime);
    if (data?.profile?.rateNighttime && !ratesNighttime) setRatesNighttime(data.profile.rateNighttime);
    if (data?.profile?.rateOvernight && !ratesOvernight) setRatesOvernight(data.profile.rateOvernight);
  }, [data?.profile?.rateDaytime, data?.profile?.rateNighttime, data?.profile?.rateOvernight]);

  // Auto-complete onboarding — fires when all 6 steps are done (must be before early returns)
  const _autoP = data?.profile || {};
  const _autoStepCount = [
    !!(_autoP.bio && (_autoP.rateDaytime || _autoP.hourlyRate)),
    availRules.length > 0,
    !!stoplightData,
    !!_autoP.avatar_url,
    stripeStatus?.status === 'active',
    !!_autoP.background_check_paid || !!_autoP.isBackgroundChecked,
  ].filter(Boolean).length;

  useEffect(() => {
    if (!data?.profile || data.profile.onboardingComplete) return;
    if (_autoStepCount < 6) return;
    apiFetch('/api/caregivers/mark-onboarding-complete', { method: 'PUT' })
      .then(r => r?.ok ? r.json() : null)
      .then(res => {
        if (res && res.onboarding_complete) {
          showToast('Onboarding complete! Your dashboard is now unlocked.', 'success');
          apiFetch('/api/dashboard').then(r2 => r2?.ok && r2.json().then(d => setData(d))).catch(() => {});
        }
      })
      .catch(() => {});
  }, [_autoStepCount]);

  // Compute earnings and sessions this month
  useEffect(() => {
    if (!completedSessions || completedSessions.length === 0) {
      setEarningsThisMonth(0);
      setSessionsThisMonth(0);
      return;
    }
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthSessions = completedSessions.filter(s => {
      const sessionDate = s.session_date ? new Date(s.session_date) : null;
      return sessionDate && sessionDate >= thisMonthStart;
    });
    const earnings = monthSessions.reduce((sum, s) => sum + (s.actual_cost || s.estimated_cost || 0), 0);
    setEarningsThisMonth(earnings);
    setSessionsThisMonth(monthSessions.length);
  }, [completedSessions]);

  const handlePhotoSelect = (e) => {
    const files = Array.from(e.target.files || []).slice(0, 5);
    setLogPhotos(prev => [...prev, ...files].slice(0, 5));
    // Generate preview URLs
    const newUrls = files.map(f => URL.createObjectURL(f));
    setPhotoPreviewUrls(prev => [...prev, ...newUrls].slice(0, 5));
  };

  const removePhoto = (idx) => {
    setLogPhotos(prev => prev.filter((_, i) => i !== idx));
    setPhotoPreviewUrls(prev => {
      URL.revokeObjectURL(prev[idx]);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const handleSubmitVisitLog = async () => {
    if (!visitLogSession || !logSummary.trim()) return;
    setSubmittingLog(true);
    try {
      const res = await apiFetch('/api/activity/visit-log', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: visitLogSession.id,
          summary: logSummary,
          moodRating: logMood,
          notes: logNotes || null,
        }),
      });
      if (res?.ok) {
        const logData = await res.json();
        // Upload photos if any
        if (logPhotos.length > 0 && logData.visitLog?.id) {
          const formData = new FormData();
          logPhotos.forEach(f => formData.append('photos', f));
          const token = localStorage.getItem('auth_token');
          await fetch(`${API_BASE}/api/photos/visit/${logData.visitLog.id}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData,
          });
        }
        setVisitLogSession(null);
        setLogSummary('');
        setLogMood('good');
        setLogNotes('');
        setLogPhotos([]);
        setPhotoPreviewUrls([]);
        // Refresh data
        const refreshRes = await apiFetch('/api/dashboard');
        if (refreshRes?.ok) setData(await refreshRes.json());
      }
    } catch (err) {
      console.error('Visit log error:', err);
    }
    setSubmittingLog(false);
  };

  if (loading) return <LoadingSpinner text="Loading your dashboard..." />;
  if (noProfile || !data) return (
    <div style={{ maxWidth: '480px', margin: '60px auto', textAlign: 'center', padding: '40px 24px' }}>
      <div style={{ fontSize: '56px', marginBottom: '16px' }}>👋</div>
      <h2 style={{ margin: '0 0 12px', color: '#333', fontSize: '22px' }}>Welcome to InPlace!</h2>
      <p style={{ color: '#666', fontSize: '15px', lineHeight: '1.6', margin: '0 0 24px' }}>
        {noProfile
          ? "It looks like your caregiver profile isn't set up yet. Complete your onboarding to start receiving care requests and connecting with families."
          : "We couldn't load your dashboard. Please try refreshing the page."}
      </p>
      {noProfile && onNeedsOnboarding && (
        <button onClick={onNeedsOnboarding} style={{
          padding: '14px 32px', background: '#1b6b5a', color: '#fff', border: 'none',
          borderRadius: '10px', fontSize: '16px', fontWeight: 600, cursor: 'pointer',
        }}>Complete Your Profile</button>
      )}
      {!noProfile && (
        <button onClick={() => window.location.reload()} style={{
          padding: '12px 24px', background: '#1b6b5a', color: '#fff', border: 'none',
          borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
        }}>Refresh Page</button>
      )}
    </div>
  );

  const flyMoney = (amount, btnEl) => {
    if (!btnEl) return;
    const rect = btnEl.getBoundingClientRect();
    const el = document.createElement('div');
    el.textContent = `$${amount}`;
    Object.assign(el.style, {
      position: 'fixed',
      left: '0px',
      top: `${rect.top + rect.height / 2 - 16}px`,
      fontSize: '28px',
      fontWeight: '900',
      color: '#1b6b5a',
      zIndex: '9999',
      pointerEvents: 'none',
      opacity: '0',
      transform: 'scale(0.5)',
      transition: 'all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
      textShadow: '0 2px 8px rgba(27,107,90,0.3)',
    });
    document.body.appendChild(el);
    requestAnimationFrame(() => {
      Object.assign(el.style, {
        left: `${rect.left + rect.width / 2 - 30}px`,
        opacity: '1',
        transform: 'scale(1.2)',
      });
      setTimeout(() => {
        Object.assign(el.style, {
          transform: 'scale(1) translateY(-20px)',
          opacity: '0',
        });
        setTimeout(() => el.remove(), 500);
      }, 700);
    });
  };

  const handleClaimJob = async (jobId, e, amount) => {
    const btnEl = e?.currentTarget || null;
    setClaimingJobId(jobId);
    try {
      const res = await apiFetch(`/api/sessions/${jobId}/claim`, { method: 'PUT' });
      if (res?.ok) {
        if (amount > 0 && btnEl) flyMoney(Math.round(amount), btnEl);
        showToast && showToast('Job accepted!', 'success');
        // Refresh dashboard
        const dashRes = await apiFetch('/api/dashboard');
        if (dashRes?.ok) setData(await dashRes.json());
      } else {
        const err = await res.json().catch(() => ({}));
        showToast ? showToast(err.error || 'Failed to accept', 'error') : alert(err.error || 'Failed to accept');
      }
    } catch (err) {
      console.error('Claim job error:', err);
    }
    setClaimingJobId(null);
  };

  const handleCancelJob = async (sessionId, recipName) => {
    if (!confirm(`Cancel your session with ${recipName}? The job will go back to the open pool for other caregivers.`)) return;
    setCancellingJobId(sessionId);
    try {
      const res = await apiFetch(`/api/sessions/${sessionId}/cancel`, {
        method: 'PUT',
        body: JSON.stringify({ reason: 'Caregiver cancelled from dashboard' }),
      });
      if (res?.ok) {
        showToast && showToast('Session cancelled', 'success');
        const dashRes = await apiFetch('/api/dashboard');
        if (dashRes?.ok) setData(await dashRes.json());
      } else {
        const err = await res.json().catch(() => ({}));
        showToast ? showToast(err.error || 'Failed to cancel', 'error') : alert(err.error || 'Failed to cancel');
      }
    } catch (err) {
      console.error('Cancel job error:', err);
    }
    setCancellingJobId(null);
  };

  const profile = data.profile || {};
  const assignments = data.assignments || [];
  const sessions = data.upcomingSessions || [];
  const openJobs = data.openJobs || [];
  const dataReviews = data.reviews || [];
  const stats = data.stats || {};

  // Find sessions ready for check-in (confirmed, today, within 15 min of start or past start)
  // All times are care-location times — use TimezoneHelper
  const readyToCheckIn = sessions.filter(s => {
    if (s.status !== 'confirmed') return false;
    const tz = s.timezone || TimezoneHelper.DEFAULT_TZ;
    const etNow = TimezoneHelper.getNow(tz);
    const etDate = TimezoneHelper.getToday(tz);
    const sessionDate = (s.date || s.scheduled_date || '').split('T')[0];
    if (sessionDate !== etDate) return false;
    const sTime = s.time || s.scheduled_time;
    if (!sTime) return false;
    const sessionStartET = TimezoneHelper.buildDateTime(sessionDate, sTime, tz);
    const minsUntil = (sessionStartET - etNow) / 60000;
    return minsUntil <= 60 || profile.earlyCheckInAllowed;
  });

  // Split sessions into <24hr ("up next") vs >24hr ("scheduled")
  const upNextSessions = sessions.filter(s => {
    if (s.status === 'completed') return false;
    if (s.status === 'in_progress') return true;
    const tz = s.timezone || TimezoneHelper.DEFAULT_TZ;
    const now = TimezoneHelper.getNow(tz);
    const sDate = (s.date || s.scheduled_date || '').split('T')[0];
    const sessionDT = TimezoneHelper.buildDateTime(sDate, s.time || s.scheduled_time || '00:00', tz);
    const minsUntil = (sessionDT - now) / 60000;
    return minsUntil < 24 * 60;
  });

  const scheduledSessions = sessions.filter(s => {
    if (s.status === 'completed' || s.status === 'in_progress') return false;
    const tz = s.timezone || TimezoneHelper.DEFAULT_TZ;
    const now = TimezoneHelper.getNow(tz);
    const sDate = (s.date || s.scheduled_date || '').split('T')[0];
    const sessionDT = TimezoneHelper.buildDateTime(sDate, s.time || s.scheduled_time || '00:00', tz);
    const minsUntil = (sessionDT - now) / 60000;
    return minsUntil >= 24 * 60;
  });

  const CARE_TASKS = [
    'Bathing / Showering', 'Toileting', 'Dressing', 'Feeding / Meal Assistance',
    'Medication Reminders', 'Mobility / Transfer', 'Light Housekeeping', 'Laundry',
    'Meal Preparation', 'Grocery Shopping', 'Transportation / Errands',
    'Companionship', 'Exercise / Physical Therapy', 'Wound Care',
    'Dementia / Memory Care', 'Hospice / End-of-Life',
  ];


  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    try {
      // Resize image to max 400px and convert to JPEG
      // Use createImageBitmap first (handles HEIC, WEBP, AVIF), fall back to Image element
      let bitmap;
      try {
        bitmap = await createImageBitmap(file);
      } catch {
        bitmap = await new Promise((resolve, reject) => {
          const img = new Image();
          const url = URL.createObjectURL(file);
          img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
          img.onerror = () => {
            URL.revokeObjectURL(url);
            const name = file.name?.toLowerCase() || '';
            if (name.endsWith('.heic') || name.endsWith('.heif')) {
              reject(new Error('HEIC photos are not supported by your browser. Please convert to JPG first, or use Safari.'));
            } else {
              reject(new Error('Could not load this image. Try a JPG or PNG file.'));
            }
          };
          img.src = url;
        });
      }
      const canvas = document.createElement('canvas');
      const maxDim = 400;
      let w = bitmap.width, h = bitmap.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
        else { w = Math.round(w * maxDim / h); h = maxDim; }
      }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
      if (bitmap.close) bitmap.close();
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

      const res = await apiFetch('/api/auth/me/photo', {
        method: 'PUT',
        body: JSON.stringify({ photo: dataUrl }),
      });
      if (res?.ok) {
        // Update local state to reflect the new avatar
        setData(prev => prev ? { ...prev, profile: { ...prev.profile, avatar_url: dataUrl } } : prev);
        showToast('Profile photo updated!', 'success');
      } else {
        showToast('Failed to upload photo', 'error');
      }
    } catch (err) { console.error('Avatar upload error:', err); showToast(err.message || 'Failed to upload photo — try a JPG or PNG', 'error'); }
    setUploadingAvatar(false);
    if (avatarInputRef.current) avatarInputRef.current.value = '';
  };

  const saveStoplight = async () => {
    try {
      await apiFetch('/api/caregivers/profile', {
        method: 'POST',
        body: JSON.stringify({ hourlyRate: profile.hourlyRate || 25, careStoplight: stoplightForm }),
      });
      setStoplightData(stoplightForm);
      setEditingStoplight(false);
    } catch (err) { console.error('Stoplight save error:', err); }
  };

  // Navigate to a tab and scroll the tab content into view with a highlight pulse
  const goToStep = (tabId) => {
    setActiveTab(tabId);
    setHighlightTab(true);
    setTimeout(() => {
      if (tabContentRef.current) {
        tabContentRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
    setTimeout(() => setHighlightTab(false), 2000);
  };

  // Save inline profile (bio, rate, allergies, medical) during onboarding
  const saveOnboardingProfile = async () => {
    setProfileSaving(true);
    try {
      const dayRate = parseFloat(profileForm.rateDaytime) || parseFloat(profileForm.hourlyRate) || 25;
      await apiFetch('/api/caregivers/profile', {
        method: 'POST',
        body: JSON.stringify({ bio: profileForm.bio, hourlyRate: dayRate }),
      });
      // Save tiered rates if any were entered
      if (profileForm.rateDaytime || profileForm.rateNighttime || profileForm.rateOvernight) {
        await apiFetch('/api/caregivers/rates', {
          method: 'PUT',
          body: JSON.stringify({
            rateDaytime: parseFloat(profileForm.rateDaytime) || dayRate,
            rateNighttime: parseFloat(profileForm.rateNighttime) || dayRate,
            rateOvernight: parseFloat(profileForm.rateOvernight) || dayRate,
          }),
        });
      }
      await apiFetch('/api/auth/me', {
        method: 'PUT',
        body: JSON.stringify({ foodAllergies: profileForm.foodAllergies, medicalConditions: profileForm.medicalConditions }),
      });
      const res = await apiFetch('/api/dashboard');
      if (res?.ok) { const d = await res.json(); setData(d); }
      showToast('Profile saved!', 'success');
      setActiveTab('schedule');
    } catch (err) { console.error('Profile save error:', err); showToast('Failed to save profile', 'error'); }
    setProfileSaving(false);
  };

  // Save work location (city/state/zip)
  const saveWorkLocation = async () => {
    if (!locCity.trim() || !locState.trim() || !locZip.trim()) {
      showToast('Please fill in city, state, and zip', 'error'); return;
    }
    setLocSaving(true);
    try {
      await apiFetch('/api/caregivers/profile', {
        method: 'POST',
        body: JSON.stringify({ city: locCity.trim(), state: locState.trim(), zip: locZip.trim() }),
      });
      const res = await apiFetch('/api/dashboard');
      if (res?.ok) { const d = await res.json(); setData(d); }
      showToast('Work location updated!', 'success');
      setEditingLocation(false);
    } catch (err) { console.error('Location save error:', err); showToast('Failed to update location', 'error'); }
    setLocSaving(false);
  };

  // First Steps checklist
  const firstSteps = [
    { id: 'profile', label: 'Complete your profile', done: !!(profile.bio && (profile.rateDaytime || profile.hourlyRate)) },
    { id: 'availability', label: 'Set your availability', done: availRules.length > 0 || availVisited },
    { id: 'stoplight', label: 'Set your care preferences (stoplight)', done: !!stoplightData },
    { id: 'photo', label: 'Upload a profile photo', done: !!profile.avatar_url },
    { id: 'payments', label: 'Set up payments (Stripe)', done: stripeStatus?.status === 'active' },
    { id: 'bgcheck', label: 'Pay for background check ($30)', done: !!profile.background_check_paid || !!profile.isBackgroundChecked },
  ];
  const firstStepsDone = firstSteps.filter(s => s.done).length;
  // If admin marked available for jobs, skip all onboarding gates entirely
  const showFirstSteps = !profile.isAvailable && firstStepsDone < firstSteps.length;
  const onboardingGated = !profile.isAvailable && !profile.onboardingComplete && showFirstSteps;
  // When user clicks a step, they land on a tab where they can complete it — lift the blur
  const stepTabs = ['availability', 'preferences', 'financials', 'profile'];
  const isWorkingOnStep = onboardingGated && stepTabs.includes(activeTab);
  const shouldBlur = onboardingGated && !isWorkingOnStep;

  // Average hourly rate from completed sessions
  const totalHours = completedSessions.reduce((sum, s) => sum + (s.duration_hours || 0), 0);
  const totalEarned = completedSessions.reduce((sum, s) => sum + (s.actual_cost || s.estimated_cost || 0), 0);
  const avgHourlyRate = totalHours > 0 ? (totalEarned / totalHours).toFixed(0) : (profile.hourlyRate || '--');

  return (
    <div>
      {/* Push notification prompt — shows if not yet enabled */}
      {typeof NotificationPrompt !== 'undefined' && React.createElement(NotificationPrompt, null)}
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 className="greeting" style={{ marginBottom: '4px' }}>Welcome, {(profile.name || 'Caregiver').split(' ')[0]}!</h1>
          <div style={{ color: '#666', fontSize: '14px' }}>
            {editingLocation ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
                <input type="text" value={locCity} onChange={(e) => setLocCity(e.target.value)} placeholder="City" style={{ width: '120px', padding: '4px 8px', border: '1px solid #ccc', borderRadius: '6px', fontSize: '13px' }} />
                <select value={locState} onChange={(e) => setLocState(e.target.value)} style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: '6px', fontSize: '13px' }}>
                  <option value="">State</option>
                  {['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <input type="text" value={locZip} onChange={(e) => setLocZip(e.target.value)} placeholder="Zip" maxLength={10} style={{ width: '80px', padding: '4px 8px', border: '1px solid #ccc', borderRadius: '6px', fontSize: '13px' }} />
                <button onClick={saveWorkLocation} disabled={locSaving} style={{ padding: '4px 10px', background: '#1b6b5a', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', opacity: locSaving ? 0.6 : 1 }}>{locSaving ? '...' : 'Save'}</button>
                <button onClick={() => setEditingLocation(false)} style={{ padding: '4px 8px', background: 'none', border: '1px solid #ccc', borderRadius: '6px', fontSize: '12px', color: '#666', cursor: 'pointer' }}>Cancel</button>
              </div>
            ) : (profile.city && profile.state) ? (
              <span>
                <span onClick={() => { setLocCity(profile.city || ''); setLocState(profile.state || ''); setLocZip(profile.zip || ''); setEditingLocation(true); }} style={{ cursor: 'pointer', borderBottom: '1px dashed #999' }} title="Click to edit work location">
                  {profile.city}, {profile.state}{profile.zip ? ` ${profile.zip}` : ''}
                </span>
                {profile.specialties?.length > 0 && <span> &bull; {profile.specialties.join(', ')}</span>}
              </span>
            ) : (
              <span>
                <span onClick={() => { setLocCity(''); setLocState(''); setLocZip(''); setEditingLocation(true); }} style={{ cursor: 'pointer', color: '#e8724a', fontWeight: 600, borderBottom: '1px dashed #e8724a' }}>
                  + Set your work location
                </span>
                {profile.specialties?.length > 0 && <span> &bull; {profile.specialties.join(', ')}</span>}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            padding: '6px 14px',
            background: profile.isAvailable ? '#e8f5e9' : '#fce4ec',
            color: profile.isAvailable ? '#2e7d32' : '#c62828',
            borderRadius: '20px', fontSize: '13px', fontWeight: 600,
          }}>
            {profile.isAvailable ? 'Available' : 'Unavailable'}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div onClick={() => { setShowReviews(true); fetchReviews(); }} style={{ fontSize: '20px', fontWeight: 700, color: '#1b6b5a', cursor: 'pointer' }} title="View reviews">⭐ {profile.rating || '—'}</div>
            <div style={{ fontSize: '11px', color: '#999' }}>{profile.reviewCount || 0} reviews</div>
          </div>
        </div>
      </div>

      {/* Status Banner — only shows when there's an actionable status (skip if admin overrode to available) */}
      {!profile.isAvailable && (() => {
        const onboardingDone = profile.onboardingComplete;
        const checkrStatus = profile.checkrStatus;
        if (!onboardingDone) return (
          <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid #e8724a', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 24 }}>⏳</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#333' }}>Getting Started</div>
              <div style={{ fontSize: 13, color: '#555', marginTop: 2 }}>Complete your profile to start receiving care requests.</div>
            </div>
          </div>
        );
        if (checkrStatus === 'pending') return (
          <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid #f59e0b', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 24 }}>🔄</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#333' }}>Background Check</div>
              <div style={{ fontSize: 13, color: '#555', marginTop: 2 }}>Your background check is in progress. You'll be notified once it clears.</div>
            </div>
          </div>
        );
        return null;
      })()}

      {/* UP NEXT — any session <24 hours away + in_progress, with check-in/out */}
      {upNextSessions.length > 0 && (() => {
        const readySet = new Set(readyToCheckIn.map(s => s.id));
        const sorted = [...upNextSessions].sort((a, b) => {
          if (a.status === 'in_progress' && b.status !== 'in_progress') return -1;
          if (b.status === 'in_progress' && a.status !== 'in_progress') return 1;
          const aKey = (a.date || a.scheduled_date || '') + (a.time || a.scheduled_time || '');
          const bKey = (b.date || b.scheduled_date || '') + (b.time || b.scheduled_time || '');
          return aKey.localeCompare(bKey);
        });

        return (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Up Next</div>
            {sorted.map(s => {
              const isReady = readySet.has(s.id);
              const isActive = s.status === 'in_progress';
              const sDate = (s.date || s.scheduled_date || '').split('T')[0];
              const tz = s.timezone || TimezoneHelper.DEFAULT_TZ;
              const etNow = TimezoneHelper.getNow(tz);
              const sessionStartET = TimezoneHelper.buildDateTime(sDate, s.time || s.scheduled_time || '00:00', tz);
              const minsUntil = (sessionStartET - etNow) / 60000;
              const dayLabel = TimezoneHelper.getDateLabel(sDate, tz);
              const timeLabel = TimezoneHelper.formatTime(s.time || s.scheduled_time);
              const duration = s.durationHours || s.duration_hours;
              const svcType = s.serviceType || s.service_type;
              const recipName = s.recipientName || s.recipient_name || 'Session';
              const loc = s.location || (s.location_address ? `${s.location_address}, ${s.location_city || ''}` : s.location_city || '');
              const noAddress = !s.hasAddress && s.status === 'confirmed';

              // Countdown label
              const countdownLabel = (() => {
                if (isReady || isActive) return null;
                if (minsUntil <= 0) return null;
                const hours = Math.floor(minsUntil / 60);
                const mins = Math.round(minsUntil % 60);
                if (hours > 0) return `${hours}h ${mins}m until check-in`;
                return `${Math.ceil(minsUntil)} min until check-in`;
              })();

              // Styling
              const borderColor = isActive ? '#f57f17' : isReady ? '#e8724a' : noAddress ? '#dc2626' : '#1b6b5a';
              const borderWidth = isActive || isReady ? 3 : 2;
              const bgStyle = isActive ? 'linear-gradient(135deg, #fffde7 0%, #fff 100%)' : isReady ? 'linear-gradient(135deg, #fff3e0 0%, #fff 100%)' : '#fff';
              const shadow = (isReady || isActive) ? '0 2px 12px rgba(232, 114, 74, 0.15)' : '0 1px 4px rgba(0,0,0,0.06)';

              return (
                <div key={s.id} className="card" onClick={(e) => {
                  if (e.target.tagName === 'BUTTON') return;
                  if (s.id) setVisitDetailSessionId(s.id);
                }} style={{
                  marginBottom: 10, padding: '16px 18px', cursor: 'pointer',
                  border: `${borderWidth}px solid ${borderColor}`,
                  borderRadius: 12,
                  background: bgStyle,
                  boxShadow: shadow,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '180px' }}>
                      {isActive && <div style={{ fontSize: 11, fontWeight: 700, color: '#f57f17', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>In Progress Now</div>}
                      {isReady && !isActive && <div style={{ fontSize: 11, fontWeight: 700, color: '#e8724a', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>Ready to Check In</div>}
                      {countdownLabel && <div style={{ fontSize: 11, fontWeight: 600, color: '#e8724a', marginBottom: 3 }}>{countdownLabel}</div>}
                      <div style={{ fontSize: 15, fontWeight: 600, color: '#333' }}>{recipName}</div>
                      <div style={{ fontSize: 13, color: '#666', marginTop: 2 }}>
                        {dayLabel}{timeLabel ? ` at ${timeLabel}` : ''}{duration ? ` \u2022 ${duration}hr` : ''}{svcType ? ` \u2022 ${formatServiceType(svcType)}` : ''}
                      </div>
                      {loc ? (
                        <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{'\uD83D\uDCCD'} {loc}</div>
                      ) : noAddress ? (
                        <div style={{ fontSize: 12, color: '#dc2626', marginTop: 2, fontWeight: 600 }}>{'\u26A0\uFE0F'} No care address on file</div>
                      ) : null}
                      {s.specialInstructions && <div style={{ fontSize: 12, color: '#555', marginTop: 4, fontStyle: 'italic' }}>{s.specialInstructions}</div>}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                      {(s.caregiverPayout > 0 || s.estimatedCost > 0) && (
                        <div style={{ fontSize: 20, fontWeight: 800, color: '#1b6b5a' }}>
                          ${Math.round(s.caregiverPayout || parseFloat(s.estimatedCost) || 0)}
                        </div>
                      )}
                      {isActive && (
                        <button onClick={() => {
                          setCheckOutMood('');
                          setCheckOutTags([]);
                          setCheckOutCareFeedback('');
                          setCheckOutServiceFeedback('');
                          setCheckOutSummary('');
                          setCheckOutSession(s);
                        }} style={{
                          padding: '10px 22px', background: '#c62828', color: '#fff', border: 'none',
                          borderRadius: '10px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                          boxShadow: '0 2px 8px rgba(198,40,40,0.3)', whiteSpace: 'nowrap',
                        }}>Check Out</button>
                      )}
                      {isReady && !isActive && (
                        <button onClick={() => {
                          setCheckInMood('');
                          setCheckInNotes(null);
                          setCheckInLocation(null);
                          setLocationError(null);
                          if (navigator.geolocation) {
                            navigator.geolocation.getCurrentPosition(
                              (pos) => setCheckInLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
                              (err) => { console.warn('Geolocation error:', err.message); setLocationError(err.message); },
                              { timeout: 8000, enableHighAccuracy: false }
                            );
                          } else {
                            setLocationError('Geolocation not supported');
                          }
                          setCheckInSession(s);
                        }} style={{
                          padding: '10px 22px', background: '#e8724a', color: '#fff', border: 'none',
                          borderRadius: '10px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                          boxShadow: '0 2px 8px rgba(232,114,74,0.3)', whiteSpace: 'nowrap',
                        }}>Check In Now</button>
                      )}
                      {!isReady && !isActive && (
                        <span style={{
                          padding: '5px 12px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                          background: s.status === 'confirmed' ? '#e8f5e9' : '#fff3e0',
                          color: s.status === 'confirmed' ? '#2e7d32' : '#e65100',
                          textTransform: 'capitalize',
                        }}>{s.status}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Earnings Summary Tile */}
      {profile && (
        <div className="card" style={{ padding: '16px 20px', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>This Month</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#1b6b5a', marginTop: 2 }}>
                ${parseFloat(earningsThisMonth || data.stats?.monthlyEarnings || 0).toFixed(2)}
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#888' }}>Sessions</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#333' }}>{sessionsThisMonth || data.stats?.completedThisMonth || 0}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#888' }}>Rating</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#f59e0b' }}>{'\u2B50'} {profile.rating || '\u2014'}</div>
            </div>
          </div>
        </div>
      )}

      {/* Find Work + Available Jobs — merged tile */}
      {(() => {
        const sortedJobs = [...openJobs].sort((a, b) => {
          // Direct offers always on top
          const aOffer = a.offeredToCaregiverId ? 1 : 0;
          const bOffer = b.offeredToCaregiverId ? 1 : 0;
          if (aOffer !== bOffer) return bOffer - aOffer;
          if (jobSort === 'highest_pay') {
            const aRate = parseFloat(a.proposedRate) || 0;
            const bRate = parseFloat(b.proposedRate) || 0;
            return bRate - aRate;
          }
          if (jobSort === 'best_match') {
            const aScore = a.matchScore || 0;
            const bScore = b.matchScore || 0;
            if (aScore !== bScore) return bScore - aScore;
          }
          const aKey = (a.date || '') + (a.time || '');
          const bKey = (b.date || '') + (b.time || '');
          return aKey.localeCompare(bKey);
        });

        return (
          <div style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 20, border: '1px solid #d4edda', background: '#fff' }}>
            {/* Green header */}
            <div style={{ background: 'linear-gradient(135deg, #1b6b5a 0%, #24897a 100%)', color: '#fff', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
              onClick={() => window.__navigateTo && window.__navigateTo('find-work')}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 17 }}>🔍 Find Work</div>
                <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>{openJobs.length} open job{openJobs.length !== 1 ? 's' : ''} near you</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <select value={jobSort} onChange={(e) => { e.stopPropagation(); setJobSort(e.target.value); }}
                  onClick={(e) => e.stopPropagation()}
                  style={{ fontSize: 11, padding: '3px 6px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.15)', color: '#fff', cursor: 'pointer' }}>
                  <option value="best_match" style={{ color: '#333' }}>Best Match</option>
                  <option value="soonest" style={{ color: '#333' }}>Soonest</option>
                  <option value="highest_pay" style={{ color: '#333' }}>Highest Pay</option>
                </select>
                <span style={{ fontSize: 22, opacity: 0.7 }}>→</span>
              </div>
            </div>
            {/* Job list */}
            {sortedJobs.length > 0 && (
              <div style={{ padding: '4px 0' }}>
                {sortedJobs.map(job => {
                  const sDate = (job.date || '').split('T')[0];
                  const dateParts = sDate ? sDate.split('-').map(Number) : [];
                  const dateObj = dateParts.length === 3 ? new Date(dateParts[0], dateParts[1] - 1, dateParts[2]) : null;
                  const now = new Date();
                  const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                  const dayDiff = dateObj ? Math.round((dateObj - todayLocal) / 86400000) : null;
                  const dayLabel = dayDiff === 0 ? 'Today' : dayDiff === 1 ? 'Tomorrow' : dateObj ? dateObj.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '';
                  const tParts = (job.time || '').split(':').map(Number);
                  const timeLabel = tParts.length >= 2 ? `${tParts[0] > 12 ? tParts[0] - 12 : tParts[0] || 12}:${String(tParts[1]).padStart(2, '0')} ${tParts[0] >= 12 ? 'PM' : 'AM'}` : '';

                  const surcharge = parseFloat(job.shortNoticeSurcharge) || 0;
                  const hasBonus = surcharge > 0;
                  const proposedRate = parseFloat(job.proposedRate) || 0;
                  const hours = parseFloat(job.durationHours) || 1;
                  const baseCost = parseFloat(job.estimatedCost) || 0;
                  const basePerHour = proposedRate > 0 ? proposedRate : (hours > 0 ? Math.round(baseCost / hours) : 0);
                  const effectiveTotal = proposedRate > 0 ? (proposedRate * hours) + surcharge : baseCost;
                  const effectivePerHour = hours > 0 ? Math.round(effectiveTotal / hours * 100) / 100 : 0;

                  const isDirectOffer = !!job.offeredToCaregiverId;

                  return (
                    <div key={job.id} style={{
                      marginBottom: 8, padding: '14px 16px',
                      background: isDirectOffer ? 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)' : job.hasConflict ? '#fffbf0' : '#fff',
                      borderRadius: 0,
                      border: isDirectOffer ? '2px solid #7c3aed' : job.hasConflict ? '1px solid #ffd89b' : (!job.hasConflict && job.matchQuality === 'great') ? '2px solid #1b6b5a' : hasBonus ? '1px solid #e8724a' : '1px solid #f0f0f0',
                      borderTop: isDirectOffer ? '2px solid #7c3aed' : job.hasConflict ? '1px solid #ffd89b' : '1px solid #f0f0f0',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
                    }}>
                      <div style={{ flex: 1, minWidth: '180px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                          {isDirectOffer && (
                            <span style={{ background: '#7c3aed', color: '#fff', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700 }}>{'\u2728'} JUST FOR YOU</span>
                          )}
                          {hasBonus && (
                            <span style={{ background: '#e8724a', color: '#fff', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700 }}>BONUS PAY</span>
                          )}
                          {job.matchQuality === 'great' && !job.hasConflict && !isDirectOffer && (
                            <span style={{ background: '#1b6b5a', color: '#fff', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700 }}>GREAT MATCH</span>
                          )}
                          {job.hasConflict ? (
                            <span style={{ background: '#ffd89b', color: '#c86b1f', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>{'\u26A0'} Overlaps {job.conflictWith}</span>
                          ) : (
                            <span onClick={(e) => { e.stopPropagation(); if (calendarRef.current) calendarRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                              style={{ background: '#c8e6c9', color: '#2e7d32', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>{'\u2713'} No Conflicts</span>
                          )}
                          {job.distanceMiles !== null && job.distanceMiles !== undefined && (
                            <span style={{ fontSize: 11, color: '#888' }}>{job.distanceMiles} mi</span>
                          )}
                          {hasBonus && basePerHour > 0 ? (
                            <span style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ textDecoration: 'line-through', color: '#999', fontSize: 12 }}>${basePerHour}/hr</span>
                              <span style={{ color: '#1b6b5a', fontWeight: 700, fontSize: 14 }}>${effectivePerHour}/hr</span>
                            </span>
                          ) : basePerHour > 0 ? (
                            <span style={{ background: '#e8f5e9', color: '#1b6b5a', padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 700 }}>${basePerHour}/hr</span>
                          ) : null}
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: '#333' }}>{formatServiceType(job.serviceType)}</div>
                        <div style={{ fontSize: 13, color: '#666', marginTop: 2 }}>
                          {dayLabel}{timeLabel ? ` at ${timeLabel}` : ''}{job.durationHours ? ` \u2022 ${job.durationHours}hr` : ''}
                          {effectiveTotal > 0 && <React.Fragment><span> {'\u2022'} </span><span style={{ fontWeight: 800, color: '#1b6b5a', fontSize: 20 }}>${effectiveTotal.toFixed(0)}</span></React.Fragment>}
                        </div>
                        {job.recipientCity && <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{'\uD83D\uDCCD'} {job.recipientCity}</div>}
                        {job.familyName && <div style={{ fontSize: 12, color: '#888', marginTop: 1 }}>Requested by {job.familyName}</div>}
                      </div>
                      <button onClick={(e) => handleClaimJob(job.id, e, effectiveTotal)} disabled={claimingJobId === job.id}
                        style={{
                          padding: '10px 20px', background: claimingJobId === job.id ? '#ccc' : '#e8724a', color: '#fff', border: 'none',
                          borderRadius: '10px', fontSize: '14px', fontWeight: 700, cursor: claimingJobId === job.id ? 'not-allowed' : 'pointer',
                          boxShadow: '0 2px 6px rgba(232,114,74,0.3)', whiteSpace: 'nowrap',
                        }}>{claimingJobId === job.id ? 'Accepting...' : 'Accept Job'}</button>
                    </div>
                  );
                })}
              </div>
            )}
            {/* Footer */}
            <div style={{ textAlign: 'center', padding: '10px', borderTop: '1px solid #f0f0f0' }}>
              <span onClick={() => window.__navigateTo && window.__navigateTo('find-work')} style={{ fontSize: 13, color: '#1b6b5a', fontWeight: 600, cursor: 'pointer' }}>
                View all jobs, map & availability →
              </span>
            </div>
          </div>
        );
      })()}

      {/* Scheduled — sessions >24hr away, no check-in logic */}
      {(() => {
        const sorted = [...scheduledSessions].sort((a, b) => {
          const aKey = (a.date || a.scheduled_date || '') + (a.time || a.scheduled_time || '');
          const bKey = (b.date || b.scheduled_date || '') + (b.time || b.scheduled_time || '');
          return aKey.localeCompare(bKey);
        });

        if (sorted.length === 0 && upNextSessions.length === 0) return (
          <div className="card" style={{ marginBottom: 16, padding: '24px', textAlign: 'center', borderLeft: '4px solid #1b6b5a' }}>
            <div style={{ fontSize: 20, marginBottom: 8 }}>{'\uD83D\uDCCB'}</div>
            <div style={{ fontWeight: 600, fontSize: 15, color: '#333', marginBottom: 4 }}>No upcoming sessions</div>
            <div style={{ fontSize: 13, color: '#888' }}>Check the <span style={{ color: '#1b6b5a', fontWeight: 600, cursor: 'pointer' }} onClick={() => setActiveTab('schedule')}>Calendar</span> for available care requests in your area.</div>
          </div>
        );

        if (sorted.length === 0) return null;

        return (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
              Scheduled
            </div>
            {sorted.slice(0, 5).map(s => {
              const sDate = (s.date || s.scheduled_date || '').split('T')[0];
              const tz = s.timezone || TimezoneHelper.DEFAULT_TZ;
              const now = TimezoneHelper.getNow(tz);
              const dayLabel = TimezoneHelper.getDateLabel(sDate, tz);
              const timeLabel = TimezoneHelper.formatTime(s.time || s.scheduled_time);
              const duration = s.durationHours || s.duration_hours;
              const svcType = s.serviceType || s.service_type;
              const recipName = s.recipientName || s.recipient_name || 'Session';
              const loc = s.location || (s.location_address ? `${s.location_address}, ${s.location_city || ''}` : s.location_city || '');
              const noAddress = !s.hasAddress && s.status === 'confirmed';

              const sessionDT = TimezoneHelper.buildDateTime(sDate, s.time || s.scheduled_time || '00:00', tz);
              const minsUntil = (sessionDT - now) / 60000;
              const daysUntil = Math.floor(minsUntil / 60 / 24);
              const dayCountLabel = daysUntil >= 2 ? `in ${daysUntil} days` : 'tomorrow';

              return (
                <div key={s.id} className="card" onClick={(e) => {
                  if (e.target.tagName === 'BUTTON') return;
                  if (s.id) setVisitDetailSessionId(s.id);
                }} style={{
                  marginBottom: 10, padding: '16px 18px', cursor: 'pointer',
                  border: `2px solid ${noAddress ? '#dc2626' : '#1b6b5a'}`,
                  borderRadius: 12,
                  background: '#fff',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '180px' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 3 }}>{dayCountLabel}</div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: '#333' }}>{recipName}</div>
                      <div style={{ fontSize: 13, color: '#666', marginTop: 2 }}>
                        {dayLabel}{timeLabel ? ` at ${timeLabel}` : ''}{duration ? ` \u2022 ${duration}hr` : ''}
                        {svcType ? ` \u2022 ${formatServiceType(svcType)}` : ''}
                      </div>
                      {loc ? (
                        <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{'\uD83D\uDCCD'} {loc}</div>
                      ) : noAddress ? (
                        <div style={{ fontSize: 12, color: '#dc2626', marginTop: 2, fontWeight: 600 }}>{'\u26A0\uFE0F'} No care address on file</div>
                      ) : null}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                      {(s.caregiverPayout > 0 || s.estimatedCost > 0) && (
                        <div style={{ fontSize: 20, fontWeight: 800, color: '#1b6b5a' }}>
                          ${Math.round(s.caregiverPayout || parseFloat(s.estimatedCost) || 0)}
                        </div>
                      )}
                      <span style={{
                        padding: '5px 12px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                        background: s.status === 'confirmed' ? '#e8f5e9' : '#fff3e0',
                        color: s.status === 'confirmed' ? '#2e7d32' : '#e65100',
                        textTransform: 'capitalize',
                      }}>{s.status}</span>
                    </div>
                  </div>
                </div>
              );
            })}
            {sorted.length > 5 && (
              <div style={{ textAlign: 'center', padding: '8px' }}>
                <span onClick={() => setActiveTab('schedule')} style={{ fontSize: 13, color: '#1b6b5a', fontWeight: 600, cursor: 'pointer' }}>
                  View all {sorted.length} sessions {'\u2192'}
                </span>
              </div>
            )}
          </div>
        );
      })()}

      {/* Completed — last 2 only, with fade rule */}
      {(() => {
        const completed = data.recentlyCompleted || [];
        if (completed.length === 0) return null;
        return (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Completed</div>
            {completed.slice(0, 2).map((s, i) => {
              const sDate = (s.date || '').split('T')[0];
              const tz = s.timezone || TimezoneHelper.DEFAULT_TZ;
              const dayLabel = TimezoneHelper.getDateLabel(sDate, tz);
              const timeLabel = TimezoneHelper.formatTime(s.time);
              const recipName = s.recipientName || 'Session';
              return (
                <div key={s.id} style={{ padding: '14px 18px', borderRadius: 12, marginBottom: 8, background: '#fafafa', border: '1px solid #e5e7eb', opacity: i === 0 ? 1 : 0.7 }}>
                  <div onClick={() => {
                    if (s.id) setVisitDetailSessionId(s.id);
                  }} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#333' }}>{recipName}</div>
                      <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                        {dayLabel}{timeLabel ? ` at ${timeLabel}` : ''}{s.durationHours ? ` \u2022 ${s.durationHours}hr` : ''}
                        {s.serviceType ? ` \u2022 ${formatServiceType(s.serviceType)}` : ''}
                      </div>
                      {s.visitSummary && <div style={{ fontSize: 12, color: '#666', marginTop: 3, fontStyle: 'italic' }}>{s.visitSummary.length > 80 ? s.visitSummary.substring(0, 80) + '...' : s.visitSummary}</div>}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <span style={{ padding: '3px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: '#e8f5e9', color: '#2e7d32' }}>{'\u2713'} Done</span>
                      {s.caregiverPayout > 0 && <span style={{ fontSize: 22, fontWeight: 800, color: '#1b6b5a', background: '#e8f5e9', padding: '4px 10px', borderRadius: 8 }}>${s.caregiverPayout.toFixed(2)}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Onboarding Gate Panel — non-dismissible */}
      {onboardingGated && (
        <div className="onboarding-gate-panel">
          <h2 className="onboarding-gate-title">Finish Your Setup</h2>
          <p className="onboarding-gate-subtitle">
            You'll need your driver's license or ID, bank account information you'd like to get paid in,
            and a credit/debit card for identity check and refundable background check.
          </p>
          <div className="onboarding-gate-progress">
            <div className="progress-label">{firstStepsDone} of {firstSteps.length} complete</div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: (firstStepsDone / firstSteps.length * 100) + '%' }}></div>
            </div>
          </div>
          <input type="file" ref={avatarInputRef} accept="image/*" style={{ display: 'none' }} onChange={handleAvatarUpload} />
          <div className="onboarding-steps">
            {firstSteps.map((s, idx) => (
              <div key={s.id} className={'onboarding-step' + (s.done ? ' done' : '')} onClick={() => {
                if (s.done) return;
                if (s.id === 'profile') { setProfileForm({ bio: profile.bio || '', hourlyRate: profile.hourlyRate || '', rateDaytime: profile.rateDaytime || profile.hourlyRate || '', rateNighttime: profile.rateNighttime || '', rateOvernight: profile.rateOvernight || '', foodAllergies: '', medicalConditions: '' }); window.__navigateTo && window.__navigateTo('account'); }
                if (s.id === 'availability') window.__navigateTo && window.__navigateTo('find-work');
                if (s.id === 'stoplight') window.__navigateTo && window.__navigateTo('account');
                if (s.id === 'photo') avatarInputRef.current && avatarInputRef.current.click();
                if (s.id === 'payments') window.__navigateTo && window.__navigateTo('account');
                if (s.id === 'bgcheck') window.__navigateTo && window.__navigateTo('account');
              }}>
                <div className="step-circle">
                  {s.done ? '\u2713' : (idx + 1)}
                </div>
                <div className="step-text">
                  <div className="step-name">{s.label}</div>
                  <div className="step-desc">
                    {s.id === 'profile' && (s.done ? 'Bio and rate set' : (() => {
                      const missing = [];
                      if (!profile.bio) missing.push('bio');
                      if (!profile.rateDaytime && !profile.hourlyRate) missing.push('hourly rate');
                      return missing.length > 0 ? `Still needed: ${missing.join(' and ')}` : 'Add your bio and set your hourly rate';
                    })())}
                    {s.id === 'availability' && 'Tell families when you\'re free to work'}
                    {s.id === 'stoplight' && 'Rate your comfort level with different care tasks'}
                    {s.id === 'photo' && 'Families want to see who they\'re welcoming into their home'}
                    {s.id === 'payments' && 'Connect your bank account through Stripe to get paid'}
                    {s.id === 'bgcheck' && '$30 fee, refunded after your first 10 completed sessions'}
                  </div>
                </div>
                {!s.done && <div className="step-arrow">{'\u2192'}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* First Steps Banner — shown when onboarding is complete but steps remain */}
      {showFirstSteps && !onboardingGated && (
        <div className="card" style={{ marginBottom: '20px', padding: '16px', background: '#fffbf0', border: '1px solid #ffe0a0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ margin: 0, fontSize: '15px', color: '#b45309' }}>First Steps — {firstStepsDone}/{firstSteps.length} complete</h3>
            <div style={{ width: '100px', height: '6px', background: '#e0e0e0', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ width: (firstStepsDone / firstSteps.length * 100) + '%', height: '100%', background: '#1b6b5a', borderRadius: '3px', transition: 'width 0.3s' }}></div>
            </div>
          </div>
          <input type="file" ref={avatarInputRef} accept="image/*" style={{ display: 'none' }} onChange={handleAvatarUpload} />
          <div style={{ display: 'grid', gap: '8px' }}>
            {firstSteps.map(s => (
              <div key={s.id} onClick={() => {
                if (s.done) return;
                if (s.id === 'profile') { setProfileForm({ bio: profile.bio || '', hourlyRate: profile.hourlyRate || '', rateDaytime: profile.rateDaytime || profile.hourlyRate || '', rateNighttime: profile.rateNighttime || '', rateOvernight: profile.rateOvernight || '', foodAllergies: '', medicalConditions: '' }); window.__navigateTo && window.__navigateTo('account'); }
                if (s.id === 'availability') window.__navigateTo && window.__navigateTo('find-work');
                if (s.id === 'stoplight') window.__navigateTo && window.__navigateTo('account');
                if (s.id === 'photo') avatarInputRef.current && avatarInputRef.current.click();
                if (s.id === 'payments') window.__navigateTo && window.__navigateTo('account');
                if (s.id === 'bgcheck') window.__navigateTo && window.__navigateTo('account');
              }} style={{
                display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px',
                color: s.done ? '#999' : '#333', cursor: s.done ? 'default' : 'pointer',
                textDecoration: s.done ? 'line-through' : 'none',
              }}>
                <span style={{ width: '20px', height: '20px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', background: s.done ? '#e8f5e9' : '#f0f0f0', color: s.done ? '#2e7d32' : '#999' }}>
                  {s.done ? '\u2713' : '\u25CB'}
                </span>
                {s.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dashboard content — blurred when onboarding incomplete, lifts when working on a step */}
      <div className={shouldBlur ? 'onboarding-content-lock' : ''}>
        {shouldBlur && (
          <div className="lock-overlay">
            <div className="lock-icon">🔒</div>
            <div className="lock-msg">Complete your setup above to unlock your dashboard</div>
          </div>
        )}
        <div className={shouldBlur ? 'lock-content' : ''}>


      {/* Earnings Summary — moved to main dashboard flow above */}

      {/* Tab Content */}
      <div ref={tabContentRef} style={{
        borderRadius: highlightTab ? '12px' : undefined,
        boxShadow: highlightTab ? '0 0 0 3px #e8724a, 0 0 20px rgba(232,114,74,0.3)' : undefined,
        transition: 'box-shadow 0.3s ease',
      }}>

      {/* Inline Profile Editor (during onboarding) */}
      {activeTab === 'profile' && (
        <div className="card" style={{ padding: '24px' }}>
          <h3 style={{ margin: '0 0 4px', fontSize: '18px', color: '#1b6b5a' }}>Complete Your Profile</h3>
          <p style={{ fontSize: '13px', color: '#666', margin: '0 0 20px' }}>This is what families see when deciding who to hire. Make a great first impression!</p>
          <div style={{ display: 'grid', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#333', marginBottom: '4px' }}>Bio / About You</label>
              <textarea value={profileForm.bio} onChange={(e) => setProfileForm(p => ({ ...p, bio: e.target.value }))}
                placeholder="Tell families about yourself — your experience, personality, and why you love caregiving..."
                rows={4} style={{ width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#333', marginBottom: '8px' }}>Your Rates ($/hr)</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Daytime (6a–6p)</div>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: '10px', top: '10px', color: '#888', fontSize: '14px' }}>$</span>
                    <input type="number" value={profileForm.rateDaytime} onChange={(e) => setProfileForm(p => ({ ...p, rateDaytime: e.target.value }))}
                      placeholder="25" min="15" max="200" style={{ width: '100%', padding: '10px 10px 10px 24px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} />
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Evening (6p–12a)</div>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: '10px', top: '10px', color: '#888', fontSize: '14px' }}>$</span>
                    <input type="number" value={profileForm.rateNighttime} onChange={(e) => setProfileForm(p => ({ ...p, rateNighttime: e.target.value }))}
                      placeholder="30" min="15" max="200" style={{ width: '100%', padding: '10px 10px 10px 24px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} />
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Overnight (12a–6a)</div>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: '10px', top: '10px', color: '#888', fontSize: '14px' }}>$</span>
                    <input type="number" value={profileForm.rateOvernight} onChange={(e) => setProfileForm(p => ({ ...p, rateOvernight: e.target.value }))}
                      placeholder="35" min="15" max="200" style={{ width: '100%', padding: '10px 10px 10px 24px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} />
                  </div>
                </div>
              </div>
              <div style={{ fontSize: '11px', color: '#888', marginTop: '6px' }}>6-hour minimum per booking. Typical range: $20–$35/hr.</div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#333', marginBottom: '4px' }}>Food Allergies <span style={{ color: '#999', fontWeight: 400 }}>(optional — so families know)</span></label>
              <input type="text" value={profileForm.foodAllergies} onChange={(e) => setProfileForm(p => ({ ...p, foodAllergies: e.target.value }))}
                placeholder="e.g. peanuts, shellfish, none" style={{ width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#333', marginBottom: '4px' }}>Medical Conditions <span style={{ color: '#999', fontWeight: 400 }}>(optional — anything families should know)</span></label>
              <input type="text" value={profileForm.medicalConditions} onChange={(e) => setProfileForm(p => ({ ...p, medicalConditions: e.target.value }))}
                placeholder="e.g. asthma, none" style={{ width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
            <button onClick={() => setActiveTab('schedule')} style={{
              padding: '10px 24px', background: '#f0f0f0', color: '#555', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
            }}>Back</button>
            <button onClick={saveOnboardingProfile} disabled={profileSaving || !profileForm.bio || !profileForm.rateDaytime} style={{
              padding: '10px 24px', background: profileForm.bio && profileForm.rateDaytime ? '#1b6b5a' : '#ccc',
              color: '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600,
              cursor: profileForm.bio && profileForm.rateDaytime ? 'pointer' : 'not-allowed', opacity: profileSaving ? 0.6 : 1,
            }}>{profileSaving ? 'Saving...' : 'Save Profile'}</button>
          </div>
        </div>
      )}

      {/* Calendar — always rendered */}
      <div ref={calendarRef} style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>📅 Calendar</div>
        <CaregiverCalendar
          caregiverId={profile.id}
          sessions={sessions}
          availRules={availRules}
          fetchAvailability={fetchAvailability}
          earlyCheckInAllowed={profile.earlyCheckInAllowed}
          onLogVisit={(s) => {
            if (s.action === 'check-in') {
              setCheckInMood('');
              setCheckInNotes(null);
              setCheckInLocation(null);
              setLocationError(null);
              // Request geolocation when check-in modal opens
              if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                  (pos) => setCheckInLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
                  (err) => { console.warn('Geolocation error:', err.message); setLocationError(err.message); },
                  { timeout: 8000, enableHighAccuracy: false }
                );
              } else {
                setLocationError('Geolocation not supported');
              }
              setCheckInSession(s);
            } else if (s.action === 'check-out') {
              setCheckOutMood('');
              setCheckOutTags([]);
              setCheckOutCareFeedback('');
              setCheckOutServiceFeedback('');
              setCheckOutSummary('');
              setCheckOutSession(s);
            } else {
              setVisitLogSession(s);
            }
          }}
        />
      </div>

      </div>{/* end tabContentRef wrapper */}

        </div>{/* end lock-content */}
      </div>{/* end onboarding-content-lock */}

      {/* Visit Log Modal */}
      {visitLogSession && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: '#fff', borderRadius: '12px', padding: '24px', width: '480px', maxWidth: '90vw',
            maxHeight: '90vh', overflow: 'auto',
          }}>
            <h3 style={{ marginTop: 0 }}>Log Visit — {visitLogSession.recipientName}</h3>
            <p style={{ fontSize: '13px', color: '#666' }}>
              {visitLogSession.date} at {visitLogSession.time} &bull; {formatServiceType(visitLogSession.serviceType)}
            </p>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Visit Summary *</label>
              <textarea value={logSummary} onChange={e => setLogSummary(e.target.value)}
                placeholder="How did the visit go? What activities did you do together?"
                style={{ width: '100%', minHeight: '80px', padding: '10px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '13px', resize: 'vertical' }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Mood / Condition</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {['great', 'good', 'fair', 'difficult'].map(m => (
                  <button key={m} onClick={() => setLogMood(m)} style={{
                    padding: '6px 14px', borderRadius: '16px', border: logMood === m ? '2px solid #1b6b5a' : '2px solid #ddd',
                    background: logMood === m ? '#e8f5f1' : '#fff', cursor: 'pointer', fontSize: '12px',
                    fontWeight: logMood === m ? 600 : 400, textTransform: 'capitalize',
                  }}>{m === 'great' ? '😊' : m === 'good' ? '🙂' : m === 'fair' ? '😐' : '😟'} {m}</button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Additional Notes</label>
              <textarea value={logNotes} onChange={e => setLogNotes(e.target.value)}
                placeholder="Any concerns, observations, or things the family should know?"
                style={{ width: '100%', minHeight: '60px', padding: '10px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '13px', resize: 'vertical' }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>📸 Visit Photos (up to 5)</label>
              <p style={{ fontSize: '12px', color: '#888', margin: '0 0 8px' }}>
                Share photos from the visit with the family — activities, meals, smiles!
              </p>
              <input type="file" ref={photoInputRef} accept="image/*" multiple onChange={handlePhotoSelect}
                style={{ display: 'none' }} />
              <button onClick={() => photoInputRef.current?.click()} style={{
                padding: '16px', background: logPhotos.length > 0 ? '#e8f5e9' : '#f8f9fa',
                border: logPhotos.length > 0 ? '2px solid #1b6b5a' : '2px dashed #ccc', borderRadius: '10px',
                cursor: 'pointer', fontSize: '14px', color: logPhotos.length > 0 ? '#1b6b5a' : '#666',
                width: '100%', fontWeight: logPhotos.length > 0 ? 600 : 400,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              }}>
                <span style={{ fontSize: '20px' }}>{logPhotos.length > 0 ? '✅' : '📷'}</span>
                {logPhotos.length > 0 ? `${logPhotos.length} photo${logPhotos.length > 1 ? 's' : ''} selected — tap to add more` : 'Tap to add visit photos'}
              </button>
              {photoPreviewUrls.length > 0 && (
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                  {photoPreviewUrls.map((url, idx) => (
                    <div key={idx} style={{ position: 'relative', width: '72px', height: '72px' }}>
                      <img src={url} alt={`Photo ${idx + 1}`} style={{
                        width: '72px', height: '72px', objectFit: 'cover', borderRadius: '8px', border: '1px solid #ddd',
                      }} />
                      <button onClick={() => removePhoto(idx)} style={{
                        position: 'absolute', top: '-6px', right: '-6px', width: '20px', height: '20px',
                        background: '#c62828', color: '#fff', border: 'none', borderRadius: '50%',
                        fontSize: '12px', cursor: 'pointer', lineHeight: '20px', padding: 0,
                      }}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={() => setVisitLogSession(null)} style={{
                padding: '10px 20px', border: '1px solid #ddd', background: '#fff', borderRadius: '8px',
                cursor: 'pointer', fontSize: '13px',
              }}>Cancel</button>
              <button onClick={handleSubmitVisitLog} disabled={!logSummary.trim() || submittingLog} style={{
                padding: '10px 20px', background: '#1b6b5a', color: '#fff', border: 'none',
                borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                opacity: (!logSummary.trim() || submittingLog) ? 0.5 : 1,
              }}>{submittingLog ? 'Submitting...' : 'Submit Visit Log'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── CHECK-IN MODAL ─── */}
      {checkInSession && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: '#fff', borderRadius: '16px', padding: '28px', width: '440px', maxWidth: '92vw',
            maxHeight: '90vh', overflow: 'auto',
          }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>👋</div>
              <h3 style={{ marginTop: 0, marginBottom: 4, fontSize: 20 }}>Check In</h3>
              <p style={{ fontSize: 13, color: '#666', margin: 0 }}>
                {checkInSession.recipientName || checkInSession.recipient_name || 'Care Session'} &bull; {checkInSession.date || checkInSession.scheduled_date} at {checkInSession.time || checkInSession.scheduled_time}
              </p>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                How is {(checkInSession.recipientName || checkInSession.recipient_name || '').split(' ')[0] || 'the care recipient'} right now?
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {[
                  { key: 'happy', emoji: '😊', label: 'Happy' },
                  { key: 'surprised', emoji: '😮', label: 'Surprised' },
                  { key: 'sleepy', emoji: '😴', label: 'Sleepy' },
                  { key: 'busy', emoji: '🤗', label: 'Busy' },
                  { key: 'neutral', emoji: '😐', label: 'Neutral' },
                  { key: 'sad', emoji: '😢', label: 'Sad' },
                  { key: 'upset', emoji: '😠', label: 'Upset' },
                ].map(m => (
                  <button key={m.key} onClick={() => setCheckInMood(m.key)} style={{
                    padding: '8px 14px', borderRadius: 20, border: checkInMood === m.key ? '2px solid #e8724a' : '2px solid #eee',
                    background: checkInMood === m.key ? '#fff3ed' : '#fafafa', cursor: 'pointer', fontSize: 13,
                    fontWeight: checkInMood === m.key ? 700 : 400, display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <span style={{ fontSize: 18 }}>{m.emoji}</span> {m.label}
                  </button>
                ))}
              </div>
            </div>

            {checkInSession.special_instructions || checkInSession.specialInstructions ? (
              <div style={{ marginBottom: 16, padding: 12, background: '#f0faf7', borderRadius: 8, border: '1px solid #d4edda' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#1b6b5a', marginBottom: 4 }}>📋 Instructions from care team</div>
                <div style={{ fontSize: 13, color: '#333' }}>{checkInSession.special_instructions || checkInSession.specialInstructions}</div>
              </div>
            ) : null}

            {checkInNotes && checkInNotes.length > 0 && (
              <div style={{ marginBottom: 16, padding: 12, background: '#f8f4ff', borderRadius: 8, border: '1px solid #e8daff' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#6b21a8', marginBottom: 4 }}>📝 Recent care notes</div>
                {checkInNotes.map((n, i) => (
                  <div key={i} style={{ fontSize: 12, color: '#555', marginTop: i > 0 ? 6 : 2 }}>{n.content}</div>
                ))}
              </div>
            )}

            {/* Location badge */}
            {checkInLocation && (
              <div style={{ marginBottom: 12, padding: 10, background: '#e3f2fd', borderRadius: 8, border: '1px solid #90caf9', fontSize: 12, color: '#1565c0', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 14 }}>📍</span> Location captured ({Math.round(checkInLocation.accuracy || 0)}m accuracy)
              </div>
            )}
            {locationError && !checkInLocation && (
              <div style={{ marginBottom: 12, padding: 10, background: '#fff3e0', borderRadius: 8, border: '1px solid #ffb74d', fontSize: 12, color: '#e65100', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 14 }}>⚠️</span> Location unavailable — you can still check in
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={() => setCheckInSession(null)} style={{
                padding: '10px 20px', border: '1px solid #ddd', background: '#fff', borderRadius: 8,
                cursor: 'pointer', fontSize: 13,
              }}>Cancel</button>
              <button onClick={async () => {
                setCheckSubmitting(true);
                try {
                  const res = await apiFetch('/api/sessions/' + checkInSession.id + '/check-in', {
                    method: 'POST',
                    body: JSON.stringify({
                      arrivalMood: checkInMood || null,
                      checkInLatitude: checkInLocation?.lat || null,
                      checkInLongitude: checkInLocation?.lng || null,
                    }),
                  });
                  if (res?.ok) {
                    await res.json();
                    showToast('Checked in! Session started.', 'success');
                    setCheckInSession(null);
                    try {
                      const refreshRes = await apiFetch('/api/dashboard');
                      if (refreshRes?.ok) setData(await refreshRes.json());
                    } catch (e) { /* refresh is best-effort */ }
                  } else {
                    const err = await res?.json().catch(() => null);
                    showToast(err?.message || err?.error || 'Check-in failed', 'error');
                  }
                } catch (e) { showToast('Check-in failed', 'error'); }
                setCheckSubmitting(false);
              }} disabled={checkSubmitting} style={{
                padding: '10px 24px', background: '#e8724a', color: '#fff', border: 'none',
                borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 700,
                opacity: checkSubmitting ? 0.6 : 1,
              }}>{checkSubmitting ? 'Checking in...' : "I'm Here ✓"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── CHECK-OUT MODAL ─── */}
      {checkOutSession && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: '#fff', borderRadius: '16px', padding: '28px', width: '500px', maxWidth: '92vw',
            maxHeight: '90vh', overflow: 'auto',
          }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>👋</div>
              <h3 style={{ marginTop: 0, marginBottom: 4, fontSize: 20 }}>Check Out</h3>
              <p style={{ fontSize: 13, color: '#666', margin: 0 }}>
                {checkOutSession.recipientName || checkOutSession.recipient_name || 'Care Session'} &bull; {checkOutSession.date || checkOutSession.scheduled_date}
              </p>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                How is {(checkOutSession.recipientName || checkOutSession.recipient_name || '').split(' ')[0] || 'the care recipient'} now?
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {[
                  { key: 'happy', emoji: '😊', label: 'Happy' },
                  { key: 'calm', emoji: '😌', label: 'Calm' },
                  { key: 'sleepy', emoji: '😴', label: 'Sleepy' },
                  { key: 'neutral', emoji: '😐', label: 'Neutral' },
                  { key: 'anxious', emoji: '😰', label: 'Anxious' },
                  { key: 'sad', emoji: '😢', label: 'Sad' },
                  { key: 'upset', emoji: '😠', label: 'Upset' },
                ].map(m => (
                  <button key={m.key} onClick={() => setCheckOutMood(m.key)} style={{
                    padding: '8px 14px', borderRadius: 20, border: checkOutMood === m.key ? '2px solid #c62828' : '2px solid #eee',
                    background: checkOutMood === m.key ? '#ffebee' : '#fafafa', cursor: 'pointer', fontSize: 13,
                    fontWeight: checkOutMood === m.key ? 700 : 400, display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <span style={{ fontSize: 18 }}>{m.emoji}</span> {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                What did you observe? (tap all that apply)
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {[
                  'Good spirits', 'Cooperative', 'Engaged in activity', 'Good appetite', 'Good mobility',
                  'Medication taken', 'Confused', 'Anxious', 'Withdrawn', 'Resistant to care',
                  'No appetite', 'Toileting issues', 'Wandering', 'Pain/discomfort',
                  'Fall risk', 'Medication refused',
                ].map(tag => {
                  const isSelected = checkOutTags.includes(tag);
                  const isPositive = ['Good spirits', 'Cooperative', 'Engaged in activity', 'Good appetite', 'Good mobility', 'Medication taken'].includes(tag);
                  return (
                    <button key={tag} onClick={() => setCheckOutTags(prev =>
                      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
                    )} style={{
                      padding: '5px 12px', borderRadius: 16, fontSize: 12,
                      border: isSelected ? `2px solid ${isPositive ? '#2e7d32' : '#c62828'}` : '1px solid #ddd',
                      background: isSelected ? (isPositive ? '#e8f5e9' : '#ffebee') : '#fff',
                      color: isSelected ? (isPositive ? '#2e7d32' : '#c62828') : '#555',
                      cursor: 'pointer', fontWeight: isSelected ? 600 : 400,
                    }}>{tag}</button>
                  );
                })}
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                About {(checkOutSession.recipientName || checkOutSession.recipient_name || '').split(' ')[0] || 'the care recipient'}
              </label>
              <textarea value={checkOutCareFeedback} onChange={e => setCheckOutCareFeedback(e.target.value)}
                placeholder="How was the visit? Anything the family should know about their condition, mood, or behavior?"
                style={{ width: '100%', minHeight: 70, padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                Service or logistics notes (optional)
              </label>
              <textarea value={checkOutServiceFeedback} onChange={e => setCheckOutServiceFeedback(e.target.value)}
                placeholder="Issues with the location, supplies, instructions, or our service? e.g. 'Door code was wrong', 'Driveway icy'"
                style={{ width: '100%', minHeight: 50, padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={() => setCheckOutSession(null)} style={{
                padding: '10px 20px', border: '1px solid #ddd', background: '#fff', borderRadius: 8,
                cursor: 'pointer', fontSize: 13,
              }}>Cancel</button>
              <button onClick={async () => {
                setCheckSubmitting(true);
                try {
                  const res = await apiFetch('/api/sessions/' + checkOutSession.id + '/check-out', {
                    method: 'POST',
                    body: JSON.stringify({
                      departureMood: checkOutMood || null,
                      conditionTags: checkOutTags.length > 0 ? checkOutTags : null,
                      careFeedback: checkOutCareFeedback.trim() || null,
                      serviceFeedback: checkOutServiceFeedback.trim() || null,
                      summary: checkOutCareFeedback.trim() || null,
                    }),
                  });
                  if (res?.ok) {
                    showToast('Checked out! Session complete.', 'success');
                    setCheckOutSession(null);
                    const refreshRes = await apiFetch('/api/dashboard');
                    if (refreshRes?.ok) setData(await refreshRes.json());
                  } else {
                    const err = await res?.json().catch(() => null);
                    showToast(err?.error || 'Check-out failed', 'error');
                  }
                } catch (e) { showToast('Check-out failed', 'error'); }
                setCheckSubmitting(false);
              }} disabled={checkSubmitting} style={{
                padding: '10px 24px', background: '#c62828', color: '#fff', border: 'none',
                borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 700,
                opacity: checkSubmitting ? 0.6 : 1,
              }}>{checkSubmitting ? 'Submitting...' : 'Complete Session ✓'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Visit Detail Modal */}
      {visitDetailSessionId && (
        <VisitDetailModal sessionId={visitDetailSessionId} role="caregiver" onClose={() => setVisitDetailSessionId(null)} onRefresh={async () => {
          const dashRes = await apiFetch('/api/dashboard');
          if (dashRes?.ok) setData(await dashRes.json());
        }} />
      )}

      {/* Reviews Modal */}
      {showReviews && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setShowReviews(false)}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: 420, maxWidth: '90vw', maxHeight: '70vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18 }}>⭐ Your Reviews</h3>
              <button onClick={() => setShowReviews(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#888' }}>×</button>
            </div>
            {reviews.length > 0 ? reviews.map((r, i) => (
              <div key={i} style={{ padding: '12px 0', borderBottom: i < reviews.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: '#333' }}>{r.reviewer_name || r.reviewerName || 'Family'}</span>
                  <span style={{ color: '#f59e0b', fontSize: 13 }}>{'⭐'.repeat(r.rating || 0)}</span>
                </div>
                {r.comment && <p style={{ fontSize: 13, color: '#555', margin: '4px 0 0', lineHeight: 1.5 }}>{r.comment}</p>}
                {r.created_at && <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>{new Date(r.created_at).toLocaleDateString()}</div>}
              </div>
            )) : (
              <p style={{ color: '#888', fontSize: 14, textAlign: 'center', margin: '20px 0' }}>No reviews yet</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
