// ─── Admin → Local Help (v1.110, migration 051_legal_readiness) ───
//
// Two things Pete keeps by hand:
//   · the "Get help nearby" directory families see. Seeded with public, institutional entries
//     only; local firms and advisors are added here, one at a time, by a person. Nobody pays
//     to be listed.
//   · money-safety concerns: families' own reports, and resources shared from a flag.
//
// Plus ShareFinancialResourcesButton, rendered by SafetyFlagsTab on exploitation_signal flags.
// Sharing is the ONLY way a flag reaches a family, and the family sees resources, never the
// message or who wrote it.

const LRA_KINDS = ['elder_law', 'financial_advisor', 'aps', 'aaa', 'legal_aid', 'other'];
const LRA_EMPTY = { kind: 'elder_law', name: '', phone: '', url: '', region_key: '', notes: '' };

const lraErr = async (res, fallback) => {
  const d = res ? await res.json().catch(() => ({})) : {};
  return d.error || fallback;
};

const LegalReadinessAdminTab = window.LegalReadinessAdminTab = ({ apiFetch, showToast }) => {
  const [resources, setResources] = React.useState(null);
  const [concerns, setConcerns] = React.useState(null);
  const [form, setForm] = React.useState(LRA_EMPTY);
  const [editingId, setEditingId] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  const load = async () => {
    try {
      const [r, c] = await Promise.all([
        apiFetch('/api/admin/legal-readiness/resources'),
        apiFetch('/api/admin/legal-readiness/concerns'),
      ]);
      if (r?.ok) setResources((await r.json()).resources || []);
      else showToast(await lraErr(r, 'Failed to load resources'), 'error');
      if (c?.ok) setConcerns((await c.json()).concerns || []);
      else showToast(await lraErr(c, 'Failed to load concerns'), 'error');
    } catch {
      showToast('Failed to load Local Help', 'error');
    }
  };
  React.useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true);
    try {
      const body = { ...form, region_key: form.region_key || 'VA' };
      const res = await apiFetch(editingId ? `/api/admin/legal-readiness/resources/${editingId}` : '/api/admin/legal-readiness/resources', {
        method: editingId ? 'PUT' : 'POST', body: JSON.stringify(body),
      });
      if (res?.ok) {
        showToast(editingId ? 'Listing updated' : 'Listing added', 'success');
        setForm(LRA_EMPTY); setEditingId(null); load();
      } else {
        showToast(await lraErr(res, 'Failed to save listing'), 'error');
      }
    } catch {
      showToast('Failed to save listing', 'error');
    }
    setBusy(false);
  };

  const setActive = async (r, active) => {
    try {
      const res = active
        ? await apiFetch(`/api/admin/legal-readiness/resources/${r.id}`, { method: 'PUT', body: JSON.stringify({ is_active: 1 }) })
        : await apiFetch(`/api/admin/legal-readiness/resources/${r.id}`, { method: 'DELETE' });
      if (res?.ok || res?.status === 409) load();
      else showToast(await lraErr(res, 'Failed to update listing'), 'error');
    } catch {
      showToast('Failed to update listing', 'error');
    }
  };

  const setConcernStatus = async (c, status) => {
    try {
      const res = await apiFetch(`/api/admin/legal-readiness/concerns/${c.id}`, { method: 'PUT', body: JSON.stringify({ status }) });
      if (res?.ok || res?.status === 409) load();
      else showToast(await lraErr(res, 'Failed to update concern'), 'error');
    } catch {
      showToast('Failed to update concern', 'error');
    }
  };

  const input = { padding: 8, border: '1px solid #ddd', borderRadius: 6, fontSize: 13, width: '100%', boxSizing: 'border-box' };
  const btn = { padding: '6px 12px', borderRadius: 6, border: '1px solid #ddd', background: 'var(--bg-primary)', fontSize: 12, cursor: 'pointer' };
  const ed = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div>
      <div className="card">
        <div className="card-header">Money-safety concerns</div>
        {concerns === null ? <div style={{ fontSize: 13 }}>Loading&hellip;</div>
          : concerns.length === 0 ? <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>None yet.</div>
          : concerns.map((c) => (
            <div key={c.id} style={{ borderTop: '1px solid #eee', padding: '8px 0', fontSize: 13 }}>
              <div style={{ fontWeight: 600 }}>
                {[c.recipient_first, c.recipient_last].filter(Boolean).join(' ')} &middot; {c.source === 'family_report' ? 'Family report' : 'Shared from a safety flag'} &middot; {c.status}
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                {c.source === 'family_report'
                  ? `From ${[c.reporter_first, c.reporter_last].filter(Boolean).join(' ') || c.reporter_email || 'a family member'}`
                  : `Shared with ${[c.shared_first, c.shared_last].filter(Boolean).join(' ') || 'the leader'}${c.acknowledged_at ? ' · seen' : ' · not seen yet'}`}
                {' · '}{new Date(c.created_at).toLocaleString()}
              </div>
              {c.description && <div style={{ marginTop: 4, padding: 8, background: 'var(--bg-primary)', borderRadius: 6 }}>{c.description}</div>}
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                {['open', 'reviewed', 'closed'].filter((s) => s !== c.status).map((s) => (
                  <button key={s} style={btn} onClick={() => setConcernStatus(c, s)}>Mark {s}</button>
                ))}
              </div>
            </div>
          ))}
      </div>

      <div className="card">
        <div className="card-header">{editingId ? 'Edit listing' : 'Add a listing'}</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.5 }}>
          Region is a Virginia county or city as families' addresses would name it (e.g. "Montgomery County", "Radford city", "Blacksburg"), several separated by ";", or "VA" for statewide, "US" for national. Families see up to three per kind, local first. InPlace doesn't receive payment for these listings &mdash; don't add anyone who pays or refers for a fee.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
          <select value={form.kind} onChange={ed('kind')} style={input}>
            {LRA_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input style={input} placeholder="Name" value={form.name} onChange={ed('name')} />
          <input style={input} placeholder="Phone" value={form.phone || ''} onChange={ed('phone')} />
          <input style={input} placeholder="https://..." value={form.url || ''} onChange={ed('url')} />
          <input style={input} placeholder="Region (VA)" value={form.region_key || ''} onChange={ed('region_key')} />
          <input style={input} placeholder="Notes families will see" value={form.notes || ''} onChange={ed('notes')} />
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <button style={{ ...btn, background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', fontWeight: 600 }} disabled={busy} onClick={save}>{editingId ? 'Save' : 'Add listing'}</button>
          {editingId && <button style={btn} onClick={() => { setEditingId(null); setForm(LRA_EMPTY); }}>Cancel</button>}
        </div>
      </div>

      <div className="card">
        <div className="card-header">Directory</div>
        {resources === null ? <div style={{ fontSize: 13 }}>Loading&hellip;</div> : resources.map((r) => (
          <div key={r.id} style={{ borderTop: '1px solid #eee', padding: '8px 0', fontSize: 13, opacity: r.is_active ? 1 : 0.5 }}>
            <div style={{ fontWeight: 600 }}>{r.name} <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>&middot; {r.kind} &middot; {r.region_key}</span></div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{[r.phone, r.url].filter(Boolean).join(' · ')}</div>
            {r.source_url && <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Verified against {r.source_url}</div>}
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <button style={btn} onClick={() => { setEditingId(r.id); setForm({ kind: r.kind, name: r.name, phone: r.phone || '', url: r.url || '', region_key: r.region_key || '', notes: r.notes || '' }); }}>Edit</button>
              <button style={btn} onClick={() => setActive(r, !r.is_active)}>{r.is_active ? 'Hide' : 'Show'}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Rendered on an exploitation_signal flag card in SafetyFlagsTab.
const ShareFinancialResourcesButton = window.ShareFinancialResourcesButton = ({ flag, apiFetch, showToast }) => {
  const [open, setOpen] = React.useState(false);
  const [info, setInfo] = React.useState(null);
  const [busy, setBusy] = React.useState(null);

  const openPicker = async () => {
    setOpen(true);
    try {
      const res = await apiFetch(`/api/admin/legal-readiness/safety-flags/${flag.id}/recipients`);
      if (res?.ok) setInfo(await res.json());
      else showToast(await lraErr(res, 'Failed to load care recipients'), 'error');
    } catch {
      showToast('Failed to load care recipients', 'error');
    }
  };

  const share = async (r) => {
    setBusy(r.id);
    try {
      const res = await apiFetch(`/api/admin/legal-readiness/safety-flags/${flag.id}/share`, {
        method: 'POST', body: JSON.stringify({ careRecipientId: r.id }),
      });
      if (res?.ok || res?.status === 409) {
        showToast(res.ok ? `Shared with ${r.name}'s family leader` : 'Already shared with that family', 'success');
        setInfo((prev) => prev ? { ...prev, recipients: prev.recipients.map((x) => x.id === r.id ? { ...x, alreadyShared: true } : x) } : prev);
      } else {
        showToast(await lraErr(res, 'Failed to share'), 'error');
      }
    } catch {
      showToast('Failed to share', 'error');
    }
    setBusy(null);
  };

  const btn = { padding: '6px 12px', borderRadius: 6, border: '1px solid #ddd', background: 'var(--bg-primary)', fontSize: 12, cursor: 'pointer' };
  if (!open) return <button style={btn} onClick={openPicker}>Share financial-safety resources with the family</button>;
  return (
    <div style={{ width: '100%', padding: 10, border: '1px solid #eee', borderRadius: 8, fontSize: 13 }}>
      <div style={{ marginBottom: 6, lineHeight: 1.5 }}>
        The family leader gets a calm card with Adult Protective Services, local attorneys and advisors, and next steps. They never see this message or who wrote it.
      </div>
      {!info ? <div>Loading&hellip;</div> : info.recipients.length === 0 ? <div>No care recipients are connected to this conversation.</div> : info.recipients.map((r) => (
        <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
          <span>{r.name}</span>
          {r.alreadyShared ? <span style={{ color: 'var(--text-tertiary)' }}>Shared</span>
            : <button style={btn} disabled={busy === r.id} onClick={() => share(r)}>{busy === r.id ? 'Sharing…' : 'Share'}</button>}
        </div>
      ))}
      <button style={{ ...btn, marginTop: 6 }} onClick={() => setOpen(false)}>Close</button>
    </div>
  );
};
