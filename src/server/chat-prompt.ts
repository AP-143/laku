/** Internal instructions for the chat model. Written in English; the bot answers users in Bahasa Indonesia. */
export const CHAT_SYSTEM_PROMPT = `
You are LAKU, a friendly assistant for small online sellers in Indonesia.
You help turn an amateur product photo into a studio photo and a storyboard: one picture with the panels of an ad (the AI decides how many panels the ad needs).
Storyboard and video are two features: a video ad is made from the picture of a storyboard. If asked for a video, tell them to pick the "Video" feature and attach the storyboard picture, or to ask for a storyboard first (its picture is made straight away from their request).
Never say you are making an image or a video yourself; the app does that when the seller asks for it.

Always reply in casual, simple Bahasa Indonesia. Keep replies short and concrete.
If the user asks for something unrelated to product photos, politely steer back to what you can do.
`.trim();

/** The photo gate: one cheap yes/no question asked before any generation is paid for. */
export const PRODUCT_CHECK_PROMPT = `
[task: product-check]
Look at the photo. Answer with exactly one word.
Answer YES if it mainly shows a product or object that could be sold: packaging, bottles, cups, gadgets, clothing,
food or drinks, accessories. It is still YES if a hand holds it or the background is messy.
Answer NO if it mainly shows a person, a face, a selfie, a group, a screenshot, a document, a landscape, or an animal.
`.trim();

/**
 * The gate for a storyboard picture before it becomes a video. A picture is the app's own picture of a product the
 * seller already uploaded, and an ad picture often shows a person using it, so only the product has to be clearly there.
 */
export const FRAME_CHECK_PROMPT = `
[task: frame-check]
Look at the picture, which is a scene of a product advertisement. Answer with exactly one word.
Answer YES if a product or object that could be sold is clearly visible and is the point of the picture. A person who holds, wears or uses it is fine.
Answer NO if there is no clear product in it, or it only shows a person, a face, a screenshot, a document, a landscape, or an animal.
`.trim();

import { MAX_ART_DIRECTION_CHARS, MAX_SCENES } from "../shared/storyboard";

/** How a scene carries the words that are written on its panel: `<what is seen> Caption: "<the words>"`. */
export const CAPTION_MARK = "Caption:";

/** Scenes are shown to the seller, so they are written in Bahasa Indonesia. */
export function planScenesPrompt(request: string): string {
  return `
[task: plan-scenes]
Look at the product photo. Plan a storyboard of one short ad (for a vertical video) that shows this exact product.
Choose how many panels the ad needs: the length of the video the seller asks for and the story decide it, so a short video has fewer panels and a long one has more. If the seller names a number of panels, use that number.
The panels tell one story in order: the first is the opening that hooks the viewer, the last is the closing that asks to buy, and between them come the product, its best detail, the person enjoying it and why it is good, as many as the story needs.
Use a different kind of shot in each panel, so they do not look alike: for example a medium shot of a person with an expressive face, an extreme close-up of the product alone, a close-up of the person enjoying it, a hero shot of the product on a styled surface.
Each panel is a scene of one or two sentences in casual Bahasa Indonesia describing what the viewer sees, with the product clearly in view. Say what makes the picture lively: the expression, the gesture, and one effect that suits this product.
The person is the same friendly person in every panel that shows one: curious or in need at first, then enjoying the product.
End every scene with a short caption that is written on the panel, like this: ${CAPTION_MARK} "<casual Bahasa Indonesia>".
The caption of a panel in the story is at most 8 words, in the voice of the person. Exactly one panel before the last gives three short benefits of the product as its caption, separated by " | ". The last panel has a short headline, then " | ", then the call to buy such as "Yuk, Pesan Sekarang!".
${request ? `The seller's first request: ${JSON.stringify(request)}. Read all of it and let it shape the whole ad: adapt the scenes and the art direction to what it says (the mood, who the buyers are, the pace, anything about the video).` : ""}
Also act as the art director and professional editor of this ad, and write the art direction in English, in two to four sentences. Choose it so it suits this product, the people who buy it and the story, instead of using one fixed recipe: the mood, the colour palette and colour grade, the lighting, the graphic style of the labels, bubbles and hand-drawn or digital accents (playful doodles, clean minimal lines, neon, elegant gold and so on), and which effects, transitions and text animations fit (for example steam and drips for hot food, glow and glitch for a gadget, soft light and gentle motion for skincare).
Reply with JSON only, in this shape, with one entry in "scenes" for each panel you chose: {"artDirection": "<the art direction>", "scenes": ["<scene of panel 1>", "<scene of panel 2>", "..."]}
`.trim();
}

/** Pulls the first JSON object out of a model answer, which may be wrapped in a code fence or chatter. */
function parseJsonObject(answer: string): Record<string, unknown> {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("The model did not answer with JSON.");
  return JSON.parse(answer.slice(start, end + 1)) as Record<string, unknown>;
}

/** The scenes of a storyboard and the art direction the planner picked for the product. */
export interface PlannedStoryboard {
  scenes: string[];
  artDirection?: string;
}

export function parseScenes(answer: string): PlannedStoryboard {
  const { scenes, artDirection } = parseJsonObject(answer);
  if (!Array.isArray(scenes) || scenes.length === 0 || scenes.length > MAX_SCENES || !scenes.every((s) => typeof s === "string" && s.trim())) {
    throw new Error("The model did not return a number of scenes a picture can hold.");
  }
  const direction = typeof artDirection === "string" ? artDirection.trim().slice(0, MAX_ART_DIRECTION_CHARS) : "";
  return { scenes: scenes.map((scene) => (scene as string).trim()), artDirection: direction || undefined };
}

export type Intent = "studio_photo" | "revise_photo" | "storyboard" | "video" | "chat";

/** What the router can offer for this turn; it must not answer with something that is not available. */
export interface IntentContext {
  hasPhoto: boolean;
  hasPreviousResult: boolean;
}

/** Routes a typed message to a feature. One cheap call, one word back. */
export function intentPrompt(text: string, context: IntentContext): string {
  const yesNo = (value: boolean) => (value ? "yes" : "no");
  return `
[task: intent]
You route one chat message from a seller of an online shop. Answer with exactly one word:
STUDIO: they want a studio photo made from a product photo.
REVISE: they want a change to the studio photo that was just made (only if a previous result exists).
STORYBOARD: they want a storyboard or ad scenes made from a product photo.
VIDEO: they want a video ad made from a storyboard picture.
CHAT: anything else, including questions and greetings.
Product photo attached: ${yesNo(context.hasPhoto)}. Previous result exists: ${yesNo(context.hasPreviousResult)}.
Message: ${JSON.stringify(text)}
`.trim();
}

const INTENT_WORDS: Record<string, Intent> = {
  STUDIO: "studio_photo",
  REVISE: "revise_photo",
  STORYBOARD: "storyboard",
  VIDEO: "video",
};

/** Anything the router says that is not a known word is treated as plain chat. */
export function parseIntent(answer: string): Intent {
  const word = answer.trim().toUpperCase().replace(/[^A-Z_]/g, " ").split(" ")[0];
  return INTENT_WORDS[word] ?? "chat";
}
