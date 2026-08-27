import { describe, expect, it } from "vitest";
import {
  isActiveRegistration, nameDisagrees, parseGstinResponse, registerDate, statusLine,
} from "./gstin";

/* The register's own field names, wrapped the way a provider wraps them.
   This is the shape the abbreviations come in — lgnm, tradeNam, sts, rgdt —
   which is what GSTN has always used and what gets passed through. */
const GSTN_SHAPE = {
  code: 200,
  timestamp: 1756290000000,
  transaction_id: "abc-123",
  data: {
    gstin: "27AACCN1234M1ZG",
    lgnm: "NORTHLINE LOGISTICS PRIVATE LIMITED",
    tradeNam: "Northline Logistics",
    sts: "Active",
    dty: "Regular",
    ctb: "Private Limited Company",
    rgdt: "01/07/2017",
    cxdt: "",
    nba: ["Wholesale Business", "Warehouse"],
    pradr: {
      addr: { bno: "402", bnm: "Trade Centre", st: "Senapati Bapat Marg", loc: "Shivaji Nagar",
              city: "Pune", dst: "Pune", stcd: "Maharashtra", pncd: "411016" },
      ntr: "Office / Sale Office",
    },
  },
};

/* The same registration, renamed to snake_case and nested one level deeper —
   the other way providers hand it over. */
const SNAKE_SHAPE = {
  data: {
    data: {
      gstin: "27AACCN1234M1ZG",
      legal_name: "NORTHLINE LOGISTICS PRIVATE LIMITED",
      trade_name: "Northline Logistics",
      status: "Active",
      taxpayer_type: "Regular",
      constitution_of_business: "Private Limited Company",
      registration_date: "2017-07-01",
      nature_of_business_activities: ["Wholesale Business", "Warehouse"],
      principal_address: {
        address: { building_number: "402", building_name: "Trade Centre", street: "Senapati Bapat Marg",
                   location: "Shivaji Nagar", city: "Pune", state: "Maharashtra", pincode: "411016" },
      },
    },
  },
};

describe("reading a registration back", () => {
  it("reads the register's own abbreviations", () => {
    const v = parseGstinResponse(GSTN_SHAPE);
    expect(v).toMatchObject({
      gstin: "27AACCN1234M1ZG",
      legalName: "NORTHLINE LOGISTICS PRIVATE LIMITED",
      tradeName: "Northline Logistics",
      status: "Active",
      taxpayerType: "Regular",
      constitution: "Private Limited Company",
      registeredOn: "2017-07-01",
    });
    expect(v?.natureOfBusiness).toEqual(["Wholesale Business", "Warehouse"]);
  });

  it("reads the same registration renamed and nested deeper", () => {
    // The whole point of the forgiving lookup: one provider, two spellings,
    // and the feature must not silently return blanks for either.
    const a = parseGstinResponse(GSTN_SHAPE);
    const b = parseGstinResponse(SNAKE_SHAPE);
    expect(b?.legalName).toBe(a?.legalName);
    expect(b?.status).toBe(a?.status);
    expect(b?.registeredOn).toBe(a?.registeredOn);
    expect(b?.address).toEqual(a?.address);
  });

  it("builds one readable address line", () => {
    const v = parseGstinResponse(GSTN_SHAPE);
    expect(v?.address).toEqual({
      line: "402, Trade Centre, Senapati Bapat Marg, Shivaji Nagar",
      city: "Pune",
      state: "Maharashtra",
      pincode: "411016",
    });
  });

  it("does not repeat a fragment the register states twice", () => {
    // `loc` and `st` overlapping is ordinary. Printed on an invoice, the
    // repetition reads as a typo somebody made.
    const v = parseGstinResponse({
      data: { gstin: "27AACCN1234M1ZG", lgnm: "X",
              pradr: { addr: { st: "MG Road", loc: "MG ROAD", city: "Pune" } } },
    });
    expect(v?.address.line).toBe("MG Road");
  });

  it("finds the registration whatever it is wrapped in", () => {
    const flat = { gstin: "27AACCN1234M1ZG", lgnm: "Acme" };
    for (const wrapped of [flat, { data: flat }, { result: { data: flat } }, { response: { payload: flat } }]) {
      expect(parseGstinResponse(wrapped)?.legalName).toBe("Acme");
    }
  });

  it("learns nothing from a payload with no registration in it", () => {
    // An error body, an empty result, rubbish. Null means "we did not learn
    // anything" — which is not the same as "this GSTIN is bad", and the
    // caller has to say so.
    expect(parseGstinResponse({ code: 404, message: "no records found" })).toBeNull();
    expect(parseGstinResponse({ data: null })).toBeNull();
    expect(parseGstinResponse(null)).toBeNull();
    expect(parseGstinResponse("not json")).toBeNull();
    expect(parseGstinResponse({ data: { unrelated: 1 } })).toBeNull();
  });

  it("does not loop forever on a self-referential payload", () => {
    const loop: Record<string, unknown> = {};
    loop["data"] = loop;
    expect(parseGstinResponse(loop)).toBeNull();
  });
});

