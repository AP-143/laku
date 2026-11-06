/**
 * The events the chat API streams to the UI, one JSON object per line (NDJSON).
 * The wire format is shared by the server and the browser, so it lives in one place.
 */

import type { MusicPlan, NarrationLine, VideoChoice, VideoGrade, VoiceGender } from "./video-plan";

export type ChatEvent =
  /** A piece of the assistant's reply. Concatenate the pieces in order. */
  | { type: "assistant_text"; text: string }
  /** The bot needs the user's explicit yes before doing something costly. */
  | { type: "confirmation_requested"; confirmationId: string; message: string; estimatedUsd?: number; videoChoice?: VideoChoice }
  /** A long-running generation started. */
  | { type: "job_started"; jobId: string; kind: JobKind }
  /** Progress of a running generation. */
  | { type: "job_progress"; jobId: string; message: string; percent?: number }
  /** A generated file is ready to show or download. */
  | {
      type: "asset_ready";
      assetId: string;
      kind: AssetKind;
      url: string;
      /** What the asset is, when the bot generated it (an uploaded photo has no role). */
      role?: AssetRole;
      /** The asset this one was made from, so the UI can show before and after side by side. */
      sourceAssetId?: string;
    }
  /**
   * The video has a narration: the script that was read aloud, the voice, and the silent video it was laid over
   * (kept so the script or the voice can be changed without making the clips again).
   */
  | { type: "voice_over"; script: string; voice: string; silentAssetId: string; seconds: number; lines: NarrationLine[] }
  /**
   * A video stopped part way. The clips in `finished` (by position) are kept and saved; the rest can be remade by
   * sending `resume` with these same numbers. `failedIndex` is the first clip that did not come out.
   */
  | {
      type: "video_partial";
      seconds: number;
      clips: number[];
      finished: Record<number, string>;
      failedIndex: number;
      sourceAssetId: string;
      /** The video has a voice-over, so it is added when the missing clips are remade. */
      voiceOver: boolean;
      /** What each clip was told to play and say, sent back on a resume so the remade clips still fit the kept ones. */
      directions: string[];
      /** The lines of the voice-over, read once the clips are made, so a remade video gets them too. */
      narration: NarrationLine[];
      /** The voice of the narration, when there is one. */
      voice: VoiceGender;
      /** The colour grade, so a remade video is finished the same way. */
      grade: VideoGrade;
      /** The music the video was to get, made after the clips, so a remade video still gets it. */
      music?: MusicPlan;
    }
  /**
   * The scenes of a storyboard (one per panel) and its art direction, sent just before its picture is drawn. They are data
   * for the browser to keep (a retry draws the picture from them), not something to show.
   */
  | { type: "storyboard_scenes"; sourceAssetId: string; scenes: string[]; artDirection?: string }
  /** Something went wrong. `message` is shown to the user as is, so it is Indonesian. */
  | { type: "error"; message: string; retryable: boolean; code?: ErrorCode }
  /** This month's estimated spend changed (sent after every paid generation). */
  | { type: "usage_updated"; monthUsd: number }
  /** Always the last event of a successful stream. */
  | { type: "done" };

/** Lets the UI tell the common failures apart; `message` is still what the user reads. */
export type ErrorCode = "rate_limited" | "quota_exhausted";

export type JobKind = "studio_photo" | "storyboard_sheet" | "video";
export type AssetKind = "image" | "video";
/** A `storyboard_sheet` is the whole storyboard as one picture: all its panels, with titles and captions. */
export type AssetRole = "studio_photo" | "storyboard_sheet" | "video";

/** The Features the seller can pick before typing: a studio photo, a storyboard, or a video from a storyboard picture they attach. */
export type ChatIntent = "studio_photo" | "storyboard" | "video";

export type StylePreset = "clean_white" | "solid_color" | "lifestyle";
/** A look for the studio photo: one of the presets, or the seller's own words. */
export type StudioStyle = { preset: StylePreset } | { text: string };

export const CHAT_EVENTS_CONTENT_TYPE = "application/x-ndjson; charset=utf-8";

export function encodeChatEvent(event: ChatEvent): string {
  return `${JSON.stringify(event)}\n`;
}
