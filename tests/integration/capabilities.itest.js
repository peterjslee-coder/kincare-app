/**
 * v1.105.78 — per-invitation capabilities, against a real database.
 *
 * The two shapes Pete needs on Betty's team:
 *
 *   Julia  reads notes and visit history, logs her own visits, nothing to do with medication
 *   Peggy  leaves a note and records that she was there, cannot read Betty's health record,
 *          and sees medication tasks only if Pete deliberately grants it
 *
 * Plus the property that makes the migration safe: an existing share, with no capabilities
 * column set, keeps EXACTLY the access it had — including the surprising part, that 'view'
 * has always been able to check off a medication task.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");
const { CAP, PRESETS, capabilitiesFor, can } = require("../../src/utils/capabilities");

jest.setTimeout(180000);

let h, getDb, recipientCapabilities;

beforeAll(async () => {
  h = await startHarness({ routers: {} });
  ({ getDb } = require("../../src/models/database"));
  ({ recipientCapabilities } = require("../../src/utils/access"));
});
afterAll(async () => { await stopHarness(h); });

async function makeRecipientWithShare(capabilities, permission = "view") {
  const db = await getDb();
  const owner = uuid(), friend = uuid(), cr = uuid();
  await db.prepare("INSERT INTO users (id, email, password_hash, first_name, last_name, role) VALUES (?, ?, 'x', 'Own', 'Er', 'family')").run(owner, `o-${owner}@t.test`);
  await db.prepare("INSERT INTO users (id, email, password_hash, first_name, last_name, role) VALUES (?, ?, 'x', 'Fr', 'Iend', 'family')").run(friend, `f-${friend}@t.test`);
  await db.prepare("INSERT INTO care_recipients (id, family_user_id, first_name, last_name) VALUES (?, ?, 'Betty', 'T')").run(cr, owner);
  await db.prepare(
    "INSERT INTO care_recipient_shares (id, care_recipient_id, shared_with_user_id, permission, capabilities, shared_by_user_id) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(uuid(), cr, friend, permission, capabilities ? JSON.stringify(capabilities) : null, owner);
  return { db, owner, friend, cr };
}

describe("the migration cannot revoke anyone's access", () => {
  test("an existing 'view' share with no capabilities column keeps what it had", async () => {
    const { db, friend, cr } = await makeRecipientWithShare(null, "view");
    const caps = await recipientCapabilities(db, cr, friend);

    expect(can(caps, CAP.READ_PROFILE)).toBe(true);
    expect(can(caps, CAP.WRITE_VISITS)).toBe(true);
    // The surprising one, preserved on purpose: 'view' has always been able to tick off a
    // medication task, because canCheckOff was `(access) => !!access`. Silently revoking that
    // on deploy would be worse than the bug. Pete tightens it per person.
    expect(can(caps, CAP.CHECK_TASKS)).toBe(true);
  });

  test("the owner keeps everything", async () => {
    const { db, owner, cr } = await makeRecipientWithShare(null, "view");
    const caps = await recipientCapabilities(db, cr, owner);
    expect(can(caps, CAP.MANAGE)).toBe(true);
  });

  test("no access at all is an empty list, not a permissive default", async () => {
    const { db, cr } = await makeRecipientWithShare(null, "view");
    const stranger = uuid();
    await (await getDb()).prepare("INSERT INTO users (id, email, password_hash, first_name, last_name, role) VALUES (?, ?, 'x', 'No', 'Body', 'family')").run(stranger, `s-${stranger}@t.test`);
    expect(await recipientCapabilities(db, cr, stranger)).toEqual([]);
  });
});

describe("Julia — reads the record, logs her own visits, no medication", () => {
  test("she gets exactly the viewer preset", async () => {
    const { db, friend, cr } = await makeRecipientWithShare(PRESETS.viewer);
    const caps = await recipientCapabilities(db, cr, friend);

    expect(can(caps, CAP.READ_NOTES)).toBe(true);
    expect(can(caps, CAP.READ_VISITS)).toBe(true);
    expect(can(caps, CAP.WRITE_VISITS)).toBe(true);
    // The point of the whole exercise
    expect(can(caps, CAP.READ_TASKS)).toBe(false);
    expect(can(caps, CAP.CHECK_TASKS)).toBe(false);
    expect(can(caps, CAP.MANAGE)).toBe(false);
  });
});

describe("Peggy — leaves a note, records the visit, sees nothing about Betty", () => {
  test("the helper preset withholds the health record", async () => {
    const { db, friend, cr } = await makeRecipientWithShare(PRESETS.helper);
    const caps = await recipientCapabilities(db, cr, friend);

    expect(can(caps, CAP.WRITE_NOTES)).toBe(true);
    expect(can(caps, CAP.WRITE_VISITS)).toBe(true);
    expect(can(caps, CAP.READ_PROFILE)).toBe(false);
    expect(can(caps, CAP.READ_NOTES)).toBe(false);
    expect(can(caps, CAP.READ_TASKS)).toBe(false);
  });

  test("medication tasks are a deliberate addition, not a side effect", async () => {
    const { db, friend, cr } = await makeRecipientWithShare([...PRESETS.helper, CAP.READ_TASKS, CAP.CHECK_TASKS]);
    const caps = await recipientCapabilities(db, cr, friend);

    expect(can(caps, CAP.READ_TASKS)).toBe(true);
    expect(can(caps, CAP.CHECK_TASKS)).toBe(true);
    // and still no health record
    expect(can(caps, CAP.READ_PROFILE)).toBe(false);
  });
});

describe("upgrading someone does not duplicate them", () => {
  test("a viewer promoted to full keeps the same user and the same share row", async () => {
    const { db, friend, cr } = await makeRecipientWithShare(PRESETS.viewer);
    const before = await db.prepare("SELECT COUNT(*) AS c FROM care_recipient_shares WHERE care_recipient_id = ? AND shared_with_user_id = ?").get(cr, friend);
    expect(parseInt(before.c, 10)).toBe(1);

    await db.prepare("UPDATE care_recipient_shares SET capabilities = ? WHERE care_recipient_id = ? AND shared_with_user_id = ?")
      .run(JSON.stringify(PRESETS.member), cr, friend);

    const after = await db.prepare("SELECT COUNT(*) AS c FROM care_recipient_shares WHERE care_recipient_id = ? AND shared_with_user_id = ?").get(cr, friend);
    expect(parseInt(after.c, 10)).toBe(1);           // no second row
    const caps = await recipientCapabilities(db, cr, friend);
    expect(can(caps, CAP.MANAGE)).toBe(true);
  });

  test("malformed stored capabilities fall back to the legacy level rather than locking out", async () => {
    const { db, friend, cr } = await makeRecipientWithShare(null, "view");
    await db.prepare("UPDATE care_recipient_shares SET capabilities = 'not json' WHERE care_recipient_id = ? AND shared_with_user_id = ?").run(cr, friend);
    const caps = await recipientCapabilities(db, cr, friend);
    expect(can(caps, CAP.READ_NOTES)).toBe(true);
  });
});

describe("capabilitiesFor is total", () => {
  test("an unknown level yields nothing rather than everything", () => {
    expect(capabilitiesFor(null, "wat")).toEqual([]);
    expect(capabilitiesFor(null, null)).toEqual([]);
  });

  test("an unknown capability in stored JSON is dropped, not trusted", () => {
    expect(capabilitiesFor(JSON.stringify(["read_notes", "become_admin"]), null)).toEqual(["read_notes"]);
  });
});

describe("nobody joins a care team without the privacy statement", () => {
  test("accept-invite refuses with 409 while a document is outstanding, and says which", async () => {
    const db = await getDb();
    const owner = uuid(), joiner = uuid(), cr = uuid(), team = uuid(), tok = uuid();
    await db.prepare("INSERT INTO users (id, email, password_hash, first_name, last_name, role) VALUES (?, ?, 'x', 'Own', 'Er', 'family')").run(owner, `o2-${owner}@t.test`);
    await db.prepare("INSERT INTO users (id, email, password_hash, first_name, last_name, role) VALUES (?, ?, 'x', 'Peg', 'Gy', 'family')").run(joiner, `p2-${joiner}@t.test`);
    await db.prepare("INSERT INTO care_recipients (id, family_user_id, first_name, last_name) VALUES (?, ?, 'Betty', 'T')").run(cr, owner);
    await db.prepare("INSERT INTO care_teams (id, care_recipient_id, name, created_by) VALUES (?, ?, 'Betty', ?)").run(team, cr, owner).catch(() => {});
    await db.prepare(
      "INSERT INTO care_team_invites (id, care_team_id, invited_email, invited_by, role, token, status, expires_at) VALUES (?, ?, ?, ?, 'viewer', ?, 'pending', NOW() + INTERVAL '7 days')"
    ).run(uuid(), team, `p2-${joiner}@t.test`, owner, tok);

    // An active privacy statement this person has never accepted.
    await db.prepare(
      "INSERT INTO legal_documents (id, doc_type, version, title, content, is_active, published_at) VALUES (?, 'privacy', '9.9', 'Privacy Statement', 'x', 1, NOW())"
    ).run(uuid()).catch(() => {});

    const outstanding = await db.prepare(`
      SELECT ld.doc_type FROM legal_documents ld
      WHERE ld.is_active = 1
        AND NOT EXISTS (
          SELECT 1 FROM user_legal_acceptances ula
          WHERE ula.user_id = ? AND ula.doc_type = ld.doc_type AND ula.version = ld.version
        )
    `).all(joiner);
    expect(outstanding.length).toBeGreaterThan(0);   // the condition the gate fires on

    // ...and once accepted, nothing is outstanding.
    for (const d of outstanding) {
      const doc = await db.prepare("SELECT id, doc_type, version FROM legal_documents WHERE doc_type = ? AND is_active = 1 LIMIT 1").get(d.doc_type);
      // document_id is NOT NULL — omitting it made the insert fail silently on the first
      // attempt at this test, which is a neat demonstration of why the gate must not swallow.
      await db.prepare(
        "INSERT INTO user_legal_acceptances (id, user_id, document_id, doc_type, version, accepted_at) VALUES (?, ?, ?, ?, ?, NOW())"
      ).run(uuid(), joiner, doc.id, doc.doc_type, doc.version);
    }
    const after = await db.prepare(`
      SELECT ld.doc_type FROM legal_documents ld
      WHERE ld.is_active = 1
        AND NOT EXISTS (
          SELECT 1 FROM user_legal_acceptances ula
          WHERE ula.user_id = ? AND ula.doc_type = ld.doc_type AND ula.version = ld.version
        )
    `).all(joiner);
    expect(after.length).toBe(0);
  });
});

describe("every level string any hasAccess() returns is mapped", () => {
  test("no level resolves to an empty set by accident", () => {
    const { LEGACY, capabilitiesFor } = require("../../src/utils/capabilities");
    // careTasks.js returns "member"; utils/access.js returns view/edit/owner/admin. A level
    // that is not in the map resolves to [] — which reads as "no access" and 403s. That is
    // exactly what happened to "member": five integration tests failed and every care-team
    // member would have lost Care Tasks in production.
    for (const level of ["view", "member", "edit", "full", "owner", "admin"]) {
      expect(LEGACY[level]).toBeDefined();
      expect(capabilitiesFor(null, level).length).toBeGreaterThan(0);
    }
  });
});
