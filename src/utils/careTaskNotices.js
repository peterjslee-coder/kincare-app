// ─── v1.112.2 — a "care task not checked off" notice is settled once the task is ───
//
// Pete, 10/12: "why's there a care task not accomplished activity thing with a 'sara completed
// meds for betty'?" The escalation went out at 7:00 PM ("Betty's 2026-10-12 task hasn't been
// checked off. Can anyone confirm it happened?"), Sara checked it off at 7:12 PM — and the
// question stayed in his Activity card, unread, on top of the answer, worded with a raw date.
//
// Two halves: when an occurrence is checked off (or skipped) every notification about it is
// marked read; and the feed rewrites a settled one to say who answered and when.

/** Due time as people say it, in the task's own zone: "5:00 PM". */
function dueTimeLabel(dueAt, tz) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric", minute: "2-digit", timeZone: tz || "America/New_York",
    }).format(new Date(dueAt));
  } catch { return null; }
}

/** Mark every notification about this occurrence read, for everyone. Never throws. */
async function settleOccurrenceNotices(db, occurrenceId) {
  if (!occurrenceId) return;
  try {
    await db.prepare(
      "UPDATE notifications SET read = 1 WHERE read = 0 AND data LIKE ?"
    ).run(`%"occurrenceId":"${String(occurrenceId).replace(/[^a-zA-Z0-9-]/g, "")}"%`);
  } catch (e) {
    console.error("[careTaskNotices] settle failed:", e.message);
  }
}

/**
 * Rewrite care-task notices whose occurrence has since been checked off or skipped.
 * `rows` are notification rows (data as JSON string or object). Returns new rows.
 */
async function resolveCareTaskNotices(db, rows) {
  const ids = new Set();
  const parsed = (rows || []).map((n) => {
    let data = null;
    try { data = n.data ? (typeof n.data === "string" ? JSON.parse(n.data) : n.data) : null; } catch { data = null; }
    if (data && data.occurrenceId && String(data.type || "").startsWith("care_task")) ids.add(String(data.occurrenceId));
    return { n, data };
  });
  if (!ids.size) return rows;
  const list = [...ids];
  let occ = [];
  try {
    occ = await db.prepare(`
      SELECT o.id, o.status, o.completed_at, o.completed_by_name, o.due_at,
             u.first_name AS completer_first, COALESCE(t.tz, cr.timezone) AS tz, cr.first_name AS recipient_first
      FROM care_task_occurrences o
      JOIN care_tasks t ON t.id = o.task_id
      JOIN care_recipients cr ON cr.id = t.care_recipient_id
      LEFT JOIN users u ON u.id = o.completed_by_user_id
      WHERE o.id IN (${list.map(() => "?").join(",")})
    `).all(...list);
  } catch (e) {
    console.error("[careTaskNotices] resolve lookup failed:", e.message);
    return rows;
  }
  const byId = new Map(occ.map((o) => [o.id, o]));
  return parsed.map(({ n, data }) => {
    const o = data && data.occurrenceId ? byId.get(String(data.occurrenceId)) : null;
    if (!o || (o.status !== "done" && o.status !== "skipped")) return n;
    const who = o.completed_by_name || o.completer_first || "Someone";
    const due = dueTimeLabel(o.due_at, o.tz);
    const at = o.completed_at ? dueTimeLabel(o.completed_at, o.tz) : null;
    const what = `${o.recipient_first || "the"}'s ${due ? `${due} ` : ""}task`;
    return {
      ...n,
      read: 1,
      title: o.status === "done" ? "\u2713 Care task checked off" : "Care task skipped",
      body: `${who} ${o.status === "done" ? "checked off" : "skipped"} ${what}${at ? ` at ${at}` : ""}.`,
    };
  });
}

module.exports = { dueTimeLabel, settleOccurrenceNotices, resolveCareTaskNotices };
