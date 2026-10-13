/**
 * What's New — the registry (v1.112.4).
 *
 * Pete, 10/13: "can we do a 'what's new' splash screen on the app for recent changes? this should
 * be part of the future rollouts too when we have new features (like the 'to do' list). I would
 * want it to have a quick screenshot of what's new and how to use it."
 *
 * RULE (CLAUDE.md, Dev Rule 10): a release that changes what a user can SEE or DO adds an entry
 * here in the same commit. Fixes nobody would notice do not. tests/unit/whatsNewEntries.test.js
 * checks the shape, and that every `preview` names a picture the client can draw.
 *
 * Fields
 *   id        stable, unique, never reused — it is how "seen" is reasoned about in logs
 *   version   the APP_VERSION that shipped it
 *   date      ISO date it reached production. A person sees an entry once, only if it is no
 *             older than their account and no older than WINDOW_DAYS — so a brand-new user is
 *             not greeted with a month of history. Newest first in this array.
 *   audience  roles that see it: family | caregiver | care_for | helper
 *   when      optional (ctx) => boolean, for entries that only apply to some people
 *             (ctx = { careAccess })
 *   title     one line
 *   body      what it is, two sentences at most
 *   howTo     2–4 short steps, each a thing to tap or type
 *   examples  optional — the kind of thing you'd use it for, in the person's words
 *   preview   key of the little picture the client draws (public/js/components/WhatsNew.js,
 *             PREVIEWS). Drawn from the app's own styles with made-up content, not a PNG, so it
 *             never shows a real person's data and never goes stale against a redesign.
 *   action    optional { label, page } — "Show me" takes them there
 */
const WINDOW_DAYS = 45;

