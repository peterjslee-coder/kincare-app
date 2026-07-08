// ─── Legal Document Agreement Modal ───
// Shows when users need to accept new/updated terms, privacy, or liability docs.
// Blocks the app until all pending docs are accepted.
// Supports: scroll-to-bottom requirement, change summary, sequential doc review.

const DisclaimerModal = window.DisclaimerModal = ({ onAccept, pendingDocs }) => {
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [checked, setChecked] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [copiedAI, setCopiedAI] = useState(false);
  const contentRef = useRef(null);

  // If no pendingDocs provided, fall back to legacy disclaimer
  const docs = pendingDocs && pendingDocs.length > 0 ? pendingDocs : null;
  const currentDoc = docs ? docs[currentIdx] : null;
  const isLegacy = !docs;
  const totalDocs = docs ? docs.length : 1;

  // Reset scroll/check state when moving to next doc
  useEffect(() => {
    setScrolledToBottom(false);
    setChecked(false);
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
      // If content fits without scrolling, enable immediately
      requestAnimationFrame(() => {
        const el = contentRef.current;
        if (el && el.scrollHeight <= el.clientHeight + 20) {
          setScrolledToBottom(true);
        }
      });
    }
  }, [currentIdx]);

  const handleScroll = () => {
    const el = contentRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    if (atBottom) setScrolledToBottom(true);
  };

  useEffect(() => {
    const el = contentRef.current;
    if (el && el.scrollHeight <= el.clientHeight + 20) {
      setScrolledToBottom(true);
    }
  }, []);

  const handleAccept = async () => {
    setAccepting(true);
    try {
      if (currentDoc) {
        // New versioned legal doc system
        const res = await apiFetch('/api/legal/accept', {
          method: 'POST',
          body: JSON.stringify({ documentId: currentDoc.id }),
        });
        if (res?.ok) {
          if (currentIdx < totalDocs - 1) {
            // More docs to review
            setCurrentIdx(currentIdx + 1);
            setAccepting(false);
            return;
          } else {
            onAccept();
          }
        }
      } else {
        // Legacy disclaimer fallback
        const res = await apiFetch('/api/auth/me/disclaimer', { method: 'PUT' });
        if (res?.ok) onAccept();
      }
    } catch (err) {
      console.error('Legal accept error:', err);
    }
    setAccepting(false);
  };

  const docTypeLabels = {
    terms: 'Terms of Service',
    privacy: 'Privacy Policy',
    liability: 'Liability Disclaimer',
    disclaimer: 'Platform Disclaimer',
  };

  const docTypeIcons = {
    terms: '📜',
    privacy: '🔒',
    liability: '⚖️',
    disclaimer: '📋',
  };

  // Copy the raw document text (with title + version header) so users can
  // paste it into their own AI and get an independent read. Trust feature.
  const copyForAI = async () => {
    try {
      if (!currentDoc?.content) return;
      const header = `InPlace Care — ${currentDoc.title || currentDoc.doc_type} (version ${currentDoc.version}). Copied from the InPlace app for independent review. Suggested prompt: "Please review this document and point out anything unusual, one-sided, or worth asking about before agreeing."\n\n---\n\n`;
      const full = header + currentDoc.content;
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(full);
      } else {
        const ta = document.createElement('textarea');
        ta.value = full; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.focus(); ta.select();
        document.execCommand('copy'); ta.remove();
      }
      setCopiedAI(true);
      setTimeout(() => setCopiedAI(false), 4000);
    } catch (e) { /* clipboard unavailable — non-critical, do nothing */ }
  };

  const title = currentDoc ? (currentDoc.title || docTypeLabels[currentDoc.doc_type] || 'Legal Document') : 'Important Notice';
  const icon = currentDoc ? (docTypeIcons[currentDoc.doc_type] || '📄') : '📋';
  const isUpdate = currentDoc?.previous_version != null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10000,
      background: 'var(--bg-primary)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px', background: 'var(--bg-surface)',
        borderBottom: '1px solid #e0e0e0', flexShrink: 0,
      }}>
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{icon}</span> {title}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                {isUpdate ? 'Updated — please review the changes and agree to continue' : 'Please read and scroll to the bottom to continue'}
              </div>
            </div>
            {totalDocs > 1 && (
              <div style={{
                padding: '4px 12px', borderRadius: 20, background: 'var(--role-color)', color: 'var(--text-on-primary)',
                fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
              }}>
                {currentIdx + 1} / {totalDocs}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div
        ref={contentRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}
      >
        <div style={{
          maxWidth: '600px', margin: '0 auto', padding: '20px',
          fontSize: 14, lineHeight: 1.7, color: 'var(--text-primary)',
        }}>
          {/* Change summary banner (for updates only) */}
          {isUpdate && currentDoc.change_summary && (
            <div style={{
              background: '#e3f2fd', border: '2px solid #1565c0', borderRadius: 12,
              padding: '14px 18px', marginBottom: 18,
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1565c0', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>🤖</span> What Changed (v{currentDoc.previous_version} → v{currentDoc.version})
              </div>
              <div style={{ fontSize: 13, color: '#0d47a1', lineHeight: 1.6 }}>
                {currentDoc.change_summary}
              </div>
            </div>
          )}

          {/* Copy-for-AI review button (trust feature) */}
          {currentDoc?.content && (
            <div style={{ textAlign: 'right', marginBottom: 10 }}>
              <button onClick={copyForAI} style={{
                background: 'none', border: '1px solid var(--border-light)', borderRadius: 8,
                padding: '6px 12px', fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer',
              }}>
                {copiedAI ? '✓ Copied — paste it into your AI' : '🤖 Copy for AI review'}
              </button>
            </div>
          )}

          {/* Document content */}
          {currentDoc ? (
            <div dangerouslySetInnerHTML={{ __html: formatLegalContent(currentDoc.content) }} />
          ) : (
            // Legacy disclaimer content
            <>
              <p style={{ margin: '0 0 16px' }}>
                Welcome to InPlace. Before you begin using our platform, please carefully read and acknowledge the following important disclosures.
              </p>
              <div style={{
                background: 'var(--color-warning-bg)', border: '2px solid #E65100', borderRadius: 10,
                padding: '16px 18px', marginBottom: 16,
              }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: '#BF360C' }}>
                  InPlace does not provide at-home medical care in accordance with Virginia state law.
                </p>
              </div>
              <div style={{
                background: '#FFEBEE', border: '2px solid #C62828', borderRadius: 10,
                padding: '16px 18px', marginBottom: 16,
              }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: '#B71C1C' }}>
                  You are personally liable for any medical care you provide beyond calling professional medical attention when warranted.
                </p>
              </div>
              <p style={{ margin: '0 0 12px' }}>
                InPlace is a care coordination platform that connects families with professional caregivers for non-medical companion care, personal assistance, and daily living support.
              </p>
              <p style={{ margin: '0 0 12px' }}>
                InPlace caregivers are independent contractors, not medical professionals. They are not licensed, certified, or authorized to provide medical diagnosis, treatment, nursing care, or any form of medical intervention.
              </p>
              <p style={{ margin: '0 0 12px' }}>
                If a medical emergency occurs, caregivers and family members should immediately call 911 or the appropriate emergency services.
              </p>
              <p style={{ margin: '0 0 12px' }}>
                By using InPlace, you acknowledge that you understand these limitations and agree to use the platform solely for non-medical care coordination purposes.
              </p>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                Disclaimer version 1.0 — Last updated February 2026
              </p>
            </>
          )}

          {/* Version info */}
          {currentDoc && (
            <p style={{ margin: '20px 0 0', fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              {docTypeLabels[currentDoc.doc_type] || currentDoc.doc_type} v{currentDoc.version}
            </p>
          )}
        </div>
      </div>

      {/* Footer with checkbox + button */}
      <div style={{
        padding: '14px 20px', background: 'var(--bg-surface)',
        borderTop: '1px solid #e0e0e0', flexShrink: 0,
        paddingBottom: 'max(14px, env(safe-area-inset-bottom))',
      }}>
        <div style={{ maxWidth: '600px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {!scrolledToBottom && (
            <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              ↓ Scroll down to read the full document ↓
            </div>
          )}
          {scrolledToBottom && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '6px 0' }}>
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                style={{ width: 20, height: 20, accentColor: 'var(--role-color)', flexShrink: 0 }}
              />
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                I have read and agree to the {title.toLowerCase()}{isUpdate ? ' (updated)' : ''}
              </span>
            </label>
          )}
          <button onClick={handleAccept} disabled={!scrolledToBottom || !checked || accepting} style={{
            width: '100%', padding: '14px', background: (scrolledToBottom && checked) ? 'var(--role-color)' : 'var(--border-light)',
            color: 'var(--text-on-primary)', border: 'none', borderRadius: 10, fontSize: 15,
            fontWeight: 600, cursor: (scrolledToBottom && checked) ? 'pointer' : 'not-allowed',
            opacity: accepting ? 0.7 : 1, transition: 'background 0.2s',
          }}>
            {accepting ? 'Processing...' : (currentIdx < totalDocs - 1 ? 'Agree & Continue to Next' : 'I Agree')}
          </button>
        </div>
      </div>
    </div>
  );
};

// Simple HTML formatter for legal content stored as plain text
function formatLegalContent(text) {
  if (!text) return '';
  // If it's already HTML, return as-is
  if (text.trim().startsWith('<')) return text;
  // Convert plain text to simple HTML
  return text.split('\n\n').map(para => {
    const trimmed = para.trim();
    if (!trimmed) return '';
    // Detect headings (all caps or starts with #)
    if (trimmed.startsWith('#')) {
      const level = trimmed.match(/^#+/)[0].length;
      const headText = trimmed.replace(/^#+\s*/, '');
      return `<h${Math.min(level + 1, 4)} style="margin: 16px 0 8px; color: var(--text-primary)">${headText}</h${Math.min(level + 1, 4)}>`;
    }
    if (trimmed === trimmed.toUpperCase() && trimmed.length < 100) {
      return `<h3 style="margin: 16px 0 8px; font-size: 15px; color: var(--text-primary)">${trimmed}</h3>`;
    }
    return `<p style="margin: 0 0 12px">${trimmed}</p>`;
  }).join('');
}
