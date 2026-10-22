import { describe, expect, it } from "vitest";
import { buildCustomerProfile } from "./profile";
import type { Customer } from "./customer";

const customer = (o: Partial<Customer> = {}): Customer =>
  ({ id: "c1", ownerId: "u1", company: "Trident Realty", contact: "Asha Rao",
     designation: "IT Head", email: "asha@trident.in", phone: "9810000000",
     notes: [], ...o } as Customer);

describe("one customer, whole", () => {
  it("counts the person on the record as a decision-maker", () => {
    /* A customer whose contact was typed before the contacts table existed
       would otherwise show nobody — which reads as "no contacts here"
       rather than "this was filled in the old way". */
    const p = buildCustomerProfile(customer());
    expect(p.contacts).toHaveLength(1);
    expect(p.contacts[0]?.name).toBe("Asha Rao");
    expect(p.contacts[0]?.isPrimary).toBe(true);
  });

  it("puts the primary contact first and does not list anyone twice", () => {
    const p = buildCustomerProfile(customer(), {
      contacts: [
        { id: "k1", name: "Vikram Shah", email: "vikram@trident.in" },
        { id: "k2", name: "Meera Iyer", email: "meera@trident.in", isPrimary: true },
        /* The same person as the record's own contact. */
        { id: "k3", name: "Asha Rao", email: "asha@trident.in" },
      ],
    });
    expect(p.contacts[0]?.name).toBe("Meera Iyer");
    expect(p.contacts.filter((c) => c.email === "asha@trident.in")).toHaveLength(1);
  });

  it("lists what they hold and how many seats", () => {
    const p = buildCustomerProfile(customer(), {
      subscriptions: [
        { id: "s1", ownerId: "u1", customerId: "c1", product: "Microsoft 365 E3", seats: 40, expiryDate: "2027-03-31" },
        { id: "s2", ownerId: "u1", customerId: "SOMEBODY-ELSE", product: "Autodesk", seats: 2 },
      ] as never,
    });
    expect(p.licences).toHaveLength(1);
    expect(p.licences[0]?.seats).toBe(40);
  });

  it("puts the soonest expiry first, and keeps one that has already lapsed", () => {
    /* An expired term needs renewing more urgently, not less. Filtering it
       out is how a lapsed licence stops being anybody's problem. */
    const p = buildCustomerProfile(customer(), {
      subscriptions: [
        { id: "s1", ownerId: "u1", customerId: "c1", product: "Later", expiryDate: "2027-12-01" },
        { id: "s2", ownerId: "u1", customerId: "c1", product: "Lapsed", expiryDate: "2024-01-01" },
        { id: "s3", ownerId: "u1", customerId: "c1", product: "Perpetual" },
      ] as never,
    });
    expect(p.renewals.map((r) => r.product)).toEqual(["Lapsed", "Later"]);
  });

  it("totals what is outstanding, most overdue first", () => {
    const p = buildCustomerProfile(customer(), {
      bills: [
        { id: "b1", invoiceNo: "INV-1", dueOn: "2026-09-01", balance: 40, currency: "INR", daysOverdue: 5 },
        { id: "b2", invoiceNo: "INV-2", dueOn: "2026-08-01", balance: 1000, currency: "INR", daysOverdue: 40 },
        { id: "b3", invoiceNo: "INV-3", dueOn: "2026-07-01", balance: 0, currency: "INR", daysOverdue: 90 },
      ],
    });
    expect(p.outstanding.bills.map((b) => b.invoiceNo)).toEqual(["INV-2", "INV-1"]);
    expect(p.outstanding.total).toBe(1040);
  });

  it("refuses to total two currencies into one number", () => {
    /* Rupees plus dollars is a figure that is wrong in both. */
    const p = buildCustomerProfile(customer(), {
      bills: [
        { id: "b1", invoiceNo: "A", dueOn: "2026-09-01", balance: 100, currency: "INR", daysOverdue: 1 },
        { id: "b2", invoiceNo: "B", dueOn: "2026-09-01", balance: 50, currency: "USD", daysOverdue: 1 },
      ],
    });
    expect(p.outstanding.bills).toHaveLength(2);
    expect(p.outstanding.total).toBe(0);
    expect(p.outstanding.currency).toBe("");
  });

  it("shows why a deal was lost, and to whom", () => {
    const p = buildCustomerProfile(customer({
      stage: "lost",
      lostReason: "Lost to competitor",
      lostCompetitor: "A rival GeM reseller",
    } as never));
    expect(p.lost?.competitor).toBe("A rival GeM reseller");
  });

  it("has no lost section for a customer who is not lost", () => {
    expect(buildCustomerProfile(customer({ stage: "lead" } as never)).lost).toBeNull();
  });

  it("puts the most recent contact history first", () => {
    const p = buildCustomerProfile(customer(), {
      activities: [
        { id: "a1", kind: "call", at: "2026-08-01", summary: "Spoke to Asha" },
        { id: "a2", kind: "email", at: "2026-10-01", summary: "Sent renewal quote" },
      ],
    });
    expect(p.activities[0]?.summary).toBe("Sent renewal quote");
  });

  it("is every section empty, not an error, for a brand new customer", () => {
    const p = buildCustomerProfile(customer());
    expect(p.documents).toEqual([]);
    expect(p.licences).toEqual([]);
    expect(p.deals).toEqual([]);
    expect(p.outstanding.bills).toEqual([]);
    expect(p.notes).toEqual([]);
  });
});
