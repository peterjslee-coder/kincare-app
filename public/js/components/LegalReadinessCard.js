// ─── Legal & money readiness (v1.110, migration 051_legal_readiness) ───
//
// Family-only. Mounted on the family Care Profile and by the Documents Center. The server
// refuses caregivers and helpers outright (routes/legalReadiness.js) — this component simply
// renders nothing when it is refused, so it is safe to mount anywhere.
//
// Three states per item, never two: done, not done, and NOT KNOWN YET. An item nobody has
// answered says "Not answered yet", never "Missing".
//
// InPlace is not a law firm or financial adviser: every surface here carries the disclaimer.

const LR_STATE = {
  on_file: { label: 'On file', tone: 'ok' },
  in_review: { label: 'Uploaded — being checked', tone: 'ok' },
  have_it: { label: 'You have one (not uploaded)', tone: 'ok' },
  missing: { label: 'Not in place yet', tone: 'warn' },
  not_sure: { label: 'Not sure', tone: 'unknown' },
  check_type: { label: 'A POA is on file \u2014 check it covers money', tone: 'unknown' },
  unknown: { label: 'Not answered yet', tone: 'unknown' },
};
const LR_TONE = {
  ok: { background: 'var(--color-success-bg, #e8f5ee)', color: 'var(--color-success, #1d6b45)' },
  warn: { background: 'var(--color-warning-bg, #fff4e0)', color: 'var(--color-warning-text, #7a4a00)' },
  unknown: { background: 'var(--bg-secondary, #f1f1f1)', color: 'var(--text-secondary, #555)' },
};
const LR_ANSWERS = [
  { value: 'have_not_uploaded', label: "We have one but haven't uploaded it" },
  { value: 'not_sure', label: 'Not sure' },
  { value: 'dont_have', label: "We don't have one" },
];
const LR_KIND_LABEL = {
  elder_law: 'Elder-law attorneys',
  financial_advisor: 'Financial advisors',
  aps: 'Adult Protective Services',
  aaa: 'Area Agency on Aging',
  legal_aid: 'Free legal help',
  other: 'Other help',
};
const LR_HEALTH_UPLOAD_TYPES = [
  { value: 'Healthcare_POA', label: 'Health care power of attorney' },
  { value: 'Living_Will', label: 'Advance directive / living will' },
];

const lrErr = async (res, fallback) => {
  const d = res ? await res.json().catch(() => ({})) : {};
  return d.error || fallback;
};

// The directory, as returned by /resources or by a concern report.
const LegalResourceList = ({ directory, only }) => {
  if (!directory) return null;
  const kinds = (only || Object.keys(LR_KIND_LABEL)).filter((k) => (directory.resources?.[k] || []).length);
  return (
    <div>
      {kinds.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No listings for this area yet.</div>
      )}
      {kinds.map((k) => (
        <div key={k} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4 }}>{LR_KIND_LABEL[k] || k}</div>
          {directory.resources[k].map((r) => (
            <div key={r.id} style={{ padding: '8px 10px', border: '1px solid var(--border-light, #e5e5e5)', borderRadius: 8, marginBottom: 6 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">{r.name}</a> : r.name}
              </div>
              {r.phone && <div style={{ fontSize: 13, marginTop: 2 }}><a href={`tel:${String(r.phone).replace(/[^\d+]/g, '')}`}>{r.phone}</a></div>}
              {r.notes && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.4 }}>{r.notes}</div>}
            </div>
          ))}
        </div>
      ))}
      <div style={{ fontSize: 11, color: 'var(--text-tertiary, #777)', marginTop: 4 }}>{directory.footer || "InPlace doesn't receive payment for these listings."}</div>
    </div>
  );
};
window.LegalResourceList = LegalResourceList;

