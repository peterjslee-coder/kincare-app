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
  const [proposingRate, setProposingRate] = useState(false);
  const [proposedRate, setProposedRate] = useState('');

  // Fetch assigned caregivers on mount to determine if step 4 is needed
  useEffect(() => {
    const fetchAssignments = async () => {
      try {
        const res = await apiFetch('/api/assignments');
        if (res?.ok) {
          const data = await res.json();
          setAssignedCaregivers(data.assignments || []);
        } else {
          setAssignedCaregivers([]);
        }
      } catch (err) {
        console.error('Failed to fetch assignments:', err);
        setAssignedCaregivers([]);
      }
    };
    fetchAssignments();
  }, []);

  // Check if user has assigned caregivers
  const hasCaregiverData = assignedCaregivers !== null && assignedCaregivers.length > 0;
  const totalSteps = hasCaregiverData ? 5 : 4;
  const stepLabels = hasCaregiverData
    ? ['Service', 'When', 'Duration', 'Caregiver', 'Review']
    : ['Service', 'When', 'Duration', 'Review'];
  const reviewStep = hasCaregiverData ? 5 : 4;
  const caregiverStep = hasCaregiverData ? 4 : -1; // -1 = skip

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
    const isOpenRequest = !hasCaregiverData || !selectedCaregiver;
    const recurrenceLabel = recurrence !== 'none' ? ` (${recurrence}, ${recurrenceWeeks} sessions)` : '';
    const response = await apiFetch('/api/request-care', {
      method: 'POST',
      body: JSON.stringify({
        serviceType, date, time, duration, specialInstructions: instructions,
        caregiver: selectedCaregiver?.name,
        status: isOpenRequest ? 'open' : undefined,
        recurrenceRule: recurrence !== 'none' ? recurrence : undefined,
        recurrenceWeeks: recurrence !== 'none' ? parseInt(recurrenceWeeks) : undefined,
      })
    });
    if (isOpenRequest) {
      alert(`Care request posted!${recurrenceLabel}\n\nStatus: Open — waiting for caregiver match\n${date} at ${time}\n${duration} hour(s) of ${serviceType.replace('_', ' ')}`);
    } else {
      alert(`Care request submitted!${recurrenceLabel}\n\n${selectedCaregiver ? selectedCaregiver.name + ' assigned' : 'Best available caregiver will be assigned'}\n${date} at ${time}\n${duration} hour(s) of ${serviceType.replace('_', ' ')}`);
    }
    onClose();
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
        )}

        {step === 2 && (
          <>
            <div className="modal-section">
              <label className="modal-label">Date</label>
              <input type="date" className="modal-input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="modal-section">
              <label className="modal-label">Preferred Start Time</label>
              <input type="time" className="modal-input" value={time} onChange={(e) => setTime(e.target.value)} />
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
          </>
        )}

        {step === 3 && (
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
        )}

        {/* Caregiver selection step */}
        {step === caregiverStep && hasCaregiverData && (
          <div className="modal-section">
            <label className="modal-label">Available caregivers for {formatTime12(time)} on {date}</label>
            {loadingCaregivers ? (
              <div style={{ padding: 30, textAlign: 'center', color: '#999' }}>
                <div style={{ marginBottom: 8 }}>Checking caregiver availability...</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                {matchedCaregivers.length > 0 ? matchedCaregivers.map((cg, idx) => (
                  <button key={idx} disabled={!cg.available}
                    onClick={() => cg.available && setSelectedCaregiver(cg)}
                    style={{
                      padding: 14, border: selectedCaregiver?.name === cg.name ? '2px solid #1b6b5a' : '1px solid #e0e0e0',
                      borderRadius: 10, background: !cg.available ? '#f9f9f9' : selectedCaregiver?.name === cg.name ? '#e8f5e9' : '#fff',
                      cursor: cg.available ? 'pointer' : 'not-allowed', textAlign: 'left', opacity: cg.available ? 1 : 0.6,
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
                          <span style={{ background: '#fce4ec', color: '#c62828', padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>Unavailable</span>
                        )}
                      </div>
                    </div>
                    {!cg.available && cg.reason && (
                      <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>{cg.reason}</div>
                    )}
                  </button>
                )) : (
                  <div style={{ padding: 20, textAlign: 'center', color: '#999' }}>
                    <p>No caregivers found for this time slot.</p>
                    <p style={{ fontSize: 13 }}>Try adjusting the date or time.</p>
                  </div>
                )}
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
                {hasCaregiverData ? (
                  <><div style={{ color: '#666' }}>Caregiver</div><div style={{ fontWeight: 600 }}>{selectedCaregiver ? selectedCaregiver.name : 'Best available'}</div></>
                ) : (
                  <><div style={{ color: '#666' }}>Status</div><div style={{ fontWeight: 600, color: '#e8724a' }}>Open — waiting for caregiver</div></>
                )}
              </div>

              {/* Cost Breakdown */}
              {costPreview && (
                <div style={{ marginTop: '12px', padding: '10px', background: '#fff', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#333', marginBottom: '6px' }}>Cost Breakdown</div>
                  {costPreview.tierBreakdown?.map((t, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#555', marginBottom: '3px' }}>
                      <span>{t.hours}h {t.tier} @ ${t.rate}/hr</span>
                      <span>${t.amount.toFixed(2)}</span>
                    </div>
                  ))}
                  {costPreview.surcharge > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#e8724a', marginBottom: '3px' }}>
                      <span>Short-notice surcharge (20%)</span>
                      <span>+${costPreview.surcharge.toFixed(2)}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', fontWeight: 700, color: '#1b6b5a', borderTop: '1px solid #eee', paddingTop: '6px', marginTop: '4px' }}>
                    <span>Total</span>
                    <span>${costPreview.total.toFixed(2)}</span>
                  </div>
                  {costPreview.shortNotice && (
                    <div style={{ fontSize: '11px', color: '#e8724a', marginTop: '4px' }}>
                      Sessions booked &lt;24 hours out include a 20% surcharge. Schedule earlier to avoid this.
                    </div>
                  )}
                </div>
              )}

              {/* Propose different rate */}
              {selectedCaregiver && (
                <div style={{ marginTop: '10px' }}>
                  {!proposingRate ? (
                    <button onClick={() => setProposingRate(true)} style={{
                      background: 'none', border: 'none', color: '#1b6b5a', cursor: 'pointer',
                      fontSize: '13px', textDecoration: 'underline', padding: 0,
                    }}>
                      Propose a different rate?
                    </button>
                  ) : (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span style={{ fontSize: '13px', color: '#666' }}>$</span>
                      <input type="number" step="0.50" min="1" max="500"
                        value={proposedRate}
                        onChange={e => setProposedRate(e.target.value)}
                        placeholder="Your rate/hr"
                        style={{ width: '90px', padding: '5px 8px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '13px' }}
                      />
                      <span style={{ fontSize: '12px', color: '#888' }}>/hr</span>
                      <button onClick={() => setProposingRate(false)} style={{
                        background: 'none', border: 'none', color: '#999', cursor: 'pointer', fontSize: '12px',
                      }}>cancel</button>
                    </div>
                  )}
                </div>
              )}
            </div>
            {!hasCaregiverData && (
              <div style={{ marginTop: 12, padding: 12, background: '#fff8e1', borderRadius: 8, fontSize: 13, color: '#795548' }}>
                Your care request will be posted as "open." When caregivers join InPlace in your area, they'll be able to respond to your request.
              </div>
            )}
          </>
        )}

        <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
          <button className="btn btn-outline" onClick={() => step > 1 ? setStep(step - 1) : onClose()} >
            {step === 1 ? 'Cancel' : 'Back'}
          </button>
          {step < reviewStep && step !== caregiverStep && (
            <button className="btn btn-primary" disabled={
              (step === 1 && !serviceType) || (step === 2 && (!date || !time)) || (step === 3 && !duration)
            } onClick={() => {
              const nextStep = step + 1;
              setStep(nextStep);
            }}>Next</button>
          )}
          {step === caregiverStep && hasCaregiverData && (
            <button className="btn btn-primary" disabled={!selectedCaregiver || loadingCaregivers}
              onClick={() => setStep(reviewStep)}>Continue</button>
          )}
          {step === reviewStep && <button className="btn btn-primary" onClick={handleSubmit}>
            {hasCaregiverData ? 'Confirm Booking' : 'Post Care Request'}
          </button>}
        </div>
      </div>
    </div>
  );
};
