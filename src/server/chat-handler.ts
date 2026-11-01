import { isAssetId, type AssetFile, type AssetStore } from "./asset-store";
import { readBoundedBytes } from "./bounded-body";
import { eventResponse } from "./event-response";
import type { ChatMessage, ModelClient } from "./model-client";

export type ChatHandler = (request: Request) => Promise<Response>;

const MODEL_FAILURE_MESSAGE = "Maaf, ada gangguan saat memproses pesanmu. Coba lagi ya.";
const INVALID_REQUEST_MESSAGE = "Pesanmu belum bisa dibaca. Tulis pesan dulu lalu kirim lagi ya.";
const PHOTO_NOT_FOUND_MESSAGE = "Fotonya tidak ketemu. Coba unggah lagi ya.";
const NOT_A_PRODUCT_MESSAGE =
  "Maaf, saat ini aku hanya bisa memproses foto produk. Coba kirim foto barang yang mau kamu jual ya.";

// Every accepted message costs model quota, so the size of a request is bounded before it reaches the model.
const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGES = 50;
const MAX_MESSAGE_CHARS = 4000;
const MAX_TOTAL_CHARS = 20_000;

interface Conversation {
  messages: ChatMessage[];
  /** The photo attached to the last message, if any. */
  photoAssetId?: string;
}

/** Returns the conversation, or undefined when the request is not a valid, reasonably sized turn. */
async function readConversation(request: Request): Promise<Conversation | undefined> {
  const bytes = await readBoundedBytes(request, MAX_BODY_BYTES);
  if (!bytes) return undefined;

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }

  const messages = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) return undefined;

  const conversation: ChatMessage[] = [];
  const photoIds: Array<string | undefined> = [];
  let totalChars = 0;
  for (const message of messages) {
    const { role, text, photoAssetId } = (message ?? {}) as Partial<ChatMessage> & { photoAssetId?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof text !== "string") return undefined;
    if (photoAssetId !== undefined && (typeof photoAssetId !== "string" || !isAssetId(photoAssetId))) return undefined;
    if (text.length > MAX_MESSAGE_CHARS) return undefined;
    totalChars += text.length;
    if (totalChars > MAX_TOTAL_CHARS) return undefined;
    conversation.push({ role, text });
    photoIds.push(photoAssetId);
  }

  // A photo alone is a fine message; otherwise there must be some text.
  const last = conversation.at(-1)!;
  const photoAssetId = photoIds.at(-1);
  if (last.role !== "user" || (last.text.trim() === "" && !photoAssetId)) return undefined;
  return { messages: conversation, photoAssetId };
}

export function createChatHandler(models: ModelClient, assets: AssetStore): ChatHandler {
  return async (request) => {
    const conversation = await readConversation(request);

    if (!conversation) {
      return eventResponse(async (send) => send({ type: "error", message: INVALID_REQUEST_MESSAGE, retryable: false }), {
        status: 400,
      });
    }

    let photo: AssetFile | undefined;
    if (conversation.photoAssetId) {
      photo = await assets.read(conversation.photoAssetId, "resized");
      if (!photo) {
        return eventResponse(async (send) => send({ type: "error", message: PHOTO_NOT_FOUND_MESSAGE, retryable: true }), {
          status: 400,
        });
      }
    }

    return eventResponse(async (send) => {
      try {
        // The cheap check comes first, so nothing costly ever runs for a photo that is not a product.
        if (photo && !(await models.isProductPhoto(photo))) {
          send({ type: "assistant_text", text: NOT_A_PRODUCT_MESSAGE });
          send({ type: "done" });
          return;
        }

        const messages = conversation.messages.map((message, index) =>
          photo && index === conversation.messages.length - 1 ? { ...message, image: photo } : message,
        );
        for await (const text of models.streamChatReply(messages)) {
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
