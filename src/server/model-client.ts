import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { streamText, type LanguageModel } from "ai";
import { MODELS } from "../config/models";
import { CHAT_SYSTEM_PROMPT } from "./chat-prompt";

/**
 * The model client: the only module that talks to AI models.
 * Everything else asks it for results and never imports a model SDK.
 * The chat model runs directly on the free Google AI Studio key, not through the Vercel AI Gateway
 * (image generation will use the gateway).
 */

/** Chat replies are short by design; this also caps what one request can make the model produce. */
const MAX_REPLY_TOKENS = 1024;

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

export interface ModelClient {
  /** Streams the assistant's reply as pieces of text. Throws if the model fails. Never retries. */
  streamChatReply(messages: ChatMessage[]): AsyncIterable<string>;
}

export function createModelClient(models: { chatModel: LanguageModel }): ModelClient {
  return {
    async *streamChatReply(messages) {
      const result = streamText({
        model: models.chatModel,
        system: CHAT_SYSTEM_PROMPT,
        messages: messages.map((message) => ({ role: message.role, content: message.text })),
        maxOutputTokens: MAX_REPLY_TOKENS,
        maxRetries: 0,
      });

      // streamText hides failures from textStream, so read the full stream and rethrow them.
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") yield part.text;
        else if (part.type === "error") throw part.error;
      }
    },
  };
}

/** The real model client: the chat model runs on the free Google AI Studio key. */
export function createDefaultModelClient(): ModelClient {
  const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });
  return createModelClient({ chatModel: google(MODELS.chat) });
}
