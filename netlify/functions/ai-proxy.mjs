import { fail, guard, json, readJson } from "../lib/http.mjs";
import { adminClient, signedInUser } from "../lib/auth.mjs";
import { consume, tooManyMessage } from "../lib/ratelimit.mjs";

/**
 * The AI assistant's proxy.
 *
 * THIS ENDPOINT REQUIRES A SIGNED-IN USER. It shipped in v1 without one while
 * calling a paid API, so anyone who guessed the URL could run up the bill.
 * The sign-in check and the rate limit below are the whole point of this
 * function existing rather than the browser calling the provider directly.
 */

const MAX_MESSAGES = 40;
const MAX_CHARS = 24_000;

export async function handler(event) {
  const stop = guard(event);
  if (stop) return stop;

  const user = await signedInUser(event);
  if (!user) return fail(event, 403, "Sign in required.");

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return fail(event, 400, "The assistant isn't connected yet. An admin can add ANTHROPIC_API_KEY in the Netlify environment variables.");
  }

  const body = readJson(event);
  if (!body) return fail(event, 400, "That request wasn't valid JSON.");

  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages?.length) return fail(event, 400, "No question was sent.");
  if (messages.length > MAX_MESSAGES) return fail(event, 400, "That conversation is too long. Start a new one.");

  const total = messages.reduce((a, m) => a + String(m?.content ?? "").length, 0);
  if (total > MAX_CHARS) return fail(event, 400, "That conversation is too long to send. Start a new one.");

  const clean = messages.map((m) => ({
    role: m?.role === "assistant" ? "assistant" : "user",
    content: String(m?.content ?? "").slice(0, MAX_CHARS),
  }));

  try {
    const rl = await consume(adminClient(), "ai-proxy", user.id);
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
        /* Pinned on the server. v1 took the model from the request body,
           which let a caller ask for the most expensive one available. */
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
        max_tokens: 1200,
        system: String(body.system ?? "").slice(0, 8000),
        messages: clean,
      }),
    });

    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error("ai provider refused:", resp.status, result?.error?.type);
      return fail(event, 400, "The assistant couldn't answer that. Try rephrasing, or try again shortly.");
    }

    const text = (result.content ?? []).map((c) => c?.text ?? "").join("").trim();
    return json(event, 200, { text });
  } catch (err) {
    return fail(event, 502, "Could not reach the assistant. Try again in a moment.", err?.message);
  }
}
