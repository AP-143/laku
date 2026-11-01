import { createChatHandler, type ChatHandler } from "../../../server/chat-handler";
import { createDefaultGatewayClient } from "../../../server/gateway";

let handler: ChatHandler | undefined;

export async function POST(request: Request) {
  handler ??= createChatHandler(createDefaultGatewayClient());
  return handler(request);
}
