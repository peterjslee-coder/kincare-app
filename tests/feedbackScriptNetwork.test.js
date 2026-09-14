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
  test("is pinned to one family", () => {
    expect(src).toContain("family: IP_FAMILY");
  });

  test("Happy Eyeballs is explicitly off", () => {
    // `family` alone is not enough on Node 20+: autoSelectFamily defaults on and will still
    // race both records unless it is disabled.
    expect(src).toContain("autoSelectFamily: false");
  });

  test("defaults to IPv4 but can be overridden", () => {
    expect(src).toContain('Number(process.env.INPLACE_IP_FAMILY || 4)');
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
