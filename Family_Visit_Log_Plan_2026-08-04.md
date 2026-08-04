# Family Visit Log — scope

**Aug 4, 2026 · scoping only, nothing built · Pete's ask**

> *"how can i check in with mom… make a care session?"*
> *"if the app tagged me at her house and said 'wanna leave notes?' that'd be great."*

---

## The gap, stated plainly

Betty's actual care includes Pete, and Peggy bringing dinner most nights. None of that is a *session*, so none of it exists in the record — while the doctor report and iPAi can only reflect what is recorded.

A month where Pete visited eight times and a caregiver came twice reads, to anything generated from that data, as **a month with two visits**. That is not a cosmetic gap. It is a gap in the input to a document that goes to a physician.

And there is no way to close it today: `POST /api/sessions/:id/check-in` refuses anyone who is not the assigned caregiver — *"Only the assigned caregiver can check in"* — and a session created with nobody assigned just sits as an open request.

---

## What we are building (Pete's pick)

**Tier 1 — the open-the-app prompt.** When a family member opens the app and is already inside the geofence around the care recipient's home, offer to log the visit. Plus a plain **"Log a visit"** button that works from anywhere, any time, with no location involved at all.

**Explicitly NOT in scope:** background geolocation. The buzz-in-your-pocket version needs iOS `Always` authorization and Android `ACCESS_BACKGROUND_LOCATION` — new store declarations, a Play demo video with one of the highest rejection rates on the platform, and a privacy policy rewrite (the current 2026-07-07 policy does not mention location *at all*). That is a separate decision with the lawyer, not a sprint item. Tier 1 is designed so Tier 3 can be added later without redoing any of it.

---

## What already exists (most of it)

| Piece | Where | Status |
|---|---|---|
| "Is this person at the house?" | `geofenceEvidence(lat, lng, homeLat, homeLng, 1000)` in `src/utils/geocode.js` | ✅ built, 1000 ft radius, tolerant of GPS jitter |
| Recipient's coordinates | `care_recipients.latitude/longitude`, auto-geocoded on create/update | ✅ built |
| Privacy-preserving storage | `coarsenCoordinate()` — decide at full precision on the device, store ~1.1 km | ✅ built (v1.105.23) |
| Foreground location permission | `NSLocationWhenInUseUsageDescription`; Android `ACCESS_COARSE/FINE_LOCATION` | ✅ declared |
| Mood + note + photo capture | the caregiver visit-log modal in `CaretakerHub.js` | ✅ built — reuse the shape, not the code path |

**The feature is mostly assembly.** Which is the good news and also the trap: assembly work looks cheap right up until the data model bites.

---

## ⚠️ The decision hidden in the schema

The obvious move is "write family visits to `visit_logs` like everything else." **It does not work, and it would be expensive to discover late.**

```sql
CREATE TABLE visit_logs (
  id TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES care_sessions(id),
  caregiver_id TEXT NOT NULL REFERENCES caregiver_profiles(id),
  ...
)
```

Both foreign keys are `NOT NULL`. A family visit has neither a session nor a caregiver. Making them nullable is a one-line migration and a **fifteen-file blast radius** — `visit_logs` is read by `careIntelligence.js`, the doctor report in `careRecipients.js`, `financials.js`, `accountability.js`, `dashboard.js`, `matching.js`, `interviews.js`, three admin modules and more. Most of them `JOIN care_sessions`, so a row with a null `session_id` silently vanishes from some queries and silently appears in others.

Concretely, what going the nullable route buys you:

- `financials.js` audits for *"completed/paid sessions with no visit log or no check-in/out."* A family visit with no session is a new shape that audit has never seen.
- The doctor report and iPAi would blend Pete's visits with a paid caregiver's observations unless **every** consumer is updated. Miss one and the report says a professional observed something a son did. That is exactly the derivation-chain failure from the v1.93 doctor-report post-mortem, and it is Pete's cardinal rule.

**Recommendation: a separate `family_visits` table.** Every consumer then *opts in*, deliberately and labelled. Nothing changes behaviour by accident, and the failure mode of forgetting a consumer is "family visits don't show up yet" rather than "a son's note is attributed to a nurse."

