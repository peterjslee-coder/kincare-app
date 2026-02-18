const Messages = window.Messages = () => {
  const [conversations, setConversations] = useState([]);
  const [activePartnerId, setActivePartnerId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
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
        // On desktop, auto-select first conversation
        if (!isMobile && !activePartnerId && data.conversations?.length > 0) {
          const first = data.conversations[0];
          setActivePartnerId(first.partnerId);
          fetchMessages(first.partnerId);
        }
      }
    } catch (err) {
      console.error('Fetch conversations error:', err);
    }
    setLoading(false);
  };

  // Fetch messages for a partner
  const fetchMessages = async (partnerId) => {
    try {
      const res = await apiFetch(`/api/messages/${partnerId}`);
      if (res?.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch (err) {
      console.error('Fetch messages error:', err);
    }
  };

  // Fetch contacts for new chat
  const fetchContacts = async () => {
    setContactsLoading(true);
    try {
      const res = await apiFetch('/api/messages/contacts');
      if (res?.ok) {
        const data = await res.json();
        // Filter out people who already have conversations
        const existingPartnerIds = conversations.map(c => c.partnerId);
        const newContacts = (data.contacts || []).filter(c => !existingPartnerIds.includes(c.id));
        setContacts(newContacts);
      }
    } catch (err) {
      console.error('Fetch contacts error:', err);
    }
    setContactsLoading(false);
  };

  useEffect(() => { fetchConversations(); }, []);

  // Listen for real-time incoming messages
  useEffect(() => {
    if (typeof onSocketEvent !== 'function') return;
    const cleanup = onSocketEvent('new_message', (msg) => {
      // If viewing this conversation, add message directly
      if (msg.sender_id === activePartnerId) {
        setMessages(prev => [...prev, msg]);
      }
      // Refresh conversation list to update previews & unread counts
      fetchConversations();
    });
    return cleanup;
  }, [activePartnerId]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Focus input when opening a chat
  useEffect(() => {
    if (activePartnerId && inputRef.current) {
      setTimeout(() => inputRef.current.focus(), 100);
    }
  }, [activePartnerId]);

  const handleSelectConversation = (partnerId) => {
    setActivePartnerId(partnerId);
    setShowNewChat(false);
    fetchMessages(partnerId);
  };

  const handleBack = () => {
    setActivePartnerId(null);
    setMessages([]);
    fetchConversations();
  };

  const handleNewChat = () => {
    setShowNewChat(true);
    fetchContacts();
  };

  const handleSelectContact = (contact) => {
    setShowNewChat(false);
    setActivePartnerId(contact.id);
    // Check if conversation already exists
    const existing = conversations.find(c => c.partnerId === contact.id);
    if (existing) {
      fetchMessages(contact.id);
    } else {
      // New conversation — just open empty chat
      setMessages([]);
      // Temporarily add to conversations for display
      setConversations(prev => [{
        partnerId: contact.id,
        partnerName: contact.name,
        partnerRole: contact.role,
        lastMessage: '',
        lastMessageAt: null,
        unreadCount: 0,
      }, ...prev]);
    }
  };

  const handleSendMessage = async () => {
    if (!inputText.trim() || !activePartnerId) return;
    setSending(true);
    try {
      const res = await apiFetch('/api/messages', {
        method: 'POST',
        body: JSON.stringify({ recipientId: activePartnerId, content: inputText }),
      });
      if (res?.ok) {
        setInputText('');
        await fetchMessages(activePartnerId);
        await fetchConversations();
      }
    } catch (err) {
      console.error('Send message error:', err);
    }
    setSending(false);
  };

  const activeConv = conversations.find(c => c.partnerId === activePartnerId);

  const formatTime = (ts) => {
    if (!ts) return '';
    const dateStr = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
    const date = new Date(dateStr);
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

  if (loading) {
    return React.createElement(LoadingSpinner, { text: 'Loading messages...' });
  }

  // ─── New Chat Contact Picker ───
  const renderNewChatPicker = () => (
    <div className="msg-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="msg-chat-header">
        <button className="msg-back-btn" onClick={() => setShowNewChat(false)}
          style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', color: '#1b6b5a', padding: '4px 8px', marginRight: '8px' }}>
          ‹
        </button>
        <div style={{ fontWeight: 600, fontSize: '16px', color: '#333' }}>New Message</div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {contactsLoading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>Loading contacts...</div>
        ) : contacts.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#999', fontSize: '14px' }}>
            You already have conversations with everyone in the system.
          </div>
        ) : (
          contacts.map(c => (
            <div key={c.id} className="msg-contact-item" onClick={() => handleSelectContact(c)}
              style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0', transition: 'background 0.15s' }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#f8f9fa'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
              <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: getAvatarColor(c.name), display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '14px', fontWeight: 600, flexShrink: 0 }}>
                {getInitials(c.name)}
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '14px', color: '#333' }}>{c.name}</div>
                <div style={{ fontSize: '12px', color: '#999' }}>{roleLabel(c.role)}</div>
              </div>
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
        <button onClick={handleNewChat}
          style={{ background: '#1b6b5a', color: 'white', border: 'none', borderRadius: '50%', width: '36px', height: '36px', fontSize: '20px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
          title="New message">
          +
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {conversations.length > 0 ? conversations.map(c => (
          <div key={c.partnerId}
            className={`msg-conv-item ${activePartnerId === c.partnerId ? 'active' : ''}`}
            onClick={() => handleSelectConversation(c.partnerId)}>
            <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: getAvatarColor(c.partnerName), display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '15px', fontWeight: 600, flexShrink: 0 }}>
              {getInitials(c.partnerName)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                <span style={{ fontWeight: c.unreadCount > 0 ? 700 : 600, fontSize: '14px', color: '#333' }}>{c.partnerName}</span>
                <span style={{ fontSize: '11px', color: c.unreadCount > 0 ? '#1b6b5a' : '#aaa', fontWeight: c.unreadCount > 0 ? 600 : 400, flexShrink: 0, marginLeft: '8px' }}>{formatTime(c.lastMessageAt)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', color: c.unreadCount > 0 ? '#555' : '#999', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: c.unreadCount > 0 ? 500 : 400 }}>
                  {c.lastMessage || 'No messages yet'}
                </span>
                {c.unreadCount > 0 && (
                  <span style={{ background: '#1b6b5a', color: '#fff', borderRadius: '10px', padding: '1px 7px', fontSize: '11px', fontWeight: 600, flexShrink: 0, marginLeft: '8px', minWidth: '18px', textAlign: 'center' }}>
                    {c.unreadCount}
                  </span>
                )}
              </div>
            </div>
          </div>
        )) : (
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
  const renderChatView = () => (
    <div className="msg-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="msg-chat-header">
        {(isMobile || !conversations.length) && (
          <button className="msg-back-btn" onClick={handleBack}
            style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', color: '#1b6b5a', padding: '4px 8px', marginRight: '4px' }}>
            ‹
          </button>
        )}
        {activeConv && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: getAvatarColor(activeConv.partnerName), display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '13px', fontWeight: 600 }}>
              {getInitials(activeConv.partnerName)}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: '15px', color: '#333', lineHeight: 1.2 }}>{activeConv.partnerName}</div>
              <div style={{ fontSize: '11px', color: '#999' }}>{roleLabel(activeConv.partnerRole)}</div>
            </div>
          </div>
        )}
      </div>

      <div className="msg-messages-area">
        {messages.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#999', fontSize: '14px' }}>
            Send a message to start the conversation
          </div>
        ) : (
          messages.map((m, i) => {
            const isSent = m.type === 'sent';
            const showDate = i === 0 || formatTime(messages[i-1]?.created_at) !== formatTime(m.created_at);
            return (
              <React.Fragment key={m.id}>
                {showDate && i > 0 && messages[i-1] && (
                  (() => {
                    const prevDate = new Date((messages[i-1].created_at || '').replace(' ', 'T') + 'Z').toDateString();
                    const thisDate = new Date((m.created_at || '').replace(' ', 'T') + 'Z').toDateString();
                    return prevDate !== thisDate ? (
                      <div style={{ textAlign: 'center', margin: '16px 0 8px', fontSize: '11px', color: '#aaa' }}>
                        {new Date((m.created_at || '').replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
                      </div>
                    ) : null;
                  })()
                )}
                <div style={{ display: 'flex', justifyContent: isSent ? 'flex-end' : 'flex-start', marginBottom: '4px' }}>
                  <div style={{
                    maxWidth: '75%',
                    padding: '10px 14px',
                    borderRadius: isSent ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                    background: isSent ? '#1b6b5a' : '#f0f0f0',
                    color: isSent ? 'white' : '#333',
                    fontSize: '14px',
                    lineHeight: 1.45,
                    wordWrap: 'break-word',
                  }}>
                    {m.content}
                    <div style={{ fontSize: '10px', color: isSent ? 'rgba(255,255,255,0.6)' : '#bbb', marginTop: '4px', textAlign: 'right' }}>
                      {formatTime(m.created_at)}
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

  // ─── Layout ───
  // Mobile: show either list or chat (not both)
  if (isMobile) {
    if (showNewChat) return renderNewChatPicker();
    if (activePartnerId) return renderChatView();
    return renderConversationList();
  }

  // Desktop: side-by-side
  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 120px)', background: 'white', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 8px rgba(0,0,0,0.08)' }}>
      <div style={{ width: '320px', borderRight: '1px solid #e8e8e8', display: 'flex', flexDirection: 'column', background: '#fafafa' }}>
        {showNewChat ? renderNewChatPicker() : renderConversationList()}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {activePartnerId ? renderChatView() : (
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
