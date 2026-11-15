import { describe, expect, it } from "vitest";
import { automatedNotice } from "./automatedNotice.mjs";
import { withNotice } from "../functions/followups-run.mjs";

/**
 * The sender's backstop: every chaser that goes out says a machine sent
 * it, including the ones queued before the line existed — those sequences
 * are in the database now, with weeks left to run.
 */
const LINE = automatedNotice("follow-up");

describe("a chaser on its way out", () => {
  it("gets the line when the stored message has none", () => {
    /* Every sequence armed before this shipped. */
    expect(withNotice("Just checking in on TZ/Q/26-27/0047.")).toContain("sent automatically by");
  });

  it("does not say it twice when the message already carries it", () => {
    const already = `Just checking in.\n\n${LINE}`;
    expect(withNotice(already)).toBe(already);
  });

  it("puts it inside the markup, not after it, for an HTML body", () => {
    const html = "<html><body><p>Just checking in.</p></body></html>";
    const out = withNotice(html, true);
    expect(out.endsWith("</body></html>")).toBe(true);
    expect(out).toContain("sent automatically by");
    expect(out.indexOf("sent automatically by")).toBeLessThan(out.indexOf("</body>"));
  });

  /* The line itself is a fixed sentence with no markup in it, so there is
     nothing here to prove about escaping — the escape in the sender is
     belt and braces for a wording that changes later, and a test that
     cannot fail would only say otherwise. */

  it("leaves an empty body alone", () => {
    /* A WhatsApp row has no message at all; it must not become one. */
    expect(withNotice("")).toBe("");
    expect(withNotice(null)).toBe("");
  });
});
