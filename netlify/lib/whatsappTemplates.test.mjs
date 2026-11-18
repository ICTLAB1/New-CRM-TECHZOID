import { execFileSync } from "node:child_process";
import { beforeEach, describe, expect, it } from "vitest";
import {
  approvedTemplates, forgetApprovedTemplates,
  TEMPLATES, TEMPLATE_NAMES, buildParams, checkTemplate, fillBody, metaError,
  readApprovedTemplates, waDate, waList, waMoney, waText,
} from "./whatsappTemplates.mjs";

/** For the child process below, which imports this module on its own. */
const TEMPLATES_URL = new URL("./whatsappTemplates.mjs", import.meta.url).href;

/**
 * These rules decide what a customer reads, and the failures they prevent
 * are all silent ones: a message Meta refuses for an empty blank, a line
 * break Meta will not take, or two parameters in the wrong order putting
 * somebody else's invoice number in front of the wrong company.
 */

describe("the formats the business asked for", () => {
  it("writes a date as 15 Nov 2026", () => {
    expect(waDate("2026-11-15")).toBe("15 Nov 2026");
    expect(waDate("2026-01-05")).toBe("5 Jan 2026");
  });

  it("reads a date whether it came with a time on it or not", () => {
    expect(waDate("2026-11-15T09:30:00.000Z")).toBe("15 Nov 2026");
    expect(waDate(new Date("2026-11-15T00:00:00"))).toBe("15 Nov 2026");
  });

  it("does not shift a date across a day boundary", () => {
    expect(waDate("2026-03-01")).toBe("1 Mar 2026");
    expect(waDate("2026-12-31")).toBe("31 Dec 2026");
  });

  it("STILL does not shift it on a machine that is not on UTC", () => {
    /* `new Date("2026-03-01")` is midnight UTC, which on a host behind UTC
       is the evening of 28 February — so a renewal reminder for the 1st
       goes out saying the 28th. This container runs on UTC and cannot see
       that, so the rule is pinned where it bites: in a child process with
       the clock somewhere else. Without the explicit time in waDate, this
       assertion fails with "28 Feb 2026". */
    const read = (tz) => execFileSync(
      process.execPath,
      ["--input-type=module", "-e",
        `import { waDate } from ${JSON.stringify(TEMPLATES_URL)};`
        + ` process.stdout.write(waDate("2026-03-01"));`],
      { env: { ...process.env, TZ: tz }, encoding: "utf8" },
    );

    expect(read("America/New_York")).toBe("1 Mar 2026");
    expect(read("Asia/Kolkata")).toBe("1 Mar 2026");
    expect(read("Pacific/Kiritimati")).toBe("1 Mar 2026");
  });

  it("hands back something rather than nothing for rubbish", () => {
    expect(waDate("not a date")).toBe("not a date");
    expect(waDate("")).toBe("");
  });

  it("writes money the Indian way, without a symbol or paise", () => {
    expect(waMoney(118000)).toBe("1,18,000");
    expect(waMoney(1500)).toBe("1,500");
    expect(waMoney(10000000)).toBe("1,00,00,000");
  });

  it("keeps real paise and drops imaginary ones", () => {
    expect(waMoney(1180.5)).toBe("1,180.50");
    expect(waMoney(118000.004)).toBe("1,18,000");
  });
});

