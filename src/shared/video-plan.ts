/**
 * How a requested video length is cut into clips: one clip per storyboard scene frame, in order.
 * The bake-off measured a 4 second clip. The longer lengths (6 and 8 seconds) are assumed to be accepted too and
 * have not been tried on the real model yet: check one before relying on a video longer than 8 seconds.
 */

export const CLIP_SECONDS = { min: 4, max: 8, step: 2 } as const;

/** The length used when the seller does not say one. */
export const DEFAULT_VIDEO_SECONDS = 10;

/** The lengths the video panel offers. The scenes are fitted to the length, not the other way round. */
export const VIDEO_LENGTH_CHOICES = [10, 20, 30] as const;

/**
 * Which storyboard frames the clips are made from. When there are fewer clips than frames, they are spread over the
 * storyboard and always keep the first frame (the hook) and the last (the call to action). It depends only on the two
 * counts, so a video remade after a failed clip picks the same frames again.
 */
export function framesForClips(clipCount: number, frameCount: number): number[] {
  if (clipCount >= frameCount) return Array.from({ length: frameCount }, (_, index) => index);
  if (clipCount <= 1) return [0];
  return Array.from({ length: clipCount }, (_, index) => Math.round((index * (frameCount - 1)) / (clipCount - 1)));
}

export type ClipPlan =
  /** `seconds` is the length of the finished video; the clips can add up to a little more, which is trimmed off. */
  | { ok: true; seconds: number; clips: number[] }
  /** The frames cannot cover the length; `maxSeconds` is the most they can. */
  | { ok: false; maxSeconds: number };

export function planClips(requestedSeconds: number, frameCount: number): ClipPlan {
  const seconds = Math.max(Math.ceil(requestedSeconds), CLIP_SECONDS.min);
  // Clips come in whole steps, so an odd length is made one second longer and trimmed afterwards.
  const made = seconds % CLIP_SECONDS.step === 0 ? seconds : seconds + 1;

  const maxSeconds = frameCount * CLIP_SECONDS.max;
  if (made > maxSeconds) return { ok: false, maxSeconds };

  // As many clips as possible, each at least the shortest length, for a more varied ad.
  const count = Math.min(frameCount, Math.floor(made / CLIP_SECONDS.min));
  const clips: number[] = Array(count).fill(CLIP_SECONDS.min);
  let extra = made - count * CLIP_SECONDS.min;
  for (let index = 0; extra > 0; index = (index + 1) % count) {
    if (clips[index] < CLIP_SECONDS.max) {
      clips[index] += CLIP_SECONDS.step;
      extra -= CLIP_SECONDS.step;
    }
  }
  return { ok: true, seconds, clips };
}
