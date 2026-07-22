// ─── Care Tasks (v1.99.0) ───────────────────────────────────────────────
// Flexible recurring care-task engine — medication tracking first, but the
// engine is task-agnostic (bathroom visits, baths, meals, check-ins...).
//
// Pete's placement rule: NO DIGGING to complete tasks. Today's tasks render
// inline in the dashboard's Next Up feed, chronological with sessions
// (CareTaskNextUpRow + CareTaskCheckSheet, consumed by Dashboard.js).
// Managing definitions lives on the recipient profile (CareTasksSection).
//
// Legal line (do not cross in copy): we record that care happened; we never
// give dosage advice, interaction warnings, or medical guidance.

const CARE_TASK_TYPES = [
  { id: 'medication', label: 'Medication', icon: '💊' },
  { id: 'hygiene',    label: 'Hygiene',    icon: '🛁' },
  { id: 'meal',       label: 'Meal',       icon: '🍽️' },
  { id: 'checkin',    label: 'Check-in',   icon: '👋' },
  { id: 'custom',     label: 'Other',      icon: '📌' },
];
const careTaskIcon = (type) => (CARE_TASK_TYPES.find(t => t.id === type) || CARE_TASK_TYPES[4]).icon;

const careTaskDetail = (occ) => {
  try {
    const d = JSON.parse(occ.details || 'null');
    if (d?.med_name) return `${d.med_name}${d.dose ? ` · ${d.dose}` : ''}`;
  } catch {}
  return null;
};

const careTaskDoneBy = (occ, short) => {
  if (occ.completed_by_name) return occ.completed_by_name;
  if (occ.completed_by_first_name) return short ? occ.completed_by_first_name : `${occ.completed_by_first_name} ${occ.completed_by_last_name || ''}`.trim();
  return 'care team';
};

