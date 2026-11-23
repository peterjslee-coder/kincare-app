/**
 * v1.151.0 — Request care in dark mode.
 *
 * The role colours (#1b6b5a and friends) are dark. As TEXT on a dark card they measured 2–3:1
 * on staging: the step labels, the overtime choice, Hide/Details. Text in this modal uses
 * --role-text (the brightened role colour in dark mode) or --role-text-on-tint on a tinted
 * fill; --role-color stays for borders and fills, where it reads fine.
 */
const { code, raw } = require("./helpers/source");

const SRC = "public/js/components/RequestCareModal.js";

test("no text in Request care is coloured with the raw role colour", () => {
  const src = code(SRC);
  const hits = src.match(/(?<![-\w])color:\s*[^,;}]*'var\(--role-color\)'/g) || [];
  expect(hits).toEqual([]);
});

test("the text variables exist in both themes", () => {
  const css = raw("public/css/styles.css");
  expect(css).toMatch(/--role-text:\s*var\(--role-color\);/);
  expect(css).toMatch(/\[data-theme="dark"\]\s*\{[^}]*--role-text:\s*var\(--role-color-bright/);
  expect(css).toMatch(/\[data-theme="dark"\]\s*\{[^}]*--role-text-on-tint:\s*var\(--text-primary\)/);
});
