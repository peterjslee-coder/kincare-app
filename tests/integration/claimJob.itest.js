/**
 * v1.106.24 — coverage for PUT /api/sessions/:id/claim, written BEFORE touching it.
 *
 * This is the route that puts a caregiver on a job. Before this file, `/claim` appeared in
 * four tests and not one of them called it. Every gate in front of it — paused account,
 * missing care preferences, no background check, claiming your own request, claiming a
 * session someone already took — was unverified, on the path where money starts.
 *
 * It exists now because the recurring-offer work needs to accept a whole series at once, and
 * the honest way to do that is to extract the single-session claim and reuse it. A refactor
 * of an uncovered money path is a guess. So: characterise it first, refactor second, and the
 * same assertions have to still pass afterwards.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "claim-job-secret";

const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, db, family, caregiver, profileId, recipientId;

const soon = (daysOut = 3) => {
  const d = new Date(); d.setDate(d.getDate() + daysOut);
  return d.toISOString().slice(0, 10);
};

/** An open request, optionally offered exclusively to our caregiver. */
async function makeSession(overrides = {}) {
  const id = uuid();
  await db.prepare(`
    INSERT INTO care_sessions
      (id, care_recipient_id, family_user_id, service_type, status,
       scheduled_date, scheduled_time, duration_hours, estimated_cost,
       offered_to_caregiver_id, recurrence_group_id, exclusive_until, created_at)
    VALUES (?, ?, ?, 'companion', ?, ?, '10:00', 2, 100, ?, ?, ?, NOW())
  `).run(
    id, overrides.recipientId || recipientId, overrides.familyUserId || family.user.id,
    overrides.status || "open", overrides.date || soon(),
    overrides.offeredTo === undefined ? profileId : overrides.offeredTo,
    overrides.groupId || null,
    overrides.exclusiveUntil || null
  );
  return id;
}

const claim = (id, token = caregiver.token) =>
  h.request.put(`/api/sessions/${id}/claim`).set(h.auth(token)).send({});

const statusOf = async (id) =>
  (await db.prepare("SELECT status, caregiver_id FROM care_sessions WHERE id = ?").get(id));

/** Put the caregiver back in a state where claiming is allowed. */
const resetProfile = () => db.prepare(`
  UPDATE caregiver_profiles
  SET account_paused = 0, care_stoplight = 'green', is_background_checked = 1
  WHERE id = ?
`).run(profileId);

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/sessions": "../../src/routes/sessions" } });
  db = h.db;

  family = await h.createUser({ firstName: "Pete", lastName: "ITest" });
  caregiver = await h.createUser({ roles: ["caregiver"], firstName: "Tina", lastName: "ITest" });

  profileId = uuid();
  await db.prepare(`
    INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_background_checked, care_stoplight, created_at)
    VALUES (?, ?, 25, 1, 'green', NOW())
  `).run(profileId, caregiver.user.id);

  ({ recipientId } = await h.createCareTeam({ familyUserId: family.user.id }));
});

afterEach(resetProfile);
afterAll(async () => { await stopHarness(h); });

describe("claiming a job", () => {
  test("a cleared caregiver takes an open request", async () => {
    const id = await makeSession();
    const res = await claim(id);
    expect(res.status).toBe(200);

    const row = await statusOf(id);
    expect(row.status).toBe("confirmed");
    expect(row.caregiver_id).toBe(profileId);
  });

  test("claiming creates the assignment, so she shows up in future Request Care lists", async () => {
    const id = await makeSession();
    await claim(id).expect(200);
    const a = await db.prepare(`
      SELECT is_active FROM caregiver_assignments
      WHERE caregiver_profile_id = ? AND care_recipient_id = ?
    `).get(profileId, recipientId);
    expect(a).toBeTruthy();
  });

  test("a second caregiver cannot take a session already confirmed", async () => {
    const id = await makeSession();
    await claim(id).expect(200);

    const other = await h.createUser({ roles: ["caregiver"], firstName: "Julia", lastName: "ITest" });
    await db.prepare(`
      INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_background_checked, care_stoplight, created_at)
      VALUES (?, ?, 25, 1, 'green', NOW())
    `).run(uuid(), other.user.id);

    const res = await claim(id, other.token);
    expect(res.status).toBe(400);
    // And the first caregiver still owns it.
    expect((await statusOf(id)).caregiver_id).toBe(profileId);
  });
});

