/**
 * Which sections you keep folded up, remembered on the account. (v1.105.171)
 *
 * Pete: "it should stick, too...if I minimize the reimbursements because i don't really look
 * at that...the next time i log in i want it minimized too."
 *
 * Integration, because the thing that actually matters is the MERGE: he uses the phone and
 * the Mac, and a save that replaces the blob means whichever device wrote last silently
 * undoing the other. That is only visible against a real row.
 */
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

const ROUTERS = { "/api/auth": "../../src/routes/auth" };

let h, pete;

beforeAll(async () => {
  h = await startHarness({ routers: ROUTERS });
  pete = await h.createUser({ roles: ["family"], firstName: "Pete" });
});

afterAll(async () => { await stopHarness(h); });

const patch = (who, body) =>
  h.request.patch("/api/auth/me/ui-prefs").set(h.auth(who.token)).send(body);

const me = (who) => h.request.get("/api/auth/me").set(h.auth(who.token));

describe("it remembers, and it comes back with the user", () => {
  test("a preference saved is a preference returned by /me", async () => {
    const res = await patch(pete, { patch: { "careTeam.reimbursements": false } });
    expect(res.status).toBe(200);
    expect(res.body.uiPrefs["careTeam.reimbursements"]).toBe(false);

    // The column has to be in the explicit SELECT list or the feature fails silently by
    // always looking like a fresh account.
    const who = await me(pete);
    expect(who.status).toBe(200);
    const blob = JSON.parse(who.body.user.ui_prefs);
    expect(blob["careTeam.reimbursements"]).toBe(false);
  });
});

describe("two devices are additive, not last-writer-wins", () => {
  test("a second patch does not erase the first", async () => {
    await patch(pete, { patch: { "lovedOne.notes": true } });
    const res = await patch(pete, { patch: { "lovedOne.health": false } });
    // The phone folding Health must not un-fold what the Mac folded a minute ago.
    expect(res.body.uiPrefs).toMatchObject({
      "careTeam.reimbursements": false,
      "lovedOne.notes": true,
      "lovedOne.health": false,
    });
  });

  test("null deletes a key, so the blob cannot grow forever", async () => {
    const res = await patch(pete, { patch: { "lovedOne.notes": null } });
    // NOTE the array form. The keys are dotted and Jest reads a dotted STRING as a nested
    // path, so `toHaveProperty("lovedOne.health")` asks whether there is an object named
    // lovedOne with a health field — which is false for the right blob and false for an
    // empty one, i.e. it passes and fails for reasons that have nothing to do with the code.
    const keys = Object.keys(res.body.uiPrefs);
    expect(keys).not.toContain("lovedOne.notes");
    expect(keys).toContain("lovedOne.health");
    expect(keys).toContain("careTeam.reimbursements");
  });
});

describe("it is not a general key-value store on the users table", () => {
  test("a non-object patch is refused", async () => {
    expect((await patch(pete, { patch: "everything" })).status).toBe(400);
    expect((await patch(pete, { patch: ["a"] })).status).toBe(400);
    expect((await patch(pete, {})).status).toBe(400);
  });

  test("objects and arrays as values are refused", async () => {
    expect((await patch(pete, { patch: { a: { nested: true } } })).status).toBe(400);
    expect((await patch(pete, { patch: { a: [1, 2] } })).status).toBe(400);
  });

  test("an over-long key or value is refused", async () => {
    expect((await patch(pete, { patch: { ["k".repeat(81)]: true } })).status).toBe(400);
    expect((await patch(pete, { patch: { k: "v".repeat(201) } })).status).toBe(400);
  });

  test("too many keys at once is refused", async () => {
    const big = {};
    for (let i = 0; i < 51; i++) big[`k${i}`] = true;
    expect((await patch(pete, { patch: big })).status).toBe(400);
  });

  test("it needs a session", async () => {
    const res = await h.request.patch("/api/auth/me/ui-prefs").send({ patch: { a: true } });
    expect([401, 403]).toContain(res.status);
  });
});

describe("a malformed blob does not lock anyone out", () => {
  test("garbage in the column is treated as no preferences", async () => {
    await h.db.prepare("UPDATE users SET ui_prefs = ? WHERE id = ?").run("{not json", pete.user.id);
    const res = await patch(pete, { patch: { "lovedOne.kindred": true } });
    expect(res.status).toBe(200);
    expect(res.body.uiPrefs).toEqual({ "lovedOne.kindred": true });
  });
});
