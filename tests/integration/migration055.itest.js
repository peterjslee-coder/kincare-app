/**
 * v1.111.4 — migration 055 against the row it exists for. The first version wrote NULL into
 * consent_audit_log.actor_id (NOT NULL). Staging has no such row, so it passed there; on prod
 * the migration rolled back, boot failed, and Railway kept the previous build. Run it for real.
 */
const fs = require("fs");
const path = require("path");
const { startHarness, stopHarness } = require("./harness");
jest.setTimeout(180000);

const BETTY = "024c3cb9-425e-4c9c-a066-87fd90402f61";
const KIT = "ccf867e0-aeaf-4f06-8c40-1a4824d1aa2a";
const PETE = "6f3d7018-ceb4-4d7a-a252-1e431fa92405";

function statements055() {
  const src = fs.readFileSync(path.join(__dirname, "../../src/models/database.js"), "utf8");
  const at = src.indexOf('id: "055_unlink_kit_from_betty_and_authorities"');
  const start = src.indexOf("statements: [", at) + "statements: ".length;
  const end = src.indexOf("\n      ],\n", start) + "\n      ]".length;
  // eslint-disable-next-line no-eval
  return eval(src.slice(start, end));
}

let h, db;
beforeAll(async () => { h = await startHarness({ routers: {} }); db = h.db; });
afterAll(async () => { await stopHarness(h); });

test("unlinks exactly that account, records Pete as the actor, and is safe to run twice", async () => {
  const pete = await h.createUser({ roles: ["family"], firstName: "Pete" });
  const kit = await h.createUser({ roles: ["care_for"], firstName: "Kit" });
  // re-key the two users to the production ids the migration names
  for (const [from, to] of [[pete.user.id, PETE], [kit.user.id, KIT]]) {
    await db.prepare("UPDATE users SET id = ? WHERE id = ?").run(to, from);
  }
  await db.prepare(`INSERT INTO care_recipients (id, family_user_id, first_name, last_name, linked_user_id)
    VALUES (?, ?, 'Betty', 'Lee', ?)`).run(BETTY, PETE, KIT);

  const stmts = statements055();
  for (let run = 0; run < 2; run++) {
    await db.transaction(async (tx) => { for (const sql of stmts) await tx.exec(sql); });
  }
  const cr = await db.prepare("SELECT linked_user_id FROM care_recipients WHERE id = ?").get(BETTY);
  expect(cr.linked_user_id).toBeNull();
  const rows = await db.prepare("SELECT actor_id, metadata FROM consent_audit_log WHERE care_recipient_id = ? AND event_type = 'linked_account_removed'").all(BETTY);
  expect(rows).toHaveLength(1);
  expect(rows[0].actor_id).toBe(PETE);
  expect(JSON.parse(rows[0].metadata).previous_linked_user_id).toBe(KIT);
});
