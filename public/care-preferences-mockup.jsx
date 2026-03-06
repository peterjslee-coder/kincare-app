import { useState, useEffect } from "react";

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

const PreferenceItem = ({ pref, value, onChange }) => {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 16px', borderRadius: 10,
      background: value > 0 ? RATING_LABELS[value].color + '40' : '#fafafa',
      border: `1px solid ${value > 0 ? RATING_LABELS[value].color : '#eee'}`,
      transition: 'all 0.2s',
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
  );
};

const AICareSummary = ({ preferences, name }) => {
  const [generating, setGenerating] = useState(false);
  const [summary, setSummary] = useState('');
  const [showSummary, setShowSummary] = useState(false);

  const mustHaves = PREFERENCES.filter(p => preferences[p.id] === 3);
  const important = PREFERENCES.filter(p => preferences[p.id] === 2);
  const niceToHave = PREFERENCES.filter(p => preferences[p.id] === 1);

  const generateSummary = () => {
    setGenerating(true);
    // Simulate AI generation with typing effect
    const fullText = `Based on ${name}'s care profile and your preferences, here's a summary of ${name}'s care needs:\n\n` +
      `${name} needs a caregiver who can provide consistent, relationship-based companion care with a strong focus on daily living support and cognitive engagement.\n\n` +
      `PRIMARY NEEDS (Must-Have)\n` +
      mustHaves.map(p => `• ${p.label}`).join('\n') + '\n\n' +
      (important.length > 0 ? `IMPORTANT PRIORITIES\n` +
      important.map(p => `• ${p.label}`).join('\n') + '\n\n' : '') +
      (niceToHave.length > 0 ? `NICE TO HAVE\n` +
      niceToHave.map(p => `• ${p.label}`).join('\n') + '\n\n' : '') +
      `RECOMMENDED CAREGIVER PROFILE\n` +
      `Look for caregivers with dementia care experience who are patient, communicative, and comfortable with a consistent weekly schedule. ` +
      `${mustHaves.some(p => p.id === 'pets') ? `They should be comfortable around pets. ` : ''}` +
      `${mustHaves.some(p => p.id === 'transportation') ? `Reliable transportation is essential. ` : ''}` +
      `Daily photo updates to family members are ${preferences['daily_updates'] >= 2 ? 'expected' : 'appreciated'}.\n\n` +
      `This summary will be shared with matched caregivers so they understand ${name}'s needs before their first visit. You can update these preferences anytime from ${name}'s care profile.`;

    let i = 0;
    const interval = setInterval(() => {
      i += 3;
      setSummary(fullText.slice(0, i));
      if (i >= fullText.length) {
        clearInterval(interval);
        setGenerating(false);
        setShowSummary(true);
      }
    }, 8);
  };

  const rated = Object.values(preferences).filter(v => v > 0).length;

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
          <div style={{ fontSize: 12, color: '#888' }}>We'll draft a care needs overview based on your selections</div>
        </div>
      </div>
      {!showSummary && !generating && (
        <div>
          <div style={{ fontSize: 13, color: '#666', marginBottom: 12, lineHeight: 1.5 }}>
            Based on {name}'s profile and your {rated} rated preferences, we'll generate a care needs summary
            that helps caregivers understand exactly what {name} needs — before they ever walk through the door.
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
  const [showAll, setShowAll] = useState(false);
  const lovedOneName = 'Betty';

  const handleRate = (id, value) => {
    setPreferences(prev => ({ ...prev, [id]: value }));
  };

  const rated = Object.values(preferences).filter(v => v > 0).length;
  const mustHaves = Object.values(preferences).filter(v => v === 3).length;

  const visiblePrefs = showAll ? PREFERENCES : PREFERENCES.slice(0, 10);

  if (step === 'intro') {
    return (
      <div style={{ maxWidth: 600, margin: '0 auto', padding: 24, fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif' }}>
        {/* Getting Started Checklist Context */}
        <div style={{ fontSize: 12, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          Getting Started • Step 3 of 5
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
          {[1,2,3,4,5].map(i => (
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
          Rate each item based on how important it is for your family.
        </p>

        <div style={{
          background: '#f0faf7', borderRadius: 12, padding: '14px 18px', marginBottom: 24,
          display: 'flex', alignItems: 'center', gap: 10,
          border: '1px solid #c8e6df',
        }}>
          <span style={{ fontSize: 18 }}>💡</span>
          <span style={{ fontSize: 13, color: '#1b6b5a', fontWeight: 500 }}>
            You can always come back and change these later as {lovedOneName}'s needs evolve.
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
        Getting Started • Step 3 of 5
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {[1,2,3,4,5].map(i => (
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
        <div style={{
          background: '#f0faf7', borderRadius: 20, padding: '6px 14px',
          fontSize: 13, fontWeight: 600, color: '#1b6b5a', flexShrink: 0,
        }}>
          {rated}/24 rated
        </div>
      </div>
      <p style={{ fontSize: 13, color: '#888', margin: '0 0 16px' }}>
        Rate each item. You can update these anytime.
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
        </div>
      )}

      {/* AI Summary Section */}
      <AICareSummary preferences={preferences} name={lovedOneName} />

      <style>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        button:hover {
          filter: brightness(1.05);
        }
      `}</style>
    </div>
  );
}