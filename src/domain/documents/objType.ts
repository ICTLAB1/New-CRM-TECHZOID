/**
 * What a document IS, carried on the document.
 *
 * THE PROBLEM THIS SOLVES. Until now a document's type was implied by which
 * table it came out of, and travelled the app as a React prop. Hand any
 * function a bare SalesDocument and it cannot tell a quotation from a
 * purchase order — every consumer needs the type passed alongside, and every
 * one of them is a chance to pass the wrong one. The same record shape is
 * already shared by all six kinds, which is the right design; what was
 * missing was the field that says which kind this one is.
 *
 * WHY SAP'S NUMBERS. SAP identifies every marketing document by an ObjType:
 * 23 is a sales quotation, 17 a sales order, 13 an A/R invoice, and so on.
 * They are worth adopting rather than inventing our own because they are
 * stable, documented, and already the vocabulary of anybody who has used an
 * ERP — and because the moment this CRM has to exchange a document with an
 * SAP system, or explain itself to an accountant who has, the mapping is
 * already done. The readable name is kept beside the number: nobody should
 * have to remember that 13 means invoice to read a log line.
 *
 * THE PROFORMA IS NOT A SAP OBJECT TYPE. SAP has no proforma document — in
 * B1 a proforma is a print layout of an order or an invoice, not a record of
 * its own. This business issues real proformas that customers pay against,
 * so it stays a document here and gets a LOCAL code, deliberately outside
 * SAP's range so it can never be mistaken for one of theirs. Renumbering it
 * to look official would be worse than admitting it is ours.
 */

/** SAP marketing-document object types, plus one local extension. */
export const OBJ_TYPE = {
  /** OQUT — sales quotation. */
  quotation: 23,
  /** ORDR — sales order. */
  order: 17,
  /** ODLN — delivery. The delivery challan raised against a sales order. */
  delivery: 15,
  /** OINV — A/R invoice. The GST tax invoice. */
  invoice: 13,
  /** OPOR — purchase order. */
  purchase_order: 22,
  /** OPDN — goods receipt PO. */
  goods_receipt: 20,
  /** LOCAL, not SAP: a proforma invoice. See the note above. */
  proforma: 9001,
} as const;

export type DocKind = keyof typeof OBJ_TYPE;
export type ObjType = (typeof OBJ_TYPE)[DocKind];

/** What each one is called on screen and in a log line. */
export const OBJ_TYPE_NAME: Record<ObjType, string> = {
  23: "Quotation",
  17: "Sales order",
  15: "Delivery",
  13: "Tax invoice",
  22: "Purchase order",
  20: "Goods receipt",
  9001: "Proforma invoice",
};

const KIND_OF: Record<number, DocKind> = Object.fromEntries(
  Object.entries(OBJ_TYPE).map(([kind, n]) => [n, kind as DocKind]),
) as Record<number, DocKind>;

/** The readable kind for a number, or null if it is not one of ours. */
export const kindOfObjType = (n: number | undefined | null): DocKind | null =>
  KIND_OF[Number(n)] ?? null;

export const nameOfObjType = (n: number | undefined | null): string =>
  OBJ_TYPE_NAME[Number(n) as ObjType] ?? "Document";

/**
 * The table each kind is stored in.
 *
 * Deliberately NOT renamed to SAP's own table names. OQUT and RDR1 mean
 * nothing outside SAP, this database is shared with another application, and
 * a rename of a live table buys nothing that a documented mapping does not.
 */
export const TABLE_OF_OBJ_TYPE: Record<ObjType, string> = {
  23: "quotes",
  17: "orders",
  15: "challans",
  13: "invoices",
  22: "purchase_orders",
  20: "purchase_orders", // receipts are logged on the purchase order itself
  9001: "proformas",
};

/** The reverse: what a row from this table is, for filling in a document
 *  saved before it carried its own type. */
export const OBJ_TYPE_OF_TABLE: Record<string, ObjType> = {
  quotes: OBJ_TYPE.quotation,
  orders: OBJ_TYPE.order,
  challans: OBJ_TYPE.delivery,
  invoices: OBJ_TYPE.invoice,
  purchase_orders: OBJ_TYPE.purchase_order,
  proformas: OBJ_TYPE.proforma,
};

/* ── the bridge to the existing DocType prop ───────────────────────── */

/** The four types the document editor already knows about, as strings. Kept
 *  because DocType is threaded through every renderer; this maps between the
 *  two rather than forcing a rename across the whole UI in one commit. */
export const OBJ_TYPE_OF_DOC_TYPE: Record<string, ObjType> = {
  quotation: OBJ_TYPE.quotation,
  proforma: OBJ_TYPE.proforma,
  purchase_order: OBJ_TYPE.purchase_order,
  invoice: OBJ_TYPE.invoice,
};

export const DOC_TYPE_OF_OBJ_TYPE: Record<number, string> = {
  23: "quotation",
  9001: "proforma",
  22: "purchase_order",
  13: "invoice",
};
