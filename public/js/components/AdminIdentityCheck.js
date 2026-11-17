// ─── v1.128.3 — One Identity card per person (Document Review) ───
//
// Pete, 11/16: "It should be one card with the selfie, the front and back of the ID and an AI
// analysis of whether or not these are the same people and whether or not they are valid
// documents." Approved mockup: claude.ai/artifact/HBTeqijzdYdgP1oY27DFxd.
//
// The server groups the photos (src/utils/identityReview.js) and refuses a decision if the set
// changed since this card loaded, so what you approve is exactly what you looked at.

const ID_SLOT_LABELS = { selfie: 'Selfie', front: 'ID — front', back: 'ID — back', other: 'Other photo' };

const IdPhoto = ({ doc, label, height }) => {
  const [src, setSrc] = React.useState(null);
  const [error, setError] = React.useState(false);
  const [big, setBig] = React.useState(false);
  React.useEffect(() => {
    if (!doc) return undefined;
    let cancelled = false;
    let url = null;
    (async () => {
      try {
        const res = await apiFetch(`/api/documents/${doc.id}/download`);
        if (!res.ok) { if (!cancelled) setError(true); return; }
        const blob = await res.blob();
        url = URL.createObjectURL(blob);
        if (!cancelled) setSrc(url);
      } catch (e) {
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [doc && doc.id]);

  const box = { height: height || 200, borderRadius: 10, background: 'var(--bg-secondary)', border: '1px dashed var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: 13, overflow: 'hidden' };
  let inner;
  if (!doc) inner = <div style={box}>Not sent</div>;
  else if (error) inner = <div style={box}>Couldn't open this photo</div>;
  else if (!src) inner = <div style={box}>Loading…</div>;
  else inner = (
    <button type="button" onClick={() => setBig(true)} aria-label={`Enlarge ${label}`}
      style={{ ...box, border: '1px solid var(--border-color)', padding: 0, cursor: 'zoom-in', width: '100%' }}>
      <img src={src} alt={label} style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} />
    </button>
  );
  return (
    <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      {inner}
      <figcaption style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
        {label}{doc && src ? <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}> · tap to enlarge</span> : null}
      </figcaption>
      {big && (
        <div onClick={() => setBig(false)} role="presentation"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, cursor: 'zoom-out' }}>
          <img src={src} alt={label} style={{ maxWidth: '92vw', maxHeight: '92vh', borderRadius: 8 }} />
        </div>
      )}
    </figure>
  );
};

const ID_CHECK_MARK = {
  pass: { color: 'var(--color-success)', path: 'M5 12l5 5 9-10', label: 'Pass' },
  fail: { color: 'var(--color-error)', path: 'M6 6l12 12M18 6L6 18', label: 'Does not match' },
  unknown: { color: 'var(--color-warning)', path: 'M12 7v6M12 17h.01', label: 'Not confirmed' },
};

function idSuggestionPill(analysis) {
  const s = analysis && analysis.suggestion;
  if (!s) return { text: 'AI analysis pending', bg: 'var(--badge-muted-bg)', fg: 'var(--text-secondary)' };
  const pct = typeof s.confidence === 'number' && s.confidence > 0 ? ` · ${Math.round(s.confidence * 100)}%` : '';
  if (s.verdict === 'recommend_approve') return { text: `AI suggests: approve${pct}`, bg: '#e3f0ec', fg: '#1b6b5a' };
  if (s.verdict === 'recommend_reject') return { text: `AI suggests: look closely${pct}`, bg: '#fdecea', fg: '#c62828' };
  return { text: 'AI: no opinion', bg: 'var(--badge-muted-bg)', fg: 'var(--text-secondary)' };
}

const AdminIdentityCheck = ({ check, onDecided }) => {
  const { showToast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [analysis, setAnalysis] = React.useState(check.analysisCurrent ? check.analysis : null);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(null);
  const triedRef = React.useRef(false);

  const runAnalysis = React.useCallback(async () => {
    setAnalyzing(true);
    try {
      const res = await apiFetch('/api/documents/admin/identity/analyze', { method: 'POST', body: JSON.stringify({ key: check.key }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.analysis) setAnalysis(data.analysis);
      else showToast(data.error || 'AI analysis failed', 'error');
    } catch (e) {
      showToast('AI analysis failed', 'error');
    } finally {
      setAnalyzing(false);
    }
  }, [check.key]);

  // Opening a card whose analysis is missing or older than its photos runs it once.
  React.useEffect(() => {
    if (open && !analysis && !analyzing && !triedRef.current && !check.isDemo) {
      triedRef.current = true;
      runAnalysis();
    }
  }, [open]);

  const decide = async (action) => {
    if (action === 'request_new' && !note.trim()) {
      showToast('Say what to retake in the note (e.g. "back of the license is blurry")', 'info');
      return;
    }
    setBusy(action);
    try {
      const res = await apiFetch('/api/documents/admin/identity/review', {
        method: 'POST',
        body: JSON.stringify({ key: check.key, docIds: check.docIds, action, notes: note.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast(action === 'approve' ? `${check.personName || 'Identity'} approved` : action === 'reject' ? 'Rejected' : 'Asked for a new photo', 'success');
        if (onDecided) onDecided(check.key);
      } else {
        showToast(data.error || 'Could not record the decision', 'error');
        if (res.status === 409 && onDecided) onDecided(null);
      }
    } catch (e) {
      showToast('Could not record the decision', 'error');
    } finally {
      setBusy(null);
    }
  };

  const name = check.personName || 'Someone without a name on file';
  const initials = (check.personName || '?').split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  const pieces = [check.selfie && 'selfie', check.front && 'ID front', check.back && 'back'].filter(Boolean).join(' + ') || 'photos';
  const pill = idSuggestionPill(analysis || (check.analysis && check.analysisCurrent ? check.analysis : null));
  const extras = check.docs.filter((d) => ![check.selfie, check.front, check.back].some((x) => x && x.id === d.id));
  const when = check.submittedAt ? new Date(check.submittedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

  return (
    <div style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border-color)', overflow: 'hidden' }}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer', color: 'var(--text-primary)', font: 'inherit', flexWrap: 'wrap' }}>
        <span style={{ width: 40, height: 40, borderRadius: 20, background: 'var(--bg-teal-light)', color: 'var(--role-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0 }}>{initials}</span>
        <span style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>Identity check — {name}</span>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{[check.role, pieces, when].filter(Boolean).join(' · ')}</span>
        </span>
        <span style={{ padding: '4px 10px', borderRadius: 20, background: pill.bg, color: pill.fg, fontSize: 12, fontWeight: 700 }}>{pill.text}</span>
        <span style={{ padding: '4px 10px', borderRadius: 20, background: '#fdf0e9', color: '#a3441f', fontSize: 12, fontWeight: 700 }}>Waiting on you</span>
      </button>

      {open && (
        <div style={{ borderTop: '1px solid var(--border-color)' }}>
          <div style={{ padding: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
            <IdPhoto doc={check.selfie} label="Selfie" />
            <IdPhoto doc={check.front} label="ID — front" />
            <IdPhoto doc={check.back} label="ID — back" />
          </div>
          {extras.length > 0 && (
            <div style={{ padding: '0 18px 12px' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Also sent (decided with the rest)</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                {extras.map((d) => <IdPhoto key={d.id} doc={d} label={ID_SLOT_LABELS[d.slot] || 'Photo'} height={110} />)}
              </div>
            </div>
          )}

          <div style={{ margin: '0 18px', padding: 16, borderRadius: 12, background: 'var(--bg-teal-light)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--role-color)' }}>AI analysis — all photos together</div>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Recommendation only · you decide</span>
            </div>
            {analyzing && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Looking at the selfie, front and back… (about 15 seconds)</div>}
            {!analyzing && !analysis && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{check.isDemo ? 'Demo account — no AI analysis.' : 'No analysis of these photos yet.'}</span>
                {!check.isDemo && <button type="button" onClick={runAnalysis} style={{ minHeight: 36, padding: '0 14px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', font: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Run AI analysis</button>}
              </div>
            )}
            {!analyzing && analysis && !analysis.ok && (
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {analysis.error || 'AI analysis unavailable.'}{' '}
                <button type="button" onClick={runAnalysis} style={{ background: 'none', border: 'none', color: 'var(--role-color)', fontWeight: 600, cursor: 'pointer', font: 'inherit', fontSize: 13, padding: 0 }}>Try again</button>
              </div>
            )}
            {!analyzing && analysis && analysis.ok && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px 22px', fontSize: 14 }}>
                  {analysis.checks.map((c) => {
                    const mk = ID_CHECK_MARK[c.state] || ID_CHECK_MARK.unknown;
                    return (
                      <div key={c.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={mk.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={mk.label} style={{ flexShrink: 0, marginTop: 2 }}><path d={mk.path} /></svg>
                        <div style={{ color: 'var(--text-primary)' }}><strong>{c.label}</strong>{c.detail ? <span> — {c.detail}</span> : null}</div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border-color)', fontSize: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ padding: '3px 10px', borderRadius: 20, background: pill.bg, color: pill.fg, fontSize: 12, fontWeight: 700 }}>{pill.text}</span>
                  <span style={{ color: 'var(--text-primary)' }}>{(analysis.suggestion && analysis.suggestion.reason) || analysis.summary}</span>
                </div>
                {analysis.concerns && analysis.concerns.length > 0 && (
                  <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                    <strong>Also worth a look:</strong>
                    {analysis.concerns.map((c, i) => <div key={i}>• {c}</div>)}
                  </div>
                )}
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Name, date of birth and expiry are compared by the app, not the AI. REAL ID status is not checked.</div>
              </>
            )}
          </div>

          <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label htmlFor={`idnote-${check.key}`} style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Note for the record (optional; required to ask for a new photo)</label>
            <input id={`idnote-${check.key}`} type="text" value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Checked against the photo at the welcome call"
              style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', font: 'inherit', fontSize: 14 }} />
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" disabled={!!busy} onClick={() => decide('approve')}
                style={{ minHeight: 44, padding: '0 22px', borderRadius: 10, border: 'none', background: 'var(--role-color)', color: 'var(--text-on-primary)', font: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
                {busy === 'approve' ? 'Approving…' : 'Approve identity'}
              </button>
              <button type="button" disabled={!!busy} onClick={() => decide('request_new')}
                style={{ minHeight: 44, padding: '0 18px', borderRadius: 10, border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', font: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                {busy === 'request_new' ? 'Sending…' : 'Ask for a new photo'}
              </button>
              <button type="button" disabled={!!busy} onClick={() => decide('reject')}
                style={{ minHeight: 44, padding: '0 18px', borderRadius: 10, border: '1px solid var(--color-error)', background: 'var(--bg-card)', color: 'var(--color-error)', font: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                {busy === 'reject' ? 'Rejecting…' : 'Reject'}
              </button>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>One decision covers {check.docs.length === 1 ? 'this photo' : `all ${check.docs.length} photos`}.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
