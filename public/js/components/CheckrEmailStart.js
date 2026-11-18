// ─── The background check, by email (v1.131.0) ───
//
// Pete, 11/18: "fix caretaker's ability to do a background check as quickly as possible. make it
// clear there's an email form they have to do."
//
// The in-app Checkr form never loaded on the website: the page's security policy does not allow
// Checkr's script, so caregivers saw an empty box titled "unavailable in staging" — on
// production. Faith filled in everything InPlace asked, saw that, and reasonably stopped. Checkr
// was never contacted. The email invitation is hosted by Checkr, so it works everywhere, and this
// says plainly that it is a separate form she has to fill in.
//
// Props:
//   onSent()        — called after Checkr accepted the request; the parent re-reads
//                     /api/checkr/status so what shows next comes from the server, not from here.
//   staging         — staging only: lets the tester type the address Checkr should email.
const CheckrEmailStart = window.CheckrEmailStart = ({ onSent, staging }) => {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [testEmail, setTestEmail] = useState('');

  const send = async () => {
    setBusy(true); setErr(null);
    try {
      const body = {};
      if (staging && testEmail.trim()) body.checkrEmail = testEmail.trim();
      const res = await apiFetch('/api/checkr/initiate', { method: 'POST', body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error || 'Checkr could not be reached. Please try again in a minute.'); return; }
      if (typeof showToast === 'function') {
        showToast(data.sentTo ? `Checkr is emailing your form to ${data.sentTo}` : 'Checkr is emailing your form', 'success');
      }
      if (typeof onSent === 'function') onSent(data);
    } catch (e) {
      setErr('Checkr could not be reached. Please try again in a minute.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', marginBottom: 6 }}>
        {'✉️'} Your background check is a form Checkr emails you
      </div>
      <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        Checkr is the company InPlace uses for background checks. Tap the button and Checkr emails you
        a secure form. <strong>Your check does not start until you fill that form in.</strong>
      </p>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        On Checkr's form you'll give your Social Security number and agree to the check. That happens on
        Checkr's site, not here. There is nothing to pay Checkr.
      </p>
      {staging && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: 'var(--text-tertiary)', display: 'block', marginBottom: 4 }}>
            Staging only — the address Checkr should email (blank = account email without +tag):
          </label>
          <input type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)}
            style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
        </div>
      )}
      <button onClick={send} disabled={busy}
        style={{ padding: '10px 20px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1 }}>
        {busy ? 'Asking Checkr…' : 'Email me the Checkr form'}
      </button>
      {err && (
        <div style={{ marginTop: 10, fontSize: 13, color: 'var(--color-error)' }}>{err}</div>
      )}
    </div>
  );
};

// The "it's out, go fill it in" state, shared by Account and the hub. Only rendered when Checkr
// itself created the invitation (phase awaiting_caregiver = an invitation id Checkr returned).
const CheckrFormWaiting = window.CheckrFormWaiting = ({ sentTo, sentAt, invitationUrl }) => {
  const when = sentAt ? new Date(sentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
  return (
    <div style={{ padding: 14, background: 'var(--color-warning-bg, #fff8e1)', borderRadius: 8, border: '1px solid var(--color-warning)' }}>
      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 6 }}>
        Checkr's form is waiting for you
      </div>
      <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        Checkr emailed your background check form{sentTo ? <> to <strong>{sentTo}</strong></> : null}{when ? ` on ${when}` : ''}.
        {' '}Your check can't start until you fill it in. Look for an email from Checkr, and check spam too.
      </p>
      {invitationUrl && (
        <button onClick={() => (typeof openExternalUrl === 'function' ? openExternalUrl(invitationUrl) : window.open(invitationUrl, '_blank', 'noopener'))}
          style={{ padding: '8px 16px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          Open Checkr's form
        </button>
      )}
    </div>
  );
};
