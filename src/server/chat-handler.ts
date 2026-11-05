import { randomUUID } from "node:crypto";
import { COSTS, VOICES } from "../config/models";
import type { ChatIntent, StudioStyle } from "../shared/chat-events";
import { SCENE_COUNT, SCENE_INDEXES } from "../shared/storyboard";
import { CLIP_SECONDS, DEFAULT_VIDEO_SECONDS, planClips } from "../shared/video-plan";
import { isAssetId, type AssetFile, type AssetStore } from "./asset-store";
import { readBoundedBytes } from "./bounded-body";
import { narrationFits, NARRATION_WORD_SLACK, wordRange, type Intent } from "./chat-prompt";
import { eventResponse } from "./event-response";
import { NotAProductError, createImageJobs } from "./image-jobs";
import { framePrompt, revisionPrompt, studioPhotoPrompt } from "./image-prompts";
import { describeFailure } from "./model-errors";
import type { ChatMessage, ModelClient } from "./model-client";
import type { UsageLedger } from "./usage-ledger";
import { createVideoJobs, videoCostUsd } from "./video-jobs";
import { probeSeconds } from "./video-join";

export type ChatHandler = (request: Request) => Promise<Response>;

const INVALID_REQUEST_MESSAGE = "Pesanmu belum bisa dibaca. Tulis pesan dulu lalu kirim lagi ya.";
const PHOTO_NOT_FOUND_MESSAGE = "Fotonya tidak ketemu. Coba unggah lagi ya.";
const NOT_A_PRODUCT_MESSAGE =
  "Maaf, saat ini aku hanya bisa memproses foto produk. Coba kirim foto barang yang mau kamu jual ya.";
const NEED_PHOTO_MESSAGE = "Kirim dulu foto produknya ya (klik ikon penjepit kertas), nanti aku bantu.";
const NEED_FRAMES_MESSAGE = "Buat dulu storyboard dan gambar tiap scene-nya ya, baru aku buatkan videonya.";
const NEED_NARRATED_VIDEO_MESSAGE = "Buat dulu video dengan voice over ya, baru narasi atau suaranya bisa kuubah.";
const WHAT_TO_CHANGE_MESSAGE =
  "Mau diubah apanya? Kamu bisa minta narasi dengan kata-kata lain, atau ganti suaranya jadi suara cewek atau cowok.";
const CLIP_NOT_FOUND_MESSAGE = "Klip yang sudah jadi tidak ketemu lagi. Minta videonya dibuat dari awal ya.";
const priceText = (usd: number) =>
  `US$${usd.toFixed(2)} (sekitar Rp${(Math.round((usd * COSTS.idrPerUsd) / 100) * 100).toLocaleString("id-ID")})`;
const confirmVideoMessage = (seconds: number, clipCount: number, usd: number) =>
  `Video ${seconds} detik (${clipCount} klip), perkiraan ${priceText(usd)}. Lanjut?`;
const resumeVideoMessage = (clipCount: number, usd: number) =>
  `Membuat ulang ${clipCount} klip yang belum jadi, perkiraan ${priceText(usd)}. Lanjut?`;
const NARRATION_TOO_LONG_MESSAGE = (seconds: number, maxWords: number) =>
  `Narasinya terlalu panjang untuk video ${Math.round(seconds)} detik (maksimal sekitar ${maxWords} kata). Coba yang lebih singkat ya.`;
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
  /** The text of the storyboard scenes, which a voice-over script is written from (can be empty). */
  scenes: string[];
  /** The price in US dollars the seller said yes to for an expensive video, quoted back to the server. */
  confirmedUsd?: number;
  /** Remake only the missing clips of a video that stopped part way. */
  resume?: VideoResume;
  /** The video with a narration that the seller may want to change, as `voice_over` described it. */
  revise?: VoiceRevise;
}

/** The narration a seller can change. The length is not part of it: the server reads that from the video. */
interface VoiceRevise {
  silentAssetId: string;
  script: string;
  voice: string;
}

