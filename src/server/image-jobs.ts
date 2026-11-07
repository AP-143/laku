import { randomUUID } from "node:crypto";
import type { AssetRole, ChatEvent, JobKind } from "../shared/chat-events";
import type { AssetFile, AssetStore } from "./asset-store";
import type { ModelClient } from "./model-client";
import { preparePhoto } from "./photo-intake";

interface ImageJobRequest {
  prompt: string;
  /** The photo the new image is made from. */
  source: AssetFile;
  sourceAssetId: string;
  kind: JobKind;
  role: AssetRole;
}

/** The image that would feed a paid model is not a product photo, so nothing was generated. */
export class NotAProductError extends Error {}

/**
 * Runs one paid image generation from start to finish: product check, model call, saving, events.
 * It throws on failure and never retries, so the caller decides what the user sees.
 */
export function createImageJobs(deps: {
  models: ModelClient;
  assets: AssetStore;
  send: (event: ChatEvent) => void;
  /** Asked about the source image of every generation, so no paid path skips the product check. */
  isProduct: (image: AssetFile) => Promise<boolean>;
}) {
  const { models, assets, send, isProduct } = deps;

  return {
    async generate({ prompt, source, sourceAssetId, kind, role }: ImageJobRequest) {
      if (!(await isProduct(source))) throw new NotAProductError();

      send({ type: "job_started", jobId: randomUUID(), kind });
      const image = await models.generateImage({ prompt, reference: source, aspectRatio: kind === "storyboard_sheet" ? "9:16" : "1:1" });

      // Resized copy included, so the result can feed the next generation.
      const assetId = await assets.save(await preparePhoto(image.bytes));
      send({ type: "asset_ready", assetId, kind: "image", url: `/api/assets/${assetId}`, role, sourceAssetId });
    },
  };
}