// ─── Next Up row (rendered inside Dashboard's Next Up list) ───
const CareTaskNextUpRow = window.CareTaskNextUpRow = ({ occ, group, onQuickCheck, onOpenSheet, onUndo }) => {
  const done = occ.status === 'done';
  const skipped = occ.status === 'skipped';
  const nowMs = Date.now();
  const dueMs = new Date(occ.due_at).getTime();
  const graceMs = (occ.grace_minutes ?? 45) * 60000;
  const isDue = !done && !skipped && nowMs >= dueMs;
  const isLate = !done && !skipped && nowMs >= dueMs + graceMs;
  const timeLabel = TimezoneHelper.formatTime(occ.due_time);
  const detail = careTaskDetail(occ);

  const borderColor = isLate ? 'var(--color-error)' : isDue ? 'var(--color-warning)' : done ? 'var(--color-success)' : 'var(--border-color)';
  const bg = isLate ? 'linear-gradient(135deg, var(--color-error-bg) 0%, var(--bg-card) 100%)'
    : isDue ? 'linear-gradient(135deg, var(--color-warning-bg) 0%, var(--bg-card) 100%)' : 'var(--bg-card)';

  return (
    <div onClick={() => { if (!done && !skipped) onOpenSheet(); }} style={{
      marginBottom: 8, padding: '12px 14px', borderRadius: 12, cursor: done || skipped ? 'default' : 'pointer',
      border: `2px solid ${borderColor}`, background: bg, opacity: skipped ? 0.7 : 1,
      boxShadow: isDue && !done ? '0 2px 12px rgba(245, 127, 23, 0.12)' : '0 1px 4px rgba(0,0,0,0.06)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* One-tap check circle: tap = done, recorded as you. Row tap opens the who/note sheet. */}
        <button
          aria-label={done ? 'Completed — undo' : `Mark ${occ.title} done`}
          onClick={(e) => { e.stopPropagation(); done || skipped ? onUndo() : onQuickCheck(); }}
          style={{
            width: 34, height: 34, minWidth: 34, borderRadius: '50%', cursor: 'pointer',
            border: done ? 'none' : `2px solid ${isDue ? 'var(--color-warning)' : 'var(--border-color)'}`,
            background: done ? 'var(--color-success)' : skipped ? 'var(--border-light)' : 'var(--bg-card)',
            color: 'var(--text-on-primary)', fontSize: 16, fontWeight: 800,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
          {done ? '✓' : skipped ? '—' : ''}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          {isLate && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-error)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Overdue — team notified</div>}
          {isDue && !isLate && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-warning)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Due now</div>}
          <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)', textDecoration: skipped ? 'line-through' : 'none' }}>
            {careTaskIcon(occ.task_type)} {occ.title}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
            {done ? `Done · ${careTaskDoneBy(occ, true)}${occ.note ? ' · 📝' : ''}`
              : skipped ? `Skipped · ${careTaskDoneBy(occ, true)}`
              : <>Today at {timeLabel} · for {group.recipientFirstName}{detail ? ` · ${detail}` : ''}</>}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <span style={{
            padding: '4px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
            background: done ? 'var(--color-success-bg)' : isLate ? 'var(--color-error-bg)' : isDue ? 'var(--color-warning-bg)' : 'var(--border-light)',
            color: done ? 'var(--color-success)' : isLate ? 'var(--color-error)' : isDue ? 'var(--color-warning)' : 'var(--text-tertiary)',
          }}>{done ? 'Done' : skipped ? 'Skipped' : 'Task'}</span>
          {!done && !skipped && occ.assignee_first_name && (
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{occ.assignee_first_name}'s turn</span>
          )}
          {(done || skipped) && (
            <button onClick={(e) => { e.stopPropagation(); onUndo(); }}
              style={{ padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-tertiary)', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
              Undo
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Check-off sheet: who did it + optional note ───
const CareTaskCheckSheet = window.CareTaskCheckSheet = ({ occ, group, onClose, onDone }) => {
  const { showToast } = useToast();
  const [who, setWho] = useState({ kind: 'me' }); // {kind:'me'|'user'|'helper'|'other', id?, name?}
  const [otherName, setOtherName] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const detail = careTaskDetail(occ);
  const myId = window.__currentUserId;

  const submit = async (status) => {
    if (saving) return;
    const body = { status, note: note.trim() || undefined };
    if (who.kind === 'user') body.completed_by_user_id = who.id;
    if (who.kind === 'helper') body.completed_by_name = who.name;
    if (who.kind === 'other') {
      if (!otherName.trim()) { showToast('Who did it? Add a name or pick someone.', 'error'); return; }
      body.completed_by_name = otherName.trim();
    }
    setSaving(true);
    try {
      const res = await apiFetch(`/api/care-tasks/occurrences/${occ.id}/check`, {
        method: 'POST', body: JSON.stringify(body),
      });
      if (res?.ok) { onDone(); onClose(); }
      else { const d = await res.json().catch(() => ({})); showToast(d.error || 'Could not save', 'error'); }
    } catch { showToast('Could not save', 'error'); }
    setSaving(false);
  };

  const chip = (selected) => ({
    padding: '8px 14px', borderRadius: 20, fontSize: 13, fontWeight: selected ? 700 : 500, cursor: 'pointer',
    border: selected ? '2px solid var(--role-color)' : '1px solid var(--border-color)',
    background: selected ? 'var(--role-color-light)' : 'var(--bg-card)',
    color: selected ? 'var(--role-color)' : 'var(--text-secondary)',
  });

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-card)', borderRadius: '18px 18px 0 0', width: '100%', maxWidth: 520, padding: '20px 20px 28px', maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--text-primary)' }}>
          {careTaskIcon(occ.task_type)} {occ.title}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2, marginBottom: 16 }}>
          Today at {TimezoneHelper.formatTime(occ.due_time)} · for {group.recipientFirstName}{detail ? ` · ${detail}` : ''}
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Who did it?</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
          <button style={chip(who.kind === 'me')} onClick={() => setWho({ kind: 'me' })}>Me</button>
          {(group.teamMembers || []).filter(m => m.id !== myId).map(m => (
            <button key={m.id} style={chip(who.kind === 'user' && who.id === m.id)}
              onClick={() => setWho({ kind: 'user', id: m.id })}>{m.first_name} {m.last_name ? m.last_name[0] + '.' : ''}</button>
          ))}
          {(group.helpers || []).map(h => (
            <button key={h.id} style={chip(who.kind === 'helper' && who.name === h.name)}
              onClick={() => setWho({ kind: 'helper', name: h.name })}>{h.name}</button>
          ))}
          <button style={chip(who.kind === 'other')} onClick={() => setWho({ kind: 'other' })}>Someone else…</button>
        </div>
        {who.kind === 'other' && (
          <input value={otherName} onChange={(e) => setOtherName(e.target.value)} placeholder="Their name (we'll remember it)"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-color)', fontSize: 14, marginBottom: 6, background: 'var(--bg-surface)', color: 'var(--text-primary)', boxSizing: 'border-box' }} />
        )}

        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '12px 0 8px' }}>Anything to note? <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional — goes to care notes)</span></div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
          placeholder="e.g. Took it with dinner. Seemed calm tonight."
          style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-color)', fontSize: 14, resize: 'vertical', background: 'var(--bg-surface)', color: 'var(--text-primary)', boxSizing: 'border-box' }} />

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button disabled={saving} onClick={() => submit('done')} style={{
            flex: 1, padding: '13px 0', borderRadius: 12, border: 'none', background: 'var(--color-success)',
            color: 'var(--text-on-primary)', fontSize: 15, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.6 : 1,
          }}>✓ Done</button>
          <button disabled={saving} onClick={() => submit('skipped')} style={{
            padding: '13px 18px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-surface)',
            color: 'var(--text-secondary)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>Skip today</button>
        </div>
      </div>
    </div>
  );
};

