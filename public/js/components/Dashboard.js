const Dashboard = window.Dashboard = () => {
  const [sessions, setSessions] = useState([]);
  const [activities, setActivities] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [sessionsRes, activitiesRes] = await Promise.all([
          apiFetch('/api/sessions'),
          apiFetch('/api/activity'),
        ]);
        if (sessionsRes?.ok) {
          const sessionsData = await sessionsRes.json();
          setSessions(sessionsData.sessions || []);
        }
        if (activitiesRes?.ok) {
          const activitiesData = await activitiesRes.json();
          setActivities(activitiesData.activities || []);
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      }
    };
    fetchData();
  }, []);

  const upcomingSessions = sessions.slice(0, 3);

  const formatActivityTime = (createdAt) => {
    const dateStr = createdAt.replace(' ', 'T') + 'Z';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <>
      <div className="page-header">
        <h1 className="greeting">Welcome back, Pete!</h1>
      </div>
      <div className="betty-card">
        <div style={{ fontSize: 40 }}>👵</div>
        <div className="betty-name">Betty Lee</div>
        <div className="betty-info">Your mother • Living in Blacksburg, VA</div>
      </div>
      <div className="stats-grid">
        <div className="stat-card">
          <div style={{ fontSize: 28 }}>📅</div>
          <div className="stat-number">{sessions.length}</div>
          <div className="stat-label">Scheduled Sessions</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize: 28 }}>👨‍💼</div>
          <div className="stat-number">2</div>
          <div className="stat-label">Assigned Caregivers</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize: 28 }}>⭐</div>
          <div className="stat-number">4.8</div>
          <div className="stat-label">Average Rating</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize: 28 }}>💰</div>
          <div className="stat-number">$1,240</div>
          <div className="stat-label">Monthly Budget</div>
        </div>
      </div>
      <div className="card">
        <div className="card-header"><span className="card-icon">📅</span>Upcoming Sessions</div>
        <ul className="sessions-list">
          {upcomingSessions.length > 0 ? upcomingSessions.map((session, idx) => (
            <li key={idx} className="session-item">
              <div className="session-time">{session.scheduled_date} at {session.scheduled_time}</div>
              <div className="session-caregiver">{session.caregiver_name}</div>
              <span className="session-type">{session.service_type}</span>
            </li>
          )) : <li style={{ color: '#999', padding: '16px' }}>No upcoming sessions</li>}
        </ul>
      </div>
      <div className="card">
        <div className="card-header"><span className="card-icon">📢</span>Recent Activity</div>
        <div>
          {activities.slice(0, 5).map((activity, idx) => (
            <div key={idx} className="activity-item">
              <div className="activity-title">{activity.title}</div>
              <div className="activity-time">{formatActivityTime(activity.created_at)}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
};
