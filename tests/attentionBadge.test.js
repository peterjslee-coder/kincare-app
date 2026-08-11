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

  test("the server is asked even where the browser can't draw a badge", () => {
    // v1.105.43 — the other half of the 78. This used to bail on its first line unless
    // navigator.setAppBadge existed, and iOS WKWebView has no Badging API at all. Inside
    // the native app it therefore never called the endpoint, so the server never learned
    // the app was open and the correction never fired. The fetch must come FIRST; only
    // the local setAppBadge is allowed to be conditional.
    const fn = utils.slice(utils.indexOf("const refreshAppBadge"), utils.indexOf("const checkPushHealth"));
    expect(fn.indexOf("apiFetch('/api/push/attention')"))
      .toBeLessThan(fn.indexOf("typeof navigator.setAppBadge !== 'function'"));
    // ...and the listener can't be gated on it either.
    expect(fn).toMatch(/if \(typeof document !== 'undefined'\) \{/);
    expect(fn).toMatch(/document\.addEventListener\('resume'/); // Capacitor foreground
  });

  test("it is inert where badging isn't supported, rather than throwing", () => {
    // A plain browser tab, or an older WebView, has no setAppBadge at all.
    expect(utils).toMatch(/typeof navigator\.setAppBadge !== 'function'\) return;/);
    expect(sw).toMatch(/typeof self\.navigator\?\.setAppBadge === 'function'/);
  });

  test("the endpoint declines to answer rather than asserting zero", () => {
    // v1.105.60 — INVERTED. This used to read "the endpoint answers zero rather than failing
    // the caller", and it was pinning a bug in place.
    //
    // "A badge is a convenience, never fail the caller over it" is right about the caller and
    // wrong about the number. 200 {total: 0} does not decline to answer — it answers "nothing
    // needs you". AttentionCard renders that as caught-up and refreshAppBadge CLEARS the icon,
    // so an internal error erased a correct badge that was flagging an overdue care task, and
    // the card that would have itemised it agreed that all was well. That is precisely the
    // failure this suite's own v1.105.42 note is about, arriving by a different door.
    //
    // Both callers already handle a non-OK response by leaving the existing badge alone, which
    // is the behaviour we actually wanted all along: on error, change nothing.
    //
    // The slice boundary was wrong too: "async function syncBadgeToDevices" moved to
    // utils/badgeSync.js in v1.105.44, so indexOf returned -1 and this "endpoint" was really
    // everything from the route to the end of the file. Bounds-checked now.
    const start = push.indexOf('router.get("/attention"');
    const end = push.indexOf("const { syncBadgeToDevices } = require", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const endpoint = push.slice(start, end);

    expect(endpoint).toMatch(/res\.status\(500\)/);
    expect(endpoint).not.toMatch(/res\.json\(\{ total: 0/);
  });
});

// ─── v1.105.42 — the 78 ───
//
// Pete sent a screenshot of a red 78 on the icon: "I don't know how to clear any of them
// and I don't know what they are." Every test above passed the whole time, because they
// run against a fake db — and a fake db cannot tell you that a WHERE clause is always
// true. The behavioural proof now lives in tests/integration/attention.itest.js; what
// belongs here is the SHAPE of the fixes, so none of them can be quietly undone.
describe("the count has to be clearable, or it is just wallpaper", () => {
  const util = code("src/utils/attention.js");

  test("unread is decided by last_read_at, not by the flag the app never sets", () => {
    // `messages.is_read` is only ever written for LEGACY direct messages — every UPDATE
    // that touches it ends `AND conversation_id IS NULL`. Joined against
    // conversation_members, `is_read = 0` was vacuously true, so the badge counted every
    // message ever sent in every conversation he belonged to. Forever.
    expect(util).toMatch(/m\.created_at > COALESCE\(cm\.last_read_at/);
    expect(util).not.toMatch(/COALESCE\(m\.is_read, 0\) = 0/);
  });

  test("it counts only what you could actually reach and clear", () => {
    expect(util).toMatch(/cm\.archived_at IS NULL/);   // out of sight → out of count
    expect(util).toMatch(/cm\.deleted_at IS NULL/);
    expect(util).toMatch(/kindred@yourinplace\.com/);  // read in Kindred chat instead
    expect(util).toMatch(/t\.is_active = 1/);          // orphaned occurrences of a paused
                                                       // or deleted task
  });

  test("it is the same definition the in-app unread count uses", () => {
    // The v1.105.40 promise was that the icon, the push payload and the in-app count can
    // never disagree. That only holds if they run the same query.
    const conversations = code("src/routes/messages.js");
    for (const clause of [/created_at > COALESCE/, /kindred@yourinplace\.com/]) {
      expect(util).toMatch(clause);
      expect(conversations).toMatch(clause);
    }
  });
});

describe("opening the app corrects the icon, without waiting for a native build", () => {
  const push = code("src/routes/push.js");
  const apns = code("src/utils/apns.js");
  const db = code("src/models/database.js");

  test("there is a silent, badge-only APNs send", () => {
    // Nothing but `badge` in the aps dictionary: no alert, no sound, no body — so iOS
    // redraws the icon and displays nothing.
    expect(apns).toMatch(/function sendApnsBadge/);
    expect(apns).toMatch(/aps: \{ badge: Math\.max\(0, Number\(count\) \|\| 0\) \}/);
  });

  test("it is NOT a background push — this app can't receive those", () => {
    // v1.105.43. Sent as `content-available: 1` / push-type background, it did nothing at
    // all: iOS drops background notifications unless the app declares UIBackgroundModes →
    // remote-notification, and InPlace's Info.plist has no UIBackgroundModes key (only
    // aps-environment, in App.entitlements). APNs answered 200 the whole time, because 200
    // means queued, not shown. Pete's badge sat at 78 through all of v1.105.42.
    const fn = apns.slice(apns.indexOf("function sendApnsBadge"));
    expect(fn).not.toMatch(/content-available/);
    expect(fn).not.toMatch(/"apns-push-type": "background"/);
    expect(fn).toMatch(/"apns-push-type": "alert"/);
    expect(fn).toMatch(/"apns-priority": "10"/);

    // And the reason holds: if someone adds the background mode later, this test should
    // be the thing that makes them reconsider rather than a silent regression.
    const plist = require("fs").readFileSync(
      require("path").join(__dirname, "..", "ios/App/App/Info.plist"), "utf8");
    expect(plist).not.toMatch(/UIBackgroundModes/);
  });

  test("badges recorded by v1.105.42 are forgotten, or the first real push is suppressed", () => {
    expect(db).toMatch(/id: "019_reset_last_badge"/);
    expect(db).toMatch(/UPDATE push_subscriptions SET last_badge = NULL/);
  });

  test("it fires when the app asks for its count", () => {
    // GET /api/push/attention is already called on launch and on every return to the
    // foreground, so that is the moment we know the app is open and can correct the icon.
    expect(push).toMatch(/syncBadgeToDevices\(db, req\.user\.id, counts\.total\)/);
  });

  test("answering the caller never waits on Apple", () => {
    const endpoint = push.slice(push.indexOf('router.get("/attention"'), push.indexOf("async function syncBadgeToDevices"));
    expect(endpoint.indexOf("res.json(counts)")).toBeLessThan(endpoint.indexOf("syncBadgeToDevices"));
    expect(endpoint).toMatch(/syncBadgeToDevices\([^)]*\)\.catch\(\(\) => \{\}\)/);
  });

  test("it only sends when the number actually changed", () => {
    // v1.105.44 — syncBadgeToDevices lives in utils/badgeSync.js now, because tying the
    // correction to one endpoint is what left the icon stuck. Behaviour is covered in
    // tests/badgeSync.test.js; the migration it depends on is pinned here.
    const sync = code("src/utils/badgeSync.js");
    expect(sync).toMatch(/if \(sub\.last_badge === n\) continue;/);
    expect(sync).toMatch(/UPDATE push_subscriptions SET last_badge = \? WHERE id = \?/);
    expect(db).toMatch(/id: "018_push_last_badge"/);
    expect(db).toMatch(/ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS last_badge INTEGER/);
  });

  test("a real notification records the badge it just set, so the corrector stays quiet", () => {
    expect(push).toMatch(/last_success_at = NOW\(\), last_badge = \? WHERE id = \?/);
  });

  test("web-push subscriptions are left alone — the service worker already handles them", () => {
    const sync = code("src/utils/badgeSync.js");
    expect(sync).toMatch(/subObj\.type !== "native" \|\| subObj\.platform !== "ios"\) continue;/);
  });

  test("a dead token is pruned, and nothing else escapes", () => {
    const sync = code("src/utils/badgeSync.js");
    expect(sync).toMatch(/statusCode === 410/);
    expect(sync).toMatch(/DELETE FROM push_subscriptions WHERE id = \?/);
  });
});

describe("the number says what it is made of", () => {
  const card = code("public/js/components/AttentionCard.js");
  const dash = code("public/js/components/Dashboard.js");

  test("the card reads the same endpoint the icon does", () => {
    // "I don't know what they are" survives fixing the count. A badge with no list behind
    // it is a number you can only ignore.
    expect(card).toMatch(/apiFetch\('\/api\/push\/attention'\)/);
  });

  test("every category is a row, and every row goes where you clear it", () => {
    for (const key of ["reimbursements", "timeChanges", "careTasks", "messages"]) {
      expect(card).toMatch(new RegExp(`key: '${key}'`));
    }
    expect(card).toMatch(/onNavigate && onNavigate\(r\.page\)/);
  });

  test("nothing waiting draws nothing at all", () => {
    // The dashboard is crowded — his word — and "you're all caught up" is decoration.
    expect(card).toMatch(/if \(!counts \|\| !counts\.total\) return null;/);
  });

  test("it refreshes on return, like the badge does", () => {
    expect(card).toMatch(/visibilitychange/);
    expect(card).toMatch(/removeEventListener\('visibilitychange'/);
  });

  test("it is on the dashboard, guarded so a missing component can't white-screen it", () => {
    expect(dash).toMatch(/typeof AttentionCard !== 'undefined' && <AttentionCard onNavigate=\{onNavigate\} \/>/);
  });

  test("it is in the bundle — an unbundled component is an undefined one", () => {
    expect(code("scripts/build-client.js")).toMatch(/js\/components\/AttentionCard\.js/);
  });
});
