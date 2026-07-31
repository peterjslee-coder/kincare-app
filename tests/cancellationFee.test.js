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
  test("defaults to the rate written into the agreements", async () => {
    // v1.105.15 defaulted to 0 because the clause charged "the then-current rate posted on
    // IPC's platform" and no rate had ever been posted — the charge referenced a number
    // that did not exist. v1.105.17 amended both agreements to state 100% outright, so the
    // default states it too. If this ever drops below 100, check the partial-capture
    // warning in cancellationFee.js first: the application fee is not prorated.
    expect(DEFAULT_FEE_PERCENT).toBe(100);
    expect(await getCancellationFeePercent(settingsDb(undefined))).toBe(100);
  });

  test("the agreements and the code state the SAME number", async () => {
    // The whole point of this release. If someone edits one and not the other, the app
    // charges an amount the signed document does not authorise.
    const fs = require("fs");
    const path = require("path");
    for (const doc of [
      "public/legal/source/IPC_Client_Services_Agreement_AMENDED.md",
      "public/legal/source/IPC_Caregiver_Agreement_AMENDED.md",
      "public/legal/terms.html",
      "public/legal/terms-merged.html",
    ]) {
      const text = fs.readFileSync(path.join(__dirname, "..", doc), "utf8");
      expect(text).toMatch(/one hundred percent \(100%\)/);
      // The superseded caps must be gone, not merely outnumbered.
      expect(text).not.toMatch(/fifty percent \(50%\)/);
    }
  });

  test("no document still defers to an unposted rate", async () => {
    const fs = require("fs");
    const path = require("path");
    for (const doc of [
      "public/legal/source/IPC_Client_Services_Agreement_AMENDED.md",
      "public/legal/source/IPC_Caregiver_Agreement_AMENDED.md",
    ]) {
      const text = fs.readFileSync(path.join(__dirname, "..", doc), "utf8");
      expect(text).not.toMatch(/cancellation fee at the then-current rate posted/);
    }
  });

  test("both agreements say SHALL, not may — they used to disagree", async () => {
    // The Client Agreement said "shall be charged" and the Caregiver Agreement said "may be
    // charged" for the same event. Two signed documents describing one transaction
    // differently is the kind of gap that gets read against the drafter.
    const fs = require("fs");
    const path = require("path");
    const cg = fs.readFileSync(path.join(__dirname, "..", "public/legal/source/IPC_Caregiver_Agreement_AMENDED.md"), "utf8");
    expect(cg).toMatch(/the Client shall be charged a cancellation fee/);
    expect(cg).not.toMatch(/the Client may be charged a cancellation fee/);
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

  test("garbage and negatives fall back to the agreement rate, not to an arbitrary number", async () => {
    for (const bad of ["", "abc", -20, null]) {
      expect(await getCancellationFeePercent(settingsDb(bad))).toBe(100);
    }
  });

  test("a settings failure falls back to the agreement rate", async () => {
    expect(await getCancellationFeePercent(settingsDb(100, { fail: true }))).toBe(100);
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

  test("client cancels late with no override posted → charges the agreement rate", async () => {
    const d = await decideCancellationCharge(settingsDb(undefined), {
      cancelledBy: "family", isLateCancel: true, ...HOLD,
    });
    expect(d.action).toBe("capture");
    expect(d.amountCents).toBe(10000);
  });

  test("an admin can still post 0 to switch late-cancel charging off", async () => {
    // Kept as an explicit escape hatch: turning the charge off must not require a deploy.
    const d = await decideCancellationCharge(settingsDb(0), {
      cancelledBy: "family", isLateCancel: true, ...HOLD,
    });
    expect(d.action).toBe("void");
    expect(d.reason).toBe("rate_set_to_zero");
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

// ─── the preview must not be a second implementation ───
const fs = require("fs");
const path = require("path");
const rd = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

describe("cancel preview", () => {
  const sessions = rd("src/routes/sessions.js");

  test("the preview endpoint exists", () => {
    expect(sessions).toMatch(/router\.get\("\/:id\/cancel-preview"/);
  });

  test("the preview uses the SAME decision function as the charge", () => {
    // A preview that computes the number a second way will eventually disagree with the
    // charge, and the failure mode is quoting someone $0 and taking $120. Both call sites
    // must route through decideCancellationCharge.
    expect((sessions.match(/decideCancellationCharge\(/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  // Slice to the NEXT route, not to the cancel handler: v1.105.19 inserted the cancel-fee
  // waive/dispute routes between them, and those legitimately call voidSessionPayment.
  const previewOnly = (() => {
    const start = sessions.indexOf('router.get("/:id/cancel-preview"');
    const next = sessions.indexOf("\nrouter.", start + 10);
    return sessions.slice(start, next === -1 ? sessions.length : next);
  })();

  test("the preview never mutates anything", () => {
    const preview = previewOnly;
    for (const forbidden of ["captureSessionPayment", "voidSessionPayment", "UPDATE care_sessions"]) {
      expect(preview).not.toContain(forbidden);
    }
  });

  test("only the two parties to the session can preview it", () => {
    expect(previewOnly).toMatch(/Not your session/);
  });
});

describe("the client tells the user before charging them", () => {
  test("Dashboard no longer hardcodes the charge claim", () => {
    // It used to say "You will still be charged for this session" — wrong twice: the
    // contract charges a posted FEE, not the session price, and nothing was ever taken.
    const dash = rd("public/js/components/Dashboard.js");
    expect(dash).not.toMatch(/You will still be charged for this session/);
    expect(dash).toMatch(/cancel-preview/);
  });

  test("the session detail modal previews before confirming", () => {
    expect(rd("public/js/components/VisitDetailModal.js")).toMatch(/cancel-preview/);
  });
});
