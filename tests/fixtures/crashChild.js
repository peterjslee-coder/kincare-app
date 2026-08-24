// Child process for tests/crashHandlers.test.js. Argv picks the failure to stage.
//   throw    — a synchronous throw with nobody catching it
//   reject   — a promise rejection with no .catch
//   bare     — no handlers installed, then throw (the control: what Node does by itself)
const mode = process.argv[2];
if (mode !== "bare") {
  require("../../src/utils/crashHandlers").installCrashHandlers({ flushMs: 10 });
}
if (mode === "reject") {
  Promise.reject(new Error("nobody caught this"));
  // Stay alive long enough to prove the process SURVIVES it, then leave on our own terms.
  setTimeout(() => { console.log("STILL ALIVE"); process.exit(0); }, 300);
} else {
  setTimeout(() => { throw new Error("the pool dropped an idle client"); }, 10);
  setTimeout(() => { console.log("SHOULD NOT REACH"); process.exit(0); }, 2000);
}
