/**
 * The title of each panel of a storyboard, in order. The titles are fixed, so the six scenes always tell the same
 * small story: a hook, the product, its detail, enjoying it, why it is good, and the call to buy.
 */
export const PANEL_TITLES: readonly string[] = [
  "Opening",
  "Perkenalan Produk",
  "Detail Produk",
  "Menikmati",
  "Keunggulan",
  "Closing",
];

/**
 * The kind of shot of each panel, in the same order as the titles. A professional ad storyboard changes the shot from
 * panel to panel (a person, the product up close, a hero shot), so the planner and the picture are both told it.
 * Written in English: it is read by the models, not by the seller.
 */
export const PANEL_SHOTS: readonly string[] = [
  "medium shot of a person who shows the need or the problem with an expressive face, with a small hand-drawn thought bubble that holds the product",
  "medium shot of the person presenting the product with a pointing or showing gesture, with props around it that fit the product",
  "extreme close-up macro of the product alone with no person, showing its best detail and texture, with one small effect that suits the product",
  "close-up of the person using or enjoying the product with a delighted face",
  "medium shot of the happy person giving a thumbs-up with the product in hand, next to a short checklist of its benefits",
  "hero shot of the product alone, styled on a surface with fitting props, with its brand or flag visible, ending on the call to buy",
];

/** A storyboard is always exactly this many scenes. The server, the prompts and the UI all read it from here. */
export const SCENE_COUNT = PANEL_TITLES.length;
/** Scene indexes in order: 0 to SCENE_COUNT - 1. */
export const SCENE_INDEXES: readonly number[] = Array.from({ length: SCENE_COUNT }, (_, index) => index);

/** The most characters of the art direction a request may carry. */
export const MAX_ART_DIRECTION_CHARS = 1200;
/** The longest brief: the seller's first request as they wrote it, kept for planning the video. */
export const MAX_BRIEF_CHARS = 400;
