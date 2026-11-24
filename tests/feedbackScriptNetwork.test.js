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

// ─── v1.106.45 — the failure that is not an error ───
//
// Pete, watching the script sit on "Feedback pull (closed loop) from https://yourinplace.com…":
// "unable to pull feedback...appears stuck."
//
// There was no timeout anywhere in the file, so a connection that opened and then said nothing
// waited on the operating system, which is to say forever. And it compounded with v1.106.36
// above: the IPv4 fallback fires on isUnreachable, which is a list of ERROR CODES, and a hang
// produces no error at all. Putting IPv6 first — correctly — made the fallback unreachable on
// any network where IPv6 stalls rather than refuses.
//
// These tests use a real socket that accepts and never answers, because that is the only way
// to tell a bounded wait from an unbounded one.
const net = require("net");
// Bounded low on purpose: the point is that the wait ENDS, not how long the default is, and a
// suite that takes 30 seconds to prove it is a suite people stop running. The default itself is
// asserted separately, from the source.
process.env.INPLACE_TIMEOUT_MS = "1200";
const { request, isUnreachable, ATTEMPT_TIMEOUT_MS } = require("../scripts/collect-feedback");

// Shared with the fallover test below, which needs somewhere that accepts and stays quiet.
let silentServerPort = null;
const silentPort = () => silentServerPort;

describe("a server that never answers", () => {
  let server, port;
  const sockets = new Set();

  beforeAll((done) => {
    // Accepts the connection, reads the request, and replies with nothing. This is the shape
    // the OS will not resolve on its own.
    server = net.createServer((sock) => {
      sockets.add(sock);
      sock.on("close", () => sockets.delete(sock));
      /* deliberately silent */
    });
    server.listen(0, "127.0.0.1", () => { port = server.address().port; silentServerPort = port; done(); });
  });
  afterAll((done) => {
    // close() waits on open connections, and these are open by design.
    for (const s of sockets) s.destroy();
    server.close(done);
  });

  test("the attempt is bounded rather than waiting on the OS", async () => {
    const started = Date.now();
    await expect(
      request(`http://127.0.0.1:${port}/api/admin/feedback/triage`, {}, )
    ).rejects.toMatchObject({ code: "ETIMEDOUT" });
    const took = Date.now() - started;
    // It really waited (rather than failing fast for some unrelated reason) and it really
    // stopped. FAMILY_ORDER is two families, so the bound is two attempts plus slack.
    expect(took).toBeGreaterThanOrEqual(ATTEMPT_TIMEOUT_MS * 0.8);
    expect(took).toBeLessThan(ATTEMPT_TIMEOUT_MS * 4);
  }, 60000);

  test("the timeout says which family and how long, not just 'ETIMEDOUT'", async () => {
    await expect(request(`http://127.0.0.1:${port}/x`)).rejects.toThrow(/no answer over IPv\d+ within \d+s/);
  }, 60000);
});

describe("what counts as 'try the other family'", () => {
  test("a stall does — this is the case that could not fall back", () => {
    expect(isUnreachable({ code: "ETIMEDOUT" })).toBe(true);
  });

  test("so does a refusal — something answered, and it said no", () => {
    expect(isUnreachable({ code: "ECONNREFUSED" })).toBe(true);
  });

  test("the routing errors it always handled still do", () => {
    for (const code of ["ENETUNREACH", "EHOSTUNREACH", "EAI_AGAIN", "ENOTFOUND", "EAFNOSUPPORT"]) {
      expect([code, isUnreachable({ code })]).toEqual([code, true]);
    }
  });

  test("a real failure is NOT swallowed as a family problem", () => {
    // Falling through on these would turn one genuine error into two attempts and a confusing
    // message about address families.
    for (const code of ["ECONNRESET", "EPROTO", "CERT_HAS_EXPIRED", undefined]) {
      expect([String(code), isUnreachable({ code })]).toEqual([String(code), false]);
    }
  });
});

describe("the timeout is configurable and sane", () => {
  test("it defaults to something a person will wait for", () => {
    // Read from the source, because this process overrode it to keep the suite quick.
    const m = src.match(/INPLACE_TIMEOUT_MS \|\| (\d+)\)/);
    expect(m).toBeTruthy();
    expect(Number(m[1])).toBeGreaterThanOrEqual(5000);
    expect(Number(m[1])).toBeLessThanOrEqual(30000);
  });

  test("the request carries it, rather than relying on the socket default", () => {
    expect(src).toMatch(/timeout: ATTEMPT_TIMEOUT_MS/);
    expect(src).toMatch(/req\.on\("timeout"/);
  });

  // Asserted by RUNNING it, not by reading the source. The first cut of this test matched the
  // template literal in the file, so breaking the fallover message left it green.
  test("falling over to the other family is announced", async () => {
    // A script that is quietly failing over looks identical to one that has hung, which is
    // how this run got reported as stuck in the first place.
    const said = [];
    const real = console.error;
    console.error = (...a) => said.push(a.join(" "));
    try {
      // 127.0.0.1 over IPv6 cannot work, so the first family fails and the second is tried.
      await request(`http://127.0.0.1:${silentPort()}/x`).catch(() => {});
    } finally { console.error = real; }
    expect(said.join("\n")).toMatch(/IPv6: .* — trying IPv4/);
  }, 60000);
});
