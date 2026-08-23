/** The six per-record tables. Each row is owned by one salesperson
 *  (owner_id); all business fields live in a `data` jsonb column, in the same
 *  camelCase shape the app uses. The schema is NOT being changed. */
export const ENTITY_TABLES = [
  "customers", "quotes", "orders", "challans", "proformas", "subscriptions",
] as const;

export type EntityTable = (typeof ENTITY_TABLES)[number];

/** Every stored record carries at least these. */
export interface EntityBase {
  id: string;
  ownerId: string;
  customerId?: string | null;
  quoteId?: string | null;
  orderId?: string | null;
}

/** Columns promoted out of the jsonb blob into real columns, per table, so
 *  Postgres can index and join on them. Must match the live schema exactly. */
export const ENTITY_EXTRA_COLS: Record<EntityTable, (it: EntityBase) => Record<string, string | null>> = {
  customers: () => ({}),
  quotes: (it) => ({ customer_id: it.customerId || null }),
  orders: (it) => ({ customer_id: it.customerId || null, quote_id: it.quoteId || null }),
  challans: (it) => ({ order_id: it.orderId || null }),
  proformas: (it) => ({ customer_id: it.customerId || null, quote_id: it.quoteId || null }),
  subscriptions: (it) => ({ customer_id: it.customerId || null, order_id: it.orderId || null }),
};

export interface EntityRow {
  id: string;
  owner_id: string;
  data: Record<string, unknown>;
}

export function rowToItem<T extends EntityBase>(row: EntityRow): T {
  return { ...row.data, id: row.id, ownerId: row.owner_id } as T;
}
