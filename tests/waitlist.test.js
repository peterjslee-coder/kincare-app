/**
 * Waitlist Route Tests
 */
const request = require('supertest');
const { tables, resetTables } = require('./setup');
const app = require('../src/server');

describe('Waitlist Routes', () => {
  beforeEach(() => {
    resetTables();
  });

  describe('POST /api/waitlist', () => {
    it('should add email to waitlist', async () => {
      const res = await request(app)
        .post('/api/waitlist')
        .send({ email: 'new@example.com', name: 'New User', role: 'family' });

      expect(res.status).toBe(201);
      expect(res.body.message).toMatch(/on the list/i);
      expect(tables.waitlist.length).toBe(1);
      expect(tables.waitlist[0].email).toBe('new@example.com');
    });

    it('should reject invalid email', async () => {
      const res = await request(app)
        .post('/api/waitlist')
        .send({ email: 'not-email' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/email/i);
    });

    it('should reject missing email', async () => {
      const res = await request(app)
        .post('/api/waitlist')
        .send({ name: 'No Email' });

      expect(res.status).toBe(400);
    });

    it('should handle duplicate email gracefully', async () => {
      tables.waitlist.push({
        id: 'existing',
        email: 'dup@example.com',
        name: 'Existing',
        role: 'family',
      });

      const res = await request(app)
        .post('/api/waitlist')
        .send({ email: 'dup@example.com' });

      expect(res.status).toBe(200);
      expect(res.body.alreadyExists).toBe(true);
    });

    it('should send notification email on signup', async () => {
      const { sendEmail } = require('../src/utils/email');
      sendEmail.mockClear();

      await request(app)
        .post('/api/waitlist')
        .send({ email: 'notify@example.com', name: 'Notify Test' });

      await new Promise(r => setTimeout(r, 50));
      expect(sendEmail).toHaveBeenCalled();
    });
  });

  describe('GET /api/waitlist/count', () => {
    it('should return waitlist count', async () => {
      tables.waitlist.push({ id: '1', email: 'a@b.com' });
      tables.waitlist.push({ id: '2', email: 'c@d.com' });

      const res = await request(app).get('/api/waitlist/count');

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(2);
    });

    it('should return 0 for empty waitlist', async () => {
      const res = await request(app).get('/api/waitlist/count');
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(0);
    });
  });
});
