// ─── Care Events (v1.100.0) ─────────────────────────────────────────────
// Situational awareness: "Betty has cardiology with Dr. Patel Tuesday 2pm."
// NOT a calendar (no month grid, no recurrence — recurring = Care Tasks) and
// NOT a task (no check-off, no escalation). Events render inline in Next Up
// (CareEventNextUpRow, consumed by Dashboard.js); managing them lives on the
// recipient profile (CareEventsSection). Every event exports to the user's
// OWN calendar — .ics link + Google Calendar — because InPlace is the shared
// source of truth, not the place the calendar lives.

const CARE_EVENT_CATEGORIES = [
  { id: 'medical',   label: 'Medical',   icon: '🩺' },
  { id: 'social',    label: 'Social',    icon: '🎈' },
  { id: 'transport', label: 'Transport', icon: '🚗' },
  { id: 'other',     label: 'Other',     icon: '📅' },
];
const careEventIcon = (cat) => (CARE_EVENT_CATEGORIES.find(c => c.id === cat) || CARE_EVENT_CATEGORIES[3]).icon;

const careEventWhen = (ev, tz) => {
  const dayLabel = TimezoneHelper.getDateLabel(ev.event_date, tz || ev.timezone || TimezoneHelper.DEFAULT_TZ);
  if (!ev.event_time) return `${dayLabel} · all day`;
  const t = TimezoneHelper.formatTime(ev.event_time);
  return ev.end_time ? `${dayLabel} · ${t}–${TimezoneHelper.formatTime(ev.end_time)}` : `${dayLabel} · ${t}`;
};

// Google Calendar "add" link built from the event's naive local fields.
const careEventGoogleUrl = (ev) => {
  const d = ev.event_date.replace(/-/g, '');
  let dates;
  if (!ev.event_time) {
    const [y, m, dd] = ev.event_date.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, dd + 1)).toISOString().slice(0, 10).replace(/-/g, '');
    dates = `${d}/${next}`;
  } else {
    const start = ev.event_time.replace(':', '') + '00';
    const end = (ev.end_time || (String(Math.min(parseInt(ev.event_time, 10) + 1, 23)).padStart(2, '0') + ev.event_time.slice(2))).replace(':', '') + '00';
    dates = `${d}T${start}/${d}T${end}`;
  }
  const p = new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates });
  if (ev.location) p.set('location', ev.location);
  if (ev.details) p.set('details', ev.details);
  if (ev.timezone || ev.tz) p.set('ctz', ev.timezone || ev.tz);
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
};

