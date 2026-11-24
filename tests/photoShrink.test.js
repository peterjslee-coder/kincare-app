// v1.155.1 — the server shrinks every uploaded photo with sharp. sharp was a devDependency, so
// production had no sharp and the first deploy quietly stored originals (the fallback for an
// unreadable file). These pin both halves: it ships, and it actually shrinks.
const pkg = require("../package.json");
const { shrinkPhoto, cleanCrop } = require("../src/utils/photoShrink");

test("sharp is a production dependency, not a dev one", () => {
  expect(pkg.dependencies && pkg.dependencies.sharp).toBeTruthy();
  expect(pkg.devDependencies && pkg.devDependencies.sharp).toBeFalsy();
});

test("a big photo comes back as a JPEG no longer than 2000 px, cropped when asked", async () => {
  const sharp = require("sharp");
  const big = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#3f8f6b" } }).png().toBuffer();
  const r = await shrinkPhoto(big, "image/png");
  expect(r.ok).toBe(true);
  expect(r.mime).toBe("image/jpeg");
  const m = await sharp(r.buffer).metadata();
  expect([m.width, m.height]).toEqual([2000, 1500]);
  const c = await shrinkPhoto(big, "image/png", JSON.stringify({ x: 0.25, y: 0, w: 0.5, h: 1 }));
  const mc = await sharp(c.buffer).metadata();
  expect(mc.width / mc.height).toBeCloseTo(2000 / 3000, 2);
});

test("cleanCrop rejects nonsense and the whole picture", () => {
  expect(cleanCrop("nope")).toBeNull();
  expect(cleanCrop({ x: 0, y: 0, w: 1, h: 1 })).toBeNull();
  expect(cleanCrop({ x: 0.5, y: 0.5, w: 0.9, h: 0.9 })).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
});
