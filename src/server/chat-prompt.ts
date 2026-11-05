/** Internal instructions for the chat model. Written in English; the bot answers users in Bahasa Indonesia. */
export const CHAT_SYSTEM_PROMPT = `
You are LAKU, a friendly assistant for small online sellers in Indonesia.
You help turn an amateur product photo into a studio photo and a storyboard: one picture with six panels of an ad.
Storyboard and video are one feature: a video ad of 10, 20 or 30 seconds is made from the picture of an approved storyboard. If asked for a video, tell them to make a storyboard and its picture first; once the picture is done, a "Buat video iklan" panel appears under it, where the seller picks a length and presses "Generate".
Never say you are making an image or a video yourself; the app does that when the seller asks for it or approves a storyboard.

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
 * The gate for a storyboard frame before it becomes a video clip. A frame is the app's own picture of a product the
 * seller already uploaded, and an ad picture often shows a person using it, so only the product has to be clearly there.
 */
export const FRAME_CHECK_PROMPT = `
[task: frame-check]
Look at the picture, which is a scene of a product advertisement. Answer with exactly one word.
Answer YES if a product or object that could be sold is clearly visible and is the point of the picture. A person who holds, wears or uses it is fine.
Answer NO if there is no clear product in it, or it only shows a person, a face, a screenshot, a document, a landscape, or an animal.
`.trim();

import { MAX_ART_DIRECTION_CHARS, PANEL_SHOTS, PANEL_TITLES, SCENE_COUNT } from "../shared/storyboard";

/** How a scene carries the words that are written on its panel: `<what is seen> Caption: "<the words>"`. */
export const CAPTION_MARK = "Caption:";

const panelList = PANEL_TITLES.map((title, index) => `${index + 1}. ${title}: ${PANEL_SHOTS[index]}`).join("\n");

/** Scenes are shown to the seller, so they are written in Bahasa Indonesia. */
export function planScenesPrompt(request: string): string {
  return `
[task: plan-scenes]
Look at the product photo. Plan a storyboard of exactly ${SCENE_COUNT} panels of one short ad (for a vertical video) that shows this exact product.
The panels, in this order, each with its kind of shot (follow it, so the shots differ from panel to panel):
${panelList}
Each panel is a scene of one or two sentences in casual Bahasa Indonesia describing what the viewer sees, with the product clearly in view. Say what makes the picture lively: the expression, the gesture, and one effect that suits this product.
The person is the same friendly person in every panel that shows one: curious or in need at first, then enjoying the product.
End every scene with a short caption that is written on the panel, like this: ${CAPTION_MARK} "<casual Bahasa Indonesia>".
Panels 1 to 4: a caption of at most 8 words, in the voice of the person. Panel 5: three short benefits of the product, separated by " | ". Panel 6: a short headline, then " | ", then the call to buy such as "Yuk, Pesan Sekarang!".
${request ? `The seller asked for: ${JSON.stringify(request)}` : ""}
Also act as the art director and professional editor of this ad, and write the art direction in English, in two to four sentences. Choose it so it suits this product, the people who buy it and the story, instead of using one fixed recipe: the mood, the colour palette and colour grade, the lighting, the graphic style of the labels, bubbles and hand-drawn or digital accents (playful doodles, clean minimal lines, neon, elegant gold and so on), and which effects, transitions and text animations fit (for example steam and drips for hot food, glow and glitch for a gadget, soft light and gentle motion for skincare).
Reply with JSON only, in this shape: {"artDirection": "<the art direction>", "scenes": [${Array.from({ length: SCENE_COUNT }, () => '"..."').join(", ")}]}
`.trim();
}

export function replaceScenePrompt(scenes: string[], instruction: string): string {
  const numbered = scenes.map((scene, index) => `${index + 1}. ${PANEL_TITLES[index]}: ${scene}`).join("\n");
  return `
