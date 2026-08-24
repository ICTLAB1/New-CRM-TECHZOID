import { describe, expect, it } from "vitest";
import { detectCustomerEvents } from "./webhooks";
import type { Customer } from "../customers/customer";

/**
 * `detectCustomerEvents` is the single place that decides which webhook
 * events a save implies. It has to be right without a network or a
 * database in front of it, because Workbench.tsx calls it on every
 * customer save before anything is persisted.
 */

const base: Customer = {
  id: "c1", ownerId: "u1", company: "Acme", stage: "lead",
  value: 10000, currency: "INR", notes: [],
};

describe("detectCustomerEvents", () => {
  it("fires deal.created for a customer id not seen before", () => {
    const events = detectCustomerEvents([], [base]);
    expect(events).toEqual([{ kind: "deal.created", payload: expect.objectContaining({ dealId: "c1" }) }]);
  });

  it("fires nothing when nothing changed", () => {
    expect(detectCustomerEvents([base], [{ ...base }])).toEqual([]);
  });

  it("fires deal.stage_changed with both stages when the stage moves", () => {
    const next = { ...base, stage: "quoted" as const };
    const events = detectCustomerEvents([base], [next]);
    expect(events).toEqual([
      { kind: "deal.stage_changed", payload: expect.objectContaining({ fromStage: "lead", toStage: "quoted" }) },
    ]);
  });

  it("fires deal.won alongside deal.stage_changed when the stage becomes won", () => {
    const next = { ...base, stage: "won" as const };
    const kinds = detectCustomerEvents([base], [next]).map((e) => e.kind);
    expect(kinds).toEqual(["deal.stage_changed", "deal.won"]);
  });

  it("fires deal.lost alongside deal.stage_changed when the stage becomes lost", () => {
    const next = { ...base, stage: "lost" as const };
    const kinds = detectCustomerEvents([base], [next]).map((e) => e.kind);
    expect(kinds).toEqual(["deal.stage_changed", "deal.lost"]);
  });

  it("never fires deal.won or deal.lost for a stage that isn't either", () => {
    const next = { ...base, stage: "negotiation" as const };
    const kinds = detectCustomerEvents([base], [next]).map((e) => e.kind);
    expect(kinds).toEqual(["deal.stage_changed"]);
  });

  it("treats a missing stage as 'lead' on both sides, so undefined does not read as a change", () => {
    const withoutStage: Customer = { id: "c2", ownerId: "u1", company: "NoStage" };
    expect(detectCustomerEvents([withoutStage], [{ ...withoutStage }])).toEqual([]);
  });

  it("fires activity.logged for each note added since the last save", () => {
    const withNote = {
      ...base,
      notes: [{ id: "n1", ts: 1, user: "Priyanshi", userId: "u1", text: "Called", type: "Call" }],
    };
    const events = detectCustomerEvents([base], [withNote]);
    expect(events).toEqual([
      { kind: "activity.logged", payload: expect.objectContaining({ activityId: "n1", text: "Called" }) },
    ]);
  });

  it("fires one activity.logged per new note when several are added at once", () => {
    const withTwoNotes = {
      ...base,
      notes: [
        { id: "n1", ts: 1, user: "Priyanshi", userId: "u1", text: "Called", type: "Call" },
        { id: "n2", ts: 2, user: "Priyanshi", userId: "u1", text: "Emailed", type: "Email" },
      ],
    };
    const events = detectCustomerEvents(
      [{ ...base, notes: [{ id: "n1", ts: 1, user: "Priyanshi", userId: "u1", text: "Called", type: "Call" }] }],
      [withTwoNotes],
    );
    expect(events).toEqual([
      { kind: "activity.logged", payload: expect.objectContaining({ activityId: "n2", text: "Emailed" }) },
    ]);
  });

  it("does not fire activity.logged when a note's text is edited without adding one", () => {
    const withNote = {
      ...base,
      notes: [{ id: "n1", ts: 1, user: "Priyanshi", userId: "u1", text: "Called", type: "Call" }],
    };
    const edited = { ...withNote, notes: [{ ...withNote.notes[0]!, text: "Called — no answer" }] };
    expect(detectCustomerEvents([withNote], [edited])).toEqual([]);
  });

  it("only reports events for the customer that actually changed", () => {
    const other: Customer = { id: "c2", ownerId: "u1", company: "Other", stage: "lead" };
    const events = detectCustomerEvents([base, other], [{ ...base, stage: "won" }, other]);
    expect(events.every((e) => (e.payload as { dealId: string }).dealId === "c1")).toBe(true);
  });
});
