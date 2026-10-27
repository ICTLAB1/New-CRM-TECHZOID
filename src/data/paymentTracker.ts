import { getDb, hasBackend } from "./backend";
import { fnPath, fnToken } from "./functions";
import { squashCompanyName } from "../domain/customers/nameMatch";
import { DEFAULT_SCHEDULE, dueDateFor, type ReminderSchedule } from "../domain/paymentTracker/schedule";
import { splitNumber } from "../domain/integrations/interakt";
import { localISO } from "../domain/dates";

/**
 * Payment Tracker — its own tables, read and written only from here.
 *
 * Separate from the CRM's invoices and Receivables on purpose: nothing in
 * this file touches a CRM table, and nothing outside the Payment Tracker
 * reads these. Without a database (demo mode) it runs on sample bills in
 * memory, so the screen can be seen before anything is set up.
 */

export interface PaymentEntry {
  id: string;
  amount: number;
  date: string;
  method: string;
  reference: string;
}

export type BillStatus = "open" | "paid" | "written_off";

export interface PaymentBill {
  id: string;
  ownerId: string;
  companyId: string | null;
  customerId: string | null;
  invoiceNo: string;
  customerName: string;
  contactName: string;
  email: string;
  cc: string;
  /** "+91 9810012345" — split for WhatsApp, or "" */
  phone: string;
  invoiceDate: string;
  creditDays: number;
  dueDate: string;
  amount: number;
  amountPaid: number;
  currency: string;
  status: BillStatus;
  remindersOn: boolean;
  pausedUntil: string | null;
  payments: PaymentEntry[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderLog {
  id: string;
  billId: string;
  step: string;
  channel: "email" | "whatsapp" | string;
  state: "sending" | "sent" | "failed" | string;
  sentOn: string;
  sendTo: string;
  error: string | null;
  createdAt: string;
}

export interface TrackerSettings {
  /** The master switch for every customer reminder. */
  enabled: boolean;
  emailOn: boolean;
  whatsappOn: boolean;
  /** Whose connected mailbox the reminders go out from. */
  sendFromUserId: string;
  /**
   * A SHARED mailbox to send every reminder from, winning over
   * `sendFromUserId` when set — an `email_accounts` row id.
   *
   * Chasing money is the company's job, not a salesperson's: the reply goes
   * to whoever is on accounts duty that week, and the thread survives the
   * owner being on leave or leaving. Empty keeps the old behaviour, where
   * each bill is chased by the person who owns it.
   */
  sendFromAccountId: string;
  ccEmails: string;
  replyTo: string;
  digestOn: boolean;
  digestTo: string;
  schedule: ReminderSchedule;
  waTemplates: { upcoming: string; due: string; overdue: string; firm: string; final: string };
  bank: { bankName: string; accountName: string; accountNumber: string; ifsc: string; upi: string };
  companyName: string;
  contactLine: string;
  signOff: string;
  appUrl: string;
}

export const DEFAULT_SETTINGS: TrackerSettings = {
  enabled: true,
  emailOn: true,
  whatsappOn: false,
  sendFromUserId: "",
  sendFromAccountId: "",
  ccEmails: "",
  replyTo: "",
  digestOn: true,
  digestTo: "",
  schedule: DEFAULT_SCHEDULE,
  waTemplates: {
    upcoming: "payment_due_reminder",
    due: "payment_due_reminder",
    overdue: "payment_overdue_reminder",
    firm: "payment_overdue_reminder",
    final: "payment_final_reminder",
  },
  bank: {
    bankName: "HDFC Bank",
    accountName: "TechZoid Technologies Private Limited",
    accountNumber: "50200058982457",
    ifsc: "HDFC0000331",
    upi: "",
  },
  companyName: "TechZoid Technologies Pvt. Ltd.",
  /* No phone number: asked for, and only the phone — the address is left as
     it was. This is what a brand-new company's row starts as and nothing
     more; a company already running has its own, edited in Payment tracker →
     Settings, and migration 050 is what took the number out of those. */
  contactLine: "For any queries, write to sales@techzoidtechnologies.com.",
  signOff: "Accounts Team\nTechZoid Technologies Pvt. Ltd.",
  appUrl: "https://crm.ttpldelhi.com",
};

export const trackerLive = (): boolean => hasBackend();

/** Phone as stored: "+CC national", or "" when it cannot be split safely. */
export function phoneForStorage(raw: string): string {
  if (!raw.trim()) return "";
  const split = splitNumber(raw);
  return split ? `${split.countryCode} ${split.phoneNumber}` : "";
}

const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

const paidOf = (payments: PaymentEntry[]): number =>
  Math.round(payments.reduce((a, p) => a + (Number(p.amount) || 0), 0) * 100) / 100;

/* ── row mapping ───────────────────────────────────────────────────── */

const str = (v: unknown) => (v == null ? "" : String(v));
const day = (v: unknown) => str(v).slice(0, 10);

function toBill(r: Record<string, unknown>): PaymentBill {
  const data = (r.data ?? {}) as { payments?: PaymentEntry[]; notes?: string };
  return {
    id: str(r.id),
    ownerId: str(r.owner_id),
    companyId: r.company_id ? str(r.company_id) : null,
    customerId: r.customer_id ? str(r.customer_id) : null,
    invoiceNo: str(r.invoice_no),
    customerName: str(r.customer_name),
    contactName: str(r.contact_name),
    email: str(r.email),
    cc: str(r.cc),
    phone: str(r.phone),
    invoiceDate: day(r.invoice_date),
    creditDays: Number(r.credit_days) || 0,
    dueDate: day(r.due_date),
    amount: Number(r.amount) || 0,
    amountPaid: Number(r.amount_paid) || 0,
    currency: str(r.currency) || "INR",
    status: (str(r.status) || "open") as BillStatus,
    remindersOn: r.reminders_on !== false,
    pausedUntil: r.paused_until ? day(r.paused_until) : null,
    payments: Array.isArray(data.payments) ? data.payments : [],
    notes: str(data.notes),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

function toRow(b: PaymentBill): Record<string, unknown> {
  return {
    id: b.id,
    owner_id: b.ownerId,
    ...(b.companyId ? { company_id: b.companyId } : {}),
    customer_id: b.customerId,
    invoice_no: b.invoiceNo.trim(),
    customer_name: b.customerName.trim(),
    contact_name: b.contactName.trim(),
    email: b.email.trim(),
    cc: b.cc.trim(),
    phone: b.phone,
    invoice_date: b.invoiceDate,
    credit_days: b.creditDays,
    due_date: b.dueDate,
    amount: b.amount,
    amount_paid: paidOf(b.payments),
    currency: b.currency,
    status: b.status,
    reminders_on: b.remindersOn,
    paused_until: b.pausedUntil,
    data: { payments: b.payments, notes: b.notes },
    updated_at: new Date().toISOString(),
  };
}

function toLog(r: Record<string, unknown>): ReminderLog {
  return {
    id: str(r.id), billId: str(r.bill_id), step: str(r.step), channel: str(r.channel),
    state: str(r.state), sentOn: day(r.sent_on), sendTo: str(r.send_to),
    error: r.error ? str(r.error) : null, createdAt: str(r.created_at),
  };
}

/* ── demo mode ─────────────────────────────────────────────────────── */

let demoBills: PaymentBill[] | null = null;
let demoSettings: TrackerSettings = { ...DEFAULT_SETTINGS };
const demoLogs: ReminderLog[] = [];

function sampleBills(): PaymentBill[] {
  const today = localISO(new Date());
  const make = (n: number, name: string, contact: string, daysAgo: number, credit: number, amount: number, paid = 0): PaymentBill => {
    const invoiceDate = dueDateFor(today, -daysAgo);
    return {
      id: "demo-" + n, ownerId: "", companyId: null, customerId: null,
      invoiceNo: `TZ/26-27/${String(140 + n).padStart(4, "0")}`, customerName: name, contactName: contact,
      email: (contact.split(" ")[0] ?? "accounts").toLowerCase() + "@example.com", cc: "", phone: "+91 98100" + String(10000 + n * 137).slice(0, 5),
      invoiceDate, creditDays: credit, dueDate: dueDateFor(invoiceDate, credit), amount, amountPaid: paid,
      currency: "INR", status: "open", remindersOn: true, pausedUntil: null,
      payments: paid ? [{ id: "p" + n, amount: paid, date: today, method: "Bank Transfer / NEFT / RTGS", reference: "UTR8812" }] : [],
      notes: "", createdAt: "", updatedAt: "",
    };
  };
  return [
    make(1, "Sharma Architects LLP", "Rohit Sharma", 78, 30, 245000),
    make(2, "Nimbus Infra Projects", "Kavita Rao", 41, 30, 486500, 200000),
    make(3, "Delhi Public School, Rohini", "Anil Mehta", 62, 60, 132160),
    make(4, "Arcadia Design Studio", "Priya Nair", 30, 30, 59000),
    make(5, "Vertex Engineering Pvt Ltd", "Sandeep Gupta", 25, 30, 318600),
    make(6, "Bluestone Interiors", "Megha Kapoor", 10, 45, 94400),
    make(7, "Ministry of Ports (GeM)", "S. K. Verma", 5, 60, 1180000),
    { ...make(8, "Orbit Media Works", "Farhan Ali", 50, 30, 70800, 70800), status: "paid" },
  ];
}

/* ── reads and writes ──────────────────────────────────────────────── */

export async function listBills(companyId: string | null): Promise<PaymentBill[]> {
  if (!hasBackend()) {
    demoBills ??= sampleBills();
    return demoBills.map((b) => ({ ...b }));
  }
  let q = getDb().from("payment_bills").select("*").order("due_date", { ascending: true }).limit(5000);
  if (companyId) q = q.eq("company_id", companyId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(toBill);
}

export async function saveBill(bill: PaymentBill): Promise<PaymentBill> {
  const next: PaymentBill = { ...bill, amountPaid: paidOf(bill.payments), updatedAt: new Date().toISOString() };
  if (!hasBackend()) {
    demoBills ??= sampleBills();
    const i = demoBills.findIndex((b) => b.id === next.id);
    if (i >= 0) demoBills[i] = next; else demoBills.push(next);
    return next;
  }
  const { data, error } = await getDb().from("payment_bills").upsert(toRow(next)).select("*");
  if (error) throw new Error(error.message);
  const row = (data as Record<string, unknown>[] | null)?.[0];
  return row ? toBill(row) : next;
}

export async function deleteBill(id: string): Promise<void> {
  if (!hasBackend()) {
    demoBills = (demoBills ?? []).filter((b) => b.id !== id);
    return;
  }
  const { error } = await getDb().from("payment_bills").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function listReminders(billIds: string[]): Promise<ReminderLog[]> {
  if (!hasBackend()) return demoLogs.filter((l) => billIds.includes(l.billId));
  if (billIds.length === 0) return [];
  const out: ReminderLog[] = [];
  for (let i = 0; i < billIds.length; i += 200) {
    const { data, error } = await getDb()
      .from("payment_reminders").select("*").in("bill_id", billIds.slice(i, i + 200))
      .order("created_at", { ascending: false }).limit(5000);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as Record<string, unknown>[]).map(toLog));
  }
  return out;
}

export async function loadSettings(companyId: string | null): Promise<TrackerSettings> {
  if (!hasBackend()) return { ...demoSettings };
  let q = getDb().from("payment_tracker_settings").select("data");
  if (companyId) q = q.eq("company_id", companyId);
  const { data, error } = await q.limit(1);
  if (error) throw new Error(error.message);
  const stored = ((data as { data?: Partial<TrackerSettings> }[] | null)?.[0]?.data ?? {}) as Partial<TrackerSettings>;
  return mergeSettings(stored);
}

export function mergeSettings(stored: Partial<TrackerSettings>): TrackerSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    schedule: { ...DEFAULT_SETTINGS.schedule, ...(stored.schedule ?? {}) },
    waTemplates: { ...DEFAULT_SETTINGS.waTemplates, ...(stored.waTemplates ?? {}) },
    bank: { ...DEFAULT_SETTINGS.bank, ...(stored.bank ?? {}) },
  };
}

export async function saveSettings(companyId: string | null, settings: TrackerSettings): Promise<void> {
  if (!hasBackend()) { demoSettings = { ...settings }; return; }
  /* lastDigestOn is the server's bookkeeping; keep whatever it wrote. */
  const { data: existing } = await (companyId
    ? getDb().from("payment_tracker_settings").select("data").eq("company_id", companyId).limit(1)
    : getDb().from("payment_tracker_settings").select("data").limit(1));
  const prior = ((existing as { data?: Record<string, unknown> }[] | null)?.[0]?.data ?? {}) as Record<string, unknown>;
  const row = {
    ...(companyId ? { company_id: companyId } : {}),
    data: { ...settings, ...(prior.lastDigestOn ? { lastDigestOn: prior.lastDigestOn } : {}) },
    updated_at: new Date().toISOString(),
  };
  const { error } = await getDb().from("payment_tracker_settings").upsert(row, { onConflict: "company_id" });
  if (error) throw new Error(error.message);
}

/* ── server actions ────────────────────────────────────────────────── */

async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (!hasBackend()) throw new Error("Sending needs the live CRM — this is the demo workspace.");
  const token = await fnToken();
  const resp = await fetch(fnPath("payment-reminders-send"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const json = (await resp.json().catch(() => ({}))) as T & { error?: string };
  if (!resp.ok) throw new Error(json?.error || `The server said ${resp.status}.`);
  return json;
}

export type SendOutcome = { state: "sent" | "failed" | "already"; error?: string };

export const sendNow = (billId: string, channels: ("email" | "whatsapp")[]) =>
  call<{ results: Record<string, SendOutcome> }>({ action: "send", billId, channels });

export const previewEmail = (billId: string) =>
  call<{ tone: string; subject: string; text: string; html: string }>({ action: "preview", billId });

export const sendTest = (companyId: string | null, to: string) =>
  call<{ sent: boolean; from: string | null }>({ action: "test", companyId, to });

export const runMorningNow = () =>
  call<{ ran: boolean; tally: Record<string, number> | null; note: string | null }>({ action: "run" });

export const serverStatus = () =>
  call<{ whatsappKey: boolean; resendKey: boolean; today: string }>({ action: "status" });

export function blankBill(ownerId: string, companyId: string | null): PaymentBill {
  const today = localISO(new Date());
  return {
    id: newId(), ownerId, companyId, customerId: null, invoiceNo: "", customerName: "", contactName: "",
    email: "", cc: "", phone: "", invoiceDate: today, creditDays: 30, dueDate: dueDateFor(today, 30),
    amount: 0, amountPaid: 0, currency: "INR", status: "open", remindersOn: true, pausedUntil: null,
    payments: [], notes: "", createdAt: "", updatedAt: "",
  };
}

export const newPaymentId = newId;

/* ── scanning an invoice ───────────────────────────────────────────── */

export interface ScannedInvoice {
  invoiceNo: string;
  invoiceDate: string;
  customerName: string;
  customerGstin: string;
  contactName: string;
  email: string;
  phone: string;
  amount: number;
  currency: string;
  creditDays: number | null;
  dueDate: string;
  poNumber: string;
  notes: string;
}

export interface ScanResult {
  fileName: string;
  fields?: ScannedInvoice;
  error?: string;
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read that file."));
    r.readAsDataURL(blob);
  });
}

/** Phone photos are 4–12 MB; 2000px JPEG reads just as well at a fraction. */
async function shrinkImage(file: File): Promise<{ data: string; mediaType: string }> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return { data: canvas.toDataURL("image/jpeg", 0.85), mediaType: "image/jpeg" };
  } catch {
    return { data: await readAsDataUrl(file), mediaType: file.type || "image/jpeg" };
  }
}

