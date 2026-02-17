/**
 * Auth Route Tests — Registration, Login, Profile, Email Verification
 */
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { tables, resetTables } = require('./setup');

// Require app AFTER mocks are set up
const app = require('../src/server');

describe('Auth Routes', () => {
  beforeEach(() => {
    resetTables();
  });

  // ─── Registration ───
  describe('POST /api/auth/register', () => {
    it('should register a new user', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'SecurePass1!',
          firstName: 'Test',
          lastName: 'User',
          role: 'family',
        });

      expect(res.status).toBe(201);
      expect(res.body.user).toBeDefined();
      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe('test@example.com');
      expect(res.body.user.firstName).toBe('Test');
      expect(res.body.user.role).toBe('family');
      expect(res.body.user.emailVerified).toBe(false);
    });

    it('should reject registration with missing fields', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'test@example.com' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('should reject invalid email format', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'not-an-email',
          password: 'SecurePass1!',
          firstName: 'Test',
          lastName: 'User',
        });

      expect(res.status).toBe(400);
    });

    it('should reject weak passwords', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: '123',
          firstName: 'Test',
          lastName: 'User',
        });

      expect(res.status).toBe(400);
    });

    it('should reject duplicate email', async () => {
      // Insert existing user
      const hash = await bcrypt.hash('password', 10);
      tables.users.push({
        id: 'existing-id',
        email: 'test@example.com',
        password_hash: hash,
        role: 'family',
        first_name: 'Existing',
        last_name: 'User',
        is_active: 1,
      });

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'SecurePass1!',
          firstName: 'Test',
          lastName: 'User',
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already registered/i);
    });

    it('should reject invalid role', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'SecurePass1!',
          firstName: 'Test',
          lastName: 'User',
          role: 'admin',
        });

      expect(res.status).toBe(400);
    });

    it('should send verification email on registration', async () => {
      const { sendEmail } = require('../src/utils/email');
      sendEmail.mockClear();

      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'verify@example.com',
          password: 'SecurePass1!',
          firstName: 'Verify',
          lastName: 'Me',
        });

      // Fire-and-forget, so give it a tick
      await new Promise(r => setTimeout(r, 50));
      expect(sendEmail).toHaveBeenCalled();
    });
  });

  // ─── Login ───
  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      const hash = await bcrypt.hash('inplace123', 10);
      tables.users.push({
        id: 'user-1',
        email: 'pete@inplace.care',
        password_hash: hash,
        role: 'family',
        first_name: 'Pete',
        last_name: 'Lee',
        is_active: 1,
        email_verified: 1,
      });
    });

    it('should login with valid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'pete@inplace.care', password: 'inplace123' });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe('pete@inplace.care');
      expect(res.body.user.firstName).toBe('Pete');
      expect(res.body.user.emailVerified).toBe(true);
    });

    it('should reject wrong password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'pete@inplace.care', password: 'wrongpassword' });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/invalid/i);
    });

    it('should reject non-existent email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: 'inplace123' });

      expect(res.status).toBe(401);
    });

    it('should reject missing fields', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // ─── Profile (GET /me) ───
  describe('GET /api/auth/me', () => {
    it('should return current user with valid token', async () => {
      // Register to get a token
      const regRes = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'me@example.com',
          password: 'SecurePass1!',
          firstName: 'Me',
          lastName: 'User',
        });

      const token = regRes.body.token;

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe('me@example.com');
    });

    it('should reject request without token', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    it('should reject request with invalid token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token-here');
      expect(res.status).toBe(401);
    });
  });

  // ─── Profile Update (PUT /me) ───
  describe('PUT /api/auth/me', () => {
    it('should update user profile', async () => {
      const regRes = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'update@example.com',
          password: 'SecurePass1!',
          firstName: 'Original',
          lastName: 'Name',
        });

      const token = regRes.body.token;

      const res = await request(app)
        .put('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ firstName: 'Updated', lastName: 'Person' });

      expect(res.status).toBe(200);
    });

    it('should reject empty update', async () => {
      const regRes = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'empty@example.com',
          password: 'SecurePass1!',
          firstName: 'Empty',
          lastName: 'Update',
        });

      const res = await request(app)
        .put('/api/auth/me')
        .set('Authorization', `Bearer ${regRes.body.token}`)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // ─── Email Verification ───
  describe('Email Verification', () => {
    it('GET /api/auth/verify should reject missing token', async () => {
      const res = await request(app).get('/api/auth/verify');
      expect(res.status).toBe(400);
    });

    it('GET /api/auth/verify should reject invalid token', async () => {
      const res = await request(app).get('/api/auth/verify?token=bad-token');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid|expired/i);
    });

    it('GET /api/auth/verify should verify valid token', async () => {
      // Insert a user and token
      tables.users.push({
        id: 'verify-user',
        email: 'v@test.com',
        password_hash: 'hash',
        role: 'family',
        first_name: 'V',
        last_name: 'U',
        email_verified: 0,
      });
      tables.email_verification_tokens.push({
        id: 'token-1',
        user_id: 'verify-user',
        token: 'valid-token-abc',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      });

      const res = await request(app).get('/api/auth/verify?token=valid-token-abc');
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/verified/i);
    });

    it('POST /api/auth/resend-verification should require auth', async () => {
      const res = await request(app).post('/api/auth/resend-verification');
      expect(res.status).toBe(401);
    });
  });
});
