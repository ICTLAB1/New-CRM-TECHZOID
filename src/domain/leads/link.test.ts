import { describe, expect, it } from "vitest";
import { isLeadCode, isLeadUuid, leadLink, readLeadRef, LEAD_CODE_ALPHABET } from "./link";

const UUID = "ebc9fe98-4434-4b13-82bd-887c1a2b3c4d";

describe("the code alphabet", () => {
  it("leaves out every character pair that gets misread", () => {
    // Read down a phone line, written on a card, typed by somebody who has
    // never seen it before.
    for (const ch of ["0", "O", "1", "I", "L"]) {
      expect(LEAD_CODE_ALPHABET.includes(ch), ch).toBe(false);
    }
  });
});

describe("recognising a reference", () => {
  it("accepts a six-character code", () => {
    expect(isLeadCode("K7QM2P")).toBe(true);
    expect(isLeadCode("k7qm2p")).toBe(true);
  });

  it("rejects anything that is not one", () => {
    expect(isLeadCode("K7QM2")).toBe(false);
    expect(isLeadCode("K7QM2PX")).toBe(false);
    expect(isLeadCode("K7QM0P")).toBe(false);   // 0 is not in the alphabet
    expect(isLeadCode("")).toBe(false);
  });

  it("still recognises the uuid links already shared", () => {
    expect(isLeadUuid(UUID)).toBe(true);
    expect(isLeadUuid("not-a-uuid")).toBe(false);
  });
});

describe("reading one out of a URL", () => {
  const at = (pathname: string, search = "") => readLeadRef({ pathname, search });

  it("reads the short path", () => {
    expect(at("/r/K7QM2P")).toBe("K7QM2P");
  });

  it("forgives a trailing slash and lower case", () => {
    expect(at("/r/k7qm2p/")).toBe("K7QM2P");
  });

  it("still reads a link that was shared a year ago", () => {
    // These are in people's inboxes. A link that stops resolving means a
    // customer meets a dead page and no way to tell anybody.
    expect(at("/", "?lead=" + UUID)).toBe(UUID);
  });

  it("gives nothing for an ordinary page", () => {
    expect(at("/")).toBe("");
    expect(at("/customers")).toBe("");
    expect(at("/r/")).toBe("");
    expect(at("/r/nope!")).toBe("");
  });

  it("does not treat rubbish in the query as a reference", () => {
    expect(at("/", "?lead=../../etc/passwd")).toBe("");
  });
});

describe("building the link to share", () => {
  it("is short once a code exists", () => {
    expect(leadLink("https://crm.example.com", "K7QM2P", UUID)).toBe("https://crm.example.com/r/K7QM2P");
  });

  it("falls back to the long form rather than to a link that 404s", () => {
    expect(leadLink("https://crm.example.com", "", UUID)).toBe("https://crm.example.com/?lead=" + UUID);
  });

  it("does not double the slash on an origin that has one", () => {
    expect(leadLink("https://crm.example.com/", "K7QM2P", UUID)).toBe("https://crm.example.com/r/K7QM2P");
  });
});
