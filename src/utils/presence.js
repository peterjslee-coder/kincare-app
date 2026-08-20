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
// closes the thread on `visibilitychange` — a hidden page is not being read. Everything else
// (a lock, a crash, a dropped network) disconnects the socket, which clears the entry. So the
// failure direction is an EXTRA push, never a swallowed one.

function createViewRegistry() {
  const bySocket = new Map(); // socketId -> conversationId

  return {
    open(socketId, conversationId) {
      if (!socketId || !conversationId) return;
      bySocket.set(socketId, conversationId);
    },
    close(socketId) {
      bySocket.delete(socketId);
    },
    /** @param {Iterable<string>|undefined} socketIds the user's currently connected sockets */
    isViewing(socketIds, conversationId) {
      if (!socketIds || !conversationId) return false;
      for (const sid of socketIds) {
        if (bySocket.get(sid) === conversationId) return true;
      }
      return false;
    },
    size() { return bySocket.size; },
  };
}

module.exports = { createViewRegistry };
