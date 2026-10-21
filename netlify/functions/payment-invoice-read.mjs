import { fail, guard, json, readJson } from "../lib/http.mjs";
import { adminClient, signedInUser } from "../lib/auth.mjs";
import { consume, tooManyMessage } from "../lib/ratelimit.mjs";
import {
  ACCEPTED_TYPES, EXTRACT_TOOL, MAX_BASE64, cleanExtraction, readerFailure, systemPrompt,
} from "../lib/invoiceExtract.mjs";

/**
 * Payment Tracker — "Scan / upload invoice".
 *
 * Takes one invoice (PDF or photo) from a signed-in user, asks Claude to read
 * it, and returns the bill fields for the form to prefill. Nothing is saved
 * here and the file is not kept: it goes to the AI and is gone.
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
    return fail(event, 400, "Invoice scanning isn't connected yet. An admin can add ANTHROPIC_API_KEY in the Azure Function App settings.");
  }

  const body = readJson(event);
  if (!body) return fail(event, 400, "That request wasn't valid.");

  const mediaType = String(body.mediaType ?? "").toLowerCase();
  const data = String(body.data ?? "").replace(/^data:[^,]*,/, "");
  if (!ACCEPTED_TYPES.has(mediaType)) return fail(event, 400, "Upload a PDF or a photo (JPG or PNG) of the invoice.");
  if (!data) return fail(event, 400, "The file was empty.");
  if (data.length > MAX_BASE64) return fail(event, 413, "That file is too large. Keep it under 10 MB.");

  try {
    const rl = await consume(adminClient(), "payment-invoice-read", user.id);
    if (!rl.allowed) return fail(event, 429, tooManyMessage(rl.retryAfterSeconds));
  } catch (err) {
    console.error("rate limit unavailable:", err?.message ?? err);
  }

  const sellerNames = Array.isArray(body.sellerNames) ? body.sellerNames.map((s) => String(s).slice(0, 120)).slice(0, 4) : [];
  const fileBlock = mediaType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: mediaType, data } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data } };

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
        max_tokens: 1000,
        system: systemPrompt(sellerNames),
        tools: [EXTRACT_TOOL],
        tool_choice: { type: "tool", name: EXTRACT_TOOL.name },
        messages: [{
          role: "user",
          content: [fileBlock, { type: "text", text: "Read this invoice and record its details." }],
        }],
      }),
    });

    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error("invoice read refused:", resp.status, result?.error?.type, result?.error?.message);
      const refusal = readerFailure(resp.status);
      return fail(event, refusal.status, refusal.message);
    }

    const call = (result.content ?? []).find((c) => c?.type === "tool_use" && c?.name === EXTRACT_TOOL.name);
    if (!call) return fail(event, 502, "Nothing could be read from that file.");

    const fields = cleanExtraction(call.input ?? {});
    if (!fields.isInvoice) return fail(event, 422, "That doesn't look like an invoice.");
    return json(event, 200, { fields });
  } catch (err) {
    return fail(event, 502, "Could not reach the invoice reader. Try again in a moment.", err?.message);
  }
}
