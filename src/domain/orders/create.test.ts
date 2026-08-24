import { describe, expect, it } from "vitest";
import { alreadyHasOrder, newChallan, orderFromProforma, suggestedStage, type SalesOrder } from "./create";
import { newProforma, type DocSettings, type SalesDocument } from "../documents/create";

const SETTINGS: DocSettings & { orderPrefix?: string; orderSeq?: number; dispatchPrefix?: string; dispatchSeq?: number } = {
  proformaPrefix: "TZ/PI", proformaSeq: 4,
  orderPrefix: "TZ/SO", orderSeq: 12,
  dispatchPrefix: "TZ/DC", dispatchSeq: 5,
  defaultCurrency: "INR", defaultTaxType: "gst", defaultGst: 18, defaultValidityDays: 15,
};
const USER = { id: "u1", name: "Kuldeep Kumar" };
const TODAY = "2026-08-24";

const proforma = (over: Partial<SalesDocument> = {}): SalesDocument => ({
  ...newProforma({ settings: SETTINGS, user: USER, today: TODAY }),
  customerId: "c1",
  billName: "Acme Manufacturing", billAddress: "Plot 88, Noida", billState: "Uttar Pradesh",
  billContact: "Rajesh Kumar", billPhone: "+91 98100 12345",
  referenceNo: "PO/ACME/9911",
  currency: "INR", taxType: "gst",
  items: [
    { id: "a", desc: "M365 E3", qty: 25, rate: 2400, disc: 0, gst: 18 },
    { id: "b", desc: "EliteBook", qty: 4, rate: 112500, disc: 0, gst: 18 },
  ],
  ...over,
});

describe("order from a paid proforma", () => {
  const pf = proforma();
  const order = orderFromProforma(pf, SETTINGS, TODAY);

  it("numbers from the order sequence", () => {
    expect(order.number).toBe("TZ/SO/2026-27/0012");
  });

  it("keeps the link back, so the pair can never be raised twice", () => {
    expect(order.proformaId).toBe(pf.id);
    expect(order.proformaNumber).toBe(pf.number);
  });

  it("carries the customer, party and commercial fields", () => {
    expect(order).toMatchObject({
      customerId: "c1", billName: "Acme Manufacturing", billState: "Uttar Pradesh",
      currency: "INR", taxType: "gst",
    });
  });

  it("takes the purchase order number from the proforma's reference", () => {
    expect(order.poNumber).toBe("PO/ACME/9911");
  });

  it("starts at Confirmed", () => {
    expect(order.stage).toBe("confirmed");
  });

  it("copies the line items with fresh ids", () => {
    expect(order.items.map((i) => i.desc)).toEqual(["M365 E3", "EliteBook"]);
    expect(order.items[0]?.id).not.toBe("a");
  });

  describe("shipping address", () => {
    it("falls back to billing when the proforma ships to billing", () => {
      // An order that ships to a blank address is not a useful order.
      expect(order.shipAddress).toBe("Plot 88, Noida");
      expect(order.shipName).toBe("Acme Manufacturing");
    });

    it("uses the distinct shipping address when there is one", () => {
      const o = orderFromProforma(proforma({
        shipSameAsBilling: false, shipName: "Acme Warehouse", shipAddress: "Sector 63",
        shipState: "Haryana", shipContact: "Store", shipPhone: "+91 90000 00000",
      }), SETTINGS, TODAY);
      expect(o.shipName).toBe("Acme Warehouse");
      expect(o.shipState).toBe("Haryana");
    });

    it("still falls back per field when a shipping field is blank", () => {
      const o = orderFromProforma(proforma({ shipSameAsBilling: false, shipName: "", shipAddress: "" }), SETTINGS, TODAY);
      expect(o.shipName).toBe("Acme Manufacturing");
    });
  });
});

describe("raising an order only once", () => {
  it("knows when a proforma already has one", () => {
    const pf = proforma();
    const order = orderFromProforma(pf, SETTINGS, TODAY);
    expect(alreadyHasOrder(pf, [])).toBe(false);
    expect(alreadyHasOrder(pf, [order])).toBe(true);
  });

  it("does not confuse two proformas", () => {
    const a = proforma();
    const b = proforma();
    expect(alreadyHasOrder(b, [orderFromProforma(a, SETTINGS, TODAY)])).toBe(false);
  });
});

describe("delivery challan", () => {
  const order: SalesOrder = orderFromProforma(proforma(), SETTINGS, TODAY);

  it("numbers from the dispatch sequence", () => {
    expect(newChallan(order, [], SETTINGS, TODAY).number).toBe("TZ/DC/2026-27/0005");
  });

  it("pre-fills the full order when nothing has shipped", () => {
    const dc = newChallan(order, [], SETTINGS, TODAY);
    expect(dc.items.map((i) => i.qty)).toEqual([25, 4]);
  });

  it("pre-fills only what is outstanding on a second challan", () => {
    // Defaulting to the ordered quantity invites shipping everything twice
    // on paper.
    const first = { id: "d1", orderId: order.id, items: [{ itemId: order.items[0]!.id, qty: 10 }] };
    const dc = newChallan(order, [first], SETTINGS, TODAY);
    expect(dc.items).toEqual([
      { itemId: order.items[0]!.id, qty: 15 },
      { itemId: order.items[1]!.id, qty: 4 },
    ]);
  });

  it("is empty for a fully dispatched order", () => {
    const done = [{ id: "d", orderId: order.id, items: order.items.map((i) => ({ itemId: i.id, qty: Number(i.qty) })) }];
    expect(newChallan(order, done, SETTINGS, TODAY).items).toEqual([]);
  });

  it("takes the shipping address from the order", () => {
    const dc = newChallan(order, [], SETTINGS, TODAY);
    expect(dc.shipAddress).toBe("Plot 88, Noida");
    expect(dc.orderNumber).toBe(order.number);
  });

  it("starts Packed on today's date", () => {
    const dc = newChallan(order, [], SETTINGS, TODAY);
    expect(dc.status).toBe("Packed");
    expect(dc.dispatchDate).toBe(TODAY);
    expect(dc.deliveredDate).toBe("");
  });
});

describe("suggested stage", () => {
  it("suggests Ready once something has shipped from a confirmed order", () => {
    expect(suggestedStage("confirmed", 40)).toBe("ready");
  });

  it("suggests Dispatched once everything has shipped", () => {
    expect(suggestedStage("ready", 100)).toBe("dispatched");
  });

  it("suggests nothing once the order is finished or cancelled", () => {
    // Fully dispatched is not delivered; a human closes that loop.
    for (const stage of ["delivered", "closed", "cancelled"] as const) {
      expect(suggestedStage(stage, 100), stage).toBeNull();
    }
  });

  it("suggests nothing when nothing has changed", () => {
    expect(suggestedStage("confirmed", 0)).toBeNull();
    expect(suggestedStage("dispatched", 100)).toBeNull();
  });
});
