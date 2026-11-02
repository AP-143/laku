import { randomUUID } from "node:crypto";
import { COSTS } from "../config/models";
import type { AssetRole, ChatEvent, JobKind } from "../shared/chat-events";
import type { AssetFile, AssetStore } from "./asset-store";
import type { ModelClient } from "./model-client";
import { QuotaExhaustedError } from "./model-errors";
import { preparePhoto } from "./photo-intake";
import { readUsage, type UsageLedger } from "./usage-ledger";

interface ImageJobRequest {
  prompt: string;
  /** The photo the new image is made from. */
  source: AssetFile;
  sourceAssetId: string;
  kind: JobKind;
  role: AssetRole;
  /** For a storyboard frame: which scene it shows. */
  sceneIndex?: number;
}

/**
 * Runs one paid image generation from start to finish: budget check, model call, saving, ledger, events.
 * It throws on failure and never retries, so the caller decides what the user sees.
 */
export function createImageJobs(deps: {
  models: ModelClient;
  assets: AssetStore;
  ledger: UsageLedger;
  send: (event: ChatEvent) => void;
}) {
  const { models, assets, ledger, send } = deps;

  return {
    async generate({ prompt, source, sourceAssetId, kind, role, sceneIndex }: ImageJobRequest) {
      // The free credit is the hard limit, so a generation that would pass it never starts.
      if ((await ledger.monthTotal()) + COSTS.imageUsd > COSTS.monthlyBudgetUsd) throw new QuotaExhaustedError();

      send({ type: "job_started", jobId: randomUUID(), kind });
      const image = await models.generateImage({ prompt, reference: source });
      await ledger.record(COSTS.imageUsd);

      // Resized copy included, so the result can feed the next generation.
      const assetId = await assets.save(await preparePhoto(image.bytes));
      send({ type: "asset_ready", assetId, kind: "image", url: `/api/assets/${assetId}`, role, sourceAssetId, sceneIndex });

      const { monthUsd, budgetUsd } = await readUsage(ledger);
      send({ type: "usage_updated", monthUsd, budgetUsd });
    },
  };
}
