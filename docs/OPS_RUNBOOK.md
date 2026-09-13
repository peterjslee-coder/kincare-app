# InPlace Ops Runbook — safety net & staging
_Last updated: September 13, 2026 (v1.106.5 — Batch 2 of the remediation plan)_

This documents the hardening added in the July 2026 safety-net pass and the
console actions only Pete can do. Work through **"Pete's console checklist"**
top to bottom once; everything else is reference.

---

## Pete's console checklist (one-time, ~30 min total)

### 1. GitHub — let the deploy token push workflows (only if a push ever fails with a "workflow" scope error)
GitHub → Settings → Developer settings → Fine-grained tokens → **inplace-deploy**
→ Repository permissions → set **Workflows: Read and write**.

### 2. Railway — gate deploys on CI (~2 min)
Railway → inPlace service → **Settings → Deploy** → enable **"Wait for CI"**
(sometimes labeled "Check Suites"). After this, a push that fails tests will
NOT deploy. Remember Railway stages changes — click **Deploy Changes**.

### 3. Cloudflare R2 — backup storage (~10 min)
1. Cloudflare dashboard (same account as the yourinplace.com DNS) → **R2** →
   enable if needed (free tier: 10GB, plenty).
2. Create bucket: **inplace-db-backups** (private — do NOT enable public access).
3. R2 → Manage API tokens → Create token → permissions **Object Read & Write**,
   scoped to that bucket. Note the Access Key ID + Secret.
