import { createDefaultAssetStore } from "../../../server/asset-store";
import { createChatHandler, type ChatHandler } from "../../../server/chat-handler";
import { createDefaultModelClient } from "../../../server/model-client";

let handler: ChatHandler | undefined;

export async function POST(request: Request) {
  handler ??= createChatHandler(createDefaultModelClient(), createDefaultAssetStore(), { log: console.info });
  return handler(request);
}
