import type { StudioStyle, StylePreset } from "../shared/chat-events";

/** Internal instructions for the image model. Written in English. */

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

/** The motion for one video clip made from a storyboard frame. */
export function clipPrompt(): string {
  return (
    "Gentle cinematic camera push-in on the product with soft light shifts. " +
    "The product stays exactly the same and does not change shape, logo or text. No people, no new objects."
  );
}

export function framePrompt(scene: string): string {
  return (
    `Create one scene of a vertical 9:16 advertisement storyboard, using this exact product. Scene: ${scene}. ` +
    `Lifestyle styling, shallow depth of field. ` +
    `Do not write scene numbers, labels or camera notes in the picture; only put text in it if the scene asks for it. ${KEEP_PRODUCT}`
  );
}
