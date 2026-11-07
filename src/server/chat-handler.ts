import { randomUUID } from "node:crypto";
import { COSTS } from "../config/models";
import type { ChatIntent, StudioStyle } from "../shared/chat-events";
import { MAX_ART_DIRECTION_CHARS, MAX_SCENES } from "../shared/storyboard";
import { STORYBOARD_READY_MESSAGE } from "../shared/chat-messages";
import { requestedLength, VIDEO_LENGTH_CHOICES } from "../shared/video-plan";
import { isAssetId, type AssetFile, type AssetStore } from "./asset-store";
import { readBoundedBytes } from "./bounded-body";
import type { Intent } from "./chat-prompt";
import { eventResponse } from "./event-response";
import { NotAProductError, createImageJobs } from "./image-jobs";
import { revisionPrompt, sheetPrompt, studioPhotoPrompt } from "./image-prompts";
import { describeFailure } from "./model-errors";
import type { ChatMessage, ModelClient } from "./model-client";
import type { UsageLedger } from "./usage-ledger";
import { createVideoJobs, videoCostUsd } from "./video-jobs";

export type ChatHandler = (request: Request) => Promise<Response>;

const INVALID_REQUEST_MESSAGE = "Pesanmu belum bisa dibaca. Tulis pesan dulu lalu kirim lagi ya.";
const PHOTO_NOT_FOUND_MESSAGE = "Fotonya tidak ketemu. Coba unggah lagi ya.";
const NOT_A_PRODUCT_MESSAGE =
  "Maaf, saat ini aku hanya bisa memproses foto produk. Coba kirim foto barang yang mau kamu jual ya.";
const NEED_PHOTO_MESSAGE = "Kirim dulu foto produknya ya (klik ikon penjepit kertas), nanti aku bantu.";
const NEED_ATTACHED_STORYBOARD_MESSAGE = "Lampirkan dulu gambar storyboard-nya ya, baru aku buatkan videonya.";
const PICK_VIDEO_FEATURE_MESSAGE = "Untuk membuat video, pilih fitur Video di sidebar, lalu lampirkan gambar storyboard-nya ya.";
const priceText = (usd: number) =>
  `US$${usd.toFixed(2)} (sekitar Rp${(Math.round((usd * COSTS.idrPerUsd) / 100) * 100).toLocaleString("id-ID")})`;
/** What the video costs, in the words of the seller: seconds and price. */
const confirmVideoMessage = (seconds: number, usd: number) => `Video ${seconds} detik. Perkiraan biaya ${priceText(usd)}. Lanjut?`;

// Every accepted message costs model quota, so the size of a request is bounded before it reaches the model.
const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGES = 50;
const MAX_MESSAGE_CHARS = 4000;
const MAX_TOTAL_CHARS = 20_000;
const MAX_SCENE_CHARS = 600;

/** The storyboard whose picture is to be drawn: the photo it is made from, its scenes and the look they are drawn in. */
interface Storyboard {
  photoAssetId: string;
  scenes: string[];
  /** The look the planner picked for this product, kept with the scenes so a retry draws the picture in the same look. */
  artDirection?: string;
}

interface Conversation {
  messages: ChatMessage[];
  /** The photo attached to the last message, if any. */
  photoAssetId?: string;
  /** The newest image the bot generated in this conversation, which a revision starts from. */
  lastImageAssetId?: string;
  /** The shortcut chip the user picked, if any. */
  intent?: ChatIntent;
  style?: StudioStyle;
  /** A retry of the storyboard picture: draw it again from these scenes, without planning them again. */
  redraw?: Storyboard;
  /** The price in US dollars the seller said yes to for a video, quoted back to the server. */
  confirmedUsd?: number;
}

const INTENTS: readonly string[] = ["studio_photo", "storyboard", "video"];
const PRESETS: readonly string[] = ["clean_white", "solid_color", "lifestyle"];

function readIntent(value: unknown): ChatIntent | undefined {
  return typeof value === "string" && INTENTS.includes(value) ? (value as ChatIntent) : undefined;
}

function readStyle(value: unknown): StudioStyle | undefined {
  const { preset, text } = (value ?? {}) as { preset?: unknown; text?: unknown };
  if (typeof preset === "string" && PRESETS.includes(preset)) return { preset } as StudioStyle;
  if (typeof text === "string" && text.trim() !== "" && text.length <= MAX_MESSAGE_CHARS) return { text };
  return undefined;
}

