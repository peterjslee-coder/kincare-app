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
const espree = require("espree");

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
// Every capitalised name used as a JSX element anywhere in the bundle. Shared by the
// undefined-JSX check and the unreachable-function filter.
function collectJsxUsedNames(combinedSource) {
  const out = new Set();
  for (const m of combinedSource.matchAll(/<([A-Z][A-Za-z0-9_]*)(?=[\s/>])/g)) out.add(m[1]);
  return out;
}

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

// ─── v1.105.72: functions that are written but never wired to anything ───
//
// A handler that no button calls and a feature nobody enabled look identical from the
// outside. This is the client-side twin of the wrong-column-name class: the code is
// present, correct, maintained — and unreachable.
//
// The four that prompted this, each confirmed by a repo-wide grep that found only the
// definition:
//
//   CaretakerHub.handleIdentityVerify   the caregiver's own identity action — and it called
//                                       STRIPE Identity, the third system v1.105.64 established
//                                       nothing gates on
//   CaretakerHub.handleStripeOnboard    payout setup, superseded by MyAccount.handleConnectStripe
//   CaretakerHub.handleCancelJob        superseded by FindWork's live copy
//   CaretakerHub.saveStoplight          superseded by MyAccount.handleSavePreferences
//   MyAccount.handleSaveRates           twin of FindWork's wired copy — and v1.105.51 edited
//                                       THIS one, the dead one, to add an else branch. A past
//                                       session did careful maintenance on code that cannot run.
//   CareProfile.saveSummaryEdit         an entire edit-care-summary feature, PUT call and all,
//                                       with no entry point anywhere
//
// This is also exactly the handleOpenStripeDashboard incident named at the top of this file,
// caught from the other direction: that one was CALLED but not DECLARED (no-undef), these are
// DECLARED but never called.
//
// WHY FUNCTIONS ONLY. Enabling no-unused-vars wholesale reports 224 findings, 139 after
// discounting JSX-used components and window exports. Most of the remainder are unused useState
// values — real clutter, occasionally a real bug, but too noisy to gate on today and tracked
// separately in TASKS.md. A gate that cries wolf gets switched off, and then it protects
// nothing. Functions are the unambiguous case: a function nobody calls does nothing, always.
//
// Two escapes, both deliberate: a name used in JSX (`<Foo/>` — ESLint cannot see JSX without
// the react plugin) and a name assigned to `window.` (the app's cross-file export mechanism).

function collectFunctionNames(combinedSource) {
  // Parse with the SAME parser and options ESLint just used, so the two agree on what the
  // source even is. A name counts if it is bound directly to a function: `function foo()`,
  // `const foo = () => {}`, `const foo = function () {}`.
  let ast;
  try {
    ast = espree.parse(combinedSource, {
      ecmaVersion: 2022, sourceType: "script", ecmaFeatures: { jsx: true }, loc: false,
    });
  } catch {
    // If it will not parse, say nothing rather than guess. ESLint's own errors will surface.
    return null;
  }
  const names = new Set();
  const FN = new Set(["ArrowFunctionExpression", "FunctionExpression"]);
  (function walk(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node.type === "FunctionDeclaration" && node.id) names.add(node.id.name);
    if (node.type === "VariableDeclarator" && node.id && node.id.type === "Identifier" &&
        node.init && FN.has(node.init.type)) names.add(node.id.name);
    for (const k of Object.keys(node)) {
      if (k === "parent") continue;
      const v = node[k];
      if (v && typeof v === "object") walk(v);
    }
  })(ast);
  return names;
}

// Names the bundle exports across files via `window.Foo = ...` — used, just not lexically.
function collectWindowExports(combinedSource) {
  const out = new Set();
  for (const m of combinedSource.matchAll(/window\.([A-Za-z0-9_$]+)\s*=/g)) out.add(m[1]);
  return out;
}

// ─── v1.105.87: a hook after an early return ───
//
// CaretakerHub early-returns a spinner while it loads. v1.105.84 added three useState calls
// BELOW that return. On the loading render they never ran; on the next render they did, so
// React saw more hooks than the previous render and threw "Rendered more hooks than during the
// previous render." Julia got a white screen, and Sentry had eight events inside six minutes.
//
// eslint-plugin-react-hooks cannot help here: every component in this codebase is declared as
// `const Foo = window.Foo = (...) => {}`, so the rule sees the name "window.Foo", decides it is
// not a component, and reports 1,467 false positives. This checks the precise thing that broke.
//
// It looks only at TOP-LEVEL statements of a function body: a return at that level ends the
// render for good, so any hook after it is conditional by construction. Hooks inside nested
// callbacks are somebody else's rule and are left alone.
const HOOK_RE = /^(use[A-Z]\w*)$/;

