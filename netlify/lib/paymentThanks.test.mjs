import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./mailer.mjs", () => ({ sendMail: vi.fn(async () => ({ ok: true, via: "microsoft", id: "m-1" })) }));
vi.mock("./whatsapp.mjs", () => ({ sendWhatsAppTemplate: vi.fn(async () => ({ ok: true, id: "wa-1" })) }));

const { sendMail } = await import("./mailer.mjs");
const { sendThanks } = await import("./paymentSender.mjs");
const { renderThanksEmail } = await import("./paymentMessages.mjs");

const receipt = {
  source: "bill", ref_id: "b1", payment_id: "p1", company_id: "c1", owner_id: "u1",
  invoice_no: "TZ/26-27/0142", customer_name: "Sharma Architects LLP", contact_name: "Rohit Sharma",
  email: "rohit@sharma.in", cc: "md@sharma.in", currency: "INR",
  amount: 245000, amount_paid: 145000, paid_now: 100000,
  paid_on: "2026-11-10", method: "Bank Transfer / NEFT / RTGS", reference: "UTR8891234",
};

/** A stand-in for the service client: one table, the unique key enforced. */
function fakeAdmin() {
  const log = new Map();
  const api = {
    log,
    from() {
      let pending = null;
      const b = {
        upsert(values) { pending = { kind: "upsert", values }; return b; },
        update(values) { pending = { kind: "update", values }; return b; },
        select() { return b; },
        eq(_c, id) {
          if (pending?.kind === "update") Object.assign(log.get(id) ?? {}, pending.values);
          return Promise.resolve({ data: null, error: null });
        },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
        then(ok) {
          const v = pending.values;
          const key = `${v.source}|${v.ref_id}|${v.payment_id}`;
          if ([...log.values()].some((r) => `${r.source}|${r.ref_id}|${r.payment_id}` === key)) {
            return ok({ data: [], error: null });
          }
          log.set(v.id, { ...v });
          return ok({ data: [{ id: v.id }], error: null });
        },
      };
      return b;
    },
  };
  return api;
}

describe("the words of a thank-you", () => {
  it("leads with the thanks and names the payment", () => {
    const mail = renderThanksEmail(receipt, {});
    expect(mail.subject).toBe("Payment received — Invoice TZ/26-27/0142");
    expect(mail.text).toContain("Dear Rohit Sharma,");
    expect(mail.text).toContain("Thank you. We have received your payment of ₹1,00,000.00");
  });

  it("shows the reference back, which is the question behind the question", () => {
    /* "Did you get my payment" almost always means "did you match it to
       the right invoice". The UTR answers that without a reply. */
    expect(renderThanksEmail(receipt, {}).text).toContain("UTR8891234");
  });

  it("says the balance when there is one, and says settled when there is not", () => {
    expect(renderThanksEmail(receipt, {}).text).toContain("A balance of ₹1,00,000.00 remains outstanding");
    const full = renderThanksEmail({ ...receipt, amount_paid: 245000 }, {});
    expect(full.subject).toBe("Payment received with thanks — Invoice TZ/26-27/0142");
    expect(full.text).toContain("which is now settled in full");
    expect(full.settled).toBe(true);
  });

  it("calls a payment short by less than a paisa settled, and one short by a paisa not", () => {
    /* A float that lands 0.004 short must not print "Balance ₹0.00" and
       call the invoice open. A real paisa short is a real balance. */
    expect(renderThanksEmail({ ...receipt, amount_paid: 244999.996 }, {}).settled).toBe(true);
    expect(renderThanksEmail({ ...receipt, amount_paid: 244999.99 }, {}).settled).toBe(false);
  });

  it("CARRIES NO BANK DETAILS, unlike a reminder", () => {
    /* A message about money already received that repeats where to send
       money is the shape of every payment-redirection fraud, and a
       customer who has just paid should not have to wonder. */
    const mail = renderThanksEmail(receipt, {
      bank: { bankName: "HDFC Bank", accountName: "TechZoid", accountNumber: "50200058982457", ifsc: "HDFC0000331" },
    });
    for (const secret of ["50200058982457", "HDFC0000331", "IFSC", "Account no."]) {
      expect(mail.text, secret).not.toContain(secret);
      expect(mail.html, secret).not.toContain(secret);
    }
  });

  it("says what it is not, because a customer's accounts team will file it", () => {
    const mail = renderThanksEmail(receipt, {});
    expect(mail.text).toContain("not a tax invoice or a receipt voucher under GST");
    expect(mail.html).toContain("not a tax invoice or a receipt voucher under GST");
  });

  it("greets the person, then the company, then Sir/Madam", () => {
    expect(renderThanksEmail({ ...receipt, contact_name: "" }, {}).text).toContain("Dear Sharma Architects LLP,");
    expect(renderThanksEmail({ ...receipt, contact_name: "", customer_name: "" }, {}).text).toContain("Dear Sir/Madam,");
  });

  it("leaves the invoice total out when nobody could tell it one", () => {
    /* A CRM invoice's total is computed by the app's GST rules, which the
       server does not have. Without it the email still thanks them for
       what arrived — it does not invent a balance. */
    const mail = renderThanksEmail({ ...receipt, amount: 0 }, {});
    expect(mail.text).toContain("₹1,00,000.00");
    expect(mail.text).not.toContain("Balance");
    expect(mail.text).not.toContain("Invoice amount");
  });
});

