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
import {
  dialogueWords,
  sanitizeCaptions,
  sanitizeGrade,
  sanitizeMusic,
  sanitizePalette,
  trimDialogue,
  type ClipCaption,
  type MusicPlan,
  type TextPalette,
  type VideoGrade,
} from "../shared/video-plan";

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
 * Shares the storyboard over the clips of a video, and decides how the video sounds. The video model is given the
 * storyboard picture and one direction per clip, so a clip plays only its part and the clips together tell the whole
 * story, in order. Written in English because it is read by the video model, not by the seller.
 */
export function videoPlanPrompt(request: { scenes: string[]; clips: number[]; artDirection?: string; wantsVoice: boolean; wantsMusic?: boolean }): string {
  const scenes =
    request.scenes.length > 0
      ? request.scenes.map((scene, index) => `${index + 1}. ${PANEL_TITLES[index] ?? "Panel"}: ${scene}`).join("\n")
      : "(none given: follow the panels of the picture itself)";
  const clips = request.clips
      .map((seconds, index) => `Clip ${index + 1}: ${seconds} seconds (at most ${dialogueWords(seconds, index === request.clips.length - 1)} spoken words)`)
      .join("\n");
  const total = request.clips.reduce((sum, seconds) => sum + seconds, 0);
  const sound = request.wantsVoice
    ? `The seller asked for a voice. Decide "audio". "on_camera": the person on screen speaks short, natural lines in Indonesian taken from the captions, in sync with their mouth (best when a person is in most clips and talks to the camera or about the product). "narration": a separate narrator reads over the video and nobody speaks on camera (best when the product is the star or the person only reacts).`
    : `The seller did not ask for a voice, so nobody speaks: answer "audio": "narration" and leave every "dialogue" empty.`;
  // Where the cuts between clips fall, so the music can be given a tempo that puts them on a beat.
  let elapsed = 0;
  const cuts = request.clips.slice(0, -1).map((seconds) => `${(elapsed += seconds).toFixed(1)} s`);
  const music = request.wantsMusic
    ? `The seller asked for music. Design the music bed like an editor choosing a track, as "music": {"use": true, "brief": "...", "level": 0.2}. "brief" is a prompt in English for a music model that makes a 30 second instrumental clip, of which only the first ${total} seconds are used: name the genre and mood that suit this product, its buyers and the art direction; a tempo in BPM chosen so the cuts fall on a beat (a beat lasts 60 divided by the BPM in seconds; ${cuts.length > 0 ? `the cuts fall at ${cuts.join(", ")}` : "there is no cut inside the video"}); the key; the instruments; and the energy: a steady groove from the first beat, no long intro, no big ending. No artist names and no vocals. "level" is how loud it sits, from 0.08 to 0.4: quieter (0.08 to 0.15) when someone speaks or a narrator reads, up to 0.3 when nothing is said. Answer "use": false when no music would suit this ad.`
    : `The seller did not ask for music: answer "music": {"use": false}.`;
  return `
[task: video-plan]
You are a professional video editor and sound designer. A vertical ad video of ${total} seconds is made from a storyboard picture (a grid of ${SCENE_COUNT} panels) in ${request.clips.length} clips, one after the other. Look at the picture: it shows the person and the product.
The art direction of this ad, chosen for this product: ${request.artDirection ?? "a clean, bright, professional commercial look that suits the product"}
The panels of the storyboard, in story order:
${scenes}
Number of clips: ${request.clips.length}
${clips}
Think first: in "thinking" write a few sentences about the product, who buys it, the person in the picture (gender, age, manner) and what sound suits this ad.
Share the whole story over the clips: every panel is shown, in order, and none is skipped. A longer clip lingers on its panels and adds natural small actions; a shorter one moves faster. When a clip plays more than one panel, say where the hard cut between them falls: an editor cuts, a model morphs, and a morph looks generated.
The first clip is the hook, the last clip is the call to buy, and what the person says or the caption shown comes from the scene's caption.
Text: text is not required. Decide, as a professional editor would, whether this ad needs any. Many strong ads use only one to three short callouts (a key benefit or an offer) and a closing call to buy, and some use none; use subtitles only when someone speaks and reading helps, and never caption every line. The video model draws no text itself, so the app adds what you write, as one "kind" each: "callout" (a designed bubble that pops in beside the product, for a benefit), "subtitle" (plain words at the bottom, for what is said) or "cta" (the call to buy, such as "Yuk, Pesan Sekarang!"). Give each a "from" and "to" in seconds from the start of that clip, so it shows while its moment is on screen, stays at least one second and never overlaps another; keep each under eight words. Leave a clip's captions empty when it needs no text.
The ending: put the call to buy in the last clip. It must be fully on screen at least two seconds before the video ends and then hold to the last frame, and nobody speaks in the last second and a half, so the closing line is never cut off. The "at most N spoken words" beside each clip is a hard limit: a line that is longer would be cut off.
Palette: choose the colours of the callouts to match the art direction, as hex colours: "bubble" (the fill), "text" (its words) and "accent" (its outline and the fill of the call to buy), for example a dark bubble with a neon accent for a gadget, or a cream bubble with a warm yellow accent for food.
Grade: choose the colour grade and texture of the whole video like a colourist, the same for every clip so they match: "contrast" (0.95 to 1.15), "saturation" (0.85 to 1.2), "brightness" (-0.04 to 0.04), "warmth" (-0.08 cooler to 0.08 warmer), "grain" (0 to 8; a little grain takes away the plastic look of generated pictures) and "vignette" (true or false), to suit the art direction.
Music: ${music}
Sound: every clip gets sound effects in sync with what is seen (cloth, footsteps, plates, the sizzle, crunch or pour of food, clicks, whooshes on camera moves and transitions, pops for graphics) over a natural room tone. No music.
${sound}
"voice" is "female" or "male": the voice that suits the person in the picture. "voiceProfile" describes that voice in English (age, tone, pace) so that every clip uses the same voice.
"dialogue" is what the person says in Indonesian in that clip, at most about 2.5 words per second of the clip, only when "audio" is "on_camera"; leave it empty when nobody speaks in that clip (for example a close-up of the product).
For each clip write a "direction" in English of two or three sentences, making the choices a professional editor would make for this art direction: which panels it plays and what happens, the camera move that fits (a slow push-in, a gentle orbit, a quick whip pan, a punch-in), the effect or detail that makes it lively, the sound effects that go with the action, the transition into the next clip, the colour grade, and the caption that shows on screen with how it animates.
Reply with JSON only, in this shape: {"thinking": "...", "audio": "on_camera" or "narration", "voice": "female" or "male", "voiceProfile": "...", "grade": {"contrast": 1.05, "saturation": 1.1, "brightness": 0, "warmth": 0.02, "grain": 3, "vignette": true}, "palette": {"bubble": "#fff4dc", "text": "#3b2314", "accent": "#ffc83a"}, "music": {"use": true or false, "brief": "...", "level": 0.2}, "clips": [${request.clips.map(() => '{"direction": "...", "dialogue": "...", "captions": [{"kind": "callout", "text": "...", "from": 0.5, "to": 3}]}').join(", ")}]}
`.trim();
}

