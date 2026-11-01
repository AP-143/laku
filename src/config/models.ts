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
  image: { id: "meta/muse-image-1.0", api: "image" } satisfies ImageModelConfig,
  /** Image-to-video clips (480p, 3 s, 9:16, no audio). */
  video: "spacexai/grok-imagine-video-1.5-lite",
} as const;

/** Candidates the live bake-off script compares. Edit this list to try other models. */
export const BAKEOFF_CANDIDATES = {
  image: [
    { id: "meta/muse-image-1.0", api: "image" },
    { id: "google/gemini-nano-banana-2.1", api: "language" },
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
export const BAKEOFF_NOTES = "Not run yet. Run `npm run bakeoff`, review the generated viewer, then record the decision here.";
