const CaretakerHub = window.CaretakerHub = ({ onNeedsOnboarding, initialTab }) => {
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
  const avatarInputRef = useRef(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
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

  // Availability state
  const [availRules, setAvailRules] = useState([]);
  const [availLoading, setAvailLoading] = useState(false);
  const [showAddRule, setShowAddRule] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [ruleForm, setRuleForm] = useState({
    type: 'available', dayOfWeek: 1, startTime: '08:00', endTime: '17:00',
    isRecurring: true, specificDate: '', note: '',
  });

  // Stoplight chart state (must be before early returns — React hook order rules)
  const [stoplightData, setStoplightData] = useState(null);
  const [editingStoplight, setEditingStoplight] = useState(false);
  const [stoplightForm, setStoplightForm] = useState({});

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

  const handleSaveRule = async () => {
    try {
      const body = {
        dayOfWeek: parseInt(ruleForm.dayOfWeek),
        startTime: ruleForm.startTime,
        endTime: ruleForm.endTime,
        isRecurring: ruleForm.isRecurring,
        specificDate: ruleForm.isRecurring ? null : ruleForm.specificDate || null,
        type: ruleForm.type,
        note: ruleForm.note || null,
      };

      if (editingRule) {
        await apiFetch(`/api/availability/${editingRule.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await apiFetch('/api/availability', { method: 'POST', body: JSON.stringify(body) });
      }
      setShowAddRule(false);
      setEditingRule(null);
      setRuleForm({ type: 'available', dayOfWeek: 1, startTime: '08:00', endTime: '17:00', isRecurring: true, specificDate: '', note: '' });
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
        } else if (res?.status === 404) {
          setNoProfile(true);
        }
      } catch (err) {
        console.error('CaretakerHub fetch error:', err);
      }
      setLoading(false);
    };
    fetchData();
  }, []);

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
      setBgCheckPaid(!!profile?.background_check_paid);
    }
  }, [activeTab]);

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

  const profile = data.profile || {};
  const assignments = data.assignments || [];
  const sessions = data.upcomingSessions || [];
  const reviews = data.reviews || [];
  const stats = data.stats || {};

  // Init tiered rates from profile (once)
  useEffect(() => {
    if (profile.rateDaytime && !ratesDaytime) setRatesDaytime(profile.rateDaytime);
    if (profile.rateNighttime && !ratesNighttime) setRatesNighttime(profile.rateNighttime);
    if (profile.rateOvernight && !ratesOvernight) setRatesOvernight(profile.rateOvernight);
  }, [profile.rateDaytime, profile.rateNighttime, profile.rateOvernight]);

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
      const canvas = document.createElement('canvas');
      const img = new Image();
      img.src = URL.createObjectURL(file);
      await new Promise(r => { img.onload = r; });
      const maxDim = 400;
      let w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
        else { w = Math.round(w * maxDim / h); h = maxDim; }
      }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      URL.revokeObjectURL(img.src);

      const res = await apiFetch('/api/auth/me/photo', {
        method: 'PUT',
        body: JSON.stringify({ photo: dataUrl }),
      });
      if (res?.ok) {
        // Update local state to reflect the new avatar
        setData(prev => prev ? { ...prev, profile: { ...prev.profile, avatar_url: dataUrl } } : prev);
        if (typeof showToast === 'function' || (window.useToast && typeof useToast === 'function')) {
          try { useToast().showToast('Profile photo updated!', 'success'); } catch(e) {}
        }
      }
    } catch (err) { console.error('Avatar upload error:', err); }
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

  // First Steps checklist
  const firstSteps = [
    { id: 'profile', label: 'Complete your profile', done: !!(profile.bio && profile.hourlyRate) },
    { id: 'availability', label: 'Set your availability', done: availRules.length > 0 },
    { id: 'stoplight', label: 'Set your care preferences (stoplight)', done: !!stoplightData },
    { id: 'photo', label: 'Upload a profile photo', done: !!profile.avatar_url },
    { id: 'payments', label: 'Set up payments (Stripe)', done: stripeStatus?.status === 'active' },
    { id: 'bgcheck', label: 'Pay for background check ($30)', done: !!profile.background_check_paid },
  ];
  const firstStepsDone = firstSteps.filter(s => s.done).length;
  const showFirstSteps = firstStepsDone < firstSteps.length;

  // Average hourly rate from completed sessions
  const totalHours = completedSessions.reduce((sum, s) => sum + (s.duration_hours || 0), 0);
  const totalEarned = completedSessions.reduce((sum, s) => sum + (s.actual_cost || s.estimated_cost || 0), 0);
  const avgHourlyRate = totalHours > 0 ? (totalEarned / totalHours).toFixed(0) : (profile.hourlyRate || '--');

  const tabs = [
    { id: 'schedule', label: 'Calendar', icon: '📅' },
    { id: 'availability', label: 'Availability', icon: '🕐' },
    { id: 'families', label: 'My Families', icon: '👪' },
    { id: 'map', label: 'Area Map', icon: '🗺️' },
    { id: 'earnings', label: 'Earnings', icon: '💰' },
    { id: 'financials', label: 'Financials', icon: '🏦' },
    { id: 'reviews', label: 'Reviews', icon: '⭐' },
    { id: 'documents', label: 'Documents', icon: '📄' },
    { id: 'preferences', label: 'Care Preferences', icon: '🚦' },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 className="greeting" style={{ marginBottom: '4px' }}>Welcome, {profile.name || 'Caregiver'}!</h1>
          <div style={{ color: '#666', fontSize: '14px' }}>
            {profile.city}, {profile.state} &bull; {profile.specialties?.join(', ')}
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
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#1b6b5a' }}>⭐ {profile.rating || '—'}</div>
            <div style={{ fontSize: '11px', color: '#999' }}>{profile.reviewCount || 0} reviews</div>
          </div>
        </div>
      </div>

      {/* Latest Status */}
      {(() => {
        const onboardingDone = profile.onboardingComplete;
        const checkrStatus = profile.checkrStatus;
        const upcomingCount = sessions.length;
        let statusIcon = '📋';
        let statusText = "You're all set! No upcoming sessions right now.";
        let borderColor = '#1b6b5a';

        if (!onboardingDone) {
          statusIcon = '⏳';
          statusText = 'Pending background check and onboarding completion. Complete your profile to start receiving care requests.';
          borderColor = '#e8724a';
        } else if (checkrStatus === 'pending') {
          statusIcon = '🔄';
          statusText = 'Your background check is in progress. You\'ll be notified once it clears.';
          borderColor = '#f59e0b';
        } else if (upcomingCount > 0) {
          statusIcon = '📅';
          statusText = `You have ${upcomingCount} upcoming session${upcomingCount > 1 ? 's' : ''}.`;
        }

        return (
          <div className="card" style={{ marginBottom: 16, borderLeft: `4px solid ${borderColor}`, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 24 }}>{statusIcon}</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#333' }}>Latest</div>
              <div style={{ fontSize: 13, color: '#555', marginTop: 2 }}>{statusText}</div>
            </div>
          </div>
        );
      })()}

      {/* First Steps Banner */}
      {showFirstSteps && (
        <div className="card" style={{ marginBottom: '20px', padding: '16px', background: '#fffbf0', border: '1px solid #ffe0a0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ margin: 0, fontSize: '15px', color: '#b45309' }}>First Steps — {firstStepsDone}/{firstSteps.length} complete</h3>
            <div style={{ width: '100px', height: '6px', background: '#e0e0e0', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ width: `${(firstStepsDone / firstSteps.length) * 100}%`, height: '100%', background: '#1b6b5a', borderRadius: '3px', transition: 'width 0.3s' }} />
            </div>
          </div>
          <input type="file" ref={avatarInputRef} accept="image/*" style={{ display: 'none' }} onChange={handleAvatarUpload} />
          <div style={{ display: 'grid', gap: '8px' }}>
            {firstSteps.map(s => (
              <div key={s.id} onClick={() => {
                if (s.done) return;
                if (s.id === 'availability') setActiveTab('availability');
                if (s.id === 'stoplight') setActiveTab('preferences');
                if (s.id === 'photo') avatarInputRef.current?.click();
              }} style={{
                display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px',
                color: s.done ? '#999' : '#333', cursor: s.done ? 'default' : 'pointer',
                textDecoration: s.done ? 'line-through' : 'none',
              }}>
                <span style={{ width: '20px', height: '20px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', background: s.done ? '#e8f5e9' : '#f0f0f0', color: s.done ? '#2e7d32' : '#999' }}>
                  {s.done ? '✓' : '○'}
                </span>
                {s.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Stats — clickable */}
      <div className="stats-grid">
        <div className="stat-card" onClick={() => setActiveTab('families')} style={{ cursor: 'pointer' }}>
          <div style={{ fontSize: 24 }}>👪</div>
          <div className="stat-number">{stats.assignedFamilies || 0}</div>
          <div className="stat-label">Assigned Families</div>
        </div>
        <div className="stat-card" onClick={() => setActiveTab('earnings')} style={{ cursor: 'pointer' }}>
          <div style={{ fontSize: 24 }}>✅</div>
          <div className="stat-number">{stats.completedThisMonth || 0}</div>
          <div className="stat-label">Completed This Month</div>
        </div>
        <div className="stat-card" onClick={() => setActiveTab('earnings')} style={{ cursor: 'pointer' }}>
          <div style={{ fontSize: 24 }}>⏱️</div>
          <div className="stat-number">{stats.hoursThisMonth || 0}h</div>
          <div className="stat-label">Hours This Month</div>
        </div>
        <div className="stat-card" onClick={() => setActiveTab('earnings')} style={{ cursor: 'pointer' }}>
          <div style={{ fontSize: 24 }}>💰</div>
          <div className="stat-number">${stats.monthlyEarnings || 0}</div>
          <div className="stat-label">Earned This Month</div>
          <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>~${avgHourlyRate}/hr avg</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', borderBottom: '2px solid #e0e0e0', paddingBottom: '0' }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: '13px', fontWeight: activeTab === tab.id ? 700 : 400,
            color: activeTab === tab.id ? '#1b6b5a' : '#888',
            borderBottom: activeTab === tab.id ? '3px solid #1b6b5a' : '3px solid transparent',
            marginBottom: '-2px', transition: 'all 0.15s',
          }}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'schedule' && (
        <CaregiverCalendar
          caregiverId={profile.id}
          sessions={sessions}
          availRules={availRules}
          fetchAvailability={fetchAvailability}
          onLogVisit={setVisitLogSession}
        />
      )}

      {activeTab === 'availability' && (
        <AvailabilityTab
          rules={availRules}
          loading={availLoading}
          fetchAvailability={fetchAvailability}
          showAddRule={showAddRule}
          setShowAddRule={setShowAddRule}
          editingRule={editingRule}
          setEditingRule={setEditingRule}
          ruleForm={ruleForm}
          setRuleForm={setRuleForm}
          handleSaveRule={handleSaveRule}
          handleDeleteRule={handleDeleteRule}
          startEditRule={startEditRule}
          dayNames={dayNames}
          dayAbbr={dayAbbr}
        />
      )}

      {activeTab === 'families' && (
        <div>
          {assignments.length > 0 ? assignments.map((a, idx) => (
            <div key={idx} className="card" style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ margin: '0 0 4px', color: '#333' }}>
                    {a.recipient_first_name} {a.recipient_last_name}
                  </h3>
                  <div style={{ fontSize: '13px', color: '#666', marginBottom: '4px' }}>
                    Family: {a.family_first_name} {a.family_last_name}
                  </div>
                  <div style={{ fontSize: '13px', color: '#888' }}>
                    📍 {a.location_address ? `${a.location_address}, ` : ''}{a.location_city}, {a.location_state}
                  </div>
                  {a.health_conditions && a.health_conditions.length > 0 && (
                    <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {a.health_conditions.map((hc, i) => (
                        <span key={i} style={{
                          padding: '3px 8px', background: '#fff3e0', color: '#e65100',
                          borderRadius: '12px', fontSize: '11px',
                        }}>{hc}</span>
                      ))}
                    </div>
                  )}
                  {a.preferences && (
                    <div style={{ fontSize: '12px', color: '#666', marginTop: '6px', fontStyle: 'italic' }}>
                      Preferences: {a.preferences}
                    </div>
                  )}
                </div>
                {a.is_favorite === 1 && (
                  <span style={{ fontSize: '20px' }} title="Favorite assignment">⭐</span>
                )}
              </div>
            </div>
          )) : <div style={{ padding: '20px', color: '#999', textAlign: 'center' }}>No assigned families</div>}
        </div>
      )}

      {activeTab === 'map' && (
        <AreaMap />
      )}

      {activeTab === 'earnings' && (
        <div>
          {/* My Rates Card */}
          <div className="card" style={{ marginBottom: '16px' }}>
            <div className="card-header"><span className="card-icon">💲</span>My Rates</div>
            <div style={{ fontSize: '13px', color: '#666', marginBottom: '10px' }}>
              Set different rates for daytime, nighttime, and overnight shifts.
              Overnight sessions have a 6-hour minimum.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px', marginBottom: '10px' }}>
              <div>
                <label style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>
                  Daytime (7am–6pm)
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ color: '#666' }}>$</span>
                  <input type="number" step="0.50" min="1" max="500"
                    value={ratesDaytime}
                    onChange={e => setRatesDaytime(e.target.value)}
                    style={{ width: '80px', padding: '6px 8px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '14px' }}
                  />
                  <span style={{ fontSize: '12px', color: '#888' }}>/hr</span>
                </div>
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>
                  Nighttime (6pm–12am)
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ color: '#666' }}>$</span>
                  <input type="number" step="0.50" min="1" max="500"
                    value={ratesNighttime}
                    onChange={e => setRatesNighttime(e.target.value)}
                    style={{ width: '80px', padding: '6px 8px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '14px' }}
                  />
                  <span style={{ fontSize: '12px', color: '#888' }}>/hr</span>
                </div>
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>
                  Overnight (12am–7am)
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ color: '#666' }}>$</span>
                  <input type="number" step="0.50" min="1" max="500"
                    value={ratesOvernight}
                    onChange={e => setRatesOvernight(e.target.value)}
                    style={{ width: '80px', padding: '6px 8px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '14px' }}
                  />
                  <span style={{ fontSize: '12px', color: '#888' }}>/hr</span>
                  <span style={{ fontSize: '10px', color: '#e8724a', fontWeight: 600 }}>6hr min</span>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                disabled={ratesSaving}
                onClick={async () => {
                  setRatesSaving(true); setRatesMsg('');
                  try {
                    const res = await apiFetch('/api/caregivers/rates', {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        rateDaytime: parseFloat(ratesDaytime) || null,
                        rateNighttime: parseFloat(ratesNighttime) || null,
                        rateOvernight: parseFloat(ratesOvernight) || null,
                      }),
                    });
                    if (res?.ok) {
                      setRatesMsg('Rates saved!');
                      setTimeout(() => setRatesMsg(''), 3000);
                    } else {
                      const err = await res.json();
                      setRatesMsg(err.error || 'Failed to save');
                    }
                  } catch { setRatesMsg('Network error'); }
                  setRatesSaving(false);
                }}
                className="btn btn-primary"
                style={{ fontSize: '13px', padding: '7px 18px' }}>
                {ratesSaving ? 'Saving...' : 'Save Rates'}
              </button>
              {ratesMsg && (
                <span style={{ fontSize: '13px', color: ratesMsg === 'Rates saved!' ? '#2e7d32' : '#c62828' }}>
                  {ratesMsg}
                </span>
              )}
            </div>
            <div style={{ fontSize: '11px', color: '#999', marginTop: '8px' }}>
              Sessions booked less than 24 hours in advance incur a 20% short-notice surcharge (75% goes to you).
            </div>
          </div>

          {/* Stripe Connect Banner */}
          <div className="card" style={{ marginBottom: '16px', border: stripeStatus?.status === 'active' ? '1px solid #4caf50' : stripeStatus?.status === 'not_configured' ? '1px solid #e0e0e0' : '1px solid #ff9800' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '15px', color: '#333', marginBottom: '4px' }}>
                  {stripeStatus?.status === 'active' ? '✅ Stripe Connected'
                    : stripeStatus?.status === 'not_configured' ? '🔧 Payment Setup Coming Soon'
                    : '💳 Payment Setup'}
                </div>
                <div style={{ fontSize: '13px', color: '#666' }}>
                  {stripeStatus?.status === 'active'
                    ? 'Your Stripe account is active. Payouts are enabled.'
                    : stripeStatus?.status === 'not_configured'
                    ? 'Stripe payments are being set up for InPlace. You\'ll be able to connect your account here soon.'
                    : stripeStatus?.status === 'pending'
                    ? 'Your Stripe account is pending verification. Click below to complete setup.'
                    : 'Connect your Stripe account to receive payouts for care sessions.'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {stripeStatus?.status === 'active' ? (
                  <button onClick={handleStripeDashboard} className="btn btn-secondary" style={{ fontSize: '13px', padding: '8px 16px' }}>
                    View Stripe Dashboard
                  </button>
                ) : stripeStatus?.status === 'not_configured' ? null : (
                  <button onClick={handleStripeOnboard} disabled={stripeLoading} className="btn btn-primary" style={{ fontSize: '13px', padding: '8px 16px' }}>
                    {stripeLoading ? 'Loading...' : stripeStatus?.status === 'pending' ? 'Complete Setup' : 'Connect with Stripe'}
                  </button>
                )}
              </div>
            </div>
            {stripeError && (
              <div style={{
                marginTop: '10px', padding: '10px 14px', background: '#fce4ec', color: '#c62828',
                borderRadius: '8px', fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span>{stripeError}</span>
                <button onClick={() => setStripeError(null)} style={{
                  background: 'none', border: 'none', color: '#c62828', fontSize: '16px', cursor: 'pointer', padding: '0 4px',
                }}>&times;</button>
              </div>
            )}
          </div>

          <div className="earnings-grid">
            <div className="earning-card">
              <div className="earning-amount">${stats.monthlyEarnings || 0}</div>
              <div className="earning-label">Earned This Month</div>
            </div>
            <div className="earning-card">
              <div className="earning-amount">${stats.pendingEarnings || 0}</div>
              <div className="earning-label">Pending Payment</div>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><span className="card-icon">📊</span>Monthly Summary</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={{ padding: '12px', background: '#f8f9fa', borderRadius: '6px' }}>
                <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase' }}>Sessions Completed</div>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#333' }}>{stats.completedThisMonth || 0}</div>
              </div>
              <div style={{ padding: '12px', background: '#f8f9fa', borderRadius: '6px' }}>
                <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase' }}>Hours Worked</div>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#333' }}>{stats.hoursThisMonth || 0}</div>
              </div>
              <div style={{ padding: '12px', background: '#f8f9fa', borderRadius: '6px' }}>
                <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase' }}>Rates</div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#333', lineHeight: 1.5 }}>
                  Day ${profile.rateDaytime || profile.hourlyRate || '—'}<br/>
                  Night ${profile.rateNighttime || profile.hourlyRate || '—'}<br/>
                  Overnight ${profile.rateOvernight || profile.hourlyRate || '—'}
                </div>
              </div>
              <div style={{ padding: '12px', background: '#f8f9fa', borderRadius: '6px' }}>
                <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase' }}>Mileage</div>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#999' }}>—</div>
                <div style={{ fontSize: '10px', color: '#aaa' }}>Coming soon</div>
              </div>
            </div>
          </div>

          {/* Completed Sessions Breakdown */}
          <div className="card" style={{ marginTop: '16px' }}>
            <div className="card-header"><span className="card-icon">📋</span>Completed Sessions This Month</div>
            {earningsLoading ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#999' }}>Loading sessions...</div>
            ) : completedSessions.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
                      <th style={{ padding: '10px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Date</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Client</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Service</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right', color: '#666', fontWeight: 600 }}>Hours</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right', color: '#666', fontWeight: 600 }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {completedSessions.map((s) => (
                      <tr key={s.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '10px 12px' }}>
                          {(parseTimestamp(s.scheduled_date) || new Date(0)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </td>
                        <td style={{ padding: '10px 12px', fontWeight: 500 }}>{s.recipient_name || '—'}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{
                            padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 600,
                            background: '#f0faf8', color: '#1b6b5a', textTransform: 'capitalize',
                          }}>{(s.service_type || '').replace(/_/g, ' ')}</span>
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>{s.duration_hours || '—'}h</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: '#1b6b5a' }}>
                          ${(s.actual_cost || s.estimated_cost || 0).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid #e0e0e0' }}>
                      <td colSpan="3" style={{ padding: '10px 12px', fontWeight: 700 }}>Total</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>
                        {completedSessions.reduce((sum, s) => sum + (s.duration_hours || 0), 0).toFixed(1)}h
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: '#1b6b5a' }}>
                        ${completedSessions.reduce((sum, s) => sum + (s.actual_cost || s.estimated_cost || 0), 0).toFixed(2)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div style={{ padding: '20px', textAlign: 'center', color: '#999' }}>No completed sessions this month</div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'financials' && (
        <div>
          {/* Card 1: Stripe Connect Status */}
          <div className="card" style={{ marginBottom: '16px', border: stripeStatus?.status === 'active' ? '1px solid #4caf50' : '1px solid #e0e0e0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: '16px', marginBottom: '4px' }}>
                  {stripeStatus?.status === 'active' ? '✅ Stripe Connected' : '🏦 Set Up Stripe to Get Paid'}
                </div>
                <div style={{ fontSize: '13px', color: '#666' }}>
                  {stripeStatus?.status === 'active'
                    ? 'Your bank account is connected. Earnings are deposited automatically.'
                    : 'Connect your bank account through Stripe to receive payments for care sessions.'}
                </div>
              </div>
              {stripeStatus?.status === 'active' ? (
                <a href={stripeStatus.dashboardUrl || '#'} target="_blank" rel="noopener noreferrer"
                  style={{ padding: '8px 16px', background: '#635bff', color: '#fff', borderRadius: '6px', textDecoration: 'none', fontSize: '13px', fontWeight: 600 }}>
                  Stripe Dashboard →
                </a>
              ) : (
                <button onClick={async () => {
                  setStripeLoading(true);
                  try {
                    const res = await apiFetch('/api/payments/connect/onboard', { method: 'POST' });
                    if (res?.ok) {
                      const d = await res.json();
                      if (d.url) window.location.href = d.url;
                    }
                  } catch (err) { setStripeError(err.message); }
                  setStripeLoading(false);
                }} disabled={stripeLoading}
                  style={{ padding: '10px 20px', background: stripeLoading ? '#999' : '#635bff', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: 600, cursor: stripeLoading ? 'wait' : 'pointer' }}>
                  {stripeLoading ? '⏳ Loading...' : 'Connect with Stripe'}
                </button>
              )}
            </div>
            {stripeError && <div style={{ color: '#c62828', fontSize: '13px', marginTop: '8px' }}>{stripeError}</div>}
          </div>

          {/* Card 2: Payout Speed */}
          <div className="card" style={{ marginBottom: '16px' }}>
            <div className="card-header"><span className="card-icon">⚡</span>Payout Speed</div>
            <p style={{ fontSize: '13px', color: '#666', margin: '0 0 16px' }}>
              Choose how fast you receive your earnings after each completed session.
            </p>
            {payoutLoading ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#999' }}>Loading...</div>
            ) : (
              <div style={{ display: 'grid', gap: '12px' }}>
                {[
                  { id: 'standard', label: 'Standard (1–2 business days)', desc: 'Free — no additional fees', icon: '🏦' },
                  { id: 'instant', label: 'Instant (same day)', desc: '+2% surcharge per session', icon: '⚡' },
                ].map(opt => (
                  <div key={opt.id} onClick={() => !payoutSaving && setPayoutSpeed(opt.id)}
                    style={{
                      padding: '16px', borderRadius: '10px', cursor: payoutSaving ? 'wait' : 'pointer',
                      border: payoutSpeed === opt.id ? '2px solid #1b6b5a' : '1px solid #e0e0e0',
                      background: payoutSpeed === opt.id ? '#f0faf8' : '#fff',
                      transition: 'all 0.2s',
                    }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '24px' }}>{opt.icon}</span>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '14px', color: payoutSpeed === opt.id ? '#1b6b5a' : '#333' }}>{opt.label}</div>
                        <div style={{ fontSize: '12px', color: '#999', marginTop: '2px' }}>{opt.desc}</div>
                      </div>
                      {payoutSpeed === opt.id && (
                        <div style={{ marginLeft: 'auto', color: '#1b6b5a', fontSize: '18px' }}>✓</div>
                      )}
                    </div>
                  </div>
                ))}
                <button onClick={() => savePayoutPreference(payoutSpeed)} disabled={payoutSaving}
                  style={{
                    padding: '10px 20px', borderRadius: '8px', border: 'none',
                    background: payoutSaving ? '#999' : '#1b6b5a', color: '#fff',
                    fontSize: '14px', fontWeight: 600, cursor: payoutSaving ? 'wait' : 'pointer',
                    marginTop: '4px',
                  }}>
                  {payoutSaving ? '⏳ Saving...' : 'Save Preference'}
                </button>
                {payoutSpeed === 'instant' && (
                  <div style={{ fontSize: '13px', color: '#e65100', background: '#fff3e0', padding: '10px 14px', borderRadius: '8px' }}>
                    💡 <strong>Example:</strong> On a $100 session, instant payout costs you $2.00 (2% surcharge). Standard payout is always free.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Card 3: Background Check Payment */}
          <div className="card" style={{ marginBottom: '16px' }}>
            <div className="card-header"><span className="card-icon">🔍</span>Background Check</div>
            {bgCheckPaid || profile?.background_check_paid ? (
              <div style={{ padding: '16px', background: '#e8f5e9', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '28px' }}>✅</span>
                <div>
                  <div style={{ fontWeight: 600, color: '#2e7d32' }}>Background check payment received</div>
                  <div style={{ fontSize: '13px', color: '#558b2f', marginTop: '2px' }}>Your Checkr screening is being processed.</div>
                </div>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: '13px', color: '#666', margin: '0 0 16px' }}>
                  A $30 background check fee is required before you can accept care requests. This covers your Checkr background screening.
                </p>
                <StripePaymentForm
                  amount={30}
                  description="One-time background check fee for Checkr screening"
                  buttonText="Pay $30.00 — Background Check"
                  onSuccess={() => {
                    setBgCheckPaid(true);
                    // Refresh profile data
                    apiFetch('/api/caretaker/dashboard').then(r => r?.ok && r.json().then(d => setData(d))).catch(() => {});
                  }}
                  onError={(msg) => console.error('BG check payment error:', msg)}
                />
                <p style={{ fontSize: '12px', color: '#999', marginTop: '12px', textAlign: 'center' }}>
                  🔄 $30 refunded to your InPlace account after 10 completed sessions.
                </p>
              </div>
            )}
          </div>

          {/* Fee Breakdown Info */}
          <div style={{ padding: '14px 16px', background: '#f8f9fa', borderRadius: '8px', fontSize: '13px', color: '#666' }}>
            💡 <strong>How fees work:</strong> InPlace charges a 15% platform fee on each session. Families pay via card or ACH at checkout.
            Your earnings (85% of session cost) are deposited to your Stripe account based on your payout speed preference above.
          </div>
        </div>
      )}

      {activeTab === 'reviews' && (
        <div>
          <div className="card">
            <div className="card-header"><span className="card-icon">⭐</span>Reviews ({profile.rating || '—'} avg, {profile.reviewCount || 0} total)</div>
            {reviews.length > 0 ? reviews.map((r, idx) => (
              <div key={idx} className="review-item">
                <div className="review-header">
                  <div className="review-name">{r.reviewerName}</div>
                  <div className="review-rating">{'⭐'.repeat(r.rating)}</div>
                </div>
                {r.comment && <div className="review-text">{r.comment}</div>}
                <div style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>{r.createdAt}</div>
              </div>
            )) : <div style={{ padding: '20px', color: '#999', textAlign: 'center' }}>No reviews yet</div>}
          </div>

          {/* Certifications */}
          <div className="card">
            <div className="card-header"><span className="card-icon">📜</span>Certifications</div>
            <div style={{ display: 'grid', gap: '12px' }}>
              {(profile.certifications || []).map((cert, idx) => (
                <div key={idx} style={{ padding: '12px', background: '#f8f9fa', borderRadius: '6px' }}>
                  <strong>{cert}</strong>
                </div>
              ))}
              {(!profile.certifications || profile.certifications.length === 0) && (
                <div style={{ color: '#999', padding: '12px' }}>No certifications listed</div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'preferences' && (
        <div>
          <div className="card" style={{ marginBottom: '16px' }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span><span className="card-icon">🚦</span>Care Task Preferences (Stoplight Chart)</span>
              {!editingStoplight && (
                <button onClick={() => { setEditingStoplight(true); setStoplightForm(stoplightData || {}); }} style={{
                  background: '#1b6b5a', color: 'white', border: 'none', borderRadius: '6px',
                  padding: '6px 14px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                }}>{stoplightData ? 'Edit' : 'Set Preferences'}</button>
              )}
            </div>
            <p style={{ fontSize: '13px', color: '#666', margin: '0 0 16px' }}>
              Rate each care task to let families know what you're comfortable with.
              <span style={{ display: 'inline-block', margin: '0 6px', padding: '2px 8px', background: '#e8f5e9', color: '#2e7d32', borderRadius: '10px', fontSize: '11px', fontWeight: 600 }}>Green = Comfortable</span>
              <span style={{ display: 'inline-block', margin: '0 6px', padding: '2px 8px', background: '#fff8e1', color: '#f57f17', borderRadius: '10px', fontSize: '11px', fontWeight: 600 }}>Yellow = With Supervision</span>
              <span style={{ display: 'inline-block', margin: '0 6px', padding: '2px 8px', background: '#fce4ec', color: '#c62828', borderRadius: '10px', fontSize: '11px', fontWeight: 600 }}>Red = Not Comfortable</span>
            </p>

            {editingStoplight ? (
              <div>
                {CARE_TASKS.map(task => {
                  const val = stoplightForm[task] || '';
                  return (
                    <div key={task} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #f0f0f0' }}>
                      <span style={{ fontSize: '13px', color: '#333', flex: 1 }}>{task}</span>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {[{ v: 'green', bg: '#e8f5e9', border: '#2e7d32', label: '✓' },
                          { v: 'yellow', bg: '#fff8e1', border: '#f57f17', label: '~' },
                          { v: 'red', bg: '#fce4ec', border: '#c62828', label: '✕' }].map(opt => (
                          <button key={opt.v} onClick={() => setStoplightForm(f => ({ ...f, [task]: opt.v }))} style={{
                            width: '32px', height: '32px', borderRadius: '50%', border: val === opt.v ? `3px solid ${opt.border}` : '2px solid #ddd',
                            background: val === opt.v ? opt.bg : '#fff', cursor: 'pointer', fontSize: '14px', fontWeight: 700,
                            color: opt.border, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>{opt.label}</button>
                        ))}
                      </div>
                    </div>
                  );
                })}
                <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                  <button onClick={() => setEditingStoplight(false)} style={{
                    padding: '10px 20px', border: '1px solid #ddd', background: '#fff', borderRadius: '8px', cursor: 'pointer', fontSize: '13px',
                  }}>Cancel</button>
                  <button onClick={saveStoplight} style={{
                    flex: 1, padding: '10px', background: '#1b6b5a', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                  }}>Save Preferences</button>
                </div>
              </div>
            ) : stoplightData ? (
              <div style={{ display: 'grid', gap: '16px' }}>
                {[
                  { color: 'green', label: 'Comfortable With', bg: '#e8f5e9', text: '#2e7d32', icon: '✓' },
                  { color: 'yellow', label: 'With Supervision', bg: '#fff8e1', text: '#f57f17', icon: '~' },
                  { color: 'red', label: 'Not Comfortable', bg: '#fce4ec', text: '#c62828', icon: '✕' },
                ].map(group => {
                  const tasks = CARE_TASKS.filter(t => stoplightData[t] === group.color);
                  if (tasks.length === 0) return null;
                  return (
                    <div key={group.color}>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px',
                        padding: '6px 12px', background: group.bg, borderRadius: '8px',
                      }}>
                        <span style={{
                          width: '22px', height: '22px', borderRadius: '50%', background: group.text,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: '#fff', fontSize: '12px', fontWeight: 700, flexShrink: 0,
                        }}>{group.icon}</span>
                        <span style={{ fontSize: '14px', fontWeight: 700, color: group.text }}>{group.label}</span>
                        <span style={{ fontSize: '12px', color: group.text, opacity: 0.7, marginLeft: 'auto' }}>{tasks.length} task{tasks.length > 1 ? 's' : ''}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', paddingLeft: '4px' }}>
                        {tasks.map(task => (
                          <span key={task} style={{
                            padding: '4px 10px', background: group.bg, borderRadius: '14px',
                            fontSize: '12px', color: group.text, fontWeight: 500,
                          }}>{task}</span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ padding: '20px', textAlign: 'center', color: '#999' }}>
                No preferences set yet. Click "Set Preferences" to get started.
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'documents' && (
        <div>
          <div className="card">
            <div className="card-header"><span className="card-icon">📄</span>Uploaded Documents</div>
            <p style={{ fontSize: 13, color: '#666', margin: '0 0 16px' }}>
              Documents submitted during onboarding. Contact support if you need to update your identity documents.
            </p>
            {docsLoading ? (
              <div style={{ padding: 20, textAlign: 'center', color: '#999' }}>Loading documents...</div>
            ) : documents.length > 0 ? (
              <div style={{ display: 'grid', gap: 12 }}>
                {documents.map(doc => {
                  const typeLabels = { dl_front: "Driver's License (Front)", dl_back: "Driver's License (Back)", selfie: 'Selfie / Photo ID', certification: 'Certification' };
                  return (
                    <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: '#f8f9fa', borderRadius: 8 }}>
                      <div style={{ width: 60, height: 60, borderRadius: 6, overflow: 'hidden', flexShrink: 0, background: '#e0e0e0' }}>
                        <img src={`/api/caregiver-onboarding/documents/${doc.id}/image`} alt={doc.document_type}
                          style={{ width: 60, height: 60, objectFit: 'cover' }}
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, color: '#333' }}>{typeLabels[doc.document_type] || doc.document_type}</div>
                        {doc.file_name && <div style={{ fontSize: 12, color: '#888' }}>{doc.file_name}</div>}
                        <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>
                          Uploaded {(parseTimestamp(doc.created_at) || new Date(0)).toLocaleDateString()}
                        </div>
                      </div>
                      <div style={{ padding: '4px 10px', background: '#e8f5e9', color: '#2e7d32', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
                        Submitted
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ padding: 20, textAlign: 'center', color: '#999' }}>
                No documents uploaded yet. Documents are submitted during the onboarding process.
              </div>
            )}
          </div>

          {/* Profile Summary */}
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-header"><span className="card-icon">👤</span>Onboarding Information</div>
            <div className="info-grid">
              <div className="info-item">
                <div className="info-label">Legal Name</div>
                <div className="info-value">{profile.legalFirstName && profile.legalLastName ? `${profile.legalFirstName} ${profile.legalLastName}` : 'Not provided'}</div>
              </div>
              <div className="info-item">
                <div className="info-label">Date of Birth</div>
                <div className="info-value">{profile.dateOfBirth || 'Not provided'}</div>
              </div>
              <div className="info-item">
                <div className="info-label">SSN (last 4)</div>
                <div className="info-value">{profile.ssnLast4 ? `***-**-${profile.ssnLast4}` : 'Not provided'}</div>
              </div>
              <div className="info-item">
                <div className="info-label">Driver's License</div>
                <div className="info-value">{profile.dlNumber ? `${profile.dlNumber} (${profile.dlState})` : 'Not provided'}</div>
              </div>
              <div className="info-item">
                <div className="info-label">Background Check</div>
                <div className="info-value">
                  <span style={{
                    padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
                    background: profile.checkrStatus === 'clear' ? '#e8f5e9' : profile.checkrStatus === 'pending' ? '#fff8e1' : '#fce4ec',
                    color: profile.checkrStatus === 'clear' ? '#2e7d32' : profile.checkrStatus === 'pending' ? '#f57f17' : '#c62828',
                  }}>
                    {(profile.checkrStatus || 'pending').charAt(0).toUpperCase() + (profile.checkrStatus || 'pending').slice(1)}
                  </span>
                </div>
              </div>
              <div className="info-item">
                <div className="info-label">Onboarding Status</div>
                <div className="info-value">
                  <span style={{
                    padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
                    background: profile.onboardingComplete ? '#e8f5e9' : '#fff8e1',
                    color: profile.onboardingComplete ? '#2e7d32' : '#f57f17',
                  }}>
                    {profile.onboardingComplete ? 'Complete' : 'Incomplete'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

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
              {visitLogSession.date} at {visitLogSession.time} &bull; {visitLogSession.serviceType}
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
    </div>
  );
};
