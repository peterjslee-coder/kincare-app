const { code } = require('./helpers/source');
const src = code('public/js/components/RequestCareModal.js');

describe('Edit request keeps values the pills do not list', () => {
  test('duration is never truncated to an integer', () => {
    expect(src).not.toMatch(/parseInt\(duration\)/);
    expect(src).toMatch(/durationHours:\s*Number\(duration\)/);
  });
  test('an off-list duration gets its own selected pill', () => {
    expect(src).toMatch(/!durationOptions\.some\(o => o\.value === duration\)/);
  });
  test('an off-list care type gets its own selected pill', () => {
    expect(src).toMatch(/!serviceOptions\.some\(o => o\.value === serviceType\)/);
  });
});
