// v1.105.38 — family visits.
//
// Pete: "how can i check in with mom… make a care session?" He couldn't. Check-in is gated
// to the assigned caregiver, so the care a family actually gives never reached the record
// that feeds the doctor report and iPAi. A month with eight family visits and two caregiver
// visits read as a month with two visits.
//
// The properties worth pinning are mostly about what this must NOT become: a session, a
// payment, a surveillance feed, or an unlabelled line in a document that goes to a doctor.

const { code, raw } = require("./helpers/source");

const route = code("src/routes/familyVisits.js");
const client = code("public/js/components/FamilyVisitLog.js");
const db = code("src/models/database.js");
const seed = code("src/seed.js");
const dash = code("public/js/components/Dashboard.js");
const team = code("public/js/components/CareTeamManage.js");
const profile = code("public/js/components/CareProfile.js");

describe("a family visit is not a session", () => {
  test("it lives in its own table, not as nullable columns on visit_logs", () => {
    // visit_logs.session_id and .caregiver_id are NOT NULL and fifteen files read that
    // table, most JOINing care_sessions. Relaxing them would make family rows vanish from
    // some queries and silently appear in others.
    expect(db).toMatch(/id: "017_family_visits"/);
    expect(db).toMatch(/CREATE TABLE IF NOT EXISTS family_visits/);
    expect(db).not.toMatch(/ALTER TABLE visit_logs[\s\S]{0,120}DROP NOT NULL/);
  });

  test("it never touches money or session state", () => {
    expect(route).not.toMatch(/care_sessions/);
    expect(route).not.toMatch(/payments|stripe|payout|application_fee/i);
  });

  test("the new table has a demo-cleanup entry", () => {
    // Third time this rule has been learned: care tasks (v1.99.1) and reimbursements
    // (v1.105.35) each broke the reseed by omitting it. One transaction, so a single FK
    // violation rolls the whole thing back with a silent 500.
    expect(seed).toMatch(/DELETE FROM family_visits WHERE care_recipient_id/);
    const cleanup = seed.indexOf("DELETE FROM family_visits");
    const parentDelete = seed.indexOf("DELETE FROM care_recipients WHERE family_user_id");
    expect(cleanup).toBeGreaterThan(-1);
    expect(cleanup).toBeLessThan(parentDelete);
  });
});

