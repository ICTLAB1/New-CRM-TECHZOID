import { describe, expect, it } from "vitest";
import { audienceSummary, whatsappAudience, type AudienceCustomer } from "./whatsappAudience";

const willing = (over: Partial<AudienceCustomer> = {}): AudienceCustomer => ({
  id: "c1", company: "Acme Industries", contact: "Ravi Sharma",
  phone: "9810012345", whatsappOptIn: true, ...over,
});

describe("who a broadcast may go to", () => {
  it("includes somebody who agreed and has a number", () => {
    const { recipients, excluded } = whatsappAudience([willing()]);
    expect(excluded).toEqual([]);
    expect(recipients).toEqual([{ id: "c1", label: "Ravi Sharma", number: "+91 9810012345" }]);
  });

  /* Meta's rule, not a preference: a business may not write first to
     somebody who has not opted in. The server refuses them whatever this
     says, so including them would only turn a clear exclusion before the
     send into a list of failures after it. */
  it("excludes somebody who never agreed, however reachable they are", () => {
    const { recipients, excluded } = whatsappAudience([willing({ whatsappOptIn: false })]);
    expect(recipients).toEqual([]);
    expect(excluded).toEqual([{ id: "c1", label: "Ravi Sharma", reason: "no-consent" }]);
  });

  it("treats a missing tick as a no, because an unticked box is not consent", () => {
    const { excluded } = whatsappAudience([willing({ whatsappOptIn: undefined })]);
    expect(excluded[0]!.reason).toBe("no-consent");
  });

  it("excludes somebody who agreed but has no usable number", () => {
    const { excluded } = whatsappAudience([willing({ phone: "", whatsappPhone: "" })]);
    expect(excluded).toEqual([{ id: "c1", label: "Ravi Sharma", reason: "no-number" }]);
  });

  /* THE SERVER PREFERS THE WHATSAPP FIELD, so this must too. Reading
     `phone` alone made a customer who had given a separate WhatsApp number
     and no landline look unreachable on screen while the server would have
     messaged them perfectly well. */
  it("uses the WhatsApp number when there is one, and the phone when there is not", () => {
    expect(whatsappAudience([willing({ whatsappPhone: "9820099887" })]).recipients[0]!.number)
      .toBe("+91 9820099887");
    expect(whatsappAudience([willing({ phone: "", whatsappPhone: "9820099887" })]).recipients[0]!.number)
      .toBe("+91 9820099887");
    expect(whatsappAudience([willing({ whatsappPhone: "" })]).recipients[0]!.number)
      .toBe("+91 9810012345");
  });

  /* Consent is asked about FIRST. Somebody who never agreed is not a
     missing-number problem even when their number is missing too —
     filling it in would change nothing, and they would otherwise land in
     the queue of people somebody is chasing phone numbers for. */
  it("calls somebody with neither consent nor a number a consent problem", () => {
    const { excluded } = whatsappAudience([willing({ whatsappOptIn: false, phone: "", whatsappPhone: "" })]);
    expect(excluded[0]!.reason).toBe("no-consent");
  });

  it("falls back to the company when there is no contact name", () => {
    expect(whatsappAudience([willing({ contact: "" })]).recipients[0]!.label).toBe("Acme Industries");
    expect(whatsappAudience([willing({ contact: "", company: "" })]).recipients[0]!.label).toBe("(no name)");
  });

  it("ignores a row with no id rather than sending into the dark", () => {
    expect(whatsappAudience([willing({ id: "" })]).recipients).toEqual([]);
    expect(whatsappAudience([willing({ id: "" })]).excluded).toEqual([]);
  });

  it("copes with nothing at all", () => {
    expect(whatsappAudience([])).toEqual({ recipients: [], excluded: [] });
  });
});

describe("what the sender is told about their list", () => {
  /* A sender who ticks two hundred and sees "sending to 94" with no
     explanation assumes the CRM is broken. The two reasons are counted
     apart because they are different jobs: one is data entry, the other
     is a conversation with the customer. */
  it("counts the two reasons separately", () => {
    const said = audienceSummary(whatsappAudience([
      willing({ id: "a" }),
      willing({ id: "b" }),
      willing({ id: "c", whatsappOptIn: false }),
      willing({ id: "d", phone: "", whatsappPhone: "" }),
    ]));
    expect(said).toBe("2 will be messaged, 1 has not agreed to WhatsApp, 1 has no number on file.");
  });

  it("says nothing about an exclusion that did not happen", () => {
    expect(audienceSummary(whatsappAudience([willing()]))).toBe("1 will be messaged.");
  });
});
