/**
 * Health & API overview endpoint tests
 */
const request = require('supertest');
require('./setup');
const app = require('../src/server');

describe('Health & API Endpoints', () => {
  it('GET /api/health should return OK', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('InPlace API');
    expect(res.body.timestamp).toBeDefined();
  });

  it('GET /api should return API docs', async () => {
    const res = await request(app).get('/api');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('InPlace API');
    expect(res.body.endpoints).toBeDefined();
    expect(res.body.endpoints.auth).toBeDefined();
    expect(res.body.endpoints.sessions).toBeDefined();
  });

  it('Non-API route should return HTML (SPA catch-all)', async () => {
    const res = await request(app).get('/some-random-page');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });
});
