import { randomUUID } from "node:crypto";
import { COSTS } from "../config/models";
import type { ChatEvent } from "../shared/chat-events";
import type { AssetFile, AssetStore } from "./asset-store";
import { NotAProductError } from "./image-jobs";
import type { ModelClient } from "./model-client";

/** The storyboard picture a video is made from. */
export interface StoryboardSheet {
  assetId: string;
  file: AssetFile;
}

const roundUsd = (usd: number) => Math.round(usd * 10_000) / 10_000;

/** The estimated price of a video of this many seconds, in US dollars. */
export const videoCostUsd = (seconds: number) => roundUsd(seconds * COSTS.videoUsdPerSecond);

/**
 * Runs one video from start to finish: product check, the video, saving, events.
 * It throws on failure and never retries, so the caller decides what the user sees.
 */
export function createVideoJobs(deps: {
  models: ModelClient;
  assets: AssetStore;
  send: (event: ChatEvent) => void;
  /** Asked about the picture the video is made from, so no paid path skips the product check (the frame check, not the photo one). */
  isProduct: (image: AssetFile) => Promise<boolean>;
  /** Told what the video model is asked (the seller's words only), so a bad video can be traced to its words. */
  log?: (message: string) => void;
}) {
  const { models, assets, send, isProduct, log } = deps;

  return {
    /**
     * Makes a video of `seconds` from the storyboard `sheet`. `prompt` is what the seller typed, passed on as it was
     * written; the video model decides how the video looks, moves and sounds.
     */
    async generate(request: { sheet: StoryboardSheet; prompt?: string; seconds: number }) {
      const { sheet, prompt, seconds } = request;
      if (!(await isProduct(sheet.file))) throw new NotAProductError();

      const jobId = randomUUID();
      send({ type: "job_started", jobId, kind: "video" });
      send({ type: "job_progress", jobId, message: "Membuat video" });

      log?.(`[video ${seconds}s] prompt: ${prompt ?? "(none)"}`);
      const video = await models.generateVideo({ prompt, frame: sheet.file, seconds });

      const assetId = await assets.saveVideo(video);
      send({
        type: "asset_ready",
        assetId,
        kind: "video",
        url: `/api/assets/${assetId}`,
        role: "video",
        sourceAssetId: sheet.assetId,
      });
    },
  };
}
