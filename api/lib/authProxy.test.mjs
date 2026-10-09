import { describe, expect, it } from "vitest";
import { ProxyError, handleAuthProxy, proxyTarget } from "./authProxy.mjs";

const ENV = { SUPABASE_URL: "https://sdhprpbfazpyghjepzpt.supabase.co" };

function request(path, { method = "POST", body = "{}", headers = {}, query = "" } = {}) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    method,
    url: `https://crm.example.com/api/idp/${path}${query}`,
    headers: { get: (n) => h.get(String(n).toLowerCase()) ?? null },
    text: async () => body,
  };
}
const ok = (seen) => async (url, init) => {
  seen.url = url; seen.init = init;
  return { status: 200, headers: new Map([["content-type", "application/json"]]), text: async () => '{"access_token":"t"}' };
};

describe("reaching Supabase Auth through this API", () => {
  it("forwards a password sign-in to the configured project", async () => {
    const seen = {};
    const res = await handleAuthProxy(
      request("auth/v1/token", { query: "?grant_type=password", headers: { apikey: "anon-key" } }),
      { env: ENV, fetch: ok(seen) });

    expect(res.status).toBe(200);
    expect(seen.url).toBe("https://sdhprpbfazpyghjepzpt.supabase.co/auth/v1/token?grant_type=password");
    expect(seen.init.headers.apikey).toBe("anon-key");
    expect(res.body).toContain("access_token");
  });

  /* -- THE ONES THAT MATTER ------------------------------------------ */

  it("cannot be pointed at another host by the caller", async () => {
    /* A proxy that takes its destination from the request is an open relay:
       anyone on the internet could make this function app fetch anything,
       from inside Azure, with this app's name on the request. */
    const seen = {};
    const res = await handleAuthProxy(
      request("https://evil.example.com/steal"), { env: ENV, fetch: ok(seen) });
    expect(res.status).toBe(404);
    expect(seen.url).toBeUndefined();
  });

  it("cannot escape the auth prefix with ..", async () => {
    /* `auth/v1/../../rest/v1/customers` collapses to rest/v1/customers.
       Checking the prefix on the RAW string would let this through. */
    const seen = {};
    const res = await handleAuthProxy(
      request("auth/v1/../../rest/v1/customers"), { env: ENV, fetch: ok(seen) });
    expect(res.status).toBe(404);
    expect(seen.url).toBeUndefined();
  });

  it("will not forward the data path", async () => {
    const seen = {};
    const res = await handleAuthProxy(request("rest/v1/customers"), { env: ENV, fetch: ok(seen) });
    expect(res.status).toBe(404);
    expect(seen.url).toBeUndefined();
  });

  it("adds no credential of its own", async () => {
    /* The anon key comes from the browser, where it already lives. If this
       ever attached a key the caller did not send, it would be handing out
       whatever that key could do. */
    const seen = {};
    await handleAuthProxy(request("auth/v1/token"), { env: { ...ENV, SUPABASE_SERVICE_KEY: "sb-service-role" }, fetch: ok(seen) });
    const sent = JSON.stringify(seen.init.headers);
    expect(sent).not.toContain("sb-service-role");
    expect(seen.init.headers.apikey).toBeUndefined();
  });

  it("refuses a SUPABASE_URL that is not a Supabase project", async () => {
    expect(() => proxyTarget({ SUPABASE_URL: "https://evil.example.com" })).toThrow(ProxyError);
  });

  it("says so plainly when it is not configured", async () => {
    const res = await handleAuthProxy(request("auth/v1/token"), { env: {}, fetch: ok({}) });
    expect(res.status).toBe(503);
  });

  it("reports a provider it cannot reach as 502, not as a crash", async () => {
    const res = await handleAuthProxy(request("auth/v1/token"), {
      env: ENV, fetch: async () => { throw new Error("ENOTFOUND"); }, log: () => {} });
    expect(res.status).toBe(502);
  });

  it("passes a refusal straight back, status and body", async () => {
    /* A wrong password is the provider's answer, not an error here. The
       sign-in screen reads the body to tell "wrong password" from "no such
       account", and swallowing it would break that. */
    const res = await handleAuthProxy(request("auth/v1/token"), {
      env: ENV,
      fetch: async () => ({ status: 400, headers: new Map(), text: async () => '{"error":"invalid_grant"}' }),
    });
    expect(res.status).toBe(400);
    expect(res.body).toContain("invalid_grant");
  });
});

describe("a failure after the call has started", () => {
  it("reports a body that cannot be read as 502, not as an uncaught 500", async () => {
    /* An exception escaping the handler is a bare 500 with an empty body,
       which does not say whether the provider was even reached. */
    const res = await handleAuthProxy(
      { method: "POST", url: "https://c/api/idp/auth/v1/token",
        headers: { get: () => null }, text: async () => "{}" },
      { env: ENV, log: () => {},
        fetch: async () => ({ status: 200, headers: new Map(),
          text: async () => { throw new Error("socket hang up"); } }) });
    expect(res.status).toBe(502);
  });
});

describe("what comes back", () => {
  it("passes only content-type on, not whatever the provider sent", async () => {
    /* Handing the host the provider's full header set produced a 500 with
       an empty body: the handler ran, returned, and the response was
       refused. An allow-list cannot regress that way. */
    const res = await handleAuthProxy(
      { method: "POST", url: "https://c/api/idp/auth/v1/token",
        headers: { get: () => null }, text: async () => "{}" },
      { env: ENV, fetch: async () => ({
          status: 200,
          headers: new Map([["content-type", "application/json"], ["set-cookie", "a=b"],
                            ["transfer-encoding", "chunked"], ["x-odd", "\u0000bad"]]),
          text: async () => '{"access_token":"t"}',
        }) });
    expect(res.status).toBe(200);
    expect(Object.keys(res.headers)).toEqual(["content-type"]);
  });
});

describe("when the provider does not answer at all", () => {
  it("gives up and says so, rather than hanging until the host times out", async () => {
    /* The symptom of no deadline is a bare 500 with an empty body: the host
       kills the invocation and nothing here gets to explain. */
    const res = await handleAuthProxy(
      { method: "POST", url: "https://c/api/idp/auth/v1/token",
        headers: { get: () => null }, text: async () => "{}" },
      { env: { ...ENV, IDP_TIMEOUT_MS: "20" }, log: () => {},
        fetch: (_u, init) => new Promise((_res, rej) => {
          init.signal.addEventListener("abort", () => rej(new Error("aborted")));
        }) });
    expect(res.status).toBe(502);
  });
});
