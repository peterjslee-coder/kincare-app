// v1.105.51 — the long tail: handlers that failed without saying so.
//
// The end of the sweep. None of these is dramatic on its own; together they are the reason
// this app felt unreliable in a way nobody could point at. Three shapes:
//
//   1. A success message that fires whether or not the save worked.
//   2. `if (res.ok) { … }` with no else, where a human is waiting.
//   3. An empty state that means "the request failed" and reads as "there is nothing here".
//
// The third is the one worth naming: "no caregivers found near you" and "no open requests"
// are answers. Rendering them because a fetch failed is the app making something up.

const { code } = require("./helpers/source");

const hub = code("public/js/components/CaretakerHub.js");
const findWork = code("public/js/components/FindWork.js");
const team = code("public/js/components/CareTeamManage.js");
const caregivers = code("public/js/components/Caregivers.js");
const attention = code("public/js/components/AttentionCard.js");
const account = code("public/js/components/MyAccount.js");
const caredFor = code("public/js/components/CaredForView.js");
const profile = code("public/js/components/CareProfile.js");
const messages = code("public/js/components/Messages.js");
const queue = code("public/js/offlineQueue.js");

describe("a success message means it succeeded", () => {
  test("the three CaretakerHub saves check the response first", () => {
    // These awaited a POST, threw the result away, and then said "Profile saved!" /
    // "Work location updated!". A 400 or 403 doesn't throw, so the caregiver was told a
    // save had happened that hadn't — and saveStoplight also left the new values on screen
    // until a reload silently reverted them.
    const stoplight = hub.slice(hub.indexOf("const saveStoplight"), hub.indexOf("const goToStep"));
    expect(stoplight).toMatch(/if \(!res\?\.ok\)/);

    const onboarding = hub.slice(hub.indexOf("const saveOnboardingProfile"), hub.indexOf("const saveWorkLocation"));
    expect(onboarding).toMatch(/if \(!r1\?\.ok\)/);
    expect(onboarding).toMatch(/if \(!r3\?\.ok\)/);

    const loc = hub.slice(hub.indexOf("const saveWorkLocation"), hub.indexOf("const saveWorkLocation") + 1200);
    expect(loc).toMatch(/if \(!saveRes\?\.ok\)/);
  });
});

