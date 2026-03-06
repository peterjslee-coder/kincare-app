const { Pool } = require("pg");
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
    pool = new Pool({ connectionString });
  }
  return pool;
}

// Convert SQLite-style ? params to PostgreSQL $1, $2, ...
function convertParams(sql) {
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
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

async function initializeDatabase() {
  const db = await getDb();

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
    `CREATE TABLE IF NOT EXISTS caregiver_profiles (id TEXT PRIMARY KEY, user_id TEXT UNIQUE NOT NULL REFERENCES users(id), bio TEXT, years_experience INTEGER DEFAULT 0, hourly_rate REAL NOT NULL, specialties TEXT, certifications TEXT, max_travel_miles REAL DEFAULT 10, is_background_checked INTEGER DEFAULT 0, is_available INTEGER DEFAULT 1, rating_avg REAL DEFAULT 0, rating_count INTEGER DEFAULT 0, location_city TEXT, location_state TEXT, latitude REAL, longitude REAL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
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

  // Migrations for existing databases
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
    // Auto-promote Pete's real account to admin
    `UPDATE users SET is_admin = 1 WHERE email = 'peterjslee@gmail.com'`,
    // Backfill is_demo flag for demo accounts that were seeded before the column existed
    `UPDATE users SET is_demo = 1 WHERE email IN ('pete@inplace.care', 'david.lee@inplace.care', 'susan.lee@inplace.care', 'maria@inplace.care', 'betty@inplace.care')`,
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
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS background_check_consent INTEGER DEFAULT 0`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS background_check_consent_at TIMESTAMPTZ`,
    // v1.5.0 — Caregiver work location, stoplight, terms
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS work_location_address TEXT`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS work_latitude REAL`,
    `ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS work_longitude REAL`,
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
    `UPDATE caregiver_profiles SET rate_daytime = hourly_rate WHERE rate_daytime IS NULL AND hourly_rate IS NOT NULL`,
    // v1.20.2 — Allow group/team messages without a single recipient
    `ALTER TABLE messages ALTER COLUMN recipient_id DROP NOT NULL`,
    // v1.14.0 — Dual-role support: users can have multiple roles
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS roles TEXT`,
    // Backfill roles from existing single role column
    `UPDATE users SET roles = '["' || role || '"]' WHERE roles IS NULL AND role IS NOT NULL`,
    // v1.20.4 — Care recipient photo
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS photo TEXT`,
    // v1.21.0 — Care recipient emoji avatar
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS emoji TEXT`,
    // v1.21.7 — Cancellation tracking
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS cancelled_by TEXT`,
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ`,
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS late_cancel INTEGER DEFAULT 0`,
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS cancelled_caregiver_id TEXT`,
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
    // v1.33.0 — Track which notifications have been sent per session (prevents duplicates)
    `ALTER TABLE care_sessions ADD COLUMN IF NOT EXISTS notifications_sent TEXT`,
    // v1.31.0 — Backfill linked_user_id for care_for users whose names match a care_recipient
    `UPDATE care_recipients SET linked_user_id = (
      SELECT u.id FROM users u
      WHERE LOWER(u.first_name || ' ' || u.last_name) = LOWER(care_recipients.first_name || ' ' || care_recipients.last_name)
        AND (u.role = 'care_for' OR u.roles LIKE '%care_for%')
      LIMIT 1
    ) WHERE linked_user_id IS NULL`,
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
    // v1.34.36 — Backfill linked_user_id for care_for users who have a CaredForView dashboard
    // Match care_for user to care_recipient via the user's CaredForView session lookup pattern:
    // CaredForView finds sessions WHERE cr.linked_user_id = user.id, so we reverse it:
    // Find care_for users who aren't linked yet, and link them to the care_recipient
    // created by their family (matched via care_teams.created_by = care_recipients.family_user_id)
    `UPDATE care_recipients SET linked_user_id = sub.uid
     FROM (
       SELECT DISTINCT cr.id AS crid, u.id AS uid
       FROM care_recipients cr
       JOIN care_teams ct ON ct.care_recipient_id = cr.id
       CROSS JOIN users u
       WHERE cr.linked_user_id IS NULL
         AND (u.role = 'care_for' OR u.roles LIKE '%care_for%')
         AND ct.created_by = cr.family_user_id
     ) sub
     WHERE care_recipients.id = sub.crid AND care_recipients.linked_user_id IS NULL`,
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
    // v1.35.0 — Backfill: existing care recipients with linked_user_id → tier1/verified/self_signup
    `UPDATE care_recipients SET authorization_tier = 'tier1', consent_status = 'verified', consent_method = 'self_signup', consent_verified_at = NOW() WHERE linked_user_id IS NOT NULL AND authorization_tier = 'unset'`,
    // v1.35.0 — Backfill: existing care recipients without linked_user_id → tier3/verified/legacy_account (don't break existing users)
    `UPDATE care_recipients SET authorization_tier = 'tier3', consent_status = 'verified', consent_method = 'legacy_account', consent_verified_at = NOW() WHERE linked_user_id IS NULL AND authorization_tier = 'unset'`,
    // v1.35.4 — Phase 2a: Add failed_attempts counter to verification_attempts
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
    // v1.36.0 — Backfill: copy authorization_documents → verified_documents (idempotent via INSERT ... ON CONFLICT DO NOTHING)
    `INSERT INTO verified_documents (id, owner_type, owner_id, uploaded_by, category, document_type, file_data, file_name, file_size, mime_type, status, admin_notes, admin_reviewed_by, admin_reviewed_at, created_at, updated_at)
     SELECT id, 'care_recipient', care_recipient_id, submitted_by, 'consent', document_type, file_data, file_name, file_size, mime_type,
       CASE upload_status WHEN 'approved' THEN 'approved' WHEN 'rejected' THEN 'rejected' ELSE 'pending' END,
       admin_notes, reviewed_by, reviewed_at, created_at, updated_at
     FROM authorization_documents WHERE id NOT IN (SELECT id FROM verified_documents) AND id IS NOT NULL`,
    // v1.36.0 — Backfill: copy caregiver_documents → verified_documents
    `INSERT INTO verified_documents (id, owner_type, owner_id, uploaded_by, category, document_type, file_data, file_name, file_size, mime_type, status, created_at, updated_at)
     SELECT id, 'caregiver', (SELECT cp.id FROM caregiver_profiles cp WHERE cp.user_id = cd.user_id LIMIT 1), user_id,
       CASE WHEN document_type IN ('dl_front', 'dl_back', 'drivers_license') THEN 'identity' ELSE 'certification' END,
       CASE document_type WHEN 'dl_front' THEN 'DL_Front' WHEN 'dl_back' THEN 'DL_Back' WHEN 'drivers_license' THEN 'DL_Front' WHEN 'certification' THEN 'Other_Cert' ELSE 'Other' END,
       file_data, file_name, 0, 'image/jpeg', 'pending', created_at, created_at
     FROM caregiver_documents cd WHERE id NOT IN (SELECT id FROM verified_documents) AND id IS NOT NULL`,
    // v1.37.0 — Consent redesign: care recipient email + outreach tracking
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
  ];
  for (const sql of migrations) {
    try { await db.exec(sql); } catch (e) { /* column may already exist */ }
  }

  console.log("  Database initialized successfully");
  return db;
}

function resetDb() {
  // No-op for PostgreSQL — pool always queries live database
}

module.exports = { getDb, initializeDatabase, resetDb };
