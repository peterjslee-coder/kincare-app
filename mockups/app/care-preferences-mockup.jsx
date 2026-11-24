import { useState, useEffect, useRef } from "react";

// Which preferences get a follow-up question when rated Important or Must Have
const FOLLOW_UPS = {
  med_reminders: { prompt: 'How many medications? Any special timing or schedule?', placeholder: 'e.g., 3 pills morning, 2 evening — timing is critical' },
  wandering: { prompt: 'How frequent? Any known triggers?', placeholder: 'e.g., Happens mostly at night, triggered by confusion about time' },
  vitals: { prompt: 'Which vitals? How often should they be checked?', placeholder: 'e.g., Blood pressure twice daily, temperature if she feels warm' },
  exercise: { prompt: 'Any prescribed exercises or PT routines?', placeholder: 'e.g., 15-min walk daily, hand exercises from PT twice a week' },
  patience: { prompt: 'Any specific behaviors or patterns we should know about?', placeholder: 'e.g., Repeats questions frequently, gets confused about day/time' },
  condition_experience: { prompt: 'What conditions does your loved one have?', placeholder: "e.g., Early-stage Parkinson's, Type 2 diabetes, mild arthritis" },
  pets: { prompt: 'What kind of pets? Does the caregiver need to help care for them?', placeholder: 'e.g., Two cats (indoor), need feeding and litter box help' },
  spiritual: { prompt: 'What faith or practice? Any regular services or routines?', placeholder: 'e.g., Catholic — Sunday mass at St. Mary\'s, daily rosary' },
  overnight: { prompt: 'What does overnight supervision look like?', placeholder: 'e.g., Needs someone awake 10pm-6am, gets up disoriented at night' },
  transportation: { prompt: 'How often? Any regular appointments?', placeholder: 'e.g., Doctor every 2 weeks, church on Sundays, hair salon monthly' },
};

const PREFERENCES = [
  { id: 'meal_prep', label: 'Meal preparation & cooking', icon: '🍳' },
  { id: 'housekeeping', label: 'Light housekeeping (tidying, dishes, laundry)', icon: '🧹' },
  { id: 'errands', label: 'Grocery shopping & errands', icon: '🛒' },
  { id: 'med_reminders', label: 'Medication reminders (reminders only — not administering)', icon: '💊' },
  { id: 'bathing', label: 'Help with bathing, grooming & dressing', icon: '🚿' },
  { id: 'fall_prevention', label: 'Fall prevention & mobility assistance', icon: '🦯' },
  { id: 'transportation', label: 'Transportation to appointments', icon: '🚗' },
  { id: 'overnight', label: 'Overnight or evening supervision', icon: '🌙' },
  { id: 'wandering', label: 'Wandering prevention', icon: '🚪' },
  { id: 'vitals', label: 'Vital signs monitoring (blood pressure, temperature)', icon: '🩺' },
  { id: 'exercise', label: 'Exercise & physical therapy support', icon: '🏋️' },
  { id: 'companionship', label: 'Companionship & conversation', icon: '💬' },
  { id: 'hobbies', label: 'Engaging in hobbies & activities together', icon: '🎨' },
  { id: 'social_outings', label: 'Social outing accompaniment (church, friends, events)', icon: '⛪' },
  { id: 'patience', label: 'Patience with repetition & confusion', icon: '💛' },
  { id: 'daily_updates', label: 'Daily updates & photos sent to family', icon: '📸' },
  { id: 'consistent_caregiver', label: 'Consistent same-caregiver scheduling', icon: '🤝' },
  { id: 'condition_experience', label: 'Experience with specific conditions', icon: '📋' },
  { id: 'pets', label: 'Comfortable with pets in the home', icon: '🐾' },
  { id: 'gardening', label: 'Gardening or light yard work', icon: '🌱' },
  { id: 'outdoor_walks', label: 'Outdoor walks & fresh air time', icon: '🚶' },
  { id: 'socializing_out', label: 'Socializing away from home (cafés, parks, community)', icon: '☕' },
  { id: 'tech_help', label: 'Technology help (phone, tablet, video calls)', icon: '📱' },
  { id: 'spiritual', label: 'Spiritual or religious practice support', icon: '🕊️' },
];

