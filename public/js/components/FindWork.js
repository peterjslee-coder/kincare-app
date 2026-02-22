// ─── FindWork — Caregiver-focused page to discover and accept care requests ───
// Shows open care requests, upcoming booked sessions, and weekly availability overlay
const FindWork = window.FindWork = () => {
  const [openRequests, setOpenRequests] = useState([]);
  const [upcomingSessions, setUpcomingSessions] = useState([]);
  const [availRules, setAvailRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [claimingId, setClaimingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [filterService, setFilterService] = useState('all');
  const { showToast } = useToast();

  const fetchData = async () => {
    try {
      const toLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const today = toLocal(new Date());
      const tw = new Date(); tw.setDate(tw.getDate() + 14);
      const twoWeeks = toLocal(tw);

      const [reqRes, sessRes, availRes] = await Promise.all([
        apiFetch(`/api/sessions?status=requested&from=${today}&to=${twoWeeks}`),
        apiFetch(`/api/sessions?from=${today}&to=${twoWeeks}`),
        apiFetch('/api/availability'),
      ]);

      if (reqRes?.ok) {
        const d = await reqRes.json();
        setOpenRequests((d.sessions || []).filter(s => s.status === 'requested'));
      }
      if (sessRes?.ok) {
        const d = await sessRes.json();
        setUpcomingSessions((d.sessions || []).filter(s => s.status !== 'requested'));
      }
      if (availRes?.ok) {
        const d = await availRes.json();
        setAvailRules(d.rules || []);
      }
    } catch (err) {
      console.error('FindWork fetch error:', err);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  // Claim / accept a care request
  const handleClaim = async (sessionId) => {
    setClaimingId(sessionId);
    try {
      const res = await apiFetch(`/api/sessions/${sessionId}/claim`, { method: 'PUT' });
      if (res?.ok) {
        showToast('Care request accepted!', 'success');
        fetchData(); // Refresh
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Failed to accept request', 'error');
      }
    } catch (err) {
      console.error('Claim error:', err);
      showToast('Failed to accept request', 'error');
    }
    setClaimingId(null);
  };

  const formatTimeStr = (t) => {
    if (!t) return '';
    const [h, min] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const dh = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${dh}:${String(min || 0).padStart(2, '0')} ${ampm}`;
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T12:00:00');
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  // Get unique service types for filter
  const serviceTypes = [...new Set(openRequests.map(s => s.service_type || s.serviceType).filter(Boolean))];

  // Filter requests
  const filteredRequests = filterService === 'all'
    ? openRequests
    : openRequests.filter(s => (s.service_type || s.serviceType) === filterService);

  // Group upcoming sessions by date
  const sessionsByDate = {};
  upcomingSessions.forEach(s => {
    const d = s.scheduled_date || s.date;
    if (!sessionsByDate[d]) sessionsByDate[d] = [];
    sessionsByDate[d].push(s);
  });
  const sortedDates = Object.keys(sessionsByDate).sort();

  if (loading) return <LoadingSpinner text="Finding available work..." />;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>🔍</span> Find Work
        </h1>
        <p className="page-subtitle">Open care requests and your upcoming sessions</p>
      </div>

      {/* Open Care Requests */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h2 style={{ margin: 0, fontSize: '17px', color: '#1a1a2e', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: '28px', height: '28px', borderRadius: '50%', background: '#fce4ec', fontSize: '14px',
            }}>🔔</span>
            Open Requests
            {filteredRequests.length > 0 && (
              <span style={{
                padding: '2px 10px', background: '#c62828', color: '#fff', borderRadius: '12px',
                fontSize: '12px', fontWeight: 700, marginLeft: '4px',
              }}>{filteredRequests.length}</span>
            )}
          </h2>
          {serviceTypes.length > 1 && (
            <select value={filterService} onChange={e => setFilterService(e.target.value)} style={{
              padding: '6px 12px', borderRadius: '8px', border: '1px solid #d0d0d0',
              fontSize: '12px', color: '#555', background: '#fff', cursor: 'pointer',
            }}>
              <option value="all">All types</option>
              {serviceTypes.map(t => (
                <option key={t} value={t}>{(t || '').replace(/_/g, ' ')}</option>
              ))}
            </select>
          )}
        </div>

        {filteredRequests.length > 0 ? (
          <div style={{ display: 'grid', gap: '12px' }}>
            {filteredRequests.map(s => {
              const isExpanded = expandedId === s.id;
              const time = s.scheduled_time || s.time;
              const duration = s.duration_hours || s.durationHours;
              const service = s.service_type || s.serviceType;
              const recipient = s.recipient_name || s.recipientName || 'Client';
              const cost = s.estimated_cost || s.estimatedCost;
              const offeredRate = s.proposed_rate || s.proposedRate;
              const instructions = s.special_instructions || s.specialInstructions;
              const dateStr = s.scheduled_date || s.date;
              const totalDisplay = offeredRate ? (offeredRate * duration) : cost;

              return (
                <div key={s.id} className="card" style={{
                  borderLeft: '4px solid #f48fb1', padding: '16px', cursor: 'pointer',
                  transition: 'box-shadow 0.15s',
                }} onClick={() => setExpandedId(isExpanded ? null : s.id)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                        <span style={{ fontWeight: 700, fontSize: '15px', color: '#1a1a2e' }}>{recipient}</span>
                        <span style={{
                          padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 600,
                          background: '#fce4ec', color: '#c62828', textTransform: 'capitalize',
                        }}>needs help</span>
                      </div>
                      <div style={{ fontSize: '13px', color: '#555', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                        <span>📅 {formatDate(dateStr)}</span>
                        <span>🕐 {formatTimeStr(time)}</span>
                        <span>⏱️ {duration}h</span>
                        <span style={{ textTransform: 'capitalize' }}>🏷️ {(service || '').replace(/_/g, ' ')}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '12px' }}>
                      <div style={{ fontSize: '22px', fontWeight: 700, color: '#1b6b5a' }}>
                        {totalDisplay ? `$${Math.round(totalDisplay)}` : '—'}
                      </div>
                      <div style={{ fontSize: '12px', color: offeredRate ? '#1b6b5a' : '#888', fontWeight: offeredRate ? 600 : 400 }}>
                        {offeredRate ? `$${offeredRate}/hr offered` : (cost && duration ? `$${Math.round(cost / duration)}/hr` : '')}
                      </div>
                      {duration && (
                        <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>
                          {duration}h total
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f0f0f0' }}>
                      {instructions && (
                        <div style={{
                          padding: '10px 12px', background: '#fff8e1', borderRadius: '8px',
                          fontSize: '13px', color: '#5d4037', marginBottom: '12px',
                        }}>
                          <span style={{ fontWeight: 600 }}>Instructions:</span> {instructions}
                        </div>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); handleClaim(s.id); }}
                        disabled={claimingId === s.id}
                        style={{
                          width: '100%', padding: '12px', background: '#1b6b5a', color: '#fff',
                          border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 700,
                          cursor: 'pointer', opacity: claimingId === s.id ? 0.6 : 1,
                          transition: 'opacity 0.15s',
                        }}>
                        {claimingId === s.id ? 'Accepting...' : 'Accept This Request'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>✨</div>
            <h3 style={{ margin: '0 0 8px', color: '#333', fontSize: '16px' }}>No open requests right now</h3>
            <p style={{ color: '#888', fontSize: '13px', margin: 0 }}>
              New care requests from your assigned families will appear here. Check back soon!
            </p>
          </div>
        )}
      </div>

      {/* Upcoming Booked Sessions */}
      <div>
        <h2 style={{ margin: '0 0 12px', fontSize: '17px', color: '#1a1a2e', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '28px', height: '28px', borderRadius: '50%', background: '#e3f2fd', fontSize: '14px',
          }}>📅</span>
          Your Upcoming Sessions
          {upcomingSessions.length > 0 && (
            <span style={{
              padding: '2px 10px', background: '#1b6b5a', color: '#fff', borderRadius: '12px',
              fontSize: '12px', fontWeight: 700, marginLeft: '4px',
            }}>{upcomingSessions.length}</span>
          )}
        </h2>

        {sortedDates.length > 0 ? sortedDates.map(dateStr => (
          <div key={dateStr} style={{ marginBottom: '16px' }}>
            <div style={{
              fontSize: '13px', fontWeight: 700, color: '#1b6b5a', marginBottom: '8px',
              padding: '4px 0', borderBottom: '1px solid #e8f5f1',
            }}>
              {formatDate(dateStr)}
            </div>
            {sessionsByDate[dateStr].map(s => {
              const time = s.scheduled_time || s.time;
              const duration = s.duration_hours || s.durationHours;
              const service = s.service_type || s.serviceType;
              const recipient = s.recipient_name || s.recipientName || 'Client';
              const cost = s.estimated_cost || s.estimatedCost || s.actual_cost;
              const statusColors = {
                confirmed: { bg: '#e8f5e9', text: '#2e7d32' },
                pending: { bg: '#fff3e0', text: '#e65100' },
                completed: { bg: '#e0e0e0', text: '#666' },
                in_progress: { bg: '#f3e5f5', text: '#7b1fa2' },
              };
              const sc = statusColors[s.status] || statusColors.pending;

              return (
                <div key={s.id} className="card" style={{
                  borderLeft: '4px solid #42a5f5', padding: '14px', marginBottom: '8px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '14px', color: '#333' }}>{recipient}</div>
                      <div style={{ fontSize: '12px', color: '#666', marginTop: '2px' }}>
                        {formatTimeStr(time)} · {duration}h · <span style={{ textTransform: 'capitalize' }}>{(service || '').replace(/_/g, ' ')}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 600, color: '#1b6b5a' }}>
                        {cost ? `$${cost}` : ''}
                      </span>
                      <span style={{
                        padding: '3px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: 600,
                        background: sc.bg, color: sc.text, textTransform: 'capitalize',
                      }}>{s.status}</span>
                    </div>
                  </div>
                  {(s.special_instructions || s.specialInstructions) && (
                    <div style={{ fontSize: '12px', color: '#888', fontStyle: 'italic', marginTop: '6px' }}>
                      {s.special_instructions || s.specialInstructions}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )) : (
          <div className="card" style={{ textAlign: 'center', padding: '24px 20px' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>📋</div>
            <p style={{ color: '#888', fontSize: '13px', margin: 0 }}>
              No upcoming sessions. Accept a care request above to get started!
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
