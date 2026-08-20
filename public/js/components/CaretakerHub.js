// ─── Check-out draft persistence (prevents feedback loss on refresh/interruption) ───
// Keyed by sessionId — each session is globally unique and assigned to one caregiver.
// Cleared only on successful submit or offline-queue hand-off (see onClick below).
const CHECKOUT_DRAFT_KEY_PREFIX = 'ip_checkout_draft:';
const loadCheckOutDraft = (sessionId) => {
  try {
    if (!sessionId) return null;
    const raw = localStorage.getItem(CHECKOUT_DRAFT_KEY_PREFIX + sessionId);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};
const saveCheckOutDraft = (sessionId, draft) => {
  try {
    if (!sessionId) return;
    localStorage.setItem(CHECKOUT_DRAFT_KEY_PREFIX + sessionId, JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {}
};
const clearCheckOutDraft = (sessionId) => {
  try {
    if (!sessionId) return;
    localStorage.removeItem(CHECKOUT_DRAFT_KEY_PREFIX + sessionId);
  } catch {}
};

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
  const [checkInMood, setCheckInMood] = useState([]);
  const [checkInNotes, setCheckInNotes] = useState(null);
  const [checkOutSession, setCheckOutSession] = useState(null);
  const [checkOutMood, setCheckOutMood] = useState([]);
  const [checkOutTags, setCheckOutTags] = useState([]);
  const [checkOutCareFeedback, setCheckOutCareFeedback] = useState('');
  const [checkOutServiceFeedback, setCheckOutServiceFeedback] = useState('');
  const [checkOutSummary, setCheckOutSummary] = useState('');
  const [checkOutPhotos, setCheckOutPhotos] = useState([]);
  const [checkOutPhotoUrls, setCheckOutPhotoUrls] = useState([]);
  const checkOutPhotoRef = useRef(null);
  const [checkSubmitting, setCheckSubmitting] = useState(false);
  const [earlyDepartureReason, setEarlyDepartureReason] = useState('');
  const [earlyDepartureAcked, setEarlyDepartureAcked] = useState(false);
  // Draft-persistence bookkeeping — shows a "Draft restored" badge when we rehydrate,
  // and gates the auto-save effect so it doesn't overwrite a stored draft with empty
  // state before rehydrate runs on the fresh session.
  const [draftRestored, setDraftRestored] = useState(false);
  const rehydratedSessionIdRef = useRef(null);
  const [checkInLocation, setCheckInLocation] = useState(null);
  const [locationError, setLocationError] = useState(null);
  const [checkOutLocation, setCheckOutLocation] = useState(null);
  const [onMyWaySent, setOnMyWaySent] = useState({}); // { [sessionId]: true }
  const [onMyWaySending, setOnMyWaySending] = useState(null);
  // Live countdown tick state — interval set up later after sessions are derived
  const [countdownTick, setCountdownTick] = useState(0);

  // Care briefing state (pre-check-in review)
  const [briefingData, setBriefingData] = useState(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingAcked, setBriefingAcked] = useState(false);
  const [checkInStep, setCheckInStep] = useState('briefing'); // 'briefing' | 'first-visit' | 'checkin'
  // First-visit confirmation state
  const [firstVisitNeeded, setFirstVisitNeeded] = useState(false);
  const [firstVisitName, setFirstVisitName] = useState('');
  const [firstVisitChoice, setFirstVisitChoice] = useState(''); // 'yes' | 'no' | 'unable'
  const [firstVisitNotes, setFirstVisitNotes] = useState('');
  const [firstVisitSubmitting, setFirstVisitSubmitting] = useState(false);
  // Check-in UX improvement state
  const [exitWarningOpen, setExitWarningOpen] = useState(false);
  const [continueHintVisible, setContinueHintVisible] = useState(false);
  const [continueShaking, setContinueShaking] = useState(false);
  const [incompleteCheckIn, setIncompleteCheckIn] = useState(null); // { sessionId, session, startedAt }
  const incompleteTimerRef = useRef(null);
  // Expandable care profile state (Up Next cards)
  const [expandedProfileId, setExpandedProfileId] = useState(null);
  const [profileBriefings, setProfileBriefings] = useState({}); // sessionId -> briefing data
  const [profileLoading, setProfileLoading] = useState(null);
  const avatarInputRef = useRef(null);
  const tabContentRef = useRef(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  // Time change proposal state
  const [timeChangeModal, setTimeChangeModal] = useState(null); // { sessionId, session }
  const [timeChangeProposal, setTimeChangeProposal] = useState(null); // fetched pending proposal for acknowledge
  const [tcNewTime, setTcNewTime] = useState('');
  const [tcNewDuration, setTcNewDuration] = useState('');
  const [tcReason, setTcReason] = useState('');
  const [tcLoading, setTcLoading] = useState(false);
  const [tcRespondLoading, setTcRespondLoading] = useState(false);
  const [highlightTab, setHighlightTab] = useState(false);
  const [jobSort, setJobSort] = useState('best_match');
  // v1.105.106 — a TIMESTAMP, not a tick counter.
  //
  // `exclusiveTick` was incremented every 30s purely to force a re-render, and never read.
  // Every place that needed "is this offer still exclusive?" then called `new Date()` DURING
  // RENDER — twice, in two filters that must agree, plus once more per card for the countdown.
  //
  // That makes list membership depend on the wall clock at the instant React happens to
  // render. Tap "Read more" on a job whose window has just lapsed and the split is recomputed:
  // the "Just for You" section returns null, the card reappears further down in Find Work, and
  // from the outside "the Accept Job button disappears and reappears" — Julia, dc5e86b5 —
  // while the description she was trying to read is unchanged, because that was never what
  // moved.
  //
  // One `now`, changed only by the ticker. The boundary can now only move on a tick, never on
  // an unrelated re-render, and the two filters cannot disagree with each other or with the
  // "N min left" printed on the card.
  const [exclusiveNow, setExclusiveNow] = useState(() => Date.now());
  const calendarRef = useRef(null);
  const [claimingJobId, setClaimingJobId] = useState(null);
  const [cancellingJobId, setCancellingJobId] = useState(null);
  // Propose different time (for conflict jobs on dashboard)
  const [proposingFor, setProposingFor] = useState(null);
  const [proposalDate, setProposalDate] = useState('');
  const [proposalTime, setProposalTime] = useState('');
  const [proposalMsg, setProposalMsg] = useState('');
  const [proposalLoading, setProposalLoading] = useState(false);
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
  // Manual payments received
  const [manualPaymentsReceived, setManualPaymentsReceived] = useState([]);
  const [completedPaymentCount, setCompletedPaymentCount] = useState(null);
  // In-app notifications (v1.56.0)
  const [notifications, setNotifications] = useState([]);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  // Tips state
  const [tipsData, setTipsData] = useState(null);
  const [showTipsSection, setShowTipsSection] = useState(false);

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

  // Stripe Identity Verification state
  // v1.105.75 — `loaded` matters: before it is true we have not ASKED yet, and "we haven't
  // asked" must not render as "you haven't submitted". That conflation is the same shape as the
  // selfie's 0% in v1.105.73 — an absent value rendered as a verdict.
  const [idVerification, setIdVerification] = useState({ verified: false, status: 'unknown', loaded: false });
  // v1.105.84 — the third answer to a care request. Accept and "propose a different time" were
  // the only two, so a request she could not take had no exit and the family got no signal.
  //
  // v1.105.87 — these three lived below `if (loading) return <LoadingSpinner/>`. On the loading
  // render they never ran; on the next render they did, so React saw more hooks than the
  // previous render and threw. That is the white screen Julia hit. Hooks must be unconditional
  // and above every early return — mine were neither.
  // v1.105.88 — Julia's first feedback: "When a job comes up, I should be able to click on
  // the description and expand it. I can't as is." It was truncated at 150 characters with no
  // way to see the rest — which is the part that tells her whether she wants the job.
  const [expandedSummaryJobId, setExpandedSummaryJobId] = useState(null);

  // v1.105.100 — "Not for me" on an OPEN job. It is not a decline: nobody offered it to her,
  // so there is no family waiting on an answer and nothing to send. It just stops cluttering
  // her list. Kept on the device deliberately — a local preference about a public listing does
  // not belong in anyone's care record, and a family should not be told that a caregiver they
  // never approached passed on their job.
  const [hiddenJobIds, setHiddenJobIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('inplace.hiddenOpenJobs') || '[]')); }
    catch { return new Set(); }   // storage throws in private mode / locked-down webviews (v1.105.35)
  });
  const hideOpenJob = (jobId) => {
    setHiddenJobIds((prev) => {
      const next = new Set(prev); next.add(jobId);
      try { localStorage.setItem('inplace.hiddenOpenJobs', JSON.stringify([...next])); } catch {}
      return next;
    });
    showToast('Hidden from your list', 'info');
  };

  const [decliningJob, setDecliningJob] = useState(null);
  const [declineReason, setDeclineReason] = useState('');
  const [decliningBusy, setDecliningBusy] = useState(false);
  // v1.105.82 — a care-team invite waiting on this caregiver. The banner for these has existed
  // since care teams shipped, on Dashboard — the FAMILY home screen. A caregiver lands on this
  // component and never sees Dashboard, so Julia clicked her invite email, opened the app, and
  // there was nothing there. Pete: "it's gone. can't find it."
  const [pendingInvites, setPendingInvites] = useState([]);
  const [acceptingInviteId, setAcceptingInviteId] = useState(null);
  const [idVerLoading, setIdVerLoading] = useState(false);
  const [idVerError, setIdVerError] = useState(null);

  // Platform config (which services are configured)
  const [platformConfig, setPlatformConfig] = useState({ stripeConfigured: true, checkrConfigured: true });

  // Payout speed managed by Stripe directly — no surcharge from InPlace
  const [bgCheckPaid, setBgCheckPaid] = useState(false);

  // Referral & milestone state
  const [referralData, setReferralData] = useState(null);
  const [showReferralQr, setShowReferralQr] = useState(false); // v1.105.26
  const [referralList, setReferralList] = useState([]);
  const [refName, setRefName] = useState('');
  const [refEmail, setRefEmail] = useState('');
  const [refPhone, setRefPhone] = useState('');
  const [refSending, setRefSending] = useState(false);
  const [refMsg, setRefMsg] = useState('');
  const [showReferralSection, setShowReferralSection] = useState(false);
  const [milestones, setMilestones] = useState([]);
  const [unackedMilestones, setUnackedMilestones] = useState([]);

  // Documents state
  const [documents, setDocuments] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docUploading, setDocUploading] = useState(null); // which doc type is uploading
  const docInputRef = useRef(null);
  const [pendingDocType, setPendingDocType] = useState(null);

  const [visitDetailSessionId, setVisitDetailSessionId] = useState(null);

  // ─── Deep-link focus: open the exact visit (v1.105.105) ───
  //
  // `window.__pendingFocus` has been SET in four places in app.js since v1.97 — a `?focus=`
  // URL param, a push tap, and two `session:<id>` paths — and until now it was READ in exactly
  // one: Reimbursements.js. Every `session:` focus was written and discarded. So tapping a
  // schedule-change push, or "1 schedule change waiting on your answer" in the Needs-you card,
  // landed you on the dashboard with nothing open. Pete: "it doesn't do anything. It is a dead
  // end." (917f3787.)
  //
  // Cleared as soon as it is claimed, so a later remount does not reopen a modal the person
  // has closed. Left in place when the id is not ours to handle, so another consumer can.
  useEffect(() => {
    const claim = () => {
      const f = window.__pendingFocus;
      if (!f || typeof f !== 'string' || !f.startsWith('session:')) return;
      const id = f.slice('session:'.length);
      if (!id) return;
      window.__pendingFocus = null;
      setVisitDetailSessionId(id);
    };
    claim();
    // A push tap or a ?focus= param arrives before this mounts, so claim() on mount covers
    // those. The Needs-you card is rendered INSIDE this component and navigates with
    // setCurrentPage, which does not bump pageNavCount and therefore does not remount us —
    // so it also announces itself, and we claim again.
    window.addEventListener('inplace:focus', claim);
    return () => window.removeEventListener('inplace:focus', claim);
  }, []);

  const [expandedScheduledId, setExpandedScheduledId] = useState(null);

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

  const fetchReviews = async () => {
    try {
      const res = await apiFetch('/api/caregivers/me/reviews');
      if (res?.ok) {
        const d = await res.json();
        setReviews(d.reviews || []);
      }
    } catch (err) { console.error('Reviews fetch error:', err); }
  };

  // ─── Check-out draft: rehydrate when the modal opens for a session ───
  // Runs when the session id changes. If a draft exists for that session,
  // populate mood/tags/text fields and show the "Draft restored" badge.
  // Sets rehydratedSessionIdRef BEFORE the auto-save effect runs, so the
  // save effect won't wipe the stored draft with empty reset values.
  useEffect(() => {
    if (!checkOutSession?.id) {
      rehydratedSessionIdRef.current = null;
      setDraftRestored(false);
      return;
    }
    const draft = loadCheckOutDraft(checkOutSession.id);
    if (draft) {
      if (Array.isArray(draft.mood)) setCheckOutMood(draft.mood);
      if (Array.isArray(draft.tags)) setCheckOutTags(draft.tags);
      if (typeof draft.summary === 'string') setCheckOutSummary(draft.summary);
      if (typeof draft.serviceFeedback === 'string') setCheckOutServiceFeedback(draft.serviceFeedback);
      if (typeof draft.earlyDepartureReason === 'string') {
        setEarlyDepartureReason(draft.earlyDepartureReason);
        if (draft.earlyDepartureReason.trim()) setEarlyDepartureAcked(true);
      }
      setDraftRestored(true);
    } else {
      setDraftRestored(false);
    }
    rehydratedSessionIdRef.current = checkOutSession.id;
  }, [checkOutSession?.id]);

  // ─── Check-out draft: auto-save on every change ───
  // Only saves once rehydrate has run for the current session (guarded by ref),
  // and only if there's something worth saving — avoids stomping a stored
  // draft with the empty reset that happens when "Check Out" is first tapped.
  useEffect(() => {
    if (!checkOutSession?.id) return;
    if (rehydratedSessionIdRef.current !== checkOutSession.id) return;
    const hasContent = (
      (checkOutMood && checkOutMood.length > 0) ||
      (checkOutTags && checkOutTags.length > 0) ||
      (checkOutSummary && checkOutSummary.trim()) ||
      (checkOutServiceFeedback && checkOutServiceFeedback.trim()) ||
      (earlyDepartureReason && earlyDepartureReason.trim())
    );
    if (!hasContent) return;
    saveCheckOutDraft(checkOutSession.id, {
      mood: checkOutMood,
      tags: checkOutTags,
      summary: checkOutSummary,
      serviceFeedback: checkOutServiceFeedback,
      earlyDepartureReason,
    });
  }, [checkOutSession?.id, checkOutMood, checkOutTags, checkOutSummary, checkOutServiceFeedback, earlyDepartureReason]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await apiFetch('/api/dashboard');
        if (res?.ok) {
          const d = await res.json();
          setData(d);
          // Always fetch availability, stripe status, and platform config for accurate step tracking
          fetchAvailability();
          apiFetch('/api/payments/connect/status').then(r => r?.ok && r.json().then(s => setStripeStatus(s))).catch(() => {});
          apiFetch('/api/caregivers/platform-config').then(r => r?.ok && r.json().then(c => setPlatformConfig(c))).catch(() => {});
          // Fetch referral data and milestones
          apiFetch('/api/referrals/my-code').then(r => r?.ok && r.json().then(d => setReferralData(d))).catch(() => {});
          apiFetch('/api/referrals/list').then(r => r?.ok && r.json().then(d => setReferralList(d.referrals || []))).catch(() => {});
          apiFetch('/api/referrals/milestones').then(r => r?.ok && r.json().then(d => { setMilestones(d.milestones || []); setUnackedMilestones(d.unacknowledged || []); })).catch(() => {});
          // In-app notifications (v1.56.0)
          apiFetch('/api/push/notifications?limit=10').then(r => r?.ok && r.json().then(d => { setNotifications(d.notifications || []); setUnreadNotifCount(d.unreadCount || 0); })).catch(() => {});
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

  // Tick timer for exclusive offer countdowns (every 30s)
  useEffect(() => {
    const hasExclusive = data?.openJobs?.some(j => j.exclusiveUntil || j.exclusive_until);
    if (!hasExclusive) return;
    const iv = setInterval(() => setExclusiveNow(Date.now()), 30000);
    return () => clearInterval(iv);
  }, [data?.openJobs]);

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

  // Listen for time change WebSocket events — refresh dashboard
  useEffect(() => {
    if (typeof onSocketEvent !== 'function') return;
    const c1 = onSocketEvent('time_change_proposed', () => {
      apiFetch('/api/dashboard').then(res => res?.ok && res.json().then(d => setData(d))).catch(() => {});
    });
    const c2 = onSocketEvent('time_change_accepted', () => {
      apiFetch('/api/dashboard').then(res => res?.ok && res.json().then(d => setData(d))).catch(() => {});
    });
    const c3 = onSocketEvent('time_change_rejected', () => {
      apiFetch('/api/dashboard').then(res => res?.ok && res.json().then(d => setData(d))).catch(() => {});
    });
    return () => { if (c1) c1(); if (c2) c2(); if (c3) c3(); };
  }, []);

  // Mark availability as visited when the tab is opened
  useEffect(() => {
    if (activeTab === 'availability') setAvailVisited(true);
  }, [activeTab]);

  // Fetch completed sessions when earnings tab is active
  // ─── Account status the WHOLE hub depends on (v1.105.75) ───
  //
  // These two fetches used to live inside the effect below, behind
  // `if (activeTab !== 'earnings') return;`. The hub opens on 'schedule'. So on the screen a
  // caregiver actually lands on, neither had ever run, and both states sat at their initial
  // values — which read as "no" everywhere:
  //
  //   idVerification  → First Steps told an APPROVED caregiver "Take a selfie and photo of
  //                     your ID". That is what Julia saw, and what Pete saw impersonating her,
  //                     while the admin panel (which asks the server directly) said verified.
  //   stripeStatus    → First Steps said "Connect Stripe to continue" to someone already
  //                     connected AND, worse, it is one of the six terms in _autoStepCount
  //                     below. That count never reached 6, so the auto-complete effect never
  //                     fired and onboarding stayed false forever. v1.105.68 fixed the VOUCH
  //                     term of that same count for exactly this reason and did not notice
  //                     that another term was only fetched on a tab most caregivers never open.
  //
  // Because the checklist could never complete, `showFirstSteps` never went false either — so
  // the whole "complete your profile" panel stayed on screen permanently. Pete: "it still has
  // lots of complete your profile verify your identity. Crap she has to deal with."
  //
  // Runs on mount, tab-independent. Nothing about identity or payouts is an earnings concern.
  useEffect(() => {
    let cancelled = false;

    // v1.105.64 — this asks the endpoint the GATE reads. It used to ask
    // /api/payments/identity/status, which is Stripe Identity: a third system nothing gates on.
    const checkIdentity = async () => {
      try {
        const res = await apiFetch('/api/caregiver-onboarding/identity-status');
        if (cancelled) return;
        if (res?.ok) {
          const d = await res.json();
          if (!cancelled) setIdVerification({ submitted: !!d.submitted, status: d.status, verified: d.status === 'approved', loaded: true });
        } else if (!cancelled) {
          setIdVerification({ submitted: false, status: null, verified: false, loaded: true, loadFailed: true });
        }
      } catch (err) {
        if (!cancelled) setIdVerification({ submitted: false, status: null, verified: false, loaded: true, loadFailed: true });
      }
    };

    const checkStripe = async () => {
      try {
        const sRes = await apiFetch('/api/payments/connect/status');
        if (sRes?.ok && !cancelled) {
          const sData = await sRes.json();
          if (!cancelled) setStripeStatus(sData);
        }
      } catch (err) { /* Stripe not configured yet — that's ok */ }
    };

    const checkInvites = async () => {
      try {
        const res = await apiFetch('/api/care-teams/my-pending-invites');
        if (!cancelled && res?.ok) { const d = await res.json(); setPendingInvites(d.invites || []); }
      } catch { /* the hub still works without it */ }
    };

    checkIdentity();
    checkStripe();
    checkInvites();
    return () => { cancelled = true; };
  }, []);

  const acceptInvite = async (invite) => {
    setAcceptingInviteId(invite.id);
    try {
      const res = await apiFetch('/api/care-teams/accept-invite', {
        method: 'POST',
        body: JSON.stringify({ token: invite.token }),
      });
      const d = await res?.json().catch(() => ({}));
      if (res?.ok) {
        showToast(`You're on ${invite.recipient_first_name || 'the'} care team`, 'success');
        setPendingInvites((prev) => prev.filter((i) => i.id !== invite.id));
      } else if (res?.status === 409 && d?.needsLegalAcceptance) {
        // v1.105.78 gates joining on the privacy statement. Say which document, rather than
        // failing with something generic.
        showToast(d.error || 'Please accept the privacy statement first', 'error');
      } else {
        showToast(d?.error || 'Could not accept that invite', 'error');
      }
    } catch {
      showToast('Could not accept that invite — check your connection', 'error');
    }
    setAcceptingInviteId(null);
  };

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

    // Fetch tips
    const fetchTips = async () => {
      try {
        const tRes = await apiFetch('/api/sessions/tips/caregiver');
        if (tRes?.ok) {
          const td = await tRes.json();
          setTipsData(td);
        }
      } catch (err) { /* tips not available yet */ }
    };
    fetchTips();

    // Fetch manual payments received (bonuses, direct sends from families)
    const fetchManualPayments = async () => {
      try {
        const res = await apiFetch('/api/payments/earnings');
        if (res?.ok) {
          const d = await res.json();
          setManualPaymentsReceived(d.manualPayments || []);
          setCompletedPaymentCount((d.totalSessions || 0) + (d.manualPayments || []).length);
        }
      } catch (err) { /* earnings endpoint not available yet */ }
    };
    fetchManualPayments();

  }, [activeTab]);

  // Stripe Connect embedded onboarding state
  const [showStripeOnboarding, setShowStripeOnboarding] = useState(false);
  const stripeOnboardingRef = useRef(null);
  const stripeConnectInstanceRef = useRef(null);

  // Load care preferences from profile (try care_preferences first, fall back to care_stoplight)
  useEffect(() => {
    const raw = data?.profile?.care_preferences || data?.profile?.care_stoplight;
    if (!raw) return;
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      setStoplightData(parsed);
      setStoplightForm(parsed);
    } catch { /* ignore */ }
  }, [data?.profile?.care_preferences, data?.profile?.care_stoplight]);

  // Fetch documents when documents tab is active
  useEffect(() => {
    if (activeTab === 'documents') fetchDocuments();
  }, [activeTab]);

  // Fetch payout preference when financials tab is active
  // Set bgCheckPaid from profile data on load
  useEffect(() => {
    if (data?.profile) {
      setBgCheckPaid(!!data.profile.background_check_paid || !!data.profile.isBackgroundChecked);
    }
  }, [data?.profile?.background_check_paid, data?.profile?.isBackgroundChecked]);

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
    // v1.105.68 — an active admin vouch counts here, because it counts on the SERVER. The gate
    // in routes/caregivers.js has accepted a vouch in place of a background check since
    // v1.64.0; this counter never did. So a vouched caregiver — the friend-of-the-family case
    // the vouch exists for — could satisfy every requirement, watch their checklist read
    // complete, and never reach 6 here, so this effect never fired and
    // mark-onboarding-complete was never called. Onboarding stayed false forever, with no
    // screen anywhere explaining why.
    !!_autoP.background_check_paid || !!_autoP.isBackgroundChecked || (_autoP.adminVouches || []).length > 0,
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

  const handlePhotoSelect = async (e) => {
    // v1.104.0 — auto-downscale at selection so visit photos never trip the 5MB cap
    const raw = Array.from(e.target.files || []).slice(0, 5);
    const files = await Promise.all(raw.map(f => window.downscaleImageFile(f)));
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

  const handleCheckOutPhotoSelect = async (e) => {
    // v1.104.0 — auto-downscale at selection so check-out photos never trip the 5MB cap
    const raw = Array.from(e.target.files || []).slice(0, 5);
    const files = await Promise.all(raw.map(f => window.downscaleImageFile(f)));
    setCheckOutPhotos(prev => [...prev, ...files].slice(0, 5));
    const newUrls = files.map(f => URL.createObjectURL(f));
    setCheckOutPhotoUrls(prev => [...prev, ...newUrls].slice(0, 5));
  };

  const removeCheckOutPhoto = (idx) => {
    setCheckOutPhotos(prev => prev.filter((_, i) => i !== idx));
    setCheckOutPhotoUrls(prev => {
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
          const _csrf = typeof getCsrfToken === 'function' ? getCsrfToken() : (window.getCsrfToken ? window.getCsrfToken() : null);
          const _photoHeaders = {};
          if (_csrf) _photoHeaders['X-CSRF-Token'] = _csrf;
          const _photoRes = await fetch(`${API_BASE}/api/photos/visit/${logData.visitLog.id}`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: _photoHeaders,
            body: formData,
          });
          if (!_photoRes.ok) showToast('Photos could not be saved', 'error');
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
      } else {
        // v1.105.37 — the visit log is what gets a caregiver paid. Failing silently left
        // the modal open with her text still in it and no way to tell whether it saved.
        // The nested photo upload above already toasted on failure, so the OUTER failure
        // was quieter than the inner one.
        const d = await res?.json().catch(() => ({}));
        showToast((d && d.error) || 'Your visit log did not save — please try again', 'error');
      }
    } catch (err) {
      console.error('Visit log error:', err);
      showToast('Your visit log did not save — check your connection and try again', 'error');
    }
    setSubmittingLog(false);
  };

  // Live countdown tick — re-renders every 30s when there's an active in-progress session
  const _sessions = data?.upcomingSessions || [];
  useEffect(() => {
    const hasActive = _sessions.some(s => s.status === 'in_progress');
    if (!hasActive) return;
    const iv = setInterval(() => setCountdownTick(t => t + 1), 30000);
    return () => clearInterval(iv);
  }, [_sessions.map(s => s.status).join(',')]);

  if (loading) return <LoadingSpinner text="Loading your dashboard..." />;
  if (noProfile || !data) return (
    <div style={{ maxWidth: '480px', margin: '60px auto', textAlign: 'center', padding: '40px 24px' }}>
      <div style={{ fontSize: '56px', marginBottom: '16px' }}>👋</div>
      <h2 style={{ margin: '0 0 12px', color: 'var(--text-primary)', fontSize: '22px' }}>Welcome to InPlace!</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: '15px', lineHeight: '1.6', margin: '0 0 24px' }}>
        {noProfile
          ? "Grab your driver's license and any copies of certifications or insurance info you may have — we'll walk you through everything step by step."
          : "We couldn't load your dashboard. Please try refreshing the page."}
      </p>
      {noProfile && onNeedsOnboarding && (
        <button onClick={onNeedsOnboarding} style={{
          padding: '14px 32px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none',
          borderRadius: '10px', fontSize: '16px', fontWeight: 600, cursor: 'pointer',
        }}>Let's Get Started</button>
      )}
      {!noProfile && (
        <button onClick={() => window.location.reload()} style={{
          padding: '12px 24px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none',
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
      color: 'var(--role-color)',
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

  const submitDecline = async () => {
    if (!decliningJob) return;
    setDecliningBusy(true);
    try {
      const res = await apiFetch(`/api/sessions/${decliningJob.id}/decline`, {
        method: 'PUT',
        body: JSON.stringify({ reason: declineReason.trim() || null }),
      });
      if (res?.ok) {
        showToast('Declined — the family has been told', 'info');
        setDecliningJob(null);
        setDeclineReason('');
        try { const dr = await apiFetch('/api/dashboard'); if (dr?.ok) setData(await dr.json()); } catch {}
      } else {
        const d = await res?.json().catch(() => ({}));
        showToast(d?.error || 'Could not decline that request', 'error');
      }
    } catch {
      showToast('Could not decline that request — check your connection', 'error');
    }
    setDecliningBusy(false);
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

  const openProposalModal = (job) => {
    setProposingFor(job);
    setProposalDate(job.date || job.scheduled_date || '');
    // Suggest a start time AFTER the conflict ends (includes travel buffer)
    if (job.conflictEndTime) {
      // conflictEndTime is already in 24h format (e.g. "14:30") and accounts for travel buffer
      setProposalTime(job.conflictEndTime);
      // Prefill message: "I have an appointment until 2:00 PM but can be there after."
      const [eh, em] = job.conflictEndTime.split(':').map(Number);
      const ampm = eh >= 12 ? 'PM' : 'AM';
      const dh = eh > 12 ? eh - 12 : eh === 0 ? 12 : eh;
      const freeAt = `${dh}:${String(em).padStart(2, '0')} ${ampm}`;
      setProposalMsg(`I have an appointment until ${freeAt} but can be there after.`);
    } else {
      // Fallback: shift original time +2 hours
      const origTime = job.time || job.scheduled_time || '';
      if (origTime) {
        const [h, m] = origTime.split(':').map(Number);
        const newH = Math.min(h + 2, 20);
        setProposalTime(`${String(newH).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`);
      } else {
        setProposalTime('');
      }
      setProposalMsg('');
    }
  };

  const handlePropose = async () => {
    if (!proposingFor || !proposalDate || !proposalTime) return;
    setProposalLoading(true);
    try {
      const res = await apiFetch(`/api/sessions/${proposingFor.id}/propose-time`, {
        method: 'POST',
        body: JSON.stringify({ proposedDate: proposalDate, proposedTime: proposalTime, message: proposalMsg || null }),
      });
      if (res?.ok) {
        showToast && showToast('Time proposal sent to family!', 'success');
        setProposingFor(null);
        const dashRes = await apiFetch('/api/dashboard');
        if (dashRes?.ok) setData(await dashRes.json());
      } else {
        const err = await res.json().catch(() => ({}));
        showToast ? showToast(err.error || 'Failed to send proposal', 'error') : alert(err.error || 'Failed to send proposal');
      }
    } catch (err) {
      console.error('Propose time error:', err);
    }
    setProposalLoading(false);
  };

  const profile = data.profile || {};
  const assignments = data.assignments || [];
  const sessions = data.upcomingSessions || [];
  // v1.105.100 — jobs she has said "not for me" to drop out of the list. A job DIRECTED at her
  // is never hidden this way: that one needs an answer, and quietly removing it would turn a
  // request from a family into silence.
  const openJobs = (data.openJobs || []).filter((j) => j.isDirectedAtMe || !hiddenJobIds.has(j.id));
  const dataReviews = data.reviews || [];
  const stats = data.stats || {};

  // Find sessions ready for check-in (confirmed, today, within 15 min of start or past start)
  // All times are care-location times — use TimezoneHelper
  const readyToCheckIn = sessions.filter(s => {
    if (s.status !== 'confirmed') return false;
    const tz = s.timezone || TimezoneHelper.DEFAULT_TZ;
    const etDate = TimezoneHelper.getToday(tz);
    const sessionDate = (s.date || s.scheduled_date || '').split('T')[0];
    if (sessionDate !== etDate) return false;
    const sTime = s.time || s.scheduled_time;
    if (!sTime) return false;
    const sessionStartET = TimezoneHelper.buildDateTime(sessionDate, sTime, tz);
    const minsUntil = (sessionStartET.getTime() - TimezoneHelper.realNowMs()) / 60000;
    return minsUntil <= 15 || profile.earlyCheckInAllowed;
  });

  // Split sessions into <24hr ("up next") vs >24hr ("scheduled")
  const upNextSessions = sessions.filter(s => {
    if (s.status === 'completed') return false;
    if (s.status === 'in_progress') return true;
    const tz = s.timezone || TimezoneHelper.DEFAULT_TZ;
    const sDate = (s.date || s.scheduled_date || '').split('T')[0];
    const sessionDT = TimezoneHelper.buildDateTime(sDate, s.time || s.scheduled_time || '00:00', tz);
    const minsUntil = (sessionDT.getTime() - TimezoneHelper.realNowMs()) / 60000;
    return minsUntil < 24 * 60;
  });

  const scheduledSessions = sessions.filter(s => {
    if (s.status === 'completed' || s.status === 'in_progress') return false;
    const tz = s.timezone || TimezoneHelper.DEFAULT_TZ;
    const sDate = (s.date || s.scheduled_date || '').split('T')[0];
    const sessionDT = TimezoneHelper.buildDateTime(sDate, s.time || s.scheduled_time || '00:00', tz);
    const minsUntil = (sessionDT.getTime() - TimezoneHelper.realNowMs()) / 60000;
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

  // Save inline profile (bio, rate, allergies, medical) during onboarding
  const saveOnboardingProfile = async () => {
    setProfileSaving(true);
    try {
      // v1.105.51 — all three of these were awaited and discarded, then "Profile saved!"
      // fired unconditionally. A rejected save told the caregiver it had worked and moved
      // them on to the next step.
      const dayRate = parseFloat(profileForm.rateDaytime) || parseFloat(profileForm.hourlyRate) || 25;
      const r1 = await apiFetch('/api/caregivers/profile', {
        method: 'POST',
        body: JSON.stringify({ bio: profileForm.bio, hourlyRate: dayRate }),
      });
      if (!r1?.ok) { showToast('Failed to save profile', 'error'); setProfileSaving(false); return; }
      // Save tiered rates if any were entered
      if (profileForm.rateDaytime || profileForm.rateNighttime || profileForm.rateOvernight) {
        const r2 = await apiFetch('/api/caregivers/rates', {
          method: 'PUT',
          body: JSON.stringify({
            rateDaytime: parseFloat(profileForm.rateDaytime) || dayRate,
            rateNighttime: parseFloat(profileForm.rateNighttime) || dayRate,
            rateOvernight: parseFloat(profileForm.rateOvernight) || dayRate,
          }),
        });
        if (!r2?.ok) { showToast('Your rates didn\'t save — please try again.', 'error'); setProfileSaving(false); return; }
      }
      const r3 = await apiFetch('/api/auth/me', {
        method: 'PUT',
        body: JSON.stringify({ foodAllergies: profileForm.foodAllergies, medicalConditions: profileForm.medicalConditions }),
      });
      if (!r3?.ok) { showToast('Failed to save profile', 'error'); setProfileSaving(false); return; }
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
      // v1.105.51 — result discarded, then an unconditional "Work location updated!".
      // Work location decides which jobs a caregiver is offered at all.
      const saveRes = await apiFetch('/api/caregivers/profile', {
        method: 'POST',
        body: JSON.stringify({ city: locCity.trim(), state: locState.trim(), zip: locZip.trim() }),
      });
      if (!saveRes?.ok) { showToast('Failed to update location', 'error'); setLocSaving(false); return; }
      const res = await apiFetch('/api/dashboard');
      if (res?.ok) { const d = await res.json(); setData(d); }
      showToast('Work location updated!', 'success');
      setEditingLocation(false);
    } catch (err) { console.error('Location save error:', err); showToast('Failed to update location', 'error'); }
    setLocSaving(false);
  };

  // First Steps checklist — encouraging but NEVER blocks dashboard access
  // New 5-step order per Pete's specs
  const hasPhoto = !!profile.avatar_url;
  const hasAvailability = availRules.length > 0;
  const hasRates = !!(profile.rateDaytime || profile.hourlyRate);
  const securityReviewed = !!localStorage.getItem('inplace_security_reviewed');
  const stripeConnected = stripeStatus?.status === 'active';
  const bgPaid = !!profile.background_check_paid || !!profile.isBackgroundChecked;
  const bgCheckSubmitted = !!profile.isBackgroundChecked || (profile.checkrStatus && profile.checkrStatus !== 'pending' && profile.checkrStatus !== 'not_initiated');
  // v1.105.63 — an admin granted the fee rather than the caregiver paying it. Same flag on the
  // profile; only the payments table knows which. See routes/dashboard.js.
  const feeWaived = !!profile.backgroundCheckFeeWaived;
  // v1.105.64 — these drive the 'identity' First Step below. `idVerified` used to be computed
  // here and used nowhere at all.
  const idSubmitted = !!idVerification.submitted;
  const idApproved = !!idVerification.verified;
  // Check if user has set any care preferences (values are green/yellow/red, 'none' means unset)
  const hasPreferences = !!stoplightData && Object.keys(stoplightData).length > 0 &&
    Object.values(stoplightData).some(v => v === 'green' || v === 'yellow' || v === 'red');

  // Per-step admin overrides — only skip what was explicitly granted
  const stripeOverride = !!profile.stripeOnboardComplete;  // admin granted Stripe bypass
  // v1.64.0: a real check satisfies this; so does an active admin vouch (which
  // covers ONLY the vouched family — honest copy shown below).
  const adminVouches = profile.adminVouches || [];
  const bgOverride = !!profile.isBackgroundChecked || adminVouches.length > 0;

  const firstSteps = [
    { id: 'stripe-bg',
      label: 'Set up Stripe and connect your bank account',
      desc: 'Connect your bank account to receive payments for care sessions. Stripe handles everything securely.',
      done: stripeConnected || stripeOverride,
      // v1.105.75 — stripeStatus starts null and only becomes real once /connect/status
      // answers; null means "not asked yet", not "not connected".
      missing: (stripeConnected || stripeOverride || stripeStatus === null) ? null : 'Connect Stripe to continue' },
    { id: 'background-check',
      label: 'Start your background check',
      // v1.105.63 — the fee sentence is the first thing this step says, and it used to say it
      // whether or not the caregiver owed anything. Someone whose fee an admin had waived read
      // "one-time $30 fee" directly above a warning telling them to act, and reasonably
      // concluded they were being asked for money. Say which of the two is true.
      desc: 'A background check is required to participate on InPlace. '
        + (feeWaived
            ? 'The $30 fee has been waived for you — you don\'t owe anything. '
            : 'This is a one-time $30 fee that is refunded after 10 completed sessions. ')
        + 'Your report is reviewed fairly — you\'ll be given a chance to provide context on anything that comes up, and a real person is always in the loop.',
      done: bgCheckSubmitted || bgOverride,
      missing: !(bgCheckSubmitted || bgOverride) ? (bgPaid ? 'Complete the background check form' : ((stripeConnected || stripeOverride) ? 'Pay for background check ($30)' : 'Complete Stripe setup first')) : null,
      warning: (!profile.isBackgroundChecked && adminVouches.length > 0 && !bgCheckSubmitted)
        ? ('You\'re approved to work with ' + adminVouches.map(v => v.familyName).join(', ') + ' without a background check. To accept work from other families, a background check is required.')
        : bgCheckSubmitted && profile.checkrStatus === 'consider'
        ? 'Your background check needs additional information. Please check your email for instructions from Checkr on how to complete the review process.'
        : (bgCheckSubmitted && profile.checkrStatus === 'processing'
          ? 'Your background check is being processed. This usually takes 2–5 business days.'
          : (bgCheckSubmitted && profile.checkrStatus === 'disputed'
            ? 'Your dispute is being reviewed. We\'ll notify you when there\'s an update.'
            : null)) },
    // v1.105.64 — the hardest gate in caregiver onboarding, and until now it appeared on this
    // list nowhere. mark-onboarding-complete refuses without an APPROVED identity document, so
    // a caregiver could finish every visible step, sit at 6 of 6, and stay permanently
    // incomplete with nothing telling them why or where to go. `idVerified` was already being
    // computed a few lines above and thrown away.
    { id: 'identity',
      // v1.105.112 — softer, and true. It used to read "Verify your identity" / "A person
      // reviews it." The first shouted; the second was wrong in the common case, because the
      // AI approved most of these outright and nobody was asked (that is fixed in the same
      // release — a person really does review it now).
      label: 'A photo of your licence',
      desc: 'A selfie and a photo of your government-issued ID. Families are inviting you into their home — this is the step that lets them know who you are. We\u2019ll review it and reach out if we have any questions.',
      // v1.105.112 — THREE states, not two.
      //
      // Pete: "you finish...and it says you still haven't verified your ID (but you did) and
      // it's like, when does this ever end?"
      //
      // `done: idApproved` was false while `idVerification` was still loading, so the step
      // drew UNTICKED with no explanation — v1.105.75 rightly suppresses the prompt in flight,
      // which left nothing at all. Done, not done, and NOT KNOWN YET are three different
      // things, and the third must never render as the second.
      unknown: !idVerification.loaded,
      done: idApproved,
      // v1.105.75 — while the answer is still in flight, prompt for nothing. Telling an
      // approved caregiver to photograph her ID because a fetch hasn't returned is how this
      // step read for anyone who never opened the Earnings tab.
      missing: !idVerification.loaded
        ? null
        : (idVerification.loadFailed
            ? 'Couldn’t check your verification status — tap to try again'
            : (!idSubmitted ? 'Take a selfie and photo of your ID' : null)),
      warning: !idVerification.loaded || idVerification.loadFailed
        ? null
        : (idSubmitted && !idApproved
            ? (idVerification.status === 'rejected'
                ? 'Your ID could not be verified. Tap to submit a clearer photo.'
                : 'Sent \u2014 we\u2019ll review it and reach out if we have any questions. Nothing else for you to do.')
            : null) },
    { id: 'security', label: 'Make your account more secure', desc: 'Set up two-factor authentication or biometrics to protect your account', done: securityReviewed, missing: !securityReviewed ? 'Enable 2FA or biometrics in Settings' : null },
    { id: 'preferences', label: 'Select your care preferences', desc: 'Your selections help us match you to compatible clients and allow you to voice your availability for different types of clients', done: hasPreferences, missing: !hasPreferences ? 'Select all preferences and save' : null },
    { id: 'avail-rates', label: 'Set your availability and rates', desc: 'Tell families when you\'re free and what you charge', done: hasAvailability && hasRates, missing: (() => { const m = []; if (!hasAvailability) m.push('set at least one availability rule'); if (!hasRates) m.push('save your rates'); return m.length > 0 ? 'Still needed: ' + m.join(' and ') : null; })() },
    { id: 'photo', label: 'Review your account page and add a profile picture', desc: 'Families want to see who they\'re inviting into their home', done: hasPhoto, missing: !hasPhoto ? 'Upload a profile photo' : null },
  ];
  const firstStepsDone = firstSteps.filter(s => s.done).length;
  // Show checklist whenever steps remain — disappears when ALL done (or admin overrides all fields)
  //
  // v1.105.82 — ...but not until we KNOW. Two of the seven steps (identity, Stripe) are decided
  // by fetches that resolve after the first paint, so between mount and their arrival the
  // checklist rendered with those steps unticked and then corrected itself. Julia saw the
  // onboarding panel flash on every single page change. v1.105.75 stopped the checklist being
  // permanently wrong; this stops it being briefly wrong, which is the same bug at a different
  // timescale — a value that has not arrived is not a value of "no".
  const firstStepsResolved = idVerification.loaded && stripeStatus !== null;
  // v1.105.95 — a demo account is not a signup in progress. Maria opened her dashboard to an
  // orange onboarding panel telling the VISITOR to connect a bank account and photograph a
  // government ID, on an account that is not theirs and for a person who does not exist. Pete:
  // "this is demo data...not actual onboarding". Two of the seven steps can't be seeded away
  // even in principle — 'security' is decided by a localStorage flag on whichever browser is
  // looking, and 'identity' wants a real document these characters do not have — so the honest
  // fix is not to fake the inputs but to stop asking a demo the question. Real caregivers are
  // unaffected: isDemo comes from users.is_demo (dashboard.js).
  // ─── The path, as the dashboard draws it (v1.105.118) ───
  //
  // Same route object the wizard renders, so the list she read on her way out of signup and the
  // list she meets here cannot drift apart. `firstSteps` above still owns the copy, the click
  // targets and the per-step warnings; this owns which of them is OPEN and how loud each is.
  const hubRoute = resolveRoute({
    surface: 'hub',
    profileCreated: true,
    identity: {
      loaded: idVerification.loaded, loadFailed: idVerification.loadFailed,
      submitted: idSubmitted, approved: idApproved, status: idVerification.status,
    },
    stripe: { status: stripeStatus ? stripeStatus.status : null, connected: stripeConnected, override: stripeOverride },
    backgroundCheck: {
      override: bgOverride, passed: !!profile.isBackgroundChecked,
      submitted: bgCheckSubmitted, checkrStatus: profile.checkrStatus,
    },
    hasPreferences, hasAvailability, hasRates, hasPhoto, securityReviewed,
  });
  // The route calls it `stripe`; First Steps has called it `stripe-bg` since before the safety
  // check was split out of it. One line of translation beats renaming a live click target.
  const firstStepFor = (routeId) => firstSteps.find((f) => f.id === (routeId === 'stripe' ? 'stripe-bg' : routeId)) || null;

  // v1.105.118 — lifted out of the row that used to be its only caller, because the open step
  // is now a button rather than a list item.
  const openFirstStep = (id) => {
    if (id === 'photo') { window.__accountTab = 'profile'; window.__navigateTo && window.__navigateTo('account'); }
    if (id === 'avail-rates') { window.__findWorkTab = 'availability'; window.__navigateTo && window.__navigateTo('find-work'); }
    if (id === 'security') {
      window.__accountTab = 'settings';
      window.__navigateTo && window.__navigateTo('account');
      setTimeout(() => window.dispatchEvent(new CustomEvent('accountTabSwitch', { detail: { tab: 'settings' } })), 100);
    }
    if (id === 'stripe-bg' || id === 'stripe') { window.__accountTab = 'payments'; window.__navigateTo && window.__navigateTo('account'); }
    if (id === 'background-check') { window.__accountTab = 'payments'; window.__navigateTo && window.__navigateTo('account'); }
    if (id === 'preferences') { window.__accountTab = 'preferences'; window.__navigateTo && window.__navigateTo('account'); }
    // v1.105.64 — the selfie + ID capture lives in My Account's profile tab. It is the one
    // place a caregiver can reach it after the signup wizard, which is why the step has to
    // point there rather than at the wizard they have already left.
    if (id === 'identity') { window.__accountTab = 'profile'; window.__navigateTo && window.__navigateTo('account'); }
  };

  const showFirstSteps = firstStepsResolved && firstStepsDone < firstSteps.length && !profile.isDemo;
  // Expose to parent (app.js) so bottom nav can grey out Find Work
  window.__caregiverFirstStepsRemain = showFirstSteps;
  // NEVER gate/blur the dashboard — checklist is motivational, not a lock
  const onboardingGated = false;
  const shouldBlur = false;

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
          <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
            {editingLocation ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
                <input type="text" value={locCity} onChange={(e) => setLocCity(e.target.value)} placeholder="City" style={{ width: '120px', padding: '4px 8px', border: '1px solid #ccc', borderRadius: '6px', fontSize: '13px' }} />
                <select value={locState} onChange={(e) => setLocState(e.target.value)} style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: '6px', fontSize: '13px' }}>
                  <option value="">State</option>
                  {['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <input type="text" value={locZip} onChange={(e) => setLocZip(e.target.value)} placeholder="Zip" maxLength={10} style={{ width: '80px', padding: '4px 8px', border: '1px solid #ccc', borderRadius: '6px', fontSize: '13px' }} />
                <button onClick={saveWorkLocation} disabled={locSaving} style={{ padding: '4px 10px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', opacity: locSaving ? 0.6 : 1 }}>{locSaving ? '...' : 'Save'}</button>
                <button onClick={() => setEditingLocation(false)} style={{ padding: '4px 8px', background: 'none', border: '1px solid #ccc', borderRadius: '6px', fontSize: '12px', color: 'var(--text-secondary)', cursor: 'pointer' }}>Cancel</button>
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
                <span onClick={() => { setLocCity(''); setLocState(''); setLocZip(''); setEditingLocation(true); }} style={{ cursor: 'pointer', color: 'var(--accent-color)', fontWeight: 600, borderBottom: '1px dashed #e8724a' }}>
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
            background: profile.isAvailable ? 'var(--color-success-bg)' : 'var(--color-error-bg)',
            color: profile.isAvailable ? 'var(--color-success)' : 'var(--color-error)',
            borderRadius: '20px', fontSize: '13px', fontWeight: 600,
          }}>
            {profile.isAvailable ? 'Available' : 'Unavailable'}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div onClick={() => { setShowReviews(true); fetchReviews(); }} style={{ fontSize: '20px', fontWeight: 700, color: 'var(--role-color)', cursor: 'pointer' }} title="View reviews">⭐ {profile.rating || '—'}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{profile.reviewCount || 0} reviews</div>
          </div>
        </div>
      </div>

      {/* ─── Needs your attention: a care-team invite (v1.105.82) ─── */}
      {/*
          Top of the feed, above everything including First Steps, and it does not go away
          until she acts on it. Pete: "needs to be a lingering TOP OF THE FEED NEEDS YOUR
          ATTENTION step". The equivalent banner has existed on Dashboard since care teams
          shipped — but Dashboard is the FAMILY home screen, and a caregiver never sees it.
      */}
      {pendingInvites.map((inv) => (
        <div key={inv.id} style={{
          marginBottom: 16, padding: '14px 16px', borderRadius: 12,
          background: 'var(--color-warning-bg)', border: '1px solid var(--color-warning)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: 'var(--text-brown)', marginBottom: 5 }}>
            NEEDS YOUR ATTENTION
          </div>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.4 }}>
            {inv.inviter_first_name || 'Someone'} invited you to {inv.recipient_first_name ? `${inv.recipient_first_name}'s` : 'a'} care team
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5 }}>
            You{'\u2019'}ll be able to see what you{'\u2019'}ve been given access to, and nothing else.
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={() => acceptInvite(inv)} disabled={acceptingInviteId === inv.id}
              style={{ flex: 1, padding: '10px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 9, fontSize: 13.5, fontWeight: 700, cursor: acceptingInviteId === inv.id ? 'wait' : 'pointer' }}>
              {acceptingInviteId === inv.id ? 'Joining\u2026' : 'Accept invitation'}
            </button>
          </div>
        </div>
      ))}

      {/* Welcome subtitle — shown during onboarding */}
      {showFirstSteps && (
        <div style={{ color: 'var(--color-info)', fontWeight: 500, background: 'var(--color-info-bg)', padding: '10px 14px', borderRadius: '10px', fontSize: '13px', lineHeight: 1.5, marginBottom: '20px' }}>
          This is your home hub. When you finish onboarding you'll see available jobs and your calendar!
        </div>
      )}

      {/* Milestone Celebration Banner */}
      {unackedMilestones.length > 0 && (() => {
        const ms = unackedMilestones[0];
        const milestoneLabels = { 10: 'First 10 Sessions!', 25: '25 Sessions!', 50: '50 Sessions!', 100: 'Century Club!', 250: '250 Sessions!', 500: '500 Sessions!' };
        const milestoneEmojis = { 10: '\u{1F389}', 25: '\u{1F31F}', 50: '\u{1F525}', 100: '\u{1F3C6}', 250: '\u{1F48E}', 500: '\u{1F451}' };
        const label = milestoneLabels[ms.milestone_value] || `${ms.milestone_value} Sessions!`;
        const emoji = milestoneEmojis[ms.milestone_value] || '\u{1F389}';
        const handleAck = async () => {
          try {
            await apiFetch(`/api/referrals/milestones/${ms.id}/acknowledge`, { method: 'POST' });
            setUnackedMilestones(prev => prev.filter(m => m.id !== ms.id));
          } catch (e) { console.error('Milestone ack error:', e); }
        };
        return (
          <div style={{
            marginBottom: 16, padding: '18px 20px',
            background: 'linear-gradient(135deg, #fff8e1 0%, #fff3e0 100%)',
            border: '2px solid #ffa726', borderRadius: 14,
            boxShadow: '0 2px 12px rgba(255,167,38,0.2)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 36, marginBottom: 6 }}>{emoji}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-warning)', marginBottom: 4 }}>
              {label}
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-warning)', marginBottom: 12 }}>
              Congratulations! You've completed {ms.milestone_value} care sessions on inPlace. Thank you for the incredible work you do.
            </div>
            <button onClick={handleAck} style={{
              padding: '8px 24px', background: 'var(--color-warning)', color: 'var(--text-on-primary)', border: 'none',
              borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>Awesome!</button>
          </div>
        );
      })()}

      {/* Status Banner — only shows when there's an actionable status (skip if admin overrode to available) */}
      {!profile.isAvailable && (() => {
        const onboardingDone = profile.onboardingComplete;
        const checkrStatus = profile.checkrStatus;
        if (!onboardingDone) return (
          <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid #e8724a', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 24 }}>⏳</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>Getting Started</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>Complete your profile to start receiving care requests.</div>
            </div>
          </div>
        );
        if (checkrStatus === 'pending') return (
          <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid #f59e0b', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 24 }}>🔄</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>Background Check</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>Your background check is in progress. You'll be notified once it clears.</div>
            </div>
          </div>
        );
        if (checkrStatus === 'rejected') return (
          <div className="card" style={{
            marginBottom: 16, padding: '16px 18px',
            background: 'var(--bg-error-light)', border: '2px solid #ef5350', borderRadius: 12,
            boxShadow: '0 2px 12px rgba(239,83,80,0.15)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 24 }}>{'\u274C'}</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--color-error)' }}>Background Check Not Approved</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                  We were unable to approve your account based on your background check results.
                </div>
              </div>
            </div>
            {profile.bgCheckRejectionReason && (
              <div style={{ fontSize: 13, color: 'var(--color-error)', fontWeight: 600, padding: '6px 10px', background: 'var(--color-error-bg)', borderRadius: 8, marginBottom: 6 }}>
                {profile.bgCheckRejectionReason}
              </div>
            )}
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
              If you believe this is an error or would like to provide additional context, please check your Messages — we've sent you details and you can reply to appeal.
            </div>
          </div>
        );
        if (checkrStatus === 'consider') return (
          <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid #f59e0b', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 24 }}>{'\u26A0\uFE0F'}</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-warning)' }}>Background Check — Action Needed</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                Your background check requires additional information. Please check your email for instructions from Checkr on how to complete the review process.
              </div>
            </div>
          </div>
        );
        if (checkrStatus === 'processing') return (
          <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid #3b82f6', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 24 }}>🔄</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>Background Check Processing</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>Your background check is being processed. This usually takes 2–5 business days.</div>
            </div>
          </div>
        );
        if (checkrStatus === 'disputed') return (
          <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid #8b5cf6', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 24 }}>{'\u{1F4DD}'}</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>Background Check — Dispute Under Review</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>Your dispute is being reviewed by Checkr. We'll notify you when there's an update.</div>
            </div>
          </div>
        );
        return null;
      })()}

      {/* Account Paused Banner — shown when caregiver account is paused (e.g., after no-show) */}
      {profile.accountPaused && (
        <div className="card" style={{
          marginBottom: 16, padding: '16px 18px',
          background: 'var(--bg-error-light)', border: '2px solid #ef5350', borderRadius: 12,
          boxShadow: '0 2px 12px rgba(239,83,80,0.15)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 24 }}>{'\u{1F6D1}'}</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--color-error)' }}>Account Paused</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                Your account has been temporarily paused and you won't appear in job listings.
              </div>
            </div>
          </div>
          {profile.accountPausedReason && (
            <div style={{ fontSize: 13, color: 'var(--color-error)', fontWeight: 600, padding: '6px 10px', background: 'var(--color-error-bg)', borderRadius: 8, marginBottom: 6 }}>
              Reason: {profile.accountPausedReason}
            </div>
          )}
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            An admin will review your account. If you believe this is an error, please contact support.
          </div>
        </div>
      )}

      {/* ─── First steps, quietly (v1.105.118) ───
          Pete, on the version that listed all seven as rows: "the finished stuff...small, greyed
          out, lined through... We don't want this to be a catalogue in your face of how hard it
          is to sign up."

          So the information is unchanged and the weight is not: everything done collapses onto
          one small struck-through line, ONE step is open and has any size to it, and what is
          left is a single quiet line of names. Seven rows of orange-bordered work became about
          four lines. */}
      {showFirstSteps && (() => {
        const doneNames = hubRoute.items.filter((i) => i.state === 'done').map((i) => i.label);
        const waitingItems = hubRoute.items.filter((i) => i.state === 'waiting');
        const open = hubRoute.current;
        const openStep = open ? firstStepFor(open.id) : null;
        // Never prefixed, per Pete — just the names.
        const ahead = hubRoute.items
          .filter((i) => i.state === 'todo' && (!open || i.id !== open.id))
          .map((i) => i.label);

        return (
        <div style={{ background: 'var(--bg-surface)', borderRadius: '14px', border: '1px solid var(--border-color)', padding: '18px 20px', marginBottom: '20px' }}>
          <input type="file" ref={avatarInputRef} accept="image/*" style={{ display: 'none' }} onChange={handleAvatarUpload} />

          {/* Done. Keyed on the count so finishing one replays the fade. */}
          {doneNames.length > 0 && (
            <div className="ip-path-done" key={doneNames.length} style={{
              fontSize: '11px', lineHeight: '1.55', color: 'var(--text-tertiary)',
              textDecoration: 'line-through', marginBottom: '14px', opacity: 0.75,
            }}>{doneNames.join('  \u00B7  ')}</div>
          )}

          {/* Open — the only thing here with any weight. */}
          {open && openStep && (
            <div className="ip-path-step" key={open.id}>
              <div style={{ fontSize: '17px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                {open.label}
              </div>
              {openStep.desc && (
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.45', marginBottom: '12px' }}>
                  {openStep.desc}
                </div>
              )}
              {/* v1.105.63 — the waived/not-waived branch lives in `desc` above and must keep
                  its own sentence. This is the separate "and here is what is missing" line. */}
              {openStep.missing && (
                <div style={{ fontSize: '12px', color: 'var(--color-warning)', marginBottom: '10px' }}>
                  {openStep.missing}
                </div>
              )}
              <button onClick={() => openFirstStep(openStep.id)} style={{
                width: '100%', padding: '11px', background: 'var(--role-color)', color: 'var(--text-on-primary)',
                border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 600, cursor: 'pointer',
              }}>Start</button>
            </div>
          )}

          {ahead.length > 0 && (
            <div style={{ fontSize: '11px', lineHeight: '1.55', color: 'var(--text-muted)', marginTop: '14px' }}>
              {ahead.join('  \u00B7  ')}
            </div>
          )}

          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px', opacity: 0.8 }}>
            {hubRoute.remaining} {hubRoute.remaining === 1 ? 'thing' : 'things'} left
            {waitingItems.length > 0 ? '  \u00B7  ' + waitingItems.length + ' with us' : ''}
          </div>

          {/* Waiting on US. Its own note, outside the queue of things to do, because it is not
              her work — and since v1.105.112 it is what every caregiver's dashboard looks like
              on day one. */}
          {waitingItems.map((item) => {
            const step = firstStepFor(item.id);
            return (
              <div key={item.id} onClick={() => step && openFirstStep(step.id)} style={{
                marginTop: '12px', padding: '11px 12px', background: 'var(--bg-highlight)',
                border: '1px solid #d4ede8', borderRadius: '8px', cursor: 'pointer',
              }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--role-color)', marginBottom: '2px' }}>
                  {item.label}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.45' }}>
                  {(step && step.warning)
                    || 'Sent \u2014 we\u2019ll review it and reach out if we have any questions. Nothing else for you to do.'}
                </div>
              </div>
            );
          })}
        </div>
        );
      })()}

      {/* Calendar Placeholder — shown when no availability set yet */}
      {showFirstSteps && !hasAvailability && (
        <div style={{ background: 'var(--bg-surface)', borderRadius: '14px', border: '1px solid var(--border-color)', padding: '28px 22px', textAlign: 'center', marginBottom: '20px' }}>
          <div style={{ fontSize: '40px', marginBottom: '8px', opacity: 0.5 }}>📅</div>
          <div style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Your availability and booked sessions will show here later</div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>Complete step 2 to set your availability and see your calendar</div>
        </div>
      )}

      {/* NO-SHOW ALERTS — prominent banner when caregiver missed appointments */}
      {(data.noShowAlerts || []).length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {data.noShowAlerts.map(alert => {
            const dateLabel = TimezoneHelper.getDateLabel((alert.scheduledDate || '').split('T')[0], TimezoneHelper.DEFAULT_TZ);
            const timeLabel = TimezoneHelper.formatTime(alert.scheduledTime);
            return (
              <div key={alert.id} style={{
                padding: '14px 16px', marginBottom: 8, position: 'relative',
                background: 'var(--bg-error-light)', border: '2px solid #ef5350', borderRadius: 12,
                boxShadow: '0 2px 8px rgba(239,83,80,0.15)',
              }}>
                <button onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    await apiFetch(`/api/accountability/no-show/${alert.id}/acknowledge`, { method: 'POST' });
                    setData(prev => ({ ...prev, noShowAlerts: (prev.noShowAlerts || []).filter(a => a.id !== alert.id) }));
                  } catch (err) { console.error('Dismiss no-show error:', err); }
                }} style={{
                  position: 'absolute', top: 8, right: 8,
                  background: 'rgba(0,0,0,0.2)', border: 'none', borderRadius: '50%',
                  width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1,
                }} title="Dismiss">{'\u2715'}</button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 20 }}>{'\u{1F6A8}'}</span>
                  <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-error)' }}>Missed Session</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>
                  You did not check in for <strong>{alert.recipientName || 'a care visit'}</strong> on <strong>{dateLabel}</strong> at <strong>{timeLabel}</strong>.
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-error)', fontWeight: 600 }}>
                  This session was automatically cancelled and no payment was processed. {alert.reviewRequired && !alert.reviewCompleted ? 'A review from the family is pending.' : ''}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
                  If this was an error, please contact the family or reach out to support.
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* EXCLUSIVE "Just for You" offers — extracted from Find Work, shown prominently */}
      {bgCheckPaid && (() => {
        const pendingProposalSessionIds = new Set((data.myProposals || []).filter(p => p.status === 'pending').map(p => p.sessionId));
        const exclusiveOffers = openJobs.filter(job => {
          if (pendingProposalSessionIds.has(job.id)) return false; // already proposed
          if (!job.offeredToCaregiverId) return false;
          return !isExclusiveExpired(job, exclusiveNow); // only non-expired exclusive offers
        });
        if (exclusiveOffers.length === 0) return null;

        return (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-purple-light)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
              {'\u2728'} Just for You
            </div>
            {exclusiveOffers.map(job => {
              const sDate = (job.date || '').split('T')[0];
              const jobTz = job.timezone || TimezoneHelper.DEFAULT_TZ;
              const dayDiff = sDate ? TimezoneHelper.getDaysUntil(sDate, jobTz) : null;
              const dayLabel = sDate ? TimezoneHelper.getDateLabel(sDate, jobTz) : '';
              const tParts = (job.time || '').split(':').map(Number);
              const timeLabel = tParts.length >= 2 ? `${tParts[0] > 12 ? tParts[0] - 12 : tParts[0] || 12}:${String(tParts[1]).padStart(2, '0')} ${tParts[0] >= 12 ? 'PM' : 'AM'}` : '';

              // v1.105.106 — one computation, in utils.js, shared with the open-jobs card
              // below. These two cards each did the arithmetic inline and rounded the rate
              // and the total independently, which is why Julia saw "$24 and then $29 listed
              // on same job (doesn't match up)" — dc5e86b5.
              const { total: effectiveTotal, perHour: effectivePerHour, basePerHour, hasBonus } = jobPay(job);

              const exclusiveRemaining = exclusiveMinutesLeft(job, exclusiveNow);
              const exclusiveUrgent = exclusiveRemaining !== null && exclusiveRemaining <= 10;

              return (
                <div key={job.id} className="card" style={{
                  marginBottom: 10, padding: '16px 18px',
                  border: '2px solid #7c3aed', borderRadius: 12,
                  background: 'var(--bg-exclusive-card)',
                  boxShadow: '0 2px 8px rgba(124,58,237,0.15)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '180px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                        <span className={exclusiveUrgent ? 'exclusive-urgent' : ''} style={{
                          background: exclusiveUrgent ? 'var(--accent-color)' : 'var(--color-purple-light)', color: 'var(--text-on-primary)',
                          padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 700,
                        }}>
                          {exclusiveRemaining !== null ? (exclusiveUrgent ? `\u23F1 ${exclusiveRemaining} min left!` : `\u2728 JUST FOR YOU \u00B7 ${exclusiveRemaining} min left`) : '\u2728 JUST FOR YOU'}
                        </span>
                        {hasBonus && (
                          <span style={{ background: 'var(--accent-color)', color: 'var(--text-on-primary)', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700 }}>BONUS PAY</span>
                        )}
                      </div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{formatServiceType(job.serviceType)}</div>
                      <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 3 }}>
                        {dayLabel}{timeLabel ? ` at ${timeLabel}` : ''}{job.durationHours ? ` \u2022 ${job.durationHours}hr` : ''}
                        {effectiveTotal > 0 && <React.Fragment><span> {'\u2022'} </span><span style={{ fontWeight: 800, color: 'var(--role-color)', fontSize: 22 }}>{formatMoney(effectiveTotal)}</span><span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}> total</span></React.Fragment>}
                      </div>
                      {job.recipientCity && <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>{'\uD83D\uDCCD'} {job.recipientCity}</div>}
                      {job.familyName && <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 1 }}>Requested by {job.familyName}</div>}
                      {hasBonus && basePerHour > 0 && (
                        <div style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                          <span style={{ textDecoration: 'line-through', color: 'var(--text-muted)', fontSize: 12 }}>{formatMoney(basePerHour)}/hr</span>
                          <span style={{ color: 'var(--role-color)', fontWeight: 700, fontSize: 14 }}>{formatMoney(effectivePerHour)}/hr</span>
                        </div>
                      )}
                      {job.healthTags && job.healthTags.length > 0 && (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                          {job.healthTags.map((tag, idx) => (
                            <span key={idx} style={{ fontSize: 10, background: 'var(--color-warning-bg)', color: 'var(--color-warning)', padding: '2px 7px', borderRadius: 10, fontWeight: 600 }}>{tag}</span>
                          ))}
                        </div>
                      )}
                      {job.careSummary && (
                        <div style={{ marginTop: 6, padding: '6px 8px', background: 'var(--bg-accent-light)', borderLeft: '3px solid #7c3aed', borderRadius: 4, fontSize: 11, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                          {'\uD83D\uDCCB'} {expandedSummaryJobId === job.id || job.careSummary.length <= 150
                            ? job.careSummary
                            : job.careSummary.substring(0, 150) + '\u2026'}
                          {job.careSummary.length > 150 && (
                            <button onClick={(e) => { e.stopPropagation(); setExpandedSummaryJobId(expandedSummaryJobId === job.id ? null : job.id); }}
                              style={{ display: 'block', marginTop: 4, background: 'none', border: 'none', padding: 0, font: 'inherit', fontSize: 11, fontWeight: 700, color: 'var(--accent-color)', cursor: 'pointer' }}>
                              {expandedSummaryJobId === job.id ? 'Show less' : 'Read more'}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                      {/* v1.105.89 — your own family's request. Visible so you can see it went
                          out, never acceptable: family paying family for the same visit is not
                          something to reach by accident. */}
                      {job.isOwnRequest ? (
                        <div style={{ padding: '10px 14px', background: 'var(--bg-primary)', border: '1px solid var(--border-light)', borderRadius: 10, fontSize: 11.5, color: 'var(--text-secondary)', textAlign: 'center', maxWidth: 170, lineHeight: 1.45 }}>
                          <strong style={{ display: 'block', color: 'var(--text-primary)', marginBottom: 2 }}>You posted this</strong>
                          It{'\u2019'}s live and others can accept it {'\u2014'} you just can{'\u2019'}t accept your own request.
                        </div>
                      ) : profile.caregiverCleared ? (
                      <button onClick={(e) => { if (!profile.accountPaused) handleClaimJob(job.id, e, effectiveTotal); }} disabled={claimingJobId === job.id || profile.accountPaused}
                        title={profile.accountPaused ? 'Your account is paused. Contact support for assistance.' : ''}
                        style={{
                          padding: '12px 24px', background: claimingJobId === job.id || profile.accountPaused ? 'var(--border-light)' : 'var(--color-purple-light)', color: 'var(--text-on-primary)', border: 'none',
                          borderRadius: '12px', fontSize: '15px', fontWeight: 700, cursor: claimingJobId === job.id || profile.accountPaused ? 'not-allowed' : 'pointer',
                          boxShadow: '0 2px 8px rgba(124,58,237,0.3)', whiteSpace: 'nowrap',
                        }}>{profile.accountPaused ? '❌ Account Paused' : claimingJobId === job.id ? 'Accepting...' : 'Accept Job'}</button>
                      ) : (
                        <div style={{ padding: '8px 14px', background: 'var(--bg-primary)', borderRadius: 10, fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center', maxWidth: 140 }}>Complete setup to accept</div>
                      )}
                      {!job.isOwnRequest && <button onClick={(e) => { e.stopPropagation(); openProposalModal(job); }}
                        style={{
                          padding: '7px 14px', background: 'var(--bg-surface)', color: 'var(--color-purple-light)', border: '2px solid #7c3aed',
                          borderRadius: '10px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
                        }}>Propose Different Time</button>}
                      {/* v1.105.100 — only a job actually offered to her can be DECLINED; an
                          open job is refused by simply not taking it, and the server rightly
                          404s that. Julia hit "Care request not found" twice on this button. */}
                      {!job.isOwnRequest && job.isDirectedAtMe && <button onClick={(e) => { e.stopPropagation(); setDecliningJob(job); setDeclineReason(''); }}
                        style={{
                          padding: '7px 14px', background: 'none', color: 'var(--text-tertiary)', border: 'none',
                          fontSize: '12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', textDecoration: 'underline',
                        }}>Can't make it</button>}
                      {!job.isOwnRequest && !job.isDirectedAtMe && <button onClick={(e) => { e.stopPropagation(); hideOpenJob(job.id); }}
                        style={{
                          padding: '7px 14px', background: 'none', color: 'var(--text-tertiary)', border: 'none',
                          fontSize: '12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', textDecoration: 'underline',
                        }}>Not for me</button>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* My Proposals — caregiver's sent time proposals, ABOVE sessions */}
      {(() => {
        const proposals = data.myProposals || [];
        if (proposals.length === 0) return null;
        const pendingProps = proposals.filter(p => p.status === 'pending');
        const expiredProps = proposals.filter(p => p.status === 'expired');
        if (pendingProps.length === 0 && expiredProps.length === 0) return null;
        const formatT = (t) => {
          if (!t) return '';
          const [h, min] = t.split(':').map(Number);
          const ap = h >= 12 ? 'PM' : 'AM';
          const dh = h > 12 ? h - 12 : h === 0 ? 12 : h;
          return `${dh}:${String(min || 0).padStart(2, '0')} ${ap}`;
        };
        return (
          <div style={{ marginBottom: 16 }}>
            {(pendingProps.length > 0 || expiredProps.length > 0) && (
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-violet)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
                {'\u{1F4E8}'} My Proposals ({pendingProps.length + expiredProps.length})
              </div>
            )}
            {/* Expired proposals — family never responded */}
            {expiredProps.map(p => {
              const tz = TimezoneHelper.DEFAULT_TZ;
              const propDay = TimezoneHelper.getDateLabel((p.proposedDate || '').split('T')[0], tz);
              const origDay = TimezoneHelper.getDateLabel((p.originalDate || '').split('T')[0], tz);
              return (
                <div key={p.id} className="card" style={{
                  marginBottom: 10, padding: '14px 16px', border: '2px solid #e0a030', borderRadius: 12, background: 'var(--color-warning-bg)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
                        {p.recipientName || 'Care Visit'}
                      </span>
                      <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 6 }}>
                        {p.familyName ? `(${p.familyName})` : ''}
                      </span>
                    </div>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, whiteSpace: 'nowrap',
                      background: '#e0a030', color: 'var(--text-on-primary)',
                    }}>
                      {'\u23F0'} Expired
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 4 }}>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Original</div>
                      <div style={{ fontSize: 13, color: 'var(--text-tertiary)', textDecoration: 'line-through' }}>{origDay} at {formatT(p.originalTime)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--color-warning)', fontWeight: 600, textTransform: 'uppercase' }}>You Proposed</div>
                      <div style={{ fontSize: 14, color: 'var(--color-warning)', fontWeight: 600 }}>{propDay} at {formatT(p.proposedTime)}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-warning)', fontWeight: 600, marginTop: 6 }}>
                    {'\u{26A0}\u{FE0F}'} Family didn't respond in time. This session is on hold — contact the family or wait for them to rebook.
                  </div>
                </div>
              );
            })}
            {/* Pending proposals — still waiting */}
            {pendingProps.map(p => {
              const tz = TimezoneHelper.DEFAULT_TZ;
              const propDay = TimezoneHelper.getDateLabel((p.proposedDate || '').split('T')[0], tz);
              const origDay = TimezoneHelper.getDateLabel((p.originalDate || '').split('T')[0], tz);
              // Countdown for 2-hour response window
              const expiresAt = p.expiresAt ? new Date(p.expiresAt) : null;
              const minsLeft = expiresAt ? Math.max(0, Math.floor((expiresAt - new Date()) / 60000)) : null;
              const hrsLeft = minsLeft !== null ? Math.floor(minsLeft / 60) : null;
              const minsRemainder = minsLeft !== null ? minsLeft % 60 : null;
              const isUrgent = minsLeft !== null && minsLeft <= 30;
              const timeLeftLabel = minsLeft !== null ? (hrsLeft > 0 ? `${hrsLeft}h ${minsRemainder}m` : `${minsLeft}m`) : null;
              return (
                <div key={p.id} className="card" style={{
                  marginBottom: 10, padding: '14px 16px', border: '2px solid #7b61ff', borderRadius: 12, background: '#f5f0ff',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
                        {p.recipientName || 'Care Visit'}
                      </span>
                      <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 6 }}>
                        {p.familyName ? `(${p.familyName})` : ''}
                      </span>
                    </div>
                    {timeLeftLabel && (
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, whiteSpace: 'nowrap',
                        background: isUrgent ? 'var(--accent-color)' : 'var(--color-violet)', color: 'var(--text-on-primary)',
                      }}>
                        {isUrgent ? '\u23F1' : '\u23F3'} {timeLeftLabel}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 4 }}>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Original</div>
                      <div style={{ fontSize: 13, color: 'var(--text-tertiary)', textDecoration: 'line-through' }}>{origDay} at {formatT(p.originalTime)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--color-violet)', fontWeight: 600, textTransform: 'uppercase' }}>You Proposed</div>
                      <div style={{ fontSize: 14, color: 'var(--color-violet)', fontWeight: 600 }}>{propDay} at {formatT(p.proposedTime)}</div>
                    </div>
                  </div>
                  {p.message && (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontStyle: 'italic', background: '#ede7f6', padding: '4px 8px', borderRadius: 6 }}>
                      "{p.message}"
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: isUrgent ? 'var(--accent-color)' : 'var(--color-violet)', fontWeight: 600, marginTop: 6 }}>
                    {minsLeft !== null
                      ? (isUrgent ? `\u23F1 Family has ${timeLeftLabel} to respond` : `\u23F3 Waiting for family \u2022 ${timeLeftLabel} left`)
                      : '\u23F3 Waiting for family to respond'}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* ── INCOMPLETE CHECK-IN BANNER ── */}
      {incompleteCheckIn && (() => {
        const elapsed = Math.floor((Date.now() - incompleteCheckIn.startedAt) / 60000);
        const remaining = Math.max(0, 30 - elapsed);
        const sess = incompleteCheckIn.session;
        const recipName = (sess.recipientName || sess.recipient_name || 'Care Session');
        return (
          <div onClick={() => {
            // Resume the check-in flow
            setCheckInSession(incompleteCheckIn.session);
            setIncompleteCheckIn(null);
          }} style={{
            margin: '0 0 12px 0', padding: '14px 16px', borderRadius: 12, cursor: 'pointer',
            background: 'linear-gradient(135deg, rgba(239,68,68,0.08), rgba(234,179,8,0.06))',
            border: '1px solid rgba(239,68,68,0.25)',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span style={{ fontSize: 24, flexShrink: 0 }}>🚨</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-error)', marginBottom: 2 }}>
                Check-in incomplete for {recipName}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                You haven't finished checking in
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 6px',
                  borderRadius: 6, fontSize: 11, fontWeight: 700,
                  background: remaining <= 10 ? 'rgba(239,68,68,0.15)' : 'rgba(234,179,8,0.15)',
                  color: remaining <= 10 ? 'var(--color-error)' : 'var(--color-warning)',
                  animation: remaining <= 10 ? 'incompleteCheckInPulse 2s infinite' : 'none',
                }}>⏱ No-show in {remaining} min</span>
              </div>
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-success)', whiteSpace: 'nowrap' }}>Finish →</span>
          </div>
        );
      })()}

      {/* UP NEXT — any session <24 hours away + in_progress, with check-in/out */}
      {/* Filter out sessions that have a pending OR expired counter-proposal — family never accepted the time change */}
      {(() => {
        const proposalSessionIds = new Set((data.myProposals || []).filter(p => p.status === 'pending' || p.status === 'expired').map(p => p.sessionId));
        const filteredUpNext = upNextSessions.filter(s => !proposalSessionIds.has(s.id));
        if (filteredUpNext.length === 0) return null;
        const readySet = new Set(readyToCheckIn.map(s => s.id));
        const sorted = [...filteredUpNext].sort((a, b) => {
          if (a.status === 'in_progress' && b.status !== 'in_progress') return -1;
          if (b.status === 'in_progress' && a.status !== 'in_progress') return 1;
          const aKey = (a.date || a.scheduled_date || '') + (a.time || a.scheduled_time || '');
          const bKey = (b.date || b.scheduled_date || '') + (b.time || b.scheduled_time || '');
          return aKey.localeCompare(bKey);
        });

        return (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Up Next</div>
            {sorted.map(s => {
              const isReady = readySet.has(s.id);
              const isActive = s.status === 'in_progress';
              const sDate = (s.date || s.scheduled_date || '').split('T')[0];
              const tz = s.timezone || TimezoneHelper.DEFAULT_TZ;
              const sessionStartET = TimezoneHelper.buildDateTime(sDate, s.time || s.scheduled_time || '00:00', tz);
              const minsUntil = (sessionStartET.getTime() - TimezoneHelper.realNowMs()) / 60000;
              const dayLabel = TimezoneHelper.getDateLabel(sDate, tz);
              const timeLabel = TimezoneHelper.formatTime(s.time || s.scheduled_time);
              const duration = s.durationHours || s.duration_hours;
              const svcType = s.serviceType || s.service_type;
              const recipName = s.recipientName || s.recipient_name || 'Session';
              const loc = s.location || (s.location_address ? `${s.location_address}, ${s.location_city || ''}` : s.location_city || '');
              const noAddress = !s.hasAddress && s.status === 'confirmed';

              // Countdown label + upcoming check-in state (15-60 min window)
              const isUpcoming = !isReady && !isActive && s.status === 'confirmed' && minsUntil > 0 && minsUntil <= 60;
              const minsUntilCheckIn = Math.max(0, minsUntil - 15); // check-in opens 15 min before session
              const countdownLabel = (() => {
                if (isReady || isActive) return null;
                if (minsUntilCheckIn <= 0) return null;
                const hours = Math.floor(minsUntilCheckIn / 60);
                const mins = Math.round(minsUntilCheckIn % 60);
                if (hours > 0) return `${hours}h ${mins}m until check-in`;
                return `${Math.ceil(minsUntilCheckIn)} min until check-in`;
              })();

              // Styling
              const hasPendingTimeChange = !!s.pendingTimeChangeId;
              const borderColor = hasPendingTimeChange ? 'var(--color-purple)' : isActive ? 'var(--color-warning)' : isReady ? 'var(--accent-color)' : isUpcoming ? 'var(--accent-color)' : noAddress ? 'var(--color-error)' : 'var(--role-color)';
              const borderWidth = hasPendingTimeChange ? 3 : isActive || isReady ? 3 : isUpcoming ? 2 : 2;
              const bgStyle = hasPendingTimeChange ? 'linear-gradient(135deg, var(--color-purple-bg) 0%, var(--bg-card) 100%)' : isActive ? 'linear-gradient(135deg, #fffde7 0%, #fff 100%)' : isReady ? 'linear-gradient(135deg, #fff3e0 0%, #fff 100%)' : 'var(--text-on-primary)';
              const shadow = hasPendingTimeChange ? '0 2px 12px rgba(123, 31, 162, 0.15)' : (isReady || isActive) ? '0 2px 12px rgba(232, 114, 74, 0.15)' : '0 1px 4px rgba(0,0,0,0.06)';

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
                      {isActive && (() => {
                        // v1.105.33 — the SCHEDULED end, not check-in + booked hours. The
                        // caregiver's own card is where this matters most: it should show
                        // the time the family is expecting them to finish, not a finish
                        // line that quietly slid because they arrived late. Pay is
                        // unaffected — that is computed server-side from real check-in and
                        // check-out, in 15-minute blocks.
                        const endMs = sessionStartET.getTime() + ((duration || 2) * 3600000);
                        const leftMs = endMs - Date.now();
                        const totalSec = Math.max(0, Math.floor(leftMs / 1000));
                        const hrs = Math.floor(totalSec / 3600);
                        const mins = Math.floor((totalSec % 3600) / 60);
                        const remainLabel = leftMs > 0 ? (hrs > 0 ? `${hrs}h ${mins}m remaining` : `${mins}m remaining`) : 'Expected end time passed';
                        const isPast = leftMs <= 0;
                        return React.createElement(React.Fragment, null,
                          React.createElement('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--color-warning)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 } }, 'In Progress Now'),
                          React.createElement('span', { style: {
                            display: 'inline-block', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6, marginBottom: 4,
                            color: isPast ? 'var(--color-error)' : 'var(--role-color)',
                            background: isPast ? 'var(--color-error-bg)' : 'var(--color-success-bg)',
                          }}, remainLabel)
                        );
                      })()}
                      {isReady && !isActive && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-color)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>Ready to Check In</div>}
                      {countdownLabel && <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-color)', marginBottom: 3 }}>{countdownLabel}</div>}
                      {hasPendingTimeChange && (
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-purple)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>
                          ⏰ Time Change Requested
                        </div>
                      )}
                      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{recipName}</div>
                      {hasPendingTimeChange && s.tcProposedTime ? (
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                          {dayLabel} at{' '}
                          <span style={{ textDecoration: 'line-through', opacity: 0.5 }}>{timeLabel}</span>
                          {' '}
                          <span style={{ color: 'var(--color-purple)', fontWeight: 700 }}>{TimezoneHelper.formatTime(s.tcProposedTime)}</span>
                          {s.tcProposedDuration && parseFloat(s.tcProposedDuration) !== parseFloat(duration) ? (
                            <>{' \u2022 '}<span style={{ textDecoration: 'line-through', opacity: 0.5 }}>{duration}hr</span>{' '}<span style={{ color: 'var(--color-purple)', fontWeight: 700 }}>{s.tcProposedDuration}hr</span></>
                          ) : duration ? ` \u2022 ${duration}hr` : ''}
                          {svcType ? ` \u2022 ${formatServiceType(svcType)}` : ''}
                        </div>
                      ) : (
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                          {dayLabel}{timeLabel ? ` at ${timeLabel}` : ''}{duration ? ` \u2022 ${duration}hr` : ''}{svcType ? ` \u2022 ${formatServiceType(svcType)}` : ''}
                        </div>
                      )}
                      {loc ? (
                        <a href={`https://maps.google.com/?q=${encodeURIComponent(loc)}`} target="_blank" rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ display: 'block', fontSize: 12, color: 'var(--role-color)', marginTop: 2, textDecoration: 'none' }}>
                          {'\uD83D\uDCCD'} {loc}
                        </a>
                      ) : noAddress ? (
                        <div style={{ fontSize: 12, color: 'var(--color-error)', marginTop: 2, fontWeight: 600 }}>{'\u26A0\uFE0F'} No care address on file</div>
                      ) : null}
                      {s.specialInstructions && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, fontStyle: 'italic' }}>{s.specialInstructions}</div>}
                      {/* View Care Profile toggle */}
                      <button onClick={(e) => {
                        e.stopPropagation();
                        if (expandedProfileId === s.id) {
                          setExpandedProfileId(null);
                        } else {
                          setExpandedProfileId(s.id);
                          if (!profileBriefings[s.id]) {
                            setProfileLoading(s.id);
                            apiFetch('/api/sessions/' + s.id + '/care-briefing')
                              .then(r => r?.ok ? r.json() : null)
                              .then(d => { if (d) setProfileBriefings(prev => ({...prev, [s.id]: d})); })
                              .catch(err => console.warn('Profile fetch failed:', err))
                              .finally(() => setProfileLoading(null));
                          }
                        }
                      }} style={{
                        marginTop: 8, padding: '4px 10px', background: 'transparent', border: '1px solid #ddd',
                        borderRadius: 6, fontSize: 11, fontWeight: 600, color: 'var(--role-color)', cursor: 'pointer',
                      }}>{expandedProfileId === s.id ? 'Hide Care Profile' : 'View Care Profile'}</button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                      {(s.caregiverPayout > 0 || s.estimatedCost > 0) && (
                        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--role-color)' }}>
                          ${(s.caregiverPayout || parseFloat(s.estimatedCost) || 0).toFixed(2)}
                        </div>
                      )}
                      {isActive && (<>
                        <button onClick={() => {
                          setCheckOutMood([]);
                          setCheckOutTags([]);
                          setCheckOutCareFeedback('');
                          setCheckOutServiceFeedback('');
                          setCheckOutSummary('');
                          setCheckOutPhotos([]);
                          setCheckOutPhotoUrls(prev => { prev.forEach(u => URL.revokeObjectURL(u)); return []; });
                          setEarlyDepartureReason('');
                          setEarlyDepartureAcked(false);
                          setCheckOutSession(s);
                        }} style={{
                          padding: '10px 22px', background: 'var(--color-error)', color: 'var(--text-on-primary)', border: 'none',
                          borderRadius: '10px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                          boxShadow: '0 2px 8px rgba(198,40,40,0.3)', whiteSpace: 'nowrap',
                        }}>Check Out</button>
                        {/* Nobody Home removed from post-check-in — moved to pre-check-in block below */}
                      </>)}
                      {isReady && !isActive && !s.family_no_show && (
                          <button onClick={async () => {
                            if (!confirm('Flag that nobody is home? You will need to wait 30 minutes before checking out for full pay.')) return;
                            try {
                              const r = await apiFetch(`/api/accountability/family-no-show/${s.id}`, { method: 'POST' });
                              if (r?.ok) {
                                const d = await r.json();
                                showToast(d.message || 'Family no-show flagged. Wait 30 minutes.', 'info');
                                // Refresh data
                                try { const dr = await apiFetch('/api/dashboard'); if (dr?.ok) setData(await dr.json()); } catch {}
                              } else {
                                const err = await r?.json().catch(() => ({}));
                                showToast(err?.error || 'Failed to flag no-show', 'error');
                              }
                            } catch { showToast('Network error', 'error'); }
                          }} style={{
                            padding: '8px 14px', background: 'var(--color-warning-bg)', color: 'var(--color-warning)', border: '1px solid #ffcc80',
                            borderRadius: '10px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
                          }}>Nobody Home</button>
                      )}
                      {isReady && !isActive && (
                        <button onClick={async () => {
                          setCheckInMood([]);
                          setCheckInNotes(null);
                          setCheckInLocation(null);
                          setLocationError(null);
                          setBriefingData(null);
                          setBriefingAcked(false);
                          setCheckInStep('briefing');
                          setBriefingLoading(true);
                          // Start geolocation early (skip in test mode)
                          if (window.getImpersonationToken && window.getImpersonationToken()) {
                            setCheckInLocation({ lat: 0, lng: 0, accuracy: 0, testMode: true });
                          } else {
                            // v1.105.54 — plugin-first; see getDeviceLocation.
                            getDeviceLocation({ timeoutMs: 8000 }).then(({ pos, reason }) => {
                              if (pos) {
                                setCheckInLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
                              } else {
                                setLocationError(reason === 'denied'
                                  ? 'Location is off for InPlace — turn it on in Settings to record your arrival.'
                                  : "Couldn't get your location. You can still check in.");
                              }
                            });
                          }
                          setCheckInSession(s);
                          // Fetch care briefing
                          try {
                            const bRes = await apiFetch('/api/sessions/' + s.id + '/care-briefing');
                            if (bRes?.ok) {
                              setBriefingData(await bRes.json());
                            }
                          } catch (e) { console.warn('Briefing fetch failed:', e); }
                          setBriefingLoading(false);
                        }} style={{
                          padding: '10px 22px', background: 'var(--accent-color)', color: 'var(--text-on-primary)', border: 'none',
                          borderRadius: '10px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                          boxShadow: '0 2px 8px rgba(232,114,74,0.3)', whiteSpace: 'nowrap',
                        }}>Check In Now</button>
                      )}
                      {/* On My Way button — show for upcoming confirmed sessions that haven't been signaled */}
                      {(isUpcoming || isReady) && !isActive && s.status === 'confirmed' && !onMyWaySent[s.id] && !s.on_my_way_at && (
                        <button
                          disabled={onMyWaySending === s.id}
                          onClick={async (e) => {
                            e.stopPropagation();
                            setOnMyWaySending(s.id);
                            try {
                              // Get current location for ETA calculation
                              let body = {};
                              try {
                                // v1.105.54 — plugin-first, and it always settles.
                                const { pos } = await getDeviceLocation({ timeoutMs: 5000 });
                                if (pos) body = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                              } catch {} // location optional — still send on-my-way
                              const r = await apiFetch(`/api/sessions/${s.id}/on-my-way`, {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(body),
                              });
                              if (r?.ok) {
                                setOnMyWaySent(prev => ({ ...prev, [s.id]: true }));
                                showToast('Care team notified — you\'re on your way!', 'success');
                                // Open maps for directions
                                if (loc) {
                                  openExternalUrl(`https://maps.google.com/?q=${encodeURIComponent(loc)}&navigate=yes`); // v1.105.49
                                }
                              } else {
                                const err = await r?.json().catch(() => ({}));
                                showToast(err?.error || 'Failed to send', 'error');
                              }
                            } catch { showToast('Network error', 'error'); }
                            setOnMyWaySending(null);
                          }}
                          style={{
                            padding: '8px 16px', background: 'linear-gradient(135deg, #1b6b5a, #2a9d8f)', color: '#fff', border: 'none',
                            borderRadius: '10px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                            boxShadow: '0 2px 8px rgba(27,107,90,0.3)', whiteSpace: 'nowrap',
                            display: 'flex', alignItems: 'center', gap: 6,
                            opacity: onMyWaySending === s.id ? 0.6 : 1,
                          }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
                          </svg>
                          {onMyWaySending === s.id ? 'Sending...' : 'On My Way'}
                        </button>
                      )}
                      {(onMyWaySent[s.id] || s.on_my_way_at) && !isActive && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                          En route
                        </span>
                      )}
                      {isUpcoming && (
                        <button disabled style={{
                          padding: '10px 22px', background: 'var(--bg-primary)', color: 'var(--text-muted)', border: '1px solid #ddd',
                          borderRadius: '10px', fontSize: '14px', fontWeight: 600, cursor: 'default',
                          whiteSpace: 'nowrap',
                        }}>Check in {Math.ceil(minsUntilCheckIn)} min</button>
                      )}
                      {s.status === 'confirmed' && !hasPendingTimeChange && !isReady && !isActive && (
                        <button onClick={(e) => { e.stopPropagation(); setTimeChangeModal({ sessionId: s.id, session: s }); setTcNewTime(s.scheduled_time || ''); setTcNewDuration(String(duration || 2)); setTcReason(''); }}
                          style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid var(--color-purple)', background: 'var(--color-purple-bg)', color: 'var(--color-purple)', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
                          Change Time
                        </button>
                      )}
                      {hasPendingTimeChange && (
                        <button onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            const r = await apiFetch(`/api/sessions/${s.id}/time-change`);
                            if (r?.ok) { const d = await r.json(); setTimeChangeProposal({ ...d.proposal, session: s }); }
                          } catch {}
                        }}
                          style={{ padding: '3px 8px', borderRadius: 6, border: 'none', background: 'var(--color-purple)', color: 'var(--text-on-primary)', fontSize: 10, fontWeight: 700, cursor: 'pointer', animation: 'pulse 2s infinite' }}>
                          Review Change
                        </button>
                      )}
                      {s.status === 'payment_hold' && (
                        <span style={{
                          padding: '5px 12px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                          background: '#fff3e0', color: '#e65100',
                        }}>On Hold — Payment</span>
                      )}
                      {!isReady && !isActive && !isUpcoming && s.status !== 'payment_hold' && (
                        <span style={{
                          padding: '5px 12px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                          background: s.status === 'confirmed' ? 'var(--color-success-bg)' : 'var(--color-warning-bg)',
                          color: s.status === 'confirmed' ? 'var(--color-success)' : 'var(--color-warning)',
                          textTransform: 'capitalize',
                        }}>{s.status}</span>
                      )}
                    </div>
                  </div>
                  {/* Expandable Care Profile */}
                  {expandedProfileId === s.id && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #eee' }}>
                      {profileLoading === s.id && <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '8px 0' }}>Loading care profile...</div>}
                      {profileBriefings[s.id] && (() => {
                        const pb = profileBriefings[s.id];
                        return (
                          <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                            {pb.isExperienced && <div style={{ fontSize: 11, color: 'var(--role-color)', fontWeight: 600, marginBottom: 6 }}>{'\u2705'} You've cared for {pb.recipientName} {pb.visitCount} time{pb.visitCount != 1 ? 's' : ''}</div>}
                            {pb.caregiverBriefing && (
                              <div style={{ padding: '8px 10px', background: '#f8f8f8', borderLeft: '3px solid #e8724a', borderRadius: 4, marginBottom: 8, color: 'var(--text-secondary)', whiteSpace: 'pre-line' }}>
                                {pb.caregiverBriefing}
                              </div>
                            )}
                            {pb.healthConditions && pb.healthConditions.length > 0 && (
                              <div style={{ marginBottom: 6 }}>
                                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Health: </span>
                                {pb.healthConditions.map((c, i) => (
                                  <span key={i} style={{ background: 'var(--color-warning-bg)', color: 'var(--color-warning)', padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 600, marginRight: 4 }}>{c}</span>
                                ))}
                              </div>
                            )}
                            {pb.medications && pb.medications.length > 0 && (
                              <div style={{ marginBottom: 6 }}>
                                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Medications: </span>
                                <span style={{ color: 'var(--text-secondary)' }}>{pb.medications.join(', ')}</span>
                              </div>
                            )}
                            {pb.foodAllergies && (
                              <div style={{ marginBottom: 6 }}>
                                <span style={{ fontWeight: 600, color: 'var(--color-error)' }}>Allergies: </span>
                                <span style={{ color: 'var(--color-error)' }}>{pb.foodAllergies}</span>
                              </div>
                            )}
                            {pb.recentMoods && pb.recentMoods.length > 0 && (
                              <div style={{ marginBottom: 4 }}>
                                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Recent moods: </span>
                                {pb.recentMoods.slice(0, 3).map((m, i) => (
                                  <span key={i} style={{ fontSize: 11, color: 'var(--text-secondary)', marginRight: 6 }}>{m.arrivalMood}{'\u2192'}{m.departureMood}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Find Work — shows available jobs */}
      {bgCheckPaid && (() => {
        // Filter out jobs caregiver already has a pending proposal on (shown in My Proposals)
        const pendingProposalSessionIds = new Set((data.myProposals || []).filter(p => p.status === 'pending').map(p => p.sessionId));
        // Filter out exclusive (non-expired) direct offers — they're shown in the "Just for You" section above
        const nonExclusiveJobs = openJobs.filter(job => {
          if (pendingProposalSessionIds.has(job.id)) return false; // already proposed on this job
          if (!job.offeredToCaregiverId) return true; // regular jobs stay
          return isExclusiveExpired(job, exclusiveNow); // expired ones fall back to Find Work
        });
        const sortedJobs = [...nonExclusiveJobs].sort((a, b) => {
          // Direct offers (expired exclusive) on top
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
          <div style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 20, border: '1px solid #d4edda', background: 'var(--bg-surface)' }}>
            {/* Green header */}
            <div style={{ background: 'linear-gradient(135deg, #1b6b5a 0%, #24897a 100%)', color: 'var(--text-on-primary)', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
              onClick={() => window.__navigateTo && window.__navigateTo('find-work')}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 17 }}>🔍 Find Work</div>
                <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>{nonExclusiveJobs.length} open job{nonExclusiveJobs.length !== 1 ? 's' : ''} near you</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <select value={jobSort} onChange={(e) => { e.stopPropagation(); setJobSort(e.target.value); }}
                  onClick={(e) => e.stopPropagation()}
                  style={{ fontSize: 11, padding: '3px 6px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.15)', color: 'var(--text-on-primary)', cursor: 'pointer' }}>
                  <option value="best_match" style={{ color: 'var(--text-primary)' }}>Best Match</option>
                  <option value="soonest" style={{ color: 'var(--text-primary)' }}>Soonest</option>
                  <option value="highest_pay" style={{ color: 'var(--text-primary)' }}>Highest Pay</option>
                </select>
                <span style={{ fontSize: 22, opacity: 0.7 }}>→</span>
              </div>
            </div>
            {/* Job list */}
            {sortedJobs.length > 0 && (
              <div style={{ padding: '4px 0' }}>
                {sortedJobs.map(job => {
                  const sDate = (job.date || '').split('T')[0];
                  const jobTz = job.timezone || TimezoneHelper.DEFAULT_TZ;
                  const dayDiff = sDate ? TimezoneHelper.getDaysUntil(sDate, jobTz) : null;
                  const dayLabel = sDate ? TimezoneHelper.getDateLabel(sDate, jobTz) : '';
                  const tParts = (job.time || '').split(':').map(Number);
                  const timeLabel = tParts.length >= 2 ? `${tParts[0] > 12 ? tParts[0] - 12 : tParts[0] || 12}:${String(tParts[1]).padStart(2, '0')} ${tParts[0] >= 12 ? 'PM' : 'AM'}` : '';

                  // v1.105.106 — see the exclusive card above: one shared computation.
                  const { total: effectiveTotal, perHour: effectivePerHour, basePerHour, hasBonus } = jobPay(job);

                  const isDirectOffer = !!job.offeredToCaregiverId;
                  // Exclusive timer countdown
                  const exclusiveRemaining = exclusiveMinutesLeft(job, exclusiveNow);
                  const exclusiveExpired = isExclusiveExpired(job, exclusiveNow);
                  const exclusiveUrgent = exclusiveRemaining !== null && exclusiveRemaining <= 10 && !exclusiveExpired;

                  return (
                    <div key={job.id} style={{
                      marginBottom: 8, padding: '14px 16px',
                      background: (isDirectOffer && !exclusiveExpired) ? 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)' : job.hasConflict ? '#fffbf0' : 'var(--bg-card)',
                      borderRadius: 0,
                      border: (isDirectOffer && !exclusiveExpired) ? '2px solid #7c3aed' : job.hasConflict ? '1px solid #ffd89b' : (!job.hasConflict && job.matchQuality === 'great') ? '2px solid #1b6b5a' : hasBonus ? '1px solid #e8724a' : '1px solid #f0f0f0',
                      borderTop: (isDirectOffer && !exclusiveExpired) ? '2px solid #7c3aed' : job.hasConflict ? '1px solid #ffd89b' : '1px solid #f0f0f0',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
                    }}>
                      <div style={{ flex: 1, minWidth: '180px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                          {isDirectOffer && !exclusiveExpired && (
                            <span className={exclusiveUrgent ? 'exclusive-urgent' : ''} style={{ background: exclusiveUrgent ? 'var(--accent-color)' : 'var(--color-purple-light)', color: 'var(--text-on-primary)', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700 }}>
                              {exclusiveRemaining !== null ? (exclusiveUrgent ? `\u23F1 ${exclusiveRemaining} min left!` : `\u2728 JUST FOR YOU \u00B7 ${exclusiveRemaining} min left`) : '\u2728 JUST FOR YOU'}
                            </span>
                          )}
                          {hasBonus && (
                            <span style={{ background: 'var(--accent-color)', color: 'var(--text-on-primary)', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700 }}>BONUS PAY</span>
                          )}
                          {job.matchQuality === 'great' && !job.hasConflict && !isDirectOffer && (
                            React.createElement(window.IPAiBadge, { size: 'sm' })
                          )}
                          {job.hasConflict ? (
                            <span style={{ background: '#ffd89b', color: '#c86b1f', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>{'\u26A0'} Overlaps {job.conflictWith}</span>
                          ) : (
                            <span onClick={(e) => { e.stopPropagation(); if (calendarRef.current) calendarRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                              style={{ background: 'var(--color-success-bg)', color: 'var(--color-success)', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>{'\u2713'} No Conflicts</span>
                          )}
                          {job.distanceMiles !== null && job.distanceMiles !== undefined && (
                            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{job.distanceMiles} mi</span>
                          )}
                          {hasBonus && basePerHour > 0 ? (
                            <span style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ textDecoration: 'line-through', color: 'var(--text-muted)', fontSize: 12 }}>{formatMoney(basePerHour)}/hr</span>
                              <span style={{ color: 'var(--role-color)', fontWeight: 700, fontSize: 14 }}>{formatMoney(effectivePerHour)}/hr</span>
                            </span>
                          ) : basePerHour > 0 ? (
                            <span style={{ background: 'var(--color-success-bg)', color: 'var(--role-color)', padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 700 }}>{formatMoney(basePerHour)}/hr</span>
                          ) : null}
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{formatServiceType(job.serviceType)}</div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                          {dayLabel}{timeLabel ? ` at ${timeLabel}` : ''}{job.durationHours ? ` \u2022 ${job.durationHours}hr` : ''}
                          {effectiveTotal > 0 && <React.Fragment><span> {'\u2022'} </span><span style={{ fontWeight: 800, color: 'var(--role-color)', fontSize: 20 }}>{formatMoney(effectiveTotal)}</span><span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}> total</span></React.Fragment>}
                        </div>
                        {job.recipientCity && <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>{'\uD83D\uDCCD'} {job.recipientCity}</div>}
                        {job.familyName && <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 1 }}>Requested by {job.familyName}</div>}
                        {/* Health tags + care summary */}
                        {job.healthTags && job.healthTags.length > 0 && (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                            {job.healthTags.map((tag, idx) => (
                              <span key={idx} style={{ fontSize: 10, background: 'var(--color-warning-bg)', color: 'var(--color-warning)', padding: '2px 7px', borderRadius: 10, fontWeight: 600 }}>{tag}</span>
                            ))}
                          </div>
                        )}
                        {job.careSummary && (
                          <div style={{ marginTop: 6, padding: '6px 8px', background: '#f8f8f8', borderLeft: '3px solid #e8724a', borderRadius: 4, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                            {'\uD83D\uDCCB'} {expandedSummaryJobId === job.id || job.careSummary.length <= 150
                            ? job.careSummary
                            : job.careSummary.substring(0, 150) + '\u2026'}
                          {job.careSummary.length > 150 && (
                            <button onClick={(e) => { e.stopPropagation(); setExpandedSummaryJobId(expandedSummaryJobId === job.id ? null : job.id); }}
                              style={{ display: 'block', marginTop: 4, background: 'none', border: 'none', padding: 0, font: 'inherit', fontSize: 11, fontWeight: 700, color: 'var(--accent-color)', cursor: 'pointer' }}>
                              {expandedSummaryJobId === job.id ? 'Show less' : 'Read more'}
                            </button>
                          )}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                        {/* v1.105.89 — see the other job card: shown, never acceptable. */}
                        {job.isOwnRequest ? (
                          <div style={{ padding: '10px 14px', background: 'var(--bg-primary)', border: '1px solid var(--border-light)', borderRadius: 10, fontSize: 11.5, color: 'var(--text-secondary)', textAlign: 'center', maxWidth: 170, lineHeight: 1.45 }}>
                            <strong style={{ display: 'block', color: 'var(--text-primary)', marginBottom: 2 }}>You posted this</strong>
                            It{'\u2019'}s live and others can accept it {'\u2014'} you just can{'\u2019'}t accept your own request.
                          </div>
                        ) : profile.caregiverCleared ? (
                        <button onClick={(e) => { if (!profile.accountPaused) handleClaimJob(job.id, e, effectiveTotal); }} disabled={claimingJobId === job.id || profile.accountPaused}
                          title={profile.accountPaused ? 'Your account is paused. Contact support for assistance.' : ''}
                          style={{
                            padding: '10px 20px', background: claimingJobId === job.id || profile.accountPaused ? 'var(--border-light)' : 'var(--accent-color)', color: 'var(--text-on-primary)', border: 'none',
                            borderRadius: '10px', fontSize: '14px', fontWeight: 700, cursor: claimingJobId === job.id || profile.accountPaused ? 'not-allowed' : 'pointer',
                            boxShadow: '0 2px 6px rgba(232,114,74,0.3)', whiteSpace: 'nowrap',
                          }}>{profile.accountPaused ? '❌ Account Paused' : claimingJobId === job.id ? 'Accepting...' : 'Accept Job'}</button>
                        ) : (
                          <div style={{ padding: '8px 14px', background: 'var(--bg-primary)', borderRadius: 10, fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center', maxWidth: 140 }}>Complete setup to accept</div>
                        )}
                        {!job.isOwnRequest && <button onClick={(e) => { e.stopPropagation(); openProposalModal(job); }}
                          style={{
                            padding: '7px 14px', background: 'var(--bg-surface)', color: 'var(--role-color)', border: '2px solid #1b6b5a',
                            borderRadius: '10px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
                          }}>Propose Different Time</button>}
                      {/* v1.105.100 — only a job actually offered to her can be DECLINED; an
                          open job is refused by simply not taking it, and the server rightly
                          404s that. Julia hit "Care request not found" twice on this button. */}
                      {!job.isOwnRequest && job.isDirectedAtMe && <button onClick={(e) => { e.stopPropagation(); setDecliningJob(job); setDeclineReason(''); }}
                        style={{
                          padding: '7px 14px', background: 'none', color: 'var(--text-tertiary)', border: 'none',
                          fontSize: '12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', textDecoration: 'underline',
                        }}>Can't make it</button>}
                      {!job.isOwnRequest && !job.isDirectedAtMe && <button onClick={(e) => { e.stopPropagation(); hideOpenJob(job.id); }}
                        style={{
                          padding: '7px 14px', background: 'none', color: 'var(--text-tertiary)', border: 'none',
                          fontSize: '12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', textDecoration: 'underline',
                        }}>Not for me</button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {/* Footer */}
            <div style={{ textAlign: 'center', padding: '10px', borderTop: '1px solid #f0f0f0' }}>
              <span onClick={() => window.__navigateTo && window.__navigateTo('find-work')} style={{ fontSize: 13, color: 'var(--role-color)', fontWeight: 600, cursor: 'pointer' }}>
                View all jobs, map & availability →
              </span>
            </div>
          </div>
        );
      })()}

      {/* Scheduled — sessions >24hr away, after Find Work */}
      {(() => {
        const pendingProposalSessionIds = new Set((data.myProposals || []).filter(p => p.status === 'pending').map(p => p.sessionId));
        const sorted = [...scheduledSessions].filter(s => !pendingProposalSessionIds.has(s.id)).sort((a, b) => {
          const aKey = (a.date || a.scheduled_date || '') + (a.time || a.scheduled_time || '');
          const bKey = (b.date || b.scheduled_date || '') + (b.time || b.scheduled_time || '');
          return aKey.localeCompare(bKey);
        });

        const filteredUpNext = upNextSessions.filter(s => !pendingProposalSessionIds.has(s.id));
        if (sorted.length === 0 && filteredUpNext.length === 0) return (
          <div className="card" style={{ marginBottom: 16, padding: '24px', textAlign: 'center', borderLeft: '4px solid #1b6b5a' }}>
            <div style={{ fontSize: 20, marginBottom: 8 }}>{'\uD83D\uDCCB'}</div>
            <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)', marginBottom: 4 }}>No upcoming sessions</div>
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Check the <span style={{ color: 'var(--role-color)', fontWeight: 600, cursor: 'pointer' }} onClick={() => setActiveTab('schedule')}>Calendar</span> for available care requests in your area.</div>
          </div>
        );

        if (sorted.length === 0) return null;

        return (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
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

              const calendarDays = TimezoneHelper.getDaysUntil(sDate, tz);
              const dayCountLabel = calendarDays === 0 ? 'today' : calendarDays === 1 ? 'tomorrow' : `in ${calendarDays} days`;

              const isSchedExpanded = expandedScheduledId === s.id;
              return (
                <div key={s.id} className="card" onClick={(e) => {
                  if (e.target.tagName === 'BUTTON') return;
                  setExpandedScheduledId(isSchedExpanded ? null : s.id);
                }} style={{
                  marginBottom: 10, padding: '16px 18px', cursor: 'pointer',
                  border: `2px solid ${noAddress ? 'var(--color-error)' : 'var(--role-color)'}`,
                  borderRadius: 12,
                  background: 'var(--bg-surface)',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '180px' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 3 }}>{dayCountLabel}</div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {recipName}
                        {s.interviewStatus && (
                          <span style={{ marginLeft: 6, fontSize: 10, color: s.interviewStatus === 'accepted' ? 'var(--color-success)' : 'var(--color-purple)' }}>{'\uD83C\uDFA5'}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                        {dayLabel}{timeLabel ? ` at ${timeLabel}` : ''}{duration ? ` \u2022 ${duration}hr` : ''}
                        {svcType ? ` \u2022 ${formatServiceType(svcType)}` : ''}
                      </div>
                      {loc ? (
                        <a href={`https://maps.google.com/?q=${encodeURIComponent(loc)}`} target="_blank" rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ display: 'block', fontSize: 12, color: 'var(--role-color)', marginTop: 2, textDecoration: 'none' }}>
                          {'\uD83D\uDCCD'} {loc}
                        </a>
                      ) : noAddress ? (
                        <div style={{ fontSize: 12, color: 'var(--color-error)', marginTop: 2, fontWeight: 600 }}>{'\u26A0\uFE0F'} No care address on file</div>
                      ) : null}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                      {(s.caregiverPayout > 0 || s.estimatedCost > 0) && (
                        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--role-color)' }}>
                          ${(s.caregiverPayout || parseFloat(s.estimatedCost) || 0).toFixed(2)}
                        </div>
                      )}
                      <span style={{
                        padding: '5px 12px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                        background: s.status === 'payment_hold' ? '#fff3e0' : s.status === 'confirmed' ? 'var(--color-success-bg)' : 'var(--color-warning-bg)',
                        color: s.status === 'payment_hold' ? '#e65100' : s.status === 'confirmed' ? 'var(--color-success)' : 'var(--color-warning)',
                        textTransform: 'capitalize',
                      }}>{s.status === 'payment_hold' ? 'On Hold — Payment' : s.status}</span>
                    </div>
                  </div>
                  {/* Expanded details */}
                  {isSchedExpanded && (
                    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #f0f0f0', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <button onClick={(e) => { e.stopPropagation(); setVisitDetailSessionId(s.id); }}
                        style={{ padding: '6px 12px', background: 'var(--bg-primary)', color: 'var(--text-secondary)', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                        View Details
                      </button>
                      {s.status === 'confirmed' && !s.interviewStatus && (
                        <button onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            const res = await apiFetch('/api/interviews', { method: 'POST', body: JSON.stringify({ sessionId: s.id, interviewType: 'video' }) });
                            if (res?.ok) {
                              showToast && showToast('Interview request sent! Check Messages.', 'success');
                              apiFetch('/api/dashboard').then(r2 => r2?.ok && r2.json().then(d => setData(d))).catch(() => {});
                            } else {
                              const err = await res.json().catch(() => ({}));
                              showToast && showToast(err.error || 'Could not request interview', 'error');
                            }
                          } catch (err) { console.error('Interview request error:', err); }
                        }} style={{ padding: '6px 12px', background: '#faf5ff', color: 'var(--color-purple)', border: '1px solid #e1bee7', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                          {'\uD83C\uDFA5'} Request Interview
                        </button>
                      )}
                      {s.interviewStatus === 'pending' && (
                        <span style={{ padding: '6px 12px', background: '#faf5ff', color: 'var(--color-purple)', borderRadius: 8, fontSize: 12, fontWeight: 500 }}>{'\uD83C\uDFA5'} Interview pending</span>
                      )}
                      {s.interviewStatus === 'accepted' && (
                        <span style={{ padding: '6px 12px', background: 'var(--color-success-bg)', color: 'var(--color-success)', borderRadius: 8, fontSize: 12, fontWeight: 500 }}>{'\u2713'} Interview set</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {sorted.length > 5 && (
              <div style={{ textAlign: 'center', padding: '8px' }}>
                <span onClick={() => setActiveTab('schedule')} style={{ fontSize: 13, color: 'var(--role-color)', fontWeight: 600, cursor: 'pointer' }}>
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
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Completed</div>
            {completed.slice(0, 2).map((s, i) => {
              const sDate = (s.date || '').split('T')[0];
              const tz = s.timezone || TimezoneHelper.DEFAULT_TZ;
              const dayLabel = TimezoneHelper.getDateLabel(sDate, tz);
              const timeLabel = TimezoneHelper.formatTime(s.time);
              const recipName = s.recipientName || 'Session';
              return (
                <div key={s.id} style={{ padding: '14px 18px', borderRadius: 12, marginBottom: 8, background: 'var(--bg-primary)', border: '1px solid #e5e7eb', opacity: i === 0 ? 1 : 0.7 }}>
                  <div onClick={() => {
                    if (s.id) setVisitDetailSessionId(s.id);
                  }} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{recipName}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                        {dayLabel}{timeLabel ? ` at ${timeLabel}` : ''}{s.durationHours ? ` \u2022 ${s.durationHours}hr` : ''}
                        {s.serviceType ? ` \u2022 ${formatServiceType(s.serviceType)}` : ''}
                      </div>
                      {s.visitSummary && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3, fontStyle: 'italic' }}>{s.visitSummary.length > 80 ? s.visitSummary.substring(0, 80) + '...' : s.visitSummary}</div>}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <span style={{ padding: '3px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: 'var(--color-success-bg)', color: 'var(--color-success)' }}>{'\u2713'} Done</span>
                      {s.caregiverPayout > 0 && <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--role-color)', background: 'var(--color-success-bg)', padding: '4px 10px', borderRadius: 8 }}>${s.caregiverPayout.toFixed(2)}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

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

      {/* Recent Activity — in-app notifications (v1.56.0) */}
      {(() => {
        const unread = notifications.filter(n => !n.read);
        if (unread.length === 0) return null;
        const typeIcons = { care_request_accepted: '\u2705', message: '\u{1F4AC}', payment: '\u{1F4B3}', manual_payment: '\u{1F4B5}', time_proposal: '\u{1F552}', general: '\u{1F514}' };
        const getIcon = (type) => typeIcons[type] || '\u{1F514}';
        const timeAgo = (dateStr) => { const d = Date.now() - new Date(dateStr).getTime(), m = Math.floor(d/60000); return m < 1 ? 'Just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m/60)}h ago` : `${Math.floor(m/1440)}d ago`; };
        const markRead = async (ids) => {
          try { await apiFetch('/api/push/notifications/mark-read', { method: 'POST', body: JSON.stringify({ ids: ids || [] }) }); setNotifications(prev => prev.map(n => ids ? (ids.includes(n.id) ? { ...n, read: 1 } : n) : { ...n, read: 1 })); setUnreadNotifCount(prev => ids ? Math.max(0, prev - ids.length) : 0); } catch {}
        };
        return (
          <div className="card" style={{ marginBottom: 16, padding: '16px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
                {'\u{1F514}'} Recent Activity ({unread.length})
              </h3>
              {unread.length > 1 && <button onClick={() => markRead(unread.map(n => n.id))} style={{ padding: '4px 10px', background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Mark all read</button>}
            </div>
            {unread.slice(0, 5).map(n => (
              <div key={n.id} className="activity-new-shimmer" onClick={() => {
                markRead([n.id]);
                // v1.97.0 — tap goes to the item itself via the central deep-link router
                try { const d = n.data ? (typeof n.data === 'string' ? JSON.parse(n.data) : n.data) : null; if (d && window.__handlePushNavigate) window.__handlePushNavigate(d); } catch {}
              }} style={{
                padding: '10px 12px', marginBottom: 6, borderRadius: 8, cursor: 'pointer',
                border: '1.5px solid #4a90d9', background: 'rgba(74, 144, 217, 0.04)', position: 'relative', overflow: 'hidden',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{getIcon(n.type)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{n.title}</div>
                    {n.body && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.body}</div>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{timeAgo(n.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Payments Received — manual payments from families */}
      {manualPaymentsReceived.length > 0 && (
        <div className="card" style={{ marginBottom: 16, padding: '16px 18px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {'\uD83D\uDCB0'} Payments Received
          </h3>
          {completedPaymentCount !== null && completedPaymentCount <= 1 && (
            <div style={{ padding: '10px 14px', background: '#FEF9E7', border: '1px solid #F9E79F', borderRadius: 10, marginBottom: 14, fontSize: 12, color: '#7D6608', lineHeight: 1.5 }}>
              {'\u23F3'} <strong>First payout:</strong> Your first bank deposit from Stripe typically takes 7–14 business days. After that, payouts arrive in 2–3 business days.
            </div>
          )}
          {manualPaymentsReceived.map(p => {
            const payoutDate = p.payoutExpectedDate ? new Date(p.payoutExpectedDate + 'T00:00:00') : null;
            const now = new Date();
            const isPaidOut = payoutDate && payoutDate <= now;
            const payoutLabel = isPaidOut ? 'Deposited' : payoutDate ? `Bank deposit by ${payoutDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'Processing';
            return (
              <div key={p.id} style={{ padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                      ${p.amount.toFixed(2)} from {p.fromName || 'Family'}
                    </div>
                    {p.note && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, fontStyle: 'italic' }}>"{p.note}"</div>}
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                      Received {new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <span style={{ padding: '3px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: 'var(--color-success-bg)', color: 'var(--color-success)' }}>
                      {p.status === 'completed' ? '\u2713 Paid' : p.status}
                    </span>
                    <span style={{ fontSize: 11, color: isPaidOut ? 'var(--color-success)' : '#e8724a', fontWeight: 500 }}>
                      {isPaidOut ? '\uD83C\uDFE6' : '\u23F3'} {payoutLabel}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, padding: '8px 0 0', borderTop: '1px solid #f0f0f0' }}>
            Payments are deposited to your bank account automatically. First payout takes 7–14 days; after that, 2–3 business days.
          </div>
        </div>
      )}

      {/* Tab Content */}
      <div ref={tabContentRef} style={{
        borderRadius: highlightTab ? '12px' : undefined,
        boxShadow: highlightTab ? '0 0 0 3px #e8724a, 0 0 20px rgba(232,114,74,0.3)' : undefined,
        transition: 'box-shadow 0.3s ease',
      }}>

      {/* Inline Profile Editor (during onboarding) */}
      {activeTab === 'profile' && (
        <div className="card" style={{ padding: '24px' }}>
          <h3 style={{ margin: '0 0 4px', fontSize: '18px', color: 'var(--role-color)' }}>Complete Your Profile</h3>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 20px' }}>This is what families see when deciding who to hire. Make a great first impression!</p>
          <div style={{ display: 'grid', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>Bio / About You</label>
              <textarea value={profileForm.bio} onChange={(e) => setProfileForm(p => ({ ...p, bio: e.target.value }))}
                placeholder="Tell families about yourself — your experience, personality, and why you love caregiving..."
                rows={4} style={{ width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>Your Rates ($/hr)</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Daytime (6a–6p)</div>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--text-tertiary)', fontSize: '14px' }}>$</span>
                    <input type="number" value={profileForm.rateDaytime} onChange={(e) => setProfileForm(p => ({ ...p, rateDaytime: e.target.value }))}
                      placeholder="25" min="15" max="200" style={{ width: '100%', padding: '10px 10px 10px 24px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} />
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Evening (6p–12a)</div>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--text-tertiary)', fontSize: '14px' }}>$</span>
                    <input type="number" value={profileForm.rateNighttime} onChange={(e) => setProfileForm(p => ({ ...p, rateNighttime: e.target.value }))}
                      placeholder="30" min="15" max="200" style={{ width: '100%', padding: '10px 10px 10px 24px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} />
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Overnight (12a–6a)</div>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--text-tertiary)', fontSize: '14px' }}>$</span>
                    <input type="number" value={profileForm.rateOvernight} onChange={(e) => setProfileForm(p => ({ ...p, rateOvernight: e.target.value }))}
                      placeholder="35" min="15" max="200" style={{ width: '100%', padding: '10px 10px 10px 24px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} />
                  </div>
                </div>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '6px' }}>6-hour minimum per booking. Typical range: $20–$35/hr.</div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>Food Allergies <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional — so families know)</span></label>
              <input type="text" value={profileForm.foodAllergies} onChange={(e) => setProfileForm(p => ({ ...p, foodAllergies: e.target.value }))}
                placeholder="e.g. peanuts, shellfish, none" style={{ width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>Medical Conditions <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional — anything families should know)</span></label>
              <input type="text" value={profileForm.medicalConditions} onChange={(e) => setProfileForm(p => ({ ...p, medicalConditions: e.target.value }))}
                placeholder="e.g. asthma, none" style={{ width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
            <button onClick={() => setActiveTab('schedule')} style={{
              padding: '10px 24px', background: 'var(--badge-muted-bg)', color: 'var(--text-secondary)', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
            }}>Back</button>
            <button onClick={saveOnboardingProfile} disabled={profileSaving || !profileForm.bio || !profileForm.rateDaytime} style={{
              padding: '10px 24px', background: profileForm.bio && profileForm.rateDaytime ? 'var(--role-color)' : 'var(--border-light)',
              color: 'var(--text-on-primary)', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600,
              cursor: profileForm.bio && profileForm.rateDaytime ? 'pointer' : 'not-allowed', opacity: profileSaving ? 0.6 : 1,
            }}>{profileSaving ? 'Saving...' : 'Save Profile'}</button>
          </div>
        </div>
      )}

      {/* ─── Refer a Caregiver ─── */}
      <div style={{ marginBottom: 16 }}>
        <div onClick={() => setShowReferralSection(!showReferralSection)} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer', padding: '14px 18px',
          background: showReferralSection ? 'linear-gradient(135deg, #e8f5e9 0%, #f1f8e9 100%)' : 'var(--bg-card)',
          border: '1px solid #c8e6c9', borderRadius: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22 }}>{'\u{1F91D}'}</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--role-color)' }}>Refer a Caregiver</div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                {referralData ? `${referralData.totalClaimed || 0} joined` : 'Invite friends to join inPlace'}
              </div>
            </div>
          </div>
          <span style={{ fontSize: 18, color: 'var(--text-muted)', transform: showReferralSection ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>{'\u25BC'}</span>
        </div>
        {showReferralSection && (
          <div style={{ background: 'var(--bg-surface)', border: '1px solid #e0e0e0', borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '18px' }}>
            {/* Referral link */}
            {referralData && (
              <div style={{ marginBottom: 16, padding: '12px 14px', background: '#f8fdf8', border: '1px solid #c8e6c9', borderRadius: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--role-color)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Your Referral Link</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="text" readOnly value={referralData.referralLink || ''} style={{
                    flex: 1, padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, color: 'var(--text-secondary)', background: 'var(--bg-surface)',
                  }} />
                  {/* v1.105.69 — the write was discarded and the toast fired unconditionally.
                      A caregiver pasted nothing, sent nothing, and lost the referral credit. */}
                  <button onClick={async () => {
                    const ok = await copyText(referralData.referralLink || '');
                    showToast(ok ? 'Link copied!' : 'Could not copy — press and hold the link to copy it', ok ? 'success' : 'error');
                  }} style={{
                    padding: '8px 14px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
                  }}>Copy</button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Share this link — anyone who signs up through it is automatically credited to you.</div>

                {/* v1.105.26 — the same link, scannable.
                    Copy-paste works when the other person is somewhere else. In person it
                    does not: you end up reading a URL aloud or spelling out a code. This is
                    for the conversation that happens standing in a kitchen or a break room,
                    which at this stage is how most caregivers will actually hear about it.
                    Encodes the SAME referral link, so credit still lands. */}
                <button onClick={() => setShowReferralQr(v => !v)} style={{
                  marginTop: 10, padding: '6px 12px', background: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)', borderRadius: 6, fontSize: 12,
                  fontWeight: 600, color: 'var(--role-color)', cursor: 'pointer',
                }}>
                  {showReferralQr ? 'Hide QR code' : 'Show QR code'}
                </button>
                {showReferralQr && (
                  <div style={{ marginTop: 12, textAlign: 'center' }}>
                    <img src="/api/referrals/qr" alt="QR code for your referral link"
                      width="200" height="200"
                      style={{ background: '#fff', padding: 10, borderRadius: 10, border: '1px solid var(--border-color)' }} />
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                      Hold this up — they scan it with their camera and land on sign-up with your
                      referral already applied.
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Send referral form */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Send a Referral Invite</div>
              <div style={{ display: 'grid', gap: 8 }}>
                <input type="text" value={refName} onChange={(e) => setRefName(e.target.value)}
                  placeholder="Friend's name" style={{ padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
                <input type="email" value={refEmail} onChange={(e) => setRefEmail(e.target.value)}
                  placeholder="Email address" style={{ padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
                <input type="tel" value={refPhone} onChange={(e) => setRefPhone(e.target.value)}
                  placeholder="Phone (optional)" style={{ padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
              </div>
              {refMsg && <div style={{ fontSize: 12, color: refMsg.includes('error') || refMsg.includes('already') ? 'var(--color-error)' : 'var(--color-success)', marginTop: 6 }}>{refMsg}</div>}
              <button onClick={async () => {
                if (!refEmail.trim()) { setRefMsg('Email is required'); return; }
                setRefSending(true); setRefMsg('');
                try {
                  const res = await apiFetch('/api/referrals/send', {
                    method: 'POST',
                    body: JSON.stringify({ email: refEmail.trim(), phone: refPhone.trim() || null, name: refName.trim() || null }),
                  });
                  if (res?.ok) {
                    setRefMsg('Referral sent!');
                    setRefName(''); setRefEmail(''); setRefPhone('');
                    // Refresh referral list
                    apiFetch('/api/referrals/list').then(r => r?.ok && r.json().then(d => setReferralList(d.referrals || []))).catch(() => {});
                    apiFetch('/api/referrals/my-code').then(r => r?.ok && r.json().then(d => setReferralData(d))).catch(() => {});
                  } else {
                    const d = await res.json().catch(() => ({}));
                    setRefMsg(d.error || 'Failed to send referral');
                  }
                } catch (err) { setRefMsg('Failed to send referral'); }
                setRefSending(false);
              }} disabled={refSending} style={{
                marginTop: 10, padding: '10px 20px', background: refSending ? 'var(--border-light)' : 'var(--role-color)', color: 'var(--text-on-primary)',
                border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: refSending ? 'wait' : 'pointer',
              }}>{refSending ? 'Sending...' : 'Send Invite'}</button>
            </div>

            {/* Sent referrals list */}
            {referralList.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                  Sent Referrals ({referralList.length})
                </div>
                {referralList.slice(0, 10).map(r => (
                  <div key={r.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 10px', borderBottom: '1px solid #f0f0f0', fontSize: 13,
                  }}>
                    <div>
                      <span style={{ color: 'var(--text-primary)' }}>{r.referred_email || r.referred_phone || '—'}</span>
                      {r.claimed_first_name && <span style={{ color: 'var(--role-color)', fontWeight: 600, marginLeft: 6 }}>{r.claimed_first_name} {r.claimed_last_name}</span>}
                    </div>
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                      background: r.status === 'claimed' ? 'var(--color-success-bg)' : 'var(--color-warning-bg)',
                      color: r.status === 'claimed' ? 'var(--color-success)' : '#f57c00',
                    }}>{r.status === 'claimed' ? '\u2713 Joined' : 'Pending'}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Milestones summary */}
            {milestones.length > 0 && (
              <div style={{ marginTop: 16, padding: '12px 14px', background: 'var(--color-warning-bg)', borderRadius: 10, border: '1px solid #ffe082' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#f57c00', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Your Milestones</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {[10, 25, 50, 100, 250, 500].map(v => {
                    const achieved = milestones.find(m => m.milestone_value === v);
                    return (
                      <div key={v} style={{
                        padding: '6px 12px', borderRadius: 16, fontSize: 12, fontWeight: 600,
                        background: achieved ? 'var(--color-success)' : 'var(--bg-primary)',
                        color: achieved ? 'var(--text-on-primary)' : 'var(--text-muted)',
                        border: achieved ? 'none' : '1px solid #e0e0e0',
                      }}>{v} sessions</div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Tips & Thanks ─── */}
      {tipsData && tipsData.tips && tipsData.tips.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div onClick={() => setShowTipsSection(!showTipsSection)} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            cursor: 'pointer', padding: '14px 18px',
            background: showTipsSection ? 'linear-gradient(135deg, #FFF8E1 0%, #FFF3E0 100%)' : 'var(--bg-card)',
            border: '1px solid #FFE0B2', borderRadius: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 22 }}>{'\uD83D\uDC9B'}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-warning)' }}>Tips & Thanks</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                  ${(tipsData.totalCents / 100).toFixed(2)} from {tipsData.tips.length} {tipsData.tips.length === 1 ? 'tip' : 'tips'}
                </div>
              </div>
            </div>
            <span style={{ fontSize: 18, color: 'var(--text-muted)', transform: showTipsSection ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>{'\u25BC'}</span>
          </div>
          {showTipsSection && (
            <div style={{ background: 'var(--bg-surface)', border: '1px solid #e0e0e0', borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '14px 18px' }}>
              {tipsData.tips.slice(0, 20).map(tip => (
                <div key={tip.id} style={{ padding: '10px 0', borderBottom: '1px solid #f5f5f5', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                      <span style={{ fontWeight: 600 }}>{tip.family_name || 'A family'}</span>
                      {tip.scheduled_date && <span style={{ color: 'var(--text-muted)' }}> — {tip.scheduled_date}</span>}
                    </div>
                    {tip.reason_text && (
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontStyle: 'italic', marginTop: 3, lineHeight: 1.4 }}>
                        "{tip.reason_text}"
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-warning)', whiteSpace: 'nowrap' }}>
                    ${(tip.amount_cents / 100).toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Calendar — always rendered */}
      <div ref={calendarRef} style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>📅 Calendar</div>
        <CaregiverCalendar
          caregiverId={profile.id}
          sessions={sessions}
          availRules={availRules}
          fetchAvailability={fetchAvailability}
          earlyCheckInAllowed={profile.earlyCheckInAllowed}
          onLogVisit={(s) => {
            if (s.action === 'check-in') {
              setCheckInMood([]);
              setCheckInNotes(null);
              setCheckInLocation(null);
              setLocationError(null);
              // Request geolocation when check-in modal opens
              // Skip GPS when admin is impersonating (test mode)
              if (window.getImpersonationToken && window.getImpersonationToken()) {
                setCheckInLocation({ lat: 0, lng: 0, accuracy: 0, testMode: true });
              } else {
                // v1.105.54 — was navigator.geolocation directly, whose callbacks NEVER
                // fire in this webview (see getDeviceLocation): check-in location — the
                // evidence that a caregiver was actually at the home — has never been
                // captured on an iPhone. It sat at null with no error, which is exactly
                // why nobody noticed. Now plugin-first, and it always answers.
                getDeviceLocation({ timeoutMs: 8000 }).then(({ pos, reason, tried }) => {
                  if (pos) {
                    setCheckInLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
                  } else {
                    console.warn('Geolocation failed:', reason, tried);
                    setLocationError(reason === 'denied'
                      ? 'Location is off for InPlace — turn it on in Settings to record your arrival.'
                      : "Couldn't get your location. You can still check in.");
                  }
                });
              }
              setCheckInSession(s);
            } else if (s.action === 'check-out') {
              setCheckOutMood([]);
              setCheckOutTags([]);
              setCheckOutCareFeedback('');
              setCheckOutServiceFeedback('');
              setCheckOutSummary('');
              setCheckOutPhotos([]);
              setCheckOutPhotoUrls(prev => { prev.forEach(u => URL.revokeObjectURL(u)); return []; });
              setEarlyDepartureReason('');
              setEarlyDepartureAcked(false);
              setCheckOutLocation(null);
              // Capture GPS at check-out (skip in test mode)
              if (window.getImpersonationToken && window.getImpersonationToken()) {
                setCheckOutLocation({ lat: 0, lng: 0, accuracy: 0, testMode: true });
              } else {
                // v1.105.54 — same fix as check-in above.
                getDeviceLocation({ timeoutMs: 8000 }).then(({ pos }) => {
                  if (pos) setCheckOutLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
                });
              }
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
            background: 'var(--bg-surface)', borderRadius: '12px', padding: '24px', width: '480px', maxWidth: '90vw',
            maxHeight: '90vh', overflow: 'auto',
          }}>
            <h3 style={{ marginTop: 0 }}>Log Visit — {visitLogSession.recipientName}</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
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
                    background: logMood === m ? 'var(--bg-teal-light)' : 'var(--bg-card)', cursor: 'pointer', fontSize: '12px',
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
              <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', margin: '0 0 8px' }}>
                Share photos from the visit with the family — activities, meals, smiles!
              </p>
              <input type="file" ref={photoInputRef} accept="image/*" multiple onChange={handlePhotoSelect}
                style={{ display: 'none' }} />
              <button onClick={() => photoInputRef.current?.click()} style={{
                padding: '16px', background: logPhotos.length > 0 ? 'var(--color-success-bg)' : 'var(--bg-primary)',
                border: logPhotos.length > 0 ? '2px solid #1b6b5a' : '2px dashed #ccc', borderRadius: '10px',
                cursor: 'pointer', fontSize: '14px', color: logPhotos.length > 0 ? 'var(--role-color)' : 'var(--text-secondary)',
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
                        background: 'var(--color-error)', color: 'var(--text-on-primary)', border: 'none', borderRadius: '50%',
                        fontSize: '12px', cursor: 'pointer', lineHeight: '20px', padding: 0,
                      }}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={() => setVisitLogSession(null)} style={{
                padding: '10px 20px', border: '1px solid #ddd', background: 'var(--bg-surface)', borderRadius: '8px',
                cursor: 'pointer', fontSize: '13px',
              }}>Cancel</button>
              <button onClick={handleSubmitVisitLog} disabled={!logSummary.trim() || submittingLog} style={{
                padding: '10px 20px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none',
                borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                opacity: (!logSummary.trim() || submittingLog) ? 0.5 : 1,
              }}>{submittingLog ? 'Submitting...' : 'Submit Visit Log'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── CHECK-IN FULL-SCREEN FLOW (stepper: Briefing → Check In) ─── */}
      {checkInSession && (
        <div style={{
          position: 'fixed', inset: 0, background: 'var(--bg-surface)', zIndex: 1200,
          display: 'flex', flexDirection: 'column',
        }}>
          {/* ── STEPPER BAR ── */}
          <div style={{
            display: 'flex', alignItems: 'center', padding: '14px 20px',
            background: 'var(--bg-primary)', borderBottom: '1px solid var(--border-light)',
          }}>
            {[
              { key: 'briefing', label: 'Briefing', num: 1 },
              ...(firstVisitNeeded ? [{ key: 'first-visit', label: 'Confirm', num: 2 }] : []),
              { key: 'checkin', label: 'Check In', num: firstVisitNeeded ? 3 : 2 },
            ].map((step, i, arr) => {
              const steps = ['briefing', ...(firstVisitNeeded ? ['first-visit'] : []), 'checkin'];
              const currentIdx = steps.indexOf(checkInStep);
              const stepIdx = steps.indexOf(step.key);
              const isDone = stepIdx < currentIdx;
              const isActive = stepIdx === currentIdx;
              return React.createElement(React.Fragment, { key: step.key },
                React.createElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center' } },
                  React.createElement('div', { style: {
                    width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 700, transition: 'all 0.3s',
                    background: isDone ? 'var(--color-success)' : isActive ? 'var(--role-color)' : 'var(--bg-primary)',
                    color: isDone || isActive ? 'var(--text-on-primary)' : 'var(--text-muted)',
                    border: isDone ? 'none' : isActive ? 'none' : '2px solid var(--border-light)',
                    boxShadow: isActive ? '0 0 10px rgba(27,107,90,0.3)' : 'none',
                  }}, isDone ? '✓' : step.num),
                  React.createElement('div', { style: {
                    fontSize: 9, marginTop: 3, fontWeight: isActive ? 700 : 500,
                    color: isDone ? 'var(--color-success)' : isActive ? 'var(--role-color)' : 'var(--text-muted)',
                  }}, step.label)
                ),
                i < arr.length - 1 ? React.createElement('div', { style: {
                  flex: 1, height: 2, margin: '0 8px', marginBottom: 14,
                  background: isDone ? 'var(--color-success)' : 'var(--border-light)',
                }}) : null
              );
            })}
            <div style={{ flex: 1 }}></div>
            <button onClick={() => setExitWarningOpen(true)} style={{
              background: 'var(--bg-primary)', border: '1px solid var(--border-light)', borderRadius: '50%',
              width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, marginBottom: 14,
            }}>✕</button>
          </div>

          {/* ── Step content area ── */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px', maxWidth: 520, width: '100%', margin: '0 auto' }}>

            {/* ── STEP 1: Care Briefing ── */}
            {checkInStep === 'briefing' && (() => {
              const recipName = (checkInSession.recipientName || checkInSession.recipient_name || '').split(' ')[0] || 'the care recipient';
              const bd = briefingData;
              return React.createElement('div', null,
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 } },
                  React.createElement('div', { style: {
                    background: 'linear-gradient(135deg, #1b6b5a, #2a9d8f)', borderRadius: 10, padding: '8px 12px',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }},
                    React.createElement('span', { style: { fontSize: 16 }, dangerouslySetInnerHTML: { __html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--bg-surface)" stroke-width="2"><path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M4.5 16.5c0-3 2.5-4.5 7.5-4.5s7.5 1.5 7.5 4.5"/><circle cx="12" cy="17" r="4"/><path d="M12 15v4m-2-2h4"/></svg>' } }),
                    React.createElement('span', { style: { color: 'var(--text-on-primary)', fontSize: 13, fontWeight: 700, letterSpacing: 0.5 } }, 'AI Care Briefing')
                  ),
                  React.createElement('div', { style: { flex: 1 } }),
                  React.createElement('button', {
                    onClick: () => setExitWarningOpen(true),
                    style: { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }
                  }, '×')
                ),

                React.createElement('h3', { style: { margin: '0 0 4px 0', fontSize: 20 } },
                  bd?.recipientName || recipName
                ),
                React.createElement('p', { style: { fontSize: 13, color: 'var(--text-tertiary)', margin: '0 0 16px 0' } },
                  (() => {
                    // scheduled_date/scheduled_time are naive care-location values — format
                    // them directly ("Jul 12 at 9:59 PM"), never re-parse through device time.
                    const rawD = ((checkInSession.date || checkInSession.scheduled_date || '') + '').split('T')[0];
                    const rawT = (checkInSession.time || checkInSession.scheduled_time || '') + '';
                    const dObj = rawD ? TimezoneHelper.parseDate(rawD) : null;
                    const dLabel = dObj && !isNaN(dObj.getTime()) ? dObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : rawD;
                    const tLabel = rawT ? (/[AaPp][Mm]/.test(rawT) ? rawT : TimezoneHelper.formatTime(rawT)) : '';
                    const when = dLabel + (tLabel ? ' at ' + tLabel : '');
                    return [bd?.sessionServiceType, when].filter(Boolean).join(' · ');
                  })()
                ),

                briefingLoading
                  ? React.createElement('div', { style: { textAlign: 'center', padding: '30px 0', color: 'var(--text-tertiary)' } },
                      React.createElement('div', { style: { fontSize: 14 } }, 'Loading care briefing...'))
                  : React.createElement('div', null,
                      // ── Experience-aware narrative ──
                      bd?.isExperienced
                        ? React.createElement('div', { style: {
                            padding: 14, background: 'var(--bg-highlight)', borderRadius: 10, border: '1px solid #d4edda', marginBottom: 14,
                          }},
                            React.createElement('div', { style: { fontSize: 13, color: 'var(--role-color)', fontWeight: 600, marginBottom: 6 } },
                              'You\'ve visited ' + (bd?.recipientName || recipName) + ' ' + (bd?.visitCount || 'several') + ' times'),
                            bd?.caregiverBriefing
                              ? React.createElement('div', { style: { fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.55, whiteSpace: 'pre-line' } }, bd.caregiverBriefing)
                              : React.createElement('div', { style: { fontSize: 13, color: 'var(--text-secondary)', fontStyle: 'italic' } }, 'No care briefing has been set by the care team yet.')
                          )
                        : React.createElement('div', null,
                            // New caregiver — full briefing
                            React.createElement('div', { style: {
                              padding: 14, background: 'var(--bg-warm)', borderRadius: 10, border: '1px solid #ffe0c0', marginBottom: 14,
                            }},
                              React.createElement('div', { style: { fontSize: 12, fontWeight: 700, color: 'var(--accent-color)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 } },
                                'First visit — please review carefully'),
                              bd?.caregiverBriefing
                                ? React.createElement('div', { style: { fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.55, whiteSpace: 'pre-line' } }, bd.caregiverBriefing)
                                : React.createElement('div', { style: { fontSize: 13, color: 'var(--text-secondary)', fontStyle: 'italic' } }, 'No care briefing has been set by the care team yet.'),
                              bd?.healthConditions && bd.healthConditions.length > 0
                                ? React.createElement('div', { style: { marginTop: 10 } },
                                    React.createElement('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--color-error)', marginBottom: 4 } }, 'Health conditions:'),
                                    bd.healthConditions.map((c, i) =>
                                      React.createElement('div', { key: i, style: { fontSize: 12, color: 'var(--text-secondary)', paddingLeft: 10, marginBottom: 2 } }, '• ' + c)
                                    )
                                  )
                                : null,
                              bd?.medications && bd.medications.length > 0
                                ? React.createElement('div', { style: { marginTop: 8 } },
                                    React.createElement('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--color-info)', marginBottom: 4 } }, 'Current medications:'),
                                    bd.medications.map((m, i) =>
                                      React.createElement('div', { key: i, style: { fontSize: 12, color: 'var(--text-secondary)', paddingLeft: 10, marginBottom: 2 } }, '• ' + m)
                                    )
                                  )
                                : null,
                              bd?.foodAllergies
                                ? React.createElement('div', { style: { marginTop: 8, fontSize: 12 } },
                                    React.createElement('span', { style: { fontWeight: 600, color: 'var(--color-warning)' } }, 'Food allergies: '),
                                    React.createElement('span', { style: { color: 'var(--text-secondary)' } }, bd.foodAllergies)
                                  )
                                : null
                            )
                          ),

                      // ── Special instructions for this session ──
                      (checkInSession.special_instructions || checkInSession.specialInstructions)
                        ? React.createElement('div', { style: {
                            padding: 12, background: 'var(--bg-highlight)', borderRadius: 8, border: '1px solid #d4edda', marginBottom: 14,
                          }},
                            React.createElement('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--role-color)', marginBottom: 4 } }, 'Today\'s instructions'),
                            React.createElement('div', { style: { fontSize: 13, color: 'var(--text-primary)' } }, checkInSession.special_instructions || checkInSession.specialInstructions)
                          )
                        : null,

                      // ── iPAi synthesis (or fallback to raw notes) ──
                      bd?.notesSynthesis
                        ? React.createElement('div', { style: {
                            padding: 14, background: 'linear-gradient(135deg, #f0f7f5, #e8f4f0)', borderRadius: 10,
                            border: '1px solid #b2dfdb', marginBottom: 14,
                          }},
                            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 } },
                              React.createElement('span', { style: { fontSize: 14 } }, '\u{1F9E0}'),
                              React.createElement('span', { style: { fontSize: 12, fontWeight: 700, color: 'var(--role-color)', textTransform: 'uppercase', letterSpacing: 0.5 } }, 'What to know today')
                            ),
                            React.createElement('div', { style: { fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.6 } }, bd.notesSynthesis)
                          )
                        : (bd?.recentNotes && bd.recentNotes.length > 0)
                          ? React.createElement('div', { style: {
                              padding: 12, background: '#f8f4ff', borderRadius: 8, border: '1px solid #e8daff', marginBottom: 14,
                            }},
                              React.createElement('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--color-purple)', marginBottom: 8 } }, 'Recent Care Notes'),
                              bd.recentNotes.map((n, i) =>
                                React.createElement('div', { key: i, style: {
                                  fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5,
                                  padding: '8px 0', borderBottom: i < bd.recentNotes.length - 1 ? '1px solid #f0e8ff' : 'none',
                                }},
                                  React.createElement('div', { style: { fontSize: 10, color: 'var(--text-muted)', marginBottom: 3, fontWeight: 600 } },
                                    n.createdAt ? TimezoneHelper.formatTimestamp(n.createdAt, checkInSession.timezone, { month: 'short', day: 'numeric' }) : ''
                                  ),
                                  n.content
                                )
                              )
                            )
                          : null,

                    )
              );
            })()}

            {/* ── STEP 1.5: First-Visit Confirmation (conditional) ── */}
            {checkInStep === 'first-visit' && React.createElement('div', null,
              React.createElement('div', { style: { textAlign: 'center', marginBottom: 20 } },
                React.createElement('div', { style: { fontSize: 40, marginBottom: 8 } }, '\u{1F44B}'),
                React.createElement('h3', { style: { marginTop: 0, marginBottom: 4, fontSize: 20 } }, 'First Visit Confirmation'),
                React.createElement('p', { style: { fontSize: 13, color: 'var(--text-secondary)', margin: 0 } },
                  'This is your first session with ' + firstVisitName + '. Please confirm their awareness.')
              ),

              React.createElement('div', { style: { padding: 16, background: 'var(--color-warning-bg)', borderRadius: 10, border: '2px solid #e8724a', marginBottom: 16 } },
                React.createElement('div', { style: { fontSize: 14, fontWeight: 700, marginBottom: 12, color: 'var(--color-warning)' } },
                  'Is ' + firstVisitName.split(' ')[0] + ' aware that you\'re here to provide care today?'),
                [
                  { key: 'yes', label: 'Yes, they acknowledged me', emoji: '\u2705' },
                  { key: 'no', label: 'They seem unaware of my visit', emoji: '\u26A0\uFE0F' },
                  { key: 'unable', label: 'Unable to assess their awareness', emoji: '\u2753' },
                ].map(opt =>
                  React.createElement('label', {
                    key: opt.key,
                    style: {
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', marginBottom: 6,
                      borderRadius: 8, cursor: 'pointer',
                      background: firstVisitChoice === opt.key ? 'var(--color-warning-bg)' : 'var(--bg-card)',
                      border: firstVisitChoice === opt.key ? '2px solid #e8724a' : '2px solid #eee',
                    }
                  },
                    React.createElement('input', {
                      type: 'radio', name: 'firstVisitChoice', value: opt.key,
                      checked: firstVisitChoice === opt.key,
                      onChange: () => setFirstVisitChoice(opt.key),
                      style: { accentColor: 'var(--accent-color)' }
                    }),
                    React.createElement('span', { style: { fontSize: 16 } }, opt.emoji),
                    React.createElement('span', { style: { fontSize: 13, fontWeight: firstVisitChoice === opt.key ? 700 : 400 } }, opt.label)
                  )
                ),

                (firstVisitChoice === 'no' || firstVisitChoice === 'unable') && React.createElement('div', { style: { marginTop: 12 } },
                  React.createElement('label', { style: { display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)' } }, 'Notes (optional — will be shared with the family):'),
                  React.createElement('textarea', {
                    value: firstVisitNotes, onChange: e => setFirstVisitNotes(e.target.value),
                    placeholder: 'Describe what you observed...',
                    style: { width: '100%', minHeight: 70, padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }
                  })
                )
              ),

              React.createElement('div', { style: { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 } },
                React.createElement('button', {
                  onClick: () => setCheckInStep('briefing'),
                  style: { padding: '10px 20px', border: '1px solid #ddd', background: 'var(--bg-surface)', borderRadius: 8, cursor: 'pointer', fontSize: 13 }
                }, '\u2190 Back'),
                React.createElement('button', {
                  onClick: async () => {
                    if (!firstVisitChoice) return;
                    setFirstVisitSubmitting(true);
                    try {
                      await apiFetch('/api/sessions/' + checkInSession.id + '/first-visit-confirm', {
                        method: 'POST',
                        body: JSON.stringify({ confirmation: firstVisitChoice, notes: firstVisitNotes || null }),
                      });
                    } catch (e) { console.error('First-visit confirm error:', e); }
                    setFirstVisitSubmitting(false);
                    setCheckInStep('checkin');
                  },
                  disabled: !firstVisitChoice || firstVisitSubmitting,
                  style: {
                    padding: '10px 24px', background: firstVisitChoice ? 'var(--role-color)' : 'var(--border-light)', color: 'var(--text-on-primary)', border: 'none',
                    borderRadius: 8, cursor: firstVisitChoice ? 'pointer' : 'not-allowed', fontSize: 14, fontWeight: 700,
                  }
                }, firstVisitSubmitting ? 'Submitting...' : 'Continue to Check In \u2192')
              )
            )}

            {/* ── STEP 2: Check In (mood, location, confirm) ── */}
            {checkInStep === 'checkin' && React.createElement('div', null,
              React.createElement('div', { style: { textAlign: 'center', marginBottom: 20 } },
                React.createElement('h3', { style: { marginTop: 0, marginBottom: 4, fontSize: 22 } }, 'Almost there!'),
                React.createElement('p', { style: { fontSize: 13, color: 'var(--text-secondary)', margin: 0 } },
                  'How is ' + ((checkInSession.recipientName || checkInSession.recipient_name || '').split(' ')[0] || 'the care recipient') + ' right now?'
                )
              ),

              React.createElement('div', { style: { marginBottom: 20 } },
                React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 } },
                  [
                    { key: 'happy', emoji: '😊', label: 'Happy' },
                    { key: 'surprised', emoji: '😮', label: 'Surprised' },
                    { key: 'sleepy', emoji: '😴', label: 'Sleepy' },
                    { key: 'busy', emoji: '🤗', label: 'Busy' },
                    { key: 'neutral', emoji: '😐', label: 'Neutral' },
                    { key: 'sad', emoji: '😢', label: 'Sad' },
                    { key: 'upset', emoji: '😠', label: 'Upset' },
                    { key: 'warm', emoji: '🥰', label: 'Warm' },
                  ].map(m =>
                    React.createElement('button', {
                      key: m.key, onClick: () => setCheckInMood(prev => prev.includes(m.key) ? prev.filter(k => k !== m.key) : [...prev, m.key]),
                      style: {
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                        padding: '14px 8px', borderRadius: 12,
                        border: checkInMood.includes(m.key) ? '2px solid var(--color-success)' : '2px solid var(--border-light)',
                        background: checkInMood.includes(m.key) ? 'var(--color-success-bg)' : 'var(--bg-primary)',
                        cursor: 'pointer', transition: 'all 0.15s',
                      }
                    },
                      React.createElement('span', { style: { fontSize: 28 } }, m.emoji),
                      React.createElement('span', { style: { fontSize: 10, fontWeight: 500, color: checkInMood.includes(m.key) ? 'var(--color-success)' : 'var(--text-muted)' } }, m.label)
                    )
                  )
                )
              ),

              checkInLocation
                ? React.createElement('div', { style: { marginBottom: 16, padding: 12, background: 'var(--color-success-bg)', borderRadius: 10, border: '1px solid var(--color-success)', fontSize: 13, color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: 8 } },
                    React.createElement('span', { style: { fontSize: 16 } }, '📍'), 'Location captured · ' + Math.round(checkInLocation.accuracy || 0) + 'm accuracy')
                : null,
              locationError && !checkInLocation
                ? React.createElement('div', { style: { marginBottom: 16, padding: 12, background: 'var(--color-warning-bg)', borderRadius: 10, border: '1px solid var(--color-warning)', fontSize: 13, color: 'var(--color-warning)', display: 'flex', alignItems: 'center', gap: 8 } },
                    React.createElement('span', { style: { fontSize: 16 } }, '⚠️'), 'Location unavailable — you can still check in')
                : null,

              // Back link
              React.createElement('button', {
                onClick: () => setCheckInStep(firstVisitNeeded ? 'first-visit' : 'briefing'),
                style: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)', padding: '8px 0', marginBottom: 8 }
              }, '\u2190 Back to briefing'),
            )}

          </div>{/* end step content area */}

          {/* ── PINNED BRIEFING FOOTER (acknowledge + continue) ── */}
          {checkInStep === 'briefing' && React.createElement('div', {
            style: {
              flexShrink: 0,
              padding: '12px 16px', paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
              background: 'var(--bg-surface)',
              borderTop: '1px solid var(--border-light)',
              maxWidth: 520, width: '100%', margin: '0 auto',
              boxSizing: 'border-box',
            }
          },
            React.createElement('label', {
              style: {
                display: 'flex', alignItems: 'flex-start', gap: 10, padding: 12,
                background: briefingAcked ? 'var(--color-success-bg)' : 'var(--bg-primary)', borderRadius: 10,
                border: briefingAcked ? '2px solid #4caf50' : '2px solid #ddd', cursor: 'pointer',
                transition: 'all 0.2s', marginBottom: 12,
              }
            },
              React.createElement('input', {
                type: 'checkbox', checked: briefingAcked,
                onChange: (e) => setBriefingAcked(e.target.checked),
                style: { marginTop: 2, width: 18, height: 18, accentColor: 'var(--role-color)' }
              }),
              React.createElement('span', { style: { fontSize: 13, fontWeight: 600, color: briefingAcked ? 'var(--color-success)' : 'var(--text-secondary)' } },
                'I\'ve reviewed this care briefing')
            ),
            React.createElement('button', {
              onClick: async () => {
                if (!briefingAcked) {
                  setContinueShaking(true);
                  setContinueHintVisible(true);
                  setTimeout(() => setContinueShaking(false), 400);
                  return;
                }
                setContinueHintVisible(false);
                try {
                  const fvRes = await apiFetch('/api/sessions/' + checkInSession.id + '/first-visit-check');
                  if (fvRes?.ok) {
                    const fvData = await fvRes.json();
                    if (fvData.needsConfirmation) {
                      setFirstVisitNeeded(true);
                      setFirstVisitName(fvData.recipientName || 'the care recipient');
                      setFirstVisitChoice('');
                      setFirstVisitNotes('');
                      setCheckInStep('first-visit');
                      return;
                    }
                  }
                } catch (e) { console.error('First-visit check failed:', e); }
                setCheckInStep('checkin');
              },
              style: {
                width: '100%', padding: '16px', borderRadius: 14,
                fontSize: 16, fontWeight: 700, cursor: 'pointer',
                background: briefingAcked
                  ? 'linear-gradient(135deg, var(--role-color), var(--color-success))'
                  : 'var(--bg-primary)',
                color: briefingAcked ? 'var(--text-on-primary)' : 'var(--text-muted)',
                transition: 'all 0.2s',
                animation: continueShaking ? 'checkInShake 0.4s ease-in-out' : 'none',
                border: briefingAcked ? 'none' : '1px solid var(--border-light)',
              }
            }, briefingAcked ? 'Continue to Check In →' : 'Continue to Check In →'),
            continueHintVisible && !briefingAcked
              ? React.createElement('div', { style: {
                  textAlign: 'center', fontSize: 13, color: 'var(--color-warning)', marginTop: 8,
                  fontWeight: 500, animation: 'fadeIn 0.3s ease',
                }}, '☝️ Please acknowledge the care briefing first')
              : null
          )}

          {/* ── PINNED CHECK-IN BUTTON (always visible at bottom) ── */}
          {checkInStep === 'checkin' && React.createElement('div', {
            style: {
              flexShrink: 0,
              padding: '16px 16px', paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
              background: 'var(--bg-surface)',
              borderTop: '1px solid var(--border-light)',
              maxWidth: 520, width: '100%', margin: '0 auto',
              boxSizing: 'border-box',
            }
          },
            React.createElement('button', {
              onClick: async () => {
                setCheckSubmitting(true);
                setIncompleteCheckIn(null);
                const checkInData = {
                  arrivalMood: checkInMood.length > 0 ? checkInMood : null,
                  checkInLatitude: checkInLocation?.lat || null,
                  checkInLongitude: checkInLocation?.lng || null,
                  briefingAcknowledged: true,
                };
                try {
                  const res = await apiFetch('/api/sessions/' + checkInSession.id + '/check-in', {
                    method: 'POST',
                    body: JSON.stringify(checkInData),
                  });
                  if (res?.ok) {
                    await res.json();
                    showToast('Checked in! Session started.', 'success');
                    setCheckInSession(null);
                    setIncompleteCheckIn(null);
                    if (incompleteTimerRef.current) { clearTimeout(incompleteTimerRef.current); incompleteTimerRef.current = null; }
                    try {
                      const refreshRes = await apiFetch('/api/dashboard');
                      if (refreshRes?.ok) setData(await refreshRes.json());
                    } catch (e) { /* refresh is best-effort */ }
                  } else if (res?.status === 503 || !navigator.onLine) {
                    if (window.OfflineQueue) {
                      await window.OfflineQueue.queueCheckIn(checkInSession.id, checkInData);
                      showToast('Saved offline — will sync when you reconnect', 'success');
                      setCheckInSession(null);
                      setIncompleteCheckIn(null);
                    } else {
                      showToast('You\'re offline — please try again when connected', 'error');
                    }
                  } else if (res?.status === 402) {
                    const err = await res?.json().catch(() => null);
                    showToast(err?.code === 'FAMILY_UNPAID'
                      ? 'Check-in blocked — the family has an unpaid balance. They\'ve been notified.'
                      : (err?.message || 'Check-in blocked — payment issue'), 'error');
                    setCheckInSession(null);
                  } else {
                    const err = await res?.json().catch(() => null);
                    showToast(err?.message || err?.error || 'Check-in failed', 'error');
                  }
                } catch (e) {
                  if (window.OfflineQueue) {
                    try {
                      await window.OfflineQueue.queueCheckIn(checkInSession.id, checkInData);
                      showToast('Saved offline — will sync when you reconnect', 'success');
                      setCheckInSession(null);
                      setIncompleteCheckIn(null);
                    } catch { showToast('Check-in failed — could not save offline', 'error'); }
                  } else {
                    showToast('Check-in failed — no connection', 'error');
                  }
                }
                setCheckSubmitting(false);
              },
              disabled: checkSubmitting,
              style: {
                width: '100%', padding: 22, border: 'none', borderRadius: 16,
                fontSize: 20, fontWeight: 800, cursor: 'pointer', letterSpacing: 0.5,
                background: 'linear-gradient(135deg, var(--color-success), #16a34a)',
                color: '#fff', boxShadow: '0 6px 24px rgba(34, 197, 94, 0.4)',
                transition: 'all 0.15s',
                opacity: checkSubmitting ? 0.6 : 1,
              }
            }, checkSubmitting ? 'Checking in...' : "I'm Here \u2713"),
            React.createElement('p', { style: { textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', marginTop: 8 } },
              'This will start your session timer')
          )}

          {/* ── EXIT WARNING OVERLAY ── */}
          {exitWarningOpen && React.createElement('div', {
            style: {
              position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 10, padding: 24,
            }
          },
            React.createElement('div', {
              style: {
                background: 'var(--bg-surface)', borderRadius: 20, padding: '28px 24px',
                textAlign: 'center', maxWidth: 360, width: '100%',
                border: '1px solid var(--border-light)', boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
              }
            },
              React.createElement('div', { style: { fontSize: 48, marginBottom: 12 } }, '⚠️'),
              React.createElement('h3', { style: { fontSize: 18, fontWeight: 700, marginBottom: 8 } }, "You Haven't Checked In Yet"),
              React.createElement('p', { style: { fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 20 } },
                'If you leave now, you won\'t be checked in and may be flagged as a no-show after 30 minutes.'),
              React.createElement('div', { style: { display: 'flex', gap: 10 } },
                React.createElement('button', {
                  onClick: () => {
                    setExitWarningOpen(false);
                    // Track incomplete check-in so banner shows on dashboard
                    setIncompleteCheckIn({
                      sessionId: checkInSession.id,
                      session: checkInSession,
                      startedAt: Date.now(),
                    });
                    setCheckInSession(null);
                  },
                  style: {
                    flex: 1, padding: 14, borderRadius: 12, fontSize: 14, fontWeight: 700,
                    cursor: 'pointer', border: '1px solid var(--border-light)',
                    background: 'var(--bg-primary)', color: 'var(--text-muted)',
                  }
                }, 'Leave Anyway'),
                React.createElement('button', {
                  onClick: () => setExitWarningOpen(false),
                  style: {
                    flex: 1, padding: 14, borderRadius: 12, fontSize: 14, fontWeight: 700,
                    cursor: 'pointer', border: 'none',
                    background: 'var(--color-success-fill)', color: 'var(--text-on-primary)',
                  }
                }, 'Finish Check-In')
              )
            )
          )}
        </div>
      )}

      {/* ─── CHECK-OUT MODAL ─── */}
      {checkOutSession && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: 'var(--bg-surface)', borderRadius: '16px', padding: '28px', width: '500px', maxWidth: '92vw',
            maxHeight: '85vh', overflow: 'auto',
          }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>👋</div>
              <h3 style={{ marginTop: 0, marginBottom: 4, fontSize: 20 }}>Check Out</h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
                {checkOutSession.recipientName || checkOutSession.recipient_name || 'Care Session'} &bull; {checkOutSession.date || checkOutSession.scheduled_date}
              </p>
            </div>

            {draftRestored && (
              <div style={{
                background: 'var(--color-success-bg)', border: '1px solid var(--color-success)',
                borderRadius: 8, padding: '8px 12px', marginBottom: 16, fontSize: 12,
                color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ fontSize: 14 }}>💾</span>
                <span>Draft restored — picking up where you left off. Your notes were saved automatically.</span>
              </div>
            )}

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                How is {(checkOutSession.recipientName || checkOutSession.recipient_name || '').split(' ')[0] || 'the care recipient'} now? (tap all that apply)
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
                  <button key={m.key} onClick={() => setCheckOutMood(prev => prev.includes(m.key) ? prev.filter(k => k !== m.key) : [...prev, m.key])} style={{
                    padding: '8px 14px', borderRadius: 20, border: checkOutMood.includes(m.key) ? '2px solid #c62828' : '2px solid #eee',
                    background: checkOutMood.includes(m.key) ? 'var(--color-error-bg)' : 'var(--bg-primary)', cursor: 'pointer', fontSize: 13,
                    fontWeight: checkOutMood.includes(m.key) ? 700 : 400, display: 'flex', alignItems: 'center', gap: 6,
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
                      border: isSelected ? `2px solid ${isPositive ? 'var(--color-success)' : 'var(--color-error)'}` : '1px solid #ddd',
                      background: isSelected ? (isPositive ? 'var(--color-success-bg)' : 'var(--color-error-bg)') : 'var(--bg-card)',
                      color: isSelected ? (isPositive ? 'var(--color-success)' : 'var(--color-error)') : 'var(--text-secondary)',
                      cursor: 'pointer', fontWeight: isSelected ? 600 : 400,
                    }}>{tag}</button>
                  );
                })}
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                {'\u{1F4DD}'} Care Notes
              </label>
              <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '0 0 8px' }}>
                How was the visit? This will be saved as a care note for the family to see.
              </p>
              <textarea value={checkOutSummary} onChange={e => setCheckOutSummary(e.target.value)}
                placeholder="e.g. Betty was in good spirits today. We did a puzzle together and she ate a full lunch. She mentioned some hip pain when standing."
                style={{ width: '100%', minHeight: 80, padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
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

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                📸 Visit Photos (optional, up to 5)
              </label>
              <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '0 0 8px' }}>
                Share photos from the visit — activities, meals, smiles!
              </p>
              <input type="file" ref={checkOutPhotoRef} accept="image/*" multiple onChange={handleCheckOutPhotoSelect}
                style={{ display: 'none' }} />
              <button onClick={() => checkOutPhotoRef.current?.click()} style={{
                padding: 14, background: checkOutPhotos.length > 0 ? 'var(--color-success-bg)' : 'var(--bg-primary)',
                border: checkOutPhotos.length > 0 ? '2px solid #1b6b5a' : '2px dashed #ccc', borderRadius: 10,
                cursor: 'pointer', fontSize: 13, color: checkOutPhotos.length > 0 ? 'var(--role-color)' : 'var(--text-secondary)',
                width: '100%', fontWeight: checkOutPhotos.length > 0 ? 600 : 400,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxSizing: 'border-box',
              }}>
                <span style={{ fontSize: 18 }}>{checkOutPhotos.length > 0 ? '✅' : '📷'}</span>
                {checkOutPhotos.length > 0 ? `${checkOutPhotos.length} photo${checkOutPhotos.length > 1 ? 's' : ''} selected` : 'Tap to add visit photos'}
              </button>
              {checkOutPhotoUrls.length > 0 && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  {checkOutPhotoUrls.map((url, idx) => (
                    <div key={idx} style={{ position: 'relative', width: 64, height: 64 }}>
                      <img src={url} alt={`Photo ${idx + 1}`} style={{
                        width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid #ddd',
                      }} />
                      <button onClick={() => removeCheckOutPhoto(idx)} style={{
                        position: 'absolute', top: -6, right: -6, width: 20, height: 20,
                        background: 'var(--color-error)', color: 'var(--text-on-primary)', border: 'none', borderRadius: '50%',
                        fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ─── EARLY DEPARTURE WARNING ─── */}
            {(() => {
              if (!checkOutSession) return null;
              const sDate = checkOutSession.date || checkOutSession.scheduled_date;
              const sTime = checkOutSession.time || checkOutSession.scheduled_time;
              const sDur = parseFloat(checkOutSession.durationHours || checkOutSession.duration_hours || 0);
              if (!sDate || !sTime || !sDur) return null;
              const [hh, mm] = sTime.split(':').map(Number);
              // Use care recipient's timezone for comparison (not browser local TZ)
              const careTz = checkOutSession.timezone || 'America/New_York';
              const nowCare = new Date(new Date().toLocaleString('en-US', { timeZone: careTz }));
              const schedEnd = new Date(nowCare);
              const [sy, smo, sd] = sDate.split('-').map(Number);
              schedEnd.setFullYear(sy, smo - 1, sd);
              schedEnd.setHours(hh, mm, 0, 0);
              schedEnd.setMinutes(schedEnd.getMinutes() + Math.round(sDur * 60));
              const minsEarly = Math.max(0, (schedEnd - nowCare) / 60000);
              if (minsEarly <= 15) return null;
              // schedEnd's .getHours() already represents care-TZ wall clock, so format directly
              const endH = schedEnd.getHours();
              const endM = schedEnd.getMinutes();
              const endTimeStr = `${endH % 12 || 12}:${String(endM).padStart(2, '0')} ${endH >= 12 ? 'PM' : 'AM'}`;
              // Calculate pay impact
              const totalMins = sDur * 60;
              const actualMins = totalMins - minsEarly;
              const roundedMins = Math.ceil(actualMins / 5) * 5;
              const payPercent = Math.round((roundedMins / totalMins) * 100);
              return React.createElement('div', { style: {
                background: 'var(--color-warning-bg)', border: '2px solid #e8724a', borderRadius: 12,
                padding: 16, marginBottom: 16,
              }},
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } },
                  React.createElement('span', { style: { fontSize: 20 } }, '⚠️'),
                  React.createElement('strong', { style: { fontSize: 14, color: 'var(--color-error)' } }, 'Early Checkout')
                ),
                React.createElement('p', { style: { fontSize: 13, color: 'var(--text-primary)', margin: '0 0 8px', lineHeight: 1.5 } },
                  `This appointment is scheduled until ${endTimeStr}. You are checking out ${Math.round(minsEarly)} minutes early.`
                ),
                React.createElement('p', { style: { fontSize: 13, color: 'var(--color-error)', fontWeight: 600, margin: '0 0 12px' } },
                  `Pay is calculated in 5-minute blocks — you'll receive ${payPercent}% of the session pay.`
                ),
                React.createElement('label', { style: { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--text-primary)' } },
                  'Please let us and the family know why you\'re leaving early: *'
                ),
                React.createElement('textarea', {
                  value: earlyDepartureReason,
                  onChange: e => { setEarlyDepartureReason(e.target.value); if (e.target.value.trim()) setEarlyDepartureAcked(true); },
                  placeholder: 'e.g., Family emergency, care recipient asked me to leave, appointment was rescheduled...',
                  style: { width: '100%', minHeight: 60, padding: 10, borderRadius: 8, border: '1px solid #e8724a', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' },
                })
              );
            })()}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={() => setCheckOutSession(null)} style={{
                padding: '10px 20px', border: '1px solid #ddd', background: 'var(--bg-surface)', borderRadius: 8,
                cursor: 'pointer', fontSize: 13,
              }}>Cancel</button>
              <button onClick={async () => {
                // Check if early departure requires a reason
                const sDate2 = checkOutSession.date || checkOutSession.scheduled_date;
                const sTime2 = checkOutSession.time || checkOutSession.scheduled_time;
                const sDur2 = parseFloat(checkOutSession.durationHours || checkOutSession.duration_hours || 0);
                if (sDate2 && sTime2 && sDur2) {
                  const [hh2, mm2] = sTime2.split(':').map(Number);
                  // Use care recipient's timezone (same as warning display)
                  const careTz2 = checkOutSession.timezone || 'America/New_York';
                  const nowCare2 = new Date(new Date().toLocaleString('en-US', { timeZone: careTz2 }));
                  const schedEnd2 = new Date(nowCare2);
                  const [sy2, smo2, sd2] = sDate2.split('-').map(Number);
                  schedEnd2.setFullYear(sy2, smo2 - 1, sd2);
                  schedEnd2.setHours(hh2, mm2, 0, 0);
                  schedEnd2.setMinutes(schedEnd2.getMinutes() + Math.round(sDur2 * 60));
                  const minsEarly2 = Math.max(0, (schedEnd2 - nowCare2) / 60000);
                  if (minsEarly2 > 15 && !earlyDepartureReason.trim()) {
                    showToast('Please provide a reason for leaving early', 'error');
                    return;
                  }
                }
                setCheckSubmitting(true);
                const checkOutPayload = {
                  departureMood: checkOutMood.length > 0 ? checkOutMood : null,
                  conditionTags: checkOutTags.length > 0 ? checkOutTags : null,
                  careFeedback: checkOutCareFeedback.trim() || null,
                  serviceFeedback: checkOutServiceFeedback.trim() || null,
                  summary: checkOutSummary.trim() || null,
                  earlyDepartureReason: earlyDepartureReason.trim() || null,
                  checkOutLatitude: checkOutLocation?.lat || null,
                  checkOutLongitude: checkOutLocation?.lng || null,
                };
                try {
                  // Add 30-second timeout to prevent infinite hang
                  const controller = new AbortController();
                  const timeout = setTimeout(() => controller.abort(), 30000);
                  const res = await apiFetch('/api/sessions/' + checkOutSession.id + '/check-out', {
                    method: 'POST',
                    signal: controller.signal,
                    body: JSON.stringify(checkOutPayload),
                  });
                  clearTimeout(timeout);
                  if (!res) {
                    showToast('Session expired — please sign in again', 'error');
                  } else if (res.ok) {
                    const checkOutData = await res.json();
                    // Upload photos if any
                    if (checkOutPhotos.length > 0 && checkOutData.visitLog?.id) {
                      try {
                        const formData = new FormData();
                        checkOutPhotos.forEach(f => formData.append('photos', f));
                        const __csrf = typeof getCsrfToken === 'function' ? getCsrfToken() : (window.getCsrfToken ? window.getCsrfToken() : null);
                        const photoHeaders = {};
                        if (__csrf) photoHeaders['X-CSRF-Token'] = __csrf;
                        const photoRes = await fetch(`${API_BASE}/api/photos/visit/${checkOutData.visitLog.id}`, {
                          method: 'POST',
                          credentials: 'same-origin',
                          headers: photoHeaders,
                          body: formData,
                        });
                        if (!photoRes.ok) {
                          console.warn('Photo upload failed:', photoRes.status);
                          showToast('Photos could not be saved — please try again', 'error');
                        }
                      } catch (photoErr) { console.warn('Photo upload failed:', photoErr); showToast('Photos could not be uploaded', 'error'); }
                    }
                    checkOutPhotoUrls.forEach(u => URL.revokeObjectURL(u));
                    setCheckOutPhotos([]);
                    setCheckOutPhotoUrls([]);
                    setCheckOutSummary('');
                    setEarlyDepartureReason('');
                    setEarlyDepartureAcked(false);
                    // Submission succeeded — drop the saved draft so it doesn't
                    // resurface on next check-out of an unrelated session.
                    clearCheckOutDraft(checkOutSession.id);
                    showToast('Checked out! Session complete.', 'success');
                    setCheckOutSession(null);
                    const refreshRes = await apiFetch('/api/dashboard');
                    if (refreshRes?.ok) setData(await refreshRes.json());
                  } else if (res?.status === 503 || !navigator.onLine) {
                    // Offline — queue for later sync
                    if (window.OfflineQueue) {
                      await window.OfflineQueue.queueCheckOut(checkOutSession.id, checkOutPayload);
                      // Payload is now safely queued for background sync — draft
                      // can be cleared; the queued payload carries the feedback.
                      clearCheckOutDraft(checkOutSession.id);
                      showToast('Saved offline — will sync when you reconnect', 'success');
                      setCheckOutSession(null);
                    } else {
                      showToast('You\'re offline — please try again when connected', 'error');
                    }
                  } else {
                    const err = await res.json().catch(() => null);
                    showToast(err?.error || 'Check-out failed', 'error');
                  }
                } catch (e) {
                  if (e.name === 'AbortError') {
                    showToast('Check-out is taking too long — please try again', 'error');
                  } else if (!navigator.onLine && window.OfflineQueue) {
                    // Network error and offline — queue it
                    try {
                      await window.OfflineQueue.queueCheckOut(checkOutSession.id, checkOutPayload);
                      // Queued successfully — feedback is safe, drop the draft.
                      clearCheckOutDraft(checkOutSession.id);
                      showToast('Saved offline — will sync when you reconnect', 'success');
                      setCheckOutSession(null);
                    } catch { showToast('Check-out failed — could not save offline', 'error'); }
                  } else {
                    showToast('Check-out failed — ' + (e.message || 'network error'), 'error');
                  }
                }
                setCheckSubmitting(false);
              }} disabled={checkSubmitting} style={{
                padding: '10px 24px', background: 'var(--color-error)', color: 'var(--text-on-primary)', border: 'none',
                borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 700,
                opacity: checkSubmitting ? 0.6 : 1,
              }}>{checkSubmitting ? 'Submitting...' : 'Complete Session ✓'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Propose Time Change Modal (caregiver proposing) ─── */}
      {timeChangeModal && (() => {
        const s = timeChangeModal.session;
        const formatT = (t) => { if (!t) return ''; const [h,m] = t.split(':').map(Number); return `${h === 0 ? 12 : h > 12 ? h-12 : h}:${String(m||0).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`; };
        const recipName = s.recipientName || s.recipient_name || 'Session';
        const dur = s.durationHours || s.duration_hours || 2;
        const sTime = s.time || s.scheduled_time || '';
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div style={{ background: 'var(--bg-surface)', borderRadius: 14, padding: 24, width: 420, maxWidth: '90vw' }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 17, color: 'var(--color-purple)' }}>⏰ Propose Time Change</h3>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 16px' }}>
                {recipName} — currently {formatT(sTime)} for {dur}hr
              </p>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>New Start Time</label>
                  <input type="time" value={tcNewTime} onChange={e => setTcNewTime(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-color)', fontSize: 14, boxSizing: 'border-box' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Duration (hours)</label>
                  <select value={tcNewDuration} onChange={e => setTcNewDuration(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-color)', fontSize: 14, boxSizing: 'border-box' }}>
                    {[1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8].map(h => <option key={h} value={h}>{h} hr{h !== 1 ? 's' : ''}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Reason (optional)</label>
                <textarea value={tcReason} onChange={e => setTcReason(e.target.value)} placeholder="Why the time change?"
                  style={{ width: '100%', minHeight: 50, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-color)', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
              </div>
              {/* Disclosure */}
              <div style={{ padding: '8px 10px', background: 'var(--color-purple-bg)', borderRadius: 8, marginBottom: 14, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong style={{ color: 'var(--color-purple)' }}>Time change policy:</strong> The family will be notified and must acknowledge the new time. If this change is within 24 hours of the session, the family may cancel at no charge and leave a review.
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setTimeChangeModal(null)}
                  style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button disabled={tcLoading || !tcNewTime || (tcNewTime === sTime && parseFloat(tcNewDuration) === dur)} onClick={async () => {
                  setTcLoading(true);
                  try {
                    const r = await apiFetch(`/api/sessions/${s.id}/propose-time-change`, {
                      method: 'POST', body: JSON.stringify({ proposedTime: tcNewTime, proposedDuration: parseFloat(tcNewDuration), reason: tcReason || null }),
                    });
                    if (r?.ok) {
                      showToast('Time change proposed — family notified', 'success');
                      setTimeChangeModal(null);
                      try { const dr = await apiFetch('/api/dashboard'); if (dr?.ok) setData(await dr.json()); } catch {}
                    } else {
                      const d = await r?.json().catch(() => ({}));
                      showToast(d.error || 'Failed to propose time change', 'error');
                    }
                  } catch { showToast('Network error', 'error'); }
                  setTcLoading(false);
                }}
                  style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: tcLoading ? 'var(--text-muted)' : 'var(--color-purple)', color: 'var(--text-on-primary)', fontSize: 13, fontWeight: 600, cursor: tcLoading ? 'wait' : 'pointer' }}>
                  {tcLoading ? 'Sending...' : 'Propose Change'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ─── Acknowledge Time Change Modal (reviewing family's proposal) ─── */}
      {timeChangeProposal && (() => {
        const p = timeChangeProposal;
        const s = p.session;
        const formatT = (t) => { if (!t) return ''; const [h,m] = t.split(':').map(Number); return `${h === 0 ? 12 : h > 12 ? h-12 : h}:${String(m||0).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`; };
        const proposedByFamily = p.proposed_by === 'family';
        const dur = s.durationHours || s.duration_hours || 2;
        const hourlyRate = dur > 0 && s.caregiverPayout > 0 ? (s.caregiverPayout / dur) : 28;
        const feeAmount = p.cancel_fee_hours ? (p.cancel_fee_hours * hourlyRate).toFixed(2) : null;
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div style={{ background: 'var(--bg-surface)', borderRadius: 14, padding: 24, width: 420, maxWidth: '90vw' }}>
              <h3 style={{ margin: '0 0 8px', fontSize: 17, color: 'var(--color-purple)' }}>⏰ Time Change Request</h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 14px' }}>
                {p.proposer_name || 'The family'} wants to change the session time:
              </p>
              <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                <div style={{ flex: 1, padding: '10px 14px', background: 'var(--bg-neutral)', borderRadius: 10, textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Current</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{formatT(p.original_time)}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{p.original_duration}hr</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', fontSize: 18, color: 'var(--color-purple)' }}>→</div>
                <div style={{ flex: 1, padding: '10px 14px', background: 'var(--color-purple-bg)', borderRadius: 10, textAlign: 'center', border: '2px solid var(--color-purple)' }}>
                  <div style={{ fontSize: 10, color: 'var(--color-purple)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Proposed</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-purple)' }}>{formatT(p.proposed_time)}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{p.proposed_duration}hr</div>
                </div>
              </div>
              {p.reason && (
                <div style={{ padding: '8px 10px', background: 'var(--bg-neutral)', borderRadius: 8, marginBottom: 12, fontSize: 12, color: 'var(--text-primary)', fontStyle: 'italic' }}>
                  "{p.reason}"
                </div>
              )}
              {/* Policy disclosure for caregiver reviewing family's late proposal */}
              {proposedByFamily && p.is_within_24h === 1 && (
                <div style={{ padding: '8px 10px', background: 'var(--color-purple-bg)', borderRadius: 8, marginBottom: 14, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  <strong style={{ color: 'var(--color-purple)' }}>Late change policy:</strong> This change was requested within 24 hours of the session. If you decline, it counts as a late cancellation by the family and you're paid in full for the visit. You'll get a notification with the option to waive it if you'd rather.
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button onClick={() => setTimeChangeProposal(null)}
                  style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Close
                </button>
                {/* Reject — keep original time */}
                <button disabled={tcRespondLoading} onClick={async () => {
                  setTcRespondLoading(true);
                  try {
                    const r = await apiFetch(`/api/sessions/${s.id}/time-change/${p.id}/respond`, {
                      method: 'PUT', body: JSON.stringify({ action: 'reject' }),
                    });
                    if (r?.ok) { showToast('Time change declined — keeping original time', 'info'); setTimeChangeProposal(null); try { const dr = await apiFetch('/api/dashboard'); if (dr?.ok) setData(await dr.json()); } catch {} }
                  } catch {}
                  setTcRespondLoading(false);
                }}
                  style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--color-error)', background: 'var(--bg-surface)', color: 'var(--color-error)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Decline
                </button>
                {/* Cancel + collect fee (only if family proposed within 24h) */}
                {proposedByFamily && p.is_within_24h === 1 && p.cancel_fee_hours > 0 && (
                  <button disabled={tcRespondLoading} onClick={async () => {
                    setTcRespondLoading(true);
                    try {
                      const r = await apiFetch(`/api/sessions/${s.id}/time-change/${p.id}/respond`, {
                        method: 'PUT', body: JSON.stringify({ action: 'cancel_with_review' }),
                      });
                      if (r?.ok) {
                        showToast("Session cancelled — you'll be paid in full for this visit", 'info');
                        setTimeChangeProposal(null);
                        try { const dr = await apiFetch('/api/dashboard'); if (dr?.ok) setData(await dr.json()); } catch {}
                      }
                    } catch {}
                    setTcRespondLoading(false);
                  }}
                    style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--color-error)', color: 'var(--text-on-primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    Decline + Cancel
                  </button>
                )}
                {/* Accept the new time */}
                <button disabled={tcRespondLoading} onClick={async () => {
                  setTcRespondLoading(true);
                  try {
                    const r = await apiFetch(`/api/sessions/${s.id}/time-change/${p.id}/respond`, {
                      method: 'PUT', body: JSON.stringify({ action: 'accept' }),
                    });
                    if (r?.ok) { showToast('New time accepted!', 'success'); setTimeChangeProposal(null); try { const dr = await apiFetch('/api/dashboard'); if (dr?.ok) setData(await dr.json()); } catch {} }
                  } catch {}
                  setTcRespondLoading(false);
                }}
                  style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--color-purple)', color: 'var(--text-on-primary)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  Accept New Time
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Visit Detail Modal */}
      {visitDetailSessionId && (
        <VisitDetailModal sessionId={visitDetailSessionId} role="caregiver" onClose={() => setVisitDetailSessionId(null)} onRefresh={async () => {
          const dashRes = await apiFetch('/api/dashboard');
          if (dashRes?.ok) setData(await dashRes.json());
        }} onTimeChange={(session, isReview) => {
          if (isReview) {
            apiFetch(`/api/sessions/${session.id}/time-change`).then(r => r?.ok && r.json().then(d => {
              setTimeChangeProposal({ ...d.proposal, session: { id: session.id, recipientName: session.recipient_name, caregiverName: session.caregiver_name, durationHours: session.duration_hours, time: session.scheduled_time, date: session.scheduled_date, caregiverPayout: session.caregiver_payout || 0 } });
            })).catch(() => {});
          } else {
            const s = { id: session.id, recipientName: session.recipient_name, recipientname: session.recipient_name, durationHours: session.duration_hours, time: session.scheduled_time, scheduled_time: session.scheduled_time, date: session.scheduled_date, status: session.status };
            setTimeChangeModal({ sessionId: session.id, session: s });
            setTcNewTime(session.scheduled_time || '');
            setTcNewDuration(String(session.duration_hours || 2));
            setTcReason('');
          }
        }} />
      )}

      {/* Reviews Modal */}
      {showReviews && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setShowReviews(false)}>
          <div style={{ background: 'var(--bg-surface)', borderRadius: 16, padding: 24, width: 420, maxWidth: '90vw', maxHeight: '70vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18 }}>⭐ Your Reviews</h3>
              <button onClick={() => setShowReviews(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-tertiary)' }}>×</button>
            </div>
            {reviews.length > 0 ? reviews.map((r, i) => (
              <div key={i} style={{ padding: '12px 0', borderBottom: i < reviews.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{r.reviewer_name || r.reviewerName || 'Family'}</span>
                  <span style={{ color: '#f59e0b', fontSize: 13 }}>{'⭐'.repeat(r.rating || 0)}</span>
                </div>
                {r.comment && <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 0', lineHeight: 1.5 }}>{r.comment}</p>}
                {r.created_at && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{new Date(r.created_at).toLocaleDateString()}</div>}
              </div>
            )) : (
              <p style={{ color: 'var(--text-tertiary)', fontSize: 14, textAlign: 'center', margin: '20px 0' }}>No reviews yet</p>
            )}
          </div>
        </div>
      )}

      {/* Decline a request (v1.105.84) — the reason is optional on purpose: requiring one
           would make saying no harder than saying nothing, which is how you get silence. */}
      {decliningJob && (
        <div onClick={() => !decliningBusy && setDecliningJob(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: 'var(--bg-card)', borderRadius: 14, padding: 20, width: '100%', maxWidth: 400 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>Can{'\u2019'}t make it?</h3>
            <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              We{'\u2019'}ll let the family know so they can find someone else. This request won{'\u2019'}t go to other caregivers unless they choose to.
            </p>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 5 }}>
              Anything you{'\u2019'}d like them to know? (optional)
            </label>
            <textarea value={declineReason} onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="e.g. I'm away that week"
              style={{ width: '100%', minHeight: 64, padding: 10, border: '1px solid var(--border-light)', borderRadius: 9, fontSize: 13, resize: 'vertical', background: 'var(--bg-surface)', color: 'var(--text-primary)' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={() => setDecliningJob(null)} disabled={decliningBusy}
                style={{ flex: 1, padding: '11px', background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)', borderRadius: 9, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                Never mind
              </button>
              <button onClick={submitDecline} disabled={decliningBusy}
                style={{ flex: 1, padding: '11px', background: 'var(--color-error)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: decliningBusy ? 'wait' : 'pointer' }}>
                {decliningBusy ? 'Sending\u2026' : 'Decline request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Propose Different Time Modal */}
      {proposingFor && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setProposingFor(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-surface)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 400, maxHeight: '85vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>Propose Different Time</h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 16px' }}>
              Suggest an alternate time for this visit. The family will be notified and can accept or decline.
            </p>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Date</label>
              <input type="date" value={proposalDate} onChange={(e) => setProposalDate(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Time</label>
              <input type="time" value={proposalTime} onChange={(e) => setProposalTime(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Message (optional)</label>
              <textarea value={proposalMsg} onChange={(e) => setProposalMsg(e.target.value)}
                placeholder="e.g., I have another appointment until 1 PM but am free after that"
                style={{ width: '100%', minHeight: 70, padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setProposingFor(null)}
                style={{ flex: 1, padding: '12px 16px', borderRadius: 10, border: '1px solid #ddd', background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handlePropose} disabled={proposalLoading || !proposalDate || !proposalTime}
                style={{
                  flex: 1, padding: '12px 16px', borderRadius: 10, border: 'none',
                  background: (proposalLoading || !proposalDate || !proposalTime) ? 'var(--border-light)' : 'var(--role-color)',
                  color: 'var(--text-on-primary)', fontSize: 14, fontWeight: 600, cursor: proposalLoading ? 'wait' : 'pointer',
                }}>
                {proposalLoading ? 'Sending...' : 'Send Proposal'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
