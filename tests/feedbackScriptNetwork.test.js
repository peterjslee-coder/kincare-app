/**
 * v1.106.35 — the feedback pull must leave by the same door every time.
 *
 * Pete's pull failed twice in one day with IP_VERIFICATION_REQUIRED from two DIFFERENT
 * addresses — 2606:a800:9d80:… in the morning, 204.111.165.7 in the evening — from the same
 * machine at the same desk. v1.106.21 fixed the first: macOS rotates the low 64 bits of an
 * IPv6 address daily, so trust is keyed on the /64.
 *
 * This is the other half, and it is the script's fault. Node 18+ dials dual-stack hosts with
 * Happy Eyeballs: it races A and AAAA and keeps whichever answers first, so the same command
 * presents an IPv6 address on one run and an IPv4 one on the next. Verifying either does
 * nothing for the other, and no number of passkey prompts ends it.
 */
const { code } = require("./helpers/source");

const src = code("scripts/collect-feedback.js");

describe("the address the script presents", () => {
  test("Happy Eyeballs is explicitly off", () => {
    // `family` alone is not enough on Node 20+: autoSelectFamily defaults on and will still
    // race both records unless it is disabled. That race is the entire bug.
    expect(src).toContain("autoSelectFamily: false");
  });

  test("IPv6 is tried FIRST — it is the family the browser uses", () => {
    // v1.106.36. v1.106.35 pinned to IPv4 on the reasoning that a residential IPv4 is
    // stable. Wrong half of the problem: only a BROWSER can verify an address via passkey,
    // so the script must present the family the browser does. Pete's trusted list is three
    // rows and every one is IPv6 — there is no IPv4 row and there never would have been,
    // because the browser that would create one does not use IPv4.
    expect(src).toContain("const FAMILY_ORDER = IP_FAMILY ? [IP_FAMILY] : [6, 4];");
  });

  test("the families are tried in ORDER, never raced", () => {
    // A fallback is fine; a race is not. Racing is what made the address unpredictable.
    expect(src).toContain("for (const family of FAMILY_ORDER)");
    expect(src).not.toMatch(/Promise\.(race|any)\(/);
  });

  test("it only falls back when the family genuinely cannot connect", () => {
    // A 403 from the admin gate must NOT trigger a retry on the other family — that would
    // present two addresses for one command and put the flip straight back.
    expect(src).toContain("if (!isUnreachable(err)) throw err;");
    expect(src).toContain('"ENETUNREACH", "EHOSTUNREACH"');
  });

  test("the family can still be forced", () => {
    expect(src).toContain("process.env.INPLACE_IP_FAMILY");
  });

  test("every request goes through the one helper that sets it", () => {
    // A second raw https.request would leave by the unpinned door and reintroduce the flip.
    // It dials through `mod.request` — https or http chosen by the URL — so that is the
    // one call site, and there must be exactly one of it.
    const rawCalls = (src.match(/\b(?:https|http|mod)\.request\(/g) || []).length;
    expect(rawCalls).toBe(1);
  });
});

describe("when the gate refuses", () => {
  test("it names both families, since either could be the one that needs verifying", () => {
    expect(src).toContain("tries IPv6 first and only");
    expect(src).toContain("INPLACE_IP_FAMILY=6 (or 4)");
  });

  test("it says what to do, not just what happened", () => {
    expect(src).toContain("This network hasn't been verified for admin access yet");
    expect(src).toContain("go to the Admin panel — it will prompt for your passkey");
  });

  test("it prints the address the server actually saw", () => {
    expect(src).toContain("Address seen by the server");
  });

  test("every failure path explains it — a silent one sends him back to square one", () => {
    const failures = (src.match(/Triage fetch failed/g) || []).length;
    const explained = (src.match(/explainIpGate\(/g) || []).length;
    // One definition plus one call per failure site.
    expect(explained).toBe(failures + 1);
  });
});
