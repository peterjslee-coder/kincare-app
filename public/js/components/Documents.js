const Documents = window.Documents = ({ onNavigate }) => {
  // Tabs: 'documents', 'consent', 'audit'
  const [activeTab, setActiveTab] = useState('documents');

  // Documents Tab State
  const [documents, setDocuments] = useState([]);
  const [careRecipients, setCareRecipients] = useState([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [selectedRecipientFilter, setSelectedRecipientFilter] = useState('all');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('all');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState('all');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewDocument, setPreviewDocument] = useState(null);
  const [previewFileUrl, setPreviewFileUrl] = useState(null);

  // Upload Modal State
  const [uploadRecipientId, setUploadRecipientId] = useState('');
  const [uploadCategory, setUploadCategory] = useState('consent');
  const [uploadDocType, setUploadDocType] = useState('POA');
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadResult, setUploadResult] = useState(null);

  // Consent Tab State
  const [consentData, setConsentData] = useState({});
  const [consentLoading, setConsentLoading] = useState(false);
  const [auditTrails, setAuditTrails] = useState({});
  const [participationSaving, setParticipationSaving] = useState(null); // recipientId being saved
  const [participationConfirm, setParticipationConfirm] = useState(null); // { recipientId, newTier, recipientName }

  // Audit Tab State
  const [auditEntries, setAuditEntries] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditRecipientFilter, setAuditRecipientFilter] = useState('all');
  const [auditEventFilter, setAuditEventFilter] = useState('all');
  const [expandedAuditId, setExpandedAuditId] = useState(null);

  // Document category types mapping
  const docTypesByCategory = {
    consent: ['POA', 'Healthcare_POA', 'Court_Order', 'Living_Will', 'Other_Legal'],
    identity: ['DL_Front', 'DL_Back', 'Passport', 'State_ID'],
    certification: ['CNA', 'HHA', 'LPN', 'RN', 'CPR', 'BLS', 'ACLS', 'First_Aid', 'Other_Cert'],
    insurance: ['Liability_Insurance', 'Auto_Insurance', 'Health_Insurance'],
    legal: ['POA', 'Healthcare_POA', 'Court_Order', 'Living_Will', 'Other_Legal'],
  };

  const categoryIcons = {
    consent: '📋',
    identity: '🪪',
    certification: '🏥',
    insurance: '🛡️',
    legal: '⚖️',
  };

  const statusColors = {
    pending: '#e8724a',
    ai_review: '#4299e1',
    ai_flagged: '#f56565',
    approved: '#48bb78',
    rejected: '#f56565',
    expired: '#a0aec0',
  };

  const statusLabels = {
    pending: 'Pending',
    ai_review: 'AI Review',
    ai_flagged: 'AI Flagged',
    approved: 'Approved',
    rejected: 'Rejected',
    expired: 'Expired',
  };

  const auditEventIcons = {
    document_uploaded: '📄',
    document_classified: '🤖',
    document_approved: '✅',
    document_rejected: '❌',
    attestation_submitted: '✍️',
    code_verified: '🔑',
    consent_granted: '🟢',
    consent_revoked: '🔴',
    managed_mode_activated: '🔒',
    participation_level_changed: '📊',
  };

  const roleColors = {
    family: '#1b6b5a',
    admin: '#9f7aea',
    ai: '#4299e1',
    system: '#718096',
    caregiver: '#e8724a',
  };

  // Load care recipients on mount
  useEffect(() => {
    const loadCareRecipients = async () => {
      try {
        const response = await apiFetch('/api/care-recipients');
        if (response.careRecipients) {
          setCareRecipients(response.careRecipients);
          if (response.careRecipients.length > 0) {
            setUploadRecipientId(response.careRecipients[0].id);
          }
        }
      } catch (error) {
        console.error('Failed to load care recipients:', error);
      }
    };
    loadCareRecipients();
  }, []);

  // Load documents when tab changes or filters change
  useEffect(() => {
    if (activeTab === 'documents') {
      loadDocuments();
    }
  }, [activeTab, selectedRecipientFilter, selectedCategoryFilter, selectedStatusFilter]);

  // Load consent data when consent tab is active
  useEffect(() => {
    if (activeTab === 'consent') {
      loadConsentData();
    }
  }, [activeTab]);

  // Load audit trail when audit tab is active
  useEffect(() => {
    if (activeTab === 'audit') {
      loadAuditTrail();
    }
  }, [activeTab, auditRecipientFilter, auditEventFilter]);

  const loadDocuments = async () => {
    setDocumentsLoading(true);
    try {
      let docs = [];

      // If filtering by specific recipient, fetch for that recipient
      if (selectedRecipientFilter !== 'all') {
        const response = await apiFetch(`/api/documents/owner/care_recipient/${selectedRecipientFilter}`);
        if (response.documents) {
          docs = response.documents;
        }
      } else {
        // Fetch documents for all care recipients
        for (const recipient of careRecipients) {
          try {
            const response = await apiFetch(`/api/documents/owner/care_recipient/${recipient.id}`);
            if (response.documents) {
              docs = [...docs, ...response.documents];
            }
          } catch (error) {
            console.error(`Failed to load documents for ${recipient.id}:`, error);
          }
        }
      }

      // Apply filters
      let filtered = docs;
      if (selectedCategoryFilter !== 'all') {
        filtered = filtered.filter(doc => doc.category === selectedCategoryFilter);
      }
      if (selectedStatusFilter !== 'all') {
        filtered = filtered.filter(doc => doc.status === selectedStatusFilter);
      }

      setDocuments(filtered);
    } catch (error) {
      console.error('Failed to load documents:', error);
    } finally {
      setDocumentsLoading(false);
    }
  };

  const loadConsentData = async () => {
    setConsentLoading(true);
    try {
      const data = {};
      const trails = {};

      for (const recipient of careRecipients) {
        try {
          const response = await apiFetch(`/api/documents/audit/${recipient.id}`);
          if (response.consentStatus) {
            data[recipient.id] = response.consentStatus;
          }
          if (response.auditTrail) {
            trails[recipient.id] = response.auditTrail;
          }
        } catch (error) {
          console.error(`Failed to load consent data for ${recipient.id}:`, error);
        }
      }

      setConsentData(data);
      setAuditTrails(trails);
    } catch (error) {
      console.error('Failed to load consent data:', error);
    } finally {
      setConsentLoading(false);
    }
  };

  const loadAuditTrail = async () => {
    setAuditLoading(true);
    try {
      let entries = [];

      if (auditRecipientFilter !== 'all') {
        const response = await apiFetch(`/api/documents/audit/${auditRecipientFilter}`);
        if (response.auditTrail) {
          entries = response.auditTrail;
        }
      } else {
        // Load for all recipients
        for (const recipient of careRecipients) {
          try {
            const response = await apiFetch(`/api/documents/audit/${recipient.id}`);
            if (response.auditTrail) {
              entries = [...entries, ...response.auditTrail];
            }
          } catch (error) {
            console.error(`Failed to load audit for ${recipient.id}:`, error);
          }
        }
      }

      // Sort by date (newest first)
      entries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      // Apply event filter
      if (auditEventFilter !== 'all') {
        entries = entries.filter(entry => entry.event_type === auditEventFilter);
      }

      setAuditEntries(entries);
    } catch (error) {
      console.error('Failed to load audit trail:', error);
    } finally {
      setAuditLoading(false);
    }
  };

  // Handle participation level change
  const handleParticipationChange = async (recipientId, newTier) => {
    setParticipationSaving(recipientId);
    try {
      const res = await apiFetch(`/api/care-recipients/${recipientId}/permissions`, {
        method: 'PUT',
        body: JSON.stringify({ permissionTier: newTier }),
      });
      if (res?.ok) {
        // Refresh consent data to reflect change
        await loadConsentData();
        setParticipationConfirm(null);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Failed to update participation level');
      }
    } catch (error) {
      console.error('Participation change error:', error);
      alert('Failed to update participation level');
    } finally {
      setParticipationSaving(null);
    }
  };

  const handleUploadChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      const validTypes = ['application/pdf', 'image/jpeg', 'image/png'];
      if (!validTypes.includes(file.type)) {
        setUploadError('Please upload a PDF or image file (JPEG/PNG)');
        return;
      }
      if (file.size > 5242880) { // 5MB
        setUploadError('File must be smaller than 5MB');
        return;
      }
      setUploadError('');
      setUploadFile(file);
    }
  };

  const handleUploadSubmit = async (e) => {
    e.preventDefault();
    if (!uploadRecipientId || !uploadFile) {
      setUploadError('Please select a care recipient and file');
      return;
    }

    setUploadLoading(true);
    setUploadError('');

    try {
      const formData = new FormData();
      formData.append('document', uploadFile);
      formData.append('category', uploadCategory);
      formData.append('document_type', uploadDocType);
      formData.append('owner_type', 'care_recipient');
      formData.append('owner_id', uploadRecipientId);

      const response = await fetch('/api/documents/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Upload failed');
      }

      const result = await response.json();
      setUploadResult(result);

      // Reset form
      setUploadFile(null);
      setUploadCategory('consent');
      setUploadDocType('POA');
      setUploadError('');

      // Close modal after 2 seconds
      setTimeout(() => {
        setShowUploadModal(false);
        setUploadResult(null);
        loadDocuments();
      }, 2000);
    } catch (error) {
      setUploadError(error.message || 'Upload failed');
    } finally {
      setUploadLoading(false);
    }
  };

  const handlePreview = async (document) => {
    setPreviewDocument(document);
    try {
      const response = await fetch(`/api/documents/${document.id}/download`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
        },
      });
      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        setPreviewFileUrl(url);
      }
    } catch (error) {
      console.error('Failed to load preview:', error);
    }
    setShowPreviewModal(true);
  };

  const handleDelete = async (docId) => {
    if (!confirm('Are you sure you want to delete this document?')) {
      return;
    }

    try {
      await apiFetch(`/api/documents/${docId}`, {
        method: 'DELETE',
      });
      loadDocuments();
    } catch (error) {
      alert('Failed to delete document: ' + error.message);
    }
  };

  const handleDownload = async (document) => {
    try {
      const response = await fetch(`/api/documents/${document.id}/download`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
        },
      });
      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = document.filename || `document_${document.id}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      alert('Failed to download document: ' + error.message);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const formatDateTime = (dateStr) => {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const humanizeDocType = (type) => {
    return type.replace(/_/g, ' ');
  };

  const getRecipientName = (recipientId) => {
    const recipient = careRecipients.find(r => r.id === recipientId);
    return recipient ? recipient.name : 'Unknown';
  };

  // DOCUMENTS TAB
  const DocumentsTab = () => (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '600' }}>Documents</h2>
        <button
          onClick={() => {
            setShowUploadModal(true);
            setUploadError('');
            setUploadResult(null);
          }}
          style={{
            padding: '8px 16px',
            backgroundColor: '#1b6b5a',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '500',
          }}
        >
          + Upload Document
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <select
          value={selectedRecipientFilter}
          onChange={(e) => setSelectedRecipientFilter(e.target.value)}
          style={{
            padding: '8px 12px',
            border: '1px solid #e2e8f0',
            borderRadius: '6px',
            fontSize: '14px',
            backgroundColor: 'white',
            cursor: 'pointer',
          }}
        >
          <option value="all">All Recipients</option>
          {careRecipients.map(r => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>

        <select
          value={selectedCategoryFilter}
          onChange={(e) => setSelectedCategoryFilter(e.target.value)}
          style={{
            padding: '8px 12px',
            border: '1px solid #e2e8f0',
            borderRadius: '6px',
            fontSize: '14px',
            backgroundColor: 'white',
            cursor: 'pointer',
          }}
        >
          <option value="all">All Categories</option>
          <option value="consent">Consent</option>
          <option value="identity">Identity</option>
          <option value="certification">Certification</option>
          <option value="insurance">Insurance</option>
          <option value="legal">Legal</option>
        </select>

        <select
          value={selectedStatusFilter}
          onChange={(e) => setSelectedStatusFilter(e.target.value)}
          style={{
            padding: '8px 12px',
            border: '1px solid #e2e8f0',
            borderRadius: '6px',
            fontSize: '14px',
            backgroundColor: 'white',
            cursor: 'pointer',
          }}
        >
          <option value="all">All Status</option>
          <option value="pending">Pending</option>
          <option value="ai_review">AI Review</option>
          <option value="ai_flagged">AI Flagged</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="expired">Expired</option>
        </select>
      </div>

      {/* Documents Grid */}
      {documentsLoading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#718096' }}>
          Loading documents...
        </div>
      ) : documents.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#718096' }}>
          No documents found
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: '16px',
        }}>
          {documents.map(doc => (
            <div
              key={doc.id}
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '16px',
                backgroundColor: 'white',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                <div style={{ fontSize: '32px' }}>
                  {categoryIcons[doc.category] || '📄'}
                </div>
                <div
                  style={{
                    backgroundColor: statusColors[doc.status] || '#cbd5e0',
                    color: 'white',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: '500',
                  }}
                >
                  {statusLabels[doc.status] || doc.status}
                </div>
              </div>

              <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: '600' }}>
                {humanizeDocType(doc.document_type)}
              </h3>

              <p style={{ margin: '0 0 4px 0', fontSize: '13px', color: '#4a5568' }}>
                <strong>{getRecipientName(doc.owner_id)}</strong> · {doc.category}
              </p>

              <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: '#718096' }}>
                Uploaded {formatDate(doc.created_at)}
              </p>

              {/* AI Confidence Bar */}
              {doc.ai_classification?.confidence !== undefined && (
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '12px', fontWeight: '500', color: '#4a5568' }}>AI Confidence</span>
                    <span style={{ fontSize: '12px', fontWeight: '600', color: '#1b6b5a' }}>
                      {Math.round(doc.ai_classification.confidence)}%
                    </span>
                  </div>
                  <div style={{
                    width: '100%',
                    height: '6px',
                    backgroundColor: '#e2e8f0',
                    borderRadius: '3px',
                    overflow: 'hidden',
                  }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${doc.ai_classification.confidence}%`,
                        backgroundColor: '#1b6b5a',
                      }}
                    />
                  </div>
                </div>
              )}

              {/* AI Summary */}
              {doc.ai_classification?.summary && (
                <div style={{
                  backgroundColor: '#f7fafc',
                  padding: '8px',
                  borderRadius: '4px',
                  marginBottom: '12px',
                  fontSize: '12px',
                  color: '#4a5568',
                  borderLeft: '3px solid #1b6b5a',
                }}>
                  {doc.ai_classification.summary}
                </div>
              )}

              {/* AI Concerns */}
              {doc.ai_classification?.concerns && doc.ai_classification.concerns.length > 0 && (
                <div style={{
                  backgroundColor: '#fffaf0',
                  border: '1px solid #fbd38d',
                  borderRadius: '4px',
                  padding: '8px',
                  marginBottom: '12px',
                }}>
                  <p style={{ margin: '0 0 4px 0', fontSize: '12px', fontWeight: '600', color: '#e8724a' }}>
                    ⚠️ AI Concerns:
                  </p>
                  <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12px', color: '#c05621' }}>
                    {doc.ai_classification.concerns.map((concern, idx) => (
                      <li key={idx} style={{ marginBottom: '2px' }}>{concern}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => handlePreview(doc)}
                  style={{
                    flex: 1,
                    padding: '8px',
                    backgroundColor: '#f7fafc',
                    border: '1px solid #cbd5e0',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: '500',
                    color: '#1b6b5a',
                  }}
                >
                  View
                </button>
                <button
                  onClick={() => handleDownload(doc)}
                  style={{
                    flex: 1,
                    padding: '8px',
                    backgroundColor: '#f7fafc',
                    border: '1px solid #cbd5e0',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: '500',
                    color: '#1b6b5a',
                  }}
                >
                  Download
                </button>
                {doc.status !== 'approved' && (
                  <button
                    onClick={() => handleDelete(doc.id)}
                    style={{
                      flex: 1,
                      padding: '8px',
                      backgroundColor: '#fff5f5',
                      border: '1px solid #fed7d7',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      fontWeight: '500',
                      color: '#c53030',
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // CONSENT TAB
  const ConsentTab = () => (
    <div style={{ padding: '24px' }}>
      <h2 style={{ margin: '0 0 24px 0', fontSize: '20px', fontWeight: '600' }}>Consent Status</h2>

      {consentLoading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#718096' }}>
          Loading consent data...
        </div>
      ) : careRecipients.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#718096' }}>
          No care recipients found
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
          {careRecipients.map(recipient => {
            const consent = consentData[recipient.id] || {};
            const trail = auditTrails[recipient.id] || [];

            return (
              <div
                key={recipient.id}
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '16px',
                  backgroundColor: 'white',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
                  <div style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '24px',
                    backgroundColor: '#e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '24px',
                    marginRight: '12px',
                  }}>
                    👤
                  </div>
                  <div>
                    <h3 style={{ margin: '0', fontSize: '16px', fontWeight: '600' }}>
                      {recipient.name}
                    </h3>
                    {consent.authorization_tier && (
                      <div style={{
                        fontSize: '12px',
                        color: '#718096',
                        marginTop: '2px',
                      }}>
                        Tier {consent.authorization_tier}
                      </div>
                    )}
                  </div>
                </div>

                {/* Consent Status Details */}
                <div style={{ marginBottom: '16px', paddingBottom: '16px', borderBottom: '1px solid #e2e8f0' }}>
                  {consent.consent_status && (
                    <div style={{ marginBottom: '8px' }}>
                      <span style={{ fontSize: '12px', color: '#718096' }}>Consent Status:</span>
                      <span style={{
                        marginLeft: '8px',
                        fontSize: '13px',
                        fontWeight: '600',
                        color: consent.consent_status === 'granted' ? '#38a169' : '#ed8936',
                      }}>
                        {consent.consent_status === 'granted' ? '✓ Granted' : '⏳ Pending'}
                      </span>
                    </div>
                  )}

                  {consent.consent_method && (
                    <div style={{ marginBottom: '8px' }}>
                      <span style={{ fontSize: '12px', color: '#718096' }}>Method:</span>
                      <span style={{ marginLeft: '8px', fontSize: '13px', fontWeight: '500' }}>
                        {consent.consent_method}
                      </span>
                    </div>
                  )}

                  {consent.consent_verified_at && (
                    <div style={{ marginBottom: '8px' }}>
                      <span style={{ fontSize: '12px', color: '#718096' }}>Verified:</span>
                      <span style={{ marginLeft: '8px', fontSize: '13px', fontWeight: '500' }}>
                        {formatDate(consent.consent_verified_at)}
                      </span>
                    </div>
                  )}

                  {consent.permission_tier && (
                    <div style={{ marginBottom: '0' }}>
                      <span style={{ fontSize: '12px', color: '#718096' }}>Permission Tier:</span>
                      <span style={{ marginLeft: '8px', fontSize: '13px', fontWeight: '500' }}>
                        {consent.permission_tier === 'full' ? 'Full Access' : consent.permission_tier === 'collaborative' ? 'Collaborative' : 'Managed'}
                      </span>
                    </div>
                  )}

                  {consent.managed_by && (
                    <div style={{
                      marginTop: '8px',
                      padding: '8px',
                      backgroundColor: '#edf2f7',
                      borderRadius: '4px',
                      fontSize: '12px',
                    }}>
                      🔒 Managed by <strong>{consent.managed_by}</strong>
                      {consent.managed_reason && <div style={{ marginTop: '4px' }}>Reason: {consent.managed_reason}</div>}
                    </div>
                  )}

                  {/* Participation Level Control — only visible if managed_by is set */}
                  {consent.managed_by_user_id && (
                    <div style={{
                      marginTop: '12px',
                      padding: '10px',
                      backgroundColor: '#f7fafc',
                      borderRadius: '6px',
                      border: '1px solid #e2e8f0',
                    }}>
                      <div style={{ fontSize: '12px', fontWeight: '600', color: '#4a5568', marginBottom: '6px' }}>
                        📊 Participation Level
                      </div>
                      <select
                        value={consent.permission_tier || 'full'}
                        onChange={(e) => setParticipationConfirm({
                          recipientId: recipient.id,
                          newTier: e.target.value,
                          recipientName: recipient.name,
                        })}
                        disabled={participationSaving === recipient.id}
                        style={{
                          width: '100%',
                          padding: '6px 8px',
                          borderRadius: '4px',
                          border: '1px solid #cbd5e0',
                          fontSize: '13px',
                          backgroundColor: participationSaving === recipient.id ? '#edf2f7' : 'white',
                        }}
                      >
                        <option value="full">Full — self-governing, can book sessions</option>
                        <option value="collaborative">Collaborative — can request sessions (requires approval)</option>
                        <option value="managed">Managed — view-only, care team decides</option>
                      </select>
                      {participationSaving === recipient.id && (
                        <div style={{ fontSize: '11px', color: '#718096', marginTop: '4px' }}>Saving...</div>
                      )}
                    </div>
                  )}
                </div>

                {/* Consent Journey Timeline */}
                {trail.length > 0 && (
                  <div style={{ marginBottom: '16px' }}>
                    <h4 style={{ margin: '0 0 12px 0', fontSize: '13px', fontWeight: '600', color: '#2d3748' }}>
                      Consent Journey
                    </h4>
                    <div style={{ fontSize: '12px' }}>
                      {trail.slice(0, 3).map((entry, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '8px' }}>
                          <div style={{
                            width: '20px',
                            height: '20px',
                            borderRadius: '50%',
                            backgroundColor: roleColors[entry.actor_role] || '#cbd5e0',
                            color: 'white',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '10px',
                            marginRight: '8px',
                            flexShrink: 0,
                            marginTop: '2px',
                          }}>
                            {entry.actor_role === 'family' ? '👥' : entry.actor_role === 'admin' ? '⚙️' : entry.actor_role === 'ai' ? '🤖' : entry.actor_role === 'caregiver' ? '💼' : '📋'}
                          </div>
                          <div>
                            <div style={{ fontSize: '11px', color: '#4a5568' }}>
                              {formatDateTime(entry.created_at)}
                            </div>
                            <div style={{ fontSize: '12px', color: '#2d3748', marginTop: '2px' }}>
                              {entry.description}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: '8px' }}>
                  {consent.authorization_tier === 3 && consent.consent_status !== 'granted' && (
                    <button
                      onClick={() => onNavigate('care-recipients')}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        backgroundColor: '#1b6b5a',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: '500',
                      }}
                    >
                      Complete Attestation
                    </button>
                  )}
                  {consent.authorization_tier === 2 && consent.consent_status !== 'granted' && (
                    <button
                      onClick={() => {
                        setActiveTab('documents');
                        setSelectedRecipientFilter(recipient.id);
                        setShowUploadModal(true);
                        setUploadRecipientId(recipient.id);
                        setUploadCategory('consent');
                        setUploadDocType('POA');
                      }}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        backgroundColor: '#1b6b5a',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: '500',
                      }}
                    >
                      Upload POA
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // AUDIT TAB
  const AuditTab = () => (
    <div style={{ padding: '24px' }}>
      <h2 style={{ margin: '0 0 24px 0', fontSize: '20px', fontWeight: '600' }}>Audit Trail</h2>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <select
          value={auditRecipientFilter}
          onChange={(e) => setAuditRecipientFilter(e.target.value)}
          style={{
            padding: '8px 12px',
            border: '1px solid #e2e8f0',
            borderRadius: '6px',
            fontSize: '14px',
            backgroundColor: 'white',
            cursor: 'pointer',
          }}
        >
          <option value="all">All Recipients</option>
          {careRecipients.map(r => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>

        <select
          value={auditEventFilter}
          onChange={(e) => setAuditEventFilter(e.target.value)}
          style={{
            padding: '8px 12px',
            border: '1px solid #e2e8f0',
            borderRadius: '6px',
            fontSize: '14px',
            backgroundColor: 'white',
            cursor: 'pointer',
          }}
        >
          <option value="all">All Events</option>
          <option value="document_uploaded">Document Uploaded</option>
          <option value="document_classified">Document Classified</option>
          <option value="document_approved">Document Approved</option>
          <option value="document_rejected">Document Rejected</option>
          <option value="attestation_submitted">Attestation Submitted</option>
          <option value="code_verified">Code Verified</option>
          <option value="consent_granted">Consent Granted</option>
          <option value="consent_revoked">Consent Revoked</option>
          <option value="managed_mode_activated">Managed Mode Activated</option>
          <option value="participation_level_changed">Participation Level Changed</option>
        </select>
      </div>

      {/* Audit Entries */}
      {auditLoading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#718096' }}>
          Loading audit trail...
        </div>
      ) : auditEntries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#718096' }}>
          No audit entries found
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {auditEntries.map((entry, idx) => (
            <div
              key={entry.id || idx}
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: '6px',
                overflow: 'hidden',
              }}
            >
              <div
                onClick={() => setExpandedAuditId(expandedAuditId === (entry.id || idx) ? null : (entry.id || idx))}
                style={{
                  padding: '12px 16px',
                  backgroundColor: 'white',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    backgroundColor: roleColors[entry.actor_role] || '#cbd5e0',
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '16px',
                    flexShrink: 0,
                  }}>
                    {auditEventIcons[entry.event_type] || '📋'}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '2px' }}>
                      <span style={{
                        fontSize: '12px',
                        fontWeight: '600',
                        backgroundColor: roleColors[entry.actor_role] || '#cbd5e0',
                        color: 'white',
                        padding: '2px 6px',
                        borderRadius: '3px',
                      }}>
                        {entry.actor_role || 'system'}
                      </span>
                      <span style={{ fontSize: '12px', color: '#718096' }}>
                        {formatDateTime(entry.created_at)}
                      </span>
                    </div>
                    <div style={{ fontSize: '13px', color: '#2d3748', fontWeight: '500' }}>
                      {entry.description}
                    </div>
                  </div>
                </div>
                <div style={{ color: '#cbd5e0', fontSize: '16px' }}>
                  {expandedAuditId === (entry.id || idx) ? '▼' : '▶'}
                </div>
              </div>

              {/* Expanded Metadata */}
              {expandedAuditId === (entry.id || idx) && entry.metadata && (
                <div style={{
                  padding: '12px 16px',
                  backgroundColor: '#f7fafc',
                  borderTop: '1px solid #e2e8f0',
                  fontSize: '12px',
                  color: '#4a5568',
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}>
                  {typeof entry.metadata === 'string' ? entry.metadata : JSON.stringify(entry.metadata, null, 2)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Document Verification Center</h1>
        <p className="page-subtitle">Manage care documents, verify consent, and track verification history</p>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid #e2e8f0',
        backgroundColor: 'white',
      }}>
        {[
          { id: 'documents', label: 'Documents' },
          { id: 'consent', label: 'Consent Status' },
          { id: 'audit', label: 'Audit Trail' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '12px 24px',
              fontSize: '14px',
              fontWeight: '500',
              color: activeTab === tab.id ? '#1b6b5a' : '#718096',
              backgroundColor: 'transparent',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #1b6b5a' : 'none',
              cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'documents' && <DocumentsTab />}
      {activeTab === 'consent' && <ConsentTab />}
      {activeTab === 'audit' && <AuditTab />}

      {/* Upload Modal */}
      {showUploadModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowUploadModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: 'white',
              borderRadius: '8px',
              padding: '24px',
              maxWidth: '500px',
              width: '90%',
              maxHeight: '80vh',
              overflowY: 'auto',
              boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
            }}
          >
            <h2 style={{ margin: '0 0 20px 0', fontSize: '18px', fontWeight: '600' }}>
              Upload Document
            </h2>

            {uploadResult ? (
              <div style={{
                padding: '16px',
                backgroundColor: '#f0fdf4',
                border: '1px solid #dcfce7',
                borderRadius: '6px',
                marginBottom: '16px',
              }}>
                <p style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: '600', color: '#22863a' }}>
                  ✓ Document uploaded successfully!
                </p>
                {uploadResult.ai_classification && (
                  <div style={{ fontSize: '13px', color: '#165b33', marginTop: '8px' }}>
                    <p style={{ margin: '0 0 4px 0' }}>
                      <strong>Classification:</strong> {uploadResult.ai_classification.predicted_category}
                    </p>
                    <p style={{ margin: '0 0 4px 0' }}>
                      <strong>Confidence:</strong> {Math.round(uploadResult.ai_classification.confidence)}%
                    </p>
                    {uploadResult.ai_classification.summary && (
                      <p style={{ margin: '0' }}>
                        <strong>Summary:</strong> {uploadResult.ai_classification.summary}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <form onSubmit={handleUploadSubmit}>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '6px', color: '#2d3748' }}>
                    Care Recipient
                  </label>
                  <select
                    value={uploadRecipientId}
                    onChange={(e) => setUploadRecipientId(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: '1px solid #cbd5e0',
                      borderRadius: '6px',
                      fontSize: '14px',
                      backgroundColor: 'white',
                      cursor: 'pointer',
                    }}
                  >
                    <option value="">Select a care recipient</option>
                    {careRecipients.map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '6px', color: '#2d3748' }}>
                    Category
                  </label>
                  <select
                    value={uploadCategory}
                    onChange={(e) => {
                      setUploadCategory(e.target.value);
                      setUploadDocType(docTypesByCategory[e.target.value][0]);
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: '1px solid #cbd5e0',
                      borderRadius: '6px',
                      fontSize: '14px',
                      backgroundColor: 'white',
                      cursor: 'pointer',
                    }}
                  >
                    <option value="consent">Consent</option>
                    <option value="identity">Identity</option>
                    <option value="certification">Certification</option>
                    <option value="insurance">Insurance</option>
                    <option value="legal">Legal</option>
                  </select>
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '6px', color: '#2d3748' }}>
                    Document Type
                  </label>
                  <select
                    value={uploadDocType}
                    onChange={(e) => setUploadDocType(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: '1px solid #cbd5e0',
                      borderRadius: '6px',
                      fontSize: '14px',
                      backgroundColor: 'white',
                      cursor: 'pointer',
                    }}
                  >
                    {docTypesByCategory[uploadCategory].map(type => (
                      <option key={type} value={type}>{humanizeDocType(type)}</option>
                    ))}
                  </select>
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '6px', color: '#2d3748' }}>
                    File (PDF or Image)
                  </label>
                  <input
                    type="file"
                    onChange={handleUploadChange}
                    accept=".pdf,image/jpeg,image/png"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: '1px solid #cbd5e0',
                      borderRadius: '6px',
                      fontSize: '14px',
                      cursor: 'pointer',
                    }}
                  />
                  <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: '#718096' }}>
                    Max 5MB. PDF or JPEG/PNG image.
                  </p>
                </div>

                {uploadError && (
                  <div style={{
                    padding: '12px',
                    backgroundColor: '#fff5f5',
                    border: '1px solid #fed7d7',
                    borderRadius: '6px',
                    marginBottom: '16px',
                    fontSize: '13px',
                    color: '#c53030',
                  }}>
                    {uploadError}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setShowUploadModal(false);
                      setUploadError('');
                      setUploadFile(null);
                    }}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#f7fafc',
                      border: '1px solid #cbd5e0',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: '500',
                      color: '#2d3748',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={uploadLoading}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#1b6b5a',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: uploadLoading ? 'not-allowed' : 'pointer',
                      fontSize: '14px',
                      fontWeight: '500',
                      opacity: uploadLoading ? 0.6 : 1,
                    }}
                  >
                    {uploadLoading ? 'Uploading...' : 'Upload'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {showPreviewModal && previewDocument && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowPreviewModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: 'white',
              borderRadius: '8px',
              padding: '24px',
              maxWidth: '800px',
              width: '90%',
              maxHeight: '80vh',
              overflowY: 'auto',
              boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>
                {humanizeDocType(previewDocument.document_type)}
              </h2>
              <button
                onClick={() => setShowPreviewModal(false)}
                style={{
                  backgroundColor: 'transparent',
                  border: 'none',
                  fontSize: '24px',
                  cursor: 'pointer',
                  color: '#718096',
                }}
              >
                ✕
              </button>
            </div>

            {/* Metadata */}
            <div style={{
              backgroundColor: '#f7fafc',
              padding: '12px',
              borderRadius: '6px',
              marginBottom: '16px',
              fontSize: '13px',
              color: '#4a5568',
            }}>
              <p style={{ margin: '0 0 6px 0' }}>
                <strong>Recipient:</strong> {getRecipientName(previewDocument.owner_id)}
              </p>
              <p style={{ margin: '0 0 6px 0' }}>
                <strong>Category:</strong> {previewDocument.category} · <strong>Type:</strong> {humanizeDocType(previewDocument.document_type)}
              </p>
              <p style={{ margin: '0 0 6px 0' }}>
                <strong>Status:</strong> {statusLabels[previewDocument.status]}
              </p>
              <p style={{ margin: '0' }}>
                <strong>Uploaded:</strong> {formatDateTime(previewDocument.created_at)}
              </p>
            </div>

            {/* Preview Content */}
            {previewFileUrl && (
              <div style={{ marginBottom: '16px', border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
                {previewDocument.filename && previewDocument.filename.toLowerCase().endsWith('.pdf') ? (
                  <iframe
                    src={previewFileUrl}
                    style={{
                      width: '100%',
                      height: '500px',
                      border: 'none',
                    }}
                  />
                ) : (
                  <img
                    src={previewFileUrl}
                    style={{
                      maxWidth: '100%',
                      maxHeight: '500px',
                      display: 'block',
                    }}
                  />
                )}
              </div>
            )}

            {/* AI Classification */}
            {previewDocument.ai_classification && (
              <div style={{
                backgroundColor: '#f7fafc',
                padding: '12px',
                borderRadius: '6px',
                marginBottom: '16px',
                fontSize: '13px',
              }}>
                <p style={{ margin: '0 0 8px 0', fontWeight: '600', color: '#2d3748' }}>AI Classification</p>
                <p style={{ margin: '0 0 6px 0', color: '#4a5568' }}>
                  <strong>Category:</strong> {previewDocument.ai_classification.predicted_category}
                </p>
                <p style={{ margin: '0 0 6px 0', color: '#4a5568' }}>
                  <strong>Confidence:</strong> {Math.round(previewDocument.ai_classification.confidence)}%
                </p>
                {previewDocument.ai_classification.summary && (
                  <p style={{ margin: '0 0 6px 0', color: '#4a5568' }}>
                    <strong>Summary:</strong> {previewDocument.ai_classification.summary}
                  </p>
                )}
                {previewDocument.ai_classification.concerns && previewDocument.ai_classification.concerns.length > 0 && (
                  <div style={{ marginTop: '6px' }}>
                    <strong style={{ color: '#c53030' }}>Concerns:</strong>
                    <ul style={{ margin: '4px 0 0 16px', paddingLeft: 0, color: '#c53030' }}>
                      {previewDocument.ai_classification.concerns.map((concern, idx) => (
                        <li key={idx} style={{ marginBottom: '2px' }}>{concern}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Admin Notes */}
            {previewDocument.admin_notes && (
              <div style={{
                backgroundColor: '#fffaf0',
                padding: '12px',
                borderRadius: '6px',
                marginBottom: '16px',
                fontSize: '13px',
                borderLeft: '3px solid #e8724a',
              }}>
                <strong style={{ color: '#c05621' }}>Admin Notes:</strong>
                <p style={{ margin: '6px 0 0 0', color: '#9c2c1d' }}>{previewDocument.admin_notes}</p>
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => handleDownload(previewDocument)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#f7fafc',
                  border: '1px solid #cbd5e0',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#2d3748',
                }}
              >
                Download
              </button>
              <button
                onClick={() => setShowPreviewModal(false)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#1b6b5a',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Participation Level Confirmation Modal */}
      {participationConfirm && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1001,
          }}
          onClick={() => setParticipationConfirm(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: 'white', borderRadius: '8px', padding: '24px',
              maxWidth: '420px', width: '90%',
              boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
            }}
          >
            <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '600' }}>
              Change Participation Level
            </h3>
            <p style={{ margin: '0 0 16px 0', fontSize: '14px', color: '#4a5568', lineHeight: 1.5 }}>
              Change <strong>{participationConfirm.recipientName}</strong>'s participation to{' '}
              <strong>
                {participationConfirm.newTier === 'full' ? 'Full' : participationConfirm.newTier === 'collaborative' ? 'Collaborative' : 'Managed'}
              </strong>?
              {participationConfirm.newTier === 'managed' && ' They will only be able to view their calendar and care info.'}
              {participationConfirm.newTier === 'collaborative' && ' They can request care sessions but will need your approval.'}
              {participationConfirm.newTier === 'full' && ' They will have full control over their care scheduling.'}
              {' '}They will be notified of this change.
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setParticipationConfirm(null)}
                style={{
                  padding: '8px 16px', backgroundColor: 'white',
                  border: '1px solid #cbd5e0', borderRadius: '6px',
                  cursor: 'pointer', fontSize: '13px', fontWeight: '500',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleParticipationChange(participationConfirm.recipientId, participationConfirm.newTier)}
                disabled={participationSaving === participationConfirm.recipientId}
                style={{
                  padding: '8px 16px', backgroundColor: '#1b6b5a', color: 'white',
                  border: 'none', borderRadius: '6px',
                  cursor: 'pointer', fontSize: '13px', fontWeight: '500',
                  opacity: participationSaving ? 0.6 : 1,
                }}
              >
                {participationSaving ? 'Saving...' : 'Confirm Change'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
