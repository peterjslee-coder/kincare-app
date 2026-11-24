import { useState } from "react";

// ── Color palette (matches InPlace app) ──
const BLUE = "#1A5276";
const LIGHT_BLUE = "#D6EAF8";
const LIGHTER_BLUE = "#EBF5FB";
const DARK = "#2C3E50";
const GRAY = "#7F8C8D";
const LIGHT_GRAY = "#F4F6F7";
const BORDER = "#E8EEF2";
const GREEN = "#27AE60";
const ORANGE = "#E67E22";
const RED = "#E74C3C";

// ── Mock data ──
const CARE_TEAM = [
  { id: 1, name: "Pete Lee", role: "Family Admin", email: "peterjslee@gmail.com", voiceCloned: true, voiceId: "pete_v1", iPAiAccess: true, isAdmin: true },
  { id: 2, name: "Sara Huber", role: "Caregiver", email: "sara@example.com", voiceCloned: false, voiceId: null, iPAiAccess: true, isAdmin: false },
  { id: 3, name: "Daniel Lee", role: "Family", email: "daniel@example.com", voiceCloned: false, voiceId: null, iPAiAccess: true, isAdmin: false },
  { id: 4, name: "Cary Taker", role: "Caregiver", email: "cary@example.com", voiceCloned: false, voiceId: null, iPAiAccess: false, isAdmin: false },
  { id: 5, name: "Dean Morris", role: "Family", email: "dean@example.com", voiceCloned: false, voiceId: null, iPAiAccess: false, isAdmin: false },
];

const GENERIC_VOICES = [
  { id: "generic_warm_f", name: "Aria (warm, female)", preview: true },
  { id: "generic_calm_m", name: "Marcus (calm, male)", preview: true },
  { id: "generic_gentle_f", name: "Grace (gentle, female)", preview: true },
];

const DEFAULT_VOICE_ROUTES = [
  { id: 1, messageType: "Conversation responses", description: "When Betty talks to the companion", voice: "pete_v1", voiceLabel: "Pete's voice", priority: "high" },
  { id: 2, messageType: "Medication reminders", description: "Scheduled pill reminders", voice: "pete_v1", voiceLabel: "Pete's voice", priority: "high" },
  { id: 3, messageType: "Appointment alerts", description: "Caregiver visits, doctor appointments", voice: "pete_v1", voiceLabel: "Pete's voice", priority: "medium" },
  { id: 4, messageType: "Daily check-ins", description: "Morning greeting, evening wind-down", voice: "pete_v1", voiceLabel: "Pete's voice", priority: "medium" },
  { id: 5, messageType: "System messages", description: "\"I didn't catch that\", connection status", voice: "generic_warm_f", voiceLabel: "Aria (generic)", priority: "low" },
  { id: 6, messageType: "Error / fallback", description: "\"I'm having trouble right now\"", voice: "generic_warm_f", voiceLabel: "Aria (generic)", priority: "low" },
  { id: 7, messageType: "Onboarding", description: "First-time setup, tutorials", voice: "generic_warm_f", voiceLabel: "Aria (generic)", priority: "low" },
];

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      className="relative inline-flex items-center rounded-full transition-colors duration-200"
      style={{
        width: 44, height: 24,
        backgroundColor: checked ? GREEN : "#CBD5E0",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <span
        className="inline-block rounded-full bg-white shadow transition-transform duration-200"
        style={{
          width: 18, height: 18, margin: 3,
          transform: checked ? "translateX(20px)" : "translateX(0)",
        }}
      />
    </button>
  );
}

