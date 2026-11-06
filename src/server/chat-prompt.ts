/** Internal instructions for the chat model. Written in English; the bot answers users in Bahasa Indonesia. */
export const CHAT_SYSTEM_PROMPT = `
You are LAKU, a friendly assistant for small online sellers in Indonesia.
You help turn an amateur product photo into a studio photo and a storyboard: one picture with six panels of an ad.
Storyboard and video are one feature: a video ad of 10, 20 or 30 seconds is made from the picture of an approved storyboard. If asked for a video, tell them to make a storyboard and its picture first; once the picture is done, a "Buat video iklan" panel appears under it, where the seller presses "Generate": the AI then decides the length, whether there is a voice-over and whether there is music, and the seller only says yes to the price.
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

import { MAX_ART_DIRECTION_CHARS, MAX_BRIEF_CHARS, PANEL_SHOTS, PANEL_TITLES, SCENE_COUNT } from "../shared/storyboard";
import {
  dialogueWords,
  planChosenLength,
  planClips,
  sanitizeGrade,
  sanitizeMusic,
  trimDialogue,
  VIDEO_LENGTH_CHOICES,
  type MusicPlan,
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
${request ? `The seller's first request: ${JSON.stringify(request)}. Read all of it and let it shape the whole ad: adapt the scenes and the art direction to what it says (the mood, who the buyers are, the pace, anything about the video).` : ""}
Also act as the art director and professional editor of this ad, and write the art direction in English, in two to four sentences. Choose it so it suits this product, the people who buy it and the story, instead of using one fixed recipe: the mood, the colour palette and colour grade, the lighting, the graphic style of the labels, bubbles and hand-drawn or digital accents (playful doodles, clean minimal lines, neon, elegant gold and so on), and which effects, transitions and text animations fit (for example steam and drips for hot food, glow and glitch for a gadget, soft light and gentle motion for skincare).
Also write a "brief": one or two plain sentences in English that record what the seller wants of the final video (its length, a voice-over, music, the vibe), only when the request says something about it; otherwise an empty string. The video is planned later from your brief, so keep what the seller asked for in it.
Reply with JSON only, in this shape: {"artDirection": "<the art direction>", "brief": "<the brief or an empty string>", "scenes": [${Array.from({ length: SCENE_COUNT }, () => '"..."').join(", ")}]}
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

/**
 * The scenes of a storyboard, the art direction the planner picked for the product and the brief: what the seller's first
 * request asked of the final video (none if it gave none).
 */
export interface PlannedStoryboard {
  scenes: string[];
  artDirection?: string;
  brief?: string;
}

export function parseScenes(answer: string): PlannedStoryboard {
  const { scenes, artDirection, brief } = parseJsonObject(answer);
  if (!Array.isArray(scenes) || scenes.length !== SCENE_COUNT || !scenes.every((s) => typeof s === "string" && s.trim())) {
    throw new Error("The model did not return exactly the number of scenes asked for.");
  }
  const direction = typeof artDirection === "string" ? artDirection.trim().slice(0, MAX_ART_DIRECTION_CHARS) : "";
  const wish = typeof brief === "string" ? brief.trim().slice(0, MAX_BRIEF_CHARS) : "";
  return { scenes: scenes.map((scene) => (scene as string).trim()), artDirection: direction || undefined, brief: wish || undefined };
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
 * Decides a whole video: how long it is, whether it has a voice-over and whether it has music, how the story is shared over
 * the clips, and the colour grade. The video model is given the storyboard picture and one direction per clip, so a clip
 * plays only its part and the clips together tell the whole story, in order; how it looks, moves and sounds is the video
 * model's own choice. `brief` is what the first request of the seller asked of the video (the storyboard was planned from
 * it), and `wish` is what the seller typed with this request, when they typed instead of only pressing the button.
 * Written in English because it is read by models, not by the seller.
 */
