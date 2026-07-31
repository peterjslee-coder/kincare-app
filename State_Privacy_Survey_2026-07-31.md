# State Privacy Triage — Is Anything We're Doing a Showstopper?

**Prepared 2026-07-31 · Research only, not legal advice · Scope: state regulation of a non-HIPAA business's custody of health data**

---

## Bottom line

No state privacy law makes the InPlace business model unworkable, and no state's *comprehensive* privacy statute reaches a company your size on volume alone — but counsel's "most regimes have volume thresholds" comfort is now materially out of date in three specific ways, and one feature you have already shipped is a genuine architectural liability. The three threshold breakers: Washington's My Health My Data Act has **no volume threshold at all** and a private right of action, and it classifies both your care-recipient health fields and your caregiver check-in coordinates as consumer health data; Connecticut, as of **July 1, 2026 — four weeks ago** — removed its applicability threshold entirely for any controller that processes sensitive data, which you do on your first Connecticut customer; and Illinois BIPA and Texas CUBI have never had thresholds. The one shipped feature that should change now rather than later is the **AI selfie-to-government-ID face comparison** in `src/routes/caregiveronboarding.js` and `src/routes/selfOnboarding.js` — under BIPA that is a $1,000–$5,000-per-person, private-right-of-action, no-cure-period exposure resting on an unsettled legal question, and it is far cheaper to change the design now than to litigate it. Everything else on this list is a consent flow, a disclosure, a deletion SLA, or a policy document — real work, but detail-level work, not direction-level work.

---

## SHOWSTOPPER

Findings that require an architectural change or make the model unworkable in that state.

### 1. AI face comparison of selfie against government ID — Illinois BIPA (threshold-free, private right of action)

**What you do today.** `compareFaces()` in `src/routes/caregiveronboarding.js:174` and the equivalent in `src/routes/selfOnboarding.js` base64-encodes a caregiver selfie and a government ID photo, transmits both to a third-party model API, and asks it to assess "whether they appear to be the same person based on general facial structure." The system prompt asserts "This is a basic visual plausibility check, not biometric identification." **That disclaimer has no legal effect** — it is a statement in a prompt, not a fact about what the system does, and no court will treat a defendant's self-characterization as controlling.

**Why it's a showstopper.** BIPA (740 ILCS 14) excludes *photographs* from "biometric identifier" but expressly covers a **"scan of ... face geometry."** Since *Rivera v. Google*, 238 F. Supp. 3d 1088 (N.D. Ill. 2017), courts have held that geometric face data **derived from** a photograph is a biometric identifier notwithstanding the photograph exclusion — that is the theory behind Google's $100M Illinois settlement and the Clearview AI litigation. BIPA has **no revenue or volume threshold, no small-business exemption, and no cure period.** It carries a private right of action at **$1,000 per negligent violation and $5,000 per willful/reckless violation**, plus attorney's fees, with a five-year limitations period. The 2024 amendment (Public Act 103-769) capped repeat scans of the same person at one recovery, which helps, but does nothing about per-*person* exposure across a caregiver population.

BIPA compliance is not just consent. It requires, before collection: **written notice + a written release**; a **publicly available written retention and destruction schedule**; a **ban on selling or otherwise profiting** from the data; and **separate consent before disclosing to a third party** — which is exactly what transmitting the images to an external model API is.

**The unsettled part, stated honestly.** I found **no case deciding whether a multimodal LLM comparison of two face images constitutes collecting a "scan of face geometry."** It plausibly does not — no persistent faceprint template is created or stored, which is closer to the reasoning that spared on-device Face ID. It plausibly does — the model is by construction extracting and comparing facial structure to identify an individual, and BIPA's "biometric information" prong covers "any information ... based on an individual's biometric identifier used to identify an individual." **A one-person company should not be the test case.** The asymmetry is the point: being right costs you a defense; being wrong costs you statutory damages times every Illinois caregiver you ever onboarded.

**What changing direction looks like (cheap now):** (a) route identity verification entirely through **Stripe Identity**, which you already integrate at `src/routes/payments.js:614` and which contractually carries the biometric compliance itself; or (b) keep the AI check but make it human-reviewed-only with no automated identity determination; or (c) gate the feature off for Illinois and Texas users. Option (a) is likely the right answer — you are currently running two identity verification paths in parallel, and the homegrown one carries all the risk.

