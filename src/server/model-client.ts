import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateImage, generateText, streamText, type ImageModel, type LanguageModel, type ModelMessage } from "ai";
import { MODELS } from "../config/models";
import type { AssetFile } from "./asset-store";
import { createOmniVideoModel, type VideoModel } from "./video-model";
import {
  CHAT_SYSTEM_PROMPT,
  FRAME_CHECK_PROMPT,
  PRODUCT_CHECK_PROMPT,
  intentPrompt,
  parseIntent,
  parseScenes,
  planScenesPrompt,
  type PlannedStoryboard,
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
/** The short scenes (as many as the ad needs) with their captions and the art direction, or one rewritten scene, as JSON. */
const MAX_SCENE_TOKENS = 1600;
/** Studio photos are square; the storyboard picture is vertical so the video made from it is vertical too. */
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
  /** True when a storyboard frame clearly shows a product, even with a person using it. Throws if the model fails. */
  isProductFrame(frame: AssetFile): Promise<boolean>;
  /** Decides which feature a typed message asks for. Throws if the model fails. */
  classifyIntent(text: string, context: IntentContext): Promise<Intent>;
  /** Proposes one scene per storyboard panel (the planner chooses how many) and the art direction for this product. Throws if the model fails or answers badly. */
  planScenes(photo: AssetFile, request: string): Promise<PlannedStoryboard>;
  /** Makes one image from a reference photo and an instruction. Throws if the model fails. Never retries. */
  generateImage(request: { prompt: string; reference: AssetFile; aspectRatio: ImageAspectRatio }): Promise<AssetFile>;
  /**
   * Makes a whole video of `seconds` from the storyboard picture. `prompt` is the seller's own words as they typed them
   * (left out when they typed none); the model decides everything else. Throws if the model fails. Never retries.
   */
  generateVideo(request: { prompt?: string; frame: AssetFile; seconds: number }): Promise<Uint8Array>;
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
  /** Shows one image to the chat model with a question that is answered YES or NO. */
  async function askYesNo(question: string, image: AssetFile): Promise<boolean> {
    const { text } = await generateText({
      model: models.chatModel,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: question },
            { type: "file", mediaType: image.mediaType, data: image.bytes },
          ],
        },
      ],
      maxOutputTokens: MAX_CHECK_TOKENS,
      maxRetries: 0,
    });
    return text.trim().toUpperCase().startsWith("YES");
  }

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
      return askYesNo(PRODUCT_CHECK_PROMPT, photo);
    },

    async isProductFrame(frame) {
      return askYesNo(FRAME_CHECK_PROMPT, frame);
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

    generateVideo: (request) => models.videoModel.generate(request),
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
