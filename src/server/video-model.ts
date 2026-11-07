import { MODELS, VIDEO_SETTINGS } from "../config/models";
import type { AssetFile } from "./asset-store";

/**
 * Makes one whole video of `seconds` from the storyboard picture. `prompt` is the seller's own words, passed on as they
 * were typed; the model decides everything else. Throws if the model fails. Never retries.
 */
export interface VideoModel {
  generate(request: { prompt?: string; frame: AssetFile; seconds: number }): Promise<Uint8Array>;
}

const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
/** A 4 second clip took about 40 seconds to make; this only stops one stuck call from hanging a request forever. */
const VIDEO_TIMEOUT_MS = 12 * 60_000;

/** An error that carries the HTTP status, so the error handling can read it like it does for SDK errors. */
function httpError(status: number, body: string): Error & { statusCode: number } {
  return Object.assign(new Error(`HTTP ${status}: ${body.slice(0, 500)}`), { statusCode: status });
}

/**
 * Gemini Omni Flash through the Interactions REST API (the AI SDK has no video support for it yet).
 * The video comes back as base64 inside `steps`, with the audio track the model made, and is kept as it is.
 */
export function createOmniVideoModel(apiKey: string): VideoModel {
  return {
    async generate({ prompt, frame, seconds }) {
      const response = await fetch(INTERACTIONS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          model: MODELS.video,
          input: [
            { type: "image", data: Buffer.from(frame.bytes).toString("base64"), mime_type: frame.mediaType },
            ...(prompt ? [{ type: "text", text: prompt }] : []),
          ],
          response_format: {
            type: "video",
            aspect_ratio: VIDEO_SETTINGS.aspectRatio,
            resolution: VIDEO_SETTINGS.resolution,
            duration: `${seconds}s`,
          },
        }),
        signal: AbortSignal.timeout(VIDEO_TIMEOUT_MS),
      });
      if (!response.ok) throw httpError(response.status, await response.text());

      const body = (await response.json()) as { steps?: { type: string; content?: { type: string; data?: string }[] }[] };
      const video = body.steps
        ?.filter((step) => step.type === "model_output")
        .flatMap((step) => step.content ?? [])
        .find((part) => part.type === "video" && part.data);
      if (!video?.data) throw new Error("The model answered without returning a video.");
      return new Uint8Array(Buffer.from(video.data, "base64"));
    },
  };
}
