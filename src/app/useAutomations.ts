import { useEffect, useRef, useState } from "react";
import type { WorkspaceData } from "../data/useWorkspace";
import type { Customer } from "../domain/customers/customer";
import type { SalesDocument } from "../domain/documents/create";
import { invoiceFrom, type DocSettings } from "../domain/documents/create";
import { orderFromProforma, type SalesOrder } from "../domain/orders/create";
import { applyStage } from "../domain/pipeline/stages";
import { computeDocument } from "../domain/tax/compute";
import { DEFAULT_PREFIX, buildDocNumber, fyLabel } from "../domain/numbering/docNumber";
import { OBJ_TYPE } from "../domain/documents/objType";
import { docSeries, nextDocNumber } from "../data/docNumber";
import { TODAY } from "../domain/dates";
import { isOffline } from "../data/offline";
import type { DocType } from "../domain/documents/model";
import { planAutomations, nextFollowUpDate, type AutoStamp, type FlowStep } from "../domain/automation/flow";

/**
 * Carries out what src/domain/automation/flow.ts decides, using the same
 * builders and number series a person's click uses.
 *
 * WHEN IT RUNS. A couple of seconds after the workspace changes — a save
 * here, a refetch bringing somebody else's change, a customer accepting in
 * the portal — and never while a previous run is still writing.
 *
 * ONE BROWSER AT A TIME. Two tabs of the same person would otherwise both
 * see "accepted, no order yet" and both raise one. The Web Locks API makes
 * the tabs take turns, and the stamp written by the first is what the
 * second then finds.
 */

type Stamped = { auto?: AutoStamp };
type ListKey = "quotations" | "proformas" | "invoices" | "subscriptions" | "orders";

export interface AutomationDeps {
  data: WorkspaceData;
  settings: Record<string, unknown>;
  user: { id: string; name: string; role: string };
  onChange: <K extends keyof WorkspaceData>(key: K, next: WorkspaceData[K]) => void;
  onCustomersChange: (next: Customer[]) => void;
  onSettingsNote?: (next: Record<string, unknown>) => void;
  notify?: (text: string) => void;
  enabled?: boolean;
}

const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

function withLock(fn: () => Promise<void>): Promise<void> {
  const locks = (globalThis.navigator as Navigator & { locks?: LockManager } | undefined)?.locks;
  if (!locks) return fn();
  return locks.request("techzoid-automations", { ifAvailable: true }, async (lock) => { if (lock) await fn(); })
    .then(() => undefined);
}

export function useAutomations(deps: AutomationDeps): void {
  const latest = useRef(deps);
  latest.current = deps;
  const busy = useRef(false);

  const d = deps.data;
  /* Back online is a reason to look again even when nothing changed. */
  const [online, setOnline] = useState(0);
  useEffect(() => {
    const on = () => setOnline((n) => n + 1);
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
  }, []);
  const signature = online + "#" + [d.customers, d.quotations, d.proformas, d.purchaseOrders, d.invoices, d.orders, d.subscriptions]
    .map((l) => l.length + ":" + l.reduce((a, r) => Math.max(a, Number((r as { updatedAt?: number }).updatedAt) || 0), 0))
    .join("|");

  useEffect(() => {
    if (deps.enabled === false) return;
    const t = setTimeout(() => {
      if (busy.current || isOffline()) return;
      busy.current = true;
      void withLock(() => run(latest.current))
        .catch((err) => console.error("automations:", err))
        .finally(() => { busy.current = false; });
    }, 2500);
    return () => clearTimeout(t);
  }, [signature, deps.enabled]);
}

/**
 * Documents saved offline carry a placeholder number. Once online, each
 * takes the next number from its series, exactly as if it had been saved
 * now — so two phones offline at once can never print the same number.
 */
async function assignOfflineNumbers(deps: AutomationDeps): Promise<boolean> {
  const lists: [keyof WorkspaceData, DocType][] = [
    ["quotations", "quotation"], ["proformas", "proforma"], ["invoices", "invoice"], ["purchaseOrders", "purchase_order"],
  ];
  let settings = { ...deps.settings };
  let any = false;
  for (const [key, type] of lists) {
    const docs = deps.data[key] as (SalesDocument & { offlineNumber?: string })[];
    if (!docs.some((d) => d.offlineNumber && d.ownerId === deps.user.id)) continue;
    const next = [];
    for (const d of docs) {
      if (!d.offlineNumber || d.ownerId !== deps.user.id) { next.push(d); continue; }
      const series = docSeries(type, settings);
      const at = new Date();
      const seq = await nextDocNumber(series.objType, fyLabel(at), series.kind, Number(settings[series.seqKey]) || 1);
      settings = { ...settings, [series.seqKey]: seq + 1 };
      const { offlineNumber: _drop, ...rest } = d;
      next.push({ ...rest, number: buildDocNumber(series.prefix, seq, at), autoNumber: false, updatedAt: Date.now() });
      deps.notify?.(`${d.number} is now ${buildDocNumber(series.prefix, seq, at)}`);
    }
    deps.onChange(key, next as never);
    any = true;
  }
  if (any) deps.onSettingsNote?.(settings);
  return any;
}

