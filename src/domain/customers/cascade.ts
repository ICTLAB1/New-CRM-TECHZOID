/**
 * Reassigning a customer moves everything already tied to them.
 *
 * Row-level security scopes a salesperson to the records they own. Handing
 * over a customer without moving their quotations, proformas, orders,
 * challans and subscriptions leaves the new owner able to see the account and
 * nothing that happened on it — which reads as data loss, not as a handover.
 *
 * Challans hang off orders rather than customers, so they follow the orders
 * that moved rather than being matched on customer directly.
 */

export interface OwnedRecord {
  id: string;
  ownerId: string;
  customerId?: string | null;
  orderId?: string | null;
}

export interface Workspace {
  quotes: OwnedRecord[];
  proformas: OwnedRecord[];
  orders: OwnedRecord[];
  challans: OwnedRecord[];
  subscriptions: OwnedRecord[];
}

export interface CascadeResult<T extends Workspace> {
  workspace: T;
  /** How many related records moved. Reported to the user — a silent
   *  handover of forty records is worse than a noisy one. */
  moved: number;
}

export function cascadeReassign<T extends Workspace>(
  workspace: T,
  customerId: string,
  newOwnerId: string,
): CascadeResult<T> {
  let moved = 0;
  const movedOrderIds = new Set<string>();

  const byCustomer = (list: OwnedRecord[]): OwnedRecord[] =>
    list.map((x) => {
      if (x.customerId !== customerId) return x;
      moved++;
      return { ...x, ownerId: newOwnerId };
    });

  const quotes = byCustomer(workspace.quotes);
  const proformas = byCustomer(workspace.proformas);
  const subscriptions = byCustomer(workspace.subscriptions);

  const orders = workspace.orders.map((x) => {
    if (x.customerId !== customerId) return x;
    movedOrderIds.add(x.id);
    moved++;
    return { ...x, ownerId: newOwnerId };
  });

  const challans = workspace.challans.map((x) => {
    if (!x.orderId || !movedOrderIds.has(x.orderId)) return x;
    moved++;
    return { ...x, ownerId: newOwnerId };
  });

  return {
    workspace: { ...workspace, quotes, proformas, orders, challans, subscriptions },
    moved,
  };
}
