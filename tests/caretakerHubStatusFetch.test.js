// Julia read as verified to the admin and unverified to herself. (Feedback 52cbb793, Aug 18.)
//
// Not a disagreement between two producers — the client never ASKED. checkIdentity() and
// checkStripe() sat inside a useEffect that opens `if (activeTab !== 'earnings') return;`, and
// the hub opens on 'schedule'. So on the landing screen both states held their initial values,
// and both initial values read as "no":
//
//   First Steps told an approved caregiver to photograph her ID.
//   First Steps told a connected caregiver to connect Stripe.
//   _autoStepCount — which decides when mark-onboarding-complete fires — counted a connected
//   Stripe as missing, so it could never reach 6 and onboarding stayed false forever.
//   And because the checklist never completed, showFirstSteps never went false, so the whole
//   "complete your profile" panel stayed on screen permanently.
//
// v1.105.68 fixed the VOUCH term of that same count for exactly this reason. It did not notice
// that another term of it was only fetched on a tab most caregivers never open.

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..");
const hub = fs.readFileSync(path.join(REPO, "public/js/components/CaretakerHub.js"), "utf8");

// The effect that is still, correctly, earnings-only.
// lastIndexOf, not indexOf: the mount effect's comment QUOTES this guard to explain what moved,
// and slicing from the comment would make these assertions pass against the wrong block.
const earningsEffectStart = hub.lastIndexOf("if (activeTab !== 'earnings') return;");
const earningsEffectEnd = hub.indexOf("}, [activeTab]);", earningsEffectStart);
const earningsEffect = hub.slice(earningsEffectStart, earningsEffectEnd);

describe("account status is fetched regardless of which tab you are on", () => {
  test("the hub does NOT open on the earnings tab", () => {
    // The whole bug depends on this: if the default were 'earnings' it would have self-healed.
    expect(hub).toMatch(/useState\(initialTab \|\| 'schedule'\)/);
  });

  test("checkIdentity is no longer trapped behind the earnings guard", () => {
    expect(earningsEffect).not.toMatch(/checkIdentity/);
  });

  test("checkStripe is no longer trapped behind the earnings guard", () => {
    expect(earningsEffect).not.toMatch(/checkStripe/);
  });

  test("both run from a mount effect with no tab dependency", () => {
    const mount = hub.slice(hub.indexOf("Account status the WHOLE hub depends on"), earningsEffectStart);
    expect(mount).toMatch(/checkIdentity\(\);/);
    expect(mount).toMatch(/checkStripe\(\);/);
    expect(mount).toMatch(/\}, \[\]\);/);
  });

  test("the mount effect cannot set state after unmount", () => {
    const mount = hub.slice(hub.indexOf("Account status the WHOLE hub depends on"), earningsEffectStart);
    expect(mount).toMatch(/let cancelled = false;/);
    expect(mount).toMatch(/return \(\) => \{ cancelled = true; \};/);
  });

  test("what genuinely belongs to earnings stays there", () => {
    // The fix is about scope, not about moving everything out.
    expect(earningsEffect).toMatch(/fetchCompleted\(\)/);
    expect(earningsEffect).toMatch(/fetchTips\(\)/);
  });
});

describe("an unanswered fetch is not a negative answer", () => {
  test("idVerification starts as 'unknown', not as a denial", () => {
    expect(hub).toMatch(/useState\(\{ verified: false, status: 'unknown', loaded: false \}\)/);
  });

  test("no ID prompt is shown before the answer arrives", () => {
    expect(hub).toMatch(/missing: !idVerification\.loaded\s*\n\s*\? null/);
  });

  test("no Stripe prompt is shown while stripeStatus is still null", () => {
    expect(hub).toMatch(/stripeStatus === null\) \? null : 'Connect Stripe to continue'/);
  });

  test("every path that sets idVerification records that it was loaded", () => {
    // A state that can be 'answered' must say so on success AND on failure, or the guard
    // above silently suppresses the retry prompt forever.
    const sets = hub.match(/setIdVerification\(\{[^}]*\}\)/g) || [];
    expect(sets.length).toBeGreaterThanOrEqual(3);
    for (const call of sets) expect(call).toMatch(/loaded: true/);
  });
});

describe("the onboarding auto-complete counter", () => {
  test("still counts Stripe, which is why the fetch had to move", () => {
    const count = hub.slice(hub.indexOf("const _autoStepCount"), hub.indexOf("].filter(Boolean).length"));
    expect(count).toMatch(/stripeStatus\?\.status === 'active'/);
  });
});
