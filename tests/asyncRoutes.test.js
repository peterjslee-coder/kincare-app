// v1.105.37 — a rejected async handler must answer, not hang.
//
// Express 4 does not catch a rejected promise from `async (req, res) => {}`. It does not
// 500, it does not log, it does not reach the error handler — the request hangs and the
// client spins until its own timeout. Nothing shows up in Sentry either, so the failure is
// invisible from both ends. The Aug 4 audit counted 87 handlers with an await outside a
// try/catch, worst on photos.js (all five) and messages.js (eight) — the two most-used
// screens.
//
// These tests run against a REAL express app with the real net installed. A source-matching
// test could not tell you whether the request actually gets a response, which is the only
// thing anyone cares about here.

const express = require("express");
const request = require("supertest");
const { installAsyncRouteSafety, wrapHandler, isMountable } = require("../src/utils/asyncRoutes");

installAsyncRouteSafety(express);

function appWithErrorHandler(build) {
  const app = express();
  build(app);
  // Mirrors the real one at the bottom of src/server.js.
  app.use((err, req, res, next) => res.status(500).json({ error: "Internal server error" }));
  return app;
}

describe("a rejected async handler answers 500 instead of hanging", () => {
  test("router-level: an await that rejects reaches the error handler", async () => {
    const app = appWithErrorHandler((a) => {
      const r = express.Router();
      r.get("/boom", async (req, res) => {
        await Promise.reject(new Error("db went away"));
        res.json({ never: true });
      });
      a.use("/api", r);
    });
    const res = await request(app).get("/api/boom");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
  });

  test("app-level handlers are covered too", async () => {
    const app = appWithErrorHandler((a) => {
      a.get("/boom", async () => { throw new Error("nope"); });
    });
    expect((await request(app).get("/boom")).status).toBe(500);
  });

  test("a synchronous throw from an async handler is caught as well", async () => {
    // Throwing before the first await rejects the returned promise rather than throwing
    // into Express's own try/catch, so it needs the same treatment.
    const app = appWithErrorHandler((a) => {
      a.get("/sync-boom", async () => { throw new Error("immediate"); });
    });
    expect((await request(app).get("/sync-boom")).status).toBe(500);
  });

  test("middleware added with .use is covered", async () => {
    const app = appWithErrorHandler((a) => {
      a.use(async () => { throw new Error("middleware failed"); });
      a.get("/anything", (req, res) => res.json({ ok: true }));
    });
    expect((await request(app).get("/anything")).status).toBe(500);
  });
});

describe("it does not break what already worked", () => {
  test("a normal handler still responds normally", async () => {
    const app = appWithErrorHandler((a) => a.get("/fine", (req, res) => res.json({ ok: true })));
    const res = await request(app).get("/fine");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test("a handler's own try/catch still wins — this is a floor, not a replacement", async () => {
    const app = appWithErrorHandler((a) => {
      a.get("/handled", async (req, res) => {
        try { await Promise.reject(new Error("x")); }
        catch { return res.status(400).json({ error: "a message the handler chose" }); }
      });
    });
    const res = await request(app).get("/handled");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("a message the handler chose");
  });

  test("next('route') still skips to the next matching route", async () => {
    const app = appWithErrorHandler((a) => {
      a.get("/skip", (req, res, next) => next("route"));
      a.get("/skip", (req, res) => res.json({ second: true }));
    });
    expect((await request(app).get("/skip")).body).toEqual({ second: true });
  });

  test("mounted sub-routers still mount", async () => {
    const app = appWithErrorHandler((a) => {
      const child = express.Router();
      child.get("/deep", (req, res) => res.json({ deep: true }));
      a.use("/parent", child);
    });
    expect((await request(app).get("/parent/deep")).body).toEqual({ deep: true });
  });

  test("params and middleware chains are unaffected", async () => {
    const app = appWithErrorHandler((a) => {
      a.get("/u/:id",
        (req, res, next) => { req.tag = "mw"; next(); },
        async (req, res) => res.json({ id: req.params.id, tag: req.tag }));
    });
    expect((await request(app).get("/u/42")).body).toEqual({ id: "42", tag: "mw" });
  });

  test("a handler that already responded and THEN rejects does not double-send", async () => {
    // Otherwise "Cannot set headers after they are sent" buries the real error under a
    // second, more confusing one.
    const app = appWithErrorHandler((a) => {
      a.get("/late", async (req, res) => {
        res.json({ ok: true });
        await Promise.reject(new Error("after the fact"));
      });
    });
    const res = await request(app).get("/late");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe("the wrapper's exclusions", () => {
  test("4-argument error handlers are left alone — Express reads arity", () => {
    const errorHandler = (err, req, res, next) => next(err);
    expect(wrapHandler(errorHandler)).toBe(errorHandler);
    // Wrapping one would silently demote it to ordinary middleware and it would stop
    // receiving errors at all.
  });

  test("routers and apps are left alone — mounting needs their properties", () => {
    const r = express.Router();
    expect(isMountable(r)).toBe(true);
    expect(wrapHandler(r)).toBe(r);
  });

  test("non-functions pass through untouched", () => {
    expect(wrapHandler("/some/path")).toBe("/some/path");
    expect(wrapHandler(undefined)).toBe(undefined);
  });

  test("wrapping is idempotent, so installing twice is harmless", () => {
    const fn = (req, res) => res.end();
    const once = wrapHandler(fn);
    expect(wrapHandler(once)).toBe(once);
  });
});

describe("the real server installs it before loading any routes", () => {
  const { code } = require("./helpers/source");
  const server = code("src/server.js");

  test("install runs above the first route require", () => {
    // Route files call router.get(...) at REQUIRE time. Anything required before the patch
    // keeps unwrapped handlers, and the failure is silent — the tell would be a hung
    // request months later, which is exactly what we are trying to stop.
    const install = server.indexOf("installAsyncRouteSafety(express)");
    const firstRouteRequire = server.indexOf('require("./routes/');
    expect(install).toBeGreaterThan(-1);
    expect(firstRouteRequire).toBeGreaterThan(-1);
    expect(install).toBeLessThan(firstRouteRequire);
  });

  test("the error handler it relies on is still there", () => {
    expect(server).toMatch(/app\.use\(\(err, req, res, next\) => \{/);
    expect(server).toMatch(/res\.status\(500\)\.json\(\{ error: "Internal server error" \}\)/);
  });
});
