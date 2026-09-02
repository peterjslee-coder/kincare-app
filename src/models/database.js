const { Pool, types } = require("pg");
const pg = require("pg");

// Return timestamps as strings (not Date objects) for frontend compatibility
pg.types.setTypeParser(1114, (str) => str); // timestamp without tz
pg.types.setTypeParser(1184, (str) => str); // timestamptz

let pool;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL environment variable is required. Set it in .env for local dev or Railway dashboard for production."
      );
    }
    // v1.73.0 — pg returns NUMERIC as *strings* by default. The v1.62.0 money
    // migration (REAL → NUMERIC(10,2)) silently changed every amount from JS
    // number to string, crashing frontend .toFixed() calls (blank Payments page)
    // and threatening server-side money arithmetic. Parse NUMERIC back to
    // numbers — the contract the whole app was written against. 2-decimal money
    // is exactly representable; precision is enforced by the column type.
    types.setTypeParser(types.builtins.NUMERIC, (v) => (v === null ? null : parseFloat(v)));
    pool = new Pool({
      connectionString,
      max: 10, // explicit (pg default) — raise deliberately, with data (review H4)
      idleTimeoutMillis: 30000, // recycle idle clients
      connectionTimeoutMillis: 10000, // fail loudly if the pool is exhausted instead of queueing forever
      // v1.105.50 — the backstop for the failure this version is about: a transaction left
      // open across a hung network call, holding one of ten pool clients forever. Ten of
      // those is a total outage, and nothing in the app would have said why.
      //
      // Deliberately NOT setting statement_timeout: migrations and index builds run through
      // this same pool at boot and can legitimately take minutes. This setting only fires
      // on a transaction that is open and IDLE, which no healthy path here ever is.
      idle_in_transaction_session_timeout: 30000,
    });

    // ─── v1.105.127 — the whole API used to die here ───
    //
    // node-postgres emits 'error' on a client sitting IDLE in the pool when the
    // connection drops underneath it — a Postgres restart, a Railway network blip, an
    // idle reaper on the server side. EventEmitter's contract is that an 'error' event
    // with NO listener is re-thrown, and there is no process-level uncaughtException
    // handler in this codebase to catch it. So the process exits.
    //
    // This is not theoretical. Sentry INPLACE-C, 2026-08-22T17:43:51Z, on release
    // 17e3b016 (v1.105.126): "Connection terminated unexpectedly", from
    // pg/lib/client.js, tagged mechanism=auto.node.onuncaughtexception, handled=no,
    // level=fatal. The app had booted at 16:47:57Z. It ran fifty-six minutes and then
    // the API was gone. Railway restarted it, which is the only reason nobody noticed —
    // but every request in flight died with it.
    //
    // A dropped idle client is NORMAL and pg recovers from it by itself: the client is
    // discarded and the next caller gets a fresh one. The only thing that made it fatal
    // was that nobody was listening. So listen, report, and carry on. Do not rethrow,
    // do not exit, and do not try to "reconnect" — the pool already does that.
    pool.on("error", (err, client) => {
      console.error("[db] idle client error (pool recovers, process must not die):", err && err.message);
      try {
        require("../utils/sentry").captureException(err, {
          where: "db: idle pool client error",
          // Distinguishes this from the same message arriving as a rejected query,
          // which routes already catch. This one had no owner.
          fatal_without_handler: true,
          hadClient: !!client,
        });
      } catch { /* reporting must never be the thing that throws */ }
    });
  }
  return pool;
}

// Convert SQLite-style ? params to PostgreSQL $1, $2, ...
function convertParams(sql) {
  let idx = 0;
  // v1.105.90 — skip anything that is not actually a placeholder.
  //
  // This was a naive global replace, so EVERY `?` in the string became a bind parameter —
  // including one inside a SQL comment. A comment quoting Pete ("why can't i see the job i
  // posted?") silently became placeholder #11 on a 10-argument query, and every caregiver
  // dashboard 500'd with "bind message supplies 10 parameters, but prepared statement requires
  // 11". The query was correct; the comment was not code.
  //
  // Single-quoted literals are skipped for the same reason: a '?' inside one is data, and
  // there are already queries in this codebase with LIKE patterns and punctuation in strings.
  let out = "";
  for (let i = 0; i < sql.length; i++) {
    const two = sql.slice(i, i + 2);
    if (two === "--") {                       // line comment
      const nl = sql.indexOf("\n", i);
      const end = nl === -1 ? sql.length : nl;
      out += sql.slice(i, end); i = end - 1; continue;
    }
    if (two === "/*") {                       // block comment
      const close = sql.indexOf("*/", i + 2);
      const end = close === -1 ? sql.length : close + 2;
      out += sql.slice(i, end); i = end - 1; continue;
    }
    if (sql[i] === "'") {                     // string literal, '' escapes a quote
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") break;
        j++;
      }
      out += sql.slice(i, j + 1); i = j; continue;
    }
    out += sql[i] === "?" ? `$${++idx}` : sql[i];
  }
  return out;
}

/**
 * Wrapper that mimics the sql.js prepare/run/get/all API
 * so route files need minimal changes (just adding await).
 */
class DatabaseWrapper {
  prepare(sql) {
    const pgSql = convertParams(sql);
    const p = getPool();

    return {
      async run(...params) {
        const result = await p.query(pgSql, params);
        return { changes: result.rowCount };
      },
      async get(...params) {
        const result = await p.query(pgSql, params);
        return result.rows[0] || undefined;
      },
      async all(...params) {
        const result = await p.query(pgSql, params);
        return result.rows;
      },
    };
  }

  async exec(sql) {
    await getPool().query(sql);
  }

