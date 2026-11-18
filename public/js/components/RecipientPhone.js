// ─── The care recipient's own phone (v1.129.4) ───
//
// Pete, 11/17, holding Betty's phone for one night: "I want to put inplace on her phone for her
// to be able to use. preferably while in accessibility mode."
//
// OwnLoginSetup — the team leader gives the person they care for a sign-in of their own,
// linked to the profile the family already built. An email and a password the leader picks,
// typed into the recipient's phone. No invite email to fish out, no registration wizard.

const OwnLoginSetup = window.OwnLoginSetup = ({ recipientId, firstName, onDone }) => {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null);
  const name = firstName || 'them';

  const pwOk = password.length >= 8 && /[A-Z]/.test(password) && /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password);

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !pwOk) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/care-recipients/${recipientId}/own-login`, {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res?.json().catch(() => ({}));
      if (res?.ok) {
        setDone({ email: data.email || email.trim() });
        setPassword('');
        showToast(`${name}'s sign-in is ready`, 'success');
      } else {
        showToast(data?.error || 'Could not set up the sign-in', 'error');
      }
    } catch { showToast('Could not set up the sign-in', 'error'); }
    setSaving(false);
  };

  const box = { marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid var(--border-light, #f0f0f0)' };
  const input = { width: '100%', padding: '10px 12px', border: '1px solid #d0d0d0', borderRadius: 8, fontSize: 15, fontFamily: 'inherit', boxSizing: 'border-box' };

  if (done) {
    return (
      <div style={box}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--role-color)', marginBottom: 6 }}>{name}'s own sign-in is ready</div>
        <ol style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px', paddingLeft: 18, lineHeight: 1.6 }}>
          <li>On {name}'s phone, open InPlace and sign in as <strong>{done.email}</strong> with the password you chose. Leave "Remember me" on.</li>
          <li>Tap <strong>Allow</strong> when the phone asks about notifications.</li>
          <li>{name} sees care once an ID is approved, or once an admin marks the ID as seen in person.</li>
        </ol>
        <button onClick={() => onDone && onDone()} style={{ padding: '8px 16px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div style={box}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--role-color)', marginBottom: 6 }}>{name}'s own sign-in</div>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.5 }}>
        Put InPlace on {name}'s phone. You choose the email and password, and the sign-in opens {name}'s own view of this profile. It can't book care or spend money.
      </p>
      {!open ? (
        <button onClick={() => setOpen(true)} style={{ padding: '10px 18px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
          Set up {name}'s sign-in
        </button>
      ) : (
        <form onSubmit={submit}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Email for {name}'s account</label>
          <input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="an address you can open" style={{ ...input, marginBottom: 10 }} />
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Password</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
            <input type={showPw ? 'text' : 'password'} autoComplete="new-password" value={password}
              onChange={(e) => setPassword(e.target.value)} style={{ ...input, flex: 1 }} />
            <button type="button" onClick={() => setShowPw(!showPw)} style={{ padding: '0 12px', background: 'var(--bg-surface)', border: '1px solid #d0d0d0', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
              {showPw ? 'Hide' : 'Show'}
            </button>
          </div>
          <div style={{ fontSize: 12, color: pwOk || !password ? 'var(--text-muted)' : 'var(--accent-color)', marginBottom: 12 }}>
            8 or more characters, with an uppercase letter, a number and a symbol.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" disabled={saving || !email.trim() || !pwOk} style={{ padding: '10px 18px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer', opacity: (saving || !email.trim() || !pwOk) ? 0.6 : 1 }}>
              {saving ? 'Setting up…' : 'Create sign-in'}
            </button>
            <button type="button" onClick={() => setOpen(false)} style={{ padding: '10px 18px', background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid #d0d0d0', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
