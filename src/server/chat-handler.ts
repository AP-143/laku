import type { ChatIntent, StudioStyle } from "../shared/chat-events";
import { SCENE_COUNT, SCENE_INDEXES } from "../shared/storyboard";
import { DEFAULT_VIDEO_SECONDS, planClips } from "../shared/video-plan";
import { isAssetId, type AssetFile, type AssetStore } from "./asset-store";
import { readBoundedBytes } from "./bounded-body";
import type { Intent } from "./chat-prompt";
import { eventResponse } from "./event-response";
import { NotAProductError, createImageJobs } from "./image-jobs";
import { framePrompt, revisionPrompt, studioPhotoPrompt } from "./image-prompts";
import { describeFailure } from "./model-errors";
import type { ChatMessage, ModelClient } from "./model-client";
import type { UsageLedger } from "./usage-ledger";
import { createVideoJobs } from "./video-jobs";

export type ChatHandler = (request: Request) => Promise<Response>;

const INVALID_REQUEST_MESSAGE = "Pesanmu belum bisa dibaca. Tulis pesan dulu lalu kirim lagi ya.";
const PHOTO_NOT_FOUND_MESSAGE = "Fotonya tidak ketemu. Coba unggah lagi ya.";
const NOT_A_PRODUCT_MESSAGE =
  "Maaf, saat ini aku hanya bisa memproses foto produk. Coba kirim foto barang yang mau kamu jual ya.";
const NEED_PHOTO_MESSAGE = "Kirim dulu foto produknya ya (klik ikon penjepit kertas), nanti aku bantu.";
const NEED_FRAMES_MESSAGE = "Buat dulu storyboard dan gambar tiap scene-nya ya, baru aku buatkan videonya.";
const videoTooLongMessage = (maxSeconds: number) =>
  `Storyboard-mu bisa dijadikan video maksimal ${maxSeconds} detik. Coba minta video yang lebih pendek ya.`;
const SCENES_PROPOSED_MESSAGE =
  "Ini usulan 4 scene storyboard-nya. Kamu bisa ubah teksnya atau minta aku ganti scene tertentu. Kalau sudah cocok, setujui dulu ya, baru aku buatkan gambarnya.";
const SCENE_REPLACED_MESSAGE = "Sudah kuganti. Kalau sudah cocok, setujui supaya aku buatkan gambarnya ya.";

// Every accepted message costs model quota, so the size of a request is bounded before it reaches the model.
const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGES = 50;
const MAX_MESSAGE_CHARS = 4000;
const MAX_TOTAL_CHARS = 20_000;
const MAX_SCENE_CHARS = 600;

/** A storyboard in progress: the photo it is made from and the four scene texts so far. */
interface Storyboard {
  photoAssetId: string;
  scenes: string[];
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
  storyboard?: Storyboard;
  /** The user approved the storyboard: generate frames for all scenes, or only for `sceneIndex`. */
  approve?: { sceneIndex?: number };
  /** The generated storyboard frames in scene order, which a video is made from. */
  frames: string[];
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
function readStoryboard(value: unknown): Storyboard | null | undefined {
  if (value === undefined) return undefined;
  const { photoAssetId, scenes } = (value ?? {}) as { photoAssetId?: unknown; scenes?: unknown };
  if (typeof photoAssetId !== "string" || !isAssetId(photoAssetId)) return null;
  if (!Array.isArray(scenes) || scenes.length !== SCENE_COUNT) return null;
  if (!scenes.every((scene) => typeof scene === "string" && scene.trim() !== "" && scene.length <= MAX_SCENE_CHARS)) return null;
  return { photoAssetId, scenes: scenes.map((scene: string) => scene.trim()) };
}

function readApproval(value: unknown): Conversation["approve"] | null | undefined {
  if (value === undefined) return undefined;
  const { sceneIndex } = (value ?? {}) as { sceneIndex?: unknown };
  if (sceneIndex === undefined) return {};
  return Number.isInteger(sceneIndex) && (sceneIndex as number) >= 0 && (sceneIndex as number) < SCENE_COUNT
    ? { sceneIndex: sceneIndex as number }
    : null;
}

/** `null` means the field was sent but is not a list of up to four asset ids; no field means no frames. */
function readFrames(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > SCENE_COUNT) return null;
  return value.every((id) => typeof id === "string" && isAssetId(id)) ? (value as string[]) : null;
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
    storyboard?: unknown;
    approve?: unknown;
    frames?: unknown;
  };
  if (fields.lastImageAssetId !== undefined && (typeof fields.lastImageAssetId !== "string" || !isAssetId(fields.lastImageAssetId))) {
    return undefined;
  }
  const storyboard = readStoryboard(fields.storyboard);
  const approve = readApproval(fields.approve);
  const frames = readFrames(fields.frames);
  // Approving needs the plan it approves.
  if (storyboard === null || approve === null || (approve && !storyboard) || frames === null) return undefined;

  return {
    frames,
    messages: conversation,
    photoAssetId,
    lastImageAssetId: fields.lastImageAssetId as string | undefined,
    intent: readIntent(fields.intent),
    style: readStyle(fields.style),
    storyboard,
    approve,
  };
}

