/**
 * Live model bake-off (manual smoke test, "Seam B").
 *
 * Runs the candidate Gemini image models, one Gemini Omni video clip and one TTS voice sample on real
 * product photos, directly on the Google key, and saves every output for judging by eye.
 *
 *   npm run bakeoff -- --dry-run              print the plan and estimated spend, call no model
 *   npm run bakeoff                           run it for real
 *   npm run bakeoff -- --cap=1.2              refuse to run if the estimate is above US$1.2 (default)
 *   npm run bakeoff -- --only=image,video,speech   which parts to run (default: image,video)
 *   npm run bakeoff -- --use-case=studio,frame,sheet   which image jobs to run (default: studio,frame)
 *   npm run bakeoff -- --models=nano-banana,flash-image@512   only image candidates whose id or id@size contains one of these
 *   npm run bakeoff -- --video-seconds=4      clip length asked for (0 = do not ask, let the model decide)
 *   npm run bakeoff -- --video-source=path    make the clip from this image (an earlier frame) instead of a fresh one
 *   npm run bakeoff -- --photos=some/folder
 *
 * It never retries a paid call, and it refuses to start when the estimated spend is above the cap.
 * What a real run spends is added to the app's usage meter. Google has no balance API: the real spend is on the
 * AI Studio Spend page (the month-to-date counter there is a few minutes behind, the charts hours).
 */
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { experimental_generateSpeech as generateSpeech, generateImage } from "ai";
import sharp from "sharp";
import { BAKEOFF_CANDIDATES, VIDEO_SETTINGS, type BakeoffImageCandidate } from "../../src/config/models";
import { createDefaultUsageLedger } from "../../src/server/usage-ledger";
import { formatUsd, type Estimate } from "./pricing";
import { buildViewerHtml, classifyError, formatSummary, type JobResult } from "./report";

const run = promisify(execFile);

const PHOTO_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const IMAGE_TIMEOUT_MS = 3 * 60_000;
const VIDEO_TIMEOUT_MS = 12 * 60_000;
const SPEECH_TIMEOUT_MS = 2 * 60_000;
const DEFAULT_CAP_USD = 1.2;
const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

type UseCase = "studio" | "frame" | "sheet";
type Part = "image" | "video" | "speech";

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
  sheet:
    "Create one image that is a 2x2 grid of four separate scenes of an advertisement storyboard, with thin " +
    "white borders between the panels: (1) this exact product on a rustic wooden table in warm morning light, " +
    "(2) a close-up of the product's label in soft light, (3) the product held in a hand in a bright kitchen, " +
    "(4) the product on a clean shelf with a soft blurred background. " +
    "In every panel keep the product exactly the same: shape, colour, logo, label text and proportions. " +
    "Do not add, remove or redraw any part of the product.",
  video:
    "Gentle cinematic camera push-in on the product with soft light shifts. The product stays exactly the " +
    "same and does not change shape, logo or text. No people, no new objects.",
} as const;

const SPEECH_TEXT =
  "Capek cari hadiah yang pas? Coba produk ini. Kemasannya rapi, kualitasnya terjamin, dan harganya ramah di " +
  "kantong. Pesan sekarang sebelum kehabisan.";

interface Options {
  dryRun: boolean;
  capUsd: number;
  photosDir: string;
  parts: Set<Part>;
  useCases: UseCase[];
  models: string[];
  videoSeconds: number;
  videoSourcePath?: string;
}

