/**
 * HelpPage — Dynamic FAQ/Help center
 * Fetches articles from /api/help, filters by category and search
 * Deep-links to in-app pages when articles have link_page set
 */
const HelpPage = window.HelpPage = ({ currentUser, onNavigate }) => {
  const [articles, setArticles] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [activeCategory, setActiveCategory] = React.useState('all');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [expandedId, setExpandedId] = React.useState(null);
  const [showFeedback, setShowFeedback] = React.useState(false);
  const [fbCategory, setFbCategory] = React.useState('general');
  const [fbDescription, setFbDescription] = React.useState('');
  const [fbMood, setFbMood] = React.useState(null);
  const [fbSubmitting, setFbSubmitting] = React.useState(false);
  const [fbSubmitted, setFbSubmitted] = React.useState(false);
  const [fbError, setFbError] = React.useState(null);
  // Dispute state
  const [showDispute, setShowDispute] = React.useState(false);
  const [disputeSessionId, setDisputeSessionId] = React.useState('');
  const [disputeReason, setDisputeReason] = React.useState('');
  const [disputeDesc, setDisputeDesc] = React.useState('');
  const [disputeSubmitting, setDisputeSubmitting] = React.useState(false);
  const [disputeSubmitted, setDisputeSubmitted] = React.useState(false);
  const [disputeError, setDisputeError] = React.useState(null);
  const [recentSessions, setRecentSessions] = React.useState([]);
  const [myDisputes, setMyDisputes] = React.useState([]);

  const categories = [
    { id: 'all', label: 'All' },
    { id: 'getting-started', label: 'Getting Started' },
    { id: 'families', label: 'For Families' },
    { id: 'caregivers', label: 'For Caregivers' },
    { id: 'technical', label: 'Technical' },
    { id: 'billing', label: 'Billing' },
  ];

  React.useEffect(() => {
    loadArticles();
    // Load recent sessions for dispute picker and existing disputes
    if (currentUser) {
      apiFetch('/api/sessions').then(async r => {
        if (r?.ok) {
          const d = await r.json();
          const sessions = d.sessions || d || [];
          // Show last 10 completed/cancelled sessions
          setRecentSessions(sessions.filter(s => ['completed', 'cancelled', 'in_progress'].includes(s.status)).slice(0, 10));
        }
      }).catch(() => {});
      apiFetch('/api/accountability/disputes').then(async r => {
        if (r?.ok) { const d = await r.json(); setMyDisputes(d.disputes || []); }
      }).catch(() => {});
    }
  }, []);

  const loadArticles = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/help');
      if (res && res.ok) {
        const data = await res.json();
        setArticles(data.articles || []);
      }
    } catch (err) {
      console.error('Failed to load help articles:', err);
    }
    setLoading(false);
  };

  const filtered = React.useMemo(() => {
    let result = articles;

    if (activeCategory !== 'all') {
      result = result.filter(a => a.category === activeCategory);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(a =>
        a.question.toLowerCase().includes(q) ||
        a.answer.toLowerCase().includes(q)
      );
    }

    return result;
  }, [articles, activeCategory, searchQuery]);

  // Group by category for display
  const grouped = React.useMemo(() => {
    if (activeCategory !== 'all') {
      return [{ category: activeCategory, articles: filtered }];
    }
    const groups = {};
    filtered.forEach(a => {
      if (!groups[a.category]) groups[a.category] = [];
      groups[a.category].push(a);
    });
    return Object.entries(groups).map(([category, articles]) => ({ category, articles }));
  }, [filtered, activeCategory]);

  const categoryLabel = (id) => {
    const cat = categories.find(c => c.id === id);
    return cat ? cat.label : id;
  };

  const formatAnswer = (text) => {
    // Simple markdown-lite: **bold**, \n for line breaks
    // Escape HTML to prevent XSS, then apply safe markdown-like transforms
    const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const parts = text.split('\n');
    return parts.map((line, i) => {
      // Escape first, then apply bold formatting on the safe string
      const escaped = escapeHtml(line);
      const formatted = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      // Numbered lists
      const isListItem = /^\d+\.\s/.test(line.trim());
      const isBullet = /^[-•]\s/.test(line.trim());

      if (!line.trim()) return React.createElement('br', { key: i });
      if (isListItem || isBullet) {
        return React.createElement('div', {
          key: i,
          style: { paddingLeft: '16px', marginBottom: '4px' },
          dangerouslySetInnerHTML: { __html: formatted }
        });
      }
      return React.createElement('p', {
        key: i,
        style: { margin: '0 0 8px 0', lineHeight: '1.6' },
        dangerouslySetInnerHTML: { __html: formatted }
      });
    });
  };

  const handleNavigate = (page) => {
    if (onNavigate) onNavigate(page);
  };

  const handleFeedbackSubmit = async () => {
    if (fbDescription.trim().length < 10) return;
    setFbSubmitting(true);
    setFbError(null);
    try {
      const payload = {
        category: fbCategory,
        description: fbDescription.trim(),
        mood: fbMood,
        pageContext: { page: 'help', role: currentUser?.role || 'unknown', version: window.APP_VERSION || 'unknown', device: window.innerWidth <= 768 ? 'mobile' : 'desktop', timestamp: new Date().toISOString() },
      };
      let res;
      if (currentUser) {
        res = await apiFetch('/api/feedback', { method: 'POST', body: JSON.stringify(payload) });
      } else {
        res = await fetch('/api/feedback/anonymous', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      }
      if (res?.ok) {
        setFbSubmitted(true);
        setTimeout(() => { setFbSubmitted(false); setFbDescription(''); setFbMood(null); setFbCategory('general'); setShowFeedback(false); }, 2000);
      } else {
        const data = await res?.json();
        setFbError(data?.error || 'Failed to submit. Please try again.');
      }
    } catch (err) {
      setFbError('Something went wrong. Please try again.');
    }
    setFbSubmitting(false);
  };

  const handleDisputeSubmit = async () => {
    if (!disputeSessionId || !disputeReason) return;
    setDisputeSubmitting(true);
    setDisputeError(null);
    try {
      const res = await apiFetch('/api/accountability/dispute', {
        method: 'POST',
        body: JSON.stringify({ sessionId: disputeSessionId, reason: disputeReason, description: disputeDesc || null }),
      });
      if (res?.ok) {
        setDisputeSubmitted(true);
        setTimeout(() => {
          setDisputeSubmitted(false); setShowDispute(false);
          setDisputeSessionId(''); setDisputeReason(''); setDisputeDesc('');
          // Refresh disputes list
          apiFetch('/api/accountability/disputes').then(async r => {
            if (r?.ok) { const d = await r.json(); setMyDisputes(d.disputes || []); }
          }).catch(() => {});
        }, 2000);
      } else {
        const data = await res?.json().catch(() => ({}));
        setDisputeError(data?.error || 'Failed to submit dispute');
      }
    } catch { setDisputeError('Something went wrong. Please try again.'); }
    setDisputeSubmitting(false);
  };

  return React.createElement('div', { style: { maxWidth: '800px', margin: '0 auto' } },
    // Header
    React.createElement('h1', {
      className: 'page-title',
      style: { marginBottom: '8px' }
    }, 'Help & FAQ'),

    React.createElement('p', {
      style: { color: '#666', marginBottom: '24px', fontSize: '15px' }
    }, 'Find answers to common questions about using InPlace.'),

    // Search bar
    React.createElement('div', { style: { marginBottom: '20px', position: 'relative' } },
      React.createElement('input', {
        type: 'text',
        placeholder: 'Search help articles...',
        value: searchQuery,
        onChange: (e) => setSearchQuery(e.target.value),
        style: {
          width: '100%',
          padding: '12px 16px 12px 40px',
          border: '1px solid #ddd',
          borderRadius: '10px',
          fontSize: '15px',
          outline: 'none',
          boxSizing: 'border-box',
          transition: 'border-color 0.2s',
        },
        onFocus: (e) => e.target.style.borderColor = '#1b6b5a',
        onBlur: (e) => e.target.style.borderColor = '#ddd',
      }),
      React.createElement('span', {
        style: {
          position: 'absolute',
          left: '14px',
          top: '50%',
          transform: 'translateY(-50%)',
          color: '#999',
          fontSize: '16px',
          pointerEvents: 'none'
        }
      }, '🔍')
    ),

    // Category pills
    React.createElement('div', {
      style: {
        display: 'flex',
        gap: '8px',
        marginBottom: '24px',
        flexWrap: 'wrap'
      }
    },
      categories.map(cat =>
        React.createElement('button', {
          key: cat.id,
          onClick: () => setActiveCategory(cat.id),
          style: {
            padding: '6px 16px',
            borderRadius: '20px',
            border: activeCategory === cat.id ? '2px solid #1b6b5a' : '1px solid #ddd',
            background: activeCategory === cat.id ? '#1b6b5a' : 'white',
            color: activeCategory === cat.id ? 'white' : '#555',
            fontSize: '13px',
            fontWeight: activeCategory === cat.id ? '600' : '400',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }
        }, cat.label)
      )
    ),

    // Loading
    loading && React.createElement('div', {
      style: { textAlign: 'center', padding: '40px', color: '#999' }
    }, 'Loading help articles...'),

    // No results
    !loading && filtered.length === 0 && React.createElement('div', {
      style: {
        textAlign: 'center',
        padding: '40px',
        color: '#999',
        background: '#f9f9f9',
        borderRadius: '12px'
      }
    },
      React.createElement('div', { style: { fontSize: '32px', marginBottom: '12px' } }, '🤔'),
      React.createElement('p', { style: { margin: 0 } },
        searchQuery
          ? `No articles matching "${searchQuery}"`
          : 'No articles in this category yet.'
      ),
      searchQuery && React.createElement('button', {
        onClick: () => { setSearchQuery(''); setActiveCategory('all'); },
        style: {
          marginTop: '12px',
          padding: '8px 16px',
          background: '#1b6b5a',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer',
          fontSize: '13px'
        }
      }, 'Clear search')
    ),

    // FAQ groups
    !loading && grouped.map(group =>
      React.createElement('div', { key: group.category, style: { marginBottom: '28px' } },
        // Category header (only show when viewing "all")
        activeCategory === 'all' && React.createElement('h2', {
          style: {
            fontSize: '16px',
            fontWeight: '600',
            color: '#1b6b5a',
            marginBottom: '12px',
            paddingBottom: '8px',
            borderBottom: '2px solid #e8f5f0'
          }
        }, categoryLabel(group.category)),

        // Accordion items
        group.articles.map(article =>
          React.createElement('div', {
            key: article.id,
            style: {
              border: '1px solid #e5e5e5',
              borderRadius: '10px',
              marginBottom: '8px',
              overflow: 'hidden',
              background: 'white',
              transition: 'box-shadow 0.2s',
              boxShadow: expandedId === article.id ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
            }
          },
            // Question (header)
            React.createElement('button', {
              onClick: () => setExpandedId(expandedId === article.id ? null : article.id),
              style: {
                width: '100%',
                padding: '16px 20px',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                textAlign: 'left',
                gap: '12px',
              }
            },
              React.createElement('span', {
                style: {
                  fontSize: '15px',
                  fontWeight: '500',
                  color: '#333',
                  flex: 1,
                  lineHeight: '1.4'
                }
              }, article.question),
              React.createElement('span', {
                style: {
                  fontSize: '18px',
                  color: '#999',
                  transform: expandedId === article.id ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s',
                  flexShrink: 0,
                }
              }, '▾')
            ),

            // Answer (expanded)
            expandedId === article.id && React.createElement('div', {
              style: {
                padding: '0 20px 16px',
                borderTop: '1px solid #f0f0f0',
                paddingTop: '16px',
                color: '#555',
                fontSize: '14px',
              }
            },
              formatAnswer(article.answer),
              // Deep-link button
              article.link_page && React.createElement('button', {
                onClick: () => handleNavigate(article.link_page),
                style: {
                  marginTop: '12px',
                  padding: '8px 16px',
                  background: '#e8f5f0',
                  color: '#1b6b5a',
                  border: '1px solid #1b6b5a',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: '500',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }
              }, article.link_label || 'Go to page', ' →')
            )
          )
        )
      )
    ),

    // Contact Us section
    !loading && React.createElement('div', {
      style: {
        marginTop: '32px',
        padding: '24px',
        background: '#f8faf9',
        borderRadius: '12px',
        border: '1px solid #e0e0e0',
      }
    },
      React.createElement('div', {
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showFeedback ? '16px' : '0' }
      },
        React.createElement('div', null,
          React.createElement('h3', { style: { margin: '0 0 4px 0', fontSize: '16px', fontWeight: 600, color: '#333' } }, 'Contact Us'),
          React.createElement('p', { style: { margin: 0, fontSize: '13px', color: '#888' } }, 'Can\'t find what you\'re looking for? Send us a message.')
        ),
        !showFeedback && React.createElement('button', {
          onClick: () => setShowFeedback(true),
          style: {
            padding: '10px 20px', background: '#1b6b5a', color: '#fff', border: 'none',
            borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
            whiteSpace: 'nowrap',
          }
        }, 'Send Feedback')
      ),

      // Inline feedback form
      showFeedback && (fbSubmitted
        ? React.createElement('div', { style: { textAlign: 'center', padding: '24px 0' } },
            React.createElement('div', { style: { fontSize: '32px', marginBottom: '8px' } }, '🎉'),
            React.createElement('div', { style: { fontSize: '16px', fontWeight: 600, color: '#1b6b5a' } }, 'Thank you!'),
            React.createElement('div', { style: { fontSize: '13px', color: '#888', marginTop: '4px' } }, 'Your message has been sent.')
          )
        : React.createElement('div', null,
            // Category
            React.createElement('div', { style: { marginBottom: '12px' } },
              React.createElement('label', { style: { display: 'block', fontSize: '13px', fontWeight: 600, color: '#555', marginBottom: '4px' } }, 'Category'),
              React.createElement('select', {
                value: fbCategory, onChange: (e) => setFbCategory(e.target.value),
                style: { width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px', background: '#fff', boxSizing: 'border-box' },
              },
                React.createElement('option', { value: 'general' }, 'General'),
                React.createElement('option', { value: 'bug' }, 'Bug Report'),
                React.createElement('option', { value: 'feature' }, 'Feature Request'),
                React.createElement('option', { value: 'complaint' }, 'Complaint'),
                React.createElement('option', { value: 'praise' }, 'Praise')
              )
            ),
            // Description
            React.createElement('div', { style: { marginBottom: '12px' } },
              React.createElement('label', { style: { display: 'block', fontSize: '13px', fontWeight: 600, color: '#555', marginBottom: '4px' } }, 'Message'),
              React.createElement('textarea', {
                value: fbDescription, onChange: (e) => setFbDescription(e.target.value),
                placeholder: 'Tell us what\'s on your mind...', rows: 4,
                style: { width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' },
              }),
              fbDescription.length > 0 && fbDescription.trim().length < 10 && React.createElement('div', { style: { fontSize: '11px', color: '#e8724a', marginTop: '4px' } }, 'Please write at least 10 characters')
            ),
            // Mood
            React.createElement('div', { style: { marginBottom: '16px' } },
              React.createElement('label', { style: { display: 'block', fontSize: '13px', fontWeight: 600, color: '#555', marginBottom: '6px' } }, 'How are you feeling? (optional)'),
              React.createElement('div', { style: { display: 'flex', gap: '8px' } },
                [{ emoji: '😊', value: 'great' }, { emoji: '🙂', value: 'good' }, { emoji: '😐', value: 'okay' }, { emoji: '😟', value: 'bad' }, { emoji: '😡', value: 'terrible' }].map(m =>
                  React.createElement('button', {
                    key: m.value,
                    onClick: () => setFbMood(fbMood === m.value ? null : m.value),
                    style: {
                      width: 40, height: 40, borderRadius: '50%', border: 'none', cursor: 'pointer', fontSize: 20,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: fbMood === m.value ? '#e0f2e9' : '#f5f5f5',
                      outline: fbMood === m.value ? '2px solid #1b6b5a' : 'none',
                    }
                  }, m.emoji)
                )
              )
            ),
            // Error
            fbError && React.createElement('div', { style: { padding: '8px 12px', background: '#fce4ec', color: '#c62828', borderRadius: '8px', fontSize: '13px', marginBottom: '12px' } }, fbError),
            // Buttons
            React.createElement('div', { style: { display: 'flex', gap: '10px' } },
              React.createElement('button', {
                onClick: () => { setShowFeedback(false); setFbError(null); },
                style: { padding: '10px 16px', background: '#f0f0f0', color: '#666', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', cursor: 'pointer' }
              }, 'Cancel'),
              React.createElement('button', {
                onClick: handleFeedbackSubmit,
                disabled: fbDescription.trim().length < 10 || fbSubmitting,
                style: {
                  padding: '10px 20px', background: fbDescription.trim().length >= 10 && !fbSubmitting ? '#1b6b5a' : '#ccc',
                  color: '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600,
                  cursor: fbDescription.trim().length >= 10 && !fbSubmitting ? 'pointer' : 'not-allowed',
                }
              }, fbSubmitting ? 'Sending...' : 'Send')
            )
          )
      )
    ),

    // ─── Dispute a Session ───
    currentUser && React.createElement('div', { style: { marginTop: 32, padding: 24, background: '#fff', borderRadius: 14, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #e8e8e8' } },
      React.createElement('h3', { style: { margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: '#333' } }, '\u2696\uFE0F Dispute a Session'),
      React.createElement('p', { style: { fontSize: 14, color: '#666', margin: '0 0 16px', lineHeight: 1.5 } },
        'If something went wrong during a care session, you can file a dispute for admin review. This includes issues with timing, service quality, billing, or safety concerns.'
      ),

      !showDispute
        ? React.createElement('button', {
            onClick: () => setShowDispute(true),
            style: { padding: '10px 20px', background: '#f5f5f5', color: '#333', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }
          }, 'File a Dispute')
        : React.createElement('div', { style: { marginTop: 8 } },
            disputeSubmitted
              ? React.createElement('div', { style: { padding: 16, background: '#e0f2e9', borderRadius: 10, textAlign: 'center', color: '#1b6b5a', fontWeight: 600 } }, '\u2705 Dispute filed. We\'ll review it shortly.')
              : React.createElement(React.Fragment, null,
                  // Session picker
                  React.createElement('div', { style: { marginBottom: 12 } },
                    React.createElement('label', { style: { display: 'block', fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 4 } }, 'Which session?'),
                    React.createElement('select', {
                      value: disputeSessionId, onChange: (e) => setDisputeSessionId(e.target.value),
                      style: { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, background: '#fff', boxSizing: 'border-box' }
                    },
                      React.createElement('option', { value: '' }, 'Select a session...'),
                      ...recentSessions.map(s => React.createElement('option', { key: s.id, value: s.id },
                        `${s.scheduled_date || 'Unknown date'} — ${s.caregiver_name || s.recipient_name || 'Session'} (${s.status})`
                      ))
                    )
                  ),
                  // Reason
                  React.createElement('div', { style: { marginBottom: 12 } },
                    React.createElement('label', { style: { display: 'block', fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 4 } }, 'Reason'),
                    React.createElement('select', {
                      value: disputeReason, onChange: (e) => setDisputeReason(e.target.value),
                      style: { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, background: '#fff', boxSizing: 'border-box' }
                    },
                      React.createElement('option', { value: '' }, 'Select a reason...'),
                      React.createElement('option', { value: 'billing' }, 'Billing / Payment Issue'),
                      React.createElement('option', { value: 'timing' }, 'Timing Dispute (late, early, wrong hours)'),
                      React.createElement('option', { value: 'service_quality' }, 'Service Quality Concern'),
                      React.createElement('option', { value: 'safety' }, 'Safety Concern'),
                      React.createElement('option', { value: 'no_show' }, 'No-Show Dispute'),
                      React.createElement('option', { value: 'other' }, 'Other')
                    )
                  ),
                  // Description
                  React.createElement('div', { style: { marginBottom: 12 } },
                    React.createElement('label', { style: { display: 'block', fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 4 } }, 'Description (optional)'),
                    React.createElement('textarea', {
                      value: disputeDesc, onChange: (e) => setDisputeDesc(e.target.value),
                      placeholder: 'Describe what happened...', rows: 3,
                      style: { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }
                    })
                  ),
                  disputeError && React.createElement('div', { style: { padding: '8px 12px', background: '#fce4ec', color: '#c62828', borderRadius: 8, fontSize: 13, marginBottom: 12 } }, disputeError),
                  React.createElement('div', { style: { display: 'flex', gap: 10 } },
                    React.createElement('button', {
                      onClick: () => { setShowDispute(false); setDisputeError(null); },
                      style: { padding: '10px 16px', background: '#f0f0f0', color: '#666', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, cursor: 'pointer' }
                    }, 'Cancel'),
                    React.createElement('button', {
                      onClick: handleDisputeSubmit,
                      disabled: !disputeSessionId || !disputeReason || disputeSubmitting,
                      style: {
                        padding: '10px 20px',
                        background: disputeSessionId && disputeReason && !disputeSubmitting ? '#c62828' : '#ccc',
                        color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
                        cursor: disputeSessionId && disputeReason && !disputeSubmitting ? 'pointer' : 'not-allowed',
                      }
                    }, disputeSubmitting ? 'Submitting...' : 'Submit Dispute')
                  )
                )
          ),

      // Existing disputes
      myDisputes.length > 0 && React.createElement('div', { style: { marginTop: 20, borderTop: '1px solid #eee', paddingTop: 16 } },
        React.createElement('h4', { style: { margin: '0 0 10px', fontSize: 15, fontWeight: 600, color: '#555' } }, 'Your Disputes'),
        ...myDisputes.map(d => React.createElement('div', {
          key: d.id,
          style: { padding: 12, marginBottom: 8, background: '#f9f9f9', borderRadius: 10, border: '1px solid #eee' }
        },
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
            React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#333' } }, d.reason),
            React.createElement('span', { style: {
              fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
              background: d.status === 'open' ? '#fff3e0' : d.status === 'resolved' ? '#e0f2e9' : '#f5f5f5',
              color: d.status === 'open' ? '#e65100' : d.status === 'resolved' ? '#1b6b5a' : '#666',
            } }, d.status.toUpperCase())
          ),
          React.createElement('div', { style: { fontSize: 12, color: '#888', marginTop: 4 } },
            `Session on ${d.scheduled_date || 'N/A'} — filed ${new Date(d.created_at).toLocaleDateString()}`
          ),
          d.admin_notes && React.createElement('div', { style: { fontSize: 13, color: '#333', marginTop: 6, padding: '8px 10px', background: '#e3f2fd', borderRadius: 8 } },
            React.createElement('strong', null, 'Admin: '), d.admin_notes
          )
        ))
      )
    )
  );
};