[task: replace-scene]
A seller is editing a ${SCENE_COUNT}-panel ad storyboard:
${numbered}
They said: ${JSON.stringify(instruction)}
Rewrite only the one scene they mean, in casual Bahasa Indonesia, one or two sentences, ending with ${CAPTION_MARK} "<at most 8 words>".
Reply with JSON only, in this shape: {"scene": <number from 1 to ${SCENE_COUNT}>, "text": "<the new scene>"}
`.trim();
}

/** Pulls the first JSON object out of a model answer, which may be wrapped in a code fence or chatter. */
function parseJsonObject(answer: string): Record<string, unknown> {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("The model did not answer with JSON.");
  return JSON.parse(answer.slice(start, end + 1)) as Record<string, unknown>;
}

/** The scenes of a storyboard and the art direction the planner picked for the product (none if it gave none). */
export interface PlannedStoryboard {
  scenes: string[];
  artDirection?: string;
}

export function parseScenes(answer: string): PlannedStoryboard {
  const { scenes, artDirection } = parseJsonObject(answer);
  if (!Array.isArray(scenes) || scenes.length !== SCENE_COUNT || !scenes.every((s) => typeof s === "string" && s.trim())) {
    throw new Error("The model did not return exactly the number of scenes asked for.");
  }
  const direction = typeof artDirection === "string" ? artDirection.trim().slice(0, MAX_ART_DIRECTION_CHARS) : "";
  return { scenes: scenes.map((scene) => (scene as string).trim()), artDirection: direction || undefined };
}

/** The index (0 to 3) and new text of the one scene to replace. */
export function parseReplacement(answer: string): { index: number; text: string } {
  const { scene, text } = parseJsonObject(answer);
  const valid = Number.isInteger(scene) && (scene as number) >= 1 && (scene as number) <= SCENE_COUNT;
  if (!valid || typeof text !== "string" || !text.trim()) {
    throw new Error("The model did not return a valid scene replacement.");
  }
  return { index: (scene as number) - 1, text: text.trim() };
}

/**
 * Shares the storyboard over the clips of a video. The video model is given the storyboard picture and one of these
 * directions per clip, so a clip plays only its part and the clips together tell the whole story, in order.
 * Written in English because it is read by the video model, not by the seller.
 */
export function videoPlanPrompt(request: { scenes: string[]; clips: number[]; artDirection?: string }): string {
  const scenes =
    request.scenes.length > 0
      ? request.scenes.map((scene, index) => `${index + 1}. ${PANEL_TITLES[index] ?? "Panel"}: ${scene}`).join("\n")
      : "(none given: follow the panels of the picture itself)";
  const clips = request.clips.map((seconds, index) => `Clip ${index + 1}: ${seconds} seconds`).join("\n");
  const total = request.clips.reduce((sum, seconds) => sum + seconds, 0);
  return `
[task: video-plan]
You are a professional video editor. A vertical ad video of ${total} seconds is made from a storyboard picture (a grid of ${SCENE_COUNT} panels) in ${request.clips.length} clips, one after the other.
The art direction of this ad, chosen for this product: ${request.artDirection ?? "a clean, bright, professional commercial look that suits the product"}
The panels of the storyboard, in story order:
${scenes}
Number of clips: ${request.clips.length}
${clips}
Share the whole story over the clips: every panel is shown, in order, and none is skipped. A longer clip lingers on its panels and adds natural small actions; a shorter one moves faster.
The first clip is the hook, the last clip is the call to buy, and what the person says or the caption shown comes from the scene's caption.
For each clip write a direction in English of two or three sentences, making the choices a professional editor would make for this art direction: which panels it plays and what happens, the camera move that fits (a slow push-in, a gentle orbit, a quick whip pan, a punch-in), the effect or detail that makes it lively, the transition into the next clip, the colour grade, and the caption that shows on screen with how it animates.
Reply with JSON only, in this shape: {"clips": [${request.clips.map(() => '"..."').join(", ")}]}
`.trim();
}

/** One direction per clip, as the planner wrote them. Throws when the answer is not exactly one direction for every clip. */
export function parseVideoPlan(answer: string, clipCount: number): string[] {
  const { clips } = parseJsonObject(answer);
  if (!Array.isArray(clips) || clips.length !== clipCount || !clips.every((clip) => typeof clip === "string" && clip.trim())) {
    throw new Error("The model did not return one direction for every clip.");
  }
  return clips.map((clip) => (clip as string).trim());
}

/** What the seller asked for in a video request: the length in seconds (none if not named) and a voice-over. */
export interface VideoRequest {
  seconds?: number;
  voiceOver: boolean;
}

export function parseVideoRequest(answer: string): VideoRequest {
  const { seconds, voiceOver } = parseJsonObject(answer);
  return {
    seconds: typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? seconds : undefined,
    voiceOver: voiceOver === true,
  };
}

/** Reads how long a video the seller wants and whether it needs a voice-over, from a message such as "video 10 detik pakai voice over". */
export function videoRequestPrompt(text: string): string {
  return `
