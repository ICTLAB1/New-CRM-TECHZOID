import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asService, closePool } from "../../api/lib/db.mjs";
import { makeXlsx } from "../../api/lib/testdata/makeXlsx.mjs";
import { chooseSheet, decodeUpload, headersFit, isMapping } from "../functions/price-list-upload.mjs";

/**
 * The upload, whole: a real .xlsx in, rows in the price book out, with the
 * real token verifier, the real translator, the real schema and the real
 * policies in between.
 *
 * WHAT THE UNIT TESTS CANNOT PROVE. priceListSheet.test.mjs proves the
 * parser reads a workbook correctly; the SQL proof proves the database
 * refuses the wrong people. Neither proves they are WIRED TOGETHER — that
 * the rows this endpoint parsed are the rows that got written, under the
 * identity the token carried, and that a salesperson searching the price
 * book a moment later sees the new minimum and not the cost it came from.
 *
 * Needs a database. Point PGCONNECTION_STRING at a throwaway copy of the
 * schema and these run; without one they skip, exactly as the ones in
 * api/lib/http.test.mjs do.
 *
 * IN netlify/lib/ AND NOT BESIDE THE HANDLER, because a .test.mjs in
 * netlify/functions/ fails the Netlify build of the whole site, not just
 * that function. portalEndpoints.test.mjs enforces it, and caught this
 * file sitting in the wrong place.
 */
const HAVE_DB = !!(process.env.PGCONNECTION_STRING || process.env.DATABASE_URL);
const d = HAVE_DB ? describe : describe.skip;

const SECRET = "a-test-signing-secret-that-is-not-real";
process.env.JWT_SECRET = process.env.JWT_SECRET || SECRET;
process.env.JWT_ALG = "HS256";

const COMPANY = "c0000000-0000-0000-0000-0000000000ff";
const ADMIN = "a0000000-0000-0000-0000-0000000000f1";
const SELLER = "a0000000-0000-0000-0000-0000000000f2";

const b64 = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");

