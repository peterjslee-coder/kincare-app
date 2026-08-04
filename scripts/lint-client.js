#!/usr/bin/env node
// ─── Client lint pass (v1.104.x) ───
// The client is compiled in-browser by Babel with NO build-time checks, so an
// undeclared identifier (e.g. an onClick wired to a function that doesn't
// exist) ships silently and throws at render — a white screen — which our
// server-side Sentry can't see. See the handleOpenStripeDashboard incident.
//
// The app's architecture concatenates every js/ file into ONE shared scope,
// so we lint the SAME concatenation: cross-component references (a component
// declared in one file, used in another) resolve correctly, and `no-undef`
// flags only genuinely-undeclared names. Line numbers are mapped back to the
// original file via an offset table.
//
// Usage: node scripts/lint-client.js   (exit 1 on any error)

const fs = require("fs");
const path = require("path");
const { ESLint } = require("eslint");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

// ── Pull the exact file list build-client.js uses (parse, don't execute —
//    requiring build-client.js would kick off a real build) ──
function extractArray(src, name) {
  const m = src.match(new RegExp("const\\s+" + name + "\\s*=\\s*\\[([\\s\\S]*?)\\]", "m"));
  if (!m) throw new Error("Could not find array " + name + " in build-client.js");
  return m[1]
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").trim())        // strip line comments
    .map((l) => (l.match(/["']([^"']+)["']/) || [])[1]) // pull the quoted path
    .filter(Boolean);
}

const buildSrc = fs.readFileSync(path.join(ROOT, "scripts", "build-client.js"), "utf8");
const mainScripts = extractArray(buildSrc, "scripts");
const adminScripts = extractArray(buildSrc, "ADMIN_SCRIPTS");
// Admin bundle loads after main at runtime and shares the global scope, so lint
// them in one concatenation (main first) for correct cross-scope resolution.
const files = [...mainScripts, ...adminScripts];

// ── Concatenate with an offset table (combined line -> original file/line) ──
let combined = "";
const offsets = []; // { start, end, file }
for (const rel of files) {
  const abs = path.join(PUBLIC, rel);
  if (!fs.existsSync(abs)) {
    console.error(`  [lint] listed file missing on disk: ${rel}`);
    process.exit(1);
  }
  const text = fs.readFileSync(abs, "utf8");
  // Line where this file's first character lands in `combined` (1-based).
  const start = combined.length === 0 ? 1 : combined.split("\n").length;
  const lines = text.split("\n").length;
  offsets.push({ start, end: start + lines - 1, file: rel });
  combined += text + "\n"; // single newline separator between files
}
function locate(combinedLine) {
  const seg = offsets.find((o) => combinedLine >= o.start && combinedLine <= o.end);
  if (!seg) return { file: "?", line: combinedLine };
  return { file: seg.file, line: combinedLine - seg.start + 1 };
}

// ── Real external globals the concatenated app relies on (everything else is
//    declared within the concatenation itself and resolves via scope) ──
const EXTERNAL_GLOBALS = {
  React: "readonly", ReactDOM: "readonly",
  SimpleWebAuthnBrowser: "readonly",
  io: "readonly",            // socket.io client
  L: "readonly",             // Leaflet
  Stripe: "readonly", StripeConnect: "readonly", // Stripe.js + Connect.js
  Twilio: "readonly",        // Twilio Video SDK
  Capacitor: "readonly",     // native shell
  plausible: "readonly", Plausible: "readonly",
  module: "writable",        // components use `const X = window.X =` + occasional module.exports guards
  PublicKeyCredential: "readonly", // WebAuthn browser global (eslint's browser env omits it)
  // showToast is a ToastProvider context value; components access it either via
  // useToast() or the `typeof showToast === 'function' && showToast(...)` optional
  // pattern. Treat as an app-provided global so the pass stays focused on the
  // crash class (an UNGUARDED undeclared identifier, e.g. handleOpenStripeDashboard).
  showToast: "readonly",
};

// ── Baseline: pre-existing findings that need domain intent to fix safely
//    (admin refresh / invite-boot flows). The gate fails on any NEW finding but
//    not these — burn the list down over time; never add to it to dodge a fix.
//    Matched by file + rule + identifier (line-independent, so it survives edits).
//    v1.105.32 — `savedToken` and `loadAlerts` burned down. Both were real crashes, not
//    style: the first threw on every invite-link arrival and abandoned the rest of the boot
//    effect; the second threw on every admin BG-check approve/reject and safety-flag review.
//    One entry left, and it is the only genuinely safe one — it is typeof-guarded.
const BASELINE = [
  { file: "js/components/CareRecipients.js", rule: "no-undef", id: "onNavigate" }, // typeof-guarded (safe); prop not threaded to this subtree
];
function isBaselined(file, rule, message) {
  return BASELINE.some((b) => b.file === file && b.rule === rule && message.includes(`'${b.id}'`));
}

