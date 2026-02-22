// ─── FindWork — Caregiver-focused page to discover and accept care requests ───
// Shows open care requests with date range, service filter, and upcoming sessions
const FindWork = window.FindWork = () => {
  const [openRequests, setOpenRequests] = useState([]);
  const [upcomingSessions, setUpcomingSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [claimingId, setClaimingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [filterService, setFilterService] = useState('all');
  const [rangeDays, setRangeDays] = useState(14); // 7, 14, 30
  const [lastFetched, setLastFetched] = useState(null);
  const { showToast } = useToast();

  const toLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const fetchData = async () => {
    setLoading(true);
    try {
      const today = toLocal(new Date());
      const end = new Date(); end.setDate(end.getDate() + rangeDays);
      const endStr = toLocal(end);

      const [reqRes, sessRes] = await Promise.all([
        apiFetch(`/api/sessions?status=requested&from=${today}&to=${endStr}`),
        apiFetch(`/api/sessions?from=${today}&to=${endStr}`),
      ]);

      if (reqRes?.ok) {
        const d = await reqRes.json();
        setOpenRequests((d.sessions || []).filter(s => s.status === 'requested'));
      }
      if (sessRes?.ok) {
        const d = await sessRes.json();
        setUpcomingSessions((d.sessions || []).filter(s => s.status !== 'requested'));
      }
      setLastFetched(new Date());
    } catch (err) {
      console.error('FindWork fetch error:', err);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [rangeDays]);

  // Claim / accept a care request
  const handleClaim = async (sessionId) => {
    setClaimingId(sessionId);
    try {
      const res = await apiFetch(`/api/sessions/${sessionId}/claim`, { method: 'PUT' });
      if (res?.ok) {
        showToast('Care request accepted!', 'success');
        fetchData();
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
        <p className="page-subtitle">Open care requests from families in your area</p>
      </div>

      {/* Search Controls */}
      <div style={{
        display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 180 }}>
          <span style={{ fontSize: 13, color: '#666', fontWeight: 600, whiteSpace: 'nowrap' }}>Date range:</span>
          {[7, 14, 30].map(d => (
            <button key={d} onClick={() => setRangeDays(d)} style={{
              padding: '5px 12px', borderRadius: 8, border: '1px solid',
              borderColor: rangeDays === d ? '#1b6b5a' : '#d0d0d0',
              background: rangeDays === d ? '#1b6b5a' : '#fff',
              color: rangeDays === d ? '#fff' : '#555',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>{d === 7 ? '1 week' : d === 14 ? '2 weeks' : '1 month'}</button>
          ))}
        </div>
        {serviceTypes.length > 1 && (
          <select value={filterService} onChange={e => setFilterService(e.target.value)} style={{
            padding: '6px 12px', borderRadius: 8, border: '1px solid #d0d0d0',
            fontSize: 12, color: '#555', background: '#fff', cursor: 'pointer',
          }}>
            <option value="all">All types</option>
            {serviceTypes.map(t => (
              <option key={t} value={t}>{(t || '').replace(/_/g, ' ')}</option>
            ))}
          </select>
        )}
        <button onClick={fetchData} style={{
          padding: '5px 14px', borderRadius: 8, border: '1px solid #1b6b5a',
          background: '#fff', color: '#1b6b5a', fontSize: 12, fontWeight: 600,
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
        }}>↻ Refresh</button>
      </div>

      {lastFetched && (
        <div style={{ fontSize: 11, color: '#aaa', marginBottom: 12, textAlign: 'right' }}>
          Last checked: {lastFetched.toLocaleTimeString()}
        </div>
      )}

      {/* Open Care Requests */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 17, color: '#1a1a2e', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28, borderRadius: '50%', background: '#fce4ec', fontSize: 14,
            }}>🔔</span>
            Open Requests
            {filteredRequests.length > 0 && (
              <span style={{
                padding: '2px 10px', background: '#c62828', color: '#fff', borderRadius: 12,
                fontSize: 12, fontWeight: 700, marginLeft: 4,
              }}>{filteredRequests.length}</span>
            )}
          </h2>
        </div>

        {filteredRequests.length > 0 ? (
          <div style={{ display: 'grid', gap: 12 }}>
            {filteredRequests.map(s => {
              const isExpanded = expandedId === s.id;
              const time = s.scheduled_time || s.time;
              const duration = s.duration_hours || s.durationHours;
              const service = s.service_type || s.serviceType;
              const recipient = s.recipient_name || s.recipientName || 'Client';
              const cost = s.estimated_cost || s.estimatedCost;
              const instructions = s.special_instructions || s.specialInstructions;
              const dateStr = s.scheduled_date || s.date;
              const city = s.recipient_city || '';

              return (
                <div key={s.id} className="card" style={{
                  borderLeft: '4px solid #fb8c00', padding: 16, cursor: 'pointer',
                  transition: 'box-shadow 0.15s',
                }} onClick={() => setExpandedId(isExpanded ? null : s.id)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontWeight: 700, fontSize: 16, color: '#1a1a2e' }}>{recipient}</span>
                        <span style={{
                          padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                          background: '#fff3e0', color: '#e65100', textTransform: 'capitalize',
                        }}>{(service || '').replace(/_/g, ' ')}</span>
                      </div>
                      <div style={{ fontSize: 13, color: '#555', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <span>📅 {formatDate(dateStr)}</span>
                        <span>🕐 {formatTimeStr(time)}</span>
                        <span>⏱️ {duration}h</span>
                        {city && <span>📍 {city}</span>}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
                      <div style={{ fontSize: 24, fontWeight: 700, color: '#1b6b5a' }}>
                        {cost ? `$${Math.round(parseFloat(cost))}` : '—'}
                      </div>
                      <div style={{ fontSize: 12, color: '#888' }}>
                        {cost && duration ? `$${Math.round(cost / duration)}/hr` : ''}
                      </div>
                    </div>
                  </div>

                  {instructions && (
                    <div style={{
                      fontSize: 12, color: '#666', fontStyle: 'italic', marginTop: 6,
                      whiteSpace: isExpanded ? 'normal' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      "{instructions}"
                    </div>
                  )}

                  {/* Expanded — Accept button */}
                  {isExpanded && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #f0f0f0' }}>
                      <button onClick={(e) => { e.stopPropagation(); handleClaim(s.id); }}
                        disabled={claimingId === s.id}
                        style={{
                          width: '100%', padding: 14, background: '#1b6b5a', color: '#fff',
                          border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 700,
                          cursor: 'pointer', opacity: claimingId === s.id ? 0.6 : 1,
                        }}>
                        {claimingId === s.id ? 'Accepting...' : '✓ Accept This Request'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
            <h3 style={{ margin: '0 0 8px', color: '#333', fontSize: 16 }}>No open requests in the next {rangeDays} days</h3>
            <p style={{ color: '#888', fontSize: 13, margin: '0 0 12px' }}>
              Care requests from families in your area will appear here automatically.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              {rangeDays < 30 && (
                <button onClick={() => setRangeDays(30)} style={{
                  padding: '8px 16px', borderRadius: 8, border: '1px solid #1b6b5a',
                  background: '#fff', color: '#1b6b5a', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}>Try 1 month range</button>
              )}
              <button onClick={fetchData} style={{
                padding: '8px 16px', borderRadius: 8, border: '1px solid #e0e0e0',
                background: '#f5f5f5', color: '#666', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>↻ Refresh</button>
            </div>
          </div>
        )}
      </div>

      {/* Upcoming Booked Sessions */}
      <div>
        <h2 style={{ margin: '0 0 12px', fontSize: 17, color: '#1a1a2e', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: '50%', background: '#e3f2fd', fontSize: 14,
          }}>📅</span>
          Your Upcoming Sessions
          {upcomingSessions.length > 0 && (
            <span style={{
              padding: '2px 10px', background: '#1b6b5a', color: '#fff', borderRadius: 12,
              fontSize: 12, fontWeight: 700, marginLeft: 4,
            }}>{upcomingSessions.length}</span>
          )}
        </h2>

        {sortedDates.length > 0 ? sortedDates.map(dateStr => (
          <div key={dateStr} style={{ marginBottom: 16 }}>
            <div style={{
              fontSize: 13, fontWeight: 700, color: '#1b6b5a', marginBottom: 8,
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
              };
              const sc = statusColors[s.status] || statusColors.pending;

              return (
                <div key={s.id} className="card" style={{
                  borderLeft: '4px solid #42a5f5', padding: 14, marginBottom: 8,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 15, color: '#333' }}>
                        {recipient}{cost ? `, $${Math.round(parseFloat(cost))}` : ''}
                      </div>
                      <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                        {formatTimeStr(time)} · {duration}h · <span style={{ textTransform: 'capitalize' }}>{(service || '').replace(/_/g, ' ')}</span>
                      </div>
                    </div>
                    <span style={{
                      padding: '3px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                      background: sc.bg, color: sc.text, textTransform: 'capitalize',
                    }}>{s.status}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )) : (
          <div className="card" style={{ textAlign: 'center', padding: '24px 20px' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
            <p style={{ color: '#888', fontSize: 13, margin: 0 }}>
              No upcoming sessions. Accept a care request above to get started!
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
