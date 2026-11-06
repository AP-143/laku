import { randomUUID } from "node:crypto";
import { COSTS, VOICES } from "../config/models";
import type { ChatEvent } from "../shared/chat-events";
import type { ClipPlan, MusicPlan, NarrationLine, VideoGrade, VoiceGender } from "../shared/video-plan";
import type { AssetFile, AssetStore } from "./asset-store";
import { DEFAULT_DELIVERY } from "./chat-prompt";
import { clipPrompt, musicPrompt } from "./image-prompts";
import { NotAProductError } from "./image-jobs";
import type { ModelClient } from "./model-client";
import { ClipFailedError, mayStillBeBilled } from "./model-errors";
import { readUsage, type UsageLedger } from "./usage-ledger";
import { addMusic, addVoice, joinClips, probeSeconds, type VoiceSegment } from "./video-join";

/** The most a line of the narration is sped up to fit its moment; more than this sounds hurried. */
const MAX_NARRATION_TEMPO = 1.15;

/**
 * Where a line of `length` seconds starts and how much it is sped up, so it is over by `until` and begins at its moment
 * (`at`). A line that only just runs past is sped up a little; one that is still too long starts a little earlier, never
 * more than half a second before its moment. It is never cut off.
 */
function placeLine(length: number, at: number, until: number): { start: number; tempo: number } {
  const room = Math.max(0.5, until - at);
  if (length <= room) return { start: at, tempo: 1 };
  const tempo = Math.min(MAX_NARRATION_TEMPO, length / room);
  const fitted = length / tempo;
  return { start: fitted <= room ? at : Math.max(0, at - 0.5, until - fitted), tempo };
}

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
 * the video) and music (`musicUsd`) it is the price that is booked, so the seller is asked about what they will really be charged.
 */
