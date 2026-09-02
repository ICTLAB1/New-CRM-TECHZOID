import { describe, expect, it } from "vitest";
import { inlineFormat, previewHtml, stripMarkers } from "../../src/domain/outreach/preview";
import {
  inlineFormat as sentInline,
  renderHtml as sentHtml,
  stripMarkers as sentStrip,
} from "./outreachRender.mjs";

/**
 * The composer's preview and the email that is sent must render identically.
 *
 * Two copies again — the renderer that matters lives in a Netlify function
 * the browser cannot import. A preview that differs from what is sent is the
 * worst kind of wrong: somebody checks it, sees it is right, and ships
 * something else.
 */

const BODY = [
  "Hello, **Mr. Kumar**",
  "I'm **Abhinav Jain,** _Managing Director_ at **TechZoid Technologies**.",
  "==What does your licensing landscape look like right now?==",
  "Either way, _I'd value your reply_.",
  "[Our site](https://www.techzoidtechnologies.com)",
].join("\n\n");

describe("the preview renders what the email will", () => {
  const CASES = [
    ["plain text", "Hello."],
    ["bold", "**The reason I'm writing:** most teams discover…"],
    ["italic", "So rather than pitch you anything, _I'd rather ask_:"],
    ["a highlight", "==What does your licensing look like?=="],
    ["a link", "[our site](https://x.example)"],
    ["markup somebody typed", "<script>alert(1)</script> & <b>x</b>"],
    ["a line break inside a paragraph", "Line one\nLine two"],
    ["the whole email", BODY],
  ];

  for (const [label, text] of CASES) {
    it(label, () => {
      expect(inlineFormat(text)).toBe(sentInline(text));
    });
  }

  it("builds the same document, signature and all", () => {
    const signature = '<table><tr><td>SIG</td></tr></table>';
    /* The sent version substitutes the real unsubscribe URL later; the
       preview has nothing to link to, so they are compared with the footer
       normalised to the same href. */
    const sent = sentHtml({ body: BODY, unsubscribe: "#", signature });
    expect(previewHtml(BODY, signature)).toBe(sent);
  });

  it("agrees on what the plain-text part looks like", () => {
    expect(stripMarkers(BODY)).toBe(sentStrip(BODY));
  });

  it("puts the signature between the message and the unsubscribe line", () => {
    const html = previewHtml("Hello.", "<!--SIG-->");
    expect(html.indexOf("Hello.")).toBeLessThan(html.indexOf("<!--SIG-->"));
    expect(html.indexOf("<!--SIG-->")).toBeLessThan(html.indexOf("unsubscribe"));
  });
});
