// v1.105.15 — the late-cancellation charge decision.
//
// This is the only code in the app that takes money on a cancellation, and it is enforcing
// a signed contract clause, so the tests here are written against the CONTRACT text rather
// than against the implementation. Quoted clauses come from the published Client Services
// Agreement at yourinplace.com/client-services.

const { decideCancellationCharge, getCancellationFeePercent, DEFAULT_FEE_PERCENT } =
  require("../src/utils/cancellationFee");

// db double returning a single platform_settings value (or none).
const settingsDb = (value, { fail } = {}) => ({
  prepare: () => ({
    get: async () => {
      if (fail) throw new Error("simulated failure");
      return value === undefined ? undefined : { value: String(value) };
    },
  }),
});

const HOLD = {
  paymentIntentId: "pi_123",
  paymentStatus: "authorized",
  authorizedAmountCents: 10000, // $100
};

describe("the posted rate", () => {
  test("defaults to ZERO when nothing is posted", async () => {
    // The clause charges "a cancellation fee at the then-current rate posted on IPC's
    // platform". If no rate is posted there is nothing for the clause to point at, so
    // there is no supportable amount to charge — including 100%.
    expect(DEFAULT_FEE_PERCENT).toBe(0);
    expect(await getCancellationFeePercent(settingsDb(undefined))).toBe(0);
  });

  test("reads the posted rate once an admin sets one", async () => {
    expect(await getCancellationFeePercent(settingsDb(100))).toBe(100);
    expect(await getCancellationFeePercent(settingsDb(50))).toBe(50);
  });

  test("caps at 100%", async () => {
    // A fee above the authorized amount cannot be captured from the hold; Stripe rejects
    // it. Capping turns a config typo into a smaller charge, not a failed cancellation.
    expect(await getCancellationFeePercent(settingsDb(150))).toBe(100);
  });

  test("garbage and negatives fall back to no fee, never to a charge", async () => {
    for (const bad of ["", "abc", -20, null]) {
      expect(await getCancellationFeePercent(settingsDb(bad))).toBe(0);
    }
  });

  test("a settings failure means no fee", async () => {
    expect(await getCancellationFeePercent(settingsDb(100, { fail: true }))).toBe(0);
  });
});

describe("what the contract says happens", () => {
  test('caregiver cancels late → "Client shall be entitled to a full refund"', async () => {
    // The asymmetry is the entire point of the clause. Code that treats "late
    // cancellation" as one condition without asking WHO cancelled gets this backwards for
    // the party the clause exists to protect.
    const d = await decideCancellationCharge(settingsDb(100), {
      cancelledBy: "caregiver", isLateCancel: true, ...HOLD,
    });
    expect(d.action).toBe("void");
    expect(d.feePercent).toBe(0);
  });

  test("caregiver cancels early → full refund", async () => {
    const d = await decideCancellationCharge(settingsDb(100), {
      cancelledBy: "caregiver", isLateCancel: false, ...HOLD,
    });
    expect(d.action).toBe("void");
  });

  test('client cancels >24h out → "entitled to a full refund"', async () => {
    const d = await decideCancellationCharge(settingsDb(100), {
      cancelledBy: "family", isLateCancel: false, ...HOLD,
    });
    expect(d.action).toBe("void");
    expect(d.feePercent).toBe(0);
  });

  test("client cancels <24h out with a posted rate → partial capture of the hold", async () => {
    const d = await decideCancellationCharge(settingsDb(100), {
      cancelledBy: "family", isLateCancel: true, ...HOLD,
    });
    expect(d.action).toBe("capture");
    expect(d.amountCents).toBe(10000);
    expect(d.feePercent).toBe(100);
  });

  test("a posted rate below 100% captures only that share", async () => {
    const d = await decideCancellationCharge(settingsDb(50), {
      cancelledBy: "family", isLateCancel: true, ...HOLD,
    });
    expect(d.action).toBe("capture");
    expect(d.amountCents).toBe(5000);
  });

  test("client cancels late but NO rate is posted → release, do not charge", async () => {
    // The single most important case. The intended business policy is to charge; the
    // contract only permits charging a posted rate. Until one is posted, releasing is the
    // behaviour that matches what the client actually signed.
    const d = await decideCancellationCharge(settingsDb(undefined), {
      cancelledBy: "family", isLateCancel: true, ...HOLD,
    });
    expect(d.action).toBe("void");
    expect(d.reason).toBe("no_posted_rate");
  });
});

describe("when there is no hold at all", () => {
  test("a session cancelled more than ~25h out has nothing to settle", async () => {
    // The authorization is only placed 23-25h before the visit, so this is the common case.
    const d = await decideCancellationCharge(settingsDb(100), {
      cancelledBy: "family", isLateCancel: false,
      paymentIntentId: null, paymentStatus: null, authorizedAmountCents: null,
    });
    expect(d.action).toBe("none");
  });

  test("an already-captured or voided payment is never touched twice", async () => {
    for (const status of ["paid", "voided", "failed"]) {
      const d = await decideCancellationCharge(settingsDb(100), {
        cancelledBy: "family", isLateCancel: true,
        paymentIntentId: "pi_1", paymentStatus: status, authorizedAmountCents: 10000,
      });
      expect(d.action).toBe("none");
    }
  });

  test("a fee that rounds to zero releases instead of attempting a $0 capture", async () => {
    // Stripe rejects a zero-amount capture, which would surface as a failed settlement on
    // an otherwise fine cancellation.
    const d = await decideCancellationCharge(settingsDb(100), {
      cancelledBy: "family", isLateCancel: true,
      paymentIntentId: "pi_1", paymentStatus: "authorized", authorizedAmountCents: 0,
    });
    expect(d.action).toBe("void");
  });
});
