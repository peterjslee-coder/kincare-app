/**
 * InPlace — Availability Routes
 * CRUD for caregiver availability rules + slot computation
 */
const express = require("express");
const router = express.Router();
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");

// All routes require authentication
router.use(authenticate);

// ─── GET /api/availability — Get my availability rules ───
router.get("/", async (req, res) => {
  try {
    const db = await getDb();

    // Get caregiver profile for authenticated user
    const profile = await db.prepare(
      "SELECT id FROM caregiver_profiles WHERE user_id = ?"
    ).get(req.user.id);

    if (!profile) {
      return res.status(403).json({ error: "Only caregivers can manage availability" });
    }

    const rules = await db.prepare(
      "SELECT * FROM availability WHERE caregiver_id = ? ORDER BY day_of_week, start_time"
    ).all(profile.id);

    res.json({
      rules: rules.map(r => ({
        id: r.id,
        dayOfWeek: r.day_of_week,
        startTime: r.start_time,
        endTime: r.end_time,
        isRecurring: r.is_recurring === 1,
        specificDate: r.specific_date,
        type: r.type || "available",
        note: r.note,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    console.error("GET /availability error:", err);
    res.status(500).json({ error: "Failed to fetch availability" });
  }
});

// ─── POST /api/availability — Add a rule ───
router.post("/", async (req, res) => {
  try {
    const db = await getDb();
    const profile = await db.prepare(
      "SELECT id FROM caregiver_profiles WHERE user_id = ?"
    ).get(req.user.id);

    if (!profile) {
      return res.status(403).json({ error: "Only caregivers can manage availability" });
    }

    const { dayOfWeek, startTime, endTime, isRecurring = true, specificDate, type = "available", note } = req.body;

    // Validation
    if (dayOfWeek === undefined || dayOfWeek < 0 || dayOfWeek > 6) {
      return res.status(400).json({ error: "dayOfWeek must be 0-6 (Sun-Sat)" });
    }
    if (!startTime || !endTime) {
      return res.status(400).json({ error: "startTime and endTime are required (HH:MM format)" });
    }
    if (startTime >= endTime) {
      return res.status(400).json({ error: "startTime must be before endTime" });
    }
    if (!["available", "blocked"].includes(type)) {
      return res.status(400).json({ error: "type must be 'available' or 'blocked'" });
    }

    const id = uuid();
    await db.prepare(`
      INSERT INTO availability (id, caregiver_id, day_of_week, start_time, end_time, is_recurring, specific_date, type, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, profile.id, dayOfWeek, startTime, endTime, isRecurring ? 1 : 0, specificDate || null, type, note || null);

    res.status(201).json({
      id,
      dayOfWeek,
      startTime,
      endTime,
      isRecurring,
      specificDate: specificDate || null,
      type,
      note: note || null,
    });
  } catch (err) {
    console.error("POST /availability error:", err);
    res.status(500).json({ error: "Failed to create availability rule" });
  }
});

// ─── PUT /api/availability/:id — Update a rule ───
router.put("/:id", async (req, res) => {
  try {
    const db = await getDb();
    const profile = await db.prepare(
      "SELECT id FROM caregiver_profiles WHERE user_id = ?"
    ).get(req.user.id);

    if (!profile) {
      return res.status(403).json({ error: "Only caregivers can manage availability" });
    }

    // Verify ownership
    const existing = await db.prepare(
      "SELECT * FROM availability WHERE id = ? AND caregiver_id = ?"
    ).get(req.params.id, profile.id);

    if (!existing) {
      return res.status(404).json({ error: "Availability rule not found" });
    }

    const { dayOfWeek, startTime, endTime, isRecurring, specificDate, type, note } = req.body;

    const updates = [];
    const values = [];

    if (dayOfWeek !== undefined) { updates.push("day_of_week = ?"); values.push(dayOfWeek); }
    if (startTime) { updates.push("start_time = ?"); values.push(startTime); }
    if (endTime) { updates.push("end_time = ?"); values.push(endTime); }
    if (isRecurring !== undefined) { updates.push("is_recurring = ?"); values.push(isRecurring ? 1 : 0); }
    if (specificDate !== undefined) { updates.push("specific_date = ?"); values.push(specificDate || null); }
    if (type) { updates.push("type = ?"); values.push(type); }
    if (note !== undefined) { updates.push("note = ?"); values.push(note || null); }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(req.params.id);
    await db.prepare(`UPDATE availability SET ${updates.join(", ")} WHERE id = ?`).run(...values);

    const updated = await db.prepare("SELECT * FROM availability WHERE id = ?").get(req.params.id);
    res.json({
      id: updated.id,
      dayOfWeek: updated.day_of_week,
      startTime: updated.start_time,
      endTime: updated.end_time,
      isRecurring: updated.is_recurring === 1,
      specificDate: updated.specific_date,
      type: updated.type || "available",
      note: updated.note,
    });
  } catch (err) {
    console.error("PUT /availability error:", err);
    res.status(500).json({ error: "Failed to update availability rule" });
  }
});

// ─── DELETE /api/availability/:id — Delete a rule ───
router.delete("/:id", async (req, res) => {
  try {
    const db = await getDb();
    const profile = await db.prepare(
      "SELECT id FROM caregiver_profiles WHERE user_id = ?"
    ).get(req.user.id);

    if (!profile) {
      return res.status(403).json({ error: "Only caregivers can manage availability" });
    }

    const existing = await db.prepare(
      "SELECT * FROM availability WHERE id = ? AND caregiver_id = ?"
    ).get(req.params.id, profile.id);

    if (!existing) {
      return res.status(404).json({ error: "Availability rule not found" });
    }

    await db.prepare("DELETE FROM availability WHERE id = ?").run(req.params.id);
    res.json({ message: "Rule deleted" });
  } catch (err) {
    console.error("DELETE /availability error:", err);
    res.status(500).json({ error: "Failed to delete availability rule" });
  }
});

// ─── GET /api/availability/:caregiverId/slots — Compute available slots for a date ───
// Public-ish: any authenticated user can check caregiver availability
// Query params: date (YYYY-MM-DD), days (optional, default 1, max 7)
router.get("/:caregiverId/slots", async (req, res) => {
  try {
    const db = await getDb();
    const { caregiverId } = req.params;
    const { date, days = 1 } = req.query;

    if (!date) {
      return res.status(400).json({ error: "date query param required (YYYY-MM-DD)" });
    }

    const numDays = Math.min(parseInt(days) || 1, 7);
    const result = {};

    for (let d = 0; d < numDays; d++) {
      const currentDate = new Date(date + "T12:00:00");
      currentDate.setDate(currentDate.getDate() + d);
      const dateStr = currentDate.toISOString().split("T")[0];
      const dayOfWeek = currentDate.getDay(); // 0=Sun, 6=Sat

      const slots = await computeAvailableSlots(db, caregiverId, dateStr, dayOfWeek);
      result[dateStr] = slots;
    }

    res.json({ slots: result });
  } catch (err) {
    console.error("GET /availability/:id/slots error:", err);
    res.status(500).json({ error: "Failed to compute availability slots" });
  }
});

/**
 * Compute available 1-hour slots for a caregiver on a specific date.
 * Logic:
 * 1. Get 'available' rules matching this day (recurring or specific date)
 * 2. Subtract 'blocked' rules matching this day
 * 3. Subtract existing booked care_sessions
 * 4. Return array of available time slots
 */
async function computeAvailableSlots(db, caregiverId, dateStr, dayOfWeek) {
  // 1. Get available windows: recurring for this day_of_week OR specific_date match
  const availableRules = await db.prepare(`
    SELECT start_time, end_time FROM availability
    WHERE caregiver_id = ? AND type = 'available'
    AND (
      (is_recurring = 1 AND day_of_week = ? AND specific_date IS NULL)
      OR (specific_date = ?)
    )
  `).all(caregiverId, dayOfWeek, dateStr);

  if (availableRules.length === 0) {
    return []; // Not working this day
  }

  // 2. Get blocked windows
  const blockedRules = await db.prepare(`
    SELECT start_time, end_time FROM availability
    WHERE caregiver_id = ? AND type = 'blocked'
    AND (
      (is_recurring = 1 AND day_of_week = ? AND specific_date IS NULL)
      OR (specific_date = ?)
    )
  `).all(caregiverId, dayOfWeek, dateStr);

  // 3. Get existing booked sessions for this date
  const bookedSessions = await db.prepare(`
    SELECT scheduled_time, duration_hours FROM care_sessions
    WHERE caregiver_id = ? AND scheduled_date = ? AND status NOT IN ('cancelled')
  `).all(caregiverId, dateStr);

  // Build minute-level availability map (0 = unavailable, 1 = available)
  const minutes = new Array(24 * 60).fill(0);

  // Mark available windows
  for (const rule of availableRules) {
    const start = timeToMinutes(rule.start_time);
    const end = timeToMinutes(rule.end_time);
    for (let m = start; m < end; m++) {
      minutes[m] = 1;
    }
  }

  // Remove blocked windows
  for (const block of blockedRules) {
    const start = timeToMinutes(block.start_time);
    const end = timeToMinutes(block.end_time);
    for (let m = start; m < end; m++) {
      minutes[m] = 0;
    }
  }

  // Remove booked sessions
  for (const session of bookedSessions) {
    const start = timeToMinutes(session.scheduled_time);
    const durationMin = (session.duration_hours || 2) * 60;
    for (let m = start; m < start + durationMin && m < 24 * 60; m++) {
      minutes[m] = 0;
    }
  }

  // Generate 1-hour slots from the availability map
  const slots = [];
  for (let hour = 0; hour < 23; hour++) {
    const startMin = hour * 60;
    const endMin = startMin + 60;
    // Check if the full hour is available
    let available = true;
    for (let m = startMin; m < endMin; m++) {
      if (minutes[m] === 0) { available = false; break; }
    }
    if (available) {
      slots.push({
        start: minutesToTime(startMin),
        end: minutesToTime(endMin),
        startMinutes: startMin,
      });
    }
  }

  return slots;
}

function timeToMinutes(timeStr) {
  // Parse "HH:MM" or "H:MM" 24-hour format
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + (m || 0);
}

function minutesToTime(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Export the slot computation for reuse in sessions.js
router.computeAvailableSlots = computeAvailableSlots;

module.exports = router;
