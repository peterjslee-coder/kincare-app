// A socket that has died without anyone noticing. (v1.105.175)
//
// Pete: "i just didn't see any of the messages until all 5 were there."
//
// The five pushes were sent and accepted — that was checked on production. What was NOT
// happening is live delivery, and the reason both halves failed together is one stale entry:
// a phone that locks mid-thread leaves a socket that is still registered and still claiming to
// be reading. For as long as the server believes that, every message is suppressed from push
// AND delivered to a socket that is not there. Lost in both directions, silently.

const { createViewRegistry } = require("../src/utils/presence");
const { code } = require("./helpers/source");
const fs = require("fs");
const path = require("path");
const REPO = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");

const server = read("src/server.js");
const utils = code("public/js/utils.js");
const messages = code("public/js/components/Messages.js");

describe("the claim to be reading a thread expires", () => {
  const SOCK = "sock-phone", CONV = "conv-julia";

  test("a fresh claim suppresses, as before", () => {
    const r = createViewRegistry();
    r.open(SOCK, CONV);
    expect(r.isViewing([SOCK], CONV)).toBe(true);
  });

  test("a claim nobody has renewed stops counting", () => {
    let t = 1_000_000;
    const r = createViewRegistry({ ttlMs: 45000, now: () => t });
    r.open(SOCK, CONV);
    t += 44_000;
    expect(r.isViewing([SOCK], CONV)).toBe(true);
    t += 2_000; // 46s since it was made
    expect(r.isViewing([SOCK], CONV)).toBe(false);
  });

  test("a page that is still on screen keeps it alive by re-asserting", () => {
    let t = 1_000_000;
    const r = createViewRegistry({ ttlMs: 45000, now: () => t });
    r.open(SOCK, CONV);
    for (let i = 0; i < 10; i++) { t += 20_000; r.open(SOCK, CONV); }
    expect(r.isViewing([SOCK], CONV)).toBe(true);
  });

  test("an expired claim is forgotten, not merely ignored", () => {
    // Otherwise the map grows for the life of the process, one entry per socket that ever
    // went quiet.
    let t = 1_000_000;
    const r = createViewRegistry({ ttlMs: 1000, now: () => t });
    r.open(SOCK, CONV);
    t += 5000;
    r.isViewing([SOCK], CONV);
    expect(r.size()).toBe(0);
  });

  test("expiry is per socket — one stale device does not unmute a live one", () => {
    let t = 1_000_000;
    const r = createViewRegistry({ ttlMs: 45000, now: () => t });
    r.open("sock-laptop", CONV);
    t += 60_000;
    r.open("sock-phone", CONV); // the phone is here and awake
    expect(r.isViewing(["sock-laptop", "sock-phone"], CONV)).toBe(true);
    expect(r.isViewing(["sock-laptop"], CONV)).toBe(false);
  });
});

describe("the server finds out sooner that a client is gone", () => {
  test("ping settings are stated rather than left to the defaults", () => {
    // Defaults are 25s + 20s, so a locked phone stayed registered for up to 45 seconds.
    expect(server).toMatch(/pingInterval: 10000/);
    expect(server).toMatch(/pingTimeout: 10000/);
  });

  test("there is something for a client to ask", () => {
    expect(server).toMatch(/socket\.on\("ping_check"/);
  });

  test("answering also refreshes the reading claim", () => {
    // A page awake enough to ask is awake enough to still be reading; making it a second round
    // trip would be a second thing to forget.
    const handler = server.slice(server.indexOf('socket.on("ping_check"'), server.indexOf('socket.on("disconnect"'));
    expect(handler).toMatch(/viewingConversation\.open\(socket\.id, convId\)/);
  });

  test("it tolerates both ack shapes", () => {
    // socket.emit(ev, cb) and socket.emit(ev, payload, cb) both reach here.
    const handler = server.slice(server.indexOf('socket.on("ping_check"'), server.indexOf('socket.on("disconnect"'));
    expect(handler).toMatch(/typeof payload === "function" \? payload : ack/);
  });
});

describe("the client stops believing the socket about itself", () => {
  test("coming back to the foreground asks the server, and acts on silence", () => {
    expect(utils).toMatch(/function probeSocket\(\)/);
    expect(utils).toMatch(/sock\.timeout\(SOCKET_PROBE_TIMEOUT_MS\)\.emit\(/);
    // No answer inside the window: tear it down and rebuild, because 'connect' is what every
    // screen's catch-up listens for.
    const probe = utils.slice(utils.indexOf("function probeSocket()"), utils.indexOf("window.__probeSocket"));
    expect(probe).toMatch(/sock\.disconnect\(\)/);
    expect(probe).toMatch(/sock\.connect\(\)/);
  });

  test("a socket that already knows it is gone is simply reconnected", () => {
    const probe = utils.slice(utils.indexOf("function probeSocket()"), utils.indexOf("window.__probeSocket"));
    expect(probe).toMatch(/if \(!sock\.connected\) \{ try \{ sock\.connect\(\); \} catch \{\} return; \}/);
  });

  test("three ways back count, not just one", () => {
    // A phone that never locked but lost signal in a lift produces no visibilitychange.
    expect(utils).toMatch(/visibilitychange/);
    expect(utils).toMatch(/addEventListener\('online', probeSocket\)/);
    expect(utils).toMatch(/addEventListener\('focus', probeSocket\)/);
  });

  test("the listeners outlive the socket they replace", () => {
    // They are the reason the socket gets replaced; binding them per connection would lose
    // them at the moment they matter.
    expect(utils).toMatch(/let _livenessBound = false;/);
    expect(utils).toMatch(/if \(_livenessBound\) return;/);
  });

  test("an older client build without .timeout() degrades instead of throwing", () => {
    expect(utils).toMatch(/if \(typeof sock\.timeout !== 'function'\) return;/);
  });
});

describe("the token is read at reconnect, not frozen at connect", () => {
  test("auth is a function", () => {
    // `auth: { token }` freezes whatever was current at connect time, so once it expires every
    // reconnection fails the handshake forever and the app goes quiet with no way back short
    // of a reload. Tokens last seven days — long enough for nobody to connect it to the
    // symptom.
    expect(utils).toMatch(/auth: \(cb\) => cb\(\{ token:/);
    expect(utils).not.toMatch(/io\(API_BASE, \{ auth: \{ token \}/);
  });
});

describe("Messages keeps its claim alive and catches up either way", () => {
  test("the open thread is published for the probe to re-assert", () => {
    // A probe fired from utils.js has no idea which thread is open.
    expect(messages).toMatch(/window\.__openConversationId = activeConvId;/);
    expect(messages).toMatch(/window\.__openConversationId = null;/);
  });

  test("a visible thread re-asserts on a timer", () => {
    expect(messages).toMatch(/if \(document\.visibilityState === 'visible'\) open\(\);\s*\n\s*\}, 20000\)/);
  });

  test("and the interval is cleared with the effect", () => {
    expect(messages).toMatch(/clearInterval\(beat\)/);
  });

  test("the conversation LIST catches up too, not only an open thread", () => {
    // Someone sitting on the list whose socket died saw a list that simply stopped updating,
    // with no thread to trigger the existing re-read.
    expect(messages).toMatch(/if \(activeConvId\) return; \/\/ the effect below covers an open thread/);
    expect(messages).toMatch(/const catchUpList = \(\) => fetchConversations\(\);/);
  });
});
