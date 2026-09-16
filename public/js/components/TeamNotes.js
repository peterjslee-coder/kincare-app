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
// v1.105.153 made it read-only on purpose, reasoning that "the places to write already exist
// with their own framing (the check-out summary, the family's own profile)". Julia, Sep 12:
// "I have the Care Notes tab now! I can't add any notes though."
//
// The reasoning was wrong in a way that is only visible from her side. The check-out summary
// exists during a visit; the family's profile page is not hers. Between visits — which is
// when you remember the thing you meant to say — she had the care record open in front of her
// and no way to add to it. Read-only was a decision about where writing belongs that
// accidentally became a decision that she does not write.
//
// So: the same composer the family has, posting to the same POST /api/notes, which has
// authorised her all along (hasAccess covers team members). Pete's call on scope was full
// parity including the photo and the attention flag — she is the one at the visit, so she is
// the one most likely to have the photo.
// v1.107.2 — Pete, Sep 16: Julia "can't leave notes. there's no 'log visit' with her." Her
// checkboxes allow both. The screen was listed only for READ_NOTES and never offered a visit
// log at all. Now the server says which of the four things this person may do for each
// recipient (canReadNotes / canWriteNotes / canReadVisits / canWriteVisits) and this screen
// draws exactly those — nothing about her being a caregiver enters into it.
const TeamNotes = window.TeamNotes = ({ onNavigate }) => {
  const { showToast } = useToast();
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
  const [newNote, setNewNote] = React.useState('');
  const [noteUrgent, setNoteUrgent] = React.useState(false);
  const [notePhoto, setNotePhoto] = React.useState(null); // { data, name }
  const [addingNote, setAddingNote] = React.useState(false);
  // A tap and an Enter arriving together saved Daniel's note twice on Sep 11 (14:27:14 and
  // 14:27:15). React state is too slow to be the lock; a ref is not. Same guard as CareProfile.
  const addingNoteRef = React.useRef(false);
  // v1.106.38 — Pete: "Added a picture to a visit note today and it doesn't show up."
  // It was there. The composer below has uploaded photos since v1.106.27 and the server
  // has returned has_photo since v1.76.0; this timeline just never drew one. Same lightbox
  // as CareProfile so a photo opens the same way wherever it is tapped.
  const [viewingAttachments, setViewingAttachments] = React.useState(null);
  const [showLogVisit, setShowLogVisit] = React.useState(false);
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
        // Home's "Log a visit" lands here with the sheet already open.
        if (window.__pendingLogVisit && match && match.canWriteVisits) setShowLogVisit(true);
        window.__pendingLogVisit = false;
      } catch { setLoadFailed(true); }
    })();
  }, []);

  React.useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    (async () => {
      setNotes(null);
      setVisits([]);
      const rec = (recipients || []).find((r) => r.id === selectedId);
      // Only what the checkboxes allow — never ask for something we would be refused.
      if (rec && rec.canReadNotes === false) {
        setNotes([]);
        setLoadFailed(false);
      } else {
        try {
          const res = await apiFetch(`/api/notes/${selectedId}`);
          if (cancelled) return;
          if (!res?.ok) { setLoadFailed(true); return; }
          const data = await res.json();
          setNotes(data.notes || []);
          setLoadFailed(false);
        } catch { if (!cancelled) setLoadFailed(true); }
      }

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
      // The flag and a count, never the blob — a 5MB data URI per row would make a
      // fifty-note timeline unusable. `photos` is the list the thumbnails fetch by id.
      photos: n.has_photo
        ? [{ path: `/api/notes/${n.id}/photo`, name: 'Care note photo', mime: '' }]
        : [],
      targetType: 'note', targetId: n.id, reactions: n.reactions || [],
    })),
    ...visits.map((v) => ({
      kind: 'visit', id: `v-${v.id}`, at: v.visitedAt || v.createdAt,
      body: v.summary || 'Visited.',
      who: v.authorName || v.authorFirstName || '',
      minutes: v.durationMinutes || null,
      mood: v.moodRating || null,
      // v1.105.111 — a visit carries up to four. `/photo` is index 0 for every row ever
      // written, `/photo/N` reaches the rest.
      photos: (v.photoCount > 0 || v.hasPhoto)
        ? Array.from({ length: v.photoCount || 1 }, (_, i) => ({
            path: i === 0 ? `/api/family-visits/${v.id}/photo` : `/api/family-visits/${v.id}/photo/${i}`,
            name: (v.photoCount || 1) > 1 ? `Visit photo ${i + 1} of ${v.photoCount}` : 'Visit photo',
            mime: '',
          }))
        : [],
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

  const addNote = async () => {
    if (addingNoteRef.current) return;
    addingNoteRef.current = true;
    try { await addNoteInner(); } finally { addingNoteRef.current = false; }
  };
  const addNoteInner = async () => {
    if (!newNote.trim() || !selectedId) return;
    setAddingNote(true);
    const payload = {
      careRecipientId: selectedId,
      content: newNote.trim(),
      noteType: 'observation',
      needsAttention: noteUrgent,
    };
    if (notePhoto) payload.photo = notePhoto.data;
    try {
      const res = await apiFetch('/api/notes', { method: 'POST', body: JSON.stringify(payload) });
      if (res?.ok) {
        setNewNote(''); setNoteUrgent(false); setNotePhoto(null);
        showToast('Note added', 'success');
        // Re-read rather than splice a guess in: the server attaches the author name and the
        // reaction rows, and iPAi may add chips to it.
        if (selected && selected.canReadNotes !== false) {
          const fresh = await apiFetch(`/api/notes/${selectedId}`);
          if (fresh?.ok) { const d = await fresh.json(); setNotes(d.notes || []); }
        }
      } else if (res?.status === 503 || !navigator.onLine) {
        // She is often in a house with no signal. The family composer queues; so does this.
        if (window.OfflineQueue) {
          await window.OfflineQueue.queueNote(payload);
          setNewNote(''); setNoteUrgent(false); setNotePhoto(null);
          showToast('Note saved offline — will sync when reconnected', 'success');
        } else { showToast("You're offline — try again later", 'error'); }
      } else {
        // v1.103.2 — never fall through silently: the spinner stops, the box clears, and
        // nothing says the note is gone.
        const d = await res?.json().catch(() => ({}));
        showToast(
          res?.status === 413 ? 'That photo is too large — try a smaller one.'
            : (d.error || 'Could not add that note — please try again.'),
          'error'
        );
      }
    } catch {
      if (!navigator.onLine && window.OfflineQueue) {
        try {
          await window.OfflineQueue.queueNote(payload);
          setNewNote(''); setNoteUrgent(false); setNotePhoto(null);
          showToast('Note saved offline — will sync when reconnected', 'success');
        } catch { showToast('Failed to add note', 'error'); }
      } else { showToast('Failed to add note', 'error'); }
    }
    setAddingNote(false);
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
          {selected && selected.canReadNotes === false && !selected.canReadVisits
            ? `You can add to ${selected.firstName}'s care record; reading it isn't part of your access.`
            : <>Notes and visits from the care team {'\u2014'} yours and theirs.</>}
        </p>
        {selected && selected.canWriteVisits && typeof LogVisitSheet !== 'undefined' && (
          <button onClick={() => setShowLogVisit(true)} style={{
            marginTop: 10, minHeight: 44, padding: '10px 16px', borderRadius: 10, cursor: 'pointer',
            border: '1px solid var(--role-color)', background: 'var(--bg-card)', color: 'var(--role-color)',
            font: 'inherit', fontSize: 14, fontWeight: 700,
          }}>👣 Log a visit with {selected.firstName}</button>
        )}
      </div>

      {showLogVisit && selected && typeof LogVisitSheet !== 'undefined' && (
        <LogVisitSheet recipients={[selected]} presetRecipientId={selected.id}
          onClose={() => setShowLogVisit(false)}
          onSaved={async () => {
            if (!selected.canReadVisits) return;
            try {
              const vr = await apiFetch(`/api/family-visits/${selected.id}?limit=50`);
              if (vr?.ok) { const vd = await vr.json(); setVisits(vd.visits || []); }
            } catch { /* the visit is saved; the list refreshes on the next open */ }
          }} />
      )}

      {/* ─── v1.106.26 — the composer Julia was missing ─── */}
      {selected && selected.canWriteNotes !== false && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
            Add a note about {selected.firstName}
          </div>
          <textarea value={newNote} onChange={(e) => setNewNote(e.target.value)}
            placeholder={`What did you notice? e.g. '${selected.firstName} ate well and was in good spirits. Left foot still looks swollen \u2014 worth a look.'`}
            rows={4}
            style={{
              width: '100%', minHeight: 80, padding: '10px 12px', border: '1px solid var(--border-color)',
              borderRadius: 8, fontSize: 14, fontFamily: 'inherit', resize: 'vertical',
              boxSizing: 'border-box', marginBottom: 8, background: 'var(--bg-surface)', color: 'var(--text-primary)',
            }}
            /* Enter sends, Shift+Enter is a newline — same as the family composer. The ref
               above is what stops a tap and an Enter arriving together saving it twice. */
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && newNote.trim()) { e.preventDefault(); addNote(); } }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={() => addNote()} disabled={addingNote || !newNote.trim()}
              style={{
                minHeight: 44, padding: '10px 20px',
                background: (addingNote || !newNote.trim()) ? 'var(--text-muted)' : 'var(--role-color)',
                color: 'var(--text-on-primary)', border: 'none', borderRadius: 8,
                fontWeight: 600, fontSize: 14, cursor: addingNote ? 'wait' : 'pointer', whiteSpace: 'nowrap',
              }}>
              {addingNote ? '\u2026' : 'Add note'}
            </button>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={noteUrgent} onChange={(e) => setNoteUrgent(e.target.checked)}
                style={{ accentColor: '#e65100', width: 18, height: 18 }} />
              Needs attention
            </label>
            <label style={{ fontSize: 13, color: notePhoto ? 'var(--role-color)' : 'var(--text-secondary)', cursor: 'pointer' }}>
              {notePhoto ? '\uD83D\uDCCE ' + notePhoto.name + ' \u2715' : '\uD83D\uDCF7 Add photo'}
              {/* v1.103.3 — no capture attr: it forced the camera. Without it, iOS offers
                  Photo Library / Take Photo / Choose File. */}
              <input type="file" accept="image/*" style={{ display: 'none' }}
                onClick={(e) => { if (notePhoto) { e.preventDefault(); setNotePhoto(null); } }}
                onChange={(e) => {
                  const file = e.target.files && e.target.files[0];
                  e.target.value = '';
                  if (!file || !file.type.startsWith('image/')) return;
                  const img = new Image();
                  const url = URL.createObjectURL(file);
                  img.onload = () => {
                    URL.revokeObjectURL(url);
                    const MAX = 1600;
                    let { width, height } = img;
                    if (width > MAX || height > MAX) { const sc = MAX / Math.max(width, height); width = Math.round(width * sc); height = Math.round(height * sc); }
                    const canvas = document.createElement('canvas');
                    canvas.width = width; canvas.height = height;
                    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                    setNotePhoto({ data: canvas.toDataURL('image/jpeg', 0.85), name: (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg' });
                  };
                  img.onerror = () => URL.revokeObjectURL(url);
                  img.src = url;
                }} />
            </label>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            Visible to {selected.firstName}'s care team {'\u00B7'} everyone on it gets notified
          </div>
        </div>
      )}

      {selected && selected.canReadNotes === false && !selected.canReadVisits ? null : timeline === null ? (
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
                {linkify(item.body)}
              </div>
              {/* AttachmentThumb, not a bare <img src>: a plain src is an UNAUTHENTICATED
                  request, and in the native app that renders "Authentication required"
                  where the picture should be (AttachmentViewer.js). */}
              {item.photos.length > 0 && typeof AttachmentThumb !== 'undefined' && (
                <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {item.photos.map((att, i) => (
                    <AttachmentThumb key={att.path} size={64} attachment={att}
                      onOpen={() => setViewingAttachments({ list: item.photos, index: i })} />
                  ))}
                </div>
              )}
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

      {viewingAttachments && typeof AttachmentViewer !== 'undefined' && (
        <AttachmentViewer attachments={viewingAttachments.list} startIndex={viewingAttachments.index}
          onClose={() => setViewingAttachments(null)} />
      )}
    </div>
  );
};


// ─── v1.107.2 — the way in from Home ───
//
// Julia looks for "add a note" and "log a visit" where she starts her day, not behind a tab
// she has to know exists. One card per person whose care team lets her write; each button does
// only what her checkboxes allow. Renders nothing for a caregiver who is on nobody's team.
const CareTeamQuickActions = window.CareTeamQuickActions = ({ onNavigate }) => {
  const [list, setList] = React.useState([]);
  const [logFor, setLogFor] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/notes/mine/recipients');
        if (!res?.ok) return;
        const d = await res.json();
        if (!cancelled) setList((d.recipients || []).filter((r) => r.canWriteNotes || r.canWriteVisits));
      } catch { /* optional card — absent is fine */ }
    })();
    return () => { cancelled = true; };
  }, []);
  if (!list.length) return null;
  const go = (r) => {
    window.__pendingNoteRecipientId = r.id;
    if (typeof onNavigate === 'function') onNavigate('care-notes');
    else if (window.__navigateTo) window.__navigateTo('care-notes');
  };
  const btn = {
    minHeight: 44, padding: '10px 14px', borderRadius: 10, cursor: 'pointer', flex: '1 1 140px',
    border: '1px solid var(--role-color)', background: 'var(--bg-card)', color: 'var(--role-color)',
    font: 'inherit', fontSize: 14, fontWeight: 700,
  };
  return (
    <>
      {list.map((r) => (
        <div key={r.id} className="card" style={{ marginBottom: 12 }} data-testid="care-team-quick-actions">
          <div className="card-header" style={{ marginBottom: 8 }}>
            <span className="card-icon">🤝</span>{r.firstName}'s care team
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {r.canWriteNotes && <button style={btn} onClick={() => go(r)}>📝 Add a note</button>}
            {r.canWriteVisits && typeof LogVisitSheet !== 'undefined' && (
              <button style={btn} onClick={() => setLogFor(r)}>👣 Log a visit</button>
            )}
            {(r.canReadNotes || r.canReadVisits) && (
              <button style={{ ...btn, border: '1px solid var(--border-light)', color: 'var(--text-secondary)' }}
                onClick={() => go(r)}>Care notes</button>
            )}
          </div>
        </div>
      ))}
      {logFor && typeof LogVisitSheet !== 'undefined' && (
        <LogVisitSheet recipients={[logFor]} presetRecipientId={logFor.id}
          onClose={() => setLogFor(null)}
          onSaved={() => setLogFor(null)} />
      )}
    </>
  );
};
