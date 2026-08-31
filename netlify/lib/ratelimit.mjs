/**
 * Rate limiting.
 *
 * v1 had none. The two public endpoints — submit-lead and public-lead-info —
 * take unauthenticated traffic and write to the database, so they are the
 * ones that need it most; the authenticated ones are limited too, because a
 * stolen token should not be able to empty a mail quota.
 *
 * Counted in Postgres rather than in memory: a serverless function is a
 * fresh process often enough that an in-memory counter limits nothing. The
 * `rate_limits` table and its atomic increment live in
 * supabase/004_rate_limits.sql.
 *
 * FAILURE MODE, chosen deliberately: if the counter itself errors, the
 * request is ALLOWED. A broken limiter must not take the lead form down —
 * losing enquiries is a worse outcome than briefly losing the limit, and the
 * error is logged so it surfaces.
 */

export const LIMITS = {
  "submit-lead": { limit: 5, windowSeconds: 600 },
  "public-lead-info": { limit: 30, windowSeconds: 600 },
  "email-send": { limit: 60, windowSeconds: 3600 },
  "whatsapp-send": { limit: 60, windowSeconds: 3600 },
  "ai-proxy": { limit: 40, windowSeconds: 3600 },
  "ms-oauth-start": { limit: 10, windowSeconds: 3600 },
  "admin-users": { limit: 30, windowSeconds: 3600 },
  "webhook-deliver": { limit: 120, windowSeconds: 3600 },
  /* The portal is the one place a stranger with a URL reads from the
     database, so the limit is on reading, not only on writing: the traffic
     worth stopping is somebody working through guessed tokens. Generous
     enough that a customer refreshing a page and opening three documents
     never meets it. */
  "portal": { limit: 60, windowSeconds: 600 },
  "portal-respond": { limit: 10, windowSeconds: 600 },
  /* Each one is a billed call to a government register. A salesperson
     checks a handful of GSTINs a day; a loop checks a thousand. */
  "verify-tax-id": { limit: 40, windowSeconds: 3600 },
};

/**
 * Consume one unit against `key`.
 *
 * Returns { allowed, remaining, retryAfterSeconds }.
 */
export async function consume(supabaseAdmin, bucket, key, overrides = {}) {
  const config = { ...(LIMITS[bucket] ?? { limit: 30, windowSeconds: 600 }), ...overrides };
  const fullKey = `${bucket}:${key}`;
  try {
    const { data, error } = await supabaseAdmin.rpc("consume_rate_limit", {
      p_key: fullKey,
      p_limit: config.limit,
      p_window_seconds: config.windowSeconds,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return {
      allowed: !!row?.allowed,
      remaining: Number(row?.remaining ?? 0),
      retryAfterSeconds: Number(row?.retry_after_seconds ?? config.windowSeconds),
    };
  } catch (err) {
    /* Fail open, loudly. */
    console.error("rate limit check failed, allowing request:", err?.message ?? err);
    return { allowed: true, remaining: config.limit, retryAfterSeconds: 0, degraded: true };
  }
}

/** Human phrasing for a limit that has been hit. */
export function tooManyMessage(retryAfterSeconds) {
  const minutes = Math.ceil((retryAfterSeconds || 60) / 60);
  return `Too many requests. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}
