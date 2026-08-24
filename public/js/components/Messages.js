const Messages = window.Messages = () => {
  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [activeConvType, setActiveConvType] = useState('direct');
  const [messages, setMessages] = useState([]);
  const [hiddenBefore, setHiddenBefore] = useState(0);
  const [inputText, setInputText] = useState('');
  // Drafts persist to localStorage so they survive page navigation
  const DRAFTS_KEY = 'inplace_msg_drafts';
  const draftsRef = useRef(() => {
    try { return JSON.parse(localStorage.getItem(DRAFTS_KEY)) || {}; } catch { return {}; }
  });
  // Initialize draftsRef from localStorage on first render
  if (typeof draftsRef.current === 'function') draftsRef.current = draftsRef.current();
  const persistDrafts = () => {
    try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(draftsRef.current)); } catch {}
  };
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [messagingLimited, setMessagingLimited] = useState(false);
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
  const [archivedIds, setArchivedIds] = useState([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
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
  const [currentUser, setCurrentUser] = useState(null); const [ipaiRecipientName, setIpaiRecipientName] = useState(null); useEffect(() => { (async () => { try { const res = await apiFetch('/api/care-recipients'); if (res?.ok) { const data = await res.json(); const name = data.careRecipients?.[0]?.name; if (name) setIpaiRecipientName(String(name).trim().split(/\s+/)[0]); } } catch (e) {} })(); }, []); // v1.96.1: personalize iPAi chips (was hardcoded demo names)

  // ─── In-app call state (Twilio Video) ───
  const [callState, setCallState] = useState({ active: false, roomName: null, callType: null, remoteParticipantName: null, remoteParticipantPhoto: null, callDirection: null });
  const [incomingCall, setIncomingCall] = useState(null); // { roomName, callType, callerId, callerName }

  // ─── Typing indicators ───
  const [typingUsers, setTypingUsers] = useState({}); // { conversationId: { userId: { name, timeout } } }
  const typingTimeoutRef = useRef(null);
  const lastTypingEmitRef = useRef(0);
  const inputTextRef = useRef('');
  const activeConvIdRef = useRef(null);
  const photoInputRef = useRef(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [lightboxPhoto, setLightboxPhoto] = useState(null); // { src, caption }

  // ─── Read receipts ───
  const [readReceipts, setReadReceipts] = useState({}); // { conversationId: { userId: readAt } }

  // ─── iPAi instruction suggestion (care coordination) ───
  const [instructionSuggestion, setInstructionSuggestion] = useState(null); // { sessionId, sessionLabel, summary }
  const [savingInstruction, setSavingInstruction] = useState(false);

  const isMobile = window.innerWidth <= 768;

  // Lock body/html scroll on mobile to prevent iOS elastic overscroll
  useEffect(() => {
    if (!isMobile) return;
    const style = document.createElement('style');
    style.setAttribute('data-messages-lock', '1');
    style.textContent = 'html,body{overflow:hidden!important;height:100%!important;position:fixed!important;width:100%!important;} .msg-messages-area{overscroll-behavior:contain;-webkit-overflow-scrolling:touch;}';
    document.head.appendChild(style);
    return () => { if (style.parentNode) style.parentNode.removeChild(style); };
  }, [isMobile]);

  // ─── The keyboard takes the header off the top of the screen (v1.105.131 → .132) ───
  //
  // Pete, 8/24: "they show, but only at the very top of the chat...gotta scroll all the way up
  // to find them. open the keyboard?...they gone to the top." Then, after .131 shipped: "still
  // do not work… if I minimize the keyboard, the button is returned to the top of the screen
  // where I would expect them to be all the time."
  //
  // So the buttons are fine and the header is fine. The KEYBOARD moves them, and .131 did not
  // stop it. Two things were wrong with that attempt:
  //
  //   1. It called window.scrollTo(0, 0). This component injects
  //      `html,body{position:fixed}` on mobile, so the window can never scroll and scrollY is
  //      always 0. That line could not have done anything.
  //   2. It resized `.msg-panel`. The panel is not what is anchored — on mobile the whole of
  //      Messages renders inside a `position: fixed` container pinned `top: 0` to
  //      `bottom: safeBottom + 55`. That container is laid out against the LAYOUT viewport,
  //      and the keyboard changes the VISUAL one.
  //
  // So track the visual viewport and give that container exactly the box the user can see.
  // Deliberately mechanism-agnostic: iOS variously shrinks the layout viewport, offsets the
  // visual viewport, or does both depending on the WebView and the Capacitor keyboard mode,
  // and this reads the same correct answer out of all of them —
  //   keyboard down → offsetTop 0, vv.height = innerHeight → exactly today's box.
  //   keyboard up   → whatever region is genuinely visible.
  //
  // The nav's 55px is only subtracted when the keyboard is DOWN; while typing, the nav is
  // behind the keyboard and reserving space for it is what pushes the composer up into the
  // page (the second thing in his screenshot).
  const [vvBox, setVvBox] = useState(null);     // { top, height } of the visible region
  const [vvShrunk, setVvShrunk] = useState(false);
  // The composer's own focus. Some WebViews shrink the LAYOUT viewport for the keyboard
  // instead of offsetting the visual one, and then no measurement above sees anything at all
  // — innerHeight, vv.height and vv.offsetTop all agree with each other and all are wrong.
  // A focused composer is a keyboard, in every one of them.
  const [inputFocused, setInputFocused] = useState(false);
  // ...but only where focusing an input actually SUMMONS a keyboard. A narrow desktop window
  // is `isMobile` by width and has no keyboard, and treating a click in the composer as one
  // there would hand the panel the nav's 55px and put the composer underneath it.
  const hasSoftKeyboard = typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
  const kbOpen = vvShrunk || (inputFocused && hasSoftKeyboard);

  useEffect(() => {
    if (!isMobile) return;
    const vv = window.visualViewport;
    if (!vv) return; // no API, no change in behaviour
    const apply = () => {
      const top = Math.round(vv.offsetTop || 0);
      const height = Math.round(vv.height);
      // How much of the layout viewport something is covering. A keyboard is >120px; a URL
      // bar collapsing is not.
      //
      // v1.105.133 — .132 also rendered these numbers in a one-line readout above the
      // composer, admin-only, so that if the header was STILL wrong the next report would
      // carry the numbers instead of another inference from a screenshot. Pete confirmed the
      // fix, so it is out again. It did its job by not being needed.
      const hidden = Math.round(window.innerHeight - height - top);
      setVvBox({ top, height });
      setVvShrunk(hidden > 120 || top > 0);
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
    };
  }, [isMobile]);

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
        const allConvs = data.conversations || [];
        setConversations(allConvs);
        setArchivedIds(allConvs.filter(c => c.archivedAt).map(c => c.id));
        if (data.messagingLimited) setMessagingLimited(true);
        if (!isMobile && !activeConvId && allConvs.length > 0) {
          const first = allConvs.find(c => !c.archivedAt) || allConvs[0];
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
        // v1.105.92 — how many messages predate this person joining. Shown as a line at the
        // top of the thread so it reads as a boundary rather than a broken load.
        setHiddenBefore(data.hiddenBefore || 0);
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

  // Archive a conversation (swipe to archive) — persisted server-side
  const handleArchive = async (convId) => {
    setArchivedIds(prev => [...prev, convId]);
    if (activeConvId === convId) { setActiveConvId(null); setMessages([]); }
    showToast('Conversation archived', 'success');
    try { await apiFetch(`/api/messages/conversations/${convId}/archive`, { method: 'PUT' }); }
    catch { /* optimistic update already applied */ }
  };

  // Multi-select archive
  const handleArchiveSelected = async () => {
    if (selectedIds.length === 0) return;
    setArchivedIds(prev => [...new Set([...prev, ...selectedIds])]);
    if (selectedIds.includes(activeConvId)) { setActiveConvId(null); setMessages([]); }
    showToast(`${selectedIds.length} conversation${selectedIds.length > 1 ? 's' : ''} archived`, 'success');
    const toArchive = [...selectedIds];
    setSelectedIds([]);
    setSelectMode(false);
    for (const id of toArchive) {
      try { await apiFetch(`/api/messages/conversations/${id}/archive`, { method: 'PUT' }); }
      catch { /* optimistic */ }
    }
  };

  // Unarchive a conversation — persisted server-side
  const handleUnarchive = async (convId) => {
    setArchivedIds(prev => prev.filter(id => id !== convId));
    showToast('Conversation restored', 'success');
    try { await apiFetch(`/api/messages/conversations/${convId}/unarchive`, { method: 'PUT' }); }
    catch { /* optimistic update already applied */ }
  };

  // Delete a conversation (permanent, server-side)
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  // v1.105.18 — guideline 1.2. Report is silent; block is loud and reversible.
  const [reportFor, setReportFor] = useState(null);
  const [reportCategory, setReportCategory] = useState('');
  const [reportDetails, setReportDetails] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [headerMenu, setHeaderMenu] = useState(false); // mobile-reachable report/block // { x, y, convId }

  const handleDelete = async (convId) => {
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/messages/conversations/${convId}`, { method: 'DELETE' });
      if (res?.ok) {
        setConversations(prev => prev.filter(c => c.id !== convId));
        const updatedArchived = archivedIds.filter(id => id !== convId);
        setArchivedIds(updatedArchived);
        // archived_at cleaned up server-side when conversation is deleted
        if (activeConvId === convId) { setActiveConvId(null); setMessages([]); }
        showToast('Conversation deleted', 'success');
      } else {
        showToast('Failed to delete conversation', 'error');
      }
    } catch { showToast('Failed to delete conversation', 'error'); }
    setDeleting(false);
    setDeleteConfirmId(null);
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.length === 0) return;
    setDeleting(true);
    let deleted = 0;
    for (const id of selectedIds) {
      try {
        const res = await apiFetch(`/api/messages/conversations/${id}`, { method: 'DELETE' });
        if (res?.ok) deleted++;
      } catch {}
    }
    if (deleted > 0) {
      setConversations(prev => prev.filter(c => !selectedIds.includes(c.id)));
      setArchivedIds(prev => prev.filter(id => !selectedIds.includes(id)));
      if (selectedIds.includes(activeConvId)) { setActiveConvId(null); setMessages([]); }
      showToast(`${deleted} conversation${deleted > 1 ? 's' : ''} deleted`, 'success');
    }
    setSelectedIds([]);
    setSelectMode(false);
    setDeleting(false);
  };

  const [showArchived, setShowArchived] = useState(false);

  const toggleSelectId = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
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

  // Keep refs in sync for unmount cleanup
  useEffect(() => { inputTextRef.current = inputText; }, [inputText]);
  useEffect(() => {
    activeConvIdRef.current = activeConvId;
    // Expose to window so native push handler can suppress notifications for active conversation
    window.__activeConversationId = activeConvId;
    return () => { if (window.__activeConversationId === activeConvId) window.__activeConversationId = null; };
  }, [activeConvId]);

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
      // Save any in-progress draft to localStorage when leaving Messages
      if (activeConvIdRef.current && inputTextRef.current?.trim()) {
        draftsRef.current[activeConvIdRef.current] = inputTextRef.current;
      }
      persistDrafts();
    };
  }, []);

  // Listen for real-time incoming messages
  useEffect(() => {
    if (typeof onSocketEvent !== 'function') return;
    const cleanup = onSocketEvent('new_message', (msg) => {
      // Auto-unarchive if message arrives in an archived conversation
      setArchivedIds(prev => {
        if (prev.includes(msg.conversationId)) {
          // New message received — auto-unarchive the conversation
          apiFetch(`/api/messages/conversations/${msg.conversationId}/unarchive`, { method: 'PUT' }).catch(() => {});
          return prev.filter(id => id !== msg.conversationId);
        }
        return prev;
      });
      // If viewing this conversation, add message directly.
      // v1.105.103 — dedupe by id. The socket re-registers its listeners on every reconnect
      // (utils.js connectSocket), so one delivery can arrive twice, and a duplicate in a
      // message thread reads as the other person having said the same thing twice.
      if (msg.conversationId === activeConvId) {
        setMessages(prev => (prev.some(m => m.id === msg.id) ? prev : [...prev, msg]));
      }
      fetchConversations();
    });
    return cleanup;
  }, [activeConvId]);

  // ─── Tell the server which thread is on screen (v1.105.103) ───
  //
  // Pete: "I am on the messaging interface messaging Julia and I get push notifications that
  // Julia has sent a message" (97783012). The server had no way to know he was reading it.
  //
  // `visibilitychange` is half the point, not a nicety: a backgrounded tab or a locked phone
  // still holds an open socket, and someone whose screen is off is not reading the thread.
  // Closing on hide means the worst case is an extra push, never a missing one.
  useEffect(() => {
    const sock = window._socket;
    if (!sock || !activeConvId) return;
    const open = () => sock.emit('conversation_open', { conversationId: activeConvId });
    const close = () => sock.emit('conversation_close', {});
    const onVisibility = () => (document.hidden ? close() : open());
    open();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      close();
    };
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

  // Listen for real-time message deletions
  useEffect(() => {
    if (typeof onSocketEvent !== 'function') return;
    const cleanup = onSocketEvent('message_deleted', (data) => {
      if (data.conversationId === activeConvId) {
        setMessages(prev => prev.map(m =>
          m.id === data.messageId ? { ...m, content: data.tombstone, is_deleted: 1 } : m
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
    persistDrafts();
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
    persistDrafts();
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

    // Direct message — find or create conversation.
    // v1.105.51 — setShowNewChat(false) used to run BEFORE the request, and there was no
    // else, so a failure closed the sheet and dropped you back on the conversation list
    // with nothing opened and no explanation. handleCreateGroup right below was already
    // fixed for exactly this; this one was left.
    try {
      const res = await apiFetch('/api/messages/conversations', {
        method: 'POST',
        body: JSON.stringify({ type: 'direct', memberIds: [contact.id] }),
      });
      if (!res?.ok) {
        showToast("Couldn't open that conversation — please try again.", 'error');
        return;
      }
      const data = await res.json();
      setShowNewChat(false);
      setActiveConvId(data.conversationId);
      setActiveConvType('direct');
      fetchMessages(data.conversationId);
      fetchConversations();
    } catch (err) {
      console.error('Create conversation error:', err);
      showToast("Couldn't open that conversation — check your connection.", 'error');
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
      if (!res?.ok) {
        // v1.105.37 — this failed silently AND stranded the screen: the two setters that
        // exit group-creation mode live inside the ok branch below, so on failure the user
        // was left in a half-built group with no message.
        const d = await res?.json().catch(() => ({}));
        showToast((d && d.error) || 'Could not create the group — please try again', 'error');
        setCreatingGroup(false);
        return;
      }
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
      // Check if this is an iPAi conversation
      const activeConv = conversations.find(c => c.id === activeConvId);
      const isIPAiConv = activeConvId === '__ipai__' ||
        activeConv?.name === 'iPAi' ||
        activeConv?.otherName === 'iPAi Assistant' ||
        activeConv?.otherName === 'iPAi' ||
        activeConv?.members?.some(m => m.name === 'iPAi Assistant' || m.email === 'ipai@yourinplace.com');

      if (isIPAiConv) {
        // Route through iPAi chat endpoint
        const res = await apiFetch('/api/ipai/chat', {
          method: 'POST',
          body: JSON.stringify({ message: inputText }),
        });
        if (res?.ok) {
          const data = await res.json();
          setInputText('');
          setReplyTo(null);
          // Update conversation ID if this was the first message
          if (data.conversationId && data.conversationId !== activeConvId) {
            setActiveConvId(data.conversationId);
          }
          // Check for care coordination suggestion
          const instrAction = (data.actions || []).find(a => a.type === 'suggest_instructions');
          if (instrAction && instrAction.sessionId && instrAction.summary) {
            setInstructionSuggestion({
              sessionId: instrAction.sessionId,
              sessionLabel: instrAction.sessionLabel || 'Upcoming session',
              summary: instrAction.summary,
            });
          }
          await fetchMessages(data.conversationId || activeConvId);
          await fetchConversations();
        } else {
          const err = await res?.json().catch(() => ({}));
          if (typeof showToast === 'function') showToast(err?.error || 'iPAi is temporarily unavailable', 'error');
        }
      } else {
        // Regular message send
        const sentText = inputText;
        const res = await apiFetch(`/api/messages/conversations/${activeConvId}`, {
          method: 'POST',
          body: JSON.stringify({ content: inputText, replyToId: replyTo?.id || null }),
        });
        if (res?.ok) {
          const data = await res.json();
          setInputText('');
          setReplyTo(null);
          delete draftsRef.current[activeConvId];
          persistDrafts();
          if (data.conversationId && data.conversationId !== activeConvId) {
            setActiveConvId(data.conversationId);
          }
          await fetchMessages(data.conversationId || activeConvId);
          await fetchConversations();
          // Background: check if message contains caregiver instructions
          if (sentText.length >= 15) {
            apiFetch('/api/ipai/detect-instructions', {
              method: 'POST',
              body: JSON.stringify({ message: sentText }),
            }).then(async (dr) => {
              if (dr?.ok) {
                const dd = await dr.json();
                if (dd.suggestion && dd.suggestion.sessionId && dd.suggestion.summary) {
                  setInstructionSuggestion(dd.suggestion);
                }
              }
            }).catch(() => {});
          }
        }
      }
    } catch (err) {
      console.error('Send message error:', err);
    }
    setSending(false);
  };

  // ─── Photo upload ───
  const handlePhotoUpload = async (e) => {
    let file = e.target.files?.[0];
    if (!file || !activeConvId) return;
    // Reset input so same file can be re-selected
    if (photoInputRef.current) photoInputRef.current.value = '';

    if (!file.type.startsWith('image/')) {
      showToast('Only image files are allowed', 'error');
      return;
    }
    // v1.104.0 — auto-downscale so big camera photos never hit the 5MB wall
    file = await window.downscaleImageFile(file);
    if (file.size > 5 * 1024 * 1024) {
      showToast('Photo must be under 5MB', 'error');
      return;
    }

    setUploadingPhoto(true);
    try {
      const formData = new FormData();
      formData.append('photo', file);
      // Use inputText as caption if user typed something
      if (inputText.trim()) {
        formData.append('caption', inputText.trim());
      }

      const res = await apiFetch(`/api/messages/conversations/${activeConvId}/photo`, {
        method: 'POST',
        body: formData,
      });

      if (res?.ok) {
        setInputText('');
        setReplyTo(null);
        delete draftsRef.current[activeConvId];
        persistDrafts();
        await fetchMessages(activeConvId);
        await fetchConversations();
      } else {
        const err = await res?.json().catch(() => ({}));
        showToast(err?.error || 'Failed to upload photo', 'error');
      }
    } catch (err) {
      console.error('Photo upload error:', err);
      showToast('Failed to upload photo', 'error');
    }
    setUploadingPhoto(false);
  };

  const handleStartCall = async (callType) => {
    if (!activeConvId || !activeConv) return;

    // Generate a unique room name
    const roomName = 'inplace-' + activeConvId.substring(0, 8) + '-' + Date.now();
    const otherMember = activeConv.members?.find(m => m.id !== currentUser?.id);
    const remoteName = otherMember ? (otherMember.name || `${otherMember.first_name || ''} ${otherMember.last_name || ''}`.trim()) || 'Unknown' : 'Unknown';

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
      remoteParticipantPhoto: otherMember?.profilePhoto || null,
      callDirection: 'outgoing',
    });
  };

  const handleEndCall = async (durationSecs) => {
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
    // Post call summary message to chat
    const ct = callState.callType || 'voice';
    const icon = ct === 'video' ? '\uD83D\uDCF9' : '\uD83D\uDCDE';
    const label = ct === 'video' ? 'Video call' : 'Audio call';
    const dur = durationSecs || 0;
    const durLabel = dur < 60 ? `${dur}s` : `${Math.floor(dur / 60)} min`;
    const now = new Date();
    const timeLabel = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    const summary = `${icon} ${label} \u00B7 ${durLabel} \u00B7 ${timeLabel}`;
    if (activeConvId) {
      try {
        await apiFetch(`/api/messages/conversations/${activeConvId}`, {
          method: 'POST',
          body: JSON.stringify({ content: summary }),
        });
        fetchMessages(activeConvId);
        fetchConversations();
      } catch (err) { console.error('Call summary message error:', err); }
    }
    setCallState({ active: false, roomName: null, callType: null, remoteParticipantName: null, remoteParticipantPhoto: null, callDirection: null });
  };

  const handleAcceptIncoming = () => {
    if (!incomingCall) return;
    setCallState({
      active: true,
      roomName: incomingCall.roomName,
      callType: incomingCall.callType,
      remoteParticipantName: incomingCall.callerName,
      remoteParticipantPhoto: incomingCall.callerPhoto || null,
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
    if (incomingCall && window._socket) {
      window._socket.emit('call_decline', {
        callerId: incomingCall.callerId,
        roomName: incomingCall.roomName,
      });
    }
    setIncomingCall(null);
  };

  // Listen for incoming calls via Socket.io
  useEffect(() => {
    // v1.105.99 — a call that arrived as a push while the app was closed. app.js parks it on
    // window.__pendingCall; pick it up on mount so the incoming-call UI appears rather than
    // dumping her into Messages with no idea why she is there.
    try {
      if (window.__pendingCall) {
        setIncomingCall(window.__pendingCall);
        window.__pendingCall = null;
      }
    } catch {}

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
      setCallState({ active: false, roomName: null, callType: null, remoteParticipantName: null, remoteParticipantPhoto: null, callDirection: null });
    });
    const cleanup3 = onSocketEvent('call_declined', () => {
      setCallState({ active: false, roomName: null, callType: null, remoteParticipantName: null, remoteParticipantPhoto: null, callDirection: null });
    });
    return () => { cleanup(); cleanup2(); cleanup3(); };
  }, [callState.active]);

  // ─── Typing indicator socket listener ───
  useEffect(() => {
    const cleanup = onSocketEvent('typing_indicator', (data) => {
      // data: { conversationId, userId, userName }
      setTypingUsers(prev => {
        const convTypers = { ...(prev[data.conversationId] || {}) };
        // Find the user's display name from conversations
        const conv = conversations.find(c => c.id === data.conversationId);
        const member = conv?.members?.find(m => m.id === data.userId);
        const displayName = (member && `${member.first_name || ''}`.trim()) || 'Someone';
        // Clear existing timeout for this user
        if (convTypers[data.userId]?.timeout) clearTimeout(convTypers[data.userId].timeout);
        // Set new timeout to clear after 3 seconds
        const timeout = setTimeout(() => {
          setTypingUsers(prev2 => {
            const updated = { ...(prev2[data.conversationId] || {}) };
            delete updated[data.userId];
            return { ...prev2, [data.conversationId]: updated };
          });
        }, 3000);
        convTypers[data.userId] = { name: displayName, timeout };
        return { ...prev, [data.conversationId]: convTypers };
      });
    });
    return cleanup;
  }, [conversations]);

  // ─── Read receipt socket listener ───
  useEffect(() => {
    const cleanup = onSocketEvent('messages_read', (data) => {
      // data: { conversationId, userId, readAt }
      setReadReceipts(prev => ({
        ...prev,
        [data.conversationId]: {
          ...(prev[data.conversationId] || {}),
          [data.userId]: data.readAt,
        }
      }));
    });
    return cleanup;
  }, []);

  // ─── Emit read receipt when opening a conversation ───
  useEffect(() => {
    if (activeConvId && window._socket) {
      window._socket.emit('messages_read', { conversationId: activeConvId });
    }
  }, [activeConvId, messages.length]);

  // ─── Typing emit handler (debounced) ───
  const emitTyping = useCallback(() => {
    if (!activeConvId || !window._socket) return;
    const now = Date.now();
    // Only emit every 2 seconds
    if (now - lastTypingEmitRef.current < 2000) return;
    lastTypingEmitRef.current = now;
    window._socket.emit('typing_start', { conversationId: activeConvId });
  }, [activeConvId]);

  // ─── Browser notification for incoming calls ───
  useEffect(() => {
    if (!incomingCall) return;
    // Request notification permission and show notification if tab is not focused
    // v1.105.49 — this called `new Notification(...)` directly. That constructor throws on
    // iOS, and because the throw happened inside a useEffect body it reached the
    // ErrorBoundary: a call arriving while the app was backgrounded replaced the user's
    // whole message thread with "Something went wrong / Reload". showLocalNotification goes
    // through the service worker — which WebKit does support — and never throws.
    if (document.hidden) {
      // v1.105.69 — this used to `return` after requesting permission, and that return was
      // permanent for anyone whose permission is 'default' (i.e. everyone who dismissed the
      // prompt rather than answering it). requestPermission() called from a HIDDEN document has
      // no user activation, so the browser resolves it without asking and the state stays
      // 'default' — meaning the next call takes the same branch, and the next, forever. An
      // incoming call never rang for those users and never would.
      //
      // The permission request stays (harmless, and it occasionally lands), but it no longer
      // gates the notification. showLocalNotification goes through the service worker, which
      // does not depend on the Notification constructor's permission state in the same way,
      // and never throws — so attempting it is strictly better than returning.
      if (typeof Notification === 'function'
          && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        try { Notification.requestPermission(); } catch { /* not available in this webview */ }
      }
      if (typeof Notification === 'function' && Notification.permission === 'denied') {
        // Genuinely refused. Nothing to do — do not pretend otherwise.
        return;
      }
      const typeLabel = incomingCall.callType === 'video' ? 'Video' : 'Voice';
      showLocalNotification(`Incoming ${typeLabel} Call`, {
        body: `${incomingCall.callerName || 'Someone'} is calling you`,
        icon: '/icons/icon-192x192.png',
        tag: 'incoming-call',
        requireInteraction: true,
        data: { type: 'video_call', page: 'messages' },
      });
      // Cleanup runs when the call ends or the component unmounts.
      return () => { closeLocalNotification('incoming-call'); };
    }
  }, [incomingCall]);

  const renderMessageContent = (content) => {
    // Detect call summary messages (new format: "📞 Audio call · 4 min · 10:14 AM")
    const callSummaryMatch = content.match(/^(\uD83D\uDCF9|\uD83D\uDCDE) (Video call|Audio call) \u00B7 (.+?) \u00B7 (.+)$/);
    if (callSummaryMatch) {
      const isVideoCall = callSummaryMatch[2] === 'Video call';
      return React.createElement('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          background: '#f0f8f5',
          borderRadius: 8,
          border: '1px solid #e0efe8',
        }
      },
        React.createElement('span', {
          style: { display: 'flex', alignItems: 'center', color: 'var(--role-color)' },
          dangerouslySetInnerHTML: { __html: isVideoCall
            ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>'
            : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>'
          }
        }),
        React.createElement('span', { style: { fontWeight: 600, color: 'var(--text-primary)', fontSize: 13 } }, callSummaryMatch[2]),
        React.createElement('span', { style: { color: 'var(--text-tertiary)', fontSize: 12 } }, '\u00B7'),
        React.createElement('span', { style: { color: 'var(--text-secondary)', fontSize: 13 } }, callSummaryMatch[3]),
        React.createElement('span', { style: { color: 'var(--text-tertiary)', fontSize: 12 } }, '\u00B7'),
        React.createElement('span', { style: { color: 'var(--text-muted)', fontSize: 12 } }, callSummaryMatch[4])
      );
    }
    // Legacy call messages (old format: "📹 Started a video call")
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
          color: 'var(--role-color)',
        }
      },
        React.createElement('span', {
          style: { display: 'flex', alignItems: 'center' },
          dangerouslySetInnerHTML: { __html: isVideoCall
            ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>'
            : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>'
          }
        }),
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
            color: 'var(--role-color)',
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
    if (role === 'system' || role === 'ipai') return 'AI Care Assistant'; // iPAi's internal role — never show the raw value
    return role || '';
  };

  const getInitials = (name) => {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  };

  const avatarColors = ['var(--role-color)', 'var(--accent-color)', '#5e35b1', '#0277bd', 'var(--color-error)', 'var(--color-success)', 'var(--color-purple)'];
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
    <div className="msg-panel" style={{ display: 'flex', flexDirection: 'column', height: isMobile ? 'auto' : '100%', flex: isMobile ? '1 1 0%' : undefined, minHeight: isMobile ? 0 : undefined, overflow: 'hidden' }}>
      <div className="msg-chat-header" style={isMobile ? { paddingTop: 12 } : undefined}>
        <button className="msg-back-btn" onClick={() => { setShowNewChat(false); setCreatingGroup(false); }}
          style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', color: 'var(--role-color)', padding: '4px 8px', marginRight: '8px' }}>
          ‹
        </button>
        <div style={{ fontWeight: 600, fontSize: '16px', color: 'var(--text-primary)' }}>
          {creatingGroup ? 'New Group' : 'New Message'}
        </div>
        {!creatingGroup && (
          <button onClick={() => setCreatingGroup(true)}
            style={{ marginLeft: 'auto', background: 'none', border: '1px solid #1b6b5a', color: 'var(--role-color)', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
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
                <span key={c.id} style={{ background: 'var(--color-success-bg)', color: 'var(--role-color)', padding: '4px 10px', borderRadius: 16, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {c.name}
                  <span onClick={() => setSelectedContacts(prev => prev.filter(p => p.id !== c.id))} style={{ cursor: 'pointer', marginLeft: 2 }}>×</span>
                </span>
              ))}
            </div>
          )}
          <button onClick={handleCreateGroup} disabled={!groupName.trim() || selectedContacts.length === 0}
            style={{ width: '100%', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, padding: '10px', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: (!groupName.trim() || selectedContacts.length === 0) ? 0.5 : 1 }}>
            Create Group ({selectedContacts.length} member{selectedContacts.length !== 1 ? 's' : ''})
          </button>
        </div>
      )}

      {/* Search bar */}
      <div style={{ padding: '8px 16px', borderBottom: '1px solid #f0f0f0' }}>
        <input type="text" placeholder="Search by name or email..." value={contactSearch}
          onChange={e => { setContactSearch(e.target.value); fetchContacts(e.target.value); }}
          style={{ width: '100%', padding: '10px 12px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 14, background: 'var(--bg-primary)' }} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {contactsLoading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading contacts...</div>
        ) : contacts.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>
            {contactSearch ? 'No users found.' : 'No contacts available.'}
          </div>
        ) : (
          contacts.map(c => {
            const isSelected = selectedContacts.find(sc => sc.id === c.id);
            return (
              <div key={c.id} className="msg-contact-item" onClick={() => handleSelectContact(c)}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0', transition: 'background 0.15s', background: isSelected ? 'var(--color-success-bg)' : 'transparent' }}
                onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-primary)'; }}
                onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: getAvatarColor(c.name), display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-on-primary)', fontSize: '14px', fontWeight: 600, flexShrink: 0 }}>
                  {getInitials(c.name)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>{c.name}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{roleLabel(c.role)}</div>
                </div>
                {creatingGroup && isSelected && (
                  <span style={{ color: 'var(--role-color)', fontWeight: 700, fontSize: 18 }}>✓</span>
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
    <div className="msg-panel" style={{ display: 'flex', flexDirection: 'column', height: isMobile ? 'auto' : '100%', flex: isMobile ? '1 1 0%' : undefined, minHeight: isMobile ? 0 : undefined, overflow: 'hidden' }}>
      <div className="msg-chat-header" style={isMobile ? { paddingTop: 12 } : undefined}>
        <button className="msg-back-btn" onClick={() => { setShowFindPeople(false); setPeopleSearch(''); setPeopleResults([]); }}
          style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', color: 'var(--role-color)', padding: '4px 8px', marginRight: '8px' }}>
          ‹
        </button>
        <div style={{ fontWeight: 600, fontSize: '16px', color: 'var(--text-primary)' }}>Find People</div>
      </div>
      <div style={{ padding: '8px 16px', borderBottom: '1px solid #f0f0f0' }}>
        <input type="text" placeholder="Search by name or email..." value={peopleSearch}
          onChange={e => { setPeopleSearch(e.target.value); searchPeople(e.target.value); }}
          autoFocus
          style={{ width: '100%', padding: '10px 12px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 14, background: 'var(--bg-primary)' }} />
      </div>

      {/* Pending connection requests */}
      {pendingRequests.length > 0 && !peopleSearch && (
        <div style={{ borderBottom: '1px solid #f0f0f0' }}>
          <div style={{ padding: '10px 16px', fontSize: 12, fontWeight: 600, color: 'var(--color-warning)', background: 'var(--bg-warm)' }}>
            Connection Requests ({pendingRequests.length})
          </div>
          {pendingRequests.map(req => (
            <div key={req.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid #f5f5f5' }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#e8f0fe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#0066cc' }}>
                {req.otherFirstName?.[0]}{req.otherLastName?.[0]}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{req.otherFirstName} {req.otherLastName}</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{req.otherEmail}</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => handleRespondConnection(req.id, 'accept')}
                  style={{ padding: '6px 12px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Accept
                </button>
                <button onClick={() => handleRespondConnection(req.id, 'decline')}
                  style={{ padding: '6px 12px', background: 'var(--bg-surface)', color: 'var(--text-muted)', border: '1px solid #d0d0d0', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
                  Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {peopleLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Searching...</div>
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
                <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                  Search for people on InPlace to start a conversation.
                </div>
              );
              return (
                <div>
                  <div style={{ padding: '10px 16px 6px', fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Recent
                  </div>
                  {recentPeople.slice(0, 10).map(p => (
                    <div key={p.id} onClick={() => { setShowFindPeople(false); handleSelectConversation(p.conv); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid #f5f5f5', cursor: 'pointer' }}>
                      {p.profilePhoto ? (
                        <img src={p.profilePhoto} alt={p.name} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ width: 40, height: 40, borderRadius: '50%', background: getAvatarColor(p.name || '?'), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: 'var(--text-on-primary)' }}>
                          {getInitials(p.name || '?')}
                        </div>
                      )}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{p.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--role-color)' }}>Message →</div>
                      </div>
                    </div>
                  ))}
                  <div style={{ padding: '12px 16px', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
                    Search above to find more people
                  </div>
                </div>
              );
            })()}
          </div>
        ) : peopleResults.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>No users found.</div>
        ) : (
          peopleResults.map(u => (
            <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid #f0f0f0' }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: u.role === 'caregiver' ? 'var(--color-success-bg)' : 'var(--bg-primary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: u.role === 'caregiver' ? 'var(--role-color)' : '#0066cc' }}>
                {u.firstName?.[0]}{u.lastName?.[0]}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{u.firstName} {u.lastName}</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{u.role === 'caregiver' ? 'Caregiver' : 'Family'}</div>
              </div>
              {u.connection?.status === 'accepted' ? (
                <span style={{ fontSize: 12, color: 'var(--role-color)', fontWeight: 600 }}>✓ Connected</span>
              ) : u.connection?.status === 'pending' ? (
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 500 }}>
                  {u.connection.direction === 'sent' ? 'Request sent' : 'Pending'}
                </span>
              ) : (
                <button onClick={() => handleSendConnectionRequest(u.id)}
                  style={{ padding: '6px 14px', background: 'var(--bg-surface)', color: 'var(--role-color)', border: '1px solid #1b6b5a', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
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
  // ─── v1.105.18 — report and block ───
  // The other participant of a 1:1 thread, or null for group/care-team threads. Both acts
  // are person-to-person, so they only make sense where there is exactly one other person.
  const soloPartner = (conv) => {
    const others = (conv?.members || []).filter(m => m.id !== currentUser?.id);
    return others.length === 1 ? others[0] : null;
  };

  const handleBlock = async (conv) => {
    const partner = soloPartner(conv);
    if (!partner) return;
    // Ask the server what blocking would actually do rather than describing it here. How
    // many visits get cancelled, and whether a care team has to approve it, are facts about
    // this particular pair of people — prose in the client drifts away from them.
    let lines = [];
    try {
      const res = await apiFetch('/api/safety/block-preview/' + partner.id);
      if (res?.ok) { const p = await res.json(); lines = p.consequences || []; }
    } catch { /* fall through to the generic wording */ }
    const name = ((partner.first_name || '') + ' ' + (partner.last_name || '')).trim() || 'this person';
    const body = lines.length
      ? lines.map(l => '\u2022 ' + l).join('\n')
      : '\u2022 They will be told that you blocked them.\n\u2022 Upcoming visits together will be cancelled.\n\u2022 You can unblock them at any time.';
    if (!confirm('Block ' + name + '?\n\n' + body)) return;
    try {
      const res = await apiFetch('/api/safety/block', { method: 'POST', body: JSON.stringify({ userId: partner.id }) });
      const d = await res.json().catch(() => ({}));
      if (res?.ok) { showToast(d.message || 'Blocked.', 'success'); fetchConversations(); setActiveConvId(null); }
      else showToast(d.error || 'Could not block that person', 'error');
    } catch { showToast('Could not block that person', 'error'); }
  };

  const submitReport = async () => {
    if (!reportCategory || !reportFor) return;
    setReportBusy(true);
    try {
      const res = await apiFetch('/api/safety/report', {
        method: 'POST',
        body: JSON.stringify({
          reportedUserId: reportFor.userId, messageId: reportFor.messageId || null,
          conversationId: reportFor.convId || null, category: reportCategory, details: reportDetails,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (res?.ok) { showToast(d.message || 'Report sent to our safety team.', 'success'); setReportFor(null); setReportCategory(''); setReportDetails(''); }
      else showToast(d.error || 'Could not send the report', 'error');
    } catch { showToast('Could not send the report', 'error'); }
    setReportBusy(false);
  };

  const renderConversationList = () => (
    <div className="msg-panel" style={{ display: 'flex', flexDirection: 'column', height: isMobile ? 'auto' : '100%', flex: isMobile ? '1 1 0%' : undefined, minHeight: isMobile ? 0 : undefined, overflow: 'hidden' }}>
      <div className="msg-list-header" style={isMobile ? { paddingTop: 16 } : undefined}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          {selectMode ? `${selectedIds.length} selected` : 'Messages'}
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {selectMode ? (
            <>
              <button onClick={handleArchiveSelected}
                disabled={selectedIds.length === 0}
                style={{ background: selectedIds.length > 0 ? 'var(--color-warning)' : 'var(--border-light)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: selectedIds.length > 0 ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap' }}>
                Archive{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
              </button>
              <button onClick={() => selectedIds.length > 0 && setDeleteConfirmId('__bulk__')}
                disabled={selectedIds.length === 0}
                style={{ background: selectedIds.length > 0 ? 'var(--color-error)' : 'var(--border-light)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: selectedIds.length > 0 ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap' }}>
                Delete{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
              </button>
              <button onClick={() => { setSelectMode(false); setSelectedIds([]); }}
                style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid #d0d0d0', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setSelectMode(true)}
                style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid #d0d0d0', borderRadius: 8, padding: '6px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                title="Select conversations to archive">
                &#128451;
              </button>
              <button onClick={() => { setShowFindPeople(true); fetchPendingRequests(); }}
                style={{ background: 'var(--bg-surface)', color: 'var(--role-color)', border: '1px solid #1b6b5a', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', position: 'relative' }}
                title="Find people to connect with">
                🔍 Find People
                {pendingRequests.length > 0 && (
                  <span style={{ position: 'absolute', top: -6, right: -6, background: 'var(--color-warning)', color: 'var(--text-on-primary)', borderRadius: '50%', width: 18, height: 18, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {pendingRequests.length}
                  </span>
                )}
              </button>
              <button onClick={handleNewChat}
                style={{ background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: '50%', width: '36px', height: '36px', fontSize: '20px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
                title="New message">
                +
              </button>
            </>
          )}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Pending received connection requests — inline at top */}
        {pendingRequests.length > 0 && (
          <div style={{ borderBottom: '1px solid #f0f0f0' }}>
            <div style={{ padding: '8px 16px', fontSize: 11, fontWeight: 600, color: 'var(--color-warning)', background: 'var(--bg-warm)' }}>
              Connection Requests ({pendingRequests.length})
            </div>
            {pendingRequests.map(req => (
              <div key={req.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid #f5f5f5' }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#e8f0fe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#0066cc' }}>
                  {req.otherFirstName?.[0]}{req.otherLastName?.[0]}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{req.otherFirstName} {req.otherLastName}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-warning)' }}>Wants to connect</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => handleRespondConnection(req.id, 'accept')}
                    style={{ padding: '6px 12px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    Accept
                  </button>
                  <button onClick={() => handleRespondConnection(req.id, 'decline')}
                    style={{ padding: '6px 12px', background: 'var(--bg-surface)', color: 'var(--text-muted)', border: '1px solid #d0d0d0', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* iPAi — pinned at top. Find existing iPAi conversation or use placeholder */}
        {(() => {
          const ipaiConv = conversations.find(c =>
            c.name === 'iPAi' ||
            c.otherName === 'iPAi Assistant' ||
            c.otherName === 'iPAi' ||
            c.members?.some(m => m.name === 'iPAi Assistant' || m.email === 'ipai@yourinplace.com')
          );
          const isActive = activeConvId === '__ipai__' || (ipaiConv && activeConvId === ipaiConv.id);
          return (
            <div
              className={`msg-conv-item ${isActive ? 'active' : ''}`}
              onClick={() => {
                if (ipaiConv) {
                  handleSelectConversation(ipaiConv);
                } else {
                  // No existing conversation — set placeholder, first message will create it
                  // (v1.104.6 — removed setActiveConvName call: no such state setter
                  // exists; it threw ReferenceError and crashed the iPAi conversation tap)
                  setActiveConvId('__ipai__');
                }
              }}
              style={{ borderBottom: '2px solid #e6f5f0', background: isActive ? 'var(--color-success-bg)' : '#f8fffe' }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--role-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ color: 'var(--text-on-primary)', fontSize: 11, fontWeight: 800, letterSpacing: '-0.5px' }}>iPAi</span>
              </div>
              <div style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--role-color)' }}>iPAi</span>
                  {React.createElement(window.IPAiBadge || 'span', { size: 'sm' })}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ipaiConv?.lastMessage ? ipaiConv.lastMessage.substring(0, 50) : 'Your AI care assistant — ask me anything'}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Regular conversations — filter out iPAi to avoid duplicate */}
        {conversations.filter(c => !archivedIds.includes(c.id) && c.name !== 'iPAi' && c.otherName !== 'iPAi Assistant' && c.otherName !== 'iPAi' && !c.members?.some(m => m.email === 'ipai@yourinplace.com')).length > 0 ? conversations.filter(c => !archivedIds.includes(c.id) && c.name !== 'iPAi' && c.otherName !== 'iPAi Assistant' && c.otherName !== 'iPAi' && !c.members?.some(m => m.email === 'ipai@yourinplace.com')).sort((a, b) => {
          const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
          const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
          return bTime - aTime;
        }).map(c => {
          const isGroup = isGroupConv(c);
          const typeIcon = c.type === 'care_team' ? '👥' : c.type === 'group' ? '💬' : null;
          const isSwiping = swipingId === c.id;
          return (
            <div key={c.id} style={{ position: 'relative', overflow: 'hidden' }}>
              {/* Archive + Delete background revealed on swipe */}
              <div style={{
                position: 'absolute', top: 0, right: 0, bottom: 0, width: 120,
                display: 'flex', alignItems: 'stretch',
                opacity: isSwiping && swipeOffset < -30 ? 1 : 0,
                transition: 'opacity 0.15s',
              }}>
                <div onClick={(e) => { e.stopPropagation(); handleArchive(c.id); setSwipingId(null); setSwipeOffset(0); }}
                  style={{ flex: 1, background: 'var(--color-warning)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-on-primary)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                  Archive
                </div>
                <div onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(c.id); setSwipingId(null); setSwipeOffset(0); }}
                  style={{ flex: 1, background: 'var(--color-error)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-on-primary)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                  Delete
                </div>
              </div>
              <div
                className={`msg-conv-item ${activeConvId === c.id ? 'active' : ''}`}
                onClick={() => { setContextMenu(null); selectMode ? toggleSelectId(c.id) : handleSelectConversation(c); }}
                onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, convId: c.id }); }}
                onTouchStart={(e) => !selectMode && onConvTouchStart(e, c.id)}
                onTouchMove={(e) => !selectMode && onConvTouchMove(e, c.id)}
                onTouchEnd={() => !selectMode && onConvTouchEnd(c.id)}
                style={{
                  position: 'relative',
                  background: selectMode && selectedIds.includes(c.id) ? '#f0f7ff' : (activeConvId === c.id ? 'var(--bg-teal-light)' : 'var(--bg-card)'),
                  borderLeft: activeConvId === c.id ? '3px solid var(--role-color)' : '3px solid transparent',
                  transform: isSwiping ? `translateX(${swipeOffset}px)` : 'none',
                  transition: isSwiping ? 'none' : 'transform 0.2s',
                }}>
                {selectMode && (
                  <div style={{ display: 'flex', alignItems: 'center', marginRight: 8, flexShrink: 0 }}>
                    <div style={{
                      width: 22, height: 22, borderRadius: 6, border: selectedIds.includes(c.id) ? 'none' : '2px solid #ccc',
                      background: selectedIds.includes(c.id) ? 'var(--role-color)' : 'var(--bg-card)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'var(--text-on-primary)', fontSize: 14, fontWeight: 700,
                    }}>{selectedIds.includes(c.id) ? '\u2713' : ''}</div>
                  </div>
                )}
                <div style={{ position: 'relative', flexShrink: 0 }}>
                {isGroup ? (
                  <div style={{ width: '44px', height: '44px', position: 'relative' }}>
                    {(() => {
                      const avatarMembers = (c.members || []).filter(m => m.id !== currentUser?.id).slice(0, 3);
                      const count = avatarMembers.length;
                      if (count === 0) return <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: 'var(--color-success-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--role-color)', fontSize: '20px' }}>{typeIcon || '\u{1F465}'}</div>;
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
                            background: getAvatarColor(m.name || '?'), color: 'var(--text-on-primary)',
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
                ) : (c.name === 'InPlace Support' || c.name === 'iPAi') ? (
                  <div style={{
                    width: '44px', height: '44px', borderRadius: '50%',
                    background: 'var(--role-color)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--text-on-primary)', fontSize: '20px', fontWeight: 700,
                  }}>iP</div>
                ) : c.profilePhoto ? (
                  <img src={c.profilePhoto} alt={c.name} style={{
                    width: '44px', height: '44px', borderRadius: '50%', objectFit: 'cover',
                  }} />
                ) : (
                <div style={{
                  width: '44px', height: '44px', borderRadius: '50%',
                  background: getAvatarColor(c.name),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--text-on-primary)', fontSize: '15px',
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
                    <span style={{ fontWeight: c.unreadCount > 0 ? 700 : 600, fontSize: '14px', color: 'var(--text-primary)' }}>
                      {c.name}
                    </span>
                    <span style={{ fontSize: '11px', color: c.unreadCount > 0 ? 'var(--role-color)' : 'var(--text-muted)', fontWeight: c.unreadCount > 0 ? 600 : 400, flexShrink: 0, marginLeft: '8px' }}>
                      {formatTime(c.lastMessageAt)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', color: c.unreadCount > 0 ? 'var(--text-secondary)' : 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: c.unreadCount > 0 ? 500 : 400 }}>
                      {isGroup && c.members ? `${c.members.length} members` + (c.lastMessage ? ` · ${c.lastMessage}` : '') : (c.lastMessage || 'No messages yet')}
                    </span>
                    {c.unreadCount > 0 && (
                      <span style={{ background: 'var(--role-color)', color: 'var(--text-on-primary)', borderRadius: '10px', padding: '1px 7px', fontSize: '11px', fontWeight: 600, flexShrink: 0, marginLeft: '8px', minWidth: '18px', textAlign: 'center' }}>
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
            <div style={{ fontSize: '15px', color: 'var(--text-secondary)', marginBottom: '8px' }}>No conversations yet</div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px' }}>Start a conversation with someone in your care network</div>
            <button onClick={handleNewChat}
              style={{ background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: '8px', padding: '10px 24px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
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
              color: 'var(--text-on-primary)', fontSize: 15, fontWeight: 600, flexShrink: 0,
            }}>
              {(req.otherFirstName?.[0] || '')}{(req.otherLastName?.[0] || '')}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
                {req.otherFirstName} {req.otherLastName}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                Request sent — waiting for response
              </div>
            </div>
            <span style={{ fontSize: 14, color: 'var(--text-muted)', flexShrink: 0 }}>⏳</span>
          </div>
        ))}

        {/* Archived conversations section */}
        {(() => {
          const archivedConvs = conversations.filter(c => archivedIds.includes(c.id));
          if (archivedConvs.length === 0) return null;
          return (
            <div style={{ borderTop: '1px solid #e0e0e0' }}>
              <div onClick={() => setShowArchived(!showArchived)}
                style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', background: 'var(--bg-primary)' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-tertiary)' }}>
                  {'\uD83D\uDCE6'} Archived ({archivedConvs.length})
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', transform: showArchived ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>{'\u25BC'}</span>
              </div>
              {showArchived && archivedConvs.sort((a, b) => {
                const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
                const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
                return bTime - aTime;
              }).map(c => {
                const isGroup = isGroupConv(c);
                return (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid #f5f5f5', background: 'var(--bg-primary)' }}>
                    <div onClick={() => handleSelectConversation(c)} style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, cursor: 'pointer' }}>
                      {c.profilePhoto ? (
                        <img src={c.profilePhoto} alt={c.name} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, opacity: 0.7 }} />
                      ) : (
                        <div style={{
                          width: 40, height: 40, borderRadius: '50%',
                          background: getAvatarColor(c.name || '?'), color: 'var(--text-on-primary)',
                          fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: 0.7,
                        }}>{getInitials(c.name || '?')}</div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-tertiary)' }}>{c.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.lastMessage ? (c.lastMessage.length > 40 ? c.lastMessage.substring(0, 40) + '...' : c.lastMessage) : 'No messages'}
                        </div>
                      </div>
                    </div>
                    <button onClick={() => handleUnarchive(c.id)}
                      style={{ background: 'var(--bg-surface)', color: 'var(--role-color)', border: '1px solid #1b6b5a', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      Restore
                    </button>
                    <button onClick={() => setDeleteConfirmId(c.id)}
                      style={{ background: 'var(--bg-surface)', color: 'var(--color-error)', border: '1px solid #dc2626', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      Delete
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

      {/* Right-click context menu (desktop) */}
      {contextMenu && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999 }}
          onClick={() => setContextMenu(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y,
            background: 'var(--bg-surface)', borderRadius: 10, boxShadow: '0 4px 20px rgba(0,0,0,0.18)',
            padding: '4px 0', minWidth: 160, zIndex: 10000,
          }}>
            <div onClick={() => { handleArchive(contextMenu.convId); setContextMenu(null); }}
              style={{ padding: '10px 16px', fontSize: 14, color: 'var(--text-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-primary)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
              <span style={{ fontSize: 16 }}>&#128230;</span> Archive
            </div>
            <div onClick={() => { setDeleteConfirmId(contextMenu.convId); setContextMenu(null); }}
              style={{ padding: '10px 16px', fontSize: 14, color: 'var(--color-error)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-error-subtle)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
              <span style={{ fontSize: 16 }}>&#128465;</span> Delete
            </div>
            {(() => {
              const c = conversations.find(x => x.id === contextMenu.convId);
              const partner = soloPartner(c);
              if (!partner) return null;
              const pname = ((partner.first_name || '') + ' ' + (partner.last_name || '')).trim();
              return [
                <div key="sep" style={{ height: 1, background: 'var(--border-color)', margin: '4px 0' }} />,
                // Report is listed BEFORE Block and worded as the safe option. Someone
                // frightened of a caregiver should reach for this one, because reporting is
                // the act that never tells the other person.
                <div key="report" onClick={() => { setReportFor({ userId: partner.id, name: pname, convId: c.id }); setContextMenu(null); }}
                  style={{ padding: '10px 14px', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>&#9873;</span> Report
                </div>,
                <div key="block" onClick={() => { const cc = c; setContextMenu(null); handleBlock(cc); }}
                  style={{ padding: '10px 14px', fontSize: 14, cursor: 'pointer', color: 'var(--color-error)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>&#128683;</span> Block
                </div>,
              ];
            })()}
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirmId && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 10000,
        }} onClick={() => setDeleteConfirmId(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: 'var(--bg-surface)', borderRadius: 16, padding: '24px', width: '90%', maxWidth: 340,
            boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', marginBottom: 8 }}>Delete Conversation?</div>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.4 }}>
              {deleteConfirmId === '__bulk__'
                ? `This will permanently delete ${selectedIds.length} conversation${selectedIds.length > 1 ? 's' : ''} and all messages. This can't be undone.`
                : 'This will permanently delete this conversation and all messages. This can\'t be undone.'}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeleteConfirmId(null)}
                style={{ background: '#f3f4f6', color: 'var(--text-secondary)', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                disabled={deleting}
                onClick={() => deleteConfirmId === '__bulk__' ? handleDeleteSelected() : handleDelete(deleteConfirmId)}
                style={{ background: 'var(--color-error)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 14, fontWeight: 600, cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.6 : 1 }}>
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // ─── Chat View ───
  const renderChatView = () => {
    const isGroup = isGroupConv(activeConv);
    // v1.105.37 — iPAi GENERATES text, so it carries the acknowledgment (see IPAiBadge.js).
    // A person-to-person thread does not.
    const isIPAiThread = activeConvId === '__ipai__'
      || activeConv?.name === 'iPAi'
      || activeConv?.otherName === 'iPAi Assistant'
      || activeConv?.otherName === 'iPAi';
    return (
      <div className={`msg-panel ${isMobile ? 'msg-panel-mobile' : ''}`} style={{ display: 'flex', flexDirection: 'column', height: isMobile ? 'auto' : '100%', flex: isMobile ? '1 1 0%' : undefined, minHeight: isMobile ? 0 : undefined, overflow: 'hidden' }}>
        <div className="msg-chat-header" style={isMobile ? { paddingTop: 12 } : undefined}>
          {(isMobile || !conversations.length) && (
            <button className="msg-back-btn" onClick={handleBack}
              style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', color: 'var(--role-color)', padding: '4px 8px', marginRight: '4px' }}>
              ‹
            </button>
          )}
          {/* minWidth:0 below — a flex child defaults to min-width:auto, so a long
              conversation name could not shrink and pushed the call buttons past the edge of
              a panel that is overflow:hidden. That is one way "where are they?" happens with
              nothing conditional anywhere. */}
          {activeConv && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
              {!isGroup && (activeConv.name === 'InPlace Support' || activeConv.name === 'iPAi') ? (
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--role-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-on-primary)', fontSize: 15, fontWeight: 700, flexShrink: 0 }}>iP</div>
              ) : !isGroup && activeConv.profilePhoto ? (
                <img src={activeConv.profilePhoto} alt={activeConv.name} style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
              ) : (
              <div style={{
                width: '36px', height: '36px', borderRadius: isGroup ? '10px' : '50%',
                background: isGroup ? 'var(--color-success-bg)' : getAvatarColor(activeConv.name),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: isGroup ? 'var(--role-color)' : 'var(--bg-surface)', fontSize: isGroup ? '18px' : '13px', fontWeight: 600,
              }}>
                {isGroup ? (activeConv.type === 'care_team' ? '👥' : '💬') : getInitials(activeConv.name)}
              </div>
              )}
              <div>
                <div style={{ fontWeight: 600, fontSize: '15px', color: 'var(--text-primary)', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeConv.name}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {isGroup
                    ? `${activeConv.members?.length || 0} members`
                    : roleLabel(activeConv.members?.find(m => m.id !== activeConv.members?.[0]?.id)?.role)
                  }
                </div>
              </div>
            </div>
          )}
          {/* v1.105.131 — Pete, triage on e452db48: "no the buttons are there. i don't like
              the buttons...they're ugly, but their there."
              They were two 36px outlined squares — under Apple's 44x44 minimum, hardcoded
              #1b6b5a so the border never followed the theme, and styled by onMouseEnter /
              onMouseLeave, which on a touch screen fires on TAP and then never fires again:
              the button you called from stayed inverted until the next re-render. Filled
              circles now, 44x44, coloured from the theme, hover in CSS where it belongs. */}
          <button
            className="msg-call-btn"
            onClick={() => handleStartCall('voice')}
            title="Start voice call"
            aria-label="Start voice call">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          </button>
          <button
            className="msg-call-btn"
            onClick={() => handleStartCall('video')}
            title="Start video call"
            aria-label="Start video call">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
          </button>

          {/* ─── v1.105.22 — report/block, reachable on a phone ───
              Until now these lived only in the desktop RIGHT-CLICK menu on the conversation
              list. On an iPhone-only submission that is nowhere: there is no right-click,
              and a reviewer checking guideline 1.2 opens a chat and looks for an overflow.
              So it goes in the header, next to the call buttons, on every device. */}
          {activeConv && soloPartner(activeConv) && (
            <button onClick={() => setHeaderMenu(v => !v)} aria-label="More options"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px 8px', color: 'var(--role-color)', fontSize: 20, lineHeight: 1 }}>
              ⋯
            </button>
          )}
        </div>

        {headerMenu && activeConv && soloPartner(activeConv) && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={() => setHeaderMenu(false)}>
            <div onClick={e => e.stopPropagation()} style={{
              position: 'absolute', top: 58, right: 10, minWidth: 180, zIndex: 9999,
              background: 'var(--bg-surface)', borderRadius: 10, padding: '4px 0',
              boxShadow: '0 4px 20px rgba(0,0,0,0.18)',
            }}>
              {/* Report first, and worded as the safe option — someone frightened of a
                  caregiver should reach for the one that never tells the other person. */}
              <div onClick={() => {
                  const pn = soloPartner(activeConv);
                  setHeaderMenu(false);
                  setReportFor({ userId: pn.id, name: `${pn.first_name || ''} ${pn.last_name || ''}`.trim(), convId: activeConv.id });
                }}
                style={{ padding: '12px 16px', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16 }}>&#9873;</span> Report
              </div>
              <div onClick={() => { const c = activeConv; setHeaderMenu(false); handleBlock(c); }}
                style={{ padding: '12px 16px', fontSize: 14, cursor: 'pointer', color: 'var(--color-error)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16 }}>&#128683;</span> Block
              </div>
            </div>
          </div>
        )}

        <div className="msg-messages-area">
          {messages.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24 }}>
              {(activeConvId === '__ipai__' || activeConv?.name === 'iPAi' || activeConv?.otherName === 'iPAi Assistant') ? (
                <div style={{ textAlign: 'center', maxWidth: 320 }}>
                  <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--role-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                    <span style={{ color: 'var(--text-on-primary)', fontSize: 18, fontWeight: 800 }}>iPAi</span>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>Hi! I'm iPAi</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 16 }}>
                    Your care assistant. I know your loved ones, their caregivers, and their visit history. Ask me anything.
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {["Who's available this week?", ipaiRecipientName ? ('How is ' + ipaiRecipientName + ' doing?') : 'How is my loved one doing?', 'Find someone for Thursday morning'].map(q => (
                      <button key={q} onClick={() => { setInputText(q); }} style={{
                        padding: '8px 14px', background: 'var(--color-success-bg)', border: '1px solid #bbf7d0', borderRadius: 8,
                        fontSize: 13, color: 'var(--role-color)', cursor: 'pointer', textAlign: 'left',
                      }}>{q}</button>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                  {isGroup ? 'No messages yet in this group' : 'Send a message to start the conversation'}
                </div>
              )}
            </div>
          ) : (
            <React.Fragment>
            {/* v1.105.92 — the thread starts where you joined. Say so, rather than opening
                mid-conversation and letting the reader assume something failed to load. */}
            {hiddenBefore > 0 && (
              <div style={{ textAlign: 'center', margin: '4px 0 14px' }}>
                <span style={{ display: 'inline-block', padding: '5px 12px', borderRadius: 999, background: 'var(--bg-primary)', border: '1px solid var(--border-light)', fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
                  Earlier messages aren{'\u2019'}t shown {'\u2014'} this conversation starts when you joined
                </span>
              </div>
            )}
            {messages.map((m, i) => {
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
                      <div style={{ textAlign: 'center', margin: '16px 0 8px', fontSize: '11px', color: 'var(--text-muted)' }}>
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
                      <div style={{ position: 'absolute', left: 4, top: '50%', transform: 'translateY(-50%)', opacity: msgSwipeOffset > 20 ? Math.min((msgSwipeOffset - 20) / 30, 1) : 0, fontSize: 18, color: 'var(--role-color)', transition: 'opacity 0.1s' }}>
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
                        const isSupport = m.senderLabel === 'InPlace Support' || activeConv?.name === 'InPlace Support' || activeConv?.name === 'iPAi';
                        return isSupport ? (
                          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--role-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-on-primary)', fontSize: 11, fontWeight: 700, flexShrink: 0, marginRight: 6, marginTop: showName ? 18 : 0 }}>iP</div>
                        ) : senderPhoto ? (
                          <img src={senderPhoto} alt={m.senderName} style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, marginRight: 6, marginTop: showName ? 18 : 0 }} />
                        ) : (
                          <div style={{ width: 28, height: 28, borderRadius: '50%', background: getAvatarColor(m.senderName || ''), display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-on-primary)', fontSize: 10, fontWeight: 600, flexShrink: 0, marginRight: 6, marginTop: showName ? 18 : 0 }}>
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
                          <div style={{ fontSize: 11, color: m.senderLabel ? 'var(--role-color)' : getAvatarColor(m.senderName || ''), fontWeight: 600, marginBottom: 2, marginLeft: 4 }}>
                            {m.senderLabel ? `\u{1F6E1}\uFE0F ${m.senderLabel}` : m.senderName}
                          </div>
                        )}
                        {/* Reply quote */}
                        {m.replyTo && (
                          <div style={{
                            padding: '6px 10px', marginBottom: -6, borderRadius: isSent ? '12px 12px 0 0' : '12px 12px 0 0',
                            background: isSent ? 'var(--bubble-reply-sent-bg)' : 'var(--bubble-reply-received-bg)', fontSize: 12, lineHeight: 1.3,
                            borderLeft: isSent ? '3px solid rgba(255,255,255,0.4)' : '3px solid var(--bubble-sent-bg)',
                          }}>
                            <div style={{ fontWeight: 600, fontSize: 11, color: isSent ? 'rgba(255,255,255,0.7)' : 'var(--bubble-sent-bg)', marginBottom: 1 }}>
                              {m.replyTo.senderName || 'Unknown'}
                            </div>
                            <div style={{ color: isSent ? 'rgba(255,255,255,0.6)' : 'var(--bubble-received-meta)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
                              {m.replyTo.content}
                            </div>
                          </div>
                        )}
                        <div style={{
                          padding: '10px 14px',
                          borderRadius: m.replyTo ? (isSent ? '0 0 4px 18px' : '0 0 18px 4px') : (isSent ? '18px 18px 4px 18px' : '18px 18px 18px 4px'),
                          background: m.is_deleted ? 'var(--badge-muted-bg)' : (isSent ? 'var(--bubble-sent-bg)' : 'var(--bubble-received-bg)'),
                          color: m.is_deleted ? 'var(--text-muted)' : (isSent ? 'var(--bubble-sent-text)' : 'var(--bubble-received-text)'),
                          fontSize: '14px', lineHeight: 1.45, wordWrap: 'break-word',
                          fontStyle: m.is_deleted ? 'italic' : 'normal',
                        }}>
                          {m.message_type === 'photo' && m.metadata ? (() => {
                            try {
                              const meta = typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata;
                              return React.createElement('div', { style: { margin: '-6px -10px 4px -10px' } },
                                React.createElement('img', {
                                  src: meta.photoUrl,
                                  alt: meta.caption || 'Photo',
                                  style: { maxWidth: '100%', maxHeight: 300, borderRadius: 12, display: 'block', cursor: 'pointer' },
                                  onClick: (e) => { e.stopPropagation(); setLightboxPhoto({ src: meta.photoUrl, caption: meta.caption }); },
                                }),
                                meta.caption ? React.createElement('div', { style: { padding: '4px 10px 0', fontSize: 14 } }, meta.caption) : null
                              );
                            } catch { return renderMessageContent(m.content); }
                          })() : renderMessageContent(m.content)}
                          <div style={{ fontSize: '10px', color: isSent ? 'var(--bubble-sent-meta)' : 'var(--bubble-received-meta)', marginTop: '4px', textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 3 }}>
                            <span>{(() => {
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
                            })()}</span>
                            {isSent && (() => {
                              // Read receipt checkmarks for sent messages
                              const convReceipts = readReceipts[activeConvId] || {};
                              const msgTime = new Date(m.created_at).getTime();
                              const isRead = Object.values(convReceipts).some(readAt => new Date(readAt).getTime() >= msgTime);
                              return (
                                <span title={isRead ? 'Read' : 'Delivered'} style={{ display: 'inline-flex', alignItems: 'center' }}
                                  dangerouslySetInnerHTML={{ __html: isRead
                                    ? '<svg width="16" height="10" viewBox="0 0 24 14"><path d="M1 7l4.5 5L17 1" fill="none" stroke="rgba(255,255,255,0.95)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 7l4.5 5L23 1" fill="none" stroke="rgba(255,255,255,0.95)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
                                    : '<svg width="12" height="10" viewBox="0 0 16 14"><path d="M1 7l4.5 5L15 1" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
                                  }} />
                              );
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
                                  background: rList.some(r => r.userId === currentUser?.id) ? 'var(--color-success-bg)' : 'var(--bg-primary)',
                                  border: rList.some(r => r.userId === currentUser?.id) ? '1px solid #1b6b5a' : '1px solid #e0e0e0',
                                  borderRadius: 12, fontSize: 13, cursor: 'pointer', lineHeight: 1,
                                }}>
                                <span>{emoji}</span>
                                {rList.length > 1 && <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{rList.length}</span>}
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
                          background: 'var(--bg-surface)', borderRadius: 8, boxShadow: '0 1px 6px rgba(0,0,0,0.1)', padding: '2px',
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
                          {isSent && !m.is_deleted && (
                            <button onClick={async () => {
                              if (!confirm('Delete this message? Others will see "deleted a message".')) return;
                              try {
                                const dr = await apiFetch(`/api/messages/${m.id}`, { method: 'DELETE' });
                                if (dr?.ok) {
                                  const dd = await dr.json();
                                  m.content = dd.tombstone;
                                  m.is_deleted = 1;
                                  await fetchMessages(activeConvId);
                                } else {
                                  if (typeof showToast === 'function') showToast('Failed to delete message', 'error');
                                }
                              } catch (e) { console.error('Delete message error:', e); }
                            }}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', fontSize: 14, borderRadius: 6, color: 'var(--color-error)' }}
                              title="Delete">
                              🗑
                            </button>
                          )}
                        </div>
                        {/* Emoji picker popover */}
                        {showEmojiFor === m.id && (
                          <div style={{
                            position: 'absolute', bottom: '100%', marginBottom: 4,
                            [isSent ? 'right' : 'left']: 0,
                            background: 'var(--bg-surface)', borderRadius: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
                            padding: '6px 8px', display: 'flex', gap: 2, zIndex: 10,
                          }}>
                            {REACTION_EMOJIS.map(emoji => (
                              <button key={emoji} onClick={() => handleReaction(m.id, emoji)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, padding: '4px', borderRadius: 8, transition: 'background 0.15s' }}
                                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--badge-muted-bg)'}
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
            })}
            </React.Fragment>
          )}
          {/* Typing indicator */}
          {activeConvId && typingUsers[activeConvId] && Object.keys(typingUsers[activeConvId]).length > 0 && (() => {
            const typers = Object.values(typingUsers[activeConvId]).map(t => t.name);
            const label = typers.length === 1
              ? `${typers[0]} is typing`
              : typers.length === 2
                ? `${typers[0]} and ${typers[1]} are typing`
                : `${typers[0]} and ${typers.length - 1} others are typing`;
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px 2px', color: 'var(--text-muted)', fontSize: 12 }}>
                <div style={{ display: 'flex', gap: 3 }}>
                  <span className="typing-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--role-color)', opacity: 0.6, animation: 'typingBounce 1.2s ease-in-out infinite' }} />
                  <span className="typing-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--role-color)', opacity: 0.6, animation: 'typingBounce 1.2s ease-in-out 0.2s infinite' }} />
                  <span className="typing-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--role-color)', opacity: 0.6, animation: 'typingBounce 1.2s ease-in-out 0.4s infinite' }} />
                </div>
                <span>{label}</span>
              </div>
            );
          })()}
          <div ref={messagesEndRef} />
        </div>

        {/* iPAi instruction suggestion card */}
        {instructionSuggestion && (
          <div style={{
            margin: '8px 16px', padding: 14, background: '#f0faf7', border: '1px solid #b2dfdb',
            borderRadius: 12, fontSize: 13,
          }}>
            <div style={{ fontWeight: 600, color: 'var(--role-color)', marginBottom: 6, fontSize: 14 }}>
              {String.fromCodePoint(0x1F4CB)} Add caregiver instructions?
            </div>
            <div style={{ color: 'var(--text-secondary)', marginBottom: 4, fontSize: 12 }}>
              For: <strong>{instructionSuggestion.sessionLabel}</strong>
            </div>
            <div style={{
              background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8,
              padding: '10px 12px', marginBottom: 10, lineHeight: 1.5, whiteSpace: 'pre-wrap',
            }}>
              {instructionSuggestion.summary}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setInstructionSuggestion(null)}
                style={{ background: 'none', border: '1px solid #ccc', borderRadius: 8, padding: '6px 16px', fontSize: 13, cursor: 'pointer' }}>
                No thanks
              </button>
              <button disabled={savingInstruction} onClick={async () => {
                setSavingInstruction(true);
                try {
                  const res = await apiFetch(`/api/sessions/${instructionSuggestion.sessionId}/instructions`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ specialInstructions: instructionSuggestion.summary }),
                  });
                  if (res?.ok) {
                    if (typeof showToast === 'function') showToast('Instructions added to session', 'success');
                    setInstructionSuggestion(null);
                  } else {
                    const err = await res?.json().catch(() => ({}));
                    if (typeof showToast === 'function') showToast(err?.error || 'Failed to save instructions', 'error');
                  }
                } catch (e) {
                  if (typeof showToast === 'function') showToast('Network error saving instructions', 'error');
                }
                setSavingInstruction(false);
              }}
                style={{ background: 'var(--role-color)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: savingInstruction ? 0.6 : 1 }}>
                {savingInstruction ? 'Adding...' : 'Yes, add'}
              </button>
            </div>
          </div>
        )}

        {/* Reply preview bar */}
        {replyTo && (
          <div style={{
            display: 'flex', alignItems: 'center', padding: '8px 16px', background: 'var(--bg-highlight)',
            borderTop: '1px solid #e0e0e0', borderLeft: '3px solid #1b6b5a', gap: 10,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--role-color)' }}>
                Replying to {replyTo.senderName || 'message'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {replyTo.content}
              </div>
            </div>
            <button onClick={() => setReplyTo(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, padding: '0 4px', flexShrink: 0 }}>
              ×
            </button>
          </div>
        )}
        {/* v1.105.37 — sits with the composer rather than only on the empty state, so it is
            on screen at the moment someone reads an answer, not just before they ask. */}
        {isIPAiThread && typeof IPAiDisclaimer !== 'undefined' && (
          <div style={{ padding: '0 12px 6px' }}><IPAiDisclaimer /></div>
        )}
        <div className="msg-input-area">
          {/* Hidden file input for photo uploads */}
          {/* v1.103.3 — no capture attr (forced camera-only); iOS now offers
              the library/camera/file sheet */}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handlePhotoUpload}
          />
          {/* Photo upload button */}
          <button
            onClick={() => photoInputRef.current?.click()}
            disabled={uploadingPhoto || sending}
            title="Send a photo"
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '8px 6px',
              color: uploadingPhoto ? 'var(--text-muted)' : 'var(--role-color)',
              display: 'flex', alignItems: 'center', flexShrink: 0,
            }}
          >
            {uploadingPhoto ? (
              <span style={{ display: 'inline-block', width: 20, height: 20, border: '2px solid var(--text-muted)', borderTopColor: 'var(--role-color)', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }}></span>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
              </svg>
            )}
          </button>
          <textarea
            ref={inputRef}
            className="msg-input"
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            placeholder={replyTo ? "Type your reply..." : "Type a message..."}
            value={inputText}
            rows={1}
            onChange={(e) => {
              setInputText(e.target.value);
              if (e.target.value) emitTyping();
              // Auto-grow: reset height then set to scrollHeight (max 3 lines ~72px)
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 72) + 'px';
            }}
            onKeyDown={(e) => {
              // Enter sends message, Shift+Enter inserts newline
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            disabled={sending}
            style={{ resize: 'none', overflow: 'hidden' }}
          />
          <button className="msg-send-btn" onClick={handleSendMessage} disabled={sending || !inputText.trim()}>
            {sending ? (
              <span style={{ display: 'inline-block', width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'var(--bg-surface)', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }}></span>
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
    const typeLabel = incomingCall.callType === 'video' ? 'Video' : 'Voice';
    const callSvg = incomingCall.callType === 'video'
      ? '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--bg-surface)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>'
      : '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--bg-surface)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
        background: 'linear-gradient(135deg, #1b6b5a, #2a9d8f)',
        padding: '16px 24px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', color: 'var(--text-on-primary)', boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        animation: 'slideDown 0.3s ease',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ display: 'flex', alignItems: 'center', animation: 'pulse 1s infinite' }} dangerouslySetInnerHTML={{ __html: callSvg }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{incomingCall.callerName || 'Someone'}</div>
            <div style={{ fontSize: 13, opacity: 0.85 }}>Incoming {typeLabel} Call</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={handleDeclineIncoming}
            style={{ padding: '8px 20px', borderRadius: 20, border: 'none', background: '#e74c3c', color: 'var(--text-on-primary)', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
            Decline
          </button>
          <button onClick={handleAcceptIncoming}
            style={{ padding: '8px 20px', borderRadius: 20, border: 'none', background: 'var(--bg-surface)', color: 'var(--role-color)', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
            Accept
          </button>
        </div>
      </div>
    );
  };

  // ─── Photo Lightbox (pinch-to-zoom, tap to dismiss) ───
  const renderPhotoLightbox = () => {
    if (!lightboxPhoto) return null;

    const LightboxInner = () => {
      const imgRef = useRef(null);
      const containerRef = useRef(null);
      const stateRef = useRef({ scale: 1, translateX: 0, translateY: 0, initialDist: 0, initialScale: 1, isPinching: false, startX: 0, startY: 0, lastTapTime: 0 });

      const applyTransform = () => {
        if (!imgRef.current) return;
        const s = stateRef.current;
        imgRef.current.style.transform = `translate(${s.translateX}px, ${s.translateY}px) scale(${s.scale})`;
      };

      const resetZoom = () => {
        const s = stateRef.current;
        s.scale = 1; s.translateX = 0; s.translateY = 0;
        applyTransform();
      };

      const getTouchDist = (t1, t2) => Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

      const onTouchStart = (e) => {
        const s = stateRef.current;
        if (e.touches.length === 2) {
          e.preventDefault();
          s.isPinching = true;
          s.initialDist = getTouchDist(e.touches[0], e.touches[1]);
          s.initialScale = s.scale;
        } else if (e.touches.length === 1) {
          s.startX = e.touches[0].clientX;
          s.startY = e.touches[0].clientY;
          s.isPinching = false;
        }
      };

      const onTouchMove = (e) => {
        const s = stateRef.current;
        if (e.touches.length === 2 && s.isPinching) {
          e.preventDefault();
          const dist = getTouchDist(e.touches[0], e.touches[1]);
          s.scale = Math.min(5, Math.max(0.5, s.initialScale * (dist / s.initialDist)));
          applyTransform();
        } else if (e.touches.length === 1 && s.scale > 1) {
          e.preventDefault();
          const dx = e.touches[0].clientX - s.startX;
          const dy = e.touches[0].clientY - s.startY;
          s.translateX += dx;
          s.translateY += dy;
          s.startX = e.touches[0].clientX;
          s.startY = e.touches[0].clientY;
          applyTransform();
        }
      };

      const onTouchEnd = (e) => {
        const s = stateRef.current;
        if (e.touches.length < 2) s.isPinching = false;
        // Double-tap to toggle zoom
        if (e.changedTouches.length === 1 && e.touches.length === 0 && !s.isPinching) {
          const now = Date.now();
          if (now - s.lastTapTime < 300) {
            if (s.scale > 1.1) { resetZoom(); } else {
              s.scale = 2.5;
              // Zoom toward tap point
              const rect = containerRef.current?.getBoundingClientRect();
              if (rect) {
                const cx = e.changedTouches[0].clientX - rect.left - rect.width / 2;
                const cy = e.changedTouches[0].clientY - rect.top - rect.height / 2;
                s.translateX = -cx; s.translateY = -cy;
              }
              applyTransform();
            }
            s.lastTapTime = 0;
            return;
          }
          s.lastTapTime = now;
          // Single tap — dismiss if not zoomed
          setTimeout(() => {
            if (s.lastTapTime !== 0 && s.scale <= 1.1) {
              setLightboxPhoto(null);
            }
            s.lastTapTime = 0;
          }, 300);
        }
        // Snap back if zoomed out too far
        if (s.scale < 1) { s.scale = 1; s.translateX = 0; s.translateY = 0; applyTransform(); }
      };

      // Mouse wheel zoom for desktop
      const onWheel = (e) => {
        e.preventDefault();
        const s = stateRef.current;
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        s.scale = Math.min(5, Math.max(0.5, s.scale * delta));
        if (s.scale < 1) { s.scale = 1; s.translateX = 0; s.translateY = 0; }
        applyTransform();
      };

      return React.createElement('div', {
        ref: containerRef,
        onClick: (e) => { if (e.target === containerRef.current) setLightboxPhoto(null); },
        onTouchStart, onTouchMove, onTouchEnd, onWheel,
        style: {
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          touchAction: 'none', cursor: 'zoom-out',
        },
      },
        // Close button
        React.createElement('button', {
          onClick: () => setLightboxPhoto(null),
          style: {
            position: 'absolute', top: 16, right: 16, zIndex: 10000,
            background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: '50%',
            width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 24, cursor: 'pointer',
          },
        }, '\u00D7'),
        // Image
        React.createElement('img', {
          ref: imgRef,
          src: lightboxPhoto.src,
          alt: lightboxPhoto.caption || 'Photo',
          style: {
            maxWidth: '95vw', maxHeight: '90vh', objectFit: 'contain',
            transformOrigin: 'center center', transition: 'none',
            userSelect: 'none', WebkitUserSelect: 'none', pointerEvents: 'none',
          },
        }),
        // Caption
        lightboxPhoto.caption ? React.createElement('div', {
          style: {
            position: 'absolute', bottom: 24, left: 16, right: 16, textAlign: 'center',
            color: '#fff', fontSize: 15, textShadow: '0 1px 4px rgba(0,0,0,0.8)',
          },
        }, lightboxPhoto.caption) : null,
      );
    };

    return React.createElement(LightboxInner);
  };

  // ─── Layout ───
  const callOverlay = React.createElement(VideoCallOverlay, {
    callState: callState,
    onEndCall: handleEndCall,
    currentUserId: currentUser?.id,
  });

  if (isMobile) {
    // Capacitor native iOS fallback: 59px top, 34px bottom — covers all modern iPhones
    const isCapNative = window.Capacitor?.isNativePlatform?.();
    const safeTop = window.__safeAreaTop || (isCapNative ? 59 : 0);
    const safeBot = window.__safeAreaBottom || (isCapNative ? 34 : 0);
    return (
      <div style={{
        position: 'fixed',
        // v1.105.132 — the box the user can actually see, not the one the document thinks
        // it has. See the visualViewport effect above.
        top: vvBox ? vvBox.top : 0,
        left: 0,
        right: 0,
        ...(vvBox
          // While the keyboard is up the bottom nav is behind it; reserving its 55px is what
          // pushed the composer up into the conversation.
          ? { height: (kbOpen ? vvBox.height : Math.max(0, vvBox.height - safeBot - 55)) + 'px', bottom: 'auto' }
          : { bottom: (safeBot + 55) + 'px' }),
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        overscrollBehavior: 'none',
        zIndex: 1,
        background: 'var(--bg-surface)',
      }}>
        {safeTop > 0 && <div style={{ height: safeTop, flexShrink: 0, background: 'var(--bg-surface)' }} />}
        {renderIncomingCallBanner()}
        {callOverlay}
        {renderPhotoLightbox()}
        {/* ─── v1.105.18 — report dialog (guideline 1.2) ───
            Rendered at the top level, not inside the conversation list, so it survives the
            list/chat view switch on mobile. The copy states plainly that the reported person
            is not told: that reassurance is the whole reason someone frightened of a
            caregiver would use this instead of doing nothing. */}
        {reportFor && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10001, padding: 16 }}
            onClick={() => !reportBusy && setReportFor(null)}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-surface)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 400, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
              <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>Report {reportFor.name || 'this person'}</div>
              <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 16, lineHeight: 1.5 }}>
                Our safety team reviews reports within 24 hours. <strong>{reportFor.name ? reportFor.name.split(' ')[0] : 'They'} will not be told that you reported them.</strong>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                {[
                  ['safety_concern', "I'm worried about someone's safety"],
                  ['harassment', 'Harassment or abusive behaviour'],
                  ['inappropriate', 'Inappropriate content'],
                  ['scam', 'Scam or fraud'],
                  ['impersonation', 'Pretending to be someone else'],
                  ['spam', 'Spam'],
                  ['other', 'Something else'],
                ].map(([val, label]) => (
                  <button key={val} onClick={() => setReportCategory(val)}
                    style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 10, fontSize: 13.5, cursor: 'pointer',
                      border: '1px solid ' + (reportCategory === val ? 'var(--color-primary)' : 'var(--border-color)'),
                      background: reportCategory === val ? 'var(--color-primary-bg, rgba(27,107,90,0.08))' : 'var(--bg-surface)',
                      fontWeight: reportCategory === val ? 600 : 400 }}>
                    {label}
                  </button>
                ))}
              </div>
              <textarea value={reportDetails} onChange={e => setReportDetails(e.target.value)}
                placeholder="Anything else we should know? (optional)"
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-color)', fontSize: 13, minHeight: 70, resize: 'vertical', marginBottom: 14, boxSizing: 'border-box' }} />
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button disabled={reportBusy} onClick={() => { setReportFor(null); setReportCategory(''); setReportDetails(''); }}
                  style={{ padding: '9px 16px', borderRadius: 9, border: '1px solid var(--border-color)', background: 'var(--bg-surface)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button disabled={!reportCategory || reportBusy} onClick={submitReport}
                  style={{ padding: '9px 18px', borderRadius: 9, border: 'none', background: reportCategory ? 'var(--color-error)' : 'var(--border-color)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: reportCategory ? 'pointer' : 'not-allowed' }}>
                  {reportBusy ? 'Sending…' : 'Send report'}
                </button>
              </div>
            </div>
          </div>
        )}
        {messagingLimited && !activeConvId && (
          <div style={{ padding: '10px 16px', background: 'var(--color-warning-bg)', borderBottom: '1px solid #ffe082', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 16 }}>🔒</span>
            <span style={{ fontSize: 13, color: 'var(--color-warning)' }}>Messaging limited to InPlace Support until your background check is approved.</span>
          </div>
        )}
        {showFindPeople ? renderFindPeople() : showNewChat ? renderNewChatPicker() : activeConvId ? renderChatView() : renderConversationList()}
      </div>
    );
  }

  // Desktop: side-by-side
  return (
    <>
      {renderIncomingCallBanner()}
      {callOverlay}
      {renderPhotoLightbox()}
      {messagingLimited && (
        <div style={{ padding: '10px 16px', background: 'var(--color-warning-bg)', borderBottom: '1px solid #ffe082', display: 'flex', alignItems: 'center', gap: 8, borderRadius: '12px 12px 0 0' }}>
          <span style={{ fontSize: 16 }}>🔒</span>
          <span style={{ fontSize: 13, color: 'var(--color-warning)' }}>Messaging is limited to InPlace Support until your background check is approved.</span>
        </div>
      )}
      <div style={{ display: 'flex', height: messagingLimited ? 'calc(100% - 40px)' : '100%', background: 'var(--bg-surface)', borderRadius: messagingLimited ? '0 0 12px 12px' : '12px', overflow: 'hidden', boxShadow: '0 1px 8px rgba(0,0,0,0.08)' }}>
        <div style={{ width: '320px', borderRight: '1px solid #e8e8e8', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
          {showFindPeople ? renderFindPeople() : showNewChat ? renderNewChatPicker() : renderConversationList()}
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {activeConvId ? renderChatView() : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '64px', marginBottom: '16px' }}>💬</div>
                <div style={{ fontSize: '16px', color: 'var(--text-muted)' }}>Select a conversation</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
