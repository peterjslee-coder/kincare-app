// A safety flag has to be reachable, and resolving it has to be honest. (v1.105.177)
//
// Pete: "i got a flagged message to resolve. i clicked to resolve it. it opened the app, but no
// 'needs you' or prompt to open admin or anything. just dead ends. found it when i went looking
// in admin. tried to resolve. sentry error followed... i clicked resolve again. it resolved,
// but then...there's no longer any messages in the thread."
//
// Four separate defects in one report. The messages were never gone — all 94 were on production
// the whole time, newest being the flagged message itself.

const { code } = require("./helpers/source");
const fs = require("fs");
const path = require("path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

const app = code("public/js/app.js");
const messages = code("public/js/components/Messages.js");
const card = code("public/js/components/AttentionCard.js");
const safetyRoute = read("src/routes/admin/safety.js");
const messageSafety = read("src/utils/messageSafety.js");
const attention = read("src/utils/attention.js");

describe("the push tap goes somewhere", () => {
  test("the payload carries the flag it is about", () => {
    // It carried only type + conversationId, so even a router branch would have had nothing
    // to open.
    expect(messageSafety).toMatch(/data: \{ type: "safety_flag", conversationId, flagId, page: "admin" \}/);
    expect(messageSafety).toMatch(/const flagId = uuid\(\);/);
  });

  test("the router has a branch for it at all", () => {
    // There was none, and no `page` to fall through to, so `target` stayed null and
    // __handlePushNavigate returned. The tap opened the app and did nothing.
    expect(app).toMatch(/\} else if \(t === 'safety_flag'\) \{/);
    expect(app).toMatch(/window\.__pendingFocus = `safetyFlag:\$\{d\.flagId\}`/);
  });
});

describe("and it does not depend on the tap", () => {
  test("a pending flag reaches the one surface whose job is 'you are the blocker'", () => {
    // A push is gone the moment it is missed. He found this by going looking.
    expect(attention).toMatch(/const safetyRows = await safeRows\("safetyFlags"/);
    expect(attention).toMatch(/WHERE sf\.status IN \('pending', 'escalated'\)/);
  });

  test("escalated still counts — escalating is not resolving", () => {
    expect(attention).toMatch(/'pending', 'escalated'/);
  });

  test("admins only, by is_admin and not by role", () => {
    // Pete is role 'family' AND is_admin; a check on role would skip the only admin there is.
    const block = attention.slice(attention.indexOf('safeRows("safetyFlags"'), attention.indexOf("// ── A care task assigned to me"));
    expect(block).toMatch(/if \(!me \|\| !me\.is_admin\) return \[\];/);
  });

  test("it is in the total, so the app icon and the card agree", () => {
    expect(attention).toMatch(/\+ safetyRows\.length,/);
    expect(attention).toMatch(/safetyFlags: safetyRows\.length,/);
    expect(attention).toMatch(/careTasks: 0, approvals: 0, safetyFlags: 0,/); // the EMPTY shape
  });

  test("no excerpt of the flagged message on the card", () => {
    const item = attention.slice(attention.indexOf('kind: "safetyFlag"'), attention.indexOf('kind: "careTask"'));
    expect(item).not.toMatch(/user_message|messageContent/);
  });

  test("and no one-tap resolve", () => {
    // Every other item can be settled from the card. Resolving an abuse report without reading
    // it is not a thing to make easy.
    const item = attention.slice(attention.indexOf('kind: "safetyFlag"'), attention.indexOf('kind: "careTask"'));
    expect(item).toMatch(/action: null,/);
    expect(card).toMatch(/\{item\.action && \(/);
    expect(card).toMatch(/item\.action \? 'Open' : \(item\.verb \|\| 'Open'\)/);
  });
});

describe("pressing resolve twice is one decision", () => {
  const route = safetyRoute.slice(
    safetyRoute.indexOf('router.put("/safety-flags/:id", authenticate'),
    safetyRoute.indexOf("// ─── POST /api/admin/safety-flags/:id/challenge")
  );

  test("a repeat of the same status by the same admin writes no second audit event", () => {
    // His flag carries TWO status_resolved events, 95 seconds apart, from one decision — the
    // first request had landed, it just took longer than the client's 25s timeout to say so.
    expect(route).toMatch(/const isRepeat = before\.status === status && before\.reviewed_by === req\.user\.id;/);
    expect(route).toMatch(/if \(isRepeat\) return res\.json\(\{ success: true, repeated: true \}\);/);
  });

  test("a genuine status change still records one", () => {
    // pending → escalated → resolved is a real sequence and each step is real.
    const auditAt = route.indexOf("INSERT INTO safety_flag_events");
    const repeatAt = route.indexOf("if (isRepeat) return");
    expect(auditAt).toBeGreaterThan(repeatAt); // the guard is above it, not instead of it
  });

  test("a missing flag is a 404, not a silent write", () => {
    expect(route).toMatch(/if \(!before\) return res\.status\(404\)/);
  });

  test("the 500 is reported", () => {
    // The catch swallowed the reason entirely, on the route that records who reviewed an abuse
    // report.
    expect(route).toMatch(/captureException\(err, \{ where: "admin: safety flag review"/);
  });
});

describe("an empty thread means empty, not broken", () => {
  test("the empty state waits for a load that actually succeeded", () => {
    // `messages` is [] before the first load, after a failed one, AND when a conversation is
    // genuinely empty. One screen for three situations, and it picked the most alarming
    // reading available: your mother's care conversation is gone.
    expect(messages).toMatch(/const \[threadState, setThreadState\] = useState\('idle'\)/);
    expect(messages).toMatch(/threadState !== 'loaded' \? \(/);
  });

  test("a failed load says so, and says nothing was deleted", () => {
    expect(messages).toMatch(/Couldn\{'\\u2019'\}t load this conversation/);
    expect(messages).toMatch(/Nothing has been deleted\./);
    expect(messages).toMatch(/>Try again</);
  });

  test("a failed fetch never empties what is on screen", () => {
    expect(messages).toMatch(/if \(!res\?\.ok\) \{ setThreadState\('failed'\); return; \}/);
    expect(messages).toMatch(/setThreadState\('failed'\);\s*\n\s*console\.error\('Fetch messages error:'/);
  });

  test("switching threads resets it, so one thread cannot vouch for another", () => {
    expect(messages).toMatch(/setThreadState\('loading'\); \/\/ this thread has not loaded yet/);
  });
});
