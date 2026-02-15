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
    "emergency_contacts", "caregiver_assignments", "recipient_notes", "messages",
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
  const bettyUserId = uuid();

  // Family user (Pete — Care Team primary)
  db.prepare(`
    INSERT INTO users (id, email, password_hash, role, first_name, last_name, phone)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(peteId, "pete@kincare.app", passwordHash, "family", "Pete", "Lee", "(626) 555-0142");

  // Caregiver users
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

  // Cared-For user (Betty — limited access, controlled by Pete)
  db.prepare(`
    INSERT INTO users (id, email, password_hash, role, first_name, last_name, phone)
    VALUES (?, ?, ?, 'care_for', ?, ?, ?)
  `).run(bettyUserId, "betty@kincare.app", passwordHash, "Betty", "Lee", "(540) 555-0100");

  console.log("✅ Users created (7 — Pete, 4 caregivers, Betty)");

  // ─── Additional Family Users (Maria's other clients) ───
  const hendersonFamilyId = uuid();
  const patelFamilyId = uuid();

  db.prepare(`
    INSERT INTO users (id, email, password_hash, role, first_name, last_name, phone)
    VALUES (?, ?, ?, 'family', ?, ?, ?)
  `).run(hendersonFamilyId, "linda@kincare.app", passwordHash, "Linda", "Henderson", "(540) 555-0301");

  db.prepare(`
    INSERT INTO users (id, email, password_hash, role, first_name, last_name, phone)
    VALUES (?, ?, ?, 'family', ?, ?, ?)
  `).run(patelFamilyId, "raj@kincare.app", passwordHash, "Raj", "Patel", "(540) 555-0302");

  console.log("✅ Additional family users created (2 — Henderson, Patel)");

  // ─── Care Recipient (Betty — Pete's mother) ───
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

  // ─── Care Recipient (Dorothy Henderson — Linda's mother) ───
  const dorothyId = uuid();
  db.prepare(`
    INSERT INTO care_recipients
    (id, family_user_id, first_name, last_name, age,
     location_address, location_city, location_state, location_zip,
     latitude, longitude,
     health_conditions, medications, preferences,
     emergency_contact_name, emergency_contact_phone)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    dorothyId, hendersonFamilyId, "Dorothy", "Henderson", 82,
    "456 Oak Avenue", "Blacksburg", "VA", "24060",
    37.2340, -80.4180,
    JSON.stringify(["Type 2 diabetes", "Hearing loss"]),
    JSON.stringify(["Metformin 500mg", "Lisinopril 10mg"]),
    "Hard of hearing — speak clearly and face her. Enjoys card games and baking.",
    "Linda Henderson", "(540) 555-0301"
  );

  // ─── Care Recipient (Arun Patel — Raj's father) ───
  const arunId = uuid();
  db.prepare(`
    INSERT INTO care_recipients
    (id, family_user_id, first_name, last_name, age,
     location_address, location_city, location_state, location_zip,
     latitude, longitude,
     health_conditions, medications, preferences,
     emergency_contact_name, emergency_contact_phone)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    arunId, patelFamilyId, "Arun", "Patel", 75,
    "789 Elm Street", "Christiansburg", "VA", "24073",
    37.1310, -80.4095,
    JSON.stringify(["Parkinson's disease", "Mild depression"]),
    JSON.stringify(["Levodopa 100mg", "Sertraline 50mg"]),
    "Enjoys chess and classical music. Needs help with fine motor tasks. Very independent — let him try first.",
    "Raj Patel", "(540) 555-0302"
  );

  console.log("✅ Care recipients created (3 — Betty, Dorothy, Arun)");

  // ─── Emergency Contacts ───
  const emergencyContacts = [
    // Betty's contacts
    [uuid(), bettyId, "Pete Lee", "Son (Primary)", "(626) 555-0142", "pete@kincare.app", 1, 0],
    [uuid(), bettyId, "Susan Lee-Park", "Daughter", "(310) 555-0188", "susan.leepark@gmail.com", 0, 1],
    [uuid(), bettyId, "David Lee", "Son", "(415) 555-0199", "david.lee@gmail.com", 0, 2],
    [uuid(), bettyId, "Dr. Anita Sharma", "Primary Physician", "(540) 555-0400", null, 0, 3],
    // Dorothy's contacts
    [uuid(), dorothyId, "Linda Henderson", "Daughter (Primary)", "(540) 555-0301", "linda@kincare.app", 1, 0],
    [uuid(), dorothyId, "Mark Henderson", "Son", "(540) 555-0310", "mark.henderson@gmail.com", 0, 1],
    // Arun's contacts
    [uuid(), arunId, "Raj Patel", "Son (Primary)", "(540) 555-0302", "raj@kincare.app", 1, 0],
    [uuid(), arunId, "Priya Patel", "Daughter-in-law", "(540) 555-0303", "priya.patel@gmail.com", 0, 1],
  ];

  for (const [id, recipientId, name, relationship, phone, email, isPrimary, sortOrder] of emergencyContacts) {
    db.prepare(`
      INSERT INTO emergency_contacts (id, care_recipient_id, name, relationship, phone, email, is_primary, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, recipientId, name, relationship, phone, email, isPrimary, sortOrder);
  }

  console.log("✅ Emergency contacts created (8 — 4 for Betty, 2 for Dorothy, 2 for Arun)");

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

  // ─── Caregiver Assignments ───
  // Betty's assigned caregivers: Maria (favorite) and James
  db.prepare(`
    INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite)
    VALUES (?, ?, ?, ?, 1, 1)
  `).run(uuid(), bettyId, peteId, mariaId);

  db.prepare(`
    INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite)
    VALUES (?, ?, ?, ?, 1, 0)
  `).run(uuid(), bettyId, peteId, jamesId);

  // Dorothy's assigned caregivers: Maria and Sarah
  db.prepare(`
    INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite)
    VALUES (?, ?, ?, ?, 1, 1)
  `).run(uuid(), dorothyId, hendersonFamilyId, mariaId);

  db.prepare(`
    INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite)
    VALUES (?, ?, ?, ?, 1, 0)
  `).run(uuid(), dorothyId, hendersonFamilyId, sarahId);

  // Arun's assigned caregiver: James
  db.prepare(`
    INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite)
    VALUES (?, ?, ?, ?, 1, 0)
  `).run(uuid(), arunId, patelFamilyId, jamesId);

  console.log("✅ Caregiver assignments created (5)");

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

  // ─── Care Sessions (Pete/Betty) ───
  const sessions = [
    [uuid(), bettyId, peteId, mariaId, "meals", "confirmed", "2026-02-14", "14:00", 2, "Mom prefers lunch around noon. Please remind her to drink water.", 56],
    [uuid(), bettyId, peteId, jamesId, "companion", "confirmed", "2026-02-15", "10:00", 3, "She loves looking at photo albums.", 75],
    [uuid(), bettyId, peteId, mariaId, "rides", "pending", "2026-02-19", "09:00", 1.5, "Doctor appointment at 9:30. Pickup prescriptions after.", 42],
    [uuid(), bettyId, peteId, jamesId, "companion", "confirmed", "2026-02-21", "11:00", 2, null, 50],
    [uuid(), bettyId, peteId, mariaId, "meals", "confirmed", "2026-02-25", "12:00", 2, "Betty requested her favorite tomato soup.", 56],
    [uuid(), bettyId, peteId, sarahId, "companion", "pending", "2026-02-28", "10:00", 3, "First visit with Sarah — introduce slowly, show photo albums.", 96],
    [uuid(), bettyId, peteId, jamesId, "rides", "confirmed", "2026-03-03", "09:30", 1.5, "Follow-up appointment with Dr. Patel. Bring medication list.", 37],
    [uuid(), bettyId, peteId, mariaId, "meals", "confirmed", "2026-03-05", "12:00", 2, "Prepare meals for the week and label with dates.", 56],
    [uuid(), bettyId, peteId, davidId, "companion", "pending", "2026-03-07", "14:00", 2, "Afternoon gardening and light walk around the neighborhood.", 44],
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

  // Past completed sessions (Pete/Betty)
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

  // ─── Care Sessions (Henderson/Dorothy — Maria's other client) ───
  const hendersonSessions = [
    [uuid(), dorothyId, hendersonFamilyId, mariaId, "meals", "confirmed", "2026-02-17", "09:00", 2, "Dorothy likes her eggs scrambled, toast lightly done.", 56],
    [uuid(), dorothyId, hendersonFamilyId, mariaId, "companion", "confirmed", "2026-02-20", "14:00", 3, "Card games and afternoon tea. She enjoys rummy.", 84],
    [uuid(), dorothyId, hendersonFamilyId, sarahId, "meals", "pending", "2026-02-24", "11:00", 2, "Diabetic-friendly meal prep for the week.", 64],
    [uuid(), dorothyId, hendersonFamilyId, mariaId, "companion", "confirmed", "2026-03-02", "10:00", 2, "Help with baking — she wants to make cookies for her church group.", 56],
  ];

  for (const [id, recipId, famId, cgId, type, status, date, time, hours, notes, cost] of hendersonSessions) {
    db.prepare(`
      INSERT INTO care_sessions
      (id, care_recipient_id, family_user_id, caregiver_id, service_type,
       status, scheduled_date, scheduled_time, duration_hours,
       special_instructions, estimated_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, recipId, famId, cgId, type, status, date, time, hours, notes, cost);
  }

  // ─── Care Sessions (Patel/Arun — James's other client) ───
  const patelSessions = [
    [uuid(), arunId, patelFamilyId, jamesId, "companion", "confirmed", "2026-02-18", "10:00", 2, "Chess and conversation. Arun prefers quiet activities.", 50],
    [uuid(), arunId, patelFamilyId, jamesId, "rides", "pending", "2026-02-22", "09:00", 1.5, "Physical therapy appointment at 9:30 AM.", 37],
  ];

  for (const [id, recipId, famId, cgId, type, status, date, time, hours, notes, cost] of patelSessions) {
    db.prepare(`
      INSERT INTO care_sessions
      (id, care_recipient_id, family_user_id, caregiver_id, service_type,
       status, scheduled_date, scheduled_time, duration_hours,
       special_instructions, estimated_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, recipId, famId, cgId, type, status, date, time, hours, notes, cost);
  }

  console.log("✅ Care sessions created (19 — 13 for Betty, 4 for Dorothy, 2 for Arun)");

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
      "Maria prepared chicken soup. Betty ate well and was in good spirits.", "-5 days"],
    [uuid(), peteId, bettyId, "session_confirmed", "Caregiver matched: James Okafor",
      "James will arrive tomorrow at 10:00 AM for companionship.", "-3 days"],
    [uuid(), peteId, bettyId, "visit_complete", "Visit completed",
      "James and Betty looked through photo albums and took a short walk.", "-2 days"],
    [uuid(), peteId, bettyId, "session_booked", "Rides & Errands requested",
      "Session booked for Feb 19 at 9:00 AM — doctor appointment.", "-1 day"],
    [uuid(), peteId, bettyId, "visit_complete", "Grocery run completed",
      "Maria picked up groceries from Kroger and stocked the fridge.", "-12 hours"],
    [uuid(), peteId, bettyId, "session_confirmed", "Meal Prep confirmed for Feb 25",
      "Maria Santos will prepare Betty's favorite tomato soup and meals for the week.", "-6 hours"],
    [uuid(), peteId, bettyId, "session_booked", "New caregiver introduction scheduled",
      "Sarah Chen will visit Betty on Feb 28 for a companionship session. First visit — please ensure a warm welcome.", "-2 hours"],
  ];

  for (const [id, famId, recipId, type, title, msg, timeOffset] of activities) {
    db.prepare(`
      INSERT INTO activity_feed
      (id, family_user_id, care_recipient_id, event_type, title, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))
    `).run(id, famId, recipId, type, title, msg, timeOffset);
  }

  console.log("✅ Activity feed populated (7)");

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

  // ─── Messages ───
  const msgs = [
    // Pete ↔ Maria
    [uuid(), mariaUserId, peteId, "Good morning! Betty is in great spirits today. We just finished breakfast — she had oatmeal with blueberries!", "-4 hours"],
    [uuid(), peteId, mariaUserId, "That's wonderful to hear! How was she feeling this morning?", "-3 hours"],
    [uuid(), mariaUserId, peteId, "She was very alert and chatty. We looked through her photo album and she told me stories about her garden.", "-2 hours"],
    [uuid(), peteId, mariaUserId, "She loves that album! Thank you for spending time with her on that.", "-1 hour"],
    // Pete ↔ James
    [uuid(), jamesUserId, peteId, "Hi Pete! Just arrived at Betty's. She seems to be doing well today.", "-6 hours"],
    [uuid(), peteId, jamesUserId, "Great, thanks James! She mentioned wanting to do puzzles.", "-5 hours"],
    [uuid(), jamesUserId, peteId, "Yes! We worked on a 500-piece puzzle of a garden scene. She was really focused.", "-4 hours"],
    // Maria ↔ Betty (caretaker ↔ cared-for)
    [uuid(), mariaUserId, bettyUserId, "Hi Betty! Looking forward to seeing you tomorrow. Is there anything special you'd like for lunch?", "-8 hours"],
    [uuid(), bettyUserId, mariaUserId, "Oh Maria dear, could you make that tomato soup again? It was so good last time!", "-7 hours"],
    [uuid(), mariaUserId, bettyUserId, "Of course! I'll pick up fresh tomatoes on my way. See you at noon! 🍅", "-6 hours"],
  ];

  for (const [id, senderId, recipientId, content, timeOffset] of msgs) {
    db.prepare(`
      INSERT INTO messages (id, sender_id, recipient_id, content, is_read, created_at)
      VALUES (?, ?, ?, ?, 1, datetime('now', ?))
    `).run(id, senderId, recipientId, content, timeOffset);
  }

  console.log("✅ Messages created (10)");

  // ─── Recipient Notes (Betty's notes for upcoming appointments) ───
  const notes = [
    [uuid(), bettyId, bettyUserId, "Need to pick up: sourdough bread, yogurt, bananas, and cat food for Whiskers", "grocery", "-2 days"],
    [uuid(), bettyId, bettyUserId, "Ask doctor about the new knee pain — started last Tuesday", "medical", "-1 day"],
    [uuid(), bettyId, bettyUserId, "Remind Maria about the tomato soup recipe from last month", "general", "-3 hours"],
    [uuid(), bettyId, peteId, "Mom mentioned she's been sleeping poorly. Let's ask Dr. Patel about it at the next visit.", "medical", "-6 hours"],
  ];

  for (const [id, recipId, authorId, content, noteType, timeOffset] of notes) {
    db.prepare(`
      INSERT INTO recipient_notes (id, care_recipient_id, author_id, content, note_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now', ?), datetime('now', ?))
    `).run(id, recipId, authorId, content, noteType, timeOffset, timeOffset);
  }

  console.log("✅ Recipient notes created (4)");

  console.log("\n🎉 Seed complete! Database ready.\n");
  console.log("Demo logins:");
  console.log("  Care Team:  pete@kincare.app  / kincare123");
  console.log("  Caretaker:  maria@kincare.app / kincare123");
  console.log("  Cared-For:  betty@kincare.app / kincare123\n");
}

seed().catch(console.error);