async function run(deps: AutomationDeps): Promise<void> {
  /* Placeholder numbers first; the rest runs on the next change. */
  if (await assignOfflineNumbers(deps)) return;
  if (deps.settings["automations"] === "off") return;
  const { data, settings, user } = deps;
  const sellerState = ((settings["company"] as { state?: string })?.state) ?? "Delhi";
  const grandOf = (doc: SalesDocument) => computeDocument(doc, sellerState).grand;
  const today = TODAY();
  const now = Date.now();

  const steps = planAutomations({
    customers: data.customers,
    quotations: data.quotations as (SalesDocument & Stamped)[],
    proformas: data.proformas as (SalesDocument & Stamped)[],
    invoices: data.invoices as (SalesDocument & Stamped)[],
    orders: data.orders as (SalesOrder & Stamped)[],
    subscriptions: data.subscriptions as WorkspaceData["subscriptions"],
    me: user, today, now, grandOf,
  });
  if (!steps.length) return;

  /* Work on copies, then hand each list over once. */
  let customers = [...data.customers];
  const lists: Record<ListKey, (Record<string, unknown> & { id: string })[]> = {
    quotations: [...data.quotations] as never,
    proformas: [...data.proformas] as never,
    invoices: [...data.invoices] as never,
    subscriptions: [...data.subscriptions] as never,
    orders: [...data.orders] as never,
  };
  const touched = new Set<ListKey | "customers">();
  let liveSettings = { ...settings };
  const said: string[] = [];

  const stamp = (list: ListKey, id: string, patch: AutoStamp) => {
    lists[list] = lists[list].map((r) => (r.id === id
      ? { ...r, auto: { ...((r as Stamped).auto ?? {}), ...patch } } : r));
    touched.add(list);
  };
  const updateCustomer = (id: string, fn: (c: Customer) => Customer) => {
    customers = customers.map((c) => (c.id === id ? { ...fn(c), updatedAt: now } : c));
    touched.add("customers");
  };

  for (const step of steps as FlowStep[]) {
    try {
      if (step.kind === "stage") {
        if (step.reason) {
          updateCustomer(step.customerId, (c) => {
            const next = applyStage(c, step.stage, now, { requote: step.requote });
            if (step.stage === "won" && c.stage !== "won" && step.value) next.wonValue = step.value;
            return next;
          });
          const c = customers.find((x) => x.id === step.customerId);
          said.push(`${c?.company || "Customer"} → ${step.stage === "won" ? "Won" : "Quotation Sent"} (${step.reason})`);
        }
        if (step.stamp) stamp(step.stamp.list, step.stamp.id, step.stamp.patch);
      }

      if (step.kind === "task") {
        updateCustomer(step.customerId, (c) => ({
          ...c,
          nextFollowUp: nextFollowUpDate(c.nextFollowUp, step.due, today),
          notes: [
            { id: uid("note"), ts: now, user: "Automation", userId: user.id, type: "Note", text: step.text, nextAction: step.text },
            ...(c.notes ?? []),
          ],
        }));
        stamp(step.stamp.list, step.stamp.id, step.stamp.patch);
        said.push(`Task: ${step.text.split(" — ")[0]}`);
      }

      if (step.kind === "order") {
        const at = new Date();
        const seq = await nextDocNumber(OBJ_TYPE.order, fyLabel(at), "order", Number(liveSettings["orderSeq"]) || 1);
        const base = orderFromProforma(step.source, liveSettings as DocSettings);
        const order: SalesOrder & Stamped = {
          ...base,
          number: buildDocNumber(String(liveSettings["orderPrefix"] ?? DEFAULT_PREFIX.order), seq, at),
          /* From a quotation, the link is the quotation — not a proforma
             that does not exist. */
          ...(step.from === "quotation"
            ? { proformaId: "", proformaNumber: "", quoteId: step.source.id, quoteNumber: step.source.number }
            : {}),
          notes: `Created automatically when ${step.source.number} was ${step.from === "quotation" ? "accepted" : "paid"}.`,
        };
        lists.orders = [order as never, ...lists.orders];
        touched.add("orders");
        liveSettings = { ...liveSettings, orderSeq: seq + 1 };
        stamp(step.from === "quotation" ? "quotations" : "proformas", step.source.id, { orderId: order.id });
        said.push(`Sales order ${order.number} created from ${step.source.number}`);
      }

      if (step.kind === "invoice") {
        const at = new Date();
        const series = docSeries("invoice", liveSettings);
        const seq = await nextDocNumber(series.objType, fyLabel(at), series.kind, Number(liveSettings[series.seqKey]) || 1);
        const draft = invoiceFrom(step.source, liveSettings as DocSettings, { id: step.order.ownerId, name: user.name });
        const inv = {
          ...draft,
          ownerId: step.order.ownerId,
          number: buildDocNumber(series.prefix, seq, at),
          autoNumber: false,
          status: "Draft",
          orderId: step.order.id,
          orderNumber: step.order.number,
        };
        lists.invoices = [inv as never, ...lists.invoices];
        touched.add("invoices");
        liveSettings = { ...liveSettings, [series.seqKey]: seq + 1 };
        stamp("orders", step.order.id, { invoiceId: inv.id });
        said.push(`Draft tax invoice ${inv.number} ready for ${step.order.number} — check and issue it`);
      }
    } catch (err) {
      /* One step failing (a counter that could not be drawn, say) must not
         stop the rest; it is tried again on the next change. */
      console.error("automation step failed:", step.kind, err);
    }
  }

  if (touched.has("customers")) deps.onCustomersChange(customers);
  for (const key of ["quotations", "proformas", "invoices", "subscriptions", "orders"] as ListKey[]) {
    if (touched.has(key)) deps.onChange(key, lists[key] as never);
  }
  if (liveSettings !== settings) deps.onSettingsNote?.(liveSettings);
  if (said.length) {
    const first = said[0]!.length > 90 ? said[0]!.slice(0, 88) + "…" : said[0];
    deps.notify?.(said.length === 1 ? `Done automatically: ${first}` : `Done automatically: ${first} (+${said.length - 1} more)`);
  }
}
