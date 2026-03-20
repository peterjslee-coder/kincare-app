// ─── Safety Flags Tab — Evidence Thread UI ───
// Full audit trail for safety flags: original conversation, admin outreach, notes, timestamps.
// Designed for court-admissible evidence preservation.

const SafetyFlagsTab = window.SafetyFlagsTab = ({ safetyFlags, safetyLoading, handleReviewFlag, loadSafetyFlags, apiFetch, showToast, currentUserId }) => {
  const [expandedFlag, setExpandedFlag] = useState(null); // flag ID currently expanded
  const [threadData, setThreadData] = useState(null); // { flag, evidenceMessages, outreachMessages, events, participants }
  const [threadLoading, setThreadLoading] = useState(false);
  const [msgTarget, setMsgTarget] = useState(null); // { userId, name } — who we're messaging
  const [msgText, setMsgText] = useState('');
  const [msgSending, setMsgSending] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteSending, setNoteSending] = useState(false);
  const [reviewNotes, setReviewNotes] = useState('');

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const fmtTime = (d) => d ? new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '';
  const fmtDateTime = (d) => d ? `${fmtDate(d)} at ${fmtTime(d)}` : '';

  // Load full thread when a flag is expanded
  const loadThread = async (flagId) => {
    if (expandedFlag === flagId) { setExpandedFlag(null); setThreadData(null); return; }
    setExpandedFlag(flagId);
    setThreadLoading(true);
    setMsgTarget(null);
    setMsgText('');
    setNoteText('');
    try {
      const res = await apiFetch(`/api/admin/safety-flags/${flagId}/thread`);
      if (res?.ok) {
        const data = await res.json();
        setThreadData(data);
      } else {
        showToast('Failed to load evidence thread', 'error');
        setExpandedFlag(null);
      }
    } catch {
      showToast('Failed to load evidence thread', 'error');
      setExpandedFlag(null);
    }
    setThreadLoading(false);
  };

  // Send outreach message
  const sendMessage = async (flagId, userId) => {
    if (!msgText.trim()) return;
    setMsgSending(true);
    try {
      const res = await apiFetch(`/api/admin/safety-flags/${flagId}/message/${userId}`, {
        method: 'POST',
        body: JSON.stringify({ message: msgText.trim() }),
      });
      if (res?.ok) {
        setMsgText('');
        setMsgTarget(null);
        loadThread(flagId); // re-expand to refresh
        setTimeout(() => loadThread(flagId), 100);
      } else {
        const err = await res?.json().catch(() => ({}));
        showToast(err?.error || 'Failed to send', 'error');
      }
    } catch { showToast('Failed to send message', 'error'); }
    setMsgSending(false);
  };

  // Add admin note
  const addNote = async (flagId) => {
    if (!noteText.trim()) return;
    setNoteSending(true);
    try {
      const res = await apiFetch(`/api/admin/safety-flags/${flagId}/note`, {
        method: 'POST',
        body: JSON.stringify({ note: noteText.trim() }),
      });
      if (res?.ok) {
        setNoteText('');
        loadThread(flagId);
        setTimeout(() => loadThread(flagId), 100);
      } else { showToast('Failed to add note', 'error'); }
    } catch { showToast('Failed to add note', 'error'); }
    setNoteSending(false);
  };

  // Refresh thread periodically when expanded (catch new replies)
  useEffect(() => {
    if (!expandedFlag) return;
    const interval = setInterval(() => {
      apiFetch(`/api/admin/safety-flags/${expandedFlag}/thread`)
        .then(r => r?.ok ? r.json() : null)
        .then(data => { if (data) setThreadData(data); })
        .catch(() => {});
    }, 15000); // Every 15 seconds
    return () => clearInterval(interval);
  }, [expandedFlag]);

  if (safetyLoading) {
    return React.createElement('div', { style: { textAlign: 'center', padding: 40, color: '#888' } }, 'Loading safety flags...');
  }

  if (safetyFlags.length === 0) {
    return React.createElement('div', { className: 'card', style: { textAlign: 'center', color: '#888', padding: 40 } },
      'No safety flags. All conversations are monitored for abuse, exploitation, and off-platform circumvention.'
    );
  }

  return React.createElement('div', null, safetyFlags.map(f => {
    const isAbuse = f.flag_type?.includes('abuse') || f.flag_type?.includes('neglect') || f.flag_type?.includes('threat') || f.flag_type?.includes('exploitation');
    const isPending = f.status === 'pending';
    const isEscalated = f.status === 'escalated';
    const isActive = isPending || isEscalated;
    const isExpanded = expandedFlag === f.id;
    const unread = isActive && !f.admin_read_at;

    return React.createElement('div', {
      key: f.id, className: 'card',
      style: {
        marginBottom: 12,
        border: isEscalated ? '2px solid #b71c1c' : isPending ? `2px solid ${isAbuse ? '#dc2626' : '#ff9800'}` : '1px solid #e5e7eb',
        background: isEscalated ? '#fff5f5' : isPending ? (isAbuse ? '#fef2f2' : '#fff8f0') : '#fff',
        position: 'relative',
      },
    },
      // Unread indicator
      unread && React.createElement('div', {
        style: { position: 'absolute', top: 10, right: 10, width: 10, height: 10, borderRadius: '50%', background: '#dc2626' },
        title: 'Unread',
      }),

      // ── Flag header (always visible, clickable to expand) ──
      React.createElement('div', {
        style: { cursor: 'pointer' },
        onClick: () => loadThread(f.id),
      },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 } },
          React.createElement('span', { style: { fontSize: 16 } }, isEscalated ? '\u{1F6A8}\u{1F6A8}' : isAbuse ? '\u{1F6A8}' : '\u26A0\uFE0F'),
          React.createElement('span', { style: { fontWeight: 700, fontSize: 14, color: isAbuse || isEscalated ? '#dc2626' : '#e65100' } },
            f.flag_type?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Flagged'
          ),
          React.createElement('span', {
            style: {
              fontSize: 10, padding: '2px 8px', borderRadius: 4, fontWeight: 600,
              background: isEscalated ? '#b71c1c' : isPending ? '#ffebee' : f.status === 'resolved' ? '#e8f5e9' : f.status === 'dismissed' ? '#f5f5f5' : '#f5f5f5',
              color: isEscalated ? '#fff' : isPending ? '#c62828' : f.status === 'resolved' ? '#2e7d32' : '#888',
            }
          }, f.status.toUpperCase()),
          React.createElement('span', { style: { fontSize: 12, color: '#888', marginLeft: 'auto' } },
            isExpanded ? '\u25B2 Collapse' : '\u25BC View Thread'
          ),
        ),
        React.createElement('div', { style: { fontWeight: 600, fontSize: 13 } },
          `${f.first_name} ${f.last_name}`,
          React.createElement('span', { style: { fontWeight: 400, color: '#888', marginLeft: 6, fontSize: 12 } }, f.email),
        ),
        React.createElement('div', { style: { fontSize: 11, color: '#999', marginTop: 2 } }, fmtDateTime(f.created_at)),
        React.createElement('div', {
          style: { marginTop: 6, padding: 10, background: '#f8f9fa', borderRadius: 8, fontSize: 13, color: '#333', lineHeight: 1.5, borderLeft: `3px solid ${isAbuse ? '#dc2626' : '#ff9800'}` }
        }, `\u201C${f.user_message}\u201D`),
      ),

      // ── Status actions (always visible for active flags) ──
      isActive && React.createElement('div', { style: { marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
        React.createElement('input', {
          type: 'text', placeholder: 'Notes for resolution...', value: reviewNotes,
          onChange: e => setReviewNotes(e.target.value),
          style: { flex: 1, minWidth: 150, padding: 8, border: '1px solid #ddd', borderRadius: 6, fontSize: 13 },
        }),
        !isEscalated && React.createElement('button', {
          onClick: () => { handleReviewFlag(f.id, 'escalated'); loadSafetyFlags(); },
          style: { padding: '6px 14px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: 'pointer' },
        }, '\u{1F6A8} Escalate'),
        React.createElement('button', {
          onClick: () => { handleReviewFlag(f.id, 'resolved'); loadSafetyFlags(); },
          style: { padding: '6px 14px', background: '#1b6b5a', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: 'pointer' },
        }, '\u2713 Resolve'),
        React.createElement('button', {
          onClick: () => { handleReviewFlag(f.id, 'dismissed'); loadSafetyFlags(); },
          style: { padding: '6px 14px', background: '#f5f5f5', color: '#888', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, cursor: 'pointer' },
        }, 'Dismiss'),
      ),

      // ── Expanded evidence thread ──
      isExpanded && React.createElement('div', { style: { marginTop: 16, borderTop: '2px solid #e0e0e0', paddingTop: 16 } },
        threadLoading
          ? React.createElement('div', { style: { textAlign: 'center', padding: 20, color: '#888' } }, 'Loading evidence thread...')
          : threadData && React.createElement(React.Fragment, null,

            // ─── SECTION 1: Original Conversation (Evidence) ───
            React.createElement('div', { style: { marginBottom: 20 } },
              React.createElement('div', { style: { fontSize: 12, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 } },
                '\u{1F4DD} Original Conversation (Evidence)'
              ),
              threadData.evidenceMessages.length === 0
                ? React.createElement('div', { style: { fontSize: 12, color: '#999', fontStyle: 'italic', padding: 8 } }, 'No conversation messages found.')
                : React.createElement('div', { style: { background: '#fafafa', borderRadius: 8, padding: 8, maxHeight: 400, overflowY: 'auto' } },
                  threadData.evidenceMessages.map(m => {
                    const isFlaggedMsg = m.content === f.user_message;
                    return React.createElement('div', {
                      key: m.id,
                      style: {
                        padding: '8px 12px', marginBottom: 4, borderRadius: 8,
                        background: isFlaggedMsg ? '#ffebee' : '#fff',
                        border: isFlaggedMsg ? '1px solid #ef9a9a' : '1px solid #eee',
                      },
                    },
                      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 } },
                        React.createElement('span', { style: { fontWeight: 600, fontSize: 12, color: '#333' } },
                          m.sender_label || `${m.first_name || ''} ${m.last_name || ''}`.trim() || 'Unknown',
                          React.createElement('span', { style: { fontWeight: 400, color: '#aaa', marginLeft: 6, fontSize: 10 } }, m.role || ''),
                        ),
                        React.createElement('span', { style: { fontSize: 10, color: '#999', whiteSpace: 'nowrap' } }, fmtDateTime(m.created_at)),
                      ),
                      React.createElement('div', { style: { fontSize: 13, color: '#333', marginTop: 4, lineHeight: 1.4 } }, m.content),
                      isFlaggedMsg && React.createElement('div', { style: { fontSize: 10, color: '#c62828', fontWeight: 600, marginTop: 4 } }, '\u2191 FLAGGED MESSAGE'),
                    );
                  })
                ),
            ),

            // ─── SECTION 2: Admin Outreach Threads ───
            React.createElement('div', { style: { marginBottom: 20 } },
              React.createElement('div', { style: { fontSize: 12, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 } },
                '\u{1F4AC} Admin Outreach'
              ),

              // Participant message buttons
              threadData.participants && threadData.participants.length > 0 && React.createElement('div', {
                style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
              },
                threadData.participants.map(p =>
                  React.createElement('button', {
                    key: p.user_id,
                    onClick: () => { setMsgTarget({ userId: p.user_id, name: `${p.first_name} ${p.last_name}` }); setMsgText(''); },
                    style: {
                      padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      background: msgTarget?.userId === p.user_id ? '#1b6b5a' : '#f5f5f5',
                      color: msgTarget?.userId === p.user_id ? '#fff' : '#1b6b5a',
                      border: `1px solid ${msgTarget?.userId === p.user_id ? '#1b6b5a' : '#ccc'}`,
                    },
                  }, `Message ${p.first_name} ${p.last_name} (${p.role})`)
                ),
              ),

              // Message input (when a participant is selected)
              msgTarget && React.createElement('div', {
                style: { background: '#f0faf6', border: '1px solid #b2dfdb', borderRadius: 8, padding: 12, marginBottom: 10 },
              },
                React.createElement('div', { style: { fontSize: 12, color: '#1b6b5a', fontWeight: 600, marginBottom: 6 } },
                  `Sending as InPlace Support to ${msgTarget.name}`
                ),
                React.createElement('textarea', {
                  value: msgText, onChange: e => setMsgText(e.target.value),
                  placeholder: `Hi ${msgTarget.name.split(' ')[0]}, this is InPlace Support. We noticed a concern in a recent conversation and wanted to follow up...`,
                  rows: 3,
                  style: { width: '100%', padding: 10, border: '1px solid #ddd', borderRadius: 6, fontSize: 13, resize: 'vertical', boxSizing: 'border-box' },
                }),
                React.createElement('div', { style: { display: 'flex', gap: 8, marginTop: 6 } },
                  React.createElement('button', {
                    onClick: () => sendMessage(f.id, msgTarget.userId),
                    disabled: msgSending || !msgText.trim(),
                    style: { padding: '6px 16px', background: msgSending || !msgText.trim() ? '#999' : '#1b6b5a', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: 'pointer' },
                  }, msgSending ? 'Sending...' : 'Send as InPlace Support'),
                  React.createElement('button', {
                    onClick: () => { setMsgTarget(null); setMsgText(''); },
                    style: { padding: '6px 12px', background: '#f5f5f5', color: '#888', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, cursor: 'pointer' },
                  }, 'Cancel'),
                ),
              ),

              // Existing outreach threads
              threadData.outreachMessages.length === 0 && !msgTarget
                ? React.createElement('div', { style: { fontSize: 12, color: '#999', fontStyle: 'italic', padding: 8 } }, 'No outreach messages sent yet.')
                : threadData.outreachMessages.map(thread =>
                  React.createElement('div', {
                    key: thread.threadId,
                    style: { background: '#f0faf6', borderRadius: 8, padding: 10, marginBottom: 8, border: '1px solid #e0e0e0' },
                  },
                    React.createElement('div', { style: { fontSize: 11, fontWeight: 700, color: '#1b6b5a', marginBottom: 6, textTransform: 'uppercase' } },
                      `Thread with ${thread.participant.firstName} ${thread.participant.lastName} (${thread.participant.email})`
                    ),
                    thread.messages.map(m => {
                      const isAdmin = m.sender_label === 'InPlace Support' || m.sender_id === currentUserId;
                      return React.createElement('div', {
                        key: m.id,
                        style: {
                          padding: '8px 12px', marginBottom: 4, borderRadius: 8,
                          background: isAdmin ? '#e8f5e9' : '#fff',
                          border: '1px solid #eee',
                          marginLeft: isAdmin ? 20 : 0,
                          marginRight: isAdmin ? 0 : 20,
                        },
                      },
                        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 } },
                          React.createElement('span', { style: { fontWeight: 600, fontSize: 12, color: isAdmin ? '#1b6b5a' : '#333' } },
                            isAdmin ? 'InPlace Support (You)' : `${m.first_name || ''} ${m.last_name || ''}`.trim()
                          ),
                          React.createElement('span', { style: { fontSize: 10, color: '#999', whiteSpace: 'nowrap' } }, fmtDateTime(m.created_at)),
                        ),
                        React.createElement('div', { style: { fontSize: 13, color: '#333', marginTop: 4, lineHeight: 1.4 } }, m.content),
                      );
                    }),
                  )
                ),
            ),

            // ─── SECTION 3: Internal Notes ───
            React.createElement('div', { style: { marginBottom: 20 } },
              React.createElement('div', { style: { fontSize: 12, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 } },
                '\u{1F4CB} Internal Notes & Audit Trail'
              ),
              React.createElement('div', { style: { display: 'flex', gap: 8, marginBottom: 10 } },
                React.createElement('input', {
                  type: 'text', placeholder: 'Add internal note (not visible to users)...',
                  value: noteText, onChange: e => setNoteText(e.target.value),
                  onKeyDown: e => { if (e.key === 'Enter') addNote(f.id); },
                  style: { flex: 1, padding: 8, border: '1px solid #ddd', borderRadius: 6, fontSize: 13 },
                }),
                React.createElement('button', {
                  onClick: () => addNote(f.id),
                  disabled: noteSending || !noteText.trim(),
                  style: { padding: '6px 14px', background: noteSending || !noteText.trim() ? '#999' : '#555', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: 'pointer' },
                }, noteSending ? '...' : 'Add Note'),
              ),

              // Audit trail timeline
              threadData.events.length === 0
                ? React.createElement('div', { style: { fontSize: 12, color: '#999', fontStyle: 'italic', padding: 8 } }, 'No audit events yet.')
                : React.createElement('div', { style: { borderLeft: '2px solid #e0e0e0', marginLeft: 8, paddingLeft: 16 } },
                  threadData.events.map(evt =>
                    React.createElement('div', {
                      key: evt.id,
                      style: { position: 'relative', marginBottom: 10, fontSize: 12 },
                    },
                      // Timeline dot
                      React.createElement('div', {
                        style: {
                          position: 'absolute', left: -22, top: 4, width: 8, height: 8, borderRadius: '50%',
                          background: evt.event_type === 'admin_message' ? '#1b6b5a' : evt.event_type === 'admin_note' ? '#555' : evt.event_type.includes('escalat') ? '#dc2626' : evt.event_type.includes('resolved') ? '#4caf50' : '#999',
                        },
                      }),
                      React.createElement('div', { style: { color: '#999', fontSize: 10, marginBottom: 2 } }, fmtDateTime(evt.created_at)),
                      React.createElement('div', { style: { color: '#333' } },
                        React.createElement('span', { style: { fontWeight: 600 } }, evt.actor_first ? `${evt.actor_first} ${evt.actor_last}` : evt.actor_label || 'System'),
                        ` \u2014 `,
                        evt.event_type === 'admin_viewed' ? 'Viewed this flag'
                          : evt.event_type === 'admin_note' ? evt.content
                          : evt.event_type === 'admin_message' ? `Messaged ${(() => { try { const m = JSON.parse(evt.metadata); return m.recipientName || 'participant'; } catch { return 'participant'; } })()}: "${(evt.content || '').substring(0, 100)}${(evt.content || '').length > 100 ? '...' : ''}"`
                          : evt.content || evt.event_type.replace(/_/g, ' '),
                      ),
                    )
                  ),
                ),
            ),
          ),
      ),
    );
  }));
};
