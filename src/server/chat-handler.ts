import { CHAT_EVENTS_CONTENT_TYPE, encodeChatEvent, type ChatEvent } from "../shared/chat-events";
import type { ChatMessage, GatewayClient } from "./gateway";

export type ChatHandler = (request: Request) => Promise<Response>;

const MODEL_FAILURE_MESSAGE = "Maaf, ada gangguan saat memproses pesanmu. Coba lagi ya.";
const INVALID_REQUEST_MESSAGE = "Pesanmu belum bisa dibaca. Tulis pesan dulu lalu kirim lagi ya.";

/** Returns the conversation, or undefined when the request is not a valid text turn. */
async function readConversation(request: Request): Promise<ChatMessage[] | undefined> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return undefined;
  }

  const messages = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return undefined;

  const conversation: ChatMessage[] = [];
  for (const message of messages) {
    const { role, text } = (message ?? {}) as Partial<ChatMessage>;
    if ((role !== "user" && role !== "assistant") || typeof text !== "string") return undefined;
    conversation.push({ role, text });
  }

  const last = conversation.at(-1)!;
  if (last.role !== "user" || last.text.trim() === "") return undefined;
  return conversation;
}

function eventStream(run: (send: (event: ChatEvent) => void) => Promise<void>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      await run((event) => controller.enqueue(encoder.encode(encodeChatEvent(event))));
      controller.close();
    },
  });
}

export function createChatHandler(gateway: GatewayClient): ChatHandler {
  return async (request) => {
    const conversation = await readConversation(request);

    if (!conversation) {
      const body = eventStream(async (send) => send({ type: "error", message: INVALID_REQUEST_MESSAGE, retryable: false }));
      return new Response(body, { status: 400, headers: { "content-type": CHAT_EVENTS_CONTENT_TYPE } });
    }

    const body = eventStream(async (send) => {
      try {
        for await (const text of gateway.streamChatReply(conversation)) {
          send({ type: "assistant_text", text });
        }
        send({ type: "done" });
      } catch {
        // No automatic retry: the user decides whether to try again.
        send({ type: "error", message: MODEL_FAILURE_MESSAGE, retryable: true });
      }
    });
    return new Response(body, { headers: { "content-type": CHAT_EVENTS_CONTENT_TYPE } });
  };
}
