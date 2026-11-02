/**
 * The single place where model IDs live. Logic must read from here and never hard-code a model.
 *
 * `image.api` tells the gateway client which AI SDK call a model needs:
 * - "image": a dedicated image model, called with generateImage (supports a reference photo)
 * - "language": a language model that can output images, called with generateText and read from `files`
 */

export type ImageApi = "image" | "language";

export interface ImageModelConfig {
  id: string;
  api: ImageApi;
}

/** Models in use by the app. Updated from the bake-off evidence below. */
export const MODELS = {
  /**
   * Chat LLM with vision, called directly with the free Google AI Studio key (so this is a Google model
   * ID, not a gateway "provider/model" ID). Verified live on 2026-11-01: replies in Indonesian and reads
   * images. gemini-3.6-flash also worked; gemini-2.5-flash-lite is closed to new users.
   */
  chat: "gemini-3.5-flash-lite",
  /** Studio photos and storyboard frames. */
  image: { id: "bfl/flux-kontext-pro", api: "image" } satisfies ImageModelConfig,
  /**
   * Image-to-video clips, called directly on the Google key (Interactions API). Not wired into the app
   * yet: Veo 3.1 was shut down in the Gemini API on 2026-10-22 and Gemini Omni Flash replaces it.
   * Clip length and per-second price are still unmeasured (see the bake-off).
   */
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
 * Bake-off evidence: what was compared, and why the models above were chosen.
 * Filled in by the developer after reviewing a live run of the bake-off script.
 */
export const BAKEOFF_NOTES = `
Run of 2026-11-01 on 5 real product photos (skincare set, gamepad, sticker tumbler, juice bottle, tea cup),
studio photo plus 9:16 lifestyle frame, judged by eye against the originals.

Account: the gateway needs a card on file before the US$5 monthly free credit unlocks. The free tier does
NOT include meta/muse-image-1.0, google/gemini-nano-banana-2.1, bfl/flux-3-image(-klein) or
spacexai/grok-imagine-image-2.0 ("Free tier users do not have access to this model").

Image, chosen: bfl/flux-kontext-pro (about US$0.04 per image).
- Kept the product faithful on 4 of 5 photos (shape, colour, label text; accessories such as the phone
  clamp on the gamepad and the tumbler cap were preserved).
- Weakness: on a multi-item set (the skincare photo) it kept only one of four products. Treat sets as a
  known limitation; try a "keep every item" prompt or another model for them.
Rejected on the same photos:
- spacexai/grok-imagine-image (about US$0.022): altered products (dropped the gamepad clamp, reshaped the
  tumbler, filled the empty cup), about 2 of 5 faithful.
- bytedance/seedream-5.0-lite: rotated the product, left a hand fragment in the cup, and its moderation
  blocked 2 calls ("output image may contain sensitive information").
- bytedance/seedream-4.0 / 4.5: rewrote the bottle label text to "COOKIES". bfl/flux-2-klein-4b/9b and
  flux-2-pro garbled the label text; openai/gpt-image-1-mini redrew the logo and colour.

Video: not usable on the free credit. Every video model is refused with "Video generation requires a minimum
balance of $10". Feature 3 (video) is deferred until paid credit is available; the model above is only the
first candidate, untested.
`.trim();

/** Estimated spend, used by the usage meter. Prices change, so re-check them against the gateway catalogue. */
export const COSTS = {
  /** One image from `MODELS.image` (about US$0.04, see the bake-off notes). */
  imageUsd: 0.04,
  /** The prepaid Google balance (about Rp70,000). The app never plans to spend past it. */
  monthlyBudgetUsd: 4,
  /** Stops a bug or a loop from burning the whole balance in one day; normal use stays well under it. */
  dailyBudgetUsd: 2,
} as const;
