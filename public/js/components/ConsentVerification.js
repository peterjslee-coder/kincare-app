const ConsentVerification = window.ConsentVerification = ({ recipientId, recipientName, consentStatus: initialStatus, authorizationTier, onStatusChange }) => {
  const [status, setStatus] = useState(initialStatus);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Attestation state
  const [agreed, setAgreed] = useState(false);
  const [signatureName, setSignatureName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [intlPhone, setIntlPhone] = useState(false);

  // Outreach / admin review state
  const [outreach, setOutreach] = useState(null);
  const [attestation, setAttestation] = useState(null);

  // Tier 2 document upload state
  const [documents, setDocuments] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docUploading, setDocUploading] = useState(false);
  const [selectedDocType, setSelectedDocType] = useState('POA');
  const docInputRef = useRef(null);

  // Load consent status on mount
  useEffect(() => {
    loadStatus();
  }, [recipientId]);

  const loadStatus = async () => {
    try {
      const res = await apiFetch(`/api/consent/${recipientId}/status`);
      if (res?.ok) {
        const data = await res.json();
        setStatus(data.consentStatus);
        if (data.recipientEmail) setRecipientEmail(data.recipientEmail);
        if (data.recipientPhone) setRecipientPhone(data.recipientPhone);
        if (data.outreach) setOutreach(data.outreach);
        if (data.attestation) setAttestation(data.attestation);
      }
    } catch (err) {
      console.error('Load consent status error:', err);
    }
  };

  // Load tier2 documents
  useEffect(() => {
    if (authorizationTier === 'tier2') loadDocuments();
  }, [recipientId, authorizationTier]);

  const loadDocuments = async () => {
    setDocsLoading(true);
    try {
      const res = await apiFetch(`/api/consent/${recipientId}/documents`);
      if (res?.ok) {
        const data = await res.json();
        setDocuments(data.documents || []);
      }
    } catch (err) { console.error('Load documents error:', err); }
    setDocsLoading(false);
  };

  const handleDocUpload = async (file) => {
    if (!file) return;
    setDocUploading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('document', file);
      formData.append('document_type', selectedDocType);
      const token = window.AUTH_TOKEN;
      const _csrf = typeof getCsrfToken === 'function' ? getCsrfToken() : (window.getCsrfToken ? window.getCsrfToken() : null);
      const _csrfH = _csrf ? { 'X-CSRF-Token': _csrf } : {};
      const res = await fetch(`/api/consent/${recipientId}/documents`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Authorization': `Bearer ${token}`, ..._csrfH },
        body: formData,
      });
      if (res.ok) {
        setSuccess('Document uploaded successfully.');
        setTimeout(() => setSuccess(''), 3000);
        loadDocuments();
        if (onStatusChange) onStatusChange();
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error || 'Upload failed');
      }
    } catch (err) {
      console.error('Doc upload error:', err);
      setError('Upload failed');
    }
    setDocUploading(false);
    if (docInputRef.current) docInputRef.current.value = '';
  };

  const handleDeleteDoc = async (docId) => {
    if (!window.confirm('Delete this document?')) return;
    try {
      const res = await apiFetch(`/api/consent/${recipientId}/documents/${docId}`, { method: 'DELETE' });
      if (res?.ok) {
        setSuccess('Document deleted.');
        setTimeout(() => setSuccess(''), 3000);
        loadDocuments();
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error || 'Delete failed');
      }
    } catch (err) { setError('Delete failed'); }
  };

  const handleAttest = async () => {
    if (!agreed || !signatureName.trim() || !relationship) return;
    if (!recipientEmail.trim()) {
      setError('Please provide an email address for ' + firstName + '. We\'ll send a verification notification to that address.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch(`/api/consent/${recipientId}/attest`, {
        method: 'POST',
        body: JSON.stringify({
          signatureName: signatureName.trim(),
          relationshipToRecipient: relationship,
          recipientEmail: recipientEmail.trim() || undefined,
          recipientPhone: recipientPhone.trim() || undefined,
        }),
      });
      if (res?.ok) {
        const data = await res.json();
        setStatus('attested');
        setAttestation(data.attestation);
        setSuccess('Attestation signed successfully.');
        setTimeout(() => setSuccess(''), 3000);
        if (onStatusChange) onStatusChange();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to submit attestation');
      }
    } catch (err) {
      setError('Failed to submit attestation');
    }
    setLoading(false);
  };

  const handleSendOutreach = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch(`/api/consent/${recipientId}/send-outreach`, { method: 'POST' });
      if (res?.ok) {
        const data = await res.json();
        setOutreach(data.outreach);
        setSuccess(data.message);
        setTimeout(() => setSuccess(''), 5000);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to send verification email');
      }
    } catch (err) {
      setError('Failed to send verification email');
    }
    setLoading(false);
  };

  const firstName = recipientName ? recipientName.split(' ')[0] : 'your loved one';

  const attestationText = `I confirm that ${recipientName} is aware that I am arranging non-medical companion care services through inPlace on their behalf. I understand that ${recipientName} will be contacted directly by inPlace to verify their awareness and consent before any caregiver visit is scheduled. I understand that misrepresenting this consent may result in immediate account termination, referral to appropriate authorities, and potential legal liability under Virginia law.`;

  // ─── Verified state ───
  if (status === 'verified') {
    return (
      <div style={{ background: '#e8f5e9', border: '1px solid #c8e6c9', borderRadius: '12px', padding: '20px', marginTop: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '24px' }}>{'\u2705'}</span>
          <div>
            <div style={{ fontWeight: 600, color: '#2e7d32', fontSize: '15px' }}>Verified</div>
            <div style={{ color: '#558b2f', fontSize: '13px' }}>{recipientName}'s care authorization is complete. You can now book care sessions.</div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Rejected state ───
  if (status === 'rejected' && authorizationTier === 'tier3') {
    return (
      <div style={{ background: '#fce4ec', border: '1px solid #ef9a9a', borderRadius: '12px', padding: '20px', marginTop: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
          <span style={{ fontSize: '24px' }}>{'\u274C'}</span>
          <div>
            <div style={{ fontWeight: 600, color: '#c62828', fontSize: '15px' }}>Authorization Not Approved</div>
            <div style={{ color: '#666', fontSize: '13px' }}>
              {attestation?.adminNotes || 'Your attestation was reviewed and not approved. Please contact support or try a different authorization method.'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Tier 2: Document upload state ───
  if (authorizationTier === 'tier2' && (status === 'pending' || status === 'rejected')) {
    const rejectedDocs = documents.filter(d => d.upload_status === 'rejected');
    const uploadedDocs = documents.filter(d => d.upload_status === 'uploaded');
    const hasUploaded = uploadedDocs.length > 0;

    return (
      React.createElement('div', { style: { background: '#fff', border: '2px solid #5c6bc0', borderRadius: '12px', padding: '24px', marginTop: '16px' } },
        React.createElement('h3', { style: { color: '#5c6bc0', margin: '0 0 8px 0', fontSize: '17px' } }, '\u{1F4C4} Upload Authorization Document'),
        React.createElement('p', { style: { color: '#666', fontSize: '13px', margin: '0 0 20px 0' } },
          'Upload your Power of Attorney, guardianship order, or other legal document to verify your authorization to arrange care for ', firstName, '.'
        ),

        error && React.createElement('div', { style: { background: '#fce4ec', color: '#c62828', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px' } }, error),
        success && React.createElement('div', { style: { background: '#e8f5e9', color: '#2e7d32', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px' } }, success),

        rejectedDocs.length > 0 && React.createElement('div', { style: { background: '#fce4ec', border: '1px solid #ef9a9a', borderRadius: '8px', padding: '14px', marginBottom: '16px', fontSize: '13px' } },
          React.createElement('div', { style: { fontWeight: 600, color: '#c62828', marginBottom: '4px' } }, '\u274C Document rejected'),
          React.createElement('div', { style: { color: '#666' } }, rejectedDocs[0].admin_notes || 'Please upload a valid document.'),
        ),

        React.createElement('div', { style: { marginBottom: '16px' } },
          React.createElement('label', { style: { display: 'block', fontSize: '13px', fontWeight: 600, color: '#333', marginBottom: '6px' } }, 'Document type'),
          React.createElement('select', {
            value: selectedDocType,
            onChange: function(e) { setSelectedDocType(e.target.value); },
            disabled: docUploading,
            style: { width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px' },
          },
            React.createElement('option', { value: 'POA' }, 'Power of Attorney'),
            React.createElement('option', { value: 'Legal_Guardianship' }, 'Legal Guardianship'),
            React.createElement('option', { value: 'Court_Order' }, 'Court Order'),
            React.createElement('option', { value: 'Other' }, 'Other')
          )
        ),

        React.createElement('div', { style: { marginBottom: '20px' } },
          React.createElement('button', {
            onClick: function() { docInputRef.current && docInputRef.current.click(); },
            disabled: docUploading,
            style: {
              padding: '12px 24px', borderRadius: '8px', border: 'none', fontWeight: 600, fontSize: '14px', cursor: docUploading ? 'not-allowed' : 'pointer',
              background: docUploading ? '#ccc' : '#5c6bc0', color: '#fff',
            },
          }, docUploading ? 'Uploading...' : '\u{1F4CE} Choose File (PDF or image, max 5MB)'),
          React.createElement('input', {
            ref: docInputRef,
            type: 'file',
            accept: '.pdf,image/jpeg,image/png,image/gif,image/webp',
            onChange: function(e) { handleDocUpload(e.target.files && e.target.files[0]); },
            style: { display: 'none' },
          })
        ),

        documents.length > 0 && React.createElement('div', { style: { borderTop: '1px solid #e0e0e0', paddingTop: '16px' } },
          React.createElement('div', { style: { fontSize: '13px', fontWeight: 600, color: '#333', marginBottom: '10px' } }, 'Submitted Documents'),
          documents.map(function(doc) {
            var statusColor = doc.upload_status === 'uploaded' ? '#e8724a' : doc.upload_status === 'approved' ? '#1b6b5a' : '#c62828';
            var statusLabel = doc.upload_status === 'uploaded' ? '\u23F3 Under review' : doc.upload_status === 'approved' ? '\u2705 Approved' : '\u274C Rejected';
            return React.createElement('div', { key: doc.id, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: '#f9f9f9', borderRadius: '8px', marginBottom: '8px' } },
              React.createElement('div', null,
                React.createElement('div', { style: { fontWeight: 600, fontSize: '13px' } }, (doc.document_type || '').replace(/_/g, ' ')),
                React.createElement('div', { style: { fontSize: '12px', color: '#888' } }, doc.file_name, ' \u2022 ', ((doc.file_size || 0) / 1024).toFixed(1), ' KB'),
                React.createElement('div', { style: { fontSize: '12px', color: statusColor, fontWeight: 600, marginTop: '2px' } }, statusLabel)
              ),
              doc.upload_status !== 'approved' && React.createElement('button', {
                onClick: function() { handleDeleteDoc(doc.id); },
                style: { padding: '4px 10px', borderRadius: '4px', border: '1px solid #ef9a9a', background: '#fff', color: '#c62828', fontSize: '11px', cursor: 'pointer' },
              }, 'Delete')
            );
          })
        ),

        hasUploaded && React.createElement('div', { style: { marginTop: '12px', fontSize: '13px', color: '#666', fontStyle: 'italic' } },
          'Your document has been submitted for review. You\u2019ll be notified when it\u2019s approved.'
        )
      )
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Tier 3: New 3-step flow — Attestation → Outreach → Admin Review
  // ═══════════════════════════════════════════════════════════════════════

  // ─── Step 1: Attestation form (status === 'pending') ───
  if (status === 'pending') {
    return (
      <div style={{ background: '#fff', border: '2px solid #e8724a', borderRadius: '12px', padding: '24px', marginTop: '16px' }}>
        <h3 style={{ color: '#e8724a', margin: '0 0 4px 0', fontSize: '17px' }}>Verify Care Authorization</h3>
        <p style={{ color: '#666', fontSize: '13px', margin: '0 0 20px 0' }}>
          Before booking care for {firstName}, we need to confirm they're aware of this arrangement. This helps keep everyone safe.
        </p>

        {error && <div style={{ background: '#fce4ec', color: '#c62828', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px' }}>{error}</div>}
        {success && <div style={{ background: '#e8f5e9', color: '#2e7d32', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px' }}>{success}</div>}

        {/* Attestation statement */}
        <div style={{ background: '#FFF8E1', border: '1px solid #FFE082', borderRadius: '8px', padding: '16px', marginBottom: '20px', fontSize: '13px', lineHeight: '1.6', color: '#5D4037' }}>
          <div style={{ fontWeight: 600, marginBottom: '8px', color: '#E65100' }}>Attestation Statement</div>
          {attestationText}
        </div>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', marginBottom: '20px' }}>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)}
            style={{ marginTop: '3px', width: '18px', height: '18px', accentColor: '#1b6b5a' }} />
          <span style={{ fontSize: '14px', color: '#333' }}>I have read and agree to the above statement</span>
        </label>

        {/* Relationship */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#333', marginBottom: '6px' }}>Your relationship to {firstName}</label>
          <select value={relationship} onChange={(e) => setRelationship(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px' }}>
            <option value="">Select...</option>
            <option value="Son">Son</option>
            <option value="Daughter">Daughter</option>
            <option value="Spouse">Spouse</option>
            <option value="Sibling">Sibling</option>
            <option value="Grandchild">Grandchild</option>
            <option value="Niece/Nephew">Niece/Nephew</option>
            <option value="Friend">Friend</option>
            <option value="Other">Other</option>
          </select>
        </div>

        {/* Signature */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#333', marginBottom: '6px' }}>Type your full name as signature</label>
          <input type="text" value={signatureName} onChange={(e) => setSignatureName(e.target.value)}
            placeholder="Your full legal name"
            style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px', fontStyle: 'italic', boxSizing: 'border-box' }} />
        </div>

        {/* Care recipient contact info */}
        <div style={{ background: '#f0f7ff', border: '1px solid #bbdefb', borderRadius: '8px', padding: '16px', marginBottom: '20px' }}>
          <div style={{ fontWeight: 600, fontSize: '14px', color: '#1565c0', marginBottom: '8px' }}>
            📧 How we'll reach {firstName}
          </div>
          <p style={{ fontSize: '13px', color: '#666', margin: '0 0 12px 0' }}>
            We'll send {firstName} an email explaining that you've arranged care for them through InPlace.
            They'll have a chance to confirm, ask questions, or flag any concerns. An email address is required to send this notification.
          </p>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#333', marginBottom: '4px' }}>
              {firstName}'s email address <span style={{ color: '#c62828', fontWeight: 700 }}>*</span>
            </label>
            <input type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="e.g. mom@email.com"
              style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px', boxSizing: 'border-box' }} />
          </div>

          <div>
            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', fontWeight: 600, color: '#333', marginBottom: '4px' }}>
              <span>{firstName}'s phone number <span style={{ fontWeight: 400, color: '#999' }}>(optional — for emergency contact only)</span></span>
              <button type="button" onClick={() => { setIntlPhone(!intlPhone); setRecipientPhone(''); }} style={{ background: 'none', border: 'none', color: '#1b6b5a', fontSize: 11, cursor: 'pointer', fontWeight: 600, padding: 0 }}>
                {intlPhone ? 'US number' : 'International'}
              </button>
            </label>
            <input type="tel" value={recipientPhone} onChange={(e) => setRecipientPhone(formatPhone(e.target.value, intlPhone))}
              placeholder={intlPhone ? '+44 20 7946 0958' : '(555) 123-4567'}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px', boxSizing: 'border-box' }} />
            {intlPhone && <div style={{ fontSize: 11, color: '#e8724a', marginTop: 4, lineHeight: 1.4 }}>{INTL_PHONE_DISCLAIMER}</div>}
          </div>
        </div>

        {!recipientEmail.trim() && (agreed && signatureName.trim() && relationship) && (
          <div style={{ fontSize: '12px', color: '#c62828', marginBottom: '8px' }}>An email address is required to send the verification notification.</div>
        )}
        <button onClick={handleAttest} disabled={loading || !agreed || !signatureName.trim() || !relationship || !recipientEmail.trim()}
          style={{
            padding: '12px 24px', borderRadius: '8px', border: 'none', fontWeight: 600, fontSize: '14px', cursor: 'pointer',
            background: (agreed && signatureName.trim() && relationship && recipientEmail.trim()) ? '#1b6b5a' : '#ccc',
            color: '#fff', transition: 'background 0.2s',
          }}>
          {loading ? 'Submitting...' : 'Sign & Continue \u2192'}
        </button>
      </div>
    );
  }

  // ─── Step 2 & 3: Attested — show outreach + admin review status ───
  if (status === 'attested') {
    const outreachSent = outreach && outreach.sentToEmail;
    const recipientResponded = outreach && outreach.recipientResponse;
    const isExpired = outreach && outreach.isExpired;
    const adminStatus = attestation?.adminStatus || 'pending';

    // Response labels
    const responseLabels = {
      yes_aware: { text: "Yes, I'm aware", color: '#2e7d32', icon: '\u2705' },
      have_questions: { text: "I have questions", color: '#e8724a', icon: '\u2753' },
      did_not_authorize: { text: "I did not authorize this", color: '#c62828', icon: '\u{1F6A8}' },
    };

    return (
      <div style={{ background: '#fff', border: '2px solid #1b6b5a', borderRadius: '12px', padding: '24px', marginTop: '16px' }}>
        {/* Step indicators */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '20px' }}>
          {['Attestation', 'Outreach', 'Review'].map((step, i) => {
            const isComplete = i === 0 || (i === 1 && outreachSent) || (i === 2 && adminStatus === 'approved');
            const isActive = (i === 1 && !outreachSent) || (i === 2 && outreachSent && adminStatus === 'pending');
            return (
              <div key={step} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{
                  height: '4px', borderRadius: '2px', marginBottom: '6px',
                  background: isComplete ? '#1b6b5a' : isActive ? '#e8724a' : '#e0e0e0',
                }} />
                <span style={{ fontSize: '11px', fontWeight: 600, color: isComplete ? '#1b6b5a' : isActive ? '#e8724a' : '#999' }}>{step}</span>
              </div>
            );
          })}
        </div>

        {error && <div style={{ background: '#fce4ec', color: '#c62828', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px' }}>{error}</div>}
        {success && <div style={{ background: '#e8f5e9', color: '#2e7d32', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px' }}>{success}</div>}

        {/* Attestation confirmed */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
          <span style={{ fontSize: '18px' }}>{'\u2705'}</span>
          <span style={{ fontWeight: 600, color: '#1b6b5a', fontSize: '14px' }}>Attestation signed by {attestation?.signatureName || signatureName}</span>
        </div>

        {/* Not yet sent outreach */}
        {!outreachSent && (
          <div style={{ background: '#FFF8E1', border: '1px solid #FFE082', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
            <div style={{ fontWeight: 600, fontSize: '14px', color: '#E65100', marginBottom: '8px' }}>
              Next: Send verification to {firstName}
            </div>
            <p style={{ fontSize: '13px', color: '#666', margin: '0 0 12px 0' }}>
              We'll email {firstName}{recipientEmail ? ` at ${recipientEmail}` : ''} to let them know about this care arrangement.
              They can confirm their awareness, ask questions, or let us know if something isn't right.
            </p>
            <button onClick={handleSendOutreach} disabled={loading}
              style={{
                padding: '12px 24px', borderRadius: '8px', border: 'none', fontWeight: 600, fontSize: '14px', cursor: loading ? 'not-allowed' : 'pointer',
                background: loading ? '#ccc' : '#e8724a', color: '#fff',
              }}>
              {loading ? 'Sending...' : '\u{1F4E7} Send Verification Email'}
            </button>
          </div>
        )}

        {/* Outreach sent */}
        {outreachSent && (
          <div style={{ background: '#f0f7ff', border: '1px solid #bbdefb', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <span style={{ fontSize: '16px' }}>{'\u{1F4E7}'}</span>
              <span style={{ fontWeight: 600, fontSize: '14px', color: '#1565c0' }}>Verification email sent</span>
            </div>
            <p style={{ fontSize: '13px', color: '#666', margin: '0 0 8px 0' }}>
              Sent to <strong>{outreach.sentToEmail}</strong>
              {outreach.expiresAt && <span> — expires {new Date(outreach.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
            </p>

            {/* Recipient response */}
            {recipientResponded ? (
              <div style={{
                background: responseLabels[outreach.recipientResponse]?.color === '#c62828' ? '#fce4ec' : '#e8f5e9',
                borderRadius: '8px', padding: '12px', marginTop: '8px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', fontWeight: 600 }}>
                  <span>{responseLabels[outreach.recipientResponse]?.icon || ''}</span>
                  <span style={{ color: responseLabels[outreach.recipientResponse]?.color }}>
                    {firstName} responded: {responseLabels[outreach.recipientResponse]?.text || outreach.recipientResponse}
                  </span>
                </div>
                {outreach.recipientResponseNotes && (
                  <div style={{ fontSize: '13px', color: '#666', marginTop: '6px', fontStyle: 'italic' }}>
                    "{outreach.recipientResponseNotes}"
                  </div>
                )}
              </div>
            ) : isExpired ? (
              <div style={{ marginTop: '8px' }}>
                <div style={{ fontSize: '13px', color: '#e8724a', marginBottom: '8px' }}>
                  The verification link has expired. You can send a new one.
                </div>
                <button onClick={handleSendOutreach} disabled={loading}
                  style={{
                    padding: '8px 16px', borderRadius: '6px', border: 'none', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
                    background: '#e8724a', color: '#fff',
                  }}>
                  {loading ? 'Sending...' : 'Resend Verification'}
                </button>
              </div>
            ) : (
              <div style={{ fontSize: '13px', color: '#999', marginTop: '4px', fontStyle: 'italic' }}>
                Waiting for {firstName} to respond...
              </div>
            )}
          </div>
        )}

        {/* Admin review status */}
        <div style={{
          background: adminStatus === 'approved' ? '#e8f5e9' : '#f5f5f5',
          border: '1px solid ' + (adminStatus === 'approved' ? '#c8e6c9' : '#e0e0e0'),
          borderRadius: '8px', padding: '16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px' }}>
              {adminStatus === 'approved' ? '\u2705' : adminStatus === 'rejected' ? '\u274C' : '\u23F3'}
            </span>
            <div>
              <div style={{ fontWeight: 600, fontSize: '14px', color: adminStatus === 'approved' ? '#2e7d32' : adminStatus === 'rejected' ? '#c62828' : '#666' }}>
                {adminStatus === 'approved' ? 'Admin Approved' : adminStatus === 'rejected' ? 'Admin Review: Not Approved' : 'Awaiting Admin Review'}
              </div>
              <div style={{ fontSize: '13px', color: '#888', marginTop: '2px' }}>
                {adminStatus === 'pending'
                  ? 'Our team will review your attestation and ' + firstName + '\'s response. You\'ll be notified when the review is complete.'
                  : adminStatus === 'rejected'
                    ? (attestation?.adminNotes || 'Please contact support for more information.')
                    : 'Authorization has been verified.'}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
};
