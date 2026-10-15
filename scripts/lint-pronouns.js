#!/usr/bin/env node
/**
 * lint:pronouns — the app does not guess anyone's gender (v1.119.1).
 *
 * Pete, 10/14 (feedback 36b1a6cc), replying to an outreach voicemail: "it says she already has
 * an account at the email address… remove the gender specific pronouns please."
 *
 * The app was written against one real caregiver and one real mother, and its copy said "she"
 * and "her" about whoever happened to be on the other end — caregivers it is recruiting cold,
 * care recipients it knows only by a first name. InPlace stores no one's pronouns, so every one
 * of those was a guess. The fix was a sweep (a name where we have one, "they" where we don't);
 * this keeps it swept.
 *
 * What it reads: the TEXT a person can see — string literals, template-literal text and JSX
 * text — in the client and in the server routes that answer the client. It parses with Babel
 * rather than stripping comments by regex (CLAUDE.md Dev Rule 8: a `/*` inside a string opens
 * a phantom comment and silently swallows the file). Comments are never read.
 *
 * What it does NOT police, and why each is allowed below:
 *   · demo stories about a named, fictional woman (Barbara Lowe, "Mom") — the character has a
 *     gender; the reader does not;
 *   · instructions written for the AI, whose examples are about a woman by construction;
 *   · keyword lists that MATCH what people type ("need her to").
 * A new exception goes in ALLOW with its reason. Prefer rewording.
 */
const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");

const ROOT = path.join(__dirname, "..");
const WORDS = /\b(she|her|hers|herself)\b/i;

// file (relative) → true for the whole file, or an array of substrings that are allowed in it.
const ALLOW = {
  // Demo walkthrough: Barbara Lowe, 78, a fictional character with a fixed story.
  "public/js/components/CareStoryWalkthrough.js": true,
  // The caregiver tour previews a visit with the demo recipient Barbara.
  "public/js/components/CaregiverTour.js": true,
  // Marketing story about "Mom".
  "public/js/components/SplashPage.js": ["What Mom wants is simple"],
  // Example placeholders that are about a named woman (Mom / Betty), shown as examples.
  "public/js/components/CareProfile.js": ["Had dinner with Mom"],
  "public/js/components/CaretakerHub.js": ["Betty was in good spirits today"],
  // AI prompts and their worked examples — read by the model, never shown to a user.
  "src/routes/careRecipients.js": true,
  "src/routes/kindred.js": true,
  // Keyword lists that match what a family types ("need her to"), and a prompt example.
  "src/routes/ipaiChat.js": true,
};

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (["node_modules", "js-compiled", "vendor"].includes(e.name)) continue;
      yield* walk(p);
    } else if (e.name.endsWith(".js")) yield p;
  }
}

function targets() {
  const files = [...walk(path.join(ROOT, "public/js"))];
  files.push(...[...walk(path.join(ROOT, "src/routes"))]);
  files.push(path.join(ROOT, "src/server.js"));
  return files;
}

function texts(src) {
  const ast = parser.parse(src, {
    sourceType: "unambiguous", errorRecovery: true,
    plugins: ["jsx", "optionalChaining", "nullishCoalescingOperator", "classProperties"],
  });
  const out = [];
  const visit = (node) => {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "StringLiteral") out.push({ text: node.value, line: node.loc.start.line });
    else if (node.type === "TemplateElement") out.push({ text: node.value.cooked || node.value.raw, line: node.loc.start.line });
    else if (node.type === "JSXText") out.push({ text: node.value, line: node.loc.start.line });
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
      const v = node[key];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === "object" && typeof v.type === "string") visit(v);
    }
  };
  visit(ast.program);
  return out;
}

function check(files = targets()) {
  const problems = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    const allow = ALLOW[rel];
    if (allow === true) continue;
    let found;
    try { found = texts(fs.readFileSync(file, "utf8")); } catch (e) {
      problems.push(`${rel}: could not parse (${e.message})`);
      continue;
    }
    for (const { text, line } of found) {
      if (!WORDS.test(text)) continue;
      // SQL and code inside strings: only flag what reads as a sentence, not an identifier.
      if (/^\s*(SELECT|UPDATE|INSERT|DELETE|WITH|CREATE|ALTER)\b/i.test(text)) continue;
      if (Array.isArray(allow) && allow.some((a) => text.includes(a))) continue;
      problems.push(`${rel}:${line}: "${text.trim().slice(0, 90)}"`);
    }
  }
  return problems;
}

module.exports = { check, texts, ALLOW };

if (require.main === module) {
  const problems = check();
  if (problems.length) {
    console.error(`lint:pronouns — ${problems.length} gendered string(s) a user can see. InPlace doesn't know anyone's pronouns: use the person's name, or "they".\n`);
    for (const p of problems) console.error("  " + p);
    process.exit(1);
  }
  console.log("lint:pronouns — clean");
}
