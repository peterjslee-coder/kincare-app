// ─── The onboarding route (v1.105.114) ───
//
// A caregiver told us signing up feels like a quest. A quest is: you cannot see the route,
// new obstacles appear as you go, you have to remember where you left off, and when you think
// you have arrived someone tells you that you have not. A path is the opposite — the only
// thing that changes is how much is behind you.
//
// See Onboarding_Path_Plan_2026-08-19.md (the feel) and Onboarding_Path_Spec_2026-08-20.md
// (this build). Four properties, and an implementation that drops any of them is not faithful:
//
//   1. You can see the end from the beginning.
//   2. Finished steps shrink, they do not vanish.
//   3. Exactly one step is open at a time.
//   4. Nothing new appears after you start.
//
// ─── SCREENS ARE NOT ROUTE ITEMS ───
//
// This is the decision the whole file exists to hold, and the one meant to survive the next
// redesign. Onboarding has been rebuilt at least twice; each rebuild fixed the screen in front
// of it and the feeling came back.
//
// Before this file there were 16 things on screen: a 9-step wizard and a 7-item dashboard
// checklist. But step 9 is a review screen, not a job; identity is submitted in the wizard and
// reported on the dashboard; and the safety check takes its details in the wizard and its fee
// and form on the dashboard. 16 listed, 13 real.
//
// So: ONE route of 13 items, defined here, rendered by both surfaces. A screen is how we
// collect something. A route item is a job she has to get done. The wizard may spend four
// screens on one item, and the number she sees never moves except when a job is finished.
//
// The consequence, which is the point: the next person who adds an onboarding screen has to
// say which route item it belongs to. If it is genuinely new work it joins this array — and
// therefore appears at the BEGINNING, where she can see it, instead of ambushing her at the
// end. Property 4 enforced by construction rather than by discipline.
//
// ─── WHERE AN ITEM LIVES ───
//
// An item is sited where SHE DOES THE WORK, not where the answer finally lands. She photographs
// her licence in the wizard, so it is a wizard item even though approval arrives days later;
// she pays for and fills in the background check on the dashboard, so it is a dashboard item
// even though the wizard collected the legal name and SSN-4 it needs. The `waiting` state,
// below, carries the "and then it sits with us" part.
//
// ─── FOUR STATES, NOT TWO ───
//
//   done     finished
//   todo     hers to do
//   unknown  we have not asked the server yet   (v1.105.112, and the rule this file inherits:
//            an unknown answer must NEVER render as a negative one)
//   waiting  she is finished; we are not
//
// `waiting` is not decoration. Since v1.105.112 no caregiver finishes onboarding until a human
// looks at her ID. If that drew as an unticked to-do, every signup would end by telling her she
// had failed to do the thing she just did — which is the original complaint, arriving through a
// different door. It is the normal case now, not an edge case.
//
// This file is PURE: no fetches, no JSX, no React. It is handed facts and returns states, so it
// can be tested by running it rather than by reading it.

const ONBOARDING_LEGS = window.ONBOARDING_LEGS = [
  { id: 'who', n: 1, name: 'Who you are', surface: 'wizard' },
  { id: 'bring', n: 2, name: 'What you bring', surface: 'wizard' },
  { id: 'work', n: 3, name: 'How you work', surface: 'hub' },
];

// Order is the order she MEETS them, not the order that reads tidiest. `wizardStep` is the
// screen that collects it (null for dashboard items). `needs` is a hard dependency — the
// safety check genuinely cannot start before Stripe, which today surfaces as "Complete Stripe
// setup first" printed on an item she is being told to do. A path has an order, so on a path
// that stops being a contradiction and starts being the shape.
const ONBOARDING_ROUTE = window.ONBOARDING_ROUTE = [
  { id: 'account', leg: 'who', wizardStep: 1, label: 'Create your account' },
  { id: 'paperwork', leg: 'who', wizardStep: 2, label: 'The paperwork' },
  { id: 'about-you', leg: 'who', wizardStep: 3, label: 'About you' },

  { id: 'certifications', leg: 'bring', wizardStep: 5, label: 'Certifications' },
  { id: 'training', leg: 'bring', wizardStep: 6, label: 'Your training programme' },
  { id: 'documents', leg: 'bring', wizardStep: 7, label: 'Documents' },
  // Submitted at wizard step 8; resolves on the dashboard, possibly days later.
  { id: 'identity', leg: 'bring', wizardStep: 8, label: 'A photo of your licence', canWait: true },

  { id: 'stripe', leg: 'work', wizardStep: null, label: 'Where your pay lands' },
  // Wizard step 4 collects the legal name / SSN-4 / DOB this needs. That screen belongs to
  // THIS item — it is not a second entry, which is how the old list counted it twice.
  { id: 'background-check', leg: 'work', wizardStep: null, label: 'The safety check',
    needs: ['stripe'], canWait: true },
  { id: 'preferences', leg: 'work', wizardStep: null, label: "What you're happy doing" },
  { id: 'avail-rates', leg: 'work', wizardStep: null, label: "When you're free, and your rate" },
  { id: 'photo', leg: 'work', wizardStep: null, label: 'Add a photo so families can see you' },
  { id: 'security', leg: 'work', wizardStep: null, label: 'Lock down your account' },
];