const RATING_LABELS = [
  { value: 0, label: 'Not needed', color: '#e0e0e0', textColor: '#999' },
  { value: 1, label: 'Nice to have', color: '#fff3e0', textColor: '#e65100' },
  { value: 2, label: 'Important', color: '#e8f5e9', textColor: '#2e7d32' },
  { value: 3, label: 'Must have', color: '#1b6b5a', textColor: '#fff' },
];

const MedicalDisclaimer = () => (
  <div style={{
    background: '#fff3e0', border: '2px solid #e8724a', borderRadius: 12,
    padding: '16px 20px', marginBottom: 24, display: 'flex', gap: 12, alignItems: 'flex-start'
  }}>
    <div style={{ fontSize: 24, flexShrink: 0 }}>⚕️</div>
    <div>
      <div style={{ fontWeight: 700, fontSize: 15, color: '#bf360c', marginBottom: 4 }}>
        InPlace is not a medical service
      </div>
      <div style={{ fontSize: 13, color: '#5d4037', lineHeight: 1.5 }}>
        Our caregivers provide companion care and daily living assistance. They do not diagnose, treat, administer medication, or perform medical procedures. If your loved one needs medical or nursing care, please consult a licensed home health provider.
      </div>
    </div>
  </div>
);

const PreferenceItem = ({ pref, value, onChange, detail, onDetailChange }) => {
  const hasFollowUp = FOLLOW_UPS[pref.id];
  const showFollowUp = hasFollowUp && value >= 2; // Important or Must Have
  const inputRef = useRef(null);

  useEffect(() => {
    if (showFollowUp && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [showFollowUp]);

  return (
    <div style={{
      borderRadius: 10,
      background: value > 0 ? RATING_LABELS[value].color + '40' : '#fafafa',
      border: `1px solid ${value > 0 ? RATING_LABELS[value].color : '#eee'}`,
      transition: 'all 0.2s',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px',
      }}>
        <div style={{ fontSize: 20, flexShrink: 0, width: 28, textAlign: 'center' }}>{pref.icon}</div>
        <div style={{ flex: 1, fontSize: 14, fontWeight: 500, color: '#333', lineHeight: 1.3 }}>{pref.label}</div>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {RATING_LABELS.map(r => (
            <button
              key={r.value}
              onClick={() => onChange(pref.id, r.value)}
              style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                border: value === r.value ? '2px solid #1b6b5a' : '1px solid #ddd',
                background: value === r.value ? r.color : '#fff',
                color: value === r.value ? r.textColor : '#999',
                cursor: 'pointer', transition: 'all 0.15s',
                transform: value === r.value ? 'scale(1.05)' : 'scale(1)',
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Follow-up detail field — slides open for Important/Must Have */}
      <div style={{
        maxHeight: showFollowUp ? 120 : 0,
        opacity: showFollowUp ? 1 : 0,
        transition: 'max-height 0.3s ease, opacity 0.2s ease, padding 0.3s ease',
        overflow: 'hidden',
        padding: showFollowUp ? '0 16px 12px 56px' : '0 16px 0 56px',
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#1b6b5a', marginBottom: 4 }}>
          {hasFollowUp?.prompt} <span style={{ fontWeight: 400, color: '#999' }}>(optional)</span>
        </div>
        <input
          ref={inputRef}
          type="text"
          value={detail || ''}
          onChange={(e) => onDetailChange(pref.id, e.target.value)}
          placeholder={hasFollowUp?.placeholder}
          style={{
            width: '100%', padding: '8px 12px', borderRadius: 8,
            border: '1px solid #ccc', fontSize: 13, color: '#333',
            background: '#fff', outline: 'none', boxSizing: 'border-box',
          }}
          onFocus={(e) => e.target.style.borderColor = '#1b6b5a'}
          onBlur={(e) => e.target.style.borderColor = '#ccc'}
        />
      </div>
    </div>
  );
};

const AICareSummary = ({ preferences, details, name }) => {
  const [generating, setGenerating] = useState(false);
  const [summary, setSummary] = useState('');
  const [showSummary, setShowSummary] = useState(false);

  const mustHaves = PREFERENCES.filter(p => preferences[p.id] === 3);
  const important = PREFERENCES.filter(p => preferences[p.id] === 2);
  const niceToHave = PREFERENCES.filter(p => preferences[p.id] === 1);

  // Build context-rich detail strings
  const detailStr = (pref) => {
    const d = details[pref.id];
    return d ? ` — ${d}` : '';
  };

  const generateSummary = () => {
    setGenerating(true);

    // Build a rich, context-aware summary using the details
    const conditionDetail = details['condition_experience'] || '';
    const petDetail = details['pets'] || '';
    const medDetail = details['med_reminders'] || '';

    let fullText = `CARE NEEDS SUMMARY — ${name.toUpperCase()}\n\n`;

    // If they specified conditions, lead with that
    if (conditionDetail) {
      fullText += `DIAGNOSIS & CONDITIONS\n${name} has ${conditionDetail}. `;
      fullText += `Caregivers should have direct experience with ${conditionDetail.split(',')[0].trim().toLowerCase()} and understand how it affects daily routines, communication, and safety.\n\n`;
    }

    fullText += `PRIMARY NEEDS (Must-Have)\n`;
    fullText += mustHaves.map(p => `• ${p.label}${detailStr(p)}`).join('\n') + '\n\n';

    if (important.length > 0) {
      fullText += `IMPORTANT PRIORITIES\n`;
      fullText += important.map(p => `• ${p.label}${detailStr(p)}`).join('\n') + '\n\n';
    }

    if (niceToHave.length > 0) {
      fullText += `NICE TO HAVE\n`;
      fullText += niceToHave.map(p => `• ${p.label}${detailStr(p)}`).join('\n') + '\n\n';
    }

    // Medication context
    if (medDetail) {
      fullText += `MEDICATION NOTES\n${medDetail}. Caregiver provides reminders only — does not administer medication.\n\n`;
    }

    // Pets context
    if (petDetail) {
      fullText += `PETS IN THE HOME\n${petDetail}. Caregiver should be comfortable with animals and ${petDetail.toLowerCase().includes('help') || petDetail.toLowerCase().includes('care') ? 'will assist with pet care as part of the routine' : 'may occasionally interact with them'}.\n\n`;
    }

    fullText += `RECOMMENDED CAREGIVER PROFILE\n`;
    fullText += `${name} needs a `;
    const traits = [];
    if (conditionDetail) traits.push(`caregiver experienced with ${conditionDetail.split(',')[0].trim().toLowerCase()}`);
    if (preferences['patience'] >= 2) traits.push('patient and empathetic communicator');
    if (preferences['consistent_caregiver'] >= 2) traits.push('consistent presence (same caregiver preferred)');
    if (preferences['companionship'] >= 2) traits.push('warm conversationalist');
    if (preferences['outdoor_walks'] >= 2 || preferences['gardening'] >= 2) traits.push('someone who enjoys outdoor activities');
    fullText += traits.length > 0 ? traits.join(', ') + '.' : 'caring, reliable companion.';

    fullText += `\n\nThis summary will be visible to matched caregivers so they understand ${name}'s needs before their first visit. You can update preferences and this summary anytime from ${name}'s care profile.`;

    let i = 0;
    const interval = setInterval(() => {
      i += 4;
      setSummary(fullText.slice(0, i));
      if (i >= fullText.length) {
        clearInterval(interval);
        setGenerating(false);
        setShowSummary(true);
      }
    }, 6);
  };

  const rated = Object.values(preferences).filter(v => v > 0).length;
  const hasDetails = Object.values(details).some(d => d && d.trim());

  return (
    <div style={{
      background: '#f8fffe', border: '2px solid #1b6b5a', borderRadius: 16,
      padding: 24, marginTop: 24,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10, background: '#1b6b5a',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18
        }}>✨</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#1b6b5a' }}>AI Care Summary</div>
          <div style={{ fontSize: 12, color: '#888' }}>
            We'll draft a care needs overview based on your selections
            {hasDetails && ' and the details you provided'}
          </div>
        </div>
      </div>
      {!showSummary && !generating && (
        <div>
          <div style={{ fontSize: 13, color: '#666', marginBottom: 12, lineHeight: 1.5 }}>
            Based on {name}'s profile, your {rated} rated preferences{hasDetails ? ', and the additional context you shared' : ''},
            we'll generate a care needs summary that helps caregivers understand exactly what {name}
            needs — before they ever walk through the door.
          </div>
          <button
            onClick={generateSummary}
            disabled={rated < 5}
            style={{
              padding: '10px 24px', borderRadius: 10, border: 'none',
              background: rated >= 5 ? '#1b6b5a' : '#ccc', color: '#fff',
              fontWeight: 700, fontSize: 14, cursor: rated >= 5 ? 'pointer' : 'default',
            }}
          >
            {rated >= 5 ? '✨ Generate Care Summary' : `Rate at least 5 preferences (${rated}/5)`}
          </button>
        </div>
      )}
      {(generating || showSummary) && (
        <div style={{
          background: '#fff', borderRadius: 10, padding: 20, marginTop: 8,
          border: '1px solid #e0e0e0', whiteSpace: 'pre-wrap', fontSize: 13,
          lineHeight: 1.7, color: '#333', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
        }}>
          {summary}
          {generating && <span style={{ animation: 'blink 1s infinite', color: '#1b6b5a', fontWeight: 700 }}>▊</span>}
        </div>
      )}
      {showSummary && (
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button style={{
            padding: '10px 20px', borderRadius: 10, border: 'none',
            background: '#1b6b5a', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer',
          }}>
            Save & Continue →
          </button>
          <button
            onClick={generateSummary}
            style={{
              padding: '10px 20px', borderRadius: 10, border: '1px solid #ddd',
              background: '#fff', color: '#666', fontWeight: 600, fontSize: 14, cursor: 'pointer',
            }}
          >
            Regenerate
          </button>
        </div>
      )}
    </div>
  );
};

export default function CarePreferencesMockup() {
  const [step, setStep] = useState('intro');
  const [preferences, setPreferences] = useState({});
  const [details, setDetails] = useState({});
  const [showAll, setShowAll] = useState(false);
  const lovedOneName = 'Betty';

  const handleRate = (id, value) => {
    setPreferences(prev => ({ ...prev, [id]: value }));
    // Clear detail if downgraded below Important
    if (value < 2 && details[id]) {
      setDetails(prev => { const n = { ...prev }; delete n[id]; return n; });
    }
  };

  const handleDetail = (id, value) => {
    setDetails(prev => ({ ...prev, [id]: value }));
  };

  const rated = Object.values(preferences).filter(v => v > 0).length;
  const mustHaves = Object.values(preferences).filter(v => v === 3).length;
  const detailCount = Object.values(details).filter(d => d && d.trim()).length;

  const visiblePrefs = showAll ? PREFERENCES : PREFERENCES.slice(0, 10);

  if (step === 'intro') {
    return (
      <div style={{ maxWidth: 600, margin: '0 auto', padding: 24, fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif' }}>
        {/* Getting Started Checklist Context */}
        <div style={{ fontSize: 12, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          Getting Started • Step 3 of 6
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
          {[1,2,3,4,5,6].map(i => (
            <div key={i} style={{
              flex: 1, height: 4, borderRadius: 2,
              background: i <= 3 ? '#1b6b5a' : '#e0e0e0',
            }} />
          ))}
        </div>

        <h1 style={{ fontSize: 28, fontWeight: 800, color: '#1b6b5a', margin: '0 0 8px', lineHeight: 1.2 }}>
          What matters most for {lovedOneName}'s care?
        </h1>
        <p style={{ fontSize: 15, color: '#666', lineHeight: 1.6, margin: '0 0 24px' }}>
          Tell us what's important so we can match {lovedOneName} with the right caregivers.
          Rate each item based on how important it is for your family — and add details where it helps.
        </p>

        <div style={{
          background: '#f0faf7', borderRadius: 12, padding: '14px 18px', marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 10,
          border: '1px solid #c8e6df',
        }}>
          <span style={{ fontSize: 18 }}>💡</span>
          <span style={{ fontSize: 13, color: '#1b6b5a', fontWeight: 500 }}>
            You can always come back and change these later as {lovedOneName}'s needs evolve.
          </span>
        </div>

        <div style={{
          background: '#f3e8ff', borderRadius: 12, padding: '14px 18px', marginBottom: 24,
          display: 'flex', alignItems: 'center', gap: 10,
          border: '1px solid #d4b5ff',
        }}>
          <span style={{ fontSize: 18 }}>✨</span>
          <span style={{ fontSize: 13, color: '#6b21a8', fontWeight: 500 }}>
            When you're done rating, AI will draft a care summary for {lovedOneName} that caregivers can review before their first visit.
          </span>
        </div>

        <MedicalDisclaimer />

        <button
          onClick={() => setStep('rate')}
          style={{
            width: '100%', padding: '14px 24px', borderRadius: 12, border: 'none',
            background: '#1b6b5a', color: '#fff', fontWeight: 700, fontSize: 16,
            cursor: 'pointer',
          }}
        >
          Let's Get Started →
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: 24, fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif' }}>
      {/* Progress bar */}
      <div style={{ fontSize: 12, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
        Getting Started • Step 3 of 6
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {[1,2,3,4,5,6].map(i => (
          <div key={i} style={{
            flex: 1, height: 4, borderRadius: 2,
            background: i <= 3 ? '#1b6b5a' : '#e0e0e0',
          }} />
        ))}
      </div>

      {/* Header with counter */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1b6b5a', margin: 0 }}>
          {lovedOneName}'s Care Preferences
        </h1>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <div style={{
            background: '#f0faf7', borderRadius: 20, padding: '6px 14px',
            fontSize: 13, fontWeight: 600, color: '#1b6b5a',
          }}>
            {rated}/24 rated
          </div>
          {detailCount > 0 && (
            <div style={{
              background: '#f3e8ff', borderRadius: 20, padding: '6px 14px',
              fontSize: 13, fontWeight: 600, color: '#6b21a8',
            }}>
              {detailCount} details added
            </div>
          )}
        </div>
      </div>
      <p style={{ fontSize: 13, color: '#888', margin: '0 0 16px' }}>
        Rate each item. For important items, you can add details to help us find the perfect match.
      </p>

      <MedicalDisclaimer />

      {/* Rating legend */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {RATING_LABELS.map(r => (
          <div key={r.value} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
            background: r.color, color: r.textColor, border: '1px solid #ddd',
          }}>
            {r.label}
          </div>
        ))}
      </div>

      {/* Preference items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visiblePrefs.map(pref => (
          <PreferenceItem
            key={pref.id}
            pref={pref}
            value={preferences[pref.id] || 0}
            onChange={handleRate}
            detail={details[pref.id] || ''}
            onDetailChange={handleDetail}
          />
        ))}
      </div>

      {!showAll && (
        <button
          onClick={() => setShowAll(true)}
          style={{
            width: '100%', padding: '12px', marginTop: 12, borderRadius: 10,
            border: '1px dashed #ccc', background: '#fafafa', color: '#666',
            fontWeight: 600, fontSize: 14, cursor: 'pointer',
          }}
        >
          Show {PREFERENCES.length - 10} more preferences ↓
        </button>
      )}

      {/* Summary stats */}
      {rated >= 3 && (
        <div style={{
          display: 'flex', gap: 12, marginTop: 20, padding: '12px 16px',
          background: '#fafafa', borderRadius: 10, border: '1px solid #eee',
        }}>
          <div style={{ textAlign: 'center', flex: 1 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#1b6b5a' }}>{mustHaves}</div>
            <div style={{ fontSize: 11, color: '#888' }}>Must-haves</div>
          </div>
          <div style={{ width: 1, background: '#e0e0e0' }} />
          <div style={{ textAlign: 'center', flex: 1 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#2e7d32' }}>
              {Object.values(preferences).filter(v => v === 2).length}
            </div>
            <div style={{ fontSize: 11, color: '#888' }}>Important</div>
          </div>
          <div style={{ width: 1, background: '#e0e0e0' }} />
          <div style={{ textAlign: 'center', flex: 1 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#e65100' }}>
              {Object.values(preferences).filter(v => v === 1).length}
            </div>
            <div style={{ fontSize: 11, color: '#888' }}>Nice to have</div>
          </div>
          {detailCount > 0 && (
            <>
              <div style={{ width: 1, background: '#e0e0e0' }} />
              <div style={{ textAlign: 'center', flex: 1 }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#6b21a8' }}>{detailCount}</div>
                <div style={{ fontSize: 11, color: '#888' }}>Details added</div>
              </div>
            </>
          )}
        </div>
      )}

      {/* AI Summary Section */}
      <AICareSummary preferences={preferences} details={details} name={lovedOneName} />

      <style>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        button:hover {
          filter: brightness(1.05);
        }
        input::placeholder {
          color: #bbb;
          font-style: italic;
        }
      `}</style>
    </div>
  );
}