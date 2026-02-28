const RequestCareModal = window.RequestCareModal = ({ onClose }) => {
  const [step, setStep] = useState(1);
  const [serviceType, setServiceType] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState('');
  const [instructions, setInstructions] = useState('');
  const [recurrence, setRecurrence] = useState('none');
  const [recurrenceWeeks, setRecurrenceWeeks] = useState('4');
  const [selectedCaregiver, setSelectedCaregiver] = useState(null);
  const [matchedCaregivers, setMatchedCaregivers] = useState([]);
  const [loadingCaregivers, setLoadingCaregivers] = useState(false);
  const [assignedCaregivers, setAssignedCaregivers] = useState(null); // null = not loaded yet
  const [costPreview, setCostPreview] = useState(null);
  const [proposedRate, setProposedRate] = useState('');
  const [localAvgRate, setLocalAvgRate] = useState(null);
  const [careRecipients, setCareRecipients] = useState([]);
  const [selectedRecipientId, setSelectedRecipientId] = useState('');
  const [submitError, setSubmitError] = useState('');

  // Short-notice detection (client-side, <24h from now)
  const shortNotice = (() => {
    if (!date || !time) return false;
    const sessionStart = new Date(date + 'T' + time + ':00');
    const now = new Date();
    const hoursUntil = (sessionStart.getTime() - now.getTime()) / (1000 * 60 * 60);
    return hoursUntil < 24 && hoursUntil > -1; // only if in future and < 24h
  })();

  // Recalculate cost breakdown when proposedRate changes
  const getDisplayCost = () => {
    if (!costPreview) return null;
    const rate = proposedRate ? parseFloat(proposedRate) : 0;
    if (!rate || rate <= 0) return costPreview;
    // Recalculate with offered flat rate
    const tierBreakdown = (costPreview.tierBreakdown || []).map(t => ({
      ...t, rate: rate, amount: Math.round(t.hours * rate * 100) / 100,
    }));
    const subtotal = Math.round(tierBreakdown.reduce((s, t) => s + t.amount, 0) * 100) / 100;
    const surcharge = costPreview.shortNotice ? Math.round(subtotal * 0.20 * 100) / 100 : 0;
    // Rush surcharge split: 75% to caregiver (incentive), 25% to platform
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

  // Pre-fill rate from local caregiver average when we have time + caregivers
  useEffect(() => {
    if (!assignedCaregivers || assignedCaregivers.length === 0 || !time) return;
    const hour = parseInt(time.split(':')[0]);
    // Pick tier-appropriate rate: daytime 6a-6p, nighttime 6p-12a, overnight 12a-6a
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

  // Check if user has assigned caregivers
  const hasCaregiverData = assignedCaregivers !== null && assignedCaregivers.length > 0;
  const totalSteps = hasCaregiverData ? 3 : 2;
  const stepLabels = hasCaregiverData
    ? ['Details', 'Caregiver', 'Review']
    : ['Details', 'Review'];
  const reviewStep = hasCaregiverData ? 3 : 2;
  const caregiverStep = hasCaregiverData ? 2 : -1; // -1 = skip

  // When moving to caregiver step, find matches from API
  const findMatchingCaregivers = async () => {
    if (!date || !time || !duration || !serviceType) return;
    setLoadingCaregivers(true);

    const parseTime24 = (t) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };
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

        // Fetch real availability slots from API
        try {
          const slotsRes = await apiFetch(`/api/availability/${cg.caregiver_profile_id}/slots?date=${date}`);
          if (slotsRes?.ok) {
            const slotsData = await slotsRes.json();
            const daySlots = slotsData.slots?.[date] || [];

            // Check if the requested time window fits within available slots
            let isAvailable = true;
            if (daySlots.length === 0) {
              isAvailable = false;
            } else {
              for (let m = requestStart; m < requestEnd; m += 60) {
                const slotExists = daySlots.some(s => s.startMinutes <= m && s.startMinutes + 60 > m);
                if (!slotExists) { isAvailable = false; break; }
              }
            }

            if (isAvailable) {
              matches.push({
                name: cgName, caregiverId: cg.caregiver_profile_id,
                skills: cg.specialties || [], rate: hasTieredRates ? `Day $${rateDaytime} · Night $${rateNighttime}` : `$${rate}/hr`,
                skillMatch: hasSkill, available: true,
              });
            } else {
              matches.push({
                name: cgName, caregiverId: cg.caregiver_profile_id,
                skills: cg.specialties || [], rate: hasTieredRates ? `Day $${rateDaytime} · Night $${rateNighttime}` : `$${rate}/hr`,
                skillMatch: hasSkill, available: false,
                reason: daySlots.length === 0 ? 'Not scheduled this day' : 'Not available at this time',
              });
            }
          }
        } catch (err) {
          matches.push({
            name: cgName, caregiverId: cg.caregiver_profile_id,
            skills: cg.specialties || [], rate: `$${rate}/hr`,
            skillMatch: hasSkill, available: false, reason: 'Could not check availability',
          });
        }
      }

      // Sort: best matches (available + skill) first
      matches.sort((a, b) => {
        if (a.available && a.skillMatch && (!b.available || !b.skillMatch)) return -1;
        if (b.available && b.skillMatch && (!a.available || !a.skillMatch)) return 1;
        if (a.available && !b.available) return -1;
        if (b.available && !a.available) return 1;
        return 0;
      });

      setMatchedCaregivers(matches);
    } catch (err) {
      console.error('Caregiver matching error:', err);
      setMatchedCaregivers([]);
    }
    setLoadingCaregivers(false);
  };

  const handleSubmit = async () => {
    setSubmitError('');
    const isOpenRequest = !hasCaregiverData || !selectedCaregiver;
    const recurrenceLabel = recurrence !== 'none' ? ` (${recurrence}, ${recurrenceWeeks} sessions)` : '';

    // Use selected recipient or first available
    const recipientId = selectedRecipientId || (careRecipients.length > 0 ? careRecipients[0].id : '');
    if (!recipientId) {
      setSubmitError('No care recipient found. Please add a care recipient first.');
      return;
    }

    const body = {
      careRecipientId: recipientId,
      serviceType,
      scheduledDate: date,
      scheduledTime: time,
      durationHours: parseInt(duration),
      specialInstructions: instructions || undefined,
      status: isOpenRequest ? 'open' : undefined,
      recurrenceRule: recurrence !== 'none' ? recurrence : undefined,
      recurrenceWeeks: recurrence !== 'none' ? parseInt(recurrenceWeeks) : undefined,
      caregiverId: selectedCaregiver?.caregiverId || undefined,
      directOffer: (selectedCaregiver && !selectedCaregiver.available) ? true : undefined,
    };
    // Include proposed rate if set
    if (proposedRate && parseFloat(proposedRate) > 0) {
      body.proposedRate = parseFloat(proposedRate);
    }

    try {
      const response = await apiFetch('/api/sessions', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (response?.ok) {
        const data = await response.json();
        if (isOpenRequest) {
          alert(`Care request posted!${recurrenceLabel}\n\nStatus: Open — waiting for caregiver match\n${date} at ${time}\n${duration} hour(s) of ${serviceType.replace('_', ' ')}${proposedRate ? `\nOffered rate: $${proposedRate}/hr` : ''}`);
        } else {
          if (selectedCaregiver && !selectedCaregiver.available) {
            alert(`Direct offer sent to ${selectedCaregiver.name}!${recurrenceLabel}\n\nThey have 1 hour to respond before it opens to other caregivers.\n${date} at ${time}\n${duration} hour(s) of ${serviceType.replace('_', ' ')}${proposedRate ? `\nOffered rate: $${proposedRate}/hr` : ''}`);
          } else {
            alert(`Care request submitted!${recurrenceLabel}\n\n${selectedCaregiver ? selectedCaregiver.name + ' assigned' : 'Best available caregiver will be assigned'}\n${date} at ${time}\n${duration} hour(s) of ${serviceType.replace('_', ' ')}${proposedRate ? `\nOffered rate: $${proposedRate}/hr` : ''}`);
          }
        }
        // Signal pages to re-fetch sessions (Schedule, Dashboard, etc.)
        window.dispatchEvent(new CustomEvent('sessions-updated'));
        onClose();
      } else {
        const err = await response.json().catch(() => ({}));
        setSubmitError(err.error || 'Failed to submit care request. Please try again.');
      }
    } catch (err) {
      console.error('Submit error:', err);
      setSubmitError('Network error. Please try again.');
    }
  };

  const formatTime12 = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${displayH}:${m.toString().padStart(2, '0')} ${ampm}`;
  };

  // Trigger caregiver matching when reaching caregiver step
  useEffect(() => {
    if (hasCaregiverData && step === caregiverStep && date && time && duration && serviceType) {
      findMatchingCaregivers();
    }
  }, [step]);

  // Fetch cost preview when reaching review step
  useEffect(() => {
    if (step === reviewStep && date && time && duration) {
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

  // While assignments haven't loaded yet, show loading
  if (assignedCaregivers === null) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520, textAlign: 'center', padding: 40 }}>
          <div style={{ color: '#999' }}>Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520, maxHeight: '90vh', overflow: 'auto' }}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="modal-header">Request Care</div>

        {/* Step indicator */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 4, marginBottom: 20 }}>
          {stepLabels.map((label, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: 24, height: 24, borderRadius: '50%', fontSize: 12, fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: step > i + 1 ? '#1b6b5a' : step === i + 1 ? '#1b6b5a' : '#e0e0e0',
                color: step >= i + 1 ? '#fff' : '#999',
              }}>
                {step > i + 1 ? '✓' : i + 1}
              </div>
              <span style={{ fontSize: 11, color: step === i + 1 ? '#1b6b5a' : '#999', fontWeight: step === i + 1 ? 600 : 400 }}>{label}</span>
              {i < stepLabels.length - 1 && <div style={{ width: 16, height: 1, background: '#e0e0e0', margin: '0 2px' }}></div>}
            </div>
          ))}
        </div>

        {step === 1 && (
          <>
            {careRecipients.length > 1 && (
              <div className="modal-section">
                <label className="modal-label">Who needs care?</label>
                <select className="modal-select" value={selectedRecipientId} onChange={(e) => setSelectedRecipientId(e.target.value)}>
                  <option value="">Select...</option>
                  {careRecipients.map(r => (
                    <option key={r.id} value={r.id}>{r.first_name} {r.last_name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="modal-section">
              <label className="modal-label">What type of care do you need?</label>
              <select className="modal-select" value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
                <option value="">Select a service...</option>
                <option value="companionship">Companionship</option>
                <option value="personal_care">Personal Care</option>
                <option value="housekeeping">Light Housekeeping</option>
                <option value="meal_prep">Meal Preparation</option>
                <option value="transportation">Transportation</option>
                <option value="health_wellness">Health & Wellness</option>
              </select>
            </div>
            <div className="modal-section">
              <label className="modal-label">When do you need care?</label>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: '#888', marginBottom: 4, display: 'block' }}>Date</label>
                  <input type="date" className="modal-input" value={date} min={typeof TimezoneHelper !== 'undefined' ? TimezoneHelper.getToday(TimezoneHelper.DEFAULT_TZ) : new Date().toISOString().split('T')[0]} onChange={(e) => { setDate(e.target.value); setTime(''); }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: '#888', marginBottom: 4, display: 'block' }}>Start Time</label>
                  <select className="modal-select" value={time} onChange={(e) => setTime(e.target.value)}>
                    <option value="">Select a time...</option>
                    {(() => {
                      const opts = [];
                      // If date is today, only show times at least 1 hour from now
                      const tz = typeof TimezoneHelper !== 'undefined' ? (TimezoneHelper.DEFAULT_TZ || 'America/New_York') : 'America/New_York';
                      const nowET = typeof TimezoneHelper !== 'undefined' ? TimezoneHelper.getNow(tz) : new Date();
                      const todayStr = typeof TimezoneHelper !== 'undefined' ? TimezoneHelper.getToday(tz) : nowET.toISOString().split('T')[0];
                      const isToday = date === todayStr;
                      const nowMins = isToday ? (nowET.getHours() * 60 + nowET.getMinutes()) : 0;
                      const minStartMins = nowMins + 60; // at least 1 hour from now
                      for (let h = 6; h <= 22; h++) {
                        for (let m = 0; m < 60; m += 30) {
                          if (h === 22 && m > 0) break;
                          const slotMins = h * 60 + m;
                          if (isToday && slotMins < minStartMins) continue;
                          const val = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
                          const ampm = h >= 12 ? 'PM' : 'AM';
                          const dh = h > 12 ? h - 12 : h === 0 ? 12 : h;
                          const label = `${dh}:${String(m).padStart(2,'0')} ${ampm}`;
                          opts.push(<option key={val} value={val}>{label}</option>);
                        }
                      }
                      return opts;
                    })()}
                  </select>
                </div>
              </div>
            </div>
            <div className="modal-section">
              <label className="modal-label">How long do you need care?</label>
              <select className="modal-select" value={duration} onChange={(e) => setDuration(e.target.value)}>
                <option value="">Select...</option>
                <option value="1">1 hour</option>
                <option value="2">2 hours</option>
                <option value="3">3 hours</option>
                <option value="4">4 hours</option>
                <option value="6">6 hours</option>
                <option value="8">Full day (8 hours)</option>
              </select>
            </div>
            <div className="modal-section">
              <label className="modal-label">Repeat</label>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                {[
                  { value: 'none', label: 'One-time' },
                  { value: 'weekly', label: 'Weekly' },
                  { value: 'biweekly', label: 'Every 2 weeks' },
                ].map(opt => (
                  <button key={opt.value} type="button"
                    onClick={() => setRecurrence(opt.value)}
                    style={{
                      flex: 1, padding: '10px 8px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                      border: recurrence === opt.value ? '2px solid #1b6b5a' : '1px solid #e0e0e0',
                      background: recurrence === opt.value ? '#e8f5e9' : '#fff',
                      color: recurrence === opt.value ? '#1b6b5a' : '#666',
                      cursor: 'pointer',
                    }}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {recurrence !== 'none' && (
              <div className="modal-section">
                <label className="modal-label">For how many weeks?</label>
                <select className="modal-select" value={recurrenceWeeks} onChange={(e) => setRecurrenceWeeks(e.target.value)}>
                  <option value="2">2 weeks</option>
                  <option value="4">4 weeks</option>
                  <option value="6">6 weeks</option>
                  <option value="8">8 weeks</option>
                  <option value="12">12 weeks</option>
                </select>
                <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                  This will create {recurrenceWeeks} {recurrence === 'weekly' ? 'weekly' : 'biweekly'} sessions starting {date || 'on the selected date'}.
                </div>
              </div>
            )}
            {/* Short-notice rush banner */}
            {date && time && shortNotice && (
              <div style={{ background: '#fff3e0', border: '1px solid #ffcc80', borderRadius: 8, padding: '10px 14px', marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 18 }}>⚡</span>
                <div style={{ fontSize: 13, color: '#e65100' }}>
                  <strong>Short notice — 20% rush surcharge applies.</strong>
                  <div style={{ color: '#795548', marginTop: 2 }}>Sessions booked less than 24 hours out include a surcharge. Schedule further ahead to avoid this.</div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Caregiver selection step (now step 2) */}
        {step === caregiverStep && hasCaregiverData && (
          <div className="modal-section">
            <label className="modal-label">Caregivers for {formatTime12(time)} on {date}</label>
            {loadingCaregivers ? (
              <div style={{ padding: 30, textAlign: 'center', color: '#999' }}>
                <div style={{ marginBottom: 8 }}>Checking caregiver availability...</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                {matchedCaregivers.length > 0 ? matchedCaregivers.map((cg, idx) => (
                  <button key={idx}
                    onClick={() => setSelectedCaregiver(cg)}
                    style={{
                      padding: 14, border: selectedCaregiver?.name === cg.name ? '2px solid #1b6b5a' : '1px solid #e0e0e0',
                      borderRadius: 10, background: selectedCaregiver?.name === cg.name ? '#e8f5e9' : '#fff',
                      cursor: 'pointer', textAlign: 'left',
                    }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 15, color: '#1a1a2e' }}>{cg.name}</div>
                        <div style={{ fontSize: 13, color: '#666', marginTop: 2 }}>{(cg.skills || []).join(', ')}</div>
                        <div style={{ fontSize: 13, color: '#1b6b5a', fontWeight: 500, marginTop: 2 }}>{cg.rate}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        {cg.available && cg.skillMatch && (
                          <span style={{ background: '#e8f5e9', color: '#1b6b5a', padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>Best Match</span>
                        )}
                        {cg.available && !cg.skillMatch && (
                          <span style={{ background: '#fff8e1', color: '#f57f17', padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>Available</span>
                        )}
                        {!cg.available && (
                          <span style={{ background: '#fff8e1', color: '#e65100', padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>Not Scheduled</span>
                        )}
                      </div>
                    </div>
                    {!cg.available && (
                      <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>{cg.reason || 'Not on schedule — can still accept if available'}</div>
                    )}
                  </button>
                )) : (
                  <div style={{ padding: 20, textAlign: 'center', color: '#999' }}>
                    <p>No assigned caregivers found.</p>
                    <p style={{ fontSize: 13 }}>You can still post this as an open request below.</p>
                  </div>
                )}

                {/* Skip / post as open option */}
                <button
                  onClick={() => { setSelectedCaregiver(null); setStep(reviewStep); }}
                  style={{
                    padding: 12, border: '1px dashed #e8724a', borderRadius: 10, background: '#fff8f0',
                    cursor: 'pointer', textAlign: 'center', fontSize: 14, color: '#e8724a', fontWeight: 600,
                  }}>
                  Skip — post as open request
                  <div style={{ fontSize: 12, fontWeight: 400, color: '#999', marginTop: 2 }}>Any caregiver on InPlace can respond</div>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Review step */}
        {step === reviewStep && (
          <>
            <div className="modal-section">
              <label className="modal-label">Special Instructions (optional)</label>
              <textarea className="modal-textarea" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Any special notes for the caregiver..." rows={3}></textarea>
            </div>
            {selectedCaregiver && !selectedCaregiver.available && (
              <div style={{ background: '#fff8e1', border: '1px solid #ffc107', borderRadius: 10, padding: '12px 16px', marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 20 }}>⭐</span>
                <div style={{ fontSize: 13 }}>
                  <strong>Direct Offer</strong> — {selectedCaregiver.name} will get a 1-hour exclusive window to accept before this opens to other caregivers.
                </div>
              </div>
            )}
            <div style={{ background: '#f8f9fa', padding: 16, borderRadius: 10, marginTop: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: '#1b6b5a' }}>Booking Summary</div>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px 12px', fontSize: 14 }}>
                <div style={{ color: '#666' }}>Service</div><div>{serviceType.replace('_', ' ')}</div>
                <div style={{ color: '#666' }}>Date</div><div>{date}</div>
                <div style={{ color: '#666' }}>Time</div><div>{formatTime12(time)}</div>
                <div style={{ color: '#666' }}>Duration</div><div>{duration} hour(s)</div>
                {recurrence !== 'none' && (
                  <><div style={{ color: '#666' }}>Repeat</div><div style={{ fontWeight: 600, color: '#1b6b5a' }}>{recurrence === 'weekly' ? 'Weekly' : 'Every 2 weeks'} for {recurrenceWeeks} sessions</div></>
                )}
                {selectedCaregiver ? (
                  <><div style={{ color: '#666' }}>Caregiver</div><div style={{ fontWeight: 600 }}>{selectedCaregiver.name}{!selectedCaregiver.available ? ' (not on schedule — will be offered)' : ''}</div></>
                ) : (
                  <><div style={{ color: '#666' }}>Status</div><div style={{ fontWeight: 600, color: '#e8724a' }}>Open — waiting for caregiver</div></>
                )}
              </div>

              {/* Rate nudge when caregiver isn't on schedule */}
              {selectedCaregiver && !selectedCaregiver.available && (
                <div style={{ marginTop: '12px', padding: '12px', background: '#fff3e0', borderRadius: '8px', border: '1px solid #ffcc02', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 18 }}>💡</span>
                  <div style={{ fontSize: 13, color: '#795548' }}>
                    <strong>{selectedCaregiver.name}</strong> isn't on schedule for this time. A higher rate makes it more likely they'll accept.
                    {localAvgRate && (
                      <button type="button" onClick={() => setProposedRate(String(Math.round(localAvgRate * 1.25)))}
                        style={{ display: 'inline', marginLeft: 6, background: 'none', border: 'none', color: '#e8724a', fontWeight: 700, cursor: 'pointer', fontSize: 13, textDecoration: 'underline', padding: 0 }}>
                        Bump to ${Math.round(localAvgRate * 1.25)}/hr (+25%)
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Your offered rate — ON TOP of cost breakdown, pre-filled with local avg */}
              <div style={{ marginTop: '12px', padding: '12px', background: '#fff', borderRadius: '8px', border: selectedCaregiver && !selectedCaregiver.available ? '2px solid #e8724a' : '1px solid #e0e0e0' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#333', marginBottom: '8px' }}>Your Offered Rate</div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '16px', color: '#666', fontWeight: 600 }}>$</span>
                  <input type="number" step="1" min="15" max="500"
                    value={proposedRate}
                    onChange={e => setProposedRate(e.target.value)}
                    placeholder={localAvgRate ? String(localAvgRate) : '25'}
                    style={{ width: '80px', padding: '8px 10px', borderRadius: '8px', border: selectedCaregiver && !selectedCaregiver.available ? '2px solid #e8724a' : '2px solid #1b6b5a', fontSize: '16px', fontWeight: 600, textAlign: 'center' }}
                  />
                  <span style={{ fontSize: '14px', color: '#888' }}>/hr</span>
                  {proposedRate && duration && (
                    <span style={{ fontSize: '15px', fontWeight: 700, color: '#1b6b5a', marginLeft: 4 }}>
                      = ${(parseFloat(proposedRate) * parseInt(duration)).toFixed(0)} total
                    </span>
                  )}
                </div>
                {localAvgRate && (
                  <div style={{ fontSize: '11px', color: '#888', marginTop: '6px' }}>
                    Based on local caregiver rates for this time of day (avg ${localAvgRate}/hr)
                  </div>
                )}
                {shortNotice && (
                  <div style={{ fontSize: '11px', color: '#e8724a', marginTop: '4px', fontWeight: 500 }}>
                    ⚡ Short notice — 20% surcharge will be added below
                  </div>
                )}
              </div>

              {/* Cost Breakdown — recalculates live from offered rate */}
              {displayCost && (
                <div style={{ marginTop: '12px', padding: '12px', background: '#fff', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#333', marginBottom: '8px' }}>Cost Breakdown</div>

                  {/* Caregiver rates section */}
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Caregiver rates</div>
                  {displayCost.tierBreakdown?.map((t, i) => {
                    const tierLabel = t.tier === 'daytime' ? 'Daytime (7a\u20136p)' : t.tier === 'nighttime' ? 'Evening (6p\u201312a)' : 'Overnight (12a\u20137a)';
                    return (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#555', marginBottom: '3px' }}>
                        <span>{t.hours}h {tierLabel} @ ${t.rate}/hr</span>
                        <span>${t.amount.toFixed(2)}</span>
                      </div>
                    );
                  })}
                  {displayCost.tierBreakdown?.some(t => t.tier === 'overnight') && (
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px', fontStyle: 'italic' }}>
                      Overnight minimum: {displayCost.overnightMinHours || 6}h (set by caregiver)
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#1b6b5a', fontWeight: 600, marginBottom: '3px', borderTop: '1px solid #f0f0f0', paddingTop: '4px', marginTop: '4px' }}>
                    <span>Caregiver receives</span>
                    <span>${(displayCost.caregiverPayout || displayCost.subtotal).toFixed(2)}</span>
                  </div>

                  {/* Platform fees section */}
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '10px', marginBottom: '4px' }}>Platform fees</div>
                  {displayCost.platformFee > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#888', marginBottom: '3px' }}>
                      <span>InPlace service fee ({displayCost.platformFeePercent || 20}%)</span>
                      <span>${((displayCost.platformFee || 0) - (displayCost.surchargeBreakdown?.platform || 0)).toFixed(2)}</span>
                    </div>
                  )}
                  {displayCost.surcharge > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#e8724a', fontWeight: 500, marginBottom: '3px' }}>
                      <span>{'\u26A1'} Rush fee (&lt;24hr notice, 20%)</span>
                      <span>+${displayCost.surcharge.toFixed(2)}</span>
                    </div>
                  )}
                  {!displayCost.platformFee && !displayCost.surcharge && (
                    <div style={{ fontSize: '12px', color: '#aaa', marginBottom: '3px' }}>No additional fees</div>
                  )}

                  {/* Total */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', fontWeight: 700, color: '#1b6b5a', borderTop: '1px solid #eee', paddingTop: '6px', marginTop: '6px' }}>
                    <span>You pay</span>
                    <span>${(displayCost.familyTotal || displayCost.total).toFixed(2)}</span>
                  </div>
                  {displayCost.shortNotice && (
                    <div style={{ fontSize: '11px', color: '#e8724a', marginTop: '4px' }}>
                      {'\u26A1'} Rush fee applies to sessions booked less than 24 hours out. Schedule earlier to avoid this.
                    </div>
                  )}
                </div>
              )}
            </div>
            {!selectedCaregiver && (
              <div style={{ marginTop: 12, padding: 12, background: '#fff8e1', borderRadius: 8, fontSize: 13, color: '#795548' }}>
                {hasCaregiverData
                  ? 'This will be posted as an open request. Any caregiver on InPlace — including your assigned caregivers — can respond.'
                  : 'Your care request will be posted as "open." When caregivers join InPlace in your area, they\'ll be able to respond to your request.'
                }
              </div>
            )}
          </>
        )}

        {submitError && (
          <div style={{ marginTop: 12, padding: 10, background: '#fce4ec', borderRadius: 8, fontSize: 13, color: '#c62828' }}>
            {submitError}
          </div>
        )}
        <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
          <button className="btn btn-outline" onClick={() => step > 1 ? setStep(step - 1) : onClose()} >
            {step === 1 ? 'Cancel' : 'Back'}
          </button>
          {step < reviewStep && step !== caregiverStep && (
            <button className="btn btn-primary" disabled={
              (step === 1 && (!serviceType || !date || !time || !duration || (careRecipients.length > 1 && !selectedRecipientId)))
            } onClick={() => {
              const nextStep = step + 1;
              setStep(nextStep);
            }}>Next</button>
          )}
          {step === caregiverStep && hasCaregiverData && (
            <button className="btn btn-primary" disabled={loadingCaregivers}
              onClick={() => setStep(reviewStep)}>{selectedCaregiver ? 'Continue' : 'Continue as Open'}</button>
          )}
          {step === reviewStep && <button className="btn btn-primary" onClick={handleSubmit}>
            {selectedCaregiver ? (selectedCaregiver.available ? 'Confirm Booking' : 'Send Offer') : 'Post Care Request'}
          </button>}
        </div>
      </div>
    </div>
  );
};
