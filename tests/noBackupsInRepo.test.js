// v1.155.7 — eight production database dumps (Backups/*.sql, 307 MB of real user data) were
// committed by accident in v1.151.1. .gitignore now blocks them; this fails if one is tracked.
const { execSync } = require("child_process");

test("no database dump is tracked in git", () => {
  let files = "";
  try { files = execSync("git ls-files", { cwd: require("path").join(__dirname, ".."), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); }
  catch { return; } // not a git checkout (e.g. a deploy image): nothing to check
  const bad = files.split("\n").filter((f) => /^Backups\//.test(f) || /\.sql$/i.test(f) || /\.dump$/i.test(f));
  expect(bad).toEqual([]);
});
