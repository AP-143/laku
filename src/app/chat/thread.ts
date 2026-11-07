import type { ErrorCode, StudioStyle } from "../../shared/chat-events";

/** What the chat page shows, one entry per thing in the conversation. Everything here is plain JSON so it can be saved. */

/** The request that produced an item, kept so "Coba lagi" can send the very same thing again. */
export type RetryRequest = Record<string, unknown>;

export type ThreadItem =
  | { id: string; kind: "user"; text: string; photoAssetId?: string }
  | { id: string; kind: "bot"; text: string }
  | { id: string; kind: "studio"; assetId: string; sourceAssetId: string; retry: RetryRequest }
  | {
      id: string;
      kind: "scenes";
      sourceAssetId: string;
      scenes: string[];
      /** The look the planner picked for this product, kept so a retry draws the picture in the same look. Not shown. */
      artDirection?: string;
      /** The finished storyboard picture: all the panels in one image. */
      sheet?: string;
      /** The picture is being generated right now (not saved). */
      busy?: boolean;
    }
  | { id: string; kind: "video"; assetId: string; sourceAssetId: string }
  /** The bot asks before spending: the request to send again with a yes, and the seller's answer once given. */
  | { id: string; kind: "confirm"; message: string; estimatedUsd?: number; retry: RetryRequest; answer?: "yes" | "no" }
  | { id: string; kind: "error"; message: string; code?: ErrorCode; retryable: boolean; retry?: RetryRequest };

/**
 * The request that draws the picture of a storyboard again from the scenes it was planned with, for the retry of a picture
 * that failed or that the seller wants drawn again. The scenes are not planned again.
 */
export function redrawRequest(storyboard: { sourceAssetId: string; scenes: string[]; artDirection?: string }): RetryRequest {
  return {
    messages: [{ role: "user", text: "Coba lagi." }],
    redraw: { photoAssetId: storyboard.sourceAssetId, scenes: storyboard.scenes, artDirection: storyboard.artDirection },
  };
}

export const PRESET_LABELS = {
  clean_white: "Putih bersih",
  solid_color: "Backdrop warna",
  lifestyle: "Lifestyle",
} as const;

export type Preset = keyof typeof PRESET_LABELS;

export function styleOf(preset: Preset | undefined): StudioStyle | undefined {
  return preset ? { preset } : undefined;
}

/** The newest studio photo, which a chat revision starts from. */
export function lastStudioAssetId(items: ThreadItem[]): string | undefined {
  return items.findLast((item) => item.kind === "studio")?.assetId;
}

/** The photo the seller attached most recently, so a typed request can still use it on the next turn. */
export function lastPhotoAssetId(items: ThreadItem[]): string | undefined {
  for (const item of items.toReversed()) {
    if (item.kind === "user" && item.photoAssetId) return item.photoAssetId;
  }
  return undefined;
}
