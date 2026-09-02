import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Every `onConflict` an upsert names must match a real unique index.
 *
 * THE BUG THIS EXISTS TO CATCH, which shipped. Migration 022 wrote the
 * uniqueness rule as an expression index:
 *
 *     create unique index outreach_prospects_email_key
 *       on public.outreach_prospects (lower(email));
 *
 * and the client upserted with `onConflict: "email"`. Postgres matches
 * ON CONFLICT against the target AS WRITTEN, and an index on `lower(email)`
 * does not satisfy `on conflict (email)`, so every one of those writes failed
 * with "there is no unique or exclusion constraint matching the ON CONFLICT
 * specification". Three paths were broken, including the public unsubscribe
 * endpoint — which shows the same page whatever happens, so it failed
 * silently. Nothing in the type system connects a string in TypeScript to an
 * index in SQL, and no test did either. This is that test.
 *
 * It reads the migrations and the source rather than the database, so it runs
 * anywhere and needs no credentials. It is deliberately strict about
 * expressions: a conflict target is a column list, so an index carrying
 * `lower(...)` or any other call cannot satisfy one.
 */

const ROOT = join(__dirname, "..", "..");
const SQL_DIR = join(ROOT, "supabase");

/** Every `.upsert(..., { onConflict: "..." })` in the app and the functions. */
function upsertTargets(): { file: string; table: string; columns: string[] }[] {
  const found: { file: string; table: string; columns: string[] }[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(path);
        continue;
      }
      if (!/\.(ts|tsx|mjs)$/.test(entry.name) || /\.test\./.test(entry.name)) continue;

      const text = readFileSync(path, "utf8");
      if (!text.includes("onConflict")) continue;

      /* The table comes from the .from("…") that precedes the upsert. Taking
         the nearest one before each match is enough here and stays readable;
         a real parser would be more machinery than the problem deserves. */
      for (const m of text.matchAll(/onConflict:\s*"([^"]+)"/g)) {
        const before = text.slice(0, m.index);
        const table = [...before.matchAll(/\.from\(\s*"([^"]+)"\s*\)/g)].pop()?.[1];
        if (!table) continue;
        found.push({
          file: path.slice(ROOT.length + 1),
          table,
          columns: m[1]!.split(",").map((c) => c.trim()).filter(Boolean),
        });
      }
    }
  };

  walk(join(ROOT, "src"));
  walk(join(ROOT, "netlify"));
  return found;
}

/**
 * The unique indexes the migrations leave in place, in order — a later `drop
 * index` then `create unique index` supersedes an earlier one, which is
 * exactly what 028 does to 022.
 */
function uniqueIndexes(): Map<string, string[][]> {
  const byTable = new Map<string, string[][]>();
  const dropped = new Set<string>();
  const named = new Map<string, { table: string; columns: string[] | null }>();

  const files = readdirSync(SQL_DIR)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();

  for (const file of files) {
    const text = readFileSync(join(SQL_DIR, file), "utf8");

    for (const m of text.matchAll(/drop\s+index\s+(?:if\s+exists\s+)?(?:public\.)?([a-z0-9_]+)/gi)) {
      dropped.add(m[1]!.toLowerCase());
    }

    const re = /create\s+unique\s+index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?([a-z0-9_]+)\s+on\s+(?:public\.)?([a-z0-9_]+)\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)/gi;
    for (const m of text.matchAll(re)) {
      const [, name, table, body] = m;
      dropped.delete(name!.toLowerCase());
      /* A body containing a call is an expression index and can satisfy no
         column-list conflict target. Recorded as null so the message can say
         so rather than just "not found". */
      const isExpression = /\w\s*\(/.test(body!);
      named.set(name!.toLowerCase(), {
        table: table!,
        columns: isExpression ? null : body!.split(",").map((c) => c.trim().split(/\s+/)[0]!).filter(Boolean),
      });
    }
  }

  for (const [name, info] of named) {
    if (dropped.has(name) || !info.columns) continue;
    const list = byTable.get(info.table) ?? [];
    list.push(info.columns);
    byTable.set(info.table, list);
  }
  return byTable;
}

describe("every upsert names a conflict target the database can match", () => {
  const targets = upsertTargets();
  const indexes = uniqueIndexes();

  it("finds the upserts to check", () => {
    /* If this drops to zero the walk has broken and every case below would
       pass vacuously. */
    expect(targets.length).toBeGreaterThan(0);
  });

  for (const t of targets) {
    it(`${t.table} (${t.columns.join(", ")}) — ${t.file}`, () => {
      const candidates = indexes.get(t.table) ?? [];
      const match = candidates.some(
        (cols) =>
          cols.length === t.columns.length &&
          cols.every((c, i) => c.toLowerCase() === t.columns[i]!.toLowerCase()),
      );

      expect(
        match,
        `${t.file} upserts into ${t.table} with onConflict "${t.columns.join(",")}", but no ` +
          `plain-column unique index matches it. Unique indexes on that table: ` +
          (candidates.length
            ? candidates.map((c) => `(${c.join(", ")})`).join(", ")
            : "none that are plain columns — an index on lower(email) or any other " +
              "expression cannot satisfy a column-list conflict target, which is the " +
              "bug supabase/028_outreach_email_keys.sql exists to fix"),
      ).toBe(true);
    });
  }
});
