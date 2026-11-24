// v1.105.66 — the two ways a family could be charged twice, and a forgot-password flow that
// could hang forever.
//
// THE DOUBLE CHARGE
//
// processOverduePayments creates a Stripe PaymentIntent with `confirm: true, off_session: true`
// — the card is charged the moment that call returns. The guard that stops a session being
// charged again is the `payments` row inserted AFTERWARDS. Between those two statements there
// was nothing at all, for however long Stripe took to answer.
//
// That window was reachable, because withPollerLock's deadline used Promise.race — which does
// not cancel the loser. On timeout the function returned, its `finally` released the advisory
// lock, and the abandoned tick kept running. Overlap protection was void in exactly the case it
// existed for. The next run would find the same not-yet-recorded session and charge it again.
//
// Two independent fixes, deliberately both: the lock now outlives the deadline, and every
// PaymentIntent carries an idempotency key. When the failure is taking money from someone
// twice, one guard is not enough.
//
// THE HANG
//
// The Resend SDK has no default timeout, and passwordReset awaited it before responding. A hang
// at Resend hung the request: someone locked out of their account got a spinner that never
// resolved. Worse, awaiting at all leaked account existence through timing — the "no such user"
// branch returns instantly.

const { code } = require("./helpers/source");

const email = code("src/utils/email.js");
const reset = code("src/routes/passwordReset.js");
const payments = code("src/routes/payments.js");
const reimb = code("src/routes/reimbursements.js");
const accountability = code("src/routes/accountability.js");