const LegalReadinessCard = window.LegalReadinessCard = ({ careRecipientId }) => {
  const { showToast } = useToast();
  const [data, setData] = React.useState(null);
  const [hidden, setHidden] = React.useState(false);
  const [openItem, setOpenItem] = React.useState(null);
  const [saving, setSaving] = React.useState(null);
  const [uploadingKey, setUploadingKey] = React.useState(null);
  // v1.110.2 — confirm authority before an upload (Privacy Policy / Terms 2026-10-12)
  const [authority, setAuthority] = React.useState(false);
  const [healthType, setHealthType] = React.useState('Healthcare_POA');
  const [directory, setDirectory] = React.useState(null);
  const [dirLoading, setDirLoading] = React.useState(false);
  const [concernOpen, setConcernOpen] = React.useState(false);
  const [concernText, setConcernText] = React.useState('');
  const [concernSending, setConcernSending] = React.useState(false);
  const [concernResult, setConcernResult] = React.useState(null);
  const [acking, setAcking] = React.useState(null);
  const rootRef = React.useRef(null);
  const fileRefs = React.useRef({});

  const load = React.useCallback(async () => {
    if (!careRecipientId) return;
    try {
      const res = await apiFetch(`/api/legal-readiness/${careRecipientId}`);
      if (res?.ok) {
        setData(await res.json());
        setHidden(false);
      } else if (res && (res.status === 403 || res.status === 404)) {
        setHidden(true); // not family for this person — show nothing
      } else {
        showToast(await lrErr(res, "Couldn't load the readiness checklist."), 'error');
      }
    } catch {
      showToast("Couldn't load the readiness checklist.", 'error');
    }
  }, [careRecipientId]);

  React.useEffect(() => { setData(null); setDirectory(null); setConcernResult(null); load(); }, [careRecipientId]);

  // A Needs-you "Open" or a push lands here with focus legalReadiness:<id>.
  React.useEffect(() => {
    const claim = () => {
      const f = window.__pendingFocus;
      if (!data || f !== `legalReadiness:${careRecipientId}`) return;
      window.__pendingFocus = null;
      setTimeout(() => { if (rootRef.current) rootRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 80);
    };
    claim();
    window.addEventListener('inplace:focus', claim);
    return () => window.removeEventListener('inplace:focus', claim);
  }, [data, careRecipientId]);

  const loadDirectory = async () => {
    setDirLoading(true);
    try {
      const res = await apiFetch(`/api/legal-readiness/${careRecipientId}/resources`);
      if (res?.ok) setDirectory(await res.json());
      else showToast(await lrErr(res, "Couldn't load local help."), 'error');
    } catch {
      showToast("Couldn't load local help.", 'error');
    }
    setDirLoading(false);
  };

  React.useEffect(() => {
    if (data?.sharedConcerns?.length && !directory && !dirLoading) loadDirectory();
  }, [data]);

  const answer = async (itemKey, value) => {
    setSaving(itemKey);
    try {
      const res = await apiFetch(`/api/legal-readiness/${careRecipientId}/answers/${itemKey}`, {
        method: 'PUT', body: JSON.stringify({ answer: value }),
      });
      if (res?.ok) {
        const d = await res.json();
        setData((prev) => prev ? { ...prev, items: d.items, complete: d.items.every((i) => i.done) } : prev);
        showToast('Saved', 'success');
      } else {
        showToast(await lrErr(res, "Couldn't save your answer."), 'error');
      }
    } catch {
      showToast("Couldn't save your answer.", 'error');
    }
    setSaving(null);
  };

  const upload = async (item, file) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { showToast('That file is over 10 MB.', 'error'); return; }
    setUploadingKey(item.key);
    try {
      const fd = new FormData();
      fd.append('document', file);
      fd.append('category', 'legal');
      fd.append('document_type', item.key === 'healthcare_directive' ? healthType : item.uploadType);
      fd.append('owner_type', 'care_recipient');
      fd.append('owner_id', careRecipientId);
      fd.append('authority_confirmed', '1');
      const res = await apiFetch('/api/documents/upload', { method: 'POST', body: fd });
      if (res?.ok) {
        showToast("Uploaded — we'll check it shortly.", 'success');
        await load();
      } else {
        showToast(await lrErr(res, 'Upload failed. Please try again.'), 'error');
      }
    } catch {
      showToast('Upload failed. Please try again.', 'error');
    }
    setUploadingKey(null);
  };

  const sendConcern = async () => {
    if (concernText.trim().length < 5) { showToast('Tell us a little about what you noticed.', 'error'); return; }
    setConcernSending(true);
    try {
      const res = await apiFetch(`/api/legal-readiness/${careRecipientId}/concerns`, {
        method: 'POST', body: JSON.stringify({ description: concernText.trim() }),
      });
      if (res?.ok) {
        setConcernResult(await res.json());
        setConcernText('');
        setConcernOpen(false);
      } else {
        showToast(await lrErr(res, "Couldn't send that. Please try again."), 'error');
      }
    } catch {
      showToast("Couldn't send that. Please try again.", 'error');
    }
    setConcernSending(false);
  };

  const acknowledge = async (id) => {
    setAcking(id);
    try {
      const res = await apiFetch(`/api/legal-readiness/concerns/${id}/acknowledge`, { method: 'POST' });
      if (res?.ok || res?.status === 409) {
        setData((prev) => prev ? { ...prev, sharedConcerns: prev.sharedConcerns.filter((c) => c.id !== id) } : prev);
        window.dispatchEvent(new Event('inplace:attention-stale'));
      } else {
        showToast(await lrErr(res, "Couldn't save that."), 'error');
      }
    } catch {
      showToast("Couldn't save that.", 'error');
    }
    setAcking(null);
  };

  if (hidden || !careRecipientId) return null;
  if (!data) return null;

  const name = data.recipient?.firstName || 'your loved one';
  const btn = { padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border-light, #ddd)', background: 'var(--bg-primary, #fff)', color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer' };
  const primaryBtn = { ...btn, background: 'var(--role-color)', color: 'var(--text-on-primary, #fff)', border: 'none', fontWeight: 600 };
  const doneCount = data.items.filter((i) => i.done).length;

  return (
    <div ref={rootRef} data-legal-readiness={careRecipientId}>
      {data.sharedConcerns?.length > 0 && (
        <div className="card" style={{ borderLeft: '4px solid var(--role-color)' }}>
          <div className="card-header">A note from the InPlace team</div>
          <div style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--text-primary)' }}>
            We wanted to make sure you have some money-safety resources for {name}. This isn't a judgement about anyone &mdash; it's who to call and what to do if something ever feels off.
          </div>
          <ul style={{ fontSize: 13, lineHeight: 1.5, paddingLeft: 18, margin: '10px 0' }}>
            {data.sharedConcerns[0].steps.map((s, i) => <li key={i} style={{ marginBottom: 4 }}>{s}</li>)}
          </ul>
          {dirLoading && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Loading local help&hellip;</div>}
          {directory && <LegalResourceList directory={directory} only={['aps', 'elder_law', 'financial_advisor', 'other']} />}
          <div style={{ fontSize: 11, color: 'var(--text-tertiary, #777)', marginTop: 8 }}>{data.disclaimer}</div>
          <div style={{ marginTop: 10 }}>
            {data.sharedConcerns.map((c) => (
              <button key={c.id} style={primaryBtn} disabled={acking === c.id} onClick={() => acknowledge(c.id)}>
                {acking === c.id ? 'Saving…' : 'Got it'}
              </button>
            ))}
          </div>
        </div>
      )}

      <CollapsibleCard storageKey="legalReadiness" defaultOpen={true} icon={'\u{1F4CB}'} title="Legal & money readiness" count={`${doneCount}/${data.items.length}`}>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 12 }}>
          Two documents make it much easier to help {name} if they ever can't manage things on their own. Here's where things stand.
        </div>

        {data.items.map((item) => {
          const st = LR_STATE[item.state] || LR_STATE.unknown;
          const isOpen = openItem === item.key || (openItem === null && !item.done && item.state === 'unknown' && data.items.find((i) => !i.done)?.key === item.key);
          return (
            <div key={item.key} style={{ borderTop: '1px solid var(--border-light, #eee)', padding: '10px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                onClick={() => setOpenItem(isOpen ? '' : item.key)}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{item.title}</div>
                <span style={{ ...LR_TONE[st.tone], fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 10, whiteSpace: 'nowrap' }}>{st.label}</span>
              </div>
              {item.lastUploadRejected && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>The last upload couldn't be verified. You can upload it again.</div>
              )}
              {isOpen && (
                <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5 }}>
                  <div style={{ marginBottom: 6 }}><strong>What it is.</strong> {item.what}</div>
                  {!item.done && <div style={{ marginBottom: 6 }}><strong>When it matters.</strong> {item.when}</div>}
                  {!item.done && <div style={{ marginBottom: 6 }}><strong>How to get one.</strong> {item.how}</div>}
                  {!item.done && item.links?.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      {item.links.map((l) => (
                        <div key={l.url}><a href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a></div>
                      ))}
                    </div>
                  )}
                  {item.state !== 'on_file' && item.state !== 'in_review' && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                      {LR_ANSWERS.map((a) => (
                        <button key={a.value} disabled={saving === item.key}
                          style={item.answer === a.value ? { ...btn, borderColor: 'var(--role-color)', fontWeight: 600 } : btn}
                          onClick={() => answer(item.key, item.answer === a.value ? null : a.value)}>
                          {a.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {item.state !== 'on_file' && item.state !== 'in_review' && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 8 }}>
                      {item.key === 'healthcare_directive' && (
                        <select value={healthType} onChange={(e) => setHealthType(e.target.value)} style={{ ...btn, cursor: 'default' }}>
                          {LR_HEALTH_UPLOAD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      )}
                      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexBasis: '100%', fontSize: 13, lineHeight: 1.45, cursor: 'pointer' }}>
                        <input type="checkbox" checked={authority} onChange={(e) => setAuthority(e.target.checked)} style={{ width: 20, height: 20, marginTop: 1, flex: '0 0 auto' }} />
                        <span>I'm allowed to share this for {name}: they agreed, or I have legal authority to act for them (for example a power of attorney, healthcare agent or guardian).</span>
                      </label>
                      <button style={primaryBtn} disabled={uploadingKey === item.key || !authority}
                        onClick={() => fileRefs.current[item.key] && fileRefs.current[item.key].click()}>
                        {uploadingKey === item.key ? 'Uploading…' : 'Upload it'}
                      </button>
                      <input type="file" accept="application/pdf,image/jpeg,image/png" style={{ display: 'none' }}
                        ref={(el) => { fileRefs.current[item.key] = el; }}
                        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; upload(item, f); }} />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        <div style={{ borderTop: '1px solid var(--border-light, #eee)', paddingTop: 12, marginTop: 4 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Get help nearby</div>
          {!directory && (
            <button style={btn} disabled={dirLoading} onClick={loadDirectory}>{dirLoading ? 'Loading…' : 'Show attorneys, advisors and local agencies'}</button>
          )}
          {directory && <LegalResourceList directory={directory} />}
        </div>

        <div style={{ borderTop: '1px solid var(--border-light, #eee)', paddingTop: 12, marginTop: 12 }}>
          {!concernOpen && !concernResult && (
            <button style={btn} onClick={() => setConcernOpen(true)}>Worried about a scam or someone taking advantage?</button>
          )}
          {concernOpen && (
            <div>
              <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 6 }}>
                Tell us what you noticed. A person on the InPlace team will read it, and you'll see who to call right away.
              </div>
              <textarea value={concernText} onChange={(e) => setConcernText(e.target.value)} rows={4} maxLength={2000}
                placeholder={`For example: ${name} got a call asking for gift cards, or money is missing from an account.`}
                style={{ width: '100%', boxSizing: 'border-box', padding: 8, borderRadius: 6, border: '1px solid var(--border-light, #ddd)', fontSize: 14 }} />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button style={primaryBtn} disabled={concernSending} onClick={sendConcern}>{concernSending ? 'Sending…' : 'Send to InPlace'}</button>
                <button style={btn} onClick={() => setConcernOpen(false)}>Cancel</button>
              </div>
            </div>
          )}
          {concernResult && (
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Thank you &mdash; we've got it.</div>
              <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 6 }}>Someone on the InPlace team will read this. In the meantime, here's what helps most:</div>
              <ul style={{ fontSize: 13, lineHeight: 1.5, paddingLeft: 18, margin: '0 0 10px' }}>
                {concernResult.steps.map((s, i) => <li key={i} style={{ marginBottom: 4 }}>{s}</li>)}
              </ul>
              <LegalResourceList directory={concernResult.directory} only={['aps', 'elder_law', 'financial_advisor', 'other']} />
            </div>
          )}
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-tertiary, #777)', marginTop: 12 }}>{data.disclaimer}</div>
      </CollapsibleCard>
    </div>
  );
};
