/**
 * Live model bake-off (manual smoke test, "Seam B").
 *
 * Runs the candidate image and video models from the model configuration on real product photos
 * through the Vercel AI Gateway and saves every output for judging by eye.
 *
 *   npm run bakeoff -- --dry-run          print the plan and estimated spend, call no model
 *   npm run bakeoff                       run it for real
 *   npm run bakeoff -- --cap=1.5          refuse to run if the estimate is above US$1.5 (default 2)
 *   npm run bakeoff -- --image-only | --video-only
 *   npm run bakeoff -- --photos=some/folder
 *
 * It never retries a failed call, and it refuses to start when the estimated spend is above the cap.
 */
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { experimental_generateVideo as generateVideo, gateway, generateImage, generateText } from "ai";
import sharp from "sharp";
import { BAKEOFF_CANDIDATES, VIDEO_SETTINGS, type ImageModelConfig } from "../../src/config/models";
import {
  estimateImageCost,
  estimateVideoCost,
  fetchCatalogue,
  formatUsd,
  type Catalogue,
  type Estimate,
} from "./pricing";
import { buildViewerHtml, classifyError, formatSummary, type JobResult } from "./report";

const PHOTO_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const IMAGE_TIMEOUT_MS = 3 * 60_000;
const VIDEO_TIMEOUT_MS = 12 * 60_000;
const DEFAULT_CAP_USD = 2;

const PROMPTS = {
  studio:
    "Turn this amateur product photo into a professional studio product photo: the product centred on a " +
    "clean white seamless background, soft even studio lighting, a subtle natural shadow, sharp focus. " +
    "Keep the product exactly the same: shape, colour, logo, label text and proportions. " +
    "Do not add, remove or redraw any part of the product. Remove the cluttered background.",
  frame:
    "Create one scene of a vertical 9:16 advertisement storyboard: this exact product on a rustic wooden " +
    "table in warm morning window light, lifestyle styling, shallow depth of field. " +
    "Keep the product exactly the same: shape, colour, logo, label text and proportions. " +
    "Do not add, remove or redraw any part of the product.",
  video:
    "Gentle cinematic camera push-in on the product with soft light shifts. The product stays exactly the " +
    "same and does not change shape, logo or text. No people, no new objects.",
} as const;

interface Options {
  dryRun: boolean;
  capUsd: number;
  photosDir: string;
  imageOnly: boolean;
  videoOnly: boolean;
}

function parseArgs(argv: string[]): Options {
  const flag = (name: string) => argv.some((arg) => arg === `--${name}`);
  const value = (name: string) => argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
  const cap = Number(value("cap") ?? DEFAULT_CAP_USD);
  if (!Number.isFinite(cap) || cap <= 0) throw new Error("--cap must be a positive number of US dollars.");
  return {
    dryRun: flag("dry-run"),
    capUsd: cap,
    photosDir: path.resolve(value("photos") ?? "samples"),
    imageOnly: flag("image-only"),
    videoOnly: flag("video-only"),
  };
}

/** Same intake rule the app will use: shrink before any model call to save quota. */
async function prepare(file: string): Promise<Buffer> {
  return sharp(file)
    .rotate()
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
}

const slug = (modelId: string) => modelId.replaceAll("/", "__");
const extensionOf = (mediaType: string) => (mediaType.split("/")[1] ?? "png").replace("jpeg", "jpg");

async function generateStill(
  model: ImageModelConfig,
  prompt: string,
  photo: Buffer,
): Promise<{ data: Uint8Array; mediaType: string; warnings: string[] }> {
  if (model.api === "image") {
    const result = await generateImage({
      model: model.id,
      prompt: { images: [photo], text: prompt },
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    });
    return {
      data: result.image.uint8Array,
      mediaType: result.image.mediaType,
      warnings: result.warnings.map((warning) => JSON.stringify(warning)),
    };
  }

  const result = await generateText({
    model: model.id,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "file", mediaType: "image/jpeg", data: photo },
        ],
      },
    ],
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
  });
  const file = result.files.find((candidate) => candidate.mediaType.startsWith("image/"));
  if (!file) throw new Error("The model answered without returning an image.");
  return {
    data: file.uint8Array,
    mediaType: file.mediaType,
    warnings: (result.warnings ?? []).map((warning) => JSON.stringify(warning)),
  };
}

