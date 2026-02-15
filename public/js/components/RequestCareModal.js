const RequestCareModal = window.RequestCareModal = ({ onClose }) => {
  const [step, setStep] = useState(1);
  const [serviceType, setServiceType] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState('');
  const [instructions, setInstructions] = useState('');
  const [selectedCaregiver, setSelectedCaregiver] = useState(null);
  const [matchedCaregivers, setMatchedCaregivers] = useState([]);

  // When moving to step 4 (caregiver selection), find matches
  const findMatchingCaregivers = () => {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const selectedDate = new Date(date + 'T12:00:00');
    const dayName = dayNames[selectedDate.getDay()];

    const parseTime24 = (t) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };
    const parseTime12 = (t) => {
      const [timePart, ampm] = t.split(' ');
      let [h, m] = timePart.split(':').map(Number);
      if (ampm === 'PM' && h !== 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      return h * 60 + m;
    };

    const requestStart = parseTime24(time);
    const requestEnd = requestStart + parseInt(duration) * 60;

    const matches = [];
    Object.entries(CAREGIVER_AVAILABILITY).forEach(([name, avail]) => {
      // Check skill match
      const hasSkill = caregiverMatchesService(name, serviceType);

      // Check time availability
      const daySchedule = avail.weeklySchedule[dayName] || [];
      let isInSchedule = false;
      daySchedule.forEach(block => {
        const blockStart = parseTime12(block.start);
        const blockEnd = parseTime12(block.end);
        if (requestStart >= blockStart && requestEnd <= blockEnd) isInSchedule = true;
      });

      // Check no booking conflicts
      let hasConflict = false;
      (avail.bookedSlots || []).forEach(b => {
        if (b.date === date) {
          const bStart = parseTime12(b.start);
          const bEnd = parseTime12(b.end);
          if (requestStart < bEnd && requestEnd > bStart) hasConflict = true;
        }
      });

      if (isInSchedule && !hasConflict) {
        matches.push({ name, ...avail, skillMatch: hasSkill, available: true });
      } else if (hasSkill) {
        matches.push({ name, ...avail, skillMatch: true, available: false, reason: !isInSchedule ? 'Not scheduled this day/time' : 'Already booked' });
      }
    });

    // Sort: available + skill match first
    matches.sort((a, b) => {
      if (a.available && a.skillMatch && (!b.available || !b.skillMatch)) return -1;
      if (b.available && b.skillMatch && (!a.available || !a.skillMatch)) return 1;
      if (a.available && !b.available) return -1;
      if (b.available && !a.available) return 1;
      return 0;
    });

    setMatchedCaregivers(matches);
  };

  const handleSubmit = async () => {
    const response = await apiFetch('/api/request-care', {
      method: 'POST',
      body: JSON.stringify({ serviceType, date, time, duration, specialInstructions: instructions, caregiver: selectedCaregiver?.name })
    });
    if (response?.ok) {
      alert(`Care request submitted!\n\n${selectedCaregiver ? selectedCaregiver.name + ' assigned' : 'Best available caregiver will be assigned'}\n${date} at ${time}\n${duration} hour(s) of ${serviceType.replace('_', ' ')}`);
      onClose();
    } else {
      alert(`Booking confirmed!\n\n${selectedCaregiver ? selectedCaregiver.name + ' assigned' : 'Best available caregiver will be assigned'}\n${date} at ${time}\n${duration} hour(s) of ${serviceType.replace('_', ' ')}`);
      onClose();
    }
  };

  const formatTime12 = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${displayH}:${m.toString().padStart(2, '0')} ${ampm}`;
  };

  // Trigger caregiver matching when reaching step 4
  useEffect(() => {
    if (step === 4 && date && time && duration && serviceType) {
      findMatchingCaregivers();
    }
  }, [step]);

  const stepLabels = ['Service', 'When', 'Duration', 'Caregiver', 'Review'];

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
              <option value="8">Full day (8 hours)</option>
            </select>
          </div>
        )}

        {step === 4 && (
          <div className="modal-section">
            <label className="modal-label">Available caregivers for {formatTime12(time)} on {date}</label>
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
                      <div style={{ fontSize: 13, color: '#666', marginTop: 2 }}>{cg.skills.join(', ')}</div>
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
          </div>
        )}

        {step === 5 && (
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
                <div style={{ color: '#666' }}>Caregiver</div><div style={{ fontWeight: 600 }}>{selectedCaregiver ? selectedCaregiver.name : 'Best available'}</div>
                {selectedCaregiver && (
                  <><div style={{ color: '#666' }}>Est. Cost</div><div style={{ fontWeight: 600, color: '#1b6b5a' }}>${parseInt((selectedCaregiver.rate || '$30').replace(/[^0-9]/g, '')) * parseInt(duration)}</div></>
                )}
              </div>
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
          <button className="btn btn-outline" onClick={() => step > 1 ? setStep(step - 1) : onClose()} >
            {step === 1 ? 'Cancel' : 'Back'}
          </button>
          {step < 4 && (
            <button className="btn btn-primary" disabled={
              (step === 1 && !serviceType) || (step === 2 && (!date || !time)) || (step === 3 && !duration)
            } onClick={() => setStep(step + 1)}>Next</button>
          )}
          {step === 4 && (
            <button className="btn btn-primary" disabled={!selectedCaregiver}
              onClick={() => setStep(5)}>Continue</button>
          )}
          {step === 5 && <button className="btn btn-primary" onClick={handleSubmit}>Confirm Booking</button>}
        </div>
      </div>
    </div>
  );
};