**Texas CUBI** is the same fact pattern with a materially better risk profile: "record of hand or face geometry" is covered, photographs and video are excluded, penalties reach $25,000 per violation — but enforcement is **Attorney General only, no private right of action**, and Texas HB 149 (TRAIGA, effective 2026-01-01) added a CUBI exemption for **security and fraud-prevention uses**, which identity verification plausibly fits. Illinois is the state that drives the decision.

### 2. Deletion has to reach backups, archives, and every downstream processor — Washington MHMDA (threshold-free)

**The requirement.** RCW 19.373.030–.040 gives a consumer the right to have consumer health data deleted, and the deletion obligation is unusually literal: the entity must delete the data **"from its records, including from all parts of its network,"** must **notify all affiliates, processors, contractors, and other third parties** and confirm they honor the deletion, and must respond **within 45 days (one 45-day extension permitted)**. Archived and backup data get a grace window of **up to six months** for system restoration — but the grace window is a deadline, not an exemption.

**Why this is architectural and not a detail.** Deletion propagation is the single hardest privacy requirement to retrofit. It touches: whether your Postgres backups are restorable-and-re-scrubbable or immutable; whether visit logs, `recipient_notes`, and `messages` are append-only; whether AI care summaries derived from deleted source data are themselves deleted; and whether anything you sent to an external model API can be recalled. It also sets up a real conflict with the liability-driven reason to retain visit logs and care notes in a business where an elderly person may be injured — you will want those records, and a Washington consumer can demand they be gone in 45 days. Resolving that conflict (retention schedule, legal-hold carve-out, tombstoning vs. hard delete, derived-data lineage) is a design decision, and it is dramatically cheaper before the data model calcifies.

**Threshold-free.** MHMDA's "small business" definition (RCW 19.373.010) — fewer than 100,000 consumers' health data per year, or fewer than 25,000 with under 50% of revenue from health data — **does not exempt you.** It only moved your original compliance date from 2024-03-31 to 2024-06-30. Both are in the past. You are a "small business" under the Act and fully subject to it.

**The teeth.** RCW 19.373.090 makes any violation a per se violation of the Washington Consumer Protection Act, which supplies the private right of action. Under RCW 19.86.090 a plaintiff must prove **actual injury to business or property** — this is a real filter, not a formality — but on success recovers actual damages, **treble damages capped at $25,000**, and **reasonable attorney's fees and costs**. The fee-shifting is what makes it a class-action magnet; the $25,000 cap is per plaintiff.

### 3. [OUT OF SCOPE — flagged because it is the likeliest actual showstopper] Home care licensure and caregiver-registry regulation

Counsel scoped her advice to custody of health data, and this survey followed that scope. But the question you asked was "is anything a showstopper for another state," and the honest answer is that **the highest-probability showstopper for a platform that places independent-contractor caregivers in elderly people's homes is not privacy law at all — it is state home care licensure.** California's Home Care Services Consumer Protection Act, for instance, regulates "home care organizations" and requires registration of home care aides; several states regulate nurse registries and caregiver referral agencies specifically, and some of those regimes are hostile to or incompatible with an independent-contractor model. Some states will treat a platform that matches, schedules, sets or influences rates, and supervises visits as an employer or a licensed agency rather than a referral service.

**I did not research this and cannot tell you how bad it is.** I am flagging it because it is the category most likely to force a change of direction, it is invisible from a privacy survey, and it should be the next question you put to counsel.

---

## STRICTER

Same design, more obligations. Budget engineering and process time; do not change direction.

### Connecticut is now threshold-free for you — this is the finding that most directly refutes the "we're too small" assumption

CTDPA as amended by **SB 1295, effective 2026-07-01** (i.e., in force now): the baseline threshold dropped from 100,000 Connecticut consumers to **35,000**, and — decisively — the threshold is **eliminated entirely** for any controller that **processes sensitive data** or that offers personal data for sale. Sensitive data includes health data, precise geolocation, and (newly) government-issued identifiers such as the driver's licenses you collect. **You process all three.** The full CTDPA therefore applies to you on your first Connecticut customer: opt-in consent for sensitive data, a "reasonably necessary" standard for sensitive processing, **data protection assessments**, consumer rights with 45-day SLAs, universal opt-out signal honoring, and a blanket ban on targeted advertising to and sale of data of **13-to-17-year-olds** regardless of consent.

