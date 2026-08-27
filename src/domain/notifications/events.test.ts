import { describe, expect, it } from "vitest";
import { detectEvents, summarize, type CrmEvent } from "./events";
import type { Customer } from "../customers/customer";
import type { SalesDocument } from "../documents/create";

const ME = "u-me";
const c = (o: Partial<Customer>): Customer => ({ id: "c1", ownerId: "u-other", company: "Acme Pvt Ltd", ...o } as Customer);
const q = (o: Partial<SalesDocument>): SalesDocument =>
  ({ id: "q1", number: "TZ/QT/2627/0117", billName: "Acme Pvt Ltd", status: "Draft", ...o } as SalesDocument);

const sources = (customers: Customer[] = [], quotations: SalesDocument[] = []) => ({ customers, quotations });
const at = (prev: ReturnType<typeof sources>, next: ReturnType<typeof sources>) =>
  detectEvents(prev, next, ME, 1_000);

describe("a first load", () => {
  it("is not news", () => {
    // Announcing the whole workspace on sign-in is how a notification centre
    // becomes something people close without reading.
    const events = at(sources(), sources([c({})], [q({})]));
    expect(events).toEqual([]);
  });
});

describe("customers", () => {
  const before = sources([c({ id: "existing" })], []);

  it("reports a new one", () => {
    const events = at(before, sources([c({ id: "existing" }), c({ id: "new", company: "Northline" })]));
    expect(events).toHaveLength(1);
    expect(events[0]!.text).toBe("New customer — Northline");
    // Somebody else's new customer is worth listing, not worth interrupting.
    expect(events[0]!.loud).toBe(false);
  });

  it("says so differently when it is yours", () => {
    const events = at(before, sources([c({ id: "existing" }), c({ id: "new", company: "Northline", ownerId: ME })]));
    expect(events[0]!.text).toBe("Northline was added to your customers");
    expect(events[0]!.loud).toBe(true);
  });

  it("reports being given a customer, and not somebody else's reshuffle", () => {
    const mine = at(before, sources([c({ id: "existing", ownerId: ME })]));
    expect(mine.map((e) => e.kind)).toContain("customer.assigned");

    const theirs = at(before, sources([c({ id: "existing", ownerId: "u-third" })]));
    expect(theirs.map((e) => e.kind)).not.toContain("customer.assigned");
  });

  it("reports a stage move in the CRM's own words", () => {
    const events = at(
      sources([c({ id: "x", stage: "lead" })]),
      sources([c({ id: "x", stage: "quoted" })]),
    );
    expect(events[0]!.text).toBe("Acme Pvt Ltd moved to Quotation Sent");
  });

  it("interrupts for won and lost, and not for the steps between", () => {
    const move = (to: Customer["stage"]) =>
      at(sources([c({ id: "x", stage: "lead" })]), sources([c({ id: "x", stage: to })]))[0]!;
    expect(move("won").loud).toBe(true);
    expect(move("lost").loud).toBe(true);
    expect(move("qualified").loud).toBe(false);
  });

  it("falls back to a contact name, then to something ordinary", () => {
    const events = at(
      sources([c({ id: "a" })]),
      sources([c({ id: "a" }), c({ id: "b", company: "", contact: "Rajesh Kumar" })]),
    );
    expect(events[0]!.text).toContain("Rajesh Kumar");
  });
});

describe("quotations", () => {
  const before = sources([c({})], [q({ id: "old" })]);

  it("reports a new one with its number and who it is for", () => {
    const events = at(before, sources([c({})], [q({ id: "old" }), q({ id: "new", number: "TZ/QT/2627/0118", billName: "Northline" })]));
    expect(events[0]!.text).toBe("New quotation TZ/QT/2627/0118 for Northline");
  });

  it("reports a status change using the CRM's own vocabulary", () => {
    const events = at(before, sources([c({})], [q({ id: "old", status: "Sent" })]));
    expect(events[0]!.text).toContain("is now Sent");
  });

  it("says nothing when a quotation changed but its status did not", () => {
    // "Something changed" is not worth anybody's attention.
    const events = at(before, sources([c({})], [q({ id: "old", billName: "Acme Pvt Ltd", subject: "edited" } as Partial<SalesDocument>)]));
    expect(events).toEqual([]);
  });

  it("interrupts when the customer has decided", () => {
    const decided = at(before, sources([c({})], [q({ id: "old", status: "Accepted" })]))[0]!;
    expect(decided.loud).toBe(true);
    const sent = at(before, sources([c({})], [q({ id: "old", status: "Sent" })]))[0]!;
    expect(sent.loud).toBe(false);
  });
});

describe("a burst", () => {
  const many = (n: number): CrmEvent[] =>
    Array.from({ length: n }, (_, i) => ({ id: `e${i}`, kind: "customer.created" as const, text: `x${i}`, at: 1, loud: false }));

  it("is left alone when it is small", () => {
    expect(summarize(many(4))).toHaveLength(4);
  });

  it("collapses to one line when it is not", () => {
    // An import or a reassignment cascade changes fifty rows at once. Fifty
    // toasts is a wall; fifty bell entries is a list nobody scrolls.
    const rolled = summarize(many(50));
    expect(rolled).toHaveLength(1);
    expect(rolled[0]!.text).toBe("50 records changed just now");
    expect(rolled[0]!.loud).toBe(false);
  });
});

describe("ids", () => {
  it("are stable for the same change, so a re-render cannot duplicate a row", () => {
    const run = () => at(sources([c({ id: "x", stage: "lead" })]), sources([c({ id: "x", stage: "won" })]));
    expect(run()[0]!.id).toBe(run()[0]!.id);
  });
});
