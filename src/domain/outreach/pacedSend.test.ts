import { describe, expect, it } from "vitest";
import { runPacedSend, type PacedAnswer } from "./pacedSend";

const people = (n: number) => Array.from({ length: n }, (_, i) => ({ email: `p${i + 1}@x.example` }));

const ok = (p: { email: string }[]): PacedAnswer => ({
  results: p.map((m) => ({ email: m.email, ok: true, error: null, retryable: false })),
});

/** Accepts `room` messages, then throttles everybody else for `seconds`. */
function throttlingServer(room: number, seconds = 300) {
  let left = room;
  const calls: string[][] = [];
  const send = async (piece: { email: string }[]): Promise<PacedAnswer> => {
    calls.push(piece.map((m) => m.email));
    const going = piece.slice(0, Math.max(0, left));
    const held = piece.slice(Math.max(0, left));
    left -= going.length;
    return {
      throttledFor: held.length ? seconds : 0,
      results: [
        ...going.map((m) => ({ email: m.email, ok: true, error: null, retryable: false })),
        ...held.map((m) => ({ email: m.email, ok: false, error: "throttled", retryable: true })),
      ],
    };
  };
  return { send, calls, open: (more: number) => { left += more; } };
}

describe("sending a list in pieces", () => {
  it("sends everybody once, in order, when nothing gets in the way", async () => {
    const seen: string[][] = [];
    const out = await runPacedSend({
      messages: people(7), chunkSize: 3, wait: async () => {},
      send: async (p) => { seen.push(p.map((m) => m.email)); return ok(p); },
    });
    expect(seen).toEqual([
      ["p1@x.example", "p2@x.example", "p3@x.example"],
      ["p4@x.example", "p5@x.example", "p6@x.example"],
      ["p7@x.example"],
    ]);
    expect(out.outcomes).toHaveLength(7);
    expect(out.outcomes.every((o) => o.ok)).toBe(true);
    expect(out.waited).toBe(0);
  });
});

describe("when the mailbox runs out of upload budget", () => {
  /* The whole point: a list that would have reported half its customers as
     failures now finishes by itself. */
  it("waits out the window and sends the rest", async () => {
    const server = throttlingServer(4);
    const waits: number[] = [];
    const out = await runPacedSend({
      messages: people(10), chunkSize: 3, send: server.send,
      wait: async (ms) => { waits.push(ms); server.open(10); },
    });

    expect(out.outcomes).toHaveLength(10);
    expect(out.outcomes.every((o) => o.ok)).toBe(true);
    expect(out.waited).toBe(1);
    expect(waits).toEqual([300_000]);
  });

  /* NOBODY IS DELIVERED TWICE, which is not the same as nobody being
     ATTEMPTED twice. A throttled attempt handed nothing over — that is
     what makes it safe to try again — so those recipients do reach the
     server a second time, and only those. What must never happen is the
     same person being written to, or recorded, twice. */
  it("retries only the ones nothing reached, and records each person once", async () => {
    const server = throttlingServer(4);
    const out = await runPacedSend({
      messages: people(10), chunkSize: 3, send: server.send,
      wait: async () => { server.open(10); },
    });

    /* Each person recorded exactly once, in one state. */
    expect(out.outcomes).toHaveLength(10);
    expect(new Set(out.outcomes.map((o) => o.email)).size).toBe(10);

    /* The first four went straight away and were never attempted again.
       Only the ones the window turned away came back for a second try. */
    const attempts = new Map<string, number>();
    for (const email of server.calls.flat()) attempts.set(email, (attempts.get(email) ?? 0) + 1);
    expect(attempts.get("p1@x.example")).toBe(1);
    expect(attempts.get("p2@x.example")).toBe(1);
    expect(attempts.get("p5@x.example")).toBe(2);
    expect([...attempts.values()].every((n) => n <= 2)).toBe(true);
  });

  /* The ones that were never written to must not appear as failures — that
     is the whole fault this replaced: thirty red rows against thirty
     customers who were never contacted. */
  it("does not record an untouched recipient as failed", async () => {
    const server = throttlingServer(4);
    const out = await runPacedSend({
      messages: people(6), chunkSize: 6, send: server.send,
      wait: async () => { server.open(10); },
    });
    expect(out.outcomes.filter((o) => !o.ok)).toEqual([]);
  });

  it("keeps the list in its original order", async () => {
    const server = throttlingServer(4);
    const out = await runPacedSend({
      messages: people(8), chunkSize: 3, send: server.send,
      wait: async () => { server.open(10); },
    });
    expect(out.outcomes.map((o) => o.email)).toEqual(people(8).map((p) => p.email));
  });

  it("tells the screen it is waiting, and when the wait ends", async () => {
    const server = throttlingServer(2, 60);
    const seen: number[] = [];
    await runPacedSend({
      messages: people(4), chunkSize: 2, send: server.send,
      wait: async () => { server.open(10); },
      now: () => 1_000_000,
      onProgress: (p) => seen.push(p.waitingUntil),
    });
    /* It said "waiting until 1,060,000", then said it had stopped. */
    expect(seen).toContain(1_060_000);
    expect(seen.at(-1)).toBe(0);
  });

  /* An honest ceiling. A server that throttles for ever must not hold the
     screen open all afternoon — after the last wait the rest are recorded
     as they came back. */
  it("gives up after a fixed number of windows rather than looping for ever", async () => {
    const server = throttlingServer(0);
    const out = await runPacedSend({
      messages: people(4), chunkSize: 2, send: server.send,
      wait: async () => {}, maxWaits: 2,
    });
    expect(out.waited).toBe(2);
    expect(out.outcomes).toHaveLength(4);
    expect(out.outcomes.every((o) => !o.ok)).toBe(true);
  });
});

describe("when the whole piece is refused", () => {
  it("stops, keeps what already went, and says why", async () => {
    let call = 0;
    const out = await runPacedSend({
      messages: people(9), chunkSize: 3, wait: async () => {},
      send: async (p) => {
        call += 1;
        if (call === 2) throw new Error("Sign in required.");
        return ok(p);
      },
    });
    expect(out.outcomes).toHaveLength(3);
    expect(out.stopped).toBe("Sign in required.");
  });
});
