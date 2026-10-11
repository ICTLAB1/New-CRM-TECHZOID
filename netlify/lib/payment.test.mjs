import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./mailer.mjs", () => ({ sendMail: vi.fn(async () => ({ ok: true, via: "microsoft" })) }));
vi.mock("./whatsapp.mjs", () => ({ sendWhatsAppTemplate: vi.fn(async () => ({ ok: true, id: "wa-1" })) }));

const { sendMail } = await import("./mailer.mjs");
const { sendWhatsAppTemplate } = await import("./whatsapp.mjs");
const { sendReminder, splitList } = await import("./paymentSender.mjs");
const { renderReminderEmail, whatsappFor, renderDigest, money } = await import("./paymentMessages.mjs");

const row = {
  id: "b1", company_id: "c1", owner_id: "u1", invoice_no: "TZ/26-27/0142", customer_name: "Sharma Architects LLP",
  contact_name: "Rohit Sharma", email: "rohit@sharma.in", cc: "md@sharma.in", phone: "+91 9810012345",
  invoice_date: "2026-09-01", due_date: "2026-10-01", amount: 245000, amount_paid: 45000, currency: "INR",
};

/** A tiny stand-in for the service client: one table, a unique key. */
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
        then(ok) {
          const v = pending.values;
          const key = `${v.bill_id}|${v.step}|${v.channel}`;
          if ([...log.values()].some((r) => `${r.bill_id}|${r.step}|${r.channel}` === key)) return ok({ data: [], error: null });
          log.set(v.id, { ...v });
          return ok({ data: [{ id: v.id }], error: null });
        },
      };
      return b;
    },
  };
  return api;
}

beforeEach(() => { sendMail.mockClear(); sendWhatsAppTemplate.mockClear(); });

describe("sendReminder", () => {
  it("sends once, and a second attempt for the same step sends nothing", async () => {
    const admin = fakeAdmin();
    const args = { admin, row, step: "d+3", tone: "overdue", channel: "email", today: "2026-10-04", settings: { ccEmails: "abhinav@x.com" } };
    expect((await sendReminder(args)).state).toBe("sent");
    expect((await sendReminder(args)).state).toBe("already");
    expect(sendMail).toHaveBeenCalledTimes(1);
    const call = sendMail.mock.calls[0][0];
    expect(call.to).toBe("rohit@sharma.in");
    expect(call.cc).toEqual(["abhinav@x.com", "md@sharma.in"]);
    expect([...admin.log.values()][0].state).toBe("sent");
  });

  it("WhatsApp and email for the same step are separate", async () => {
    const admin = fakeAdmin();
    const base = { admin, row, step: "d0", tone: "due", today: "2026-10-01", settings: {} };
    expect((await sendReminder({ ...base, channel: "email" })).state).toBe("sent");
    expect((await sendReminder({ ...base, channel: "whatsapp" })).state).toBe("sent");
    const wa = sendWhatsAppTemplate.mock.calls[0][0];
    expect(wa.to).toBe("+91 9810012345");
    expect(wa.templateName).toBe("payment_due_reminder");
    expect(wa.bodyValues).toEqual(["Rohit Sharma", "TZ/26-27/0142", "₹2,00,000.00", "01 Oct 2026"]);
  });

  it("records a failure and does not throw", async () => {
    sendMail.mockResolvedValueOnce({ ok: false, error: "Mailbox expired" });
    const admin = fakeAdmin();
    const r = await sendReminder({ admin, row, step: "d+7", tone: "overdue", channel: "email", today: "2026-10-08", settings: {} });
    expect(r).toEqual({ state: "failed", error: "Mailbox expired" });
    expect([...admin.log.values()][0].state).toBe("failed");
  });

  it("refuses without an address", async () => {
    const r = await sendReminder({ admin: fakeAdmin(), row: { ...row, email: "" }, step: "d0", tone: "due", channel: "email", today: "2026-10-01", settings: {} });
    expect(r.state).toBe("failed");
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe("messages", () => {
  it("email carries the balance, not the invoice total, and the bank details", () => {
    const m = renderReminderEmail(row, "overdue", "2026-10-11", {});
    expect(m.subject).toContain("10 days");
    expect(m.text).toContain("₹2,00,000.00");
    expect(m.text).toContain("Received so far: ₹45,000.00");
    expect(m.text).toContain("HDFC0000331");
    expect(m.html).toContain("Rohit Sharma");
  });
  it("escapes customer text in the HTML", () => {
    const m = renderReminderEmail({ ...row, contact_name: "<script>x</script>" }, "due", "2026-10-01", {});
    expect(m.html).not.toContain("<script>x");
  });
  it("gets firmer with age", () => {
    expect(renderReminderEmail(row, "upcoming", "2026-09-24").subject).toMatch(/^Payment reminder/);
    expect(renderReminderEmail(row, "final", "2026-11-05").subject).toMatch(/^Urgent/);
  });
  it("custom template names win", () => {
    expect(whatsappFor(row, "final", { waTemplates: { final: "tz_final" } }).templateName).toBe("tz_final");
  });
  it("digest groups by urgency", () => {
    const d = renderDigest([row, { ...row, id: "b2", due_date: "2026-10-11" }, { ...row, id: "b3", due_date: "2026-10-15" }], "2026-10-11");
    expect(d.count).toBe(3);
    expect(d.subject).toContain("1 overdue");
    expect(d.subject).toContain("1 due today");
  });
  it("formats money per currency", () => {
    expect(money(1180000, "INR")).toBe("₹11,80,000.00");
    expect(money(1500, "USD")).toBe("$1,500.00");
  });
  it("splitList keeps only addresses", () => {
    expect(splitList("a@x.com, b@y.com;  junk ")).toEqual(["a@x.com", "b@y.com"]);
  });
});