describe("sending it", () => {
  beforeEach(() => { sendMail.mockClear(); });

  it("sends once, and never again for the same payment", () => {
    /* The reason this is claimed before it is sent: this is triggered by
       somebody pressing Save, so it meets double-clicks, retried saves
       and two people entering the same cheque. */
    const admin = fakeAdmin();
    return sendThanks({ admin, receipt, settings: {}, today: "2026-11-10" }).then(async (first) => {
      expect(first.state).toBe("sent");
      expect(sendMail).toHaveBeenCalledTimes(1);
      const again = await sendThanks({ admin, receipt, settings: {}, today: "2026-11-10" });
      expect(again.state).toBe("already");
      expect(sendMail).toHaveBeenCalledTimes(1);
    });
  });

  it("thanks for a second, different payment on the same bill", () => {
    const admin = fakeAdmin();
    return sendThanks({ admin, receipt, settings: {}, today: "2026-11-10" }).then(async () => {
      const second = await sendThanks({
        admin, receipt: { ...receipt, payment_id: "p2" }, settings: {}, today: "2026-11-10",
      });
      expect(second.state).toBe("sent");
      expect(sendMail).toHaveBeenCalledTimes(2);
    });
  });

  it("copies the customer's own contacts and not the company's chasing list", () => {
    /* ccEmails exists so somebody sees the chasing. Copying it on every
       acknowledgement turns an accounts inbox into a feed. */
    const admin = fakeAdmin();
    return sendThanks({
      admin, receipt, settings: { ccEmails: "accounts@techzoid.com" }, today: "2026-11-10",
    }).then(() => {
      const call = sendMail.mock.calls[0][0];
      expect(call.cc).toEqual(["md@sharma.in"]);
      expect(call.to).toBe("rohit@sharma.in");
    });
  });

  it("sends from the shared mailbox when one is set", () => {
    const admin = fakeAdmin();
    return sendThanks({
      admin, receipt, settings: { sendFromAccountId: "acc-9" }, today: "2026-11-10",
    }).then(() => {
      expect(sendMail.mock.calls[0][0].accountId).toBe("acc-9");
    });
  });

  it("says so, rather than sending nowhere, when the customer has no address", () => {
    const admin = fakeAdmin();
    return sendThanks({
      admin, receipt: { ...receipt, email: "  " }, settings: {}, today: "2026-11-10",
    }).then((r) => {
      expect(r.state).toBe("failed");
      expect(r.error).toContain("No email address");
      expect(sendMail).not.toHaveBeenCalled();
      /* And it did not claim the payment, so fixing the address and
         saving again still sends one. */
      expect(admin.log.size).toBe(0);
    });
  });

  it("records a failure on the row it claimed, and does not retry in the same breath", () => {
    const admin = fakeAdmin();
    sendMail.mockResolvedValueOnce({ ok: false, error: "The mailbox has lost its consent." });
    return sendThanks({ admin, receipt, settings: {}, today: "2026-11-10" }).then((r) => {
      expect(r.state).toBe("failed");
      expect(r.error).toContain("consent");
      expect([...admin.log.values()][0].state).toBe("failed");
    });
  });
});
