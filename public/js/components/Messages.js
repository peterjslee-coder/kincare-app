const Messages = window.Messages = () => {
  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [activeConvType, setActiveConvType] = useState('direct');
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const draftsRef = useRef({});
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [selectedContacts, setSelectedContacts] = useState([]);
  const [groupName, setGroupName] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [showFindPeople, setShowFindPeople] = useState(false);
  const [peopleSearch, setPeopleSearch] = useState('');
  const [peopleResults, setPeopleResults] = useState([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [sentRequests, setSentRequests] = useState([]);
  const [archivedIds, setArchivedIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem('msg_archived') || '[]'); } catch { return []; }
  });
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const swipeRef = useRef({ startX: 0, startY: 0, id: null });
  const [swipingId, setSwipingId] = useState(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [replyTo, setReplyTo] = useState(null);
  const [showEmojiFor, setShowEmojiFor] = useState(null);
  const msgSwipeRef = useRef({ startX: 0, startY: 0, id: null, locked: false });
  const [msgSwipingId, setMsgSwipingId] = useState(null);
  const [msgSwipeOffset, setMsgSwipeOffset] = useState(0);
  const { showToast } = useToast();
  const REACTION_EMOJIS = ['\u2764\uFE0F', '\uD83D\uDC4D', '\uD83D\uDC4E', '\uD83D\uDE02', '\uD83D\uDE2E', '\uD83D\uDE4F'];
  const [currentUser, setCurrentUser] = useState(null);

  // ─── In-app call state (Twilio Video) ───
  const [callState, setCallState] = useState({ active: false, roomName: null, callType: null, remoteParticipantName: null, callDirection: null });
  const [incomingCall, setIncomingCall] = useState(null); // { roomName, callType, callerId, callerName }

  const isMobile = window.innerWidth <= 768;

  // Fetch current user
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/auth/me');
        if (res?.ok) { const d = await res.json(); setCurrentUser(d.user); }
      } catch {}
    })();
  }, []);

  // Fetch conversations list
  const fetchConversations = async () => {
    try {
      const res = await apiFetch('/api/messages/conversations');
      if (res?.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
        if (!isMobile && !activeConvId && data.conversations?.length > 0) {
          const first = data.conversations[0];
          setActiveConvId(first.id);
          setActiveConvType(first.type || 'direct');
          fetchMessages(first.id);
        }
      }
    } catch (err) {
      console.error('Fetch conversations error:', err);
    }
    setLoading(false);
  };

  // Fetch messages for a conversation
  const fetchMessages = async (convId) => {
    try {
      const res = await apiFetch(`/api/messages/conversations/${convId}`);
      if (res?.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
        setActiveConvType(data.conversationType || 'direct');
      }
    } catch (err) {
      console.error('Fetch messages error:', err);
    }
  };

  const [contactSearch, setContactSearch] = useState('');

  // Fetch contacts for new chat (with optional search)
  const fetchContacts = async (query) => {
    setContactsLoading(true);
    try {
      const url = query ? `/api/messages/contacts?q=${encodeURIComponent(query)}` : '/api/messages/contacts';
      const res = await apiFetch(url);
      if (res?.ok) {
        const data = await res.json();
        setContacts(data.contacts || []);
      }
    } catch (err) {
      console.error('Fetch contacts error:', err);
    }
    setContactsLoading(false);
  };

  // Search all platform users
  const searchPeople = async (query) => {
    if (!query || query.trim().length < 2) { setPeopleResults([]); return; }
    setPeopleLoading(true);
    try {
      const res = await apiFetch(`/api/connections/search?q=${encodeURIComponent(query)}`);
      if (res?.ok) { const data = await res.json(); setPeopleResults(data.users || []); }
    } catch {}
    setPeopleLoading(false);
  };

  // Fetch pending connection requests (received AND sent)
  const fetchPendingRequests = async () => {
    try {
      const res = await apiFetch('/api/connections');
      if (res?.ok) {
        const data = await res.json();
        const conns = data.connections || [];
        setPendingRequests(conns.filter(c => c.status === 'pending' && c.direction === 'received'));
        setSentRequests(conns.filter(c => c.status === 'pending' && c.direction === 'sent'));
      }
    } catch {}
  };

  const handleSendConnectionRequest = async (userId) => {
    try {
      const res = await apiFetch('/api/connections', {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      if (res?.ok) {
        showToast('Connection request sent!', 'success');
        searchPeople(peopleSearch); // Refresh results
        fetchPendingRequests(); // Refresh sent requests list
      }
    } catch { showToast('Failed to send request', 'error'); }
  };

  // Archive a conversation (swipe to archive)
  const handleArchive = (convId) => {
    const updated = [...archivedIds, convId];
    setArchivedIds(updated);
    localStorage.setItem('msg_archived', JSON.stringify(updated));
    if (activeConvId === convId) { setActiveConvId(null); setMessages([]); }
    showToast('Conversation archived', 'success');
  };

  // Swipe gesture handlers for conversation items
  const onConvTouchStart = (e, convId) => {
    const touch = e.touches[0];
    swipeRef.current = { startX: touch.clientX, startY: touch.clientY, id: convId };
    setSwipingId(null);
    setSwipeOffset(0);
  };

  const onConvTouchMove = (e, convId) => {
    if (swipeRef.current.id !== convId) return;
    const touch = e.touches[0];
    const dx = touch.clientX - swipeRef.current.startX;
    const dy = Math.abs(touch.clientY - swipeRef.current.startY);
    // Only horizontal swipe left
    if (dx < -10 && dy < Math.abs(dx) * 0.5) {
      setSwipingId(convId);
      setSwipeOffset(Math.max(dx, -120));
    }
  };

  const onConvTouchEnd = (convId) => {
    if (swipeRef.current.id !== convId) return;
    if (swipeOffset < -80) {
      handleArchive(convId);
    }
    setSwipingId(null);
    setSwipeOffset(0);
    swipeRef.current = { startX: 0, startY: 0, id: null };
  };

  // ─── Message swipe-to-reply handlers (mobile) ───
  const onMsgTouchStart = (e, msg) => {
    const touch = e.touches[0];
    msgSwipeRef.current = { startX: touch.clientX, startY: touch.clientY, id: msg.id, locked: false };
    setMsgSwipingId(null);
    setMsgSwipeOffset(0);
  };

  const onMsgTouchMove = (e, msg) => {
    if (msgSwipeRef.current.id !== msg.id) return;
    const touch = e.touches[0];
    const dx = touch.clientX - msgSwipeRef.current.startX;
    const dy = Math.abs(touch.clientY - msgSwipeRef.current.startY);
    // Only horizontal swipe right
    if (dx > 10 && dy < dx * 0.5) {
      if (!msgSwipeRef.current.locked) msgSwipeRef.current.locked = true;
      setMsgSwipingId(msg.id);
      setMsgSwipeOffset(Math.min(dx, 80));
    }
  };

  const onMsgTouchEnd = (msg) => {
    if (msgSwipeRef.current.id !== msg.id) return;
    if (msgSwipeOffset > 50) {
      setReplyTo(msg);
      if (inputRef.current) inputRef.current.focus();
    }
    setMsgSwipingId(null);
    setMsgSwipeOffset(0);
    msgSwipeRef.current = { startX: 0, startY: 0, id: null, locked: false };
  };

  // ─── Emoji reaction handler ───
  const handleReaction = async (messageId, emoji) => {
    setShowEmojiFor(null);
    try {
      const res = await apiFetch(`/api/messages/${messageId}/reactions`, {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      });
      if (res?.ok) {
        const data = await res.json();
        // Update reactions in local state
        setMessages(prev => prev.map(m =>
          m.id === messageId ? { ...m, reactions: data.reactions } : m
        ));
      }
    } catch (err) {
      console.error('Reaction error:', err);
    }
  };

  const handleRespondConnection = async (connectionId, action) => {
    try {
      const res = await apiFetch(`/api/connections/${connectionId}`, {
        method: 'PUT',
        body: JSON.stringify({ action }),
      });
      if (res?.ok) {
        const data = await res.json();
        showToast(action === 'accept' ? 'Connected!' : 'Request declined', 'success');
        fetchPendingRequests();
        fetchContacts();
        if (action === 'accept') {
          // Auto-open conversation with the newly connected user
          await fetchConversations();
          if (data.conversationId) {
            setActiveConvId(data.conversationId);
            setActiveConvType('direct');
            setInputText('');
            fetchMessages(data.conversationId);
          }
        }
      }
    } catch { showToast('Failed to respond', 'error'); }
  };

  // Handle deep-link from push notification or URL param
  useEffect(() => {
    fetchConversations().then(() => {
      const pendingConv = window.__pendingConversation;
      if (pendingConv) {
        delete window.__pendingConversation;
        setActiveConvId(pendingConv);
        fetchMessages(pendingConv);
      }
    });
    fetchPendingRequests();

    // Listen for push nav while already on Messages page
    const handlePushNav = (event) => {
      if (event.data?.type === 'PUSH_NAVIGATE') {
        const d = event.data.data || {};
        if (d.type === 'message' && d.conversationId) {
          setActiveConvId(d.conversationId);
          setInputText(draftsRef.current[d.conversationId] || '');
          fetchMessages(d.conversationId);
          fetchConversations();
        }
      }
    };
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handlePushNav);
    }
    return () => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handlePushNav);
      }
    };
  }, []);

  // Listen for real-time incoming messages
  useEffect(() => {
    if (typeof onSocketEvent !== 'function') return;
    const cleanup = onSocketEvent('new_message', (msg) => {
      // If viewing this conversation, add message directly
      if (msg.conversationId === activeConvId) {
        setMessages(prev => [...prev, msg]);
      }
      fetchConversations();
    });
    return cleanup;
  }, [activeConvId]);

  // Listen for real-time reactions
  useEffect(() => {
    if (typeof onSocketEvent !== 'function') return;
    const cleanup = onSocketEvent('message_reaction', (data) => {
      if (data.conversationId === activeConvId) {
        setMessages(prev => prev.map(m =>
          m.id === data.messageId ? { ...m, reactions: data.reactions } : m
        ));
      }
    });
    return cleanup;
  }, [activeConvId]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  useEffect(() => {
    if (activeConvId && inputRef.current) {
      setTimeout(() => inputRef.current.focus(), 100);
    }
  }, [activeConvId]);

  const handleSelectConversation = (conv) => {
    // Save current draft before switching
    if (activeConvId && inputText.trim()) {
      draftsRef.current[activeConvId] = inputText;
    } else if (activeConvId) {
      delete draftsRef.current[activeConvId];
    }
    setActiveConvId(conv.id);
    setActiveConvType(conv.type || 'direct');
    setShowNewChat(false);
    setCreatingGroup(false);
    setReplyTo(null);
    setShowEmojiFor(null);
    // Restore draft for the new conversation
    setInputText(draftsRef.current[conv.id] || '');
    fetchMessages(conv.id);
  };

  const handleBack = () => {
    // Save draft before leaving
    if (activeConvId && inputText.trim()) {
      draftsRef.current[activeConvId] = inputText;
    } else if (activeConvId) {
      delete draftsRef.current[activeConvId];
    }
    setActiveConvId(null);
    setInputText('');
    setMessages([]);
    fetchConversations();
  };

  const handleNewChat = () => {
    setShowNewChat(true);
    setCreatingGroup(false);
    setSelectedContacts([]);
    setGroupName('');
    fetchContacts();
  };

  const handleSelectContact = async (contact) => {
    if (creatingGroup) {
      // Toggle selection for group creation
      setSelectedContacts(prev =>
        prev.find(c => c.id === contact.id)
          ? prev.filter(c => c.id !== contact.id)
          : [...prev, contact]
      );
      return;
    }

    // Direct message — find or create conversation
    setShowNewChat(false);
    try {
      const res = await apiFetch('/api/messages/conversations', {
        method: 'POST',
        body: JSON.stringify({ type: 'direct', memberIds: [contact.id] }),
      });
      if (res?.ok) {
        const data = await res.json();
        setActiveConvId(data.conversationId);
        setActiveConvType('direct');
        fetchMessages(data.conversationId);
        fetchConversations();
      }
    } catch (err) {
      console.error('Create conversation error:', err);
    }
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim() || selectedContacts.length === 0) return;
    try {
      const res = await apiFetch('/api/messages/conversations', {
        method: 'POST',
        body: JSON.stringify({
          type: 'group',
          name: groupName.trim(),
          memberIds: selectedContacts.map(c => c.id),
        }),
      });
      if (res?.ok) {
        const data = await res.json();
        setShowNewChat(false);
        setCreatingGroup(false);
        setActiveConvId(data.conversationId);
        setActiveConvType('group');
        setMessages([]);
        fetchConversations();
      }
    } catch (err) {
      console.error('Create group error:', err);
    }
  };

  const handleSendMessage = async () => {
    if (!inputText.trim() || !activeConvId) return;
    setSending(true);
    try {
      const res = await apiFetch(`/api/messages/conversations/${activeConvId}`, {
        method: 'POST',
        body: JSON.stringify({ content: inputText, replyToId: replyTo?.id || null }),
      });
      if (res?.ok) {
        const data = await res.json();
        setInputText('');
        setReplyTo(null);
        delete draftsRef.current[activeConvId];
        // If conversation ID changed (legacy migration), update it
        if (data.conversationId && data.conversationId !== activeConvId) {
          setActiveConvId(data.conversationId);
        }
        await fetchMessages(data.conversationId || activeConvId);
        await fetchConversations();
      }
    } catch (err) {
      console.error('Send message error:', err);
    }
    setSending(false);
  };

  const handleStartCall = async (callType) => {
    if (!activeConvId || !activeConv) return;

    // Generate a unique room name
    const roomName = 'inplace-' + activeConvId.substring(0, 8) + '-' + Date.now();
    const otherMember = activeConv.members?.find(m => m.id !== currentUser?.id);
    const remoteName = otherMember ? `${otherMember.first_name || ''} ${otherMember.last_name || ''}`.trim() : 'Unknown';

    // Send a chat message about the call
    const emoji = callType === 'video' ? '📹' : '📞';
    const typeLabel = callType === 'video' ? 'video' : 'voice';
    const message = `${emoji} Started a ${typeLabel} call`;

    try {
      await apiFetch(`/api/messages/conversations/${activeConvId}`, {
        method: 'POST',
        body: JSON.stringify({ content: message }),
      });
      fetchMessages(activeConvId);
      fetchConversations();
    } catch (err) {
      console.error('Call message error:', err);
    }

    // Signal the other user via Socket.io
    if (otherMember && window._socket) {
      window._socket.emit('call_invite', {
        targetUserId: otherMember.id,
        roomName: roomName,
        callType: callType,
        callerName: currentUser ? `${currentUser.first_name || ''} ${currentUser.last_name || ''}`.trim() : 'Someone',
      });
    }

    // Start the call locally
    setCallState({
      active: true,
      roomName: roomName,
      callType: callType,
      remoteParticipantName: remoteName,
      callDirection: 'outgoing',
    });
  };

  const handleEndCall = () => {
    // Signal hangup to remote
    if (callState.active && window._socket) {
      const otherMember = activeConv?.members?.find(m => m.id !== currentUser?.id);
      if (otherMember) {
        window._socket.emit('call_hangup', {
          targetUserId: otherMember.id,
          roomName: callState.roomName,
        });
      }
    }
    setCallState({ active: false, roomName: null, callType: null, remoteParticipantName: null, callDirection: null });
  };

  const handleAcceptIncoming = () => {
    if (!incomingCall) return;
    setCallState({
      active: true,
      roomName: incomingCall.roomName,
      callType: incomingCall.callType,
      remoteParticipantName: incomingCall.callerName,
      callDirection: 'incoming',
    });
    if (window._socket) {
      window._socket.emit('call_accept', {
        callerId: incomingCall.callerId,
        roomName: incomingCall.roomName,
      });
    }
    setIncomingCall(null);
  };

  const handleDeclineIncoming = () => {
    if (!incomingCall && window._socket) {
      window._socket.emit('call_decline', {
        callerId: incomingCall.callerId,
        roomName: incomingCall.roomName,
      });
    }
    setIncomingCall(null);
  };

  // Listen for incoming calls via Socket.io
  useEffect(() => {
    const cleanup = onSocketEvent('call_incoming', (data) => {
      if (!callState.active) {
        setIncomingCall(data);
        // Auto-dismiss after 30 seconds if not answered
        setTimeout(() => {
          setIncomingCall(prev => prev?.roomName === data.roomName ? null : prev);
        }, 30000);
      }
    });
    const cleanup2 = onSocketEvent('call_ended', () => {
      setCallState({ active: false, roomName: null, callType: null, remoteParticipantName: null, callDirection: null });
    });
    const cleanup3 = onSocketEvent('call_declined', () => {
      setCallState({ active: false, roomName: null, callType: null, remoteParticipantName: null, callDirection: null });
    });
    return () => { cleanup(); cleanup2(); cleanup3(); };
  }, [callState.active]);

  const renderMessageContent = (content) => {
    // Detect call messages
    const callMatch = content.match(/^(📹|📞) Started a (video|voice) call$/);
    if (callMatch) {
      const isVideoCall = callMatch[2] === 'video';
      return React.createElement('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 0',
          fontStyle: 'italic',
          color: '#1b6b5a',
        }
      },
        React.createElement('span', { style: { fontSize: 20 } }, isVideoCall ? '📹' : '📞'),
        React.createElement('span', null, `Started a ${callMatch[2]} call`)
      );
    }

    // Legacy Google Meet link support (for old messages)
    const meetLinkRegex = /https:\/\/meet\.google\.com\/\S+/g;
    const parts = content.split(meetLinkRegex);
    const links = content.match(meetLinkRegex) || [];

    if (links.length === 0) {
      return content;
    }

    return React.createElement(React.Fragment, null,
      parts.map((part, i) => [
        part && React.createElement(React.Fragment, { key: `text-${i}` }, part),
        i < links.length && React.createElement('a', {
          key: `link-${i}`,
          href: links[i],
          target: '_blank',
          rel: 'noopener noreferrer',
          style: {
            color: '#1b6b5a',
            textDecoration: 'underline',
            fontWeight: 600,
            cursor: 'pointer',
          }
        }, links[i])
      ]).filter(Boolean).flat()
    );
  };

  const activeConv = conversations.find(c => c.id === activeConvId);

  const formatTime = (ts) => {
    if (!ts) return '';
    const date = parseTimestamp(ts);
    if (!date) return '';
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return date.toLocaleDateString(undefined, { weekday: 'short' });
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const roleLabel = (role) => {
    if (role === 'family') return 'Family';
    if (role === 'caregiver') return 'Caregiver';
    if (role === 'care_for') return 'Care Recipient';
    return role || '';
  };

  const getInitials = (name) => {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  };

  const avatarColors = ['#1b6b5a', '#e8724a', '#5e35b1', '#0277bd', '#c62828', '#2e7d32', '#6a1b9a'];
  const getAvatarColor = (name) => {
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return avatarColors[Math.abs(hash) % avatarColors.length];
  };

  const isGroupConv = (conv) => conv && (conv.type === 'group' || conv.type === 'care_team');

  if (loading) {
    return React.createElement(LoadingSpinner, { text: 'Loading messages...' });
  }

  // ─── New Chat / Group Creator ───
  const renderNewChatPicker = () => (
    <div className="msg-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="msg-chat-header">
        <button className="msg-back-btn" onClick={() => { setShowNewChat(false); setCreatingGroup(false); }}
          style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', color: '#1b6b5a', padding: '4px 8px', marginRight: '8px' }}>
          ‹
        </button>
        <div style={{ fontWeight: 600, fontSize: '16px', color: '#333' }}>
          {creatingGroup ? 'New Group' : 'New Message'}
        </div>
        {!creatingGroup && (
          <button onClick={() => setCreatingGroup(true)}
            style={{ marginLeft: 'auto', background: 'none', border: '1px solid #1b6b5a', color: '#1b6b5a', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Create Group
          </button>
        )}
      </div>

      {/* Group name input and create button */}
      {creatingGroup && (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0' }}>
          <input type="text" placeholder="Group name..." value={groupName} onChange={e => setGroupName(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 14, marginBottom: 8 }} />
          {selectedContacts.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {selectedContacts.map(c => (
                <span key={c.id} style={{ background: '#e8f5e9', color: '#1b6b5a', padding: '4px 10px', borderRadius: 16, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {c.name}
                  <span onClick={() => setSelectedContacts(prev => prev.filter(p => p.id !== c.id))} style={{ cursor: 'pointer', marginLeft: 2 }}>×</span>
                </span>
              ))}
            </div>
          )}
          <button onClick={handleCreateGroup} disabled={!groupName.trim() || selectedContacts.length === 0}
            style={{ width: '100%', background: '#1b6b5a', color: 'white', border: 'none', borderRadius: 8, padding: '10px', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: (!groupName.trim() || selectedContacts.length === 0) ? 0.5 : 1 }}>
            Create Group ({selectedContacts.length} member{selectedContacts.length !== 1 ? 's' : ''})
          </button>
        </div>
      )}

      {/* Search bar */}
      <div style={{ padding: '8px 16px', borderBottom: '1px solid #f0f0f0' }}>
        <input type="text" placeholder="Search by name or email..." value={contactSearch}
          onChange={e => { setContactSearch(e.target.value); fetchContacts(e.target.value); }}
          style={{ width: '100%', padding: '10px 12px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 14, background: '#f8f9fa' }} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {contactsLoading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>Loading contacts...</div>
        ) : contacts.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#999', fontSize: '14px' }}>
            {contactSearch ? 'No users found.' : 'No contacts available.'}
          </div>
        ) : (
          contacts.map(c => {
            const isSelected = selectedContacts.find(sc => sc.id === c.id);
            return (
              <div key={c.id} className="msg-contact-item" onClick={() => handleSelectContact(c)}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0', transition: 'background 0.15s', background: isSelected ? '#e8f5e9' : 'transparent' }}
                onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = '#f8f9fa'; }}
                onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: getAvatarColor(c.name), display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '14px', fontWeight: 600, flexShrink: 0 }}>
                  {getInitials(c.name)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: '#333' }}>{c.name}</div>
                  <div style={{ fontSize: '12px', color: '#999' }}>{roleLabel(c.role)}</div>
                </div>
                {creatingGroup && isSelected && (
                  <span style={{ color: '#1b6b5a', fontWeight: 700, fontSize: 18 }}>✓</span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  // ─── Find People Panel ───
  const renderFindPeople = () => (
    <div className="msg-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="msg-chat-header">
        <button className="msg-back-btn" onClick={() => { setShowFindPeople(false); setPeopleSearch(''); setPeopleResults([]); }}
          style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', color: '#1b6b5a', padding: '4px 8px', marginRight: '8px' }}>
          ‹
        </button>
        <div style={{ fontWeight: 600, fontSize: '16px', color: '#333' }}>Find People</div>
      </div>
      <div style={{ padding: '8px 16px', borderBottom: '1px solid #f0f0f0' }}>
        <input type="text" placeholder="Search by name or email..." value={peopleSearch}
          onChange={e => { setPeopleSearch(e.target.value); searchPeople(e.target.value); }}
          autoFocus
          style={{ width: '100%', padding: '10px 12px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 14, background: '#f8f9fa' }} />
      </div>

      {/* Pending connection requests */}
      {pendingRequests.length > 0 && !peopleSearch && (
        <div style={{ borderBottom: '1px solid #f0f0f0' }}>
          <div style={{ padding: '10px 16px', fontSize: 12, fontWeight: 600, color: '#e65100', background: '#fff8f0' }}>
            Connection Requests ({pendingRequests.length})
          </div>
          {pendingRequests.map(req => (
            <div key={req.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid #f5f5f5' }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#e8f0fe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#0066cc' }}>
                {req.otherFirstName?.[0]}{req.otherLastName?.[0]}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{req.otherFirstName} {req.otherLastName}</div>
                <div style={{ fontSize: 12, color: '#888' }}>{req.otherEmail}</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => handleRespondConnection(req.id, 'accept')}
                  style={{ padding: '6px 12px', background: '#1b6b5a', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Accept
                </button>
                <button onClick={() => handleRespondConnection(req.id, 'decline')}
                  style={{ padding: '6px 12px', background: '#fff', color: '#999', border: '1px solid #d0d0d0', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
                  Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {peopleLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Searching...</div>
        ) : peopleSearch.length < 2 ? (
          <div>
            {/* Recent connections from existing conversations */}
            {(() => {
              const seen = new Set();
              const recentPeople = [];
              conversations.filter(c => !isGroupConv(c)).sort((a, b) => {
                const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
                const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
                return bt - at;
              }).forEach(c => {
                const other = (c.members || []).find(m => m.id !== currentUser?.id);
                if (other && !seen.has(other.id)) {
                  seen.add(other.id);
                  recentPeople.push({ ...other, convId: c.id, conv: c });
                }
              });
              if (recentPeople.length === 0) return (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: '#999', fontSize: 14 }}>
                  Search for people on InPlace to start a conversation.
                </div>
              );
              return (
                <div>
                  <div style={{ padding: '10px 16px 6px', fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Recent
                  </div>
                  {recentPeople.slice(0, 10).map(p => (
                    <div key={p.id} onClick={() => { setShowFindPeople(false); handleSelectConversation(p.conv); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid #f5f5f5', cursor: 'pointer' }}>
                      {p.profilePhoto ? (
                        <img src={p.profilePhoto} alt={p.name} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ width: 40, height: 40, borderRadius: '50%', background: getAvatarColor(p.name || '?'), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#fff' }}>
                          {getInitials(p.name || '?')}
                        </div>
                      )}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, color: '#333' }}>{p.name}</div>
                        <div style={{ fontSize: 12, color: '#1b6b5a' }}>Message →</div>
                      </div>
                    </div>
                  ))}
                  <div style={{ padding: '12px 16px', textAlign: 'center', fontSize: 12, color: '#999' }}>
                    Search above to find more people
                  </div>
                </div>
              );
            })()}
          </div>
        ) : peopleResults.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#999', fontSize: 14 }}>No users found.</div>
        ) : (
          peopleResults.map(u => (
            <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid #f0f0f0' }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: u.role === 'caregiver' ? '#e8f5e9' : '#f0f4f8',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: u.role === 'caregiver' ? '#1b6b5a' : '#0066cc' }}>
                {u.firstName?.[0]}{u.lastName?.[0]}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#333' }}>{u.firstName} {u.lastName}</div>
                <div style={{ fontSize: 12, color: '#888' }}>{u.email}</div>
              </div>
              {u.connection?.status === 'accepted' ? (
                <span style={{ fontSize: 12, color: '#1b6b5a', fontWeight: 600 }}>✓ Connected</span>
              ) : u.connection?.status === 'pending' ? (
                <span style={{ fontSize: 12, color: '#888', fontWeight: 500 }}>
                  {u.connection.direction === 'sent' ? 'Request sent' : 'Pending'}
                </span>
              ) : (
                <button onClick={() => handleSendConnectionRequest(u.id)}
                  style={{ padding: '6px 14px', background: '#fff', color: '#1b6b5a', border: '1px solid #1b6b5a', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Connect
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );

  // ─── Conversation List ───
  const renderConversationList = () => (
    <div className="msg-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="msg-list-header">
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#333', margin: 0 }}>Messages</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { setShowFindPeople(true); fetchPendingRequests(); }}
            style={{ background: '#fff', color: '#1b6b5a', border: '1px solid #1b6b5a', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', position: 'relative' }}
            title="Find people to connect with">
            🔍 Find People
            {pendingRequests.length > 0 && (
              <span style={{ position: 'absolute', top: -6, right: -6, background: '#e65100', color: '#fff', borderRadius: '50%', width: 18, height: 18, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {pendingRequests.length}
              </span>
            )}
          </button>
          <button onClick={handleNewChat}
            style={{ background: '#1b6b5a', color: 'white', border: 'none', borderRadius: '50%', width: '36px', height: '36px', fontSize: '20px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
            title="New message">
            +
          </button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Pending received connection requests — inline at top */}
        {pendingRequests.length > 0 && (
          <div style={{ borderBottom: '1px solid #f0f0f0' }}>
            <div style={{ padding: '8px 16px', fontSize: 11, fontWeight: 600, color: '#e65100', background: '#fff8f0' }}>
              Connection Requests ({pendingRequests.length})
            </div>
            {pendingRequests.map(req => (
              <div key={req.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid #f5f5f5' }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#e8f0fe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#0066cc' }}>
                  {req.otherFirstName?.[0]}{req.otherLastName?.[0]}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{req.otherFirstName} {req.otherLastName}</div>
                  <div style={{ fontSize: 12, color: '#e65100' }}>Wants to connect</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => handleRespondConnection(req.id, 'accept')}
                    style={{ padding: '6px 12px', background: '#1b6b5a', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    Accept
                  </button>
                  <button onClick={() => handleRespondConnection(req.id, 'decline')}
                    style={{ padding: '6px 12px', background: '#fff', color: '#999', border: '1px solid #d0d0d0', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {conversations.filter(c => !archivedIds.includes(c.id)).length > 0 ? conversations.filter(c => !archivedIds.includes(c.id)).sort((a, b) => {
          const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
          const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
          return bTime - aTime;
        }).map(c => {
          const isGroup = isGroupConv(c);
          const typeIcon = c.type === 'care_team' ? '👥' : c.type === 'group' ? '💬' : null;
          const isSwiping = swipingId === c.id;
          return (
            <div key={c.id} style={{ position: 'relative', overflow: 'hidden' }}>
              {/* Archive background revealed on swipe */}
              <div style={{
                position: 'absolute', top: 0, right: 0, bottom: 0, width: 120,
                background: '#e65100', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontWeight: 600, fontSize: 13,
                opacity: isSwiping && swipeOffset < -30 ? 1 : 0,
                transition: 'opacity 0.15s',
              }}>
                Archive
              </div>
              <div
                className={`msg-conv-item ${activeConvId === c.id ? 'active' : ''}`}
                onClick={() => handleSelectConversation(c)}
                onTouchStart={(e) => onConvTouchStart(e, c.id)}
                onTouchMove={(e) => onConvTouchMove(e, c.id)}
                onTouchEnd={() => onConvTouchEnd(c.id)}
                style={{
                  position: 'relative', background: '#fff',
                  transform: isSwiping ? `translateX(${swipeOffset}px)` : 'none',
                  transition: isSwiping ? 'none' : 'transform 0.2s',
                }}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                {isGroup ? (
                  <div style={{ width: '44px', height: '44px', position: 'relative' }}>
                    {(() => {
                      const avatarMembers = (c.members || []).filter(m => m.id !== currentUser?.id).slice(0, 3);
                      const count = avatarMembers.length;
                      if (count === 0) return <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: '#e8f5e9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1b6b5a', fontSize: '20px' }}>{typeIcon || '\u{1F465}'}</div>;
                      const size = count === 1 ? 44 : count === 2 ? 28 : 24;
                      const positions = count === 1 ? [[0, 0]] : count === 2 ? [[0, 0], [16, 16]] : [[10, 0], [0, 18], [20, 18]];
                      return avatarMembers.map((m, i) => (
                        m.profilePhoto ? (
                          <img key={m.id} src={m.profilePhoto} alt={m.name} style={{
                            width: size, height: size, borderRadius: '50%', objectFit: 'cover',
                            position: 'absolute', left: positions[i][0], top: positions[i][1],
                            border: '2px solid #fff', zIndex: count - i,
                          }} />
                        ) : (
                          <div key={m.id} style={{
                            width: size, height: size, borderRadius: '50%',
                            background: getAvatarColor(m.name || '?'), color: '#fff',
                            fontSize: count === 1 ? 15 : 10, fontWeight: 600,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            position: 'absolute', left: positions[i][0], top: positions[i][1],
                            border: '2px solid #fff', zIndex: count - i,
                          }}>
                            {getInitials(m.name || '?')}
                          </div>
                        )
                      ));
                    })()}
                  </div>
                ) : c.profilePhoto ? (
                  <img src={c.profilePhoto} alt={c.name} style={{
                    width: '44px', height: '44px', borderRadius: '50%', objectFit: 'cover',
                  }} />
                ) : (
                <div style={{
                  width: '44px', height: '44px', borderRadius: '50%',
                  background: getAvatarColor(c.name),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'white', fontSize: '15px',
                  fontWeight: 600,
                }}>
                  {getInitials(c.name)}
                </div>
                )}
                {c.unreadCount > 0 && (
                  <div style={{
                    position: 'absolute', top: '-2px', right: '-2px',
                    width: '12px', height: '12px', borderRadius: '50%',
                    background: '#ef4444', border: '2px solid #fff',
                  }} />
                )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                    <span style={{ fontWeight: c.unreadCount > 0 ? 700 : 600, fontSize: '14px', color: '#333' }}>
                      {c.name}
                    </span>
                    <span style={{ fontSize: '11px', color: c.unreadCount > 0 ? '#1b6b5a' : '#aaa', fontWeight: c.unreadCount > 0 ? 600 : 400, flexShrink: 0, marginLeft: '8px' }}>
                      {formatTime(c.lastMessageAt)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', color: c.unreadCount > 0 ? '#555' : '#999', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: c.unreadCount > 0 ? 500 : 400 }}>
                      {isGroup && c.members ? `${c.members.length} members` + (c.lastMessage ? ` · ${c.lastMessage}` : '') : (c.lastMessage || 'No messages yet')}
                    </span>
                    {c.unreadCount > 0 && (
                      <span style={{ background: '#1b6b5a', color: '#fff', borderRadius: '10px', padding: '1px 7px', fontSize: '11px', fontWeight: 600, flexShrink: 0, marginLeft: '8px', minWidth: '18px', textAlign: 'center' }}>
                        {c.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        }) : sentRequests.length === 0 && pendingRequests.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>💬</div>
            <div style={{ fontSize: '15px', color: '#666', marginBottom: '8px' }}>No conversations yet</div>
            <div style={{ fontSize: '13px', color: '#999', marginBottom: '20px' }}>Start a conversation with someone in your care network</div>
            <button onClick={handleNewChat}
              style={{ background: '#1b6b5a', color: 'white', border: 'none', borderRadius: '8px', padding: '10px 24px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
              New Message
            </button>
          </div>
        ) : null}

        {/* Sent connection requests — shown below conversations */}
        {sentRequests.filter(r => !archivedIds.includes('req-' + r.id)).map(req => (
          <div key={'req-' + req.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
              borderBottom: '1px solid #f0f0f0', cursor: 'default', opacity: 0.55,
              position: 'relative', overflow: 'hidden',
              transform: swipingId === 'req-' + req.id ? `translateX(${swipeOffset}px)` : 'none',
              transition: swipingId === 'req-' + req.id ? 'none' : 'transform 0.2s',
            }}
            onTouchStart={(e) => onConvTouchStart(e, 'req-' + req.id)}
            onTouchMove={(e) => onConvTouchMove(e, 'req-' + req.id)}
            onTouchEnd={() => onConvTouchEnd('req-' + req.id)}>
            <div style={{
              width: 44, height: 44, borderRadius: '50%',
              background: getAvatarColor((req.otherFirstName || '') + ' ' + (req.otherLastName || '')),
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontSize: 15, fontWeight: 600, flexShrink: 0,
            }}>
              {(req.otherFirstName?.[0] || '')}{(req.otherLastName?.[0] || '')}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#333' }}>
                {req.otherFirstName} {req.otherLastName}
              </div>
              <div style={{ fontSize: 12, color: '#999', fontStyle: 'italic' }}>
                Request sent — waiting for response
              </div>
            </div>
            <span style={{ fontSize: 14, color: '#ccc', flexShrink: 0 }}>⏳</span>
          </div>
        ))}
      </div>
    </div>
  );

  // ─── Chat View ───
  const renderChatView = () => {
    const isGroup = isGroupConv(activeConv);
    return (
      <div className="msg-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div className="msg-chat-header">
          {(isMobile || !conversations.length) && (
            <button className="msg-back-btn" onClick={handleBack}
              style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', color: '#1b6b5a', padding: '4px 8px', marginRight: '4px' }}>
              ‹
            </button>
          )}
          {activeConv && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
              {!isGroup && activeConv.profilePhoto ? (
                <img src={activeConv.profilePhoto} alt={activeConv.name} style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
              ) : (
              <div style={{
                width: '36px', height: '36px', borderRadius: isGroup ? '10px' : '50%',
                background: isGroup ? '#e8f5e9' : getAvatarColor(activeConv.name),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: isGroup ? '#1b6b5a' : 'white', fontSize: isGroup ? '18px' : '13px', fontWeight: 600,
              }}>
                {isGroup ? (activeConv.type === 'care_team' ? '👥' : '💬') : getInitials(activeConv.name)}
              </div>
              )}
              <div>
                <div style={{ fontWeight: 600, fontSize: '15px', color: '#333', lineHeight: 1.2 }}>{activeConv.name}</div>
                <div style={{ fontSize: '11px', color: '#999' }}>
                  {isGroup
                    ? `${activeConv.members?.length || 0} members`
                    : roleLabel(activeConv.members?.find(m => m.id !== activeConv.members?.[0]?.id)?.role)
                  }
                </div>
              </div>
            </div>
          )}
          <button
            className="msg-voice-call-btn"
            onClick={() => handleStartCall('voice')}
            title="Start voice call"
            style={{
              background: 'none',
              border: '2px solid #1b6b5a',
              color: '#1b6b5a',
              borderRadius: '8px',
              width: '36px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: '18px',
              transition: 'all 0.2s',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#1b6b5a';
              e.currentTarget.style.color = 'white';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'none';
              e.currentTarget.style.color = '#1b6b5a';
            }}>
            📞
          </button>
          <button
            className="msg-video-call-btn"
            onClick={() => handleStartCall('video')}
            title="Start video call"
            style={{
              background: 'none',
              border: '2px solid #1b6b5a',
              color: '#1b6b5a',
              borderRadius: '8px',
              width: '36px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: '18px',
              transition: 'all 0.2s',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#1b6b5a';
              e.currentTarget.style.color = 'white';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'none';
              e.currentTarget.style.color = '#1b6b5a';
            }}>
            📹
          </button>
        </div>

        <div className="msg-messages-area">
          {messages.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#999', fontSize: '14px' }}>
              {isGroup ? 'No messages yet in this group' : 'Send a message to start the conversation'}
            </div>
          ) : (
            messages.map((m, i) => {
              const isSent = m.type === 'sent';
              const showSenderName = isGroup && !isSent;
              const prevMsg = i > 0 ? messages[i - 1] : null;
              const showName = showSenderName && (!prevMsg || prevMsg.sender_id !== m.sender_id || prevMsg.type !== m.type);
              const parseTs = (t) => parseTimestamp(t) || new Date(0);
              const isMsgSwiping = msgSwipingId === m.id;
              const reactions = m.reactions || [];

              return (
                <React.Fragment key={m.id || i}>
                  {i > 0 && (() => {
                    const prevDate = parseTs(messages[i-1].created_at).toDateString();
                    const thisDate = parseTs(m.created_at).toDateString();
                    return prevDate !== thisDate ? (
                      <div style={{ textAlign: 'center', margin: '16px 0 8px', fontSize: '11px', color: '#aaa' }}>
                        {parseTs(m.created_at).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
                      </div>
                    ) : null;
                  })()}
                  <div style={{ position: 'relative' }}
                    onTouchStart={(e) => onMsgTouchStart(e, m)}
                    onTouchMove={(e) => onMsgTouchMove(e, m)}
                    onTouchEnd={() => onMsgTouchEnd(m)}>
                    {/* Reply arrow indicator on swipe */}
                    {isMsgSwiping && (
                      <div style={{ position: 'absolute', left: 4, top: '50%', transform: 'translateY(-50%)', opacity: msgSwipeOffset > 20 ? Math.min((msgSwipeOffset - 20) / 30, 1) : 0, fontSize: 18, color: '#1b6b5a', transition: 'opacity 0.1s' }}>
                        ↩
                      </div>
                    )}
                    <div style={{
                      display: 'flex', justifyContent: isSent ? 'flex-end' : 'flex-start', marginBottom: reactions.length > 0 ? '16px' : '4px',
                      transform: isMsgSwiping ? 'translateX(' + msgSwipeOffset + 'px)' : 'none',
                      transition: isMsgSwiping ? 'none' : 'transform 0.2s',
                    }}>
                      {showSenderName && !isSent && (() => {
                        const senderMember = activeConv?.members?.find(mb => mb.id === m.sender_id);
                        const senderPhoto = senderMember?.profilePhoto || null;
                        return senderPhoto ? (
                          <img src={senderPhoto} alt={m.senderName} style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, marginRight: 6, marginTop: showName ? 18 : 0 }} />
                        ) : (
                          <div style={{ width: 28, height: 28, borderRadius: '50%', background: getAvatarColor(m.senderName || ''), display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 10, fontWeight: 600, flexShrink: 0, marginRight: 6, marginTop: showName ? 18 : 0 }}>
                            {getInitials(m.senderName || '')}
                          </div>
                        );
                      })()}
                      <div style={{ maxWidth: '75%', position: 'relative' }}
                        className="msg-bubble-wrap"
                        onMouseEnter={(e) => {
                          const actions = e.currentTarget.querySelector('.msg-hover-actions');
                          if (actions) actions.style.opacity = '1';
                        }}
                        onMouseLeave={(e) => {
                          const actions = e.currentTarget.querySelector('.msg-hover-actions');
                          if (actions) actions.style.opacity = '0';
                          if (showEmojiFor === m.id) setShowEmojiFor(null);
                        }}>
                        {showName && (
                          <div style={{ fontSize: 11, color: getAvatarColor(m.senderName || ''), fontWeight: 600, marginBottom: 2, marginLeft: 4 }}>
                            {m.senderName}
                          </div>
                        )}
                        {/* Reply quote */}
                        {m.replyTo && (
                          <div style={{
                            padding: '6px 10px', marginBottom: -6, borderRadius: isSent ? '12px 12px 0 0' : '12px 12px 0 0',
                            background: isSent ? '#15594b' : '#e4e4e4', fontSize: 12, lineHeight: 1.3,
                            borderLeft: isSent ? '3px solid rgba(255,255,255,0.4)' : '3px solid #1b6b5a',
                          }}>
                            <div style={{ fontWeight: 600, fontSize: 11, color: isSent ? 'rgba(255,255,255,0.7)' : '#1b6b5a', marginBottom: 1 }}>
                              {m.replyTo.senderName || 'Unknown'}
                            </div>
                            <div style={{ color: isSent ? 'rgba(255,255,255,0.6)' : '#777', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
                              {m.replyTo.content}
                            </div>
                          </div>
                        )}
                        <div style={{
                          padding: '10px 14px',
                          borderRadius: m.replyTo ? (isSent ? '0 0 4px 18px' : '0 0 18px 4px') : (isSent ? '18px 18px 4px 18px' : '18px 18px 18px 4px'),
                          background: isSent ? '#1b6b5a' : '#f0f0f0',
                          color: isSent ? 'white' : '#333',
                          fontSize: '14px', lineHeight: 1.45, wordWrap: 'break-word',
                        }}>
                          {renderMessageContent(m.content)}
                          <div style={{ fontSize: '10px', color: isSent ? 'rgba(255,255,255,0.6)' : '#bbb', marginTop: '4px', textAlign: 'right' }}>
                            {(() => {
                              const d = parseTimestamp(m.created_at);
                              if (!d) return '';
                              const now = new Date();
                              const isToday = d.toDateString() === now.toDateString();
                              const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
                              const isYesterday = d.toDateString() === yesterday.toDateString();
                              const timeStr = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
                              if (isToday) return timeStr;
                              if (isYesterday) return 'Yesterday ' + timeStr;
                              return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + timeStr;
                            })()}
                          </div>
                        </div>
                        {/* Reaction pills below bubble */}
                        {reactions.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4, justifyContent: isSent ? 'flex-end' : 'flex-start' }}>
                            {Object.entries(reactions.reduce((acc, r) => {
                              acc[r.emoji] = acc[r.emoji] || [];
                              acc[r.emoji].push(r);
                              return acc;
                            }, {})).map(([emoji, rList]) => (
                              <button key={emoji} onClick={() => handleReaction(m.id, emoji)}
                                title={rList.map(r => r.userName).join(', ')}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 3, padding: '2px 6px',
                                  background: rList.some(r => r.userId === currentUser?.id) ? '#e8f5e9' : '#f5f5f5',
                                  border: rList.some(r => r.userId === currentUser?.id) ? '1px solid #1b6b5a' : '1px solid #e0e0e0',
                                  borderRadius: 12, fontSize: 13, cursor: 'pointer', lineHeight: 1,
                                }}>
                                <span>{emoji}</span>
                                {rList.length > 1 && <span style={{ fontSize: 10, color: '#666' }}>{rList.length}</span>}
                              </button>
                            ))}
                          </div>
                        )}
                        {/* Desktop hover actions: reply + emoji */}
                        <div className="msg-hover-actions" style={{
                          position: 'absolute', top: m.replyTo ? 0 : -8,
                          [isSent ? 'left' : 'right']: -8,
                          transform: isSent ? 'translateX(-100%)' : 'translateX(100%)',
                          display: 'flex', gap: 2, opacity: 0, transition: 'opacity 0.15s',
                          background: '#fff', borderRadius: 8, boxShadow: '0 1px 6px rgba(0,0,0,0.1)', padding: '2px',
                        }}>
                          <button onClick={() => { setReplyTo(m); if (inputRef.current) inputRef.current.focus(); }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', fontSize: 14, borderRadius: 6 }}
                            title="Reply">
                            ↩
                          </button>
                          <button onClick={() => setShowEmojiFor(showEmojiFor === m.id ? null : m.id)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', fontSize: 14, borderRadius: 6 }}
                            title="React">
                            😀
                          </button>
                        </div>
                        {/* Emoji picker popover */}
                        {showEmojiFor === m.id && (
                          <div style={{
                            position: 'absolute', bottom: '100%', marginBottom: 4,
                            [isSent ? 'right' : 'left']: 0,
                            background: '#fff', borderRadius: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
                            padding: '6px 8px', display: 'flex', gap: 2, zIndex: 10,
                          }}>
                            {REACTION_EMOJIS.map(emoji => (
                              <button key={emoji} onClick={() => handleReaction(m.id, emoji)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, padding: '4px', borderRadius: 8, transition: 'background 0.15s' }}
                                onMouseEnter={(e) => e.currentTarget.style.background = '#f0f0f0'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'none'}>
                                {emoji}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Reply preview bar */}
        {replyTo && (
          <div style={{
            display: 'flex', alignItems: 'center', padding: '8px 16px', background: '#f0faf7',
            borderTop: '1px solid #e0e0e0', borderLeft: '3px solid #1b6b5a', gap: 10,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#1b6b5a' }}>
                Replying to {replyTo.senderName || 'message'}
              </div>
              <div style={{ fontSize: 12, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {replyTo.content}
              </div>
            </div>
            <button onClick={() => setReplyTo(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: 18, padding: '0 4px', flexShrink: 0 }}>
              ×
            </button>
          </div>
        )}
        <div className="msg-input-area">
          <input
            ref={inputRef}
            type="text"
            className="msg-input"
            placeholder={replyTo ? "Type your reply..." : "Type a message..."}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
            disabled={sending}
          />
          <button className="msg-send-btn" onClick={handleSendMessage} disabled={sending || !inputText.trim()}>
            {sending ? (
              <span style={{ display: 'inline-block', width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }}></span>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            )}
          </button>
        </div>
      </div>
    );
  };

  // ─── Incoming call banner ───
  const renderIncomingCallBanner = () => {
    if (!incomingCall) return null;
    const emoji = incomingCall.callType === 'video' ? '📹' : '📞';
    const typeLabel = incomingCall.callType === 'video' ? 'Video' : 'Voice';
    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
        background: 'linear-gradient(135deg, #1b6b5a, #2a9d8f)',
        padding: '16px 24px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', color: 'white', boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        animation: 'slideDown 0.3s ease',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 28, animation: 'pulse 1s infinite' }}>{emoji}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{incomingCall.callerName || 'Someone'}</div>
            <div style={{ fontSize: 13, opacity: 0.85 }}>Incoming {typeLabel} Call</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={handleDeclineIncoming}
            style={{ padding: '8px 20px', borderRadius: 20, border: 'none', background: '#e74c3c', color: 'white', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
            Decline
          </button>
          <button onClick={handleAcceptIncoming}
            style={{ padding: '8px 20px', borderRadius: 20, border: 'none', background: 'white', color: '#1b6b5a', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
            Accept
          </button>
        </div>
      </div>
    );
  };

  // ─── Layout ───
  const callOverlay = React.createElement(VideoCallOverlay, {
    callState: callState,
    onEndCall: handleEndCall,
    currentUserId: currentUser?.id,
  });

  if (isMobile) {
    return (
      <>
        {renderIncomingCallBanner()}
        {callOverlay}
        {showFindPeople ? renderFindPeople() : showNewChat ? renderNewChatPicker() : activeConvId ? renderChatView() : renderConversationList()}
      </>
    );
  }

  // Desktop: side-by-side
  return (
    <>
      {renderIncomingCallBanner()}
      {callOverlay}
      <div style={{ display: 'flex', height: 'calc(100vh - 120px)', background: 'white', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 8px rgba(0,0,0,0.08)' }}>
        <div style={{ width: '320px', borderRight: '1px solid #e8e8e8', display: 'flex', flexDirection: 'column', background: '#fafafa' }}>
          {showFindPeople ? renderFindPeople() : showNewChat ? renderNewChatPicker() : renderConversationList()}
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {activeConvId ? renderChatView() : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#ccc' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '64px', marginBottom: '16px' }}>💬</div>
                <div style={{ fontSize: '16px', color: '#999' }}>Select a conversation</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
