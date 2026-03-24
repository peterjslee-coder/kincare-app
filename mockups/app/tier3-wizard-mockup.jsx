import { useState } from "react";

const STEPS = [
  { id: "add-recipient", label: "Add Your Loved One", icon: "👤" },
  { id: "care-prefs", label: "Care Preferences", icon: "💚" },
  { id: "verify-identity", label: "Verify Your Identity", icon: "🪪" },
  { id: "attest", label: "Attest & Notify", icon: "✍️" },
  { id: "review", label: "Review & Confirm", icon: "✅" },
];

// ─── Simulated data ───
const CARE_TYPES = [
  "Bathing / Shower Help",
  "Meal Prep / Feeding",
  "Medication Reminders",
  "Mobility / Transfer Help",
  "Companionship / Conversation",
  "Light Housekeeping",
  "Transportation / Errands",
  "Overnight Supervision",
  "Toileting / Incontinence",
  "Exercise / Physical Activity",
];

export default function Tier3WizardMockup() {
  const [step, setStep] = useState(0);
  const [recipient, setRecipient] = useState({
    firstName: "", lastName: "", phone: "", email: "",
    address: "", city: "", state: "", zip: "",
    relationship: "mother",
  });
  const [prefs, setPrefs] = useState({});
  const [attestData, setAttest] = useState({
    accepted: false,
    notifyMethod: "email",
  });
  const [saved, setSaved] = useState(false);

  const current = STEPS[step];

  const canAdvanceStep0 = recipient.firstName && recipient.phone;
  const canAdvanceStep1 = Object.keys(prefs).length >= 3;

  // ─── Step progress bar ───
  const ProgressBar = () => (
    <div style={{ display: "flex", gap: 0, marginBottom: 28 }}>
      {STEPS.map((s, i) => {
        const done = i < step;
        const active = i === step;
        const isLast = i === STEPS.length - 1;
        return (
          <div key={s.id} style={{ flex: 1, display: "flex", alignItems: "center" }}>
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", flex: 1,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: "50%",
                background: done ? "#2e7d6f" : active ? "#e8734a" : "#e0e0e0",
                color: done || active ? "#fff" : "#999",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 16, fontWeight: 600,
                transition: "all 0.3s ease",
                boxShadow: active ? "0 0 0 3px rgba(232,115,74,0.3)" : "none",
              }}>
                {done ? "✓" : s.icon}
              </div>
              <div style={{
                fontSize: 10, marginTop: 4, color: active ? "#e8734a" : done ? "#2e7d6f" : "#aaa",
                fontWeight: active ? 700 : 400, textAlign: "center", maxWidth: 72,
              }}>
                {s.label}
              </div>
            </div>
            {!isLast && (
              <div style={{
                height: 2, flex: 1, background: done ? "#2e7d6f" : "#e0e0e0",
                marginTop: -16, minWidth: 20,
              }} />
            )}
          </div>
        );
      })}
    </div>
  );

  // ─── Step 1: Add Recipient ───
  const Step0 = () => (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: "#1a3c34", margin: "0 0 4px" }}>
        Who needs care?
      </h2>
      <p style={{ color: "#666", fontSize: 14, margin: "0 0 20px" }}>
        Tell us about your loved one. We'll use this to set up their care profile.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="First Name *" value={recipient.firstName}
          onChange={v => setRecipient(r => ({ ...r, firstName: v }))} placeholder="e.g. Betty" />
        <Field label="Last Name" value={recipient.lastName}
          onChange={v => setRecipient(r => ({ ...r, lastName: v }))} placeholder="e.g. Lee" />
      </div>

      <Field label="Your relationship" value={recipient.relationship}
        onChange={v => setRecipient(r => ({ ...r, relationship: v }))}
        type="select"
        options={["mother", "father", "grandmother", "grandfather", "spouse", "sibling", "aunt", "uncle", "friend", "other"]} />

      <div style={{ borderTop: "1px solid #eee", margin: "20px 0", paddingTop: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: "#1a3c34", margin: "0 0 12px" }}>
          Contact Information
        </h3>
        <p style={{ fontSize: 12, color: "#888", margin: "-8px 0 12px", lineHeight: 1.5 }}>
          This info will be used to contact your loved one and verify their awareness of care arrangements.
        </p>
        <Field label="Phone *" value={recipient.phone}
          onChange={v => setRecipient(r => ({ ...r, phone: v }))} placeholder="(555) 123-4567" />
        <Field label="Email" value={recipient.email}
          onChange={v => setRecipient(r => ({ ...r, email: v }))} placeholder="betty@email.com" />
      </div>

      <div style={{ borderTop: "1px solid #eee", margin: "20px 0", paddingTop: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: "#1a3c34", margin: "0 0 12px" }}>
          Care Address
        </h3>
        <Field label="Street Address" value={recipient.address}
          onChange={v => setRecipient(r => ({ ...r, address: v }))} placeholder="123 Main St" />
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
          <Field label="City" value={recipient.city}
            onChange={v => setRecipient(r => ({ ...r, city: v }))} placeholder="Blacksburg" />
          <Field label="State" value={recipient.state}
            onChange={v => setRecipient(r => ({ ...r, state: v }))} placeholder="VA" />
          <Field label="ZIP" value={recipient.zip}
            onChange={v => setRecipient(r => ({ ...r, zip: v }))} placeholder="24060" />
        </div>
      </div>
    </div>
  );

  // ─── Step 2: Care Preferences ───
  const Step1 = () => (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: "#1a3c34", margin: "0 0 4px" }}>
        What care does {recipient.firstName || "your loved one"} need?
      </h2>
      <p style={{ color: "#666", fontSize: 14, margin: "0 0 8px" }}>
        Rate each type of care. This helps us match with the right caregivers.
      </p>
      <div style={{ display: "flex", gap: 16, marginBottom: 20, fontSize: 12, color: "#888" }}>
        <span>🟢 Can do independently</span>
        <span>🟡 Needs some help</span>
        <span>🔴 Needs full assistance</span>
      </div>

      {CARE_TYPES.map(ct => (
        <div key={ct} style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 0", borderBottom: "1px solid #f0f0f0",
        }}>
          <span style={{ fontSize: 14, color: "#333" }}>{ct}</span>
          <div style={{ display: "flex", gap: 6 }}>
            {["green", "yellow", "red"].map(color => (
              <button key={color} onClick={() => setPrefs(p => ({ ...p, [ct]: color }))}
                style={{
                  width: 28, height: 28, borderRadius: "50%", border: "2px solid",
                  borderColor: prefs[ct] === color ? { green: "#2e7d6f", yellow: "#e8a100", red: "#c0392b" }[color] : "#ddd",
                  background: prefs[ct] === color
                    ? { green: "#2e7d6f", yellow: "#e8a100", red: "#c0392b" }[color]
                    : { green: "#e8f5e9", yellow: "#fff8e1", red: "#fde8e8" }[color],
                  cursor: "pointer", transition: "all 0.15s",
                }}>
                {prefs[ct] === color && <span style={{ color: "#fff", fontSize: 14 }}>✓</span>}
              </button>
            ))}
          </div>
        </div>
      ))}

      <p style={{ fontSize: 12, color: "#999", marginTop: 12 }}>
        {Object.keys(prefs).length < 3
          ? `Rate at least 3 care types to continue (${Object.keys(prefs).length}/3)`
          : `${Object.keys(prefs).length} care types rated ✓`}
      </p>
    </div>
  );

  // ─── Step 3: Verify Identity (Placeholder) ───
  const Step2 = () => (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: "#1a3c34", margin: "0 0 4px" }}>
        Verify your identity
      </h2>
      <p style={{ color: "#666", fontSize: 14, margin: "0 0 20px" }}>
        Before we reach out to {recipient.firstName || "your loved one"}, we need to confirm who you are.
      </p>

      <div style={{
        background: "linear-gradient(135deg, #f8f9ff 0%, #eef0ff 100%)",
        border: "1px dashed #b0b8d9", borderRadius: 12, padding: 24, textAlign: "center",
      }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🪪</div>
        <div style={{
          display: "inline-block", fontSize: 11, fontWeight: 600, color: "#5c6bc0",
          background: "#e8eaf6", padding: "3px 12px", borderRadius: 12, marginBottom: 12,
        }}>
          Coming Soon — Powered by Stripe Identity
        </div>
        <p style={{ color: "#666", fontSize: 14, lineHeight: 1.6, maxWidth: 360, margin: "0 auto" }}>
          You'll verify your identity with a quick photo of your ID and a selfie.
          This protects your loved one and builds trust with caregivers.
        </p>
        <p style={{ color: "#999", fontSize: 12, marginTop: 12 }}>
          This step will be required before care can begin.
        </p>
      </div>
    </div>
  );

  // ─── Step 4: Attest & Notify ───
  const Step3 = () => (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: "#1a3c34", margin: "0 0 4px" }}>
        Attest & notify {recipient.firstName || "your loved one"}
      </h2>
      <p style={{ color: "#666", fontSize: 14, margin: "0 0 20px" }}>
        We need to confirm that {recipient.firstName || "your loved one"} is aware you're arranging care on their behalf.
      </p>

      {/* Attestation box */}
      <div style={{
        background: attestData.accepted ? "#f0faf7" : "#fafafa",
        border: `1px solid ${attestData.accepted ? "#2e7d6f" : "#ddd"}`,
        borderRadius: 12, padding: 20, marginBottom: 20,
        transition: "all 0.2s",
      }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <button onClick={() => setAttest(a => ({ ...a, accepted: !a.accepted }))}
            style={{
              width: 24, height: 24, borderRadius: 6, border: `2px solid ${attestData.accepted ? "#2e7d6f" : "#ccc"}`,
              background: attestData.accepted ? "#2e7d6f" : "#fff",
              color: "#fff", fontSize: 14, cursor: "pointer", flexShrink: 0, marginTop: 2,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
            {attestData.accepted && "✓"}
          </button>
          <div>
            <p style={{ fontSize: 14, color: "#333", margin: 0, fontWeight: 600, lineHeight: 1.5 }}>
              I attest, under penalty of law and liability, that {recipient.firstName || "[Name]"} is aware of
              and consents to care arrangements being made on their behalf.
            </p>
            <p style={{ fontSize: 12, color: "#888", margin: "8px 0 0", lineHeight: 1.5 }}>
              InPlace will independently verify this claim. Misrepresentation may result in
              account termination and legal liability.
            </p>
          </div>
        </div>
      </div>

      {/* How to notify */}
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "#1a3c34", margin: "0 0 12px" }}>
        How should we verify with {recipient.firstName || "your loved one"}?
      </h3>
      <p style={{ fontSize: 12, color: "#888", margin: "-8px 0 12px" }}>
        Choose how {recipient.firstName || "they"} would prefer to be contacted.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {[
          { id: "email", icon: "📧", label: "Send verification email", desc: recipient.email ? `to ${recipient.email}` : "Email not provided", disabled: !recipient.email },
          { id: "sms", icon: "💬", label: "Send a text message", desc: recipient.phone ? `to ${recipient.phone}` : "Phone not provided", disabled: !recipient.phone },
          { id: "call", icon: "📞", label: "We'll call them", desc: "InPlace team calls to verify awareness", disabled: false },
          { id: "video", icon: "🎥", label: "Video chat verification", desc: "Schedule a quick video call", disabled: true },
        ].map(opt => (
          <button key={opt.id} disabled={opt.disabled}
            onClick={() => !opt.disabled && setAttest(a => ({ ...a, notifyMethod: opt.id }))}
            style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "12px 16px", borderRadius: 10,
              border: `2px solid ${attestData.notifyMethod === opt.id ? "#e8734a" : "#eee"}`,
              background: attestData.notifyMethod === opt.id ? "#fff8f5" : opt.disabled ? "#fafafa" : "#fff",
              cursor: opt.disabled ? "not-allowed" : "pointer",
              opacity: opt.disabled ? 0.5 : 1,
              textAlign: "left", width: "100%",
            }}>
            <span style={{ fontSize: 20 }}>{opt.icon}</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#333" }}>
                {opt.label}
                {opt.disabled && <span style={{ fontSize: 11, color: "#999", fontWeight: 400, marginLeft: 8 }}>Coming Soon</span>}
              </div>
              <div style={{ fontSize: 12, color: "#888" }}>{opt.desc}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  // ─── Step 5: Review & Confirm ───
  const Step4 = () => (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: "#1a3c34", margin: "0 0 4px" }}>
        Review & confirm
      </h2>
      <p style={{ color: "#666", fontSize: 14, margin: "0 0 20px" }}>
        Everything look good? We'll start the verification process once you confirm.
      </p>

      {/* Recipient summary */}
      <SummaryCard title="Care Recipient" icon="👤">
        <SummaryRow label="Name" value={`${recipient.firstName} ${recipient.lastName}`} />
        <SummaryRow label="Relationship" value={recipient.relationship} />
        <SummaryRow label="Phone" value={recipient.phone} />
        {recipient.email && <SummaryRow label="Email" value={recipient.email} />}
        {recipient.address && <SummaryRow label="Address" value={`${recipient.address}, ${recipient.city} ${recipient.state} ${recipient.zip}`} />}
      </SummaryCard>

      {/* Care preferences summary */}
      <SummaryCard title="Care Preferences" icon="💚">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {Object.entries(prefs).map(([k, v]) => (
            <span key={k} style={{
              fontSize: 12, padding: "4px 10px", borderRadius: 20,
              background: { green: "#e8f5e9", yellow: "#fff8e1", red: "#fde8e8" }[v],
              color: { green: "#2e7d6f", yellow: "#b8860b", red: "#c0392b" }[v],
            }}>
              {{ green: "🟢", yellow: "🟡", red: "🔴" }[v]} {k}
            </span>
          ))}
        </div>
      </SummaryCard>

      {/* Identity */}
      <SummaryCard title="Identity Verification" icon="🪪">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontSize: 11, fontWeight: 600, color: "#5c6bc0",
            background: "#e8eaf6", padding: "2px 10px", borderRadius: 12,
          }}>Coming Soon</span>
          <span style={{ fontSize: 13, color: "#888" }}>Will be required before care begins</span>
        </div>
      </SummaryCard>

      {/* Attestation */}
      <SummaryCard title="Attestation & Verification" icon="✍️">
        <SummaryRow label="Attested" value={attestData.accepted ? "Yes ✓" : "No"} />
        <SummaryRow label="Verification method"
          value={{ email: "📧 Email", sms: "💬 Text message", call: "📞 Phone call", video: "🎥 Video chat" }[attestData.notifyMethod]} />
      </SummaryCard>

      {saved && (
        <div style={{
          background: "#f0faf7", border: "1px solid #2e7d6f", borderRadius: 12,
          padding: 20, textAlign: "center", marginTop: 20,
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🎉</div>
          <h3 style={{ color: "#2e7d6f", margin: "0 0 4px" }}>All set!</h3>
          <p style={{ color: "#666", fontSize: 14, margin: 0 }}>
            {recipient.firstName}'s care profile is created.
            {attestData.notifyMethod === "email" && ` A verification email has been sent to ${recipient.email}.`}
            {attestData.notifyMethod === "sms" && ` A verification text has been sent to ${recipient.phone}.`}
            {attestData.notifyMethod === "call" && ` Our team will call ${recipient.firstName} to verify.`}
          </p>
        </div>
      )}
    </div>
  );

  // ─── Navigation buttons ───
  const canNext = () => {
    if (step === 0) return canAdvanceStep0;
    if (step === 1) return canAdvanceStep1;
    if (step === 2) return true; // skip for now
    if (step === 3) return attestData.accepted;
    if (step === 4) return !saved;
    return false;
  };

  const nextLabel = () => {
    if (step === 0) return "Save & Continue";
    if (step === 2) return "Skip for Now";
    if (step === 4) return "Confirm & Start Verification";
    return "Continue";
  };

  return (
    <div style={{
      maxWidth: 480, margin: "0 auto", padding: "20px 16px",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      minHeight: "100vh", background: "#fff",
    }}>
      <ProgressBar />

      <div style={{ minHeight: 400 }}>
        {step === 0 && <Step0 />}
        {step === 1 && <Step1 />}
        {step === 2 && <Step2 />}
        {step === 3 && <Step3 />}
        {step === 4 && <Step4 />}
      </div>

      {/* Nav buttons */}
      <div style={{
        display: "flex", gap: 12, marginTop: 24, paddingTop: 16,
        borderTop: "1px solid #eee",
      }}>
        {step > 0 && !saved && (
          <button onClick={() => setStep(s => s - 1)}
            style={{
              flex: 1, padding: "14px 0", borderRadius: 10,
              border: "1px solid #ddd", background: "#fff",
              color: "#666", fontSize: 15, fontWeight: 600, cursor: "pointer",
            }}>
            Back
          </button>
        )}
        {!saved && (
          <button disabled={!canNext()} onClick={() => {
            if (step === 4) { setSaved(true); return; }
            setStep(s => s + 1);
          }}
            style={{
              flex: 2, padding: "14px 0", borderRadius: 10,
              border: "none",
              background: canNext() ? "#e8734a" : "#e0e0e0",
              color: canNext() ? "#fff" : "#999",
              fontSize: 15, fontWeight: 600,
              cursor: canNext() ? "pointer" : "not-allowed",
              transition: "all 0.2s",
            }}>
            {nextLabel()}
          </button>
        )}
        {saved && (
          <button onClick={() => { setStep(0); setSaved(false); setRecipient({ firstName: "", lastName: "", phone: "", email: "", address: "", city: "", state: "", zip: "", relationship: "mother" }); setPrefs({}); setAttest({ accepted: false, notifyMethod: "email" }); }}
            style={{
              flex: 1, padding: "14px 0", borderRadius: 10,
              border: "none", background: "#2e7d6f", color: "#fff",
              fontSize: 15, fontWeight: 600, cursor: "pointer",
            }}>
            Go to Dashboard
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Reusable components ───
function Field({ label, value, onChange, placeholder, type = "text", options }) {
  const base = {
    width: "100%", padding: "10px 12px", borderRadius: 8,
    border: "1px solid #ddd", fontSize: 14, outline: "none",
    boxSizing: "border-box",
  };
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>
        {label}
      </label>
      {type === "select" ? (
        <select value={value} onChange={e => onChange(e.target.value)} style={{ ...base, background: "#fff" }}>
          {options.map(o => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
        </select>
      ) : (
        <input type={type} value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder} style={base} />
      )}
    </div>
  );
}

function SummaryCard({ title, icon, children }) {
  return (
    <div style={{
      background: "#fafafa", borderRadius: 10, padding: "14px 16px",
      marginBottom: 12, border: "1px solid #eee",
    }}>
      <h4 style={{ fontSize: 13, fontWeight: 700, color: "#1a3c34", margin: "0 0 8px" }}>
        {icon} {title}
      </h4>
      {children}
    </div>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}>
      <span style={{ color: "#888" }}>{label}</span>
      <span style={{ color: "#333", fontWeight: 500 }}>{value}</span>
    </div>
  );
}