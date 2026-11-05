import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { framesForClips, planClips } from "./video-plan";

/** How a requested video length is cut into clips, one per storyboard scene, in order. */

describe("framesForClips", () => {
  it("uses every frame when there is a clip for each", () => {
    assert.deepEqual(framesForClips(4, 4), [0, 1, 2, 3]);
  });

  it("keeps the first and the last frame when there are fewer clips than frames", () => {
    assert.deepEqual(framesForClips(2, 4), [0, 3]);
    assert.deepEqual(framesForClips(3, 4), [0, 2, 3]);
    assert.deepEqual(framesForClips(2, 3), [0, 2]);
  });

  it("starts from the first frame when there is a single clip", () => {
    assert.deepEqual(framesForClips(1, 4), [0]);
  });
});

describe("planClips", () => {
  it("splits 10 seconds into two clips, 6 and 4", () => {
    assert.deepEqual(planClips(10, 4), { ok: true, seconds: 10, clips: [6, 4] });
  });

  it("uses as many clips as it can while each stays at the shortest length", () => {
    assert.deepEqual(planClips(16, 4), { ok: true, seconds: 16, clips: [4, 4, 4, 4] });
  });

  it("spreads the extra time over the clips", () => {
    assert.deepEqual(planClips(24, 4), { ok: true, seconds: 24, clips: [6, 6, 6, 6] });
    assert.deepEqual(planClips(32, 4), { ok: true, seconds: 32, clips: [8, 8, 8, 8] });
  });

  it("raises a length below the shortest clip to that shortest clip", () => {
    assert.deepEqual(planClips(2, 4), { ok: true, seconds: 4, clips: [4] });
  });

  it("makes clips of whole even seconds, so an odd length is cut short at the end instead", () => {
    // 11 seconds is made as 12 seconds of clips and trimmed to 11 afterwards.
    assert.deepEqual(planClips(11, 4), { ok: true, seconds: 11, clips: [4, 4, 4] });
  });

  it("never uses more clips than there are scene frames", () => {
    assert.deepEqual(planClips(16, 2), { ok: true, seconds: 16, clips: [8, 8] });
  });

  it("refuses a length the frames cannot cover and says the most it can do", () => {
    assert.deepEqual(planClips(33, 4), { ok: false, maxSeconds: 32 });
    assert.deepEqual(planClips(17, 2), { ok: false, maxSeconds: 16 });
  });
});
