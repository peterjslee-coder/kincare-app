/**
 * Input validation middleware
 * Provides reusable validators for common field types
 */

// Email format (basic but effective)
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Phone format (accepts US and international formats)
const PHONE_REGEX = /^[\d\s\-\(\)\+\.]{7,30}$/;

// Max lengths to prevent abuse
const MAX_LENGTHS = {
  email: 255,
  password: 128,
  firstName: 50,
  lastName: 50,
  phone: 30,
  text: 2000,      // general text fields (notes, instructions, etc.)
  shortText: 255,  // short text fields (addresses, names, etc.)
};

/**
 * Sanitize a string: trim whitespace, strip null bytes
 */
function sanitize(str) {
  if (typeof str !== "string") return str;
  return str.trim().replace(/\0/g, "");
}

/**
 * Validate email format and length
 */
function isValidEmail(email) {
  if (!email || typeof email !== "string") return false;
  const cleaned = sanitize(email).toLowerCase();
  return cleaned.length <= MAX_LENGTHS.email && EMAIL_REGEX.test(cleaned);
}

/**
 * Validate password strength
 */
function isValidPassword(password) {
  if (!password || typeof password !== "string") return false;
  if (password.length < 8 || password.length > MAX_LENGTHS.password) return false;
  if (!/[A-Z]/.test(password)) return false;    // at least one uppercase
  if (!/[0-9]/.test(password)) return false;    // at least one number
  if (!/[^A-Za-z0-9]/.test(password)) return false; // at least one special char
  return true;
}

/**
 * Validate phone format (optional field — returns true if empty)
 */
function isValidPhone(phone) {
  if (!phone) return true; // optional
  if (typeof phone !== "string") return false;
  return phone.length <= MAX_LENGTHS.phone && PHONE_REGEX.test(phone);
}

/**
 * Validate string length
 */
function isValidLength(str, max) {
  if (!str) return true; // optional
  if (typeof str !== "string") return false;
  return str.length <= max;
}

/**
 * Middleware: validate registration input
 */
function validateRegister(req, res, next) {
  const { email, password, firstName, lastName, phone, dateOfBirth } = req.body;

  if (!email || !password || !firstName || !lastName) {
    return res.status(400).json({ error: "Missing required fields: email, password, firstName, lastName" });
  }

  // v1.105.8 — age gate. See src/utils/age.js for why the floor is 13. Enforced on the
  // SERVER, not just in the form: the client field is a convenience, this is the rule.
  const { checkSignupAge } = require("../utils/age");
  const ageCheck = checkSignupAge(dateOfBirth);
  if (!ageCheck.ok) {
    return res.status(400).json({ error: ageCheck.message, reason: ageCheck.reason });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Invalid email format" });
  }

  if (!isValidPassword(password)) {
    return res.status(400).json({ error: "Password must be 8-128 characters with at least one uppercase letter, one number, and one special character" });
  }

  if (!isValidLength(firstName, MAX_LENGTHS.firstName)) {
    return res.status(400).json({ error: `First name must be under ${MAX_LENGTHS.firstName} characters` });
  }

  if (!isValidLength(lastName, MAX_LENGTHS.lastName)) {
    return res.status(400).json({ error: `Last name must be under ${MAX_LENGTHS.lastName} characters` });
  }

  if (!isValidPhone(phone)) {
    return res.status(400).json({ error: "Invalid phone format" });
  }

  // Sanitize inputs
  req.body.email = sanitize(email).toLowerCase();
  req.body.firstName = sanitize(firstName);
  req.body.lastName = sanitize(lastName);
  if (phone) req.body.phone = sanitize(phone);

  next();
}

/**
 * Middleware: validate login input
 */
function validateLogin(req, res, next) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Invalid email format" });
  }

  req.body.email = sanitize(email).toLowerCase();
  next();
}

/**
 * Middleware: validate profile update input
 */
function validateProfileUpdate(req, res, next) {
  const { firstName, lastName, phone } = req.body;

  if (firstName !== undefined && !isValidLength(firstName, MAX_LENGTHS.firstName)) {
    return res.status(400).json({ error: `First name must be under ${MAX_LENGTHS.firstName} characters` });
  }

  if (lastName !== undefined && !isValidLength(lastName, MAX_LENGTHS.lastName)) {
    return res.status(400).json({ error: `Last name must be under ${MAX_LENGTHS.lastName} characters` });
  }

  if (phone !== undefined && !isValidPhone(phone)) {
    return res.status(400).json({ error: "Invalid phone format" });
  }

  // Sanitize
  if (firstName) req.body.firstName = sanitize(firstName);
  if (lastName) req.body.lastName = sanitize(lastName);
  if (phone) req.body.phone = sanitize(phone);

  next();
}