function Badge({ text, color }) {
  const colors = {
    green: { bg: "#E8F8F0", text: GREEN },
    orange: { bg: "#FEF3E2", text: ORANGE },
    gray: { bg: LIGHT_GRAY, text: GRAY },
    blue: { bg: LIGHTER_BLUE, text: BLUE },
    red: { bg: "#FDEDEC", text: RED },
  };
  const c = colors[color] || colors.gray;
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: c.bg, color: c.text }}>
      {text}
    </span>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <div className="mb-6">
      <div className="mb-3">
        <h3 className="text-base font-semibold" style={{ color: DARK }}>{title}</h3>
        {subtitle && <p className="text-sm mt-0.5" style={{ color: GRAY }}>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function Card({ children, className = "" }) {
  return (
    <div className={`rounded-xl border bg-white ${className}`} style={{ borderColor: BORDER }}>
      {children}
    </div>
  );
}

export default function CompanionAdminMockup() {
  const [activeTab, setActiveTab] = useState("voice-routing");
  const [team, setTeam] = useState(CARE_TEAM);
  const [voiceRoutes, setVoiceRoutes] = useState(DEFAULT_VOICE_ROUTES);
  const [companionEnabled, setCompanionEnabled] = useState(true);
  const [voicePrefs, setVoicePrefs] = useState({ speed: 1.0, stability: 0.5, similarityBoost: 0.8 });
  const [showVoiceDropdown, setShowVoiceDropdown] = useState(null);
  const [creditUsage, setCreditUsage] = useState({ used: 12400, total: 40000 });

  const toggleIPAiAccess = (id) => {
    setTeam(team.map(m => m.id === id ? { ...m, iPAiAccess: !m.iPAiAccess } : m));
  };

  const updateVoiceRoute = (routeId, voiceId, voiceLabel) => {
    setVoiceRoutes(voiceRoutes.map(r => r.id === routeId ? { ...r, voice: voiceId, voiceLabel } : r));
    setShowVoiceDropdown(null);
  };

  const tabs = [
    { id: "voice-routing", label: "Voice Routing" },
    { id: "team-access", label: "Team & iPAi Access" },
    { id: "voice-settings", label: "Voice Tuning" },
    { id: "usage", label: "Usage & Credits" },
  ];

  // Count Pete vs generic messages
  const peteMessages = voiceRoutes.filter(r => r.voice === "pete_v1").length;
  const genericMessages = voiceRoutes.length - peteMessages;

  return (
    <div className="min-h-screen" style={{ backgroundColor: LIGHT_GRAY, fontFamily: "'Segoe UI', system-ui, sans-serif" }}>

      {/* ── Top nav bar (simulates InPlace app) ── */}
      <div className="px-6 py-3 flex items-center justify-between" style={{ backgroundColor: BLUE }}>
        <div className="flex items-center gap-3">
          <span className="text-white font-bold text-lg">InPlace</span>
          <span className="text-sm" style={{ color: "#85C1E9" }}>/ Betty's Profile / Voice Companion</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-sm font-bold" style={{ color: BLUE }}>P</div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6">

        {/* ── Header ── */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: DARK }}>Betty's Voice Companion</h1>
            <p className="text-sm mt-1" style={{ color: GRAY }}>
              Manage how the AI assistant speaks to Betty, who on the care team can use iPAi, and monitor usage.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium" style={{ color: companionEnabled ? GREEN : GRAY }}>
              {companionEnabled ? "Active" : "Paused"}
            </span>
            <Toggle checked={companionEnabled} onChange={setCompanionEnabled} />
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="flex gap-1 mb-6 p-1 rounded-lg" style={{ backgroundColor: "#E8EEF2" }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all"
              style={{
                backgroundColor: activeTab === tab.id ? "white" : "transparent",
                color: activeTab === tab.id ? BLUE : GRAY,
                boxShadow: activeTab === tab.id ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ──────────── VOICE ROUTING TAB ──────────── */}
        {activeTab === "voice-routing" && (
          <>
            <Section
              title="Voice Routing"
              subtitle="Choose which voice speaks for each type of message. Pete's cloned voice uses ElevenLabs credits; generic voices are lower-cost."
            >
              <Card>
                {/* Summary bar */}
                <div className="px-4 py-3 flex items-center gap-4" style={{ backgroundColor: LIGHTER_BLUE, borderBottom: `1px solid ${BORDER}`, borderRadius: "12px 12px 0 0" }}>
                  <Badge text={`${peteMessages} use Pete's voice`} color="blue" />
                  <Badge text={`${genericMessages} use generic voice`} color="gray" />
                  <span className="text-xs" style={{ color: GRAY }}>
                    Estimated savings: ~{Math.round(genericMessages / voiceRoutes.length * 100)}% fewer credits on cloned voice
                  </span>
                </div>

                {/* Route rows */}
                {voiceRoutes.map((route, i) => (
                  <div
                    key={route.id}
                    className="px-4 py-3 flex items-center gap-4"
                    style={{
                      borderBottom: i < voiceRoutes.length - 1 ? `1px solid ${BORDER}` : "none",
                      backgroundColor: i % 2 === 1 ? "#FAFCFE" : "white",
                    }}
                  >
                    {/* Message type */}
                    <div className="flex-1">
                      <p className="text-sm font-medium" style={{ color: DARK }}>{route.messageType}</p>
                      <p className="text-xs" style={{ color: GRAY }}>{route.description}</p>
                    </div>

                    {/* Priority badge */}
                    <Badge
                      text={route.priority}
                      color={route.priority === "high" ? "green" : route.priority === "medium" ? "orange" : "gray"}
                    />

                    {/* Voice selector */}
                    <div className="relative">
                      <button
                        onClick={() => setShowVoiceDropdown(showVoiceDropdown === route.id ? null : route.id)}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-all hover:shadow-sm"
                        style={{
                          borderColor: BORDER,
                          backgroundColor: route.voice === "pete_v1" ? LIGHTER_BLUE : LIGHT_GRAY,
                          color: DARK,
                          minWidth: 180,
                        }}
                      >
                        <span style={{ fontSize: 14 }}>{route.voice === "pete_v1" ? "🎙️" : "🔊"}</span>
                        <span className="flex-1 text-left">{route.voiceLabel}</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={GRAY} strokeWidth="2">
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>

                      {/* Dropdown */}
                      {showVoiceDropdown === route.id && (
                        <div className="absolute right-0 top-full mt-1 bg-white rounded-lg border shadow-lg z-10" style={{ borderColor: BORDER, width: 220 }}>
                          <button
                            onClick={() => updateVoiceRoute(route.id, "pete_v1", "Pete's voice")}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center gap-2 rounded-t-lg"
                            style={{ color: DARK }}
                          >
                            <span>🎙️</span> Pete's voice {route.voice === "pete_v1" && <span style={{ color: GREEN }}>✓</span>}
                          </button>
                          {GENERIC_VOICES.map((gv, gi) => (
                            <button
                              key={gv.id}
                              onClick={() => updateVoiceRoute(route.id, gv.id, gv.name.split(" (")[0] + " (generic)")}
                              className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center gap-2 ${gi === GENERIC_VOICES.length - 1 ? "rounded-b-lg" : ""}`}
                              style={{ color: DARK }}
                            >
                              <span>🔊</span> {gv.name} {route.voice === gv.id && <span style={{ color: GREEN }}>✓</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </Card>
            </Section>

            {/* Credit impact callout */}
            <div className="rounded-xl p-4" style={{ backgroundColor: "#FEF9E7", border: "1px solid #F9E79F" }}>
              <div className="flex items-start gap-3">
                <span className="text-xl">💡</span>
                <div>
                  <p className="text-sm font-medium" style={{ color: "#7D6608" }}>Credit-saving tip</p>
                  <p className="text-sm mt-1" style={{ color: DARK }}>
                    System messages, errors, and onboarding happen frequently but don't carry emotional weight.
                    Using a generic voice for these saves roughly 30-40% of your monthly credits without affecting Betty's experience.
                  </p>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ──────────── TEAM ACCESS TAB ──────────── */}
        {activeTab === "team-access" && (
          <Section
            title="Care Team & iPAi Access"
            subtitle="Control who sees the iPAi Assistant in their sidebar. Only enabled members can chat with iPAi."
          >
            <Card>
              {/* Header row */}
              <div className="px-4 py-3 flex items-center gap-4 text-xs font-semibold" style={{ color: GRAY, backgroundColor: LIGHT_GRAY, borderBottom: `1px solid ${BORDER}`, borderRadius: "12px 12px 0 0" }}>
                <div style={{ width: 220 }}>TEAM MEMBER</div>
                <div style={{ width: 100 }}>ROLE</div>
                <div style={{ width: 120 }}>VOICE CLONED</div>
                <div style={{ width: 120, textAlign: "center" }}>iPAi SIDEBAR</div>
              </div>

              {team.map((member, i) => (
                <div
                  key={member.id}
                  className="px-4 py-3 flex items-center gap-4"
                  style={{
                    borderBottom: i < team.length - 1 ? `1px solid ${BORDER}` : "none",
                    backgroundColor: i % 2 === 1 ? "#FAFCFE" : "white",
                  }}
                >
                  {/* Name + email */}
                  <div style={{ width: 220 }}>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                        style={{ backgroundColor: member.isAdmin ? BLUE : "#85C1E9" }}
                      >
                        {member.name.split(" ").map(n => n[0]).join("")}
                      </div>
                      <div>
                        <p className="text-sm font-medium" style={{ color: DARK }}>
                          {member.name} {member.isAdmin && <Badge text="Admin" color="blue" />}
                        </p>
                        <p className="text-xs" style={{ color: GRAY }}>{member.email}</p>
                      </div>
                    </div>
                  </div>

                  {/* Role */}
                  <div style={{ width: 100 }}>
                    <Badge
                      text={member.role}
                      color={member.role === "Family Admin" ? "blue" : member.role === "Caregiver" ? "green" : "gray"}
                    />
                  </div>

                  {/* Voice clone status */}
                  <div style={{ width: 120 }}>
                    {member.voiceCloned ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm">🎙️</span>
                        <span className="text-xs" style={{ color: GREEN }}>Active</span>
                      </div>
                    ) : (
                      <button
                        className="text-xs px-2 py-1 rounded border"
                        style={{ borderColor: BORDER, color: BLUE }}
                      >
                        + Record voice
                      </button>
                    )}
                  </div>

                  {/* iPAi toggle */}
                  <div style={{ width: 120, textAlign: "center" }} className="flex justify-center">
                    <Toggle
                      checked={member.iPAiAccess}
                      onChange={() => toggleIPAiAccess(member.id)}
                      disabled={member.isAdmin}
                    />
                  </div>
                </div>
              ))}
            </Card>

            <div className="mt-4 rounded-xl p-4" style={{ backgroundColor: LIGHTER_BLUE, border: `1px solid ${LIGHT_BLUE}` }}>
              <p className="text-sm" style={{ color: DARK }}>
                <strong>How iPAi Access works:</strong> When enabled, the team member sees the iPAi Assistant in their app sidebar and can chat with it for care coordination, scheduling help, and care insights. When disabled, the sidebar item is hidden — they can still use all other InPlace features. Admins always have access.
              </p>
            </div>
          </Section>
        )}

        {/* ──────────── VOICE TUNING TAB ──────────── */}
        {activeTab === "voice-settings" && (
          <>
            <Section
              title="Betty's Voice Preferences"
              subtitle="Set the baseline for how the companion speaks to Betty. The system adapts automatically from these starting points based on Betty's feedback."
            >
              <Card>
                <div className="p-5">
                  {/* Speed */}
                  <div className="mb-5">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-sm font-medium" style={{ color: DARK }}>Speaking Speed</p>
                        <p className="text-xs" style={{ color: GRAY }}>0.7 (very slow) to 1.2 (brisk). Betty can say "slow down" to adjust in real time.</p>
                      </div>
                      <span className="text-lg font-semibold" style={{ color: BLUE }}>{voicePrefs.speed.toFixed(2)}x</span>
                    </div>
                    <input
                      type="range" min="0.7" max="1.2" step="0.05"
                      value={voicePrefs.speed}
                      onChange={(e) => setVoicePrefs({ ...voicePrefs, speed: parseFloat(e.target.value) })}
                      className="w-full accent-blue-600"
                      style={{ accentColor: BLUE }}
                    />
                    <div className="flex justify-between text-xs mt-1" style={{ color: GRAY }}>
                      <span>Slower (clearer)</span>
                      <span>Default</span>
                      <span>Faster</span>
                    </div>
                  </div>

                  {/* Stability */}
                  <div className="mb-5">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-sm font-medium" style={{ color: DARK }}>Voice Stability</p>
                        <p className="text-xs" style={{ color: GRAY }}>Higher = more consistent and clear. Lower = more expressive and natural.</p>
                      </div>
                      <span className="text-lg font-semibold" style={{ color: BLUE }}>{(voicePrefs.stability * 100).toFixed(0)}%</span>
                    </div>
                    <input
                      type="range" min="0" max="1" step="0.05"
                      value={voicePrefs.stability}
                      onChange={(e) => setVoicePrefs({ ...voicePrefs, stability: parseFloat(e.target.value) })}
                      className="w-full"
                      style={{ accentColor: BLUE }}
                    />
                    <div className="flex justify-between text-xs mt-1" style={{ color: GRAY }}>
                      <span>Expressive</span>
                      <span>Balanced</span>
                      <span>Consistent</span>
                    </div>
                  </div>

                  {/* Similarity */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-sm font-medium" style={{ color: DARK }}>Voice Similarity</p>
                        <p className="text-xs" style={{ color: GRAY }}>How closely the output matches Pete's original recording. Keep high for recognition.</p>
                      </div>
                      <span className="text-lg font-semibold" style={{ color: BLUE }}>{(voicePrefs.similarityBoost * 100).toFixed(0)}%</span>
                    </div>
                    <input
                      type="range" min="0" max="1" step="0.05"
                      value={voicePrefs.similarityBoost}
                      onChange={(e) => setVoicePrefs({ ...voicePrefs, similarityBoost: parseFloat(e.target.value) })}
                      className="w-full"
                      style={{ accentColor: BLUE }}
                    />
                    <div className="flex justify-between text-xs mt-1" style={{ color: GRAY }}>
                      <span>Less like Pete</span>
                      <span>Balanced</span>
                      <span>Most like Pete</span>
                    </div>
                  </div>
                </div>
              </Card>
            </Section>

            {/* Recent adaptations log */}
            <Section
              title="Recent Automatic Adjustments"
              subtitle="The companion adjusts voice settings when Betty asks. These are logged so you can see patterns."
            >
              <Card>
                <div className="divide-y" style={{ borderColor: BORDER }}>
                  {[
                    { time: "Today, 10:15 AM", action: "Speed reduced to 0.85x", trigger: "Betty said \"What?\" twice", icon: "🔽" },
                    { time: "Yesterday, 2:30 PM", action: "Volume gain increased to 1.5x", trigger: "Betty said \"I can't hear you\"", icon: "🔊" },
                    { time: "Mar 21, 9:00 AM", action: "Speed returned to 0.95x", trigger: "Gradual drift back (3 conversations without issues)", icon: "↩️" },
                  ].map((log, i) => (
                    <div key={i} className="px-4 py-3 flex items-center gap-3">
                      <span className="text-lg">{log.icon}</span>
                      <div className="flex-1">
                        <p className="text-sm font-medium" style={{ color: DARK }}>{log.action}</p>
                        <p className="text-xs" style={{ color: GRAY }}>{log.trigger}</p>
                      </div>
                      <span className="text-xs" style={{ color: GRAY }}>{log.time}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </Section>
          </>
        )}

        {/* ──────────── USAGE TAB ──────────── */}
        {activeTab === "usage" && (
          <>
            <Section
              title="ElevenLabs Credit Usage"
              subtitle="40,000 credits/month on the Starter plan. ~6 credits per word of generated speech."
            >
              <Card>
                <div className="p-5">
                  {/* Usage bar */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium" style={{ color: DARK }}>
                      {creditUsage.used.toLocaleString()} / {creditUsage.total.toLocaleString()} credits used
                    </span>
                    <span className="text-sm font-semibold" style={{ color: creditUsage.used / creditUsage.total > 0.8 ? ORANGE : GREEN }}>
                      {Math.round((1 - creditUsage.used / creditUsage.total) * 100)}% remaining
                    </span>
                  </div>
                  <div className="w-full rounded-full h-3" style={{ backgroundColor: LIGHT_GRAY }}>
                    <div
                      className="rounded-full h-3 transition-all duration-500"
                      style={{
                        width: `${(creditUsage.used / creditUsage.total) * 100}%`,
                        backgroundColor: creditUsage.used / creditUsage.total > 0.8 ? ORANGE : BLUE,
                      }}
                    />
                  </div>
                  <p className="text-xs mt-2" style={{ color: GRAY }}>Resets on April 1, 2026</p>

                  {/* Breakdown */}
                  <div className="mt-5 grid grid-cols-3 gap-4">
                    {[
                      { label: "Pete's voice", credits: 9200, color: BLUE, icon: "🎙️" },
                      { label: "Generic voice", credits: 2100, color: GRAY, icon: "🔊" },
                      { label: "Remaining", credits: creditUsage.total - creditUsage.used, color: GREEN, icon: "💰" },
                    ].map((item, i) => (
                      <div key={i} className="text-center p-3 rounded-lg" style={{ backgroundColor: LIGHT_GRAY }}>
                        <p className="text-xl mb-1">{item.icon}</p>
                        <p className="text-lg font-bold" style={{ color: item.color }}>{item.credits.toLocaleString()}</p>
                        <p className="text-xs" style={{ color: GRAY }}>{item.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            </Section>

            {/* Daily breakdown */}
            <Section title="This Week" subtitle="Daily credit consumption">
              <Card>
                <div className="p-4">
                  {[
                    { day: "Today (Mon)", pete: 820, generic: 180, convos: 2, reminders: 5 },
                    { day: "Sunday", pete: 1400, generic: 240, convos: 3, reminders: 6 },
                    { day: "Saturday", pete: 600, generic: 150, convos: 1, reminders: 5 },
                    { day: "Friday", pete: 1800, generic: 310, convos: 4, reminders: 6 },
                    { day: "Thursday", pete: 1200, generic: 200, convos: 2, reminders: 5 },
                  ].map((row, i) => (
                    <div
                      key={i}
                      className="flex items-center py-2.5"
                      style={{ borderBottom: i < 4 ? `1px solid ${BORDER}` : "none" }}
                    >
                      <span className="text-sm w-32" style={{ color: DARK }}>{row.day}</span>
                      <div className="flex-1 flex items-center gap-1">
                        <div className="rounded h-4" style={{ width: `${row.pete / 25}%`, backgroundColor: BLUE, minWidth: 4 }} />
                        <div className="rounded h-4" style={{ width: `${row.generic / 25}%`, backgroundColor: "#BDC3C7", minWidth: 4 }} />
                      </div>
                      <span className="text-xs w-20 text-right" style={{ color: GRAY }}>
                        {(row.pete + row.generic).toLocaleString()} cr
                      </span>
                      <span className="text-xs w-24 text-right" style={{ color: GRAY }}>
                        {row.convos} chats · {row.reminders} reminders
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            </Section>

            {/* Projection */}
            <div className="rounded-xl p-4" style={{ backgroundColor: LIGHTER_BLUE, border: `1px solid ${LIGHT_BLUE}` }}>
              <p className="text-sm" style={{ color: DARK }}>
                <strong>Projected monthly usage:</strong> At current pace (~2,300 credits/day), you'll use about 69,000 credits this month.
                The Starter plan covers 40,000. Consider upgrading to Creator ($22/mo, 100,000 credits) or moving more message types to generic voices.
              </p>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
