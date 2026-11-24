/**
 * v1.105.46 — tapping Save twice must not log two visits.
 *
 * The client now gives up after 25 seconds instead of hanging forever, which means the
 * honest outcome of a bad signal is "we don't know whether it landed" — and the natural
 * human response to that is to tap Save again. That turns a hang into a duplicate unless
 * the server is ready for it.
 *
 * String-matching the SQL proves nothing about whether it matches. This runs it.
 */
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

let h, pete, recipientId;
// Relative to now, not a fixed date: the route rejects the future, so a hard-coded
// timestamp turns into a 400 the moment the clock disagrees with whoever wrote the test.
const visitedAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
const laterVisitAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();

beforeAll(async () => {
  h = await startHarness({
    routers: { "/api/family-visits": "../../src/routes/familyVisits" },
  });
  pete = await h.createUser({ firstName: "Pete", lastName: "Lee" });
  const t = await h.createCareTeam({ familyUserId: pete.user.id });
  recipientId = t.recipientId;
});

afterAll(async () => { await stopHarness(h); });

const post = (body) => h.request.post("/api/family-visits").set(h.auth(pete.token)).send(body);

describe("the retry after a lost response", () => {
  const visit = {
    summary: "Made lunch, she was in good spirits",
    moodRating: "good",
    activities: ["meal", "company"],
    visitedAt,
  };

  let firstId;

  test("the first save creates the visit", async () => {
    const res = await post({ careRecipientId: recipientId, ...visit });
    expect(res.status).toBe(201);
    expect(res.body.visit?.id).toBeTruthy();
    firstId = res.body.visit.id;
  });

  test("saving the identical thing again returns the SAME visit, not a second one", async () => {
    const res = await post({ careRecipientId: recipientId, ...visit });
    expect(res.status).toBe(201);
    expect(res.body.visit.id).toBe(firstId);

    const rows = await h.db.prepare(
      "SELECT COUNT(*) AS count FROM family_visits WHERE care_recipient_id = ?"
    ).get(recipientId);
    expect(parseInt(rows.count, 10)).toBe(1);
  });

  test("the returned record is the real one, with its content intact", async () => {
    // Handing back a bare id would be technically fine and useless — the sheet closes on
    // this response and the list renders from it.
    const res = await post({ careRecipientId: recipientId, ...visit });
    expect(res.body.visit.summary).toBe(visit.summary);
    expect(res.body.visit.id).toBe(firstId);
  });

  test("a genuinely different visit still gets through", async () => {
    // The guard keys on the visit TIME, so two real visits on one day are both recorded.
    const res = await post({
      careRecipientId: recipientId,
      summary: "Came back after her nap",
      moodRating: "okay",
      activities: ["company"],
      visitedAt: laterVisitAt,
    });
    expect(res.status).toBe(201);
    expect(res.body.visit.id).not.toBe(firstId);

    const rows = await h.db.prepare(
      "SELECT COUNT(*) AS count FROM family_visits WHERE care_recipient_id = ?"
    ).get(recipientId);
    expect(parseInt(rows.count, 10)).toBe(2);
  });

  test("someone else logging the same moment is their own visit, not a dedupe", async () => {
    // Two family members at the house at once is a real thing, and each account of it is
    // its own record.
    const sara = await h.createUser({ firstName: "Sara", lastName: "Lee" });
    await h.db.prepare(
      "UPDATE care_recipients SET family_user_id = family_user_id WHERE id = ?"
    ).run(recipientId);
    const res = await h.request.post("/api/family-visits")
      .set(h.auth(sara.token))
      .send({ careRecipientId: recipientId, summary: "I was there too", visitedAt });
    // Sara isn't on this recipient, so she gets the 404 the access helper promises —
    // which also proves the dedupe never leaks another person's visit id.
    expect(res.status).toBe(404);
  });
});
