import { getDb, hasBackend } from "./backend";
import type { ProfileActivity, ProfileBill, ProfileContact, ProfileDeal } from "../domain/customers/profile";

/**
 * The parts of a customer's record that live outside the workspace.
 *
 * Contacts, activities, deals and bills are not in WorkspaceData, and adding
 * them would load every one of them on every screen to serve a panel that
 * opens for one customer at a time. Fetched here instead, for the customer
 * being looked at, when they are looked at.
 *
 * NOTHING HERE THROWS. A customer's record is still worth showing when one
 * of five queries fails — a missing deals list is a missing section, not a
 * blank screen, and the alternative is that one unavailable table takes the
 * whole record down with it.
 */

const rows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => String(v ?? "");
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export interface Customer360 {
  contacts: ProfileContact[];
  activities: ProfileActivity[];
  deals: ProfileDeal[];
  bills: ProfileBill[];
  /** Which sections could not be read, so the panel can say so rather than
   *  showing an empty one that looks like "nothing here". */
  unavailable: string[];
}

const EMPTY: Customer360 = { contacts: [], activities: [], deals: [], bills: [], unavailable: [] };

async function safely<T>(label: string, run: () => Promise<T>, fallback: T, failed: string[]): Promise<T> {
  try {
    return await run();
  } catch {
    failed.push(label);
    return fallback;
  }
}

export async function loadCustomer360(customerId: string): Promise<Customer360> {
  if (!customerId || !hasBackend()) return EMPTY;
  const db = getDb();
  const unavailable: string[] = [];

  const [contacts, activities, deals, bills] = await Promise.all([
    safely("contacts", async () => {
      const { data } = await db.from("contacts").select("id, name, email, phone, is_primary, data")
        .eq("customer_id", customerId);
      return rows(data).map((r): ProfileContact => ({
        id: str(r.id),
        name: str(r.name),
        email: str(r.email),
        phone: str(r.phone),
        role: str((r.data as { designation?: string } | null)?.designation ?? ""),
        isPrimary: !!r.is_primary,
      }));
    }, [] as ProfileContact[], unavailable),

    safely("activities", async () => {
      const { data } = await db.from("activities")
        .select("id, kind, occurred_at, data, owner_id")
        .eq("subject_type", "customer").eq("subject_id", customerId)
        .order("occurred_at", { ascending: false }).limit(50);
      return rows(data).map((r): ProfileActivity => ({
        id: str(r.id),
        kind: str(r.kind) || "note",
        at: str(r.occurred_at).slice(0, 10),
        summary: str((r.data as { summary?: string; subject?: string } | null)?.summary
          ?? (r.data as { subject?: string } | null)?.subject ?? ""),
        by: str(r.owner_id),
      }));
    }, [] as ProfileActivity[], unavailable),

    safely("deals", async () => {
      const { data } = await db.from("deals")
        .select("id, stage, value, currency, expected_close, data")
        .eq("customer_id", customerId);
      return rows(data).map((r): ProfileDeal => ({
        id: str(r.id),
        stage: str(r.stage),
        value: num(r.value),
        currency: str(r.currency) || "INR",
        expectedClose: str(r.expected_close).slice(0, 10),
        title: str((r.data as { title?: string } | null)?.title ?? ""),
      }));
    }, [] as ProfileDeal[], unavailable),

    safely("bills", async () => {
      const { data } = await db.from("payment_bills")
        .select("id, invoice_no, due_date, amount, amount_paid, currency, status")
        .eq("customer_id", customerId);
      const today = new Date().toISOString().slice(0, 10);
      return rows(data).map((r): ProfileBill => {
        const due = str(r.due_date).slice(0, 10);
        const days = due && due < today
          ? Math.round((Date.parse(today) - Date.parse(due)) / 86_400_000)
          : 0;
        return {
          id: str(r.id),
          invoiceNo: str(r.invoice_no),
          dueOn: due,
          balance: num(r.amount) - num(r.amount_paid),
          currency: str(r.currency) || "INR",
          daysOverdue: days,
        };
      });
    }, [] as ProfileBill[], unavailable),
  ]);

  return { contacts, activities, deals, bills, unavailable };
}
