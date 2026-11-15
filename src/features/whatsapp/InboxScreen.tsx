import { useEffect, useMemo, useState } from "react";
import { PageHead } from "../../app/AppShell";
import { Button, Card, Chip, Empty, Input, Textarea } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import { MessageList } from "./MessageList";
import {
  WINDOW_HOURS, loadRecentMessages, replyOnWhatsApp, threadsFrom, windowOpen,
  type WhatsAppThread,
} from "../../data/whatsapp";
import type { Customer } from "../../domain/customers/customer";

/**
 * The WhatsApp Inbox.
 *
 * WHY THIS SCREEN HAS TO EXIST. The company's WhatsApp number is API-only:
 * there is no handset and no app, so a customer who replies is writing to
 * something nobody is holding. Without this screen their answer sits in a
 * database table and the conversation ends there — which is worse than not
 * having sent them anything.
 *
 * THE 24-HOUR WINDOW IS META'S RULE, not a setting. For a day after a
 * customer writes, you can answer in your own words. After that only the
 * approved templates may be sent, so the reply box goes away and says why
 * rather than letting somebody type a message that will be refused.
 */

export interface InboxScreenProps {
  companyId: string | null;
  customers: Customer[];
  /** Opens the customer record from a thread. */
  onOpenCustomer?: (customerId: string) => void;
}

export function InboxScreen({ companyId, customers, onOpenCustomer }: InboxScreenProps) {
  const toast = useToast();
  const [threads, setThreads] = useState<WhatsAppThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<string>("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [query, setQuery] = useState("");

  const refresh = async () => {
    if (!companyId) {
      setThreads([]);
      setLoading(false);
      return;
    }
    const all = threadsFrom(await loadRecentMessages(companyId));
    setThreads(all);
    setLoading(false);
    setActive((current) => current || all[0]?.phone || "");
  };

  useEffect(() => {
    setLoading(true);
    void refresh();
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- on arrival and when the company changes */
  }, [companyId]);

  const nameFor = (thread: WhatsAppThread): string => {
    const customer = thread.customerId ? customers.find((c) => c.id === thread.customerId) : null;
    return customer?.company || customer?.contact || thread.name || `+${thread.phone}`;
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) => `${nameFor(t)} ${t.phone}`.toLowerCase().includes(q));
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- nameFor reads customers, which is in scope */
  }, [threads, query, customers]);

  const thread = threads.find((t) => t.phone === active) ?? null;
  const open = thread ? windowOpen(thread.lastInboundAt) : false;
  const waiting = threads.filter((t) => t.unanswered).length;

  const send = async () => {
    if (!thread || !companyId || !draft.trim()) return;
    setSending(true);
    try {
      const out = await replyOnWhatsApp({
        companyId,
        customerId: thread.customerId ?? undefined,
        phone: thread.phone,
        body: draft.trim(),
      });
      if (out.ok) {
        setDraft("");
        await refresh();
        toast("Sent", "good");
      } else {
        toast(out.reason ?? "That did not send.", "bad");
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "That did not send.", "bad");
    }
    setSending(false);
  };

  return (
    <main className="page">
      <PageHead
        title="WhatsApp Inbox"
        sub={
          waiting
            ? `${waiting} ${waiting === 1 ? "conversation is" : "conversations are"} waiting for an answer.`
            : "Replies from customers. The business number has no handset — this is where it is answered."
        }
        actions={<Button tone="quiet" onClick={() => void refresh()}>Refresh</Button>}
      />

      {loading ? (
        <Card><div className="muted">Loading…</div></Card>
      ) : !threads.length ? (
        <Card>
          <Empty
            title="No WhatsApp conversations yet"
            body={
              "Messages sent from a quotation, an order or an invoice appear here, and so does anything a "
              + "customer sends back. If a customer has replied and nothing is here, check Settings → WhatsApp: "
              + "the address Meta calls has to be entered in Meta before replies can reach the CRM."
            }
          />
        </Card>
      ) : (
        <div className="split">
          {/* ── the threads ──────────────────────────────────────── */}
          <Card
            title={`Conversations${threads.length > 1 ? ` — ${threads.length}` : ""}`}
            actions={
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                aria-label="Search conversations"
              />
            }
          >
            <div className="stack" style={{ maxHeight: 520, overflow: "auto" }}>
              {shown.map((t) => (
                <button
                  key={t.phone}
                  type="button"
                  className="row-open"
                  onClick={() => { setActive(t.phone); setDraft(""); }}
                  style={{
                    textAlign: "left",
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid var(--rule)",
                    background: t.phone === active ? "var(--card-tint, #f6f4f0)" : "transparent",
                  }}
                >
                  <div className="row-tight wrap" style={{ justifyContent: "space-between" }}>
                    <strong>{nameFor(t)}</strong>
                    {t.unanswered ? <Chip tone="warn">needs an answer</Chip> : null}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {t.messages[t.messages.length - 1]?.body?.slice(0, 70) || "—"}
                  </div>
                </button>
              ))}
              {!shown.length ? <div className="muted">Nothing matches that.</div> : null}
            </div>
          </Card>

          {/* ── the conversation ─────────────────────────────────── */}
          <Card
            title={thread ? nameFor(thread) : "Conversation"}
            actions={
              thread?.customerId && onOpenCustomer ? (
                <Button size="sm" tone="quiet" onClick={() => onOpenCustomer(thread.customerId!)}>
                  Open the customer
                </Button>
              ) : null
            }
          >
            {!thread ? (
              <div className="muted">Choose a conversation.</div>
            ) : (
              <div className="stack">
                <div className="row-tight wrap">
                  <span className="muted">+{thread.phone}</span>
                  {!thread.customerId ? <Chip tone="warn">not on any customer record</Chip> : null}
                </div>

                <div style={{ maxHeight: 420, overflow: "auto" }}>
                  <MessageList messages={thread.messages} />
                </div>

                {open ? (
                  <div className="stack">
                    <Textarea
                      rows={3}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="Type your reply…"
                      aria-label="Your reply"
                    />
                    <div className="row-tight wrap">
                      <Button onClick={() => void send()} disabled={sending || !draft.trim()}>
                        {sending ? "Sending…" : "Send reply"}
                      </Button>
                      <span className="muted">
                        You can write freely for {WINDOW_HOURS} hours after their message.
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="notice notice-warn">
                    <span>
                      <strong>More than {WINDOW_HOURS} hours since they wrote.</strong> WhatsApp only allows a
                      message in your own words within a day of a customer's. After that, send one of the
                      approved messages from the quotation, order or invoice instead — or ring them.
                    </span>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      )}
    </main>
  );
}