const ENTRIES = [
  {
    id: "todos-on-arrival",
    version: "1.112.4",
    date: "2026-10-13",
    audience: ["family"],
    title: "To-dos find you at the house",
    body: "When you open InPlace at your loved one's house, the “Looks like you're with…” card now shows what's waiting, right next to Log this visit. Your phone decides you're there — your location isn't sent anywhere.",
    howTo: [
      "Turn on the at-the-house card from Home (once, if you haven't)",
      "When you get there, open InPlace",
      "Tap “I did this” on each to-do, then log the visit if you like",
    ],
    examples: ["Water the kitchen plant", "Change the litter next time"],
    preview: "arrival",
  },
  {
    id: "task-hand-off",
    version: "1.112.4",
    date: "2026-10-13",
    audience: ["family"],
    title: "Can't get to a task? Hand it off",
    body: "Open any of today's care tasks and, under Done and Skip, hand just this one to someone else on the team. They're told, and it goes back to the usual person tomorrow.",
    howTo: [
      "Tap a task on Home",
      "Under “Not done yet? Hand it to…”, pick a name",
      "Tap “Hand this task to …”",
    ],
    examples: ["Evening meds — Jane's there tonight", "Pick up the prescription"],
    preview: "handoff",
  },
  {
    id: "todos-next-visit",
    version: "1.112.3",
    date: "2026-10-13",
    audience: ["family"],
    title: "To-dos for the next visit",
    body: "Some things don't have a time — they just need doing by whoever is there next. Add them once; anyone on the team, or the caregiver on today's visit, checks them off.",
    howTo: [
      "Open My Loved One and find “To-dos for the next visit”",
      "Tap “+ Add to-do” and say what needs doing — no time, no owner",
      "Whoever does it taps “I did this” — you'll see who and when",
      "Tap the heading to fold the list away",
    ],
    examples: ["Water the kitchen plant", "Change the litter next time", "Lock the stove against the wall"],
    preview: "todos",
    action: { label: "Open My Loved One", page: "care-profile" },
  },
  {
    id: "todos-caregiver",
    version: "1.112.3",
    date: "2026-10-13",
    audience: ["caregiver"],
    title: "To-dos left for your visit",
    body: "The family can leave one-time jobs for whoever comes next. They show on your check-in screen, before you start.",
    howTo: [
      "Check in as usual — look for “To-dos for this visit”",
      "Do it, then tap “I did this” — add a note if it helps",
    ],
    examples: ["Water the kitchen plant", "Change the litter next time"],
    preview: "todos",
  },
  {
    id: "documents-center",
    version: "1.110.0",
    date: "2026-10-12",
    audience: ["family"],
    title: "Documents Center",
    body: "Keep medical records and legal papers for your loved one in one locked place. Only the care team sees them — never caregivers — and opening a record takes your passkey.",
    howTo: [
      "Open My Loved One, then tap “Documents Center”",
      "Upload a visit summary, med list or POA",
      "Turn on the iPAi key if you want help spotting med changes to review",
    ],
    preview: "documents",
    action: { label: "Open Documents Center", page: "documents-center" },
  },
  {
    id: "legal-readiness",
    version: "1.110.0",
    date: "2026-10-12",
    audience: ["family"],
    title: "Legal & money readiness",
    body: "A short checklist of the papers that matter when a parent needs help — durable power of attorney, healthcare directive and more — with who holds each one.",
    howTo: [
      "Find the card on My Loved One",
      "Mark what's in place and pick who the agent is",
      "Missing something? It lists local elder-law help to call",
    ],
    preview: "readiness",
    action: { label: "Open My Loved One", page: "care-profile" },
  },
  {
    id: "task-notices-settle",
    version: "1.112.2",
    date: "2026-10-13",
    audience: ["family"],
    title: "Checked-off tasks clear themselves",
    body: "If a “care task not checked off” alert went out and someone checks it off later, the alert updates to say who did it and when — nothing left for you to chase.",
    howTo: ["Nothing to do — it happens on its own"],
    preview: "notice",
  },
  {
    id: "id-verification",
    version: "1.112.0",
    date: "2026-10-12",
    audience: ["family", "caregiver", "care_for", "helper"],
    // Only for people still inside their grace period — a verified person has nothing to do.
    when: (ctx) => !!(ctx.careAccess && ctx.careAccess.status === "grace"),
    title: "Verify your ID to keep access",
    body: "Everyone on a care team now verifies their ID before seeing anyone's care. It keeps a stranger from ever landing on your family's information.",
    howTo: [
      "Open My Account",
      "Upload a photo of your driver's license or passport",
      "Or ask your team leader to mark you verified in person",
    ],
    preview: "id",
    action: { label: "Open My Account", page: "account" },
  },
];

/**
 * What this person has not seen yet.
 *
 * "Seen" is per entry (users.whats_new_seen, a JSON array of ids), not a timestamp: two entries
 * can ship the same day, hours apart, and closing the first must not swallow the second.
 * @param {{roles:string[], createdAt:(Date|string|null), seenIds:string[], careAccess?:object, now?:Date}} p
 */
function entriesFor({ roles, createdAt, seenIds = [], careAccess = null, now = new Date() }) {
  const roleSet = new Set(roles || []);
  const seen = new Set(seenIds || []);
  const windowStart = now.getTime() - WINDOW_DAYS * 86400000;
  // Compared by calendar day: an entry dated the day the account was made is still news to them.
  const createdDay = createdAt ? new Date(createdAt).toISOString().slice(0, 10) : "0000-00-00";
  return ENTRIES.filter((e) => {
    if (seen.has(e.id)) return false;
    if (new Date(e.date + "T23:59:59Z").getTime() < windowStart) return false;
    if (e.date < createdDay) return false;
    if (!e.audience.some((r) => roleSet.has(r))) return false;
    if (e.when && !e.when({ careAccess })) return false;
    return true;
  });
}

/** The JSON the client gets — no functions. */
function publicEntry(e) {
  const { when, ...rest } = e; // eslint-disable-line no-unused-vars
  return rest;
}

module.exports = { ENTRIES, WINDOW_DAYS, entriesFor, publicEntry };
