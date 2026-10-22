// v1.124.5 — yourinplace.com must be a real page without JavaScript.
//
// Carriers rejected the outreach text campaign on 10/21: "rejected because of unverifiable
// website." To any fetch that doesn't run JavaScript, the home page was a <title> and an empty
// <div id="root">. A plain-HTML home page now lives inside #root (React replaces it on start) and
// is hidden from JavaScript browsers by a class set before it renders, so visitors see no flash.
const fs = require("fs");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
const root = html.slice(html.indexOf('<div id="root">'), html.indexOf("</main>", html.indexOf('<div id="root">')));

test("the static home page sits inside #root, so the app replaces it", () => {
  expect(root).toMatch(/<div id="root">\s*<main id="static-home">/);
});

test("it is hidden only once JavaScript has run", () => {
  expect(html).toMatch(/<script>document\.documentElement\.className \+= ' js';<\/script>/);
  expect(html).toMatch(/\.js #static-home\{display:none\}/);
  expect(html.indexOf("className += ' js'")).toBeLessThan(html.indexOf('<div id="root">'));
});

test("it says who we are, what we do, how to reach us, and links the legal pages", () => {
  for (const re of [/InPlace Care/, /Cedar Rock Holdings, LLC/, /non-medical caregivers/, /peter@yourinplace\.com/,
    /href="\/privacy"/, /href="\/terms"/, /href="\/sms"/]) expect(root).toMatch(re);
});

test("it carries the JOIN call to action with the carrier disclosure", () => {
  expect(root).toMatch(/Text JOIN to \(540\) 835-5987/);
  expect(root).toMatch(/By texting JOIN you agree to receive texts from InPlace Care about caregiving work\. Msg &amp; data rates may apply\. Msg frequency varies\. Reply STOP to opt out, HELP for help\./);
});

test("the contact email is readable without JavaScript (Cloudflare email obfuscation skipped)", () => {
  expect(root).toMatch(/<!--email_off--><a href="mailto:peter@yourinplace\.com">peter@yourinplace\.com<\/a><!--\/email_off-->/);
});
