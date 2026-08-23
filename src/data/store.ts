import { supabase } from "./supabase";
import { ENTITY_EXTRA_COLS, ENTITY_TABLES, rowToItem, type EntityBase, type EntityRow, type EntityTable } from "./entities";

export interface Profile {
  id: string;
  name: string;
  email: string;
  role: "Admin" | "Manager" | "Sales";
}

export async function fetchEntity<T extends EntityBase>(table: EntityTable): Promise<T[]> {
  const { data, error } = await supabase.from(table).select("id, owner_id, data");
  if (error) throw error;
  return ((data as EntityRow[] | null) || []).map((r) => rowToItem<T>(r));
}

export async function fetchSettings(): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.from("settings").select("data").eq("id", "main").single();
  if (error) throw error;
  return (data?.data as Record<string, unknown>) ?? {};
}

export async function fetchProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, role, email")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as Profile[] | null) || [];
}

/**
 * Diff `next` against `prev` by id and issue the minimum set of upserts and
 * deletes needed to bring the table in line.
 *
 * Authorisation is NOT decided here. RLS rejects anything a Sales user may not
 * touch — this function must never be "helpfully" widened to pre-filter on the
 * client, because that turns a database guarantee into a UI convention.
 */
export async function syncEntity<T extends EntityBase>(
  table: EntityTable,
  prev: readonly T[],
  next: readonly T[],
): Promise<void> {
  const prevMap = new Map(prev.map((x) => [x.id, x]));
  const nextMap = new Map(next.map((x) => [x.id, x]));
  const ops: PromiseLike<{ error: unknown }>[] = [];

  for (const [id, item] of nextMap) {
    const prevItem = prevMap.get(id);
    if (!prevItem || JSON.stringify(prevItem) !== JSON.stringify(item)) {
      const { ownerId, ...rest } = item;
      ops.push(
        supabase.from(table).upsert({
          id,
          owner_id: ownerId,
          data: rest,
          updated_at: new Date().toISOString(),
          ...ENTITY_EXTRA_COLS[table](item),
        }),
      );
    }
  }
  for (const id of prevMap.keys()) {
    if (!nextMap.has(id)) ops.push(supabase.from(table).delete().eq("id", id));
  }

  const results = await Promise.all(ops);
  const failed = results.find((r) => r && r.error);
  if (failed) throw failed.error;
}

export async function syncSettings(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): Promise<void> {
  if (JSON.stringify(prev) === JSON.stringify(next)) return;
  const { error } = await supabase
    .from("settings")
    .update({ data: next, updated_at: new Date().toISOString() })
    .eq("id", "main");
  if (error) throw error;
}

/** Live sync: any row change in any of these tables fires `onChange(table)`
 *  so every signed-in screen refetches. Respects RLS automatically. */
export function subscribeAll(onChange: (table: string) => void) {
  const channel = supabase.channel("crm-live-sync");
  [...ENTITY_TABLES, "settings"].forEach((table) => {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, () => onChange(table));
  });
  channel.subscribe();
  return channel;
}
