import type { Tone } from "../../components/primitives";

/** Sales order stages. Ids are stored in the live database — do not rename. */
export type OrderStageId =
  | "confirmed" | "procurement" | "ready" | "dispatched" | "delivered" | "closed" | "cancelled";

export interface OrderStage {
  id: OrderStageId;
  label: string;
  tone: Tone;
  /** Stages an order still has work left in. */
  open: boolean;
}

export const ORDER_STAGES: readonly OrderStage[] = [
  { id: "confirmed", label: "Order Confirmed", tone: "accent", open: true },
  { id: "procurement", label: "Procurement / Vendor PO", tone: "accent", open: true },
  { id: "ready", label: "Ready to Dispatch", tone: "warn", open: true },
  { id: "dispatched", label: "Dispatched", tone: "warn", open: true },
  { id: "delivered", label: "Delivered", tone: "good", open: false },
  { id: "closed", label: "Closed", tone: "neutral", open: false },
  { id: "cancelled", label: "Cancelled", tone: "bad", open: false },
];

export const orderStageOf = (id: string | null | undefined): OrderStage =>
  ORDER_STAGES.find((s) => s.id === id) ?? (ORDER_STAGES[0] as OrderStage);

export const ORDER_TYPES = [
  "Digital / Licences", "Hardware", "Mixed (Licences + Hardware)", "Services",
] as const;

export const DISPATCH_STATUSES = ["Packed", "Dispatched", "In Transit", "Delivered", "Returned"] as const;
export type DispatchStatus = (typeof DISPATCH_STATUSES)[number];

export const DISPATCH_TONE: Record<DispatchStatus, Tone> = {
  Packed: "neutral", Dispatched: "accent", "In Transit": "warn", Delivered: "good", Returned: "bad",
};

export const COURIERS = [
  "Self Delivery / Local Van", "DHL Express", "FedEx", "Bluedart", "DTDC",
  "Delhivery", "India Post", "Vendor Direct Shipment", "Other",
] as const;
