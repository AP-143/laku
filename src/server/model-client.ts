import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, streamText, type LanguageModel, type ModelMessage } from "ai";
import { MODELS } from "../config/models";
import type { AssetFile } from "./asset-store";
import { CHAT_SYSTEM_PROMPT, PRODUCT_CHECK_PROMPT } from "./chat-prompt";

/**
 * The model client: the only module that talks to AI models.
 * Everything else asks it for results and never imports a model SDK.
 * The chat model runs directly on the free Google AI Studio key, not through the Vercel AI Gateway
 * (image generation will use the gateway).
 */

/** Chat replies are short by design; this also caps what one request can make the model produce. */
const MAX_REPLY_TOKENS = 1024;
/** The product check only needs one word back. */
const MAX_CHECK_TOKENS = 16;

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  /** A photo the user attached to this message, already resized. */
  image?: AssetFile;
}

export interface ModelClient {
  /** Streams the assistant's reply as pieces of text. Throws if the model fails. Never retries. */
  streamChatReply(messages: ChatMessage[]): AsyncIterable<string>;
  /** True when the photo mainly shows something that could be sold. Throws if the model fails. */
  isProductPhoto(photo: AssetFile): Promise<boolean>;
}

/** Turns one chat message into the SDK's shape, attaching the photo as a file part when there is one. */
function toModelMessage(message: ChatMessage): ModelMessage {
  if (message.role === "assistant") return { role: "assistant", content: message.text };
  if (!message.image) return { role: "user", content: message.text };
  return {
    role: "user",
    content: [
      ...(message.text ? [{ type: "text" as const, text: message.text }] : []),
      { type: "file" as const, mediaType: message.image.mediaType, data: message.image.bytes },
    ],
  };
}

export function createModelClient(models: { chatModel: LanguageModel }): ModelClient {
  return {
    async *streamChatReply(messages) {
      const result = streamText({
        model: models.chatModel,
        system: CHAT_SYSTEM_PROMPT,
        messages: messages.map(toModelMessage),
        maxOutputTokens: MAX_REPLY_TOKENS,
        maxRetries: 0,
      });

      // streamText hides failures from textStream, so read the full stream and rethrow them.
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") yield part.text;
        else if (part.type === "error") throw part.error;
      }
    },

    async isProductPhoto(photo) {
      const { text } = await generateText({
        model: models.chatModel,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PRODUCT_CHECK_PROMPT },
              { type: "file", mediaType: photo.mediaType, data: photo.bytes },
            ],
          },
        ],
        maxOutputTokens: MAX_CHECK_TOKENS,
        maxRetries: 0,
      });
      return text.trim().toUpperCase().startsWith("YES");
    },
  };
}

/** The real model client: the chat model runs on the free Google AI Studio key. */
export function createDefaultModelClient(): ModelClient {
  const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });
  return createModelClient({ chatModel: google(MODELS.chat) });
}
