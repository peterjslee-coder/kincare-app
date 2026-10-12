// ─── Documents Center (Phase 1) ───
//
// One place, per loved one, for the papers that matter: medical records (passkey-locked to
// open), legal documents (POA, healthcare POA, living will, court order), the iPAi key, who
// the records are shared with, what iPAi suggested from a document, and the record trail.
//
// Server rules live in src/utils/medicalAccess.js and src/routes/medicalRecords.js. This
// screen only draws what the server says this person may do. Caregivers never see medical
// records; admins get no blanket read; Test Mode cannot open one.
//
// Pete's AI rule is visible here as well as in the prompt: iPAi is not medical care, it can
// only reflect what's written in the document, and nothing is created without a tap.
const MEDICAL_DOC_TYPES = [
  ['Visit_Summary', 'Visit summary'], ['Medication_List', 'Medication list'],
  ['Discharge_Summary', 'Discharge summary'], ['Lab_Result', 'Lab result'],
  ['Imaging_Report', 'Imaging report'], ['Care_Plan', 'Care plan'],
  ['Insurance_Card', 'Insurance card'], ['Other_Medical', 'Other medical'],
];
const LEGAL_DOC_TYPES = [
  ['POA', 'Power of attorney'], ['Healthcare_POA', 'Healthcare POA'],
  ['Living_Will', 'Living will'], ['Court_Order', 'Court order'], ['Other_Legal', 'Other legal'],
];
const DC_AI_ACK_TEXT = "iPAi is not medical care. It can only reflect what's written in this document, and it can be wrong. Check every suggestion against the original.";
const DC_AUDIT_LABELS = {
  uploaded: 'uploaded', viewed: 'opened', downloaded: 'downloaded', deleted: 'deleted',
  access_granted: 'shared the records with', access_revoked: 'stopped sharing the records with',
  ai_consent_granted: 'allowed iPAi to read the records', ai_consent_revoked: 'stopped iPAi reading the records',
  ai_read: 'asked iPAi to review', suggestion_accepted: 'accepted an iPAi suggestion from',
  suggestion_dismissed: 'dismissed an iPAi suggestion from',
};

const dcTypeLabel = (t) => {
  const hit = MEDICAL_DOC_TYPES.concat(LEGAL_DOC_TYPES).find(([v]) => v === t);
  return hit ? hit[1] : String(t || '').replace(/_/g, ' ');
};
const dcWhen = (d) => { try { return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };
const dcBtn = (kind = 'secondary') => ({
  minHeight: 44, padding: '10px 14px', borderRadius: 10, cursor: 'pointer', font: 'inherit', fontSize: 14, fontWeight: 700,
  border: kind === 'primary' ? '1px solid var(--accent-color)' : '1px solid var(--border-color)',
  background: kind === 'primary' ? 'var(--accent-color)' : 'var(--bg-card)',
  color: kind === 'primary' ? '#fff' : 'var(--text-primary)',
});

async function dcErrorText(res, fallback) {
  try { const e = await res.json(); return e.error || fallback; } catch { return fallback; }
}

/** A passkey assertion for { purpose }. Throws an Error whose message is safe to show. */
async function dcPasskeyAssertion(purpose) {
  const r = await apiFetch('/api/medical-records/step-up/challenge', { method: 'POST', body: JSON.stringify({ purpose }) });
  if (!r?.ok) throw new Error(await dcErrorText(r, "Couldn't start passkey confirmation."));
  const options = await r.json();
  if (!window.SimpleWebAuthnBrowser?.startAuthentication) throw new Error("Passkeys aren't available in this browser. Try another device.");
  let authResp;
  try { authResp = await window.SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: options }); } catch (e) {
    throw new Error('Passkey confirmation was cancelled or failed.');
  }
  return { ...authResp, _challengeKey: options._challengeKey };
}

