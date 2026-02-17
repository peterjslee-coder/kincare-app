/**
 * Input validation middleware
 * Provides reusable validators for common field types
 */

// Email format (basic but effective)
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Phone format (accepts various US formats)
const PHONE_REGEX = /^[\d\s\-\(\)\+\.]{7,20}$/;

// Max lengths to prevent abuse
const MAX_LENGTHS = {
  email: 255,
  password: 128,
  firstName: 50,
  lastName: 50,
  phone: 20,
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
  return password.length >= 8 && password.length <= MAX_LENGTHS.password;
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
  const { email, password, firstName, lastName, phone } = req.body;

  if (!email || !password || !firstName || !lastName) {
    return res.status(400).json({ error: "Missing required fields: email, password, firstName, lastName" });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Invalid email format" });
  }

  if (!isValidPassword(password)) {
    return res.status(400).json({ error: "Password must be 8-128 characters" });
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
  const { careRecipientId, serviceType, scheduledDate, scheduledTime, durationHours } = req.body;

  if (!careRecipientId) {
    return res.status(400).json({ error: "Care recipient required" });
  }

  const validTypes = ["meals", "companion", "rides", "errands", "medical", "personal_care", "housekeeping"];
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
