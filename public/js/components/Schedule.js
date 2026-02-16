const Schedule = window.Schedule = () => {
  const [sessions, setSessions] = useState([]);
  const [expandedSession, setExpandedSession] = useState(null);

  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const response = await apiFetch('/api/sessions');
        if (response?.ok) {
          const data = await response.json();
          const allSessions = data.sessions || [];
          const futureSessions = [
            ...allSessions,
            { id: 'future-1', scheduled_date: '2026-02-21', scheduled_time: '10:00 AM', service_type: 'Companionship', caregiver_name: 'Mary Johnson', status: 'confirmed', duration_hours: 2, special_instructions: 'Garden walk if weather permits', estimated_cost: '$60' },
            { id: 'future-2', scheduled_date: '2026-02-25', scheduled_time: '2:00 PM', service_type: 'Light Housekeeping', caregiver_name: 'Sarah Williams', status: 'pending', duration_hours: 2, special_instructions: 'Focus on kitchen and living room', estimated_cost: '$60' },
            { id: 'future-3', scheduled_date: '2026-02-28', scheduled_time: '11:00 AM', service_type: 'Personal Care', caregiver_name: 'Mary Johnson', status: 'confirmed', duration_hours: 3, special_instructions: 'Help with shower and breakfast', estimated_cost: '$90' },
            { id: 'future-4', scheduled_date: '2026-03-03', scheduled_time: '3:00 PM', service_type: 'Companionship', caregiver_name: 'Sarah Williams', status: 'confirmed', duration_hours: 2, special_instructions: 'Movie afternoon', estimated_cost: '$60' },
            { id: 'future-5', scheduled_date: '2026-03-05', scheduled_time: '10:00 AM', service_type: 'Medication Management', caregiver_name: 'Mary Johnson', status: 'pending', duration_hours: 1, special_instructions: 'Review medications and set up organizer', estimated_cost: '$30' },
          ];
          setSessions(futureSessions.sort((a, b) => new Date(a.scheduled_date) - new Date(b.scheduled_date)));
        }
      } catch (error) {
        console.error('Error fetching sessions:', error);
      }
    };
    fetchSessions();
  }, []);

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'confirmed': return 'badge-confirmed';
      case 'pending': return 'badge-pending';
      case 'completed': return 'badge-completed';
      default: return 'badge-confirmed';
    }
  };

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Schedule</h1>
        <p className="page-subtitle">Betty's upcoming care sessions</p>
      </div>
      <div className="card">
        <ul className="schedule-list">
          {sessions.map((session) => (
            <li key={session.id} className={`schedule-session ${expandedSession === session.id ? 'expanded' : ''}`} onClick={() => setExpandedSession(expandedSession === session.id ? null : session.id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div className="schedule-date">{session.scheduled_date} at {session.scheduled_time}</div>
                  <div style={{ fontSize: 14, color: '#666', marginBottom: 8 }}>{session.caregiver_name}</div>
                  <div>
                    <span className={`badge ${getStatusBadgeClass(session.status)}`}>{session.status ? session.status.charAt(0).toUpperCase() + session.status.slice(1) : 'Confirmed'}</span>
                    <span style={{ marginLeft: 8, fontSize: 13, color: '#999' }}>{session.service_type}</span>
                  </div>
                </div>
                <div style={{ color: '#1b6b5a', fontSize: 20 }}>{expandedSession === session.id ? '−' : '+'}</div>
              </div>
              <div className="schedule-details">
                <div className="schedule-detail-row"><div className="schedule-detail-label">Duration</div><div className="schedule-detail-value">{session.duration_hours} hour(s)</div></div>
                <div className="schedule-detail-row"><div className="schedule-detail-label">Service Type</div><div className="schedule-detail-value">{session.service_type}</div></div>
                <div className="schedule-detail-row"><div className="schedule-detail-label">Special Instructions</div><div className="schedule-detail-value">{session.special_instructions}</div></div>
                <div className="schedule-detail-row"><div className="schedule-detail-label">Estimated Cost</div><div className="schedule-detail-value">{session.estimated_cost}</div></div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
};
