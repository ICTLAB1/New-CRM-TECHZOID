/**
 * The replacement for PostgREST.
 *
 * WHAT SUPABASE WAS ACTUALLY GIVING US. Not a database — Azure sells that too.
 * It was PostgREST: a process that turned `?select=id&company_id=eq.x` into
 * SQL, ran it as the signed-in user, and let the 89 row-level-security
 * policies decide what came back. Azure has no equivalent, so leaving
 * Supabase means writing that translator. This is it, cut down to the twelve
 * builder methods the CRM actually uses rather than the whole of PostgREST.
 *
 * THE SECURITY MODEL, AND WHY IT IS NOT "TRUST THE CALLER". This endpoint
 * accepts a query description from a browser. That is only safe because of
 * two separate walls, and neither is allowed to be the only one:
 *
 *   1. NOTHING FROM THE CALLER IS EVER INTERPOLATED INTO SQL. Values become
 *      bind parameters. Identifiers — table, column, operator, direction —
 *      are not escaped, they are CHECKED AGAINST THE LIVE CATALOG and the
 *      quoted form of the catalog's own spelling is emitted. A column name
 *      that does not exist never reaches the database in any form. There is
 *      no path in this file where caller text becomes SQL text.
 *
 *   2. ROW-LEVEL SECURITY DECIDES WHO SEES WHAT. This file deliberately does
 *      NOT decide authorisation. It runs inside `asUser`/`asAnon` from db.mjs,
 *      which stamps the caller's identity with SET LOCAL, and the policies
 *      already in the database do the judging — the same policies, unchanged,
 *      that Supabase was enforcing. A caller asking for another company's
 *      rows gets a valid query that returns nothing.
 *
 * So the worst a hostile caller can do is compose a well-formed query over
 * tables they are allowed to read. That is the same power they had when the
 * anon key was in their browser, which is to say: the power RLS grants them.
 */

/* ── the catalog ─────────────────────────────────────────────────────────
   Read from pg_catalog rather than information_schema on purpose:
   information_schema hides columns the current role lacks privileges on, so
   the whitelist would change shape depending on who asked — and a whitelist
   that varies by caller is a whitelist with holes in it. */

const CATALOG_SQL = `
  select c.relname  as table_name,
         a.attname  as column_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
   where n.nspname = 'public'
     and c.relkind in ('r','v','m','p')
     and a.attnum > 0
     and not a.attisdropped
`;

const PK_SQL = `
  select c.relname as table_name,
         (select array_agg(a.attname::text order by k.ord)
            from unnest(i.indkey) with ordinality k(att, ord)
            join pg_attribute a on a.attrelid = c.oid and a.attnum = k.att) as cols
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
   where i.indisprimary and n.nspname = 'public'
`;

const FK_SQL = `
  select con.conrelid::regclass::text  as from_table,
         con.confrelid::regclass::text as to_table,
         (select array_agg(a.attname::text order by k.ord)
            from unnest(con.conkey) with ordinality k(att, ord)
            join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.att) as from_cols,
         (select array_agg(a.attname::text order by k.ord)
            from unnest(con.confkey) with ordinality k(att, ord)
            join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.att) as to_cols
    from pg_constraint con
    join pg_namespace n on n.oid = con.connamespace
   where con.contype = 'f' and n.nspname = 'public'
`;

let catalogPromise = null;

/** Drop the memoised catalog. For tests, and after a migration. */
export function forgetCatalog() {
  catalogPromise = null;
}

/**
 * The shape of the database, read once per process.
 *
 * Memoised on the PROMISE, not the result, so twenty concurrent first
 * requests issue one round of catalog queries between them rather than
 * twenty. A failure clears the memo so the next request retries instead of
 * inheriting the error for the lifetime of the function host.
 */
