import { CHAT_EVENTS_CONTENT_TYPE, encodeChatEvent, type ChatEvent } from "../shared/chat-events";
import type { ChatMessage, ModelClient } from "./model-client";

export type ChatHandler = (request: Request) => Promise<Response>;

const MODEL_FAILURE_MESSAGE = "Maaf, ada gangguan saat memproses pesanmu. Coba lagi ya.";
const INVALID_REQUEST_MESSAGE = "Pesanmu belum bisa dibaca. Tulis pesan dulu lalu kirim lagi ya.";

// Every accepted message costs model quota, so the size of a request is bounded before it reaches the model.
const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGES = 50;
const MAX_MESSAGE_CHARS = 4000;
const MAX_TOTAL_CHARS = 20_000;

/** Reads the body as text, giving up (undefined) as soon as it grows past the byte limit. */
async function readBoundedText(request: Request): Promise<string | undefined> {
  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_BODY_BYTES) return undefined;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_BODY_BYTES) {
      await reader.cancel();
      return undefined;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** Returns the conversation, or undefined when the request is not a valid, reasonably sized text turn. */
async function readConversation(request: Request): Promise<ChatMessage[] | undefined> {
  const raw = await readBoundedText(request);
  if (raw === undefined) return undefined;

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return undefined;
  }

  const messages = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) return undefined;

  const conversation: ChatMessage[] = [];
  let totalChars = 0;
  for (const message of messages) {
    const { role, text } = (message ?? {}) as Partial<ChatMessage>;
    if ((role !== "user" && role !== "assistant") || typeof text !== "string") return undefined;
    if (text.length > MAX_MESSAGE_CHARS) return undefined;
    totalChars += text.length;
    if (totalChars > MAX_TOTAL_CHARS) return undefined;
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

function eventResponse(
  run: (send: (event: ChatEvent) => void) => Promise<void>,
  init: { status?: number } = {},
): Response {
  return new Response(eventStream(run), { ...init, headers: { "content-type": CHAT_EVENTS_CONTENT_TYPE } });
}

export function createChatHandler(models: ModelClient): ChatHandler {
  return async (request) => {
    const conversation = await readConversation(request);

    if (!conversation) {
      return eventResponse(async (send) => send({ type: "error", message: INVALID_REQUEST_MESSAGE, retryable: false }), {
        status: 400,
      });
    }

    return eventResponse(async (send) => {
      try {
        for await (const text of models.streamChatReply(conversation)) {
          send({ type: "assistant_text", text });
        }
        send({ type: "done" });
      } catch {
        // No automatic retry: the user decides whether to try again.
        send({ type: "error", message: MODEL_FAILURE_MESSAGE, retryable: true });
      }
    });
  };
}