function parseArgs(argv: string[]): Options {
  const flag = (name: string) => argv.some((arg) => arg === `--${name}`);
  const value = (name: string) => argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
  const list = (name: string, fallback: string) => (value(name) ?? fallback).split(",").map((item) => item.trim()).filter(Boolean);

  const cap = Number(value("cap") ?? DEFAULT_CAP_USD);
  if (!Number.isFinite(cap) || cap <= 0) throw new Error("--cap must be a positive number of US dollars.");

  const parts = list("only", "image,video");
  for (const part of parts) if (!["image", "video", "speech"].includes(part)) throw new Error(`Unknown --only part "${part}".`);
  const useCases = list("use-case", "studio,frame");
  for (const useCase of useCases) if (!["studio", "frame", "sheet"].includes(useCase)) throw new Error(`Unknown --use-case "${useCase}".`);

  const seconds = Number(value("video-seconds") ?? VIDEO_SETTINGS.durationSeconds);
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("--video-seconds must be 0 or a positive number.");

  return {
    dryRun: flag("dry-run"),
    capUsd: cap,
    photosDir: path.resolve(value("photos") ?? "samples"),
    parts: new Set(parts as Part[]),
    useCases: useCases as UseCase[],
    models: value("models") ? list("models", "") : [],
    videoSeconds: seconds,
    videoSourcePath: value("video-source") ? path.resolve(value("video-source")!) : undefined,
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

const labelOf = (candidate: BakeoffImageCandidate) => `${candidate.id}@${candidate.size}`;
const slug = (label: string) => label.replaceAll("/", "__");
const extensionOf = (mediaType: string) => (mediaType.split("/")[1] ?? "png").replace("jpeg", "jpg");

/** An error that carries the HTTP status, so classifyError can read it like it does for SDK errors. */
function httpError(status: number, body: string): Error & { statusCode: number } {
  return Object.assign(new Error(`HTTP ${status}: ${body.slice(0, 500)}`), { statusCode: status });
}

async function generateStill(
  google: ReturnType<typeof createGoogleGenerativeAI>,
  candidate: BakeoffImageCandidate,
  useCase: UseCase,
  photo: Buffer,
): Promise<{ data: Uint8Array; mediaType: string; warnings: string[] }> {
  const result = await generateImage({
    model: google.image(candidate.id),
    prompt: { images: [photo], text: PROMPTS[useCase] },
    aspectRatio: useCase === "frame" ? "9:16" : "1:1",
    providerOptions: { google: { imageConfig: { imageSize: candidate.size } } },
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
  });
  return {
    data: result.image.uint8Array,
    mediaType: result.image.mediaType,
    warnings: result.warnings.map((warning) => JSON.stringify(warning)),
  };
}

/**
 * One image-to-video clip from Gemini Omni Flash through the Interactions API (REST: the SDK has no
 * video support for it yet). The length is not documented as a request field, so a 400 on `duration`
 * is retried once without it; a rejected request is not billed.
 */
async function generateClip(
  apiKey: string,
  image: { bytes: Buffer; mediaType: string },
  seconds: number,
): Promise<{ data: Buffer; warnings: string[] }> {
  const warnings: string[] = [];
  const send = async (withDuration: boolean) => {
    const response = await fetch(INTERACTIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        model: BAKEOFF_CANDIDATES.video.id,
        input: [
          { type: "image", data: image.bytes.toString("base64"), mime_type: image.mediaType },
          { type: "text", text: PROMPTS.video },
        ],
        response_format: {
          type: "video",
          aspect_ratio: VIDEO_SETTINGS.aspectRatio,
          resolution: VIDEO_SETTINGS.resolution,
          ...(withDuration ? { duration: `${seconds}s` } : {}),
        },
      }),
      signal: AbortSignal.timeout(VIDEO_TIMEOUT_MS),
    });
    if (!response.ok) throw httpError(response.status, await response.text());
    return (await response.json()) as { steps?: { type: string; content?: { type: string; data?: string }[] }[] };
  };

  let body;
  try {
    body = await send(seconds > 0);
  } catch (error) {
    if (seconds > 0 && (error as { statusCode?: number }).statusCode === 400) {
      warnings.push(`HTTP 400 when asking for "${seconds}s" (${(error as Error).message.slice(0, 160)}); retried once without a duration.`);
      body = await send(false);
    } else {
      throw error;
    }
  }

  const video = body.steps
    ?.filter((step) => step.type === "model_output")
    .flatMap((step) => step.content ?? [])
    .find((part) => part.type === "video" && part.data);
  if (!video?.data) throw new Error("The model answered without returning a video.");
  return { data: Buffer.from(video.data, "base64"), warnings };
}