export async function getCatalog(client) {
  if (catalogPromise) return catalogPromise;
  catalogPromise = (async () => {
    /* Sequential, not Promise.all: a pg client runs one query at a time,
       and overlapping them on the same connection is deprecated behaviour
       that pg 9 removes. This happens once per process, so the round trips
       are not worth a bug. */
    const cols = await client.query(CATALOG_SQL);
    const pks = await client.query(PK_SQL);
    const fks = await client.query(FK_SQL);

    const tables = new Map();
    for (const r of cols.rows) {
      if (!tables.has(r.table_name)) tables.set(r.table_name, new Set());
      tables.get(r.table_name).add(r.column_name);
    }

    const primaryKeys = new Map();
    for (const r of pks.rows) primaryKeys.set(r.table_name, r.cols ?? []);

    /* Keyed by "from>to". A pair with more than one foreign key between them
       is recorded as ambiguous rather than guessed at: an embed that picked
       the wrong one would join real rows to the wrong parents and look
       entirely plausible on screen. */
    const foreignKeys = new Map();
    for (const r of fks.rows) {
      const from = stripSchema(r.from_table);
      const to = stripSchema(r.to_table);
      const key = `${from}>${to}`;
      if (foreignKeys.has(key)) foreignKeys.set(key, "ambiguous");
      else foreignKeys.set(key, { fromCols: r.from_cols, toCols: r.to_cols });
    }

    return { tables, primaryKeys, foreignKeys };
  })().catch((err) => {
    catalogPromise = null;
    throw err;
  });
  return catalogPromise;
}

const stripSchema = (name) => String(name).replace(/^public\./, "").replace(/"/g, "");

/* ── errors ──────────────────────────────────────────────────────────────
   A rejected query is a 400 with a message the browser can read. It never
   echoes the offending text back verbatim: an error page is not a place to
   reflect caller input. */

export class QueryError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "QueryError";
    this.status = status;
  }
}

/* ── identifiers ─────────────────────────────────────────────────────────
   The whole safety argument rests on these three functions. Each one looks
   its argument up and emits the CATALOG'S copy of the string, never the
   caller's. Double-quoting is belt and braces for a legitimately odd column
   name, not the defence. */

function quote(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function checkTable(catalog, name) {
  if (typeof name !== "string" || !catalog.tables.has(name)) {
    throw new QueryError("Unknown table.");
  }
  /* Return the key as the catalog spells it. */
  for (const key of catalog.tables.keys()) if (key === name) return key;
  throw new QueryError("Unknown table.");
}

function checkColumn(catalog, table, name) {
  const cols = catalog.tables.get(table);
  if (typeof name !== "string" || !cols || !cols.has(name)) {
    throw new QueryError(`Unknown column on ${table}.`);
  }
  for (const key of cols) if (key === name) return key;
  throw new QueryError(`Unknown column on ${table}.`);
}

/* ── operators ───────────────────────────────────────────────────────────
   A closed map. Anything not on it is not an operator, so no caller string
   ever becomes an operator. */

const OPERATORS = {
  eq: "=",
  neq: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  like: "like",
  ilike: "ilike",
};

/* ── the select list ─────────────────────────────────────────────────────
   Supports plain columns, `*`, and the one embed shape the CRM uses:
   `other_table!inner(a, b)` for a many-to-one foreign key on the queried
   table. Nothing else — PostgREST's fuller embed grammar is not implemented,
   and an unsupported form is refused rather than half-understood. */

function parseSelect(select) {
  if (select == null || select === "") return [{ kind: "all" }];
  if (typeof select !== "string") throw new QueryError("Malformed select.");

  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of select) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (depth < 0) throw new QueryError("Malformed select.");
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (depth !== 0) throw new QueryError("Malformed select.");
  parts.push(current);

  return parts
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((piece) => {
      const embed = /^([A-Za-z_][A-Za-z0-9_]*)(!inner|!left)?\s*\((.*)\)$/s.exec(piece);
      if (embed) {
        return {
          kind: "embed",
          table: embed[1],
          inner: embed[2] === "!inner",
          columns: embed[3].split(",").map((c) => c.trim()).filter(Boolean),
        };
      }
      if (piece === "*") return { kind: "all" };
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(piece)) return { kind: "column", name: piece };
      throw new QueryError("Malformed select.");
    });
}

/**
 * Build the select list, and the joins any embeds need.
 *
 * An embedded table is nested with `to_jsonb`, which reproduces the object
 * shape PostgREST returned — both call sites in the CRM already cope with
 * either an object or an array there, so the object form needs no change on
 * the browser side.
 */
