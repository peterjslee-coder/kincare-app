// v1.108.1 — the tip total the family is shown is the total the server charges.
const fs = require("fs");
const path = require("path");
const { tipWithCardFee } = require("../src/utils/pricing");

const src = fs.readFileSync(path.join(__dirname, "..", "public", "js", "components", "Dashboard.js"), "utf8");
const fnSrc = src.slice(src.indexOf("const tipCardTotal = "), src.indexOf("const Dashboard = "));
const tipCardTotal = new Function(`${fnSrc}; return tipCardTotal;`)();

test("client and server agree on every tip from $1 to $500", () => {
  for (let c = 100; c <= 50000; c += 37) expect(tipCardTotal(c)).toEqual(tipWithCardFee(c));
  expect(tipCardTotal(0)).toEqual(tipWithCardFee(0));
});

test("after Stripe's 2.9% + 30¢, the platform keeps nothing and the caregiver keeps the tip", () => {
  for (const c of [100, 1999, 3520, 50000]) {
    const q = tipWithCardFee(c);
    const stripeFee = Math.round(q.totalCents * 0.029) + 30;
    expect(q.totalCents - q.tipCents).toBeGreaterThanOrEqual(stripeFee - 1);
    expect(q.feeCents - stripeFee).toBeLessThanOrEqual(1);
  }
});

test("the paid-visit card offers a tip only until the review", () => {
  expect(src).toMatch(/hasCost && isPaid && !alreadyReviewed && \(\(\) => \{/);
  expect(src).toMatch(/apiFetch\(`\/api\/sessions\/\$\{pr\.id\}\/tip`/);
});
