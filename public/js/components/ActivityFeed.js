const ActivityFeed = window.ActivityFeed = () => {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedActivity, setExpandedActivity] = useState(null);
  const [visitPhotos, setVisitPhotos] = useState({}); // visitLogId -> photos[]
  const [lightboxPhoto, setLightboxPhoto] = useState(null);
  const [recipientName, setRecipientName] = useState('');
  const { showToast } = useToast();

  const fetchActivities = async () => {
    try {
      const [actRes, dashRes] = await Promise.all([
        apiFetch('/api/activity'),
        apiFetch('/api/dashboard'),
      ]);
      if (actRes?.ok) {
        const data = await actRes.json();
        setActivities(data.activities || []);
      }
      if (dashRes?.ok) {
        const data = await dashRes.json();
        const recipients = data.careRecipients || [];
        if (recipients.length === 1) {
          setRecipientName(recipients[0].first_name || '');
        } else if (recipients.length > 1) {
          setRecipientName(recipients.map(r => r.first_name).join(' & '));
        }
      }
    } catch (error) {
      console.error('Error fetching activities:', error);
    }
    setLoading(false);
  };

  useEffect(() => { fetchActivities(); }, []);

  // Real-time: refresh on activity updates
  useEffect(() => {
    if (typeof onSocketEvent !== 'function') return;
    return onSocketEvent('activity_update', () => fetchActivities());
  }, []);

  // Fetch photos for a visit_complete activity when expanded
  const loadVisitPhotos = async (visitLogId) => {
    if (!visitLogId || visitPhotos[visitLogId]) return;
    try {
      const res = await apiFetch(`/api/photos/visit/${visitLogId}`);
      if (res?.ok) {
        const data = await res.json();
        setVisitPhotos(prev => ({ ...prev, [visitLogId]: data.photos || [] }));
      }
    } catch (err) {
      console.error('Error loading visit photos:', err);
    }
  };

  const formatActivityTime = (createdAt) => {
    if (!createdAt) return '';
    const date = parseTimestamp(createdAt);
    if (!date) return '';
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    // Absolute dates render in the care-location timezone, never device time
    return TimezoneHelper.formatTimestamp(date, null, { month: 'short', day: 'numeric', year: 'numeric' });
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
        showToast('All notifications marked as read', 'success');
      }
    } catch (err) { console.error('Error marking all as read:', err); }
  };

  if (loading) return <LoadingSpinner text="Loading activity feed..." />;

  const unreadCount = activities.filter(a => !a.is_read).length;

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Activity Feed</h1>
          <p className="page-subtitle">Recent updates{recipientName ? ` about ${recipientName}'s care` : ''}</p>
        </div>
        {unreadCount > 0 && (
          <button onClick={markAllAsRead} style={{ padding: '8px 16px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            Mark all read ({unreadCount})
          </button>
        )}
      </div>
      {activities.length === 0 ? (
        <EmptyState icon="📢" title="No activity yet" text="Activity updates will appear here as care sessions are scheduled and completed." />
      ) : (
      <div className="card">
        <div>
          {activities.map((activity, idx) => (
            <div key={idx} className={`activity-item ${expandedActivity === idx ? 'expanded' : ''} ${!activity.is_read ? 'unread' : ''}`} onClick={() => {
              const isExpanding = expandedActivity !== idx;
              setExpandedActivity(isExpanding ? idx : null);
              // Load photos for visit_complete activities
              if (isExpanding && activity.event_type === 'visit_complete' && activity.metadata) {
                try {
                  const meta = typeof activity.metadata === 'string' ? JSON.parse(activity.metadata) : activity.metadata;
                  if (meta.visitLogId) loadVisitPhotos(meta.visitLogId);
                } catch (e) {}
              }
            }} style={{ cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="activity-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {!activity.is_read && <span style={{ color: 'var(--role-color)', marginRight: 6 }}>●</span>}
                    {activity.title}
                  </div>
                  <div className="activity-time">{formatActivityTime(activity.created_at)}</div>
                </div>
                {!activity.is_read && (
                  <button onClick={(e) => markAsRead(activity.id, e)} style={{ padding: '3px 6px', background: 'transparent', color: 'var(--role-color)', border: '1px solid #1b6b5a', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, marginLeft: 6, lineHeight: 1.2 }}>
                    ✓ Read
                  </button>
                )}
              </div>
              {expandedActivity === idx && (
                <>
                  <div className="activity-message">{activity.message}</div>
                  {/* Visit photos for visit_complete events */}
                  {activity.event_type === 'visit_complete' && (() => {
                    try {
                      const meta = typeof activity.metadata === 'string' ? JSON.parse(activity.metadata) : activity.metadata;
                      const photos = meta?.visitLogId ? (visitPhotos[meta.visitLogId] || []) : [];
                      if (photos.length > 0) {
                        return (
                          <div style={{ marginTop: '10px' }}>
                            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>📸 Visit Photos ({photos.length})</div>
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                              {photos.map((p, pi) => (
                                <img key={pi} src={p.photo_url} alt={p.caption || `Visit photo ${pi + 1}`}
                                  onClick={(e) => { e.stopPropagation(); setLightboxPhoto(p); }}
                                  style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '8px', cursor: 'pointer', border: '1px solid #ddd' }}
                                  title={p.caption || ''} />
                              ))}
                            </div>
                          </div>
                        );
                      }
                      return null;
                    } catch (e) { return null; }
                  })()}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <div className="activity-badge">{activity.event_type}</div>
                    {['care_request', 'session_update', 'session_booked', 'session_requested', 'session_confirmed', 'session_cancelled', 'care_request_accepted'].includes(activity.event_type) && (
                      <button onClick={(e) => {
                        e.stopPropagation();
                        // Try to extract session date from metadata to navigate to the right week
                        try {
                          const meta = typeof activity.metadata === 'string' ? JSON.parse(activity.metadata) : activity.metadata;
                          if (meta?.sessionDate || meta?.date || meta?.scheduled_date) {
                            window.__pendingScheduleDate = meta.sessionDate || meta.date || meta.scheduled_date;
                          }
                        } catch (e2) {}
                        if (window.__navigateTo) window.__navigateTo('schedule');
                      }}
                        style={{ padding: '2px 8px', background: 'var(--color-info-bg)', color: 'var(--color-info)', border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                        View on Schedule
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
      )}
      {/* Photo Lightbox */}
      {lightboxPhoto && (
        <div onClick={() => setLightboxPhoto(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 2000, cursor: 'pointer',
        }}>
          <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}>
            <img src={lightboxPhoto.photo_url} alt={lightboxPhoto.caption || 'Visit photo'}
              style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: '8px', objectFit: 'contain' }} />
            {lightboxPhoto.caption && (
              <div style={{ textAlign: 'center', color: 'var(--text-on-primary)', marginTop: '10px', fontSize: '14px' }}>
                {lightboxPhoto.caption}
              </div>
            )}
            <button onClick={() => setLightboxPhoto(null)} style={{
              position: 'absolute', top: '-12px', right: '-12px', width: '32px', height: '32px',
              background: 'var(--bg-surface)', color: 'var(--text-primary)', border: 'none', borderRadius: '50%',
              fontSize: '18px', cursor: 'pointer', fontWeight: 700,
            }}>×</button>
          </div>
        </div>
      )}
    </>
  );
};
