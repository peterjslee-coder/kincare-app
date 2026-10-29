// calls-native (1.3) — the server half of ringing a phone like a phone.
// See src/utils/callRegistry.js, src/utils/callDevices.js, src/routes/calls.js.

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-calls";

const fs = require("fs");
const path = require("path");
const express = require("express");
const request = require("supertest");

const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

describe("callToken: one room, one person, two minutes", () => {
  const reg = require("../src/utils/callRegistry");
  beforeEach(() => reg._reset());

  test("a pass verifies for its own room and person", () => {
    const t = reg.signCallToken("inplace-abc-1", "user-1");
    expect(reg.verifyCallToken(t, "inplace-abc-1")).toEqual({ roomName: "inplace-abc-1", userId: "user-1" });
  });

  test("the same pass is refused for any other room", () => {
    const t = reg.signCallToken("inplace-abc-1", "user-1");
    expect(reg.verifyCallToken(t, "inplace-abc-2")).toBeNull();
  });

  test("an expired pass is refused", () => {
    const t = reg.signCallToken("inplace-abc-1", "user-1", Date.now() - reg.TOKEN_MS - 1);
    expect(reg.verifyCallToken(t, "inplace-abc-1")).toBeNull();
  });

  test("a pass with its claims edited is refused", () => {
    const t = reg.signCallToken("inplace-abc-1", "user-1");
    const [, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ r: "inplace-abc-1", u: "someone-else", e: Date.now() + 60000 }))
      .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(reg.verifyCallToken(`${forged}.${sig}`, "inplace-abc-1")).toBeNull();
    expect(reg.verifyCallToken("garbage", "inplace-abc-1")).toBeNull();
    expect(reg.verifyCallToken(null, "inplace-abc-1")).toBeNull();
  });
});

describe("a ring has one ending", () => {
  const reg = require("../src/utils/callRegistry");
  beforeEach(() => reg._reset());
  const ring = (now) => reg.startCall({ roomName: "inplace-r-1", callerId: "a", targetUserId: "b", callType: "video" }, now);

  test("answered stays answered: a second device cannot decline it", () => {
    ring();
    expect(reg.finishCall("inplace-r-1", "answered", "b").changed).toBe(true);
    expect(reg.finishCall("inplace-r-1", "declined", "b").changed).toBe(false);
    expect(reg.getCall("inplace-r-1").state).toBe("answered");
  });

  test("hang-up ends an answered call", () => {
    ring();
    reg.finishCall("inplace-r-1", "answered", "b");
    expect(reg.finishCall("inplace-r-1", "ended", "a").changed).toBe(true);
  });

  test("an unanswered ring becomes missed and cannot be answered late", () => {
    const t0 = Date.now();
    ring(t0);
    const later = t0 + reg.RING_MS + 1000;
    expect(reg.getCall("inplace-r-1", later).state).toBe("missed");
    expect(reg.finishCall("inplace-r-1", "answered", "b", later).changed).toBe(false);
  });

  test("a room name that is not a room name is never recorded", () => {
    expect(reg.startCall({ roomName: "../../etc", callerId: "a", targetUserId: "b" })).toBeNull();
  });

  test("each ring gets its own CallKit UUID", () => {
    const a = ring(); const b = ring();
    expect(a.callUuid).not.toEqual(b.callUuid);
  });
});

describe("the VoIP push is a ring and nothing else", () => {
  test("voip topic, voip push type, no alert, short expiry", async () => {
    jest.resetModules();
    const sent = {};
    jest.doMock("http2", () => ({
      connect: () => {
        const client = { on: () => {}, close: () => {}, destroy: () => {} };
        client.request = (headers) => {
          sent.headers = headers;
          const handlers = {};
          const req = {
            setEncoding: () => {},
            on: (ev, fn) => { handlers[ev] = fn; return req; },
            end: (body) => { sent.body = body; setImmediate(() => { handlers.response({ ":status": 200 }); handlers.end(); }); },
          };
          return req;
        };
        return client;
      },
    }));
    const crypto = require("crypto");
    const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    process.env.APNS_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
    process.env.APNS_KEY_ID = "TESTKEY123";
    process.env.APNS_TEAM_ID = "TESTTEAM12";
    const apns = require("../src/utils/apns");
    await apns.sendApnsVoip("abc123", { type: "call_ring", roomName: "inplace-x" });
    expect(sent.headers["apns-topic"]).toBe("com.yourinplace.app.voip");
    expect(sent.headers["apns-push-type"]).toBe("voip");
    expect(sent.headers["apns-priority"]).toBe("10");
    const exp = Number(sent.headers["apns-expiration"]) - Math.floor(Date.now() / 1000);
    expect(exp).toBeLessThanOrEqual(60);
    const body = JSON.parse(sent.body);
    expect(body.aps).toBeUndefined();
    expect(body.type).toBe("call_ring");
    jest.dontMock("http2");
    delete process.env.APNS_KEY; delete process.env.APNS_KEY_ID; delete process.env.APNS_TEAM_ID;
  });
});

