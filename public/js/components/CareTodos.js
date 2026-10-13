// ─── One-time to-dos: "for the next visit" (v1.109.9) ───────────────────
//
// Pete (e4cd314a): "The task function. It's set up like everything is recurring. There needs to
// be a to-do option… Something that reminds the next person that shows up at her house to
// accomplish a task. Like, I need to lock her stove against the wall. It doesn't have a time, it
// doesn't have to be me, but somebody needs to do it when they're there."
//
// Not a care task, on purpose: no time, no owner, no reminder, no "missed". Whoever is there does
// it once, and it moves to Done with their name on it. Server: routes/careTodos.js.
//
// Drawn in four places, one component: the Care Tasks card on the loved one's profile, the
// family Dashboard (above Next Up, only when something is open), the caregiver's "Today at
// Betty's" under her visit card, and the check-in briefing.

const CARE_TODOS_CHANGED = 'inplace:care-todos-changed';
const careTodosAnnounce = window.careTodosAnnounce = () => {
  try { window.dispatchEvent(new Event(CARE_TODOS_CHANGED)); } catch { /* the next load shows the truth */ }
};

const careTodoWhen = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      timeZone: typeof TimezoneHelper !== 'undefined' ? TimezoneHelper.DEFAULT_TZ : undefined,
    });
  } catch { return ''; }
};