/** How a video sounds and what happens in each clip, as the planner decided. */
export interface VideoPlan {
  audio: "on_camera" | "narration";
  voice: "female" | "male";
  /** The voice in words (age, tone, pace), repeated in every clip so the person sounds the same all through. */
  voiceProfile: string;
  /** The colour grade and texture of the whole video. */
  grade: VideoGrade;
  /** The colours of the callouts and the call to buy. */
  palette: TextPalette;
  /** The music bed, when the planner chose one. */
  music?: MusicPlan;
  clips: { direction: string; dialogue: string; captions: ClipCaption[] }[];
}

const DEFAULT_VOICE_PROFILE = "Friendly young Indonesian voice, natural pace";
const MAX_DIALOGUE_CHARS = 300;

/** The plan of a video, for clips of these lengths in seconds. Throws when the answer is not exactly one direction for every clip. */
export function parseVideoPlan(answer: string, clipSeconds: number[]): VideoPlan {
  const { clips, audio, voice, voiceProfile, grade, palette, music } = parseJsonObject(answer);
  if (!Array.isArray(clips) || clips.length !== clipSeconds.length) throw new Error("The model did not return one direction for every clip.");
  const read = (clip: unknown, index: number) => {
    // A plain string is a direction with nothing said and no caption.
    const { direction, dialogue, captions } = typeof clip === "string" ? { direction: clip, dialogue: "", captions: [] } : ((clip ?? {}) as Record<string, unknown>);
    if (typeof direction !== "string" || !direction.trim()) throw new Error("The model did not return one direction for every clip.");
    return {
      direction: direction.trim(),
      // Only what can be said inside the clip, so a line is never cut off by the end of it.
      dialogue:
        typeof dialogue === "string"
          ? trimDialogue(dialogue.trim().slice(0, MAX_DIALOGUE_CHARS), dialogueWords(clipSeconds[index], index === clipSeconds.length - 1))
          : "",
      captions: sanitizeCaptions(captions, clipSeconds[index]),
    };
  };
  return {
    audio: audio === "on_camera" ? "on_camera" : "narration",
    voice: voice === "male" ? "male" : "female",
    voiceProfile: typeof voiceProfile === "string" && voiceProfile.trim() ? voiceProfile.trim().slice(0, 300) : DEFAULT_VOICE_PROFILE,
    grade: sanitizeGrade(grade),
    palette: sanitizePalette(palette),
    music: sanitizeMusic(music),
    clips: clips.map(read),
  };
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
  // Tags such as <short pause> are pauses and breaths, not words, so only the spoken words are measured.
  const spoken = withoutTags(script).trim();
  return spoken.split(/\s+/).length <= maxWords && spoken.length <= maxWords * MAX_CHARS_PER_WORD;
}

