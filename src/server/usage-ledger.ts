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
   * Books `usd` only if the month's total would stay within `limit`; returns whether it did.
   * Check and booking happen as one step, so simultaneous requests cannot pass the limit together.
   * Give the money back with `record(-usd)` if the paid call then fails.
   */
  reserve(usd: number, limit: number): Promise<boolean>;
  /** The estimated spend of the current calendar month (UTC, like the gateway's billing month). */
  monthTotal(): Promise<number>;
}

const roundUsd = (usd: number) => Math.round(usd * 10_000) / 10_000;
const monthOf = (date: Date) => date.toISOString().slice(0, 7);

export function createUsageLedger(filePath: string, now: () => Date = () => new Date()): UsageLedger {
  async function record(usd: number) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await appendFile(filePath, `${JSON.stringify({ at: now().toISOString(), usd })}\n`);
  }

  // One reservation at a time within this process. (Several server processes would need a real lock.)
  let queue: Promise<unknown> = Promise.resolve();

  const ledger: UsageLedger = {
    record,

    reserve(usd, limit) {
      const turn = queue.then(async () => {
        if (roundUsd((await ledger.monthTotal()) + usd) > limit) return false;
        await record(usd);
        return true;
      });
      queue = turn.catch(() => undefined);
      return turn;
    },

    async monthTotal() {
      let text: string;
      try {
        text = await readFile(filePath, "utf8");
      } catch {
        return 0;
      }
      const thisMonth = monthOf(now());
      let total = 0;
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as { at: string; usd: number };
          if (entry.at.startsWith(thisMonth)) total += entry.usd;
        } catch {
          // A damaged line should not take the whole meter down.
        }
      }
      return roundUsd(total);
    },
  };
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
