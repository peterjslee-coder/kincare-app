// ─── CareTeamPage — Lists user's care teams, drills into CareTeamManage ───
const CareTeamPage = window.CareTeamPage = ({ selectedTeamId, onNavigate }) => {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTeamId, setActiveTeamId] = useState(selectedTeamId || null);

  const fetchTeams = async () => {
    try {
      const res = await apiFetch('/api/care-teams');
      if (res?.ok) {
        const data = await res.json();
        setTeams(data.careTeams || []);
        // Auto-select if only one team exists and none specified
        if (!activeTeamId && data.careTeams?.length === 1) {
          setActiveTeamId(data.careTeams[0].id);
        }
      }
    } catch (err) {
      console.error('Fetch care teams error:', err);
    }
    setLoading(false);
  };

  useEffect(() => { fetchTeams(); }, []);

  if (loading) return <LoadingSpinner text="Loading care teams..." />;

  // If a team is selected, show its management page
  if (activeTeamId) {
    return <CareTeamManage careTeamId={activeTeamId} onBack={teams.length > 1 ? () => setActiveTeamId(null) : null} />;
  }

  // No teams — empty state
  if (teams.length === 0) {
    return (
      <div>
        <h1 className="greeting">Care Teams</h1>
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>👪</div>
          <h3 style={{ margin: '0 0 8px' }}>No Care Teams Yet</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '0 0 20px' }}>
            When you add a loved one to care for, a care team is automatically created. You can then invite family members to join.
          </p>
          <button onClick={() => onNavigate && onNavigate('recipients')}
            style={{ padding: '10px 24px', background: 'var(--role-color)', color: 'var(--bg-card)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            Add a Loved One
          </button>
        </div>
      </div>
    );
  }

  // Multiple teams — show picker
  return (
    <div>
      <h1 className="greeting">Care Teams</h1>
      <div style={{ display: 'grid', gap: 12 }}>
        {teams.map(t => (
          <div key={t.id} className="card" style={{ cursor: 'pointer', transition: 'box-shadow 0.15s' }}
            onClick={() => setActiveTeamId(t.id)}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{t.name}</div>
                <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 4 }}>
                  Caring for {t.recipient_first_name} {t.recipient_last_name} · {t.memberCount} member{t.memberCount !== 1 ? 's' : ''}
                </div>
                <span style={{ display: 'inline-block', marginTop: 6, fontSize: 12, fontWeight: 600, color: 'var(--role-color)',
                  background: 'var(--role-color-light)', padding: '2px 10px', borderRadius: 12, textTransform: 'capitalize' }}>{t.my_role}</span>
              </div>
              <span style={{ fontSize: 24, color: 'var(--text-muted)' }}>→</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
