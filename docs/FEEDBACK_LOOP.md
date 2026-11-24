# The feedback loop

_Moved out of CLAUDE.md on 2026-09-13. Triggered by Pete saying "Run feedback loop"._



When Pete says **"Run feedback loop"**, execute this full cycle:

### Step 0 — Verify ADMIN_API_KEY (do this FIRST, every time)

The feedback loop requires `ADMIN_API_KEY` to bypass 2FA on the production API.
Check for it before doing anything else:

```bash
# In the repo .env file:
grep ADMIN_API_KEY .env
```

- **If present** → proceed to Step 1.
- **If missing** → STOP. Ask Pete for the key (it's in Railway env vars). Add it to `.env`:
  ```
  ADMIN_API_KEY=<the-key-from-railway>
  ```
  Then proceed. Do NOT attempt email/password login — it will hit 2FA and fail.

### Feedback Statuses (in the production DB)

| Status | Meaning |
|--------|---------|
| **new** | Just submitted by a user. Not yet read. |
| **reviewed** | Read and triaged. Logged in TASKS.md if actionable. Not yet in an active dev batch. Items that are "can't fix yet" or "not now" stay here — do NOT dismiss them. |
| **planned** | Committed to a specific version batch and actively being worked on. |
| **done** | Shipped, verified working in production. |
| **dismissed** | Genuinely not going to do — bad idea, duplicate, misunderstanding. NOT for "won't fix right now" items. |

### The Loop (Fast Path)

Use these two admin API endpoints for fast feedback triage. **All calls use the API key header — never email/password.**

1. **Pull new feedback in one call:**
   ```
   GET https://yourinplace.com/api/admin/feedback/triage
   Header: x-admin-api-key: $ADMIN_API_KEY
   ```
   Returns: `counts` (by status), `newItems` (full detail), `recentReviewed` (last 7 days), `summary` (one-line).

2. **Read the new items, triage into TASKS.md**, then bulk-mark as reviewed:
   ```
   POST https://yourinplace.com/api/admin/feedback/bulk-update
   Header: x-admin-api-key: $ADMIN_API_KEY
   Body: { "updates": [{ "id": "...", "status": "reviewed" }, ...] }
   ```
   Can also set `adminNotes` and `tags` per item. Praise items can go straight to `{ "status": "done" }`.

3. **Cross-reference already-fixed items.** Scan `recentReviewed` from the triage response against shipped versions. Bulk-mark as `done` using the same endpoint.

4. **Clean up TASKS.md.** Remove duplicates, mark stale items as done if fixed.

5. **Report summary.** Tell Pete: how many new items, what was triaged, what's still open — organized by priority tier.

### The Loop (Legacy — Full Fetch)

If a full export to FEEDBACK.md is needed:
1. `npm run collect-feedback` — fetches all items, writes FEEDBACK.md
2. Triage manually from FEEDBACK.md
3. Mark items via individual `PUT /api/feedback/:id` calls

### Planning a Version

When batching items into a version:
- Move feedback items from `reviewed` → `planned` in the DB
- Add them to TASKS.md under the version heading
- After shipping and verifying, move from `planned` → `done`

### Triage Priority Tiers

When triaging feedback, categorize every item by priority. The summary report should be organized by these tiers, not just by theme. At scale (hundreds of users), this ensures barriers to entry never get buried under cosmetic requests.

**P0 — Barriers to Entry (fix immediately)**
Anything that prevents a new user from signing up, logging in, completing onboarding, connecting Stripe, or booking/accepting their first session. If someone can't get in the door, nothing else matters. Also includes: payment failures, auth errors, 2FA lockouts, registration crashes, and any flow where a user gets stuck with no way forward. Bad-actor or inappropriate feedback also gets flagged here for moderation review.

**P1 — Core Flow Bugs (fix in current or next batch)**
Bugs in the critical path that don't fully block entry but degrade the experience enough that a user might abandon: messages not delivering, calendar not loading, sessions not appearing, caregiver search returning wrong results, confusing error messages during onboarding.

**P2 — UX & Polish (batch into upcoming versions)**
Usability improvements, layout issues, confusing labels, visual inconsistencies, mobile responsiveness problems. Important but not blocking anyone from using the product.

**P3 — Feature Requests (backlog)**
New capabilities, integrations, nice-to-haves. Good signal for the roadmap but no urgency.

**Dismiss** — Spam, inappropriate content, duplicates, misunderstandings. Not "won't fix right now" — only genuinely bad or irrelevant items.

### Key Rules
- **Never dismiss "can't fix yet" items.** Leave them as `reviewed`.
- **Only dismiss genuinely bad ideas** — duplicates, misunderstandings, spam, inappropriate content, or things that don't make sense.
- **Praise items** (e.g., "this looks great") can go straight to `done` — they require no action.
- **FEEDBACK.md is gitignored** — it's a local working file, not committed.
