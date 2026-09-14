// ─── Who a caregiver actually is (v1.106.29) ───
//
// Pete: "Are you gonna be some sort of social Page or something for caregivers that allows
// people to peruse that person's background. Like if I click on Tina, I should see that she's
// in Christiansburg. She has six years of experience and she's highly rated or whatever.
// There should be a spot where she has a paragraph about me kind of thing like I work with
// special needs kids or I have a lot of experience with dementia patients."
//
// Almost all of this was already on the server. GET /api/caregivers/:id has returned bio,
// years, specialties, certifications, rating, review count, city and completed-session count
// for a long time, along with the last ten reviews. What did not exist was anywhere to LOOK at
// it: the list card showed a 120-character slice of the bio and nothing was tappable, so the
// paragraph she wrote during signup was never read by anyone.
//
// What this page deliberately does NOT show, though the endpoint returns them: coordinates,
// phone number, and her rate breakdown. A browsing family does not need where she lives or
// how to ring her — that comes with a booking. Rates belong to the offer, where they are
// quoted against a specific visit.
const CaregiverProfilePage = window.CaregiverProfilePage = ({ caregiverId, onNavigate }) => {
  const [data, setData] = React.useState(null);
  const [failed, setFailed] = React.useState(false);
  const [showAllReviews, setShowAllReviews] = React.useState(false);

  React.useEffect(() => {
    if (!caregiverId) { setFailed(true); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/caregivers/${caregiverId}`);
        if (cancelled) return;
        if (!res?.ok) { setFailed(true); return; }
        setData(await res.json());
      } catch { if (!cancelled) setFailed(true); }
    })();
    return () => { cancelled = true; };
  }, [caregiverId]);

  const back = () => onNavigate && onNavigate('caregivers');

  if (failed) {
    return (
      <div className="card" style={{ margin: 16 }}>
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 12 }}>
          Couldn{'’'}t load that profile.
        </div>
        <button onClick={back} style={{
          minHeight: 44, padding: '0 16px', borderRadius: 10, border: '1px solid var(--border-color)',
          background: 'var(--bg-card)', color: 'var(--text-primary)', font: 'inherit', fontWeight: 600, cursor: 'pointer',
        }}>Back</button>
      </div>
    );
  }

  if (!data) return <LoadingSpinner text="Loading profile…" />;

  const cg = data.caregiver || {};
  const reviews = data.reviews || [];
  const shown = showAllReviews ? reviews : reviews.slice(0, 3);
  const where = [cg.city, cg.state].filter(Boolean).join(', ');
  const initials = (cg.name || '?').split(' ').map((n) => n[0]).filter(Boolean).slice(0, 2).join('');

  const chip = (text, key) => (
    <span key={key} style={{
      fontSize: 12, fontWeight: 600, padding: '5px 11px', borderRadius: 14,
      background: 'var(--bg-accent-light)', color: 'var(--role-color)',
    }}>{text}</span>
  );

  // A stat with no value is not a zero, it is a blank — "0 years experience" reads as a
  // judgement about her rather than an absence in our data.
  const stat = (value, label, key) => (value === null || value === undefined || value === '') ? null : (
    <div key={key} style={{ textAlign: 'center', minWidth: 76 }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{label}</div>
    </div>
  );

  return (
    <div style={{ padding: '0 0 24px' }}>
      <button onClick={back} style={{
        background: 'none', border: 'none', padding: '4px 0 10px', font: 'inherit',
        fontSize: 14, fontWeight: 600, color: 'var(--role-color)', cursor: 'pointer',
      }}>{'←'} Back</button>

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          {cg.photoUrl ? (
            <img src={cg.photoUrl} alt={cg.name}
              style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
          ) : (
            <div style={{
              width: 72, height: 72, borderRadius: '50%', background: 'var(--role-color)',
              color: 'var(--text-on-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 24, fontWeight: 700, flexShrink: 0,
            }}>{initials}</div>
          )}
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>{cg.name}</div>
            {where && (
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                {'📍'} {where}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {cg.isBackgroundChecked && (
                <span style={{
                  fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 12,
                  background: 'var(--color-success-bg)', color: 'var(--color-success)',
                }}>{'✓'} Background checked</span>
              )}
              {/* An admin vouch is scoped to ONE family (v1.64.0), so this badge only appears
                  for the family it was granted to. Saying "vouched" to everyone would claim a
                  check that was never run. */}
              {cg.vouchedForYou && !cg.isBackgroundChecked && (
                <span style={{
                  fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 12,
                  background: 'var(--bg-accent-light)', color: 'var(--role-color)',
                }}>Approved for your family</span>
              )}
            </div>
          </div>
        </div>

        <div style={{
          display: 'flex', gap: 18, flexWrap: 'wrap', justifyContent: 'flex-start',
          marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border-light)',
        }}>
          {stat(cg.rating ? Number(cg.rating).toFixed(1) : null, `${cg.reviewCount || 0} review${cg.reviewCount === 1 ? '' : 's'}`, 'rating')}
          {stat(cg.yearsExperience || null, cg.yearsExperience === 1 ? 'year experience' : 'years experience', 'yrs')}
          {stat(cg.totalSessions || null, cg.totalSessions === 1 ? 'visit' : 'visits', 'visits')}
        </div>
      </div>

      {cg.bio && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
            About {cg.firstName || cg.name}
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {linkify(cg.bio)}
          </div>
        </div>
      )}

      {(cg.specialties || []).length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
            Experience with
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {cg.specialties.map((sp, i) => chip(sp, `sp-${i}`))}
          </div>
        </div>
      )}

      {(cg.certifications || []).length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
            Certifications
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {cg.certifications.map((c, i) => chip(typeof c === 'string' ? c : (c.name || c.title || ''), `ct-${i}`))}
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
          {reviews.length > 0 ? `Reviews (${reviews.length})` : 'Reviews'}
        </div>
        {reviews.length === 0 ? (
          <div style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>
            No reviews yet {'—'} {cg.firstName || 'she'} is new here, not poorly rated.
          </div>
        ) : (
          <React.Fragment>
            {shown.map((r) => (
              <div key={r.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border-light)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{r.reviewer_name}</span>
                  <span style={{ fontSize: 13, color: 'var(--accent-color)', whiteSpace: 'nowrap' }}>
                    {'⭐'.repeat(Math.max(0, Math.min(5, Math.round(r.rating || 0))))}
                  </span>
                </div>
                {r.comment && (
                  <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {linkify(r.comment)}
                  </div>
                )}
              </div>
            ))}
            {reviews.length > shown.length && (
              <button onClick={() => setShowAllReviews(true)} style={{
                background: 'none', border: 'none', padding: '10px 0 0', font: 'inherit',
                fontSize: 13, fontWeight: 700, color: 'var(--role-color)', cursor: 'pointer',
              }}>Show all {reviews.length} reviews</button>
            )}
          </React.Fragment>
        )}
      </div>
    </div>
  );
};