export function videoPlanPrompt(request: { scenes: string[]; artDirection?: string; brief?: string; wish?: string }): string {
  const scenes =
    request.scenes.length > 0
      ? request.scenes.map((scene, index) => `${index + 1}. ${PANEL_TITLES[index] ?? "Panel"}: ${scene}`).join("\n")
      : "(none given: follow the panels of the picture itself)";
  // For each length: the clips it is made of, the words a narration line may have in each, and where the cuts fall (so the music can sit on a beat).
  const options = VIDEO_LENGTH_CHOICES.flatMap((seconds) => {
    const plan = planClips(seconds);
    if (!plan.ok) return [];
    let elapsed = 0;
    const cuts = plan.clips.slice(0, -1).map((length) => `${(elapsed += length).toFixed(1)} s`);
    const words = plan.clips.map((length, index) => dialogueWords(length, index === plan.clips.length - 1));
    return [
      `- ${seconds} seconds: ${plan.clips.length} clips of ${plan.clips.join(", ")} seconds; a narration line of at most ${words.join(", ")} words in them; ${cuts.length > 0 ? `the cuts fall at ${cuts.join(", ")}` : "no cut inside the video"}`,
    ];
  }).join("\n");
  const asked = [
    request.brief ? `In their first request the seller asked this of the video (the storyboard was already planned from it): ${JSON.stringify(request.brief)}.` : "",
    request.wish ? `The seller wrote: ${JSON.stringify(request.wish)}${request.brief ? " (what they wrote now wins where it differs from the first request)" : ""}.` : "",
  ].filter(Boolean);
  const wish =
    asked.length > 0
      ? `${asked.join(" ")} Follow what they ask for (the length, a voice-over, music) as far as the options allow, and decide whatever they did not mention.`
      : "The seller only pressed the Generate button: everything is yours to decide.";
  return `
[task: video-plan]
You are the producer of a vertical ad video that is made from a storyboard picture (a grid of ${SCENE_COUNT} panels), in clips one after the other. Look at the picture: it shows the person and the product. You decide how long the video is, whether it has a voice-over and whether it has music.
The art direction of this ad, chosen for this product: ${request.artDirection ?? "a clean, bright, professional commercial look that suits the product"}
The panels of the storyboard, in story order:
${scenes}
${wish}
Length: choose "seconds" from these options, the one that tells this story best (a shorter video moves faster, a longer one lets the story linger). Write one entry in "clips" for every clip of the option you choose.
${options}
Think first: in "thinking" write a few sentences about the product, who buys it, the person in the picture (gender, age, manner) and what this ad needs.
Share the whole story over the clips: every panel is played, in order, and none is skipped.
Grade: choose the colour grade and texture of the whole video like a colourist, the same for every clip so they match: "contrast" (0.95 to 1.15), "saturation" (0.85 to 1.2), "brightness" (-0.04 to 0.04), "warmth" (-0.08 cooler to 0.08 warmer), "grain" (0 to 4) and "vignette" (true or false), to suit the art direction.
Voice-over: choose "voiceOver": true when a narrator would make this ad stronger, and false when it is better without one. With a voice-over the person in the video does not speak and a narrator is added later, in a voice that suits the person. For each clip write one narration line in Indonesian (within the words allowed for that clip in the length you chose) about what the person feels in that part of the story, and a "delivery" in English that directs its emotion and pace so the voice is never flat: for example "weary and wishful, drawn-out vowels, almost a sigh", "bright and excited, rising on the reveal", "warm, proud and inviting". "from" is the second of the clip where the line starts. The word limit is hard: a longer line would be cut off, and nobody speaks in the last second and a half of the video. Leave a clip's narration empty when its part is better left silent. Without a voice-over the "narration" of every clip is empty.
Music: choose "use": true when music would make this ad stronger, and false when it is better without. Design the music bed like an editor choosing a track, as "music": {"use": true, "brief": "...", "level": 0.2}. "brief" is a prompt in English for a music model that makes a 30 second instrumental clip, of which only the first seconds of the video are used: name the genre and mood that suit this product, its buyers and the art direction; a tempo in BPM chosen so the cuts of the length you chose fall on a beat (a beat lasts 60 divided by the BPM in seconds); the key; the instruments; and the energy: a steady groove from the first beat, no long intro, no big ending. No artist names and no vocals. "level" is how loud it sits, from 0.08 to 0.4: quieter (0.08 to 0.15) when a narrator reads, up to 0.3 when nothing is said.
"voice" is "female" or "male": the voice that suits the person in the picture. "voiceProfile" describes that voice in English (age, tone, pace) so that every line uses the same voice.
For each clip write a "direction" in English of one or two plain sentences: which panels it plays and what happens in them. Say nothing about how it is filmed, edited, acted or heard: the video model decides all of that itself.
Reply with JSON only, in this shape, with one entry in "clips" for each clip of the length you chose: {"thinking": "...", "seconds": 10 or 20 or 30, "voiceOver": true or false, "voice": "female" or "male", "voiceProfile": "...", "grade": {"contrast": 1.05, "saturation": 1.1, "brightness": 0, "warmth": 0.02, "grain": 3, "vignette": true}, "music": {"use": true or false, "brief": "...", "level": 0.2}, "clips": [{"direction": "...", "narration": {"line": "...", "delivery": "...", "from": 0.5}}]}
`.trim();
}

