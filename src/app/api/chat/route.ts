import { createDefaultAssetStore } from "../../../server/asset-store";
import { createChatHandler, type ChatHandler } from "../../../server/chat-handler";
import { createDefaultModelClient } from "../../../server/model-client";
import { createDefaultUsageLedger } from "../../../server/usage-ledger";

let handler: ChatHandler | undefined;

export async function POST(request: Request) {
  handler ??= createChatHandler(createDefaultModelClient(), createDefaultAssetStore(), createDefaultUsageLedger(), { log: console.info });
  return handler(request);
}
