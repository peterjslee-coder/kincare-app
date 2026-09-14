/**
 * v1.106.21 — an admin's trusted network survives IPv6 rotation.
 *
 * trusted_admin_ips matched the client address exactly. On IPv6 the low 64 bits are the
 * interface identifier, and macOS/iOS/Windows randomise and regenerate it roughly daily
 * (RFC 4941). So a verified laptop quietly stops being verified overnight, in the same house,
 * on the same network — which is what happened to Pete's feedback-pull script:
 *
 *   Triage fetch failed: { code: 'IP_VERIFICATION_REQUIRED',
 *                          ip: '2606:a800:9d80:2630:98ab:6c20:39c5:65ce' }
 *
 * Trust is now keyed on the /64 for IPv6 and the exact address for IPv4. The two properties
 * that have to hold together: rotation inside a network keeps working, and a DIFFERENT network
 * never matches. A gate that is too loose is not a fix.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "trusted-ip-secret";

const { startHarness, stopHarness } = require("./harness");
const { ipTrustKey } = require("../../src/utils/ipTrustKey");

jest.setTimeout(180000);

let h, db, admin, registerTrustedIp, isTrustedIp;

const HOME_V6 = "2606:a800:9d80:2630:98ab:6c20:39c5:65ce";   // the address Pete verified
const HOME_V6_ROTATED = "2606:a800:9d80:2630:1111:2222:3333:4444"; // same /64, next day
const NEIGHBOUR_V6 = "2606:a800:9d80:2631:98ab:6c20:39c5:65ce";    // adjacent /64 — not him
const FAR_V6 = "2001:db8:dead:beef::1";

beforeAll(async () => {
  h = await startHarness({ routers: {} });
  db = h.db;
  ({ registerTrustedIp, isTrustedIp } = require("../../src/utils/trustedIps"));
  admin = await h.createUser({ firstName: "Ad", lastName: "Min", isAdmin: true });
  await db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(admin.user.id);
});
afterAll(async () => { await stopHarness(h); });

beforeEach(async () => {
  await db.prepare("DELETE FROM trusted_admin_ips WHERE user_id = ?").run(admin.user.id);
});

describe("IPv6 rotation does not revoke trust", () => {
  test("verifying once trusts the whole /64", async () => {
    expect(await registerTrustedIp(admin.user.id, HOME_V6, { verifiedVia: "passkey" })).toBe(true);
    expect(await isTrustedIp(admin.user.id, HOME_V6)).toBeTruthy();
    // The exact case that broke: same network, new interface identifier.
    expect(await isTrustedIp(admin.user.id, HOME_V6_ROTATED)).toBeTruthy();
  });

  test("a DIFFERENT /64 is still refused — this is the half that must not loosen", async () => {
    await registerTrustedIp(admin.user.id, HOME_V6, { verifiedVia: "passkey" });
    expect(await isTrustedIp(admin.user.id, NEIGHBOUR_V6)).toBeNull();
    expect(await isTrustedIp(admin.user.id, FAR_V6)).toBeNull();
  });

  test("another admin's trust is not yours", async () => {
    const other = await h.createUser({ firstName: "Other", lastName: "Admin", isAdmin: true });
    await db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(other.user.id);
    await registerTrustedIp(other.user.id, HOME_V6, { verifiedVia: "passkey" });
    expect(await isTrustedIp(admin.user.id, HOME_V6)).toBeNull();
  });

  test("the row still records the exact address that registered it", async () => {
    // The admin panel lists these, and an audit needs the real address, not the network.
    await registerTrustedIp(admin.user.id, HOME_V6, { verifiedVia: "passkey" });
    const row = await db.prepare(
      "SELECT ip_address, trust_key FROM trusted_admin_ips WHERE user_id = ?"
    ).get(admin.user.id);
    expect(row.ip_address).toBe(HOME_V6);
    expect(row.trust_key).toBe("2606:a800:9d80:2630::/64");
  });
});

describe("the same network written two ways is one key", () => {
  test("a compressed and an expanded spelling of one address agree", async () => {
    // The whole bug returns if they disagree: register from one spelling, get refused from the
    // other, same machine. A naive split(':').slice(0,4) gets this wrong — "2606:a800::1"
    // yields "2606:a800::1" while "2606:a800:0:0:0:0:0:1" yields "2606:a800:0:0".
    expect(ipTrustKey("2606:a800::1")).toBe(ipTrustKey("2606:a800:0:0:0:0:0:1"));
    expect(ipTrustKey("2606:0a800::1")).not.toBe(ipTrustKey("2606:a801::1"));

    await registerTrustedIp(admin.user.id, "2606:a800:0:0:0:0:0:1", { verifiedVia: "passkey" });
    expect(await isTrustedIp(admin.user.id, "2606:a800::99")).toBeTruthy();
  });

  test("leading zeroes in a hextet do not make a different network", async () => {
    expect(ipTrustKey("2606:0a80:9d80:2630::1")).toBe(ipTrustKey("2606:a80:9d80:2630::1"));
  });
});

describe("IPv4 is unchanged", () => {
  test("an exact address is trusted, a neighbour is not", async () => {
    await registerTrustedIp(admin.user.id, "203.0.113.9", { verifiedVia: "login" });
    expect(await isTrustedIp(admin.user.id, "203.0.113.9")).toBeTruthy();
    expect(await isTrustedIp(admin.user.id, "203.0.113.10")).toBeNull();
  });

  test("the ::ffff: mapped form is the same address, not a different one", async () => {
    // Node hands back ::ffff:1.2.3.4 on a dual-stack socket. Treating that as a separate
    // address would have the admin re-verifying depending on how they connected.
    await registerTrustedIp(admin.user.id, "203.0.113.9", { verifiedVia: "login" });
    expect(await isTrustedIp(admin.user.id, "::ffff:203.0.113.9")).toBeTruthy();
  });
});

describe("non-admins and unreadable addresses", () => {
  test("a non-admin cannot register a trusted IP at all", async () => {
    const plain = await h.createUser({ firstName: "Not", lastName: "Admin" });
    expect(await registerTrustedIp(plain.user.id, HOME_V6, {})).toBe(false);
    expect(await isTrustedIp(plain.user.id, HOME_V6)).toBeNull();
  });

  test("'unknown' does not become a key that matches real networks", async () => {
    // getClientIp falls back to the string "unknown". If that ever collided with a real key,
    // an unreadable address would inherit somebody's trust.
    await registerTrustedIp(admin.user.id, "unknown", { verifiedVia: "login" });
    expect(await isTrustedIp(admin.user.id, HOME_V6)).toBeNull();
    expect(ipTrustKey("unknown")).toBe("unknown");
  });
});

describe("migration 037 backfilled the rows that were already there", () => {
  test("a legacy row with no trust_key still matches its exact address", async () => {
    // Belt and braces: isTrustedIp falls back to ip_address when trust_key IS NULL, so an
    // admin is never locked out by the deploy itself.
    await db.prepare(`
      INSERT INTO trusted_admin_ips (user_id, ip_address, trust_key, verified_via, last_seen_at, expires_at)
      VALUES (?, ?, NULL, 'legacy', NOW(), NOW() + INTERVAL '90 days')
    `).run(admin.user.id, "198.51.100.7");
    expect(await isTrustedIp(admin.user.id, "198.51.100.7")).toBeTruthy();
  });

  test("the column exists and is indexed", async () => {
    const col = await db.prepare(`
      SELECT 1 AS ok FROM information_schema.columns
      WHERE table_name = 'trusted_admin_ips' AND column_name = 'trust_key'
    `).get();
    expect(col).toBeTruthy();
    const idx = await db.prepare(
      "SELECT 1 AS ok FROM pg_indexes WHERE tablename = 'trusted_admin_ips' AND indexname = 'idx_trusted_ips_key'"
    ).get();
    expect(idx).toBeTruthy();
  });
});
