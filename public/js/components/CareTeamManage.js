// ─── CareTeamManage — View and manage care team members & invites ───

// v1.105.79 — mirrors src/utils/capabilities.js. Kept as plain data so the labels stay in one
// place and the copy below cannot drift from what the server actually enforces.
//
// The old role blurb claimed View Only was "read-only access... cannot make changes". That has
// been untrue since Care Tasks shipped: a viewer could log visits AND tick off a medication
// task, because careTasks.js gated check-off on `!!access`. Every line here is what the server
// grants, written out.
const CAP_LABELS = [
  ['read_profile', "See " + "their health profile", 'Conditions, medications, the care summary.'],
  ['read_notes',   'Read care notes',               'What the team has written about how things are going.'],
  ['write_notes',  'Leave a note',                  'Add their own observations.'],
  ['read_visits',  'See visit history',             'Who has been round, and when.'],
  ['write_visits', 'Log a visit',                   'Record that they were there.'],
  ['read_tasks',   'See care tasks',                'Including medication reminders.'],
  ['check_tasks',  'Tick off a care task',          'Including recording that medication was given.'],
  ['manage',       'Manage the care profile',       'Create and edit tasks, edit the profile.'],
];
const CAP_PRESETS = {
  member: CAP_LABELS.map((c) => c[0]),
  viewer: ['read_profile', 'read_notes', 'write_notes', 'read_visits', 'write_visits'],
  helper: ['write_notes', 'write_visits'],
};
// v1.105.81 — name an invite's access from the capabilities it carries, so a pending row says
// "Viewer" rather than the raw role word. Falls back to the role for invites sent before
// v1.105.79, which have no capability set.
const CAP_PRESET_COPY = {
  member: ['Full access', 'Everything below \u2014 the same as another family organiser.'],
  viewer: ['Viewer', 'Reads the record and logs their own visits. Nothing to do with medication.'],
  helper: ['Helper', 'Leaves a note and records that they were there. Sees nothing about their health.'],
};
// v1.105.85 — what a MEMBER can do, named from their capability set rather than the role word.
//
// Pete, looking at Julia after she accepted: "it said 'member'. do i need to change her to view
// only or is she just a member with limited capabilities?" She was a full member — role 'member'
// gives the share permission 'edit', which maps to all eight capabilities. The badge was honest
// there. But the moment you use "Change access" the picker writes capabilities and NOT the role
// word, so a viewer would keep reading "Member" — a role word drifting from real access, which
// is the exact problem the whole capability model was built to end.
//
// So the badge is derived. There is one source of truth and it is what she can actually do.
const memberAccessLabel = (m) => {
  if (m.role === 'leader') return 'Team Leader';
  return capsLabel(m.capabilities, m.role);
};

const capsLabel = (caps, role) => {
  if (!Array.isArray(caps) || caps.length === 0) return role === 'viewer' ? 'Viewer' : role === 'care_recipient' ? 'Care Recipient' : 'Full access';
  const key = JSON.stringify([...caps].sort());
  for (const name of ['member', 'viewer', 'helper']) {
    if (JSON.stringify([...CAP_PRESETS[name]].sort()) === key) return CAP_PRESET_COPY[name][0];
  }
  return `Custom (${caps.length})`;
};


