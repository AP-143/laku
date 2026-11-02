import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateImage, generateText, streamText, type ImageModel, type LanguageModel, type ModelMessage } from "ai";
import { MODELS } from "../config/models";
import type { AssetFile } from "./asset-store";
import { createOmniVideoModel, type VideoModel } from "./video-model";
import {
  CHAT_SYSTEM_PROMPT,
  PRODUCT_CHECK_PROMPT,
  intentPrompt,
  parseIntent,
  parseReplacement,
  parseScenes,
  parseVideoRequest,
  planScenesPrompt,
  replaceScenePrompt,
  videoRequestPrompt,
  type Intent,
  type IntentContext,
} from "./chat-prompt";

/**
 * The model client: the only module that talks to AI models.
 * Everything else asks it for results and never imports a model SDK.
 * Every model runs directly on the Google AI Studio key, not through the Vercel AI Gateway.
 */

/** Chat replies are short by design; this also caps what one request can make the model produce. */
const MAX_REPLY_TOKENS = 1024;
/** The product check and the intent router only need one word back. */
const MAX_CHECK_TOKENS = 16;
/** Four short scenes, or one rewritten scene, as JSON. */
const MAX_SCENE_TOKENS = 600;

/** Studio photos are square; storyboard frames are vertical so they can feed a vertical video. */
export type ImageAspectRatio = "1:1" | "9:16";

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
  /** Decides which feature a typed message asks for. Throws if the model fails. */
  classifyIntent(text: string, context: IntentContext): Promise<Intent>;
  /** Proposes exactly 4 scene descriptions for a storyboard. Throws if the model fails or answers badly. */
  planScenes(photo: AssetFile, request: string): Promise<string[]>;
  /** Rewrites the one scene the instruction is about. Throws if the model fails or answers badly. */
  replaceScene(scenes: string[], instruction: string): Promise<{ index: number; text: string }>;
  /** Makes one image from a reference photo and an instruction. Throws if the model fails. Never retries. */
  generateImage(request: { prompt: string; reference: AssetFile; aspectRatio: ImageAspectRatio }): Promise<AssetFile>;
  /** Reads the video length the seller asked for. Throws if the model fails or answers badly. */
  readVideoRequest(text: string): Promise<{ seconds?: number }>;
  /** Makes one clip of `seconds` from a frame. Throws if the model fails. Never retries. */
  generateClip(request: { prompt: string; frame: AssetFile; seconds: number }): Promise<Uint8Array>;
}

/** Image generation is slow; this keeps one stuck call from hanging a request forever. */
const IMAGE_TIMEOUT_MS = 3 * 60_000;

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

export function createModelClient(models: {
  chatModel: LanguageModel;
  imageModel: ImageModel;
  videoModel: VideoModel;
}): ModelClient {
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

    async classifyIntent(text, context) {
      const { text: answer } = await generateText({
        model: models.chatModel,
        messages: [{ role: "user", content: intentPrompt(text, context) }],
        maxOutputTokens: MAX_CHECK_TOKENS,
        maxRetries: 0,
      });
      return parseIntent(answer);
    },

    async planScenes(photo, request) {
      const { text } = await generateText({
        model: models.chatModel,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: planScenesPrompt(request) },
              { type: "file", mediaType: photo.mediaType, data: photo.bytes },
            ],
          },
        ],
        maxOutputTokens: MAX_SCENE_TOKENS,
        maxRetries: 0,
      });
      return parseScenes(text);
    },

    async replaceScene(scenes, instruction) {
      const { text } = await generateText({
        model: models.chatModel,
        messages: [{ role: "user", content: replaceScenePrompt(scenes, instruction) }],
        maxOutputTokens: MAX_SCENE_TOKENS,
        maxRetries: 0,
      });
      return parseReplacement(text);
    },

    async generateImage({ prompt, reference, aspectRatio }) {
      const result = await generateImage({
        model: models.imageModel,
        prompt: { images: [reference.bytes], text: prompt },
        aspectRatio,
        providerOptions: { google: { imageConfig: { imageSize: MODELS.imageSize } } },
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      });
      return { bytes: result.image.uint8Array, mediaType: result.image.mediaType };
    },

    async readVideoRequest(text) {
      const { text: answer } = await generateText({
        model: models.chatModel,
        messages: [{ role: "user", content: videoRequestPrompt(text) }],
        maxOutputTokens: MAX_CHECK_TOKENS * 2,
        maxRetries: 0,
      });
      return parseVideoRequest(answer);
    },

    generateClip: (request) => models.videoModel.generate(request),
  };
}

/** The real model client: the chat model runs on the free Google AI Studio key. */
export function createDefaultModelClient(): ModelClient {
  const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });
  return createModelClient({
    chatModel: google(MODELS.chat),
    imageModel: google.image(MODELS.image),
    videoModel: createOmniVideoModel(process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? ""),
  });
}
