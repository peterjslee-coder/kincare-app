// v1.109.4 — the four things from the 9/21 feedback pull, pinned where they can actually fail.
const { raw, code } = require("./helpers/source");

const CARE_PROFILE = "public/js/components/CareProfile.js";
const MESSAGES = "public/js/components/Messages.js";

const careProfile = raw(CARE_PROFILE);
const ipai = raw("public/js/components/IPAiInsightsCard.js");
const messages = raw(MESSAGES);
const attentionCard = raw("public/js/components/AttentionCard.js");
const attention = raw("src/utils/attention.js");

describe("22398cc8 — Care Intelligence collapses like everything else on her page", () => {
  test("it uses the same remembered-section hook, open by default", () => {
    expect(ipai).toContain("useStickySection('lovedOne.careIntelligence', true)");
  });

  test("the chevron is last and the title toggles — v1.105.172's rule", () => {
    expect(ipai).toMatch(/aria-expanded=\{sectionOpen\}/);
    expect(ipai).toMatch(/transform: sectionOpen \? 'rotate\(180deg\)' : 'rotate\(0\)'/);
  });

  test("collapsing hides, it does not unmount — a generated report must survive it", () => {
    expect(ipai).toContain("display: sectionOpen ? 'block' : 'none'");
    // If it unmounted, reopening would re-run the model at Anthropic's expense.
    expect(ipai).not.toMatch(/\{sectionOpen && \(/);
  });
});

describe("3cb40ebf / c28b2e65 — Betty's photo is findable", () => {
  test("one picker, used on the card you read AND the form you edit", () => {
    expect(careProfile).toContain("const renderPhotoPicker = (size) =>");
    expect(careProfile).toContain("{renderPhotoPicker(72)}");
    expect(careProfile).toContain("{renderPhotoPicker(64)}");
  });

  test("the affordance is a control, not a 9px caption", () => {
    // The old one was a 9-pixel camera on a dark strip across the bottom of the circle.
    expect(code(CARE_PROFILE)).not.toContain("fontSize: 9, textAlign: 'center'");
    expect(careProfile).toMatch(/aria-label=\{profile\.photo \? "Change photo" : "Add a photo"\}/);
    expect(careProfile).toContain("Add a photo of {profile.first_name}");
  });

  test("and it can be taken off again", () => {
    expect(careProfile).toContain("const handlePhotoRemove = async () =>");
    expect(careProfile).toMatch(/method: 'DELETE'/);
  });
});

describe("7e3ff970 — the empty-week nudge is a nudge, not a gate", () => {
  test("the item is soft and carries a way to put it away", () => {
    expect(attention).toContain('kind: "emptyWeek"');
    expect(attention).toContain("soft: true");
    expect(attention).toContain('path: "/api/push/attention/snooze"');
  });

  test("it is deliberately absent from the app-icon total", () => {
    const total = attention.slice(attention.indexOf("    total: reimbursementRows.length"));
    const line = total.slice(0, total.indexOf("\n", total.indexOf("safetyRows.length")));
    expect(line).not.toContain("emptyWeekRows");
    expect(attention).toContain("emptyWeeks: emptyWeekRows.length");
  });

  test("the card counts blockers only, and draws nudges quietly", () => {
    expect(attentionCard).toContain("const visible = items.filter((i) => !i.soft)");
    expect(attentionCard).toContain("const nudges = items.filter((i) => i.soft)");
    expect(attentionCard).toContain("Needs you ({visible.length})");
    // No orange, no shadow: the visual weight is most of what makes something a gate.
    const nudgeBlock = attentionCard.slice(attentionCard.indexOf("{nudges.map((item)"));
    expect(nudgeBlock).not.toContain("var(--accent-color)");
    expect(nudgeBlock).not.toContain("boxShadow: '0 2px 8px rgba(232,114,74,0.15)'");
  });

  test("Request Care goes where the nav's own Request Care goes", () => {
    expect(attention).toContain('page: "schedule"');
    // A focus id nobody claims is the v1.105.139 dead end wearing a destination's clothes.
    expect(attention).toMatch(/page: "schedule",\n {6}focus: null,/);
  });
});

describe("529c8a16 — a piece of the conversation, into the notes", () => {
  test("long-press still reacts, but Copy and Notes are back on the pill", () => {
    expect(messages).toContain("const copyMessage = async (m) =>");
    expect(messages).toMatch(/aria-label="Copy text"/);
    expect(messages).toMatch(/aria-label="Save to notes"/);
  });

  test("copy has a fallback, because the WKWebView withholds the clipboard API", () => {
    expect(messages).toContain("navigator.clipboard?.writeText");
    expect(messages).toContain("document.execCommand('copy')");
  });

  test("selecting turns off the gestures that would fight it", () => {
    expect(messages).toContain("onTouchStart={(e) => { if (msgSelectIds) return; onMsgTouchStart(e, m); }}");
    expect(messages).toContain("onClick={msgSelectIds ? () => toggleMsgSelect(m.id) : undefined}");
  });

  test("the transcript is chronological, not tap order", () => {
    // filter() over `messages` preserves the thread's order whatever order he tapped.
    expect(messages).toContain("const picked = (messages || []).filter((m) => ids.includes(m.id))");
  });

  test("it hands over a DRAFT and saves nothing on the way", () => {
    expect(messages).toContain("window.__pendingNoteDraft = { text: buildNoteDraft(ids), source: 'messages' }");
    // Pete: "it needs to take you to the note before saving it (to allow editing for clarity)."
    expect(code(MESSAGES)).not.toMatch(/saveSelectionToNotes[\s\S]{0,400}method: 'POST'/);
    expect(careProfile).toContain("const draft = window.__pendingNoteDraft;");
    expect(careProfile).toContain("window.__pendingNoteDraft = null;");
    expect(careProfile).toContain("Nothing has been saved yet.");
  });

  test("the draft is claimed once, so a remount cannot refill a cleared composer", () => {
    const effect = careProfile.slice(careProfile.indexOf("const draft = window.__pendingNoteDraft;"));
    expect(effect.indexOf("window.__pendingNoteDraft = null;")).toBeLessThan(effect.indexOf("setNewNote(draft.text)"));
  });
});
