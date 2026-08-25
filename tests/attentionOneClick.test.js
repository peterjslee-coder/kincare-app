// "Needs you", as a thing you can answer rather than a number you can read. (v1.105.129)
//
// Pete, 8/24: "I'm not happy with how the 'needs you' is displayed… if something needs me
// let's get it clear on WHAT they're needed for and make it a one-click event to clear it
// out or open it up for more."
//
// Two properties are worth pinning, and neither is the styling:
//
//   1. Each item says what it IS — whose, how much, for when — and carries the ONE request
//      that ends it. The request is named on the server, beside the query that found the
//      row, so a client cannot put the right-looking id in the wrong path.
//   2. Nothing is irreversible on the first tap. The card holds every action for five
//      seconds and flushes what is still held on pagehide, with keepalive — otherwise
//      "tap Approve, close the app" silently does nothing at all.
//
// The render half is a render test, not a string match, for the reason in
// cancelSessionModal.test.js: an item that draws its title is not the same as one whose
// title is present in the source.

const fs = require("fs");
const path = require("path");
const babel = require("@babel/core");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { attentionItemsFor } = require("../src/utils/attention");

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

// ─── the server: one row of each kind, as the database would hand it over ───

const REIMBURSEMENT = {
  id: "reim-1", amount: "24.60", description: "Groceries", category: "food",
  expense_date: "2026-08-21", care_team_id: "team-1",
  payee_first: "Edwina", payee_last: "Hall", recipient_first: "Betty",
};
const OFFER = {
  id: "tp-1", session_id: "sess-9", proposed_date: "2026-08-26", proposed_time: "14:00",
  message: "I could do the afternoon", caregiver_first: "Julia", caregiver_last: "Huth",
  service_type: "companion", tz: "America/New_York", recipient_first: "Betty",
};
const CHANGE = {
  id: "tcp-1", session_id: "sess-4", proposed_by: "caregiver",
  original_time: "09:00", proposed_time: "11:00", original_duration: 2, proposed_duration: 2,
  reason: "Dentist ran long", is_within_24h: true, scheduled_date: "2026-08-25",
  scheduled_time: "09:00", service_type: "companion", tz: "America/New_York",
  recipient_first: "Betty", caregiver_first: "Julia", caregiver_last: "Huth",
  family_first: "Pete", family_last: "Lee",
};
const TASK = {
  id: "occ-1", due_at: "2026-08-24T22:00:00Z", due_date: "2026-08-24",
  title: "Evening medication", task_type: "medication", tz: "America/New_York",
  care_recipient_id: "cr-1", recipient_first: "Betty",
};

function fakeDb({ reimbursements = [], offers = [], changes = [], tasks = [], messages = 0 } = {}) {
  return {
    prepare(sql) {
      const norm = sql.replace(/\s+/g, " ");
      return {
        async get() { return { count: norm.includes("FROM messages") ? messages : 0 }; },
        async all() {
          if (norm.includes("FROM reimbursements")) return reimbursements;
          if (norm.includes("FROM time_proposals")) return offers;
          if (norm.includes("FROM time_change_proposals")) return changes;
          if (norm.includes("FROM care_task_occurrences")) return tasks;
          return [];
        },
      };
    },
  };
}

const only = async (kind, seed) => {
  const { items } = await attentionItemsFor(fakeDb(seed), "pete");
  return items.find((i) => i.kind === kind);
};

