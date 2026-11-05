import { randomUUID } from "node:crypto";
import { COSTS, MODELS } from "../config/models";
import type { ChatEvent } from "../shared/chat-events";
import { CLIP_SECONDS, type ClipPlan } from "../shared/video-plan";
import type { AssetFile, AssetStore } from "./asset-store";
import { narrationFits } from "./chat-prompt";
import { clipPrompt } from "./image-prompts";
import { NotAProductError } from "./image-jobs";
import type { ModelClient } from "./model-client";
import {
  ClipFailedError,
  DailyCapReachedError,
  mayStillBeBilled,
  VideoNotAffordableError,
} from "./model-errors";
import { readUsage, type UsageLedger } from "./usage-ledger";
import { addVoice, joinClips } from "./video-join";

/** The storyboard picture a video is made from. */
export interface StoryboardSheet {
  assetId: string;
  file: AssetFile;
}

const roundUsd = (usd: number) => Math.round(usd * 10_000) / 10_000;
const costOf = (seconds: number) => roundUsd(seconds * COSTS.videoUsdPerSecond);
const sum = (numbers: number[]) => numbers.reduce((total, value) => total + value, 0);

/** The price of one narration of this many seconds, in US dollars. */
const speechCostOf = (seconds: number) => roundUsd(seconds * COSTS.speechUsdPerSecond);

/**
 * The estimated price of a video made of these clips, in US dollars. With a narration (`voiceSeconds`, the length of
 * the video) it is the price that is booked, so the seller is asked about what they will really be charged.
 */
export const videoCostUsd = (clips: number[], voiceSeconds = 0) => roundUsd(costOf(sum(clips)) + speechCostOf(voiceSeconds));

/**
 * Runs one video from start to finish: product check, budget reservation, clips, joining, saving, events.
 * It throws on failure and never retries, so the caller decides what the user sees.
 */
