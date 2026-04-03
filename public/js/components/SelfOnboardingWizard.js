// ─── Self-Onboarding Wizard for Care Recipients (Tier 1 users) ───
// Flow: Identity → Selfie → ID Verification → Care Address → Health & Safety → Terms

const SelfOnboardingWizard = window.SelfOnboardingWizard = ({ user, careRecipientId, onComplete }) => {
  // Step state (0-5, null = form, then 1-6 for wizard steps)
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Step 1: Identity Confirmation
  const [dateOfBirth, setDateOfBirth] = useState({ month: '', day: '', year: '' });
  const [preferredName, setPreferredName] = useState('');

  // Step 2: Selfie
  const [videoStream, setVideoStream] = useState(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [selfie, setSelfie] = useState(null);
  const [selfieSkipped, setSelfieSkipped] = useState(false);

  // Step 3: ID Verification
  const [idPhoto, setIdPhoto] = useState(null);
  const [idVerifying, setIdVerifying] = useState(false);
  const [idVerificationResult, setIdVerificationResult] = useState(null);
  const [idSkipped, setIdSkipped] = useState(false);

  // Step 4: Care Address
  const [address, setAddress] = useState({
    line1: '',
    line2: '',
    city: '',
    state: '',
    zip: '',
  });

  // Step 5: Health & Safety
  const [healthData, setHealthData] = useState({
    medicalConditions: '',
    medications: '',
    foodAllergies: '',
    petAllergies: '',
    otherAllergies: '',
    pets: '',
  });
  const [emergencyContact, setEmergencyContact] = useState({
    name: '',
    phone: '',
    relationship: '',
  });

  // Step 6: Terms & Privacy
  const [termsAgreed, setTermsAgreed] = useState(false);
  const [nonMedicalAgreed, setNonMedicalAgreed] = useState(false);

  const { showToast } = useToast();

  // US States list
  const US_STATES = [
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  ];

  // ─── Camera & Photo Capture ───
  const startCamera = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      setVideoStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      setError(`Camera access denied: ${err.message}`);
      showToast('Unable to access camera', 'error');
    }
  };

  const stopCamera = () => {
    if (videoStream) {
      videoStream.getTracks().forEach(track => track.stop());
      setVideoStream(null);
    }
  };

  const capturePhoto = (photoType) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    const base64 = canvas.toDataURL('image/jpeg', 0.85);

    if (photoType === 'selfie') {
      setSelfie(base64);
      stopCamera();
      showToast('Selfie captured!', 'success');
    } else if (photoType === 'id') {
      setIdPhoto(base64);
      stopCamera();
      showToast('ID photo captured!', 'success');
    }
  };

  const handleIdUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setIdPhoto(ev.target.result);
        setLoading(false);
        showToast('ID photo uploaded!', 'success');
      };
      reader.onerror = () => {
        setLoading(false);
        showToast('Failed to read file', 'error');
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setLoading(false);
      showToast('Error uploading file', 'error');
    }
  };

  // ─── ID Verification API Call ───
  const verifyIdPhoto = async () => {
    if (!idPhoto || (!selfie && !selfieSkipped)) {
      setError('Please provide both a selfie and ID photo');
      return;
    }

    setIdVerifying(true);
    setError('');
    try {
      // Send base64 images as JSON — avoids FormData/multipart issues with service worker
      const payload = { idPhoto };
      if (selfie && !selfieSkipped) payload.selfie = selfie;

      const res = await apiFetch('/api/self-onboarding/verify-id', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const result = await res.json();
        setIdVerificationResult(result);
        if (result.matched) {
          showToast('Identity verified!', 'success');
        } else {
          showToast('Identity verification completed. Please review any alerts.', 'info');
        }
      } else {
        const errData = await res.json();
        setError(errData.error || 'Verification failed. Please try again.');
        showToast('Verification failed', 'error');
      }
    } catch (err) {
      console.error('Verify ID error:', err);
      setError('Error verifying ID. Please try again.');
      showToast('Error verifying ID', 'error');
    }
    setIdVerifying(false);
  };

  // ─── Validation ───
  const validateStep = (step) => {
    setError('');
    switch (step) {
      case 0: // Identity
        if (!dateOfBirth.month || !dateOfBirth.day || !dateOfBirth.year) {
          setError('Please select your date of birth');
          return false;
        }
        return true;
      case 1: // Selfie
        if (!selfie && !selfieSkipped) {
          setError('Please take a selfie or skip');
          return false;
        }
        return true;
      case 2: // ID Verification
        if (!idPhoto && !idSkipped) {
          setError('Please upload an ID photo or skip');
          return false;
        }
        if (idPhoto && !idVerificationResult) {
          setError('Please verify your ID before continuing');
          return false;
        }
        return true;
      case 3: // Care Address
        if (!address.line1.trim() || !address.city.trim() || !address.state || !address.zip.trim()) {
          setError('Please complete your care address');
          return false;
        }
        return true;
      case 4: // Health & Safety
        if (!emergencyContact.name.trim() || !emergencyContact.phone.trim() || !emergencyContact.relationship.trim()) {
          setError('Please provide emergency contact information');
          return false;
        }
        return true;
      case 5: // Terms
        if (!termsAgreed || !nonMedicalAgreed) {
          setError('You must agree to all terms to continue');
          return false;
        }
        return true;
      default:
        return true;
    }
  };

  // ─── Complete Onboarding ───
  const completeOnboarding = async () => {
    if (!validateStep(5)) return;

    setLoading(true);
    setError('');
    try {
      const payload = {
        dateOfBirth: `${dateOfBirth.year}-${String(dateOfBirth.month).padStart(2, '0')}-${String(dateOfBirth.day).padStart(2, '0')}`,
        preferredName: preferredName.trim() || null,
        careAddress: {
          line1: address.line1,
          line2: address.line2 || null,
          city: address.city,
          state: address.state,
          zip: address.zip,
        },
        medicalConditions: healthData.medicalConditions.trim(),
        medications: healthData.medications.trim(),
        foodAllergies: healthData.foodAllergies.trim(),
        petAllergies: healthData.petAllergies.trim(),
        otherAllergies: healthData.otherAllergies.trim(),
        pets: healthData.pets.trim(),
        emergencyContact: {
          name: emergencyContact.name.trim(),
          phone: emergencyContact.phone.trim(),
          relationship: emergencyContact.relationship.trim(),
        },
        termsAccepted: termsAgreed,
        nonMedicalAcknowledged: nonMedicalAgreed,
      };

      const res = await apiFetch('/api/self-onboarding/complete', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (res?.ok) {
        showToast('Setup complete! Welcome to InPlace.', 'success');
        if (onComplete) onComplete();
      } else {
        const errData = await res.json();
        setError(errData.error || 'Failed to complete setup');
        showToast('Failed to complete setup', 'error');
      }
    } catch (err) {
      console.error('Complete onboarding error:', err);
      setError('Error completing setup. Please try again.');
      showToast('Error completing setup', 'error');
    }
    setLoading(false);
  };

  // ─── Progress Bar ───
  const WizardProgressBar = () => {
    const steps = ['Identity', 'Selfie', 'Verify ID', 'Address', 'Health & Safety', 'Terms'];
    return (
      <div style={{ marginBottom: '32px', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
          {steps.map((step, idx) => {
            const isCompleted = idx < currentStep;
            const isCurrent = idx === currentStep;
            return (
              <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                <div style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: isCompleted ? 'var(--color-success)' : isCurrent ? 'var(--role-color)' : 'var(--border-light)',
                  color: isCompleted || isCurrent ? 'var(--text-on-primary)' : 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 600,
                  fontSize: 14,
                  zIndex: 2,
                  position: 'relative',
                }}>
                  {isCompleted ? '✓' : (idx + 1)}
                </div>
                <div style={{ fontSize: 11, marginTop: 6, textAlign: 'center', maxWidth: 80, color: isCurrent ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: isCurrent ? 500 : 400 }}>
                  {step}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{
          position: 'absolute',
          top: 20,
          left: 0,
          right: 0,
          height: 2,
          background: 'var(--border-light)',
          zIndex: 1,
        }} />
        <div style={{
          position: 'absolute',
          top: 20,
          left: 0,
          height: 2,
          background: 'var(--role-color)',
          zIndex: 1,
          width: `${(currentStep / 6) * 100}%`,
          transition: 'width 0.3s ease',
        }} />
      </div>
    );
  };

  // ─── Render Steps ───
  const renderStep = () => {
    const cardStyle = {
      borderLeft: '4px solid var(--role-color)',
      padding: '24px',
      borderRadius: '12px',
      background: 'var(--bg-card)',
      boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    };

    const inputStyle = {
      padding: '10px 12px',
      borderRadius: '6px',
      border: '1px solid var(--border-light)',
      fontSize: '14px',
      fontFamily: 'inherit',
      width: '100%',
      boxSizing: 'border-box',
    };

    const labelStyle = {
      display: 'block',
      marginBottom: '6px',
      fontWeight: 500,
      fontSize: '14px',
      color: 'var(--text-primary)',
    };

    if (currentStep === 0) {
      // Step 1: Identity Confirmation
      return (
        <div className="card" style={{ ...cardStyle, marginTop: '0' }}>
          <WizardProgressBar />
          <h2 style={{ marginTop: 0, marginBottom: '8px', color: 'var(--role-color)' }}>Confirm Your Identity</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '24px' }}>
            We need to verify who you are to set up your care profile.
          </p>

          <div style={{ marginBottom: '24px' }}>
            <label style={labelStyle}>Your Name</label>
            <input
              type="text"
              value={`${user?.first_name || ''} ${user?.last_name || ''}`.trim()}
              disabled
              style={{ ...inputStyle, background: 'var(--bg-muted)', color: 'var(--text-muted)', cursor: 'not-allowed' }}
            />
            <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', margin: '6px 0 0' }}>From your registration</p>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={labelStyle}>Date of Birth</label>
            <div style={{ display: 'flex', gap: '12px' }}>
              <select
                value={dateOfBirth.month}
                onChange={(e) => setDateOfBirth({ ...dateOfBirth, month: e.target.value })}
                style={{ ...inputStyle, flex: 1 }}
              >
                <option value="">Month</option>
                {Array.from({ length: 12 }, (_, i) => {
                  const month = i + 1;
                  const name = new Date(2000, month - 1).toLocaleString('en-US', { month: 'long' });
                  return <option key={month} value={month}>{name} ({String(month).padStart(2, '0')})</option>;
                })}
              </select>
              <select
                value={dateOfBirth.day}
                onChange={(e) => setDateOfBirth({ ...dateOfBirth, day: e.target.value })}
                style={{ ...inputStyle, flex: 0.8 }}
              >
                <option value="">Day</option>
                {Array.from({ length: 31 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>
                ))}
              </select>
              <select
                value={dateOfBirth.year}
                onChange={(e) => setDateOfBirth({ ...dateOfBirth, year: e.target.value })}
                style={{ ...inputStyle, flex: 1 }}
              >
                <option value="">Year</option>
                {Array.from({ length: 120 }, (_, i) => {
                  const year = new Date().getFullYear() - i;
                  return <option key={year} value={year}>{year}</option>;
                })}
              </select>
            </div>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={labelStyle}>Preferred Name (optional)</label>
            <input
              type="text"
              placeholder="What should your caregivers call you?"
              value={preferredName}
              onChange={(e) => setPreferredName(e.target.value)}
              style={inputStyle}
            />
          </div>

          {error && <div style={{ color: 'var(--color-error)', fontSize: '14px', marginBottom: '16px', padding: '12px', background: 'var(--color-error-bg)', borderRadius: '6px' }}>{error}</div>}

          <div style={{ display: 'flex', gap: '12px', marginTop: '32px' }}>
            <button
              className="btn btn-primary"
              onClick={() => {
                if (validateStep(0)) setCurrentStep(1);
              }}
              disabled={loading}
            >
              Continue
            </button>
          </div>
        </div>
      );
    }

    if (currentStep === 1) {
      // Step 2: Selfie
      return (
        <div className="card" style={{ ...cardStyle, marginTop: '0' }}>
          <WizardProgressBar />
          <h2 style={{ marginTop: 0, marginBottom: '8px', color: 'var(--role-color)' }}>Take a Selfie</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '24px' }}>
            We need a clear photo of your face for identity verification.
          </p>

          {selfie ? (
            <div style={{ marginBottom: '24px' }}>
              <div style={{ borderRadius: '12px', overflow: 'hidden', marginBottom: '12px' }}>
                <img src={selfie} alt="Selfie" style={{ width: '100%', height: 'auto', display: 'block' }} />
              </div>
              <button
                className="btn btn-outline"
                onClick={() => {
                  setSelfie(null);
                  startCamera();
                }}
                style={{ width: '100%' }}
              >
                Retake Photo
              </button>
            </div>
          ) : videoStream ? (
            <div style={{ marginBottom: '24px' }}>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                style={{ width: '100%', borderRadius: '12px', background: '#000' }}
              />
              <canvas ref={canvasRef} style={{ display: 'none' }} />
              <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                <button
                  className="btn btn-primary"
                  onClick={() => capturePhoto('selfie')}
                  style={{ flex: 1 }}
                >
                  Capture Photo
                </button>
                <button
                  className="btn btn-outline"
                  onClick={stopCamera}
                  style={{ flex: 1 }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn btn-primary"
              onClick={startCamera}
              style={{ width: '100%', marginBottom: '12px' }}
              disabled={loading}
            >
              Open Camera
            </button>
          )}

          <div style={{
            padding: '12px',
            background: 'var(--color-info-bg)',
            borderRadius: '6px',
            fontSize: '13px',
            color: 'var(--color-info)',
            marginBottom: '24px',
            lineHeight: '1.5',
          }}>
            <strong>Privacy Notice:</strong> Your selfie is stored securely and used only to verify your identity against your ID photo. It may be reviewed by an administrator if verification requires manual review.
          </div>

          {error && <div style={{ color: 'var(--color-error)', fontSize: '14px', marginBottom: '16px', padding: '12px', background: 'var(--color-error-bg)', borderRadius: '6px' }}>{error}</div>}

          <div style={{ display: 'flex', gap: '12px', marginTop: '32px' }}>
            <button
              className="btn btn-primary"
              onClick={() => setCurrentStep(2)}
              disabled={!selfie && !selfieSkipped}
            >
              Continue
            </button>
            <button
              className="btn btn-outline"
              onClick={() => {
                setSelfieSkipped(true);
                setCurrentStep(2);
              }}
            >
              Skip for Now
            </button>
            <button
              className="btn btn-outline"
              onClick={() => setCurrentStep(0)}
            >
              Back
            </button>
          </div>
        </div>
      );
    }

    if (currentStep === 2) {
      // Step 3: Verify ID
      return (
        <div className="card" style={{ ...cardStyle, marginTop: '0' }}>
          <WizardProgressBar />
          <h2 style={{ marginTop: 0, marginBottom: '8px', color: 'var(--role-color)' }}>Verify Your ID</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '24px' }}>
            Upload a photo of your government ID (driver's license or passport).
          </p>

          {idPhoto ? (
            <div style={{ marginBottom: '24px' }}>
              <div style={{ borderRadius: '12px', overflow: 'hidden', marginBottom: '12px' }}>
                <img src={idPhoto} alt="ID Photo" style={{ width: '100%', height: 'auto', display: 'block' }} />
              </div>

              {idVerificationResult && (
                <div style={{
                  padding: '16px',
                  borderRadius: '6px',
                  marginBottom: '12px',
                  background: idVerificationResult.matched ? 'var(--color-success-bg)' : 'var(--color-warning-bg)',
                  border: `1px solid ${idVerificationResult.matched ? 'var(--color-success)' : 'var(--color-warning)'}`,
                }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '18px' }}>{idVerificationResult.matched ? '✓' : '⚠️'}</span>
                    <div style={{ flex: 1 }}>
                      {idVerificationResult.matched ? (
                        /* ─── All clear ─── */
                        <div>
                          <p style={{ margin: 0, fontWeight: 600, color: 'var(--color-success)' }}>Identity Verified</p>
                          {/* Face match line */}
                          {idVerificationResult.faceComparison && !idVerificationResult.faceComparison.skipped && (
                            <p style={{ margin: '6px 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
                              ✓ Face match {Math.round(idVerificationResult.faceComparison.confidence * 100)}%
                            </p>
                          )}
                        </div>
                      ) : (
                        /* ─── Needs review ─── */
                        <div>
                          {/* Primary status line — what's wrong */}
                          <p style={{ margin: 0, fontWeight: 600, color: 'var(--color-warning)' }}>
                            {!idVerificationResult.nameMatched ? 'Name Mismatch — Requires Review' :
                             idVerificationResult.faceComparison && !idVerificationResult.faceComparison.similar && !idVerificationResult.faceComparison.skipped ? 'Photo Mismatch — Requires Review' :
                             'Document Under Review'}
                          </p>
                          <p style={{ margin: '6px 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
                            We'll review your document. You can continue setting up your account.
                          </p>

                          {/* Name mismatch detail */}
                          {idVerificationResult.extractedName && !idVerificationResult.nameMatched && (
                            <div style={{ marginTop: '10px', padding: '8px 10px', borderRadius: '6px', background: 'rgba(231,76,60,0.08)', fontSize: '13px' }}>
                              <div><strong>Registered name:</strong> {idVerificationResult.registeredName}</div>
                              <div><strong>Name on ID:</strong> {idVerificationResult.extractedName}</div>
                            </div>
                          )}

                          {/* Face match — just score + icon, no explanation */}
                          {idVerificationResult.faceComparison && !idVerificationResult.faceComparison.skipped && (
                            <p style={{ margin: '8px 0 0', fontSize: '13px' }}>
                              {idVerificationResult.faceComparison.similar ? '✓' : '⚠️'}{' '}
                              Face match {Math.round(idVerificationResult.faceComparison.confidence * 100)}%
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  className="btn btn-outline"
                  onClick={() => {
                    setIdPhoto(null);
                    setIdVerificationResult(null);
                  }}
                  style={{ flex: 1 }}
                >
                  Change Photo
                </button>
                {!idVerificationResult && (
                  <button
                    className="btn btn-primary"
                    onClick={verifyIdPhoto}
                    disabled={idVerifying || !selfie}
                    style={{ flex: 1 }}
                  >
                    {idVerifying ? 'Verifying...' : 'Verify'}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
              <button
                className="btn btn-primary"
                onClick={() => startCamera()}
                style={{ flex: 1 }}
                disabled={loading}
              >
                Take Photo
              </button>
              <label style={{ flex: 1, cursor: 'pointer' }}>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleIdUpload}
                  style={{ display: 'none' }}
                />
                <div
                  className="btn btn-outline"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '44px',
                  }}
                  onClick={(e) => e.currentTarget.querySelector('input')?.click?.()}
                >
                  Upload Photo
                </div>
              </label>
            </div>
          )}

          {videoStream && currentStep === 2 && (
            <div style={{ marginBottom: '24px' }}>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                style={{ width: '100%', borderRadius: '12px', background: '#000' }}
              />
              <canvas ref={canvasRef} style={{ display: 'none' }} />
              <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                <button
                  className="btn btn-primary"
                  onClick={() => capturePhoto('id')}
                  style={{ flex: 1 }}
                >
                  Capture Photo
                </button>
                <button
                  className="btn btn-outline"
                  onClick={stopCamera}
                  style={{ flex: 1 }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div style={{
            padding: '12px',
            background: 'var(--color-info-bg)',
            borderRadius: '6px',
            fontSize: '13px',
            color: 'var(--color-info)',
            marginBottom: '24px',
            lineHeight: '1.5',
          }}>
            <strong>Privacy Notice:</strong> Your ID photo and selfie are stored securely for verification records and may be reviewed by an administrator.
          </div>

          {error && <div style={{ color: 'var(--color-error)', fontSize: '14px', marginBottom: '16px', padding: '12px', background: 'var(--color-error-bg)', borderRadius: '6px' }}>{error}</div>}

          <div style={{ display: 'flex', gap: '12px', marginTop: '32px' }}>
            <button
              className="btn btn-primary"
              onClick={() => setCurrentStep(3)}
              disabled={!idVerificationResult && !idSkipped}
            >
              Continue
            </button>
            <button
              className="btn btn-outline"
              onClick={() => {
                setIdSkipped(true);
                setCurrentStep(3);
              }}
            >
              Skip for Now
            </button>
            <button
              className="btn btn-outline"
              onClick={() => setCurrentStep(1)}
            >
              Back
            </button>
          </div>
        </div>
      );
    }

    if (currentStep === 3) {
      // Step 4: Care Address
      return (
        <div className="card" style={{ ...cardStyle, marginTop: '0' }}>
          <WizardProgressBar />
          <h2 style={{ marginTop: 0, marginBottom: '8px', color: 'var(--role-color)' }}>Where Will Care Take Place?</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '24px' }}>
            Usually your home. This address is shared with caregivers only when they're confirmed for a visit.
          </p>

          <div style={{ marginBottom: '20px' }}>
            <label style={labelStyle}>Street Address</label>
            <input
              type="text"
              placeholder="123 Main St"
              value={address.line1}
              onChange={(e) => setAddress({ ...address, line1: e.target.value })}
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={labelStyle}>Apartment, Suite, etc. (optional)</label>
            <input
              type="text"
              placeholder="Apt 4B"
              value={address.line2}
              onChange={(e) => setAddress({ ...address, line2: e.target.value })}
              style={inputStyle}
            />
          </div>

          <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>City</label>
              <input
                type="text"
                placeholder="New York"
                value={address.city}
                onChange={(e) => setAddress({ ...address, city: e.target.value })}
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 0.7 }}>
              <label style={labelStyle}>State</label>
              <select
                value={address.state}
                onChange={(e) => setAddress({ ...address, state: e.target.value })}
                style={inputStyle}
              >
                <option value="">State</option>
                {US_STATES.map(state => (
                  <option key={state} value={state}>{state}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 0.7 }}>
              <label style={labelStyle}>ZIP</label>
              <input
                type="text"
                placeholder="10001"
                value={address.zip}
                onChange={(e) => setAddress({ ...address, zip: e.target.value })}
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ marginBottom: '24px', padding: '12px', background: 'var(--bg-muted)', borderRadius: '6px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 'normal' }}>
              <input
                type="checkbox"
                checked={true}
                disabled
                style={{ cursor: 'not-allowed' }}
              />
              <span style={{ fontSize: '14px', color: 'var(--text-primary)' }}>This is my home address</span>
            </label>
          </div>

          {error && <div style={{ color: 'var(--color-error)', fontSize: '14px', marginBottom: '16px', padding: '12px', background: 'var(--color-error-bg)', borderRadius: '6px' }}>{error}</div>}

          <div style={{ display: 'flex', gap: '12px', marginTop: '32px' }}>
            <button
              className="btn btn-primary"
              onClick={() => {
                if (validateStep(3)) setCurrentStep(4);
              }}
              disabled={loading}
            >
              Continue
            </button>
            <button
              className="btn btn-outline"
              onClick={() => setCurrentStep(2)}
            >
              Back
            </button>
          </div>
        </div>
      );
    }

    if (currentStep === 4) {
      // Step 5: Health & Safety
      return (
        <div className="card" style={{ ...cardStyle, marginTop: '0' }}>
          <WizardProgressBar />
          <h2 style={{ marginTop: 0, marginBottom: '8px', color: 'var(--role-color)' }}>Health & Safety Information</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '24px' }}>
            This helps caregivers provide safe, personalized care.
          </p>

          <div style={{ marginBottom: '20px' }}>
            <label style={labelStyle}>Medical Conditions</label>
            <textarea
              placeholder="Any conditions caregivers should know about? (optional)"
              value={healthData.medicalConditions}
              onChange={(e) => setHealthData({ ...healthData, medicalConditions: e.target.value })}
              style={{ ...inputStyle, minHeight: '80px', fontFamily: 'inherit' }}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={labelStyle}>Current Medications</label>
            <textarea
              placeholder="Medications you take regularly (optional)"
              value={healthData.medications}
              onChange={(e) => setHealthData({ ...healthData, medications: e.target.value })}
              style={{ ...inputStyle, minHeight: '80px', fontFamily: 'inherit' }}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={labelStyle}>Food Allergies</label>
            <input
              type="text"
              placeholder="e.g., peanuts, shellfish (optional)"
              value={healthData.foodAllergies}
              onChange={(e) => setHealthData({ ...healthData, foodAllergies: e.target.value })}
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={labelStyle}>Pet Allergies</label>
            <input
              type="text"
              placeholder="e.g., dog hair, cat dander (optional)"
              value={healthData.petAllergies}
              onChange={(e) => setHealthData({ ...healthData, petAllergies: e.target.value })}
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={labelStyle}>Other Allergies</label>
            <input
              type="text"
              placeholder="e.g., latex, medications (optional)"
              value={healthData.otherAllergies}
              onChange={(e) => setHealthData({ ...healthData, otherAllergies: e.target.value })}
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={labelStyle}>Pets in Your Home</label>
            <input
              type="text"
              placeholder="e.g., friendly golden retriever, two cats (optional)"
              value={healthData.pets}
              onChange={(e) => setHealthData({ ...healthData, pets: e.target.value })}
              style={inputStyle}
            />
          </div>

          <div style={{ padding: '16px', background: 'var(--color-info-bg)', borderRadius: '6px', marginBottom: '24px' }}>
            <h4 style={{ margin: '0 0 12px', color: 'var(--color-info)', fontSize: '14px' }}>Emergency Contact</h4>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ ...labelStyle, marginBottom: '4px' }}>Name</label>
              <input
                type="text"
                placeholder="Full name"
                value={emergencyContact.name}
                onChange={(e) => setEmergencyContact({ ...emergencyContact, name: e.target.value })}
                style={inputStyle}
              />
            </div>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ ...labelStyle, marginBottom: '4px' }}>Phone</label>
              <input
                type="tel"
                placeholder="(123) 456-7890"
                value={emergencyContact.phone}
                onChange={(e) => setEmergencyContact({ ...emergencyContact, phone: e.target.value })}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ ...labelStyle, marginBottom: '4px' }}>Relationship</label>
              <input
                type="text"
                placeholder="e.g., daughter, son, friend"
                value={emergencyContact.relationship}
                onChange={(e) => setEmergencyContact({ ...emergencyContact, relationship: e.target.value })}
                style={inputStyle}
              />
            </div>
          </div>

          {error && <div style={{ color: 'var(--color-error)', fontSize: '14px', marginBottom: '16px', padding: '12px', background: 'var(--color-error-bg)', borderRadius: '6px' }}>{error}</div>}

          <div style={{ display: 'flex', gap: '12px', marginTop: '32px' }}>
            <button
              className="btn btn-primary"
              onClick={() => {
                if (validateStep(4)) setCurrentStep(5);
              }}
              disabled={loading}
            >
              Continue
            </button>
            <button
              className="btn btn-outline"
              onClick={() => setCurrentStep(3)}
            >
              Back
            </button>
          </div>
        </div>
      );
    }

    if (currentStep === 5) {
      // Step 6: Terms & Privacy
      return (
        <div className="card" style={{ ...cardStyle, marginTop: '0' }}>
          <WizardProgressBar />
          <h2 style={{ marginTop: 0, marginBottom: '8px', color: 'var(--role-color)' }}>Review & Complete</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '24px' }}>
            Please review and accept our agreements to get started.
          </p>

          <div style={{ padding: '16px', background: 'var(--bg-muted)', borderRadius: '6px', marginBottom: '24px' }}>
            <h4 style={{ margin: '0 0 12px', color: 'var(--text-primary)', fontSize: '14px' }}>By continuing, you agree to:</h4>
            <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '14px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
              <li style={{ marginBottom: '8px' }}>
                <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--role-color)', textDecoration: 'none' }}>InPlace Terms of Service</a>
              </li>
              <li>
                <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--role-color)', textDecoration: 'none' }}>Privacy Policy</a>
              </li>
            </ul>
          </div>

          <div style={{ marginBottom: '16px', padding: '12px', background: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', cursor: 'pointer', fontWeight: 'normal' }}>
              <input
                type="checkbox"
                checked={termsAgreed}
                onChange={(e) => setTermsAgreed(e.target.checked)}
                style={{ marginTop: '4px', cursor: 'pointer', flexShrink: 0 }}
              />
              <span style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
                I have read and agree to the Terms of Service and Privacy Policy
              </span>
            </label>
          </div>

          <div style={{ marginBottom: '24px', padding: '12px', background: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', cursor: 'pointer', fontWeight: 'normal' }}>
              <input
                type="checkbox"
                checked={nonMedicalAgreed}
                onChange={(e) => setNonMedicalAgreed(e.target.checked)}
                style={{ marginTop: '4px', cursor: 'pointer', flexShrink: 0 }}
              />
              <span style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
                I understand that InPlace provides non-medical companion care only
              </span>
            </label>
          </div>

          {error && <div style={{ color: 'var(--color-error)', fontSize: '14px', marginBottom: '16px', padding: '12px', background: 'var(--color-error-bg)', borderRadius: '6px' }}>{error}</div>}

          <div style={{ display: 'flex', gap: '12px', marginTop: '32px' }}>
            <button
              className="btn btn-primary"
              onClick={completeOnboarding}
              disabled={loading || !termsAgreed || !nonMedicalAgreed}
              style={{ opacity: (loading || !termsAgreed || !nonMedicalAgreed) ? 0.6 : 1 }}
            >
              {loading ? 'Completing...' : 'Complete Setup'}
            </button>
            <button
              className="btn btn-outline"
              onClick={() => setCurrentStep(4)}
              disabled={loading}
            >
              Back
            </button>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div style={{
      maxWidth: '600px',
      margin: '0 auto',
      padding: '20px',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
    }}>
      {renderStep()}
    </div>
  );
};