```sql
-- MIGRATIONS_V2, next free number
CREATE TABLE IF NOT EXISTS family_visits (
  id                TEXT PRIMARY KEY,
  care_recipient_id TEXT NOT NULL REFERENCES care_recipients(id),
  user_id           TEXT NOT NULL REFERENCES users(id),   -- who visited
  visited_at        TIMESTAMPTZ NOT NULL,                 -- when (editable; defaults to now)
  duration_minutes  INTEGER,                              -- optional, never required
  summary           TEXT,   /* PHI */
  mood_rating       TEXT,   /* PHI */
  activities        TEXT,   /* JSON array of chips */
  latitude          REAL,   -- coarsened, nullable
  longitude         REAL,   -- coarsened, nullable
  distance_ft       INTEGER,-- geofence evidence at full precision, then discarded
  geo_flag          TEXT,   -- 'ok' | 'far' | 'no_geo'
  logged_via        TEXT NOT NULL DEFAULT 'manual',       -- 'manual' | 'geo_prompt'
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
```

Reusing `distance_ft` / `geo_flag` / coarsened coordinates keeps it consistent with the caregiver flow, so the same privacy story covers both. **And it needs a `seed.js` cleanup entry** — the rule that has now bitten twice (Care Tasks v1.99.1, reimbursements v1.105.35).

---

## The trigger, and how not to be annoying

1. On dashboard mount, for `family` / `care_for` roles only.
2. **Check permission state first — never trigger a cold OS location prompt for a nudge nobody asked for.** `navigator.permissions.query({ name: 'geolocation' })`; if it is not already `granted`, stay silent forever. The prompt is a bonus for people who already share location for check-in, not a reason to demand it.
3. One `getCurrentPosition` with a short timeout and `maximumAge` set, so it is cheap and usually cached.
4. `geofenceEvidence(...)` against the recipient's coordinates, **at full precision, on the device**. Only the coarsened point is ever sent.
5. Suppress if: a visit is already logged for this person today, the card was dismissed within the last 6 hours (localStorage, wrapped in try/catch — see the v1.105.35 white-screen fix), or a paid session is in progress right now (the caregiver is there; this is not your visit).
6. Never block anything. It is a dismissible card on the dashboard, never a modal, never an interruption.

**Everything above degrades to nothing.** No permission, no GPS, denied, timed out, indoors with no fix — the card simply does not appear and the manual "Log a visit" button is unaffected. That is the whole design: location makes it *convenient*, never *required*.

---

## Privacy — the line that matters

**The nudge is private to the person visiting. The visit is shared; the location is not.**

- The care team sees *"Pete logged a visit — Tuesday, 2:15pm"*, identical to what they would see if he had tapped the button manually from his kitchen.
- The team never sees *"Pete was detected at Betty's house."* No arrival notification, no location on anyone else's screen, no presence indicator. That distinction is the whole difference between a helpful nudge and surveillance, and surveillance of family members is already flagged for the lawyer under Companion Mode.
- `logged_via` is stored for our own product understanding (does the prompt actually get used?) and is **not** surfaced in the UI, the doctor report, or any export.
- Coordinates coarsened before storage, exactly as check-in does.

---

## Where it shows up

| Surface | Treatment |
|---|---|
| Dashboard | The prompt card when in range; a **"Log a visit"** button always |
| Care Profile | Family visits interleaved with observations, clearly attributed by name |
| Doctor report | **Opt-in, and labelled.** A separate line — *"Family visits: 8 this month (Pete: 6, Sara: 2)"* — never blended into caregiver observations. Frequency and presence are genuinely useful to a physician; the point is that the source is never ambiguous. |
| iPAi | Same rule. It may count and reference family visits, and must always attribute them. |
| Financials / accountability | **Untouched.** Family visits are not sessions, carry no money, and must never enter a payout, an audit, or a no-show poller. |

---

## Build order

1. Migration + `seed.js` cleanup entry.
2. `POST /api/family-visits`, `GET /api/family-visits/:recipientId` — access-gated through `recipientAccess()` from `src/utils/access.js` (the helper added in v1.105.35, so this does not repeat the six-unauthorised-endpoints mistake).
3. The manual "Log a visit" sheet. **This is the whole feature without any location at all** — ship it first and the gap is closed even if the geofence never lands.
4. The geofence prompt on top.
5. Doctor report + iPAi opt-in, labelled.
6. Tests: geofence maths at the boundary, suppression rules, coarsening-before-storage, access control, and the "no permission → silent, manual path still works" degradation.

**Prerequisite for step 4 only:** `navigator.geolocation` is still unverified on a real iPhone (the open P0 — `@capacitor/geolocation` is not installed and nothing calls `requestWhenInUseAuthorization()`). Steps 1–3 do not depend on it. Step 4 does, and so does submission.

