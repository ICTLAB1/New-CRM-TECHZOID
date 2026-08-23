/** Two-decimal rounding used everywhere money is summed.
 *  Kept as one function so rounding can never drift between call sites. */
export function round2(n: unknown): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}