function buildSelectList(catalog, table, parsed, params) {
  const pieces = [];
  const joins = [];

  for (const item of parsed) {
    if (item.kind === "all") {
      pieces.push(`${quote(table)}.*`);
      continue;
    }
    if (item.kind === "column") {
      const col = checkColumn(catalog, table, item.name);
      pieces.push(`${quote(table)}.${quote(col)}`);
      continue;
    }

    const target = checkTable(catalog, item.table);
    const fk = catalog.foreignKeys.get(`${table}>${target}`);
    if (!fk) throw new QueryError(`No relationship from ${table} to ${target}.`);
    if (fk === "ambiguous") {
      throw new QueryError(
        `More than one relationship from ${table} to ${target}; embed is ambiguous.`,
      );
    }

    const alias = `embed_${joins.length}`;
    const on = fk.fromCols
      .map((from, i) => {
        const left = checkColumn(catalog, table, from);
        const right = checkColumn(catalog, target, fk.toCols[i]);
        return `${quote(table)}.${quote(left)} = ${quote(alias)}.${quote(right)}`;
      })
      .join(" and ");
    joins.push(`${item.inner ? "join" : "left join"} ${quote(target)} as ${quote(alias)} on ${on}`);

    const cols = item.columns.map((c) => {
      const col = checkColumn(catalog, target, c);
      /* The key is a bind parameter: it is caller-chosen text landing in the
         output, and the only reason it is safe as an identifier above is the
         catalog check — as a VALUE it goes through a parameter like any other. */
      params.push(col);
      /* Cast because `jsonb_build_object` is variadic-any: without it
         Postgres cannot infer the parameter's type and refuses the query. */
      return `$${params.length}::text, ${quote(alias)}.${quote(col)}`;
    });
    pieces.push(`jsonb_build_object(${cols.join(", ")}) as ${quote(target)}`);
  }

  return { list: pieces.join(", "), joins };
}

/* ── filters and ordering ────────────────────────────────────────────── */

function buildWhere(catalog, table, filters, params) {
  if (!Array.isArray(filters) || filters.length === 0) return "";
  const clauses = filters.map((f) => {
    const clause = buildClause(catalog, table, f, params);
    /* `.not(col, "is", null)` in PostgREST. Wrapped rather than given its
       own operator table, so a negated filter cannot drift from the one it
       negates — and parenthesised, because `not a = b` and `not (a = b)`
       part company the moment a clause has more than one term in it. */
    return f.negate ? `not (${clause})` : clause;
  });
  return ` where ${clauses.join(" and ")}`;
}

function buildClause(catalog, table, f, params, depth = 0) {
  if (!f || typeof f !== "object") throw new QueryError("Malformed filter.");

  if (f.op === "or") {
    /* `.or("email.ilike.%x%,company.ilike.%x%")` in PostgREST. The BROWSER
       parses that string into terms; this only ever sees the structured
       form, so no caller text is parsed here and every column and operator
       inside still goes through the catalog check like any other. */
    if (!Array.isArray(f.terms) || f.terms.length === 0) {
      throw new QueryError("`or` needs at least one term.");
    }
    /* Bounded, so a request cannot nest its way into a stack overflow. One
       level is what PostgREST's own comma syntax expresses and all this
       codebase asks for. */
    if (depth > 0) throw new QueryError("`or` cannot be nested.");
    if (f.terms.length > 32) throw new QueryError("Too many `or` terms.");
    const parts = f.terms.map((t) => buildClause(catalog, table, t, params, depth + 1));
    return `(${parts.join(" or ")})`;
  }

  const col = checkColumn(catalog, table, f.col);
  const target = `${quote(table)}.${quote(col)}`;

  if (f.op === "is") {
    /* `is` takes only null or a boolean — it is a keyword position, not a
       value position, so nothing else is allowed anywhere near it. */
    if (f.value === null) return `${target} is null`;
    if (f.value === true) return `${target} is true`;
    if (f.value === false) return `${target} is false`;
    throw new QueryError("`is` accepts only null, true or false.");
  }

  if (f.op === "in") {
    if (!Array.isArray(f.value)) throw new QueryError("`in` needs a list.");
    /* An empty list is `in ()` in SQL, which is a syntax error. PostgREST
       returns nothing for it, so that is what is reproduced. */
    if (f.value.length === 0) return "false";
    params.push(f.value);
    return `${target} = any($${params.length})`;
  }

  const sql = OPERATORS[f.op];
  if (!sql) throw new QueryError("Unknown operator.");
  params.push(f.value);
  return `${target} ${sql} $${params.length}`;
}

