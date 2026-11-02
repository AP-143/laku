/** Internal instructions for the chat model. Written in English; the bot answers users in Bahasa Indonesia. */
export const CHAT_SYSTEM_PROMPT = `
You are LAKU, a friendly assistant for small online sellers in Indonesia.
You help turn an amateur product photo into a studio photo and a storyboard of ad scenes.
Video generation is not available yet; say so honestly if asked.

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

/** Scenes are shown to the seller, so they are written in Bahasa Indonesia. */
export function planScenesPrompt(request: string): string {
  return `
[task: plan-scenes]
Look at the product photo. Plan a storyboard of exactly 4 short ad scenes (for a vertical video) that show this exact product.
Each scene is one or two sentences in casual Bahasa Indonesia describing what the viewer sees, with the product clearly in view.
The 4 scenes should tell one small story: attention, product close-up, using it, call to buy.
${request ? `The seller asked for: ${JSON.stringify(request)}` : ""}
Reply with JSON only, in this shape: {"scenes": ["...", "...", "...", "..."]}
`.trim();
}

export function replaceScenePrompt(scenes: string[], instruction: string): string {
  const numbered = scenes.map((scene, index) => `${index + 1}. ${scene}`).join("\n");
  return `
[task: replace-scene]
A seller is editing a 4-scene ad storyboard:
${numbered}
They said: ${JSON.stringify(instruction)}
Rewrite only the one scene they mean, in casual Bahasa Indonesia, one or two sentences.
Reply with JSON only, in this shape: {"scene": <number from 1 to 4>, "text": "<the new scene>"}
`.trim();
}

/** Pulls the first JSON object out of a model answer, which may be wrapped in a code fence or chatter. */
function parseJsonObject(answer: string): Record<string, unknown> {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("The model did not answer with JSON.");
  return JSON.parse(answer.slice(start, end + 1)) as Record<string, unknown>;
}

export function parseScenes(answer: string): string[] {
  const { scenes } = parseJsonObject(answer);
  if (!Array.isArray(scenes) || scenes.length !== 4 || !scenes.every((s) => typeof s === "string" && s.trim())) {
    throw new Error("The model did not return exactly 4 scenes.");
  }
  return scenes.map((scene) => (scene as string).trim());
}

/** The index (0 to 3) and new text of the one scene to replace. */
export function parseReplacement(answer: string): { index: number; text: string } {
  const { scene, text } = parseJsonObject(answer);
  const valid = Number.isInteger(scene) && (scene as number) >= 1 && (scene as number) <= 4;
  if (!valid || typeof text !== "string" || !text.trim()) {
    throw new Error("The model did not return a valid scene replacement.");
  }
  return { index: (scene as number) - 1, text: text.trim() };
}

export type Intent = "studio_photo" | "revise_photo" | "storyboard" | "edit_scene" | "chat";

/** What the router can offer for this turn; it must not answer with something that is not available. */
export interface IntentContext {
  hasPhoto: boolean;
  hasPreviousResult: boolean;
  hasStoryboard: boolean;
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
EDIT_SCENE: they want to change or replace a scene of the storyboard in progress (only if one exists).
CHAT: anything else, including questions and greetings.
Product photo attached: ${yesNo(context.hasPhoto)}. Previous result exists: ${yesNo(context.hasPreviousResult)}. Storyboard in progress: ${yesNo(context.hasStoryboard)}.
Message: ${JSON.stringify(text)}
`.trim();
}

const INTENT_WORDS: Record<string, Intent> = {
  STUDIO: "studio_photo",
  REVISE: "revise_photo",
  STORYBOARD: "storyboard",
  EDIT_SCENE: "edit_scene",
};

/** Anything the router says that is not a known word is treated as plain chat. */
export function parseIntent(answer: string): Intent {
  const word = answer.trim().toUpperCase().replace(/[^A-Z_]/g, " ").split(" ")[0];
  return INTENT_WORDS[word] ?? "chat";
}