describe("what Meta will not accept in a blank", () => {
  it("flattens a line break, which fails the whole message", () => {
    expect(waText("Microsoft 365 E3\nVisio Plan 2")).toBe("Microsoft 365 E3, Visio Plan 2");
    expect(waText("a\tb")).toBe("a, b");
    expect(waText("a\r\n\r\nb")).toBe("a, b");
  });

  it("collapses a run of spaces", () => {
    expect(waText("Dell     Latitude")).toBe("Dell Latitude");
  });

  it("never leaves a trailing or doubled comma behind", () => {
    expect(waText("\n\nAcme\n\n")).toBe("Acme");
    expect(waText("a,\n,b")).toBe("a, b");
  });

  it("trims a very long value rather than letting Meta refuse it", () => {
    const long = waText("x".repeat(500));
    expect(long.length).toBeLessThanOrEqual(300);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("a list of items on one line", () => {
  const items = [
    { desc: "Microsoft 365 E3", qty: 10 },
    { desc: "Visio Plan 2", qty: 2 },
    { desc: "Power BI Pro", qty: 1 },
    { desc: "Acrobat Pro", qty: 4 },
  ];

  it("names three and counts the rest", () => {
    expect(waList(items)).toBe("Microsoft 365 E3 ×10, Visio Plan 2 ×2, Power BI Pro and 1 more item");
  });

  it("says nothing about a quantity of one", () => {
    expect(waList([{ desc: "Acrobat Pro", qty: 1 }])).toBe("Acrobat Pro");
  });

  it("pluralises the remainder", () => {
    expect(waList([...items, { desc: "Windows Server", qty: 1 }])).toContain("and 2 more items");
  });

  it("takes plain strings too, and survives an empty list", () => {
    expect(waList(["Acrobat", "Visio"])).toBe("Acrobat, Visio");
    expect(waList([])).toBe("");
    expect(waList(null)).toBe("");
  });
});

describe("filling the blanks in order", () => {
  it("puts every fact in the position its template expects", () => {
    const { values } = buildParams("payment_overdue_reminder", {
      customer: "Acme Industries",
      invoiceNo: "TZ/INV/26-27/0042",
      amount: 118000,
      dueOn: "2026-11-15",
      daysOverdue: 8,
    });
    expect(values).toEqual(["Acme Industries", "TZ/INV/26-27/0042", "1,18,000", "15 Nov 2026", "8"]);
  });

  it("REPORTS an empty blank rather than inventing something to fill it", () => {
    /* "param text cannot be empty" fails the send outright — so a blank
       with nothing behind it used to be filled with a stand-in phrase, and
       a customer could read "your quotation (number to follow) is ready".
       Now the hole is named and the sender refuses to send at all. */
    for (const name of TEMPLATE_NAMES) {
      const { values, missing } = buildParams(name, {});
      expect(values).toHaveLength(TEMPLATES[name].params.length);
      expect(missing).toEqual(TEMPLATES[name].params.map((p) => p.key));
    }
  });

  it("reports only the blanks that are actually empty", () => {
    const { values, missing } = buildParams("payment_received", {
      customer: "Rahul Verma", amount: 118000,
    });
    expect(missing).toEqual(["against"]);
    expect(values[0]).toBe("Rahul Verma");
    expect(values[1]).toBe("1,18,000");
    expect(values[2]).toBe("");
  });

  it("says which facts it had to fall back on", () => {
    const { values, missing } = buildParams("quotation_sent", { customer: "Acme Industries" });
    expect(missing).toEqual(["quoteNo", "product", "validTill"]);
    expect(values[0]).toBe("Acme Industries");
  });

  it("counts a blank string as missing, not as a value", () => {
    const { missing } = buildParams("quotation_sent", { customer: "   ", quoteNo: "" });
    expect(missing).toContain("customer");
    expect(missing).toContain("quoteNo");
  });

  it("flattens a list handed to an items blank", () => {
    const { values } = buildParams("order_delivered", {
      customer: "Acme", orderNo: "SO/1", deliveredOn: "2026-11-15",
      items: [{ desc: "M365 E3", qty: 10 }, { desc: "Visio", qty: 2 }],
    });
    expect(values[2]).toBe("M365 E3 ×10, Visio ×2");
    expect(values[2]).not.toMatch(/[\r\n\t]/);
  });

  it("refuses a template nobody has heard of", () => {
    expect(buildParams("made_up", {}).error).toMatch(/no template called/i);
  });
});

describe("the templates, as a set", () => {
  it("is the set the business asked for, named exactly", () => {
    expect(TEMPLATE_NAMES).toEqual([
      "quotation_sent", "quotation_followup",
      "proforma_sent", "proforma_followup", "proforma_advance_reminder",
      "company_profile",
      "order_delivered", "licence_delivered",
      "payment_due_reminder", "payment_overdue_reminder", "payment_received", "renewal_reminder",
    ]);
  });

  it("has the parameter order the business wrote down", () => {
    const order = (n) => TEMPLATES[n].params.map((p) => p.key);
    expect(order("quotation_sent")).toEqual(["customer", "quoteNo", "product", "validTill"]);
    expect(order("quotation_followup")).toEqual(["customer", "quoteNo", "product", "sharedOn"]);
    expect(order("proforma_sent")).toEqual(["customer", "proformaNo", "amount", "validTill"]);
    expect(order("proforma_followup")).toEqual(["customer", "proformaNo", "product", "sharedOn"]);
    expect(order("proforma_advance_reminder")).toEqual(["customer", "proformaNo", "amount", "sharedOn"]);
    expect(order("company_profile")).toEqual(["customer", "senderCompany"]);
    expect(order("order_delivered")).toEqual(["customer", "orderNo", "items", "deliveredOn"]);
    expect(order("licence_delivered")).toEqual(["customer", "product", "orderNo", "sentTo"]);
    expect(order("payment_due_reminder")).toEqual(["customer", "invoiceNo", "amount", "dueOn"]);
    expect(order("payment_overdue_reminder")).toEqual(["customer", "invoiceNo", "amount", "dueOn", "daysOverdue"]);
    expect(order("payment_received")).toEqual(["customer", "amount", "against"]);
    expect(order("renewal_reminder")).toEqual(["customer", "product", "renewsOn"]);
  });

  it("gives every message that can send itself its own switch", () => {
    const keys = TEMPLATE_NAMES.map((n) => TEMPLATES[n].auto).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
    /* Every one that is not sent by hand alone has a switch to turn it off
       with. Two switches sharing a key would silently turn off a message
       nobody meant to stop, which is what the uniqueness above is for. */
    for (const name of TEMPLATE_NAMES) {
      if (TEMPLATES[name].auto) continue;
      expect(TEMPLATES[name].manual, `${name} has no switch, so it must be sendable by hand`).toBe(true);
    }
  });

  /* THE ONE THAT ONLY A PERSON CAN SEND. Asking a customer for an advance
     is a judgement about that customer, and the figure it names is only
     available where the document is drawn — so it has no switch, by
     design. If it ever grows one, this test is the place that argument has
     to be had again. */
  it("sends the advance reminder only by hand", () => {
    expect(TEMPLATES.proforma_advance_reminder.auto).toBeUndefined();
    expect(TEMPLATES.proforma_advance_reminder.manual).toBe(true);
  });

  it("carries no wording of its own", () => {
    /* The sentences belong to the approved template in Meta. A copy here
       would drift, and the preview would then show something the customer
       never receives. */
    const source = JSON.stringify(TEMPLATES);
    expect(source).not.toMatch(/Dear |Hello |Thank you|Your quotation is/i);
  });
});

describe("the preview uses Meta's own wording", () => {
  it("substitutes into the approved body", () => {
    const body = "Hi {{1}}, quotation {{2}} for {{3}} is valid till {{4}}.";
    const { values } = buildParams("quotation_sent", {
      customer: "Ravi", quoteNo: "TZ/Q/0042", product: "Microsoft 365 E3", validTill: "2026-11-22",
    });
    expect(fillBody(body, values))
      .toBe("Hi Ravi, quotation TZ/Q/0042 for Microsoft 365 E3 is valid till 22 Nov 2026.");
  });

  it("leaves a blank it has no value for visible", () => {
    expect(fillBody("A {{1}} B {{9}}", ["one"])).toBe("A one B {{9}}");
  });

  it("tolerates the spacing Meta allows inside the braces", () => {
    expect(fillBody("{{ 1 }}", ["x"])).toBe("x");
  });
});

describe("reading the approved templates from Meta", () => {
  const reply = (body, ok = true) => async () => ({
    ok,
    json: async () => body,
  });

  it("asks the WhatsApp Business account, with the token", async () => {
    let seen = null;
    await readApprovedTemplates({
      token: "T", wabaId: "W",
      fetchImpl: async (url, opts) => { seen = { url, opts }; return { ok: true, json: async () => ({ data: [] }) }; },
    });
    expect(seen.url).toContain("/v25.0/W/message_templates");
    expect(seen.opts.headers.Authorization).toBe("Bearer T");
  });

  it("reads the wording and counts the blanks it uses", async () => {
    const out = await readApprovedTemplates({
      token: "T", wabaId: "W",
      fetchImpl: reply({
        data: [{
          name: "quotation_sent", status: "APPROVED", language: "en",
          components: [{ type: "BODY", text: "Hi {{1}}, quote {{2}} for {{3}} valid till {{4}}." }],
        }],
      }),
    });
    expect(out.ok).toBe(true);
    expect(out.templates.quotation_sent.placeholders).toBe(4);
    expect(out.templates.quotation_sent.body).toContain("{{4}}");
  });

  it("comes back with a reason rather than throwing", async () => {
    const nothingSet = await readApprovedTemplates({});
    expect(nothingSet.ok).toBe(false);
    expect(nothingSet.error).toMatch(/not set on the server/i);

    const refused = await readApprovedTemplates({
      token: "T", wabaId: "W",
      fetchImpl: reply({ error: { message: "Invalid OAuth access token" } }, false),
    });
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain("Invalid OAuth access token");

    const broken = await readApprovedTemplates({
      token: "T", wabaId: "W",
      fetchImpl: async () => { throw new Error("socket hang up"); },
    });
    expect(broken.ok).toBe(false);
    expect(broken.error).toContain("socket hang up");
  });
});

describe("telling somebody a template will not work BEFORE it is needed", () => {
  const approved = (over = {}) => ({ name: "quotation_sent", status: "APPROVED", placeholders: 4, body: "", ...over });

  it("passes one that is approved and the right shape", () => {
    expect(checkTemplate("quotation_sent", approved())).toEqual({ ok: true, problem: "" });
  });

  it("catches one still in review", () => {
    expect(checkTemplate("quotation_sent", approved({ status: "PENDING" })).problem).toMatch(/pending/i);
  });

  it("catches one Meta has never heard of", () => {
    expect(checkTemplate("quotation_sent", null).problem).toMatch(/not found/i);
  });

  it("CATCHES A WORDING THAT TAKES A DIFFERENT NUMBER OF BLANKS", () => {
    /* Somebody edits the template in Meta to add a line with {{5}} in it.
       Every send then fails with an error nobody is watching, and the
       customer simply never hears from us. */
    const problem = checkTemplate("quotation_sent", approved({ placeholders: 5 })).problem;
    expect(problem).toContain("5 blanks");
    expect(problem).toContain("fills 4");
  });
});

describe("Meta's error wording", () => {
  it("prefers the message written for a person", () => {
    expect(metaError({ error: { error_user_title: "Template not found", error_user_msg: "Check the name." } }))
      .toBe("Template not found: Check the name.");
  });

  it("falls back to the developer message, and to nothing at all", () => {
    expect(metaError({ error: { message: "(#132001) Template name does not exist" } }))
      .toContain("132001");
    expect(metaError({})).toBe("");
  });
});

describe("remembering the approved wording", () => {
  const reply = () => new Response(JSON.stringify({ data: [
    { name: "quotation_sent", status: "APPROVED", language: "en",
      components: [{ type: "BODY", text: "Hello {{1}}, quotation {{2}} is ready." }] },
  ] }), { status: 200 });

  beforeEach(() => forgetApprovedTemplates());

  it("asks Meta once for a run of many messages", async () => {
    let asked = 0;
    const fetchImpl = async () => { asked += 1; return reply(); };
    for (let i = 0; i < 50; i += 1) {
      const out = await approvedTemplates({ token: "t", wabaId: "w", fetchImpl });
      expect(out.ok).toBe(true);
    }
    expect(asked).toBe(1);
  });

  it("asks again once the answer is old", async () => {
    let asked = 0;
    const fetchImpl = async () => { asked += 1; return reply(); };
    await approvedTemplates({ token: "t", wabaId: "w", fetchImpl });
    await approvedTemplates({ token: "t", wabaId: "w", fetchImpl, maxAgeMs: 0 });
    expect(asked).toBe(2);
  });

  it("asks again for a different WhatsApp Business account", async () => {
    let asked = 0;
    const fetchImpl = async () => { asked += 1; return reply(); };
    await approvedTemplates({ token: "t", wabaId: "w1", fetchImpl });
    await approvedTemplates({ token: "t", wabaId: "w2", fetchImpl });
    expect(asked).toBe(2);
  });

  it("NEVER REMEMBERS A FAILURE — one blip must not silence a whole run", async () => {
    let asked = 0;
    const fetchImpl = async () => {
      asked += 1;
      if (asked === 1) return new Response("nope", { status: 500 });
      return reply();
    };
    const first = await approvedTemplates({ token: "t", wabaId: "w", fetchImpl });
    expect(first.ok).toBe(false);
    const second = await approvedTemplates({ token: "t", wabaId: "w", fetchImpl });
    expect(second.ok).toBe(true);
    expect(asked).toBe(2);
  });

  it("does not ask at all when the account is not configured", async () => {
    let asked = 0;
    const fetchImpl = async () => { asked += 1; return reply(); };
    const out = await approvedTemplates({ token: "", wabaId: "", fetchImpl });
    expect(out.ok).toBe(false);
    expect(asked).toBe(0);
  });
});
