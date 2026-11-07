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
