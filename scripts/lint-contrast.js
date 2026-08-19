#!/usr/bin/env node
// ─── Dark-mode contrast gate (v1.105.98) ───
//
// Pete, on a dark-mode caregiver dashboard: "this color scheme in dark mode does not work
// well. the 'needs you' is unreadable. again." The word that matters is "again" — this had
// been reported before and kept coming back, because nothing in the build could see it.
//
// The failure is always the same shape: a hardcoded hex TEXT colour sitting on a BACKGROUND
// that is a theme variable. In light mode the pair is fine. Flip the theme and the background
// moves while the text stays put. #b45309 on --bg-warm is 5.9:1 in light mode and 3.1:1 in
// dark, which is how a warning telling a caregiver what she still needs to do became a smudge.
//
// A hardcoded colour on a hardcoded background is NOT flagged: that pair is self-consistent in
// both themes. Only the mixed case is a bug, which is why this gate can sit at zero rather than
// drowning in the ~160 hardcoded colours the client still contains.
const fs = require("fs");
const path = require("path");

const COMPONENTS = path.join(__dirname, "..", "public", "js", "components");
const CSS = path.join(__dirname, "..", "public", "css", "styles.css");
const MIN_RATIO = 4.5; // WCAG AA, normal text

// Read the DARK block's variable values straight from the stylesheet so this can never drift
// from the real theme.
function darkVars() {
  const css = fs.readFileSync(CSS, "utf8");
  const darkStart = css.search(/\[data-theme=["']dark["']\]|@media \(prefers-color-scheme: dark\)|\.dark\b/);
  const block = darkStart === -1 ? css : css.slice(darkStart);
  const vars = {};
  for (const m of block.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    if (!(m[1] in vars)) vars[m[1]] = m[2];
  }
  return vars;
}

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
function luminance(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  if (h.length === 8) h = h.slice(0, 6);
  return 0.2126 * lin(parseInt(h.slice(0, 2), 16)) +
         0.7152 * lin(parseInt(h.slice(2, 4), 16)) +
         0.0722 * lin(parseInt(h.slice(4, 6), 16));
}
function contrast(a, b) {
  const l1 = luminance(a), l2 = luminance(b);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

const vars = darkVars();
// The two surfaces almost every card, row and banner in this app is drawn on.
const DARK_SURFACES = [vars["--bg-card"], vars["--bg-surface"]].filter(Boolean);

const findings = [];
for (const file of fs.readdirSync(COMPONENTS)) {
  if (!file.endsWith(".js")) continue;
  const lines = fs.readFileSync(path.join(COMPONENTS, file), "utf8").split("\n");
  lines.forEach((line, i) => {
    // `borderColor` / `textDecorationColor` are not body text — skip them.
    const fg = line.match(/(?<![\w-])color:\s*'(#[0-9a-fA-F]{3,8})'/);
    if (!fg) return;

    const hardBg = /background(?:Color)?:\s*'(?:#|linear|rgba)/.test(line);
    const varBg = line.match(/background(?:Color)?:\s*'var\((--[\w-]+)\)'/);

    // Case 1 — hardcoded text on a hardcoded background. Self-consistent in both themes:
    // it will look like a light chip in a dark UI, which is a taste question, not a bug.
    if (hardBg) return;

    // Case 2 — hardcoded text on a theme background that flips underneath it.
    if (varBg) {
      const bgHex = vars[varBg[1]];
      if (!bgHex) return; // gradient or unresolved — nothing to measure
      const ratio = contrast(fg[1], bgHex);
      if (ratio < MIN_RATIO) {
        findings.push({ file, line: i + 1, fg: fg[1], bg: varBg[1], bgHex, ratio: ratio.toFixed(2) });
      }
      return;
    }

    // Case 3 — hardcoded text with no background of its own, so it inherits whatever card it
    // lands in. This is the one that got away in the first version of this gate: the
    // "Background Check — Action Needed" heading was #92400e inside a <div className="card">,
    // 1.9:1 on a dark card, and the linter could not see it because the background lived in a
    // CSS class two elements up. Measured against the surfaces cards are actually drawn on.
    for (const surface of DARK_SURFACES) {
      const ratio = contrast(fg[1], surface);
      if (ratio < MIN_RATIO) {
        findings.push({ file, line: i + 1, fg: fg[1], bg: "(inherited surface)", bgHex: surface, ratio: ratio.toFixed(2) });
        return;
      }
    }
  });
}

if (findings.length) {
  console.error(`\n  [lint:contrast] ✗ ${findings.length} hardcoded text colour(s) on a theme background that flips in dark mode:\n`);
  for (const f of findings.sort((a, b) => a.ratio - b.ratio)) {
    console.error(`    ${f.ratio}:1  ${f.fg} on ${f.bg} (${f.bgHex})  —  ${f.file}:${f.line}`);
  }
  console.error(`\n  Use the semantic variable instead (--color-warning, --color-error, --color-success,`);
  console.error(`  --color-info, --color-indigo…). They are defined for both themes; a hex is not.\n`);
  process.exit(1);
}
console.log(`  [lint:contrast] ✓ no hardcoded text colour sits on a theme background below ${MIN_RATIO}:1 in dark mode`);