function tokenFor(userId) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600 });
  const sig = createHmac("sha256", process.env.JWT_SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

/** A Netlify v1 event, which is what the bridge hands these handlers. */
const event = (userId, body) => ({
  httpMethod: "POST",
  headers: userId ? { authorization: `Bearer ${tokenFor(userId)}` } : {},
  body: JSON.stringify(body),
});

const SHEET = [
  ["Microsoft CSP Reseller Price List"],
  ["Effective 1 December 2026"],
  [],
  ["Part No", "SKU Title", "Product Family", "Term Duration", "Unit", " ERP Price ", "Currency"],
  ["M365-E3", "Microsoft 365 E3", "Cloud", "1 Year", "User", 1000, "INR"],
  ["M365-E5", "Microsoft 365 E5", "Cloud", "1 Year", "User", 2000, "INR"],
  ["ON-REQUEST", "Bespoke bundle", "Cloud", "1 Year", "User", 0, "INR"],
];

const upload = (over = {}) => ({
  company: COMPANY,
  oem: "Microsoft",
  year: 2026,
  month: 12,
  fileName: "microsoft-dec-2026.xlsx",
  fileBase64: makeXlsx([{ name: "Dec 2026", rows: SHEET }]).toString("base64"),
  ...over,
});

/* Imported lazily: the handler reaches the database the moment it is called,
   and the skipped case must not do that. */
let handler;
let forUser;

d("loading a month's price list, end to end", () => {
  beforeAll(async () => {
    ({ handler } = await import("../functions/price-list-upload.mjs"));
    ({ forUser } = await import("../../api/lib/serviceClient.mjs"));

    await asService(async (c) => {
      await c.query("set local request.jwt.claim.role = 'service_role'");
      await c.query(
        `insert into auth.users(id, email, raw_user_meta_data) values ($1,'pb-admin@t','{}'::jsonb), ($2,'pb-sales@t','{}'::jsonb)
         on conflict (id) do nothing`, [ADMIN, SELLER]);
      await c.query(
        `insert into public.profiles(id, name, email, role) values ($1,'PB Admin','pb-admin@t','Admin'), ($2,'PB Sales','pb-sales@t','Sales')
         on conflict (id) do update set role = excluded.role`, [ADMIN, SELLER]);
      await c.query(`insert into public.companies(id, name) values ($1,'Upload Test Co') on conflict (id) do nothing`, [COMPANY]);
      await c.query(
        `insert into public.company_members(company_id, user_id, role) values ($1,$2,'Admin'), ($1,$3,'Sales')
         on conflict (company_id, user_id) do update set role = excluded.role`, [COMPANY, ADMIN, SELLER]);
      /* A 15% minimum margin on Microsoft Cloud, so the floors below are
         arithmetic somebody can check by hand. */
      await c.query(
        `insert into public.oem_margin_rules(company_id, oem, category, min_margin_pct) values ($1,'Microsoft','Cloud',15)
         on conflict (company_id, lower(oem), coalesce(lower(category),''), coalesce(lower(sku),'')) do update set min_margin_pct = 15`,
        [COMPANY]);
      await c.query(`delete from public.price_lists where company_id = $1`, [COMPANY]);
    });
  });

  afterAll(async () => {
    if (!HAVE_DB) return;
    await asService(async (c) => {
      await c.query(`delete from public.price_lists where company_id = $1`, [COMPANY]);
      await c.query(`delete from public.oem_margin_rules where company_id = $1`, [COMPANY]);
    });
    await closePool();
  });

  it("refuses a salesperson, in a sentence", async () => {
    const res = await handler(event(SELLER, upload()));
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toMatch(/Only an Admin can load price lists/);
  });

  it("refuses a caller with no token at all", async () => {
    const res = await handler(event(null, upload()));
    expect(res.statusCode).toBe(403);
  });

  it("previews without writing anything", async () => {
    const res = await handler(event(ADMIN, upload()));
    expect(res.statusCode).toBe(200);
    const out = JSON.parse(res.body);

    expect(out.stage).toBe("preview");
    expect(out.sheet).toBe("Dec 2026");
    expect(out.headerRow).toBe(3);
    expect(out.mappingFrom).toBe("the column headings");
    expect(out.mapping).toMatchObject({ sku: 0, productName: 1, resellerPrice: 5 });

    /* Two usable rows; the zero-priced one is reported, not imported — a
       floor of nothing is no floor. */
    expect(out.itemCount).toBe(2);
    expect(out.errorCount).toBe(1);
    expect(out.errors[0]).toMatchObject({ sku: "ON-REQUEST" });
    expect(out.errors[0].problem).toMatch(/zero/);

    /* Nothing is in the price book yet. */
    const { data } = await forUser(SELLER).rpc("price_book_search", {
      p_company: COMPANY, p_query: null, p_oem: "Microsoft", p_limit: 50,
    });
    expect(data).toEqual([]);
  });

  it("will not load a file with bad rows until somebody says so", async () => {
    // Loading 2 of 3 rows is legitimate — but it has to be a decision, because
    // the SKU that did not load is one a BDE will not be able to find.
    const res = await handler(event(ADMIN, upload({ commit: true })));
    expect(res.statusCode).toBe(409);
    const out = JSON.parse(res.body);
    expect(out.stage).toBe("confirm");
    expect(out.itemCount).toBe(2);
    expect(out.errorCount).toBe(1);
  });

  it("loads the list, and a salesperson sees the minimum and nothing else", async () => {
    const res = await handler(event(ADMIN, upload({ commit: true, acceptErrors: true })));
    expect(res.statusCode).toBe(200);
    const out = JSON.parse(res.body);
    expect(out.stage).toBe("loaded");
    expect(out.itemsLoaded).toBe(2);
    expect(out.activated).toBe(true);
    expect(out.replaced).toBe(false);

    /* THE POINT OF ALL OF IT. The salesperson's own search, through the
       door built for them: the floor, at 15% over a ₹1,000 reseller price,
       and no column anywhere in the answer that says what it cost. */
    const { data } = await forUser(SELLER).rpc("price_book_search", {
      p_company: COMPANY, p_query: "M365-E3", p_oem: "Microsoft", p_limit: 10,
    });
    expect(data).toHaveLength(1);
    expect(data[0].min_price).toBe(1150);
    expect(typeof data[0].min_price).toBe("number");
    expect(data[0].period).toBe("2026-12");
    expect(Object.keys(data[0])).toEqual([
      "item_id", "oem", "sku", "product_name", "category",
      "licence_type", "unit", "currency", "min_price", "period",
    ]);

    /* And the cost table itself is still shut to them. */
    const { data: direct } = await forUser(SELLER).from("price_list_items").select("reseller_price");
    expect(direct ?? []).toEqual([]);
  });

  it("offers last month's mapping back, so next month is one click", async () => {
    const res = await handler(event(ADMIN, upload({ year: 2027, month: 1 })));
    const out = JSON.parse(res.body);
    expect(out.mappingFrom).toBe("the 2026-12 upload");
    expect(out.mapping).toMatchObject({ sku: 0, productName: 1, resellerPrice: 5 });
  });

  it("reports what the new month does to the old one", async () => {
    const dearer = SHEET.map((r) => (r[0] === "M365-E3" ? [...r.slice(0, 5), 1100, "INR"] : r));
    const res = await handler(event(ADMIN, upload({
      year: 2027, month: 1,
      fileBase64: makeXlsx([{ name: "Jan 2027", rows: [...dearer, ["TEAMS-EEA", "Teams EEA", "Cloud", "1 Year", "User", 300, "INR"]] }]).toString("base64"),
    })));
    const out = JSON.parse(res.body);
    const by = (k) => out.changes.filter((c) => c.change === k);
    expect(by("changed")).toHaveLength(1);
    expect(by("changed")[0]).toMatchObject({ sku: "M365-E3", was: 1000, now_is: 1100, change_pct: 10 });
    // A NUMBER, not the string Postgres sends for a numeric. db.mjs parses
    // them on purpose (deal values once added up as "1000" + "500" =
    // "1000500"), and the approval gate compares a typed price against a
    // minimum — a string there would compare by character and let a price
    // under the floor through.
    expect(typeof by("changed")[0].change_pct).toBe("number");
    expect(by("added").map((c) => c.sku)).toEqual(["TEAMS-EEA"]);
  });

  it("replaces a month rather than keeping two of it", async () => {
    const res = await handler(event(ADMIN, upload({ commit: true, acceptErrors: true })));
    const out = JSON.parse(res.body);
    expect(out.replaced).toBe(true);

    await asService(async (c) => {
      const { rows } = await c.query(
        `select count(*)::int as n from public.price_lists
          where company_id = $1 and lower(oem) = 'microsoft' and status = 'active'`, [COMPANY]);
      expect(rows[0].n).toBe(1);
    });
  });

  it("tells somebody who uploaded a CSV what to do instead", async () => {
    const res = await handler(event(ADMIN, upload({
      fileBase64: Buffer.from("SKU,Price\nM365-E3,1000\n").toString("base64"),
    })));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/not an .xlsx file/);
  });

  it("asks which column is which when it cannot tell", async () => {
    const res = await handler(event(ADMIN, upload({
      oem: "Autodesk",
      fileBase64: makeXlsx([{ name: "Sheet1", rows: [["Item", "MRP"], ["AutoCAD", 50000]] }]).toString("base64"),
    })));
    const out = JSON.parse(res.body);
    expect(out.stage).toBe("mapping");
    expect(out.missing).toContain("resellerPrice");
    expect(out.message).toMatch(/Say which column/);
  });
});

