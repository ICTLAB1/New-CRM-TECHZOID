import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Field, Input, Select } from "./primitives";

/**
 * A label must name a control.
 *
 * Every form in the app used to render `<label>` with no `for`, so clicking a
 * label focused nothing and a screen reader announced an unnamed box. Field
 * now binds them, and this is what stops that regressing.
 */

const idOf = (html: string, tag: string): string | null =>
  new RegExp(`<${tag}[^>]*\\sid="([^"]+)"`).exec(html)?.[1] ?? null;

const forOf = (html: string): string | null =>
  /<label[^>]*\sfor="([^"]+)"/.exec(html)?.[1] ?? null;

describe("Field", () => {
  it("binds the label to the control it wraps", () => {
    const html = renderToStaticMarkup(
      <Field label="Vendor"><Input value="" readOnly /></Field>,
    );
    expect(forOf(html)).toBeTruthy();
    expect(forOf(html)).toBe(idOf(html, "input"));
  });

  it("works for a select as well as an input", () => {
    const html = renderToStaticMarkup(
      <Field label="Role"><Select value="a" onChange={() => {}}><option value="a">A</option></Select></Field>,
    );
    expect(forOf(html)).toBe(idOf(html, "select"));
  });

  it("leaves an id the caller set alone", () => {
    const html = renderToStaticMarkup(
      <Field label="Vendor"><Input id="mine" value="" readOnly /></Field>,
    );
    expect(idOf(html, "input")).toBe("mine");
    expect(forOf(html)).toBe("mine");
  });

  /* A Field can wrap an input plus a datalist. The label must land on the
     input, not on whatever happens to be first. */
  it("binds the first control and leaves the rest untouched", () => {
    const html = renderToStaticMarkup(
      <Field label="Vendor">
        <Input value="" readOnly />
        <datalist id="vendors" />
      </Field>,
    );
    expect(forOf(html)).toBe(idOf(html, "input"));
    expect(html).toContain('<datalist id="vendors"');
  });

  it("honours an explicit htmlFor", () => {
    const html = renderToStaticMarkup(
      <Field label="Terms" htmlFor="elsewhere"><div>not a control</div></Field>,
    );
    expect(forOf(html)).toBe("elsewhere");
  });

  it("shows the error in place of the hint", () => {
    const html = renderToStaticMarkup(
      <Field label="Email" hint="Work address" error="Add an @."><Input value="" readOnly /></Field>,
    );
    expect(html).toContain("Add an @.");
    expect(html).not.toContain("Work address");
  });
});
