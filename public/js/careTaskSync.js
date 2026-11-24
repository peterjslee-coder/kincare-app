// ─── One task, one writer, one announcement (v1.105.162) ───
//
// Pete: "do we need a priority of which listens to which?… Ultimately, I'd prefer it was all
// one task, with three different deep links to take you to that task, then push back to the
// locations to clear the 'needs you' card, move from 'next up' and mark it done in the care
// team."
//
// The honest answer to the priority question is no — you only need a priority when there are
// several copies of the truth arguing. There is one occurrence row on the server and there
// always has been; what drifted was the CLIENT, where five different places sent the same
// check-off request with their own error handling, and three screens each held their own cached
// answer with no idea the others existed.
//
// That is how "Already checked off" happened: the card wrote, the sheet did not know, and the
// care-team panel knew least of all.
//
// So: one function writes, and when it succeeds it says so once. Every screen that shows care
// tasks listens and re-reads. No screen is authoritative over another — they are all just
// views, and the server is the task.
const CareTaskSync = window.CareTaskSync = (() => {
  const EVENT = 'inplace:care-task-changed';

  const announce = (occId) => {
    try { window.dispatchEvent(new CustomEvent(EVENT, { detail: { occId: occId || null } })); }
    catch { /* a screen that misses the news re-reads on its next visit anyway */ }
  };

  return {
    EVENT,
    announce,

    /** Subscribe. Returns an unsubscribe, so an effect can return it directly. */
    onChange(cb) {
      const handler = (e) => cb(e?.detail?.occId || null);
      window.addEventListener(EVENT, handler);
      return () => window.removeEventListener(EVENT, handler);
    },

    /**
     * Check off, skip, or otherwise write an occurrence. `body.status` is 'done' or 'skipped'.
     * Returns { ok, error } — never throws, because five callers used to each invent their own
     * failure handling and that is exactly what came apart.
     */
    async write(occId, body) {
      try {
        const res = await apiFetch(`/api/care-tasks/occurrences/${occId}/check`, {
          method: 'POST', body: JSON.stringify(body || { status: 'done' }),
        });
        // 409 is the endpoint saying the occurrence is ALREADY in the state you asked for.
        // The person wanted it done; it is done. Treating that as a failure is what put a red
        // banner across the only two buttons on the check sheet (v1.105.161).
        if (res?.ok || res?.status === 409) { announce(occId); return { ok: true }; }
        let error = null;
        try { error = (await res.json())?.error; } catch { /* keep the generic line */ }
        return { ok: false, error: error || "That didn't go through. Try again." };
      } catch {
        return { ok: false, error: "That didn't go through. Try again." };
      }
    },

    /** Undo a check-off. Same contract. */
    async undo(occId) {
      try {
        const res = await apiFetch(`/api/care-tasks/occurrences/${occId}/undo`, { method: 'POST' });
        if (res?.ok) { announce(occId); return { ok: true }; }
        return { ok: false, error: "Couldn't undo that." };
      } catch {
        return { ok: false, error: "Couldn't undo that." };
      }
    },
  };
})();
