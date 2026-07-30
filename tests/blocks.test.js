// v1.105.13 — the blocking predicate. Worth real tests for the same reason the age gate
// was: it is a permission boundary, its failures are invisible, and getting
// canBlockDirectly backwards means either stripping agency from someone entitled to it or
// letting a managed account silently sever its own care coordination.

const {
  getBlockedIds,
  isBlockedBetween,
  canBlockDirectly,
} = require("../src/utils/blocks");

// Minimal db double. `plan` maps a SQL substring → the rows that query should return, so
// each test states only the query it cares about.
function fakeDb(plan, { throwOn } = {}) {
  const find = (sql) => {
    if (throwOn && sql.includes(throwOn)) throw new Error("simulated db failure");
    const key = Object.keys(plan).find((k) => sql.includes(k));
    return key ? plan[key] : [];
  };
  return {
    prepare(sql) {
      return {
        all: async () => find(sql),
        get: async () => {
          const rows = find(sql);
          return Array.isArray(rows) ? rows[0] : rows;
        },
      };
    },
  };
}

describe("getBlockedIds", () => {
  test("returns blocks in BOTH directions — blocking is symmetric", async () => {
    // The UNION query is what makes it symmetric; if someone rewrites it as a single
    // WHERE blocker_user_id = ?, a person I blocked could still reach me.
    const db = fakeDb({ user_blocks: [{ other: "u2" }, { other: "u3" }] });
    const ids = await getBlockedIds(db, "u1");
    expect(ids.has("u2")).toBe(true);
    expect(ids.has("u3")).toBe(true);
  });

  test("returns a Set, not an array", async () => {
    // Callers filter every message and conversation against this. An array turns each
    // safety check into a linear scan — a correctness fix that becomes a perf bug.
    const db = fakeDb({ user_blocks: [{ other: "u2" }] });
    expect(await getBlockedIds(db, "u1")).toBeInstanceOf(Set);
  });

  test("no user id yields an empty set rather than querying", async () => {
    expect((await getBlockedIds(fakeDb({}), null)).size).toBe(0);
  });

  test("a database failure fails OPEN, not closed", async () => {
    // Failing closed would hide every conversation during a transient blip — which in a
    // care app reads as data loss. Deliberate: see the comment in blocks.js.
    const db = fakeDb({ user_blocks: [{ other: "u2" }] }, { throwOn: "user_blocks" });
    expect((await getBlockedIds(db, "u1")).size).toBe(0);
  });
});

describe("isBlockedBetween", () => {
  test("true when a block exists in either direction", async () => {
    expect(await isBlockedBetween(fakeDb({ user_blocks: [{ hit: 1 }] }), "a", "b")).toBe(true);
  });

  test("false when there is none", async () => {
    expect(await isBlockedBetween(fakeDb({ user_blocks: [] }), "a", "b")).toBe(false);
  });

  test("a user is never blocked from themselves", async () => {
    // Self-conversations and system threads must not be able to lock someone out.
    expect(await isBlockedBetween(fakeDb({ user_blocks: [{ hit: 1 }] }), "a", "a")).toBe(false);
  });

  test("missing ids are not an implicit block", async () => {
    expect(await isBlockedBetween(fakeDb({}), null, "b")).toBe(false);
  });
});

describe("canBlockDirectly — who needs care team approval", () => {
  const recipient = (over) => ({
    care_recipients: [{ id: "cr1", family_user_id: "pete", linked_user_id: "betty", permission_tier: "full", ...over }],
  });

  test("a family user always blocks directly", async () => {
    expect((await canBlockDirectly(fakeDb({}), "pete", "family")).allowed).toBe(true);
  });

  test("a caregiver always blocks directly", async () => {
    expect((await canBlockDirectly(fakeDb({}), "maria", "caregiver")).allowed).toBe(true);
  });

  test("a SELF-signed-up care recipient blocks directly", async () => {
    // auth.js sets family_user_id and linked_user_id to the SAME id on self-signup. That
    // equality is the only non-drifting signal that a person manages their own account.
    const db = fakeDb(recipient({ family_user_id: "betty", linked_user_id: "betty" }));
    expect((await canBlockDirectly(db, "betty", "care_for")).allowed).toBe(true);
  });

  test("a MANAGED care recipient cannot block alone", async () => {
    // Betty's profile was created by Pete, so family_user_id !== linked_user_id.
    const r = await canBlockDirectly(fakeDb(recipient()), "betty", "care_for");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("managed");
    expect(r.recipientId).toBe("cr1");
  });

  test("permission_tier='managed' overrides even a self-owned profile", async () => {
    // A family can move a self-signed-up recipient into managed mode later; the explicit
    // setting has to win over the ownership heuristic.
    const db = fakeDb(recipient({ family_user_id: "betty", linked_user_id: "betty", permission_tier: "managed" }));
    expect((await canBlockDirectly(db, "betty", "care_for")).allowed).toBe(false);
  });

  test("a care_for user with no recipient profile is self-directed", async () => {
    expect((await canBlockDirectly(fakeDb({ care_recipients: [] }), "x", "care_for")).allowed).toBe(true);
  });

  test("a database failure routes to APPROVAL, the opposite default from getBlockedIds", async () => {
    // Failing open here would cancel real visits on a bad read. Failing toward asking a
    // human is recoverable; an unintended cancellation is not.
    const db = fakeDb(recipient(), { throwOn: "care_recipients" });
    const r = await canBlockDirectly(db, "betty", "care_for");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("unknown");
  });
});

// ─── the migration has to actually create these tables ───
const fs = require("fs");
const path = require("path");

describe("migration 014", () => {
  const schema = fs.readFileSync(path.join(__dirname, "..", "src/models/database.js"), "utf8");

  test("is registered and creates all three tables", () => {
    expect(schema).toMatch(/id: "014_user_blocks_and_reports"/);
    for (const t of ["user_blocks", "content_reports", "block_requests"]) {
      expect(schema).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${t}`));
    }
  });

  test("re-blocking is idempotent, not a duplicate row", () => {
    // Without the unique pair index, blocking twice leaves two rows and the unblock path
    // deletes one — leaving the person still blocked with no way to tell.
    expect(schema).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS user_blocks_pair/);
  });

  test("reports snapshot the content", () => {
    // A reported message can be soft-deleted before an admin reads the report. No
    // snapshot means the reviewer sees an empty thread and the report is unactionable.
    expect(schema).toMatch(/content_snapshot TEXT/);
  });

  test("014 does not collide with an existing migration id", () => {
    expect((schema.match(/id: "014_/g) || []).length).toBe(1);
  });
});
