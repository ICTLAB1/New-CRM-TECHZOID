import { describe, expect, it } from "vitest";
import { describeError } from "./describe";

describe("describing a failure", () => {
  it("never renders undefined", () => {
    // An error thrown as a string, an object with no message, or a rejection
    // carrying nothing all print literally unless something catches them.
    for (const thrown of [undefined, null, {}, "", 0, [], new Error("")]) {
      const { message } = describeError(thrown);
      expect(message, String(thrown)).toBeTruthy();
      expect(message).not.toContain("undefined");
    }
  });

  it("keeps the technical detail out of what the user reads", () => {
    const pg = { code: "23505", message: 'duplicate key value violates unique constraint "customers_pkey"' };
    const { message, detail } = describeError(pg);
    // The table and the constraint are internal structure — and this is a
    // screen somebody might photograph.
    expect(message).not.toContain("customers_pkey");
    expect(message).not.toContain("constraint");
    expect(detail).toContain("customers_pkey");
  });

  it("says what a permission failure actually means", () => {
    expect(describeError({ code: "42501", message: "permission denied for table customers" }).message)
      .toContain("permission");
    expect(describeError({ message: "new row violates row-level security policy" }).message)
      .toContain("permission");
  });

  it("recognises an expired session, which is fixable by signing in", () => {
    expect(describeError({ code: "PGRST301", message: "JWT expired" }).message).toContain("Sign in again");
  });

  it("treats a dropped connection as a connection problem", () => {
    expect(describeError(new TypeError("Failed to fetch")).message).toContain("offline");
  });

  it("uses the caller's own sentence when it recognises nothing", () => {
    // "Couldn't save that customer" beats "something went wrong", because it
    // says which thing did not happen.
    const { message } = describeError({ message: "some novel failure" }, "Couldn't save that customer.");
    expect(message).toBe("Couldn't save that customer.");
  });

  it("matches on the code as well as the words", () => {
    // Postgres rewords its messages between versions; a match that depends
    // on exact wording quietly stops matching after an upgrade.
    expect(describeError({ code: "23505", message: "" }).message).toContain("already exists");
  });
});