describe("the register's dates", () => {
  it("turns dd/mm/yyyy into a date the app can sort", () => {
    expect(registerDate("01/07/2017")).toBe("2017-07-01");
    expect(registerDate("1/7/2017")).toBe("2017-07-01");
    expect(registerDate("15-08-2021")).toBe("2021-08-15");
  });

  it("leaves alone what it does not recognise", () => {
    expect(registerDate("2017-07-01")).toBe("2017-07-01");
    expect(registerDate("")).toBe("");
    expect(registerDate("sometime in 2017")).toBe("sometime in 2017");
  });
});

describe("what the salesperson is told", () => {
  const of = (o: Record<string, unknown>) => parseGstinResponse({ data: { gstin: "27AACCN1234M1ZG", lgnm: "X", ...o } })!;

  it("says active plainly", () => {
    expect(statusLine(of({ sts: "Active", dty: "Regular" }))).toEqual({ tone: "good", text: "Active · Regular" });
  });

  it("says what a cancelled registration means for an invoice", () => {
    const line = statusLine(of({ sts: "Cancelled", cxdt: "31/03/2024" }));
    expect(line.tone).toBe("bad");
    expect(line.text).toContain("2024-03-31");
    expect(line.text).toContain("rejected");
  });

  it("never reads a missing status as active", () => {
    // Guessing in the reassuring direction is how a cancelled registration
    // gets invoiced.
    const line = statusLine(of({ sts: "" }));
    expect(line.tone).toBe("warn");
    expect(isActiveRegistration(of({ sts: "" }))).toBe(false);
  });

  it("passes an unfamiliar status through rather than inventing one", () => {
    expect(statusLine(of({ sts: "Suspended" }))).toEqual({ tone: "warn", text: "Suspended" });
  });
});

describe("comparing the typed name with the register", () => {
  const v = parseGstinResponse(GSTN_SHAPE)!;

  it("accepts the same company written differently", () => {
    // Flagging this pair every time is how people learn to ignore the flag.
    expect(nameDisagrees("Northline Logistics Pvt Ltd", v)).toBe(false);
    expect(nameDisagrees("NORTHLINE LOGISTICS PRIVATE LIMITED", v)).toBe(false);
    expect(nameDisagrees("northline  logistics", v)).toBe(false);
    expect(nameDisagrees("Northline Logistics & Co.", v)).toBe(false);
  });

  it("reports a genuinely different company", () => {
    expect(nameDisagrees("Southline Freight", v)).toBe(true);
  });

  it("says nothing when nothing has been typed yet", () => {
    expect(nameDisagrees("", v)).toBe(false);
    expect(nameDisagrees("   ", v)).toBe(false);
  });
});
