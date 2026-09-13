#!/usr/bin/env node
/**
 * gen-architecture.js — regenerates the ⚙ sections of docs/ARCHITECTURE.md from the code.
 *
 * Why this exists: CLAUDE.md drifted until it was wrong on 13 of ~22 checkable structural
 * claims (Sep 13 2026 review), and every session read it first. A hand-maintained map of a
 * codebase this size is a map that will be wrong again in a month. So the parts that CAN be
 * derived are derived, and CI fails when the committed file disagrees (`--check`).
 *
 * Hand-written sections live between <!-- HAND:START --> / <!-- HAND:END --> markers and are
 * preserved verbatim across regeneration. Everything else is rewritten.
 *
 * No dependencies — plain fs + regex, so it runs anywhere `node` does.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "docs", "ARCHITECTURE.md");
const rd = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

// ─── Route map ────────────────────────────────────────────────────────────────
function routeMap() {
  const server = rd("src/server.js");
  const mounts = new Map(); // prefix -> [file]
  const re = /app\.use\(\s*["'`](\/api\/[^"'`]*|\/[^"'`]*)["'`]\s*,\s*(?:require\(\s*["'`]\.\/([^"'`]+)["'`]\s*\)|(\w+))\s*\)/g;
  let m;
  while ((m = re.exec(server))) {
    const prefix = m[1];
    let file = m[2] ? `src/${m[2]}.js`.replace(/\.js\.js$/, ".js") : `(var: ${m[3]})`;
    if (m[2]) {
      const p1 = `src/${m[2]}.js`, p2 = `src/${m[2]}/index.js`;
      file = exists(p1) ? p1 : exists(p2) ? `src/${m[2]}/` : p1;
    }
    if (!mounts.has(prefix)) mounts.set(prefix, []);
    mounts.get(prefix).push(file);
  }
  // resolve variable mounts by looking for `const X = require("./routes/y")`
  for (const [prefix, files] of mounts) {
    mounts.set(prefix, files.map((f) => {
      const v = f.match(/^\(var: (\w+)\)$/);
      if (!v) return f;
      const dm = server.match(new RegExp(`const\\s+${v[1]}\\s*=\\s*require\\(\\s*["'\`]\\.\\/([^"'\`]+)["'\`]`));
      return dm ? `src/${dm[1]}.js` : f;
    }));
  }
  const countRoutes = (file) => {
    const target = file.endsWith("/") ? file : file;
    let files = [];
    if (target.endsWith("/")) {
      files = fs.readdirSync(path.join(ROOT, target)).filter((f) => f.endsWith(".js")).map((f) => target + f);
    } else if (exists(target)) files = [target];
    let n = 0;
    for (const f of files) {
      const src = rd(f);
      n += (src.match(/^\s*router\.(get|post|put|patch|delete)\(/gm) || []).length;
    }
    return n;
  };
  const rows = [];
  for (const [prefix, files] of [...mounts].sort((a, b) => a[0].localeCompare(b[0]))) {
    // Only real route modules. `app.use("/api", verifyCsrf)` and the rate limiters are
    // middleware, not routers — listing them made every limited prefix look multi-file.
    const uniq = [...new Set(files)].filter((f) => !/^\(var: /.test(f) && (exists(f) || f.endsWith("/")));
    if (!uniq.length) continue;
    const total = uniq.reduce((s, f) => s + countRoutes(f), 0);
    rows.push({ prefix, files: uniq, total, multi: uniq.length > 1 });
  }
  let out = "| Prefix | File(s) | Routes | |\n|---|---|---:|---|\n";
  for (const r of rows) {
    out += `| \`${r.prefix}\` | ${r.files.map((f) => `\`${f}\``).join(" **+** ")} | ${r.total} | ${r.multi ? "⚠️ **multi-file mount — routes for this prefix live in more than one file**" : ""} |\n`;
  }
  const grand = rows.reduce((s, r) => s + r.total, 0);
  return { md: out, grand, mounts: rows.length };
}

/**
 * Index of the `)` that closes the `(` at openIdx, skipping strings, template literals and
 * comments. Line-regex approaches got this wrong: a nested `}, 60 * 1000);` inside a poller
 * body looks exactly like the timer's own closing line, which gave every job a 1-minute
 * interval in the first version of this file.
 */
