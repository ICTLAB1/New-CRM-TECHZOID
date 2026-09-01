/**
 * DNS over HTTPS, and the fiddly business of reading the answers.
 *
 * WHY NOT NODE'S `dns` MODULE. A serverless function's resolver is whatever
 * the platform hands it, often a cache with its own opinions and its own TTL
 * behaviour. An answer from a named public resolver is one an administrator
 * can reproduce from their own machine, which matters when the screen says
 * "your DKIM is missing" and somebody disagrees.
 *
 * TWO RESOLVERS, tried in order. A domain-health page that goes blank
 * because one provider is having an afternoon is a page people stop
 * trusting; the second one costs nothing until the first fails.
 */

export const RESOLVERS = [
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/resolve",
];

/**
 * A TXT record arrives QUOTED, and one longer than 255 bytes arrives as
 * several quoted strings that must be joined with NOTHING between them.
 * That is exactly the shape of a long SPF include list or a DKIM public key,
 * so joining with a space — the obvious thing — corrupts precisely the
 * records this feature exists to read.
 */
export function unquoteTxt(data) {
  const raw = String(data ?? "");
  const parts = raw.match(/"([^"]*)"/g);
  return parts ? parts.map((s) => s.slice(1, -1)).join("") : raw;
}

/** An MX answer is `10 mail.example.com.` — the priority and the trailing
 *  dot are noise to everything downstream. */
export function mxHost(data) {
  return String(data ?? "").replace(/^\d+\s+/, "").replace(/\.$/, "").trim();
}

/** A CNAME answer keeps its trailing dot too. */
export const cnameTarget = (data) =>
  data ? String(data).replace(/\.$/, "").trim() : null;

export const DOMAIN_RE =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

/**
 * Answers of one type for one name, or [] when there are none.
 *
 * NXDOMAIN and "no records of this type" both mean the same thing to every
 * caller here — nothing published — so both come back as an empty array
 * rather than an error. A missing DKIM selector is an ANSWER, not a fault.
 */
export async function resolve(name, type, fetchImpl = fetch) {
  let lastError = null;
  for (const base of RESOLVERS) {
    try {
      const url = `${base}?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;
      const resp = await fetchImpl(url, { headers: { accept: "application/dns-json" } });
      if (!resp.ok) { lastError = new Error(`resolver ${resp.status}`); continue; }
      const body = await resp.json();
      return Array.isArray(body?.Answer) ? body.Answer : [];
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error("No resolver answered.");
}
