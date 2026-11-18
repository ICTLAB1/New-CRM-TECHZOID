import { describe, expect, it } from "vitest";
import { DEFAULT_DAILY_CAP, MAX_DAILY_CAP, dailyCapFrom, overCapNotice } from "./sendLimit";
/* The server's own copy. Imported so the two cannot drift: the screen
   telling somebody the limit is 40 while the server stops them at 20 is
   worse than the screen saying nothing at all. */
// @ts-expect-error -- untyped .mjs, shapes asserted below
import * as server from "../../../netlify/lib/profileSendLimit.mjs";

const SERVER = server as {
  DEFAULT_DAILY_CAP: number;
  MAX_DAILY_CAP: number;
  dailyCapFrom: (settings: unknown) => number;
};

describe("the screen's copy of the sending limit", () => {
  it("has the same numbers the server enforces", () => {
    expect(DEFAULT_DAILY_CAP).toBe(SERVER.DEFAULT_DAILY_CAP);
    expect(MAX_DAILY_CAP).toBe(SERVER.MAX_DAILY_CAP);
  });

  /* Not just the constants: the reading of a settings row has to agree too,
     including every way it can be wrong. A screen that reads a blank field
     as "no limit" while the server reads it as 40 sends somebody into a
     refusal they were told would not happen. */
  it("reads a settings row exactly as the server reads it", () => {
    const rows: unknown[] = [
      {},
      { profile: {} },
      { profile: { dailySendLimit: 75 } },
      { profile: { dailySendLimit: 5000 } },
      { profile: { dailySendLimit: 0 } },
      { profile: { dailySendLimit: -5 } },
      { profile: { dailySendLimit: 10.9 } },
      { profile: { dailySendLimit: "lots" } },
      { profile: { dailySendLimit: null } },
      { profileDailySendLimit: 12 },
    ];
    for (const row of rows) {
      expect(dailyCapFrom(row as Record<string, unknown>), JSON.stringify(row))
        .toBe(SERVER.dailyCapFrom(row));
    }
  });

  it("falls back to the safe default when there is no settings row at all", () => {
    expect(dailyCapFrom(undefined)).toBe(DEFAULT_DAILY_CAP);
  });
});

describe("warning somebody before they press Send", () => {
  it("says nothing when the list fits inside a day", () => {
    expect(overCapNotice(40, 40)).toBe("");
    expect(overCapNotice(1, 40)).toBe("");
  });

  /* It must not read as a refusal: the send does happen, and what is held
     back comes back named. Somebody who thinks they are blocked re-picks
     their whole list tomorrow and sends the first forty twice. */
  it("explains what will happen, not that it is forbidden", () => {
    const said = overCapNotice(120, 40);
    expect(said).toContain("120");
    expect(said).toContain("40");
    expect(said).toMatch(/held/);
    expect(said).toMatch(/tomorrow/);
    expect(said).not.toMatch(/cannot|forbidden|not allowed/i);
  });

  it("says why the limit exists, since that is what makes it tolerable", () => {
    expect(overCapNotice(120, 40)).toMatch(/domain/i);
  });
});
