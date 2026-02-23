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

  const statements = [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL, phone TEXT, avatar_url TEXT, notification_prefs TEXT, is_active INTEGER DEFAULT 1, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS care_recipients (id TEXT PRIMARY KEY, family_user_id TEXT NOT NULL REFERENCES users(id), first_name TEXT NOT NULL, last_name TEXT NOT NULL, age INTEGER, location_address TEXT, location_city TEXT, location_state TEXT, location_zip TEXT, latitude REAL, longitude REAL, health_conditions TEXT, medications TEXT, preferences TEXT, emergency_contact_name TEXT, emergency_contact_phone TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS caregiver_profiles (id TEXT PRIMARY KEY, user_id TEXT UNIQUE NOT NULL REFERENCES users(id), bio TEXT, years_experience INTEGER DEFAULT 0, hourly_rate REAL NOT NULL, specialties TEXT, certifications TEXT, max_travel_miles REAL DEFAULT 10, is_background_checked INTEGER DEFAULT 0, is_available INTEGER DEFAULT 1, rating_avg REAL DEFAULT 0, rating_count INTEGER DEFAULT 0, location_city TEXT, location_state TEXT, latitude REAL, longitude REAL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS availability (id TEXT PRIMARY KEY, caregiver_id TEXT NOT NULL REFERENCES caregiver_profiles(id), day_of_week INTEGER NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, is_recurring INTEGER DEFAULT 1, specific_date TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS care_sessions (id TEXT PRIMARY KEY, care_recipient_id TEXT NOT NULL REFERENCES care_recipients(id), family_user_id TEXT NOT NULL REFERENCES users(id), caregiver_id TEXT REFERENCES caregiver_profiles(id), service_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', scheduled_date TEXT NOT NULL, scheduled_time TEXT NOT NULL, duration_hours REAL NOT NULL DEFAULT 2, special_instructions TEXT, estimated_cost REAL, actual_cost REAL, cancellation_reason TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS visit_logs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES care_sessions(id), caregiver_id TEXT NOT NULL REFERENCES caregiver_profiles(id), check_in_time TIMESTAMPTZ, check_out_time TIMESTAMPTZ, summary TEXT, mood_rating TEXT, tasks_completed TEXT, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS visit_photos (id TEXT PRIMARY KEY, visit_log_id TEXT NOT NULL REFERENCES visit_logs(id), photo_url TEXT NOT NULL, caption TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS activity_feed (id TEXT PRIMARY KEY, family_user_id TEXT NOT NULL REFERENCES users(id), care_recipient_id TEXT REFERENCES care_recipients(id), event_type TEXT NOT NULL, title TEXT NOT NULL, message TEXT, metadata TEXT, is_read INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES care_sessions(id), family_user_id TEXT NOT NULL REFERENCES users(id), caregiver_id TEXT NOT NULL REFERENCES caregiver_profiles(id), rating INTEGER NOT NULL, comment TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES care_sessions(id), family_user_id TEXT NOT NULL REFERENCES users(id), caregiver_id TEXT NOT NULL REFERENCES caregiver_profiles(id), amount REAL NOT NULL, platform_fee REAL NOT NULL, caregiver_payout REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending', payment_method TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, sender_id TEXT NOT NULL REFERENCES users(id), recipient_id TEXT NOT NULL REFERENCES users(id), content TEXT NOT NULL, is_read INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS recipient_notes (id TEXT PRIMARY KEY, care_recipient_id TEXT NOT NULL REFERENCES care_recipients(id), author_id TEXT NOT NULL REFERENCES users(id), content TEXT NOT NULL, note_type TEXT DEFAULT 'general', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
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
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS pet_allergies TEXT`,
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS food_allergies TEXT`,
    `ALTER TABLE care_recipients ADD COLUMN IF NOT EXISTS medical_conditions TEXT`,
    // v1.5.0 — User health/pet profile (for caregivers and family)
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS pets TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS pet_allergies TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS food_allergies TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS medical_conditions TEXT`,
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