// ─── 14-day adherence strip ───
const CareTaskStrip = ({ recent }) => {
  const cells = [...(recent || [])].reverse();
  const color = (s) => s === 'done' ? 'var(--color-success)' : s === 'missed' ? 'var(--color-error)' : s === 'skipped' ? 'var(--text-muted)' : 'var(--border-color)';
  return (
    <div style={{ display: 'flex', gap: 3, marginTop: 6 }} title="Last 14 days: green done, red missed, gray skipped">
      {cells.map((c, i) => (
        <div key={i} style={{ width: 10, height: 10, borderRadius: 3, background: color(c.status), opacity: c.status === 'pending' ? 0.5 : 1 }} />
      ))}
    </div>
  );
};

// ─── Create/edit modal ───
const CareTaskFormModal = ({ recipientId, recipientFirstName, teamMembers, existing, onClose, onSaved }) => {
  const { showToast } = useToast();
  const ex = existing || {};
  const exDetails = (() => { try { return JSON.parse(ex.details || '{}') || {}; } catch { return {}; } })();
  const todayStr = new Date().toISOString().slice(0, 10);
  const [title, setTitle] = useState(ex.title || '');
  const [type, setType] = useState(ex.task_type || 'medication');
  const [medName, setMedName] = useState(exDetails.med_name || '');
  const [dose, setDose] = useState(exDetails.dose || '');
  const [dueTime, setDueTime] = useState(ex.due_time || '19:00');
  const [recurrence, setRecurrence] = useState(ex.recurrence || 'daily');
  const [days, setDays] = useState((ex.recurrence_days || 'mon,tue,wed,thu,fri,sat,sun').split(','));
  const [startDate, setStartDate] = useState(ex.start_date || todayStr);
  const [hasEnd, setHasEnd] = useState(!!ex.end_date);
  const [endDate, setEndDate] = useState(ex.end_date || '');
  const [assignee, setAssignee] = useState(ex.assigned_user_id || '');
  const [grace, setGrace] = useState(ex.grace_minutes ?? 45);
  const [saving, setSaving] = useState(false);
  const DOW = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

  const save = async () => {
    if (saving) return;
    const details = type === 'medication' && (medName.trim() || dose.trim())
      ? { med_name: medName.trim() || undefined, dose: dose.trim() || undefined } : null;
    const body = {
      care_recipient_id: recipientId, title: title.trim(), task_type: type, details,
      recurrence, recurrence_days: recurrence === 'days' ? days.join(',') : undefined,
      due_time: dueTime, start_date: startDate, end_date: hasEnd ? (endDate || undefined) : null,
      assigned_user_id: assignee || null, grace_minutes: Number(grace),
    };
    setSaving(true);
    try {
      const res = await apiFetch(existing ? `/api/care-tasks/${existing.id}` : '/api/care-tasks', {
        method: existing ? 'PUT' : 'POST', body: JSON.stringify(body),
      });
      if (res?.ok) { showToast(existing ? 'Task updated' : 'Task created', 'success'); onSaved(); onClose(); }
      else { const d = await res.json().catch(() => ({})); showToast(d.error || 'Could not save task', 'error'); }
    } catch { showToast('Could not save task', 'error'); }
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
          {existing ? 'Edit task' : `New task for ${recipientFirstName}`}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 4 }}>
          The team gets reminded, checks it off, and it's on the record.
        </div>

        <div style={label}>What kind?</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {CARE_TASK_TYPES.map(t => (
            <button key={t.id} style={chip(type === t.id)} onClick={() => setType(t.id)}>{t.icon} {t.label}</button>
          ))}
        </div>

        <div style={label}>Task</div>
        <input style={input} value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder={type === 'medication' ? `Give ${recipientFirstName} her evening medication` : type === 'hygiene' ? 'Help with a bath' : type === 'meal' ? 'Make sure dinner happened' : type === 'checkin' ? 'Stop by and check in' : 'What needs doing?'} />
        {type === 'medication' && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input style={{ ...input, flex: 2 }} value={medName} onChange={(e) => setMedName(e.target.value)} placeholder="Medication name (optional)" />
            <input style={{ ...input, flex: 1 }} value={dose} onChange={(e) => setDose(e.target.value)} placeholder="Dose" />
          </div>
        )}

        <div style={label}>When</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="time" style={{ ...input, width: 130 }} value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
          <button style={chip(recurrence === 'daily')} onClick={() => setRecurrence('daily')}>Every day</button>
          <button style={chip(recurrence === 'days')} onClick={() => setRecurrence('days')}>Some days</button>
          <button style={chip(recurrence === 'weekly')} onClick={() => setRecurrence('weekly')}>Weekly</button>
        </div>
        {recurrence === 'days' && (
          <div style={{ display: 'flex', gap: 5, marginTop: 8 }}>
            {DOW.map(d => (
              <button key={d} onClick={() => setDays(days.includes(d) ? days.filter(x => x !== d) : [...days, d])}
                style={{ ...chip(days.includes(d)), padding: '6px 0', flex: 1, textAlign: 'center', textTransform: 'capitalize' }}>{d[0].toUpperCase() + d[1]}</button>
            ))}
          </div>
        )}

        <div style={label}>Starting · for how long</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" style={{ ...input, width: 150 }} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <button style={chip(!hasEnd)} onClick={() => setHasEnd(false)}>Ongoing</button>
          <button style={chip(hasEnd)} onClick={() => setHasEnd(true)}>Until…</button>
          {hasEnd && <input type="date" style={{ ...input, width: 150 }} value={endDate} onChange={(e) => setEndDate(e.target.value)} />}
        </div>

        <div style={label}>Whose job is it?</div>
        <select style={input} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">Whole care team (everyone gets the reminder)</option>
          {(teamMembers || []).map(m => (
            <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>
          ))}
        </select>

        <div style={label}>If it's not checked off…</div>
        <select style={input} value={grace} onChange={(e) => setGrace(e.target.value)}>
          {[15, 30, 45, 60, 90, 120].map(g => (
            <option key={g} value={g}>Alert the whole team after {g >= 60 ? `${g / 60} hour${g > 60 ? 's' : ''}` : `${g} minutes`}</option>
          ))}
        </select>

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button disabled={saving || !title.trim()} onClick={save} style={{
            flex: 1, padding: '12px 0', borderRadius: 12, border: 'none', background: 'var(--accent-color)',
            color: 'var(--text-on-primary)', fontSize: 15, fontWeight: 700, cursor: 'pointer', opacity: saving || !title.trim() ? 0.5 : 1,
          }}>{existing ? 'Save changes' : 'Create task'}</button>
          <button onClick={onClose} style={{ padding: '12px 18px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
};

// ─── Recipient-profile card: manage task definitions ───
const CareTasksSection = window.CareTasksSection = ({ recipientId, recipientFirstName }) => {
  const { showToast } = useToast();
  const [data, setData] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    try {
      const res = await apiFetch(`/api/care-tasks/recipient/${recipientId}`);
      if (res?.ok) setData(await res.json());
    } catch {}
  };
  useEffect(() => { if (recipientId) load(); }, [recipientId]);

  if (!data) return null;
  const { tasks, canManage, teamMembers } = data;

  const scheduleLine = (t) => {
    const time = TimezoneHelper.formatTime(t.due_time);
    const rep = t.recurrence === 'daily' ? 'every day'
      : t.recurrence === 'weekly' ? 'weekly'
      : (t.recurrence_days || '').split(',').map(d => d && d[0].toUpperCase() + d.slice(1, 3)).join(' ');
    const until = t.end_date ? ` · until ${t.end_date}` : '';
    const who = t.assignee_first_name ? ` · ${t.assignee_first_name}'s job` : ' · whole team';
    return `${time} · ${rep}${until}${who}`;
  };

  const toggleActive = async (t) => {
    try {
      const res = await apiFetch(`/api/care-tasks/${t.id}`, { method: 'PUT', body: JSON.stringify({ is_active: t.is_active ? 0 : 1 }) });
      if (res?.ok) load(); else showToast('Could not update', 'error');
    } catch { showToast('Could not update', 'error'); }
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div className="card-header" style={{ margin: 0 }}><span className="card-icon">{'✅'}</span>Care Tasks</div>
        {canManage && (
          <button onClick={() => { setEditing(null); setShowForm(true); }}
            style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: 'var(--accent-color)', color: 'var(--text-on-primary)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            + Add task
          </button>
        )}
      </div>
      {tasks.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '8px 0' }}>
          Recurring things the care team keeps on track — medications, baths, check-ins.
          Reminders go out, whoever's there checks it off, and it's on the record.
        </div>
      ) : tasks.map(t => (
        <div key={t.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border-light)', opacity: t.is_active ? 1 : 0.55 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
                {careTaskIcon(t.task_type)} {t.title}{!t.is_active && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}> · paused</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{scheduleLine(t)}</div>
              <CareTaskStrip recent={t.recent} />
            </div>
            {canManage && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => { setEditing(t); setShowForm(true); }}
                  style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Edit</button>
                <button onClick={() => toggleActive(t)}
                  style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-tertiary)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                  {t.is_active ? 'Pause' : 'Resume'}
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
      {showForm && (
        <CareTaskFormModal recipientId={recipientId} recipientFirstName={recipientFirstName}
          teamMembers={teamMembers} existing={editing}
          onClose={() => setShowForm(false)} onSaved={load} />
      )}
    </div>
  );
};
