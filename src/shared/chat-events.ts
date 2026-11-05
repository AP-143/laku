/**
 * The events the chat API streams to the UI, one JSON object per line (NDJSON).
 * The wire format is shared by the server and the browser, so it lives in one place.
 */

export type ChatEvent =
  /** A piece of the assistant's reply. Concatenate the pieces in order. */
  | { type: "assistant_text"; text: string }
  /** The bot needs the user's explicit yes before doing something costly. */
  | { type: "confirmation_requested"; confirmationId: string; message: string; estimatedUsd?: number }
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
      /** For a storyboard frame: which scene (0 to 3) it shows. */
      sceneIndex?: number;
    }
  /**
   * The video has a narration: the script that was read aloud, the voice, and the silent video it was laid over
   * (kept so the script or the voice can be changed without making the clips again).
   */
  | { type: "voice_over"; script: string; voice: string; silentAssetId: string; seconds: number }
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
      /** The seller asked for a voice-over, so it is added when the missing clips are remade. */
      voiceOver: boolean;
    }
  /** The four proposed scenes of a storyboard. Nothing is generated until the user approves them. */
  | { type: "storyboard_scenes"; sourceAssetId: string; scenes: string[] }
  /** Something went wrong. `message` is shown to the user as is, so it is Indonesian. */
  | { type: "error"; message: string; retryable: boolean; code?: ErrorCode }
  /** This month's estimated spend changed (sent after every paid generation). */
  | { type: "usage_updated"; monthUsd: number; budgetUsd: number }
  /** Always the last event of a successful stream. */
  | { type: "done" };

/** Lets the UI tell the common failures apart; `message` is still what the user reads. */
export type ErrorCode = "rate_limited" | "quota_exhausted" | "daily_cap_reached";

export type JobKind = "studio_photo" | "storyboard_frame" | "video";
export type AssetKind = "image" | "video";
export type AssetRole = "studio_photo" | "storyboard_frame" | "video";

/** The shortcut chips in the composer. */
/** The shortcut chips under the composer. A video is made from a storyboard, so it is not a chip of its own. */
export type ChatIntent = "studio_photo" | "storyboard";

export type StylePreset = "clean_white" | "solid_color" | "lifestyle";
/** A look for the studio photo: one of the presets, or the seller's own words. */
export type StudioStyle = { preset: StylePreset } | { text: string };

export const CHAT_EVENTS_CONTENT_TYPE = "application/x-ndjson; charset=utf-8";

export function encodeChatEvent(event: ChatEvent): string {
  return `${JSON.stringify(event)}\n`;
}
