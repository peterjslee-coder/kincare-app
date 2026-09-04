// ─── You are not told about things you may not open (v1.105.185) ───
//
// Pete: "either way, she should not get push notifications that lead her to dead ends. if her
// permissions are wrong, she shouldn't get pushs for things she's not allowed to view."
//
// He is right, and the reason this kept happening is that the rule lived in 78 separate call
// sites. Each fan-out decided for itself who to tell — notes checked READ_NOTES (v1.105.81),
// visits checked READ_VISITS (v1.105.153) — and every new one is a fresh chance to forget. A
// rule enforced in 78 places is a rule that holds until somebody adds a 79th.
//
// So it moves here, and sendPushToUser refuses. The per-route fan-outs stay: it is still better
// to never build a push for someone than to build one and drop it. This is the floor, not the
// plan — the thing that makes the floor impossible to fall through.
//
// SCOPE, deliberately narrow: only pushes that name a care recipient AND whose type maps to a
// capability below. Everything else — a message, a payment, a shift offer, an admin alert — is
// not about a care record and is unaffected. A type that is not in this table is not blocked;
// silently swallowing pushes we do not understand would be a much worse failure than the one
// being fixed.
const { CAP } = require("./capabilities");

const REQUIRED_CAPABILITY = Object.freeze({
  team_note: CAP.READ_NOTES,
  observation_attention: CAP.READ_NOTES,
  family_visit: CAP.READ_VISITS,
  care_task_due: CAP.READ_TASKS,
  care_task: CAP.READ_TASKS,
  care_event: CAP.READ_TASKS,
});

/**
 * May this person be TOLD about this?
 *
 * Returns { allowed, reason }. Anything it cannot make a confident judgement about is allowed:
 * an unknown type, a push with no care recipient, or a capability lookup that throws. Failing
 * open is right here — the cost of a wrong "allow" is a notification someone did not need, and
 * the cost of a wrong "deny" is silence about their mother.
 */
async function mayBeNotified(db, userId, data) {
  try {
    const type = data && data.type;
    const recipientId = data && data.careRecipientId;
    if (!type || !recipientId) return { allowed: true, reason: "not_record_scoped" };

    const cap = REQUIRED_CAPABILITY[type];
    if (!cap) return { allowed: true, reason: "type_not_gated" };

    const { recipientCapabilities } = require("./access");
    const { can } = require("./capabilities");
    const caps = await recipientCapabilities(db, recipientId, userId);
    if (can(caps, cap)) return { allowed: true, reason: "permitted" };
    return { allowed: false, reason: `missing_${cap}` };
  } catch {
    // A broken permission lookup must not silence a care notification.
    return { allowed: true, reason: "check_failed_open" };
  }
}

module.exports = { mayBeNotified, REQUIRED_CAPABILITY };
