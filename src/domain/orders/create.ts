import { TODAY } from "../dates";
import { buildDocNumber } from "../numbering/docNumber";
import type { SalesDocument, DocSettings } from "../documents/create";
import type { LineItem } from "../tax/types";
import { COURIERS, type DispatchStatus, type OrderStageId } from "./stages";
import { pendingLines, type Challan } from "./fulfilment";

export interface SalesOrder {
  id: string;
  number: string;
  ownerId: string;
  customerId: string;
  /** The document this order came from, so neither is raised twice. */
  proformaId?: string;
  proformaNumber?: string;
  quoteId?: string;
  quoteNumber?: string;
  poNumber?: string;
  poDate?: string;

  billName: string;
  billAddress: string;
  billState: string;
  billContact: string;
  billPhone: string;

  shipName: string;
  shipAddress: string;
  shipState: string;
  shipPincode?: string;
  shipContact: string;
  shipPhone: string;

  currency: string;
  taxType: string;
  orderType?: string;
  stage: OrderStageId;
  date: string;
  expectedDate?: string;
  items: LineItem[];
  notes?: string;
  roundOff: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface DeliveryChallan extends Challan {
  number: string;
  ownerId: string;
  orderNumber: string;
  poNumber?: string;
  date: string;
  shipName: string;
  shipAddress: string;
  shipState: string;
  shipPincode?: string;
  shipContact: string;
  shipPhone: string;
  items: { itemId: string; qty: number }[];
  transporter?: string;
  vehicleNo?: string;
  lrNo?: string;
  courier: string;
  trackingNo?: string;
  ewayBill?: string;
  status: DispatchStatus;
  dispatchDate: string;
  expectedDeliveryDate?: string;
  deliveredDate?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

const uid = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/**
 * A sales order raised from a paid proforma.
 *
 * Recording a payment never does this on its own — the ledger reports, the
 * admin decides. This runs when someone actually moves the proforma to Paid,
 * and only once: `alreadyHasOrder` is what stops a second Paid → Paid save
 * raising a duplicate order against the same money.
 */
export function orderFromProforma(
  pf: SalesDocument,
  settings: DocSettings & { orderPrefix?: string; orderSeq?: number },
  today: string = TODAY(),
): SalesOrder {
  return {
    id: uid(),
    number: buildDocNumber(settings.orderPrefix ?? "TZ/SO", settings.orderSeq),
    ownerId: pf.ownerId,
    customerId: pf.customerId,
    proformaId: pf.id,
    proformaNumber: pf.number,
    quoteId: pf.quoteId ?? "",
    quoteNumber: pf.quoteNumber ?? "",
    poNumber: pf.referenceNo ?? "",
    billName: pf.billName,
    billAddress: pf.billAddress,
    billState: pf.billState,
    billContact: pf.billContact,
    billPhone: pf.billPhone,
    /* Shipping falls back to billing, as the document does. An order that
       ships to a blank address is not a useful order. */
    shipName: (pf.shipSameAsBilling === false && pf.shipName) || pf.billName,
    shipAddress: (pf.shipSameAsBilling === false && pf.shipAddress) || pf.billAddress,
    shipState: (pf.shipSameAsBilling === false && pf.shipState) || pf.billState,
    shipContact: (pf.shipSameAsBilling === false && pf.shipContact) || pf.billContact,
    shipPhone: (pf.shipSameAsBilling === false && pf.shipPhone) || pf.billPhone,
    currency: pf.currency,
    taxType: pf.taxType,
    stage: "confirmed",
    date: today,
    items: pf.items.map((it) => ({ ...it, id: uid() })),
    roundOff: pf.roundOff,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

/** Whether this proforma has already produced an order. */
export const alreadyHasOrder = (pf: { id: string }, orders: readonly SalesOrder[]): boolean =>
  orders.some((o) => o.proformaId === pf.id);

/**
 * A delivery challan for whatever is still pending on an order.
 *
 * Pre-filled with the outstanding quantities rather than the ordered ones:
 * the second challan on an order is for the remainder, and defaulting to the
 * full quantity invites shipping everything twice on paper.
 */
export function newChallan(
  order: SalesOrder,
  challans: readonly Challan[],
  settings: { dispatchPrefix?: string; dispatchSeq?: number },
  today: string = TODAY(),
): DeliveryChallan {
  return {
    id: uid(),
    number: buildDocNumber(settings.dispatchPrefix ?? "TZ/DC", settings.dispatchSeq),
    ownerId: order.ownerId,
    orderId: order.id,
    orderNumber: order.number,
    poNumber: order.poNumber ?? "",
    date: today,
    shipName: order.shipName || order.billName,
    shipAddress: order.shipAddress || order.billAddress,
    shipState: order.shipState || order.billState,
    shipPincode: order.shipPincode ?? "",
    shipContact: order.shipContact || order.billContact,
    shipPhone: order.shipPhone || order.billPhone,
    items: pendingLines(order, challans),
    transporter: "", vehicleNo: "", lrNo: "",
    courier: COURIERS[0],
    trackingNo: "", ewayBill: "",
    status: "Packed",
    dispatchDate: today,
    expectedDeliveryDate: "", deliveredDate: "",
    notes: "",
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

/**
 * The stage an order has reached, given what has shipped.
 *
 * Suggested, never applied automatically: an order can be fully dispatched
 * and still not delivered, and a human closing the loop is the point of the
 * stage. Screens offer this; they do not write it.
 */
export function suggestedStage(current: OrderStageId, pct: number): OrderStageId | null {
  if (current === "cancelled" || current === "closed" || current === "delivered") return null;
  if (pct >= 100 && current !== "dispatched") return "dispatched";
  if (pct > 0 && current === "confirmed") return "ready";
  return null;
}