describe("access control", () => {
  test("every route goes through recipientAccess", () => {
    // The helper added in v1.105.35 after the audit found six endpoints that were
    // authenticated and nothing more.
    expect(route).toMatch(/const \{ recipientAccess \} = require\("\.\.\/utils\/access"\)/);
    expect((route.match(/await recipientAccess\(/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test("a failed check answers 404, not 403", () => {
    // "Not yours" and "not there" should be indistinguishable to someone probing uuids.
    expect(route).toMatch(/if \(!access\) return res\.status\(404\)/);
  });

  test("only the author can delete their own account of their own visit", () => {
    expect(route).toMatch(/row\.user_id !== req\.user\.id/);
    expect(route).toMatch(/Only the person who logged a visit can remove it/);
  });
});

describe("location: decided on the device, coarsened before storage, never shown to anyone", () => {
  test("the geofence decision happens client-side at full precision", () => {
    expect(client).toMatch(/function haversineFeet/);
    expect(client).toMatch(/ft <= 1000/);
  });

  test("stored coordinates are coarsened", () => {
    expect(route).toMatch(/coarsenCoordinate\(latitude\)/);
    expect(route).toMatch(/coarsenCoordinate\(longitude\)/);
  });

  test("the list endpoint never returns location or how it was logged", () => {
    // The team sees "Pete logged a visit", never "Pete was detected at Betty's house".
    // That line is the whole difference between a nudge and surveillance.
    const listQuery = route.slice(route.indexOf("SELECT fv.id"), route.indexOf("FROM family_visits"));
    expect(listQuery).not.toMatch(/latitude|longitude|distance_ft|geo_flag|logged_via/);
  });

  test("the shaped response carries no location fields", () => {
    const shape = route.slice(route.indexOf("function shape(r)"));
    expect(shape).not.toMatch(/latitude|longitude|distanceFt|geoFlag|loggedVia/);
  });
});

describe("the nudge nudges, it does not nag", () => {
  test("it never triggers a cold OS location prompt", () => {
    // Demanding a new permission for a prompt nobody asked for is exactly nagging. The only
    // getCurrentPosition that can raise one is behind the opt-in button.
    expect(client).toMatch(/const ok = await visitGeoAllowed\(\);/);
    expect(client).toMatch(/if \(!ok \|\| cancelled\) return;/);
  });

  // ─── v1.105.45 ───
  // The original gate was `navigator.permissions.query({name:'geolocation'})` with a bare
  // `return` when unavailable. WebKit doesn't implement that query, so on iOS the nudge
  // bailed on its third line and has never run — and the previous version of this test
  // asserted the bail-out as though it were the feature. Same shape as the setAppBadge bug
  // in v1.105.43: a Chrome-shaped capability check that silently kills the feature on the
  // only platform with the hardware.
  test("a missing Permissions API no longer means the feature is dead", () => {
    expect(client).toMatch(/const visitGeoAllowed/);
    expect(client).toMatch(/VISIT_GEO_OPTIN_KEY\) === '1'\) return true;/);
    expect(client).toMatch(/catch \{ return false; \}/); // WebKit rejection → opt-in, not death
  });

  test("when there's no permission to act on, it offers instead of doing nothing", () => {
    // Rendering nothing is indistinguishable from being broken — which is exactly how this
    // went unnoticed from v1.105.38 until Pete asked to try it.
    expect(client).toMatch(/const VisitGeoInvite/);
    expect(client).toMatch(/allowed === false && !alreadyLoggedToday/);
    expect(client).toMatch(/onEnabled=\{\(\) => setRetry/);
  });

  test("asking for a position always settles, even if neither callback fires", () => {
    // v1.105.47. geolocation's own `timeout` only bounds ACQUIRING a fix — the clock starts
    // after permission is decided. While the OS dialog is up, or in a webview that drops the
    // request, neither callback is ever called and the promise never settles. That is what
    // left the button reading "Checking…" forever.
    const fn = client.slice(client.indexOf("const attemptPosition"), client.indexOf("const VisitGeoInvite"));
    expect(fn).toMatch(/let settled = false/);
    expect(fn).toMatch(/const timer = setTimeout\(\(\) => done\(\{ pos: null, reason: 'timeout' \}\), ceilingMs\);/);
    expect(fn).toMatch(/catch \{ done\(\{ pos: null, reason: 'unsupported' \}\); \}/);
  });

  // ─── v1.105.52 ───
  // Pete tapped "Yes, notice" and got "Couldn't get a location fix — that's usually Location
  // Services being off." His status bar showed the location arrow ACTIVE: iOS was working on
  // it. Two of my own mistakes, both this week's habit.
  test("a 1,000 ft geofence doesn't demand a GPS-grade fix", () => {
    // enableHighAccuracy + maximumAge:0 forces a fresh satellite fix, which indoors often
    // never arrives. A wifi/cell fix answers this question in about a second.
    const fn = client.slice(client.indexOf("const getPosition = async"), client.indexOf("const VisitGeoInvite"));
    expect(fn).toMatch(/enableHighAccuracy: false, timeout: 10000, maximumAge: 60000/);
    expect(client).not.toMatch(/enableHighAccuracy: true/);
  });

  test("it falls back to watchPosition, which iOS often answers when getCurrentPosition won't", () => {
    expect(client).toMatch(/const watchOncePosition/);
    expect(client).toMatch(/navigator\.geolocation\.clearWatch\(id\)/);
    const fn = client.slice(client.indexOf("const getPosition = async"), client.indexOf("const VisitGeoInvite"));
    expect(fn).toMatch(/return watchOncePosition\(20000\);/);
    // ...but never after an outright denial: retrying that just re-reports the same no.
    expect(fn).toMatch(/first\.reason === 'denied'/);
  });

  test("the failure says what actually happened instead of guessing", () => {
    // The error callback's `code` was thrown away and a cause invented — which sent Pete
    // into Settings to fix something that wasn't broken. Worse than silence.
    expect(client).toMatch(/const geoReason = \(err\) => \{/);
    expect(client).toMatch(/if \(err\.code === 1\) return 'denied';/);
    expect(client).toMatch(/if \(err\.code === 2\) return 'unavailable';/);
    expect(client).toMatch(/if \(err\.code === 3\) return 'timeout';/);
    expect(client).toMatch(/GEO_MESSAGES\[reason\] \|\| GEO_MESSAGES\.unknown/);
    // Only the denied message may send someone to Settings.
    const msgs = client.slice(client.indexOf("const GEO_MESSAGES"), client.indexOf("const attemptPosition"));
    expect((msgs.match(/Location Services/g) || []).length).toBe(1);
    expect(msgs).toMatch(/timeout: "Your phone couldn't get a location fix in time/);
  });

  test("a failed check leaves the buttons tappable, not a dead spinner", () => {
    const invite = client.slice(client.indexOf("const VisitGeoInvite"), client.indexOf("const VisitNudgeCard"));
    expect(invite).toMatch(/setBusy\(false\);/);
    expect(invite).toMatch(/\{!result\?\.ok && \(/); // buttons stay while it hasn't succeeded
    // v1.105.52 — the retry wording lives in GEO_MESSAGES now, one per actual cause.
    const msgs = client.slice(client.indexOf("const GEO_MESSAGES"), client.indexOf("const attemptPosition"));
    expect((msgs.match(/[Tt]ap to try again|tap again/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  test("the prompt is raised by a tap, never by a page load", () => {
    const invite = client.slice(client.indexOf("const VisitGeoInvite"), client.indexOf("const VisitNudgeCard"));
    expect(invite).toMatch(/const enable = async \(\) => \{/);
    expect(invite).toMatch(/onClick=\{enable\}/);
    expect(invite).toMatch(/lsSet\(VISIT_GEO_OPTIN_KEY, '1'\)/);
  });

  test("declining hides the invite for good", () => {
    expect(client).toMatch(/VISIT_GEO_INVITE_KEY/);
    expect(client).toMatch(/lsSet\(VISIT_GEO_INVITE_KEY, '1'\)/);
  });

  test("it reports the distance, so 'is this even working' has an answer", () => {
    // Otherwise the only way to test a geofence is to drive to the house and hope.
    const invite = client.slice(client.indexOf("const VisitGeoInvite"), client.indexOf("const VisitNudgeCard"));
    expect(invite).toMatch(/haversineFeet\(latitude, longitude, r\.latitude, r\.longitude\)/);
    expect(invite).toMatch(/it appears within 1,000 ft/);
    expect(invite).not.toMatch(/apiFetch|fetch\(/); // decided on the device, sent nowhere
  });

  test("no pinned address, no invite — there'd be nothing to compare against", () => {
    const invite = client.slice(client.indexOf("const VisitGeoInvite"), client.indexOf("const VisitNudgeCard"));
    expect(invite).toMatch(/r\.latitude != null && r\.longitude != null/);
    expect(invite).toMatch(/if \(hidden \|\| !withCoords\.length \|\| !navigator\.geolocation\) return null;/);
  });

  test("it is dismissible and stays dismissed for a while", () => {
    expect(client).toMatch(/VISIT_NUDGE_DISMISS_KEY/);
    expect(client).toMatch(/Date\.now\(\) \+ 6 \* 3600 \* 1000/);
  });

  test("it suppresses itself once a visit is logged today", () => {
    expect(client).toMatch(/if \(alreadyLoggedToday\) return;/);
  });

  test("every storage touch is guarded", () => {
    // A throw here would take the dashboard down — see the v1.105.35 white-screen fix.
    // Checked structurally, not per line: the try often opens on the line above, and a
    // per-line regex reported a correctly-guarded call as unguarded on the first run.
    const idxs = [];
    let i = -1;
    while ((i = client.indexOf("localStorage.", i + 1)) !== -1) idxs.push(i);
    expect(idxs.length).toBeGreaterThan(0);
    for (const at of idxs) {
      const before = client.slice(Math.max(0, at - 220), at);
      const after = client.slice(at, at + 320);
      expect(before.includes("try {") || after.includes("catch")).toBe(true);
    }
  });
});

describe("retroactive by design", () => {
  test("the sheet defaults to now but lets you change it", () => {
    // Pete on Peggy: "she'll probably write a long screed when she gets home… it has to be
    // retroactive."
    expect(client).toMatch(/type="datetime-local"/);
  });

  test("the server accepts backdating but refuses the future", () => {
    expect(route).toMatch(/A visit can't be in the future/);
    expect(route).toMatch(/90 \* 24 \* 3600 \* 1000/);
  });
});

describe("the push nudges you back to the app without spilling the note", () => {
  test("the body is 'Tap to read', never the summary", () => {
    // Two reasons that agree: summary is PHI and would otherwise sit on every team member's
    // lock screen; and a push that already says what Pete said is a worse nudge, because
    // there's nothing left to come back for.
    expect(route).toMatch(/body: "Tap to read"/);
    const notify = route.slice(route.indexOf("async function notifyTeam"));
    expect(notify).not.toMatch(/summary/);
  });

  test("it never pushes your own visit back at you", () => {
    expect(route).toMatch(/ids\.delete\(req\.user\.id\)/);
  });

  test("it has its own event type, so it gets its own toggle", () => {
    expect(route).toMatch(/"family_visit"\)/);
  });
});

describe("the pill swap Pete asked for", () => {
  test("the dashboard slot says '+ Log Visit'", () => {
    // "I'm FAR more likely to log a visit than I am to add a task."
    expect(dash).toMatch(/\+ Log Visit<\/button>/);
  });

  test("'+ Task' is gone from the dashboard and present on the care team page", () => {
    expect(dash).not.toMatch(/>\+ Task<\/button>/);
    expect(team).toMatch(/\+ Task/);
    expect(team).toMatch(/CareTaskQuickCreate/);
  });

  test("task creation still exists — this was a ranking decision, not a removal", () => {
    expect(team).toMatch(/setShowTaskCreate\(true\)/);
  });
});

describe("the record shows the source", () => {
  test("family visits are labelled where they appear", () => {
    expect(profile).toMatch(/FAMILY VISIT/);
  });

  test("they are merged at read time, not duplicated into notes", () => {
    // One event, one row. Writing a recipient_notes row too would mean two rows that drift
    // the moment anyone edits or deletes.
    expect(profile).toMatch(/fetchFamilyVisits/);
    expect(route).not.toMatch(/INSERT INTO recipient_notes/);
  });
});

describe("the activity chips are the approved straw man", () => {
  test("including 'Just company', which a caregiver-shaped form would omit", () => {
    expect(client).toMatch(/id: 'company', label: 'Just company'/);
    for (const id of ["meal", "medication_reminder", "errand", "appointment", "housework", "company"]) {
      expect(route).toMatch(new RegExp(`"${id}"`));
    }
  });

  test("the server only accepts chips from that list", () => {
    expect(route).toMatch(/ACTIVITIES\.includes\(a\)/);
  });
});