Separately, Connecticut's **consumer health data amendments (in force since 2023-10-01)** already applied **regardless of any threshold** — requiring affirmative consent before processing consumer health data and consent before any sale. Enforcement is **Attorney General only; no private right of action.**

**SB 4 / Public Act 26-64, signed 2026-05-27, effective 2026-10-01** adds a ban on selling precise geolocation (1,750-foot radius) and new facial-recognition rules — on-premises signage and policy disclosure requirements aimed at physical-premises deployments, narrower than early summaries suggested, and no private right of action.

### Washington MHMDA, everything beyond the deletion problem

- **Consent model.** Opt-in consent is required before collecting consumer health data **unless the collection is necessary to provide a product or service the consumer requested.** Nearly everything you collect — conditions, medications, adherence, care notes, check-in location — fits that exception comfortably. What does *not* fit is anything secondary: analytics, product improvement, model training, marketing. Those need separate, specific, **opt-in** consent that cannot be bundled into terms of use. "Consent" is statutorily defined (RCW 19.373.010) to exclude general terms-of-use acceptance, hovering, muting, and dark patterns.
- **Sharing is a separate consent.** Disclosure to any third party that is **not** a contracted processor requires its own distinct opt-in consent, regardless of whether money changes hands. Whether your model-API vendor is a "processor" turns on your contract with them — see "could not confirm."
- **A separate privacy policy.** RCW 19.373.020 requires a standalone **Consumer Health Data Privacy Policy** — not a section of your general policy — with a **prominent link on your homepage**, listing categories collected, purposes, sources, categories shared, a list of categories of third parties **and specific affiliates** receiving data, and how to exercise rights. You may not collect for any purpose not disclosed in it without fresh consent. This is a concrete, bounded deliverable you do not currently have.
- **Access, withdrawal, appeal.** 45 days + one 45-day extension; appeals answered in writing within 45 days.

### Your check-in coordinates are health data, not just location data

MHMDA's definition of consumer health data expressly includes **"precise location information that could reasonably indicate a consumer's attempt to acquire or receive health services or supplies."** "Precise" means within a **1,750-foot radius** (RCW 19.373.010). Your `visit_logs.check_in_latitude` / `check_in_longitude` and `check_out` equivalents record a caregiver at an elderly person's home during a scheduled care visit — that is close to the paradigm case. Practical consequence: the check-in coordinates inherit the whole health-data regime (consent, the standalone policy, deletion propagation), not just the ordinary sensitive-geolocation rules. The same is true of `care_recipients.latitude/longitude`.

### Precise geolocation sale bans — threshold-free, and one of them is your home state

