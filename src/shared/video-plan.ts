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