/** What `video_partial` told the browser, sent back as it was: the clip plan and the finished clips by position. */
interface VideoResume {
  seconds: number;
  clips: number[];
  finished: Record<number, string>;
  /** The seller asked for a voice-over in the first try. */
  voiceOver: boolean;
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

/** `null` means the field was sent but is not a clip plan this server could have made; no field means no resume. */
function readResume(value: unknown): VideoResume | null | undefined {
  if (value === undefined) return undefined;
  const { seconds, clips, finished, voiceOver } = (value ?? {}) as {
    seconds?: unknown;
    clips?: unknown;
    finished?: unknown;
    voiceOver?: unknown;
  };
  const validClips =
    Array.isArray(clips) &&
    clips.length >= 1 &&
    clips.length <= SCENE_COUNT &&
    clips.every(
      (length) =>
        Number.isInteger(length) &&
        length >= CLIP_SECONDS.min &&
        length <= CLIP_SECONDS.max &&
        (length - CLIP_SECONDS.min) % CLIP_SECONDS.step === 0,
    );
  if (!validClips || typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = (clips as number[]).reduce((sum, length) => sum + length, 0);
  if (seconds > total) return null;

  const entries = Object.entries((finished ?? {}) as Record<string, unknown>);
  const ok = entries.every(
    ([position, assetId]) =>
      Number.isInteger(Number(position)) &&
      Number(position) >= 0 &&
      Number(position) < (clips as number[]).length &&
      typeof assetId === "string" &&
      isAssetId(assetId),
  );
  if (!ok) return null;
  return {
    seconds,
    clips: clips as number[],
    finished: Object.fromEntries(entries.map(([position, assetId]) => [Number(position), assetId as string])),
    voiceOver: voiceOver === true,
  };
}

/** `null` means the field was sent but is not a narration this server could have made; no field means none. */
function readRevise(value: unknown): VoiceRevise | null | undefined {
  if (value === undefined) return undefined;
  const { silentAssetId, script, voice } = (value ?? {}) as Record<string, unknown>;
  const voices: readonly string[] = Object.values(VOICES);
  const valid =
    typeof silentAssetId === "string" &&
    isAssetId(silentAssetId) &&
    typeof script === "string" &&
    script.trim() !== "" &&
    script.length <= MAX_MESSAGE_CHARS &&
    typeof voice === "string" &&
    voices.includes(voice);
  return valid ? { silentAssetId, script, voice } : null;
}

/** `null` means the field was sent but is not up to four short texts; no field means no scenes. */
function readScenes(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > SCENE_COUNT) return null;
  if (!value.every((scene) => typeof scene === "string" && scene.length <= MAX_SCENE_CHARS)) return null;
  return (value as string[]).map((scene) => scene.trim()).filter(Boolean);
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
    confirmedUsd?: unknown;
    resume?: unknown;
    scenes?: unknown;
    revise?: unknown;
  };
  if (fields.lastImageAssetId !== undefined && (typeof fields.lastImageAssetId !== "string" || !isAssetId(fields.lastImageAssetId))) {
    return undefined;
  }
  const storyboard = readStoryboard(fields.storyboard);
  const approve = readApproval(fields.approve);
  const frames = readFrames(fields.frames);
  const resume = readResume(fields.resume);
  const scenes = readScenes(fields.scenes);
  const revise = readRevise(fields.revise);
  // Approving needs the plan it approves.
  const invalid =
    storyboard === null || approve === null || (approve && !storyboard) || frames === null || resume === null || scenes === null || revise === null;
  if (invalid) return undefined;

