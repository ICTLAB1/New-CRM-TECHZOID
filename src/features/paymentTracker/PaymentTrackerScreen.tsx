import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BellOff, BellRing, Camera, FileUp, Mail, MessageCircle, Plus, Settings2 } from "lucide-react";
import { PageHead } from "../../app/AppShell";
import { Button, Card, Chip, Empty, Input, Select } from "../../components/primitives";
import { Presence } from "../../components/Presence";
import { useToast } from "../../components/Toast";
import { fmtDate, TODAY } from "../../domain/dates";
import { moneyList } from "../../domain/currency/format";
import {
  daysBetween, outstandingOf, upcomingReminder, standingOf, type BillStanding,
} from "../../domain/paymentTracker/schedule";
import {
  listBills, listReminders, loadSettings, saveBill, trackerLive,
  type PaymentBill, type ReminderLog, type TrackerSettings, DEFAULT_SETTINGS, blankBill,
  scanInvoice, billFromScan,
} from "../../data/paymentTracker";
import { BillForm } from "./BillForm";
import { BillPanel } from "./BillPanel";
import { TrackerSettingsPanel } from "./TrackerSettingsPanel";
import { StandingChip } from "./StandingChip";
import "./paymentTracker.css";

/**
 * Payment Tracker — bills given on credit, and automatic reminders until
 * they are paid.
 *
 * A separate section: its own tables, its own reminder engine. It does not
 * read or change the CRM's invoices or Receivables.
 */

export interface PaymentTrackerProps {
  currentUser: { id: string; name: string; role: string; email?: string };
  users: { id: string; name: string; email?: string }[];
  customers: { id: string; company?: string; contact?: string; email?: string; phone?: string; gstin?: string }[];
  companyId: string | null;
}

type Lane = "critical" | "overdue" | "today" | "soon" | "later";

const LANES: { id: Lane; label: string; cls: string }[] = [
  { id: "critical", label: "30+ days overdue", cls: "pt-c-critical" },
  { id: "overdue", label: "Overdue", cls: "pt-c-overdue" },
  { id: "today", label: "Due today", cls: "pt-c-today" },
  { id: "soon", label: "Due in 7 days", cls: "pt-c-soon" },
  { id: "later", label: "Later", cls: "pt-c-later" },
];

const laneOf = (s: BillStanding): Lane | null =>
  s === "critical" ? "critical" : s === "overdue" ? "overdue" : s === "due_today" ? "today"
    : s === "due_soon" ? "soon" : s === "upcoming" ? "later" : null;

type View = "open" | "paid" | "all";

