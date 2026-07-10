/**
 * Migration 001_null_malformed_feedback_json: a malformed tags/page_context
 * value is NULLed once, and well-formed rows are untouched (infra #7).
 */
const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

let h;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await stopHarness(h); });

test("malformed feedback JSON is nulled by re-running the migration body", async () => {
  const { user } = await h.createUser({});
  const badId = uuid(), goodId = uuid();
  await h.db.prepare(
    "INSERT INTO feedback (id, user_id, category, description, tags, page_context) VALUES (?, ?, 'bug', 'malformed row', ?, ?)"
  ).run(badId, user.id, "{not json[", "also not json");
  await h.db.prepare(
    "INSERT INTO feedback (id, user_id, category, description, tags, page_context) VALUES (?, ?, 'bug', 'good row', ?, ?)"
  ).run(goodId, user.id, JSON.stringify(["a", "b"]), JSON.stringify({ page: "dashboard" }));

  // The migration already ran (empty table) during harness boot; replay its
  // body directly — it must be idempotent and safe to run over live rows.
  await h.db.exec(`DO $mig$
    DECLARE r RECORD;
    BEGIN
      FOR r IN SELECT id, tags, page_context FROM feedback
               WHERE tags IS NOT NULL OR page_context IS NOT NULL LOOP
        BEGIN PERFORM r.tags::json;
        EXCEPTION WHEN others THEN UPDATE feedback SET tags = NULL WHERE id = r.id; END;
        BEGIN PERFORM r.page_context::json;
        EXCEPTION WHEN others THEN UPDATE feedback SET page_context = NULL WHERE id = r.id; END;
      END LOOP;
    END $mig$;`);

  const bad = await h.db.prepare("SELECT tags, page_context FROM feedback WHERE id = ?").get(badId);
  expect(bad.tags).toBeNull();
  expect(bad.page_context).toBeNull();
  const good = await h.db.prepare("SELECT tags, page_context FROM feedback WHERE id = ?").get(goodId);
  expect(JSON.parse(good.tags)).toEqual(["a", "b"]);
  expect(JSON.parse(good.page_context)).toEqual({ page: "dashboard" });
});