  return {
    frames,
    scenes,
    resume,
    revise,
    confirmedUsd: typeof fields.confirmedUsd === "number" && Number.isFinite(fields.confirmedUsd) ? fields.confirmedUsd : undefined,
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

      // The words come first: the chat scrolls to its last item, and the card holds the approve button the words point to.
      function proposeScenes(sourceAssetId: string, scenes: string[], text: string) {
        send({ type: "assistant_text", text });
        send({ type: "storyboard_scenes", sourceAssetId, scenes });
        send({ type: "done" });
      }

      /** Generates the frames of an approved storyboard, one after the other, in scene order. */
      async function makeFrames(storyboard: Storyboard, source: AssetFile, indexes: readonly number[]) {
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
            source,
            sourceAssetId: storyboard.photoAssetId,
            kind: "storyboard_frame",
            role: "storyboard_frame",
            sceneIndex,
          });
        }
        send({ type: "done" });
      }

      try {
        const { storyboard, approve } = conversation;

        // The approve button is an explicit action, so frames are never generated by guesswork.
        if (approve && storyboard && storyboardPhoto) {
          return await makeFrames(storyboard, storyboardPhoto, approve.sceneIndex === undefined ? SCENE_INDEXES : [approve.sceneIndex]);
        }

        // Remaking the missing clips of a video that stopped part way is an explicit action of the seller.
        if (conversation.resume) {
          const { seconds, clips, finished } = conversation.resume;
          if (frames.length < clips.length) return reply(NEED_FRAMES_MESSAGE);

          // Remaking clips can cost as much as a whole video, so it is asked about the same way.
          const remaining = clips.filter((_, position) => finished[position] === undefined);
          const resumeUsd = videoCostUsd(remaining);
          const agreedToResume = conversation.confirmedUsd !== undefined && resumeUsd <= conversation.confirmedUsd;
          if (resumeUsd > COSTS.videoConfirmAboveUsd && !agreedToResume) {
            send({
              type: "confirmation_requested",
              confirmationId: randomUUID(),
              message: resumeVideoMessage(remaining.length, resumeUsd),
              estimatedUsd: resumeUsd,
            });
            send({ type: "done" });
            return;
          }
          const kept: Record<number, { assetId: string; bytes: Uint8Array }> = {};
          for (const [position, assetId] of Object.entries(finished)) {
            const clip = await assets.read(assetId, "original");
            if (clip?.mediaType !== "video/mp4") return reply(CLIP_NOT_FOUND_MESSAGE);
            kept[Number(position)] = { assetId, bytes: clip.bytes };
          }
          await videos.generate({
            frames,
            plan: { ok: true, seconds, clips },
            finished: kept,
            voiceOver: conversation.resume.voiceOver
              ? { scenes: conversation.scenes, text: conversation.messages.at(-1)!.text.trim() }
              : undefined,
          });
          send({ type: "done" });
          return;
        }

        // The cheap check comes first, so nothing costly ever runs for a photo that is not a product.
        if (photo && !(await isProduct(photo))) return reply(NOT_A_PRODUCT_MESSAGE);

        const lastText = conversation.messages.at(-1)!.text.trim();
        let intent: Intent | undefined = conversation.intent;
        if (!intent && lastText && (photo || previous || storyboard || frames.length > 0 || conversation.revise)) {
          intent = await models.classifyIntent(lastText, {
            hasPhoto: Boolean(photo),
            hasPreviousResult: Boolean(previous),
            hasStoryboard: Boolean(storyboard),
            hasFrames: frames.length > 0,
            hasNarration: Boolean(conversation.revise),
          });
        }

        if (intent === "revise_voice") {
          const { revise } = conversation;
          if (!revise) return reply(NEED_NARRATED_VIDEO_MESSAGE);
          const silent = await assets.read(revise.silentAssetId, "original");
          if (silent?.mediaType !== "video/mp4") return reply(CLIP_NOT_FOUND_MESSAGE);
          const change = await models.readVoiceRevision(lastText, revise.script);
          if (!change.script && !change.voice) return reply(WHAT_TO_CHANGE_MESSAGE);

          // The price and the length of the narration follow the video itself, never what the request says about it.
          const seconds = await probeSeconds(silent.bytes);
          const script = change.script ?? revise.script;
          if (!narrationFits(script, seconds)) {
            return reply(NARRATION_TOO_LONG_MESSAGE(seconds, wordRange(seconds).max + NARRATION_WORD_SLACK));
          }
          await videos.reviseVoice({
            silentAssetId: revise.silentAssetId,
            silent: silent.bytes,
            seconds,
            script,
            voice: change.voice ? VOICES[change.voice] : revise.voice,
          });
          send({ type: "done" });
          return;
        }

        if (intent === "video") {
          if (frames.length === 0) return reply(NEED_FRAMES_MESSAGE);
          const asked = lastText ? await models.readVideoRequest(lastText) : { seconds: undefined, voiceOver: false };
          const plan = planClips(asked.seconds ?? DEFAULT_VIDEO_SECONDS, frames.length);
          if (!plan.ok) return reply(videoTooLongMessage(plan.maxSeconds));

          // An expensive video waits for the seller's yes to this price; nothing is booked or generated until then.
          // The request is read again on the yes, so a video that now costs more than was agreed is asked about again.
          const estimatedUsd = videoCostUsd(plan.clips);
          const agreed = conversation.confirmedUsd !== undefined && estimatedUsd <= conversation.confirmedUsd;
          if (estimatedUsd > COSTS.videoConfirmAboveUsd && !agreed) {
            send({
              type: "confirmation_requested",
              confirmationId: randomUUID(),
              message: confirmVideoMessage(plan.seconds, plan.clips.length, estimatedUsd),
              estimatedUsd,
            });
            send({ type: "done" });
            return;
          }
          await videos.generate({
            frames,
            plan,
            voiceOver: asked.voiceOver ? { scenes: conversation.scenes, text: lastText } : undefined,
          });
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

        // Typing "oke setuju" approves the open storyboard like the button does.
        if (intent === "approve_scenes" && storyboard && storyboardPhoto) {
          return await makeFrames(storyboard, storyboardPhoto, SCENE_INDEXES);
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