function buildOrder(catalog, table, order) {
  if (!Array.isArray(order) || order.length === 0) return "";
  const parts = order.map((o) => {
    const col = checkColumn(catalog, table, o?.col);
    const dir = o?.asc === false ? "desc" : "asc";
    /* PostgREST's default matches Postgres: nulls last ascending, first
       descending. Stated explicitly so a reader does not have to remember. */
    const nulls = o?.nullsFirst === true ? "nulls first"
      : o?.nullsFirst === false ? "nulls last"
      : dir === "asc" ? "nulls last" : "nulls first";
    return `${quote(table)}.${quote(col)} ${dir} ${nulls}`;
  });
  return ` order by ${parts.join(", ")}`;
}

/* ── writes ──────────────────────────────────────────────────────────────
   Insert and upsert take one row or many. Every row must agree on its
   columns: Postgres needs one column list for a multi-row VALUES, and
   quietly widening rows with nulls to make them fit would write a null over
   a column the caller never mentioned. */

function columnsOf(catalog, table, rows) {
  const first = Object.keys(rows[0]);
  if (first.length === 0) throw new QueryError("Nothing to write.");
  for (const row of rows) {
    const keys = Object.keys(row);
    if (keys.length !== first.length || keys.some((k) => !first.includes(k))) {
      throw new QueryError("Every row in one write must have the same columns.");
    }
  }
  return first.map((k) => checkColumn(catalog, table, k));
}

function buildValues(rows, cols, params) {
  return rows
    .map((row) => {
      const slots = cols.map((c) => {
        params.push(row[c] === undefined ? null : row[c]);
        return `$${params.length}`;
      });
      return `(${slots.join(", ")})`;
    })
    .join(", ");
}

/* ── the compiler ────────────────────────────────────────────────────── */

/**
 * Turn a query description into parameterised SQL.
 *
 * Pure and synchronous, which is what makes it testable without a database:
 * the tests assert on the text and the parameters, and separately assert the
 * whole thing against a real Postgres with the real policies loaded.
 */
