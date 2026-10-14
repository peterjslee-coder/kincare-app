/**
 * Journey tracking routes (v1.117.0). See src/utils/tracking.js for what is and is never kept.
 *
 *   GET  /i/:code          public short link → the app, with the code riding along as ?l=
 *   POST /api/t            public beacon: start · page · identify  (navigator.sendBeacon, text/plain)
 *   GET  /api/admin/links  campaign links with what they brought in
 *   POST /api/admin/links  make one: { label, audience }
 *
 * /i/:code deliberately writes nothing. iMessage, Android Messages, Facebook and Slack all fetch
 * a link the moment it is pasted to draw a preview card, so a server-side "clicked" would mark
 * every outreach text as opened the second it was delivered. A click is counted when the app
 * actually loads in a browser and reports ?l= (the 'start' event) — a real person on a real screen.
 */
const express = require("express");
const jwt = require("jsonwebtoken");
const { getDb } = require("../models/database");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { checkAdmin } = require("./admin/shared");
const { captureException } = require("../utils/sentry");
const T = require("../utils/tracking");

// ─── GET /i/:code ───
const publicRouter = express.Router();
publicRouter.get("/i/:code", async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.set("X-Robots-Tag", "noindex, nofollow");
  const code = req.params.code;
  if (!T.isCode(code)) return res.redirect(302, "/");
  try {
    const db = await getDb();
    const link = await db.prepare("SELECT code, kind, audience FROM track_links WHERE code = ?").get(code);
    return res.redirect(302, link ? T.destinationFor(link) : "/");
  } catch (err) {
    captureException(err, { where: "track: short link" });
    return res.redirect(302, "/");
  }
});

// ─── /work, /help, /home — the link landing pages (v1.119.0) ───
// Static, no-JS-required pages for people arriving cold from a text or a flyer. Hidden on purpose:
// nothing links here and search engines are told not to list them. Unknown paths never reach
// this handler (the router only matches these three).
const path = require("path");
for (const [route, file] of Object.entries(T.LANDING_FILES)) {
  publicRouter.get(route, (req, res) => {
    res.set("Cache-Control", "no-cache");
    res.set("X-Robots-Tag", "noindex, nofollow");
    res.sendFile(path.join(__dirname, "../../public/landing", file));
  });
}

// ─── POST /api/t ───
//
// Who is asking, if anyone. Read-only and forgiving: no token, a bad token, an expired token all
// just mean "anonymous". An admin viewing as someone else is never recorded as that person.
// A cross-site request is never allowed to attach an account (it could otherwise pin a stranger's
// anonymous history onto whoever is signed in).
function whoIsAsking(req) {
  const site = String(req.headers["sec-fetch-site"] || "");
  if (site && site !== "same-origin" && site !== "none") return null;
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : req.cookies?.auth_token;
  if (!token) return null;
  try {
    const d = jwt.verify(token, process.env.JWT_SECRET);
    if (!d?.id || d.impersonatedBy) return { skip: !!d?.impersonatedBy };
    return { id: d.id, demo: !!d.demo };
  } catch { return null; }
}

