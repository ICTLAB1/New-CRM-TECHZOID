import { describe, expect, it } from "vitest";
import { register } from "./register.mjs";

/**
 * The wiring, which is the one part of the endpoints no other test covers.
 *
 * `http.test.mjs` proves both handlers do the right thing when called. It
 * says nothing about whether `/api/q` reaches the query handler or the RPC
 * one — and that mistake does not throw anywhere. It presents on the day of
 * cutover as a CRM that cannot load, with every unit test green.
 *
 * A fake `app` stands in for the Functions host so none of this needs the
 * host or the `@azure/functions` package installed.
 */

function fakeApp() {
  const routes = new Map();
  return {
    app: { http: (name, config) => routes.set(name, config) },
    routes,
  };
}

/** A request the handlers will refuse early, so nothing touches a database:
 *  which handler refused it is what identifies the route. */
const probe = () => ({
  method: "GET",
  headers: { get: () => null },
  text: async () => "",
});

describe("the routes", () => {
  it("registers exactly the auth routes, idp, q, rpc and blob", () => {
    /* Pinned deliberately. A route appearing here that nobody meant to add
       is a new public entry point, and it should take an edit to this line
       and somebody noticing it in review. */
    const { app, routes } = fakeApp();
    register(app);
    /* The three auth/v1 routes are public ON PURPOSE -- signing in is what an
       unauthenticated caller does. `idp` was added on purpose: the office network answers NXDOMAIN for
       the identity provider, so the browser reaches it through this origin
       instead. It is a public entry point and it is meant to be -- signing
       in is what an unauthenticated caller does. What keeps it safe is in
       authProxy.mjs: one configured host, auth paths only, no credential of
       its own. */
    expect([...routes.keys()].sort()).toEqual(["authLogout", "authToken", "authUser", "blob", "idp", "q", "rpc"]);
  });

  it("accepts only POST, on the paths the browser calls", () => {
    /* `idp` is deliberately not in this list: a sign-in flow needs GET for
       the provider\'s own endpoints, so it is checked separately. */
    const { app, routes } = fakeApp();
    register(app);
    for (const name of ["q", "rpc", "blob"]) {
      expect(routes.get(name).methods).toEqual(["POST"]);
      expect(routes.get(name).route).toBe(name);
    }
  });

  /* Not an oversight — see the note in register.mjs. A function key would
     be a second shared secret whose only home is the browser bundle. The
     bearer token is the authentication. */
  it("takes no function key, because the token is the authentication", () => {
    const { app, routes } = fakeApp();
    register(app);
    expect(routes.get("q").authLevel).toBe("anonymous");
    expect(routes.get("rpc").authLevel).toBe("anonymous");
    expect(routes.get("blob").authLevel).toBe("anonymous");
  });

  it("answers on the blob route without storage configured, rather than not starting", async () => {
    /* The Azure client is resolved per request, not at registration. A
       deployment with no storage account still starts and still serves
       everything else — this endpoint says "not configured" instead. */
    const { app, routes } = fakeApp();
    register(app);
    const res = await routes.get("blob").handler({
      method: "POST",
      headers: { get: (n) => (n === "content-type" ? "application/json" : null) },
      text: async () => JSON.stringify({ op: "read", path: "p" }),
    });
    /* 401 because there is no token; the point is that it answered. */
    expect([401, 503]).toContain(res.status);
  });

  it("points each route at its own handler, not at the same one twice", async () => {
    const { app, routes } = fakeApp();
    register(app);

    /* Both refuse a GET with 405, so the status cannot tell them apart.
       What can, WITHOUT NEEDING A DATABASE: only the RPC handler checks a
       function name, and it does so before taking a connection. So "Unknown
       function." identifies the rpc route, and the q route is whatever else
       — which is the assertion, rather than a specific message, because
       what q says depends on whether a database is configured and this test
       must not. */
    const post = (body) => ({
      method: "POST",
      headers: { get: (n) => (n === "content-type" ? "application/json" : null) },
      text: async () => JSON.stringify(body),
    });

    const fromQ = await routes.get("q").handler(post({ table: "nope", op: "select" }));
    const fromRpc = await routes.get("rpc").handler(post({ fn: "nope" }));

    expect(fromRpc.jsonBody.error.message).toBe("Unknown function.");
    expect(fromQ.jsonBody.error.message).not.toBe("Unknown function.");
    expect(routes.get("q").handler).not.toBe(routes.get("rpc").handler);
  });

  it("refuses a GET on all of them, before reading anything", async () => {
    const { app, routes } = fakeApp();
    register(app);
    for (const name of ["q", "rpc", "blob"]) {
      const res = await routes.get(name).handler(probe());
      expect(res.status).toBe(405);
    }
  });
});
