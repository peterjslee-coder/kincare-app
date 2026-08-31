#!/usr/bin/env node
/**
 * Build script: compiles JSX source files into a single browser-ready bundle.
 * Replaces in-browser Babel compilation for better performance and security.
 *
 * Usage: node scripts/build-client.js
 */
const fs = require("fs");
const path = require("path");
const babel = require("@babel/core");
const { minify } = require("terser");

// v1.90.0 (tier-2 #1): bundles are minified with terser + external sourcemaps.
// Set MINIFY=0 to skip minification for local debugging (readable output).
const MINIFY = process.env.MINIFY !== "0";

const PUBLIC = path.join(__dirname, "..", "public");
const OUT_DIR = path.join(PUBLIC, "js-compiled");

// Source files in dependency order.
// v1.85 (infra #5): split into CORE (everyone) and ADMIN (lazy-loaded via
// script-tag injection the first time an admin opens the Admin page).
// AdminPanel alone was ~40% of the old single bundle. Admin components are
// window-globals, so the second script file works without a module system.
const scripts = [
  "js/offlineQueue.js",
  "js/utils.js",
  // v1.105.114 — the onboarding route. Pure data + resolvers, no React, no fetches;
  // both CaregiverOnboarding and CaretakerHub read it, so it loads before either.
  "js/onboardingRoute.js",
  "js/components/ErrorBoundary.js",
  "js/components/TimezoneHelper.js",
  "js/components/InPlaceIcon.js",
  "js/components/CareStoryWalkthrough.js",
  "js/components/SplashPage.js",
  "js/components/InviteLandingPage.js",
  "js/components/LoginPage.js",
  "js/components/RegisterPage.js",
  "js/components/ForgotPasswordPage.js",
  "js/components/ResetPasswordPage.js",
  "js/components/SwipeableRow.js",
  "js/components/AttachmentViewer.js",
  "js/components/FamilyVisitLog.js",
  "js/components/AttentionCard.js",
  "js/components/CareTasks.js",
  "js/components/CareEvents.js",
  "js/components/CancelSessionModal.js",
  "js/components/Dashboard.js",
  "js/components/CareProfile.js",
  "js/components/TeamNotes.js",
  "js/components/ReactionBar.js",
  "js/components/Schedule.js",
  "js/components/ActivityFeed.js",
  "js/components/CaregiverScheduleModal.js",
  "js/components/Caregivers.js",
  "js/components/CareRecipients.js",
  "js/components/ConsentVerification.js",
  "js/components/ConsentResponsePage.js",
  "js/components/Documents.js",
  "js/components/VideoCallOverlay.js",
  "js/components/Messages.js",
  "js/components/RequestCareModal.js",
  "js/components/VisitDetailModal.js",
  "js/components/TwoFactorSetup.js",
  "js/components/MyAccount.js",
  "js/components/AddressAutocomplete.js",
  "js/components/Reimbursements.js",
  "js/components/MoneyView.js",
  "js/components/CareTeamManage.js",
  "js/components/CareTeamPage.js",
  "js/components/CaredForView.js",
  "js/components/SelfOnboardingWizard.js",
  "js/components/AvailabilityTab.js",
  "js/components/OfferNegotiationPanel.js",
  "js/components/CaregiverCalendar.js",
  "js/components/HourReports.js",
  "js/components/CaretakerHub.js",
  // v1.105.93 — after FamilyVisitLog.js, which defines LogVisitSheet, used below.
  "js/components/HelperHub.js",
  "js/components/AreaMap.js",
  "js/components/FindWork.js",
  "js/components/Analytics.js",
  "js/components/EmailVerificationBanner.js",
  "js/components/DisclaimerModal.js",
  "js/components/DemoOrientation.js",
  "js/components/FeedbackButton.js",
  "js/components/NotificationPrompt.js",
  "js/components/DemoPickerPage.js",
  "js/components/StripePaymentForm.js",
  "js/components/CaregiverOnboarding.js",
  "js/components/CheckrEmbed.js",
  "js/components/FamilyPayments.js",
  "js/components/HelpPage.js",
  "js/components/IPAiBadge.js",
  "js/components/IPAiInsightsCard.js",
  "js/app.js",
];

// Admin-only components — dependency order (AdminPanel renders the other two)
const ADMIN_SCRIPTS = [
  "js/components/VouchPicker.js",
  "js/components/AdminFinancials.js",
  "js/components/SafetyFlagsTab.js",
  "js/components/ContentReportsTab.js",
  "js/components/AdminPanel.js",
];

console.log("  Building client bundles...");

const crypto = require("crypto");