async function readBalance(): Promise<{ balance: string; totalUsed: string } | undefined> {
  try {
    return await gateway.getCredits();
  } catch {
    return undefined;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  try {
    process.loadEnvFile(path.resolve(".env.local"));
  } catch {
    // No .env.local: rely on variables already set in the shell.
  }
  if (!process.env.AI_GATEWAY_API_KEY && !options.dryRun) {
    throw new Error("AI_GATEWAY_API_KEY is not set. Fill it in .env.local first.");
  }

  const photoNames = (await readdir(options.photosDir))
    .filter((name) => PHOTO_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .sort();
  if (photoNames.length === 0) throw new Error(`No photos found in ${options.photosDir}.`);

  const catalogue: Catalogue = await fetchCatalogue();
  const imageCandidates = BAKEOFF_CANDIDATES.image;
  const videoCandidates = BAKEOFF_CANDIDATES.video;
  for (const id of [...imageCandidates.map((model) => model.id), ...videoCandidates]) {
    if (!catalogue.has(id)) console.warn(`Warning: ${id} is not in the live catalogue; its calls will probably fail.`);
  }

  // Plan and estimate before spending anything.
  const imageEstimate = new Map<string, Estimate>(
    imageCandidates.map((model) => [model.id, estimateImageCost(catalogue, model.id)]),
  );
  const videoEstimate = new Map<string, Estimate>(
    videoCandidates.map((id) => [
      id,
      estimateVideoCost(catalogue, id, VIDEO_SETTINGS.pricingTier, VIDEO_SETTINGS.durationSeconds),
    ]),
  );

  const imageJobCount = options.videoOnly ? 0 : photoNames.length * 2;
  let plannedUsd = 0;
  const planLines: string[] = [];
  if (!options.videoOnly) {
    for (const model of imageCandidates) {
      const estimate = imageEstimate.get(model.id)!;
      const total = estimate.usd * imageJobCount;
      plannedUsd += total;
      planLines.push(
        `  image  ${model.id}: ${imageJobCount} calls x ${formatUsd(estimate.usd)}${estimate.guessed ? " (price unknown, guessed)" : ""} = ${formatUsd(total)}`,
      );
    }
  }
  if (!options.imageOnly) {
    for (const id of videoCandidates) {
      const estimate = videoEstimate.get(id)!;
      plannedUsd += estimate.usd;
      planLines.push(
        `  video  ${id}: 1 clip, ${VIDEO_SETTINGS.durationSeconds}s at ${VIDEO_SETTINGS.pricingTier} = ${formatUsd(estimate.usd)}${estimate.guessed ? " (price unknown, guessed)" : ""}`,
      );
    }
  }

  console.log(`Photos (${photoNames.length}): ${photoNames.join(", ")}`);
  console.log("Plan:");
  console.log(planLines.join("\n"));
  console.log(`Estimated spend: ${formatUsd(plannedUsd)} (cap ${formatUsd(options.capUsd)})`);

  if (plannedUsd > options.capUsd) {
    throw new Error(
      `Estimated spend ${formatUsd(plannedUsd)} is above the cap ${formatUsd(options.capUsd)}. Raise --cap or reduce candidates.`,
    );
  }
  if (options.dryRun) {
    console.log("Dry run: no model was called.");
    return;
  }

  const runDir = path.resolve("storage", "bakeoff", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(path.join(runDir, "originals"), { recursive: true });
  await mkdir(path.join(runDir, "out"), { recursive: true });
  await mkdir(path.join(runDir, "video"), { recursive: true });

  const before = await readBalance();
  const results: JobResult[] = [];
  let runningUsd = 0;
  const photos = new Map<string, Buffer>();
  for (const name of photoNames) {
    const prepared = await prepare(path.join(options.photosDir, name));
    photos.set(name, prepared);
    await writeFile(path.join(runDir, "originals", `${name}.jpg`), prepared);
  }

  let videoSource: { photo: string; image: Buffer; note: string } = {
    photo: photoNames[0],
    image: photos.get(photoNames[0])!,
    note: `source: original photo ${photoNames[0]}`,
  };

  // Once the gateway refuses on account grounds (for example no card on file), every later call
  // would fail the same way, so stop instead of firing the rest.
  let accountBlocked = false;
  const skipReason = (nextUsd: number): string | undefined => {
    if (accountBlocked) return "Skipped: the gateway rejected an earlier call for account reasons.";
    if (runningUsd + nextUsd > options.capUsd) return "Spend cap reached.";
    return undefined;
  };

  if (!options.videoOnly) {
    for (const photo of photoNames) {
      for (const model of imageCandidates) {
        for (const useCase of ["studio", "frame"] as const) {
          const estimate = imageEstimate.get(model.id)!;
          const base = {
            kind: "image" as const,
            modelId: model.id,
            photo,
            useCase,
            estimatedUsd: estimate.usd,
            priceGuessed: estimate.guessed,
          };
          const skipped = skipReason(estimate.usd);
          if (skipped) {
            results.push({ ...base, status: "skipped", seconds: 0, warnings: [], errorMessage: skipped });
            continue;
          }
          const started = Date.now();
          try {
            const output = await generateStill(model, PROMPTS[useCase], photos.get(photo)!);
            const file = path.join("out", `${photo}__${slug(model.id)}__${useCase}.${extensionOf(output.mediaType)}`);
            await writeFile(path.join(runDir, file), output.data);
            runningUsd += estimate.usd;
            results.push({ ...base, status: "ok", file, seconds: (Date.now() - started) / 1000, warnings: output.warnings });
            console.log(`ok     ${model.id} ${useCase} ${photo}`);

            if (useCase === "frame" && videoSource.note.startsWith("source: original")) {
              videoSource = {
                photo,
                image: Buffer.from(output.data),
                note: `source: ${model.id} frame of ${photo}`,
              };
            }
          } catch (error) {
            const errorClass = classifyError(error);
            accountBlocked ||= errorClass === "account_blocked";
            results.push({
              ...base,
              status: "error",
              errorClass,
              errorMessage: error instanceof Error ? error.message : String(error),
              seconds: (Date.now() - started) / 1000,
              warnings: [],
            });
            console.log(`FAILED ${model.id} ${useCase} ${photo}: ${errorClass}`);
          }
        }
      }
    }
  }

  if (!options.imageOnly) {
    for (const modelId of videoCandidates) {
      const estimate = videoEstimate.get(modelId)!;
      const base = {
        kind: "video" as const,
        modelId,
        photo: videoSource.photo,
        estimatedUsd: estimate.usd,
        priceGuessed: estimate.guessed,
      };
      const skipped = skipReason(estimate.usd);
      if (skipped) {
        results.push({ ...base, status: "skipped", seconds: 0, warnings: [], errorMessage: skipped });
        continue;
      }
      const started = Date.now();
      try {
        const { video, warnings } = await generateVideo({
          model: modelId,
          prompt: { image: videoSource.image, text: PROMPTS.video },
          aspectRatio: VIDEO_SETTINGS.aspectRatio,
          resolution: VIDEO_SETTINGS.resolution,
          duration: VIDEO_SETTINGS.durationSeconds,
          maxRetries: 0,
          poll: { timeoutMs: VIDEO_TIMEOUT_MS },
          abortSignal: AbortSignal.timeout(VIDEO_TIMEOUT_MS),
        });
        const file = path.join("video", `${slug(modelId)}.mp4`);
        await writeFile(path.join(runDir, file), video.uint8Array);
        runningUsd += estimate.usd;
        results.push({
          ...base,
          status: "ok",
          file,
          seconds: (Date.now() - started) / 1000,
          warnings: (warnings ?? []).map((warning) => JSON.stringify(warning)),
        });
        console.log(`ok     ${modelId} video`);
      } catch (error) {
        const errorClass = classifyError(error);
        accountBlocked ||= errorClass === "account_blocked";
        results.push({
          ...base,
          status: "error",
          errorClass,
          errorMessage: error instanceof Error ? error.message : String(error),
          seconds: (Date.now() - started) / 1000,
          warnings: [],
        });
        console.log(`FAILED ${modelId} video: ${errorClass}`);
      }
    }
  }

  const after = await readBalance();
  await writeFile(path.join(runDir, "results.json"), JSON.stringify(results, null, 2));
  await writeFile(path.join(runDir, "index.html"), buildViewerHtml(results, photoNames, videoSource.note));

  console.log(formatSummary(results, before?.balance, after?.balance));
  console.log(`\nOutputs and viewer: ${path.join(runDir, "index.html")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
