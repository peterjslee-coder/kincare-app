const Messages = window.Messages = () => {
  const [conversations, setConversations] = useState([]);
  const [activePartnerId, setActivePartnerId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);

  // Fetch conversations list
  const fetchConversations = async () => {
    try {
      const res = await apiFetch('/api/messages/conversations');
      if (res?.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
        // Auto-select first conversation if none selected
        if (!activePartnerId && data.conversations?.length > 0) {
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

  useEffect(() => { fetchConversations(); }, []);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSelectConversation = (partnerId) => {
    setActivePartnerId(partnerId);
    fetchMessages(partnerId);
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
    const dateStr = ts.replace(' ', 'T') + 'Z';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>Loading messages...</div>;
  }

  return (
    <div style={{ height: 'calc(100vh - 200px)', display: 'flex', flexDirection: 'column' }}>
      <h1 className="greeting" style={{ marginBottom: '16px' }}>Messages</h1>
      <div className="chat-container">
        <div className="chat-sidebar">
          {conversations.length > 0 ? conversations.map(c => (
            <div key={c.partnerId}
              className={`chat-contact ${activePartnerId === c.partnerId ? 'active' : ''}`}
              onClick={() => handleSelectConversation(c.partnerId)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="chat-contact-name">{c.partnerName}</div>
                {c.unreadCount > 0 && (
                  <span style={{
                    background: '#e8724a', color: '#fff', borderRadius: '10px',
                    padding: '1px 7px', fontSize: '11px', fontWeight: 600,
                  }}>{c.unreadCount}</span>
                )}
              </div>
              <div className="chat-contact-preview">{c.lastMessage}</div>
              <div style={{ fontSize: '11px', color: '#aaa', marginTop: '2px' }}>{formatTime(c.lastMessageAt)}</div>
            </div>
          )) : (
            <div style={{ padding: '20px', color: '#999', textAlign: 'center', fontSize: '13px' }}>
              No conversations yet
            </div>
          )}
        </div>
        <div className="chat-main">
          {activeConv ? (
            <>
              <div className="chat-header">
                <h3>{activeConv.partnerName}</h3>
              </div>
              <div className="chat-messages">
                {messages.map(m => (
                  <div key={m.id} className={`chat-message ${m.type}`}>
                    <div className="chat-message-bubble">
                      {m.content}
                      <div style={{ fontSize: '10px', color: m.type === 'sent' ? 'rgba(255,255,255,0.7)' : '#aaa', marginTop: '4px' }}>
                        {formatTime(m.created_at)}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
              <div className="chat-input-area">
                <input type="text" className="chat-input"
                  placeholder="Type a message..."
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                  disabled={sending}
                />
                <button className="chat-send-btn" onClick={handleSendMessage} disabled={sending || !inputText.trim()}>
                  {sending ? '...' : 'Send'}
                </button>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#999' }}>
              Select a conversation to start messaging
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
