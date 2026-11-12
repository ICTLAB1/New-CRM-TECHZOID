/**
 * The stored functions a browser may call, and nothing else.
 *
 * WHY THIS IS A WHITELIST AND NOT A LOOKUP. PostgREST exposed `/rpc/<name>`
 * for every function in the schema, and relied on Postgres privileges to
 * decide which ones answered. Reproducing that as "take the name from the
 * request and call it" would be a remote code execution hole with a public
 * door on it: `pg_read_file`, `pg_sleep`, every `SECURITY DEFINER` helper
 * the CRM has, and anything a future migration adds without anyone thinking
 * about it. The endpoint can call the ones listed here and no others.
 *
 * AND WHY THE ARGUMENTS ARE WHITELISTED TOO. Each entry lists the exact
 * argument names the CRM actually sends. Argument names go into the SQL as
 * identifiers — that is what named notation means — so they cannot come from
 * the caller. Values are bound.
 *
 * EVERY ONE OF THESE IS `SECURITY DEFINER`, so each bypasses row-level
 * security internally and does its own check against `auth.uid()`. That
 * makes the identity stamped by `asUser` the only thing standing between a
 * caller and somebody else's document numbers. It is checked in
 * `identity.mjs` and it is checked before this file runs.
 *
 * DELIBERATELY ABSENT FROM `CALLABLE`: `consume_rate_limit` and
 * `may_manage_email_account`. Both exist and both are called — by the server
 * jobs, which run as `service_role` and do not come through the HTTP
 * endpoint. A browser has no business asking the database whether it has
 * exhausted its own rate limit, or telling it the answer.
 *
 * They are in `SERVER_CALLABLE` instead, which `serviceClient.mjs` adds and
 * `/api/rpc` does not. Getting this split wrong the first time had a cost
 * worth recording: with the rate limiter's function missing from the only
 * whitelist there was, `consume()` failed, logged, and FAILED OPEN — so the
 * public registration form, the one endpoint that is unauthenticated by
 * design and therefore most needs a limit, had none at all. It answered 200
 * and saved the row. Nothing was broken enough to notice.
 */

export class RpcError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "RpcError";
    this.status = status;
  }
}

/**
 * name -> the signatures the CRM calls.
 *
 * `args` is the exact set of argument names, and a call must match one set
 * exactly. `returns: "rows"` means a set-returning function, which the
 * browser gets as an array; `"scalar"` means one value, which it gets bare —
 * the two shapes PostgREST produced, so no call site has to change.
 */
