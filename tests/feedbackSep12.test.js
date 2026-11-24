// v1.105.192 — the Sep 12 feedback pull, eight items, the first real outside caregiver (Tina).
const { code } = require("./helpers/source");
const tasksUi = code("public/js/components/CareTasks.js");
const dash = code("public/js/components/Dashboard.js");
const admin = code("public/js/components/AdminPanel.js");
const known = code("src/utils/knownCaregivers.js");
const auth = code("src/routes/auth.js");
const dashRoute = code("src/routes/dashboard.js");

test("the handoff no longer says 'tonight' about an 8 AM task", () => {
  expect(tasksUi).toContain("`Hand this task to ${pickedMember.first_name} \\u2014 not completed`");
  expect(tasksUi).not.toContain("Hand tonight to");
});

test("tapping Done says so at once, sends once, and puts it back on failure", () => {
  // Daniel: "it just freezes... so he keeps hitting done."
  expect(dash).toContain("if (savingOccIds.current.has(occ.id)) return;");
  expect(dash).toContain("patchOcc(occ.id, { status: 'done', completed_by_user_id: window.__currentUserId || null, completed_by_name: null, __saving: true });");
  expect(dash).toContain("if (!r.ok) { patchOcc(occ.id, before); showToast(r.error, 'error'); }");
  expect(tasksUi).toContain("occ.__saving ? 'Saving\\u2026'");
});

test("the admin panel says which 'driver's licence' it means, and that a vouched caregiver owes no fee", () => {
  expect(admin).toContain("Licence number typed:");
  expect(admin).toContain("photo approved, number not entered");
  expect(admin).toContain("Not needed \\u2014 vouched for ${onboardingModal.vouches.map(v => v.family_name).join(', ')}");
});

test("a caregiver who signs up on her own with the invited email is linked anyway", () => {
  // Tina never clicked the link; she made an account with the same email. The email was
  // always the point. Claimed at signup, at profile creation, and on the caregiver dashboard.
  expect(known).toContain("async function claimPendingByEmail(db, caregiverUserId, email)");
  expect(known).toContain("WHERE kind = ? AND status = 'pending' AND expires_at > NOW() AND LOWER(invited_email) = LOWER(?)");
  expect(known).toContain("UPDATE platform_invites SET status = 'accepted' WHERE id = ? AND status = 'pending'");
  expect(auth).toContain('if (role === "caregiver") {');
  expect(auth).toContain("await claimPendingByEmail(db, id, email);");
  expect(known).toContain("await claimPendingByEmail(db, caregiverUserId, user.email);");
  const cg = dashRoute.slice(dashRoute.indexOf("async function caregiverDashboard"), dashRoute.indexOf("async function careForDashboard"));
  expect(cg).toContain("claimPendingByEmail(db, userId, me.email)");
});

test("an unfilled recurring request is one card, and its Cancel can cancel the series", () => {
  expect(dashRoute).toContain("recurrenceGroupId: s.recurrence_group_id || null,");
  expect(dash).toContain("const seenSeries = new Map();");
  expect(dash).toContain("head.__seriesMore += 1");
  expect(dash).toContain("Whoever accepts takes the whole series");
  // v1.125.2 (d42baa59) — the card's Cancel opens the shared screen, which asks "just this visit,
  // or this and the later ones" (tests/cancelScopeClient.test.js, cancelSeriesScope.itest.js).
  // The old DELETE /recurring/:groupId skipped open visits — the very ones on this card.
  expect(dash).toContain("onClick={(e) => { e.stopPropagation(); setCancellingId(s.id); }}");
  expect(dash).not.toContain("`/api/sessions/recurring/${s.recurrenceGroupId}`");
});
