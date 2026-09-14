/**
 * v1.106.32 — record an appointment, keep the words, never keep the audio. (5a0812c1, 69e94225)
 *
 * Pete asked twice in one day and chose "record in-app, transcribe, then delete audio". The
 * implementation does better than delete: the audio is never written. It arrives in memory,
 * goes to the transcriber, and the buffer goes out of scope — no row, no object, no temp
 * file, nothing to purge or hand over.
 *
 * That property is what this file is mostly about, because it is the one that cannot be
 * checked by looking at a screen. Both providers are mocked at module level — nothing here
 * reaches a live key, and nothing here spends money (Dev Rule #7's sibling).
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "transcribe-secret";
process.env.ELEVENLABS_API_KEY = "test-elevenlabs-key";
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

const mockTranscribe = jest.fn();
const mockExtract = jest.fn();

// The real module, with only the two outbound calls replaced. The route's own logic — the
// consent gate, the access check, what goes in the note — is the thing under test.
jest.mock("../../src/utils/transcription", () => {
  const actual = jest.requireActual("../../src/utils/transcription");
  return {
    ...actual,
    transcribeAudio: (...a) => mockTranscribe(...a),
    extractAppointmentNotes: (...a) => mockExtract(...a),
  };
});

const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, db, pete, tina, stranger, recipientId, teamId, eventId;

const soon = () => {
  const d = new Date(); d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
};

const AUDIO = Buffer.from("fake audio bytes for the test");

const post = (token, { consent = "true", audio = AUDIO, id } = {}) => {
  const req = h.request.post(`/api/care-events/${id || eventId}/transcribe`).set(h.auth(token));
  if (consent !== null) req.field("consent_confirmed", consent);
  if (audio) req.attach("audio", audio, { filename: "appointment.webm", contentType: "audio/webm" });
  return req;
};

const notesFor = (evId) => db.prepare(
  "SELECT id, content, note_type, care_event_id FROM recipient_notes WHERE care_event_id = ?"
).all(evId);

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/care-events": "../../src/routes/careEvents" } });
  db = h.db;
  pete = await h.createUser({ firstName: "Pete", lastName: "ITest" });
  tina = await h.createUser({ roles: ["caregiver"], firstName: "Tina", lastName: "ITest" });
  stranger = await h.createUser({ firstName: "Nobody", lastName: "ITest" });
  ({ recipientId, teamId } = await h.createCareTeam({ familyUserId: pete.user.id }));
  await h.addTeamMember(teamId, tina.user.id, "member");
});

beforeEach(async () => {
  mockTranscribe.mockReset();
  mockExtract.mockReset();
  mockTranscribe.mockResolvedValue({
    text: "Doctor: her blood pressure is high. Starting amlodipine five milligrams, mornings. Back in six weeks.",
    languageCode: "eng",
    speakers: 2,
  });
  mockExtract.mockResolvedValue({
    summary: "Blood pressure is high. New daily tablet, review in six weeks.",
    items: [
      { kind: "medication", text: "Amlodipine 5mg, every morning" },
      { kind: "follow_up", text: "Back in six weeks" },
    ],
  });

  const res = await h.request.post("/api/care-events").set(h.auth(pete.token)).send({
    care_recipient_id: recipientId, title: "Dr. Lambert", category: "medical",
    event_date: soon(), event_time: "14:00",
  });
  eventId = res.body.event.id;
});

afterEach(async () => {
  await db.prepare("DELETE FROM recipient_notes WHERE care_recipient_id = ?").run(recipientId);
  await db.prepare("DELETE FROM care_events WHERE care_recipient_id = ?").run(recipientId);
});
afterAll(async () => { await stopHarness(h); });

describe("the audio", () => {
  test("is never written anywhere", async () => {
    // THE assertion. A recording of a medical consultation is the most sensitive thing this
    // product could hold, and the safest version of holding it is not holding it.
    await post(pete.token).expect(200);

    const note = notesFor(eventId).then ? (await notesFor(eventId))[0] : notesFor(eventId)[0];
    const row = (await db.prepare("SELECT * FROM recipient_notes WHERE care_event_id = ?").get(eventId));
    expect(row).toBeTruthy();
    // No column on the note holds it...
    expect(row.photo).toBeNull();
    // ...and the bytes appear nowhere in what was stored.
    expect(JSON.stringify(row)).not.toContain(AUDIO.toString("base64"));
    expect(JSON.stringify(row)).not.toContain(AUDIO.toString("utf8"));
  });

  test("reaches the transcriber exactly once, and by buffer", async () => {
    await post(pete.token).expect(200);
    expect(mockTranscribe).toHaveBeenCalledTimes(1);
    const [buf, mime] = mockTranscribe.mock.calls[0];
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(mime).toMatch(/audio\/webm/);
  });

  test("no audio, no call and no note", async () => {
    const res = await post(pete.token, { audio: null });
    expect(res.status).toBe(400);
    expect(mockTranscribe).not.toHaveBeenCalled();
    expect(await notesFor(eventId)).toHaveLength(0);
  });
});

describe("consent", () => {
  test("without it, nothing is transcribed and nothing is filed", async () => {
    const res = await post(pete.token, { consent: null });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/consent/i);
    expect(mockTranscribe).not.toHaveBeenCalled();
    expect(await notesFor(eventId)).toHaveLength(0);
  });

  test("a literal false is refused too", async () => {
    const res = await post(pete.token, { consent: "false" });
    expect(res.status).toBe(400);
    expect(mockTranscribe).not.toHaveBeenCalled();
  });

  test("the note records who confirmed it — asking is part of the record", async () => {
    await post(pete.token).expect(200);
    const row = await db.prepare("SELECT content FROM recipient_notes WHERE care_event_id = ?").get(eventId);
    expect(row.content).toMatch(/Pete ITest/);
    expect(row.content).toMatch(/confirmed consent to record/i);
    expect(row.content).toMatch(/Audio was not kept/i);
  });
});

describe("what gets filed", () => {
  test("a care note on the appointment, not a field on it", async () => {
    await post(pete.token).expect(200);
    const rows = await notesFor(eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0].care_event_id).toBe(eventId);
    expect(rows[0].note_type).toBe("visit_summary");
  });

  test("the summary and the extracted items are in it", async () => {
    await post(pete.token).expect(200);
    const row = await db.prepare("SELECT content FROM recipient_notes WHERE care_event_id = ?").get(eventId);
    expect(row.content).toMatch(/New daily tablet, review in six weeks/);
    expect(row.content).toMatch(/Medication: Amlodipine 5mg/);
    expect(row.content).toMatch(/Follow-up: Back in six weeks/);
  });

  test("the transcript is kept verbatim — the extraction can be wrong", async () => {
    // What was actually said is the record. A model's summary of a medical appointment is
    // not a substitute for it.
    await post(pete.token).expect(200);
    const row = await db.prepare("SELECT content FROM recipient_notes WHERE care_event_id = ?").get(eventId);
    expect(row.content).toMatch(/Starting amlodipine five milligrams/);
  });

  test("a failed extraction still files the transcript", async () => {
    // The transcript is the valuable part and it is already in hand. Losing it because the
    // summariser fell over would be the worst outcome of the whole feature.
    mockExtract.mockResolvedValue(null);
    const res = await post(pete.token);
    expect(res.status).toBe(200);
    expect(res.body.extracted).toBe(false);
    const row = await db.prepare("SELECT content FROM recipient_notes WHERE care_event_id = ?").get(eventId);
    expect(row.content).toMatch(/Starting amlodipine five milligrams/);
  });

  test("it reads back on the appointment", async () => {
    await post(pete.token).expect(200);
    const res = await h.request.get(`/api/care-events/${eventId}/notes`).set(h.auth(pete.token));
    expect(res.status).toBe(200);
    expect(res.body.notes).toHaveLength(1);
  });
});

describe("who may record", () => {
  test("the caregiver at the visit can — she is the one who was there", async () => {
    const res = await post(tina.token);
    expect(res.status).toBe(200);
  });

  test("someone with no access to this person cannot", async () => {
    const res = await post(stranger.token);
    expect(res.status).toBe(403);
    expect(mockTranscribe).not.toHaveBeenCalled();
    expect(await notesFor(eventId)).toHaveLength(0);
  });

  test("an appointment that does not exist is a 404, not a transcription bill", async () => {
    const res = await post(pete.token, { id: uuid() });
    expect(res.status).toBe(404);
    expect(mockTranscribe).not.toHaveBeenCalled();
  });
});

describe("when the transcriber fails", () => {
  test("its status and message are passed through, and nothing is filed", async () => {
    const { TranscriptionError } = jest.requireActual("../../src/utils/transcription");
    mockTranscribe.mockRejectedValue(new TranscriptionError("Nothing was said in that recording.", 422));
    const res = await post(pete.token);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/Nothing was said/);
    expect(await notesFor(eventId)).toHaveLength(0);
  });

  test("an unexpected failure is a 500 and does not echo the internal message", async () => {
    // `e.status || 502` with `e.message` would hand any internal failure to the user — and
    // this is the one path where a stray message could carry a fragment of what was said.
    mockTranscribe.mockRejectedValue(new Error("boom: amlodipine five milligrams"));
    const res = await post(pete.token);
    expect(res.status).toBe(500);
    expect(res.body.error).not.toMatch(/amlodipine/);
    expect(res.body.error).not.toMatch(/boom/);
    expect(await notesFor(eventId)).toHaveLength(0);
  });
});