const SAMPLE_SCAN: ScannedInvoice = {
  invoiceNo: "TZ/26-27/0151", invoiceDate: localISO(new Date()), customerName: "Arcadia Design Studio",
  customerGstin: "07AABCA1234F1Z5", contactName: "Priya Nair", email: "priya@arcadia.example", phone: "+91 98111 22334",
  amount: 141600, currency: "INR", creditDays: 45, dueDate: "", poNumber: "PO-8812",
  notes: "Demo workspace — this is a sample reading, not your file.",
};

/** Read one invoice file with AI. Never throws — errors come back per file. */
export async function scanInvoice(file: File, sellerNames: string[]): Promise<ScanResult> {
  const fileName = file.name || "invoice";
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(fileName);
  const isImage = file.type.startsWith("image/");
  if (!isPdf && !isImage) return { fileName, error: "Only PDFs and photos can be read." };
  if (isPdf && file.size > MAX_FILE_BYTES) return { fileName, error: "That PDF is over 10 MB." };

  if (!hasBackend()) {
    await new Promise((r) => setTimeout(r, 900));
    return { fileName, fields: { ...SAMPLE_SCAN } };
  }

  try {
    const payload = isPdf
      ? { data: await readAsDataUrl(file), mediaType: "application/pdf" }
      : await shrinkImage(file);
    const token = await fnToken();
    const resp = await fetch(fnPath("payment-invoice-read"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ ...payload, fileName, sellerNames }),
    });
    const json = (await resp.json().catch(() => ({}))) as { fields?: ScannedInvoice; error?: string };
    if (!resp.ok || !json.fields) return { fileName, error: json.error || `Could not read it (${resp.status}).` };
    return { fileName, fields: json.fields };
  } catch (err) {
    return { fileName, error: err instanceof Error ? err.message : String(err) };
  }
}