export function createChatHandler(models: ModelClient, assets: AssetStore, ledger: UsageLedger): ChatHandler {
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
    const storyboardPhoto = await readAsset(conversation.storyboard?.photoAssetId);
    const frameFiles = await Promise.all(conversation.frames.map((assetId) => readAsset(assetId)));
    const frames = conversation.frames.flatMap((assetId, index) => (frameFiles[index] ? [{ assetId, file: frameFiles[index] }] : []));
    if (
      (conversation.photoAssetId && !photo) ||
      (conversation.storyboard && !storyboardPhoto) ||
      frames.length !== conversation.frames.length
    ) {
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
      const jobs = createImageJobs({ models, assets, ledger, send, isProduct });
      const videos = createVideoJobs({ models, assets, ledger, send, isProduct });

      function reply(text: string) {
        send({ type: "assistant_text", text });
        send({ type: "done" });
      }

      function proposeScenes(sourceAssetId: string, scenes: string[], text: string) {
        send({ type: "storyboard_scenes", sourceAssetId, scenes });
        reply(text);
      }

      try {
        const { storyboard, approve } = conversation;

        // Approval is an explicit action, so frames are never generated by guesswork.
        if (approve && storyboard && storyboardPhoto) {
          const indexes = approve.sceneIndex === undefined ? SCENE_INDEXES : [approve.sceneIndex];
          for (const [position, sceneIndex] of indexes.entries()) {
            if (indexes.length > 1) {
              send({
                type: "job_progress",
                jobId: "storyboard",
                message: `Membuat scene ${sceneIndex + 1} dari ${SCENE_COUNT}`,
                percent: Math.round((position / indexes.length) * 100),
              });
            }
            await jobs.generate({
              prompt: framePrompt(storyboard.scenes[sceneIndex]),
              source: storyboardPhoto,
              sourceAssetId: storyboard.photoAssetId,
              kind: "storyboard_frame",
              role: "storyboard_frame",
              sceneIndex,
            });
          }
          send({ type: "done" });
          return;
        }

        // The cheap check comes first, so nothing costly ever runs for a photo that is not a product.
        if (photo && !(await isProduct(photo))) return reply(NOT_A_PRODUCT_MESSAGE);

        const lastText = conversation.messages.at(-1)!.text.trim();
        let intent: Intent | undefined = conversation.intent;
        if (!intent && lastText && (photo || previous || storyboard || frames.length > 0)) {
          intent = await models.classifyIntent(lastText, {
            hasPhoto: Boolean(photo),
            hasPreviousResult: Boolean(previous),
            hasStoryboard: Boolean(storyboard),
            hasFrames: frames.length > 0,
          });
        }

        if (intent === "video") {
          if (frames.length === 0) return reply(NEED_FRAMES_MESSAGE);
          const { seconds } = lastText ? await models.readVideoRequest(lastText) : { seconds: undefined };
          const plan = planClips(seconds ?? DEFAULT_VIDEO_SECONDS, frames.length);
          if (!plan.ok) return reply(videoTooLongMessage(plan.maxSeconds));
          await videos.generate({ frames, plan });
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
          // Only the text is planned here (no image, no cost); frames wait for approval.
          const scenes = await models.planScenes(source, lastText);
          return proposeScenes(sourceAssetId, scenes, SCENES_PROPOSED_MESSAGE);
        }

        if (intent === "edit_scene" && storyboard) {
          const { index, text } = await models.replaceScene(storyboard.scenes, lastText);
          const scenes = storyboard.scenes.map((scene, position) => (position === index ? text : scene));
          return proposeScenes(storyboard.photoAssetId, scenes, SCENE_REPLACED_MESSAGE);
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
