// ─── What a time change actually changes (v1.123.0) ───
//
// Pete, 10/19: Tina asked to leave a Thursday visit at 3:00 instead of 5:00. The push, the
// Needs-you card and the review sheet all said "9:00 AM → 9:00 AM", because each of them
// printed the START time before and after, and she had changed the LENGTH. A request is two
// numbers (start, hours) and every place that summarised it showed one.
//
// So one describer, shared by the server (push, Needs-you title) and the client (card detail,
// review sheet, visit rows), that compares the whole window — start AND end — and says the
// part that moved, in words:
//
//   same start, earlier end   → "End at 3:00 PM instead of 5:00 PM"
//   same start, later end     → "End at 7:00 PM instead of 5:00 PM"
//   same end, start moved     → "Start at 11:00 AM instead of 9:00 AM"
//   same length, slid         → "Start at 11:00 AM instead of 9:00 AM"  + "Same 8 hr, now ends 7:00 PM"
//   both ends moved           → "10:00 AM – 3:00 PM instead of 9:00 AM – 5:00 PM"
//
// Isomorphic on purpose: this file is in the browser bundle (window.TimeChange) and required by
// Node (src/routes/sessions.js, src/utils/attention.js). Pure — no Date, no zone. The times are
// wall-clock times where the care happens and are already the right numbers; this formats
// them, it never converts them.
// A top-level `const` (not a bare IIFE) so the concatenated bundle — and lint-client's scope
// check — sees TimeChange as declared.
const TimeChange = (function () {
  const toMin = (t) => {
    if (t == null || t === '') return null;
    const [h, m] = String(t).split(':').map(Number);
    if (!Number.isFinite(h)) return null;
    return h * 60 + (Number.isFinite(m) ? m : 0);
  };

  // Minutes since midnight → "3:30 PM". Wraps past midnight: a 10 PM start for 4 hours ends
  // "2:00 AM", which is what a person would say.
  const clock = (min) => {
    if (min == null) return '';
    const m = ((Math.round(min) % 1440) + 1440) % 1440;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h % 12 || 12}:${String(mm).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  };

  // 6.5 → "6½ hr", 8 → "8 hr", 1.25 → "1¼ hr".
  const hours = (h) => {
    const n = Number(h);
    if (!Number.isFinite(n) || n <= 0) return '';
    const whole = Math.floor(n);
    const frac = Math.round((n - whole) * 4) / 4;
    const glyph = frac === 0.25 ? '¼' : frac === 0.5 ? '½' : frac === 0.75 ? '¾' : '';
    return `${whole || ''}${glyph || (whole ? '' : '0')} hr`;
  };

  const windowOf = (startMin, endMin) => (startMin == null ? '' : `${clock(startMin)} – ${clock(endMin)}`);

  /**
   * @param {{fromTime:string, fromHours:number|string, toTime:string, toHours:number|string}} c
   * @returns {{ kind:string, headline:string, sub:string|null, verb:string,
   *            from:string, to:string, fromHours:string, toHours:string,
   *            startChanged:boolean, endChanged:boolean, hoursChanged:boolean }}
   *   phrase   — the same, lower-case, to finish a sentence ("…visit to end at 3:00 PM…")
   *   headline — the one sentence that says what moves ("End at 3:00 PM instead of 5:00 PM")
   *   sub      — the hours, when they change ("6 hr instead of 8 hr"), or the new end when the
   *              whole visit slides ("Same 8 hr, now ends 7:00 PM"); null when nothing to add
   *   verb     — completes "Tina asked to …" ("end a visit early")
   *   from/to  — the full windows, "9:00 AM – 5:00 PM"
   */
  function describe(c) {
    const out = describeRaw(c);
    if (out.phrase && !out.headline) out.headline = cap(out.phrase);
    if (out.sub) out.sub = cap(out.sub);
    return out;
  }

  function describeRaw(c) {
    const fromStart = toMin(c && c.fromTime);
    const toStart = toMin(c && c.toTime);
    const fromH = Number(c && c.fromHours) || 0;
    const toH = Number(c && c.toHours) || 0;
    const fromEnd = fromStart == null ? null : fromStart + Math.round(fromH * 60);
    const toEnd = toStart == null ? null : toStart + Math.round(toH * 60);

    const startChanged = fromStart !== toStart;
    const endChanged = fromEnd !== toEnd;
    const hoursChanged = Math.round(fromH * 60) !== Math.round(toH * 60);
    const hoursSub = hoursChanged && fromH && toH ? `${hours(toH)} instead of ${hours(fromH)}` : null;

    const out = {
      kind: 'same', headline: '', phrase: '', sub: null, verb: 'change a visit',
      from: windowOf(fromStart, fromEnd), to: windowOf(toStart, toEnd),
      fromHours: hours(fromH), toHours: hours(toH),
      startChanged, endChanged, hoursChanged,
    };

    if (fromStart == null || toStart == null) {
      // Not enough to compare. Say what we have rather than a half-sentence.
      out.kind = 'unknown';
      out.headline = toStart != null ? `New time: ${windowOf(toStart, toEnd)}` : 'A new time';
      return out;
    }

    if (!startChanged && !endChanged) {
      out.headline = `No change: ${out.to}`;
      return out;
    }

    if (!startChanged) {
      const earlier = toEnd < fromEnd;
      out.kind = earlier ? 'endEarlier' : 'endLater';
      out.verb = earlier ? 'end a visit early' : 'stay later on a visit';
      out.phrase = `end at ${clock(toEnd)} instead of ${clock(fromEnd)}`;
      out.sub = hoursSub;
      return out;
    }

    if (!endChanged) {
      const later = toStart > fromStart;
      out.kind = later ? 'startLater' : 'startEarlier';
      out.verb = later ? 'start a visit later' : 'start a visit earlier';
      out.phrase = `start at ${clock(toStart)} instead of ${clock(fromStart)}`;
      out.sub = hoursSub;
      return out;
    }

    if (!hoursChanged) {
      const later = toStart > fromStart;
      out.kind = later ? 'shiftLater' : 'shiftEarlier';
      out.verb = later ? 'move a visit later' : 'move a visit earlier';
      out.phrase = `start at ${clock(toStart)} instead of ${clock(fromStart)}`;
      out.sub = `same ${hours(toH)}, now ends ${clock(toEnd)}`;
      return out;
    }

    out.kind = 'reshape';
    out.verb = "change a visit's hours";
    out.phrase = `run ${out.to} instead of ${out.from}`;
    out.sub = hoursSub;
    return out;
  }

  const cap = (str) => (str ? str.charAt(0).toUpperCase() + str.slice(1) : str);

  // "Today" → "today", "Tomorrow" → "tomorrow", "Thu, Oct 22" → "on Thu, Oct 22": the tail of
  // "Betty's visit ___".
  const onDay = (label) => {
    if (!label) return '';
    if (/^(today|tomorrow)$/i.test(label)) return label.toLowerCase();
    return `on ${label}`;
  };

  return { describe, clock, hours, toMin, onDay };
})();
if (typeof window !== 'undefined') window.TimeChange = TimeChange;
if (typeof module !== 'undefined' && module.exports) module.exports = TimeChange;
