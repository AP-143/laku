import { randomUUID } from "node:crypto";
import { COSTS } from "../config/models";
import type { AssetRole, ChatEvent, JobKind } from "../shared/chat-events";
import type { AssetFile, AssetStore } from "./asset-store";
import type { ModelClient } from "./model-client";
import { DailyCapReachedError, mayStillBeBilled } from "./model-errors";
import { preparePhoto } from "./photo-intake";
import { readUsage, type UsageLedger } from "./usage-ledger";

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
 * Runs one paid image generation from start to finish: budget check, model call, saving, ledger, events.
 * It throws on failure and never retries, so the caller decides what the user sees.
 */
export function createImageJobs(deps: {
  models: ModelClient;
  assets: AssetStore;
  ledger: UsageLedger;
  send: (event: ChatEvent) => void;
  /** Asked about the source image of every generation, so no paid path skips the product check. */
  isProduct: (image: AssetFile) => Promise<boolean>;
}) {
  const { models, assets, ledger, send, isProduct } = deps;

  return {
    async generate({ prompt, source, sourceAssetId, kind, role }: ImageJobRequest) {
      if (!(await isProduct(source))) throw new NotAProductError();

      // A generation that would pass the day's limit never starts.
      // The cost is booked before the call, so simultaneous requests cannot both squeeze under the limit.
      const reservation = await ledger.reserve(COSTS.imageUsd, { dailyUsd: COSTS.dailyBudgetUsd });
      if (!reservation.ok) throw new DailyCapReachedError(reservation.resetsAt);

      send({ type: "job_started", jobId: randomUUID(), kind });
      let image;
      try {
        image = await models.generateImage({ prompt, reference: source, aspectRatio: kind === "storyboard_sheet" ? "9:16" : "1:1" });
      } catch (error) {
        // A call that was rejected is not billed, so the booking goes back. A timeout or a cancel may still be
        // billed, so it stays booked: the limits would otherwise sit below the real spend.
        if (!mayStillBeBilled(error)) await ledger.record(-COSTS.imageUsd);
        throw error;
      }

      // Resized copy included, so the result can feed the next generation.
      const assetId = await assets.save(await preparePhoto(image.bytes));
      send({ type: "asset_ready", assetId, kind: "image", url: `/api/assets/${assetId}`, role, sourceAssetId });

      const { monthUsd } = await readUsage(ledger);
      send({ type: "usage_updated", monthUsd });
    },
  };
}
