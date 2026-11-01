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
  /** Chat LLM with vision. Wired to the free Google AI Studio key in the chat API ticket. */
  chat: "google/gemini-3.6-flash",
  /** Studio photos and storyboard frames. */
  image: { id: "bfl/flux-kontext-pro", api: "image" } satisfies ImageModelConfig,
  /**
   * Image-to-video clips (480p, 3 s, 9:16, no audio). NOT usable on the free credit: the gateway
   * requires a paid balance of at least US$10 for any video model. Feature 3 is deferred (see notes).
   */
  video: "spacexai/grok-imagine-video-1.5-lite",
} as const;

/** Candidates the live bake-off script compares. Edit this list to try other models. */
export const BAKEOFF_CANDIDATES = {
  // Free-tier models that kept the product label text intact in the first single-photo probe.
  // meta/muse-image-1.0 and google/gemini-nano-banana-2.1 were the original picks but are not on the free tier.
  image: [
    { id: "spacexai/grok-imagine-image", api: "image" },
    { id: "bfl/flux-kontext-pro", api: "image" },
    { id: "bytedance/seedream-5.0-lite", api: "image" },
  ] satisfies ImageModelConfig[],
  video: [
    "spacexai/grok-imagine-video-1.5-lite",
    "google/veo-3.1-lite-generate-001",
    "bytedance/seedance-2.0-mini",
  ],
};

/** Video output settings shared by the bake-off and the real video feature. */
export const VIDEO_SETTINGS = {
  aspectRatio: "9:16",
  resolution: "480x854",
  /** Used to look up per-second pricing in the gateway catalogue. */
  pricingTier: "480p",
  durationSeconds: 3,
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
