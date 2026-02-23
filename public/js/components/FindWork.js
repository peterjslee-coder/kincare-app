// ─── FindWork — Caregiver-focused page to discover and accept care requests ───
// List + Map views, zip code search, date/service filters, accept flow
const FindWork = window.FindWork = () => {
  const [openRequests, setOpenRequests] = useState([]);
  const [upcomingSessions, setUpcomingSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [claimingId, setClaimingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [filterService, setFilterService] = useState('all');
  const [rangeDays, setRangeDays] = useState(14);
  const [lastFetched, setLastFetched] = useState(null);
  const [bgCheckPaid, setBgCheckPaid] = useState(null);
  const [viewMode, setViewMode] = useState('list'); // 'list' or 'map'
  const [zipFilter, setZipFilter] = useState('');
  const [profileCenter, setProfileCenter] = useState(null);
  const [radiusMiles, setRadiusMiles] = useState(10);
  const mapRef = useRef(null);
  const leafletMap = useRef(null);
  const markersRef = useRef([]);
  const circleRef = useRef(null);
  const { showToast } = useToast();

  const toLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // Check background check status + fetch caregiver profile location
  useEffect(() => {
    const init = async () => {
      try {
        const [dashRes, profileRes] = await Promise.all([
          apiFetch('/api/dashboard'),
          apiFetch('/api/caregivers/me'),
        ]);
        if (dashRes?.ok) {
          const data = await dashRes.json();
          setBgCheckPaid(!!data?.profile?.background_check_paid || !!data?.profile?.isBackgroundChecked);
        } else {
          setBgCheckPaid(false);
        }
        if (profileRes?.ok) {
          const data = await profileRes.json();
          const p = data.profile || data.caregiver;
          if (p?.latitude && p?.longitude) {
            setProfileCenter([parseFloat(p.latitude), parseFloat(p.longitude)]);
          }
          if (p?.max_travel_miles) setRadiusMiles(parseInt(p.max_travel_miles) || 10);
        }
      } catch { setBgCheckPaid(false); }
    };
    init();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const today = toLocal(new Date());
      const end = new Date(); end.setDate(end.getDate() + rangeDays);
      const endStr = toLocal(end);

      const res = await apiFetch(`/api/sessions?from=${today}&to=${endStr}`);
      if (res?.ok) {
        const d = await res.json();
        const all = d.sessions || [];
        setOpenRequests(all.filter(s => ['requested', 'open', 'pending'].includes(s.status) && !s.caregiver_id));
        setUpcomingSessions(all.filter(s => !['requested', 'open', 'pending'].includes(s.status) || s.caregiver_id));
      }
      setLastFetched(new Date());
    } catch (err) {
      console.error('FindWork fetch error:', err);
    }
    setLoading(false);
  };

  useEffect(() => { if (bgCheckPaid !== null) fetchData(); }, [rangeDays, bgCheckPaid]);

  // ─── Map initialization ───
  useEffect(() => {
    if (viewMode !== 'map' || !mapRef.current) return;
    if (leafletMap.current) {
      leafletMap.current.invalidateSize();
      return;
    }
    const center = profileCenter || [37.2296, -80.4139];
    const map = L.map(mapRef.current, { center, zoom: 12, zoomControl: true, scrollWheelZoom: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors', maxZoom: 18,
    }).addTo(map);
    leafletMap.current = map;
    setTimeout(() => map.invalidateSize(), 150);
  }, [viewMode]);

  // Re-center when profile loads
  useEffect(() => {
    if (leafletMap.current && profileCenter) {
      leafletMap.current.setView(profileCenter, 12);
    }
  }, [profileCenter]);

  // Service filter options
  const serviceTypes = [...new Set(openRequests.map(s => s.service_type || s.serviceType).filter(Boolean))];

  // Apply zip + service filters (computed before map effect so it can reference filteredRequests)
  let filteredRequests = openRequests;
  if (filterService !== 'all') {
    filteredRequests = filteredRequests.filter(s => (s.service_type || s.serviceType) === filterService);
  }
  if (zipFilter.trim()) {
    const z = zipFilter.trim().toLowerCase();
    filteredRequests = filteredRequests.filter(s => {
      const city = (s.recipient_city || '').toLowerCase();
      const state = (s.recipient_state || '').toLowerCase();
      const zip = (s.recipient_zip || '').toLowerCase();
      return city.includes(z) || state.includes(z) || zip.includes(z);
    });
  }

  // ─── Map markers for open requests ───
  useEffect(() => {
    if (!leafletMap.current) return;
    const map = leafletMap.current;

    // Clear old markers
    markersRef.current.forEach(m => map.removeLayer(m));
    markersRef.current = [];
    if (circleRef.current) { map.removeLayer(circleRef.current); circleRef.current = null; }

    // Add caregiver location marker + radius
    if (profileCenter) {
      const cgIcon = L.divIcon({
        className: '',
        html: '<div style="background:#1b6b5a;color:#fff;padding:5px 10px;border-radius:50%;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,0.3);text-align:center;width:28px;height:28px;display:flex;align-items:center;justify-content:center;transform:translate(-50%,-50%)">You</div>',
        iconSize: [0, 0], iconAnchor: [0, 0],
      });
      const cgMarker = L.marker(profileCenter, { icon: cgIcon }).addTo(map);
      cgMarker.bindPopup('Your registered work location');
      markersRef.current.push(cgMarker);

      circleRef.current = L.circle(profileCenter, {
        radius: radiusMiles * 1609.34,
        color: '#1b6b5a', fillColor: '#1b6b5a', fillOpacity: 0.06, weight: 2, dashArray: '6 4',
      }).addTo(map);
    }

    // Add open request markers
    const bounds = profileCenter ? [profileCenter] : [];
    filteredRequests.forEach(s => {
      const lat = parseFloat(s.recipient_lat);
      const lng = parseFloat(s.recipient_lng);
      if (!lat || !lng) return;

      const recipient = s.recipient_name || s.recipientName || 'Client';
      const service = (s.service_type || s.serviceType || '').replace(/_/g, ' ');
      const cost = s.estimated_cost || s.estimatedCost;
      const dateStr = s.scheduled_date || s.date;
      const time = s.scheduled_time || s.time;

      const icon = L.divIcon({
        className: '',
        html: `<div style="
          background:#fb8c00;color:#fff;padding:5px 10px;border-radius:10px 10px 10px 0;
          font-size:11px;font-weight:600;white-space:nowrap;
          box-shadow:0 2px 8px rgba(0,0,0,0.3);
          font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;
          transform:translate(-50%,-100%);
        ">
          <div>${recipient}</div>
          <div style="font-size:10px;font-weight:400;opacity:0.9">${service}${cost ? ' · $' + Math.round(parseFloat(cost)) : ''}</div>
        </div>`,
        iconSize: [0, 0], iconAnchor: [0, 40],
      });

      const marker = L.marker([lat, lng], { icon }).addTo(map);
      marker.bindPopup(`
        <div style="min-width:160px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px">${recipient}</div>
          <div style="font-size:12px;color:#666;margin-bottom:2px">${service}</div>
          <div style="font-size:12px;color:#666;margin-bottom:2px">📅 ${dateStr} 🕐 ${time || ''}</div>
          ${cost ? '<div style="font-size:14px;font-weight:700;color:#1b6b5a;margin-top:4px">$' + Math.round(parseFloat(cost)) + '</div>' : ''}
          <button onclick="document.dispatchEvent(new CustomEvent('findwork-claim',{detail:'${s.id}'}))" style="
            margin-top:8px;width:100%;padding:8px;background:#1b6b5a;color:#fff;border:none;border-radius:6px;
            font-size:13px;font-weight:600;cursor:pointer;
          ">Accept Request</button>
        </div>
      `);
      markersRef.current.push(marker);
      bounds.push([lat, lng]);
    });

    if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
    }
  }, [filteredRequests, profileCenter, radiusMiles, viewMode]);

  // Listen for claim events from map popups
  useEffect(() => {
    const handler = (e) => { if (e.detail) handleClaim(e.detail); };
    document.addEventListener('findwork-claim', handler);
    return () => document.removeEventListener('findwork-claim', handler);
  }, []);

  // Cleanup map on unmount
  useEffect(() => {
    return () => {
      if (leafletMap.current) { leafletMap.current.remove(); leafletMap.current = null; }
    };
  }, []);

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

  // Group upcoming sessions by date
  const sessionsByDate = {};
  upcomingSessions.forEach(s => {
    const d = s.scheduled_date || s.date;
    if (!sessionsByDate[d]) sessionsByDate[d] = [];
    sessionsByDate[d].push(s);
  });
  const sortedDates = Object.keys(sessionsByDate).sort();

  if (loading || bgCheckPaid === null) return React.createElement(LoadingSpinner, { text: 'Finding available work...' });

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>🔍</span> Find Work
        </h1>
        <p className="page-subtitle">Open care requests from families in your area</p>
      </div>

      {/* Background check gate */}
      {!bgCheckPaid && (
        <div className="card" style={{
          padding: '32px 24px', textAlign: 'center', marginBottom: '24px',
          borderLeft: '4px solid #f59e0b',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>🔒</div>
          <h3 style={{ color: '#92400e', margin: '0 0 8px', fontSize: '18px' }}>Background Check Required</h3>
          <p style={{ color: '#78716c', fontSize: '14px', margin: '0 0 16px', maxWidth: '400px', marginLeft: 'auto', marginRight: 'auto', lineHeight: '1.6' }}>
            You need to complete your background check payment before you can view available care requests or accept jobs on the platform.
          </p>
          <button onClick={() => {
            if (typeof setPage === 'function') setPage('caretaker-hub');
            else if (typeof window.navigateTo === 'function') window.navigateTo('caretaker-hub');
          }} style={{
            padding: '12px 28px', background: '#1b6b5a', color: '#fff', border: 'none',
            borderRadius: '8px', fontSize: '15px', fontWeight: 600, cursor: 'pointer',
          }}>Go to Dashboard to Complete</button>
        </div>
      )}

      {bgCheckPaid && <>
      {/* Controls bar: view toggle, zip, date range, service filter, refresh */}
      <div style={{
        display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center',
      }}>
        {/* View toggle */}
        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid #d0d0d0' }}>
          {[{ key: 'list', label: '📋 List' }, { key: 'map', label: '🗺️ Map' }].map(v => (
            <button key={v.key} onClick={() => setViewMode(v.key)} style={{
              padding: '5px 14px', border: 'none',
              background: viewMode === v.key ? '#1b6b5a' : '#fff',
              color: viewMode === v.key ? '#fff' : '#555',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>{v.label}</button>
          ))}
        </div>

        {/* Zip code search */}
        <div style={{ position: 'relative', flex: '0 0 auto' }}>
          <input
            type="text"
            placeholder="City or zip..."
            value={zipFilter}
            onChange={e => setZipFilter(e.target.value)}
            style={{
              padding: '5px 12px 5px 28px', borderRadius: 8, border: '1px solid #d0d0d0',
              fontSize: 12, width: 140, outline: 'none',
            }}
          />
          <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: '#999' }}>📍</span>
        </div>

        {/* Date range */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {[7, 14, 30].map(d => (
            <button key={d} onClick={() => setRangeDays(d)} style={{
              padding: '5px 10px', borderRadius: 8, border: '1px solid',
              borderColor: rangeDays === d ? '#1b6b5a' : '#d0d0d0',
              background: rangeDays === d ? '#1b6b5a' : '#fff',
              color: rangeDays === d ? '#fff' : '#555',
              fontSize: 11, fontWeight: 600, cursor: 'pointer',
            }}>{d === 7 ? '1w' : d === 14 ? '2w' : '1mo'}</button>
          ))}
        </div>

        {/* Service filter */}
        {serviceTypes.length > 1 && (
          <select value={filterService} onChange={e => setFilterService(e.target.value)} style={{
            padding: '5px 10px', borderRadius: 8, border: '1px solid #d0d0d0',
            fontSize: 12, color: '#555', background: '#fff', cursor: 'pointer',
          }}>
            <option value="all">All types</option>
            {serviceTypes.map(t => (
              <option key={t} value={t}>{(t || '').replace(/_/g, ' ')}</option>
            ))}
          </select>
        )}

        <button onClick={fetchData} style={{
          padding: '5px 12px', borderRadius: 8, border: '1px solid #1b6b5a',
          background: '#fff', color: '#1b6b5a', fontSize: 12, fontWeight: 600,
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto',
        }}>↻ Refresh</button>
      </div>

      {lastFetched && (
        <div style={{ fontSize: 11, color: '#aaa', marginBottom: 10, textAlign: 'right' }}>
          Last checked: {lastFetched.toLocaleTimeString()}
          {filteredRequests.length > 0 && <span style={{ marginLeft: 8, color: '#e65100', fontWeight: 600 }}>{filteredRequests.length} open</span>}
        </div>
      )}

      {/* ─── MAP VIEW ─── */}
      {viewMode === 'map' && (
        <div style={{ marginBottom: 24 }}>
          {/* Radius control */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
            padding: '8px 14px', background: '#f0faf8', borderRadius: 8,
          }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#1b6b5a' }}>Radius:</span>
            {[5, 10, 15, 25].map(r => (
              <button key={r} onClick={() => setRadiusMiles(r)} style={{
                padding: '3px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                border: radiusMiles === r ? '2px solid #1b6b5a' : '1px solid #ccc',
                background: radiusMiles === r ? '#1b6b5a' : '#fff',
                color: radiusMiles === r ? '#fff' : '#666', cursor: 'pointer',
              }}>{r} mi</button>
            ))}
          </div>

          <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #e0e0e0', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
            <div ref={mapRef} style={{ height: 420, width: '100%' }} />
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: '#aaa', textAlign: 'center' }}>
            Map data &copy; OpenStreetMap &bull; Orange pins = open requests &bull; Click a pin to accept
          </div>

          {filteredRequests.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: '24px 20px', marginTop: 12 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
              <p style={{ color: '#888', fontSize: 13, margin: 0 }}>No open requests in the next {rangeDays} days</p>
            </div>
          )}
        </div>
      )}

      {/* ─── LIST VIEW ─── */}
      {viewMode === 'list' && (
        <>
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
                          {cost ? `$${Math.round(parseFloat(cost))}` : '\u2014'}
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

                    {isExpanded && (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #f0f0f0' }}>
                        <button onClick={(e) => { e.stopPropagation(); handleClaim(s.id); }}
                          disabled={claimingId === s.id}
                          style={{
                            width: '100%', padding: 14, background: '#1b6b5a', color: '#fff',
                            border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 700,
                            cursor: 'pointer', opacity: claimingId === s.id ? 0.6 : 1,
                          }}>
                          {claimingId === s.id ? 'Accepting...' : '\u2713 Accept This Request'}
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
        </>
      )}
      </>}
    </div>
  );
};
