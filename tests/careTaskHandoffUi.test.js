// v1.105.191 — the check-off sheet can hand tonight to someone; the task list can remove a task.
const { code } = require("./helpers/source");
const ui = code("public/js/components/CareTasks.js");
const routes = code("src/routes/careTasks.js");

test("picking a team member offers to hand tonight to them, without checking it off", () => {
  expect(ui).toContain("const pickedMember = who.kind === 'user' ? (group.teamMembers || []).find((m) => m.id === who.id) : null;");
  expect(ui).toContain("`/api/care-tasks/occurrences/${occ.id}/assign`");
  expect(ui).toMatch(/Hand tonight to \$\{pickedMember\.first_name\}/);
  // Done and Skip are untouched — the handoff is a third thing, not a replacement.
  expect(ui).toContain("submit('done')");
  expect(ui).toContain("submit('skipped')");
});

test("the effective assignee is tonight's person, then the task's default — everywhere it is read", () => {
  expect(routes).toContain("COALESCE(o.assigned_user_id, t.assigned_user_id) AS assigned_user_id");
  expect(routes).toContain("LEFT JOIN users au ON au.id = COALESCE(o.assigned_user_id, t.assigned_user_id)");
  expect(routes).toContain("const assigneeId = occ.assigned_user_id || t.assigned_user_id;");
  expect(code("src/utils/attention.js")).toContain("COALESCE(occ.assigned_user_id, t.assigned_user_id) = ?");
  expect(code("src/models/database.js")).toContain('id: "029_occurrence_assignee"');
});

test("the new person is told, without the medication on the lock screen", () => {
  const block = routes.slice(routes.indexOf('router.post("/occurrences/:id/assign"'), routes.indexOf('router.post("/occurrences/:id/undo"'));
  expect(block).toContain('title: "It\'s your turn tonight"');
  expect(block).not.toMatch(/body: `\$\{occ\.title\}/);
  expect(block).toContain("if (u && u.id !== req.user.id)");
});

test("a task can be removed from the list, with a confirm that says history stays", () => {
  expect(ui).toContain("const removeTask = async (t) => {");
  expect(ui).toContain("method: 'DELETE'");
  expect(ui).toMatch(/window\.confirm\(`Remove "\$\{t\.title\}"\?/);
  expect(ui).toContain("stays in the history");
  expect(ui).toMatch(/onClick=\{\(\) => removeTask\(t\)\}/);
});
