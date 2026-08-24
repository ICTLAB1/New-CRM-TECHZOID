import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createStore } from "./store";

/**
 * The write path, driven against a fake client.
 *
 * This is the code that changes records in the customer's real database, and
 * it had no coverage: everything else in the app can be wrong and be noticed,
 * but a bad diff here quietly rewrites or deletes rows nobody asked it to
 * touch. The fake records every operation so the tests can assert exactly
 * what would have been sent.
 */

interface Op {
  table: string;
  kind: "select" | "upsert" | "delete" | "update";
  payload?: Record<string, unknown>;
  match?: Record<string, string>;
}

interface FakeOptions {
  /** Rows returned by a select on each table. */
  rows?: Record<string, unknown[]>;
  /** Tables whose writes fail, with the message returned. */
  failOn?: Record<string, string>;
}

function fakeClient(options: FakeOptions = {}) {
  const ops: Op[] = [];
  const rows = options.rows ?? {};
  const failOn = options.failOn ?? {};

  const result = (table: string, data: unknown) => {
    const message = failOn[table];
    return Promise.resolve(message ? { data: null, error: { message } } : { data, error: null });
  };

  const from = (table: string) => {
    const builder = {
      select(_columns?: string) {
        ops.push({ table, kind: "select" });
        const rowsFor = rows[table] ?? [];
        const chain = {
          eq: () => ({ single: () => result(table, rowsFor[0] ?? null) }),
          order: () => result(table, rowsFor),
          then: (resolve: (v: unknown) => unknown) => result(table, rowsFor).then(resolve),
        };
        return chain;
      },
      upsert(payload: Record<string, unknown>) {
        ops.push({ table, kind: "upsert", payload });
        return result(table, null);
      },
      update(payload: Record<string, unknown>) {
        ops.push({ table, kind: "update", payload });
        return { eq: (col: string, value: string) => {
          const op = ops[ops.length - 1];
          if (op) op.match = { [col]: value };
          return result(table, null);
        } };
      },
      delete() {
        return { eq: (col: string, value: string) => {
          ops.push({ table, kind: "delete", match: { [col]: value } });
          return result(table, null);
        } };
      },
    };
    return builder;
  };

  const client = {
    from,
    channel: () => {
      const channel = { on: () => channel, subscribe: () => channel };
      return channel;
    },
  } as unknown as SupabaseClient;

  return { client, ops };
}

const AT = () => "2026-08-24T00:00:00.000Z";

const customer = (over: Record<string, unknown> = {}) => ({
  id: "c1", ownerId: "u1", company: "Acme", stage: "lead", ...over,
});

describe("writing entities", () => {
  it("writes nothing at all when nothing changed", async () => {
    /* The rule this protects: saving a screen must not rewrite its table.
       Every row written bumps updated_at, and every bump wakes every other
       signed-in browser through realtime. */
    const { client, ops } = fakeClient();
    const rows = [customer(), customer({ id: "c2", company: "Beta" })];
    await createStore(client).syncEntity("customers", rows, [...rows], AT);
    expect(ops).toEqual([]);
  });

  it("writes only the row that changed", async () => {
    const { client, ops } = fakeClient();
    const before = [customer(), customer({ id: "c2", company: "Beta" })];
    const after = [customer({ company: "Acme Industries" }), customer({ id: "c2", company: "Beta" })];
    await createStore(client).syncEntity("customers", before, after, AT);

    expect(ops).toHaveLength(1);
    expect(ops[0]?.kind).toBe("upsert");
    expect(ops[0]?.payload?.id).toBe("c1");
  });

  it("lifts the id and owner out of the record and leaves the rest in data", async () => {
    const { client, ops } = fakeClient();
    await createStore(client).syncEntity("customers", [], [customer()], AT);

    const payload = ops[0]?.payload ?? {};
    expect(payload["id"]).toBe("c1");
    expect(payload["owner_id"]).toBe("u1");
    expect(payload["updated_at"]).toBe("2026-08-24T00:00:00.000Z");
    /* ownerId must not be duplicated inside the blob: the column is the
       one the policies read, and two copies drift. */
    expect(payload["data"]).toEqual({ id: "c1", company: "Acme", stage: "lead" });
  });

  it("promotes the columns Postgres indexes on, per table", async () => {
    const { client, ops } = fakeClient();
    const db = createStore(client);

    await db.syncEntity("quotes", [], [{ id: "q1", ownerId: "u1", customerId: "c1" }], AT);
    expect(ops[0]?.payload?.["customer_id"]).toBe("c1");

    await db.syncEntity("challans", [], [{ id: "d1", ownerId: "u1", orderId: "o1" }], AT);
    expect(ops[1]?.payload?.["order_id"]).toBe("o1");

    await db.syncEntity("orders", [], [{ id: "o1", ownerId: "u1", customerId: "c1", quoteId: "q1" }], AT);
    expect(ops[2]?.payload?.["customer_id"]).toBe("c1");
    expect(ops[2]?.payload?.["quote_id"]).toBe("q1");
  });

  it("writes an empty relation as null rather than an empty string", async () => {
    const { client, ops } = fakeClient();
    await createStore(client).syncEntity("quotes", [], [{ id: "q1", ownerId: "u1", customerId: "" }], AT);
    expect(ops[0]?.payload?.["customer_id"]).toBeNull();
  });

  it("deletes a row that is gone, by id", async () => {
    const { client, ops } = fakeClient();
    await createStore(client).syncEntity("customers", [customer(), customer({ id: "c2" })], [customer()], AT);

    expect(ops).toHaveLength(1);
    expect(ops[0]?.kind).toBe("delete");
    expect(ops[0]?.match).toEqual({ id: "c2" });
  });

  it("adds, changes and removes in one pass", async () => {
    const { client, ops } = fakeClient();
    await createStore(client).syncEntity(
      "customers",
      [customer(), customer({ id: "c2", company: "Beta" })],
      [customer({ company: "Acme Ltd" }), customer({ id: "c3", company: "Gamma" })],
      AT,
    );
    expect(ops.filter((o) => o.kind === "upsert").map((o) => o.payload?.id)).toEqual(["c1", "c3"]);
    expect(ops.filter((o) => o.kind === "delete").map((o) => o.match?.id)).toEqual(["c2"]);
  });

  /* A write the database refuses — row-level security rejecting a record
     that isn't yours — has to reach the caller, which reloads and says so.
     Swallowing it would leave the screen showing something that does not
     exist. */
  it("throws when the database refuses a write", async () => {
    const { client } = fakeClient({ failOn: { customers: "new row violates row-level security policy" } });
    await expect(
      createStore(client).syncEntity("customers", [], [customer()], AT),
    ).rejects.toMatchObject({ message: "new row violates row-level security policy" });
  });
});

