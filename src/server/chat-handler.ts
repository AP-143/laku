import { randomUUID } from "node:crypto";
import { COSTS, VOICES } from "../config/models";
import type { ChatIntent, StudioStyle } from "../shared/chat-events";
import { MAX_ART_DIRECTION_CHARS, MAX_SCENES } from "../shared/storyboard";
import { STORYBOARD_READY_MESSAGE } from "../shared/chat-messages";
import {
  CLIP_SECONDS,
  MAX_CLIPS,
  MAX_VIDEO_SECONDS,
  lineMustEndBy,
  requestedLength,
  sanitizeGrade,
  sanitizeMusicPlan,
  sanitizeNarration,
  type NarrationLine,
  type VideoChoice,
} from "../shared/video-plan";
import { isAssetId, type AssetFile, type AssetStore } from "./asset-store";
import { readBoundedBytes } from "./bounded-body";
import { DEFAULT_DELIVERY, fitPlanToLength, narrationFits, NARRATION_WORD_SLACK, wordRange, type Intent } from "./chat-prompt";
import { eventResponse } from "./event-response";
import { NotAProductError, createImageJobs } from "./image-jobs";
import { revisionPrompt, sheetPrompt, silentActor, studioPhotoPrompt, withoutMusic } from "./image-prompts";
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
const NEED_ATTACHED_STORYBOARD_MESSAGE = "Lampirkan dulu gambar storyboard-nya ya, baru aku buatkan videonya.";
const PICK_VIDEO_FEATURE_MESSAGE = "Untuk membuat video, pilih fitur Video di sidebar, lalu lampirkan gambar storyboard-nya ya.";
const NEED_NARRATED_VIDEO_MESSAGE = "Buat dulu video dengan voice over ya, baru narasi atau suaranya bisa kuubah.";
const WHAT_TO_CHANGE_MESSAGE =
  "Mau diubah apanya? Kamu bisa minta narasi dengan kata-kata lain, atau ganti suaranya jadi suara cewek atau cowok.";
const CLIP_NOT_FOUND_MESSAGE = "Klip yang sudah jadi tidak ketemu lagi. Minta videonya dibuat dari awal ya.";
const priceText = (usd: number) =>
  `US$${usd.toFixed(2)} (sekitar Rp${(Math.round((usd * COSTS.idrPerUsd) / 100) * 100).toLocaleString("id-ID")})`;
/** What the AI chose and what it costs, in the words of the seller: seconds and price, not clips. */
const confirmVideoMessage = (choice: VideoChoice, usd: number) =>
  `AI memilih video ${choice.seconds} detik, ${choice.narration.length > 0 ? "dengan voice over" : "tanpa voice over"} dan ${choice.music ? "dengan musik latar" : "tanpa musik latar"}. Perkiraan biaya ${priceText(usd)}. Lanjut?`;
/** What a video costs: its clips, the narration by the length of the video, and the music. */
const choiceCostUsd = (choice: VideoChoice) =>
  videoCostUsd(choice.clips, choice.narration.length > 0 ? choice.seconds : 0, choice.music ? COSTS.musicUsd : 0);
const resumeVideoMessage = (clipCount: number, usd: number) =>
  `Membuat ulang ${clipCount} klip yang belum jadi, perkiraan ${priceText(usd)}. Lanjut?`;
const NARRATION_TOO_LONG_MESSAGE = (seconds: number, maxWords: number) =>
  `Narasinya terlalu panjang untuk video ${Math.round(seconds)} detik (maksimal sekitar ${maxWords} kata). Coba yang lebih singkat ya.`;

