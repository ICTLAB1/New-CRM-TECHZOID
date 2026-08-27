import { describe, expect, it } from "vitest";
import { addNote, blankNote, lastNote, newNote, noteIsEmpty, sortedNotes } from "./notes";
import type { Customer } from "./customer";

const ME = { id: "u1", name: "Priyanshi" };
const AT = Date.UTC(2026, 7, 20, 10, 30);
const base = (): Customer => ({ id: "c1", ownerId: "u1", company: "Northline Logistics" });

describe("writing a note", () => {
  it("records who said it, when, and what kind of contact it was", () => {
    const note = newNote({ type: "Call", text: "Spoke to Rajesh" }, ME, AT);
    expect(note).toMatchObject({ type: "Call", text: "Spoke to Rajesh", user: "Priyanshi", userId: "u1", ts: AT });
    expect(note.id).toBeTruthy();
  });

  it("gives every note its own id", () => {
    // Two notes typed in the same millisecond are ordinary — a paste of
    // three call logs one after another. Sharing an id would make React
    // render one of them twice and lose the other.
    const a = newNote({ type: "Call", text: "one" }, ME, AT);
    const b = newNote({ type: "Call", text: "two" }, ME, AT);
    expect(a.id).not.toBe(b.id);
  });

  it("trims what was typed", () => {
    expect(newNote({ type: "Note", text: "  spoke to Rajesh  " }, ME, AT).text).toBe("spoke to Rajesh");
  });

  it("leaves out an outcome nobody filled in", () => {
    // An empty string would read on the timeline as "Outcome — ", which is
    // a different claim from a call that had no outcome worth recording.
    const note = newNote({ type: "Call", text: "rang", outcome: "   ", nextAction: "" }, ME, AT);
    expect(note.outcome).toBeUndefined();
    expect(note.nextAction).toBeUndefined();
  });

  it("falls back to a name when nobody is signed in", () => {
    expect(newNote({ type: "Note", text: "x" }, { id: "", name: "" }, AT).user).toBe("Someone");
  });
});

describe("what counts as empty", () => {
  it("is a note with nothing said in it", () => {
    expect(noteIsEmpty(blankNote())).toBe(true);
    expect(noteIsEmpty({ type: "Call", text: "   " })).toBe(true);
    // Picking an outcome is not saying anything.
    expect(noteIsEmpty({ type: "Call", text: "", outcome: "Interested" })).toBe(true);
    expect(noteIsEmpty({ type: "Call", text: "rang" })).toBe(false);
  });

  it("adds nothing to the customer", () => {
    const c = base();
    expect(addNote(c, blankNote(), ME, AT)).toBe(c);
  });
});

describe("adding to a customer", () => {
  it("puts the newest first and keeps what was there", () => {
    const one = addNote(base(), { type: "Call", text: "first" }, ME, AT);
    const two = addNote(one, { type: "Email", text: "second" }, ME, AT + 1000);
    expect(two.notes?.map((n) => n.text)).toEqual(["second", "first"]);
  });

  it("does not touch the customer it was given", () => {
    const c = base();
    addNote(c, { type: "Call", text: "rang" }, ME, AT);
    expect(c.notes).toBeUndefined();
  });

  it("works on a record that has never had one", () => {
    expect(addNote(base(), { type: "Call", text: "rang" }, ME, AT).notes).toHaveLength(1);
  });
});

describe("reading them back", () => {
  it("sorts newest first whatever order they arrived in", () => {
    // A record imported or delivered by webhook may hold them any way round.
    const c: Customer = {
      ...base(),
      notes: [
        { id: "a", ts: AT, user: "P", userId: "u1", text: "older", type: "Call" },
        { id: "b", ts: AT + 5000, user: "P", userId: "u1", text: "newer", type: "Call" },
      ],
    };
    expect(sortedNotes(c).map((n) => n.text)).toEqual(["newer", "older"]);
    expect(lastNote(c)?.text).toBe("newer");
  });

  it("has nothing to say about a customer with no notes", () => {
    expect(sortedNotes(base())).toEqual([]);
    expect(lastNote(base())).toBeNull();
  });
});
