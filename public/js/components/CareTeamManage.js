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
  const [notifChannel, setNotifChannel] = useState('push');
  const [savingNotif, setSavingNotif] = useState(false);
  const [a11yExpanded, setA11yExpanded] = useState(false);
  const { showToast } = useToast();

  const fetchTeam = async () => {
    try {
      const res = await apiFetch(`/api/care-teams/${careTeamId}`);
      if (res?.ok) {
        const data = await res.json();
        setTeam(data.careTeam);
        setNewName(data.careTeam.name);
        setSmsPhone(data.careTeam.recipient_sms_phone || '');
        setNotifChannel(data.careTeam.recipient_notification_channel || 'push');
      }
    } catch (err) {
      console.error('Fetch care team error:', err);
    }
    setLoading(false);
  };

  useEffect(() => { if (careTeamId) fetchTeam(); }, [careTeamId]);

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
  if (!team) return <div className="card"><p style={{ color: '#666' }}>Care team not found.</p></div>;

  const isLeader = team.myRole === 'leader';
  const inputStyle = { width: '100%', padding: '10px 12px', border: '1px solid #d0d0d0', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' };
  const roleColors = { leader: '#1b6b5a', member: '#0066cc', viewer: '#888' };
  const roleLabels = { leader: 'Team Leader', member: 'Member', viewer: 'View Only' };

  const myUserId = team.myUserId;
  const myMember = team.members?.find(m => m.userId === myUserId);

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

      {/* My Relationship Label */}
      <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 13, color: '#555' }}>
            <span style={{ fontWeight: 600 }}>I am {team.recipient_first_name}'s:</span>{' '}
            {editingLabel ? (
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <input value={labelText} onChange={(e) => setLabelText(e.target.value)}
                  placeholder="e.g. Son, Daughter, Spouse, Friend"
                  style={{ padding: '4px 8px', border: '1px solid #d0d0d0', borderRadius: 6, fontSize: 13, width: 200 }}
                  autoFocus onKeyDown={(e) => { if (e.key === 'Enter') handleSaveLabel(); if (e.key === 'Escape') setEditingLabel(false); }} />
                <button onClick={handleSaveLabel} style={{ padding: '4px 10px', background: '#1b6b5a', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Save</button>
                <button onClick={() => setEditingLabel(false)} style={{ padding: '4px 10px', background: '#fff', color: '#666', border: '1px solid #d0d0d0', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
              </span>
            ) : (
              <span>
                {(() => {
                  const label = myMember?.relationshipLabel;
                  return label ? (
                    <span style={{ fontStyle: 'italic' }}>{label}</span>
                  ) : (
                    <span style={{ color: '#bbb', fontStyle: 'italic' }}>Not set</span>
                  );
                })()}
                <button onClick={() => {
                  setLabelText(myMember?.relationshipLabel || '');
                  setEditingLabel(true);
                }} style={{ background: 'none', border: 'none', fontSize: 12, color: '#1b6b5a', cursor: 'pointer', marginLeft: 6, fontWeight: 600 }}>
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
            <div style={{ fontSize: 12, color: '#666', margin: '10px 0 0', background: '#f8f9fa', padding: '10px 12px', borderRadius: 8, lineHeight: 1.6 }}>
              <div style={{ marginBottom: 4 }}><strong style={{ color: '#1b6b5a' }}>Leader</strong> — Full control: manage members, edit care profile, schedule sessions, assign caregivers, manage payments.</div>
              <div style={{ marginBottom: 4 }}><strong style={{ color: '#0066cc' }}>Member</strong> — View and coordinate: see the schedule, send messages, request care, view care notes. Cannot invite/remove members.</div>
              <div><strong style={{ color: '#888' }}>View Only</strong> — Read-only access: see the schedule and care notes, but cannot make changes or send messages on behalf of the team.</div>
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
                  ...(isExpanded ? { background: '#f8faf9', margin: '0 -16px', padding: '14px 16px' } : {}) }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {m.avatarUrl ? (
                    <img src={m.avatarUrl} alt={`${m.firstName?.[0] || ''}${m.lastName?.[0] || ''}`} style={{ width: 42, height: 42, borderRadius: '50%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: 42, height: 42, borderRadius: '50%',
                      background: m.role === 'leader' ? '#e0f2e9' : '#f0f4f8',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 16, fontWeight: 700, color: roleColors[m.role] || '#1b6b5a' }}>
                      {m.firstName?.[0]}{m.lastName?.[0]}
                    </div>
                  )}
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: '#333' }}>{m.firstName} {m.lastName}</div>
                    <div style={{ fontSize: 12, color: '#888', marginTop: 1 }}>
                      {m.relationshipLabel ? <span style={{ color: '#666' }}>{m.relationshipLabel} · </span> : ''}{m.email}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: roleColors[m.role],
                    background: m.role === 'leader' ? '#e0f2e9' : m.role === 'viewer' ? '#f5f5f5' : '#e8f0fe',
                    padding: '4px 10px', borderRadius: 12 }}>
                    {roleLabels[m.role] || m.role}
                  </span>
                  {canManage && <span style={{ fontSize: 14, color: '#bbb', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)' }}>▾</span>}
                </div>
              </div>
              {isExpanded && canManage && (
                <div style={{ padding: '0 0 14px', margin: '0 -16px', padding: '0 16px 14px', background: '#f8faf9', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={(e) => { e.stopPropagation(); handleChangeRole(m.userId, 'member'); }}
                    style={{ padding: '6px 14px', background: m.role === 'member' ? '#1b6b5a' : '#fff', color: m.role === 'member' ? '#fff' : '#1b6b5a',
                      border: '1px solid #1b6b5a', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    Member
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleChangeRole(m.userId, 'viewer'); }}
                    style={{ padding: '6px 14px', background: m.role === 'viewer' ? '#666' : '#fff', color: m.role === 'viewer' ? '#fff' : '#666',
                      border: '1px solid #999', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    View Only
                  </button>
                  <div style={{ flex: 1 }}></div>
                  <button onClick={(e) => { e.stopPropagation(); handleRemoveMember(m.userId, `${m.firstName} ${m.lastName}`); }}
                    style={{ padding: '6px 14px', background: '#fff', color: '#dc3545', border: '1px solid #dc3545',
                      borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    Remove from Team
                  </button>
                </div>
              )}
            </div>
          );
        })}
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

      {/* Recent Visits */}
      {recentVisits.length > 0 && (
        <div style={{ marginTop: 24, background: '#fff', borderRadius: 12, border: '1px solid #e0e0e0', padding: '16px 20px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1b6b5a', marginBottom: 12 }}>Recent Visits</div>
          {recentVisits.map((s) => {
            const svcLabel = formatServiceType(s.service_type);
            return (
              <div key={s.id} onClick={() => setVisitDetailSessionId(s.id)}
                style={{ padding: '10px 0', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#f0f8f5'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#333' }}>
                    {s.scheduled_date} — {svcLabel}
                  </div>
                  <div style={{ fontSize: 13, color: '#666', marginTop: 2 }}>
                    {s.caregiver_name || 'No caregiver'} · {s.duration_hours || 2}h
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    padding: '3px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                    background: s.status === 'completed' ? '#e8f5e9' : '#e3f2fd',
                    color: s.status === 'completed' ? '#2e7d32' : '#1565c0',
                  }}>{s.status === 'completed' ? 'Completed' : 'In Progress'}</span>
                  <span style={{ color: '#1b6b5a', fontSize: 12, fontWeight: 600 }}>View →</span>
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
              padding: '14px 20px', background: '#fff', border: '1px solid #e0e0e0', borderRadius: a11yExpanded ? '12px 12px 0 0' : 12,
              cursor: 'pointer', transition: 'border-radius 0.2s',
            }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#1b6b5a' }}>
              Accessibility Options for {team.recipient_first_name}
            </span>
            <span style={{ fontSize: 18, color: '#999', transition: 'transform 0.2s', transform: a11yExpanded ? 'rotate(180deg)' : 'rotate(0)' }}>▾</span>
          </button>
          {a11yExpanded && (
            <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '16px 20px' }}>

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
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#7c3aed', marginBottom: 6 }}>Display Settings</div>
                    <p style={{ fontSize: 13, color: '#666', margin: '0 0 12px' }}>
                      Control what {team.recipient_first_name} sees when they log in. Changes apply to their view of the app.
                    </p>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 8 }}>Text Size</div>
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
                <div style={{ fontSize: 14, fontWeight: 700, color: '#e8724a', marginBottom: 6 }}>{team.recipient_first_name}'s Notifications</div>
                <p style={{ fontSize: 13, color: '#666', margin: '0 0 14px' }}>
                  Choose how {team.recipient_first_name} gets reminders about upcoming care sessions.
                </p>

                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 6 }}>Reminder method</div>
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
                          background: notifChannel === opt.value ? '#fff5f0' : '#fff',
                          color: notifChannel === opt.value ? '#e8724a' : '#555',
                        }}>
                        {opt.icon} {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {['sms', 'both'].includes(notifChannel) && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 6 }}>{team.recipient_first_name}'s phone number</div>
                    <input type="tel" value={smsPhone} onChange={(e) => setSmsPhone(e.target.value)}
                      placeholder="(540) 555-1234"
                      style={{ width: '100%', padding: '10px 12px', border: '1px solid #d0d0d0', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }} />
                    <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>US format: (540) 555-1234 or +15405551234</div>
                  </div>
                )}

                <div style={{ background: '#f0f8f5', padding: '10px 14px', borderRadius: 8, fontSize: 13, color: '#1b6b5a', marginBottom: 14 }}>
                  {notifChannel === 'none'
                    ? `${team.recipient_first_name} won't receive any session reminders.`
                    : notifChannel === 'sms'
                      ? `${team.recipient_first_name} will get a text 15 minutes before each session starts and before the caregiver leaves.`
                      : notifChannel === 'both'
                        ? `${team.recipient_first_name} will get both app notifications and text messages for session reminders.`
                        : `${team.recipient_first_name} will get app notifications for session reminders (requires the app installed).`}
                </div>

                <button onClick={handleSaveNotifications} disabled={savingNotif}
                  style={{ padding: '9px 20px', background: savingNotif ? '#999' : '#e8724a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: savingNotif ? 'wait' : 'pointer' }}>
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
