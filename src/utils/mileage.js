// ─── Visit mileage (v1.126.1) ───
//
// Pete, 10/28: "give care families the option to track mileage incurred in the visit and offer
// a rate to pay the caretaker... the intent isn't to encourage road trips but to make sure
// cost/gas is covered." His decisions:
//   · errand miles only — driving FOR the loved one during the visit, never the commute;
//   · charged with the visit; the caregiver gets all of it, the family covers only the card fee
//     (InPlace keeps nothing — customer pass-through, out of the company P&L like a tip);
//   · the guardrail is a calculator: pick where you went, the app works out the miles.
//
// So the caregiver never sends a number of miles. She sends where she went; this module asks
// the maps provider (utils/maps.js) and stores what it answered. Distances come only from here.
//
// Money, in order:
//   1. lockForSession() at check-out/release: trips freeze; miles up to the family's per-visit
//      cap become `mileage_cents` (status 'owed'); miles past the cap become
//      `mileage_extra_cents` (extra status 'pending') and wait for the care team leader.
//   2. settleSession() once the VISIT is paid: a separate charge on the card that paid the visit,
//      destination = the caregiver, application fee = the card-fee gross-up only. Separate
//      rather than folded into the visit capture so that nothing about mileage can ever change
//      or fail the visit's own payment. Costs the family one extra 30¢ card fee per visit with
//      mileage. Poller 116 retries.
//   3. decideExtra(): the leader approves (charged the same way) or declines.
//
// Dev Rule 7: chargeMileage refuses demo sessions at the boundary, same as every other charge.

const { v4: uuid } = require("uuid");
const maps = require("./maps");
const { tipWithCardFee } = require("./pricing");
const { captureException } = require("./sentry");

const IRS_RATE_CENTS = 76;      // IRS business rate from Jul 1 2026 (72.5¢ Jan–Jun). Ceiling for a family's rate.
const MIN_RATE_CENTS = 10;
const DEFAULT_RATE_CENTS = 50;  // Pete: "50 cents a mile?" — covers gas and wear for most cars
const DEFAULT_CAP_MILES = 20;
const MAX_CAP_MILES = 200;
const MAX_STOPS = 5;
const MAX_TRIP_MILES = 150;     // one errand trip past this is a road trip, not an errand
const MAX_TRIPS_PER_VISIT = 12;
const NOTE_MAX = 200;
const MAX_ATTEMPTS = 5;
const MAX_HERE_FROM_HOME_MILES = 30; // road-factored; "Use my location" must be near the home
const RETRY_HOURS = 6;               // a declined card is retried after 6h, 12h, 18h, 24h

function clampRate(cents) {
  const n = Math.round(Number(cents));
  if (!Number.isFinite(n)) return null;
  if (n < MIN_RATE_CENTS || n > IRS_RATE_CENTS) return null;
  return n;
}
function clampCap(miles) {
  const n = Math.round(Number(miles) * 10) / 10;
  if (!Number.isFinite(n) || n < 1 || n > MAX_CAP_MILES) return null;
  return n;
}
const round1 = (n) => Math.round(Number(n || 0) * 10) / 10;
const centsFor = (miles, rateCents) => Math.round(round1(miles) * Number(rateCents || 0));

// ─── Settings ───

async function settingsFor(db, careRecipientId) {
  const r = await db.prepare(`
    SELECT id, first_name, family_user_id, mileage_enabled, mileage_rate_cents, mileage_cap_miles,
           mileage_updated_at, latitude, longitude
      FROM care_recipients WHERE id = ?
  `).get(careRecipientId);
  if (!r) return null;
  return {
    careRecipientId: r.id,
    enabled: !!Number(r.mileage_enabled),
    rateCents: clampRate(r.mileage_rate_cents) || DEFAULT_RATE_CENTS,
    capMiles: clampCap(r.mileage_cap_miles) || DEFAULT_CAP_MILES,
    updatedAt: r.mileage_updated_at || null,
    irsRateCents: IRS_RATE_CENTS,
    minRateCents: MIN_RATE_CENTS,
    _row: r,
  };
}

