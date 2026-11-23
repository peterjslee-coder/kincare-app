// ─── Who should come? The caregiver order on Request care (v1.151.0) ───
//
// Pete, 11/23, looking at a Sunday request for Betty: "it can't just list every single
// person. There was supposed to be rank ordering… Tina is great, but she's off Sundays… so
// maybe Kay is the number one candidate. Edwina hasn't cared for anyone in the last three
// months, so maybe she's at the bottom of the list." Then: "shorten it to 30 days. Nudge to
// currency." And Kay was already booked with Betty that Sunday, so she must not be the best
// match for a visit she cannot do.
//
// The old order was lifetime visit count first, availability last — Tina (59) and Cary (25,
// last seen in April) sat above Kay, who was the only one actually free.
//
// The order now, one group after another:
//   1. available  — worked with this person in the last 30 days, free that day (has the hours
//                   open) and not already booked then
//   2. off        — worked with this person in the last 30 days, but not on schedule that day
//                   ("usually off Sundays · can still ask")
//   3. new        — never worked a visit for this person (vouched, assigned or nearby)
//   4. lapsed     — has worked for this person, but no completed visit in the last 30 days
//   5. booked     — already has a visit that overlaps this one; shown, never pickable
// Inside a group: completed visits in the last 30 days, then all visits with this person, then
// stars. The best match is the first caregiver in group 1.
//
// Isomorphic (window.BookingRank in the bundle; required by src/routes/assignments.js for the
// overlap check) and pure: naive care-location wall times, no Date, no zone.
const BookingRank = (function () {
  const toMin = (t) => {
    if (t == null || t === '') return null;
    const [h, m] = String(t).split(':').map(Number);
    if (!Number.isFinite(h)) return null;
    return h * 60 + (Number.isFinite(m) ? m : 0);
  };

  // "2026-11-29" minus n days, as a naive date string. UTC noon so no DST edge can move it.
  const minusDays = (dateStr, n) => {
    const p = String(dateStr || '').split('-').map(Number);
    if (p.length !== 3 || !p.every(Number.isFinite)) return null;
    const d = new Date(Date.UTC(p[0], p[1] - 1, p[2], 12));
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };

  // A visit as [start, end) in minutes from the START of `onDate`. A visit that began the day
  // before and runs past midnight lands at negative start, so an overnight still collides
  // with the next morning.
  const span = (visit, onDate) => {
    const start = toMin(visit.time);
    const hours = Number(visit.durationHours);
    if (start == null || !(hours > 0)) return null;
    let offset = 0;
    if (visit.date !== onDate) {
      if (minusDays(onDate, 1) === visit.date) offset = -24 * 60;
      else return null;
    }
    return [offset + start, offset + start + Math.round(hours * 60)];
  };

  const overlaps = (a, b) => {
    const sa = span(a, b.date);
    const sb = span(b, b.date);
    if (!sa || !sb) return false;
    return sa[0] < sb[1] && sb[0] < sa[1];
  };

  const GROUP_ORDER = ['available', 'off', 'new', 'lapsed', 'booked'];

  const groupOf = (cg) => {
    if (cg.booked) return 'booked';
    if (!(cg.visitCount > 0)) return 'new';
    if (!(cg.recentVisits > 0)) return 'lapsed';
    return cg.available ? 'available' : 'off';
  };

  // Stable: equal caregivers keep the server's order.
  const rank = (list) => {
    const withIdx = (list || []).map((cg, i) => ({ cg, i, g: groupOf(cg) }));
    withIdx.sort((a, b) => {
      const ga = GROUP_ORDER.indexOf(a.g), gb = GROUP_ORDER.indexOf(b.g);
      if (ga !== gb) return ga - gb;
      const ra = a.cg.recentVisits || 0, rb = b.cg.recentVisits || 0;
      if (ra !== rb) return rb - ra;
      const va = a.cg.visitCount || 0, vb = b.cg.visitCount || 0;
      if (va !== vb) return vb - va;
      const sa = Number(a.cg.rating) || 0, sb = Number(b.cg.rating) || 0;
      if (sa !== sb) return sb - sa;
      return a.i - b.i;
    });
    return withIdx.map(({ cg, g }) => ({ ...cg, group: g }));
  };

  const bestMatch = (ranked) => (ranked || []).find((cg) => cg.group === 'available') || null;

  return { toMin, minusDays, overlaps, groupOf, rank, bestMatch, GROUP_ORDER };
})();
if (typeof window !== 'undefined') window.BookingRank = BookingRank;
if (typeof module !== 'undefined' && module.exports) module.exports = BookingRank;
