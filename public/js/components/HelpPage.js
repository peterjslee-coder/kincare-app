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
    const parts = text.split('\n');
    return parts.map((line, i) => {
      // Bold
      const formatted = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
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
    )
  );
};
