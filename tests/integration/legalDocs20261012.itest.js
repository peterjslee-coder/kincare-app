/**
 * v1.110.2 — migration 054 publishes Privacy Policy + Terms 2026-10-12 from src/legal/*.txt,
 * and every signed-in user is asked to accept the new versions.
 */
const { startHarness, stopHarness } = require("./harness");
jest.setTimeout(180000);
let h, db, pete;

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/legal": "../../src/routes/legal" } });
  db = h.db;
  pete = await h.createUser({ roles: ["family"], firstName: "Pete" });
});
afterAll(async () => { await stopHarness(h); });

test("exactly one active privacy and terms, both 2026-10-12, with the new sections", async () => {
  for (const t of ["privacy", "terms"]) {
    const rows = await db.prepare("SELECT version, content, change_summary FROM legal_documents WHERE doc_type = ? AND is_active = 1").all(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe("2026-10-12");
    expect(rows[0].change_summary).toBeTruthy();
  }
  const pp = await db.prepare("SELECT content FROM legal_documents WHERE doc_type = 'privacy' AND is_active = 1").get();
  expect(pp.content).toContain("Information You Provide About Someone Else");
  expect(pp.content).toContain("7A. Documents and Medical Records");
  expect(pp.content).toContain("Cloudflare R2");
  const tou = await db.prepare("SELECT content FROM legal_documents WHERE doc_type = 'terms' AND is_active = 1").get();
  expect(tou.content).toContain("Acting for Someone Else");
  expect(tou.content).toContain("Private Care Content");
  expect(tou.content).not.toContain("non-confidential and non-proprietary");
});

test("a signed-in user is asked to accept both", async () => {
  const res = await h.request.get("/api/legal/pending").set(h.auth(pete.token));
  expect(res.status).toBe(200);
  const docs = res.body.pending || res.body.documents || [];
  const byType = Object.fromEntries(docs.map((d) => [d.doc_type || d.docType, d.version]));
  expect(byType.privacy).toBe("2026-10-12");
  expect(byType.terms).toBe("2026-10-12");
});
