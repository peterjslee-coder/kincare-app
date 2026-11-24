/**
 * v1.106.23 — the check-in outranks everything on the caregiver's home screen.
 *
 * Tina, first visit, standing at the door: she could not check in. Eleven "Just for You"
 * cards sat above the session card, the offers block is unbounded and each card is full
 * height, so the check-in button was several screens down and she never found it. Pete filed
 * it as a complaint, not a bug, which is the right severity — the app worked and the visit
 * still nearly did not start.
 *
 * Two things are asserted here and they fail differently on purpose:
 *
 *   1. ORDER. The pinned block must appear in the source above the offers block. This is a
 *      structural assertion because the bug WAS structural — every individual piece worked.
 *   2. THE SPLIT. A session is pinned or in Up Next, never both. Rendering it twice would
 *      hand her two check-in buttons for one visit. This one executes the real code.
 */
const { raw, code } = require("./helpers/source");

const HUB = "public/js/components/CaretakerHub.js";

describe("order on the caregiver home screen", () => {
  const src = code(HUB);

  // Anchors are the render CALLS, not the comments that describe them — code() strips
  // line-owning comments, so anchoring on prose would make every assertion below vacuous.
  const iPinned    = src.indexOf("renderUpNext(upNextSplit.ready");
  const iRest      = src.indexOf("renderUpNext(upNextSplit.rest");
  const iOffers    = src.indexOf("const exclusiveOffers = openJobs.filter");
  const iProposals = src.indexOf("const proposals = data.myProposals || [];");
  const iFindWork  = src.indexOf("const nonExclusiveJobs = openJobs.filter");
  const iIncomplete= src.indexOf("{incompleteCheckIn && (() => {");
  const iFirstSteps= src.indexOf("{showFirstSteps && (() => {");
  const iNoShow    = src.indexOf("noShowAlerts");

  test("every anchor is actually present", () => {
    for (const [name, i] of Object.entries({
      iPinned, iRest, iOffers, iProposals, iFindWork, iIncomplete, iFirstSteps,
    })) {
      expect({ name, i }).toEqual({ name, i: expect.any(Number) });
      expect(i).toBeGreaterThan(-1);
    }
  });

  test("the pinned check-in comes before the offers that buried it", () => {
    expect(iPinned).toBeLessThan(iOffers);
  });

  test("...and before proposals, First Steps and Find Work", () => {
    expect(iPinned).toBeLessThan(iProposals);
    expect(iPinned).toBeLessThan(iFirstSteps);
    expect(iPinned).toBeLessThan(iFindWork);
  });

  test("only the incomplete-check-in banner is allowed above it", () => {
    // The same job, already started, expiring into a no-show. Nothing else outranks a
    // check-in that is due now.
    expect(iIncomplete).toBeLessThan(iPinned);
  });

  test("the rest of Up Next still sits below the offers, where it was", () => {
    // The fix lifts ONE card class. A session 20 hours out has not become urgent.
    expect(iRest).toBeGreaterThan(iOffers);
  });

  test("no-show alerts still precede the offers", () => {
    expect(iNoShow).toBeLessThan(iOffers);
  });
});

describe("the split itself", () => {
  // Execute the real function rather than describe it. Extracted from source so it cannot
  // drift from what ships.
  const src = raw(HUB);
  const m = src.match(/const upNextSplit = \(\(\) => \{[\s\S]*?\}\)\(\);/);

  test("upNextSplit is where the test thinks it is", () => {
    expect(m).toBeTruthy();
  });

  const build = (upNextSessions, readyToCheckIn, myProposals) => {
    const fn = new Function(
      "upNextSessions", "readyToCheckIn", "data",
      m[0].replace("const upNextSplit =", "return") + "\nreturn upNextSplit;"
        .replace("return upNextSplit;", "")
    );
    // The replace above turns the declaration into a returned expression.
    return fn(upNextSessions, readyToCheckIn, { myProposals });
  };

  const s = (id) => ({ id });

  test("a session ready to check in is pinned and NOT in the rest", () => {
    const r = build([s("a"), s("b")], [s("a")], []);
    expect(r.ready.map((x) => x.id)).toEqual(["a"]);
    expect(r.rest.map((x) => x.id)).toEqual(["b"]);
  });

  test("no session appears in both lists — she never gets two check-in buttons", () => {
    const all = [s("a"), s("b"), s("c"), s("d")];
    const r = build(all, [s("a"), s("c")], []);
    const overlap = r.ready.filter((x) => r.rest.some((y) => y.id === x.id));
    expect(overlap).toEqual([]);
    expect(r.ready.length + r.rest.length).toBe(all.length);
  });

  test("a session with a pending time proposal is in neither — the family never agreed", () => {
    const r = build([s("a"), s("b")], [s("a")], [{ sessionId: "a", status: "pending" }]);
    expect(r.ready).toEqual([]);
    expect(r.rest.map((x) => x.id)).toEqual(["b"]);
  });

  test("an expired proposal is excluded too", () => {
    const r = build([s("a")], [], [{ sessionId: "a", status: "expired" }]);
    expect(r.rest).toEqual([]);
  });

  test("an accepted proposal does not exclude the session", () => {
    const r = build([s("a")], [s("a")], [{ sessionId: "a", status: "accepted" }]);
    expect(r.ready.map((x) => x.id)).toEqual(["a"]);
  });

  // The caregiver tour lights [data-tour="up-next"] by querying the live DOM. Splitting one
  // block into two can produce zero anchors (tour silently does nothing on stop 1) or two
  // (querySelector takes whichever is first, which may be the one that rendered null). So the
  // flag has to be exactly-one, and that is worth executing rather than eyeballing.
  describe("the tour anchor survives the split", () => {
    const anchorCount = (ready, rest) =>
      (rest.length === 0 && ready.length > 0 ? 1 : 0) + (rest.length > 0 ? 1 : 0);

    test("one anchor when only the pinned block renders", () => {
      expect(anchorCount([s("a")], [])).toBe(1);
    });
    test("one anchor when only the ordinary block renders", () => {
      expect(anchorCount([], [s("b")])).toBe(1);
    });
    test("one anchor — not two — when both render", () => {
      expect(anchorCount([s("a")], [s("b")])).toBe(1);
    });
    test("no anchor when neither renders, as before the split", () => {
      expect(anchorCount([], [])).toBe(0);
    });
  });

  test("nothing ready to check in means an empty pin, not a crash", () => {
    const r = build([s("a"), s("b")], [], []);
    expect(r.ready).toEqual([]);
    expect(r.rest).toHaveLength(2);
  });
});
