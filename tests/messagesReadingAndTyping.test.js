// Reading a thread, and writing in it, from a hospital chair. (v1.105.145)
//
// Two reports from the same afternoon, both from Pete's phone while he was at the hospital
// with Betty — which is the context that decides how they rank. Neither is exotic; both are
// the app arguing with the only device he had.
//
//   72c3a626  "Every time I open the chat, it anchors near the top for some reason and I have
//              to scroll to the bottom of the chat. The chat should load from the most recent
//              message."
//   befaf875  "I don't like how I hit return (for a break in messages) and it posts the
//              message."

const { code } = require("./helpers/source");
const msgs = code("public/js/components/Messages.js");

describe("a chat opens at the newest message", () => {
  test("opening jumps; a new message glides", () => {
    // Two different moments that were being treated as one. An ARRIVING message should animate
    // to the bottom — that motion is what tells you something came in. OPENING should simply
    // BE at the bottom, with no animation to watch and nothing to interrupt.
    expect(msgs).toMatch(/const firstPaintOfThisThread = openedConvRef\.current !== activeConvId;/);
    expect(msgs).toMatch(/if \(!firstPaintOfThisThread\) \{ pinToBottom\(true\); return; \}/);
    expect(msgs).toMatch(/openedConvRef\.current = activeConvId;\n\s+pinToBottom\(false\);/);
  });

  test("it keeps pinning until the height stops moving", () => {
    // On open the list is still growing underneath the scroll — avatars, photos, and the
    // "messages before you joined" boundary all land after the first paint. One scroll to
    // scrollHeight aims at a height that is already stale and stops short, which in a long
    // thread is "near the top". Same settle loop Reimbursements has used since v1.98.10.
    expect(msgs).toMatch(/if \(area\.scrollHeight !== lastHeight\)/);
    expect(msgs).toMatch(/clearInterval\(settle\); \/\/ height held still/);
  });

  test("it gives up rather than scrolling forever", () => {
    expect(msgs).toMatch(/if \(tries >= 20\) clearInterval\(settle\);/);
    expect(msgs).toMatch(/return \(\) => clearInterval\(settle\);/);
  });

  test("it re-arms for the NEXT conversation, not once per app load", () => {
    expect(msgs).toMatch(/\}, \[messages, activeConvId, pinToBottom\]\);/);
  });
});

describe("Return writes a second line on a phone", () => {
  test("Enter only sends where there is a Shift key to escape it", () => {
    // Enter-to-send with Shift+Enter for a newline is the convention on a physical keyboard
    // and stays. On a touch keyboard there IS no shift on Return, so that rule reduced to
    // "you may not write a second line" — and a message worth breaking into lines is exactly
    // the kind you send from a hospital.
    expect(msgs).toMatch(/if \(e\.key === 'Enter' && !e\.shiftKey && !hasSoftKeyboard\)/);
  });

  test("the touch test is the same one the keyboard fix uses", () => {
    // One definition of "this device has a soft keyboard", not two that can drift.
    expect(msgs).toMatch(/window\.matchMedia\('\(pointer: coarse\)'\)\.matches/);
    expect((msgs.match(/hasSoftKeyboard/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  test("the send button is still the way to send", () => {
    expect(msgs).toMatch(/className="msg-send-btn"/);
    expect(msgs).toMatch(/onClick=\{handleSendMessage\}/);
  });
});
