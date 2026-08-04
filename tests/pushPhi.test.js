// v1.105.39 — no PHI on lock screens. Pete's directive, in those words.
//
// A push notification's title and body render on a LOCKED phone, readable by anyone who
// picks it up — no unlock, no app, no account. This app holds a dementia patient's
// medications, adherence history and visit observations, and it was putting a lot of that
// straight onto the glass:
//
//   notes.js          the observation itself, 120 chars of it  ("wouldn't take her evening pill")
//   careTasks.js      the task title AND ` (med_name, dose)`    ("Evening anxiety medication (lorazepam, 0.5mg)")
//   careEvents.js     the appointment title and the clinic      ("Tomorrow: Dr. Patel — neurology")
//   messages.js       80-char previews, on three separate paths (schema marks content PHI-risk)
//   messageSafety.js  an excerpt of the flagged message
//   accountability.js the incident TYPE                         ("reported: fall")
//   payments.js       the reimbursement note
//   reimbursements.js the recurring description                 ("pharmacy")
//
// The rule now: a push says WHO and WHAT KIND, never WHAT. Everything else is one tap away
// inside an authenticated app. This test is a gate — it reads every push payload in src/
// and fails if a body interpolates something from the denylist.

const fs = require("fs");
const path = require("path");
const { code } = require("./helpers/source");

const SRC = path.join(__dirname, "..", "src");

function srcFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return srcFiles(full);
    return e.name.endsWith(".js") ? [full] : [];
  });
}

// Identifiers that carry free text written about, or by, a person — the things that must
// never be interpolated into a push title or body.
const FORBIDDEN = [
  "content", "preview", "memberPreview", "legacyPreview", "caption",
  "summary", "alertMsg", "incidentType", "med_name", "detail",
  "sch.description", "t.title", "ev.title", "note",
];

// Pull the `title:` and `body:` lines out of every sendPushToUser / notifyAdmins payload.
function pushTextLines(src) {
  const lines = src.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/sendPushToUser\(|notifyAdmins\(|sendPushToAdmins\(/.test(lines[i])) continue;
    // The payload object follows within a handful of lines.
    for (let j = i; j < Math.min(i + 12, lines.length); j++) {
      if (/^\s*(title|body):/.test(lines[j])) out.push({ line: j + 1, text: lines[j] });
    }
  }
  return out;
}

describe("no PHI on lock screens", () => {
  test("no push title or body interpolates free text about a person", () => {
    const offenders = [];
    for (const file of srcFiles(SRC)) {
      const rel = path.relative(path.join(__dirname, ".."), file);
      const src = code(rel); // comments stripped — this file's own prose names every forbidden token
      for (const { line, text } of pushTextLines(src)) {
        for (const bad of FORBIDDEN) {
          // Only flag INTERPOLATIONS: `${content}`, `${t.title}`, `body: preview`.
          const interpolated = new RegExp("\\$\\{[^}]*\\b" + bad.replace(".", "\\.") + "\\b");
          const bare = new RegExp("^\\s*(title|body):\\s*" + bad.replace(".", "\\.") + "\\b");
          if (interpolated.test(text) || bare.test(text)) {
            offenders.push(`${rel}:${line} → ${bad}  ::  ${text.trim().slice(0, 90)}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the specific leaks that prompted this, one test each", () => {
  test("an observation is announced, not quoted", () => {
    const notes = code("src/routes/notes.js");
    expect(notes).toMatch(/body: `\$\{authorName\} — tap to read`/);
    expect(notes).not.toMatch(/String\(content\)\.slice/);
  });

  test("a care task never names the medication or the dose", () => {
    const tasks = code("src/routes/careTasks.js");
    expect(tasks).toMatch(/title: "Care task due"/);
    expect(tasks).toMatch(/title: "Care task not checked off"/);
    // `detail` is built as ` (med_name, dose)` — it may still exist for in-app use, but it
    // must not reach a push body.
    for (const { text } of pushTextLines(tasks)) expect(text).not.toMatch(/\$\{detail\}/);
  });

  test("an appointment reminder gives the time, not the diagnosis", () => {
    const events = code("src/routes/careEvents.js");
    expect(events).toMatch(/title = stage === "day_before" \? "Appointment tomorrow" : "Appointment today"/);
    expect(events).toMatch(/Tap for details\./);
  });

  test("messages say who, not what — on all three paths", () => {
    const msgs = code("src/routes/messages.js");
    expect(msgs).toMatch(/\$\{senderName\} sent you a message/);
    expect(msgs).toMatch(/\$\{senderName\} sent a message/);
    expect(msgs).toMatch(/\$\{senderName\} sent a photo/);
    for (const { text } of pushTextLines(msgs)) {
      expect(text).not.toMatch(/Preview|preview/);
    }
  });

  test("an incident report is announced, not categorised", () => {
    const acc = code("src/routes/accountability.js");
    expect(acc).toMatch(/filed an incident report\. Tap to review\./);
  });

  test("money notifications drop the free-text note", () => {
    const pay = code("src/routes/payments.js");
    const reimb = code("src/routes/reimbursements.js");
    for (const { text } of pushTextLines(pay)) expect(text).not.toMatch(/\$\{note\}|"\$\{note\}"/);
    expect(reimb).toMatch(/pre-approved, ready to pay`/);
  });

  test("the family-visit push was built this way from the start", () => {
    const fv = code("src/routes/familyVisits.js");
    expect(fv).toMatch(/body: "Tap to read"/);
  });
});

describe("what is deliberately still there", () => {
  // Not everything on a lock screen is PHI, and stripping the useful parts would push
  // people to turn notifications off — which costs more than it saves.
  test("names and times survive, because they are what make a notice actionable", () => {
    const push = code("src/routes/push.js");
    expect(push).toMatch(/Time to check in with \$\{recipientName\}/);
    expect(push).toMatch(/\$\{caregiverName\} is about to check in/);
  });
});