describe("the gates in front of it", () => {
  test("a family account cannot claim at all", async () => {
    const id = await makeSession();
    const res = await claim(id, family.token);
    expect(res.status).toBe(403);
    expect((await statusOf(id)).status).toBe("open");
  });

  test("you cannot accept a request you posted yourself", async () => {
    // The caregiver is also the family on this one — paying yourself.
    const own = await h.createUser({ roles: ["caregiver", "family"], firstName: "Solo", lastName: "ITest" });
    const soloProfile = uuid();
    await db.prepare(`
      INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_background_checked, care_stoplight, created_at)
      VALUES (?, ?, 25, 1, 'green', NOW())
    `).run(soloProfile, own.user.id);
    const id = await makeSession({ familyUserId: own.user.id, offeredTo: soloProfile });

    const res = await claim(id, own.token);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/posted yourself/i);
    expect((await statusOf(id)).status).toBe("open");
  });

  test("a paused account is refused", async () => {
    await db.prepare("UPDATE caregiver_profiles SET account_paused = 1 WHERE id = ?").run(profileId);
    const id = await makeSession();
    const res = await claim(id);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/paused/i);
    expect((await statusOf(id)).status).toBe("open");
  });

  test("no care preferences set is refused", async () => {
    await db.prepare("UPDATE caregiver_profiles SET care_stoplight = NULL, care_preferences = NULL WHERE id = ?").run(profileId);
    const id = await makeSession();
    const res = await claim(id);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/care preferences/i);
    expect((await statusOf(id)).status).toBe("open");
  });

  test("no background check and no vouch is refused", async () => {
    await db.prepare("UPDATE caregiver_profiles SET is_background_checked = 0 WHERE id = ?").run(profileId);
    const id = await makeSession();
    const res = await claim(id);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/background check/i);
    expect((await statusOf(id)).status).toBe("open");
  });

  test("an active admin vouch for THIS family stands in for the background check", async () => {
    await db.prepare("UPDATE caregiver_profiles SET is_background_checked = 0 WHERE id = ?").run(profileId);
    await db.prepare(`
      INSERT INTO bg_admin_vouches (id, caregiver_user_id, family_user_id, vouched_by, created_at)
      VALUES (?, ?, ?, ?, NOW())
    `).run(uuid(), caregiver.user.id, family.user.id, family.user.id);

    const id = await makeSession();
    const res = await claim(id);
    expect(res.status).toBe(200);
    expect((await statusOf(id)).caregiver_id).toBe(profileId);

    await db.prepare("DELETE FROM bg_admin_vouches WHERE caregiver_user_id = ?").run(caregiver.user.id);
  });

  test("the own-request reason wins over the preferences reason", async () => {
    // v1.105.90 put this check ABOVE the profile gates on purpose: "so the reason given is
    // the real one, not 'set your care preferences'". Extracting the gates in v1.106.24 moved
    // it below them, which is invisible in a status code — both are 403 — and only shows up
    // as a confusing message. Pinned so the next extraction cannot quietly undo it.
    const own = await h.createUser({ roles: ["caregiver", "family"], firstName: "Order", lastName: "ITest" });
    const p2 = uuid();
    await db.prepare(`
      INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_background_checked, created_at)
      VALUES (?, ?, 25, 1, NOW())
    `).run(p2, own.user.id);   // deliberately NO care_stoplight / care_preferences
    const id = await makeSession({ familyUserId: own.user.id, offeredTo: p2 });

    const res = await claim(id, own.token);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/posted yourself/i);
    expect(res.body.error).not.toMatch(/care preferences/i);
  });

  test("a cancelled session is not claimable", async () => {
    const id = await makeSession({ status: "cancelled" });
    const res = await claim(id);
    expect(res.status).toBe(400);
  });

  test("a session that does not exist is a 404, not a crash", async () => {
    const res = await claim(uuid());
    expect(res.status).toBe(404);
  });
});

