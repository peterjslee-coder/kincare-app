// v1.166.3 — Pete: "I see 19 counted as up, but only see one pic with no sound." The Hub's sound
// arrives as "data:audio/webm;codecs=opus;base64,..." and storage only read "data:<type>;base64,",
// so every minute with sound failed whole, picture included.
const mockStored = [];
let mockFailAudio = false;
jest.mock("../src/utils/storage", () => ({
  isEnabled: () => true,
  isRemote: (v) => typeof v === "string" && v.startsWith("r2:"),
  storeFileData: async (prefix, uri) => {
    const m = String(uri).match(/^data:([^;,]+);base64,(.+)$/s); // the real storage's rule
    if (!m) return uri;
    if (mockFailAudio && m[1].startsWith("audio/")) throw new Error("R2 down");
    mockStored.push(m[1]);
    return "r2:" + prefix + "/" + mockStored.length;
  },
  deleteFileData: async () => {},
}));
const R = require("../src/utils/hubReview");

function fakeDb() {
  const rows = [];
  return { rows, prepare: (sql) => ({ run: async (...a) => { if (/INSERT INTO hub_review_clips/.test(sql)) rows.push(a); } }) };
}
const PHOTO = "data:image/jpeg;base64,/9j/AAAA";
const AUDIO = "data:audio/webm;codecs=opus;base64,GkXfowEAAAA=";

beforeEach(() => { mockStored.length = 0; mockFailAudio = false; });

test("sound labelled with codecs is stored, alongside the picture", async () => {
  const db = fakeDb();
  expect(await R.saveClip(db, "cr", { photo: PHOTO, audio: AUDIO, counted: true, signals: { light: 12.4 } })).toEqual({ saved: true });
  expect(mockStored).toEqual(["image/jpeg", "audio/webm"]);
  const [, , counted, signals, photoRef, audioRef] = db.rows[0];
  expect(counted).toBe(true);
  expect(photoRef).toMatch(/^r2:/);
  expect(audioRef).toMatch(/^r2:/);
  expect(JSON.parse(signals).light).toBe(12);
});

test("if the sound can't be stored, the picture is still kept", async () => {
  mockFailAudio = true;
  const db = fakeDb();
  expect(await R.saveClip(db, "cr", { photo: PHOTO, audio: AUDIO, counted: false, signals: {} })).toEqual({ saved: true });
  const [, , , , photoRef, audioRef] = db.rows[0];
  expect(photoRef).toMatch(/^r2:/);
  expect(audioRef).toBeNull();
});
