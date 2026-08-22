// Twenty-eight notifications for one ninety-minute visit. (v1.105.126)
//
// Aug 22, Julia's first real paid session. Pete's phone, one visit:
//   13:55–13:59  check_out_imminent        × 5   (one per minute)
//   14:15–14:37  overdue_check_out_family  × 23  (one per minute)
//   14:38        session_complete          × 1   — the one he says he never got
//
// He did get it. It arrived at the end of that stream carrying the same notification tag
// as the twenty-three before it, so on his lock screen it replaced the last "Session
// Running Over" and looked like more of the same.
//
// Root cause: `care_sessions.notifications_sent` had three writers and two formats.
// sendSessionReminders wrote a JSON array and read it back with JSON.parse; sendArrivalSms
// joined with spaces; accountability.js joined with commas. The parse threw on any row
// another writer had touched, the throw was swallowed by the function's outer catch — after
// the pushes went out, before they were recorded — and the next poll sent them all again.
//
// These tests are written against the real strings the other two writers produce.

const { parseSent, hasSent, appendSent } = require("../src/utils/notificationsSent");

describe("reading a column three writers disagree about", () => {
  test("a JSON array, which is what sendSessionReminders wrote", () => {
    expect(parseSent('["pre_check_in","overdue_check_in"]')).toEqual(["pre_check_in", "overdue_check_in"]);
  });

  test("space-joined, which is what sendArrivalSms wrote", () => {
    // ` ` || 'arrival_sms_120' — note the leading space on an empty column.
    expect(parseSent(" arrival_sms_120 arrival_sms_60 arrival_sms_30"))
      .toEqual(["arrival_sms_120", "arrival_sms_60", "arrival_sms_30"]);
  });

  test("comma-joined, which is what accountability.js wrote", () => {
    expect(parseSent(",checkin_nudge,no_show_flagged")).toEqual(["checkin_nudge", "no_show_flagged"]);
  });

  test("the mixture that actually happens when two writers touch one row", () => {
    expect(parseSent('["pre_check_in"],checkin_nudge arrival_sms_60'))
      .toEqual(["pre_check_in", "checkin_nudge", "arrival_sms_60"]);
  });

  test("empty and absent both mean nothing has been sent", () => {
    for (const empty of [null, undefined, "", "   "]) expect(parseSent(empty)).toEqual([]);
  });

  test("it NEVER throws — that throw is the whole bug", () => {
    // The old code did `JSON.parse(raw)` here and died. Anything unreadable must degrade
    // to "nothing recorded", never to an exception that skips the write below it.
    for (const junk of ['{"not":"an array"}', "[unclosed", "💥", 42, {}, []]) {
      expect(() => parseSent(junk)).not.toThrow();
      expect(Array.isArray(parseSent(junk))).toBe(true);
    }
  });
});

describe("recording that a reminder was sent", () => {
  test("appending to a poisoned column works — the 23-times case", () => {
    // This is the exact state that produced the flood: a space-joined value that
    // JSON.parse could not read.
    const poisoned = " arrival_sms_120 arrival_sms_60";
    expect(hasSent(poisoned, "overdue_check_out")).toBe(false);
    const after = appendSent(poisoned, "overdue_check_out");
    expect(hasSent(after, "overdue_check_out")).toBe(true);
  });

  test("appending is idempotent, so a retry cannot grow the column", () => {
    let v = appendSent(null, "pre_check_in");
    for (let i = 0; i < 25; i++) v = appendSent(v, "pre_check_in");
    expect(parseSent(v)).toEqual(["pre_check_in"]);
  });

  test("the canonical write is comma-joined, which the SQL guards still match", () => {
    const v = appendSent(appendSent(null, "pre_check_in"), "overdue_check_out");
    expect(v).toBe("pre_check_in,overdue_check_out");
    // Every poller gate is `notifications_sent NOT LIKE '%token%'`. Simulate it.
    expect(v.includes("overdue_check_out")).toBe(true);
    expect(v.includes("pre_check_out")).toBe(false);
  });

  test("admin's no-show clear still works on the canonical form", () => {
    // admin/sessionOps.js does REPLACE(notifications_sent, ',no_show_flagged', '')
    const v = appendSent(appendSent(null, "pre_check_in"), "no_show_flagged");
    expect(v.replace(",no_show_flagged", "")).toBe("pre_check_in");
  });

  test("earlier tokens survive — we do not silently drop another writer's work", () => {
    const after = appendSent(",checkin_nudge", "overdue_check_out");
    expect(hasSent(after, "checkin_nudge")).toBe(true);
  });
});

describe("the call sites that broke it no longer disagree", () => {
  const fs = require("fs");
  const path = require("path");
  const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

  test("nothing JSON.parses this column any more", () => {
    expect(read("src", "routes", "push.js")).not.toMatch(/JSON\.parse\(\s*session\.notifications_sent/);
  });

  test("sendArrivalSms no longer joins with a space", () => {
    expect(read("src", "routes", "push.js"))
      .not.toMatch(/notifications_sent\s*=\s*COALESCE\(notifications_sent,\s*''\)\s*\|\|\s*' '/);
  });

  test("the dedupe write sits outside the send's try block", () => {
    // If it is inside, a failed push means an unrecorded reminder means a repeat.
    const src = read("src", "routes", "push.js");
    const marker = src.indexOf("Mark this reminder as sent");
    expect(marker).toBeGreaterThan(-1);
    const catchBefore = src.lastIndexOf("} catch (err) {", marker);
    expect(catchBefore).toBeGreaterThan(-1);
    expect(catchBefore).toBeLessThan(marker);
  });
});
