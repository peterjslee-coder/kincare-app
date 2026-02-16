const AreaMap = window.AreaMap = () => {
  const mapRef = useRef(null);
  const leafletMap = useRef(null);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAssignments = async () => {
      try {
        const res = await apiFetch('/api/assignments');
        if (res?.ok) {
          const data = await res.json();
          setAssignments(data.assignments || []);
        }
      } catch (err) {
        console.error('AreaMap fetch error:', err);
      }
      setLoading(false);
    };
    fetchAssignments();
  }, []);

  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;

    // Initialize Leaflet map centered on Blacksburg, VA
    const map = L.map(mapRef.current, {
      center: [37.2296, -80.4139],
      zoom: 13,
      zoomControl: true,
      scrollWheelZoom: true,
    });

    // OpenStreetMap tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);

    leafletMap.current = map;

    // Force a resize after mount (Leaflet quirk with hidden containers)
    setTimeout(() => map.invalidateSize(), 100);

    return () => {
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
      }
    };
  }, []);

  // Add markers when assignments load
  useEffect(() => {
    if (!leafletMap.current || assignments.length === 0) return;

    const map = leafletMap.current;

    // Demo coordinates for Blacksburg-area families
    // (In production these would come from real geocoded addresses)
    const locationCoords = {
      'Blacksburg': [37.2296, -80.4139],
      'Christiansburg': [37.1299, -80.4089],
    };

    // Offset pins slightly so they don't stack
    const offsets = [
      [0.005, -0.003],
      [-0.004, 0.006],
      [0.007, 0.004],
      [-0.006, -0.005],
    ];

    // Custom pin icon
    const pinIcon = L.divIcon({
      className: 'inplace-map-pin',
      html: '<div style="background:#1b6b5a;color:#fff;padding:4px 10px;border-radius:8px 8px 8px 0;font-size:12px;font-weight:600;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.3);font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;"></div>',
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });

    const bounds = [];

    assignments.forEach((a, idx) => {
      const city = a.location_city || 'Blacksburg';
      const baseCoords = locationCoords[city] || locationCoords['Blacksburg'];
      const offset = offsets[idx % offsets.length];
      const lat = baseCoords[0] + offset[0];
      const lng = baseCoords[1] + offset[1];

      const icon = L.divIcon({
        className: '',
        html: `<div style="
          background:#1b6b5a;color:#fff;padding:6px 12px;border-radius:10px 10px 10px 0;
          font-size:12px;font-weight:600;white-space:nowrap;
          box-shadow:0 2px 8px rgba(0,0,0,0.3);
          font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;
          transform:translate(-50%,-100%);
        ">
          <div>📍 ${a.recipient_first_name} ${a.recipient_last_name}</div>
          <div style="font-size:10px;font-weight:400;opacity:0.85;margin-top:2px">
            ${a.location_address ? a.location_address + ', ' : ''}${city}
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
          <div style="font-size:12px;color:#888;margin-bottom:6px">📍 ${a.location_address ? a.location_address + ', ' : ''}${city}, ${a.location_state || 'VA'}</div>
          ${healthBadges ? '<div style="margin-top:4px">' + healthBadges + '</div>' : ''}
          ${a.is_favorite ? '<div style="margin-top:6px;font-size:11px;color:#1b6b5a;font-weight:600">⭐ Favorite assignment</div>' : ''}
        </div>
      `);

      bounds.push([lat, lng]);
    });

    // Fit map to show all pins
    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });
    }
  }, [assignments]);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>🗺️</span> Area Map
        </h1>
        <p className="page-subtitle">Your assigned families in the Blacksburg area</p>
      </div>

      {/* Quick summary cards */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {assignments.map((a, idx) => (
          <div key={idx} style={{
            flex: '1 1 200px', padding: '12px 16px', background: '#fff', borderRadius: '8px',
            border: a.is_favorite ? '2px solid #1b6b5a' : '1px solid #e0e0e0',
            cursor: 'pointer',
          }}
            onClick={() => {
              if (leafletMap.current) {
                const city = a.location_city || 'Blacksburg';
                const coords = city === 'Christiansburg' ? [37.1299, -80.4089] : [37.2296, -80.4139];
                const offsets = [[0.005,-0.003],[-0.004,0.006],[0.007,0.004],[-0.006,-0.005]];
                const off = offsets[idx % offsets.length];
                leafletMap.current.flyTo([coords[0]+off[0], coords[1]+off[1]], 15, { duration: 0.8 });
              }
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '16px' }}>{a.is_favorite ? '⭐' : '📍'}</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: '13px', color: '#333' }}>
                  {a.recipient_first_name} {a.recipient_last_name}
                </div>
                <div style={{ fontSize: '11px', color: '#888' }}>{a.location_city || 'Blacksburg'}</div>
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
        Map data &copy; OpenStreetMap contributors &bull; Pin locations are approximate for demo
      </div>
    </div>
  );
};
