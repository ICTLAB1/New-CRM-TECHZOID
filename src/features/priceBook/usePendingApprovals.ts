import { useEffect, useState } from "react";
import { pendingApprovalCount } from "../../data/priceBook";

/**
 * How many discount requests are waiting, for the badge beside "Discount
 * approvals".
 *
 * ZERO FOR ANYBODY WHO MAY NOT SEE THEM, without asking who they are: the
 * count comes from a select the database refuses for a salesperson, so it
 * comes back empty and the badge does not appear. There is no role check
 * in this file and there does not need to be one.
 *
 * A badge is for work that is waiting, which this is: every pending
 * request is somebody's quotation that cannot be sent until it is decided.
 *
 * Refetched when the person navigates, which in this CRM is how often
 * anything else refreshes too. No polling: an approvals queue that moves
 * three times a day does not need a timer, and a timer on every open tab
 * is a query per user per interval for ever.
 */
export function usePendingApprovals(company: string | null | undefined, view: string): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    if (!company) {
      setCount(0);
      return;
    }
    void pendingApprovalCount(company).then((n) => {
      if (alive) setCount(n);
    });
    return () => {
      alive = false;
    };
  }, [company, view]);

  return count;
}
