import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A figure that counts up to its value, and glides to a new one when it
 * changes.
 *
 * It takes the text exactly as the screen would show it — "₹23,15,660",
 * "₹1.24 Cr + AED 2.14M", "7 deals" — and animates only the numbers inside,
 * keeping every symbol, unit and grouping style (Indian 23,15,660 or western
 * 2,315,660) exactly as given. The final frame is always the original text,
 * character for character, so nothing a person reads can drift.
 *
 * Anything that is not plain text (an element) is shown as-is.
 */

const NUM = /\d[\d,]*(?:\.\d+)?/g;

interface Token { value: number; decimals: number; grouping: "in" | "west" | "none" }

function parse(text: string): { parts: string[]; tokens: Token[] } {
  const parts: string[] = [];
  const tokens: Token[] = [];
  let last = 0;
  for (const m of text.matchAll(NUM)) {
    const raw = m[0];
    parts.push(text.slice(last, m.index));
    const [int = "", frac = ""] = raw.split(".");
    const groups = int.split(",");
    /* 23,15,660 is Indian (pairs before the last three); 2,315,660 is
       western. With only two groups the two styles print identically for
       every value the count passes through, so either will do. */
    const grouping: Token["grouping"] = groups.length === 1 ? "none"
      : groups[groups.length - 2]!.length === 3 ? "west"
      : "in";
    tokens.push({ value: Number(raw.replace(/,/g, "")), decimals: frac.length, grouping });
    last = (m.index ?? 0) + raw.length;
  }
  parts.push(text.slice(last));
  return { parts, tokens };
}

function format(n: number, t: Token): string {
  if (t.grouping === "none") return n.toFixed(t.decimals);
  return n.toLocaleString(t.grouping === "in" ? "en-IN" : "en-US", {
    minimumFractionDigits: t.decimals,
    maximumFractionDigits: t.decimals,
  });
}

const reduced = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/* A long, soft landing: most of the climb happens early, then it settles. */
const easeOutExpo = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));

export function AnimatedNumber({ value, duration = 900 }: { value: ReactNode; duration?: number }) {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value : null;
  const [shown, setShown] = useState<string | null>(() => (text === null || reduced() ? text : zeroed(text)));
  const from = useRef<number[] | null>(null);

  useEffect(() => {
    if (text === null) return;
    if (reduced()) { setShown(text); return; }
    const { parts, tokens } = parse(text);
    if (tokens.length === 0) { setShown(text); return; }

    /* Glide from wherever the figure was; the first time, from zero. */
    const start = from.current && from.current.length === tokens.length ? from.current : tokens.map(() => 0);
    const t0 = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const p = easeOutExpo(Math.min(1, (now - t0) / duration));
      const current = tokens.map((t, i) => start[i]! + (t.value - start[i]!) * p);
      from.current = current;
      if (p >= 1) { setShown(text); return; }
      let out = parts[0] ?? "";
      tokens.forEach((t, i) => { out += format(current[i]!, t) + (parts[i + 1] ?? ""); });
      setShown(out);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, duration]);

  if (text === null) return <>{value}</>;
  return (
    <span className="num-anim" aria-label={text}>
      <span aria-hidden>{shown ?? text}</span>
    </span>
  );
}

function zeroed(text: string): string {
  const { parts, tokens } = parse(text);
  if (tokens.length === 0) return text;
  let out = parts[0] ?? "";
  tokens.forEach((t, i) => { out += format(0, t) + (parts[i + 1] ?? ""); });
  return out;
}

export const __test = { parse, format };