describe("accepting a recurring series", () => {
  let groupId, ids;

  const series = (n = 4) => {
    groupId = uuid();
    return Promise.all(
      Array.from({ length: n }, (_, i) => makeSession({ groupId, date: soon(7 + i * 7) }))
    ).then((made) => { ids = made; return made; });
  };

  const claimSeries = (sessionIds, token = caregiver.token) =>
    h.request.put(`/api/sessions/recurring/${groupId}/claim`).set(h.auth(token)).send({ sessionIds });

  const rows = () => db.prepare(
    "SELECT id, status, caregiver_id, offered_to_caregiver_id, exclusive_until FROM care_sessions WHERE recurrence_group_id = ? ORDER BY scheduled_date"
  ).all(groupId);

  test("accepting every date confirms every one of them", async () => {
    await series(4);
    const res = await claimSeries(ids);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ claimed: 4, released: 0 });

    for (const r of await rows()) {
      expect(r.status).toBe("confirmed");
      expect(r.caregiver_id).toBe(profileId);
    }
  });

  test("accepting a subset confirms those and releases the rest to the open pool", async () => {
    await series(4);
    const picked = [ids[0], ids[2]];
    const res = await claimSeries(picked);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ claimed: 2, released: 2 });

    const byId = Object.fromEntries((await rows()).map((r) => [r.id, r]));
    for (const id of picked) {
      expect(byId[id].status).toBe("confirmed");
      expect(byId[id].caregiver_id).toBe(profileId);
    }
    for (const id of [ids[1], ids[3]]) {
      // Released, not left dangling under her name until the window lapses — the family
      // needs those days covered and the clock to find someone starts now.
      expect(byId[id].status).toBe("open");
      expect(byId[id].caregiver_id).toBeNull();
      expect(byId[id].offered_to_caregiver_id).toBeNull();
      expect(byId[id].exclusive_until).toBeNull();
    }
  });

  test("a visit taken BEFORE she taps is refused by the stale-list check, nothing moves", async () => {
    await series(4);
    // Someone claims the third one in between her seeing the card and tapping Accept.
    const other = uuid();
    await db.prepare(`
      INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())
    `).run(other, (await h.createUser({ roles: ["caregiver"] })).user.id);
    await db.prepare("UPDATE care_sessions SET status = 'confirmed', caregiver_id = ? WHERE id = ?")
      .run(other, ids[2]);

    const res = await claimSeries(ids);
    expect(res.status).toBe(409);

    // The decisive assertion: nothing moved. A family told "the month is covered" when only
    // three of four are is worse off than a family told to try again.
    const byId = Object.fromEntries((await rows()).map((r) => [r.id, r]));
    for (const id of [ids[0], ids[1], ids[3]]) {
      expect(byId[id].status).toBe("open");
      expect(byId[id].caregiver_id).toBeNull();
    }
    expect(byId[ids[2]].caregiver_id).toBe(other);
  });

  test("it creates the assignment once, not once per visit", async () => {
    await series(3);
    await claimSeries(ids).expect(200);
    const n = await db.prepare(`
      SELECT COUNT(*)::int AS c FROM caregiver_assignments
      WHERE caregiver_profile_id = ? AND care_recipient_id = ?
    `).get(profileId, recipientId);
    expect(n.c).toBe(1);
  });

  test("an empty pick is refused rather than silently releasing the whole series", async () => {
    await series(3);
    const res = await claimSeries([]);
    expect(res.status).toBe(400);
    for (const r of await rows()) expect(r.status).toBe("open");
  });

  test("a date from a different series is refused", async () => {
    await series(3);
    const stranger = await makeSession({ groupId: uuid() });
    const res = await claimSeries([ids[0], stranger]);
    expect(res.status).toBe(409);
    expect(res.body.unavailable).toContain(stranger);
    for (const r of await rows()) expect(r.status).toBe("open");
  });

  test("a series not offered to her is refused", async () => {
    groupId = uuid();
    const notHers = await makeSession({ groupId, offeredTo: null });
    const res = await claimSeries([notHers]);
    expect(res.status).toBe(409);
    expect((await statusOf(notHers)).status).toBe("open");
  });

  test("every gate that guards one claim guards the series too", async () => {
    await series(3);
    await db.prepare("UPDATE caregiver_profiles SET account_paused = 1 WHERE id = ?").run(profileId);
    const paused = await claimSeries(ids);
    expect(paused.status).toBe(403);
    expect(paused.body.error).toMatch(/paused/i);
    await resetProfile();

    await db.prepare("UPDATE caregiver_profiles SET is_background_checked = 0 WHERE id = ?").run(profileId);
    const unchecked = await claimSeries(ids);
    expect(unchecked.status).toBe(403);
    expect(unchecked.body.error).toMatch(/background check/i);
    await resetProfile();

    const family_ = await claimSeries(ids, family.token);
    expect(family_.status).toBe(403);

    // Nothing moved under any of them.
    for (const r of await rows()) expect(r.status).toBe("open");
  });

  test("an unknown group is a 404", async () => {
    groupId = uuid();
    const res = await claimSeries([uuid()]);
    expect(res.status).toBe(404);
  });

  test("duplicate ids in the request are collapsed, not counted twice", async () => {
    await series(2);
    const res = await claimSeries([ids[0], ids[0], ids[1]]);
    expect(res.status).toBe(200);
    expect(res.body.claimed).toBe(2);
  });
});

