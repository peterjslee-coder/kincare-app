const Caregivers = window.Caregivers = () => {
  const [caregivers, setCaregivers] = useState([]);
  const [schedulingCaregiver, setSchedulingCaregiver] = useState(null);

  useEffect(() => {
    const fetchCaregivers = async () => {
      try {
        const response = await apiFetch('/api/caregivers');
        if (response?.ok) {
          const data = await response.json();
          setCaregivers(data.caregivers || []);
        }
      } catch (error) {
        console.error('Error fetching caregivers:', error);
      }
    };
    fetchCaregivers();
  }, []);

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Caregivers</h1>
        <p className="page-subtitle">Our trusted care professionals</p>
      </div>
      <div className="card">
        {caregivers.length > 0 ? (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {caregivers.map((caregiver, idx) => {
              const avail = CAREGIVER_AVAILABILITY[caregiver.name];
              const nextDays = getNextSevenDays();
              const nextFreeDay = nextDays.find(d => {
                const slots = getAvailableSlots(caregiver.name, d);
                return slots.some(s => !s.booked);
              });
              return (
                <li key={idx} className="caregiver-item" style={{ position: 'relative' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div className="caregiver-name">{caregiver.name}</div>
                      <div className="caregiver-details">
                        <div className="caregiver-detail">⭐ {caregiver.rating || '4.9'} • {caregiver.reviews || 8} reviews</div>
                        <div className="caregiver-detail">👨‍⚕️ {avail ? avail.skills.join(', ') : caregiver.specialties || 'Companionship'}</div>
                        <div className="caregiver-detail">✓ Background checked • CPR certified</div>
                        {nextFreeDay && (
                          <div className="caregiver-detail" style={{ color: '#1b6b5a', fontWeight: 500 }}>
                            📅 Next available: {nextFreeDay.label} {nextFreeDay.shortDate}
                          </div>
                        )}
                      </div>
                      <div className="caregiver-badges">
                        <span className="caregiver-badge">{avail ? avail.rate : '$30/hr'}</span>
                        <span className="caregiver-badge">{caregiver.availability || 'Flexible'}</span>
                      </div>
                    </div>
                    <button onClick={() => setSchedulingCaregiver(caregiver)}
                      style={{
                        padding: '10px 18px', background: '#1b6b5a', color: '#fff', border: 'none',
                        borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer',
                        whiteSpace: 'nowrap', marginLeft: 12, marginTop: 4,
                      }}>
                      Schedule {caregiver.name.split(' ')[0]}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <p style={{ color: '#999' }}>Loading caregivers...</p>}
      </div>

      {schedulingCaregiver && (
        <CaregiverScheduleModal
          caregiver={schedulingCaregiver}
          onClose={() => setSchedulingCaregiver(null)}
          onBooked={() => setSchedulingCaregiver(null)}
        />
      )}
    </>
  );
};
