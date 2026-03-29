const RequestCareModal = window.RequestCareModal = ({ onClose }) => {
  const [step, setStep] = useState(1);
  const [serviceType, setServiceType] = useState('');
  const [otherCareText, setOtherCareText] = useState('');
  const [date, setDate] = useState(() => {
    if (window.__requestCareDate) {
      const d = window.__requestCareDate;
      delete window.__requestCareDate;
      return d;
    }
    return '';
  });
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState('');
  const [instructions, setInstructions] = useState('');
  const [recurrence, setRecurrence] = useState('none');
  const [recurrenceWeeks, setRecurrenceWeeks] = useState('4');
  const [selectedCaregiver, setSelectedCaregiver] = useState(() => {
    if (window.__requestCareCaregiver) {
      const cg = window.__requestCareCaregiver;
      delete window.__requestCareCaregiver;
      return cg;
    }
    return null;
  });
  const [matchedCaregivers, setMatchedCaregivers] = useState([]);
  const [loadingCaregivers, setLoadingCaregivers] = useState(false);
  const [assignedCaregivers, setAssignedCaregivers] = useState(null);
  const [costPreview, setCostPreview] = useState(null);
  const [proposedRate, setProposedRate] = useState('');
  const [localAvgRate, setLocalAvgRate] = useState(null);
  const [careRecipients, setCareRecipients] = useState([]);
  const [selectedRecipientId, setSelectedRecipientId] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [confirmationData, setConfirmationData] = useState(null); // { title, details[] }
  const [existingSessions, setExistingSessions] = useState([]);
  const [interviewRequired, setInterviewRequired] = useState(false);
  const [interviewType, setInterviewType] = useState('video');
  const [visitCounts, setVisitCounts] = useState({}); // caregiverId → { count, caregiverName }
  const [careHistory, setCareHistory] = useState(null); // { visits, totalCount } for selected caregiver
  const [showCareHistory, setShowCareHistory] = useState(false);

  // Short-notice detection
  const shortNotice = (() => {
    if (!date || !time) return false;
    const sessionStart = new Date(date + 'T' + time + ':00');
    const now = new Date();
    const hoursUntil = (sessionStart.getTime() - now.getTime()) / (1000 * 60 * 60);
    return hoursUntil < 24 && hoursUntil > -1;
  })();

  // Recalculate cost breakdown when proposedRate changes
  const getDisplayCost = () => {
    if (!costPreview) return null;
    const rate = proposedRate ? parseFloat(proposedRate) : 0;
    if (!rate || rate <= 0) return costPreview;
    const tierBreakdown = (costPreview.tierBreakdown || []).map(t => ({
      ...t, rate: rate, amount: Math.round(t.hours * rate * 100) / 100,
    }));
    const subtotal = Math.round(tierBreakdown.reduce((s, t) => s + t.amount, 0) * 100) / 100;
    const surcharge = costPreview.shortNotice ? Math.round(subtotal * 0.20 * 100) / 100 : 0;
    const surchargeCaregiver = Math.round(surcharge * 0.75 * 100) / 100;
    const surchargePlatform = Math.round(surcharge * 0.25 * 100) / 100;
    const caregiverPayout = Math.round((subtotal + surchargeCaregiver) * 100) / 100;
    const feePercent = costPreview.platformFeePercent || 20;
    const platformFee = Math.round((subtotal * (feePercent / 100) + surchargePlatform) * 100) / 100;
    const familyTotal = Math.round((caregiverPayout + platformFee) * 100) / 100;
    return { ...costPreview, tierBreakdown, subtotal, surcharge, surchargeBreakdown: { caregiver: surchargeCaregiver, platform: surchargePlatform }, caregiverPayout, platformFee, familyTotal };
  };
  const displayCost = getDisplayCost();

  // Fetch care recipients, assigned caregivers, and existing sessions on mount
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [assignRes, recipRes, sessRes] = await Promise.all([
          apiFetch('/api/assignments'),
          apiFetch('/api/care-recipients'),
          apiFetch('/api/sessions?limit=100'),
        ]);
        if (assignRes?.ok) {
          const data = await assignRes.json();
          setAssignedCaregivers(data.assignments || []);
        } else {
          setAssignedCaregivers([]);
        }
        if (recipRes?.ok) {
          const data = await recipRes.json();
          const recipients = data.careRecipients || data.recipients || [];
          setCareRecipients(recipients);
          if (recipients.length === 1) setSelectedRecipientId(recipients[0].id);
        }
        if (sessRes?.ok) {
          const data = await sessRes.json();
          setExistingSessions((data.sessions || []).filter(s => s.status !== 'cancelled'));
        }
      } catch (err) {
        console.error('Failed to fetch data:', err);
        setAssignedCaregivers([]);
      }
    };
    fetchData();
  }, []);

  // Fetch visit counts for the selected care recipient (for repeat caregiver nudge)
  useEffect(() => {
    if (!selectedRecipientId) return;
    const fetchCounts = async () => {
      try {
        const res = await apiFetch(`/api/interviews/family-visit-counts/${selectedRecipientId}`);
        if (res?.ok) {
          const data = await res.json();
          setVisitCounts(data.counts || {});
        }
      } catch (err) { console.error('Visit counts fetch error:', err); }
    };
    fetchCounts();
  }, [selectedRecipientId]);

  // Fetch care history when a caregiver with past visits is selected
  useEffect(() => {
    if (!selectedCaregiver || !selectedRecipientId) { setCareHistory(null); return; }
    const cgEntry = visitCounts[selectedCaregiver.caregiverId];
    if (!cgEntry || cgEntry.count === 0) { setCareHistory(null); return; }
    const fetchHistory = async () => {
      try {
        const res = await apiFetch(`/api/interviews/care-history/${selectedCaregiver.userId}/${selectedRecipientId}?limit=5`);
        if (res?.ok) setCareHistory(await res.json());
      } catch (err) { console.error('Care history error:', err); }
    };
    fetchHistory();
  }, [selectedCaregiver, selectedRecipientId, visitCounts]);

  // Build sessions-by-date map for calendar indicators
  const sessionsByDate = {};
  existingSessions.forEach(s => {
    const d = s.scheduled_date;
    if (!sessionsByDate[d]) sessionsByDate[d] = [];
    sessionsByDate[d].push(s);
  });

  // Overlap detection — check if selected time+duration conflicts with existing sessions
  const getOverlaps = () => {
    if (!date || !time || !duration) return [];
    const daySess = sessionsByDate[date] || [];
    if (daySess.length === 0) return [];
    const parseTime = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
    const newStart = parseTime(time);
    const newEnd = newStart + parseInt(duration) * 60;
    return daySess.filter(s => {
      if (!s.scheduled_time) return false;
      if (s.status === 'cancelled') return false;
      const sStart = parseTime(s.scheduled_time);
      const sEnd = sStart + (s.duration_hours || 2) * 60;
      return newStart < sEnd && newEnd > sStart;
    });
  };
  const overlappingSessions = getOverlaps();

  // Pre-fill rate from local caregiver average
  useEffect(() => {
    if (!assignedCaregivers || assignedCaregivers.length === 0 || !time) return;
    const hour = parseInt(time.split(':')[0]);
    const rates = assignedCaregivers.map(cg => {
      if (hour >= 6 && hour < 18) return cg.rate_daytime || cg.hourly_rate || 25;
      if (hour >= 18) return cg.rate_nighttime || cg.hourly_rate || 30;
      return cg.rate_overnight || cg.hourly_rate || 35;
    }).filter(r => r > 0);
    if (rates.length > 0) {
      const avg = Math.round(rates.reduce((a, b) => a + b, 0) / rates.length);
      setLocalAvgRate(avg);
      if (!proposedRate) setProposedRate(String(avg));
    }
  }, [assignedCaregivers, time]);

  const hasCaregiverData = assignedCaregivers !== null && assignedCaregivers.length > 0;
  // NEW: 2-step flow — Step 1: What & When, Step 2: Caregiver + Confirm
  const reviewStep = 2;

  // Caregiver matching
  const findMatchingCaregivers = async () => {
    if (!date || !time || !duration || !serviceType) return;
    setLoadingCaregivers(true);
    const parseTime24 = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const requestStart = parseTime24(time);
    const requestEnd = requestStart + parseInt(duration) * 60;
    try {
      const caregivers = assignedCaregivers || [];
      const matches = [];
      for (const cg of caregivers) {
        const cgName = `${cg.first_name} ${cg.last_name}`;
        const hasSkill = caregiverMatchesService(cgName, serviceType);
        const rate = cg.hourly_rate || 30;
        const rateDaytime = cg.rate_daytime || rate;
        const rateNighttime = cg.rate_nighttime || rate;
        const rateOvernight = cg.rate_overnight || rate;
        const hasTieredRates = rateDaytime !== rateNighttime || rateDaytime !== rateOvernight;
        try {
          const slotsRes = await apiFetch(`/api/availability/${cg.caregiver_profile_id}/slots?date=${date}`);
          if (slotsRes?.ok) {
            const slotsData = await slotsRes.json();
            const daySlots = slotsData.slots?.[date] || [];
            let isAvailable = true;
            if (daySlots.length === 0) { isAvailable = false; }
            else { for (let m = requestStart; m < requestEnd; m += 60) { const slotExists = daySlots.some(s => s.startMinutes <= m && s.startMinutes + 60 > m); if (!slotExists) { isAvailable = false; break; } } }
            matches.push({
              name: cgName, caregiverId: cg.caregiver_profile_id, userId: cg.caregiver_user_id,
              skills: cg.specialties || [], rate: hasTieredRates ? `Day $${rateDaytime} \u00b7 Night $${rateNighttime}` : `$${rate}/hr`,
              skillMatch: hasSkill, available: isAvailable, openToInterview: !!cg.open_to_interview,
              reason: !isAvailable ? (daySlots.length === 0 ? 'Not scheduled this day' : 'Not available at this time') : undefined,
            });
          }
        } catch (err) {
          matches.push({ name: cgName, caregiverId: cg.caregiver_profile_id, userId: cg.caregiver_user_id, skills: cg.specialties || [], rate: `$${rate}/hr`, skillMatch: hasSkill, available: false, openToInterview: !!cg.open_to_interview, reason: 'Could not check availability' });
        }
      }
      matches.sort((a, b) => {
        if (a.available && a.skillMatch && (!b.available || !b.skillMatch)) return -1;
        if (b.available && b.skillMatch && (!a.available || !a.skillMatch)) return 1;
        if (a.available && !b.available) return -1;
        if (b.available && !a.available) return 1;
        return 0;
      });
      setMatchedCaregivers(matches);
    } catch (err) { console.error('Caregiver matching error:', err); setMatchedCaregivers([]); }
    setLoadingCaregivers(false);
  };

  const handleSubmit = async () => {
    setSubmitError('');
    const isOpenRequest = !hasCaregiverData || !selectedCaregiver;

    // Review gating: block booking if there's an outstanding review for this caregiver
    if (selectedCaregiver?.caregiverId) {
      try {
        const checkRes = await apiFetch(`/api/accountability/can-book/${selectedCaregiver.caregiverId}`);
        if (checkRes?.ok) {
          const checkData = await checkRes.json();
          if (!checkData.canBook) {
            setSubmitError(`You have an outstanding review for ${selectedCaregiver.name}. Please leave a review for your previous session before booking again.`);
            return;
          }
        }
      } catch {} // If check fails, allow booking (graceful degradation)
    }

    const recurrenceLabel = recurrence !== 'none' ? ` (${recurrence}, ${recurrenceWeeks} sessions)` : '';
    const recipientId = selectedRecipientId || (careRecipients.length > 0 ? careRecipients[0].id : '');
    if (!recipientId) { setSubmitError('No care recipient found. Please add a care recipient first.'); return; }
    const body = {
      careRecipientId: recipientId, serviceType: resolvedServiceType, scheduledDate: date, scheduledTime: time,
      durationHours: parseInt(duration), specialInstructions: instructions || undefined,
      status: isOpenRequest ? 'open' : undefined,
      recurrenceRule: recurrence !== 'none' ? recurrence : undefined,
      recurrenceWeeks: recurrence !== 'none' ? parseInt(recurrenceWeeks) : undefined,
      caregiverId: selectedCaregiver?.caregiverId || undefined,
      directOffer: selectedCaregiver ? true : undefined,
    };
    if (proposedRate && parseFloat(proposedRate) > 0) body.proposedRate = parseFloat(proposedRate);
    if (interviewRequired) { body.interviewRequired = true; body.interviewType = interviewType; }
    try {
      const response = await apiFetch('/api/sessions', { method: 'POST', body: JSON.stringify(body) });
      if (response?.ok) {
        window.dispatchEvent(new CustomEvent('sessions-updated'));
        const details = [];
        if (isOpenRequest) {
          details.push('Open \u2014 waiting for caregiver match');
        } else {
          details.push(selectedCaregiver ? `${selectedCaregiver.name} assigned` : 'Best available caregiver will be assigned');
        }
        details.push(`${date} at ${formatTime12(time)}`);
        details.push(`${duration} hour(s) of ${formatServiceType(resolvedServiceType)}`);
        if (proposedRate) details.push(`Offered rate: $${proposedRate}/hr`);
        if (recurrence !== 'none') details.push(`${recurrence}, ${recurrenceWeeks} sessions`);
        setConfirmationData({
          title: isOpenRequest ? 'Care request posted!' : 'Care request sent!',
          details,
        });
      } else {
        const err = await response.json().catch(() => ({}));
        setSubmitError(err.error || 'Failed to submit care request. Please try again.');
      }
    } catch (err) { console.error('Submit error:', err); setSubmitError('Network error. Please try again.'); }
  };

  const formatTime12 = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${displayH}:${m.toString().padStart(2, '0')} ${ampm}`;
  };

  // Trigger caregiver matching + cost preview when entering step 2
  useEffect(() => {
    if (step === 2 && date && time && duration && serviceType) {
      if (hasCaregiverData) findMatchingCaregivers();
      // Fetch cost preview
      const fetchCost = async () => {
        try {
          const cgId = selectedCaregiver?.caregiverId || '';
          const params = new URLSearchParams({ scheduledDate: date, scheduledTime: time, durationHours: duration });
          if (cgId) params.set('caregiverId', cgId);
          if (proposedRate && parseFloat(proposedRate) > 0) params.set('proposedRate', proposedRate);
          const res = await apiFetch(`/api/sessions/cost-preview?${params}`);
          if (res?.ok) setCostPreview(await res.json());
        } catch (err) { console.error('Cost preview error:', err); }
      };
      fetchCost();
    }
  }, [step, selectedCaregiver, proposedRate]);

  // ─── Date helpers ───
  const tz = typeof TimezoneHelper !== 'undefined' ? (TimezoneHelper.DEFAULT_TZ || 'America/New_York') : 'America/New_York';
  const todayStr = typeof TimezoneHelper !== 'undefined' ? TimezoneHelper.getToday(tz) : (() => { const n = new Date(); return n.getFullYear() + '-' + String(n.getMonth()+1).padStart(2,'0') + '-' + String(n.getDate()).padStart(2,'0'); })();

  // Time pill options — any hour, filtered to 1h+ from now for today
  const getTimeOptions = () => {
    const opts = [];
    const nowET = typeof TimezoneHelper !== 'undefined' ? TimezoneHelper.getNow(tz) : new Date();
    const isToday = date === todayStr;
    const nowMins = isToday ? (nowET.getHours() * 60 + nowET.getMinutes()) : 0;
    const minStartMins = nowMins + 60;
    for (let h = 0; h < 24; h++) {
      const slotMins = h * 60;
      if (isToday && slotMins < minStartMins) continue;
      const val = `${String(h).padStart(2,'0')}:00`;
      const ampm = h >= 12 ? 'p' : 'a';
      const dh = h > 12 ? h - 12 : h === 0 ? 12 : h;
      const label = h === 0 ? '12a' : `${dh}${ampm}`;
      opts.push({ val, label });
    }
    return opts;
  };

  // Pill style helper
  const pill = (selected) => ({
    padding: '8px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: selected ? '2px solid #1b6b5a' : '1px solid #e0e0e0',
    background: selected ? 'var(--color-success-bg)' : 'var(--text-on-primary)',
    color: selected ? 'var(--role-color)' : 'var(--text-secondary)',
    whiteSpace: 'nowrap', flexShrink: 0, transition: 'all 0.15s',
  });

  // Service options
  const serviceOptions = [
    { value: 'companionship', label: 'Companionship' },
    { value: 'personal_care', label: 'Personal Care' },
    { value: 'housekeeping', label: 'Housekeeping' },
    { value: 'meal_prep', label: 'Meal Prep' },
    { value: 'transportation', label: 'Transport' },
    { value: 'other', label: 'Other' },
  ];

  // Resolve actual service type for submission (handles "other:text" format)
  const resolvedServiceType = serviceType === 'other' && otherCareText.trim()
    ? `other:${otherCareText.trim()}` : serviceType;

  const durationOptions = [
    { value: '1', label: '1h' }, { value: '2', label: '2h' }, { value: '3', label: '3h' },
    { value: '4', label: '4h' }, { value: '6', label: '6h' }, { value: '8', label: '8h' },
  ];

  // Loading state
  if (assignedCaregivers === null) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520, textAlign: 'center', padding: 40 }}>
          <div style={{ color: 'var(--text-muted)' }}>Loading...</div>
        </div>
      </div>
    );
  }

  const step1Complete = serviceType && (serviceType !== 'other' || otherCareText.trim()) && date && time && duration && (careRecipients.length <= 1 || selectedRecipientId);

  // ── Confirmation overlay with paper airplane animation ──
  if (confirmationData) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{
          maxWidth: 420, textAlign: 'center', padding: '48px 32px 36px', position: 'relative', overflow: 'hidden',
        }}>
          {/* Animated paper airplane */}
          <div style={{ position: 'relative', height: 100, marginBottom: 16 }}>
            <svg viewBox="0 0 64 64" style={{
              width: 56, height: 56, position: 'absolute', left: '50%', top: '50%',
              transform: 'translate(-50%, -50%)',
              animation: 'planeFloat 2s ease-in-out infinite, planeFadeIn 0.6s ease-out',
            }}>
              <path d="M8 32 L56 8 L36 56 L28 36 Z" fill="var(--role-color)" opacity="0.9" />
              <path d="M28 36 L56 8" stroke="#145c4e" strokeWidth="1.5" fill="none" />
              <path d="M28 36 L36 56 L56 8" fill="#2a8f7a" opacity="0.7" />
            </svg>
            {/* Trail sparkles */}
            {[0,1,2].map(i => (
              <div key={i} style={{
                position: 'absolute', width: 6, height: 6, borderRadius: '50%',
                background: i === 0 ? 'var(--role-color)' : i === 1 ? '#2a8f7a' : '#a8dcd1',
                left: `${28 + i * 10}%`, top: `${55 + i * 5}%`,
                opacity: 0, animation: `sparkle 1.5s ease-out ${0.3 + i * 0.2}s infinite`,
              }} />
            ))}
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--role-color)', margin: '0 0 8px' }}>{confirmationData.title}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '16px 0 24px' }}>
            {confirmationData.details.map((d, i) => (
              <div key={i} style={{
                fontSize: 14, color: i === 0 ? '#1a1a1a' : 'var(--text-secondary)', fontWeight: i === 0 ? 600 : 400,
                animation: `slideUp 0.4s ease-out ${0.2 + i * 0.08}s both`,
              }}>{d}</div>
            ))}
          </div>
          <button onClick={onClose} style={{
            padding: '12px 36px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none',
            borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer',
            animation: 'slideUp 0.4s ease-out 0.5s both',
          }}>Done</button>
          <style>{`
            @keyframes planeFloat {
              0%, 100% { transform: translate(-50%, -50%) rotate(-8deg); }
              50% { transform: translate(-50%, -60%) rotate(-4deg); }
            }
            @keyframes planeFadeIn {
              0% { opacity: 0; transform: translate(-20%, 20%) rotate(-20deg) scale(0.5); }
              100% { opacity: 1; transform: translate(-50%, -50%) rotate(-8deg) scale(1); }
            }
            @keyframes sparkle {
              0% { opacity: 0; transform: scale(0); }
              30% { opacity: 0.8; transform: scale(1.2); }
              100% { opacity: 0; transform: scale(0) translateX(-20px); }
            }
            @keyframes slideUp {
              0% { opacity: 0; transform: translateY(12px); }
              100% { opacity: 1; transform: translateY(0); }
            }
          `}</style>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540, maxHeight: '92vh', overflow: 'auto' }}>
        <button className="modal-close" onClick={onClose}>{'\u2715'}</button>
        <div className="modal-header">{date ? 'Book Care' : 'Request Care'}</div>

        {/* Step indicator — just 2 dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 16 }}>
          {['What & When', 'Confirm'].map((label, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 24, height: 24, borderRadius: '50%', fontSize: 12, fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: step > i + 1 ? 'var(--role-color)' : step === i + 1 ? 'var(--role-color)' : 'var(--border-light)',
                color: step >= i + 1 ? 'var(--text-on-primary)' : 'var(--text-muted)',
              }}>
                {step > i + 1 ? '\u2713' : i + 1}
              </div>
              <span style={{ fontSize: 12, color: step === i + 1 ? 'var(--role-color)' : 'var(--text-muted)', fontWeight: step === i + 1 ? 600 : 400 }}>{label}</span>
              {i === 0 && <div style={{ width: 20, height: 1, background: 'var(--border-light)', margin: '0 4px' }}></div>}
            </div>
          ))}
        </div>

        {/* ═══════ STEP 1: What & When ═══════ */}
        {step === 1 && (
          <>
            {/* Care recipient */}
            {careRecipients.length > 1 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Who needs care?</div>
                <select className="modal-select" value={selectedRecipientId} onChange={(e) => setSelectedRecipientId(e.target.value)}>
                  <option value="">Select...</option>
                  {careRecipients.map(r => (
                    <option key={r.id} value={r.id}>{r.first_name} {r.last_name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Service type pills */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Type of care</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {serviceOptions.map(opt => (
                  <button key={opt.value} type="button" onClick={() => setServiceType(opt.value)} style={pill(serviceType === opt.value)}>
                    {opt.label}
                  </button>
                ))}
              </div>
              {serviceType === 'other' && (
                <input type="text" value={otherCareText} onChange={(e) => setOtherCareText(e.target.value)}
                  placeholder="Describe the type of care needed..."
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, marginTop: 8, boxSizing: 'border-box' }} />
              )}
            </div>

            {/* Date display — pre-selected from Schedule calendar */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Date</div>
              {date ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, padding: '10px 14px', background: '#f0f7f5', border: '1px solid #d4edda', borderRadius: 10, fontSize: 15, fontWeight: 600, color: 'var(--role-color)' }}>
                    {(() => { const p = date.split('-').map(Number); return new Date(p[0], p[1]-1, p[2]).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); })()}
                  </div>
                  <button type="button" onClick={() => { onClose(); if (window.__navigateTo) window.__navigateTo('schedule'); }}
                    style={{ padding: '8px 12px', background: 'none', border: '1px solid #ddd', borderRadius: 8, fontSize: 12, color: 'var(--text-tertiary)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    Change
                  </button>
                </div>
              ) : (
                <div style={{ padding: '14px', background: 'var(--color-warning-bg)', border: '1px solid #ffe082', borderRadius: 10, fontSize: 13, color: 'var(--text-brown)', textAlign: 'center' }}>
                  Please select a date from the calendar first.
                  <button type="button" onClick={() => { onClose(); if (window.__navigateTo) window.__navigateTo('schedule'); }}
                    style={{ display: 'block', margin: '8px auto 0', padding: '8px 20px', background: 'var(--accent-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    Go to Calendar
                  </button>
                </div>
              )}
              {/* Show existing sessions for selected date */}
              {date && sessionsByDate[date] && sessionsByDate[date].length > 0 && (
                <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--bg-highlight)', border: '1px solid #d4edda', borderRadius: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--role-color)', marginBottom: 4 }}>Already scheduled:</div>
                  {sessionsByDate[date].sort((a, b) => (a.scheduled_time || '').localeCompare(b.scheduled_time || '')).map((s, si) => {
                    const t = s.scheduled_time ? (() => { const [h] = s.scheduled_time.split(':').map(Number); const ampm = h >= 12 ? 'p' : 'a'; const dh = h > 12 ? h - 12 : h === 0 ? 12 : h; return `${dh}${ampm}`; })() : '?';
                    const statusColors = { confirmed: 'var(--role-color)', in_progress: 'var(--color-warning)', completed: 'var(--text-secondary)', open: 'var(--accent-color)', requested: 'var(--accent-color)', pending: 'var(--accent-color)' };
                    const statusLabels = { confirmed: 'Confirmed', in_progress: 'In Progress', completed: 'Done', open: 'Requested', requested: 'Requested', pending: 'Pending' };
                    return (
                      <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', padding: '2px 0' }}>
                        <span style={{ fontWeight: 600, minWidth: 24 }}>{t}</span>
                        <span>{s.service_type || 'Care'}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 600, color: statusColors[s.status] || 'var(--text-muted)', textTransform: 'capitalize' }}>{statusLabels[s.status] || s.status}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Time pills — only show if date is selected */}
            {date && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Start time</div>
                {getTimeOptions().length === 0 ? (
                  <div style={{ padding: '10px 14px', background: 'var(--color-warning-bg)', border: '1px solid #ffe082', borderRadius: 8, fontSize: 13, color: 'var(--text-brown)' }}>
                    ⏰ No times available for today — please select a future date above.
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
                    {getTimeOptions().map(opt => (
                      <button key={opt.val} type="button" onClick={() => setTime(opt.val)} style={pill(time === opt.val)}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Duration pills — only show if time is selected */}
            {time && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Duration</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {durationOptions.map(opt => (
                    <button key={opt.value} type="button" onClick={() => setDuration(opt.value)} style={pill(duration === opt.value)}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Overlap warning */}
            {overlappingSessions.length > 0 && (
              <div style={{ marginBottom: 14, padding: '10px 12px', background: 'var(--color-warning-bg)', border: '1px solid #ffcc80', borderRadius: 8 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 18, lineHeight: 1 }}>{'\u26A0\uFE0F'}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-warning)', marginBottom: 4 }}>Time overlap detected</div>
                    <div style={{ fontSize: 12, color: 'var(--text-brown)', lineHeight: 1.4 }}>
                      This session ({formatTime12(time)} – {formatTime12((() => { const [h,m] = time.split(':').map(Number); const endMin = h*60+(m||0)+parseInt(duration)*60; return `${String(Math.floor(endMin/60)).padStart(2,'0')}:${String(endMin%60).padStart(2,'0')}`; })())}) overlaps with:
                    </div>
                    {overlappingSessions.map((s, si) => {
                      const sTime = s.scheduled_time ? formatTime12(s.scheduled_time) : '?';
                      const endH = s.scheduled_time ? (() => { const [h,m] = s.scheduled_time.split(':').map(Number); const endMin = h*60+(m||0)+(s.duration_hours||2)*60; return `${String(Math.floor(endMin/60)).padStart(2,'0')}:${String(endMin%60).padStart(2,'0')}`; })() : '';
                      return (
                        <div key={si} style={{ fontSize: 12, color: 'var(--text-brown)', marginTop: 3, paddingLeft: 4 }}>
                          {'\u2022'} {sTime}{endH ? ` – ${formatTime12(endH)}` : ''} — {(s.service_type || 'Care').replace('_', ' ')} ({s.status})
                        </div>
                      );
                    })}
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>You can still proceed, but check that this doesn't create a scheduling conflict.</div>
                  </div>
                </div>
              </div>
            )}

            {/* Recurrence — only show if duration is selected */}
            {duration && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Repeat</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[{ value: 'none', label: 'One-time' }, { value: 'weekly', label: 'Weekly' }, { value: 'biweekly', label: 'Biweekly' }].map(opt => (
                    <button key={opt.value} type="button" onClick={() => setRecurrence(opt.value)} style={pill(recurrence === opt.value)}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                {recurrence !== 'none' && (
                  <div style={{ marginTop: 8 }}>
                    <select className="modal-select" value={recurrenceWeeks} onChange={(e) => setRecurrenceWeeks(e.target.value)} style={{ fontSize: 13 }}>
                      <option value="2">2 weeks</option>
                      <option value="4">4 weeks</option>
                      <option value="6">6 weeks</option>
                      <option value="8">8 weeks</option>
                      <option value="12">12 weeks</option>
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Short-notice banner */}
            {shortNotice && (
              <div style={{ background: 'var(--color-warning-bg)', border: '1px solid #ffcc80', borderRadius: 8, padding: '8px 12px', marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 16 }}>{'\u26A1'}</span>
                <span style={{ fontSize: 12, color: 'var(--color-warning)', fontWeight: 600 }}>Short notice — 20% rush surcharge applies</span>
              </div>
            )}
          </>
        )}

        {/* ═══════ STEP 2: Caregiver + Confirm ═══════ */}
        {step === 2 && (
          <>
            {/* Compact booking summary at top */}
            <div style={{ background: '#f0f7f5', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', color: 'var(--text-primary)' }}>
                <span><strong>{formatServiceType(resolvedServiceType)}</strong></span>
                <span>{(() => { const p = date.split('-').map(Number); return new Date(p[0], p[1]-1, p[2]).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); })()}</span>
                <span>{formatTime12(time)}</span>
                <span>{duration}h</span>
                {recurrence !== 'none' && <span style={{ color: 'var(--role-color)', fontWeight: 600 }}>{recurrence === 'weekly' ? 'Weekly' : 'Biweekly'} x{recurrenceWeeks}</span>}
              </div>
            </div>

            {/* Caregiver selection */}
            {hasCaregiverData && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Choose a caregiver</div>
                {loadingCaregivers ? (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Checking availability...</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {matchedCaregivers.map((cg, idx) => (
                      <button key={idx} type="button" onClick={() => setSelectedCaregiver(cg)}
                        style={{
                          padding: 12, border: selectedCaregiver?.name === cg.name ? '2px solid #1b6b5a' : '1px solid #e0e0e0',
                          borderRadius: 10, background: selectedCaregiver?.name === cg.name ? 'var(--color-success-bg)' : 'var(--text-on-primary)',
                          cursor: 'pointer', textAlign: 'left',
                        }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{cg.name}</div>
                            <div style={{ fontSize: 12, color: 'var(--role-color)', fontWeight: 500, marginTop: 2 }}>{cg.rate}</div>
                          </div>
                          <div>
                            {cg.available && cg.skillMatch && <span style={{ background: 'var(--color-success-bg)', color: 'var(--role-color)', padding: '3px 8px', borderRadius: 16, fontSize: 11, fontWeight: 600 }}>Best Match</span>}
                            {cg.available && !cg.skillMatch && <span style={{ background: 'var(--color-warning-bg)', color: 'var(--color-warning)', padding: '3px 8px', borderRadius: 16, fontSize: 11, fontWeight: 600 }}>Available</span>}
                            {!cg.available && <span style={{ background: 'var(--color-warning-bg)', color: 'var(--color-warning)', padding: '3px 8px', borderRadius: 16, fontSize: 11, fontWeight: 600 }}>Off This Day</span>}
                          </div>
                        </div>
                        {!cg.available && <div style={{ fontSize: 11, color: 'var(--role-color)', marginTop: 3, fontWeight: 500 }}>{'\u{1F44B}'} You can still request \u2014 they can accept or propose a different time</div>}
                        {cg.openToInterview && <div style={{ fontSize: 11, color: 'var(--role-color)', marginTop: 3 }}>🤝 Open to intro call</div>}
                      </button>
                    ))}
                    <button type="button" onClick={() => setSelectedCaregiver(null)}
                      style={{
                        padding: 10, border: !selectedCaregiver ? '2px solid #e8724a' : '1px dashed #e8724a', borderRadius: 10,
                        background: !selectedCaregiver ? 'var(--bg-warm)' : 'var(--text-on-primary)', cursor: 'pointer', textAlign: 'center',
                        fontSize: 13, color: 'var(--accent-color)', fontWeight: 600,
                      }}>
                      Post as open request
                      <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginTop: 1 }}>Any caregiver can respond</div>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Repeat caregiver nudge with expandable care history */}
            {selectedCaregiver && visitCounts[selectedCaregiver.caregiverId] && visitCounts[selectedCaregiver.caregiverId].count > 0 && (() => {
              const vc = visitCounts[selectedCaregiver.caregiverId];
              const cgFirst = selectedCaregiver.name.split(' ')[0];
              const recipientFirst = (careRecipients.find(r => r.id === selectedRecipientId) || {}).first_name || 'your loved one';
              const moodDot = (mood) => {
                const colors = { great: 'var(--color-success)', good: '#8bc34a', okay: '#ffeb3b', low: 'var(--color-warning)', difficult: 'var(--color-error)' };
                return React.createElement('span', { title: mood || 'unknown', style: { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: colors[mood] || 'var(--border-light)', marginRight: 2 } });
              };
              return React.createElement('div', { style: { background: 'var(--color-purple-bg)', border: '1px solid #ce93d8', borderRadius: 8, padding: '8px 12px', marginBottom: 12 } },
                React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                  React.createElement('span', { style: { fontSize: 12, color: 'var(--color-purple)', fontWeight: 600 } },
                    `\uD83D\uDD01 ${cgFirst} has cared for ${recipientFirst} ${vc.count} time${vc.count > 1 ? 's' : ''}`
                  ),
                  careHistory && careHistory.visits.length > 0 && React.createElement('button', {
                    type: 'button',
                    onClick: () => setShowCareHistory(!showCareHistory),
                    style: { background: 'none', border: 'none', color: 'var(--color-purple)', fontSize: 11, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', padding: 0 }
                  }, showCareHistory ? 'Hide history' : 'View history')
                ),
                interviewRequired && React.createElement('div', { style: { fontSize: 11, color: 'var(--color-purple)', marginTop: 4 } },
                  `An interview may not be needed \u2014 ${cgFirst} is a repeat caregiver.`
                ),
                showCareHistory && careHistory && React.createElement('div', { style: { marginTop: 8, borderTop: '1px solid #ce93d8', paddingTop: 8 } },
                  careHistory.visits.map((v, i) => React.createElement('div', { key: i, style: { fontSize: 11, padding: '4px 0', borderBottom: i < careHistory.visits.length - 1 ? '1px solid #e1bee7' : 'none' } },
                    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                      React.createElement('span', { style: { fontWeight: 600, color: '#4a148c' } }, v.scheduled_date),
                      React.createElement('span', { style: { display: 'flex', alignItems: 'center', gap: 2 } },
                        moodDot(v.arrival_mood), '\u2192 ', moodDot(v.departure_mood),
                        v.actual_cost && React.createElement('span', { style: { marginLeft: 6, color: 'var(--text-secondary)' } }, `$${Math.round(v.actual_cost || v.estimated_cost)}`)
                      )
                    ),
                    v.summary && React.createElement('div', { style: { color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.3 } }, v.summary.slice(0, 120) + (v.summary.length > 120 ? '...' : ''))
                  ))
                )
              );
            })()}

            {/* Interview toggle */}
            <div style={{ marginBottom: 12, padding: '10px 12px', background: 'var(--bg-primary)', borderRadius: 8, border: '1px solid #e0e0e0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{'\uD83C\uDFA5'} Request Interview</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>Quick video or audio call before the appointment</div>
                </div>
                <button type="button" onClick={() => setInterviewRequired(!interviewRequired)} style={{
                  width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', transition: 'all 0.2s',
                  background: interviewRequired ? 'var(--role-color)' : 'var(--border-light)', position: 'relative',
                }}>
                  <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--bg-surface)', position: 'absolute', top: 3,
                    left: interviewRequired ? 23 : 3, transition: 'left 0.2s' }} />
                </button>
              </div>
              {interviewRequired && (
                <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                  {[{ v: 'video', l: '\uD83D\uDCF9 Video' }, { v: 'audio', l: '\uD83D\uDD0A Audio' }].map(opt => (
                    <button key={opt.v} type="button" onClick={() => setInterviewType(opt.v)} style={pill(interviewType === opt.v)}>
                      {opt.l}
                    </button>
                  ))}
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', alignSelf: 'center', marginLeft: 4 }}>5 min max</div>
                </div>
              )}
            </div>

            {/* Rate nudge for off-schedule caregiver */}
            {selectedCaregiver && !selectedCaregiver.available && (
              <div style={{ background: 'var(--color-warning-bg)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: 'var(--text-brown)', display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 16 }}>{'\uD83D\uDCA1'}</span>
                <span><strong>{selectedCaregiver.name}</strong> isn't on schedule. A higher rate makes it more likely they'll accept.
                  {localAvgRate && (
                    <button type="button" onClick={() => setProposedRate(String(Math.round(localAvgRate * 1.25)))}
                      style={{ display: 'inline', marginLeft: 4, background: 'none', border: 'none', color: 'var(--accent-color)', fontWeight: 700, cursor: 'pointer', fontSize: 12, textDecoration: 'underline', padding: 0 }}>
                      Bump to ${Math.round(localAvgRate * 1.25)}/hr
                    </button>
                  )}
                </span>
              </div>
            )}

            {/* Offered rate */}
            <div style={{ marginBottom: 12, padding: '10px 12px', background: 'var(--bg-surface)', borderRadius: 8, border: selectedCaregiver && !selectedCaregiver.available ? '2px solid #e8724a' : '1px solid #e0e0e0' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Your Offered Rate</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 16, color: 'var(--text-secondary)', fontWeight: 600 }}>$</span>
                <input type="number" step="1" min="15" max="500" value={proposedRate} onChange={e => setProposedRate(e.target.value)}
                  placeholder={localAvgRate ? String(localAvgRate) : '25'}
                  style={{ width: 72, padding: '6px 8px', borderRadius: 8, border: '2px solid #1b6b5a', fontSize: 16, fontWeight: 600, textAlign: 'center' }} />
                <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>/hr</span>
                {proposedRate && duration && (
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--role-color)' }}>= ${(parseFloat(proposedRate) * parseInt(duration)).toFixed(0)} total</span>
                )}
              </div>
              {localAvgRate && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>Avg local rate: ${localAvgRate}/hr</div>}
              {shortNotice && <div style={{ fontSize: 11, color: 'var(--accent-color)', marginTop: 2, fontWeight: 500 }}>{'\u26A1'} Short notice +20% surcharge added below</div>}
            </div>

            {/* Cost breakdown — compact */}
            {displayCost && (
              <div style={{ marginBottom: 12, padding: '10px 12px', background: 'var(--bg-primary)', borderRadius: 8, fontSize: 13 }}>
                {displayCost.tierBreakdown?.map((t, i) => {
                  const tierLabel = t.tier === 'daytime' ? 'Day' : t.tier === 'nighttime' ? 'Eve' : 'Night';
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)', marginBottom: 2 }}>
                      <span>{t.hours}h {tierLabel} @ ${t.rate}/hr</span><span>${t.amount.toFixed(2)}</span>
                    </div>
                  );
                })}
                {displayCost.surcharge > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--accent-color)', fontWeight: 500, marginBottom: 2 }}>
                    <span>{'\u26A1'} Rush fee</span><span>+${displayCost.surcharge.toFixed(2)}</span>
                  </div>
                )}
                {displayCost.platformFee > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-tertiary)', marginBottom: 2 }}>
                    <span>Service fee ({displayCost.platformFeePercent || 20}%)</span><span>${((displayCost.platformFee || 0) - (displayCost.surchargeBreakdown?.platform || 0)).toFixed(2)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: 'var(--role-color)', borderTop: '1px solid #e0e0e0', paddingTop: 4, marginTop: 4, fontSize: 15 }}>
                  <span>You pay</span><span>${(displayCost.familyTotal || displayCost.total).toFixed(2)}</span>
                </div>
              </div>
            )}

            {/* Special instructions */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Notes for caregiver (optional)</div>
              <textarea className="modal-textarea" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Any special notes..." rows={2} style={{ fontSize: 13 }}></textarea>
            </div>

            {!selectedCaregiver && !hasCaregiverData && (
              <div style={{ padding: 10, background: 'var(--color-warning-bg)', borderRadius: 8, fontSize: 12, color: 'var(--text-brown)', marginBottom: 8 }}>
                Your care request will be posted as open. Caregivers in your area can respond.
              </div>
            )}
          </>
        )}

        {submitError && (
          <div style={{ marginTop: 8, padding: 8, background: 'var(--color-error-bg)', borderRadius: 8, fontSize: 13, color: 'var(--color-error)' }}>{submitError}</div>
        )}

        {/* Navigation buttons */}
        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
          <button className="btn btn-outline" onClick={() => step > 1 ? setStep(step - 1) : onClose()}>
            {step === 1 ? 'Cancel' : 'Back'}
          </button>
          {step === 1 && (
            <div style={{ flex: 1 }}>
              <button className="btn btn-primary" disabled={!step1Complete} onClick={() => setStep(2)} style={{ width: '100%' }}>
                Next
              </button>
              {!step1Complete && (serviceType || date || time || duration) && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 6 }}>
                  {!serviceType ? 'Select a care type' : (serviceType === 'other' && !otherCareText.trim()) ? 'Describe the care type' : !date ? 'Pick a date' : !time ? 'Pick a start time' : 'Select a duration'}
                </div>
              )}
            </div>
          )}
          {step === 2 && (
            <button className="btn btn-primary" onClick={handleSubmit}>
              {selectedCaregiver ? (selectedCaregiver.available ? 'Confirm Booking' : 'Send Offer') : 'Post Care Request'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
