/**
 * Where a customer's deal goes when they answer a quotation themselves.
 *
 * MUST AGREE WITH src/domain/documents/outcome.ts, which is the same rule
 * for the same event pressed from inside the CRM. A customer accepting in
 * the portal and a salesperson pressing Accepted on the row are the same
 * fact arriving by two doors, and the board must not show a different thing
 * depending on which one it came through.
 *
 * ACCEPTING IS NOT A WIN, here as there. A quotation agreed to is a deal in
 * Negotiation; the win is the order, and only somebody inside the company
 * can say the order landed. A CRM whose revenue figure moves because a
 * customer clicked a button in an email is a CRM whose revenue figure is
 * not evidence of anything.
 *
 * DECLINING MOVES NOBODY. "Lost" is a conclusion about the CUSTOMER, and a
 * customer turning down one quotation while two others are open has not
 * been lost — that call belongs to the salesperson, who has the Lost button
 * on the quotation's own row.
 */

/** The open ladder, in the order the board shows it. */
const RANK = { lead: 0, contacted: 1, qualified: 2, quoted: 3, negotiation: 4 };

/**
 * The stage to move to, or null to leave the customer exactly where they
 * are. Never backwards, and never onto or off a concluded deal.
 */
export function stageAfterPortalAnswer(answer, current) {
  /* Case-folded, because the two words come from two different places: the
     endpoint writes the DOCUMENT status ("Accepted"), which is capitalised
     because it is the same vocabulary the status dropdown uses, while the
     stages are lower case. Comparing them as typed is a rule that silently
     does nothing — which is exactly how this was found, by accepting a
     quotation in a browser and watching the board not move. */
  if (String(answer ?? "").trim().toLowerCase() !== "accepted") return null;
  const stage = String(current ?? "");
  if (stage === "won" || stage === "lost") return null;
  const rank = RANK[stage] ?? RANK.lead;
  return rank < RANK.negotiation ? "negotiation" : null;
}
