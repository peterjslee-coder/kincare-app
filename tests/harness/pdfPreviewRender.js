#!/usr/bin/env node
/**
 * Render the REAL PdfPreview component in Chromium, under two user agents, and report what it
 * actually put on the page. (v1.105.67)
 *
 * The v1.105.2 rule: verify UI fixes by measuring. Both real causes of that release's bugs were
 * invisible in the source — a broad CSS rule stretching a toggle, and a `background` shorthand
 * erasing an image. A source assertion saying "the component branches on isWebKitLike" does not
 * tell you that an iPhone gets a button instead of a white rectangle. This does.
 *
 * Compiles AttachmentViewer.js with the repo's own Babel preset, stubs the handful of globals it
 * expects, and mounts just PdfPreview.
 *
 * Usage: node tests/harness/pdfPreviewRender.js   → prints JSON, exits 1 if anything is wrong.
 */

const fs = require("fs");
const path = require("path");
const babel = require("@babel/core");

const REPO = path.join(__dirname, "..", "..");
const CHROMIUM = "/opt/pw-browsers/chromium";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const DESKTOP_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

function compile(relPath) {
  const src = fs.readFileSync(path.join(REPO, relPath), "utf8");
  return babel.transformSync(src, {
    presets: [[require.resolve("@babel/preset-react"), { pragma: "React.createElement" }]],
    filename: relPath,
    babelrc: false,
    configFile: false,
  }).code;
}

async function run() {
  const { chromium } = require("playwright");
  const viewerJs = compile("public/js/components/AttachmentViewer.js");

  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });
  const results = {};

  for (const [label, ua, native] of [
    ["iphone_safari", IPHONE_UA, false],
    ["iphone_native", IPHONE_UA, true],
    ["desktop_chrome", DESKTOP_CHROME_UA, false],
  ]) {
    const ctx = await browser.newContext({ userAgent: ua });
    const page = await ctx.newPage();
    await page.setContent(`<!doctype html><html><body><div id="root"></div></body></html>`);
    // The repo vendors React — no network needed, and it is the exact build the app ships.
    await page.addScriptTag({ path: path.join(REPO, "public/vendor/react.production.min.js") });
    await page.addScriptTag({ path: path.join(REPO, "public/vendor/react-dom.production.min.js") });

    const ok = await page.evaluate(() => !!(window.React && window.ReactDOM));
    if (!ok) { results[label] = { error: "react-unavailable" }; await ctx.close(); continue; }

    results[label] = await page.evaluate(
      ({ viewerJs, native }) => {
        // Globals AttachmentViewer expects from utils.js / the app shell.
        window.saveBlobCalls = [];
        window.openExternalUrlCalls = [];
        window.apiFetch = async () => ({ ok: false });
        window.saveBlob = async (blob, name) => { window.saveBlobCalls.push(name); return true; };
        window.openExternalUrl = (u) => { window.openExternalUrlCalls.push(u); return true; };
        window._capPlugin = () => null;
        if (native) window.Capacitor = { isNativePlatform: () => true, Plugins: {} };

        try { (0, eval)(viewerJs); } catch (e) { return { error: "eval: " + e.message }; }
        if (typeof window.PdfPreview !== "function") return { error: "PdfPreview not exported" };

        const root = window.ReactDOM.createRoot(document.getElementById("root"));
        const blob = new Blob(["%PDF-1.4 fake"], { type: "application/pdf" });
        root.render(
          window.React.createElement(window.PdfPreview, {
            blobUrl: "blob:fake-url",
            blob,
            name: "Power of Attorney.pdf",
            height: "500px",
          })
        );
        return new Promise((resolve) => {
          setTimeout(() => {
            const el = document.getElementById("root");
            const iframes = el.querySelectorAll("iframe").length;
            const buttons = [...el.querySelectorAll("button")].map((b) => b.textContent.trim());
            resolve({
              iframes,
              buttons,
              text: el.textContent.replace(/\s+/g, " ").trim().slice(0, 160),
            });
          }, 120);
        });
      },
      { viewerJs, native }
    );

    // Click "Open PDF" where present, and record which route it took.
    if (results[label].buttons && results[label].buttons.length) {
      await page.click("#root button").catch(() => {});
      await page.waitForTimeout(150);
      results[label].saveBlobCalls = await page.evaluate(() => window.saveBlobCalls);
      results[label].openExternalUrlCalls = await page.evaluate(() => window.openExternalUrlCalls);
    }
    await ctx.close();
  }

  await browser.close();
  return results;
}

run()
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    const problems = [];
    const skipped = Object.values(r).some((v) => v.error === "react-unavailable");
    if (skipped) {
      console.log("\nSKIPPED: vendored React did not load.");
      process.exit(0);
    }
    for (const [k, v] of Object.entries(r)) if (v.error) problems.push(`${k}: ${v.error}`);

    // An iPhone must NOT get an iframe, and must get a working button.
    if (r.iphone_safari?.iframes !== 0) problems.push("iphone_safari rendered an iframe — the white rectangle is back");
    if (!(r.iphone_safari?.buttons || []).some((b) => /Open PDF/i.test(b))) problems.push("iphone_safari has no Open PDF button");
    if (!(r.iphone_safari?.openExternalUrlCalls || []).length) problems.push("iphone_safari button did not open anything");

    // Native must go through the share sheet, NOT Browser.open with a blob URL.
    if (r.iphone_native?.iframes !== 0) problems.push("iphone_native rendered an iframe");
    if (!(r.iphone_native?.saveBlobCalls || []).length) problems.push("iphone_native did not use saveBlob — the dead Browser.open path is back");
    if ((r.iphone_native?.openExternalUrlCalls || []).length) problems.push("iphone_native called openExternalUrl with a blob URL — that does nothing in the app");

    // Desktop still gets the inline render.
    if (r.desktop_chrome?.iframes !== 1) problems.push("desktop_chrome lost its inline PDF iframe");

    if (problems.length) {
      console.error("\nPROBLEMS:\n" + problems.map((p) => "  - " + p).join("\n"));
      process.exit(1);
    }
    console.log("\nOK: iPhone gets a working button, native uses the share sheet, desktop still renders inline.");
  })
  .catch((e) => {
    console.error("harness error:", e.message);
    process.exit(1);
  });
