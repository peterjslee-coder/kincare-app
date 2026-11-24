#!/usr/bin/env node
/**
 * Server-side undefined-identifier gate (v1.106.23).
 *
 * WHY THIS EXISTS
 * ---------------
 * lint-requires.js resolves every relative require() PATH in src/. It cannot see the other
 * half of the same bug: a module that never requires something it uses. `node --check` cannot
 * either — a missing import is valid syntax. So the reference throws only when that exact line
 * runs, and almost every one of them sits inside a try/catch, which turns a crash into a
 * feature that quietly does not exist.
 *
 * The first behavioural test ever written for PUT /sessions/:id/claim found one immediately,
 * and a sweep then found nine more. All ten were live:
 *
 *   utils/assignments.js  `uuid` — every caregiver's first claim for a family failed to
 *                         create the assignment, so she never joined their roster. Introduced
 *                         by v1.106.16 moving the function out of sessions.js without its
 *                         import; the caller logs and continues, so it never surfaced.
 *   routes/payments.js    `stripe` ×6 — declared inside the signature-verification try, used
 *                         in six later lines of the same handler. Payout dates were never
 *                         computed and card details never captured on checkout payments.
 *   routes/messages.js    `captureException` — in the photo route's catch. The ReferenceError
 *                         replaced the 500, so the response was never sent and the request
 *                         HUNG. (Express 4: an async throw leaves the client spinning.)
 *   routes/safety.js      `captureException` — reached only when a payment void has already
 *                         failed, i.e. when a hold is still sitting on someone's card.
 *   routes/sessions.js    `hourlyRate` — a leftover from the fee calculation v1.105.19
 *                         deleted. A caregiver declining a late time change got a 500 AFTER
 *                         the cancel and the fee capture had happened.
 *
 * Deliberately one rule. This is not a style gate; it fails only on code that cannot run.
 */
const path = require("path");
const { ESLint } = require("eslint");

async function main() {
  const eslint = new ESLint({
    useEslintrc: false,
    overrideConfig: {
      root: true,
      env: { node: true, es2022: true },
      parserOptions: { ecmaVersion: 2022, sourceType: "script" },
      rules: { "no-undef": "error" },
    },
  });

  const cwd = path.join(__dirname, "..");
  const results = await eslint.lintFiles([path.join(cwd, "src/**/*.js")]);

  const findings = [];
  for (const r of results) {
    for (const m of r.messages) {
      if (m.severity !== 2) continue;
      findings.push({ file: path.relative(cwd, r.filePath), line: m.line, message: m.message });
    }
  }

  if (findings.length === 0) {
    console.log(`  [lint] ✓ ${results.length} server files, no undefined identifiers`);
    return 0;
  }

  console.error(`\n  [lint] ✗ ${findings.length} undefined identifier(s) in src/ — each of these throws ReferenceError the moment its line runs, and most of them run inside a catch:\n`);
  for (const f of findings) console.error(`    ${f.file}:${f.line}  ${f.message}`);
  console.error("");
  return 1;
}

main().then((c) => process.exit(c)).catch((e) => {
  console.error("  [lint] runner failed:", e.message);
  process.exit(1);
});
