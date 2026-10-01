import { afterAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { createHmac } from "node:crypto";
import {
  FUNCTIONS_DIR, SCHEDULED, UNPORTED,
  bridge, functionNames, registerNetlifyFunctions, toEvent, toResponse,
} from "./netlifyBridge.mjs";
import { asService, closePool } from "../../lib/db.mjs";
import { forgetCatalog } from "../../lib/query.mjs";

const HAVE_DB = !!(process.env.PGCONNECTION_STRING || process.env.DATABASE_URL);
const d = HAVE_DB ? describe : describe.skip;

/** An Azure HttpRequest, which is Fetch-shaped. */
const request = (over = {}) => ({
  method: "POST",
  url: "http://localhost/api/submit-lead",
  headers: new Map(),
  text: async () => "{}",
  ...over,
});

describe("the functions directory", () => {
  /* api/netlify is a symlink to the repository's netlify/. A checkout that
     turned it into a text file — Windows without developer mode does this —
     would deploy an API with twenty-six routes missing and nothing to say
     so. This is that alarm. */
  it("resolves through the symlink", () => {
    expect(existsSync(FUNCTIONS_DIR)).toBe(true);
  });

  it("finds all twenty-six handlers", () => {
    const names = functionNames();
    expect(names).toHaveLength(26);
    expect(names).toContain("submit-lead");
    expect(names).toContain("portal");
    expect(names).toContain("followups-run");
  });

  it("names the three scheduled ones, and they exist", () => {
    const names = functionNames();
    for (const name of Object.keys(SCHEDULED)) expect(names).toContain(name);
  });

  /* THE ONE THAT WOULD BE EXPENSIVE. Netlify's cron has five fields;
     Azure's NCRONTAB has six, with SECONDS in front. Copying a Netlify
     schedule across unchanged turns "every five minutes" into "every five
     seconds" — which for the IndiaMART poller means a disabled API key
     within the minute, because their floor is five minutes and more than
     five calls in one gets the key suspended for a quarter of an hour. */
  it("gives every schedule six fields, not five", () => {
    for (const [name, schedule] of Object.entries(SCHEDULED)) {
      expect(schedule.trim().split(/\s+/), name).toHaveLength(6);
    }
  });

  it("keeps the intervals Netlify had", () => {
    expect(SCHEDULED["followups-run"]).toBe("0 0 4 * * *");
    expect(SCHEDULED["outreach-run"]).toBe("0 */2 * * * *");
    expect(SCHEDULED["indiamart-pull"]).toBe("0 */5 * * * *");
  });
});

describe("the translation", () => {
  it("lowercases headers, because the handlers index into them", () => {
    /* `event.headers.authorization` against a Headers instance is
       undefined — silently — and the handler decides the caller is signed
       out. That is the bug this line prevents. */
    return toEvent(request({
      headers: new Map([["Authorization", "Bearer x"], ["Content-Type", "application/json"]]),
    })).then((event) => {
      expect(event.headers.authorization).toBe("Bearer x");
      expect(event.headers["content-type"]).toBe("application/json");
    });
  });

  it("accepts headers as a plain object too", async () => {
    const event = await toEvent(request({ headers: { Authorization: "Bearer y" } }));
    expect(event.headers.authorization).toBe("Bearer y");
  });

  it("parses the query string", async () => {
    const event = await toEvent(request({ url: "http://localhost/api/portal?token=abc&v=2" }));
    expect(event.queryStringParameters).toEqual({ token: "abc", v: "2" });
  });

  it("carries the method and the body", async () => {
    const event = await toEvent(request({ method: "post", text: async () => '{"a":1}' }));
    expect(event.httpMethod).toBe("POST");
    expect(event.body).toBe('{"a":1}');
  });

  it("does not read a body on GET, which some hosts refuse", async () => {
    let read = false;
    const event = await toEvent(request({
      method: "GET", text: async () => { read = true; return ""; },
    }));
    expect(event.body).toBeNull();
    expect(read).toBe(false);
  });

  it("passes a body through without re-encoding it", () => {
    /* Several handlers answer with HTML — the portal pages, the
       unsubscribe confirmation. Re-encoding would make those a quoted
       string in the browser. */
    const res = toResponse({ statusCode: 200, headers: { "Content-Type": "text/html" }, body: "<p>hi</p>" });
    expect(res.body).toBe("<p>hi</p>");
    expect(res.status).toBe(200);
    expect(res.headers["Content-Type"]).toBe("text/html");
  });

  it("does not crash on a handler that returned nothing", () => {
    expect(toResponse(undefined).status).toBe(500);
  });
});

describe("registration", () => {
  function fakeApp() {
    const http = new Map();
    const timer = new Map();
    return {
      app: {
        http: (name, config) => http.set(name, config),
        timer: (name, config) => timer.set(name, config),
      },
      http, timer,
    };
  }

  it("registers the HTTP ones as routes and the scheduled ones as timers", () => {
    const { app, http, timer } = fakeApp();
    const names = registerNetlifyFunctions(app);

    expect(names).toHaveLength(26);
    expect([...timer.keys()].sort()).toEqual(Object.keys(SCHEDULED).sort());
    expect(http.size).toBe(26 - Object.keys(SCHEDULED).length);
    /* A scheduled one must not ALSO be an HTTP route: on Netlify these were
       endpoints anyone could hit, and a public URL that sends a campaign is
       not something to carry across by accident. */
    for (const name of Object.keys(SCHEDULED)) expect(http.has(name)).toBe(false);
  });

  it("routes each function at its own name", () => {
    const { app, http } = fakeApp();
    registerNetlifyFunctions(app);
    expect(http.get("submit-lead").route).toBe("submit-lead");
    expect(http.get("submit-lead").authLevel).toBe("anonymous");
  });

  it("answers the unported one with 501 and a reason, not 404", async () => {
    /* "Not built yet" and "no such endpoint" are different problems for
       whoever is reading the log. */
    const res = await bridge("admin-users")(request());
    expect(res.status).toBe(501);
    expect(res.jsonBody.error).toBe(UNPORTED["admin-users"]);
  });

  it("does not let one broken handler stop the others registering", () => {
    /* Imports happen on first call, not at registration. */
    const { app, http } = fakeApp();
    registerNetlifyFunctions(app);
    expect(http.size).toBeGreaterThan(20);
  });
});

/* -- THE ONE THAT MATTERS ---------------------------------------------
   An untouched handler, through the bridge, against a real database, with
   the service client underneath it instead of Supabase. If the swap in
   netlify/lib/auth.mjs is wrong, this is where it shows. */

d("a real handler, unchanged, on the Azure stack", () => {
  afterAll(async () => { await closePool(); });

  it("refuses an unauthenticated caller on a guarded endpoint", async () => {
    forgetCatalog();
    const res = await bridge("integration-status")(request({
      method: "POST", headers: new Map(), text: async () => "{}",
    }));
    /* Whatever it answers, it must not be a 500: a handler that fell over
       reaching for Supabase would show up here. */
    expect(res.status).not.toBe(500);
    expect([401, 403, 405]).toContain(res.status);
  });

  it("runs the public registration form end to end", async () => {
    forgetCatalog();
    const owner = "15151515-1515-1515-1515-151515151515";
    await asService(async (c) => {
      await c.query(`insert into auth.users (id, email, raw_user_meta_data)
        values ($1,'bridge@techzoid.in','{"name":"Bridge"}') on conflict (id) do nothing`, [owner]);
      const company = (await c.query(
        `select id from public.companies order by created_at limit 1`)).rows[0].id;
      await c.query(`insert into public.company_members (company_id, user_id, role)
        values ($1,$2,'Sales') on conflict do nothing`, [company, owner]);
      await c.query(`delete from public.customers where data->>'company' = 'Bridge Test Industries'`);
    });

    const res = await bridge("submit-lead")(request({
      url: "http://localhost/api/submit-lead",
      headers: new Map([["content-type", "application/json"]]),
      text: async () => JSON.stringify({
        refId: owner,
        company: "Bridge Test Industries",
        contact: "A Person",
        email: "someone@example.com",
        phone: "9000000000",
      }),
    }));

    /* UNCONDITIONAL. The first draft of this guarded the real assertion
       behind `if (res.status === 200)`, which meant a handler that refused
       the request passed the test silently — and it did refuse, because the
       payload named the wrong field. A test that only checks when it
       succeeds checks nothing. */
    expect(res.status).toBe(200);

    const saved = await asService(async (c) =>
      (await c.query(
        `select count(*)::int as n from public.customers where data->>'company' = 'Bridge Test Industries'`
      )).rows[0].n);
    expect(saved).toBe(1);

    await asService(async (c) => {
      await c.query(`delete from public.customers where data->>'company' = 'Bridge Test Industries'`);
    });
  });
});

describe("when the bridged handlers are not in the package", () => {
  /* The deployment that found this built its zip without `netlify/`, and
     the eager readdirSync took the WHOLE api down with it -- `/api/q`
     included, which does not go through this file at all. */
  it("registers none rather than throwing", () => {
    expect(() => functionNames("/no/such/directory")).not.toThrow();
    expect(functionNames("/no/such/directory")).toEqual([]);
  });

  it("still registers the real endpoints when the bridge finds nothing", () => {
    const http = new Map();
    const app = { http: (n, o) => http.set(n, o), timer: () => {} };
    expect(() => registerNetlifyFunctions(app, "/no/such/directory")).not.toThrow();
    expect(http.size).toBe(0);
  });
});
