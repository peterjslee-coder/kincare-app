/**
 * v1.106.34 — twenty tiles buried the screen, and nobody told her they were there.
 *
 * Pete: "what's going on with the 20 tiles on Tina's homepage? ... when you send someone 20
 * days worth, it buries everything ... I'm not sure she even realizes they're there, and this
 * morning it caused her to miss where check-in was."
 *
 * Three separate faults wearing one costume:
 *   1. the offers block was unbounded, so a pile pushed everything below it off the screen;
 *   2. twenty one-off bookings carry no recurrence_group_id, so v1.106.24's grouping could
 *      not fold them;
 *   3. the "new care request" push went ONLY to caregiver_assignments — people who have
 *      already worked for that family — so the person a job was exclusively offered to was
 *      told nothing at all.
 *
 * The third is the one that answers "she didn't realize". It is asserted in
 * tests/integration/offerNotification.itest.js against the real route; this file covers the
 * two client-side halves.
 */
const { code } = require("./helpers/source");

describe("the home screen stops being a wall", () => {
  const hub = code("public/js/components/CaretakerHub.js");

  test("only the two soonest render as cards", () => {
    expect(hub).toContain("const OFFER_PREVIEW = 2;");
    expect(hub).toContain("offersExpanded ? entries : entries.slice(0, OFFER_PREVIEW)");
  });

  test("the rest collapse into one line that says how many and what they're worth", () => {
    expect(hub).toContain("more visit{hiddenVisits === 1 ? '' : 's'} just for you");
    expect(hub).toContain("formatMoney(hiddenTotal)");
  });

  test("it opens in place — nothing is actually hidden", () => {
    expect(hub).toContain("setOffersExpanded(true)");
    expect(hub).toContain("setOffersExpanded(false)");
  });

  test("the count is visits, not cards", () => {
    // A grouped card holding twenty visits must read as twenty, not as one. "1 more offer"
    // when it is a month of work is the same burying in a smaller font.
    expect(hub).toContain("visitsIn = (e) => (e.kind === 'series' ? e.jobs.length : 1)");
  });

  test("the check-in still outranks all of it", () => {
    // v1.106.23. The collapse helps, but the thing she actually missed must not depend on it.
    const iPinned = hub.indexOf("renderUpNext(upNextSplit.ready");
    const iOffers = hub.indexOf("const exclusiveOffers = openJobs.filter");
    expect(iPinned).toBeGreaterThan(-1);
    expect(iPinned).toBeLessThan(iOffers);
  });
});

describe("she can tell without scrolling", () => {
  test("the hub publishes how many are waiting", () => {
    const hub = code("public/js/components/CaretakerHub.js");
    expect(hub).toContain("inplace:offerCount");
    expect(hub).toContain("j.offeredToCaregiverId && !isExclusiveExpired(j, Date.now())");
  });

  test("the bottom bar badges Find Work with it", () => {
    const app = code("public/js/app.js");
    expect(app).toContain("item.id === 'find-work' && offerCount > 0");
    expect(app).toContain("window.addEventListener('inplace:offerCount', onCount)");
  });

  test("the listener is torn down", () => {
    // A window listener added on every mount and never removed is a leak that survives
    // every page change for the life of the session.
    expect(code("public/js/app.js")).toContain("window.removeEventListener('inplace:offerCount', onCount)");
  });
});

describe("accepting a pile", () => {
  const hub = code("public/js/components/CaretakerHub.js");

  test("goes through claim-batch, which works without a series id", () => {
    // A shape-grouped card has no recurrence_group_id to claim by — the twenty one-off days
    // are exactly that case.
    expect(hub).toContain("apiFetch('/api/sessions/claim-batch'");
    expect(hub).not.toContain("/api/sessions/recurring/${groupId}/claim");
  });

  test("it sends what she declined as well as what she accepted", () => {
    // An inferred group has no boundary the server can derive, so the client says what it
    // showed. Otherwise the unticked dates would sit under her name until the window lapses.
    expect(hub).toContain("accept: sessionIds, decline: declineIds || []");
    expect(hub).toContain("jobs.map((j) => j.id).filter((id) => !picked.has(id))");
  });
});
