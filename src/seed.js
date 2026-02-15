/**
 * KinCare — Seed Script
 * Populates the database with realistic demo data
 * Run with: npm run seed
 */
require("dotenv").config();

const bcrypt = require("bcryptjs");
const { v4: uuid } = require("uuid");
const { initializeDatabase, getDb } = require("./models/database");

async function seed() {
  console.log("🌱 Seeding KinCare database...\n");

  await initializeDatabase();
  const db = await getDb();

  // Clear existing data
  const tables = [
    "visit_photos", "visit_logs", "activity_feed", "reviews",
    "payments", "care_sessions", "availability",
    "caregiver_profiles", "care_recipients", "users",
  ];
  for (const table of tables) {
    db.prepare(`DELETE FROM ${table}`).run();
  }

  // ─── Users ───
  const passwordHash = await bcrypt.hash("kincare123", 10);

  const peteId = uuid();
  const mariaUserId = uuid();
  const jamesUserId = uuid();
  const sarahUserId = uuid();
  const davidUserId = uuid();

  db.prepare(`
    INSERT INTO users (id, email, password_hash, role, first_name, last_name, phone)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(peteId, "pete@kincare.app", passwordHash, "family", "Pete", "Lee", "(626) 555-0142");

  const caregiverUsers = [
    [mariaUserId, "maria@kincare.app", "Maria", "Santos", "(540) 555-0201"],
    [jamesUserId, "james@kincare.app", "James", "Okafor", "(540) 555-0202"],
    [sarahUserId, "sarah@kincare.app", "Sarah", "Chen", "(540) 555-0203"],
    [davidUserId, "david@kincare.app", "David", "Kim", "(540) 555-0204"],
  ];

  for (const [id, email, first, last, phone] of caregiverUsers) {
    db.prepare(`
      INSERT INTO users (id, email, password_hash, role, first_name, last_name, phone)
      VALUES (?, ?, ?, 'caregiver', ?, ?, ?)
    `).run(id, email, passwordHash, first, last, phone);
  }

  console.log("✅ Users created (5)");

  // ─── Care Recipient (Betty) ───
  const bettyId = uuid();
  db.prepare(`
    INSERT INTO care_recipients
    (id, family_user_id, first_name, last_name, age,
     location_address, location_city, location_state, location_zip,
     latitude, longitude,
     health_conditions, medications, preferences,
     emergency_contact_name, emergency_contact_phone)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    bettyId, peteId, "Betty", "Lee", 78,
    "123 Main Street", "Blacksburg", "VA", "24060",
    37.2296, -80.4139,
    JSON.stringify(["Early-stage dementia", "Mild arthritis"]),
    JSON.stringify(["Donepezil 10mg", "Ibuprofen PRN"]),
    "Prefers female caregivers. Loves gardening and old movies. Needs gentle reminders for meals.",
    "Pete Lee", "(626) 555-0142"
  );

  console.log("✅ Care recipient created (Betty Lee)");

  // ─── Caregiver Profiles ───
  const mariaId = uuid();
  const jamesId = uuid();
  const sarahId = uuid();
  const davidId = uuid();

  const profiles = [
    [mariaId, mariaUserId,
      "Certified dementia care specialist with 8 years of experience. Fluent in English and Spanish.",
      8, 28, ["Dementia Care", "Meal Prep"], ["CNA", "CPR/First Aid"], 1, 4.9, 127, "Blacksburg", "VA", 37.2300, -80.4145],
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

  for (const [id, userId, bio, years, rate, specs, certs, avail, rating, count, city, state, lat, lng] of profiles) {
    db.prepare(`
      INSERT INTO caregiver_profiles
      (id, user_id, bio, years_experience, hourly_rate, specialties, certifications,
       is_background_checked, is_available, rating_avg, rating_count,
       location_city, location_state, latitude, longitude)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, bio, years, rate, JSON.stringify(specs), JSON.stringify(certs),
      avail, rating, count, city, state, lat, lng);
  }

  console.log("✅ Caregiver profiles created (4)");

  // ─── Availability Windows ───
  for (const cgId of [mariaId, jamesId, davidId]) {
    for (let day = 1; day <= 5; day++) {  // Mon–Fri
      db.prepare(`
        INSERT INTO availability (id, caregiver_id, day_of_week, start_time, end_time)
        VALUES (?, ?, ?, '08:00', '17:00')
      `).run(uuid(), cgId, day);
    }
  }
  // James also does Saturdays
  db.prepare(`
    INSERT INTO availability (id, caregiver_id, day_of_week, start_time, end_time)
    VALUES (?, ?, 6, '09:00', '14:00')
  `).run(uuid(), jamesId);

  console.log("✅ Availability windows created");

  // ─── Care Sessions ───
  const sessions = [
    [uuid(), bettyId, peteId, mariaId, "meals", "confirmed", "2026-02-14", "14:00", 2, "Mom prefers lunch around noon. Please remind her to drink water.", 56],
    [uuid(), bettyId, peteId, jamesId, "companion", "confirmed", "2026-02-15", "10:00", 3, "She loves looking at photo albums.", 75],
    [uuid(), bettyId, peteId, mariaId, "rides", "pending", "2026-02-19", "09:00", 1.5, "Doctor appointment at 9:30. Pickup prescriptions after.", 42],
    [uuid(), bettyId, peteId, jamesId, "companion", "confirmed", "2026-02-21", "11:00", 2, null, 50],
  ];

  for (const [id, recipId, famId, cgId, type, status, date, time, hours, notes, cost] of sessions) {
    db.prepare(`
      INSERT INTO care_sessions
      (id, care_recipient_id, family_user_id, caregiver_id, service_type,
       status, scheduled_date, scheduled_time, duration_hours,
       special_instructions, estimated_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, recipId, famId, cgId, type, status, date, time, hours, notes, cost);
  }

  // Past completed sessions
  const pastSessions = [
    [uuid(), bettyId, peteId, mariaId, "meals", "completed", "2026-02-13", "14:00", 2, null, 56],
    [uuid(), bettyId, peteId, jamesId, "companion", "completed", "2026-02-09", "10:00", 3, null, 75],
    [uuid(), bettyId, peteId, mariaId, "meals", "completed", "2026-02-07", "14:00", 2, null, 56],
    [uuid(), bettyId, peteId, davidId, "rides", "completed", "2026-02-06", "09:00", 1.5, null, 33],
  ];

  for (const [id, recipId, famId, cgId, type, status, date, time, hours, notes, cost] of pastSessions) {
    db.prepare(`
      INSERT INTO care_sessions
      (id, care_recipient_id, family_user_id, caregiver_id, service_type,
       status, scheduled_date, scheduled_time, duration_hours,
       special_instructions, estimated_cost, actual_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, recipId, famId, cgId, type, status, date, time, hours, notes, cost, cost);
  }

  console.log("✅ Care sessions created (8)");

  // ─── Visit Logs ───
  const visitLogs = [
    [uuid(), pastSessions[0][0], mariaId,
      "Prepared chicken soup and a side salad. Betty ate well — finished the full bowl! We also organized her pill box for the week.",
      "Happy & engaged", ["Cooked lunch", "Organized medications", "Kitchen cleanup"]],
    [uuid(), pastSessions[1][0], jamesId,
      "Spent the morning looking through photo albums and chatting about her garden. She was in great spirits. We took a short walk around the block.",
      "Cheerful", ["Photo album activity", "Short walk", "Conversation"]],
    [uuid(), pastSessions[2][0], mariaId,
      "Picked up groceries from Kroger — her favorites (sourdough, yogurt, bananas). Stocked the fridge and labeled leftovers with dates.",
      "Calm", ["Grocery shopping", "Stocked fridge", "Labeled leftovers"]],
    [uuid(), pastSessions[3][0], davidId,
      "Drove Betty to her doctor's appointment. The visit went well — no changes to medication. Picked up her prescription on the way home.",
      "A little tired", ["Doctor transport", "Prescription pickup"]],
  ];

  for (const [id, sessionId, cgId, summary, mood, tasks] of visitLogs) {
    db.prepare(`
      INSERT INTO visit_logs
      (id, session_id, caregiver_id, check_in_time, check_out_time,
       summary, mood_rating, tasks_completed)
      VALUES (?, ?, ?, datetime('now', '-2 hours'), datetime('now'), ?, ?, ?)
    `).run(id, sessionId, cgId, summary, mood, JSON.stringify(tasks));
  }

  console.log("✅ Visit logs created (4)");

  // ─── Activity Feed ───
  const activities = [
    [uuid(), peteId, bettyId, "visit_complete", "Visit completed",
      "Maria prepared chicken soup. Betty ate well and was in good spirits."],
    [uuid(), peteId, bettyId, "session_confirmed", "Caregiver matched: James Okafor",
      "James will arrive tomorrow at 10:00 AM for companionship."],
    [uuid(), peteId, bettyId, "visit_complete", "Visit completed",
      "James and Betty looked through photo albums and took a short walk."],
    [uuid(), peteId, bettyId, "session_booked", "Rides & Errands requested",
      "Session booked for Feb 19 at 9:00 AM — doctor appointment."],
    [uuid(), peteId, bettyId, "visit_complete", "Grocery run completed",
      "Maria picked up groceries from Kroger and stocked the fridge."],
  ];

  for (const [id, famId, recipId, type, title, msg] of activities) {
    db.prepare(`
      INSERT INTO activity_feed
      (id, family_user_id, care_recipient_id, event_type, title, message)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, famId, recipId, type, title, msg);
  }

  console.log("✅ Activity feed populated (5)");

  // ─── Reviews ───
  const reviews = [
    [uuid(), pastSessions[0][0], peteId, mariaId, 5, "Maria is wonderful with Mom. She always makes sure she eats well."],
    [uuid(), pastSessions[1][0], peteId, jamesId, 5, "James is so patient and kind. Mom really enjoys his visits."],
    [uuid(), pastSessions[2][0], peteId, mariaId, 5, "Always gets exactly what Mom needs from the store."],
    [uuid(), pastSessions[3][0], peteId, davidId, 4, "David was punctual and helpful. Mom was comfortable with him."],
  ];

  for (const [id, sessionId, famId, cgId, rating, comment] of reviews) {
    db.prepare(`
      INSERT INTO reviews (id, session_id, family_user_id, caregiver_id, rating, comment)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, sessionId, famId, cgId, rating, comment);
  }

  console.log("✅ Reviews created (4)");

  console.log("\n🎉 Seed complete! Database ready.\n");
  console.log("Demo login:");
  console.log("  Email:    pete@kincare.app");
  console.log("  Password: kincare123\n");
}

seed().catch(console.error);
