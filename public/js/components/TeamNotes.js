// ─── The care team's notes, for the people who are not the family (v1.105.153) ───
//
// Pete: "Julia sees my notes but when she clicks on the notification it says 'no care
// recipient found'." Then, on what the rule should be: "not all caregivers should get it...
// it's just that Julia IS on Betty's care team AND she's a caregiver", and "not all
// caregivers will be on the care team."
//
// So this screen is NOT "notes for caregivers". Role has nothing to do with it. The server
// answers "which care recipients has this person been given the care record for"
// (GET /api/notes/mine/recipients, capability READ_NOTES over owner + team members + shares),
// and a caregiver who is only assigned to a session appears in none of those sets, gets an
// empty list, and never sees this page in the nav.
//
// Read-only on purpose. Writing a note is an act with a subject — it goes in someone's care
// record and pushes the whole team — and the places to do that already exist with their own
// framing (the check-out summary, the family's own profile). This is for the person who was
// told a note exists and, until now, had nowhere to open it.
const TeamNotes = window.TeamNotes = ({ onNavigate }) => {
  const [recipients, setRecipients] = React.useState(null);
  const [selectedId, setSelectedId] = React.useState(null);
  const [notes, setNotes] = React.useState(null);
  // v1.105.156 — visits share this screen. Pete: "Julia is on the care team...she should be
  // able to see the notes, or I should be able to select it at least." She may read both; the
  // only thing she was missing was somewhere to do it, and a visit belongs in the same
  // timeline as a note — they are both "what happened with her recently".
  const [visits, setVisits] = React.useState([]);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [showAll, setShowAll] = React.useState(false);
  const [highlightId, setHighlightId] = React.useState(null);
  const PREVIEW = 8;

  React.useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/notes/mine/recipients');
        if (!res?.ok) { setLoadFailed(true); return; }
        const data = await res.json();
        const list = data.recipients || [];
        setRecipients(list);
        // A push carries the recipient it was about; otherwise the only one, or the first.
        const wanted = window.__pendingNoteRecipientId;
        const match = wanted && list.find((r) => r.id === wanted);
        setSelectedId(match ? match.id : (list[0]?.id || null));
      } catch { setLoadFailed(true); }
    })();
  }, []);

  React.useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    (async () => {
      setNotes(null);
      setVisits([]);
      try {
        const res = await apiFetch(`/api/notes/${selectedId}`);
        if (cancelled) return;
        if (!res?.ok) { setLoadFailed(true); return; }
        const data = await res.json();
        setNotes(data.notes || []);
        setLoadFailed(false);
      } catch { if (!cancelled) setLoadFailed(true); }

      // Only where the capability says so — never ask for a history we would be refused.
      const rec = (recipients || []).find((r) => r.id === selectedId);
      if (!rec?.canReadVisits) return;
      try {
        const vr = await apiFetch(`/api/family-visits/${selectedId}?limit=50`);
        if (cancelled || !vr?.ok) return;
        const vd = await vr.json();
        setVisits(vd.visits || []);
      } catch { /* a missing visit history must not blank the notes */ }
    })();
    return () => { cancelled = true; };
  }, [selectedId, recipients]);

  // The note the notification was about: show it even if it is far down, and mark it so the
  // person can see WHICH one they were told about.
  React.useEffect(() => {
    const f = window.__pendingFocus;
    if (!notes || !f || typeof f !== 'string' || !f.startsWith('note:')) return;
    const id = f.slice('note:'.length);
    if (!notes.some((n) => n.id === id)) return;
    window.__pendingFocus = null;
    window.__pendingNoteRecipientId = null;
    setShowAll(true);
    setHighlightId(id);
    setTimeout(() => {
      const el = document.querySelector(`[data-note-id="${id}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
    setTimeout(() => setHighlightId(null), 5000);
  }, [notes]);

  if (recipients === null && !loadFailed) return <LoadingSpinner text="Loading notes…" />;

  if (loadFailed && !recipients) {
    return (
      <div className="card" style={{ margin: 16 }}>
        <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Couldn't load notes.</div>
      </div>
    );
  }

  if (recipients && recipients.length === 0) {
    return (
      <EmptyState icon="📝" title="No care notes shared with you"
        text="When a family adds you to a care team and shares the care record, their notes show up here."
        actionLabel="Back to my hub" onAction={() => onNavigate && onNavigate('dashboard')} />
    );
  }

  const selected = (recipients || []).find((r) => r.id === selectedId);

  // v1.105.156 — one timeline. A caregiver arriving at the house wants "what has happened
  // with her recently", not two lists to reconcile by date.
  // v1.105.170 — `id` here is a REACT KEY, and a visit's is prefixed "v-" so it cannot
  // collide with a note's. The reaction endpoint needs the real row id, so both are carried:
  // `id` for the list, `targetId` + `targetType` for the write. Posting the prefixed one
  // would 404 every time, on a screen where nothing else would look wrong.
  const timeline = notes === null ? null : [
    ...notes.map((n) => ({
      kind: 'note', id: n.id, at: n.created_at, body: n.content,
      who: `${n.author_first_name || ''} ${n.author_last_name || ''}`.trim(),
      urgent: !!n.needs_attention,
      targetType: 'note', targetId: n.id, reactions: n.reactions || [],
    })),
    ...visits.map((v) => ({
      kind: 'visit', id: `v-${v.id}`, at: v.visitedAt || v.createdAt,
      body: v.summary || 'Visited.',
      who: v.authorName || v.authorFirstName || '',
      minutes: v.durationMinutes || null,
      mood: v.moodRating || null,
      targetType: 'family_visit', targetId: v.id, reactions: v.reactions || [],
    })),
  ].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));

  // The same whole-list write as CareProfile: the server returns every reaction on the row,
  // not a delta, because a delta is only right if this copy was already right.
  const handleReact = async (targetType, targetId, emoji) => {
    try {
      const res = await apiFetch(`/api/reactions/${targetType}/${targetId}`, {
        method: 'POST', body: JSON.stringify({ emoji }),
      });
      if (!res?.ok) return;
      const d = await res.json();
      const apply = (rows) => (rows || []).map((r) => (r.id === targetId ? { ...r, reactions: d.reactions } : r));
      if (targetType === 'note') setNotes(apply);
      else setVisits(apply);
    } catch { /* a reaction that does not save is a reaction that does not appear */ }
  };

  const visible = timeline && (showAll ? timeline : timeline.slice(0, PREVIEW));

  return (
    <div style={{ padding: '0 0 24px' }}>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-header" style={{ marginBottom: recipients.length > 1 ? 12 : 4 }}>
          <span className="card-icon">📝</span>
          {selected ? `${selected.firstName}'s care notes` : 'Care notes'}
        </div>

        {recipients.length > 1 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
            {recipients.map((r) => (
              <button key={r.id} onClick={() => { setSelectedId(r.id); setShowAll(false); }}
                style={{
                  minHeight: 44, padding: '0 14px', borderRadius: 10, cursor: 'pointer',
                  border: r.id === selectedId ? '2px solid var(--role-color)' : '1px solid var(--border-color)',
                  background: r.id === selectedId ? 'var(--bg-teal-light)' : 'var(--bg-card)',
                  color: r.id === selectedId ? 'var(--role-color)' : 'var(--text-secondary)',
                  font: 'inherit', fontSize: 13.5, fontWeight: 700,
                }}>{r.firstName}</button>
            ))}
          </div>
        )}

        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '4px 0 0' }}>
          Notes and visits from the care team. You can read these; the family writes them.
        </p>
      </div>

      {timeline === null ? (
        <LoadingSpinner text="Loading notes…" />
      ) : timeline.length === 0 ? (
        <div className="card" style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
          Nothing recorded yet for {selected ? selected.firstName : 'this person'}.
        </div>
      ) : (
        <div className="card">
          {visible.map((item) => (
            <div key={item.id} data-note-id={item.kind === 'note' ? item.id : undefined} style={{
              padding: '12px 4px', borderBottom: '1px solid var(--border-light)',
              transition: 'background 1.2s ease',
              background: highlightId === item.id ? 'rgba(74, 144, 217, 0.16)' : 'transparent',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                {item.kind === 'visit' && (
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: 'var(--role-color)',
                    background: 'var(--bg-teal-light)', padding: '2px 8px', borderRadius: 10,
                  }}>👣 Visit{item.minutes ? ` · ${item.minutes} min` : ''}</span>
                )}
                {/* v1.105.164 — how she seemed. Recorded on every visit, drawn on none of them
                    until now. */}
                {item.mood && typeof visitMoodEmoji === 'function' && visitMoodEmoji(item.mood) && (
                  <span title={visitMoodLabel(item.mood)} aria-label={visitMoodLabel(item.mood)}
                    style={{ fontSize: 15, lineHeight: 1 }}>{visitMoodEmoji(item.mood)}</span>
                )}
                {item.urgent && (
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: 'var(--color-warning)',
                    background: 'var(--color-warning-bg)', padding: '2px 8px', borderRadius: 10,
                  }}>⚠ Needs attention</span>
                )}
              </div>
              <div style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {item.body}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5 }}>
                {item.who}
                {item.at ? ` · ${TimezoneHelper.formatTimestamp(item.at, selected?.timezone, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) || ''}` : ''}
              </div>
              {typeof ReactionRow !== 'undefined' && (
                <ReactionRow reactions={item.reactions} currentUserId={window.__currentUserId}
                  onReact={(emoji) => handleReact(item.targetType, item.targetId, emoji)} />
              )}
            </div>
          ))}
          {timeline.length > PREVIEW && (
            <button onClick={() => setShowAll(!showAll)} style={{
              width: '100%', minHeight: 44, marginTop: 10, background: 'none',
              border: '1px dashed var(--border-color)', borderRadius: 10,
              color: 'var(--role-color)', font: 'inherit', fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
            }}>
              {showAll ? 'Show fewer' : `Show all ${timeline.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
