// ─── "Verify your ID to see care" (v1.112.0) ───
//
// Pete, 10/12: "We should absolutely require someone to verify their ID before they are able to
// sign up for care." The server is the gate (src/utils/careAccess.js — every care-data route
// answers 403 ID_REQUIRED); this screen is what a person sees instead of a page full of errors.
//
// Calm and plain on purpose. Nobody here has done anything wrong: most are family members who
// signed up before the rule existed, or someone who just signed up and has not been checked
// yet. Say what is needed, who checks it, and what they can still do meanwhile.
//
// Two states, from /api/auth/me careAccess.status:
//   needs_id        nothing submitted (or the last one was not approved) → one button to verify
//   pending_review  submitted, waiting on a person → nothing to do; "check again" re-reads /me
const IdGateScreen = window.IdGateScreen = ({ user, onNavigate, onRefresh, onCaregiverSetup }) => {
  const [checking, setChecking] = useState(false);
  const { showToast } = useToast();
  const access = user?.careAccess || {};
  const waiting = access.status === 'pending_review';
  const rejected = !waiting && user?.identityStatus === 'rejected';
  const roles = user?.roles || [user?.role];
  const caregiverSetupOpen = roles.includes('caregiver') && user?.onboardingComplete === false && typeof onCaregiverSetup === 'function';

  const goVerify = () => {
    // MyAccount opens its identity card when it sees this (same handshake AttentionCard uses).
    window.__pendingFocus = 'identity';
    if (onNavigate) onNavigate('account');
    setTimeout(() => window.dispatchEvent(new Event('inplace:focus')), 0);
  };

  const checkAgain = async () => {
    if (!onRefresh) return;
    setChecking(true);
    try {
      const ok = await onRefresh();
      if (ok === false) showToast('Could not check right now. Please try again in a moment.', 'error');
    } catch {
      showToast('Could not check right now. Please try again in a moment.', 'error');
    } finally {
      setChecking(false);
    }
  };

  const wrap = { maxWidth: 520, margin: '40px auto', padding: '0 16px' };
  const card = { background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 16, padding: '28px 24px', textAlign: 'center' };
  const primary = { background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 10, padding: '12px 22px', fontSize: 15, fontWeight: 600, cursor: 'pointer', width: '100%', marginTop: 8 };
  const secondary = { background: 'none', border: '1px solid var(--border-light)', color: 'var(--text-secondary)', borderRadius: 10, padding: '10px 18px', fontSize: 14, cursor: 'pointer', width: '100%', marginTop: 10 };

  return (
    <div style={wrap}>
      <div style={card} data-testid="id-gate">
        <div style={{ fontSize: 40, marginBottom: 8 }} aria-hidden="true">{waiting ? '⏳' : '\u{1F464}'}</div>
        <h2 style={{ margin: '0 0 10px', fontSize: 22, color: 'var(--text-primary)' }}>
          {waiting ? 'Your ID is waiting for review' : 'Verify your ID to see care'}
        </h2>
        {waiting ? (
          <p style={{ margin: '0 0 6px', color: 'var(--text-secondary)', fontSize: 15, lineHeight: 1.6 }}>
            Thank you. A person on the InPlace team looks at every ID. As soon as yours is approved,
            your care team, messages and visits will be here. We'll let you know.
          </p>
        ) : (
          <p style={{ margin: '0 0 6px', color: 'var(--text-secondary)', fontSize: 15, lineHeight: 1.6 }}>
            To keep everyone's care private, InPlace asks every account for a photo ID and a selfie.
            A person on our team checks it — then your care team, messages and visits are here.
          </p>
        )}
        {rejected && (
          <p style={{ margin: '8px 0 0', color: 'var(--color-warning)', fontSize: 14, lineHeight: 1.5 }}>
            Your last photo couldn't be approved. A clear, readable photo of your ID usually does it.
          </p>
        )}

        {caregiverSetupOpen && (
          <button style={primary} onClick={() => onCaregiverSetup()}>Continue caregiver setup</button>
        )}
        {!waiting && !caregiverSetupOpen && (
          <button style={primary} onClick={goVerify}>Verify my ID</button>
        )}
        {waiting && (
          <button style={primary} onClick={checkAgain} disabled={checking}>
            {checking ? 'Checking…' : 'Check again'}
          </button>
        )}
        <button style={secondary} onClick={() => onNavigate && onNavigate('account')}>Go to My Account</button>

        <p style={{ margin: '18px 0 0', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5 }}>
          While you wait you can still sign in, update your profile and get help.
          If someone invited you to a care team, the invitation will still be there once you're verified.
        </p>
      </div>
    </div>
  );
};
