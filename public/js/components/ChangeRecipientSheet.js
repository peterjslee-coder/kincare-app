// ─── v1.129.1 — Change who a request goes to ───
//
// Pete, 11/16 (feedback ddd923a7): "I want the ability to be able to edit requests that I've sent
// to caretakers. In case I have sent it to everyone, but I wanted it to be for Tina only."
//
// Same three shapes the booking form offers (RequestCareModal): everyone; one caregiver first for
// an hour, then everyone; one caregiver only. A series asks "just this visit, or this and the
// later ones", like CancelSessionModal. PUT /api/sessions/:id/recipient does the work and tells
// people; narrowing to one caregiver withdraws other caregivers' offers (Pete's call).

const ChangeRecipientSheet = window.ChangeRecipientSheet = ({ session, onClose, onChanged }) => {
  const { showToast } = useToast();
  const [people, setPeople] = React.useState(null); // null = loading
  const [choice, setChoice] = React.useState(session.offeredToCaregiverId || 'everyone');
  const [onlyThem, setOnlyThem] = React.useState(false);
  const [scope, setScope] = React.useState('this');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const q = session.careRecipientId ? `?careRecipientId=${encodeURIComponent(session.careRecipientId)}` : '';
        const res = await apiFetch(`/api/assignments/suggestions${q}`);
        const data = res && res.ok ? await res.json() : {};
        const list = (data.suggestions || [])
          .filter((c) => c && c.caregiver_profile_id)
          .map((c) => ({
            id: c.caregiver_profile_id,
            name: [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Caregiver',
            known: c.source === 'history' || c.source === 'assigned',
            visits: c.visit_count || 0,
          }));
        list.sort((a, b) => (b.known - a.known) || (b.visits - a.visits) || a.name.localeCompare(b.name));
        if (!cancelled) setPeople(list);
      } catch (e) {
        if (!cancelled) setPeople([]);
      }
    })();
    return () => { cancelled = true; };
  }, [session.id]);

  const picked = choice !== 'everyone' ? (people || []).find((p) => p.id === choice) : null;
  const firstName = picked ? picked.name.split(' ')[0] : '';

  const save = async () => {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/sessions/${session.id}/recipient`, {
        method: 'PUT',
        body: JSON.stringify({
          caregiverId: choice === 'everyone' ? null : choice,
          privateOnly: choice !== 'everyone' && onlyThem,
          scope,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const n = data.count || 1;
        showToast(choice === 'everyone'
          ? `Now open to all caregivers${n > 1 ? ` (${n} visits)` : ''}`
          : `Sent to ${firstName}${onlyThem ? ' only' : ''}${n > 1 ? ` (${n} visits)` : ''}`, 'success');
        if (onChanged) onChanged(data);
      } else {
        showToast(data.error || 'Could not change who this goes to', 'error');
      }
    } catch (e) {
      showToast('Network error — please try again', 'error');
    }
    setSaving(false);
  };

  const radio = (on) => ({
    display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', minHeight: 48,
    padding: '10px 12px', borderRadius: 10, cursor: 'pointer', font: 'inherit', fontSize: 14,
    border: on ? '2px solid var(--role-color)' : '1px solid var(--border-color)',
    background: on ? 'var(--bg-highlight)' : 'var(--bg-card)', color: 'var(--text-primary)',
  });
  const dot = (on) => (
    <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: 9, flexShrink: 0, border: on ? '6px solid var(--role-color)' : '2px solid var(--border-color)', boxSizing: 'border-box' }} />
  );

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="crs-title"
        style={{ background: 'var(--bg-card)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 440, maxHeight: '88vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <h3 id="crs-title" style={{ margin: 0, fontSize: 18, color: 'var(--text-primary)' }}>Who should this go to?</h3>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
            {session.recipientName || 'Visit'} {'·'} {session.date ? TimezoneHelper.getDateLabel(String(session.date).split('T')[0], session.timezone || TimezoneHelper.DEFAULT_TZ) : ''}{session.time ? ` at ${TimezoneHelper.formatTime(session.time)}` : ''}
          </div>
        </div>

        <div role="radiogroup" aria-label="Send to" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button type="button" role="radio" aria-checked={choice === 'everyone'} onClick={() => setChoice('everyone')} style={radio(choice === 'everyone')}>
            {dot(choice === 'everyone')}
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontWeight: 600 }}>All caregivers</span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Anyone who can work for you may accept</span>
            </span>
          </button>
          {people === null && <div style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '6px 2px' }}>Loading your caregivers…</div>}
          {people && people.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '6px 2px' }}>No caregivers to choose from yet.</div>}
          {(people || []).map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={choice === p.id} onClick={() => setChoice(p.id)} style={radio(choice === p.id)}>
              {dot(choice === p.id)}
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontWeight: 600 }}>{p.name}</span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {p.visits > 0 ? `${p.visits} visit${p.visits === 1 ? '' : 's'} with you` : (p.known ? 'On your team' : 'Nearby')}
                </span>
              </span>
            </button>
          ))}
        </div>

        {choice !== 'everyone' && picked && (
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, color: 'var(--text-primary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={onlyThem} onChange={(e) => setOnlyThem(e.target.checked)} style={{ width: 20, height: 20, marginTop: 1 }} />
            <span>
              <span style={{ fontWeight: 600 }}>Only {firstName}</span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                {onlyThem ? `It stays with ${firstName} and is never posted to others.` : `${firstName} gets it first for an hour, then it opens to all caregivers.`}
              </span>
            </span>
          </label>
        )}

        {choice !== 'everyone' && (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Other caregivers who offered to take it are told it{'’'}s been arranged with someone else.
          </div>
        )}

        {session.recurrenceGroupId && (
          <div role="radiogroup" aria-label="Which visits" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[['this', 'Just this visit'], ['series', 'This and the later open visits']].map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={scope === v} onClick={() => setScope(v)}
                style={{ ...radio(scope === v), width: 'auto', flex: '1 1 160px', minHeight: 44 }}>{dot(scope === v)}<span>{l}</span></button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button type="button" onClick={onClose} disabled={saving}
            style={{ flex: 1, minHeight: 46, borderRadius: 10, border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>Keep as is</button>
          <button type="button" onClick={save} disabled={saving || (choice !== 'everyone' && !picked)}
            style={{ flex: 1, minHeight: 46, borderRadius: 10, border: 'none', background: 'var(--role-color)', color: 'var(--text-on-primary)', fontSize: 15, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
};
