import { describe, expect, it } from "vitest";
import { CALLABLE, SERVER_CALLABLE, compileRpc } from "./rpc.mjs";

describe("my_profile, which a guest's sign-in depends on", () => {
  it("is callable from a browser", () => {
    /* It must be: it is how the browser learns which CRM user it is. */
    expect(() => compileRpc("my_profile", {})).not.toThrow();
  });

  it("takes no arguments, so the caller cannot ask about anybody else", () => {
    /* The whole point is that the answer comes from auth.uid(). A parameter
       would let the browser name a different user, and the function would
       then have to be trusted not to honour it. */
    expect(() => compileRpc("my_profile", { p_user: "11111111-1111-1111-1111-111111111111" }))
      .toThrow();
  });

  it("is on the browser list, not only the server one", () => {
    expect(CALLABLE).toHaveProperty("my_profile");
    expect(Object.keys(SERVER_CALLABLE)).not.toContain("my_profile");
  });
});

describe("the whitelist still refuses everything else", () => {
  it("will not call a function that is not on it", () => {
    expect(() => compileRpc("drop_everything", {})).toThrow();
  });

  it("defaults to the BROWSER list, so forgetting the argument narrows access", () => {
    /* compileRpc's third parameter defaults to CALLABLE. A server-only
       function must not slip through a call site that forgot to pass the
       wider list. */
    const args = { p_key: "k", p_limit: 5, p_window_seconds: 60 };
    /* Refused on the browser list because the NAME is not on it -- a
       different refusal from "wrong arguments", which is what proves the
       default is the narrower list rather than a coincidence. */
    expect(() => compileRpc("consume_rate_limit", args)).toThrow(/not callable|unknown|refus/i);
    expect(() => compileRpc("consume_rate_limit", args, SERVER_CALLABLE)).not.toThrow();
  });
});
