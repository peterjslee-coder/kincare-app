// The frame contract, pinned. (v1.105.124)
//
// On 2026-08-22 Julia checked in at 12:56:24Z for a 09:00 America/New_York session —
// four minutes EARLY — and was recorded as 236 minutes LATE. 236 is 240 minus 4: the
// entire EDT offset, minus her four minutes.
//
// ⚠️ WHY THIS FILE FORKS A SUBPROCESS.
// `buildDateTimeInZone` builds its result with `setHours`, which interprets in the
// PROCESS's local timezone. On a laptop set to America/New_York it happens to return
// the true instant and the bug is invisible; on Railway, which runs UTC, it returns a
// shifted Date. Setting `process.env.TZ` inside a Jest file is too late — the runtime
// has already resolved the zone — so the TZ-sensitive proof runs in a forked node with
// TZ pinned. Everything else here is written to hold in ANY zone.
//
// The rule this pins: a value that will be STORED, compared against a real instant, or
// exported must come from `zonedDateTimeToInstant`. `buildDateTimeInZone` may only be
// compared against `getNowInZone`, which is shifted the same way.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const {
  buildDateTimeInZone,
  zonedDateTimeToInstant,
  getNowInZone,
} = require("../src/utils/timezone");

const ROOT = path.join(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

const DATE = "2026-08-22";
const TIME = "09:00";
const TZ = "America/New_York"; // EDT, UTC-4 on that date
const CHECK_IN = new Date("2026-08-22T12:56:24.978Z"); // 08:56:24 EDT — 4 min early

const lateMinutes = (checkInMoment, scheduledStart) =>
  Math.floor((checkInMoment - scheduledStart) / 60000);

// Run a snippet in a node with TZ forced, so the assertion means the same thing on
// Pete's Mac (America/New_York) and on Railway/CI (UTC).
function inZone(tz, expr) {
  const code = `const t=require(${JSON.stringify(path.join(ROOT, "src/utils/timezone.js"))});console.log(String(${expr}));`;
  return execFileSync(process.execPath, ["-e", code], {
    env: { ...process.env, TZ: tz },
    encoding: "utf8",
  }).trim();
}

describe("the two builders return different things, and that is the point", () => {
  test("zonedDateTimeToInstant returns the TRUE instant, in every zone", () => {
    // No setHours, so this one does not care what the server clock is set to.
    expect(zonedDateTimeToInstant(DATE, TIME, TZ).toISOString()).toBe("2026-08-22T13:00:00.000Z");
    for (const serverTz of ["UTC", "America/New_York", "Asia/Tokyo"]) {
      expect(inZone(serverTz, `t.zonedDateTimeToInstant("${DATE}","${TIME}","${TZ}").toISOString()`))
        .toBe("2026-08-22T13:00:00.000Z");
    }
  });

  test("buildDateTimeInZone returns a SHIFTED frame whose value depends on the server clock", () => {
    // Not a bug — a different tool. But it means its output is only comparable to
    // another value shifted the same way.
    expect(inZone("UTC", `t.buildDateTimeInZone("${DATE}","${TIME}","${TZ}").toISOString()`))
      .toBe("2026-08-22T09:00:00.000Z");
    expect(inZone("America/New_York", `t.buildDateTimeInZone("${DATE}","${TIME}","${TZ}").toISOString()`))
      .toBe("2026-08-22T13:00:00.000Z");
  });

  test("buildDateTimeInZone and getNowInZone are shifted alike, so the PAIR is safe", () => {
    // Compared in whole minutes: getNowInZone truncates to the second, so the raw
    // millisecond difference carries sub-second noise that means nothing.
    const shiftMin = Math.round((getNowInZone(TZ).getTime() - Date.now()) / 60000);
    const built = buildDateTimeInZone(DATE, TIME, TZ).getTime();
    const trueInstant = zonedDateTimeToInstant(DATE, TIME, TZ).getTime();
    // toBeCloseTo, not toBe: Math.round can hand back -0, and Object.is(-0, 0) is false.
    expect(Math.round((built - trueInstant) / 60000)).toBeCloseTo(shiftMin, 5);
  });
});

describe("late detection now compares instant to instant", () => {
  test("an offline check-in 4 minutes early reads as 4 minutes early", () => {
    expect(lateMinutes(CHECK_IN, zonedDateTimeToInstant(DATE, TIME, TZ))).toBe(-4);
  });

  test("nobody 4 minutes early is ever flagged late", () => {
    expect(lateMinutes(CHECK_IN, zonedDateTimeToInstant(DATE, TIME, TZ)) >= 10).toBe(false);
  });

  test("a genuinely late check-in is still caught", () => {
    expect(lateMinutes(new Date("2026-08-22T13:25:00.000Z"), zonedDateTimeToInstant(DATE, TIME, TZ))).toBe(25);
  });

  test("the fix is not America/New_York-specific", () => {
    const phoenixStart = zonedDateTimeToInstant(DATE, TIME, "America/Phoenix"); // UTC-7, no DST
    expect(phoenixStart.toISOString()).toBe("2026-08-22T16:00:00.000Z");
    expect(lateMinutes(new Date("2026-08-22T15:56:00.000Z"), phoenixStart)).toBe(-4);
  });

  test("the OLD pairing reproduces Julia's 236 on a UTC server — the regression witness", () => {
    const built = inZone("UTC", `t.buildDateTimeInZone("${DATE}","${TIME}","${TZ}").getTime()`);
    expect(lateMinutes(CHECK_IN, new Date(Number(built)))).toBe(236);
  });

  test("...and reads correctly on a New York server, which is how it hid for months", () => {
    const built = inZone("America/New_York", `t.buildDateTimeInZone("${DATE}","${TIME}","${TZ}").getTime()`);
    expect(lateMinutes(CHECK_IN, new Date(Number(built)))).toBe(-4);
  });
});

describe("neither call site mixes frames any more", () => {
  test("the check-in route builds its scheduled start as an instant", () => {
    const src = read("src", "routes", "sessions.js");
    const i = src.indexOf("Detect late check-in");
    expect(i).toBeGreaterThan(-1);
    const block = src.slice(i, i + 2600);
    expect(block).toMatch(/const scheduledStart = zonedDateTimeToInstant\(/);
    expect(block).not.toMatch(/const scheduledStart = buildDateTimeInZone\(/);
    // the live branch must move to a real instant too, or the pair breaks the other way
    expect(block).toMatch(/isOfflineSync \? effectiveCheckInTime : new Date\(\)/);
  });

  test("the late-check-in poller does too — it was the second site", () => {
    const src = read("src", "routes", "accountability.js");
    const i = src.indexOf("const checkInTime = new Date(s.check_in_time)");
    expect(i).toBeGreaterThan(-1);
    const block = src.slice(i - 900, i + 300);
    expect(block).toMatch(/const scheduledStart = zonedDateTimeToInstant\(/);
    expect(block).not.toMatch(/const scheduledStart = buildDateTimeInZone\(/);
  });

  test("no OTHER caller subtracts a stored timestamp from a shifted build", () => {
    // Cheap standing sweep: anywhere `buildDateTimeInZone` result is differenced
    // against `new Date(` of a DB column, the frames are mixed again.
    for (const f of ["src/routes/sessions.js", "src/routes/accountability.js", "src/server.js"]) {
      const src = read(f);
      const re = /const\s+(\w+)\s*=\s*buildDateTimeInZone\([^)]*\);?\s*\n\s*const\s+\w+\s*=\s*new Date\(\w+\.\w+\)/g;
      expect(re.test(src)).toBe(false);
    }
  });
});
