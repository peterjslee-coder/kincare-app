// ─── Who is looking at which thread (v1.105.103) ───
//
// Pete: "I am on the messaging interface messaging Julia and I get push notifications that
// Julia has sent a message, but I don't see it in the chat" (97783012). A push about a
// message you are reading is worse than no push: it trains the person to ignore the one that
// matters.
//
// Lives in its own module rather than inside server.js because server.js cannot be booted
// under jest (six pollers and a socket server), and a suppression rule that is only checked
// by source-matching is a rule nobody has actually run.
//
// SOCKET-scoped, not user-scoped: the same person on a laptop and a phone is looking at one
// of them. The only way to be "viewing" is to hold a live socket that said so, and the client
// closes the thread on `visibilitychange` — a hidden page is not being read.
//
// ─── v1.105.175 — the claim now expires, because a dead socket used to keep making it ───
//
// This file used to end: "Everything else (a lock, a crash, a dropped network) disconnects
// the socket, which clears the entry. So the failure direction is an EXTRA push, never a
// swallowed one."
//
// That was wrong, and it is the bug Pete reported as "I didn't see any of the messages until
// all 5 were there." A dropped network does NOT disconnect the socket — it makes the socket
// stop answering, and the server does not find out until ping timeout. With socket.io's
// defaults that is pingInterval + pingTimeout = 45 seconds. An iPhone that locks mid-thread
// leaves behind a socket that is still registered and still claiming to be reading, and every
// message in that window is BOTH suppressed from push AND not delivered live, because the
// thing it would be delivered to is gone. Silently, until the app is next opened.
//
// So the claim is now perishable. A client that is genuinely on screen re-asserts it; a frozen
// page cannot, and its claim dies on its own in TTL seconds no matter what the transport
// believes. Ping tuning (server.js) shortens the window; this closes it.
const VIEW_TTL_MS = 45000;

function createViewRegistry({ ttlMs = VIEW_TTL_MS, now = () => Date.now() } = {}) {
  const bySocket = new Map(); // socketId -> { conversationId, at }

  return {
    open(socketId, conversationId) {
      if (!socketId || !conversationId) return;
      bySocket.set(socketId, { conversationId, at: now() });
    },
    close(socketId) {
      bySocket.delete(socketId);
    },
    /** @param {Iterable<string>|undefined} socketIds the user's currently connected sockets */
    isViewing(socketIds, conversationId) {
      if (!socketIds || !conversationId) return false;
      const cutoff = now() - ttlMs;
      for (const sid of socketIds) {
        const entry = bySocket.get(sid);
        if (!entry || entry.conversationId !== conversationId) continue;
        // Expired claims are not just ignored, they are forgotten — otherwise the map grows
        // for the life of the process, one entry per socket that ever went quiet.
        if (entry.at < cutoff) { bySocket.delete(sid); continue; }
        return true;
      }
      return false;
    },
    size() { return bySocket.size; },
  };
}

module.exports = { createViewRegistry };
