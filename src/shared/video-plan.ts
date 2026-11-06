/**
 * How a requested video length is cut into clips. Every clip is made from the same storyboard picture and plays
 * its own part of the story, so the clips are as few and as long as the video model allows.
 * The bake-off measured 4 and 6 second clips. A clip of 8 seconds is assumed to be accepted too and has not been
 * tried on the real model yet: check one before relying on a video longer than 12 seconds.
 */

export const CLIP_SECONDS = { min: 4, max: 8, step: 2 } as const;

/** The longest video that can be asked for in words; four clips of the longest length. */
export const MAX_VIDEO_SECONDS = 32;

/** The most clips one video can have. */
export const MAX_CLIPS = MAX_VIDEO_SECONDS / CLIP_SECONDS.min;

/** The lengths the planner chooses from. The story is paced to the length: shorter is quicker, longer lingers. */
export const VIDEO_LENGTH_CHOICES = [10, 20, 30] as const;

export type ClipPlan =
  /** `seconds` is the length of the finished video; the clips can add up to a little more, which is trimmed off. */
  | { ok: true; seconds: number; clips: number[] }
  /** The length is more than a video can be; `maxSeconds` is the most it can. */
  | { ok: false; maxSeconds: number };

export function planClips(requestedSeconds: number): ClipPlan {
  const seconds = Math.max(Math.ceil(requestedSeconds), CLIP_SECONDS.min);
  // Clips come in whole steps, so an odd length is made one second longer and trimmed afterwards.
  const made = seconds % CLIP_SECONDS.step === 0 ? seconds : seconds + 1;
  if (made > MAX_VIDEO_SECONDS) return { ok: false, maxSeconds: MAX_VIDEO_SECONDS };

  // As few clips as the longest clip length allows, as even as the steps allow, the longer ones first.
  const count = Math.ceil(made / CLIP_SECONDS.max);
  const share = Math.max(CLIP_SECONDS.min, Math.floor(made / count / CLIP_SECONDS.step) * CLIP_SECONDS.step);
  const clips: number[] = Array(count).fill(share);
  let extra = made - share * count;
  for (let index = 0; extra > 0; index++) {
    clips[index] += CLIP_SECONDS.step;
    extra -= CLIP_SECONDS.step;
  }
  return { ok: true, seconds, clips };
}

/**
 * The length a seller's own words ask for: a number of seconds written as "10 detik", "30s" or "20 sec", taken as the
 * nearest length the app can make that is not longer ("15 detik" is 10). A time under 10 seconds is not a video length
 * ("teks muncul 3 detik"), so it asks for nothing. Found by a fixed pattern, not by a model, so it can be relied on.
 */
export function requestedLength(text: string | undefined): (typeof VIDEO_LENGTH_CHOICES)[number] | undefined {
  const match = text?.match(/(?<![\d.,])(\d{1,2})\s*(?:detik|dtk|sec(?:ond)?s?|s)\b/i);
  const asked = match ? Number(match[1]) : 0;
  if (asked < VIDEO_LENGTH_CHOICES[0]) return undefined;
  return VIDEO_LENGTH_CHOICES.filter((choice) => choice <= asked).at(-1);
}

/**
 * The length and clips of a video the planner chose: its seconds when they fit the number of clips it wrote, otherwise
 * the length among the choices that has that many clips. Nothing when no length the app can make fits.
 */
export function planChosenLength(seconds: unknown, clipCount: number): { seconds: number; clips: number[] } | undefined {
  const fits = (value: number) => {
    const plan = planClips(value);
    return plan.ok && plan.clips.length === clipCount ? plan : undefined;
  };
  const wanted = typeof seconds === "number" && Number.isFinite(seconds) ? fits(seconds) : undefined;
  if (wanted) return wanted;
  for (const choice of VIDEO_LENGTH_CHOICES) {
    const plan = fits(choice);
    if (plan) return plan;
  }
  return undefined;
}

/**
 * One line of the voice-over. The actor on screen never speaks: a narrator says what the actor feels at that moment,
 * so each line belongs to a moment of the acting and is read with the emotion of that moment.
 */
export interface NarrationLine {
  text: string;
  /** How the line is performed (the voice, the emotion, the pace): the style instructions of the speech model. */
  delivery: string;
  /** The second of the video where the line starts. */
  at: number;
  /** The second by which the line should be over: the end of its clip, or a held second and a half before the end of the video. */
  until: number;
}

/** The two voices a narration can have. The planner picks the one that suits the person in the picture. */
export type VoiceGender = "female" | "male";

/** What is said at most per second, so the words of a clip finish inside it. */
const WORDS_PER_SECOND = 2.2;
/** The end of the video is held: nothing is said in the last second and a half. */
const END_HOLD_SECONDS = 1.5;
/** Between two clips there is a short beat. */
const CLIP_BEAT_SECONDS = 0.5;

/** How many words can be spoken in a clip, leaving room to breathe, and a held ending in the last clip. */
export function dialogueWords(clipSeconds: number, isLast: boolean): number {
  return Math.max(0, Math.floor((clipSeconds - (isLast ? END_HOLD_SECONDS : CLIP_BEAT_SECONDS)) * WORDS_PER_SECOND));
}

