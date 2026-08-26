/**
 * The registration link a salesperson shares.
 *
 * TWO SHAPES, ONE OF THEM PERMANENT. New links are short:
 *
 *   https://crm.ttpldelhi.com/r/K7QM2P
 *
 * The old ones carried the salesperson's uuid as a query string, and those
 * must keep working for good. They are sitting in customers' inboxes and in
 * WhatsApp threads; a link that stops resolving means somebody meets a dead
 * page and has no way to tell anyone about it. Both forms are read here, and
 * both are resolved by the public endpoints.
 */

/** No 0/O and no 1/I/L. This gets read down a phone line and typed by
 *  somebody who has never seen it, and those are the pairs that go wrong. */
export const LEAD_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const LEAD_CODE_LENGTH = 6;

const CODE = new RegExp(`^[${LEAD_CODE_ALPHABET}]{${LEAD_CODE_LENGTH}}$`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isLeadCode = (value: string): boolean => CODE.test(value.trim().toUpperCase());
export const isLeadUuid = (value: string): boolean => UUID.test(value.trim());

/**
 * The reference in a URL, from either shape, or "" when there is none.
 *
 * Typed by hand as often as it is clicked — somebody reads the code off a
 * card — so it is forgiving about case and about a trailing slash.
 */
export function readLeadRef(url: { pathname: string; search: string }): string {
  const legacy = new URLSearchParams(url.search).get("lead");
  if (legacy && isLeadUuid(legacy)) return legacy.trim();
  if (legacy && isLeadCode(legacy)) return legacy.trim().toUpperCase();

  const match = /^\/r\/([^/?#]+)\/?$/.exec(url.pathname);
  if (!match) return "";
  const code = decodeURIComponent(match[1] ?? "").trim().toUpperCase();
  return isLeadCode(code) ? code : "";
}

/** The link to share. Falls back to the long form when no code has been
 *  minted yet — a working long link beats a short one that 404s. */
export function leadLink(origin: string, code: string, userId: string): string {
  const base = origin.replace(/\/+$/, "");
  return isLeadCode(code) ? `${base}/r/${code.trim().toUpperCase()}` : `${base}/?lead=${userId}`;
}
