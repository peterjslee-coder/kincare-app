// v1.165.0 — Pete: "Can I see if she's currently in a call?"
const L = require("../src/utils/liveCall");

const fakeTwilio = (rooms) => ({
  video: { v1: Object.assign((sid) => ({ participants: { list: async () => rooms.find((r) => r.sid === sid).ps } }), {}) },
});
function tw(rooms) {
  const t = fakeTwilio(rooms);
  t.video.v1.rooms = Object.assign((sid) => ({ participants: { list: async () => rooms.find((r) => r.sid === sid).ps } }),
    { list: async () => rooms.map((r) => ({ sid: r.sid, uniqueName: r.sid, dateCreated: "2026-11-26T16:50:00Z" })) });
  return t;
}

beforeEach(() => L._reset());

test("in a call: connected with someone else", async () => {
  const client = tw([{ sid: "RM1", ps: [{ identity: "betty", startTime: "2026-11-26T16:52:00Z" }, { identity: "sara" }] }]);
  expect(await L.callFor("betty", { client, now: 1 })).toEqual({ inCall: true, since: "2026-11-26T16:52:00Z", withIds: ["sara"] });
});
test("alone in a room (still ringing out) is not a call", async () => {
  const client = tw([{ sid: "RM1", ps: [{ identity: "betty" }] }]);
  expect(await L.callFor("betty", { client, now: 1 })).toEqual({ inCall: false });
});
test("no Twilio, or Twilio failing, is 'unknown', never 'not in a call'", async () => {
  expect(await L.callFor("betty", { client: null, now: 1 })).toEqual({ inCall: null });
  const broken = { video: { v1: { rooms: Object.assign(() => ({}), { list: async () => { throw new Error("down"); } }) } } };
  expect(await L.callFor("betty", { client: broken, now: 2 })).toEqual({ inCall: null });
});
test("one snapshot serves everyone for 15 s", async () => {
  let n = 0;
  const client = tw([]);
  const list = client.video.v1.rooms.list;
  client.video.v1.rooms.list = async (...a) => { n += 1; return list(...a); };
  await L.callFor("a", { client, now: 1000 });
  await L.callFor("b", { client, now: 1000 + L.SNAPSHOT_MS - 1 });
  expect(n).toBe(1);
  await L.callFor("c", { client, now: 1000 + L.SNAPSHOT_MS + 1 });
  expect(n).toBe(2);
});
