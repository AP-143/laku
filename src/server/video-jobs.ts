import { randomUUID } from "node:crypto";
import { COSTS, VOICES } from "../config/models";
import type { ChatEvent } from "../shared/chat-events";
import type { AudioMode, ClipCaption, ClipPlan, MusicPlan, TextPalette, VideoGrade, VoiceGender } from "../shared/video-plan";
import type { AssetFile, AssetStore } from "./asset-store";
import { narrationFits } from "./chat-prompt";
import { clipPrompt, musicPrompt } from "./image-prompts";
import { NotAProductError } from "./image-jobs";
import type { ModelClient } from "./model-client";
import { ClipFailedError, mayStillBeBilled } from "./model-errors";
import { readUsage, type UsageLedger } from "./usage-ledger";
import { addMusic, addVoice, joinClips, probeSeconds } from "./video-join";

/** The narration ends this long before the video does, so its last word is not the last frame. */
const NARRATION_END_BUFFER_SECONDS = 0.7;
/** The most a narration is sped up to fit; more than this sounds hurried. */
const MAX_NARRATION_TEMPO = 1.12;
/** A narration that is still too long is written again for this share of the length. */
const SHORTER_NARRATION = 0.75;

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

  return {
    /**
     * Every clip starts from the same storyboard `sheet` and plays its own `directions` (one per clip, in order).
     * `finished` holds clips made by an earlier try (by position), which are used as they are and not paid for again.
     */
    async generate(request: {
      sheet: StoryboardSheet;
      directions: string[];
      /** How the video sounds: speech made by the clips, a narration laid over, or no voice. */
      audio: AudioMode;
      /** The voice of the narration, when there is one. */
      voice: VoiceGender;
      /** The captions of each clip and the colour grade of the whole video, added in the edit. */
      captions: ClipCaption[][];
      grade: VideoGrade;
      palette: TextPalette;
      /** The music bed the planner designed, made after the clips; none when the seller did not ask for music. */
      music?: MusicPlan;
      /** The look of the ad, so every clip, remade ones included, is edited in the same style. */
      artDirection?: string;
      plan: Extract<ClipPlan, { ok: true }>;
      finished?: Record<number, { assetId: string; bytes: Uint8Array }>;
      /** Asked for a narration: the scenes the script is written from, what the seller said, and the voice and look it should match. */
      voiceOver?: { scenes: string[]; text: string; voiceProfile?: string };
    }) {
      const { plan, voiceOver, sheet, directions, artDirection, audio, voice: voiceGender, captions, grade, palette, music } = request;
      const finished = request.finished ?? {};
      if (!(await isProduct(sheet.file))) throw new NotAProductError();

      // Only the clips still to be made are paid for, and they are booked before the first one, so
      // simultaneous requests cannot squeeze under a limit.
      const missing = plan.clips.filter((_, index) => !finished[index]);
      // The narration is booked with the video, so a budget that covers only the picture is refused up front.
      const voiceCost = voiceOver ? speechCostOf(plan.seconds) : 0;
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
            audio,
            voice: voiceGender,
            captions,
            grade,
            palette,
            music,
          });
          // What stays booked is real spend, so the meter shows it now.
          const { monthUsd } = await readUsage(ledger);
          send({ type: "usage_updated", monthUsd });
          throw new ClipFailedError(index, plan.clips.length, error);
        }
      }

      let silent = await joinClips(made, plan.seconds, { clipSeconds: plan.clips, captions, grade, palette });

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

      // The narration is laid over the silent video. If it fails, the seller still gets the silent video.
      let assetId = silentAssetId;
      let narration: { script: string; delivery: string } | undefined;
      if (voiceOver) {
        let spoken = false;
        try {
          // The narration has to end before the video does, so the closing line is never cut off: it may run a little
          // past that and be sped up; one that is still too long is written again, shorter, once.
          const endsBy = plan.seconds - NARRATION_END_BUFFER_SECONDS;
          let script = "";
          let delivery = "";
          let voice: AssetFile | undefined;
          let length = 0;
          let writtenFor = plan.seconds;
          for (let attempt = 0; attempt < 2; attempt++) {
            const written = await models.writeVoiceScript({
              scenes: voiceOver.scenes,
              seconds: writtenFor,
              text: voiceOver.text,
              voiceProfile: voiceOver.voiceProfile,
              artDirection,
            });
            // The script comes from a model, so it is checked before anything is read aloud and billed.
            if (!narrationFits(written.script, plan.seconds)) {
              if (attempt === 0) throw new Error("The script is too long for the video.");
              break;
            }
            // The second reading is billed too.
            if (attempt === 1) await ledger.record(voiceCost);
            let read: AssetFile;
            try {
              read = await models.speak(written.script, VOICES[voiceGender], written.delivery);
            } catch (error) {
              // The first reading failing is handled below; the second failing keeps the first narration.
              if (attempt === 0) throw error;
              if (!mayStillBeBilled(error)) await ledger.record(-voiceCost);
              break;
            }
            spoken = true;
            script = written.script;
            delivery = written.delivery;
            voice = read;
            length = await probeSeconds(read.bytes);
            if (length <= endsBy * MAX_NARRATION_TEMPO) break;
            writtenFor = plan.seconds * SHORTER_NARRATION;
          }
          if (!voice) throw new Error("The narration was not made.");
          const tempo = Math.min(MAX_NARRATION_TEMPO, Math.max(1, length / endsBy));
          assetId = await assets.saveVideo(await addVoice(silent, voice.bytes, plan.seconds, tempo));
          narration = { script, delivery };
        } catch (error) {
          // A voice that was rejected is not billed, and one that was never made is not either; one that timed out
          // may still be, and one that was made stays billed even if laying it over the video failed.
          if (!spoken && !mayStillBeBilled(error)) await ledger.record(-voiceCost);
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
      if (narration) {
        send({
          type: "voice_over",
          script: narration.script,
          voice: VOICES[voiceGender],
          silentAssetId,
          seconds: plan.seconds,
          delivery: narration.delivery,
        });
      }

      const { monthUsd } = await readUsage(ledger);
      send({ type: "usage_updated", monthUsd });
    },

    /**
     * Reads a new script, or the same one in another voice, over the silent video of an earlier try.
     * No video model is called, so only the voice is booked.
     */
    async reviseVoice(request: {
      silentAssetId: string;
      silent: Uint8Array;
      seconds: number;
      script: string;
      voice: string;
      /** How the narration is performed; kept from the first try so only what was asked for changes. */
      delivery: string;
    }) {
      const { silentAssetId, silent, seconds, script, voice, delivery } = request;
      const cost = roundUsd(seconds * COSTS.speechUsdPerSecond);
      await ledger.record(cost);

      let assetId: string;
      let spoken = false;
      try {
        const audio = await models.speak(script, voice, delivery);
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
      send({ type: "voice_over", script, voice, silentAssetId, seconds, delivery });

      const { monthUsd } = await readUsage(ledger);
      send({ type: "usage_updated", monthUsd });
    },
  };
}
