// ─── HelperHub — the home screen for a neighbour who helps (v1.105.93) ───
//
// Pete, describing Peggy: "someone I can add to the care team. They don't need stripe, it's all
// vouch-for-neighbor type of approval... She won't use the app much, definitely won't give any
// info to me, but may leave notes. Probably great notes, honestly."
//
// So this screen is built for someone who opens the app rarely and has one thing to say. Two
// buttons, the people she helps, and what she has already written. No schedule, no payments, no
// job feed, no onboarding checklist — none of which is hers.
//
// It renders from her CAPABILITIES, not from her role. The role picked this screen; what appears
// on it is whatever Pete ticked when he invited her. A helper granted medication tasks sees them;
// one who was not, does not — and the difference is a checkbox, not a code change.
const HelperHub = window.HelperHub = () => {
  const [recipients, setRecipients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [noteFor, setNoteFor] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [saving, setSaving] = useState(false);
  const [showLogVisit, setShowLogVisit] = useState(null);
  const [recentNotes, setRecentNotes] = useState([]);

  const load = React.useCallback(async () => {
    try {
      const res = await apiFetch('/api/care-recipients');
      if (!res?.ok) { setLoadFailed(true); setLoading(false); return; }
      const d = await res.json();
      const list = d.careRecipients || d.recipients || [];
      setRecipients(Array.isArray(list) ? list : []);
      setLoadFailed(false);
    } catch {
      // A terminal else that actually says something — see the v1.103.2 rule.
      setLoadFailed(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveNote = async () => {
    if (!noteFor || !noteText.trim()) return;
    setSaving(true);
    try {
      const res = await apiFetch('/api/notes', {
        method: 'POST',
        body: JSON.stringify({ careRecipientId: noteFor.id, content: noteText.trim(), noteType: 'general' }),
      });
      if (res?.ok) {
        showToast('Note added — thank you', 'success');
        setRecentNotes((prev) => [{ id: Date.now(), content: noteText.trim(), name: noteFor.first_name, at: new Date().toISOString() }, ...prev].slice(0, 5));
        setNoteFor(null);
        setNoteText('');
      } else {
        const d = await res?.json().catch(() => ({}));
        showToast(d?.error || 'That note didn’t save — please try again', 'error');
      }
    } catch {
      showToast('That note didn’t save — check your connection', 'error');
    }
    setSaving(false);
  };

  if (loading) return <LoadingSpinner text="Loading…" />;

  return (
    <div style={{ padding: '16px 16px 90px', maxWidth: 640, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px', color: 'var(--text-primary)' }}>
        Thanks for helping
      </h1>
      <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', margin: '0 0 18px', lineHeight: 1.5 }}>
        Anything you notice is worth writing down. The family sees it straight away.
      </p>

      {loadFailed && (
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--bg-primary)', border: '1px solid var(--border-light)', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
          Couldn{'’'}t load who you help.{' '}
          <button onClick={load} style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'var(--accent-color)', fontWeight: 650, cursor: 'pointer' }}>Try again</button>
        </div>
      )}

      {!loadFailed && recipients.length === 0 && (
        <div style={{ padding: '18px 16px', borderRadius: 12, background: 'var(--bg-primary)', border: '1px solid var(--border-light)', fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          You{'’'}re all set up, but nobody has added you to their care team yet. When they do,
          they{'’'}ll appear here.
        </div>
      )}

      {recipients.map((r) => (
        <div key={r.id} className="card" style={{ marginBottom: 12, padding: '14px 16px' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{r.first_name} {r.last_name}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button onClick={() => { setNoteFor(r); setNoteText(''); }}
              style={{ flex: '1 1 150px', padding: '13px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 10, fontSize: 14.5, fontWeight: 700, cursor: 'pointer' }}>
              {'✍️'}  Leave a note
            </button>
            <button onClick={() => setShowLogVisit({ recipientId: r.id })}
              style={{ flex: '1 1 150px', padding: '13px', background: 'var(--bg-card)', color: 'var(--role-color)', border: '1px solid var(--role-color)', borderRadius: 10, fontSize: 14.5, fontWeight: 700, cursor: 'pointer' }}>
              {'🏠'}  I was there
            </button>
          </div>
        </div>
      ))}

      {recentNotes.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            What you{'’'}ve written
          </div>
          {recentNotes.map((n) => (
            <div key={n.id} style={{ padding: '10px 12px', background: 'var(--bg-primary)', borderRadius: 9, marginBottom: 8, fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5 }}>
              {n.content}
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>About {n.name}</div>
            </div>
          ))}
        </div>
      )}

      {noteFor && (
        <div onClick={() => !saving && setNoteFor(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: 'var(--bg-card)', borderRadius: '16px 16px 0 0', padding: 20, width: '100%', maxWidth: 640 }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>
              A note about {noteFor.first_name}
            </h3>
            <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} autoFocus
              placeholder="How did she seem? Anything you noticed?"
              style={{ width: '100%', minHeight: 110, padding: 12, border: '1px solid var(--border-light)', borderRadius: 10, fontSize: 15, resize: 'vertical', background: 'var(--bg-surface)', color: 'var(--text-primary)' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={() => setNoteFor(null)} disabled={saving}
                style={{ flex: 1, padding: '12px', background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={saveNote} disabled={saving || !noteText.trim()}
                style={{ flex: 1, padding: '12px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: saving ? 'wait' : 'pointer', opacity: noteText.trim() ? 1 : 0.6 }}>
                {saving ? 'Saving…' : 'Add note'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showLogVisit && typeof LogVisitSheet !== 'undefined' && (
        <LogVisitSheet
          recipients={recipients}
          presetRecipientId={showLogVisit.recipientId}
          position={null}
          onClose={() => setShowLogVisit(null)}
          onSaved={() => { setShowLogVisit(null); showToast('Visit logged — thank you', 'success'); }} />
      )}
    </div>
  );
};
