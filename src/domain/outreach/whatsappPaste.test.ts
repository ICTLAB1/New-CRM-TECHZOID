import { describe, expect, it } from "vitest";
import { readPastedNumbers } from "./whatsappAudience";

const numbers = (text: string) => readPastedNumbers(text).numbers.map((n) => n.number);

describe("a pasted list of numbers", () => {
  it("reads a bare number, one per line", () => {
    expect(numbers("9810012345\n9820099887")).toEqual(["+91 9810012345", "+91 9820099887"]);
  });

  /* THE SHAPE EVERY LIST ARRIVES IN — two columns out of a spreadsheet,
     name then number. The same rule as the email paste: a line is a
     record, so the tab is a column boundary and not a person boundary. */
  it("reads a name and a number pasted as two columns", () => {
    const out = readPastedNumbers("Anoop Samdani\t9810012345\nDavinder Singh\t9820099887");
    expect(out.unreadable).toEqual([]);
    expect(out.numbers).toEqual([
      { label: "Anoop Samdani", number: "+91 9810012345" },
      { label: "Davinder Singh", number: "+91 9820099887" },
    ]);
  });

  it("takes a number however somebody typed it", () => {
    expect(numbers("+91 98100 12345")).toEqual(["+91 9810012345"]);
    expect(numbers("098100-12345")).toEqual(["+91 9810012345"]);
    expect(numbers("(0981) 001 2345")).toEqual(["+91 9810012345"]);
    expect(numbers("919810012345")).toEqual(["+91 9810012345"]);
  });

  it("keeps a number that is not Indian as the country it names", () => {
    expect(numbers("+971 50 123 4567")).toEqual(["+971 501234567"]);
  });

  it("collapses a repeat and says so, however it was typed the second time", () => {
    const out = readPastedNumbers("9810012345\n+91 98100 12345\n9820099887");
    expect(out.numbers).toHaveLength(2);
    expect(out.duplicates).toEqual(["+91 9810012345"]);
  });

  /* A paste that quietly loses four numbers out of forty is a broadcast
     that quietly misses four customers. */
  it("reports a line it could not read rather than swallowing it", () => {
    const out = readPastedNumbers("9810012345\nring the office\n9820099887");
    expect(out.numbers).toHaveLength(2);
    expect(out.unreadable).toEqual(["ring the office"]);
  });

  it("does not report punctuation as a lost number", () => {
    expect(readPastedNumbers("9810012345\n---\n•\n9820099887").unreadable).toEqual([]);
  });

  it("refuses something too short to be a phone number", () => {
    const out = readPastedNumbers("12345");
    expect(out.numbers).toEqual([]);
    expect(out.unreadable).toEqual(["12345"]);
  });

  /* `splitFragments` keeps a line whole when it holds no email, and every
     line here holds none — so a line of several numbers arrives as one
     fragment. Taking only the first match would drop the rest without a
     word, which is the silent loss this whole module reports against. */
  it("reads every number on a line, not just the first", () => {
    expect(numbers("9810012345, 9820099887")).toEqual(["+91 9810012345", "+91 9820099887"]);
    expect(numbers("9810012345; 9820099887 | 9830011223"))
      .toEqual(["+91 9810012345", "+91 9820099887", "+91 9830011223"]);
  });

  /* A NAME ONLY WHERE IT CAN BE THE RIGHT ONE. With several numbers on a
     line the leftover text belongs to none of them in particular, and
     "Anoop and Davinder, 98100…, 98200…" would greet both as Anoop. */
  it("leaves the name off when it cannot tell whose it is", () => {
    const out = readPastedNumbers("Anoop and Davinder 9810012345, 9820099887");
    expect(out.numbers.map((n) => n.label)).toEqual(["", ""]);
  });

  it("copes with an empty paste", () => {
    expect(readPastedNumbers("")).toEqual({ numbers: [], unreadable: [], duplicates: [] });
  });
});
