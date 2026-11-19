import { useEffect, useMemo, useState } from "react";
import { PageHead } from "../../app/AppShell";
import { Button, Card, Chip, Empty, Input, Textarea } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import { MessageList } from "./MessageList";
import {
  WINDOW_HOURS, loadRecentMessages, replyOnWhatsApp, replyWindow, threadsFrom,
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
 *
 * ON A PHONE IT IS ONE PANE AT A TIME. Two cards side by side is a desktop
 * idea; under 960px `.split` stacks them, which put the whole conversation
 * — the messages AND the reply box — below a list that is itself 520px
 * tall and scrolls inside itself. Reported, from a phone, as "there is no
 * chatting option in this": the list filled the screen and the chat was
 * off the bottom of it. So the list and the conversation take turns, the
 * way every messaging app on a phone does it, with a way back. The desktop
 * is unchanged and still shows both.
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
  /* Which pane a PHONE is showing. `active` cannot stand in for it: a
     thread is made active automatically on arrival so the desktop's right
     half is never blank, and a phone opening straight into a conversation
     nobody chose would hide the list behind a Back button. */
  const [reading, setReading] = useState(false);

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
  /* Three cases, not two: open, closed, and never written. See
     replyWindow — "closed" said about somebody who has never messaged
     reads as the CRM having lost their messages. */
  const canReply = thread ? replyWindow(thread.lastInboundAt) : "never";
  const open = canReply === "open";
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
        <div className="split inbox-split" data-phone-pane={reading ? "thread" : "list"}>
          {/* ── the threads ──────────────────────────────────────── */}
          <Card
            className="inbox-pane-list"
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
            {/* The inner scrollbox is for the DESKTOP, where the list sits
                beside the conversation and must not push the page down.
                On a phone the list is the whole screen and a box that
                scrolls inside a page that also scrolls is the thing that
                eats a tap. See .inbox-threads. */}
            <div className="stack inbox-threads">
              {shown.map((t) => (
                <button
                  key={t.phone}
                  type="button"
                  className="row-open"
                  onClick={() => { setActive(t.phone); setDraft(""); setReading(true); }}
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
            className="inbox-pane-thread"
            title={thread ? nameFor(thread) : "Conversation"}
            actions={
              <>
                {/* Phone only: the list is hidden behind this. On the
                    desktop both panes are on screen, so a Back that goes
                    nowhere would be a button that does nothing. */}
                <Button
                  size="sm"
                  tone="quiet"
                  className="mobile-only"
                  onClick={() => setReading(false)}
                >
                  ← All chats
                </Button>
                {thread?.customerId && onOpenCustomer ? (
                  <Button size="sm" tone="quiet" onClick={() => onOpenCustomer(thread.customerId!)}>
                    Open the customer
                  </Button>
                ) : null}
              </>
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
                ) : canReply === "never" ? (
                  <div className="notice notice-warn">
                    <span>
                      <strong>They have not written to you on WhatsApp yet.</strong> WhatsApp only lets you
                      type a message in your own words once a customer has messaged you, and then for{" "}
                      {WINDOW_HOURS} hours. Until they do, send one of the approved messages from their
                      quotation, proforma, order or invoice — or ring them. Their reply will open this box.
                    </span>
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
