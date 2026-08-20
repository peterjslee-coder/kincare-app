# InPlace Ops Runbook — safety net & staging
_Last updated: July 10, 2026 (v1.89.0)_

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

**CI (`.github/workflows/ci.yml`)** — every push runs the unit suite (47
tests), the embedded-PostgreSQL integration suite (27 tests), and a client
bundle build. With Railway "Wait for CI" on, red = no deploy.

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