describe("writing settings", () => {
  it("does not touch the row when nothing changed", async () => {
    const { client, ops } = fakeClient();
    await createStore(client).syncSettings({ a: 1 }, { a: 1 }, AT);
    expect(ops).toEqual([]);
  });

  it("updates the single settings row, matched by id", async () => {
    const { client, ops } = fakeClient();
    await createStore(client).syncSettings({ a: 1 }, { a: 2 }, AT);

    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      table: "settings",
      kind: "update",
      match: { id: "main" },
    });
    expect(ops[0]?.payload?.["data"]).toEqual({ a: 2 });
  });

  it("throws when only an admin may write and this user is not one", async () => {
    const { client } = fakeClient({ failOn: { settings: "permission denied" } });
    await expect(createStore(client).syncSettings({}, { a: 1 }, AT)).rejects.toMatchObject({
      message: "permission denied",
    });
  });
});

describe("loading", () => {
  const legacy = {
    rows: {
      customers: [{ id: "c1", owner_id: "u1", data: { company: "Acme", stage: "won" } }],
      quotes: [{ id: "q1", owner_id: "u1", data: { number: "TZ/QT/2627/0001", items: null } }],
      proformas: [],
      orders: [],
      challans: [],
      subscriptions: [],
      settings: [{ data: { company: { name: "TechZoid" } } }],
      profiles: [{ id: "u1", name: "Asha", role: "Sales", email: "asha@example.com" }],
    },
  };

  it("fills in the fields legacy records were written without", async () => {
    /* The whole reason normalisation lives on the load path: these rows are
       real, they are in the live database, and every screen reads these
       fields without checking. */
    const { data } = await createStore(fakeClient(legacy).client).load();

    expect(data.customers[0]).toMatchObject({ currency: "INR", taxType: "gst", country: "India" });
    expect(data.quotations[0]).toMatchObject({ currency: "INR", taxType: "gst", billCountry: "India" });
    expect(data.quotations[0]?.items).toEqual([]);
  });

  it("takes the id and owner from the columns, not from the blob", async () => {
    const { client } = fakeClient({
      rows: {
        ...legacy.rows,
        customers: [{ id: "real", owner_id: "real-owner", data: { id: "stale", ownerId: "stale-owner" } }],
      },
    });
    const { data } = await createStore(client).load();
    expect(data.customers[0]).toMatchObject({ id: "real", ownerId: "real-owner" });
  });

  it("maps the quotes table onto what every screen calls quotations", async () => {
    const { data } = await createStore(fakeClient(legacy).client).load();
    expect(data.quotations).toHaveLength(1);
    expect(data.quotations[0]?.number).toBe("TZ/QT/2627/0001");
  });

  it("reads the settings row and the team in the same pass", async () => {
    const loaded = await createStore(fakeClient(legacy).client).load();
    expect(loaded.settings).toEqual({ company: { name: "TechZoid" } });
    expect(loaded.profiles).toHaveLength(1);
  });

  it("returns an empty settings object rather than undefined", async () => {
    const { client } = fakeClient({ rows: { ...legacy.rows, settings: [] } });
    expect((await createStore(client).load()).settings).toEqual({});
  });

  it("surfaces a failed read instead of returning half a workspace", async () => {
    const { client } = fakeClient({ ...legacy, failOn: { customers: "JWT expired" } });
    await expect(createStore(client).load()).rejects.toMatchObject({ message: "JWT expired" });
  });
});
