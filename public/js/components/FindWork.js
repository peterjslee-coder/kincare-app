// ─── FindWork — Caregiver work hub: open jobs, availability, rates, families ───
// Sub-tabs: Open Jobs (list/map), Availability, My Rates, My Families
const FindWork = window.FindWork = () => {
  const [subTab, setSubTab] = useState('jobs'); // 'jobs' | 'availability' | 'rates' | 'families'
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
  const [cancellingId, setCancellingId] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelLoading, setCancelLoading] = useState(false);
  const [radiusMiles, setRadiusMiles] = useState(10);
  const mapRef = useRef(null);
  const leafletMap = useRef(null);
  const markersRef = useRef([]);
  const circleRef = useRef(null);
  const { showToast } = useToast();

  // ── My Rates state ──
  const [rates, setRates] = useState({ daytime: '', nighttime: '', overnight: '' });
  const [minOvernightHours, setMinOvernightHours] = useState(6);
  const [savingRates, setSavingRates] = useState(false);
  const [ratesLoaded, setRatesLoaded] = useState(false);

  // ── My Families state ──
  const [assignments, setAssignments] = useState([]);
  const [loadingAssignments, setLoadingAssignments] = useState(false);

  // Fetch rates when switching to rates tab
  useEffect(() => {
    if (subTab === 'rates' && !ratesLoaded) {
      apiFetch('/api/caregivers/me').then(async r => {
        if (r?.ok) {
          const d = await r.json();
          const p = d.profile || d.caregiver || {};
          setRates({
            daytime: p.hourly_rate || p.hourlyRate || '',
            nighttime: p.nighttime_rate || p.nighttimeRate || '',
            overnight: p.overnight_rate || p.overnightRate || '',
          });
          setMinOvernightHours(p.min_overnight_hours || 6);
          setRatesLoaded(true);
        }
      }).catch(() => {});
    }
  }, [subTab, ratesLoaded]);

  // Fetch families when switching to families tab
  useEffect(() => {
    if (subTab === 'families') {
      setLoadingAssignments(true);
      apiFetch('/api/assignments').then(async r => {
        if (r?.ok) {
          const d = await r.json();
          setAssignments(d.assignments || d || []);
        }
      }).catch(() => {}).finally(() => setLoadingAssignments(false));
    }
  }, [subTab]);

  const handleSaveRates = async () => {
    setSavingRates(true);
    try {
      const res = await apiFetch('/api/caregivers/rates', {
        method: 'PUT',
        body: JSON.stringify({
          rateDaytime: parseFloat(rates.daytime) || null,
          rateNighttime: parseFloat(rates.nighttime) || null,
          rateOvernight: parseFloat(rates.overnight) || null,
        }),
      });
      if (res?.ok) showToast('Rates saved!', 'success');
      else showToast('Failed to save rates', 'error');
    } catch { showToast('Failed to save rates', 'error'); }
    setSavingRates(false);
  };

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

  const handleCancelSession = async (sessionId) => {
    setCancelLoading(true);
    try {
      const res = await apiFetch(`/api/sessions/${sessionId}/cancel`, {
        method: 'PUT',
        body: JSON.stringify({ reason: cancelReason || 'Cancelled by caregiver' }),
      });
      if (res?.ok) {
        setCancellingId(null);
        setCancelReason('');
        fetchData();
      } else {
        const err = await res?.json().catch(() => ({}));
        alert(err?.error || 'Failed to cancel');
      }
    } catch { alert('Failed to cancel session'); }
    setCancelLoading(false);
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

      const recipient = s.recipient_name || s.recipientName || 'Care Recipient';
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
          <div style="font-size:10px;font-weight:400;opacity:0.9">${service}${cost ? ' · $' + Math.round(parseFloat(s.caregiver_payout || cost)) : ''}</div>
        </div>`,
        iconSize: [0, 0], iconAnchor: [0, 40],
      });

      const marker = L.marker([lat, lng], { icon }).addTo(map);
      marker.bindPopup(`
        <div style="min-width:160px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px">${recipient}</div>
          <div style="font-size:12px;color:#666;margin-bottom:2px">${service}</div>
          <div style="font-size:12px;color:#666;margin-bottom:2px">📅 ${dateStr} 🕐 ${time || ''}</div>
          ${cost ? '<div style="font-size:14px;font-weight:700;color:#1b6b5a;margin-top:4px">$' + Math.round(parseFloat(s.caregiver_payout || cost)) + ' <span style=\\"font-size:10px;font-weight:600;color:#1b6b5a\\">your earnings</span></div>' : ''}
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

  // ── Sub-tab bar style ──
  const subTabStyle = (id) => ({
    padding: '8px 18px', background: 'none', border: 'none',
    borderBottom: subTab === id ? '3px solid #1b6b5a' : '3px solid transparent',
    fontWeight: subTab === id ? 700 : 500, fontSize: 13, cursor: 'pointer',
    color: subTab === id ? '#1b6b5a' : '#888', fontFamily: 'inherit', transition: 'all 0.15s',
  });

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>🔍</span> Find Work
        </h1>
        <p className="page-subtitle">Your work hub — find jobs, set rates, manage availability</p>
      </div>

      {/* ── Sub-tab navigation ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', marginBottom: 16, overflowX: 'auto' }}>
        <button onClick={() => setSubTab('jobs')} style={subTabStyle('jobs')}>🔔 Open Jobs</button>
        <button onClick={() => setSubTab('availability')} style={subTabStyle('availability')}>🕐 Availability</button>
        <button onClick={() => setSubTab('rates')} style={subTabStyle('rates')}>💰 My Rates</button>
        <button onClick={() => setSubTab('families')} style={subTabStyle('families')}>👪 My Families</button>
      </div>

      {/* ═══ AVAILABILITY SUB-TAB ═══ */}
      {subTab === 'availability' && (
        typeof AvailabilityTab !== 'undefined'
          ? React.createElement(AvailabilityTab)
          : <div className="card" style={{ padding: 24, textAlign: 'center', color: '#888' }}>Availability calendar loading...</div>
      )}

      {/* ═══ MY RATES SUB-TAB ═══ */}
      {subTab === 'rates' && (
        <div>
          <div className="card" style={{ padding: 20, marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, color: '#1b6b5a' }}>💰 Your Hourly Rates</h3>
            <p style={{ fontSize: 13, color: '#666', margin: '0 0 16px', lineHeight: 1.6 }}>
              Set your rates for each time tier. Families see these rates when booking, and your earnings are calculated based on when the session falls.
            </p>
            <div style={{ display: 'grid', gap: 14 }}>
              {[
                { key: 'daytime', label: 'Daytime (7am – 6pm)', icon: '☀️' },
                { key: 'nighttime', label: 'Evening (6pm – 12am)', icon: '🌆' },
                { key: 'overnight', label: 'Overnight (12am – 7am)', icon: '🌙' },
              ].map(tier => (
                <div key={tier.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 18, width: 28, textAlign: 'center' }}>{tier.icon}</span>
                  <label style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#333' }}>{tier.label}</label>
                  <div style={{ position: 'relative', width: 100 }}>
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: '#888' }}>$</span>
                    <input type="number" value={rates[tier.key]} onChange={e => setRates(r => ({ ...r, [tier.key]: e.target.value }))}
                      placeholder="0" min="0" step="0.50"
                      style={{ width: '100%', padding: '8px 10px 8px 24px', borderRadius: 8, border: '1px solid #d0d0d0', fontSize: 14, boxSizing: 'border-box' }} />
                  </div>
                  <span style={{ fontSize: 12, color: '#888' }}>/hr</span>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 16, padding: '12px 14px', background: '#f0faf8', borderRadius: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#333', flex: 1 }}>Overnight minimum hours</label>
                <input type="number" value={minOvernightHours} onChange={e => setMinOvernightHours(e.target.value)}
                  min="1" max="12" step="1"
                  style={{ width: 70, padding: '6px 10px', borderRadius: 8, border: '1px solid #d0d0d0', fontSize: 14, textAlign: 'center' }} />
                <span style={{ fontSize: 12, color: '#888' }}>hrs</span>
              </div>
              <p style={{ fontSize: 11, color: '#666', margin: '6px 0 0', lineHeight: 1.5 }}>
                If a session includes overnight hours, the family is charged for at least this many hours at your overnight rate.
              </p>
            </div>

            <button onClick={handleSaveRates} disabled={savingRates}
              style={{ marginTop: 16, width: '100%', padding: 12, background: '#1b6b5a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: savingRates ? 'wait' : 'pointer', opacity: savingRates ? 0.7 : 1 }}>
              {savingRates ? 'Saving...' : 'Save Rates'}
            </button>
          </div>

          <div className="card" style={{ padding: 20 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, color: '#333' }}>How Pricing Works</h3>
            <div style={{ fontSize: 13, color: '#555', lineHeight: 1.7 }}>
              <p style={{ margin: '0 0 10px' }}><strong>Platform fee (20%)</strong> — added to the family's cost, not deducted from your earnings. If your rate is $30/hr, you receive $30/hr.</p>
              <p style={{ margin: '0 0 10px' }}><strong>Short-notice bookings (&lt;24 hours)</strong> — a 20% rush surcharge is added. 75% of the surcharge goes to you as an incentive for taking last-minute work.</p>
              <p style={{ margin: 0 }}><strong>Instant payouts</strong> — choose instant payouts in Account → Payments for same-day deposits (+2% processing fee), or keep standard free payouts (1–2 business days).</p>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MY FAMILIES SUB-TAB ═══ */}
      {subTab === 'families' && (
        <div>
          {loadingAssignments ? (
            <div className="card" style={{ padding: 24, textAlign: 'center', color: '#888' }}>Loading assigned families...</div>
          ) : assignments.length > 0 ? (
            <div style={{ display: 'grid', gap: 12 }}>
              {assignments.map(a => {
                const name = `${a.first_name || a.firstName || ''} ${a.last_name || a.lastName || ''}`.trim() || 'Care Recipient';
                const city = a.location_city || a.city || '';
                const conditions = a.health_conditions || a.healthConditions;
                const condList = conditions ? (typeof conditions === 'string' ? JSON.parse(conditions) : conditions) : [];
                const isFav = a.is_favorite || a.isFavorite;
                return (
                  <div key={a.id || a.care_recipient_id} className="card" style={{ padding: 16, borderLeft: isFav ? '4px solid #f59e0b' : '4px solid #42a5f5' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 16, color: '#1a1a2e', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {isFav && <span title="Favorite">⭐</span>}
                          {name}
                        </div>
                        {city && <div style={{ fontSize: 13, color: '#666', marginTop: 2 }}>📍 {city}{a.location_state ? `, ${a.location_state}` : ''}</div>}
                        {a.location_address && <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{a.location_address}</div>}
                      </div>
                    </div>
                    {condList.length > 0 && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                        {condList.map((c, i) => (
                          <span key={i} style={{ padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600, background: '#fff3e0', color: '#e65100' }}>{c}</span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>👪</div>
              <h3 style={{ margin: '0 0 8px', color: '#333', fontSize: 16 }}>No assigned families yet</h3>
              <p style={{ color: '#888', fontSize: 13, margin: 0 }}>
                When you accept care requests, families will appear here as your assigned clients.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ═══ OPEN JOBS SUB-TAB ═══ */}
      {subTab === 'jobs' && <>

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
                const recipient = s.recipient_name || s.recipientName || 'Care Recipient';
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
                          {cost ? `$${Math.round(parseFloat(s.caregiver_payout || cost))}` : '\u2014'}
                        </div>
                        <div style={{ fontSize: 11, color: '#1b6b5a', fontWeight: 600 }}>Your earnings</div>
                        <div style={{ fontSize: 11, color: '#888' }}>
                          {cost && duration ? `$${Math.round((s.caregiver_payout || cost) / duration)}/hr` : ''}
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
                const recipient = s.recipient_name || s.recipientName || 'Care Recipient';
                const cost = s.caregiver_payout || s.estimated_cost || s.estimatedCost || s.actual_cost;
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                          padding: '3px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                          background: sc.bg, color: sc.text, textTransform: 'capitalize',
                        }}>{s.status}</span>
                        {['confirmed', 'pending'].includes(s.status) && (
                          <button onClick={() => setCancellingId(s.id)} style={{
                            padding: '3px 10px', borderRadius: 6, border: '1px solid #e0e0e0',
                            background: '#fff', color: '#c62828', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                          }}>Cancel</button>
                        )}
                      </div>
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
      </>}

      {/* Cancel Confirmation Modal */}
      {cancellingId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 400, maxWidth: '90vw' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 18 }}>Cancel Session</h3>
            {(() => {
              const s = upcomingSessions.find(x => x.id === cancellingId);
              if (!s) return null;
              const sessionDT = new Date(`${s.scheduled_date || s.date}T${s.scheduled_time || s.time || '00:00'}`);
              const hoursAway = (sessionDT - new Date()) / (1000 * 60 * 60);
              const isLate = hoursAway < 24;
              return (
                <div>
                  <div style={{ fontSize: 14, color: '#333', marginBottom: 12 }}>
                    {s.recipient_name || s.recipientName} — {s.scheduled_date || s.date}
                  </div>
                  {isLate && (
                    <div style={{ padding: '10px 14px', background: '#fce4ec', borderRadius: 8, border: '1px solid #ef9a9a', marginBottom: 12, fontSize: 13, color: '#c62828' }}>
                      This is a <strong>late cancellation</strong> (less than 24 hours before the session). The family will be able to leave a review.
                    </div>
                  )}
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: 'block', fontSize: 12, color: '#888', marginBottom: 4 }}>Reason (optional)</label>
                    <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)}
                      placeholder="Why are you cancelling?"
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, minHeight: 60, resize: 'vertical' }} />
                  </div>
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                    <button onClick={() => { setCancellingId(null); setCancelReason(''); }}
                      style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                      Keep Session
                    </button>
                    <button onClick={() => handleCancelSession(cancellingId)} disabled={cancelLoading}
                      style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: cancelLoading ? '#999' : '#c62828', color: '#fff', fontSize: 13, fontWeight: 600, cursor: cancelLoading ? 'wait' : 'pointer' }}>
                      {cancelLoading ? 'Cancelling...' : 'Cancel Session'}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
};
