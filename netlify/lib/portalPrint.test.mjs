import { describe, expect, it } from "vitest";
import { printableDocument, printableSettings } from "./portalPrint.mjs";

/**
 * The download is the one place a stranger with a link gets more than the
 * page shows — the letterhead, the registration numbers, the bank block.
 * These tests are the fence around THAT, written the same way as the one
 * around the page: to fail when somebody ADDS a field, not only when
 * somebody breaks one.
 */

const QUOTE_ROW = {
  id: "q1",
  owner_id: "11111111-1111-1111-1111-111111111111",
  customer_id: "c1",
  data: {
    number: "TZ/Q/26-27/0047",
    status: "Sent",
    date: "2026-11-13",
    validUntil: "2026-11-20",
    currency: "INR",
    taxType: "gst",
    billName: "Larsen Infotech Pvt Ltd",
    billGstin: "27AABCL1234A1Z5",
    shipName: "Larsen Infotech Pvt Ltd",
    terms: ["Prices are exclusive of GST."],
    items: [{
      id: "li1", desc: "Microsoft 365 E3", sku: "M365-E3", brand: "Microsoft",
      hsn: "997331", qty: 120, unit: "User", rate: 2500, disc: 0, gst: 18,
      /* What we paid, and the floor it was priced against. Neither is on the
         paper and neither may leave. */
      cost: 1826.4,
      minPrice: 2470.2,
      priceBookItemId: "9f364e3e-efad-4d4d-bd2b-a79ad2414ea6",
    }],
    /* Things a document row carries that the paper does not. */
    ownerId: "11111111-1111-1111-1111-111111111111",
    customerResponse: { ip: "203.0.113.9", by: "Ravi Menon" },
    updatedAt: 1763000000000,
  },
};

const SETTINGS_ROW = {
  data: {
    company: {
      name: "TechZoid Technologies Private Limited",
      address: "407, Pearl Business Park",
      gstin: "07AAGCT9158R1Z0", pan: "AAGCT9158R", cin: "U72900DL2016PTC302635",
      phone: "+91 97114 92098", email: "sales@techzoidtechnologies.com",
    },
    signatoryName: "Abhinav Jain",
    bankAccounts: [{ name: "HDFC Bank Ltd", account: "50200045678901", ifsc: "HDFC0000123" }],
    /* Everything else in the settings row, which must stay in it. */
    interaktApiKey: "secret-key-value",
    customerSeq: 124,
    productCatalog: [{ sku: "M365-E3", costPrice: 1826.4 }],
    emailAccounts: [{ refreshToken: "ya29.a0-refresh" }],
    webhookSigningSecret: "whsec_live_abc123",
  },
};

describe("the document a customer may download", () => {
  it("carries what is printed on it", () => {
    const out = printableDocument("quotation", QUOTE_ROW);
    expect(out.number).toBe("TZ/Q/26-27/0047");
    expect(out.billGstin).toBe("27AABCL1234A1Z5");
    expect(out.items[0].desc).toBe("Microsoft 365 E3");
    expect(out.items[0].rate).toBe(2500);
  });

  it("carries no cost, no floor, and nothing else off the row", () => {
    /* The line's buying price is the thing that must never reach a
       customer, and a quotation row carries it. */
    const json = JSON.stringify(printableDocument("quotation", QUOTE_ROW));
    for (const secret of ["1826.4", "2470.2", "9f364e3e", "203.0.113.9", "11111111-1111"]) {
      expect(json, secret).not.toContain(secret);
    }
    expect(Object.keys(printableDocument("quotation", QUOTE_ROW).items[0]).sort()).toEqual(
      ["brand", "desc", "disc", "gst", "hsn", "id", "qty", "rate", "sku", "subDesc", "unit"],
    );
  });

  it("is a fixed set of fields, so a new one is invisible until it is named", () => {
    expect(Object.keys(printableDocument("quotation", QUOTE_ROW)).sort()).toEqual([
      "advancePercent", "bankAccountId", "billAddress", "billContact", "billCountry",
      "billEmail", "billGstin", "billName", "billPan", "billPhone", "billState",
      "currency", "customerCode", "date", "deliveryTerms", "enquiryRef", "footer",
      "id", "intro", "items", "kind", "number", "paymentTerms", "preparedBy",
      "quoteNumber", "referenceNo", "revisionNo", "roundOff", "shipAddress",
      "shipContact", "shipCountry", "shipEmail", "shipGstin", "shipName", "shipPan",
      "shipPhone", "shipSameAsBilling", "shipState", "status", "subject", "taxType",
      "terms", "validUntil",
    ]);
  });
});

describe("the letterhead a downloaded document is printed on", () => {
  it("carries the company's registration numbers, which are on every document", () => {
    const out = printableSettings(SETTINGS_ROW);
    expect(out.company.gstin).toBe("07AAGCT9158R1Z0");
    expect(out.company.cin).toBe("U72900DL2016PTC302635");
    expect(out.signatoryName).toBe("Abhinav Jain");
  });

  it("carries the bank block, because it is printed on the document", () => {
    /* Deliberately WIDER than the page, which leaves these out — see the
       note at the top of portalPrint.mjs. A copy with the bank block
       missing is not the document the customer was sent. */
    const out = printableSettings(SETTINGS_ROW);
    expect(out.bankAccounts[0].account).toBe("50200045678901");
    expect(out.bankAccounts[0].ifsc).toBe("HDFC0000123");
  });

  it("carries nothing else out of the settings row", () => {
    /* One row holds every integration secret in the workspace, the customer
       numbering counter, and the product catalog with its buying prices. */
    const json = JSON.stringify(printableSettings(SETTINGS_ROW));
    for (const secret of [
      "secret-key-value", "customerSeq", "productCatalog", "costPrice",
      "ya29.a0-refresh", "whsec_live_abc123",
    ]) {
      expect(json, secret).not.toContain(secret);
    }
  });

  it("is a fixed set of fields too", () => {
    expect(Object.keys(printableSettings(SETTINGS_ROW)).sort()).toEqual([
      "bank", "bankAccounts", "brandingLogos", "certLogos", "company",
      "docTemplate", "partnerDesignations", "signatoryDesignation",
      "signatoryName", "uaeOffice",
    ]);
    expect(Object.keys(printableSettings(SETTINGS_ROW).company).sort()).toEqual([
      "address", "cin", "city", "country", "email", "gstin", "logo", "logoH",
      "logoW", "name", "pan", "phone", "pincode", "state", "tagline", "website",
    ]);
  });

  it("answers an empty settings row without throwing", () => {
    /* A workspace that has never opened the company panel still has
       documents, and a download must not 500 on one. */
    const out = printableSettings({});
    expect(out.company.name).toBe("");
    expect(out.bankAccounts).toEqual([]);
  });
});