function findHooksAfterEarlyReturn(files, PUBLIC) {
  const findings = [];

  const hookNameOf = (node) => {
    if (!node || node.type !== "CallExpression") return null;
    const c = node.callee;
    if (c.type === "Identifier" && HOOK_RE.test(c.name)) return c.name;
    // React.useState(...)
    if (c.type === "MemberExpression" && !c.computed && c.property.type === "Identifier" && HOOK_RE.test(c.property.name)) {
      return `${c.object.name || "React"}.${c.property.name}`;
    }
    return null;
  };

  // A top-level statement that can return out of the function: `if (x) return y;`,
  // `if (x) { return y; }`, a switch with returns. Nested functions are NOT counted — their
  // returns end the callback, not the render.
  const containsReturn = (node) => {
    let found = false;
    (function walk(n) {
      if (found || !n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      if (n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression" || n.type === "FunctionDeclaration") return;
      if (n.type === "ReturnStatement") { found = true; return; }
      for (const k of Object.keys(n)) { const v = n[k]; if (v && typeof v === "object") walk(v); }
    })(node);
    return found;
  };

  const scanBody = (body, file, onFinding) => {
    if (!Array.isArray(body)) return;
    let returnedAt = null;
    for (const stmt of body) {
      if (returnedAt !== null) {
        // Look for hook calls anywhere inside this statement, but not through nested functions.
        (function walk(n) {
          if (!n || typeof n !== "object") return;
          if (Array.isArray(n)) return n.forEach(walk);
          if (n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression" || n.type === "FunctionDeclaration") return;
          const name = hookNameOf(n);
          if (name) onFinding({ file, line: n.loc.start.line, name, returnedAt });
          for (const k of Object.keys(n)) { const v = n[k]; if (v && typeof v === "object") walk(v); }
        })(stmt);
      } else if (stmt.type === "ReturnStatement") {
        returnedAt = stmt.loc.start.line;
      } else if (containsReturn(stmt)) {
        // The case that actually broke: `if (loading) return <LoadingSpinner/>;`. A CONDITIONAL
        // early return is the whole point — the first version of this gate only looked for a
        // bare ReturnStatement, missed exactly the bug it was written for, and reported green
        // against a deliberately planted regression.
        returnedAt = stmt.loc.start.line;
      }
    }
  };

  for (const rel of files) {
    const abs = path.join(PUBLIC, rel);
    if (!fs.existsSync(abs)) continue;
    let ast;
    try {
      ast = espree.parse(fs.readFileSync(abs, "utf8"), {
        ecmaVersion: 2022, sourceType: "script", ecmaFeatures: { jsx: true }, loc: true,
      });
    } catch { continue; }   // a parse failure is lint:client's other checks' problem, not this one
    (function walk(n) {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      if ((n.type === "ArrowFunctionExpression" || n.type === "FunctionExpression" || n.type === "FunctionDeclaration")
          && n.body && n.body.type === "BlockStatement") {
        scanBody(n.body.body, rel, (f) => findings.push(f));
      }
      for (const k of Object.keys(n)) { const v = n[k]; if (v && typeof v === "object") walk(v); }
    })(ast);
  }
  return findings;
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
        // v1.105.72 — see findUnreachableFunctions. Reported here, then filtered down to
        // function-valued bindings only; unused plain values are a separate (noisier) class.
        "no-unused-vars": ["error", { args: "none", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
      },
    },
  });

  const results = await eslint.lintText(combined, { filePath: path.join(PUBLIC, "js", "__combined__.js") });
  const messages = (results[0] && results[0].messages) || [];
  let allErrors = messages.filter((m) => m.severity === 2).map((e) => ({ ...e, loc: locate(e.line) }));

  // ── Narrow no-unused-vars down to unreachable FUNCTIONS (see collectFunctionNames) ──
  const fnNames = collectFunctionNames(combined);
  const jsxUsed = collectJsxUsedNames(combined);
  const winExports = collectWindowExports(combined);
  allErrors = allErrors.filter((e) => {
    if (e.ruleId !== "no-unused-vars") return true;
    const id = (e.message.match(/'([^']+)'/) || [])[1];
    if (!id) return false;
    if (fnNames === null) return false;       // parse failed — report nothing from this rule
    if (!fnNames.has(id)) return false;       // not a function: the noisy class, tracked in TASKS.md
    if (jsxUsed.has(id)) return false;        // <Foo/> — ESLint cannot see JSX references
    if (winExports.has(id)) return false;     // window.Foo = ... — cross-file export
    return true;
  });

  const baselined = allErrors.filter((e) => isBaselined(e.loc.file, e.ruleId, e.message));
  const errors = allErrors.filter((e) => !isBaselined(e.loc.file, e.ruleId, e.message));

  const baseNote = baselined.length ? ` (${baselined.length} known baseline finding(s) ignored — see BASELINE in lint-client.js)` : "";

  const missingJsx = findUndefinedJsxComponents(combined, locate);
  const lateHooks = findHooksAfterEarlyReturn(files, PUBLIC);

  if (errors.length === 0 && missingJsx.length === 0 && lateHooks.length === 0) {
    console.log(`  [lint] ✓ ${files.length} client files, no NEW undeclared identifiers / dupe keys / dead code / undefined JSX components / unreachable functions / late hooks${baseNote}`);
    return 0;
  }

  if (errors.length) {
    console.error(`\n  [lint] ✗ ${errors.length} NEW error(s) in the client bundle${baseNote}:\n`);
    for (const e of errors) {
      const note = e.ruleId === "no-unused-vars"
        ? "  ← declared but never called: wire it up or delete it"
        : "";
      console.error(`    ${e.loc.file}:${e.loc.line}  ${e.ruleId}  ${e.message}${note}`);
    }
  }
  if (missingJsx.length) {
    console.error(`\n  [lint] ✗ ${missingJsx.length} JSX component(s) used but never declared — these throw on render:\n`);
    for (const m of missingJsx) {
      console.error(`    ${m.loc.file}:${m.loc.line}  <${m.name}> is not defined anywhere in the bundle`);
    }
  }
  if (lateHooks.length) {
    console.error(`\n  [lint] \u2717 ${lateHooks.length} React hook(s) called AFTER an early return — these throw "Rendered more hooks than during the previous render":\n`);
    for (const h of lateHooks) {
      console.error(`    ${h.file}:${h.line}  ${h.name}() runs only when the function gets past the return on line ${h.returnedAt}`);
    }
  }
  console.error("");
  return 1;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error("  [lint] runner failed:", err.message);
  process.exit(1);
});
