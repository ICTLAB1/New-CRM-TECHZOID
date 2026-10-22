/**
 * An HTML email, as readable text.
 *
 * NOT A SECURITY BOUNDARY, and worth being exact about: this text goes into
 * a React text node, and React escapes those, so the sender's markup cannot
 * execute whether it is stripped or not. Stripping is so that HTML mail
 * reads as words instead of tag soup.
 *
 * The security rule is elsewhere and is simply this: never render a message
 * body with dangerouslySetInnerHTML. A mailbox is the one place in this CRM
 * where the content is written by people outside the company, and that is
 * the line that would make their markup ours.
 *
 * Script and style blocks go with their CONTENTS, because stripping only
 * the tags would leave the CSS and the JavaScript behind as "text" — which
 * is how a tidy message turns into a page of selectors.
 */
export function plainTextFrom(html: string): string {
  return String(html ?? "")
    .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    /* Block ends become line breaks, so paragraphs survive as paragraphs. */
    .replace(/<\/(p|div|tr|li|h[1-6])\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    /* Lines are trimmed BEFORE blank runs are collapsed: a line holding one
       space is not blank until it has been trimmed, so collapsing first
       leaves the wall of gaps it was meant to remove. */
    .split("\n").map((line) => line.trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
