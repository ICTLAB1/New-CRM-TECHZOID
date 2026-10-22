import { describe, expect, it } from "vitest";
import { plainTextFrom } from "./plainText";

describe("an HTML email as readable text", () => {
  it("keeps the words and drops the tags", () => {
    expect(plainTextFrom("<p>Hello <b>Asha</b></p>")).toBe("Hello Asha");
  });

  it("throws away style and script WITH their contents", () => {
    /* Stripping only the tags leaves the CSS behind as text, and a tidy
       message becomes a page of selectors. */
    const html = "<style>.a{color:red}</style><p>Real text</p><script>alert(1)</script>";
    const out = plainTextFrom(html);
    expect(out).toBe("Real text");
    expect(out).not.toContain("color:red");
    expect(out).not.toContain("alert");
  });

  it("keeps paragraphs apart", () => {
    expect(plainTextFrom("<p>One</p><p>Two</p>")).toBe("One\nTwo");
    expect(plainTextFrom("Line one<br>Line two")).toBe("Line one\nLine two");
  });

  it("decodes the entities people actually send", () => {
    expect(plainTextFrom("Tom &amp; Jerry&nbsp;&lt;3&gt;")).toBe("Tom & Jerry <3>");
  });

  it("does not leave a wall of blank lines", () => {
    expect(plainTextFrom("<div>A</div><div></div><div></div><div>B</div>")).toBe("A\n\nB");
  });

  it("is empty, not a crash, for nothing", () => {
    expect(plainTextFrom("")).toBe("");
    expect(plainTextFrom(undefined as unknown as string)).toBe("");
  });
});
