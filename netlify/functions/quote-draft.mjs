import { fail, guard, json, readJson } from "../lib/http.mjs";
import { adminClient, signedInUser } from "../lib/auth.mjs";
import { consume, tooManyMessage } from "../lib/ratelimit.mjs";
import { readerFailure } from "../lib/invoiceExtract.mjs";
import { MAX_TEXT, QUOTE_TOOL, systemPrompt } from "../lib/quoteExtract.mjs";

/**
 * "Quote ACME 10 x M365 Business Standard at 1,200" -> the fields of a
 * quotation, for the editor to open.
 *
 * Nothing is saved here and no customer is created. This endpoint reads
 * English and returns fields; which customer and which SKU those fields mean
 * is decided in the browser against the catalog, where it is tested.
 *
 * Signed-in only and rate-limited, because every call costs money.
 */

export async function handler(event) {
  const stop = guard(event);
  if (stop) return stop;

  const user = await signedInUser(event);
  if (!user) return fail(event, 403, "Sign in required.");

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return fail(event, 400, "Writing a quotation from text isn't connected yet. An admin can add ANTHROPIC_API_KEY in the Azure Function App settings.");
  }

  const body = readJson(event);
  if (!body) return fail(event, 400, "That request wasn't valid.");

  const text = String(body.text ?? "").trim();
  if (!text) return fail(event, 400, "Say what you want quoted.");
  if (text.length > MAX_TEXT) return fail(event, 413, "That is too long to read at once. Shorten it.");

  try {
    const rl = await consume(adminClient(), "quote-draft", user.id);
    if (!rl.allowed) return fail(event, 429, tooManyMessage(rl.retryAfterSeconds));
  } catch (err) {
    console.error("rate limit unavailable:", err?.message ?? err);
  }

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
        max_tokens: 1500,
        system: systemPrompt(),
        tools: [QUOTE_TOOL],
        tool_choice: { type: "tool", name: QUOTE_TOOL.name },
        messages: [{ role: "user", content: text }],
      }),
    });

    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error("quote draft refused:", resp.status, result?.error?.type, result?.error?.message);
      /* Shared with the invoice reader so a rejected key says so here too,
         rather than telling somebody to try again at something that cannot
         start working on its own. */
      const refusal = readerFailure(resp.status);
      return fail(event, refusal.status, refusal.message);
    }

    const call = (result.content ?? []).find((c) => c?.type === "tool_use" && c?.name === QUOTE_TOOL.name);
    if (!call) return fail(event, 502, "Nothing could be read from that.");

    const fields = call.input ?? {};
    if (fields.is_quote_request === false) {
      return fail(event, 422, "That doesn't read as a request for a quotation.");
    }
    return json(event, 200, { fields });
  } catch (err) {
    return fail(event, 502, "Could not reach the assistant. Try again in a moment.", err?.message);
  }
}
