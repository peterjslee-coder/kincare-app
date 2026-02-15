const ActivityFeed = window.ActivityFeed = () => {
  const [activities, setActivities] = useState([]);
  const [expandedActivity, setExpandedActivity] = useState(null);

  useEffect(() => {
    const fetchActivities = async () => {
      try {
        const response = await apiFetch('/api/activity');
        if (response?.ok) {
          const data = await response.json();
          setActivities(data.activities || []);
        }
      } catch (error) {
        console.error('Error fetching activities:', error);
      }
    };
    fetchActivities();
  }, []);

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

  const markAsRead = async (activityId, e) => {
    e.stopPropagation();
    try {
      const response = await apiFetch(`/api/activity/${activityId}/read`, { method: 'PUT' });
      if (response?.ok) {
        setActivities(prev => prev.map(a => a.id === activityId ? { ...a, is_read: 1 } : a));
      }
    } catch (err) { console.error('Error marking as read:', err); }
  };

  const markAllAsRead = async () => {
    try {
      const response = await apiFetch('/api/activity/read-all', { method: 'PUT' });
      if (response?.ok) {
        setActivities(prev => prev.map(a => ({ ...a, is_read: 1 })));
      }
    } catch (err) { console.error('Error marking all as read:', err); }
  };

  const unreadCount = activities.filter(a => !a.is_read).length;

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Activity Feed</h1>
          <p className="page-subtitle">Recent updates about Betty's care</p>
        </div>
        {unreadCount > 0 && (
          <button onClick={markAllAsRead} style={{ padding: '8px 16px', background: '#1b6b5a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            Mark all read ({unreadCount})
          </button>
        )}
      </div>
      <div className="card">
        <div>
          {activities.map((activity, idx) => (
            <div key={idx} className={`activity-item ${expandedActivity === idx ? 'expanded' : ''} ${!activity.is_read ? 'unread' : ''}`} onClick={() => setExpandedActivity(expandedActivity === idx ? null : idx)} style={{ cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div className="activity-title">
                    {!activity.is_read && <span style={{ color: '#1b6b5a', marginRight: 6 }}>●</span>}
                    {activity.title}
                  </div>
                  <div className="activity-time">{formatActivityTime(activity.created_at)}</div>
                </div>
                {!activity.is_read && (
                  <button onClick={(e) => markAsRead(activity.id, e)} style={{ padding: '4px 10px', background: 'transparent', color: '#1b6b5a', border: '1px solid #1b6b5a', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    Mark read
                  </button>
                )}
              </div>
              {expandedActivity === idx && (
                <>
                  <div className="activity-message">{activity.message}</div>
                  <div className="activity-badge">{activity.event_type}</div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
};
