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
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelText, setLabelText] = useState('');
  const [expandedMember, setExpandedMember] = useState(null);
  const [recentVisits, setRecentVisits] = useState([]);
  const [visitDetailSessionId, setVisitDetailSessionId] = useState(null);
  const [smsPhone, setSmsPhone] = useState('');
  const [intlPhone, setIntlPhone] = useState(false);
  const [notifChannel, setNotifChannel] = useState('push');
  const [savingNotif, setSavingNotif] = useState(false);
  const [a11yExpanded, setA11yExpanded] = useState(false);
  const [billingUserId, setBillingUserId] = useState('');
  const [savingBilling, setSavingBilling] = useState(false);
  const [recipientCaregivers, setRecipientCaregivers] = useState([]);
  const [careRecipientId, setCareRecipientId] = useState(null);
  const [showAssignPicker, setShowAssignPicker] = useState(false);
  const [availableCaregivers, setAvailableCaregivers] = useState([]);
  const [loadingAvailable, setLoadingAvailable] = useState(false);
  const { showToast } = useToast();

  const fetchTeam = async () => {
    try {
      const res = await apiFetch(`/api/care-teams/${careTeamId}`);
      if (res?.ok) {
        const data = await res.json();
        setTeam(data.careTeam);
        setNewName(data.careTeam.name);
        setBillingUserId(data.careTeam.billing_user_id || '');
        setSmsPhone(data.careTeam.recipient_sms_phone || '');
        setNotifChannel(data.careTeam.recipient_notification_channel || 'push');
      }
    } catch (err) {
      console.error('Fetch care team error:', err);
    }
    setLoading(false);
  };

  useEffect(() => { if (careTeamId) fetchTeam(); }, [careTeamId]);

  // Fetch caregivers who've cared for or are assigned to this recipient
  const fetchCaregivers = async () => {
    if (!careTeamId) return;
    try {
      const res = await apiFetch(`/api/care-teams/${careTeamId}/caregivers`);
      if (res?.ok) {
        const data = await res.json();
        setRecipientCaregivers(data.caregivers || []);
        if (data.careRecipientId) setCareRecipientId(data.careRecipientId);
      }
    } catch (err) { console.error('Fetch caregivers error:', err); }
  };
  useEffect(() => { if (careTeamId) fetchCaregivers(); }, [careTeamId]);

  // Fetch all available caregivers (for assign picker)
  const openAssignPicker = async () => {
    setShowAssignPicker(true);
    setLoadingAvailable(true);
    try {
      const res = await apiFetch('/api/caregivers?available=true');
      if (res?.ok) {
        const data = await res.json();
        // Filter out already-assigned caregivers
        const assignedIds = new Set(recipientCaregivers.filter(c => c.is_assigned).map(c => c.caregiver_profile_id));
        setAvailableCaregivers((data.caregivers || []).filter(c => !assignedIds.has(c.id)));
      }
    } catch (err) { console.error('Fetch available caregivers error:', err); }
    setLoadingAvailable(false);
  };

  const handleAssignCaregiver = async (caregiverProfileId) => {
    if (!careRecipientId) return;
    try {
      const res = await apiFetch('/api/assignments', {
        method: 'POST',
        body: JSON.stringify({ caregiverProfileId, careRecipientId: careRecipientId }),
      });
      if (res?.ok) {
        showToast('Caregiver assigned', 'success');
        setShowAssignPicker(false);
        fetchCaregivers();
      } else {
        const data = await res?.json();
        showToast(data?.error || 'Failed to assign', 'error');
      }
    } catch { showToast('Failed to assign caregiver', 'error'); }
  };

  const handleUnassignCaregiver = async (assignmentId, name) => {
    if (!confirm(`Remove ${name} from ${team.recipient_first_name}'s caregivers?`)) return;
    try {
      const res = await apiFetch(`/api/assignments/${assignmentId}`, { method: 'DELETE' });
      if (res?.ok) {
        showToast(`${name} removed`, 'success');
        fetchCaregivers();
      }
    } catch { showToast('Failed to remove caregiver', 'error'); }
  };

  // Fetch recent completed visits for this care team's recipient
  useEffect(() => {
    if (!team?.careRecipientId) return;
    const fetchVisits = async () => {
      try {
        const res = await apiFetch('/api/sessions');
        if (res?.ok) {
          const data = await res.json();
          const all = data.sessions || [];
          // Filter to this recipient, completed or in_progress, most recent first
          const relevant = all
            .filter(s => s.care_recipient_id === team.careRecipientId && ['completed', 'in_progress'].includes(s.status))
            .sort((a, b) => (b.scheduled_date || '').localeCompare(a.scheduled_date || ''))
            .slice(0, 10);
          setRecentVisits(relevant);
        }
      } catch (err) { console.error('Fetch visits error:', err); }
    };
    fetchVisits();
  }, [team?.careRecipientId]);

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

  const handleSaveLabel = async () => {
    try {
      const res = await apiFetch(`/api/care-teams/${careTeamId}/my-label`, {
        method: 'PUT',
        body: JSON.stringify({ relationshipLabel: labelText.trim() }),
      });
      if (res?.ok) {
        showToast('Relationship updated', 'success');
        setEditingLabel(false);
        fetchTeam();
      }
    } catch {
      showToast('Failed to update', 'error');
    }
  };

  const handleSaveNotifications = async () => {
    if (['sms', 'both'].includes(notifChannel) && !smsPhone.trim()) {
      showToast('Phone number required for text message reminders', 'error');
      return;
    }
    setSavingNotif(true);
    try {
      const res = await apiFetch(`/api/care-teams/${careTeamId}/recipient-notifications`, {
        method: 'PUT',
        body: JSON.stringify({ smsPhone: smsPhone.trim(), notificationChannel: notifChannel }),
      });
      if (res?.ok) {
        showToast('Notification settings saved', 'success');
        fetchTeam();
      } else {
        const data = await res?.json();
        showToast(data?.error || 'Failed to save', 'error');
      }
    } catch { showToast('Failed to save notification settings', 'error'); }
    setSavingNotif(false);
  };

  if (loading) return <LoadingSpinner text="Loading care team..." />;
  if (!team) return <div className="card"><p style={{ color: 'var(--text-secondary)' }}>Care team not found.</p></div>;

  const isLeader = team.myRole === 'leader';
  const inputStyle = { width: '100%', padding: '10px 12px', border: '1px solid #d0d0d0', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' };
  const roleColors = { leader: 'var(--role-color)', member: '#0066cc', viewer: 'var(--text-tertiary)' };
  const roleLabels = { leader: 'Team Leader', member: 'Member', viewer: 'View Only' };

  const myUserId = team.myUserId;
  const myMember = team.members?.find(m => m.userId === myUserId);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        {onBack && <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--role-color)' }}>←</button>}
        <div style={{ flex: 1 }}>
          {editingName && isLeader ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} style={{ ...inputStyle, maxWidth: 300 }} autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleUpdateName(); if (e.key === 'Escape') setEditingName(false); }} />
              <button onClick={handleUpdateName} style={{ padding: '8px 16px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Save</button>
              <button onClick={() => setEditingName(false)} style={{ padding: '8px 16px', background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid #d0d0d0', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            </div>
          ) : (
            <h1 className="greeting" style={{ cursor: isLeader ? 'pointer' : 'default' }}
              onClick={() => isLeader && setEditingName(true)}>
              {team.name}
              {isLeader && <span style={{ fontSize: 14, color: 'var(--text-muted)', marginLeft: 8 }}>✏️</span>}
            </h1>
          )}
          <p style={{ color: 'var(--text-tertiary)', fontSize: 13, margin: '4px 0 0' }}>
            Caring for {team.recipient_first_name} {team.recipient_last_name}
            {team.recipient_city && ` · ${team.recipient_city}, ${team.recipient_state}`}
          </p>
        </div>
        {isLeader && (
          <button onClick={() => setShowInviteForm(true)}
            style={{ padding: '8px 20px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            + Invite
          </button>
        )}
      </div>

      {/* My Relationship Label */}
      <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            <span style={{ fontWeight: 600 }}>I am {team.recipient_first_name}'s:</span>{' '}
            {editingLabel ? (
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <input value={labelText} onChange={(e) => setLabelText(e.target.value)}
                  placeholder="e.g. Son, Daughter, Spouse, Friend"
                  style={{ padding: '4px 8px', border: '1px solid #d0d0d0', borderRadius: 6, fontSize: 13, width: 200 }}
                  autoFocus onKeyDown={(e) => { if (e.key === 'Enter') handleSaveLabel(); if (e.key === 'Escape') setEditingLabel(false); }} />
                <button onClick={handleSaveLabel} style={{ padding: '4px 10px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Save</button>
                <button onClick={() => setEditingLabel(false)} style={{ padding: '4px 10px', background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid #d0d0d0', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
              </span>
            ) : (
              <span>
                {(() => {
                  const label = myMember?.relationshipLabel;
                  return label ? (
                    <span style={{ fontStyle: 'italic' }}>{label}</span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not set</span>
                  );
                })()}
                <button onClick={() => {
                  setLabelText(myMember?.relationshipLabel || '');
                  setEditingLabel(true);
                }} style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--role-color)', cursor: 'pointer', marginLeft: 6, fontWeight: 600 }}>
                  Edit
                </button>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Invite Form */}
      {showInviteForm && isLeader && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid #1b6b5a' }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Invite to Care Team</span>
            <button onClick={() => setShowInviteForm(false)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-muted)' }}>&times;</button>
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
                style={{ padding: '10px 20px', background: inviting ? 'var(--text-muted)' : 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: inviting ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>
                {inviting ? 'Sending...' : 'Send Invite'}
              </button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '10px 0 0', background: 'var(--bg-primary)', padding: '10px 12px', borderRadius: 8, lineHeight: 1.6 }}>
              <div style={{ marginBottom: 4 }}><strong style={{ color: 'var(--role-color)' }}>Leader</strong> — Full control: manage members, edit care profile, schedule sessions, assign caregivers, manage payments.</div>
              <div style={{ marginBottom: 4 }}><strong style={{ color: '#0066cc' }}>Member</strong> — View and coordinate: see the schedule, send messages, request care, view care notes. Cannot invite/remove members.</div>
              <div><strong style={{ color: 'var(--text-tertiary)' }}>View Only</strong> — Read-only access: see the schedule and care notes, but cannot make changes or send messages on behalf of the team.</div>
            </div>
          </form>
        </div>
      )}

      {/* Members */}
      <div className="card">
        <div className="card-header">Team Members ({team.members?.length || 0})</div>
        {team.members?.map((m) => {
          const isExpanded = expandedMember === m.userId;
          const canManage = isLeader && m.role !== 'leader';
          return (
            <div key={m.userId} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <div
                onClick={() => canManage && setExpandedMember(isExpanded ? null : m.userId)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0',
                  cursor: canManage ? 'pointer' : 'default', transition: 'background 0.15s',
                  ...(isExpanded ? { background: 'var(--bg-highlight)', margin: '0 -16px', padding: '14px 16px' } : {}) }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {m.avatarUrl ? (
                    <img src={m.avatarUrl} alt={`${m.firstName?.[0] || ''}${m.lastName?.[0] || ''}`} style={{ width: 42, height: 42, borderRadius: '50%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: 42, height: 42, borderRadius: '50%',
                      background: m.role === 'leader' ? 'var(--role-color-light)' : 'var(--bg-primary)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 16, fontWeight: 700, color: roleColors[m.role] || 'var(--role-color)' }}>
                      {m.firstName?.[0]}{m.lastName?.[0]}
                    </div>
                  )}
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{m.firstName} {m.lastName}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 1 }}>
                      {m.relationshipLabel ? <span style={{ color: 'var(--text-secondary)' }}>{m.relationshipLabel}</span> : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{roleLabels[m.role] || m.role}</span>}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: roleColors[m.role],
                    background: m.role === 'leader' ? 'var(--role-color-light)' : m.role === 'viewer' ? 'var(--bg-primary)' : '#e8f0fe',
                    padding: '4px 10px', borderRadius: 12 }}>
                    {roleLabels[m.role] || m.role}
                  </span>
                  {canManage && <span style={{ fontSize: 14, color: 'var(--text-muted)', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)' }}>▾</span>}
                </div>
              </div>
              {isExpanded && canManage && (
                <div style={{ padding: '0 0 14px', margin: '0 -16px', padding: '0 16px 14px', background: 'var(--bg-highlight)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={(e) => { e.stopPropagation(); handleChangeRole(m.userId, 'member'); }}
                    style={{ padding: '6px 14px', background: m.role === 'member' ? 'var(--role-color)' : 'var(--text-on-primary)', color: m.role === 'member' ? 'var(--text-on-primary)' : 'var(--role-color)',
                      border: '1px solid #1b6b5a', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    Member
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleChangeRole(m.userId, 'viewer'); }}
                    style={{ padding: '6px 14px', background: m.role === 'viewer' ? 'var(--text-secondary)' : 'var(--text-on-primary)', color: m.role === 'viewer' ? 'var(--text-on-primary)' : 'var(--text-secondary)',
                      border: '1px solid #999', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    View Only
                  </button>
                  <div style={{ flex: 1 }}></div>
                  <button onClick={(e) => { e.stopPropagation(); handleRemoveMember(m.userId, `${m.firstName} ${m.lastName}`); }}
                    style={{ padding: '6px 14px', background: 'var(--bg-surface)', color: 'var(--color-error)', border: '1px solid #dc3545',
                      borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    Remove from Team
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Billing Contact — leader only */}
      {isLeader && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">Billing Contact</div>
          <div style={{ padding: '14px 0' }}>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.5 }}>
              Choose who pays for {team.recipient_first_name}'s care sessions. If set, this person's payment method will be charged when any team member books a session.
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <select value={billingUserId} onChange={(e) => setBillingUserId(e.target.value)}
                style={{ ...inputStyle, flex: '1 1 200px', maxWidth: 300 }}>
                <option value="">No billing contact (booker pays)</option>
                {team.members?.map(m => (
                  <option key={m.userId} value={m.userId}>{m.firstName} {m.lastName}{m.role === 'leader' ? ' (Leader)' : ''}</option>
                ))}
              </select>
              <button onClick={async () => {
                setSavingBilling(true);
                try {
                  const res = await apiFetch(`/api/care-teams/${careTeamId}/billing`, {
                    method: 'PUT',
                    body: JSON.stringify({ billingUserId: billingUserId || null }),
                  });
                  const data = await res?.json();
                  if (res?.ok) {
                    showToast(data.message || 'Billing contact updated', 'success');
                    fetchTeam();
                  } else {
                    showToast(data?.error || 'Failed to update billing contact', 'error');
                  }
                } catch { showToast('Failed to update billing contact', 'error'); }
                setSavingBilling(false);
              }} disabled={savingBilling}
                style={{ padding: '10px 20px', background: savingBilling ? 'var(--text-muted)' : 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: savingBilling ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>
                {savingBilling ? 'Saving...' : 'Save'}
              </button>
            </div>
            {billingUserId && team.billing_contact_name && (
              <div style={{ marginTop: 10, background: '#f0f8f5', padding: '10px 14px', borderRadius: 8, fontSize: 13, color: 'var(--role-color)' }}>
                {team.billing_contact_name} will be charged for all sessions booked for {team.recipient_first_name}.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Caregivers for this recipient */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{team.recipient_first_name}'s Caregivers ({recipientCaregivers.length})</span>
          {isLeader && (
            <button onClick={openAssignPicker}
              style={{ padding: '5px 14px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
              + Assign
            </button>
          )}
        </div>
        {recipientCaregivers.length === 0 && (
          <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            No caregivers assigned yet. Tap "+ Assign" to add one.
          </div>
        )}
        {recipientCaregivers.map(cg => (
          <div key={cg.caregiver_profile_id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
            {cg.avatar_url ? (
              <img src={cg.avatar_url} alt={`${cg.first_name?.[0]}${cg.last_name?.[0]}`} style={{ width: 42, height: 42, borderRadius: '50%', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'var(--color-success-bg)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, fontWeight: 700, color: 'var(--role-color)' }}>
                {cg.first_name?.[0]}{cg.last_name?.[0]}
              </div>
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                {cg.first_name} {cg.last_name}
                {cg.is_favorite ? <span title="Favorite" style={{ fontSize: 14 }}>⭐</span> : null}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                {cg.visit_count > 0 ? `${cg.visit_count} visit${cg.visit_count !== 1 ? 's' : ''}` : 'No visits yet'}
                {cg.last_visit_date ? ` · Last: ${cg.last_visit_date}` : ''}
              </div>
            </div>
            {cg.is_assigned ? (
              <button onClick={() => handleUnassignCaregiver(cg.assignment_id, `${cg.first_name} ${cg.last_name}`)}
                title="Remove assignment"
                style={{ fontSize: 11, fontWeight: 600, color: 'var(--role-color)', background: 'var(--role-color-light)', padding: '4px 10px', borderRadius: 12, border: 'none', cursor: 'pointer' }}>
                Assigned ✕
              </button>
            ) : (
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', background: 'var(--bg-primary)', padding: '4px 10px', borderRadius: 12 }}>Past</span>
            )}
          </div>
        ))}
      </div>

      {/* Assign Caregiver Picker Modal */}
      {showAssignPicker && (
        <div className="modal-overlay" onClick={() => setShowAssignPicker(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440, maxHeight: '70vh', overflow: 'auto' }}>
            <button className="modal-close" onClick={() => setShowAssignPicker(false)}>✕</button>
            <div className="modal-header" style={{ fontSize: 17 }}>
              Assign Caregiver to {team.recipient_first_name}
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 14px' }}>
              Pick a caregiver to assign. They'll be able to see {team.recipient_first_name}'s care info and accept sessions.
            </p>
            {loadingAvailable ? (
              <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>Loading caregivers...</div>
            ) : availableCaregivers.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>
                No additional caregivers available to assign.
              </div>
            ) : (
              availableCaregivers.map(cg => (
                <div key={cg.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
                  {cg.profilePhoto ? (
                    <img src={cg.profilePhoto} alt="" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--color-success-bg)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 15, fontWeight: 700, color: 'var(--role-color)' }}>
                      {cg.name?.split(' ').map(n => n[0]).join('') || '?'}
                    </div>
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{cg.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                      {cg.city ? `${cg.city}, ${cg.state}` : 'No location'}
                      {cg.distance !== undefined ? ` · ${cg.distance} mi` : ''}
                      {cg.hourlyRate ? ` · $${cg.hourlyRate}/hr` : ''}
                    </div>
                  </div>
                  <button onClick={() => handleAssignCaregiver(cg.id)}
                    style={{ padding: '6px 14px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    Assign
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Pending Invites */}
      {isLeader && team.invites?.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">Pending Invites ({team.invites.length})</div>
          {team.invites.map((inv) => (
            <div key={inv.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{inv.email}</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                  Invited as {inv.role} · Expires {(parseTimestamp(inv.expiresAt) || new Date(0)).toLocaleDateString()}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => handleResendInvite(inv.id, inv.email)}
                  style={{ padding: '4px 10px', background: 'var(--bg-surface)', color: 'var(--role-color)', border: '1px solid #1b6b5a', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Resend
                </button>
                <button onClick={() => handleCancelInvite(inv.id)}
                  style={{ padding: '4px 10px', background: 'var(--bg-surface)', color: 'var(--color-error)', border: '1px solid #dc3545', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent Visits */}
      {recentVisits.length > 0 && (
        <div style={{ marginTop: 24, background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid #e0e0e0', padding: '16px 20px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--role-color)', marginBottom: 12 }}>Recent Visits</div>
          {recentVisits.map((s) => {
            const svcLabel = formatServiceType(s.service_type);
            return (
              <div key={s.id} onClick={() => setVisitDetailSessionId(s.id)}
                style={{ padding: '10px 0', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#f0f8f5'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
                    {s.scheduled_date} — {svcLabel}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {s.caregiver_name || 'No caregiver'} · {s.duration_hours || 2}h
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    padding: '3px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                    background: s.status === 'completed' ? 'var(--color-success-bg)' : 'var(--color-info-bg)',
                    color: s.status === 'completed' ? 'var(--color-success)' : 'var(--color-info)',
                  }}>{s.status === 'completed' ? 'Completed' : 'In Progress'}</span>
                  <span style={{ color: 'var(--role-color)', fontSize: 12, fontWeight: 600 }}>View →</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Accessibility Options — collapsible at bottom */}
      {isLeader && (
        <div style={{ marginTop: 24 }}>
          <button onClick={() => setA11yExpanded(!a11yExpanded)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 20px', background: 'var(--bg-surface)', border: '1px solid #e0e0e0', borderRadius: a11yExpanded ? '12px 12px 0 0' : 12,
              cursor: 'pointer', transition: 'border-radius 0.2s',
            }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--role-color)' }}>
              Accessibility Options for {team.recipient_first_name}
            </span>
            <span style={{ fontSize: 18, color: 'var(--text-muted)', transition: 'transform 0.2s', transform: a11yExpanded ? 'rotate(180deg)' : 'rotate(0)' }}>▾</span>
          </button>
          {a11yExpanded && (
            <div style={{ background: 'var(--bg-surface)', border: '1px solid #e0e0e0', borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '16px 20px' }}>

              {/* Display Settings for Care Recipient */}
              {team.recipient_linked_user_id && (() => {
                const recipPrefs = (() => { try { return team.recipient_accessibility_prefs ? JSON.parse(team.recipient_accessibility_prefs) : {}; } catch { return {}; } })();
                const recipSize = recipPrefs.textSize || 'default';
                const handleRecipientTextSize = async (size) => {
                  try {
                    const res = await apiFetch(`/api/care-teams/${careTeamId}/member-prefs/${team.recipient_linked_user_id}`, {
                      method: 'PUT',
                      body: JSON.stringify({ accessibilityPrefs: { ...recipPrefs, textSize: size } }),
                    });
                    if (res?.ok) {
                      showToast(`Text size updated for ${team.recipient_first_name}`, 'success');
                      fetchTeam();
                    } else {
                      const data = await res?.json();
                      showToast(data?.error || 'Failed to update', 'error');
                    }
                  } catch { showToast('Failed to update display settings', 'error'); }
                };
                return (
                  <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid #f0f0f0' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-purple-light)', marginBottom: 6 }}>Display Settings</div>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
                      Control what {team.recipient_first_name} sees when they log in. Changes apply to their view of the app.
                    </p>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Text Size</div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <button onClick={() => handleRecipientTextSize('default')}
                        className={`text-size-pill text-size-pill-default ${recipSize === 'default' ? 'active' : ''}`}>
                        Default
                      </button>
                      <button onClick={() => handleRecipientTextSize('large')}
                        className={`text-size-pill text-size-pill-large ${recipSize === 'large' ? 'active' : ''}`}>
                        Large
                      </button>
                      <button onClick={() => handleRecipientTextSize('xlarge')}
                        className={`text-size-pill text-size-pill-xlarge ${recipSize === 'xlarge' ? 'active' : ''}`}>
                        Extra Large
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* Notification Settings for Care Recipient */}
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent-color)', marginBottom: 6 }}>{team.recipient_first_name}'s Notifications</div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 14px' }}>
                  Choose how {team.recipient_first_name} gets reminders about upcoming care sessions.
                </p>

                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>Reminder method</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {[
                      { value: 'push', label: 'App only', icon: '📱' },
                      { value: 'sms', label: 'Text only', icon: '💬' },
                      { value: 'both', label: 'App + Text', icon: '📱💬' },
                      { value: 'none', label: 'None', icon: '🔕' },
                    ].map(opt => (
                      <button key={opt.value} onClick={() => setNotifChannel(opt.value)}
                        style={{
                          padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                          border: notifChannel === opt.value ? '2px solid #e8724a' : '1px solid #d0d0d0',
                          background: notifChannel === opt.value ? '#fff5f0' : 'var(--text-on-primary)',
                          color: notifChannel === opt.value ? 'var(--accent-color)' : 'var(--text-secondary)',
                        }}>
                        {opt.icon} {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {['sms', 'both'].includes(notifChannel) && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
                      {team.recipient_first_name}'s phone number
                      <button type="button" onClick={() => { setIntlPhone(!intlPhone); setSmsPhone(''); }} style={{ background: 'none', border: 'none', color: 'var(--role-color)', fontSize: 11, cursor: 'pointer', fontWeight: 600, padding: 0 }}>
                        {intlPhone ? 'US number' : 'International'}
                      </button>
                    </div>
                    <input type="tel" value={smsPhone} onChange={(e) => setSmsPhone(formatPhone(e.target.value, intlPhone))}
                      placeholder={intlPhone ? '+44 20 7946 0958' : '(540) 555-1234'}
                      style={{ width: '100%', padding: '10px 12px', border: '1px solid #d0d0d0', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }} />
                    {intlPhone && <div style={{ fontSize: 11, color: 'var(--accent-color)', marginTop: 4, lineHeight: 1.4 }}>{INTL_PHONE_DISCLAIMER}</div>}
                  </div>
                )}

                <div style={{ background: '#f0f8f5', padding: '10px 14px', borderRadius: 8, fontSize: 13, color: 'var(--role-color)', marginBottom: 14 }}>
                  {notifChannel === 'none'
                    ? `${team.recipient_first_name} won't receive any session reminders.`
                    : notifChannel === 'sms'
                      ? `${team.recipient_first_name} will get a text 15 minutes before each session starts and before the caregiver leaves.`
                      : notifChannel === 'both'
                        ? `${team.recipient_first_name} will get both app notifications and text messages for session reminders.`
                        : `${team.recipient_first_name} will get app notifications for session reminders (requires the app installed).`}
                </div>

                <button onClick={handleSaveNotifications} disabled={savingNotif}
                  style={{ padding: '9px 20px', background: savingNotif ? 'var(--text-muted)' : 'var(--accent-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: savingNotif ? 'wait' : 'pointer' }}>
                  {savingNotif ? 'Saving...' : 'Save Settings'}
                </button>
              </div>

            </div>
          )}
        </div>
      )}

      {/* Visit Detail Modal */}
      {visitDetailSessionId && (
        <VisitDetailModal sessionId={visitDetailSessionId} role="family" onClose={() => setVisitDetailSessionId(null)} />
      )}
    </div>
  );
};