/** The narration as it is read, without the inline tags (`<short pause>`, `<breath>`) that direct the speech model. */
export function withoutTags(script: string): string {
  return script.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Writes the narration of an ad video and directs how it is performed. The writer thinks first, about the mood of
 * each moment, then writes natural spoken Indonesian and a delivery note for the speech model, so the voice rises,
 * slows and smiles where the story does instead of reading everything on one note.
 */
export function voiceScriptPrompt(request: {
  scenes: string[];
  seconds: number;
  text: string;
  voiceProfile?: string;
  artDirection?: string;
}): string {
  const { min, max } = wordRange(request.seconds);
  const scenes = request.scenes.length > 0 ? request.scenes.map((scene, index) => `${index + 1}. ${scene}`).join("\n") : "(none given)";
  return `
[task: voice-script]
You are a voice director and copywriter for short ads. Write the narration of a ${request.seconds} second ad video of a product sold by a small online shop, and direct how it is performed.
Think first: in "thinking" write a few sentences about the mood of each moment of the story (the hook, the product, the benefit, the call to buy), where the energy should rise, where it should slow down, and what would sound natural for this product and its buyers.
The voice of the narrator: ${request.voiceProfile ?? "a friendly young Indonesian voice"}.
The look and mood of the ad: ${request.artDirection ?? "clean, bright and professional"}.
"script": natural spoken Indonesian, the way a real person talks, not a written text and not flat: short and long sentences mixed, everyday words, ${min} to ${max} spoken words so it can be read aloud in ${request.seconds} seconds. Use punctuation to carry the intonation (a question mark for curiosity, an exclamation mark for excitement, an ellipsis for a beat), and at most four inline tags where a real speaker would pause or smile: <short pause>, <breath> or <laugh>. Never write any other tag, and never a sound effect. Tags are not counted as words. Do not invent prices, discounts or claims that were not given.
"delivery": two or three sentences in English that direct the speech model: the voice and its manner, the emotional arc from the first line to the last, the pace, and how the pitch moves (for example "warm and upbeat; curious and playful at first, building excitement at the reveal, slowing down and smiling on the call to buy"). It must make the voice move, never read on one note.
Scenes of the video:
${scenes}
The seller asked: ${JSON.stringify(request.text)}
Reply with JSON only, in this shape: {"thinking": "...", "delivery": "...", "script": "..."}
`.trim();
}

/** The narration as the writer wrote it, and how to perform it. */
export interface VoiceScript {
  script: string;
  delivery: string;
}

/** Used when the writer gave no delivery: the voice still has to move. */
export const DEFAULT_DELIVERY = "Natural, warm and expressive, with lively intonation that follows the meaning of each sentence; never flat.";
const MAX_DELIVERY_CHARS = 600;

/** The writer's answer. A plain text answer (no JSON) is taken as the script alone. Throws when there is no script. */
export function parseVoiceScript(answer: string): VoiceScript {
  let script = "";
  let delivery = "";
  try {
    const parsed = parseJsonObject(answer);
    if (typeof parsed.script === "string") script = parsed.script.trim();
    if (typeof parsed.delivery === "string") delivery = parsed.delivery.trim().slice(0, MAX_DELIVERY_CHARS);
  } catch {
    script = answer.trim();
  }
  if (!script) throw new Error("The model did not write a script.");
  return { script, delivery: delivery || DEFAULT_DELIVERY };
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
