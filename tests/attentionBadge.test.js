// v1.105.40 — the app-icon badge.
//
// Pete: "notification on the app icon when there are unread events that need attention.
// For instance, if Sara needs to approve reimbursements."
//
// The plumbing is trivial. The DEFINITION is the product, and it is the only thing here
// worth testing hard: a badge that counts everything sits at 47 forever and teaches people
// to ignore it — along with the push notifications attached to it. So the count means
// "you, specifically, are the blocker", and these tests pin that.

const { code } = require("./helpers/source");
const { attentionCountFor } = require("../src/utils/attention");

// Stub shaped like DatabaseWrapper: db.prepare(sql).get(...). Routes by matching the SQL,
// so each test reads as "this is what's in the database".
function fakeDb(counts) {
  return {
    prepare(sql) {
      const norm = sql.replace(/\s+/g, " ");
      return {
        async get() {
          if (norm.includes("FROM reimbursements")) return { count: counts.reimbursements ?? 0 };
          if (norm.includes("FROM time_proposals")) return { count: counts.timeChanges ?? 0 };
          if (norm.includes("FROM care_task_occurrences")) return { count: counts.careTasks ?? 0 };
          if (norm.includes("FROM messages")) return { count: counts.messages ?? 0 };
          return { count: 0 };
        },
      };
    },
  };
}

describe("the count means: you are the blocker", () => {
  test("Sara's case — one reimbursement waiting on her approval", () => {
    // The example Pete opened with.
    return attentionCountFor(fakeDb({ reimbursements: 1 }), "sara").then((r) => {
      expect(r.total).toBe(1);
      expect(r.reimbursements).toBe(1);
    });
  });

  test("it sums the four things, and reports the breakdown", async () => {
    const r = await attentionCountFor(
      fakeDb({ reimbursements: 2, timeChanges: 1, careTasks: 3, messages: 4 }), "pete"
    );
    expect(r).toEqual({ total: 10, reimbursements: 2, timeChanges: 1, careTasks: 3, messages: 4 });
  });

  test("nothing waiting is zero, not null or undefined", async () => {
    // The difference matters: clearAppBadge() vs setAppBadge(undefined).
    const r = await attentionCountFor(fakeDb({}), "pete");
    expect(r.total).toBe(0);
  });

  test("no user id is zero, not a crash", async () => {
    expect((await attentionCountFor(fakeDb({ messages: 5 }), null)).total).toBe(0);
  });

  test("every query fails soft — a badge must never break a push send", async () => {
    const brokenDb = { prepare: () => ({ get: async () => { throw new Error("db down"); } }) };
    const r = await attentionCountFor(brokenDb, "pete");
    expect(r.total).toBe(0);
    expect(r).toEqual({ total: 0, reimbursements: 0, timeChanges: 0, careTasks: 0, messages: 0 });
  });
});

describe("what the count deliberately EXCLUDES", () => {
  const util = code("src/utils/attention.js");

  test("it does not count the activity feed", () => {
    // "What happened while I was away" is the Activity card's job. Counting it is how a
    // badge becomes wallpaper.
    expect(util).not.toMatch(/FROM activity_feed/);
    expect(util).not.toMatch(/FROM notifications/);
  });

  test("it does not count family visits or notes others added", () => {
    expect(util).not.toMatch(/FROM family_visits/);
    expect(util).not.toMatch(/FROM recipient_notes/);
  });

  test("your own actions never badge you", () => {
    // A reimbursement you submitted, a message you sent — not your move.
    expect(util).toMatch(/r\.payee_user_id IS DISTINCT FROM \?/);
    expect(util).toMatch(/m\.sender_id IS DISTINCT FROM \?/);
  });

  test("an unassigned care task badges nobody", () => {
    // It belongs to the team, not to one person. Badging everyone for it is noise.
    expect(util).toMatch(/t\.assigned_user_id = \?/);
  });

  test("an expired time proposal doesn't count — there's nothing left to do", () => {
    expect(util).toMatch(/tp\.expires_at IS NULL OR tp\.expires_at > NOW\(\)/);
  });
});

describe("the number reaches the icon by every route we have", () => {
  const push = code("src/routes/push.js");
  const apns = code("src/utils/apns.js");
  const sw = code("public/sw.js");
  const utils = code("public/js/utils.js");

  test("every push carries the recipient's CURRENT total", () => {
    // A push always means something changed, so it's the natural moment to correct the
    // number — in either direction.
    expect(push).toMatch(/badgeCount = \(await attentionCountFor\(db, userId\)\)\.total/);
    expect(push).toMatch(/badgeCount,/);
  });

  test("badgeCount is not confused with the existing `badge` icon field", () => {
    // `badge` in a web-push payload is the monochrome ICON. Collapsing the two would set
    // the app-icon count to a PNG path.
    expect(push).toMatch(/badge: "\/icons\/icon-maskable-96\.png"/);
    expect(push).toMatch(/badgeCount/);
  });

  test("iOS gets it as aps.badge, and only when it's a real number", () => {
    expect(apns).toMatch(/Number\.isFinite\(payload\.badgeCount\) \? \{ badge: payload\.badgeCount \} : \{\}/);
  });

  test("the installed PWA sets it from the push, and clears at zero", () => {
    expect(sw).toMatch(/setAppBadge\(n\)/);
    expect(sw).toMatch(/clearAppBadge\(\)/);
  });

  test("coming back to the app re-asks the server", () => {
    // The thing people actually notice is a badge that won't clear after they've dealt
    // with it. Visibility is exactly when that would be on screen.
    expect(utils).toMatch(/const refreshAppBadge/);
    expect(utils).toMatch(/apiFetch\('\/api\/push\/attention'\)/);
    expect(utils).toMatch(/document\.visibilityState === 'visible'/);
  });

  test("it is inert where badging isn't supported, rather than throwing", () => {
    // A plain browser tab, or an older WebView, has no setAppBadge at all.
    expect(utils).toMatch(/typeof navigator\.setAppBadge !== 'function'\) return;/);
    expect(sw).toMatch(/typeof self\.navigator\?\.setAppBadge === 'function'/);
  });

  test("the endpoint answers zero rather than failing the caller", () => {
    const endpoint = push.slice(push.indexOf('router.get("/attention"'), push.indexOf("// Optional eventType"));
    expect(endpoint).toMatch(/res\.json\(\{ total: 0/);
  });
});
