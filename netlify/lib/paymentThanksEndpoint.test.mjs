import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The thank-you endpoint, against a stand-in database.
 *
 * The unit tests beside paymentSender.mjs prove the words and the
 * once-only guarantee. These prove the plumbing that decides WHO GETS
 * WRITTEN TO — which is the part a browser must not be able to choose.
 *
 * (In netlify/lib/ rather than beside the function it tests: a dotted
 * file name in the functions directory is an illegal function name and
 * fails the whole deploy. See portalEndpoints.test.mjs.)
 */

const DB = {
  payment_bills: [],
  invoices: [],
  company_members: [],
  payment_tracker_settings: [],
};

function makeClient() {
  const from = (table) => {
    const filters = [];
    const q = {
      select() { return q; },
      eq(col, val) { filters.push([col, val]); return q; },
      limit() { return q; },
      _rows() { return (DB[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v)); },
      maybeSingle() { return Promise.resolve({ data: q._rows()[0] ?? null, error: null }); },
      then(resolve) { return Promise.resolve({ data: q._rows(), error: null }).then(resolve); },
    };
    return q;
  };
  return { from };
}

let who = { user: { id: "u1" }, role: "Sales" };
const sent = [];

vi.mock("./auth.mjs", () => ({
  adminClient: () => makeClient(),
  signedInProfile: async () => who,
}));
vi.mock("./paymentSender.mjs", () => ({
  sendThanks: vi.fn(async ({ receipt }) => { sent.push(receipt); return { state: "sent" }; }),
}));

const { handler } = await import("../functions/payment-thanks-send.mjs");

const call = (body) => handler({ httpMethod: "POST", headers: {}, body: JSON.stringify(body) });
const parse = (res) => JSON.parse(res.body);

beforeEach(() => {
  sent.length = 0;
  who = { user: { id: "u1" }, role: "Sales" };
  DB.company_members = [{ company_id: "c1", user_id: "u1" }];
  DB.payment_tracker_settings = [{ company_id: "c1", data: {} }];
  DB.payment_bills = [{
    id: "b1", company_id: "c1", owner_id: "u1", invoice_no: "TZ/26-27/0142",
    customer_name: "Sharma Architects LLP", contact_name: "Rohit Sharma",
    email: "rohit@sharma.in", cc: "md@sharma.in", currency: "INR",
    amount: 245000, amount_paid: 145000,
    data: { payments: [{ id: "p1", amount: 100000, date: "2026-11-10", method: "UPI", reference: "UTR1" }] },
  }];
  DB.invoices = [{
    id: "i1", company_id: "c1", owner_id: "u1",
    data: {
      number: "TZ/INV/2026-27/0031", billName: "Acme Industries", billContact: "Rajesh",
      billEmail: "rajesh@acme.in", currency: "INR",
      paymentHistory: [
        { id: "x1", amount: 40000, date: "2026-10-01" },
        { id: "x2", amount: 60000, date: "2026-11-10", method: "NEFT", reference: "UTR2" },
      ],
    },
  }];
});

describe("who the thank-you goes to", () => {
  it("takes the address from the bill, never from the request", () => {
    /* THE WHOLE POINT OF READING THE RECORD SERVER-SIDE. A signed-in
       page that could name the recipient could send anybody anything
       from the company's own mailbox. */
    return call({
      action: "send", source: "bill", refId: "b1", paymentId: "p1",
      email: "attacker@example.com", customer_name: "Someone Else",
    }).then((res) => {
      expect(res.statusCode).toBe(200);
      expect(sent[0].email).toBe("rohit@sharma.in");
      expect(sent[0].customer_name).toBe("Sharma Architects LLP");
    });
  });

  it("takes the amount from the stored payment, never from the request", () => {
    return call({ action: "send", source: "bill", refId: "b1", paymentId: "p1", paid_now: 999999 })
      .then(() => expect(sent[0].paid_now).toBe(100000));
  });

  it("adds up what an invoice has actually received, rather than being told", () => {
    return call({ action: "send", source: "invoice", refId: "i1", paymentId: "x2", amount_paid: 1 })
      .then(() => {
        expect(sent[0].paid_now).toBe(60000);
        expect(sent[0].amount_paid).toBe(100000);
        expect(sent[0].email).toBe("rajesh@acme.in");
      });
  });

  it("accepts the invoice's own total as a display figure, and only that", () => {
    /* A tax invoice's total is computed from its lines by the app's GST
       rules, which this server does not have and must not reimplement. */
    return call({ action: "send", source: "invoice", refId: "i1", paymentId: "x2", invoiceAmount: 118000 })
      .then(() => expect(sent[0].amount).toBe(118000));
  });

  it("refuses a negative or nonsense total rather than printing it", () => {
    return call({ action: "send", source: "invoice", refId: "i1", paymentId: "x2", invoiceAmount: -5 })
      .then(() => expect(sent[0].amount).toBe(0));
  });
});

describe("who may send one", () => {
  it("refuses somebody who is not in that company", () => {
    DB.company_members = [];
    return call({ action: "send", source: "bill", refId: "b1", paymentId: "p1" }).then((res) => {
      expect(res.statusCode).toBe(403);
      expect(sent).toHaveLength(0);
    });
  });

  it("refuses when nobody is signed in", () => {
    who = null;
    return call({ action: "send", source: "bill", refId: "b1", paymentId: "p1" })
      .then((res) => expect(res.statusCode).toBe(403));
  });
});

describe("what it refuses to guess", () => {
  it("will not thank somebody for a payment that is not on the record", () => {
    return call({ action: "send", source: "bill", refId: "b1", paymentId: "nope" }).then((res) => {
      expect(res.statusCode).toBe(404);
      expect(sent).toHaveLength(0);
    });
  });

  it("says which record is missing rather than sending a blank", () => {
    return call({ action: "send", source: "bill", refId: "gone", paymentId: "p1" })
      .then((res) => expect(res.statusCode).toBe(404));
  });

  it("needs to be told which kind of record it is", () => {
    return call({ action: "send", source: "wishful", refId: "b1", paymentId: "p1" })
      .then((res) => expect(res.statusCode).toBe(400));
  });
});

describe("the company's own switch", () => {
  it("sends nothing when the company has turned acknowledgements off", () => {
    DB.payment_tracker_settings = [{ company_id: "c1", data: { thanksOn: false } }];
    return call({ action: "send", source: "bill", refId: "b1", paymentId: "p1" }).then((res) => {
      expect(parse(res).state).toBe("off");
      expect(sent).toHaveLength(0);
    });
  });

  it("sends when the setting has never been touched", () => {
    /* Absent means on: it was asked for, and a payment silently
       swallowed is the complaint it exists to answer. */
    return call({ action: "send", source: "bill", refId: "b1", paymentId: "p1" })
      .then((res) => expect(parse(res).state).toBe("sent"));
  });

  it("still previews when it is off, so somebody can see what it would say", () => {
    DB.payment_tracker_settings = [{ company_id: "c1", data: { thanksOn: false } }];
    return call({ action: "preview", source: "bill", refId: "b1", paymentId: "p1" }).then((res) => {
      const body = parse(res);
      expect(body.to).toBe("rohit@sharma.in");
      expect(body.subject).toContain("TZ/26-27/0142");
      expect(sent).toHaveLength(0);
    });
  });
});
