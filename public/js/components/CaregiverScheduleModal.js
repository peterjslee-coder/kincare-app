const CaregiverScheduleModal = window.CaregiverScheduleModal = ({ caregiver, onClose, onBooked }) => {
  const [selectedDay, setSelectedDay] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [serviceType, setServiceType] = useState('');
  const [duration, setDuration] = useState('1');
  const [instructions, setInstructions] = useState('');
  const [bookingStep, setBookingStep] = useState('calendar'); // 'calendar', 'details', 'confirm'
  const [slotsMap, setSlotsMap] = useState({}); // { 'YYYY-MM-DD': [{start, end, startMinutes}] }
  const [loadingSlots, setLoadingSlots] = useState(true);

  const days = getNextSevenDays();

  // Resolve caregiver profile ID — prop may have id or caregiver_profile_id
  const caregiverId = caregiver.caregiver_profile_id || caregiver.id;

  // Hourly rate from caregiver prop (DB-driven) or fallback
  const hourlyRate = caregiver.hourly_rate
    ? parseFloat(caregiver.hourly_rate)
    : (CAREGIVER_AVAILABILITY[caregiver.name]?.rate
      ? parseInt(CAREGIVER_AVAILABILITY[caregiver.name].rate.replace(/[^0-9]/g, ''))
      : 30);

  // Specialties display
  const specialtiesText = (() => {
    if (caregiver.specialties) {
      try {
        const parsed = typeof caregiver.specialties === 'string' ? JSON.parse(caregiver.specialties) : caregiver.specialties;
        if (Array.isArray(parsed)) return parsed.join(', ');
      } catch (e) {}
      return String(caregiver.specialties);
    }
    const avail = CAREGIVER_AVAILABILITY[caregiver.name];
    return avail ? avail.skills.join(', ') : '';
  })();

  // Fetch 7 days of slots from API on mount
  useEffect(() => {
    const fetchSlots = async () => {
      setLoadingSlots(true);
      try {
        const startDate = days[0].date;
        const res = await apiFetch(`/api/availability/${caregiverId}/slots?date=${startDate}&days=7`);
        if (res && res.ok) {
          const data = await res.json();
          setSlotsMap(data.slots || {});
        } else {
          // Fallback to hardcoded data if API fails
          const fallbackMap = {};
          days.forEach(day => {
            const daySlots = getAvailableSlots(caregiver.name, day);
            fallbackMap[day.date] = daySlots.filter(s => !s.booked).map(s => ({
              start: s.start,
              end: s.end,
              startMinutes: s.startMin,
            }));
          });
          setSlotsMap(fallbackMap);
        }
      } catch (err) {
        console.error('Failed to fetch slots:', err);
        // Fallback
        const fallbackMap = {};
        days.forEach(day => {
          const daySlots = getAvailableSlots(caregiver.name, day);
          fallbackMap[day.date] = daySlots.filter(s => !s.booked).map(s => ({
            start: s.start,
            end: s.end,
            startMinutes: s.startMin,
          }));
        });
        setSlotsMap(fallbackMap);
      }
      setLoadingSlots(false);
    };
    fetchSlots();
  }, [caregiverId]);

  // Get slots for a specific day from the map
  const getSlotsForDay = (day) => {
    const daySlots = slotsMap[day.date] || [];
    return daySlots;
  };

  const selectedDaySlots = selectedDay ? getSlotsForDay(selectedDay) : [];

  // Format time from 24h "HH:MM" to 12h "H:MM AM/PM"
  const formatTime = (timeStr) => {
    if (!timeStr) return '';
    // If already in AM/PM format, return as-is
    if (timeStr.includes('AM') || timeStr.includes('PM')) return timeStr;
    const [h, m] = timeStr.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${displayH}:${String(m).padStart(2, '0')} ${ampm}`;
  };

  const handleBook = () => {
    alert(`Booking confirmed!\n\n${caregiver.name || caregiver.first_name + ' ' + caregiver.last_name}\n${selectedDay.label} ${selectedDay.shortDate}\n${formatTime(selectedSlot.start)} - ${duration} hr(s)\nService: ${serviceType}\n\nYou'll receive a confirmation shortly.`);
    if (onBooked) onBooked();
    onClose();
  };

  const displayName = caregiver.name || `${caregiver.first_name || ''} ${caregiver.last_name || ''}`.trim();
  const initials = displayName.split(' ').map(n => n[0]).join('');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520, maxHeight: '90vh', overflow: 'auto' }}>
        <button className="modal-close" onClick={onClose}>✕</button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#1b6b5a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700 }}>
            {initials}
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a2e' }}>Schedule {displayName.split(' ')[0]}</div>
            <div style={{ fontSize: 13, color: '#666' }}>${hourlyRate}/hr{specialtiesText ? ` • ${specialtiesText}` : ''}</div>
          </div>
        </div>

        {bookingStep === 'calendar' && (
          <>
            {loadingSlots ? (
              <div style={{ textAlign: 'center', padding: '30px 0' }}>
                <div className="loading-spinner" style={{ margin: '0 auto 12px' }}></div>
                <div style={{ fontSize: 14, color: '#666' }}>Loading availability...</div>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a2e', marginBottom: 10 }}>Select a day</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {days.map(day => {
                      const daySlots = getSlotsForDay(day);
                      const isOff = daySlots.length === 0;
                      const isSelected = selectedDay?.date === day.date;
                      return (
                        <button key={day.date} onClick={() => { if (!isOff) { setSelectedDay(day); setSelectedSlot(null); }}}
                          style={{
                            flex: '1 1 0', minWidth: 70, padding: '10px 4px', border: isSelected ? '2px solid #1b6b5a' : '1px solid #e0e0e0',
                            borderRadius: 10, background: isOff ? '#f5f5f5' : isSelected ? '#e8f5e9' : '#fff',
                            cursor: isOff ? 'not-allowed' : 'pointer', opacity: isOff ? 0.5 : 1, textAlign: 'center',
                          }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#666' }}>{day.label}</div>
                          <div style={{ fontSize: 11, color: '#999' }}>{day.shortDate}</div>
                          <div style={{ fontSize: 11, color: isOff ? '#ccc' : '#1b6b5a', fontWeight: 600, marginTop: 4 }}>
                            {isOff ? 'Off' : `${daySlots.length} slots`}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {selectedDay && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a2e', marginBottom: 10 }}>
                      Available times — {selectedDay.label} {selectedDay.shortDate}
                    </div>
                    {selectedDaySlots.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: 20, color: '#999', fontSize: 14 }}>
                        No available slots this day
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                        {selectedDaySlots.map((slot, idx) => (
                          <button key={idx}
                            onClick={() => setSelectedSlot(slot)}
                            style={{
                              padding: '10px 6px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                              border: selectedSlot?.start === slot.start ? '2px solid #1b6b5a' : '1px solid #e0e0e0',
                              background: selectedSlot?.start === slot.start ? '#e8f5e9' : '#fff',
                              color: '#1a1a2e',
                            }}>
                            {formatTime(slot.start)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
              <button className="btn btn-outline" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" disabled={!selectedSlot} onClick={() => setBookingStep('details')}>
                Continue
              </button>
            </div>
          </>
        )}

        {bookingStep === 'details' && (
          <>
            <div style={{ background: '#f0faf7', padding: 14, borderRadius: 10, marginBottom: 16, fontSize: 14 }}>
              <strong>{selectedDay.label} {selectedDay.shortDate}</strong> at <strong>{formatTime(selectedSlot.start)}</strong>
            </div>
            <div className="modal-section">
              <label className="modal-label">Service Type</label>
              <select className="modal-select" value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
                <option value="">Select...</option>
                <option value="companionship">Companionship</option>
                <option value="personal_care">Personal Care</option>
                <option value="housekeeping">Light Housekeeping</option>
                <option value="meal_prep">Meal Preparation</option>
                <option value="transportation">Transportation</option>
                <option value="health_wellness">Health & Wellness</option>
              </select>
            </div>
            <div className="modal-section">
              <label className="modal-label">Duration</label>
              <select className="modal-select" value={duration} onChange={(e) => setDuration(e.target.value)}>
                <option value="1">1 hour</option>
                <option value="2">2 hours</option>
                <option value="3">3 hours</option>
                <option value="4">4 hours</option>
                <option value="6">6 hours</option>
              </select>
            </div>
            <div className="modal-section">
              <label className="modal-label">Special Instructions (optional)</label>
              <textarea className="modal-textarea" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Any notes for the caregiver..." rows={3}></textarea>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
              <button className="btn btn-outline" onClick={() => setBookingStep('calendar')}>Back</button>
              <button className="btn btn-primary" disabled={!serviceType} onClick={() => setBookingStep('confirm')}>Review Booking</button>
            </div>
          </>
        )}

        {bookingStep === 'confirm' && (
          <>
            <div style={{ background: '#f8f9fa', padding: 16, borderRadius: 10, marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: '#1b6b5a' }}>Booking Summary</div>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px 12px', fontSize: 14 }}>
                <div style={{ color: '#666' }}>Caregiver</div><div style={{ fontWeight: 600 }}>{displayName}</div>
                <div style={{ color: '#666' }}>Date</div><div>{selectedDay.label} {selectedDay.shortDate}</div>
                <div style={{ color: '#666' }}>Time</div><div>{formatTime(selectedSlot.start)}</div>
                <div style={{ color: '#666' }}>Duration</div><div>{duration} hour(s)</div>
                <div style={{ color: '#666' }}>Service</div><div>{serviceType.replace('_', ' ')}</div>
                <div style={{ color: '#666' }}>Est. Cost</div><div style={{ fontWeight: 600, color: '#1b6b5a' }}>${hourlyRate * parseInt(duration)}</div>
                {instructions && <><div style={{ color: '#666' }}>Notes</div><div>{instructions}</div></>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
              <button className="btn btn-outline" onClick={() => setBookingStep('details')}>Back</button>
              <button className="btn btn-primary" onClick={handleBook}>Confirm Booking</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
