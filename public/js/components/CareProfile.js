const CareProfile = window.CareProfile = ({ onNavigate }) => {
  const [profile, setProfile] = useState(null);
  const [allRecipients, setAllRecipients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [notes, setNotes] = useState([]);
  const [familyVisits, setFamilyVisits] = useState([]); // v1.105.38
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [notesOpen, setNotesOpen] = useState(true); // v1.76.0 — observations are a first-class feature, not buried
  const [noteUrgent, setNoteUrgent] = useState(false);
  const [notePhoto, setNotePhoto] = useState(null); // { data, name }
  const [viewingAttachments, setViewingAttachments] = useState(null); // v1.105.34 — { list, index }
  const [photoUploading, setPhotoUploading] = useState(false);
  const [permTier, setPermTier] = useState('full');
  const [visSettings, setVisSettings] = useState(null);
  const [savingPerms, setSavingPerms] = useState(false);
  const [carePrefs, setCarePrefs] = useState({});
  const [careDetails, setCareDetails] = useState({});
  const [aiSummary, setAiSummary] = useState('');
  const [aiSummaryDate, setAiSummaryDate] = useState(null);
  const [generatingAI, setGeneratingAI] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsExpanded, setPrefsExpanded] = useState(false);
  const [showAllPrefs, setShowAllPrefs] = useState(false);
  const [editingSummary, setEditingSummary] = useState(false);
  const [editedSummary, setEditedSummary] = useState('');
  const [savingSummary, setSavingSummary] = useState(false);
  const [doctorReportOpen, setDoctorReportOpen] = useState(false);
  const [doctorApptType, setDoctorApptType] = useState('');
  const [doctorApptDetails, setDoctorApptDetails] = useState('');
  const [doctorEmail, setDoctorEmail] = useState('');
  const [doctorReportLoading, setDoctorReportLoading] = useState(false);
  const [doctorReport, setDoctorReport] = useState('');
  const [doctorEmailSent, setDoctorEmailSent] = useState(false);
  const [doctorReportAck, setDoctorReportAck] = useState(false); // v1.93.0 — reviewed-and-responsible acknowledgment
  const [doctorReportSending, setDoctorReportSending] = useState(false);
  const [doctorQuestions, setDoctorQuestions] = useState([]); // v1.94.0 — iPAi's pre-draft gap questions
  const [doctorAnswers, setDoctorAnswers] = useState({});
  // Kindred panel state
  const [companionOpen, setCompanionOpen] = useState(false);
  const [companionTab, setCompanionTab] = useState('conversations');
  const [companionConvos, setCompanionConvos] = useState([]);
  const [companionConvosLoading, setCompanionConvosLoading] = useState(false);
  const [expandedConvo, setExpandedConvo] = useState(null);
  const [voicePrefs, setVoicePrefs] = useState({ speed: 1.0, stability: 0.5, similarity_boost: 0.8 });
  const [voicePrefsLoading, setVoicePrefsLoading] = useState(false);
  const [savingVoicePrefs, setSavingVoicePrefs] = useState(false);
  const [companionUsage, setCompanionUsage] = useState(null);
  const [usageLoading, setUsageLoading] = useState(false);
  // Kindred reminders
  const [kindredReminders, setKindredReminders] = useState([]);
  const [remindersLoading, setRemindersLoading] = useState(false);
  const [showAddReminder, setShowAddReminder] = useState(false);
  const [newReminderText, setNewReminderText] = useState('');
  const [newReminderTime, setNewReminderTime] = useState('09:00');
  const [newReminderRecurrence, setNewReminderRecurrence] = useState('daily');
  const [newReminderDays, setNewReminderDays] = useState('mon,tue,wed,thu,fri,sat,sun');
  const [newReminderLabel, setNewReminderLabel] = useState('');
  const [savingReminder, setSavingReminder] = useState(false);
  // Kindred summary + conversation management
  const [kindredSummary, setKindredSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [selectedConvos, setSelectedConvos] = useState(new Set());
  const [deletingConvos, setDeletingConvos] = useState(false);
  // Voice routing
  const [voiceRouting, setVoiceRouting] = useState([]);
  const [voiceRoutingLoading, setVoiceRoutingLoading] = useState(false);
  const [availableVoices, setAvailableVoices] = useState([]);
  const [savingRoute, setSavingRoute] = useState(null);
  const [routeDropdown, setRouteDropdown] = useState(null);
  // Care team instructions for Kindred
  const [kindredInstructions, setKindredInstructions] = useState('');
  const [kindredInstructionsDraft, setKindredInstructionsDraft] = useState('');
  const [instructionsLoading, setInstructionsLoading] = useState(false);
  const [savingInstructions, setSavingInstructions] = useState(false);
  const [instructionsMeta, setInstructionsMeta] = useState({ updated_at: null, updated_by_name: null });
  const { showToast } = useToast();

  // v1.93.0 — generation and sending are now SEPARATE steps. The draft lands in
  // an editable review box; sending requires the family to acknowledge they
  // reviewed it and own the contents. iPAi drafts; the family decides.
  // v1.94.0 — step 1: iPAi checks the record for gaps and may ask up to 3
  // questions (home notes capture exceptions, not routines — the human knows
  // the routines). Answers feed the draft AND are saved as observations.
  const handleGenerateDoctorReport = async () => {
    if (!profile?.id || !doctorApptType.trim()) {
      if (typeof showToast === 'function') showToast('Please enter the type of appointment', 'error');
      return;
    }
    setDoctorReportLoading(true);
    setDoctorReport('');
    setDoctorEmailSent(false);
    setDoctorReportAck(false);
    setDoctorQuestions([]);
    setDoctorAnswers({});
    try {
      const qRes = await apiFetch(`/api/care-recipients/${profile.id}/doctor-report/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointmentType: doctorApptType.trim(),
          appointmentDetails: doctorApptDetails.trim() || undefined,
        }),
      });
      const qData = qRes ? await qRes.json().catch(() => ({})) : {};
      const questions = Array.isArray(qData.questions) ? qData.questions : [];
      if (questions.length > 0) {
        setDoctorQuestions(questions);
        setDoctorReportLoading(false);
        return; // wait for answers (or skip) before drafting
      }
    } catch (e) { /* questions step is best-effort — fall through to drafting */ }
    await runDoctorReportDraft([]);
  };

  // step 2: draft, optionally with the family's answers
  const runDoctorReportDraft = async (clarifications) => {
    setDoctorReportLoading(true);
    setDoctorQuestions([]);
    try {
      const res = await apiFetch(`/api/care-recipients/${profile.id}/doctor-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointmentType: doctorApptType.trim(),
          appointmentDetails: doctorApptDetails.trim() || undefined,
          clarifications: clarifications && clarifications.length ? clarifications : undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && data.report) {
        setDoctorReport(data.report);
        if (typeof showToast === 'function') showToast('Draft ready — review and edit it before sending', 'success');
      } else {
        if (typeof showToast === 'function') showToast(data.error || 'Failed to generate report', 'error');
      }
    } catch (e) {
      console.error('Doctor report error:', e);
      if (typeof showToast === 'function') showToast('Failed to generate doctor report', 'error');
    }
    setDoctorReportLoading(false);
  };

  const handleAnswersToDraft = () => {
    const clarifications = doctorQuestions
      .map((q, i) => ({ question: q, answer: (doctorAnswers[i] || '').trim() }))
      .filter(c => c.answer);
    runDoctorReportDraft(clarifications);
  };

  const handleSendDoctorReport = async () => {
    if (!profile?.id || !doctorReport.trim()) return;
    if (!doctorEmail.trim()) {
      if (typeof showToast === 'function') showToast("Enter the doctor's email address", 'error');
      return;
    }
    if (!doctorReportAck) {
      if (typeof showToast === 'function') showToast('Please confirm you reviewed the report first', 'error');
      return;
    }
    setDoctorReportSending(true);
    try {
      const res = await apiFetch(`/api/care-recipients/${profile.id}/doctor-report/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportText: doctorReport,
          appointmentType: doctorApptType.trim(),
          doctorEmail: doctorEmail.trim(),
          acknowledged: true,
        }),
      });
      const data = await res.json();
      if (res.ok && data.emailSent) {
        setDoctorEmailSent(true);
        if (typeof showToast === 'function') showToast(`Report emailed to ${doctorEmail.trim()}`, 'success');
      } else {
        if (typeof showToast === 'function') showToast(data.emailError || data.error || 'Failed to send report', 'error');
      }
    } catch (e) {
      console.error('Doctor report send error:', e);
      if (typeof showToast === 'function') showToast('Failed to send report', 'error');
    }
    setDoctorReportSending(false);
  };

  // ── Kindred data fetchers ──
  const fetchCompanionConversations = async (recipientId) => {
    if (!recipientId) return;
    setCompanionConvosLoading(true);
    try {
      const res = await apiFetch(`/api/kindred/conversations?care_recipient_id=${recipientId}`);
      if (res?.ok) {
        const data = await res.json();
        setCompanionConvos(data.conversations || []);
      }
    } catch (e) { console.error('Companion conversations fetch error:', e); }
    setCompanionConvosLoading(false);
  };

  const fetchVoicePreferences = async (recipientId) => {
    if (!recipientId) return;
    setVoicePrefsLoading(true);
    try {
      const res = await apiFetch(`/api/kindred/admin/voice-preferences?care_recipient_id=${recipientId}`);
      if (res?.ok) {
        const data = await res.json();
        setVoicePrefs({
          speed: data.speed ?? 1.0,
          stability: data.stability ?? 0.5,
          similarity_boost: data.similarity_boost ?? 0.8,
        });
      }
    } catch (e) { console.error('Voice preferences fetch error:', e); }
    setVoicePrefsLoading(false);
  };

  const saveVoicePreferences = async () => {
    if (!profile?.id) return;
    setSavingVoicePrefs(true);
    try {
      const res = await apiFetch('/api/kindred/admin/voice-preferences', {
        method: 'PUT',
        body: JSON.stringify({
          care_recipient_id: profile.id,
          speed: voicePrefs.speed,
          stability: voicePrefs.stability,
          similarity_boost: voicePrefs.similarity_boost,
        }),
      });
      if (res?.ok) showToast('Voice preferences saved', 'success');
      else showToast('Failed to save voice preferences', 'error');
    } catch { showToast('Failed to save voice preferences', 'error'); }
    setSavingVoicePrefs(false);
  };

  const fetchKindredSummary = async (recipientId) => {
    if (!recipientId) return;
    setSummaryLoading(true);
    try {
      const res = await apiFetch('/api/kindred/admin/summarize', {
        method: 'POST',
        body: JSON.stringify({ care_recipient_id: recipientId }),
      });
      if (res?.ok) {
        const data = await res.json();
        setKindredSummary(data);
      }
    } catch (e) { console.error('Kindred summary fetch error:', e); }
    setSummaryLoading(false);
  };

  const deleteSelectedConversations = async () => {
    if (selectedConvos.size === 0 || !profile?.id) return;
    setDeletingConvos(true);
    try {
      const res = await apiFetch('/api/kindred/conversations', {
        method: 'DELETE',
        body: JSON.stringify({
          conversation_ids: Array.from(selectedConvos),
          care_recipient_id: profile.id,
        }),
      });
      if (res?.ok) {
        const data = await res.json();
        showToast(`Deleted ${data.deleted_conversations} conversation(s)`, 'success');
        setSelectedConvos(new Set());
        fetchCompanionConversations(profile.id);
        // Refresh summary after deletion
        fetchKindredSummary(profile.id);
      } else {
        showToast('Failed to delete conversations', 'error');
      }
    } catch (e) { showToast('Failed to delete conversations', 'error'); }
    setDeletingConvos(false);
  };

  const fetchVoiceRouting = async (recipientId) => {
    if (!recipientId) return;
    setVoiceRoutingLoading(true);
    try {
      const res = await apiFetch(`/api/kindred/admin/voice-routing?care_recipient_id=${recipientId}`);
      if (res?.ok) {
        const data = await res.json();
        setVoiceRouting(data.routing || []);
      }
    } catch (e) { console.error('Voice routing fetch error:', e); }
    setVoiceRoutingLoading(false);
  };

  const fetchAvailableVoices = async () => {
    try {
      const res = await apiFetch('/api/kindred/available-voices');
      if (res?.ok) {
        const data = await res.json();
        setAvailableVoices(data.voices || []);
      }
    } catch (e) { console.error('Available voices fetch error:', e); }
  };

  const saveVoiceRoute = async (messageType, voiceProfileId, priority) => {
    if (!profile?.id) return;
    setSavingRoute(messageType);
    try {
      const res = await apiFetch('/api/kindred/admin/voice-routing', {
        method: 'PUT',
        body: JSON.stringify({
          care_recipient_id: profile.id,
          routing: [{ message_type: messageType, provider_voice_id: voiceProfileId, priority: priority || 'medium' }],
        }),
      });
      if (res?.ok) {
        showToast('Voice routing updated', 'success');
        fetchVoiceRouting(profile.id);
      } else {
        showToast('Failed to update routing', 'error');
      }
    } catch (e) { showToast('Failed to update routing', 'error'); }
    setSavingRoute(null);
    setRouteDropdown(null);
  };

  const fetchCompanionUsage = async (recipientId) => {
    if (!recipientId) return;
    setUsageLoading(true);
    try {
      const res = await apiFetch(`/api/kindred/admin/usage?care_recipient_id=${recipientId}`);
      if (res?.ok) {
        const data = await res.json();
        setCompanionUsage(data);
      }
    } catch (e) { console.error('Companion usage fetch error:', e); }
    setUsageLoading(false);
  };

  const fetchKindredInstructions = async (recipientId) => {
    if (!recipientId) return;
    setInstructionsLoading(true);
    try {
      const res = await apiFetch(`/api/kindred/admin/instructions?care_recipient_id=${recipientId}`);
      if (res?.ok) {
        const data = await res.json();
        setKindredInstructions(data.instructions || '');
        setKindredInstructionsDraft(data.instructions || '');
        setInstructionsMeta({ updated_at: data.updated_at, updated_by_name: data.updated_by_name });
      }
    } catch (e) { console.error('Kindred instructions fetch error:', e); }
    setInstructionsLoading(false);
  };

  const saveKindredInstructions = async () => {
    if (!profile?.id) return;
    setSavingInstructions(true);
    try {
      const res = await apiFetch('/api/kindred/admin/instructions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          care_recipient_id: profile.id,
          instructions: kindredInstructionsDraft,
        }),
      });
      if (res?.ok) {
        const data = await res.json();
        setKindredInstructions(data.instructions);
        setInstructionsMeta({ updated_at: data.updated_at, updated_by_name: data.updated_by_name });
        showToast('Kindred instructions updated', 'success');
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Failed to save instructions', 'error');
      }
    } catch (e) { showToast('Failed to save instructions', 'error'); }
    setSavingInstructions(false);
  };

  const fetchKindredReminders = async (recipientId) => {
    setRemindersLoading(true);
    try {
      const res = await apiFetch(`/api/kindred/reminders/all?care_recipient_id=${recipientId}`);
      if (res?.ok) {
        const data = await res.json();
        setKindredReminders(data.reminders || []);
      }
    } catch (err) { console.error('Failed to load reminders:', err); }
    setRemindersLoading(false);
  };

  const handleSaveReminder = async () => {
    if (!newReminderText.trim() || !profile?.id) return;
    setSavingReminder(true);
    try {
      // Build scheduled_for from time + today's date (care-location today, never UTC/device)
      const today = TimezoneHelper.getToday(profile?.timezone);
      const scheduled_for = `${today}T${newReminderTime}:00`;
      const body = {
        care_recipient_id: profile.id,
        message_text: newReminderText.trim(),
        scheduled_for,
        recurrence: newReminderRecurrence,
        recurrence_time: newReminderTime,
        recurrence_days: newReminderRecurrence !== 'none' ? newReminderDays : null,
        label: newReminderLabel.trim() || null,
      };
      const res = await apiFetch('/api/kindred/reminders', { method: 'POST', body: JSON.stringify(body) });
      if (res?.ok) {
        setShowAddReminder(false);
        setNewReminderText('');
        setNewReminderTime('09:00');
        setNewReminderRecurrence('daily');
        setNewReminderDays('mon,tue,wed,thu,fri,sat,sun');
        setNewReminderLabel('');
        fetchKindredReminders(profile.id);
        if (typeof showToast === 'function') showToast('Reminder saved!', 'success');
      } else {
        // v1.105.51 — no else. The modal stayed open with the button un-spun and nothing
        // said, so a family believed a medication reminder existed that was never created.
        let msg = 'Could not save the reminder';
        try { const d = await res?.json(); if (d?.error) msg = d.error; } catch {}
        if (typeof showToast === 'function') showToast(msg, 'error');
      }
    } catch (err) {
      console.error('Save reminder error:', err);
      if (typeof showToast === 'function') showToast('Could not save the reminder', 'error');
    }
    setSavingReminder(false);
  };

  const handleDeleteReminder = async (reminderId) => {
    if (!confirm('Delete this reminder?')) return;
    try {
      const res = await apiFetch(`/api/kindred/reminders/${reminderId}`, { method: 'DELETE' });
      if (res?.ok && profile?.id) fetchKindredReminders(profile.id);
    } catch (err) { console.error('Delete reminder error:', err); }
  };

  const handleCompanionOpen = () => {
    setCompanionOpen(true);
    if (profile?.id) {
      fetchCompanionConversations(profile.id);
      fetchVoicePreferences(profile.id);
      fetchCompanionUsage(profile.id);
      fetchKindredSummary(profile.id);
      fetchVoiceRouting(profile.id);
      fetchAvailableVoices();
      fetchKindredInstructions(profile.id);
      fetchKindredReminders(profile.id);
    }
  };

  const CARE_PREFS_LIST = [
    { id: 'meal_prep', label: 'Meal preparation & cooking', icon: '\uD83C\uDF73' },
    { id: 'housekeeping', label: 'Light housekeeping (tidying, dishes, laundry)', icon: '\uD83E\uDDF9' },
    { id: 'errands', label: 'Grocery shopping & errands', icon: '\uD83D\uDED2' },
    { id: 'med_reminders', label: 'Medication reminders (reminders only)', icon: '\uD83D\uDC8A' },
    { id: 'bathing', label: 'Help with bathing, grooming & dressing', icon: '\uD83D\uDEBF' },
    { id: 'fall_prevention', label: 'Fall prevention & mobility assistance', icon: '\uD83E\uDDAF' },
    { id: 'transportation', label: 'Transportation to appointments', icon: '\uD83D\uDE97' },
    { id: 'overnight', label: 'Overnight or evening supervision', icon: '\uD83C\uDF19' },
    { id: 'wandering', label: 'Wandering prevention', icon: '\uD83D\uDEAA' },
    { id: 'vitals', label: 'Vital signs monitoring (BP, temperature)', icon: '\uD83E\uDE7A' },
    { id: 'exercise', label: 'Exercise & physical therapy support', icon: '\uD83C\uDFCB\uFE0F' },
    { id: 'companionship', label: 'Companionship & conversation', icon: '\uD83D\uDCAC' },
    { id: 'hobbies', label: 'Engaging in hobbies & activities together', icon: '\uD83C\uDFA8' },
    { id: 'social_outings', label: 'Social outing accompaniment', icon: '\u26EA' },
    { id: 'patience', label: 'Patience with repetition & confusion', icon: '\uD83D\uDC9B' },
    { id: 'daily_updates', label: 'Daily updates & photos to family', icon: '\uD83D\uDCF8' },
    { id: 'consistent_caregiver', label: 'Consistent same-caregiver scheduling', icon: '\uD83E\uDD1D' },
    { id: 'condition_experience', label: 'Experience with specific conditions', icon: '\uD83D\uDCCB' },
    { id: 'pets', label: 'Comfortable with pets in the home', icon: '\uD83D\uDC3E' },
    { id: 'gardening', label: 'Gardening or light yard work', icon: '\uD83C\uDF31' },
    { id: 'outdoor_walks', label: 'Outdoor walks & fresh air time', icon: '\uD83D\uDEB6' },
    { id: 'socializing_out', label: 'Socializing away from home', icon: '\u2615' },
    { id: 'tech_help', label: 'Technology help (phone, tablet, video calls)', icon: '\uD83D\uDCF1' },
    { id: 'spiritual', label: 'Spiritual or religious practice support', icon: '\uD83D\uDD4A\uFE0F' },
  ];

  const PREF_FOLLOW_UPS = {
    med_reminders: 'How many medications? Any special timing?',
    wandering: 'How frequent? Any known triggers?',
    vitals: 'Which vitals? How often?',
    exercise: 'Any prescribed exercises or PT routines?',
    patience: 'Any specific behaviors we should know about?',
    condition_experience: 'What conditions does your loved one have?',
    pets: 'What kind of pets? Caregiver help needed?',
    spiritual: 'What faith or practice?',
    overnight: 'What does overnight supervision look like?',
    transportation: 'How often? Any regular appointments?',
  };

  const RATING_OPTIONS = [
    { value: 0, label: 'Not needed', color: 'var(--border-light)', textColor: 'var(--text-muted)' },
    { value: 1, label: 'Nice to have', color: 'var(--color-warning-bg)', textColor: 'var(--color-warning)' },
    { value: 2, label: 'Important', color: 'var(--color-success-bg)', textColor: 'var(--color-success)' },
    { value: 3, label: 'Must have', color: 'var(--role-color)', textColor: 'var(--text-on-primary)' },
  ];

  const resizeImg = (file, maxDim, quality) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) { if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; } else { w = Math.round(w * maxDim / h); h = maxDim; } }
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject; img.src = ev.target.result;
    };
    reader.onerror = reject; reader.readAsDataURL(file);
  });

  const handlePhotoUpload = async () => {
    if (!profile?.id) return;
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      setPhotoUploading(true);
      try {
        const base64 = await resizeImg(file, 800, 0.8);
        const res = await apiFetch(`/api/care-recipients/${profile.id}/photo`, { method: 'PUT', body: JSON.stringify({ photo: base64 }) });
        if (res?.ok) { showToast('Photo updated!', 'success'); setProfile(p => ({ ...p, photo: base64 })); }
        else { const d = await res?.json().catch(() => ({})); showToast(d.error || 'Failed to upload photo', 'error'); }
      } catch (err) { console.error('Photo upload error:', err); showToast('Failed to upload photo', 'error'); }
      setPhotoUploading(false);
    };
    input.click();
  };

  // v1.105.38 — family visits are a SEPARATE record, merged at read time. Never duplicated
  // into recipient_notes: one event, two rows, and they drift the moment anyone edits.
  const fetchFamilyVisits = async (recipientId) => {
    try {
      const res = await apiFetch(`/api/family-visits/${recipientId}`);
      if (res?.ok) { const d = await res.json(); setFamilyVisits(d.visits || []); }
      else setFamilyVisits([]);
    } catch { setFamilyVisits([]); }
  };

  const fetchNotes = async (recipientId) => {
    try {
      const res = await apiFetch(`/api/notes/${recipientId}`);
      if (res?.ok) { const d = await res.json(); setNotes(d.notes || []); }
    } catch {}
  };

  const handleAddNote = async () => {
    if (!newNote.trim() || !profile?.id) return;
    setAddingNote(true);
    try {
      const notePayload = { careRecipientId: profile.id, content: newNote.trim(), noteType: 'observation', needsAttention: noteUrgent };
      if (notePhoto) notePayload.photo = notePhoto.data;
      const res = await apiFetch('/api/notes', {
        method: 'POST',
        body: JSON.stringify(notePayload),
      });
      if (res?.ok) {
        setNewNote(''); setNoteUrgent(false); setNotePhoto(null);
        showToast('Observation added', 'success');
        fetchNotes(profile.id); fetchFamilyVisits(profile.id);
      } else if (res?.status === 503 || !navigator.onLine) {
        if (window.OfflineQueue) {
          await window.OfflineQueue.queueNote(notePayload);
          setNewNote('');
          showToast('Note saved offline — will sync when reconnected', 'success');
        } else { showToast('You\'re offline — try again later', 'error'); }
      } else {
        // v1.103.2 — failures used to fall through SILENTLY (spin → form
        // resets, no explanation). Always say what happened.
        const d = await res?.json().catch(() => ({}));
        showToast(
          res?.status === 413 ? 'That photo is too large — try a smaller one.'
            : (d.error || 'Could not add the observation — please try again.'),
          'error'
        );
      }
    } catch (err) {
      if (!navigator.onLine && window.OfflineQueue) {
        try {
          await window.OfflineQueue.queueNote({ careRecipientId: profile.id, content: newNote.trim(), noteType: 'general' });
          setNewNote('');
          showToast('Note saved offline — will sync when reconnected', 'success');
        } catch { showToast('Failed to add note', 'error'); }
      } else { showToast('Failed to add note', 'error'); }
    }
    setAddingNote(false);
  };

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const response = await apiFetch('/api/care-recipients');
        if (response?.ok) {
          const data = await response.json();
          if (data.careRecipients && data.careRecipients.length > 0) {
            setAllRecipients(data.careRecipients);
            const first = data.careRecipients[0];
            setProfile(first);
            setPermTier(first.permission_tier || 'full');
            try { setVisSettings(first.visibility_settings ? JSON.parse(first.visibility_settings) : null); } catch { setVisSettings(null); }
            try { setCarePrefs(first.care_preferences ? JSON.parse(first.care_preferences) : {}); } catch { setCarePrefs({}); }
            try { setCareDetails(first.care_preference_details ? JSON.parse(first.care_preference_details) : {}); } catch { setCareDetails({}); }
            // v1.58.71: defensive — older versions wrote structured JSON into ai_care_summary.
            // Treat anything that looks like a JSON object ({...with "headline"...) as not-a-summary
            // so we don't render a JSON dump on the profile screen.
            const rawSummary = first.ai_care_summary;
            const looksLikeJSON = typeof rawSummary === 'string'
              && rawSummary.trim().startsWith('{')
              && rawSummary.indexOf('"headline"') !== -1;
            if (rawSummary && !looksLikeJSON) {
              setAiSummary(rawSummary);
              setAiSummaryDate(first.ai_care_summary_updated_at);
            }
            fetchNotes(first.id); fetchFamilyVisits(first.id);
          }
        }
      } catch (error) {
        console.error('Error fetching profile:', error);
      }
      setLoading(false);
    };
    fetchProfile();
  }, []);

  const parseJsonField = (val) => {
    try {
      return typeof val === 'string' ? JSON.parse(val) : val || [];
    } catch { return []; }
  };

  const startEditing = () => {
    const hc = parseJsonField(profile.health_conditions);
    const oc = parseJsonField(profile.observed_concerns);
    const meds = parseJsonField(profile.medications);
    setEditData({
      first_name: profile.first_name || '',
      last_name: profile.last_name || '',
      age: profile.age || '',
      address: profile.location_address || '',
      city: profile.location_city || '',
      state: profile.location_state || '',
      zip: profile.location_zip || '',
      health_conditions: Array.isArray(hc) ? hc.join('\n') : '',
      observed_concerns: Array.isArray(oc) ? oc.join('\n') : '',
      medications: Array.isArray(meds) ? meds.join('\n') : '',
      preferences: profile.preferences || '',
      emergency_contact_name: profile.emergency_contact_name || '',
      emergency_contact_phone: formatPhone(profile.emergency_contact_phone) || '',
    });
    setEditing(true);
    setSaveMsg('');
  };

  const cancelEditing = () => {
    setEditing(false);
    setSaveMsg('');
  };

  const saveProfile = async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      const payload = {
        firstName: editData.first_name,
        lastName: editData.last_name,
        age: parseInt(editData.age) || profile.age,
        address: editData.address || null,
        city: editData.city,
        state: editData.state,
        zip: editData.zip || null,
        healthConditions: editData.health_conditions.split('\n').map(s => s.trim()).filter(Boolean),
        observedConcerns: (editData.observed_concerns || '').split('\n').map(s => s.trim()).filter(Boolean),
        medications: editData.medications.split('\n').map(s => s.trim()).filter(Boolean),
        preferences: editData.preferences,
        emergencyContactName: editData.emergency_contact_name,
        emergencyContactPhone: editData.emergency_contact_phone,
      };
      const response = await apiFetch(`/api/care-recipients/${profile.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      if (response?.ok) {
        const updated = await response.json();
        const refreshed = updated.careRecipient || updated;
        setProfile({ ...profile, ...refreshed,
          first_name: editData.first_name,
          last_name: editData.last_name,
          age: parseInt(editData.age) || profile.age,
          location_address: editData.address,
          location_city: editData.city,
          location_state: editData.state,
          location_zip: editData.zip,
          health_conditions: JSON.stringify(editData.health_conditions.split('\n').map(s => s.trim()).filter(Boolean)),
          observed_concerns: JSON.stringify((editData.observed_concerns || '').split('\n').map(s => s.trim()).filter(Boolean)),
          medications: JSON.stringify(editData.medications.split('\n').map(s => s.trim()).filter(Boolean)),
          preferences: editData.preferences,
          emergency_contact_name: editData.emergency_contact_name,
          emergency_contact_phone: editData.emergency_contact_phone,
        });
        setEditing(false);
        setSaveMsg('Profile saved successfully!');
        showToast('Profile saved successfully!', 'success');
        setTimeout(() => setSaveMsg(''), 3000);
      } else {
        setSaveMsg('Error saving — please try again.');
        showToast('Error saving profile', 'error');
      }
    } catch (err) {
      console.error('Save error:', err);
      setSaveMsg('Error saving — please try again.');
      showToast('Error saving profile', 'error');
    }
    setSaving(false);
  };

  const ed = (field, val) => setEditData({ ...editData, [field]: val });

  const handlePrefRate = (id, value) => {
    const next = { ...carePrefs, [id]: value };
    setCarePrefs(next);
    if (value < 2 && careDetails[id]) {
      const nd = { ...careDetails }; delete nd[id]; setCareDetails(nd);
    }
  };

  const handlePrefDetail = (id, value) => setCareDetails({ ...careDetails, [id]: value });

  const savePreferences = async () => {
    if (!profile?.id) return;
    setSavingPrefs(true);
    try {
      const res = await apiFetch(`/api/care-recipients/${profile.id}/preferences`, {
        method: 'PUT', body: JSON.stringify({ preferences: carePrefs, details: careDetails }),
      });
      if (res?.ok) showToast('Care preferences saved', 'success');
      else showToast('Failed to save preferences', 'error');
    } catch { showToast('Failed to save preferences', 'error'); }
    setSavingPrefs(false);
  };

  const generateAISummary = async () => {
    if (!profile?.id) return;
    setSavingPrefs(true);
    try {
      await apiFetch(`/api/care-recipients/${profile.id}/preferences`, {
        method: 'PUT', body: JSON.stringify({ preferences: carePrefs, details: careDetails }),
      });
    } catch {}
    setSavingPrefs(false);

    setGeneratingAI(true);
    setAiSummary('');
    try {
      const res = await apiFetch(`/api/care-recipients/${profile.id}/generate-summary`, { method: 'POST' });
      if (res?.ok) {
        const data = await res.json();
        setAiSummary(data.summary);
        setAiSummaryDate(data.generatedAt);
        showToast('Care summary generated', 'success');
      } else {
        const d = await res?.json().catch(() => ({}));
        showToast(d.error || 'Failed to generate summary', 'error');
      }
    } catch { showToast('Failed to generate summary', 'error'); }
    setGeneratingAI(false);
  };

  if (loading) return <LoadingSpinner text="Loading care profile..." />;
  if (!profile) return <EmptyState icon="👵" title="No care recipient found" text="Add a care recipient to get started." actionLabel="+ Add Your Loved One" onAction={() => onNavigate && onNavigate('recipients')} />;

  const canEdit = profile.access_level !== 'view';
  const healthConditions = parseJsonField(profile.health_conditions);
  const observedConcerns = parseJsonField(profile.observed_concerns);
  const medications = parseJsonField(profile.medications);

  const inputStyle = { width: '100%', padding: '10px 12px', border: '1px solid #d0d0d0', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' };
  const textareaStyle = { ...inputStyle, minHeight: 80, resize: 'vertical' };
  const fieldLabel = { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' };

  // Build address string
  const addressParts = [profile.location_address, profile.location_city, profile.location_state].filter(Boolean);
  const fullAddress = addressParts.length > 0
    ? (profile.location_address ? profile.location_address + ', ' : '') +
      [profile.location_city, profile.location_state].filter(Boolean).join(', ') +
      (profile.location_zip ? ' ' + profile.location_zip : '')
    : 'No address on file';

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h1 className="page-title">My Loved One</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!editing && onNavigate && (
            <button onClick={() => onNavigate('recipients')} style={{ padding: '8px 14px', background: 'var(--bg-surface)', color: 'var(--role-color)', border: '1.5px solid #1b6b5a', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
              + Add Another Person
            </button>
          )}
          {!editing ? (
            canEdit && <button onClick={startEditing} style={{ padding: '8px 20px', background: 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
              Edit Profile
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={cancelEditing} style={{ padding: '8px 16px', background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid #d0d0d0', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
              <button onClick={saveProfile} disabled={saving} style={{ padding: '8px 20px', background: saving ? 'var(--text-muted)' : 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: saving ? 'wait' : 'pointer' }}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          )}
        </div>
      </div>

      {allRecipients.length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {allRecipients.map(r => (
            <button key={r.id} onClick={() => { setProfile(r); fetchNotes(r.id); fetchFamilyVisits(r.id); setEditing(false); setPermTier(r.permission_tier || 'full'); try { setVisSettings(r.visibility_settings ? JSON.parse(r.visibility_settings) : null); } catch { setVisSettings(null); } }}
              style={{ padding: '6px 14px', borderRadius: 20, border: r.id === profile?.id ? '2px solid #1b6b5a' : '1px solid #d0d0d0', background: r.id === profile?.id ? 'var(--role-color-light)' : 'var(--bg-card)', color: r.id === profile?.id ? 'var(--role-color)' : 'var(--text-secondary)', fontSize: 13, fontWeight: r.id === profile?.id ? 600 : 400, cursor: 'pointer' }}>
              {r.first_name} {r.last_name}
            </button>
          ))}
        </div>
      )}

      {saveMsg && (
        <div style={{ padding: '10px 16px', borderRadius: 8, marginBottom: 16, background: saveMsg.includes('success') ? 'var(--color-success-bg)' : 'var(--color-error-bg)', color: saveMsg.includes('success') ? 'var(--color-success)' : 'var(--color-error)', fontWeight: 500, fontSize: 14 }}>
          {saveMsg}
        </div>
      )}

      {/* ─── 1. Compact Hero Card — Photo, Name, Age, Address, Emergency Contact ─── */}
      {!editing ? (
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <div onClick={handlePhotoUpload} style={{ cursor: 'pointer', position: 'relative', width: 72, height: 72, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'var(--color-success-bg)' }} title="Click to change photo">
              {profile.photo
                ? <img src={profile.photo} alt={profile.first_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ fontSize: 28, fontWeight: 700, color: 'var(--role-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>{profile.first_name?.[0]}{profile.last_name?.[0]}</span>}
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.45)', color: 'var(--text-on-primary)', fontSize: 9, textAlign: 'center', padding: '2px 0', fontWeight: 600 }}>
                {photoUploading ? '...' : '\uD83D\uDCF7'}
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                {profile.first_name} {profile.last_name}
                <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: 8 }}>{profile.age} years old</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ flexShrink: 0 }}>{'\uD83D\uDCCD'}</span>
                <span>{fullAddress}</span>
              </div>
              {profile.emergency_contact_name && (
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ flexShrink: 0 }}>{'\uD83D\uDEA8'}</span>
                  <span>Emergency: {profile.emergency_contact_name}{profile.emergency_contact_phone ? ' \u00B7 ' + formatPhone(profile.emergency_contact_phone) : ''}</span>
                  {profile.emergency_contact_phone && (
                    <a href={'tel:' + profile.emergency_contact_phone.replace(/\D/g, '')}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 12, background: 'var(--color-success-bg)', color: 'var(--role-color)', fontSize: 11, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                      {'\uD83D\uDCDE'} Call
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-header" style={{ marginBottom: 12 }}><span className="card-icon">{'\uD83D\uDC64'}</span>Profile Details</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={fieldLabel}>First Name</div>
              <input style={inputStyle} value={editData.first_name} onChange={(e) => ed('first_name', e.target.value)} placeholder="First name" />
            </div>
            <div>
              <div style={fieldLabel}>Last Name</div>
              <input style={inputStyle} value={editData.last_name} onChange={(e) => ed('last_name', e.target.value)} placeholder="Last name" />
            </div>
            <div>
              <div style={fieldLabel}>Age</div>
              <input type="number" style={inputStyle} value={editData.age} onChange={(e) => ed('age', e.target.value)} />
            </div>
            <div>
              <div style={fieldLabel}>Street Address</div>
              <AddressAutocomplete style={inputStyle} value={editData.address}
                onChange={(v) => ed('address', v)}
                onSelect={(s) => setEditData(prev => ({ ...prev, address: s.line1, city: s.city || prev.city, state: s.state || prev.state, zip: s.zip || prev.zip }))}
                placeholder="Start typing — e.g. 123 Main Street" />
            </div>
            <div>
              <div style={fieldLabel}>City</div>
              <input style={inputStyle} value={editData.city} onChange={(e) => ed('city', e.target.value)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <div style={fieldLabel}>State</div>
                <input style={inputStyle} value={editData.state} onChange={(e) => ed('state', e.target.value)} />
              </div>
              <div>
                <div style={fieldLabel}>ZIP</div>
                <input style={inputStyle} value={editData.zip} onChange={(e) => ed('zip', e.target.value)} placeholder="24060" />
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12, paddingTop: 12, borderTop: '1px solid #eee' }}>
            <div>
              <div style={fieldLabel}>Emergency Contact Name</div>
              <input style={inputStyle} value={editData.emergency_contact_name} onChange={(e) => ed('emergency_contact_name', e.target.value)} />
            </div>
            <div>
              <div style={fieldLabel}>Emergency Contact Phone</div>
              <input type="tel" style={inputStyle} value={editData.emergency_contact_phone} onChange={(e) => ed('emergency_contact_phone', formatPhone(e.target.value))} placeholder="(555) 123-4567" />
            </div>
          </div>
        </div>
      )}

      {/* ─── 2. iPAi Care Intelligence (replaces old Care Summary) ─── */}
      {profile && (
        <IPAiInsightsCard recipientId={profile.id} recipientName={profile.first_name} existingSummary={aiSummary} />
      )}

      {/* Old Care Summary section removed — replaced by iPAi Intelligence (section 2 above) */}

      {/* ─── 3. Health Conditions & Medications (combined, compact) ─── */}
      <div className="card">
        <div className="card-header"><span className="card-icon">{'\u2695\uFE0F'}</span>Health & Medications</div>
        {editing ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={{ ...fieldLabel, marginBottom: 8 }}>Diagnosed Conditions (one per line)</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, lineHeight: 1.4 }}>Only formal diagnoses from a doctor. Include the date if you know it.</div>
              <textarea style={textareaStyle} value={editData.health_conditions} onChange={(e) => ed('health_conditions', e.target.value)} placeholder="Type 2 diabetes (diagnosed 2019)&#10;Parkinson's, diagnosed May 2024&#10;..." />
            </div>
            <div>
              <div style={{ ...fieldLabel, marginBottom: 8 }}>Observed Concerns (one per line)</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, lineHeight: 1.4 }}>Things your family sees that worry you {'\u2014'} not diagnoses. iPAi treats these differently.</div>
              <textarea style={textareaStyle} value={editData.observed_concerns || ''} onChange={(e) => ed('observed_concerns', e.target.value)} placeholder="Serious memory issues suggesting dementia&#10;Tends to lose balance on stairs&#10;Trouble hearing lately&#10;..." />
            </div>
            <div>
              <div style={{ ...fieldLabel, marginBottom: 8 }}>Medications (one per line)</div>
              <textarea style={textareaStyle} value={editData.medications} onChange={(e) => ed('medications', e.target.value)} placeholder="Donepezil 10mg daily&#10;Vitamin D 1000IU&#10;..." />
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Diagnosed Conditions</div>
              {healthConditions.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {healthConditions.map((c, i) => (
                    <div key={i} style={{ fontSize: 13, color: 'var(--text-primary)', paddingLeft: 10, borderLeft: '2px solid #1b6b5a' }}>{c}</div>
                  ))}
                </div>
              ) : <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>None listed</span>}
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '12px 0 6px' }}>Observed Concerns</div>
              {observedConcerns.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {observedConcerns.map((c, i) => (
                    <div key={i} style={{ fontSize: 13, color: 'var(--text-primary)', paddingLeft: 10, borderLeft: '2px solid #e8a13a' }}>{c}</div>
                  ))}
                </div>
              ) : <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>None listed {'\u2014'} things your family sees that worry you (not diagnoses)</span>}
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Medications</div>
              {medications.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {medications.map((m, i) => (
                    <div key={i} style={{ fontSize: 13, color: 'var(--text-primary)', paddingLeft: 10, borderLeft: '2px solid #e8724a' }}>{m}</div>
                  ))}
                </div>
              ) : <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>None listed</span>}
            </div>
          </div>
        )}
        {!editing && canEdit && profile && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #f0f0f0' }}>
            <div onClick={() => { setDoctorReportOpen(!doctorReportOpen); setDoctorReport(''); }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', padding: '6px 0' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--role-color)' }}>
                {'\uD83E\uDE7A'} AI Report for {profile.first_name}'s Doctor
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', transform: doctorReportOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>{'\u25BC'}</span>
            </div>
            {doctorReportOpen && (
              <div style={{ marginTop: 8, padding: 12, background: 'var(--bg-highlight)', borderRadius: 10, border: '1px solid #e0ebe7' }}>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 10px', lineHeight: 1.5 }}>
                  Generate an AI-powered report tailored for a specific medical appointment.
                  InPlace analyzes {profile.first_name}'s care notes, visit logs, and health data to surface what's relevant for the specialist.
                </p>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>Type of Appointment *</label>
                  <input value={doctorApptType} onChange={e => setDoctorApptType(e.target.value)}
                    placeholder="e.g. Podiatrist, Neurologist, Primary Care, Urologist..."
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13, boxSizing: 'border-box' }} />
                </div>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>Appointment Details (optional)</label>
                  <textarea value={doctorApptDetails} onChange={e => setDoctorApptDetails(e.target.value)}
                    placeholder="Purpose of visit, specific concerns, questions you want addressed..."
                    rows={3}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />
                </div>
                <button onClick={handleGenerateDoctorReport} disabled={doctorReportLoading}
                  style={{
                    width: '100%', padding: '10px 16px', borderRadius: 8,
                    border: 'none', background: doctorReportLoading ? '#a0c4b8' : 'var(--role-color)',
                    color: 'var(--text-on-primary)', fontWeight: 700, fontSize: 13, cursor: doctorReportLoading ? 'wait' : 'pointer',
                    transition: 'background 0.2s',
                  }}>
                  {doctorReportLoading ? 'Analyzing care data...' : 'Generate Draft Report'}
                </button>
                {doctorQuestions.length > 0 && !doctorReport && (
                  <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid #c5d9d2' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--role-color)', marginBottom: 4 }}>
                      Quick questions before drafting
                    </div>
                    <p style={{ fontSize: 11.5, color: 'var(--text-secondary)', margin: '0 0 10px', lineHeight: 1.5 }}>
                      Your notes capture incidents, not routines {'—'} iPAi wants to fill a few gaps so the report doesn't guess. Answer what you can; leave blank to skip. Your answers are saved to {profile.first_name}'s observations.
                    </p>
                    {doctorQuestions.map((q, i) => (
                      <div key={i} style={{ marginBottom: 10 }}>
                        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: 4, lineHeight: 1.4 }}>{q}</label>
                        <input value={doctorAnswers[i] || ''} onChange={e => setDoctorAnswers({ ...doctorAnswers, [i]: e.target.value })}
                          placeholder="Your answer (optional)"
                          style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13, boxSizing: 'border-box' }} />
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={handleAnswersToDraft} disabled={doctorReportLoading}
                        style={{ flex: 1, padding: '9px 14px', borderRadius: 8, border: 'none', background: 'var(--role-color)', color: 'var(--text-on-primary)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                        Continue to Draft
                      </button>
                      <button onClick={() => runDoctorReportDraft([])} disabled={doctorReportLoading}
                        style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid #ddd', background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                        Skip
                      </button>
                    </div>
                  </div>
                )}
                {doctorReport && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Draft Report {'\u2014'} review and edit before sending</span>
                      {/* v1.105.69 — the toast fired one line after an unawaited write that
                          throws synchronously where clipboard is undefined. It claimed the
                          doctor report was copied whether or not it was. */}
                      <button onClick={async () => {
                        const ok = await copyText(doctorReport);
                        if (typeof showToast === 'function') {
                          showToast(ok ? 'Report copied to clipboard' : 'Could not copy — select the text and copy it manually', ok ? 'success' : 'error');
                        }
                      }}
                        style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid #ddd', background: 'var(--bg-surface)', fontSize: 11, cursor: 'pointer', color: 'var(--text-secondary)' }}>
                        Copy
                      </button>
                    </div>
                    <p style={{ fontSize: 11.5, color: 'var(--text-secondary)', margin: '0 0 6px', lineHeight: 1.5 }}>
                      iPAi drafted this from your family's notes {'\u2014'} it can get things wrong. Read it the way the doctor will, fix anything that isn't right (tap into the text to edit), and only then send it.
                    </p>
                    <textarea value={doctorReport} onChange={e => { setDoctorReport(e.target.value); setDoctorEmailSent(false); }}
                      rows={16}
                      style={{
                        width: '100%', padding: 14, background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid #e0e0e0',
                        fontSize: 13, lineHeight: 1.7, color: 'var(--text-primary)', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit',
                      }} />
                    <div style={{ marginTop: 10 }}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>Doctor's Email</label>
                      <input value={doctorEmail} onChange={e => setDoctorEmail(e.target.value)}
                        placeholder="doctor@clinic.com"
                        type="email"
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13, boxSizing: 'border-box' }} />
                    </div>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 10, cursor: 'pointer' }}>
                      <input type="checkbox" checked={doctorReportAck} onChange={e => setDoctorReportAck(e.target.checked)}
                        style={{ marginTop: 2, width: 16, height: 16, flexShrink: 0, accentColor: '#1b6b5a' }} />
                      <span style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                        I've reviewed this report and it's accurate. I understand it was drafted with iPAi from my family's notes, and that I'm responsible for the health information I'm sending.
                      </span>
                    </label>
                    <button onClick={handleSendDoctorReport}
                      disabled={doctorReportSending || !doctorReportAck || !doctorEmail.trim()}
                      style={{
                        width: '100%', marginTop: 10, padding: '10px 16px', borderRadius: 8, border: 'none',
                        background: (doctorReportSending || !doctorReportAck || !doctorEmail.trim()) ? '#a0c4b8' : 'var(--role-color)',
                        color: 'var(--text-on-primary)', fontWeight: 700, fontSize: 13,
                        cursor: doctorReportSending ? 'wait' : (!doctorReportAck || !doctorEmail.trim()) ? 'not-allowed' : 'pointer',
                        transition: 'background 0.2s',
                      }}>
                      {doctorReportSending ? 'Sending...' : 'Email Report to Doctor'}
                    </button>
                    {doctorEmailSent && (
                      <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--color-success-bg)', borderRadius: 6, fontSize: 12, color: 'var(--color-success)' }}>
                        {'\u2709\uFE0F'} Report emailed to {doctorEmail.trim()}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── 4. Care Preferences (collapsible) ─── */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
          onClick={() => setPrefsExpanded(!prefsExpanded)}>
          <div className="card-header" style={{ margin: 0 }}>
            <span className="card-icon">{'\u2728'}</span>Care Preferences
            {Object.keys(carePrefs).length > 0 && (
              <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 600, color: 'var(--role-color)', background: 'var(--color-success-bg)', padding: '2px 8px', borderRadius: 10 }}>
                {Object.keys(carePrefs).length}/{CARE_PREFS_LIST.length} rated
              </span>
            )}
          </div>
          <span style={{ fontSize: 18, color: 'var(--text-muted)', transition: 'transform 0.2s', transform: prefsExpanded ? 'rotate(180deg)' : 'rotate(0)' }}>{'\u25BC'}</span>
        </div>

        {prefsExpanded && (
          <div style={{ marginTop: 16 }}>
            <div style={{ background: 'var(--color-warning-bg)', border: '2px solid #e8724a', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 20, flexShrink: 0 }}>{'\u2695\uFE0F'}</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#bf360c', marginBottom: 2 }}>InPlace is not a medical service</div>
                <div style={{ fontSize: 12, color: '#5d4037', lineHeight: 1.5 }}>Our caregivers provide companion care and daily living assistance. They do not diagnose, treat, administer medication, or perform medical procedures.</div>
              </div>
            </div>

            <p style={{ fontSize: 13, color: 'var(--text-tertiary)', margin: '0 0 12px' }}>
              Rate what matters for {profile.first_name}'s care. For important items, add details to help match the right caregiver. You can update these anytime.
            </p>

            <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
              {RATING_OPTIONS.map(r => (
                <div key={r.value} style={{ padding: '3px 8px', borderRadius: 5, fontSize: 11, fontWeight: 600, background: r.color, color: r.textColor, border: '1px solid #ddd' }}>{r.label}</div>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(showAllPrefs ? CARE_PREFS_LIST : CARE_PREFS_LIST.slice(0, 10)).map(pref => {
                const val = carePrefs[pref.id] || 0;
                const hasFollowUp = PREF_FOLLOW_UPS[pref.id];
                const showDetail = hasFollowUp && val >= 2;
                return (
                  <div key={pref.id} style={{ borderRadius: 8, background: val > 0 ? RATING_OPTIONS[val].color + '40' : 'var(--bg-primary)', border: '1px solid ' + (val > 0 ? RATING_OPTIONS[val].color : 'var(--border-light)'), transition: 'all 0.2s', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 18, width: 24, textAlign: 'center', flexShrink: 0 }}>{pref.icon}</span>
                      <div style={{ flex: '1 1 140px', minWidth: 0, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.3 }}>{pref.label}</div>
                      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                        {RATING_OPTIONS.map(r => (
                          <button key={r.value} onClick={() => handlePrefRate(pref.id, r.value)} style={{
                            padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
                            border: val === r.value ? '2px solid #1b6b5a' : '1px solid #ddd',
                            background: val === r.value ? r.color : 'var(--bg-card)',
                            color: val === r.value ? r.textColor : 'var(--text-muted)',
                            cursor: 'pointer', transition: 'all 0.15s',
                          }}>{r.label}</button>
                        ))}
                      </div>
                    </div>
                    {showDetail && (
                      <div style={{ padding: '0 12px 10px 46px' }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--role-color)', marginBottom: 3 }}>
                          {hasFollowUp} <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span>
                        </div>
                        <input type="text" value={careDetails[pref.id] || ''} onChange={(e) => handlePrefDetail(pref.id, e.target.value)}
                          placeholder="Add details..."
                          style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #ccc', fontSize: 12, color: 'var(--text-primary)', boxSizing: 'border-box', fontFamily: 'inherit' }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {!showAllPrefs && (
              <button onClick={() => setShowAllPrefs(true)} style={{
                width: '100%', padding: '10px', marginTop: 8, borderRadius: 8,
                border: '1px dashed #ccc', background: 'var(--bg-primary)', color: 'var(--text-secondary)',
                fontWeight: 600, fontSize: 13, cursor: 'pointer',
              }}>Show {CARE_PREFS_LIST.length - 10} more preferences</button>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              <button onClick={savePreferences} disabled={savingPrefs} style={{
                padding: '10px 20px', borderRadius: 8, border: '1px solid #1b6b5a',
                background: 'var(--bg-surface)', color: 'var(--role-color)', fontWeight: 600, fontSize: 13,
                cursor: savingPrefs ? 'wait' : 'pointer',
              }}>{savingPrefs ? 'Saving...' : 'Save Preferences'}</button>
              <button onClick={generateAISummary} disabled={generatingAI || Object.values(carePrefs).filter(v => v > 0).length < 3} style={{
                padding: '10px 20px', borderRadius: 8, border: 'none',
                background: Object.values(carePrefs).filter(v => v > 0).length >= 3 ? 'var(--role-color)' : 'var(--border-light)',
                color: 'var(--text-on-primary)', fontWeight: 600, fontSize: 13,
                cursor: (generatingAI || Object.values(carePrefs).filter(v => v > 0).length < 3) ? 'default' : 'pointer',
              }}>{generatingAI ? 'Generating...' : '\u2728 Generate Care Summary with inPlace\'s AI tool'}</button>
            </div>
          </div>
        )}
      </div>

      {/* ─── Care Tasks (v1.99.0): recurring med/care tracking definitions.
           Completing tasks happens on the dashboard's Next Up — this card is
           for setting them up: what, when, how often, whose job. ─── */}
      {profile?.id && <CareTasksSection recipientId={profile.id} recipientFirstName={profile.first_name} />}
      {profile?.id && <CareEventsSection recipientId={profile.id} recipientFirstName={profile.first_name} />}

      {/* ─── 5. Care Notes (collapsible) ─── */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
          onClick={() => setNotesOpen(!notesOpen)}>
          <div className="card-header" style={{ margin: 0 }}>
            <span className="card-icon">{'\uD83D\uDCDD'}</span>Observations & Notes
            {notes.length > 0 && (
              <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 600, color: 'var(--role-color)', background: '#E8F8F0', padding: '2px 8px', borderRadius: 10 }}>
                {notes.length}
              </span>
            )}
          </div>
          <span style={{ fontSize: 18, color: 'var(--text-muted)', transition: 'transform 0.2s', transform: notesOpen ? 'rotate(180deg)' : 'rotate(0)' }}>{'\u25BC'}</span>
        </div>
        {notesOpen && (
          <div style={{ marginTop: 14 }}>
            <div style={{ marginBottom: notes.length > 0 ? 12 : 0 }}>
              <textarea value={newNote} onChange={(e) => setNewNote(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                placeholder="What did you notice? e.g. 'Had dinner with Mom — ate a lot, couldn't remember if she'd eaten today. Toenails need clipping, one toe might be hurt. Good mood, repeated the same story a few times.'"
                rows={4}
                style={{ width: '100%', minHeight: 80, padding: '10px 12px', border: '1px solid #d0d0d0', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', marginBottom: 8 }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && newNote.trim()) { e.preventDefault(); handleAddNote(); } }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
                <button onClick={(e) => { e.stopPropagation(); handleAddNote(); }} disabled={addingNote || !newNote.trim()}
                  style={{ padding: '10px 20px', background: addingNote ? 'var(--text-muted)' : 'var(--role-color)', color: 'var(--text-on-primary)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: addingNote ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>
                  {addingNote ? '...' : 'Add Observation'}
                </button>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={noteUrgent} onChange={(e) => setNoteUrgent(e.target.checked)} style={{ accentColor: '#e65100' }} />
                  Needs attention
                </label>
                <label style={{ fontSize: 13, color: notePhoto ? 'var(--role-color)' : 'var(--text-secondary)', cursor: 'pointer' }}>
                  {notePhoto ? '\uD83D\uDCCE ' + notePhoto.name + ' \u2715' : '\uD83D\uDCF7 Add photo'}
                  {/* v1.103.3 — no capture attr: it forced the camera. Without it,
                      iOS offers Photo Library / Take Photo / Choose File. */}
                  <input type="file" accept="image/*" style={{ display: 'none' }}
                    onClick={(e) => { if (notePhoto) { e.preventDefault(); setNotePhoto(null); } }}
                    onChange={(e) => {
                      const file = e.target.files && e.target.files[0];
                      e.target.value = '';
                      if (!file || !file.type.startsWith('image/')) return;
                      const img = new Image();
                      const url = URL.createObjectURL(file);
                      img.onload = () => {
                        URL.revokeObjectURL(url);
                        const MAX = 1600;
                        let { width, height } = img;
                        if (width > MAX || height > MAX) { const sc = MAX / Math.max(width, height); width = Math.round(width * sc); height = Math.round(height * sc); }
                        const canvas = document.createElement('canvas');
                        canvas.width = width; canvas.height = height;
                        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                        setNotePhoto({ data: canvas.toDataURL('image/jpeg', 0.85), name: (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg' });
                      };
                      img.onerror = () => URL.revokeObjectURL(url);
                      img.src = url;
                    }} />
                </label>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Visible to your care team {'\u00B7'} iPAi files it into their care picture</span>
              </div>
            </div>
            {/* v1.105.38 — family visits, interleaved but never blended. The label is the
                point: a doctor report that implies a nurse observed something a son did is
                the derivation-chain failure from the v1.93 post-mortem. Source is always
                visible, here and everywhere downstream. */}
            {familyVisits.map((v) => (
              <div key={v.id} style={{ padding: '10px 0', borderBottom: '1px solid #f0f0f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span style={{ fontSize: 13, fontWeight: 650 }}>{v.authorFirstName || v.authorName}</span>
                  <span style={{ fontSize: 10, fontWeight: 750, color: 'var(--role-color)', background: '#E8F8F0', padding: '1.5px 7px', borderRadius: 9 }}>FAMILY VISIT</span>
                </div>
                {v.summary && (
                  <div style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{v.summary}</div>
                )}
                {Array.isArray(v.activities) && v.activities.length > 0 && (
                  <div style={{ marginTop: 5, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {v.activities.map((a) => {
                      const found = (typeof VISIT_ACTIVITIES !== 'undefined' ? VISIT_ACTIVITIES : []).find((x) => x.id === a);
                      return <span key={a} style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--role-color)', background: '#E8F8F0', padding: '2px 8px', borderRadius: 10 }}>{found ? found.label : a}</span>;
                    })}
                  </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  {TimezoneHelper.formatTimestamp(v.visitedAt, profile?.timezone, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) || ''}
                </div>
              </div>
            ))}
            {notes.length > 0 ? notes.map((n) => (
              <div key={n.id} style={{ padding: '10px 0', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  {!!n.needs_attention && (
                    <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, color: '#e65100', background: '#fff3e0', padding: '2px 8px', borderRadius: 10, marginBottom: 4 }}>{'\u26A0'} Needs attention</span>
                  )}
                  <div style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{n.content}</div>
                  {Array.isArray(n.categories) && n.categories.length > 0 && (
                    <div style={{ marginTop: 5, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {n.categories.map((c) => (
                        <span key={c} style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--role-color)', background: '#E8F8F0', padding: '2px 8px', borderRadius: 10, textTransform: 'capitalize' }}>{c}</span>
                      ))}
                    </div>
                  )}
                  {n.ai_highlights && Array.isArray(n.ai_highlights.actionables) && n.ai_highlights.actionables.length > 0 && (
                    <div style={{ marginTop: 5, fontSize: 12, color: 'var(--text-secondary)' }}>
                      {n.ai_highlights.actionables.map((a, i) => (<div key={i}>{'\u2192'} {a}</div>))}
                    </div>
                  )}
                  {/* v1.105.34 \u2014 the photo itself, not a link to it. Same
                      unauthenticated-navigation bug as the reimbursement receipts (see
                      AttachmentViewer.js): `target="_blank"` in the native app hands the URL
                      to the system browser, which has no session, so a caregiver's photo
                      rendered as "Authentication required". */}
                  {!!n.has_photo && (
                    <div style={{ marginTop: 6 }}>
                      <AttachmentThumb size={64}
                        attachment={{ path: `/api/notes/${n.id}/photo`, name: 'Care note photo', mime: '' }}
                        onOpen={() => setViewingAttachments({
                          list: [{ path: `/api/notes/${n.id}/photo`, name: 'Care note photo', mime: '' }], index: 0,
                        })} />
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    {n.author_first_name} {n.author_last_name}
                    {' \u00B7 '}{TimezoneHelper.formatTimestamp(n.created_at, profile?.timezone, { month: 'short', day: 'numeric', year: 'numeric' }) || (new Date()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                </div>
                {canEdit && (
                  <button onClick={async (e) => {
                    e.stopPropagation();
                    if (!confirm('Delete this note?')) return;
                    const res = await apiFetch(`/api/notes/${n.id}`, { method: 'DELETE' });
                    if (res?.ok) fetchNotes(profile.id); fetchFamilyVisits(profile.id);
                  }} style={{ padding: '3px 8px', background: 'none', border: '1px solid #fdd', borderRadius: 4, cursor: 'pointer', fontSize: 11, color: 'var(--color-red-strong)', whiteSpace: 'nowrap', flexShrink: 0 }}>Delete</button>
                )}
              </div>
            )) : (
              <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '8px 0 0' }}>No notes yet. Add one to share care observations with your team.</p>
            )}
          </div>
        )}
      </div>

      {/* ─── 5b. Kindred Panel ─── */}
      {canEdit && (
        <div className="card" style={{ overflow: 'visible', position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
            onClick={() => companionOpen ? setCompanionOpen(false) : handleCompanionOpen()}>
            <div className="card-header" style={{ margin: 0 }}>
              <span className="card-icon">{'\uD83C\uDFA4'}</span>Kindred
              {companionConvos.length > 0 && (
                <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 600, color: 'var(--color-info)', background: 'var(--color-info-bg)', padding: '2px 8px', borderRadius: 10 }}>
                  {companionConvos.length} conversation{companionConvos.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <span style={{ fontSize: 18, color: 'var(--text-muted)', transition: 'transform 0.2s', transform: companionOpen ? 'rotate(180deg)' : 'rotate(0)' }}>{'\u25BC'}</span>
          </div>

          {companionOpen && (
            <div style={{ marginTop: 16 }}>
              {/* Tabs — horizontally scrollable on mobile */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 16, padding: 4, background: 'var(--bg-elevated)', borderRadius: 10, overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                {[
                  { id: 'reminders', label: '\u23F0 Reminders' },
                  { id: 'conversations', label: '\uD83D\uDCAC Conversations' },
                  { id: 'voice-routing', label: '\uD83D\uDD0A Routing' },
                  { id: 'voice-settings', label: '\uD83C\uDF9B\uFE0F Settings' },
                  { id: 'usage', label: '\uD83D\uDCCA Usage' },
                ].map(tab => (
                  <button key={tab.id} onClick={(e) => { e.stopPropagation(); setCompanionTab(tab.id); }}
                    style={{
                      flex: '0 0 auto', padding: '8px 14px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      background: companionTab === tab.id ? 'var(--bg-card)' : 'transparent',
                      color: companionTab === tab.id ? 'var(--color-info)' : 'var(--text-tertiary)',
                      boxShadow: companionTab === tab.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                      transition: 'all 0.2s',
                    }}>
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* ── Reminders Tab ── */}
              {companionTab === 'reminders' && (
                <div>
                  {/* Header + buttons */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-info)' }}>
                      {'\u23F0'} Scheduled Reminders
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          const res = await apiFetch('/api/kindred/reminders/sync-calendar', { method: 'POST', body: JSON.stringify({ care_recipient_id: profile.id }) });
                          if (res?.ok) {
                            const data = await res.json();
                            if (typeof showToast === 'function') showToast(data.created > 0 ? `${data.created} reminder${data.created > 1 ? 's' : ''} added from calendar` : 'Calendar is up to date', 'success');
                            fetchKindredReminders(profile.id);
                          }
                        } catch {}
                      }} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border-teal-light)', background: 'var(--bg-surface)', color: 'var(--color-info)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                        {'\uD83D\uDCC5'} Sync
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); setShowAddReminder(!showAddReminder); }}
                        style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: showAddReminder ? '#E8EEF2' : 'var(--color-info)', color: showAddReminder ? 'var(--text-secondary)' : 'var(--bg-card)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                        {showAddReminder ? 'Cancel' : '+ Add'}
                      </button>
                    </div>
                  </div>

                  {/* Add Reminder Form */}
                  {showAddReminder && (
                    <div style={{ padding: 16, background: 'var(--bg-highlight)', borderRadius: 12, marginBottom: 16, border: '1px solid var(--border-teal-light)' }}>
                      <div style={{ marginBottom: 12 }}>
                        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Label (optional)</label>
                        <input type="text" value={newReminderLabel} onChange={(e) => setNewReminderLabel(e.target.value)} onClick={(e) => e.stopPropagation()}
                          placeholder="e.g., Morning medication, Physical therapy"
                          style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-teal-light)', fontSize: 13, outline: 'none' }} />
                      </div>
                      <div style={{ marginBottom: 12 }}>
                        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Reminder message *</label>
                        <textarea value={newReminderText} onChange={(e) => setNewReminderText(e.target.value)} onClick={(e) => e.stopPropagation()}
                          placeholder="What should Kindred say? e.g., Time to take your morning pills!"
                          style={{ width: '100%', minHeight: 60, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-teal-light)', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', outline: 'none' }} />
                      </div>
                      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                        <div style={{ flex: 1 }}>
                          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Time</label>
                          <input type="time" value={newReminderTime} onChange={(e) => setNewReminderTime(e.target.value)} onClick={(e) => e.stopPropagation()}
                            style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-teal-light)', fontSize: 13, outline: 'none' }} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Repeats</label>
                          <select value={newReminderRecurrence} onChange={(e) => setNewReminderRecurrence(e.target.value)} onClick={(e) => e.stopPropagation()}
                            style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-teal-light)', fontSize: 13, outline: 'none', background: 'var(--bg-surface)' }}>
                            <option value="none">One-time</option>
                            <option value="daily">Daily</option>
                            <option value="weekdays">Weekdays</option>
                            <option value="weekends">Weekends</option>
                            <option value="custom">Custom days</option>
                          </select>
                        </div>
                      </div>
                      {newReminderRecurrence === 'custom' && (
                        <div style={{ marginBottom: 12 }}>
                          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Select days</label>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {[{ key: 'mon', label: 'M' }, { key: 'tue', label: 'T' }, { key: 'wed', label: 'W' }, { key: 'thu', label: 'T' }, { key: 'fri', label: 'F' }, { key: 'sat', label: 'S' }, { key: 'sun', label: 'S' }].map(d => {
                              const days = newReminderDays.split(',').filter(Boolean);
                              const active = days.includes(d.key);
                              return React.createElement('button', {
                                key: d.key,
                                onClick: (e) => {
                                  e.stopPropagation();
                                  const updated = active ? days.filter(x => x !== d.key) : [...days, d.key];
                                  setNewReminderDays(updated.join(','));
                                },
                                style: {
                                  width: 36, height: 36, borderRadius: '50%', border: active ? '2px solid #1A5276' : '1px solid #ccc',
                                  background: active ? 'var(--color-info)' : 'var(--bg-card)', color: active ? 'var(--bg-card)' : 'var(--text-secondary)',
                                  fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }
                              }, d.label);
                            })}
                          </div>
                        </div>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); handleSaveReminder(); }} disabled={savingReminder || !newReminderText.trim()}
                        style={{ width: '100%', padding: '10px 16px', borderRadius: 8, border: 'none', background: newReminderText.trim() ? 'var(--color-info)' : 'var(--border-light)', color: 'var(--text-on-primary)', fontSize: 14, fontWeight: 600, cursor: newReminderText.trim() ? 'pointer' : 'not-allowed' }}>
                        {savingReminder ? 'Saving...' : 'Save Reminder'}
                      </button>
                    </div>
                  )}

                  {/* Reminders list */}
                  {remindersLoading ? (
                    <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>Loading reminders...</div>
                  ) : kindredReminders.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '30px 20px', background: '#F8F9FA', borderRadius: 12 }}>
                      <div style={{ fontSize: 32, marginBottom: 8 }}>{'\u23F0'}</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>No reminders yet</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                        Set up voice reminders for {profile?.first_name || 'your loved one'}. Kindred will call at the scheduled time to deliver the message in a familiar voice.
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {kindredReminders.map(r => {
                        const recLabel = r.recurrence === 'daily' ? 'Daily' : r.recurrence === 'weekdays' ? 'Weekdays' : r.recurrence === 'weekends' ? 'Weekends' : r.recurrence === 'custom' ? `Custom (${(r.recurrence_days || '').split(',').map(d => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(', ')})` : 'One-time';
                        const timeStr = r.recurrence_time || (r.scheduled_for ? new Date(r.scheduled_for).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '');
                        const isPending = r.status === 'pending';
                        const isDelivered = r.status === 'delivered';
                        return React.createElement('div', {
                          key: r.id,
                          style: {
                            padding: '12px 14px', background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid #E8EEF2',
                            opacity: isDelivered && r.recurrence === 'none' ? 0.6 : 1,
                          }
                        },
                          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } },
                            React.createElement('div', { style: { flex: 1 } },
                              r.label && React.createElement('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--color-info)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 } }, r.label),
                              React.createElement('div', { style: { fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.4, marginBottom: 4 } }, r.message_text),
                              React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
                                React.createElement('span', { style: { fontSize: 11, color: 'var(--text-tertiary)', background: '#F0F0F0', padding: '2px 8px', borderRadius: 6 } }, timeStr),
                                React.createElement('span', { style: { fontSize: 11, color: 'var(--text-tertiary)', background: '#F0F0F0', padding: '2px 8px', borderRadius: 6 } }, recLabel),
                                isPending && React.createElement('span', { style: { fontSize: 11, color: '#27AE60', fontWeight: 600 } }, '\u2022 Active'),
                                isDelivered && r.recurrence === 'none' && React.createElement('span', { style: { fontSize: 11, color: 'var(--text-muted)' } }, '\u2713 Delivered'),
                                r.source === 'calendar' && React.createElement('span', { style: { fontSize: 11, color: '#8E44AD', background: '#F4ECF7', padding: '2px 8px', borderRadius: 6 } }, '\uD83D\uDCC5 Auto'),
                              ),
                            ),
                            React.createElement('button', {
                              onClick: (e) => { e.stopPropagation(); handleDeleteReminder(r.id); },
                              style: { padding: '4px 8px', borderRadius: 6, border: 'none', background: 'transparent', color: '#E74C3C', fontSize: 16, cursor: 'pointer', marginLeft: 8 },
                              title: 'Delete reminder',
                            }, '\u00D7'),
                          ),
                        );
                      })}
                    </div>
                  )}

                  {/* Info note */}
                  <div style={{ marginTop: 16, padding: '10px 14px', background: 'var(--color-warning-bg)', borderRadius: 8, fontSize: 12, color: '#8D6E08', lineHeight: 1.5 }}>
                    {'\uD83D\uDCA1'} Reminders are delivered as voice calls via Kindred. {profile?.first_name || 'Your loved one'} will hear the message in a familiar voice at the scheduled time.
                  </div>
                </div>
              )}

              {/* ── Conversations Tab ── */}
              {companionTab === 'conversations' && (
                <div>
                  {/* ── Abuse Alert Banner (top priority) ── */}
                  {kindredSummary?.abuse_flags?.length > 0 && (
                    <div style={{ padding: '12px 16px', background: '#FDEDEC', border: '2px solid #E74C3C', borderRadius: 10, marginBottom: 16 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#C0392B', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {'\u26A0\uFE0F'} Safety Alert
                      </div>
                      {kindredSummary.abuse_flags.map((flag, i) => (
                        <div key={i} style={{ fontSize: 13, color: '#922B21', lineHeight: 1.5, padding: '4px 0' }}>
                          {'\u2022'} {flag}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ── Care Team Instructions for Kindred ── */}
                  <div style={{ marginBottom: 16, padding: '14px 16px', background: 'var(--color-warning-bg)', border: '1px solid #FFE082', borderRadius: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#F57F17', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {'\uD83D\uDCDD'} Guidance for Kindred
                      </div>
                      {instructionsMeta.updated_at && (
                        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                          {instructionsMeta.updated_by_name ? `${instructionsMeta.updated_by_name} \u2022 ` : ''}
                          {TimezoneHelper.formatTimestamp(instructionsMeta.updated_at, profile?.timezone, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: 12, color: '#8D6E08', marginBottom: 8, lineHeight: 1.4 }}>
                      Tell Kindred what's happening today. It will adapt how it talks to {profile?.first_name || 'your loved one'}.
                    </p>
                    <textarea
                      value={kindredInstructionsDraft}
                      onChange={(e) => setKindredInstructionsDraft(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      placeholder={`e.g., "${profile?.first_name || 'Betty'}'s best friend went to the hospital last night and she's emotionally fragile today. Check in with her more often, but leave her alone if she doesn't want to talk."`}
                      maxLength={2000}
                      style={{
                        width: '100%', minHeight: 80, padding: '10px 12px', border: '1px solid #FFE082', borderRadius: 8,
                        fontSize: 13, fontFamily: 'inherit', resize: 'vertical', background: 'var(--color-warning-bg)',
                        color: 'var(--text-primary)', lineHeight: 1.5, outline: 'none',
                      }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {kindredInstructionsDraft.length}/2000
                      </span>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {kindredInstructionsDraft !== kindredInstructions && (
                          <button onClick={(e) => { e.stopPropagation(); setKindredInstructionsDraft(kindredInstructions); }}
                            style={{ padding: '4px 12px', border: '1px solid #ddd', borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer' }}>
                            Cancel
                          </button>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); saveKindredInstructions(); }}
                          disabled={savingInstructions || kindredInstructionsDraft === kindredInstructions}
                          style={{
                            padding: '4px 14px', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: savingInstructions || kindredInstructionsDraft === kindredInstructions ? 'default' : 'pointer',
                            background: kindredInstructionsDraft !== kindredInstructions ? '#F57F17' : '#E0E0E0',
                            color: kindredInstructionsDraft !== kindredInstructions ? 'var(--text-on-primary)' : 'var(--text-muted)',
                            transition: 'all 0.2s',
                          }}>
                          {savingInstructions ? 'Saving...' : 'Update'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* ── AI Care Summary ── */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-navy)' }}>Care Intelligence</div>
                      <button onClick={(e) => { e.stopPropagation(); fetchKindredSummary(profile?.id); }}
                        disabled={summaryLoading}
                        style={{ padding: '4px 12px', border: '1px solid #E8EEF2', borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--color-info)', fontSize: 11, fontWeight: 600, cursor: summaryLoading ? 'wait' : 'pointer' }}>
                        {summaryLoading ? 'Analyzing...' : '\u21BB Refresh Summary'}
                      </button>
                    </div>

                    {summaryLoading && !kindredSummary ? (
                      <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Analyzing conversations...</div>
                    ) : !kindredSummary || kindredSummary.message === 'No conversations to summarize' ? (
                      <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', background: 'var(--bg-primary)', borderRadius: 10 }}>
                        <div style={{ fontSize: 32, marginBottom: 8 }}>{'\uD83C\uDFA4'}</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>No conversations yet</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>When {profile?.first_name} talks to Kindred, care insights will appear here.</div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {/* Mood + summary card */}
                        <div style={{ padding: '14px 16px', background: '#F8FFFE', border: '1px solid #D5F5E3', borderRadius: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <span style={{ fontSize: 16 }}>
                              {kindredSummary.mood_trend === 'positive' ? '\uD83D\uDE0A' : kindredSummary.mood_trend === 'concerning' ? '\uD83D\uDE1F' : kindredSummary.mood_trend === 'declining' ? '\uD83D\uDE14' : '\uD83D\uDE10'}
                            </span>
                            <span style={{ fontSize: 12, fontWeight: 600, color: kindredSummary.mood_trend === 'positive' ? '#27AE60' : kindredSummary.mood_trend === 'concerning' ? '#E74C3C' : kindredSummary.mood_trend === 'declining' ? '#E67E22' : 'var(--text-tertiary)', textTransform: 'capitalize' }}>
                              {kindredSummary.mood_trend} mood
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                              {kindredSummary.message_count} messages analyzed
                            </span>
                          </div>
                          <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6 }}>{kindredSummary.summary}</div>
                        </div>

                        {/* Medical alerts */}
                        {kindredSummary.medical_alerts?.length > 0 && (
                          <div style={{ padding: '12px 16px', background: '#FEF9E7', border: '1px solid #F9E79F', borderRadius: 10 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: '#7D6608', marginBottom: 6 }}>{'\uD83C\uDFE5'} Medical Alerts</div>
                            {kindredSummary.medical_alerts.map((alert, i) => (
                              <div key={i} style={{ fontSize: 13, color: '#7D6608', lineHeight: 1.5, padding: '3px 0' }}>
                                {'\u2022'} {alert}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Care insights */}
                        {kindredSummary.care_insights?.length > 0 && (
                          <div style={{ padding: '12px 16px', background: '#EBF5FB', border: '1px solid var(--border-teal-light)', borderRadius: 10 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-info)', marginBottom: 6 }}>{'\uD83D\uDCA1'} Care Insights</div>
                            {kindredSummary.care_insights.map((insight, i) => (
                              <div key={i} style={{ fontSize: 13, color: 'var(--color-info)', lineHeight: 1.5, padding: '3px 0' }}>
                                {'\u2022'} {insight}
                              </div>
                            ))}
                          </div>
                        )}

                        {kindredSummary.generated_at && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
                            Last updated: {new Date(kindredSummary.generated_at).toLocaleString()}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ── Conversation Management (select + delete) ── */}
                  {companionConvos.length > 0 && (
                    <div style={{ borderTop: '1px solid #E8EEF2', paddingTop: 14 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                          Conversation Log ({companionConvos.length})
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          {selectedConvos.size > 0 && (
                            <button onClick={(e) => { e.stopPropagation(); if (confirm(`Delete ${selectedConvos.size} conversation(s)? This cannot be undone.`)) deleteSelectedConversations(); }}
                              disabled={deletingConvos}
                              style={{ padding: '4px 12px', border: 'none', borderRadius: 6, background: '#E74C3C', color: 'var(--text-on-primary)', fontSize: 11, fontWeight: 600, cursor: deletingConvos ? 'wait' : 'pointer' }}>
                              {deletingConvos ? 'Deleting...' : `Delete ${selectedConvos.size} selected`}
                            </button>
                          )}
                          <button onClick={(e) => {
                            e.stopPropagation();
                            if (selectedConvos.size === companionConvos.length) {
                              setSelectedConvos(new Set());
                            } else {
                              setSelectedConvos(new Set(companionConvos.map(c => c.conversation_id)));
                            }
                          }} style={{ padding: '4px 10px', border: '1px solid #ddd', borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer' }}>
                            {selectedConvos.size === companionConvos.length ? 'Deselect all' : 'Select all'}
                          </button>
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {companionConvos.map((convo) => {
                          const isSelected = selectedConvos.has(convo.conversation_id);
                          const startDate = convo.started_at ? parseTimestamp(convo.started_at) : null;
                          return (
                            <div key={convo.conversation_id}
                              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, border: isSelected ? '1px solid #E74C3C' : '1px solid #f0f0f0', background: isSelected ? '#FEF5F5' : 'var(--bg-card)', transition: 'all 0.15s' }}>
                              <input type="checkbox" checked={isSelected}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  const next = new Set(selectedConvos);
                                  isSelected ? next.delete(convo.conversation_id) : next.add(convo.conversation_id);
                                  setSelectedConvos(next);
                                }}
                                style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#E74C3C' }} />
                              <div style={{ flex: 1 }}>
                                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-navy)' }}>
                                  {startDate ? TimezoneHelper.formatTimestamp(startDate, profile?.timezone, { month: 'short', day: 'numeric' }) : 'Conversation'}
                                </span>
                                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>
                                  {startDate ? TimezoneHelper.formatTimestamp(startDate, profile?.timezone, { hour: 'numeric', minute: '2-digit' }) : ''}
                                </span>
                              </div>
                              <span style={{ fontSize: 10, color: 'var(--text-muted)', background: '#F4F6F7', padding: '2px 6px', borderRadius: 6 }}>
                                {convo.message_count} msg{convo.message_count !== 1 ? 's' : ''}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.4 }}>
                        Raw conversations are not visible to the care team. Only the AI-generated care summary above is shared. Select conversations to delete them permanently.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* ── Voice Routing Tab ── */}
              {companionTab === 'voice-routing' && (() => {
                const MESSAGE_TYPES = [
                  { id: 'conversation', label: 'Conversation responses', desc: `When ${profile?.first_name || 'care recipient'} talks to Kindred`, priority: 'high' },
                  { id: 'reminder', label: 'Medication reminders', desc: 'Scheduled pill & medication reminders', priority: 'high' },
                  { id: 'medication', label: 'Health check-ins', desc: 'How are you feeling, pain checks', priority: 'high' },
                  { id: 'alert', label: 'Appointment alerts', desc: 'Caregiver visits, doctor appointments', priority: 'medium' },
                  { id: 'check_in', label: 'Daily check-ins', desc: 'Morning greeting, evening wind-down', priority: 'medium' },
                ];

                // Built-in voices (Pete's clone + pre-made picks)
                const KNOWN_VOICES = [
                  { id: '__pete__', provider_voice_id: 'c2liOZ7MsLVLDpKuwIY5', name: "Pete's voice", icon: '\uD83C\uDFA4' },
                  { id: '__sarah__', provider_voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah (warm, reassuring)', icon: '\uD83D\uDD0A' },
                  { id: '__brian__', provider_voice_id: 'nPczCjzI2devNBz1zQrb', name: 'Brian (calm, comforting)', icon: '\uD83D\uDD0A' },
                ];

                // Merge with any DB voice profiles
                const allVoiceOptions = [...KNOWN_VOICES];
                availableVoices.forEach(v => {
                  if (!KNOWN_VOICES.some(k => k.provider_voice_id === v.voice_id)) {
                    allVoiceOptions.push({ id: v.voice_id, provider_voice_id: v.voice_id, name: v.name, icon: '\uD83D\uDD0A' });
                  }
                });

                // Find which voice is assigned to each message type
                const getAssignedVoice = (messageType) => {
                  const route = voiceRouting.find(r => r.message_type === messageType);
                  if (route?.voice_profile_id) {
                    // Match by display_name from the joined query (most reliable)
                    const displayName = (route.display_name || '').toLowerCase();
                    if (displayName.includes('pete')) return KNOWN_VOICES[0];
                    if (displayName.includes('sarah')) return KNOWN_VOICES[1];
                    if (displayName.includes('brian')) return KNOWN_VOICES[2];
                    // Fallback: check other available voices
                    const match = allVoiceOptions.find(v => v.id === route.voice_profile_id);
                    return match || { name: route.display_name || 'Custom', icon: '\uD83D\uDD0A' };
                  }
                  // Defaults (no routing row saved)
                  if (messageType === 'conversation') return KNOWN_VOICES[0]; // Pete
                  if (messageType === 'reminder' || messageType === 'medication') return KNOWN_VOICES[1]; // Sarah
                  if (messageType === 'alert' || messageType === 'check_in') return KNOWN_VOICES[2]; // Brian
                  return KNOWN_VOICES[0];
                };

                const peteCount = MESSAGE_TYPES.filter(t => getAssignedVoice(t.id).name.includes('Pete')).length;
                const otherCount = MESSAGE_TYPES.length - peteCount;

                return (
                  <div>
                    <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '0 0 12px', lineHeight: 1.5 }}>
                      Choose which voice speaks for each message type. Pete's cloned voice uses more credits; pre-made voices are lower cost.
                    </p>

                    {/* Summary bar */}
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '8px 10px', background: '#EBF5FB', borderRadius: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-info)', background: 'var(--color-info-bg)', padding: '2px 6px', borderRadius: 10 }}>
                        {peteCount} Pete's voice
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)', background: '#F4F6F7', padding: '2px 6px', borderRadius: 10 }}>
                        {otherCount} pre-made
                      </span>
                      {otherCount > 0 && (
                        <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                          ~{Math.round(otherCount / MESSAGE_TYPES.length * 100)}% savings
                        </span>
                      )}
                    </div>

                    {/* Route rows */}
                    <div style={{ border: '1px solid #E8EEF2', borderRadius: 10, overflow: 'visible' }}>
                      {MESSAGE_TYPES.map((mt, i) => {
                        const assigned = getAssignedVoice(mt.id);
                        const isOpen = routeDropdown === mt.id;
                        return (
                          <div key={mt.id} style={{
                            padding: '10px 12px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
                            borderBottom: i < MESSAGE_TYPES.length - 1 ? '1px solid #f0f0f0' : 'none',
                            background: i % 2 === 0 ? 'var(--bg-card)' : '#FAFCFE',
                          }}>
                            {/* Message type info */}
                            <div style={{ flex: '1 1 140px', minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-navy)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                {mt.label}
                                <span style={{
                                  fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 10,
                                  background: mt.priority === 'high' ? '#E8F8F0' : '#FEF3E2',
                                  color: mt.priority === 'high' ? '#27AE60' : '#E67E22',
                                }}>
                                  {mt.priority}
                                </span>
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{mt.desc}</div>
                            </div>

                            {/* Voice selector */}
                            <div style={{ position: 'relative', flex: '0 0 auto' }}>
                              <button onClick={(e) => { e.stopPropagation(); setRouteDropdown(isOpen ? null : mt.id); }}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 8,
                                  border: '1px solid #E8EEF2', fontSize: 11, cursor: 'pointer',
                                  background: assigned.name.includes('Pete') ? '#EBF5FB' : '#F4F6F7',
                                  color: 'var(--color-navy)', whiteSpace: 'nowrap',
                                }}>
                                <span>{assigned.icon}</span>
                                <span>{assigned.name}</span>
                                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{'\u25BC'}</span>
                              </button>

                              {/* Dropdown */}
                              {isOpen && (
                                <div style={{
                                  position: 'absolute', right: 0, top: '100%', marginTop: 4, background: 'var(--bg-surface)',
                                  borderRadius: 10, border: '1px solid #E8EEF2', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                                  zIndex: 9999, width: 220, overflow: 'hidden',
                                }}>
                                  {KNOWN_VOICES.map((voice, vi) => (
                                    <button key={voice.id} onClick={(e) => {
                                      e.stopPropagation();
                                      // Always save with provider_voice_id — backend resolves to DB profile
                                      saveVoiceRoute(mt.id, voice.provider_voice_id, mt.priority);
                                    }}
                                      style={{
                                        width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none',
                                        background: assigned.name === voice.name ? '#EBF5FB' : 'transparent',
                                        cursor: savingRoute === mt.id ? 'wait' : 'pointer', fontSize: 12, color: 'var(--color-navy)',
                                        display: 'flex', alignItems: 'center', gap: 8,
                                        borderBottom: vi < KNOWN_VOICES.length - 1 ? '1px solid #f8f8f8' : 'none',
                                      }}>
                                      <span>{voice.icon}</span>
                                      <span style={{ flex: 1 }}>{voice.name}</span>
                                      {assigned.name === voice.name && <span style={{ color: '#27AE60', fontWeight: 700 }}>{'\u2713'}</span>}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Credit-saving tip */}
                    <div style={{ marginTop: 14, padding: '12px 14px', background: '#FEF9E7', border: '1px solid #F9E79F', borderRadius: 10, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 16 }}>{'\uD83D\uDCA1'}</span>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#7D6608' }}>Credit-saving tip</div>
                        <div style={{ fontSize: 12, color: 'var(--color-navy)', marginTop: 2, lineHeight: 1.5 }}>
                          Daily check-ins and alerts happen frequently but don't need Pete's voice to feel personal. Using Sarah or Brian for these saves roughly 40% of monthly credits without affecting {profile?.first_name}'s experience.
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ── Voice Settings Tab ── */}
              {companionTab === 'voice-settings' && (
                <div>
                  {/* Called-by name setting */}
                  <div style={{ marginBottom: 16, padding: '14px 16px', background: 'var(--bg-highlight)', borderRadius: 10, border: '1px solid var(--border-teal-light)' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-info)', marginBottom: 6 }}>
                      {'\uD83D\uDCAC'} What does your family call {profile?.first_name || 'your loved one'}?
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 8px', lineHeight: 1.4 }}>
                      Kindred will use this name when speaking. Example: "Mom", "Mama", "Nana", or their first name.
                    </p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input type="text" value={profile?.called_by || ''} placeholder={profile?.first_name || 'Mom'}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setProfile(p => ({ ...p, called_by: e.target.value }))}
                        style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-teal-light)', fontSize: 13, outline: 'none' }} />
                      <button onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          const res = await apiFetch(`/api/care-recipients/${profile.id}`, {
                            method: 'PUT',
                            body: JSON.stringify({ called_by: profile.called_by || '' }),
                          });
                          if (res?.ok && typeof showToast === 'function') showToast('Saved!', 'success');
                        } catch {}
                      }} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--color-info)', color: 'var(--text-on-primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Save</button>
                    </div>
                  </div>

                  <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '0 0 16px', lineHeight: 1.5 }}>
                    Adjust how the companion speaks to {profile?.first_name}. These are the baseline settings; the companion also adapts in real time when {profile?.first_name} asks it to speak differently.
                  </p>
                  {voicePrefsLoading ? (
                    <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Loading voice settings...</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                      {/* Speed slider */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-navy)' }}>Speaking Speed</div>
                            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>0.7 (very slow) to 1.2 (brisk)</div>
                          </div>
                          <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-info)' }}>{voicePrefs.speed.toFixed(2)}x</span>
                        </div>
                        <input type="range" min="0.7" max="1.2" step="0.05" value={voicePrefs.speed}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setVoicePrefs(p => ({ ...p, speed: parseFloat(e.target.value) }))}
                          style={{ width: '100%', accentColor: 'var(--color-info)' }} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                          <span>Slower</span><span>Default</span><span>Faster</span>
                        </div>
                      </div>

                      {/* Stability slider */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-navy)' }}>Voice Stability</div>
                            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Higher = more consistent. Lower = more expressive.</div>
                          </div>
                          <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-info)' }}>{(voicePrefs.stability * 100).toFixed(0)}%</span>
                        </div>
                        <input type="range" min="0" max="1" step="0.05" value={voicePrefs.stability}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setVoicePrefs(p => ({ ...p, stability: parseFloat(e.target.value) }))}
                          style={{ width: '100%', accentColor: 'var(--color-info)' }} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                          <span>Expressive</span><span>Balanced</span><span>Consistent</span>
                        </div>
                      </div>

                      {/* Similarity slider */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-navy)' }}>Voice Similarity</div>
                            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>How closely the output matches the original recording.</div>
                          </div>
                          <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-info)' }}>{(voicePrefs.similarity_boost * 100).toFixed(0)}%</span>
                        </div>
                        <input type="range" min="0" max="1" step="0.05" value={voicePrefs.similarity_boost}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setVoicePrefs(p => ({ ...p, similarity_boost: parseFloat(e.target.value) }))}
                          style={{ width: '100%', accentColor: 'var(--color-info)' }} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                          <span>Less alike</span><span>Balanced</span><span>Most alike</span>
                        </div>
                      </div>

                      <button onClick={(e) => { e.stopPropagation(); saveVoicePreferences(); }} disabled={savingVoicePrefs}
                        style={{
                          padding: '10px 20px', borderRadius: 8, border: 'none',
                          background: savingVoicePrefs ? '#a0c4b8' : 'var(--color-info)', color: 'var(--text-on-primary)',
                          fontWeight: 700, fontSize: 13, cursor: savingVoicePrefs ? 'wait' : 'pointer', alignSelf: 'flex-start',
                        }}>
                        {savingVoicePrefs ? 'Saving...' : 'Save Voice Settings'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ── Usage Tab ── */}
              {companionTab === 'usage' && (
                <div>
                  <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '0 0 16px', lineHeight: 1.5 }}>
                    Track voice companion usage and ElevenLabs credit consumption.
                  </p>
                  {usageLoading ? (
                    <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Loading usage data...</div>
                  ) : !companionUsage ? (
                    <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', background: 'var(--bg-primary)', borderRadius: 10 }}>No usage data yet</div>
                  ) : (
                    <div>
                      {/* Summary cards */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 16 }}>
                        {[
                          { label: 'Messages', value: companionUsage.summary?.total_messages || 0, icon: '\uD83D\uDCAC', color: 'var(--color-info)' },
                          { label: 'Conversations', value: companionUsage.summary?.conversation_count || 0, icon: '\uD83D\uDDE3\uFE0F', color: '#27AE60' },
                          { label: 'Credits Used', value: companionUsage.summary?.total_credits_used || 0, icon: '\uD83D\uDCB0', color: '#E67E22' },
                          { label: 'Proj. Monthly', value: companionUsage.summary?.projected_monthly_credits || 0, icon: '\uD83D\uDCC8', color: '#8E44AD' },
                        ].map((stat, i) => (
                          <div key={i} style={{ textAlign: 'center', padding: 10, background: '#F4F6F7', borderRadius: 10 }}>
                            <div style={{ fontSize: 16, marginBottom: 2 }}>{stat.icon}</div>
                            <div style={{ fontSize: 17, fontWeight: 700, color: stat.color }}>{typeof stat.value === 'number' ? stat.value.toLocaleString() : stat.value}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>{stat.label}</div>
                          </div>
                        ))}
                      </div>

                      {/* Daily breakdown */}
                      {companionUsage.daily_breakdown && companionUsage.daily_breakdown.length > 0 && (
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-navy)', marginBottom: 8 }}>Past 7 Days</div>
                          <div style={{ border: '1px solid #E8EEF2', borderRadius: 10, overflow: 'hidden' }}>
                            {companionUsage.daily_breakdown.map((day, i) => (
                              <div key={i} style={{
                                display: 'flex', alignItems: 'center', padding: '8px 10px', gap: 8, flexWrap: 'wrap',
                                borderBottom: i < companionUsage.daily_breakdown.length - 1 ? '1px solid #f0f0f0' : 'none',
                                background: i % 2 === 0 ? 'var(--bg-card)' : '#FAFCFE',
                              }}>
                                <span style={{ fontSize: 11, color: 'var(--color-navy)', fontWeight: 500, minWidth: 70 }}>
                                  {(() => { const d = TimezoneHelper.parseDate(String(day.day || '')); return isNaN(d.getTime()) ? String(day.day || '') : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); })()}
                                </span>
                                <div style={{ flex: '1 1 60px', height: 6, background: '#F4F6F7', borderRadius: 4, overflow: 'hidden' }}>
                                  <div style={{ height: '100%', background: 'var(--color-info)', borderRadius: 4, width: `${Math.min(100, (day.credits_used / Math.max(1, ...companionUsage.daily_breakdown.map(d => d.credits_used))) * 100)}%` }} />
                                </div>
                                <span style={{ fontSize: 10, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                                  {(day.credits_used || 0).toLocaleString()} cr · {day.message_count} msg
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* ElevenLabs plan info */}
                      <div style={{ marginTop: 16, padding: 14, background: '#EBF5FB', borderRadius: 10, border: '1px solid var(--border-teal-light)' }}>
                        <div style={{ fontSize: 13, color: 'var(--color-navy)', lineHeight: 1.5 }}>
                          <strong>ElevenLabs Starter Plan:</strong> 40,000 credits/month ($5/mo).
                          {companionUsage.summary?.projected_monthly_credits > 40000 && (
                            <span style={{ color: '#E67E22', fontWeight: 600 }}>
                              {' '}Projected usage exceeds plan. Consider upgrading or routing more messages to generic voices.
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Launch companion link */}
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #f0f0f0', display: 'flex', gap: 10, alignItems: 'center' }}>
                <button onClick={(e) => {
                  e.stopPropagation();
                  // Pass token so kindred/index.html can authenticate
                  // Capacitor: location.href (window.open fails in WebView)
                  // Web: window.open in new tab
                  const isCapacitor = window.Capacitor?.isNativePlatform?.();
                  const kindredUrl = AUTH_TOKEN
                    ? `/kindred?token=${encodeURIComponent(AUTH_TOKEN)}`
                    : '/kindred';
                  if (isCapacitor) {
                    window.location.href = kindredUrl;
                  } else {
                    window.open(kindredUrl, '_blank');
                  }
                }} style={{
                  padding: '8px 16px', borderRadius: 8, border: '2px solid #1A5276',
                  background: 'var(--bg-surface)', color: 'var(--color-info)', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  {'\uD83C\uDFA4'} Open Kindred
                </button>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Opens {profile?.first_name}'s Kindred{window.Capacitor?.isNativePlatform?.() ? '' : ' in a new tab'}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── 6. Permission Controls (owner only, bottom) ─── */}
      {canEdit && (
        profile?.linked_user_id ? (
        <div className="card" style={{ marginBottom: 16, border: '1px solid #e0e0e0' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{'\uD83D\uDD10'}</span> {profile.first_name}'s App Permissions
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 14, lineHeight: 1.5 }}>
            Control what {profile.first_name} sees and can do when they log into their own account.
          </p>

          <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
            {[
              { id: 'full', label: 'Full Control', desc: 'Can view and edit everything', icon: '\uD83D\uDFE2' },
              { id: 'collaborative', label: 'Collaborative', desc: 'Can view selected info, can add notes', icon: '\uD83D\uDFE1' },
              { id: 'managed', label: 'Managed', desc: 'View-only for selected info', icon: '\uD83D\uDD34' },
            ].map(t => (
              <button key={t.id} onClick={() => {
                setPermTier(t.id);
                if (t.id === 'full') setVisSettings(null);
                else if (!visSettings) setVisSettings({ calendar: true, healthConditions: true, medications: true, allergies: true, preferences: true, pets: true, emergencyContact: true, notes: true });
              }} style={{
                flex: '1 1 140px', padding: '10px 12px', border: permTier === t.id ? '2px solid #1b6b5a' : '1px solid #e0e0e0',
                borderRadius: 10, background: permTier === t.id ? 'var(--color-success-bg)' : 'var(--bg-card)', cursor: 'pointer', textAlign: 'left',
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{t.icon} {t.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{t.desc}</div>
              </button>
            ))}
          </div>

          {permTier !== 'full' && visSettings && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {profile.first_name} can see:
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 6 }}>
                {[
                  { key: 'calendar', label: 'Calendar / Schedule', icon: '\uD83D\uDCC5' },
                  { key: 'healthConditions', label: 'Health Conditions', icon: '\uD83E\uDE7A' },
                  { key: 'medications', label: 'Medications', icon: '\uD83D\uDC8A' },
                  { key: 'allergies', label: 'Allergies', icon: '\u26A0\uFE0F' },
                  { key: 'preferences', label: 'Care Preferences', icon: '\u2728' },
                  { key: 'pets', label: 'Pets at Home', icon: '\uD83D\uDC3E' },
                  { key: 'emergencyContact', label: 'Emergency Contact', icon: '\uD83C\uDD98' },
                  { key: 'notes', label: 'Notes', icon: '\uD83D\uDCDD' },
                ].map(s => (
                  <label key={s.key} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                    background: visSettings[s.key] ? 'var(--bg-highlight)' : 'var(--bg-primary)', borderRadius: 8,
                    border: `1px solid ${visSettings[s.key] ? '#1b6b5a40' : 'var(--border-light)'}`, cursor: 'pointer',
                  }}>
                    <input type="checkbox" checked={!!visSettings[s.key]}
                      onChange={() => setVisSettings(v => ({ ...v, [s.key]: !v[s.key] }))}
                      style={{ accentColor: 'var(--role-color)' }} />
                    <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{s.icon} {s.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <button onClick={async () => {
            setSavingPerms(true);
            try {
              const res = await apiFetch(`/api/care-recipients/${profile.id}/permissions`, {
                method: 'PUT',
                body: JSON.stringify({
                  permissionTier: permTier,
                  visibilitySettings: permTier === 'full' ? null : visSettings,
                }),
              });
              if (res?.ok) {
                showToast('Permissions updated', 'success');
                setProfile(p => ({ ...p, permission_tier: permTier, visibility_settings: permTier === 'full' ? null : JSON.stringify(visSettings) }));
              } else {
                const d = await res?.json().catch(() => ({}));
                showToast(d.error || 'Failed to update permissions', 'error');
              }
            } catch { showToast('Failed to update permissions', 'error'); }
            setSavingPerms(false);
          }} disabled={savingPerms} style={{
            padding: '8px 20px', background: savingPerms ? 'var(--text-muted)' : 'var(--role-color)', color: 'var(--text-on-primary)',
            border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: savingPerms ? 'wait' : 'pointer',
          }}>
            {savingPerms ? 'Saving...' : 'Save Permissions'}
          </button>
        </div>
        ) : (
        <div className="card" style={{ marginBottom: 16, border: '1px solid #e0e0e0', opacity: 0.55 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{'\uD83D\uDD10'}</span> {profile.first_name}'s App Permissions
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-tertiary)', margin: 0, lineHeight: 1.5 }}>
            Control {profile.first_name}'s access on the app if {profile.first_name} joins. Once {profile.first_name} has their own account linked here, you'll be able to choose what they can see and do.
          </p>
          <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap', pointerEvents: 'none' }}>
            {[
              { label: 'Full Control', icon: '\uD83D\uDFE2' },
              { label: 'Collaborative', icon: '\uD83D\uDFE1' },
              { label: 'Managed', icon: '\uD83D\uDD34' },
            ].map(t => (
              <div key={t.label} style={{
                flex: '1 1 120px', padding: '8px 10px', border: '1px solid #e0e0e0',
                borderRadius: 10, background: 'var(--bg-primary)', textAlign: 'left',
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>{t.icon} {t.label}</div>
              </div>
            ))}
          </div>
        </div>
        )
      )}

      {/* ── Care Team shortcut card ── */}
      {!editing && onNavigate && (
        <div className="card" style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', cursor: 'pointer' }} onClick={() => onNavigate('care-team')}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--role-color)' }}>👪 Care Team</div>
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 2 }}>View members, invite family, and manage caregivers</div>
          </div>
          <span style={{ fontSize: 20, color: 'var(--text-muted)' }}>›</span>
        </div>
      )}

      {viewingAttachments && typeof AttachmentViewer !== 'undefined' && (
        <AttachmentViewer attachments={viewingAttachments.list} startIndex={viewingAttachments.index}
          onClose={() => setViewingAttachments(null)} />
      )}
    </>
  );
};