describe("each item says what it is", () => {
  test("a reimbursement names the amount and the person being paid back", async () => {
    const item = await only("reimbursement", { reimbursements: [REIMBURSEMENT] });
    expect(item.title).toBe("Approve $24.60 to Edwina Hall");
    expect(item.detail).toBe("Groceries · food");
    expect(item.forWhom).toBe("Betty");
  });

  test("and says plainly that approving is not paying", async () => {
    // Pete's money rule: copy must say where money moves. Approval marks it approved;
    // nothing leaves an account until someone picks how to pay.
    const item = await only("reimbursement", { reimbursements: [REIMBURSEMENT] });
    expect(item.note).toMatch(/doesn't send money/);
  });

  test("a time change carries both times, not just the new one", async () => {
    const item = await only("timeChange", { changes: [CHANGE] });
    expect(item.title).toBe("Julia Huth asked to move a visit");
    expect(item.fromTime).toBe("09:00");
    expect(item.toTime).toBe("11:00");
    expect(item.isWithin24h).toBe(true);
  });

  test("a care task is the task, in the words the family wrote", async () => {
    const item = await only("careTask", { tasks: [TASK] });
    expect(item.title).toBe("Evening medication");
    expect(item.verb).toBe("Mark done");
  });

  test("every item has a verb and exactly one action", async () => {
    const { items } = await attentionItemsFor(
      fakeDb({ reimbursements: [REIMBURSEMENT], offers: [OFFER], changes: [CHANGE], tasks: [TASK] }),
      "pete"
    );
    expect(items).toHaveLength(4);
    for (const item of items) {
      expect(typeof item.verb).toBe("string");
      expect(item.verb.length).toBeGreaterThan(0);
      expect(item.action.path).toMatch(/^\/api\//);
      expect(["POST", "PUT"]).toContain(item.action.method);
    }
  });
});

describe("the action is the real endpoint, with the real id", () => {
  test("reimbursement → the approve route for THAT reimbursement", async () => {
    const item = await only("reimbursement", { reimbursements: [REIMBURSEMENT] });
    expect(item.action).toEqual({ method: "POST", path: "/api/reimbursements/reim-1/approve" });
  });

  test("time change → respond with accept, on the proposal's own session", async () => {
    const item = await only("timeChange", { changes: [CHANGE] });
    expect(item.action).toEqual({
      method: "PUT",
      path: "/api/sessions/sess-4/time-change/tcp-1/respond",
      body: { action: "accept" },
    });
  });

  test("a caregiver's offered time → accept that proposal, not the session", async () => {
    const item = await only("timeOffer", { offers: [OFFER] });
    expect(item.action).toEqual({ method: "PUT", path: "/api/sessions/sess-9/proposals/tp-1/accept" });
  });

  test("care task → check it off, and it is the one kind with a real undo", async () => {
    const item = await only("careTask", { tasks: [TASK] });
    expect(item.action).toEqual({ method: "POST", path: "/api/care-tasks/occurrences/occ-1/check" });
    expect(item.undo).toEqual({ method: "POST", path: "/api/care-tasks/occurrences/occ-1/undo" });
    expect(item.undoable).toBe(true);
  });

  test("every action path names a route that exists", () => {
    // The class of bug this guards is the one the app has shipped twice: a client-built URL
    // that looks right and 404s. Each path is checked against the router that serves it.
    const routes = {
      "src/routes/reimbursements.js": ['router.post("/:id/approve"'],
      "src/routes/sessions.js": [
        'router.put("/:id/time-change/:proposalId/respond"',
        'router.put("/:id/proposals/:proposalId/accept"',
      ],
      "src/routes/careTasks.js": [
        'router.post("/occurrences/:id/check"',
        'router.post("/occurrences/:id/undo"',
      ],
    };
    for (const [file, decls] of Object.entries(routes)) {
      const src = read(file);
      for (const decl of decls) expect(src).toContain(decl);
    }
  });

  test("EVERY item opens the thing, not the page it lives on", async () => {
    // v1.105.139. Pete (51d4226c): "Need you alerts shouldn't open a generic page…they should
    // open the task or event. I went to log Betty's meds… it just took me to the care team
    // page… ie I gotta scroll down and find the task."
    //
    // My own regression: .129 gave the schedule rows a `focus` and left reimbursements and
    // care tasks with only a page name — which is a dead end wearing a destination's clothes,
    // the same finding as v1.105.105 one card later. This test is the one that would have
    // caught it: it asks of EVERY kind, not of the kinds I happened to wire.
    const { items } = await attentionItemsFor(
      fakeDb({ reimbursements: [REIMBURSEMENT], offers: [OFFER], changes: [CHANGE], tasks: [TASK] }),
      "pete"
    );
    expect(items).toHaveLength(4);
    for (const item of items) {
      expect(typeof item.focus).toBe("string");
      expect(item.focus).toMatch(/^(session|reimbursement|careTask):.+/);
    }
  });

  test("a care task opens its check sheet on the dashboard", async () => {
    const item = await only("careTask", { tasks: [TASK] });
    expect(item.focus).toBe("careTask:occ-1");
    expect(item.page).toBe("dashboard"); // where today's tasks and the sheet actually are
  });

  test("a reimbursement opens the row that was already waiting for it", async () => {
    // Reimbursements.js has consumed this focus since v1.97.0 — scroll, flash, open approve.
    const item = await only("reimbursement", { reimbursements: [REIMBURSEMENT] });
    expect(item.focus).toBe("reimbursement:reim-1");
    expect(read("public/js/components/Reimbursements.js")).toMatch(/startsWith\('reimbursement:'\)/);
  });

  test("and the dashboard knows how to open a care task", () => {
    const dash = read("public/js/components/Dashboard.js");
    expect(dash).toMatch(/f\.startsWith\('careTask:'\)/);
    expect(dash).toMatch(/setTaskSheet\(\{ occ, group: g \}\);/);
    // A focus can arrive before today's tasks do — a push tap, or a cold dashboard load.
    expect(dash).toMatch(/if \(window\.__pendingFocus\) window\.dispatchEvent\(new Event\('inplace:focus'\)\);/);
  });

  test("the visit-opening rows still know which visit", async () => {
    const { items } = await attentionItemsFor(fakeDb({ offers: [OFFER], changes: [CHANGE] }), "pete");
    expect(items.map((i) => i.focus).sort()).toEqual(["session:sess-4", "session:sess-9"]);
  });
});

describe("the count is the list, not a second opinion of it", () => {
  test("total is exactly the number of items", async () => {
    const payload = await attentionItemsFor(
      fakeDb({ reimbursements: [REIMBURSEMENT], offers: [OFFER], changes: [CHANGE], tasks: [TASK], messages: 7 }),
      "pete"
    );
    expect(payload.total).toBe(payload.items.length);
    expect(payload.total).toBe(4);
  });

  test("unread messages are reported and still not counted", async () => {
    const payload = await attentionItemsFor(fakeDb({ messages: 7 }), "pete");
    expect(payload.messages).toBe(7);
    expect(payload.total).toBe(0);
    expect(payload.items).toEqual([]);
  });

  test("a query that throws costs its own rows and nothing else", async () => {
    const half = {
      prepare(sql) {
        const norm = sql.replace(/\s+/g, " ");
        return {
          async get() { return { count: 0 }; },
          async all() {
            if (norm.includes("FROM reimbursements")) throw new Error("db down");
            if (norm.includes("FROM care_task_occurrences")) return [TASK];
            return [];
          },
        };
      },
    };
    const payload = await attentionItemsFor(half, "pete");
    expect(payload.reimbursements).toBe(0);
    expect(payload.careTasks).toBe(1);
    expect(payload.total).toBe(1);
  });
});

// ─── the card, rendered ───

const cardSrc = read("public", "js", "components", "AttentionCard.js");
const compiled = babel.transformSync(cardSrc, {
  presets: [["@babel/preset-react"]],
  configFile: false,
}).code;

function build(seeds) {
  const win = {};
  let i = 0;
  const shim = {
    ...React,
    useState: (init) => {
      const v = i < seeds.length ? seeds[i] : init;
      i += 1;
      return [v, () => {}];
    },
    useEffect: () => {}, // effects don't run in static rendering
  };
  const doc = { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: "visible" };
  const TimezoneHelper = { DEFAULT_TZ: "America/New_York", getDateLabel: (d) => `on ${d}` };
  const fn = new Function(
    "window", "document", "React", "apiFetch", "TimezoneHelper",
    compiled + "\nreturn window.AttentionCard;"
  );
  return fn(win, doc, shim, async () => ({ ok: true, json: async () => ({}) }), TimezoneHelper);
}

// seeds are useState calls in declaration order: payload, loadFailed, held, failed
const draw = (payload, { held = {}, failed = {} } = {}) => {
  const C = build([payload, false, held, failed]);
  const out = renderToStaticMarkup(React.createElement(C, { onNavigate: () => {} }));
  return { html: out, text: out.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() };
};

const payloadOf = async (seed) => attentionItemsFor(fakeDb(seed), "pete");

describe("the card draws the thing, not the count of the thing", () => {
  test("a reimbursement draws its amount, its payee and its button", async () => {
    const { text } = draw(await payloadOf({ reimbursements: [REIMBURSEMENT] }));
    expect(text).toContain("Approve $24.60 to Edwina Hall");
    expect(text).toContain("Groceries");
    expect(text).toContain("for Betty");
    expect(text).toMatch(/MONEY/);
  });

  test("the old shape — a bare category count — is gone", async () => {
    const { text } = draw(await payloadOf({ reimbursements: [REIMBURSEMENT] }));
    expect(text).not.toMatch(/reimbursements? waiting for your approval/);
  });

  test("a time change draws both times so you can answer without opening it", async () => {
    const { text } = draw(await payloadOf({ changes: [CHANGE] }));
    expect(text).toContain("Julia Huth asked to move a visit");
    expect(text).toContain("9:00 AM → 11:00 AM");
    expect(text).toContain("Within 24 hours");
  });

  test("every item offers exactly one primary action and one way in", async () => {
    const { html } = draw(await payloadOf({ reimbursements: [REIMBURSEMENT], tasks: [TASK] }));
    const buttons = html.match(/<button/g) || [];
    expect(buttons).toHaveLength(4); // two items × (act + open)
    expect(html).toContain("Approve<");
    expect(html).toContain("Mark done<");
  });

  test("nothing waiting draws nothing at all", async () => {
    const { html } = draw(await payloadOf({}));
    expect(html).toBe("");
  });

  test("a load that failed says so — it never draws as caught up", () => {
    const C = build([null, true, {}, {}]);
    const out = renderToStaticMarkup(React.createElement(C, { onNavigate: () => {} }))
      .replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
    expect(out).toContain("Couldn't load what needs you.");
    expect(out).toContain("Retry");
  });

  test("a held action shows what was done and how to take it back", async () => {
    const payload = await payloadOf({ reimbursements: [REIMBURSEMENT] });
    const item = payload.items[0];
    const { text } = draw(payload, { held: { [item.id]: { item, verbPast: "Approved." } } });
    expect(text).toContain("Approved.");
    expect(text).toContain("Undo");
    // ...and the row it replaced is not also on screen
    expect(text).not.toContain("Approve $24.60");
  });

  test("a failed action puts the row back, with the reason", async () => {
    const payload = await payloadOf({ reimbursements: [REIMBURSEMENT] });
    const item = payload.items[0];
    const { text } = draw(payload, { failed: { [item.id]: "Cannot approve a declined request" } });
    expect(text).toContain("Approve $24.60 to Edwina Hall");
    expect(text).toContain("Cannot approve a declined request");
  });

  test("the tap targets clear 44px", () => {
    // v1.105.101: a 10x18px dismiss button was why "does not go away at all" was literally
    // true. Every button on this card is a decision; none of them may be that button.
    const hits = cardSrc.match(/<button/g) || [];
    const minHeights = cardSrc.match(/minHeight: 44/g) || [];
    expect(hits.length).toBeGreaterThan(0);
    expect(minHeights.length).toBe(hits.length); // every one of them, including Retry
  });
});

describe("one tap is safe because nothing goes out for five seconds", () => {
  test("the action is held, not sent", () => {
    expect(cardSrc).toMatch(/const timer = setTimeout\(\(\) => send\(item\), ATTENTION_HOLD_MS\);/);
    expect(cardSrc).toMatch(/const ATTENTION_HOLD_MS = 5000;/);
  });

  test("undo cancels the send rather than reversing it", () => {
    expect(cardSrc).toMatch(/if \(entry\) clearTimeout\(entry\.timer\);/);
  });

  test("closing the app flushes what is still held, with keepalive", () => {
    // Without this, "tap Approve then close the app" quietly does nothing — the worst
    // outcome available, because the person watched it clear.
    expect(cardSrc).toMatch(/window\.addEventListener\('pagehide', flush\)/);
    expect(cardSrc).toMatch(/keepalive: true/);
  });

  test("a failed send is never reported as done", () => {
    expect(cardSrc).toMatch(/setFailed\(\(prev\) => \(\{ \.\.\.prev, \[item\.id\]: message \|\| "That didn't go through\. Try again\." \}\)\)/);
  });

  test("after a send the count is re-read from the server, not decremented locally", () => {
    // The server is the definition of the number (utils/attention.js). A local decrement is
    // a second opinion, and the icon would keep the first.
    expect(cardSrc).toMatch(/load\(\); \/\/ the server is the count/);
  });
});
