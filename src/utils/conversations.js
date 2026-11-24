// ─── Direct conversations: personal vs system ───
//
// v1.105.102. Pete started a message thread with Julia and it showed him to her as
// "InPlace support" (feedback 7972ed90) — a family member appearing to a caregiver as the
// platform itself.
//
// The cause: seven places asked the same question — "is there already a direct conversation
// containing these two users?" — with a query that matched ANY direct conversation. Pete is
// an admin, so a thread named "InPlace Support" between him and Julia already existed
// (admin/safety.js creates it). Every one of those lookups found it, and his personal
// messages went into the platform's thread.
//
// The distinction the code needs: **a personal direct conversation has no name.** It is
// titled by whoever the other person is. A NAMED direct conversation is a system thread —
// "InPlace Support", "iPAi", "Kindred (…)" — and those are a different conversation even
// though they hold the same two user rows. A support thread is the platform speaking; a DM
// is a person speaking. Merging them is not a label bug: Julia could not tell who she was
// talking to, and safety.js refuses to let anyone block "InPlace Support", so the merged
// thread was also unblockable.
//
// Keeping the rule as "name IS NULL" rather than a list of known system names means a new
// system thread added later is correctly excluded the moment it is given a name, instead of
// silently colliding until someone reports it.

const PERSONAL_DIRECT_WHERE = "c.type = 'direct' AND c.name IS NULL";

// Names that mean "this thread is the platform, not a person."
const SYSTEM_DIRECT_NAMES = ["InPlace Support", "iPAi"];

// Returns the personal DM between two users, or undefined. Never returns a system thread.
async function findPersonalDirectConversation(db, userA, userB) {
  return db.prepare(`
    SELECT c.id FROM conversations c
    JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
    JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
    WHERE ${PERSONAL_DIRECT_WHERE}
    LIMIT 1
  `).get(userA, userB);
}

module.exports = { PERSONAL_DIRECT_WHERE, SYSTEM_DIRECT_NAMES, findPersonalDirectConversation };