// Every accepted message costs model quota, so the size of a request is bounded before it reaches the model.
const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGES = 50;
const MAX_MESSAGE_CHARS = 4000;
const MAX_TOTAL_CHARS = 20_000;
const MAX_SCENE_CHARS = 600;
const MAX_DIRECTION_CHARS = 1500;

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
  /** The picture a stopped video was made from, which its missing clips are made from again. */
  sheet?: string;
  /** The price in US dollars the seller said yes to for a video, quoted back to the server. */
  confirmedUsd?: number;
  /** The plan the seller was asked about and said yes to, sent back as it was so what is made is what was priced. */
  videoChoice?: VideoChoice;
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
  /** The lines of the narration with the emotion of each; absent for a video made before the narration had lines. */
  lines?: NarrationLine[];
}

/**
 * What `video_partial` told the browser, sent back as it was: the plan of the first try (what each clip was told to play,
 * the lines of the voice-over, the grade and the music, which is made after the clips and so still has to be made) and the
 * finished clips by position.
 */
interface VideoResume extends VideoChoice {
  finished: Record<number, string>;
  /** The first try had a voice-over. */
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

/** A null result means the field was sent but is not a plan this server could have made; no field means no plan. */
function readChoice(value: unknown): VideoChoice | null | undefined {
  if (value === undefined) return undefined;
  const { seconds, clips, directions, narration, voice, grade, music } = (value ?? {}) as {
    seconds?: unknown;
    clips?: unknown;
    directions?: unknown;
    narration?: unknown;
    voice?: unknown;
    grade?: unknown;
    music?: unknown;
  };
  const validClips =
    Array.isArray(clips) &&
    clips.length >= 1 &&
    clips.length <= MAX_CLIPS &&
    clips.every(
      (length) =>
        Number.isInteger(length) &&
        length >= CLIP_SECONDS.min &&
        length <= CLIP_SECONDS.max &&
        (length - CLIP_SECONDS.min) % CLIP_SECONDS.step === 0,
    );
  if (!validClips || typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
  // Never more than the longest video, whatever the request says, since the price follows the clips.
  const total = (clips as number[]).reduce((sum, length) => sum + length, 0);
  if (seconds > total || total > MAX_VIDEO_SECONDS) return null;

  // One direction per clip, as the planner gave them, so the clips that are remade still fit the ones that were kept.
  const validDirections =
    Array.isArray(directions) &&
    directions.length === (clips as number[]).length &&
    directions.every((direction) => typeof direction === "string" && direction.trim() !== "" && direction.length <= MAX_DIRECTION_CHARS);
  if (!validDirections) return null;
  return {
    seconds,
    clips: clips as number[],
    directions: directions as string[],
    narration: sanitizeNarration(narration, seconds),
    voice: voice === "male" ? "male" : "female",
    // Kept inside the same bounds as when the planner wrote it, whatever the request says.
    grade: sanitizeGrade(grade),
    music: sanitizeMusicPlan(music),
  };
}

/** `null` means the field was sent but is not a clip plan this server could have made; no field means no resume. */
function readResume(value: unknown): VideoResume | null | undefined {
  const choice = readChoice(value);
  if (!choice) return choice;
  const { finished, voiceOver } = value as { finished?: unknown; voiceOver?: unknown };
  const entries = Object.entries((finished ?? {}) as Record<string, unknown>);
  const ok = entries.every(
    ([position, assetId]) =>
      Number.isInteger(Number(position)) &&
      Number(position) >= 0 &&
      Number(position) < choice.clips.length &&
      typeof assetId === "string" &&
      isAssetId(assetId),
  );
  if (!ok) return null;
  return {
    ...choice,
    finished: Object.fromEntries(entries.map(([position, assetId]) => [Number(position), assetId as string])),
    voiceOver: voiceOver === true,
  };
}

/** `null` means the field was sent but is not a narration this server could have made; no field means none. */
function readRevise(value: unknown): VoiceRevise | null | undefined {
  if (value === undefined) return undefined;
  const { silentAssetId, script, voice, lines } = (value ?? {}) as Record<string, unknown>;
  const voices: readonly string[] = Object.values(VOICES);
  const valid =
    typeof silentAssetId === "string" &&
    isAssetId(silentAssetId) &&
    typeof script === "string" &&
    script.trim() !== "" &&
    script.length <= MAX_MESSAGE_CHARS &&
    typeof voice === "string" &&
    voices.includes(voice);
  if (lines !== undefined && !Array.isArray(lines)) return null;
  return valid ? { silentAssetId, script, voice, lines: lines ? sanitizeNarration(lines, 60) : undefined } : null;
}

/** `null` means the field was sent but is not an asset id; no field means no storyboard picture. */
function readSheet(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" && isAssetId(value) ? value : null;
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
    videoChoice?: unknown;
    sheet?: unknown;
    confirmedUsd?: unknown;
    resume?: unknown;
    revise?: unknown;
  };
  if (fields.lastImageAssetId !== undefined && (typeof fields.lastImageAssetId !== "string" || !isAssetId(fields.lastImageAssetId))) {
    return undefined;
  }
  const redraw = readRedraw(fields.redraw);
  const videoChoice = readChoice(fields.videoChoice);
  const sheet = readSheet(fields.sheet);
  const resume = readResume(fields.resume);
  const revise = readRevise(fields.revise);
  const invalid = redraw === null || videoChoice === null || sheet === null || resume === null || revise === null;
  if (invalid) return undefined;

  return {
    videoChoice,
    sheet,
    resume,
    revise,
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
    const sheetFile = await readAsset(conversation.sheet);
    const sheet = conversation.sheet && sheetFile ? { assetId: conversation.sheet, file: sheetFile } : undefined;
    if ((conversation.photoAssetId && !photo) || (conversation.redraw && !redrawPhoto) || (conversation.sheet && !sheet)) {
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
       * Has the planner decide the whole video: its length, whether it has a voice-over and music, what each clip plays.
       * The narrator says what the person feels in each part of the story: one line for each clip, read with the emotion
       * the planner gave it and in the one voice, starting at the second the planner chose. The video model decides the
       * rest; it is only told what the app adds afterwards: a narrator, and music.
       */
      async function planVideoChoice(picture: AssetFile, wish: string | undefined): Promise<VideoChoice> {
        const ask = { wish: wish || undefined, sheet: picture };
        // A length the seller wrote is the length of the video, whatever the planner thinks suits the story better. The
        // planner is told, asked once more if it still chose another, and then its plan is fitted to the length asked for.
        // A text model only: never a second video.
        const length = requestedLength(wish);
        let planned = await models.planVideo({ ...ask, length });
        if (length && planned.seconds !== length) planned = await models.planVideo({ ...ask, length, wrong: planned.seconds });
        if (length && planned.seconds !== length) planned = fitPlanToLength(planned, length);
        let clipStart = 0;
        const narration: NarrationLine[] = [];
        for (const [index, clip] of planned.clips.entries()) {
          const length = planned.clipSeconds[index];
          if (clip.narration) {
            narration.push({
              text: clip.narration.text,
              delivery: `${planned.voiceProfile}. ${clip.narration.delivery}`,
              at: clipStart + clip.narration.from,
              until: lineMustEndBy(clipStart + length, index === planned.clips.length - 1),
            });
          }
          clipStart += length;
        }
        const directions = planned.clips.map((clip) => {
          const spoken = planned.voiceOver ? silentActor(clip.direction) : clip.direction;
          return planned.music ? withoutMusic(spoken) : spoken;
        });
        return {
          seconds: planned.seconds,
          clips: planned.clipSeconds,
          directions,
          narration,
          voice: planned.voice,
          grade: planned.grade,
          music: planned.music,
        };
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

        // Remaking the missing clips of a video that stopped part way is an explicit action of the seller.
        if (conversation.resume) {
          const { seconds, clips, finished, directions } = conversation.resume;
          if (!sheet) return reply(NEED_ATTACHED_STORYBOARD_MESSAGE);
          // The same voice-over as the first try: its lines were planned then and are read once the clips are made.
          const { narration, voice } = conversation.resume;

          // Remaking clips can cost as much as a whole video, so it is asked about the same way.
          const remaining = clips.filter((_, position) => finished[position] === undefined);
          // The question shows the whole price, narration included; only whether to ask is judged by the picture alone.
          const resumeUsd = videoCostUsd(remaining, narration.length > 0 ? seconds : 0, conversation.resume.music ? COSTS.musicUsd : 0);
          const agreedToResume = conversation.confirmedUsd !== undefined && resumeUsd <= conversation.confirmedUsd;
          if (videoCostUsd(remaining) > COSTS.videoConfirmAboveUsd && !agreedToResume) {
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
            sheet,
            directions,
            narration,
            voice,
            grade: conversation.resume.grade,
            music: conversation.resume.music,
            plan: { ok: true, seconds, clips },
            finished: kept,
          });
          send({ type: "done" });
          return;
        }

        // The cheap check comes first, so nothing costly ever runs for a photo that is not a product.
        // A photo attached in the Video feature is a storyboard picture, which the video job asks the looser question about.
        if (photo && conversation.intent !== "video" && !(await isProduct(photo))) return reply(NOT_A_PRODUCT_MESSAGE);

        const lastText = conversation.messages.at(-1)!.text.trim();
        // A yes to a priced video is an explicit request, so the router is not asked what it means.
        let intent: Intent | undefined = conversation.videoChoice ? "video" : conversation.intent;
        if (!intent && lastText && (photo || previous || conversation.revise)) {
          intent = await models.classifyIntent(lastText, {
            hasPhoto: Boolean(photo),
            hasPreviousResult: Boolean(previous),
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
          // New words are read as one line from the start; only a new voice keeps every line, with its emotion and its moment.
          const lines: NarrationLine[] =
            change.script || !revise.lines || revise.lines.length === 0
              ? [{ text: script, delivery: DEFAULT_DELIVERY, at: 0.3, until: Math.max(1, seconds - 0.7) }]
              : revise.lines;
          await videos.reviseVoice({
            silentAssetId: revise.silentAssetId,
            silent: silent.bytes,
            seconds,
            lines,
            voice: change.voice ? VOICES[change.voice] : revise.voice,
          });
          send({ type: "done" });
          return;
        }

        if (intent === "video") {
          // Only the Video feature makes a video: a router that guesses one from a typed message is sent there.
          if (conversation.intent !== "video") return reply(PICK_VIDEO_FEATURE_MESSAGE);
          // The storyboard picture is the one attached to the message, and nothing else.
          const picture = photo && conversation.photoAssetId ? { assetId: conversation.photoAssetId, file: photo } : undefined;
          if (!picture) return reply(NEED_ATTACHED_STORYBOARD_MESSAGE);
          // The planner (a text model, which costs next to nothing) decides the whole video first, so the seller is asked
          // about the exact price of what will be made. The plan that was priced comes back with the yes and is made as it is.
          const choice = conversation.videoChoice ?? (await planVideoChoice(picture.file, lastText));
          const estimatedUsd = choiceCostUsd(choice);
          // The yes is for this price: a plan that now costs more is asked about again. The price is always asked first,
          // whatever the length.
          const agreed = conversation.confirmedUsd !== undefined && estimatedUsd <= conversation.confirmedUsd;
          if (!agreed) {
            send({
              type: "confirmation_requested",
              confirmationId: randomUUID(),
              message: confirmVideoMessage(choice, estimatedUsd),
              estimatedUsd,
              videoChoice: choice,
            });
            send({ type: "done" });
            return;
          }
          await videos.generate({
            sheet: picture,
            directions: choice.directions,
            narration: choice.narration,
            voice: choice.voice,
            grade: choice.grade,
            music: choice.music,
            plan: { ok: true, seconds: choice.seconds, clips: choice.clips },
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
