// Do not push someone about a message they are reading. (v1.105.103)
//
// Pete: "I am on the messaging interface messaging Julia and I get push notifications that
// Julia has sent a message, but I don't see it in the chat. I have to back out." (97783012)
//
// Two bugs braided. This file pins the push half and the payload half; the "doesn't land in
// the open thread" half was two conversation rows between the same two people — see
// tests/integration/supportThreadIsNotADm.itest.js and v1.105.102.

const fs = require("fs");
const path = require("path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const server = read("src/server.js");
const routes = read("src/routes/messages.js");
const client = read("public/js/components/Messages.js");
const { createViewRegistry } = require("../src/utils/presence");

describe("the server knows which thread is on screen", () => {
  test("presence is socket-scoped, not user-scoped", () => {
    // The same person on a laptop and a phone is looking at one of them.
    expect(server).toMatch(/const viewingConversation = createViewRegistry\(\);/);
    expect(server).toMatch(/viewingConversation\.isViewing\(connectedUsers\.get\(userId\), conversationId\)/);
  });

  test("membership is checked, not trusted", () => {
    // Otherwise claiming to "view" any conversation id would suppress that person's pushes.
    const h = server.slice(server.indexOf('socket.on("conversation_open"'));
    expect(h.slice(0, 400)).toMatch(/memberIds\.includes\(userId\)\) return;/);
  });

  test("a disconnect clears it", () => {
    // A lock, a crash or a dropped network must not leave someone permanently un-pushed.
    const h = server.slice(server.indexOf('socket.on("disconnect"'));
    expect(h.slice(0, 200)).toMatch(/viewingConversation\.close\(socket\.id\)/);
  });

  test("closing the thread clears it", () => {
    expect(server).toMatch(/socket\.on\("conversation_close", \(\) => \{\n\s*viewingConversation\.close\(socket\.id\);/);
  });

  test("it is exposed to the routes", () => {
    expect(server).toMatch(/app\.set\("isViewingConversation", isViewingConversation\);/);
  });
});

describe("every send path honours it", () => {
  test("all four push sites are gated", () => {
    const gated = routes.match(/(if \(shouldPush\(member\.user_id, convId\)\)|if \(makeShouldPush\(req\)\([a-zA-Z]+, [a-zA-Z]+\)\)) sendPushToUser/g) || [];
    expect(gated.length).toBe(4);
  });

  test("no ungated sendPushToUser survives in this file", () => {
    const calls = routes.match(/[^)] sendPushToUser\(/g) || [];
    expect(calls).toHaveLength(0);
  });

  test("an unknown answer means the push goes out", () => {
    // The integration harness mounts routers without a socket server. Failing closed there
    // would silently disable message pushes for anyone whose socket layer is missing.
    const fn = routes.slice(routes.indexOf("function makeShouldPush"));
    expect(fn.slice(0, 300)).toMatch(/!\(typeof isViewing === "function" && isViewing\(memberId, convId\)\)/);
  });
});

describe("a live message reads the same as a refetched one", () => {
  test("the payload carries senderLabel", () => {
    // Without it, a message from the platform showed the admin's real name when it arrived
    // live, and "InPlace Support" after backing out — the inverse of 7972ed90.
    const fn = routes.slice(routes.indexOf("function liveMessagePayload"));
    expect(fn.slice(0, 400)).toMatch(/senderName: message\.sender_label \|\| realName/);
    expect(fn.slice(0, 400)).toMatch(/senderLabel: message\.sender_label \|\| null/);
  });

  test("every emit uses it", () => {
    expect((routes.match(/emitToUser\([^)]*"new_message", liveMessagePayload\(/g) || []).length).toBe(4);
    expect(routes).not.toMatch(/"new_message", \{\n\s*\.\.\.message, senderName/);
  });
});

describe("the client", () => {
  test("announces the open thread and closes it on unmount", () => {
    expect(client).toMatch(/sock\.emit\('conversation_open', \{ conversationId: activeConvId \}\)/);
    expect(client).toMatch(/sock\.emit\('conversation_close', \{\}\)/);
  });

  test("a hidden page is not a read page", () => {
    // A backgrounded tab or a locked phone still holds an open socket.
    expect(client).toMatch(/document\.hidden \? close\(\) : open\(\)/);
    expect(client).toMatch(/addEventListener\('visibilitychange', onVisibility\)/);
    expect(client).toMatch(/removeEventListener\('visibilitychange', onVisibility\)/);
  });

  test("a duplicate delivery does not double the message", () => {
    // connectSocket re-registers listeners on reconnect, so one delivery can arrive twice.
    expect(client).toMatch(/prev\.some\(m => m\.id === msg\.id\) \? prev : \[\.\.\.prev, msg\]/);
  });
});

// The rules above are read off the source. These RUN the registry — a suppression rule that
// is only source-matched is a rule nobody has actually executed.
describe("the registry itself", () => {
  const SOCK_PHONE = "sock-phone", SOCK_LAPTOP = "sock-laptop";
  const CONV = "conv-julia", OTHER = "conv-someone-else";

  test("a socket with the thread open suppresses", () => {
    const r = createViewRegistry();
    r.open(SOCK_PHONE, CONV);
    expect(r.isViewing([SOCK_PHONE], CONV)).toBe(true);
  });

  test("a different thread on the same socket does not", () => {
    const r = createViewRegistry();
    r.open(SOCK_PHONE, OTHER);
    expect(r.isViewing([SOCK_PHONE], CONV)).toBe(false);
  });

  test("one device open is enough, even when the other is elsewhere", () => {
    const r = createViewRegistry();
    r.open(SOCK_PHONE, OTHER);
    r.open(SOCK_LAPTOP, CONV);
    expect(r.isViewing([SOCK_PHONE, SOCK_LAPTOP], CONV)).toBe(true);
  });

  test("closing one device does not silence the other", () => {
    const r = createViewRegistry();
    r.open(SOCK_PHONE, CONV);
    r.open(SOCK_LAPTOP, CONV);
    r.close(SOCK_PHONE);
    expect(r.isViewing([SOCK_LAPTOP], CONV)).toBe(true);
    expect(r.isViewing([SOCK_PHONE], CONV)).toBe(false);
  });

  test("a user with no sockets is never viewing", () => {
    const r = createViewRegistry();
    r.open(SOCK_PHONE, CONV);
    expect(r.isViewing(undefined, CONV)).toBe(false);   // connectedUsers.get() miss
    expect(r.isViewing([], CONV)).toBe(false);
  });

  test("a stale entry cannot outlive the socket", () => {
    // The phone locks; socket.io fires disconnect; server.js calls close(). If that entry
    // survived, Pete would stop getting message pushes on that thread forever.
    const r = createViewRegistry();
    r.open(SOCK_PHONE, CONV);
    r.close(SOCK_PHONE);
    expect(r.size()).toBe(0);
    expect(r.isViewing([SOCK_PHONE], CONV)).toBe(false);
  });

  test("missing arguments never suppress", () => {
    const r = createViewRegistry();
    r.open(SOCK_PHONE, undefined);
    expect(r.size()).toBe(0);
    expect(r.isViewing([SOCK_PHONE], undefined)).toBe(false);
  });
});
