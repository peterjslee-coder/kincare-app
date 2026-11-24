/**
 * v1.106.24 — a recurring offer is one card, not twelve. (3f19a5de)
 *
 * Pete: "Appointments grouped on recurring basis should not require individual acceptance."
 * The same twelve cards are what pushed Tina's check-in eleven cards down the screen, so
 * this and the ordering fix are two halves of one morning.
 *
 * Everything here executes the real shipped code — groupExclusiveOffers and getWeekdayName
 * are loaded from source — because the grouping rule is the whole feature and a source
 * assertion about it would prove nothing.
 */
const fs = require("fs");
const path = require("path");
const { code } = require("./helpers/source");

const REPO = path.join(__dirname, "..");

// ─── load the two real functions ────────────────────────────────────────────
const groupExclusiveOffers = (() => {
  const src = fs.readFileSync(path.join(REPO, "public/js/utils.js"), "utf8");
  const m = src.match(/const groupExclusiveOffers = window\.groupExclusiveOffers = \(jobs\) => \{[\s\S]*?\n\};/);
  if (!m) throw new Error("groupExclusiveOffers not found in utils.js");
  const win = {};
  // eslint-disable-next-line no-new-func
  return new Function("window", m[0].replace("const groupExclusiveOffers = window.groupExclusiveOffers =", "return") + "")(win);
})();

const getWeekdayName = (() => {
  const src = fs.readFileSync(path.join(REPO, "public/js/components/TimezoneHelper.js"), "utf8");
  const m = src.match(/function getWeekdayName\(dateStr, tz\) \{[\s\S]*?\n  \}/);
  if (!m) throw new Error("getWeekdayName not found");
  // eslint-disable-next-line no-new-func
  return new Function("DEFAULT_TZ", m[0] + "\nreturn getWeekdayName;")("America/New_York");
})();

// A job with no shape fields — the pre-v1.106.34 fixture. These must stay singletons.
const job = (id, groupId, date) => ({ id, recurrenceGroupId: groupId, date });
// A real one, with the fields shape-grouping keys on.
const realJob = (id, date, over = {}) => ({
  id, date, recurrenceGroupId: null,
  careRecipientId: 'betty', time: '09:00', durationHours: 8, serviceType: 'companion',
  ...over,
});

