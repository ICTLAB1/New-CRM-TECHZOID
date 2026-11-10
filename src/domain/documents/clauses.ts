/**
 * HOW A CLAUSE IS READ, for every renderer that prints one.
 *
 * The supplied terms are written as "Label: body" — "Payment Terms:
 * Payment shall be made as per the terms specified in the quotation." A
 * run-in label is what makes a schedule of terms scannable: somebody
 * looking for the cancellation clause finds it without reading twelve
 * others. So the label is set apart in bold rather than printed as part of
 * the sentence.
 *
 * The split is done HERE, once, rather than in each renderer, because the
 * PDF and the on-screen preview have to agree: a term that reads as a
 * heading on screen and as a run-on sentence in the file the customer
 * receives is the kind of difference nobody notices until a customer
 * mentions it.
 *
 * Not every set is written this way. The export, invoice and purchase
 * order sets are plain sentences, and they must keep printing as plain
 * sentences — which is why a label is only recognised under the narrow
 * rules below, never "the text before the first colon".
 */

export interface Clause {
  /** The run-in heading, without its colon. Null for a plain sentence. */
  label: string | null;
  /** The sentence itself, with the label and its colon removed. */
  body: string;
}

/** The label that marks a clause as a note rather than a numbered term. */
export const NOTE_LABEL = "Important Note";

/**
 * A label is recognised only when all of these hold:
 *   - there is a colon, followed by a space;
 *   - what precedes it is at most 48 characters;
 *   - it contains no sentence-ending punctuation;
 *   - it is not empty, and something follows the colon.
 *
 * The length and punctuation limits are what stop a plain sentence being
 * mistaken for a heading. "Payment shall be made by irrevocable letter of
 * credit or telegraphic transfer in the quoted currency, free of all bank
 * charges to X." has no colon at all; a clause that did, mid-sentence,
 * would be too long or would carry a full stop before it.
 */
export function splitClause(text: string): Clause {
  const raw = String(text ?? "");
  const at = raw.indexOf(": ");
  if (at <= 0 || at > 48) return { label: null, body: raw.trim() };
  const label = raw.slice(0, at).trim();
  const body = raw.slice(at + 2).trim();
  if (!label || !body) return { label: null, body: raw.trim() };
  if (/[.!?;]/.test(label)) return { label: null, body: raw.trim() };
  return { label, body };
}

/**
 * Numbered terms and notes, kept apart.
 *
 * A note is not a term. "For Government and GeM transactions, the
 * applicable GeM bid conditions ... shall prevail over these standard
 * quotation terms" is a statement ABOUT the terms, and numbering it as
 * clause 21 would make it one of the things it overrides.
 *
 * It travels with the document as an ordinary line of its terms — which
 * is what keeps it editable per document, and saved with documents
 * already sent — and is recognised by its label. Notes are always printed
 * after the numbered clauses, wherever they sit in the list, so that
 * moving one does not renumber the terms around it.
 */
export function partitionClauses(texts: readonly string[]): { numbered: string[]; notes: string[] } {
  const numbered: string[] = [];
  const notes: string[] = [];
  for (const t of texts) {
    const text = String(t ?? "");
    if (!text.trim()) continue;
    (splitClause(text).label === NOTE_LABEL ? notes : numbered).push(text);
  }
  return { numbered, notes };
}