describe("availability failures are visible — they decide what work you're offered", () => {
  test.each([["FindWork", findWork], ["CaretakerHub", hub]])("%s tracks every rule that didn't save", (_n, src) => {
    // Both versions fired several POSTs in a loop, checked none of them, and closed the
    // sheet regardless — so a rejected rule vanished and the caregiver lost shifts they
    // never knew were on offer.
    const fn = src.slice(src.indexOf("const handleSaveRule"), src.indexOf("const handleDeleteRule"));
    expect(fn).toMatch(/const track = \(r\) => \{ if \(!r\?\.ok\) failed\+\+; return r; \};/);
    expect(fn).toMatch(/if \(failed\) \{/);
    expect(fn).not.toMatch(/\n\s+await apiFetch\('\/api\/availability'/); // every call is tracked
  });

  test.each([["FindWork", findWork], ["CaretakerHub", hub]])("%s reports a failed delete", (_n, src) => {
    const fn = src.slice(src.indexOf("const handleDeleteRule"), src.indexOf("const startEditRule"));
    expect(fn).toMatch(/if \(!res\?\.ok\)/);
  });
});

describe("a rejected care-team action says why", () => {
  test("the six handlers surface the server's reason", () => {
    // All were `if (res?.ok) { … }` with no else, so the last-admin guard, a permission
    // denial or an expired invite produced no feedback at all — the tap did nothing.
    expect(team).toMatch(/const failToast = async \(res, fallback\) => \{/);
    for (const fallback of [
      "Failed to remove member", "Failed to cancel invite", "Failed to resend invite",
      "Failed to change role", "Failed to update team name",
    ]) {
      expect(team).toMatch(new RegExp(`failToast\\(res, '${fallback}'\\)`));
    }
  });

  test("a failed rename keeps the editor open", () => {
    // setEditingName(false) ran outside the if, so the typed name disappeared and the old
    // one was still there, with nothing said.
    const fn = team.slice(team.indexOf("const handleUpdateName"), team.indexOf("const handleChangeRole"));
    expect(fn).toMatch(/await failToast\(res, 'Failed to update team name'\);\s*\n\s*return;/);
  });
});

describe("an empty list is an answer, not a shrug", () => {
  test("a failed job load doesn't read as 'no work available'", () => {
    expect(findWork).toMatch(/const \[jobsLoadFailed, setJobsLoadFailed\]/);
    expect(findWork).toMatch(/Couldn't load open requests/);
  });

  test("a failed caregiver search doesn't read as 'nobody near you'", () => {
    expect(caregivers).toMatch(/const \[searchFailed, setSearchFailed\]/);
    expect(caregivers).toMatch(/That search didn't go through/);
  });

  test("the needs-you card admits it couldn't load, instead of rendering nothing", () => {
    // Rendering null here means "you're all caught up" — the one thing this card must
    // never say wrongly, since the app icon may be showing a number at the same time.
    expect(attention).toMatch(/const \[loadFailed, setLoadFailed\]/);
    expect(attention).toMatch(/Couldn't load what needs you/);
    expect(attention).toMatch(/onClick=\{load\}/); // and it can be retried
    expect(attention).toMatch(/if \(!res\?\.ok\)/); // was res.ok — apiFetch can return null
  });
});

describe("the remaining silent saves", () => {
  test("pay rates report failure", () => {
    expect(account).toMatch(/else \{ showToast\('Failed to save rates', 'error'\); \}/);
  });

  test("a rejected note says so instead of leaving the text sitting there", () => {
    expect(caredFor).toMatch(/setNoteError\("That didn't save — please try again\."\)/);
  });

  test("a rejected medication reminder doesn't look saved", () => {
    // The modal stayed open, un-spun, saying nothing — so a family believed a reminder
    // existed that had never been created.
    const fn = profile.slice(profile.indexOf("const handleSaveReminder"), profile.indexOf("const handleSaveReminder") + 2200);
    expect(fn).toMatch(/Could not save the reminder/);
  });

  test("opening a conversation only closes the sheet once it worked", () => {
    const fn = messages.slice(messages.indexOf("const handleSelectContact"), messages.indexOf("const handleCreateGroup"));
    expect(fn).toMatch(/if \(!res\?\.ok\) \{/);
    expect(fn.indexOf("setShowNewChat(false)")).toBeGreaterThan(fn.indexOf("await apiFetch"));
  });
});

describe("an offline check-in doesn't wait for a coincidence", () => {
  test("replay also runs when the app comes back to the foreground", () => {
    // 'online' was the only trigger and only fires while the page is alive; sw.js's
    // Background Sync handler is dead on WebKit and was never registered anyway. A
    // check-in recorded in a basement sat in IndexedDB until the app happened to be
    // reopened with the tab still loaded.
    expect(queue).toMatch(/addEventListener\('visibilitychange'/);
    expect(queue).toMatch(/addEventListener\('resume'/); // Capacitor, native shell
    expect(queue).toMatch(/if \(_syncing \|\| !navigator\.onLine\) return;/); // no overlap
  });
});

describe("third-party calls are bounded", () => {
  test("the AI clients don't hold a request for half an hour", () => {
    // The SDK default is a 10-minute timeout with 2 automatic retries.
    for (const f of ["careIntelligence", "ipaiChat", "kindredBrain", "documentAI", "messageSafety"]) {
      expect(code(`src/utils/${f}.js`)).toMatch(/new Anthropic\(\{ apiKey, timeout: 30000, maxRetries: 1 \}\)/);
    }
  });

  test("Checkr and the OAuth exchange can't hang the flow they're in", () => {
    expect(code("src/routes/checkr.js")).toMatch(/signal: AbortSignal\.timeout\(8000\)/);
    const oauth = code("src/routes/oauth.js");
    expect((oauth.match(/AbortSignal\.timeout\(8000\)/g) || []).length).toBe(3);
  });
});