function matchParen(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === "/" && n === "/") { const e = src.indexOf("\n", i); if (e === -1) return -1; i = e; continue; }
    if (c === "/" && n === "*") { const e = src.indexOf("*/", i + 2); if (e === -1) return -1; i = e + 1; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      for (i++; i < src.length; i++) {
        if (src[i] === "\\") { i++; continue; }
        if (src[i] === q) break;
      }
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Top-level (depth-0) comma positions inside `body`, same string/comment skipping. */
function topLevelCommas(body) {
  const out = [];
  let d = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i], n = body[i + 1];
    if (c === "/" && n === "/") { const e = body.indexOf("\n", i); if (e === -1) break; i = e; continue; }
    if (c === "/" && n === "*") { const e = body.indexOf("*/", i + 2); if (e === -1) break; i = e + 1; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      for (i++; i < body.length; i++) { if (body[i] === "\\") { i++; continue; } if (body[i] === q) break; }
      continue;
    }
    if ("([{".includes(c)) d++;
    else if (")]}".includes(c)) d--;
    else if (c === "," && d === 0) out.push(i);
  }
  return out;
}

// ─── Background jobs ──────────────────────────────────────────────────────────
function pollers() {
  const server = rd("src/server.js");
  const lines = server.split("\n");
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/(setInterval|setTimeout)\(\s*guardedPoller\(\s*(\d+)\s*,/);
    if (!m) continue;
    // Interval: parse the timer call properly and take its LAST top-level argument.
    const absIdx = lines.slice(0, i).join("\n").length + (i ? 1 : 0) + lines[i].indexOf(m[1]);
    const openIdx = server.indexOf("(", absIdx);
    const closeIdx = matchParen(server, openIdx);
    let raw = null;
    if (closeIdx > openIdx) {
      const body = server.slice(openIdx + 1, closeIdx);
      const commas = topLevelCommas(body);
      if (commas.length) {
        let last = body.slice(commas[commas.length - 1] + 1).trim();
        // The interval is often a named constant (NOTIFICATION_POLL_INTERVAL) — resolve it.
        if (/^[A-Z_][A-Z0-9_]*$/.test(last)) {
          const dm = server.match(new RegExp("const\\s+" + last + "\\s*=\\s*([0-9][0-9_\\s*]*);"));
          if (dm) last = dm[1].trim();
        }
        if (/^[0-9][0-9_\s*]*$/.test(last)) raw = last;
      }
    }
    let human = "?";
    if (raw) {
      const expr = raw.replace(/[\s_]/g, "");
      let ms = NaN;
      if (/^[0-9*]+$/.test(expr)) ms = expr.split("*").reduce((a, b) => a * Number(b), 1);
      human = Number.isFinite(ms)
        ? (ms >= 3600000 ? `${+(ms / 3600000).toFixed(2)} h` : ms >= 60000 ? `${+(ms / 60000).toFixed(2)} min` : `${+(ms / 1000).toFixed(0)} s`)
        : expr;
    }
    // Name: walk to the TOP of the contiguous comment block above the timer and take its
    // heading. These blocks are long narrative comments, so the nearest line above is usually
    // the tail of a story ("…auto-charges the family's saved card"), not a name.
    let name = "";
    // Prefer the nearest `// ─── Heading ───` banner. The narrative comment block directly
    // above a timer is often separated from it by `const` declarations, and its last line is
    // the tail of a story rather than a name.
    for (let k = i - 1; k >= Math.max(0, i - 30); k--) {
      const b = lines[k].match(/^\s*\/\/\s*─+\s*(.+?)\s*─+\s*$/);
      if (b && b[1].trim().length > 3) { name = b[1].trim().replace(/\|/g, "\\|"); break; }
    }
    let top = -1;
    for (let k = i - 1; k >= 0; k--) {
      const t = lines[k].trim();
      if (t.startsWith("//")) { top = k; continue; }
      if (t === "") { if (top !== -1) break; continue; }
      break;
    }
    if (!name && top !== -1) {
      for (let k = top; k < i; k++) {
        const c = lines[k].match(/^\s*\/\/\s*(?:─+\s*)?(.+?)\s*(?:─+\s*)?$/);
        if (!c) continue;
        const txt = c[1].trim().replace(/^v[0-9.]+\s*[—–-]\s*/, "").trim();
        if (txt && txt.length > 3) { name = txt.replace(/\|/g, "\\|"); break; }
      }
    }
    if (name.length > 90) name = name.slice(0, 87) + "…";
    rows.push({ lock: m[2], kind: m[1], name: name || "(see src/server.js:" + (i + 1) + ")", interval: human, line: i + 1 });
  }
  const byLock = new Map();
  for (const r of rows) {
    if (!byLock.has(r.lock)) byLock.set(r.lock, r);
    else if (r.kind === "setInterval") byLock.set(r.lock, r); // prefer the recurring one over a warm-up setTimeout
  }
  const uniq = [...byLock.values()].sort((a, b) => Number(a.lock) - Number(b.lock));
  let out = "| Lock | Job | Interval | Declared |\n|---:|---|---|---|\n";
  for (const r of uniq) out += `| ${r.lock} | ${r.name} | ${r.interval} | \`src/server.js:${r.line}\` |\n`;
  return { md: out, count: uniq.length };
}

