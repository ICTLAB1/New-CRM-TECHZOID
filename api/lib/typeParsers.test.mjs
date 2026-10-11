import { describe, it, expect } from "vitest";
import pg from "pg";
import "./db.mjs";

describe("values come back the way PostgREST returned them", () => {
  it("keeps a date as yyyy-mm-dd", () => {
    expect(pg.types.getTypeParser(1082)("2026-10-12")).toBe("2026-10-12");
  });
  it("turns numeric into a number", () => {
    expect(pg.types.getTypeParser(1700)("1500.50")).toBe(1500.5);
  });
  it("turns a safe bigint into a number and leaves a huge one alone", () => {
    expect(pg.types.getTypeParser(20)("42")).toBe(42);
    expect(pg.types.getTypeParser(20)("92233720368547758")).toBe("92233720368547758");
  });
});