/** `null` means the field was sent but is not a valid storyboard; `undefined` means it was not sent. */
function readRedraw(value: unknown): Storyboard | null | undefined {
  if (value === undefined) return undefined;
  const { photoAssetId, scenes, artDirection } = (value ?? {}) as { photoAssetId?: unknown; scenes?: unknown; artDirection?: unknown };
  if (typeof photoAssetId !== "string" || !isAssetId(photoAssetId)) return null;
  const direction = readArtDirection(artDirection);
  if (direction === null) return null;
  if (!Array.isArray(scenes) || scenes.length === 0 || scenes.length > MAX_SCENES) return null;
  if (!scenes.every((scene) => typeof scene === "string" && scene.trim() !== "" && scene.length <= MAX_SCENE_CHARS)) return null;
  return { photoAssetId, scenes: scenes.map((scene: string) => scene.trim()), artDirection: direction };
}

/** `null` means the field was sent but is not a short text; no field means no art direction. */
function readArtDirection(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" && value.length <= MAX_ART_DIRECTION_CHARS ? value.trim() || undefined : null;
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

  const fields = body as {
    intent?: unknown;
    style?: unknown;
    lastImageAssetId?: unknown;
    redraw?: unknown;
    confirmedUsd?: unknown;
  };
  if (fields.lastImageAssetId !== undefined && (typeof fields.lastImageAssetId !== "string" || !isAssetId(fields.lastImageAssetId))) {
    return undefined;
  }
  const redraw = readRedraw(fields.redraw);
  if (redraw === null) return undefined;

  return {
    confirmedUsd: typeof fields.confirmedUsd === "number" && Number.isFinite(fields.confirmedUsd) ? fields.confirmedUsd : undefined,
    messages: conversation,
    photoAssetId,
    lastImageAssetId: fields.lastImageAssetId as string | undefined,
    intent: readIntent(fields.intent),
    style: readStyle(fields.style),
    redraw,
  };
}

