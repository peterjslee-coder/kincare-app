/**
 * The unit an admin's network trust is stored and matched against. (v1.106.21)
 *
 * trusted_admin_ips matched the FULL client address, exactly. For IPv4 that is fine. For IPv6 it
 * locks the admin out on a schedule, because two different things rotate underneath it:
 *
 *   · macOS (and iOS, and Windows) use privacy extensions, RFC 4941 — the low 64 bits, the
 *     interface identifier, are randomised and regenerated roughly daily;
 *   · residential ISPs hand out a /64 (or shorter) prefix that can change on reconnect.
 *
 * So Pete verified his laptop, and days later his own desktop script got
 * IP_VERIFICATION_REQUIRED from 2606:a800:9d80:2630:98ab:6c20:39c5:65ce — same house, same
 * machine, same network, different low 64 bits. A gate that fails like that does not get
 * tightened; it gets switched off, which is worse than a slightly wider one.
 *
 * So: IPv6 is trusted per /64 — the subnet a household is assigned, and the smallest unit that
 * survives privacy extensions. IPv4 stays exact, because a /64 has no IPv4 analogue and a
 * single address is already the household.
 *
 * The property that matters: this key is NEVER broader than a /64, and two different /64s never
 * produce the same key. Compressed forms are expanded before the prefix is taken, because
 * "2606:a800::1" and "2606:a800:9d80:2630::1" are different networks that a naive
 * `split(':').slice(0,4)` would happily conflate.
 */

/** An IPv4 address, including the ::ffff: mapped form Node hands back on a dual-stack socket. */
function asIPv4(ip) {
  const s = String(ip || "").trim().toLowerCase();
  const mapped = s.match(/^::ffff:((?:\d{1,3}\.){3}\d{1,3})$/);
  if (mapped) return mapped[1];
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(s)) return s;
  return null;
}

/** Expand an IPv6 address to its eight full hextets, or null if it does not parse. */
function expandIPv6(ip) {
  let s = String(ip || "").trim().toLowerCase();
  if (!s || s.includes(".") || !s.includes(":")) return null;
  s = s.replace(/%.*$/, "");              // drop a zone index: fe80::1%en0
  if ((s.match(/::/g) || []).length > 1) return null;   // only one :: is legal

  let head, tail;
  if (s.includes("::")) {
    const [a, b] = s.split("::");
    head = a ? a.split(":") : [];
    tail = b ? b.split(":") : [];
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    head = head.concat(Array(fill).fill("0"));
  } else {
    head = s.split(":");
    tail = [];
  }
  const parts = head.concat(tail);
  if (parts.length !== 8) return null;
  for (const p of parts) if (!/^[0-9a-f]{1,4}$/.test(p)) return null;
  return parts.map((p) => p.padStart(4, "0"));
}

/**
 * @param {string} ip  the client address, as getClientIp() reports it
 * @returns {string} the value to store in, and match against, trusted_admin_ips.trust_key
 */
function ipTrustKey(ip) {
  const v4 = asIPv4(ip);
  if (v4) return v4;                                  // exact, as before

  const parts = expandIPv6(ip);
  if (parts) return parts.slice(0, 4).join(":") + "::/64";

  // Unparseable, or the literal "unknown" getClientIp falls back to. Return it verbatim rather
  // than inventing a key: an address we cannot read must not accidentally match a real network.
  return String(ip || "unknown").trim().toLowerCase();
}

module.exports = { ipTrustKey, expandIPv6, asIPv4 };