describe("the pieces that need no database", () => {
  it("decodes a file whether or not the browser sent a data: prefix", () => {
    expect(decodeUpload(Buffer.from("hello").toString("base64")).toString()).toBe("hello");
    const dataUrl = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${Buffer.from("hi").toString("base64")}`;
    expect(decodeUpload(dataUrl).toString()).toBe("hi");
    expect(decodeUpload("")).toBeNull();
    expect(decodeUpload(null)).toBeNull();
  });

  it("picks the sheet that looks like a price list, not just the first", () => {
    // A workbook whose first tab is "Read me" is the normal case.
    const sheets = [
      { name: "Read me", rows: [["Terms of use"]] },
      { name: "Prices", rows: [["SKU", "ERP Price"], ["A", 1]] },
    ];
    expect(chooseSheet(sheets).name).toBe("Prices");
    expect(chooseSheet(sheets, "Read me").name).toBe("Read me");
    expect(chooseSheet(sheets, "read ME").name).toBe("Read me");
    expect(chooseSheet(sheets, "No such sheet").name).toBe("Prices");
  });

  it("falls back to the first sheet when none looks like a price list", () => {
    const sheets = [{ name: "A", rows: [["x"]] }, { name: "B", rows: [["y"]] }];
    expect(chooseSheet(sheets).name).toBe("A");
  });

  it("takes only a field-to-column-number mapping", () => {
    expect(isMapping({ sku: 0, resellerPrice: 5 })).toBe(true);
    expect(isMapping({ sku: "0" })).toBe(false);
    expect(isMapping({ sku: -1 })).toBe(false);
    expect(isMapping({ sku: 1.5 })).toBe(false);
    expect(isMapping([0, 1])).toBe(false);
    expect(isMapping(null)).toBe(false);
  });

  it("will not reuse a remembered mapping that points past the file's columns", () => {
    // A distributor who dropped three columns would otherwise have every
    // price read out of a column that is not there.
    expect(headersFit({ sku: 0, resellerPrice: 5 }, ["SKU", "Name", "Price"])).toBe(false);
    expect(headersFit({ sku: 0, resellerPrice: 2 }, ["SKU", "Name", "Price"])).toBe(true);
    expect(headersFit({}, ["SKU"])).toBe(false);
  });
});