export function PaymentTrackerScreen({ currentUser, users, customers, companyId }: PaymentTrackerProps) {
  const toast = useToast();
  const today = TODAY();
  const privileged = currentUser.role === "Admin" || currentUser.role === "Manager";

  const [bills, setBills] = useState<PaymentBill[]>([]);
  const [logs, setLogs] = useState<ReminderLog[]>([]);
  const [settings, setSettings] = useState<TrackerSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [lane, setLane] = useState<Lane | "all">("all");
  const [view, setView] = useState<View>("open");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<PaymentBill | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  /* ── scanning invoices ── */
  type QueueItem = {
    bill: PaymentBill;
    scan: { fileName: string; previewUrl: string; isPdf: boolean; matched: string | null; notes: string; remaining: number };
  };
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [scanning, setScanning] = useState<{ done: number; total: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const scanFiles = async (list: FileList | File[] | null) => {
    const files = Array.from(list ?? []).slice(0, 20);
    if (files.length === 0 || scanning) return;
    setScanning({ done: 0, total: files.length });
    const sellers = [settings.companyName, "TechZoid Technologies"];
    const drafts: QueueItem[] = [];
    const failed: string[] = [];
    let done = 0;
    /* Three at a time: quick for a batch, gentle on the AI's rate limit. */
    const work = files.map((file) => async () => {
      const result = await scanInvoice(file, sellers);
      done += 1;
      setScanning({ done, total: files.length });
      if (!result.fields) { failed.push(`${result.fileName}: ${result.error}`); return; }
      const { bill, matched } = billFromScan(result.fields, customers, currentUser.id, companyId);
      drafts.push({
        bill,
        scan: {
          fileName: result.fileName,
          previewUrl: URL.createObjectURL(file),
          isPdf: file.type === "application/pdf" || /\.pdf$/i.test(file.name),
          matched,
          notes: result.fields.notes,
          remaining: 0,
        },
      });
    });
    const runners = Array.from({ length: Math.min(3, work.length) }, async () => {
      while (work.length) await work.shift()?.();
    });
    await Promise.all(runners);
    setScanning(null);
    if (failed.length) toast(`${failed.length} file(s) could not be read — ${failed[0]}`, "bad");
    if (drafts.length) {
      setQueue((cur) => [...cur, ...drafts]);
      toast(`${drafts.length} invoice(s) read — check each one and save`, "good");
    }
  };

  const nextInQueue = () => setQueue((cur) => {
    const [first, ...rest] = cur;
    if (first) URL.revokeObjectURL(first.scan.previewUrl);
    return rest;
  });

  const reload = useCallback(async () => {
    setLoadError(null);
    try {
      const [b, s] = await Promise.all([listBills(companyId), loadSettings(companyId)]);
      setBills(b);
      setSettings(s);
      setLogs(await listReminders(b.map((x) => x.id)));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { void reload(); }, [reload]);

  const nameOf = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users]);

  const rows = useMemo(() => bills.map((b) => {
    const standing = standingOf(b, today);
    return {
      bill: b,
      standing,
      lane: laneOf(standing),
      balance: outstandingOf(b),
      days: daysBetween(b.dueDate, today),
      next: settings.enabled
        ? upcomingReminder(b, today, new Set(logs.filter((l) => l.billId === b.id).map((l) => l.step)), settings.schedule)
        : null,
      last: logs.filter((l) => l.billId === b.id).sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0] ?? null,
    };
  }), [bills, logs, settings, today]);

  const open = rows.filter((r) => r.lane !== null);

  /* Per currency, never added across currencies. */
  const totals = (list: typeof rows) => {
    const by: Record<string, number> = {};
    for (const r of list) by[r.bill.currency] = (by[r.bill.currency] ?? 0) + r.balance;
    const parts = Object.entries(by).filter(([, v]) => v > 0).map(([c, v]) => moneyList(v, c));
    return parts.length ? parts.join(" + ") : moneyList(0, "INR");
  };
  const inr = (list: typeof rows) => list.filter((r) => r.bill.currency === "INR").reduce((a, r) => a + r.balance, 0);

  const overdueRows = open.filter((r) => r.days > 0);
  const totalInr = inr(open) || 1;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => (view === "open" ? r.lane !== null : view === "paid" ? r.lane === null : true))
      .filter((r) => (lane === "all" ? true : r.lane === lane))
      .filter((r) => !q || [r.bill.customerName, r.bill.invoiceNo, r.bill.contactName, r.bill.email]
        .some((v) => v.toLowerCase().includes(q)))
      .sort((a, b) => (view === "paid" ? b.bill.updatedAt.localeCompare(a.bill.updatedAt) : b.days - a.days));
  }, [rows, view, lane, query]);

  const upsertLocal = (b: PaymentBill) =>
    setBills((cur) => (cur.some((x) => x.id === b.id) ? cur.map((x) => (x.id === b.id ? b : x)) : [...cur, b]));

  const quickSave = async (b: PaymentBill, message: string) => {
    try {
      upsertLocal(await saveBill(b));
      toast(message, "good");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "bad");
    }
  };

  const opened = openId ? bills.find((b) => b.id === openId) ?? null : null;

  const autoOn = settings.enabled && (settings.emailOn || settings.whatsappOn);
  const dueToday = settings.enabled ? open.filter((r) => r.next === today).length : 0;

  return (
    <main className="page">
      <PageHead
        title="Payment Tracker"
        sub={
          <span className="row-tight wrap" style={{ gap: 10 }}>
            <span>{open.length} open bill(s) · {totals(open)} to collect</span>
            <span className={"pt-auto " + (autoOn ? "is-on" : "is-off")}>
              <span className="pt-pulse" />
              {autoOn
                ? `Auto-reminders on · ${[settings.emailOn && "email", settings.whatsappOn && "WhatsApp"].filter(Boolean).join(" + ")} · daily 9:30 am`
                : "Auto-reminders off"}
            </span>
          </span>
        }
        actions={
          <>
            <Button tone="quiet" onClick={() => setShowSettings(true)}>
              <Settings2 size={15} /> Reminder settings
            </Button>
            <Button tone="primary" onClick={() => setEditing(blankBill(currentUser.id, companyId))}>
              <Plus size={15} /> Add bill
            </Button>
          </>
        }
      />

      {!trackerLive() ? (
        <div className="field-hint" style={{ marginBottom: 12 }}>
          Demo workspace — these are sample bills, and nothing is sent to anyone.
        </div>
      ) : null}

      {loadError ? (
        <Card>
          <Empty
            title="The Payment Tracker could not load"
            body={/payment_/.test(loadError)
              ? "Its tables are not in the database yet. They are created automatically on the next deploy."
              : loadError}
            action={<Button onClick={() => void reload()}>Try again</Button>}
          />
        </Card>
      ) : (
        <>
          <div
            className={"pt-scan-drop" + (dragOver ? " is-over" : "")}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); void scanFiles(e.dataTransfer.files); }}
          >
            <div className="pt-scan-drop-text">
              <strong>{scanning ? `Reading invoice ${Math.min(scanning.done + 1, scanning.total)} of ${scanning.total}…` : "Scan or upload invoices"}</strong>
              {scanning
                ? "The details are filled in for you to check."
                : "Take a photo or drop PDFs here — the customer, amount, dates and credit days are filled in automatically."}
            </div>
            <Button loading={!!scanning} disabled={!!scanning} onClick={() => cameraInput.current?.click()}>
              <Camera size={15} /> Scan with camera
            </Button>
            <Button loading={!!scanning} disabled={!!scanning} onClick={() => fileInput.current?.click()}>
              <FileUp size={15} /> Upload invoices
            </Button>
            <input
              ref={cameraInput}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => { void scanFiles(e.target.files); e.target.value = ""; }}
            />
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf,image/*"
              multiple
              hidden
              onChange={(e) => { void scanFiles(e.target.files); e.target.value = ""; }}
            />
          </div>

          <section className="pt-health" aria-label="Collections">
            <div className="pt-health-head">
              <div>
                <div className="pt-big-label">Outstanding</div>
                <div className="pt-big">{totals(open)}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="pt-big-label">Overdue</div>
                <div className="pt-big" style={{ color: overdueRows.length ? "var(--bad)" : "var(--good)" }}>
                  {totals(overdueRows)}
                </div>
                <div className="pt-sub">
                  {overdueRows.length} bill(s) · {dueToday} reminder(s) due today
                </div>
              </div>
            </div>

            <div className="pt-bar" role="img" aria-label="Outstanding by age">
              {LANES.map((l) => {
                const v = inr(open.filter((r) => r.lane === l.id));
                return v > 0 ? <span key={l.id} className={l.cls} style={{ flexGrow: v / totalInr }} title={l.label} /> : null;
              })}
            </div>

            <div className="pt-lanes">
              {LANES.map((l) => {
                const list = open.filter((r) => r.lane === l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    className={"pt-lane" + (lane === l.id ? " is-on" : "")}
                    onClick={() => { setLane((cur) => (cur === l.id ? "all" : l.id)); setView("open"); }}
                  >
                    <div className="pt-lane-top"><span className={"pt-swatch " + l.cls} />{l.label}</div>
                    <div className="pt-lane-amt">{totals(list)}</div>
                    <div className="pt-lane-n">{list.length} bill(s)</div>
                  </button>
                );
              })}
            </div>
          </section>

          <Card padded={false}>
            <div className="row wrap" style={{ padding: "var(--gap) var(--gap-wide)" }}>
              <Input
                style={{ maxWidth: 280 }}
                placeholder="Search customer, invoice, contact…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <Select style={{ maxWidth: 160 }} value={view} onChange={(e) => { setView(e.target.value as View); setLane("all"); }}>
                <option value="open">Pending</option>
                <option value="paid">Paid / closed</option>
                <option value="all">All bills</option>
              </Select>
              {lane !== "all" ? (
                <Button size="sm" tone="quiet" onClick={() => setLane("all")}>
                  Clear: {LANES.find((l) => l.id === lane)?.label}
                </Button>
              ) : null}
              <span className="grow" />
              <span className="field-hint">{shown.length} shown</span>
            </div>

            {loading ? (
              <Empty title="Loading bills…" body="" />
            ) : shown.length === 0 ? (
              <Empty
                title={bills.length === 0 ? "No bills yet" : "Nothing matches"}
                body={bills.length === 0
                  ? "Add a bill given on credit. The tracker works out the due date and reminds the customer automatically until it is paid."
                  : "No bill matches those filters."}
                action={bills.length === 0
                  ? <Button tone="primary" onClick={() => setEditing(blankBill(currentUser.id, companyId))}><Plus size={15} /> Add the first bill</Button>
                  : undefined}
              />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 4 }} />
                      <th>Customer</th>
                      <th>Invoice</th>
                      <th>Due</th>
                      <th className="num">Amount</th>
                      <th className="num">Balance</th>
                      <th>Next reminder</th>
                      <th>Last reminder</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => {
                      const b = r.bill;
                      const closed = r.lane === null;
                      const paused = b.pausedUntil && b.pausedUntil >= today;
                      return (
                        <tr
                          key={b.id}
                          className={r.standing === "critical" ? "needs-warn" : undefined}
                          style={{ cursor: "pointer" }}
                          onClick={() => setOpenId(b.id)}
                        >
                          <td className="edge-cell" />
                          <td data-head>
                            <div className="strong">{b.customerName}</div>
                            <div className="pt-sub">{b.contactName || b.email || "—"}{privileged && b.ownerId ? ` · ${nameOf.get(b.ownerId) ?? ""}` : ""}</div>
                          </td>
                          <td data-label="Invoice">
                            <div className="mono">{b.invoiceNo}</div>
                            <div className="pt-sub">{fmtDate(b.invoiceDate)} · {b.creditDays} days credit</div>
                          </td>
                          <td data-label="Due" className="pt-due">
                            <div>{fmtDate(b.dueDate)}</div>
                            <StandingChip standing={r.standing} days={r.days} />
                          </td>
                          <td data-label="Amount" className="num muted">{moneyList(b.amount, b.currency)}</td>
                          <td data-label="Balance" className="num pt-bal">
                            {closed ? <Chip tone="good">{b.status === "written_off" ? "Written off" : "Paid"}</Chip> : moneyList(r.balance, b.currency)}
                            {!closed && b.amountPaid > 0 ? <div className="pt-sub">{moneyList(b.amountPaid, b.currency)} received</div> : null}
                          </td>
                          <td data-label="Next reminder">
                            {closed ? <span className="muted">—</span>
                              : !b.remindersOn ? <span className="pt-next muted"><BellOff size={13} /> Off</span>
                              : !settings.enabled ? <span className="pt-next muted"><BellOff size={13} /> All paused</span>
                              : paused ? <span className="pt-next" style={{ color: "var(--warn)" }}><BellOff size={13} /> Paused till {fmtDate(b.pausedUntil)}</span>
                              : r.next ? (
                                <span className="pt-next">
                                  <BellRing size={13} /> {r.next === today ? "Today" : fmtDate(r.next)}
                                  {settings.emailOn && b.email ? <Mail size={12} aria-label="email" /> : null}
                                  {settings.whatsappOn && b.phone ? <MessageCircle size={12} aria-label="WhatsApp" /> : null}
                                </span>
                              ) : <span className="muted">—</span>}
                          </td>
                          <td data-label="Last reminder">
                            {r.last ? (
                              <span>
                                <Chip tone={r.last.state === "sent" ? "good" : r.last.state === "failed" ? "bad" : "neutral"}>
                                  {r.last.state === "sent" ? "Sent" : r.last.state === "failed" ? "Failed" : "Sending"}
                                </Chip>
                                <div className="pt-sub">{fmtDate(r.last.sentOn)} · {r.last.channel === "whatsapp" ? "WhatsApp" : "Email"}</div>
                              </span>
                            ) : <span className="muted">None yet</span>}
                          </td>
                          <td data-actions onClick={(e) => e.stopPropagation()}>
                            {!closed ? (
                              <Button size="sm" onClick={() => setOpenId(b.id)}>Open</Button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      <Presence value={editing}>
        {(bill, isOpen) => (
          <BillForm
            open={isOpen}
            bill={bill}
            customers={customers}
            existing={bills}
            onClose={() => setEditing(null)}
            onSaved={(saved) => {
              upsertLocal(saved);
              setEditing(null);
              toast(`${saved.invoiceNo} saved — due ${fmtDate(saved.dueDate)}`, "good");
            }}
          />
        )}
      </Presence>

      <Presence value={editing ? null : queue[0] ?? null}>
        {(item, isOpen) => (
          <BillForm
            key={item.bill.id}
            open={isOpen}
            bill={item.bill}
            scan={{ ...item.scan, remaining: queue.length - 1 }}
            customers={customers}
            existing={bills}
            onClose={nextInQueue}
            onSaved={(saved) => {
              upsertLocal(saved);
              nextInQueue();
              toast(`${saved.invoiceNo} saved — due ${fmtDate(saved.dueDate)}`, "good");
            }}
          />
        )}
      </Presence>

      <Presence value={opened}>
        {(bill, isOpen) => (
          <BillPanel
            open={isOpen}
            bill={bill}
            logs={logs.filter((l) => l.billId === bill.id)}
            settings={settings}
            today={today}
            ownerName={nameOf.get(bill.ownerId) ?? ""}
            onClose={() => setOpenId(null)}
            onEdit={() => { setOpenId(null); setEditing(bill); }}
            onSave={quickSave}
            onDeleted={() => { setBills((cur) => cur.filter((b) => b.id !== bill.id)); setOpenId(null); }}
            onReminderSent={() => void reload()}
          />
        )}
      </Presence>

      <Presence value={showSettings ? settings : null}>
        {(s, isOpen) => (
          <TrackerSettingsPanel
            open={isOpen}
            settings={s}
            users={users}
            currentUser={currentUser}
            companyId={companyId}
            canEdit={privileged}
            onClose={() => setShowSettings(false)}
            onSaved={(next) => { setSettings(next); setShowSettings(false); toast("Reminder settings saved", "good"); }}
            onRan={() => void reload()}
          />
        )}
      </Presence>
    </main>
  );
}
