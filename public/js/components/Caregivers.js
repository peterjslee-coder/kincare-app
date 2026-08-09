const Caregivers = window.Caregivers = () => {
  const [caregivers, setCaregivers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [recipients, setRecipients] = useState([]);
  const [loading, setLoading] = useState(true);
  // Open the main RequestCareModal with a caregiver pre-selected
  const scheduleCaregiver = (cg) => {
    if (window.__openRequestCareModal) {
      window.__openRequestCareModal(null, {
        name: cg.name || `${cg.first_name || ''} ${cg.last_name || ''}`.trim(),
        caregiverId: cg.caregiver_profile_id || cg.id,
        userId: cg.user_id || cg.userId,
        rate: cg.rateDaytime ? `$${cg.rateDaytime}/hr` : (cg.hourlyRate ? `$${cg.hourlyRate}/hr` : '$30/hr'),
        available: true,
      });
    }
  };
  const [activeTab, setActiveTab] = useState('nearby');
  const { showToast } = useToast();

  // Privacy: hide caregiver full names in browse — show first name + last initial only
  // Full names are revealed only after in-app connection/assignment
  const privacyName = (cg, isAssigned) => {
    if (isAssigned) return cg.name || 'Caregiver'; // assigned caregivers show full name
    if (!cg.name) return 'Caregiver';
    const parts = cg.name.trim().split(/\s+/);
    if (parts.length < 2) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1][0]}.`;
  };

  // Location search state
  const [searchAddress, setSearchAddress] = useState('');
  const [searchRadius, setSearchRadius] = useState(25);
  const [searchCenter, setSearchCenter] = useState(null);
  const [locationResults, setLocationResults] = useState([]);
  const [searchFailed, setSearchFailed] = useState(false); // v1.105.51
  const [locationLoading, setLocationLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Map refs
  const mapRef = useRef(null);
  const leafletMap = useRef(null);
  const markersRef = useRef([]);
  const circleRef = useRef(null);
  const autoSearchedRef = useRef(false);

  const fetchData = async () => {
    try {
      const [cgRes, assignRes, dashRes] = await Promise.all([
        apiFetch('/api/caregivers?radius=100'),
        apiFetch('/api/assignments'),
        apiFetch('/api/dashboard'),
      ]);
      if (cgRes?.ok) {
        const d = await cgRes.json();
        setCaregivers(d.caregivers || []);
      }
      if (assignRes?.ok) {
        const d = await assignRes.json();
        setAssignments(d.assignments || []);
      }
      if (dashRes?.ok) {
        const d = await dashRes.json();
        setRecipients(d.careRecipients || []);

        // Auto-populate search with first recipient's zip or city, then auto-search
        const first = (d.careRecipients || [])[0];
        if (first && !searchAddress) {
          const zip = first.location_zip || first.locationZip;
          const city = first.location_city || first.locationCity;
          const state = first.location_state || first.locationState;
          const addr = zip || (city ? `${city}, ${state || 'VA'}` : '');
          if (addr) {
            setSearchAddress(addr);
            // Also set center from recipient coords if available
            if (first.latitude && first.longitude) {
              setSearchCenter({ lat: first.latitude, lng: first.longitude });
            }
          }
        }
      }
    } catch (err) {
      console.error('Fetch caregivers error:', err);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  // Auto-search nearby tab when address is populated from recipient
  useEffect(() => {
    if (searchAddress && activeTab === 'nearby' && !autoSearchedRef.current && !hasSearched) {
      autoSearchedRef.current = true;
      handleLocationSearch();
    }
  }, [searchAddress, activeTab]);

  const handleAssign = async (caregiverProfileId, recipientId) => {
    try {
      const res = await apiFetch('/api/assignments', {
        method: 'POST',
        body: JSON.stringify({ caregiverProfileId, careRecipientId: recipientId }),
      });
      if (res?.ok) { await fetchData(); showToast('Caregiver assigned', 'success'); }
      else showToast('Failed to assign caregiver', 'error');
    } catch (err) {
      console.error('Assign error:', err);
      showToast('Failed to assign caregiver', 'error');
    }
  };

  const handleUnassign = async (assignmentId) => {
    try {
      const res = await apiFetch(`/api/assignments/${assignmentId}`, { method: 'DELETE' });
      if (res?.ok) { await fetchData(); showToast('Caregiver removed', 'success'); }
    } catch (err) {
      console.error('Unassign error:', err);
      showToast('Failed to remove caregiver', 'error');
    }
  };

  const handleToggleFavorite = async (assignmentId) => {
    try {
      const res = await apiFetch(`/api/assignments/${assignmentId}/favorite`, { method: 'PUT' });
      if (res?.ok) { await fetchData(); showToast('Favorite updated', 'success'); }
    } catch (err) {
      console.error('Favorite toggle error:', err);
    }
  };

  // ─── Location Search ───
  const handleLocationSearch = async () => {
    if (!searchAddress.trim()) return;
    setLocationLoading(true);
    setHasSearched(true);
    try {
      const params = new URLSearchParams({
        address: searchAddress,
        radius: searchRadius.toString(),
      });
      // v1.105.51 — a failed search left locationResults untouched and the panel said "No
      // caregivers found in this area." A family looking for help was told nobody was
      // nearby when the search had simply failed.
      const res = await apiFetch(`/api/caregivers?${params}`);
      if (!res?.ok) {
        setSearchFailed(true);
        showToast('Search failed — please try again', 'error');
      } else {
        const data = await res.json();
        setSearchFailed(false);
        setLocationResults(data.caregivers || []);
        setSearchCenter(data.searchCenter);
      }
    } catch (err) {
      console.error('Location search error:', err);
      setSearchFailed(true);
      showToast('Search failed', 'error');
    }
    setLocationLoading(false);
  };

  // ─── Map rendering for "Find Nearby" tab ───
  useEffect(() => {
    if (activeTab !== 'nearby') return;
    // Wait for DOM
    const timer = setTimeout(() => {
      if (!mapRef.current) return;

      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
      }

      const map = L.map(mapRef.current, {
        center: searchCenter ? [searchCenter.lat, searchCenter.lng] : [37.2296, -80.4139],
        zoom: 12,
        zoomControl: true,
        scrollWheelZoom: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 18,
      }).addTo(map);

      leafletMap.current = map;
      map.invalidateSize(true);
      // Force multiple invalidateSize calls to handle layout timing
      const forceResize = () => { if (leafletMap.current) leafletMap.current.invalidateSize(true); };
      forceResize();
      setTimeout(forceResize, 100);
      setTimeout(forceResize, 300);
      setTimeout(forceResize, 600);
      setTimeout(forceResize, 1200);
      // Also use ResizeObserver for robust detection of container sizing
      if (window.ResizeObserver && mapRef.current) {
        const ro = new ResizeObserver(() => forceResize());
        ro.observe(mapRef.current);
        setTimeout(() => ro.disconnect(), 3000);
      }

      // If no search center, try recipient coords or browser geolocation as fallback
      if (!searchCenter) {
        // v1.105.54 — plugin-first; see getDeviceLocation.
        getDeviceLocation({ timeoutMs: 5000 }).then(({ pos }) => {
          if (pos && leafletMap.current) {
            leafletMap.current.setView([pos.coords.latitude, pos.coords.longitude], 12);
          }
        });
      }
    }, 100);

    return () => {
      clearTimeout(timer);
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
      }
    };
  }, [activeTab, searchCenter]);

  // Update map markers when search results change
  useEffect(() => {
    if (activeTab !== 'nearby') return;
    // Map is created with a 100ms delay, so wait for it
    const waitForMap = () => {
      if (!leafletMap.current) return setTimeout(waitForMap, 50);
      renderMarkers();
    };
    const markerCleanup = { fn: null };
    const renderMarkers = () => {
    const map = leafletMap.current;
    if (!map) return;
    const assignedCgIds = new Set(assignments.map(a => a.caregiver_profile_id));

    // Clear old
    markersRef.current.forEach(m => map.removeLayer(m));
    markersRef.current = [];
    if (circleRef.current) { map.removeLayer(circleRef.current); circleRef.current = null; }

    const bounds = [];

    // Draw search radius circle
    if (searchCenter) {
      circleRef.current = L.circle([searchCenter.lat, searchCenter.lng], {
        radius: searchRadius * 1609.34,
        color: 'var(--accent-color)',
        fillColor: 'var(--accent-color)',
        fillOpacity: 0.06,
        weight: 2,
        dashArray: '6 4',
      }).addTo(map);

      // Search center marker
      const centerIcon = L.divIcon({
        className: '',
        html: `<div style="background:#e8724a;color:#fff;width:12px;height:12px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      const cm = L.marker([searchCenter.lat, searchCenter.lng], { icon: centerIcon }).addTo(map);
      cm.bindPopup(`<div style="font-family:sans-serif;font-size:12px"><strong>Search Center</strong><br/>${searchAddress}</div>`);
      markersRef.current.push(cm);
      bounds.push([searchCenter.lat, searchCenter.lng]);
    }

    // Merge location results + assigned caregivers, applying fallback coords for those without location
    const fallbackLat = searchCenter?.lat || (recipients[0] && (recipients[0].latitude || recipients[0].lat));
    const fallbackLng = searchCenter?.lng || (recipients[0] && (recipients[0].longitude || recipients[0].lng));
    const locationCgIds = new Set(locationResults.map(cg => cg.id));

    // Start with location results, applying fallback coords to assigned ones without lat/lng
    const allMapCaregivers = locationResults.map(cg => {
      if (!cg.latitude && !cg.longitude && assignedCgIds.has(cg.id) && fallbackLat) {
        return { ...cg, latitude: fallbackLat, longitude: fallbackLng, isAssigned: true, distance: null };
      }
      return cg;
    });

    // Add assigned caregivers not already in location results
    assignments.forEach(a => {
      const cg = caregivers.find(c => c.id === a.caregiver_profile_id);
      if (cg && !locationCgIds.has(cg.id)) {
        const lat = cg.latitude || fallbackLat;
        const lng = cg.longitude || fallbackLng;
        if (lat && lng) {
          allMapCaregivers.push({ ...cg, latitude: lat, longitude: lng, isAssigned: true, distance: null });
        }
      }
    });

    // Caregiver pins — offset colocated markers in a spiral
    const cgLocCounts = {};
    allMapCaregivers.forEach((cg) => {
      if (!cg.latitude || !cg.longitude) return;

      // Offset colocated markers so they don't stack
      let pinLat = cg.latitude, pinLng = cg.longitude;
      const locKey = parseFloat(cg.latitude).toFixed(4) + ',' + parseFloat(cg.longitude).toFixed(4);
      cgLocCounts[locKey] = (cgLocCounts[locKey] || 0) + 1;
      const cgIdx = cgLocCounts[locKey] - 1;
      if (cgIdx > 0) {
        const angle = (cgIdx * 137.5) * Math.PI / 180;
        const dist = 0.0008 * Math.sqrt(cgIdx);
        pinLat += dist * Math.cos(angle);
        pinLng += dist * Math.sin(angle);
      }

      const isAssigned = cg.isAssigned || assignedCgIds.has(cg.id);
      const displayName = privacyName(cg, isAssigned);
      const pinColor = isAssigned ? 'var(--accent-color)' : '#2563eb';
      const distLabel = cg.distance != null ? ` &bull; ${cg.distance}mi` : '';
      const photoHtml = cg.profilePhoto
        ? `<img src="${cg.profilePhoto}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;border:2px solid ${pinColor};margin-right:8px;flex-shrink:0" />`
        : `<div style="width:32px;height:32px;border-radius:50%;background:${pinColor};color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;border:2px solid #fff;margin-right:8px;flex-shrink:0">${(displayName || '?').split(' ').map(n => n[0]).join('').slice(0, 2)}</div>`;

      const icon = L.divIcon({
        className: 'cg-map-pin',
        html: `<div style="
          background:${pinColor};color:#fff;padding:5px 10px;border-radius:8px 8px 8px 0;
          font-size:11px;font-weight:600;white-space:nowrap;
          box-shadow:0 2px 6px rgba(0,0,0,0.3);
          font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;
          display:inline-flex;align-items:center;gap:3px;
        ">${isAssigned ? '<span style="font-size:10px;line-height:1">⭐</span>' : ''}${displayName}${distLabel}</div>`,
        iconSize: [120, 28],
        iconAnchor: [0, 28],
      });

      const marker = L.marker([pinLat, pinLng], { icon }).addTo(map);

      // Hover tooltip with thumbnail
      marker.bindTooltip(`
        <div style="display:flex;align-items:center;font-family:sans-serif;padding:2px">
          ${photoHtml}
          <div>
            <div style="font-weight:700;font-size:12px">${displayName}</div>
            <div style="font-size:10px;color:#666">${isAssigned ? 'Assigned' : ''}${cg.distance != null ? `${isAssigned ? ' · ' : ''}${cg.distance}mi away` : ''}</div>
          </div>
        </div>
      `, { direction: 'top', offset: [0, -35], className: 'caregiver-tooltip' });

      // Click popup with full details + View Profile button
      marker.bindPopup(`
        <div style="min-width:180px;font-family:sans-serif">
          <div style="display:flex;align-items:center;margin-bottom:6px">
            ${photoHtml}
            <div>
              <div style="font-weight:700;font-size:13px">${displayName}</div>
              ${isAssigned ? '<div style="font-size:10px;color:#e8724a;font-weight:600">⭐ Assigned</div>' : ''}
            </div>
          </div>
          ${cg.distance != null ? `<div style="font-size:11px;color:#666">${cg.distance} miles away</div>` : ''}
          <div style="font-size:11px;color:#888;margin-top:2px"><span title="Family rating">⭐ ${cg.rating || '—'}</span> &bull; Day $${cg.rateDaytime || cg.hourlyRate}${cg.rateNighttime && cg.rateNighttime !== cg.rateDaytime ? ` · Night $${cg.rateNighttime}` : ''}/hr</div>
          <div style="font-size:10px;color:#1b6b5a;margin-top:4px">${(cg.specialties || []).join(', ') || 'General care'}</div>
          <button data-cg-id="${cg.id}" class="map-view-profile-btn" style="margin-top:8px;width:100%;padding:6px;background:#1b6b5a;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer">View Profile</button>
        </div>
      `);
      markersRef.current.push(marker);
      bounds.push([cg.latitude, cg.longitude]);
    });

    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }

    // Event delegation for "View Profile" buttons in popups
    const handlePopupClick = (e) => {
      const btn = e.target.closest('.map-view-profile-btn');
      if (btn) {
        const cgId = btn.getAttribute('data-cg-id');
        const cg = caregivers.find(c => c.id === cgId);
        if (cg) scheduleCaregiver(cg);
      }
    };
    const container = mapRef.current;
    if (container) container.addEventListener('click', handlePopupClick);
    markerCleanup.fn = () => { if (container) container.removeEventListener('click', handlePopupClick); };
    };
    waitForMap();
    return () => { if (markerCleanup.fn) markerCleanup.fn(); };
  }, [locationResults, searchCenter, activeTab, assignments, caregivers, recipients]);

  // Build a lookup: which caregiver profiles are assigned
  const assignedMap = {};
  assignments.forEach(a => {
    const key = `${a.caregiver_profile_id}_${a.care_recipient_id}`;
    assignedMap[key] = a;
  });
  const assignedCaregiverIds = [...new Set(assignments.map(a => a.caregiver_profile_id))];

  if (loading) return <LoadingSpinner text="Loading caregivers..." />;

  // ─── Caregiver Card (reused across tabs) ───
  const CaregiverCard = ({ cg, showDistance }) => {
    const avail = CAREGIVER_AVAILABILITY[cg.name];
    const isAssigned = assignedCaregiverIds.includes(cg.id);
    return (
      <div className="card" style={{ marginBottom: '10px', padding: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)' }}>{privacyName(cg, isAssigned)}</span>
              {isAssigned && (
                <span style={{ padding: '2px 8px', background: 'var(--color-success-bg)', color: 'var(--color-success)', borderRadius: '10px', fontSize: '10px', fontWeight: 600 }}>Assigned</span>
              )}
              {showDistance && cg.distance !== undefined && (
                <span style={{ padding: '2px 8px', background: 'var(--color-warning-bg)', color: 'var(--color-warning)', borderRadius: '10px', fontSize: '10px', fontWeight: 600 }}>
                  {cg.distance} mi away
                </span>
              )}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>
              <span title="Family rating of this caregiver">⭐ {cg.rating || '—'}</span> &bull; {cg.reviewCount || 0} reviews &bull;
              {(cg.rateDaytime && cg.rateNighttime && cg.rateDaytime !== cg.rateNighttime)
                ? <> Day ${cg.rateDaytime} · Night ${cg.rateNighttime} · Overnight ${cg.rateOvernight}/hr</>
                : <> ${cg.hourlyRate || '—'}/hr</>
              }
              {cg.city && <> • {cg.city}, {cg.state || ''}</>}
            </div>
            {cg.bio && (
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', lineHeight: '1.4' }}>
                {cg.bio.length > 120 ? cg.bio.slice(0, 120) + '...' : cg.bio}
              </div>
            )}
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {(cg.specialties || []).map((s, i) => (
                <span key={i} style={{ padding: '2px 8px', background: 'var(--bg-highlight)', color: 'var(--role-color)', borderRadius: '10px', fontSize: '10px', fontWeight: 500 }}>{s}</span>
              ))}
              {cg.isBackgroundChecked ? (
                <span style={{ padding: '2px 8px', background: 'var(--color-info-bg)', color: 'var(--color-info)', borderRadius: '10px', fontSize: '10px', fontWeight: 500 }}>✓ Background checked</span>
              ) : cg.vouchedForYou ? (
                <span style={{ padding: '2px 8px', background: 'var(--color-warning-bg, #fff8e1)', color: 'var(--color-warning, #f57f17)', borderRadius: '10px', fontSize: '10px', fontWeight: 500 }} title="An InPlace admin personally vouched for this caregiver working with your family. No background check has been completed.">🤝 Admin-approved for your family · no background check</span>
              ) : null}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginLeft: '12px' }}>
            <button onClick={() => scheduleCaregiver(cg)} style={{
              padding: '8px 14px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none',
              borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
            }}>Schedule</button>
            {!isAssigned && recipients.length > 0 && (
              <select onChange={(e) => {
                if (e.target.value) handleAssign(cg.id, e.target.value);
                e.target.value = '';
              }} style={{
                padding: '6px 8px', border: '1px solid #1b6b5a', borderRadius: '6px',
                fontSize: '11px', color: 'var(--role-color)', cursor: 'pointer', background: 'var(--bg-surface)',
              }}>
                <option value="">+ Assign to...</option>
                {recipients.map(r => (
                  <option key={r.id} value={r.id}>{r.first_name} {r.last_name}</option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Caregivers</h1>
        <p className="page-subtitle">Manage your care team and find nearby caregivers</p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', borderBottom: '2px solid #e0e0e0' }}>
        {[
          { id: 'assigned', label: `Assigned (${assignments.length})`, icon: '⭐' },
          { id: 'browse', label: 'Browse All', icon: '🔍' },
          { id: 'nearby', label: 'Find Nearby', icon: '📍' },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: '13px', fontWeight: activeTab === tab.id ? 700 : 400,
            color: activeTab === tab.id ? 'var(--role-color)' : 'var(--text-tertiary)',
            borderBottom: activeTab === tab.id ? '3px solid #1b6b5a' : '3px solid transparent',
            marginBottom: '-2px',
          }}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ─── Assigned Tab ─── */}
      {activeTab === 'assigned' && (
        <div>
          {assignments.length > 0 ? assignments.map((a, idx) => {
            const cg = caregivers.find(c => c.id === a.caregiver_profile_id);
            return (
              <div key={idx} className="card" style={{ marginBottom: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  {/* Caregiver avatar */}
                  {cg?.profilePhoto ? (
                    <div style={{ width: 40, height: 40, borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}><img src={cg.profilePhoto} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>
                  ) : (
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--role-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-on-primary)', fontSize: 14, fontWeight: 600, flexShrink: 0 }}>
                      {(cg?.name || '?').split(' ').map(n => n[0]).join('').slice(0, 2)}
                    </div>
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {cg?.name || (a.first_name ? `${a.first_name} ${a.last_name || ''}`.trim() : 'Caregiver')}
                      </span>
                      <button onClick={() => handleToggleFavorite(a.id)} style={{
                        background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', padding: 0,
                      }} title={a.is_favorite ? 'Remove favorite' : 'Mark as favorite'}>
                        {a.is_favorite ? '⭐' : '☆'}
                      </button>
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                      Assigned to: <strong>{a.recipient_first_name || ''} {a.recipient_last_name || ''}</strong>
                    </div>
                    {cg && (
                      <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                        <span title="Family rating of this caregiver">⭐ {cg.rating || '—'}</span> &bull;
                        {(cg.rateDaytime && cg.rateNighttime && cg.rateDaytime !== cg.rateNighttime)
                          ? <> Day ${cg.rateDaytime} · Night ${cg.rateNighttime} · Overnight ${cg.rateOvernight}/hr</>
                          : <> ${cg.hourlyRate || '—'}/hr</>
                        } &bull; {(cg.specialties || []).join(', ') || 'General care'}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {cg && (
                      <button onClick={() => scheduleCaregiver(cg)} style={{
                        padding: '6px 14px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none',
                        borderRadius: '6px', fontSize: '12px', cursor: 'pointer', fontWeight: 600,
                      }}>Schedule</button>
                    )}
                    <button onClick={() => handleUnassign(a.id)} style={{
                      padding: '6px 14px', background: 'var(--bg-surface)', color: 'var(--color-red-strong)', border: '1px solid #fcc',
                      borderRadius: '6px', fontSize: '12px', cursor: 'pointer',
                    }}>Remove</button>
                  </div>
                </div>
              </div>
            );
          }) : (
            <div className="card" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
              No caregivers assigned yet. Browse available caregivers to get started.
            </div>
          )}
        </div>
      )}

      {/* ─── Browse All Tab ─── */}
      {activeTab === 'browse' && (
        <div>
          {caregivers.length > 0 ? caregivers.map((cg, idx) => (
            <CaregiverCard key={idx} cg={cg} showDistance={false} />
          )) : (
            <div className="card" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
              No caregivers available right now.
            </div>
          )}
        </div>
      )}

      {/* ─── Find Nearby Tab ─── */}
      {activeTab === 'nearby' && (
        <div>
          {/* Search bar */}
          <div style={{
            display: 'flex', gap: '8px', marginBottom: '16px', alignItems: 'flex-end', flexWrap: 'wrap',
          }}>
            <div style={{ flex: '1 1 250px' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                Location (address, city, or zip)
              </label>
              <input
                type="text"
                value={searchAddress}
                onChange={(e) => setSearchAddress(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLocationSearch()}
                placeholder="Blacksburg, VA or 24060"
                style={{
                  width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: '8px',
                  fontSize: '14px', boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                Radius
              </label>
              <select value={searchRadius} onChange={(e) => setSearchRadius(parseInt(e.target.value))} style={{
                padding: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', background: 'var(--bg-surface)',
              }}>
                <option value={5}>5 miles</option>
                <option value={10}>10 miles</option>
                <option value={15}>15 miles</option>
                <option value={25}>25 miles</option>
                <option value={50}>50 miles</option>
                <option value={100}>100 miles</option>
              </select>
            </div>
            <button onClick={handleLocationSearch} disabled={locationLoading} style={{
              padding: '10px 20px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none',
              borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
              opacity: locationLoading ? 0.7 : 1,
            }}>
              {locationLoading ? 'Searching...' : '🔍 Search'}
            </button>
          </div>

          {/* Map */}
          <div style={{
            borderRadius: '12px', overflow: 'hidden', border: '1px solid #e0e0e0',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)', marginBottom: '16px',
          }}>
            <div ref={mapRef} style={{ height: '350px', width: '100%' }} />
          </div>

          {/* Results list */}
          {hasSearched && (
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '10px' }}>
                {locationResults.length > 0
                  ? `${locationResults.length} caregiver${locationResults.length !== 1 ? 's' : ''} within ${searchRadius} miles`
                  : searchFailed
                    ? "That search didn't go through. Check your connection and try again."
                    : 'No caregivers found in this area. Try expanding the search radius.'
                }
              </div>
              {locationResults.map((cg, idx) => (
                <CaregiverCard key={idx} cg={cg} showDistance={true} />
              ))}
            </div>
          )}

          {!hasSearched && (
            <div className="card" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
              Enter an address above and search to find caregivers nearby.
            </div>
          )}
        </div>
      )}

      {/* Scheduling uses the main RequestCareModal via window.__openRequestCareModal */}
    </>
  );
};
