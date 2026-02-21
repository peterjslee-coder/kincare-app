#!/usr/bin/env node
/**
 * collect-feedback.js — Fetch all user feedback from production
 *
 * Usage:
 *   node scripts/collect-feedback.js              # Fetch from production
 *   node scripts/collect-feedback.js --local       # Fetch from localhost:3001
 *
 * Authenticates as admin, pulls all feedback, and writes FEEDBACK.md
 * Run this before planning any new version to incorporate real user input.
 */

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PROD_URL = "https://yourinplace.com";
const LOCAL_URL = "http://localhost:3001";

const ADMIN_EMAIL = "peterjslee@gmail.com";
const ADMIN_PASSWORD = "inplace123";
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || null;

const isLocal = process.argv.includes("--local");
const BASE_URL = isLocal ? LOCAL_URL : PROD_URL;

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.request(url, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on("error", reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

async function main() {
  console.log(`\n📋 Collecting feedback from ${BASE_URL}...\n`);

  // 1. Authenticate — prefer API key (bypasses 2FA), fall back to email/password login
  let authHeaders = {};
  if (ADMIN_API_KEY) {
    console.log("🔑 Using ADMIN_API_KEY for authentication");
    authHeaders = { "X-Admin-API-Key": ADMIN_API_KEY };
  } else {
    const loginRes = await request(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });

    if (loginRes.status !== 200 || !loginRes.data.token) {
      console.error("❌ Login failed:", loginRes.data);
      console.error("💡 Tip: Set ADMIN_API_KEY env var to bypass login/2FA");
      process.exit(1);
    }

    authHeaders = { Authorization: `Bearer ${loginRes.data.token}` };
    console.log("✅ Authenticated as admin");
  }

  // 2. Fetch all feedback (paginated, up to 500)
  let allFeedback = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const fbRes = await request(
      `${BASE_URL}/api/feedback?limit=${limit}&offset=${offset}`,
      { headers: authHeaders }
    );

    if (fbRes.status !== 200) {
      console.error("❌ Fetch failed:", fbRes.data);
      break;
    }

    const items = fbRes.data.feedback || [];
    allFeedback = allFeedback.concat(items);

    if (items.length < limit) break;
    offset += limit;
    if (offset >= 500) break; // safety cap
  }

  console.log(`📬 Found ${allFeedback.length} feedback item(s)\n`);

  // 3. Generate FEEDBACK.md
  const now = new Date().toISOString().split("T")[0];
  let md = `# InPlace User Feedback\n\n`;
  md += `> Last collected: ${now} from ${isLocal ? "localhost" : "production"}\n`;
  md += `> Total items: ${allFeedback.length}\n\n`;

  if (allFeedback.length === 0) {
    md += `No feedback submitted yet.\n`;
  } else {
    // Summary stats
    const byCategory = {};
    const byStatus = {};
    const byMood = {};
    const byBrowser = {};
    const byOS = {};
    const byDevice = {};
    const hasErrors = [];
    for (const f of allFeedback) {
      byCategory[f.category] = (byCategory[f.category] || 0) + 1;
      byStatus[f.status] = (byStatus[f.status] || 0) + 1;
      if (f.mood) byMood[f.mood] = (byMood[f.mood] || 0) + 1;
      if (f.pageContext?.browser) byBrowser[f.pageContext.browser] = (byBrowser[f.pageContext.browser] || 0) + 1;
      if (f.pageContext?.os) byOS[f.pageContext.os] = (byOS[f.pageContext.os] || 0) + 1;
      if (f.pageContext?.device) byDevice[f.pageContext.device] = (byDevice[f.pageContext.device] || 0) + 1;
      if (f.pageContext?.recentErrors?.length) hasErrors.push(f);
    }

    md += `## Summary\n\n`;
    md += `| Category | Count |\n|----------|-------|\n`;
    for (const [k, v] of Object.entries(byCategory)) md += `| ${k} | ${v} |\n`;
    md += `\n`;
    md += `| Status | Count |\n|--------|-------|\n`;
    for (const [k, v] of Object.entries(byStatus)) md += `| ${k} | ${v} |\n`;
    md += `\n`;
    if (Object.keys(byMood).length) {
      md += `| Mood | Count |\n|------|-------|\n`;
      for (const [k, v] of Object.entries(byMood)) md += `| ${k} | ${v} |\n`;
      md += `\n`;
    }

    if (Object.keys(byBrowser).length) {
      md += `| Browser | Count |\n|---------|-------|\n`;
      for (const [k, v] of Object.entries(byBrowser)) md += `| ${k} | ${v} |\n`;
      md += `\n`;
    }

    if (Object.keys(byOS).length) {
      md += `| OS | Count |\n|----|-------|\n`;
      for (const [k, v] of Object.entries(byOS)) md += `| ${k} | ${v} |\n`;
      md += `\n`;
    }

    if (Object.keys(byDevice).length) {
      md += `| Device | Count |\n|--------|-------|\n`;
      for (const [k, v] of Object.entries(byDevice)) md += `| ${k} | ${v} |\n`;
      md += `\n`;
    }

    if (hasErrors.length) {
      md += `## ⚠️ Feedback With Console Errors\n\n`;
      md += `${hasErrors.length} item(s) captured JavaScript errors at time of submission:\n\n`;
      for (const f of hasErrors) {
        md += `- **${f.userName}** on ${f.pageContext.page}: ${f.pageContext.recentErrors.map(e => e.message.substring(0, 60)).join("; ")}\n`;
      }
      md += `\n`;
    }

    // Individual items
    md += `## All Feedback\n\n`;
    for (const f of allFeedback) {
      const date = new Date(f.createdAt).toLocaleDateString("en-US", {
        year: "numeric", month: "short", day: "numeric",
      });
      md += `### ${f.category.toUpperCase()}: ${f.description.substring(0, 80)}${f.description.length > 80 ? "..." : ""}\n`;
      md += `- **From:** ${f.userName} (${f.userEmail || "anonymous"}) — ${f.userRole || "visitor"}\n`;
      md += `- **Date:** ${date}\n`;
      md += `- **Status:** ${f.status}`;
      if (f.mood) md += ` | **Mood:** ${f.mood}`;
      md += `\n`;
      if (f.pageContext) {
        md += `- **Page:** ${f.pageContext.page || "unknown"} (v${f.pageContext.version || "?"})`;
        if (f.pageContext.currentUrl) md += ` — URL: ${f.pageContext.currentUrl}`;
        md += `\n`;
        if (f.pageContext.browser || f.pageContext.os) {
          md += `- **Environment:** ${f.pageContext.browser || "?"} on ${f.pageContext.os || "?"} — ${f.pageContext.device || "?"} (${f.pageContext.screenResolution || "?"}, viewport ${f.pageContext.viewportSize || "?"})`;
          if (f.pageContext.touchSupport === 'yes') md += ` [touch]`;
          if (f.pageContext.isPWA === 'yes') md += ` [PWA]`;
          if (f.pageContext.connectionType && f.pageContext.connectionType !== 'unknown') md += ` [${f.pageContext.connectionType}]`;
          md += `\n`;
        }
        if (f.pageContext.recentErrors?.length) {
          md += `- **⚠️ Console errors (${f.pageContext.recentErrors.length}):** ${f.pageContext.recentErrors.map(e => "`" + e.message.substring(0, 80) + "`").join(", ")}\n`;
        }
      }
      md += `- **Full description:** ${f.description}\n`;
      if (f.adminNotes) md += `- **Admin notes:** ${f.adminNotes}\n`;
      if (f.tags && f.tags.length) md += `- **Tags:** ${f.tags.join(", ")}\n`;
      md += `\n`;
    }
  }

  // 4. Write to project root
  const outPath = path.join(__dirname, "..", "FEEDBACK.md");
  fs.writeFileSync(outPath, md, "utf8");
  console.log(`✅ Written to FEEDBACK.md (${allFeedback.length} items)\n`);

  // 5. Print actionable items for quick review
  const actionable = allFeedback.filter(f => f.status === "new" || f.status === "reviewed");
  if (actionable.length) {
    console.log(`⚡ ${actionable.length} actionable item(s):\n`);
    for (const f of actionable) {
      console.log(`  [${f.status.toUpperCase()}] ${f.category} — ${f.description.substring(0, 60)} (${f.userName})`);
    }
    console.log("");
  }
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
