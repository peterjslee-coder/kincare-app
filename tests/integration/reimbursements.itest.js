/**
 * Money-path integration tests: reimbursements ledger (infra #6).
 * Real embedded PostgreSQL + real routers over HTTP.
 */
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

let h;
let leader, member, billing, outsider;
let teamId;

beforeAll(async () => {
  h = await startHarness();
  leader = await h.createUser({ firstName: "Lea", lastName: "Der" });
  member = await h.createUser({ firstName: "Mem", lastName: "Ber" });
  billing = await h.createUser({ firstName: "Sara", lastName: "Payer" });
  outsider = await h.createUser({ firstName: "Out", lastName: "Sider" });
  const t = await h.createCareTeam({ familyUserId: leader.user.id, billingUserId: billing.user.id });
  teamId = t.teamId;
  await h.addTeamMember(teamId, member.user.id, "member");
  await h.addTeamMember(teamId, billing.user.id, "member");
});

afterAll(async () => { await stopHarness(h); });

describe("reimbursement lifecycle", () => {
  let reimbursementId;

  test("team member can submit a reimbursement", async () => {
    const res = await h.request.post("/api/reimbursements")
      .set(h.auth(member.token))
      .send({ careTeamId: teamId, amount: 42.5, description: "Groceries for Betty", category: "groceries" });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    reimbursementId = res.body.id;
  });

  test("ledger shows the pending request to team members", async () => {
    const res = await h.request.get(`/api/reimbursements/team/${teamId}`)
      .set(h.auth(leader.token));
    expect(res.status).toBe(200);
    const found = (res.body.reimbursements || res.body).find((r) => r.id === reimbursementId);
    expect(found).toBeTruthy();
    expect(found.status).toBe("pending");
    expect(parseFloat(found.amount)).toBeCloseTo(42.5);
  });

  test("outsider cannot view the team ledger", async () => {
    const res = await h.request.get(`/api/reimbursements/team/${teamId}`)
      .set(h.auth(outsider.token));
    expect([403, 404]).toContain(res.status);
  });

  test("non-billing member cannot approve", async () => {
    const res = await h.request.post(`/api/reimbursements/${reimbursementId}/approve`)
      .set(h.auth(member.token));
    expect([403, 404]).toContain(res.status);
  });

  test("billing contact approves", async () => {
    const res = await h.request.post(`/api/reimbursements/${reimbursementId}/approve`)
      .set(h.auth(billing.token));
    expect(res.status).toBe(200);
    const row = await h.db.prepare("SELECT status, approved_by FROM reimbursements WHERE id = ?").get(reimbursementId);
    expect(row.status).toBe("approved");
    expect(row.approved_by).toBe(billing.user.id);
  });

  test("billing contact marks paid (off-platform settlement)", async () => {
    const res = await h.request.post(`/api/reimbursements/${reimbursementId}/mark-paid`)
      .set(h.auth(billing.token))
      .send({ method: "zelle" });
    expect(res.status).toBe(200);
    const row = await h.db.prepare("SELECT status, paid_method FROM reimbursements WHERE id = ?").get(reimbursementId);
    expect(row.status).toBe("paid");
    expect(row.paid_method).toBe("zelle");
  });
});

describe("reimbursement validation", () => {
  test("amount above $10k cap is rejected", async () => {
    const res = await h.request.post("/api/reimbursements")
      .set(h.auth(member.token))
      .send({ careTeamId: teamId, amount: 10000.01, description: "way too much", category: "other" });
    expect(res.status).toBe(400);
  });

  test("negative amount is rejected", async () => {
    const res = await h.request.post("/api/reimbursements")
      .set(h.auth(member.token))
      .send({ careTeamId: teamId, amount: -5, description: "negative money", category: "other" });
    expect(res.status).toBe(400);
  });

  test("outsider cannot submit against the team", async () => {
    const res = await h.request.post("/api/reimbursements")
      .set(h.auth(outsider.token))
      .send({ careTeamId: teamId, amount: 10, description: "not my team", category: "other" });
    expect([403, 404]).toContain(res.status);
  });

  test("unauthenticated request is rejected", async () => {
    const res = await h.request.post("/api/reimbursements")
      .send({ careTeamId: teamId, amount: 10, description: "no auth at all", category: "other" });
    expect(res.status).toBe(401);
  });
});
