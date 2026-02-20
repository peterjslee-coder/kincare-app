const Messages = window.Messages = () => {
  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [activeConvType, setActiveConvType] = useState('direct');
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [selectedContacts, setSelectedContacts] = useState([]);
  const [groupName, setGroupName] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const isMobile = window.innerWidth <= 768;

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
    setActiveConvId(conv.id);
    setActiveConvType(conv.type || 'direct');
    setShowNewChat(false);
    setCreatingGroup(false);
    fetchMessages(conv.id);
  };

  const handleBack = () => {
    setActiveConvId(null);
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
        body: JSON.stringify({ content: inputText }),
      });
      if (res?.ok) {
        const data = await res.json();
        setInputText('');
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

  const handleStartVideoCall = async () => {
    const meetLink = 'https://meet.google.com/new';
    const message = `📹 Started a video call — join here: ${meetLink}`;
    setInputText(message);
    // Use a small timeout to ensure state is updated, then send
    setTimeout(() => {
      setSending(true);
      apiFetch(`/api/messages/conversations/${activeConvId}`, {
        method: 'POST',
        body: JSON.stringify({ content: message }),
      })
        .then(res => {
          if (res?.ok) {
            setInputText('');
            return res.json();
          }
          throw new Error('Failed to send');
        })
        .then(data => {
          fetchMessages(data.conversationId || activeConvId);
          fetchConversations();
        })
        .catch(err => console.error('Video call message error:', err))
        .finally(() => setSending(false));
    }, 50);
  };

  const renderMessageContent = (content) => {
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
    // PostgreSQL timestamps may have timezone offset (+00, +00:00) or not
    let dateStr = ts;
    if (!dateStr.includes('T')) {
      dateStr = dateStr.replace(' ', 'T');
    }
    // Only append Z if there's no timezone indicator already
    if (!/[Zz]$/.test(dateStr) && !/[+-]\d{2}(:\d{2})?$/.test(dateStr)) {
      dateStr += 'Z';
    }
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';
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

  // ─── Conversation List ───
  const renderConversationList = () => (
    <div className="msg-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="msg-list-header">
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#333', margin: 0 }}>Messages</h1>
        <button onClick={handleNewChat}
          style={{ background: '#1b6b5a', color: 'white', border: 'none', borderRadius: '50%', width: '36px', height: '36px', fontSize: '20px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
          title="New message">
          +
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {conversations.length > 0 ? conversations.map(c => {
          const isGroup = isGroupConv(c);
          const typeIcon = c.type === 'care_team' ? '👥' : c.type === 'group' ? '💬' : null;
          return (
            <div key={c.id}
              className={`msg-conv-item ${activeConvId === c.id ? 'active' : ''}`}
              onClick={() => handleSelectConversation(c)}>
              <div style={{
                width: '44px', height: '44px', borderRadius: isGroup ? '12px' : '50%',
                background: isGroup ? '#e8f5e9' : getAvatarColor(c.name),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: isGroup ? '#1b6b5a' : 'white', fontSize: isGroup ? '20px' : '15px',
                fontWeight: 600, flexShrink: 0,
              }}>
                {isGroup ? (typeIcon || '👥') : getInitials(c.name)}
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
          );
        }) : (
          <div style={{ padding: '60px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>💬</div>
            <div style={{ fontSize: '15px', color: '#666', marginBottom: '8px' }}>No conversations yet</div>
            <div style={{ fontSize: '13px', color: '#999', marginBottom: '20px' }}>Start a conversation with someone in your care network</div>
            <button onClick={handleNewChat}
              style={{ background: '#1b6b5a', color: 'white', border: 'none', borderRadius: '8px', padding: '10px 24px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
              New Message
            </button>
          </div>
        )}
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
              <div style={{
                width: '36px', height: '36px', borderRadius: isGroup ? '10px' : '50%',
                background: isGroup ? '#e8f5e9' : getAvatarColor(activeConv.name),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: isGroup ? '#1b6b5a' : 'white', fontSize: isGroup ? '18px' : '13px', fontWeight: 600,
              }}>
                {isGroup ? (activeConv.type === 'care_team' ? '👥' : '💬') : getInitials(activeConv.name)}
              </div>
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
            className="msg-video-call-btn"
            onClick={handleStartVideoCall}
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
              // Show sender name if different from previous message sender
              const prevMsg = i > 0 ? messages[i - 1] : null;
              const showName = showSenderName && (!prevMsg || prevMsg.sender_id !== m.sender_id || prevMsg.type !== m.type);

              const parseTs = (t) => { if (!t) return new Date(0); let d = t.includes('T') ? t : t.replace(' ', 'T'); if (!/[Zz]$/.test(d) && !/[+-]\d{2}(:\d{2})?$/.test(d)) d += 'Z'; return new Date(d); };

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
                  <div style={{ display: 'flex', justifyContent: isSent ? 'flex-end' : 'flex-start', marginBottom: '4px' }}>
                    {showSenderName && !isSent && (
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: getAvatarColor(m.senderName || ''), display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 10, fontWeight: 600, flexShrink: 0, marginRight: 6, marginTop: showName ? 18 : 0 }}>
                        {getInitials(m.senderName || '')}
                      </div>
                    )}
                    <div style={{ maxWidth: '75%' }}>
                      {showName && (
                        <div style={{ fontSize: 11, color: getAvatarColor(m.senderName || ''), fontWeight: 600, marginBottom: 2, marginLeft: 4 }}>
                          {m.senderName}
                        </div>
                      )}
                      <div style={{
                        padding: '10px 14px',
                        borderRadius: isSent ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                        background: isSent ? '#1b6b5a' : '#f0f0f0',
                        color: isSent ? 'white' : '#333',
                        fontSize: '14px',
                        lineHeight: 1.45,
                        wordWrap: 'break-word',
                      }}>
                        {renderMessageContent(m.content)}
                        <div style={{ fontSize: '10px', color: isSent ? 'rgba(255,255,255,0.6)' : '#bbb', marginTop: '4px', textAlign: 'right' }}>
                          {formatTime(m.created_at)}
                        </div>
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="msg-input-area">
          <input
            ref={inputRef}
            type="text"
            className="msg-input"
            placeholder="Type a message..."
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

  // ─── Layout ───
  if (isMobile) {
    if (showNewChat) return renderNewChatPicker();
    if (activeConvId) return renderChatView();
    return renderConversationList();
  }

  // Desktop: side-by-side
  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 120px)', background: 'white', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 8px rgba(0,0,0,0.08)' }}>
      <div style={{ width: '320px', borderRight: '1px solid #e8e8e8', display: 'flex', flexDirection: 'column', background: '#fafafa' }}>
        {showNewChat ? renderNewChatPicker() : renderConversationList()}
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
  );
};