/** Real length and whether an audio track exists, read from the saved file. */
async function probeClip(file: string): Promise<{ seconds: number; hasAudio: boolean }> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", file]);
  const info = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type: string }[] };
  return {
    seconds: Number(info.format?.duration ?? 0),
    hasAudio: (info.streams ?? []).some((stream) => stream.codec_type === "audio"),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  try {
    process.loadEnvFile(path.resolve(".env.local"));
  } catch {
    // No .env.local: rely on variables already set in the shell.
  }
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "";
  if (!apiKey && !options.dryRun) {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set. Fill it in .env.local first.");
  }
  const google = createGoogleGenerativeAI({ apiKey });

  const photoNames = (await readdir(options.photosDir))
    .filter((name) => PHOTO_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .sort();
  if (photoNames.length === 0) throw new Error(`No photos found in ${options.photosDir}.`);

  const imageCandidates = BAKEOFF_CANDIDATES.image.filter(
    (candidate) => options.models.length === 0 || options.models.some((filter) => labelOf(candidate).includes(filter)),
  );
  if (options.parts.has("image") && imageCandidates.length === 0) throw new Error("--models matched no image candidate.");

  // Plan and estimate before spending anything.
  // Omni's per-second price is derived from a token-rate footnote, and the clip length is only asked for.
  const videoEstimate: Estimate = { usd: BAKEOFF_CANDIDATES.video.usdPerSecond * (options.videoSeconds || VIDEO_SETTINGS.durationSeconds), guessed: true };
  /** The Indonesian sample line is read aloud in roughly this long. */
  const speechSeconds = 12;
  const speechEstimate: Estimate = { usd: BAKEOFF_CANDIDATES.speech.usdPerAudioSecond * speechSeconds, guessed: true };

  let plannedUsd = 0;
  const planLines: string[] = [];
  if (options.parts.has("image")) {
    const imageJobCount = photoNames.length * options.useCases.length;
    for (const candidate of imageCandidates) {
      const total = candidate.usd * imageJobCount;
      plannedUsd += total;
      planLines.push(`  image  ${labelOf(candidate)}: ${imageJobCount} calls x ${formatUsd(candidate.usd)} = ${formatUsd(total)}`);
    }
  }
  if (options.parts.has("video")) {
    plannedUsd += videoEstimate.usd;
    planLines.push(
      `  video  ${BAKEOFF_CANDIDATES.video.id}: 1 clip, ${options.videoSeconds ? `${options.videoSeconds}s` : `model-chosen length (estimated at ${VIDEO_SETTINGS.durationSeconds}s)`} at ${VIDEO_SETTINGS.resolution} = ${formatUsd(videoEstimate.usd)} (price derived, guessed)`,
    );
  }
  if (options.parts.has("speech")) {
    plannedUsd += speechEstimate.usd;
    planLines.push(`  speech ${BAKEOFF_CANDIDATES.speech.id}: 1 sample, about ${speechSeconds}s = ${formatUsd(speechEstimate.usd)} (guessed)`);
  }

  console.log(`Photos (${photoNames.length}): ${photoNames.join(", ")}`);
  console.log("Plan:");
  console.log(planLines.join("\n"));
  console.log(`Estimated spend: ${formatUsd(plannedUsd)} (cap ${formatUsd(options.capUsd)})`);

  if (plannedUsd > options.capUsd) {
    throw new Error(
      `Estimated spend ${formatUsd(plannedUsd)} is above the cap ${formatUsd(options.capUsd)}. ` +
        "Raise --cap, or narrow the run with --use-case, --models or --only.",
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
  await mkdir(path.join(runDir, "speech"), { recursive: true });

  const results: JobResult[] = [];
  let runningUsd = 0;
  const photos = new Map<string, Buffer>();
  for (const name of photoNames) {
    const prepared = await prepare(path.join(options.photosDir, name));
    photos.set(name, prepared);
    await writeFile(path.join(runDir, "originals", `${name}.jpg`), prepared);
  }

  let videoSource: { photo: string; image: Buffer; mediaType: string; note: string } = {
    photo: photoNames[0],
    image: photos.get(photoNames[0])!,
    mediaType: "image/jpeg",
    note: `source: original photo ${photoNames[0]}`,
  };

  if (options.videoSourcePath) {
    const mediaType = { ".png": "image/png", ".webp": "image/webp" }[path.extname(options.videoSourcePath).toLowerCase()] ?? "image/jpeg";
    videoSource = {
      photo: path.basename(options.videoSourcePath),
      image: await readFile(options.videoSourcePath),
      mediaType,
      note: `source: ${path.basename(options.videoSourcePath)}`,
    };
  }

  // Once Google refuses on billing or quota grounds (for example no billing on the key's project),
  // every later call would fail the same way, so stop instead of firing the rest.
  let stopRun = false;
  const skipReason = (nextUsd: number): string | undefined => {
    if (stopRun) return "Skipped: Google refused an earlier call on billing or quota grounds.";
    if (runningUsd + nextUsd > options.capUsd) return "Spend cap reached.";
    return undefined;
  };

  type JobBase = Pick<JobResult, "kind" | "modelId" | "photo" | "useCase" | "estimatedUsd" | "priceGuessed">;
  const recordSkip = (base: JobBase, reason: string) =>
    results.push({ ...base, status: "skipped", seconds: 0, warnings: [], errorMessage: reason });
  const recordFailure = (base: JobBase, error: unknown, started: number) => {
    const errorClass = classifyError(error);
    stopRun ||= errorClass === "account_blocked" || errorClass === "no_credits_or_quota";
    results.push({
      ...base,
      status: "error",
      errorClass,
      errorMessage: error instanceof Error ? error.message : String(error),
      seconds: (Date.now() - started) / 1000,
      warnings: [],
    });
    console.log(`FAILED ${base.modelId} ${base.useCase ?? base.kind} ${base.photo}: ${errorClass}`);
  };

  if (options.parts.has("image")) {
    for (const photo of photoNames) {
      for (const candidate of imageCandidates) {
        for (const useCase of options.useCases) {
          const label = labelOf(candidate);
          const base = {
            kind: "image" as const,
            modelId: label,
            photo,
            useCase,
            estimatedUsd: candidate.usd,
            priceGuessed: false,
          };
          const skipped = skipReason(candidate.usd);
          if (skipped) {
            recordSkip(base, skipped);
            continue;
          }
          const started = Date.now();
          try {
            const output = await generateStill(google, candidate, useCase, photos.get(photo)!);
            const file = path.join("out", `${photo}__${slug(label)}__${useCase}.${extensionOf(output.mediaType)}`);
            await writeFile(path.join(runDir, file), output.data);
            runningUsd += candidate.usd;
            results.push({ ...base, status: "ok", file, seconds: (Date.now() - started) / 1000, warnings: output.warnings });
            console.log(`ok     ${label} ${useCase} ${photo}`);

            if (useCase === "frame" && videoSource.note.startsWith("source: original")) {
              videoSource = {
                photo,
                image: Buffer.from(output.data),
                mediaType: output.mediaType,
                note: `source: ${label} frame of ${photo}`,
              };
            }
          } catch (error) {
            recordFailure(base, error, started);
          }
        }
      }
    }
  }

  if (options.parts.has("video")) {
    const modelId = BAKEOFF_CANDIDATES.video.id;
    const base = { kind: "video" as const, modelId, photo: videoSource.photo, estimatedUsd: videoEstimate.usd, priceGuessed: true };
    const skipped = skipReason(videoEstimate.usd);
    if (skipped) {
      recordSkip(base, skipped);
    } else {
      const started = Date.now();
      try {
        const clip = await generateClip(apiKey, { bytes: videoSource.image, mediaType: videoSource.mediaType }, options.videoSeconds);
        const file = path.join("video", `${slug(modelId)}.mp4`);
        await writeFile(path.join(runDir, file), clip.data);

        // What the model really returned is what the cost estimate and the clip-splitting rules must follow.
        // The clip was billed either way, so a failed probe falls back to the estimate instead of booking US$0.
        let probe: { seconds: number; hasAudio: boolean } | undefined;
        try {
          probe = await probeClip(path.join(runDir, file));
          if (!(probe.seconds > 0)) probe = undefined;
        } catch {
          probe = undefined;
        }
        const usd = probe ? probe.seconds * BAKEOFF_CANDIDATES.video.usdPerSecond : videoEstimate.usd;
        runningUsd += usd;
        results.push({
          ...base,
          estimatedUsd: usd,
          status: "ok",
          file,
          seconds: (Date.now() - started) / 1000,
          clipSeconds: probe?.seconds,
          hasAudio: probe?.hasAudio,
          warnings: probe
            ? [...clip.warnings, `clip length ${probe.seconds.toFixed(1)}s`, `audio track: ${probe.hasAudio ? "yes" : "no"}`]
            : [...clip.warnings, "ffprobe could not read the clip: length and audio unknown, cost taken from the estimate"],
        });
        console.log(`ok     ${modelId} video (${probe ? `${probe.seconds.toFixed(1)}s, audio ${probe.hasAudio ? "yes" : "no"}` : "length unknown"})`);
      } catch (error) {
        recordFailure(base, error, started);
      }
    }
  }

  if (options.parts.has("speech")) {
    const modelId = BAKEOFF_CANDIDATES.speech.id;
    // A speech job has no source photo; "-" fills the column.
    const base = { kind: "speech" as const, modelId, photo: "-", estimatedUsd: speechEstimate.usd, priceGuessed: true };
    const skipped = skipReason(speechEstimate.usd);
    if (skipped) {
      recordSkip(base, skipped);
    } else {
      const started = Date.now();
      try {
        const { audio } = await generateSpeech({
          model: google.speech(modelId),
          text: SPEECH_TEXT,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(SPEECH_TIMEOUT_MS),
        });
        const file = path.join("speech", `${slug(modelId)}.${audio.format ?? extensionOf(audio.mediaType)}`);
        await writeFile(path.join(runDir, file), audio.uint8Array);
        runningUsd += speechEstimate.usd;
        results.push({ ...base, status: "ok", file, seconds: (Date.now() - started) / 1000, warnings: [] });
        console.log(`ok     ${modelId} speech`);
      } catch (error) {
        recordFailure(base, error, started);
      }
    }
  }

  // The usage meter of the app must see what a run spent, or it reads lower than the real bill.
  if (runningUsd > 0) await createDefaultUsageLedger().record(runningUsd);
  await writeFile(path.join(runDir, "results.json"), JSON.stringify(results, null, 2));
  await writeFile(path.join(runDir, "index.html"), buildViewerHtml(results, photoNames, videoSource.note));

  console.log(formatSummary(results));
  console.log(`\nOutputs and viewer: ${path.join(runDir, "index.html")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