// The length is a constant, and a test asserts it. If this number changes, the route changed
// under someone mid-signup — which is the quest, by definition.
const ONBOARDING_ROUTE_LENGTH = window.ONBOARDING_ROUTE_LENGTH = 13;

// ─── State resolvers ───
//
// One per item, all pure, all reading the same `facts` bag the surfaces already compute. Any
// resolver may return 'unknown', and every one that depends on a fetch MUST: `stripeStatus`
// starts null and `idVerification.loaded` starts false, and neither null nor false means "no".

const routeItemState = window.routeItemState = (id, facts = {}) => {
  const f = facts || {};
  switch (id) {
    // ── Wizard items ──
    // On the dashboard she has a profile, so these are done by definition. Inside the wizard
    // they are decided by how far she has walked.
    case 'account':
    case 'paperwork':
    case 'about-you':
    case 'certifications':
    case 'training':
    case 'documents': {
      if (f.surface !== 'wizard') return f.profileCreated ? 'done' : 'todo';
      const item = ONBOARDING_ROUTE.find((i) => i.id === id);
      return (f.step || 1) > item.wizardStep ? 'done' : 'todo';
    }

    // ── Identity ──
    // The order of these branches is the whole v1.105.112 lesson: ask "do we know?" BEFORE
    // asking "is it approved?", because `approved` is false while we are still finding out.
    case 'identity': {
      const idf = f.identity || {};
      if (f.surface === 'wizard' && !idf.submitted) {
        return (f.step || 1) > 8 ? 'waiting' : 'todo';
      }
      if (!idf.loaded || idf.loadFailed) return 'unknown';
      if (idf.approved) return 'done';
      if (idf.status === 'rejected') return 'todo';
      if (idf.submitted) return 'waiting';
      return 'todo';
    }

    // ── Stripe ──
    // `status === null` is "not asked yet" (v1.105.75). It rendered as "not connected" once,
    // and told caregivers who were already paid to go and connect a bank account.
    case 'stripe': {
      const s = f.stripe || {};
      if (s.override || s.connected) return 'done';
      if (s.status === null || s.status === undefined) return 'unknown';
      return 'todo';
    }

    // ── The safety check ──
    // An admin vouch or a completed check satisfies it. Submitted-and-processing is `waiting`:
    // Checkr takes 2–5 days and there is nothing for her to do in them. 'consider' and
    // 'disputed' are the exceptions — those need her, so they are `todo`.
    case 'background-check': {
      const b = f.backgroundCheck || {};
      if (b.override || b.passed) return 'done';
      if (b.submitted) {
        return (b.checkrStatus === 'consider' || b.checkrStatus === 'disputed') ? 'todo' : 'waiting';
      }
      return 'todo';
    }

    case 'preferences': return f.hasPreferences ? 'done' : 'todo';
    case 'avail-rates': return (f.hasAvailability && f.hasRates) ? 'done' : 'todo';
    case 'photo': return f.hasPhoto ? 'done' : 'todo';
    case 'security': return f.securityReviewed ? 'done' : 'todo';

    default: return 'todo';
  }
};

// ─── The whole route, resolved ───
//
// Returns everything a surface needs to draw a path and nothing it needs to decide. `remaining`
// counts ONLY what is hers — an item sitting with us is not work she has left, and counting it
// as such is how "when does this ever end?" gets its answer wrong.
const resolveRoute = window.resolveRoute = (facts = {}) => {
  const f = facts || {};
  const items = ONBOARDING_ROUTE.map((item) => {
    const state = routeItemState(item.id, f);
    // A dependency that is not yet met makes an item blocked, not undone. She is not being
    // lazy about the safety check; she cannot start it yet.
    const blockedBy = (item.needs || []).filter((dep) => routeItemState(dep, f) !== 'done');
    return Object.assign({}, item, {
      state,
      blocked: state === 'todo' && blockedBy.length > 0,
      blockedBy,
    });
  });

  const byLeg = ONBOARDING_LEGS.map((leg) => {
    const legItems = items.filter((i) => i.leg === leg.id);
    return Object.assign({}, leg, {
      items: legItems,
      done: legItems.filter((i) => i.state === 'done').length,
      total: legItems.length,
      complete: legItems.every((i) => i.state === 'done'),
    });
  });

  // Property 3: exactly one step open. The first thing that is actually hers and actually
  // startable — never something blocked, never something sitting with us, and never a row we
  // are still fetching the answer for.
  const current = items.find((i) => i.state === 'todo' && !i.blocked) || null;

  return {
    items,
    legs: byLeg,
    current,
    total: items.length,
    done: items.filter((i) => i.state === 'done').length,
    waiting: items.filter((i) => i.state === 'waiting').length,
    remaining: items.filter((i) => i.state === 'todo').length,
    // v1.105.82 — do not paint a count that is about to correct itself. Julia watched the
    // checklist flash on every page change because two of seven rows resolved after paint.
    resolved: items.every((i) => i.state !== 'unknown'),
  };
};
