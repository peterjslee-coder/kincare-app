// v1.143.1 — FamilyCompPanel is a top-level component, so `showToast` is NOT in scope for it the
// way it is inside AdminPanel's body. v1.143.0 shipped without `useToast()` and lint-client did
// not catch it (the name is declared elsewhere in the same file). Pin it.
const { raw } = require("./helpers/source");

test("FamilyCompPanel takes showToast from useToast()", () => {
  const src = raw("public/js/components/AdminPanel.js");
  const start = src.indexOf("const FamilyCompPanel = ");
  expect(start).toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf("\nconst SpecialFeeEditor = ", start));
  expect(body).toContain("showToast(");
  expect(body).toMatch(/const \{ showToast \} = useToast\(\);/);
});
