// v1.113.1 — Pete: "the to-dos that are collapsed to be just a little more noticeable …
// 'To-do list - 3 items' … a splash of color or a shimmer".
const { raw, code } = require("./helpers/source");
const ui = code("public/js/components/CareTodos.js");
const css = raw("public/css/styles.css");

test("folded with something waiting: an amber bar that says how many", () => {
  expect(ui).toMatch(/\{!expanded && open\.length > 0 \? \(/);
  expect(ui).toContain('className="care-todo-folded"');
  expect(ui).toContain("background: 'var(--color-warning-bg)', borderLeft: '4px solid var(--color-warning)'");
  expect(ui).toMatch(/To-do list \{'·'\} \{open\.length\} \{open\.length === 1 \? 'item' : 'items'\}/);
});

test("the sheen is slow, and off for reduced motion", () => {
  expect(css).toMatch(/\.care-todo-folded::after \{[\s\S]*animation: careTodoSheen 7s/);
  expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.care-todo-folded::after \{ animation: none; display: none; \}/);
});
