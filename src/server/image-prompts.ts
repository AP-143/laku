import type { StudioStyle, StylePreset } from "../shared/chat-events";
import { PANEL_SHOTS, PANEL_TITLES } from "../shared/storyboard";

/** Internal instructions for the image model. Written in English. */

/** The look used when no art direction was given, for example a typed request that never saw the planner. */
const DEFAULT_ART_DIRECTION = "a clean, bright, professional commercial look with natural light that suits the product.";

/** The product must come out recognisable, so every image prompt carries this rule. */
const KEEP_PRODUCT =
  "Keep the product exactly the same: shape, colour, logo, label text and proportions. " +
  "Do not add, remove, redraw or alter any part of the product.";

const PRESET_STYLES: Record<StylePreset, string> = {
  clean_white:
    "the product centred on a clean white seamless background, soft even studio lighting, a subtle natural shadow, sharp focus",
  solid_color:
    "the product centred on a smooth solid colour backdrop that complements the product, soft studio lighting, a subtle natural shadow, sharp focus",
  lifestyle:
    "the product styled in a natural lifestyle scene with fitting props, warm natural light, shallow depth of field",
};

export function studioPhotoPrompt(style: StudioStyle, note?: string): string {
  const look = "preset" in style ? PRESET_STYLES[style.preset] : `the product in this style: ${style.text}`;
  return [
    `Turn this amateur product photo into a professional studio product photo: ${look}.`,
    "Remove the cluttered background.",
    note ? `The seller also asked: ${note}` : "",
    KEEP_PRODUCT,
  ]
    .filter(Boolean)
    .join(" ");
}

export function revisionPrompt(instruction: string): string {
  return `Revise this product photo as the seller asked: ${instruction}. Change only what was asked. ${KEEP_PRODUCT}`;
}

/**
 * One video clip made from the storyboard picture. The picture is a grid of panels; the clip plays only the part of
 * the story the direction names, as live action filling the whole vertical frame, never as the grid.
 */
export function clipPrompt(direction: string, artDirection?: string): string {
  return (
    `The reference image is a storyboard sheet: a grid of numbered panels of one product ad. ` +
    `Make a vertical video clip that plays out only this part of the story: ${direction} ` +
    `Edit it as a professional video editor would, as real full-frame footage with smooth camera moves, the effects, transitions and colour grade that suit this ad, and the natural sounds of the scene. ` +
    `Art direction of this ad: ${artDirection ?? DEFAULT_ART_DIRECTION} ` +
    `Add only a few small animated accents in that style, never covering the product or a face. ` +
    `Show the captions as on-screen text in that style, with the words exactly as in the storyboard sheet. ` +
    `Never show the grid, the panel borders, the panel numbers or the title label boxes. ` +
    `Keep the same person and the same product as in the storyboard sheet: the product keeps its shape, colour, logo and text. ` +
    `The person speaks or reacts only as the direction says.`
  );
}

/**
 * The whole storyboard as one picture, designed like a professional ad storyboard: slanted gutters, cinematic photos,
 * a numbered title pill and a caption bubble on each panel, small hand-drawn accents, and a different shot in each panel.
 * The scenes are written in Indonesian and each ends with `Caption: "..."`, which is the only text besides the title
 * that is drawn on the panel; a "|" in a caption starts a new line (a checklist, or the call to buy).
 */
export function sheetPrompt(scenes: readonly string[], artDirection?: string): string {
  const panels = scenes.map((scene, index) => `${index + 1}. ${PANEL_TITLES[index]} (${PANEL_SHOTS[index]}): ${scene}`).join("\n");
  return (
    `Create ONE vertical 9:16 advertisement storyboard sheet, designed the way a professional video editor and art director would present an ad, using this exact product from the reference photo. ` +
    `Art direction, chosen for this product (follow it for the mood, colour, light, graphic style and effects): ${artDirection ?? DEFAULT_ART_DIRECTION} ` +
    `Layout: a grid of ${scenes.length} panels, 2 columns by ${scenes.length / 2} rows, read left to right and top to bottom, with thin white gutters that are slightly angled instead of perfectly straight. ` +
    `The photos are high-end commercial photography with crisp detail on the product. Every panel shares the same place and light. Wherever a person appears it is the same friendly Indonesian person, with the same face, hair and clothes in every panel. ` +
    `The panels, in order, each with the kind of shot it must be (the shots differ from panel to panel):\n${panels}\n` +
    `Add graphics on top of the photos, like a designed ad. In the top-left corner of each panel put a dark-brown rounded pill label with white italic handwritten lettering of its number and title, written exactly as above (for example "1. ${PANEL_TITLES[0]}"). ` +
    `Add a cream speech bubble (or cloud bubble) with bold brown handwritten lettering for the words that follow "Caption:" in that scene, copied exactly and spelled correctly in Indonesian; make the most important word bold and underlined. ` +
    `Where the caption has several lines separated by "|", write each line on its own line and never write the "|" sign itself. In the panel with three benefits show them only as the tick checklist, one line per benefit with a yellow circle tick, and give that panel no speech bubble. ` +
    `In the last panel the first line is a headline in a cream bubble and the second line is a yellow rounded call-to-action pill with an orange swoosh underline. ` +
    `Add a few small accents in the style of the art direction near the action, never covering the product or a face. ` +
    `Show only what the scene describes; do not write the scene text itself. No camera notes, no other labels and no other text. ${KEEP_PRODUCT}`
  );
}