export const videoCostUsd = (clips: number[], voiceSeconds = 0, musicUsd = 0) =>
  roundUsd(costOf(sum(clips)) + speechCostOf(voiceSeconds) + musicUsd);

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

  /** Where a line starts and how much it is sped up: it is read in the voice and the emotion it was given. */
  async function speakLines(lines: NarrationLine[], voice: string) {
    const segments: VoiceSegment[] = [];
    let spoken = false;
    let failure: unknown;
    for (const line of lines) {
      try {
        const read = await models.speak(line.text, voice, line.delivery || DEFAULT_DELIVERY);
        spoken = true;
        segments.push({ bytes: read.bytes, ...placeLine(await probeSeconds(read.bytes), line.at, line.until) });
      } catch (error) {
        // A line that cannot be read is left out; the others still are.
        failure = error;
      }
    }
    return { segments, spoken, failure };
  }

  return {
    /**
     * Every clip starts from the same storyboard `sheet` and plays its own `directions` (one per clip, in order).
     * `finished` holds clips made by an earlier try (by position), which are used as they are and not paid for again.
     */
    async generate(request: {
      sheet: StoryboardSheet;
      directions: string[];
      /** The lines of the voice-over, each at its moment; none when no voice-over was asked for. */
      narration: NarrationLine[];
      /** The voice of the narration. */
      voice: VoiceGender;
      /** The colour grade of the whole video, added in the edit. The text on screen is the video model's. */
      grade: VideoGrade;
      /** The music bed the planner designed, made after the clips; none when the seller did not ask for music. */
      music?: MusicPlan;
      plan: Extract<ClipPlan, { ok: true }>;
      finished?: Record<number, { assetId: string; bytes: Uint8Array }>;
    }) {
      const { plan, narration, sheet, directions, voice: voiceGender, grade, music } = request;
      const finished = request.finished ?? {};
      if (!(await isProduct(sheet.file))) throw new NotAProductError();

      // Only the clips still to be made are paid for, and they are booked before the first one, so
      // simultaneous requests cannot squeeze under a limit.
      const missing = plan.clips.filter((_, index) => !finished[index]);
      // The narration is booked with the video, so a budget that covers only the picture is refused up front.
      const voiceCost = narration.length > 0 ? speechCostOf(plan.seconds) : 0;
      await ledger.record(roundUsd(costOf(sum(missing)) + voiceCost));

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
          made.push(await models.generateClip({ prompt: clipPrompt(directions[index]), frame: sheet.file, seconds }));
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
            voiceOver: narration.length > 0,
            directions,
            narration,
            voice: voiceGender,
            grade,
            music,
          });
          // What stays booked is real spend, so the meter shows it now.
          const { monthUsd } = await readUsage(ledger);
          send({ type: "usage_updated", monthUsd });
          throw new ClipFailedError(index, plan.clips.length, error);
        }
      }

      let silent = await joinClips(made, plan.seconds, { grade });

      // The music bed goes under the sound of the video before any narration, so the narration ducks it too. If it
      // fails the seller still gets the video, and a rejected call is not billed.
      if (music) {
        await ledger.record(COSTS.musicUsd);
        try {
          const track = await models.generateMusic({ prompt: musicPrompt(music.brief) });
          silent = await addMusic(silent, track, plan.seconds, music.gain);
        } catch (error) {
          if (!mayStillBeBilled(error)) await ledger.record(-COSTS.musicUsd);
          send({ type: "assistant_text", text: "Musik latarnya belum berhasil dibuat, jadi videonya tanpa musik. Coba lagi nanti ya." });
        }
      }
      const silentAssetId = await assets.saveVideo(silent);

      // The lines of the voice-over are laid over the video, each at its moment. If it fails, the seller still gets the video.
      let assetId = silentAssetId;
      let narrated = false;
      if (narration.length > 0) {
        const { segments, spoken, failure } = await speakLines(narration, VOICES[voiceGender]);
        let laidOver = failure;
        if (segments.length > 0) {
          try {
            assetId = await assets.saveVideo(await addVoice(silent, segments, plan.seconds));
            narrated = true;
          } catch (error) {
            laidOver = error;
          }
        }
        if (!narrated) {
          // A voice that was rejected is not billed, and one that was never made is not either; one that timed out may
          // still be, and one that was made stays billed even if laying it over the video failed.
          if (!spoken && !(laidOver && mayStillBeBilled(laidOver))) await ledger.record(-voiceCost);
          send({
            type: "assistant_text",
            text: "Narasinya belum berhasil dibuat, jadi ini videonya tanpa narasi (efek suaranya tetap ada). Coba minta narasi lagi nanti ya.",
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
      if (narrated) {
        send({
          type: "voice_over",
          script: narration.map((line) => line.text).join(" "),
          voice: VOICES[voiceGender],
          silentAssetId,
          seconds: plan.seconds,
          lines: narration,
        });
      }

      const { monthUsd } = await readUsage(ledger);
      send({ type: "usage_updated", monthUsd });
    },

    /**
     * Reads the lines of a narration again (in another voice, or the new words of the seller) over the video of an
     * earlier try. No video model is called, so only the voice is booked.
     */
    async reviseVoice(request: { silentAssetId: string; silent: Uint8Array; seconds: number; lines: NarrationLine[]; voice: string }) {
      const { silentAssetId, silent, seconds, lines, voice } = request;
      const cost = roundUsd(seconds * COSTS.speechUsdPerSecond);
      await ledger.record(cost);

      const { segments, spoken, failure } = await speakLines(lines, voice);
      let assetId: string;
      try {
        if (segments.length === 0) throw failure ?? new Error("The narration was not made.");
        assetId = await assets.saveVideo(await addVoice(silent, segments, seconds));
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
      send({ type: "voice_over", script: lines.map((line) => line.text).join(" "), voice, silentAssetId, seconds, lines });

      const { monthUsd } = await readUsage(ledger);
      send({ type: "usage_updated", monthUsd });
    },
  };
}