describe("grouping recurring offers", () => {
  test("twelve occurrences of one series become one entry", () => {
    const jobs = Array.from({ length: 12 }, (_, i) => job(`s${i}`, "g1", `2026-09-${15 + i}`));
    const out = groupExclusiveOffers(jobs);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("series");
    expect(out[0].groupId).toBe("g1");
    expect(out[0].jobs).toHaveLength(12);
  });

  test("a job with no recipient or time is never shape-grouped", () => {
    // v1.106.34 — the shape key needs both to mean anything. The first cut joined whatever
    // was there, so two jobs missing every field hashed to the same empty key and merged.
    const out = groupExclusiveOffers([job("a", null, "2026-09-15"), job("b", null, "2026-09-16")]);
    expect(out.map((e) => e.kind)).toEqual(["single", "single"]);
  });

  test("twenty separate bookings of the SAME shape collapse to one card", () => {
    // Pete's actual screen: twenty one-off days booked before "Certain days" existed, so
    // not one of them carries a recurrence_group_id. Twenty full-height tiles buried her
    // check-in. From her side they are one arrangement.
    const jobs = Array.from({ length: 20 }, (_, i) => realJob(`s${i}`, `2026-09-${String(i + 1).padStart(2, '0')}`));
    const out = groupExclusiveOffers(jobs);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("series");
    expect(out[0].jobs).toHaveLength(20);
    expect(out[0].groupId).toBeNull(); // inferred, not a real series
  });

  test("different times do NOT merge — a morning and an evening visit are two jobs", () => {
    const out = groupExclusiveOffers([
      realJob("morning", "2026-09-15", { time: "09:00" }),
      realJob("evening", "2026-09-15", { time: "18:00" }),
    ]);
    expect(out).toHaveLength(2);
  });

  test("different people do NOT merge", () => {
    const out = groupExclusiveOffers([
      realJob("betty", "2026-09-15", { careRecipientId: 'betty' }),
      realJob("arthur", "2026-09-16", { careRecipientId: 'arthur' }),
    ]);
    expect(out).toHaveLength(2);
  });

  test("a real series id beats the inferred one", () => {
    // Stated intent wins over a guess: same shape, but one was booked as a series.
    const out = groupExclusiveOffers([
      realJob("a", "2026-09-15", { recurrenceGroupId: "g1" }),
      realJob("b", "2026-09-22", { recurrenceGroupId: "g1" }),
      realJob("c", "2026-09-16"),
      realJob("d", "2026-09-17"),
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((e) => e.groupId === "g1").jobs).toHaveLength(2);
    expect(out.find((e) => e.groupId === null).jobs).toHaveLength(2);
  });

  test("two different series do not merge", () => {
    const out = groupExclusiveOffers([
      job("a", "g1", "2026-09-15"), job("b", "g2", "2026-09-16"),
      job("c", "g1", "2026-09-22"), job("d", "g2", "2026-09-23"),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.groupId)).toEqual(["g1", "g2"]);
    expect(out[0].jobs.map((j) => j.id)).toEqual(["a", "c"]);
    expect(out[1].jobs.map((j) => j.id)).toEqual(["b", "d"]);
  });

  test("a group holds the position of its earliest visit — the list still reads soonest-first", () => {
    // If a group jumped to the end, a series starting tomorrow would sort below a one-off
    // next month, which is the opposite of what the screen is for.
    const out = groupExclusiveOffers([
      job("series-first", "g1", "2026-09-15"),
      job("oneoff", null, "2026-09-16"),
      job("series-later", "g1", "2026-09-22"),
    ]);
    expect(out.map((e) => e.key)).toEqual(["g1", "oneoff"]);
  });

  test("a series down to its last visit renders as a single, not a one-item checklist", () => {
    // Eleven of twelve already taken. A date list with one checkbox is silly.
    const out = groupExclusiveOffers([job("last", "g1", "2026-09-15")]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("single");
    expect(out[0].job.id).toBe("last");
  });

  test("mixed singles and series keep every job exactly once", () => {
    const jobs = [
      job("a", null, "2026-09-15"), job("b", "g1", "2026-09-16"),
      job("c", "g1", "2026-09-23"), job("d", null, "2026-09-24"),
    ];
    const out = groupExclusiveOffers(jobs);
    const seen = out.flatMap((e) => (e.kind === "series" ? e.jobs.map((j) => j.id) : [e.job.id]));
    expect(seen.sort()).toEqual(["a", "b", "c", "d"]);
  });

  test("an empty or missing list is an empty list, not a crash", () => {
    expect(groupExclusiveOffers([])).toEqual([]);
    expect(groupExclusiveOffers(null)).toEqual([]);
    expect(groupExclusiveOffers(undefined)).toEqual([]);
  });
});

describe("the weekday on the card", () => {
  test("names the day in the care timezone", () => {
    expect(getWeekdayName("2026-09-15", "America/New_York")).toBe("Tuesday");
    expect(getWeekdayName("2026-09-16", "America/New_York")).toBe("Wednesday");
  });

  test("a bare date does not slip a day west of Greenwich", () => {
    // `new Date("2026-09-15").getDay()` is UTC midnight, which is Sep 14 in every US zone.
    // That would print "Every Monday" on a Tuesday series. Anchoring at noon avoids it.
    for (const tz of ["America/New_York", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"]) {
      expect(getWeekdayName("2026-09-15", tz)).toBe("Tuesday");
    }
  });

  test("an ISO timestamp is accepted, not just a bare date", () => {
    expect(getWeekdayName("2026-09-15T14:00:00Z", "America/New_York")).toBe("Tuesday");
  });

  test("junk gives an empty string rather than 'Invalid Date'", () => {
    for (const bad of ["", null, undefined, "not-a-date", "2026-99-99"]) {
      expect(typeof getWeekdayName(bad, "America/New_York")).toBe("string");
    }
    expect(getWeekdayName("", "America/New_York")).toBe("");
    expect(getWeekdayName("not-a-date", "America/New_York")).toBe("");
  });
});

describe("wired into the hub", () => {
  const hub = code("public/js/components/CaretakerHub.js");

  test("the offers block groups before it renders", () => {
    // v1.106.34 — grouped, then sliced to two with the rest behind a summary line. See
    // tests/offerPileup.test.js for the collapse itself.
    expect(hub).toContain("groupExclusiveOffers(exclusiveOffers)");
    expect(hub).toContain("shownEntries.map(entry =>");
  });

  test("a series renders the series card, a single still renders the old one", () => {
    expect(hub).toContain("<ExclusiveSeriesCard");
    expect(hub).toContain("const job = entry.job;");
  });

  test("accepting a series is ONE request, not a loop of claims", () => {
    // The loop version leaves her half-booked when call seven fails, and the family believes
    // the month is covered. The server route is atomic; the client must actually use it.
    // v1.106.34 — claim-batch rather than the group route: a shape-grouped card (Pete's
    // twenty one-off days) has no recurrence_group_id to claim by.
    expect(hub).toContain("apiFetch('/api/sessions/claim-batch'");
    // And the per-visit endpoint is still called exactly once in the file — by the
    // single-job path. A second occurrence would mean somebody added a loop.
    const perVisit = (hub.match(/\/api\/sessions\/\$\{jobId\}\/claim/g) || []).length;
    expect(perVisit).toBe(1);
  });

  test("every date is ticked to start — 'yes, all of them' is one tap", () => {
    expect(hub).toContain("useState(() => new Set(jobs.map((j) => j.id)))");
  });
});
