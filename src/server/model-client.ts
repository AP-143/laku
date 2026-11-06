import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  generateImage,
  generateSpeech,
  generateText,
  streamText,
  type ImageModel,
  type LanguageModel,
  type ModelMessage,
  type SpeechModel,
} from "ai";
import { MODELS } from "../config/models";
import type { AssetFile } from "./asset-store";
import { createLyriaMusicModel, type MusicModel } from "./music-model";
import { createOmniVideoModel, type VideoModel } from "./video-model";
import {
  CHAT_SYSTEM_PROMPT,
  FRAME_CHECK_PROMPT,
  PRODUCT_CHECK_PROMPT,
  intentPrompt,
  parseIntent,
  parseReplacement,
  parseScenes,
  parseVideoPlan,
  planScenesPrompt,
  replaceScenePrompt,
  videoPlanPrompt,
  parseVoiceRevision,
  voiceRevisionPrompt,
  type PlannedStoryboard,
  type VideoPlan,
  type VoiceRevision,
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
/** Six short scenes with their captions and the art direction, or one rewritten scene, as JSON. */
const MAX_SCENE_TOKENS = 1600;
/** The reasoning, and a direction and a line to say for each of up to four clips, as JSON. */
const MAX_PLAN_TOKENS = 2400;

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
  /** Proposes one scene per storyboard panel (six) and the art direction for this product. Throws if the model fails or answers badly. */
  planScenes(photo: AssetFile, request: string): Promise<PlannedStoryboard>;
  /** Rewrites the one scene the instruction is about. Throws if the model fails or answers badly. */
  replaceScene(scenes: string[], instruction: string): Promise<{ index: number; text: string }>;
  /** Makes one image from a reference photo and an instruction. Throws if the model fails. Never retries. */
  generateImage(request: { prompt: string; reference: AssetFile; aspectRatio: ImageAspectRatio }): Promise<AssetFile>;
  /**
   * Looks at the storyboard picture, thinks, and decides the length of the video, whether it has a voice-over and music,
   * and what each clip plays and says. `wish` is what the seller typed, if they typed. Throws if the model fails or answers badly.
   */
  planVideo(request: { scenes: string[]; artDirection?: string; wish?: string; sheet?: AssetFile }): Promise<VideoPlan>;
  /** Makes 30 seconds of instrumental music from a prompt. Throws if the model fails. Never retries. */
  generateMusic(request: { prompt: string }): Promise<Uint8Array>;
  /** Reads what the seller wants changed in a narration. Throws if the model fails or answers badly. */
  readVoiceRevision(text: string, currentScript: string): Promise<VoiceRevision>;
  /**
   * Reads a script aloud, in the app voice unless another is given, performed as `instructions` direct (the manner,
   * the emotion and how the pitch moves). Throws if the model fails. Never retries.
   */
  speak(script: string, voice?: string, instructions?: string): Promise<AssetFile>;
  /** Makes one clip of `seconds` from a frame. Throws if the model fails. Never retries. */
  generateClip(request: { prompt: string; frame: AssetFile; seconds: number }): Promise<Uint8Array>;
}

/** Image generation is slow; this keeps one stuck call from hanging a request forever. */
const IMAGE_TIMEOUT_MS = 3 * 60_000;
/** Reading a script aloud takes seconds; this only stops one stuck call from hanging a request. */
const SPEECH_TIMEOUT_MS = 2 * 60_000;
/** A narration is under a hundred words (a video is at most 32 seconds). */
const MAX_SCRIPT_TOKENS = 1200;

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
  speechModel: SpeechModel;
  musicModel: MusicModel;
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

    async planVideo(request) {
      const { text } = await generateText({
        model: models.chatModel,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: videoPlanPrompt(request) },
              ...(request.sheet ? [{ type: "file" as const, mediaType: request.sheet.mediaType, data: request.sheet.bytes }] : []),
            ],
          },
        ],
        maxOutputTokens: MAX_PLAN_TOKENS,
        maxRetries: 0,
      });
      return parseVideoPlan(text);
    },


    generateClip: (request) => models.videoModel.generate(request),

    generateMusic: (request) => models.musicModel.generate(request),

    async readVoiceRevision(text, currentScript) {
      const { text: answer } = await generateText({
        model: models.chatModel,
        messages: [{ role: "user", content: voiceRevisionPrompt(text, currentScript) }],
        maxOutputTokens: MAX_SCRIPT_TOKENS,
        maxRetries: 0,
      });
      return parseVoiceRevision(answer);
    },

    async speak(script, voice = MODELS.voice, instructions) {
      const { audio } = await generateSpeech({
        model: models.speechModel,
        text: script,
        voice,
        instructions,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(SPEECH_TIMEOUT_MS),
      });
      return { bytes: audio.uint8Array, mediaType: audio.mediaType };
    },
  };
}

/** The real model client: the chat model runs on the free Google AI Studio key. */
export function createDefaultModelClient(): ModelClient {
  const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });
  return createModelClient({
    chatModel: google(MODELS.chat),
    imageModel: google.image(MODELS.image),
    videoModel: createOmniVideoModel(process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? ""),
    speechModel: google.speech(MODELS.speech),
    musicModel: createLyriaMusicModel(process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? ""),
  });
}