async function buildBundle(fileList, label) {
  const sources = fileList.map((relPath) => {
    const fullPath = path.join(PUBLIC, relPath);
    if (!fs.existsSync(fullPath)) {
      console.error(`  ERROR: Missing source file: ${relPath}`);
      process.exit(1);
    }
    return fs.readFileSync(fullPath, "utf-8");
  });

  const combined = sources.join("\n;\n");

  // Babel transform — same presets as babel-standalone used in-browser
  const result = babel.transformSync(combined, {
    presets: [
      ["@babel/preset-react"],
      [
        "@babel/preset-env",
        {
          targets: "> 1%, not dead",
          modules: false, // keep ES modules for browser
        },
      ],
    ],
    plugins: ["@babel/plugin-transform-optional-chaining"],
    compact: false,
    sourceMaps: MINIFY, // feed babel's map into terser so the final map points at the JSX source
    sourceFileName: `${label}.src.jsx`,
    filename: `${label}.jsx`, // helps Babel with source context
  });

  if (!MINIFY) {
    return { code: result.code, map: null };
  }

  // Terser: mangle/compress with DEFAULT toplevel:false — the core and admin
  // bundles are separate classic scripts that share top-level lexical bindings
  // (const/function declarations in the core bundle are referenced by the admin
  // bundle), so top-level names must never be renamed or dropped.
  const min = await minify(result.code, {
    compress: { passes: 2 },
    mangle: true, // toplevel stays false (default) — see note above
    format: { comments: false },
    sourceMap: {
      content: result.map,
      filename: `${label}.js`,
      url: `${label}.js.map`,
    },
  });
  if (!min.code) {
    console.error(`  ERROR: terser produced no output for ${label}`);
    process.exit(1);
  }
  return { code: min.code, map: min.map };
}

async function main() {
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const core = await buildBundle(scripts, "bundle");
const admin = await buildBundle(ADMIN_SCRIPTS, "bundle-admin");
const coreCode = core.code;
const adminCode = admin.code;

fs.writeFileSync(path.join(OUT_DIR, "bundle.js"), coreCode, "utf-8");
fs.writeFileSync(path.join(OUT_DIR, "bundle-admin.js"), adminCode, "utf-8");
if (core.map) fs.writeFileSync(path.join(OUT_DIR, "bundle.js.map"), core.map, "utf-8");
if (admin.map) fs.writeFileSync(path.join(OUT_DIR, "bundle-admin.js.map"), admin.map, "utf-8");
console.log(`  bundle.js:       ${(Buffer.byteLength(coreCode, "utf-8") / 1024).toFixed(1)} KB${MINIFY ? " (minified)" : ""}`);
console.log(`  bundle-admin.js: ${(Buffer.byteLength(adminCode, "utf-8") / 1024).toFixed(1)} KB${MINIFY ? " (minified)" : ""}`);

// ─── Auto-bump cache-buster in sw.js and index.html ───
// Uses content hash + timestamp so SW always updates on every deploy.
// Hash covers BOTH bundles so an admin-only change still busts caches.
const bundleHash = crypto.createHash("md5").update(coreCode).update(adminCode).digest("hex").slice(0, 8);
const buildTs = Date.now().toString(36);
const buildVersion = `build-${bundleHash}-${buildTs}`;

// Update sw.js CACHE_NAME and SW_VERSION
const swPath = path.join(PUBLIC, "sw.js");
if (fs.existsSync(swPath)) {
  let sw = fs.readFileSync(swPath, "utf-8");
  sw = sw.replace(/const CACHE_NAME = '[^']+';/, `const CACHE_NAME = 'inplace-${buildVersion}';`);
  sw = sw.replace(/const SW_VERSION = '[^']+';/, `const SW_VERSION = '${buildVersion}';`);
  fs.writeFileSync(swPath, sw, "utf-8");
  console.log(`  SW cache version: ${buildVersion}`);
}

// Update index.html bundle cache busters + sync APP_VERSION from server.js
const indexPath = path.join(PUBLIC, "index.html");
if (fs.existsSync(indexPath)) {
  let html = fs.readFileSync(indexPath, "utf-8");
  html = html.replace(/bundle\.js\?v=[^"']+/, `bundle.js?v=${buildVersion}`);
  html = html.replace(/bundle-admin\.js\?v=[^"']+/, `bundle-admin.js?v=${buildVersion}`);
  html = html.replace(/styles\.css\?v=[^"]+/, `styles.css?v=${buildVersion}`);

  // Auto-sync APP_VERSION from server.js so it never goes stale
  const serverPath = path.join(__dirname, "..", "src", "server.js");
  if (fs.existsSync(serverPath)) {
    const serverSrc = fs.readFileSync(serverPath, "utf-8");
    const vMatch = serverSrc.match(/const APP_VERSION\s*=\s*"([^"]+)"/);
    if (vMatch) {
      html = html.replace(/window\.APP_VERSION\s*=\s*'[^']*'/, `window.APP_VERSION = '${vMatch[1]}'`);
      console.log(`  APP_VERSION synced: ${vMatch[1]}`);
    }
  }

  fs.writeFileSync(indexPath, html, "utf-8");
  console.log(`  HTML cache busters updated`);
}

console.log("  Build complete.");
}

main().catch((err) => {
  console.error("  Build failed:", err);
  process.exit(1);
});
