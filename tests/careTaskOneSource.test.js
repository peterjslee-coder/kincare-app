// One task, three views, no hierarchy. (v1.105.162)
//
// Pete: "do we need a priority of which listens to which? I would prefer that the 'needs you'
// overrides everything else… Ultimately, I'd prefer it was all one task, with three different
// deep links to take you to that task, then push back to the locations to clear the 'needs
// you' card, move from 'next up' and mark it done in the care team."
//
// The answer to the priority question is no. You only need a priority when there are several
// copies of the truth arguing with each other. There is one occurrence row on the server and
// there always has been — what had drifted was the client, where FIVE places sent the same
// check-off request with their own error handling, and THREE screens each cached their own
// answer with no idea the others existed. That is how "Already checked off" happened: the card
// wrote, the sheet did not know, the care-team panel knew least of all.

const { code } = require("./helpers/source");
const sync = code("public/js/careTaskSync.js");
const dash = code("public/js/components/Dashboard.js");
const tasks = code("public/js/components/CareTasks.js");
const card = code("public/js/components/AttentionCard.js");

describe("one writer", () => {
  test("every check-off goes through CareTaskSync.write", () => {
    // The old count was five hand-rolled call sites. What is left is the one inside the sync
    // module itself.
    const all = [dash, tasks, card].join("\n");
    expect(all).not.toMatch(/occurrences\/\$\{occ\.id\}\/check/);
    expect(sync).toMatch(/`\/api\/care-tasks\/occurrences\/\$\{occId\}\/check`/);
  });

  test("it never throws — it returns whether it worked", () => {
    // Five callers each inventing their own failure handling is exactly what came apart.
    expect(sync).toMatch(/return \{ ok: false, error: error \|\| "That didn't go through\. Try again\." \};/);
    expect(sync).toMatch(/async write\(occId, body\)/);
    expect(sync).toMatch(/async undo\(occId\)/);
  });

  test("409 is success, in the one place that now decides it", () => {
    expect(sync).toMatch(/if \(res\?\.ok \|\| res\?\.status === 409\) \{ announce\(occId\); return \{ ok: true \}; \}/);
  });
});

describe("one announcement", () => {
  test("a successful write says so exactly once", () => {
    expect(sync).toMatch(/const EVENT = 'inplace:care-task-changed';/);
    expect(sync).toMatch(/window\.dispatchEvent\(new CustomEvent\(EVENT/);
  });

  test("the one-way hookup from v1.105.142 is gone", () => {
    // It only ever went card → dashboard. The care-team panel was never told anything.
    const all = [dash, tasks, card].join("\n");
    expect(all).not.toMatch(/inplace:attention-changed/);
  });
});

describe("three listeners, none of them in charge", () => {
  test("Next Up re-reads", () => {
    expect(dash).toMatch(/useEffect\(\(\) => CareTaskSync\.onChange\(\(\) => fetchCareTasks\(\)\), \[\]\)/);
  });

  test("the care-team panel re-reads — 'it would just read from the main task'", () => {
    expect(tasks).toMatch(/useEffect\(\(\) => CareTaskSync\.onChange\(\(\) => \{ if \(recipientId\) load\(\); \}\), \[recipientId\]\)/);
  });

  test("and the Needs-you card clears itself when someone else finishes the task", () => {
    // It only announced before, so the row could outlive the task it was about.
    expect(card).toMatch(/return CareTaskSync\.onChange\(\(\) => load\(\)\);/);
  });

  test("subscribing returns its own unsubscribe, so an effect can return it directly", () => {
    expect(sync).toMatch(/return \(\) => window\.removeEventListener\(EVENT, handler\);/);
  });

  test("it loads before anything that uses it", () => {
    const build = code("scripts/build-client.js");
    expect(build.indexOf("js/careTaskSync.js")).toBeLessThan(build.indexOf("js/components/AttentionCard.js"));
    expect(build.indexOf("js/careTaskSync.js")).toBeLessThan(build.indexOf("js/components/Dashboard.js"));
    expect(build.indexOf("js/careTaskSync.js")).toBeLessThan(build.indexOf("js/components/CareTasks.js"));
  });
});
