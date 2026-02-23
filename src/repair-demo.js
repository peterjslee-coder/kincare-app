#!/usr/bin/env node
/**
 * repair-demo.js — Insert missing demo data (care recipients, caregiver profiles,
 * assignments, sessions, etc.) for existing demo users.
 *
 * SAFE: Only inserts data linked to demo users (is_demo=1). Never touches real accounts.
 * IDEMPOTENT: Checks for existing data before inserting.
 *
 * Usage: node src/repair-demo.js
 */
require("dotenv").config();
const { v4: uuid } = require("uuid");
const { initializeDatabase, getDb } = require("./models/database");

async function repairDemo() {
  console.log("🔧 Starting demo data repair...\n");

  await initializeDatabase();
  const db = await getDb();

  // ─── Look up existing demo user IDs ───
  const demoUsers = await db.prepare("SELECT id, email, role FROM users WHERE is_demo = 1").all();
  console.log(`Found ${demoUsers.length} demo users:`);
  demoUsers.forEach(u => console.log(`  ${u.email} (${u.role}) — ${u.id.substring(0,8)}...`));

  const findUser = (email) => {
    const u = demoUsers.find(x => x.email === email);
    if (!u) throw new Error(`Demo user not found: ${email}`);
    return u.id;
  };

  const peteId = findUser("paul@inplace.care");
  const mariaUserId = findUser("maria@inplace.care");
  const jamesUserId = findUser("james@inplace.care");
  const sarahUserId = findUser("sarah@inplace.care");
  const davidUserId = findUser("david@inplace.care");
  const bettyUserId = findUser("barbara@inplace.care");
  const davidLeeId = findUser("david.lowe@inplace.care");
  const susanLeeId = findUser("susan.lowe@inplace.care");
  const hendersonFamilyId = findUser("linda@inplace.care");
  const patelFamilyId = findUser("raj@inplace.care");

  // ─── Check if care recipients already exist ───
  const existingRecipients = await db.prepare(
    "SELECT COUNT(*) as count FROM care_recipients WHERE family_user_id IN (SELECT id FROM users WHERE is_demo = 1)"
  ).get();

  if (parseInt(existingRecipients.count) > 0) {
    console.log(`\n⚠️  ${existingRecipients.count} demo care recipients already exist. Skipping care recipient creation.`);
  } else {
    console.log("\n📝 Creating care recipients...");

    // Barbara Lowe (Paul's mother)
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
      "Early-stage dementia, mild arthritis (both knees), high blood pressure (controlled), occasional vertigo, poor hearing left ear (hearing aid)"
    );
    console.log("  ✅ Barbara Lowe (Paul's mother)");

    // Dorothy Henderson (Linda's mother)
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
      JSON.stringify(["Metformin 500mg twice daily", "Vitamin B12"]),
      "Enjoys reading and birdwatching. Needs help with meal prep and grocery shopping.",
      "Linda Henderson", "(540) 555-0301",
      "1 cat — Pepper (black, indoor, senior, 14 yrs)",
      "None known",
      JSON.stringify([]),
      "Type 2 diabetes, hearing loss"
    );
    console.log("  ✅ Dorothy Henderson (Linda's mother)");

    // Arun Patel (Raj's father)
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
      arunId, patelFamilyId, "Arun", "Patel", 85,
      "789 Elm Drive", "Christiansburg", "VA", "24073",
      37.1320, -80.4100,
      JSON.stringify(["Parkinson's disease (early stage)", "Mild cognitive impairment"]),
      JSON.stringify(["Levodopa/Carbidopa", "Memantine 10mg daily"]),
      "Speaks Hindi and English. Vegetarian. Enjoys chess and cricket on TV.",
      "Raj Patel", "(540) 555-0302",
      "None",
      "None known",
      JSON.stringify(["None"]),
      "Parkinson's disease (early stage), mild cognitive impairment"
    );
    console.log("  ✅ Arun Patel (Raj's father)");

    // Carlos Santos (Maria's brother — she's both caregiver and family for him)
    const carlosId = uuid();
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
      carlosId, mariaUserId, "Carlos", "Santos", 30,
      "321 Pine Road", "Blacksburg", "VA", "24060",
      37.2270, -80.4110,
      JSON.stringify(["Traumatic brain injury (recovery)", "Short-term memory issues", "Mild left-side weakness", "Anxiety"]),
      JSON.stringify(["Sertraline 50mg daily", "Gabapentin 300mg twice daily", "Melatonin 5mg nightly"]),
      "Loves sports and video games. Responds well to routine and patience. Needs help with cooking and appointments.",
      "Maria Santos", "(540) 555-0201",
      "1 dog — Luna (golden retriever, therapy dog, very gentle, 3 yrs)",
      "None known",
      JSON.stringify(["Dairy (moderate — causes stomach cramps)"]),
      "Traumatic brain injury (recovery), short-term memory issues, mild left-side weakness, anxiety"
    );
    console.log("  ✅ Carlos Santos (Maria's brother)");

    // ─── Caregiver Profiles ───
    const existingProfiles = await db.prepare(
      "SELECT COUNT(*) as count FROM caregiver_profiles WHERE user_id IN (SELECT id FROM users WHERE is_demo = 1)"
    ).get();

    if (parseInt(existingProfiles.count) > 0) {
      console.log(`\n⚠️  ${existingProfiles.count} demo caregiver profiles already exist. Skipping.`);
    } else {
      console.log("\n📝 Creating caregiver profiles...");

      const mariaId = uuid();
      const jamesId = uuid();
      const sarahId = uuid();
      const davidId = uuid();

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

      const profiles = [
        [mariaId, mariaUserId, "Certified dementia care specialist with 8 years of experience. Fluent in English and Spanish.",
          8, 34, ["Dementia Care", "Meal Prep"], ["CNA", "CPR/First Aid"], 1, 4.9, 127, "Blacksburg", "VA", 37.2300, -80.4145,
          "Blacksburg, VA 24060", 15, stoplights.maria],
        [jamesId, jamesUserId, "Former social worker passionate about elder care. CPR/First Aid certified.",
          5, 25, ["Companionship", "Transportation"], ["CPR/First Aid", "Social Work License"], 1, 4.8, 93, "Blacksburg", "VA", 37.2310, -80.4160,
          "Blacksburg, VA 24060", 10, stoplights.james],
        [sarahId, sarahUserId, "Registered nurse turned home caregiver. Specializes in nutrition for seniors.",
          12, 32, ["Meal Prep", "Medication Reminders"], ["RN", "Nutrition Certificate", "CPR/First Aid"], 0, 4.9, 156, "Christiansburg", "VA", 37.1298, -80.4089,
          "Christiansburg, VA 24073", 25, stoplights.sarah],
        [davidId, davidUserId, "Reliable and patient. Great with seniors who need help with daily tasks.",
          3, 22, ["Errands", "Light Housekeeping"], ["CPR/First Aid"], 1, 4.7, 68, "Blacksburg", "VA", 37.2280, -80.4200,
          "Blacksburg, VA 24060", 10, stoplights.david],
      ];

      for (const [id, userId, bio, years, rate, specs, certs, avail, rating, count, city, state, lat, lng, workLoc, radius, stoplight] of profiles) {
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
          workLoc, radius, JSON.stringify(stoplight));
      }

      // Maria fully onboarded
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

      // James partially complete
      await db.prepare(`
        UPDATE caregiver_profiles SET
          checkr_status = 'pending',
          legal_first_name = 'James',
          legal_last_name = 'Okafor'
        WHERE id = ?
      `).run(jamesId);

      console.log("  ✅ 4 caregiver profiles created (Maria fully onboarded, James partial)");

      // ─── Caregiver Assignments ───
      console.log("\n📝 Creating caregiver assignments...");
      await db.prepare(`INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite) VALUES (?, ?, ?, ?, 1, 1)`).run(uuid(), bettyId, peteId, mariaId);
      await db.prepare(`INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite) VALUES (?, ?, ?, ?, 1, 0)`).run(uuid(), bettyId, peteId, jamesId);
      await db.prepare(`INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite) VALUES (?, ?, ?, ?, 1, 1)`).run(uuid(), dorothyId, hendersonFamilyId, mariaId);
      await db.prepare(`INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite) VALUES (?, ?, ?, ?, 1, 0)`).run(uuid(), dorothyId, hendersonFamilyId, sarahId);
      await db.prepare(`INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite) VALUES (?, ?, ?, ?, 1, 0)`).run(uuid(), arunId, patelFamilyId, jamesId);
      await db.prepare(`INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite) VALUES (?, ?, ?, ?, 1, 0)`).run(uuid(), bettyId, davidLeeId, jamesId);
      await db.prepare(`INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite) VALUES (?, ?, ?, ?, 1, 0)`).run(uuid(), bettyId, susanLeeId, jamesId);
      await db.prepare(`INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite) VALUES (?, ?, ?, ?, 1, 0)`).run(uuid(), arunId, patelFamilyId, mariaId);
      await db.prepare(`INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite) VALUES (?, ?, ?, ?, 1, 1)`).run(uuid(), carlosId, mariaUserId, sarahId);
      await db.prepare(`INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite) VALUES (?, ?, ?, ?, 1, 0)`).run(uuid(), carlosId, mariaUserId, jamesId);
      console.log("  ✅ 10 caregiver assignments created");

      // ─── Availability Windows ───
      console.log("\n📝 Creating availability...");
      // Maria: Mon-Fri 8am-5pm, Wed 2-4pm blocked
      for (let day = 1; day <= 5; day++) {
        await db.prepare(`INSERT INTO availability (id, caregiver_id, day_of_week, start_time, end_time, type) VALUES (?, ?, ?, '08:00', '17:00', 'available')`).run(uuid(), mariaId, day);
      }
      await db.prepare(`INSERT INTO availability (id, caregiver_id, day_of_week, start_time, end_time, type, note) VALUES (?, ?, 3, '14:00', '16:00', 'blocked', 'Personal appointment')`).run(uuid(), mariaId);
      // James: Mon-Fri 7am-3pm, Sat 8am-12pm
      for (let day = 1; day <= 5; day++) {
        await db.prepare(`INSERT INTO availability (id, caregiver_id, day_of_week, start_time, end_time, type) VALUES (?, ?, ?, '07:00', '15:00', 'available')`).run(uuid(), jamesId, day);
      }
      await db.prepare(`INSERT INTO availability (id, caregiver_id, day_of_week, start_time, end_time, type) VALUES (?, ?, 6, '08:00', '12:00', 'available')`).run(uuid(), jamesId);
      // David Kim: Mon-Fri 8am-5pm
      for (let day = 1; day <= 5; day++) {
        await db.prepare(`INSERT INTO availability (id, caregiver_id, day_of_week, start_time, end_time, type) VALUES (?, ?, ?, '08:00', '17:00', 'available')`).run(uuid(), davidId, day);
      }
      // Sarah Chen: Mon,Tue,Thu,Fri 9am-5pm
      for (const day of [1, 2, 4, 5]) {
        await db.prepare(`INSERT INTO availability (id, caregiver_id, day_of_week, start_time, end_time, type) VALUES (?, ?, ?, '09:00', '17:00', 'available')`).run(uuid(), sarahId, day);
      }
      console.log("  ✅ Availability windows created");

      // ─── Avatars ───
      console.log("\n📝 Setting avatars...");
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
        await db.prepare(`UPDATE users SET avatar_url = ?, profile_photo = ? WHERE id = ? AND is_demo = 1`).run(avatarUrl, avatarUrl, userId);
      }
      console.log("  ✅ Avatars set");

      // ─── Care recipient shares for siblings ───
      console.log("\n📝 Creating care recipient shares...");
      await db.prepare(`INSERT INTO care_recipient_shares (id, care_recipient_id, owner_user_id, shared_with_user_id, permission) VALUES (?, ?, ?, ?, 'edit') ON CONFLICT DO NOTHING`).run(uuid(), bettyId, peteId, davidLeeId);
      await db.prepare(`INSERT INTO care_recipient_shares (id, care_recipient_id, owner_user_id, shared_with_user_id, permission) VALUES (?, ?, ?, ?, 'edit') ON CONFLICT DO NOTHING`).run(uuid(), bettyId, peteId, susanLeeId);
      console.log("  ✅ Barbara shared with David and Susan");
    }
  }

  console.log("\n✅ Demo data repair complete!");
  process.exit(0);
}

repairDemo().catch(err => {
  console.error("❌ Repair failed:", err);
  process.exit(1);
});