// ── v1.105.34: undefined JSX components ──
//
// `no-undef` does NOT see JSX element names. Renaming ReceiptViewer → AttachmentViewer left
// `<ReceiptThumb>` behind in Reimbursements.js and every gate stayed green: the lint passed,
// 378 unit tests passed, the bundle built. It would have shipped a component that throws
// "ReceiptThumb is not defined" on render — a white screen on the money page — and the
// `typeof X !== 'undefined'` guard next to it would have silently rendered nothing forever.
//
// Same silent-failure family as the lazy requires and the dead dark-mode CSS: invisible in
// source, invisible to tests, only visible when a user opens the page. So: every capitalised
// JSX element in the bundle must resolve to something the bundle actually declares.
function findUndefinedJsxComponents(combinedSource, locate) {
  // Scan with line-owning comments blanked, not removed: a file's own prose names components
  // it does not use (`Promise<File>` in a utils.js doc comment was the first false positive),
  // and deleting the lines outright would shift every reported line number.
  //
  // Blanking, and only for lines that OWN the comment, is deliberate. A global
  // `/\*[\s\S]*?\*\//` replace would read the `/*` inside `accept="image/*,application/pdf"`
  // as a comment opener and swallow ~9,000 characters of real code — see
  // tests/helpers/source.js, which learned this the hard way.
  let inBlock = false;
  const scannable = combinedSource.split("\n").map((line) => {
    const t = line.trim();
    if (inBlock) { if (t.includes("*/")) inBlock = false; return ""; }
    if (t.startsWith("//")) return "";
    if (t.startsWith("/*") || t.startsWith("{/*")) { if (!t.includes("*/")) inBlock = true; return ""; }
    return line;
  }).join("\n");

  const declared = new Set(Object.keys(EXTERNAL_GLOBALS));
  // `const Foo = ...`, `function Foo(`, `class Foo`, `window.Foo = ...`
  for (const re of [
    /(?:const|let|var)\s+([A-Z][A-Za-z0-9_]*)\s*=/g,
    /function\s+([A-Z][A-Za-z0-9_]*)\s*\(/g,
    /class\s+([A-Z][A-Za-z0-9_]*)\b/g,
    /window\.([A-Z][A-Za-z0-9_]*)\s*=/g,
  ]) {
    let m;
    while ((m = re.exec(scannable))) declared.add(m[1]);
  }
  // React.Fragment shorthand, namespaced members (React.x, Recharts.y) and lowercase HTML
  // tags are all fine; only bare capitalised names can dangle.
  const used = new Map();
  const useRe = /<([A-Z][A-Za-z0-9_]*)(?=[\s/>])/g;
  let u;
  while ((u = useRe.exec(scannable))) {
    const name = u[1];
    if (!used.has(name)) used.set(name, scannable.slice(0, u.index).split("\n").length);
  }
  const missing = [];
  for (const [name, line] of used) {
    if (!declared.has(name)) missing.push({ name, loc: locate(line) });
  }
  return missing;
}

async function main() {
  const eslint = new ESLint({
    useEslintrc: false,
    // Only the rule that catches the whole bug class. Kept deliberately narrow
    // so it never blocks a deploy on style — just on genuinely-broken code.
    overrideConfig: {
      root: true,
      env: { browser: true, es2021: true },
      parserOptions: { ecmaVersion: 2022, sourceType: "script", ecmaFeatures: { jsx: true } },
      globals: EXTERNAL_GLOBALS,
      rules: {
        "no-undef": "error",
        "no-dupe-keys": "error",   // silent-overwrite bugs in object literals
        "no-unreachable": "error", // dead code after return/throw
      },
    },
  });

  const results = await eslint.lintText(combined, { filePath: path.join(PUBLIC, "js", "__combined__.js") });
  const messages = (results[0] && results[0].messages) || [];
  const allErrors = messages.filter((m) => m.severity === 2).map((e) => ({ ...e, loc: locate(e.line) }));

  const baselined = allErrors.filter((e) => isBaselined(e.loc.file, e.ruleId, e.message));
  const errors = allErrors.filter((e) => !isBaselined(e.loc.file, e.ruleId, e.message));

  const baseNote = baselined.length ? ` (${baselined.length} known baseline finding(s) ignored — see BASELINE in lint-client.js)` : "";

  const missingJsx = findUndefinedJsxComponents(combined, locate);

  if (errors.length === 0 && missingJsx.length === 0) {
    console.log(`  [lint] ✓ ${files.length} client files, no NEW undeclared identifiers / dupe keys / dead code / undefined JSX components${baseNote}`);
    return 0;
  }

  if (errors.length) {
    console.error(`\n  [lint] ✗ ${errors.length} NEW error(s) in the client bundle${baseNote}:\n`);
    for (const e of errors) {
      console.error(`    ${e.loc.file}:${e.loc.line}  ${e.ruleId}  ${e.message}`);
    }
  }
  if (missingJsx.length) {
    console.error(`\n  [lint] ✗ ${missingJsx.length} JSX component(s) used but never declared — these throw on render:\n`);
    for (const m of missingJsx) {
      console.error(`    ${m.loc.file}:${m.loc.line}  <${m.name}> is not defined anywhere in the bundle`);
    }
  }
  console.error("");
  return 1;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error("  [lint] runner failed:", err.message);
  process.exit(1);
});
