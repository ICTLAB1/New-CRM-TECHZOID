import { describe, expect, it } from "vitest";
import { groupEntriesByDay, recordTimeline, type RecordDocument } from "./record";
import type { CustomerNote } from "./customer";

const note = (o: Partial<CustomerNote>): CustomerNote => ({
  id: "n1", ts: Date.parse("2026-09-20T10:00:00Z"), user: "Priyanshi", userId: "u1",
  text: "Spoke to Divyansh", type: "Call", ...o,
});
const doc = (o: Partial<RecordDocument>): RecordDocument => ({
  id: "d1", number: "TZ/QT/2026-27/0047", kind: "Quotation", date: "2026-09-20", ...o,
});

describe("one story, not two panels", () => {
  it("merges calls and documents into a single list, newest first", () => {
    const t = recordTimeline(
      { notes: [note({ id: "a", ts: Date.parse("2026-09-18T09:00:00Z") })] },
      [doc({ id: "b", date: "2026-09-21" })],
    );
    expect(t.map((e) => e.kind)).toEqual(["document", "note"]);
  });

  it("puts a document after the calls logged the same day, not before them", () => {
    /* A document carries a day, not a moment. At midnight it would sort
       below every call that day and read as though they all followed it. */
    const t = recordTimeline(
      { notes: [note({ id: "morning", ts: Date.parse("2026-09-20T04:00:00Z") })] },
      [doc({ date: "2026-09-20" })],
    );
    expect(t[0]?.kind).toBe("document");
  });

  it("carries the outcome through as a tone", () => {
    const [entry] = recordTimeline({ notes: [note({ outcome: "Not interested" })] });
    expect(entry?.tone).toBe("bad");
  });

  it("puts the next action on the same line as what was said", () => {
    const [entry] = recordTimeline({ notes: [note({ nextAction: "Send revised pricing" })] });
    expect(entry?.body).toContain("Spoke to Divyansh");
    expect(entry?.body).toContain("Next: Send revised pricing");
  });

  it("copes with a customer who has no history at all", () => {
    expect(recordTimeline({ notes: undefined }, [])).toEqual([]);
  });
});

describe("grouping by day", () => {
  it("returns the newest day first and the newest entry within it", () => {
    const days = groupEntriesByDay(recordTimeline(
      {
        notes: [
          note({ id: "early", ts: Date.parse("2026-09-20T04:00:00Z"), text: "early" }),
          note({ id: "late", ts: Date.parse("2026-09-20T16:00:00Z"), text: "late" }),
          note({ id: "old", ts: Date.parse("2026-09-01T10:00:00Z"), text: "old" }),
        ],
      },
      [],
    ));
    expect(days.map((d) => d.date)).toEqual(["2026-09-20", "2026-09-01"]);
    expect(days[0]?.entries.map((e) => e.body)).toEqual(["late", "early"]);
  });
});
