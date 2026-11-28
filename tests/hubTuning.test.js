// v1.167.0 — Pete: "I want to be able to train the system." ... "Suggest and confirm."
const T = require("../src/utils/hubTuning");

const m = (verdict, counted, signals) => ({ verdict, counted, signals });
const many = (n, f) => Array.from({ length: n }, (_, i) => f(i));

test("defaults and cleaning", () => {
  expect(T.cleanTuning(null)).toEqual({ personMin: 0.45, motionNearPerson: true, soundNearPerson: true });
  expect(T.cleanTuning({ personMin: 2, soundNearPerson: "no" })).toEqual({ personMin: 0.8, motionNearPerson: true, soundNearPerson: true });
});

test("nothing is suggested from a handful of marks", () => {
  const marks = many(4, () => m("not_up", true, { person: false, voiceSeconds: 40 }));
  expect(T.suggestions(marks, null).suggestions).toEqual([]);
});

test("sound counted near a person but marked wrong → suggest switching sound off", () => {
  const marks = [...many(7, () => m("not_up", true, { person: false, voiceSeconds: 40 })), ...many(2, () => m("right", true, { person: false, voiceSeconds: 30 }))];
  const s = T.suggestions(marks, null);
  expect(s.score).toEqual({ marked: 9, right: 2, notUp: 7, missed: 0 });
  expect(s.suggestions).toEqual([expect.objectContaining({ key: "soundNearPerson", change: { soundNearPerson: false } })]);
  // Already off: not suggested again.
  expect(T.suggestions(marks, { soundNearPerson: false }).suggestions).toEqual([]);
});

test("a 'person' that often isn't her → stricter; missed minutes → less strict", () => {
  const strict = T.suggestions(many(6, (i) => m(i < 3 ? "not_up" : "right", true, { person: true })), null);
  expect(strict.suggestions[0]).toMatchObject({ key: "personMin", change: { personMin: 0.55 } });
  const lax = T.suggestions(many(6, (i) => m(i < 4 ? "missed" : "right", false, { person: false, motion: true })), null);
  expect(lax.suggestions[0]).toMatchObject({ key: "personMin", change: { personMin: 0.35 } });
});

test("what made a minute count", () => {
  expect(T.reasonOf({ person: true, voiceSeconds: 50 })).toBe("person");
  expect(T.reasonOf({ touches: 2 })).toBe("touch");
  expect(T.reasonOf({ voiceSeconds: 30 })).toBe("sound");
  expect(T.reasonOf({ motion: true })).toBe("movement");
});
