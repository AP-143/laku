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

/** The length used when the seller does not say one. */
export const DEFAULT_VIDEO_SECONDS = 10;

/** The lengths the video panel offers. The story is paced to the length: shorter is quicker, longer lingers. */
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
 * The sound of a video, as the planner decides it for this ad:
 * - `on_camera`: the person on screen speaks (lip-synced, made by the video model) and the clips keep that sound;
 * - `narration`: a separate narrator is read over the video and nobody speaks on camera;
 * - `none`: the seller asked for no voice, nobody speaks.
 * Whatever the mode, the sound effects and room tone the clips came with stay.
 */
export type AudioMode = "on_camera" | "narration" | "none";

/** The two voices a narration can have. The planner picks the one that suits the person in the picture. */
export type VoiceGender = "female" | "male";

/**
 * One piece of on-screen text, added in the edit: its words and when it shows, in seconds from the start of its clip.
 * - `subtitle`: plain words at the bottom, for what is said;
 * - `callout`: a designed bubble in the colours of the ad, for a benefit;
 * - `cta`: the call to buy, held to the last frame of the video.
 */
export interface ClipCaption {
  text: string;
  from: number;
  to: number;
  kind: "subtitle" | "callout" | "cta";
}

/** The colours of the callouts and the call to buy, picked by the planner for the look of the ad. */
export interface TextPalette {
  /** The fill of a callout. */
  bubble: string;
  /** The words of a callout. */
  text: string;
  /** The outline of a callout and the fill of the call to buy. */
  accent: string;
}

export const DEFAULT_PALETTE: TextPalette = { bubble: "#fff4dc", text: "#3b2314", accent: "#ffc83a" };

/** The call to buy is on screen at least this long, to the very last frame. */
export const CTA_HOLD_SECONDS = 2.2;

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

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Keeps the palette to real colours, whatever a model answered. Anything else takes the default. */
export function sanitizePalette(value: unknown): TextPalette {
  const palette = (value ?? {}) as Record<string, unknown>;
  const colour = (key: keyof TextPalette) => (typeof palette[key] === "string" && HEX.test(palette[key] as string) ? (palette[key] as string) : DEFAULT_PALETTE[key]);
  return { bubble: colour("bubble"), text: colour("text"), accent: colour("accent") };
}

/** How light a colour is, from 0 (black) to 1 (white). */
function lightness(hex: string): number {
  const channel = (start: number) => parseInt(hex.slice(start, start + 2), 16) / 255;
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** The colour of words on `background`: the one asked for when it can be read, otherwise black or white. */
export function readableInk(background: string, preferred?: string): string {
  if (preferred && Math.abs(lightness(preferred) - lightness(background)) >= 0.4) return preferred;
  return lightness(background) > 0.5 ? "#1a1a1a" : "#ffffff";
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
export const DEFAULT_GRADE: VideoGrade = { contrast: 1.04, saturation: 1.05, brightness: 0, warmth: 0, grain: 3, vignette: true };

const MAX_CAPTIONS_PER_CLIP = 3;
const MAX_CAPTION_CHARS = 90;
/** A caption stays at least this long, so it can be read. */
const MIN_CAPTION_SECONDS = 0.8;

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
    grain: within(grade.grain, 0, 8, DEFAULT_GRADE.grain),
    vignette: typeof grade.vignette === "boolean" ? grade.vignette : DEFAULT_GRADE.vignette,
  };
}

/** The captions of one clip of `clipSeconds`: at most three, short, each inside the clip and long enough to read. */
export function sanitizeCaptions(value: unknown, clipSeconds: number): ClipCaption[] {
  if (!Array.isArray(value)) return [];
  const captions: ClipCaption[] = [];
  for (const item of value) {
    const { text, from, to } = (item ?? {}) as Record<string, unknown>;
    if (typeof text !== "string" || !text.trim()) continue;
    const start = within(from, 0, clipSeconds - MIN_CAPTION_SECONDS, NaN);
    if (!Number.isFinite(start)) continue;
    const kind = (item as Record<string, unknown>).kind === "callout" ? "callout" : (item as Record<string, unknown>).kind === "cta" ? "cta" : "subtitle";
    captions.push({
      text: text.trim().slice(0, MAX_CAPTION_CHARS),
      from: start,
      // The call to buy stays to the end of its clip.
      to: kind === "cta" ? clipSeconds : within(to, start + MIN_CAPTION_SECONDS, clipSeconds, Math.min(clipSeconds, start + 2.5)),
      kind,
    });
    if (captions.length === MAX_CAPTIONS_PER_CLIP) break;
  }
  return captions;
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
