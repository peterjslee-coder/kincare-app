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
const DEMO_SEED_VERSION = '1.7.1';

async function seed() {
  console.log("🌱 Seeding InPlace database...\n");

  await initializeDatabase();
  const db = await getDb();

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

  // ─── Users ───
  const passwordHash = await bcrypt.hash("inplace123", 10);

  const peteId = uuid();
  const mariaUserId = uuid();
  const jamesUserId = uuid();
  const sarahUserId = uuid();
  const davidUserId = uuid();
  const bettyUserId = uuid();

  // Family user (Pete — Care Team primary)
  await db.prepare(`
    INSERT INTO users (id, email, password_hash, role, first_name, last_name, phone, is_demo)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `).run(peteId, "pete@inplace.care", passwordHash, "family", "Pete", "Lee", "(626) 555-0142");

  // Caregiver users
  const caregiverUsers = [
    [mariaUserId, "maria@inplace.care", "Maria", "Santos", "(540) 555-0201"],
    [jamesUserId, "james@inplace.care", "James", "Okafor", "(540) 555-0202"],
    [sarahUserId, "sarah@inplace.care", "Sarah", "Chen", "(540) 555-0203"],
    [davidUserId, "david@inplace.care", "David", "Kim", "(540) 555-0204"],
  ];

  for (const [id, email, first, last, phone] of caregiverUsers) {
    await db.prepare(`
      INSERT INTO users (id, email, password_hash, role, first_name, last_name, phone, is_demo)
      VALUES (?, ?, ?, 'caregiver', ?, ?, ?, 1)
    `).run(id, email, passwordHash, first, last, phone);
  }

  // Cared-For user (Betty — limited access, controlled by Pete)
  await db.prepare(`
    INSERT INTO users (id, email, password_hash, role, first_name, last_name, phone, is_demo)
    VALUES (?, ?, ?, 'care_for', ?, ?, ?, 1)
  `).run(bettyUserId, "betty@inplace.care", passwordHash, "Betty", "Lee", "(540) 555-0100");

  // Sibling family users (Pete's siblings who also coordinate Betty's care)
  const davidLeeId = uuid();
  const susanLeeId = uuid();

  await db.prepare(`
    INSERT INTO users (id, email, password_hash, role, first_name, last_name, phone, is_demo)
    VALUES (?, ?, ?, 'family', ?, ?, ?, 1)
  `).run(davidLeeId, "david.lee@inplace.care", passwordHash, "David", "Lee", "(626) 555-0143");

  await db.prepare(`
    INSERT INTO users (id, email, password_hash, role, first_name, last_name, phone, is_demo)
    VALUES (?, ?, ?, 'family', ?, ?, ?, 1)
  `).run(susanLeeId, "susan.lee@inplace.care", passwordHash, "Susan", "Lee", "(626) 555-0144");

  // ─── Real admin account (Pete's actual login) ───
  const realPeteId = uuid();
  await db.prepare(`
    INSERT INTO users (id, email, password_hash, role, first_name, last_name, phone, is_demo, is_admin, email_verified)
    VALUES (?, ?, ?, 'family', ?, ?, ?, 0, 1, 1)
  `).run(realPeteId, "peterjslee@gmail.com", passwordHash, "Pete", "Lee", "(626) 555-0142");

  console.log("✅ Users created (10 — Pete real + Pete demo, David, Susan, 4 caregivers, Betty)");

  // ─── Additional Family Users (Maria's other clients) ───
  const hendersonFamilyId = uuid();
  const patelFamilyId = uuid();

  await db.prepare(`
    INSERT INTO users (id, email, password_hash, role, first_name, last_name, phone, is_demo)
    VALUES (?, ?, ?, 'family', ?, ?, ?, 1)
  `).run(hendersonFamilyId, "linda@inplace.care", passwordHash, "Linda", "Henderson", "(540) 555-0301");

  await db.prepare(`
    INSERT INTO users (id, email, password_hash, role, first_name, last_name, phone, is_demo)
    VALUES (?, ?, ?, 'family', ?, ?, ?, 1)
  `).run(patelFamilyId, "raj@inplace.care", passwordHash, "Raj", "Patel", "(540) 555-0302");

  console.log("✅ Additional family users created (2 — Henderson, Patel)");

  // ─── Care Recipient (Betty — Pete's mother) ───
  const bettyId = uuid();
  await db.prepare(`
    INSERT INTO care_recipients
    (id, family_user_id, first_name, last_name, age,
     location_address, location_city, location_state, location_zip,
     latitude, longitude,
     health_conditions, medications, preferences,
     emergency_contact_name, emergency_contact_phone,
     pets, pet_allergies, food_allergies, medical_conditions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    bettyId, peteId, "Betty", "Lee", 78,
    "123 Main Street", "Blacksburg", "VA", "24060",
    37.2296, -80.4139,
    JSON.stringify(["Early-stage dementia", "Mild arthritis"]),
    JSON.stringify(["Donepezil 10mg", "Ibuprofen PRN"]),
    "Prefers female caregivers. Loves gardening and old movies. Needs gentle reminders for meals.",
    "Pete Lee", "(626) 555-0142",
    "1 cat (Whiskers — orange tabby, indoor, friendly)",
    "None",
    "Shellfish allergy (mild — causes hives)",
    "Early-stage dementia, mild arthritis, occasional knee pain"
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
     pets, pet_allergies, food_allergies, medical_conditions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    "Type 2 diabetes, hearing loss (wears hearing aids)"
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
     pets, pet_allergies, food_allergies, medical_conditions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    "Parkinson's disease (early stage), mild depression, occasional hand tremors"
  );

  // ─── Care Recipient (Betty — David's view, same person) ───
  const bettyForDavidId = uuid();
  await db.prepare(`
    INSERT INTO care_recipients
    (id, family_user_id, first_name, last_name, age,
     location_address, location_city, location_state, location_zip,
     latitude, longitude,
     health_conditions, medications, preferences,
     emergency_contact_name, emergency_contact_phone,
     pets, pet_allergies, food_allergies, medical_conditions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    bettyForDavidId, davidLeeId, "Betty", "Lee", 78,
    "123 Main Street", "Blacksburg", "VA", "24060",
    37.2296, -80.4139,
    JSON.stringify(["Early-stage dementia", "Mild arthritis"]),
    JSON.stringify(["Donepezil 10mg", "Ibuprofen PRN"]),
    "Prefers female caregivers. Loves gardening and old movies. Needs gentle reminders for meals.",
    "Pete Lee", "(626) 555-0142",
    "1 cat (Whiskers — orange tabby, indoor, friendly)",
    "None",
    "Shellfish allergy (mild — causes hives)",
    "Early-stage dementia, mild arthritis, occasional knee pain"
  );

  // ─── Care Recipient (Betty — Susan's view, same person) ───
  const bettyForSusanId = uuid();
  await db.prepare(`
    INSERT INTO care_recipients
    (id, family_user_id, first_name, last_name, age,
     location_address, location_city, location_state, location_zip,
     latitude, longitude,
     health_conditions, medications, preferences,
     emergency_contact_name, emergency_contact_phone,
     pets, pet_allergies, food_allergies, medical_conditions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    bettyForSusanId, susanLeeId, "Betty", "Lee", 78,
    "123 Main Street", "Blacksburg", "VA", "24060",
    37.2296, -80.4139,
    JSON.stringify(["Early-stage dementia", "Mild arthritis"]),
    JSON.stringify(["Donepezil 10mg", "Ibuprofen PRN"]),
    "Prefers female caregivers. Loves gardening and old movies. Needs gentle reminders for meals.",
    "Pete Lee", "(626) 555-0142",
    "1 cat (Whiskers — orange tabby, indoor, friendly)",
    "None",
    "Shellfish allergy (mild — causes hives)",
    "Early-stage dementia, mild arthritis, occasional knee pain"
  );

  console.log("✅ Care recipients created (5 — Betty×3, Dorothy, Arun)");

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

  console.log("✅ Caregiver profiles created (4)");

  // ─── Caregiver Assignments ───
  await db.prepare(`INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite) VALUES (?, ?, ?, ?, 1, 1)`).run(uuid(), bettyId, peteId, mariaId);
  await db.prepare(`INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite) VALUES (?, ?, ?, ?, 1, 0)`).run(uuid(), bettyId, peteId, jamesId);
  await db.prepare(`INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite) VALUES (?, ?, ?, ?, 1, 1)`).run(uuid(), dorothyId, hendersonFamilyId, mariaId);
  await db.prepare(`INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite) VALUES (?, ?, ?, ?, 1, 0)`).run(uuid(), dorothyId, hendersonFamilyId, sarahId);
  await db.prepare(`INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite) VALUES (?, ?, ?, ?, 1, 0)`).run(uuid(), arunId, patelFamilyId, jamesId);

  // Sibling assignments (David and Susan also have James for Betty; Maria is already assigned via Pete's Betty)
  await db.prepare(`INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite) VALUES (?, ?, ?, ?, 1, 0)`).run(uuid(), bettyForDavidId, davidLeeId, jamesId);
  await db.prepare(`INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite) VALUES (?, ?, ?, ?, 1, 0)`).run(uuid(), bettyForSusanId, susanLeeId, jamesId);

  // Maria also works with Arun Patel
  await db.prepare(`INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite) VALUES (?, ?, ?, ?, 1, 0)`).run(uuid(), arunId, patelFamilyId, mariaId);

  console.log("✅ Caregiver assignments created (8)");

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

  // One-off block: Maria blocked Feb 26 afternoon (specific date override)
  await db.prepare(`
    INSERT INTO availability (id, caregiver_id, day_of_week, start_time, end_time, is_recurring, specific_date, type, note)
    VALUES (?, ?, 3, '12:00', '17:00', 0, '2026-02-26', 'blocked', 'Doctor appointment')
  `).run(uuid(), mariaId);

  console.log("✅ Availability windows created (with types and blocked rules)");

  // ─── Care Sessions (Pete/Betty) — Upcoming ───
  const sessions = [
    [uuid(), bettyId, peteId, mariaId, "meals", "confirmed", "2026-02-20", "08:00", 5, "Meal prep for the week — Betty's favorites.", 170],
    [uuid(), bettyId, peteId, jamesId, "companion", "confirmed", "2026-02-21", "10:00", 3, "She loves looking at photo albums.", 75],
    [uuid(), bettyId, peteId, mariaId, "meals", "confirmed", "2026-02-24", "08:00", 8, "Full day care — meal prep, companionship, light housekeeping.", 272],
    [uuid(), bettyId, peteId, mariaId, "rides", "pending", "2026-02-25", "09:00", 2, "Doctor appointment at 9:30. Pickup prescriptions after.", 68],
    [uuid(), bettyId, peteId, sarahId, "companion", "pending", "2026-02-28", "10:00", 3, "First visit with Sarah — introduce slowly, show photo albums.", 96],
    [uuid(), bettyId, peteId, jamesId, "rides", "confirmed", "2026-03-03", "09:30", 1.5, "Follow-up appointment with Dr. Patel. Bring medication list.", 37],
    [uuid(), bettyId, peteId, mariaId, "meals", "confirmed", "2026-03-05", "12:00", 5, "Prepare meals for the week and label with dates.", 170],
    [uuid(), bettyId, peteId, davidId, "companion", "pending", "2026-03-07", "14:00", 2, "Afternoon gardening and light walk around the neighborhood.", 44],
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
  // ~18 sessions over Jan 20 – Feb 18 spanning Betty, Dorothy, and Arun
  // One 8-hour full day with Betty on Feb 12
  const pastSessions = [
    // Maria with Betty (Pete's)
    [uuid(), bettyId, peteId, mariaId, "meals", "completed", "2026-01-20", "08:00", 6, "Full morning meal prep and lunch.", 204],
    [uuid(), bettyId, peteId, mariaId, "companion", "completed", "2026-01-22", "09:00", 5, "Companionship and afternoon activities.", 170],
    [uuid(), bettyId, peteId, mariaId, "meals", "completed", "2026-01-24", "08:00", 6, "Breakfast, lunch prep, medication reminders.", 204],
    [uuid(), bettyId, peteId, mariaId, "companion", "completed", "2026-01-27", "08:00", 7, "Full day care — walks, meals, photo albums.", 238],
    [uuid(), bettyId, peteId, mariaId, "meals", "completed", "2026-01-29", "08:00", 5, "Meal prep and grocery shopping.", 170],
    [uuid(), bettyId, peteId, mariaId, "companion", "completed", "2026-01-31", "09:00", 6, "Companionship, gardening, and lunch.", 204],
    [uuid(), bettyId, peteId, mariaId, "meals", "completed", "2026-02-03", "08:00", 6, "Weekly meal prep and medication organizing.", 204],
    [uuid(), bettyId, peteId, mariaId, "companion", "completed", "2026-02-05", "09:00", 5, "Photo albums, short walk, afternoon tea.", 170],
    [uuid(), bettyId, peteId, mariaId, "meals", "completed", "2026-02-07", "08:00", 7, "Extended meal prep and companionship.", 238],
    [uuid(), bettyId, peteId, mariaId, "companion", "completed", "2026-02-10", "08:00", 6, "Morning routine assistance and activities.", 204],
    [uuid(), bettyId, peteId, mariaId, "meals", "completed", "2026-02-12", "08:00", 8, "Full 8-hour day — meals, companionship, light housekeeping.", 272],
    [uuid(), bettyId, peteId, mariaId, "companion", "completed", "2026-02-14", "09:00", 5, "Valentine's Day — special lunch and card making.", 170],
    [uuid(), bettyId, peteId, mariaId, "meals", "completed", "2026-02-17", "08:00", 6, "Meal prep, medication check, organized kitchen.", 204],
    [uuid(), bettyId, peteId, mariaId, "rides", "completed", "2026-02-18", "09:00", 4, "Doctor appointment and grocery run.", 136],
    // Maria with Betty (additional Feb sessions for ~$4K monthly target)
    [uuid(), bettyId, peteId, mariaId, "companion", "completed", "2026-02-02", "09:00", 6, "Morning routine, puzzles, and lunch prep.", 204],
    [uuid(), bettyId, peteId, mariaId, "meals", "completed", "2026-02-06", "08:00", 7, "Grocery shopping, meal prep, and kitchen cleanup.", 238],
    [uuid(), bettyId, peteId, mariaId, "companion", "completed", "2026-02-09", "09:00", 6, "Photo albums, short walk, afternoon nap monitoring.", 204],
    [uuid(), bettyId, peteId, mariaId, "meals", "completed", "2026-02-11", "08:00", 6, "Meal prep and medication organizing.", 204],
    [uuid(), bettyId, peteId, mariaId, "companion", "completed", "2026-02-13", "09:00", 7, "Full day companionship — crafts, games, garden walk.", 238],
    [uuid(), bettyId, peteId, mariaId, "meals", "completed", "2026-02-16", "08:00", 6, "Weekly meal prep — Betty's favorites.", 204],
    // Maria with Dorothy (Henderson's)
    [uuid(), dorothyId, hendersonFamilyId, mariaId, "meals", "completed", "2026-01-23", "09:00", 5, "Diabetic-friendly meals for the week.", 170],
    [uuid(), dorothyId, hendersonFamilyId, mariaId, "companion", "completed", "2026-02-04", "10:00", 4, "Card games and afternoon tea.", 136],
    [uuid(), dorothyId, hendersonFamilyId, mariaId, "meals", "completed", "2026-02-08", "09:00", 5, "Meal prep and baking cookies.", 170],
    [uuid(), dorothyId, hendersonFamilyId, mariaId, "companion", "completed", "2026-02-13", "14:00", 4, "Afternoon tea and puzzles.", 136],
    [uuid(), dorothyId, hendersonFamilyId, mariaId, "meals", "completed", "2026-02-15", "09:00", 5, "Diabetic-friendly meal prep.", 170],
    // James with Betty (past)
    [uuid(), bettyId, peteId, jamesId, "companion", "completed", "2026-02-09", "10:00", 3, "Puzzles and photo albums.", 75],
    // David Kim with Betty (past)
    [uuid(), bettyId, peteId, davidId, "rides", "completed", "2026-02-06", "09:00", 1.5, "Doctor appointment transport.", 33],
  ];
  // Maria Feb totals: 20 Betty sessions (~124 hrs) + 5 Dorothy sessions (~23 hrs) ≈ $4,000+

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
    [uuid(), dorothyId, hendersonFamilyId, mariaId, "meals", "confirmed", "2026-02-21", "09:00", 4, "Dorothy likes her eggs scrambled, toast lightly done.", 136],
    [uuid(), dorothyId, hendersonFamilyId, mariaId, "companion", "confirmed", "2026-02-26", "14:00", 3, "Card games and afternoon tea. She enjoys rummy.", 102],
    [uuid(), dorothyId, hendersonFamilyId, sarahId, "meals", "pending", "2026-02-27", "11:00", 2, "Diabetic-friendly meal prep for the week.", 64],
    [uuid(), dorothyId, hendersonFamilyId, mariaId, "companion", "confirmed", "2026-03-02", "10:00", 4, "Help with baking — she wants to make cookies for her church group.", 136],
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
    [uuid(), arunId, patelFamilyId, jamesId, "companion", "confirmed", "2026-02-18", "10:00", 2, "Chess and conversation. Arun prefers quiet activities.", 50],
    [uuid(), arunId, patelFamilyId, jamesId, "rides", "pending", "2026-02-22", "09:00", 1.5, "Physical therapy appointment at 9:30 AM.", 37],
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

  // ─── Care Sessions (David Lee / Betty) ───
  const davidSessions = [
    [uuid(), bettyForDavidId, davidLeeId, mariaId, "meals", "confirmed", "2026-02-22", "12:00", 4, "Mom likes her soup warm, not hot. David coordinating this week.", 136],
    [uuid(), bettyForDavidId, davidLeeId, jamesId, "companion", "pending", "2026-02-27", "10:00", 3, "Puzzles and light gardening. David will check in after.", 75],
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

  // ─── Care Sessions (Susan Lee / Betty) ───
  const susanSessions = [
    [uuid(), bettyForSusanId, susanLeeId, mariaId, "companion", "confirmed", "2026-02-23", "14:00", 4, "Susan requested a garden walk if weather permits.", 136],
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

  // ─── Care Requests (Betty requesting help — status='requested', no caregiver) ───
  const careRequests = [
    [uuid(), bettyId, peteId, null, "companion", "requested", "2026-02-22", "14:00", 2, "Would love some company this afternoon — maybe a walk if the weather is nice.", 50],
    [uuid(), bettyId, peteId, null, "meals", "requested", "2026-02-26", "11:00", 3, "Need help with meal prep for the week. Running low on groceries.", 90],
    [uuid(), bettyId, peteId, null, "rides", "requested", "2026-03-01", "09:00", 1.5, "Need a ride to the pharmacy and back.", 42],
    [uuid(), bettyId, peteId, null, "companion", "requested", "2026-03-04", "10:00", 3, "Morning companionship — puzzles and tea.", 75],
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

  console.log("✅ Care sessions created (35 — 8 upcoming Pete/Betty, 19 past completed, 4 Henderson, 2 Patel, 2 David/Betty, 1 Susan/Betty, 4 care requests)");

  // ─── Visit Logs ───
  // pastSessions[10] = Feb 12 full 8-hr day, [13] = Feb 18 rides, [25] = James Feb 9, [26] = David Feb 6
  const visitLogs = [
    [uuid(), pastSessions[10][0], mariaId,
      "Full 8-hour day with Betty. Prepared breakfast, lunch, and dinner. Organized medications, did light housekeeping, and spent afternoon doing puzzles. Betty was in wonderful spirits all day!",
      "Happy & engaged", ["Prepared 3 meals", "Organized medications", "Light housekeeping", "Puzzles", "Kitchen cleanup"]],
    [uuid(), pastSessions[25][0], jamesId,
      "Spent the morning looking through photo albums and chatting about her garden. She was in great spirits. We took a short walk around the block.",
      "Cheerful", ["Photo album activity", "Short walk", "Conversation"]],
    [uuid(), pastSessions[13][0], mariaId,
      "Drove Betty to Dr. Patel's office. Picked up prescriptions and groceries on the way home. Stocked the fridge and labeled leftovers.",
      "Calm", ["Doctor transport", "Prescription pickup", "Grocery shopping", "Stocked fridge"]],
    [uuid(), pastSessions[26][0], davidId,
      "Drove Betty to her doctor's appointment. The visit went well — no changes to medication. Picked up her prescription on the way home.",
      "A little tired", ["Doctor transport", "Prescription pickup"]],
  ];

  for (const [id, sessionId, cgId, summary, mood, tasks] of visitLogs) {
    await db.prepare(`
      INSERT INTO visit_logs
      (id, session_id, caregiver_id, check_in_time, check_out_time,
       summary, mood_rating, tasks_completed)
      VALUES (?, ?, ?, NOW() - INTERVAL '2 hours', NOW(), ?, ?, ?)
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
    await db.prepare(`
      INSERT INTO activity_feed
      (id, family_user_id, care_recipient_id, event_type, title, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW() + ?::interval)
    `).run(id, famId, recipId, type, title, msg, timeOffset);
  }

  // Activity feed for David Lee
  await db.prepare(`
    INSERT INTO activity_feed (id, family_user_id, care_recipient_id, event_type, title, message, created_at)
    VALUES (?, ?, ?, 'session_confirmed', 'Meal Prep confirmed for Feb 20', 'Maria Santos will prepare lunch for Betty.', NOW() - INTERVAL '4 hours')
  `).run(uuid(), davidLeeId, bettyForDavidId);

  // Activity feed for Susan Lee
  await db.prepare(`
    INSERT INTO activity_feed (id, family_user_id, care_recipient_id, event_type, title, message, created_at)
    VALUES (?, ?, ?, 'session_confirmed', 'Companionship confirmed for Feb 22', 'Maria Santos will visit Betty for an afternoon garden walk.', NOW() - INTERVAL '3 hours')
  `).run(uuid(), susanLeeId, bettyForSusanId);

  console.log("✅ Activity feed populated (9)");

  // ─── Reviews ───
  const reviews = [
    [uuid(), pastSessions[10][0], peteId, mariaId, 5, "Maria spent a full day with Mom and she was in great spirits. Incredible care and attention."],
    [uuid(), pastSessions[25][0], peteId, jamesId, 5, "James is so patient and kind. Mom really enjoys his visits."],
    [uuid(), pastSessions[13][0], peteId, mariaId, 5, "Always gets exactly what Mom needs from the store and doctor visits."],
    [uuid(), pastSessions[26][0], peteId, davidId, 4, "David was punctual and helpful. Mom was comfortable with him."],
  ];

  for (const [id, sessionId, famId, cgId, rating, comment] of reviews) {
    await db.prepare(`
      INSERT INTO reviews (id, session_id, family_user_id, caregiver_id, rating, comment)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, sessionId, famId, cgId, rating, comment);
  }

  console.log("✅ Reviews created (4)");

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
  const msgs = [
    [uuid(), mariaUserId, peteId, convPeteMaria, "Good morning! Betty is in great spirits today. We just finished breakfast — she had oatmeal with blueberries!", "-4 hours"],
    [uuid(), peteId, mariaUserId, convPeteMaria, "That's wonderful to hear! How was she feeling this morning?", "-3 hours"],
    [uuid(), mariaUserId, peteId, convPeteMaria, "She was very alert and chatty. We looked through her photo album and she told me stories about her garden.", "-2 hours"],
    [uuid(), peteId, mariaUserId, convPeteMaria, "She loves that album! Thank you for spending time with her on that.", "-1 hour"],
    [uuid(), jamesUserId, peteId, convPeteJames, "Hi Pete! Just arrived at Betty's. She seems to be doing well today.", "-6 hours"],
    [uuid(), peteId, jamesUserId, convPeteJames, "Great, thanks James! She mentioned wanting to do puzzles.", "-5 hours"],
    [uuid(), jamesUserId, peteId, convPeteJames, "Yes! We worked on a 500-piece puzzle of a garden scene. She was really focused.", "-4 hours"],
    [uuid(), mariaUserId, bettyUserId, convBettyMaria, "Hi Betty! Looking forward to seeing you tomorrow. Is there anything special you'd like for lunch?", "-8 hours"],
    [uuid(), bettyUserId, mariaUserId, convBettyMaria, "Oh Maria dear, could you make that tomato soup again? It was so good last time!", "-7 hours"],
    [uuid(), mariaUserId, bettyUserId, convBettyMaria, "Of course! I'll pick up fresh tomatoes on my way. See you at noon! 🍅", "-6 hours"],
  ];

  for (const [id, senderId, recipientId, conversationId, content, timeOffset] of msgs) {
    await db.prepare(`
      INSERT INTO messages (id, sender_id, recipient_id, conversation_id, content, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, 1, NOW() + ?::interval)
    `).run(id, senderId, recipientId, conversationId, content, timeOffset);
  }

  // Messages between siblings and caregivers
  const siblingMsgs = [
    [uuid(), davidLeeId, mariaUserId, convDavidMaria, "Hi Maria, this is David — Pete's brother. I'll be coordinating Mom's care this week while Pete is traveling.", "-10 hours"],
    [uuid(), mariaUserId, davidLeeId, convDavidMaria, "Hi David! No problem at all. Betty and I have our routine down. I'll send you updates after each visit.", "-9 hours"],
    [uuid(), susanLeeId, mariaUserId, convSusanMaria, "Maria, it's Susan. Could you check if Mom has enough of her Donepezil? I want to make sure we're not running low.", "-7 hours"],
    [uuid(), mariaUserId, susanLeeId, convSusanMaria, "Hi Susan! I'll check her pill organizer tomorrow and let you know. She had about a week's supply last time I looked.", "-6 hours"],
  ];

  for (const [id, senderId, recipientId, conversationId, content, timeOffset] of siblingMsgs) {
    await db.prepare(`
      INSERT INTO messages (id, sender_id, recipient_id, conversation_id, content, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, 1, NOW() + ?::interval)
    `).run(id, senderId, recipientId, conversationId, content, timeOffset);
  }

  console.log("✅ Messages created (14)");

  // ─── Recipient Notes ───
  const notes = [
    [uuid(), bettyId, bettyUserId, "Need to pick up: sourdough bread, yogurt, bananas, and cat food for Whiskers", "grocery", "-2 days"],
    [uuid(), bettyId, bettyUserId, "Ask doctor about the new knee pain — started last Tuesday", "medical", "-1 day"],
    [uuid(), bettyId, bettyUserId, "Remind Maria about the tomato soup recipe from last month", "general", "-3 hours"],
    [uuid(), bettyId, peteId, "Mom mentioned she's been sleeping poorly. Let's ask Dr. Patel about it at the next visit.", "medical", "-6 hours"],
  ];

  for (const [id, recipId, authorId, content, noteType, timeOffset] of notes) {
    await db.prepare(`
      INSERT INTO recipient_notes (id, care_recipient_id, author_id, content, note_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NOW() + ?::interval, NOW() + ?::interval)
    `).run(id, recipId, authorId, content, noteType, timeOffset, timeOffset);
  }

  console.log("✅ Recipient notes created (4)");

  // ─── Share Betty with siblings ───
  // Pete shares Betty's care recipient record with David and Susan
  await db.prepare(
    "INSERT INTO care_recipient_shares (id, care_recipient_id, shared_with_user_id, permission, shared_by_user_id) VALUES (?, ?, ?, 'edit', ?)"
  ).run(uuid(), bettyId, davidLeeId, peteId);
  await db.prepare(
    "INSERT INTO care_recipient_shares (id, care_recipient_id, shared_with_user_id, permission, shared_by_user_id) VALUES (?, ?, ?, 'edit', ?)"
  ).run(uuid(), bettyId, susanLeeId, peteId);

  console.log("✅ Care recipient sharing created (Betty shared with David & Susan)");

  // ─── Care Teams ───
  // Betty's Care Team (Pete is leader, David and Susan are members)
  const bettyCareTeamId = uuid();
  await db.prepare(
    "INSERT INTO care_teams (id, name, care_recipient_id, created_by) VALUES (?, ?, ?, ?)"
  ).run(bettyCareTeamId, "Betty Lee's Care Team", bettyId, peteId);

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

  console.log("✅ Care teams created (3 — Betty with 3 members, Dorothy, Arun)");

  // ─── Care Team Conversations ───
  const bettyCareTeamConvId = uuid();
  await db.prepare(
    "INSERT INTO conversations (id, type, name, care_team_id, created_by) VALUES (?, 'care_team', ?, ?, ?)"
  ).run(bettyCareTeamConvId, "Betty Lee's Care Team", bettyCareTeamId, peteId);

  // Add all 3 Lee siblings to the care team conversation
  for (const [userId, role] of [[peteId, "admin"], [davidLeeId, "member"], [susanLeeId, "member"]]) {
    await db.prepare(
      "INSERT INTO conversation_members (id, conversation_id, user_id, role, last_read_at) VALUES (?, ?, ?, ?, NOW())"
    ).run(uuid(), bettyCareTeamConvId, userId, role);
  }

  // Seed group messages in the care team chat
  const teamMsgs = [
    [uuid(), peteId, bettyCareTeamConvId, "Hey everyone — I set up this group chat so we can coordinate Mom's care more easily. Let's use it for updates!", "-2 days"],
    [uuid(), davidLeeId, bettyCareTeamConvId, "Great idea Pete. I'm covering this week while you're traveling. Maria has everything under control.", "-2 days"],
    [uuid(), susanLeeId, bettyCareTeamConvId, "Thanks David! Can someone check if Mom's Donepezil is running low? I want to call in a refill if needed.", "-1 day"],
    [uuid(), peteId, bettyCareTeamConvId, "I asked Maria to check tomorrow. She said Mom had about a week's supply. I'll call Dr. Patel's office for a refill just in case.", "-12 hours"],
    [uuid(), davidLeeId, bettyCareTeamConvId, "Perfect. Also, Mom mentioned she wants to plant tomatoes this spring. Maybe we can set that up next weekend?", "-6 hours"],
    [uuid(), susanLeeId, bettyCareTeamConvId, "She would love that! I'll pick up some seedlings from the garden center.", "-3 hours"],
  ];

  for (const [id, senderId, conversationId, content, timeOffset] of teamMsgs) {
    await db.prepare(`
      INSERT INTO messages (id, sender_id, conversation_id, content, is_read, created_at)
      VALUES (?, ?, ?, ?, 1, NOW() + ?::interval)
    `).run(id, senderId, conversationId, content, timeOffset);
  }

  console.log("✅ Care team conversation created (Betty's team with 6 group messages)");

  // ─── Seed Version Marker ───
  // Store version in waitlist with special internal email so server.js can detect stale demo data
  await db.prepare(`
    INSERT INTO waitlist (id, email, name, created_at)
    VALUES (?, '_seed_version@inplace.internal', ?, NOW())
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
  `).run(uuid(), DEMO_SEED_VERSION);

  console.log(`✅ Seed version marker set: ${DEMO_SEED_VERSION}`);
  console.log("\n🎉 Seed complete! Database ready.\n");
  console.log("Demo logins:");
  console.log("  Care Team:       pete@inplace.care       / inplace123");
  console.log("  Sibling (David): david.lee@inplace.care  / inplace123");
  console.log("  Sibling (Susan): susan.lee@inplace.care  / inplace123");
  console.log("  Caretaker:       maria@inplace.care      / inplace123");
  console.log("  Cared-For:       betty@inplace.care      / inplace123\n");

}

// Export for in-process seeding from server.js
module.exports = { seed, DEMO_SEED_VERSION };

// Run directly if called from CLI (npm run seed)
if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}
