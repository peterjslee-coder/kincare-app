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

// ─── Imminent hero row — an appointment inside 24 hours ───
//
// Pete, 13 Sep: "the appointment with Dr. Lambert that's inside of 24 hours should also be
// above [the recipient] card like the appointment with Tina is... it needs the orange shimmer
// effect above her name so that it stands out that it's tomorrow, not just an upcoming task."
//
// A session inside 24 hours has been promoted out of Next Up into a hero card since v1.100 —
// bigger, bordered, counted down, with the orange shimmer. A care event never was: it rendered
// as a dashed-outline row in the list whatever its time, so a doctor's appointment tomorrow
// looked exactly like one a fortnight out. The two things a family is looking at are "who is
// coming" and "where do we have to be", and only one of them was being surfaced.
//
// Same shimmer class as the session hero on purpose. It means one thing on this screen —
// this is inside a day — and it should not learn a second meaning.
const CareEventHeroRow = window.CareEventHeroRow = ({ ev, onOpenSheet, msUntil }) => {
  const tz = ev.timezone || TimezoneHelper.DEFAULT_TZ;
  const withinAnHour = msUntil <= 3600000;
  const started = msUntil <= 0;

  // Deliberately not a live-ticking countdown. The session hero counts down because someone is
  // arriving at your door; an appointment is somewhere you have to BE, so the useful framing is
  // the DAY, which is what Pete asked for: "so that it stands out that it's tomorrow".
  //
  // "In 20h 0m" is technically the same fact and lands as noise — you have to do arithmetic to
  // learn the one thing you wanted. The hour only becomes the useful unit once it is today, and
  // the minute only inside the hour.
  // getDaysUntil already answers this in the care timezone — 0 today, 1 tomorrow — and is what
  // getDateLabel uses, so the hero and the line beneath it can never disagree about the day.
  const days = TimezoneHelper.getDaysUntil(ev.event_date, tz);
  let lead;
  if (started) lead = 'Happening now';
  else if (withinAnHour) lead = `In ${Math.max(1, Math.round(msUntil / 60000))} min`;
  else if (days <= 0) {
    const hrs = Math.floor(msUntil / 3600000);
    lead = hrs >= 1 ? `Today · in ${hrs}h` : 'Today';
  } else if (days === 1) lead = 'Tomorrow';
  else lead = `In ${Math.floor(msUntil / 3600000)}h`;

  const borderColor = withinAnHour ? 'var(--accent-color)' : 'var(--role-color)';
  const bg = withinAnHour
    ? 'linear-gradient(135deg, var(--bg-accent-light) 0%, var(--bg-card) 100%)'
    : 'linear-gradient(135deg, var(--bg-highlight) 0%, var(--bg-card) 100%)';

  return (
    <div className="next-up-hero-shimmer" onClick={onOpenSheet} style={{
      marginBottom: 16, padding: '18px 20px', cursor: 'pointer', borderRadius: 14,
      border: `3px solid ${borderColor}`,
      background: bg,
      boxShadow: withinAnHour ? '0 4px 16px rgba(232, 114, 74, 0.18)' : '0 4px 16px rgba(27, 107, 90, 0.10)',
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 42, height: 42, minWidth: 42, borderRadius: 12, display: 'flex',
          alignItems: 'center', justifyContent: 'center', fontSize: 21, background: 'var(--bg-card)',
        }}>{careEventIcon(ev.category)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase',
            color: borderColor, marginBottom: 3,
          }}>{lead}</div>
          {/* Wraps to two lines rather than truncating. On a 375px phone the list row's
              single-line ellipsis turns "Appointment with Dr. Lambert" into "Appointment with
              Dr. Lamb…", which loses the one word that says whose appointment it is — and this
              card exists precisely so that reads at a glance. */}
          <div style={{
            fontWeight: 700, fontSize: 17, color: 'var(--text-primary)', lineHeight: 1.25,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden', overflowWrap: 'anywhere',
          }}>{ev.title}</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 3 }}>
            {careEventWhen(ev, tz)} · for {ev.recipientFirstName}{ev.location ? ` · ${ev.location}` : ''}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Detail sheet: what/when/where + Add to my calendar + edit/delete ───