export const CALLABLE = {
  /* Creates a company and makes the caller its Admin. */
  create_company: [{ args: ["p_name"], returns: "scalar" }],

  /* Warns before a salesperson files a customer somebody else already has.
     Reads across owners, which is why it is SECURITY DEFINER, and returns
     only a reason and a name — never the other owner's records. */
  find_duplicate_customer: [{ args: ["p_company", "p_phone", "p_gstin"], returns: "rows" }],

  /* A salesperson's own discount approval requests, with the columns they
     are entitled to. NOT a select on discount_approvals: that table's
     policy admits only Admin and Manager, because the row carries the
     distributor discount and `/rest` lets a caller pick its own columns.
     The function picks them instead. */
  my_discount_approvals: [{ args: ["p_company"], returns: "rows" }],

  /* The caller's own referral code. */
  my_lead_code: [{ args: [], returns: "scalar" }],

  /* The caller's own profile, by auth.uid() rather than by an id the
     browser worked out for itself. A B2B guest's object id differs between
     their home tenant and the one they are a guest of, so matching on it
     in the browser found nothing and told them their account was not set
     up -- while the API had linked it correctly all along. */
  my_profile: [{ args: [], returns: "rows" }],

  /* The sending accounts the caller may use. The `_safe` view exists so
     that credentials are not in what comes back. */
  my_sending_accounts: [{ args: [], returns: "rows" }],

  /* The next customer code in this company's series. */
  next_customer_code: [{ args: [], returns: "scalar" }],

  /* The next document number. Two signatures: the three-argument form
     numbers per company, the two-argument form is what a workspace that has
     not run migration 033 still calls. */
  next_doc_number: [
    { args: ["p_company", "p_obj_type", "p_fy"], returns: "scalar" },
    { args: ["p_obj_type", "p_fy"], returns: "scalar" },
  ],

  /* The next number in a named series — invoices, quotations, and so on. */
  next_doc_seq: [{ args: ["p_kind"], returns: "scalar" }],

  /* The minimum selling price of named price-book items, which is what a
     quotation checks a typed price against. Returns the minimum and no
     cost, for every role. */
  price_book_minimums: [{ args: ["p_company", "p_item_ids"], returns: "rows" }],

  /* The salesperson takes their request back, or an Admin clears a stale
     one. */
  withdraw_discount_approval: [{ args: ["p_approval"], returns: "scalar" }],

  /* The price book as a salesperson may see it: product, SKU, licence
     term, and the MINIMUM SELLING PRICE. There is no cost column in the
     result because there is no cost column in the function's select — the
     reseller price is read inside it, used to derive the minimum, and
     never returned. */
  price_book_search: [{ args: ["p_company", "p_query", "p_oem", "p_limit"], returns: "rows" }],

  /* The same search WITH the cost picture — reseller price, buying price
     at a given distributor discount, and the margin. It raises unless the
     caller is Admin or Manager in that company, so it is safe to expose
     here: the refusal is the function's, not this file's. A Sales user
     reaching it gets an error in the log rather than an empty list that
     reads like "no products matched". */
  price_book_search_costed: [
    { args: ["p_company", "p_query", "p_oem", "p_limit", "p_distributor_pct"], returns: "rows" },
  ],

  /* One approval request with the cost behind it, for the Admin deciding
     it: reseller price, buying price at whatever distributor discount they
     have negotiated, and the margin both ways. Raises for anyone but Admin
     and Manager — including the salesperson who raised the request. */
  approval_lines: [{ args: ["p_approval", "p_distributor_pct"], returns: "rows" }],

  /* An Admin approves, counters or rejects. Writes the audit log in the
     same transaction, which is why it is a function and not an update: a
     client that could update discount_approvals could record an approval
     that never happened. */
  decide_discount_approval: [{
    args: ["p_approval", "p_decision", "p_lines", "p_distributor_pct", "p_note"],
    returns: "scalar",
  }],

  /* Make one uploaded month THE list for its OEM, archiving the one it
     replaces. Admin-checked inside, and the unique index on (company, oem)
     where status = 'active' means one active list per OEM whatever any
     caller does. */
  price_list_activate: [{ args: ["p_list"], returns: "scalar" }],

  /* Which months are on file for an OEM, how many rows each has, and which
     is live. No cost in any column of it — a BDE seeing that November's
     Microsoft list is the one in force is how they know what they are
     quoting from. */
  price_list_history: [{ args: ["p_company", "p_oem"], returns: "rows" }],

  /* A salesperson asks to go below the floor. THE FLOOR IS NOT AN
     ARGUMENT: the function reads it from the price book itself and ignores
     anything the caller claims it is, so a request cannot be dressed up as
     a smaller discount than it really is. */
  request_discount_approval: [{
    args: ["p_company", "p_quote_id", "p_quote_number", "p_reason", "p_note", "p_lines"],
    returns: "scalar",
  }],

  /* Rotates a webhook's signing secret and returns the new one.
     THE ONLY TIME THE SECRET IS EVER READABLE: it is stored hashed, so a
     caller that loses this response cannot ask for it again, only rotate
     again. The function checks for itself that the caller may manage the
     integration. */
  regenerate_webhook_secret: [{ args: ["p_kind"], returns: "scalar" }],
};

/**
 * Functions the SERVER may call and a browser may not.
 *
 * Not reachable through `/api/rpc` at any privilege: `handleRpc` compiles
 * against `CALLABLE` alone. These are for `serviceClient.mjs`, which runs
 * in the function host where there is no caller to distrust.
 */
