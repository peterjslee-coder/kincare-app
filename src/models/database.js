const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "../../inplace.db");

let db;
let SQL;

// sql.js wrapper to match better-sqlite3 style API
class DatabaseWrapper {
  constructor(sqlDb) {
    this._db = sqlDb;
  }

  prepare(sql) {
    const self = this;
    return {
      run(...params) {
        self._db.run(sql, params);
        self._save();
        return { changes: self._db.getRowsModified() };
      },
      get(...params) {
        const stmt = self._db.prepare(sql);
        stmt.bind(params);
        if (stmt.step()) {
          const row = stmt.getAsObject();
          stmt.free();
          return row;
        }
        stmt.free();
        return undefined;
      },
      all(...params) {
        const results = [];
        const stmt = self._db.prepare(sql);
        stmt.bind(params);
        while (stmt.step()) {
          results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
      },
    };
  }

  exec(sql) {
    this._db.exec(sql);
    this._save();
  }

  pragma(p) {
    try {
      this._db.exec(`PRAGMA ${p}`);
    } catch (e) {
      // sql.js doesn't support all pragmas
    }
  }

  _save() {
    const data = this._db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

async function initSql() {
  if (!SQL) {
    SQL = await initSqlJs();
  }
  return SQL;
}

async function getDb() {
  if (!db) {
    const SQL = await initSql();
    if (fs.existsSync(DB_PATH)) {
      const fileBuffer = fs.readFileSync(DB_PATH);
      db = new DatabaseWrapper(new SQL.Database(fileBuffer));
    } else {
      db = new DatabaseWrapper(new SQL.Database());
    }
  }
  return db;
}

async function initializeDatabase() {
  const db = await getDb();

  // Execute each CREATE TABLE individually for sql.js compatibility
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL, phone TEXT, avatar_url TEXT, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS care_recipients (id TEXT PRIMARY KEY, family_user_id TEXT NOT NULL REFERENCES users(id), first_name TEXT NOT NULL, last_name TEXT NOT NULL, age INTEGER, location_address TEXT, location_city TEXT, location_state TEXT, location_zip TEXT, latitude REAL, longitude REAL, health_conditions TEXT, medications TEXT, preferences TEXT, emergency_contact_name TEXT, emergency_contact_phone TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS caregiver_profiles (id TEXT PRIMARY KEY, user_id TEXT UNIQUE NOT NULL REFERENCES users(id), bio TEXT, years_experience INTEGER DEFAULT 0, hourly_rate REAL NOT NULL, specialties TEXT, certifications TEXT, max_travel_miles REAL DEFAULT 10, is_background_checked INTEGER DEFAULT 0, is_available INTEGER DEFAULT 1, rating_avg REAL DEFAULT 0, rating_count INTEGER DEFAULT 0, location_city TEXT, location_state TEXT, latitude REAL, longitude REAL, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS availability (id TEXT PRIMARY KEY, caregiver_id TEXT NOT NULL REFERENCES caregiver_profiles(id), day_of_week INTEGER NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, is_recurring INTEGER DEFAULT 1, specific_date TEXT, created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS care_sessions (id TEXT PRIMARY KEY, care_recipient_id TEXT NOT NULL REFERENCES care_recipients(id), family_user_id TEXT NOT NULL REFERENCES users(id), caregiver_id TEXT REFERENCES caregiver_profiles(id), service_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', scheduled_date TEXT NOT NULL, scheduled_time TEXT NOT NULL, duration_hours REAL NOT NULL DEFAULT 2, special_instructions TEXT, estimated_cost REAL, actual_cost REAL, cancellation_reason TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS visit_logs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES care_sessions(id), caregiver_id TEXT NOT NULL REFERENCES caregiver_profiles(id), check_in_time TEXT, check_out_time TEXT, summary TEXT, mood_rating TEXT, tasks_completed TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS visit_photos (id TEXT PRIMARY KEY, visit_log_id TEXT NOT NULL REFERENCES visit_logs(id), photo_url TEXT NOT NULL, caption TEXT, created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS activity_feed (id TEXT PRIMARY KEY, family_user_id TEXT NOT NULL REFERENCES users(id), care_recipient_id TEXT REFERENCES care_recipients(id), event_type TEXT NOT NULL, title TEXT NOT NULL, message TEXT, metadata TEXT, is_read INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES care_sessions(id), family_user_id TEXT NOT NULL REFERENCES users(id), caregiver_id TEXT NOT NULL REFERENCES caregiver_profiles(id), rating INTEGER NOT NULL, comment TEXT, created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES care_sessions(id), family_user_id TEXT NOT NULL REFERENCES users(id), caregiver_id TEXT NOT NULL REFERENCES caregiver_profiles(id), amount REAL NOT NULL, platform_fee REAL NOT NULL, caregiver_payout REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending', payment_method TEXT, created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, sender_id TEXT NOT NULL REFERENCES users(id), recipient_id TEXT NOT NULL REFERENCES users(id), content TEXT NOT NULL, is_read INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS recipient_notes (id TEXT PRIMARY KEY, care_recipient_id TEXT NOT NULL REFERENCES care_recipients(id), author_id TEXT NOT NULL REFERENCES users(id), content TEXT NOT NULL, note_type TEXT DEFAULT 'general', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS caregiver_assignments (id TEXT PRIMARY KEY, care_recipient_id TEXT NOT NULL REFERENCES care_recipients(id), family_user_id TEXT NOT NULL REFERENCES users(id), caregiver_profile_id TEXT NOT NULL REFERENCES caregiver_profiles(id), is_active INTEGER DEFAULT 1, is_favorite INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS waitlist (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, role TEXT DEFAULT 'family', source TEXT DEFAULT 'splash', created_at TEXT DEFAULT (datetime('now')))`,
  ];

  for (const sql of statements) {
    db.exec(sql);
  }

  console.log("  Database initialized successfully");
  return db;
}

function resetDb() {
  db = null;
}

module.exports = { getDb, initializeDatabase, resetDb };
