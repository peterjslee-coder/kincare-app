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

  // v1.105.54 — the acquisition stack moved to getDeviceLocation() in utils.js, because
  // caregiver check-in and check-out called the same dead API and had the same problem
  // invisibly. tests/nativeShell.test.js covers it; what stays here is this card's wording.
  test("the card delegates to the one shared location helper", () => {
    expect(client).toMatch(/const getPosition = \(\) => getDeviceLocation\(\{ timeoutMs: 20000 \}\);/);
    expect(client).not.toMatch(/navigator\.geolocation/);
  });

  test("the timeout message no longer blames the weather", () => {
    // Pete: "So it won't use WiFi to judge location?" He was right — iOS positions from
    // wifi and cell too, so "common indoors, try near a window" was GPS advice for
    // something that was never a GPS problem.
    const msgs = client.slice(client.indexOf("const GEO_MESSAGES"), client.indexOf("const getPosition"));
    expect(msgs).not.toMatch(/indoors|near a window|outside/);
    expect(msgs).toMatch(/timeout: "Your phone didn't answer with a location/);
    // Only the genuine permission-denied case may send someone into Settings.
    expect((msgs.match(/Location Services/g) || []).length).toBe(1);
  });

  test("it reports the failure instead of me guessing at it a fourth time", () => {
    expect(client).toMatch(/reportClientError\(new Error\(`\[geo\] \$\{reason\}: \$\{diag\}`\)/);
    expect(client).toMatch(/result\.diag &&/);
  });

  test("a failed check leaves the buttons tappable, not a dead spinner", () => {
    const invite = client.slice(client.indexOf("const VisitGeoInvite"), client.indexOf("const VisitNudgeCard"));
    expect(invite).toMatch(/setBusy\(false\);/);
    expect(invite).toMatch(/\{!result\?\.ok && \(/); // buttons stay while it hasn't succeeded
    // v1.105.52 — the retry wording lives in GEO_MESSAGES now, one per actual cause.
    const msgs = client.slice(client.indexOf("const GEO_MESSAGES"), client.indexOf("const nativeGeo"));
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
    //
    // v1.105.148 — the slice used to run to VisitNudgeCard, which now sweeps in VisitGeoStatus
    // as well. Bounded to the invite itself, because the property below is about THIS
    // component and a test that fails for an unrelated neighbour is a test nobody trusts.
    const start = client.indexOf("const VisitGeoInvite");
    const invite = client.slice(start, client.indexOf("const agoLabel", start));
    expect(invite).toMatch(/haversineFeet\(latitude, longitude, r\.latitude, r\.longitude\)/);
    expect(invite).toMatch(/it appears within 1,000 ft/);
    expect(invite).not.toMatch(/apiFetch|fetch\(/); // decided on the device, sent nowhere
  });

  test("the passive path still sends the person's location nowhere", () => {
    // The invariant, restated at the level it actually holds: opening the app, the nudge, and
    // the status line all read a position, compare it on the device, and send nothing.
    const status = client.slice(client.indexOf("const VisitGeoStatus"), client.indexOf("const VisitNudgeCard"));
    const passive = status.slice(0, status.indexOf("const pinHere"));
    expect(passive).not.toMatch(/apiFetch|fetch\(/);
  });

  test("the ONE thing that does send a location is deliberate, confirmed, and about the house", () => {
    // v1.105.148. Pete: "I'm definitely inside of 1000 feet from her house… but it still
    // doesn't say that I'm at her location." Every fix so far assumed the phone was wrong; the
    // other half of the subtraction is the HOME point, which came from geocoding an address and
    // can sit on a street or ZIP centroid.
    //
    // Repairing it means sending a coordinate — so it is the only call here, it is behind an
    // explicit confirmation, and what it writes is the care recipient's home on a record this
    // family owns, not a track of where the family member has been.
    const status = client.slice(client.indexOf("const VisitGeoStatus"), client.indexOf("const VisitNudgeCard"));
    const calls = status.match(/apiFetch\(/g) || [];
    expect(calls).toHaveLength(1);
    expect(status).toMatch(/apiFetch\(`\/api\/care-recipients\/\$\{target\.id\}`/);
    expect(status).toMatch(/pinState === 'confirming'/);
    expect(status).not.toMatch(/onClick=\{pinHere\}[\s\S]{0,80}Pin it here/); // never the first tap
  });

  test("no pinned address, no invite — there'd be nothing to compare against", () => {
    const invite = client.slice(client.indexOf("const VisitGeoInvite"), client.indexOf("const VisitNudgeCard"));
    expect(invite).toMatch(/r\.latitude != null && r\.longitude != null/);
    // v1.105.54 — canAskLocation(), not `navigator.geolocation`: that object EXISTS in the
    // native webview (it is the stub that never answers), so the bare check proved nothing.
    expect(invite).toMatch(/if \(hidden \|\| !withCoords\.length \|\| !canAskLocation\(\)\) return null;/);
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

// ─── v1.105.59 — the confirmation that destroyed itself ───
//
// Pete, 8/11, three days early for a visit: "I clicked that I did want to check in next
// time at Betty's… and then there was no 'ok, I'll ask you for notes the next time you're
// at Betty's' toast. Best I can tell there's no way to know how far I am from Betty's."
//
// The toast existed and rendered for roughly one frame. onEnabled() bumped `retry` in the
// parent, the effect re-ran, visitGeoAllowed() was now true, and the parent's opt-in branch
// (`allowed === false`) no longer matched — so it fell through to `return null` and unmounted
// the card holding the message. Success looked exactly like nothing happening, which is the
// same failure family as the rest of this sweep: a working feature indistinguishable from a
// broken one.
describe("saying yes to the nudge says something back", () => {
  test("the hand-off to the parent only happens when there is something to hand off to", () => {
    // Bare `onEnabled()` on every success is the bug. It may fire only in range, where the
    // parent has a nudge card to render in this card's place.
    expect(client).toMatch(/if \(onEnabled && best\.ft <= 1000\) onEnabled\(\)/);
    expect(client).not.toMatch(/\n\s*if \(onEnabled\) onEnabled\(\);/);
  });

  test("opted in and nowhere near the house renders a status line, never null", () => {
    expect(client).toMatch(/const VisitGeoStatus = /);
    expect(client).toMatch(/allowed === true && \(!match \|\| dismissed\)[\s\S]{0,80}<VisitGeoStatus/);
  });

  test("the distance is recorded on every check, not just at opt-in", () => {
    // Two call sites beyond the definition: the opt-in, and the effect that runs on each
    // dashboard open.
    expect(client.match(/recordLastCheck\(/g).length).toBeGreaterThanOrEqual(3);
  });

  test("the distance never leaves the device", () => {
    expect(client).toMatch(/VISIT_GEO_LAST_KEY = 'inplace\.visitNudge\.lastCheck'/);
    expect(client).not.toMatch(/apiFetch\([^)]*lastCheck/);
  });
});

describe("the card describes what the feature actually does", () => {
  test("it says the check happens while the app is open", () => {
    // There is no background geofence and no background location mode — see Info.plist.
    // Copy that implies the phone is watching for you would be a promise nothing keeps.
    expect(raw("public/js/components/FamilyVisitLog.js")).toMatch(/never in the background/);
  });
});
