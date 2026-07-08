const EmbeddedPostgres = require('embedded-postgres').default || require('embedded-postgres');
(async () => {
  const pg = new EmbeddedPostgres({ databaseDir: '/tmp/epg-fb3', user: 'test', password: 'test', port: 55452, persistent: false });
  await pg.initialise(); await pg.start(); await pg.createDatabase('t');
  process.env.DATABASE_URL = 'postgres://test:test@localhost:55452/t';
  process.env.JWT_SECRET = 'x'; process.env.ADMIN_API_KEY = 'k123';
  const { initializeDatabase, getDb } = require('./src/models/database.js');
  await initializeDatabase();
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/feedback', require('./src/routes/feedback.js'));
  await new Promise(r => app.listen(55522, r));
  const db = await getDb();
  const { v4: uuid } = require('uuid');
  const uid = uuid();
  await db.prepare("INSERT INTO users (id, email, password_hash, role, roles, first_name, last_name, is_admin) VALUES (?, 'p@x.com', 'x', 'family', '[\"family\"]', 'P', 'L', 1)").run(uid);
  // realistic rows: page_context JSON + screenshot data URI + null tags
  const ctx = JSON.stringify({ page: 'account', browser: 'Chrome 149', os: 'macOS', recentErrors: [] });
  await db.prepare("INSERT INTO feedback (id, user_id, category, description, mood, screenshot, page_context, status) VALUES (?, ?, 'general', 'payments question about accounts and reimbursement checkmarks', null, ?, ?, 'reviewed')").run(uuid(), uid, 'data:image/png;base64,iVBORw0KGgo=', ctx);
  await db.prepare("INSERT INTO feedback (id, user_id, category, description, mood, screenshot, page_context, status) VALUES (?, ?, 'complaint', 'identity verification button only uploads, want camera option', 'frustrated', null, ?, 'reviewed')").run(uuid(), uid, ctx);
  const r = await fetch('http://localhost:55522/api/feedback?limit=50&offset=0', { headers: { 'X-Admin-API-Key': 'k123' } });
  const j = await r.json().catch(() => null);
  console.log('STATUS', r.status, '| items:', j && j.feedback ? j.feedback.length : JSON.stringify(j));
  // malformed tags row → does it 500?
  await db.prepare("INSERT INTO feedback (id, user_id, category, description, tags, status) VALUES (?, ?, 'bug', 'row with malformed tags field to test parse crash', 'not-json', 'new')").run(uuid(), uid);
  const r2 = await fetch('http://localhost:55522/api/feedback?limit=50&offset=0', { headers: { 'X-Admin-API-Key': 'k123' } });
  const j2 = await r2.json().catch(() => null);
  console.log('WITH-MALFORMED-TAGS STATUS', r2.status, '|', j2 && j2.feedback ? j2.feedback.length + ' items' : JSON.stringify(j2));
  process.on('uncaughtException', () => {}); process.on('unhandledRejection', () => {});
  await pg.stop(); process.exit(0);
})().catch(e => { console.error('FAIL:', e && e.message); process.exit(1); });
