#!/usr/bin/env node

/**
 * Repair: separate personal DMs from the "InPlace Support" thread. (v1.105.104)
 *
 * WHY
 * ---
 * Until v1.105.102, seven places asked "is there already a direct conversation containing
 * these two users?" with `WHERE c.type = 'direct'` and no ORDER BY and no LIMIT. An admin who
 * is also a person — Pete — already had an "InPlace Support" row with Julia, so his personal
 * messages could land in the platform's thread, and she saw him as "InPlace support".
 *
 * v1.105.102 stops it happening again. It does not undo what already happened. This does.
 *
 * THE SPLIT IS DATA, NOT GUESSWORK
 * --------------------------------
 * `messages.sender_label` already records which is which. `admin/safety.js` writes
 * 'InPlace Support' on every message sent AS the platform; every ordinary send path leaves it
 * NULL. So inside a mixed thread:
 *
 *   sender_label = 'InPlace Support'  ->  the platform spoke
 *   sender_label IS NULL              ->  a person spoke
 *
 * The only genuinely ambiguous messages are the OTHER party's replies, which carry no label
 * either way. Those are assigned by conversation flow: a reply belongs with the message it
 * follows in time. That is how the thread read to the person who wrote it.
 *
 * TWO OUTCOMES
 * ------------
 *   CLEAR   the thread is named "InPlace Support" but the platform never actually spoke in it.
 *           It was only ever a DM wearing the wrong name. Clear the name - one row, no message
 *           moves - and it is titled by the partner from then on.
 *   SPLIT   the thread holds both. Personal messages (and the replies that follow them) move
 *           to the real DM, creating it if there isn't one.
 *
 * THE TRAP THIS SCRIPT AVOIDS
 * ---------------------------
 * A thread's visible history starts at `COALESCE(cm.joined_at, c.created_at)` (messages.js,
 * v1.105.92). Move a message written in June into a DM whose members joined in August and it
 * is delivered into the invisible half - the repair would "succeed" and the messages would
 * vanish. So the destination's `joined_at` and `created_at` are back-dated to the earliest
 * message being moved.
 *
 * USAGE
 * -----
 *   node scripts/repair-support-dm-split.js            # report only, changes nothing
 *   node scripts/repair-support-dm-split.js --apply    # do it
 *   node scripts/repair-support-dm-split.js --apply --only <conversationId>
 *
 * Run it in the Railway service console, where DATABASE_URL is already set. Take a snapshot
 * first (docs/OPS_RUNBOOK.md -> manual pg_dump); this moves rows between conversations.
 */

require("dotenv").config();
const { v4: uuid } = require("uuid");
const { getDb } = require("../src/models/database");

const SUPPORT = "InPlace Support";
const APPLY = process.argv.includes("--apply");
const ONLY = (() => {
  const i = process.argv.indexOf("--only");
  return i > -1 ? process.argv[i + 1] : null;
})();

const name = (u) => (u ? `${u.first_name} ${u.last_name}` : "someone");

/**
 * Assign every message in a mixed thread to 'support' or 'personal'.
 * Labelled messages decide themselves. Unlabelled messages from the ADMIN are personal -
 * the platform always labels itself. Unlabelled messages from anyone else are replies, and
 * follow whatever preceded them; before anything else exists they start as personal, because
 * a thread that opens with an unlabelled message was not opened by the platform.
 */
function classify(messages, adminId) {
  let current = "personal";
  return messages.map((m) => {
    if (m.sender_label === SUPPORT) current = "support";
    else if (m.sender_id === adminId) current = "personal";
    // else: a reply - inherits `current`
    return { ...m, side: current };
  });
}