const CareTeamManage = window.CareTeamManage = ({ careTeamId, onBack }) => {
  const [team, setTeam] = useState(null);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  // v1.105.79 — the capability picker. Presets first because this is used on a phone; the
  // checkboxes are one tap away for the cases a preset does not cover (Peggy plus medication).
  const [invitePreset, setInvitePreset] = useState('viewer');
  const [inviteCaps, setInviteCaps] = useState(CAP_PRESETS.viewer);
  const [showCustomCaps, setShowCustomCaps] = useState(false);
  const [inviteQuery, setInviteQuery] = useState('');
  const [inviteResults, setInviteResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [pickedPerson, setPickedPerson] = useState(null);
  const [editingCapsFor, setEditingCapsFor] = useState(null);
  const [memberCaps, setMemberCaps] = useState([]);
  const [savingCaps, setSavingCaps] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelText, setLabelText] = useState('');
  const [expandedMember, setExpandedMember] = useState(null);
  const [showTaskCreate, setShowTaskCreate] = useState(false); // v1.105.38 — '+ Task' moved here from the dashboard
  const [recentVisits, setRecentVisits] = useState([]);
  const [visitDetailSessionId, setVisitDetailSessionId] = useState(null);
  const [smsPhone, setSmsPhone] = useState('');
  const [intlPhone, setIntlPhone] = useState(false);
  const [notifChannel, setNotifChannel] = useState('push');
  const [savingNotif, setSavingNotif] = useState(false);
  const [reminderIntervals, setReminderIntervals] = useState([120, 60, 30]);
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
        try { setReminderIntervals(JSON.parse(data.careTeam.recipient_sms_reminder_intervals || '[120, 60, 30]')); } catch { setReminderIntervals([120, 60, 30]); }
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

  // v1.105.51 — every handler below this except handleInvite was `if (res?.ok) { … }` with
  // no else, so a server REJECTION produced no feedback at all: the last-admin guard, a
  // permission denial, an expired invite. The tap simply did nothing. handleInvite already
  // read the error body; this makes the rest do the same.
  const failToast = async (res, fallback) => {
    let msg = fallback;
    try { const d = await res?.json(); if (d?.error) msg = d.error; } catch { /* not JSON */ }
    showToast(msg, 'error');
  };

  // Debounced lookup, scoped server-side to people you already know (see the route comment).
  React.useEffect(() => {
    const q = inviteQuery.trim();
    if (q.length < 2 || pickedPerson) { setInviteResults([]); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/care-teams/${careTeamId}/invite-search?q=${encodeURIComponent(q)}`);
        if (cancelled) return;
        if (res?.ok) { const d = await res.json(); setInviteResults(d.people || []); }
        else setInviteResults([]);
      } catch { if (!cancelled) setInviteResults([]); }
      if (!cancelled) setSearching(false);
    }, 300);
    return () => { cancelled = true; clearTimeout(t); setSearching(false); };
  }, [inviteQuery, pickedPerson, careTeamId]);

  const applyPreset = (name) => {
    setInvitePreset(name);
    setInviteCaps(CAP_PRESETS[name]);
    // v1.105.94 — the role on the invite is what the registration page reads to decide what
    // KIND of account to create. Helper must send 'helper', or Peggy signs up as family and
    // lands on a dashboard built for someone else's job.
    setInviteRole(name === 'member' ? 'member' : name === 'helper' ? 'helper' : 'viewer');
  };
  const toggleCap = (capsSetter, caps, cap) =>
    capsSetter(caps.includes(cap) ? caps.filter((c) => c !== cap) : [...caps, cap]);

  const resetInvite = () => {
    setInviteEmail(''); setInviteQuery(''); setPickedPerson(null);
    setInviteResults([]); setShowCustomCaps(false); applyPreset('viewer');
  };

  const handleSaveMemberCaps = async (userId) => {
    if (memberCaps.length === 0) { showToast('Choose what this person can do', 'error'); return; }
    setSavingCaps(true);
    try {
      const res = await apiFetch(`/api/care-teams/${careTeamId}/members/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ capabilities: memberCaps }),
      });
      if (res?.ok) { showToast('Access updated', 'success'); setEditingCapsFor(null); fetchTeam(); }
      else { const d = await res?.json().catch(() => ({})); showToast(d?.error || 'Could not update access', 'error'); }
    } catch { showToast('Could not update access', 'error'); }
    setSavingCaps(false);
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    const target = pickedPerson ? pickedPerson.email : inviteEmail.trim();
    if (!target) return;
    if (inviteCaps.length === 0) { showToast('Choose what this person can do', 'error'); return; }
    setInviting(true);
    try {
      const res = await apiFetch(`/api/care-teams/${careTeamId}/invite`, {
        method: 'POST',
        body: JSON.stringify({ email: target, role: inviteRole, capabilities: inviteCaps }),
      });
      const data = await res?.json();
      if (res?.ok) {
        showToast(`Invite sent to ${target}`, 'success');
        resetInvite();
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
      if (!res?.ok) return failToast(res, 'Failed to remove member');
      showToast(`${name} removed from team`, 'success');
      fetchTeam();
    } catch {
      showToast('Failed to remove member', 'error');
    }
  };

  const handleCancelInvite = async (inviteId) => {
    try {
      const res = await apiFetch(`/api/care-teams/${careTeamId}/invite/${inviteId}`, { method: 'DELETE' });
      if (!res?.ok) return failToast(res, 'Failed to cancel invite');
      showToast('Invite cancelled', 'success');
      fetchTeam();
    } catch {
      showToast('Failed to cancel invite', 'error');
    }
  };

  const handleResendInvite = async (inviteId, email) => {
    try {
      const res = await apiFetch(`/api/care-teams/${careTeamId}/invite/${inviteId}/resend`, { method: 'POST' });
      if (!res?.ok) return failToast(res, 'Failed to resend invite');
      showToast(`Invite resent to ${email}`, 'success');
      fetchTeam();
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
      if (!res?.ok) {
        // The editor stays OPEN on failure — it used to close regardless, so the typed
        // name disappeared and the old one was still there, with no explanation.
        await failToast(res, 'Failed to update team name');
        return;
      }
      showToast('Team name updated', 'success');
      fetchTeam();
    } catch {
      showToast('Failed to update team name', 'error');
      return;
    }
    setEditingName(false);
  };

  const handleChangeRole = async (userId, newRole) => {
    try {
      const res = await apiFetch(`/api/care-teams/${careTeamId}/members/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ role: newRole }),
      });
      if (!res?.ok) return failToast(res, 'Failed to change role');
      showToast('Role updated', 'success');
      fetchTeam();
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
      if (!res?.ok) return failToast(res, 'Failed to update');
      showToast('Relationship updated', 'success');
      setEditingLabel(false);
      fetchTeam();
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
        body: JSON.stringify({ smsPhone: smsPhone.trim(), notificationChannel: notifChannel, smsReminderIntervals: reminderIntervals }),
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
        {/* v1.105.38 — "+ Task" lives here now. It used to sit on the dashboard beside
            "+ Request Care", and that slot went to "+ Log Visit": Pete is far likelier to
            log a visit than to add a task, and the dashboard has one slot's worth of
            attention. Nothing was removed from the app — task creation moved to where the
            team and its recipient are already in view. */}
        <button onClick={() => setShowTaskCreate(true)}
          style={{ padding: '8px 20px', background: 'var(--bg-card)', color: 'var(--role-color)', border: '1px solid var(--role-color)', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          + Task
        </button>
      </div>

      {showTaskCreate && typeof CareTaskQuickCreate !== 'undefined' && (
        <CareTaskQuickCreate
          recipients={[{ id: team.care_recipient_id, first_name: team.recipient_first_name, last_name: team.recipient_last_name }]}
          onClose={() => setShowTaskCreate(false)}
          onCreated={() => setShowTaskCreate(false)} />
      )}

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
            {/* 1 — who. Search is scoped server-side to people you already know; anyone else
                 is reachable by typing their full email, which proves you already have it. */}
            {pickedPerson ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--bg-primary)', borderRadius: 8, marginBottom: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--role-color)', color: 'var(--text-on-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13 }}>
                  {(pickedPerson.firstName || '?')[0]}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 650, fontSize: 14 }}>{pickedPerson.firstName} {pickedPerson.lastName}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pickedPerson.email}</div>
                </div>
                <button type="button" onClick={() => { setPickedPerson(null); setInviteQuery(''); }}
                  style={{ background: 'none', border: 'none', color: 'var(--accent-color)', font: 'inherit', fontSize: 13, cursor: 'pointer' }}>Change</button>
              </div>
            ) : (
              <div style={{ marginBottom: 10 }}>
                <input value={inviteQuery} onChange={(e) => { setInviteQuery(e.target.value); setInviteEmail(e.target.value); }}
                  placeholder="Search by name, or type their email" style={{ ...inputStyle, width: '100%' }} />
                {searching && <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 6 }}>Searching{'\u2026'}</div>}
                {inviteResults.length > 0 && (
                  <div style={{ border: '1px solid var(--border-light)', borderRadius: 8, marginTop: 6, overflow: 'hidden' }}>
                    {inviteResults.map((p) => (
                      <button key={p.id} type="button" disabled={p.alreadyOnTeam}
                        onClick={() => { setPickedPerson(p); setInviteResults([]); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 12px', background: 'var(--bg-card)', border: 'none', borderBottom: '1px solid var(--border-light)', cursor: p.alreadyOnTeam ? 'default' : 'pointer', textAlign: 'left', opacity: p.alreadyOnTeam ? 0.5 : 1 }}>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>{p.firstName} {p.lastName}</span>
                          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-tertiary)' }}>{p.email}</span>
                        </span>
                        {p.alreadyOnTeam && <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>already on the team</span>}
                      </button>
                    ))}
                  </div>
                )}
                {/* The duplication risk is human, not structural: invite an address they do not
                    use and you have created a second person as far as the app is concerned. */}
                {inviteQuery.trim().length >= 2 && !searching && inviteResults.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.5 }}>
                    Nobody you know by that name. If they{'\u2019'}re not on InPlace yet, type the
                    email address they{'\u2019'}ll sign up with {'\u2014'} a different address makes a separate account.
                  </div>
                )}
              </div>
            )}

            {/* 2 — what they can do. */}
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)', margin: '4px 0 6px' }}>What can they do?</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
              {['viewer', 'helper', 'member'].map((name) => (
                <button key={name} type="button" onClick={() => applyPreset(name)}
                  style={{
                    textAlign: 'left', padding: '10px 12px', borderRadius: 9, cursor: 'pointer',
                    border: `1px solid ${invitePreset === name && !showCustomCaps ? 'var(--role-color)' : 'var(--border-light)'}`,
                    background: invitePreset === name && !showCustomCaps ? 'var(--bg-primary)' : 'var(--bg-card)',
                  }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700 }}>{CAP_PRESET_COPY[name][0]}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.45 }}>{CAP_PRESET_COPY[name][1]}</div>
                </button>
              ))}
            </div>

            <button type="button" onClick={() => setShowCustomCaps((v) => !v)}
              style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontSize: 12.5, fontWeight: 650, color: 'var(--accent-color)', cursor: 'pointer', marginBottom: showCustomCaps ? 8 : 12 }}>
              {showCustomCaps ? 'Hide details' : 'Customise\u2026'}
            </button>

            {showCustomCaps && (
              <div style={{ border: '1px solid var(--border-light)', borderRadius: 9, padding: '4px 12px', marginBottom: 12 }}>
                {CAP_LABELS.map(([cap, label, desc]) => (
                  <label key={cap} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 0', borderBottom: '1px solid var(--border-light)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={inviteCaps.includes(cap)}
                      onChange={() => toggleCap(setInviteCaps, inviteCaps, cap)}
                      style={{ marginTop: 2, flexShrink: 0 }} />
                    <span>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{label}</span>
                      <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.4 }}>{desc}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}

            <button type="submit" disabled={inviting || (!pickedPerson && !inviteEmail.trim())}
              style={{ width: '100%', padding: '11px', background: inviting ? 'var(--text-muted)' : 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 14, cursor: inviting ? 'wait' : 'pointer' }}>
              {inviting ? 'Sending\u2026' : 'Send invite'}
            </button>

            <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 8, lineHeight: 1.5 }}>
              They{'\u2019'}ll be asked to read and accept the privacy statement before they can join.
            </div>
          </form>
        </div>
      )}

      {/* Members */}
      <div className="card">
        <div className="card-header">
          Team Members ({team.members?.length || 0}{isLeader && team.invites?.length > 0 ? ` + ${team.invites.length} pending` : ''})
        </div>

        {/* v1.105.81 — Pete: "if I send an invite, I want to see 'pending - Viewer' under team
            members". They used to live in a separate card below Recent Visits, which is not
            where you look after sending one. Shown here, dimmed, with the access they will get
            when they accept — named from the capabilities the invite carries, not the role word. */}
        {isLeader && team.invites?.map((inv) => (
          <div key={inv.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #f0f0f0', opacity: 0.72 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <div style={{ width: 42, height: 42, borderRadius: '50%', border: '1px dashed var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, color: 'var(--text-muted)', flexShrink: 0 }}>
                {'\u2709'}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.invitedEmail || inv.email}</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 1 }}>
                  Pending {'\u00B7'} {capsLabel(inv.capabilities, inv.role)}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button onClick={() => handleResendInvite(inv.id, inv.invitedEmail || inv.email)}
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
                      {m.relationshipLabel ? <span style={{ color: 'var(--text-secondary)' }}>{m.relationshipLabel}</span> : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{memberAccessLabel(m)}</span>}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: roleColors[m.role] || 'var(--text-secondary)',
                    background: m.role === 'leader' ? 'var(--role-color-light)' : 'var(--bg-primary)',
                    padding: '4px 10px', borderRadius: 12 }}>
                    {memberAccessLabel(m)}
                  </span>
                  {canManage && <span style={{ fontSize: 14, color: 'var(--text-muted)', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)' }}>▾</span>}
                </div>
              </div>
              {isExpanded && canManage && editingCapsFor === m.userId && (
                <div style={{ margin: '0 -16px', padding: '0 16px 14px', background: 'var(--bg-highlight)' }}>
                  {/* v1.105.79 — the upgrade path. Changing what someone can do is an UPDATE on
                      the existing share row, so promoting a viewer never creates a second
                      anything: same user, same share, different capabilities. */}
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)', margin: '0 0 6px' }}>
                    What {m.firstName} can do
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                    {['viewer', 'helper', 'member'].map((name) => (
                      <button key={name} onClick={(e) => { e.stopPropagation(); setMemberCaps(CAP_PRESETS[name]); }}
                        style={{ padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: 650, cursor: 'pointer',
                          border: '1px solid var(--border-light)', background: 'var(--bg-card)', color: 'var(--text-secondary)' }}>
                        {CAP_PRESET_COPY[name][0]}
                      </button>
                    ))}
                  </div>
                  <div style={{ border: '1px solid var(--border-light)', borderRadius: 9, padding: '2px 12px', background: 'var(--bg-card)', marginBottom: 10 }}>
                    {CAP_LABELS.map(([cap, label, desc]) => (
                      <label key={cap} onClick={(e) => e.stopPropagation()}
                        style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid var(--border-light)', cursor: 'pointer' }}>
                        <input type="checkbox" checked={memberCaps.includes(cap)}
                          onChange={() => toggleCap(setMemberCaps, memberCaps, cap)} style={{ marginTop: 2, flexShrink: 0 }} />
                        <span>
                          <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{label}</span>
                          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.4 }}>{desc}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button disabled={savingCaps} onClick={(e) => { e.stopPropagation(); handleSaveMemberCaps(m.userId); }}
                      style={{ flex: 1, padding: '9px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: savingCaps ? 'wait' : 'pointer' }}>
                      {savingCaps ? 'Saving\u2026' : 'Save access'}
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); setEditingCapsFor(null); }}
                      style={{ padding: '9px 16px', background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {isExpanded && canManage && editingCapsFor !== m.userId && (
                <div style={{ margin: '0 -16px', padding: '0 16px 14px', background: 'var(--bg-highlight)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={(e) => { e.stopPropagation(); setEditingCapsFor(m.userId); setMemberCaps(m.capabilities || CAP_PRESETS.viewer); }}
                    style={{ padding: '6px 14px', background: 'var(--role-color)', color: 'var(--text-on-primary)',
                      border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 650, cursor: 'pointer' }}>
                    Change access
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleChangeRole(m.userId, 'member'); }}
                    style={{ padding: '6px 14px', background: m.role === 'member' ? 'var(--role-color)' : 'var(--bg-card)', color: m.role === 'member' ? 'var(--bg-card)' : 'var(--role-color)',
                      border: '1px solid #1b6b5a', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    Member
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleChangeRole(m.userId, 'viewer'); }}
                    style={{ padding: '6px 14px', background: m.role === 'viewer' ? 'var(--text-secondary)' : 'var(--bg-card)', color: m.role === 'viewer' ? 'var(--bg-card)' : 'var(--text-secondary)',
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
      {/* Recent Visits */}
      {recentVisits.length > 0 && (
        <div style={{ marginTop: 24, background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid #e0e0e0', padding: '16px 20px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--role-color)', marginBottom: 12 }}>Recent Visits</div>
          {recentVisits.map((s) => {
            const svcLabel = formatServiceType(s.service_type);
            return (
              <div key={s.id} onClick={() => setVisitDetailSessionId(s.id)}
                style={{ padding: '10px 0', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-highlight)'; }}
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
                          background: notifChannel === opt.value ? 'var(--bg-accent-light)' : 'var(--bg-card)',
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

                {['sms', 'both'].includes(notifChannel) && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Arrival reminders</div>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 8px' }}>
                      {team.recipient_first_name} will get a friendly text countdown before each confirmed visit.
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {[
                        { mins: 120, label: '2 hours before', emoji: '🕑' },
                        { mins: 60, label: '1 hour before', emoji: '🕐' },
                        { mins: 30, label: '30 minutes before', emoji: '⏰' },
                      ].map(opt => {
                        const checked = reminderIntervals.includes(opt.mins);
                        return (
                          <label key={opt.mins} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer', padding: '6px 10px', borderRadius: 8, background: checked ? 'var(--bg-accent-light)' : 'var(--bg-card)', border: checked ? '1px solid #e8724a' : '1px solid #e8e8e8' }}>
                            <input type="checkbox" checked={checked}
                              onChange={() => {
                                if (checked) setReminderIntervals(reminderIntervals.filter(v => v !== opt.mins));
                                else setReminderIntervals([...reminderIntervals, opt.mins].sort((a, b) => b - a));
                              }}
                              style={{ accentColor: 'var(--accent-color)', width: 16, height: 16 }} />
                            {opt.emoji} {opt.label}
                          </label>
                        );
                      })}
                    </div>
                    {reminderIntervals.length === 0 && ['sms', 'both'].includes(notifChannel) && (
                      <div style={{ fontSize: 12, color: 'var(--color-warning)', marginTop: 6 }}>
                        No arrival reminders selected — {team.recipient_first_name} will still get the standard 15-minute heads up.
                      </div>
                    )}
                  </div>
                )}

                <div style={{ background: '#f0f8f5', padding: '10px 14px', borderRadius: 8, fontSize: 13, color: 'var(--role-color)', marginBottom: 14 }}>
                  {notifChannel === 'none'
                    ? `${team.recipient_first_name} won't receive any session reminders.`
                    : notifChannel === 'sms'
                      ? `${team.recipient_first_name} will get text reminders${reminderIntervals.length > 0 ? ` at ${reminderIntervals.sort((a,b) => b-a).map(m => m >= 60 ? `${m/60}hr` : `${m}min`).join(', ')} before` : ''} each confirmed visit, plus a heads-up when the caregiver is about to leave.`
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

      {/* Reimbursements ledger (v1.72.0) */}
      <Reimbursements careTeamId={careTeamId} members={team.members || []} myUserId={myUserId} />

      {/* Visit Detail Modal */}
      {visitDetailSessionId && (
        <VisitDetailModal sessionId={visitDetailSessionId} role="family" onClose={() => setVisitDetailSessionId(null)} />
      )}
    </div>
  );
};
