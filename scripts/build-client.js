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

const PUBLIC = path.join(__dirname, "..", "public");
const OUT_DIR = path.join(PUBLIC, "js-compiled");

// Source files in dependency order (must match index.html script list)
const scripts = [
  "js/offlineQueue.js",
  "js/utils.js",
  "js/components/TimezoneHelper.js",
  "js/components/InPlaceIcon.js",
  "js/components/CareStoryWalkthrough.js",
  "js/components/SplashPage.js",
  "js/components/InviteLandingPage.js",
  "js/components/LoginPage.js",
  "js/components/RegisterPage.js",
  "js/components/ForgotPasswordPage.js",
  "js/components/ResetPasswordPage.js",
  "js/components/Dashboard.js",
  "js/components/CareProfile.js",
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
  "js/components/CareTeamManage.js",
  "js/components/CareTeamPage.js",
  "js/components/CaredForView.js",
  "js/components/AvailabilityTab.js",
  "js/components/OfferNegotiationPanel.js",
  "js/components/CaregiverCalendar.js",
  "js/components/HourReports.js",
  "js/components/CaretakerHub.js",
  "js/components/AreaMap.js",
  "js/components/FindWork.js",
  "js/components/Analytics.js",
  "js/components/EmailVerificationBanner.js",
  "js/components/DisclaimerModal.js",
  "js/components/FeedbackButton.js",
  "js/components/NotificationPrompt.js",
  "js/components/DemoPickerPage.js",
  "js/components/StripePaymentForm.js",
  "js/components/CaregiverOnboarding.js",
  "js/components/CheckrEmbed.js",
  "js/components/FamilyPayments.js",
  "js/components/AdminFinancials.js",
  "js/components/HelpPage.js",
  "js/components/SafetyFlagsTab.js",
  "js/components/AdminPanel.js",
  "js/components/IPAiBadge.js",
  "js/components/IPAiInsightsCard.js",
  "js/app.js",
];

console.log("  Building client bundle...");

// Read and concatenate source files
const sources = scripts.map((relPath) => {
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
  compact: false, // readable output for debugging
  filename: "bundle.jsx", // helps Babel with source context
});

// Write output
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const outPath = path.join(OUT_DIR, "bundle.js");
fs.writeFileSync(outPath, result.code, "utf-8");

const sizeKB = (Buffer.byteLength(result.code, "utf-8") / 1024).toFixed(1);
console.log(`  Bundle written: ${outPath} (${sizeKB} KB)`);
console.log("  Build complete.");