async function main() {
  const db = await getDb();
  console.log(APPLY ? "MODE: apply\n" : "MODE: report only - nothing will be changed\n");

  const threads = await db.prepare(`
    SELECT c.id, c.created_at
    FROM conversations c
    WHERE c.type = 'direct' AND c.name = ?
    ORDER BY c.created_at
  `).all(SUPPORT);

  const targets = ONLY ? threads.filter((t) => t.id === ONLY) : threads;
  if (!targets.length) {
    console.log(ONLY ? `No "${SUPPORT}" thread with id ${ONLY}.` : `No "${SUPPORT}" threads found.`);
    return;
  }
  console.log(`${targets.length} "${SUPPORT}" thread(s) to examine.\n`);

  let cleared = 0, split = 0, untouched = 0;

  for (const t of targets) {
    const members = await db.prepare(`
      SELECT u.id, u.first_name, u.last_name, u.is_admin
      FROM conversation_members cm JOIN users u ON u.id = cm.user_id
      WHERE cm.conversation_id = ?
    `).all(t.id);

    const admin = members.find((m) => m.is_admin);
    const partner = members.find((m) => !m.is_admin);
    const label = `${t.id.slice(0, 8)}  ${name(admin)} <-> ${name(partner)}`;

    if (!admin || !partner || members.length !== 2) {
      console.log(`SKIP    ${label} - not a two-person admin/user thread`);
      untouched++;
      continue;
    }

    const messages = await db.prepare(`
      SELECT id, sender_id, sender_label, created_at, content
      FROM messages WHERE conversation_id = ? ORDER BY created_at, id
    `).all(t.id);

    const supportCount = messages.filter((m) => m.sender_label === SUPPORT).length;

    // -- CLEAR: the platform never actually spoke here --
    if (supportCount === 0) {
      console.log(`CLEAR   ${label} - ${messages.length} message(s), none sent as the platform`);
      console.log(`        -> it becomes a DM titled "${name(admin)}"`);
      if (APPLY) {
        await db.prepare("UPDATE conversations SET name = NULL WHERE id = ?").run(t.id);
      }
      cleared++;
      continue;
    }

    // -- SPLIT: both live here --
    const sided = classify(messages, admin.id);
    const personal = sided.filter((m) => m.side === "personal");

    if (!personal.length) {
      console.log(`OK      ${label} - ${messages.length} message(s), all of them support`);
      untouched++;
      continue;
    }

    console.log(`SPLIT   ${label}`);
    console.log(`        ${messages.length - personal.length} stay as ${SUPPORT}, ${personal.length} move to a DM`);
    for (const m of personal.slice(0, 5)) {
      const who = m.sender_id === admin.id ? name(admin) : name(partner);
      console.log(`          . ${new Date(m.created_at).toISOString().slice(0, 16)}  ${who}: ${String(m.content).replace(/\s+/g, " ").slice(0, 60)}`);
    }
    if (personal.length > 5) console.log(`          . ... and ${personal.length - 5} more`);

    // Destination: the existing personal DM, or a new one.
    let dm = await db.prepare(`
      SELECT c.id FROM conversations c
      JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
      JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
      WHERE c.type = 'direct' AND c.name IS NULL
      LIMIT 1
    `).get(admin.id, partner.id);

    const earliest = personal[0].created_at;
    console.log(`        -> ${dm ? `existing DM ${dm.id.slice(0, 8)}` : "a new DM"}, history back-dated to ${new Date(earliest).toISOString().slice(0, 10)}`);

    if (!APPLY) { split++; continue; }

    if (!dm) {
      const dmId = uuid();
      await db.prepare(
        "INSERT INTO conversations (id, type, name, created_by, created_at, updated_at) VALUES (?, 'direct', NULL, ?, ?, NOW())"
      ).run(dmId, admin.id, earliest);
      for (const m of members) {
        await db.prepare(
          "INSERT INTO conversation_members (id, conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, 'member', ?)"
        ).run(uuid(), dmId, m.id, earliest);
      }
      dm = { id: dmId };
    } else {
      // Do not deliver into the invisible half of an existing thread.
      await db.prepare(
        "UPDATE conversations SET created_at = LEAST(created_at, ?) WHERE id = ?"
      ).run(earliest, dm.id);
      await db.prepare(
        "UPDATE conversation_members SET joined_at = LEAST(joined_at, ?) WHERE conversation_id = ?"
      ).run(earliest, dm.id);
    }

    for (const m of personal) {
      await db.prepare("UPDATE messages SET conversation_id = ? WHERE id = ?").run(dm.id, m.id);
    }
    await db.prepare("UPDATE conversations SET updated_at = NOW() WHERE id = ?").run(dm.id);
    split++;
  }

  console.log(`\n${cleared} cleared . ${split} split . ${untouched} untouched`);
  if (!APPLY) console.log("\nNothing was changed. Re-run with --apply once the above reads right.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error("FAILED:", err); process.exit(1); });
