# Cancellation policy — what disagreed, and what I changed

**July 30, 2026 · shipped in v1.105.17**

Stated policy: **inside 24 hours, the client pays 100%. A caregiver who cancels is not paid, and can be reviewed.**

I found **eleven** places that said something different. Two of them were contradictions between documents people have already signed.

---

## Fixed in v1.105.17

### 1. Client Services Agreement, clause 8(b) — charged a rate that was never posted
The clause read *"a cancellation fee at the then-current rate posted on IPC's platform at the time of cancellation."* No rate was posted anywhere in the product — no admin screen, no settings row, no published figure. The charge was defined by reference to a number that did not exist, which meant **no amount was authorised, including 100%.**
**Now:** states one hundred percent (100%) of the amount authorized for the appointment.

### 2. Caregiver Agreement said "may," Client Agreement said "shall"
Same event, two signed documents, different force. *"the Client **shall** be charged"* vs *"the Client **may** be charged."*
**Now:** both say shall.

### 3. The caregiver's share deferred to a *second* unposted rate
Clause 8(b) also promised the caregiver *"a percentage of such fee calculated in accordance with the then-current Caregiver cancellation compensation rate posted on IPC's platform."* Also never posted.
**Now:** the same share they would have received had the visit happened, net of the Platform Fee — which is what the Stripe destination charge already does. The document now describes the mechanism instead of pointing at a missing number.

### 4. `terms-merged.html` capped the fee at 50%
> *"Family may be charged up to fifty percent (50%) of the session fee."*

That figure appeared in no agreement and no code path. It is served at `/legal/terms-merged.html` and, as far as I can tell, linked from nowhere — but it is public.
**Now:** 100%, matching the agreements.

### 5. `terms.html` had no cancellation section at all
This is the Terms page the **splash screen actually links to**. The words "cancel" and "refund" did not appear in the file.
**Now:** a Cancellations section that also explains care is not charged in advance.

### 6. The Dashboard told families something untrue
> *"You will still be charged for this session."*

Wrong twice: the contract charges a cancellation **fee**, not the session price, and no fee was ever actually taken. Families had been reading this for months.
**Now:** renders the server-computed amount, or says plainly that it could not check.

### 7. `DEFAULT_FEE_PERCENT` was 0
The mechanism existed but charged nothing.
**Now:** 100, matching the agreements. The `platform_settings` override survives, and posting 0 remains a working kill switch that needs no deploy.

### 8. A blank settings value read as a deliberate 0
`Number("")` is `0` and finite, so a corrupted or empty settings row silently switched charging off and was indistinguishable from someone intentionally turning it off.
**Now:** blank falls back to the agreement rate. Only an explicit `0` means zero.

### 9. The committed client bundle was stale
`public/js-compiled/bundle.js` still contained the deleted "You will still be charged" copy. Railway rebuilds on boot so production was correct — but anyone reading the repo, including me, would conclude otherwise.
**Now:** rebuilt and committed.

---

## Not fixed — these need a decision from you

### 10. Caregiver onboarding promises something that doesn't exist
`CaregiverOnboarding.js:1031` tells every new caregiver:

> *"If a family cancels within 24 hours of a session, you will still be compensated **unless you agree to a grace cancellation**."*

Two problems. **Grace cancellation does not exist** — no flow, no endpoint, no UI, nothing but three lines in `TASKS.md`. And this is the first thing a caregiver reads about money, so it sets the expectation.

Your stated policy pays the caregiver their normal share out of the 100% fee, so the compensation half is now *true*. The grace-cancellation clause is the part to either build or delete. **I'd delete the sentence.**

### 11. A completely separate cancellation fee, on a different formula
The time-change flow (`CaretakerHub.js:4035`, button label **"Cancel + Collect Fee"**) pays the caregiver `cancel_fee_hours × hourly_rate` when a family moves a session inside 24 hours and the caregiver declines. That is a second cancellation-fee concept with its own arithmetic, and it appears in **neither agreement.**

It also runs in the opposite direction from clause 8: here the family owes the caregiver for hours *outside the original window*, not a percentage of the authorization. I left it alone because changing it changes caregiver pay. **Worth ten minutes to decide whether it survives.**

---

## Two things that still need a hand

**The `/terms` route serves a different document than `/legal/terms.html`.** `SplashPage.js` links to the static file; `SelfOnboardingWizard.js` links to `/terms`, which `publicLegal.js` renders from the `legal_documents` database table. That table is **never seeded** — its contents are whatever an admin last published. So the two Terms links in your product can show different documents, and I can only fix the static one from here. **The DB version needs republishing through the admin panel with the new clause 8.**

**There is still no admin UI for the rate.** The endpoints exist (`GET`/`PUT /api/admin/financials/cancellation-fee`) but nothing in `AdminFinancials.js` calls them. Not urgent now that the agreements state the number outright — but if you ever want to change it, today that's an API call.

---

## One warning worth keeping

**Partial captures are not safe yet.** `accountability.js` sets `application_fee_amount` at authorization time against the full amount, and Stripe does not prorate it on a partial capture. Capturing 50% would take the platform's entire fee out of half the money and short the caregiver's contractual share.

At **100% the arithmetic is unaffected**, which is why the rate you chose is the only one that's safe to post today. If you ever lower it, prorate the application fee first. This is recorded in `cancellationFee.js` so it's found before someone changes the number.
