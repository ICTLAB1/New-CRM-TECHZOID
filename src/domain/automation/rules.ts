import type { StageId } from "../pipeline/stages";

/**
 * Automations: when this happens, do that.
 *
 * WHY A RULE ENGINE AND NOT A DOZEN HARD-WIRED BEHAVIOURS. The CRM
 * already automates several things — a quotation's follow-up sequence, a
 * renewal reminder, a campaign's sending ramp — and every one of them is
 * a separate piece of code with its own switch in Settings. Adding the
 * thirteenth means another one. A rule the company writes itself is the
 * difference between asking for an automation and having one.
 *
 * THE SHAPE IS DELIBERATELY SMALL: one trigger, any number of conditions,
 * any number of actions. No branching, no loops, no waiting on a
 * sub-workflow. Every automation anybody has actually asked for here fits
 * in it, and the ones that do not are better written as code than
 * assembled out of boxes by somebody who then cannot tell why it fired.
 *
 * NOTHING HERE TOUCHES THE WORLD. This module decides WHETHER a rule
 * matches and WHAT it would do; carrying the action out belongs to the
 * runner, which is the only part that can send an email or write a row.
 * Keeping the decision pure is what makes "why did this fire" answerable
 * — the same reason the tax and numbering logic is pure.
 */

/** What can set a rule off. Each one names a thing that happens in the
 *  product, not a table that changes: "an invoice went overdue" is a fact
 *  somebody can reason about, "invoices.updated" is not. */
export type TriggerId =
  | "deal.stage_changed"
  | "deal.created"
  | "deal.idle"
  | "quotation.sent"
  | "quotation.accepted"
  | "invoice.overdue"
  | "customer.created"
  | "lead.received";

export interface TriggerDef {
  id: TriggerId;
  label: string;
  /** What the rule gets to look at and fill placeholders from. */
  subject: "deal" | "document" | "customer";
  /** True when the trigger fires on elapsed time rather than an event, so
   *  the editor can ask for the number of days and the runner knows to
   *  evaluate it on a schedule rather than on a change. */
  elapsed?: boolean;
}

export const TRIGGERS: readonly TriggerDef[] = [
  { id: "deal.created", label: "A deal is created", subject: "deal" },
  { id: "deal.stage_changed", label: "A deal moves to a stage", subject: "deal" },
  { id: "deal.idle", label: "A deal has not moved for N days", subject: "deal", elapsed: true },
  { id: "quotation.sent", label: "A quotation is sent", subject: "document" },
  { id: "quotation.accepted", label: "A quotation is accepted", subject: "document" },
  { id: "invoice.overdue", label: "An invoice is N days overdue", subject: "document", elapsed: true },
  { id: "customer.created", label: "A customer is created", subject: "customer" },
  { id: "lead.received", label: "A lead arrives", subject: "customer" },
];

export type Comparator = "is" | "is_not" | "gt" | "lt" | "contains" | "is_set" | "is_not_set";

export interface Condition {
  /** A field on the subject: "stage", "value", "currency", "owner", … */
  field: string;
  op: Comparator;
  /** Unused by is_set / is_not_set. */
  value?: string | number;
}

export type ActionId =
  | "create_task" | "notify_owner" | "email_customer"
  | "set_stage" | "assign_owner" | "add_note";

export interface ActionDef {
  id: ActionId;
  label: string;
  /** Does it reach outside the product? Those are the ones a dry run must
   *  never perform and a person should look at before switching on. */
  external?: boolean;
}

export const ACTIONS: readonly ActionDef[] = [
  { id: "create_task", label: "Create a task for the owner" },
  { id: "notify_owner", label: "Notify the owner" },
  { id: "add_note", label: "Log a note on the record" },
  { id: "set_stage", label: "Move the deal to a stage" },
  { id: "assign_owner", label: "Assign an owner" },
  { id: "email_customer", label: "Email the customer", external: true },
];

export interface Action {
  id: ActionId;
  /** Free text with {{placeholders}}; see fillTemplate. */
  text?: string;
  /** For set_stage and assign_owner. */
  target?: string;
  /** Days, for a task's due date. */
  days?: number;
}

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: TriggerId;
  /** For an elapsed trigger: how many days. */
  afterDays?: number;
  /** For deal.stage_changed: which stage. */
  stage?: StageId;
  conditions: Condition[];
  actions: Action[];
  createdAt: number;
  updatedAt: number;
}

/* ── evaluation ─────────────────────────────────────────────────────── */

/** The record a rule is being judged against, flattened to plain values.
 *  Flattened deliberately: a condition names a field, and a field that
 *  might be three objects deep is one nobody can write a rule about. */
export type Subject = Record<string, string | number | boolean | null | undefined>;

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const text = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/**
 * Whether one condition holds.
 *
 * A COMPARISON AGAINST A MISSING FIELD IS FALSE, never an error and never
 * true. A rule that emails a customer when "value > 100000" must not fire
 * on a record that has no value at all — and it must not stop the whole
 * automation either, because one incomplete record would then silently
 * switch off a rule for everybody.
 */