export function createChatHandler(models: ModelClient, assets: AssetStore, ledger: UsageLedger, options: { log?: (message: string) => void } = {}): ChatHandler {
  return async (request) => {
    const conversation = await readConversation(request);

    if (!conversation) {
      return eventResponse(async (send) => send({ type: "error", message: INVALID_REQUEST_MESSAGE, retryable: false }), {
        status: 400,
      });
    }

    async function readAsset(assetId: string | undefined): Promise<AssetFile | undefined> {
      return assetId ? assets.read(assetId, "resized") : undefined;
    }

    const photo = await readAsset(conversation.photoAssetId);
    const previous = await readAsset(conversation.lastImageAssetId);
    const redrawPhoto = await readAsset(conversation.redraw?.photoAssetId);
    if ((conversation.photoAssetId && !photo) || (conversation.redraw && !redrawPhoto)) {
      return eventResponse(async (send) => send({ type: "error", message: PHOTO_NOT_FOUND_MESSAGE, retryable: true }), {
        status: 400,
      });
    }

    return eventResponse(async (send) => {
      // Each image is looked at once per request, however many generations use it.
      const verdicts = new Map<AssetFile, Promise<boolean>>();
      const isProduct = (image: AssetFile) => {
        if (!verdicts.has(image)) verdicts.set(image, models.isProductPhoto(image));
        return verdicts.get(image)!;
      };
      // The storyboard picture is asked a looser question: a person using the product is a normal ad picture, not a non-product photo.
      const frameVerdicts = new Map<AssetFile, Promise<boolean>>();
      const isProductFrame = (frame: AssetFile) => {
        if (!frameVerdicts.has(frame)) frameVerdicts.set(frame, models.isProductFrame(frame));
        return frameVerdicts.get(frame)!;
      };
      const jobs = createImageJobs({ models, assets, ledger, send, isProduct });
      const videos = createVideoJobs({ models, assets, ledger, send, isProduct: isProductFrame, log: options.log });

      function reply(text: string) {
        send({ type: "assistant_text", text });
        send({ type: "done" });
      }

      /**
       * Makes the one picture of a storyboard: all its panels in a single image. The scenes and the art direction are sent
       * first, as data for the browser (nothing of them is shown): a retry of a picture that failed needs no new plan. The
       * words that say what comes next are sent last.
       */
      async function makeSheet(storyboard: Storyboard, source: AssetFile) {
        send({ type: "storyboard_scenes", sourceAssetId: storyboard.photoAssetId, scenes: storyboard.scenes, artDirection: storyboard.artDirection });
        await jobs.generate({
          prompt: sheetPrompt(storyboard.scenes, storyboard.artDirection),
          source,
          sourceAssetId: storyboard.photoAssetId,
          kind: "storyboard_sheet",
          role: "storyboard_sheet",
        });
        send({ type: "assistant_text", text: STORYBOARD_READY_MESSAGE });
        send({ type: "done" });
      }

      try {
        // The retry button of a picture that failed, or of one the seller wants drawn again, is an explicit action.
        if (conversation.redraw && redrawPhoto) return await makeSheet(conversation.redraw, redrawPhoto);

        // The cheap check comes first, so nothing costly ever runs for a photo that is not a product.
        // A photo attached in the Video feature is a storyboard picture, which the video job asks the looser question about.
        if (photo && conversation.intent !== "video" && !(await isProduct(photo))) return reply(NOT_A_PRODUCT_MESSAGE);

        const lastText = conversation.messages.at(-1)!.text.trim();
        let intent: Intent | undefined = conversation.intent;
        if (!intent && lastText && (photo || previous)) {
          intent = await models.classifyIntent(lastText, { hasPhoto: Boolean(photo), hasPreviousResult: Boolean(previous) });
        }

        if (intent === "video") {
          // Only the Video feature makes a video: a router that guesses one from a typed message is sent there.
          if (conversation.intent !== "video") return reply(PICK_VIDEO_FEATURE_MESSAGE);
          // The storyboard picture is the one attached to the message, and nothing else.
          const picture = photo && conversation.photoAssetId ? { assetId: conversation.photoAssetId, file: photo } : undefined;
          if (!picture) return reply(NEED_ATTACHED_STORYBOARD_MESSAGE);
          // The length is the one the seller's words name, otherwise the shortest; the price follows it and is always asked first.
          const seconds = requestedLength(lastText) ?? VIDEO_LENGTH_CHOICES[0];
          const estimatedUsd = videoCostUsd(seconds);
          // The yes is for this price: a request that now costs more is asked about again.
          const agreed = conversation.confirmedUsd !== undefined && estimatedUsd <= conversation.confirmedUsd;
          if (!agreed) {
            send({
              type: "confirmation_requested",
              confirmationId: randomUUID(),
              message: confirmVideoMessage(seconds, estimatedUsd),
              estimatedUsd,
            });
            send({ type: "done" });
            return;
          }
          // What the seller typed goes to the video model as it is, and the model decides the rest.
          await videos.generate({ sheet: picture, prompt: lastText || undefined, seconds });
          send({ type: "done" });
          return;
        }

        // The photo to work from: the one just attached, or else the newest result.
        const source = photo ?? previous;
        const sourceAssetId = photo ? conversation.photoAssetId : conversation.lastImageAssetId;

        if (intent === "studio_photo") {
          if (!source || !sourceAssetId) return reply(NEED_PHOTO_MESSAGE);
          // A typed request with no preset is the seller's own style; with a preset it is an extra note.
          const style = conversation.style ?? (lastText ? { text: lastText } : { preset: "clean_white" as const });
          const note = conversation.style && lastText ? lastText : undefined;
          await jobs.generate({
            prompt: studioPhotoPrompt(style, note),
            source,
            sourceAssetId,
            kind: "studio_photo",
            role: "studio_photo",
          });
          send({ type: "done" });
          return;
        }

        if (intent === "revise_photo" && previous && conversation.lastImageAssetId) {
          await jobs.generate({
            prompt: revisionPrompt(lastText),
            source: previous,
            sourceAssetId: conversation.lastImageAssetId,
            kind: "studio_photo",
            role: "studio_photo",
          });
          send({ type: "done" });
          return;
        }

        if (intent === "storyboard") {
          if (!source || !sourceAssetId) return reply(NEED_PHOTO_MESSAGE);
          // The planner reads the seller's request and writes the scenes (text, next to no cost); the picture is made in the
          // same request, since asking for a storyboard is asking for its picture.
          const { scenes, artDirection } = await models.planScenes(source, lastText);
          return await makeSheet({ photoAssetId: sourceAssetId, scenes, artDirection }, source);
        }

        const messages = conversation.messages.map((message, index) =>
          photo && index === conversation.messages.length - 1 ? { ...message, image: photo } : message,
        );
        for await (const text of models.streamChatReply(messages)) {
          send({ type: "assistant_text", text });
        }
        send({ type: "done" });
      } catch (error) {
        if (error instanceof NotAProductError) return reply(NOT_A_PRODUCT_MESSAGE);
        // No automatic retry: the user decides whether to try again.
        send(describeFailure(error));
      }
    });
  };
}
