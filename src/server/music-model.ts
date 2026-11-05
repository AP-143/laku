import { MODELS } from "../config/models";

/** Makes one clip of instrumental music from a written brief. Throws if the model fails. Never retries. */
export interface MusicModel {
  generate(request: { prompt: string }): Promise<Uint8Array>;
}

const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
/** A clip takes under a minute to make; this only stops one stuck call from hanging a request forever. */
const MUSIC_TIMEOUT_MS = 3 * 60_000;

/** An error that carries the HTTP status, so the error handling can read it like it does for SDK errors. */
function httpError(status: number, body: string): Error & { statusCode: number } {
  return Object.assign(new Error(`HTTP ${status}: ${body.slice(0, 500)}`), { statusCode: status });
}

/**
 * Lyria 3 Clip through the Interactions REST API: it always makes a 30 second MP3, and the audio comes back as base64
 * inside `steps`, like the video. Every clip carries a SynthID watermark that cannot be heard.
 */
export function createLyriaMusicModel(apiKey: string): MusicModel {
  return {
    async generate({ prompt }) {
      const response = await fetch(INTERACTIONS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Api-Revision": "2026-05-20", "x-goog-api-key": apiKey },
        body: JSON.stringify({ model: MODELS.music, input: prompt }),
        signal: AbortSignal.timeout(MUSIC_TIMEOUT_MS),
      });
      if (!response.ok) throw httpError(response.status, await response.text());

      const body = (await response.json()) as { steps?: { type: string; content?: { type: string; data?: string }[] }[] };
      const audio = body.steps
        ?.filter((step) => step.type === "model_output")
        .flatMap((step) => step.content ?? [])
        .find((part) => part.type === "audio" && part.data);
      if (!audio?.data) throw new Error("The model answered without returning music.");
      return new Uint8Array(Buffer.from(audio.data, "base64"));
    },
  };
}
