// ─── The visit report (v1.108.0) ───
//
// Pete, 9/16: "I want to know meals eaten, bathed, appointment made, any mobility concerns."
// Two halves:
//   · VisitReportForm — inside the caregiver's check-out. One row per question, one tap per
//     row, "Didn't come up" is a tap. Follow-ups from the last report sit on the row they are
//     about. The server decides the rows (routes/sessions.js GET /:id/visit-report/form).
//   · VisitReportCard — what the family reads on the visit sheet: the answers by group, the
//     concerns in red, and what changed since the last report.
//
// It records what she saw. It never advises (feedback_ai_medical_guidance_rule).


/** Answers → the array the check-out endpoint takes. */
const visitReportPayload = window.visitReportPayload = (form, answers) => {
  if (!form) return null;
  const out = [];
  for (const g of form.groups || []) {
    for (const r of g.rows || []) {
      const a = answers[r.key];
      if (a && a.value) out.push({ topic: r.topic, ref: r.ref, value: a.value, note: a.note || undefined });
    }
  }
  return out;
};

/** Labels of the rows still unanswered. */
const visitReportMissing = window.visitReportMissing = (form, answers) => {
  if (!form) return [];
  const missing = [];
  for (const g of form.groups || []) {
    for (const r of g.rows || []) if (!(answers[r.key] && answers[r.key].value)) missing.push(r);
  }
  return missing;
};

/** Initial answers: doses she already checked off are filled in, so she never answers twice. */
const visitReportInitial = window.visitReportInitial = (form) => {
  const init = {};
  for (const g of (form && form.groups) || []) {
    for (const r of g.rows || []) if (r.prefill) init[r.key] = { value: r.prefill, note: '' };
  }
  return init;
};

const VisitReportForm = window.VisitReportForm = ({ form, answers, onChange, showMissing }) => {
  const [openNote, setOpenNote] = useState({});
  if (!form) return null;
  const set = (row, patch) => onChange({ ...answers, [row.key]: { ...(answers[row.key] || {}), ...patch } });
  const missing = new Set(visitReportMissing(form, answers).map((r) => r.key));
  const total = form.rowCount || 0;
  const done = total - missing.size;

  return (
    <div data-testid="visit-report-form" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Visit report</div>
        <div style={{ fontSize: 12, color: missing.size ? 'var(--text-tertiary)' : 'var(--color-success)', fontWeight: 600 }}>
          {done} of {total}
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12 }}>
        One tap per row. If it didn{'’'}t come up, tap that {'—'} it helps the family as much as an answer.
      </div>

      {form.groups.map((g) => (
        <div key={g.id} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 6px' }}>{g.label}</div>
          {g.rows.map((r) => {
            const a = answers[r.key] || {};
            const flag = showMissing && missing.has(r.key);
            const chosen = r.options.find((o) => o.value === a.value);
            const noteOpen = openNote[r.key] || !!a.note || (chosen && chosen.concern);
            return (
              <div key={r.key} data-report-row={r.key} style={{
                padding: '10px 12px', borderRadius: 10, marginBottom: 8,
                border: `1.5px solid ${flag ? 'var(--color-error)' : 'var(--border-color)'}`,
                background: 'var(--bg-card)',
              }}>
                {r.followUp && (
                  <div style={{ fontSize: 12, color: 'var(--role-color)', background: 'var(--role-color-light)', borderRadius: 8, padding: '6px 8px', marginBottom: 8 }}>
                    {'↻'} {r.followUp}
                  </div>
                )}
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
                  {r.label}
                  {r.alreadyRecorded && <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-tertiary)' }}> {'·'} already checked off</span>}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {r.options.map((o) => {
                    const on = a.value === o.value;
                    const tone = o.concern ? 'var(--color-error)' : o.value === 'na' ? 'var(--text-tertiary)' : 'var(--role-color)';
                    return (
                      <button key={o.value} type="button" onClick={() => set(r, { value: o.value })} style={{
                        minHeight: 36, padding: '6px 12px', borderRadius: 18, cursor: 'pointer', fontSize: 13,
                        border: on ? `2px solid ${tone}` : '1px solid var(--border-color)',
                        background: on ? (o.concern ? 'var(--color-error-bg)' : 'var(--role-color-light)') : 'var(--bg-surface)',
                        color: on ? tone : 'var(--text-secondary)', fontWeight: on ? 700 : 500,
                      }}>{o.label}</button>
                    );
                  })}
                </div>
                {noteOpen ? (
                  <input value={a.note || ''} onChange={(e) => set(r, { note: e.target.value })}
                    placeholder={chosen && chosen.concern ? 'What happened? (helps the family)' : 'Add a detail (optional)'}
                    maxLength={500}
                    style={{ width: '100%', marginTop: 8, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-color)', fontSize: 13, background: 'var(--bg-surface)', color: 'var(--text-primary)', boxSizing: 'border-box' }} />
                ) : (
                  <button type="button" onClick={() => setOpenNote({ ...openNote, [r.key]: true })} style={{
                    marginTop: 6, padding: 0, border: 'none', background: 'none', color: 'var(--text-tertiary)', fontSize: 12, cursor: 'pointer',
                  }}>+ add a detail</button>
                )}
                {flag && <div style={{ fontSize: 12, color: 'var(--color-error)', marginTop: 6 }}>Tap an answer {'—'} or {'“'}Didn{'’'}t come up{'”'}.</div>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};

const VisitReportCard = window.VisitReportCard = ({ report, summaryText }) => {
  if (!report && !summaryText) return null;
  return (
    <div data-testid="visit-report-card" style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
        Visit report
        {report && report.concerns > 0 && (
          <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: 'var(--color-error)', background: 'var(--color-error-bg)', padding: '2px 8px', borderRadius: 10 }}>
            {report.concerns} to look at
          </span>
        )}
      </div>
      {summaryText && (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.45, marginBottom: 10 }}>{summaryText}</div>
      )}
      {report && report.groups.map((g) => (
        <div key={g.id} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{g.label}</div>
          {g.items.map((i) => (
            <div key={`${i.topic}|${i.ref}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '5px 0', borderBottom: '1px solid var(--border-light)' }}>
              <div style={{ fontSize: 13, color: 'var(--text-primary)', minWidth: 0 }}>
                {i.label}
                {i.note && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{i.note}</div>}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: i.concern ? 700 : 600,
                  color: i.concern ? 'var(--color-error)' : i.skipped ? 'var(--text-tertiary)' : 'var(--text-primary)',
                }}>{i.answer}</div>
                {i.changedFrom && <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>last visit: {i.changedFrom}</div>}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};
