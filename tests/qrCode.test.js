// v1.105.26 — the QR codes, and the one way this feature goes wrong.
//
// A QR is a URL nobody reads before following. That is the whole point of it and also the
// only real risk: an endpoint that renders a QR for arbitrary text is a small open redirect
// with extra steps, because anyone could mint an official-looking yourinplace.com code
// pointing wherever they liked. So the endpoint takes NO input.

const fs = require("fs");
const path = require("path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

describe("the referral QR endpoint cannot encode arbitrary text", () => {
  const ref = strip(read("src/routes/referrals.js"));
  const handler = ref.slice(ref.indexOf('router.get("/qr"'), ref.indexOf('router.post("/send"'));

  test("it exists and requires auth", () => {
    expect(handler).toMatch(/router\.get\("\/qr", authenticate/);
  });

  test("it reads NOTHING from the request", () => {
    // No req.query, no req.body, no req.params. The encoded value is derived only from the
    // authenticated user's own referral code.
    expect(handler).not.toMatch(/req\.query/);
    expect(handler).not.toMatch(/req\.body/);
    expect(handler).not.toMatch(/req\.params/);
    expect(handler).toMatch(/ensureReferralCode\(db, req\.user\.id\)/);
  });

  test("per-user output is never publicly cached", () => {
    // A shared cache would hand one caregiver's referral code to the next visitor.
    expect(handler).toMatch(/private/);
    expect(handler).not.toMatch(/public/);
  });

  test("it encodes the same link the copy box shows", () => {
    // If these drift, someone's QR silently stops crediting them.
    const linkExpr = /\$\{process\.env\.BASE_URL \|\| "https:\/\/yourinplace\.com"\}\/register\?ref=\$\{code\}&role=caregiver/;
    expect(handler).toMatch(linkExpr);
    const myCode = ref.slice(ref.indexOf('router.get("/my-code"'), ref.indexOf('router.get("/qr"'));
    expect(myCode).toMatch(linkExpr);
  });
});

describe("the homepage QR", () => {
  test("the static asset exists and is a real SVG", () => {
    const svg = read("public/img/qr-yourinplace.svg");
    expect(svg).toMatch(/^<\?xml|^<svg/);
    expect(svg.length).toBeGreaterThan(500);
  });

  test("the splash page shows it with alt text", () => {
    // Alt text matters more than usual here: a screen-reader user cannot scan a QR, so the
    // alt is the only thing telling them what they are missing.
    const splash = read("public/js/components/SplashPage.js");
    expect(splash).toMatch(/qr-yourinplace\.svg/);
    expect(splash).toMatch(/alt="QR code linking to yourinplace\.com"/);
  });
});

describe("the in-app QR", () => {
  const hub = read("public/js/components/CaretakerHub.js");

  test("it points at the endpoint, not at a hardcoded image", () => {
    expect(hub).toMatch(/src="\/api\/referrals\/qr"/);
    expect(hub).toMatch(/alt="QR code for your referral link"/);
  });

  test("it is opt-in, not always rendered", () => {
    // Rendering it unconditionally would fetch a per-user SVG on every Hub load for a
    // control most caregivers use rarely.
    expect(hub).toMatch(/showReferralQr/);
  });
});

// ─── the codes actually decode ───
// Generating a QR nobody verified is how you print 500 flyers with a dead link on them.
describe("generated codes round-trip", () => {
  test("the homepage SVG encodes exactly the site URL", async () => {
    const QRCode = require("qrcode");
    const expected = await QRCode.toString("https://yourinplace.com", {
      type: "svg", errorCorrectionLevel: "H", margin: 2,
      color: { dark: "#1b6b5a", light: "#FFFFFF" },
    });
    // Byte-identical to a fresh render of the intended URL — so a hand-edited or
    // stale-committed asset fails here rather than in someone's camera.
    expect(read("public/img/qr-yourinplace.svg").trim()).toBe(expected.trim());
  });
});
