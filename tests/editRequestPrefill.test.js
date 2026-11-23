const { code } = require('./helpers/source');
const src = code('public/js/components/RequestCareModal.js');

describe('Edit request keeps values the pills do not list', () => {
  test('duration is never truncated to an integer', () => {
    expect(src).not.toMatch(/parseInt\(duration\)/);
    expect(src).toMatch(/durationHours:\s*Number\(duration\)/);
  });
  test('an off-list duration survives an edit as its end time', () => {
    // v1.150.0 — there is no fixed list of lengths any more: the request carries an END, and a
    // 4.5-hour draft reopens as start + "ends 12:30" rather than being squeezed onto a pill.
    expect(src).toMatch(/setEndTime\(d\.durationHours != null \? TimeRange\.endOf\(d\.time \|\| '08:00', d\.durationHours\) : ''\)/);
  });
  test('an off-list care type gets its own selected pill', () => {
    expect(src).toMatch(/!serviceOptions\.some\(o => o\.value === serviceType\)/);
  });
});