export function compile(spec, catalog) {
  if (!spec || typeof spec !== "object") throw new QueryError("Malformed query.");
  const table = checkTable(catalog, spec.table);
  const params = [];

  const wantsRows = spec.select != null && spec.select !== false;
  const parsed = wantsRows ? parseSelect(spec.select === true ? "*" : spec.select) : null;

  if (spec.op === "select") {
    const { list, joins } = buildSelectList(catalog, table, parsed ?? [{ kind: "all" }], params);
    let text = `select ${list} from ${quote(table)}`;
    if (joins.length) text += ` ${joins.join(" ")}`;
    text += buildWhere(catalog, table, spec.filters, params);
    text += buildOrder(catalog, table, spec.order);

    if (spec.range) {
      const [from, to] = spec.range;
      const start = wholeNumber(from, "range start");
      const end = wholeNumber(to, "range end");
      if (end < start) throw new QueryError("Range ends before it starts.");
      params.push(end - start + 1, start);
      text += ` limit $${params.length - 1} offset $${params.length}`;
    } else if (spec.limit != null) {
      params.push(wholeNumber(spec.limit, "limit"));
      text += ` limit $${params.length}`;
    }
    return { text, params, spec, table };
  }

  if (spec.op === "insert" || spec.op === "upsert") {
    const rows = Array.isArray(spec.values) ? spec.values : [spec.values];
    if (rows.length === 0) throw new QueryError("Nothing to write.");
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new QueryError("Each row must be an object.");
      }
    }
    const cols = columnsOf(catalog, table, rows);
    let text =
      `insert into ${quote(table)} (${cols.map(quote).join(", ")}) ` +
      `values ${buildValues(rows, cols, params)}`;

    if (spec.op === "upsert") {
      const conflict = spec.onConflict
        ? String(spec.onConflict).split(",").map((c) => checkColumn(catalog, table, c.trim()))
        : catalog.primaryKeys.get(table);
      if (!conflict || conflict.length === 0) {
        throw new QueryError(`${table} has no primary key; upsert needs onConflict.`);
      }
      text += ` on conflict (${conflict.map(quote).join(", ")})`;
      const updatable = cols.filter((c) => !conflict.includes(c));
      if (spec.ignoreDuplicates || updatable.length === 0) {
        text += " do nothing";
      } else {
        text += ` do update set ${updatable.map((c) => `${quote(c)} = excluded.${quote(c)}`).join(", ")}`;
      }
    }

    text += returning(catalog, table, parsed, params, wantsRows);
    return { text, params, spec, table };
  }

  if (spec.op === "update") {
    const patch = spec.values;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new QueryError("Update needs one object.");
    }
    const cols = columnsOf(catalog, table, [patch]);
    const sets = cols.map((c) => {
      params.push(patch[c] === undefined ? null : patch[c]);
      return `${quote(c)} = $${params.length}`;
    });
    /* An update with no filter rewrites the table. RLS would still limit it
       to rows the caller may touch, which for an owner is all of theirs —
       so the guard is here, not left to the policies. */
    if (!Array.isArray(spec.filters) || spec.filters.length === 0) {
      throw new QueryError("An update must say which rows.");
    }
    let text = `update ${quote(table)} set ${sets.join(", ")}`;
    text += buildWhere(catalog, table, spec.filters, params);
    text += returning(catalog, table, parsed, params, wantsRows);
    return { text, params, spec, table };
  }

  if (spec.op === "delete") {
    if (!Array.isArray(spec.filters) || spec.filters.length === 0) {
      throw new QueryError("A delete must say which rows.");
    }
    let text = `delete from ${quote(table)}`;
    text += buildWhere(catalog, table, spec.filters, params);
    text += returning(catalog, table, parsed, params, wantsRows);
    return { text, params, spec, table };
  }

  throw new QueryError("Unknown operation.");
}

function returning(catalog, table, parsed, params, wantsRows) {
  if (!wantsRows) return "";
  const { list, joins } = buildSelectList(catalog, table, parsed, params);
  /* RETURNING cannot join, so an embed on a write is refused rather than
     silently dropped. Nothing in the CRM asks for one. */
  if (joins.length) throw new QueryError("A write cannot return embedded rows.");
  return ` returning ${list}`;
}

function wholeNumber(value, what) {
  if (!Number.isInteger(value) || value < 0) throw new QueryError(`Invalid ${what}.`);
  if (value > 100_000) throw new QueryError(`Invalid ${what}.`);
  return value;
}

/* ── running ─────────────────────────────────────────────────────────── */

/**
 * Compile and run one query on an already-identified connection.
 *
 * `client` comes from `asUser`/`asAnon`/`asService` in db.mjs — this
 * function never opens its own, because a connection it opened itself would
 * be a connection with nobody's identity on it.
 */
export async function runQuery(client, spec) {
  const catalog = await getCatalog(client);
  const { text, params } = compile(spec, catalog);

  let count = null;
  if (spec.op === "select" && spec.count === "exact") {
    /* Counted separately rather than with a window function, so the count is
       of every matching row and not just the page asked for. */
    const countParams = [];
    const counted = compile({ ...spec, count: undefined, limit: undefined, range: undefined, order: undefined, select: "*" }, catalog);
    countParams.push(...counted.params);
    const res = await client.query(
      `select count(*)::int as n from (${counted.text}) as counted`,
      countParams,
    );
    count = res.rows[0]?.n ?? 0;
  }

  const result = await client.query(text, params);
  const rows = result.rows ?? [];

  if (spec.single === "one") {
    if (rows.length !== 1) {
      throw new QueryError(
        rows.length === 0 ? "No row matched." : "More than one row matched.",
        rows.length === 0 ? 406 : 406,
      );
    }
    return { data: rows[0], count };
  }
  if (spec.single === "maybe") {
    if (rows.length > 1) throw new QueryError("More than one row matched.", 406);
    return { data: rows[0] ?? null, count };
  }
  return { data: spec.select == null || spec.select === false ? null : rows, count };
}