4. Optional but recommended: bucket → Settings → Lifecycle rules → delete
   objects after 45 days (belt-and-suspenders on top of the workflow's 30-day prune).

### 4. GitHub — backup secrets (~5 min)
Repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
|---|---|
| `PROD_DATABASE_URL` | Railway → Postgres → Variables → **`DATABASE_PUBLIC_URL`** (the public one — the `.railway.internal` URL won't work from GitHub) |
| `BACKUP_ENCRYPTION_KEY` | Long random passphrase (`openssl rand -base64 32` in Terminal). **Store a copy in your password manager — without it, backups are unreadable.** |
| `R2_ACCOUNT_ID` | Cloudflare dashboard → R2 → account id (in the S3 endpoint) |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | from step 3.3 |
| `R2_BUCKET` | `inplace-db-backups` |

Then: repo → Actions → **Nightly DB backup** → Run workflow → confirm it goes
green. From then on it runs nightly at 3am ET, verified and pruned automatically.

### 5. Railway — staging environment (~10 min)
1. Railway project → **+ New** → Database → PostgreSQL → name it `postgres-staging`.
2. **+ New** → GitHub repo → same repo, but set **branch: `staging`**
   (branch already exists). Name the service `inplace-staging`.
3. On `inplace-staging` → Variables: copy every variable from the prod service,
   EXCEPT — `DATABASE_URL` → reference `postgres-staging`; use Stripe **test**
   keys (`sk_test_...`); leave `SENTRY_DSN` empty (or make a second Sentry
   project); leave `RESEND_API_KEY` empty unless testing email.
4. Click **Deploy Changes**. Optionally add a domain like
   `staging.yourinplace.com` (Settings → Networking).
5. Seed it: from the staging service shell (or locally with the staging
   DATABASE_URL): `npm run seed`.

### 6. GitHub notifications sanity check (~1 min)
The uptime monitor emails you by failing its workflow. Confirm
github.com/settings/notifications → Actions → "Send notifications for failed
workflows" is on (it is by default) and emails go somewhere you read.

---

## How the pieces work

**CI (`.github/workflows/ci.yml`)** — every push runs seven lint gates, the unit
suite, the embedded-PostgreSQL integration suite, a client bundle build, and
`npm audit --omit=dev --audit-level=high`. Counts move every week; `npx jest`
prints the current ones. With Railway "Wait for CI" on, red = no deploy.

**Backups (`.github/workflows/db-backup.yml`)** — nightly 3am ET: pg_dump
(custom format) → AES-256 encrypt → upload to R2 → prune >30 days → decrypt +
`pg_restore --list` to prove the archive is valid. Until secrets exist it
skips with a warning. Restore procedure is in the file's header comment.
This does NOT replace `Backup InPlace DB.command` — keep using it before
risky migrations for an extra point-in-time copy.

**Uptime (`.github/workflows/uptime.yml`)** — hits `/api/health` every 15
minutes; 3 consecutive failures → workflow fails → GitHub emails you.
Upgrade path: UptimeRobot free tier checks every 5 min with SMS options —
if you set that up, delete this workflow.

**Staging flow** — push to `staging` branch → staging service deploys → click
around at the staging URL → merge/push the same commits to `main` for prod.
For risky work (payments, consent, migrations): staging first, always.

## Deploy-flow reference (updated)

```
feature work → push to staging → verify on staging URL
            → push to main → CI runs → Railway waits for green → deploys
            → verify /api/version + footer
```

Emergency bypass (CI is broken but a prod fix can't wait): Railway →
service → Deployments → "Deploy latest commit" manually, or temporarily
toggle "Wait for CI" off. Turn it back on after.

---

## One-off repair: personal DMs stuck in the "InPlace Support" thread

`scripts/repair-support-dm-split.js` (v1.105.104)

Until v1.105.102, seven lookups asked "is there already a direct conversation containing these
two users?" with no `ORDER BY` and no `LIMIT`. An admin who is also a person already had an
`InPlace Support` row with that user, so personal messages could land in the platform's thread
— which is why Julia saw Pete as "InPlace support". v1.105.102 stops it recurring; this undoes
what already happened.

The split is read from `messages.sender_label`, not guessed: `admin/safety.js` stamps
`InPlace Support` on anything sent as the platform, ordinary sends leave it NULL, and the other
party's unlabelled replies follow whatever they were replying to.

```bash
# Railway → service → Console. Take a snapshot first (manual pg_dump above).
node scripts/repair-support-dm-split.js            # report only — changes nothing
node scripts/repair-support-dm-split.js --apply
node scripts/repair-support-dm-split.js --apply --only <conversationId>
```

Read the report before applying. `CLEAR` means the thread was only ever a DM wearing the wrong
name and just gets untitled — no message moves. `SPLIT` lists the messages that will move.
It never deletes anything, and re-running it is a no-op.


---

# Incident runbook (v1.106.5)

Written for one person at 2am. Each section is: **how you find out → what to look at →
what to do.** Nothing here needs a second pair of hands.

## The one-minute triage

```bash
curl -s https://yourinplace.com/api/health          # is the process up?
curl -s https://yourinplace.com/api/version         # is the code you think is live, live?
```

`/api/health` answering but the site feeling dead almost always means the **database pool
is exhausted**, not that the app is down. Go to "Site is slow or half-loading" below.

Three places hold the answer, in the order worth checking:

| Where | What it tells you |
|---|---|
| Railway → service → **Deployments** | did something ship in the last hour? Roll it back first, diagnose second. |
| Railway → service → **Logs** | the actual error. Filter for `[db]`, `statement_timeout`, `ECONNREFUSED`. |
| **Sentry** | the same error with a stack, a release tag, and how many people it hit. |

## Roll back (do this before you diagnose, if a deploy is in the frame)

Railway → service → Deployments → find the last green one → **Redeploy**. It takes about
90 seconds. Then verify the footer version changed back. Diagnosing a live outage while
users are in it is a choice, not a requirement.

If the bad commit is already on `main`, also `git revert` it so the next push does not
re-deploy the same thing.

## Site is slow or half-loading

Almost always the Postgres pool (10 clients, `src/models/database.js`).

1. Railway → Postgres → **Metrics**: active connections. At 10 with the API alive, one or
   more queries are stuck.
2. Since v1.106.5 every connection carries `statement_timeout = 20000`, so a genuinely
   stuck query now dies after 20 seconds and logs. If you see repeated
   `canceling statement due to statement timeout` for the same query, that query is the
   incident — find it in the logs, note the route, and either add the missing index or
   disable the route.
3. `idle_in_transaction_session_timeout = 30000` covers the other shape: a transaction
   left open across a hung network call.

**If it is not the pool**, check whether one account is responsible:

```sql
SELECT user_id, kind, count FROM usage_counters
WHERE day = CURRENT_DATE ORDER BY count DESC LIMIT 20;
```

`upload_bytes` in the tens of millions, or `ipai_message` at its cap, names the account.
Admin → People → suspend, or set a lower ceiling in `src/utils/usageLimits.js`.

## Disk is filling (the Sept 2 outage, on purpose)

The Postgres volume is 50 GB and photos live in it as base64. Railway → Postgres →
Metrics → **Volume**. Over 70%:

```sql
SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS size
FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10;
```

`visit_photos`, `messages` and `caregiver_profiles` are the ones that grow. The v1.106.5
per-account daily ceiling (50 MB) bounds how fast anyone can push it, but does not shrink
it — Batch 3 moves photos to R2. Immediate relief: raise the Railway volume (Settings →
Volume → Resize, no downtime), then find the account with the `upload_bytes` query above.

## Under attack

Symptoms: request rate far above normal, or one endpoint dominating the logs.

1. **Cloudflare → Security → Events** — is it one IP, one ASN, one path?
2. **Under Attack Mode**: Cloudflare → the domain → Security → Settings →
   Security Level → *I'm Under Attack*. Every visitor gets a 5-second interstitial.
   Blunt, immediate, and it breaks the native apps' API calls — accept that trade only
   while you are actually under attack.
3. The standing rate-limit rule ("API abuse — expensive and upload paths", 20 req / 10 s
   per IP, block 10 s) already covers `/api/ipai`, `/api/care-intelligence`, `/api/notes`,
   `/api/photos`, `/api/family-visits`, `/api/reimbursements`, `/api/self-onboarding`,
   `/api/caregiver-onboarding` and `/api/auth/demo-login`. Webhooks are deliberately
   excluded — rate-limiting Stripe or Checkr silently loses money and background checks.
4. **The free plan is the constraint, and it is worth knowing before you need it.**
   Managed WAF rulesets require a paid plan. The free plan allows exactly **one**
   rate-limiting rule, and both its window and its block duration cap at **10 seconds**.
   So the ceiling on what Cloudflare can do for us today is: one rule, ten-second memory.
   Cloudflare Pro (~$20/mo) lifts all three. That is a decision, not a task.
5. Blocking one source by hand: Cloudflare → Security → WAF → Tools → **IP Access Rules**
   → Block. Unlimited, and it is the right tool for a single bad actor.

## Someone got in

1. Railway → Variables → rotate `JWT_SECRET`. **Every session on the platform ends
   immediately, including yours.** That is the point.
2. If a specific account is compromised: Admin → People → force password reset. Since
   v1.106.4 a password change stamps `password_changed_at` and every token issued before
   it stops working, so the reset alone ends their sessions.
3. `audit_log` is the record of what was done. Filter by `user_id` and by hour.
4. Trusted devices survive a password change by design; if the concern is device theft,
   clear them: `DELETE FROM trusted_devices WHERE user_id = '<id>'`.

## A third party is down

Each one degrades rather than fails, and knowing which is which saves an hour:

| Down | What breaks | What still works |
|---|---|---|
| Stripe | new checkouts, Connect onboarding | everything else; the admin kill switch turns payments off cleanly |
| Resend | all outbound email | the app; users just get no mail |
| Checkr | background-check initiation | existing verified caregivers |
| Nominatim / Photon | new address geocoding, autocomplete | cached addresses (v1.106.5), and every field stays hand-editable |
| Anthropic | iPAi replies | everything else |
| Railway Postgres | everything | nothing — this is the real outage |

## After it is over

Write what happened into `docs/HANDOFF.md` the same night, while the detail is still
there. An incident nobody wrote down happens twice.
