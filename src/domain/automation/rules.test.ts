import { describe, expect, it } from "vitest";
import {
  blankRule, conditionHolds, fillTemplate, firingRules, missingPlaceholders,
  ruleFires, ruleProblems, TRIGGERS, type Rule, type Subject,
} from "./rules";

const rule = (o: Partial<Rule> = {}): Rule => ({
  ...blankRule("r1"), name: "Test", enabled: true, ...o,
});
const deal: Subject = { stage: "negotiation", value: 430000, currency: "INR", owner: "Abhinav", company: "Modi Mundipharma" };

describe("a condition against a missing field", () => {
  it("is false, not an error and not true", () => {
    /* A rule that emails when "value > 100000" must not fire on a record
       with no value — and must not throw either, or one incomplete record
       would silently switch the rule off for everybody. */
    expect(conditionHolds({ field: "nope", op: "gt", value: 10 }, deal)).toBe(false);
    expect(conditionHolds({ field: "nope", op: "is", value: "x" }, deal)).toBe(false);
    expect(conditionHolds({ field: "nope", op: "contains", value: "x" }, deal)).toBe(false);
  });

  it("still answers is_not and is_not_set truthfully", () => {
    expect(conditionHolds({ field: "nope", op: "is_not", value: "x" }, deal)).toBe(true);
    expect(conditionHolds({ field: "nope", op: "is_not_set" }, deal)).toBe(true);
    expect(conditionHolds({ field: "stage", op: "is_set" }, deal)).toBe(true);
  });
});

describe("comparisons", () => {
  it("compares text without caring about case", () => {
    expect(conditionHolds({ field: "stage", op: "is", value: "Negotiation" }, deal)).toBe(true);
  });

  it("compares numbers as numbers, not as text", () => {
    /* "430000" > "100000" happens to be true as text and "90" > "100000"
       is too. Only one of those is right. */
    expect(conditionHolds({ field: "value", op: "gt", value: 100000 }, deal)).toBe(true);
    expect(conditionHolds({ field: "value", op: "gt", value: "100000" }, deal)).toBe(true);
    expect(conditionHolds({ field: "value", op: "lt", value: 100000 }, deal)).toBe(false);
    expect(conditionHolds({ field: "value", op: "gt", value: "abc" }, deal)).toBe(false);
  });
});

describe("whether a rule fires", () => {
  const ctx = { trigger: "deal.stage_changed" as const, subject: deal, stage: "negotiation" };

  it("does not fire while it is switched off", () => {
    expect(ruleFires(rule({ enabled: false, trigger: "deal.stage_changed" }), ctx)).toBe(false);
  });

  it("ignores a different trigger", () => {
    expect(ruleFires(rule({ trigger: "invoice.overdue" }), ctx)).toBe(false);
  });

  it("watches every stage when none is named", () => {
    expect(ruleFires(rule({ trigger: "deal.stage_changed" }), ctx)).toBe(true);
  });

  it("ignores the stages it was not written for", () => {
    expect(ruleFires(rule({ trigger: "deal.stage_changed", stage: "won" }), ctx)).toBe(false);
    expect(ruleFires(rule({ trigger: "deal.stage_changed", stage: "negotiation" }), ctx)).toBe(true);
  });

  it("needs every condition to hold", () => {
    const r = rule({
      trigger: "deal.stage_changed",
      conditions: [{ field: "value", op: "gt", value: 100000 }, { field: "currency", op: "is", value: "USD" }],
    });
    expect(ruleFires(r, ctx)).toBe(false);
  });

  it("fires on AT LEAST the elapsed days, never only on the exact day", () => {
    /* A scheduled run that is missed — a deploy, an outage, a weekend —
       must not let an invoice slip past its day and never be chased. */
    const r = rule({ trigger: "invoice.overdue", afterDays: 15 });
    const at = (days: number) => ruleFires(r, { trigger: "invoice.overdue", subject: deal, daysElapsed: days });
    expect(at(14)).toBe(false);
    expect(at(15)).toBe(true);
    expect(at(40)).toBe(true);
  });

  it("returns the rules that fire, in the order they were written", () => {
    const rules = [
      rule({ id: "a", stage: "won" }),
      rule({ id: "b" }),
      rule({ id: "c", conditions: [{ field: "value", op: "gt", value: 1 }] }),
    ];
    expect(firingRules(rules, ctx).map((r) => r.id)).toEqual(["b", "c"]);
  });
});

describe("filling a message", () => {
  it("substitutes what it can", () => {
    expect(fillTemplate("{{company}} is at {{stage}}", deal)).toBe("Modi Mundipharma is at negotiation");
  });

  it("leaves an unknown placeholder standing rather than blanking it", () => {
    /* "Dear ," looks like a broken product to the CUSTOMER. "Dear
       {{contact}}" looks like a broken rule to the person who wrote it,
       and only one of those is the right audience for the mistake. */
    expect(fillTemplate("Dear {{contact}}, about {{company}}", deal))
      .toBe("Dear {{contact}}, about Modi Mundipharma");
  });

  it("names what a message asks for and cannot get, before it is switched on", () => {
    expect(missingPlaceholders("Dear {{contact}} at {{company}}, re {{poNumber}}", deal))
      .toEqual(["contact", "poNumber"]);
  });

  it("copes with no placeholders and with none missing", () => {
    expect(missingPlaceholders("Plain text", deal)).toEqual([]);
    expect(fillTemplate("", deal)).toBe("");
  });
});

describe("what stops a rule going live", () => {
  it("starts switched off, however it was created", () => {
    /* A rule that begins emailing customers the moment it is saved is one
       nobody got to read first. */
    expect(blankRule("x").enabled).toBe(false);
  });

  it("refuses one that does nothing", () => {
    expect(ruleProblems(rule({ actions: [] })).join(" ")).toContain("does nothing");
  });

  it("refuses an elapsed trigger with no number of days", () => {
    const r = rule({ trigger: "invoice.overdue", actions: [{ id: "notify_owner" }] });
    expect(ruleProblems(r).join(" ")).toContain("how many days");
    expect(ruleProblems({ ...r, afterDays: 15 })).toEqual([]);
  });

  it("refuses a condition with nothing to compare against", () => {
    const r = rule({
      actions: [{ id: "notify_owner" }],
      conditions: [{ field: "value", op: "gt", value: "" }],
    });
    expect(ruleProblems(r).join(" ")).toContain("no value to compare");
  });

  it("is happy with a complete rule", () => {
    expect(ruleProblems(rule({ actions: [{ id: "notify_owner" }] }))).toEqual([]);
  });
});

describe("the catalogue", () => {
  it("marks the triggers that run on a clock rather than an event", () => {
    const elapsed = TRIGGERS.filter((t) => t.elapsed).map((t) => t.id);
    expect(elapsed).toContain("invoice.overdue");
    expect(elapsed).toContain("deal.idle");
    expect(elapsed).not.toContain("deal.created");
  });
});