describe("applySeriesClaim — what happens when a write loses", () => {
  // The route-level tests above prove the stale-list check: a visit that was already gone
  // when she loaded the card. They cannot prove the narrower case, a visit taken between the
  // route's read and its write, because staging that interleaving through HTTP needs a
  // trigger and the trigger deadlocks the pool. Calling the transaction directly makes the
  // losing state trivial to arrange, so this is where atomicity is actually asserted.
  const { applySeriesClaim } = require("../../src/utils/seriesClaim");
  const { v4: uuid4 } = require("uuid");

  let groupId;
  const three = async () => {
    groupId = uuid4();
    return Promise.all([0, 1, 2].map((i) => makeSession({ groupId, date: soon(30 + i * 7) })));
  };
  const rows = () => db.prepare(
    "SELECT id, status, caregiver_id, offered_to_caregiver_id FROM care_sessions WHERE recurrence_group_id = ? ORDER BY scheduled_date"
  ).all(groupId);

  test("all three confirm when nothing is contended", async () => {
    const ids = await three();
    await applySeriesClaim(db, { caregiverProfileId: profileId, confirmIds: ids });
    for (const r of await rows()) {
      expect(r.status).toBe("confirmed");
      expect(r.caregiver_id).toBe(profileId);
    }
  });

  test("a visit taken first makes the whole claim throw 409", async () => {
    const ids = await three();
    await db.prepare("UPDATE care_sessions SET status = 'confirmed' WHERE id = ?").run(ids[1]);

    await expect(
      applySeriesClaim(db, { caregiverProfileId: profileId, confirmIds: ids })
    ).rejects.toMatchObject({ status: 409 });
  });

  test("...and the visit it had ALREADY confirmed is rolled back", async () => {
    // This is the assertion the whole extraction exists for. ids[0] is written successfully
    // inside the transaction before ids[1] fails. If the transaction did not unwind, she
    // would hold one visit of a series she was told she did not get.
    const ids = await three();
    await db.prepare("UPDATE care_sessions SET status = 'confirmed' WHERE id = ?").run(ids[1]);

    await expect(
      applySeriesClaim(db, { caregiverProfileId: profileId, confirmIds: ids })
    ).rejects.toMatchObject({ status: 409 });

    const byId = Object.fromEntries((await rows()).map((r) => [r.id, r]));
    expect(byId[ids[0]].status).toBe("open");
    expect(byId[ids[0]].caregiver_id).toBeNull();
    expect(byId[ids[2]].status).toBe("open");
  });

  test("a lost confirm also rolls back the releases", async () => {
    // Releases run after the confirms, but a failure in the confirm loop must leave the
    // declined dates alone too — otherwise a failed accept silently strips the family's
    // caregiver off dates she never declined.
    const ids = await three();
    await db.prepare("UPDATE care_sessions SET status = 'confirmed' WHERE id = ?").run(ids[1]);

    await expect(
      applySeriesClaim(db, {
        caregiverProfileId: profileId,
        confirmIds: [ids[0], ids[1]],
        releaseIds: [ids[2]],
      })
    ).rejects.toMatchObject({ status: 409 });

    const byId = Object.fromEntries((await rows()).map((r) => [r.id, r]));
    expect(byId[ids[2]].offered_to_caregiver_id).toBe(profileId);
  });

  test("releases clear the offer and the timer together", async () => {
    const ids = await three();
    await applySeriesClaim(db, {
      caregiverProfileId: profileId,
      confirmIds: [ids[0]],
      releaseIds: [ids[1], ids[2]],
    });
    const byId = Object.fromEntries((await rows()).map((r) => [r.id, r]));
    expect(byId[ids[0]].status).toBe("confirmed");
    for (const id of [ids[1], ids[2]]) {
      expect(byId[id].status).toBe("open");
      expect(byId[id].offered_to_caregiver_id).toBeNull();
    }
  });
});
