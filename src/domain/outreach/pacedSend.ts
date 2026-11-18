/**
 * Sending a long list in pieces, waiting out whatever the server asks it to.
 *
 * WHY THIS IS NOT INSIDE THE SCREEN ANY MORE. What it does is not a
 * rendering concern and it is the part most likely to be wrong: a piece
 * that comes back half-throttled has to record the ones that went, put the
 * ones that did not back at the FRONT of the queue, wait exactly as long as
 * it was told, and carry on — without recording anybody twice and without
 * losing anybody. Four chances to drop a customer, in code nothing could
 * reach to test.
 *
 * WHAT THE WAIT IS. Microsoft caps the BYTES one mailbox may upload in a
 * short window — about 150 MB in five minutes — so a mailshot carrying a
 * 2 MB profile runs out after roughly fifty messages. Everybody after that
 * comes back untouched. That is not a failure and not a limit the CRM
 * imposes; it is a window, and the only sensible thing to do with a window
 * is wait for it.
 */

export interface PacedMessage {
  /** What identifies this recipient in the answer. */
  email: string;
}

export interface PacedOutcome {
  email: string;
  ok: boolean;
  error: string | null;
  /** True when nothing reached them and trying again may work. */
  retryable: boolean;
}

export interface PacedAnswer {
  results: PacedOutcome[];
  /** Seconds the server says to wait before the rest can go. 0 for none. */
  throttledFor?: number;
}

export interface PacedProgress {
  done: number;
  total: number;
  /** Timestamp the current wait ends, or 0 when not waiting. */
  waitingUntil: number;
}

export interface PacedRun<T extends PacedMessage> {
  messages: readonly T[];
  chunkSize: number;
  /** Sends one piece and answers for each of them. */
  send: (piece: T[]) => Promise<PacedAnswer>;
  /** Waits. Injected so a test is not actually five minutes long. */
  wait: (ms: number) => Promise<void>;
  now?: () => number;
  onProgress?: (p: PacedProgress) => void;
  /** An honest ceiling rather than a loop that could run all afternoon.
   *  Ten windows is most of an hour, by which point something other than
   *  ordinary throttling is wrong. */
  maxWaits?: number;
}

export interface PacedResult {
  outcomes: Array<{ email: string; ok: boolean; error: string | null }>;
  /** How many times it sat out a window. */
  waited: number;
  /** Set when the send gave up part-way: nothing after this was attempted. */
  stopped: string;
}

export async function runPacedSend<T extends PacedMessage>({
  messages, chunkSize, send, wait, now = Date.now, onProgress, maxWaits = 10,
}: PacedRun<T>): Promise<PacedResult> {
  const outcomes: PacedResult["outcomes"] = [];
  const pending = [...messages];
  let waited = 0;
  let stopped = "";

  while (pending.length) {
    const piece = pending.splice(0, Math.max(1, chunkSize));

    let answer: PacedAnswer;
    try {
      answer = await send(piece);
    } catch (err) {
      /* The whole piece was refused — not signed in, no profile on file,
         rate limited. The rest would be refused the same way, so stop and
         keep what has already gone. */
      stopped = err instanceof Error && err.message ? err.message : "The send stopped before it finished.";
      break;
    }

    const waitFor = Number(answer.throttledFor) || 0;
    const willWait = waitFor > 0 && waited < maxWaits;

    /* THE UNTOUCHED ONES GO BACK, AT THE FRONT. They are still owed a
       message. Putting them at the back instead would reorder somebody's
       list for no reason, and recording them now would put the word
       "failed" against a customer nobody wrote to. */
    const heldBack = new Set<string>();
    if (willWait) {
      for (const r of answer.results) if (!r.ok && r.retryable) heldBack.add(r.email);
    }

    for (const r of answer.results) {
      if (heldBack.has(r.email)) continue;
      outcomes.push({ email: r.email, ok: r.ok, error: r.error });
    }
    if (heldBack.size) pending.unshift(...piece.filter((m) => heldBack.has(m.email)));

    onProgress?.({ done: outcomes.length, total: messages.length, waitingUntil: 0 });

    if (willWait) {
      waited += 1;
      const until = now() + waitFor * 1000;
      onProgress?.({ done: outcomes.length, total: messages.length, waitingUntil: until });
      await wait(waitFor * 1000);
      onProgress?.({ done: outcomes.length, total: messages.length, waitingUntil: 0 });
    }
  }

  return { outcomes, waited, stopped };
}
