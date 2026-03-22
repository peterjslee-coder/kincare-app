// ─── FindWork — Caregiver work hub: open jobs, availability, rates, families ───
// Sub-tabs: Open Jobs (list/map), Availability, My Rates, My Families
const FindWork = window.FindWork = () => {
  const [subTab, setSubTab] = useState(() => {
    if (window.__findWorkTab) { const t = window.__findWorkTab; delete window.__findWorkTab; return t; }
    return 'jobs';
  }); // 'jobs' | 'availability' | 'rates' | 'families'
  const [openRequests, setOpenRequests] = useState([]);
  const [upcomingSessions, setUpcomingSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [claimingId, setClaimingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [filterService, setFilterService] = useState('all');
  const [rangeDays, setRangeDays] = useState(14);
  const [lastFetched, setLastFetched] = useState(null);
  const [bgCheckPaid, setBgCheckPaid] = useState(null);
  const [caregiverCleared, setCaregiverCleared] = useState(false);
  const [accountPaused, setAccountPaused] = useState(false);
  const [viewMode, setViewMode] = useState('list'); // 'list' or 'map'
  const [zipFilter, setZipFilter] = useState('');
  const [profileCenter, setProfileCenter] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelLoading, setCancelLoading] = useState(false);
  const [radiusMiles, setRadiusMiles] = useState(10);
  const [exTick, setExTick] = useState(0);
  const [proposingFor, setProposingFor] = useState(null); // session object for proposal modal
  const [proposalDate, setProposalDate] = useState('');
  const [proposalTime, setProposalTime] = useState('');
  const [proposalMsg, setProposalMsg] = useState('');
  const [proposalLoading, setProposalLoading] = useState(false);
  const [visitCounts, setVisitCounts] = useState({}); // recipientId → count
  const [pendingInterviews, setPendingInterviews] = useState([]); // interviews needing attention
  const [sortBy, setSortBy] = useState('date'); // 'date', 'match', 'distance', 'rate'
  const mapRef = useRef(null);
  const leafletMap = useRef(null);
  const markersRef = useRef([]);
  const circleRef = useRef(null);
  const { showToast } = useToast();

  // ── Availability state ──
  const [availRules, setAvailRules] = useState([]);
  const [availLoading, setAvailLoading] = useState(false);
  const [showAddRule, setShowAddRule] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [ruleForm, setRuleForm] = useState({
    type: 'available', dayOfWeek: 1, startTime: '08:00', endTime: '17:00',
    isRecurring: true, specificDate: '', note: '', selectedDays: [],
  });
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayAbbr = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const fetchAvailability = async () => {
    setAvailLoading(true);
    try {
      const res = await apiFetch('/api/availability');
      if (res?.ok) {
        const d = await res.json();
        setAvailRules(d.rules || []);
      }
    } catch (err) { console.error('Availability fetch error:', err); }
    setAvailLoading(false);
  };

  const handleSaveRule = async () => {
    try {
      if (editingRule) {
        const body = { dayOfWeek: parseInt(ruleForm.dayOfWeek), startTime: ruleForm.startTime, endTime: ruleForm.endTime, isRecurring: ruleForm.isRecurring, specificDate: ruleForm.isRecurring ? null : ruleForm.specificDate || null, type: ruleForm.type, note: ruleForm.note || null };
        await apiFetch(`/api/availability/${editingRule.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else if (ruleForm._batchDays && ruleForm._batchDays.length > 0) {
        // Batch creation from drag-to-select (specific dates)
        const cm = ruleForm._batchMonth || { year: new Date().getFullYear(), month: new Date().getMonth() };
        for (const day of ruleForm._batchDays) {
          const dateStr = `${cm.year}-${String(cm.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const d = new Date(dateStr + 'T12:00:00');
          const body = { dayOfWeek: d.getDay(), startTime: ruleForm.startTime, endTime: ruleForm.endTime, isRecurring: false, specificDate: dateStr, type: ruleForm.type, note: ruleForm.note || null };
          await apiFetch('/api/availability', { method: 'POST', body: JSON.stringify(body) });
        }
      } else if (ruleForm.isRecurring && ruleForm.selectedDays && ruleForm.selectedDays.length > 0) {
        for (const dow of ruleForm.selectedDays) {
          const body = { dayOfWeek: parseInt(dow), startTime: ruleForm.startTime, endTime: ruleForm.endTime, isRecurring: true, specificDate: null, type: ruleForm.type, note: ruleForm.note || null };
          await apiFetch('/api/availability', { method: 'POST', body: JSON.stringify(body) });
        }
      } else {
        const body = { dayOfWeek: parseInt(ruleForm.dayOfWeek), startTime: ruleForm.startTime, endTime: ruleForm.endTime, isRecurring: ruleForm.isRecurring, specificDate: ruleForm.isRecurring ? null : ruleForm.specificDate || null, type: ruleForm.type, note: ruleForm.note || null };
        await apiFetch('/api/availability', { method: 'POST', body: JSON.stringify(body) });
      }
      setShowAddRule(false);
      setEditingRule(null);
      setRuleForm({ type: 'available', dayOfWeek: 1, startTime: '08:00', endTime: '17:00', isRecurring: true, specificDate: '', note: '', selectedDays: [] });
      fetchAvailability();
    } catch (err) { console.error('Save rule error:', err); }
  };

  const handleDeleteRule = async (id) => {
    try {
      await apiFetch(`/api/availability/${id}`, { method: 'DELETE' });
      fetchAvailability();
    } catch (err) { console.error('Delete rule error:', err); }
  };

  const startEditRule = (rule) => {
    setEditingRule(rule);
    setRuleForm({ type: rule.type, dayOfWeek: rule.dayOfWeek, startTime: rule.startTime, endTime: rule.endTime, isRecurring: rule.isRecurring, specificDate: rule.specificDate || '', note: rule.note || '' });
    setShowAddRule(true);
  };

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
          setCaregiverCleared(!!data?.profile?.caregiverCleared);
          setAccountPaused(!!data?.profile?.accountPaused);
        } else {
          setBgCheckPaid(false);
          setAccountPaused(false);
        }
        if (profileRes?.ok) {
          const data = await profileRes.json();
          const p = data.profile || data.caregiver;
          if (p?.latitude && p?.longitude) {
            setProfileCenter([parseFloat(p.latitude), parseFloat(p.longitude)]);
          } else if (p?.city || p?.zip) {
            // Geocode from city/state/zip if no lat/lng stored
            try {
              const q = [p.city, p.state, p.zip].filter(Boolean).join(', ');
              const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`);
              const geoData = await geoRes.json();
              if (geoData[0]) setProfileCenter([parseFloat(geoData[0].lat), parseFloat(geoData[0].lon)]);
            } catch {}
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
      // Use dashboard API for enriched data (match quality, distance, health tags, care summary)
      const res = await apiFetch('/api/dashboard');
      if (res?.ok) {
        const d = await res.json();
        setAccountPaused(!!d?.profile?.accountPaused);
        setCaregiverCleared(!!d?.profile?.caregiverCleared);
        // openJobs from dashboard already has matchQuality, distanceMiles, healthTags, careSummary, etc.
        // Client-side safety: filter out jobs whose start time has already passed
        const now = new Date();
        const todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        const nowTimeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
        const jobs = (d.openJobs || []).filter(s => {
          const sDate = (s.date || s.scheduledDate || '').split('T')[0];
          const sTime = s.time || s.scheduledTime || '00:00';
          if (sDate < todayStr) return false;
          if (sDate === todayStr && sTime <= nowTimeStr) return false;
          return true;
        });
        // Sort direct offers (Just For You) to the top
        jobs.sort((a, b) => (b.offeredToCaregiverId ? 1 : 0) - (a.offeredToCaregiverId ? 1 : 0));
        setOpenRequests(jobs);
        // upcomingSessions from dashboard has location, payout, health info
        setUpcomingSessions(d.upcomingSessions || []);
      }
      // Fetch visit counts for repeat caregiver badges
      try {
        const vcRes = await apiFetch('/api/interviews/visit-counts');
        if (vcRes?.ok) { const vcData = await vcRes.json(); setVisitCounts(vcData.counts || {}); }
      } catch {}
      // Fetch pending interviews
      try {
        const ivRes = await apiFetch('/api/interviews/pending');
        if (ivRes?.ok) { const ivData = await ivRes.json(); setPendingInterviews(ivData.interviews || []); }
      } catch {}
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

  // Tick timer for exclusive offer countdowns (every 30s)
  useEffect(() => {
    const hasEx = openRequests.some(s => s.exclusiveUntil || s.exclusive_until);
    if (!hasEx) return;
    const iv = setInterval(() => setExTick(t => t + 1), 30000);
    return () => clearInterval(iv);
  }, [openRequests]);

  // ─── Map initialization ───
  useEffect(() => {
    if (viewMode !== 'map' || !mapRef.current) return;
    if (leafletMap.current) {
      leafletMap.current.invalidateSize();
      // Re-center on profile if available
      if (profileCenter) leafletMap.current.setView(profileCenter, 12);
      return;
    }
    const center = profileCenter || [37.2296, -80.4139];
    const map = L.map(mapRef.current, { center, zoom: 12, zoomControl: true, scrollWheelZoom: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors', maxZoom: 18,
    }).addTo(map);
    leafletMap.current = map;
    // Staggered invalidateSize for reliable rendering
    const forceResize = () => { if (leafletMap.current) leafletMap.current.invalidateSize(true); };
    forceResize();
    setTimeout(forceResize, 100);
    setTimeout(forceResize, 300);
    setTimeout(forceResize, 600);
    setTimeout(forceResize, 1200);
    if (window.ResizeObserver && mapRef.current) {
      const ro = new ResizeObserver(() => forceResize());
      ro.observe(mapRef.current);
      setTimeout(() => ro.disconnect(), 3000);
    }
  }, [viewMode, profileCenter]);

  // Re-center when profile loads (catches late-loading profile)
  useEffect(() => {
    if (leafletMap.current && profileCenter) {
      leafletMap.current.setView(profileCenter, 12);
    }
  }, [profileCenter]);

  // Service filter options
  const serviceTypes = [...new Set(openRequests.map(s => s.serviceType || s.service_type).filter(Boolean))];

  // Apply zip + service filters (computed before map effect so it can reference filteredRequests)
  let filteredRequests = openRequests;
  if (filterService !== 'all') {
    filteredRequests = filteredRequests.filter(s => (s.serviceType || s.service_type) === filterService);
  }
  if (zipFilter.trim()) {
    const z = zipFilter.trim().toLowerCase();
    filteredRequests = filteredRequests.filter(s => {
      const city = (s.recipientCity || s.recipient_city || '').toLowerCase();
      return city.includes(z);
    });
  }

  // Apply sorting
  const sortedRequests = [...filteredRequests].sort((a, b) => {
    if (sortBy === 'match') {
      return (b.matchScore || 0) - (a.matchScore || 0); // Higher match score first
    } else if (sortBy === 'distance') {
      const distA = a.distanceMiles || 999;
      const distB = b.distanceMiles || 999;
      return distA - distB; // Closer first
    } else if (sortBy === 'rate') {
      const rateA = parseFloat(a.proposedRate || a.estimated_cost / (a.duration_hours || 2)) || 0;
      const rateB = parseFloat(b.proposedRate || b.estimated_cost / (b.duration_hours || 2)) || 0;
      return rateB - rateA; // Higher rate first
    } else {
      // 'date' - default
      return 0; // Already sorted by date from server
    }
  });
  filteredRequests = sortedRequests;

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

    // Add open request markers — offset colocated pins in a spiral
    const bounds = profileCenter ? [profileCenter] : [];
    const locCounts = {};
    filteredRequests.forEach(s => {
      let lat = parseFloat(s.recipientLat || s.recipient_lat);
      let lng = parseFloat(s.recipientLng || s.recipient_lng);
      if (!lat || !lng) return;

      // Offset colocated markers in a spiral so they don't stack
      const locKey = lat.toFixed(4) + ',' + lng.toFixed(4);
      locCounts[locKey] = (locCounts[locKey] || 0) + 1;
      const idx = locCounts[locKey] - 1;
      if (idx > 0) {
        const angle = (idx * 137.5) * Math.PI / 180; // golden angle spiral
        const dist = 0.0008 * Math.sqrt(idx); // ~80m per step
        lat += dist * Math.cos(angle);
        lng += dist * Math.sin(angle);
      }

      const recipient = s.recipientName || s.recipient_name || 'Care Recipient';
      const service = (s.serviceType || s.service_type || '').replace(/_/g, ' ');
      const cost = s.estimatedCost || s.estimated_cost;
      const dateStr = s.date || s.scheduled_date;
      const time = s.time || s.scheduled_time;
      const isOffer = !!s.offeredToCaregiverId;
      const exUntil = s.exclusiveUntil ? new Date(s.exclusiveUntil) : null;
      const exRemain = exUntil ? Math.max(0, Math.floor((exUntil - new Date()) / 60000)) : null;
      const exExpired = exUntil && exRemain <= 0;
      const activeOffer = isOffer && !exExpired;
      const pinColor = activeOffer ? '#7c3aed' : '#fb8c00';

      const icon = L.divIcon({
        className: '',
        html: `<div style="
          background:${pinColor};color:#fff;padding:5px 10px;border-radius:10px 10px 10px 0;
          font-size:11px;font-weight:600;white-space:nowrap;
          box-shadow:0 2px 8px rgba(0,0,0,0.3);
          font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;
          transform:translate(-50%,-100%);
        ">
          ${activeOffer ? '<div style="font-size:9px;letter-spacing:0.5px">✨ JUST FOR YOU' + (exRemain !== null ? ' · ' + exRemain + 'm' : '') + '</div>' : ''}
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
          ${cost ? '<div style="font-size:14px;font-weight:700;color:#1b6b5a;margin-top:4px">$' + Math.round(parseFloat(s.caregiverPayout || s.caregiver_payout || cost)) + ' <span style=\\"font-size:10px;font-weight:600;color:#1b6b5a\\">your earnings</span></div>' : ''}
          ${!caregiverCleared ? '<div style="margin-top:8px;padding:6px 10px;background:#f5f5f5;border-radius:6px;text-align:center;font-size:11px;color:#888;">Complete setup to accept jobs</div>' : `<button onclick="${accountPaused ? '' : "document.dispatchEvent(new CustomEvent('findwork-claim',{detail:'" + s.id + "'}));"}" style="
            margin-top:8px;width:100%;padding:8px;background:${accountPaused ? '#ccc' : '#1b6b5a'};color:#fff;border:none;border-radius:6px;
            font-size:13px;font-weight:600;cursor:${accountPaused ? 'not-allowed' : 'pointer'};opacity:${accountPaused ? 0.6 : 1};
          " ${accountPaused ? 'disabled title="Your account is paused. Contact support for assistance."' : ''}>${accountPaused ? '❌ Account Paused' : 'Accept Request'}</button>
          ${accountPaused ? '<div style="margin-top:6px;font-size:11px;color:#c62828;font-weight:600;text-align:center;">Your account is paused. Contact support.</div>' : ''}`}
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

  const openProposalModal = (session) => {
    // Pre-fill with the original date but shift time by the conflict amount
    setProposingFor(session);
    setProposalDate(session.date || '');
    // Default: shift 2 hours later than original time
    const [h, m] = (session.time || '09:00').split(':');
    const shifted = Math.min(parseInt(h) + 2, 20);
    setProposalTime(`${String(shifted).padStart(2, '0')}:${m}`);
    setProposalMsg('');
  };

  const handlePropose = async () => {
    if (!proposingFor || !proposalDate || !proposalTime) return;
    setProposalLoading(true);
    try {
      const res = await apiFetch(`/api/sessions/${proposingFor.id}/propose-time`, {
        method: 'POST',
        body: JSON.stringify({ proposedDate: proposalDate, proposedTime: proposalTime, message: proposalMsg || null }),
      });
      if (res?.ok) {
        showToast('Time proposal sent to family!', 'success');
        setProposingFor(null);
        fetchData();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Failed to send proposal', 'error');
      }
    } catch (err) {
      console.error('Propose error:', err);
      showToast('Failed to send proposal', 'error');
    }
    setProposalLoading(false);
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
    const d = s.date || s.scheduled_date;
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
          ? React.createElement(AvailabilityTab, {
              rules: availRules, loading: availLoading, fetchAvailability,
              showAddRule, setShowAddRule, editingRule, setEditingRule,
              ruleForm, setRuleForm, handleSaveRule, handleDeleteRule, startEditRule,
              dayNames, dayAbbr,
            })
          : <div className="card" style={{ padding: 24, textAlign: 'center', color: '#888' }}>Availability calendar loading...</div>
      )}

      {/* ═══ MY RATES SUB-TAB ═══ */}
      {subTab === 'rates' && (
        <div>
          <div className="card" style={{ padding: 20, marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, color: '#1b6b5a' }}>💰 Your Hourly Rates</h3>
            <p style={{ fontSize: 13, color: '#666', margin: '0 0 12px', lineHeight: 1.6 }}>
              Set your rates for each time tier. Families see these rates when booking, and your earnings are calculated based on when the session falls.
            </p>
            <div style={{ padding: '10px 14px', background: '#f0faf8', borderRadius: 8, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 16 }}>{'\uD83D\uDCA1'}</span>
              <span style={{ fontSize: 12, color: '#555', lineHeight: 1.5 }}>Most caregivers in your area charge <strong style={{ color: '#1b6b5a' }}>$25–$35/hr</strong> for daytime care. Setting competitive rates helps you get matched with more families.</span>
            </div>
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

      {/* Clearance banner — shown when BG check or Stripe not done */}
      {!caregiverCleared && (
        <div style={{
          padding: '12px 16px', marginBottom: 12, background: '#fff8e1', border: '1px solid #ffe082',
          borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 18 }}>🔒</span>
          <div style={{ flex: 1, fontSize: 13, color: '#6d4c00', lineHeight: 1.4 }}>
            Complete your background check and payment setup to accept jobs.
          </div>
          <button onClick={() => {
            window.__accountTab = 'payments';
            window.__navigateTo && window.__navigateTo('account');
          }} style={{
            padding: '6px 14px', background: '#1b6b5a', color: '#fff', border: 'none',
            borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>Complete Setup</button>
        </div>
      )}

      {true && <>
      {/* Controls bar: view toggle, zip, date range, service filter, sort, refresh */}
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

        {/* Sort by (list view only) */}
        {viewMode === 'list' && (
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{
            padding: '5px 10px', borderRadius: 8, border: '1px solid #d0d0d0',
            fontSize: 12, color: '#555', background: '#fff', cursor: 'pointer',
          }}>
            <option value="date">Soonest first</option>
            <option value="match">Best match</option>
            <option value="distance">Closest</option>
            <option value="rate">Highest pay</option>
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
                const time = s.time || s.scheduled_time;
                const duration = s.durationHours || s.duration_hours;
                const service = s.serviceType || s.service_type;
                const recipient = s.recipientName || s.recipient_name || 'Care Recipient';
                const cost = s.estimatedCost || s.estimated_cost;
                const instructions = s.specialInstructions || s.special_instructions;
                const dateStr = s.date || s.scheduled_date;
                const city = s.recipientCity || s.recipient_city || '';
                const isDirectOffer = !!s.offeredToCaregiverId;
                const exUntil = s.exclusiveUntil ? new Date(s.exclusiveUntil) : null;
                const exRemain = exUntil ? Math.max(0, Math.floor((exUntil - new Date()) / 60000)) : null;
                const exExpired = exUntil && exRemain <= 0;
                const exUrgent = exRemain !== null && exRemain <= 10 && !exExpired;
                const activeOffer = isDirectOffer && !exExpired;

                // Match quality & distance (from dashboard enrichment)
                const matchScore = s.matchScore || 0;
                const matchQuality = s.matchQuality;
                const hasConflict = s.hasConflict;
                const distMiles = s.distanceMiles;
                const familyName = s.familyName;
                const surcharge = parseFloat(s.shortNoticeSurcharge) || 0;
                const hasBonus = surcharge > 0;
                const proposedRate = parseFloat(s.proposedRate) || 0;
                const hours = parseFloat(duration) || 1;
                const baseCost = parseFloat(cost) || 0;
                const basePerHour = proposedRate > 0 ? proposedRate : (hours > 0 ? Math.round(baseCost / hours) : 0);
                const effectiveTotal = proposedRate > 0 ? (proposedRate * hours) + surcharge : baseCost;

                // Date label with countdown
                const sDate = (dateStr || '').split('T')[0];
                const dateParts = sDate ? sDate.split('-').map(Number) : [];
                const dateObj = dateParts.length === 3 ? new Date(dateParts[0], dateParts[1] - 1, dateParts[2]) : null;
                const now = new Date();
                const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const dayDiff = dateObj ? Math.round((dateObj - todayLocal) / 86400000) : null;
                const dayLabel = dayDiff === 0 ? 'Today' : dayDiff === 1 ? 'Tomorrow' : dateObj ? dateObj.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '';

                return (
                  <div key={s.id} className="card" style={{
                    borderLeft: activeOffer ? '4px solid #7c3aed' : hasConflict ? '4px solid #ffd89b' : matchQuality === 'great' ? '4px solid #1b6b5a' : '4px solid #fb8c00',
                    padding: 16, cursor: 'pointer',
                    transition: 'box-shadow 0.15s',
                    background: activeOffer ? 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)' : hasConflict ? '#fffbf0' : undefined,
                    boxShadow: activeOffer ? '0 2px 12px rgba(124,58,237,0.15)' : undefined,
                  }} onClick={() => setExpandedId(isExpanded ? null : s.id)}>
                    {/* Badge row: offer, match, conflict, distance, rate */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                      {activeOffer && (
                        <span className={exUrgent ? 'exclusive-urgent' : ''} style={{
                          background: exUrgent ? '#e8724a' : '#7c3aed', color: '#fff', padding: '2px 10px',
                          borderRadius: 12, fontSize: 11, fontWeight: 700,
                        }}>
                          {exUrgent ? '\u23F1' : '\u2728'} {exRemain !== null ? (exUrgent ? `${exRemain} min left!` : `JUST FOR YOU \u00B7 ${exRemain} min`) : 'JUST FOR YOU'}
                        </span>
                      )}
                      {hasBonus && (
                        <span style={{ background: '#e8724a', color: '#fff', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700 }}>BONUS PAY</span>
                      )}
                      {matchScore > 0 && (
                        <span title={matchScore >= 80
                          ? 'Great match — your experience and preferences align well with this care request'
                          : matchScore >= 60
                          ? 'Good match — review the care notes to see if this is a good fit for you'
                          : 'Lower match — review care notes and health tags carefully to make sure you\'re comfortable with this job'
                        } style={{
                          background: matchScore >= 80 ? '#c8e6c9' : matchScore >= 60 ? '#fff9c4' : '#ffccbc',
                          color: matchScore >= 80 ? '#2e7d32' : matchScore >= 60 ? '#f57f17' : '#d84315',
                          padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700,
                          cursor: 'help',
                        }}>✓ {matchScore}%</span>
                      )}
                      {hasConflict ? (
                        <span style={{ background: '#ffd89b', color: '#c86b1f', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>{'\u26A0'} Conflict</span>
                      ) : (
                        <span style={{ background: '#c8e6c9', color: '#2e7d32', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>{'\u2713'} No Conflicts</span>
                      )}
                      {distMiles !== null && distMiles !== undefined && (
                        <span style={{ fontSize: 11, color: '#888' }}>{distMiles} mi</span>
                      )}
                      {basePerHour > 0 && (
                        <span style={{ background: '#e8f5e9', color: '#1b6b5a', padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 700 }}>${basePerHour}/hr</span>
                      )}
                      {s.interviewRequired && (
                        <span style={{ background: '#f3e5f5', color: '#7b1fa2', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700 }}>{'\uD83C\uDFA5'} Interview</span>
                      )}
                      {visitCounts[s.careRecipientId || s.care_recipient_id] > 0 && (() => {
                        const vc = visitCounts[s.careRecipientId || s.care_recipient_id];
                        const rName = (s.recipientName || '').split(' ')[0] || 'this person';
                        return <span title={`You have cared for ${rName} ${vc} time${vc > 1 ? 's' : ''}`} style={{ background: '#e8eaf6', color: '#3f51b5', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, cursor: 'default' }}>{'\uD83D\uDD01'} {vc}x</span>;
                      })()}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 16, color: '#1a1a2e', marginBottom: 2 }}>
                          {(service || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                        </div>
                        <div style={{ fontSize: 13, color: '#555', marginBottom: 2 }}>
                          {dayLabel}{time ? ` at ${formatTimeStr(time)}` : ''}{duration ? ` \u2022 ${duration}hr` : ''}
                          {dayDiff !== null && dayDiff >= 2 && <span style={{ color: '#888', marginLeft: 6, fontSize: 11 }}>in {dayDiff} days</span>}
                        </div>
                        {city && <div style={{ fontSize: 12, color: '#888', marginTop: 1 }}>{'\uD83D\uDCCD'} {city}</div>}
                        {familyName && <div style={{ fontSize: 12, color: '#888', marginTop: 1 }}>Requested by {familyName}</div>}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
                        <div style={{ fontSize: 24, fontWeight: 700, color: '#1b6b5a' }}>
                          ${effectiveTotal > 0 ? effectiveTotal.toFixed(0) : (cost ? Math.round(parseFloat(cost)) : '\u2014')}
                        </div>
                        <div style={{ fontSize: 11, color: '#1b6b5a', fontWeight: 600 }}>Your earnings</div>
                      </div>
                    </div>

                    {instructions && (
                      <div style={{
                        fontSize: 12, color: '#666', fontStyle: 'italic', marginTop: 6,
                        whiteSpace: isExpanded ? 'normal' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {'\uD83D\uDCDD'} "{instructions}"
                      </div>
                    )}

                    {/* Health condition tags */}
                    {s.healthTags && s.healthTags.length > 0 && (
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
                        {s.healthTags.map((tag, i) => (
                          <span key={i} style={{
                            padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                            background: '#fff3e0', color: '#e65100',
                          }}>{tag}</span>
                        ))}
                      </div>
                    )}

                    {/* Care summary snippet */}
                    {s.careSummary && (
                      <div style={{
                        marginTop: 8, padding: '8px 12px', borderLeft: '3px solid #e8724a',
                        background: '#fff8f5', borderRadius: '0 6px 6px 0', fontSize: 12, color: '#555', lineHeight: 1.4,
                      }}>
                        <div style={{ fontWeight: 600, fontSize: 11, color: '#e8724a', marginBottom: 3 }}>Care Notes</div>
                        {s.careSummary.length >= 200 ? s.careSummary + '...' : s.careSummary}
                      </div>
                    )}

                    {isExpanded && (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #f0f0f0' }}>
                        {!caregiverCleared ? (
                          <div style={{ padding: '12px 16px', background: '#f5f5f5', borderRadius: 8, textAlign: 'center', fontSize: 13, color: '#888' }}>
                            Complete your background check and payment setup to accept jobs.
                          </div>
                        ) : (
                        <button onClick={(e) => { if (!accountPaused) { e.stopPropagation(); handleClaim(s.id); } }}
                          disabled={claimingId === s.id || accountPaused}
                          title={accountPaused ? 'Your account is paused. Contact support for assistance.' : ''}
                          style={{
                            width: '100%', padding: 14, background: accountPaused ? '#ccc' : '#e8724a', color: '#fff',
                            border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 700,
                            cursor: claimingId === s.id || accountPaused ? 'not-allowed' : 'pointer', opacity: claimingId === s.id || accountPaused ? 0.6 : 1,
                            boxShadow: '0 2px 6px rgba(232,114,74,0.3)',
                          }}>
                          {accountPaused ? '❌ Account Paused' : claimingId === s.id ? 'Accepting...' : s.interviewRequired ? '\uD83C\uDFA5 Accept & Interview' : '\u2713 Accept This Job'}
                        </button>
                        )}
                        {accountPaused && (
                          <div style={{ marginTop: 8, padding: '8px 12px', background: '#fff5f5', border: '1px solid #ef5350', borderRadius: 8, fontSize: 12, color: '#c62828', fontWeight: 600, textAlign: 'center' }}>
                            Your account is paused. Contact support for assistance.
                          </div>
                        )}
                        {hasConflict && (
                          <button onClick={(e) => { e.stopPropagation(); openProposalModal(s); }}
                            style={{
                              width: '100%', padding: 12, marginTop: 8,
                              background: '#fff', color: '#1b6b5a', border: '2px solid #1b6b5a',
                              borderRadius: 10, fontSize: 14, fontWeight: 600,
                              cursor: 'pointer',
                            }}>
                            {'\u{1F504}'} Propose Different Time
                          </button>
                        )}
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

          {sortedDates.length > 0 ? sortedDates.map(dateStr => {
            // Date countdown
            const dParts = dateStr.split('-').map(Number);
            const dObj = dParts.length === 3 ? new Date(dParts[0], dParts[1] - 1, dParts[2]) : null;
            const now = new Date();
            const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const dDiff = dObj ? Math.round((dObj - todayLocal) / 86400000) : null;
            const dateLabel = dDiff === 0 ? 'Today' : dDiff === 1 ? 'Tomorrow' : dObj ? dObj.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }) : formatDate(dateStr);
            const countdownLabel = dDiff !== null && dDiff >= 2 ? `in ${dDiff} days` : '';

            return (
            <div key={dateStr} style={{ marginBottom: 16 }}>
              <div style={{
                fontSize: 14, fontWeight: 700, color: '#1b6b5a', marginBottom: 8,
                padding: '6px 0', borderBottom: '2px solid #e8f5f1',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span>{dateLabel}</span>
                {countdownLabel && <span style={{ fontSize: 11, fontWeight: 600, color: '#888', background: '#f5f5f5', padding: '2px 8px', borderRadius: 10 }}>{countdownLabel}</span>}
              </div>
              {sessionsByDate[dateStr].map(s => {
                const time = s.time || s.scheduled_time;
                const duration = s.durationHours || s.duration_hours;
                const service = s.serviceType || s.service_type;
                const recipient = s.recipientName || s.recipient_name || 'Care Recipient';
                const cost = s.caregiverPayout || s.caregiver_payout || s.estimatedCost || s.estimated_cost;
                const location = s.location || s.recipientCity || '';
                const familyName = s.familyName || '';
                const healthTags = s.healthTags || [];
                const careSummary = s.careSummary || '';
                const instructions = s.specialInstructions || s.special_instructions || '';
                const statusColors = {
                  confirmed: { bg: '#e8f5e9', text: '#2e7d32', label: 'Confirmed' },
                  pending: { bg: '#fff3e0', text: '#e65100', label: 'Pending' },
                  in_progress: { bg: '#e3f2fd', text: '#1565c0', label: 'In Progress' },
                  completed: { bg: '#e0e0e0', text: '#666', label: 'Completed' },
                };
                const sc = statusColors[s.status] || statusColors.pending;

                return (
                  <div key={s.id} className="card" style={{
                    borderLeft: s.status === 'confirmed' ? '4px solid #1b6b5a' : '4px solid #42a5f5',
                    padding: 16, marginBottom: 10,
                  }}>
                    {/* Header: service type + status + cancel */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 700, fontSize: 16, color: '#333' }}>
                          {(service || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                        </span>
                        <span style={{
                          padding: '3px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                          background: sc.bg, color: sc.text,
                        }}>{sc.label}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {cost && <span style={{ fontSize: 20, fontWeight: 700, color: '#1b6b5a' }}>${Math.round(parseFloat(cost))}</span>}
                        {['confirmed', 'pending'].includes(s.status) && (
                          <button onClick={() => setCancellingId(s.id)} style={{
                            padding: '3px 10px', borderRadius: 6, border: '1px solid #e0e0e0',
                            background: '#fff', color: '#c62828', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                          }}>Cancel</button>
                        )}
                      </div>
                    </div>

                    {/* Details row: recipient, time, location */}
                    <div style={{ fontSize: 13, color: '#555', marginBottom: 2 }}>
                      <span style={{ fontWeight: 600 }}>{recipient}</span>
                      {time ? ` \u2022 ${formatTimeStr(time)}` : ''}{duration ? ` \u2022 ${duration}hr` : ''}
                    </div>
                    {location && <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{'\uD83D\uDCCD'} {location}</div>}
                    {familyName && <div style={{ fontSize: 12, color: '#888', marginTop: 1 }}>Family: {familyName}</div>}

                    {/* Special instructions from appointment maker */}
                    {instructions && (
                      <div style={{ fontSize: 12, color: '#666', fontStyle: 'italic', marginTop: 6 }}>
                        {'\uD83D\uDCDD'} "{instructions}"
                      </div>
                    )}

                    {/* Health condition tags */}
                    {healthTags.length > 0 && (
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
                        {healthTags.map((tag, i) => (
                          <span key={i} style={{
                            padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                            background: '#fff3e0', color: '#e65100',
                          }}>{tag}</span>
                        ))}
                      </div>
                    )}

                    {/* Care summary */}
                    {careSummary && (
                      <div style={{
                        marginTop: 8, padding: '8px 12px', borderLeft: '3px solid #e8724a',
                        background: '#fff8f5', borderRadius: '0 6px 6px 0', fontSize: 12, color: '#555', lineHeight: 1.4,
                      }}>
                        <div style={{ fontWeight: 600, fontSize: 11, color: '#e8724a', marginBottom: 3 }}>Care Notes</div>
                        {careSummary.length >= 200 ? careSummary + '...' : careSummary}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            );
          }) : (
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
              const sessionDT = new Date(`${s.date || s.scheduled_date}T${s.time || s.scheduled_time || '00:00'}`);
              const hoursAway = (sessionDT - new Date()) / (1000 * 60 * 60);
              const isLate = hoursAway < 24;
              return (
                <div>
                  <div style={{ fontSize: 14, color: '#333', marginBottom: 12 }}>
                    {s.recipientName || s.recipient_name} — {s.date || s.scheduled_date}
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
      {/* ─── Propose Time Modal ─── */}
      {proposingFor && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setProposingFor(null)}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }}></div>
          <div style={{
            position: 'relative', background: '#fff', borderRadius: 16, padding: 24,
            maxWidth: 420, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 4px', fontSize: 18, color: '#333' }}>Propose Different Time</h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: '#888' }}>
              Suggest a time that works for you. The family will be notified and can accept or decline.
            </p>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#444', marginBottom: 4 }}>Date</label>
              <input type="date" value={proposalDate} onChange={(e) => setProposalDate(e.target.value)}
                style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: 14, boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#444', marginBottom: 4 }}>Time</label>
              <input type="time" value={proposalTime} onChange={(e) => setProposalTime(e.target.value)}
                style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: 14, boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#444', marginBottom: 4 }}>Note to family (optional)</label>
              <textarea value={proposalMsg} onChange={(e) => setProposalMsg(e.target.value)}
                placeholder="e.g., I have another appointment until 1 PM but am free after that"
                rows={2} style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setProposingFor(null)}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #ddd', background: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', color: '#666' }}>
                Cancel
              </button>
              <button onClick={handlePropose} disabled={proposalLoading || !proposalDate || !proposalTime}
                style={{
                  flex: 2, padding: 12, borderRadius: 10, border: 'none',
                  background: '#1b6b5a', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                  opacity: (proposalLoading || !proposalDate || !proposalTime) ? 0.6 : 1,
                }}>
                {proposalLoading ? 'Sending...' : 'Send Proposal'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
