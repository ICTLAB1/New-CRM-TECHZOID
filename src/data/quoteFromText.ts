import { fnPath, fnToken } from "./functions";
import type { ExtractedQuote } from "../domain/quotes/fromText";

/**
 * Ask the server to read a quotation out of a sentence.
 *
 * Returns the fields only. What they MEAN — which customer, which SKU — is
 * worked out in src/domain/quotes/fromText.ts against this workspace's own
 * catalog and customer list, not here and not on the server.
 */
export async function readQuoteRequest(
  text: string,
): Promise<{ fields?: ExtractedQuote; error?: string }> {
  try {
    const token = await fnToken();
    const resp = await fetch(fnPath("quote-draft"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ text }),
    });
    const json = (await resp.json().catch(() => ({}))) as { fields?: ExtractedQuote; error?: string };
    if (!resp.ok || !json.fields) return { error: json.error || `Could not read that (${resp.status}).` };
    return { fields: json.fields };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
