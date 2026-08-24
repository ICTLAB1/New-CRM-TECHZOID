import type { Customer, CustomerNote } from "../customers/customer";

/**
 * Outbound webhooks: notify the company's own website when a deal moves.
 *
 * This module decides WHAT gets sent and WHEN — the same split as the
 * document model: content decisions live here, pure and tested; the actual
 * HTTP delivery, signing and retry live server-side in
 * netlify/functions/webhook-deliver-background.mjs, because a signing
 * secret must never reach the browser and a retry loop must never block a
 * screen waiting for a customer's website to answer.
 */

export const WEBHOOK_EVENT_KINDS = [
  "deal.created",
  "deal.stage_changed",
  "deal.won",
  "deal.lost",
  "activity.logged",
] as const;

export type WebhookEventKind = (typeof WEBHOOK_EVENT_KINDS)[number];

export interface WebhookDispatch {
  kind: WebhookEventKind;
  payload: Record<string, unknown>;
}

/** A "deal" is a customer record's place in the pipeline — there is no
 *  separate deals table, so this is built straight from the fields already
 *  on Customer. Nothing here is invented. */
function dealPayload(c: Customer): Record<string, unknown> {
  return {
    dealId: c.id,
    company: c.company || "",
    contact: c.contact || "",
    stage: c.stage ?? "lead",
    value: typeof c.value === "number" ? c.value : Number(c.value) || 0,
    currency: c.currency || "INR",
    ownerId: c.ownerId,
    updatedAt: c.updatedAt ?? null,
  };
}

function stageChangedPayload(c: Customer, fromStage: string | undefined): Record<string, unknown> {
  return { ...dealPayload(c), fromStage: fromStage ?? "lead", toStage: c.stage ?? "lead" };
}

function activityPayload(c: Customer, note: CustomerNote): Record<string, unknown> {
  return {
    dealId: c.id,
    company: c.company || "",
    activityId: note.id,
    activityKind: note.type,
    text: note.text || "",
    who: note.user || "",
    loggedAt: note.ts,
  };
}

/**
 * Diff two customer arrays and return every webhook event the change
 * implies — created, moved stage, won, lost, or a new note logged.
 *
 * Pure: no I/O, no clock, so a save path can call it without the event
 * itself needing to know anything about webhooks being configured, and it
 * is fully testable without a network.
 */
export function detectCustomerEvents(prev: readonly Customer[], next: readonly Customer[]): WebhookDispatch[] {
  const prevById = new Map(prev.map((c) => [c.id, c]));
  const events: WebhookDispatch[] = [];

  for (const c of next) {
    const before = prevById.get(c.id);

    if (!before) {
      events.push({ kind: "deal.created", payload: dealPayload(c) });
      continue;
    }

    const fromStage = before.stage ?? "lead";
    const toStage = c.stage ?? "lead";
    if (fromStage !== toStage) {
      events.push({ kind: "deal.stage_changed", payload: stageChangedPayload(c, fromStage) });
      if (toStage === "won") events.push({ kind: "deal.won", payload: dealPayload(c) });
      if (toStage === "lost") events.push({ kind: "deal.lost", payload: dealPayload(c) });
    }

    const beforeCount = before.notes?.length ?? 0;
    const afterNotes = c.notes ?? [];
    /* Only the notes actually added since `before` — editing an existing
       note's text is not "logging an activity" and must not resend one for
       every note already on the record whenever the array happens to be
       longer than expected. */
    if (afterNotes.length > beforeCount) {
      for (const note of afterNotes.slice(beforeCount)) {
        events.push({ kind: "activity.logged", payload: activityPayload(c, note) });
      }
    }
  }

  return events;
}
