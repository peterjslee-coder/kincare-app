#!/usr/bin/env node
/**
 * v1.106.15 — freeze the dual-name debt where it is.
 *
 * The client reads 36 fields as `x.foo_bar || x.fooBar`, across 131 sites. They are not
 * sloppiness: /api/sessions spreads raw rows (snake) and /api/dashboard hand-builds (camel),
 * components render sessions from both, so the fallback is the only correct thing to write
 * against the API as it stands. Measured against production, renaming to one convention breaks
 * ~200 unguarded reads in either direction (254 snake, 165 camel) for no user-visible gain.
 *
 * So this does not try to remove them. It stops there being MORE of them. Every existing pair
 * is baselined below with the count seen when the baseline was taken; a NEW pair, or more sites
 * for an existing one, fails the build. The fix for a new one is to make the endpoint agree with
 * the shape the client already reads, not to add a thirty-seventh fallback.
 *
 * tests/integration/apiFieldContract.itest.js is the other half: it checks the fallbacks that DO
 * exist actually resolve against a real response, because the failure mode of `||` is a silent
 * undefined that renders as a blank cell and tells nobody.
 */
const fs = require("fs");
const path = require("path");

const PUBLIC = path.join(__dirname, "..", "public", "js");

const SNAKE = "[A-Za-z_$][A-Za-z0-9_$]*\\.([a-z][a-z0-9]*(?:_[a-z0-9]+)+)";
const CAMEL = "[A-Za-z_$][A-Za-z0-9_$]*\\.([a-z][a-z0-9]*(?:[A-Z][A-Za-z0-9]*)+)";
const RE = new RegExp(`${SNAKE}\\s*\\|\\|\\s*${CAMEL}|${CAMEL}\\s*\\|\\|\\s*${SNAKE}`, "g");

const toCamel = (s) => s.split("_").map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join("");

function* jsFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* jsFiles(p);
    else if (e.name.endsWith(".js")) yield p;
  }
}

function scan() {
  const counts = new Map();
  const where = new Map();
  for (const file of jsFiles(PUBLIC)) {
    const rel = path.relative(path.join(__dirname, ".."), file);
    fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      for (const m of line.matchAll(RE)) {
        const sn = m[1] || m[4];
        const cm = m[2] || m[3];
        if (!sn || !cm || toCamel(sn) !== cm) continue;
        counts.set(sn, (counts.get(sn) || 0) + 1);
        if (!where.has(sn)) where.set(sn, []);
        where.get(sn).push(`${rel}:${i + 1}`);
      }
    });
  }
  return { counts, where };
}

// ─── BASELINE — taken at v1.106.15. Numbers may only go DOWN. ───
// To remove a pair: make the endpoint emit the name the client already reads everywhere else,
// delete the fallback, then lower the number here (or delete the line).
const BASELINE = {
  duration_hours: 18, first_name: 16, recipient_name: 16, estimated_cost: 10, last_name: 10,
  service_type: 10, special_instructions: 8, emergency_contact_name: 4, health_conditions: 4,
  caregiver_name: 3, emergency_contact_phone: 3, care_recipient_id: 2, caregiver_payout: 2,
  exclusive_until: 2, recipient_city: 2, authorization_tier: 1, budget_max: 1,
  food_allergies: 1, hourly_rate: 1, is_admin: 1, is_favorite: 1, location_city: 1,
  location_state: 1, location_zip: 1, medical_conditions: 1, observed_concerns: 1,
  pet_allergies: 1, profile_photo: 1, rate_daytime: 1, rate_nighttime: 1, rate_overnight: 1,
  recipient_lat: 1, recipient_lng: 1, reviewer_name: 1, short_notice_surcharge: 1, user_id: 1
};

function main() {
  const { counts, where } = scan();
  const problems = [];

  for (const [field, n] of counts) {
    const allowed = BASELINE[field];
    if (allowed === undefined) {
      problems.push({
        field, n, kind: "new",
        sites: where.get(field).slice(0, 4),
      });
    } else if (n > allowed) {
      problems.push({
        field, n, allowed, kind: "grew",
        sites: where.get(field).slice(0, 4),
      });
    }
  }

  // A baseline entry that no longer occurs is good news — but say so, so the number gets lowered
  // rather than quietly protecting a pair that is already gone.
  const stale = Object.keys(BASELINE).filter((f) => !counts.has(f));
  const shrunk = Object.entries(BASELINE)
    .filter(([f, n]) => counts.has(f) && counts.get(f) < n)
    .map(([f, n]) => `${f}: ${n} → ${counts.get(f)}`);

  const total = [...counts.values()].reduce((a, b) => a + b, 0);

  if (problems.length === 0) {
    let note = "";
    if (stale.length) note += `\n  [lint:dual-names] ${stale.length} baselined pair(s) are gone — remove from BASELINE: ${stale.join(", ")}`;
    if (shrunk.length) note += `\n  [lint:dual-names] shrunk, lower the baseline: ${shrunk.join("; ")}`;
    console.log(`  [lint:dual-names] ✓ ${counts.size} dual-name field(s), ${total} site(s) — none new${note}`);
    return 0;
  }

  console.error(`\n  [lint:dual-names] ✗ ${problems.length} dual-name read(s) added.\n`);
  console.error(`  A \`x.foo_bar || x.fooBar\` means the endpoint disagrees with the shape the client`);
  console.error(`  already reads. Fix the endpoint; a fallback only hides it, and hides it as a blank.\n`);
  for (const p of problems) {
    const head = p.kind === "new"
      ? `    ${p.field} — NEW dual-name field (${p.n} site(s))`
      : `    ${p.field} — grew from ${p.allowed} to ${p.n} site(s)`;
    console.error(head);
    for (const s of p.sites) console.error(`        ${s}`);
  }
  console.error("");
  return 1;
}

process.exit(main());
