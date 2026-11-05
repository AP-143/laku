import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The usage meter's ledger: a local estimate of spend, one line per paid call.
 * It is only an estimate (the Google AI Studio balance is the real one), but it is what the UI shows
 * and what stops the app from planning past the daily limit. There is no monthly limit: the prepaid balance is the stop.
 */
export interface UsageLedger {
  record(usd: number): Promise<void>;
  /**
   * Books `usd` only if today's total would stay within the daily limit; says when the day resets otherwise.
   * Check and booking happen as one step, so simultaneous requests cannot pass the limit together.
   * Give the money back with `record(-usd)` if the paid call then fails.
   */
  reserve(usd: number, limits: SpendLimits): Promise<Reservation>;
  /** The estimated spend of the current calendar month (UTC, like the billing month). */
  monthTotal(): Promise<number>;
  /** The estimated spend of the current UTC day. */
  dayTotal(): Promise<number>;
}

export interface SpendLimits {
  dailyUsd: number;
}

export type Reservation =
  | { ok: true }
  /** The day ends at 00:00 UTC; `resetsAt` is when today's total starts again from zero. */
  | { ok: false; resetsAt: Date };

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
        const day = await ledger.dayTotal();
        if (roundUsd(day + usd) > limits.dailyUsd) return { ok: false, resetsAt: nextDayStart(now()) };
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

/** What the UI shows: this month's estimated spend. */
export async function readUsage(ledger: UsageLedger) {
  return { monthUsd: await ledger.monthTotal() };
}