export const SERVER_CALLABLE = {
  /* The rate limiter. A browser that could call this could also spend its
     own allowance to zero, or — worse — call it with somebody else's key. */
  consume_rate_limit: [{ args: ["p_key", "p_limit", "p_window_seconds"], returns: "rows" }],

  /* Whether a given person may manage a given sending account. The answer
     is a permission decision, and a client that asks for one is a client
     that intends to act on it itself. */
  may_manage_email_account: [{ args: ["p_account_id"], returns: "scalar" }],

  /* LOADING A PRICE LIST IS NOT SOMETHING A BROWSER DOES. The rules about
     what a price list row is — a SKU, a name, a price that is a number and
     not zero, no duplicate part numbers — live in
     api/lib/priceListSheet.mjs, and the upload endpoint is the only thing
     that applies them. A browser able to call this could hand the database
     any rows it liked and go round the parser, so it is in here and not in
     CALLABLE. The function still checks for itself that the caller is an
     Admin, because this list is not an authorisation. */
  price_list_commit: [{
    args: [
      "p_company", "p_oem", "p_year", "p_month", "p_items",
      "p_sheet", "p_header_row", "p_map", "p_source_name", "p_sha", "p_activate",
    ],
    returns: "rows",
  }],

  /* What a month's prices do to the list in force: new SKUs, SKUs that have
     gone, and the ones that moved. Takes the rows the endpoint has just
     parsed, so the answer is in front of the Admin BEFORE anything is
     loaded. Reseller prices and percentages, so Admin and Manager only —
     checked in the function. */
  price_list_changes: [{ args: ["p_company", "p_oem", "p_items"], returns: "rows" }],

  /* The column mapping used for this OEM last month, which is what makes
     next month's upload one click. */
  price_list_last_mapping: [{ args: ["p_company", "p_oem"], returns: "rows" }],

  /* The caller's own role in one company, so the upload endpoint can refuse
     a BDE with a sentence instead of letting them meet a policy error. The
     browser has no need of it: it already knows whose session it is. */
  role_in: [{ args: ["p_company"], returns: "scalar" }],
};

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * Choose the signature this call matches, or refuse.
 *
 * Matching is on the exact set of argument names. A call carrying an extra
 * argument is refused rather than having it dropped: an argument the caller
 * thought was being applied and that silently was not is how a query comes
 * back with the wrong rows and nobody knows why.
 */
function signatureFor(fn, argNames, allow) {
  const signatures = Object.prototype.hasOwnProperty.call(allow, fn) ? allow[fn] : null;
  if (!signatures) throw new RpcError("Unknown function.");

  const wanted = [...argNames].sort();
  for (const signature of signatures) {
    const have = [...signature.args].sort();
    if (have.length === wanted.length && have.every((a, i) => a === wanted[i])) return signature;
  }
  throw new RpcError(`Wrong arguments for ${fn}.`);
}

/**
 * Compile one call into parameterised SQL.
 *
 * Named notation (`p_kind => $1`) rather than positional, so a function with
 * defaults or overloads resolves the way the caller meant rather than the
 * way the argument order happened to fall.
 *
 * @param allow Which whitelist to check against. Defaults to `CALLABLE`, the
 *   browser's — so a caller that forgets to pass one gets the SMALLER set,
 *   never the larger. A default that widened access would be a mistake
 *   nobody would see.
 */
export function compileRpc(fn, args = {}, allow = CALLABLE) {
  if (typeof fn !== "string" || !IDENTIFIER.test(fn)) throw new RpcError("Unknown function.");
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    throw new RpcError("Arguments must be an object.");
  }

  const names = Object.keys(args);
  const signature = signatureFor(fn, names, allow);

  const params = [];
  /* The names come from `signature.args` — this file's own copy — not from
     the request. Iterating the whitelist rather than the caller's object is
     what keeps a caller-chosen string out of the identifier position. */
  const bindings = signature.args.map((name) => {
    params.push(args[name] === undefined ? null : args[name]);
    return `${name} => $${params.length}`;
  });

  const call = `public.${fn}(${bindings.join(", ")})`;
  const text = signature.returns === "rows"
    ? `select * from ${call}`
    : `select ${call} as value`;

  return { text, params, returns: signature.returns };
}

/**
 * Run one call on an already-identified connection.
 *
 * `client` comes from `asUser`/`asAnon` — never one this opens itself,
 * because a connection with nobody's identity on it is one these functions
 * cannot judge.
 */
export async function runRpc(client, call) {
  /* Takes an ALREADY-COMPILED call, not a name and arguments. Compiling is
     where the whitelist is applied and it is pure, so the endpoint does it
     before taking a connection — a flood of requests naming functions that
     do not exist then costs no transactions and cannot stall the callers
     asking for something real. Accepting a name here as well would put that
     check back inside the transaction for anyone who used the shorter form. */
  const { text, params, returns } = call;
  const result = await client.query(text, params);
  if (returns === "rows") return result.rows ?? [];
  /* A scalar comes back bare, as PostgREST returned it. A function that
     returned no row at all is `null`, not undefined, so the browser's
     `data ?? ""` fallbacks keep working. */
  return result.rows?.[0]?.value ?? null;
}
