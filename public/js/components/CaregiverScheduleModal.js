const CaregiverScheduleModal = window.CaregiverScheduleModal = ({ caregiver, onClose, onBooked }) => {
  const [selectedDay, setSelectedDay] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [serviceType, setServiceType] = useState('');
  const [duration, setDuration] = useState('1');
  const [instructions, setInstructions] = useState('');
  const [bookingStep, setBookingStep] = useState('calendar'); // 'calendar', 'details', 'confirm'

  const days = getNextSevenDays();
  const avail = CAREGIVER_AVAILABILITY[caregiver.name];
  const selectedDaySlots = selectedDay ? getAvailableSlots(caregiver.name, selectedDay) : [];

  const handleBook = () => {
    alert(`Booking confirmed!\n\n${caregiver.name}\n${selectedDay.label} ${selectedDay.shortDate}\n${selectedSlot.start} - ${duration} hr(s)\nService: ${serviceType}\n\nYou'll receive a confirmation shortly.`);
    if (onBooked) onBooked();
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520, maxHeight: '90vh', overflow: 'auto' }}>
        <button className="modal-close" onClick={onClose}>✕</button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#1b6b5a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700 }}>
            {caregiver.name.split(' ').map(n => n[0]).join('')}
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a2e' }}>Schedule {caregiver.name.split(' ')[0]}</div>
            <div style={{ fontSize: 13, color: '#666' }}>{avail ? avail.rate : '$30/hr'} • {avail ? avail.skills.join(', ') : caregiver.specialties}</div>
          </div>
        </div>

        {bookingStep === 'calendar' && (
          <>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a2e', marginBottom: 10 }}>Select a day</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {days.map(day => {
                  const daySlots = getAvailableSlots(caregiver.name, day);
                  const freeSlots = daySlots.filter(s => !s.booked);
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
                        {isOff ? 'Off' : `${freeSlots.length} slots`}
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {selectedDaySlots.map((slot, idx) => (
                    <button key={idx} disabled={slot.booked}
                      onClick={() => setSelectedSlot(slot)}
                      style={{
                        padding: '10px 6px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: slot.booked ? 'not-allowed' : 'pointer',
                        border: selectedSlot?.start === slot.start ? '2px solid #1b6b5a' : '1px solid #e0e0e0',
                        background: slot.booked ? '#fee' : selectedSlot?.start === slot.start ? '#e8f5e9' : '#fff',
                        color: slot.booked ? '#c44' : '#1a1a2e', textDecoration: slot.booked ? 'line-through' : 'none',
                      }}>
                      {slot.start}
                      {slot.booked && <div style={{ fontSize: 10, color: '#c44' }}>Booked</div>}
                    </button>
                  ))}
                </div>
              </div>
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
              <strong>{selectedDay.label} {selectedDay.shortDate}</strong> at <strong>{selectedSlot.start}</strong>
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
                <div style={{ color: '#666' }}>Caregiver</div><div style={{ fontWeight: 600 }}>{caregiver.name}</div>
                <div style={{ color: '#666' }}>Date</div><div>{selectedDay.label} {selectedDay.shortDate}</div>
                <div style={{ color: '#666' }}>Time</div><div>{selectedSlot.start}</div>
                <div style={{ color: '#666' }}>Duration</div><div>{duration} hour(s)</div>
                <div style={{ color: '#666' }}>Service</div><div>{serviceType.replace('_', ' ')}</div>
                <div style={{ color: '#666' }}>Est. Cost</div><div style={{ fontWeight: 600, color: '#1b6b5a' }}>${parseInt((avail?.rate || '$30').replace(/[^0-9]/g, '')) * parseInt(duration)}</div>
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