  /**
   * Run a callback inside a PostgreSQL transaction.
   * The callback receives a transactional db object with the same prepare/exec API.
   * If the callback throws, the transaction is rolled back.
   *
   * Usage:
   *   await db.transaction(async (tx) => {
   *     await tx.prepare("UPDATE ...").run(param1);
   *     await tx.prepare("DELETE ...").run(param2);
   *   });
   */
  async transaction(fn) {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const tx = {
        prepare(sql) {
          const pgSql = convertParams(sql);
          return {
            async run(...params) {
              const result = await client.query(pgSql, params);
              return { changes: result.rowCount };
            },
            async get(...params) {
              const result = await client.query(pgSql, params);
              return result.rows[0] || undefined;
            },
            async all(...params) {
              const result = await client.query(pgSql, params);
              return result.rows;
            },
          };
        },
        async exec(sql) {
          await client.query(sql);
        },
      };
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

let db;

async function getDb() {
  if (!db) {
    db = new DatabaseWrapper();
  }
  return db;
}


// ─── Batch 5 (v1.63.0): pre-migration safety snapshot ───
// Saves a JSON copy of the money/evidence-critical tables into boot_snapshots
// BEFORE any boot-time migration/backfill runs, so a bad migration can be
// recovered from the previous boot's data. This protects against migration
// bugs (the demo-reseed class of failure) — it is NOT an off-box backup;
// pg_dump via "Backup InPlace DB.command" is still the real backup.
// Fail-open: a snapshot failure logs loudly + reports to Sentry but never
// blocks boot (a blocked boot would be a worse outage than a missing snapshot).
const SNAPSHOT_TABLES = {
  users: { exclude: ["profile_photo"] },            // exclude base64 photo blobs
  care_recipients: { exclude: ["photo"] },
  caregiver_profiles: {},
  payments: {},
  care_sessions: {},
  visit_logs: {},
  session_offers: {},
  background_check_payments: {},
  conversations: {},
  conversation_members: {},
  messages: {},
  admin_audit_log: {},
  audit_log: {},
  reviews: {},
};
const SNAPSHOT_MAX_ROWS_PER_TABLE = 20000; // safety valve against runaway snapshot size
// ─── v1.105.178 — the valve that was missing ───
//
// Railway warned Postgres was at 81% of its volume. `boot_snapshots` was 130.7 MB of a 259.8 MB
// database — HALF of it — in five rows.
//
// The row valve above never fired: `messages` has 433 rows, nowhere near 20,000. But a photo
// message stores its image as a base64 data URI in `content`, and the biggest is 6 MB, so those
// 433 rows are 24 MB — and every boot copied all of it, five times over.
//
// Rows were never the thing worth capping; bytes are. `users.profile_photo` and
// `care_recipients.photo` are already excluded above, which shows the author knew blobs were the
// risk — the miss is that a blob can hide inside an ordinary-looking TEXT column too.
const SNAPSHOT_MAX_BYTES_PER_TABLE = 4 * 1024 * 1024;
const SNAPSHOT_KEEP = 5;

async function preMigrationSnapshot(db) {
  try {
    await db.exec(`CREATE TABLE IF NOT EXISTS boot_snapshots (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      data JSONB NOT NULL
    )`);
    const snap = { _meta: { taken_at: new Date().toISOString(), note: "pre-migration boot snapshot" } };
    for (const [table, opts] of Object.entries(SNAPSHOT_TABLES)) {
      const reg = await db.prepare("SELECT to_regclass(?) AS t").get("public." + table);
      if (!reg || !reg.t) continue; // table doesn't exist yet (fresh DB)
      const cols = await db.prepare(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ?"
      ).all(table);
      const keep = cols.map((c) => c.column_name).filter((c) => !(opts.exclude || []).includes(c));
      if (!keep.length) continue;
      const cnt = await db.prepare(`SELECT COUNT(*)::int AS n FROM ${table}`).get();
      if (cnt.n > SNAPSHOT_MAX_ROWS_PER_TABLE) {
        snap._meta["skipped_" + table] = `row count ${cnt.n} exceeds cap`;
        continue;
      }
      // v1.105.178 — and how big those rows actually are. pg_total_relation_size includes
      // TOAST, which is exactly where a base64 photo in a TEXT column lives; measuring the
      // main fork alone would report `messages` as small and copy 24 MB anyway.
      const size = await db.prepare(
        "SELECT pg_total_relation_size(to_regclass(?))::bigint AS bytes"
      ).get("public." + table);
      const bytes = Number(size?.bytes || 0);
      if (bytes > SNAPSHOT_MAX_BYTES_PER_TABLE) {
        // Loud in _meta rather than silent: a snapshot that quietly stopped covering the
        // messages table would be a safety net with a hole in it that nobody could see. The
        // real backup is still the nightly pg_dump — this is only the pre-migration undo.
        snap._meta["skipped_" + table] = `size ${(bytes / 1048576).toFixed(1)} MB exceeds ${(SNAPSHOT_MAX_BYTES_PER_TABLE / 1048576).toFixed(0)} MB cap`;
        continue;
      }
      const colList = keep.map((c) => `"${c}"`).join(", ");
      snap[table] = await db.prepare(`SELECT ${colList} FROM ${table}`).all();
    }
    await db.prepare("INSERT INTO boot_snapshots (data) VALUES (?)").run(JSON.stringify(snap));
    await db.prepare(
      "DELETE FROM boot_snapshots WHERE id NOT IN (SELECT id FROM boot_snapshots ORDER BY created_at DESC, id DESC LIMIT ?)"
    ).run(SNAPSHOT_KEEP);
    const tableCount = Object.keys(snap).length - 1;
    console.log(`\u2705 Pre-migration snapshot saved (${tableCount} tables, keeping last ${SNAPSHOT_KEEP})`);
  } catch (err) {
    console.error("\u26a0\ufe0f  Pre-migration snapshot FAILED (boot continues):", err.message);
    try { require("../utils/sentry").captureException(err, { where: "preMigrationSnapshot" }); } catch (_) { /* noop */ }
  }
}

async function initializeDatabase() {
  const db = await getDb();

  // Snapshot critical tables BEFORE any migration/backfill below can touch them.
  await preMigrationSnapshot(db);

  // ┌──────────────────────────────────────────────────────────────────────┐
  // │  ⚠️  PHI (Protected Health Information) FIELD REGISTRY             │
  // │                                                                      │
  // │  HIPAA Decision Pending — see ROADMAP.md "HIPAA & PHI" section.     │
  // │  Fields tagged /* PHI */ below contain or may contain health info    │
  // │  tied to identifiable individuals. Before going live with real       │
  // │  users, we must either:                                              │
  // │   (A) Obtain BAAs from all services that store/process these fields  │
  // │       (Railway, Turso, any AI APIs), OR                              │
  // │   (B) Remove these fields entirely and add a disclaimer:             │
  // │       "InPlace does not store or process medical information."        │
  // │                                                                      │
  // │  Tables with PHI fields:                                             │
  // │   • care_recipients: health_conditions, medications,                 │
  // │     medical_conditions, food_allergies, pet_allergies,               │
  // │     care_preferences (follow-up details may contain medical info)    │
  // │   • users: medical_conditions, food_allergies, pet_allergies         │
  // │   • visit_logs: summary, notes, mood_rating, tasks_completed        │
  // │   • recipient_notes: content                                         │
  // │   • messages: content (may contain health discussions)               │
  // │   • care_sessions: special_instructions (may reference health)       │
  // │                                                                      │
  // │  Safe fields (NOT PHI): names, emails, phones, addresses,           │
  // │   ages, payment data, caregiver profiles/rates, consent records,    │
  // │   scheduling data, assignment records.                               │
  // └──────────────────────────────────────────────────────────────────────┘

  const statements = [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL, phone TEXT, avatar_url TEXT, notification_prefs TEXT, is_active INTEGER DEFAULT 1, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
    /* PHI fields in care_recipients: health_conditions, medications, preferences (care_preferences follow-ups) */
    `CREATE TABLE IF NOT EXISTS care_recipients (id TEXT PRIMARY KEY, family_user_id TEXT NOT NULL REFERENCES users(id), first_name TEXT NOT NULL, last_name TEXT NOT NULL, age INTEGER, location_address TEXT, location_city TEXT, location_state TEXT, location_zip TEXT, latitude REAL, longitude REAL, health_conditions TEXT /* PHI */, medications TEXT /* PHI */, preferences TEXT, emergency_contact_name TEXT, emergency_contact_phone TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS caregiver_profiles (id TEXT PRIMARY KEY, user_id TEXT UNIQUE NOT NULL REFERENCES users(id), bio TEXT, years_experience INTEGER DEFAULT 0, hourly_rate REAL NOT NULL, specialties TEXT, certifications TEXT, max_travel_miles REAL DEFAULT 10, is_background_checked INTEGER DEFAULT 0, is_available INTEGER DEFAULT 0 /* v1.104.2: new caregivers start unavailable; wizard completion flips it */, rating_avg REAL DEFAULT 0, rating_count INTEGER DEFAULT 0, location_city TEXT, location_state TEXT, latitude REAL, longitude REAL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS availability (id TEXT PRIMARY KEY, caregiver_id TEXT NOT NULL REFERENCES caregiver_profiles(id), day_of_week INTEGER NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, is_recurring INTEGER DEFAULT 1, specific_date TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    /* PHI risk in care_sessions: special_instructions — may reference health needs */
    `CREATE TABLE IF NOT EXISTS care_sessions (id TEXT PRIMARY KEY, care_recipient_id TEXT NOT NULL REFERENCES care_recipients(id), family_user_id TEXT NOT NULL REFERENCES users(id), caregiver_id TEXT REFERENCES caregiver_profiles(id), service_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', scheduled_date TEXT NOT NULL, scheduled_time TEXT NOT NULL, duration_hours REAL NOT NULL DEFAULT 2, special_instructions TEXT /* PHI-risk */, estimated_cost REAL, actual_cost REAL, cancellation_reason TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
    /* PHI fields in visit_logs: summary, mood_rating, tasks_completed, notes — caregivers may document health observations */
    `CREATE TABLE IF NOT EXISTS visit_logs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES care_sessions(id), caregiver_id TEXT NOT NULL REFERENCES caregiver_profiles(id), check_in_time TIMESTAMPTZ, check_out_time TIMESTAMPTZ, summary TEXT /* PHI */, mood_rating TEXT /* PHI */, tasks_completed TEXT /* PHI */, notes TEXT /* PHI */, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS visit_photos (id TEXT PRIMARY KEY, visit_log_id TEXT NOT NULL REFERENCES visit_logs(id), photo_url TEXT NOT NULL, caption TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS activity_feed (id TEXT PRIMARY KEY, family_user_id TEXT NOT NULL REFERENCES users(id), care_recipient_id TEXT REFERENCES care_recipients(id), event_type TEXT NOT NULL, title TEXT NOT NULL, message TEXT, metadata TEXT, is_read INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES care_sessions(id), family_user_id TEXT NOT NULL REFERENCES users(id), caregiver_id TEXT NOT NULL REFERENCES caregiver_profiles(id), rating INTEGER NOT NULL, comment TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES care_sessions(id), family_user_id TEXT NOT NULL REFERENCES users(id), caregiver_id TEXT NOT NULL REFERENCES caregiver_profiles(id), amount REAL NOT NULL, platform_fee REAL NOT NULL, caregiver_payout REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending', payment_method TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    /* PHI risk in messages: content — families and caregivers may discuss health topics */
    `CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, sender_id TEXT NOT NULL REFERENCES users(id), recipient_id TEXT NOT NULL REFERENCES users(id), content TEXT NOT NULL /* PHI-risk */, is_read INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
    /* PHI fields in recipient_notes: content — free-text notes about care recipients likely contain health info */
    `CREATE TABLE IF NOT EXISTS recipient_notes (id TEXT PRIMARY KEY, care_recipient_id TEXT NOT NULL REFERENCES care_recipients(id), author_id TEXT NOT NULL REFERENCES users(id), content TEXT NOT NULL /* PHI */, note_type TEXT DEFAULT 'general', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS caregiver_assignments (id TEXT PRIMARY KEY, care_recipient_id TEXT NOT NULL REFERENCES care_recipients(id), family_user_id TEXT NOT NULL REFERENCES users(id), caregiver_profile_id TEXT NOT NULL REFERENCES caregiver_profiles(id), is_active INTEGER DEFAULT 1, is_favorite INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS waitlist (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, role TEXT DEFAULT 'family', source TEXT DEFAULT 'splash', created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS password_reset_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), token TEXT UNIQUE NOT NULL, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`,
  ];

  for (const sql of statements) {
    await db.exec(sql);
  }

  // Email verification tokens table
  await db.exec(`CREATE TABLE IF NOT EXISTS email_verification_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), token TEXT UNIQUE NOT NULL, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`);

  // Signup intents — email-first signup flow (pre-registration)
  await db.exec(`CREATE TABLE IF NOT EXISTS signup_intents (id TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'family', token TEXT UNIQUE NOT NULL, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`);

  // Push notification subscriptions table
  await db.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), endpoint TEXT NOT NULL, subscription_json TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);

  // Shared care recipients — allow multiple family members to access the same care recipient
  await db.exec(`CREATE TABLE IF NOT EXISTS care_recipient_shares (id TEXT PRIMARY KEY, care_recipient_id TEXT NOT NULL REFERENCES care_recipients(id), shared_with_user_id TEXT NOT NULL REFERENCES users(id), permission TEXT DEFAULT 'view', shared_by_user_id TEXT NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT NOW())`);

  // OAuth linked accounts (Google, Apple, etc.)
  await db.exec(`CREATE TABLE IF NOT EXISTS oauth_accounts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), provider TEXT NOT NULL, provider_user_id TEXT NOT NULL, provider_email TEXT, access_token TEXT, refresh_token TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);

  // TOTP two-factor authentication
  await db.exec(`CREATE TABLE IF NOT EXISTS user_2fa (id TEXT PRIMARY KEY, user_id TEXT UNIQUE NOT NULL REFERENCES users(id), totp_secret TEXT NOT NULL, is_enabled INTEGER DEFAULT 0, backup_codes TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);

  // Trusted devices (remember this device for 2FA bypass)
  await db.exec(`CREATE TABLE IF NOT EXISTS trusted_devices (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), device_fingerprint TEXT NOT NULL, device_name TEXT, last_used TIMESTAMPTZ DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`);

  // Care teams — group of people coordinating care for one recipient
  await db.exec(`CREATE TABLE IF NOT EXISTS care_teams (id TEXT PRIMARY KEY, name TEXT NOT NULL, care_recipient_id TEXT NOT NULL REFERENCES care_recipients(id), created_by TEXT NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);

  // Care team members
  await db.exec(`CREATE TABLE IF NOT EXISTS care_team_members (id TEXT PRIMARY KEY, care_team_id TEXT NOT NULL REFERENCES care_teams(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL DEFAULT 'member', invited_by TEXT REFERENCES users(id), joined_at TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW())`);

  // Care team invites (email-based, token-verified)
  await db.exec(`CREATE TABLE IF NOT EXISTS care_team_invites (id TEXT PRIMARY KEY, care_team_id TEXT NOT NULL REFERENCES care_teams(id), invited_email TEXT NOT NULL, invited_by TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL DEFAULT 'member', token TEXT UNIQUE NOT NULL, status TEXT NOT NULL DEFAULT 'pending', expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`);

  // Platform-wide invites (admin-sent, for onboarding new users)
  await db.exec(`CREATE TABLE IF NOT EXISTS platform_invites (id TEXT PRIMARY KEY, invited_email TEXT NOT NULL, invited_by TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL DEFAULT 'caregiver', token TEXT UNIQUE NOT NULL, status TEXT NOT NULL DEFAULT 'pending', expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`);

  // Caregiver identity/certification document images
  await db.exec(`CREATE TABLE IF NOT EXISTS caregiver_documents (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), document_type TEXT NOT NULL, file_data TEXT NOT NULL, file_name TEXT, metadata TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);

  // User feedback submissions
  await db.exec(`CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), category TEXT NOT NULL, description TEXT NOT NULL, mood TEXT, screenshot TEXT, page_context TEXT, tags TEXT, status TEXT NOT NULL DEFAULT 'new', admin_notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);

  // Background check payments (one-time $30 fee for caregivers)
  await db.exec(`CREATE TABLE IF NOT EXISTS background_check_payments (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), stripe_payment_intent TEXT UNIQUE, amount REAL DEFAULT 30, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW(), completed_at TIMESTAMPTZ)`);

  // Payout preferences (caregiver payout speed selection)
  await db.exec(`CREATE TABLE IF NOT EXISTS payout_preferences (id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id), speed TEXT DEFAULT 'standard', updated_at TIMESTAMPTZ DEFAULT NOW())`);

  // Conversations (direct, group, care_team)
  await db.exec(`CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, type TEXT NOT NULL DEFAULT 'direct', name TEXT, care_team_id TEXT REFERENCES care_teams(id), created_by TEXT REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);

  // Conversation members
  await db.exec(`CREATE TABLE IF NOT EXISTS conversation_members (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL DEFAULT 'member', joined_at TIMESTAMPTZ DEFAULT NOW(), last_read_at TIMESTAMPTZ)`);

  // User connections (friend/contact requests)
  await db.exec(`CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, requester_id TEXT NOT NULL REFERENCES users(id), recipient_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);

  // Help/FAQ articles (admin-managed, dynamic)
  await db.exec(`CREATE TABLE IF NOT EXISTS help_articles (id TEXT PRIMARY KEY, category TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, link_page TEXT, link_label TEXT, role_visibility TEXT, sort_order INTEGER DEFAULT 0, is_published INTEGER DEFAULT 1, related_feedback_ids TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);

  // Blocked emails (admin-managed registration blocklist)
  await db.exec(`CREATE TABLE IF NOT EXISTS blocked_emails (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, reason TEXT, blocked_by TEXT REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT NOW())`);

  // Session offers (negotiation / counter-offer chain)
  await db.exec(`CREATE TABLE IF NOT EXISTS session_offers (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES care_sessions(id), from_user_id TEXT NOT NULL REFERENCES users(id), to_user_id TEXT NOT NULL REFERENCES users(id), offered_rate REAL NOT NULL, message TEXT, status TEXT NOT NULL DEFAULT 'pending', parent_offer_id TEXT, round_number INTEGER NOT NULL DEFAULT 1, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`);

  // Platform settings (key-value store for auto-generated config like VAPID keys)
  await db.exec(`CREATE TABLE IF NOT EXISTS platform_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);

  // Passkeys (WebAuthn) — passwordless login via biometrics/security keys
  await db.exec(`CREATE TABLE IF NOT EXISTS user_passkeys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), credential_id TEXT NOT NULL UNIQUE, public_key TEXT NOT NULL, counter BIGINT DEFAULT 0, device_type TEXT, backed_up INTEGER DEFAULT 0, transports TEXT, name TEXT DEFAULT 'Passkey', created_at TIMESTAMPTZ DEFAULT NOW(), last_used TIMESTAMPTZ)`);

  // Admin audit log — tracks all admin actions for accountability
  await db.exec(`CREATE TABLE IF NOT EXISTS admin_audit_log (id TEXT PRIMARY KEY, admin_user_id TEXT NOT NULL, action TEXT NOT NULL, target_type TEXT, target_id TEXT, details TEXT, ip_address TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);

  // ─── v1.64.0 (honest-override batch): admin vouches ───
  // A vouch is an admin's approval of ONE caregiver working for ONE family
  // ("I can vouch for this pair") — it is NOT a background check and never
  // displays as one. Gates: vouched caregivers can claim/work jobs only for
  // their vouched family; a real Checkr result (is_background_checked=1) is
  // required for everything else. bg_check_admin_approved is deprecated from
  // all gates in favor of this table.
  await db.exec(`CREATE TABLE IF NOT EXISTS bg_admin_vouches (
    id TEXT PRIMARY KEY,
    caregiver_user_id TEXT NOT NULL REFERENCES users(id),
    family_user_id TEXT NOT NULL REFERENCES users(id),
    vouched_by TEXT NOT NULL,
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    revoked_by TEXT
  )`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_vouches_caregiver ON bg_admin_vouches(caregiver_user_id) WHERE revoked_at IS NULL`);

  // Migrations for existing databases
  // ⚠️  FROZEN as baseline '000_legacy_baseline' (v1.82.0) — runs ONCE per database.
  // DO NOT add new statements here; they will never execute on existing databases.
  // Add new schema changes to MIGRATIONS_V2 (defined after this array runs).
  const migrations = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_prefs TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ`,
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS recurrence_rule TEXT`,
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS recurrence_group_id TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_demo INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ`,
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS linked_user_id TEXT REFERENCES users(id)`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS conversation_id TEXT REFERENCES conversations(id)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_tester INTEGER DEFAULT 0`,
    // Availability table: add type and note columns
    `ALTER TABLE availability ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'available'`,
    `ALTER TABLE availability ADD COLUMN IF NOT EXISTS note TEXT`,
    // Ensure admin_role column exists before the promote below (its dedicated
    // ADD COLUMN runs later in this list, which previously made this UPDATE fail).
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_role TEXT`,
    // Auto-promote Pete's real account to admin    // Backfill is_demo flag for demo accounts seeded before the column existed.
    // Batch 5 (v1.63.0): guarded one-time via platform_settings marker — previously
    // this re-ran every boot, so a real user later registered with one of these
    // legacy addresses would silently be flagged demo. Runs once more, then never again.
    `UPDATE users SET is_demo = 1
       WHERE email IN ('pete@inplace.care', 'david.lee@inplace.care', 'susan.lee@inplace.care', 'maria@inplace.care', 'betty@inplace.care')
         AND NOT EXISTS (SELECT 1 FROM platform_settings WHERE key = 'migr_is_demo_backfill_v1')`,
    `INSERT INTO platform_settings (key, value) VALUES ('migr_is_demo_backfill_v1', 'done') ON CONFLICT (key) DO NOTHING`,
    // Caregiver profile: Checkr background check fields
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS legal_first_name TEXT`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS legal_last_name TEXT`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS date_of_birth TEXT`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS ssn_last4 TEXT`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS address_line1 TEXT`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS address_line2 TEXT`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS zip TEXT`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS dl_number TEXT`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS dl_state TEXT`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS checkr_status TEXT DEFAULT 'pending'`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS checkr_candidate_id TEXT`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS checkr_invitation_id TEXT`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS checkr_report_id TEXT`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS background_check_consent INTEGER DEFAULT 0`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS background_check_consent_at TIMESTAMPTZ`,
    // v1.5.0 — Caregiver work location, stoplight, terms
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS work_location_address TEXT`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS work_latitude REAL`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS work_longitude REAL`,
    // v1.105.121 — how we came to know where she is: 'address' (geocoded from what she typed)
    // or 'device' (her phone, coarsened to ~1 mile). NULL means we do not know, which is now a
    // state with consequences rather than a quiet gap.
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS location_source TEXT`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS care_stoplight TEXT`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS terms_version TEXT`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS onboarding_complete INTEGER DEFAULT 0`,
    // v1.5.0 — Care recipient health profile
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS pets TEXT`,
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS pet_allergies TEXT`, /* PHI */
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS food_allergies TEXT`, /* PHI */
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS medical_conditions TEXT`, /* PHI */
    // v1.5.0 — User health/pet profile (for caregivers and family)
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS pets TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS pet_allergies TEXT`, /* PHI */
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS food_allergies TEXT`, /* PHI */
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS medical_conditions TEXT`, /* PHI */
    // v1.5.0 — Message type for special messages (video_call, system, etc.)
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type TEXT DEFAULT 'text'`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata TEXT`,
    // Profile photo for user avatars
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo TEXT`,
    // Medical care disclaimer
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS disclaimer_accepted_at TIMESTAMPTZ`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS disclaimer_version TEXT`,
    // Stripe Connect for caregivers
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS stripe_account_id TEXT`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS stripe_onboard_complete INTEGER DEFAULT 0`,
    // Stripe checkout reference on payments
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_checkout_id TEXT`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_payment_intent TEXT`,
    // v1.9.0 — Payout speed tracking on payments
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS payout_speed TEXT DEFAULT 'standard'`,
    // v1.9.0 — Background check payment tracking on caregiver profiles
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS background_check_paid INTEGER DEFAULT 0`,
    // v1.10.0 — Per-user relationship label for care team members
    `ALTER TABLE care_team_members ADD COLUMN IF NOT EXISTS relationship_label TEXT`,
    // v1.12.0 — Tiered rates for caregivers (daytime / nighttime / overnight)
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS rate_daytime REAL`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS rate_nighttime REAL`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS rate_overnight REAL`,
    // v1.12.0 — Session pricing: agreed rate, surcharge, tier breakdown, budget
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS agreed_rate REAL`,
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS short_notice_surcharge REAL DEFAULT 0`,
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS rate_tier TEXT`,
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS budget_max REAL`,
    // v1.13.0 — Proposed rate (family's offered hourly rate)
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS proposed_rate REAL`,
    // v1.13.2 — Academic program tracking for caregivers
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS academic_program TEXT`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS academic_program_year TEXT`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS needs_hour_reports INTEGER DEFAULT 0`,
    // v1.12.0 — Backfill tiered rates from hourly_rate
    // H1 guard (v1.69.0): one-time; reads COALESCE(rate_daytime, hourly_rate) everywhere, so new profiles don't need this
    `UPDATE caregiver_profiles SET rate_daytime = hourly_rate WHERE rate_daytime IS NULL AND hourly_rate IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM platform_settings WHERE key = 'migr_rate_daytime_backfill_v1')`,
    `INSERT INTO platform_settings (key, value) VALUES ('migr_rate_daytime_backfill_v1', 'done') ON CONFLICT (key) DO NOTHING`,
    // v1.20.2 — Allow group/team messages without a single recipient
    `ALTER TABLE messages ALTER COLUMN recipient_id DROP NOT NULL`,
    // v1.14.0 — Dual-role support: users can have multiple roles
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS roles TEXT`,
    // Backfill roles from existing single role column
    // H1 guard (v1.69.0): one-time; registration + seed always write roles now
    `UPDATE users SET roles = '["' || role || '"]' WHERE roles IS NULL AND role IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM platform_settings WHERE key = 'migr_roles_backfill_v1')`,
    `INSERT INTO platform_settings (key, value) VALUES ('migr_roles_backfill_v1', 'done') ON CONFLICT (key) DO NOTHING`,
    // v1.20.4 — Care recipient photo
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS photo TEXT`,
    // v1.21.0 — Care recipient emoji avatar
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS emoji TEXT`,
    // v1.21.7 — Cancellation tracking
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS cancelled_by TEXT`,
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ`,
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS late_cancel INTEGER DEFAULT 0`,
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS cancelled_caregiver_id TEXT`,
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS cancel_reason TEXT`,
    // v1.21.7 — Reviews: allow review_type to track cancellation reviews
    `ALTER TABLE reviews ADD COLUMN IF NOT EXISTS review_type TEXT DEFAULT 'completion'`,
    // v1.21.9 — Onboarding event tracking (errors, completions, drop-offs)
    `CREATE TABLE IF NOT EXISTS onboarding_events (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      email TEXT,
      event_type TEXT NOT NULL,
      step INTEGER,
      step_name TEXT,
      error_message TEXT,
      error_source TEXT,
      metadata TEXT,
      user_agent TEXT,
      ip_address TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_onboarding_events_user ON onboarding_events(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_onboarding_events_type ON onboarding_events(event_type)`,
    `CREATE INDEX IF NOT EXISTS idx_onboarding_events_created ON onboarding_events(created_at)`,
    // v1.22.1 — Add flow column to distinguish login/register/onboarding/password-reset/demo events
    `ALTER TABLE onboarding_events ADD COLUMN IF NOT EXISTS flow TEXT DEFAULT 'onboarding'`,
    `CREATE INDEX IF NOT EXISTS idx_onboarding_events_flow ON onboarding_events(flow)`,
    // v1.27.7 — Soft-delete: anonymize users instead of hard-deleting
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_email TEXT`,
    // v1.31.0 — Care recipient permission tier (full/collaborative/managed)
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS permission_tier TEXT DEFAULT 'full'`,
    // v1.31.1 — Visibility settings: which sections the care recipient can see (JSON)
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS visibility_settings TEXT`,
    // v1.32.0 — Check-in/check-out fields on visit_logs
    `ALTER TABLE visit_logs ADD COLUMN IF NOT EXISTS arrival_mood TEXT`,
    `ALTER TABLE visit_logs ADD COLUMN IF NOT EXISTS departure_mood TEXT`,
    `ALTER TABLE visit_logs ADD COLUMN IF NOT EXISTS condition_tags TEXT`,
    `ALTER TABLE visit_logs ADD COLUMN IF NOT EXISTS care_feedback TEXT`,
    `ALTER TABLE visit_logs ADD COLUMN IF NOT EXISTS service_feedback TEXT`,
    // v1.33.0 — Check-in timing gate: admin override for early check-in
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS early_check_in_allowed INTEGER DEFAULT 0`,
    // v1.33.0 — Location tagging on check-in
    `ALTER TABLE visit_logs ADD COLUMN IF NOT EXISTS check_in_latitude REAL`,
    `ALTER TABLE visit_logs ADD COLUMN IF NOT EXISTS check_in_longitude REAL`,
    // v1.57.72 — Test mode flag for admin impersonation check-ins
    `ALTER TABLE visit_logs ADD COLUMN IF NOT EXISTS is_test INTEGER DEFAULT 0`,
    // v1.33.0 — Track which notifications have been sent per session (prevents duplicates)
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS notifications_sent TEXT`,
    // v1.70.0 — REMOVED: the v1.31.0 boot backfill that linked care_recipients to
    // care_for users BY NAME MATCH. linked_user_id grants CaredForView (schedule,
    // care details, messages) — at scale, two people with the same name meant the
    // wrong person could be silently granted another person's PHI on the next boot.
    // Linking must only happen via unique identifiers: self-signup links by user id
    // at INSERT (auth.js/oauth.js); a claim-by-invite flow (token + email match) is
    // the intended path for family-created recipients.
    // v1.33.12 — Reply-to support for messages
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id TEXT`,
    // v1.33.12 — Emoji reactions on messages
    `CREATE TABLE IF NOT EXISTS message_reactions (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id),
      emoji TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(message_id, user_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions(message_id)`,
    // v1.33.17 — Care preferences (rated importance) and AI-generated care summary
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS care_preferences TEXT`, /* PHI-risk — follow-up details may contain medical info */
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS care_preference_details TEXT`,
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS ai_care_summary TEXT`,
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS ai_care_summary_updated_at TIMESTAMPTZ`,
    // v1.33.32 — Timezone per care recipient (enables multi-state expansion)
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/New_York'`,
    // v1.33.86 — Caregiver-configurable overnight minimum hours (default 6)
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS min_overnight_hours REAL DEFAULT 6`,
    // v1.34.5 — Direct offers: track which caregiver an offer was sent to
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS offered_to_caregiver_id TEXT`,
    // v1.34.34 — Exclusive timer: when the direct offer expires and becomes open
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS exclusive_until TIMESTAMPTZ`,
    // v1.34.35 — Accessibility preferences (text size, etc.) stored as JSON
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS accessibility_prefs TEXT`,
    // v1.70.0 — REMOVED: the v1.34.36 boot backfill (CROSS JOIN users) that linked
    // any unlinked care_recipient to an ARBITRARY care_for user — no name, email, or
    // family condition tied the user to the recipient. Same PHI hazard as above, worse.
    // v1.34.38 — SMS session reminders for care recipients (Tier 1)
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS sms_phone TEXT`,
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS notification_channel TEXT DEFAULT 'push'`,
    // v1.34.46 — Caregiver-facing care briefing (concise, AI-summarized)
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS caregiver_briefing TEXT`,
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS caregiver_briefing_updated_at TIMESTAMPTZ`,
    `ALTER TABLE visit_logs ADD COLUMN IF NOT EXISTS briefing_acknowledged_at TIMESTAMPTZ`,
    // v1.34.55 — Caregiver interview openness preference
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS open_to_interview INTEGER`,
    // v1.34.59 — Caregiver care preferences (JSON: green/yellow/red per service type)
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS care_preferences TEXT`,
    // v1.35.0 — Consent & Authorization Verification System (Phase 1a)
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS authorization_tier TEXT DEFAULT 'unset'`,
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS consent_status TEXT DEFAULT 'pending'`,
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS consent_method TEXT`,
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS consent_verified_at TIMESTAMPTZ`,
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS consent_reviewed_by TEXT`,
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS consent_notes TEXT`,
    // v1.35.0 — Authorization documents (Tier 2: POA, guardianship uploads)
    `CREATE TABLE IF NOT EXISTS authorization_documents (
      id TEXT PRIMARY KEY,
      care_recipient_id TEXT NOT NULL,
      submitted_by TEXT NOT NULL,
      document_type TEXT NOT NULL,
      file_data TEXT NOT NULL,
      file_name TEXT,
      file_size INTEGER,
      mime_type TEXT,
      upload_status TEXT DEFAULT 'uploaded',
      admin_notes TEXT,
      reviewed_by TEXT,
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_auth_docs_recipient ON authorization_documents(care_recipient_id)`,
    `CREATE INDEX IF NOT EXISTS idx_auth_docs_submitted ON authorization_documents(submitted_by)`,
    // v1.35.0 — Attestations (Tier 3: family member attests care recipient is aware)
    `CREATE TABLE IF NOT EXISTS attestations (
      id TEXT PRIMARY KEY,
      care_recipient_id TEXT NOT NULL,
      attesting_user_id TEXT NOT NULL,
      relationship_to_recipient TEXT,
      attestation_text TEXT NOT NULL,
      signature_name TEXT NOT NULL,
      signed_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_attestations_recipient ON attestations(care_recipient_id)`,
    // v1.35.0 — Verification attempts (Tier 3: phone/SMS/video/code verification of care recipient)
    `CREATE TABLE IF NOT EXISTS verification_attempts (
      id TEXT PRIMARY KEY,
      attestation_id TEXT,
      care_recipient_id TEXT NOT NULL,
      verification_code TEXT,
      verification_method TEXT DEFAULT 'code_entry',
      status TEXT DEFAULT 'pending',
      attempted_at TIMESTAMPTZ,
      verified_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_verification_recipient ON verification_attempts(care_recipient_id)`,
    `CREATE INDEX IF NOT EXISTS idx_verification_status ON verification_attempts(status)`,
    // v1.35.0 — First-visit confirmations (caregiver confirms care recipient awareness)
    `CREATE TABLE IF NOT EXISTS first_visit_confirmations (
      id TEXT PRIMARY KEY,
      care_recipient_id TEXT NOT NULL,
      caregiver_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      confirmation TEXT NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_fvc_recipient ON first_visit_confirmations(care_recipient_id)`,
    `CREATE INDEX IF NOT EXISTS idx_fvc_session ON first_visit_confirmations(session_id)`,
    // v1.35.9 — Unique constraint to prevent double-submit race condition
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_fvc_session_unique ON first_visit_confirmations(session_id)`,
    // v1.35.0 — Backfill: existing care recipients with linked_user_id → tier1/verified/self_signup    // v1.35.0 — Backfill: existing care recipients without linked_user_id → tier3/verified/legacy_account (don't break existing users)    // v1.35.4 — Phase 2a: Add failed_attempts counter to verification_attempts
    `ALTER TABLE verification_attempts ADD COLUMN IF NOT EXISTS failed_attempts INTEGER DEFAULT 0`,
    // v1.36.0 — Phase 4a: Unified document verification system
    `CREATE TABLE IF NOT EXISTS verified_documents (
      id TEXT PRIMARY KEY,
      owner_type TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      uploaded_by TEXT NOT NULL,
      category TEXT NOT NULL,
      document_type TEXT NOT NULL,
      file_data TEXT NOT NULL,
      file_name TEXT,
      file_size INTEGER,
      mime_type TEXT,
      status TEXT DEFAULT 'pending',
      ai_classification TEXT,
      ai_reviewed_at TIMESTAMPTZ,
      admin_reviewed_by TEXT,
      admin_reviewed_at TIMESTAMPTZ,
      admin_notes TEXT,
      expires_at TIMESTAMPTZ,
      replaced_by TEXT,
      metadata TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_vdocs_owner ON verified_documents(owner_type, owner_id)`,
    `CREATE INDEX IF NOT EXISTS idx_vdocs_status ON verified_documents(status)`,
    `CREATE INDEX IF NOT EXISTS idx_vdocs_category ON verified_documents(category)`,
    `CREATE INDEX IF NOT EXISTS idx_vdocs_uploaded_by ON verified_documents(uploaded_by)`,
    // v1.36.0 — Consent audit log (family-facing timeline)
    `CREATE TABLE IF NOT EXISTS consent_audit_log (
      id TEXT PRIMARY KEY,
      care_recipient_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      event_type TEXT NOT NULL,
      description TEXT NOT NULL,
      metadata TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_cal_recipient ON consent_audit_log(care_recipient_id)`,
    `CREATE INDEX IF NOT EXISTS idx_cal_event ON consent_audit_log(event_type)`,
    // v1.36.0 — Managed mode columns on care_recipients
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS managed_by_user_id TEXT`,
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS managed_reason TEXT`,
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS managed_at TIMESTAMPTZ`,
    // v1.36.0 — Backfill: copy authorization_documents → verified_documents (idempotent via INSERT ... ON CONFLICT DO NOTHING)    // v1.36.0 — Backfill: copy caregiver_documents → verified_documents    // v1.37.0 — Consent redesign: care recipient email + outreach tracking
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS email TEXT`,
    // v1.37.0 — Consent outreach: track what was sent to care recipient and their response
    `CREATE TABLE IF NOT EXISTS consent_outreach (
      id TEXT PRIMARY KEY,
      care_recipient_id TEXT NOT NULL,
      attestation_id TEXT,
      sent_to_email TEXT,
      sent_to_phone TEXT,
      outreach_type TEXT DEFAULT 'email',
      outreach_token TEXT UNIQUE,
      recipient_response TEXT,
      recipient_response_notes TEXT,
      responded_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_outreach_recipient ON consent_outreach(care_recipient_id)`,
    `CREATE INDEX IF NOT EXISTS idx_outreach_token ON consent_outreach(outreach_token)`,
    // v1.37.0 — Admin review fields on attestations
    `ALTER TABLE attestations ADD COLUMN IF NOT EXISTS admin_reviewed_by TEXT`,
    `ALTER TABLE attestations ADD COLUMN IF NOT EXISTS admin_reviewed_at TIMESTAMPTZ`,
    `ALTER TABLE attestations ADD COLUMN IF NOT EXISTS admin_notes TEXT`,
    `ALTER TABLE attestations ADD COLUMN IF NOT EXISTS admin_status TEXT DEFAULT 'pending'`,
    // v1.37.0 — Consent notes on care_recipients (admin rejection reason, etc.)
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS consent_notes TEXT`,
    // v1.37.0 — First-visit confirmation: add booking_paused flag for "no"/"unable" responses
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS bookings_paused INTEGER DEFAULT 0`,
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS bookings_paused_reason TEXT`,
    // v1.37.0 — Caregiver production readiness: admin-managed background check override
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS bg_check_admin_approved INTEGER DEFAULT 0`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS bg_check_admin_approved_by TEXT`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS bg_check_admin_approved_at TIMESTAMPTZ`,
    // v1.38.0 — User address fields (for billing, care coordination)
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS address_line1 TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS address_line2 TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS city TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS state TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS zip TEXT`,
    // v1.39.4 — Stripe Identity Verification for caregivers
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS stripe_verification_session_id TEXT`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS identity_verified INTEGER DEFAULT 0`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS identity_verification_status TEXT DEFAULT 'none'`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS identity_verified_at TIMESTAMPTZ`,
    // v1.39.21 — IP fraud detection on consent outreach
    `ALTER TABLE attestations ADD COLUMN IF NOT EXISTS attester_ip TEXT`, /* PHI-risk */
    `ALTER TABLE consent_outreach ADD COLUMN IF NOT EXISTS responder_ip TEXT`, /* PHI-risk */
    `ALTER TABLE consent_outreach ADD COLUMN IF NOT EXISTS ip_match_flag INTEGER DEFAULT 0`,
    `ALTER TABLE consent_outreach ADD COLUMN IF NOT EXISTS phone_verification_required INTEGER DEFAULT 0`,
    `ALTER TABLE consent_outreach ADD COLUMN IF NOT EXISTS phone_verification_code TEXT`,
    `ALTER TABLE consent_outreach ADD COLUMN IF NOT EXISTS phone_verification_sent_at TIMESTAMPTZ`,
    `ALTER TABLE consent_outreach ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ`,
    // v1.39.38 — Account lockout after failed logins
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_failed_login TIMESTAMPTZ`,
    // v1.39.43 — Refresh tokens for session revocation
    `CREATE TABLE IF NOT EXISTS refresh_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), token_hash TEXT UNIQUE NOT NULL, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`,
    // v1.39.47 — Stripe Customer ID for family payment setup
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`,
    // v1.39.59 — Time proposals (caregiver counter-offers for scheduling conflicts)
    // v1.39.60 — Admin review tracking for customer service
    `ALTER TABLE reviews ADD COLUMN IF NOT EXISTS admin_status TEXT DEFAULT 'pending'`,
    `ALTER TABLE reviews ADD COLUMN IF NOT EXISTS admin_notes TEXT`,
    `ALTER TABLE reviews ADD COLUMN IF NOT EXISTS admin_reviewed_by TEXT`,
    `ALTER TABLE reviews ADD COLUMN IF NOT EXISTS admin_reviewed_at TIMESTAMPTZ`,
    // Auto-flag reviews < 3 stars as 'flagged' on insert is handled in application logic

    // v1.39.65 — Audit logging for security monitoring
    `CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      user_id TEXT,
      user_email TEXT,
      user_role TEXT,
      action TEXT NOT NULL,
      endpoint TEXT,
      method TEXT,
      ip_address TEXT,
      user_agent TEXT,
      details JSONB,
      severity TEXT DEFAULT 'info',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_log_severity ON audit_log(severity)`,

    `CREATE TABLE IF NOT EXISTS time_proposals (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES care_sessions(id),
      caregiver_profile_id TEXT NOT NULL REFERENCES caregiver_profiles(id),
      caregiver_user_id TEXT NOT NULL REFERENCES users(id),
      proposed_date TEXT NOT NULL,
      proposed_time TEXT NOT NULL,
      message TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      expires_at TIMESTAMPTZ,
      responded_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // ─── v1.39.75 — Session Accountability System ───

    // Payment authorization tracking (Stripe PaymentIntent with manual capture)
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT`,
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS payment_authorized_at TIMESTAMPTZ`,
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS payment_captured_at TIMESTAMPTZ`,
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS payment_voided_at TIMESTAMPTZ`,
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS authorized_amount INTEGER`, // cents
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS payment_status TEXT`, // 'authorized' | 'paid' | 'voided'

    // Late check-in tracking
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS late_check_in INTEGER DEFAULT 0`, // boolean
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS late_minutes INTEGER`,
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS late_resolution TEXT`, // 'extend' | 'truncate' | null (pending)
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS late_resolution_at TIMESTAMPTZ`,

    // No-show tracking
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS caregiver_no_show INTEGER DEFAULT 0`,
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS caregiver_no_show_at TIMESTAMPTZ`,
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS family_no_show INTEGER DEFAULT 0`,
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS family_no_show_flagged_at TIMESTAMPTZ`,

    // Review requirement tracking
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS review_required INTEGER DEFAULT 0`,
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS review_completed INTEGER DEFAULT 0`,
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS review_reminded_at TIMESTAMPTZ`,

    // On-my-way / ETA tracking
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS on_my_way_at TIMESTAMPTZ`,

    // Session disputes
    `CREATE TABLE IF NOT EXISTS session_disputes (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES care_sessions(id),
      filed_by TEXT NOT NULL REFERENCES users(id),
      filed_by_role TEXT NOT NULL,
      reason TEXT NOT NULL,
      description TEXT,
      evidence_notes TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      admin_notes TEXT,
      resolved_by TEXT REFERENCES users(id),
      resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_disputes_session ON session_disputes(session_id)`,
    `CREATE INDEX IF NOT EXISTS idx_disputes_status ON session_disputes(status)`,

    // ─── v1.39.76 — Admin Approval Gate for New Signups ───
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS account_approved INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_by TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`,
    // Auto-approve demo and admin users only (real signups require manual approval)    // Backfill: rename session_booked → session_requested + fix message text
    // H1 guard (v1.69.0): one-time; nothing writes 'session_booked' anymore
    `UPDATE activity_feed SET event_type = 'session_requested', message = REPLACE(message, 'booked', 'requested') WHERE event_type = 'session_booked'
       AND NOT EXISTS (SELECT 1 FROM platform_settings WHERE key = 'migr_activity_feed_rename_v1')`,
    `INSERT INTO platform_settings (key, value) VALUES ('migr_activity_feed_rename_v1', 'done') ON CONFLICT (key) DO NOTHING`,
    // v1.43.0 — 2hr response window for time proposals
    `ALTER TABLE time_proposals ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`,

    // v1.45.0 — Interview Flow System
    // Interviews table: tracks interview requests between family and caregiver
    `CREATE TABLE IF NOT EXISTS interviews (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES care_sessions(id),
      requested_by TEXT NOT NULL REFERENCES users(id),
      requested_of TEXT NOT NULL REFERENCES users(id),
      interview_type TEXT NOT NULL DEFAULT 'video',
      status TEXT NOT NULL DEFAULT 'pending',
      conversation_id TEXT REFERENCES conversations(id),
      call_started_at TIMESTAMPTZ,
      call_ended_at TIMESTAMPTZ,
      call_duration_seconds INTEGER,
      cancelled_by TEXT,
      cancel_reason TEXT,
      reminder_48h_sent INTEGER DEFAULT 0,
      reminder_24h_sent INTEGER DEFAULT 0,
      reminder_2h_sent INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_interviews_session ON interviews(session_id)`,
    `CREATE INDEX IF NOT EXISTS idx_interviews_requested_by ON interviews(requested_by)`,
    `CREATE INDEX IF NOT EXISTS idx_interviews_requested_of ON interviews(requested_of)`,
    `CREATE INDEX IF NOT EXISTS idx_interviews_status ON interviews(status)`,
    // Interview columns on care_sessions
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS interview_required INTEGER DEFAULT 0`,
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS interview_type TEXT`,
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS interview_status TEXT`,

    // v1.46.0 — Caregiver account pause on no-show
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS account_paused INTEGER DEFAULT 0`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS account_paused_reason TEXT`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS account_paused_at TIMESTAMPTZ`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS account_reinstated_at TIMESTAMPTZ`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS account_reinstated_by TEXT`,
    // v1.46.10 — Admin service messaging
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_label TEXT`,
    // v1.58.46 — Soft-delete messages (tombstone)
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_deleted INTEGER DEFAULT 0`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`,
    // v1.47.1 — iPAi session summaries + coaching
    `ALTER TABLE visit_logs ADD COLUMN IF NOT EXISTS ai_summary TEXT`,
    `ALTER TABLE visit_logs ADD COLUMN IF NOT EXISTS ai_coaching TEXT`,
    // v1.48.1 — Family AI notes + care plan
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS family_ai_notes TEXT`,
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS ai_care_plan TEXT`,
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS ai_care_plan_updated_at TIMESTAMPTZ`,
    // v1.49.10 — Safety flags table
    `CREATE TABLE IF NOT EXISTS safety_flags (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      flag_type TEXT NOT NULL,
      user_message TEXT,
      conversation_id TEXT,
      ipai_response TEXT,
      status TEXT DEFAULT 'pending',
      reviewed_by TEXT REFERENCES users(id),
      reviewed_at TIMESTAMPTZ,
      admin_notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    // v1.46.12 — Cost tracking
    `CREATE TABLE IF NOT EXISTS platform_costs (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      description TEXT,
      amount NUMERIC(10,2) NOT NULL,
      period_month TEXT NOT NULL,
      source TEXT DEFAULT 'manual',
      created_by TEXT REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    // v1.46.15 — Recurring expenses
    `ALTER TABLE platform_costs ADD COLUMN IF NOT EXISTS recurrence TEXT DEFAULT 'one-time'`,
    `ALTER TABLE platform_costs ADD COLUMN IF NOT EXISTS active INTEGER DEFAULT 1`,
    `CREATE TABLE IF NOT EXISTS recurring_expenses (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      description TEXT,
      amount NUMERIC(10,2) NOT NULL,
      recurrence TEXT NOT NULL DEFAULT 'monthly',
      start_month TEXT NOT NULL,
      end_month TEXT,
      active INTEGER DEFAULT 1,
      created_by TEXT REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    // v1.48.0 — AI Care Plan Generation
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS ai_care_plan TEXT`,
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS ai_care_plan_updated_at TIMESTAMPTZ`,
    // v1.50.19 — Early departure tracking
    `ALTER TABLE visit_logs ADD COLUMN IF NOT EXISTS early_departure_reason TEXT`,
    `ALTER TABLE visit_logs ADD COLUMN IF NOT EXISTS early_departure_minutes REAL`,
    // v1.50.27 — Admin alert dismiss snapshot
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_alerts_snapshot TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_alerts_seen_at TIMESTAMPTZ`,
    // v1.50.29 — BG check rejection flow
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS bg_check_rejection_reason TEXT`,
    // v1.50.32 — Checkr certification: legal_middle_name + ETA tracking
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS legal_middle_name TEXT`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS checkr_eta TIMESTAMPTZ`,
    // v1.50.40 — Safety flag evidence threads
    `ALTER TABLE safety_flags ADD COLUMN IF NOT EXISTS admin_read_at TIMESTAMPTZ`,
    `ALTER TABLE safety_flags ADD COLUMN IF NOT EXISTS severity TEXT`,
    `CREATE TABLE IF NOT EXISTS safety_flag_events (
      id TEXT PRIMARY KEY,
      safety_flag_id TEXT NOT NULL REFERENCES safety_flags(id),
      event_type TEXT NOT NULL,
      actor_id TEXT REFERENCES users(id),
      actor_label TEXT,
      content TEXT,
      metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS safety_flag_threads (
      id TEXT PRIMARY KEY,
      safety_flag_id TEXT NOT NULL REFERENCES safety_flags(id),
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      participant_user_id TEXT NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    // v1.50.42 — Notes on cost entries
    `ALTER TABLE platform_costs ADD COLUMN IF NOT EXISTS notes TEXT`,

    // v1.50.78 — Referrals & milestones
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT`,
    `CREATE TABLE IF NOT EXISTS referrals (
      id TEXT PRIMARY KEY,
      referrer_user_id TEXT NOT NULL REFERENCES users(id),
      referred_email TEXT,
      referred_phone TEXT,
      referred_user_id TEXT REFERENCES users(id),
      referral_code TEXT,
      status TEXT DEFAULT 'pending',
      sent_at TIMESTAMPTZ DEFAULT NOW(),
      claimed_at TIMESTAMPTZ
    )`,
    `CREATE TABLE IF NOT EXISTS milestones (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      milestone_type TEXT NOT NULL,
      milestone_value INTEGER NOT NULL,
      acknowledged INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // v1.50.80 — Background check archive (permanent record that survives user deletion)
    `CREATE TABLE IF NOT EXISTS background_check_archive (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      user_email TEXT,
      user_first_name TEXT,
      user_last_name TEXT,
      caregiver_profile_id TEXT,
      checkr_candidate_id TEXT,
      checkr_report_id TEXT,
      checkr_invitation_id TEXT,
      checkr_status TEXT,
      is_background_checked INTEGER DEFAULT 0,
      background_check_paid INTEGER DEFAULT 0,
      bg_check_admin_approved INTEGER DEFAULT 0,
      bg_check_admin_approved_by TEXT,
      bg_check_admin_approved_at TIMESTAMPTZ,
      legal_first_name TEXT,
      legal_last_name TEXT,
      archived_at TIMESTAMPTZ DEFAULT NOW(),
      archived_reason TEXT,
      original_created_at TIMESTAMPTZ,
      metadata JSONB
    )`,

    // v1.51.15 — Kindred access flag
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS companion_access INTEGER DEFAULT 0`,

    // v1.51.42 — Fix: clear review_required on cancelled sessions that aren't no-shows
    // v1.51.48 — Kindred: configurable name for care recipient (what family calls them)
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS called_by TEXT`,

    // v1.51.49 — Tips & gratitude feature
    `CREATE TABLE IF NOT EXISTS tips (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES care_sessions(id),
      family_user_id TEXT NOT NULL REFERENCES users(id),
      caregiver_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL DEFAULT 0,
      reason_text TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS gratitude_keywords TEXT`,

    // v1.51.66 — Billing contact on care teams (delegate payment to a team member)
    `ALTER TABLE care_teams ADD COLUMN IF NOT EXISTS billing_user_id TEXT REFERENCES users(id)`,

    // v1.51.81 — Server-side message archive (was localStorage-only, lost on login)
    `ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`,
    `ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`, // Batch 4: per-user soft-delete of a conversation (messages are never hard-deleted)

    // v1.51.82 — Push reliability: track consecutive failures to auto-remove dead tokens
    `ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS fail_count INTEGER DEFAULT 0`,

    `ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ`,
    `ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS last_failure_at TIMESTAMPTZ`,

    // ─── v1.53.0 — Admin rebuild: tickets, role levels, geolocation ───

    // Tickets table — replaces/upgrades the feedback pipeline
    `CREATE TABLE IF NOT EXISTS admin_tickets (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL DEFAULT 'general',
      priority TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'open',
      reporter_user_id TEXT REFERENCES users(id),
      assigned_to TEXT REFERENCES users(id),
      related_session_id TEXT REFERENCES care_sessions(id),
      related_user_id TEXT REFERENCES users(id),
      related_safety_flag_id TEXT,
      source TEXT DEFAULT 'user',
      admin_notes TEXT,
      resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Ticket comments/thread
    `CREATE TABLE IF NOT EXISTS admin_ticket_comments (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES admin_tickets(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL REFERENCES users(id),
      content TEXT NOT NULL,
      is_internal INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Admin role level on users (god, ops, cs, view — null = not admin)
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_role TEXT`,

    // Admin sticky notes on users
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_notes TEXT`,

    // Visit geolocation — check-in/out coordinates
    `ALTER TABLE visit_logs ADD COLUMN IF NOT EXISTS check_in_lat REAL`,
    `ALTER TABLE visit_logs ADD COLUMN IF NOT EXISTS check_in_lng REAL`,
    `ALTER TABLE visit_logs ADD COLUMN IF NOT EXISTS check_out_lat REAL`,
    `ALTER TABLE visit_logs ADD COLUMN IF NOT EXISTS check_out_lng REAL`,
    `ALTER TABLE visit_logs ADD COLUMN IF NOT EXISTS check_in_distance_ft REAL`,
    // Batch 2 (v1.60.0) — proof-of-presence evidence: geofence flag + check-out distance
    `ALTER TABLE visit_logs ADD COLUMN IF NOT EXISTS check_in_geo_flag TEXT`,
    `ALTER TABLE visit_logs ADD COLUMN IF NOT EXISTS check_out_distance_ft REAL`,
    `ALTER TABLE visit_logs ADD COLUMN IF NOT EXISTS check_out_geo_flag TEXT`,

    // ─── v1.54.0 — Tip-with-payment & auto-pay ───
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`,
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS payment_due_at TIMESTAMPTZ`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS tip_cents INTEGER DEFAULT 0`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS tip_reason TEXT`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS auto_charged INTEGER DEFAULT 0`,
    // ─── v1.54.7 — Private-only requests ───
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS private_only INTEGER DEFAULT 0`,
    // ─── v1.55.0 — Manual payments (Send Payment feature) ───
    `CREATE TABLE IF NOT EXISTS manual_payments (
      id TEXT PRIMARY KEY,
      from_user_id TEXT NOT NULL REFERENCES users(id),
      to_caregiver_id TEXT NOT NULL REFERENCES caregiver_profiles(id),
      amount_cents INTEGER NOT NULL,
      note TEXT,
      stripe_session_id TEXT,
      stripe_payment_intent_id TEXT,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    // ─── v1.55.5 — Payout expected date for manual payments ───
    `ALTER TABLE manual_payments ADD COLUMN IF NOT EXISTS payout_expected_date TEXT`,
    // ─── v1.56.0 — In-app notifications table ───
    `CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT,
      type TEXT DEFAULT 'general',
      data TEXT,
      read INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read, created_at DESC)`,
    // ─── v1.57.0 — Pre-set tip for auto-pay grace period ───
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS pending_tip_cents INTEGER DEFAULT 0`,
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS pending_tip_reason TEXT`,
    // ─── v1.57.8 — Offline sync support for check-in/check-out ───
    `ALTER TABLE visit_logs ADD COLUMN IF NOT EXISTS offline_sync INTEGER DEFAULT 0`,
    // ─── v1.57.8 — Document retention on account deletion (fraud/audit protection) ───
    `ALTER TABLE caregiver_documents ADD COLUMN IF NOT EXISTS retained_from_deleted INTEGER DEFAULT 0`,
    `ALTER TABLE caregiver_documents ADD COLUMN IF NOT EXISTS deleted_user_email TEXT`,
    `ALTER TABLE verified_documents ADD COLUMN IF NOT EXISTS retained_from_deleted INTEGER DEFAULT 0`,
    `ALTER TABLE verified_documents ADD COLUMN IF NOT EXISTS deleted_user_email TEXT`,
    `ALTER TABLE authorization_documents ADD COLUMN IF NOT EXISTS retained_from_deleted INTEGER DEFAULT 0`,
    `ALTER TABLE authorization_documents ADD COLUMN IF NOT EXISTS deleted_user_email TEXT`,

    // ─── v1.58.0 — Versioned legal documents (terms, privacy, liability) ───
    `CREATE TABLE IF NOT EXISTS legal_documents (
      id TEXT PRIMARY KEY,
      doc_type TEXT NOT NULL,
      version TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      change_summary TEXT,
      previous_version TEXT,
      published_by TEXT REFERENCES users(id),
      published_at TIMESTAMPTZ DEFAULT NOW(),
      is_active INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS user_legal_acceptances (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      document_id TEXT NOT NULL REFERENCES legal_documents(id),
      doc_type TEXT NOT NULL,
      version TEXT NOT NULL,
      accepted_at TIMESTAMPTZ DEFAULT NOW(),
      ip_address TEXT,
      user_agent TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_legal_docs_type_active ON legal_documents(doc_type, is_active)`,
    `CREATE INDEX IF NOT EXISTS idx_legal_acceptances_user ON user_legal_acceptances(user_id, doc_type)`,
    // ─── v1.58.1 — Time change proposals for confirmed sessions ───
    `CREATE TABLE IF NOT EXISTS time_change_proposals (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES care_sessions(id),
      proposed_by TEXT NOT NULL,
      proposed_by_user_id TEXT NOT NULL REFERENCES users(id),
      original_time TEXT NOT NULL,
      original_duration REAL NOT NULL,
      proposed_time TEXT NOT NULL,
      proposed_duration REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      acknowledged_by_user_id TEXT REFERENCES users(id),
      acknowledged_at TIMESTAMPTZ,
      cancel_fee_hours REAL,
      reason TEXT,
      is_within_24h INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_time_change_session ON time_change_proposals(session_id, status)`,
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS pending_time_change_id TEXT`,

    // v1.57.12 — Flex timing policy for overtime
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS flex_timing TEXT DEFAULT 'strict'`,
    // flex_timing values: 'strict' (no overtime), 'flexible' (30 min max), 'open' (2 hr max)
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS overtime_minutes INTEGER DEFAULT 0`,
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS overtime_cost REAL DEFAULT 0`,

    // Family-level default flex preference (so they don't re-pick every booking)
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS default_flex_timing TEXT DEFAULT 'flexible'`,

    // v1.57.14 — Trusted admin IPs (passkey-verified)
    `CREATE TABLE IF NOT EXISTS trusted_admin_ips (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      ip_address TEXT NOT NULL,
      user_agent TEXT,
      label TEXT,
      verified_via TEXT DEFAULT 'login',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '90 days'),
      UNIQUE(user_id, ip_address)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_trusted_ips_user ON trusted_admin_ips(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_trusted_ips_lookup ON trusted_admin_ips(user_id, ip_address)`,

    // v1.57.47 — Self-onboarding for care_for role users
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS self_onboarding_complete INTEGER DEFAULT 0`,
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS date_of_birth DATE`,
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS preferred_name TEXT`,
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT`,
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS emergency_contact_relationship TEXT`,
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ`,
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS terms_version TEXT`,
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS non_medical_acknowledged INTEGER DEFAULT 0`,

    // v1.57.53 — Add self-onboarding ID verification columns to existing verified_documents table
    // (Table was created in v1.36.0 with different schema; CREATE TABLE IF NOT EXISTS was a no-op)
    `ALTER TABLE verified_documents ADD COLUMN IF NOT EXISTS doc_type TEXT`,
    `ALTER TABLE verified_documents ADD COLUMN IF NOT EXISTS file_path TEXT`,
    `ALTER TABLE verified_documents ADD COLUMN IF NOT EXISTS extracted_data TEXT`,
    `ALTER TABLE verified_documents ADD COLUMN IF NOT EXISTS ai_confidence REAL DEFAULT 0`,
    `ALTER TABLE verified_documents ADD COLUMN IF NOT EXISTS ai_concerns TEXT`,
    `ALTER TABLE verified_documents ADD COLUMN IF NOT EXISTS is_verified INTEGER DEFAULT 0`,
    `ALTER TABLE verified_documents ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ`,
    `ALTER TABLE verified_documents ADD COLUMN IF NOT EXISTS verified_by TEXT`,

    // v1.57.85 — Allow caregivers to dismiss no-show alert banners
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS no_show_acknowledged INTEGER DEFAULT 0`,

    // v1.58.32 — Arrival SMS reminders for care recipients (customizable intervals)
    // JSON array of minutes before session: e.g. [120, 60, 30] = 2hr, 1hr, 30min
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS sms_reminder_intervals TEXT DEFAULT '[120, 60, 30]'`,

    // v1.58.34 — Dashboard performance indexes
    // Core session queries (dashboard, schedule, notifications) all filter by user + date
    `CREATE INDEX IF NOT EXISTS idx_care_sessions_family_date ON care_sessions(family_user_id, scheduled_date DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_care_sessions_caregiver_date ON care_sessions(caregiver_id, scheduled_date DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_care_sessions_status_date ON care_sessions(status, scheduled_date DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_care_sessions_recipient_date ON care_sessions(care_recipient_id, scheduled_date DESC)`,
    // Activity feed — every dashboard load queries this
    `CREATE INDEX IF NOT EXISTS idx_activity_feed_family ON activity_feed(family_user_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_activity_feed_recipient ON activity_feed(care_recipient_id, created_at DESC)`,
    // Reviews — N+1 lookup per completed session
    `CREATE INDEX IF NOT EXISTS idx_reviews_session_family ON reviews(session_id, family_user_id)`,
    // Visit photos — ordered by created_at in dashboard
    `CREATE INDEX IF NOT EXISTS idx_visit_photos_created ON visit_photos(created_at DESC)`,
    // Visit logs — joined on session_id constantly
    `CREATE INDEX IF NOT EXISTS idx_visit_logs_session ON visit_logs(session_id)`,

    // v1.79.0 — Payments page v2: which card/account paid
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_brand TEXT`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_last4 TEXT`,

    // v1.76.0 — Family care observations (session-less notes with AI harvesting)
    `ALTER TABLE recipient_notes ADD COLUMN IF NOT EXISTS needs_attention INTEGER DEFAULT 0`,
    `ALTER TABLE recipient_notes ADD COLUMN IF NOT EXISTS photo TEXT`, /* PHI — streamed via endpoint, never in list payloads */
    `ALTER TABLE recipient_notes ADD COLUMN IF NOT EXISTS categories TEXT`,
    `ALTER TABLE recipient_notes ADD COLUMN IF NOT EXISTS ai_highlights TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_recipient_notes_recipient ON recipient_notes(care_recipient_id, created_at DESC)`,

    // v1.72.0 — Reimbursements: family expense ledger (settlement recorded, no platform money movement)
    `CREATE TABLE IF NOT EXISTS reimbursements (
      id TEXT PRIMARY KEY,
      care_team_id TEXT NOT NULL REFERENCES care_teams(id),
      care_recipient_id TEXT REFERENCES care_recipients(id),
      requested_by TEXT NOT NULL REFERENCES users(id),
      payee_user_id TEXT NOT NULL REFERENCES users(id),
      amount NUMERIC(10,2) NOT NULL,
      description TEXT NOT NULL,
      category TEXT DEFAULT 'other',
      expense_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      self_recorded INTEGER DEFAULT 0,
      approved_by TEXT REFERENCES users(id),
      approved_at TIMESTAMPTZ,
      declined_reason TEXT,
      paid_at TIMESTAMPTZ,
      paid_method TEXT,
      paid_reference TEXT,
      paid_by TEXT REFERENCES users(id),
      cancelled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS reimbursement_receipts (
      id TEXT PRIMARY KEY,
      reimbursement_id TEXT NOT NULL REFERENCES reimbursements(id) ON DELETE CASCADE,
      file_data TEXT NOT NULL, /* base64 data URI — never returned in list payloads (C2 rule) */
      file_name TEXT,
      mime_type TEXT,
      file_size INTEGER,
      uploaded_by TEXT REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    // v1.74.0 — Recurring reimbursements (standing approval: approver OKs the series once,
    // occurrences are generated pre-approved; settlement still recorded off-platform)
    `CREATE TABLE IF NOT EXISTS reimbursement_schedules (
      id TEXT PRIMARY KEY,
      care_team_id TEXT NOT NULL REFERENCES care_teams(id),
      care_recipient_id TEXT REFERENCES care_recipients(id),
      payee_user_id TEXT NOT NULL REFERENCES users(id),
      created_by TEXT NOT NULL REFERENCES users(id),
      amount NUMERIC(10,2) NOT NULL,
      description TEXT NOT NULL,
      category TEXT DEFAULT 'other',
      day_of_month INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_approval',
      approved_by TEXT REFERENCES users(id),
      approved_at TIMESTAMPTZ,
      declined_reason TEXT,
      next_run_date TEXT,
      last_run_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_reimb_sched_due ON reimbursement_schedules(status, next_run_date)`,
    `ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS schedule_id TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_reimb_team_created ON reimbursements(care_team_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_reimb_receipts ON reimbursement_receipts(reimbursement_id)`,
    // v1.72.0 — Venmo handle for off-platform reimbursement settlement
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS venmo_handle TEXT`,
    // v1.73.0 — Zelle contact (email or phone) for off-platform reimbursement settlement
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS zelle_contact TEXT`,

    // v1.67.0 — hot FK indexes (codebase review H3)
    // messages list: WHERE conversation_id = ? ORDER BY created_at DESC
    `CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at DESC)`,
    // payment lookups by session across payments/sessions/admin/financials/accountability
    `CREATE INDEX IF NOT EXISTS idx_payments_session ON payments(session_id)`,
    // Notifications — queried on every page load
    `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC)`,
    // v1.57.73 — Client version tracking (web/iOS/Android, app_version, user_agent)
    `CREATE TABLE IF NOT EXISTS user_client_info (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      app_version TEXT,
      user_agent TEXT,
      platform TEXT,
      last_seen_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_user_client_info_last_seen ON user_client_info(last_seen_at DESC)`,

    // v1.58.71 — Separate column for structured iPAi care intelligence JSON.
    // Before this, /api/care-intelligence was caching its JSON output to ai_care_summary,
    // clobbering the plain-text caregiver-facing summary written by /generate-summary.
    // The profile screen reads ai_care_summary as text, so the JSON rendered as gibberish.
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS ai_care_intelligence TEXT`,
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS ai_care_intelligence_updated_at TIMESTAMPTZ`,
    // One-time cleanup: move any existing ai_care_summary values that are clearly the
    // structured JSON (have "headline" and "insights" keys) into the new column.
    `UPDATE care_recipients
       SET ai_care_intelligence = ai_care_summary,
           ai_care_intelligence_updated_at = ai_care_summary_updated_at,
           ai_care_summary = NULL,
           ai_care_summary_updated_at = NULL
     WHERE ai_care_summary IS NOT NULL
       AND ai_care_intelligence IS NULL
       AND TRIM(BOTH FROM ai_care_summary) LIKE '{%}'
       AND ai_care_summary LIKE '%"headline"%'
       AND ai_care_summary LIKE '%"insights"%'
       AND NOT EXISTS (SELECT 1 FROM platform_settings WHERE key = 'migr_ai_summary_json_move_v1')`, /* H1 guard (v1.69.0): one-time; the JSON writer targets ai_care_intelligence since v1.58.71 */
    `INSERT INTO platform_settings (key, value) VALUES ('migr_ai_summary_json_move_v1', 'done') ON CONFLICT (key) DO NOTHING`,

    // ─── Batch 4 (v1.62.0) — money columns REAL(float) → NUMERIC(10,2) ───
    // Guarded + idempotent: only converts a column that is still real/double precision,
    // so it runs exactly once and never rewrites the tables on subsequent boots.
    `DO $$
     DECLARE r RECORD;
     BEGIN
       FOR r IN SELECT * FROM (VALUES
         ('payments','amount'),('payments','platform_fee'),('payments','caregiver_payout'),
         ('care_sessions','estimated_cost'),('care_sessions','actual_cost'),('care_sessions','agreed_rate'),
         ('care_sessions','short_notice_surcharge'),('care_sessions','proposed_rate'),('care_sessions','overtime_cost'),
         ('caregiver_profiles','hourly_rate'),('caregiver_profiles','rate_daytime'),
         ('caregiver_profiles','rate_nighttime'),('caregiver_profiles','rate_overnight'),
         ('session_offers','offered_rate'),
         ('background_check_payments','amount')
       ) AS t(tbl, col)
       LOOP
         IF EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_name = r.tbl AND column_name = r.col
             AND data_type IN ('real','double precision')
         ) THEN
           EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE numeric(10,2) USING %I::numeric(10,2)', r.tbl, r.col, r.col);
           RAISE NOTICE 'Batch4: converted %.% to numeric(10,2)', r.tbl, r.col;
         END IF;
       END LOOP;
     END $$;`,
  ];
  // ─── v1.82.0: statements that must run EVERY boot (deliberately not one-time) ───
  const PER_BOOT_STATEMENTS = [
    // admin promote (safety net if DB restored)
    `UPDATE users SET is_admin = 1, admin_role = 'god' WHERE email = 'peterjslee@gmail.com'`,
    // tier1 backfill — PER-BOOT pending consent policy decision (lawyer agenda)
    `UPDATE care_recipients SET authorization_tier = 'tier1', consent_status = 'verified', consent_method = 'self_signup', consent_verified_at = NOW() WHERE linked_user_id IS NOT NULL AND authorization_tier = 'unset'`,
    // tier3 backfill — PER-BOOT pending consent policy decision (lawyer agenda)
    `UPDATE care_recipients SET authorization_tier = 'tier3', consent_status = 'verified', consent_method = 'legacy_account', consent_verified_at = NOW() WHERE linked_user_id IS NULL AND authorization_tier = 'unset'`,
    // authorization_documents → verified_documents sync (uploads still write the OLD table — real fix is at upload path)
    `INSERT INTO verified_documents (id, owner_type, owner_id, uploaded_by, category, document_type, file_data, file_name, file_size, mime_type, status, admin_notes, admin_reviewed_by, admin_reviewed_at, created_at, updated_at)
     SELECT id, 'care_recipient', care_recipient_id, submitted_by, 'consent', document_type, file_data, file_name, file_size, mime_type,
       CASE upload_status WHEN 'approved' THEN 'approved' WHEN 'rejected' THEN 'rejected' ELSE 'pending' END,
       admin_notes, reviewed_by, reviewed_at, created_at, updated_at
     FROM authorization_documents WHERE id NOT IN (SELECT id FROM verified_documents) AND id IS NOT NULL`,
    // caregiver_documents → verified_documents sync (same)
    `INSERT INTO verified_documents (id, owner_type, owner_id, uploaded_by, category, document_type, file_data, file_name, file_size, mime_type, status, created_at, updated_at)
     SELECT id, 'caregiver', (SELECT cp.id FROM caregiver_profiles cp WHERE cp.user_id = cd.user_id LIMIT 1), user_id,
       CASE WHEN document_type IN ('dl_front', 'dl_back', 'drivers_license') THEN 'identity' ELSE 'certification' END,
       CASE document_type WHEN 'dl_front' THEN 'DL_Front' WHEN 'dl_back' THEN 'DL_Back' WHEN 'drivers_license' THEN 'DL_Front' WHEN 'certification' THEN 'Other_Cert' ELSE 'Other' END,
       file_data, file_name, 0, 'image/jpeg', 'pending', created_at, created_at
     FROM caregiver_documents cd WHERE id NOT IN (SELECT id FROM verified_documents) AND id IS NOT NULL`,
    // auto-approve demo/admin (seed doesn't set it)
    `UPDATE users SET account_approved = 1 WHERE account_approved = 0 AND (is_demo = 1 OR is_admin = 1)`,
    // clear review_required on cancelled non-no-shows (state may still occur)
    `UPDATE care_sessions SET review_required = 0 WHERE status = 'cancelled' AND (caregiver_no_show IS NULL OR caregiver_no_show = 0) AND review_required = 1`,
  ];

  // ─── v1.82.0: versioned migration runner (review H1, step 2) ───
  // The legacy `migrations` array above (~400 statements) used to replay on EVERY
  // boot. It now runs exactly once per database as baseline '000_legacy_baseline',
  // recorded in schema_migrations. New schema changes go in MIGRATIONS_V2 below —
  // DO NOT add to the legacy array; post-baseline databases will never run it again.
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW())`);
  const appliedRows = await db.prepare("SELECT id FROM schema_migrations").all();
  const applied = new Set(appliedRows.map((r) => r.id));

  if (!applied.has('000_legacy_baseline')) {
    console.log(`  Running legacy baseline (${migrations.length} statements, first boot on this database)...`);
    for (const sql of migrations) {
      try { await db.exec(sql); } catch (e) { /* column may already exist */ }
    }
    await db.prepare("INSERT INTO schema_migrations (id) VALUES ('000_legacy_baseline') ON CONFLICT (id) DO NOTHING").run();
    console.log("  Legacy baseline recorded — it will not replay on future boots.");
  }

  // Per-boot safety nets and load-bearing syncs (see labels above) — always run
  for (const sql of PER_BOOT_STATEMENTS) {
    try { await db.exec(sql); } catch (e) {
      try { require("../utils/sentry").captureException(e, { where: "db: per-boot statement" }); } catch {}
    }
  }

  // ─── MIGRATIONS_V2: add new schema changes here as { id, statements } ───
  // Each runs exactly once per database, in order, inside a transaction.
  const MIGRATIONS_V2 = [
    // { id: '001_example', statements: [`ALTER TABLE x ADD COLUMN IF NOT EXISTS y TEXT`] },
    {
      // v1.87.0 (infra #7): one malformed tags/page_context row has been in prod
      // feedback since ~v1.74.2 (tolerated by safeJson, but every list pays for
      // it). NULL any value that does not parse as JSON — version-safe DO block,
      // no pg_input_is_valid dependency.
      id: "001_null_malformed_feedback_json",
      statements: [
        `DO $mig$
         DECLARE r RECORD;
         BEGIN
           FOR r IN SELECT id, tags, page_context FROM feedback
                    WHERE tags IS NOT NULL OR page_context IS NOT NULL LOOP
             BEGIN PERFORM r.tags::json;
             EXCEPTION WHEN others THEN UPDATE feedback SET tags = NULL WHERE id = r.id; END;
             BEGIN PERFORM r.page_context::json;
             EXCEPTION WHEN others THEN UPDATE feedback SET page_context = NULL WHERE id = r.id; END;
           END LOOP;
         END $mig$;`,
      ],
    },
    {
      // v1.95.0 — split DIAGNOSED conditions from OBSERVED concerns (Pete's
      // July 11 insight: "early stage dementia" in health_conditions was a
      // family observation, not a diagnosis, and every AI generator treated it
      // with diagnosis weight). health_conditions now means formal diagnoses;
      // observed_concerns is a JSON array of family/caregiver observations
      // ("serious memory issues suggesting dementia", "tends to fall").
      // Existing entries stay in health_conditions — families move items
      // themselves; the UI explains the split.
      id: "002_observed_concerns",
      statements: [
        `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS observed_concerns TEXT`,
      ],
    },
    {
      // v1.97.0 — push subscription hygiene (July 13 forensic trace):
      // (a) duplicate rows for the same (user_id, endpoint) — subscribe-native
      //     raced against the token-refresh listener and double-inserted
      //     (Sara had 2 identical iOS tokens → double pushes);
      // (b) the same endpoint parked under MULTIPLE users — admin impersonation
      //     sessions auto-subscribed the admin's browser under the impersonated
      //     user, so "Sara's web push" was actually Pete's Chrome.
      // Dedupe keeping the newest row per (user_id, endpoint), then enforce
      // uniqueness so the race can never re-create dupes. Cross-user endpoint
      // squatting self-heals via the reclaim logic in /api/push/subscribe.
      id: "003_push_subscription_dedupe",
      statements: [
        `DELETE FROM push_subscriptions p1
         USING push_subscriptions p2
         WHERE p1.user_id = p2.user_id AND p1.endpoint = p2.endpoint
           AND (p1.updated_at < p2.updated_at
                OR (p1.updated_at = p2.updated_at AND p1.id < p2.id))`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subs_user_endpoint
         ON push_subscriptions(user_id, endpoint)`,
      ],
    },
    {
      // v1.97.0 — "to / from" settlement model (Pete's letter metaphor):
      // the requester picks HOW they want to be paid back (the "to" address),
      // the approver picks WHICH account it comes from (the "from" address).
      // All of these are LABELS ONLY (e.g. "Truist checking ****4321") — full
      // account/routing numbers are never stored; the actual transfer happens
      // in the family's own banking app.
      id: "004_reimbursement_to_from",
      statements: [
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_contact TEXT`,
        `ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS payout_method TEXT`,
        `ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS payout_details TEXT`,
        `ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS paid_from_account_id TEXT`,
        `ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS paid_from_label TEXT`,
        `CREATE TABLE IF NOT EXISTS team_funding_accounts (
          id TEXT PRIMARY KEY,
          care_team_id TEXT NOT NULL REFERENCES care_teams(id),
          label TEXT NOT NULL,
          type TEXT DEFAULT 'bank',
          is_default INTEGER DEFAULT 0,
          created_by TEXT REFERENCES users(id),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_team_funding_team ON team_funding_accounts(care_team_id)`,
      ],
    },
    {
      // v1.98.0 — in-app ACH reimbursements (Pete accepted the Phase-2 risk to
      // test person-to-person). Any user can become a PAYOUT recipient with
      // their own Stripe Connect account (separate from the pay-IN customer +
      // payment methods). payout_status tracks the async ACH lifecycle
      // (processing → succeeded/failed over ~1-4 business days).
      id: "006_inapp_ach_reimbursements",
      statements: [
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_account_id TEXT`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_onboard_complete INTEGER DEFAULT 0`,
        `ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS payout_status TEXT`,
        `ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS stripe_payment_intent TEXT`,
      ],
    },
    {
      // v1.97.1 — payout destination verification: when the requester picks a
      // bank that is ACTUALLY linked to their InPlace/Stripe profile (vs. a
      // typed description), the server marks it verified so the approver can
      // trust where the money is going.
      id: "005_payout_verified",
      statements: [
        `ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS payout_verified INTEGER DEFAULT 0`,
      ],
    },
    {
      // v1.98.15 — coalesce reimbursement pushes. When the approver approves,
      // pays, and the charge confirms in one sitting, the requester used to get
      // 3 separate pushes. Instead we enqueue a per-(recipient, reimbursement)
      // digest with a rolling ~2-minute fire time; a sweeper sends ONE push that
      // reflects the reimbursement's final state. A partial unique index keeps a
      // single PENDING digest per pair while allowing sent history rows (so a
      // later, genuinely separate ACH settlement can still notify).
      id: "007_reimbursement_push_digests",
      statements: [
        `CREATE TABLE IF NOT EXISTS reimbursement_push_digests (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          reimbursement_id TEXT NOT NULL,
          care_team_id TEXT,
          fire_at TIMESTAMPTZ NOT NULL,
          sent INTEGER DEFAULT 0,
          sent_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_reimb_digest_pending ON reimbursement_push_digests(user_id, reimbursement_id) WHERE sent = 0`,
        `CREATE INDEX IF NOT EXISTS idx_reimb_digest_due ON reimbursement_push_digests(sent, fire_at)`,
      ],
    },
    {
      // v1.98.17 — Bank deposits view. Stripe batches a connected account's
      // balance into one payout per day, so several reimbursements land as a
      // single bank deposit. The connected-account charge carries source_transfer
      // = the platform transfer id (tr_); the platform PaymentIntent's charge
      // carries the same tr_. Caching that tr_ per reimbursement lets us map each
      // Stripe payout back to the exact requests it paid, without re-deriving it
      // from the PaymentIntent on every load.
      id: "008_reimbursement_transfer_id",
      statements: [
        `ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS stripe_transfer_id TEXT`,
      ],
    },
    {
      // v1.99.0 — Care Tasks: flexible recurring care-task engine (medication
      // tracking first; bathroom visits/baths/anything next — the engine does
      // not care what the task is). Design: Care_Tasks_Plan_2026-07-22.md.
      //  - care_tasks = the definition ("give Betty her evening medication,
      //    nightly 7pm through Sept 30, assigned to Pete, 45-min grace").
      //  - care_task_occurrences = one row per due instance, lazily
      //    materialized by the poller/routes (UNIQUE task+due_date makes
      //    materialization idempotent). THIS is the record of what was done
      //    and what wasn't. Attribution: completed_by_user_id (an app user)
      //    XOR completed_by_name (a manually-entered helper, e.g. a neighbor);
      //    recorded_by = who tapped. /* PHI: details, note */
      //  - care_task_helpers = remembered manual names per recipient, so the
      //    "who did it" picker pre-fills people like Peggy who aren't users.
      id: "009_care_tasks",
      statements: [
        `CREATE TABLE IF NOT EXISTS care_tasks (
          id TEXT PRIMARY KEY,
          care_recipient_id TEXT NOT NULL REFERENCES care_recipients(id),
          created_by TEXT NOT NULL REFERENCES users(id),
          title TEXT NOT NULL,
          task_type TEXT NOT NULL DEFAULT 'custom',
          details TEXT /* PHI — JSON: med name, dose, instructions */,
          recurrence TEXT NOT NULL DEFAULT 'daily',
          recurrence_days TEXT,
          due_time TEXT NOT NULL,
          tz TEXT,
          start_date TEXT NOT NULL,
          end_date TEXT,
          assigned_user_id TEXT REFERENCES users(id),
          grace_minutes INTEGER NOT NULL DEFAULT 45,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_care_tasks_recipient ON care_tasks(care_recipient_id, is_active)`,
        `CREATE TABLE IF NOT EXISTS care_task_occurrences (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES care_tasks(id),
          due_date TEXT NOT NULL,
          due_at TIMESTAMPTZ NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          completed_at TIMESTAMPTZ,
          recorded_by TEXT REFERENCES users(id),
          completed_by_user_id TEXT REFERENCES users(id),
          completed_by_name TEXT,
          note TEXT /* PHI */,
          reminders_sent TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          /* v1.105.147 — which of the day's times this row is. A medication task due at
             08:00, 12:30 and 18:00 makes three rows for one date, and they are told apart by
             slot, not by due_at: an edit to one time must not collide with another. */
          slot_index INTEGER NOT NULL DEFAULT 0,
          UNIQUE (task_id, due_date, slot_index)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_cto_status_due ON care_task_occurrences(status, due_at)`,
        `CREATE INDEX IF NOT EXISTS idx_cto_task_date ON care_task_occurrences(task_id, due_date DESC)`,
        `CREATE TABLE IF NOT EXISTS care_task_helpers (
          id TEXT PRIMARY KEY,
          care_recipient_id TEXT NOT NULL REFERENCES care_recipients(id),
          name TEXT NOT NULL,
          last_used_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE (care_recipient_id, name)
        )`,
      ],
    },
    {
      // v1.98.19 — optional "purpose" tag so reimbursements can be bucketed for
      // outside accounts (real-estate taxes, FSA/HSA, Medicaid, etc.), filtered,
      // and exported. Distinct from the expense `category` (what was bought).
      id: "010_reimbursement_purpose",
      statements: [
        `ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS purpose TEXT`,
      ],
    },
    {
      // v1.100.0 — Care Events (see Care_Events_Plan_2026-07-22.md).
      // Lightweight situational-awareness events ("Betty has cardiology with
      // Dr. Patel Tuesday 2pm"). Deliberately NOT a calendar: no recurrence
      // (recurring = care_tasks), no sync, no escalation/missed — an event is
      // awareness, not an obligation. Renders inline in Next Up; family-only
      // reminder pushes; one-tap .ics export to the user's own calendar.
      //  - event_date/event_time are naive care-location strings (house
      //    timezone rule, same as care_sessions); event_time NULL = all-day.
      //  - starts_at is the derived TIMESTAMPTZ used by the poller and sorts.
      //  - source/source_meta = provenance ('manual' now; 'email' when the
      //    forward-to-iPAi ingestion ships in Phase 2). Never the raw email.
      id: "011_care_events",
      statements: [
        `CREATE TABLE IF NOT EXISTS care_events (
          id TEXT PRIMARY KEY,
          care_recipient_id TEXT NOT NULL REFERENCES care_recipients(id),
          created_by TEXT REFERENCES users(id),
          title TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'other',
          event_date TEXT NOT NULL,
          event_time TEXT,
          end_time TEXT,
          tz TEXT,
          starts_at TIMESTAMPTZ NOT NULL,
          location TEXT,
          details TEXT /* PHI — appointment context is health context */,
          source TEXT NOT NULL DEFAULT 'manual',
          source_meta TEXT,
          reminders_sent TEXT NOT NULL DEFAULT '',
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_care_events_recipient ON care_events(care_recipient_id, is_active, event_date)`,
        `CREATE INDEX IF NOT EXISTS idx_care_events_active_start ON care_events(is_active, starts_at)`,
      ],
    },
    {
      // v1.104.2 — new caregiver profiles must not default to "available".
      // The old DEFAULT 1 made a bare auto-created stub read as "Available for
      // Jobs" in the admin panel before the caregiver finished (or even
      // started) the onboarding wizard (surfaced by Julia's live signup).
      // Existing rows are deliberately untouched: real caregivers keep
      // whatever availability they have set. The onboarding wizard submit
      // sets is_available=1 on completion (routes/caregivers.js).
      id: "012_caregiver_available_default",
      statements: [
        `ALTER TABLE caregiver_profiles ALTER COLUMN is_available SET DEFAULT 0`,
      ],
    },
    {
      // v1.105.8 — signup age gate. The app collected no date of birth anywhere and
      // enforced no minimum age, while the Privacy Policy claimed under-13s weren't
      // intended users. Both app stores make you DECLARE an age rating, which is a
      // statement about who can use the app, so it has to be true before it's declared.
      // Nullable on purpose: existing accounts predate this and must not be locked out.
      // Numbered 013 because 012 was already taken by 012_caregiver_available_default.
      // Keying is by exact id string so a duplicate prefix would still have applied, but two
      // 012s is a trip hazard for whoever adds 014. The statement is IF NOT EXISTS, so the
      // renumber replays harmlessly on any database that already ran the 012-named version.
      id: "013_users_date_of_birth",
      statements: [
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE`,
      ],
    },
    {
      // ─── v1.105.13 — App Review guideline 1.2: report content, block users ───
      //
      // Three tables, because these are three genuinely different acts and conflating them
      // is how safety features go wrong:
      //
      //   user_blocks     — LOUD. Mutual, disclosed to both parties, reversible. "I don't
      //                     want to deal with this person." Cancels future visits.
      //   content_reports — QUIET. Never disclosed to the reported party, ever. Goes to
      //                     admin. "This person frightened me." Telling an abuser they were
      //                     reported is how you get someone hurt, so this must never notify.
      //   block_requests  — a managed care recipient (someone whose account another person
      //                     administers) asking their care team leader to block on their
      //                     behalf. careRecipients.js already TELLS recipients that "some
      //                     actions may require care team approval" — this is the first
      //                     mechanism that makes that sentence true.
      //
      // safety_flags is deliberately NOT reused. It looks like a report table but has no
      // reporter column at all: its user_id is the AUTHOR of the offending message, and it
      // is written only by the AI screener. Bolting a human reporter onto it would overload
      // one column with two opposite meanings.
      id: "014_user_blocks_and_reports",
      statements: [
        `CREATE TABLE IF NOT EXISTS user_blocks (
          id TEXT PRIMARY KEY,
          blocker_user_id TEXT NOT NULL REFERENCES users(id),
          blocked_user_id TEXT NOT NULL REFERENCES users(id),
          reason TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        // A block is a set membership, not an event log: re-blocking must be idempotent
        // rather than accumulating duplicate rows that the unblock path would then miss.
        `CREATE UNIQUE INDEX IF NOT EXISTS user_blocks_pair
           ON user_blocks (blocker_user_id, blocked_user_id)`,
        // Blocking is SYMMETRIC in effect, so every filter has to ask "did either of us
        // block the other". That means lookups by blocked_user_id are as hot as lookups by
        // blocker_user_id, and both need an index.
        `CREATE INDEX IF NOT EXISTS user_blocks_blocked ON user_blocks (blocked_user_id)`,
        `CREATE TABLE IF NOT EXISTS content_reports (
          id TEXT PRIMARY KEY,
          reporter_user_id TEXT NOT NULL REFERENCES users(id),
          reported_user_id TEXT REFERENCES users(id),
          message_id TEXT,
          conversation_id TEXT,
          category TEXT NOT NULL,
          details TEXT,
          content_snapshot TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          reviewed_by TEXT REFERENCES users(id),
          reviewed_at TIMESTAMPTZ,
          admin_notes TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        // content_snapshot exists because a reported message can be deleted (messages
        // support is_deleted) between the report and the admin reading it. Without a copy
        // taken at report time, the reviewer sees an empty thread and the report is
        // unactionable — which is the same as having no report feature.
        `CREATE INDEX IF NOT EXISTS content_reports_status ON content_reports (status, created_at)`,
        `CREATE TABLE IF NOT EXISTS block_requests (
          id TEXT PRIMARY KEY,
          requester_user_id TEXT NOT NULL REFERENCES users(id),
          target_user_id TEXT NOT NULL REFERENCES users(id),
          care_team_id TEXT REFERENCES care_teams(id),
          reason TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          decided_by TEXT REFERENCES users(id),
          decided_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS block_requests_open
           ON block_requests (care_team_id, status)`,
      ],
    },
    {
      // ─── v1.105.19 — the 24-hour reconcile window on a late-cancellation fee ───
      //
      // Pete's rule (7/31): "24 hours to reconcile or escalate, otherwise handled by the
      // rules. Silence is consent." The default outcome requires zero action from anybody;
      // deviating from what they signed up for is what costs someone a tap.
      //
      // Why the fee is not captured the instant a family cancels late: the money IS the
      // caregiver's lost wage — that is the entire reason it is a pass-through and not a
      // liquidated damage under the Virginia Consumer Protection Act. So the person with
      // standing to forgive it is the CAREGIVER, not InPlace. This window is where they
      // decide, and where a family can escalate a charge they think is wrong.
      //
      // The whole window has to close inside Stripe's authorization lifetime (~7 days) or
      // the hold evaporates and there is nothing left to capture. 24h leaves ample room,
      // and the dispute backstop below is deliberately well inside it.
      id: "015_cancel_fee_window",
      statements: [
        `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS cancel_fee_status TEXT`,
        `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS cancel_fee_cents INTEGER`,
        `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS cancel_fee_deadline TIMESTAMPTZ`,
        `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS cancel_fee_decided_at TIMESTAMPTZ`,
        `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS cancel_fee_decided_by TEXT`,
        `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS cancel_fee_note TEXT`,
        // The poller scans on exactly this pair, and it runs on every tick.
        `CREATE INDEX IF NOT EXISTS care_sessions_cancel_fee_due
           ON care_sessions (cancel_fee_status, cancel_fee_deadline)`,
      ],
    },
    {
      // ─── v1.105.23 — coarsen stored check-in/out coordinates ───
      //
      // The forward fix in geocode.js only helps future visits. Every row already written
      // holds a five-decimal fix on the home of an elderly person, timestamped, which is
      // the actual exposure — a rule change does not un-store what is already stored.
      //
      // Proof-of-presence is carried by check_in_distance_ft and check_in_geo_flag, which
      // are computed from the full-precision reading before it is rounded and are NOT
      // touched here. Nothing about the audit trail weakens; what disappears is the ability
      // to point at a house.
      //
      // 2 decimal places is a cell of roughly 1.1 km by 0.9 km at Virginia's latitude, both
      // larger than the 1,750-foot line Washington's My Health My Data Act draws around
      // "precise location". Irreversible on purpose.
      id: "016_coarsen_visit_coordinates",
      statements: [
        `UPDATE visit_logs SET
           check_in_latitude  = ROUND(check_in_latitude::numeric, 2),
           check_in_longitude = ROUND(check_in_longitude::numeric, 2)
         WHERE check_in_latitude IS NOT NULL`,
        `UPDATE visit_logs SET
           check_out_lat = ROUND(check_out_lat::numeric, 2),
           check_out_lng = ROUND(check_out_lng::numeric, 2)
         WHERE check_out_lat IS NOT NULL`,
      ],
    },
    {
      // ─── v1.105.38 — Family visits ───
      //
      // Betty's real care includes Pete, and Peggy bringing dinner most nights. None of
      // that is a paid session, so none of it existed in the record — while the doctor
      // report and iPAi can only reflect what is recorded. A month with eight family
      // visits and two caregiver visits read as a month with two visits.
      //
      // A SEPARATE TABLE, deliberately, rather than nullable columns on visit_logs.
      // visit_logs.session_id and .caregiver_id are both NOT NULL and fifteen files read
      // that table — most of them JOINing care_sessions. Relaxing those columns would make
      // family rows vanish from some queries and silently appear in others, and the worst
      // version of that is a doctor report implying a nurse observed something a son did.
      // With a separate table every consumer opts IN, labelled; forgetting one means
      // family visits don't show up yet, not that they show up misattributed.
      //
      // Coordinates are COARSENED before they ever arrive here (~1.1km, same as check-in).
      // The geofence decision is made at full precision on the device and thrown away.
      id: "017_family_visits",
      statements: [
        `CREATE TABLE IF NOT EXISTS family_visits (
           id                TEXT PRIMARY KEY,
           care_recipient_id TEXT NOT NULL REFERENCES care_recipients(id),
           user_id           TEXT NOT NULL REFERENCES users(id),
           visited_at        TIMESTAMPTZ NOT NULL,
           duration_minutes  INTEGER,
           summary           TEXT,   /* PHI */
           mood_rating       TEXT,   /* PHI */
           activities        TEXT,
           latitude          REAL,
           longitude         REAL,
           distance_ft       INTEGER,
           geo_flag          TEXT,
           logged_via        TEXT NOT NULL DEFAULT 'manual',
           created_at        TIMESTAMPTZ DEFAULT NOW(),
           updated_at        TIMESTAMPTZ DEFAULT NOW()
         )`,
        `CREATE INDEX IF NOT EXISTS idx_family_visits_recipient
           ON family_visits(care_recipient_id, visited_at DESC)`,
      ],
    },
    {
      // v1.105.42 — remember the last app-icon badge pushed to each device, so the silent
      // badge-correction push only goes out when the number actually CHANGED. Without it
      // every return to the foreground would fire an APNs background push, and Apple
      // throttles those (rightly).
      id: "018_push_last_badge",
      statements: [
        `ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS last_badge INTEGER`,
      ],
    },
    {
      // v1.105.43 — forget every badge v1.105.42 thinks it delivered.
      //
      // That version sent the correction as a BACKGROUND push, which iOS drops unless the
      // app declares UIBackgroundModes → remote-notification (InPlace does not). APNs
      // still answered 200 — "queued", not "shown" — so we recorded a last_badge the phone
      // never displayed. Left alone, the `last_badge === n` guard would now suppress the
      // very first correct push on every device that was live during .42.
      id: "019_reset_last_badge",
      statements: [
        `UPDATE push_subscriptions SET last_badge = NULL`,
      ],
    },
    {
      // v1.105.74 — a photo on a family visit. Pete, from his phone at his mother's house:
      // "I need to be able to add a picture when I log a visit. There doesn't seem to be a
      // way for me to add a picture when I am just quickly logging a visit."
      //
      // Same storage shape as recipient_notes.photo (v1.76.0): the base64 data URI itself,
      // validated at the route for mime, size and magic bytes. Never returned in a list —
      // has_photo only — because a 5MB blob per row would make the visit feed unusable.
      id: "020_family_visit_photo",
      statements: [
        `ALTER TABLE family_visits ADD COLUMN IF NOT EXISTS photo TEXT`,
      ],
    },
    {
      // v1.105.78 — per-invitation capabilities, replacing the view/edit string.
      //
      // Additive and nullable on purpose: a NULL capabilities column means "fall back to the
      // permission string", so every existing share keeps working untouched and the migration
      // can never revoke anyone's access on deploy. utils/capabilities.js does the resolving.
      //
      // The invite carries them too, so what the owner ticks when sending is exactly what the
      // share gets at accept time — rather than being re-derived from a role name later.
      id: "021_share_capabilities",
      statements: [
        `ALTER TABLE care_recipient_shares ADD COLUMN IF NOT EXISTS capabilities TEXT`,
        `ALTER TABLE care_team_invites ADD COLUMN IF NOT EXISTS capabilities TEXT`,
        // Who accepted which privacy statement, and when, at the moment they joined a team.
        // POST /accept-invite did not check this at all: someone could join a care team and
        // reach a health record without ever being shown the privacy statement.
        `ALTER TABLE care_team_invites ADD COLUMN IF NOT EXISTS legal_accepted_at TIMESTAMPTZ`,
        `ALTER TABLE care_team_invites ADD COLUMN IF NOT EXISTS legal_version TEXT`,
      ],
    },
    {
      // v1.105.84 — a caregiver can decline a care request that was sent to her by name.
      //
      // Until now the only responses were Accept and Propose a different time. There was no
      // way to say no, so a request she could not take just sat there, and the family had no
      // signal at all. Pete, having sent one to Julia: "it only allows her to accept or
      // propose a new time. not to decline."
      //
      // The request comes back to the FAMILY to decide rather than going to the open pool —
      // they picked this person by name, so the next choice is theirs.
      id: "022_request_decline",
      statements: [
        `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS declined_by TEXT`,
        `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ`,
        `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS decline_reason TEXT`,
      ],
    },
    {
      // v1.105.111 — more than one photo per visit (Pete, 40ad8896).
      //
      // A JSON array of data URIs, alongside the existing single `photo` column rather than
      // instead of it. `photo` keeps holding the FIRST image, so every row written before
      // today still renders, `/:id/photo` still answers, and the `has_photo` flag on the feed
      // keeps meaning what it meant. Additive and nullable: nothing has to be backfilled, and
      // a row with only `photo` set reads as a one-photo visit.
      id: "023_family_visit_photos",
      statements: [
        `ALTER TABLE family_visits ADD COLUMN IF NOT EXISTS photos TEXT`,
      ],
    },
    {
      // v1.105.112 — the AI stops deciding identity; it recommends, and a person decides.
      //
      // `ai_recommendation` holds what the model would have said ('recommend_approve',
      // 'recommend_reject', or 'abstain' below the confidence threshold). It is stored NEXT TO
      // the document rather than in `status`, because a recommendation is not a decision:
      // `status` stays 'pending' until an admin grants or rejects, and nothing in the app may
      // gate on this column.
      //
      // Also backfills the identity documents the AI approved on its own before today. They
      // are moved back to 'pending' — with the old automated verdict preserved here — so they
      // appear in Doc Review and get the human look they never had. Pete: "I want to review
      // everything an AI clears."
      id: "024_identity_ai_recommendation",
      statements: [
        `ALTER TABLE verified_documents ADD COLUMN IF NOT EXISTS ai_recommendation TEXT`,
        `ALTER TABLE verified_documents ADD COLUMN IF NOT EXISTS ai_recommendation_reason TEXT`,
        `UPDATE verified_documents
            SET ai_recommendation = 'recommend_approve',
                ai_recommendation_reason = 'Approved automatically before v1.105.112, with no person asked.',
                status = 'pending',
                is_verified = 0
          WHERE category = 'identity'
            AND document_type != 'selfie'
            AND status = 'approved'
            AND admin_reviewed_by IS NULL`,
      ],
    },
    {
      // ─── v1.105.147 — a care task can be due more than once a day ───
      //
      // Pete: "Would like more availability to check this task off three times where I can
      // mark morning lunch and dinner medication." care_tasks held ONE due_time, and
      // care_task_occurrences was UNIQUE on (task_id, due_date) — one dose per day, enforced
      // by the database.
      //
      // It belongs here rather than in the early ALTER list at the top of this file: those run
      // BEFORE migration 009 creates care_tasks, so an ALTER there is an ALTER on a table that
      // does not exist yet. (Which is exactly how the integration suite caught it.)
      //
      // Order matters. The column first — every existing row defaults to slot 0, which is
      // precisely what it is — then the old constraint comes off, then the new one goes on.
      // Dropping first would leave a window in which two identical rows could be written.
      id: "025_care_task_multi_time",
      statements: [
        `ALTER TABLE care_tasks ADD COLUMN IF NOT EXISTS due_times TEXT`,
        `ALTER TABLE care_task_occurrences ADD COLUMN IF NOT EXISTS slot_index INTEGER NOT NULL DEFAULT 0`,
        `ALTER TABLE care_task_occurrences DROP CONSTRAINT IF EXISTS care_task_occurrences_task_id_due_date_key`,
        `CREATE UNIQUE INDEX IF NOT EXISTS uniq_cto_task_date_slot ON care_task_occurrences(task_id, due_date, slot_index)`,
      ],
    },
    {
      // ─── v1.105.170 — reactions, for anything, not just messages ───
      //
      // Pete: "I'd like the option to carry this same thing over to people reacting to visits
      // and care notes as well...socialize anywhere that we're leaving feedback." Then:
      // "add the reactions into the notes section."
      //
      // So the table is keyed on (target_type, target_id) rather than a message_id. A note
      // and a family visit are the first two types; the next one is a schema change of zero
      // rows. `message_reactions` is deliberately NOT migrated onto this — it works, Pete
      // confirmed the messages UI three versions ago, and moving live data to prove a point
      // about tidiness is how a working feature breaks. The two converge when there is a
      // reason to touch messages anyway.
      //
      // The UNIQUE index is the rule "one reaction per person per thing" put where it cannot
      // be forgotten: picking a second emoji replaces the first, and the toggle is an upsert
      // rather than a read-then-write that two taps can race.
      id: "026_reactions",
      statements: [
        `CREATE TABLE IF NOT EXISTS reactions (
           id TEXT PRIMARY KEY,
           target_type TEXT NOT NULL,
           target_id TEXT NOT NULL,
           user_id TEXT NOT NULL REFERENCES users(id),
           emoji TEXT NOT NULL,
           created_at TIMESTAMPTZ DEFAULT NOW()
         )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS uniq_reaction_per_person
           ON reactions(target_type, target_id, user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_reactions_target
           ON reactions(target_type, target_id)`,
      ],
    },
    {
      // ─── v1.105.171 — which sections you keep folded up ───
      //
      // Pete: "it should stick, too...if I minimize the reimbursements because i don't really
      // look at that...the next time i log in i want it minimized too. if I leave the care
      // notes open because I return to that a lot, I want it to remain up."
      //
      // "The next time I log in" is the requirement, and it rules out localStorage: he uses
      // the phone and the Mac, and a preference that only exists on the device he set it on
      // is one he has to set twice. One TEXT column holding JSON, the same shape as
      // notification_prefs and accessibility_prefs beside it.
      id: "027_ui_prefs",
      statements: [
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS ui_prefs TEXT`,
      ],
    },
  ];
  for (const m of MIGRATIONS_V2) {
    if (applied.has(m.id)) continue;
    await db.transaction(async (tx) => {
      for (const sql of m.statements) await tx.exec(sql);
      await tx.prepare("INSERT INTO schema_migrations (id) VALUES (?) ON CONFLICT (id) DO NOTHING").run(m.id);
    });
    console.log(`  Applied migration ${m.id}`);
  }

  // ─── v1.57.15 — Restore private-only sessions + clear stale exclusive_until ───
  // First: clear exclusive_until on ALL private-only sessions (they should never have a timer)
  try {
    await db.prepare(`
      UPDATE care_sessions
      SET exclusive_until = NULL
      WHERE COALESCE(private_only, 0) = 1
        AND exclusive_until IS NOT NULL
    `).run();
  } catch (e) { /* ignore */ }
  // Then: restore private-only sessions that were wrongly auto-cancelled
  try {
    const restored = await db.prepare(`
      UPDATE care_sessions
      SET status = 'pending', cancelled_at = NULL, cancel_reason = NULL
      WHERE COALESCE(private_only, 0) = 1
        AND status = 'cancelled'
        AND cancel_reason LIKE '%Private request expired%'
        AND scheduled_date::date >= CURRENT_DATE
    `).run();
    if (restored.changes > 0) console.log(`[migration] Restored ${restored.changes} private-only sessions that were wrongly cancelled`);
  } catch (e) { /* ignore */ }

  // ─── H1 guard (v1.69.0): everything until the marker-insert below is a one-time
  // fixup that ran in production long ago (hardcoded IDs / March-2026 test sessions).
  // The marker stops the replay every boot — and, more importantly, stops boot from
  // RE-CREATING the test sessions if they're ever deleted: test-autopay-20260329 is
  // seeded with payment_due_at, so a re-created copy would get picked up and charged
  // by the auto-pay cron.
  const oneTimeFixupsA = await db.prepare("SELECT 1 FROM platform_settings WHERE key = ?").get('migr_one_time_fixups_a_v1');
  if (!oneTimeFixupsA) {

  // ─── v1.56.3 — One-time: clear old test sessions stuck in pending review/payment ───
  try {
    const cleared = await db.prepare(`
      UPDATE care_sessions
      SET payment_status = 'waived', review_required = CASE WHEN review_completed = 0 THEN 0 ELSE review_required END
      WHERE id IN (
        '794cc55d-3ff5-46d9-bea4-b336cb3be817',
        '70c832e1-1dad-4417-aeb1-1cc192095224',
        '95f6638f-81ec-47b9-bd3a-9f8500e4e602',
        '0e124ae6-da52-4897-988f-67b4aed10b6b',
        'be7f31c6-0ea0-4b7f-95d4-218c335a5621',
        '9ec4a286-2071-4213-9a90-e9d46a80ee07',
        'e5aa7dd0-5076-40f1-a3de-d07c35c897be',
        'c987b517-543a-4e09-8e0c-2bff108f0f71',
        '657794ce-8bc9-48fd-97c7-fc85824f7d84'
      )
      AND (payment_status IS NULL OR payment_status = 'pending')
    `).run();
    if (cleared.changes > 0) console.log(`  ✅ Cleared ${cleared.changes} old test sessions from pending review/payment`);
  } catch (e) { /* already cleared */ }

  // ─── v1.56.4 — One-time: kill bogus $15.60 payment record (wrong rate, never completed) ───
  try {
    const killed = await db.prepare(`
      UPDATE payments SET status = 'failed'
      WHERE id = '2331cb34-2d6c-42a7-97cc-8a5fb5f99516'
        AND status = 'processing'
        AND amount = 15.6
    `).run();
    if (killed.changes > 0) console.log(`  ✅ Killed bogus $15.60 payment record for Cary session`);
  } catch (e) { /* already killed */ }

  // ─── v1.56.6/9 — REMOVED v1.105.65 ───
  // A one-time boot repair for a single hardcoded March session that never completed. The
  // payments table has no updated_at column (that was the whole point of the v1.56.21 webhook
  // fix), so the second UPDATE threw on every boot — but the FIRST one had already set
  // care_sessions.payment_status = 'paid'. It half-ran, marking the session paid while leaving
  // its payments row un-completed, then reported nothing because the catch says "already done".
  // Deleting rather than repairing: fixing the column name would execute, on prod, at boot, a
  // data mutation that has never once run. That is Pete's call to make deliberately, not a
  // side effect of a linter fix.

  // ─── v1.56.13 — One-time: create a test session for today (March 29) to verify webhook payment flow ───
  try {
    const testId = 'test-webhook-today-20260329';
    const exists = await db.prepare("SELECT id FROM care_sessions WHERE id = ?").get(testId);
    if (!exists) {
      // Look up Pete (family), Cary (caregiver), Betty (care recipient)
      const pete = await db.prepare("SELECT id FROM users WHERE email = 'peterjslee@gmail.com'").get();
      const cary = await db.prepare("SELECT cp.id FROM caregiver_profiles cp JOIN users u ON cp.user_id = u.id WHERE u.first_name = 'Cary'").get();
      const betty = await db.prepare("SELECT id FROM care_recipients WHERE first_name = 'Betty' LIMIT 1").get();
      if (pete && cary && betty) {
        await db.prepare(`
          INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type,
            status, scheduled_date, scheduled_time, duration_hours, estimated_cost,
            proposed_rate, review_required, review_completed, payment_status)
          VALUES (?, ?, ?, ?, 'Companionship', 'completed', '2026-03-29', '14:00', 0.5, 0.50, 1.00, 1, 0, 'pending')
        `).run(testId, betty.id, pete.id, cary.id);
        console.log(`  ✅ Created test session ${testId} — $1/hr × 30min = $0.50, needs review & payment`);
      }
    }
  } catch (e) { console.error("  Test session create error:", e.message); }

  // ─── v1.56.18 — Kill ALL test/old sessions except today's fresh one ───
  try {
    // Nuke by known IDs
    for (const oldId of ['test-webhook-1774827695917', 'test-webhook-1774829244377', 'test-webhook-today-20260329']) {
      await db.prepare("UPDATE care_sessions SET payment_status = 'waived', review_required = 0 WHERE id = ?").run(oldId);
      await db.prepare("UPDATE payments SET status = 'failed' WHERE session_id = ? AND status IN ('processing','pending')").run(oldId);
    }
    // Also kill ANY session on March 30 that looks like a test (catch strays)
    const strays = await db.prepare(`
      SELECT id FROM care_sessions
      WHERE scheduled_date = '2026-03-30'
        AND review_required = 1 AND review_completed = 0
        AND id != 'test-webhook-fresh-20260329'
    `).all();
    for (const s of (strays || [])) {
      await db.prepare("UPDATE care_sessions SET payment_status = 'waived', review_required = 0 WHERE id = ?").run(s.id);
      await db.prepare("UPDATE payments SET status = 'failed' WHERE session_id = ? AND status IN ('processing','pending')").run(s.id);
      console.log(`  ✅ Killed stray March 30 session: ${s.id}`);
    }
  } catch (e) { console.error("  Kill stray error:", e.message); }

  // Create fresh test session for webhook testing
  try {
    const freshId = 'test-webhook-fresh-20260329';
    const exists = await db.prepare("SELECT id FROM care_sessions WHERE id = ?").get(freshId);
    if (!exists) {
      const pete = await db.prepare("SELECT id FROM users WHERE email = 'peterjslee@gmail.com'").get();
      const cary = await db.prepare("SELECT cp.id FROM caregiver_profiles cp JOIN users u ON cp.user_id = u.id WHERE u.first_name = 'Cary'").get();
      const betty = await db.prepare("SELECT id FROM care_recipients WHERE first_name = 'Betty' LIMIT 1").get();
      if (pete && cary && betty) {
        await db.prepare(`
          INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type,
            status, scheduled_date, scheduled_time, duration_hours, estimated_cost,
            proposed_rate, review_required, review_completed, payment_status)
          VALUES (?, ?, ?, ?, 'Companionship', 'completed', '2026-03-29', '16:00', 0.5, 0.50, 1.00, 1, 0, 'pending')
        `).run(freshId, betty.id, pete.id, cary.id);
        console.log(`  ✅ Created fresh test session ${freshId} — $1/hr × 30min, needs review & payment`);
      }
    }
  } catch (e) { console.error("  Fresh test session error:", e.message); }

  // ─── v1.57.3 — Auto-pay test session: completed, payment_due_at ~6 min from now ───
  try {
    const autoPayTestId = 'test-autopay-20260329';
    const exists = await db.prepare("SELECT id FROM care_sessions WHERE id = ?").get(autoPayTestId);
    if (!exists) {
      const pete = await db.prepare("SELECT id FROM users WHERE email = 'peterjslee@gmail.com'").get();
      const cary = await db.prepare("SELECT cp.id FROM caregiver_profiles cp JOIN users u ON cp.user_id = u.id WHERE u.first_name = 'Cary'").get();
      const betty = await db.prepare("SELECT id FROM care_recipients WHERE first_name = 'Betty' LIMIT 1").get();
      if (pete && cary && betty) {
        await db.prepare(`
          INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type,
            status, scheduled_date, scheduled_time, duration_hours, estimated_cost,
            proposed_rate, review_required, review_completed, payment_due_at)
          VALUES (?, ?, ?, ?, 'Companionship', 'completed', '2026-03-29', '18:00', 0.25, 0.25, 1.00, 0, 0, NOW() + INTERVAL '6 minutes')
        `).run(autoPayTestId, betty.id, pete.id, cary.id);
        console.log(`  ✅ Auto-pay test session ${autoPayTestId} — $1/hr × 15min = $0.25, payment_due_at = NOW()+6min`);
      }
    }
  } catch (e) { console.error("  Auto-pay test session error:", e.message); }

  await db.prepare("INSERT INTO platform_settings (key, value) VALUES ('migr_one_time_fixups_a_v1', 'done') ON CONFLICT (key) DO NOTHING").run();
  } // end H1 guard A

  // ─── v1.50.55 — Rewrite FAQ articles with accurate content ───
  try {
    const faqVersion = await db.prepare("SELECT answer FROM help_articles WHERE question = 'Does InPlace cost anything?' AND is_published = 1").get();
    if (!faqVersion) {
      console.log("  Refreshing FAQ articles...");
      const { v4: uuid } = require("uuid");
      // Remove old inaccurate articles
      await db.prepare("DELETE FROM help_articles").run();
      const faqArticles = [
        { category: 'getting-started', question: 'How do I install InPlace on my iPhone or iPad?', answer: 'Open Safari and navigate to yourinplace.com. Tap the Share button (the square with an arrow pointing up) at the bottom of the screen, then scroll down and tap "Add to Home Screen." Name it "InPlace" and tap Add. The app icon will appear on your home screen and works just like a native app — with push notifications, offline access, and full-screen mode.', sort_order: 1 },
        { category: 'getting-started', question: 'How do I install InPlace on my Android phone?', answer: 'Open Chrome and go to yourinplace.com. You should see a banner at the bottom saying "Add InPlace to Home screen" — tap it and confirm. If the banner doesn\'t appear, tap the three-dot menu in the top right corner, then tap "Install app" or "Add to Home screen." The app will install and appear in your app drawer.', sort_order: 2 },
        { category: 'getting-started', question: 'How do I install InPlace on my computer?', answer: 'Open Chrome, Edge, or Brave and go to yourinplace.com. Look for the install icon in the address bar (a small monitor with a down arrow) and click it. Or click the three-dot menu and select "Install InPlace." The app will open in its own window and you can pin it to your taskbar or dock.', sort_order: 3 },
        { category: 'getting-started', question: 'What are the different account types?', answer: 'InPlace has three account types:\\n\\n**Family Member** — For people coordinating care for a loved one. You can search for caregivers, schedule sessions, manage your care team, and track care activity.\\n\\n**Caregiver** — For people providing care services. You can set your availability, accept care requests, track your earnings, and manage your schedule.\\n\\n**Care Recipient** — For the person receiving care. You can view your calendar, make care requests, and keep personal notes.\\n\\nYou can add a second role to your account anytime from My Account.', sort_order: 4 },
        { category: 'getting-started', question: 'How do I create an account?', answer: 'Go to yourinplace.com and tap "Get Started." Choose your account type — finding care for a loved one, providing care, or getting help for yourself. Fill in your details and follow the setup steps. Your account will be reviewed and approved before you can access the full platform. Once approved, you\'ll receive an email to verify your address and finish sign-up.', sort_order: 5 },
        { category: 'families', question: 'How do I find caregivers near me?', answer: 'Go to the Caregivers page from the sidebar. You\'ll see a map and a list of available caregivers in your area. You can filter by distance, availability, specialties, and rates. Tap on any caregiver to see their full profile, reviews, and schedule.', link_page: 'caregivers', link_label: 'Find Caregivers', role_visibility: '["family"]', sort_order: 1 },
        { category: 'families', question: 'How do I request care for my loved one?', answer: 'Tap "Request Care" on your dashboard. The care request wizard will walk you through selecting your loved one, choosing a date and time, picking services needed, selecting a caregiver (or posting an open request), and reviewing the details before submitting.', role_visibility: '["family"]', sort_order: 2 },
        { category: 'families', question: 'How do I invite family members to help manage care?', answer: 'Go to the Care Team page and tap "Invite Member." Enter their email address and select their role. They\'ll receive an email invitation to join your care team. Once they accept, they can help manage scheduling, communicate with caregivers, and view care activity.', link_page: 'care-team', link_label: 'Go to Care Team', role_visibility: '["family"]', sort_order: 3 },
        { category: 'families', question: 'How do payments work for families?', answer: 'Payments are handled through Stripe. After a care session is completed, payment is processed automatically based on the session duration and the caregiver\'s rates. You can manage your payment methods from My Account.', role_visibility: '["family"]', sort_order: 4 },
        { category: 'caregivers', question: 'How do I get started as a caregiver?', answer: 'After your account is approved, you\'ll see a First Steps checklist on your home screen. Complete each step in order: connect your bank account through Stripe, start your background check, set up account security, choose your care preferences, set your availability and rates, and add a profile photo. Once all steps are done, you can start finding work.', role_visibility: '["caregiver"]', sort_order: 1 },
        { category: 'caregivers', question: 'How do I get paid?', answer: 'Payments are processed through Stripe. During your First Steps setup, you\'ll connect your bank account via Stripe. After each completed care session, payment is deposited directly into your bank account. You can view your earnings from your dashboard.', role_visibility: '["caregiver"]', sort_order: 2 },
        { category: 'caregivers', question: 'What is the background check and how does it work?', answer: 'A background check is required to participate on InPlace. There is a one-time $30 fee that is refunded after you complete 10 care sessions. Your report is reviewed fairly — you\'ll be given a chance to provide context on anything that comes up, and a real person is always in the loop when making decisions about platform access.', role_visibility: '["caregiver"]', sort_order: 3 },
        { category: 'caregivers', question: 'How do I set my availability and rates?', answer: 'From your dashboard, tap on the availability and rates sections. You can set different rates for daytime, nighttime, and overnight hours. Set your weekly availability so families can see when you\'re open for sessions.', role_visibility: '["caregiver"]', sort_order: 4 },
        { category: 'caregivers', question: 'How do I find families who need care?', answer: 'Once your First Steps are complete, go to Find Work to browse available care opportunities in your area. You\'ll see open care requests from families. When you see a request that fits your schedule, you can accept it or make an offer.', link_page: 'find-work', link_label: 'Find Work', role_visibility: '["caregiver"]', sort_order: 5 },
        { category: 'technical', question: 'Why am I not receiving notifications?', answer: 'Make sure you\'ve enabled push notifications for InPlace. On iPhone, go to Settings > Notifications > InPlace and ensure notifications are allowed. On Android, long-press the InPlace app icon, tap App Info > Notifications, and enable them. Also check that you have notifications turned on within the app under My Account.', link_page: 'account', link_label: 'Notification Settings', sort_order: 1 },
        { category: 'technical', question: 'The app looks outdated or broken — what do I do?', answer: 'This usually means your browser is showing a cached version of InPlace. Try these steps:\\n\\n1. Hard refresh: Press Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)\\n2. Clear site data: In Chrome, tap the lock icon in the address bar > Site settings > Clear data\\n3. Reinstall: If you installed InPlace to your home screen, remove it and add it again from yourinplace.com\\n\\nIf the problem persists, use the feedback button to let us know what you\'re seeing.', sort_order: 2 },
        { category: 'technical', question: 'How do I reset my password?', answer: 'On the login page, tap "Forgot password?" and enter the email address associated with your account. You\'ll receive an email with a link to create a new password. The link expires after 1 hour. If you don\'t see the email, check your spam folder.', sort_order: 3 },
        { category: 'technical', question: 'Which browsers work best with InPlace?', answer: 'InPlace works on all modern browsers. For the best experience we recommend Safari on iPhone/iPad (required for the home screen app feature), Chrome on Android, and Chrome, Edge, or Brave on desktop. Firefox works for browsing but doesn\'t support installing InPlace as a standalone app.', sort_order: 4 },
        { category: 'billing', question: 'Does InPlace cost anything?', answer: 'There are no subscription fees or platform fees to use InPlace. Families pay caregivers directly for care sessions based on the caregiver\'s posted rates. Payments are processed securely through Stripe.', sort_order: 1 },
        { category: 'billing', question: 'How do payments work?', answer: 'All payments are handled through Stripe. Families are charged after a care session is completed, based on the session duration and the caregiver\'s rates. Caregivers receive payouts directly to their connected bank account. Both families and caregivers can view payment history from their dashboard.', sort_order: 2 },
        { category: 'billing', question: 'What about the caregiver background check fee?', answer: 'Caregivers pay a one-time $30 fee for their background check when getting set up on InPlace. This fee is refunded after the caregiver completes 10 care sessions on the platform.', sort_order: 3 },
      ];
      for (const a of faqArticles) {
        await db.prepare(`INSERT INTO help_articles (id, category, question, answer, link_page, link_label, role_visibility, sort_order, is_published) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`)
          .run(uuid(), a.category, a.question, a.answer, a.link_page || null, a.link_label || null, a.role_visibility || null, a.sort_order || 0);
      }
      console.log(`  ✅ ${faqArticles.length} FAQ articles refreshed`);
    }
  } catch (faqErr) { console.error("  FAQ refresh error:", faqErr.message); }

  // ─── H1 guard (v1.69.0): second one-time-fixup region (the FAQ refresh above
  // stays per-boot by design — it no-ops unless the sentinel article is missing) ───
  const oneTimeFixupsB = await db.prepare("SELECT 1 FROM platform_settings WHERE key = ?").get('migr_one_time_fixups_b_v1');
  if (!oneTimeFixupsB) {

  // ─── v1.56.19 — Force-complete the test session Pete just paid ───
  try {
    const freshId = 'test-webhook-fresh-20260329';
    const row = await db.prepare("SELECT payment_status FROM care_sessions WHERE id = ?").get(freshId);
    if (row && row.payment_status !== 'paid') {
      await db.prepare("UPDATE care_sessions SET payment_status = 'paid', updated_at = NOW() WHERE id = ?").run(freshId);
      // v1.105.65 — the payments UPDATE that used to sit here referenced a nonexistent
      // updated_at column and threw on every boot. Same half-run shape as the block above.
      console.log(`  ✅ Force-completed payment for ${freshId} (webhook was failing due to duplicate destinations)`);
    }
  } catch (e) { console.error("  Force-complete error:", e.message); }

  // ─── v1.56.22 — Waive old e2e test, create fresh one ───
  try {
    await db.prepare("UPDATE care_sessions SET payment_status = 'waived', review_required = 0 WHERE id = 'test-webhook-e2e-20260329'").run();
    await db.prepare("UPDATE payments SET status = 'failed' WHERE session_id = 'test-webhook-e2e-20260329' AND status IN ('processing','pending')").run();
  } catch (e) { /* ignore */ }
  try {
    const testId = 'test-webhook-e2e2-20260329';
    const exists = await db.prepare("SELECT id FROM care_sessions WHERE id = ?").get(testId);
    if (!exists) {
      const pete = await db.prepare("SELECT id FROM users WHERE email = 'peterjslee@gmail.com'").get();
      const cary = await db.prepare("SELECT cp.id FROM caregiver_profiles cp JOIN users u ON cp.user_id = u.id WHERE u.first_name = 'Cary'").get();
      const betty = await db.prepare("SELECT id FROM care_recipients WHERE first_name = 'Betty' LIMIT 1").get();
      if (pete && cary && betty) {
        await db.prepare(`
          INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type,
            status, scheduled_date, scheduled_time, duration_hours, estimated_cost,
            proposed_rate, review_required, review_completed, payment_status)
          VALUES (?, ?, ?, ?, 'Companionship', 'completed', '2026-03-29', '19:00', 0.25, 0.25, 1.00, 1, 0, 'pending')
        `).run(testId, betty.id, pete.id, cary.id);
        console.log(`  ✅ Created e2e test session ${testId} — $1/hr × 15min = $0.25, needs review & payment`);
      }
    }
  } catch (e) { console.error("  e2e test session error:", e.message); }

  // ─── v1.57.47 — (REVERTED in v1.57.72) Cary is a real caregiver, not demo ───
  // Original migration marked Cary as is_demo=1 to exclude from financials,
  // but that also hid her from caregiver search/availability. Reverted below.

  // ─── v1.57.72 — Restore Cary Taker as normal user (undo is_demo flag) ───
  try {
    const updated = await db.prepare(
      "UPDATE users SET is_demo = 0 WHERE email = 'peter@yourinplace.com' AND COALESCE(is_demo, 0) = 1"
    ).run();
    if (updated.changes > 0) console.log("  ✅ Restored Cary Taker (peter@yourinplace.com) — is_demo=0, visible again");
  } catch (e) { /* already done */ }

  // ─── v1.57.49 — Clear phantom unread from old Kindred self-echo ───
  try {
    await db.prepare(`
      UPDATE conversation_members SET last_read_at = NOW()
      WHERE user_id IN (SELECT id FROM users WHERE email = 'peterjslee@gmail.com')
        AND last_read_at < NOW() - INTERVAL '1 second'
        AND conversation_id IN (
          SELECT DISTINCT m.conversation_id FROM messages m
          JOIN users ku ON m.sender_id = ku.id
          WHERE ku.email = 'kindred@yourinplace.com'
        )
    `).run();
  } catch (e) { /* already done */ }

  await db.prepare("INSERT INTO platform_settings (key, value) VALUES ('migr_one_time_fixups_b_v1', 'done') ON CONFLICT (key) DO NOTHING").run();
  } // end H1 guard B

  console.log("  Database initialized successfully");
  return db;
}

/**
 * v1.82.0 (review H5) — run a poller tick under a Postgres advisory lock so a
 * second app instance never double-fires it (double auto-pay, double reminders).
 * Uses pg_try_advisory_xact_lock inside a transaction: auto-released at commit,
 * survives crashes, no-op cost at a single instance. Returns false if another
 * instance holds the lock.
 */
// v1.105.50 — the lock is no longer held by an open transaction.
//
// This used to be pg_try_advisory_xact_lock inside db.transaction, with the ENTIRE poller
// body running inside it. Every poller does unbounded network I/O — APNs, web push, Stripe,
// Twilio — so a single hung outbound call left a pool client stuck `idle in transaction`
// forever (pool max is 10) AND never released the advisory lock, which meant that poller
// never ran again until someone restarted the process. No error, no log, no alert: the
// reminders simply stopped. Exactly the failure mode we have spent this week removing.
//
// Now: a session-level lock on a dedicated client, the work outside any transaction, an
// explicit deadline, and release in `finally` so it comes back even if the body throws or
// times out.
const POLLER_DEADLINE_MS = 120000;

/** Release the advisory lock on the connection that took it, then return that connection. */
async function releasePollerLock(client, lockKey) {
  try {
    await client.query("SELECT pg_advisory_unlock($1)", [lockKey]);
  } catch { /* released on disconnect */ }
  try { client.release(); } catch { /* already returned */ }
}

async function withPollerLock(lockKey, fn) {
  const client = await getPool().connect();
  let held = false;
  let releaseDeferred = false;
  try {
    const res = await client.query("SELECT pg_try_advisory_lock($1) AS got", [lockKey]);
    if (res.rows[0]?.got !== true) return false; // another instance (or a still-running tick)
    held = true;

    // v1.105.66 — the deadline used to release the lock while the work was still running.
    //
    // Promise.race does not cancel the loser. On timeout this function returned, the `finally`
    // released the advisory lock, and the abandoned tick carried on mid-flight. Overlap
    // protection was therefore void in precisely the case it exists for — a slow tick — and the
    // next scheduled run would start against the same rows.
    //
    // For poller 105 (auto-pay) that means a family charged twice: processOverduePayments
    // creates and CONFIRMS a Stripe PaymentIntent before inserting the `payments` row that
    // would stop a second attempt. Stripe idempotency keys now backstop that
    // (routes/payments.js), but the lock has to hold as well — belt and braces, because the
    // failure being guarded against is taking money from someone twice.
    //
    // Now: still bound how long the CALLER waits, still report the overrun — but hold the lock
    // until the work genuinely settles. The connection stays out of the pool for as long as the
    // tick runs. That is the honest cost, and it is much cheaper than the alternative.
    const work = (async () => fn())();
    let settled = false;
    work.then(() => { settled = true; }, () => { settled = true; });

    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`poller ${lockKey} exceeded ${POLLER_DEADLINE_MS}ms`)),
        POLLER_DEADLINE_MS
      );
    });

    try {
      await Promise.race([work, deadline]);
      return true;
    } catch (err) {
      if (settled) throw err; // the work itself failed — that belongs to the caller

      // Overran. This used to be entirely invisible.
      console.error(`[poller ${lockKey}] ${err.message} — still running; lock held until it finishes`);
      try {
        require("../utils/sentry").captureException(err, { where: `withPollerLock:${lockKey}` });
      } catch { /* sentry is optional here */ }

      releaseDeferred = true;
      work.catch(() => {}).finally(() => { releasePollerLock(client, lockKey); });
      return true;
    } finally {
      clearTimeout(timer);
    }
  } finally {
    // When the release is deferred, the detached handler above owns both the lock and the
    // connection. Touching either here is what caused the original bug.
    if (!releaseDeferred) {
      if (held) {
        try { await client.query("SELECT pg_advisory_unlock($1)", [lockKey]); } catch { /* released on disconnect */ }
      }
      client.release();
    }
  }
}

function resetDb() {
  // No-op for PostgreSQL — pool always queries live database
}

// Close the connection pool — used by the integration-test harness so jest
// can tear down the embedded PostgreSQL without stray idle-client errors.
async function closeDb() {
  if (pool) { const p = pool; pool = null; db = null; await p.end(); }
}

module.exports = { getDb, initializeDatabase, resetDb, closeDb, withPollerLock };
