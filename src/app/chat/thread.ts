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
  | {
      id: string;
      kind: "video";
      assetId: string;
      sourceAssetId: string;
      /** The narration read aloud, when the seller asked for a voice-over. */
      script?: string;
      /** The silent video the narration was laid over, so the voice can be changed without new clips. */
      silentAssetId?: string;
      /** The voice of the narration and the length of the video, sent back when the seller asks for a change. */
      voice?: string;
      seconds?: number;
    }
  /** A video stopped part way: the clips kept so far, and what is needed to remake only the rest. */
  | {
      id: string;
      kind: "partial";
      seconds: number;
      clips: number[];
      finished: Record<number, string>;
      failedIndex: number;
      /** The seller asked for a voice-over, so the resume asks for it again. */
      voiceOver: boolean;
      /** The storyboard frames the video is made from, sent again with the resume. */
      frames: string[];
      /** The seller already asked to remake the rest. */
      resumed?: boolean;
    }
  /** The bot asks before spending: the request to send again with a yes, and the seller's answer once given. */
  | { id: string; kind: "confirm"; message: string; estimatedUsd?: number; retry: RetryRequest; answer?: "yes" | "no" }
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

/** The newest video when it has a narration, which the seller can still ask to change. */
export function narratedVideo(items: ThreadItem[]) {
  const latest = items.findLast((item) => item.kind === "video");
  if (!latest || latest.kind !== "video") return undefined;
  const { script, silentAssetId, voice, seconds } = latest;
  return script && silentAssetId && voice && seconds ? { silentAssetId, seconds, script, voice } : undefined;
}

/** The text of the newest storyboard's scenes, which a voice-over script is written from. */
export function storyboardScenes(items: ThreadItem[]): string[] {
  return items.findLast((item) => item.kind === "scenes")?.scenes ?? [];
}

/**
 * The finished frames of the newest storyboard in scene order, which a video is made from.
 * A scene whose frame did not come out is skipped; the others keep their order, so the video still tells the story.
 */
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
