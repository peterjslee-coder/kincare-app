// convertParams: only real placeholders become bind parameters. (v1.105.90)
//
// It was `sql.replace(/\?/g, ...)` — a naive global replace, so EVERY question mark in the
// string became a parameter. A SQL comment quoting Pete ("why can't i see the job i posted?")
// silently became placeholder #11 on a 10-argument query, and every caregiver dashboard 500'd
// with "bind message supplies 10 parameters, but prepared statement requires 11".
//
// The query was right. The comment was not code, and nothing said so.

const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "src", "models", "database.js"), "utf8");
const start = src.indexOf("function convertParams");
const end = src.indexOf("\n}", src.indexOf("return out;")) + 2;
// eslint-disable-next-line no-eval
eval(src.slice(start, end));

const countParams = (sql) => (convertParams(sql).match(/\$\d+/g) || []).length;

describe("real placeholders are converted", () => {
  test("plain placeholders", () => {
    expect(convertParams("SELECT * FROM t WHERE a = ? AND b = ?")).toBe("SELECT * FROM t WHERE a = $1 AND b = $2");
  });

  test("numbering continues across the whole statement", () => {
    expect(countParams("SELECT ? , ? FROM t WHERE c = ? AND d = ?")).toBe(4);
  });
});

describe("a question mark that is not a placeholder is left alone", () => {
  test("inside a block comment — the one that broke the dashboard", () => {
    expect(countParams("SELECT * FROM t /* why can't i see the job i posted? */ WHERE a = ?")).toBe(1);
  });

  test("inside a line comment", () => {
    expect(countParams("SELECT * FROM t -- is this a placeholder?\n WHERE a = ?")).toBe(1);
  });

  test("inside a string literal", () => {
    expect(countParams("SELECT * FROM t WHERE name LIKE '%?%' AND a = ?")).toBe(1);
  });

  test("inside a string literal containing an escaped quote", () => {
    expect(countParams("SELECT 'it''s ok?' AS x WHERE a = ?")).toBe(1);
  });

  test("a comment at the very end, unterminated, does not swallow a real placeholder", () => {
    expect(countParams("SELECT * FROM t WHERE a = ? -- trailing?")).toBe(1);
  });
});

describe("the shape that actually shipped", () => {
  test("the openJobs comment no longer consumes a parameter", () => {
    const dash = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "dashboard.js"), "utf8");
    const i = dash.indexOf("const openJobs = await db.prepare");
    const q = dash.slice(i, dash.indexOf(").all(", i));
    // Whatever the comments say, the placeholder count must match the argument list.
    const args = dash.slice(dash.indexOf(").all(", i), dash.indexOf(";", dash.indexOf(").all(", i)));
    const placeholders = countParams(q);
    const argCount = args.split(",").length;
    expect(placeholders).toBe(argCount);
  });
});
