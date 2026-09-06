import { describe, expect, it } from "vitest";
import {
  DOC_TYPE_OF_OBJ_TYPE, OBJ_TYPE, OBJ_TYPE_NAME, OBJ_TYPE_OF_DOC_TYPE, OBJ_TYPE_OF_TABLE,
  kindOfObjType, nameOfObjType,
} from "./objType";
import { newProforma, newPurchaseOrder, newQuotation, invoiceFrom } from "./create";
import { normalizeDocument } from "../../data/normalize";

const SETTINGS = {} as Parameters<typeof newQuotation>[0]["settings"];
const USER = { id: "u1", name: "Abhinav Jain" };

describe("the SAP object types", () => {
  it("uses SAP's own numbers for the documents SAP has", () => {
    /* Not ours to choose: these are the ObjType values an ERP already uses,
       and the whole point of adopting them is that they match. */
    expect(OBJ_TYPE.quotation).toBe(23);
    expect(OBJ_TYPE.order).toBe(17);
    expect(OBJ_TYPE.delivery).toBe(15);
    expect(OBJ_TYPE.invoice).toBe(13);
    expect(OBJ_TYPE.purchase_order).toBe(22);
    expect(OBJ_TYPE.goods_receipt).toBe(20);
  });

  it("keeps the proforma clearly outside SAP's range", () => {
    /* SAP has no proforma document. Ours must never be mistaken for one of
       theirs, so it sits far above anything they allocate. */
    const sapCodes = [23, 17, 15, 13, 22, 20];
    expect(sapCodes).not.toContain(OBJ_TYPE.proforma);
    expect(OBJ_TYPE.proforma).toBeGreaterThan(9000);
  });

  it("maps every number to exactly one kind and back", () => {
    for (const [kind, n] of Object.entries(OBJ_TYPE)) {
      expect(kindOfObjType(n)).toBe(kind);
      expect(OBJ_TYPE_NAME[n]).toBeTruthy();
    }
  });

  it("has a readable name for every number, and a safe answer for a stray one", () => {
    expect(nameOfObjType(13)).toBe("Tax invoice");
    expect(nameOfObjType(99)).toBe("Document");
    expect(kindOfObjType(99)).toBeNull();
    expect(kindOfObjType(undefined)).toBeNull();
  });

  it("round-trips the DocType strings the editor still uses", () => {
    for (const docType of ["quotation", "proforma", "purchase_order", "invoice"]) {
      const n = OBJ_TYPE_OF_DOC_TYPE[docType];
      expect(n).toBeDefined();
      expect(DOC_TYPE_OF_OBJ_TYPE[n!]).toBe(docType);
    }
  });
});

describe("a document knows what it is", () => {
  it("carries its type from the moment it is created", () => {
    expect(newQuotation({ settings: SETTINGS, user: USER }).objType).toBe(OBJ_TYPE.quotation);
    expect(newProforma({ settings: SETTINGS, user: USER }).objType).toBe(OBJ_TYPE.proforma);
    expect(newPurchaseOrder({ settings: SETTINGS, user: USER }).objType).toBe(OBJ_TYPE.purchase_order);
    const quote = newQuotation({ settings: SETTINGS, user: USER });
    expect(invoiceFrom(quote, SETTINGS, USER).objType).toBe(OBJ_TYPE.invoice);
  });

  /* The whole reason the field is optional: 61 customers' worth of documents
     were written before it existed. The table they came from is the only
     thing that knows, so loading is where it gets filled in. */
  it("is told what it is on load, when the stored record predates the field", () => {
    const old = { id: "q1", number: "TZ/QT/2026-27/0001", items: [] };
    expect(normalizeDocument(old, OBJ_TYPE.quotation).objType).toBe(OBJ_TYPE.quotation);
  });

  it("never lets the table override a type the record already carries", () => {
    /* An invoice row sitting in the wrong collection is a bug to find, not
       one to paper over by relabelling the record on the way past. */
    const doc = { id: "i1", objType: OBJ_TYPE.invoice, items: [] };
    expect(normalizeDocument(doc, OBJ_TYPE.quotation).objType).toBe(OBJ_TYPE.invoice);
  });

  it("maps every table the app reads documents out of", () => {
    for (const table of ["quotes", "proformas", "purchase_orders", "invoices", "orders", "challans"]) {
      expect(OBJ_TYPE_OF_TABLE[table], table).toBeDefined();
    }
  });
});
