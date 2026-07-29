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
const BASELINE = [
  { file: "js/app.js", rule: "no-undef", id: "savedToken" },              // invite-boot auth check — TODO verify intended auth signal
  { file: "js/components/AdminPanel.js", rule: "no-undef", id: "loadAlerts" }, // admin approve/reject refresh — TODO wire to real loader
  { file: "js/components/CareRecipients.js", rule: "no-undef", id: "onNavigate" }, // typeof-guarded (safe); prop not threaded to this subtree
];
function isBaselined(file, rule, message) {
  return BASELINE.some((b) => b.file === file && b.rule === rule && message.includes(`'${b.id}'`));
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

  if (errors.length === 0) {
    console.log(`  [lint] ✓ ${files.length} client files, no NEW undeclared identifiers / dupe keys / dead code${baseNote}`);
    return 0;
  }

  console.error(`\n  [lint] ✗ ${errors.length} NEW error(s) in the client bundle${baseNote}:\n`);
  for (const e of errors) {
    console.error(`    ${e.loc.file}:${e.loc.line}  ${e.ruleId}  ${e.message}`);
  }
  console.error("");
  return 1;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error("  [lint] runner failed:", err.message);
  process.exit(1);
});