// ───────────────────────────────────────────────────────────────────────────────
describe("the poller lock outlives its own deadline", () => {
  // The bug was pure control flow — no database needed to reproduce it, and a source
  // assertion would not have caught it. This drives the same shape the fixed function uses.
  test("a tick that overruns keeps the lock until it finishes", async () => {
    // Rather than reach into module internals, drive withPollerLock's logic directly with the
    // same shape it uses. This is the property that matters: on overrun, unlock must NOT happen
    // before the work settles.
    const events = [];
    let releaseWork;
    const work = new Promise((r) => { releaseWork = r; });

    // Mirror of the fixed control flow.
    const POLLER_DEADLINE_MS = 30;
    const run = async () => {
      let settled = false;
      const w = (async () => work)();
      w.then(() => { settled = true; }, () => { settled = true; });
      let timer;
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("exceeded")), POLLER_DEADLINE_MS);
      });
      try {
        await Promise.race([w, deadline]);
        return "completed";
      } catch (err) {
        if (settled) throw err;
        w.catch(() => {}).finally(() => events.push("unlock"));
        return "overran";
      } finally {
        clearTimeout(timer);
      }
    };

    const outcome = await run();
    expect(outcome).toBe("overran");
    // The caller has returned. The lock must still be held.
    expect(events).toEqual([]);

    releaseWork();
    await new Promise((r) => setTimeout(r, 10));
    // Only now, once the abandoned tick actually finished.
    expect(events).toEqual(["unlock"]);
  });

  test("the source no longer releases inside a finally that the deadline can reach", () => {
    const db = code("src/models/database.js");
    expect(db).toMatch(/let releaseDeferred = false;/);
    expect(db).toMatch(/if \(settled\) throw err;/);
    expect(db).toMatch(/releaseDeferred = true;/);
    // The release must be conditional on NOT having deferred it.
    expect(db).toMatch(/if \(!releaseDeferred\) \{/);
  });

  test("an overrun is reported rather than silently swallowed", () => {
    // It used to reject into the caller's catch and vanish. A poller running long is exactly
    // the thing you want to know about before it becomes a double charge.
    const db = code("src/models/database.js");
    expect(db).toMatch(/still running; lock held until it finishes/);
    expect(db).toMatch(/captureException\(err, \{ where: `withPollerLock:\$\{lockKey\}` \}\)/);
  });

  test("a genuine failure inside the work still reaches the caller", () => {
    // The overrun path returns true. A tick that THREW must not be disguised as success.
    const db = code("src/models/database.js");
    const start = db.indexOf("} catch (err) {", db.indexOf("await Promise.race([work, deadline])"));
    expect(start).toBeGreaterThan(-1);
    expect(db.slice(start, start + 120)).toMatch(/if \(settled\) throw err;/);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("no Stripe charge can be created twice", () => {
  const sites = [
    ["auto-pay (charges immediately, from a poller)", payments, /inplace_autopay_\$\{s\.id\}_\$\{totalCents\}/],
    ["background check fee", payments, /inplace_bgcheck_\$\{req\.user\.id\}/],
    ["reimbursement payout", reimb, /inplace_reimb_\$\{ctx\.row\.id\}_\$\{totalCents\}/],
    ["session authorization hold", accountability, /inplace_authhold_\$\{sessionId\}_\$\{totalCents\}/],
  ];

  test("every paymentIntents.create passes an idempotency key", () => {
    for (const [label, src, key] of sites) {
      expect(`${label}: has idempotency key`).toBe(
        key.test(src) ? `${label}: has idempotency key` : `${label}: MISSING`
      );
    }
  });

  test("there are no other PaymentIntent creations without one", () => {
    // A fifth call site added later, without a key, is the whole risk this test exists for.
    const fs = require("fs");
    const path = require("path");
    const dir = path.join(__dirname, "..", "src");
    const walk = (d, acc = []) => {
      for (const e of fs.readdirSync(d)) {
        const p = path.join(d, e);
        if (fs.statSync(p).isDirectory()) walk(p, acc);
        else if (e.endsWith(".js")) acc.push(p);
      }
      return acc;
    };
    const offenders = [];
    for (const f of walk(dir)) {
      const src = fs.readFileSync(f, "utf8");
      let idx = src.indexOf("paymentIntents.create");
      while (idx !== -1) {
        // The options object follows the params object; look ahead far enough to clear it.
        const window = src.slice(idx, idx + 2600);
        if (!window.includes("idempotencyKey")) {
          offenders.push(`${path.relative(dir, f)} @${src.slice(0, idx).split("\n").length}`);
        }
        idx = src.indexOf("paymentIntents.create", idx + 1);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("keys include the amount, so a different charge is a different key", () => {
    // Keyed on the id alone, a legitimate second charge for a corrected amount would be
    // silently swallowed by Stripe and the family would never be billed.
    expect(payments).toMatch(/inplace_autopay_\$\{s\.id\}_\$\{totalCents\}/);
    expect(reimb).toMatch(/inplace_reimb_\$\{ctx\.row\.id\}_\$\{totalCents\}/);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("forgot password answers whether or not the mail server does", () => {
  test("sending an email is bounded", () => {
    expect(email).toMatch(/const SEND_TIMEOUT_MS = \d+;/);
    expect(email).toMatch(/withTimeout\(resend\.emails\.send\(payload\), SEND_TIMEOUT_MS, "Resend"\)/);
  });

  test("the timeout clears its timer rather than leaking one per email", () => {
    expect(email).toMatch(/\.finally\(\(\) => clearTimeout\(timer\)\)/);
  });

  test("the reset route does not wait on delivery", () => {
    // Awaiting is what let a Resend hang hang the request.
    expect(reset).not.toMatch(/await sendEmail\(\{/);
    expect(reset).toMatch(/sendEmail\(\{/);
  });

  test("a failed send is logged, not discarded", () => {
    // sendEmail returns { success: false } rather than throwing — a bare .catch() would miss it
    // entirely, which is how "invite resent" came to lie elsewhere in this codebase.
    expect(reset).toMatch(/if \(!r\?\.success\)/);
    expect(reset).toMatch(/\[password-reset\] email to user/);
  });

  test("both branches still answer identically", () => {
    // The anti-enumeration property. Two identical strings, and now identical timing too.
    const matches = reset.match(/If that email is registered, you'll receive a reset link shortly\./g);
    expect(matches).toHaveLength(2);
  });
});