/** How a video sounds and what happens in each clip, as the planner decided. */
export interface VideoPlan {
  /** The length of the video the planner chose, and the clips it is made of. */
  seconds: number;
  clipSeconds: number[];
  /** Whether the planner chose a voice-over; false when it wrote no line for any clip. */
  voiceOver: boolean;
  voice: "female" | "male";
  /** The voice in words (age, tone, pace), repeated in every clip so the person sounds the same all through. */
  voiceProfile: string;
  /** The colour grade and texture of the whole video. */
  grade: VideoGrade;
  /** The music bed, when the planner chose one. */
  music?: MusicPlan;
  clips: { direction: string; narration?: { text: string; delivery: string; from: number } }[];
}

const DEFAULT_VOICE_PROFILE = "Friendly young Indonesian voice, natural pace";
const MAX_LINE_CHARS = 300;
const MAX_DELIVERY_CHARS = 700;

/** The narration line of one clip, kept to the words that fit its seconds, or nothing when the clip has none. */
function readNarration(value: unknown, clipSeconds: number, isLast: boolean): { text: string; delivery: string; from: number } | undefined {
  const { line, delivery, from } = (value ?? {}) as Record<string, unknown>;
  if (typeof line !== "string" || !line.trim()) return undefined;
  const text = trimDialogue(line.trim().slice(0, MAX_LINE_CHARS), dialogueWords(clipSeconds, isLast));
  if (!text) return undefined;
  return {
    text,
    delivery: typeof delivery === "string" && delivery.trim() ? delivery.trim().slice(0, MAX_DELIVERY_CHARS) : DEFAULT_DELIVERY,
    from: typeof from === "number" && Number.isFinite(from) ? Math.min(Math.max(from, 0), Math.max(0, clipSeconds - 1)) : 0.4,
  };
}

/** The plan of a video. Throws when the answer has no length the app can make, or no direction for every clip of it. */
export function parseVideoPlan(answer: string): VideoPlan {
  const { clips, seconds, voiceOver, voice, voiceProfile, grade, music } = parseJsonObject(answer);
  if (!Array.isArray(clips)) throw new Error("The model did not return one direction for every clip.");
  const length = planChosenLength(seconds, clips.length);
  if (!length) throw new Error("The model did not return the clips of a length this app can make.");
  const read = (clip: unknown, index: number) => {
    // A plain string is a direction with nothing said.
    const { direction, narration } = typeof clip === "string" ? { direction: clip, narration: undefined } : ((clip ?? {}) as Record<string, unknown>);
    if (typeof direction !== "string" || !direction.trim()) throw new Error("The model did not return one direction for every clip.");
    return {
      direction: direction.trim(),
      // Only what can be said inside the clip, so a line is never cut off by the end of it.
      narration: readNarration(narration, length.clips[index], index === length.clips.length - 1),
    };
  };
  const planned = clips.map(read);
  // A voice-over exists only when the planner chose one and wrote a line for it.
  const spoken = voiceOver === true && planned.some((clip) => clip.narration);
  return {
    seconds: length.seconds,
    clipSeconds: length.clips,
    voiceOver: spoken,
    voice: voice === "male" ? "male" : "female",
    voiceProfile: typeof voiceProfile === "string" && voiceProfile.trim() ? voiceProfile.trim().slice(0, 300) : DEFAULT_VOICE_PROFILE,
    grade: sanitizeGrade(grade),
    music: sanitizeMusic(music),
    clips: spoken ? planned : planned.map(({ direction }) => ({ direction })),
  };
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

/** Used for a line that has no delivery of its own: the voice still has to move. */
export const DEFAULT_DELIVERY = "Natural, warm and expressive, with lively intonation that follows the meaning of each sentence; never flat.";

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
