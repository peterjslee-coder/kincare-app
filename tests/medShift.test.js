const { coveringSession, applyShift } = require("../src/utils/medShift");

const S = (o) => ({ status: "confirmed", caregiver_user_id: "tina", caregiver_first: "Tina", ...o });

describe("v1.138.0 — meds follow the caregiver on shift", () => {
  test("noon Monday is Tina's; noon Saturday is Kay's", () => {
    const sessions = [
      S({ id: "mon", scheduled_date: "2026-11-23", scheduled_time: "09:00", duration_hours: 8 }),
      S({ id: "sat", scheduled_date: "2026-11-28", scheduled_time: "10:00", duration_hours: 4, caregiver_user_id: "kay", caregiver_first: "Kay" }),
    ];
    expect(coveringSession(sessions, "2026-11-23", "12:00").id).toBe("mon");
    expect(coveringSession(sessions, "2026-11-28", "12:00").caregiver_first).toBe("Kay");
    expect(coveringSession(sessions, "2026-11-28", "14:00")).toBe(null); // ends at 2, exclusive
    expect(coveringSession(sessions, "2026-11-24", "12:00")).toBe(null);
  });
  test("an overnight from the night before covers the morning dose", () => {
    const s = [S({ id: "night", scheduled_date: "2026-11-22", scheduled_time: "20:00", duration_hours: 12 })];
    expect(coveringSession(s, "2026-11-23", "07:30").id).toBe("night");
    expect(coveringSession(s, "2026-11-23", "08:00")).toBe(null);
  });
  test("cancelled and open visits don't cover; the later start wins an overlap", () => {
    const s = [
      S({ id: "a", scheduled_date: "2026-11-23", scheduled_time: "08:00", duration_hours: 8 }),
      S({ id: "b", scheduled_date: "2026-11-23", scheduled_time: "11:00", duration_hours: 4, caregiver_user_id: "kay" }),
      S({ id: "c", scheduled_date: "2026-11-23", scheduled_time: "11:30", duration_hours: 4, status: "cancelled" }),
    ];
    expect(coveringSession(s, "2026-11-23", "12:00").id).toBe("b");
  });
  test("a dose someone was picked for keeps that person; non-meds are untouched", () => {
    const sessions = [S({ id: "mon", scheduled_date: "2026-11-23", scheduled_time: "09:00", duration_hours: 8 })];
    const out = applyShift([
      { id: 1, task_type: "medication", occ_time: "12:00", due_date: "2026-11-23", assigned_user_id: "pete", assignee_first_name: "Pete" },
      { id: 2, task_type: "medication", occ_time: "12:00", due_date: "2026-11-23", occ_assigned_user_id: "dan", assigned_user_id: "dan" },
      { id: 3, task_type: "other", occ_time: "12:00", due_date: "2026-11-23" },
      { id: 4, task_type: "medication", occ_time: "20:00", due_date: "2026-11-23" },
    ], sessions, "2026-11-23");
    expect(out[0]).toMatchObject({ assigned_user_id: "tina", assignee_first_name: "Tina", on_shift: true });
    expect(out[1].assigned_user_id).toBe("dan");
    expect(out[2].on_shift).toBeUndefined();
    expect(out[3].on_shift).toBe(false);
  });
});
