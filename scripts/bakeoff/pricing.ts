/**
 * Cost helpers for the bake-off. Prices live in `src/config/models.ts` (copied from Google's pricing page),
 * because Google has no live price catalogue to read at run time.
 */

export interface Estimate {
  usd: number;
  /** True when the price is derived or assumed and not stated per call on Google's pricing page. */
  guessed: boolean;
}

export function formatUsd(amount: number): string {
  return `US$${amount.toFixed(3)}`;
}