Outright bans on **selling** precise geolocation now exist in **Maryland**, **Oregon**, **Virginia** (SB 338, signed 2026-04-13, effective **2026-07-01** — in force in your home state as of last month; 1,750-foot definition; Virginia's ban is narrower than Maryland's and Oregon's because it reaches only disclosures for *monetary* consideration), and **Connecticut** (effective 2026-10-01, reaching sale for money *or other valuable consideration*). Massachusetts and others are considering the same.

**Action:** none, provided you never sell or barter location data — including via ad SDKs or analytics vendors that monetize it. These bans have no volume thresholds, so "we're small" is not a defense. Confirm no third-party SDK in the mobile builds transmits location.

### Nevada SB 370 — same shape as Washington, meaningfully softer

Effective 2024-03-31. **No volume or revenue threshold.** Requires affirmative consent before collecting or sharing consumer health data (same "necessary for a requested service" exception), a signed written authorization for any sale with a one-year maximum term retained six years, and bans geofencing medical facilities even with consent. Two important differences from Washington: the definition covers only data the entity **actually uses** to identify health status, not everything that theoretically could — which narrows it considerably — and there is **no private right of action.** Enforcement runs through the AG / Commissioner of Consumer Affairs as a deceptive trade practice.

### Maryland MODPA — the strictest substantive standard, but it has a threshold

Effective **2025-10-01**. Thresholds: **35,000** Maryland consumers, or **10,000** plus >20% of gross revenue from data sales. You will not hit these soon. When you do, MODPA imposes the toughest substantive rules in the country: collection limited to what is **"reasonably necessary and proportionate"** to the service the consumer requested (not to what you disclosed — a materially stricter standard), sensitive data processing only where **"strictly necessary,"** and a **flat ban on selling sensitive data** at any price with any consent. Minors: no sale or targeted advertising for **under-18s** where you knew or should have known. AG-only enforcement; 60-day cure period sunsetting 2027-04-01. **HB 711** (enacted 2026-05-31, effective 2026-07-01) expanded sensitive data to include controller-**inferred** sensitive characteristics — which reaches your AI-generated care summaries.

Design to MODPA's minimization standard now and you are effectively designing to the national ceiling.

### Minors — a 13+ floor is mostly fine, with two specific catches

Your 13-year-old minimum keeps you clear of COPPA and of the "known child" provisions in the Virginia-model statutes, which key to under-13. What bites at 13-17:

- **Colorado SB 24-041, effective 2025-10-01, applies regardless of any volume or revenue threshold** to any controller offering an online service to consumers it knows or willfully disregards are minors (under 18). It imposes a **duty of reasonable care**, requires a **data protection assessment** for features posing heightened risk, and — the one with a UI consequence — prohibits collecting **precise geolocation from a minor** unless it is reasonably necessary, retained only as long as necessary, **and a clear, ongoing signal is displayed to the minor while collection is occurring.** If a 13-17-year-old can ever hold an account that triggers location capture, you owe a persistent on-screen indicator.
- **Connecticut** (SB 1295, in force 2026-07-01) bans targeted advertising to and sale of data of 13-to-17-year-olds outright, consent notwithstanding. **Maryland** does the same for under-18s. You do neither, so this is disclosure-only — but it hard-blocks any future ad-supported tier for minor accounts.

**Cheapest structural fix:** set the minimum age for any account type that captures device location (i.e., caregivers) at **18**, and keep 13+ only for non-location account types. That converts a duty-of-care-plus-DPIA problem into a signup validation rule.

### Texas and Nebraska — no volume threshold, but the small-business exemption saves you

TDPSA (effective 2024-07-01) and Nebraska's NDPA (effective 2025-01-01) deliberately **omit numeric thresholds** and instead exempt businesses that qualify as small under **SBA size standards** — which a one-person company plainly does. **The exemption is not total:** even an exempt small business **may not sell sensitive data without obtaining consent.** Since your health data and precise geolocation are sensitive, the operative rule is: don't sell, or get explicit consent. Texas's AG must give **30 days' notice to cure**, permanently — no sunset.

### The 45-day clock is the number to engineer against

Nearly every state comprehensive law and MHMDA use **45 days to respond, with one 45-day extension**, plus a written appeal process answered within 45 days. Build one request-intake-and-fulfillment pipeline to that SLA and it satisfies all of them. This is the single highest-leverage piece of compliance engineering on the list.

### California AB 45 — narrow, but a genuine edge case worth ten minutes

Signed 2025-09-26, effective **2026-01-01**. Prohibits **any "person"** — not just CCPA-covered businesses, so no threshold — from collecting, using, disclosing, selling, sharing, or retaining personal information from an individual **at or within a 1,850-foot radius of a family planning center**, unless necessary to fulfill a service the individual explicitly requested. Private right of action for **treble damages plus attorney's fees**; $25,000 per violation civil penalty.

**The edge case:** in a dense city, a care recipient's home may sit within 1,850 feet of a family planning center, and your app records precise coordinates there at every check-in. The "explicitly requested service" exception should cover a scheduled home care visit — that is squarely why the coordinates are captured. But the exposure is threshold-free with treble damages, so it is worth a deliberate decision rather than an accident. **Reducing check-in coordinate precision to what you actually need for fraud deterrence (or storing a verified/not-verified boolean plus a coarse distance rather than raw lat/long) neutralizes this item, the MHMDA location-as-health-data item, and every geolocation sale ban at once.** That is the highest-value single change on this entire list.

---

## NOISE

Does not apply at this scale or to this business. Listed so you can stop worrying about them.

- **The 100,000-consumer comprehensive privacy laws.** Virginia, California, Colorado, Indiana, Iowa, Kentucky, New Jersey, Oregon, Utah all sit at ~100,000 consumers (some with a 25,000-consumer + revenue-share alternative; California adds a $25M revenue floor; Utah and Tennessee add $25M / $25M and set counts at 100,000 / 175,000). You are orders of magnitude away. **Caveat: the alternative prongs trigger on *selling* data, not volume — they stay noise only as long as you never sell.**
- **Florida's FDBR.** Requires **$1B+ in global revenue**. Reaches roughly ten companies.
- **The mid-tier thresholds** — Delaware and Rhode Island and New Hampshire at 35,000, Montana at **25,000** (lowered from 50,000 by SB 297, effective 2025-10-01, which also eliminated the cure period). Still far above you, but these are the ones you will cross first.
- **All the geofencing bans.** Washington's 2,000-foot ban around in-person health care facilities (RCW 19.373.080), Connecticut's and Nevada's 1,750-foot bans around mental health and reproductive health facilities. These prohibit *building a virtual perimeter around someone else's health facility to detect people entering it.* Recording a check-in at a client's private home is not a geofence. No consent exception exists for real geofencing, so just never build one.
- **MHMDA / Nevada "valid authorization" for sale.** Elaborate signed-authorization machinery, six-year retention, one-year expiry. Entirely irrelevant unless you sell health data. Don't.
- **New York's Health Information Privacy Act.** Would have been the strictest regime in the country. **S929 passed both chambers in January 2025 and was vetoed by Governor Hochul in December 2025.** A revised bill, **S9269**, was introduced in the 2026 session — it drops the 20%-of-revenue penalty, sets civil penalties at up to $15,000 per violation, has **no private right of action**, and would take effect six months after enactment. **Not law today.** Watch it; do not design for it.
- **Vermont's VDPOSA (S.71, signed 2026-06-16).** Thresholds of 35,000 residents / 3,000 for sensitive data or sales, and its consumer health data provisions apply **regardless of threshold** — but it does not take effect until **2028-01-01**. No private right of action. Plenty of runway.
- **Data broker registration** (California SB 361, Connecticut, New Jersey). You are not a data broker — you have a direct relationship with every consumer whose data you hold.
- **HIPAA.** Confirmed inapplicable by counsel on 2026-07-31. Note the flip side: the *reason* MHMDA, Nevada SB 370, and NYHIPA exist is precisely to regulate businesses in your position. Being outside HIPAA is what puts you inside them.
- **"PHI" as a term.** Worth retiring internally. PHI is a HIPAA term of art that does not apply to you, and the schema comments in `src/models/database.js` use it throughout. The operative terms are **"consumer health data"** (Washington, Nevada, Connecticut) and **"sensitive data"** (everywhere else). Using HIPAA vocabulary for non-HIPAA data invites the wrong compliance analysis from every future engineer, contractor, and auditor.

---

## What I could not confirm

1. **Whether an LLM face comparison is a "scan of face geometry" under BIPA or CUBI.** I found no case, no AG guidance, and no regulatory statement addressing multimodal LLM face comparison specifically. The *Rivera* line establishes that geometry derived from a photograph is covered; it does not tell us whether a model that produces a natural-language judgment rather than a stored template is doing that. **This is the central unresolved question in this report** and the reason item 1 is classified as a showstopper rather than merely strict.
2. **Whether your model-API vendor is a "processor."** Nearly every conclusion above about "sharing" turns on this, and it is a contract question — whether the vendor's terms/DPA bind them to process only on your instructions, bar their own use of the data, and pass through deletion obligations. I did not review your vendor agreement. If the answer is no, every transmission of health data or face images to that API is a **sharing event requiring separate opt-in consent** under MHMDA, Nevada, and Connecticut.
3. **Whether independent-contractor caregivers are "consumers" under MHMDA.** RCW 19.373.010 excludes "an individual acting in an employment context" from the definition of consumer. Whether a 1099 contractor falls inside that carve-out is genuinely unsettled and I found no authority. If contractors are **not** excluded, then caregiver selfies, ID photos, and check-in coordinates are that caregiver's own consumer health data with full rights attached. Assume the worse reading.
4. **How the first MHMDA private-right-of-action test comes out.** *Maxwell v. Amazon.com* (W.D. Wash., filed 2025-02-10) was consolidated on 2025-04-14 into *In re Amazon Ads SDK Litigation*, No. 2:25-cv-00252-BJR. **I found no ruling on a motion to dismiss.** The live question — whether "the data had monetary value" satisfies the CPA's injury-to-business-or-property element — determines whether MHMDA becomes a class-action engine or stays largely theoretical. This is the single most important thing to re-check in six months.
5. **Exact statutory text of the 2025–2026 Connecticut amendments (SB 1295, SB 4/PA 26-64).** I relied on law firm summaries, which were consistent with each other but which I could not check against the enrolled text. Given that the threshold elimination for sensitive data is load-bearing in this report, verify it directly before relying on it.
6. **Whether the count of comprehensive-law states is 23 or 24.** Sources published in June 2026 disagree (Hunton, Troutman, and IAPP say Vermont is the 23rd; Koley Jessen and Byte Back say 24th). Immaterial to your decision, but it tells you these trackers are not perfectly reliable.
7. **The precise threshold table.** The best consolidated chart I found (Coblentz) is dated **August 2025** and is already stale — it still shows Montana at 50,000 and does not reflect the Connecticut changes. Every number in the NOISE section should be re-verified before you rely on it to conclude a law does *not* apply.
8. **Home care licensure in any state.** Not researched. See showstopper item 3.
9. **Nothing here is jurisdiction-specific legal advice**, and the App Store's US-only listing does not limit which state's law applies — applicability turns on where the consumer is, not where you are.

---

## If you only do four things

1. **Replace or gate the homegrown AI face comparison.** You already pay for Stripe Identity. Running both paths means carrying all of the BIPA risk for none of the benefit.
2. **Cut the precision of stored check-in coordinates** to the minimum that actually deters fraud. One change; neutralizes the geolocation exposure in Washington, California, Virginia, Connecticut, Maryland, and Oregon simultaneously.
3. **Decide the deletion story now** — backups, derived AI summaries, processor propagation, and the legal-hold carve-out for visit logs — while the schema is still soft.
4. **Ask counsel about home care licensure**, which is outside what she scoped and is the likeliest thing to actually change your direction.

---

## Sources

**Washington My Health My Data Act**
- [RCW 19.373 (full chapter text)](https://apps.leg.wa.gov/rcw/default.aspx?cite=19.373&full=true) — definitions, privacy policy, rights, deletion, authorization, geofencing, CPA hook
- [RCW 19.373.010 (definitions)](https://apps.leg.wa.gov/rcw/default.aspx?cite=19.373.010) — small business, consumer health data, consent, 1,750-foot precise location
- [Washington Attorney General — Protecting Washingtonians' Personal Health Data and Privacy](https://www.atg.wa.gov/protecting-washingtonians-personal-health-data-and-privacy)
- [RCW 19.86.090 — CPA damages, $25,000 treble cap, attorney's fees](https://codes.findlaw.com/wa/title-19-business-regulationsmiscellaneous/wa-rev-code-19-86-090/)
- [Goodwin — MHMDA Comes Into Force (2024-03)](https://www.goodwinlaw.com/en/insights/publications/2024/03/alerts-technology-hltc-my-health-my-data-act-mhmda)
- [Orrick — First Lawsuit Filed Under MHMDA (2025-02)](https://www.orrick.com/en/Insights/2025/02/First-Lawsuit-Filed-Under-Washingtons-My-Health-My-Data-Act)
- [CourtListener — Maxwell v. Amazon.com, 2:25-cv-00261 docket](https://www.courtlistener.com/docket/69628048/maxwell-v-amazoncom-inc/)

**Nevada, Connecticut, Maryland, Vermont, Texas, Montana**
- [Bass Berry — Nevada SB 370 takes effect 2024-03-31](https://www.bassberry.com/news/nevada-consumer-health-data-law-takes-effect-on-march-31-2024/)
- [Orrick — Connecticut consumer health data amendments](https://www.orrick.com/en/Insights/2023/07/The-Consumer-Health-Data-Amendments--to-the-Connecticut-Data-Privacy-Act)
- [Wiley — Major Changes to Connecticut Consumer Privacy Law Effective 2026-07-01 (SB 1295)](https://www.wiley.law/alert-Major-Changes-to-Connecticut-Consumer-Privacy-Law-Will-Take-Effect-July-1-2026)
- [PrivacyLawMap — Connecticut SB 4 / Public Act 26-64](https://privacylawmap.com/blog/connecticut-ctdpa-amendments-sb4-2026)
- [Cooley — Maryland MODPA takes effect 2025-10-01](https://www.cooley.com/news/insight/2025/2025-09-09-marylands-unique-state-privacy-law-takes-effect-october-1--what-you-should-know)
- [Covington Inside Privacy — 2026 state amendment round-up (MD HB 711, CT SB 4, NH, NJ, DE)](https://www.insideprivacy.com/state-privacy/state-comprehensive-privacy-law-round-up-several-states-amend-their-privacy-statutes/)
- [Mayer Brown — Vermont VDPOSA (S.71), signed 2026-06-16, effective 2028-01-01](https://www.mayerbrown.com/en/insights/publications/2026/06/vermont-enacts-comprehensive-consumer-privacy-law)
- [Davis Wright Tremaine — TDPSA overview (no threshold, SBA small-business exemption)](https://www.dwt.com/blogs/privacy--security-law-blog/2023/07/texas-data-privacy-and-security-act-overview)
- [Future of Privacy Forum — Montana SB 297 amendments (25,000 threshold, effective 2025-10-01)](https://fpf.org/blog/amendments-to-the-montana-consumer-data-privacy-act-bring-big-changes-to-big-sky-country/)

**Biometrics**
- [Recording Law — Illinois BIPA requirements, damages, PA 103-769](https://www.recordinglaw.com/us-laws/data-privacy-laws/illinois-data-privacy-laws/biometric-privacy/)
- [Quandary Peak — Are Photos Like Fingerprints? BIPA and the photograph exclusion](https://quandarypeak.com/2023/02/are-photos-like-fingerprints-bipa-and-biometric-privacy-laws/)
- [Privacy World — 2025 Year-in-Review: Biometric Privacy Litigation](https://www.privacyworld.blog/2025/12/2025-year-in-review-biometric-privacy-litigation/)
- [ITECS — Texas CUBI compliance guide, incl. HB 149 / TRAIGA 2026 amendments](https://itecsonline.com/post/texas-biometric-identifier-act-cubi-a-compliance-guide-for-businesses-capturing-fingerprints-faces-or-voices)

**Geolocation and California**
- [Troutman — Virginia SB 338, third state to ban precise geolocation sales (signed 2026-04-13, effective 2026-07-01)](https://www.troutmanprivacy.com/2026/04/virginia-becomes-third-state-to-ban-sale-of-consumers-precise-geolocation-data/)
- [Hunton — California AB 45, health and location data](https://www.hunton.com/privacy-and-cybersecurity-law-blog/california-strengthens-privacy-protections-for-health-and-location-data)
- [Securiti — AB 45 scope, 1,850-foot radius, private right of action](https://securiti.ai/california-ab-45-health-location-data-compliance/)
- [Goodwin — California's Year-End Privacy Wave (AB 45, AB 656, SB 361)](https://www.goodwinlaw.com/en/insights/publications/2025/12/alerts-practices-dpc-californias-year-end-privacy-wave)

**Minors**
- [Keller and Heckman — Kids and Teens Privacy: 2025 Look Back and 2026 Predictions](https://www.khlaw.com/insights/kids-and-teens-privacy-2025-look-back-and-2026-predictions-part-ii-state-privacy-patchwork)
- [Lowenstein Sandler — Colorado SB 24-041, effective 2025-10-01](https://www.lowenstein.com/news-insights/publications/client-alerts/colorado-tightens-rules-on-minors-online-data-are-you-ready-for-october-1-data-privacy)

**New York**
- [Morrison Foerster — NYHIPA returns in 2026 (S929 vetoed December 2025; S9269 introduced)](https://www.mofo.com/resources/insights/260316-nyhipa-returns-in-2026-revised-bill)

**Thresholds and trackers**
- [Coblentz — U.S. State Privacy Laws: Applicability Thresholds chart (August 2025 — stale on Montana and Connecticut)](https://www.coblentzlaw.com/wp-content/uploads/2025/08/U.S.-State-Privacy-Laws-Applicability-Thresholds-1.pdf)
- [IAPP — US State Privacy Legislation Tracker](https://iapp.org/resources/article/us-state-privacy-legislation-tracker) (detailed threshold report is paywalled)
- [MultiState — 20 State Privacy Laws in Effect in 2026](https://www.multistate.us/insider/2026/2/4/all-of-the-comprehensive-privacy-laws-that-take-effect-in-2026)
- [Consenteo — US State Privacy Law Tracker 2026](https://www.consenteo.com/knowledge-hub/legal/us_state_privacy_law_tracker_2026)