// ─── Realtime: emit → listener ────────────────────────────────────────────────
function realtime() {
  const srcFiles = walk("src").filter((f) => f.endsWith(".js"));
  const cliFiles = walk("public/js").filter((f) => f.endsWith(".js"));
  const emits = new Map();
  // covers: emitToUser(id, "name", …) · io.to(x).emit("name") · socket.emit("name") · emit(uid, "name")
  const EMIT = /(?:emitTo\w*\(\s*[^,()]+(?:\([^()]*\))?[^,]*,\s*|\.emit\(\s*)["'`]([a-z_][a-z0-9_]*)["'`]/gi;
  for (const f of srcFiles) {
    const s = rd(f);
    let m;
    EMIT.lastIndex = 0;
    while ((m = EMIT.exec(s))) {
      if (!emits.has(m[1])) emits.set(m[1], new Set());
      emits.get(m[1]).add(f);
    }
  }
  const listened = new Set();
  for (const f of cliFiles) {
    const s = rd(f);
    let m;
    const re = /(?:onSocketEvent|socket\.on|\.on)\(\s*["'`]([a-z_][a-z0-9_]*)["'`]/gi;
    while ((m = re.exec(s))) listened.add(m[1]);
  }
  const serverHandled = new Set();
  for (const f of srcFiles) {
    const s = rd(f);
    let m;
    const re = /socket\.on\(\s*["'`]([a-z_][a-z0-9_]*)["'`]/gi;
    while ((m = re.exec(s))) serverHandled.add(m[1]);
  }
  const names = [...emits.keys()].sort();
  const orphans = names.filter((n) => !listened.has(n) && !serverHandled.has(n));
  let out = "| Event | Emitted from | Client listener? |\n|---|---|---|\n";
  for (const n of names) {
    const from = [...emits.get(n)].slice(0, 2).map((f) => `\`${f.replace(/^src\//, "")}\``).join(", ");
    out += `| \`${n}\` | ${from} | ${listened.has(n) ? "yes" : serverHandled.has(n) ? "server-handled" : "🔶 **none**"} |\n`;
  }
  return { md: out, total: names.length, orphans: orphans.length, orphanList: orphans };
}

// ─── Push types ───────────────────────────────────────────────────────────────
function pushTypes() {
  const files = walk("src").filter((f) => f.endsWith(".js"));
  const types = new Set();
  for (const f of files) {
    const s = rd(f);
    let m;
    const re1 = /sendPushToUser\([^)]*?,\s*["'`]([a-z_][a-z0-9_]*)["'`]\s*\)/g;
    while ((m = re1.exec(s))) types.add(m[1]);
    const re2 = /notify(?:Admins|Parties)\(\s*["'`]([a-z_][a-z0-9_]*)["'`]/g;
    while ((m = re2.exec(s))) types.add(m[1]);
    const re3 = /eventType:\s*["'`]([a-z_][a-z0-9_]*)["'`]/g;
    while ((m = re3.exec(s))) types.add(m[1]);
  }
  const list = [...types].sort();
  const chunk = [];
  for (let i = 0; i < list.length; i += 4) chunk.push(list.slice(i, i + 4).map((t) => `\`${t}\``).join(" · "));
  return { md: chunk.join("\n\n"), count: list.length };
}

// ─── window.__* client globals ────────────────────────────────────────────────
function clientGlobals() {
  const files = walk("public/js").filter((f) => f.endsWith(".js"));
  const writes = new Map();
  const reads = new Map();
  for (const f of files) {
    const s = rd(f);
    let m;
    const w = /window\.(__[A-Za-z0-9_]+)\s*=/g;
    while ((m = w.exec(s))) { if (!writes.has(m[1])) writes.set(m[1], new Set()); writes.get(m[1]).add(f.split("/").pop()); }
    const r = /window\.(__[A-Za-z0-9_]+)/g;
    while ((m = r.exec(s))) reads.set(m[1], (reads.get(m[1]) || 0) + 1);
  }
  const names = [...new Set([...writes.keys(), ...reads.keys()])].sort();
  let out = "| Global | Written by | Total refs |\n|---|---|---:|\n";
  for (const n of names) {
    const w = writes.get(n) ? [...writes.get(n)].slice(0, 3).join(", ") : "—";
    out += `| \`window.${n}\` | ${w} | ${reads.get(n) || 0} |\n`;
  }
  return { md: out, count: names.length };
}

// ─── helpers ──────────────────────────────────────────────────────────────────
function walk(dir, acc = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return acc;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, acc);
    else acc.push(rel);
  }
  return acc;
}
function countTables() {
  const s = rd("src/models/database.js");
  return (s.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)/g) || []).length;
}
function appVersion() {
  const s = rd("src/server.js");
  const m = s.match(/APP_VERSION\s*=\s*["'`]([^"'`]+)["'`]/);
  return m ? m[1] : "unknown";
}

// ─── assemble ─────────────────────────────────────────────────────────────────
const rm = routeMap(), pl = pollers(), rt = realtime(), pt = pushTypes(), cg = clientGlobals();

const HAND_DEFAULT = `<!-- HAND:START -->
## 3. Where is…

The index that makes a bug report into one hop. Add a row whenever you spend more than two
greps finding something.

| Task | Go to |
|---|---|
| The check-in gate (why a button is disabled) | \`src/constants/checkIn.js\` is the intended single owner. Today the 15-minute rule is duplicated in \`src/routes/sessions.js\`, \`public/js/components/CaretakerHub.js\` (×2) and \`CaregiverCalendar.js\` — the button itself is gated by \`readyToCheckIn\` in CaretakerHub |
| Cancellation and the cancellation fee | \`src/routes/sessions.js\` \`/:id/cancel\`, \`/:id/cancel-preview\`; fee math in \`src/utils/cancellationFee.js\` |
| Sending a push | \`src/routes/push.js\` → \`sendPushToUser(userId, payload, eventType)\`. **This file is a library, required by ~23 others.** \`src/utils/push.js\` is a legacy adapter with a different signature — do not use it for new code |
| Authorization ("can this user touch this row?") | \`src/utils/access.js\` → \`sessionAccess()\`, \`recipientAccess()\`. Failed checks answer **404, not 403** |
| Pay calculation | server-side only, \`src/utils/rateCalculator.js\`; check-in→check-out in 15-minute blocks |
| The identity gate | \`src/utils/identityDecision.js\`. **The AI never writes \`approved\`; only an admin does** |
| Session status machine | \`validTransitions\` in \`src/routes/sessions.js\` |
| Reimbursement approve | \`src/routes/reimbursements.js\` \`/:id/approve\` — writes the row, then \`audit()\`, \`feedEntry()\`, \`notifyParties()\` |
| "Am I production?" | \`src/utils/env.js\` — the only place that decides. Never gate on \`NODE_ENV\`; Railway does not set it |
| Timezone conversion | \`src/utils/timezone.js\` server, \`TimezoneHelper.js\` client. All times are **care-location** times |
| Blob storage | \`src/utils/storage.js\` → \`storeFileData()\`, \`resolveFileData()\`. R2-backed, \`r2:<key>\` markers, legacy base64 rows still readable |
<!-- HAND:END -->`;

let hand = HAND_DEFAULT;
if (fs.existsSync(OUT)) {
  const prev = fs.readFileSync(OUT, "utf8");
  const m = prev.match(/<!-- HAND:START -->[\s\S]*?<!-- HAND:END -->/);
  if (m) hand = m[0];
}

const md = `# InPlace — Architecture

**Generated by \`scripts/gen-architecture.js\`. Sections marked ⚙ are rewritten by that script —
do not hand-edit them.** CI runs \`npm run gen:architecture -- --check\` and fails if this file
disagrees with the code, so a new route, poller or socket event that is missing here turns the
build red.

Hand-written sections (§3 "Where is…") are preserved across regeneration; edit those freely.

At generation time: **APP_VERSION ${appVersion()}** · ${rm.grand} HTTP routes across ${rm.mounts} mounts ·
${countTables()} \`CREATE TABLE\` statements · ${pl.count} background jobs · ${rt.total} socket events
(${rt.orphans} with no client listener) · ${pt.count} push event types · ${cg.count} \`window.__*\` globals.

---

## 1. The request path

\`\`\`
public/index.html
  → /vendor/*.js (React, socket.io, leaflet — self-hosted, NOT a CDN)
  → /js-compiled/bundle.js        (built by scripts/build-client.js: Babel + terser)
     └── bundle-admin.js is lazy-loaded, admins only
  → apiFetch()  [public/js/utils.js]  — 25 s timeout, single-flight 401→refresh→retry
     → Express  [src/server.js]
        malformed-URL guard → helmet → CORS → cookie-parser → Sentry user tag
        → route-scoped express.json limits → global 100 kb → limitBodySize
        → authLimiter / apiLimiter → static → request log → verifyCsrf → auditLog
        → routers (§2)
\`\`\`

**There is a build step.** \`npm start\` runs \`scripts/build-client.js\` before the server starts.
JSX is *not* compiled in the browser; Babel-standalone is not loaded. Editing anything in
\`public/js/\` requires a rebuild (\`node scripts/build-client.js\`) before it reaches a browser.

---

## 2. Route map ⚙

${rm.md}
---

${hand}

---

## 4. Background jobs ⚙

Every job runs through \`guardedPoller\` → \`withPollerLock\` (\`src/models/database.js\`), which takes a
\`pg_try_advisory_lock\` so a job can never overlap itself or run twice.

${pl.md}
---

## 5. Realtime ⚙

Socket.io, JWT-authenticated at the handshake. \`connectedUsers\` is an **in-process** \`Map\`, which is
why this app runs on exactly one Railway replica.

${rt.md}
${rt.orphans ? `\n🔶 **${rt.orphans} event(s) are emitted with no client listener**: ${rt.orphanList.map((o) => `\`${o}\``).join(", ")}. Either the feature is unfinished or the emit is dead code.\n` : ""}
---

## 6. Push event types ⚙

Opt-out key is \`notification_prefs["push_" + eventType]\`. Capability gating lives in
\`src/utils/pushPermission.js\`; tap routing in \`window.__handlePushNavigate\` (\`public/js/app.js\`).

${pt.md}

---

## 7. Client globals ⚙

State travels through \`window\`, not props. This table is the registry.

${cg.md}
---

## 8. Data rules

- **Schema changes go in \`MIGRATIONS_V2\`** (\`src/models/database.js\`), keyed in \`schema_migrations\`.
  ⚠️ The legacy \`migrations\` array above it is **frozen** as \`000_legacy_baseline\` and never replays
  on an existing database. Anything added there after v1.82.0 has never run on prod or staging.
- All times are **care-location** times. Use \`getNowInZone\`/\`buildDateTimeInZone\`; never
  \`new Date().toISOString().split('T')[0]\`.
- Any endpoint taking base64 needs **both** a route-scoped \`express.json\` limit in \`server.js\`
  **and** a \`limitBodySize\` exemption in \`validate.js\`.
- Blobs go through \`src/utils/storage.js\`, never straight into a Postgres column.

## 9. Tests and gates

\`\`\`bash
npm run lint:client && npm run lint:requires && npm run lint:sql-columns && npm run lint:contrast
npm test                    # unit
npm run test:integration    # embedded PostgreSQL
npm run gen:architecture -- --check   # this file is current
\`\`\`

⚠️ \`npm test -- <name>\` does **not** filter — the script ends in \`--testPathIgnorePatterns\`, so your
argument is appended to *that* and the named test is **excluded**. Use \`npx jest tests/<file>\`.
`;

if (process.argv.includes("--check")) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (cur.trim() !== md.trim()) {
    console.error("✗ docs/ARCHITECTURE.md is out of date.\n  Run: npm run gen:architecture\n");
    process.exit(1);
  }
  console.log("✓ docs/ARCHITECTURE.md is current");
  process.exit(0);
}
fs.writeFileSync(OUT, md);
console.log(`✓ docs/ARCHITECTURE.md written — ${rm.grand} routes, ${pl.count} jobs, ${rt.total} socket events (${rt.orphans} orphaned), ${pt.count} push types, ${cg.count} globals`);