/**
 * Middleware: validate message input
 */
function validateMessage(req, res, next) {
  const { content, recipientId } = req.body;

  if (!content || typeof content !== "string" || content.trim().length === 0) {
    return res.status(400).json({ error: "Message content required" });
  }

  if (!isValidLength(content, MAX_LENGTHS.text)) {
    return res.status(400).json({ error: `Message must be under ${MAX_LENGTHS.text} characters` });
  }

  if (!recipientId) {
    return res.status(400).json({ error: "Recipient ID required" });
  }

  req.body.content = sanitize(content);
  next();
}

/**
 * Middleware: validate session creation input
 */
function validateSession(req, res, next) {
  const { careRecipientId, serviceType, scheduledDate, scheduledTime, durationHours, recurrenceRule, recurrenceWeeks } = req.body;

  if (!careRecipientId) {
    return res.status(400).json({ error: "Care recipient required" });
  }

  const validTypes = [
    "meals", "companion", "rides", "errands", "medical",
    "personal_care", "housekeeping", "companionship",
    "meal_prep", "transportation", "health_wellness", "full_day",
  ];
  if (!serviceType || !validTypes.includes(serviceType)) {
    return res.status(400).json({ error: `Service type must be one of: ${validTypes.join(", ")}` });
  }

  if (!scheduledDate || !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
    return res.status(400).json({ error: "Valid scheduled date required (YYYY-MM-DD)" });
  }

  if (scheduledTime && !/^\d{2}:\d{2}$/.test(scheduledTime)) {
    return res.status(400).json({ error: "Valid time format required (HH:MM)" });
  }

  if (durationHours !== undefined && (typeof durationHours !== "number" || durationHours < 0.5 || durationHours > 24)) {
    return res.status(400).json({ error: "Duration must be between 0.5 and 24 hours" });
  }

  // Validate recurrence fields
  if (recurrenceRule !== undefined) {
    const validRules = ["weekly", "biweekly"];
    if (!validRules.includes(recurrenceRule)) {
      return res.status(400).json({ error: "Recurrence rule must be 'weekly' or 'biweekly'" });
    }
  }

  if (recurrenceWeeks !== undefined) {
    const weeks = parseInt(recurrenceWeeks);
    if (isNaN(weeks) || weeks < 2 || weeks > 12) {
      return res.status(400).json({ error: "Recurrence weeks must be between 2 and 12" });
    }
  }

  if (req.body.specialInstructions) {
    req.body.specialInstructions = sanitize(req.body.specialInstructions);
  }

  next();
}

/**
 * Middleware: limit JSON body size (prevent abuse)
 */
function limitBodySize(maxBytes = 50000) {
  return (req, res, next) => {
    // Skip body size check for multipart/form-data (file uploads) — multer handles its own limits
    const contentType = req.headers["content-type"] || "";
    if (contentType.startsWith("multipart/form-data")) return next();
    // Skip for photo upload endpoints — they have their own express.json limit (5mb)
    if (req.path === "/me/photo" || req.originalUrl?.includes("/api/auth/me/photo")) return next();
    if (req.originalUrl?.includes("/photo") && req.method === "PUT") return next();
    // Skip for self-onboarding (ID verification sends base64 images)
    if (req.originalUrl?.startsWith("/api/self-onboarding")) return next();
    // Skip for reimbursements (receipt photos/PDFs as base64 — express.json 10mb limit applies)
    if (req.originalUrl?.startsWith("/api/reimbursements")) return next();
    // v1.103.2 — skip for notes (observation photos as base64 — express.json 8mb + route-level 5MB photo check apply)
    if (req.originalUrl?.startsWith("/api/notes")) return next();
    // v1.105.0 — skip for feedback (optional base64 screenshot — express.json 4mb + route-level 2MB screenshot check apply)
    if (req.originalUrl?.startsWith("/api/feedback")) return next();
    const contentLength = parseInt(req.headers["content-length"] || "0");
    if (contentLength > maxBytes) {
      return res.status(413).json({ error: "Request body too large" });
    }
    next();
  };
}

module.exports = {
  sanitize,
  isValidEmail,
  isValidPassword,
  isValidPhone,
  isValidLength,
  validateRegister,
  validateLogin,
  validateProfileUpdate,
  validateMessage,
  validateSession,
  limitBodySize,
  MAX_LENGTHS,
};
