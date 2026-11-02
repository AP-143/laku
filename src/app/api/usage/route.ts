import { createDefaultUsageLedger } from "../../../server/usage-ledger";
import { createUsageHandler, type UsageHandler } from "../../../server/usage-handler";

let handler: UsageHandler | undefined;

export async function GET(request: Request) {
  handler ??= createUsageHandler(createDefaultUsageLedger());
  return handler(request);
}
