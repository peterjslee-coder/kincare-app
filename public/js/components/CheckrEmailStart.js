// ─── The background check: ask → InPlace approves → Checkr's form (v1.131.0, v1.132.0) ───
//
// v1.131.0 — the in-app Checkr embed never loaded on the website (the page's security policy
// does not allow Checkr's script), so caregivers saw an empty box and nobody was ever sent to
// Checkr. Checkr hosts its own form, which works everywhere.
//
// v1.132.0 — Pete, 11/18: "I don't want them to pay the $30 upfront ... a needs you card for
// Admin where I approve them to go get a background check." So the caregiver ASKS, an admin
// approves, and only then does Checkr send its form — with the details InPlace already has
// (name, date of birth, email, phone, ZIP) filled in. Agreeing in onboarding is the ask; this
// button is for anyone who didn't.

const ckrDate = (t, withTime) => {
  if (!t) return null;
  try {
    return new Date(t).toLocaleString('en-US', withTime
      ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
      : { month: 'short', day: 'numeric' });
  } catch { return null; }
};

// Not asked yet.
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
      if (!res.ok) { setErr(data.error || 'That didn’t go through. Please try again in a minute.'); return; }
      if (typeof showToast === 'function') {
        showToast(data.status === 'requested'
          ? 'Sent to InPlace. You’ll get a notification when it’s approved.'
          : (data.sentTo ? `Checkr is emailing your form to ${data.sentTo}` : 'Checkr is emailing your form'), 'success');
      }
      if (typeof onSent === 'function') onSent(data);
    } catch (e) {
      setErr('That didn’t go through. Please try again in a minute.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', marginBottom: 6 }}>
        Ready for your background check?
      </div>
      <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        InPlace pays for it. There{'’'}s nothing to pay, today or later.
      </p>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        Tap below and we{'’'}ll let InPlace know. Once it{'’'}s approved, Checkr {'—'} the company
        InPlace uses for background checks {'—'} sends you a secure form with your name and details
        already filled in. You add your Social Security number, past addresses and your OK for the check
        on Checkr{'’'}s form. <strong>Your check doesn{'’'}t start until you finish that form.</strong>
      </p>
      <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
        By tapping, you authorize InPlace to obtain a background check about you through Checkr.
        Checkr shows you its full disclosure and asks for your agreement before anything is run.
      </p>
      {staging && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: 'var(--text-tertiary)', display: 'block', marginBottom: 4 }}>
            Staging only {'—'} the address Checkr should email (blank = account email without +tag):
          </label>
          <input type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)}
            style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
        </div>
      )}
      <button onClick={send} disabled={busy}
        style={{ padding: '10px 20px', minHeight: 44, background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1 }}>
        {busy ? 'Sending…' : (staging ? 'Send me the Checkr form (staging)' : 'I’m ready — ask InPlace to start it')}
      </button>
      {err && (
        <div style={{ marginTop: 10, fontSize: 13, color: 'var(--color-error)' }}>{err}</div>
      )}
    </div>
  );
};

// Asked; waiting on an admin.
const CheckrAwaitingApproval = window.CheckrAwaitingApproval = ({ requestedAt }) => (
  <div style={{ padding: 14, background: 'var(--bg-neutral)', borderRadius: 8, border: '1px solid var(--border-color)' }}>
    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 6 }}>
      Waiting for InPlace to approve
    </div>
    <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
      {requestedAt ? `You asked on ${ckrDate(requestedAt)}. ` : ''}We{'’'}ll send you a notification the moment
      it{'’'}s approved. You don{'’'}t need to do anything until then, and there{'’'}s nothing to pay.
    </p>
  </div>
);

// Approved, and Checkr created the invitation (an id Checkr returned): her form is waiting.
const CheckrFormWaiting = window.CheckrFormWaiting = ({ sentTo, sentAt, invitationUrl, approvedAt, details }) => {
  const f = (details && details.fields) || {};
  const rows = [
    ['Legal name', f.legalName], ['Date of birth', f.dateOfBirth], ['Email', f.email || sentTo],
    ['Phone', f.phone], ['ZIP', f.zip],
  ].filter(([, v]) => !!v);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {approvedAt && (
        <div style={{ padding: '10px 12px', background: 'var(--color-success-bg, #e7f3ef)', borderRadius: 8, fontSize: 13, fontWeight: 600, color: 'var(--color-success)' }}>
          {'✓'} Approved by InPlace {ckrDate(approvedAt, true)}
        </div>
      )}
      <div style={{ padding: 14, background: 'var(--color-warning-bg, #fff8e1)', borderRadius: 8, border: '1px solid var(--color-warning)' }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 6 }}>
          Checkr{'’'}s form is waiting for you
        </div>
        <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Checkr sent your background check form{sentTo ? <> to <strong>{sentTo}</strong></> : null}{sentAt ? ` on ${ckrDate(sentAt)}` : ''}.
          {' '}Your check can{'’'}t start until you finish it.
        </p>
        {rows.length > 0 && (
          <div style={{ margin: '0 0 12px', padding: '10px 12px', background: 'var(--bg-surface)', borderRadius: 8, fontSize: 13 }}>
            <div style={{ fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>Already filled in from your InPlace profile</div>
            {rows.map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: 8, lineHeight: 1.7 }}>
                <span style={{ color: 'var(--text-tertiary)', minWidth: 96 }}>{k}</span>
                <span style={{ color: 'var(--text-primary)' }}>{v}</span>
              </div>
            ))}
            <div style={{ color: 'var(--text-tertiary)', marginTop: 6 }}>On Checkr{'’'}s form you add your Social Security number, past addresses and your OK. InPlace never sees your Social Security number.</div>
          </div>
        )}
        {invitationUrl ? (
          <button onClick={() => (typeof openExternalUrl === 'function' ? openExternalUrl(invitationUrl) : window.open(invitationUrl, '_blank', 'noopener'))}
            style={{ padding: '10px 18px', minHeight: 44, background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            Continue to Checkr{'’'}s form
          </button>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Look for an email from Checkr, and check spam too.</div>
        )}
      </div>
    </div>
  );
};