interface CustomerLike { id: string; company?: string; contact?: string; email?: string; phone?: string; gstin?: string }

/* Shared with the quotation reader — see domain/customers/nameMatch.ts. */
const squash = squashCompanyName;

/** A new bill filled from a scanned invoice, matched to a CRM customer where possible. */
export function billFromScan(
  fields: ScannedInvoice,
  customers: CustomerLike[],
  ownerId: string,
  companyId: string | null,
): { bill: PaymentBill; matched: string | null } {
  const base = blankBill(ownerId, companyId);
  const byGstin = fields.customerGstin
    ? customers.find((c) => (c.gstin ?? "").toUpperCase() === fields.customerGstin)
    : undefined;
  const key = squash(fields.customerName);
  const byName = !byGstin && key.length >= 3 ? customers.find((c) => squash(c.company ?? "") === key) : undefined;
  const match = byGstin ?? byName;

  const invoiceDate = fields.invoiceDate || base.invoiceDate;
  const creditDays = fields.creditDays ?? (fields.dueDate && fields.dueDate >= invoiceDate
    ? Math.round((Date.parse(fields.dueDate) - Date.parse(invoiceDate)) / 86_400_000)
    : base.creditDays);
  const dueDate = fields.dueDate || dueDateFor(invoiceDate, creditDays);
  const notes = [fields.poNumber && `PO: ${fields.poNumber}`, fields.customerGstin && `GSTIN: ${fields.customerGstin}`]
    .filter(Boolean).join("\n");

  return {
    matched: match ? (match.company ?? null) : null,
    bill: {
      ...base,
      customerId: match?.id ?? null,
      customerName: match?.company || fields.customerName,
      invoiceNo: fields.invoiceNo,
      invoiceDate,
      creditDays,
      dueDate,
      amount: fields.amount,
      currency: fields.currency || "INR",
      contactName: fields.contactName || match?.contact || "",
      email: fields.email || match?.email || "",
      /* Raw: the form shows it and splits it for WhatsApp on save. */
      phone: fields.phone || match?.phone || "",
      notes,
    },
  };
}
