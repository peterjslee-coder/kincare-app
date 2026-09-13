/**
 * "A shift is not funded" — the bug, and the three ways it was reported badly. (v1.106.11)
 *
 * Pete, Sept 13: fourteen identical pushes in thirteen minutes, each ending mid-word in
 * Stripe's developer prose, and tapping one opened a screen offering "change time" and
 * "cancel" — never "add a card". The underlying failure was real; everything about telling
 * him was wrong.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "unfunded-test-secret";

const { code } = require("./helpers/source");

describe("the actual bug: a PaymentIntent with no payment method", () => {
  const a = code("src/routes/accountability.js");

  test("the authorization names a payment method", () => {
    // `payment_method: undefined, // will use customer's default` — Stripe does not do that.
    // With confirm:true + off_session:true it answers "You cannot confirm this PaymentIntent
    // because it's missing a payment method", which is exactly what Pete's phone showed.
    expect(a).not.toMatch(/payment_method: undefined/);
    expect(a).toMatch(/const pm = await resolvePaymentMethod\(stripe, payerCustomerId\)/);
    expect(a).toMatch(/payment_method: pm\.id/);
    expect(a).toMatch(/payment_method_types: \[pm\.type\]/);
  });

  test("no saved method is its own outcome, not a Stripe error", () => {
    expect(a).toMatch(/if \(!pm\) return \{ error: "no_payment_method"/);
    expect(a).toMatch(/payerUserId: session\.billing_user_id \|\| session\.family_user_id/);
  });

  test("the payer lookup cannot pick an arbitrary care team", () => {
    // No filter and no LIMIT on a join, then .get() — the same shape that put personal DMs in
    // the InPlace Support thread. payments.js always filtered; this side never did.
    expect(a).toMatch(/LEFT JOIN care_teams ct ON ct\.care_recipient_id = cs\.care_recipient_id AND ct\.billing_user_id IS NOT NULL/);
  });
});

describe("one resolver, so the money paths cannot disagree again", () => {
  const { ACCEPTED_TYPES, describePaymentMethod } = require("../src/utils/paymentMethod");

  test("it accepts everything the BOOKING gate accepts", () => {
    // Accepting a payment method at booking that we cannot charge afterwards is the funnel
    // taking a customer it will later fail. Link was accepted at booking and invisible to
    // both the hold and the charge.
    expect(new Set(ACCEPTED_TYPES)).toEqual(new Set(["us_bank_account", "card", "link"]));
  });

  test("ACH first — it is $1.79 on a $224 shift instead of $6.80", () => {
    expect(ACCEPTED_TYPES[0]).toBe("us_bank_account");
  });

  test("an unsupported type means keep looking, never 'they have nothing'", async () => {
    const { resolvePaymentMethod } = require("../src/utils/paymentMethod");
    const stripe = { paymentMethods: { list: async ({ type }) => {
      if (type === "us_bank_account") throw new Error("type not supported on this API version");
      if (type === "card") return { data: [{ id: "pm_1", type: "card", card: { last4: "4242", brand: "visa" } }] };
      return { data: [] };
    } } };
    const pm = await resolvePaymentMethod(stripe, "cus_x");
    expect(pm).toMatchObject({ id: "pm_1", type: "card", last4: "4242", brand: "visa" });
  });

  test("it finds a Link wallet, which every previous copy missed", async () => {
    const { resolvePaymentMethod } = require("../src/utils/paymentMethod");
    const stripe = { paymentMethods: { list: async ({ type }) =>
      type === "link" ? { data: [{ id: "pm_link", type: "link", link: {} }] } : { data: [] } } };
    expect(await resolvePaymentMethod(stripe, "cus_x")).toMatchObject({ id: "pm_link", type: "link" });
  });

  test("genuinely nothing saved returns null", async () => {
    const { resolvePaymentMethod } = require("../src/utils/paymentMethod");
    const stripe = { paymentMethods: { list: async () => ({ data: [] }) } };
    expect(await resolvePaymentMethod(stripe, "cus_x")).toBeNull();
    expect(await resolvePaymentMethod(stripe, null)).toBeNull();
  });

  test("it carries what the receipt needs — a Link payment used to write a blank brand", async () => {
    const { resolvePaymentMethod } = require("../src/utils/paymentMethod");
    const stripe = { paymentMethods: { list: async ({ type }) =>
      type === "us_bank_account" ? { data: [{ id: "pm_b", type: "us_bank_account", us_bank_account: { last4: "6789", bank_name: "Chase" } }] } : { data: [] } } };
    const pm = await resolvePaymentMethod(stripe, "cus_x");
    expect(pm.brand).toBe("Chase");
    expect(pm.last4).toBe("6789");
    expect(describePaymentMethod(pm)).toBe("ACH bank ending 6789");
  });

  test("all four money paths use it — the booking gate, the hold, the charge, the receipt", () => {
    expect(code("src/routes/sessions.js")).toMatch(/await resolvePaymentMethod\(stripe, payerCustomerId\)/);
    expect(code("src/routes/accountability.js")).toMatch(/await resolvePaymentMethod\(stripe, payerCustomerId\)/);
    const pay = code("src/routes/payments.js");
    expect(pay).toMatch(/const chosenPM = await resolvePaymentMethod\(stripe, customerId\)/);
    expect(pay).toMatch(/const pmBrand = chosenPM\.brand/);
    // and nobody hand-rolls the list any more
    expect(pay).not.toMatch(/type: "us_bank_account", limit: 1 \}\);\s*\n\s*if \(!paymentMethods/);
    expect(code("src/routes/sessions.js")).not.toMatch(/for \(const pmType of \["card", "link", "us_bank_account"\]\)/);
  });
});

describe("an idempotency key must change when the request changes", () => {
  const a = code("src/routes/accountability.js");

  test("the hold key includes the payment method", () => {
    // Without this, fixing the payment_method bug could not fund the shift: the broken
    // attempts had burned `inplace_authhold_<session>_<amount>`, Stripe remembers keys for 24
    // hours, and every corrected retry came back "Keys for idempotent requests can only be
    // used with the same parameters they were first used with."
    expect(a).toMatch(/idempotencyKey: `inplace_authhold_\$\{sessionId\}_\$\{totalCents\}_\$\{pm\.id\}`/);
  });

  test("it still keys on session AND amount, so a duplicate hold is still impossible", () => {
    expect(a).toMatch(/inplace_authhold_\$\{sessionId\}_\$\{totalCents\}_/);
  });

  test("auto-pay's key is deliberately NOT changed", () => {
    // That key guards a CHARGE, not a hold. Making it vary by payment method would let the
    // same session be charged twice if a family swapped cards mid-flight — a worse outcome
    // than the stuck-key problem it would solve, and auto-pay has always sent a payment
    // method, so its parameters were never unstable in the first place.
    expect(code("src/routes/payments.js")).toMatch(/idempotencyKey: `inplace_autopay_\$\{s\.id\}_\$\{totalCents\}`/);
  });
});

describe("telling the right person, once, in words", () => {
  const a = code("src/routes/accountability.js");

  test("the warning fires ONCE per session, not every minute for 25 hours", () => {
    expect(a).toMatch(/const warnedAlready = \(s\.notifications_sent \|\| ""\)\.includes\("unfunded_warned"\)/);
    expect(a).toMatch(/&& !warnedAlready\) \{/);
    expect(a).toMatch(/notifications_sent = COALESCE\(notifications_sent, ''\) \|\| ',unfunded_warned'/);
  });

  test("the payer is told, because they are the only one who can fix it", () => {
    expect(a).toMatch(/title: "Add a payment method"/);
    expect(a).toMatch(/sendPushToUser\(payerId/);
  });

  test("and the tap lands on the payment screen, not on change-time-or-cancel", () => {
    // app.js: `if (currentPage === 'payments') { window.__accountTab = 'payments'; ... }`
    expect(a).toMatch(/type: "payment_method_needed", sessionId: s\.id, page: "payments"/);
    expect(code("public/js/app.js")).toMatch(/currentPage === 'payments'.*__accountTab = 'payments'/);
  });

  test("no raw Stripe prose reaches a human", () => {
    // Scope to the BODY lines. `${result.error}` inside captureException is correct and wanted;
    // what must never happen is Stripe's prose being rendered on someone's lock screen.
    const notify = a.slice(a.indexOf('const noCard = result.error === "no_payment_method"'), a.indexOf("unfunded-shift notify failed"));
    const bodies = notify.split("\n").filter((l) => /^\s*body:/.test(l));
    expect(bodies.length).toBeGreaterThanOrEqual(3);
    for (const b of bodies) expect(b).not.toMatch(/result\.error/);
    expect(notify).toMatch(/Check Sentry for session/);      // the detail lives where detail belongs
  });

  test("the admin message says who, when, and what is actually wrong", () => {
    expect(a).toMatch(/has no saved payment method\. They've been asked to add one\./);
    expect(a).toMatch(/const when = hoursUntil < 1 \? "in under an hour"/);
  });

  test("the full reason still reaches Sentry, tagged with the session", () => {
    expect(a).toMatch(/captureException\(new Error\(`Payment authorization skipped: \$\{result\.error\}`\)/);
  });
});