/**
 * What is said in a clip, kept within `maxWords`: whole sentences only, so the line that is asked for is never one that
 * would be cut off at the end of the clip. When not even the first sentence fits, its first words are kept.
 */
export function trimDialogue(text: string, maxWords: number): string {
  const count = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;
  if (count(text) <= maxWords) return text.trim();
  let kept = "";
  for (const sentence of text.trim().split(/(?<=[.!?…])\s+/)) {
    const next = kept ? `${kept} ${sentence}` : sentence;
    if (count(next) > maxWords) break;
    kept = next;
  }
  return kept || text.trim().split(/\s+/).slice(0, maxWords).join(" ");
}

/** The colour grade and texture of a whole video, so every clip matches. Chosen by the planner within safe bounds. */
export interface VideoGrade {
  contrast: number;
  saturation: number;
  brightness: number;
  /** Negative is cooler, positive warmer. */
  warmth: number;
  /** Film grain: 0 is none. A little takes away the plastic look of generated pictures. */
  grain: number;
  vignette: boolean;
}

/** A light grade and a little grain, used when the planner gave none. */
export const DEFAULT_GRADE: VideoGrade = { contrast: 1.04, saturation: 1.05, brightness: 0, warmth: 0, grain: 2, vignette: true };

function within(value: unknown, low: number, high: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback;
}

/** Keeps a grade inside what looks natural, whatever a model answered. Anything left out takes the default. */
export function sanitizeGrade(value: unknown): VideoGrade {
  const grade = (value ?? {}) as Record<string, unknown>;
  return {
    contrast: within(grade.contrast, 0.95, 1.15, DEFAULT_GRADE.contrast),
    saturation: within(grade.saturation, 0.85, 1.2, DEFAULT_GRADE.saturation),
    brightness: within(grade.brightness, -0.04, 0.04, DEFAULT_GRADE.brightness),
    warmth: within(grade.warmth, -0.08, 0.08, DEFAULT_GRADE.warmth),
    // More than this makes the picture noisy and the file heavy.
    grain: within(grade.grain, 0, 4, DEFAULT_GRADE.grain),
    vignette: typeof grade.vignette === "boolean" ? grade.vignette : DEFAULT_GRADE.vignette,
  };
}

/** The music bed of a video as the planner designed it: a brief for the music model and how loud it sits. */
export interface MusicPlan {
  /** What the music model is asked for (genre, tempo, key, instruments, mood), in English. */
  brief: string;
  /** How loud the music sits under the rest of the sound, from 0.08 (very quiet) to 0.4. */
  gain: number;
}

/** The music of a plan, or nothing when the planner chose none or gave no brief. */
export function sanitizeMusic(value: unknown): MusicPlan | undefined {
  const music = (value ?? {}) as Record<string, unknown>;
  if (music.use !== true || typeof music.brief !== "string" || !music.brief.trim()) return undefined;
  return { brief: music.brief.trim().slice(0, 600), gain: within(music.level ?? music.gain, 0.08, 0.4, 0.2) };
}

/** A music plan that was sent back by the browser (its `gain` is already a gain), kept in the same bounds. */
export function sanitizeMusicPlan(value: unknown): MusicPlan | undefined {
  const music = (value ?? {}) as Record<string, unknown>;
  if (typeof music.brief !== "string" || !music.brief.trim()) return undefined;
  return { brief: music.brief.trim().slice(0, 600), gain: within(music.gain, 0.08, 0.4, 0.2) };
}

/** The latest second a line of a clip may run to: just before the next clip, and well before the end of the video. */
export function lineMustEndBy(clipEnd: number, isLast: boolean): number {
  return clipEnd - (isLast ? END_HOLD_SECONDS : 0.2);
}

const MAX_NARRATION_LINES = 8;
const MAX_LINE_CHARS = 300;
const MAX_DELIVERY_CHARS = 700;

/** Narration lines that came back from the browser, kept inside the video and short, whatever the request says. */
export function sanitizeNarration(value: unknown, seconds: number): NarrationLine[] {
  if (!Array.isArray(value)) return [];
  const lines: NarrationLine[] = [];
  for (const item of value) {
    const { text, delivery, at, until } = (item ?? {}) as Record<string, unknown>;
    if (typeof text !== "string" || !text.trim()) continue;
    const start = within(at, 0, seconds - 0.5, 0);
    lines.push({
      text: text.trim().slice(0, MAX_LINE_CHARS),
      delivery: typeof delivery === "string" ? delivery.trim().slice(0, MAX_DELIVERY_CHARS) : "",
      at: start,
      until: within(until, start + 0.5, seconds, seconds),
    });
    if (lines.length === MAX_NARRATION_LINES) break;
  }
  return lines;
}

/**
 * Everything the planner chose for a video: its length, what each clip plays, the voice-over, the grade and the music.
 * It is shown to the seller with the price and sent back unchanged with the yes, so what is made is what was priced.
 */
export interface VideoChoice {
  seconds: number;
  clips: number[];
  /** What each clip is told to play, as the video model gets it. */
  directions: string[];
  /** The lines of the voice-over; none means a video without one. */
  narration: NarrationLine[];
  voice: VoiceGender;
  grade: VideoGrade;
  /** The music, made after the clips; none means a video without music. */
  music?: MusicPlan;
}
