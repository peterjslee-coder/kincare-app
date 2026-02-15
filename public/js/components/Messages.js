const Messages = window.Messages = () => {
  const [contacts] = useState([
    { id: 'maria', name: 'Maria Santos', status: 'online', preview: 'She had a wonderful lunch today!' },
    { id: 'james', name: 'James Okafor', status: 'online', preview: 'I\'ll bring the puzzle book tomorrow' },
    { id: 'sarah', name: 'Sarah Chen', status: 'offline', preview: 'Her blood pressure was good today' }
  ]);

  const [messages] = useState({
    maria: [
      { id: 1, sender: 'Maria', type: 'received', text: 'Good morning! Betty is in great spirits today. We just finished breakfast - she had oatmeal with blueberries, her favorite!' },
      { id: 2, sender: 'You', type: 'sent', text: 'That\'s wonderful to hear! How was she feeling this morning?' },
      { id: 3, sender: 'Maria', type: 'received', text: 'She was very alert and chatty. We looked through her photo album and she told me stories about her garden.' },
      { id: 4, sender: 'You', type: 'sent', text: 'She loves that album! Thank you for spending time with her on that.' },
      { id: 5, sender: 'Maria', type: 'received', text: 'She had a wonderful lunch today! We made sandwiches together. She really enjoys helping in the kitchen.' },
      { id: 6, sender: 'You', type: 'sent', text: 'How was mom today? Thank you so much for your help, Maria.' }
    ],
    james: [
      { id: 1, sender: 'James', type: 'received', text: 'Hi Pete! Just arrived at Betty\'s. She seems to be doing well today.' },
      { id: 2, sender: 'You', type: 'sent', text: 'Great, thanks James! She mentioned wanting to do puzzles.' },
      { id: 3, sender: 'James', type: 'received', text: 'Yes! We worked on a 500-piece puzzle of a garden scene. She was really focused.' },
      { id: 4, sender: 'You', type: 'sent', text: 'That\'s great for her cognitive stimulation. Thanks!' },
      { id: 5, sender: 'James', type: 'received', text: 'I\'ll bring the puzzle book tomorrow. She really liked the crossword we started.' }
    ],
    sarah: [
      { id: 1, sender: 'Sarah', type: 'received', text: 'Just finished helping Betty with her afternoon medications. Everything went smoothly.' },
      { id: 2, sender: 'You', type: 'sent', text: 'Thank you Sarah. Did she take everything without any issues?' },
      { id: 3, sender: 'Sarah', type: 'received', text: 'Yes, no problems at all. Her blood pressure was good today - 128/82.' },
      { id: 4, sender: 'You', type: 'sent', text: 'That\'s encouraging! The doctor will be happy to hear that.' },
      { id: 5, sender: 'Sarah', type: 'received', text: 'I also helped her with some light stretching exercises. She\'s getting more flexible!' }
    ]
  });

  const [activeContactId, setActiveContactId] = useState('maria');
  const [inputText, setInputText] = useState('');
  const [chatMessages, setChatMessages] = useState(messages.maria);

  const handleContactChange = (contactId) => {
    setActiveContactId(contactId);
    setChatMessages(messages[contactId] || []);
  };

  const handleSendMessage = () => {
    if (inputText.trim()) {
      setChatMessages([...chatMessages, { id: Date.now(), sender: 'You', type: 'sent', text: inputText }]);
      setInputText('');
    }
  };

  const activeContact = contacts.find(c => c.id === activeContactId);

  return (
    <div style={{ height: 'calc(100vh - 200px)', display: 'flex', flexDirection: 'column' }}>
      <h1 className="greeting" style={{ marginBottom: '16px' }}>💬 Messages</h1>
      <div className="chat-container">
        <div className="chat-sidebar">
          {contacts.map(c => (
            <div key={c.id} className={`chat-contact ${activeContactId === c.id ? 'active' : ''}`} onClick={() => handleContactChange(c.id)}>
              <div className="chat-contact-name">{c.name}</div>
              <div className="chat-contact-preview">{c.preview}</div>
              <div className={`chat-contact-status ${c.status}`}>{c.status === 'online' ? '🟢 Online' : '⚫ Offline'}</div>
            </div>
          ))}
        </div>
        <div className="chat-main">
          {activeContact && (
            <>
              <div className="chat-header">
                <h3>{activeContact.name}</h3>
              </div>
              <div className="chat-messages">
                {chatMessages.map(m => (
                  <div key={m.id} className={`chat-message ${m.type}`}>
                    <div className="chat-message-bubble">{m.text}</div>
                  </div>
                ))}
              </div>
              <div className="chat-input-area">
                <input type="text" className="chat-input" placeholder="Type a message..." value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()} />
                <button className="chat-send-btn" onClick={handleSendMessage}>Send</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
