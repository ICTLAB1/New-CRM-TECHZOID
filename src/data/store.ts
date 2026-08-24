import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";
import { ENTITY_EXTRA_COLS, ENTITY_TABLES, rowToItem, type EntityBase, type EntityRow, type EntityTable } from "./entities";
import { normalizeCustomer, normalizeDocument } from "./normalize";
import type { Customer } from "../domain/customers/customer";
import type { SalesDocument } from "../domain/documents/create";
import type { SalesOrder, DeliveryChallan } from "../domain/orders/create";
import type { Subscription } from "../domain/subscriptions/expiry";

/**
 * Everything that reads or writes the database.
 *
 * Built around a client rather than reaching for one, so the write path — the
 * code that changes a customer's records — can be tested without a database
 * behind it. `store` is the instance the app uses; `createStore` is what the
 * tests drive.
 */

export interface Profile {
  id: string;
  name: string;
  email: string;
  role: string;
  /** Their own job title, printed under their name on email they send.
   *  Not the company's authorised signatory — that stays in settings. */
  designation?: string;
}

export interface WorkspaceData {
  customers: Customer[];
  quotations: SalesDocument[];
  proformas: SalesDocument[];
  /** What the company BUYS, from suppliers. Its own table, not a flag on
   *  quotations: the two face opposite directions, and mixing them would
   *  count money owed as money owed to us on every report. */
  purchaseOrders: SalesDocument[];
  /** Tax invoices. What is PAID is never a field here — it is derived from
   *  each invoice's payment ledger, so a status cannot disagree with the
   *  money. */
  invoices: SalesDocument[];
  orders: SalesOrder[];
  challans: DeliveryChallan[];
  subscriptions: Subscription[];
}

/** App-side name to database table. The table is called `quotes`; every
 *  screen calls them quotations. */
export const TABLE_OF: Record<keyof WorkspaceData, EntityTable> = {
  customers: "customers",
  quotations: "quotes",
  proformas: "proformas",
  purchaseOrders: "purchase_orders",
  invoices: "invoices",
  orders: "orders",
  challans: "challans",
  subscriptions: "subscriptions",
};

export interface LoadedWorkspace {
  data: WorkspaceData;
  settings: Record<string, unknown>;
  profiles: Profile[];
}

export function createStore(client: SupabaseClient) {
  async function fetchEntity<T extends EntityBase>(table: EntityTable): Promise<T[]> {
    const { data, error } = await client.from(table).select("id, owner_id, data");
    if (error) throw error;
    return ((data as EntityRow[] | null) || []).map((r) => rowToItem<T>(r));
  }

  async function fetchSettings(): Promise<Record<string, unknown>> {
    const { data, error } = await client.from("settings").select("data").eq("id", "main").single();
    if (error) throw error;
    return ((data as { data?: Record<string, unknown> } | null)?.data) ?? {};
  }

  async function fetchProfiles(): Promise<Profile[]> {
    const { data, error } = await client
      .from("profiles")
      .select("id, name, role, email, designation")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data as Profile[] | null) || [];
  }

  /**
   * Everything, in one round of parallel reads, normalised as it arrives.
   *
   * NORMALISATION HAPPENS HERE AND NOWHERE ELSE. The live database holds
   * documents written before `currency`, `taxType` and `billCountry` existed;
   * filling them in on the way in is what lets every screen read a field
   * without first asking whether it is there.
   */
  async function load(): Promise<LoadedWorkspace> {
    const [customers, quotations, proformas, purchaseOrders, invoices, orders, challans, subscriptions, settings, profiles] =
      await Promise.all([
        fetchEntity<Customer>("customers"),
        fetchEntity<SalesDocument>("quotes"),
        fetchEntity<SalesDocument>("proformas"),
        fetchEntity<SalesDocument>("purchase_orders"),
        fetchEntity<SalesDocument>("invoices"),
        fetchEntity<SalesOrder>("orders"),
        fetchEntity<DeliveryChallan>("challans"),
        fetchEntity<Subscription>("subscriptions"),
        fetchSettings(),
        fetchProfiles(),
      ]);

    const asCustomer = (c: Customer): Customer =>
      normalizeCustomer(c as unknown as Record<string, unknown>) as unknown as Customer;
    const asDoc = <T,>(d: T): T =>
      normalizeDocument(d as unknown as Record<string, unknown>) as unknown as T;

    return {
      data: {
        customers: customers.map(asCustomer),
        quotations: quotations.map(asDoc),
        proformas: proformas.map(asDoc),
        purchaseOrders: purchaseOrders.map(asDoc),
        invoices: invoices.map(asDoc),
        orders: orders.map(asDoc),
        challans,
        subscriptions,
      },
      settings,
      profiles,
    };
  }

  /**
   * Diff `next` against `prev` by id and issue the minimum set of upserts and
   * deletes needed to bring the table in line.
   *
   * Authorisation is NOT decided here. RLS rejects anything a Sales user may
   * not touch — this must never be "helpfully" widened to pre-filter on the
   * client, because that turns a database guarantee into a UI convention.
   */
  async function syncEntity<T extends EntityBase>(
    table: EntityTable,
    prev: readonly T[],
    next: readonly T[],
    now: () => string = () => new Date().toISOString(),
  ): Promise<void> {
    const prevMap = new Map(prev.map((x) => [x.id, x]));
    const nextMap = new Map(next.map((x) => [x.id, x]));
    const ops: PromiseLike<{ error: unknown }>[] = [];

    for (const [id, item] of nextMap) {
      const prevItem = prevMap.get(id);
      /* An unchanged row is not rewritten. Saving a customer must not rewrite
         the whole table: every touched row bumps updated_at, and every bumped
         row wakes every other signed-in browser through realtime. */
      if (prevItem && JSON.stringify(prevItem) === JSON.stringify(item)) continue;
      const { ownerId, ...rest } = item;
      ops.push(
        client.from(table).upsert({
          id,
          owner_id: ownerId,
          data: rest,
          updated_at: now(),
          ...ENTITY_EXTRA_COLS[table](item),
        }) as unknown as PromiseLike<{ error: unknown }>,
      );
    }
    for (const id of prevMap.keys()) {
      if (!nextMap.has(id)) {
        ops.push(client.from(table).delete().eq("id", id) as unknown as PromiseLike<{ error: unknown }>);
      }
    }

    const results = await Promise.all(ops);
    const failed = results.find((r) => r && r.error);
    if (failed) throw failed.error;
  }

  async function syncSettings(
    prev: Record<string, unknown>,
    next: Record<string, unknown>,
    now: () => string = () => new Date().toISOString(),
  ): Promise<void> {
    if (JSON.stringify(prev) === JSON.stringify(next)) return;
    const { error } = await client
      .from("settings")
      .update({ data: next, updated_at: now() })
      .eq("id", "main");
    if (error) throw error;
  }

  /** Live sync: any row change in any of these tables fires `onChange(table)`
   *  so every signed-in screen refetches. Respects RLS automatically. */
  function subscribeAll(onChange: (table: string) => void) {
    const channel = client.channel("crm-live-sync");
    [...ENTITY_TABLES, "settings"].forEach((table) => {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table } as never,
        () => onChange(table),
      );
    });
    channel.subscribe();
    return channel;
  }

  return { fetchEntity, fetchSettings, fetchProfiles, load, syncEntity, syncSettings, subscribeAll };
}

export type Store = ReturnType<typeof createStore>;

/** The app's store, bound to the live client on first use. */
let live: Store | null = null;
export function store(): Store {
  if (!live) live = createStore(getSupabase());
  return live;
}