[task: video-request]
A seller of an online shop asks for an ad video. Answer with only a JSON object {"seconds": <number or null>, "voiceOver": <true or false>}.
"seconds" is the video length in seconds they asked for (convert minutes to seconds), or null if they name no length.
"voiceOver" is true only if they ask for narration, a voice-over, a voice, or a narrator.
Message: ${JSON.stringify(text)}
`.trim();
}

/** What a seller wants changed in a narration: a new script, a different voice, or both. Neither means unclear. */
export interface VoiceRevision {
  script?: string;
  voice?: "female" | "male";
}

export function parseVoiceRevision(answer: string): VoiceRevision {
  const { script, voice } = parseJsonObject(answer);
  return {
    script: typeof script === "string" && script.trim() ? script.trim() : undefined,
    voice: voice === "female" || voice === "male" ? voice : undefined,
  };
}

/** Reads what a seller wants changed in the narration of their video, from a message such as "pakai suara cowok". */
export function voiceRevisionPrompt(text: string, currentScript: string): string {
  return `
[task: voice-revision]
A seller of an online shop wants to change the narration of their ad video. The current narration is:
${JSON.stringify(currentScript)}
Answer with only a JSON object {"script": <string or null>, "voice": <"female", "male" or null>}.
"script" is the complete new narration if they want other words (write it in natural Indonesian of about the same length), otherwise null.
"voice" is "female" for a woman's voice or "male" for a man's voice if they ask for one, otherwise null.
Message: ${JSON.stringify(text)}
`.trim();
}

/** Spoken Indonesian runs at about 2.5 to 3 words per second, so a script is sized to the video length. */
export function wordRange(seconds: number): { min: number; max: number } {
  return { min: Math.round(seconds * 2.5), max: Math.round(seconds * 3) };
}

/** A narration may run a little over the words that fit the length, because the pace of speech varies. */
export const NARRATION_WORD_SLACK = 5;
/** Indonesian words average about 7 letters plus a space; this leaves room for long words without allowing padding. */
const MAX_CHARS_PER_WORD = 10;

/**
 * Whether a narration is short enough for a video of `seconds`. The voice is billed by how long it speaks, which
 * follows the letters more than the words, so both are bounded.
 */
export function narrationFits(script: string, seconds: number): boolean {
  const maxWords = wordRange(seconds).max + NARRATION_WORD_SLACK;
  return script.trim().split(/\s+/).length <= maxWords && script.trim().length <= maxWords * MAX_CHARS_PER_WORD;
}

/** Writes the narration for an ad video, sized to its length. */
export function voiceScriptPrompt(request: { scenes: string[]; seconds: number; text: string }): string {
  const { min, max } = wordRange(request.seconds);
  const scenes = request.scenes.length > 0 ? request.scenes.map((scene, index) => `${index + 1}. ${scene}`).join("\n") : "(none given)";
  return `
[task: voice-script]
Write the narration for a ${request.seconds} second ad video of a product sold by a small online shop.
Write in natural, friendly Indonesian, in one paragraph of ${min} to ${max} words so it can be read aloud in ${request.seconds} seconds.
Do not invent prices, discounts or claims that were not given. Answer with only the narration text, no title and no quotes.
Scenes of the video:
${scenes}
The seller asked: ${JSON.stringify(request.text)}
`.trim();
}

export type Intent = "studio_photo" | "revise_photo" | "storyboard" | "edit_scene" | "approve_scenes" | "video" | "revise_voice" | "chat";

/** What the router can offer for this turn; it must not answer with something that is not available. */
export interface IntentContext {
  hasPhoto: boolean;
  hasPreviousResult: boolean;
  hasStoryboard: boolean;
  /** The storyboard already has its picture, which a video is made from. */
  hasSheet: boolean;
  /** A video with a voice-over was just made, whose narration can still be changed. */
  hasNarration: boolean;
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
APPROVE: they agree with the storyboard in progress and want its picture made now, e.g. "oke setuju" or "lanjut" (only if one exists).
VIDEO: they want a video ad made from the storyboard picture (only if it exists).
REVISE_VOICE: they want to change the narration or the voice of the video that was just made (only if it has one).
CHAT: anything else, including questions and greetings.
Product photo attached: ${yesNo(context.hasPhoto)}. Previous result exists: ${yesNo(context.hasPreviousResult)}. Storyboard in progress: ${yesNo(context.hasStoryboard)}. Storyboard picture exists: ${yesNo(context.hasSheet)}. Video with narration exists: ${yesNo(context.hasNarration)}.
Message: ${JSON.stringify(text)}
`.trim();
}

const INTENT_WORDS: Record<string, Intent> = {
  STUDIO: "studio_photo",
  REVISE: "revise_photo",
  STORYBOARD: "storyboard",
  EDIT_SCENE: "edit_scene",
  APPROVE: "approve_scenes",
  VIDEO: "video",
  REVISE_VOICE: "revise_voice",
};

/** Anything the router says that is not a known word is treated as plain chat. */
export function parseIntent(answer: string): Intent {
  const word = answer.trim().toUpperCase().replace(/[^A-Z_]/g, " ").split(" ")[0];
  return INTENT_WORDS[word] ?? "chat";
}
