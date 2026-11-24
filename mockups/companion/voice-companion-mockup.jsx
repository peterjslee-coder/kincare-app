import { useState, useEffect, useRef } from "react";

const STATES = {
  IDLE: "idle",
  LISTENING: "listening",
  THINKING: "thinking",
  SPEAKING: "speaking",
};

// Animated waveform bars
function Waveform({ active, color = "#1A5276", barCount = 5 }) {
  return (
    <div className="flex items-center justify-center gap-1.5" style={{ height: 48 }}>
      {Array.from({ length: barCount }).map((_, i) => (
        <div
          key={i}
          className="rounded-full transition-all duration-300"
          style={{
            width: 6,
            backgroundColor: color,
            opacity: active ? 0.8 : 0.25,
            height: active ? `${20 + Math.sin(Date.now() / 200 + i * 1.2) * 20}px` : 6,
            animation: active ? `wave 0.8s ease-in-out ${i * 0.1}s infinite alternate` : "none",
          }}
        />
      ))}
    </div>
  );
}

// Pulsing ring around the talk button
function PulseRing({ active, color }) {
  if (!active) return null;
  return (
    <>
      <div
        className="absolute inset-0 rounded-full"
        style={{
          border: `3px solid ${color}`,
          animation: "pulse-ring 1.5s ease-out infinite",
          opacity: 0.4,
        }}
      />
      <div
        className="absolute rounded-full"
        style={{
          inset: -12,
          border: `2px solid ${color}`,
          animation: "pulse-ring 1.5s ease-out 0.3s infinite",
          opacity: 0.2,
          borderRadius: "50%",
        }}
      />
    </>
  );
}

// Floating message bubble
function MessageBubble({ text, from, timestamp }) {
  const isCompanion = from === "companion";
  return (
    <div className={`flex ${isCompanion ? "justify-start" : "justify-end"} mb-3`}>
      <div
        className="max-w-xs px-4 py-3 rounded-2xl shadow-sm"
        style={{
          backgroundColor: isCompanion ? "#EBF5FB" : "#F0F4F0",
          borderBottomLeftRadius: isCompanion ? 4 : 20,
          borderBottomRightRadius: isCompanion ? 20 : 4,
        }}
      >
        <p className="text-base leading-relaxed" style={{ color: "#2C3E50" }}>
          {text}
        </p>
        <p className="text-xs mt-1" style={{ color: "#95A5A6" }}>
          {timestamp}
        </p>
      </div>
    </div>
  );
}

// Reminder card
function ReminderCard({ text, time, icon }) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl mb-2 shadow-sm"
      style={{ backgroundColor: "#FEF9E7", border: "1px solid #F9E79F" }}
    >
      <span className="text-2xl">{icon}</span>
      <div className="flex-1">
        <p className="text-sm font-semibold" style={{ color: "#7D6608" }}>{time}</p>
        <p className="text-base" style={{ color: "#2C3E50" }}>{text}</p>
      </div>
    </div>
  );
}

