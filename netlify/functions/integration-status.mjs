import { fail, guard, json } from "../lib/http.mjs";
import { signedInUser } from "../lib/auth.mjs";
import { credentialsPresent as verificationConfigured } from "../lib/sandbox.mjs";

/**
 * Which integrations are switched on.
 *
 * Booleans only — whether a key is set, never any part of its value. That is
 * deliberately less than the Microsoft diagnostics endpoint offers: this one
 * answers "is it connected", which is the question people are actually stuck
 * on, and answering it needs nothing sensitive.
 *
 * WHY IT EXISTS. Environment variables live in Netlify and the app has no
 * way to see them, so every integration panel could only ever describe what
 * to do and never whether it had been done. The result was an admin setting
 * a key, seeing no change anywhere, and having no way to tell a key that had
 * not been picked up from a key that was never needed. Two WhatsApp channels
 * with two different variables made that worse: the panel described one of
 * them, and somebody who set up the other could not tell from any screen
 * that they had.
 */
export async function handler(event) {
  const stop = guard(event, "GET", "GET, OPTIONS");
  if (stop) return stop;

  const user = await signedInUser(event);
  if (!user) return fail(event, 403, "Sign in required.", null, "GET, OPTIONS");

  return json(event, 200, {
    /* Free-text "Send now", through a QR-linked provider. */
    whatsappDirect: !!process.env.WHATSAPP_API_TOKEN,
    /* Approved templates for automatic follow-ups, through Interakt. */
    whatsappTemplates: !!process.env.INTERAKT_API_KEY,
    verification: verificationConfigured(),
    email: !!(process.env.SMTP_HOST || process.env.MS_CLIENT_ID),
  }, "GET, OPTIONS");
}
