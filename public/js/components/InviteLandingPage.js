const InviteLandingPage = window.InviteLandingPage = ({ inviteInfo, onNavigate }) => {
  // Dedicated landing page for care team invite links
  // Shows focused invite context instead of generic splash page

  const loaded = !!inviteInfo;
  const recipientName = inviteInfo?.recipientName || 'your loved one';
  const inviterName = inviteInfo?.inviterName || 'A family member';
  const teamName = inviteInfo?.teamName || `${recipientName}'s Care Team`;
  const role = inviteInfo?.role || 'member';

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #f0faf8 0%, #fff 40%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '0 16px',
    }}>
      {/* Header */}
      <div style={{ padding: '24px 0 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <InPlaceIcon width={36} height={36} />
        <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '24px', letterSpacing: '-1px' }}>
          <span style={{ fontWeight: 200, color: 'var(--text-muted)' }}>in</span>
          <span style={{ fontWeight: 800, color: 'var(--role-color)' }}>Place</span>
        </span>
      </div>

      {/* Main Card */}
      <div style={{
        maxWidth: '440px', width: '100%', marginTop: '24px',
        background: 'var(--bg-surface)', borderRadius: '16px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
        overflow: 'hidden',
      }}>
        {/* Green banner */}
        <div style={{
          background: 'linear-gradient(135deg, #1b6b5a 0%, #2a8f7a 100%)',
          padding: '28px 24px', textAlign: 'center', color: 'var(--text-on-primary)',
        }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>👋</div>
          <h1 style={{ margin: '0 0 8px', fontSize: '22px', fontWeight: 700, lineHeight: 1.3 }}>
            {loaded ? `${inviterName} invited you to join` : 'You\'ve been invited to join a Care Team'}
          </h1>
          {loaded && (
            <div style={{ fontSize: '20px', fontWeight: 800, marginTop: '4px' }}>
              {teamName}
            </div>
          )}
        </div>

        {/* Content */}
        <div style={{ padding: '24px' }}>
          {loaded ? (
            <div>
              <p style={{ fontSize: '15px', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 8px' }}>
                As a care team <strong>{role}</strong>, you'll be able to:
              </p>
              <div style={{ margin: '16px 0 24px' }}>
                {[
                  { icon: '📅', text: 'View and manage care schedules' },
                  { icon: '💬', text: 'Message the care team directly' },
                  { icon: '📋', text: `See ${recipientName}'s care profile and notes` },
                  { icon: '🔔', text: 'Get updates on care activities' },
                ].map((item, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    padding: '10px 0', borderBottom: i < 3 ? '1px solid #f0f0f0' : 'none',
                  }}>
                    <span style={{ fontSize: '20px' }}>{item.icon}</span>
                    <span style={{ fontSize: '14px', color: 'var(--text-primary)' }}>{item.text}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Loading invite details...</div>
            </div>
          )}

          {/* CTAs */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <button onClick={() => onNavigate('register')} style={{
              width: '100%', padding: '14px', background: 'var(--role-color)', color: 'var(--bg-card)',
              border: 'none', borderRadius: '10px', fontSize: '16px', fontWeight: 700,
              cursor: 'pointer', transition: 'background 0.2s',
            }}>
              Create Account & Join
            </button>
            <button onClick={() => onNavigate('login')} style={{
              width: '100%', padding: '14px', background: 'var(--bg-surface)', color: 'var(--role-color)',
              border: '2px solid #1b6b5a', borderRadius: '10px', fontSize: '16px', fontWeight: 700,
              cursor: 'pointer', transition: 'background 0.2s',
            }}>
              I Already Have an Account
            </button>
          </div>

          {inviteInfo?.email && (
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', marginTop: '16px', marginBottom: 0 }}>
              This invite was sent to <strong>{inviteInfo.email}</strong>
            </p>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ marginTop: '32px', paddingBottom: '32px', textAlign: 'center' }}>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
          InPlace — On-demand care coordination for your loved ones
        </p>
      </div>
    </div>
  );
};
