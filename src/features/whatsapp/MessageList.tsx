import { Chip } from "../../components/primitives";
import type { WhatsAppMessage } from "../../data/whatsapp";

/**
 * A WhatsApp conversation, as a person reads it.
 *
 * Used on the customer record and in the Inbox, so the same message looks
 * the same in both places. Ours on the right, theirs on the left — the
 * arrangement everybody already knows from WhatsApp itself.
 *
 * THE STATUS IS SHOWN, NOT HIDDEN. "Sent" and "delivered" are different
 * facts, and "failed" is the one that needs somebody. A tick that means
 * four different things teaches people to ignore it, so this writes the
 * word.
 */

const WORD: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral" | "accent" }> = {
  queued: { label: "sending", tone: "neutral" },
  sent: { label: "sent", tone: "neutral" },
  delivered: { label: "delivered", tone: "good" },
  read: { label: "read", tone: "good" },
  failed: { label: "failed", tone: "bad" },
  received: { label: "", tone: "accent" },
};

const when = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
};

/** The template's name, written the way the settings screen writes it. */
const templateLabel = (name: string): string =>
  name ? name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "";

export function MessageList({ messages, emptyNote }: {
  messages: readonly WhatsAppMessage[];
  emptyNote?: string;
}) {
  if (!messages.length) {
    return <div className="muted">{emptyNote ?? "Nothing on WhatsApp yet."}</div>;
  }

  return (
    <div className="stack">
      {messages.map((m) => {
        const mine = m.direction === "out";
        const status = WORD[m.status] ?? { label: m.status, tone: "neutral" as const };
        return (
          <div
            key={m.id}
            style={{
              display: "flex",
              justifyContent: mine ? "flex-end" : "flex-start",
            }}
          >
            <div
              style={{
                maxWidth: "min(560px, 86%)",
                background: mine ? "var(--card-tint, #f1f6f1)" : "var(--card, #fff)",
                border: "1px solid var(--rule)",
                borderRadius: 10,
                padding: "8px 12px",
              }}
            >
              {/* What it was, when it was one of the eight. The customer saw
                  the approved wording; the CRM knows which one it was. */}
              {m.template ? (
                <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>
                  {templateLabel(m.template)}
                </div>
              ) : null}

              <div style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>
                {m.body || <span className="muted">(no text)</span>}
              </div>

              <div className="row-tight" style={{ marginTop: 4, fontSize: 11 }}>
                <span className="muted">{when(m.at)}</span>
                {mine && status.label ? <Chip tone={status.tone} dot={false}>{status.label}</Chip> : null}
              </div>

              {m.error ? (
                <div style={{ marginTop: 4, fontSize: 12, color: "var(--bad)" }}>{m.error}</div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
