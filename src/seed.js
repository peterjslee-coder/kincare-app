/**
 * InPlace — Seed Script
 * Populates the database with realistic demo data
 * Run with: npm run seed
 */
require("dotenv").config();

const bcrypt = require("bcryptjs");
const { v4: uuid } = require("uuid");
const { initializeDatabase, getDb } = require("./models/database");

// Bump this whenever seed data changes — triggers auto-reseed on deploy
const DEMO_SEED_VERSION = '1.100.0'; // bumped: Barbara demo care events (v1.100.0)

async function seed({ force = false, demoOnly = false } = {}) {
  console.log("🌱 Seeding InPlace database...\n");

  await initializeDatabase();

  // Run the ENTIRE seed inside one transaction so the demo can never be left
  // half-wiped: if anything throws, Postgres rolls the whole thing back and the
  // previous working demo stays exactly as it was. (This is the fallback Pete
  // asked for — a failed reseed reverts instead of nuking the demo.)
  const _pool = await getDb();
  await _pool.transaction(async (db) => {
  // Savepoint-guarded runner for the few deletes we intentionally allow to fail
  // (missing optional tables, trial-and-error FK ordering). Inside a transaction
  // an unguarded error would abort EVERYTHING after it, so each such attempt gets
  // its own savepoint and only that attempt rolls back on error.
  const trySavepoint = async (fn) => {
    await db.exec('SAVEPOINT sp');
    try { await fn(); await db.exec('RELEASE SAVEPOINT sp'); }
    catch (e) { await db.exec('ROLLBACK TO SAVEPOINT sp'); }
  };

  if (demoOnly) {
    // ─── OPTION B: Demo-only reseed ───
    // Only delete records belonging to demo users, then re-insert demo data.
    // Real user data is NEVER touched.
    console.log("🛡️  Demo-only mode: preserving all real user data\n");

    // Get all demo user IDs so we can surgically delete their related records
    const demoUsers = await db.prepare("SELECT id FROM users WHERE is_demo = 1").all();
    const demoIds = demoUsers.map(u => u.id);

    if (demoIds.length > 0) {
      // Build a parameterized IN clause
      const placeholders = demoIds.map(() => '?').join(',');

      // Delete in FK-safe order (children before parents)
      // Tables that reference user IDs directly or transitively
      await db.prepare(`DELETE FROM trusted_devices WHERE user_id IN (${placeholders})`).run(...demoIds);
      await db.prepare(`DELETE FROM user_2fa WHERE user_id IN (${placeholders})`).run(...demoIds);
      await db.prepare(`DELETE FROM oauth_accounts WHERE user_id IN (${placeholders})`).run(...demoIds);
      await db.prepare(`DELETE FROM push_subscriptions WHERE user_id IN (${placeholders})`).run(...demoIds);
      await db.prepare(`DELETE FROM password_reset_tokens WHERE user_id IN (${placeholders})`).run(...demoIds);
      await db.prepare(`DELETE FROM email_verification_tokens WHERE user_id IN (${placeholders})`).run(...demoIds);
      await db.prepare(`DELETE FROM platform_invites WHERE invited_by IN (${placeholders})`).run(...demoIds);
      await db.prepare(`DELETE FROM feedback WHERE user_id IN (${placeholders})`).run(...demoIds);
      await db.prepare(`DELETE FROM onboarding_events WHERE user_id IN (${placeholders})`).run(...demoIds);

      // Activity feed, notes, visit data
      await db.prepare(`DELETE FROM activity_feed WHERE family_user_id IN (${placeholders})`).run(...demoIds);
      await db.prepare(`DELETE FROM recipient_notes WHERE author_id IN (${placeholders})`).run(...demoIds);

      // Background check payments
      await db.prepare(`DELETE FROM background_check_payments WHERE user_id IN (${placeholders})`).run(...demoIds);

      // Care sessions and their children (visit_logs → visit_photos, session_offers)
      const demoSessions = await db.prepare(
        `SELECT id FROM care_sessions WHERE family_user_id IN (${placeholders}) OR caregiver_id IN (${placeholders})`
      ).all(...demoIds, ...demoIds);
      const sessionIds = demoSessions.map(s => s.id);
      if (sessionIds.length > 0) {
        const sp = sessionIds.map(() => '?').join(',');
        await db.prepare(`DELETE FROM visit_photos WHERE visit_log_id IN (SELECT id FROM visit_logs WHERE session_id IN (${sp}))`).run(...sessionIds);
        await db.prepare(`DELETE FROM visit_logs WHERE session_id IN (${sp})`).run(...sessionIds);
        await db.prepare(`DELETE FROM session_offers WHERE session_id IN (${sp})`).run(...sessionIds);
        await db.prepare(`DELETE FROM reviews WHERE session_id IN (${sp})`).run(...sessionIds);
        await db.prepare(`DELETE FROM payments WHERE session_id IN (${sp})`).run(...sessionIds);
        await db.prepare(`DELETE FROM care_sessions WHERE id IN (${sp})`).run(...sessionIds);
      }

      // Messages and conversations involving demo users.
      // Delete every conversation a demo user created OR is a member of, along
      // with its messages and members. Deleting conversations by id (not just the
      // old orphan-only cleanup) guarantees no conversation with a demo `created_by`
      // survives to block the `DELETE FROM users` below (conversations.created_by
      // has an FK to users(id) that previously crashed the demo-only reseed).
      await db.prepare(`DELETE FROM messages WHERE sender_id IN (${placeholders}) OR recipient_id IN (${placeholders})`).run(...demoIds, ...demoIds);
      const demoConvoRows = await db.prepare(
        `SELECT id FROM conversations WHERE created_by IN (${placeholders})
         UNION
         SELECT conversation_id AS id FROM conversation_members WHERE user_id IN (${placeholders})`
      ).all(...demoIds, ...demoIds);
      const demoConvoIds = [...new Set(demoConvoRows.map(r => r.id).filter(Boolean))];
      if (demoConvoIds.length > 0) {
        const cvp = demoConvoIds.map(() => '?').join(',');
        await db.prepare(`DELETE FROM messages WHERE conversation_id IN (${cvp})`).run(...demoConvoIds);
        await db.prepare(`DELETE FROM conversation_members WHERE conversation_id IN (${cvp})`).run(...demoConvoIds);
        await db.prepare(`DELETE FROM conversations WHERE id IN (${cvp})`).run(...demoConvoIds);
      }
      // Belt-and-suspenders: clear any remaining demo memberships / demo-created convos
      await db.prepare(`DELETE FROM conversation_members WHERE user_id IN (${placeholders})`).run(...demoIds);
      await db.prepare(`DELETE FROM conversations WHERE created_by IN (${placeholders})`).run(...demoIds);

      // Care teams created by demo users
      const demoTeams = await db.prepare(`SELECT id FROM care_teams WHERE created_by IN (${placeholders})`).all(...demoIds);
      const teamIds = demoTeams.map(t => t.id);
      if (teamIds.length > 0) {
        const tp = teamIds.map(() => '?').join(',');
        await db.prepare(`DELETE FROM care_team_invites WHERE care_team_id IN (${tp})`).run(...teamIds);
        await db.prepare(`DELETE FROM care_team_members WHERE care_team_id IN (${tp})`).run(...teamIds);
        await db.prepare(`DELETE FROM care_teams WHERE id IN (${tp})`).run(...teamIds);
      }

      // Caregiver assignments and shares
      await db.prepare(`DELETE FROM caregiver_assignments WHERE family_user_id IN (${placeholders}) OR caregiver_profile_id IN (SELECT id FROM caregiver_profiles WHERE user_id IN (${placeholders}))`).run(...demoIds, ...demoIds);
      await db.prepare(`DELETE FROM care_recipient_shares WHERE shared_by_user_id IN (${placeholders}) OR shared_with_user_id IN (${placeholders})`).run(...demoIds, ...demoIds);

      // Availability and caregiver profiles
      await db.prepare(`DELETE FROM availability WHERE caregiver_id IN (SELECT id FROM caregiver_profiles WHERE user_id IN (${placeholders}))`).run(...demoIds);
      await db.prepare(`DELETE FROM caregiver_documents WHERE user_id IN (${placeholders})`).run(...demoIds);
      await db.prepare(`DELETE FROM caregiver_profiles WHERE user_id IN (${placeholders})`).run(...demoIds);

      // Consent & authorization records tied to demo care recipients
      const demoCrIds = (await db.prepare(`SELECT id FROM care_recipients WHERE family_user_id IN (${placeholders})`).all(...demoIds)).map(r => r.id);
      if (demoCrIds.length > 0) {
        const crp = demoCrIds.map(() => '?').join(',');
        await trySavepoint(() => db.prepare(`DELETE FROM first_visit_confirmations WHERE care_recipient_id IN (${crp})`).run(...demoCrIds));
        await trySavepoint(() => db.prepare(`DELETE FROM verification_attempts WHERE care_recipient_id IN (${crp})`).run(...demoCrIds));
        await trySavepoint(() => db.prepare(`DELETE FROM attestations WHERE care_recipient_id IN (${crp})`).run(...demoCrIds));
        await trySavepoint(() => db.prepare(`DELETE FROM authorization_documents WHERE care_recipient_id IN (${crp})`).run(...demoCrIds));
        // v1.99.1 — Care Tasks tables reference care_recipients AND users
        // (created_by / assigned_user_id / recorded_by / completed_by_user_id);
        // without these deletes the recipient + user deletes below FK-fail.
        await trySavepoint(() => db.prepare(`DELETE FROM care_task_occurrences WHERE task_id IN (SELECT id FROM care_tasks WHERE care_recipient_id IN (${crp}))`).run(...demoCrIds));
        await trySavepoint(() => db.prepare(`DELETE FROM care_tasks WHERE care_recipient_id IN (${crp})`).run(...demoCrIds));
        await trySavepoint(() => db.prepare(`DELETE FROM care_task_helpers WHERE care_recipient_id IN (${crp})`).run(...demoCrIds));
        // v1.100.0 — Care Events references care_recipients + users (created_by)
        await trySavepoint(() => db.prepare(`DELETE FROM care_events WHERE care_recipient_id IN (${crp})`).run(...demoCrIds));
      }

      // Care recipients owned by demo family users
      await db.prepare(`DELETE FROM care_recipients WHERE family_user_id IN (${placeholders})`).run(...demoIds);

      // ─── Final FK sweep ───
      // Any table with a column referencing users(id) will block the delete below
      // if it still has a row pointing at a demo user. Beyond the content tables
      // handled above, demoing the accounts creates runtime rows (refresh_tokens,
      // user_passkeys, connections, payout_preferences, ...). Discover every such
      // FK column dynamically from the catalog so a newly-added table can never
      // silently break the demo-only reseed again. Table/column names come from
      // information_schema (trusted), not user input.
      try {
        const fkCols = await db.prepare(`
          SELECT tc.table_name, kcu.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
          JOIN information_schema.constraint_column_usage ccu
            ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY'
            AND ccu.table_name = 'users' AND ccu.column_name = 'id'
        `).all();
        // Several passes so child→parent ordering among these tables resolves.
        for (let pass = 0; pass < 3; pass++) {
          for (const fk of fkCols) {
            await trySavepoint(() => db.prepare(`DELETE FROM ${fk.table_name} WHERE ${fk.column_name} IN (${placeholders})`).run(...demoIds));
          }
        }
      } catch (sweepErr) {
        console.warn("  ⚠️  FK sweep skipped:", sweepErr.message);
      }

      // Finally, delete the demo users themselves
      await db.prepare(`DELETE FROM users WHERE is_demo = 1`).run();

      console.log(`🗑️  Cleaned ${demoIds.length} demo users and all their related records`);
    } else {
      console.log("  No existing demo users to clean");
    }

    // Clear demo waitlist entries (waitlist has no user FK, just clear demo seed marker)
    await db.prepare("DELETE FROM waitlist WHERE email LIKE '%@inplace.care' OR email = '_seed_version@inplace.internal'").run();

  } else {
    // ─── Full wipe mode (original behavior) ───
    // SAFETY CHECK: Refuse to wipe if real (non-demo) users exist, unless --force
    try {
      const realUsers = await db.prepare(
        "SELECT COUNT(*) as count FROM users WHERE is_demo = 0 OR is_demo IS NULL"
      ).get();
      const realCount = parseInt(realUsers?.count || 0);
      if (realCount > 0 && !force) {
        const msg = `🛑 SEED ABORTED: ${realCount} real (non-demo) user(s) found in database.\n` +
          `   This would permanently destroy their data.\n` +
          `   To force: npm run seed -- --force\n` +
          `   Or call seed({ force: true }) programmatically.`;
        console.error(msg);
        throw new Error(`Seed aborted: ${realCount} real users exist. Use --force to override.`);
      }
    } catch (err) {
      // If the users table doesn't exist yet, that's fine — first run
      if (err.message.includes("real users exist")) throw err;
      console.log("  (No existing users table — fresh database)");
    }

    // Clear ALL data in one shot — TRUNCATE CASCADE handles FK order automatically
    await db.exec(`TRUNCATE
      trusted_devices, user_2fa, oauth_accounts,
      conversation_members, conversations,
      care_team_invites, care_team_members, care_teams,
      care_recipient_shares, push_subscriptions,
      caregiver_assignments, recipient_notes, messages,
      visit_photos, visit_logs, activity_feed, reviews,
      payments, care_sessions, availability,
      caregiver_documents, platform_invites,
      password_reset_tokens, email_verification_tokens,
      caregiver_profiles, care_recipients, users, waitlist
    CASCADE`);
  }

  // ─── Users ───
  const passwordHash = await bcrypt.hash("inplace123", 10);

  const peteId = uuid();
  const mariaUserId = uuid();
  const jamesUserId = uuid();
  const sarahUserId = uuid();
  const davidUserId = uuid();
  const bettyUserId = uuid();

  // Family user (Paul — Care Team primary, DEMO)
  await db.prepare(`
    INSERT INTO users (id, email, password_hash, role, roles, first_name, last_name, phone, is_demo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(peteId, "paul@inplace.care", passwordHash, "family", '["family"]', "Paul", "Lowe", "(626) 555-0142");

  // Caregiver users
  const caregiverUsers = [
    [mariaUserId, "maria@inplace.care", "Maria", "Santos", "(540) 555-0201"],
    [jamesUserId, "james@inplace.care", "James", "Okafor", "(540) 555-0202"],
    [sarahUserId, "sarah@inplace.care", "Sarah", "Chen", "(540) 555-0203"],
    [davidUserId, "david@inplace.care", "David", "Kim", "(540) 555-0204"],
  ];

  // Maria gets dual role (caregiver + family) — she also cares for her brother
  await db.prepare(`
    INSERT INTO users (id, email, password_hash, role, roles, first_name, last_name, phone, is_demo)
    VALUES (?, ?, ?, 'caregiver', '["caregiver","family"]', ?, ?, ?, 1)
  `).run(mariaUserId, "maria@inplace.care", passwordHash, "Maria", "Santos", "(540) 555-0201");

  // Other caregivers (single role)
  const otherCaregiverUsers = [
    [jamesUserId, "james@inplace.care", "James", "Okafor", "(540) 555-0202"],
    [sarahUserId, "sarah@inplace.care", "Sarah", "Chen", "(540) 555-0203"],
    [davidUserId, "david@inplace.care", "David", "Kim", "(540) 555-0204"],
  ];

  for (const [id, email, first, last, phone] of otherCaregiverUsers) {
    await db.prepare(`
      INSERT INTO users (id, email, password_hash, role, roles, first_name, last_name, phone, is_demo)
      VALUES (?, ?, ?, 'caregiver', '["caregiver"]', ?, ?, ?, 1)
    `).run(id, email, passwordHash, first, last, phone);
  }

  // Cared-For user (Barbara — limited access, controlled by Paul, DEMO)
  await db.prepare(`
    INSERT INTO users (id, email, password_hash, role, roles, first_name, last_name, phone, is_demo)
    VALUES (?, ?, ?, 'care_for', '["care_for"]', ?, ?, ?, 1)
  `).run(bettyUserId, "barbara@inplace.care", passwordHash, "Barbara", "Lowe", "(540) 555-0100");

  // Sibling family users (Paul's siblings who also coordinate Barbara's care)
  const davidLeeId = uuid();
  const susanLeeId = uuid();

  await db.prepare(`
    INSERT INTO users (id, email, password_hash, role, roles, first_name, last_name, phone, is_demo)
    VALUES (?, ?, ?, 'family', '["family"]', ?, ?, ?, 1)
  `).run(davidLeeId, "david.lowe@inplace.care", passwordHash, "David", "Lowe", "(626) 555-0143");

  await db.prepare(`
    INSERT INTO users (id, email, password_hash, role, roles, first_name, last_name, phone, is_demo)
    VALUES (?, ?, ?, 'family', '["family"]', ?, ?, ?, 1)
  `).run(susanLeeId, "susan.lowe@inplace.care", passwordHash, "Susan", "Lowe", "(626) 555-0144");

  // ─── Real admin account (Pete's actual login) ───
  // In demoOnly mode, the real account already exists — don't re-insert
  let realPeteId;
  if (demoOnly) {
    const existing = await db.prepare("SELECT id FROM users WHERE email = 'peterjslee@gmail.com'").get();
    realPeteId = existing?.id || uuid();
    if (!existing) {
      // Real account somehow missing — re-create it
      await db.prepare(`
        INSERT INTO users (id, email, password_hash, role, roles, first_name, last_name, phone, is_demo, is_admin, email_verified)
        VALUES (?, ?, ?, 'family', '["family"]', ?, ?, ?, 0, 1, 1)
      `).run(realPeteId, "peterjslee@gmail.com", passwordHash, "Pete", "Lee", "(626) 555-0142");
    }
    console.log("✅ Demo users created (9 — Paul, David, Susan, 4 caregivers, Barbara, 2 families). Real admin preserved.");
  } else {
    realPeteId = uuid();
    await db.prepare(`
      INSERT INTO users (id, email, password_hash, role, roles, first_name, last_name, phone, is_demo, is_admin, email_verified)
      VALUES (?, ?, ?, 'family', '["family"]', ?, ?, ?, 0, 1, 1)
    `).run(realPeteId, "peterjslee@gmail.com", passwordHash, "Pete", "Lee", "(626) 555-0142");
    console.log("✅ Users created (10 — Pete real + Paul demo, David, Susan, 4 caregivers, Barbara)");
  }

  // ─── Additional Family Users (Maria's other clients) ───
  const hendersonFamilyId = uuid();
  const patelFamilyId = uuid();

  await db.prepare(`
    INSERT INTO users (id, email, password_hash, role, roles, first_name, last_name, phone, is_demo)
    VALUES (?, ?, ?, 'family', '["family"]', ?, ?, ?, 1)
  `).run(hendersonFamilyId, "linda@inplace.care", passwordHash, "Linda", "Henderson", "(540) 555-0301");

  await db.prepare(`
    INSERT INTO users (id, email, password_hash, role, roles, first_name, last_name, phone, is_demo)
    VALUES (?, ?, ?, 'family', '["family"]', ?, ?, ?, 1)
  `).run(patelFamilyId, "raj@inplace.care", passwordHash, "Raj", "Patel", "(540) 555-0302");

  console.log("✅ Additional family users created (2 — Henderson, Patel)");

  // ─── Care Recipient (Barbara — Paul's mother, DEMO) ───
  const bettyId = uuid();
  await db.prepare(`
    INSERT INTO care_recipients
    (id, family_user_id, first_name, last_name, age,
     location_address, location_city, location_state, location_zip,
     latitude, longitude,
     health_conditions, medications, preferences,
     emergency_contact_name, emergency_contact_phone,
     pets, pet_allergies, food_allergies, medical_conditions,
     linked_user_id, permission_tier,
     authorization_tier, consent_status, consent_method, consent_verified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
  `).run(
    bettyId, peteId, "Barbara", "Lowe", 78,
    "123 Main Street", "Blacksburg", "VA", "24060",
    37.2296, -80.4139,
    JSON.stringify(["Early-stage dementia (diagnosed 2024)", "Mild arthritis — both knees", "High blood pressure (controlled)", "Occasional vertigo when standing quickly", "Poor hearing in left ear — wears hearing aid"]),
    JSON.stringify(["Donepezil 10mg daily (evening)", "Lisinopril 10mg daily (morning)", "Ibuprofen 200mg PRN for knee pain", "Calcium + Vitamin D supplement", "Baby aspirin 81mg daily"]),
    "Prefers female caregivers. Loves gardening and old movies (especially Hitchcock). Needs gentle reminders for meals and medications. Likes her tea with honey, no sugar. Enjoys puzzles and crosswords in the afternoon.",
    "Paul Lowe", "(626) 555-0142",
    "2 cats — Whiskers (orange tabby, indoor, friendly, 8 yrs) and Mittens (calico, indoor, shy with strangers, 5 yrs)",
    "None known",
    JSON.stringify(["Peanuts (severe — carries EpiPen)", "Shellfish (mild — causes hives)"]),
    "Early-stage dementia, mild arthritis (both knees), high blood pressure (controlled), occasional vertigo, poor hearing left ear (hearing aid)",
    bettyUserId, "full",
    "tier1", "verified", "self_signup"
  );

  // ─── Care Recipient (Dorothy Henderson — Linda's mother) ───
  const dorothyId = uuid();
  await db.prepare(`
    INSERT INTO care_recipients
    (id, family_user_id, first_name, last_name, age,
     location_address, location_city, location_state, location_zip,
     latitude, longitude,
     health_conditions, medications, preferences,
     emergency_contact_name, emergency_contact_phone,
     pets, pet_allergies, food_allergies, medical_conditions,
     authorization_tier, consent_status, consent_method, consent_verified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
  `).run(
    dorothyId, hendersonFamilyId, "Dorothy", "Henderson", 82,
    "456 Oak Avenue", "Blacksburg", "VA", "24060",
    37.2340, -80.4180,
    JSON.stringify(["Type 2 diabetes", "Hearing loss"]),
    JSON.stringify(["Metformin 500mg", "Lisinopril 10mg"]),
    "Hard of hearing — speak clearly and face her. Enjoys card games and baking.",
    "Linda Henderson", "(540) 555-0301",
    "No pets",
    "Allergic to cats (sneezing, watery eyes)",
    "Gluten sensitivity — avoid wheat-based breads",
    "Type 2 diabetes, hearing loss (wears hearing aids)",
    "tier3", "verified", "legacy_account"
  );

  // ─── Care Recipient (Arun Patel — Raj's father) ───
  const arunId = uuid();
  await db.prepare(`
    INSERT INTO care_recipients
    (id, family_user_id, first_name, last_name, age,
     location_address, location_city, location_state, location_zip,
     latitude, longitude,
     health_conditions, medications, preferences,
     emergency_contact_name, emergency_contact_phone,
     pets, pet_allergies, food_allergies, medical_conditions,
     authorization_tier, consent_status, consent_method, consent_verified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
  `).run(
    arunId, patelFamilyId, "Arun", "Patel", 75,
    "789 Elm Street", "Christiansburg", "VA", "24073",
    37.1310, -80.4095,
    JSON.stringify(["Parkinson's disease", "Mild depression"]),
    JSON.stringify(["Levodopa 100mg", "Sertraline 50mg"]),
    "Enjoys chess and classical music. Needs help with fine motor tasks. Very independent — let him try first.",
    "Raj Patel", "(540) 555-0302",
    "1 small dog (Kavi — miniature poodle, very calm)",
    "None",
    "Lactose intolerant — use dairy-free alternatives",
    "Parkinson's disease (early stage), mild depression, occasional hand tremors",
    "tier3", "verified", "legacy_account"
  );

  // ─── Care Recipient (Carlos Santos — Maria's brother, TBI recovery) ───
  const carlosId = uuid();
  await db.prepare(`
    INSERT INTO care_recipients
    (id, family_user_id, first_name, last_name, age,
     location_address, location_city, location_state, location_zip,
     latitude, longitude,
     health_conditions, medications, preferences,
     emergency_contact_name, emergency_contact_phone,
     pets, pet_allergies, food_allergies, medical_conditions,
     authorization_tier, consent_status, consent_method, consent_verified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
  `).run(
    carlosId, mariaUserId, "Carlos", "Santos", 34,
    "215 College Avenue", "Blacksburg", "VA", "24060",
    37.2285, -80.4155,
    JSON.stringify(["Traumatic brain injury — recovery phase (6 months post-accident)", "Short-term memory difficulties", "Mild left-side weakness", "Anxiety in crowded environments"]),
    JSON.stringify(["Sertraline 50mg daily (morning)", "Gabapentin 300mg twice daily", "Melatonin 5mg at bedtime"]),
    "Needs patient, calm communication. Prefers structured routines — write schedule on the whiteboard each morning. Loves soccer (watching, not playing yet). Music helps him focus — has a Spotify playlist. No sudden loud noises please.",
    "Maria Santos", "(540) 555-0201",
    "1 dog — Luna (golden retriever, therapy dog, very gentle, 3 yrs)",
    "None known",
    JSON.stringify(["Dairy (moderate — causes stomach cramps)"]),
    "Traumatic brain injury (recovery), short-term memory issues, mild left-side weakness, anxiety",
    "tier3", "verified", "legacy_account"
  );

  // David and Susan share Paul's Barbara record via care_recipient_shares (no duplicate care_recipient rows)

  console.log("✅ Care recipients created (4 — Barbara, Dorothy, Arun, Carlos)");

  // ─── Caregiver Profiles ───
  const mariaId = uuid();
  const jamesId = uuid();
  const sarahId = uuid();
  const davidId = uuid();

  const profiles = [
    [mariaId, mariaUserId,
      "Certified dementia care specialist with 8 years of experience. Fluent in English and Spanish.",
      8, 34, ["Dementia Care", "Meal Prep"], ["CNA", "CPR/First Aid"], 1, 4.9, 127, "Blacksburg", "VA", 37.2300, -80.4145],
    [jamesId, jamesUserId,
      "Former social worker passionate about elder care. CPR/First Aid certified.",
      5, 25, ["Companionship", "Transportation"], ["CPR/First Aid", "Social Work License"], 1, 4.8, 93, "Blacksburg", "VA", 37.2310, -80.4160],
    [sarahId, sarahUserId,
      "Registered nurse turned home caregiver. Specializes in nutrition for seniors.",
      12, 32, ["Meal Prep", "Medication Reminders"], ["RN", "Nutrition Certificate", "CPR/First Aid"], 0, 4.9, 156, "Christiansburg", "VA", 37.1298, -80.4089],
    [davidId, davidUserId,
      "Reliable and patient. Great with seniors who need help with daily tasks.",
      3, 22, ["Errands", "Light Housekeeping"], ["CPR/First Aid"], 1, 4.7, 68, "Blacksburg", "VA", 37.2280, -80.4200],
  ];

  // v1.5.0 — Stoplight care preferences per caregiver
  const stoplights = {
    maria: {
      'Bathing / Showering': 'green', 'Toileting': 'green', 'Dressing': 'green',
      'Feeding / Meal Assistance': 'green', 'Medication Reminders': 'green',
      'Mobility / Transfer': 'green', 'Light Housekeeping': 'green', 'Laundry': 'green',
      'Meal Preparation': 'green', 'Grocery Shopping': 'green',
      'Transportation / Errands': 'green', 'Companionship': 'green',
      'Exercise / Physical Therapy': 'yellow', 'Wound Care': 'yellow',
      'Dementia / Memory Care': 'green', 'Hospice / End-of-Life': 'red',
    },
    james: {
      'Bathing / Showering': 'yellow', 'Toileting': 'yellow', 'Dressing': 'green',
      'Feeding / Meal Assistance': 'green', 'Medication Reminders': 'green',
      'Mobility / Transfer': 'green', 'Light Housekeeping': 'green', 'Laundry': 'green',
      'Meal Preparation': 'yellow', 'Grocery Shopping': 'green',
      'Transportation / Errands': 'green', 'Companionship': 'green',
      'Exercise / Physical Therapy': 'green', 'Wound Care': 'red',
      'Dementia / Memory Care': 'yellow', 'Hospice / End-of-Life': 'red',
    },
    sarah: {
      'Bathing / Showering': 'green', 'Toileting': 'green', 'Dressing': 'green',
      'Feeding / Meal Assistance': 'green', 'Medication Reminders': 'green',
      'Mobility / Transfer': 'green', 'Light Housekeeping': 'yellow', 'Laundry': 'yellow',
      'Meal Preparation': 'green', 'Grocery Shopping': 'green',
      'Transportation / Errands': 'yellow', 'Companionship': 'green',
      'Exercise / Physical Therapy': 'green', 'Wound Care': 'green',
      'Dementia / Memory Care': 'green', 'Hospice / End-of-Life': 'yellow',
    },
    david: {
      'Bathing / Showering': 'yellow', 'Toileting': 'red', 'Dressing': 'green',
      'Feeding / Meal Assistance': 'green', 'Medication Reminders': 'green',
      'Mobility / Transfer': 'green', 'Light Housekeeping': 'green', 'Laundry': 'green',
      'Meal Preparation': 'yellow', 'Grocery Shopping': 'green',
      'Transportation / Errands': 'green', 'Companionship': 'green',
      'Exercise / Physical Therapy': 'green', 'Wound Care': 'red',
      'Dementia / Memory Care': 'yellow', 'Hospice / End-of-Life': 'red',
    },
  };

  const workLocations = [
    "Blacksburg, VA 24060",   // Maria
    "Blacksburg, VA 24060",   // James
    "Christiansburg, VA 24073", // Sarah
    "Blacksburg, VA 24060",   // David
  ];
  const travelRadii = [15, 10, 25, 10]; // miles
  const stoplightKeys = ["maria", "james", "sarah", "david"];

  for (let i = 0; i < profiles.length; i++) {
    const [id, userId, bio, years, rate, specs, certs, avail, rating, count, city, state, lat, lng] = profiles[i];
    await db.prepare(`
      INSERT INTO caregiver_profiles
      (id, user_id, bio, years_experience, hourly_rate, specialties, certifications,
       is_background_checked, is_available, rating_avg, rating_count,
       location_city, location_state, latitude, longitude,
       work_location_address, max_travel_miles, care_stoplight,
       terms_accepted_at, terms_version,
       background_check_consent, background_check_consent_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, NOW() - INTERVAL '30 days', '1.0', 1, NOW() - INTERVAL '30 days')
    `).run(id, userId, bio, years, rate, JSON.stringify(specs), JSON.stringify(certs),
      avail, rating, count, city, state, lat, lng,
      workLocations[i], travelRadii[i], JSON.stringify(stoplights[stoplightKeys[i]]));
  }

  // Set avatars for all demo users (consistent placeholder photos via i.pravatar.cc)
  const avatarAssignments = [
    [mariaUserId, "https://i.pravatar.cc/150?u=maria@inplace.care"],
    [jamesUserId, "https://i.pravatar.cc/150?u=james@inplace.care"],
    [sarahUserId, "https://i.pravatar.cc/150?u=sarah@inplace.care"],
    [davidUserId, "https://i.pravatar.cc/150?u=david@inplace.care"],
    [peteId, "https://i.pravatar.cc/150?u=paul@inplace.care"],
    [bettyUserId, "https://i.pravatar.cc/150?u=barbara@inplace.care"],
    [davidLeeId, "https://i.pravatar.cc/150?u=david.lowe@inplace.care"],
    [susanLeeId, "https://i.pravatar.cc/150?u=susan.lowe@inplace.care"],
  ];
  for (const [userId, avatarUrl] of avatarAssignments) {
    await db.prepare(`UPDATE users SET avatar_url = ?, profile_photo = ? WHERE id = ?`).run(avatarUrl, avatarUrl, userId);
  }

  // Complete Maria's onboarding — she's the primary demo caregiver
  await db.prepare(`
    UPDATE caregiver_profiles SET
      onboarding_complete = 1,
      checkr_status = 'clear',
      legal_first_name = 'Maria',
      legal_last_name = 'Santos',
      date_of_birth = '1992-03-15',
      ssn_last4 = '4829',
      dl_number = 'S520-4829-0315',
      dl_state = 'VA'
    WHERE id = ?
  `).run(mariaId);

  // James partially complete (in progress)
  await db.prepare(`
    UPDATE caregiver_profiles SET
      checkr_status = 'pending',
      legal_first_name = 'James',
      legal_last_name = 'Okafor'
    WHERE id = ?
  `).run(jamesId);

  console.log("✅ Caregiver profiles created (4 — Maria fully onboarded, James partial)");

  // ─── Caregiver Assignments ───
  await db.prepare(`INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite) VALUES (?, ?, ?, ?, 1, 1)`).run(uuid(), bettyId, peteId, mariaId);
  await db.prepare(`INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite) VALUES (?, ?, ?, ?, 1, 0)`).run(uuid(), bettyId, peteId, jamesId);
  await db.prepare(`INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite) VALUES (?, ?, ?, ?, 1, 1)`).run(uuid(), dorothyId, hendersonFamilyId, mariaId);
  await db.prepare(`INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite) VALUES (?, ?, ?, ?, 1, 0)`).run(uuid(), dorothyId, hendersonFamilyId, sarahId);
  await db.prepare(`INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite) VALUES (?, ?, ?, ?, 1, 0)`).run(uuid(), arunId, patelFamilyId, jamesId);

  // Sibling assignments (David and Susan also have James for Barbara; Maria is already assigned via Paul's Barbara)
  await db.prepare(`INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite) VALUES (?, ?, ?, ?, 1, 0)`).run(uuid(), bettyId, davidLeeId, jamesId);
  await db.prepare(`INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite) VALUES (?, ?, ?, ?, 1, 0)`).run(uuid(), bettyId, susanLeeId, jamesId);

  // Maria also works with Arun Patel
  await db.prepare(`INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite) VALUES (?, ?, ?, ?, 1, 0)`).run(uuid(), arunId, patelFamilyId, mariaId);

  // Carlos (Maria's brother) — Sarah Chen helps with his care
  await db.prepare(`INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite) VALUES (?, ?, ?, ?, 1, 1)`).run(uuid(), carlosId, mariaUserId, sarahId);
  await db.prepare(`INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite) VALUES (?, ?, ?, ?, 1, 0)`).run(uuid(), carlosId, mariaUserId, jamesId);

  console.log("✅ Caregiver assignments created (10)");

  // ─── Availability Windows ───
  // Maria: Mon-Fri 8am-5pm available, Wed 2-4pm blocked
  for (let day = 1; day <= 5; day++) {
    await db.prepare(`
      INSERT INTO availability (id, caregiver_id, day_of_week, start_time, end_time, type)
      VALUES (?, ?, ?, '08:00', '17:00', 'available')
    `).run(uuid(), mariaId, day);
  }
  // Maria: blocked Wed 2-4pm (recurring)
  await db.prepare(`
    INSERT INTO availability (id, caregiver_id, day_of_week, start_time, end_time, type, note)
    VALUES (?, ?, 3, '14:00', '16:00', 'blocked', 'Personal appointment')
  `).run(uuid(), mariaId);

  // James: Mon-Fri 7am-3pm, Sat 8am-12pm
  for (let day = 1; day <= 5; day++) {
    await db.prepare(`
      INSERT INTO availability (id, caregiver_id, day_of_week, start_time, end_time, type)
      VALUES (?, ?, ?, '07:00', '15:00', 'available')
    `).run(uuid(), jamesId, day);
  }
  await db.prepare(`
    INSERT INTO availability (id, caregiver_id, day_of_week, start_time, end_time, type)
    VALUES (?, ?, 6, '08:00', '12:00', 'available')
  `).run(uuid(), jamesId);

  // David Kim: Mon-Fri 8am-5pm
  for (let day = 1; day <= 5; day++) {
    await db.prepare(`
      INSERT INTO availability (id, caregiver_id, day_of_week, start_time, end_time, type)
      VALUES (?, ?, ?, '08:00', '17:00', 'available')
    `).run(uuid(), davidId, day);
  }

  // Sarah Chen: Mon,Tue,Thu,Fri 9am-5pm (Wed off)
  for (const day of [1, 2, 4, 5]) {
    await db.prepare(`
      INSERT INTO availability (id, caregiver_id, day_of_week, start_time, end_time, type)
      VALUES (?, ?, ?, '09:00', '17:00', 'available')
    `).run(uuid(), sarahId, day);
  }

  // ─── Date helper — all demo dates are relative to today so they never go stale ───
  const _d = (daysFromNow) => {
    const dt = new Date(); dt.setDate(dt.getDate() + daysFromNow);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  };

  // One-off block: Maria blocked next Wed afternoon (specific date override)
  const nextWed = new Date(); nextWed.setDate(nextWed.getDate() + ((3 - nextWed.getDay() + 7) % 7 || 7));
  const nextWedStr = `${nextWed.getFullYear()}-${String(nextWed.getMonth() + 1).padStart(2, '0')}-${String(nextWed.getDate()).padStart(2, '0')}`;
  await db.prepare(`
    INSERT INTO availability (id, caregiver_id, day_of_week, start_time, end_time, is_recurring, specific_date, type, note)
    VALUES (?, ?, 3, '12:00', '17:00', 0, ?, 'blocked', 'Doctor appointment')
  `).run(uuid(), mariaId, nextWedStr);

  console.log("✅ Availability windows created (with types and blocked rules)");

  // ─── Care Sessions (Paul/Barbara) — Upcoming ───
  const sessions = [
    [uuid(), bettyId, peteId, mariaId, "meals", "confirmed", _d(1), "08:00", 5, "Meal prep for the week — Barbara's favorites.", 170],
    [uuid(), bettyId, peteId, jamesId, "companion", "confirmed", _d(2), "10:00", 3, "She loves looking at photo albums.", 75],
    [uuid(), bettyId, peteId, mariaId, "meals", "confirmed", _d(3), "08:00", 8, "Full day care — meal prep, companionship, light housekeeping.", 272],
    [uuid(), bettyId, peteId, mariaId, "rides", "pending", _d(5), "09:00", 2, "Doctor appointment at 9:30. Pickup prescriptions after.", 68],
    [uuid(), bettyId, peteId, sarahId, "companion", "pending", _d(7), "10:00", 3, "First visit with Sarah — introduce slowly, show photo albums.", 96],
    [uuid(), bettyId, peteId, jamesId, "rides", "confirmed", _d(9), "09:30", 1.5, "Follow-up appointment with Dr. Patel. Bring medication list.", 37],
    [uuid(), bettyId, peteId, mariaId, "meals", "confirmed", _d(11), "12:00", 5, "Prepare meals for the week and label with dates.", 170],
    [uuid(), bettyId, peteId, davidId, "companion", "pending", _d(14), "14:00", 2, "Afternoon gardening and light walk around the neighborhood.", 44],
  ];

  for (const [id, recipId, famId, cgId, type, status, date, time, hours, notes, cost] of sessions) {
    await db.prepare(`
      INSERT INTO care_sessions
      (id, care_recipient_id, family_user_id, caregiver_id, service_type,
       status, scheduled_date, scheduled_time, duration_hours,
       special_instructions, estimated_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, recipId, famId, cgId, type, status, date, time, hours, notes, cost);
  }

  // ─── Past Completed Sessions — Maria's ~$4K monthly earnings at $34/hr ───
  // ~18 sessions over Jan 20 – Feb 18 spanning Barbara, Dorothy, and Arun
  // One 8-hour full day with Barbara on Feb 12
  const pastSessions = [
    // Maria with Barbara (Paul's) — spread over past ~50 days
    [uuid(), bettyId, peteId, mariaId, "meals", "completed", _d(-50), "08:00", 6, "Full morning meal prep and lunch.", 204],
    [uuid(), bettyId, peteId, mariaId, "companion", "completed", _d(-48), "09:00", 5, "Companionship and afternoon activities.", 170],
    [uuid(), bettyId, peteId, mariaId, "meals", "completed", _d(-45), "08:00", 6, "Breakfast, lunch prep, medication reminders.", 204],
    [uuid(), bettyId, peteId, mariaId, "companion", "completed", _d(-42), "08:00", 7, "Full day care — walks, meals, photo albums.", 238],
    [uuid(), bettyId, peteId, mariaId, "meals", "completed", _d(-39), "08:00", 5, "Meal prep and grocery shopping.", 170],
    [uuid(), bettyId, peteId, mariaId, "companion", "completed", _d(-36), "09:00", 6, "Companionship, gardening, and lunch.", 204],
    [uuid(), bettyId, peteId, mariaId, "meals", "completed", _d(-33), "08:00", 6, "Weekly meal prep and medication organizing.", 204],
    [uuid(), bettyId, peteId, mariaId, "companion", "completed", _d(-30), "09:00", 5, "Photo albums, short walk, afternoon tea.", 170],
    [uuid(), bettyId, peteId, mariaId, "meals", "completed", _d(-27), "08:00", 7, "Extended meal prep and companionship.", 238],
    [uuid(), bettyId, peteId, mariaId, "companion", "completed", _d(-24), "08:00", 6, "Morning routine assistance and activities.", 204],
    [uuid(), bettyId, peteId, mariaId, "meals", "completed", _d(-21), "08:00", 8, "Full 8-hour day — meals, companionship, light housekeeping.", 272],
    [uuid(), bettyId, peteId, mariaId, "companion", "completed", _d(-18), "09:00", 5, "Special lunch and card making with Barbara.", 170],
    [uuid(), bettyId, peteId, mariaId, "meals", "completed", _d(-15), "08:00", 6, "Meal prep, medication check, organized kitchen.", 204],
    [uuid(), bettyId, peteId, mariaId, "rides", "completed", _d(-12), "09:00", 4, "Doctor appointment and grocery run.", 136],
    // Maria with Barbara (additional sessions for ~$4K monthly target)
    [uuid(), bettyId, peteId, mariaId, "companion", "completed", _d(-35), "09:00", 6, "Morning routine, puzzles, and lunch prep.", 204],
    [uuid(), bettyId, peteId, mariaId, "meals", "completed", _d(-29), "08:00", 7, "Grocery shopping, meal prep, and kitchen cleanup.", 238],
    [uuid(), bettyId, peteId, mariaId, "companion", "completed", _d(-25), "09:00", 6, "Photo albums, short walk, afternoon nap monitoring.", 204],
    [uuid(), bettyId, peteId, mariaId, "meals", "completed", _d(-22), "08:00", 6, "Meal prep and medication organizing.", 204],
    [uuid(), bettyId, peteId, mariaId, "companion", "completed", _d(-19), "09:00", 7, "Full day companionship — crafts, games, garden walk.", 238],
    [uuid(), bettyId, peteId, mariaId, "meals", "completed", _d(-16), "08:00", 6, "Weekly meal prep — Barbara's favorites.", 204],
    // Maria with Dorothy (Henderson's)
    [uuid(), dorothyId, hendersonFamilyId, mariaId, "meals", "completed", _d(-47), "09:00", 5, "Diabetic-friendly meals for the week.", 170],
    [uuid(), dorothyId, hendersonFamilyId, mariaId, "companion", "completed", _d(-34), "10:00", 4, "Card games and afternoon tea.", 136],
    [uuid(), dorothyId, hendersonFamilyId, mariaId, "meals", "completed", _d(-26), "09:00", 5, "Meal prep and baking cookies.", 170],
    [uuid(), dorothyId, hendersonFamilyId, mariaId, "companion", "completed", _d(-20), "14:00", 4, "Afternoon tea and puzzles.", 136],
    [uuid(), dorothyId, hendersonFamilyId, mariaId, "meals", "completed", _d(-14), "09:00", 5, "Diabetic-friendly meal prep.", 170],
    // James with Barbara (past)
    [uuid(), bettyId, peteId, jamesId, "companion", "completed", _d(-25), "10:00", 3, "Puzzles and photo albums.", 75],
    // David Kim with Barbara (past)
    [uuid(), bettyId, peteId, davidId, "rides", "completed", _d(-29), "09:00", 1.5, "Doctor appointment transport.", 33],
  ];
  // Maria Feb totals: 20 Barbara sessions (~124 hrs) + 5 Dorothy sessions (~23 hrs) ≈ $4,000+

  for (const [id, recipId, famId, cgId, type, status, date, time, hours, notes, cost] of pastSessions) {
    await db.prepare(`
      INSERT INTO care_sessions
      (id, care_recipient_id, family_user_id, caregiver_id, service_type,
       status, scheduled_date, scheduled_time, duration_hours,
       special_instructions, estimated_cost, actual_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, recipId, famId, cgId, type, status, date, time, hours, notes, cost, cost);
  }

  // ─── Care Sessions (Henderson/Dorothy) ───
  const hendersonSessions = [
    [uuid(), dorothyId, hendersonFamilyId, mariaId, "meals", "confirmed", _d(2), "09:00", 4, "Dorothy likes her eggs scrambled, toast lightly done.", 136],
    [uuid(), dorothyId, hendersonFamilyId, mariaId, "companion", "confirmed", _d(5), "14:00", 3, "Card games and afternoon tea. She enjoys rummy.", 102],
    [uuid(), dorothyId, hendersonFamilyId, sarahId, "meals", "pending", _d(6), "11:00", 2, "Diabetic-friendly meal prep for the week.", 64],
    [uuid(), dorothyId, hendersonFamilyId, mariaId, "companion", "confirmed", _d(10), "10:00", 4, "Help with baking — she wants to make cookies for her church group.", 136],
  ];

  for (const [id, recipId, famId, cgId, type, status, date, time, hours, notes, cost] of hendersonSessions) {
    await db.prepare(`
      INSERT INTO care_sessions
      (id, care_recipient_id, family_user_id, caregiver_id, service_type,
       status, scheduled_date, scheduled_time, duration_hours,
       special_instructions, estimated_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, recipId, famId, cgId, type, status, date, time, hours, notes, cost);
  }

  // ─── Care Sessions (Patel/Arun) ───
  const patelSessions = [
    [uuid(), arunId, patelFamilyId, jamesId, "companion", "confirmed", _d(4), "10:00", 2, "Chess and conversation. Arun prefers quiet activities.", 50],
    [uuid(), arunId, patelFamilyId, jamesId, "rides", "pending", _d(8), "09:00", 1.5, "Physical therapy appointment at 9:30 AM.", 37],
  ];

  for (const [id, recipId, famId, cgId, type, status, date, time, hours, notes, cost] of patelSessions) {
    await db.prepare(`
      INSERT INTO care_sessions
      (id, care_recipient_id, family_user_id, caregiver_id, service_type,
       status, scheduled_date, scheduled_time, duration_hours,
       special_instructions, estimated_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, recipId, famId, cgId, type, status, date, time, hours, notes, cost);
  }

  // ─── Care Sessions (David Lowe / Barbara) ───
  const davidSessions = [
    [uuid(), bettyId, davidLeeId, mariaId, "meals", "confirmed", _d(4), "12:00", 4, "Mom likes her soup warm, not hot. David coordinating this week.", 136],
    [uuid(), bettyId, davidLeeId, jamesId, "companion", "pending", _d(8), "10:00", 3, "Puzzles and light gardening. David will check in after.", 75],
  ];

  for (const [id, recipId, famId, cgId, type, status, date, time, hours, notes, cost] of davidSessions) {
    await db.prepare(`
      INSERT INTO care_sessions
      (id, care_recipient_id, family_user_id, caregiver_id, service_type,
       status, scheduled_date, scheduled_time, duration_hours,
       special_instructions, estimated_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, recipId, famId, cgId, type, status, date, time, hours, notes, cost);
  }

  // ─── Care Sessions (Susan Lowe / Barbara) ───
  const susanSessions = [
    [uuid(), bettyId, susanLeeId, mariaId, "companion", "confirmed", _d(6), "14:00", 4, "Susan requested a garden walk if weather permits.", 136],
  ];

  for (const [id, recipId, famId, cgId, type, status, date, time, hours, notes, cost] of susanSessions) {
    await db.prepare(`
      INSERT INTO care_sessions
      (id, care_recipient_id, family_user_id, caregiver_id, service_type,
       status, scheduled_date, scheduled_time, duration_hours,
       special_instructions, estimated_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, recipId, famId, cgId, type, status, date, time, hours, notes, cost);
  }

  // ─── Care Events (Barbara — v1.100.0 situational awareness) ───
  // Upcoming appointments the care team should just *know* about. Not
  // sessions, not tasks — awareness rows that render inline in Next Up.
  const { zonedDateTimeToInstant: _evBuild } = require("./utils/timezone");
  const demoEvents = [
    [uuid(), bettyId, peteId, "Cardiology — Dr. Patel", "medical", _d(3), "14:00", "Carilion Clinic, Radford", "Bring the medication list. Fasting not required."],
    [uuid(), bettyId, peteId, "Peggy's birthday dinner", "social", _d(9), null, "Peggy's house", null],
  ];
  for (const [id, recipId, createdBy, title, category, date, time, location, details] of demoEvents) {
    const startsAt = _evBuild(date, time || "00:00", "America/New_York");
    await db.prepare(`
      INSERT INTO care_events (id, care_recipient_id, created_by, title, category,
        event_date, event_time, tz, starts_at, location, details, reminders_sent)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'America/New_York', ?, ?, ?, 'day_before,same_day')
    `).run(id, recipId, createdBy, title, category, date, time, startsAt.toISOString(), location, details);
  }

  // ─── Care Sessions (Maria/Carlos — Maria's brother) ───
  // Past completed sessions — Maria earns ~$4K/mo as caregiver but spends ~$650/mo on Carlos's care
  const carlosPastSessions = [
    [uuid(), carlosId, mariaUserId, sarahId, "companion", "completed", _d(-49), "10:00", 4, "Morning routine — whiteboard schedule, breakfast, PT exercises. Carlos was focused and calm.", 128],
    [uuid(), carlosId, mariaUserId, sarahId, "companion", "completed", _d(-42), "10:00", 4, "PT exercises, lunch prep, afternoon walk with Luna. Left-side grip improving!", 128],
    [uuid(), carlosId, mariaUserId, jamesId, "companion", "completed", _d(-38), "14:00", 3, "Board games and a walk around the neighborhood. Carlos was chatty and relaxed.", 75],
    [uuid(), carlosId, mariaUserId, sarahId, "companion", "completed", _d(-31), "10:00", 4, "Morning routine, PT exercises, watched Champions League highlights together.", 128],
    [uuid(), carlosId, mariaUserId, sarahId, "companion", "completed", _d(-17), "09:00", 5, "Extended session — morning routine, PT, grocery run with Carlos (small store, low crowd). He handled it well!", 160],
    [uuid(), carlosId, mariaUserId, jamesId, "companion", "completed", _d(-10), "14:00", 3, "Afternoon companionship — Scrabble, gentle stretches, walked Luna. Carlos beat James at Scrabble!", 75],
  ];
  // Carlos total past spend: 4×$128 + $160 + 2×$75 = $822 over ~4 weeks

  for (const [id, recipId, famId, cgId, type, status, date, time, hours, notes, cost] of carlosPastSessions) {
    await db.prepare(`
      INSERT INTO care_sessions
      (id, care_recipient_id, family_user_id, caregiver_id, service_type,
       status, scheduled_date, scheduled_time, duration_hours,
       special_instructions, estimated_cost, actual_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, recipId, famId, cgId, type, status, date, time, hours, notes, cost, cost);
  }

  // Upcoming Carlos sessions
  const carlosSessions = [
    [uuid(), carlosId, mariaUserId, sarahId, "companion", "confirmed", _d(3), "10:00", 4, "Morning routine help — whiteboard schedule, breakfast, gentle exercises. Luna loves Sarah!", 128],
    [uuid(), carlosId, mariaUserId, sarahId, "companion", "confirmed", _d(6), "10:00", 4, "PT exercises and afternoon soccer highlights. Sarah knows the routine.", 128],
    [uuid(), carlosId, mariaUserId, jamesId, "companion", "pending", _d(10), "14:00", 3, "Afternoon companionship — Carlos likes quiet board games and walks with Luna.", 75],
  ];

  for (const [id, recipId, famId, cgId, type, status, date, time, hours, notes, cost] of carlosSessions) {
    await db.prepare(`
      INSERT INTO care_sessions
      (id, care_recipient_id, family_user_id, caregiver_id, service_type,
       status, scheduled_date, scheduled_time, duration_hours,
       special_instructions, estimated_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, recipId, famId, cgId, type, status, date, time, hours, notes, cost);
  }

  // ─── Care Requests (Barbara requesting help — status='requested', no caregiver) ───
  // Dates are dynamic: today, +4 days, +7 days, +10 days — so they always appear in FindWork
  const careRequests = [
    [uuid(), bettyId, peteId, null, "companion", "requested", _d(0), "14:00", 2, "Would love some company this afternoon — maybe a walk if the weather is nice.", 50],
    [uuid(), bettyId, peteId, null, "meals", "requested", _d(4), "11:00", 3, "Need help with meal prep for the week. Running low on groceries.", 90],
    [uuid(), bettyId, peteId, null, "rides", "requested", _d(7), "09:00", 1.5, "Need a ride to the pharmacy and back.", 42],
    [uuid(), bettyId, peteId, null, "companion", "requested", _d(10), "10:00", 3, "Morning companionship — puzzles and tea.", 75],
  ];

  for (const [id, recipId, famId, cgId, type, status, date, time, hours, notes, cost] of careRequests) {
    await db.prepare(`
      INSERT INTO care_sessions
      (id, care_recipient_id, family_user_id, caregiver_id, service_type,
       status, scheduled_date, scheduled_time, duration_hours,
       special_instructions, estimated_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, recipId, famId, cgId, type, status, date, time, hours, notes, cost);
  }

  console.log("✅ Care sessions created (44 — 8 upcoming Paul/Barbara, 19 past completed, 4 Henderson, 2 Patel, 2 David/Barbara, 1 Susan/Barbara, 6 Carlos past + 3 upcoming, 4 care requests)");

  // ─── Visit Logs (Barbara — rich care notes for every session) ───
  const barbaraVisitLogs = [
    // pastSessions[0]: meals, -50 days, Maria, 6hrs
    { session: 0, cgId: mariaId, summary: "Made scrambled eggs and toast for breakfast — Barbara ate well. Organized her weekly pill box and noticed the Donepezil was running low (only 4 days left). Prepped chicken soup and cornbread for lunch. Barbara helped snap the green beans, which she enjoyed. She talked about her garden and wanting to plant tomatoes this spring.",
      mood: "Content & talkative", departure: "Content", tags: '["ate well","medication reminder","engaged in conversation"]',
      feedback: "Good appetite today. Donepezil supply low — family should refill soon.", tasks: ["Breakfast prep", "Pill box organized", "Lunch prep", "Medication inventory"] },
    // pastSessions[1]: companion, -48 days, Maria, 5hrs
    { session: 1, cgId: mariaId, summary: "Companionship day. We looked through old photo albums — Barbara recognized everyone and told stories about each photo. She got a little emotional looking at photos of her late husband but recovered quickly. Did a 15-min walk around the yard; she was steady on her feet. Made tea and we watched an old Hitchcock movie (Rear Window).",
      mood: "Nostalgic but happy", departure: "Relaxed", tags: '["emotionally engaged","good mobility","enjoys movies"]',
      feedback: "Great day overall. Long-term memory strong — recognized all family in photos.", tasks: ["Photo albums", "Yard walk", "Tea", "Movie (Rear Window)"] },
    // pastSessions[2]: meals, -45 days, Maria, 6hrs
    { session: 2, cgId: mariaId, summary: "Breakfast: oatmeal with blueberries (her favorite). Set out morning meds — she took them without fuss. Prepped 3 days of dinners and labeled everything. Barbara was quiet today; she said she didn't sleep well. Knee was bothering her. Applied ice pack after lunch.",
      mood: "Quiet, slightly fatigued", departure: "Resting comfortably", tags: '["poor sleep","knee pain","ate well","medication taken"]',
      feedback: "Sleep disrupted — woke at 5am. Knee pain moderate. Ice helped. Ate full meals.", tasks: ["Breakfast", "Medication reminders", "3-day dinner prep", "Ice for knee"] },
    // pastSessions[3]: companion, -42 days, Maria, 7hrs
    { session: 3, cgId: mariaId, summary: "Long day together. Morning: gentle stretches and walk to the mailbox. She was excited about a card from her granddaughter. Made lunch together — Barbara insisted on helping make the salad. Afternoon: puzzles (500-piece landscape) and gardening talk. She asked about planting tomatoes twice, forgetting she'd already mentioned it. Evening: light dinner and meds.",
      mood: "Happy & engaged", departure: "Happy but tired", tags: '["good mobility","repetitive questions","enjoys cooking","engaged in activity"]',
      feedback: "Repeated tomato question — typical for her. Energy dipped around 3pm. Great morning.", tasks: ["Stretches", "Walk to mailbox", "Lunch together", "500-piece puzzle", "Dinner", "Meds"] },
    // pastSessions[4]: meals, -39 days, Maria, 5hrs
    { session: 4, cgId: mariaId, summary: "Grocery run to Kroger. Barbara came along and enjoyed picking out produce. She remembered that she likes Honeycrisp apples without prompting. Back home: put everything away, prepped a baked chicken casserole and portioned it for the week. She had a good appetite at lunch.",
      mood: "Alert & cheerful", departure: "Cheerful", tags: '["good memory recall","ate well","enjoyed outing"]',
      feedback: "Good short-term recall today — remembered apple preference. Enjoys grocery trips.", tasks: ["Grocery shopping (Kroger)", "Put away groceries", "Chicken casserole prep", "Portioned meals"] },
    // pastSessions[5]: companion, -36 days, Maria, 6hrs
    { session: 5, cgId: mariaId, summary: "Beautiful day so we spent time in the garden. Barbara deadheaded the roses and watered the flowerbeds. She was very focused and clearly happy. We had lunch on the porch. Afternoon: she took a 30-min nap in her chair (normal for her). After nap she was a bit disoriented for a few minutes but came around. Watched Vertigo together.",
      mood: "Happy in garden", departure: "Calm", tags: '["enjoys gardening","post-nap confusion (brief)","good appetite","active day"]',
      feedback: "Brief disorientation after nap — resolved in ~5 min. Normal pattern for her.", tasks: ["Gardening", "Lunch on porch", "Nap monitoring", "Movie (Vertigo)"] },
    // pastSessions[6]: meals, -33 days, Maria, 6hrs
    { session: 6, cgId: mariaId, summary: "Weekly meal prep day. Made meatloaf, mashed potatoes, green beans, and a pot of vegetable soup. Barbara helped peel potatoes — her arthritis was manageable today. Organized her medications for the week. She was chatty about her daughter's upcoming visit and asked about it three times.",
      mood: "Upbeat", departure: "Upbeat", tags: '["arthritis manageable","repetitive questions","ate well","medication organized"]',
      feedback: "Arthritis didn't limit her today. Repetitive questions about daughter's visit (3x).", tasks: ["Meatloaf", "Mashed potatoes", "Green beans", "Vegetable soup", "Pill box"] },
    // pastSessions[7]: companion, -30 days, Maria, 5hrs
    { session: 7, cgId: mariaId, summary: "Quiet morning. Barbara said she had a weird dream and was a little unsettled. We looked through photo albums, which calmed her down. Short walk — she was a bit unsteady going down the porch steps (held the railing). Had tea and cookies. She perked up in the afternoon and we played cards.",
      mood: "Unsettled → calm", departure: "Calm, improved", tags: '["balance concern (steps)","dreams/sleep issue","calmed by photos","enjoys cards"]',
      feedback: "Watch the porch steps — she was unsteady today. Mood improved throughout the day.", tasks: ["Photo albums", "Short walk", "Tea & cookies", "Card game"] },
    // pastSessions[8]: meals, -27 days, Maria, 7hrs
    { session: 8, cgId: mariaId, summary: "Extended day. Breakfast: pancakes (Barbara's request). She was in great spirits — sang along to the radio while I cooked. Lunch: soup and sandwich. Afternoon: organized her craft supplies together, she found old knitting needles and wants to start a scarf. Dinner prep: lasagna for the week. Full meds taken on time.",
      mood: "Joyful", departure: "Content & relaxed", tags: '["singing (great sign)","good appetite","interested in new activity","medication on time"]',
      feedback: "One of her best days. Singing along to radio — strong mood indicator. Wants to knit.", tasks: ["Pancakes", "Lunch", "Craft organizing", "Lasagna prep", "All meds taken"] },
    // pastSessions[9]: companion, -24 days, Maria, 6hrs
    { session: 9, cgId: mariaId, summary: "Morning routine: helped Barbara get dressed (she had trouble with buttons today — arthritis in fingers). Gentle stretches. We worked on the puzzle from last week. She was focused but got frustrated when pieces didn't fit — redirected to music and she calmed right down. Lunch was good. Cats were extra cuddly today, which made her happy.",
      mood: "Frustrated → content", departure: "Content", tags: '["fine motor difficulty (buttons)","frustration episode","music calming","cats therapeutic"]',
      feedback: "Button difficulty — consider adaptive clothing. Music is reliable mood reset.", tasks: ["Dressing assistance", "Stretches", "Puzzle", "Lunch", "Music therapy"] },
    // pastSessions[10]: meals, -21 days, Maria, 8hrs (FULL DAY)
    { session: 10, cgId: mariaId, summary: "Full 8-hour day with Barbara. Prepared breakfast, lunch, and dinner. Organized medications, did light housekeeping, and spent the afternoon doing puzzles. Barbara was in wonderful spirits all day! She told me about a Hitchcock movie she wants to watch again. Vacuumed the living room and did two loads of laundry. Evening meds given on time.",
      mood: "Happy & engaged", departure: "Happy & engaged", tags: '["excellent day","ate well","medication adherent","active and social"]',
      feedback: "Standout day — alert, social, happy throughout. Full meals, all meds on time.", tasks: ["Prepared 3 meals", "Organized medications", "Light housekeeping", "Puzzles", "Laundry", "Vacuuming"] },
    // pastSessions[11]: companion, -18 days, Maria, 5hrs
    { session: 11, cgId: mariaId, summary: "Made valentines together — Barbara carefully wrote messages to each grandchild. Her handwriting was shaky but legible. We had a special lunch (heart-shaped sandwiches, she loved it). She talked about her husband and got teary but said they were 'good tears.' Fed the cats and brushed Whiskers.",
      mood: "Sentimental & sweet", departure: "Warm, at peace", tags: '["fine motor - writing shaky","emotionally expressive","enjoyed crafts","cat care"]',
      feedback: "Handwriting shakier than usual — track over time. Emotionally healthy expression.", tasks: ["Card making", "Special lunch", "Cat care", "Conversation"] },
    // pastSessions[12]: meals, -15 days, Maria, 6hrs
    { session: 12, cgId: mariaId, summary: "Meal prep focus day. Made her favorite chicken pot pie from scratch — Barbara watched and narrated the recipe from memory (impressive!). Also prepped salads and a fruit tray for the week. Organized the kitchen pantry, tossed some expired items. Medication check: all on track, Donepezil refilled last week.",
      mood: "Alert & sharp", departure: "Satisfied", tags: '["good long-term memory","recipe recall","ate well","medication on track"]',
      feedback: "Recited pot pie recipe from memory — long-term memory holding strong.", tasks: ["Chicken pot pie", "Salad prep", "Fruit tray", "Pantry organized", "Medication check"] },
    // pastSessions[13]: rides, -12 days, Maria, 4hrs
    { session: 13, cgId: mariaId, summary: "Drove Barbara to Dr. Patel's office for regular checkup. BP was 138/82 — doctor said it's fine with current Lisinopril dose. Picked up prescriptions at CVS and groceries on the way home. Stocked the fridge and labeled leftovers with dates. Barbara was a little tired after the outing.",
      mood: "Calm", departure: "A little tired", tags: '["doctor visit","BP 138/82","medication pickup","fatigued after outing"]',
      feedback: "BP stable. She tires easily on outings — keep errands grouped. All scripts filled.", tasks: ["Doctor transport", "Prescription pickup", "Grocery shopping", "Stocked fridge"] },
    // pastSessions[14]: companion, -35 days, Maria, 6hrs
    { session: 14, cgId: mariaId, summary: "Morning routine assistance, then puzzles. Barbara was focused and completed a 300-piece puzzle in under 2 hours — her fastest yet! Lunch: grilled cheese and tomato soup (comfort food day, it was cold outside). She napped briefly after lunch. We talked about her sister-in-law and she recalled details from 40 years ago clearly.",
      mood: "Focused & sharp", departure: "Relaxed", tags: '["excellent cognition","puzzle completion","good appetite","long-term memory intact"]',
      feedback: "Cognitive day — puzzle speed and detail recall both excellent.", tasks: ["Morning routine", "300-piece puzzle", "Lunch", "Nap monitoring", "Conversation"] },
    // pastSessions[15]: meals, -29 days, Maria, 7hrs
    { session: 15, cgId: mariaId, summary: "Grocery run to Food Lion — Barbara came along. She had a vertigo moment in the parking lot (grabbed my arm, steadied after 30 seconds). Inside the store she was fine. Back home: put groceries away, prepped beef stew and biscuits. Kitchen deep clean. She ate a big lunch and was cheerful all afternoon.",
      mood: "Good (minus vertigo episode)", departure: "Cheerful", tags: '["vertigo episode (brief)","recovered quickly","good appetite","enjoyed outing"]',
      feedback: "Vertigo in parking lot — lasted ~30 sec. Note for doctor. Fine afterward.", tasks: ["Grocery shopping", "Beef stew prep", "Biscuits", "Kitchen deep clean"] },
    // pastSessions[16]: companion, -25 days, Maria, 6hrs
    { session: 16, cgId: mariaId, summary: "Photo album day — Barbara's favorite. She was animated, telling stories about each picture. Identified everyone correctly, including her college roommate from the 1960s. Short walk around the back yard. She pointed out where she wants to plant tomatoes this spring. Afternoon nap was peaceful. Fed Mittens and Whiskers.",
      mood: "Animated & social", departure: "Peaceful", tags: '["excellent memory recall","enjoys photos","garden planning","good sleep"]',
      feedback: "Memory strong today — identified everyone in old photos including college friend.", tasks: ["Photo albums", "Yard walk", "Garden planning talk", "Nap monitoring", "Cat feeding"] },
    // pastSessions[17]: meals, -22 days, Maria, 6hrs
    { session: 17, cgId: mariaId, summary: "Standard meal prep day. Breakfast: French toast (she requested it). Organized medications — everything on track. Made chicken noodle soup for the week. Barbara seemed a little distracted today; kept looking out the window. When I asked, she said she was waiting for someone but couldn't remember who. Redirected to cooking and she was fine.",
      mood: "Distracted", departure: "Calm after redirection", tags: '["confusion episode","waiting for unknown person","redirected successfully","medication on track"]',
      feedback: "Mild confusion — thought someone was coming. Redirected easily. No distress.", tasks: ["French toast", "Medication organizing", "Chicken noodle soup", "Redirection"] },
    // pastSessions[18]: companion, -19 days, Maria, 7hrs
    { session: 18, cgId: mariaId, summary: "Full day companionship. Started with gentle stretches — she's getting more flexible! Made friendship bracelets (she chose the colors and was very particular). Lunch: leftover soup reheated. Afternoon: we played Scrabble and she won! Her word recall was impressive. Walked Whiskers around the living room on a string toy (her idea, hilarious). All evening meds taken.",
      mood: "Playful & competitive", departure: "Happy", tags: '["good flexibility","fine motor ok (bracelets)","won Scrabble","humor intact","all meds taken"]',
      feedback: "Exceptional day. Won at Scrabble, creative with crafts. Humor and personality strong.", tasks: ["Stretches", "Friendship bracelets", "Lunch", "Scrabble", "Cat play", "Evening meds"] },
    // pastSessions[19]: meals, -16 days, Maria, 6hrs
    { session: 19, cgId: mariaId, summary: "Made Barbara's favorite pot roast. She sat in the kitchen and talked to me while I cooked — she was in storytelling mode, telling me about the time she drove cross-country in the 1970s. I've heard the story before but she adds new details each time. Prepped side dishes for the week. Cats got their treats. All meds taken.",
      mood: "Chatty & nostalgic", departure: "Satisfied", tags: '["good storytelling","repetitive stories (with variation)","ate well","medication adherent"]',
      feedback: "Repeats cross-country story but adds new details — not pure repetition. Good sign.", tasks: ["Pot roast", "Side dish prep", "Storytelling", "Cat treats", "Medications"] },
    // pastSessions[25]: James with Barbara, companion, -25 days, 3hrs
    { session: 25, cgId: jamesId, summary: "Spent the morning looking through photo albums and chatting about her garden. She was in great spirits and told me about every plant she wants to grow this year. We took a short walk around the block — she was steady and confident. She asked about James' family and remembered my daughter's name (Ava).",
      mood: "Cheerful", departure: "Cheerful & social", tags: '["excellent memory","good mobility","enjoys outdoors","social engagement"]',
      feedback: "Great visit. Remembered my daughter's name. Steady on walk. No concerns.", tasks: ["Photo album activity", "Short walk", "Conversation"] },
    // pastSessions[26]: David with Barbara, rides, -29 days, 1.5hrs
    { session: 26, cgId: davidId, summary: "Drove Barbara to her doctor's appointment. She was a little anxious in the car (gripping the handle). The visit went well — no changes to medication, doctor pleased with BP. Picked up her prescription on the way home. She was tired but relieved after the appointment.",
      mood: "A little anxious → relieved", departure: "A little tired", tags: '["car anxiety","doctor visit positive","medication unchanged","fatigued after outing"]',
      feedback: "Some car anxiety — play calming music next time. Doctor visit all clear.", tasks: ["Doctor transport", "Prescription pickup"] },
  ];

  for (const log of barbaraVisitLogs) {
    await db.prepare(`
      INSERT INTO visit_logs
      (id, session_id, caregiver_id, check_in_time, check_out_time,
       summary, mood_rating, departure_mood, condition_tags, care_feedback,
       tasks_completed)
      VALUES (?, ?, ?, NOW() - INTERVAL '2 hours', NOW(), ?, ?, ?, ?, ?, ?)
    `).run(
      uuid(), pastSessions[log.session][0], log.cgId,
      log.summary, log.mood, log.departure, log.tags, log.feedback,
      JSON.stringify(log.tasks)
    );
  }

  // Visit logs for Carlos's past sessions
  const carlosVisitLogs = [
    [uuid(), carlosPastSessions[3][0], sarahId,
      "Great session! Carlos completed all his PT exercises with good form. Left grip strength continues to improve. We watched soccer highlights and he was very engaged. Luna stayed by his side the whole time.",
      "Engaged & focused", ["Morning routine", "PT exercises", "Lunch prep", "Soccer highlights"]],
    [uuid(), carlosPastSessions[4][0], sarahId,
      "Extended session — tried a grocery run to the small market on College Ave. Carlos handled it well! Only 3 other customers, so low stimulation. He picked out his own snacks and carried the bag. Big milestone!",
      "Confident", ["Morning routine", "PT exercises", "Grocery shopping", "Lunch prep", "Walk with Luna"]],
    [uuid(), carlosPastSessions[5][0], jamesId,
      "Played Scrabble and Carlos won! His word recall is getting noticeably better. We walked Luna around the block twice — he wanted to keep going. Energy levels are up.",
      "Happy & energetic", ["Scrabble", "Gentle stretches", "Dog walk (2 laps)"]],
  ];

  for (const [id, sessionId, cgId, summary, mood, tasks] of carlosVisitLogs) {
    await db.prepare(`
      INSERT INTO visit_logs
      (id, session_id, caregiver_id, check_in_time, check_out_time,
       summary, mood_rating, tasks_completed)
      VALUES (?, ?, ?, NOW() - INTERVAL '2 hours', NOW(), ?, ?, ?)
    `).run(id, sessionId, cgId, summary, mood, JSON.stringify(tasks));
  }

  console.log("✅ Visit logs created (25 — Barbara 22, Carlos 3)");

  // ─── Activity Feed ───
  // Paul's activity feed — spans 10 days of realistic care coordination
  const activities = [
    // Older entries
    [uuid(), peteId, bettyId, "visit_complete", "Full-day visit completed",
      "Maria spent 8 hours with Barbara — prepared 3 meals, organized medications, did light housekeeping, and afternoon puzzles. Barbara was in wonderful spirits all day!", "-8 days"],
    [uuid(), peteId, bettyId, "session_confirmed", "Caregiver matched: James Okafor",
      "James accepted the companionship session for Saturday at 10:00 AM. He'll bring crossword books and puzzles.", "-7 days"],
    [uuid(), peteId, bettyId, "visit_complete", "Companionship visit completed",
      "James and Barbara looked through photo albums, took a short walk around the block, and worked on a 500-piece garden puzzle. She was steady on her feet and very chatty.", "-5 days"],
    [uuid(), peteId, bettyId, "care_request", "Barbara requested afternoon company",
      "Barbara submitted a care request for Saturday afternoon — she'd like companionship for a walk and maybe some gardening if weather permits.", "-4 days"],
    [uuid(), peteId, bettyId, "visit_complete", "Meal prep completed",
      "Maria prepared chicken soup, labeled leftovers in the fridge, and stocked groceries from Kroger. Barbara ate well — two slices of sourdough with soup.", "-3 days"],
    [uuid(), peteId, bettyId, "session_requested", "Doctor appointment transport booked",
      "Rides session booked for Feb 25 at 9:00 AM. Maria will drive Barbara to Dr. Patel's office and pick up prescriptions afterward.", "-2 days"],
    [uuid(), peteId, bettyId, "session_confirmed", "Meal Prep confirmed for Feb 24",
      "Maria Santos confirmed full-day care (8 hours) — meal prep, companionship, and light housekeeping. Barbara's favorite tomato soup is on the menu.", "-1 day"],
    [uuid(), peteId, bettyId, "medication_reminder", "Donepezil refill needed by Friday",
      "Susan called CVS — the Donepezil refill will be ready Friday after 10am. Maria will pick it up on her way to Barbara's.", "-12 hours"],
    [uuid(), peteId, bettyId, "visit_complete", "Morning visit completed",
      "Maria arrived at 8am. Barbara was already up and dressed with Whiskers on her lap. They had oatmeal with blueberries and started the day with gentle stretches.", "-4 hours"],
    [uuid(), peteId, bettyId, "session_requested", "New caregiver introduction scheduled",
      "Sarah Chen will visit Barbara on Feb 28 for a companionship session. First visit — please ensure a warm welcome. Sarah specializes in nutrition for seniors.", "-2 hours"],
    [uuid(), peteId, bettyId, "note_added", "Care note added by Susan",
      "Susan added a health note: Dr. Patel's nurse said Ibuprofen PRN is fine for knee pain, ice 15 min after walks.", "-1 hour"],
  ];

  for (const [id, famId, recipId, type, title, msg, timeOffset] of activities) {
    await db.prepare(`
      INSERT INTO activity_feed
      (id, family_user_id, care_recipient_id, event_type, title, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW() + ?::interval)
    `).run(id, famId, recipId, type, title, msg, timeOffset);
  }

  // Activity feed for David Lowe — his own set
  const davidActivities = [
    [uuid(), davidLeeId, bettyId, "session_confirmed", "Meal Prep confirmed for Feb 22",
      "Maria Santos will prepare lunch for Barbara — David coordinating this week.", "-1 day"],
    [uuid(), davidLeeId, bettyId, "visit_complete", "Video call with grandkids",
      "Maria helped Barbara video call with David's kids at 2pm. Barbara was laughing and showing them Whiskers. Great interaction!", "-4 hours"],
  ];

  for (const [id, famId, recipId, type, title, msg, timeOffset] of davidActivities) {
    await db.prepare(`
      INSERT INTO activity_feed (id, family_user_id, care_recipient_id, event_type, title, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW() + ?::interval)
    `).run(id, famId, recipId, type, title, msg, timeOffset);
  }

  // Activity feed for Susan Lowe
  const susanActivities = [
    [uuid(), susanLeeId, bettyId, "session_confirmed", "Companionship confirmed for Feb 23",
      "Maria Santos will visit Barbara for an afternoon garden walk if weather permits.", "-6 hours"],
    [uuid(), susanLeeId, bettyId, "medication_reminder", "Donepezil refill ready Friday",
      "CVS will have the refill ready after 10am. Maria will pick it up.", "-3 hours"],
  ];

  for (const [id, famId, recipId, type, title, msg, timeOffset] of susanActivities) {
    await db.prepare(`
      INSERT INTO activity_feed (id, family_user_id, care_recipient_id, event_type, title, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW() + ?::interval)
    `).run(id, famId, recipId, type, title, msg, timeOffset);
  }

  // Maria's family-side activity feed (for Carlos)
  const mariaFamilyActivities = [
    [uuid(), mariaUserId, carlosId, "session_confirmed", "Sarah confirmed for Sunday",
      "Sarah Chen will help Carlos with his morning routine and PT exercises on Sunday at 10am. Luna will be thrilled!", "-1 day"],
    [uuid(), mariaUserId, carlosId, "visit_complete", "Tuesday visit went well",
      "Sarah helped Carlos with exercises and they watched the Champions League highlights together. His left-side strength is improving — he's gripping better.", "-3 days"],
    [uuid(), mariaUserId, carlosId, "note_added", "PT progress update",
      "Carlos's physical therapist said he's ahead of schedule on recovery milestones. Keep up the daily exercises and walks with Luna.", "-5 days"],
  ];

  for (const [id, famId, recipId, type, title, msg, timeOffset] of mariaFamilyActivities) {
    await db.prepare(`
      INSERT INTO activity_feed (id, family_user_id, care_recipient_id, event_type, title, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW() + ?::interval)
    `).run(id, famId, recipId, type, title, msg, timeOffset);
  }

  console.log("✅ Activity feed populated (18 — Paul 11, David 2, Susan 2, Maria 3)");

  // ─── Reviews ───
  const reviews = [
    [uuid(), pastSessions[10][0], peteId, mariaId, 5, "Maria spent a full day with Barbara and she was in great spirits. Incredible care and attention."],
    [uuid(), pastSessions[25][0], peteId, jamesId, 5, "James is so patient and kind. Barbara really enjoys his visits."],
    [uuid(), pastSessions[13][0], peteId, mariaId, 5, "Always gets exactly what Barbara needs from the store and doctor visits."],
    [uuid(), pastSessions[26][0], peteId, davidId, 4, "David was punctual and helpful. Barbara was comfortable with him."],
    // Maria reviewing caregivers for Carlos
    [uuid(), carlosPastSessions[4][0], mariaUserId, sarahId, 5, "Sarah took Carlos grocery shopping for the first time since his accident. He handled it beautifully! She's so patient and encouraging."],
    [uuid(), carlosPastSessions[5][0], mariaUserId, jamesId, 5, "James and Carlos played Scrabble and Carlos won! His word recall is improving so much. James is great at keeping things fun and low-pressure."],
  ];

  for (const [id, sessionId, famId, cgId, rating, comment] of reviews) {
    await db.prepare(`
      INSERT INTO reviews (id, session_id, family_user_id, caregiver_id, rating, comment)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, sessionId, famId, cgId, rating, comment);
  }

  console.log("✅ Reviews created (6 — Paul 4, Maria 2)");

  // ─── Conversations ───
  // Direct conversations for existing message pairs
  const convPeteMaria = uuid();
  const convPeteJames = uuid();
  const convBettyMaria = uuid();
  const convDavidMaria = uuid();
  const convSusanMaria = uuid();

  const directConvs = [
    [convPeteMaria, "direct", null, null, peteId],
    [convPeteJames, "direct", null, null, peteId],
    [convBettyMaria, "direct", null, null, bettyUserId],
    [convDavidMaria, "direct", null, null, davidLeeId],
    [convSusanMaria, "direct", null, null, susanLeeId],
  ];

  for (const [id, type, name, careTeamId, createdBy] of directConvs) {
    await db.prepare(
      "INSERT INTO conversations (id, type, name, care_team_id, created_by) VALUES (?, ?, ?, ?, ?)"
    ).run(id, type, name, careTeamId, createdBy);
  }

  // Conversation members for direct chats
  const directMembers = [
    [convPeteMaria, peteId], [convPeteMaria, mariaUserId],
    [convPeteJames, peteId], [convPeteJames, jamesUserId],
    [convBettyMaria, bettyUserId], [convBettyMaria, mariaUserId],
    [convDavidMaria, davidLeeId], [convDavidMaria, mariaUserId],
    [convSusanMaria, susanLeeId], [convSusanMaria, mariaUserId],
  ];

  for (const [convId, userId] of directMembers) {
    await db.prepare(
      "INSERT INTO conversation_members (id, conversation_id, user_id, role, last_read_at) VALUES (?, ?, ?, 'member', NOW())"
    ).run(uuid(), convId, userId);
  }

  console.log("✅ Direct conversations created (5)");

  // ─── Messages ───
  // Paul ↔ Maria: ongoing care coordination thread spanning several days
  const peteMariaMsgs = [
    // 3 days ago — post-visit update
    [uuid(), mariaUserId, peteId, convPeteMaria, "Hi Paul! Just finished today's visit. Barbara had a great morning — we went through her photo album and she told me all about planting roses with your dad. She got a little emotional but said it was happy tears.", "-3 days"],
    [uuid(), peteId, mariaUserId, convPeteMaria, "That's so sweet. Dad would have loved that. How was her appetite?", "-3 days"],
    [uuid(), mariaUserId, peteId, convPeteMaria, "Good! She ate the chicken soup and two slices of sourdough. I labeled the leftovers in the fridge — enough for dinner and tomorrow's lunch.", "-3 days"],
    [uuid(), peteId, mariaUserId, convPeteMaria, "Perfect, thank you Maria. Quick question — did she remember to take her afternoon Donepezil?", "-3 days"],
    [uuid(), mariaUserId, peteId, convPeteMaria, "Yes! I set a phone alarm for 2pm and she took it right on time. I also noticed she's been rubbing her left knee more. Might be worth mentioning to Dr. Patel.", "-3 days"],
    // 2 days ago — scheduling
    [uuid(), peteId, mariaUserId, convPeteMaria, "Hey Maria, I need to adjust Thursday's session. Can we move it from 8am to 9am? I have an early call and want to say hi to Barbara before you arrive.", "-2 days"],
    [uuid(), mariaUserId, peteId, convPeteMaria, "9am works perfectly! I'll use the extra time to stop at Kroger — Barbara asked for bananas and that Greek yogurt she likes.", "-2 days"],
    [uuid(), peteId, mariaUserId, convPeteMaria, "You're amazing. Also, David mentioned he might video call Barbara during your visit Wednesday. Would you mind helping her with the iPad if he does?", "-2 days"],
    [uuid(), mariaUserId, peteId, convPeteMaria, "Of course! We've done FaceTime before — she loves seeing David's kids. I'll make sure the iPad is charged.", "-2 days"],
    // Today — morning check-in
    [uuid(), mariaUserId, peteId, convPeteMaria, "Good morning! Just arrived at Barbara's. She was already up and dressed — had Whiskers on her lap watching the birds outside. Great start to the day!", "-2 hours"],
    [uuid(), peteId, mariaUserId, convPeteMaria, "That's wonderful! She must be having a good day. I'll try to call around noon if that's okay.", "-1 hour"],
    [uuid(), mariaUserId, peteId, convPeteMaria, "Sounds great! We're about to start breakfast — oatmeal with blueberries, her favorite.", "-45 minutes"],
    // Recent unread — Paul hasn't seen these yet (is_read = 0)
    [uuid(), mariaUserId, peteId, convPeteMaria, "Update: finished breakfast, medication taken. She's asking if you can bring that photo album next time — the one with pictures from Virginia Beach.", "-20 minutes", 0],
  ];

  for (const [id, senderId, recipientId, conversationId, content, timeOffset, isRead] of peteMariaMsgs) {
    await db.prepare(`
      INSERT INTO messages (id, sender_id, recipient_id, conversation_id, content, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW() + ?::interval)
    `).run(id, senderId, recipientId, conversationId, content, isRead !== undefined ? isRead : 1, timeOffset);
  }

  // Paul ↔ James: companionship check-ins
  const peteJamesMsgs = [
    [uuid(), jamesUserId, peteId, convPeteJames, "Hi Paul! Just arrived at Barbara's. She answered the door herself and seemed really alert today.", "-2 days"],
    [uuid(), peteId, jamesUserId, convPeteJames, "Great to hear! She mentioned wanting to do puzzles — there's a new 500-piece one on the dining table.", "-2 days"],
    [uuid(), jamesUserId, peteId, convPeteJames, "Found it! A garden scene — she lit up when she saw it. We're about halfway through now. She's super focused.", "-2 days"],
    [uuid(), jamesUserId, peteId, convPeteJames, "Visit done! We finished the puzzle border and about a third of the flowers. She wants to continue next time. Also we took a short walk around the block — she was steady on her feet.", "-2 days"],
    [uuid(), peteId, jamesUserId, convPeteJames, "That's amazing, she'll love finishing it together. Thanks for the walk update — her PT said walking is great for her balance.", "-2 days"],
    [uuid(), peteId, jamesUserId, convPeteJames, "Hey James, I just confirmed next Friday at 10am for companionship. Barbara's looking forward to finishing that puzzle!", "-4 hours"],
    [uuid(), jamesUserId, peteId, convPeteJames, "Wouldn't miss it! I'll bring some new crossword books too — she mentioned liking the word games.", "-3 hours"],
  ];

  for (const [id, senderId, recipientId, conversationId, content, timeOffset] of peteJamesMsgs) {
    await db.prepare(`
      INSERT INTO messages (id, sender_id, recipient_id, conversation_id, content, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, 1, NOW() + ?::interval)
    `).run(id, senderId, recipientId, conversationId, content, timeOffset);
  }

  // Barbara ↔ Maria: personal warmth
  const bettyMariaMsgs = [
    [uuid(), mariaUserId, bettyUserId, convBettyMaria, "Good evening Barbara! I wanted to let you know I'll be there tomorrow at noon. Is there anything special you'd like for lunch?", "-1 day"],
    [uuid(), bettyUserId, mariaUserId, convBettyMaria, "Oh Maria dear, could you make that tomato soup again? It was so good last time! And maybe some of that cornbread?", "-1 day"],
    [uuid(), mariaUserId, bettyUserId, convBettyMaria, "Of course! I'll pick up fresh tomatoes and cornmeal on my way. Your recipe is my favorite to make!", "-1 day"],
    [uuid(), bettyUserId, mariaUserId, convBettyMaria, "You're such a sweetheart. Whiskers has been keeping me company all morning. He sits right on my lap while I watch my shows.", "-1 day"],
    [uuid(), mariaUserId, bettyUserId, convBettyMaria, "Whiskers is the best companion! I'll give him some treats when I come. See you tomorrow at noon!", "-23 hours"],
    [uuid(), bettyUserId, mariaUserId, convBettyMaria, "Paul called this morning and said the garden center has tomato seedlings! Can you help me plant some this spring?", "-5 hours"],
    [uuid(), mariaUserId, bettyUserId, convBettyMaria, "I would LOVE that! Let's pick a nice sunny day next month. We can set up the pots by the back window where they'll get lots of light.", "-4 hours"],
  ];

  for (const [id, senderId, recipientId, conversationId, content, timeOffset] of bettyMariaMsgs) {
    await db.prepare(`
      INSERT INTO messages (id, sender_id, recipient_id, conversation_id, content, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, 1, NOW() + ?::interval)
    `).run(id, senderId, recipientId, conversationId, content, timeOffset);
  }

  // David ↔ Maria: coordination while Paul travels
  const davidMariaMsgs = [
    [uuid(), davidLeeId, mariaUserId, convDavidMaria, "Hi Maria, this is David — Paul's brother. I'll be coordinating Barbara's care this week while Paul is traveling for work.", "-4 days"],
    [uuid(), mariaUserId, davidLeeId, convDavidMaria, "Hi David! No problem at all. Barbara and I have our routine down pat. I'll send you updates after each visit, same as I do with Paul.", "-4 days"],
    [uuid(), davidLeeId, mariaUserId, convDavidMaria, "That's great, thanks. Also, my kids want to video call Grandma on Wednesday. Paul said you could help her with the iPad?", "-3 days"],
    [uuid(), mariaUserId, davidLeeId, convDavidMaria, "Absolutely! She loves seeing the grandkids. I'll have the iPad charged and ready. What time works?", "-3 days"],
    [uuid(), davidLeeId, mariaUserId, convDavidMaria, "How about 2pm? The kids get home from school at 1:30.", "-3 days"],
    [uuid(), mariaUserId, davidLeeId, convDavidMaria, "Perfect! Quick update from today's visit: Barbara was in wonderful spirits. She ate a full lunch, we did some gentle stretches, and she napped from 2-3. Whiskers didn't leave her side all day.", "-2 days"],
    [uuid(), davidLeeId, mariaUserId, convDavidMaria, "Thank you Maria, you're truly the best. Barbara always says you feel like family.", "-2 days"],
  ];

  for (const [id, senderId, recipientId, conversationId, content, timeOffset] of davidMariaMsgs) {
    await db.prepare(`
      INSERT INTO messages (id, sender_id, recipient_id, conversation_id, content, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, 1, NOW() + ?::interval)
    `).run(id, senderId, recipientId, conversationId, content, timeOffset);
  }

  // Susan ↔ Maria: medication coordination
  const susanMariaMsgs = [
    [uuid(), susanLeeId, mariaUserId, convSusanMaria, "Maria, it's Susan. Could you check if Barbara has enough of her Donepezil? I want to make sure we're not running low before the weekend.", "-2 days"],
    [uuid(), mariaUserId, susanLeeId, convSusanMaria, "Hi Susan! I checked today — she has 5 tablets left. That'll get her through Friday but we should refill by then.", "-2 days"],
    [uuid(), susanLeeId, mariaUserId, convSusanMaria, "I'll call Dr. Patel's office tomorrow for the refill. Can you pick it up from CVS when it's ready?", "-2 days"],
    [uuid(), mariaUserId, susanLeeId, convSusanMaria, "Of course! Just text me when it's ready and I'll grab it on my way to Barbara's. Also, she mentioned her knee has been bothering her more — Paul said to mention it at the next appointment.", "-2 days"],
    [uuid(), susanLeeId, mariaUserId, convSusanMaria, "Noted — I'll add it to the list for Dr. Patel. Thanks for keeping such a close eye on her, Maria. We really appreciate it.", "-1 day"],
  ];

  for (const [id, senderId, recipientId, conversationId, content, timeOffset] of susanMariaMsgs) {
    await db.prepare(`
      INSERT INTO messages (id, sender_id, recipient_id, conversation_id, content, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, 1, NOW() + ?::interval)
    `).run(id, senderId, recipientId, conversationId, content, timeOffset);
  }

  // ─── iPAi Demo Conversation ───
  // Create iPAi system user for demo
  // iPAi is a non-demo system account (is_demo=0), so it survives the demo-only
  // cleanup. Insert idempotently and adopt the existing row's id if present,
  // otherwise the demo-only reseed dies on a duplicate-email constraint.
  let ipaiUserId = uuid();
  await db.prepare(`
    INSERT INTO users (id, email, first_name, last_name, role, is_demo, is_active, password_hash)
    VALUES (?, 'ipai@yourinplace.com', 'iPAi', 'Assistant', 'system', 0, 1, 'nologin')
    ON CONFLICT (email) DO NOTHING
  `).run(ipaiUserId);
  ipaiUserId = (await db.prepare("SELECT id FROM users WHERE email = 'ipai@yourinplace.com'").get()).id;

  // Paul ↔ iPAi conversation
  const convPaulIPAi = uuid();
  await db.prepare("INSERT INTO conversations (id, type, name, created_by) VALUES (?, 'direct', 'iPAi', ?)").run(convPaulIPAi, peteId);
  await db.prepare("INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, 'member')").run(uuid(), convPaulIPAi, peteId);
  await db.prepare("INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, 'member')").run(uuid(), convPaulIPAi, ipaiUserId);

  const ipaiMsgs = [
    [uuid(), peteId, ipaiUserId, convPaulIPAi, "Hey iPAi, when is Maria available this week?", null, "-3 days"],
    [uuid(), ipaiUserId, peteId, convPaulIPAi, "Maria has availability on Wednesday 9am-3pm and Friday 10am-2pm this week. She's been with Barbara 14 times and has a 4.8 rating. Would you like me to schedule a visit?", "iPAi", "-3 days"],
    [uuid(), peteId, ipaiUserId, convPaulIPAi, "Barbara seemed really confused yesterday. Should I be worried?", null, "-2 days"],
    [uuid(), ipaiUserId, peteId, convPaulIPAi, "Based on Barbara's recent visits, I've noticed her confusion tends to increase in the afternoons — this is consistent with sundowning, which is common in early-stage dementia. Her morning visits show much better mood scores (4.2/5 vs 3.1/5 in the afternoon). I'd recommend scheduling care visits before noon when possible. Maria's notes from last Tuesday also mentioned Barbara was asking about her garden — engaging her with familiar activities she loves can help ground her during confused moments.", "iPAi", "-2 days"],
    [uuid(), peteId, ipaiUserId, convPaulIPAi, "That's really helpful. Can you find someone for Thursday morning who's good with dementia?", null, "-1 day"],
    [uuid(), ipaiUserId, peteId, convPaulIPAi, "I found 2 great matches for Thursday morning:\n\n1. Maria Santos — 94% match. 14 visits with Barbara, dementia experience, available 9am-1pm. Barbara's mood consistently improves during her sessions.\n\n2. James Wilson — 82% match. Certified dementia care, 3.2 miles away, available 8am-12pm. New to Barbara but highly rated by other families.\n\nWould you like me to book Maria for Thursday 9am-12pm?", "iPAi", "-1 day"],
    [uuid(), peteId, ipaiUserId, convPaulIPAi, "Yes, book Maria for Thursday morning please.", null, "-1 day"],
    [uuid(), ipaiUserId, peteId, convPaulIPAi, "Done! I've requested Maria for Thursday 9am-12pm, companionship care for Barbara. Maria will confirm shortly. I've also noted in the session instructions that Barbara does best with morning visits and responds well to garden conversations. Is there anything else you'd like me to help with?", "iPAi", "-1 day"],
  ];

  for (const [id, senderId, recipientId, conversationId, content, senderLabel, timeOffset] of ipaiMsgs) {
    await db.prepare(`
      INSERT INTO messages (id, sender_id, recipient_id, conversation_id, content, sender_label, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, NOW() + ?::interval)
    `).run(id, senderId, recipientId, conversationId, content, senderLabel, timeOffset);
  }

  // Maria ↔ iPAi conversation (caregiver perspective)
  const convMariaIPAi = uuid();
  await db.prepare("INSERT INTO conversations (id, type, name, created_by) VALUES (?, 'direct', 'iPAi', ?)").run(convMariaIPAi, mariaUserId);
  await db.prepare("INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, 'member')").run(uuid(), convMariaIPAi, mariaUserId);
  await db.prepare("INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, 'member')").run(uuid(), convMariaIPAi, ipaiUserId);

  const ipaiMariaMsgs = [
    [uuid(), mariaUserId, ipaiUserId, convMariaIPAi, "Any tips for my visit with Barbara tomorrow?", null, "-1 day"],
    [uuid(), ipaiUserId, mariaUserId, convMariaIPAi, "Great question! Based on your last 3 visits with Barbara:\n\nShe's been in good spirits during your morning sessions. Her family mentioned she loves talking about her garden — try bringing that up during meal prep. Also, Paul noted she's been a bit confused about her medication schedule recently, so the whiteboard reminder by her chair might need updating.\n\nOne thing to watch for: her appetite has been slightly lower on your last two visits. If she skips lunch again, mention it in your checkout notes so her family can follow up with Dr. Patel.", "iPAi", "-1 day"],
  ];

  for (const [id, senderId, recipientId, conversationId, content, senderLabel, timeOffset] of ipaiMariaMsgs) {
    await db.prepare(`
      INSERT INTO messages (id, sender_id, recipient_id, conversation_id, content, sender_label, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, NOW() + ?::interval)
    `).run(id, senderId, recipientId, conversationId, content, senderLabel, timeOffset);
  }

  console.log("✅ Messages created (48 across 5 conversations + iPAi demo conversations)");

  // ─── Recipient Notes ───
  const notes = [
    // Barbara's own notes
    [uuid(), bettyId, bettyUserId, "Need to pick up: sourdough bread, yogurt, bananas, and cat food for Whiskers", "personal", "-5 days"],
    [uuid(), bettyId, bettyUserId, "Ask doctor about the new knee pain — started last Tuesday. Gets worse when climbing stairs.", "health", "-3 days"],
    [uuid(), bettyId, bettyUserId, "Remind Maria about the tomato soup recipe from last month — she used fresh basil and it was perfect", "personal", "-2 days"],
    [uuid(), bettyId, bettyUserId, "Susan is calling in the Donepezil refill to CVS. Maria will pick it up Friday.", "health", "-1 day"],
    [uuid(), bettyId, bettyUserId, "David's kids want to video call Wednesday at 2pm! Need to charge the iPad.", "family", "-12 hours"],
    // Paul's notes about Barbara
    [uuid(), bettyId, peteId, "Barbara mentioned she's been sleeping poorly — waking up around 3am. Let's ask Dr. Patel about it at the next visit (March 3).", "health", "-4 days"],
    [uuid(), bettyId, peteId, "Maria said Barbara was rubbing her left knee more than usual. PT recommended gentle exercises — printed the sheet and left it on the fridge.", "health", "-2 days"],
    [uuid(), bettyId, peteId, "Barbara wants to plant tomatoes this spring. Susan is getting seedlings from the garden center. Let's set up pots by the back window where she'll get afternoon sun.", "general", "-6 hours"],
    [uuid(), bettyId, peteId, "Daily routine that works best: Wake 7:30, breakfast 8, medication 8:30, activity/walk 10-12, lunch 12:30, nap 2-3, afternoon tea 3:30, light activity 4-5, dinner 6, medication 6:30, TV/relax 7-9, bed 9:30.", "general", "-5 days"],
    // David's note
    [uuid(), bettyId, davidLeeId, "Covering for Paul this week. Maria has everything under control. Barbara seemed in great spirits on our video call — was laughing with the grandkids.", "family", "-1 day"],
    // Susan's note
    [uuid(), bettyId, susanLeeId, "Called CVS — Donepezil refill will be ready Friday after 10am. Also asked Dr. Patel's nurse about the knee pain — she said Ibuprofen PRN is fine, ice 15min after walks.", "health", "-8 hours"],
  ];

  for (const [id, recipId, authorId, content, noteType, timeOffset] of notes) {
    await db.prepare(`
      INSERT INTO recipient_notes (id, care_recipient_id, author_id, content, note_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NOW() + ?::interval, NOW() + ?::interval)
    `).run(id, recipId, authorId, content, noteType, timeOffset, timeOffset);
  }

  // Maria's notes about Carlos
  const carlosNotes = [
    [uuid(), carlosId, mariaUserId, "Carlos's daily routine: Wake 8am, breakfast 8:30, PT exercises 9:30-10:30, lunch 12, rest 1-2pm, walk Luna 3pm, free time 4-6, dinner 6:30, wind down 8, bed 9:30. Write on whiteboard each morning.", "general", "-4 days"],
    [uuid(), carlosId, mariaUserId, "PT milestones: Left grip strength up from 15 to 28 lbs since October. Walking unassisted for 20 min. Next goal: light jogging by April. Dr. Reyes impressed with progress.", "health", "-2 days"],
    [uuid(), carlosId, mariaUserId, "Carlos gets anxious in crowds — avoid busy stores and restaurants. Small groups (3-4 people) are fine. Luna helps a lot as his therapy dog. Music calms him — his Spotify playlist is called 'Recovery Jams'.", "general", "-6 days"],
  ];

  for (const [id, recipId, authorId, content, noteType, timeOffset] of carlosNotes) {
    await db.prepare(`
      INSERT INTO recipient_notes (id, care_recipient_id, author_id, content, note_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NOW() + ?::interval, NOW() + ?::interval)
    `).run(id, recipId, authorId, content, noteType, timeOffset, timeOffset);
  }

  console.log("✅ Recipient notes created (14 — Barbara 5, Paul 4, David 1, Susan 1, Maria/Carlos 3)");

  // ─── Share Barbara with siblings ───
  // Paul shares Barbara's care recipient record with David and Susan
  await db.prepare(
    "INSERT INTO care_recipient_shares (id, care_recipient_id, shared_with_user_id, permission, shared_by_user_id) VALUES (?, ?, ?, 'edit', ?)"
  ).run(uuid(), bettyId, davidLeeId, peteId);
  await db.prepare(
    "INSERT INTO care_recipient_shares (id, care_recipient_id, shared_with_user_id, permission, shared_by_user_id) VALUES (?, ?, ?, 'edit', ?)"
  ).run(uuid(), bettyId, susanLeeId, peteId);

  console.log("✅ Care recipient sharing created (Barbara shared with David & Susan)");

  // ─── Care Teams ───
  // Barbara's Care Team (Paul is leader, David and Susan are members)
  const bettyCareTeamId = uuid();
  await db.prepare(
    "INSERT INTO care_teams (id, name, care_recipient_id, created_by) VALUES (?, ?, ?, ?)"
  ).run(bettyCareTeamId, "Barbara Lowe's Care Team", bettyId, peteId);

  await db.prepare(
    "INSERT INTO care_team_members (id, care_team_id, user_id, role, invited_by) VALUES (?, ?, ?, 'leader', ?)"
  ).run(uuid(), bettyCareTeamId, peteId, peteId);
  await db.prepare(
    "INSERT INTO care_team_members (id, care_team_id, user_id, role, invited_by) VALUES (?, ?, ?, 'member', ?)"
  ).run(uuid(), bettyCareTeamId, davidLeeId, peteId);
  await db.prepare(
    "INSERT INTO care_team_members (id, care_team_id, user_id, role, invited_by) VALUES (?, ?, ?, 'member', ?)"
  ).run(uuid(), bettyCareTeamId, susanLeeId, peteId);

  // Dorothy's Care Team (Linda is leader)
  const dorothyCareTeamId = uuid();
  await db.prepare(
    "INSERT INTO care_teams (id, name, care_recipient_id, created_by) VALUES (?, ?, ?, ?)"
  ).run(dorothyCareTeamId, "Dorothy Henderson's Care Team", dorothyId, hendersonFamilyId);
  await db.prepare(
    "INSERT INTO care_team_members (id, care_team_id, user_id, role, invited_by) VALUES (?, ?, ?, 'leader', ?)"
  ).run(uuid(), dorothyCareTeamId, hendersonFamilyId, hendersonFamilyId);

  // Arun's Care Team (Raj is leader)
  const arunCareTeamId = uuid();
  await db.prepare(
    "INSERT INTO care_teams (id, name, care_recipient_id, created_by) VALUES (?, ?, ?, ?)"
  ).run(arunCareTeamId, "Arun Patel's Care Team", arunId, patelFamilyId);
  await db.prepare(
    "INSERT INTO care_team_members (id, care_team_id, user_id, role, invited_by) VALUES (?, ?, ?, 'leader', ?)"
  ).run(uuid(), arunCareTeamId, patelFamilyId, patelFamilyId);

  // Carlos's Care Team (Maria is leader — she coordinates her brother's care)
  const carlosCareTeamId = uuid();
  await db.prepare(
    "INSERT INTO care_teams (id, name, care_recipient_id, created_by) VALUES (?, ?, ?, ?)"
  ).run(carlosCareTeamId, "Carlos Santos's Care Team", carlosId, mariaUserId);
  await db.prepare(
    "INSERT INTO care_team_members (id, care_team_id, user_id, role, invited_by) VALUES (?, ?, ?, 'leader', ?)"
  ).run(uuid(), carlosCareTeamId, mariaUserId, mariaUserId);

  console.log("✅ Care teams created (4 — Barbara with 3 members, Dorothy, Arun, Carlos)");

  // ─── Care Team Conversations ───
  const bettyCareTeamConvId = uuid();
  await db.prepare(
    "INSERT INTO conversations (id, type, name, care_team_id, created_by) VALUES (?, 'care_team', ?, ?, ?)"
  ).run(bettyCareTeamConvId, "Barbara Lowe's Care Team", bettyCareTeamId, peteId);

  // Add all 3 Lowe siblings to the care team conversation
  for (const [userId, role] of [[peteId, "admin"], [davidLeeId, "member"], [susanLeeId, "member"]]) {
    await db.prepare(
      "INSERT INTO conversation_members (id, conversation_id, user_id, role, last_read_at) VALUES (?, ?, ?, ?, NOW())"
    ).run(uuid(), bettyCareTeamConvId, userId, role);
  }

  // Seed group messages in the care team chat — more realistic family coordination
  const teamMsgs = [
    [uuid(), peteId, bettyCareTeamConvId, "Hey everyone — I set up this group chat so we can coordinate Barbara's care more easily. Let's use it for updates, scheduling, and anything urgent.", "-5 days"],
    [uuid(), davidLeeId, bettyCareTeamConvId, "Great idea Paul. I'm covering this week while you're traveling. Maria and I already connected — she'll send me daily updates.", "-5 days"],
    [uuid(), susanLeeId, bettyCareTeamConvId, "Love this! I'll handle the medication side — tracking refills and Dr. Patel appointments.", "-5 days"],
    [uuid(), peteId, bettyCareTeamConvId, "Perfect division of labor. Quick update: Barbara's next appointment with Dr. Patel is March 3. I'll be back by then. Things to discuss: knee pain, sleep issues, Donepezil dosage review.", "-4 days"],
    [uuid(), davidLeeId, bettyCareTeamConvId, "Update from today: Maria said Barbara was in wonderful spirits. Ate a full lunch, did gentle stretches, and napped from 2-3. The kids video called her at 2pm and she was laughing the whole time.", "-2 days"],
    [uuid(), susanLeeId, bettyCareTeamConvId, "Can someone check if Barbara's Donepezil is running low? I want to call in the refill before the weekend.", "-2 days"],
    [uuid(), peteId, bettyCareTeamConvId, "Maria checked — she has 5 tablets left, enough through Friday. Susan, can you call Dr. Patel's office for the refill?", "-1 day"],
    [uuid(), susanLeeId, bettyCareTeamConvId, "Done! CVS will have it ready Friday after 10am. Maria said she'd pick it up on her way to Barbara's. Also I asked the nurse about the knee — Ibuprofen PRN is fine, plus ice 15 min after walks.", "-1 day"],
    [uuid(), davidLeeId, bettyCareTeamConvId, "Barbara mentioned she wants to plant tomatoes this spring. Maybe we can set that up next weekend? She was so excited talking about it.", "-8 hours"],
    [uuid(), susanLeeId, bettyCareTeamConvId, "She would love that! I'll pick up some seedlings from the garden center. Paul — does she still have the pots from last year?", "-5 hours"],
    [uuid(), peteId, bettyCareTeamConvId, "The pots are in the garage! I'll ask Maria to move them to the back patio this week. Barbara will be over the moon.", "-2 hours"],
  ];

  for (const [id, senderId, conversationId, content, timeOffset] of teamMsgs) {
    await db.prepare(`
      INSERT INTO messages (id, sender_id, conversation_id, content, is_read, created_at)
      VALUES (?, ?, ?, ?, 1, NOW() + ?::interval)
    `).run(id, senderId, conversationId, content, timeOffset);
  }

  console.log("✅ Care team conversation created (Barbara's team with 11 group messages)");

  // ─── AI Care Summaries (pre-generated for demo) ───
  console.log("🤖 Creating AI care summaries...");

  const barbaraSummary = `Barbara is doing well overall. She's in good spirits and enjoys her regular routine of meals, photo albums, and light gardening. Her dementia symptoms remain stable — she occasionally forgets recent conversations but long-term memory is strong. She recognized all family members on the last video call and was animated and laughing.

Key observations from recent visits:
• Appetite is healthy — she's eating full meals and enjoying Maria's cooking
• Knee pain is manageable with Ibuprofen PRN; ice after walks helps
• Sleep has been mostly good, though she occasionally wakes early (5-6am)
• She's been asking about planting tomatoes this spring — a positive sign of forward-thinking engagement
• Medication adherence is good with caregiver reminders; Donepezil supply needs regular monitoring

Care team coordination is strong. Maria handles most weekday visits, James covers companionship sessions, and the family stays connected through group messages. Dr. Patel follow-up is scheduled for next week — bring medication list and discuss knee pain and sleep patterns.`;

  const dorothySummary = `Dorothy continues to manage her diabetes well with consistent meal prep support. Her blood sugar readings have been stable, and she's following her dietary guidelines. Hearing loss is the primary daily challenge — caregivers should face her directly when speaking and minimize background noise.

Recent highlights:
• Enjoying weekly card game sessions — good for cognitive stimulation
• Baking has become a favorite activity (diabetic-friendly recipes)
• Social engagement is positive; she looks forward to caregiver visits
• Mobility is good for her age; no falls or balance concerns recently`;

  const arunSummary = `Arun's Parkinson's symptoms are progressing slowly. Hand tremors are more noticeable in the mornings before medication takes effect. He remains fiercely independent and prefers to attempt tasks himself before accepting help — caregivers should respect this while staying nearby for safety.

Key notes:
• Chess remains his favorite activity and helps with cognitive engagement
• Fine motor tasks (buttoning shirts, writing) are becoming harder — occupational therapy may help
• Mood has improved since starting regular caregiver visits; less isolated
• Enjoys classical music during meals — calming effect on tremors
• Dog (Kavi) is a great companion; walks with Kavi are good exercise`;

  const carlosSummary = `Carlos is making excellent progress in his TBI recovery. Word recall has improved noticeably over the past month — he won at Scrabble recently and was able to complete a full grocery shopping trip independently (with caregiver accompaniment). His therapy dog Biscuit continues to provide emotional support.

Recovery milestones:
• Grocery shopping milestone achieved — first time since accident
• Word recall improving; conversational fluency much better
• Physical stamina increasing; can handle 2-3 hour outings
• Emotional regulation improved; fewer frustration episodes
• Next goal: resume light cooking with caregiver supervision`;

  await db.prepare("UPDATE care_recipients SET ai_care_summary = ?, ai_care_summary_updated_at = NOW() - INTERVAL '4 hours' WHERE id = ?").run(barbaraSummary, bettyId);
  await db.prepare("UPDATE care_recipients SET ai_care_summary = ?, ai_care_summary_updated_at = NOW() - INTERVAL '5 days' WHERE id = ?").run(dorothySummary, dorothyId);
  await db.prepare("UPDATE care_recipients SET ai_care_summary = ?, ai_care_summary_updated_at = NOW() - INTERVAL '3 days' WHERE id = ?").run(arunSummary, arunId);
  await db.prepare("UPDATE care_recipients SET ai_care_summary = ?, ai_care_summary_updated_at = NOW() - INTERVAL '1 day' WHERE id = ?").run(carlosSummary, carlosId);

  // ─── Pre-generated Care Plan for Barbara (persists in demo) ───
  const barbaraCarePlan = JSON.stringify({
    goals: [
      { title: "Maintain cognitive engagement", description: "Daily activities that exercise memory and problem-solving: puzzles, photo albums, Scrabble, recipe recall. Track puzzle completion times as a soft metric.", priority: "high" },
      { title: "Support safe mobility", description: "Daily walks (yard or block) with caregiver present. Monitor porch steps and uneven surfaces. Balance check at each visit. Report any vertigo episodes to Dr. Patel.", priority: "high" },
      { title: "Medication adherence", description: "Donepezil 10mg every evening, Lisinopril 10mg every morning, baby aspirin 81mg daily. Organize weekly pill box at Monday visit. Track refill dates — Donepezil supply runs low easily.", priority: "high" },
      { title: "Nutrition and hydration", description: "Three full meals daily with caregiver prep. Barbara enjoys helping (snapping beans, peeling potatoes). Favorite comfort foods: pot roast, chicken pot pie, French toast. Ensure adequate water intake — she forgets to drink.", priority: "medium" },
      { title: "Emotional wellbeing", description: "Photo albums and gardening are reliable mood boosters. Music calms frustration episodes. Watch for post-nap disorientation (brief, resolves in 5 min — normal pattern). Allow tearful moments about late husband without redirecting — she says they are 'good tears.'", priority: "medium" },
      { title: "Spring garden project", description: "Barbara has expressed strong interest in planting tomatoes. This is a positive sign of forward-thinking engagement. Plan a small raised-bed garden project with Maria as a therapeutic activity.", priority: "low" },
    ],
    schedule: "Maria handles primary care (weekday meals and companionship, 5-7 hrs/visit). James provides companionship backup. David and Susan handle transport and weekend check-ins. Aim for daily caregiver contact.",
    watchItems: [
      "Vertigo episodes — log frequency and duration, report to Dr. Patel at next visit",
      "Button/fine motor difficulty — may need adaptive clothing if arthritis worsens",
      "Repetitive questions increasing — track frequency, current baseline is 2-3x per visit on familiar topics",
      "Post-nap confusion — currently brief (5 min), escalate if duration increases",
      "Sleep disruption — occasional early waking (5-6am), monitor pattern",
    ],
    nextReview: "After Dr. Patel follow-up appointment (scheduled within 2 weeks)",
  });

  await db.prepare("UPDATE care_recipients SET ai_care_plan = ?, ai_care_plan_updated_at = NOW() - INTERVAL '4 hours' WHERE id = ?").run(barbaraCarePlan, bettyId);

  console.log("✅ AI care summaries + Barbara care plan set for all 4 care recipients");

  // ─── User Feedback (demo entries) ───
  console.log("💬 Creating demo feedback entries...");

  const feedbackEntries = [
    [uuid(), peteId, "feature", "It would be great to have a shared calendar view where all family members can see upcoming care sessions at a glance — like a family-wide schedule.", "positive", null, "dashboard", null, "resolved"],
    [uuid(), mariaUserId, "praise", "The check-in/check-out flow is really smooth. I love that families get notified automatically when I arrive. Makes everything feel professional.", "positive", null, "caregiver-dashboard", null, "acknowledged"],
    [uuid(), jamesUserId, "bug", "The notification sound doesn't play when I get a new care request. I have to keep checking the app manually.", "neutral", null, "notifications", null, "in_progress"],
    [uuid(), peteId, "feature", "Can you add medication reminders that sync with care sessions? So when Maria arrives, she gets a reminder about which meds are due.", "positive", null, "care-profile", null, "planned"],
    [uuid(), hendersonFamilyId, "praise", "Thank you for building this. Coordinating care for Mom used to mean 50 text messages a day between family members. Now everything is in one place.", "positive", null, "care-team", null, "acknowledged"],
    [uuid(), mariaUserId, "feature", "Would love to see my earnings broken down by family/care recipient. Right now I can see the total but not which families contributed what.", "neutral", null, "payments", null, "planned"],
    [uuid(), sarahUserId, "bug", "When I try to set my availability for a specific date, it sometimes shows the wrong time zone. I'm in Eastern but it shows Pacific.", "negative", null, "availability", null, "in_progress"],
    [uuid(), patelFamilyId, "praise", "The AI care summary is incredibly helpful. It's like having a care coordinator who reads all the visit notes and gives you the highlights.", "positive", null, "care-profile", null, "acknowledged"],
  ];

  for (const [id, userId, category, description, mood, screenshot, pageCtx, tags, status] of feedbackEntries) {
    await trySavepoint(() => db.prepare(`
        INSERT INTO feedback (id, user_id, category, description, mood, screenshot, page_context, tags, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW() - (random() * INTERVAL '14 days'))
      `).run(id, userId, category, description, mood, screenshot, pageCtx, tags, status));
  }

  console.log("✅ Feedback entries created (8 demo entries)");

  // ─── Seed Version Marker ───
  // Store version in waitlist with special internal email so server.js can detect stale demo data
  // ─── Help/FAQ Articles ───
  console.log("📖 Creating help articles...");
  // Clear all help articles to prevent duplicates on reseed
  await db.prepare("DELETE FROM help_articles").run();

  const helpArticles = [
    // Getting Started
    { category: 'getting-started', question: 'How do I install InPlace on my iPhone or iPad?', answer: 'Open Safari and navigate to yourinplace.com. Tap the Share button (the square with an arrow pointing up) at the bottom of the screen, then scroll down and tap "Add to Home Screen." Name it "InPlace" and tap Add. The app icon will appear on your home screen and works just like a native app — with push notifications, offline access, and full-screen mode.', sort_order: 1 },
    { category: 'getting-started', question: 'How do I install InPlace on my Android phone?', answer: 'Open Chrome and go to yourinplace.com. You should see a banner at the bottom saying "Add InPlace to Home screen" — tap it and confirm. If the banner doesn\'t appear, tap the three-dot menu in the top right corner, then tap "Install app" or "Add to Home screen." The app will install and appear in your app drawer.', sort_order: 2 },
    { category: 'getting-started', question: 'How do I install InPlace on my computer?', answer: 'Open Chrome, Edge, or Brave and go to yourinplace.com. Look for the install icon in the address bar (a small monitor with a down arrow) and click it. Or click the three-dot menu and select "Install InPlace." The app will open in its own window and you can pin it to your taskbar or dock.', sort_order: 3 },
    { category: 'getting-started', question: 'What are the different account types?', answer: 'InPlace has three account types:\n\n**Family Member** — For people coordinating care for a loved one. You can search for caregivers, schedule sessions, manage your care team, and track care activity.\n\n**Caregiver** — For people providing care services. You can set your availability, accept care requests, track your earnings, and manage your schedule.\n\n**Care Recipient** — For the person receiving care. You can view your calendar, make care requests, and keep personal notes.\n\nYou can add a second role to your account anytime from My Account.', sort_order: 4 },
    { category: 'getting-started', question: 'How do I add a second role to my account?', answer: 'Go to My Account and scroll down to the "Add a Role" section. You\'ll see the roles you don\'t have yet — tap one to add it. Once added, a role switcher will appear at the top of your screen so you can flip between views without logging out.', link_page: 'account', link_label: 'Go to My Account', sort_order: 5 },
    { category: 'getting-started', question: 'How do I create an account?', answer: 'Go to yourinplace.com and tap "Get Started." Choose your account type — finding care for a loved one, providing care, or getting help for yourself. Fill in your details and follow the setup steps. Your account will be reviewed and approved before you can access the full platform. Once approved, you\'ll receive an email to verify your address and finish sign-up.', sort_order: 6 },

    // Families
    { category: 'families', question: 'How do I find caregivers near me?', answer: 'Go to the Caregivers page from the sidebar. You\'ll see a map and a list of available caregivers in your area. You can filter by distance, availability, specialties, and rates. Tap on any caregiver to see their full profile, reviews, and schedule.', link_page: 'caregivers', link_label: 'Find Caregivers', role_visibility: '["family"]', sort_order: 1 },
    { category: 'families', question: 'How do I request care for my loved one?', answer: 'Tap "Request Care" on your dashboard. The care request wizard will walk you through selecting your loved one, choosing a date and time, picking services needed, selecting a caregiver (or posting an open request), and reviewing the details before submitting.', role_visibility: '["family"]', sort_order: 2 },
    { category: 'families', question: 'How do I invite family members to help manage care?', answer: 'Go to the Care Team page and tap "Invite Member." Enter their email address and select their role. They\'ll receive an email invitation to join your care team. Once they accept, they can help manage scheduling, communicate with caregivers, and view care activity.', link_page: 'care-team', link_label: 'Go to Care Team', role_visibility: '["family"]', sort_order: 3 },
    { category: 'families', question: 'How do payments work for families?', answer: 'Payments are handled through Stripe. After a care session is completed, payment is processed automatically based on the session duration and the caregiver\'s rates. You can manage your payment methods from My Account.', role_visibility: '["family"]', sort_order: 4 },

    // Caregivers
    { category: 'caregivers', question: 'How do I get started as a caregiver?', answer: 'After your account is approved, you\'ll see a First Steps checklist on your home screen. Complete each step in order: connect your bank account through Stripe, start your background check, set up account security, choose your care preferences, set your availability and rates, and add a profile photo. Once all steps are done, you can start finding work.', role_visibility: '["caregiver"]', sort_order: 1 },
    { category: 'caregivers', question: 'How do I get paid?', answer: 'Payments are processed through Stripe. During your First Steps setup, you\'ll connect your bank account via Stripe. After each completed care session, payment is deposited directly into your bank account. You can view your earnings from your dashboard.', role_visibility: '["caregiver"]', sort_order: 2 },
    { category: 'caregivers', question: 'What is the background check and how does it work?', answer: 'A background check is required to participate on InPlace. There is a one-time $30 fee that is refunded after you complete 10 care sessions. Your report is reviewed fairly — you\'ll be given a chance to provide context on anything that comes up, and a real person is always in the loop when making decisions about platform access.', role_visibility: '["caregiver"]', sort_order: 3 },
    { category: 'caregivers', question: 'How do I set my availability and rates?', answer: 'From your dashboard, tap on the availability and rates sections. You can set different rates for daytime, nighttime, and overnight hours. Set your weekly availability so families can see when you\'re open for sessions. Families will only be able to book you during the hours you\'ve marked as available.', role_visibility: '["caregiver"]', sort_order: 4 },
    { category: 'caregivers', question: 'How do I find families who need care?', answer: 'Once your First Steps are complete, go to Find Work to browse available care opportunities in your area. You\'ll see open care requests from families. When you see a request that fits your schedule, you can accept it or make an offer.', link_page: 'find-work', link_label: 'Find Work', role_visibility: '["caregiver"]', sort_order: 5 },

    // Technical
    { category: 'technical', question: 'Why am I not receiving notifications?', answer: 'Make sure you\'ve enabled push notifications for InPlace. On iPhone, go to Settings > Notifications > InPlace and ensure notifications are allowed. On Android, long-press the InPlace app icon, tap App Info > Notifications, and enable them. Also check that you have notifications turned on within the app under My Account.', link_page: 'account', link_label: 'Notification Settings', sort_order: 1 },
    { category: 'technical', question: 'The app looks outdated or broken — what do I do?', answer: 'This usually means your browser is showing a cached version of InPlace. Try these steps:\n\n1. Hard refresh: Press Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)\n2. Clear site data: In Chrome, tap the lock icon in the address bar > Site settings > Clear data\n3. Reinstall: If you installed InPlace to your home screen, remove it and add it again from yourinplace.com\n\nIf the problem persists, use the feedback button to let us know what you\'re seeing.', sort_order: 2 },
    { category: 'technical', question: 'How do I reset my password?', answer: 'On the login page, tap "Forgot password?" and enter the email address associated with your account. You\'ll receive an email with a link to create a new password. The link expires after 1 hour. If you don\'t see the email, check your spam folder.', sort_order: 3 },
    { category: 'technical', question: 'Which browsers work best with InPlace?', answer: 'InPlace works on all modern browsers. For the best experience we recommend Safari on iPhone/iPad (required for the home screen app feature), Chrome on Android, and Chrome, Edge, or Brave on desktop. Firefox works for browsing but doesn\'t support installing InPlace as a standalone app.', sort_order: 4 },

    // Billing
    { category: 'billing', question: 'Does InPlace cost anything?', answer: 'There are no subscription fees or platform fees to use InPlace. Families pay caregivers directly for care sessions based on the caregiver\'s posted rates. Payments are processed securely through Stripe.', sort_order: 1 },
    { category: 'billing', question: 'How do payments work?', answer: 'All payments are handled through Stripe. Families are charged after a care session is completed, based on the session duration and the caregiver\'s rates. Caregivers receive payouts directly to their connected bank account. Both families and caregivers can view payment history from their dashboard.', sort_order: 2 },
    { category: 'billing', question: 'What about the caregiver background check fee?', answer: 'Caregivers pay a one-time $30 fee for their background check when getting set up on InPlace. This fee is refunded after the caregiver completes 10 care sessions on the platform.', sort_order: 3 },
  ];

  for (const article of helpArticles) {
    await db.prepare(`
      INSERT INTO help_articles (id, category, question, answer, link_page, link_label, role_visibility, sort_order, is_published)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      uuid(),
      article.category,
      article.question,
      article.answer,
      article.link_page || null,
      article.link_label || null,
      article.role_visibility || null,
      article.sort_order || 0
    );
  }
  console.log(`  ✅ ${helpArticles.length} help articles created`);

  await db.prepare(`
    INSERT INTO waitlist (id, email, name, created_at)
    VALUES (?, '_seed_version@inplace.internal', ?, NOW())
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
  `).run(uuid(), DEMO_SEED_VERSION);

  console.log(`✅ Seed version marker set: ${DEMO_SEED_VERSION}`);
  console.log("\n🎉 Seed complete! Database ready.\n");
  console.log("Demo logins:");
  console.log("  Care Team:       paul@inplace.care       / inplace123");
  console.log("  Sibling (David): david.lowe@inplace.care  / inplace123");
  console.log("  Sibling (Susan): susan.lowe@inplace.care  / inplace123");
  console.log("  Caretaker+Family:maria@inplace.care      / inplace123  (dual role — also manages brother Carlos)");
  console.log("  Cared-For:       barbara@inplace.care    / inplace123\n");

  }); // end atomic transaction — commits on success, rolls back (demo preserved) on any error
}

// Export for in-process seeding from server.js
module.exports = { seed, DEMO_SEED_VERSION };

// Run directly if called from CLI (npm run seed)
if (require.main === module) {
  const force = process.argv.includes("--force");
  const demoOnly = process.argv.includes("--demo-only");
  seed({ force, demoOnly })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}
