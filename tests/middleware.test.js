/**
 * Middleware Tests — Auth & Validation
 */
const jwt = require('jsonwebtoken');

// Set test secret before requiring modules
process.env.JWT_SECRET = 'test-secret-for-jest';

const { generateToken, authenticate, requireRole } = require('../src/middleware/auth');

describe('Auth Middleware', () => {
  describe('generateToken', () => {
    it('should generate a valid JWT', () => {
      const user = { id: 'user-1', email: 'test@test.com', role: 'family' };
      const token = generateToken(user);
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');

      const decoded = jwt.verify(token, 'test-secret-for-jest');
      expect(decoded.id).toBe('user-1');
      expect(decoded.email).toBe('test@test.com');
      expect(decoded.role).toBe('family');
    });
  });

  describe('authenticate', () => {
    it('should reject request without Authorization header', () => {
      const req = { headers: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject invalid token', () => {
      const req = { headers: { authorization: 'Bearer invalid-token' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should set req.user for valid token', () => {
      const user = { id: 'user-1', email: 'test@test.com', role: 'family' };
      const token = generateToken(user);

      const req = { headers: { authorization: `Bearer ${token}` } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      authenticate(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user.id).toBe('user-1');
      expect(req.user.role).toBe('family');
    });
  });

  describe('requireRole', () => {
    it('should allow matching role', () => {
      const middleware = requireRole('family', 'caregiver');
      const req = { user: { role: 'family' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should reject non-matching role', () => {
      const middleware = requireRole('caregiver');
      const req = { user: { role: 'family' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
  });
});

describe('Validation Middleware', () => {
  const { validateRegister, validateLogin, validateMessage, validateSession } = require('../src/middleware/validate');

  function mockReqRes(body) {
    return {
      req: { body, headers: {} },
      res: { status: jest.fn().mockReturnThis(), json: jest.fn() },
      next: jest.fn(),
    };
  }

  describe('validateRegister', () => {
    it('should pass valid registration', () => {
      const { req, res, next } = mockReqRes({
        email: 'test@example.com',
        password: 'StrongPass1!',
        firstName: 'Test',
        lastName: 'User',
      });
      validateRegister(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should reject missing email', () => {
      const { req, res, next } = mockReqRes({
        password: 'StrongPass1!',
        firstName: 'Test',
        lastName: 'User',
      });
      validateRegister(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject short password', () => {
      const { req, res, next } = mockReqRes({
        email: 'test@example.com',
        password: 'abc',
        firstName: 'Test',
        lastName: 'User',
      });
      validateRegister(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should trim and lowercase email', () => {
      const { req, res, next } = mockReqRes({
        email: '  Test@Example.COM  ',
        password: 'StrongPass1!',
        firstName: 'Test',
        lastName: 'User',
      });
      validateRegister(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.body.email).toBe('test@example.com');
    });
  });

  describe('validateLogin', () => {
    it('should pass valid login', () => {
      const { req, res, next } = mockReqRes({
        email: 'test@example.com',
        password: 'password',
      });
      validateLogin(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should reject missing password', () => {
      const { req, res, next } = mockReqRes({
        email: 'test@example.com',
      });
      validateLogin(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('validateMessage', () => {
    it('should pass valid message', () => {
      const { req, res, next } = mockReqRes({
        recipientId: 'user-2',
        content: 'Hello!',
      });
      validateMessage(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should reject empty content', () => {
      const { req, res, next } = mockReqRes({
        recipientId: 'user-2',
        content: '',
      });
      validateMessage(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject missing recipientId', () => {
      const { req, res, next } = mockReqRes({
        content: 'Hello!',
      });
      validateMessage(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('validateSession', () => {
    const validSession = {
      careRecipientId: 'cr-1',
      serviceType: 'companionship',
      scheduledDate: '2026-03-01',
      scheduledTime: '09:00',
      durationHours: 2,
    };

    it('should pass valid session without recurrence', () => {
      const { req, res, next } = mockReqRes({ ...validSession });
      validateSession(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should pass valid session with weekly recurrence', () => {
      const { req, res, next } = mockReqRes({
        ...validSession,
        recurrenceRule: 'weekly',
        recurrenceWeeks: 4,
      });
      validateSession(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should pass valid session with biweekly recurrence', () => {
      const { req, res, next } = mockReqRes({
        ...validSession,
        recurrenceRule: 'biweekly',
        recurrenceWeeks: 8,
      });
      validateSession(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should reject invalid recurrence rule', () => {
      const { req, res, next } = mockReqRes({
        ...validSession,
        recurrenceRule: 'monthly',
      });
      validateSession(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject recurrence weeks out of range', () => {
      const { req, res, next } = mockReqRes({
        ...validSession,
        recurrenceRule: 'weekly',
        recurrenceWeeks: 20,
      });
      validateSession(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should accept all new service types', () => {
      const types = ['companionship', 'personal_care', 'meal_prep', 'transportation', 'health_wellness', 'full_day'];
      types.forEach(serviceType => {
        const { req, res, next } = mockReqRes({ ...validSession, serviceType });
        validateSession(req, res, next);
        expect(next).toHaveBeenCalled();
      });
    });

    it('should reject missing care recipient', () => {
      const { req, res, next } = mockReqRes({ ...validSession, careRecipientId: undefined });
      validateSession(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject invalid date format', () => {
      const { req, res, next } = mockReqRes({ ...validSession, scheduledDate: 'March 1' });
      validateSession(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});
