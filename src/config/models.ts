/**
 * The single place where model IDs live. Logic must read from here and never hard-code a model.
 */

/** Models in use by the app. */
export const MODELS = {
  /** Chat LLM with vision. Verified live on 2026-11-01: replies in Indonesian and reads images. */
  chat: "gemini-3.5-flash-lite",
  /** Studio photos and storyboard frames. Chosen by the 2026-11-02 bake-off: faithful on 5 of 5 photos. */
  image: "gemini-nano-banana-2.1",
  /** The output size every image call asks for, so the price quoted from `COSTS.imageUsd` is the price paid. */
  imageSize: "1K",
  /** Image-to-video through the Interactions API (src/server/video-model.ts): 720x1280 with audio, about US$0.10 per second. */
  video: "gemini-omni-1.1-flash",
} as const;

/**
 * One image model at one output size, as the bake-off compares it. `usd` is the price of one image at
 * that size from Google's pricing page (read 2026-11-02); prices change, so re-check before relying on them.
 */
export interface BakeoffImageCandidate {
  id: string;
  /** "512" is 0.5K, which only gemini-3.1-flash-image supports. */
  size: "512" | "1K";
  usd: number;
}

/** Candidates the live bake-off script compares, all called directly on the Google key. Edit to try others. */
export const BAKEOFF_CANDIDATES = {
  image: [
    { id: "gemini-nano-banana-2.1", size: "1K", usd: 0.0336 },
    { id: "gemini-3.1-flash-lite-image", size: "1K", usd: 0.0336 },
    { id: "gemini-3.1-flash-image", size: "512", usd: 0.045 },
    { id: "gemini-3.1-flash-image", size: "1K", usd: 0.067 },
  ] satisfies BakeoffImageCandidate[],
  /** About US$0.10 per second: derived by Google's pricing page from 5,792 tokens per second of 720p video. Not measured yet. */
  video: { id: "gemini-omni-1.1-flash", usdPerSecond: 0.1 },
  /** US$6 per 1M audio tokens until 2026-12-31 (US$12 after), at 25 audio tokens per second. */
  speech: { id: "gemini-3.8-flash-lite-tts", usdPerAudioSecond: (6 / 1_000_000) * 25 },
};

/** Video output settings shared by the bake-off and the real video feature. */
export const VIDEO_SETTINGS = {
  aspectRatio: "9:16",
  resolution: "720p",
  /** Asked for in the request; the bake-off measures what the model really returns. */
  durationSeconds: 4,
} as const;

/**
 * The price quoted to the seller in the Price question. Prices change, so re-check them against Google's pricing page.
 * The app sets no spend limit: the seller's yes to the Price question, the balance and any spend cap on Google's side are the only stops.
 */
export const COSTS = {
  /** One image from `MODELS.image` at 1K (US$0.0336 on Google's pricing page). */
  imageUsd: 0.0336,
  /** One second of video from `MODELS.video` at 720p (about US$0.10). */
  videoUsdPerSecond: 0.1,
  /**
   * Only to show rupiah next to dollars in a question to the seller; a rough rate, not a quote. About what Google
   * billed at on 2026-11-03.
   */
  idrPerUsd: 18_200,
} as const;
