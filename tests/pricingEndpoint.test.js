/**
 * v1.106.19 — GET /api/pricing, including the path that only runs when the database is down.
 *
 * The splash page reads this to render "a flat N% for everyone" to logged-out visitors. If the
 * handler's catch block ever returns something other than the published default, a database
 * blip turns the marketing page into a false claim about what the platform charges — and it is
 * the one branch an integration test cannot reach, because it needs the db to fail.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "pricing-endpoint-secret";

const express = require("express");
const request = require("supertest");

function appWith(dbBehaviour) {
  jest.resetModules();
  jest.doMock("../src/models/database", () => ({
    getDb: dbBehaviour,
    // the router only needs getDb; anything else it pulls in stays real
  }));
  const app = express();
  app.use("/api/pricing", require("../src/routes/pricing"));
  return app;
}

const { DEFAULT_PLATFORM_FEE_PERCENT } = require("../src/utils/platformFee");

afterEach(() => { jest.resetModules(); jest.dontMock("../src/models/database"); });

describe("when the database answers", () => {
  test("it publishes the stored fee and the derived share", async () => {
    const app = appWith(async () => ({
      prepare: () => ({ get: async () => ({ value: "12" }) }),
    }));
    const res = await request(app).get("/api/pricing");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ platformFeePercent: 12, caregiverSharePercent: 88 });
  });

  test("it is cacheable — every logged-out visitor hits it", async () => {
    const app = appWith(async () => ({ prepare: () => ({ get: async () => ({ value: "20" }) }) }));
    const res = await request(app).get("/api/pricing");
    expect(res.headers["cache-control"]).toMatch(/max-age=\d+/);
  });
});

describe("when it does not", () => {
  test("a thrown getDb still publishes the default, never 0 or undefined", async () => {
    // 0% would be a false claim on a public page; undefined would render "a flat undefined%".
    const app = appWith(async () => { throw new Error("db down"); });
    const res = await request(app).get("/api/pricing");
    expect(res.status).toBe(200);
    expect(res.body.platformFeePercent).toBe(DEFAULT_PLATFORM_FEE_PERCENT);
    expect(res.body.caregiverSharePercent).toBe(100 - DEFAULT_PLATFORM_FEE_PERCENT);
  });

  test("a thrown query does too", async () => {
    const app = appWith(async () => ({
      prepare: () => ({ get: async () => { throw new Error("relation missing"); } }),
    }));
    const res = await request(app).get("/api/pricing");
    expect(res.body.platformFeePercent).toBe(DEFAULT_PLATFORM_FEE_PERCENT);
  });

  test("the two halves still sum to 100 on the failure path", async () => {
    const app = appWith(async () => { throw new Error("db down"); });
    const { platformFeePercent, caregiverSharePercent } = (await request(app).get("/api/pricing")).body;
    expect(platformFeePercent + caregiverSharePercent).toBe(100);
  });
});
