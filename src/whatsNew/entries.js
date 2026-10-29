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
    id: "place-search-google",
    version: "1.126.4",
    date: "2026-10-29",
    audience: ["family", "caregiver"],
    title: "Find places by name",
    body: "Address boxes now search Google Maps, so you can type a place's name instead of its street address. Pick it from the list and the full address fills in — on appointments, the place's name is kept too.",
    howTo: [
      "Start typing in any address or location box",
      "Type the name of the place, or the street",
      "Tap the right one in the list",
    ],
    examples: ["Mom's church", "CVS on Main Street", "Dr. Patel's office"],
    preview: "placeSearch",
  },
  {
    id: "mileage-family",
    version: "1.126.1",
    date: "2026-10-29",
    audience: ["family"],
    title: "Cover the gas for errands",
    body: "Turn on mileage and caregivers can log the trips they drive for your loved one during a visit. The app works out the miles from where they went, pays your rate up to a cap you set, and asks you before paying anything past it.",
    howTo: [
      "Open Care Team and tap Mileage (care team leader)",
      "Turn it on, pick a rate (50¢ a mile is a good start) and the most miles per visit",
      "After a visit, open it to see each trip and its note",
      "Miles past your cap wait for you: tap Approve or Don't pay",
    ],
    examples: ["Picked up Mom's prescription", "Drove Dad to his checkup, then groceries"],
    preview: "mileageFamily",
  },
  {
    id: "mileage-caregiver",
    version: "1.126.1",
    date: "2026-10-29",
    audience: ["caregiver"],
    title: "Get paid for errand miles",
    body: "When a family turns mileage on, you can log the trips you drive for them during a visit. Search for where you went and the app works out the miles. It's paid to you in full, and InPlace takes no fee on it.",
    howTo: [
      "During the visit, tap + Log a trip on the visit card",
      "Search for where you went (CVS, Kroger, a doctor's office)",
      "Pick round trip or one way, and add a few words about what it was for",
      "Check out as usual — your mileage shows before you finish",
    ],
    examples: ["CVS and back for a prescription", "Library book drop"],
    preview: "mileageCaregiver",
  },
  {
    id: "coming-up-spine",
    version: "1.126.0",
    date: "2026-10-28",
    audience: ["family"],
    title: "Tomorrow, on one line",
    body: "Everything in the next 24 hours now sits on one card on Home, in time order, joined by a line. The green line is the caregiver's visit, so you can see at a glance which appointments happen while she's there and which don't.",
    howTo: [
      "Open Home — the Coming up card is at the top",
      "Read down the line: the visit, then each appointment at its time",
      "Anything after the visit ends hangs off a dashed line, marked “Not during Jane's visit”",
      "Tap any row to open that visit or appointment",
    ],
    examples: ["Haircut at 9:30 while Jane is there", "Lunch at church at 11:30", "Dentist at 6 after Jane leaves"],
    preview: "comingUpSpine",
  },
  {
    id: "cancel-one-or-series",
    version: "1.125.2",
    date: "2026-10-28",
    audience: ["family", "caregiver"],
    title: "Cancel one visit, or the rest of the series",
    body: "When a visit is part of a repeating series, cancelling it now asks whether you mean just that day or that day and every visit after it. And when a caregiver cancels one day, Home says so — “Jane cancelled this day only — the rest of the series is still with Jane.”",
    howTo: [
      "Open the visit and tap Cancel visit",
      "Pick “Just Mon Nov 3” or “Mon Nov 3 and the 5 after it”",
      "Tap Cancel — the other person is told exactly which days",
    ],
    examples: ["We're away the week of Thanksgiving", "Mom is moving in with us — stop the Tuesday visits"],
    preview: "cancelOneOrSeries",
  },
  {
    id: "change-visit-day",
    version: "1.124.0",
    date: "2026-10-19",
    audience: ["family", "caregiver"],
    title: "Move a booked visit to another day",
    body: "Either side can now ask to move a confirmed visit to a different day, not just a different time — and the other person accepts or declines it in the app. Change visit is on every visit's details now, including your loved one's page and the Schedule.",
    howTo: [
      "Open the visit and tap Change visit",
      "Pick the new day, start time and length — the sheet shows what will change",
      "Tap Send — nothing moves until the other person accepts",
      "They'll see it under Needs you on Home; you'll see “Waiting on …” until they answer",
    ],
    examples: ["Can we do next Saturday instead?", "Move Thursday's visit to Friday at 10"],
    preview: "changeVisitDay",
  },
  {
    id: "time-change-in-words",
    version: "1.123.0",
    date: "2026-10-19",
    audience: ["family", "caregiver"],
    title: "Time changes say what's actually changing",
    body: "When someone asks to change a visit, the notice, the Needs you card and the review now say what moves — “End at 3:30 PM instead of 5:00 PM” — and which day, instead of just the start time. Asking for a change? Every half hour is on the list now, with the end time beside it.",
    howTo: [
      "Look under Needs you on Home — the card names the day and what moves",
      "Tap Open to see the old and new visit side by side, the changed part in purple",
      "Proposing a change? Pick the length and check the “ends at” time next to it",
    ],
    examples: ["Jane needs to leave at 3:30 on Thursday", "Can we start an hour later tomorrow?"],
    preview: "timeChangeWords",
  },
  {
    id: "loved-one-page",
    version: "1.121.0",
    date: "2026-10-15",
    audience: ["family"],
    title: "Your loved one's page, in one scroll",
    body: "Everything about the person you care for is on one page now, in the order you'd look for it: who they are, what's left to do today, notes, visits, then money and legal. The bar at the top follows you down the page — tap a word to jump there.",
    howTo: [
      "Open My Loved One and tap To do, Notes, Calendar or Money & legal in the bar",
      "Check off today's tasks right there — Now, Later today, Next visit",
      "Notes show what's new since you last looked; tap Review all for the rest",
      "Reimbursements live under Money & legal now",
    ],
    examples: ["Did Mom take the morning pills?", "Water the kitchen plant at the next visit", "Who's with Mom tomorrow?"],
    preview: "lovedOnePage",
    action: { label: "Show me", page: "care-profile" },
  },
  {
    id: "reimbursement-pay-reminders",
    version: "1.120.1",
    date: "2026-10-15",
    audience: ["family"],
    title: "Reimbursements remind you until they're paid",
    body: "Approving a reimbursement doesn't move the money — paying it does. If you're the one who pays, an approved request now stays under Needs you until it's paid, and InPlace reminds you every couple of days, including the monthly ones.",
    howTo: [
      "Look for “Pay $… to …” under Needs you on Home",
      "Tap Pay — it opens the request with its Pay button",
      "Paying by check or cash? Mark it paid there once it's sent",
    ],
    examples: ["The monthly internet bill for Mom's house", "Sam's pharmacy run, approved last week"],
    preview: "toPay",
    action: { label: "Show me", page: "care-profile", focus: "lovedOne:money" },
  },
  {
    id: "reimbursement-check-arrived",
    version: "1.120.0",
    date: "2026-10-15",
    audience: ["family"],
    title: "Paid by check or cash? Say when it arrives",
    body: "A check or cash payment never marks itself paid, so approved reimbursements could sit at “awaiting payment” long after the money was deposited. Now the approver says how they'll pay, the person being paid can tap “I got it”, and InPlace asks both of you if it's still open after a few days.",
    howTo: [
      "Approving? Pick how you'll pay — check, cash, Venmo, or in the app",
      "Being paid? Open the request under Money & legal on your loved one's page and tap “I got it”",
      "Or answer “Did the check arrive?” under Needs you on Home",
    ],
    examples: ["Sam wrote me a check for the groceries", "Paid Jane back in cash for the pharmacy run"],
    preview: "checkArrived",
    action: { label: "Show me", page: "care-profile", focus: "lovedOne:money" },
  },
  {
    id: "quiet-hours-what-happened",
    version: "1.120.0",
    date: "2026-10-15",
    audience: ["family", "caregiver"],
    title: "“While you were away” now says what happened",
    body: "If you use quiet hours, the morning summary used to say only how many updates came in. Now it names them, and Activity lists each one so you can open it — the summary no longer disappears when you tap it.",
    howTo: [
      "After quiet hours end, read the summary notification — it names what came in",
      "Tap it: one update opens straight to that item",
      "More than one? Find them listed under “While you were away” in Activity on Home",
    ],
    examples: ["Jane checked in at 6:41", "A message from Sam overnight"],
    preview: "whileAway",
  },
  {
    id: "card-declined-try-again",
    version: "1.117.0",
    date: "2026-10-14",
    audience: ["family"],
    title: "A declined card now tells you — and can be tried again",
    body: "About a day before each visit, InPlace places a hold on the card. If the bank declines it, the person who pays and the person who booked now get a notice right away, and one tap tries the same card again once the money's there — or you can use a different card.",
    howTo: [
      "Watch for “Card declined” in your notifications or under Needs you on Home",
      "Move money onto the card or call the bank, if that's the problem",
      "Tap “Try the card again” — or “Use a different card”",
    ],
    examples: ["Moved money into checking — try the debit card again", "The card expired — add the new one"],
    preview: "cardDeclined",
  },
  {
    id: "calendar-whole-month",
    version: "1.114.3",
    date: "2026-10-13",
    audience: ["family", "caregiver"],
    title: "The calendar shows every visit again",
    body: "For families with a lot of visit history, Schedule had been stopping partway through the month — later visits and repeating visits were booked but didn't show. Every month now shows all of its visits, and a caregiver can no longer accept two visits at the same time by mistake.",
    howTo: [
      "Open Schedule and tap Next → to look ahead",
      "Tap a day to see who's coming and when",
      "Caregivers: if two requests overlap, the app tells you which visit is in the way",
    ],
    examples: ["Mom's Tuesday visits through December", "Two requests sent for the same Saturday morning"],
    preview: "calendarWhole",
  },
  {
    id: "todos-folded-bar",
    version: "1.113.1",
    date: "2026-10-13",
    audience: ["family", "caregiver"],
    title: "A folded to-do list still gets noticed",
    body: "Fold the to-do list away and, while something's waiting, it shows as a light-blue bar with the count — so “Water the kitchen plant” doesn't get forgotten.",
    howTo: [
      "Tap the to-do heading to fold or unfold it",
      "Look for “To-do list · 3 items” — tap it to open",
    ],
    examples: ["Water the kitchen plant", "Change the litter next time"],
    preview: "foldedBar",
  },
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
