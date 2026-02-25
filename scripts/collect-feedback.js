#!/usr/bin/env node
/**
 * collect-feedback.js — Fetch and triage user feedback from production
 *
 * Usage:
 *   node scripts/collect-feedback.js                     # Full fetch → FEEDBACK.md
 *   node scripts/collect-feedback.js --triage             # Quick triage: show new items + counts
 *   node scripts/collect-feedback.js --mark-reviewed      # Mark all 'new' items as 'reviewed'
 *   node scripts/collect-feedback.js --local              # Use localhost:3001 instead of production
 *
 * Authenticates via ADMIN_API_KEY (bypasses 2FA) or email/password login.
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
const isTriage = process.argv.includes("--triage");
const isMarkReviewed = process.argv.includes("--mark-reviewed");
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

async function getAuthHeaders() {
  if (ADMIN_API_KEY) {
    return { "X-Admin-API-Key": ADMIN_API_KEY };
  }
  const loginRes = await request(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (loginRes.status !== 200 || !loginRes.data.token) {
    console.error("❌ Login failed:", loginRes.data);
    console.error("💡 Tip: Set ADMIN_API_KEY env var to bypass login/2FA");
    process.exit(1);
  }
  return { Authorization: `Bearer ${loginRes.data.token}` };
}

async function triageMode() {
  console.log(`\n⚡ Quick triage from ${BASE_URL}...\n`);
  const authHeaders = await getAuthHeaders();

  const res = await request(`${BASE_URL}/api/admin/feedback/triage`, { headers: authHeaders });
  if (res.status !== 200) {
    console.error("❌ Triage fetch failed:", res.data);
    process.exit(1);
  }

  const { counts, newItems, recentReviewed, summary } = res.data;
  console.log(`📊 ${summary}\n`);

  if (newItems.length === 0) {
    console.log("✅ No new feedback to triage!\n");
    if (recentReviewed.length) {
      console.log(`📋 ${recentReviewed.length} reviewed/planned item(s) from last 7 days:\n`);
      for (const f of recentReviewed) {
        console.log(`  [${f.status.toUpperCase()}] ${f.category} — ${f.description.substring(0, 70)} (${f.userName})`);
      }
    }
    return;
  }

  console.log(`🆕 ${newItems.length} NEW item(s) to triage:\n`);
  for (let i = 0; i < newItems.length; i++) {
    const f = newItems[i];
    const ctx = f.pageContext;
    console.log(`  ${i + 1}. [${f.category.toUpperCase()}] ${f.description.substring(0, 80)}`);
    console.log(`     From: ${f.userName} (${f.userEmail}) — ${f.userRole}`);
    if (ctx?.page) console.log(`     Page: ${ctx.page} | ${ctx.browser || '?'} on ${ctx.os || '?'}`);
    console.log(`     Date: ${new Date(f.createdAt).toLocaleDateString()}`);
    console.log(`     ID: ${f.id}`);
    console.log('');
  }

  console.log(`💡 Run with --mark-reviewed to mark all ${newItems.length} new items as reviewed.`);
}

async function markReviewedMode() {
  console.log(`\n📝 Marking all 'new' items as 'reviewed' on ${BASE_URL}...\n`);
  const authHeaders = await getAuthHeaders();

  // First get all new items
  const triageRes = await request(`${BASE_URL}/api/admin/feedback/triage`, { headers: authHeaders });
  if (triageRes.status !== 200) {
    console.error("❌ Triage fetch failed:", triageRes.data);
    process.exit(1);
  }

  const { newItems } = triageRes.data;
  if (newItems.length === 0) {
    console.log("✅ No new items to mark.\n");
    return;
  }

  const updates = newItems.map(f => ({ id: f.id, status: "reviewed" }));
  const bulkRes = await request(`${BASE_URL}/api/admin/feedback/bulk-update`, {
    method: "POST",
    headers: authHeaders,
    body: { updates },
  });

  if (bulkRes.status !== 200) {
    console.error("❌ Bulk update failed:", bulkRes.data);
    process.exit(1);
  }

  console.log(`✅ Marked ${bulkRes.data.updated} item(s) as reviewed.\n`);
}

async function main() {
  if (isTriage) return triageMode();
  if (isMarkReviewed) return markReviewedMode();

  console.log(`\n📋 Collecting feedback from ${BASE_URL}...\n`);

  // 1. Authenticate — prefer API key (bypasses 2FA), fall back to email/password login
  const authHeaders = await getAuthHeaders();
  console.log("✅ Authenticated");

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
