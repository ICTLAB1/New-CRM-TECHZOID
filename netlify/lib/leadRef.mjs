/**
 * The salesperson a registration link points at.
 *
 * Links take two shapes and both are supported for good:
 *
 *   /r/K7QM2P                     the short code, on everything shared now
 *   /?lead=<uuid>                 what the link used to be
 *
 * The old ones are already in customers' inboxes and WhatsApp threads. A
 * link that stops resolving strands somebody on a dead page with no way to
 * tell anybody about it, so this reads both — and will keep reading both.
 *
 * Mirrors src/domain/leads/link.ts, which the app uses to build and parse
 * the same two shapes. Both are tested.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

/** Which shape this is, without touching the database. */
export function refShape(ref) {
  const value = String(ref ?? "").trim();
  if (UUID.test(value)) return "uuid";
  if (CODE.test(value.toUpperCase())) return "code";
  return "none";
}

/**
 * @returns {Promise<string|null>} the profile id, or null when nothing
 * matches — which is also the answer for a link that was mistyped, so the
 * caller can say "ask for a fresh one" rather than leaking whether an id
 * exists.
 */
export async function resolveRef(admin, ref) {
  const value = String(ref ?? "").trim();
  const shape = refShape(value);
  if (shape === "none") return null;

  const query = shape === "uuid"
    ? admin.from("profiles").select("id").eq("id", value)
    : admin.from("profiles").select("id").eq("lead_code", value.toUpperCase());

  const { data } = await query.maybeSingle();
  return data?.id ?? null;
}
