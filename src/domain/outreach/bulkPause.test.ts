import { describe, expect, it } from "vitest";
import { BULK_EMAIL_PAUSED, BULK_PAUSE_NOTICE } from "./bulkPause";
// @ts-expect-error -- untyped .mjs
import { PAUSED } from "../../../netlify/lib/bulkEmailPause.mjs";

describe("the screens' copy of the pause", () => {
  /* A screen that says sending is paused while the server sends anyway —
     or the reverse — is worse than either being wrong on its own. */
  it("agrees with the server about whether sending is paused", () => {
    expect(BULK_EMAIL_PAUSED).toBe(PAUSED);
  });

  it("tells somebody what still works and that nothing was lost", () => {
    expect(BULK_PAUSE_NOTICE).toMatch(/Nothing has been lost/i);
    expect(BULK_PAUSE_NOTICE).toMatch(/one quotation to one customer still works/i);
  });
});
