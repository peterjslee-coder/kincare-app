const RequestCareModal = window.RequestCareModal = ({ onClose }) => {
  const [step, setStep] = useState(1);
  const [serviceType, setServiceType] = useState('');
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
  const [selectedCaregiver, setSelectedCaregiver] = useState(null);
  const [matchedCaregivers, setMatchedCaregivers] = useState([]);
  const [loadingCaregivers, setLoadingCaregivers] = useState(false);
  const [assignedCaregivers, setAssignedCaregivers] = useState(null);
  const [costPreview, setCostPreview] = useState(null);
  const [proposedRate, setProposedRate] = useState('');
  const [localAvgRate, setLocalAvgRate] = useState(null);
  const [careRecipients, setCareRecipients] = useState([]);
  const [selectedRecipientId, setSelectedRecipientId] = useState('');
  const [submitError, setSubmitError] = useState('');

  // Mini-calendar state — initialize to month of pre-filled date or current month
  const [calMonth, setCalMonth] = useState(() => {
    if (date) {
      const p = date.split('-').map(Number);
      return { year: p[0], month: p[1] - 1 };
    }
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

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

  // Fetch care recipients and assigned caregivers on mount
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [assignRes, recipRes] = await Promise.all([
          apiFetch('/api/assignments'),
          apiFetch('/api/care-recipients'),
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
      } catch (err) {
        console.error('Failed to fetch data:', err);
        setAssignedCaregivers([]);
      }
    };
    fetchData();
  }, []);

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
    const recurrenceLabel = recurrence !== 'none' ? ` (${recurrence}, ${recurrenceWeeks} sessions)` : '';
    const recipientId = selectedRecipientId || (careRecipients.length > 0 ? careRecipients[0].id : '');
    if (!recipientId) { setSubmitError('No care recipient found. Please add a care recipient first.'); return; }
    const body = {
      careRecipientId: recipientId, serviceType, scheduledDate: date, scheduledTime: time,
      durationHours: parseInt(duration), specialInstructions: instructions || undefined,
      status: isOpenRequest ? 'open' : undefined,
      recurrenceRule: recurrence !== 'none' ? recurrence : undefined,
      recurrenceWeeks: recurrence !== 'none' ? parseInt(recurrenceWeeks) : undefined,
      caregiverId: selectedCaregiver?.caregiverId || undefined,
      directOffer: (selectedCaregiver && !selectedCaregiver.available) ? true : undefined,
    };
    if (proposedRate && parseFloat(proposedRate) > 0) body.proposedRate = parseFloat(proposedRate);
    try {
      const response = await apiFetch('/api/sessions', { method: 'POST', body: JSON.stringify(body) });
      if (response?.ok) {
        if (isOpenRequest) {
          alert(`Care request posted!${recurrenceLabel}\n\nStatus: Open \u2014 waiting for caregiver match\n${date} at ${time}\n${duration} hour(s) of ${serviceType.replace('_', ' ')}${proposedRate ? `\nOffered rate: $${proposedRate}/hr` : ''}`);
        } else {
          alert(`Care request submitted!${recurrenceLabel}\n\n${selectedCaregiver ? selectedCaregiver.name + ' assigned' : 'Best available caregiver will be assigned'}\n${date} at ${time}\n${duration} hour(s) of ${serviceType.replace('_', ' ')}${proposedRate ? `\nOffered rate: $${proposedRate}/hr` : ''}`);
        }
        window.dispatchEvent(new CustomEvent('sessions-updated'));
        onClose();
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
          const res = await apiFetch(`/api/sessions/cost-preview?${params}`);
          if (res?.ok) setCostPreview(await res.json());
        } catch (err) { console.error('Cost preview error:', err); }
      };
      fetchCost();
    }
  }, [step, selectedCaregiver]);

  // ─── Mini calendar helpers ───
  const tz = typeof TimezoneHelper !== 'undefined' ? (TimezoneHelper.DEFAULT_TZ || 'America/New_York') : 'America/New_York';
  const todayStr = typeof TimezoneHelper !== 'undefined' ? TimezoneHelper.getToday(tz) : (() => { const n = new Date(); return n.getFullYear() + '-' + String(n.getMonth()+1).padStart(2,'0') + '-' + String(n.getDate()).padStart(2,'0'); })();
  const calDaysInMonth = new Date(calMonth.year, calMonth.month + 1, 0).getDate();
  const calFirstDay = new Date(calMonth.year, calMonth.month, 1).getDay();
  const calMonthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const getCalDateStr = (day) => `${calMonth.year}-${String(calMonth.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const calPrev = () => setCalMonth(p => p.month === 0 ? { year: p.year - 1, month: 11 } : { year: p.year, month: p.month - 1 });
  const calNext = () => setCalMonth(p => p.month === 11 ? { year: p.year + 1, month: 0 } : { year: p.year, month: p.month + 1 });

  // Time pill options — filtered for today
  const getTimeOptions = () => {
    const opts = [];
    const nowET = typeof TimezoneHelper !== 'undefined' ? TimezoneHelper.getNow(tz) : new Date();
    const isToday = date === todayStr;
    const nowMins = isToday ? (nowET.getHours() * 60 + nowET.getMinutes()) : 0;
    const minStartMins = nowMins + 60;
    for (let h = 7; h <= 20; h++) {
      const slotMins = h * 60;
      if (isToday && slotMins < minStartMins) continue;
      const val = `${String(h).padStart(2,'0')}:00`;
      const ampm = h >= 12 ? 'p' : 'a';
      const dh = h > 12 ? h - 12 : h === 0 ? 12 : h;
      opts.push({ val, label: `${dh}${ampm}` });
    }
    return opts;
  };

  // Pill style helper
  const pill = (selected) => ({
    padding: '8px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: selected ? '2px solid #1b6b5a' : '1px solid #e0e0e0',
    background: selected ? '#e8f5e9' : '#fff',
    color: selected ? '#1b6b5a' : '#555',
    whiteSpace: 'nowrap', flexShrink: 0, transition: 'all 0.15s',
  });

  // Service options
  const serviceOptions = [
    { value: 'companionship', label: 'Companionship' },
    { value: 'personal_care', label: 'Personal Care' },
    { value: 'housekeeping', label: 'Housekeeping' },
    { value: 'meal_prep', label: 'Meal Prep' },
    { value: 'transportation', label: 'Transport' },
    { value: 'health_wellness', label: 'Health' },
  ];

  const durationOptions = [
    { value: '1', label: '1h' }, { value: '2', label: '2h' }, { value: '3', label: '3h' },
    { value: '4', label: '4h' }, { value: '6', label: '6h' }, { value: '8', label: '8h' },
  ];

  // Loading state
  if (assignedCaregivers === null) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520, textAlign: 'center', padding: 40 }}>
          <div style={{ color: '#999' }}>Loading...</div>
        </div>
      </div>
    );
  }

  const step1Complete = serviceType && date && time && duration && (careRecipients.length <= 1 || selectedRecipientId);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540, maxHeight: '92vh', overflow: 'auto' }}>
        <button className="modal-close" onClick={onClose}>{'\u2715'}</button>
        <div className="modal-header">Request Care</div>

        {/* Step indicator — just 2 dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 16 }}>
          {['What & When', 'Confirm'].map((label, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 24, height: 24, borderRadius: '50%', fontSize: 12, fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: step > i + 1 ? '#1b6b5a' : step === i + 1 ? '#1b6b5a' : '#e0e0e0',
                color: step >= i + 1 ? '#fff' : '#999',
              }}>
                {step > i + 1 ? '\u2713' : i + 1}
              </div>
              <span style={{ fontSize: 12, color: step === i + 1 ? '#1b6b5a' : '#999', fontWeight: step === i + 1 ? 600 : 400 }}>{label}</span>
              {i === 0 && <div style={{ width: 20, height: 1, background: '#e0e0e0', margin: '0 4px' }}></div>}
            </div>
          ))}
        </div>

        {/* ═══════ STEP 1: What & When ═══════ */}
        {step === 1 && (
          <>
            {/* Care recipient */}
            {careRecipients.length > 1 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Who needs care?</div>
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
              <div style={{ fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Type of care</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {serviceOptions.map(opt => (
                  <button key={opt.value} type="button" onClick={() => setServiceType(opt.value)} style={pill(serviceType === opt.value)}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Inline mini-calendar */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Date</div>
              <div style={{ border: '1px solid #e8e8e8', borderRadius: 10, padding: '10px 12px', background: '#fafafa' }}>
                {/* Month nav */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <button type="button" onClick={calPrev} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#666', padding: '4px 8px' }}>{'\u25C0'}</button>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#1b6b5a' }}>{calMonthNames[calMonth.month]} {calMonth.year}</span>
                  <button type="button" onClick={calNext} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#666', padding: '4px 8px' }}>{'\u25B6'}</button>
                </div>
                {/* Day headers */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', fontSize: 10, fontWeight: 600, color: '#aaa', marginBottom: 4 }}>
                  {['S','M','T','W','T','F','S'].map((d, i) => <div key={i}>{d}</div>)}
                </div>
                {/* Day cells */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
                  {Array.from({ length: calFirstDay }, (_, i) => <div key={'e'+i}></div>)}
                  {Array.from({ length: calDaysInMonth }, (_, i) => {
                    const day = i + 1;
                    const ds = getCalDateStr(day);
                    const isPast = ds < todayStr;
                    const isSel = ds === date;
                    const isToday = ds === todayStr;
                    return (
                      <button key={day} type="button" disabled={isPast}
                        onClick={() => { setDate(ds); setTime(''); }}
                        style={{
                          width: '100%', aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 13, fontWeight: isToday ? 800 : isSel ? 700 : 400, cursor: isPast ? 'default' : 'pointer',
                          border: isSel ? '2px solid #1b6b5a' : 'none', borderRadius: '50%',
                          background: isSel ? '#1b6b5a' : 'transparent',
                          color: isSel ? '#fff' : isPast ? '#ccc' : isToday ? '#e8724a' : '#333',
                          opacity: isPast ? 0.5 : 1, padding: 0,
                        }}>
                        {day}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Time pills — only show if date is selected */}
            {date && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Start time</div>
                <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
                  {getTimeOptions().map(opt => (
                    <button key={opt.val} type="button" onClick={() => setTime(opt.val)} style={pill(time === opt.val)}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Duration pills — only show if time is selected */}
            {time && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Duration</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {durationOptions.map(opt => (
                    <button key={opt.value} type="button" onClick={() => setDuration(opt.value)} style={pill(duration === opt.value)}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Recurrence — only show if duration is selected */}
            {duration && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Repeat</div>
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
              <div style={{ background: '#fff3e0', border: '1px solid #ffcc80', borderRadius: 8, padding: '8px 12px', marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 16 }}>{'\u26A1'}</span>
                <span style={{ fontSize: 12, color: '#e65100', fontWeight: 600 }}>Short notice — 20% rush surcharge applies</span>
              </div>
            )}
          </>
        )}

        {/* ═══════ STEP 2: Caregiver + Confirm ═══════ */}
        {step === 2 && (
          <>
            {/* Compact booking summary at top */}
            <div style={{ background: '#f0f7f5', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', color: '#333' }}>
                <span><strong>{serviceType.replace('_', ' ')}</strong></span>
                <span>{(() => { const p = date.split('-').map(Number); return new Date(p[0], p[1]-1, p[2]).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); })()}</span>
                <span>{formatTime12(time)}</span>
                <span>{duration}h</span>
                {recurrence !== 'none' && <span style={{ color: '#1b6b5a', fontWeight: 600 }}>{recurrence === 'weekly' ? 'Weekly' : 'Biweekly'} x{recurrenceWeeks}</span>}
              </div>
            </div>

            {/* Caregiver selection */}
            {hasCaregiverData && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Choose a caregiver</div>
                {loadingCaregivers ? (
                  <div style={{ padding: 20, textAlign: 'center', color: '#999', fontSize: 13 }}>Checking availability...</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {matchedCaregivers.map((cg, idx) => (
                      <button key={idx} type="button" onClick={() => setSelectedCaregiver(cg)}
                        style={{
                          padding: 12, border: selectedCaregiver?.name === cg.name ? '2px solid #1b6b5a' : '1px solid #e0e0e0',
                          borderRadius: 10, background: selectedCaregiver?.name === cg.name ? '#e8f5e9' : '#fff',
                          cursor: 'pointer', textAlign: 'left',
                        }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14, color: '#1a1a2e' }}>{cg.name}</div>
                            <div style={{ fontSize: 12, color: '#1b6b5a', fontWeight: 500, marginTop: 2 }}>{cg.rate}</div>
                          </div>
                          <div>
                            {cg.available && cg.skillMatch && <span style={{ background: '#e8f5e9', color: '#1b6b5a', padding: '3px 8px', borderRadius: 16, fontSize: 11, fontWeight: 600 }}>Best Match</span>}
                            {cg.available && !cg.skillMatch && <span style={{ background: '#fff8e1', color: '#f57f17', padding: '3px 8px', borderRadius: 16, fontSize: 11, fontWeight: 600 }}>Available</span>}
                            {!cg.available && <span style={{ background: '#fff8e1', color: '#e65100', padding: '3px 8px', borderRadius: 16, fontSize: 11, fontWeight: 600 }}>Not Scheduled</span>}
                          </div>
                        </div>
                        {!cg.available && <div style={{ fontSize: 11, color: '#888', marginTop: 3 }}>{cg.reason || 'Can still accept if available'}</div>}
                        {cg.openToInterview && <div style={{ fontSize: 11, color: '#1b6b5a', marginTop: 3 }}>🤝 Open to intro call</div>}
                      </button>
                    ))}
                    <button type="button" onClick={() => setSelectedCaregiver(null)}
                      style={{
                        padding: 10, border: !selectedCaregiver ? '2px solid #e8724a' : '1px dashed #e8724a', borderRadius: 10,
                        background: !selectedCaregiver ? '#fff8f0' : '#fff', cursor: 'pointer', textAlign: 'center',
                        fontSize: 13, color: '#e8724a', fontWeight: 600,
                      }}>
                      Post as open request
                      <div style={{ fontSize: 11, fontWeight: 400, color: '#999', marginTop: 1 }}>Any caregiver can respond</div>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Rate nudge for off-schedule caregiver */}
            {selectedCaregiver && !selectedCaregiver.available && (
              <div style={{ background: '#fff3e0', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#795548', display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 16 }}>{'\uD83D\uDCA1'}</span>
                <span><strong>{selectedCaregiver.name}</strong> isn't on schedule. A higher rate makes it more likely they'll accept.
                  {localAvgRate && (
                    <button type="button" onClick={() => setProposedRate(String(Math.round(localAvgRate * 1.25)))}
                      style={{ display: 'inline', marginLeft: 4, background: 'none', border: 'none', color: '#e8724a', fontWeight: 700, cursor: 'pointer', fontSize: 12, textDecoration: 'underline', padding: 0 }}>
                      Bump to ${Math.round(localAvgRate * 1.25)}/hr
                    </button>
                  )}
                </span>
              </div>
            )}

            {/* Offered rate */}
            <div style={{ marginBottom: 12, padding: '10px 12px', background: '#fff', borderRadius: 8, border: selectedCaregiver && !selectedCaregiver.available ? '2px solid #e8724a' : '1px solid #e0e0e0' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 6 }}>Your Offered Rate</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 16, color: '#666', fontWeight: 600 }}>$</span>
                <input type="number" step="1" min="15" max="500" value={proposedRate} onChange={e => setProposedRate(e.target.value)}
                  placeholder={localAvgRate ? String(localAvgRate) : '25'}
                  style={{ width: 72, padding: '6px 8px', borderRadius: 8, border: '2px solid #1b6b5a', fontSize: 16, fontWeight: 600, textAlign: 'center' }} />
                <span style={{ fontSize: 13, color: '#888' }}>/hr</span>
                {proposedRate && duration && (
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#1b6b5a' }}>= ${(parseFloat(proposedRate) * parseInt(duration)).toFixed(0)} total</span>
                )}
              </div>
              {localAvgRate && <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>Avg local rate: ${localAvgRate}/hr</div>}
              {shortNotice && <div style={{ fontSize: 11, color: '#e8724a', marginTop: 2, fontWeight: 500 }}>{'\u26A1'} Short notice +20% surcharge added below</div>}
            </div>

            {/* Cost breakdown — compact */}
            {displayCost && (
              <div style={{ marginBottom: 12, padding: '10px 12px', background: '#f8f9fa', borderRadius: 8, fontSize: 13 }}>
                {displayCost.tierBreakdown?.map((t, i) => {
                  const tierLabel = t.tier === 'daytime' ? 'Day' : t.tier === 'nighttime' ? 'Eve' : 'Night';
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', color: '#666', marginBottom: 2 }}>
                      <span>{t.hours}h {tierLabel} @ ${t.rate}/hr</span><span>${t.amount.toFixed(2)}</span>
                    </div>
                  );
                })}
                {displayCost.surcharge > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e8724a', fontWeight: 500, marginBottom: 2 }}>
                    <span>{'\u26A1'} Rush fee</span><span>+${displayCost.surcharge.toFixed(2)}</span>
                  </div>
                )}
                {displayCost.platformFee > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#888', marginBottom: 2 }}>
                    <span>Service fee ({displayCost.platformFeePercent || 20}%)</span><span>${((displayCost.platformFee || 0) - (displayCost.surchargeBreakdown?.platform || 0)).toFixed(2)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: '#1b6b5a', borderTop: '1px solid #e0e0e0', paddingTop: 4, marginTop: 4, fontSize: 15 }}>
                  <span>You pay</span><span>${(displayCost.familyTotal || displayCost.total).toFixed(2)}</span>
                </div>
              </div>
            )}

            {/* Special instructions */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Notes for caregiver (optional)</div>
              <textarea className="modal-textarea" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Any special notes..." rows={2} style={{ fontSize: 13 }}></textarea>
            </div>

            {!selectedCaregiver && !hasCaregiverData && (
              <div style={{ padding: 10, background: '#fff8e1', borderRadius: 8, fontSize: 12, color: '#795548', marginBottom: 8 }}>
                Your care request will be posted as open. Caregivers in your area can respond.
              </div>
            )}
          </>
        )}

        {submitError && (
          <div style={{ marginTop: 8, padding: 8, background: '#fce4ec', borderRadius: 8, fontSize: 13, color: '#c62828' }}>{submitError}</div>
        )}

        {/* Navigation buttons */}
        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
          <button className="btn btn-outline" onClick={() => step > 1 ? setStep(step - 1) : onClose()}>
            {step === 1 ? 'Cancel' : 'Back'}
          </button>
          {step === 1 && (
            <button className="btn btn-primary" disabled={!step1Complete} onClick={() => setStep(2)}>
              Next
            </button>
          )}
          {step === 2 && selectedCaregiver?.openToInterview && (
            <button type="button" onClick={async () => {
              try {
                const msg = `Hi ${selectedCaregiver.name.split(' ')[0]}, I'm interested in booking care on ${date} at ${time}. Would you be available for a quick intro call before we confirm? Looking forward to meeting you!`;
                const convRes = await apiFetch('/api/messages/conversations', { method: 'POST', body: JSON.stringify({ memberIds: [selectedCaregiver.userId], name: null }) });
                if (convRes?.ok) {
                  const convData = await convRes.json();
                  const cid = convData.conversationId || convData.conversation?.id || convData.id;
                  await apiFetch(`/api/messages/conversations/${cid}`, { method: 'POST', body: JSON.stringify({ content: msg }) });
                  alert('Intro call request sent! Check Messages to coordinate.');
                }
              } catch (err) { console.error('Interview request error:', err); }
            }}
              style={{ padding: '10px 16px', background: '#fff', color: '#1b6b5a', border: '2px solid #1b6b5a', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              🤝 Request Intro Call
            </button>
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
