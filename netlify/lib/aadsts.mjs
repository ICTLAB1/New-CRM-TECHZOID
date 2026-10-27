/**
 * What Microsoft actually said, in words somebody can act on.
 *
 * WHY THIS MOVED HERE. The translation table lived in ms-diagnostics.mjs,
 * which nothing else could reach, so the two places a token is refreshed —
 * sending mail, and reading an inbox — threw Microsoft's reason away and
 * returned one sentence for every failure: "your connection has expired,
 * reconnect it". That sentence is a guess. It happens to be right when the
 * refresh token really has expired, and it is a trap when it has not,
 * because reconnecting cannot fix an expired CLIENT SECRET, an app id that
 * Azure does not recognise, or a tenant mismatch. Somebody following it then
 * reconnects, succeeds at reconnecting, sends again, and gets the same
 * sentence — with nothing anywhere telling them they are in a loop that
 * cannot end.
 *
 * So every refresh failure now answers two questions: what went wrong, and
 * whether reconnecting is the fix.
 */

const AADSTS = {
  AADSTS7000215: "The client secret is wrong. In Azure, copy the secret's VALUE, not its Secret ID — the Value is only shown once, right after you create it.",
  AADSTS700016: "Azure doesn't recognise the application ID. Check MS_CLIENT_ID against the app registration's Application (client) ID.",
  AADSTS50011: "The redirect URI doesn't match. Add exactly this URI to the app registration under Authentication → Web → Redirect URIs.",
  AADSTS900023: "The tenant ID isn't valid. Use the Directory (tenant) ID from the app registration's overview, or leave MS_TENANT_ID unset to use 'common'.",
  AADSTS65001: "Nobody has consented yet. The first person to connect will be asked to approve the permissions.",
  AADSTS7000218: "Azure expected a client secret and didn't get one. Check MS_CLIENT_SECRET is set.",
  AADSTS50020: "That account isn't in this tenant. Either sign in with a work account from your own organisation, or set MS_TENANT_ID to 'common'.",
  /* THE ONE THAT LOOKS EXACTLY LIKE AN EXPIRED CONNECTION AND IS NOT.
     Client secrets expire — commonly after six or twenty-four months — and
     when one does, every mailbox in the company fails to refresh on the same
     day. Told to reconnect, each person reconnects successfully (that part
     needs no secret from them) and still cannot send. */
  AADSTS7000222: "The app's client secret has expired in Azure. Reconnecting a mailbox will not help: create a new client secret on the app registration and put its Value in MS_CLIENT_SECRET.",
  /* Genuinely stale grants — reconnecting is the whole fix. */
  AADSTS700082: "The connection went unused for too long and Microsoft retired it.",
  AADSTS50173: "Microsoft invalidated the connection — usually a password change or a signed-out session.",
  AADSTS50078: "Microsoft asked for a fresh sign-in on this account.",
  AADSTS500133: "The saved connection is too old for Microsoft to accept.",
};

/** The documented cases where signing in again genuinely fixes it. */
const RECONNECT_FIXES = new Set([
  "AADSTS700082", "AADSTS50173", "AADSTS50078", "AADSTS500133", "AADSTS65001",
]);

/** The cases where it cannot, however many times it is tried. */
const RECONNECT_CANNOT = new Set([
  "AADSTS7000215", "AADSTS7000218", "AADSTS7000222", "AADSTS700016", "AADSTS900023",
]);

/** Microsoft's numeric code, from wherever in the payload it turned up. */
export function codeOf(payload) {
  const fromArray = payload?.error_codes?.[0];
  if (fromArray) return "AADSTS" + fromArray;
  const text = String(payload?.error_description ?? payload?.error ?? "");
  return text.match(/AADSTS\d+/)?.[0] ?? null;
}

export function explain(code) {
  if (!code) return null;
  const match = String(code).match(/AADSTS\d+/);
  return match ? (AADSTS[match[0]] ?? null) : null;
}

/**
 * What to tell somebody whose mailbox would not refresh.
 *
 * `reconnect` drives whether the message ends in "reconnect it", so the
 * advice and the diagnosis can never disagree. When Microsoft says nothing
 * recognisable, the answer is the old one — a stale grant is much the most
 * common reason a refresh fails — but it says so as the likely case rather
 * than as a fact, and carries the code so the real reason is one search
 * away instead of being lost in a log nobody reads.
 */
/* The two things that can be done about a failed refresh, written once.
   Each branch below picks one by its `reconnect` value rather than wording
   its own, so the advice can never drift from the diagnosis — a message
   saying "reconnect it" while reconnect is false is precisely the loop this
   module exists to end, and three hand-written sentences is how that gets
   reintroduced. */
const ASK_ADMIN = "Ask an admin to check Settings \u2192 Integrations \u2192 Microsoft 365 diagnostics.";

const answer = (code, reconnect, detail, where) => ({
  code,
  reconnect,
  error: `${detail} ${reconnect ? `Reconnect it in ${where}.` : ASK_ADMIN}`,
});

/**
 * What to tell somebody whose mailbox would not refresh.
 *
 * `reconnect` decides which closing sentence the message gets, so the advice
 * and the diagnosis cannot disagree. When Microsoft says nothing
 * recognisable the answer is the old one — a stale grant is much the most
 * common reason a refresh fails — but it says so as the likely case rather
 * than as a fact, and carries the code so the real reason is one search away
 * instead of being lost in a log nobody reads.
 */
export function refreshFailure(payload, mailbox = {}) {
  const code = codeOf(payload);
  const oauth = String(payload?.error ?? "");
  /* WHICH MAILBOX, and where to go for it. A payment reminder sends from
     the company's accounts@ address, which lives in a different table from
     the sender's own mailbox and is reconnected on a different panel. Told
     only that "your Microsoft 365 connection" had expired, somebody
     reconnects their own — successfully — and the reminder fails exactly as
     before, because the mailbox that failed was never theirs. */
  const subject = mailbox.shared && mailbox.email
    ? `The shared mailbox ${mailbox.email}`
    : mailbox.email
      ? `Your ${mailbox.what ?? "Microsoft 365 connection"} (${mailbox.email})`
      : `Your ${mailbox.what ?? "Microsoft 365 connection"}`;
  const where = mailbox.shared
    ? "Settings \u2192 Integrations \u2192 Shared mailboxes"
    : "Settings \u2192 Integrations";

  /* invalid_client is about the APP's credentials, never the person's, so it
     is never fixed by that person reconnecting — even when Microsoft sends
     no numeric code with it. */
  if ((code && RECONNECT_CANNOT.has(code)) || oauth === "invalid_client") {
    return answer(code, false,
      explain(code) ?? "Microsoft rejected this app's own credentials, so reconnecting will not help.", where);
  }

  if ((code && RECONNECT_FIXES.has(code)) || oauth === "invalid_grant") {
    return answer(code, true, explain(code) ?? `${subject} is no longer valid.`, where);
  }

  return answer(code, true,
    `${subject} could not be renewed${code ? ` (${code})` : ""}.`
    + " This is usually a connection Microsoft has retired; if it comes straight back,"
    + " ask an admin to check the Microsoft 365 diagnostics on that screen.", where);
}