describe("/api/calls: the callToken is the only way in", () => {
  let app; let reg; const emitted = [];
  beforeAll(() => {
    jest.resetModules();
    jest.doMock("../src/middleware/auth", () => ({
      authenticate: (req, res, next) => { req.user = { id: req.get("X-Test-User") }; if (!req.user.id) return res.status(401).end(); next(); },
    }));
    jest.doMock("../src/utils/callDevices", () => ({
      registerCallDevice: jest.fn(async () => {}),
      removeCallDevice: jest.fn(async () => {}),
    }));
    reg = require("../src/utils/callRegistry");
    reg.setEmitter((uid, event, payload) => { emitted.push({ uid, event, payload }); return 1; });
    app = express();
    app.use(express.json());
    app.use("/api/calls", require("../src/routes/calls"));
  });
  beforeEach(() => { reg._reset(); emitted.length = 0; reg.setEmitter((uid, event, payload) => { emitted.push({ uid, event, payload }); return 1; }); });
  afterAll(() => { jest.dontMock("../src/middleware/auth"); jest.dontMock("../src/utils/callDevices"); });

  const startRing = () => reg.startCall({ roomName: "inplace-q-1", callerId: "caller", targetUserId: "callee", callType: "audio" });

  test("no pass, no status", async () => {
    startRing();
    await request(app).get("/api/calls/inplace-q-1/status").expect(403);
  });

  test("the callee's pass reads status and declines; the caller hears it", async () => {
    startRing();
    const t = reg.signCallToken("inplace-q-1", "callee");
    const s = await request(app).get("/api/calls/inplace-q-1/status").set("X-Call-Token", t).expect(200);
    expect(s.body.state).toBe("ringing");
    const d = await request(app).post("/api/calls/inplace-q-1/decline").send({ callToken: t }).expect(200);
    expect(d.body.state).toBe("declined");
    expect(emitted).toEqual(expect.arrayContaining([
      expect.objectContaining({ uid: "caller", event: "call_declined" }),
    ]));
  });

  test("a valid pass for someone who is not the callee cannot answer", async () => {
    startRing();
    const t = reg.signCallToken("inplace-q-1", "caller");
    await request(app).post("/api/calls/inplace-q-1/answer").set("X-Call-Token", t).expect(404);
    expect(reg.getCall("inplace-q-1").state).toBe("ringing");
  });

  test("answering tells the caller and stops the callee's other apps ringing", async () => {
    startRing();
    const t = reg.signCallToken("inplace-q-1", "callee");
    const r = await request(app).post("/api/calls/inplace-q-1/answer").set("X-Call-Token", t).expect(200);
    expect(r.body).toMatchObject({ state: "answered", won: true });
    expect(emitted.map((e) => `${e.uid}:${e.event}`)).toEqual(["caller:call_accepted", "callee:call_answered_elsewhere"]);
  });

  test("a second phone answering the same call is told it lost, and tells nobody", async () => {
    startRing();
    const t = reg.signCallToken("inplace-q-1", "callee");
    await request(app).post("/api/calls/inplace-q-1/answer").set("X-Call-Token", t).expect(200);
    emitted.length = 0;
    const r = await request(app).post("/api/calls/inplace-q-1/answer").set("X-Call-Token", t).expect(200);
    expect(r.body).toMatchObject({ state: "answered", won: false });
    expect(emitted).toEqual([]);
  });

  test("registering a device during impersonation is skipped", async () => {
    const appImp = express();
    appImp.use(express.json());
    appImp.use((req, res, next) => { req.headers["x-test-user"] = "admin"; next(); });
    jest.resetModules();
    jest.doMock("../src/middleware/auth", () => ({
      authenticate: (req, res, next) => { req.user = { id: "u", impersonatedBy: "admin" }; next(); },
    }));
    appImp.use("/api/calls", require("../src/routes/calls"));
    const r = await request(appImp).post("/api/calls/devices").send({ platform: "ios", token: "x".repeat(64) }).expect(200);
    expect(r.body.skipped).toBe("impersonation");
  });
});

describe("the 1.2 store build cannot tell any of this exists", () => {
  const bridge = read("public/js/nativeCalls.js");
  const server = read("src/server.js");
  const push = read("src/routes/push.js");

  test("every bridge entry point checks for the native plugin first", () => {
    expect(bridge).toMatch(/isPluginAvailable\(PLUGIN\)/);
    expect(bridge).toMatch(/async function start\(\) \{\s*const p = plugin\(\);\s*if \(!p \|\| _started\) return false;/);
    expect(bridge).toMatch(/function ended\(roomName\) \{\s*const p = plugin\(\);\s*if \(!p \|\| !roomName\) return;/);
  });

  test("call devices live in their own table, not push_subscriptions", () => {
    const { code } = require("./helpers/source");
    expect(code("src/utils/callDevices.js")).not.toMatch(/push_subscriptions/);
    expect(code("src/routes/push.js")).not.toMatch(/call_devices/);
  });

  test("a failed native ring can never cost the ordinary ring", () => {
    const invite = server.slice(server.indexOf('socket.on("call_invite"'), server.indexOf('socket.on("call_accept"'));
    expect(invite).toMatch(/catch \(e\) \{\s*\/\/ Native ringing failing must never cost the call/);
    expect(invite).toMatch(/\{ skipEndpoints \}/);
  });

  test("the banner is hidden only when this phone really is ringing natively", () => {
    const messages = read("public/js/components/Messages.js");
    expect(messages).toMatch(/data\.ringingNatively && window\.NativeCalls && window\.NativeCalls\.available\(\)/);
  });
});
