import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";
import { ENTITY_EXTRA_COLS, ENTITY_TABLES, rowToItem, type EntityBase, type EntityRow, type EntityTable } from "./entities";
import { normalizeCustomer, normalizeDocument } from "./normalize";
import { OBJ_TYPE, type ObjType } from "../domain/documents/objType";
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
  /** Their own mobile, printed the same way. The company number in Settings
   *  is the fallback for anyone who has not set one. */
  phone?: string;
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

/**
 * @param companyId Which company's records this store reads and writes.
 *
 * WHY THE CLIENT FILTERS AS WELL AS THE DATABASE. Row-level security already
 * limits every read to companies this person belongs to — but somebody who
 * belongs to TWO would then get both companies' customers in one list, which
 * is not a security failure, it is a nonsense screen. RLS decides what may
 * be seen; this decides what is being looked at. Both are needed, and the
 * one that must never be relied on alone is this one.
 */
export function createStore(client: SupabaseClient, companyId: () => string | null = () => null) {

  async function fetchEntity<T extends EntityBase>(table: EntityTable): Promise<T[]> {
    /* Narrowed to the company on screen when there is one. A workspace that
       has not run migration 033 has no company column, so no filter is
       applied and everything behaves exactly as it did before. */
    const id = companyId();
    const query = client.from(table).select("id, owner_id, data");
    const { data, error } = await (id ? query.eq("company_id", id) : query);
    if (error) throw error;
    return ((data as EntityRow[] | null) || []).map((r) => rowToItem<T>(r));
  }

  /**
   * The settings of the company on screen.
   *
   * Each company has its own row: its own name, GSTIN, logo, bank details,
   * document prefixes and terms. Carrying one set across two businesses is
   * how a second company ends up invoicing under the first one's tax number.
   *
   * `maybeSingle`, not `single`: a company whose settings row has not been
   * created yet is an empty workspace to fill in, not an error that stops
   * the CRM loading.
   */
  async function fetchSettings(): Promise<Record<string, unknown>> {
    const id = companyId();
    const query = client.from("settings").select("data");
    const { data, error } = id
      ? await query.eq("company_id", id).maybeSingle()
      : await query.eq("id", "main").maybeSingle();
    if (error) throw error;
    return ((data as { data?: Record<string, unknown> } | null)?.data) ?? {};
  }

  async function fetchProfiles(): Promise<Profile[]> {
    const { data, error } = await client
      .from("profiles")
      .select("id, name, role, email, designation, phone")
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
    /* Curried by type, because the type is the one thing the record itself
       may not know — see the note on normalizeDocument. */
    const asDoc = (objType: ObjType) => <T,>(d: T): T =>
      normalizeDocument(d as unknown as Record<string, unknown>, objType) as unknown as T;

    return {
      data: {
        customers: customers.map(asCustomer),
        quotations: quotations.map(asDoc(OBJ_TYPE.quotation)),
        proformas: proformas.map(asDoc(OBJ_TYPE.proforma)),
        purchaseOrders: purchaseOrders.map(asDoc(OBJ_TYPE.purchase_order)),
        invoices: invoices.map(asDoc(OBJ_TYPE.invoice)),
        orders: orders.map(asDoc(OBJ_TYPE.order)),
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
          /* Stamped on every write. The column has a database default that
             resolves to the writer's own company, which keeps an older
             deployment working — but a browser that KNOWS which company it
             is in must say so, or somebody who belongs to two would file
             the second company's work under the first. */
          ...(companyId() ? { company_id: companyId() } : {}),
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
    const id = companyId();
    const write = client.from("settings").update({ data: next, updated_at: now() });
    const { error } = id ? await write.eq("company_id", id) : await write.eq("id", "main");
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
/**
 * The company every screen is currently looking at.
 *
 * A module-level value rather than a parameter threaded through fifty call
 * sites: the store is a singleton and the company changes rarely. Set by the
 * app shell when somebody switches; read on every query.
 *
 * It is a VIEW, not a permission. Setting it to a company you do not belong
 * to gets you an empty workspace, because the database refuses the rows —
 * see the note in src/data/companies.ts.
 */
let activeCompanyId: string | null = null;

export function setActiveCompanyId(id: string | null): void {
  activeCompanyId = id;
}

export function getActiveCompanyId(): string | null {
  return activeCompanyId;
}

let live: Store | null = null;
export function store(): Store {
  if (!live) live = createStore(getSupabase(), () => activeCompanyId);
  return live;
}
