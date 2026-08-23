import { useEffect, useMemo, useRef, useState } from "react";
import { PageHead } from "../../app/AppShell";
import { Button, Card, Empty, Textarea } from "../../components/primitives";
import { buildCrmContext, SUGGESTED_QUESTIONS, type TeamMember } from "../../domain/integrations/assistant";
import type { Workspace } from "../../domain/analytics/dashboard";
import { IntegrationError, type ChatMessage, type IntegrationsApi } from "../../integrations/api";

/**
 * The assistant.
 *
 * It answers from a summary of what this user can already see — the same
 * figures the dashboard shows — and it is told to say so when the summary
 * doesn't contain the answer. That constraint is the feature: an assistant
 * that invents a plausible revenue number is worse than no assistant, because
 * someone will quote it to a customer.
 */

export interface AssistantScreenProps {
  api: IntegrationsApi;
  workspace: Workspace;
  users: TeamMember[];
  currentUser: { id: string; name: string; role: string };
  settings: Record<string, unknown>;
}

export function AssistantScreen({ api, workspace, users, currentUser, settings }: AssistantScreenProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const foot = useRef<HTMLDivElement>(null);

  const company = (settings["company"] ?? {}) as { name?: string; state?: string };

  const context = useMemo(
    () => buildCrmContext(workspace, currentUser, users, company.state ?? "Delhi", company.name ?? "the company"),
    [workspace, currentUser, users, company.state, company.name],
  );

  useEffect(() => {
    foot.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  const ask = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;

    const next: ChatMessage[] = [...messages, { role: "user", content: question }];
    setMessages(next);
    setInput("");
    setError("");
    setBusy(true);
    try {
      const answer = await api.ask(context, next);
      setMessages([...next, { role: "assistant", content: answer || "I don't have an answer for that." }]);
    } catch (err) {
      /* The question stays on screen. Losing what someone typed because a
         request failed is the one thing a chat must never do. */
      setError(err instanceof IntegrationError ? err.message : "Couldn't reach the assistant.");
    }
    setBusy(false);
  };

  return (
    <main className="page" style={{ maxWidth: 980 }}>
      <PageHead
        title="Assistant"
        sub="Answers from your own records. It sees a summary, not the records themselves."
        actions={messages.length ? <Button tone="quiet" onClick={() => { setMessages([]); setError(""); }}>Start again</Button> : null}
      />

      <Card>
        {messages.length === 0 ? (
          <Empty
            title="Ask about what's in the CRM"
            body="Follow-ups, quotations waiting for a reply, renewals coming up, who your largest customers are."
          />
        ) : (
          <div className="chat">
            {messages.map((m, i) => (
              <div key={i} className={"chat-turn " + (m.role === "user" ? "chat-you" : "")}>
                <div className="chat-who">{m.role === "user" ? "You" : "Assistant"}</div>
                <div className="chat-text">{m.content}</div>
              </div>
            ))}
            {busy ? (
              <div className="chat-turn">
                <div className="chat-who">Assistant</div>
                <div className="chat-text muted">Thinking…</div>
              </div>
            ) : null}
            <div ref={foot} />
          </div>
        )}

        {error ? <div className="notice notice-bad" style={{ marginTop: 14 }}><span>{error}</span></div> : null}

        <div className="stack" style={{ marginTop: 16 }}>
          <div className="chat-prompts">
            {SUGGESTED_QUESTIONS.map((q) => (
              <Button key={q} size="sm" tone="default" disabled={busy} onClick={() => void ask(q)}>{q}</Button>
            ))}
          </div>
          <Textarea
            rows={3}
            value={input}
            placeholder="Ask a question…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              /* Enter sends; Shift+Enter breaks the line. A question is
                 usually one line, and reaching for a button every time is
                 the slower path. */
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(input);
              }
            }}
          />
          <div className="spread">
            <span className="field-hint">Enter to send, Shift + Enter for a new line.</span>
            <Button tone="primary" disabled={busy || !input.trim()} onClick={() => void ask(input)}>
              {busy ? "Asking…" : "Ask"}
            </Button>
          </div>
        </div>
      </Card>
    </main>
  );
}
