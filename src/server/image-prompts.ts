import type { StudioStyle, StylePreset } from "../shared/chat-events";

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
 * One video clip made from the storyboard picture. The video model is told what the picture is (a plan to film, not
 * footage to copy: a real run copied a scene of it, frame and labels included) and which part of it this clip plays, and
 * nothing else: the style, the text, the effects, the camera, the acting and the sound are its own to decide, because a
 * pile of rules from us made a real video worse.
 */
export function clipPrompt(direction: string): string {
  return `The reference image is the storyboard of an ad: a plan of its scenes to film, not footage. Make the finished ad video from it. This clip plays: ${direction}`;
}

/**
 * The whole storyboard as one picture, designed like a professional ad storyboard: slanted gutters, cinematic photos,
 * a numbered title pill and a caption bubble on each panel, small hand-drawn accents, and a different shot in each panel.
 * The scenes are written in Indonesian and each ends with `Caption: "..."`, which is the only text besides the title
 * that is drawn on the panel; a "|" in a caption starts a new line (a checklist, or the call to buy).
 */
export function sheetPrompt(scenes: readonly string[], artDirection?: string): string {
  const listed = scenes.map((scene, index) => `${index + 1}. ${scene}`).join("\n");
  return (
    `Create ONE tall vertical advertisement picture that shows the ${scenes.length} scenes of an ad in order, designed the way a professional video editor and art director would present an ad, using this exact product from the reference photo. ` +
    `Art direction, chosen for this product (follow it for the mood, colour, light, graphic style and effects): ${artDirection ?? DEFAULT_ART_DIRECTION} ` +
    `Layout: a grid of ${scenes.length} scenes, 2 columns by ${Math.ceil(scenes.length / 2)} rows, read left to right and top to bottom, with thin white gutters that are slightly angled instead of perfectly straight. ` +
    (scenes.length % 2 === 1 ? `The last scene is across the full width of the bottom row. ` : "") +
    `The photos are high-end commercial photography with crisp detail on the product. Every scene shares the same place and light. Wherever a person appears it is the same friendly Indonesian person, with the same face, hair and clothes in every scene. ` +
    `The scenes, in order (each one describes its own kind of shot, so the shots differ from scene to scene):\n${listed}\n` +
    `Add graphics on top of the photos, like a designed ad. In the top-left corner of each scene put a dark-brown rounded pill label with white italic handwritten lettering of its number only, as a single digit (for example "1"). ` +
    `Add a cream speech bubble (or cloud bubble) with bold brown handwritten lettering for the words that follow "Caption:" in that scene, copied exactly and spelled correctly in Indonesian; make the most important word bold and underlined. ` +
    `Where the caption has several lines separated by "|", write each line on its own line and never write the "|" sign itself. In the scene with three benefits show them only as the tick checklist, one line per benefit with a yellow circle tick, and give that scene no speech bubble. ` +
    `In the last scene the first line is a headline in a cream bubble and the second line is a yellow rounded call-to-action pill with an orange swoosh underline. ` +
    `Add a few small accents in the style of the art direction near the action, never covering the product or a face. ` +
    `The only text on the picture is the number pills and the captions, each written once, with no camera notes. Show only what the scene describes; do not write the scene text itself. ${KEEP_PRODUCT}`
  );
}

/**
 * The two things the app adds to a clip's sound after the clip is made, so the video model is told to leave them out:
 * a narrator's voice (the person does not speak) and a music bed. Each is said in one short sentence, and only when it applies.
 */
export function silentActor(direction: string): string {
  return `${direction} The person does not speak (a narrator is added later).`;
}

export function withoutMusic(direction: string): string {
  return `${direction} No background music (it is added later).`;
}

/** What the music model is asked for: the planner's brief, always without vocals. */
export function musicPrompt(brief: string): string {
  return `${brief.trim()} Instrumental only, no vocals.`;
}
