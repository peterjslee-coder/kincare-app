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

    // Footer help text
    !loading && filtered.length > 0 && React.createElement('div', {
      style: {
        textAlign: 'center',
        padding: '24px',
        color: '#999',
        fontSize: '13px',
        borderTop: '1px solid #eee',
        marginTop: '16px'
      }
    },
      'Can\'t find what you\'re looking for? Use the ',
      React.createElement('span', { style: { fontSize: '16px' } }, '💡'),
      ' feedback button to ask us directly.'
    )
  );
};
