/**
 * The single place where model IDs live. Logic must read from here and never hard-code a model.
 */

/** Models in use by the app. Updated from the bake-off evidence below. */
export const MODELS = {
  /**
   * Chat LLM with vision, called directly with the Google AI Studio key (so this is a Google model
   * ID, not a gateway "provider/model" ID). Verified live on 2026-11-01: replies in Indonesian and reads
   * images. gemini-3.6-flash also worked; gemini-2.5-flash-lite is closed to new users.
   */
  chat: "gemini-3.5-flash-lite",
  /**
   * Studio photos and storyboard frames, called directly on the Google key at 1K. Chosen by the 2026-11-02
   * bake-off: faithful on 5 of 5 photos, against 4 of 5 for the earlier gateway model (bfl/flux-kontext-pro).
   */
  image: "gemini-nano-banana-2.1",
  /** The output size every image call asks for, so the price booked in `COSTS.imageUsd` is the price paid. */
  imageSize: "1K",
  /**
   * Image-to-video clips, called directly on the Google key (Interactions API) by src/server/video-model.ts.
   * Veo 3.1 was shut down in the Gemini API on 2026-10-22 and Gemini Omni Flash replaces it.
   * Measured 2026-11-02 (see BAKEOFF_NOTES): a 4 s clip came back at 720x1280 with an audio track, about US$0.10 per second.
   */
  video: "gemini-omni-1.1-flash",
  /** Reads the voice-over aloud, called directly on the Google key (measured 2026-11-02: 12 s of Indonesian in 4 s). */
  speech: "gemini-3.8-flash-lite-tts",
  /** The one prebuilt voice used for every narration, so a video sounds the same from start to end. */
  voice: "Kore",
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

/** The two narration voices a seller can ask for ("suara cewek" or "suara cowok"): Gemini prebuilt voices. */
export const VOICES = { female: "Kore", male: "Charon" } as const;

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
History: the first run, through the Vercel AI Gateway (no longer used by the app; the newer run is below).

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

Run of 2026-11-02, directly on the Google key (prepaid balance, no gateway). Prices are from Google's pricing
page read on 2026-11-02 and are estimates until compared with the drop in the AI Studio balance.

Image (5 photos, studio photo, 4 candidates):
- gemini-nano-banana-2.1 at 1K (US$0.0336): chosen. Faithful on 5 of 5 photos, including the skincare set with all
  four products (the previous model kept one of four). Big text, logos and stickers stay right; small print on
  packaging is reinvented (for example "Advanced Beanmening"), so do not promise legible fine print.
- gemini-3.1-flash-image at 0.5K (US$0.045) and 1K (US$0.067): about as faithful, but more expensive.
- gemini-3.1-flash-lite-image at 1K (US$0.0336): weakest. Showed the studio backdrop in one photo, changed the
  stickers on the tumbler and kept the hand in the tea photo.
- Storyboard frames (9:16, one per scene, the old design) with the chosen model: faithful on 5 of 5, product kept in a lifestyle scene.
- Contact sheet (4 panels in one 1:1 image, same price as one frame): usable as a cheap preview, but each panel is
  only about 512 px, is not 9:16, and the skincare set dropped to a single tube. At the time this was judged not good
  as a video source and the app made one frame per scene. On 2026-11-05 the seller asked for the storyboard as one
  picture (see docs/adr/0004), so the app now makes one 9:16 sheet of six panels and every clip starts from it; the
  weaknesses above are the things to look at first in a real run.
- gemini-2.5-flash-image (the original Nano Banana) is deprecated and shuts down on 2027-03-15.

Video: Veo 3.1 was shut down in the Gemini API on 2026-10-22. Gemini Omni Flash (gemini-omni-1.1-flash) replaces it.
- Called over the Interactions REST API (the AI SDK has no video support for it yet); the video comes back as base64
  inside steps, model_output, content.
- Asking for a duration of "4s" in response_format was accepted and gave a 4.0 s clip, 720x1280 (9:16), 24 fps,
  H.264. It took about 40 s to make. The longest and shortest allowed lengths are still unknown.
- The clip has an AAC audio track by default, and no request field to turn it off was found, so the app must drop
  it (ffmpeg) when it adds a voice-over. Price with and without audio is not separated on the pricing page.
- Price: about US$0.10 per second (derived by Google from 5,792 tokens per second of 720p); a 4 s clip is about
  US$0.40. Quality by eye: smooth camera push-in, product label intact, nothing added.

Speech: gemini-3.8-flash-lite-tts made 11.9 s of Indonesian narration (24 kHz mono WAV) in about 4 s, estimated at
US$0.002 (US$6 per 1M audio tokens until 2026-12-31, US$12 after; 25 tokens per second).

Acceptance run of 2026-11-03 (ticket #14), through the app's own handlers on the real models, US$1.3084 by the meter:
- Studio photos: the same product on 5 of 5 photos. Storyboard frames (9:16): consistent product; one frame drew a
  caption of its own ("SCENE 3 - CLOSE ON ..."), so the frame prompt now forbids labels the scene did not ask for.
- Video: a 10 s request became a 6 s and a 4 s clip, so the real model accepts a 6 s clip. Result: one 720x1280 MP4 of
  exactly 10.000 s. Clips of 8 s are still untried.
- Voice revision (new voice, same script and clips): no video-model call, about US$0.003.
- Measured against Google (AI Studio Spend page, 2026-11-03): month-to-date spend IDR 58,408, about US$3.21 at the
  rate Google bills at (about 18,180 IDR per US dollar, from the account's IDR 4,545,874.87 Tier 1 cap = US$250).
  The estimates added up to about US$2.95 (bake-off US$1.64, acceptance run US$1.31), so the meter ran about 9% low;
  the rest is most likely the thinking and input tokens of image and text calls, which the per-image prices leave out.
- The video price holds: Omni was reported at IDR 7,460 for the 4.03 s bake-off clip (US$0.41, against US$0.40
  estimated), so COSTS.videoUsdPerSecond stays at 0.10. The per-model charts lag by hours, so only that clip had
  been reported when this was read.
- The bake-off script did not write to the app's usage meter, so the meter missed about US$1.90 of real spend; it now
  records what a real run spends, and that amount was added to the ledger by hand.
`.trim();

/** Estimated spend, used by the usage meter. Prices change, so re-check them against Google's pricing page. */
export const COSTS = {
  /** One image from `MODELS.image` at 1K (US$0.0336 on Google's pricing page, see the bake-off notes). */
  imageUsd: 0.0336,
  /** One second of video from `MODELS.video` at 720p (about US$0.10, see the bake-off notes). */
  videoUsdPerSecond: 0.1,
  /**
   * One second of narration: US$12 per 1M audio tokens (the price from 2027-01-01; US$6 until then) at 25 tokens
   * per second, so the estimate is already the higher one.
   */
  speechUsdPerSecond: 0.0003,
  /** A video estimated above this is only made after the seller says yes; cheaper ones start at once. */
  videoConfirmAboveUsd: 1,
  /**
   * Only to show rupiah next to dollars in a question to the seller; a rough rate, not a quote. About what Google
   * bills at (2026-11-03): the account's tier cap of IDR 4,545,874.87 is the US$250 Tier 1 cap.
   */
  idrPerUsd: 18_200,
  /**
   * Stops a bug or a loop from burning the whole balance in one day. It is the app's only spend limit: there is no
   * monthly one, since the prepaid Google balance (auto-reload off) is the real stop. It must fit one whole storyboard
   * (one picture, US$0.0336) and the longest video the panel offers (30 seconds with a narration, US$3.009): about US$3.14.
   */
  dailyBudgetUsd: 3.5,
} as const;
