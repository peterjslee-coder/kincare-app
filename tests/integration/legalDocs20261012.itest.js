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

// v1.114.6 — migration 061 supersedes the privacy policy with 2026-10-14 (7B Text Messages).
// v1.118.0 — migration 067 supersedes it again with 2026-10-14b (first-party analytics, no Plausible).
// v1.124.3 — migration 074 supersedes it with 2026-10-19 (7B matches the A2P registrations).
// v1.126.7 — migration 077 supersedes it with 2026-10-29 (Google Maps Platform named).
const EXPECTED = { privacy: "2026-10-29", terms: "2026-10-12" };

test("exactly one active privacy and terms, at their current versions, with the new sections", async () => {
  for (const t of ["privacy", "terms"]) {
    const rows = await db.prepare("SELECT version, content, change_summary FROM legal_documents WHERE doc_type = ? AND is_active = 1").all(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe(EXPECTED[t]);
    expect(rows[0].change_summary).toBeTruthy();
  }
  const pp = await db.prepare("SELECT content FROM legal_documents WHERE doc_type = 'privacy' AND is_active = 1").get();
  expect(pp.content).toContain("Information You Provide About Someone Else");
  expect(pp.content).toContain("7A. Documents and Medical Records");
  expect(pp.content).toContain("Cloudflare R2");
  // v1.114.6 — the carrier-required SMS language, and the stale duplicate of 6/7 is gone.
  expect(pp.content).toContain("7B. Text Messages");
  expect(pp.content).toContain("Text messaging originator opt-in data and consent will not be shared with any third parties");
  // v1.124.3 — 7B matches the A2P registrations: no texting from lists, the recipient's own YES.
  expect(pp.content).toContain("sent only to people who have texted that number first");
  expect(pp.content).toContain("replies YES to our one confirmation text");
  expect(pp.content).not.toContain("referral list");
  // v1.126.7 — place search and mileage distances go to Google; the policy says so.
  expect(pp.content).toContain("Google Maps Platform");
  expect(pp.content).toContain("https://policies.google.com/privacy");
  expect(pp.content.match(/^6\. How We Share Your Information$/gm)).toHaveLength(1);
  expect(pp.content.match(/^7\. Health Information$/gm)).toHaveLength(1);
  expect(pp.content.match(/^Artificial Intelligence Services$/gm)).toHaveLength(1);
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
  expect(byType.privacy).toBe(EXPECTED.privacy);
  expect(byType.terms).toBe(EXPECTED.terms);
});
