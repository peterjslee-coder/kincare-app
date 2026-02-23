const AreaMap = window.AreaMap = () => {
  const mapRef = useRef(null);
  const leafletMap = useRef(null);
  const markersRef = useRef([]);
  const circleRef = useRef(null);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [radiusMiles, setRadiusMiles] = useState(10);
  const [profileCenter, setProfileCenter] = useState(null); // caregiver's registered location

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch assignments and caregiver profile in parallel
        const [assignRes, profileRes] = await Promise.all([
          apiFetch('/api/assignments'),
          apiFetch('/api/caregivers/me'),
        ]);
        if (assignRes?.ok) {
          const data = await assignRes.json();
          setAssignments(data.assignments || []);
        }
        if (profileRes?.ok) {
          const data = await profileRes.json();
          const p = data.profile || data.caregiver;
          if (p?.latitude && p?.longitude) {
            setProfileCenter([p.latitude, p.longitude]);
          }
        }
      } catch (err) {
        console.error('AreaMap fetch error:', err);
      }
      setLoading(false);
    };
    fetchData();
  }, []);

  // Initialize Leaflet map once
  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;

    // Default to Blacksburg — will re-center when profile loads
    const center = [37.2296, -80.4139];

    const map = L.map(mapRef.current, {
      center,
      zoom: 13,
      zoomControl: true,
      scrollWheelZoom: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);

    leafletMap.current = map;
    setTimeout(() => map.invalidateSize(), 100);

    return () => {
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
      }
    };
  }, []);

  // Re-center map when caregiver's profile location loads
  useEffect(() => {
    if (!leafletMap.current) return;
    if (profileCenter) {
      leafletMap.current.setView(profileCenter, 13);
    } else if (!loading && navigator.geolocation) {
      // Only use browser geolocation as last resort when profile has no coordinates
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          if (leafletMap.current) leafletMap.current.setView([latitude, longitude], 13);
        },
        () => {},
        { timeout: 5000, maximumAge: 300000 }
      );
    }
  }, [profileCenter, loading]);

  // Add markers when assignments load — use real lat/lng from API
  useEffect(() => {
    if (!leafletMap.current || assignments.length === 0) return;
    const map = leafletMap.current;

    // Clear previous markers
    markersRef.current.forEach(m => map.removeLayer(m));
    markersRef.current = [];

    const bounds = [];

    assignments.forEach((a) => {
      const lat = a.latitude;
      const lng = a.longitude;

      // Skip assignments without coordinates
      if (!lat || !lng) return;

      const icon = L.divIcon({
        className: '',
        html: `<div style="
          background:#1b6b5a;color:#fff;padding:6px 12px;border-radius:10px 10px 10px 0;
          font-size:12px;font-weight:600;white-space:nowrap;
          box-shadow:0 2px 8px rgba(0,0,0,0.3);
          font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;
          transform:translate(-50%,-100%);
        ">
          <div>${a.is_favorite ? '⭐' : '📍'} ${a.recipient_first_name} ${a.recipient_last_name}</div>
          <div style="font-size:10px;font-weight:400;opacity:0.85;margin-top:2px">
            ${a.location_address ? a.location_address + ', ' : ''}${a.location_city || 'Unknown'}
          </div>
        </div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 40],
      });

      const marker = L.marker([lat, lng], { icon }).addTo(map);

      // Popup with family details
      const healthBadges = (a.health_conditions || [])
        .map(h => `<span style="display:inline-block;padding:2px 6px;background:#fff3e0;color:#e65100;border-radius:10px;font-size:10px;margin:2px">${h}</span>`)
        .join('');

      marker.bindPopup(`
        <div style="min-width:180px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px">${a.recipient_first_name} ${a.recipient_last_name}</div>
          <div style="font-size:12px;color:#666;margin-bottom:4px">Family: ${a.family_first_name} ${a.family_last_name}</div>
          <div style="font-size:12px;color:#888;margin-bottom:6px">📍 ${a.location_address ? a.location_address + ', ' : ''}${a.location_city || 'Unknown'}, ${a.location_state || ''}</div>
          ${healthBadges ? '<div style="margin-top:4px">' + healthBadges + '</div>' : ''}
          ${a.is_favorite ? '<div style="margin-top:6px;font-size:11px;color:#1b6b5a;font-weight:600">⭐ Favorite assignment</div>' : ''}
        </div>
      `);

      markersRef.current.push(marker);
      bounds.push([lat, lng]);
    });

    // Include caregiver's own location in bounds if available
    if (profileCenter) {
      bounds.push(profileCenter);
    }

    // Fit map to show all pins
    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });
    }
  }, [assignments, profileCenter]);

  // Draw radius circle around the caregiver's location (or centroid of assignments)
  useEffect(() => {
    if (!leafletMap.current) return;
    const map = leafletMap.current;

    // Remove old circle
    if (circleRef.current) {
      map.removeLayer(circleRef.current);
      circleRef.current = null;
    }

    // Prefer caregiver's registered location for the radius circle center
    let centerLat, centerLng;
    if (profileCenter) {
      [centerLat, centerLng] = profileCenter;
    } else {
      // Fall back to centroid of assignments
      const validAssignments = assignments.filter(a => a.latitude && a.longitude);
      if (validAssignments.length === 0) return;
      centerLat = validAssignments.reduce((s, a) => s + a.latitude, 0) / validAssignments.length;
      centerLng = validAssignments.reduce((s, a) => s + a.longitude, 0) / validAssignments.length;
    }

    // Draw radius circle (miles → meters: 1 mile = 1609.34m)
    circleRef.current = L.circle([centerLat, centerLng], {
      radius: radiusMiles * 1609.34,
      color: '#1b6b5a',
      fillColor: '#1b6b5a',
      fillOpacity: 0.06,
      weight: 2,
      dashArray: '6 4',
    }).addTo(map);
  }, [assignments, radiusMiles, profileCenter]);

  const flyToAssignment = (a) => {
    if (leafletMap.current && a.latitude && a.longitude) {
      leafletMap.current.flyTo([a.latitude, a.longitude], 15, { duration: 0.8 });
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>🗺️</span> Area Map
        </h1>
        <p className="page-subtitle">Your assigned families in the area</p>
      </div>

      {/* Radius control */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px',
        padding: '10px 16px', background: '#f0faf8', borderRadius: '8px', flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#1b6b5a' }}>Service Radius:</span>
        {[5, 10, 15, 25].map(r => (
          <button key={r} onClick={() => setRadiusMiles(r)} style={{
            padding: '4px 12px', borderRadius: '12px', fontSize: '12px', fontWeight: 600,
            border: radiusMiles === r ? '2px solid #1b6b5a' : '1px solid #ccc',
            background: radiusMiles === r ? '#1b6b5a' : '#fff',
            color: radiusMiles === r ? '#fff' : '#666',
            cursor: 'pointer',
          }}>{r} mi</button>
        ))}
      </div>

      {/* Quick summary cards */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {assignments.map((a, idx) => (
          <div key={idx} style={{
            flex: '1 1 200px', padding: '12px 16px', background: '#fff', borderRadius: '8px',
            border: a.is_favorite ? '2px solid #1b6b5a' : '1px solid #e0e0e0',
            cursor: 'pointer', transition: 'box-shadow 0.2s',
          }}
            onClick={() => flyToAssignment(a)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '16px' }}>{a.is_favorite ? '⭐' : '📍'}</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: '13px', color: '#333' }}>
                  {a.recipient_first_name} {a.recipient_last_name}
                </div>
                <div style={{ fontSize: '11px', color: '#888' }}>
                  {a.location_city || 'Unknown'}, {a.location_state || ''}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Map container */}
      <div style={{ borderRadius: '12px', overflow: 'hidden', border: '1px solid #e0e0e0', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
        <div ref={mapRef} style={{ height: '500px', width: '100%' }} />
      </div>

      <div style={{ marginTop: '10px', fontSize: '11px', color: '#aaa', textAlign: 'center' }}>
        Map data &copy; OpenStreetMap contributors &bull; Leaflet
      </div>
    </div>
  );
};