export default function VoiceCompanionMockup() {
  const [appState, setAppState] = useState(STATES.IDLE);
  const [currentView, setCurrentView] = useState("home"); // home, chat, reminders
  const [messages, setMessages] = useState([
    { text: "Good morning, Mom! How did you sleep?", from: "companion", timestamp: "8:02 AM" },
    { text: "Pretty good, I think I woke up once", from: "betty", timestamp: "8:02 AM" },
    { text: "That's not bad at all. Cary's coming at 2 today — she mentioned she'd bring that puzzle you liked.", from: "companion", timestamp: "8:03 AM" },
  ]);
  const [animKey, setAnimKey] = useState(0);
  const intervalRef = useRef(null);

  // Animate waveform when active
  useEffect(() => {
    if (appState === STATES.LISTENING || appState === STATES.SPEAKING) {
      intervalRef.current = setInterval(() => setAnimKey((k) => k + 1), 100);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [appState]);

  // Simulate conversation flow
  const handleTalkPress = () => {
    if (appState === STATES.IDLE) {
      setAppState(STATES.LISTENING);
    }
  };

  const handleTalkRelease = () => {
    if (appState === STATES.LISTENING) {
      setAppState(STATES.THINKING);
      setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          { text: "Can you remind me when to take my pill?", from: "betty", timestamp: "Now" },
        ]);
        setAppState(STATES.SPEAKING);
        setTimeout(() => {
          setMessages((prev) => [
            ...prev,
            {
              text: "Sure, Mom. Your Tylenol is at 10 o'clock — about an hour from now. I'll give you a heads up when it's time.",
              from: "companion",
              timestamp: "Now",
            },
          ]);
          setAppState(STATES.IDLE);
        }, 3000);
      }, 1500);
    }
  };

  const stateConfig = {
    [STATES.IDLE]: { label: "Talk to Pete", color: "#1A5276", bgColor: "#1A5276", sublabel: "Hold to speak" },
    [STATES.LISTENING]: { label: "Listening...", color: "#27AE60", bgColor: "#27AE60", sublabel: "Release when done" },
    [STATES.THINKING]: { label: "Thinking...", color: "#E67E22", bgColor: "#E67E22", sublabel: "" },
    [STATES.SPEAKING]: { label: "Pete is speaking", color: "#1A5276", bgColor: "#D6EAF8", sublabel: "" },
  };

  const config = stateConfig[appState];

  // ── HOME VIEW ──
  if (currentView === "home") {
    return (
      <div
        className="flex flex-col min-h-screen"
        style={{ backgroundColor: "#FAFCFE", fontFamily: "'Segoe UI', system-ui, sans-serif" }}
      >
        <style>{`
          @keyframes wave {
            0% { transform: scaleY(0.4); }
            100% { transform: scaleY(1); }
          }
          @keyframes pulse-ring {
            0% { transform: scale(1); opacity: 0.4; }
            100% { transform: scale(1.3); opacity: 0; }
          }
          @keyframes gentle-bob {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-4px); }
          }
          @keyframes fade-in {
            from { opacity: 0; transform: translateY(8px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>

        {/* Header */}
        <div className="px-6 pt-8 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-lg" style={{ color: "#95A5A6" }}>Good morning</p>
              <p className="text-3xl font-bold" style={{ color: "#2C3E50" }}>Betty</p>
            </div>
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-white text-lg font-bold"
              style={{ backgroundColor: "#1A5276" }}
            >
              B
            </div>
          </div>
        </div>

        {/* Status card */}
        <div className="px-6 mb-6">
          <div
            className="rounded-2xl p-5 shadow-sm"
            style={{ backgroundColor: "#EBF5FB", border: "1px solid #D6EAF8" }}
          >
            <div className="flex items-center gap-3 mb-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: "#27AE60", animation: "gentle-bob 2s ease-in-out infinite" }}
              />
              <p className="text-sm font-medium" style={{ color: "#1A5276" }}>
                Pete's companion is active
              </p>
            </div>
            <p className="text-sm" style={{ color: "#5D6D7E" }}>
              Last check-in: 8:03 AM · Next reminder: Tylenol at 10:00 AM
            </p>
          </div>
        </div>

        {/* Main talk button */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 -mt-4">
          <div className="relative mb-6">
            <PulseRing active={appState === STATES.LISTENING} color={config.color} />
            <button
              onMouseDown={handleTalkPress}
              onMouseUp={handleTalkRelease}
              onTouchStart={handleTalkPress}
              onTouchEnd={handleTalkRelease}
              className="relative w-40 h-40 rounded-full flex flex-col items-center justify-center shadow-lg transition-all duration-300 select-none"
              style={{
                backgroundColor: appState === STATES.SPEAKING ? "#D6EAF8" : config.bgColor,
                transform: appState === STATES.LISTENING ? "scale(1.05)" : "scale(1)",
                cursor: "pointer",
              }}
            >
              {appState === STATES.SPEAKING ? (
                <Waveform active={true} color="#1A5276" barCount={7} key={animKey} />
              ) : appState === STATES.LISTENING ? (
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                  <rect x="9" y="2" width="6" height="11" rx="3" />
                  <path d="M5 10a7 7 0 0 0 14 0" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              ) : appState === STATES.THINKING ? (
                <div className="flex gap-2">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="w-3 h-3 rounded-full bg-white"
                      style={{
                        animation: `gentle-bob 0.8s ease-in-out ${i * 0.15}s infinite`,
                        opacity: 0.8,
                      }}
                    />
                  ))}
                </div>
              ) : (
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                  <rect x="9" y="2" width="6" height="11" rx="3" />
                  <path d="M5 10a7 7 0 0 0 14 0" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              )}
            </button>
          </div>

          <p
            className="text-2xl font-semibold mb-1 transition-all duration-300"
            style={{ color: config.color }}
          >
            {config.label}
          </p>
          <p className="text-base" style={{ color: "#95A5A6" }}>
            {config.sublabel}
          </p>
        </div>

        {/* Quick actions */}
        <div className="px-6 pb-4">
          <div className="flex gap-3">
            <button
              onClick={() => setCurrentView("chat")}
              className="flex-1 py-4 rounded-xl text-center shadow-sm transition-all hover:shadow-md"
              style={{ backgroundColor: "white", border: "1px solid #E8EEF2" }}
            >
              <p className="text-2xl mb-1">💬</p>
              <p className="text-sm font-medium" style={{ color: "#2C3E50" }}>Chat History</p>
            </button>
            <button
              onClick={() => setCurrentView("reminders")}
              className="flex-1 py-4 rounded-xl text-center shadow-sm transition-all hover:shadow-md"
              style={{ backgroundColor: "white", border: "1px solid #E8EEF2" }}
            >
              <p className="text-2xl mb-1">🔔</p>
              <p className="text-sm font-medium" style={{ color: "#2C3E50" }}>Reminders</p>
            </button>
            <button
              className="flex-1 py-4 rounded-xl text-center shadow-sm transition-all hover:shadow-md"
              style={{ backgroundColor: "white", border: "1px solid #E8EEF2" }}
            >
              <p className="text-2xl mb-1">📞</p>
              <p className="text-sm font-medium" style={{ color: "#2C3E50" }}>Call Pete</p>
            </button>
          </div>
        </div>

        {/* Bottom bar */}
        <div
          className="px-6 py-3 text-center"
          style={{ backgroundColor: "#F4F6F7", borderTop: "1px solid #E8EEF2" }}
        >
          <p className="text-xs" style={{ color: "#ABB2B9" }}>
            iPAi Voice Companion · Set up by Pete
          </p>
        </div>
      </div>
    );
  }

  // ── CHAT VIEW ──
  if (currentView === "chat") {
    return (
      <div
        className="flex flex-col min-h-screen"
        style={{ backgroundColor: "#FAFCFE", fontFamily: "'Segoe UI', system-ui, sans-serif" }}
      >
        <style>{`
          @keyframes wave {
            0% { transform: scaleY(0.4); }
            100% { transform: scaleY(1); }
          }
          @keyframes pulse-ring {
            0% { transform: scale(1); opacity: 0.4; }
            100% { transform: scale(1.3); opacity: 0; }
          }
          @keyframes gentle-bob {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-4px); }
          }
        `}</style>

        {/* Chat header */}
        <div
          className="px-6 pt-6 pb-4 flex items-center gap-4"
          style={{ borderBottom: "1px solid #E8EEF2" }}
        >
          <button
            onClick={() => setCurrentView("home")}
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "#EBF5FB" }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1A5276" strokeWidth="2.5">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="flex items-center gap-3 flex-1">
            <div
              className="w-11 h-11 rounded-full flex items-center justify-center text-white text-lg font-bold"
              style={{ backgroundColor: "#1A5276" }}
            >
              P
            </div>
            <div>
              <p className="text-lg font-semibold" style={{ color: "#2C3E50" }}>
                Pete's Companion
              </p>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#27AE60" }} />
                <p className="text-xs" style={{ color: "#27AE60" }}>Active</p>
              </div>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <p className="text-center text-xs mb-4" style={{ color: "#ABB2B9" }}>
            Today, March 23
          </p>
          {messages.map((msg, i) => (
            <MessageBubble key={i} text={msg.text} from={msg.from} timestamp={msg.timestamp} />
          ))}

          {appState === STATES.SPEAKING && (
            <div className="flex justify-start mb-3">
              <div
                className="px-4 py-3 rounded-2xl"
                style={{ backgroundColor: "#EBF5FB", borderBottomLeftRadius: 4 }}
              >
                <Waveform active={true} color="#1A5276" barCount={5} key={animKey} />
              </div>
            </div>
          )}
        </div>

        {/* Talk button (compact) */}
        <div
          className="px-6 py-4 flex items-center justify-center gap-4"
          style={{ backgroundColor: "white", borderTop: "1px solid #E8EEF2" }}
        >
          <div className="relative">
            <PulseRing active={appState === STATES.LISTENING} color={config.color} />
            <button
              onMouseDown={handleTalkPress}
              onMouseUp={handleTalkRelease}
              onTouchStart={handleTalkPress}
              onTouchEnd={handleTalkRelease}
              className="relative w-16 h-16 rounded-full flex items-center justify-center shadow-md transition-all duration-200"
              style={{
                backgroundColor: appState === STATES.SPEAKING ? "#D6EAF8" : config.bgColor,
                transform: appState === STATES.LISTENING ? "scale(1.08)" : "scale(1)",
              }}
            >
              {appState === STATES.SPEAKING ? (
                <Waveform active={true} color="#1A5276" barCount={3} key={animKey} />
              ) : (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                  <rect x="9" y="2" width="6" height="11" rx="3" />
                  <path d="M5 10a7 7 0 0 0 14 0" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              )}
            </button>
          </div>
          <p className="text-sm" style={{ color: "#95A5A6" }}>
            {config.sublabel || config.label}
          </p>
        </div>
      </div>
    );
  }

  // ── REMINDERS VIEW ──
  if (currentView === "reminders") {
    return (
      <div
        className="flex flex-col min-h-screen"
        style={{ backgroundColor: "#FAFCFE", fontFamily: "'Segoe UI', system-ui, sans-serif" }}
      >
        {/* Header */}
        <div
          className="px-6 pt-6 pb-4 flex items-center gap-4"
          style={{ borderBottom: "1px solid #E8EEF2" }}
        >
          <button
            onClick={() => setCurrentView("home")}
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "#EBF5FB" }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1A5276" strokeWidth="2.5">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <p className="text-xl font-semibold" style={{ color: "#2C3E50" }}>
            Today's Reminders
          </p>
        </div>

        <div className="flex-1 px-6 py-4">
          {/* Completed */}
          <p className="text-sm font-medium mb-3" style={{ color: "#95A5A6" }}>
            COMPLETED
          </p>
          <div className="mb-6 opacity-60">
            <div
              className="flex items-center gap-3 px-4 py-3 rounded-xl mb-2"
              style={{ backgroundColor: "#F0F4F0", border: "1px solid #E0E8E0" }}
            >
              <span className="text-2xl">✅</span>
              <div className="flex-1">
                <p className="text-sm font-semibold line-through" style={{ color: "#7D6608" }}>8:00 AM</p>
                <p className="text-base line-through" style={{ color: "#2C3E50" }}>
                  Good morning check-in
                </p>
              </div>
            </div>
          </div>

          {/* Upcoming */}
          <p className="text-sm font-medium mb-3" style={{ color: "#95A5A6" }}>
            UPCOMING
          </p>
          <ReminderCard icon="💊" time="10:00 AM" text="Take Tylenol with water" />
          <ReminderCard icon="🥗" time="12:00 PM" text="Lunch — leftover soup in the fridge" />
          <ReminderCard icon="👋" time="2:00 PM" text="Cary arrives for afternoon visit" />
          <ReminderCard icon="🚶" time="3:00 PM" text="Short walk if the weather's nice" />
          <ReminderCard icon="💊" time="6:00 PM" text="Evening medication" />

          <div className="mt-6 text-center">
            <p className="text-sm" style={{ color: "#ABB2B9" }}>
              Reminders set by Pete and the care team
            </p>
          </div>
        </div>

        {/* Bottom talk button */}
        <div
          className="px-6 py-4 flex items-center justify-center"
          style={{ backgroundColor: "white", borderTop: "1px solid #E8EEF2" }}
        >
          <button
            onClick={() => setCurrentView("home")}
            className="px-8 py-3 rounded-full text-white font-semibold shadow-md"
            style={{ backgroundColor: "#1A5276" }}
          >
            Talk to Pete
          </button>
        </div>
      </div>
    );
  }
}