async function isLeaderOrOwner(db, careRecipientId, userId) {
  const cr = await db.prepare("SELECT id, family_user_id FROM care_recipients WHERE id = ?").get(careRecipientId);
  if (!cr || !userId) return false;
  if (cr.family_user_id === userId) return true;
  const m = await db.prepare(`
    SELECT 1 FROM care_team_members ctm JOIN care_teams ct ON ct.id = ctm.care_team_id
     WHERE ct.care_recipient_id = ? AND ctm.user_id = ? AND ctm.role = 'leader' LIMIT 1
  `).get(careRecipientId, userId);
  return !!m;
}

/** Who decides extra miles and gets told about them: the team leader(s), else the record owner. */
async function deciders(db, careRecipientId) {
  const rows = await db.prepare(`
    SELECT DISTINCT ctm.user_id FROM care_team_members ctm JOIN care_teams ct ON ct.id = ctm.care_team_id
     WHERE ct.care_recipient_id = ? AND ctm.role = 'leader'
  `).all(careRecipientId);
  if (rows.length) return rows.map((r) => r.user_id);
  const cr = await db.prepare("SELECT family_user_id FROM care_recipients WHERE id = ?").get(careRecipientId);
  return cr && cr.family_user_id ? [cr.family_user_id] : [];
}

async function saveSettings(db, careRecipientId, userId, body) {
  const enabled = body.enabled ? 1 : 0;
  const rate = body.rateCents == null ? DEFAULT_RATE_CENTS : clampRate(body.rateCents);
  if (rate == null) return { error: `The rate has to be between ${MIN_RATE_CENTS}¢ and ${IRS_RATE_CENTS}¢ a mile (the IRS rate).` };
  const cap = body.capMiles == null ? DEFAULT_CAP_MILES : clampCap(body.capMiles);
  if (cap == null) return { error: `The most miles per visit has to be between 1 and ${MAX_CAP_MILES}.` };
  await db.prepare(`
    UPDATE care_recipients SET mileage_enabled = ?, mileage_rate_cents = ?, mileage_cap_miles = ?,
           mileage_updated_by = ?, mileage_updated_at = NOW()
     WHERE id = ?
  `).run(enabled, rate, cap, userId, careRecipientId);
  return { settings: await settingsFor(db, careRecipientId) };
}

// ─── Trips ───

