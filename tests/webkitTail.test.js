// v1.105.69 — the rest of the WebKit tail: things that look like they worked and didn't.
//
// Same family as the PDF white rectangle, and mostly worse, because these actively assert
// success. A toast saying "Link copied!" one line after a clipboard write that threw is not a
// missing feature — it is the app telling the user something untrue.
//
// The 2FA backup codes were the sharpest of them. Those codes are the only way back into an
// account whose authenticator is lost, and the handler could fail three ways at once:
// navigator.clipboard is undefined in an insecure context or an older WebView, so
// `navigator.clipboard.writeText(...)` threw a TypeError SYNCHRONOUSLY — before the .catch was
// attached, so the fallback never ran — and that fallback selected `#backup-codes-text`, an
// element that exists nowhere in this repo.

const { code, raw } = require("./helpers/source");

const utils = code("public/js/utils.js");
const twofa = code("public/js/components/TwoFactorSetup.js");
const hub = code("public/js/components/CaretakerHub.js");
const profile = code("public/js/components/CareProfile.js");
const account = code("public/js/components/MyAccount.js");
const admin = code("public/js/components/AdminPanel.js");
const hours = code("public/js/components/HourReports.js");
const messages = code("public/js/components/Messages.js");
const offline = code("public/js/offlineQueue.js");

describe("copying text reports whether it worked", () => {
  test("there is one helper, and it returns a real answer", () => {
    expect(utils).toMatch(/const copyText = window\.copyText = async \(text\) => \{/);
    expect(utils).toMatch(/return !!ok;/);
  });

  test("it guards the call, not just the property", () => {
    // `navigator.clipboard?.writeText(x).then(...)` guards the property and then calls .then on
    // undefined — which throws. The guard has to cover the whole expression.
    expect(utils).toMatch(/if \(navigator\.clipboard\?\.writeText\) \{/);
    expect(utils).toMatch(/await navigator\.clipboard\.writeText\(text\)/);
  });

  test("it has a fallback that targets an element it creates", () => {
    // Not `#backup-codes-text`, which never existed.
    expect(utils).toMatch(/document\.createElement\('textarea'\)/);
    expect(utils).toMatch(/ta\.setSelectionRange\(0, text\.length\)/);
  });

  test("no component still writes to the clipboard by hand", () => {
    const offenders = [];
    for (const [name, src] of [
      ["TwoFactorSetup", twofa], ["CaretakerHub", hub], ["CareProfile", profile], ["MyAccount", account],
    ]) {
      if (/navigator\.clipboard\??\.?writeText/.test(src)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });

  test("every copy site now branches on the result", () => {
    for (const [name, src] of [
      ["TwoFactorSetup", twofa], ["CaretakerHub", hub], ["CareProfile", profile], ["MyAccount", account],
    ]) {
      expect(`${name}: uses copyText`).toBe(
        /copyText\(/.test(src) ? `${name}: uses copyText` : `${name}: DOES NOT`
      );
    }
  });

  test("the backup codes say what to do when copying fails", () => {
    // The one case where a silent failure locks someone out of their own account.
    expect(twofa).toMatch(/Write them down before continuing/);
  });
});

describe("exports and documents on a device that cannot do the usual thing", () => {
  test("the waitlist CSV goes through saveBlob", () => {
    // `<a download>` is not implemented in WKWebView, and the old code revoked the object URL
    // on the very next statement, racing the download even where the click worked.
    expect(admin).toMatch(/await saveBlob\(blob, `inplace-waitlist-/);
    expect(admin).not.toMatch(/a\.download = `inplace-waitlist-/);
  });

  test("and reports whether a file was actually produced", () => {
    expect(admin).toMatch(/Could not save the file on this device/);
  });

  test("a null popup falls back to the in-app preview", () => {
    // window.open returns null in the WebView, and there was no else: tapping a caregiver's
    // uploaded ID did nothing at all.
    expect(admin).toMatch(/if \(!w\) \{\s*handleDocPreview\(doc\.id\);/);
  });

  test("printing says it is unavailable rather than doing nothing", () => {
    expect(hours).toMatch(/if \(window\.Capacitor\?\.isNativePlatform\?\.\(\)\) \{/);
    expect(hours).toMatch(/Printing isn/);
  });

  test("and the copy no longer promises a PDF download in the app", () => {
    expect(hours).not.toMatch(/You can download it as a PDF or email it/);
  });
});

describe("an incoming call can still ring", () => {
  test("a 'default' permission no longer returns permanently", () => {
    // requestPermission() from a hidden document has no user activation, so the state stays
    // 'default' — and the old `return` meant the next call took the same branch, forever.
    const block = messages.slice(messages.indexOf("if (document.hidden) {"), messages.indexOf("const typeLabel"));
    expect(block).toMatch(/Notification\.permission === 'denied'/);
    // The only remaining early return is the genuinely-refused case.
    expect((block.match(/\breturn;/g) || []).length).toBe(1);
  });

  test("a genuine refusal is still respected", () => {
    // The reasoning lives in a comment, and code() strips those by design — so read the raw
    // file for this one rather than asserting a comment against stripped source.
    expect(raw("public/js/components/Messages.js")).toMatch(/Genuinely refused\. Nothing to do/);
  });
});

describe("queued care survives", () => {
  test("persistent storage is requested for the offline queue", () => {
    // Everything in this queue is care that already happened. iOS evicts IndexedDB for a
    // non-installed PWA after ~7 days, and this was never asked for at all.
    expect(offline).toMatch(/navigator\.storage\.persist\(\)/);
    expect(offline).toMatch(/if \(typeof navigator !== 'undefined'\) requestPersistentStorage\(\)/);
  });

  test("it checks whether it already has it before asking", () => {
    expect(offline).toMatch(/await navigator\.storage\.persisted\?\.\(\)/);
  });

  test("a refusal is logged rather than assumed", () => {
    expect(offline).toMatch(/persistent storage not granted/);
  });
});
