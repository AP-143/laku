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
      /** Finished frames by scene index (0 to 3). */
      frames: Record<number, string>;
      /** Scenes whose frame is being generated right now (not saved). */
      busy?: number[];
      approved: boolean;
    }
  | { id: string; kind: "video"; assetId: string; sourceAssetId: string }
  /** The bot asks before spending: the request to send again with a yes, and the seller's answer once given. */
  | { id: string; kind: "confirm"; message: string; retry: RetryRequest; answer?: "yes" | "no" }
  | { id: string; kind: "error"; message: string; code?: ErrorCode; retryable: boolean; retry?: RetryRequest };

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

/** The finished frames of the newest storyboard in scene order, which a video is made from. */
export function storyboardFrames(items: ThreadItem[]): string[] {
  const latest = items.findLast((item) => item.kind === "scenes");
  if (!latest) return [];
  return Object.entries(latest.frames)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, assetId]) => assetId);
}

/**
 * The storyboard scenes can still be edited in chat: the newest one, until at least one frame exists.
 * (A failed first approval leaves it open, so the seller can still change a scene.)
 */
export function openStoryboard(items: ThreadItem[]) {
  const latest = items.findLast((item) => item.kind === "scenes");
  return latest && Object.keys(latest.frames).length === 0 ? latest : undefined;
}
