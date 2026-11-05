import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The usage meter's ledger: a local estimate of spend, one line per paid call.
 * It is only an estimate (the Google AI Studio balance is the real one) and it only counts: the app sets no spend
 * limit, so nothing here ever refuses a request.
 */
export interface UsageLedger {
  /** Books `usd`. Give the money back with `record(-usd)` if the paid call then fails. */
  record(usd: number): Promise<void>;
  /** The estimated spend of the current calendar month (UTC, like the billing month). */
  monthTotal(): Promise<number>;
}

const roundUsd = (usd: number) => Math.round(usd * 10_000) / 10_000;
const monthOf = (date: Date) => date.toISOString().slice(0, 7);

export function createUsageLedger(filePath: string, now: () => Date = () => new Date()): UsageLedger {
  async function record(usd: number) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await appendFile(filePath, `${JSON.stringify({ at: now().toISOString(), usd })}\n`);
  }

  const ledger: UsageLedger = {
    record,
    monthTotal: () => totalSince(monthOf(now())),
  };

  /** Sums every entry whose timestamp starts with `prefix` (a month such as "2026-11"). */
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
