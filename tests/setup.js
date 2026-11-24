/**
 * Test Setup — Mock database layer
 *
 * Replaces the PostgreSQL pool with an in-memory store so tests
 * run fast without needing a live database.
 */

// In-memory table storage
const tables = {};

function resetTables() {
  Object.keys(tables).forEach(k => delete tables[k]);
  // Pre-create tables the app expects
  ['users', 'care_recipients', 'caregiver_profiles', 'availability',
   'care_sessions', 'visit_logs', 'visit_photos', 'activity_feed',
   'reviews', 'payments', 'messages', 'recipient_notes',
   'caregiver_assignments', 'waitlist', 'password_reset_tokens',
   'email_verification_tokens'
  ].forEach(t => { tables[t] = []; });
}
resetTables();

// Simple SQL parser for our mock — handles INSERT, SELECT, UPDATE, DELETE
function parseTable(sql) {
  const s = sql.trim().toUpperCase();
  let match;
  if (s.startsWith('INSERT INTO')) {
    match = sql.match(/INSERT\s+INTO\s+(\w+)/i);
  } else if (s.startsWith('SELECT')) {
    match = sql.match(/FROM\s+(\w+)/i);
  } else if (s.startsWith('UPDATE')) {
    match = sql.match(/UPDATE\s+(\w+)/i);
  } else if (s.startsWith('DELETE')) {
    match = sql.match(/DELETE\s+FROM\s+(\w+)/i);
  }
  return match ? match[1].toLowerCase() : null;
}

// Mock database wrapper
class MockDatabaseWrapper {
  prepare(sql) {
    const pgSql = sql; // We don't actually need to convert params in mock
    return {
      async run(...params) {
        const table = parseTable(sql);
        const upper = sql.trim().toUpperCase();

        if (upper.startsWith('INSERT INTO') && table && tables[table]) {
          // Parse column names and values
          const colMatch = sql.match(/\(([^)]+)\)\s*VALUES/i);
          const cols = colMatch ? colMatch[1].split(',').map(c => c.trim()) : [];
          const row = {};
          cols.forEach((col, i) => { row[col] = params[i] !== undefined ? params[i] : null; });
          tables[table].push(row);
          return { changes: 1 };
        }

        if (upper.startsWith('UPDATE') && table && tables[table]) {
          // Simple: find rows matching WHERE clause and update
          // We handle simple "WHERE column = ?" patterns
          const whereMatch = sql.match(/WHERE\s+(\w+)\s*=\s*\?/gi);
          let updated = 0;
          if (whereMatch) {
            const lastParamCount = whereMatch.length;
            const whereParams = params.slice(-lastParamCount);
            const whereCols = whereMatch.map(w => w.match(/WHERE\s+(\w+)/i)?.[1]?.toLowerCase() || w.match(/AND\s+(\w+)/i)?.[1]?.toLowerCase());

            tables[table].forEach(row => {
              let match = true;
              whereCols.forEach((col, i) => {
                if (row[col] !== whereParams[i]) match = false;
              });
              if (match) {
                // Parse SET clauses
                const setMatch = sql.match(/SET\s+(.+?)\s+WHERE/is);
                if (setMatch) {
                  const setParts = setMatch[1].split(',');
                  let paramIdx = 0;
                  setParts.forEach(part => {
                    const colName = part.match(/(\w+)\s*=/)?.[1]?.toLowerCase();
                    if (colName && part.includes('?')) {
                      row[colName] = params[paramIdx++];
                    } else if (colName && part.toUpperCase().includes('NOW()')) {
                      row[colName] = new Date().toISOString();
                    }
                  });
                }
                updated++;
              }
            });
          }
          return { changes: updated };
        }

        if (upper.startsWith('DELETE') && table && tables[table]) {
          const whereMatch = sql.match(/WHERE\s+(\w+)\s*=\s*\?/i);
          if (whereMatch) {
            const col = whereMatch[1].toLowerCase();
            const val = params[0];
            const before = tables[table].length;
            tables[table] = tables[table].filter(r => r[col] !== val);
            return { changes: before - tables[table].length };
          }
          return { changes: 0 };
        }

        return { changes: 0 };
      },

      async get(...params) {
        const table = parseTable(sql);
        if (!table || !tables[table]) return undefined;

        const upper = sql.trim().toUpperCase();

        // COUNT query
        if (upper.includes('COUNT(*)')) {
          return { count: tables[table].length };
        }

        // SELECT with WHERE
        const whereMatches = [...sql.matchAll(/(?:WHERE|AND)\s+(\w+)\s*=\s*\?/gi)];
        if (whereMatches.length > 0) {
          const conditions = whereMatches.map(m => m[1].toLowerCase());
          return tables[table].find(row => {
            return conditions.every((col, i) => row[col] === params[i]);
          });
        }

        return tables[table][0];
      },

      async all(...params) {
        const table = parseTable(sql);
        if (!table || !tables[table]) return [];

        const whereMatches = [...sql.matchAll(/(?:WHERE|AND)\s+(\w+)\s*=\s*\?/gi)];
        if (whereMatches.length > 0) {
          const conditions = whereMatches.map(m => m[1].toLowerCase());
          return tables[table].filter(row => {
            return conditions.every((col, i) => row[col] === params[i]);
          });
        }

        return [...tables[table]];
      },
    };
  }

  async exec() {
    // No-op for mock (CREATE TABLE, ALTER TABLE, etc.)
  }
}

const mockDb = new MockDatabaseWrapper();

// Mock the database module
jest.mock('../src/models/database', () => ({
  getDb: jest.fn().mockResolvedValue(mockDb),
  initializeDatabase: jest.fn().mockResolvedValue(mockDb),
  resetDb: jest.fn(),
}));

// Mock the email module (don't send real emails in tests)
jest.mock('../src/utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue({ success: true, id: 'mock-email-id' }),
  brandedHtml: jest.fn().mockReturnValue('<html>mock</html>'),
  getFromAddress: jest.fn().mockReturnValue('InPlace <test@test.com>'),
}));

// Set test env vars
process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.NODE_ENV = 'test';

module.exports = { tables, resetTables, mockDb };