// ─── Add a to-do: a title and, optionally, a sentence of detail. Nothing else. ───
const CareTodoForm = window.CareTodoForm = ({ recipientId, recipientFirstName, onClose, onSaved, onSwitchToRecurring }) => {
  const { showToast } = useToast();
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (saving || !title.trim()) return;
    setSaving(true);
    try {
      const res = await apiFetch('/api/care-todos', {
        method: 'POST',
        body: JSON.stringify({ care_recipient_id: recipientId, title: title.trim(), details: details.trim() || undefined }),
      });
      if (res?.ok) {
        showToast('To-do added — whoever’s there next will see it', 'success');
        careTodosAnnounce();
        if (onSaved) onSaved();
        onClose();
      } else {
        const d = res ? await res.json().catch(() => ({})) : {};
        showToast(d.error || 'Could not add the to-do', 'error');
      }
    } catch { showToast('Could not reach InPlace', 'error'); }
    setSaving(false);
  };
  const input = { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-color)', fontSize: 14, background: 'var(--bg-surface)', color: 'var(--text-primary)', boxSizing: 'border-box', fontFamily: 'inherit' };
  const label = { fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '14px 0 6px' };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-card)', borderRadius: 16, width: '100%', maxWidth: 480, padding: 20, maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box' }}>
        <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--text-primary)', marginBottom: 4 }}>
          New to-do for {recipientFirstName || 'your loved one'}
        </div>
        {onSwitchToRecurring && <CareTaskKindChoice kind="todo" onChange={(k) => { if (k === 'recurring') onSwitchToRecurring(); }} />}
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 6 }}>
          One time, no deadline. Whoever is there next {'—'} you, the team, or the caregiver on the visit {'—'} does it and checks it off.
        </div>
        <div style={label}>What needs doing?</div>
        <input style={input} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)}
          placeholder="Lock her stove against the wall" autoFocus />
        <div style={label}>Details (optional)</div>
        <textarea style={{ ...input, resize: 'vertical' }} rows={3} maxLength={2000} value={details}
          onChange={(e) => setDetails(e.target.value)} placeholder="The bracket is in the kitchen drawer." />
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button disabled={saving || !title.trim()} onClick={save} style={{
            flex: 1, minHeight: 44, padding: '12px 0', borderRadius: 12, border: 'none', background: 'var(--accent-color)',
            color: 'var(--text-on-primary)', fontSize: 15, fontWeight: 700, cursor: 'pointer', opacity: saving || !title.trim() ? 0.5 : 1,
          }}>{saving ? 'Adding…' : 'Add to-do'}</button>
          <button onClick={onClose} style={{ minHeight: 44, padding: '12px 18px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
};

// ─── "Recurring task" vs "To-do (next visit)" — the first question in the create flow ───
const CareTaskKindChoice = window.CareTaskKindChoice = ({ kind, onChange }) => {
  const chip = (selected) => ({
    flex: 1, minHeight: 44, padding: '8px 10px', borderRadius: 12, fontSize: 13.5, fontWeight: selected ? 700 : 600, cursor: 'pointer',
    border: selected ? '2px solid var(--role-color)' : '1px solid var(--border-color)',
    background: selected ? 'var(--role-color-light)' : 'var(--bg-card)',
    color: selected ? 'var(--role-color)' : 'var(--text-secondary)',
  });
  return (
    <div role="radiogroup" aria-label="Kind of task" style={{ display: 'flex', gap: 8, marginTop: 10 }}>
      <button role="radio" aria-checked={kind === 'recurring'} style={chip(kind === 'recurring')} onClick={() => onChange('recurring')}>
        {'🔁'} Recurring task
      </button>
      <button role="radio" aria-checked={kind === 'todo'} style={chip(kind === 'todo')} onClick={() => onChange('todo')}>
        {'📌'} To-do (next visit)
      </button>
    </div>
  );
};

// ─── The list ───
//
// recipientIds: limit to these people (the caregiver's visit, or one profile). Omit for everyone
// the viewer can reach. hideWhenNothingOpen: draw nothing unless something is waiting — the
// Dashboard and the caregiver's home do not need a card about nothing. showAdd: offer "+ Add" to
// people allowed to add (one profile).
const CareTodoList = window.CareTodoList = ({ recipientIds, heading, hideWhenNothingOpen, showAdd, framed }) => {
  // v1.112.3 — Pete: "i like the to do list, but make it collapsable." Folds like every other
  // section and remembers it on the account (useStickySection), per placement.
  // (Falls back to plain state where the sticky hook isn't loaded, e.g. the render tests.)
  const useFold = typeof useStickySection === 'function' ? useStickySection : (_k, d) => [d, () => {}];
  const [expanded, setExpanded] = useFold(`careTodos:${heading || 'next-visit'}`, true);
  const { showToast } = useToast();
  const [groups, setGroups] = useState(null);
  const [doneOpen, setDoneOpen] = useState(false);
  const [finishing, setFinishing] = useState(null); // todo id with the note box open
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(null);
  const [adding, setAdding] = useState(null); // group being added to
  const idsKey = (recipientIds || []).slice().sort().join(',');
  const single = recipientIds && recipientIds.length === 1 ? recipientIds[0] : null;
  const myId = window.__currentUserId;

  const load = useCallback(async () => {
    if (recipientIds && !idsKey) { setGroups([]); return; }
    try {
      const res = await apiFetch(single && showAdd ? `/api/care-todos?recipientId=${encodeURIComponent(single)}` : '/api/care-todos');
      if (res?.ok) {
        const d = await res.json();
        const ids = idsKey ? new Set(idsKey.split(',')) : null;
        setGroups((d.groups || []).filter((g) => !ids || ids.has(g.careRecipientId)));
      } else {
        setGroups((prev) => (prev === null ? [] : prev));
      }
    } catch { setGroups((prev) => (prev === null ? [] : prev)); }
  }, [idsKey, single, showAdd]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onChange = () => load();
    window.addEventListener(CARE_TODOS_CHANGED, onChange);
    return () => window.removeEventListener(CARE_TODOS_CHANGED, onChange);
  }, [load]);

  const act = async (todo, verb, body) => {
    if (busy) return;
    setBusy(todo.id);
    try {
      const res = await apiFetch(`/api/care-todos/${todo.id}/${verb}`, { method: 'POST', body: JSON.stringify(body || {}) });
      if (res?.ok) {
        if (verb === 'done') showToast('Done — thank you', 'success');
      } else if (res?.status === 409) {
        // Someone else got there first. That is the outcome everyone wanted.
        showToast(verb === 'done' ? 'Already done by someone else' : 'That was already undone', 'info');
      } else {
        const d = res ? await res.json().catch(() => ({})) : {};
        showToast(d.error || 'That didn’t go through. Try again.', 'error');
      }
    } catch { showToast('Could not reach InPlace', 'error'); }
    setBusy(null);
    setFinishing(null);
    setNote('');
    careTodosAnnounce();
  };

  const remove = async (todo) => {
    if (!window.confirm(`Remove "${todo.title}"?`)) return;
    try {
      const res = await apiFetch(`/api/care-todos/${todo.id}`, { method: 'DELETE' });
      if (res?.ok) { showToast('Removed', 'success'); careTodosAnnounce(); }
      else {
        const d = res ? await res.json().catch(() => ({})) : {};
        showToast(d.error || 'Couldn’t remove that', 'error');
      }
    } catch { showToast('Could not reach InPlace', 'error'); }
  };

  if (!groups) return null;
  const open = groups.flatMap((g) => g.open.map((t) => ({ t, g })));
  const done = groups.flatMap((g) => g.done.map((t) => ({ t, g })));
  const addable = showAdd ? groups.filter((g) => g.canAdd) : [];
  if (open.length === 0 && (hideWhenNothingOpen || (done.length === 0 && addable.length === 0))) return null;
  const many = groups.length > 1;

  const small = { minHeight: 44, padding: '0 12px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer' };

  const body = (
    <div data-testid="care-todos">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, margin: '4px 2px 8px' }}>
        <div role="button" tabIndex={0} aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded); } }}
          style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 36, cursor: 'pointer', flex: 1, minWidth: 0,
            fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{'📌'} {heading || 'To-dos for the next visit'}{open.length ? ` (${open.length})` : ''}</span>
          <span aria-hidden="true" style={{ fontSize: 14, transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'rotate(0)' }}>{'▼'}</span>
        </div>
        {expanded && addable.length === 1 && (
          <button onClick={() => setAdding(addable[0])} style={{ ...small, minHeight: 36, border: 'none', background: 'var(--bg-teal-light)', color: 'var(--role-color)' }}>+ Add to-do</button>
        )}
      </div>

      {expanded && (<>

      {open.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '2px 2px 8px' }}>
          Nothing waiting. Add a one-time job {'—'} whoever{'’'}s there next will see it.
        </div>
      )}

      {open.map(({ t, g }) => (
        <div key={t.id} style={{
          padding: '12px 14px', marginBottom: 8, borderRadius: 12,
          border: '1px solid var(--border-color)', background: 'var(--bg-card)',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{t.title}</div>
              {t.details && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 3, whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{t.details}</div>}
              <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 4 }}>
                {many && g.recipientFirstName ? `For ${g.recipientFirstName} · ` : ''}
                Added{t.created_by_first_name ? ` by ${t.created_by_first_name}` : ''}{t.created_at ? ` · ${careTodoWhen(t.created_at)}` : ''}
              </div>
            </div>
            {(g.canRemove || (!g.viaVisit && t.created_by === myId)) && (
              <button onClick={() => remove(t)} aria-label={`Remove ${t.title}`} style={{ minWidth: 44, minHeight: 44, background: 'none', border: 'none', color: 'var(--text-tertiary)', fontSize: 18, cursor: 'pointer' }}>{'×'}</button>
            )}
          </div>
          {g.canDo && finishing !== t.id && (
            <button onClick={() => { setFinishing(t.id); setNote(''); }} disabled={busy === t.id}
              style={{ ...small, marginTop: 8, width: '100%', border: 'none', background: 'var(--accent-color-dark)', color: 'var(--text-on-primary)' }}>
              {'✓'} I did this
            </button>
          )}
          {g.canDo && finishing === t.id && (
            <div style={{ marginTop: 8 }}>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000}
                placeholder="Add a note (optional)"
                style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 13.5, fontFamily: 'inherit', resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button onClick={() => act(t, 'done', { note: note.trim() || undefined })} disabled={busy === t.id}
                  style={{ ...small, flex: 1, border: 'none', background: 'var(--accent-color-dark)', color: 'var(--text-on-primary)' }}>
                  {busy === t.id ? 'Saving…' : 'Mark done'}
                </button>
                <button onClick={() => setFinishing(null)} style={{ ...small, border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      ))}

      {done.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <button onClick={() => setDoneOpen(!doneOpen)} aria-expanded={doneOpen}
            style={{ minHeight: 36, border: 'none', background: 'none', padding: '0 2px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
            Done ({done.length}) {doneOpen ? '▲' : '▼'}
          </button>
          {doneOpen && done.map(({ t, g }) => {
            const who = [t.completed_by_first_name, t.completed_by_last_name].filter(Boolean).join(' ') || 'someone';
            const canUndo = g.canDo && (!g.viaVisit || t.completed_by_user_id === myId);
            return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 2px', borderBottom: '1px solid var(--border-light)' }}>
                <span aria-hidden="true" style={{ color: 'var(--role-color)', fontWeight: 700 }}>{'✓'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', textDecoration: 'line-through', overflowWrap: 'anywhere' }}>{t.title}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 2 }}>
                    {who} {'·'} {careTodoWhen(t.completed_at)}{many && g.recipientFirstName ? ` · for ${g.recipientFirstName}` : ''}
                  </div>
                  {t.completion_note && <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 2, fontStyle: 'italic', overflowWrap: 'anywhere' }}>{t.completion_note}</div>}
                </div>
                {canUndo && (
                  <button onClick={() => act(t, 'undo')} disabled={busy === t.id}
                    style={{ minHeight: 44, padding: '0 10px', background: 'none', border: 'none', color: 'var(--accent-color)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Undo</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {adding && (
        <CareTodoForm recipientId={adding.careRecipientId} recipientFirstName={adding.recipientFirstName}
          onClose={() => setAdding(null)} onSaved={load} />
      )}
      </>)}
    </div>
  );

  if (framed) return <div style={{ marginBottom: 16 }}>{body}</div>;
  return body;
};

// ─── "You're at Betty's" — the arrival prompt (v1.112.4) ───
//
// Pete, 10/13: "on the to-dos it would be great if it prompted you when you got to the care
// location, i.e. Betty's house."
//
// Two ways in, one sheet:
//   • family — when the app opens or comes back to the front, on a phone that has ALREADY
//     allowed location, it asks the server (POST /api/care-todos/nearby) whether this point is
//     at a loved one's home with something waiting. It never asks for location permission just
//     for this, and the point is not kept.
//   • caregiver — check-in already proves she is at the house, so CaretakerHub fires
//     `inplace:arrivalTodos` with the recipient the moment check-in succeeds.
// Once per person per few hours: walking in and out to the car is not a new arrival.
//
// A phone-in-pocket buzz (a background geofence) needs "Always" location and a native build;
// that is on the backlog, not here.
const ARRIVAL_QUIET_MS = 4 * 3600000;
const ARRIVAL_CHECK_EVERY_MS = 10 * 60000;
const arrivalKey = (rid) => `inplace_arrival_${rid}`;
const arrivalQuiet = (rid) => {
  try { return Date.now() - Number(localStorage.getItem(arrivalKey(rid)) || 0) < ARRIVAL_QUIET_MS; } catch { return false; }
};
const arrivalMark = (rid) => { try { localStorage.setItem(arrivalKey(rid), String(Date.now())); } catch {} };

// Has this device already said yes to location? Never prompts.
const locationAlreadyAllowed = async () => {
  try {
    const plugin = typeof window.__capPlugin === 'function' ? window.__capPlugin('Geolocation') : null;
    if (plugin && plugin.checkPermissions) {
      const p = await plugin.checkPermissions();
      return p && (p.location === 'granted' || p.coarseLocation === 'granted');
    }
    if (navigator.permissions && navigator.permissions.query) {
      const st = await navigator.permissions.query({ name: 'geolocation' });
      return st && st.state === 'granted';
    }
  } catch { /* unknown is no */ }
  return false;
};

const ArrivalTodosHost = window.ArrivalTodosHost = ({ userId, ready, role }) => {
  const [here, setHere] = useState(null); // { careRecipientId, recipientFirstName, openCount }
  const lastCheck = useRef(0);

  // Family: on open and on return to the front.
  useEffect(() => {
    if (!ready || !userId || role !== 'family') return;
    let gone = false;
    const check = async () => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - lastCheck.current < ARRIVAL_CHECK_EVERY_MS) return;
      lastCheck.current = Date.now();
      if (!(await locationAlreadyAllowed())) return;
      const loc = typeof getDeviceLocation === 'function' ? await getDeviceLocation({ timeoutMs: 15000 }) : null;
      const c = loc && loc.pos && loc.pos.coords;
      if (!c || gone) return;
      try {
        const res = await apiFetch('/api/care-todos/nearby', {
          method: 'POST', body: JSON.stringify({ latitude: c.latitude, longitude: c.longitude }),
        });
        if (!res?.ok || gone) return;
        const d = await res.json();
        const first = (d.here || []).find((h) => !arrivalQuiet(h.careRecipientId));
        if (first) { arrivalMark(first.careRecipientId); setHere(first); }
      } catch { /* a courtesy, never in the way */ }
    };
    const t = setTimeout(check, 2500); // after the first screen has drawn
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { gone = true; clearTimeout(t); document.removeEventListener('visibilitychange', onVis); };
  }, [userId, ready, role]);

  // Caregiver: check-in succeeded.
  useEffect(() => {
    const onArrive = async (e) => {
      const rid = e?.detail?.careRecipientId;
      if (!rid || arrivalQuiet(rid)) return;
      try {
        const res = await apiFetch(`/api/care-todos?recipientId=${encodeURIComponent(rid)}`);
        if (!res?.ok) return;
        const d = await res.json();
        const g = (d.groups || []).find((x) => x.careRecipientId === rid);
        if (g && g.open && g.open.length) {
          arrivalMark(rid);
          setHere({ careRecipientId: rid, recipientFirstName: g.recipientFirstName, openCount: g.open.length });
        }
      } catch {}
    };
    window.addEventListener('inplace:arrivalTodos', onArrive);
    return () => window.removeEventListener('inplace:arrivalTodos', onArrive);
  }, []);

  if (!here) return null;
  const name = here.recipientFirstName || 'the house';
  const close = () => setHere(null);
  return (
    <div onClick={close} data-testid="arrival-todos"
      style={{ position: 'fixed', inset: 0, zIndex: 10030, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`To-dos at ${name}'s`}
        style={{ background: 'var(--bg-primary)', borderRadius: '18px 18px 0 0', width: '100%', maxWidth: 520, maxHeight: '85vh', overflowY: 'auto', boxSizing: 'border-box',
          padding: '18px 16px calc(16px + env(safe-area-inset-bottom, 0px))' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
          {'🏡'} You{'’'}re at {name}{here.recipientFirstName ? '’s' : ''}
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '4px 0 12px' }}>
          {here.openCount === 1 ? 'One to-do is' : `${here.openCount} to-dos are`} waiting for whoever{'’'}s there.
        </div>
        <CareTodoList recipientIds={[here.careRecipientId]} heading="To-dos for this visit" />
        <button onClick={close} style={{ width: '100%', minHeight: 48, marginTop: 8, borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
          Not now
        </button>
      </div>
    </div>
  );
};
