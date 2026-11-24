// v1.105.49 — the features that were silently dead on iPhone.
//
// One root cause, seven times: capability checks written against Chrome. WebKit either
// lacks the API or throws where Chrome returns, the guard passes or the call blows up, and
// the feature renders nothing. Nothing is the same thing a working feature with no data
// renders, which is why none of these ever produced a bug report — they produced a shrug.
//
// Pete found three of these the hard way this week (setAppBadge, permissions.query,
// getCurrentPosition). These are the rest.

const { code } = require("./helpers/source");

const utils = code("public/js/utils.js");
const app = code("public/js/app.js");
const messages = code("public/js/components/Messages.js");
const viewer = code("public/js/components/AttachmentViewer.js");
const reimb = code("public/js/components/Reimbursements.js");
const docs = code("public/js/components/Documents.js");
const dash = code("public/js/components/Dashboard.js");

describe("an incoming call reaches an iPhone", () => {
  test("notifications go through the service worker, not the page constructor", () => {
    // `new Notification(...)` is absent in WKWebView, and in an iOS 16.4+ home-screen app
    // `'Notification' in window` is TRUE while constructing one still throws — so the usual
    // guard passes and the call blows up.
    expect(utils).toMatch(/const showLocalNotification/);
    expect(utils).toMatch(/reg\?\.showNotification/);
    expect(app).not.toMatch(/new Notification\(/);
    expect(messages).not.toMatch(/new Notification\(/);
  });

  test("the navigation happens before the notification, not after it", () => {
    // The throw used to take the rest of the handler with it, so a call on an iPhone
    // produced no alert AND didn't switch to Messages.
    const h = app.slice(app.indexOf("onSocketEvent('call_incoming'"), app.indexOf("onSocketEvent('call_incoming'") + 900);
    expect(h.indexOf("setCurrentPage('messages')")).toBeLessThan(h.indexOf("showLocalNotification"));
  });

  test("it can't white-screen the message thread", () => {
    // In Messages the throw was inside a useEffect body, so it reached the ErrorBoundary:
    // a call arriving while backgrounded replaced the thread with "Something went wrong".
    expect(utils).toMatch(/catch \{ \/\* a notification is never worth taking the view down \*\/ \}/);
    expect(messages).toMatch(/showLocalNotification\(/);
    expect(messages).toMatch(/closeLocalNotification\('incoming-call'\)/);
  });
});

describe("push notifications can repair themselves on iOS", () => {
  test("checkPushHealth has a native branch, ahead of the web-only guards", () => {
    // PushManager and Notification are both absent in WKWebView, so this bailed on its
    // first line every 30 minutes forever — and it is the ONLY thing that notices the
    // server has no devices for you and re-registers. An iPhone whose APNs token rotated
    // stopped receiving notifications and never recovered.
    const fn = utils.slice(utils.indexOf("const checkPushHealth"), utils.indexOf("const checkPushHealth") + 1400);
    expect(fn.indexOf("Capacitor?.isNativePlatform")).toBeLessThan(fn.indexOf("!('PushManager' in window)"));
    expect(fn).toMatch(/subscribeNativePush\(\)/);
    expect(fn).toMatch(/status\.userSubscriptions === 0/);
  });
});

describe("a file save either happens or says it didn't", () => {
  test("saveBlob reports whether the file actually landed", () => {
    expect(utils).toMatch(/const saveBlob/);
    expect(utils).toMatch(/navigator\.canShare\?\.\(\{ files: \[file\] \}\)/);
  });

  test("the reimbursement export no longer claims success unconditionally", () => {
    // It showed "Exported 34 reimbursements" on the line after a click WKWebView drops —
    // the worst kind of silent failure, because the app asserts the opposite.
    expect(reimb).toMatch(/const saved = await saveBlob\(/);
    expect(reimb).toMatch(/if \(saved\) \{/);
    expect(reimb).toMatch(/Couldn't save the file on this device/);
  });

  test("document download no longer shadows the global `document`", () => {
    // This one was broken on EVERY platform: the parameter was named `document`, so
    // `document.createElement` was looked up on the file object and threw.
    expect(docs).toMatch(/const handleDownload = async \(doc\) => \{/);
    expect(docs).not.toMatch(/const handleDownload = async \(document\)/);
    expect(docs).toMatch(/if \(!response\.ok\) \{/); // and the server's half is reported too
  });

  test("the attachment viewer's Save button is a real handler", () => {
    expect(viewer).not.toMatch(/<a href=\{entry\.url\} download=/);
    expect(viewer).toMatch(/const ok = await saveBlob\(/);
  });
});

describe("PDFs and external links behave on WebKit", () => {
  test("a PDF is not rendered in a subframe on WebKit", () => {
    // WebKit renders PDFs only on top-level navigation; in an iframe it paints a white
    // rectangle with no error, so a tapped receipt looked like a broken app.
    // v1.105.67 — the branch moved into the shared PdfPreview component. It now guards the
    // Documents and admin previews as well, both of which were rendering bare iframes and so
    // showed a white rectangle for every PDF care document on every iPhone.
    expect(viewer).toMatch(/const isWebKitLike = \(\) => \{/);
    expect(viewer).toMatch(/if \(!isWebKitLike\(\)\) \{/);
    expect(viewer).toMatch(/Open PDF/);
    expect(viewer).toMatch(/const PdfPreview = window\.PdfPreview =/);
  });

  test("external URLs fetched behind an await don't hit the popup blocker", () => {
    // Safari spends the tap's user activation across the await, so window.open is blocked
    // silently. That made the Stripe payout dashboard and the background-check invitation
    // unreachable from an iPhone — a caregiver couldn't get paid or get vetted.
    expect(utils).toMatch(/const openExternalUrl/);
    expect(utils).toMatch(/Capacitor\?\.Plugins\?\.Browser/);
    expect(utils).toMatch(/window\.location\.href = url;/); // fallback when open() is blocked
    for (const src of [code("public/js/components/MyAccount.js"), code("public/js/components/CaretakerHub.js"), code("public/js/components/CheckrEmbed.js")]) {
      expect(src).not.toMatch(/window\.open\(data\.url|window\.open\(data\.invitationUrl|window\.open\(d\.url/);
    }
  });
});

describe("the App Store app knows it is installed", () => {
  test("First Steps stops telling native users to install the app", () => {
    // WKWebView reports display-mode: browser and has no navigator.standalone, so an App
    // Store user had "Install InPlace on your phone" pinned forever — and tapping it showed
    // Add-to-Home-Screen instructions for an app they already had.
    const step = dash.slice(dash.indexOf("Install InPlace on your phone"), dash.indexOf("Install InPlace on your phone") + 400);
    expect(step).toMatch(/window\.Capacitor\?\.isNativePlatform\?\.\(\)/);
  });
});