export function conditionHolds(c: Condition, subject: Subject): boolean {
  const actual = subject[c.field];
  const present = actual !== null && actual !== undefined && actual !== "";
  switch (c.op) {
    case "is_set": return present;
    case "is_not_set": return !present;
    case "is": return present && text(actual).toLowerCase() === text(c.value).toLowerCase();
    case "is_not": return !present || text(actual).toLowerCase() !== text(c.value).toLowerCase();
    case "contains": return present && text(actual).toLowerCase().includes(text(c.value).toLowerCase());
    case "gt": {
      const a = num(actual); const b = num(c.value);
      return a !== null && b !== null && a > b;
    }
    case "lt": {
      const a = num(actual); const b = num(c.value);
      return a !== null && b !== null && a < b;
    }
    default: return false;
  }
}

/** Every condition must hold. No rule has ever been clearer for having an
 *  OR in it — two rules say the same thing and each one can be read. */
export const conditionsHold = (rule: Pick<Rule, "conditions">, subject: Subject): boolean =>
  (rule.conditions ?? []).every((c) => conditionHolds(c, subject));

export interface FireContext {
  trigger: TriggerId;
  subject: Subject;
  /** For an elapsed trigger: how many days it has actually been. */
  daysElapsed?: number;
  /** For deal.stage_changed: the stage it moved to. */
  stage?: string;
}

/** Whether a rule should fire for this event. */
export function ruleFires(rule: Rule, ctx: FireContext): boolean {
  if (!rule.enabled) return false;
  if (rule.trigger !== ctx.trigger) return false;
  /* A stage-specific rule ignores every other stage. Left unset it
     watches all of them, which is what "a deal moves" plainly means. */
  if (rule.stage && ctx.stage && rule.stage !== ctx.stage) return false;
  const def = TRIGGERS.find((t) => t.id === rule.trigger);
  if (def?.elapsed) {
    const need = Number(rule.afterDays ?? 0);
    const has = Number(ctx.daysElapsed ?? 0);
    /* AT LEAST, not exactly: a scheduled run that is missed — a deploy, an
       outage, a weekend — must not let an invoice slip past the day it
       would have fired and never be chased at all. */
    if (!(has >= need)) return false;
  }
  return conditionsHold(rule, ctx.subject);
}

/** Rules that fire, in the order they were written. */
export const firingRules = (rules: readonly Rule[], ctx: FireContext): Rule[] =>
  rules.filter((r) => ruleFires(r, ctx));

/* ── what an action would say ───────────────────────────────────────── */

/**
 * Fill {{placeholders}} from the subject.
 *
 * AN UNKNOWN PLACEHOLDER IS LEFT STANDING, not blanked. A customer email
 * reading "Dear , your invoice" is worse than one reading "Dear
 * {{contact}}" — the first looks like a broken product to the customer,
 * the second looks like a broken rule to the person who wrote it, and
 * only one of those two is the right audience for the mistake.
 */
export function fillTemplate(template: string, subject: Subject): string {
  return (template ?? "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, key: string) => {
    const v = subject[key];
    return v === null || v === undefined || v === "" ? whole : String(v);
  });
}

/** Placeholders a template asks for that the subject cannot fill. What the
 *  editor warns about BEFORE a rule is switched on. */
export function missingPlaceholders(template: string, subject: Subject): string[] {
  const asked = [...(template ?? "").matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1] as string);
  return [...new Set(asked.filter((k) => {
    const v = subject[k];
    return v === null || v === undefined || v === "";
  }))];
}

export const blankRule = (id: string, now: number = Date.now()): Rule => ({
  id,
  name: "",
  /* OFF until somebody says otherwise. A rule that starts emailing
     customers the moment it is saved is one nobody got to read first. */
  enabled: false,
  trigger: "deal.stage_changed",
  conditions: [],
  actions: [],
  createdAt: now,
  updatedAt: now,
});

/** What stops a rule being switched on. Empty means it is safe to enable. */
export function ruleProblems(rule: Rule): string[] {
  const out: string[] = [];
  if (!rule.name.trim()) out.push("Give it a name — you will be reading a list of these later.");
  if (!rule.actions.length) out.push("It does nothing. Add at least one action.");
  const def = TRIGGERS.find((t) => t.id === rule.trigger);
  if (def?.elapsed && !(Number(rule.afterDays) > 0)) {
    out.push("Say how many days, or it would fire the moment the record is created.");
  }
  for (const c of rule.conditions) {
    const needsValue = c.op !== "is_set" && c.op !== "is_not_set";
    if (needsValue && (c.value === undefined || c.value === "")) {
      out.push(`The condition on "${c.field}" has no value to compare against.`);
    }
  }
  return out;
}
