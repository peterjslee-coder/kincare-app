/**
 * Two prompts that would not take an answer. (v1.106.44)
 *
 * Pete, in the same pull:
 *
 *   "Tina's app seems to be stuck on showing her the tour again. If she takes the tour or
 *    skips the tour, it should disappear from the home screen until she goes to her account."
 *
 *   "I hit log this visit when it tagged me at mom's house. I left a note. The log visit
 *    option is still remaining at the top of the screen. It should understand that I've
 *    logged a visit and then not prompt me again."
 *
 * Different screens, different people, the same defect: the code knew the answer and did not
 * act on it. The tour card had a `done` state that still rendered something, and the visit
 * nudge consulted `alreadyLoggedToday` everywhere except the branch that draws the card.
 *
 * Source assertions, because both are pure render conditions with no server call to make and
 * no state to drive from a test — what is worth pinning is the CONDITION, and the condition
 * is one line in each file.
 */
const { code } = require("./helpers/source");

const tour = code("public/js/components/CaregiverTour.js");
const nudge = code("public/js/components/FamilyVisitLog.js");
const dash = code("public/js/components/Dashboard.js");
const account = code("public/js/components/MyAccount.js");
const server = code("src/routes/dashboard.js");

describe("the tour stops offering itself once she has answered", () => {
  test("done or later retires the card entirely", () => {
    expect(tour).toMatch(/if \(done \|\| later\) return null;/);
  });

  // The card component only — "Where things live" is also the tour's own last SCREEN, which
  // is fine and stays. The first cut of this test matched the whole file and failed on it.
  const card = tour.slice(tour.indexOf("const CaregiverTourCard"));

  test("the 'Where things live' map is gone from the home screen", () => {
    // It rendered on `done` until her first completed visit — a condition a caregiver whose
    // first visit is still ahead of her cannot reach, so for Tina it was permanent.
    expect(card).not.toMatch(/Where things live/);
    expect(card).not.toMatch(/Tour again/);
  });

  test("and the tour no longer promises it will be there", () => {
    // The last screen of the tour said "This list stays on your Home screen until your first
    // real visit". Retiring the card without fixing that line would have left the tour
    // pointing a caregiver at something that is not there.
    expect(tour).not.toMatch(/stays on your Home screen/);
    expect(tour).toMatch(/Account .* Show me around the app/);
  });

  test("so is the 'whenever you like' strip that Later left behind", () => {
    expect(tour).not.toMatch(/Two-minute tour of the app, whenever you like/);
  });

  test("the first offer still exists — this retires the remnants, not the tour", () => {
    expect(tour).toMatch(/Show me around/);
    expect(tour).toMatch(/setLater/);
  });

  test("completedCount is gone rather than left as a prop nothing reads", () => {
    expect(tour).not.toMatch(/completedCount/);
  });

  test("and it is replayable from Account, which is where Pete said to look", () => {
    expect(account).toMatch(/Show me around the app/);
    expect(account).toMatch(/__startCaregiverTour/);
  });

  test("the Account button is caregiver-only and never renders dead", () => {
    const i = account.indexOf("Show me around the app");
    const block = account.slice(Math.max(0, i - 900), i);
    expect(block).toMatch(/caregiver/);
    expect(block).toMatch(/window\.__startCaregiverTour &&/);
  });
});

describe("the visit nudge takes yes for an answer", () => {
  test("the branch that DRAWS the card checks it — the line that was missing", () => {
    expect(nudge).toMatch(/if \(!match \|\| dismissed \|\| loggedFor\(match\.recipient\)\) return null;/);
  });

  test("it is per recipient, not one boolean for everybody", () => {
    // Logging a visit to Betty must not silence the nudge about someone else.
    expect(nudge).toMatch(/loggedTodayIds/);
    expect(nudge).toMatch(/const loggedFor = \(r\) => !!r && logged\.has\(r\.id\)/);
    expect(nudge).not.toMatch(/alreadyLoggedToday\s*[,)}]/);
  });

  test("the empty-state branches use the same fact, so they cannot disagree", () => {
    expect(nudge).toMatch(/allowed === false && !everyoneLogged/);
    expect(nudge).toMatch(/allowed === true && \(!match \|\| dismissed\) && !everyoneLogged/);
  });
});

describe("and the answer survives a reload", () => {
  test("the server says which recipients already have a visit logged today", () => {
    expect(server).toMatch(/visitLoggedToday/);
    expect(server).toMatch(/FROM family_visits fv/);
  });

  test("'today' is decided in the RECIPIENT's timezone, not the server's", () => {
    // The family may be in another one. A UTC date would silence the nudge early for some
    // people and late for others, which is worse than not having it.
    const i = server.indexOf("const visitLoggedToday");
    const block = server.slice(i, i + 700);
    expect(block).toMatch(/v\.timezone \|\| DEFAULT_TIMEZONE/);
    expect(block).toMatch(/getTodayStringInZone\(tz\)/);
  });

  test("the timezone default is imported under the name the module actually exports", () => {
    // It was written as DEFAULT_TZ first, which is not an export — a defined binding holding
    // undefined, which no lint catches and which would have silently used the fallback.
    expect(server).toMatch(/getTodayStringInZone, DEFAULT_TIMEZONE \} = require\("\.\.\/utils\/timezone"\)/);
    expect(server).not.toMatch(/\bDEFAULT_TZ\b/);
  });

  test("the dashboard seeds from the server and adds what this session logged", () => {
    expect(dash).toMatch(/data\?\.visitLoggedToday \|\| \[\]/);
    expect(dash).toMatch(/setVisitsToday\(\(prev\) => \[\.\.\.prev, showLogVisit\.recipientId\]\)/);
  });

  test("visitsToday is a list now, not the boolean that always started false", () => {
    expect(dash).toMatch(/const \[visitsToday, setVisitsToday\] = useState\(\[\]\)/);
    expect(dash).not.toMatch(/setVisitsToday\(true\)/);
  });
});
