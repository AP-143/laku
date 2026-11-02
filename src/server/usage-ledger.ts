import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { COSTS } from "../config/models";

/**
 * The usage meter's ledger: a local estimate of spend, one line per paid call.
 * It is only an estimate (the gateway has the real balance), but it is what the UI shows
 * and what stops the app from planning past the free credit.
 */
export interface UsageLedger {
  record(usd: number): Promise<void>;
  /**
   * Books `usd` only if both the month's and today's total would stay within their limits; says which
   * limit refused it otherwise (the monthly one first, since it is the harder stop).
   * Check and booking happen as one step, so simultaneous requests cannot pass a limit together.
   * Give the money back with `record(-usd)` if the paid call then fails.
   */
  reserve(usd: number, limits: SpendLimits): Promise<Reservation>;
  /** The estimated spend of the current calendar month (UTC, like the billing month). */
  monthTotal(): Promise<number>;
  /** The estimated spend of the current UTC day. */
  dayTotal(): Promise<number>;
}

export interface SpendLimits {
  monthlyUsd: number;
  dailyUsd: number;
}

export type Reservation =
  | { ok: true }
  | { ok: false; limit: "monthly" }
  /** The day ends at 00:00 UTC; `resetsAt` is when today's total starts again from zero. */
  | { ok: false; limit: "daily"; resetsAt: Date };

const roundUsd = (usd: number) => Math.round(usd * 10_000) / 10_000;
const monthOf = (date: Date) => date.toISOString().slice(0, 7);
const dayOf = (date: Date) => date.toISOString().slice(0, 10);
const nextDayStart = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));

export function createUsageLedger(filePath: string, now: () => Date = () => new Date()): UsageLedger {
  async function record(usd: number) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await appendFile(filePath, `${JSON.stringify({ at: now().toISOString(), usd })}\n`);
  }

  // One reservation at a time within this process. (Several server processes would need a real lock.)
  let queue: Promise<unknown> = Promise.resolve();

  const ledger: UsageLedger = {
    record,

    reserve(usd, limits) {
      const turn = queue.then(async (): Promise<Reservation> => {
        if (roundUsd((await ledger.monthTotal()) + usd) > limits.monthlyUsd) return { ok: false, limit: "monthly" };
        if (roundUsd((await ledger.dayTotal()) + usd) > limits.dailyUsd) {
          return { ok: false, limit: "daily", resetsAt: nextDayStart(now()) };
        }
        await record(usd);
        return { ok: true };
      });
      queue = turn.catch(() => undefined);
      return turn;
    },

    monthTotal: () => totalSince(monthOf(now())),
    dayTotal: () => totalSince(dayOf(now())),
  };

  /** Sums every entry whose timestamp starts with `prefix` (a month "2026-11" or a day "2026-11-15"). */
  async function totalSince(prefix: string) {
    let text: string;
    try {
      text = await readFile(filePath, "utf8");
    } catch {
      return 0;
    }
    let total = 0;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as { at: string; usd: number };
        if (entry.at.startsWith(prefix)) total += entry.usd;
      } catch {
        // A damaged line should not take the whole meter down.
      }
    }
    return roundUsd(total);
  }
  return ledger;
}

export function createDefaultUsageLedger(): UsageLedger {
  return createUsageLedger(path.resolve("storage", "usage-ledger.jsonl"));
}

/** What the UI shows: this month's estimate against the free credit. */
export async function readUsage(ledger: UsageLedger) {
  const monthUsd = await ledger.monthTotal();
  const budgetUsd = COSTS.monthlyBudgetUsd;
  return { monthUsd, budgetUsd, remainingUsd: roundUsd(Math.max(0, budgetUsd - monthUsd)) };
}
