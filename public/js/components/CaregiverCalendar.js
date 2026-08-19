// ─── CaregiverCalendar — Weekly calendar with availability overlay + care requests ───
// Green = available, Blue = booked session, Orange = care request, Red striped = blocked, Gray = off
const CaregiverCalendar = window.CaregiverCalendar = ({ caregiverId, sessions, availRules, fetchAvailability, onLogVisit, earlyCheckInAllowed }) => {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const [allSessions, setAllSessions] = useState([]);
  const [careRequests, setCareRequests] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [claimingId, setClaimingId] = useState(null);
  const [offeringOnId, setOfferingOnId] = useState(null); // session id where offer UI is open
  const [pendingProposals, setPendingProposals] = useState([]);

  // Pick up pending schedule date from activity feed deep-link
  useEffect(() => {
    if (window.__pendingScheduleDate) {
      const target = new Date(window.__pendingScheduleDate);
      if (!isNaN(target.getTime())) {
        const today = new Date();
        const startOfThisWeek = new Date(today);
        startOfThisWeek.setDate(today.getDate() - today.getDay());
        const diffDays = Math.floor((target - startOfThisWeek) / (1000 * 60 * 60 * 24));
        const weekOff = Math.floor(diffDays / 7);
        setWeekOffset(weekOff);
        setSelectedDay(target);
      }
      delete window.__pendingScheduleDate;
    }
  }, []);

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hourStart = 0;
  const hourEnd = 24; // Full 24-hour display

  // Compute current week's dates
  const getWeekDates = () => {
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay() + weekOffset * 7);
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + i);
      dates.push(d);
    }
    return dates;
  };

  const weekDates = getWeekDates();
  // Use local date formatting to avoid UTC timezone shift
  const toLocalDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const weekStart = toLocalDateStr(weekDates[0]);
  const weekEnd = toLocalDateStr(weekDates[6]);

  // Fetch all sessions (upcoming + past) for this caregiver in the visible range
  useEffect(() => {
    const fetchAll = async () => {
      setLoadingSessions(true);
      try {
        const res = await apiFetch(`/api/sessions?from=${weekStart}&to=${weekEnd}`);
        if (res?.ok) {
          const d = await res.json();
          const all = d.sessions || [];
          // Separate regular sessions from care requests
          setAllSessions(all.filter(s => s.status !== 'requested'));
          setCareRequests(all.filter(s => s.status === 'requested'));
        } else {
          setAllSessions(sessions || []);
          setCareRequests([]);
        }
      } catch {
        setAllSessions(sessions || []);
        setCareRequests([]);
      }
      setLoadingSessions(false);
    };
    fetchAll();
    if (typeof fetchAvailability === 'function') fetchAvailability();
  }, [weekOffset]);

  // Also fetch care requests from assigned recipients
  useEffect(() => {
    const fetchRequests = async () => {
      try {
        const res = await apiFetch(`/api/sessions?status=requested&from=${weekStart}&to=${weekEnd}`);
        if (res?.ok) {
          const d = await res.json();
          const requests = (d.sessions || []).filter(s => s.status === 'requested');
          setCareRequests(prev => {
            // Merge without duplicates
            const ids = new Set(prev.map(p => p.id));
            const merged = [...prev];
            requests.forEach(r => { if (!ids.has(r.id)) merged.push(r); });
            return merged;
          });
        }
      } catch { /* ignore */ }
    };
    fetchRequests();
  }, [weekOffset]);

  // Fetch pending proposals for purple calendar blocks
  useEffect(() => {
    const fetchProposals = async () => {
      try {
        const res = await apiFetch('/api/dashboard');
        if (res?.ok) {
          const d = await res.json();
          setPendingProposals((d.myProposals || []).filter(p => p.status === 'pending'));
        }
      } catch { /* ignore */ }
    };
    fetchProposals();
  }, [weekOffset]);

  // Claim a care request
  const handleClaim = async (sessionId) => {
    setClaimingId(sessionId);
    try {
      const res = await apiFetch(`/api/sessions/${sessionId}/claim`, { method: 'PUT' });
      if (res?.ok) {
        // Refresh sessions
        const fetchRes = await apiFetch(`/api/sessions?from=${weekStart}&to=${weekEnd}`);
        if (fetchRes?.ok) {
          const d = await fetchRes.json();
          const all = d.sessions || [];
          setAllSessions(all.filter(s => s.status !== 'requested'));
          setCareRequests(all.filter(s => s.status === 'requested'));
        }
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Failed to accept request');
      }
    } catch (err) {
      console.error('Claim error:', err);
      alert('Failed to accept request');
    }
    setClaimingId(null);
  };

  // Parse availability rules into per-day time ranges
  const getAvailForDay = (dayOfWeek, dateStr) => {
    const rules = availRules || [];
    const available = [];
    const blocked = [];

    rules.forEach(r => {
      const rDay = parseInt(r.day_of_week ?? r.dayOfWeek);
      const rRecurring = r.is_recurring ?? r.isRecurring;
      const rDate = r.specific_date ?? r.specificDate;
      const rType = r.type || 'available';

      const matchesDay = rRecurring && rDay === dayOfWeek;
      const matchesDate = !rRecurring && rDate === dateStr;

      if (matchesDay || matchesDate) {
        const startH = parseInt((r.start_time ?? r.startTime).split(':')[0]);
        const startM = parseInt((r.start_time ?? r.startTime).split(':')[1]) || 0;
        const endH = parseInt((r.end_time ?? r.endTime).split(':')[0]);
        const endM = parseInt((r.end_time ?? r.endTime).split(':')[1]) || 0;
        const entry = { startH, startM, endH, endM, note: r.note };
        if (rType === 'blocked') blocked.push(entry);
        else available.push(entry);
      }
    });

    return { available, blocked };
  };

  // Get sessions for a specific date
  const getSessionsForDate = (dateStr) => {
    const all = allSessions.length > 0 ? allSessions : (sessions || []);
    return all.filter(s => {
      const sDate = s.scheduled_date || s.date;
      return sDate === dateStr;
    });
  };

  // Get care requests for a specific date
  const getRequestsForDate = (dateStr) => {
    return careRequests.filter(s => {
      const sDate = s.scheduled_date || s.date;
      return sDate === dateStr;
    });
  };

  const formatMonth = () => {
    const m1 = weekDates[0].toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    const m2 = weekDates[6].toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    return m1 === m2 ? m1 : `${weekDates[0].toLocaleDateString(undefined, { month: 'short' })} – ${m2}`;
  };

  const isToday = (d) => {
    const today = new Date();
    return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  };

  // Build hour-by-hour cell data for a given date
  const getCellType = (dateStr, dayOfWeek, hour) => {
    const { available, blocked } = getAvailForDay(dayOfWeek, dateStr);
    const daySessions = getSessionsForDate(dateStr);
    const dayRequests = getRequestsForDate(dateStr);

    // Check if this hour falls within a booked session
    for (const s of daySessions) {
      const sTime = s.scheduled_time || s.time || '';
      const sHour = parseInt(sTime.split(':')[0]);
      const sDuration = parseFloat(s.duration_hours || s.durationHours || 1);
      if (hour >= sHour && hour < sHour + sDuration) {
        return { type: 'booked', session: s };
      }
    }

    // Check if this hour falls within a care request
    for (const s of dayRequests) {
      const sTime = s.scheduled_time || s.time || '';
      const sHour = parseInt(sTime.split(':')[0]);
      const sDuration = parseFloat(s.duration_hours || s.durationHours || 1);
      if (hour >= sHour && hour < sHour + sDuration) {
        return { type: 'request', session: s };
      }
    }

    // Check blocked
    for (const b of blocked) {
      if (hour >= b.startH && hour < b.endH) {
        return { type: 'blocked', note: b.note };
      }
    }

    // Check available
    for (const a of available) {
      if (hour >= a.startH && hour < a.endH) {
        return { type: 'available' };
      }
    }

    return { type: 'off' };
  };

  const cellColors = {
    available: { bg: 'var(--color-success-bg)', border: 'var(--color-success-bg)', label: '', overlay: '' },
    booked: { bg: 'var(--color-info-bg)', border: '#64b5f6', label: '●', overlay: '#1e88e5' },
    request: { bg: 'var(--color-warning-bg)', border: '#ffb74d', label: '!', overlay: 'var(--color-warning)' },
    blocked: { bg: 'var(--color-error-bg)', border: '#e57373', label: '✕', overlay: '' },
    off: { bg: 'var(--bg-primary)', border: 'var(--badge-muted-bg)', label: '', overlay: '' },
    proposal: { bg: 'var(--color-purple-bg)', border: '#ce93d8', label: '?', overlay: '#9c27b0' },
  };

  // Selected day details
  const selectedDateStr = selectedDay ? toLocalDateStr(selectedDay) : null;
  const selectedSessions = selectedDateStr ? getSessionsForDate(selectedDateStr) : [];
  const selectedRequests = selectedDateStr ? getRequestsForDate(selectedDateStr) : [];
  const selectedAvail = selectedDay ? getAvailForDay(selectedDay.getDay(), selectedDateStr) : { available: [], blocked: [] };

  const formatTime12 = (h, m) => {
    const ampm = h >= 12 ? 'PM' : 'AM';
    const dh = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return m ? `${dh}:${String(m).padStart(2, '0')} ${ampm}` : `${dh} ${ampm}`;
  };

  const formatTimeStr = (t) => {
    if (!t) return '';
    const [h, min] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const dh = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${dh}:${String(min || 0).padStart(2, '0')} ${ampm}`;
  };

  return (
    <div>
      {/* Week navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <button onClick={() => setWeekOffset(w => w - 1)} style={{ background: 'none', border: '1px solid var(--border-light)', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 14, color: 'var(--text-primary)' }}>← Prev</button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{formatMonth()}</div>
          {weekOffset !== 0 && (
            <button onClick={() => setWeekOffset(0)} style={{ background: 'none', border: 'none', color: 'var(--role-color)', fontSize: 12, cursor: 'pointer', fontWeight: 600, marginTop: 2 }}>Today</button>
          )}
        </div>
        <button onClick={() => setWeekOffset(w => w + 1)} style={{ background: 'none', border: '1px solid var(--border-light)', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 14, color: 'var(--text-primary)' }}>Next →</button>
      </div>

      {/* Care request alert banner with previews */}
      {careRequests.length > 0 && (
        <div style={{
          background: 'linear-gradient(135deg, #fff3e0, #ffe0b2)', border: '1px solid #ffb74d',
          borderRadius: 10, padding: '12px 16px', marginBottom: 14,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: careRequests.length > 0 ? 8 : 0 }}>
            <span style={{ fontSize: 22 }}>🔔</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-warning)' }}>
                {careRequests.length} Care Request{careRequests.length !== 1 ? 's' : ''} This Week
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {careRequests.slice(0, 5).map((s, i) => {
              const name = s.recipient_name || s.recipientName || 'Client';
              const hrs = parseFloat(s.duration_hours || s.durationHours || 2);
              const cost = s.estimated_cost || s.estimatedCost;
              const sDate = s.scheduled_date || s.date;
              const dateParts = sDate ? sDate.split('T')[0].split('-').map(Number) : [];
              const dateLabel = dateParts.length === 3 ? new Date(dateParts[0], dateParts[1] - 1, dateParts[2]).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '';
              const timeStr = s.scheduled_time || s.time || '';
              const tParts = timeStr ? timeStr.split(':').map(Number) : [];
              const timeLabel = tParts.length >= 2 ? `${tParts[0] > 12 ? tParts[0] - 12 : tParts[0] || 12}:${String(tParts[1]).padStart(2, '0')} ${tParts[0] >= 12 ? 'PM' : 'AM'}` : '';
              return (
                <div key={i} onClick={() => {
                  const dp = sDate.split('T')[0].split('-').map(Number);
                  const d = new Date(dp[0], dp[1] - 1, dp[2]);
                  setSelectedDay(d);
                }} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '6px 10px', background: 'rgba(255,255,255,0.7)', borderRadius: 6, cursor: 'pointer',
                  borderLeft: '3px solid #fb8c00', fontSize: 13,
                }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    {name}
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: 12, display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                    <span>{dateLabel}{timeLabel ? ', ' + timeLabel : ''}</span>
                    <span style={{ fontWeight: 600 }}>{hrs}h</span>
                    {cost && <span style={{ fontWeight: 700, color: 'var(--color-warning)' }}>${Math.round(parseFloat(cost))}</span>}
                  </div>
                </div>
              );
            })}
            {careRequests.length > 5 && (
              <div style={{ fontSize: 12, color: 'var(--color-warning)', textAlign: 'center' }}>+{careRequests.length - 5} more — tap a day to see all</div>
            )}
          </div>
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: 11, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 14, height: 14, borderRadius: 3, background: cellColors.available.bg, border: `2px solid ${cellColors.available.border}`, display: 'inline-block' }}></span> Available
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 14, height: 14, borderRadius: 3, background: '#1e88e5', display: 'inline-block' }}></span> Booked
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 14, height: 14, borderRadius: 3, background: 'var(--color-warning)', display: 'inline-block' }}></span> Care Request
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 14, height: 14, borderRadius: 3, background: `repeating-linear-gradient(-45deg, #fce4ec, #fce4ec 2px, #e57373 2px, #e57373 4px)`, border: '1px solid #e57373', display: 'inline-block' }}></span> Blocked
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 14, height: 14, borderRadius: 3, background: '#9c27b0', display: 'inline-block' }}></span> Proposal
        </span>
      </div>

      {/* Pre-compute merged session/request/proposal blocks for each day column */}
      {(() => {
        // Compute dayBlocks outside JSX so tbody can reference it
        window.__calDayBlocks = weekDates.map((d) => {
          const dateStr = toLocalDateStr(d);
          const daySessions = getSessionsForDate(dateStr);
          const dayRequests = getRequestsForDate(dateStr);
          const blocks = {};

          // Sessions (highest priority — blue)
          for (const s of daySessions) {
            const sTime = s.scheduled_time || s.time || '';
            const sHour = parseInt(sTime.split(':')[0]);
            const sDuration = Math.max(1, Math.ceil(parseFloat(s.duration_hours || s.durationHours || 1)));
            const startH = Math.max(sHour, hourStart);
            const endH = Math.min(sHour + sDuration, hourEnd);
            const visibleSpan = endH - startH;
            if (visibleSpan <= 0) continue;
            const name = (s.recipientName || s.recipient_name || '').split(' ')[0] || '\u25CF';
            blocks[startH] = { type: 'booked', session: s, span: visibleSpan, name };
            for (let h = startH + 1; h < endH; h++) blocks[h] = { skip: true };
          }

          // Care requests (orange)
          for (const s of dayRequests) {
            const sTime = s.scheduled_time || s.time || '';
            const sHour = parseInt(sTime.split(':')[0]);
            const sDuration = Math.max(1, Math.ceil(parseFloat(s.duration_hours || s.durationHours || 1)));
            const startH = Math.max(sHour, hourStart);
            const endH = Math.min(sHour + sDuration, hourEnd);
            const visibleSpan = endH - startH;
            if (visibleSpan <= 0) continue;
            if (!blocks[startH]) {
              blocks[startH] = { type: 'request', session: s, span: visibleSpan, name: 'NEW' };
              for (let h = startH + 1; h < endH; h++) { if (!blocks[h]) blocks[h] = { skip: true }; }
            }
          }

          // Pending proposals (purple)
          for (const p of pendingProposals) {
            if (p.proposedDate !== dateStr) continue;
            const pHour = parseInt((p.proposedTime || '0').split(':')[0]);
            const pDuration = Math.max(1, Math.ceil(parseFloat(p.durationHours || 1)));
            const startH = Math.max(pHour, hourStart);
            const endH = Math.min(pHour + pDuration, hourEnd);
            const visibleSpan = endH - startH;
            if (visibleSpan <= 0) continue;
            if (!blocks[startH]) {
              const name = (p.recipientName || '').split(' ')[0] || '?';
              blocks[startH] = { type: 'proposal', proposal: p, span: visibleSpan, name };
              for (let h = startH + 1; h < endH; h++) { if (!blocks[h]) blocks[h] = { skip: true }; }
            }
          }

          return blocks;
        });
        return null; // Don't render anything, just compute
      })()}

      {/* Calendar Grid */}
      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th style={{ width: 44, padding: '8px 4px', borderBottom: '2px solid var(--border-light)', background: 'var(--bg-primary)', position: 'sticky', left: 0, zIndex: 1 }}></th>
              {weekDates.map((d, i) => {
                const today = isToday(d);
                const dateStr = toLocalDateStr(d);
                const daySessions = getSessionsForDate(dateStr);
                const dayRequests = getRequestsForDate(dateStr);
                const { blocked: dayBlocked } = getAvailForDay(d.getDay(), dateStr);
                const hasBooked = daySessions.length > 0;
                const hasRequests = dayRequests.length > 0;
                const hasBlocked = dayBlocked.length > 0;
                return (
                  <th key={i} onClick={() => setSelectedDay(d)}
                    style={{ padding: '8px 2px', borderBottom: '2px solid var(--border-light)', textAlign: 'center', cursor: 'pointer', background: today ? 'var(--color-success-bg)' : selectedDay && d.toDateString() === selectedDay.toDateString() ? '#f0f4ff' : 'var(--bg-primary)' }}>
                    <div style={{ fontWeight: 600, color: today ? 'var(--role-color)' : 'var(--text-secondary)' }}>{dayNames[d.getDay()]}</div>
                    <div style={{ fontSize: 13, fontWeight: today ? 800 : 600, color: today ? 'var(--text-on-primary)' : 'var(--text-primary)', background: today ? 'var(--role-color)' : 'transparent', borderRadius: '50%', width: 24, height: 24, lineHeight: '24px', margin: '2px auto 0', display: 'inline-block' }}>{d.getDate()}</div>
                    {(hasBooked || hasRequests || hasBlocked) && (
                      <div style={{ display: 'flex', justifyContent: 'center', gap: 3, marginTop: 3 }}>
                        {hasBooked && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#1e88e5', display: 'inline-block' }} title={`${daySessions.length} confirmed`}></span>}
                        {hasRequests && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-warning)', display: 'inline-block' }} title={`${dayRequests.length} request(s)`}></span>}
                        {hasBlocked && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#e57373', display: 'inline-block' }} title="Blocked time"></span>}
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: hourEnd - hourStart }, (_, hi) => {
              const hour = hourStart + hi;
              const dayBlocks = window.__calDayBlocks || [];
              return (
                <tr key={hour}>
                  <td style={{ padding: '0 4px', fontSize: 10, color: 'var(--text-muted)', textAlign: 'right', borderRight: '1px solid #e8e8e8', background: 'var(--bg-primary)', position: 'sticky', left: 0, zIndex: 1, height: 28 }}>
                    {hour <= 12 ? hour : hour - 12}{hour < 12 ? 'a' : 'p'}
                  </td>
                  {weekDates.map((d, di) => {
                    const dateStr = toLocalDateStr(d);
                    const block = (dayBlocks[di] || {})[hour];

                    // Skip — covered by a rowSpan from above
                    if (block && block.skip) return null;

                    // Merged session/request/proposal block
                    if (block && block.span) {
                      const isProposal = block.type === 'proposal';
                      const isRequest = block.type === 'request';
                      const borderColor = isProposal ? '#9c27b0' : isRequest ? 'var(--color-warning)' : '#1e88e5';
                      const textColor = isProposal ? 'var(--color-purple)' : isRequest ? 'var(--color-warning)' : 'var(--color-info)';
                      const bgGradient = isProposal
                        ? 'linear-gradient(180deg, rgba(156,39,176,0.28) 0%, rgba(156,39,176,0.12) 100%)'
                        : isRequest
                        ? 'linear-gradient(180deg, rgba(251,140,0,0.28) 0%, rgba(251,140,0,0.12) 100%)'
                        : 'linear-gradient(180deg, rgba(30,136,229,0.32) 0%, rgba(30,136,229,0.10) 100%)';
                      const sTime = block.session ? (block.session.scheduled_time || block.session.time || '') : (block.proposal ? block.proposal.proposedTime || '' : '');
                      const tParts = sTime.split(':').map(Number);
                      const timeLabel = tParts.length >= 2 ? `${tParts[0] > 12 ? tParts[0] - 12 : tParts[0] || 12}${tParts[1] ? ':' + String(tParts[1]).padStart(2, '0') : ''}${tParts[0] >= 12 ? 'p' : 'a'}` : '';
                      return (
                        <td key={di} rowSpan={block.span}
                          onClick={() => setSelectedDay(d)}
                          title={block.type === 'booked' ? `${block.name} · ${(block.session.serviceType || block.session.service_type || '')}` : block.type === 'request' ? 'Care request' : `Proposal: ${block.name}`}
                          style={{
                            background: bgGradient,
                            borderLeft: `3px solid ${borderColor}`,
                            borderBottom: '1px solid #f0f0f0',
                            borderRight: '1px solid #f5f5f5',
                            cursor: 'pointer',
                            padding: 0,
                            verticalAlign: 'middle',
                            textAlign: 'center',
                          }}>
                          <div style={{
                            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                            height: '100%', padding: '2px 1px', overflow: 'hidden',
                          }}>
                            <span style={{ fontSize: block.span >= 2 ? 10 : 8, fontWeight: 700, color: textColor, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                              {block.name}
                            </span>
                            {block.span >= 2 && (
                              <span style={{ fontSize: 7, color: textColor, opacity: 0.7, marginTop: 1 }}>
                                {timeLabel}
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    }

                    // Regular cell (available, blocked, off)
                    const cell = getCellType(dateStr, d.getDay(), hour);
                    const colors = cellColors[cell.type];
                    return (
                      <td key={di}
                        onClick={() => setSelectedDay(d)}
                        title={cell.type === 'blocked' ? `Blocked${cell.note ? ': ' + cell.note : ''}` : cell.type}
                        style={{
                          background: cell.type === 'blocked'
                            ? 'repeating-linear-gradient(-45deg, #fce4ec, #fce4ec 3px, #f8bbd0 3px, #f8bbd0 6px)'
                            : colors.bg,
                          borderBottom: '1px solid #f0f0f0',
                          borderRight: '1px solid #f5f5f5',
                          borderLeft: cell.type === 'blocked' ? '3px solid #e57373' : 'none',
                          cursor: 'pointer',
                          height: 28,
                          position: 'relative',
                          transition: 'opacity 0.1s',
                        }}>
                        {cell.type === 'blocked' && (
                          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span style={{ fontSize: 8, fontWeight: 800, color: 'var(--color-error)', opacity: 0.6 }}>{'\u2715'}</span>
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Weekly Income Summary */}
      {(() => {
        const allWeekSessions = allSessions.length > 0 ? allSessions : (sessions || []);
        const weekConfirmed = allWeekSessions.reduce((sum, s) => sum + parseFloat(s.estimatedCost || s.estimated_cost || s.actual_cost || 0), 0);
        const weekPending = careRequests.reduce((sum, s) => sum + parseFloat(s.estimated_cost || s.estimatedCost || 0), 0);
        if (weekConfirmed === 0 && weekPending === 0) return null;
        return (
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 120, padding: '10px 14px', background: 'var(--color-info-bg)', borderRadius: 10, textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--color-info)', fontWeight: 600 }}>Confirmed</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-info)' }}>${Math.round(weekConfirmed)}</div>
            </div>
            {weekPending > 0 && (
              <div style={{ flex: 1, minWidth: 120, padding: '10px 14px', background: 'var(--color-warning-bg)', borderRadius: 10, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--color-warning)', fontWeight: 600 }}>Pending</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-warning)' }}>${Math.round(weekPending)}</div>
              </div>
            )}
            <div style={{ flex: 1, minWidth: 120, padding: '10px 14px', background: 'var(--bg-highlight)', borderRadius: 10, textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--role-color)', fontWeight: 600 }}>Week Total</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--role-color)' }}>${Math.round(weekConfirmed + weekPending)}</div>
            </div>
          </div>
        );
      })()}

      {/* Selected Day Details */}
      {selectedDay && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <span className="card-icon">📋</span>
            {selectedDay.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>

          {/* Availability summary */}
          {selectedAvail.available.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-success)', marginBottom: 4 }}>Available</div>
              {selectedAvail.available.map((a, i) => (
                <div key={i} style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '2px 0' }}>
                  {formatTime12(a.startH, a.startM)} – {formatTime12(a.endH, a.endM)}
                </div>
              ))}
            </div>
          )}
          {selectedAvail.blocked.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-error)', marginBottom: 4 }}>Blocked</div>
              {selectedAvail.blocked.map((b, i) => (
                <div key={i} style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '2px 0' }}>
                  {formatTime12(b.startH, b.startM)} – {formatTime12(b.endH, b.endM)}
                  {b.note && <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>({b.note})</span>}
                </div>
              ))}
            </div>
          )}
          {selectedAvail.available.length === 0 && selectedAvail.blocked.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>No availability rules for this day</div>
          )}

          {/* Care Requests */}
          {selectedRequests.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-warning)', marginBottom: 8 }}>Care Requests</div>
              {selectedRequests.map((s, idx) => {
                const hrs = s.durationHours || s.duration_hours || 2;
                const estCost = s.estimated_cost || s.estimatedCost;
                const budgetMax = s.budget_max || s.budgetMax;
                const shortNoticeSurcharge = s.short_notice_surcharge || s.shortNoticeSurcharge || 0;
                return (
                  <div key={idx} style={{ padding: '10px 12px', background: 'var(--color-warning-bg)', borderRadius: 8, marginBottom: 8, borderLeft: '3px solid #fb8c00' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
                          {s.recipientName || s.recipient_name || 'Client'}{estCost ? `, $${Math.round(parseFloat(estCost))}` : ''}
                          {shortNoticeSurcharge > 0 && (
                            <span style={{ marginLeft: 6, background: 'var(--accent-color)', color: 'var(--text-on-primary)', padding: '2px 6px', borderRadius: 10, fontSize: 10, fontWeight: 600 }}>
                              Short Notice +20%
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          {formatTimeStr(s.time || s.scheduled_time)} · {hrs}h · {formatServiceType(s.serviceType || s.service_type)}
                        </div>
                        {budgetMax && (
                          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                            Budget: up to ${budgetMax}/hr
                          </div>
                        )}
                        {(s.specialInstructions || s.special_instructions) && (
                          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontStyle: 'italic', marginTop: 4 }}>
                            {s.specialInstructions || s.special_instructions}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginLeft: 8 }}>
                        <button onClick={() => handleClaim(s.id)} disabled={claimingId === s.id}
                          style={{
                            padding: '6px 16px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none',
                            borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                            opacity: claimingId === s.id ? 0.5 : 1,
                          }}>
                          {claimingId === s.id ? 'Accepting...' : 'Accept'}
                        </button>
                        <button onClick={() => setOfferingOnId(offeringOnId === s.id ? null : s.id)}
                          style={{
                            padding: '5px 12px', background: 'var(--bg-surface)', color: 'var(--accent-color)', border: '1px solid #e8724a',
                            borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600,
                          }}>
                          {offeringOnId === s.id ? 'Cancel' : 'Make Offer'}
                        </button>
                      </div>
                    </div>
                    {offeringOnId === s.id && (
                      <div style={{ marginTop: 8 }}>
                        <OfferNegotiationPanel sessionId={s.id} currentUser={{ id: 'me', role: 'caregiver' }} compact onAccepted={() => {
                          setOfferingOnId(null);
                          // Refresh
                          const fetchRes = apiFetch(`/api/sessions?from=${weekStart}&to=${weekEnd}`);
                        }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Booked Sessions */}
          {selectedSessions.length > 0 ? (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-info)', marginBottom: 8 }}>Booked Sessions</div>
              {selectedSessions.map((s, idx) => {
                const cost = parseFloat(s.estimatedCost || s.estimated_cost || s.actual_cost || 0);
                const name = s.recipientName || s.recipient_name || 'Client';
                return (
                  <div key={idx} style={{ padding: '10px 12px', background: 'var(--color-info-bg)', borderRadius: 8, marginBottom: 8, borderLeft: '3px solid #42a5f5' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
                          {name}{cost > 0 ? `, $${Math.round(cost)}` : ''}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          {formatTimeStr(s.time || s.scheduled_time)} · {s.durationHours || s.duration_hours}h · {formatServiceType(s.serviceType || s.service_type)}
                        </div>
                        {(s.specialInstructions || s.special_instructions) && (
                          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontStyle: 'italic', marginTop: 4 }}>
                            {s.specialInstructions || s.special_instructions}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                        <span style={{
                          padding: '3px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                          background: s.status === 'in_progress' ? 'var(--color-warning-bg)' : s.status === 'confirmed' ? 'var(--color-success-bg)' : s.status === 'completed' ? 'var(--border-light)' : 'var(--color-warning-bg)',
                          color: s.status === 'in_progress' ? 'var(--color-warning)' : s.status === 'confirmed' ? 'var(--color-success)' : s.status === 'completed' ? 'var(--text-secondary)' : 'var(--color-warning)',
                          textTransform: 'capitalize',
                        }}>{s.status}</span>
                        {s.status === 'confirmed' && onLogVisit && (() => {
                          const sTime = s.scheduled_time || s.time;
                          const sDate = s.scheduled_date || s.date;
                          if (sDate && sTime && !earlyCheckInAllowed) {
                            // All times are care-location times — use TimezoneHelper
                            const tz = s.timezone || TimezoneHelper.DEFAULT_TZ;
                            // v1.105.35 — this compared getNow(tz), which is a
                            // SHIFTED-FRAME date (it re-parses a formatted string in the
                            // BROWSER's zone), against buildDateTime, which is a true UTC
                            // epoch. The gap between them is the viewer's own offset: a
                            // caregiver on Pacific time saw "Check-in opens 3h before" and
                            // the button withheld for three extra hours — standing at the
                            // door, locked out, by a clock that was lying. realNowMs() is
                            // the only safe right-hand side for a buildDateTime epoch.
                            const nowMs = TimezoneHelper.realNowMs();
                            const sessionStartET = TimezoneHelper.buildDateTime(sDate.split('T')[0], sTime, tz);
                            const earliestMs = sessionStartET.getTime() - 15 * 60000;
                            if (nowMs < earliestMs) {
                              const minsUntil = Math.ceil((earliestMs - nowMs) / 60000);
                              return React.createElement('div', { style: { fontSize: 10, color: 'var(--text-muted)', padding: '4px 0', textAlign: 'right', maxWidth: 110 } },
                                '\u23F0 Check-in opens ' + (minsUntil > 60 ? Math.ceil(minsUntil / 60) + 'h' : minsUntil + 'min') + ' before'
                              );
                            }
                          }
                          return React.createElement('button', {
                            onClick: () => onLogVisit({ ...s, action: 'check-in' }),
                            style: { padding: '4px 10px', background: 'var(--accent-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 700 }
                          }, 'Check In');
                        })()}
                        {s.status === 'in_progress' && onLogVisit && (
                          <button onClick={() => onLogVisit({ ...s, action: 'check-out' })} style={{
                            padding: '4px 10px', background: 'var(--color-error)', color: 'var(--text-on-primary)', border: 'none',
                            borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 700,
                          }}>Check Out</button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Daily income total */}
              {(() => {
                const dayTotal = selectedSessions.reduce((sum, s) => sum + parseFloat(s.estimatedCost || s.estimated_cost || s.actual_cost || 0), 0);
                const requestTotal = selectedRequests.reduce((sum, s) => sum + parseFloat(s.estimated_cost || s.estimatedCost || 0), 0);
                return dayTotal > 0 || requestTotal > 0 ? (
                  <div style={{ padding: '8px 12px', background: 'var(--bg-highlight)', borderRadius: 8, marginTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--role-color)' }}>Day Total</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--role-color)' }}>
                      ${Math.round(dayTotal)}{requestTotal > 0 ? ` (+$${Math.round(requestTotal)} pending)` : ''}
                    </span>
                  </div>
                ) : null;
              })()}
            </div>
          ) : (
            selectedRequests.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No sessions booked this day</div>
          )}
        </div>
      )}
    </div>
  );
};