---

## Open questions for Pete

1. **Who can log a visit?** Any care-team member, or only family (not the recipient themselves)? Betty logging her own day is a different and possibly lovely feature.
2. **Duration** — worth asking for, or is "I was there" enough? My instinct is to leave it optional and unprompted; asking a son to time his visit to his mother feels wrong.
3. **Activity chips** — what should the list be? Straw man: *meal · medication reminder · errand/shopping · appointment · housework · just company*. That last one matters and is the one a caregiver-shaped form would leave out.
4. **Retroactive logging** — should "I visited yesterday" be allowed? (Recommend yes; `visited_at` is editable.)


---

# Addendum — where it lands, and the push (Pete, Aug 4)

> *"and then that goes to care notes? I like it. then if I log a visit, you can push to the care team… a nudge to return to the app and see what Pete had to say."*

## Where it lands: one record, surfaced in the notes stream

Yes — it shows up in Observations & Notes on the Care Profile, interleaved with caregiver observations and attributed by name (screen 3 of the mockup).

**One record, not two.** Logging a visit writes a `family_visits` row and the Care Profile view merges three sources into one stream: `family_visits`, `recipient_notes`, and caregiver `visit_logs`. The tempting shortcut — also writing a `recipient_notes` row so it "just appears" — creates two rows for one event, and they drift the moment anyone edits or deletes. Same reasoning as keeping family visits out of `visit_logs`: merge at read time, never duplicate at write time.

## The push — yes, and three things to get right

The social loop is the point. A care team that never hears from each other isn't a team, and *"Pete was there and she asked about Dad again"* is exactly what Sara three hours away wants to know.

### 1. ⚠️ The push must NOT contain the note

**This is already a live issue, independent of this feature.** `src/routes/notes.js:200` sends:

```js
body: `${authorName}: ${String(content).slice(0, 120)}`
```

`recipient_notes.content` is marked `/* PHI */` in the schema. So today, an observation about Betty's health — *"confused about where she was, wouldn't take her evening pill"* — lands on **every team member's lock screen**, readable by anyone who picks up the phone. No unlock, no app, no account.

And here is the useful part: **privacy and Pete's stated goal agree.** He asked for *"a nudge to return to the app and see what Pete had to say."* A push that already says what Pete said is a worse nudge — there is nothing left to come back for. Both point at the same design:

> **Pete added a note about Betty** — Tap to read

Nothing else. No mood, no content, no activity chips. **Recommend fixing the existing `team_note` / `observation_attention` pushes the same way, as its own small change.** That is a copy decision, so it is Pete's call, not mine to make quietly.

### 2. Volume — the real risk to the whole notification system

If Pete visits daily and Peggy most evenings, that is two pushes a day to every team member, forever. Notification fatigue does not stay contained: people do not mute one category, they turn push off entirely — and then they miss the late check-in, the no-show, and the medication escalation. **The cheapest way to break the alerts that matter is to bury them in alerts that don't.**

Mitigations, in order of preference:
- **Its own toggle** — `push_family_visit`, alongside the toggles rebuilt in v1.105.2. Opt-out (default on), matching the existing convention.
- **One per person per day.** Peggy's nightly dinner drop-off generates one push, not thirty a month. Subsequent visits still land in the Activity feed silently.
- **Suppress your own.** Never push a visit to the person who logged it.
- **A quiet-hours floor.** Nobody needs "Peggy logged a visit" at 11pm.

### 3. In-app, it is an Activity line — never a banner

Per the v1.103.0 rule: *Next Up = future/act, Activity = past/acknowledge, nothing in both, new features announce via an Activity line — never a new banner.* A logged visit is past-tense and acknowledgeable, so it is one line in the 📢 Activity card. That is settled by the existing rule, not a new decision.

### 4. Who gets it?

The Care Tasks precedent is **family-only** — Pete's call at the time, with the caregiver-side surface deliberately parked. Same question applies here, and I do not think the answer is obvious: Edwina arriving Thursday would genuinely benefit from knowing Pete was there Tuesday and Betty asked about Dad twice. That is care-relevant, not gossip.

**Open question for Pete:** family-only (consistent with Care Tasks), or does the assigned caregiver see family visits too? If yes, it likely wants to be visible in the app without pushing to them — read on arrival, not buzzed at dinner.