const CareEventSheet = window.CareEventSheet = ({ ev, canManage, onClose, onEdit, onChanged }) => {
  const { showToast } = useToast();
  const [deleting, setDeleting] = useState(false);

  // ─── v1.106.30 — what actually happened at the appointment ───
  //
  // Pete: "I'm going to Betty's doctors appointment today and I would like to be able to
  // leave notes like the doctor said mom should do this or that and this is the new
  // medication. Otherwise, the only thing that [iPAi] knows is that an appointment happened."
  //
  // These are ordinary care notes carrying this event's id, not a field on the appointment.
  // One care record: the team gets pushed, iPAi files it, and it shows up everywhere notes
  // already show up — with the appointment attached rather than floating loose.
  const [notes, setNotes] = useState(null);
  // v1.106.38 — the lightbox for an appointment-note photo, same one as CareProfile.
  const [viewingAttachments, setViewingAttachments] = useState(null);
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const addingRef = React.useRef(false);

  // ─── v1.106.32 — record the appointment, keep the words, bin the audio ───
  //
  // Pete asked twice. He chose record → transcribe → delete the audio, and the server does
  // better than delete: it never writes it. Here the recording lives in memory as Blobs that
  // are uploaded and dropped; nothing touches storage on this side either.
  //
  // The consent step is not a formality and not a checkbox buried in settings. Virginia is
  // one-party, but families travel and a practice can refuse recording whatever the state
  // says — so it asks every time, and the server records that it asked.
  //
  // v1.127.0 — Pete, 10/30, at Betty's orthopaedic visit: "I can't tell if it's still recording
  // when the screen lock times in", "Need a pause button", "transcribing does not work". The
  // iOS app has no background audio, so a locked phone suspends the app and the microphone
  // goes silent, and the timer (a setInterval) froze with it. Now:
  //   · the screen is kept awake while recording (Screen Wake Lock), and it says so;
  //   · Pause / Resume (MediaRecorder.pause keeps it one file);
  //   · the clock is wall time minus paused time, so it is right after any interruption;
  //   · data is collected every few seconds, so whatever was heard before a lock is kept;
  //   · if the phone locks anyway, coming back says exactly that, and offers to file what was
  //     recorded or keep going as a second part (each part transcribed, one note);
  //   · a lower bitrate, so an hour fits under the 25 MB cap.
  const [recState, setRecState] = useState('idle'); // idle | consent | recording | paused | interrupted | working
  const [recSeconds, setRecSeconds] = useState(0);
  const [keptAwake, setKeptAwake] = useState(null); // true | false | null (not yet known)
  const [partsCount, setPartsCount] = useState(0);
  const recorderRef = React.useRef(null);
  const chunksRef = React.useRef([]);
  const partsRef = React.useRef([]); // finished parts: { blob, mimeType, seconds }
  const streamRef = React.useRef(null);
  const tickRef = React.useRef(null);
  const wakeRef = React.useRef(null);
  const clockRef = React.useRef({ startedAt: 0, pausedAt: 0, pausedMs: 0 });
  const stopIntentRef = React.useRef(null); // 'file' | 'part' | null — why the recorder stopped
  const recStateRef = React.useRef('idle');
  React.useEffect(() => { recStateRef.current = recState; }, [recState]);

  const elapsed = () => {
    const c = clockRef.current;
    if (!c.startedAt) return 0;
    const now = c.pausedAt || Date.now();
    return Math.max(0, Math.floor((now - c.startedAt - c.pausedMs) / 1000));
  };
  const totalSeconds = () => partsRef.current.reduce((a, p) => a + p.seconds, 0) + elapsed();

  const keepAwake = async () => {
    try {
      if (!navigator.wakeLock || wakeRef.current) { if (!navigator.wakeLock) setKeptAwake(false); return; }
      wakeRef.current = await navigator.wakeLock.request('screen');
      setKeptAwake(true);
      wakeRef.current.addEventListener('release', () => { wakeRef.current = null; });
    } catch { setKeptAwake(false); }
  };
  const letSleep = () => {
    try { if (wakeRef.current) wakeRef.current.release(); } catch { /* already released */ }
    wakeRef.current = null;
  };

  const releaseMic = React.useCallback(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    // v1.105.140's lesson: stop the tracks WE acquired, or the mic indicator stays lit and
    // the OS keeps the device open.
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) { try { t.stop(); } catch { /* already gone */ } }
      streamRef.current = null;
    }
    recorderRef.current = null;
    try { if (wakeRef.current) wakeRef.current.release(); } catch { /* ignore */ }
    wakeRef.current = null;
  }, []);

  React.useEffect(() => releaseMic, [releaseMic]);

  // Coming back from a locked screen: the wake lock is gone (re-take it), and the microphone
  // may have been cut. If it was, say so plainly instead of showing a frozen "Recording".
  React.useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const st = recStateRef.current;
      if (st !== 'recording' && st !== 'paused') return;
      const track = streamRef.current && streamRef.current.getAudioTracks()[0];
      const rec = recorderRef.current;
      const cut = !track || track.readyState === 'ended' || track.muted || !rec || rec.state === 'inactive';
      if (cut) { endPart('interrupted'); return; }
      keepAwake();
      setRecSeconds(totalSeconds());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const finishPart = (mimeType) => {
    const blob = new Blob(chunksRef.current, { type: mimeType });
    chunksRef.current = [];
    if (blob.size) partsRef.current.push({ blob, mimeType, seconds: elapsed() });
    clockRef.current = { startedAt: 0, pausedAt: 0, pausedMs: 0 };
    setPartsCount(partsRef.current.length);
  };

  // Stop the current recorder. why: 'file' (upload everything) | 'interrupted' (keep, ask).
  const endPart = (why) => {
    stopIntentRef.current = why;
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      if (why === 'file') setRecState('working');
      try { rec.stop(); return; } catch { /* fall through */ }
    }
    // Recorder already dead (the lock killed it): keep whatever chunks arrived.
    finishPart((rec && rec.mimeType) || 'audio/mp4');
    releaseMic();
    afterStop(why);
  };

  const afterStop = (why) => {
    stopIntentRef.current = null;
    if (why === 'file') { void uploadRecording(); return; }
    setRecSeconds(totalSeconds());
    setRecState(partsRef.current.length ? 'interrupted' : 'idle');
    if (!partsRef.current.length) showToast('The recording stopped before anything was captured.', 'error');
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
      showToast('This device can’t record in the app.', 'error');
      setRecState('idle');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      // Let the platform pick the format: Safari gives mp4, Chrome webm. ElevenLabs takes both.
      // 48 kbps is plenty for speech and puts an hour under the 25 MB cap.
      let rec;
      try { rec = new MediaRecorder(stream, { audioBitsPerSecond: 48000 }); } catch { rec = new MediaRecorder(stream); }
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const why = stopIntentRef.current || 'interrupted'; // a stop nobody asked for = the OS cut it
        finishPart(rec.mimeType || 'audio/webm');
        releaseMic();
        afterStop(why);
      };
      const track = stream.getAudioTracks()[0];
      if (track) track.addEventListener('ended', () => { if (recStateRef.current === 'recording' || recStateRef.current === 'paused') endPart('interrupted'); });
      recorderRef.current = rec;
      // Collect every 5s: if the phone locks, what was said before it is already in hand.
      rec.start(5000);
      clockRef.current = { startedAt: Date.now(), pausedAt: 0, pausedMs: 0 };
      setRecSeconds(totalSeconds());
      tickRef.current = setInterval(() => setRecSeconds(totalSeconds()), 1000);
      setRecState('recording');
      keepAwake();
    } catch (err) {
      releaseMic();
      setRecState(partsRef.current.length ? 'interrupted' : 'idle');
      showToast(
        err && err.name === 'NotAllowedError'
          ? 'Microphone access was declined — you can still type notes below.'
          : 'Couldn’t start recording.',
        'error'
      );
    }
  };

  const pauseRecording = () => {
    const rec = recorderRef.current;
    if (!rec || rec.state !== 'recording' || typeof rec.pause !== 'function') return;
    try { rec.pause(); } catch { return; }
    clockRef.current.pausedAt = Date.now();
    setRecSeconds(totalSeconds());
    letSleep(); // paused: the phone may lock, and resuming re-checks the microphone
    setRecState('paused');
  };

  const resumeRecording = () => {
    const rec = recorderRef.current;
    const track = streamRef.current && streamRef.current.getAudioTracks()[0];
    if (!rec || rec.state === 'inactive' || !track || track.readyState === 'ended') { endPart('interrupted'); return; }
    try { rec.resume(); } catch { endPart('interrupted'); return; }
    const c = clockRef.current;
    if (c.pausedAt) { c.pausedMs += Date.now() - c.pausedAt; c.pausedAt = 0; }
    keepAwake();
    setRecState('recording');
  };

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') { endPart('file'); return; }
    if (partsRef.current.length) { setRecState('working'); void uploadRecording(); return; }
    releaseMic();
    setRecState('idle');
  };

  const discardRecording = () => {
    if (!confirm('Throw away this recording? Nothing will be filed.')) return;
    stopIntentRef.current = 'discard';
    const rec = recorderRef.current;
    if (rec) rec.onstop = null;
    try { if (rec && rec.state !== 'inactive') rec.stop(); } catch { /* ignore */ }
    releaseMic();
    partsRef.current = []; chunksRef.current = [];
    setPartsCount(0); setRecSeconds(0);
    setRecState('idle');
  };

  const uploadRecording = async () => {
    const parts = partsRef.current.slice();
    partsRef.current = [];
    setPartsCount(0);
    releaseMic();
    if (!parts.length) { setRecState('idle'); showToast('That recording was empty.', 'error'); return; }

    const form = new FormData();
    parts.forEach((pt, i) => {
      const ext = pt.mimeType.includes('mp4') ? 'mp4' : pt.mimeType.includes('ogg') ? 'ogg' : 'webm';
      form.append('audio', pt.blob, `appointment-${i + 1}.${ext}`);
    });
    form.append('consent_confirmed', 'true');
    try {
      // apiFetch already leaves FormData alone so the browser sets its own boundary.
      // Transcription runs on top of the upload — ElevenLabs gets up to 5 minutes server-side —
      // so this needs far longer than the default, or a long visit times out here while
      // succeeding on the server, filing the note and telling the user it failed.
      const res = await apiFetch(`/api/care-events/${ev.id}/transcribe`, {
        method: 'POST', body: form, timeoutMs: 420000,
      });
      if (res?.ok) {
        const d = await res.json();
        showToast(d.extracted ? 'Transcribed and filed in the care record' : 'Transcript filed — couldn’t pull out the key points', 'success');
        await loadNotes();
      } else {
        const d = await res?.json().catch(() => ({}));
        showToast(d.error || 'Could not transcribe that recording.', 'error');
      }
    } catch { showToast('Could not transcribe that recording. Check your connection and try again.', 'error'); }
    setRecSeconds(0);
    setRecState('idle');
  };


  const loadNotes = React.useCallback(async () => {
    try {
      const res = await apiFetch(`/api/care-events/${ev.id}/notes`);
      if (!res?.ok) { setNotes([]); return; }
      const d = await res.json();
      setNotes(d.notes || []);
    } catch { setNotes([]); }
  }, [ev.id]);

  React.useEffect(() => { loadNotes(); }, [loadNotes]);

  const addNote = async () => {
    if (addingRef.current || !newNote.trim()) return;
    addingRef.current = true;
    setAddingNote(true);
    try {
      const res = await apiFetch('/api/notes', {
        method: 'POST',
        body: JSON.stringify({
          careRecipientId: ev.care_recipient_id,
          careEventId: ev.id,
          content: newNote.trim(),
          noteType: 'observation',
        }),
      });
      if (res?.ok) {
        setNewNote('');
        showToast('Added to the care record', 'success');
        await loadNotes();
      } else {
        const d = await res?.json().catch(() => ({}));
        showToast(d.error || 'Could not add that note', 'error');
      }
    } catch { showToast('Could not add that note', 'error'); }
    setAddingNote(false);
    addingRef.current = false;
  };

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
        {/* v1.106.30 — the address opens the map. openExternalUrl, not <a target="_blank">:
            WKWebView drops window.open after an await and Capacitor installs no download
            delegate, which is why that helper exists (v1.105.49). */}
        {ev.location && (
          <button onClick={(e) => { e.stopPropagation(); const u = mapsUrlFor(ev.location); if (u) openExternalUrl(u); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, minHeight: 44,
              background: 'none', border: 'none', padding: 0, font: 'inherit', textAlign: 'left',
              fontSize: 13, color: 'var(--role-color)', fontWeight: 600, cursor: 'pointer',
            }}>
            <span aria-hidden="true">📍</span>
            <span style={{ textDecoration: 'underline' }}>{ev.location}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>Directions</span>
          </button>
        )}
        {ev.details && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6, whiteSpace: 'pre-wrap' }}>{ev.details}</div>}
        {(ev.attendees || []).length > 0 && (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>
            {'\uD83D\uDC65'} Going: {ev.attendees.map((a) => a.first_name).join(', ')}
          </div>
        )}
        {ev.created_by_first_name && (
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 8 }}>
            Added by {ev.created_by_first_name}{ev.source === 'email' ? ' via email' : ''}
          </div>
        )}

        {/* ─── v1.106.30 — notes from the appointment ─── */}
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border-light)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
            What happened
          </div>
          {notes === null ? (
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Loading{'\u2026'}</div>
          ) : notes.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 10 }}>
              Nothing recorded yet {'\u2014'} what the doctor said, a new medication, what to watch for.
            </div>
          ) : (
            <div style={{ marginBottom: 10 }}>
              {notes.map((n) => (
                <div key={n.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border-light)' }}>
                  <div style={{ fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {linkify(n.content)}
                  </div>
                  {/* v1.106.38 — a note filed against an appointment is the same row in the
                      same table as any other note, photo included. This list read has_photo
                      off the wire and dropped it, so the picture of the discharge sheet went
                      nowhere. AttachmentThumb, never a bare <img src> — a plain src is an
                      unauthenticated request and renders "Authentication required" in the
                      native app. */}
                  {!!n.has_photo && typeof AttachmentThumb !== 'undefined' && (
                    <div style={{ marginTop: 6 }}>
                      <AttachmentThumb size={64}
                        attachment={{ path: `/api/notes/${n.id}/photo`, name: 'Appointment photo', mime: '' }}
                        onOpen={() => setViewingAttachments({
                          list: [{ path: `/api/notes/${n.id}/photo`, name: 'Appointment photo', mime: '' }], index: 0,
                        })} />
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                    {n.author_first_name || 'Someone'}
                    {n.needs_attention ? ' \u00B7 needs attention' : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* ─── v1.106.32 — record it instead of typing it ───
              Consent is asked every time, in front of the button, not buried in settings.
              The audio is uploaded and never stored — not by us, not on the phone. */}
          {recState === 'idle' && (
            <button onClick={() => setRecState('consent')} style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: 44,
              padding: '10px 14px', marginBottom: 10, borderRadius: 10,
              border: '1px solid var(--border-color)', background: 'var(--bg-surface)',
              color: 'var(--text-primary)', font: 'inherit', fontWeight: 600, fontSize: 14, cursor: 'pointer',
            }}>
              <span aria-hidden="true">🎙</span> Record the appointment
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>writes the notes for you</span>
            </button>
          )}

          {recState === 'consent' && (
            <div style={{
              marginBottom: 10, padding: 14, borderRadius: 10,
              border: '1px solid var(--color-warning)', background: 'var(--color-warning-bg, #fff8e1)',
            }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                Before you record
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Tell everyone in the room you{'\u2019'}re recording, and check the practice allows it {'\u2014'}
                many don{'\u2019'}t. Recording laws also differ by state.
                <br /><br />
                Keep InPlace open on this screen while it records {'\u2014'} a locked phone stops the
                microphone. You can pause any time.
                <br /><br />
                InPlace transcribes the recording and files the notes. <strong>The audio itself is
                never saved</strong> {'\u2014' } not here and not on your phone.
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button onClick={startRecording} style={{
                  minHeight: 44, padding: '0 16px', borderRadius: 10, border: 'none',
                  background: 'var(--role-color)', color: 'var(--text-on-primary)',
                  font: 'inherit', fontWeight: 700, fontSize: 14, cursor: 'pointer',
                }}>Everyone agreed {'\u2014'} start</button>
                <button onClick={() => setRecState('idle')} style={{
                  minHeight: 44, padding: '0 16px', borderRadius: 10,
                  border: '1px solid var(--border-color)', background: 'var(--bg-card)',
                  color: 'var(--text-secondary)', font: 'inherit', fontWeight: 600, fontSize: 14, cursor: 'pointer',
                }}>Cancel</button>
              </div>
            </div>
          )}

          {(recState === 'recording' || recState === 'paused') && (() => {
            const clock = `${String(Math.floor(recSeconds / 60)).padStart(2, '0')}:${String(recSeconds % 60).padStart(2, '0')}`;
            const paused = recState === 'paused';
            const recBtn = (bg, fg, border) => ({
              minHeight: 44, padding: '0 14px', borderRadius: 10, border: border || 'none',
              background: bg, color: fg, font: 'inherit', fontWeight: 700, fontSize: 14, cursor: 'pointer',
            });
            return (
              <div role="status" aria-live="polite" style={{
                marginBottom: 10, padding: '10px 14px', borderRadius: 10,
                border: `1px solid ${paused ? 'var(--border-color)' : 'var(--color-error)'}`, background: 'var(--bg-surface)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                    background: paused ? 'var(--text-muted)' : 'var(--color-error)',
                    animation: paused ? 'none' : 'pulse 1s infinite',
                  }} />
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {paused ? 'Paused' : 'Recording'} {clock}{partsCount ? ` · part ${partsCount + 1}` : ''}
                  </span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.45 }}>
                  {paused
                    ? 'Nothing is being recorded. Resume when you’re ready.'
                    : keptAwake === false
                      ? <b style={{ color: 'var(--color-error)' }}>Keep this screen open. If the phone locks, recording stops (what was said before it is kept).</b>
                      : 'The screen will stay on while recording. Don’t lock the phone or switch apps.'}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  {paused
                    ? <button onClick={resumeRecording} style={recBtn('var(--role-color)', 'var(--text-on-primary)')}>{'▶'} Resume</button>
                    : <button onClick={pauseRecording} style={recBtn('var(--bg-card)', 'var(--text-primary)', '1px solid var(--border-color)')}>{'❚❚'} Pause</button>}
                  <button onClick={stopRecording} style={{ ...recBtn('var(--color-error)', 'var(--text-on-primary)'), marginLeft: 'auto' }}>Stop &amp; file it</button>
                </div>
              </div>
            );
          })()}

          {recState === 'interrupted' && (
            <div role="alert" style={{
              marginBottom: 10, padding: 14, borderRadius: 10,
              border: '1px solid var(--color-warning)', background: 'var(--color-warning-bg, #fff8e1)',
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                Recording stopped
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                The phone locked or switched apps, which stops the microphone. What was recorded before
                that is kept ({partsCount} {partsCount === 1 ? 'part' : 'parts'}). Keep going and it{'’'}s
                added as another part {'—'} it all becomes one note.
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                {partsCount < 4 && (
                  <button onClick={startRecording} style={{
                    minHeight: 44, padding: '0 14px', borderRadius: 10, border: 'none',
                    background: 'var(--color-error)', color: 'var(--text-on-primary)',
                    font: 'inherit', fontWeight: 700, fontSize: 14, cursor: 'pointer',
                  }}>{'●'} Keep recording</button>
                )}
                <button onClick={stopRecording} style={{
                  minHeight: 44, padding: '0 14px', borderRadius: 10, border: 'none',
                  background: 'var(--role-color)', color: 'var(--text-on-primary)',
                  font: 'inherit', fontWeight: 700, fontSize: 14, cursor: 'pointer',
                }}>File what was recorded</button>
                <button onClick={discardRecording} style={{
                  minHeight: 44, padding: '0 14px', borderRadius: 10,
                  border: '1px solid var(--border-color)', background: 'var(--bg-card)',
                  color: 'var(--text-secondary)', font: 'inherit', fontWeight: 600, fontSize: 14, cursor: 'pointer',
                }}>Throw away</button>
              </div>
            </div>
          )}

          {recState === 'working' && (
            <div style={{
              marginBottom: 10, padding: '10px 14px', borderRadius: 10,
              border: '1px solid var(--border-color)', background: 'var(--bg-surface)',
              fontSize: 13.5, color: 'var(--text-secondary)',
            }}>
              Transcribing and pulling out the key points{'\u2026'} this can take a minute for a long visit.
            </div>
          )}

          <textarea value={newNote} onChange={(e) => setNewNote(e.target.value)}
            placeholder={`e.g. "Dr. Lambert started a new blood-pressure tablet, mornings. Back in six weeks."`}
            rows={3}
            style={{
              width: '100%', padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: 8,
              fontSize: 14, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box',
              background: 'var(--bg-surface)', color: 'var(--text-primary)',
            }} />
          <button onClick={addNote} disabled={addingNote || !newNote.trim()}
            style={{
              marginTop: 8, minHeight: 44, padding: '0 18px', borderRadius: 10, border: 'none',
              background: (addingNote || !newNote.trim()) ? 'var(--border-light)' : 'var(--role-color)',
              color: 'var(--text-on-primary)', font: 'inherit', fontWeight: 700, fontSize: 14,
              cursor: (addingNote || !newNote.trim()) ? 'not-allowed' : 'pointer',
            }}>
            {addingNote ? '\u2026' : 'Add to the care record'}
          </button>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
            Goes in {ev.recipientFirstName || 'their'} care notes, and the team is told.
          </div>
        </div>

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

      {/* Outside the scrolling sheet, but still inside the overlay whose onClick is
          onClose — so every click in the viewer has to be stopped here or dismissing the
          photo would dismiss the whole appointment behind it. */}
      {viewingAttachments && typeof AttachmentViewer !== 'undefined' && (
        <div onClick={(e) => e.stopPropagation()}>
          <AttachmentViewer attachments={viewingAttachments.list} startIndex={viewingAttachments.index}
            onClose={() => setViewingAttachments(null)} />
        </div>
      )}
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
  // v1.106.30 — who else is going. Pete: "today I am going to the Dr. Lambert appointment,
  // but Tina is also going. So I would like to be able to tag her so that she gets updates
  // about that appointment as well."
  const [taggable, setTaggable] = useState([]);
  const [tagged, setTagged] = useState(() => new Set((ex.attendees || []).map((a) => a.user_id)));

  React.useEffect(() => {
    if (!recipientId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/care-events/taggable/${recipientId}`);
        if (cancelled || !res?.ok) return;
        const d = await res.json();
        // v1.106.31 — you first, then the caregivers. Pete had to hunt past a list that
        // did not contain either of the two people actually in the room.
        const rank = (pp) => (pp.isYou ? 0 : pp.isCaregiver ? 1 : 2);
        setTaggable([...(d.people || [])].sort((a, b) => rank(a) - rank(b)));
      } catch { /* the picker just stays empty; the rest of the form still works */ }
    })();
    return () => { cancelled = true; };
  }, [recipientId]);

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
      attendee_user_ids: [...tagged],
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
        {/* ─── v1.106.31 — a real address, not free text ───
            Pete: "The address should not be Freeform. I would like to see something that has
            they type in an address they can select it."
            AddressAutocomplete (v1.75.0) already existed and was already used for care
            addresses; this field never got it. It matters more now that the address is a
            tappable map link — "Dr. Lambert" typed into Maps finds nothing, and the caregiver
            is the one standing in a car park discovering that. Typing freely still works, so
            "the clinic on Main" is not rejected; the suggestions are a nudge, not a wall. */}
        {typeof AddressAutocomplete !== 'undefined' ? (
          <AddressAutocomplete
            value={location}
            onChange={setLocation}
            onSelect={(sel) => setLocation(sel.label || [sel.line1, sel.city, sel.state].filter(Boolean).join(', '))}
            placeholder="Search a place or address (church, clinic, store…)"
            style={input} />
        ) : (
          <input style={input} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Carilion Clinic, Radford" />
        )}
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          Pick a suggestion so the map link lands in the right place. Whoever opens this can tap it for directions.
        </div>

        {/* ─── v1.106.30 — who else is going ───
            Only people already on this person's care team appear here, and the server
            enforces the same list. A tag decides who gets TOLD about an appointment, never
            who is allowed to know about it. */}
        {taggable.length > 0 && (
          <React.Fragment>
            <div style={label}>Who's going <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span></div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {taggable.map((pp) => {
                const on = tagged.has(pp.user_id);
                return (
                  <button key={pp.user_id} style={chip(on)}
                    onClick={() => setTagged((prev) => {
                      const next = new Set(prev);
                      if (next.has(pp.user_id)) next.delete(pp.user_id); else next.add(pp.user_id);
                      return next;
                    })}>
                    {on ? '\u2713 ' : ''}{pp.isYou ? 'You' : pp.first_name}{pp.isCaregiver ? ' \u00B7 caregiver' : ''}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
              They{'\u2019'}ll be told they{'\u2019'}re on it, and get the reminders too.
            </div>
          </React.Fragment>
        )}

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