export function createVideoJobs(deps: {
  models: ModelClient;
  assets: AssetStore;
  ledger: UsageLedger;
  send: (event: ChatEvent) => void;
  /** Asked about the picture every clip is made from, so no paid path skips the product check (the frame check, not the photo one). */
  isProduct: (image: AssetFile) => Promise<boolean>;
}) {
  const { models, assets, ledger, send, isProduct } = deps;

  /** How many seconds of video (with its narration, when asked for) the day still has room for. */
  async function affordableSeconds(withVoice: boolean): Promise<number> {
    const left = COSTS.dailyBudgetUsd - (await ledger.dayTotal());
    const perSecond = COSTS.videoUsdPerSecond + (withVoice ? COSTS.speechUsdPerSecond : 0);
    return Math.floor(Math.max(0, left) / perSecond + 1e-9);
  }

  return {
    /**
     * Every clip starts from the same storyboard `sheet` and plays its own `directions` (one per clip, in order).
     * `finished` holds clips made by an earlier try (by position), which are used as they are and not paid for again.
     */
    async generate(request: {
      sheet: StoryboardSheet;
      directions: string[];
      /** The look of the ad, so every clip, remade ones included, is edited in the same style. */
      artDirection?: string;
      plan: Extract<ClipPlan, { ok: true }>;
      finished?: Record<number, { assetId: string; bytes: Uint8Array }>;
      /** Asked for a narration: the scenes the script is written from, and what the seller said. */
      voiceOver?: { scenes: string[]; text: string };
    }) {
      const { plan, voiceOver, sheet, directions, artDirection } = request;
      const finished = request.finished ?? {};
      if (!(await isProduct(sheet.file))) throw new NotAProductError();

      // Only the clips still to be made are paid for, and they are booked before the first one, so
      // simultaneous requests cannot squeeze under a limit.
      const missing = plan.clips.filter((_, index) => !finished[index]);
      // The narration is booked with the video, so a budget that covers only the picture is refused up front.
      const voiceCost = voiceOver ? speechCostOf(plan.seconds) : 0;
      const reservation = await ledger.reserve(roundUsd(costOf(sum(missing)) + voiceCost), { dailyUsd: COSTS.dailyBudgetUsd });
      if (!reservation.ok) {
        // A shorter video may still fit; only when not even the shortest clip does, the plain limit message is clearer.
        const affordable = await affordableSeconds(Boolean(voiceOver));
        if (affordable >= CLIP_SECONDS.min) throw new VideoNotAffordableError(affordable);
        throw new DailyCapReachedError(reservation.resetsAt);
      }

      const jobId = randomUUID();
      send({ type: "job_started", jobId, kind: "video" });
      const made: Uint8Array[] = [];
      for (const [index, seconds] of plan.clips.entries()) {
        if (finished[index]) {
          made.push(finished[index].bytes);
          continue;
        }
        send({
          type: "job_progress",
          jobId,
          message: `Membuat klip ${index + 1} dari ${plan.clips.length}`,
          percent: Math.round((index / plan.clips.length) * 100),
        });
        try {
          made.push(await models.generateClip({ prompt: clipPrompt(directions[index], artDirection), frame: sheet.file, seconds }));
        } catch (error) {
          // Clips that were not made are given back, and so is the voice, which was never started.
          // A clip that timed out may still be billed, so it stays booked.
          const start = index + (mayStillBeBilled(error) ? 1 : 0);
          const notBilled = plan.clips.filter((_, position) => position >= start && !finished[position]);
          await ledger.record(-roundUsd(costOf(sum(notBilled)) + voiceCost));

          // The clips that came out are kept, so the seller can remake just the rest instead of paying again.
          const kept: Record<number, string> = {};
          for (const [position, file] of made.entries()) {
            kept[position] = finished[position]?.assetId ?? (await assets.saveVideo(file));
          }
          send({
            type: "video_partial",
            seconds: plan.seconds,
            clips: plan.clips,
            finished: kept,
            failedIndex: index,
            sourceAssetId: sheet.assetId,
            voiceOver: Boolean(voiceOver),
            directions,
          });
          // What stays booked is real spend, so the meter shows it now.
          const { monthUsd } = await readUsage(ledger);
          send({ type: "usage_updated", monthUsd });
          throw new ClipFailedError(index, plan.clips.length, error);
        }
      }

      const silent = await joinClips(made, plan.seconds);
      const silentAssetId = await assets.saveVideo(silent);

      // The narration is laid over the silent video. If it fails, the seller still gets the silent video.
      let assetId = silentAssetId;
      let narration: { script: string } | undefined;
      if (voiceOver) {
        let spoken = false;
        try {
          const script = await models.writeVoiceScript({ scenes: voiceOver.scenes, seconds: plan.seconds, text: voiceOver.text });
          // The script comes from a model, so it is checked before anything is read aloud and billed.
          if (!narrationFits(script, plan.seconds)) throw new Error("The script is too long for the video.");
          const voice = await models.speak(script);
          spoken = true;
          assetId = await assets.saveVideo(await addVoice(silent, voice.bytes, plan.seconds));
          narration = { script };
        } catch (error) {
          // A voice that was rejected is not billed, and one that was never made is not either; one that timed out
          // may still be, and one that was made stays billed even if laying it over the video failed.
          if (!spoken && !mayStillBeBilled(error)) await ledger.record(-voiceCost);
          send({
            type: "assistant_text",
            text: "Suaranya belum berhasil dibuat, jadi ini videonya tanpa suara. Coba minta voice over lagi nanti ya.",
          });
        }
      }

      send({
        type: "asset_ready",
        assetId,
        kind: "video",
        url: `/api/assets/${assetId}`,
        role: "video",
        sourceAssetId: sheet.assetId,
      });
      if (narration) {
        send({ type: "voice_over", script: narration.script, voice: MODELS.voice, silentAssetId, seconds: plan.seconds });
      }

      const { monthUsd } = await readUsage(ledger);
      send({ type: "usage_updated", monthUsd });
    },

    /**
     * Reads a new script, or the same one in another voice, over the silent video of an earlier try.
     * No video model is called, so only the voice is booked.
     */
    async reviseVoice(request: { silentAssetId: string; silent: Uint8Array; seconds: number; script: string; voice: string }) {
      const { silentAssetId, silent, seconds, script, voice } = request;
      const cost = roundUsd(seconds * COSTS.speechUsdPerSecond);
      const reservation = await ledger.reserve(cost, { dailyUsd: COSTS.dailyBudgetUsd });
      if (!reservation.ok) throw new DailyCapReachedError(reservation.resetsAt);

      let assetId: string;
      let spoken = false;
      try {
        const audio = await models.speak(script, voice);
        spoken = true;
        assetId = await assets.saveVideo(await addVoice(silent, audio.bytes, seconds));
      } catch (error) {
        // A voice that was rejected is not billed; one that timed out may still be, and one that was made stays billed.
        if (!spoken && !mayStillBeBilled(error)) await ledger.record(-cost);
        const { monthUsd } = await readUsage(ledger);
        send({ type: "usage_updated", monthUsd });
        throw error;
      }

      send({
        type: "asset_ready",
        assetId,
        kind: "video",
        url: `/api/assets/${assetId}`,
        role: "video",
        sourceAssetId: silentAssetId,
      });
      send({ type: "voice_over", script, voice, silentAssetId, seconds });

      const { monthUsd } = await readUsage(ledger);
      send({ type: "usage_updated", monthUsd });
    },
  };
}