function cleanText(s, max) {
  return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
const r4 = (n) => Math.round(Number(n) * 10000) / 10000;

/**
 * Resolve a stop the client picked into { label, address, placeId, lat, lng }. A Google
 * suggestion arrives as a placeId and is looked up HERE — the client's coordinates for it are
 * ignored, so a stop cannot be moved by editing the request. An OSM/typed stop (no key yet, or
 * Google down) arrives with coordinates, which is the best that path can do.
 */
async function resolveStop(stop) {
  if (!stop || typeof stop !== "object") return null;
  const label = cleanText(stop.label || stop.name, 120);
  if (stop.placeId && maps.provider() === "google") {
    const d = await maps.googlePlaceDetails(stop.placeId, { sessionToken: stop.session });
    if (d) return { label: label || d.name || d.label, address: cleanText(d.label, 200), placeId: d.placeId, lat: d.lat, lng: d.lng };
    return null;
  }
  // Review (10/28): with Google on, a stop typed with bare coordinates could be labelled "CVS"
  // and measured to anywhere. Every stop must then be a place Google looked up.
  if (maps.provider() === "google") return null;
  if (maps.validLatLng(stop.lat, stop.lng)) {
    return { label: label || "Stop", address: cleanText(stop.address || stop.label, 200), placeId: null, lat: Number(stop.lat), lng: Number(stop.lng) };
  }
  return null;
}

/**
 * Work out a trip without saving it. `body`: { from: "home" | "here", here?: {lat,lng},
 * stops: [...], roundTrip }. Returns { trip } or { error }.
 */
async function quoteTrip(db, session, body) {
  const settings = await settingsFor(db, session.care_recipient_id);
  if (!settings || !settings.enabled) return { error: "Mileage isn't turned on for this visit." };
  const cr = settings._row;

  const fromKind = body.from === "here" ? "here" : "home";
  let start;
  if (fromKind === "home") {
    if (!maps.validLatLng(cr.latitude, cr.longitude)) {
      return { error: `We don't have ${cr.first_name || "the"} home on the map yet. Tap "Use my location" instead.`, code: "home_unmapped" };
    }
    start = { lat: Number(cr.latitude), lng: Number(cr.longitude), label: `${cr.first_name || "Their"}'s home` };
  } else {
    const h = body.here || {};
    if (!maps.validLatLng(h.lat, h.lng)) return { error: "We couldn't get your location. Try again, or start from the home.", code: "no_location" };
    // An errand starts near the home. A "here" far from it is a commute or a wrong fix.
    if (maps.validLatLng(cr.latitude, cr.longitude)
        && maps.estimateMiles([{ lat: Number(h.lat), lng: Number(h.lng) }, { lat: Number(cr.latitude), lng: Number(cr.longitude) }]) > MAX_HERE_FROM_HOME_MILES) {
      return { error: "Your location is a long way from the home. Start the trip from the home instead.", code: "here_too_far" };
    }
    start = { lat: Number(h.lat), lng: Number(h.lng), label: "Your location" };
  }

  const rawStops = Array.isArray(body.stops) ? body.stops.slice(0, MAX_STOPS + 1) : [];
  if (rawStops.length === 0) return { error: "Pick where you went." };
  if (rawStops.length > MAX_STOPS) return { error: `A trip can have up to ${MAX_STOPS} stops. Log the rest as another trip.` };
  const stops = [];
  for (const s of rawStops) {
    const r = await resolveStop(s);
    if (!r) return { error: "We couldn't find one of those places on the map. Pick it again from the list." };
    stops.push(r);
  }
  const roundTrip = body.roundTrip !== false;
  const points = [start, ...stops];
  if (roundTrip) points.push(start);

  const route = await maps.drivingMiles(points);
  if (!route) return { error: "We couldn't work out the distance right now. Try again in a minute." };
  if (route.miles > MAX_TRIP_MILES) {
    return { error: `That comes to ${route.miles} miles — more than an errand. Check the places, or ask the family to add it as a reimbursement.` };
  }
  return {
    trip: {
      startKind: fromKind,
      startLabel: start.label,
      stops: stops.map((s) => ({ label: s.label, address: s.address, placeId: s.placeId, lat: r4(s.lat), lng: r4(s.lng) })),
      roundTrip,
      miles: route.miles,
      minutes: route.minutes || null,
      source: route.source,
      rateCents: settings.rateCents,
      cents: centsFor(route.miles, settings.rateCents),
    },
  };
}

async function addTrip(db, session, caregiverUserId, body) {
  const note = cleanText(body.note, NOTE_MAX);
  if (note.length < 3) return { error: "Add a few words about what the trip was for." };
  const count = await db.prepare("SELECT COUNT(*)::int AS n FROM visit_trips WHERE session_id = ? AND deleted_at IS NULL").get(session.id);
  if (count && count.n >= MAX_TRIPS_PER_VISIT) return { error: "That's the most trips one visit can hold." };
  const q = await quoteTrip(db, session, body);
  if (q.error) return q;
  const t = q.trip;
  const id = uuid();
  await db.prepare(`
    INSERT INTO visit_trips (id, session_id, care_recipient_id, caregiver_user_id, start_kind, start_label,
                             stops, round_trip, miles, minutes, distance_source, note, rate_cents)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, session.id, session.care_recipient_id, caregiverUserId, t.startKind, t.startLabel,
    JSON.stringify(t.stops), t.roundTrip ? 1 : 0, t.miles, t.minutes, t.source, note, t.rateCents);
  return { trip: { id, ...t, note } };
}

function tripView(row) {
  let stops = [];
  try { stops = JSON.parse(row.stops || "[]"); } catch { stops = []; }
  return {
    id: row.id,
    startKind: row.start_kind,
    startLabel: row.start_label,
    // Stop coordinates stay on the server. The family's "open in Google Maps" link uses names.
    stops: stops.map((s) => ({ label: s.label, address: s.address })),
    roundTrip: !!Number(row.round_trip),
    miles: round1(row.miles),
    minutes: row.minutes,
    source: row.distance_source,
    note: row.note,
    rateCents: row.rate_cents,
    cents: centsFor(row.miles, row.rate_cents),
    createdAt: row.created_at,
  };
}

/** Split total miles at the cap. Pure. */
function splitAtCap(totalMiles, capMiles, rateCents) {
  const total = round1(totalMiles);
  const paid = round1(Math.min(total, capMiles));
  const extra = round1(Math.max(0, total - paid));
  return { totalMiles: total, paidMiles: paid, extraMiles: extra, cents: centsFor(paid, rateCents), extraCents: centsFor(extra, rateCents) };
}

/** Everything a screen needs about one visit's mileage. */
async function sessionSummary(db, session) {
  const settings = await settingsFor(db, session.care_recipient_id);
  const rows = await db.prepare(`
    SELECT * FROM visit_trips WHERE session_id = ? AND deleted_at IS NULL ORDER BY created_at
  `).all(session.id);
  const trips = rows.map(tripView);
  const locked = !!session.mileage_locked_at;
  // Before check-out the rate and cap are the family's current ones; after, the frozen ones.
  const rateCents = locked ? (session.mileage_rate_cents || settings?.rateCents) : (settings?.rateCents || DEFAULT_RATE_CENTS);
  const capMiles = locked && session.mileage_cap_miles ? Number(session.mileage_cap_miles) : (settings?.capMiles || DEFAULT_CAP_MILES);
  const live = splitAtCap(trips.reduce((a, t) => a + t.miles, 0), capMiles, rateCents);
  const split = locked ? {
    totalMiles: round1(session.mileage_total_miles), paidMiles: round1(session.mileage_paid_miles),
    extraMiles: round1(session.mileage_extra_miles), cents: session.mileage_cents || 0,
    extraCents: session.mileage_extra_cents || 0,
  } : live;
  return {
    enabled: !!(settings && settings.enabled) || trips.length > 0,
    rateCents, capMiles, irsRateCents: IRS_RATE_CENTS,
    provider: maps.provider(),
    trips, ...split, locked,
    status: session.mileage_status || null,
    feeCents: session.mileage_fee_cents || null,
    extraStatus: session.mileage_extra_status || null,
    extraFeeCents: session.mileage_extra_fee_cents || null,
    estimated: trips.some((t) => t.source === "estimate"),
  };
}

// ─── Locking and charging ───

/**
 * Freeze the visit's mileage at check-out / release. Idempotent: a second call is a no-op.
 * `testMode` (admin impersonating) locks but waives, like the visit's own pay.
 */
async function lockForSession(db, sessionId, { testMode = false } = {}) {
  const session = await db.prepare("SELECT * FROM care_sessions WHERE id = ?").get(sessionId);
  if (!session || session.mileage_locked_at) return null;
  const rows = await db.prepare(`
    SELECT miles, rate_cents FROM visit_trips WHERE session_id = ? AND deleted_at IS NULL
  `).all(sessionId);
  if (rows.length === 0) return null; // nothing logged: leave every column NULL
  const settings = await settingsFor(db, session.care_recipient_id);
  // The rate is the family's at check-out, not whatever each trip was quoted at — one rate per
  // visit is what the family agreed to and what the screens show.
  const rateCents = settings ? settings.rateCents : DEFAULT_RATE_CENTS;
  const capMiles = settings ? settings.capMiles : DEFAULT_CAP_MILES;
  const split = splitAtCap(rows.reduce((a, r) => a + Number(r.miles || 0), 0), capMiles, rateCents);
  const status = testMode ? "waived" : split.cents > 0 ? "owed" : "none";
  const extraStatus = split.extraCents > 0 ? (testMode ? "waived" : "pending") : null;
  const res = await db.prepare(`
    UPDATE care_sessions SET mileage_locked_at = NOW(), mileage_total_miles = ?, mileage_paid_miles = ?,
           mileage_extra_miles = ?, mileage_rate_cents = ?, mileage_cents = ?, mileage_status = ?,
           mileage_extra_cents = ?, mileage_extra_status = ?, mileage_cap_miles = ?
     WHERE id = ? AND mileage_locked_at IS NULL
  `).run(split.totalMiles, split.paidMiles, split.extraMiles, rateCents, split.cents, status,
    split.extraCents || null, extraStatus, capMiles, sessionId);
  if (res && res.changes === 0) return null;
  if (extraStatus === "pending") await notifyExtraPending(db, session, split).catch((e) =>
    captureException(e, { where: "mileage: notify extra pending", sessionId }));
  return { ...split, status, extraStatus };
}

async function notifyExtraPending(db, session, split) {
  const { sendPushToUser } = require("../routes/push");
  const who = await deciders(db, session.care_recipient_id);
  for (const uid of who) {
    // No names, places or health detail on a lock screen (project rule: no PHI in pushes).
    await sendPushToUser(uid, {
      title: "Extra mileage to review",
      body: `${split.extraMiles} miles past your per-visit cap are waiting for your OK.`,
      data: { type: "mileage_extra", page: "dashboard", sessionId: session.id },
    }, "mileage_extra").catch(() => {});
  }
}

/**
 * One mileage charge on the card that paid the visit. `which` = "paid" | "extra".
 * Returns { charged, id } | { skipped } | { error }.
 */
async function chargeMileage(db, sessionId, which) {
  const { isDemoSession, getStripe } = require("../routes/accountability");
  if (await isDemoSession(db, sessionId)) return { skipped: "demo_session_blocked" };
  const s = await db.prepare(`
    SELECT cs.*, cp.stripe_account_id FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cp.id = cs.caregiver_id
     WHERE cs.id = ?
  `).get(sessionId);
  if (!s) return { error: "no session" };
  const isExtra = which === "extra";
  const cents = isExtra ? s.mileage_extra_cents : s.mileage_cents;
  const statusCol = isExtra ? "mileage_extra_status" : "mileage_status";
  const piCol = isExtra ? "mileage_extra_pi" : "mileage_pi";
  const feeCol = isExtra ? "mileage_extra_fee_cents" : "mileage_fee_cents";
  const owedStatus = isExtra ? "approved" : "owed";
  if (s[statusCol] !== owedStatus) return { skipped: `status ${s[statusCol]}` };
  if (s.payment_status !== "paid") return { skipped: "visit not paid yet" };

  const q = tipWithCardFee(cents);
  if (q.totalCents < 50) {
    // Below Stripe's minimum charge. Said so rather than silently dropped.
    await db.prepare(`UPDATE care_sessions SET ${statusCol} = 'below_minimum' WHERE id = ?`).run(sessionId);
    return { skipped: "below_minimum" };
  }
  // Review (10/28): each charge keeps its own retry state. A card DECLINE is a final answer
  // for that idempotency key (Stripe replays it for 24h), so a decline moves the key on and
  // waits RETRY_HOURS; anything else (timeout, 5xx) retries on the SAME key, which is what
  // makes a retry after "Stripe charged but we never heard" safe.
  const attemptsCol = isExtra ? "mileage_extra_attempts" : "mileage_attempts";
  const declinesCol = isExtra ? "mileage_extra_declines" : "mileage_declines";
  const nextCol = isExtra ? "mileage_extra_next_try_at" : "mileage_next_try_at";
  const declines = Number(s[declinesCol] || 0);
  const fail = async (msg, { declined = false } = {}) => {
    const attempts = Number(s[attemptsCol] || 0) + 1;
    await db.prepare(`
      UPDATE care_sessions SET ${attemptsCol} = ?, ${declinesCol} = ?, mileage_error = ?,
             ${nextCol} = ?
             ${attempts >= MAX_ATTEMPTS ? `, ${statusCol} = 'failed'` : ""}
       WHERE id = ?
    `).run(attempts, declines + (declined ? 1 : 0), String(msg).slice(0, 300),
      new Date(Date.now() + (declined ? RETRY_HOURS * attempts * 3600e3 : 4 * 60e3)).toISOString(), sessionId);
    captureException(new Error(`Mileage charge failed: ${msg}`), { where: `mileage: charge ${which}`, sessionId, attempts });
    return { error: msg };
  };
  if (!s.stripe_account_id) return fail("The caregiver can't receive payments yet");
  // Review (10/28): the card that PAID the visit. A visit paid by auto-pay after its hold
  // lapsed has a new PaymentIntent that care_sessions.stripe_payment_intent_id never learns
  // about; the ledger records the one that took the money.
  const paidRow = await db.prepare(`
    SELECT stripe_payment_intent FROM ledger_entries
     WHERE session_id = ? AND kind IN ('capture', 'autopay', 'checkout') AND status = 'succeeded'
       AND stripe_payment_intent IS NOT NULL
     ORDER BY created_at DESC LIMIT 1
  `).get(sessionId);
  const paidPi = (paidRow && paidRow.stripe_payment_intent) || s.stripe_payment_intent_id;
  if (!paidPi) return fail("No card on file for this visit");
  try {
    const stripe = getStripe();
    const paid = await stripe.paymentIntents.retrieve(paidPi);
    if (!paid || !paid.customer || !paid.payment_method) return fail("No card on file for this visit");
    const intent = await stripe.paymentIntents.create({
      amount: q.totalCents,
      currency: "usd",
      customer: paid.customer,
      payment_method: paid.payment_method,
      confirm: true,
      off_session: true,
      application_fee_amount: q.feeCents,
      transfer_data: { destination: s.stripe_account_id },
      metadata: {
        inplace_session_id: sessionId, type: isExtra ? "session_mileage_extra" : "session_mileage",
        mileage_cents: String(q.tipCents),
      },
      description: `Mileage for care session (${String(sessionId).slice(0, 8)})${isExtra ? " — approved extra" : ""}`,
    }, { idempotencyKey: `inplace_mileage_${which}_${sessionId}_${q.tipCents}_d${declines}` });
    if (intent.status !== "succeeded") return fail(`charge status ${intent.status}`, { declined: true });
    await db.prepare(`
      UPDATE care_sessions SET ${statusCol} = 'charged', ${piCol} = ?, ${feeCol} = ?, mileage_error = NULL WHERE id = ?
    `).run(intent.id, q.feeCents, sessionId);
    const ledger = require("./ledger");
    await ledger.record(db, {
      sessionId, ...(await ledger.partiesFor(db, sessionId)), kind: "mileage",
      familyCents: q.totalCents, caregiverCents: q.tipCents, platformCents: 0,
      cardFeeCents: q.feeCents, stripePaymentIntent: intent.id,
      breakdown: {
        miles: isExtra ? s.mileage_extra_miles : s.mileage_paid_miles, rateCents: s.mileage_rate_cents,
        mileageCents: q.tipCents, cardFeeCents: q.feeCents, feePercent: 0, extra: isExtra,
        note: "the caregiver receives all of the mileage; the family covers the card fee",
      },
    });
    console.log(`[mileage] Charged $${(q.totalCents / 100).toFixed(2)} (${which}) for session ${String(sessionId).slice(0, 8)} (PI: ${intent.id})`);
    return { charged: true, id: intent.id, totalCents: q.totalCents, feeCents: q.feeCents };
  } catch (err) {
    const declined = !!(err && (err.type === "StripeCardError" || err.code === "card_declined" || err.code === "authentication_required"));
    return fail(err && err.message ? err.message : String(err), { declined });
  }
}

/** Charge whatever is owed on this visit. Never throws. */
async function settleSession(db, sessionId) {
  const out = {};
  try { out.paid = await chargeMileage(db, sessionId, "paid"); } catch (e) { captureException(e, { where: "mileage: settle paid", sessionId }); }
  try { out.extra = await chargeMileage(db, sessionId, "extra"); } catch (e) { captureException(e, { where: "mileage: settle extra", sessionId }); }
  return out;
}

/** Poller 116: visits whose mileage is owed and whose own payment has gone through. */
async function sweepOwed(db) {
  // Review (10/28): two admin/legacy paths complete a visit without check-out. Lock their trips
  // here so the family sees frozen numbers and the charge can follow the visit's own payment.
  const unlocked = await db.prepare(`
    SELECT DISTINCT cs.id FROM care_sessions cs JOIN visit_trips vt ON vt.session_id = cs.id AND vt.deleted_at IS NULL
     WHERE cs.status = 'completed' AND cs.mileage_locked_at IS NULL LIMIT 25
  `).all();
  for (const u of unlocked) {
    try { await lockForSession(db, u.id); } catch (e) { captureException(e, { where: "mileage: sweep lock", sessionId: u.id }); }
  }
  const rows = await db.prepare(`
    SELECT id FROM care_sessions
     WHERE payment_status = 'paid'
       AND ((mileage_status = 'owed' AND (mileage_next_try_at IS NULL OR mileage_next_try_at <= NOW()))
         OR (mileage_extra_status = 'approved' AND (mileage_extra_next_try_at IS NULL OR mileage_extra_next_try_at <= NOW())))
     ORDER BY mileage_locked_at LIMIT 25
  `).all();
  let n = 0;
  for (const r of rows) {
    const res = await settleSession(db, r.id);
    if ((res.paid && res.paid.charged) || (res.extra && res.extra.charged)) n++;
  }
  return n;
}

async function decideExtra(db, session, userId, approve) {
  if (session.mileage_extra_status !== "pending") return { error: "There's nothing waiting on this visit." };
  const status = approve ? "approved" : "declined";
  const res = await db.prepare(`
    UPDATE care_sessions SET mileage_extra_status = ?, mileage_extra_decided_by = ?, mileage_extra_decided_at = NOW()
     WHERE id = ? AND mileage_extra_status = 'pending'
  `).run(status, userId, session.id);
  if (res && res.changes === 0) return { error: "Someone else just decided this." };
  let charge = null;
  if (approve) charge = await chargeMileage(db, session.id, "extra").catch((e) => ({ error: e.message }));
  try {
    const cg = await db.prepare("SELECT user_id FROM caregiver_profiles WHERE id = ?").get(session.caregiver_id);
    if (cg && cg.user_id) {
      const { sendPushToUser } = require("../routes/push");
      await sendPushToUser(cg.user_id, {
        title: approve ? "Extra mileage approved" : "Extra mileage not approved",
        body: approve ? `$${((session.mileage_extra_cents || 0) / 100).toFixed(2)} for extra miles is on its way to you.`
          : "The family didn't approve the miles past their cap for one visit.",
        data: { type: "mileage_extra_decided", page: "dashboard", sessionId: session.id },
      }, "mileage_extra").catch(() => {});
    }
  } catch (e) { captureException(e, { where: "mileage: notify decision", sessionId: session.id }); }
  return { status, charge };
}

module.exports = {
  IRS_RATE_CENTS, MIN_RATE_CENTS, DEFAULT_RATE_CENTS, DEFAULT_CAP_MILES, MAX_CAP_MILES, MAX_STOPS, MAX_TRIP_MILES,
  clampRate, clampCap, splitAtCap, centsFor,
  settingsFor, saveSettings, isLeaderOrOwner, deciders,
  quoteTrip, addTrip, sessionSummary, tripView,
  lockForSession, chargeMileage, settleSession, sweepOwed, decideExtra,
};