const DocumentsCenter = window.DocumentsCenter = ({ onNavigate }) => {
  const { showToast } = useToast();
  const [recipients, setRecipients] = React.useState(null);
  const [selectedId, setSelectedId] = React.useState(null);
  const [loadError, setLoadError] = React.useState(null);
  const [med, setMed] = React.useState(null);          // GET /api/medical-records/:id
  const [medError, setMedError] = React.useState(null);
  const [legal, setLegal] = React.useState(null);
  const [legalError, setLegalError] = React.useState(null);
  const [suggestions, setSuggestions] = React.useState(null);
  const [audit, setAudit] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [viewer, setViewer] = React.useState(null);     // { url, mime, name, doc, kind }
  // v1.110.1 — which caregivers may open ONE legal document. { doc, list, busy }
  const [shareSheet, setShareSheet] = React.useState(null);
  const [reviewDoc, setReviewDoc] = React.useState(null);
  const [ackTicked, setAckTicked] = React.useState(false);
  const [upload, setUpload] = React.useState(null);     // { section: 'medical'|'legal', type, file }
  const [apptDates, setApptDates] = React.useState({});

  const selected = recipients && recipients.find((r) => r.id === selectedId);

  React.useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/medical-records/recipients');
        if (!res?.ok) { setLoadError(await dcErrorText(res, "Couldn't load your loved ones.")); return; }
        const data = await res.json();
        const list = data.recipients || [];
        setRecipients(list);
        setSelectedId(list[0]?.id || null);
      } catch { setLoadError("Couldn't load your loved ones. Check your connection and try again."); }
    })();
  }, []);

  const loadSuggestions = async (id, quiet) => {
    try {
      const res = await apiFetch(`/api/medical-records/${id}/suggestions`);
      if (res?.ok) { setSuggestions((await res.json()).suggestions || []); return; }
      if (res?.status === 401) { setSuggestions(null); return; } // locked — the Unlock button shows
      if (!quiet) showToast(await dcErrorText(res, "Couldn't load iPAi suggestions."), 'error');
    } catch { if (!quiet) showToast("Couldn't load iPAi suggestions.", 'error'); }
  };

  const loadMedical = async (id) => {
    setMed(null); setMedError(null); setSuggestions(null); setAudit(null);
    const r = recipients && recipients.find((x) => x.id === id);
    if (!r || !r.canViewMedical) return;
    try {
      const res = await apiFetch(`/api/medical-records/${id}`);
      if (!res?.ok) { setMedError(await dcErrorText(res, "Couldn't load medical records.")); return; }
      const data = await res.json();
      setMed(data);
      if (data.me.canSeeAudit) {
        const a = await apiFetch(`/api/medical-records/${id}/audit`);
        if (a?.ok) setAudit((await a.json()).entries || []);
        else showToast(await dcErrorText(a, "Couldn't load the record trail."), 'error');
      }
      if (data.me.stepUpExpiresAt) await loadSuggestions(id, true);
    } catch { setMedError("Couldn't load medical records. Check your connection and try again."); }
  };

  const loadLegal = async (id) => {
    setLegal(null); setLegalError(null);
    try {
      const res = await apiFetch(`/api/documents/owner/care_recipient/${id}`);
      if (!res?.ok) { setLegalError(res?.status === 403 ? "Legal documents for this person aren't shared with you." : await dcErrorText(res, "Couldn't load legal documents.")); return; }
      const data = await res.json();
      const legalTypes = LEGAL_DOC_TYPES.map(([v]) => v);
      setLegal((data.documents || []).filter((d) => (d.category === 'legal' || d.category === 'consent') && legalTypes.includes(d.document_type)));
    } catch { setLegalError("Couldn't load legal documents. Check your connection and try again."); }
  };

  React.useEffect(() => {
    if (!selectedId || !recipients) return;
    loadMedical(selectedId);
    loadLegal(selectedId);
  }, [selectedId, recipients]);

  // Close the viewer → the blob URL goes with it. A medical record must not linger in memory.
  const closeViewer = () => {
    setViewer((v) => { if (v?.url) { try { URL.revokeObjectURL(v.url); } catch { /* already gone */ } } return null; });
  };

  const unlock = async () => {
    setBusy(true);
    try {
      const assertion = await dcPasskeyAssertion('open');
      const res = await apiFetch('/api/medical-records/step-up/verify', { method: 'POST', body: JSON.stringify(assertion) });
      if (!res?.ok) { showToast(await dcErrorText(res, 'Passkey confirmation failed.'), 'error'); return false; }
      showToast('Unlocked for 10 minutes.', 'success');
      await loadMedical(selectedId);
      return true;
    } catch (e) { showToast(e.message || 'Passkey confirmation failed.', 'error'); return false; }
    finally { setBusy(false); }
  };

  // Run a request; if the server says the step-up has lapsed, confirm with the passkey and retry once.
  const withStepUp = async (doRequest) => {
    let res = await doRequest();
    if (res?.status === 401) {
      const body = await res.clone().json().catch(() => ({}));
      if (body.needsStepUp && (await unlock())) res = await doRequest();
    }
    return res;
  };

  const openMedical = async (doc) => {
    try {
      const res = await withStepUp(() => apiFetch(`/api/medical-records/${selectedId}/docs/${doc.id}/open`));
      if (!res?.ok) { showToast(await dcErrorText(res, "Couldn't open this record."), 'error'); return; }
      const blob = await res.blob();
      setViewer({ url: URL.createObjectURL(blob), mime: doc.mimeType, name: doc.fileName, doc, kind: 'medical' });
    } catch { showToast("Couldn't open this record. Check your connection and try again.", 'error'); }
  };

  const downloadMedical = async (doc) => {
    try {
      const res = await withStepUp(() => apiFetch(`/api/medical-records/${selectedId}/docs/${doc.id}/open?download=1`));
      if (!res?.ok) { showToast(await dcErrorText(res, "Couldn't download this record."), 'error'); return; }
      const saved = await saveBlob(await res.blob(), doc.fileName || 'medical-record');
      if (!saved) showToast("Couldn't save the file on this device.", 'error');
    } catch { showToast("Couldn't download this record.", 'error'); }
  };

  // v1.110.1 — Pete: "Caregivers should not be able to open any legal documents unless the
  // careteam explicitly allows it." The leader shares a document with a caregiver one by one.
  const openShares = async (doc) => {
    setShareSheet({ doc, list: null, busy: false });
    try {
      const res = await apiFetch(`/api/documents/${doc.id}/shares`);
      if (!res?.ok) { setShareSheet(null); showToast(await dcErrorText(res, "Couldn't load caregiver access."), 'error'); return; }
      const data = await res.json();
      setShareSheet({ doc, list: data.caregivers || [], busy: false });
    } catch { setShareSheet(null); showToast("Couldn't load caregiver access. Check your connection and try again.", 'error'); }
  };
  const toggleShare = async (cg) => {
    if (!shareSheet) return;
    const allow = !cg.allowed;
    setShareSheet((s) => s && { ...s, busy: true });
    try {
      const res = await apiFetch(`/api/documents/${shareSheet.doc.id}/shares/${cg.userId}`, { method: 'PUT', body: JSON.stringify({ allow }) });
      // 409 = it is already in the state we asked for; take the answer and move on.
      if (res?.ok || res?.status === 409) {
        setShareSheet((s) => s && { ...s, busy: false, list: s.list.map((x) => x.userId === cg.userId ? { ...x, allowed: allow } : x) });
        showToast(allow ? `${cg.name} can now open this document.` : `${cg.name} can no longer open this document.`, 'success');
      } else {
        setShareSheet((s) => s && { ...s, busy: false });
        showToast(await dcErrorText(res, "Couldn't change caregiver access."), 'error');
      }
    } catch {
      setShareSheet((s) => s && { ...s, busy: false });
      showToast("Couldn't change caregiver access. Check your connection and try again.", 'error');
    }
  };

  const openLegal = async (doc) => {
    try {
      const res = await apiFetch(`/api/documents/${doc.id}/download`);
      if (!res?.ok) { showToast(await dcErrorText(res, "Couldn't open this document."), 'error'); return; }
      const blob = await res.blob();
      setViewer({ url: URL.createObjectURL(blob), mime: doc.mime_type, name: doc.file_name, doc, kind: 'legal' });
    } catch { showToast("Couldn't open this document.", 'error'); }
  };

  const deleteDoc = async (docIdToDelete, kind) => {
    if (!confirm('Delete this document? This cannot be undone.')) return;
    try {
      const res = await apiFetch(`/api/documents/${docIdToDelete}`, { method: 'DELETE' });
      if (!res?.ok) { showToast(await dcErrorText(res, "Couldn't delete this document."), 'error'); return; }
      showToast('Deleted.', 'success');
      if (kind === 'medical') loadMedical(selectedId); else loadLegal(selectedId);
    } catch { showToast("Couldn't delete this document.", 'error'); }
  };

  const submitUpload = async () => {
    if (!upload?.file) { showToast('Choose a file first.', 'error'); return; }
    if (!upload.authority) { showToast(`Please confirm you're allowed to share this for ${selected?.name || 'them'}.`, 'error'); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('document', upload.file);
      fd.append('category', upload.section === 'medical' ? 'medical' : 'legal');
      fd.append('document_type', upload.type);
      fd.append('owner_type', 'care_recipient');
      fd.append('owner_id', selectedId);
      fd.append('authority_confirmed', '1'); // v1.110.2 — Privacy Policy 2026-10-12 §7
      const res = await apiFetch('/api/documents/upload', { method: 'POST', body: fd });
      if (!res?.ok) { showToast(await dcErrorText(res, 'Upload failed.'), 'error'); return; }
      showToast('Uploaded.', 'success');
      const section = upload.section;
      setUpload(null);
      if (section === 'medical') loadMedical(selectedId); else loadLegal(selectedId);
    } catch (e) { showToast(e?.name === 'ApiTimeoutError' ? 'Upload timed out. Please try again.' : 'Upload failed.', 'error'); }
    finally { setBusy(false); }
  };

  const changeAiKey = async (granted) => {
    setBusy(true);
    try {
      const assertion = await dcPasskeyAssertion('ai_consent');
      const res = await apiFetch(`/api/medical-records/${selectedId}/ai-consent`, { method: 'PUT', body: JSON.stringify({ ...assertion, granted }) });
      if (!res?.ok) { showToast(await dcErrorText(res, "Couldn't change iPAi access."), 'error'); return; }
      const data = await res.json();
      showToast(granted ? 'iPAi may now read these records.' : `iPAi access is off${data.pendingSuggestionsRemoved ? ' and its pending suggestions were removed' : ''}.`, 'success');
      await loadMedical(selectedId);
    } catch (e) { showToast(e.message || "Couldn't change iPAi access.", 'error'); }
    finally { setBusy(false); }
  };

  const changeSharing = async (userId, allowed) => {
    try {
      const res = await withStepUp(() => apiFetch(`/api/medical-records/${selectedId}/access/${userId}`, { method: 'PUT', body: JSON.stringify({ allowed }) }));
      if (!res?.ok) { showToast(await dcErrorText(res, "Couldn't change sharing."), 'error'); return; }
      await loadMedical(selectedId);
    } catch { showToast("Couldn't change sharing.", 'error'); }
  };

  const runReview = async () => {
    if (!ackTicked || !reviewDoc) return;
    setBusy(true);
    try {
      const res = await withStepUp(() => apiFetch(`/api/medical-records/${selectedId}/docs/${reviewDoc.id}/review`, {
        method: 'POST', body: JSON.stringify({ acknowledged: true }), timeoutMs: 90000,
      }));
      if (!res?.ok) { showToast(await dcErrorText(res, 'iPAi review failed.'), 'error'); return; }
      const data = await res.json();
      showToast(data.count ? `iPAi found ${data.count} item${data.count === 1 ? '' : 's'} to review.` : 'iPAi found nothing to suggest in this document.', 'success');
      setReviewDoc(null); setAckTicked(false);
      await loadMedical(selectedId);
    } catch { showToast('iPAi review failed. Nothing was saved.', 'error'); }
    finally { setBusy(false); }
  };

  const decide = async (s, action) => {
    try {
      const body = { action };
      if (action === 'accept' && s.kind === 'appointment') body.event_date = apptDates[s.id] || s.suggestedDate || '';
      const res = await apiFetch(`/api/medical-records/${selectedId}/suggestions/${s.id}/decide`, { method: 'POST', body: JSON.stringify(body) });
      if (!res?.ok) { showToast(await dcErrorText(res, "Couldn't save your decision."), 'error'); return; }
      showToast(action === 'accept' ? (s.kind === 'appointment' ? 'Added to the care calendar.' : 'Marked reviewed.') : 'Dismissed.', 'success');
      await loadSuggestions(selectedId);
    } catch { showToast("Couldn't save your decision.", 'error'); }
  };

  // ── render ──
  if (loadError) return <div className="card" style={{ margin: 16, color: 'var(--text-secondary)' }}>{loadError}</div>;
  if (!recipients) return <div className="card" style={{ margin: 16, color: 'var(--text-secondary)' }}>Loading…</div>;
  if (recipients.length === 0) {
    return <div className="card" style={{ margin: 16 }}>
      <div className="card-header"><span className="card-icon">📁</span>Documents Center</div>
      <p style={{ color: 'var(--text-secondary)' }}>When you're on a loved one's care team, their documents will be here.</p>
    </div>;
  }

  const unlocked = !!med?.me?.stepUpExpiresAt;
  const pendingSugs = (suggestions || []).filter((s) => s.status === 'pending');
  const muted = { color: 'var(--text-secondary)', fontSize: 14 };
  const row = { borderTop: '1px solid var(--border-color)', padding: '10px 0' };

  return (
    <div style={{ padding: '0 0 24px' }} data-testid="documents-center">
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-header"><span className="card-icon">📁</span>Documents Center</div>
        {recipients.length > 1 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {recipients.map((r) => (
              <button key={r.id} onClick={() => setSelectedId(r.id)} style={{
                ...dcBtn(), border: r.id === selectedId ? '2px solid var(--role-color)' : '1px solid var(--border-color)',
                background: r.id === selectedId ? 'var(--bg-teal-light)' : 'var(--bg-card)',
                color: r.id === selectedId ? 'var(--role-color)' : 'var(--text-secondary)',
              }}>{r.name}</button>
            ))}
          </div>
        )}
        <p style={{ fontSize: 13, color: 'var(--text-tertiary)', margin: '8px 0 0' }}>
          {selected ? `${selected.name}'s medical and legal documents.` : ''}
        </p>
      </div>

      {/* ── Medical records ── */}
      <div className="card" style={{ marginBottom: 12 }} data-testid="dc-medical">
        <div className="card-header"><span className="card-icon">🩺</span>Medical records</div>
        {selected && !selected.canViewMedical && (
          <p style={muted}>Medical records are private to {selected.name}, the care team leader, and family members the leader chooses.</p>
        )}
        {medError && <p style={muted}>{medError}</p>}
        {selected?.canViewMedical && !med && !medError && <p style={muted}>Loading…</p>}
        {med && (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '4px 0 12px' }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {unlocked ? '🔓 Unlocked — records open without asking again for a few minutes.' : '🔒 Opening a record needs your passkey.'}
              </span>
              {!unlocked && <button style={dcBtn()} disabled={busy} onClick={unlock}>Unlock with passkey</button>}
              <button style={dcBtn('primary')} onClick={() => setUpload({ section: 'medical', type: 'Visit_Summary', file: null })}>Upload a record</button>
            </div>
            {med.documents.length === 0 && <p style={muted}>No medical records yet.</p>}
            {med.documents.map((d) => (
              <div key={d.id} style={row}>
                <div style={{ fontWeight: 700 }}>{dcTypeLabel(d.documentType)}</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{d.fileName} · {d.uploadedBy} · {dcWhen(d.createdAt)}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  <button style={dcBtn()} onClick={() => openMedical(d)}>{unlocked ? 'Open' : '🔒 Open'}</button>
                  <button style={dcBtn()} onClick={() => downloadMedical(d)}>Download</button>
                  {med.aiKey.on && <button style={dcBtn()} onClick={() => { setReviewDoc(d); setAckTicked(false); }}>Review with iPAi</button>}
                  {(d.mine || med.me.isLeader || med.me.isMember) && <button style={dcBtn()} onClick={() => deleteDoc(d.id, 'medical')}>Delete</button>}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* ── The iPAi key ── */}
      {med && (
        <div className="card" style={{ marginBottom: 12 }} data-testid="dc-ai-key">
          <div className="card-header"><span className="card-icon">🔑</span>iPAi may read these records</div>
          <p style={{ fontSize: 14, margin: '0 0 6px' }}>
            <strong>{med.aiKey.on ? 'On' : 'Off'}</strong>
            {' — '}the key is held by {med.me.isKeyHolder ? 'you' : (med.aiKey.holderName || 'the care team leader')}
            {med.aiKey.holderIsMember ? ` (${med.recipient.name}'s own account)` : ' (care team leader)'}.
          </p>
          {med.aiKey.decidedAt && <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '0 0 8px' }}>Last changed by {med.aiKey.decidedBy} · {dcWhen(med.aiKey.decidedAt)}</p>}
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 8px' }}>
            When it's on, iPAi can read a record you ask it to review and list what's written in it — appointments, medications as listed, instructions. It is not medical care and adds nothing that isn't in the document.
          </p>
          {med.me.isKeyHolder && (
            <button style={dcBtn(med.aiKey.on ? 'secondary' : 'primary')} disabled={busy} onClick={() => changeAiKey(!med.aiKey.on)}>
              {med.aiKey.on ? 'Turn off (passkey)' : 'Turn on (passkey)'}
            </button>
          )}
        </div>
      )}

      {/* ── iPAi suggestions ── */}
      {med && (med.aiKey.on || med.pendingSuggestions > 0 || (suggestions && suggestions.length > 0)) && (
        <div className="card" style={{ marginBottom: 12 }} data-testid="dc-suggestions">
          <div className="card-header"><span className="card-icon">📋</span>From the documents — for you to check</div>
          <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '0 0 8px', padding: '8px 10px', background: 'var(--bg-elevated)', borderRadius: 8 }}>
            iPAi is not medical care. Each item below only reflects what's written in the document, quoted word for word, and it can be wrong. Check every one against the original. Nothing is added until you tap Accept.
          </p>
          {!unlocked && <button style={dcBtn()} disabled={busy} onClick={unlock}>🔒 Unlock to see suggestions</button>}
          {unlocked && suggestions && pendingSugs.length === 0 && <p style={muted}>Nothing waiting for review.</p>}
          {unlocked && pendingSugs.map((s) => (
            <div key={s.id} style={row}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--role-color)', textTransform: 'uppercase' }}>
                {s.kind === 'appointment' ? 'Appointment' : s.kind === 'medication' ? 'Medication as listed' : 'To review'}
              </div>
              <div style={{ fontWeight: 700 }}>{s.title}</div>
              {s.detail && <div style={{ fontSize: 14 }}>{s.detail}</div>}
              <blockquote style={{ margin: '6px 0', padding: '6px 10px', borderLeft: '3px solid var(--border-color)', fontSize: 13, color: 'var(--text-secondary)' }}>
                “{s.sourceQuote}” <span style={{ fontSize: 12 }}>— {s.fileName || dcTypeLabel(s.documentType)}</span>
              </blockquote>
              {s.kind === 'appointment' && (
                <label style={{ display: 'block', fontSize: 13, margin: '4px 0' }}>Date{' '}
                  <input type="date" value={apptDates[s.id] ?? (s.suggestedDate || '')}
                    onChange={(e) => setApptDates({ ...apptDates, [s.id]: e.target.value })}
                    style={{ minHeight: 44, font: 'inherit' }} />
                </label>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button style={dcBtn('primary')} onClick={() => decide(s, 'accept')}>
                  {s.kind === 'appointment' ? 'Add to calendar' : 'Mark reviewed'}
                </button>
                <button style={dcBtn()} onClick={() => decide(s, 'dismiss')}>Dismiss</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Sharing (leader / member) ── */}
      {med && med.sharing && (
        <div className="card" style={{ marginBottom: 12 }} data-testid="dc-sharing">
          <div className="card-header"><span className="card-icon">👪</span>Who can see medical records</div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 8px' }}>Choose family members one by one. Caregivers never see medical records.</p>
          {med.sharing.map((p) => (
            <div key={p.userId} style={{ ...row, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 0' }}>
              <span>{p.name}</span>
              {p.status === 'always' && <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Always</span>}
              {p.status === 'caregiver' && <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Caregiver — no access</span>}
              {(p.status === 'allowed' || p.status === 'not_allowed') && (
                <button style={dcBtn(p.status === 'allowed' ? 'secondary' : 'primary')} onClick={() => changeSharing(p.userId, p.status !== 'allowed')}>
                  {p.status === 'allowed' ? 'Stop sharing' : 'Share'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Legal documents ── */}
      <div className="card" style={{ marginBottom: 12 }} data-testid="dc-legal">
        <div className="card-header"><span className="card-icon">⚖️</span>Legal documents</div>
        {/* Mount point for the legal-readiness feature (built separately): renders
            <LegalReadinessCard careRecipientId=… /> only once that component is in the bundle.
            createElement on window, because the client lint (rightly) refuses JSX for a name the
            bundle does not declare yet. */}
        {typeof window.LegalReadinessCard !== 'undefined' && selectedId && React.createElement(window.LegalReadinessCard, { careRecipientId: selectedId })}
        {legalError && <p style={muted}>{legalError}</p>}
        {!legal && !legalError && <p style={muted}>Loading…</p>}
        {legal && (
          <>
            <button style={{ ...dcBtn('primary'), marginBottom: 8 }} onClick={() => setUpload({ section: 'legal', type: 'POA', file: null })}>Upload a legal document</button>
            {legal.length === 0 && <p style={muted}>No legal documents yet.</p>}
            {legal.map((d) => (
              <div key={d.id} style={row}>
                <div style={{ fontWeight: 700 }}>{dcTypeLabel(d.document_type)}</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{d.file_name} · {dcWhen(d.created_at)} · {String(d.status || '').replace(/_/g, ' ')}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button style={dcBtn()} onClick={() => openLegal(d)}>Open</button>
                  {med && med.me && med.me.canManageAccess && <button style={dcBtn()} onClick={() => openShares(d)}>Caregiver access</button>}
                  {d.status !== 'approved' && <button style={dcBtn()} onClick={() => deleteDoc(d.id, 'legal')}>Delete</button>}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* ── Record trail ── */}
      {med && med.me.canSeeAudit && (
        <div className="card" style={{ marginBottom: 12 }} data-testid="dc-audit">
          <div className="card-header"><span className="card-icon">🧾</span>Medical record trail</div>
          {!audit && <p style={muted}>Loading…</p>}
          {audit && audit.length === 0 && <p style={muted}>Nothing yet.</p>}
          {audit && audit.slice(0, 50).map((e) => (
            <div key={e.id} style={{ fontSize: 13, borderTop: '1px solid var(--border-color)', padding: '6px 0' }}>
              <strong>{e.actor || 'Someone'}</strong> {DC_AUDIT_LABELS[e.eventType] || e.eventType.replace(/_/g, ' ')}
              {e.detail?.name ? ` ${e.detail.name}` : ''}
              {e.documentType ? ` ${dcTypeLabel(e.documentType)}` : ''}
              {e.fileName ? ` (${e.fileName})` : ''}
              <div style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{dcWhen(e.createdAt)}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Caregiver access for one legal document (v1.110.1) ── */}
      {shareSheet && (
        <div className="modal-overlay" onClick={() => !shareSheet.busy && setShareSheet(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <button className="modal-close" onClick={() => setShareSheet(null)} aria-label="Close">✕</button>
            <div className="modal-header" style={{ fontSize: 17 }}>Caregiver access — {dcTypeLabel(shareSheet.doc.document_type)}</div>
            <p style={muted}>Legal documents are for the family's care team. A caregiver can open this one only if you allow it here.</p>
            {!shareSheet.list && <p style={muted}>Loading…</p>}
            {shareSheet.list && shareSheet.list.length === 0 && <p style={muted}>No caregivers on this care team yet.</p>}
            {shareSheet.list && shareSheet.list.map((cg) => (
              <div key={cg.userId} style={{ ...row, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{cg.name}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{cg.allowed ? 'Can open this document' : 'Cannot open this document'}</div>
                </div>
                <button style={dcBtn(cg.allowed ? 'secondary' : 'primary')} disabled={shareSheet.busy} onClick={() => toggleShare(cg)}>{cg.allowed ? 'Remove' : 'Allow'}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Upload sheet ── */}
      {upload && (
        <div className="modal-overlay" onClick={() => !busy && setUpload(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <button className="modal-close" onClick={() => setUpload(null)} aria-label="Close">✕</button>
            <div className="modal-header" style={{ fontSize: 17 }}>{upload.section === 'medical' ? 'Upload a medical record' : 'Upload a legal document'}</div>
            <label style={{ display: 'block', margin: '12px 0 6px', fontSize: 14 }}>Type</label>
            <select value={upload.type} onChange={(e) => setUpload({ ...upload, type: e.target.value })} style={{ minHeight: 44, width: '100%', font: 'inherit' }}>
              {(upload.section === 'medical' ? MEDICAL_DOC_TYPES : LEGAL_DOC_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <label style={{ display: 'block', margin: '12px 0 6px', fontSize: 14 }}>File (PDF or photo, up to 10 MB)</label>
            <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => setUpload({ ...upload, file: e.target.files?.[0] || null })} style={{ minHeight: 44 }} />
            {upload.section === 'medical' && <p style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>Medical records are stored privately. Only {selected?.name}, the care team leader and family members they choose can see them — never caregivers, and not InPlace staff.</p>}
            {/* v1.110.2 — the uploader is usually acting FOR the person. Privacy Policy and Terms
                2026-10-12 say we store these only after this is confirmed. */}
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 12, fontSize: 13.5, lineHeight: 1.45, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!upload.authority} onChange={(e) => setUpload({ ...upload, authority: e.target.checked })} style={{ width: 20, height: 20, marginTop: 1, flex: '0 0 auto' }} />
              <span>I'm allowed to share this for {selected?.name || 'them'}: they agreed, or I have legal authority to act for them (for example a power of attorney, healthcare agent or guardian).</span>
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button style={dcBtn('primary')} disabled={busy || !upload.file || !upload.authority} onClick={submitUpload}>{busy ? 'Uploading…' : 'Upload'}</button>
              <button style={dcBtn()} onClick={() => setUpload(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── iPAi review — the acknowledgment is at the point of generation ── */}
      {reviewDoc && (
        <div className="modal-overlay" onClick={() => !busy && setReviewDoc(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <button className="modal-close" onClick={() => setReviewDoc(null)} aria-label="Close">✕</button>
            <div className="modal-header" style={{ fontSize: 17 }}>Review with iPAi</div>
            <p style={{ fontSize: 14 }}>iPAi will read <strong>{reviewDoc.fileName}</strong> and list only what's written in it — follow-up appointments with their dates, medications exactly as listed, and instructions for the family — each with a quote from the document. It will not add medical knowledge, interpret results, or suggest doses.</p>
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, margin: '12px 0', cursor: 'pointer' }}>
              <input type="checkbox" checked={ackTicked} onChange={(e) => setAckTicked(e.target.checked)} style={{ width: 22, height: 22, flexShrink: 0 }} />
              <span>{DC_AI_ACK_TEXT}</span>
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={dcBtn('primary')} disabled={!ackTicked || busy} onClick={runReview}>{busy ? 'Reading…' : 'Review'}</button>
              <button style={dcBtn()} onClick={() => setReviewDoc(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Viewer ── */}
      {viewer && (
        <div className="modal-overlay" onClick={closeViewer}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 900, width: '95vw', maxHeight: '90vh', overflow: 'auto' }}>
            <button className="modal-close" onClick={closeViewer} aria-label="Close">✕</button>
            <div className="modal-header" style={{ fontSize: 16 }}>{viewer.name}</div>
            {String(viewer.mime || '').startsWith('image/')
              ? <img src={viewer.url} alt={viewer.name} style={{ maxWidth: '100%', display: 'block', margin: '8px auto' }} />
              : <iframe src={viewer.url} title={viewer.name} style={{ width: '100%', height: '70vh', border: 'none' }} />}
            {viewer.kind === 'medical' && (
              <button style={{ ...dcBtn(), marginTop: 8 }} onClick={() => downloadMedical(viewer.doc)}>Download</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