const beaconRouter = express.Router();
beaconRouter.post("/", express.text({ type: "*/*", limit: "16kb" }), async (req, res) => {
  // Always 204, whatever happens: a beacon nobody reads the answer to should never surface as an
  // error in the console of someone deciding whether to trust us.
  res.status(204).end();
  try {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { return; } }
    if (!body || typeof body !== "object") return;
    const vid = body.vid, sid = T.isUuid(body.sid) ? body.sid : null;
    if (!T.isUuid(vid)) return;
    const events = Array.isArray(body.events) ? body.events.slice(0, T.MAX_EVENTS_PER_POST) : [];
    if (!events.length) return;

    const who = whoIsAsking(req);
    if (who?.skip) return; // admin "view as" — nothing about this visit is the viewed person's
    const userId = who?.id && !who.demo ? who.id : null;
    const demo = !!who?.demo;
    const platform = T.cleanPlatform(body.platform);

    const db = await getDb();
    await db.prepare(`
      INSERT INTO visitors (id, first_seen_at, last_seen_at, platform) VALUES (?, NOW(), NOW(), ?)
      ON CONFLICT (id) DO UPDATE SET last_seen_at = NOW(), platform = COALESCE(EXCLUDED.platform, visitors.platform)
    `).run(vid, platform);

    for (const e of events) {
      if (!e || typeof e !== "object") continue;
      if (e.k === "start") {
        let code = T.isCode(e.l) ? e.l : null;
        if (code) {
          const ok = await db.prepare("SELECT 1 AS ok FROM track_links WHERE code = ?").get(code);
          if (!ok) code = null;
        }
        const ref = T.refHost(e.ref);
        const utm = T.cleanUtm(e.utm);
        const cid = T.cleanClickId(e.cid);
        const page = T.cleanPage(e.p);
        await db.prepare(`
          INSERT INTO visit_events (visitor_id, session_id, user_id, kind, page, link_code, ref_host,
                                    utm_source, utm_medium, utm_campaign, utm_content, click_id, demo, created_at)
          VALUES (?, ?, ?, 'start', ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `).run(vid, sid, userId, page, code, ref, utm.source, utm.medium, utm.campaign, utm.content, cid, demo);
        // First KNOWN source: a visitor whose first visit was a bare typed URL and whose second
        // came from a Facebook post is credited to Facebook. Each field fills once and then holds.
        await db.prepare(`
          UPDATE visitors SET
            first_link_code    = COALESCE(first_link_code, ?),
            first_ref_host     = COALESCE(first_ref_host, ?),
            first_utm_source   = COALESCE(first_utm_source, ?),
            first_utm_medium   = COALESCE(first_utm_medium, ?),
            first_utm_campaign = COALESCE(first_utm_campaign, ?),
            first_click_id     = COALESCE(first_click_id, ?),
            first_page         = COALESCE(first_page, ?)
          WHERE id = ?
        `).run(code, ref, utm.source, utm.medium, utm.campaign, cid, page, vid);
      } else if (e.k === "page") {
        const page = T.cleanPage(e.p);
        const ms = Math.max(0, Math.min(T.MAX_PAGE_MS, Math.round(Number(e.ms) || 0)));
        if (!page) continue;
        await db.prepare(`
          INSERT INTO visit_events (visitor_id, session_id, user_id, kind, page, ms, demo, created_at)
          VALUES (?, ?, ?, 'page', ?, ?, ?, NOW())
        `).run(vid, sid, userId, page, ms, demo);
      } else if (e.k === "identify" && userId) {
        // The anonymous phone is now this account. Only the first account claims a visitor — a
        // shared family iPad stays credited to whoever first signed in on it; each later person's
        // own events still carry their user_id.
        const r = await db.prepare(
          "UPDATE visitors SET user_id = ?, linked_at = NOW() WHERE id = ? AND user_id IS NULL"
        ).run(userId, vid);
        if (r.changes) {
          await db.prepare(`
            INSERT INTO visit_events (visitor_id, session_id, user_id, kind, created_at)
            VALUES (?, ?, ?, 'identify', NOW())
          `).run(vid, sid, userId);
          // Everything this phone did before it had a name now belongs to the person.
          await db.prepare("UPDATE visit_events SET user_id = ? WHERE visitor_id = ? AND user_id IS NULL AND demo = FALSE").run(userId, vid);
        }
      }
    }
  } catch (err) {
    captureException(err, { where: "track: beacon" });
  }
});

// ─── /api/admin/links — campaign links (a flyer, a Facebook post, an ad) ───
const adminRouter = express.Router();
adminRouter.use(authenticate, checkAdmin, requireAdmin);

adminRouter.get("/", async (req, res) => {
  try {
    const db = await getDb();
    const links = await db.prepare(`
      SELECT l.code, l.kind, l.audience, l.label, l.created_at,
             (SELECT COUNT(DISTINCT e.visitor_id) FROM visit_events e WHERE e.link_code = l.code AND e.kind = 'start') AS visitors,
             (SELECT COUNT(DISTINCT v.user_id) FROM visitors v WHERE v.first_link_code = l.code AND v.user_id IS NOT NULL) AS signups,
             (SELECT MAX(e.created_at) FROM visit_events e WHERE e.link_code = l.code AND e.kind = 'start') AS last_visit_at
        FROM track_links l
       WHERE l.kind = 'campaign'
       ORDER BY l.created_at DESC
       LIMIT 200
    `).all();
    res.json({ links: links.map((l) => ({ ...l, url: T.linkUrl(l.code), visitors: Number(l.visitors) || 0, signups: Number(l.signups) || 0 })) });
  } catch (err) {
    captureException(err, { where: "track: list links" });
    res.status(500).json({ error: "Failed to load links" });
  }
});

adminRouter.post("/", async (req, res) => {
  try {
    const label = String(req.body?.label || "").trim().slice(0, 80);
    if (!label) return res.status(400).json({ error: "Name the link — where will you post it?" });
    const audience = T.AUDIENCES.includes(req.body?.audience) ? req.body.audience : null;
    const db = await getDb();
    const code = await T.createLink(db, { kind: "campaign", audience, label, createdBy: req.user.id });
    res.json({ code, url: T.linkUrl(code), label, audience });
  } catch (err) {
    captureException(err, { where: "track: create link" });
    res.status(500).json({ error: "Failed to make the link" });
  }
});

module.exports = { publicRouter, beaconRouter, adminRouter };
