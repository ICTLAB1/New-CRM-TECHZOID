import { useCallback, useEffect, useState } from "react";
import { Button, Chip } from "../../components/primitives";
import { Modal } from "../../components/Modal";
import { fetchBroadcasts, markSeen, onBroadcast, seenIds } from "../../data/broadcasts";
import { pending, type Broadcast } from "../../domain/broadcasts/broadcasts";

/**
 * The message an admin has put on this person's screen.
 *
 * IT INTERRUPTS, so it is rationed: one at a time, shown once, and gone at
 * its expiry whether or not it was read. A popup that comes back is one
 * people learn to dismiss without reading — and then the one that mattered
 * is dismissed too.
 *
 * It arrives by three routes for the same reason the workspace refreshes by
 * three: the realtime insert if the socket is up, a refetch when somebody
 * comes back to the tab, and a slow poll underneath so a message still
 * lands on a project with Realtime switched off.
 */
const POLL_MS = 60_000;

export function BroadcastPopup({ names }: { names: Map<string, string> }) {
  const [queue, setQueue] = useState<Broadcast[]>([]);
  const [open, setOpen] = useState(false);

  const look = useCallback(async () => {
    const all = await fetchBroadcasts(names);
    const next = pending(all, seenIds());
    setQueue(next);
    if (next.length) setOpen(true);
  }, [names]);

  useEffect(() => {
    void look();
    const stop = onBroadcast(() => void look());
    const poll = setInterval(() => void look(), POLL_MS);
    const onFocus = () => void look();
    window.addEventListener("focus", onFocus);
    return () => {
      stop();
      clearInterval(poll);
      window.removeEventListener("focus", onFocus);
    };
  }, [look]);

  const current = queue[0];
  if (!current) return null;

  const dismiss = () => {
    markSeen(current.id);
    const rest = queue.slice(1);
    setQueue(rest);
    /* Straight on to the next one rather than closing and reopening — two
       messages should read as two messages, not as a flicker. */
    setOpen(rest.length > 0);
  };

  const tone = current.tone === "bad" ? "bad" : current.tone === "warn" ? "warn" : "accent";

  return (
    <Modal
      open={open}
      title={current.title || "A message for you"}
      description={
        current.fromName
          ? `From ${current.fromName}${current.toId ? " — to you" : " — to everyone"}`
          : current.toId ? "Sent to you" : "Sent to everyone"
      }
      onClose={dismiss}
      footer={
        <>
          {queue.length > 1 ? <span className="field-hint">{queue.length - 1} more after this</span> : null}
          <Button tone="primary" onClick={dismiss}>
            {queue.length > 1 ? "Next" : "Got it"}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Chip tone={tone}>
          {current.tone === "bad" ? "Stop" : current.tone === "warn" ? "Take care" : "Notice"}
        </Chip>
        {current.body ? <p className="note-text" style={{ fontSize: "var(--t-mid)" }}>{current.body}</p> : null}
        <p className="field-hint">
          This is shown once. It will not come back.
        </p>
      </div>
    </Modal>
  );
}
