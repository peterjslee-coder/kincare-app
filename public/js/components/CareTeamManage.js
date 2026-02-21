// ─── CareTeamManage — View and manage care team members & invites ───
const CareTeamManage = window.CareTeamManage = ({ careTeamId, onBack }) => {
  const [team, setTeam] = useState(null);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviting, setInviting] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const { showToast } = useToast();

  const fetchTeam = async () => {
    try {
      const res = await apiFetch(`/api/care-teams/${careTeamId}`);
      if (res?.ok) {
        const data = await res.json();
        setTeam(data.careTeam);
        setNewName(data.careTeam.name);
      }
    } catch (err) {
      console.error('Fetch care team error:', err);
    }
    setLoading(false);
  };

  useEffect(() => { if (careTeamId) fetchTeam(); }, [careTeamId]);

  const handleInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      const res = await apiFetch(`/api/care-teams/${careTeamId}/invite`, {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await res?.json();
      if (res?.ok) {
        showToast(`Invite sent to ${inviteEmail}`, 'success');
        setInviteEmail('');
        setShowInviteForm(false);
        fetchTeam();
      } else {
        showToast(data?.error || 'Failed to send invite', 'error');
      }
    } catch {
      showToast('Failed to send invite', 'error');
    }
    setInviting(false);
  };

  const handleRemoveMember = async (userId, name) => {
    if (!confirm(`Remove ${name} from the care team?`)) return;
    try {
      const res = await apiFetch(`/api/care-teams/${careTeamId}/members/${userId}`, { method: 'DELETE' });
      if (res?.ok) {
        showToast(`${name} removed from team`, 'success');
        fetchTeam();
      }
    } catch {
      showToast('Failed to remove member', 'error');
    }
  };

  const handleCancelInvite = async (inviteId) => {
    try {
      const res = await apiFetch(`/api/care-teams/${careTeamId}/invite/${inviteId}`, { method: 'DELETE' });
      if (res?.ok) {
        showToast('Invite cancelled', 'success');
        fetchTeam();
      }
    } catch {
      showToast('Failed to cancel invite', 'error');
    }
  };

  const handleResendInvite = async (inviteId, email) => {
    try {
      const res = await apiFetch(`/api/care-teams/${careTeamId}/invite/${inviteId}/resend`, { method: 'POST' });
      if (res?.ok) {
        showToast(`Invite resent to ${email}`, 'success');
        fetchTeam();
      }
    } catch {
      showToast('Failed to resend invite', 'error');
    }
  };

  const handleUpdateName = async () => {
    if (!newName.trim() || newName.trim() === team.name) { setEditingName(false); return; }
    try {
      const res = await apiFetch(`/api/care-teams/${careTeamId}`, {
        method: 'PUT',
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (res?.ok) {
        showToast('Team name updated', 'success');
        fetchTeam();
      }
    } catch {
      showToast('Failed to update team name', 'error');
    }
    setEditingName(false);
  };

  const handleChangeRole = async (userId, newRole) => {
    try {
      const res = await apiFetch(`/api/care-teams/${careTeamId}/members/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ role: newRole }),
      });
      if (res?.ok) {
        showToast('Role updated', 'success');
        fetchTeam();
      }
    } catch {
      showToast('Failed to change role', 'error');
    }
  };

  if (loading) return <LoadingSpinner text="Loading care team..." />;
  if (!team) return <div className="card"><p style={{ color: '#666' }}>Care team not found.</p></div>;

  const isLeader = team.myRole === 'leader';
  const inputStyle = { width: '100%', padding: '10px 12px', border: '1px solid #d0d0d0', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' };
  const roleColors = { leader: '#1b6b5a', member: '#0066cc', viewer: '#888' };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        {onBack && <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#1b6b5a' }}>←</button>}
        <div style={{ flex: 1 }}>
          {editingName && isLeader ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} style={{ ...inputStyle, maxWidth: 300 }} autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleUpdateName(); if (e.key === 'Escape') setEditingName(false); }} />
              <button onClick={handleUpdateName} style={{ padding: '8px 16px', background: '#1b6b5a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Save</button>
              <button onClick={() => setEditingName(false)} style={{ padding: '8px 16px', background: '#fff', color: '#666', border: '1px solid #d0d0d0', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            </div>
          ) : (
            <h1 className="greeting" style={{ cursor: isLeader ? 'pointer' : 'default' }}
              onClick={() => isLeader && setEditingName(true)}>
              {team.name}
              {isLeader && <span style={{ fontSize: 14, color: '#aaa', marginLeft: 8 }}>✏️</span>}
            </h1>
          )}
          <p style={{ color: '#888', fontSize: 13, margin: '4px 0 0' }}>
            Caring for {team.recipient_first_name} {team.recipient_last_name}
            {team.recipient_city && ` · ${team.recipient_city}, ${team.recipient_state}`}
          </p>
        </div>
        {isLeader && (
          <button onClick={() => setShowInviteForm(true)}
            style={{ padding: '8px 20px', background: '#1b6b5a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            + Invite
          </button>
        )}
      </div>

      {/* Invite Form */}
      {showInviteForm && isLeader && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid #1b6b5a' }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Invite to Care Team</span>
            <button onClick={() => setShowInviteForm(false)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#999' }}>&times;</button>
          </div>
          <form onSubmit={handleInvite}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="Enter email address" style={{ ...inputStyle, flex: '1 1 200px' }} required />
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}
                style={{ ...inputStyle, flex: '0 0 120px' }}>
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
              </select>
              <button type="submit" disabled={inviting}
                style={{ padding: '10px 20px', background: inviting ? '#999' : '#1b6b5a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: inviting ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>
                {inviting ? 'Sending...' : 'Send Invite'}
              </button>
            </div>
            <p style={{ fontSize: 12, color: '#888', margin: '8px 0 0' }}>
              Members can view and coordinate care. Viewers have read-only access.
            </p>
          </form>
        </div>
      )}

      {/* Members */}
      <div className="card">
        <div className="card-header">Team Members ({team.members?.length || 0})</div>
        {team.members?.map((m) => (
          <div key={m.userId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#f0f4f8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, color: '#1b6b5a' }}>
                {m.firstName?.[0]}{m.lastName?.[0]}
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{m.firstName} {m.lastName}</div>
                <div style={{ fontSize: 12, color: '#888' }}>{m.email}</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {isLeader && m.role !== 'leader' ? (
                <select value={m.role} onChange={(e) => handleChangeRole(m.userId, e.target.value)}
                  style={{ padding: '4px 8px', border: '1px solid #d0d0d0', borderRadius: 6, fontSize: 12, color: roleColors[m.role] || '#333' }}>
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
              ) : (
                <span style={{ fontSize: 12, fontWeight: 600, color: roleColors[m.role], textTransform: 'capitalize',
                  background: m.role === 'leader' ? '#e0f2e9' : '#f0f4f8', padding: '4px 10px', borderRadius: 12 }}>
                  {m.role}
                </span>
              )}
              {isLeader && m.role !== 'leader' && (
                <button onClick={() => handleRemoveMember(m.userId, `${m.firstName} ${m.lastName}`)}
                  style={{ padding: '4px 10px', background: '#fff', color: '#dc3545', border: '1px solid #dc3545', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Pending Invites */}
      {isLeader && team.invites?.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">Pending Invites ({team.invites.length})</div>
          {team.invites.map((inv) => (
            <div key={inv.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{inv.email}</div>
                <div style={{ fontSize: 12, color: '#888' }}>
                  Invited as {inv.role} · Expires {(parseTimestamp(inv.expiresAt) || new Date(0)).toLocaleDateString()}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => handleResendInvite(inv.id, inv.email)}
                  style={{ padding: '4px 10px', background: '#fff', color: '#1b6b5a', border: '1px solid #1b6b5a', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Resend
                </button>
                <button onClick={() => handleCancelInvite(inv.id)}
                  style={{ padding: '4px 10px', background: '#fff', color: '#dc3545', border: '1px solid #dc3545', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
