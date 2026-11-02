import { readUsage, type UsageLedger } from "./usage-ledger";

export type UsageHandler = (request: Request) => Promise<Response>;

export function createUsageHandler(ledger: UsageLedger): UsageHandler {
  return async () => Response.json(await readUsage(ledger), { headers: { "cache-control": "no-store" } });
}
