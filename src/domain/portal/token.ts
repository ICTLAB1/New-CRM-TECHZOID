/**
 * The secret in a portal link, and the link itself.
 *
 * MINTED IN THE BROWSER, on purpose. The obvious design has a server generate
 * the token and hand it back, and it is worse in a way that is easy to miss:
 * the plaintext then exists in a response body, which means it exists in
 * whatever logs, proxies and error reporters sit between the two — and a
 * portal token in a log is a portal token somebody can use. Generated here,
 * the secret exists in exactly two places for its whole life: the salesperson's
 * clipboard, and the customer's inbox. What goes to the database is its
 * SHA-256, which is useless to anybody who steals it.
 */

const TOKEN_BYTES = 32;

/** Matches netlify/lib/portalToken.mjs. If those two disagree about the
 *  alphabet or the length, every link fails at once — which is the right way
 *  for a disagreement between them to show up. */
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

export const looksLikeToken = (value: string): boolean => TOKEN_RE.test(value ?? "");

/** 32 bytes from the platform CSPRNG, url-safe base64, no padding: 43
 *  characters, 256 bits. Not a uuid — a v4 uuid carries 122 bits and reads
 *  like an identifier rather than a secret, and this is a secret. */
export function newPortalToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SHA-256, lowercase hex — the exact value the database column expects and
 *  the server recomputes on every request. */
export async function hashPortalToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Whether this URL is a portal link AT ALL, valid or not.
 *
 * Deliberately separate from whether the token is any good, and the
 * separation is the whole point. A mail client that wraps a long URL across
 * two lines — which they do constantly — delivers a truncated `?portal=Xk3p_Q`
 * to somebody who then needs to be told to ask for a fresh link. Routing on
 * validity instead of presence sent that person to a SIGN-IN SCREEN for a CRM
 * they have no account for, which is precisely the thing the public routes
 * exist to prevent. Found by opening a broken link and looking at it.
 *
 * So: presence decides the route, and the page decides what to say.
 */
export const isPortalUrl = (url: { search: string }): boolean =>
  new URLSearchParams(url.search).has("portal");

/** The token out of a URL, or "" when there isn't a usable one. A malformed
 *  token never becomes a network request — the page says "ask for a fresh
 *  link" without asking the server about a string that cannot be one. */
export function readPortalToken(url: { search: string }): string {
  const value = (new URLSearchParams(url.search).get("portal") ?? "").trim();
  return looksLikeToken(value) ? value : "";
}

export function portalLink(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/?portal=${token}`;
}

/** How long a new link lasts unless somebody chooses otherwise. Thirty days
 *  covers the life of a quotation and its follow-ups; a link that outlives the
 *  deal it was issued for is a credential nobody is thinking about any more. */
export const DEFAULT_PORTAL_DAYS = 30;
export const PORTAL_DURATIONS = [7, 30, 90, 365] as const;

export interface PortalTokenRow {
  id: string;
  customerId: string;
  label: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  viewCount: number;
}

export type PortalLinkState = "live" | "revoked" | "expired";

export function linkState(row: Pick<PortalTokenRow, "revokedAt" | "expiresAt">, now = Date.now()): PortalLinkState {
  if (row.revokedAt) return "revoked";
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= now) return "expired";
  return "live";
}
