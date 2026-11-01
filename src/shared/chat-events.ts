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
  | { type: "asset_ready"; assetId: string; kind: AssetKind; url: string }
  /** Something went wrong. `message` is shown to the user as is, so it is Indonesian. */
  | { type: "error"; message: string; retryable: boolean }
  /** Always the last event of a successful stream. */
  | { type: "done" };

export type JobKind = "studio_photo" | "storyboard_frame" | "video";
export type AssetKind = "image" | "video";

export const CHAT_EVENTS_CONTENT_TYPE = "application/x-ndjson; charset=utf-8";

export function encodeChatEvent(event: ChatEvent): string {
  return `${JSON.stringify(event)}\n`;
}
