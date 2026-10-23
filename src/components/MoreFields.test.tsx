import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MoreFields } from "./MoreFields";
import { Field, Input } from "./primitives";

/**
 * The one way progressive disclosure goes wrong quietly: it hides an answer.
 *
 * A field nobody fills in may be folded away. A field somebody already
 * filled in may not, because invisible and lost look identical to the person
 * editing the record.
 */

const body = (filledValues: string[]) => renderToStaticMarkup(
  <MoreFields label="more contact details" filled={filledValues}>
    <Field label="Website"><Input value={filledValues[0] ?? ""} readOnly /></Field>
  </MoreFields>,
);

describe("MoreFields", () => {
  it("stays shut when every field inside is empty", () => {
    const html = body([""]);
    expect(html).toContain("Show more contact details");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Website");
  });

  it("opens itself when a field inside is holding something", () => {
    const html = body(["www.acme.in"]);
    expect(html).toContain("Website");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Hide more contact details");
  });

  it("is a named button, so a keyboard can reach it", () => {
    /* An icon-only chevron would be a control a screen reader announces as
       "button" and nothing else. */
    expect(body([""])).toContain("Show more contact details");
  });
});