// ─── Next Up row (rendered inside Dashboard's Next Up list) ───
// v1.101.0: swipe left reveals Remove (managers only) — events carry no
// accountability, so removal needs no ceremony.
const CareEventNextUpRow = window.CareEventNextUpRow = ({ ev, onOpenSheet, onRemove }) => {
  const tz = ev.timezone || TimezoneHelper.DEFAULT_TZ;
  const isToday = ev.event_date === TimezoneHelper.getToday(tz);
  const swipeActions = (ev.canManage && onRemove)
    ? [{ label: 'Remove', background: 'var(--color-error)', onTap: onRemove }] : null;
  return (
    <SwipeableRow actions={swipeActions} marginBottom={8}>
    <div onClick={onOpenSheet} style={{
      padding: '12px 14px', borderRadius: 12, cursor: 'pointer', boxSizing: 'border-box',
      border: `2px dashed ${isToday ? 'var(--role-color, var(--accent-color))' : 'var(--border-color)'}`,
      background: 'var(--bg-card)', boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 34, height: 34, minWidth: 34, borderRadius: 10, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: 17, background: 'var(--border-light)',
        }}>{careEventIcon(ev.category)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {ev.title}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
            {careEventWhen(ev, tz)} · for {ev.recipientFirstName}{ev.location ? ` · ${ev.location}` : ''}
          </div>
        </div>
        <span style={{
          padding: '4px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
          background: 'var(--border-light)', color: 'var(--text-tertiary)',
        }}>Event</span>
      </div>
    </div>
    </SwipeableRow>
  );
};

// ─── Detail sheet: what/when/where + Add to my calendar + edit/delete ───
const CareEventSheet = window.CareEventSheet = ({ ev, canManage, onClose, onEdit, onChanged }) => {
  const { showToast } = useToast();
  const [deleting, setDeleting] = useState(false);
  const remove = async () => {
    if (deleting) return;
    if (!window.confirm(`Remove "${ev.title}"?`)) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/care-events/${ev.id}`, { method: 'DELETE' });
      if (res?.ok) { showToast('Event removed', 'success'); onChanged(); onClose(); }
      else showToast('Could not remove event', 'error');
    } catch { showToast('Could not remove event', 'error'); }
    setDeleting(false);
  };
  const btn = {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%',
    padding: '12px 0', borderRadius: 12, border: '1px solid var(--border-color)',
    background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 14, fontWeight: 600,
    cursor: 'pointer', textDecoration: 'none', boxSizing: 'border-box',
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-card)', borderRadius: '18px 18px 0 0', width: '100%', maxWidth: 520, padding: '20px 20px 28px', maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--text-primary)' }}>
          {careEventIcon(ev.category)} {ev.title}
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 4 }}>
          {careEventWhen(ev)}{ev.recipientFirstName ? ` · for ${ev.recipientFirstName}` : ''}
        </div>
        {ev.location && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6 }}>📍 {ev.location}</div>}
        {ev.details && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6, whiteSpace: 'pre-wrap' }}>{ev.details}</div>}
        {ev.created_by_first_name && (
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 8 }}>
            Added by {ev.created_by_first_name}{ev.source === 'email' ? ' via email' : ''}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
          <a href={ev.ics_url} style={{ ...btn, background: 'var(--accent-color)', color: 'var(--text-on-primary)', border: 'none', fontWeight: 700 }}>
            📆 Add to my calendar
          </a>
          <a href={careEventGoogleUrl(ev)} target="_blank" rel="noopener noreferrer" style={btn}>
            Add to Google Calendar
          </a>
          {canManage && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { onClose(); onEdit(); }} style={{ ...btn, flex: 1 }}>Edit</button>
              <button disabled={deleting} onClick={remove} style={{ ...btn, flex: 1, color: 'var(--color-error)' }}>Remove</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Add/edit modal — one-line quick add on top, structured fields below ───
const CareEventFormModal = window.CareEventFormModal = ({ recipientId, recipientFirstName, timezone, existing, onClose, onSaved }) => {
  const { showToast } = useToast();
  const ex = existing || {};
  const tz = timezone || ex.timezone || TimezoneHelper.DEFAULT_TZ;
  const [quickText, setQuickText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [title, setTitle] = useState(ex.title || '');
  const [category, setCategory] = useState(ex.category || 'medical');
  const [date, setDate] = useState(ex.event_date || '');
  const [allDay, setAllDay] = useState(existing ? !ex.event_time : false);
  const [time, setTime] = useState(ex.event_time || '10:00');
  const [endTime, setEndTime] = useState(ex.end_time || '');
  const [location, setLocation] = useState(ex.location || '');
  const [details, setDetails] = useState(ex.details || '');
  const [saving, setSaving] = useState(false);

  const parse = async () => {
    if (!quickText.trim() || parsing) return;
    setParsing(true);
    try {
      const res = await apiFetch('/api/care-events/parse', {
        method: 'POST', body: JSON.stringify({ text: quickText.trim(), tz }),
      });
      const d = res?.ok ? await res.json() : null;
      if (d?.parsed) {
        if (d.parsed.title) setTitle(d.parsed.title);
        if (d.parsed.category) setCategory(d.parsed.category);
        if (d.parsed.date) setDate(d.parsed.date);
        if (d.parsed.time) { setTime(d.parsed.time); setAllDay(false); }
        else if (d.parsed.date) setAllDay(true);
        if (d.parsed.end_time) setEndTime(d.parsed.end_time);
        if (d.parsed.location) setLocation(d.parsed.location);
        if (d.parsed.details) setDetails(d.parsed.details);
        if (!d.parsed.date) showToast("Couldn't find a date in that — pick one below.", 'info');
      } else {
        showToast('Fill in the fields below instead.', 'info');
      }
    } catch { showToast('Fill in the fields below instead.', 'info'); }
    setParsing(false);
  };

  const save = async () => {
    if (saving) return;
    if (!title.trim()) { showToast("What's the event? Add a title.", 'error'); return; }
    if (!date) { showToast('Pick a date.', 'error'); return; }
    const body = {
      care_recipient_id: recipientId, title: title.trim(), category,
      event_date: date, event_time: allDay ? null : time, end_time: allDay ? null : (endTime || null),
      location: location.trim() || null, details: details.trim() || null,
    };
    setSaving(true);
    try {
      const res = await apiFetch(existing ? `/api/care-events/${existing.id}` : '/api/care-events', {
        method: existing ? 'PUT' : 'POST', body: JSON.stringify(body),
      });
      if (res?.ok) { showToast(existing ? 'Event updated' : 'Event added', 'success'); onSaved(); onClose(); }
      else { const d = await res.json().catch(() => ({})); showToast(d.error || 'Could not save event', 'error'); }
    } catch { showToast('Could not save event', 'error'); }
    setSaving(false);
  };

  const chip = (selected) => ({
    padding: '7px 12px', borderRadius: 18, fontSize: 13, fontWeight: selected ? 700 : 500, cursor: 'pointer',
    border: selected ? '2px solid var(--role-color)' : '1px solid var(--border-color)',
    background: selected ? 'var(--role-color-light)' : 'var(--bg-card)',
    color: selected ? 'var(--role-color)' : 'var(--text-secondary)',
  });
  const label = { fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '14px 0 6px' };
  const input = { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-color)', fontSize: 14, background: 'var(--bg-surface)', color: 'var(--text-primary)', boxSizing: 'border-box' };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-card)', borderRadius: 16, width: '100%', maxWidth: 480, padding: 20, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--text-primary)', marginBottom: 4 }}>
          {existing ? 'Edit event' : `New event for ${recipientFirstName}`}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 4 }}>
          The care team sees it coming up — and gets a heads-up the day before.
        </div>

        {!existing && (
          <>
            <div style={label}>Type it in one line</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...input, flex: 1 }} value={quickText}
                onChange={(e) => setQuickText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') parse(); }}
                placeholder={`Dr. Patel cardiology Tuesday 2pm, Carilion Radford`} />
              <button disabled={parsing || !quickText.trim()} onClick={parse} style={{
                padding: '0 14px', borderRadius: 10, border: 'none', background: 'var(--role-color, var(--accent-color))',
                color: 'var(--text-on-primary)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                opacity: parsing || !quickText.trim() ? 0.5 : 1, whiteSpace: 'nowrap',
              }}>{parsing ? '…' : '✨ Fill in'}</button>
            </div>
          </>
        )}

        <div style={label}>What</div>
        <input style={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Cardiology — Dr. Patel" />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {CARE_EVENT_CATEGORIES.map(c => (
            <button key={c.id} style={chip(category === c.id)} onClick={() => setCategory(c.id)}>{c.icon} {c.label}</button>
          ))}
        </div>

        <div style={label}>When</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" style={{ ...input, width: 150 }} value={date} onChange={(e) => setDate(e.target.value)} />
          <button style={chip(allDay)} onClick={() => setAllDay(!allDay)}>All day</button>
          {!allDay && (
            <>
              <input type="time" style={{ ...input, width: 120 }} value={time} onChange={(e) => setTime(e.target.value)} />
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>to</span>
              <input type="time" style={{ ...input, width: 120 }} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </>
          )}
        </div>

        <div style={label}>Where <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span></div>
        <input style={input} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Carilion Clinic, Radford" />

        <div style={label}>Notes <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span></div>
        <textarea style={{ ...input, resize: 'vertical' }} rows={2} value={details} onChange={(e) => setDetails(e.target.value)}
          placeholder="Bring the medication list." />

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button disabled={saving} onClick={save} style={{
            flex: 1, padding: '12px 0', borderRadius: 12, border: 'none', background: 'var(--accent-color)',
            color: 'var(--text-on-primary)', fontSize: 15, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.6 : 1,
          }}>{existing ? 'Save changes' : 'Add event'}</button>
          <button onClick={onClose} style={{ padding: '12px 18px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
};

// ─── Recipient-profile card: upcoming events ───
const CareEventsSection = window.CareEventsSection = ({ recipientId, recipientFirstName }) => {
  // v1.105.171 — see CareTasks; same fold, same store.
  const [sectionOpen, setSectionOpen] = useStickySection('lovedOne.careEvents', true);
  const [data, setData] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [sheet, setSheet] = useState(null);

  const load = async () => {
    try {
      const res = await apiFetch(`/api/care-events/recipient/${recipientId}`);
      if (res?.ok) setData(await res.json());
    } catch {}
  };
  useEffect(() => { if (recipientId) load(); }, [recipientId]);

  if (!data) return null;
  const { events, canManage, today } = data;
  const upcoming = events.filter(ev => ev.event_date >= today);
  const past = events.filter(ev => ev.event_date < today);

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        {/* v1.105.172 — Pete: "i want to standardize where the collapse button is... I prefer
            end-justified." So the chevron is the LAST thing in every header, hard against the
            right edge, wherever else the header's own buttons sit. What it must not become is
            the whole row: "+ Add" lives here too, and folding the section when you meant to
            add something is worse than not folding at all. Title and chevron toggle; the
            button between them does not. */}
        <div className="card-header" style={{ margin: 0, cursor: 'pointer' }}
          role="button" tabIndex={0} aria-expanded={sectionOpen}
          onClick={() => setSectionOpen(!sectionOpen)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSectionOpen(!sectionOpen); } }}>
          <span className="card-icon">{'📅'}</span>Events
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {sectionOpen && canManage && (
            <button onClick={(e) => { e.stopPropagation(); setEditing(null); setShowForm(true); }}
              style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: 'var(--accent-color)', color: 'var(--text-on-primary)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              + Add event
            </button>
          )}
          <span role="button" tabIndex={0} aria-hidden="true"
            onClick={() => setSectionOpen(!sectionOpen)}
            style={{ fontSize: 16, color: 'var(--text-muted)', cursor: 'pointer', transition: 'transform 0.2s', transform: sectionOpen ? 'rotate(180deg)' : 'rotate(0)' }}>{'▼'}</span>
        </div>
      </div>
      {/* display, not unmount: reopening must not refetch the list or lose a half-typed form */}
      <div style={{ display: sectionOpen ? 'block' : 'none' }}>
      {upcoming.length === 0 && past.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '8px 0' }}>
          Appointments and outings the care team should know about — a doctor
          visit, a birthday dinner. Everyone sees it coming, nobody's surprised.
        </div>
      ) : (
        <>
          {upcoming.map(ev => (
            <div key={ev.id} onClick={() => setSheet(ev)}
              style={{ padding: '10px 0', borderBottom: '1px solid var(--border-light)', cursor: 'pointer' }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
                {careEventIcon(ev.category)} {ev.title}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                {careEventWhen(ev)}{ev.location ? ` · ${ev.location}` : ''}
              </div>
            </div>
          ))}
          {past.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
              {past.length} recent past event{past.length > 1 ? 's' : ''}
            </div>
          )}
        </>
      )}
      </div>
      {showForm && (
        <CareEventFormModal recipientId={recipientId} recipientFirstName={recipientFirstName}
          timezone={data.events[0]?.timezone} existing={editing}
          onClose={() => setShowForm(false)} onSaved={load} />
      )}
      {sheet && (
        <CareEventSheet ev={sheet} canManage={canManage}
          onClose={() => setSheet(null)} onChanged={load}
          onEdit={() => { setEditing(sheet); setSheet(null); setShowForm(true); }} />
      )}
    </div>
  );
};
