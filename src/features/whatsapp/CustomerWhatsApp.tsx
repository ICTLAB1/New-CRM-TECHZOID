import { useEffect, useState } from "react";
import { Chip } from "../../components/primitives";
import { MessageList } from "./MessageList";
import { WINDOW_HOURS, loadCustomerMessages, windowOpen, type WhatsAppMessage } from "../../data/whatsapp";

/**
 * Every WhatsApp message to and from one customer, on their record.
 *
 * READ ONLY, DELIBERATELY. Answering in your own words is only allowed for a
 * day after the customer writes, and getting that wrong means typing a reply
 * that WhatsApp refuses — so answering lives in the Inbox, which knows the
 * window and hides the box when it has closed. What belongs here is the
 * question a person actually has when they open a customer: what have we
 * already said to them, and did it arrive?
 *
 * SHOWS NOTHING WHEN THERE IS NOTHING, rather than an empty box on every
 * customer record in the CRM.
 */
export function CustomerWhatsApp({ companyId, customerId }: {
  companyId: string | null;
  customerId: string;
}) {
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!companyId || !customerId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    void loadCustomerMessages(companyId, customerId)
      .then((rows) => { if (live) setMessages(rows); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [companyId, customerId]);

  if (loading || !messages.length) return null;

  const lastInbound = [...messages].reverse().find((m) => m.direction === "in");
  const waiting = messages[messages.length - 1]?.direction === "in";
  const failed = messages.filter((m) => m.status === "failed").length;

  return (
    <div className="stack">
      <div className="pt-section-title">
        WhatsApp
        <span className="muted"> · {messages.length}</span>
      </div>

      {waiting ? (
        <div className="row-tight wrap">
          <Chip tone="warn">waiting for an answer</Chip>
          <span className="muted">
            {lastInbound && windowOpen(lastInbound.at)
              ? `Answer in your own words from the WhatsApp Inbox — ${WINDOW_HOURS} hours from their message.`
              : "Answer from the WhatsApp Inbox."}
          </span>
        </div>
      ) : null}

      {failed ? (
        <div className="field-msg">
          {failed === 1 ? "One message" : `${failed} messages`} did not arrive. The reason is under each one.
        </div>
      ) : null}

      <MessageList messages={messages} />
    </div>
  );
}
