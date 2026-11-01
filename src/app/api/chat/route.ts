import { createChatHandler, type ChatHandler } from "../../../server/chat-handler";
import { createDefaultModelClient } from "../../../server/model-client";

let handler: ChatHandler | undefined;

export async function POST(request: Request) {
  handler ??= createChatHandler(createDefaultModelClient());
  return handler(request);
}
